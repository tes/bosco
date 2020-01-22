const async = require('async');

module.exports = {
  name: 'restart',
  description: 'Runs stop and then run with the same parameters - aka restart ;)',
  usage: '[-r <repoPattern>] [-t <tag>]',
};

function cmd(bosco, args) {
  const stop = require('./stop');
  const run = require('./run');

  function executeStop(next) {
    stop.cmd(bosco, args, next);
  }

  function executeRun(repos, next) {
    if (repos.length === 0) return next();
    bosco.options.list = repos.join(',');
    run.cmd(bosco, args, next);
  }

  async.waterfall([executeStop, executeRun], () => {
    // Done
  });
}

module.exports.cmd = cmd;
