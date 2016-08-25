var NodeRunner = require('./RunWrappers/Node');
var SpawnWatch = require('./ExternalBuilders/SpawnWatch');
var ExecBuild = require('./ExternalBuilders/ExecBuild');
var BuildUtils = require('./ExternalBuilders/utils');

module.exports = function(bosco) {
  function doBuild(service, options, interpreter, next) {
    if (!service.build) return next();

    var buildUtils = new BuildUtils(bosco);
    var execBuildCommand = new ExecBuild(bosco);
    var spawnWatchCommand = new SpawnWatch(bosco);
    var verbose = bosco.options.verbose;
    var watchingService = options.watchBuilds && !!service.name.match(options.watchRegex);
    var command = buildUtils.createCommand(service.build, interpreter, watchingService);
    var cwd = {cwd: service.repoPath};
    var firstBuildCalledBack = false;

    function buildFinished(err, stdout, stderr) {
      // watch stderr output isn't considered fatal
      var realError = (err && err !== true) ? err : null;
      var hasError = err || stderr;
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
        if (hasError && !verbose) log += ':';
        bosco.log(log);
      }
      if (hasError && !verbose) {
        if (stdout) bosco.console.log(stdout);
        if (stderr) bosco.error(stderr);
      }
      if (!firstBuildCalledBack) {
        firstBuildCalledBack = true;
        next(realError);
      }
    }

    if (!watchingService) {
      return execBuildCommand(service, command, cwd, verbose, buildFinished);
    }

    if (options.reloadOnly) {
      bosco.warn('Not spawning watch command for ' + service.name.blue + ': change is triggered by external build tool');
      return next();
    }

    if (watchingService) {
      return spawnWatchCommand(service, command, cwd, verbose, buildFinished);
    }

    // No matching execution, nothing to build
    return next();
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
