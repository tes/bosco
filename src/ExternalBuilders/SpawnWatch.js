var spawn = require('child_process').spawn;

module.exports = function(bosco) {
  return function(service, command, cwd, verbose, buildFinished) {
    bosco.log('Spawning ' + 'watch'.red + ' command for ' + service.name.blue + ': ' + command.log);
    var wc = spawn(process.env.SHELL, ['-c', command.command], cwd);
    var output = '';
    var errorOutput = '';
    var childError = null;
    var checkFinishedTimer;
    var overallTimeout;
    var waitingForOutput = true;

    var watchBuildFinished = function(err, stdout, stderr) {
      clearTimeout(checkFinishedTimer);
      clearTimeout(overallTimeout);
      checkFinishedTimer = null;
      waitingForOutput = true;
      output = '';
      errorOutput = '';
      buildFinished(err, stdout, stderr);
    };

    var checkFinished = function() {
      if (childError && childError !== true) {
        return watchBuildFinished(childError, output, errorOutput);
      }
      if (output.indexOf(command.ready) >= 0) {
        return watchBuildFinished(childError, output);
      }
      checkFinishedTimer = setTimeout(checkFinished, command.checkDelay);
    };

    overallTimeout = setTimeout(function() {
      clearTimeout(checkFinishedTimer);
      bosco.error('Build timed out beyond ' + command.timeout / 1000 + ' seconds, likely an issue with the project build - you may need to check locally. Was looking for: ' + command.ready);
      childError = new Error('build timed out beyond ' + command.timeout / 1000 + ' seconds');
      wc.kill();
      return watchBuildFinished(childError, '', output);
    }, command.timeout);

    wc.on('exit', function(code, signal) {
      if (!childError || childError === true) {
        // any exit of a watch process is an error.
        childError = new Error('Watch process exited with code ' + code + ' and signal ' + signal);
        childError.code = code;
        childError.signal = signal;
      }
      bosco.error('Watch'.red + ' command for ' + service.name.blue + ' died with code ' + code);
    });

    wc.stdout.on('data', function(data) {
      if (waitingForOutput) {
        if (!checkFinishedTimer) checkFinished();
        waitingForOutput = false;
        bosco.log('Started build for service ' + service.name.blue + ' ...');
      }
      output += data.toString();
      if (verbose) {
        process.stdout.write(data.toString());
      }
    });

    wc.stderr.on('data', function(data) {
      if (waitingForOutput) {
        if (!checkFinishedTimer) checkFinished();
        waitingForOutput = false;
        bosco.log('Started build for service ' + service.name.blue + ', but immediately errored ...');
      }
      childError = true;
      errorOutput += data.toString();
      if (verbose) {
        process.stdout.write(data.toString());
      }
    });
  };
};
