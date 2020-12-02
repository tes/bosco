/**
 * Wrapper to manage services via PM2
 */
const childProcess = require('child_process');
const _ = require('lodash');
const path = require('path');
const Promise = require('bluebird');
const pm2 = require('pm2');

require('colors');

function Runner() {
}

Runner.prototype.init = function init(bosco, next) {
  this.bosco = bosco;
  if (next === undefined) {
    return new Promise((resolve, reject) => (
      pm2.connect((err, ...rest) => (err ? reject(err) : resolve(...rest)))
    ));
  }

  pm2.connect(next);
};

Runner.prototype.disconnect = function disconnect(next) {
  if (next === undefined) {
    return new Promise((resolve, reject) => (
      pm2.disconnect((err, ...rest) => (err ? reject(err) : resolve(...rest)))
    ));
  }

  pm2.disconnect(next);
};

/**
 * List running services
 */
Runner.prototype.listRunning = function listRunning(detailed) {
  return new Promise((resolve, reject) => {
    pm2.list((err, list) => {
      if (err) return reject(err);
      const filteredList = _.filter(list, (pm2Process) => pm2Process.pm2_env.status === 'online' || pm2Process.pm2_env.status === 'errored');

      if (!detailed) return resolve(_.map(filteredList, 'name'));
      resolve(filteredList);
    });
  });
};

/**
 * List services that have been created but are not running
 */
Runner.prototype.listNotRunning = function listNotRunning(detailed) {
  return new Promise((resolve, reject) => {
    pm2.list((err, list) => {
      if (err) return reject(err);
      const filteredList = _.filter(list, (pm2Process) => pm2Process.pm2_env.status !== 'online');

      if (!detailed) return resolve(_.map(filteredList, 'name'));
      resolve(filteredList);
    });
  });
};

Runner.prototype.getInterpreter = function getInterpreter(bosco, options, next) {
  const self = this;
  let interpreter;
  let hadError;
  let error;
  let installing;
  let found = false;
  const hasNvmRc = bosco.exists(path.join(options.cwd, '.nvmrc'));
  if (hasNvmRc && !bosco.options['system-node']) {
    const e = childProcess.exec(bosco.options.nvmWhich, { cwd: options.cwd });
    e.stdout.setEncoding('utf8');
    e.stderr.setEncoding('utf8');

    e.stdout.on('data', (data) => {
      if (data.indexOf('Found') === 0) {
        found = true;
        interpreter = data.replace(/.*\n/, '').replace('\n', '');
      } else if (found) {
        interpreter = data.replace('\n', '');
      }
    });

    e.stderr.on('data', (data) => {
      if (!hadError) {
        hadError = true;
        if (data.indexOf('No .nvmrc file found') === 0) {
          // Use default
        } else {
          error = `${options.name} nvm failed with: ${data.replace('\n', '')}, use -i option to install missing node versions!`;
          if (bosco.options['install-missing']) {
            installing = true;
            self.installNode(bosco, options, (err) => {
              if (err) return next(err);
              self.getInterpreter(bosco, options, next);
            });
          }
        }
      }
    });

    e.on('close', () => {
      if (interpreter && bosco.options.verbose) {
        bosco.log(`${options.name} using .nvmrc: ${interpreter.cyan}`);
      }
      if (!installing) {
        return next(error, interpreter);
      }
    });
  } else {
    if (bosco.options.verbose) {
      bosco.log(`${options.name} no .nvmrc found, using nvm default ...`);
    }
    next();
  }
};

Runner.prototype.installNode = function installNode(bosco, options, next) {
  bosco.log(`${options.name} installing required node version ...`);
  const hasNvmRc = bosco.exists(path.join(options.cwd, '.nvmrc'));
  if (hasNvmRc) {
    childProcess.exec(bosco.options.nvmInstall, { cwd: options.cwd }, (err, stdout, stderr) => {
      next(stderr);
    });
  } else {
    next('You cant install node without an .nvmrc');
  }
};

Runner.prototype.getVersion = function getVersion(bosco, options) {
  return new Promise((resolve, reject) => {
    this.getInterpreter(bosco, options, (interpreterErr, interpreter) => {
      if (interpreterErr) { return reject(interpreterErr); }
      const nvm = (interpreter && bosco.options.nvmUse) || bosco.options.nvmUseDefault;
      childProcess.exec(`${nvm}nvm current`, { cwd: options.cwd }, (execErr, stdout, stderr) => {
        if (execErr || stderr) { return reject(execErr || new Error(stderr)); }
        resolve((stdout.match(/[^\n]+/g) || []).pop());
      });
    });
  });
};

Runner.prototype.getHashes = function getHashes(bosco, files, options) {
  function getHash(file) {
    return new Promise((resolve) => {
      childProcess.exec(`git hash-object ${path.join(options.cwd, file)}`, { cwd: options.cwd }, (err, stdout) => {
        resolve(stdout.replace('\n', ''));
      });
    });
  }

  return Promise.mapSeries(files, getHash)
    .then((hashes) => hashes.join('.'))
    .catch(() => '');
};

/**
 * Start a specific service
 * options = {cmd, cwd, name}
 */
Runner.prototype.start = async function start(options) {
  const self = this;

  // Remove node from the start script as not req'd for PM2
  const startCmd = options.service.start;
  // eslint-disable-next-line no-shadow
  let start = startCmd;
  let startArr;

  if (startCmd.split(' ')[0] === 'node') {
    startArr = startCmd.split(' ');
    startArr.shift();
    start = startArr.join(' ');
  }

  // Always execute as a forked process to allow node version selection
  const executeCommand = true;

  // If the command has a -- in it then we know it is passing parameters
  // to pm2
  const argumentPos = start.indexOf(' -- ');
  let location = start;
  let scriptArgs = [];
  if (argumentPos > -1) {
    scriptArgs = start.substring(argumentPos + 4, start.length).split(' ');
    location = start.substring(0, argumentPos);
  }

  if (!path.extname(location)) location += '.js';

  if (!self.bosco.exists(`${options.cwd}/${location}`)) {
    self.bosco.error(`Can't start ${options.name.red}, as I can't find script: ${location.red}`);
    return Promise.resolve();
  }

  const startOptions = {
    name: options.name, cwd: options.cwd, watch: options.watch, executeCommand, autorestart: false, force: true, scriptArgs,
  };

  const interpreter = await new Promise((resolve, reject) => {
    self.getInterpreter(this.bosco, options, (err, int) => {
      if (err) return reject(err);
      resolve(int);
    });
  });

  if (interpreter) {
    if (!self.bosco.exists(interpreter)) {
      self.bosco.warn(`Unable to locate node version requested: ${interpreter.cyan}.  Reverting to default.`);
    } else {
      startOptions.interpreter = interpreter;
      self.bosco.log(`Starting ${options.name.cyan} via ${interpreter} ...`);
    }
  } else {
    self.bosco.log(`Starting ${options.name.cyan}`);
  }

  await new Promise((resolve, reject) => {
    pm2.start(location, startOptions, (err, ...rest) => (err ? reject(err) : resolve(...rest)));
  });
};

/**
 * List running services
 */
Runner.prototype.stop = async function stop(options) {
  const self = this;
  self.bosco.log(`Stopping ${options.name.cyan}`);

  await new Promise((resolve, reject) => {
    pm2.stop(options.name, (stopErr) => (stopErr ? reject(stopErr) : resolve()));
  });

  await new Promise((resolve, reject) => {
    pm2.delete(options.name, (deleteErr) => (deleteErr ? reject(deleteErr) : resolve()));
  });
};

module.exports = new Runner();
