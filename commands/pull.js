const pullGit = require('./pull-git');
const pullDocker = require('./pull-docker');

module.exports = {
  name: 'pull',
  description: 'Pulls any changes across all repos',
  usage: '[-r <repoPattern>]',
  options: [{
    name: 'noremote',
    alias: 'nr',
    type: 'boolean',
    desc: 'Do not pull docker images for remote repositories (dependencies)',
  }],
};

async function cmd(bosco, args) {
  function executePullGit() {
    return pullGit.cmd(bosco, args);
  }

  function executePullDocker() {
    return pullDocker.cmd(bosco, args);
  }

  try {
    await executePullGit();
    await executePullDocker();

    bosco.log('Complete!');
  } catch (err) {
    bosco.err(err);
  }
}

module.exports.cmd = cmd;
