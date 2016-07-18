
var _ = require('lodash');
var github = require('octonode');
var async = require('async');

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

  return svcConfig;
}

function getRunList(bosco, repos, repoRegex, watchRegex, repoTag) {
  var configs = {};

  function getCachedConfig(repo) {
    var config = configs[repo];
    if (config) {
      return config;
    }
    config = configs[repo] = getRunConfig(bosco, repo, watchRegex);
    return config;
  }

  function matchesRegexOrTag(repo, tags) {
    return (!repoTag && repo.match(repoRegex)) || (repoTag && _.includes(tags, repoTag));
  }

  function notCurrentService(repo) {
    return !(bosco.options.inService && bosco.options.dont && repo === bosco.options.inServiceRepo);
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

  return _.chain(repos)
    .filter(matchingRepo)
    .reduce(addDependencies, [])
    .filter(notCurrentService)
    .map(getCachedConfig)
    .sortBy(getOrder)
    .value();
}

function getRepoRunList(/* Same arguments as above */) {
  return _.map(getRunList.apply(null, arguments), 'name');
}

function getServiceConfigFromGithub(bosco, repo, next) {
  var team = bosco.getTeam();
  var organisation = team.split('/')[0];
  var client = github.client(bosco.config.get('github:authToken'), {hostname: bosco.config.get('github:apiHostname')});
  var githubRepo = organisation + '/' + repo;
  var configKey = 'cache:github:' + githubRepo;
  var cachedConfig = bosco.config.get(configKey);

  if (cachedConfig) {
    next(null, cachedConfig);
  } else {
    var ghrepo = client.repo(githubRepo);
    bosco.log('Retrieving ' + 'bosco-service.json'.green + ' config from github @ ' + githubRepo.cyan);
    ghrepo.contents('bosco-service.json', function(err, contents) {
      if (err) {
        bosco.log('Failed to get service config - does bosco have access?', err);
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
