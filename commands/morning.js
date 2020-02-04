const moment = require('moment');
const figlet = require('figlet');

const clone = require('./clone');
const pullGit = require('./pull-git');
const pullDocker = require('./pull-docker');
const install = require('./install');
const activity = require('./activity');

module.exports = {
  name: 'morning',
  description: 'Runs clone, pull, installs and provides a summary of changes since your last morning command to get you ready for action for the day',
};

async function cmd(bosco, args) {
  const lastMorningRunConfigKey = 'events:last-morning-run';

  function executeClone() {
    return clone.cmd(bosco, args);
  }

  function executePullGit() {
    return pullGit.cmd(bosco, args);
  }

  function executePullDocker() {
    return pullDocker.cmd(bosco, args);
  }

  function executeInstall() {
    return install.cmd(bosco, args);
  }

  function showActivitySummary() {
    // If it is not set it will default to some value on the activity command
    args.since = bosco.config.get(lastMorningRunConfigKey); // eslint-disable-line no-param-reassign
    return new Promise((resolve, reject) => {
      activity.cmd(bosco, args, (err, ...rest) => (err ? reject(err) : resolve(...rest)));
    });
  }

  function setConfigKeyForLastMorningRun() {
    bosco.config.set(lastMorningRunConfigKey, moment().format());
    return new Promise((resolve, reject) => {
      bosco.config.save((err, ...rest) => (err ? reject(err) : resolve(...rest)));
    });
  }

  function readyToGo() {
    bosco.console.log(figlet.textSync("You're ready to go, fool!"));
    bosco.warn('Downloading docker images can take some time. You have all the code and are probably ready to go...\n');
  }

  try {
    await executeClone();
    await executePullGit();
    await executeInstall();
    await showActivitySummary();
    readyToGo();
    await executePullDocker();
    await setConfigKeyForLastMorningRun();

    bosco.log('Morning completed');
    bosco.logErrorStack();
  } catch (err) {
    bosco.err(err);
  }
}

module.exports.cmd = cmd;
