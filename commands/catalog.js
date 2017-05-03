/* eslint-disable */
var path = require('path');
var fs = require('fs');
var _ = require('lodash');
var async = require('async');
var json2csv = require('json2csv');

module.exports = {
  name: 'catalog',
  description: 'Catalogs service info',
  usage: '[-r <repoRegex>] -- <command>',
};

function modules(pkg) {
  return {
    electricExpress: pkg.dependencies['electric-express'],
    electricMongoose: pkg.dependencies['electric-mongoose'],
    electricRascal: pkg.dependencies['electric-rascal'],
    electricConflab: pkg.dependencies['electric-conflab'],
    electricMetrics: pkg.dependencies['electric-metrics'],
    mongoose: pkg.dependencies['mongoose'],
    mysql: pkg.dependencies['mysql'],
    postgres: pkg.dependencies['postgres'],
    react: pkg.dependencies['react'],
    redux: pkg.dependencies['redux'],
    alt: pkg.dependencies['alt'],
    ramda: pkg.dependencies['ramda'],
    lodash: pkg.dependencies['lodash'],
    hapi: pkg.dependencies['hapi'],
    rabbit2: pkg.dependencies['module-tsl-rabbit2'],
  }
}

function whatami(pkg, config, boscoSvc) {

  var rabbit = config.queues ? getOldRabbit(config.queues) : {};
  var rascal = config.rascal ? getRascal(config.rascal) : {};
  var output = {
      name: pkg.name,
      dependencies: boscoSvc && boscoSvc.service && boscoSvc.service.dependsOn && boscoSvc.service.dependsOn.join(', ') || '',
      description: pkg.description,
      mongo: config.mongo ? (config.mongo.auth ? config.mongo.auth.database : '') : '',
      cassandra: config.cassandra ? config.cassandra.authUsername : '',
      rabbitmqPublications: rabbit.publications,
      rabbitmqSubscriptions: rabbit.subscriptions,
      rascal: rascal,
  };
  return _.merge(output, modules(pkg));
}

function getOldRabbit(config) {
    var output = {
        publications: [],
        subscriptions: []
    };
    _.forOwn(config.publications, function(value, key) {
        var formatted = key + ': ' + value.vhost + '/' + value.exchange + '@' + value.routingKey;
        output.publications.push(formatted);
    });
    _.forOwn(config.subscriptions, function(value, key) {
        var formatted = key + ': ' + value.vhost + '/' + value.queue;
        output.subscriptions.push(formatted);
    });
    return {
      publications: output.publications,
      subscriptions: output.subscriptions,
    };
  }

function getRascal(config) {
    var bindings = [];
    _.forOwn(config.vhosts, function(value, key) {
      var vhost = key;
      _.forOwn(value.bindings, function(value, key) {
        var formattedValue;
        if(!value.source) {
          formattedValue = vhost + ': ' + key;
        } else {
          formattedValue = vhost + ': ' + value.source + ' -> ' + value.destination;
          if (value.bindingKey) {
            formattedValue += ' [' + value.bindingKey.join(', ') + ']';
          }
        }
        bindings.push(formattedValue);
      });
    });
    return bindings;
}


function cmd(bosco, args) {

  bosco.log('Cataloguing all matching repos ...');

  var repoPattern = bosco.options.repo;
  var repoRegex = new RegExp(repoPattern);

  var repos = bosco.getRepos();
  if (!repos) return bosco.error('You are repo-less :( You need to initialise bosco first, try \'bosco clone\'.');

  bosco.log('Running grep across all repos...');

  async.map(repos, function(repo, cb) {
    if (!repo.match(repoRegex)) {
      return cb();
    }
    var repoPath = bosco.getRepoPath(repo);
    var packageJson = path.join(repoPath, 'package.json');
    var configDefaultJson = path.join(repoPath, 'config', 'default.json');
    var configLiveJson = path.join(repoPath, 'config', 'live.json');
    var nvmRc = path.join(repoPath, '.nvmrc');
    var boscoSvc = path.join(repoPath, 'bosco-service.json');
    var webpack = bosco.exists(path.join(repoPath, 'webpack.config.js'));
    var gulp = bosco.exists(path.join(repoPath, 'gulpfile.js'));
    if (bosco.exists(packageJson) && bosco.exists(configDefaultJson) && bosco.exists(configLiveJson) && bosco.exists(boscoSvc)) {
      var config = _.defaultsDeep(require(configLiveJson), require(configDefaultJson));
      var data = whatami(require(packageJson), config, require(boscoSvc));
      data.webpack = webpack ? 'Yes' : '';
      data.gulp = gulp ? 'Yes' : '';
      data.node = bosco.exists(nvmRc) ? 'v' + fs.readFileSync(nvmRc).toString().replace('\n','') : '';
    }
    cb(null, data);
  }, function(err, result) {
    if (err) bosco.error(err);

    var rabbit = _.map(_.compact(result), function(item) {
      var output = []
      _.forEach(item.rabbitmqPublications, function(p) {
        output.push({
          service: item.name,
          type: 'rabbit2-publication',
          details: p
        });
      });
      _.forEach(item.rabbitmqSubscriptions, function(s) {
        output.push({
          service: item.name,
          type: 'rabbit2-subscription',
          details: s
        });
      });
       _.forEach(item.rascal, function(b) {
        output.push({
          service: item.name,
          type: 'rascal-binding',
          details: b
        });
      });
      return output.length ? output : null;
    });

    var rabbitCsv = json2csv({ data: _.flatten(_.compact(rabbit)) });
    fs.writeFileSync('rabbit.csv', rabbitCsv);

    var fullCsv = json2csv({ data: _.compact(result) });
    fs.writeFileSync('catalog.csv', fullCsv);

    bosco.log('Done');
  });
}

module.exports.cmd = cmd;
