const github = require('octonode');
const _ = require('lodash');
const fs = require('fs-extra');
const path = require('path');
const inquirer = require('inquirer');
const parseLinkHeader = require('parse-link-header');
const async = require('async');

module.exports = {
  name: 'team',
  description: 'A command to keep your Github organisation and team setup in sync with Bosco',
  usage: 'sync|ls|ln <team> <directory>',
};

function showTeams(bosco) {
  const teamConfig = bosco.config.get('teams');
  const teams = _.keys(teamConfig).sort();

  bosco.log('Your current github organisations and teams:');
  _.each(teams, (team) => {
    bosco.log(` - ${team.green} > ${teamConfig[team].path ? teamConfig[team].path.cyan : 'Not linked'.grey}`);
  });

  bosco.log(`Use the command: ${'bosco team sync'.green} to update your team list.`);
}

function getTeams(client, cb) {
  function createTeamPageRequestTask(page) {
    return (next) => {
      client.get('/user/teams', { page }, (err, status, body) => {
        next(err, body);
      });
    };
  }

  client.get('/user/teams', {}, (err, status, teams, headers) => {
    if (err) { return cb(err); }

    const links = parseLinkHeader(headers.link);

    if (!links) { return cb(null, teams); }

    const lastPage = parseInt(links.last.page, 10);

    // If the last page is this first page, we're done
    if (lastPage === 1) { return cb(null, teams); }

    // Create tasks to get the remaining pages of teams
    const tasks = _.range(2, lastPage + 1).map(createTeamPageRequestTask);

    async.parallel(tasks, (tasksErr, results) => {
      if (tasksErr) { return cb(tasksErr); }
      cb(null, teams.concat(_.flatten(results)));
    });
  });
}

function syncTeams(bosco, next) {
  const client = github.client(bosco.config.get('github:authToken'), { hostname: bosco.config.get('github:apiHostname') });
  const currentTeams = bosco.config.get('teams') || {};
  let added = 0;

  getTeams(client, (err, teams) => {
    if (err) { return bosco.error(`Unable to access github with given authKey: ${err.message}`); }

    _.each(teams, (team) => {
      const teamKey = `${team.organization.login}/${team.slug}`;
      if (!currentTeams || !currentTeams[teamKey]) {
        bosco.config.set(`teams:${teamKey}`, { id: team.id });
        bosco.log(`Added ${teamKey.green} team ...`);
        added += 1;
      }
    });

    // Add personal repo
    const user = bosco.config.get('github:user');
    if (!currentTeams[user]) {
      bosco.config.set(`teams:${user}`, { id: user, isUser: true });
    }

    bosco.config.save(() => {
      bosco.log(`Synchronisation with Github complete, added ${added || 'no new'} teams.`);
      if (next) { next(); }
    });
  });
}

function linkTeam(bosco, team, folder, next) {
  if (!team || !folder) {
    return bosco.error(`You need to provide both the team name and folder, e.g. ${'bosco ln tes/resources .'.green}`);
  }
  const teamPath = path.resolve(folder);
  if (!bosco.config.get(`teams:${team}`)) {
    return bosco.error(`Cant find the team: ${team.red}, maybe try to sync first?`);
  }

  fs.mkdirpSync(path.join(teamPath, '.bosco')); // Always create config folder
  bosco.config.set(`teams:${team}:path`, teamPath);

  bosco.config.save(() => {
    bosco.log(`Team ${team.green} path updated to: ${teamPath.cyan}`);
    bosco.options.workspace = bosco.findWorkspace(); // eslint-disable-line no-param-reassign
    if (next) { next(); }
  });
}

function setupInitialLink(bosco, next) {
  const teams = _.keys(bosco.config.get('teams')).sort();
  const currentTeam = bosco.getTeam();
  const repoQuestion = {
    type: 'list',
    message: 'Select a team to map to a workspace directory:',
    name: 'repo',
    default: currentTeam,
    choices: teams,
  };
  const folderQuestion = {
    type: 'input',
    message: 'Enter the path to map team to (defaults to current folder):',
    name: 'folder',
    default: '.',
  };

  inquirer.prompt([repoQuestion, folderQuestion]).then((answers) => {
    linkTeam(bosco, answers.repo, answers.folder, next);
  });
}

function cmd(bosco, args, next) {
  const action = args.shift();
  if (action === 'sync') { return syncTeams(bosco, next); }
  if (action === 'ls') { return showTeams(bosco); }
  if (action === 'ln') { return linkTeam(bosco, args.shift(), args.shift(), next); }
  if (action === 'setup') { return setupInitialLink(bosco, next); }

  const teamName = bosco.getTeam();
  if (!teamName) {
    bosco.log('Not in a team!'.red);
  } else {
    bosco.log(`You are in team: ${teamName.cyan}`);
  }
}

module.exports.cmd = cmd;
