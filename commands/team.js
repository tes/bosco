var github = require('octonode');
var _ = require('lodash');
var fs = require('fs-extra');
var path = require('path');
var inquirer = require('inquirer');
var parseLinkHeader = require('parse-link-header');
var async = require('async');

module.exports = {
  name: 'team',
  description: 'A command to keep your Github organisation and team setup in sync with Bosco',
  usage: 'sync|ls|ln <team> <directory>'
};

function showTeams(bosco) {
  var teamConfig = bosco.config.get('teams');
  var teams = _.keys(teamConfig).sort();

  bosco.log('Your current github organisations and teams:');
  _.each(teams, function (team) {
    bosco.log(' - ' + team.green + ' > ' + (teamConfig[team].path ? teamConfig[team].path.cyan : 'Not linked'.grey));
  });

  bosco.log('Use the command: ' + 'bosco team sync'.green + ' to update your team list.');
}

function getTeams(client, cb) {
  function createTeamPageRequestTask(page) {
    return function (next) {
      client.get('/user/teams', { page: page }, function (err, status, body) {
        next(err, body);
      });
    };
  }

  client.get('/user/teams', {}, function (err, status, teams, headers) {
    if (err) { return cb(err); }

    var links = parseLinkHeader(headers.link);

    if (!links) { return cb(null, teams); }

    var lastPage = parseInt(links.last.page, 10);

    // If the last page is this first page, we're done
    if (lastPage === 1) { return cb(null, teams); }

    // Create tasks to get the remaining pages of teams
    var tasks = _.range(2, lastPage + 1).map(createTeamPageRequestTask);

    async.parallel(tasks, function (err, results) {
      if (err) { return cb(err); }
      cb(null, teams.concat(_.flatten(results)));
    });
  });
}

function syncTeams(bosco, next) {
  var client = github.client(bosco.config.get('github:authToken'), { hostname: bosco.config.get('github:apiHostname') });
  var currentTeams = bosco.config.get('teams') || {};
  var added = 0;

  getTeams(client, function (err, teams) {
    if (err) { return bosco.error('Unable to access github with given authKey: ' + err.message); }

    _.each(teams, function (team) {
      var teamKey = team.organization.login + '/' + team.slug;
      if (!currentTeams || !currentTeams[teamKey]) {
        bosco.config.set('teams:' + teamKey, { id: team.id });
        bosco.log('Added ' + teamKey.green + ' team ...');
        added++;
      }
    });

    // Add personal repo
    var user = bosco.config.get('github:user');
    if (!currentTeams[user]) {
      bosco.config.set('teams:' + user, { id: user, isUser: true });
    }

    bosco.config.save(function () {
      bosco.log('Synchronisation with Github complete, added ' + (added || 'no new') + ' teams.');
      if (next) { next(); }
    });
  });
}

function linkTeam(bosco, team, folder, next) {
  if (!team || !folder) {
    return bosco.error('You need to provide both the team name and folder, e.g. ' + 'bosco ln tes/resources .'.green);
  }
  var teamPath = path.resolve(folder);
  if (!bosco.config.get('teams:' + team)) {
    return bosco.error('Cant find the team: ' + team.red + ', maybe try to sync first?');
  }

  fs.mkdirpSync(path.join(teamPath, '.bosco')); // Always create config folder
  bosco.config.set('teams:' + team + ':path', teamPath);

  bosco.config.save(function () {
    bosco.log('Team ' + team.green + ' path updated to: ' + teamPath.cyan);
    bosco.options.workspace = bosco.findWorkspace();
    if (next) { next(); }
  });
}

function setupInitialLink(bosco, next) {
  var teams = _.keys(bosco.config.get('teams')).sort();
  var currentTeam = bosco.getTeam();
  var repoQuestion = {
    type: 'list',
    message: 'Select a team to map to a workspace directory:',
    name: 'repo',
    default: currentTeam,
    choices: teams
  };
  var folderQuestion = {
    type: 'input',
    message: 'Enter the path to map team to (defaults to current folder):',
    name: 'folder',
    default: '.'
  };

  inquirer.prompt([repoQuestion, folderQuestion]).then(function (answers) {
    linkTeam(bosco, answers.repo, answers.folder, next);
  });
}

function cmd(bosco, args, next) {
  var action = args.shift();
  if (action === 'sync') { return syncTeams(bosco, next); }
  if (action === 'ls') { return showTeams(bosco); }
  if (action === 'ln') { return linkTeam(bosco, args.shift(), args.shift(), next); }
  if (action === 'setup') { return setupInitialLink(bosco, next); }

  var teamName = bosco.getTeam();
  if (!teamName) {
    bosco.log('Not in a team!'.red);
  } else {
    bosco.log('You are in team: ' + teamName.cyan);
  }
}

module.exports.cmd = cmd;
