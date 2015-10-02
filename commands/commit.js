var async = require('async');
var exec = require('child_process').exec;

module.exports = {
  name: 'commit',
  description: 'Run git commit across all repos - useful for batch updates',
  usage: '[-r <repoPattern>] \'<commit message>\'',
  cmd: cmd
}

function cmd(bosco, args) {
  var repos = bosco.getRepos();
  if (!repos) return bosco.error('You are repo-less :( You need to initialise bosco first, try \'bosco clone\'.');

  var repoPattern = bosco.options.repo;
  var message = args.shift();

  if (!message) return bosco.error('You need to supply at least a commit message.');

  if (args.shift()) {
    return bosco.error('You need to put your commit message in quotes: \'this is my message\'');
  }

  var repoRegex = new RegExp(repoPattern);

  bosco.log('Running git commit -am across all repos that match ' + repoRegex + '...');
  bosco.log('Using message: ' + message.blue);

  function commitRepos(cb) {
    async.mapSeries(repos, function repoPush(repo, repoCb) {
      var repoPath = bosco.getRepoPath(repo);
      if (repo.match(repoRegex)) {
        bosco.log('Running \'git commit -am\' on ' + repo.blue);
        commit(bosco, message, repoPath, repoCb);
      } else {
        repoCb();
      }
    }, function() {
      cb();
    });
  }

  commitRepos(function() {
    bosco.log('Complete');
  });
}



function confirm(bosco, message, next) {
  bosco.prompt.start();
  bosco.prompt.get({
    properties: {
      confirm: {
        description: message
      }
    }
  }, function(err, result) {
    if (!result) return next({message: 'Did not confirm'});

    if (result.confirm === 'Y' || result.confirm === 'y') {
      next(null, true);
    } else {
      next(null, false);
    }
  });
}


function commit(bosco, commitMsg, orgPath, next) {
  if (!bosco.exists([orgPath, '.git'].join('/'))) {
    bosco.warn('Doesn\'t seem to be a git repo: '+ orgPath.blue);
    return next();
  }

  confirm(bosco, 'Confirm you want to commit any changes in: ' + orgPath.blue + ' [y/N]', function(err, confirmed) {
    if (err) return next(err);

    if (!confirmed) {
      bosco.log('No commit done for ' + orgPath.blue);
      return next();
    }

    var gitCmd = 'git commit -am \'' + commitMsg +'\'';

      exec(gitCmd, {
        cwd: orgPath
      }, function(err, stdout) {
        if (err) {
          bosco.warn(orgPath.blue + ' >> No changes to commit.');
        } else {
          if (stdout) bosco.log(orgPath.blue + ' >> ' + stdout);
        }
        next();
      });
  })
}
