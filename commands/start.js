module.exports = {
  name: 'start',
  description: 'This is an alias for run',
  cmd(bosco, args) {
    const run = require('./run');
    run.cmd(bosco, args, () => {});
  },
};
