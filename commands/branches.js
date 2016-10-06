var ch = require('../src/CmdHelper');
var _ = require('lodash');

module.exports = {
  name: 'branches',
  description: 'Checks git branch list across all services',
  usage: '[-r <repoPattern>]',
};

function cmd(bosco) {
  bosco.log('Running \'git branch --list\' across all matching repos ...');

  var options = ch.createOptions(bosco, {
    cmd: 'git',
    args: ['branch', '--list'],
    guardFn: function(innerBosco, repoPath, opts, next) {
      if (innerBosco.exists([repoPath, '.git'].join('/'))) return next();
      next(new Error('Doesn\'t seem to be a git repo: ' + repoPath.blue));
    },
    stdoutFn: function(stdout, path) {
      if (!stdout) return;

      // find the line in the stdout with the * in front, and grab the branch name
      var activeBranch = stdout.match(/\* (.*)/)[1];

      if (activeBranch !== 'master') {
        bosco.log(path.blue + ' is on branch \'' + activeBranch + '\'');
      }
    },
  });

  ch.iterate(bosco, options, function() {
    bosco.log('Complete');
  });
}

module.exports.cmd = cmd;
