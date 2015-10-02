var async = require('async');

module.exports = {
  name:'restart',
  description:'Runs stop and then run with the same parameters - aka restart ;)',
  usage:'[-r <repoPattern>] [-t <tag>]',
  cmd:cmd
}

function cmd(bosco, args) {
  var stop = require('./stop');
  var run = require('./run');

  var executeStop = function(next) {
    stop.cmd(bosco, args, next);
  };

  var executeRun = function(repos, next) {
    if(repos.length === 0) return next();
    bosco.options.list = repos.join(',');
    run.cmd(bosco, args, next);
  };

  async.waterfall([executeStop, executeRun], function() {
    // Done
  });
}

