const _ = require('lodash');
const Promise = require('bluebird');
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

async function cmd(bosco, args) {
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

  function initialiseRunners() {
    const runners = [NodeRunner, DockerRunner, DockerComposeRunner];
    return Promise.map(runners, (runner) => (runner.init(bosco)));
  }

  function disconnectRunners() {
    const runners = [NodeRunner, DockerRunner];
    return Promise.map(runners, (runner) => (runner.disconnect()));
  }

  function stopService(repo, boscoService, services) {
    if (boscoService.service && boscoService.service.type === 'docker') {
      if (_.includes(services, boscoService.service.name)) {
        return DockerRunner.stop(boscoService);
      }
    } else if (boscoService.service && boscoService.service.type === 'docker-compose') {
      if (_.includes(services, 'docker-compose')) {
        return DockerComposeRunner.stop(boscoService);
      }
    } else if (_.includes(services, repo)) {
      return NodeRunner.stop({ name: repo });
    }
  }

  async function stopRunningServices() {
    const services = await RunListHelper.getRunList(bosco, repos, repoRegex, null, repoTag, false);

    return Promise.map(services, (boscoService) => {
      const repo = boscoService.name;
      if (!repo.match(repoRegex)) return;
      if (boscoService.service) {
        return stopService(repo, boscoService, runningServices);
      }
    }, { concurrency: bosco.concurrency.network })
      .then(() => {
        // Special case for bosco-cdn, room for improvement to make this
        // generic for all custom bosco services.
        if (!_.includes(runningServices, 'bosco-cdn')) return;
        return NodeRunner.stop({ name: 'bosco-cdn' });
      });
  }

  async function getRunningServices() {
    const nodeRunning = await NodeRunner.listRunning(false);
    const dockerRunning = await DockerRunner.list(false);
    const flatDockerRunning = _.map(_.flatten(dockerRunning), (item) => item.replace('/', ''));
    const dockerComposeRunning = await DockerComposeRunner.list(false);

    runningServices = _.union(nodeRunning, flatDockerRunning, dockerComposeRunning);
  }

  bosco.log(`Stop each microservice ${args}`);

  try {
    await initialiseRunners();
    await getRunningServices();
    await stopRunningServices();
    await disconnectRunners();

    return runningServices;
  } catch (err) {
    bosco.error(err);
  }
}

module.exports.cmd = cmd;
