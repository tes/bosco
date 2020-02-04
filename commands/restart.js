const stop = require('./stop');
const run = require('./run');

module.exports = {
  name: 'restart',
  description: 'Runs stop and then run with the same parameters - aka restart ;)',
  usage: '[-r <repoPattern>] [-t <tag>]',
};

async function cmd(bosco, args) {
  const repos = await stop.cmd(bosco, args);
  if (repos.length === 0) return;
  bosco.options.list = repos.join(','); // eslint-disable-line no-param-reassign
  await run.cmd(bosco, args);
}

module.exports.cmd = cmd;
