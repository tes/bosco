const async = require('async');
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
  const nvm = interpreter && bosco.options.nvmUse || bosco.options.nvmUseDefault;
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

function cleanModulesIfVersionChanged(bosco, repoPath, repo, next) {
  NodeRunner.getVersion(bosco, { cwd: repoPath }, (err, currentVersion) => {
    if (err) { return next(err); }
    const nodeVersionKey = `teams:${bosco.getTeam()}:nodes:${repo}`;
    const lastVersion = bosco.config.get(nodeVersionKey);
    if (lastVersion && lastVersion !== currentVersion) {
      bosco.prompt.start();
      const confirmationDescription = 'Node version in '.white + repo.cyan + ' has changed from '.white + lastVersion.green + ' to '.white + currentVersion.green + ', should I clear node_modules (y/N)?'.white;
      bosco.prompt.get({
        properties: {
          confirm: {
            description: confirmationDescription,
          },
        },
      }, (err, result) => {
        if (!result || (result.confirm !== 'Y' && result.confirm !== 'y')) {
          return next();
        }

        exec('rm -rf ./node_modules', { cwd: repoPath }, (err, stdout, stderr) => {
          if (err) {
            bosco.error(`Failed to clear node_modules for ${repoPath.blue} >> ${stderr}`);
          } else {
            bosco.log(`Node version in ${repo.green} updated to ${currentVersion.green}`);
            bosco.config.set(nodeVersionKey, currentVersion);
          }
          next();
        });
      });
    } else {
      bosco.log(`Node version in ${repo.green} is OK at ${currentVersion.green}`);
      bosco.config.set(nodeVersionKey, currentVersion);
      next();
    }
  });
}

function shouldInstallRepo(bosco, repoPath, repo, next) {
  NodeRunner.getHashes(bosco, ['package.json', '.nvmrc', 'yarn.lock', 'package-lock.json'], { cwd: repoPath }, (err, currentHash) => {
    if (err) { return next(err); }
    const nodeHashKey = `teams:${bosco.getTeam()}:hashes:${repo}`;
    const lastHash = bosco.config.get(nodeHashKey);
    if (lastHash !== currentHash) {
      reposToInstall.push(repo);
      bosco.config.set(nodeHashKey, currentHash);
    }
    next();
  });
}

function install(bosco, progressbar, bar, repoPath, repo, next) {
  const packageJson = [repoPath, 'package.json'].join('/');
  if (!bosco.exists(packageJson)) {
    if (progressbar) bar.tick();
    return next();
  }

  NodeRunner.getInterpreter(bosco, { name: repo, cwd: repoPath }, (err, interpreter) => {
    if (err) {
      bosco.error(err);
      return next();
    }

    const packageManager = getPackageManager(bosco, repoPath, interpreter);
    exec(packageManager.command, {
      cwd: repoPath,
    }, (err, stdout, stderr) => {
      if (progressbar) bar.tick();
      if (err) {
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
      next();
    });
  });
}

function cmd(bosco, args, next) {
  const repoPattern = bosco.options.repo;
  const repoRegex = new RegExp(repoPattern);

  let repos = bosco.getRepos();
  if (!repos) return bosco.error('You are repo-less :( You need to initialise bosco first, try \'bosco clone\'.');

  bosco.log('Running install across repos ...');

  function setRunRepos(cb) {
    if (!bosco.cmdHelper.checkInService()) {
      return cb();
    }

    RunListHelper.getRepoRunList(bosco, bosco.getRepos(), repoRegex, '$^', null, false, (err, runRepos) => {
      repos = _.chain(runRepos)
        .filter((repo) => repo.type !== 'docker')
        .map('name')
        .value();
      cb(err);
    });
  }

  function shouldInstallRepos(cb) {
    async.mapSeries(repos, (repo, repoCb) => {
      if (!repo.match(repoRegex)) { return repoCb(); }
      const repoPath = bosco.getRepoPath(repo);
      shouldInstallRepo(bosco, repoPath, repo, repoCb);
    }, () => {
      if (reposToInstall.length > 0) {
        bosco.log('The following repos had changes in key files, so will trigger an install: ');
        bosco.log(reposToInstall.join(', ').cyan);
      }
      cb();
    });
  }

  function checkRepos(cb) {
    async.mapSeries(reposToInstall, (repo, repoCb) => {
      if (!repo.match(repoRegex)) return repoCb();
      const repoPath = bosco.getRepoPath(repo);
      cleanModulesIfVersionChanged(bosco, repoPath, repo, repoCb);
    }, () => {
      cb();
    });
  }

  function installRepos(cb) {
    const progressbar = bosco.config.get('progress') === 'bar';
    const total = repos.length;

    const bar = progressbar ? new bosco.Progress('Doing npm install [:bar] :percent :etas', {
      complete: green,
      incomplete: red,
      width: 50,
      total,
    }) : null;

    async.mapLimit(reposToInstall, bosco.concurrency.cpu, (repo, repoCb) => {
      if (!repo.match(repoRegex)) return repoCb();
      const repoPath = bosco.getRepoPath(repo);
      install(bosco, progressbar, bar, repoPath, repo, repoCb);
    }, () => {
      cb();
    });
  }

  function saveConfig(cb) {
    bosco.config.save(cb);
  }

  async.series([
    setRunRepos,
    shouldInstallRepos,
    checkRepos,
    installRepos,
    saveConfig,
  ], () => {
    bosco.log('npm install complete');
    if (next) next();
  });
}

module.exports = {
  name: 'install',
  description: 'Runs npm install against all repos',
  usage: '[-r <repoPattern>]',
  requiresNvm: true,
  cmd,
};
