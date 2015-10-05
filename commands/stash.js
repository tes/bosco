var async = require('async');
var exec = require('child_process').exec;
var green = '\u001b[42m \u001b[0m';
var red = '\u001b[41m \u001b[0m';

module.exports = {
  name: 'stash',
  description: 'Stashes any local changes across all repos',
  usage: '[-r <repoPattern>]',
};

function stash(bosco, args, progressbar, bar, orgPath, next) {
  if (!progressbar) bosco.log('Stashing ' + orgPath.blue);
  if (!bosco.exists([orgPath, '.git'].join('/'))) {
    bosco.warn('Doesn\'t seem to be a git repo: ' + orgPath.blue);
    return next();
  }

  var cmdString = 'git stash ' + args.join(' ');

  var ignoreMissingStashCommands = ['pop', 'apply'];
  var ignoreMissingStash = (ignoreMissingStashCommands.indexOf(args[0]) !== -1);
  exec(cmdString, {
    cwd: orgPath,
  }, function(error, stdout, stderr) {
    if (progressbar) bar.tick();
    var err = error;

    if (err && ignoreMissingStash && err.code === 1) {
      err = null;
    }
    if (err) {
      if (progressbar) bosco.console.log('');
      bosco.error(orgPath.blue + ' >> ' + stderr);
    } else {
      if (!progressbar && stdout) bosco.log(orgPath.blue + ' >> ' + stdout);
    }
    next(err);
  });
}

function cmd(bosco, args) {
  var repoPattern = bosco.options.repo;
  var repoRegex = new RegExp(repoPattern);

  var repos = bosco.getRepos();
  if (!repos) return bosco.error('You are repo-less :( You need to initialise bosco first, try \'bosco clone\'.');

  bosco.log('Running git stash across all repos ...');

  function stashRepos(cb) {
    var progressbar = bosco.config.get('progress') === 'bar';
    var total = repos.length;

    var bar = progressbar ? new bosco.Progress('Doing git stash [:bar] :percent :etas', {
      complete: green,
      incomplete: red,
      width: 50,
      total: total,
    }) : null;

    async.mapSeries(repos, function repoStash(repo, repoCb) {
      if (!repo.match(repoRegex)) return repoCb();

      var repoPath = bosco.getRepoPath(repo);
      stash(bosco, args, progressbar, bar, repoPath, repoCb);
    }, function() {
      cb();
    });
  }

  stashRepos(function() {
    bosco.log('Complete');
  });
}

module.exports.cmd = cmd;
