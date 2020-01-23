const async = require('async');
const { exec } = require('child_process');

const green = '\u001b[42m \u001b[0m';
const red = '\u001b[41m \u001b[0m';

module.exports = {
  name: 'stash',
  description: 'Stashes any local changes across all repos',
  usage: '[-r <repoPattern>]',
};

function stash(bosco, args, progressbar, bar, orgPath, next) {
  if (!progressbar) bosco.log(`Stashing ${orgPath.blue}`);
  if (!bosco.exists([orgPath, '.git'].join('/'))) {
    bosco.warn(`Doesn't seem to be a git repo: ${orgPath.blue}`);
    return next();
  }

  const cmdString = `git stash ${args.join(' ')}`;

  const ignoreMissingStashCommands = ['pop', 'apply'];
  const ignoreMissingStash = (ignoreMissingStashCommands.indexOf(args[0]) !== -1);
  exec(cmdString, {
    cwd: orgPath,
  }, (error, stdout, stderr) => {
    if (progressbar) bar.tick();
    let err = error;

    if (err && ignoreMissingStash && err.code === 1) {
      err = null;
    }
    if (err) {
      if (progressbar) bosco.console.log('');
      bosco.error(`${orgPath.blue} >> ${stderr}`);
    } else if (!progressbar && stdout) bosco.log(`${orgPath.blue} >> ${stdout}`);
    next(err);
  });
}

function cmd(bosco, args) {
  const repoPattern = bosco.options.repo;
  const repoRegex = new RegExp(repoPattern);

  const repos = bosco.getRepos();
  if (!repos) return bosco.error('You are repo-less :( You need to initialise bosco first, try \'bosco clone\'.');

  bosco.log('Running git stash across all repos ...');

  function stashRepos(cb) {
    const progressbar = bosco.config.get('progress') === 'bar';
    const total = repos.length;

    const bar = progressbar ? new bosco.Progress('Doing git stash [:bar] :percent :etas', {
      complete: green,
      incomplete: red,
      width: 50,
      total,
    }) : null;

    async.mapSeries(repos, (repo, repoCb) => {
      if (!repo.match(repoRegex)) return repoCb();

      const repoPath = bosco.getRepoPath(repo);
      stash(bosco, args, progressbar, bar, repoPath, repoCb);
    }, () => {
      cb();
    });
  }

  stashRepos(() => {
    bosco.log('Complete');
  });
}

module.exports.cmd = cmd;
