var async = require('async');
var exec = require('child_process').exec;
var green = '\u001b[42m \u001b[0m';
var red = '\u001b[41m \u001b[0m';

module.exports = {
    name:'install',
    description:'Runs npm install against all repos',
    usage:'[-r <repoPattern>]',
    cmd:cmd
}

function cmd(bosco, args, next) {

    var repoPattern = bosco.options.repo;
    var repoRegex = new RegExp(repoPattern);

    var repos = bosco.getRepos();
    if(!repos) return bosco.error('You are repo-less :( You need to initialise bosco first, try \'bosco clone\'.');

    bosco.log('Running npm install across all repos ...');

    var installRepos = function(cb) {

        var progressbar = bosco.config.get('progress') == 'bar',
            total = repos.length;

        var bar = progressbar ? new bosco.progress('Doing npm install [:bar] :percent :etas', {
            complete: green,
            incomplete: red,
            width: 50,
            total: total
        }) : null;

        async.mapLimit(repos, bosco.concurrency.cpu, function repoStash(repo, repoCb) {

            if(!repo.match(repoRegex)) return repoCb();

            var repoPath = bosco.getRepoPath(repo);
            install(bosco, progressbar, bar, repoPath, repoCb);

        }, function() {
            cb();
        });

    }

    installRepos(function() {
        bosco.log('npm install complete');
        if(next) next();
    });

}

function install(bosco, progressbar, bar, repoPath, next) {

    var packageJson = [repoPath,'package.json'].join('/');
    if(!bosco.exists(packageJson)) {
        if(progressbar) bar.tick();
        return next();
    }

    var npmCommand = 'npm';
    if(bosco.config.get('npm:registry')) {
        npmCommand += ' --registry ' + bosco.config.get('npm:registry');
    }
    npmCommand += ' install';

    exec(npmCommand, {
        cwd: repoPath
    }, function(err, stdout, stderr) {
        if(progressbar) bar.tick();
        if(err) {
            if(progressbar) console.log('');
            bosco.error(repoPath.blue + ' >> ' + stderr);
        } else {
            if(!progressbar) {
                if(!stdout) {
                    bosco.log('NPM install for ' + repoPath.blue + ': ' + 'No changes'.green);
                } else {
                    bosco.log('NPM install for ' + repoPath.blue);
                    console.log(stdout);
                }
            }
        }
        next();
    });

}
