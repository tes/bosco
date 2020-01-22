const async = require('async');
const { exec } = require('child_process');

/*
 * this command is called pushall as there is a weird Node bug when calling the command 'push' - try bosco push to see.
 */

module.exports = {
  name: 'pushall',
  description: 'Will push any changes across all repos - useful for batch updates, typically used after bosco commit',
  usage: '[-r <repoPattern>]',
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

function countCommitsAhead(bosco, orgPath, next) {
  exec('git log origin/master..master | xargs cat | wc -l', {
    cwd: orgPath,
  }, (err, stdout, stderr) => {
    if (err) {
      bosco.error(`${orgPath.blue} >> ${stderr}`);
    } else if (stdout) return next(null, parseInt(stdout, 10));

    next(err, 0);
  });
}

function push(bosco, orgPath, repo, next) {
  if (!bosco.exists([orgPath, '.git'].join('/'))) {
    bosco.warn(`Doesn't seem to be a git repo: ${orgPath.blue}`);
    return next();
  }

  countCommitsAhead(bosco, orgPath, (err, commitsAhead) => {
    if (err) return next(err);

    if (!commitsAhead) {
      bosco.log(`Nothing to push for ${repo.blue}`);
      return next();
    }

    confirm(bosco, `Confirm you want to push: ${orgPath.blue} [y/N]`, (confirmErr, confirmed) => {
      if (confirmErr) return next(confirmErr);

      if (!confirmed) {
        bosco.log(`Not pushing ${repo.blue}`);
        return next();
      }

      exec('git push origin master', {
        cwd: orgPath,
      }, (execErr, stdout, stderr) => {
        if (err) {
          bosco.error(`${orgPath.blue} >> ${stderr}`);
        } else if (stdout) bosco.log(`${orgPath.blue} >> ${stdout}`);
        next(execErr);
      });
    });
  });
}

function cmd(bosco) {
  const repos = bosco.getRepos();
  if (!repos) return bosco.error('You are repo-less :( You need to initialise bosco first, try \'bosco clone\'.');

  const regex = bosco.options.repo;

  bosco.log(`Running git push across all repos that match ${regex}...`);

  function pushRepos(cb) {
    async.mapSeries(repos, (repo, repoCb) => {
      const repoPath = bosco.getRepoPath(repo);
      if (repo.match(regex)) {
        bosco.log(`Running git push on ${repo.blue}`);
        push(bosco, repoPath, repo, repoCb);
      } else {
        repoCb();
      }
    }, () => {
      cb();
    });
  }

  pushRepos(() => {
    bosco.log('Complete');
  });
}

module.exports.cmd = cmd;
