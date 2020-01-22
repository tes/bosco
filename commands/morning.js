const async = require('async');
const moment = require('moment');
const figlet = require('figlet');

module.exports = {
  name: 'morning',
  description: 'Runs clone, pull, installs and provides a summary of changes since your last morning command to get you ready for action for the day',
};

function cmd(bosco, args) {
  const clone = require('./clone');
  const pullGit = require('./pull-git');
  const pullDocker = require('./pull-docker');
  const install = require('./install');
  const activity = require('./activity');

  const lastMorningRunConfigKey = 'events:last-morning-run';

  function executeClone(next) {
    clone.cmd(bosco, args, next);
  }

  function executePullGit(next) {
    pullGit.cmd(bosco, args, next);
  }

  function executePullDocker(next) {
    pullDocker.cmd(bosco, args, next);
  }

  function executeInstall(next) {
    install.cmd(bosco, args, next);
  }

  function showActivitySummary(next) {
    args.since = bosco.config.get(lastMorningRunConfigKey); // If it is not set it will default to some value on the activity command
    activity.cmd(bosco, args, next);
  }

  function setConfigKeyForLastMorningRun(next) {
    bosco.config.set(lastMorningRunConfigKey, moment().format());
    bosco.config.save(next);
  }

  function readyToGo(next) {
    figlet("You're ready to go, fool!", (err, data) => {
      if (data) {
        bosco.console.log(data);
        bosco.warn('Downloading docker images can take some time. You have all the code and are probably ready to go...\n');
      }
      next();
    });
  }


  async.series([executeClone, executePullGit, executeInstall, showActivitySummary, readyToGo, executePullDocker, setConfigKeyForLastMorningRun], () => {
    bosco.log('Morning completed');
    bosco.logErrorStack();
  });
}

module.exports.cmd = cmd;
