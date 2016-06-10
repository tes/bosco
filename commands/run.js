var _ = require('lodash');
var async = require('async');
var fs = require('fs-extra');

var RunListHelper = require('../src/RunListHelper');
var NodeRunner = require('../src/RunWrappers/Node');
var DockerRunner = require('../src/RunWrappers/Docker');
var DockerComposeRunner = require('../src/RunWrappers/DockerCompose');
var CmdHelper = require('../src/CmdHelper');

var runningServices = [];
var notRunningServices = [];

module.exports = {
  name: 'run',
  description: 'Runs all of the microservices (or subset based on regex pattern)',
  usage: '[-r <repoPattern>] [-t <tag>] [-d]',
  requiresNvm: true,
  options: [{
    name: 'tag',
    alias: 't',
    type: 'string',
    desc: 'Filter by a tag defined within bosco-service.json',
  },
  {
    name: 'watch',
    alias: 'w',
    type: 'string',
    desc: 'Watch the applications started with run for changes that match this regular expression',
  },
  {
    name: 'list',
    alias: 'l',
    type: 'string',
    desc: 'Start a list of repos (comma separated)',
  },
  {
    name: 'dev',
    alias: 'd',
    type: 'boolean',
    desc: 'Only start the dependencies of the current repo, not itself',
  }],
};

function cmd(bosco, args, allDone) {
  var done = allDone ? allDone : function() {};
  var repoPattern = bosco.options.repo;
  var repoRegex = new RegExp(repoPattern);
  var watchPattern = bosco.options.watch || '$a';
  var watchRegex = new RegExp(watchPattern);
  var repoTag = bosco.options.tag;

  var repos;
  if (bosco.options.list) {
    repos = bosco.options.list.split(',');
  } else {
    CmdHelper.checkInService(bosco);
    repos = bosco.getRepos();
  }

  function initialiseRunners(next) {
    var runners = [NodeRunner, DockerRunner, DockerComposeRunner];
    async.map(runners, function loadRunner(runner, cb) {
      runner.init(bosco, cb);
    }, next);
  }

  function disconnectRunners(next) {
    var runners = [NodeRunner, DockerRunner];
    async.map(runners, function loadRunner(runner, cb) {
      runner.disconnect(cb);
    }, next);
  }

  function getRunList(next) {
    RunListHelper.getRunList(bosco, repos, repoRegex, watchRegex, repoTag, next);
  }

  function startRunnableServices(next) {
    function runService(runConfig, cb) {
      if (runConfig.service && runConfig.service.type === 'docker') {
        if (_.contains(runningServices, runConfig.name)) {
          bosco.warn('Service ' + runConfig.name.green + ' is already running ...');
          return cb();
        }
        bosco.log('Running docker service ' + runConfig.name.green + ' ...');
        return DockerRunner.start(runConfig, cb);
      }

      if (runConfig.service && runConfig.service.type === 'docker-compose') {
        bosco.log('Running docker-compose ' + runConfig.name.green + ' ...');
        return DockerComposeRunner.start(runConfig, cb);
      }

      if (runConfig.service && runConfig.service.type === 'node') {
        if (_.contains(runningServices, runConfig.name)) {
          bosco.warn('Service ' + runConfig.name.green + ' is already running ...');
          return cb();
        }
        return NodeRunner.start(runConfig, cb);
      }
      return cb();
    }

    getRunList(function(err, runList) {
      if (err) return next(err);
      async.mapSeries(runList, function(runConfig, cb) {
        if (!runConfig.service.type) {
          RunListHelper.getServiceConfigFromGithub(bosco, runConfig.name, function(err, svcConfig) {
            if (err) { return cb(); }
            if (svcConfig.type === 'docker') { return cb(); }
            // Do not allow build in this mode, so default to run
            if (svcConfig.service && svcConfig.service.build) {
              delete svcConfig.service.build;
            }
            if (!svcConfig.name) {
              svcConfig.name = runConfig.name;
            }
            runService(svcConfig, cb);
          });
        } else {
          runService(runConfig, cb);
        }
      }, next);
    });
  }

  function stopNotRunningServices(next) {
    bosco.log('Removing stopped/dead services');
    async.each(notRunningServices, function(service, cb) {
      NodeRunner.stop({name: service}, cb);
    }, next);
  }

  function getRunningServices(next) {
    NodeRunner.listRunning(false, function(err, nodeRunning) {
      DockerRunner.list(false, function(err, dockerRunning) {
        var flatDockerRunning = _.map(_.flatten(dockerRunning), function(item) { return item.replace('/', ''); });
        runningServices = _.union(nodeRunning, flatDockerRunning);
        next();
      });
    });
  }

  function getStoppedServices(next) {
    NodeRunner.listNotRunning(false, function(err, nodeNotRunning) {
      notRunningServices = nodeNotRunning;
      next();
    });
  }

  function ensurePM2(next) {
    // Ensure that the ~/.pm2 folders exist
    var folders = [
      process.env.HOME + '/.pm2/logs',
      process.env.HOME + '/.pm2/pids',
    ];

    async.map(folders, function(folder, cb) {
      fs.mkdirp(folder, cb);
    }, function(err) {
      next(err);
    });
  }

  bosco.log('Run each microservice ... ');

  async.series([ensurePM2, initialiseRunners, getRunningServices, getStoppedServices, stopNotRunningServices, startRunnableServices, disconnectRunners], function(err) {
    if (err) {
      bosco.error(err);
      return done();
    }

    bosco.log('All services started.');
    if (!_.contains(args, 'cdn')) return done();

    var cdn = require('./cdn');
    cdn.cmd(bosco, [], function() {});
  });
}

module.exports.cmd = cmd;
