const _ = require('lodash');
const async = require('async');
const pm2 = require('pm2');
const { Tail } = require('tail');

module.exports = {
  name: 'tail',
  description: 'Tails the logs from pm2',
  usage: '[out|err] [-r <repoPattern>]',
};

function cmd(bosco, args) {
  const repoPattern = bosco.options.repo;
  const repoRegex = new RegExp(repoPattern);

  // Connect or launch PM2
  pm2.connect((connectErr) => {
    if (connectErr) {
      bosco.error(connectErr);
      return;
    }

    function describeRunningServices(running) {
      async.map(running, (repo, next) => {
        if (repo.match(repoRegex)) {
          pm2.describe(repo, (describeErr, list) => {
            if (describeErr) {
              bosco.error(describeErr);
              return;
            }
            let file = list[0].pm2_env.pm_out_log_path;
            if (args[0] === 'err') {
              file = list[0].pm2_env.pm_err_log_path;
            }
            bosco.log(`Tailing ${file}`);
            const tail = new Tail(file);

            tail.on('line', (data) => {
              bosco.console.log(`${repo} ${data}`);
            });

            tail.on('error', (error) => {
              bosco.error(error);
            });
          });
        } else {
          next();
        }
      }, (err) => {
        if (err) {
          bosco.error(err);
          process.exit(1);
        }
        process.exit(0);
      });
    }

    function getRunningServices(next) {
      pm2.list((err, list) => {
        next(err, _.map(list, 'name'));
      });
    }

    getRunningServices((err, running) => {
      describeRunningServices(running);
    });
  });
}

module.exports.cmd = cmd;
