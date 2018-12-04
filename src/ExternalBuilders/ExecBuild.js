var exec = require('child_process').exec;
var execFile = require('child_process').execFile;

module.exports = function (bosco) {
  return function (service, command, cwd, verbose, buildFinished) {
    bosco.log('Running build command for ' + service.name.blue + ': ' + command.log);
    if (command.args) {
      return execFile(command.command, command.args, cwd, buildFinished);
    }
    return exec(command.command, cwd, buildFinished);
  };
};
