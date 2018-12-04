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
  ]
};

function cmd(bosco, args, done) {
  var repoPattern = bosco.options.repo;
  var repoRegex = repoPattern && new RegExp(repoPattern);

  var repos = bosco.getRepos();
  var packageRepos = {};
  var dependencyMap = {};
  var dependentsMap = {};
  var next = done || function (err) { throw err; };

  function addDependency(dependency, dependent) {
    if (!(dependency in dependencyMap)) {
      dependencyMap[dependency] = [];
    }

    if (!(dependent in dependentsMap)) {
      dependentsMap[dependent] = [];
    }

    dependencyMap[dependency].push(dependent);
    dependentsMap[dependent].push(dependency);
  }

  function runCommands(commands) {
    async.mapSeries(commands, function (commandArgs, cb) {
      var packageName = commandArgs[0];
      var command = commandArgs[1];
      var options = commandArgs[2];

      bosco.log(util.format('%s %s', packageName.blue, command));

      if (bosco.options.program.dryRun) return cb();

      exec(command, options, function (err, stdout, stderr) {
        if (err) return cb(err);

        process.stdout.write(stdout);
        process.stderr.write(stderr);

        return cb();
      });
    }, function (err) {
      if (err) return next(err);

      bosco.log('Complete');
      next();
    });
  }

  async.map(repos, function (repo, cb) {
    var repoPath = bosco.getRepoPath(repo);
    var repoPackage = path.join(repoPath, 'package.json');

    fs.readFile(path.join(repoPath, 'package.json'), function (err, data) {
      if (err) {
        bosco.log(util.format('skipping %s', repo));
        return cb();
      }

      var packageJson;
      try {
        packageJson = JSON.parse(data.toString());
      } catch (err) {
        bosco.log('failed to parse json from %s', repoPackage);
        return cb();
      }

      packageRepos[packageJson.name] = repo;

      _.forOwn(packageJson.dependencies, function (version, dependency) {
        addDependency(dependency, packageJson.name);
      });

      _.forOwn(packageJson.devDependencies, function (version, devDependency) {
        addDependency(devDependency, packageJson.name);
      });

      return cb();
    });
  }, function (err) {
    if (err) return next(err);

    var packageCount = Object.keys(packageRepos).length;
    var packageDiff = packageCount;
    var commands = [];

    function isSelected(name) {
      if (!(name in packageRepos)) return false;

      var repo = packageRepos[name];

      if (!repoRegex) return true;

      return repoRegex.test(repo);
    }

    function processPackage(name) {
      var repo = packageRepos[name];
      var repoPath = bosco.getRepoPath(repo);

      function removeDependents(install, dependency) {
        var index = dependencyMap[dependency].indexOf(name);

        if (index === -1) return install;

        dependencyMap[dependency].splice(index, 1);

        if (isSelected(dependency)) {
          commands.push([name, util.format('npm unlink %s', dependency), { cwd: repoPath }]);
          return true;
        }

        return install;
      }

      if (name in dependencyMap && dependencyMap[name].length > 0) {
        return;
      }

      delete packageRepos[name];

      if (isSelected(name)) {
        commands.push([name, 'npm unlink', { cwd: repoPath }]);
      }

      if (name in dependentsMap) {
        var isInstallRequired = _.reduce(dependentsMap[name], removeDependents, false);

        if (isInstallRequired) {
          commands.push([name, 'npm install', { cwd: repoPath }]);
        }
      }
    }

    function processRepos(repoMap) {
      _.forOwn(repoMap, function (repo, name) {
        processPackage(name);
      });
    }

    while (packageDiff !== 0 && packageCount > 0) {
      bosco.log(util.format('%s packages remain', packageCount));

      processRepos(packageRepos);

      packageDiff = Object.keys(packageRepos).length - packageCount;
      packageCount = Object.keys(packageRepos).length;
    }

    runCommands(commands);
  });
}

module.exports.cmd = cmd;
