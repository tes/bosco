const async = require('async');
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

function dockerPullService(bosco, definition, next) {
  if (!definition.service || definition.service.type !== 'docker') return next();
  DockerRunner.update(definition, (err) => {
    if (err) {
      const errMessage = err.reason ? err.reason : err;
      bosco.error(`Error pulling ${definition.name}, reason: ${errMessage}`);
    }
    next();
  });
}

function dockerPullRemote(bosco, repos, runConfig, next) {
  const isLocalRepo = _.includes(repos, runConfig.name);
  if (isLocalRepo) return next();
  dockerPullService(bosco, runConfig, next);
}

function dockerPull(bosco, progressbar, bar, repoPath, repo, next) {
  const boscoService = [repoPath, 'bosco-service.json'].join('/');
  if (!bosco.exists(boscoService)) return next();

  const definition = require(boscoService); // eslint-disable-line global-require,import/no-dynamic-require
  dockerPullService(bosco, definition, next);
}

function cmd(bosco, args, next) {
  const repoPattern = bosco.options.repo;
  const repoRegex = new RegExp(repoPattern);
  const watchNothing = '$a';
  const noRemote = bosco.options.noremote;

  bosco.cmdHelper.checkInService();
  const repos = bosco.getRepos();
  if (!repos) return bosco.error('You are repo-less :( You need to initialise bosco first, try \'bosco clone\'.');

  function pullDockerImages(cb) {
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
    async.mapSeries(repos, (repo, repoCb) => {
      if (!repo.match(repoRegex)) return repoCb();
      const repoPath = bosco.getRepoPath(repo);
      dockerPull(bosco, progressbar, bar, repoPath, repo, repoCb);
    }, () => {
      cb();
    });
  }

  function pullDependentDockerImages(cb) {
    if (noRemote) {
      bosco.log('Skipping check and pull of remote images ...'.cyan);
      return cb();
    }
    bosco.log('Checking for remote docker images to pull ...');
    RunListHelper.getRunList(bosco, repos, repoRegex, watchNothing, null, false, (err, services) => {
      if (err) {
        return next(err);
      }
      async.mapSeries(services, (runConfig, pullCb) => {
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
  ], () => {
    bosco.log('Complete!');
    if (next) next();
  });
}

module.exports.cmd = cmd;
