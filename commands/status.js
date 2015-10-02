var ch = require('../src/CmdHelper');
var _ = require('lodash');

module.exports = {
  name:'status',
  description:'Checks git status across all services',
  usage:'[-r <repoPattern>]',
  cmd:cmd
}
var CHANGE_STRINGS = ['Changes not staged', 'Your branch is ahead', 'Untracked files', 'Changes to be committed'];
function cmd(bosco) {
  bosco.log('Running git status across all matching repos ...');

  var options = ch.createOptions(bosco, {
    cmd: 'git',
    args: ['-c', 'color.status=always', 'status'],
    guardFn: function(bosco, repoPath, options, next) {
      if(bosco.exists([repoPath,'.git'].join('/'))) return next();
      next(new Error('Doesn\'t seem to be a git repo: '+ repoPath.blue));
    },
    stdoutFn: function(stdout, path) {
      if (!stdout) return;

      function stdoutHasString(str) {
        return stdout.indexOf(str) >= 0;
      }

      if (_(CHANGE_STRINGS).some(stdoutHasString)) {
        bosco.log(path.blue + ':\n' + stdout);
      }
    }
  });

  ch.iterate(bosco, options, function() {
    bosco.log('Complete');
  });
}
