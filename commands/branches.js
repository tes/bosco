module.exports = {
  name: 'branches',
  description: 'Checks git local branch name across all services',
  usage: '[-r <repoPattern>]'
};

function cmd(bosco) {
  bosco.log('Running \'git rev-parse --abbrev-ref HEAD\' across all matching repos ...');

  var options = bosco.cmdHelper.createOptions({
    cmd: 'git',
    args: ['rev-parse', '--abbrev-ref', 'HEAD'],
    guardFn: function (innerBosco, repoPath, opts, next) {
      if (innerBosco.exists([repoPath, '.git'].join('/'))) return next();
      next(new Error('Doesn\'t seem to be a git repo: ' + repoPath.blue));
    },
    stdoutFn: function (stdout, path) {
      if (!stdout) return;

      var branchName = stdout.trim();

      if (branchName !== 'master') {
        bosco.log(path.blue + ' is on branch \'' + branchName.cyan + '\'');
      }
    }
  });

  bosco.cmdHelper.iterate(options, function () {
    bosco.log('Complete');
  });
}

module.exports.cmd = cmd;
