var async = require('async');
var symlink = require('symlink');
var exec = require('child_process').exec;

module.exports = {
  name: 'link',
  description: 'Automatically npm links any project in a workspace with any other project that depends on it',
  cmd: cmd
}

function cmd(bosco, args, next) {
  var commands;

  var getCommands = function(next) {
    var workspacePath = bosco.getWorkspacePath();
    symlink(workspacePath, false, function (err, cmds) {
      commands = cmds;
      next(err, cmds);
    });
  }

  var executeCommands = function(next) {
    async.mapSeries(commands, executeCommand, next);
  }

  var executeCommand = function(command, next) {
    execCmd(bosco, command, bosco.getWorkspacePath(), next);
  }

  bosco.log('Auto linking modules together and installing deps ...')

  async.series([
    getCommands,
    executeCommands
  ], function() {
    bosco.log('Completed linking modules.');
    if(next) { next(); }
  })
}

function execCmd(bosco, cmd, repoPath, next) {
  bosco.log(repoPath.blue + ': Running ' + cmd.green + ' ...');
  exec(cmd, {
    cwd: repoPath
  }, function(err, stdout) {
    next(err, stdout);
  });
}
