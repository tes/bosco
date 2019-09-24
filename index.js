var Bosco = require('bosco-core');

function boscoRun() {
  var bosco = new Bosco(__dirname);
  bosco.initWithCommandLineArgs();
  bosco.run();
}

module.exports = boscoRun;
