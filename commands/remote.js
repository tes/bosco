var async = require('async');
var _ = require('lodash');
var path = require('path');
var traverse = require('traverse');
var semver = require('semver');

module.exports = {
  name: 'remote',
  description: 'Checks your projects for any references to non local environments or versions of dependencies that dont work offline',
  cmd: function(bosco) {
    // The attached is unashamedly default TES config, you need to replace it with your own in the bosco.config
    var defaultConfig = {
      localConfigurationFiles: ['default.json', 'local.json'],
      likelyHostConfig: '(host)',
      localConnectionString: '(local|127\.0\.0\.1|0\.0\.0\.0)',
      modules: {
        'module-tsl-logger': '^0.2.41',
        'electric-metrics': '^0.0.15',
      },
    };

    var remoteConfig = bosco.config.get('remote') || defaultConfig;

    var repos = bosco.getRepos();
    if (!repos) return bosco.error('You are repo-less :( You need to initialise bosco first, try \'bosco clone\'.');

    function checkRemoteConnectionStrings(repo, repoPath, next) {
      var localProblems = false;
      var mergedConfig = _.reduce(remoteConfig.localConfigurationFiles, function(merged, configFile) {
        var configFilePath = path.join(repoPath, 'config', configFile);
        var newConfig;
        if (bosco.exists(configFilePath)) {
          var config = require(path.join(repoPath, 'config', configFile));
          newConfig = _.defaultsDeep(merged, config);
        } else {
          newConfig = merged;
        }
        return newConfig;
      }, {});

      traverse(mergedConfig).forEach(function(item) {
        var currentPath = this.path.join('.');
        if (currentPath.match(remoteConfig.likelyHostConfig)) {
          if (typeof item === 'string') {
            if (!item.match(remoteConfig.localConnectionString)) {
              localProblems = true;
              bosco.warn('Host problem in ' + repo.cyan + ' at config ' + currentPath.green + ' of ' + item.yellow);
            }
          }
        }
      });

      next(null, localProblems);
    }

    function checkModuleVersions(repo, repoPath, next) {
      var localProblems = false;
      var packageJsonPath = path.join(repoPath, 'package.json');
      if (bosco.exists(packageJsonPath)) {
        var pkgJson = require(packageJsonPath);
        _.forEach(remoteConfig.modules, function(version, module) {
          var repoModuleVersion = pkgJson.dependencies[module] || pkgJson.devDependencies[module];
          if (repoModuleVersion && repoModuleVersion !== 'latest') {
            var satisfies = semver.gt(repoModuleVersion.replace('^', ''), version.replace('^', ''));
            if (!satisfies) {
              bosco.warn('Module problem in ' + repo.cyan + ' with ' + module.green + ', please upgrade ' + repoModuleVersion.yellow + ' >> ' + version.yellow);
            }
          }
        });
      }
      next(null, localProblems);
    }

    function checkRepos() {
      var localProblems = false;
      async.mapSeries(repos, function repoStash(repo, repoCb) {
        var repoPath = bosco.getRepoPath(repo);
        checkRemoteConnectionStrings(repo, repoPath, function(err, localConnectionProblems) {
          localProblems = localProblems || localConnectionProblems;
          checkModuleVersions(repo, repoPath, function(err, localModuleProblems) {
            localProblems = localProblems || localModuleProblems;
            repoCb();
          });
        });
      }, function() {
        if (localProblems) {
          bosco.error('Resolve the problems above or you\'re ... err ... going to have problems :(');
        } else {
          bosco.log('You are good to go, unplug and enjoy your flight!');
        }
      });
    }

    checkRepos();
  },

};
