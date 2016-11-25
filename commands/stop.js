var _ = require('lodash');
var async = require('async');
var RunListHelper = require('../src/RunListHelper');
var NodeRunner = require('../src/RunWrappers/Node');
var DockerRunner = require('../src/RunWrappers/Docker');
var DockerComposeRunner = require('../src/RunWrappers/DockerCompose');
var CmdHelper = require('../src/CmdHelper');

module.exports = {
  name: 'stop',
  description: 'Stops all of the microservices (or subset based on regex pattern)',
  usage: '[-r <repoPattern>]',
  options: [
    {
      name: 'tag',
      alias: 't',
      type: 'string',
      desc: 'Filter by a tag defined within bosco-service.json',
    },
    {
      name: 'list',
      alias: 'l',
      type: 'string',
      desc: 'Start a list of repos (comma separated)',
    },
    {
      name: 'deps-only',
      alias: 'd',
      type: 'boolean',
      desc: 'Only start the dependencies of the current repo, not itself',
    },
  ],
};

function cmd(bosco, args, done) {
  var repoPattern = bosco.options.repo;
  var repoRegex = new RegExp(repoPattern);
  var repoTag = bosco.options.tag;
  var runningServices = [];

  var repos;
  if (bosco.options.list) {
    repos = bosco.options.list.split(',');
  } else {
    CmdHelper.checkInService(bosco);
    repos = bosco.getRepos();
  }

  function initialiseRunners(cb) {
    var runners = [NodeRunner, DockerRunner, DockerComposeRunner];
    async.map(runners, function loadRunner(runner, lcb) {
      runner.init(bosco, lcb);
    }, cb);
  }

  function disconnectRunners(next) {
    var runners = [NodeRunner, DockerRunner];
    async.map(runners, function loadRunner(runner, cb) {
      runner.disconnect(cb);
    }, next);
  }

  function stopService(repo, boscoService, services, cb) {
    if (boscoService.service && boscoService.service.type === 'docker') {
      if (_.includes(services, repo)) {
        return DockerRunner.stop(boscoService, cb);
      }
    } else if (boscoService.service && boscoService.service.type === 'docker-compose') {
      if (_.includes(services, 'docker-compose')) {
        return DockerComposeRunner.stop(boscoService, cb);
      }
    } else {
      if (_.includes(services, repo)) {
        return NodeRunner.stop({name: repo}, cb);
      }
    }

    return cb();
  }

  function stopRunningServices(cb) {
    var missingDependencies = [];
    RunListHelper.getRunList(bosco, repos, repoRegex, null, repoTag, false, function(err, services) {
      async.mapLimit(services, bosco.concurrency.network, function(boscoService, next) {
        var repo = boscoService.name;
        if (!repo.match(repoRegex)) return next();
        if (boscoService.service && boscoService.service.type !== 'remote') {
          return stopService(repo, boscoService, runningServices, next);
        }
        RunListHelper.getServiceConfigFromGithub(bosco, boscoService.name, function(err, svcConfig) {
          if (err || !svcConfig || svcConfig.type === 'node') {
            missingDependencies.push(boscoService.name);
            return next();
          }
          if (!svcConfig.name) svcConfig.name = boscoService.name;
          stopService(repo, svcConfig, runningServices, next);
        });
      }, function() {
        if (missingDependencies.length > 0) {
          bosco.warn('Unable to stop dependencies: ' + missingDependencies.join(',').cyan);
        }
        // Special case for bosco-cdn, room for improvement to make this
        // generic for all custom bosco services.
        if (!_.includes(runningServices, 'bosco-cdn')) return cb();
        NodeRunner.stop({name: 'bosco-cdn'}, cb);
      });
    });
  }

  function getRunningServices(cb) {
    NodeRunner.listRunning(false, function(err, nodeRunning) {
      DockerRunner.list(false, function(err, dockerRunning) {
        var flatDockerRunning = _.map(_.flatten(dockerRunning), function(item) { return item.replace('/', ''); });
        DockerComposeRunner.list(false, function(err, dockerComposeRunning) {
          runningServices = _.union(nodeRunning, flatDockerRunning, dockerComposeRunning);
          cb();
        });
      });
    });
  }

  bosco.log('Stop each microservice ' + args);

  async.series([initialiseRunners, getRunningServices, stopRunningServices, disconnectRunners], function() {
    if (done) return done(null, runningServices);
  });
}

module.exports.cmd = cmd;
