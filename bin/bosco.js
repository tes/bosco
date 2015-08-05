#!/usr/bin/env node

'use strict';

/**
 * Bosco command line tool
 */
var program = require('commander');
var Bosco = require('../index');
var _ = require('lodash');
var pkg = require('../package.json');
var completion = require('../src/completion');
var fs = require('fs');
var path = require('path');
require('colors'); // No need to define elsewhere

var bosco = new Bosco();

// Go over every command in the global and local commands folder and add the options
program.boscoOptionsArray = function(boscoOptionsArray) {
  if (!boscoOptionsArray || !boscoOptionsArray.length) { return this; }

  var _this = this;

  _.forEach(boscoOptionsArray, function(boscoOption) {
    if (!boscoOption.option || !boscoOption.syntax || boscoOption.syntax.length < 2) {
        throw new Error('Error parsing bosco command');
    }

    _this.option(boscoOption.syntax[0], boscoOption.syntax[1], boscoOption.syntax[2]);
  });

  return _this;
};

var getOptionsForCommandsOnPath = function(folderPath) {
  if (!fs.existsSync(folderPath)) return [];

  var wrappedFiles = _(fs.readdirSync(folderPath));

  var wrappedCommandsArray = wrappedFiles.map(function(filename) {
    if (path.extname(filename) !== '.js') { return null; }
    var file = folderPath + filename;
    var commandFile;
    try {
      commandFile = require(file);
    } catch (err) {
      bosco.error('Error requiring command file: ' + file + ': ' + err);
      return [];
    }
    return commandFile.options;
  });

  return wrappedCommandsArray.flatten().compact().value();
};

var globalOptions = [
  {
    option: 'configFile',
    syntax: ['-c, --configFile [file]', 'Use specific config file']
  },
  {
    option: 'configPath',
    syntax: ['-p, --configPath [folder]', 'Use specific config path']
  },
  {
    option: 'environment',
    syntax: ['-e, --environment [environment]', 'Set environment to use', 'local']
  },
  {
    option: 'service',
    syntax: ['-s, --service', 'Run only with service in cwd (if bosco-service.json file exists in cwd)', false]
  },
  {
    option: 'build',
    syntax: ['-b, --build [build]', 'Set build identifier to use', 'default']
  },
  {
    option: 'repo',
    syntax: ['-r, --repo [pattern]', 'Use a specific repository (parsed as regexp)', '.*']
  },
  {
    option: 'noprompt',
    syntax: ['-n, --noprompt', 'Do not prompt for confirmation']
  },
  {
    option: 'force',
    syntax: ['-f, --force', 'Force over ride on publish even if no changes']
  },
  {
    option: 'completion',
    syntax: ['--completion [shell]','Generate the shell completion code']
  },
  {
    option: 'shellCommands',
    syntax: ['--shellCommands','Generate commands for shell completion mode [used internally]']
  }
];

var localCommandsOptions = getOptionsForCommandsOnPath(bosco.getLocalCommandFolder());
var commandOptions = getOptionsForCommandsOnPath(bosco.getGlobalCommandFolder());

var allBoscoCommands = _.union(globalOptions, localCommandsOptions, commandOptions);

program
  .version(pkg.version)
  .usage('[options] <command>')
  .boscoOptionsArray(allBoscoCommands)
  .parse(process.argv);

var options = {
  program: program,
  version: pkg.version,
  args: program.args
};

// Add all parsed options to the Bosco options
_.forEach(allBoscoCommands, function(boscoOption){
  options[boscoOption.option] = program[boscoOption.option];
});

if(program.completion) {
    completion.print(program.completion);
}

bosco.run(options);
