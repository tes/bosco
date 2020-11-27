const Promise = require('bluebird');
const { exec } = require('child_process');
const _ = require('lodash');
const NodeRunner = require('../src/RunWrappers/Node');
const RunListHelper = require('../src/RunListHelper');

const green = '\u001b[42m \u001b[0m';
const red = '\u001b[41m \u001b[0m';
const reposToInstall = [];

function isYarnUsed(bosco, repoPath) {
  const yarnrcFile = [repoPath, '.yarnrc'].join('/');
  const yarnLockFile = [repoPath, 'yarn.lock'].join('/');
  return bosco.exists(yarnrcFile) || bosco.exists(yarnLockFile);
}

function getPackageManager(bosco, repoPath, interpreter) {
  const nvm = (interpreter && bosco.options.nvmUse) || bosco.options.nvmUseDefault;
  let name;
  let command;
  if (isYarnUsed(bosco, repoPath)) {
    name = 'Yarn';
    command = 'yarn --pure-lockfile';
  } else {
    name = 'NPM';
    command = 'npm';
    if (bosco.config.get('npm:registry')) {
      command += `--registry ${bosco.config.get('npm:registry')}`;
    }
    command += ' --no-package-lock install';
  }
  return { name, command: nvm + command };
}

async function cleanModulesIfVersionChanged(bosco, repoPath, repo) {
  const currentVersion = await NodeRunner.getVersion(bosco, { cwd: repoPath });
  const nodeVersionKey = `teams:${bosco.getTeam()}:nodes:${repo}`;
  const lastVersion = bosco.config.get(nodeVersionKey);

  if (lastVersion && lastVersion !== currentVersion) {
    bosco.prompt.start();
    const confirmationDescription = 'Node version in '.white + repo.cyan + ' has changed from '.white + lastVersion.green + ' to '.white + currentVersion.green + ', should I clear node_modules (y/N)?'.white;
    const result = await new Promise((resolve) => {
      bosco.prompt.get({
        properties: {
          confirm: {
            description: confirmationDescription,
          },
        },
      }, (promptErr, promptResult) => resolve(promptResult));
    });

    if (!result || (result.confirm !== 'Y' && result.confirm !== 'y')) {
      return Promise.resolve();
    }

    await new Promise((resolve) => {
      exec('rm -rf ./node_modules', { cwd: repoPath }, (execErr, stdout, stderr) => {
        if (execErr) {
          bosco.error(`Failed to clear node_modules for ${repoPath.blue} >> ${stderr}`);
          return resolve();
        }
        bosco.log(`Node version in ${repo.green} updated to ${currentVersion.green}`);
        bosco.config.set(nodeVersionKey, currentVersion);
        resolve();
      });
    });
  } else {
    bosco.log(`Node version in ${repo.green} is OK at ${currentVersion.green}`);
    bosco.config.set(nodeVersionKey, currentVersion);
    Promise.resolve();
  }
}

async function shouldInstallRepo(bosco, repoPath, repo) {
  const currentHash = await NodeRunner.getHashes(bosco, ['package.json', '.nvmrc', 'yarn.lock', 'package-lock.json'], { cwd: repoPath });
  const nodeHashKey = `teams:${bosco.getTeam()}:hashes:${repo}`;
  const lastHash = bosco.config.get(nodeHashKey);
  if (lastHash !== currentHash) {
    reposToInstall.push(repo);
    bosco.config.set(nodeHashKey, currentHash);
  }
}

async function install(bosco, progressbar, bar, repoPath, repo) {
  const packageJson = [repoPath, 'package.json'].join('/');
  if (!bosco.exists(packageJson)) {
    if (progressbar) bar.tick();
    return Promise.resolve();
  }

  const interpreter = await new Promise((resolve) => {
    NodeRunner.getInterpreter(bosco, { name: repo, cwd: repoPath }, (err, result) => {
      if (err) {
        bosco.error(err);
        return resolve();
      }
      resolve(result);
    });
  });

  const packageManager = getPackageManager(bosco, repoPath, interpreter);
  await new Promise((resolve) => {
    exec(packageManager.command, {
      cwd: repoPath,
    }, (execErr, stdout, stderr) => {
      if (progressbar) bar.tick();
      if (execErr) {
        if (progressbar) bosco.console.log('');
        bosco.error(`${repoPath.blue} >> ${stderr}`);
      } else if (!progressbar) {
        if (!stdout) {
          bosco.log(`${packageManager.name} install for ${repoPath.blue}: ${'No changes'.green}`);
        } else {
          bosco.log(`${packageManager.name} install for ${repoPath.blue}`);
          bosco.console.log(stdout);
          if (stderr) {
            bosco.error(stderr);
          }
        }
      }
      resolve();
    });
  });
}

async function cmd(bosco) {
  const repoPattern = bosco.options.repo;
  const repoRegex = new RegExp(repoPattern);

  let repos = bosco.getRepos();
  if (!repos) return bosco.error('You are repo-less :( You need to initialise bosco first, try \'bosco clone\'.');

  bosco.log('Running install across repos ...');

  async function setRunRepos() {
    if (!bosco.cmdHelper.checkInService()) {
      return;
    }
    const runRepos = await RunListHelper.getRepoRunList(bosco, bosco.getRepos(), repoRegex, '$^', null, false);

    repos = _.chain(runRepos)
      .filter((repo) => repo.type !== 'docker')
      .map('name')
      .value();
  }

  function shouldInstallRepos() {
    return Promise.mapSeries(repos, (repo) => {
      if (!repo.match(repoRegex)) { return; }
      const repoPath = bosco.getRepoPath(repo);
      return shouldInstallRepo(bosco, repoPath, repo);
    }).then(() => {
      if (reposToInstall.length > 0) {
        bosco.log('The following repos had changes in key files, so will trigger an install: ');
        bosco.log(reposToInstall.join(', ').cyan);
      }
    });
  }

  function checkRepos() {
    return Promise.mapSeries(reposToInstall, (repo) => {
      if (!repo.match(repoRegex)) return Promise.resolve();
      const repoPath = bosco.getRepoPath(repo);
      return cleanModulesIfVersionChanged(bosco, repoPath, repo);
    });
  }

  function installRepos() {
    const progressbar = bosco.config.get('progress') === 'bar';
    const total = repos.length;

    const bar = progressbar ? new bosco.Progress('Doing npm install [:bar] :percent :etas', {
      complete: green,
      incomplete: red,
      width: 50,
      total,
    }) : null;

    return Promise.map(reposToInstall, (repo) => {
      if (!repo.match(repoRegex)) return;
      const repoPath = bosco.getRepoPath(repo);
      return install(bosco, progressbar, bar, repoPath, repo);
    }, { concurrency: bosco.concurrency.cpu });
  }

  function saveConfig() {
    return new Promise((resolve, reject) => {
      bosco.config.save((err, ...rest) => (err ? reject(err) : resolve(...rest)));
    });
  }

  try {
    await setRunRepos();
    await shouldInstallRepos();
    await checkRepos();
    await installRepos();
    await saveConfig();

    bosco.log('npm install complete');
  } catch (err) {
    bosco.error(err);
  }
}

module.exports = {
  name: 'install',
  description: 'Runs npm install against all repos',
  usage: '[-r <repoPattern>]',
  requiresNvm: true,
  cmd,
};
