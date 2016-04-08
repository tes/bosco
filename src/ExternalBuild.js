var exec = require('child_process').exec;
var execFile = require('child_process').execFile;
var spawn = require('child_process').spawn;
var NodeRunner = require('./RunWrappers/Node');

module.exports = function(bosco) {
  function doBuild(service, options, interpreter, next) {
    if (!service.build) return next();

    var watchBuilds = options.watchBuilds;
    var command = service.build.command;
    var commandForLog = command;
    var cwd = {cwd: service.repoPath};
    var arrayCommand = Array.isArray(command);
    var args;

    var buildFinished = function(err, stdout, stderr) {
      // watch stderr output isn't considered fatal
      var realError = (err && err !== true) ? err : null;
      var log;
      if (realError) {
        log = 'Failed'.red + ' build command for ' + service.name.blue;
        if (err.code !== null) {
          log += ' exited with code ' + err.code;
          if (err.signal !== null) log += ' and signal ' + err.signal;
        }

        if (stderr || stdout) log += ':';

        bosco.error(log);
      } else {
        log = 'Finished build command for ' + service.name.blue;
        if (stderr || stdout) log += ':';

        bosco.log(log);
      }

      if (err || stderr) {
        if (stdout) bosco.console.log(stdout);
        if (stderr) bosco.error(stderr);
      }

      next(realError);
    };

    if (arrayCommand) {
      commandForLog = JSON.stringify(command);
      args = command;
      command = args.shift();
    }

    function ensureCorrectNodeVersion(rawCommand) {
      return (interpreter ? bosco.options.nvmUse : bosco.options.nvmUseDefault) + rawCommand;
    }

    command = ensureCorrectNodeVersion(command);

    if (!watchBuilds || !service.name.match(options.watchRegex)) {
      bosco.log('Running build command for ' + service.name.blue + ': ' + commandForLog);
      if (arrayCommand) {
        return execFile(command, args, cwd, buildFinished);
      }
      return exec(command, cwd, buildFinished);
    }

    if (options.reloadOnly) {
      bosco.warn('Not spawning watch command for ' + service.name.blue + ': change is triggered by external build tool');
      return next();
    }

    var readyText = 'finished';
    var checkDelay = 500; // delay before checking for any stdout
    if (service.build.watch) {
      readyText = service.build.watch.ready || readyText;
      checkDelay = service.build.watch.checkDelay || checkDelay;
      if (service.build.watch.command) {
        var watchCommand = service.build.watch.command;
        commandForLog = watchCommand;
        command = ensureCorrectNodeVersion(watchCommand);
      }
    }

    bosco.log('Spawning ' + 'watch'.red + ' command for ' + service.name.blue + ': ' + commandForLog);

    var wc = spawn(process.env.SHELL, ['-c', command], cwd);
    var output = '';
    var childError = null;
    var calledReady = false;
    var timeout = checkDelay * 100; // Seems reasonable for build cycle
    var timer = 0;
    var watchBuildFinished;

    function checkFinished() {
      if (calledReady) return null;

      if (childError && childError !== true) {
        return watchBuildFinished(childError, '', output);
      }

      if (output.indexOf(readyText) >= 0) {
        return watchBuildFinished(childError, output);
      }

      timer = timer + checkDelay;
      if (timer < timeout) return setTimeout(checkFinished, checkDelay);

      bosco.error('Build timed out beyond ' + timeout / 1000 + ' seconds, likely an issue with the project build - you may need to check locally. Was looking for: ' + readyText);

      childError = new Error('build timed out beyond ' + timeout / 1000 + ' seconds');
      wc.kill();
      checkFinished();
    }

    wc.on('exit', function(code, signal) {
      if (!childError || childError === true) {
        // any exit of a watch process is an error.
        childError = new Error('Watch process exited with code ' + code + ' and signal ' + signal);
        childError.code = code;
        childError.signal = signal;
      }

      if (calledReady) {
        bosco.error('Watch'.red + ' command for ' + service.name.blue + ' died with code ' + code);
      }
    });

    wc.stdout.on('data', function(data) {
      if (!calledReady) {
        output += data.toString();
      }
    });

    watchBuildFinished = function() {
      clearTimeout(checkFinished);
      calledReady = true;
      output = '';
      buildFinished.apply(this, arguments);
    };

    wc.stderr.on('data', function(data) {
      childError = true;
      if (calledReady) {
        bosco.error('Watch'.red + ' command for ' + service.name.blue + ' stderr:\n' + data.toString());
      } else {
        output += data.toString();
      }
    });

    checkFinished();
  }

  function doBuildWithInterpreter(service, options, next) {
    NodeRunner.getInterpreter(bosco, {name: service.name, cwd: service.repoPath}, function(err, interpreter) {
      if (err) return next({message: err});
      doBuild(service, options, interpreter, next);
    });
  }

  return {
    doBuildWithInterpreter: doBuildWithInterpreter,
    doBuild: doBuild,
  };
};
