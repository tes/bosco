const async = require('async');
const { exec } = require('child_process');

module.exports = {
  name: 'commit',
  description: 'Run git commit across all repos - useful for batch updates',
  usage: '[-r <repoPattern>] \'<commit message>\'',
};

function confirm(bosco, message, next) {
  bosco.prompt.start();
  bosco.prompt.get({
    properties: {
      confirm: {
        description: message,
      },
    },
  }, (err, result) => {
    if (!result) return next({ message: 'Did not confirm' });

    if (result.confirm === 'Y' || result.confirm === 'y') {
      next(null, true);
    } else {
      next(null, false);
    }
  });
}

function commit(bosco, commitMsg, orgPath, next) {
  if (!bosco.exists([orgPath, '.git'].join('/'))) {
    bosco.warn(`Doesn't seem to be a git repo: ${orgPath.blue}`);
    return next();
  }

  confirm(bosco, `Confirm you want to commit any changes in: ${orgPath.blue} [y/N]`, (err, confirmed) => {
    if (err) return next(err);

    if (!confirmed) {
      bosco.log(`No commit done for ${orgPath.blue}`);
      return next();
    }

    const gitCmd = `git commit -am '${commitMsg}'`;

    exec(gitCmd, {
      cwd: orgPath,
    }, (execErr, stdout) => {
      if (execErr) {
        bosco.warn(`${orgPath.blue} >> No changes to commit.`);
      } else if (stdout) bosco.log(`${orgPath.blue} >> ${stdout}`);
      next();
    });
  });
}

function cmd(bosco, args) {
  const repos = bosco.getRepos();
  if (!repos) return bosco.error('You are repo-less :( You need to initialise bosco first, try \'bosco clone\'.');

  const repoPattern = bosco.options.repo;
  const message = args.shift();

  if (!message) return bosco.error('You need to supply at least a commit message.');

  if (args.shift()) {
    return bosco.error('You need to put your commit message in quotes: \'this is my message\'');
  }

  const repoRegex = new RegExp(repoPattern);

  bosco.log(`Running git commit -am across all repos that match ${repoRegex}...`);
  bosco.log(`Using message: ${message.blue}`);

  function commitRepos(cb) {
    async.mapSeries(repos, (repo, repoCb) => {
      const repoPath = bosco.getRepoPath(repo);
      if (repo.match(repoRegex)) {
        bosco.log(`Running 'git commit -am' on ${repo.blue}`);
        commit(bosco, message, repoPath, repoCb);
      } else {
        repoCb();
      }
    }, () => {
      cb();
    });
  }

  commitRepos(() => {
    bosco.log('Complete');
  });
}

module.exports.cmd = cmd;
