
var _ = require('lodash');
var github = require('octonode');

function getRunConfig(bosco, repo, repoRegex, watchRegex) {
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

function getRunList(bosco, repos, repoRegex, watchRegex, repoTag, next) {
  var depTree = {};
  var repoList = [];
  var runList = [];
  var svcConfig;

  function addDependencies(dependent, dependsOn) {
    dependsOn.forEach(function(dependency) {
      if (!dependency) {
        return;
      }

      if (!_.contains(repoList, dependency)) {
        repoList.push(dependency);
      }
    });
  }

  // First build the tree and filtered core list
  repos.forEach(function(repo) {
    svcConfig = getRunConfig(bosco, repo, repoRegex, watchRegex);
    depTree[svcConfig.name] = svcConfig;
    var matchesRegexOrTag = (!repoTag && repo.match(repoRegex)) || (repoTag && _.contains(svcConfig.tags, repoTag));
    if (matchesRegexOrTag) {
      repoList.push(repo);
    }
  });

  // Now iterate, but use the dependency tree to build the run list
  while (repoList.length > 0) {
    var currentRepo = repoList.shift();
    svcConfig = depTree[currentRepo];
    if (svcConfig && svcConfig.service) {
      runList.push(svcConfig);
      if (svcConfig.service.dependsOn) {
        addDependencies(currentRepo, svcConfig.service.dependsOn);
      }
    } else {
      // This is likely to be a remote infra dependency, so lets create a dummy one.
      svcConfig = getRunConfig(bosco, currentRepo, null, '$^');
      runList.push(svcConfig);
    }
  }

  // Uniq and sort
  runList = _.chain(runList)
    .uniq(function(item) { return item.name; })
    .sortBy(function(item) {
      if (item.order) return item.order;
      return (item.service.type === 'docker' || item.service.type === 'docker-compose') ? 100 : 500;
    }).value();

  next(null, runList);
}

function getServiceConfigFromGithub(bosco, repo, next) {
  var team = bosco.getTeam();
  var organisation = team.split('/')[0];
  var client = github.client(bosco.config.get('github:authToken'));
  var githubRepo = organisation + '/' + repo;
  var configKey = 'cache:github:' + githubRepo;
  var cachedConfig = bosco.config.get(configKey);

  if (cachedConfig) {
    next(null, cachedConfig);
  } else {
    var ghrepo = client.repo(githubRepo);
    bosco.log('Retrieving ' + 'bosco-service.json'.green + ' config from github @ ' + githubRepo.cyan);
    ghrepo.contents('bosco-service.json', function(err, contents) {
      if (err) { return next(err); }
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
  getRunList: getRunList,
  getServiceConfigFromGithub: getServiceConfigFromGithub,
};
