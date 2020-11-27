const _ = require('lodash');
const Promise = require('bluebird');
const fs = require('fs-extra');
const github = require('octonode');
const path = require('path');
const { exec } = require('child_process');

const green = '\u001b[42m \u001b[0m';
const red = '\u001b[41m \u001b[0m';

module.exports = {
  name: 'clone',
  usage: '[-r <repoPattern>] [--clean]',
  description: 'Gets a list of all repos in your team and runs git clone for each',
  options: [{
    name: 'clean',
    type: 'boolean',
    desc: 'Remove any repositories in the workspace that are no longer in the github team',
  }],
};

async function getRepoList(client, teamConfig) {
  const url = teamConfig.isUser ? '/user/repos' : `/teams/${teamConfig.id}/repos`;
  const options = { per_page: 20 };

  let page = 1;
  let hasNext = false;

  let toReturn = await client.getAsync(url, { ...options, page })
    .then(([, body, headers]) => {
      hasNext = _.includes(headers.link, 'rel="next"');
      return _.map(body, 'name');
    });

  while (hasNext) {
    page += 1;
    // eslint-disable-next-line no-await-in-loop
    const [result, responseHasNext] = await client.getAsync(url, { ...options, page })
      .then(([, body, headers]) => {
        const hasNextInHeaders = _.includes(headers.link, 'rel="next"');
        return [_.map(body, 'name'), hasNextInHeaders];
      });

    toReturn = _.union(toReturn, result);
    hasNext = responseHasNext;
  }

  return toReturn;
}

function checkCanDelete(bosco, repoPath) {
  function reducer(memo, command) {
    return new Promise((resolve, reject) => {
      exec(command, {
        cwd: repoPath,
      }, (err, stdout) => {
        if (err) return reject(err);
        resolve(memo && !stdout);
      });
    });
  }

  return Promise.reduce([
    'git stash list',
    'git branch --no-merged origin/master',
    'git status --porcelain',
  ], reducer, true);
}

function clone(bosco, progressbar, bar, repoUrl, orgPath) {
  if (!progressbar) bosco.log(`Cloning ${repoUrl.blue} into ${orgPath.blue}`);
  return new Promise((resolve) => {
    exec(`git clone ${repoUrl}`, {
      cwd: orgPath,
    }, (err, stdout, stderr) => {
      if (progressbar) bar.tick();
      if (err) {
        if (progressbar) bosco.console.log('');
        bosco.error(`${repoUrl.blue} >> ${stderr}`);
      } else if (!progressbar && stdout) bosco.log(`${repoUrl.blue} >> ${stdout}`);
      resolve();
    });
  });
}

async function fetch(bosco, team, repos, repoRegex) {
  const orgPath = bosco.getOrgPath();

  function saveRepos() {
    bosco.config.set(`teams:${team}:repos`, repos);
    return new Promise((resolve, reject) => {
      bosco.config.save((err, ...rest) => (err ? reject(err) : resolve(...rest)));
    });
  }

  async function checkOrphans() {
    function warnOrphan(orphan) {
      bosco.warn(`I am concerned that you still have the repo ${orphan.red} as it is no longer in the github team, run "bosco clone --clean" to remove them.`);
    }

    async function removeOrphan(orphan) {
      const orphanPath = bosco.getRepoPath(orphan);
      try {
        const canDelete = await checkCanDelete(bosco, orphanPath);
        if (!canDelete) {
          bosco.warn(`Not deleting project ${orphan.red} as you have uncommited or unpushed local changes.`);
          return Promise.resolve();
        }

        await fs.remove(orphanPath);
        bosco.log(`Deleted project ${orphan.green} as it is no longer in the github team and you have no local changes.`);
      } catch (err) {
        bosco.warn(`Not deleting project ${orphan.red} as you have uncommited or unpushed local changes.`);
        return Promise.resolve();
      }
    }

    let orphanAction = warnOrphan;
    if (bosco.options.clean) {
      orphanAction = removeOrphan;
    }

    const files = await fs.promises.readdir(bosco.getOrgPath());
    const orphans = _.chain(files)
      .map((file) => path.join(bosco.getOrgPath(), file))
      .filter((file) => fs.statSync(file).isDirectory() && bosco.exists(path.join(file, '.git')))
      .map((file) => path.relative(bosco.getOrgPath(), file))
      .difference(repos)
      .value();
    return Promise.map(orphans, orphanAction);
  }

  async function getRepos() {
    const progressbar = bosco.config.get('progress') === 'bar';
    const total = repos.length;
    let pullFlag = false;

    const bar = progressbar ? new bosco.Progress('Getting repositories [:bar] :percent :etas', {
      complete: green,
      incomplete: red,
      width: 50,
      total,
    }) : null;

    await Promise.map(repos, (repo) => {
      if (!repo.match(repoRegex)) return Promise.resolve();

      const repoPath = bosco.getRepoPath(repo);
      const repoUrl = bosco.getRepoUrl(repo);

      if (bosco.exists(repoPath)) {
        pullFlag = true;
        if (progressbar) bar.tick();
        return Promise.resolve();
      }

      return clone(bosco, progressbar, bar, repoUrl, orgPath);
    }, { concurrency: bosco.concurrency.network });

    if (pullFlag) {
      bosco.warn('Some repositories already existed, to pull changes use \'bosco pull\'');
    }
  }

  async function gitIgnoreRepos() {
    // Ensure repo folders are in workspace gitignore
    const gi = [bosco.getWorkspacePath(), '.gitignore'].join('/');
    const contents = await fs.readFile(gi);
    const ignore = (contents || '').toString().split('\n');
    const newIgnore = _.union(ignore, repos, ['.DS_Store', 'node_modules', '.bosco/bosco.json', '']);
    return fs.writeFile(gi, `${newIgnore.join('\n')}\n`);
  }

  await saveRepos();
  await checkOrphans();
  await getRepos();
  await gitIgnoreRepos();
  bosco.log('Complete');
}

async function cmd(bosco) {
  const repoPattern = bosco.options.repo;
  const repoRegex = new RegExp(repoPattern);
  const team = bosco.getTeam() || 'no-team';
  const teamConfig = bosco.config.get(`teams:${team}`);

  const client = github.client(bosco.config.get('github:authToken'), { hostname: bosco.config.get('github:apiHostname') });

  if (!teamConfig) {
    // The user does not have a team, so just treat the repos config
    // as manually edited
    return bosco.error([
      'Looks like you havent linked this workspace to a team?  Try: ',
      'bosco team setup'.green,
      '. If you can\'t see your team in the list, Try: ',
      'bosco team sync'.green,
    ].join(''));
  }

  bosco.log(`Fetching repository list from Github for ${team.green} team ...`);

  try {
    const repoList = await getRepoList(client, teamConfig);
    bosco.log(`Cloning ${(`${repoList.length}`).green} repositories from Github for ${team.green} team ...`);
    await fetch(bosco, team, repoList, repoRegex);
  } catch (err) {
    bosco.error(err);
  }
}

module.exports.cmd = cmd;
