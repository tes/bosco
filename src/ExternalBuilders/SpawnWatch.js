const { spawn } = require('child_process');
const _ = require('lodash');

module.exports = function SpawnWatch(bosco) {
  return (service, command, cwd, verbose, buildFinished) => {
    bosco.log(`Spawning ${'watch'.cyan} command for ${service.name.blue}: ${command.log}`);
    const wc = spawn(process.env.SHELL, ['-c', command.command], cwd);
    let output = {
      state: 'starting', data: [], stdout: '', stderr: '',
    };
    let outputCache;
    let outputCacheIndex;
    let overallTimeoutTimer;

    function addOutput(type, data) {
      output[type] += data;
      output.data.push({ type, data });
    }

    function reset() {
      output = {
        state: 'starting', data: [], stdout: '', stderr: '',
      };
      outputCache = '';
      outputCacheIndex = -1;
      if (overallTimeoutTimer) clearTimeout(overallTimeoutTimer);
      overallTimeoutTimer = null;
    }

    function buildCompleted(err) {
      const outputToReturn = _.clone(output);
      reset();
      return buildFinished(err, outputToReturn);
    }

    function onBuildTimeout() {
      const errorMessage = `Build timed out beyond ${command.timeout / 1000} seconds, likely the project build not writing out ready text: ${command.ready}\n`;
      output.state = 'timeout';
      addOutput('stderr', errorMessage);
      if (verbose) {
        bosco.error(errorMessage);
      }
      return buildCompleted();
    }

    function buildStarted() {
      bosco.log(`Started build command for ${service.name.blue} ...`);
      overallTimeoutTimer = setTimeout(onBuildTimeout, command.timeout);
    }

    function isBuildFinished() {
      output.data.forEach((entry, i) => {
        if (i <= outputCacheIndex) { return; }
        outputCache += entry.data;
        outputCacheIndex = i;
      });
      return outputCache.indexOf(command.ready) >= 0;
    }

    function onChildOutput(type, data) {
      if (!data) { return; }

      if (output.data.length < 1) {
        buildStarted();
      }

      addOutput(type, data.toString());
      if (verbose) {
        bosco.process[type].write(data.toString());
      }

      if (isBuildFinished()) {
        output.state = 'finished';
        buildCompleted();
      }
    }

    function onChildExit(code, signal) {
      const childError = new Error(`Watch process exited with code ${code} and signal ${signal}`);
      childError.code = code;
      childError.signal = signal;
      output.state = 'child-exit';
      addOutput('stderr', `${'Watch'.red} command for ${service.name.blue} died with code ${code}`);
      return buildCompleted(childError);
    }

    reset();
    wc.stdout.on('data', (data) => { onChildOutput('stdout', data); });
    wc.stderr.on('data', (data) => { onChildOutput('stderr', data); });
    wc.on('exit', onChildExit);
  };
};
