const _ = require('lodash');

module.exports = {
  name: 'status',
  description: 'Checks git status across all services',
  usage: '[-r <repoPattern>]',
};

const CHANGE_STRINGS = ['Changes not staged', 'Your branch is ahead', 'Untracked files', 'Changes to be committed'];

function cmd(bosco) {
  bosco.log('Running git status across all matching repos ...');

  const options = bosco.cmdHelper.createOptions({
    cmd: 'git',
    args: ['-c', 'color.status=always', 'status'],
    guardFn(innerBosco, repoPath, opts, next) {
      if (innerBosco.exists([repoPath, '.git'].join('/'))) return next();
      next(new Error(`Doesn't seem to be a git repo: ${repoPath.blue}`));
    },
    stdoutFn(stdout, path) {
      if (!stdout) return;

      function stdoutHasString(str) {
        return stdout.indexOf(str) >= 0;
      }

      if (_(CHANGE_STRINGS).some(stdoutHasString)) {
        bosco.log(`${path.blue}:\n${stdout}`);
      }
    },
  });

  bosco.cmdHelper.iterate(options, () => {
    bosco.log('Complete');
  });
}

module.exports.cmd = cmd;
