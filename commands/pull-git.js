var async = require('async');
var exec = require('child_process').exec;
var NodeRunner = require('../src/RunWrappers/Node');
var RunListHelper = require('../src/RunListHelper');
var CmdHelper = require('../src/CmdHelper');
var _ = require('lodash');
var green = '\u001b[42m \u001b[0m';
var red = '\u001b[41m \u001b[0m';

module.exports = {
  name: 'pull-git',
  description: 'Pulls any changes from git repos',
  usage: '[-r <repoPattern>]',
};

function checkCurrentBranch(bosco, repoPath, next) {
  if (!bosco.exists(repoPath)) {
    return next();
  }

  if (!bosco.exists([repoPath, '.git'].join('/'))) {
    return next();
  }

  exec('git rev-parse --abbrev-ref HEAD', {
    cwd: repoPath,
  }, function(err, stdout, stderr) {
    if (err) {
      bosco.error(repoPath.blue + ' >> ' + stderr);
    } else {
      if (stdout) {
        var branch = stdout.replace(/(\r\n|\n|\r)/gm, '');
        if (branch !== 'master') {
          bosco.warn(repoPath.yellow + ': ' + 'Is not on master, it is on ' + branch.cyan);
        }
      }
    }
    next();
  });
}

function pull(bosco, progressbar, bar, repoPath, next) {
  if (!bosco.exists([repoPath, '.git'].join('/'))) {
    return next();
  }

  exec('git pull --rebase', {
    cwd: repoPath,
  }, function(err, stdout, stderr) {
    if (progressbar) bar.tick();
    if (err) {
      if (progressbar) bosco.console.log('');
      bosco.error(repoPath.blue + ' >> ' + stderr);
    } else {
      if (!progressbar && stdout) {
        if (stdout.indexOf('up to date') > 0) {
          bosco.log(repoPath.blue + ': ' + 'No change'.green);
        } else {
          bosco.log(repoPath.blue + ': ' + 'Pulling changes ...'.red + '\n' + stdout);
        }
      }
    }
    next();
  });
}

function cmd(bosco, args, next) {
  var repoPattern = bosco.options.repo;
  var repoRegex = new RegExp(repoPattern);
  var watchNothing = '$a';

  CmdHelper.checkInService(bosco);
  var repos = bosco.getRepos();

  if (!repos) return bosco.error('You are repo-less :( You need to initialise bosco first, try \'bosco clone\'.');

  bosco.log('Running ' + 'git pull --rebase'.blue + ' across all repos ...');

  function pullRepos(cb) {
    var progressbar = bosco.config.get('progress') === 'bar';
    var total = repos.length;

    var bar = progressbar ? new bosco.Progress('Doing git pull [:bar] :percent :etas', {
      complete: green,
      incomplete: red,
      width: 50,
      total: total,
    }) : null;

    async.mapLimit(repos, 1, function repoStash(repo, repoCb) {
      if (!repo) return repoCb();
      if (!repo.match(repoRegex)) return repoCb();
      var repoPath = bosco.getRepoPath(repo);
      checkCurrentBranch(bosco, repoPath, function() {
        pull(bosco, progressbar, bar, repoPath, repoCb);
      });
    }, function() {
      cb();
    });
  }

  function ensureNodeVersions(cb) {
    bosco.log('Ensuring required node version is installed as per .nvmrc ...');
    async.mapSeries(repos, function checkInterpreter(repo, repoCb) {
      var repoPath = bosco.getRepoPath(repo);
      NodeRunner.getInterpreter(bosco, { name: repo, cwd: repoPath }, function(err) {
        if (err) {
          bosco.error(err);
        }
        return repoCb();
      });
    }, function() {
      cb();
    });
  }

  function clearGithubCache(cb) {
    var configKey = 'cache:github';
    bosco.config.set(configKey, {});
    bosco.config.save(cb);
  }

  function setRunRepos(cb) {
    if (!CmdHelper.checkInService(bosco)) {
      return cb();
    }

    RunListHelper.getRepoRunList(bosco, bosco.getRepos(), repoRegex, watchNothing, null, false, function(err, runRepos) {
      repos = _.chain(runRepos)
                .filter(function(repo) { return repo.type !== 'remote'; })
                .map('name')
                .value();
      cb(err);
    });
  }

  async.series([
    setRunRepos,
    pullRepos,
    ensureNodeVersions,
    clearGithubCache,
  ], function() {
    bosco.log('Complete!');
    if (next) next();
  });
}

module.exports.cmd = cmd;
