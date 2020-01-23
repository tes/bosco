const { spawn } = require('child_process');

module.exports = {
  name: 'help',
  description: 'Shows help about a Bosco command',
  usage: '<command>',
};

// Shamelessly stolen from npm
function viewMan(man, cb) {
  const env = {};

  Object.keys(process.env).forEach((i) => {
    env[i] = process.env[i];
  });

  const conf = { env, stdio: 'inherit' };
  const manProcess = spawn('man', [man], conf);
  manProcess.on('close', cb);
}

function cmd(bosco, args) {
  const cmdName = args.shift();
  if (!cmdName) return bosco.error(`You need to provide a command name. e.g: bosco help ${module.exports.usage}`);

  const man = `bosco-${cmdName}`;
  viewMan(man, () => {});
}

module.exports.cmd = cmd;
