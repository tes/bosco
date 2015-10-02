var _ = require('lodash');
var prettyjson = require('prettyjson');

module.exports = {
  name:'config',
  description:'Lets you manage config from the command line instead of editing json files',
  usage:'set <key> <value> | get <key>',
  cmd:cmd
}

function cmd(bosco, args) {
  var type = args.shift();
  var key = args.shift();
  var value = args.shift();

  if(type !== 'set' && type !== 'get') {
    bosco.error('The command needs to be of the format: ' + ('bosco config ' + module.exports.usage).blue);
  }

  if(type == 'get') {
    // Get the key
    if(!key) {
      console.log('')

      console.log('Config for ' + 'github'.green + ':');
      var github = _.clone(bosco.config.get('github'));
      delete github.repos;
      delete github.ignoredRepos;
      logConfig(github);

      console.log('Config for ' + 'aws'.green + ':')
      var aws = bosco.config.get('aws');
      logConfig(aws ? aws : 'Not defined');

      console.log('Config for ' + 'js'.green + ':');
      logConfig(bosco.config.get('js'));

      console.log('Config for ' + 'css'.green + ':');
      logConfig(bosco.config.get('css'));
    } else {
      bosco.log('Config for ' + key.green + ':');
      logConfig(bosco.config.get(key));
    }
  }

  if(type == 'set') {
    if(!key && !value) return bosco.error('You need to specify a key and value: ' + 'bosco config set <key> <value>'.blue);

    var prevValue = bosco.config.get(key);

    if(typeof prevValue == 'object') {
      return bosco.error('You can only set values, not objects, try one of its children using \':\' as the separator - e.g. github:team');
    }

    bosco.log('Changing ' + key + ' from ' + prevValue + ' to ' + value);
    bosco.config.set(key, value);
    bosco.config.save(function() {
      bosco.log('Saved config');
    });
  }
}

function logConfig(config) {
  console.log(prettyjson.render(config, {noColor: false}));
  console.log('');
}
