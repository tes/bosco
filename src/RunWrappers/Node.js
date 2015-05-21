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
}

Runner.prototype.disconnect = function(next) {
    pm2.disconnect(next);
}

/**
 * List running services
 */
Runner.prototype.listRunning = function(detailed, next) {
	pm2.list(function(err, list) {
		var filteredList = _.filter(list, function(pm2Process){ return pm2Process.pm2_env.status === 'online' || pm2Process.pm2_env.status === 'errored' })

		if(!detailed) return next(err, _.pluck(filteredList,'name'));
		next(err, filteredList);
	});
}

/**
 * List services that have been created but are not running
 */
Runner.prototype.listNotRunning = function(detailed, next) {
	pm2.list(function(err, list) {
		var filteredList = _.filter(list, function(pm2Process){ return pm2Process.pm2_env.status !== 'online' })

		if(!detailed) return next(err, _.pluck(filteredList,'name'));
		next(err, filteredList);
	});
}

/**
 * Start a specific service
 * options = {cmd, cwd, name}
 */
Runner.prototype.start = function(options, next) {

  var self = this;
  // Remove node from the start script as not req'd for PM2
  var startCmd = options.service.start;
  var startArr = startCmd.split(' ');
  var start;
  var ext;
  var interpreter;
  var scriptArgs;

  if(startArr[0] == 'node' || startArr[0] == 'babel-node') {
    if (startArr[0] == 'babel-node') {
      interpreter = 'babel-node';
    }
    startArr.shift();
    start = startArr.join(' ');

    ext = path.extname(startCmd);

    if(!path.extname(start)) {
      ext = '.js';
      start = start + '.js';
    }
  } else {
    start = startCmd;
  }

  var location = start;

  // If the command has a -- in it then we know it is passing parameters
  // to pm2
  var argumentPos = start.indexOf(' -- ');
  if (argumentPos > -1) {
    scriptArgs = start.substring(argumentPos + 4, start.length).split(' ');
    location = start.substring(0, argumentPos);
  }

  if(!self.bosco.exists(options.cwd + '/' + location)) {
    self.bosco.warn('Can\'t start ' + options.name.red + ', as I can\'t find script: ' + location.red);
    return next();
  }

  self.bosco.log('Starting ' + options.name.cyan + ' ...');

  var pm2Options = {
    name: options.name,
    cwd: options.cwd,
    force: true
  };

  // Node 0.10.x has a problem with cluster mode
  if (process.version.match(/0.10/) || ext != '.js') {
    pm2Options.executeCommand = true;
  }

  if (options.watch) {
    pm2Options.watch = options.watch;
  }

  if (scriptArgs && scriptArgs.length) {
    pm2Options.scriptArgs = scriptArgs;
  }

  if (interpreter) {
    pm2Options.interpreter = interpreter;
  }

  pm2.start(location, pm2Options, next);
}

/**
 * List running services
 */
Runner.prototype.stop = function(options, next) {
    var self = this;
	self.bosco.log('Stopping ' + options.name.cyan);
	pm2.stop(options.name, function(err) {
        if(err) return next(err);
 		pm2.delete(options.name, function(err) {
		  next(err);
		});
	});
}

module.exports = new Runner();
