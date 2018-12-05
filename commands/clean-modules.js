var async = require('async');
var exec = require('child_process').exec;
var green = '\u001b[42m \u001b[0m';
var red = '\u001b[41m \u001b[0m';

module.exports = {
  name: 'clean-modules',
  description: 'Cleans out node_modules and re-runs npm install against all repos',
  usage: '[-r <repoPattern>]'
};

function clean(bosco, progressbar, bar, repoPath, next) {
  var packageJson = [repoPath, 'package.json'].join('/');
  if (!bosco.exists(packageJson)) {
    if (progressbar) bar.tick();
    return next();
  }

  exec('rm -rf ./node_modules', {
    cwd: repoPath
  }, function (err, stdout, stderr) {
    if (progressbar) bar.tick();
    if (err) {
      if (progressbar) bosco.console.log('');
      bosco.error(repoPath.blue + ' >> ' + stderr);
    } else if (!progressbar) {
      bosco.log('Cleaned node modules for ' + repoPath.blue);
    }
    next();
  });
}

function cmd(bosco, args, next) {
  var repoPattern = bosco.options.repo;
  var repoRegex = new RegExp(repoPattern);

  var repos = bosco.getRepos();
  if (!repos) return bosco.error('You are repo-less :( You need to initialise bosco first, try \'bosco clone\'.');

  bosco.log('Clearing out node modules and re-running npm install across all repos ...');

  function cleanRepos(cb) {
    var progressbar = bosco.config.get('progress') === 'bar';
    var total = repos.length;

    var bar = progressbar ? new bosco.Progress('Doing clean and npm install [:bar] :percent :etas', {
      complete: green,
      incomplete: red,
      width: 50,
      total: total
    }) : null;

    async.mapLimit(repos, bosco.concurrency.network, function repoStash(repo, repoCb) {
      if (!repo.match(repoRegex)) return repoCb();

      var repoPath = bosco.getRepoPath(repo);
      clean(bosco, progressbar, bar, repoPath, repoCb);
    }, function () {
      cb();
    });
  }

  cleanRepos(function () {
    bosco.log('Complete');
    if (next) next();
  });
}

module.exports.cmd = cmd;
