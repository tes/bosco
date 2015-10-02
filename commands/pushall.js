var async = require('async');
var exec = require('child_process').exec;

/*
 * this command is called pushall as there is a weird Node bug when calling the command 'push' - try bosco push to see.
 */

module.exports = {
  name: 'pushall',
  description: 'Will push any changes across all repos - useful for batch updates, typicall used after bosco commit',
  usage: '[-r <repoPattern>]',
  cmd: cmd
}

function cmd(bosco) {

  var repos = bosco.getRepos();
  if (!repos) return bosco.error('You are repo-less :( You need to initialise bosco first, try \'bosco clone\'.');

  var regex = bosco.options.repo;

  bosco.log('Running git push across all repos that match ' + regex + '...');

  var pushRepos = function(cb) {

    async.mapSeries(repos, function repoPush(repo, repoCb) {

      var repoPath = bosco.getRepoPath(repo);
      if (repo.match(regex)) {
        bosco.log('Running git push on ' + repo.blue);
        push(bosco, repoPath, repo, repoCb);
      } else {
        repoCb();
      }

    }, function() {
      cb();
    });

  }

  pushRepos(function() {
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
    if (!result) return next({
      message: 'Did not confirm'
    });

    if (result.confirm == 'Y' || result.confirm == 'y') {
      next(null, true);
    } else {
      next(null, false);
    }
  });
}

function push(bosco, orgPath, repo, next) {
  if (!bosco.exists([orgPath, '.git'].join('/'))) {
    bosco.warn('Doesn\'t seem to be a git repo: ' + orgPath.blue);
    return next();
  }

  countCommitsAhead(bosco, orgPath, function(err, commitsAhead) {
    if (err) return next(err);

    if (!commitsAhead) {
      bosco.log('Nothing to push for ' + repo.blue);
      return next();
    }

    confirm(bosco, 'Confirm you want to push: ' + orgPath.blue + ' [y/N]', function(err, confirmed) {
      if (err) return next(err);

      if (!confirmed) {
        bosco.log('Not pushing ' + repo.blue);
        return next();
      }

      exec('git push origin master', {
        cwd: orgPath
      }, function(err, stdout, stderr) {
        if (err) {
          bosco.error(orgPath.blue + ' >> ' + stderr);
        } else {
          if (stdout) bosco.log(orgPath.blue + ' >> ' + stdout);
        }
        next(err);
      });
    })
  })
}

function countCommitsAhead(bosco, orgPath, next) {
  exec('git log origin/master..master | xargs cat | wc -l', {
    cwd: orgPath
  }, function(err, stdout, stderr) {
    if (err) {
      bosco.error(orgPath.blue + ' >> ' + stderr);
    } else {
      if (stdout) return next(null, parseInt(stdout, 10));
    }

    next(err, 0);
  });
}
