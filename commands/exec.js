const _ = require('lodash');

module.exports = {
  name: 'exec',
  description: 'Runs arbitrary commands across all services - take care!',
  usage: '[-r <repoRegex>] -- <command>',
};

function cmd(bosco, args) {
  const stringCommand = args.join(' ');
  const command = args[0];
  const cmdArgs = _.tail(args);

  bosco.log(`Running "${stringCommand.green}" across all matching repos ...`);

  const options = bosco.cmdHelper.createOptions({
    cmd: command,
    args: cmdArgs,
    init(innerBosco, child, repoPath) {
      innerBosco.log(`Starting output stream for: ${repoPath.green}`);
      child.stdin.end();
      child.stdout.pipe(process.stdout);
      child.stderr.pipe(process.stderr);
    },
  });

  bosco.cmdHelper.iterate(options, (err) => {
    if (err) bosco.error(err);
    bosco.log('Complete');
  });
}

module.exports.cmd = cmd;
