var async = require('async');
var request = require('request');
var _ = require('lodash');
var helper = require('../src/RunListHelper');

module.exports = {
  name: 'bundle-check',
  description: 'Look for unused bundles based on running compoxure server',
  usage: '[--compoxure http://compoxure-service.yourcloud.com/statistics]',
  options: [{
    name: 'compoxure',
    type: 'string',
    desc: 'Url to a compoxure statistics endpoint'
  }]
};

function cmd(bosco, args, next) {
  var getStatistics = function (url, cb) {
    request(url, function (err, response, body) {
      if (err) {
        bosco.error(err.message);
        return next();
      }
      cb(null, JSON.parse(body));
    });
  };

  var unusedBundles = [];

  getStatistics(bosco.options.compoxure, function (err, statistics) {
    var serviceBundles = {};
    _.forEach(statistics, function (repo) {
      if (repo.bundles) {
        _.forEach(repo.bundles, function (bundles, serviceName) {
          var bundleNames = _.map(bundles, 'name');
          serviceBundles[serviceName] = serviceBundles[serviceName] || [];
          serviceBundles[serviceName] = _.union(serviceBundles[serviceName], bundleNames);
        });
      }
    });

    async.map(Object.keys(serviceBundles), function (service, cb) {
      var activeBundles = serviceBundles[service];
      var githubName = service;
      if (service === 'site-assets') {
        githubName = 'service-site-assets';
      } // Name hack
      helper.getServiceConfigFromGithub(bosco, githubName, {}, null, function (err, config) {
        if (err || !config) { return cb(); }

        // Pull the discrete bundles from the config
        var assetJs = config.assets && config.assets.js && Object.keys(config.assets.js) || [];
        var assetCss = config.assets && config.assets.css && Object.keys(config.assets.css) || [];
        var files = config.files && Object.keys(config.files);
        _.forEach(files, function (file) {
          if (config.files[file].js) { assetJs.push(file); }
          if (config.files[file].css) { assetCss.push(file); }
        });
        var configuredBundles = _.union(
          _.map(assetJs, function (i) { return i + '.js'; }),
          _.map(assetCss, function (i) { return i + '.css'; })
        );

        // Remove the used ones to get those unused
        var unused = _.difference(configuredBundles, activeBundles);
        unusedBundles.push({
          service: service,
          unused: unused,
          configuredBundles: configuredBundles,
          activeBundles: activeBundles
        });

        cb();
      });
    }, function () {
      bosco.log('Here are the things you need to look at:');
      _.forEach(unusedBundles, function (service) {
        if (service.unused.length > 0) {
          bosco.console.log(service.service.green);
          bosco.console.log(' Configured: ' + (service.configuredBundles.join(',')).grey);
          bosco.console.log(' Active      ' + (service.activeBundles.join(',')).cyan);
          bosco.console.log(' Unused:     ' + (service.unused.join(',')).red);
        }
      });

      next();
    });
  });
}

module.exports.cmd = cmd;
