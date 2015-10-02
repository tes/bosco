var spawn = require('child_process').spawn

function Runner() {
}

Runner.prototype.init = function(bosco, next) {
  this.bosco = bosco;
  next();
}

Runner.prototype.list = function(options, next) {
  var installed = true;
  spawn('docker-compose', ['--version'], { stdio: 'ignore' })
  .on('error', function() {
    installed = false;
    return next(null, []);
  }).on('exit', function() {
    if(installed) { return next(null, ['docker-compose']); }
  })
}

Runner.prototype.stop = function(options, next) {
  spawn('docker-compose', ['stop'], { cwd: options.cwd, stdio: 'inherit' }).on('exit', next)
}

Runner.prototype.start = function(options, next) {
  spawn('docker-compose', ['up', '-d'], { cwd: options.cwd, stdio: 'inherit' }).on('exit', next)
}

module.exports = new Runner();
