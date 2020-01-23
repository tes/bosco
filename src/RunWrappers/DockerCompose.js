const { spawn } = require('child_process');
const path = require('path');

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
  let installed = true;
  spawn('docker-compose', ['--version'], { cwd: options.cwd, stdio: 'ignore' })
    .on('error', () => {
      installed = false;
      return next(null, []);
    }).on('exit', () => {
      if (installed) { return next(null, ['docker-compose']); }
    });
};

Runner.prototype.stop = function (options, next) {
  const hasConfigFile = this.hasConfig(options.cwd);
  if (!hasConfigFile) {
    this.bosco.error(`Service ${options.name.cyan} claims to be docker-compose but doesnt have a docker-compose.yaml file! Skipping ...`);
    return next();
  }
  spawn('docker-compose', ['stop'], { cwd: options.cwd, stdio: 'inherit' }).on('exit', next);
};

Runner.prototype.start = function (options, next) {
  const hasConfigFile = this.hasConfig(options.cwd);
  if (!hasConfigFile) {
    this.bosco.error(`Service ${options.name.cyan} claims to be docker-compose but doesnt have a docker-compose.yaml file! Skipping ...`);
    return next();
  }
  spawn('docker-compose', ['up', '-d'], { cwd: options.cwd, stdio: 'inherit' }).on('exit', next);
};

module.exports = new Runner();
