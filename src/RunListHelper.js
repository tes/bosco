const Promise = require('bluebird');
const _ = require('lodash');
const github = require('octonode');
const treeify = require('treeify');

let warnOrganisationMissing = true;

function getGithubRepo(bosco, repo) {
  const team = bosco.getTeam();
  const organisation = !team ? bosco.config.get('github:org') : team.split('/')[0];
  let githubRepo;
  if (!organisation) {
    if (warnOrganisationMissing) {
      bosco.warn(`Ensure you configured your github organisation: ${'bosco config set github:org <organisation>'.yellow}`);
      bosco.warn(`Ensure you configured your team: ${'bosco team setup'.yellow}`);
      warnOrganisationMissing = false;
    }
  } else {
    githubRepo = `${organisation}/${repo}`;
  }
  return githubRepo;
}

function getCachedConfig(bosco, repo, returnDefault) {
  const unknownDefault = { name: repo, service: { name: repo, type: 'unknown' } };
  const githubRepo = getGithubRepo(bosco, repo);
  const configKey = `cache:github:${githubRepo}`;
  const cachedConfig = bosco.config.get(configKey);
  return cachedConfig || (returnDefault && unknownDefault);
}

function getServiceDockerConfig(bosco, runConfig, svcConfig) {
  let dockerConfig;
  if (runConfig && svcConfig) {
    const defaultConfig = bosco.config.get('docker:defaults') || {
      type: 'docker',
      name: runConfig.name,
      registry: 'docker-registry.tescloud.com',
      username: 'tescloud',
      version: 'latest',
      docker: {
        Config: {
          Env: ['TSL_ENV=local'],
        },
        HostConfig: {
          ExposedPorts: {},
          PortBindings: {},
          ExtraHosts: [],
        },
      },
    };
    if (svcConfig.server && svcConfig.server.port) {
      const exposedPort = `${svcConfig.server.port}/tcp`;
      dockerConfig = _.clone(defaultConfig);
      dockerConfig.docker.HostConfig.ExposedPorts[exposedPort] = {};
      dockerConfig.docker.HostConfig.PortBindings[exposedPort] = [{
        HostIp: '0.0.0.0',
        HostPort: `${svcConfig.server.port}`,
      }];
      if (svcConfig.service) {
        dockerConfig.name = svcConfig.service.name;
      }
    }
  }
  return dockerConfig;
}

function isExpiredConfig(config) {
  if (!config.cachedTime) return true;
  return (new Date() - new Date(config.cachedTime)) > (2 * 24 * 60 * 60 * 1000); // 2 days
}

function getServiceConfigFromGithub(bosco, repo, svcConfig, next) {
  const client = github.client(bosco.config.get('github:authToken'), { hostname: bosco.config.get('github:apiHostname') });
  const githubRepo = getGithubRepo(bosco, repo);
  const cachedConfig = getCachedConfig(bosco, repo, false);
  const configKey = `cache:github:${githubRepo}`;
  const { nocache } = bosco.options;
  const { offline } = bosco.options;
  const isInfraRepo = repo.indexOf('infra-') >= 0;
  const skipRemoteRepo = (bosco.options.teamOnly && !isInfraRepo) || bosco.command === 'cdn';
  if (!githubRepo) {
    return next(null);
  }
  if (skipRemoteRepo) {
    svcConfig.service.type = 'skip'; // eslint-disable-line no-param-reassign
    return next(null, svcConfig);
  }
  if (cachedConfig && !nocache && (!isExpiredConfig(cachedConfig) || offline)) {
    next(null, cachedConfig);
  } else {
    bosco.log(`Downloading remote service config from github: ${githubRepo.cyan}`);
    const ghrepo = client.repo(githubRepo);
    ghrepo.contents('bosco-service.json', (err, boscoSvc) => {
      if (err) {
        return next(err);
      }
      const boscoSvcContent = Buffer.from(boscoSvc.content, 'base64');
      const boscoSvcConfig = JSON.parse(boscoSvcContent.toString());
      boscoSvcConfig.name = boscoSvcConfig.name || repo;
      ghrepo.contents('config/default.json', (ghErr, defaultCfg) => {
        if (!ghErr || defaultCfg) {
          const defaultCfgContent = Buffer.from(defaultCfg.content, 'base64');
          const defaultCfgConfig = JSON.parse(defaultCfgContent.toString());
          boscoSvcConfig.server = defaultCfgConfig.server || {};
        }
        if (!boscoSvcConfig.service || boscoSvcConfig.service.type !== 'docker') {
          boscoSvcConfig.service = _.defaults(boscoSvcConfig.service, getServiceDockerConfig(bosco, svcConfig, boscoSvcConfig));
        }

        boscoSvcConfig.cachedTime = new Date();
        bosco.config.set(configKey, boscoSvcConfig);
        bosco.config.save(() => {
          next(null, boscoSvcConfig);
        });
      });
    });
  }
}

function getRunConfig(bosco, repo, watchRegex) {
  const repoPath = bosco.getRepoPath(repo);
  const watch = !!repo.match(watchRegex);
  const packageJson = [repoPath, 'package.json'].join('/');
  const boscoService = [repoPath, 'bosco-service.json'].join('/');
  let svcConfig = {
    name: repo,
    cwd: repoPath,
    watch,
    order: 50,
    service: {},
  };
  let pkg;
  let svc;
  const repoExistsLocally = bosco.exists(repoPath);
  const hasPackageJson = bosco.exists(packageJson);
  const hasBoscoService = bosco.exists(boscoService);

  if (hasPackageJson) {
    pkg = require(packageJson); // eslint-disable-line global-require,import/no-dynamic-require
    const packageConfig = {};
    if (pkg.scripts && pkg.scripts.start) {
      packageConfig.type = 'node';
      packageConfig.start = pkg.scripts.start;
    }
    if (pkg.engines && pkg.engines.node) {
      packageConfig.nodeVersion = pkg.engines.node;
    }
    svcConfig.service = packageConfig;
  }

  if (hasBoscoService) {
    svc = require(boscoService); // eslint-disable-line global-require,import/no-dynamic-require
    svcConfig = _.extend(svcConfig, {
      tags: svc.tags,
      order: svc.order,
    });
    if (svc.service) {
      svcConfig.service = _.extend(svcConfig.service, svc.service);
    }
  }

  if (repoExistsLocally && !hasBoscoService) {
    svcConfig.service.type = 'skip';
  }

  if (!repoExistsLocally) {
    return new Promise((resolve, reject) => {
      getServiceConfigFromGithub(bosco, repo, svcConfig, (err, ...rest) => (err ? reject(err) : resolve(...rest)));
    });
  }

  return svcConfig;
}

async function getRunList(bosco, repos, repoRegex, watchRegex, repoTag, displayOnly) {
  const configs = {};
  const tree = {};

  function isCurrentService(repo) {
    return (bosco.options.inService && repo === bosco.options.inServiceRepo);
  }

  function notCurrentService(repo) {
    return !isCurrentService(repo);
  }

  function matchesRegexOrTag(repo, tags) {
    return (!repoTag && repo.match(repoRegex)) || (repoTag && _.includes(tags, repoTag));
  }

  function boscoOptionFilter(option, fn) {
    if (bosco.options[option]) return fn;
    return () => true;
  }

  function getConfig(repo) {
    return configs[repo] || { name: repo, service: { name: repo, type: 'unknown' } };
  }

  function isType(type) {
    return (repo) => getConfig(repo).service.type === type;
  }

  function matchingRepo(repo) {
    const config = getConfig(repo);
    return matchesRegexOrTag(repo, config.tags);
  }

  function isInfraOnly(repoConfig) {
    const filter = bosco.options.infra ? /^infra-/ : /.*/;
    return repoConfig.name.match(filter);
  }

  function exclude(repoConfig) {
    const filter = bosco.options.exclude ? new RegExp(bosco.options.exclude) : /$a/;
    return !repoConfig.name.match(filter);
  }

  // in order to understand recursion one must understand recursion
  async function resolveDependencies(repoList, resolved) {
    return Promise.reduce(repoList, async (memo, repo) => {
      if (_.includes(memo, repo)) {
        return memo;
      }
      memo.push(repo);

      let svcConfig;
      try {
        svcConfig = await getRunConfig(bosco, repo, watchRegex);
      } catch (err) {
        bosco.error(`Unable to retrieve config from github for: ${repo.cyan} because: ${err.message}`);
        return memo;
      }

      if (!svcConfig) return memo;

      configs[repo] = svcConfig;
      if (svcConfig && svcConfig.service && svcConfig.service.dependsOn) {
        return resolveDependencies(svcConfig.service.dependsOn, memo);
      }

      return memo;
    }, resolved);
  }

  function getOrder(config) {
    return config.order || (_.includes(['docker', 'docker-compose'], config.service.type) ? 100 : 500);
  }

  async function createTree(parent, path, repo) {
    if (repo.endsWith('(circular)')) return []; // Else we seemingly try to hit our cache or github for this again with (circular) as part of the repo name...
    const parentNode = parent;
    let repoConfig = await getRunConfig(bosco, repo);
    if (!repoConfig.service.type) {
      repoConfig = getCachedConfig(bosco, repo, true);
    }
    const isInfra = repo.indexOf('infra-') >= 0;
    const isService = repo.indexOf('service-') >= 0;
    const isApp = repo.indexOf('app-') >= 0;
    const isDocker = repoConfig.service.type === 'docker';
    const isNonTeamServiceOrApp = isDocker && (isService || isApp);
    const skipRemoteRepo = bosco.options.teamOnly && isNonTeamServiceOrApp;
    if (skipRemoteRepo) {
      return [];
    }
    let repoName = isNonTeamServiceOrApp ? `${repo}*` : repo;
    if (isNonTeamServiceOrApp) {
      repoName = repoName.grey;
    } else if (isApp && !isNonTeamServiceOrApp) {
      repoName = repoName.green;
    } else if (isService && !isNonTeamServiceOrApp) {
      repoName = repoName.cyan;
    } else if (isInfra) {
      repoName = repoName.blue;
    }

    parentNode[repoName] = {};

    const dependsOn = repoConfig.service.dependsOn || [];

    const newDependencies = dependsOn.filter((dependency) => !path.includes(dependency));

    const circularDependencies = dependsOn.filter((dependency) => path.includes(dependency)).map((dependency) => `${dependency} (circular)`);

    return Promise.mapSeries(newDependencies.concat(circularDependencies), (dep) => createTree(parentNode[repoName], path.concat(repo), dep));
  }

  const filteredRepos = _.filter(repos, matchingRepo);

  const repoList = await resolveDependencies(filteredRepos, []);

  const runList = _.chain(repoList)
    .filter(boscoOptionFilter('deps-only', notCurrentService))
    .filter(boscoOptionFilter('docker-only', isType('remote')))
    .map(getConfig)
    .filter(isInfraOnly)
    .filter(exclude)
    .sortBy(getOrder)
    .value();

  if (displayOnly) {
    await Promise.mapSeries(repos, (repo) => createTree(tree, [], repo));
    console.log(treeify.asTree(tree)); /* eslint-disable-line no-console */
    return Promise.resolve();
  }
  return runList;
}

function getRepoRunList(bosco, repos, repoRegex, watchRegex, repoTag, displayOnly) {
  return getRunList(bosco, repos, repoRegex, watchRegex, repoTag, displayOnly)
    .then((runList) => _.map(runList, (repo) => ({ name: repo.name, type: repo.service.type })));
}

module.exports = {
  getRunList,
  getRepoRunList,
  getServiceConfigFromGithub,
  getServiceDockerConfig,
};
