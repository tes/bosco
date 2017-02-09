
var _ = require('lodash');
var github = require('octonode');
var async = require('async');
var treeify = require('treeify');

function getGithubRepo(bosco, repo) {
  var team = bosco.getTeam();
  var organisation = team === 'no-team' ? bosco.config.get('github:org') : team.split('/')[0];
  var githubRepo = organisation + '/' + repo;
  return githubRepo;
}

function getCachedConfig(bosco, repo) {
  var githubRepo = getGithubRepo(bosco, repo);
  var configKey = 'cache:github:' + githubRepo;
  var cachedConfig = bosco.config.get(configKey);
  return cachedConfig || { name: repo, service: { type: 'unknown' } };
}

function getServiceDockerConfig(runConfig, svcConfig) {
  var dockerConfig;
  // apologies this is TES specific in short term while we figure out if it works and make it configurable
  var defaultConfig = {
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
        Links: [],
      },
    },
  };

  if (svcConfig.server && svcConfig.server.port) {
    var exposedPort = svcConfig.server.port + '/tcp';
    dockerConfig = _.clone(defaultConfig);
    dockerConfig.docker.HostConfig.ExposedPorts[exposedPort] = {};
    dockerConfig.docker.HostConfig.PortBindings[exposedPort] = [{
      HostIp: '0.0.0.0',
      HostPort: '' + svcConfig.server.port,
    }];
    if (svcConfig.service) {
      dockerConfig.name = svcConfig.service.name;
    }
    if (svcConfig.service.dependsOn) {
      var infra = _.filter(svcConfig.service.dependsOn, function(i) { return _.startsWith(i, 'infra-'); });
      infra.forEach(function(i) {
        dockerConfig.docker.HostConfig.Links.push(i + ':' + i);
      });
    }
  }

  return dockerConfig;
}


function getServiceConfigFromGithub(bosco, repo, svcConfig, next) {
  var client = github.client(bosco.config.get('github:authToken'), {hostname: bosco.config.get('github:apiHostname')});
  var githubRepo = getGithubRepo(bosco, repo);
  var cachedConfig = getCachedConfig(bosco, repo);
  var configKey = 'cache:github:' + githubRepo;
  var nocache = bosco.options.nocache;
  if (cachedConfig && !nocache) {
    next(null, cachedConfig);
  } else {
    bosco.log('Downloading remote service config from github: ' + githubRepo.cyan);
    var ghrepo = client.repo(githubRepo);
    ghrepo.contents('bosco-service.json', function(err, boscoSvc) {
      if (err) {
        return next(err);
      }
      var boscoSvcContent = new Buffer(boscoSvc.content, 'base64');
      var boscoSvcConfig = JSON.parse(boscoSvcContent.toString());
      boscoSvcConfig.name = boscoSvcConfig.name || repo;
      ghrepo.contents('config/default.json', function(err, defaultCfg) {
        if (!err || defaultCfg) {
          var defaultCfgContent = new Buffer(defaultCfg.content, 'base64');
          var defaultCfgConfig = JSON.parse(defaultCfgContent.toString());
          boscoSvcConfig.server = defaultCfgConfig.server || {};
        }
        if (!boscoSvcConfig.service || boscoSvcConfig.service.type !== 'docker') {
          boscoSvcConfig.service = _.defaults(boscoSvcConfig.service, getServiceDockerConfig(svcConfig, boscoSvcConfig));
        }
        bosco.config.set(configKey, boscoSvcConfig);
        bosco.config.save(function() {
          next(null, boscoSvcConfig);
        });
      });
    });
  }
}

function getRunConfig(bosco, repo, watchRegex, next) {
  var repoPath = bosco.getRepoPath(repo);
  var watch = repo.match(watchRegex) ? true : false;
  var packageJson = [repoPath, 'package.json'].join('/');
  var boscoService = [repoPath, 'bosco-service.json'].join('/');
  var svcConfig = {
    name: repo,
    cwd: repoPath,
    watch: watch,
    order: 50,
    service: {},
  };
  var pkg;
  var svc;

  if (bosco.exists(packageJson)) {
    pkg = require(packageJson);
    var packageConfig = {};
    if (pkg.scripts && pkg.scripts.start) {
      packageConfig.type = 'node';
      packageConfig.start = pkg.scripts.start;
    }
    if (pkg.engines && pkg.engines.node) {
      packageConfig.nodeVersion = pkg.engines.node;
    }
    svcConfig.service = packageConfig;
  }

  if (bosco.exists(boscoService)) {
    svc = require(boscoService);
    svcConfig = _.extend(svcConfig, {
      tags: svc.tags,
      order: svc.order,
    });
    if (svc.service) {
      svcConfig.service = _.extend(svcConfig.service, svc.service);
    }
  }

  svcConfig.service.type = svcConfig.service.type || 'remote';

  if (svcConfig.service.type === 'remote') {
    getServiceConfigFromGithub(bosco, repo, svcConfig, next);
  } else {
    next(null, svcConfig);
  }
}

function getRunList(bosco, repos, repoRegex, watchRegex, repoTag, displayOnly, next) {
  var configs = {};
  var tree = {};

  function isCurrentService(repo) {
    return (bosco.options.inService && repo === bosco.options.inServiceRepo);
  }

  function notCurrentService(repo) {
    return !isCurrentService(repo);
  }

  function matchesRegexOrTag(repo, tags) {
    var isModule = repo.indexOf('module-') >= 0;
    return !isModule && (!repoTag && repo.match(repoRegex)) || (repoTag && _.includes(tags, repoTag));
  }

  function boscoOptionFilter(option, fn) {
    if (bosco.options[option]) return fn;
    return function() {
      return true;
    };
  }

  function getConfig(repo) {
    return configs[repo] || { name: repo, service: { type: 'unknown' } };
  }

  function isType(type) {
    return function(repo) {
      return getConfig(repo).service.type === type;
    };
  }

  function matchingRepo(repo) {
    var config = getConfig(repo);
    return matchesRegexOrTag(repo, config.tags);
  }

  // in order to understand recursion one must understand recursion
  function resolveDependencies(repoList, resolved, cb) {
    async.reduce(repoList, resolved, function(memo, repo, cb2) {
      if (_.includes(memo, repo)) {
        return cb2(null, memo);
      }
      memo.push(repo);
      getRunConfig(bosco, repo, watchRegex, function(err, svcConfig) {
        if (err) { return cb2(err); }
        configs[repo] = svcConfig;
        if (svcConfig && svcConfig.service && svcConfig.service.dependsOn) {
          resolveDependencies(svcConfig.service.dependsOn, memo, cb2);
        } else {
          cb2(null, memo);
        }
      });
    }, function(err, result) {
      return cb(null, result);
    });
  }

  function getOrder(config) {
    return config.order || (_.includes(['docker', 'docker-compose'], config.service.type) ? 100 : 500);
  }

  function createTree(parent, repo) {
    var repoConfig = getCachedConfig(bosco, repo);
    var isService = repo.indexOf('service-') >= 0;
    var isApp = repo.indexOf('app-') >= 0;
    var isRemote = repoConfig.service.type === 'remote';
    var repoName = isRemote ? repo + '*' : repo;

    if (isRemote && (isService || isApp)) {
      // Not typical to have remote services or apps
      repoName = repoName.red;
    } else if (isRemote) {
      repoName = repoName.grey;
    } else if (isApp && !isRemote) {
      repoName = repoName.green;
    } else if (isService && !isRemote) {
      repoName = repoName.blue;
    }
    parent[repoName] = {};
    return _.map(getCachedConfig(bosco, repo).service.dependsOn, _.curry(createTree)(parent[repoName]));
  }

  resolveDependencies(repos, [], function(err, repoList) {
    var runList = _.chain(repoList)
      .filter(matchingRepo)
      .filter(boscoOptionFilter('deps-only', notCurrentService))
      .filter(boscoOptionFilter('docker-only', isType('remote')))
      .map(getConfig)
      .sortBy(getOrder)
      .value();

    if (displayOnly) {
      _.chain(repoList)
        .filter(matchingRepo)
        .map(_.curry(createTree)(tree))
        .value();
      /* eslint-disable no-console */
      console.log(treeify.asTree(tree));
      /* eslint-disable no-enable */
      next();
    } else {
      next(null, runList);
    }
  });
}

function getRepoRunList(bosco, repos, repoRegex, watchRegex, repoTag, displayOnly, next) {
  getRunList(bosco, repos, repoRegex, watchRegex, repoTag, displayOnly, function(err, runList) {
    next(null, _.map(runList, function(repo) { return {name: repo.name, type: repo.service.type}; }));
  });
}

module.exports = {
  getRunList: getRunList,
  getRepoRunList: getRepoRunList,
  getServiceConfigFromGithub: getServiceConfigFromGithub,
  getServiceDockerConfig: getServiceDockerConfig,
};
