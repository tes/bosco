const async = require('async');
const request = require('request');
const _ = require('lodash');
const helper = require('../src/RunListHelper');

module.exports = {
  name: 'bundle-check',
  description: 'Look for unused bundles based on running compoxure server',
  usage: '[--compoxure http://compoxure-service.yourcloud.com/statistics]',
  options: [{
    name: 'compoxure',
    type: 'string',
    desc: 'Url to a compoxure statistics endpoint',
  }],
};

function cmd(bosco, args, next) {
  const getStatistics = (url, cb) => {
    request(url, (err, response, body) => {
      if (err) {
        bosco.error(err.message);
        return next();
      }
      cb(null, JSON.parse(body));
    });
  };

  const unusedBundles = [];

  getStatistics(bosco.options.compoxure, (err, statistics) => {
    const serviceBundles = {};
    _.forEach(statistics, (repo) => {
      if (repo.bundles) {
        _.forEach(repo.bundles, (bundles, serviceName) => {
          const bundleNames = _.map(bundles, 'name');
          serviceBundles[serviceName] = serviceBundles[serviceName] || [];
          serviceBundles[serviceName] = _.union(serviceBundles[serviceName], bundleNames);
        });
      }
    });

    async.map(Object.keys(serviceBundles), (service, cb) => {
      const activeBundles = serviceBundles[service];
      let githubName = service;
      if (service === 'site-assets') {
        githubName = 'service-site-assets';
      } // Name hack
      helper.getServiceConfigFromGithub(bosco, githubName, {}, (ghErr, config) => {
        if (ghErr || !config) { return cb(); }

        // Pull the discrete bundles from the config
        const assetJs = (config.assets && config.assets.js && Object.keys(config.assets.js)) || [];
        const assetCss = (config.assets && config.assets.css && Object.keys(config.assets.css)) || [];
        const files = config.files && Object.keys(config.files);
        _.forEach(files, (file) => {
          if (config.files[file].js) { assetJs.push(file); }
          if (config.files[file].css) { assetCss.push(file); }
        });
        const configuredBundles = _.union(
          _.map(assetJs, (i) => `${i}.js`),
          _.map(assetCss, (i) => `${i}.css`),
        );

        // Remove the used ones to get those unused
        const unused = _.difference(configuredBundles, activeBundles);
        unusedBundles.push({
          service,
          unused,
          configuredBundles,
          activeBundles,
        });

        cb();
      });
    }, () => {
      bosco.log('Here are the things you need to look at:');
      _.forEach(unusedBundles, (service) => {
        if (service.unused.length > 0) {
          bosco.console.log(service.service.green);
          bosco.console.log(` Configured: ${(service.configuredBundles.join(',')).grey}`);
          bosco.console.log(` Active      ${(service.activeBundles.join(',')).cyan}`);
          bosco.console.log(` Unused:     ${(service.unused.join(',')).red}`);
        }
      });

      next();
    });
  });
}

module.exports.cmd = cmd;
