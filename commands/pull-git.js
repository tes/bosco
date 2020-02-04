const Promise = require('bluebird');
const { exec } = require('child_process');
const _ = require('lodash');
const NodeRunner = require('../src/RunWrappers/Node');
const RunListHelper = require('../src/RunListHelper');

const green = '\u001b[42m \u001b[0m';
const red = '\u001b[41m \u001b[0m';

module.exports = {
  name: 'pull-git',
  description: 'Pulls any changes from git repos',
  usage: '[-r <repoPattern>]',
};

function checkCurrentBranch(bosco, repoPath) {
  if (!bosco.exists(repoPath)) return Promise.resolve();
  if (!bosco.exists([repoPath, '.git'].join('/'))) return Promise.resolve();

  return new Promise((resolve) => {
    exec('git rev-parse --abbrev-ref HEAD', {
      cwd: repoPath,
    }, (err, stdout, stderr) => {
      if (err) {
        bosco.error(`${repoPath.blue} >> ${stderr}`);
      } else if (stdout) {
        const branch = stdout.replace(/(\r\n|\n|\r)/gm, '');
        if (branch !== 'master') {
          bosco.warn(`${repoPath.yellow}: Is not on master, it is on ${branch.cyan}`);
        }
      }
      resolve();
    });
  });
}

function pull(bosco, progressbar, bar, repoPath) {
  if (!bosco.exists([repoPath, '.git'].join('/'))) return Promise.resolve();

  return new Promise((resolve) => {
    exec('git pull --rebase', {
      cwd: repoPath,
    }, (err, stdout, stderr) => {
      if (progressbar) bar.tick();
      if (err) {
        if (progressbar) bosco.console.log('');
        bosco.error(`${repoPath.blue} >> ${stderr}`);
      } else if (!progressbar && stdout) {
        if (stdout.indexOf('up to date') > 0) {
          bosco.log(`${repoPath.blue}: ${'No change'.green}`);
        } else {
          bosco.log(`${repoPath.blue}: ${'Pulling changes ...'.red}\n${stdout}`);
        }
      }
      resolve();
    });
  });
}

async function cmd(bosco) {
  const repoPattern = bosco.options.repo;
  const repoRegex = new RegExp(repoPattern);
  const watchNothing = '$a';

  bosco.cmdHelper.checkInService();
  let repos = bosco.getRepos();

  if (!repos) return bosco.error('You are repo-less :( You need to initialise bosco first, try \'bosco clone\'.');

  bosco.log(`Running ${'git pull --rebase'.blue} across all repos ...`);

  function pullRepos() {
    const progressbar = bosco.config.get('progress') === 'bar';
    const total = repos.length;

    const bar = progressbar ? new bosco.Progress('Doing git pull [:bar] :percent :etas', {
      complete: green,
      incomplete: red,
      width: 50,
      total,
    }) : null;

    return Promise.mapSeries(repos, (repo) => {
      if (!repo) return Promise.resolve();
      if (!repo.match(repoRegex)) return Promise.resolve();
      const repoPath = bosco.getRepoPath(repo);

      return checkCurrentBranch(bosco, repoPath)
        .then(() => pull(bosco, progressbar, bar, repoPath));
    });
  }

  function ensureNodeVersions() {
    bosco.log('Ensuring required node version is installed as per .nvmrc ...');

    return Promise.mapSeries(repos, (repo) => {
      const repoPath = bosco.getRepoPath(repo);
      return new Promise((resolve) => {
        NodeRunner.getInterpreter(bosco, { name: repo, cwd: repoPath }, (err) => {
          if (err) {
            bosco.error(err);
          }
          resolve();
        });
      });
    });
  }

  function clearGithubCache() {
    const configKey = 'cache:github';
    bosco.config.set(configKey, {});
    return new Promise((resolve, reject) => {
      bosco.config.save((err, ...rest) => (err ? reject(err) : resolve(...rest)));
    });
  }

  async function setRunRepos() {
    if (!bosco.cmdHelper.checkInService()) {
      return Promise.resolve();
    }

    const runRepos = await RunListHelper.getRepoRunList(bosco, bosco.getRepos(), repoRegex, watchNothing, null, false);
    repos = _.chain(runRepos)
      .filter((repo) => repo.type !== 'remote')
      .map('name')
      .value();
  }

  try {
    await setRunRepos();
    await pullRepos();
    await ensureNodeVersions();
    await clearGithubCache();

    bosco.log('Complete!');
  } catch (err) {
    bosco.error(err);
  }
}

module.exports.cmd = cmd;
