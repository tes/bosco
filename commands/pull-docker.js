var async = require('async');
var _ = require('lodash');
var DockerRunner = require('../src/RunWrappers/Docker');
var RunListHelper = require('../src/RunListHelper');
var green = '\u001b[42m \u001b[0m';
var red = '\u001b[41m \u001b[0m';

module.exports = {
  name: 'pull-docker',
  description: 'Pulls latest docker images',
  usage: '[-r <repoPattern>]',
  options: [{
    name: 'noremote',
    alias: 'nr',
    type: 'boolean',
    desc: 'Do not pull docker images for remote repositories (dependencies)',
  }],
};

function dockerPullService(bosco, definition, next) {
  if (!definition.service || definition.service.type !== 'docker') return next();

  DockerRunner.update(definition, function(err) {
    if (err) {
      var errMessage = err.reason ? err.reason : err;
      bosco.error('Error pulling ' + definition.name + ', reason: ' + errMessage);
    }
    next();
  });
}

function dockerPullRemote(bosco, repos, runConfig, next) {
  var isRemoteService = !runConfig.service || !runConfig.service.type || runConfig.service.type === 'remote';
  var isLocalRepo = _.includes(repos, runConfig.name);
  if (!isRemoteService || isLocalRepo) return next();

  RunListHelper.getServiceConfigFromGithub(bosco, runConfig.name, function(err, svcConfig) {
    if (err) return next();
    if (err || !svcConfig || !svcConfig.service || !svcConfig.service.type || svcConfig.service.type !== 'docker') {
      svcConfig.service = RunListHelper.getServiceDockerConfig(runConfig, svcConfig);
    }
    if (!svcConfig.name) svcConfig.name = runConfig.name;

    dockerPullService(bosco, svcConfig, next);
  });
}

function dockerPull(bosco, progressbar, bar, repoPath, repo, next) {
  var boscoService = [repoPath, 'bosco-service.json'].join('/');
  if (!bosco.exists(boscoService)) return next();

  var definition = require(boscoService);
  dockerPullService(bosco, definition, next);
}

function cmd(bosco, args, next) {
  var repoPattern = bosco.options.repo;
  var repoRegex = new RegExp(repoPattern);
  var watchNothing = '$a';
  var noRemote = bosco.options.noremote;

  var repos = bosco.getRepos();
  if (!repos) return bosco.error('You are repo-less :( You need to initialise bosco first, try \'bosco clone\'.');

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
      if (err) {
        return next(err);
      }
      async.mapSeries(services, function doDockerPullRemote(runConfig, pullCb) {
        dockerPullRemote(bosco, repos, runConfig, pullCb);
      }, cb);
    });
  }

  function initialiseRunners(cb) {
    DockerRunner.init(bosco, cb);
  }

  function disconnectRunners(cb) {
    DockerRunner.disconnect(cb);
  }

  async.series([
    initialiseRunners,
    pullDockerImages,
    pullDependentDockerImages,
    disconnectRunners,
  ], function() {
    bosco.log('Complete!');
    if (next) next();
  });
}

module.exports.cmd = cmd;
