var _ = require('lodash');
var os = require('os');
var path = require('path');
var fs = require('fs');
var sf = require('sf');
var tar = require('tar-fs');
var green = '\u001b[42m \u001b[0m';
var red = '\u001b[41m \u001b[0m';

function createContainer(docker, fqn, options, next) {
  var optsCreate = {
    'name': options.service.name,
    'Image': fqn,
    'Hostname': '',
    'User': '',
    'AttachStdin': false,
    'AttachStdout': false,
    'AttachStderr': false,
    'Tty': false,
    'OpenStdin': false,
    'StdinOnce': false,
    'Env': null,
    'Volumes': null
  };

  if (options.service.docker && options.service.docker.Config) {
    // For example options look in Config in: docker inspect <container_name>
    optsCreate = _.extend(optsCreate, options.service.docker.Config);
  }

  // Process any variables
  processCmdVars(optsCreate, options.name, options.cwd);

  var doCreate = function(err) {
    if (err && err.statusCode !== 404) return next(err);
    docker.createContainer(optsCreate, next);
  };
  var container = docker.getContainer(optsCreate.name);
  if (container) return container.remove(doCreate);
  doCreate();
}

function processCmdVars(optsCreate, name, cwd) {
  // Allow simple variable substitution in Cmds
  var processedCommands = [], processedBinds = [],
    data = {
      HOST_IP: getHostIp(),
      PATH: cwd
    };

  if(optsCreate.Cmd) {
    optsCreate.Cmd.forEach(function(cmd) {
      processedCommands.push(sf(cmd, data));
    });
    optsCreate.Cmd = processedCommands;
  }

  if(optsCreate.Binds) {
    optsCreate.Binds.forEach(function(bind) {
      processedBinds.push(sf(bind, data));
    });
    optsCreate.Binds = processedBinds;
  }
}

function startContainer(bosco, docker, fqn, options, container, next) {
  // We need to get the SSH port?
  var optsStart = {
    'NetworkMode': 'bridge',
    'VolumesFrom': null
  };

  if (options.service.docker && options.service.docker.HostConfig) {
    // For example options look in HostConfig in: docker inspect <container_name>
    optsStart = _.extend(optsStart, options.service.docker.HostConfig);
  }

  // Process any variables
  processCmdVars(optsStart, options.name, options.cwd);

  bosco.log('Starting ' + options.name.green + ': ' + fqn.magenta + '...');

  container.start(optsStart, function(err) {
    if (err) {
      bosco.error('Failed to start Docker image: ' + err.message);
      return next(err);
    }

    var checkPort;
    _.forOwn(optsStart.PortBindings, function(value) {
      if(!checkPort && value[0].HostPort) checkPort = value[0].HostPort; // Check first port
    });

    if (!checkPort) {
      bosco.warn('Could not detect if ' + options.name.green + ' had started, no port specified');
      return next();
    }

    var checkTimeout = options.service.checkTimeout || 10000;
    var checkEnd = Date.now() + checkTimeout;

    function check() {
      checkRunning(checkPort, function(err, running) {
        if (!err && running) {
          process.stdout.write('\n');
          return next();
        }

        if (Date.now() > checkEnd) {
          process.stdout.write('\n');
          bosco.warn('Could not detect if ' + options.name.green + ' had started on port ' + ('' + checkPort).magenta + ' after ' + checkTimeout + 'ms');
          return next();
        }

        process.stdout.write('.');
        setTimeout(check, 500);
      });
    }
    bosco.log('Waiting for ' + options.name.green + ' to respond on port ' + ('' + checkPort).magenta);
    check();
  });
}

/**
 * Check to see if the process is running by making a connection and
 * seeing if it is immediately closed or stays open long enough for us to close it.
 */
function checkRunning(port, next) {
  var net = require('net');
  var socket = net.createConnection(port);
  var start = new Date();
  var timer;
  socket.on('connect', function() {
    timer = setTimeout(function() { socket.end() }, 200);
  });
  socket.on('close', function(hadError) {
    if (hadError) return; // If we are closing due to an error ignore it

    clearTimeout(timer);
    var closed = new Date() - start;
    next(null, closed > 100 ? true : false);
  });
  socket.on('error', function() {
    next(new Error('Failed to connect'), false);
  });
}

function prepareImage(bosco, docker, fqn, options, next) {
  if (options.service.docker && options.service.docker.build) {
    return buildImage(bosco, docker, fqn, options, next);
  }
  locateImage(docker, fqn, function(err, image) {
    if (err || image) return next(err, image);

    // Image not available
    pullImage(bosco, docker, fqn, next);
  });
}

function buildImage(bosco, docker, fqn, options, next) {
  var path = sf(options.service.docker.build, {PATH: options.cwd});

  ensureManifest(bosco, options.service.name, options.cwd);

  // TODO(geophree): obey .dockerignore
  var tarStream = tar.pack(path);
  tarStream.once('error', next);

  bosco.log('Building image for ' + options.service.name + ' ...');
  var lastStream = '';
  docker.buildImage(tarStream, {t: fqn}, function(err, stream) {
    if (err) return next(err);

    stream.on('data', function(data) {
      var json = JSON.parse(data);
      if (json.error) {
        return bosco.error(json.error);
      } else if (json.progress) {
        return;
      } else if (json.stream) {
        lastStream = json.stream;
        process.stdout.write('.');
      }
    });
    stream.once('end', function() {
      var id = lastStream.match(/Successfully built ([a-f0-9]+)/);
      if (id && id[1]) {
        process.stdout.write('\n');
        return next(null, docker.getImage(id[1]));
      }
      next(new Error('Id not found in final log line: ' . lastStream));
    });
    stream.once('error', next);
  });
}

function locateImage(docker, repoTag, callback) {
  docker.listImages(function(err, list) {
    if (err) return callback(err);

    for (var i = 0, len = list.length; i < len; i++) {
      if (list[i].RepoTags.indexOf(repoTag) !== -1) {
        return callback(null, docker.getImage(list[i].Id));
      }
    }

    return callback();
  });
}

function pullImage(bosco, docker, repoTag, next) {
  var prettyError;

  function handler() {
    locateImage(docker, repoTag, function(err, image) {
      if (err || prettyError) return next(prettyError || err);
      next(null, image);
    });
  }

  bosco.log('Pulling image ' + repoTag.green + ' ...');

  docker.pull(repoTag, function(err, stream) {
    var currentLayer;
    var progress;
    var previousTotal;

    if (err || prettyError) return next(prettyError || err);

    function newBar(id, total) {
      if (bosco.config.get('progress') == 'bar') {
        return new bosco.progress('Downloading ' + id + ' [:bar] :percent :etas', {
          complete: green,
          incomplete: red,
          width: 50,
          total: total
        });
      } else {
        var logged = false;
        return {
          tick: function() {
            if (!logged) {
              bosco.log('Downloading layer ' + id + '...');
              logged = true;
            }
          }
        }
      }
    }

    stream.on('data', function(data) {
      var json = JSON.parse(data);

      if (json.errorDetail) {
        prettyError = json.error;
      } else if (json.status === 'Downloading') {
        if (json.id !== currentLayer) {
          progress = newBar(json.id, json.progressDetail.total);
          currentLayer = json.id;
          previousTotal = 0;
        }
        progress.tick(json.progressDetail.current - previousTotal);
        previousTotal = json.progressDetail.current;
      }
    })
    stream.once('end', handler);
  });
}

function ensureManifest(bosco, name, cwd) {
  var manifest = path.join(cwd,'manifest.json');
  if(fs.existsSync(manifest)) { return; }
  bosco.log('Adding default manifest file for docker build ...')
  var manifestContent = { 'service': name, 'build': 'local' };
  fs.writeFileSync(manifest,JSON.stringify(manifestContent));
}

function getHostIp() {
  var ip = _.chain(os.networkInterfaces())
    .values()
    .flatten()
    .filter(function(val) {
      return (val.family === 'IPv4' && val.internal === false)
    })
    .pluck('address')
    .first()
    .value();

  return ip;
}

module.exports = {
  buildImage: buildImage,
  createContainer: createContainer,
  locateImage: locateImage,
  prepareImage: prepareImage,
  pullImage: pullImage,
  startContainer: startContainer
}
