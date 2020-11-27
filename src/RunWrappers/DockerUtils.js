const _ = require('lodash');
const os = require('os');
const path = require('path');
const fs = require('fs');
const sf = require('sf');
const tar = require('tar-fs');
const net = require('net');

function getHostIp() {
  const ip = _.chain(os.networkInterfaces())
    .values()
    .flatten()
    .filter((val) => (val.family === 'IPv4' && val.internal === false))
    .map('address')
    .first()
    .value();

  return ip;
}

function processCmdVars(optsCreate, name, cwd) {
  const toReturn = { ...optsCreate };
  // Allow simple variable substitution in Cmds
  const processedCommands = [];
  const processedBinds = [];
  const data = {
    HOST_IP: getHostIp(),
    PATH: cwd,
  };

  if (toReturn.Cmd) {
    toReturn.Cmd.forEach((cmd) => {
      processedCommands.push(sf(cmd, data));
    });
    toReturn.Cmd = processedCommands;
  }

  if (toReturn.Binds) {
    toReturn.Binds.forEach((bind) => {
      processedBinds.push(sf(bind, data));
    });
    toReturn.Binds = processedBinds;
  }

  return toReturn;
}

function stopAndRemoveContainer(container, data, callback) {
  if (data.State === 'running') {
    container.stop().then(() => {
      container.remove(callback);
    });
  } else {
    container.remove(callback);
  }
}

function createContainer(docker, fqn, options, next) {
  let optsCreate = {
    name: options.service.name,
    Image: fqn,
    Hostname: '',
    User: '',
    AttachStdin: false,
    AttachStdout: false,
    AttachStderr: false,
    Tty: false,
    OpenStdin: false,
    StdinOnce: false,
    Env: null,
    Volumes: null,
  };

  if (options.service.docker && options.service.docker.Config) {
    // For example options look in Config in: docker inspect <container_name>
    optsCreate = _.extend(optsCreate, options.service.docker.Config);
  }

  if (options.service.docker && options.service.docker.HostConfig) {
    // For example options look in HostConfig in: docker inspect <container_name>
    optsCreate = _.extend(optsCreate, options.service.docker.HostConfig);
  }

  // Process any variables
  optsCreate = processCmdVars(optsCreate, options.name, options.cwd);

  function doCreate(err) {
    if (err && err.statusCode !== 404) return next(err);
    docker.createContainer(optsCreate, next);
  }

  const optsList = {
    limit: 1,
    filters: {
      name: [optsCreate.name],
    },
  };

  docker.listContainers(optsList, (err, [data]) => {
    if (err) return doCreate();
    if (data && data.Id) {
      const container = docker.getContainer(data.Id);
      return stopAndRemoveContainer(container, data, doCreate);
    }
    return doCreate();
  });
}

/**
 * Check to see if the process is running by making a connection and
 * seeing if it is immediately closed or stays open long enough for us to close it.
 */
function checkRunning(port, host, next) {
  const socket = net.createConnection(port, host);
  const start = new Date();
  let finished;

  socket.setTimeout(200);
  socket.on('timeout', () => {
    socket.end();
  });
  socket.on('data', () => {
    finished = true;
    socket.end();
    next(null, true);
  });
  socket.on('close', (hadError) => {
    if (hadError) return;
    const closed = new Date() - start;
    if (!finished) {
      finished = true;
      next(null, closed > 100);
    }
  });
  socket.on('error', () => {
    if (!finished) {
      finished = true;
      next(new Error('Failed to connect'), false);
    }
  });
}

function startContainer(bosco, docker, fqn, options, container, next) {
  // We need to get the SSH port?
  let optsStart = {
    NetworkMode: 'bridge',
    VolumesFrom: null,
  };

  if (options.service.docker && options.service.docker.HostConfig) {
    // For example options look in HostConfig in: docker inspect <container_name>
    optsStart = _.extend(optsStart, options.service.docker.HostConfig);
  }

  // Process any variables
  optsStart = processCmdVars(optsStart, options.name, options.cwd);

  bosco.log(`Starting ${options.name.green}: ${fqn.magenta}...`);

  container.start((err) => {
    if (err) {
      bosco.error(`Failed to start Docker image: ${err.message}`);
      return next(err);
    }

    let checkPort;
    _.forOwn(optsStart.PortBindings, (value) => {
      if (!checkPort && value[0].HostPort) checkPort = value[0].HostPort; // Check first port
    });

    if (!checkPort) {
      bosco.warn(`Could not detect if ${options.name.green} had started, no port specified`);
      return next();
    }

    const checkHost = bosco.config.get('dockerHost') || 'localhost';
    const checkTimeout = options.service.checkTimeout || 10000;
    const checkEnd = Date.now() + checkTimeout;

    function check() {
      checkRunning(checkPort, checkHost, (runningErr, running) => {
        if (!runningErr && running) {
          return next();
        }

        if (Date.now() > checkEnd) {
          bosco.warn(`Could not detect if ${options.name.green} had started on port ${(`${checkPort}`).magenta} after ${checkTimeout}ms`);
          return next();
        }
        setTimeout(check, 200);
      });
    }
    bosco.log(`Waiting for ${options.name.green} to respond at ${checkHost.magenta} on port ${(`${checkPort}`).magenta}`);
    check();
  });
}

function ensureManifest(bosco, name, cwd) {
  const manifest = path.join(cwd, 'manifest.json');
  if (fs.existsSync(manifest)) { return; }
  bosco.log('Adding default manifest file for docker build ...');
  const manifestContent = { service: name, build: 'local' };
  fs.writeFileSync(manifest, JSON.stringify(manifestContent));
}

function buildImage(bosco, docker, fqn, options, next) {
  const buildPath = sf(options.service.docker.build, { PATH: options.cwd });

  ensureManifest(bosco, options.service.name, options.cwd);

  // TODO(geophree): obey .dockerignore
  const tarStream = tar.pack(buildPath);
  tarStream.once('error', next);

  bosco.log(`Building image for ${options.service.name} ...`);
  let lastStream = '';
  docker.buildImage(tarStream, { t: fqn }, (err, stream) => {
    if (err) return next(err);

    stream.on('data', (data) => {
      const json = JSON.parse(data);
      if (json.error) {
        bosco.error(json.error);
      } else if (json.stream) {
        lastStream = json.stream;
        process.stdout.write('.');
      }
    });
    stream.once('end', () => {
      const id = lastStream.match(/Successfully built ([a-f0-9]+)/);
      if (id && id[1]) {
        process.stdout.write('\n');
        return next(null, docker.getImage(id[1]));
      }
      next(new Error('Id not found in final log line: '.lastStream));
    });
    stream.once('error', next);
  });
}

function locateImage(docker, repoTag, callback) {
  docker.listImages((err, list) => {
    if (err) return callback(err);

    for (let i = 0, len = list.length; i < len; i += 1) {
      if (list[i].RepoTags && list[i].RepoTags.indexOf(repoTag) !== -1) {
        return callback(null, docker.getImage(list[i].Id));
      }
    }

    return callback();
  });
}

function pullImage(bosco, docker, repoTag, next) {
  let prettyError;

  function handler() {
    locateImage(docker, repoTag, (err, image) => {
      if (err || prettyError) return next(prettyError || err);
      next(null, image);
    });
  }

  bosco.log(`Pulling image ${repoTag.green} ...`);

  docker.pull(repoTag, (err, stream) => {
    const currentLayers = {};

    if (err || prettyError) return next(prettyError || err);

    function newBar(id) {
      let logged = false;
      return {
        tick() {
          if (!logged) {
            bosco.log(`Downloading layer ${id}...`);
            logged = true;
          }
        },
      };
    }

    stream.on('data', (data) => {
      let json;
      try {
        json = JSON.parse(data);
      } catch (ex) {
        json = {};
      }
      if (json.errorDetail) {
        prettyError = json.error;
      } else if (json.status === 'Downloading') {
        if (!currentLayers[json.id]) {
          currentLayers[json.id] = {};
          currentLayers[json.id].progress = newBar(json.id, json.progressDetail.total);
        } else {
          currentLayers[json.id].progress.tick();
        }
      } else if (json.status === 'Pull complete') {
        bosco.log(`Pull complete for layer ${json.id}`);
      }
    });
    stream.once('end', handler);
  });
}

function prepareImage(bosco, docker, fqn, options, next) {
  if (options.service.docker && options.service.docker.build) {
    return buildImage(bosco, docker, fqn, options, next);
  }
  locateImage(docker, fqn, (err, image) => {
    if (err || image) return next(err, image);

    // Image not available
    pullImage(bosco, docker, fqn, next);
  });
}

module.exports = {
  buildImage,
  createContainer,
  locateImage,
  prepareImage,
  pullImage,
  startContainer,
};
