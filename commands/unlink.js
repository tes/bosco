var _ = require('lodash');
var path = require('path');
var fs = require('fs');
var async = require('async');
var util = require('util');
var exec = require('child_process').exec;

module.exports = {
  name: 'unlink',
  usage: '[--dry-run]',
  description: 'Automatically npm unlinks all projects in a workspace',
  options: [
    {
      name: 'dry-run',
      type: 'boolean',
      desc: 'Print commands without unlinking'
    }
  ],
  cmd: function(bosco, args, next) {
    var repoPattern = bosco.options.repo;
    var repoRegex = repoPattern && new RegExp(repoPattern);

    var repos = bosco.getRepos();
    var packageRepos = {};
    var dependencyMap = {};
    var dependentsMap = {};

    var addDependency = function addDependency(dependency, dependent) {
      if (!(dependency in dependencyMap)) {
        dependencyMap[dependency] = [];
      }

      if (!(dependent in dependentsMap)) {
        dependentsMap[dependent] = [];
      }

      dependencyMap[dependency].push(dependent);
      dependentsMap[dependent].push(dependency);
    };

    async.map(repos, function(repo, next) {
      var repoPath = bosco.getRepoPath(repo);
      var repoPackage = path.join(repoPath, 'package.json');

      fs.readFile(path.join(repoPath, 'package.json'), function(err, data) {
        if (err) {
          bosco.log(util.format('skipping %s', repo));
          return next();
        }

        var packageJson;
        try {
          packageJson = JSON.parse(data.toString());
        } catch (err) {
          bosco.log('failed to parse json from %s', repoPackage);
          return next();
        }

        packageRepos[packageJson.name] = repo;

        for (var dependency in packageJson.dependencies) {
          addDependency(dependency, packageJson.name);
        }

        for (var devDependency in packageJson.devDependencies) {
          addDependency(devDependency, packageJson.name);
        }

        return next();
      });
    }, function(err) {
      if (err) {
        return next(err);
      }

      var packageCount = Object.keys(packageRepos).length;
      var packageDiff = packageCount;
      var commands = [];

      function isSelected(packageName) {
        if (!(packageName in packageRepos)) {
          return false;
        }

        var repo = packageRepos[packageName];

        if (!repoRegex) {
          return true;
        }

        return repoRegex.test(repo);
      }

      function removeDependents(install, dependency) {
        var index = dependencyMap[dependency].indexOf(packageName);

        if (index === -1) {
          return install;
        }

        dependencyMap[dependency].splice(index, 1);

        if (isSelected(dependency)) {
          commands.push([packageName, util.format('npm unlink %s', dependency), {cwd: repoPath}]);
          return true;
        }

        return install;
      }

      while (packageDiff !== 0 && packageCount > 0) {
        bosco.log(util.format('%s packages remain', packageCount));

        for (var packageName in packageRepos) {
          var repo = packageRepos[packageName];
          var repoPath = bosco.getRepoPath(repo);

          if (packageName in dependencyMap && dependencyMap[packageName].length > 0) {
            continue;
          }

          delete packageRepos[packageName];

          if (isSelected(packageName)) {
            commands.push([packageName, 'npm unlink', {cwd: repoPath}]);
          }

          if (packageName in dependentsMap) {
            var isInstallRequired = _.reduce(dependentsMap[packageName], removeDependents, false);

            if (isInstallRequired) {
              commands.push([packageName, 'npm install', {cwd: repoPath}]);
            }
          }
        }

        packageDiff = Object.keys(packageRepos).length - packageCount;
        packageCount = Object.keys(packageRepos).length;
      }

      async.mapSeries(commands, function(cmd, next) {
        var packageName = cmd[0];
        var command = cmd[1];
        var options = cmd[2];

        bosco.log(util.format('%s %s', packageName.blue, command));

        if (bosco.options.program.dryRun) {
          return next();
        }

        exec(command, options, function(err, stdout, stderr) {
          if (err) {
            return next(err);
          }

          process.stdout.write(stdout);
          process.stderr.write(stderr);

          return next();
        });
      }, function(err) {
        if (err) {
          if (next) {
            return next(err);
          }

          throw err;
        }

        bosco.log('Complete');
        return next && next();
      });
    });
  }
};
