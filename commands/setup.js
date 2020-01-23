const clone = require('./clone');
const install = require('./install');
const team = require('./team');

module.exports = {
  name: 'setup',
  description: 'Runs clone and then install to get your environment ready for action.',
};

function cmd(bosco, args) {
  team.cmd(bosco, ['sync'], () => {
    team.cmd(bosco, ['setup'], () => {
      clone.cmd(bosco, [], () => {
        install.cmd(bosco, args);
      });
    });
  });
}

module.exports.cmd = cmd;
