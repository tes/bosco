const _ = require('lodash');
const path = require('path');
const fs = require('fs');
const async = require('async');
const { execFile } = require('child_process');
const hb = require('handlebars');

module.exports = {
  name: 'template',
  description: 'A command to allow generic, template driven creation of new services and apps',
  usage: '[add <githubRepo>|remove <githubRepo>|create <templateName> <serviceName> <port>]',
};

function listTemplates(bosco, next) {
  const templates = bosco.config.get('templates');

  bosco.log('Your current templates are:');
  _.each(templates, (template) => {
    bosco.log(` - ${template.green}`);
  });

  bosco.log(`Use the command: ${'bosco template add <githubRepo>'.green} to add to your template list.`);
  if (next) { next(); }
}

function execCmd(bosco, command, params, cwd, next) {
  execFile(command, params, {
    cwd,
  }, (err, stdout, stderr) => {
    next(err, stdout + stderr);
  });
}

function getShortName(service) {
  let shortName = service.replace(/^app-/, '');
  shortName = shortName.replace(/^service-/, '');
  return shortName;
}

function copyTemplateFiles(bosco, serviceName, port, serviceDirectory, next) {
  const templateFiles = require(path.join(serviceDirectory, 'bosco-templates.json')); // eslint-disable-line global-require,import/no-dynamic-require
  const variables = {
    serviceName,
    serviceShortName: getShortName(serviceName),
    user: bosco.config.get('github:user'),
    port,
  };
  async.map(templateFiles, (template, cb) => {
    if (!template.source || !template.destination) {
      return cb(new Error('You must specify both a source and destination'));
    }

    bosco.log(`Applying template for file: ${template.destination.green}`);

    try {
      const destination = hb.compile(template.destination)(variables);
      const source = hb.compile(template.source)(variables);
      const templateContent = fs.readFileSync(path.join(serviceDirectory, source));
      const outputContent = hb.compile(templateContent.toString())(variables);
      fs.writeFileSync(path.join(serviceDirectory, destination), outputContent);
    } catch (ex) {
      bosco.error('There has been an error applying the templates, check the configuration of the template project.');
      return cb(ex);
    }

    cb();
  }, next);
}

function newServiceFromTemplate(bosco, args, next) {
  const templates = bosco.config.get('templates') || [];

  const templateRepoName = args.shift();
  const targetServiceName = args.shift();
  const targetServicePort = args.shift();

  if (!templateRepoName || !targetServiceName || !targetServicePort) {
    return bosco.log(`You need to specify a template, a target service name and a port: ${'bosco template create <githubRepo> <serviceName> <port>'.green}`);
  }

  const template = _.filter(templates, (item) => item.match(new RegExp(templateRepoName)))[0];

  if (!template) {
    bosco.log(`Couldnt find a service that matched: ${templateRepoName.red}`);
    return listTemplates(bosco, next);
  }

  bosco.log(`Creating new service: ${targetServiceName.green} from template: ${template.green}`);

  const gitCmd = 'git';
  let host = bosco.config.get('github:hostname') || 'github.com';
  const hostUser = bosco.config.get('github:hostUser') || 'git';
  host = `${hostUser}@${host}:`;

  const gitOptions = ['clone', '--depth=1', host + template, targetServiceName];

  const serviceDirectory = path.resolve('.', targetServiceName);

  async.series([
    async.apply(execCmd, bosco, gitCmd, gitOptions, path.resolve('.')),
    async.apply(execCmd, bosco, 'rm', ['-rf', '.git'], serviceDirectory),
    async.apply(execCmd, bosco, 'git', ['init'], serviceDirectory),
    async.apply(copyTemplateFiles, bosco, targetServiceName, targetServicePort, serviceDirectory),
    async.apply(execCmd, bosco, 'rm', ['-rf', 'templates'], serviceDirectory),
    async.apply(execCmd, bosco, 'rm', ['-f', 'bosco-templates.json'], serviceDirectory),
    async.apply(execCmd, bosco, 'git', ['add', '--all', '.'], serviceDirectory),
    async.apply(execCmd, bosco, 'git', ['commit', '-m', 'First commit'], serviceDirectory),
  ], (err) => {
    if (err) {
      return bosco.error(err.message);
    }
    bosco.log('Complete!');
  });
}

function addTemplate(bosco, args, next) {
  const templates = bosco.config.get('templates') || [];
  const templateRepo = args.shift();

  templates.push(templateRepo);
  bosco.config.set('templates', _.uniq(templates));

  bosco.config.save(() => {
    bosco.log('Added new template.');
    if (next) { next(); }
  });
}

function removeTemplate(bosco, args, next) {
  const templates = bosco.config.get('templates') || [];
  const templateRepo = args.shift();

  _.pull(templates, templateRepo);

  bosco.config.set('templates', templates);

  bosco.config.save(() => {
    bosco.log('Removed any matching templates.');
    if (next) { next(); }
  });
}

function cmd(bosco, args, next) {
  const action = args.shift();
  if (action === 'create') { return newServiceFromTemplate(bosco, args, next); }
  if (action === 'add') { return addTemplate(bosco, args, next); }
  if (action === 'remove') { return removeTemplate(bosco, args, next); }
  listTemplates(bosco, next);
}

module.exports.cmd = cmd;
