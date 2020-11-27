const { exec } = require('child_process');
const { execFile } = require('child_process');

module.exports = function ExecBuild(bosco) {
  return (service, command, cwd, verbose, buildFinished) => {
    bosco.log(`Running build command for ${service.name.blue}: ${command.log}`);
    if (command.args) {
      return execFile(command.command, command.args, cwd, buildFinished);
    }
    return exec(command.command, cwd, buildFinished);
  };
};
