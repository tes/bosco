#!/usr/bin/env node

/**
 * Bosco command line tool
 */
var _ = require('lodash');
require('colors'); // No need to define elsewhere
var fs = require('fs');
var path = require('path');
var yargs = require('yargs');

var Bosco = require('../index');
var pkg = require('../package.json');

var bosco = new Bosco();

var globalOptions = require('../config/options.json');

function addCommandOptions(args, command) {
  var cmdArgs = args.wrap(null);

  if (command.example) cmdArgs = cmdArgs.example(command.example);

  var usage = 'Usage: $0';
  if (command.name) usage += ' ' + command.name;
  if (command.usage) usage += ' ' + command.usage;
  if (command.description) usage += '\n\n' + command.description;
  cmdArgs = cmdArgs.usage(usage);

  var options = command.options || [];

  _.forEach(options, function(option) {
    if (!option.name) {
      throw new Error('Error parsing bosco command ' + command.name + ' options');
    }

    cmdArgs = cmdArgs.option(option.name, option);
  });

  _.forEach(globalOptions, function(option) {
    cmdArgs = cmdArgs.option(option.name, option);
  });

  return cmdArgs.help('help').alias('help', 'h');
}

function addBoscoCommands(args, commands) {
  if (!commands || !commands.length) { return args; }

  function checkCommandOptions(command) {
    if (!command.options) return true;

    var oldStyleArgs = false;
    _.forEach(command.options, function(option) {
      if (!option.name) {
        if (!option.option || !option.syntax || option.syntax.length < 2) {
          throw new Error('Error parsing bosco command ' + command.name + ' options');
        }
        oldStyleArgs = true;
      }
    });
    return !oldStyleArgs;
  }

  _.forEach(commands, function(command) {
    if (!command) return;

    if (!checkCommandOptions(command)) {
      bosco.warn('The ' + command.name + ' command uses old-style options, it will not be available until upgraded to the new style.');
      return;
    }

    args.command(command.name, command.description, function(commandArgs) {
      addCommandOptions(commandArgs, command);
    });
  });

  return args;
}

function getCommandsOnPath(folderPath) {
  if (!fs.existsSync(folderPath)) return [];

  return _.map(fs.readdirSync(folderPath), function(filename) {
    if (path.extname(filename) !== '.js') return null;

    var file = folderPath + filename;
    try {
      var command = require(file);
      if (command.name && command.cmd) return command;
      if (!command.name) bosco.error('Error: ' + file + ' does not have a name specified');
      if (!command.cmd) bosco.error('Error: ' + file + ' does not have a cmd specified');
    } catch (err) {
      bosco.error('Error requiring command file: ' + file + ': ' + err);
    }
    return null;
  });
}

var globalCommand = {
  name: '',
  usage: '[<options>] <command> [<args>]',
  description: pkg.description,
  options: [
    {
      name: 'completion',
      type: 'string',
      desc: 'Generate the shell completion code',
    },
    {
      name: 'shellCommands',
      type: 'boolean',
      desc: 'Generate commands for shell completion mode [used internally]',
    },
  ],
};

var boscoArgs = addCommandOptions(yargs, globalCommand)
  .version(pkg.version);

var globalCommandPath = bosco.getGlobalCommandFolder();
var globalCommands = getCommandsOnPath(bosco.getGlobalCommandFolder());

var localCommandPath = bosco.getLocalCommandFolder();
var localCommands = [];
if (localCommandPath !== globalCommandPath) {
  localCommands = getCommandsOnPath(localCommandPath);
}

// Go over every command in the global and local commands folder and add the options
boscoArgs = addBoscoCommands(boscoArgs, globalCommands);
boscoArgs = addBoscoCommands(boscoArgs, localCommands);

// Manually parse argv due to change in yargs
boscoArgs.parse(_.drop(process.argv, 2));
var argv = boscoArgs.argv || {};

if (argv.completion) {
  boscoArgs.showCompletionScript();
  process.exit();
}

// Only take options we have specified.
var boscoOptions = {};
_.forOwn((boscoArgs.parsed || {}).aliases || {}, function(val, optionName) {
  boscoOptions[optionName] = argv[optionName];
});

boscoOptions.program = boscoArgs;
boscoOptions.args = argv._;
boscoOptions.version = pkg.version;

bosco.run(boscoOptions);
