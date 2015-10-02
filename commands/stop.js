var _ = require('lodash');
var async = require('async');
var RunListHelper = require('../src/RunListHelper');
var NodeRunner = require('../src/RunWrappers/Node');
var DockerRunner = require('../src/RunWrappers/Docker');
var DockerComposeRunner = require('../src/RunWrappers/DockerCompose');
var runningServices = [];

module.exports = {
  name: 'stop',
  description: 'Stops all of the microservices (or subset based on regex pattern)',
  usage: '[-r <repoPattern>]',
  cmd: cmd
}

function cmd(bosco, args, next) {
  var repoPattern = bosco.options.repo;
  var repoRegex = new RegExp(repoPattern);
  var repos = bosco.getRepos();
  var repoTag = bosco.options.tag;

  var initialiseRunners = function(cb) {
    var runners = [NodeRunner, DockerRunner, DockerComposeRunner];
    async.map(runners, function loadRunner(runner, lcb) {
      runner.init(bosco, lcb);
    }, cb);
  }

  var disconnectRunners = function(next) {
    var runners = [NodeRunner, DockerRunner];
    async.map(runners, function loadRunner(runner, cb) {
      runner.disconnect(cb);
    }, next);
  }

  var stopService = function(repo, boscoService, runningServices, cb) {
    if (boscoService.service.type == 'docker') {
      if (_.contains(runningServices, repo)) {
        return DockerRunner.stop(boscoService, cb);
      }
    } else if (boscoService.service.type == 'docker-compose') {
      if (_.contains(runningServices, 'docker-compose')) {
        return DockerComposeRunner.stop(boscoService, cb);
      }
    } else {
      if (_.contains(runningServices, repo)) {
        return NodeRunner.stop({name: repo}, cb);
      }
    }

    return cb();
  }

  var stopRunningServices = function(cb) {
    RunListHelper.getRunList(bosco, repos, repoRegex, null, repoTag, function(err, services) {
      async.mapSeries(services, function(boscoService, cb) {
        var repo = boscoService.name;

        if (repo.match(repoRegex)) {
          if (!boscoService.service.type) {
            RunListHelper.getServiceConfigFromGithub(bosco, boscoService.name, function(err, svcConfig) {
              if (!svcConfig.name) {
                svcConfig.name = boscoService.name;
              }
              stopService(repo, svcConfig, runningServices, cb);
            });
          } else {
            stopService(repo, boscoService, runningServices, cb);
          }
        } else {
          return cb();
        }
      }, function() {
        // Special case for bosco-cdn, room for improvement to make this
        // generic for all custom bosco services.
        if (_.contains(runningServices, 'bosco-cdn')) {
          return NodeRunner.stop({name: 'bosco-cdn'}, cb);
        } else {
          cb();
        }
      });
    });
  }

  var getRunningServices = function(cb) {
    NodeRunner.listRunning(false, function(err, nodeRunning) {
      DockerRunner.list(false, function(err, dockerRunning) {
        dockerRunning = _.map(_.flatten(dockerRunning), function(item) { return item.replace('/', ''); });
        DockerComposeRunner.list(false, function(err, dockerComposeRunning) {
          runningServices = _.union(nodeRunning, dockerRunning, dockerComposeRunning);
          cb()
        })
      })
    })
  }

  bosco.log('Stop each microservice ' + args);

  async.series([initialiseRunners, getRunningServices, stopRunningServices, disconnectRunners], function() {
    if (next) return next(null, runningServices);
  });
}
