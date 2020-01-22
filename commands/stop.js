const _ = require('lodash');
const async = require('async');
const RunListHelper = require('../src/RunListHelper');
const NodeRunner = require('../src/RunWrappers/Node');
const DockerRunner = require('../src/RunWrappers/Docker');
const DockerComposeRunner = require('../src/RunWrappers/DockerCompose');

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
      desc: 'Stop a list of repos (comma separated)',
    },
    {
      name: 'deps-only',
      alias: 'd',
      type: 'boolean',
      desc: 'Only stop the dependencies of the current repo, not itself',
    },
    {
      name: 'infra',
      type: 'boolean',
      desc: 'Only stop infra- dependencies',
    },
    {
      name: 'exclude',
      type: 'string',
      desc: 'Exclude any repositories that match this regex',
    },
  ],
};

function cmd(bosco, args, done) {
  const repoPattern = bosco.options.repo;
  const repoRegex = new RegExp(repoPattern);
  const repoTag = bosco.options.tag;
  let runningServices = [];

  let repos;
  if (bosco.options.list) {
    repos = bosco.options.list.split(',');
  } else {
    bosco.cmdHelper.checkInService();
    repos = bosco.getRepos();
  }

  function initialiseRunners(cb) {
    const runners = [NodeRunner, DockerRunner, DockerComposeRunner];
    async.map(runners, (runner, lcb) => {
      runner.init(bosco, lcb);
    }, cb);
  }

  function disconnectRunners(next) {
    const runners = [NodeRunner, DockerRunner];
    async.map(runners, (runner, cb) => {
      runner.disconnect(cb);
    }, next);
  }

  function stopService(repo, boscoService, services, cb) {
    if (boscoService.service && boscoService.service.type === 'docker') {
      if (_.includes(services, boscoService.service.name)) {
        return DockerRunner.stop(boscoService, cb);
      }
    } else if (boscoService.service && boscoService.service.type === 'docker-compose') {
      if (_.includes(services, 'docker-compose')) {
        return DockerComposeRunner.stop(boscoService, cb);
      }
    } else if (_.includes(services, repo)) {
      return NodeRunner.stop({ name: repo }, cb);
    }
    return cb();
  }

  function stopRunningServices(cb) {
    RunListHelper.getRunList(bosco, repos, repoRegex, null, repoTag, false, (err, services) => {
      async.mapLimit(services, bosco.concurrency.network, (boscoService, next) => {
        const repo = boscoService.name;
        if (!repo.match(repoRegex)) return next();
        if (boscoService.service) {
          return stopService(repo, boscoService, runningServices, next);
        }
      }, () => {
        // Special case for bosco-cdn, room for improvement to make this
        // generic for all custom bosco services.
        if (!_.includes(runningServices, 'bosco-cdn')) return cb();
        NodeRunner.stop({ name: 'bosco-cdn' }, cb);
      });
    });
  }

  function getRunningServices(cb) {
    NodeRunner.listRunning(false, (err, nodeRunning) => {
      DockerRunner.list(false, (err, dockerRunning) => {
        const flatDockerRunning = _.map(_.flatten(dockerRunning), (item) => item.replace('/', ''));
        DockerComposeRunner.list(false, (err, dockerComposeRunning) => {
          runningServices = _.union(nodeRunning, flatDockerRunning, dockerComposeRunning);
          cb();
        });
      });
    });
  }

  bosco.log(`Stop each microservice ${args}`);

  async.series([initialiseRunners, getRunningServices, stopRunningServices, disconnectRunners], () => {
    if (done) return done(null, runningServices);
  });
}

module.exports.cmd = cmd;
