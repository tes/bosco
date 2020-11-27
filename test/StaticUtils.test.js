'use strict';

var _ = require('lodash');
var async = require('async');
var { expect } = require('chai');
var fs = require('fs');

var boscoMock = require('./boscoMock');
var StaticUtils = require('../src/StaticUtils');

function arrayContains(arr, contains) {
  contains.forEach(function(contain) {
    expect(arr).to.contain(contain);
  });
}

describe('Bosco Static Asset Handling', function() {
  this.timeout(10000);
  this.slow(5000);

  it('should load static assets in un-minified cdn mode', function(done) {
    var options = {
      repos: ['project1', 'project2'],
      repoTag: 'testy',
      minify: false,
      buildNumber: 'local',
      tagFilter: null,
      watchBuilds: false,
      reloadOnly: false,
    }

    var localBosco = boscoMock()
    var utils = StaticUtils(localBosco);

    utils.getStaticAssets(options, function(err, assets) {
      if (err) return done(err);

      var assetKeys = _.map(assets, 'assetKey');
      arrayContains(assetKeys, [
        'project1/local/html/bottom.js.html',
        'project1/local/html/top.js.html',
        'project1/local/js/bottom1.js',
        'project1/local/js/jquery-1.11.0-min.js',
        'project1/local/js/top1.js'
      ]);

      done();
    });
  });

  it('should load static assets in un-minified cdn mode, deduping where necessary', function(done) {
    var options = {
      repos: ['project1', 'project2'],
      minify: false,
      buildNumber: 'local',
      tagFilter: null,
      watchBuilds: false,
      reloadOnly: false,
    }

    var localBosco = boscoMock()
    var utils = StaticUtils(localBosco);

    utils.getStaticAssets(options, function(err, assets) {
      if (err) return done(err);

      var assetKeys = _.map(assets, 'assetKey');
      arrayContains(assetKeys, [
        'project1/local/html/bottom.js.html',
        'project1/local/html/top.js.html',
        'project2/local/html/bottom.js.html',
        'project2/local/html/top.js.html',
        'project1/local/js/bottom1.js',
        'project1/local/js/jquery-1.11.0-min.js',
        'project1/local/js/top1.js',
        'project2/local/js/bottom2.js',
        'project2/local/js/top2.js',
        'project2/local/img/bab.jpg',
        'project2/local/html/html1.html',
        'project2/local/html/html2.html',
        'project2/local/swf/flash.swf'
      ]);
      done();
    });
  });

  it('should load static assets in minified cdn mode, deduping where necessary', function(done) {
    var options = {
      repos: ['project1', 'project2'],
      buildNumber: 'local',
      minify: true,
      tagFilter: null,
      watchBuilds: false,
      reloadOnly: false,
    }
    var localBosco = boscoMock()
    var utils = StaticUtils(localBosco);
    utils.getStaticAssets(options, function(err, assets) {
      if (err) return done(err);

      var assetKeys = _.map(assets, 'assetKey');
      arrayContains(assetKeys, [
        'project1/local/html/bottom.js.html',
        'project1/local/html/top.js.html',
        'project1/local/js/bottom.js.map',
        'project1/local/js/bottom.js',
        'project1/local/js/top.js.map',
        'project1/local/js/top.js'
      ]);

      arrayContains(assetKeys, [
        'project2/local/html/bottom.js.html',
        'project2/local/html/top.js.html',
        'project2/local/js/bottom.js.map',
        'project2/local/js/bottom.js',
        'project2/local/js/top.js.map',
        'project2/local/js/top.js',
        'project2/local/img/bab.jpg',
        'project2/local/swf/flash.swf',
        'project2/local/html/html1.html',
        'project2/local/html/html2.html'
      ]);

      done();
    });
  });

  it('should load static assets via globs', function(done) {
    var options = {
      repos: ['project4'],
      minify: false,
      buildNumber: 'local',
      tagFilter: null,
      watchBuilds: false,
      reloadOnly: false,
    }

    var localBosco = boscoMock()
    var utils = StaticUtils(localBosco);

    utils.getStaticAssets(options, function(err, assets) {
      if (err) return done(err);

      var assetKeys = _.map(assets, 'assetKey');
      arrayContains(assetKeys, [
        'project4/local/html/glob.js.html',
        'project4/local/js/bottom1.js',
        'project4/local/js/jquery-1.11.0-min.js',
        'project4/local/js/top1.js',
        'project4/local/pdf/guide.pdf'
      ]);

      done();
    });
  });

  it('should not load static asset types that are not in the whitelist', function(done) {
    var options = {
      repos: ['projectFail2'],
      minify: false,
      buildNumber: 'local',
      tagFilter: null,
      watchBuilds: false,
      reloadOnly: false,
    };

    var localBosco = boscoMock()
    var utils = StaticUtils(localBosco);

    utils.getStaticAssets(options, function(err, assets) {
      if (err) return done(err);

      var assetKeys = _.map(assets, 'assetKey');
      arrayContains(assetKeys, [
        'projectFail2/local/js/bottom1.js'
        ]);
      done();
    });
  });

  it('should load static assets in minified cdn mode, filtering by tag if specified', function(done) {
    var options = {
      repos: ['project1', 'project2'],
      minify: true,
      tagFilter: 'top',
      buildNumber: 'local',
      watchBuilds: false,
      reloadOnly: false,
    }

    var utils = StaticUtils(boscoMock());

    utils.getStaticAssets(options, function(err, assets) {
      if (err) return done(err);

      var assetKeys = _.map(assets, 'assetKey');
      arrayContains(assetKeys, [
        'project1/local/html/top.js.html',
        'project2/local/html/top.js.html',
        'project1/local/js/top.js.map',
        'project1/local/js/top.js',
        'project2/local/js/top.js.map',
        'project2/local/js/top.js',
        'project2/local/img/bab.jpg',
        'project2/local/swf/flash.swf'
      ]);

      done();
    });
  });

  it('should create a source map when minifying javascript', function(done) {
    var options = {
      repos: ['project1', 'project2'],
      minify: true,
      tagFilter: 'top',
      buildNumber: 'local',
      watchBuilds: false,
      reloadOnly: false,
    }

    var utils = StaticUtils(boscoMock());

    utils.getStaticAssets(options, function(err, assets) {
      if (err) return done(err);

      var assetKeys = _.map(assets, 'assetKey');
      arrayContains(assetKeys, [
        'project1/local/js/top.js.map',
        'project2/local/js/top.js.map'
      ]);
      done();
    });
  });

  it('should not re-minify already minified assets', function(done) {
    var options = {
      repos: ['project3'],
      minify: true,
      tagFilter: null,
      buildNumber: 'local',
      watchBuilds: false,
      reloadOnly: false,
    }

    var utils = StaticUtils(boscoMock());

    utils.getStaticAssets(options, function(err, assets) {
      if (err) return done(err);
      var assetKeys = _.map(assets, 'assetKey');
      arrayContains(assetKeys, [
        'project3/local/js/compiled.js.map',
        'project3/local/js/compiled.js'
      ]);
      done();
    });
  });

  it('should create a formatted repo list when requested for cdn mode', function(done) {
    var options = {
      repos: ['project1', 'project2', 'project3'],
      minify: true,
      tagFilter: null,
      buildNumber: 'local',
      watchBuilds: false,
      reloadOnly: false,
    }

    var utils = StaticUtils(boscoMock());

    utils.getStaticRepos(options, function(err, assets) {
      if (err) return done(err);

      var assetKeys = _.keys(assets);
      expect(assetKeys).to.contain('formattedRepos');
      done();
    });
  });
});

describe('Bosco Static Asset Handling - Custom Building', function() {
  this.timeout(5000);
  this.slow(5000);

  it('should execute bespoke build commands and use output', function(done) {
    var options = {
      repos: ['project3'],
      minify: true,
      tagFilter: null,
      buildNumber: 'local',
      watchBuilds: false,
      reloadOnly: false,
    }

    var utils = StaticUtils(boscoMock());

    utils.getStaticAssets(options, function(err, assets) {
      if (err) return done(err);

      var assetKeys = _.map(assets, 'assetKey');
      arrayContains(assetKeys, [
        'project3/local/html/compiled.js.html',
        'project3/local/html/compiled.css.html',
        'project3/local/js/compiled.js.map',
        'project3/local/js/compiled.js',
        'project3/local/css/compiled.css'
      ]);

      done();
    });
  });

  it('should fail if the build fails', function(done) {
    var options = {
      repos: ['projectFail'],
      minify: true,
      tagFilter: null,
      buildNumber: 'local',
      watchBuilds: false,
      reloadOnly: false,
    }

    var utils = StaticUtils(boscoMock());

    utils.getStaticAssets(options, function(err, assets) {
      expect(err).to.be.an.instanceof(Error);
      expect(err).to.have.property('code', 1);
      done();
    });
  });

  it('should execute bespoke watch commands in watch mode', function(done) {
    var options = {
      repos: ['project3'],
      minify: true,
      tagFilter: null,
      buildNumber: 'local',
      watchBuilds: true,
      reloadOnly: false,
    }

    var utils = StaticUtils(boscoMock());

    utils.getStaticAssets(options, function(err, assets) {
      if (err) return done(err);

      var assetKeys = _.map(assets, 'assetKey');
      arrayContains(assetKeys, [
        'project3/local/html/compiled.js.html',
        'project3/local/html/compiled.css.html',
        'project3/local/js/compiled.js.map',
        'project3/local/js/compiled.js',
        'project3/local/css/compiled.css'
      ]);
      done();
    });
  });

  it('should fail if the watch command fails', function(done) {
    var options = {
      repos: ['projectFail'],
      minify: true,
      tagFilter: null,
      buildNumber: 'local',
      watchBuilds: true,
      reloadOnly: false,
    }

    var utils = StaticUtils(boscoMock());

    utils.getStaticAssets(options, function(err, assets) {
      expect(err).to.be.an.instanceof(Error);
      expect(err).to.have.property('code', 1);
      done();
    });
  });

  it('should execute bespoke watch commands in watch mode and not minified', function(done) {
    this.timeout(5000);

    var options = {
      repos: ['project3'],
      minify: false,
      tagFilter: null,
      buildNumber: 'local',
      watchBuilds: true,
      reloadOnly: false,
    }

    var utils = StaticUtils(boscoMock());

    utils.getStaticAssets(options, function(err, assets) {
      if (err) return done(err);

      var assetKeys = _.map(assets, 'assetKey');
      arrayContains(assetKeys, [
        'project3/local/html/compiled.js.html',
        'project3/local/html/compiled.css.html',
        'project3/local/js/compiled.js',
        'project3/local/css/compiled.css'
      ]);
      done();
    });
  });
});
