const Bosco = require('bosco-core');

function boscoRun() {
  const bosco = new Bosco(__dirname);
  bosco.initWithCommandLineArgs();
  bosco.run();
}

module.exports = boscoRun;
