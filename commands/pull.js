var async = require('async');
var _ = require('lodash');
var exec = require('child_process').exec;
var DockerRunner = require('../src/RunWrappers/Docker');
var RunListHelper = require('../src/RunListHelper');
var NodeRunner = require('../src/RunWrappers/Node');
var green = '\u001b[42m \u001b[0m';
var red = '\u001b[41m \u001b[0m';

module.exports = {
  name: 'pull',
  description: 'Pulls any changes across all repos',
  usage: '[-r <repoPattern>]',
  options: [{
    name: 'noremote',
    alias: 'nr',
    type: 'boolean',
    desc: 'Do not pull docker images for remote repositories (dependencies)',
  }],
};

function checkCurrentBranch(bosco, repoPath, next) {
  if (!bosco.exists([repoPath, '.git'].join('/'))) {
    bosco.warn('Doesn\'t seem to be a git repo: ' + repoPath.blue);
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
    bosco.warn('Doesn\'t seem to be a git repo: ' + repoPath.blue);
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

function dockerPullService(bosco, definition, next) {
  if (definition.service && definition.service.type === 'docker') {
    DockerRunner.update(definition, function(err) {
      if (err) {
        var errMessage = err.reason ? err.reason : err;
        bosco.error('Error pulling ' + definition.name + ', reason: ' + errMessage);
      }
      next();
    });
  } else {
    return next();
  }
}

function dockerPullRemote(bosco, repos, runConfig, next) {
  var isLocalService = !!(runConfig.service && runConfig.service.type);
  var isLocalRepo = _.contains(repos, runConfig.name);
  if (isLocalService || isLocalRepo) { return next(); }
  RunListHelper.getServiceConfigFromGithub(bosco, runConfig.name, function(err, svcConfig) {
    if (err) { return next(); }
    if (!svcConfig.name) {
      svcConfig.name = runConfig.name;
    }
    dockerPullService(bosco, svcConfig, next);
  });
}

function dockerPull(bosco, progressbar, bar, repoPath, repo, next) {
  var boscoService = [repoPath, 'bosco-service.json'].join('/');
  if (bosco.exists(boscoService)) {
    var definition = require(boscoService);
    dockerPullService(bosco, definition, next);
  } else {
    return next();
  }
}

function cmd(bosco, args, next) {
  var repoPattern = bosco.options.repo;
  var repoRegex = new RegExp(repoPattern);
  var watchNothing = '$a';
  var noRemote = bosco.options.noremote;

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

    async.mapLimit(repos, bosco.concurrency.network, function repoStash(repo, repoCb) {
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
    async.mapSeries(repos, function doDockerPull(repo, repoCb) {
      var repoPath = bosco.getRepoPath(repo);
      NodeRunner.getInterpreter(bosco, {name: repo, cwd: repoPath}, function(err) {
        if (err) {
          bosco.error(err);
        }
        return repoCb();
      });
    }, function() {
      cb();
    });
  }

  function pullDockerImages(cb) {
    bosco.log('Checking for local docker images to pull ...');

    var progressbar = bosco.config.get('progress') === 'bar';
    var total = repos.length;

    var bar = progressbar ? new bosco.Progress('Doing docker pull [:bar] :percent :etas', {
      complete: green,
      incomplete: red,
      width: 50,
      total: total,
    }) : null;

        // Get the dependencies
    async.mapSeries(repos, function doDockerPull(repo, repoCb) {
      if (!repo.match(repoRegex)) return repoCb();
      var repoPath = bosco.getRepoPath(repo);
      dockerPull(bosco, progressbar, bar, repoPath, repo, repoCb);
    }, function() {
      cb();
    });
  }

  function pullDependentDockerImages(cb) {
    if (noRemote) {
      bosco.log('Skipping check and pull of remote images ...'.cyan);
      return cb();
    }
    bosco.log('Checking for remote docker images to pull ...');
    RunListHelper.getRunList(bosco, repos, repoRegex, watchNothing, null, function(err, services) {
      if (err) { return next(err); }
      async.mapSeries(services, function doDockerPullRemote(runConfig, pullCb) {
        dockerPullRemote(bosco, repos, runConfig, pullCb);
      }, cb);
    });
  }

  function clearGithubCache(cb) {
    var configKey = 'cache:github';
    bosco.config.set(configKey, {});
    bosco.config.save(cb);
  }

  function initialiseRunners(cb) {
    DockerRunner.init(bosco, cb);
  }

  function disconnectRunners(cb) {
    DockerRunner.disconnect(cb);
  }

  async.series([
    initialiseRunners,
    pullRepos,
    ensureNodeVersions,
    pullDockerImages,
    pullDependentDockerImages,
    clearGithubCache,
    disconnectRunners,
  ], function() {
    bosco.log('Complete!');
    if (next) next();
  });
}

module.exports.cmd = cmd;
