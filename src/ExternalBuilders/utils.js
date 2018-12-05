module.exports = function (bosco) {
  function ensureCorrectNodeVersion(rawCommand, interpreter) {
    return (interpreter ? bosco.options.nvmUse : bosco.options.nvmUseDefault) + rawCommand;
  }

  function createCommand(buildConfig, interpreter, watch) {
    var commandForLog;
    var command;
    var ready;
    var timeout;
    var args;
    if (watch) {
      var watchConfig = buildConfig.watch || {};
      ready = watchConfig.ready || 'finished';
      timeout = watchConfig.timeout || 10000;
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
    return {
      command: command, args: args, log: commandForLog, watch: watch, ready: ready, timeout: timeout
    };
  }

  return {
    createCommand: createCommand
  };
};
