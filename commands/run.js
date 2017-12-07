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
  options: [
    {
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
      name: 'deps-only',
      alias: 'd',
      type: 'boolean',
      desc: 'Only start the dependencies of the current repo, not itself',
    },
    {
      name: 'show',
      type: 'boolean',
      desc: 'Display the dependency tree but do not start the services',
    },
    {
      name: 'docker-only',
      type: 'boolean',
      desc: 'Only start docker dependencies',
    },
    {
      name: 'team-only',
      type: 'boolean',
      desc: 'Only start app or service dependencies in the current team',
    },
    {
      name: 'infra',
      type: 'boolean',
      desc: 'Only start infra- dependencies',
    },
  ],
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
    RunListHelper.getRunList(bosco, repos, repoRegex, watchRegex, repoTag, false, next);
  }

  function startRunnableServices(next) {
    var alreadyRunning = 0;

    function runService(runConfig, cb) {
      var type = runConfig.service && runConfig.service.type;

      if (!type || type === 'unknown' || type === 'skip') {
        return cb();
      }

      if (type === 'docker') {
        if (_.includes(runningServices, runConfig.name)) {
          if (bosco.options.verbose) {
            bosco.warn('Service ' + runConfig.name.green + ' is already running ...');
          } else {
            alreadyRunning++;
          }
          return cb();
        }
        if (bosco.options.verbose) {
          bosco.log('Running docker service ' + runConfig.name.green + ' ...');
        }
        return DockerRunner.start(runConfig, function(err) {
          // Log errors from docker but do not stop all tasks
          if (err) {
            bosco.error('There was an error running ' + runConfig.name + ': ' + err);
          }
          cb();
        });
      }

      if (type === 'docker-compose') {
        if (bosco.options.verbose) {
          bosco.log('Running docker-compose ' + runConfig.name.green + ' ...');
        }
        return DockerComposeRunner.start(runConfig, cb);
      }

      if (type === 'node') {
        if (_.includes(runningServices, runConfig.name)) {
          if (bosco.options.verbose) {
            bosco.warn('Service ' + runConfig.name.green + ' is already running ...');
          } else {
            alreadyRunning++;
          }
          return cb();
        }
        if (bosco.options.verbose) {
          bosco.log('Running node service ' + runConfig.name.green + ' ...');
        }
        return NodeRunner.start(runConfig, cb);
      }

      if (_.includes(runningServices, runConfig.name)) {
        if (bosco.options.verbose) {
          bosco.warn('Service ' + runConfig.name.green + ' is already running ...');
        } else {
          alreadyRunning++;
        }
        return cb();
      }

      bosco.warn('Service ' + runConfig.name.orange + ' could not be run because it was of an unknown type: ' + type.red);

      return cb();
    }

    function runServices(runList, cb) {
      if (runList.services.length < 1) {
        cb();
        return;
      }
      bosco.log('Launching ' + (runList.services.length + '').green + ' ' + runList.type.cyan + ' processes with parallel limit of ' + (runList.limit + '').cyan + ' ...');
      async.mapLimit(runList.services, runList.limit, runService, function(err) {
        if (alreadyRunning > 0 && !bosco.options.verbose) {
          bosco.log('Did not start ' + ('' + alreadyRunning).cyan + ' services that were already running.  Use --verbose to see more detail.');
        }
        cb(err);
      });
    }

    getRunList(function(err, runList) {
      if (err) return next(err);
      var dockerServices = _.filter(runList, function(i) { return i.service.type === 'docker' && _.startsWith(i.name, 'infra-'); });
      var dockerComposeServices = _.filter(runList, function(i) { return i.service.type === 'docker-compose'; });
      var nodeServices = _.filter(runList, function(i) { return _.startsWith(i.name, 'service-') && i.service.type !== 'skip'; });
      var nodeApps = _.filter(runList, function(i) { return _.startsWith(i.name, 'app-') && i.service.type !== 'skip'; });
      var unknownServices = _.filter(runList, function(i) { return !_.includes(['docker', 'docker-compose', 'node', 'skip'], i.service.type); });
      if (unknownServices.length > 0) {
        bosco.error('Unable to run services of un-recognised type: ' + _.map(unknownServices, 'name').join(', ').cyan + '. Check their bosco-service.json configuration.');
        bosco.warn('This may be due to either:');
        bosco.warn('- Team not being configured: ' + 'bosco team setup'.yellow);
        bosco.warn('- Out of date cached content: ' + 'bosco run --nocache'.yellow);
        bosco.warn('- Missing github configuration: ' + 'bosco config set github:org <organisation>'.yellow);
      }
      async.mapSeries([
          {services: dockerServices, type: 'docker', limit: bosco.concurrency.cpu},
          {services: dockerComposeServices, type: 'docker-compose', limit: bosco.concurrency.cpu},
          {services: nodeServices, type: 'service', limit: bosco.concurrency.cpu},
          {services: nodeApps, type: 'app', limit: bosco.concurrency.cpu},
      ], runServices, next);
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

  if (bosco.options.show) {
    bosco.log('Dependency tree for current repo filter:');
    return RunListHelper.getRunList(bosco, repos, repoRegex, watchRegex, repoTag, true, done);
  }

  bosco.log('Run each microservice, will inject ip into docker: ' + bosco.options.ip.cyan);

  async.series([ensurePM2, initialiseRunners, getRunningServices, getStoppedServices, stopNotRunningServices, startRunnableServices, disconnectRunners], function(err) {
    if (err) {
      bosco.error(err);
      return done();
    }

    bosco.log('All services started.');
    if (!_.includes(args, 'cdn')) return done();

    var cdn = require('./cdn');
    cdn.cmd(bosco, [], function() {});
  });
}

module.exports.cmd = cmd;
