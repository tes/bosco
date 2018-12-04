var spawn = require('child_process').spawn;

module.exports = {
  name: 'help',
  description: 'Shows help about a Bosco command',
  usage: '<command>'
};

// Shamelessly stolen from npm
function viewMan(man, cb) {
  var env = {};

  Object.keys(process.env).forEach(function (i) {
    env[i] = process.env[i];
  });

  var conf = { env: env, stdio: 'inherit' };
  var manProcess = spawn('man', [man], conf);
  manProcess.on('close', cb);
}

function cmd(bosco, args) {
  var cmdName = args.shift();
  if (!cmdName) return bosco.error('You need to provide a command name. e.g: bosco help ' + module.exports.usage);

  var man = 'bosco-' + cmdName;
  viewMan(man, function () {});
}

module.exports.cmd = cmd;
