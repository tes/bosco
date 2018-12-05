var spawn = require('child_process').spawn;
var path = require('path');

function Runner() {
}

Runner.prototype.init = function (bosco, next) {
  this.bosco = bosco;
  next();
};

Runner.prototype.hasConfig = function (cwd) {
  if (!cwd) { return false; }
  return this.bosco.exists(path.join(cwd, 'docker-compose.yml')) || this.bosco.exists(path.join(cwd, 'docker-compose.yaml'));
};

Runner.prototype.list = function (options, next) {
  var installed = true;
  spawn('docker-compose', ['--version'], { cwd: options.cwd, stdio: 'ignore' })
    .on('error', function () {
      installed = false;
      return next(null, []);
    }).on('exit', function () {
      if (installed) { return next(null, ['docker-compose']); }
    });
};

Runner.prototype.stop = function (options, next) {
  var hasConfigFile = this.hasConfig(options.cwd);
  if (!hasConfigFile) {
    this.bosco.error('Service ' + options.name.cyan + ' claims to be docker-compose but doesnt have a docker-compose.yaml file! Skipping ...');
    return next();
  }
  spawn('docker-compose', ['stop'], { cwd: options.cwd, stdio: 'inherit' }).on('exit', next);
};

Runner.prototype.start = function (options, next) {
  var hasConfigFile = this.hasConfig(options.cwd);
  if (!hasConfigFile) {
    this.bosco.error('Service ' + options.name.cyan + ' claims to be docker-compose but doesnt have a docker-compose.yaml file! Skipping ...');
    return next();
  }
  spawn('docker-compose', ['up', '-d'], { cwd: options.cwd, stdio: 'inherit' }).on('exit', next);
};

module.exports = new Runner();
