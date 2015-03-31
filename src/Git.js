var exec = require('child_process').exec;
var async = require('async');

module.exports = function(bosco) {

    function getLastCommitForAssets(staticAssets, next) {
        async.map(staticAssets, function(asset, cb) {
            getCommit(asset, function(err, commit) {
                asset.commit = commit;
                cb(err, asset);
            });
        }, next);
    }

    function getCommit(file, next) {
        var gitCmd = 'git log -n1 --oneline ' + file.relativePath;
        exec(gitCmd, {
            cwd: file.repoPath
        }, function(err, stdout, stderr) {
            if (err) {
                bosco.error(stderr);
            }
            next(err, stdout);
        });
    }

    return {
        getLastCommitForAssets: getLastCommitForAssets
    }
}
