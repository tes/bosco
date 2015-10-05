var async = require('async');
var symlink = require('symlink');
var exec = require('child_process').exec;

module.exports = {
  name: 'link',
  description: 'Automatically npm links any project in a workspace with any other project that depends on it',
};

function execCmd(bosco, command, repoPath, next) {
  bosco.log(repoPath.blue + ': Running ' + command.green + ' ...');
  exec(command, {
    cwd: repoPath,
  }, function(err, stdout) {
    next(err, stdout);
  });
}

function cmd(bosco, args, done) {
  var commands;

  function getCommands(next) {
    var workspacePath = bosco.getWorkspacePath();
    symlink(workspacePath, false, function(err, cmds) {
      commands = cmds;
      next(err, cmds);
    });
  }

  function executeCommand(command, next) {
    execCmd(bosco, command, bosco.getWorkspacePath(), next);
  }

  function executeCommands(next) {
    async.mapSeries(commands, executeCommand, next);
  }

  bosco.log('Auto linking modules together and installing deps ...');

  async.series([
    getCommands,
    executeCommands,
  ], function() {
    bosco.log('Completed linking modules.');
    if (done) done();
  });
}

module.exports.cmd = cmd;
