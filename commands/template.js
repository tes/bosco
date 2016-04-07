var _ = require('lodash');
var path = require('path');
var fs = require('fs');
var async = require('async');
var execFile = require('child_process').execFile;
var hb = require('handlebars');

module.exports = {
    name:'template',
    description:'A command to allow generic, template driven creation of new services and apps',
    example:'bosco template | bosco template add|remove <githubRepo> | bosco template create <templateName> <serviceName> <port>',
    cmd:cmd
}

function cmd(bosco, args, next) {
  var action = args.shift();
  if(action == 'create') { return newServiceFromTemplate(bosco, args, next); }
  if(action == 'add') { return addTemplate(bosco, args, next); }
  if(action == 'remove') { return removeTemplate(bosco, args, next); }
  listTemplates(bosco, next);
}

function listTemplates(bosco, next) {

  var templates = bosco.config.get('templates');

  bosco.log('Your current templates are:');
  _.each(templates, function(template) {
    bosco.log(' - ' + template.green);
  });

  bosco.log('Use the command: ' + 'bosco template add <githubRepo>'.green + ' to add to your template list.')
  if(next) { next(); }

}

function newServiceFromTemplate(bosco, args, next) {

    var templates = bosco.config.get('templates') || [];

    var templateRepoName = args.shift();
    var targetServiceName = args.shift();
    var targetServicePort = args.shift();

    if(!templateRepoName || !targetServiceName || !targetServicePort) {
        return bosco.log('You need to specify a template, a target service name and a port: ' + 'bosco template create <githubRepo> <serviceName> <port>'.green);
    }

    var template = _.filter(templates, function(item) { return item.match(new RegExp(templateRepoName)); })[0];

    if(!template) {
      bosco.log('Couldnt find a service that matched: ' + templateRepoName.red);
      return listTemplates(bosco, next);
    }

    bosco.log('Creating new service: ' + targetServiceName.green + ' from template: ' + template.green);

    var gitCmd = 'git';
    var gitOptions = ['clone','--depth=1','git@github.com:' + template, targetServiceName];

    var serviceDirectory = path.resolve('.', targetServiceName);

    async.series([
      async.apply(execCmd, bosco, gitCmd, gitOptions, path.resolve('.')),
      async.apply(execCmd, bosco, 'rm',['-rf','.git'], serviceDirectory),
      async.apply(execCmd, bosco, 'git',['init'], serviceDirectory),
      async.apply(copyTemplateFiles, bosco, targetServiceName, targetServicePort, serviceDirectory),
      async.apply(execCmd, bosco, 'rm',['-rf','templates'], serviceDirectory),
      async.apply(execCmd, bosco, 'rm',['-f','bosco-templates.json'], serviceDirectory),
      async.apply(execCmd, bosco, 'git',['add','--all','.'], serviceDirectory),
      async.apply(execCmd, bosco, 'git',['commit','-m','First commit'], serviceDirectory)
    ], function(err) {
      if(err) {
        return bosco.error(err.message);
      }
      bosco.log('Complete!');
    });

}

function copyTemplateFiles(bosco, serviceName, port, serviceDirectory, next) {

  var templateFiles = require(path.join(serviceDirectory, 'bosco-templates.json'));
  var variables = {
    serviceName: serviceName,
    serviceShortName: getShortName(serviceName),
    user: bosco.config.get('github:user'),
    port: port
  }
  async.map(templateFiles, function(template, cb) {
    if(!template.source || !template.destination) {
      return cb(new Error('You must specify both a source and destination'));
    }

    bosco.log('Applying template for file: ' + template.destination.green);

    try {
      var destination = hb.compile(template.destination)(variables);
      var source = hb.compile(template.source)(variables);
      var templateContent = fs.readFileSync(path.join(serviceDirectory, source));
      var outputContent = hb.compile(templateContent.toString())(variables);
      fs.writeFileSync(path.join(serviceDirectory, destination), outputContent);
    } catch(ex) {
      bosco.error('There has been an error applying the templates, check the configuration of the template project.');
      return cb(ex);
    }

    cb();

  }, next);

}

function getShortName(service) {
  service = service.replace(/^app\-/,'');
  service = service.replace(/^service\-/,'');
  return service;
}

function addTemplate(bosco, args, next) {

    var templates = bosco.config.get('templates') || [];
    var templateRepo = args.shift();

    templates.push(templateRepo);
    bosco.config.set('templates', _.uniq(templates));

    bosco.config.save(function() {
      bosco.log('Added new template.');
      if(next) { next(); }
    });

}

function removeTemplate(bosco, args, next) {

    var templates = bosco.config.get('templates') || [];
    var templateRepo = args.shift();

    _.pull(templates, templateRepo);

    bosco.config.set('templates', templates);

    bosco.config.save(function() {
      bosco.log('Removed any matching templates.');
      if(next) { next(); }
    });

}

function execCmd(bosco, cmd, params, cwd, next) {
  execFile(cmd, params, {
    cwd: cwd
  }, function(err, stdout, stderr) {
      next(err, stdout + stderr);
  });
}

