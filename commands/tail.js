var _ = require('lodash');
var async = require('async');
var pm2 = require('pm2');
var Tail = require('tail').Tail;

module.exports = {
  name: 'tail',
  description: 'Tails the logs from pm2',
  usage: '[out|err] [-r <repoPattern>]',
  cmd: cmd
}

function cmd(bosco, args) {
  var repoPattern = bosco.options.repo;
  var repoRegex = new RegExp(repoPattern);

  // Connect or launch PM2
  pm2.connect(function(err) {
    if (err) {
      bosco.error(err);
      return;
    }

    var describeRunningServices = function(running) {
      async.map(running, function(repo, next) {
        if (repo.match(repoRegex)) {
          pm2.describe(repo, function(err, list) {
            if (err) {
              bosco.error(err);
              return;
            }
            var file = list[0].pm2_env.pm_out_log_path;
            if (args[0] == 'err') {
              file = list[0].pm2_env.pm_err_log_path;
            }
            bosco.log('Tailing ' + file);
            var tail = new Tail(file);

            tail.on('line', function(data) {
              console.log(repo + ' ' + data);
            });

            tail.on('error', function(error) {
              bosco.error(error);
            });
          });
        } else {
          next();
        }
      }, function(err) {
        if (err) {
          bosco.error(err);
          process.exit(1);
        }
        process.exit(0);
      });
    }

    var getRunningServices = function(next) {
      pm2.list(function(err, list) {
        next(err, _.pluck(list,'name'));
      });
    }

    getRunningServices(function(err, running) {
      describeRunningServices(running);
    });
  });
}

