var async = require('async');
var exec = require('child_process').exec;
var NodeRunner = require('../src/RunWrappers/Node');
var CmdHelper = require('../src/CmdHelper');
var RunListHelper = require('../src/RunListHelper');
var _ = require('lodash');
var green = '\u001b[42m \u001b[0m';
var red = '\u001b[41m \u001b[0m';

module.exports = {
  name: 'install',
  description: 'Runs npm install against all repos',
  usage: '[-r <repoPattern>]',
  requiresNvm: true,
};

function install(bosco, progressbar, bar, repoPath, repo, next) {
  var packageJson = [repoPath, 'package.json'].join('/');
  if (!bosco.exists(packageJson)) {
    if (progressbar) bar.tick();
    return next();
  }

  var yarnrcFile = [repoPath, '.yarnrc'].join('/');
  if (bosco.exists(yarnrcFile)) {
    var yarnComamnd = 'yarn';
    exec(yarnComamnd, {
      cwd: repoPath,
    }, function(err, stdout, stderr) {
      if (progressbar) bar.tick();
      if (err) {
        if (progressbar) bosco.console.log('');
        bosco.error(repoPath.blue + ' >> ' + stderr);
      } else {
        if (!progressbar) {
          if (!stdout) {
            bosco.log('Yarn install for ' + repoPath.blue + ': ' + 'No changes'.green);
          } else {
            bosco.log('Yarn install for ' + repoPath.blue);
            bosco.console.log(stdout);
            if (stderr) {
              bosco.error(stderr);
            }
          }
        }
      }
      next();
    });
  } else {
    NodeRunner.getInterpreter(bosco, {name: repo, cwd: repoPath}, function(err, interpreter) {
      if (err) {
        bosco.error(err);
        return next();
      }
      var npmCommand;
      if (interpreter) {
        npmCommand = bosco.options.nvmUse + 'npm';
      } else {
        npmCommand = bosco.options.nvmUseDefault + 'npm';
      }
      if (bosco.config.get('npm:registry')) {
        npmCommand += ' --registry ' + bosco.config.get('npm:registry');
      }
      npmCommand += ' install';

      exec(npmCommand, {
        cwd: repoPath,
      }, function(err, stdout, stderr) {
        if (progressbar) bar.tick();
        if (err) {
          if (progressbar) bosco.console.log('');
          bosco.error(repoPath.blue + ' >> ' + stderr);
        } else {
          if (!progressbar) {
            if (!stdout) {
              bosco.log('NPM install for ' + repoPath.blue + ': ' + 'No changes'.green);
            } else {
              bosco.log('NPM install for ' + repoPath.blue);
              bosco.console.log(stdout);
              if (stderr) {
                bosco.error(stderr);
              }
            }
          }
        }
        next();
      });
    });
  }
}

function cmd(bosco, args, next) {
  var repoPattern = bosco.options.repo;
  var repoRegex = new RegExp(repoPattern);

  var repos = bosco.getRepos();
  if (!repos) return bosco.error('You are repo-less :( You need to initialise bosco first, try \'bosco clone\'.');

  bosco.log('Running npm install across repos ...');

  function setRunRepos(cb) {
    if (!CmdHelper.checkInService(bosco)) {
      return cb();
    }

    RunListHelper.getRepoRunList(bosco, bosco.getRepos(), repoRegex, '$^', null, function(err, runRepos) {
      repos = _.chain(runRepos)
              .filter(function(repo) { return repo.type !== 'remote'; })
              .map('name');
      cb(err);
    });
  }

  function installRepos(cb) {
    var progressbar = bosco.config.get('progress') === 'bar';
    var total = repos.length;

    var bar = progressbar ? new bosco.Progress('Doing npm install [:bar] :percent :etas', {
      complete: green,
      incomplete: red,
      width: 50,
      total: total,
    }) : null;

    async.mapLimit(repos, bosco.concurrency.cpu, function repoStash(repo, repoCb) {
      if (!repo.match(repoRegex)) return repoCb();
      var repoPath = bosco.getRepoPath(repo);
      install(bosco, progressbar, bar, repoPath, repo, repoCb);
    }, function() {
      cb();
    });
  }

  async.series([
    setRunRepos,
    installRepos,
  ], function() {
    bosco.log('npm install complete');
    if (next) next();
  });
}

module.exports.cmd = cmd;
