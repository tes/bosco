
const async = require('async');
const Table = require('cli-table');
const _ = require('lodash');
const NodeRunner = require('../src/RunWrappers/Node');
const DockerRunner = require('../src/RunWrappers/Docker');

let nodeList = [];
let dockerList = [];

module.exports = {
  name: 'ps',
  description: 'Lists all running services',
};

function cmd(bosco) {
  function initialiseRunners(next) {
    const runners = [NodeRunner, DockerRunner];
    async.map(runners, (runner, cb) => {
      runner.init(bosco, cb);
    }, next);
  }

  function getRunningServices(next) {
    NodeRunner.listRunning(true, (err, nodeRunning) => {
      if (err) return next(err);
      nodeList = nodeRunning;
      DockerRunner.list(true, (err, dockerRunning) => {
        if (err) return next(err);
        dockerList = dockerRunning;
        next();
      });
    });
  }

  function calcFluidColumnWidth(fixedColumnWidths, numberOfColumns) {
    const minFluidColWidth = 20;
    const fluidColWidth = process.stdout.columns - fixedColumnWidths - numberOfColumns - 1;
    return (fluidColWidth > minFluidColWidth)
      ? fluidColWidth
      : minFluidColWidth;
  }

  function printNodeServices(name, list) {
    const table = new Table({
      chars: {
        mid: '', 'left-mid': '', 'mid-mid': '', 'right-mid': '',
      },
      head: [`${name} Service`, 'PID', 'Status', 'Mode', 'Watch'],
      colWidths: [calcFluidColumnWidth(42, 5), 10, 10, 12, 10],
    });

    list.forEach((item) => {
      table.push([item.name, item.pid || 'N/A', item.pm2_env.status, item.pm2_env.exec_mode, item.pm2_env.watch || '']);
    });

    bosco.console.log(table.toString());
    bosco.console.log('\r');
  }

  function printDockerServices(name, list) {
    const table = new Table({
      chars: {
        mid: '', 'left-mid': '', 'mid-mid': '', 'right-mid': '',
      },
      head: [`${name} Service`, 'Status', 'FQN'],
      colWidths: [25, 20, calcFluidColumnWidth(45, 3)],
    });

    list.forEach((item) => {
      table.push([
        _.map(item.Names, (i) => i.replace('/', '')).join(', '),
        item.Status,
        item.Image,
      ]);
    });

    bosco.console.log(table.toString());
    bosco.console.log('\r');
  }

  bosco.log('Getting running microservices ...');

  async.series([initialiseRunners, getRunningServices], () => {
    bosco.console.log('');
    bosco.log('Running NodeJS Services (via PM2):');
    printNodeServices('Node', nodeList);

    bosco.log('Running Docker Images:');
    printDockerServices('Docker', dockerList);

    process.exit(0);
  });
}

module.exports.cmd = cmd;
