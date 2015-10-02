var path = require('path');
var spawn = require('child_process').spawn;

module.exports = {
  name:'help',
  description:'Shows help about a Bosco command',
  usage:'<command>',
  cmd:cmd
}

function cmd(bosco, args) {
  var cmdName = args.shift();
  if(!cmdName) return bosco.error('You need to provide a command name. e.g: bosco help ' + module.exports.usage);

  var man = 'bosco-' + cmdName + '.3';
  viewMan(man, function(){});
}

// Shamelessly stolen from npm
function viewMan (man, cb) {
  var nre = /([0-9]+)$/
  var num = man.match(nre)[1]
  var section = path.basename(man, '.' + num)

  // at this point, we know that the specified man page exists
  var manpath = path.join(__dirname, '..', 'man'), env = {};
  Object.keys(process.env).forEach(function(i) {
    env[i] = process.env[i]
  })
  env.MANPATH = manpath;

  var conf = { env: env, customFds: [ 0, 1, 2] }
  var manProcess = spawn('man', [num, section], conf)
  manProcess.on('close', cb)
}
