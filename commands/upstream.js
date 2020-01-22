const async = require('async');
const { exec } = require('child_process');

module.exports = {
  name: 'upstream',
  description: 'Runs a git fetch and tells you what has changed upstream for all your repos',
  usage: '[-r <repoPattern>]',
};

function upstream(bosco, orgPath, next) {
  exec('git fetch; git log HEAD..origin/master --oneline', {
    cwd: orgPath,
  }, (err, stdout, stderr) => {
    if (err) {
      bosco.error(stderr);
    } else if (stdout) {
      bosco.log(`Changes in ${orgPath.blue}`);
      bosco.console.log(stdout);
    } else {
      bosco.log(`${orgPath.blue}: ${'No Change'.green}`);
    }
    next(err);
  });
}

function cmd(bosco) {
  const repoPattern = bosco.options.repo;
  const repoRegex = new RegExp(repoPattern);

  const repos = bosco.getRepos();
  if (!repos) return bosco.error('You are repo-less :( You need to initialise bosco first, try \'bosco clone\'.');

  function changedRepos(cb) {
    async.mapLimit(repos, bosco.concurrency.network, (repo, repoCb) => {
      const repoPath = bosco.getRepoPath(repo);
      if (!repo.match(repoRegex)) return repoCb();
      upstream(bosco, repoPath, repoCb);
    }, () => {
      cb();
    });
  }

  bosco.log('Checking upstream origin for changes, this may take a while ...');

  changedRepos(() => {
    bosco.log('Complete');
  });
}

module.exports.cmd = cmd;
