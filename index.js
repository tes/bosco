var Bosco = require('bosco-core');
var pkg = require('./package.json');

function boscoRun() {
  var bosco = new Bosco();
  bosco.initWithCommandLineArgs(pkg);
  bosco.run();
}

module.exports = boscoRun;
