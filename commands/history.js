var async = require('async');
var execFile = require('child_process').execFile;

module.exports = {
  name: 'grep',
  description: 'runs git log -S across your repos, use -- to separate bosco options from git grep options',
  usage: '<search term>',
};

function grepRepo(bosco, args, repo, repoPath, callback) {
  var gitArgs = ['log', '-S'].concat(args);

  execFile('git', gitArgs, {
    cwd: repoPath,
  }, function(err, stdout) {
    if (err) return callback(err);

    var result = null;

    if (stdout) {
      bosco.log(repo.blue + ':\n' + stdout);
      result = {
        repo: repo,
        grep: stdout,
      };
    }

    callback(null, result);
  });
}

function cmd(bosco, args, next) {
  var repoPattern = bosco.options.repo;
  var repoRegex = new RegExp(repoPattern);

  var repos = bosco.getRepos();
  if (!repos) return bosco.error('You are repo-less :( You need to initialise bosco first, try \'bosco clone\'.');

  bosco.log('Running git log -S across all repos...');

  function grepRepos(callback) {
    async.mapLimit(repos, bosco.concurrency.network, function(repo, grepCallback) {
      if (!repo.match(repoRegex)) return grepCallback();

      var repoPath = bosco.getRepoPath(repo);

      grepRepo(bosco, args, repo, repoPath, function(err, result) {
        // err.code is 1 when nothing is found.
        if (err && err.code !== 1) bosco.error(err.message.substring(0, err.message.indexOf('\n')));
        grepCallback(null, result);
      });
    }, callback);
  }

  grepRepos(function(err, results) {
    if (err) bosco.error(err);
    if (next) next(err, results);
  });
}

module.exports.cmd = cmd;
