const Promise = require('bluebird');
const _ = require('lodash');
const DockerRunner = require('../src/RunWrappers/Docker');
const RunListHelper = require('../src/RunListHelper');

const green = '\u001b[42m \u001b[0m';
const red = '\u001b[41m \u001b[0m';

module.exports = {
  name: 'pull-docker',
  description: 'Pulls latest docker images',
  usage: '[-r <repoPattern>]',
  options: [{
    name: 'noremote',
    alias: 'nr',
    type: 'boolean',
    desc: 'Do not pull docker images for remote repositories (dependencies)',
  },
  {
    name: 'infra',
    type: 'boolean',
    desc: 'Only pull infra- dependencies',
  }],
};

function dockerPullService(bosco, definition) {
  if (!definition.service || definition.service.type !== 'docker') return Promise.resolve();

  return DockerRunner.update(definition)
    .catch((err) => {
      if (err) {
        const errMessage = err.reason ? err.reason : err;
        bosco.error(`Error pulling ${definition.name}, reason: ${errMessage}`);
      }
    });
}

function dockerPullRemote(bosco, repos, runConfig) {
  const isLocalRepo = _.includes(repos, runConfig.name);
  if (isLocalRepo) return Promise.resolve();
  return dockerPullService(bosco, runConfig);
}

function dockerPull(bosco, progressbar, bar, repoPath) {
  const boscoService = [repoPath, 'bosco-service.json'].join('/');
  if (!bosco.exists(boscoService)) return Promise.resolve();

  const definition = require(boscoService); // eslint-disable-line global-require,import/no-dynamic-require
  return dockerPullService(bosco, definition);
}

async function cmd(bosco) {
  const repoPattern = bosco.options.repo;
  const repoRegex = new RegExp(repoPattern);
  const watchNothing = '$a';
  const noRemote = bosco.options.noremote;

  bosco.cmdHelper.checkInService();
  const repos = bosco.getRepos();
  if (!repos) return bosco.error('You are repo-less :( You need to initialise bosco first, try \'bosco clone\'.');

  function pullDockerImages() {
    bosco.log('Checking for local docker images to pull ...');

    const progressbar = bosco.config.get('progress') === 'bar';
    const total = repos.length;

    const bar = progressbar ? new bosco.Progress('Doing docker pull [:bar] :percent :etas', {
      complete: green,
      incomplete: red,
      width: 50,
      total,
    }) : null;

    // Get the dependencies
    return Promise.mapSeries(repos, (repo) => {
      if (!repo.match(repoRegex)) return;
      const repoPath = bosco.getRepoPath(repo);
      return dockerPull(bosco, progressbar, bar, repoPath);
    });
  }

  async function pullDependentDockerImages() {
    if (noRemote) {
      bosco.log('Skipping check and pull of remote images ...'.cyan);
      return Promise.resolve();
    }
    bosco.log('Checking for remote docker images to pull ...');
    const services = await RunListHelper.getRunList(bosco, repos, repoRegex, watchNothing, null, false);
    await Promise.mapSeries(services, (runConfig) => dockerPullRemote(bosco, repos, runConfig));
  }

  function initialiseRunners() {
    return DockerRunner.init(bosco);
  }

  function disconnectRunners() {
    DockerRunner.disconnect();
  }

  try {
    await initialiseRunners();
    await pullDockerImages();
    await pullDependentDockerImages();
    await disconnectRunners();
  } catch (err) {
    bosco.error(err);
  }

  bosco.log('Complete!');
}

module.exports.cmd = cmd;
