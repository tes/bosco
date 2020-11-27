const async = require('async');
const _ = require('lodash');
const path = require('path');
const traverse = require('traverse');
const semver = require('semver');

module.exports = {
  name: 'remote',
  description: 'Checks your projects for any references to non local environments or versions of dependencies that dont work offline',
  cmd(bosco) {
    // The attached is unashamedly default TES config, you need to replace it with your own in the bosco.config
    const defaultConfig = {
      localConfigurationFiles: ['default.json', 'local.json', 'test.json'],
      likelyHostConfig: '([^v]host|url)',
      notLocalConnectionString: '(development|staging|live)',
      modules: {
        'module-tsl-logger': '^0.2.41',
        'electric-metrics': '^0.0.15',
      },
    };

    const remoteConfig = bosco.config.get('remote') || defaultConfig;

    const repos = bosco.getRepos();
    if (!repos) return bosco.error('You are repo-less :( You need to initialise bosco first, try \'bosco clone\'.');

    function checkRemoteConnectionStrings(repo, repoPath, next) {
      let localProblems = false;
      const mergedConfig = _.reduce(remoteConfig.localConfigurationFiles, (merged, configFile) => {
        const configFilePath = path.join(repoPath, 'config', configFile);
        let newConfig;
        if (bosco.exists(configFilePath)) {
          const config = require(path.join(repoPath, 'config', configFile)); // eslint-disable-line global-require,import/no-dynamic-require
          newConfig = _.defaultsDeep(merged, config);
        } else {
          newConfig = merged;
        }
        return newConfig;
      }, {});

      traverse(mergedConfig).forEach((item) => {
        const currentPath = this.path.join('.');
        if (currentPath.match(remoteConfig.likelyHostConfig)) {
          if (typeof item === 'string') {
            if (item.match(remoteConfig.notLocalConnectionString)) {
              localProblems = true;
              bosco.warn(`Host problem in ${repo.cyan} at config ${currentPath.green} of ${item.yellow}`);
            }
          }
        }
      });

      next(null, localProblems);
    }

    function checkModuleVersions(repo, repoPath, next) {
      let localProblems = false;
      const packageJsonPath = path.join(repoPath, 'package.json');
      if (bosco.exists(packageJsonPath)) {
        const pkgJson = require(packageJsonPath); // eslint-disable-line global-require,import/no-dynamic-require
        _.forEach(remoteConfig.modules, (version, module) => {
          const repoModuleVersion = (pkgJson.dependencies && pkgJson.dependencies[module]) || (pkgJson.devDependencies && pkgJson.devDependencies[module]);
          if (repoModuleVersion && repoModuleVersion !== 'latest') {
            const satisfies = !semver.lt(repoModuleVersion.replace('^', ''), version.replace('^', ''));
            if (!satisfies) {
              localProblems = true;
              bosco.warn(`Module problem in ${repo.cyan} with ${module.green}, please upgrade ${repoModuleVersion.yellow} >> ${version.yellow}`);
            }
          }
        });
      }
      next(null, localProblems);
    }

    function checkRepos() {
      let localProblems = false;
      async.mapSeries(repos, (repo, repoCb) => {
        const repoPath = bosco.getRepoPath(repo);
        checkRemoteConnectionStrings(repo, repoPath, (err, localConnectionProblems) => {
          localProblems = localProblems || localConnectionProblems;
          checkModuleVersions(repo, repoPath, (moduleErr, localModuleProblems) => {
            localProblems = localProblems || localModuleProblems;
            repoCb();
          });
        });
      }, () => {
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
