const async = require('async');
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

function checkCurrentBranch(bosco, repoPath, next) {
  if (!bosco.exists(repoPath)) {
    return next();
  }

  if (!bosco.exists([repoPath, '.git'].join('/'))) {
    return next();
  }

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
    next();
  });
}

function pull(bosco, progressbar, bar, repoPath, next) {
  if (!bosco.exists([repoPath, '.git'].join('/'))) {
    return next();
  }

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
    next();
  });
}

function cmd(bosco, args, next) {
  const repoPattern = bosco.options.repo;
  const repoRegex = new RegExp(repoPattern);
  const watchNothing = '$a';

  bosco.cmdHelper.checkInService();
  let repos = bosco.getRepos();

  if (!repos) return bosco.error('You are repo-less :( You need to initialise bosco first, try \'bosco clone\'.');

  bosco.log(`Running ${'git pull --rebase'.blue} across all repos ...`);

  function pullRepos(cb) {
    const progressbar = bosco.config.get('progress') === 'bar';
    const total = repos.length;

    const bar = progressbar ? new bosco.Progress('Doing git pull [:bar] :percent :etas', {
      complete: green,
      incomplete: red,
      width: 50,
      total,
    }) : null;

    async.mapLimit(repos, 1, (repo, repoCb) => {
      if (!repo) return repoCb();
      if (!repo.match(repoRegex)) return repoCb();
      const repoPath = bosco.getRepoPath(repo);
      checkCurrentBranch(bosco, repoPath, () => {
        pull(bosco, progressbar, bar, repoPath, repoCb);
      });
    }, () => {
      cb();
    });
  }

  function ensureNodeVersions(cb) {
    bosco.log('Ensuring required node version is installed as per .nvmrc ...');
    async.mapSeries(repos, (repo, repoCb) => {
      const repoPath = bosco.getRepoPath(repo);
      NodeRunner.getInterpreter(bosco, { name: repo, cwd: repoPath }, (err) => {
        if (err) {
          bosco.error(err);
        }
        return repoCb();
      });
    }, () => {
      cb();
    });
  }

  function clearGithubCache(cb) {
    const configKey = 'cache:github';
    bosco.config.set(configKey, {});
    bosco.config.save(cb);
  }

  function setRunRepos(cb) {
    if (!bosco.cmdHelper.checkInService()) {
      return cb();
    }

    RunListHelper.getRepoRunList(bosco, bosco.getRepos(), repoRegex, watchNothing, null, false, (err, runRepos) => {
      repos = _.chain(runRepos)
        .filter((repo) => repo.type !== 'remote')
        .map('name')
        .value();
      cb(err);
    });
  }

  async.series([
    setRunRepos,
    pullRepos,
    ensureNodeVersions,
    clearGithubCache,
  ], () => {
    bosco.log('Complete!');
    if (next) next();
  });
}

module.exports.cmd = cmd;
