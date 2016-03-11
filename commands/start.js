module.exports = {
  name: 'start',
  description: 'This is an alias for run',
  cmd: function(bosco, args) {
    var run = require('./run');
    run.cmd(bosco, args, function() {});
  },
};
