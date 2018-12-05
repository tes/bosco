var async = require('async');
var _ = require('lodash');
var spawn = require('child_process').spawn;
var hl = require('highland');
var globalRunOptions = require('../config/options');

function guardFn(bosco, repoPath, options, next) {
  next();
}

/**
 * Helper functions to reduce repetition and boiler plate in commands
 */
function createOptions(bosco, givenOptions) {
  var options = _.defaults(givenOptions, {
    cmd: 'echo',
    args: ['NO COMMAND DEFINED!'],
    guardFn: guardFn,
    dieOnError: false
  });

  if (!options.init) {
    if (options.stdoutFn === undefined) {
      options.stdoutFn = function (stdout, repoPath) {
        bosco.error(repoPath.green + ' >> ' + stdout);
      };
    }

    if (options.stderrFn === undefined) {
      options.stderrFn = function (stderr, repoPath) {
        bosco.error(repoPath.red + ' >> ' + stderr);
      };
    }
  }

  return options;
}

function execute(bosco, command, args, repoPath, options, next) {
  if (options.init && (options.stdoutFn || options.stderrFn)) {
    bosco.error('command init and stdoutFn/stderrFn are not compatible.');
    return next(Error('Bad command'));
  }

  var stdio = ['pipe', 'pipe', 'pipe'];
  var count = 1;
  var returnCode;
  var error;

  var tryNext = function tryNext(err) {
    if (err) error = err;
    if (!(--count)) {
      if (error) return next(error);
      next(returnCode === 0 ? null : 'Process exited with status code ' + returnCode);
    }
  };

  if (!options.init) {
    stdio[0] = 'ignore';
    if (!options.stdoutFn) {
      stdio[1] = 'ignore';
    }
    if (!options.stderrFn) {
      stdio[2] = 'ignore';
    }
  }

  var sc = spawn(command, args, {
    cwd: repoPath,
    stdio: stdio
  });

  sc.on('error', function (err) {
    bosco.error('spawn error: ' + err);
  });

  if (stdio[1] !== 'ignore') {
    sc.stdio[1] = sc.stdout = hl(sc.stdout);

    if (options.stdoutFn) {
      count++;
      sc.stdout.toArray(function (stdout) {
        var fullStdout = stdout.join('');
        if (fullStdout.length) {
          if (options.stdoutFn.length === 3) {
            return options.stdoutFn(fullStdout, repoPath, tryNext);
          }
          options.stdoutFn(fullStdout, repoPath);
        }
        tryNext();
      });
    }
  }

  if (stdio[2] !== 'ignore') {
    sc.stdio[2] = sc.stderr = hl(sc.stderr);

    if (options.stderrFn) {
      count++;
      sc.stderr.toArray(function (stderr) {
        var fullStderr = stderr.join('');
        if (fullStderr.length) {
          if (options.stderrFn.length === 3) {
            return options.stderrFn(fullStderr, repoPath, tryNext);
          }
          options.stderrFn(fullStderr, repoPath);
        }
        tryNext();
      });
    }
  }

  if (options.init) {
    options.init(bosco, sc, repoPath);
  }

  sc.on('close', function (code) {
    returnCode = code;
    tryNext();
  });
}

function iterate(bosco, options, next) {
  var repoPattern = bosco.options.repo;
  var repoRegex = new RegExp(repoPattern);
  var repos = bosco.getRepos();
  if (!repos) return bosco.error('You are repo-less :( You need to initialise bosco first, try \'bosco clone\'.');

  async.mapLimit(repos, bosco.options.cpus, function (repo, repoCb) {
    if (!repo.match(repoRegex)) return repoCb();

    var repoPath = bosco.getRepoPath(repo);

    options.guardFn(bosco, repoPath, options, function (err) {
      if (err) return repoCb(err);
      execute(bosco, options.cmd, options.args, repoPath, options, repoCb);
    });
  }, function (err) {
    if (options.dieOnError) return next(err);
    next();
  });
}

function isDefaulOption(option, value) {
  var configOption = _.find(globalRunOptions, { name: option });

  return configOption && configOption.default === value;
}

function checkInService(bosco) {
  var onWorkspaceFolder = bosco.options.workspace === process.cwd();
  var hasDefaultRepoOption = !bosco.options.repo || isDefaulOption('repo', bosco.options.repo);
  var hasDefaultTagOption = !bosco.options.tag || isDefaulOption('tag', bosco.options.tag);

  // Tag and repo options take precendence over cwd
  if (!onWorkspaceFolder && hasDefaultRepoOption && hasDefaultTagOption) {
    bosco.options.service = true;
    bosco.checkInService();
    return true;
  }
  return false;
}

module.exports = {
  createOptions: createOptions,
  iterate: iterate,
  execute: execute,
  isDefaulOption: isDefaulOption,
  checkInService: checkInService
};
