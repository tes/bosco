var async = require('async');
var exec = require('child_process').exec;
var NodeRunner = require('../src/RunWrappers/Node');
var CmdHelper = require('../src/CmdHelper');
var RunListHelper = require('../src/RunListHelper');
var _ = require('lodash');
var green = '\u001b[42m \u001b[0m';
var red = '\u001b[41m \u001b[0m';
var reposToInstall = [];

function isYarnUsed(bosco, repoPath) {
  var yarnrcFile = [repoPath, '.yarnrc'].join('/');
  var yarnLockFile = [repoPath, 'yarn.lock'].join('/');
  return bosco.exists(yarnrcFile) || bosco.exists(yarnLockFile);
}

function getPackageManager(bosco, repoPath, interpreter) {
  var nvm = interpreter && bosco.options.nvmUse || bosco.options.nvmUseDefault;
  var name;
  var command;
  if (isYarnUsed(bosco, repoPath)) {
    name = 'Yarn';
    command = 'yarn --pure-lockfile';
  } else {
    name = 'NPM';
    command = 'npm';
    if (bosco.config.get('npm:registry')) {
      command += ' --registry ' + bosco.config.get('npm:registry');
    }
    command += ' install';
  }
  return {name: name, command: nvm + command};
}

function cleanModulesIfVersionChanged(bosco, repoPath, repo, next) {
  NodeRunner.getVersion(bosco, {cwd: repoPath}, function(err, currentVersion) {
    if (err) { return next(err); }
    var nodeVersionKey = 'teams:' + bosco.getTeam() + ':nodes:' + repo;
    var lastVersion = bosco.config.get(nodeVersionKey);
    if (lastVersion && lastVersion !== currentVersion) {
      bosco.prompt.start();
      var confirmationDescription = 'Node version in '.white + repo.cyan + ' has changed from '.white + lastVersion.green + ' to '.white + currentVersion.green + ', should I clear node_modules (y/N)?'.white;
      bosco.prompt.get({
        properties: {
          confirm: {
            description: confirmationDescription,
          },
        },
      }, function(err, result) {
        if (!result || (result.confirm !== 'Y' && result.confirm !== 'y')) {
          return next();
        }

        exec('rm -rf ./node_modules', {cwd: repoPath}, function(err, stdout, stderr) {
          if (err) {
            bosco.error('Failed to clear node_modules for ' + repoPath.blue + ' >> ' + stderr);
          } else {
            bosco.log('Node version in ' + repo.green + ' updated to ' + currentVersion.green);
            bosco.config.set(nodeVersionKey, currentVersion);
          }
          next();
        });
      });
    } else {
      bosco.log('Node version in ' + repo.green + ' is OK at ' + currentVersion.green);
      bosco.config.set(nodeVersionKey, currentVersion);
      next();
    }
  });
}

function shouldInstallRepo(bosco, repoPath, repo, next) {
  NodeRunner.getHashes(bosco, ['package.json', '.nvmrc', 'yarn.lock', 'package-lock.json'], {cwd: repoPath}, function(err, currentHash) {
    if (err) { return next(err); }
    var nodeHashKey = 'teams:' + bosco.getTeam() + ':hashes:' + repo;
    var lastHash = bosco.config.get(nodeHashKey);
    if (lastHash !== currentHash) {
      reposToInstall.push(repo);
      bosco.config.set(nodeHashKey, currentHash);
    }
    next();
  });
}

function install(bosco, progressbar, bar, repoPath, repo, next) {
  var packageJson = [repoPath, 'package.json'].join('/');
  if (!bosco.exists(packageJson)) {
    if (progressbar) bar.tick();
    return next();
  }

  NodeRunner.getInterpreter(bosco, {name: repo, cwd: repoPath}, function(err, interpreter) {
    if (err) {
      bosco.error(err);
      return next();
    }

    var packageManager = getPackageManager(bosco, repoPath, interpreter);
    exec(packageManager.command, {
      cwd: repoPath,
    }, function(err, stdout, stderr) {
      if (progressbar) bar.tick();
      if (err) {
        if (progressbar) bosco.console.log('');
        bosco.error(repoPath.blue + ' >> ' + stderr);
      } else {
        if (!progressbar) {
          if (!stdout) {
            bosco.log(packageManager.name + ' install for ' + repoPath.blue + ': ' + 'No changes'.green);
          } else {
            bosco.log(packageManager.name + ' install for ' + repoPath.blue);
            bosco.console.log(stdout);
            if (stderr) {
              bosco.error(stderr);
            }
          }
        }
      }
      next();
    });
  });
}

function cmd(bosco, args, next) {
  var repoPattern = bosco.options.repo;
  var repoRegex = new RegExp(repoPattern);

  var repos = bosco.getRepos();
  if (!repos) return bosco.error('You are repo-less :( You need to initialise bosco first, try \'bosco clone\'.');

  bosco.log('Running install across repos ...');

  function setRunRepos(cb) {
    if (!CmdHelper.checkInService(bosco)) {
      return cb();
    }

    RunListHelper.getRepoRunList(bosco, bosco.getRepos(), repoRegex, '$^', null, false, function(err, runRepos) {
      repos = _.chain(runRepos)
              .filter(function(repo) { return repo.type !== 'docker'; })
              .map('name')
              .value();
      cb(err);
    });
  }

  function shouldInstallRepos(cb) {
    async.mapSeries(repos, function repoCheck(repo, repoCb) {
      if (!repo.match(repoRegex)) { return repoCb(); }
      var repoPath = bosco.getRepoPath(repo);
      shouldInstallRepo(bosco, repoPath, repo, repoCb);
    }, function() {
      if (reposToInstall.length > 0) {
        bosco.log('The following repos had changes in key files, so will trigger an install: ');
        bosco.log(reposToInstall.join(', ').cyan);
      }
      cb();
    });
  }

  function checkRepos(cb) {
    async.mapSeries(reposToInstall, function repoCheck(repo, repoCb) {
      if (!repo.match(repoRegex)) return repoCb();
      var repoPath = bosco.getRepoPath(repo);
      cleanModulesIfVersionChanged(bosco, repoPath, repo, repoCb);
    }, function() {
      cb();
    });
  }

  function installRepos(cb) {
    var progressbar = bosco.config.get('progress') === 'bar';
    var total = repos.length;

    var bar = progressbar ? new bosco.Progress('Doing npm install [:bar] :percent :etas', {
      complete: green,
      incomplete: red,
      width: 50,
      total: total,
    }) : null;

    async.mapLimit(reposToInstall, bosco.concurrency.cpu, function repoInstall(repo, repoCb) {
      if (!repo.match(repoRegex)) return repoCb();
      var repoPath = bosco.getRepoPath(repo);
      install(bosco, progressbar, bar, repoPath, repo, repoCb);
    }, function() {
      cb();
    });
  }

  function saveConfig(cb) {
    bosco.config.save(cb);
  }

  async.series([
    setRunRepos,
    shouldInstallRepos,
    checkRepos,
    installRepos,
    saveConfig,
  ], function() {
    bosco.log('npm install complete');
    if (next) next();
  });
}

module.exports = {
  name: 'install',
  description: 'Runs npm install against all repos',
  usage: '[-r <repoPattern>]',
  requiresNvm: true,
  cmd: cmd,
};
