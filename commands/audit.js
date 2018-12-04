var async = require('async');
var audit = require('nsp/lib/check');
var join = require('path').join;

module.exports = {
  name: 'audit',
  description: 'Audit npm packages across repos',
  usage: '[-r <repoPattern>]'
};

function cmd(bosco, args, next) {
  var repoPattern = bosco.options.repo;
  var repoRegex = new RegExp(repoPattern);

  var repos = bosco.getRepos();
  if (!repos) return bosco.error('You are repo-less :( You need to initialise bosco first, try \'bosco fly\'.');

  function nsp(repo, repoPath, cb) {
    if (!repo.match(repoRegex) || !bosco.exists([repoPath, 'package.json'].join('/'))) {
      bosco.log(repo.blue + ': ' + 'No package.json'.green);
      return cb();
    }

    audit(join(repoPath, 'package.json'), function (err, d) {
      if (err) {
        bosco.error(repoPath.blue + ' >> ' + err.message);
      } else if (d.length === 0) {
        bosco.log(repo.blue + ': ' + 'Looks ok...'.green);
      } else {
        d.forEach(function (item) {
          item.advisory.url = 'https://nodesecurity.io/advisories/' + item.advisory.url;
        });
        bosco.log(repoPath.blue + ': \n' + JSON.stringify(d, false, 2).red);
      }
      cb();
    });
  }

  function auditRepos(done) {
    async.mapLimit(repos, bosco.concurrency.cpu, function iterateRepos(repo, cb) {
      var repoPath = bosco.getRepoPath(repo);
      nsp(repo, repoPath, cb);
    }, function () {
      return done();
    });
  }

  bosco.console.warn = function () { };
  auditRepos(function () {
    bosco.log('Complete');
    if (next) next();
  });
}

module.exports.cmd = cmd;
