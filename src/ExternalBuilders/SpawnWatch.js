var spawn = require('child_process').spawn;

module.exports = function(bosco) {
  return function(service, command, cwd, verbose, buildFinished) {
    bosco.log('Spawning ' + 'watch'.red + ' command for ' + service.name.blue + ': ' + command.log);
    var wc = spawn(process.env.SHELL, ['-c', command.command], cwd);
    var output;
    var outputCache;
    var outputCacheIndex;
    var overallTimeoutTimer;

    function reset() {
      output = [];
      outputCache = '';
      outputCacheIndex = -1;
      if (overallTimeoutTimer) clearTimeout(overallTimeoutTimer);
      overallTimeoutTimer = null;
    }

    function buildCompleted(err) {
      var rtn = buildFinished(err, output);
      reset();
      return rtn;
    }

    function onBuildTimeout() {
      var errorMessage = 'Build timed out beyond ' + command.timeout / 1000 + ' seconds';
      bosco.error(errorMessage + ', likely an issue with the project build - you may need to check locally. Was looking for: ' + command.ready);
      wc.kill();
      return buildCompleted(new Error(errorMessage));
    }

    function buildStarted() {
      bosco.log('Started build command for ' + service.name.blue + ' ...');
      overallTimeoutTimer = setTimeout(onBuildTimeout, command.timeout);
    }

    function isBuildFinished() {
      output.forEach(function(entry, i) {
        if (i <= outputCacheIndex) { return; }
        outputCache += entry.data;
        outputCacheIndex = i;
      });
      return outputCache.indexOf(command.ready) >= 0;
    }

    function onChildOutput(type, data) {
      if (!data) { return; }

      if (output.length < 1) {
        buildStarted();
      }

      output.push({type: type, data: data.toString()});
      if (verbose) {
        bosco.process[type].write(data.toString());
      }

      if (isBuildFinished()) {
        buildCompleted();
      }
    }

    function onChildExit(code, signal) {
      var childError = new Error('Watch process exited with code ' + code + ' and signal ' + signal);
      childError.code = code;
      childError.signal = signal;
      bosco.error('Watch'.red + ' command for ' + service.name.blue + ' died with code ' + code);
      return buildCompleted(childError);
    }

    reset();
    wc.stdout.on('data', function(data) { onChildOutput('stdout', data); });
    wc.stderr.on('data', function(data) { onChildOutput('stderr', data); });
    wc.on('exit', onChildExit);
  };
};
