const _ = require('lodash');
const prettyjson = require('prettyjson');

module.exports = {
  name: 'config',
  description: 'Lets you manage config from the command line instead of editing json files',
  usage: 'get <key> | set <key> <value> | clear <key>',
};

function cmd(bosco, args) {
  const type = args.shift();
  const key = args.shift();
  let value = args.shift();
  let prevValue;
  let github;
  let aws;

  function logConfig(config) {
    bosco.console.log(prettyjson.render(config, { noColor: false }));
    bosco.console.log('');
  }

  switch (type) {
    case 'get':
      if (key) {
        value = bosco.config.get(key);
        if (typeof value === 'undefined') {
          bosco.log(`No config found for ${key.green}`);
        } else {
          bosco.log(`Config for ${key.green}:`);
          logConfig(value);
        }
        break;
      }

      // Show various interesting configs
      bosco.console.log('');

      bosco.console.log(`Config for ${'github'.green}:`);
      github = _.clone(bosco.config.get('github'));
      delete github.repos;
      delete github.ignoredRepos;
      logConfig(github);

      bosco.console.log(`Config for ${'aws'.green}:`);
      aws = bosco.config.get('aws');
      logConfig(aws || 'Not defined');

      bosco.console.log(`Config for ${'js'.green}:`);
      logConfig(bosco.config.get('js'));

      bosco.console.log(`Config for ${'css'.green}:`);
      logConfig(bosco.config.get('css'));
      break;
    case 'set':
      if (!key && !value) return bosco.error(`You need to specify a key and value: ${'bosco config set <key> <value>'.blue}`);

      prevValue = bosco.config.get(key);

      if (typeof prevValue === 'object') {
        return bosco.error('You can only set values, not objects, try one of its children using \':\' as the separator - e.g. github:team');
      }

      bosco.log(`Changing ${key} from ${prevValue} to ${value}`);
      bosco.config.set(key, value);
      return bosco.config.save(() => {
        bosco.log('Saved config');
      });
    case 'clear':
      if (!key) return bosco.error(`You need to specify a key: ${'bosco config clear <key>'.blue}`);

      prevValue = bosco.config.get(key);

      bosco.log(`Clearing ${key} of value ${prevValue}`);
      bosco.config.clear(key);
      return bosco.config.save(() => {
        bosco.log('Saved config');
      });
    default:
      bosco.error(`The command needs to be of the format: ${(`bosco config ${module.exports.usage}`).blue}`);
      break;
  }
}

module.exports.cmd = cmd;
