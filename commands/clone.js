var _ = require('lodash');
var async = require('async');
var fs = require('fs');
var github = require('octonode');
var rimraf = require('rimraf');
var path = require('path');
var exec = require('child_process').exec;
var green = '\u001b[42m \u001b[0m';
var red = '\u001b[41m \u001b[0m';

module.exports = {
    name:'clone',
    description:'Gets an list of all repos in your team and runs git clone for each',
    example: 'bosco clone',
    cmd:cmd,
    options: [{
        option: 'clean',
        syntax: ['--clean', 'Remove any repositories in the workspace that are no longer in the github team']
    }]
}

function cmd(bosco, args, next) {

    var repoPattern = bosco.options.repo;
    var repoRegex = new RegExp(repoPattern);
    var team = bosco.getTeam();
    var teamConfig = bosco.config.get('teams:' + team);

    var client = github.client(bosco.config.get('github:authToken'));

    if(!teamConfig) {

        // The user does not have a team, so just treat the repos config
        // as manually edited
        return bosco.error([
            'Looks like you havent linked this workspace to a team?  Try: ',
            'bosco team setup'.green,
            '. If you can\'t see your team in the list, Try: ',
            'bosco team sync'.green
        ].join(''));

    } else {

        bosco.log('Fetching repository list from Github for ' + team.green + ' team ...');
        var more = true, page = 1, repoList = [];
        async.whilst(
            function () { return more; },
            function (callback) {
                getRepos(client, teamConfig, page, function(err, repos, isMore) {
                    if(err) { return callback(err); }
                    repoList = _.union(repoList, repos);
                    if(isMore) {
                        page = page + 1;
                    } else {
                        more = false;
                    }
                    callback();
                });
            },
            function (err) {
                if(err) {
                    return bosco.error(err.message);
                }
                bosco.log('Cloning ' + (repoList.length + '').green + ' repositories from Github for ' + team.green + ' team ...');
                fetch(bosco, team, repoList, repoRegex, args, next);
            }
        );
    }

}

function getRepos(client, teamConfig, page, next) {

    if(teamConfig.isUser) {
        client.get('/user/repos', {per_page: 20, page: page}, function (err, status, body, headers) {
            next(err, _.pluck(body, 'name'), _.contains(headers.link, 'rel="next"'));
        });
    } else {
        client.get('/teams/' + teamConfig.id + '/repos', {per_page: 20, page: page}, function (err, status, body, headers) {
            next(err, _.pluck(body, 'name'), _.contains(headers.link, 'rel="next"'));
        });
    }

}

function fetch(bosco, team, repos, repoRegex, args, next) {

    var orgPath = bosco.getOrgPath();

    var saveRepos = function(cb) {
        bosco.config.set('teams:' + team + ':repos',repos);
        bosco.config.save(cb);
    }

    var checkOrphans = function(cb) {
        function warnOrphan(orphan, cb2) {
            bosco.warn('I am concerned that you still have the repo ' + orphan.red + ' as it is no longer in the github team, run "bosco clone --clean" to remove them.');
            cb2();
        }

        function removeOrphan(orphan, cb2) {
            var orphanPath = bosco.getRepoPath(orphan);
            checkCanDelete(bosco, orphanPath, function(err, canDelete) {
                if (err || !canDelete) {
                    bosco.warn('Not deleting project ' + orphan.red + ' as you have uncommited or unpushed local changes.');
                    return cb2();
                }

                bosco.log('Deleted project ' + orphan.green + ' as it is no longer in the github team and you have no local changes.');
                rimraf(orphanPath, cb2)
            });
        }

        var orphanAction = warnOrphan;
        if (bosco.options.clean) {
            orphanAction = removeOrphan;
        }

        fs.readdir(bosco.getOrgPath(), function(err, files) {
            var orphans = _.chain(files)
                .map(function(file) { return path.join(bosco.getOrgPath(),file) })
                .filter(function(file) { return fs.statSync(file).isDirectory() && bosco.exists(path.join(file, '.git')) })
                .map(function(file) { return path.relative(bosco.getOrgPath(), file); })
                .difference(repos)
                .value()

            async.map(orphans, orphanAction, cb);
        });
    }

    var getRepos = function(cb) {

        var progressbar = bosco.config.get('progress') == 'bar',
            total = repos.length,
            pullFlag = false;

          var bar = progressbar ? new bosco.progress('Getting repositories [:bar] :percent :etas', {
            complete: green,
              incomplete: red,
            width: 50,
            total: total
        }) : null;

        async.mapLimit(repos, bosco.concurrency.network, function repoGet(repo, repoCb) {

          if(!repo.match(repoRegex)) return repoCb();

          var repoPath = bosco.getRepoPath(repo);
          var repoUrl = bosco.getRepoUrl(repo);

          if(bosco.exists(repoPath)) {
              pullFlag = true;
              if(progressbar) bar.tick();
              repoCb();
          } else {
              clone(bosco,  progressbar, bar, repoUrl, orgPath, repoCb);
          }
        }, function() {
            if(pullFlag) {
                bosco.warn('Some repositories already existed, to pull changes use \'bosco pull\'');
            }
            cb();
        });

    }

    var gitIgnoreRepos = function(cb) {
        // Ensure repo folders are in workspace gitignore
        var gi = [bosco.getWorkspacePath(),'.gitignore'].join('/');
        fs.readFile(gi, function(err, contents) {
            if(err) { cb(err); }
            contents = contents || '';
            var ignore = contents.toString().split('\n');
            var newIgnore = _.union(ignore, repos, ['.DS_Store','node_modules','.bosco/bosco.json','']);
            fs.writeFile(gi, newIgnore.join('\n') + '\n', cb);
        });
    }

    async.series([saveRepos, checkOrphans, getRepos, gitIgnoreRepos], function() {
        bosco.log('Complete');
        if(next) next();
    });

}



function checkCanDelete(bosco, repoPath, next) {

    var reducer = function(memo, cmd, cb) {
        exec(cmd, {
            cwd: repoPath
        }, function(err, stdout) {
            return cb(err, memo && !err && !stdout);
        });
    }

    async.reduce([
        'git stash list',
        'git branch --no-merged origin/master',
        'git status --porcelain'
    ], true, reducer, function(err, result) {
        next(err, result)
    });

}

function clone(bosco, progressbar, bar, repoUrl, orgPath, next) {
    if(!progressbar) bosco.log('Cloning ' + repoUrl.blue + ' into ' + orgPath.blue);
    exec('git clone ' + repoUrl, {
      cwd: orgPath
    }, function(err, stdout, stderr) {
        if(progressbar) bar.tick();
        if(err) {
            if(progressbar) console.log('');
            bosco.error(repoUrl.blue + ' >> ' + stderr);
        } else {
            if(!progressbar && stdout) bosco.log(repoUrl.blue + ' >> ' + stdout);
        }
        next();
    });
}

