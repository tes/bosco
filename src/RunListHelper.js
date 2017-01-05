
var _ = require('lodash');
var github = require('octonode');
var async = require('async');
var treeify = require('treeify');

function getRunConfig(bosco, repo, watchRegex) {
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

  return svcConfig;
}

function getRunList(bosco, repos, repoRegex, watchRegex, repoTag, displayOnly) {
  var configs = {};
  var tree = {};

  function isCurrentService(repo) {
    return (bosco.options.inService && repo === bosco.options.inServiceRepo);
  }

  function getCachedConfig(repo) {
    var config = configs[repo];
    if (config) {
      return config;
    }
    config = configs[repo] = getRunConfig(bosco, repo, watchRegex);
    return config;
  }

  function matchesRegexOrTag(repo, tags) {
    var isModule = repo.indexOf('module-') >= 0;
    return !isModule && (!repoTag && repo.match(repoRegex)) || (repoTag && _.includes(tags, repoTag));
  }

  function notCurrentService(repo) {
    return !(bosco.options['deps-only'] && isCurrentService(repo));
  }

  function isType(repo) {
    return (bosco.options['docker-only'] && isCurrentService(repo));
  }

  function matchingRepo(repo) {
    var config = getCachedConfig(repo);
    return matchesRegexOrTag(repo, config.tags);
  }

  // in order to understand recursion one must understand recursion
  function addDependencies(resolved, repo) {
    if (_.includes(resolved, repo)) {
      return resolved;
    }
    return _.reduce(getCachedConfig(repo).service.dependsOn, addDependencies, resolved.concat(repo || []));
  }

  function getOrder(config) {
    return config.order || (_.includes(['docker', 'docker-compose'], config.service.type) ? 100 : 500);
  }

  function createTree(parent, repo) {
    var repoConfig = getCachedConfig(repo);
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
    return _.map(getCachedConfig(repo).service.dependsOn, _.curry(createTree)(parent[repoName]));
  }

  var runList = _.chain(repos)
    .filter(matchingRepo)
    .reduce(addDependencies, [])
    .filter(notCurrentService)
    .filter(isType)
    .map(getCachedConfig)
    .sortBy(getOrder)
    .value();

  if (displayOnly) {
    _.chain(repos)
      .filter(matchingRepo)
      .map(_.curry(createTree)(tree))
      .value();
    /* eslint-disable no-console */
    console.log(treeify.asTree(tree));
    /* eslint-disable no-enable */
  } else {
    return runList;
  }
}

function getRepoRunList(/* Same arguments as above */) {
  return _.map(getRunList.apply(null, arguments), function(repo) { return {name: repo.name, type: repo.service.type}; });
}

function getServiceConfigFromGithub(bosco, repo, next) {
  var team = bosco.getTeam();
  if (team === 'no-team') {
    return next();
  }
  var organisation = team.split('/')[0];
  var client = github.client(bosco.config.get('github:authToken'), {hostname: bosco.config.get('github:apiHostname')});
  var githubRepo = organisation + '/' + repo;
  var configKey = 'cache:github:' + githubRepo;
  var cachedConfig = bosco.config.get(configKey);
  if (cachedConfig) {
    next(null, cachedConfig);
  } else {
    var ghrepo = client.repo(githubRepo);
    ghrepo.contents('bosco-service.json', function(err, contents) {
      if (err) {
        return next(err);
      }
      var content = new Buffer(contents.content, 'base64');
      var config = JSON.parse(content.toString());
      bosco.config.set(configKey, config);
      bosco.config.save(function() {
        next(null, config);
      });
    });
  }
}

module.exports = {
  getRunList: async.asyncify(getRunList),
  getRepoRunList: async.asyncify(getRepoRunList),
  getServiceConfigFromGithub: getServiceConfigFromGithub,
};
