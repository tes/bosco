const async = require('async');
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


function cmd(bosco, args, next) {
  function executePullGit(cb) {
    pullGit.cmd(bosco, args, cb);
  }

  function executePullDocker(cb) {
    pullDocker.cmd(bosco, args, cb);
  }

  async.series([
    executePullGit,
    executePullDocker,
  ], () => {
    bosco.log('Complete!');
    if (next) next();
  });
}

module.exports.cmd = cmd;
