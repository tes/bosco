const { spawn } = require('child_process');
const path = require('path');

function Runner() {
}

Runner.prototype.init = function (bosco, next) {
  this.bosco = bosco;
  if (next) next();
};

Runner.prototype.hasConfig = function (cwd) {
  if (!cwd) { return false; }
  return this.bosco.exists(path.join(cwd, 'docker-compose.yml')) || this.bosco.exists(path.join(cwd, 'docker-compose.yaml'));
};

Runner.prototype.list = function (options) {
  let installed = true;

  return new Promise((resolve) => {
    spawn('docker-compose', ['--version'], { cwd: options.cwd, stdio: 'ignore' })
      .on('error', () => {
        installed = false;
        return resolve([]);
      }).on('exit', () => {
        if (installed) { return resolve(['docker-compose']); }
      });
  });
};

Runner.prototype.stop = function (options) {
  const hasConfigFile = this.hasConfig(options.cwd);
  if (!hasConfigFile) {
    this.bosco.error(`Service ${options.name.cyan} claims to be docker-compose but doesnt have a docker-compose.yaml file! Skipping ...`);
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    spawn('docker-compose', ['stop'], { cwd: options.cwd, stdio: 'inherit' })
      .on('exit', (err, ...rest) => (err ? reject(err) : resolve(...rest)));
  });
};

Runner.prototype.start = function (options) {
  const hasConfigFile = this.hasConfig(options.cwd);
  if (!hasConfigFile) {
    this.bosco.error(`Service ${options.name.cyan} claims to be docker-compose but doesnt have a docker-compose.yaml file! Skipping ...`);
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    spawn('docker-compose', ['up', '-d'], { cwd: options.cwd, stdio: 'inherit' })
      .on('exit', (err, ...rest) => (err ? reject(err) : resolve(...rest)));
  });
};

module.exports = new Runner();
