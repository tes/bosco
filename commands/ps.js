const Promise = require('bluebird');
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

async function cmd(bosco) {
  function initialiseRunners() {
    const runners = [NodeRunner, DockerRunner];
    return Promise.map(runners, (runner) => (runner.init(bosco)));
  }

  async function getRunningServices() {
    nodeList = await NodeRunner.listRunning(true);
    dockerList = await DockerRunner.list(true);
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

  try {
    await initialiseRunners();
    await getRunningServices();

    bosco.console.log('');
    bosco.log('Running NodeJS Services (via PM2):');
    printNodeServices('Node', nodeList);

    bosco.log('Running Docker Images:');
    printDockerServices('Docker', dockerList);
  } catch (err) {
    bosco.error(err);
  }
}

module.exports.cmd = cmd;
