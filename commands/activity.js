var ch = require('../src/CmdHelper');
var execFile = require('child_process').execFile;
var moment = require('moment');

module.exports = {
  name: 'activity',
  description: 'Outputs a summary of activity on the repos',
  usage: '[-r <repoPattern>] [--since <ISO date>]',
  example: 'bosco activity -r <repoPattern> --since 2014-09-22T23:36:26-07:00',
  options: [{
    name: 'since',
    alias: 's',
    type: 'string',
    desc: 'Return all data after a ISO date',
  }],
};

var FORMAT = '%C(auto)%h %s %C(yellow)(%Cgreen%aN%C(yellow) %ad)%Creset';

function makeRepoActivityStdoutFn(bosco) {
  return function repoActivityStdoutFn(stdout, path, next) {
    var log = path.blue + ':\n' + stdout;
    var commitCount = log.match(/\n/g).length;
    var revOpts = ['--max-count=' + commitCount + 1, '--no-merges', '--count', 'HEAD'];
    execFile('git', ['rev-list'].concat(revOpts), {cwd: path}, function(err, cmdStdout, stderr) {
      if (err) {
        bosco.error(path.blue + ' >> ' + stderr);
        return next(err);
      }
      if (commitCount === +cmdStdout) log += '\n^^^^^^^ Repo was created'.green;
      bosco.log(log);
      next();
    });
  };
}

function cmd(bosco, args, next) {
  var since = bosco.options.since;

  if (!since) {
    since = moment().subtract(1, 'day').format();
  }
  bosco.log('Showing commits since ' + since);

  var options = ch.createOptions(bosco, {
    cmd: 'git',
    args: ['log', '--date=relative', '--pretty=format:' + FORMAT, '--no-merges', '--since=' + since],
    guardFn: function(innerBosco, repoPath, guardOptions, cb) {
      if (innerBosco.exists([repoPath, '.git'].join('/'))) return cb();
      cb(new Error('Doesn\'t seem to be a git repo: ' + repoPath.blue));
    },
    stdoutFn: makeRepoActivityStdoutFn(bosco),
  });

  ch.iterate(bosco, options, function() {
    bosco.log('Activity complete');

    if (next) next();
  });
}

module.exports.cmd = cmd;
