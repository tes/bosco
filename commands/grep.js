const async = require('async');
const { execFile } = require('child_process');

module.exports = {
  name: 'grep',
  description: 'runs git grep across your repos, use -- to separate bosco options from git grep options',
  usage: '<git grep args>',
};

function grepRepo(bosco, args, repo, repoPath, callback) {
  const gitArgs = ['grep', '--color=always', '-n'].concat(args);

  execFile('git', gitArgs, {
    cwd: repoPath,
  }, (err, stdout) => {
    if (err) return callback(err);

    let result = null;

    if (stdout) {
      bosco.log(`${repo.blue}:\n${stdout}`);
      result = {
        repo,
        grep: stdout,
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

  bosco.log('Running grep across all repos...');

  function grepRepos(callback) {
    async.mapLimit(repos, bosco.concurrency.network, (repo, grepCallback) => {
      if (!repo.match(repoRegex)) return grepCallback();

      const repoPath = bosco.getRepoPath(repo);

      grepRepo(bosco, args, repo, repoPath, (err, result) => {
        // err.code is 1 when nothing is found.
        if (err && err.code !== 1) bosco.error(err.message.substring(0, err.message.indexOf('\n')));
        grepCallback(null, result);
      });
    }, callback);
  }

  grepRepos((err, results) => {
    if (err) bosco.error(err);
    if (next) next(err, results);
  });
}

module.exports.cmd = cmd;
