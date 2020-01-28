const clone = require('./clone');
const install = require('./install');
const team = require('./team');

module.exports = {
  name: 'setup',
  description: 'Runs clone and then install to get your environment ready for action.',
};

async function cmd(bosco, args) {
  try {
    await new Promise((resolve) => {
      team.cmd(bosco, ['sync'], () => {
        team.cmd(bosco, ['setup'], resolve);
      });
    });
    await clone.cmd(bosco);

    await new Promise((resolve) => install.cmd(bosco, args, resolve));
  } catch (err) {
    bosco.error(err);
  }
}

module.exports.cmd = cmd;
