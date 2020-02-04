const _ = require('lodash');
const Promise = require('bluebird');
const fs = require('fs-extra');

const cdn = require('./cdn');
const RunListHelper = require('../src/RunListHelper');
const NodeRunner = require('../src/RunWrappers/Node');
const DockerRunner = require('../src/RunWrappers/Docker');
const DockerComposeRunner = require('../src/RunWrappers/DockerCompose');

let runningServices = [];
let notRunningServices = [];

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
  const watchPattern = bosco.options.watch || '$a';
  const watchRegex = new RegExp(watchPattern);
  const repoTag = bosco.options.tag;

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

  function getRunList() {
    return RunListHelper.getRunList(bosco, repos, repoRegex, watchRegex, repoTag, false);
  }

  async function startRunnableServices() {
    let alreadyRunning = 0;

    async function runService(runConfig) {
      const type = runConfig.service && runConfig.service.type;

      if (!type || type === 'unknown' || type === 'skip') return;

      if (type === 'docker') {
        if (_.includes(runningServices, runConfig.name)) {
          if (bosco.options.verbose) {
            bosco.warn(`Service ${runConfig.name.green} is already running ...`);
          } else {
            alreadyRunning += 1;
          }
          return;
        }
        if (bosco.options.verbose) {
          bosco.log(`Running docker service ${runConfig.name.green} ...`);
        }
        return DockerRunner.start(runConfig).catch((err) => {
          // Log errors from docker but do not stop all tasks
          bosco.error(`There was an error running ${runConfig.name}: ${err}`);
        });
      }

      if (type === 'docker-compose') {
        if (bosco.options.verbose) {
          bosco.log(`Running docker-compose ${runConfig.name.green} ...`);
        }
        return DockerComposeRunner.start(runConfig);
      }

      if (type === 'node') {
        if (_.includes(runningServices, runConfig.name)) {
          if (bosco.options.verbose) {
            bosco.warn(`Service ${runConfig.name.green} is already running ...`);
          } else {
            alreadyRunning += 1;
          }
          return;
        }
        if (bosco.options.verbose) {
          bosco.log(`Running node service ${runConfig.name.green} ...`);
        }
        return NodeRunner.start(runConfig);
      }

      if (_.includes(runningServices, runConfig.name)) {
        if (bosco.options.verbose) {
          bosco.warn(`Service ${runConfig.name.green} is already running ...`);
        } else {
          alreadyRunning += 1;
        }
        return;
      }

      bosco.warn(`Service ${runConfig.name.orange} could not be run because it was of an unknown type: ${type.red}`);
    }

    function runServices(runList) {
      if (runList.services.length < 1) return;

      bosco.log(`Launching ${(`${runList.services.length}`).green} ${runList.type.cyan} processes with parallel limit of ${(`${runList.limit}`).cyan} ...`);

      return Promise.map(runList.services, runService, { concurrency: runList.limit })
        .then(() => {
          if (alreadyRunning > 0 && !bosco.options.verbose) {
            bosco.log(`Did not start ${(`${alreadyRunning}`).cyan} services that were already running.  Use --verbose to see more detail.`);
          }
        });
    }

    const runList = await getRunList();
    const dockerServices = _.filter(runList, (i) => i.service.type === 'docker' && _.startsWith(i.name, 'infra-'));
    const dockerComposeServices = _.filter(runList, (i) => i.service.type === 'docker-compose');
    const nodeServices = _.filter(runList, (i) => _.startsWith(i.name, 'service-') && i.service.type !== 'skip');
    const nodeApps = _.filter(runList, (i) => _.startsWith(i.name, 'app-') && i.service.type !== 'skip');
    const unknownServices = _.filter(runList, (i) => !_.includes(['docker', 'docker-compose', 'node', 'skip'], i.service.type));
    if (unknownServices.length > 0) {
      bosco.error(`Unable to run services of un-recognised type: ${_.map(unknownServices, 'name').join(', ').cyan}. Check their bosco-service.json configuration.`);
      bosco.warn('This may be due to either:');
      bosco.warn(`- Team not being configured: ${'bosco team setup'.yellow}`);
      bosco.warn(`- Github oauth token with insufficient priveleges: ${'https://github.com/settings/tokens/new'.yellow}`);
      bosco.warn(`- Out of date cached content: ${'bosco run --nocache'.yellow}`);
      bosco.warn(`- Missing github configuration: ${'bosco config set github:org <organisation>'.yellow}`);
    }

    return Promise.mapSeries([
      { services: dockerServices, type: 'docker', limit: bosco.concurrency.cpu },
      { services: dockerComposeServices, type: 'docker-compose', limit: bosco.concurrency.cpu },
      { services: nodeServices, type: 'service', limit: bosco.concurrency.cpu },
      { services: nodeApps, type: 'app', limit: bosco.concurrency.cpu },
    ], runServices);
  }

  function stopNotRunningServices() {
    bosco.log('Removing stopped/dead services');
    return Promise.each(notRunningServices, (service) => NodeRunner.stop({ name: service }));
  }

  async function getRunningServices() {
    const nodeRunning = await NodeRunner.listRunning(false);
    const dockerRunning = await DockerRunner.list(false);

    const flatDockerRunning = _.map(_.flatten(dockerRunning), (item) => item.replace('/', ''));
    runningServices = _.union(nodeRunning, flatDockerRunning);
  }

  async function getStoppedServices() {
    notRunningServices = await NodeRunner.listNotRunning(false);
  }

  function ensurePM2() {
    // Ensure that the ~/.pm2 folders exist
    const folders = [
      `${process.env.HOME}/.pm2/logs`,
      `${process.env.HOME}/.pm2/pids`,
    ];

    return Promise.map(folders, (folder) => fs.mkdirp(folder));
  }

  if (bosco.options.show) {
    bosco.log('Dependency tree for current repo filter:');
    return RunListHelper.getRunList(bosco, repos, repoRegex, watchRegex, repoTag, true);
  }

  bosco.log(`Run each microservice, will inject ip into docker: ${bosco.options.ip.cyan}`);

  try {
    await ensurePM2();
    await initialiseRunners();
    await getRunningServices();
    await getStoppedServices();
    await stopNotRunningServices();
    await startRunnableServices();
    await disconnectRunners();

    bosco.log('All services started.');
    if (!_.includes(args, 'cdn')) return;

    return cdn.cmd(bosco, [], () => {});
  } catch (err) {
    bosco.error(err);
  }
}

module.exports.cmd = cmd;
