/**
 * Wrapper to manage services via PM2
 */
var _ = require('lodash');
var path = require('path');
var pm2 = require('pm2');

require('colors');

function Runner() {
}

Runner.prototype.init = function(bosco, next) {
  this.bosco = bosco;
  pm2.connect(next);
};

Runner.prototype.disconnect = function(next) {
  pm2.disconnect(next);
};

/**
 * List running services
 */
Runner.prototype.listRunning = function(detailed, next) {
  pm2.list(function(err, list) {
    var filteredList = _.filter(list, function(pm2Process) { return pm2Process.pm2_env.status === 'online' || pm2Process.pm2_env.status === 'errored'; });

    if (!detailed) return next(err, _.pluck(filteredList, 'name'));
    next(err, filteredList);
  });
};

/**
 * List services that have been created but are not running
 */
Runner.prototype.listNotRunning = function(detailed, next) {
  pm2.list(function(err, list) {
    var filteredList = _.filter(list, function(pm2Process) { return pm2Process.pm2_env.status !== 'online'; });

    if (!detailed) return next(err, _.pluck(filteredList, 'name'));
    next(err, filteredList);
  });
};

Runner.prototype.getInterpreter = function(bosco, options, next) {
  var exec = require('child_process').exec;
  var interpreter;
  var hadError;
  var error;
  var found = false;
  var hasNvmRc = bosco.exists(path.join(options.repoPath || options.cwd, '.nvmrc'));
  if (hasNvmRc) {
    var e = exec(bosco.options.nvmWhich, options.cwd);

    e.stdout.on('data', function(data) {
      if (data.startsWith('Found')) {
        found = true;
      } else {
        if (found) {
          interpreter = data.replace('\n', '');
        }
      }
    });

    e.stderr.on('data', function(data) {
      if (!hadError) {
        hadError = true;
        if (data.startsWith('No .nvmrc file found')) {
          // Use default
        } else {
          error = options.name + ' nvm failed with: ' + data;
        }
      }
    });

    e.on('exit', function() {
      if (interpreter) {
        bosco.log('Using .nvmrc: ' + interpreter.cyan);
      } else {
        bosco.log('Using system node ...');
      }
      return next(error, interpreter);
    });

    e.on('error', next);
  } else {
    bosco.log('No .nvmrc found, using system node ...');
    next();
  }
};

/**
 * Start a specific service
 * options = {cmd, cwd, name}
 */
Runner.prototype.start = function(options, next) {
  var self = this;

  // Remove node from the start script as not req'd for PM2
  var startCmd = options.service.start;
  var start = startCmd;
  var startArr;

  if (startCmd.split(' ')[0] === 'node') {
    startArr = startCmd.split(' ');
    startArr.shift();
    start = startArr.join(' ');

    if (!path.extname(start)) start = start + '.js';
  }

  // Always execute as a forked process to allow node version selection
  var executeCommand = true;

  // If the command has a -- in it then we know it is passing parameters
  // to pm2
  var argumentPos = start.indexOf(' -- ');
  var location = start;
  var scriptArgs = [];
  if (argumentPos > -1) {
    scriptArgs = start.substring(argumentPos + 4, start.length).split(' ');
    location = start.substring(0, argumentPos);
  }

  if (!self.bosco.exists(options.cwd + '/' + location)) {
    self.bosco.warn('Can\'t start ' + options.name.red + ', as I can\'t find script: ' + location.red);
    return next();
  }

  var startOptions = { name: options.name, cwd: options.cwd, watch: options.watch, executeCommand: executeCommand, force: true, scriptArgs: scriptArgs };

  self.getInterpreter(this.bosco, options, function(err, interpreter) {
    if (err) { return next(err); }

    if (interpreter) {
      if (!self.bosco.exists(interpreter)) {
        self.bosco.warn('Unable to locate node version requested: ' + interpreter.cyan + '.  Reverting to default.');
      } else {
        startOptions.interpreter = interpreter;
        self.bosco.log('Starting ' + options.name.cyan + ' via ' + interpreter + ' ...');
      }
    } else {
      self.bosco.log('Starting ' + options.name.cyan + ' via ...');
    }

    pm2.start(location, startOptions, next);
  });
};

/**
 * List running services
 */
Runner.prototype.stop = function(options, next) {
  var self = this;
  self.bosco.log('Stopping ' + options.name.cyan);
  pm2.stop(options.name, function(err) {
    if (err) return next(err);
    pm2.delete(options.name, function(err) {
      next(err);
    });
  });
};

module.exports = new Runner();
