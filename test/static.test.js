'use strict';

var expect = require("expect.js");
var async = require('async');
var fs = require('fs');
var _ = require('lodash');
var StaticUtils = require('../src/StaticUtils');

var repos = ["project1","project2"];


var boscoMock = function() {

  return {
      log: function(msg) { this._log = this._log || []; this._log.push(msg) },
      error: function(msg) { this._error = this._error || []; this._error.push(msg) },
      warn: function(msg) { this._warn = this._warn || []; this._warn.push(msg) },
      options: {
          environment:'test'
      },
      getRepoPath: function(repo) {
          return __dirname + "/TestOrganisation/" + repo
      },
      getAssetCdnUrl: function (asset) {
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
              if(key == 'css:clean') {
                return {enabled: true};
              }
              return key;
          }
      }
  }

}

var arrayContains = function(arr, contains) {
  contains.forEach(function(contain) {
    expect(arr).to.contain(contain);
  });
}


describe("Bosco Static Asset Handling", function() {

    this.timeout(10000);
    this.slow(5000);

    it('should load static assets in un-minified cdn mode', function(done) {

        var options = {
            repos: ["project1","project2"],
            repoTag: "testy",
            minify: false,
            buildNumber: 'local',
            tagFilter: null,
            watchBuilds: false,
            reloadOnly: false
        }

        var localBosco = boscoMock()
        var utils = StaticUtils(localBosco);

        utils.getStaticAssets(options, function(err, assets) {

            if (err) {
                return done(err);
            }

            var assetKeys = _.pluck(assets,'assetKey');
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
            repos: ["project1","project2"],
            minify: false,
            buildNumber: 'local',
            tagFilter: null,
            watchBuilds: false,
            reloadOnly: false
        }

        var localBosco = boscoMock()
        var utils = StaticUtils(localBosco);

        utils.getStaticAssets(options, function(err, assets) {

            var assetKeys = _.pluck(assets,'assetKey');
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
            repos: ["project1","project2"],
            buildNumber: 'local',
            minify: true,
            tagFilter: null,
            watchBuilds: false,
            reloadOnly: false
        }
        var localBosco = boscoMock()
        var utils = StaticUtils(localBosco);
        utils.getStaticAssets(options, function(err, assets) {

            var assetKeys = _.pluck(assets,'assetKey');
            arrayContains(assetKeys, [
              'project1/local/html/bottom.js.html',
              'project1/local/html/top.js.html',
              'project1/local/manifest/bottom.js.txt',
              'project1/local/manifest/top.js.txt',
              'project1/local/js/bottom.js.map',
              'project1/local/js/bottom.js',
              'project1/local/js/top.js.map',
              'project1/local/js/top.js'
            ]);

            arrayContains(assetKeys, [
              'project2/local/html/bottom.js.html',
              'project2/local/html/top.js.html',
              'project2/local/manifest/bottom.js.txt',
              'project2/local/manifest/top.js.txt',
              'project2/local/manifest/top.img.txt',
              'project2/local/manifest/upload.html.txt',
              'project2/local/manifest/top.swf.txt',
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
            repos: ["project4"],
            minify: false,
            buildNumber: 'local',
            tagFilter: null,
            watchBuilds: false,
            reloadOnly: false
        }

        var localBosco = boscoMock()
        var utils = StaticUtils(localBosco);

        utils.getStaticAssets(options, function(err, assets) {

            var assetKeys = _.pluck(assets,'assetKey');
            arrayContains(assetKeys, [
                'project4/local/html/glob.js.html',
                'project4/local/js/bottom1.js',
                'project4/local/js/jquery-1.11.0-min.js',
                'project4/local/js/top1.js'
            ]);

            done();

        });

    });

   it('should load static assets in minified cdn mode, filtering by tag if specified', function(done) {

        var options = {
            repos: ["project1","project2"],
            minify: true,
            tagFilter: 'top',
            buildNumber: 'local',
            watchBuilds: false,
            reloadOnly: false
        }

        var utils = StaticUtils(boscoMock());

        utils.getStaticAssets(options, function(err, assets) {

            var assetKeys = _.pluck(assets,'assetKey');
            arrayContains(assetKeys, [
                'project1/local/html/top.js.html',
                'project2/local/html/top.js.html',
                'project1/local/manifest/top.js.txt',
                'project2/local/manifest/top.js.txt',
                'project2/local/manifest/top.img.txt',
                'project2/local/manifest/top.swf.txt',
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

  it('should create a manifest when minified that will have all of the files', function(done) {

        var options = {
            repos: ["project1","project2"],
            minify: true,
            tagFilter: 'top',
            buildNumber: 'local',
            watchBuilds: false,
            reloadOnly: false
        }

        var utils = StaticUtils(boscoMock());

        utils.getStaticAssets(options, function(err, assets) {

            var assetKeys = _.pluck(assets,'assetKey');
            arrayContains(assetKeys, [
              'project1/local/manifest/top.js.txt',
              'project2/local/manifest/top.js.txt'
            ]);

            var manifest1 = _.find(assets, 'assetKey', 'project1/local/manifest/top.js.txt');
            var manifest2 = _.find(assets, 'assetKey', 'project2/local/manifest/top.js.txt');
            expect(manifest1.content.toString()).to.contain('project1/public/js/top1.js');
            expect(manifest2.content.toString()).to.contain('project2/public/js/top2.js');
            expect(manifest2.content.toString()).to.contain('project2/public/js/jquery-1.12.0-min.js');
            done();

        });

    });

    it('manifest should contain all specified html files', function(done) {

          var options = {
              repos: ["project2"],
              minify: true,
              tagFilter: 'upload',
              buildNumber: 'local',
              watchBuilds: false,
              reloadOnly: false
          }

          var utils = StaticUtils(boscoMock());

          utils.getStaticAssets(options, function(err, assets) {

              var manifest = _.find(assets, 'assetKey', 'project2/local/manifest/upload.html.txt').content.toString();
              var assetKeys = _.pluck(assets,'assetKey');
              expect(assetKeys).to.contain('project2/local/manifest/upload.html.txt');
              expect(manifest).to.contain('project2/public/html/html1.html');
              expect(manifest).to.contain('project2/public/html/html2.html');
              done();

          });

    });

  it('should create a source map when minifying javascript', function(done) {

        var options = {
            repos: ["project1","project2"],
            minify: true,
            tagFilter: 'top',
            buildNumber: 'local',
            watchBuilds: false,
            reloadOnly: false
        }

        var utils = StaticUtils(boscoMock());

        utils.getStaticAssets(options, function(err, assets) {
            var assetKeys = _.pluck(assets,'assetKey');
            arrayContains(assetKeys, [
              'project1/local/js/top.js.map',
              'project2/local/js/top.js.map'
            ]);
            done();

        });

    });

   it('should create a formatted repo list when requested for cdn mode', function(done) {

        var options = {
            repos: ["project1","project2","project3"],
            minify: true,
            tagFilter: null,
            buildNumber: 'local',
            watchBuilds: false,
            reloadOnly: false
        }

        var utils = StaticUtils(boscoMock());

        utils.getStaticRepos(options, function(err, assets) {
            var assetKeys = _.keys(assets);
            expect(assetKeys).to.contain('formattedRepos');
            done();
        });

    });

});

describe("Bosco Static Asset Handling - Custom Building", function() {

  this.timeout(5000);
  this.slow(5000);

  it('should execute bespoke build commands and use output', function(done) {

        var options = {
            repos: ["project3"],
            minify: true,
            tagFilter: null,
            buildNumber: 'local',
            watchBuilds: false,
            reloadOnly: false
        }

        var utils = StaticUtils(boscoMock());

        utils.getStaticAssets(options, function(err, assets) {
            var assetKeys = _.pluck(assets,'assetKey');
            arrayContains(assetKeys, [
              'project3/local/html/compiled.js.html',
              'project3/local/html/compiled.css.html',
              'project3/local/js/compiled.js.map',
              'project3/local/js/compiled.js',
              'project3/local/css/compiled.css',
              'project3/local/manifest/compiled.js.txt',
              'project3/local/manifest/compiled.css.txt'
            ]);

            done();

        });

    });

  it('should execute bespoke build commands and use output, and execute the watch command in watch mode', function(done) {

        var options = {
            repos: ["project3"],
            minify: true,
            tagFilter: null,
            buildNumber: 'local',
            watchBuilds: true,
            reloadOnly: false
        }

        var utils = StaticUtils(boscoMock());

        utils.getStaticAssets(options, function(err, assets) {
            var assetKeys = _.pluck(assets,'assetKey');
            arrayContains(assetKeys, [
              'project3/local/html/compiled.js.html',
              'project3/local/html/compiled.css.html',
              'project3/local/js/compiled.js.map',
              'project3/local/js/compiled.js',
              'project3/local/css/compiled.css',
              'project3/local/manifest/compiled.js.txt',
              'project3/local/manifest/compiled.css.txt'
            ]);
            done();

        });

    });

it('should execute bespoke build commands and use output, and execute the watch command in watch mode and not minified', function(done) {

        this.timeout(5000);

        var options = {
            repos: ["project3"],
            minify: false,
            tagFilter: null,
            buildNumber: 'local',
            watchBuilds: true,
            reloadOnly: false
        }

        var utils = StaticUtils(boscoMock());

        utils.getStaticAssets(options, function(err, assets) {
            var assetKeys = _.pluck(assets,'assetKey');
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
