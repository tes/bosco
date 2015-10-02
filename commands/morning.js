var async = require('async');
var moment = require('moment');

module.exports = {
  name: 'morning',
  description: 'Runs clone, pull, installs and provides a summary of changes since your last morning command to get you ready for action for the day',
  cmd: cmd
}

function cmd(bosco, args) {
  var clone = require('./clone');
  var pull = require('./pull');
  var install = require('./install');
  var activity = require('./activity');

  var lastMorningRunConfigKey = 'events:last-morning-run';

  function executeClone(next) {
    clone.cmd(bosco, args, next);
  };

  function executePull(next) {
    pull.cmd(bosco, args, next);
  };

  function executeInstall(next) {
    install.cmd(bosco, args, next);
  };

  function showActivitySummary(next) {
    args.since = bosco.config.get(lastMorningRunConfigKey); // If it is not set it will default to some value on the activity command

    activity.cmd(bosco, args, next);
  };

  function setConfigKeyForLastMorningRun(next) {
    bosco.config.set(lastMorningRunConfigKey, moment().format());
    bosco.config.save(next);
  };

  async.series([executeClone, executePull, executeInstall, showActivitySummary, setConfigKeyForLastMorningRun], function() {
    bosco.log('Morning completed');
  });
}

