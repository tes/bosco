const run = require('./run');

module.exports = {
  name: 'start',
  description: 'This is an alias for run',
  cmd(bosco, args) {
    run.cmd(bosco, args, () => {});
  },
};
