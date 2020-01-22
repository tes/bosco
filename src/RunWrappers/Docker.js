const url = require('url');
const fs = require('fs');
const _ = require('lodash');
const async = require('async');
const Docker = require('dockerode');
const DockerUtils = require('./DockerUtils');

function Runner() {
}

Runner.prototype.init = function (bosco, next) {
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
  next();
};

Runner.prototype.disconnect = function (next) {
  return next();
};

Runner.prototype.list = function (detailed, next) {
  const self = this;
  const { docker } = self;
  docker.listContainers({
    all: false,
  }, (err, containers) => {
    if (!detailed) return next(err, _.map(containers, 'Names'));
    next(err, containers);
  });
};

Runner.prototype.stop = function (options, next) {
  const self = this;
  const { docker } = self;
  docker.listContainers({
    all: false,
  }, (err, containers) => {
    const toStop = [];
    containers.forEach((container) => {
      if (self.containerNameMatches(container, options.service.name)) {
        const cnt = docker.getContainer(container.Id);
        self.bosco.log(`Stopping ${options.service.name.green}`);
        toStop.push(cnt);
      }
    });
    async.map(toStop, (container, cb) => {
      container.stop(cb);
    }, next);
  });
};

Runner.prototype.start = function (options, next) {
  const self = this;
  const { docker } = self;
  const dockerFqn = self.getFqn(options);

  let defaultLocalHosts = self.bosco.config.get('docker:localhost') || ['local.tescloud.com', 'internal.tes-local.com', 'www.tes-local.com'];
  const defaultDependencyLocalHostDomain = self.bosco.config.get('docker:localhostDomain') || '.service.local.tescloud.com';
  const dependencyLocalHosts = [];
  if (options.service.dependsOn && options.service.dependsOn.forEach) {
    options.service.dependsOn.forEach((dep) => {
      dependencyLocalHosts.push(`${dep + defaultDependencyLocalHostDomain}:${self.bosco.options.ip}`);
      if (_.startsWith(dep, 'service-')) {
        dependencyLocalHosts.push(`${dep.split('service-')[1] + defaultDependencyLocalHostDomain}:${self.bosco.options.ip}`);
      }
    });
  }

  if (Object.prototype.toString.call(defaultLocalHosts) !== '[object Array]') defaultLocalHosts = [defaultLocalHosts];
  if (options.service.docker.HostConfig) {
    const ExtraHosts = options.service.docker.HostConfig.ExtraHosts || [];
    options.service.docker.HostConfig.ExtraHosts = ExtraHosts.concat(defaultLocalHosts.map((name) => `${name}:${self.bosco.options.ip}`), dependencyLocalHosts);
  }


  DockerUtils.prepareImage(self.bosco, docker, dockerFqn, options, (err) => {
    if (err) return next(err);
    DockerUtils.createContainer(docker, dockerFqn, options, (err, container) => {
      if (err) return next(err);
      DockerUtils.startContainer(self.bosco, docker, dockerFqn, options, container, next);
    });
  });
};

Runner.prototype.update = function (options, next) {
  const self = this;
  const { docker } = self;

  if (options.service.docker && options.service.docker.build) return next();

  const dockerFqn = self.getFqn(options);
  DockerUtils.pullImage(self.bosco, docker, dockerFqn, next);
};

Runner.prototype.getFqn = function (options) {
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

Runner.prototype.matchWithoutVersion = function (a, b) {
  const realA = a.slice(0, a.lastIndexOf(':'));
  const realB = b.slice(0, b.lastIndexOf(':'));
  return realA === realB;
};

Runner.prototype.containerNameMatches = function (container, name) {
  return _.some(container.Names, (val) => val === `/${name}`);
};

module.exports = new Runner();
