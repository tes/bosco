module.exports = {
  name: 'branches',
  description: 'Checks git local branch name across all services',
  usage: '[-r <repoPattern>]',
};

function cmd(bosco) {
  bosco.log('Running \'git rev-parse --abbrev-ref HEAD\' across all matching repos ...');

  const options = bosco.cmdHelper.createOptions({
    cmd: 'git',
    args: ['rev-parse', '--abbrev-ref', 'HEAD'],
    guardFn(innerBosco, repoPath, opts, next) {
      if (innerBosco.exists([repoPath, '.git'].join('/'))) return next();
      next(new Error(`Doesn't seem to be a git repo: ${repoPath.blue}`));
    },
    stdoutFn(stdout, path) {
      if (!stdout) return;

      const branchName = stdout.trim();

      if (branchName !== 'master') {
        bosco.log(`${path.blue} is on branch '${branchName.cyan}'`);
      }
    },
  });

  bosco.cmdHelper.iterate(options, () => {
    bosco.log('Complete');
  });
}

module.exports.cmd = cmd;
