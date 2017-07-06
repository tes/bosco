/**
 * Wrapper to manage services via PM2
 */
var childProcess = require('child_process');
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

    if (!detailed) return next(err, _.map(filteredList, 'name'));
    next(err, filteredList);
  });
};

/**
 * List services that have been created but are not running
 */
Runner.prototype.listNotRunning = function(detailed, next) {
  pm2.list(function(err, list) {
    var filteredList = _.filter(list, function(pm2Process) { return pm2Process.pm2_env.status !== 'online'; });

    if (!detailed) return next(err, _.map(filteredList, 'name'));
    next(err, filteredList);
  });
};

Runner.prototype.getInterpreter = function(bosco, options, next) {
  var self = this;
  var interpreter;
  var hadError;
  var error;
  var installing;
  var found = false;
  var hasNvmRc = bosco.exists(path.join(options.cwd, '.nvmrc'));
  if (hasNvmRc) {
    var e = childProcess.exec(bosco.options.nvmWhich, {cwd: options.cwd});
    e.stdout.setEncoding('utf8');
    e.stderr.setEncoding('utf8');

    e.stdout.on('data', function(data) {
      if (data.indexOf('Found') === 0) {
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
        if (data.indexOf('No .nvmrc file found') === 0) {
          // Use default
        } else {
          error = options.name + ' nvm failed with: ' + data.replace('\n', '') + ', use -i option to install missing node versions!';
          if (bosco.options['install-missing']) {
            installing = true;
            self.installNode(bosco, options, function(err) {
              if (err) return next(err);
              self.getInterpreter(bosco, options, next);
            });
          }
        }
      }
    });

    e.on('close', function() {
      if (interpreter && bosco.options.verbose) {
        bosco.log(options.name + ' using .nvmrc: ' + interpreter.cyan);
      }
      if (!installing) {
        return next(error, interpreter);
      }
    });
  } else {
    if (bosco.options.verbose) {
      bosco.log(options.name + ' no .nvmrc found, using nvm default ...');
    }
    next();
  }
};

Runner.prototype.installNode = function(bosco, options, next) {
  bosco.log(options.name + ' installing required node version ...');
  var hasNvmRc = bosco.exists(path.join(options.cwd, '.nvmrc'));
  if (hasNvmRc) {
    childProcess.exec(bosco.options.nvmInstall, {cwd: options.cwd}, function(err, stdout, stderr) {
      next(stderr);
    });
  } else {
    next('You cant install node without an .nvmrc');
  }
};

Runner.prototype.getVersion = function(bosco, options, next) {
  childProcess.exec(bosco.options.nvmCurrent, {cwd: options.cwd}, function(err, stdout) {
    next(err, stdout.toString().replace('\n', ''));
  });
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
    self.bosco.error('Can\'t start ' + options.name.red + ', as I can\'t find script: ' + location.red);
    return next();
  }

  var startOptions = { name: options.name, cwd: options.cwd, watch: options.watch, executeCommand: executeCommand, autorestart: false, force: true, scriptArgs: scriptArgs };

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
      self.bosco.log('Starting ' + options.name.cyan);
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
