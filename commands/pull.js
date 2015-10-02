var async = require('async');
var exec = require('child_process').exec;
var DockerRunner = require('../src/RunWrappers/Docker');
var green = '\u001b[42m \u001b[0m';
var red = '\u001b[41m \u001b[0m';

module.exports = {
    name:'pull',
    description:'Pulls any changes across all repos',
    usage:'[-r <repoPattern>]',
    cmd:cmd
}

function cmd(bosco, args, next) {

    var repoPattern = bosco.options.repo;
    var repoRegex = new RegExp(repoPattern);

    var repos = bosco.getRepos();
    if(!repos) return bosco.error('You are repo-less :( You need to initialise bosco first, try \'bosco clone\'.');

    bosco.log('Running ' + 'git pull --rebase'.blue + ' across all repos ...');

    var pullRepos = function(cb) {

        var progressbar = bosco.config.get('progress') == 'bar',
            total = repos.length;

        var bar = progressbar ? new bosco.progress('Doing git pull [:bar] :percent :etas', {
            complete: green,
            incomplete: red,
            width: 50,
            total: total
        }) : null;

        async.mapLimit(repos, bosco.concurrency.network, function repoStash(repo, repoCb) {

            if(!repo.match(repoRegex)) return repoCb();

            var repoPath = bosco.getRepoPath(repo);
            pull(bosco, progressbar, bar, repoPath, repoCb);

        }, function() {
            cb();
        });

    }

    var pullDockerImages = function(cb) {

        bosco.log('Checking for docker images to pull ...');

        var progressbar = bosco.config.get('progress') == 'bar',
            total = repos.length;

        var bar = progressbar ? new bosco.progress('Doing docker pull [:bar] :percent :etas', {
            complete: green,
            incomplete: red,
            width: 50,
            total: total
        }) : null;

        async.mapSeries(repos, function doDockerPull(repo, repoCb) {
            if(!repo.match(repoRegex)) return repoCb();
            var repoPath = bosco.getRepoPath(repo);
            dockerPull(bosco, progressbar, bar, repoPath, repo, repoCb);
        }, function() {
            cb();
        });

    }

    var clearGithubCache = function(cb) {
        var configKey = 'cache:github';
        bosco.config.set(configKey, {});
        bosco.config.save(cb);
    }

    var initialiseRunners = function(cb) {
        DockerRunner.init(bosco, cb);
    }

    var disconnectRunners = function(cb) {
        DockerRunner.disconnect(cb);
    }

    async.series([
        initialiseRunners,
        pullRepos,
        pullDockerImages,
        clearGithubCache,
        disconnectRunners
    ], function() {
        bosco.log('Complete!');
        if(next) next();
    });

}

function pull(bosco, progressbar, bar, repoPath, next) {

    if(!bosco.exists([repoPath,'.git'].join('/'))) {
        bosco.warn('Doesn\'t seem to be a git repo: '+ repoPath.blue);
        return next();
    }

    exec('git pull --rebase', {
        cwd: repoPath
    }, function(err, stdout, stderr) {
        if(progressbar) bar.tick();
        if(err) {
            if(progressbar) console.log('');
            bosco.error(repoPath.blue + ' >> ' + stderr);
        } else {
            if(!progressbar && stdout) {
                if(stdout.indexOf('up to date') > 0) {
                    bosco.log(repoPath.blue + ': ' + 'No change'.green);
                } else {
                    bosco.log(repoPath.blue + ': ' + 'Pulling changes ...'.red + '\n' + stdout);
                }
            }
        }
        next();
    });
}

function dockerPull(bosco, progressbar, bar, repoPath, repo, next) {

    var boscoService = [repoPath, 'bosco-service.json'].join('/');
    if (bosco.exists(boscoService)) {
        var definition = require(boscoService);
        if(definition.service && definition.service.type === 'docker') {
            DockerRunner.update(definition, function(err) {
                if(err) {
                    var errMessage = err.reason ? err.reason : err;
                    bosco.error('Error pulling ' + repo.green + ', reason: ' + errMessage.red);
                }
                next()
            });
        } else {
            return next();
        }
    } else {
        return next();
    }

}

