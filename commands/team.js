var github = require('octonode');
var _ = require('lodash');
var fs = require('fs-extra');
var path = require('path');
var inquirer = require('inquirer');
var parseLinkHeader = require('parse-link-header');
var async = require('async');

module.exports = {
    name:'team',
    description:'A command to keep your Github organisation and team setup in sync with Bosco',
    example:'bosco team sync | bosco team ls | bosco team ln <team> <directory>',
    cmd:cmd
}

function cmd(bosco, args, next) {
  var action = args.shift();
  if(action == 'sync') { return syncTeams(bosco, next); }
  if(action == 'ls') { return showTeams(bosco); }
  if(action == 'ln') { return linkTeam(bosco, args.shift(), args.shift(), next); }
  if(action == 'setup') { return setupInitialLink(bosco, next); }
  bosco.log('You are in team: ' + (bosco.getTeam() ? bosco.getTeam().cyan : 'Not in a workspace!'.red));
}

function showTeams(bosco) {

  var teamConfig = bosco.config.get('teams'),
      teams = _.keys(teamConfig);

  bosco.log('Your current github organisations and teams:');
  _.each(teams, function(team) {
    bosco.log(' - ' + team.green + ' > ' + (teamConfig[team].path ? teamConfig[team].path.cyan : 'Not linked'.grey));
  });

  bosco.log('Use the command: ' + 'bosco team sync'.green + ' to update your team list.')
}

function syncTeams(bosco, next) {

  var client = github.client(bosco.config.get('github:authToken')),
      currentTeams = bosco.config.get('teams') || {},
      added = 0;

  getTeams(client, function(err, teams) {
    if(err) { return bosco.error('Unable to access github with given authKey: ' + err.message); }

    _.each(teams, function(team) {
        var teamKey = team.organization.login + '/' + team.slug;
        if(!currentTeams || !currentTeams[teamKey]) {
          bosco.config.set('teams:' + teamKey, {id:team.id});
          bosco.log('Added ' + teamKey.green + ' team ...');
          added++;
        }
    });

    // Add personal repo
    var user = bosco.config.get('github:user');
    if(!currentTeams[user]) {
      bosco.config.set('teams:' + user, {id:user, isUser: true});
    }

    bosco.config.save(function() {
      bosco.log('Synchronisation with Github complete, added ' + (added ? added : 'no new') + ' teams.');
      if(next) { next(); }
    });

  });
}

function getTeams(client, cb) {

  client.get('/user/teams', {}, function(err, status, teams, headers) {
    if(err) { return cb(err); }

    var links = parseLinkHeader(headers.link);

    if(!links) { return cb(null, teams); }

    var lastPage = parseInt(links.last.page);

    // If the last page is this first page, we're done
    if(lastPage == 1) { return cb(null, teams); }

    // Create tasks to get the remaining pages of teams
    var tasks = _.range(2, lastPage + 1).map(createTeamPageRequestTask);

    async.parallel(tasks, function(err, results) {
      if(err) { return cb(err); }
      cb(null, teams.concat(_.flatten(results)));
    });
  });

  function createTeamPageRequestTask(page) {
    return function(cb) {
      client.get('/user/teams', {page: page}, function(err, status, body) {
        cb(err, body);
      });
    }
  }
}

function setupInitialLink(bosco, next) {

  var teams = _.keys(bosco.config.get('teams'));

  inquirer.prompt([
    {
      type: 'list',
      message: 'Select a team to map to a workspace directory:',
      name: 'repo',
      choices: teams
    }
  ], function( answer1 ) {
    inquirer.prompt([
        {
          type: 'input',
          message: 'Enter the path to map team to (defaults to current folder):',
          name: 'folder',
          default:'.'
        }
      ], function( answer2 ) {
        linkTeam(bosco, answer1.repo, answer2.folder, next);
      }
    );

  });

}

function linkTeam(bosco, team, folder, next) {

    if(!team || !folder) {
      return bosco.error('You need to provide both the team name and folder, e.g. ' + 'bosco ln tes/resources .'.green);
    }
    var teamPath = path.resolve(folder);
    if(!bosco.config.get('teams:' + team)) {
      return bosco.error('Cant find the team: ' + team.red + ', maybe try to sync first?');
    }

    fs.mkdirpSync(path.join(teamPath,'.bosco')); // Always create config folder
    bosco.config.set('teams:' + team + ':path', teamPath);

    bosco.config.save(function() {
      bosco.log('Team ' + team.green + ' path updated to: ' + teamPath.cyan);
      if(next) { next(); }
    });

}
