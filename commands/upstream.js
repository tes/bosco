var async = require('async');
var exec = require('child_process').exec;

module.exports = {
  name: 'upstream',
  description: 'Runs a git fetch and tells you what has changed upstream for all your repos',
  usage: '[-r <repoPattern>]',
  cmd: cmd
};

function cmd(bosco) {
  var repoPattern = bosco.options.repo;
  var repoRegex = new RegExp(repoPattern);

  var repos = bosco.getRepos();
  if (!repos) return bosco.error('You are repo-less :( You need to initialise bosco first, try \'bosco clone\'.');

  function changedRepos(cb) {
    async.mapLimit(repos, bosco.concurrency.network, function repoStash(repo, repoCb) {
      var repoPath = bosco.getRepoPath(repo);
      if (!repo.match(repoRegex)) return repoCb();
      upstream(bosco, repoPath, repoCb);
    }, function() {
      cb();
    });
  }

  bosco.log('Checking upstream origin for changes, this may take a while ...');

  changedRepos(function() {
    bosco.log('Complete');
  });
}

function upstream(bosco, orgPath, next) {
  exec('git fetch; git log HEAD..origin/master --oneline', {
    cwd: orgPath
  }, function(err, stdout, stderr) {
    if (err) {
      bosco.error(stderr);
    } else {
      if (stdout) {
        bosco.log('Changes in ' + orgPath.blue);
        console.log(stdout);
      } else {
        bosco.log(orgPath.blue + ': ' + 'No Change'.green);
      }
    }
    next(err);
  });
}
