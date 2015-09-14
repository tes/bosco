'use strict';
var _ = require('lodash');
var async = require('async');
var Table = require('cli-table');
var repoList = [], repoTable = [];

module.exports = {
  name:'ports',
  description:'Lists all the repos that uses a specified dependency (by inspecting configuration)',
  example:'bosco deps <dependency>',
  cmd:cmd
};

function cmd(bosco, args) {

  var repoPattern = bosco.options.repo;
  var repoRegex = new RegExp(repoPattern);
  var repos = bosco.getRepos();
  var dependency = (args.length > 0) ? args[0] : null;

  var getRepoList = function(next) {
    repos.forEach(function(repo) {
      if (repo.match(repoRegex)) {
        repoList.push(repo);
      }
    });
    next();
  };

  var getDependencies = function(packageConfig) {
    if(!bosco.exists(packageConfig)) return;
    var cfg = require(packageConfig);
    if (dependency) {
      if (_.has(cfg.dependencies, dependency)) return cfg.dependencies[dependency];
    } else {
      return Object.keys(cfg.dependencies || {}).length
    }
  };

  var getDevDependencies = function(packageConfig) {
    if(!bosco.exists(packageConfig)) return;
    var cfg = require(packageConfig);
    if (dependency) {
      if (_.has(cfg.devDependencies, dependency)) return cfg.devDependencies[dependency];
    } else {
      return Object.keys(cfg.devDependencies || {}).length
    }
  };

  var getDeps = function(next) {
    repoList.forEach(function(repo) {
      var repoPath = bosco.getRepoPath(repo),
        packageConfig = [repoPath, 'package.json'].join('/');

      var dependencies = getDependencies(packageConfig);
      var devDependencies = getDevDependencies(packageConfig);

      if(dependencies || devDependencies) repoTable.push([repo, dependencies || '', devDependencies || '']);
    });
    next(null);
  };

  var printDependencies = function(next) {
    var table = new Table({
      chars: {'mid': '', 'left-mid': '', 'mid-mid': '', 'right-mid': ''},
      head: ['Service', 'Dependency' + ((!dependency) ? ' Count' : ''), 'Dev Dependency' + ((!dependency) ? ' Count' : '')],
      colWidths: [40, 35, 35]
    });

    repoTable.forEach(function(item) {
      //console.dir(item);
      table.push(item);
    });

    console.log(table.toString());
    console.log('\r');

    next(null);
  };

  if (dependency) {
    bosco.log('Getting wich repos use \'' + dependency + '\' as dependency ...');
  } else {
    bosco.log('Getting dependency count on all repos ...');
  }

  async.series([getRepoList, getDeps, printDependencies], function() {
    process.exit(0);
  });
}