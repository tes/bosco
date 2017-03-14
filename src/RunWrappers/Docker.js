var url = require('url');
var fs = require('fs');
var _ = require('lodash');
var async = require('async');
var Docker = require('dockerode');
var DockerUtils = require('./DockerUtils');

function Runner() {
}

Runner.prototype.init = function(bosco, next) {
  this.bosco = bosco;

  function readCert(certPath, certFile) {
    return fs.readFileSync(certPath + '/' + certFile, {encoding: 'utf-8'});
  }

  if (process.env.DOCKER_HOST) {
    // We are likely on OSX and Boot2docker
    var dockerUrl = url.parse(process.env.DOCKER_HOST || 'tcp://127.0.0.1:3000');
    var dockerOpts = {
      host: dockerUrl.hostname,
      port: dockerUrl.port,
    };

    var dockerCertPath = process.env.DOCKER_CERT_PATH;
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
    this.docker = new Docker({socketPath: '/var/run/docker.sock'});
  }
  next();
};

Runner.prototype.disconnect = function(next) {
  return next();
};

Runner.prototype.list = function(detailed, next) {
  var self = this;
  var docker = self.docker;
  docker.listContainers({
    all: false,
  }, function(err, containers) {
    if (!detailed) return next(err, _.map(containers, 'Names'));
    next(err, containers);
  });
};

Runner.prototype.stop = function(options, next) {
  var self = this;
  var docker = self.docker;
  docker.listContainers({
    all: false,
  }, function(err, containers) {
    var toStop = [];
    containers.forEach(function(container) {
      if (self.containerNameMatches(container, options.service.name)) {
        var cnt = docker.getContainer(container.Id);
        self.bosco.log('Stopping ' + options.service.name.green);
        toStop.push(cnt);
      }
    });
    async.map(toStop, function(container, cb) {
      container.stop(cb);
    }, next);
  });
};

Runner.prototype.start = function(options, next) {
  var self = this;
  var docker = self.docker;
  var dockerFqn = self.getFqn(options);

  var defaultLocalHost = self.bosco.config.get('docker:localhost') || 'local.tescloud.com';
  if (options.service.docker.HostConfig) {
    options.service.docker.HostConfig.ExtraHosts = options.service.docker.HostConfig.ExtraHosts || [];
    options.service.docker.HostConfig.ExtraHosts.push(defaultLocalHost + ':' + self.bosco.options.ip);
  }

  DockerUtils.prepareImage(self.bosco, docker, dockerFqn, options, function(err) {
    if (err) return next(err);

    DockerUtils.createContainer(docker, dockerFqn, options, function(err, container) {
      if (err) return next(err);
      DockerUtils.startContainer(self.bosco, docker, dockerFqn, options, container, next);
    });
  });
};

Runner.prototype.update = function(options, next) {
  var self = this;
  var docker = self.docker;

  if (options.service.docker && options.service.docker.build) return next();

  var dockerFqn = self.getFqn(options);
  DockerUtils.pullImage(self.bosco, docker, dockerFqn, next);
};

Runner.prototype.getFqn = function(options) {
  var dockerFqn = '';
  var service = options.service;
  if (service.docker) {
    if (service.docker.image) {
      dockerFqn = service.docker.image;
    }
    if (!dockerFqn && service.docker.build) {
      dockerFqn = 'local/' + service.name;
    }
    if (dockerFqn && dockerFqn.indexOf(':') === -1) {
      dockerFqn += ':latest';
    }
    if (dockerFqn) {
      return dockerFqn;
    }
  }

  if (service.registry) dockerFqn += service.registry + '/';
  if (service.username) dockerFqn += service.username + '/';
  return dockerFqn + service.name + ':' + (service.version || 'latest');
};

Runner.prototype.matchWithoutVersion = function(a, b) {
  var realA = a.slice(0, a.lastIndexOf(':'));
  var realB = b.slice(0, b.lastIndexOf(':'));
  return realA === realB;
};

Runner.prototype.containerNameMatches = function(container, name) {
  return _.some(container.Names, function(val) {
    return val === '/' + name;
  });
};

module.exports = new Runner();
