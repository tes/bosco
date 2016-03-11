'use strict';
var fs = require('fs');
var _ = require('lodash');

function getLogger() {
  return {
    log: function(msg) { this._log = this._log || []; this._log.push(msg) },
    error: function(msg) { this._error = this._error || []; this._error.push(msg) },
    warn: function(msg) { this._warn = this._warn || []; this._warn.push(msg) }
  };
}

module.exports = function boscoMock(extra) {
  return _.assign({}, getLogger(), {
    console: getLogger(),
    repos: [],
    options: {
      environment: 'test',
      nvmUse: '',
      nvmUseDefault: '',
      nvmWhich: ''
    },
    getRepos: function() {
      return this.repos;
    },
    getRepoPath: function(repo) {
      return __dirname + "/TestOrganisation/" + repo
    },
    getAssetCdnUrl: function(asset) {
      return 'http://my-awesome-cdn.example.com/' + asset;
    },
    exists: function(file) {
      return fs.existsSync(file);
    },
    concurrency: {
      cpu: 4,
      network: 10
    },
    config: {
      get: function(key) {
        if (key === 'css:clean') {
          return {enabled: true};
        }
        return key;
      }
    }
  }, extra);
}
