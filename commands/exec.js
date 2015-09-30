var ch = require('../src/CmdHelper');
var _ = require('lodash');

module.exports = {
    name: 'exec',
    description: 'Runs arbitrary commands across all services - take care!',
    usage: '[-r <repoRegex>] -- <command>',
    cmd: cmd
}

function cmd(bosco, args) {

    var stringCommand = args.join(' '),
        command = args[0],
        cmdArgs = _.rest(args);

    bosco.log('Running "' + stringCommand.green + '" across all matching repos ...');

    var options = ch.createOptions(bosco, {
        cmd: command,
        args: cmdArgs,
        init: function(bosco, child, repoPath) {
            bosco.log('Starting output stream for: ' + repoPath.green);
            child.stdin.end();
            child.stdout.pipe(process.stdout);
            child.stderr.pipe(process.stderr);
        }
    });

    ch.iterate(bosco, options, function(err) {
        if (err) bosco.error(err);
        bosco.log('Complete');
    });
}
