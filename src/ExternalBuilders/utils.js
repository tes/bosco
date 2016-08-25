module.exports = function(bosco) {
  function ensureCorrectNodeVersion(rawCommand, interpreter) {
    return (interpreter ? bosco.options.nvmUse : bosco.options.nvmUseDefault) + rawCommand;
  }

  function createCommand(buildConfig, interpreter, watch) {
    var commandForLog;
    var command;
    var ready;
    var checkDelay;
    var timeout;
    var args;
    if (watch) {
      var watchConfig = buildConfig.watch || {};
      ready = watchConfig.ready || 'finished';
      checkDelay = watchConfig.checkDelay || 500;
      timeout = watchConfig.timeout || checkDelay * 100;
      command = watchConfig.command || buildConfig.command;
      commandForLog = command;
    } else {
      command = buildConfig.command;
      commandForLog = command;
      var arrayCommand = Array.isArray(command);
      if (arrayCommand) {
        commandForLog = JSON.stringify(command);
        args = command;
        command = args.shift();
      }
    }
    command = ensureCorrectNodeVersion(command, interpreter);
    return {command: command, args: args, log: commandForLog, watch: watch, ready: ready, checkDelay: checkDelay, timeout: timeout};
  }

  return {
    createCommand: createCommand,
  };
};
