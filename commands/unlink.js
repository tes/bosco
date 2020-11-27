const _ = require('lodash');
const path = require('path');
const fs = require('fs');
const async = require('async');
const util = require('util');
const { exec } = require('child_process');

module.exports = {
  name: 'unlink',
  usage: '[--dry-run]',
  description: 'Automatically npm unlinks all projects in a workspace',
  options: [
    {
      name: 'dry-run',
      type: 'boolean',
      desc: 'Print commands without unlinking',
    },
  ],
};

function cmd(bosco, args, done) {
  const repoPattern = bosco.options.repo;
  const repoRegex = repoPattern && new RegExp(repoPattern);

  const repos = bosco.getRepos();
  const packageRepos = {};
  const dependencyMap = {};
  const dependentsMap = {};
  const next = done || ((err) => { throw err; });

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
    async.mapSeries(commands, (commandArgs, cb) => {
      const packageName = commandArgs[0];
      const command = commandArgs[1];
      const options = commandArgs[2];

      bosco.log(util.format('%s %s', packageName.blue, command));

      if (bosco.options.program.dryRun) return cb();

      exec(command, options, (err, stdout, stderr) => {
        if (err) return cb(err);

        process.stdout.write(stdout);
        process.stderr.write(stderr);

        return cb();
      });
    }, (err) => {
      if (err) return next(err);

      bosco.log('Complete');
      next();
    });
  }

  async.map(repos, (repo, cb) => {
    const repoPath = bosco.getRepoPath(repo);
    const repoPackage = path.join(repoPath, 'package.json');

    fs.readFile(path.join(repoPath, 'package.json'), (readErr, data) => {
      if (readErr) {
        bosco.log(util.format('skipping %s', repo));
        return cb();
      }

      let packageJson;
      try {
        packageJson = JSON.parse(data.toString());
      } catch (parseErr) {
        bosco.log('failed to parse json from %s', repoPackage);
        return cb();
      }

      packageRepos[packageJson.name] = repo;

      _.forOwn(packageJson.dependencies, (version, dependency) => {
        addDependency(dependency, packageJson.name);
      });

      _.forOwn(packageJson.devDependencies, (version, devDependency) => {
        addDependency(devDependency, packageJson.name);
      });

      return cb();
    });
  }, (err) => {
    if (err) return next(err);

    let packageCount = Object.keys(packageRepos).length;
    let packageDiff = packageCount;
    const commands = [];

    function isSelected(name) {
      if (!(name in packageRepos)) return false;

      const repo = packageRepos[name];

      if (!repoRegex) return true;

      return repoRegex.test(repo);
    }

    function processPackage(name) {
      const repo = packageRepos[name];
      const repoPath = bosco.getRepoPath(repo);

      function removeDependents(install, dependency) {
        const index = dependencyMap[dependency].indexOf(name);

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
        const isInstallRequired = _.reduce(dependentsMap[name], removeDependents, false);

        if (isInstallRequired) {
          commands.push([name, 'npm install', { cwd: repoPath }]);
        }
      }
    }

    function processRepos(repoMap) {
      _.forOwn(repoMap, (repo, name) => {
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
