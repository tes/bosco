const url = require('url');
const fs = require('fs');
const _ = require('lodash');
const Promise = require('bluebird');
const Docker = require('dockerode');
const DockerUtils = require('./DockerUtils');

function Runner() {
}

Runner.prototype.init = function init(bosco, next) {
  this.bosco = bosco;

  function readCert(certPath, certFile) {
    return fs.readFileSync(`${certPath}/${certFile}`, { encoding: 'utf-8' });
  }

  if (process.env.DOCKER_HOST) {
    // We are likely on OSX and Boot2docker
    const dockerUrl = url.parse(process.env.DOCKER_HOST || 'tcp://127.0.0.1:3000');
    let dockerOpts = {
      host: dockerUrl.hostname,
      port: dockerUrl.port,
    };

    const dockerCertPath = process.env.DOCKER_CERT_PATH;
    if (dockerCertPath) {
      dockerOpts = _.extend(dockerOpts, {
        protocol: 'https',
        ca: readCert(dockerCertPath, 'ca.pem'),
        cert: readCert(dockerCertPath, 'cert.pem'),
        key: readCert(dockerCertPath, 'key.pem'),
      });
    }

    this.docker = new Docker(dockerOpts);
  } else {
    // Assume we are on linux and so connect on a socket
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
  }
  return next ? next() : Promise.resolve();
};

Runner.prototype.disconnect = function disconnect(next) {
  if (next) return next();
  return Promise.resolve();
};

Runner.prototype.list = function list(detailed) {
  const self = this;
  const { docker } = self;

  return docker.listContainers({
    all: false,
  }).then((containers) => {
    if (!detailed) return _.map(containers, 'Names');
    return containers;
  });
};

Runner.prototype.stop = async function stop(options) {
  const self = this;
  const { docker } = self;
  const containers = await docker.listContainers({ all: false });
  const toStop = [];
  containers.forEach((container) => {
    if (self.containerNameMatches(container, options.service.name)) {
      const cnt = docker.getContainer(container.Id);
      self.bosco.log(`Stopping ${options.service.name.green}`);
      toStop.push(cnt);
    }
  });

  return Promise.map(toStop, (container) => container.stop());
};

Runner.prototype.start = function start(options) {
  const self = this;
  const { docker } = self;
  const optionsCopy = { ...options };
  const dockerFqn = self.getFqn(optionsCopy);

  let defaultLocalHosts = self.bosco.config.get('docker:localhost') || ['local.tescloud.com', 'internal.tes-local.com', 'www.tes-local.com'];
  const defaultDependencyLocalHostDomain = self.bosco.config.get('docker:localhostDomain') || '.service.local.tescloud.com';
  const dependencyLocalHosts = [];
  if (optionsCopy.service.dependsOn && optionsCopy.service.dependsOn.forEach) {
    optionsCopy.service.dependsOn.forEach((dep) => {
      dependencyLocalHosts.push(`${dep + defaultDependencyLocalHostDomain}:${self.bosco.options.ip}`);
      if (_.startsWith(dep, 'service-')) {
        dependencyLocalHosts.push(`${dep.split('service-')[1] + defaultDependencyLocalHostDomain}:${self.bosco.options.ip}`);
      }
    });
  }

  if (Object.prototype.toString.call(defaultLocalHosts) !== '[object Array]') defaultLocalHosts = [defaultLocalHosts];
  if (optionsCopy.service.docker.HostConfig) {
    const ExtraHosts = optionsCopy.service.docker.HostConfig.ExtraHosts || [];
    optionsCopy.service.docker.HostConfig.ExtraHosts = ExtraHosts.concat(defaultLocalHosts.map((name) => `${name}:${self.bosco.options.ip}`), dependencyLocalHosts);
  }

  return new Promise((resolve, reject) => {
    DockerUtils.prepareImage(self.bosco, docker, dockerFqn, options, (prepareErr) => {
      if (prepareErr) return reject(prepareErr);
      DockerUtils.createContainer(docker, dockerFqn, options, (createErr, container) => {
        if (createErr) return reject(createErr);
        DockerUtils.startContainer(self.bosco, docker, dockerFqn, options, container, (startErr, ...rest) => {
          if (startErr) return reject(startErr);
          resolve(...rest);
        });
      });
    });
  });
};

Runner.prototype.update = function update(options) {
  const self = this;
  const { docker } = self;

  if (options.service.docker && options.service.docker.build) return Promise.resolve();

  const dockerFqn = self.getFqn(options);
  return new Promise((resolve, reject) => (
    DockerUtils.pullImage(self.bosco, docker, dockerFqn, (err, ...rest) => (err ? reject(err) : resolve(...rest)))
  ));
};

Runner.prototype.getFqn = function getFqn(options) {
  let dockerFqn = '';
  const { service } = options;
  if (service.docker) {
    if (service.docker.image) {
      dockerFqn = service.docker.image;
    }
    if (!dockerFqn && service.docker.build) {
      dockerFqn = `local/${service.name}`;
    }
    if (dockerFqn && dockerFqn.indexOf(':') === -1) {
      dockerFqn += ':latest';
    }
    if (dockerFqn) {
      return dockerFqn;
    }
  }

  if (service.registry) dockerFqn += `${service.registry}/`;
  if (service.username) dockerFqn += `${service.username}/`;
  return `${dockerFqn + service.name}:${service.version || 'latest'}`;
};

Runner.prototype.matchWithoutVersion = function matchWithoutVersion(a, b) {
  const realA = a.slice(0, a.lastIndexOf(':'));
  const realB = b.slice(0, b.lastIndexOf(':'));
  return realA === realB;
};

Runner.prototype.containerNameMatches = function containerNameMatches(container, name) {
  return _.some(container.Names, (val) => val === `/${name}`);
};

module.exports = new Runner();
