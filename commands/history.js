const async = require('async');
const { execFile } = require('child_process');

module.exports = {
  name: 'history',
  description: 'search for mention of <search term> in any previous commit, by running git log -S across your repos, use -- to separate bosco options from git log options',
  usage: '<search term>',
};

function searchRepoHistory(bosco, args, repo, repoPath, callback) {
  const gitArgs = ['log', '-S'].concat(args);

  execFile('git', gitArgs, {
    cwd: repoPath,
  }, (err, stdout) => {
    if (err) return callback(err);

    let result = null;

    if (stdout) {
      bosco.log(`${repo.blue}:\n${stdout}`);
      result = {
        repo,
        history: stdout,
      };
    }

    callback(null, result);
  });
}

function cmd(bosco, args, next) {
  const repoPattern = bosco.options.repo;
  const repoRegex = new RegExp(repoPattern);

  const repos = bosco.getRepos();
  if (!repos) return bosco.error('You are repo-less :( You need to initialise bosco first, try \'bosco clone\'.');

  bosco.log('Running git log -S across all repos...');

  function searchRepoHistories(callback) {
    async.mapLimit(repos, bosco.concurrency.network, (repo, historyCallback) => {
      if (!repo.match(repoRegex)) return historyCallback();

      const repoPath = bosco.getRepoPath(repo);

      searchRepoHistory(bosco, args, repo, repoPath, (err, result) => {
        // err.code is 1 when nothing is found.
        if (err && err.code !== 1) bosco.error(err.message.substring(0, err.message.indexOf('\n')));
        historyCallback(null, result);
      });
    }, callback);
  }

  searchRepoHistories((err, results) => {
    if (err) bosco.error(err);
    if (next) next(err, results);
  });
}

module.exports.cmd = cmd;
