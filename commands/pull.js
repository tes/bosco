var async = require('async');
var pullGit = require('./pull-git');
var pullDocker = require('./pull-docker');

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
  function executePullGit(next) {
    pullGit.cmd(bosco, args, next);
  }

  function executePullDocker(next) {
    pullDocker(bosco, args, next);
  }

  async.series([
    executePullGit,
    executePullDocker,
  ], function() {
    bosco.log('Complete!');
    if (next) next();
  });
}

module.exports.cmd = cmd;
