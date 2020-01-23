const async = require('async');
const { exec } = require('child_process');

const green = '\u001b[42m \u001b[0m';
const red = '\u001b[41m \u001b[0m';

module.exports = {
  name: 'clean-modules',
  description: 'Cleans out node_modules and re-runs npm install against all repos',
  usage: '[-r <repoPattern>]',
};

function clean(bosco, progressbar, bar, repoPath, next) {
  const packageJson = [repoPath, 'package.json'].join('/');
  if (!bosco.exists(packageJson)) {
    if (progressbar) bar.tick();
    return next();
  }

  exec('rm -rf ./node_modules', {
    cwd: repoPath,
  }, (err, stdout, stderr) => {
    if (progressbar) bar.tick();
    if (err) {
      if (progressbar) bosco.console.log('');
      bosco.error(`${repoPath.blue} >> ${stderr}`);
    } else if (!progressbar) {
      bosco.log(`Cleaned node modules for ${repoPath.blue}`);
    }
    next();
  });
}

function cmd(bosco, args, next) {
  const repoPattern = bosco.options.repo;
  const repoRegex = new RegExp(repoPattern);

  const repos = bosco.getRepos();
  if (!repos) return bosco.error('You are repo-less :( You need to initialise bosco first, try \'bosco clone\'.');

  bosco.log('Clearing out node modules and re-running npm install across all repos ...');

  function cleanRepos(cb) {
    const progressbar = bosco.config.get('progress') === 'bar';
    const total = repos.length;

    const bar = progressbar ? new bosco.Progress('Doing clean and npm install [:bar] :percent :etas', {
      complete: green,
      incomplete: red,
      width: 50,
      total,
    }) : null;

    async.mapLimit(repos, bosco.concurrency.network, (repo, repoCb) => {
      if (!repo.match(repoRegex)) return repoCb();

      const repoPath = bosco.getRepoPath(repo);
      clean(bosco, progressbar, bar, repoPath, repoCb);
    }, () => {
      cb();
    });
  }

  cleanRepos(() => {
    bosco.log('Complete');
    if (next) next();
  });
}

module.exports.cmd = cmd;
