module.exports = function Utils(bosco) {
  function ensureCorrectNodeVersion(rawCommand, interpreter) {
    return (interpreter ? bosco.options.nvmUse : bosco.options.nvmUseDefault) + rawCommand;
  }

  function createCommand(buildConfig, interpreter, watch) {
    let commandForLog;
    let command;
    let ready;
    let timeout;
    let args;
    if (watch) {
      const watchConfig = buildConfig.watch || {};
      ready = watchConfig.ready || 'finished';
      timeout = watchConfig.timeout || 10000;
      command = watchConfig.command || buildConfig.command;
      commandForLog = command;
    } else {
      command = buildConfig.command; // eslint-disable-line prefer-destructuring
      commandForLog = command;
      const arrayCommand = Array.isArray(command);
      if (arrayCommand) {
        commandForLog = JSON.stringify(command);
        args = command;
        command = args.shift();
      }
    }
    command = ensureCorrectNodeVersion(command, interpreter);
    return {
      command, args, log: commandForLog, watch, ready, timeout,
    };
  }

  return {
    createCommand,
  };
};
