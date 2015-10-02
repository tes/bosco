
module.exports = {
  name: 'setup',
  description: 'Runs clone and then install to get your environment ready for action.',
  cmd: cmd
}

function cmd(bosco, args) {
  var clone = require('./clone');
  var install = require('./install');
  var team = require('./team');
  var link = require('./link');

  team.cmd(bosco, ['sync'], function() {
    team.cmd(bosco, ['setup'], function() {
      clone.cmd(bosco, [], function() {
        link.cmd(bosco, [], function() {
          install.cmd(bosco, args);
        });
      });
    });
  });
}
