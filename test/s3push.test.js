'use strict';

var _ = require('lodash');
var expect = require('expect.js');
var fs = require('fs');
var zlib = require('zlib');

var boscoMock = require('./boscoMock');
var s3push = require('../commands/s3push');
var StaticUtils = require('../src/StaticUtils');

describe('s3push', function() {
  this.timeout(2000);
  this.slow(500);

  it('should fail if the build fails', function(done) {
    var options = {
      nvmUse: '',
      nvmWhich: '',
      repos: ['projectFail'],
      noprompt: true
    };
    options.options = options;
    var localBosco = boscoMock(options);
    localBosco.staticUtils = StaticUtils(localBosco);

    s3push.cmd(localBosco, [], function(err) {
      expect(err).to.be.an(Error);
      expect(err).to.have.property('code', 1);
      done();
    });
  });

  it('should fail when pushing to s3 errors', function(done) {
    var message = 'This is a test error message';
    function putBuffer(buffer, path, headers, next) {
      next(new Error(message));
    }
    var options = {
      nvmUse: '',
      nvmWhich: '',
      repos: ['project3'],
      noprompt: true,
      knox: {putBuffer: putBuffer}
    };
    options.options = options;
    var localBosco = boscoMock(options);
    localBosco.staticUtils = StaticUtils(localBosco);

    s3push.cmd(localBosco, [], function(err) {
      expect(err).to.be.an(Error);
      expect(err).to.have.property('message', message);
      done();
    });
  });

  it('should fail when pushing to s3 returns 300+ code', function(done) {
    var message = 'This is a test error message';
    var statusCode = 300;
    function putBuffer(buffer, path, headers, next) {
      next(null, {statusCode: statusCode});
    }
    var options = {
      nvmUse: '',
      nvmWhich: '',
      repos: ['project3'],
      noprompt: true,
      knox: {putBuffer: putBuffer}
    };
    options.options = options;
    var localBosco = boscoMock(options);
    localBosco.staticUtils = StaticUtils(localBosco);

    s3push.cmd(localBosco, [], function(err) {
      expect(err).to.be.an(Error);
      expect(err).to.have.property('statusCode', 300);

      statusCode = 400;
      s3push.cmd(localBosco, [], function(err) {
        expect(err).to.be.an(Error);
        expect(err).to.have.property('statusCode', 400);

        statusCode = 500;
        s3push.cmd(localBosco, [], function(err) {
          expect(err).to.be.an(Error);
          expect(err).to.have.property('statusCode', 500);
          done();
        });
      });
    });
  });

  it('should push all files to s3', function(done) {
    var message = 'This is a test error message';
    var s3Data = [];
    function putBuffer(buffer, path, headers, next) {
      zlib.gunzip(buffer, function(err, buf) {
        if (err) return next(err);

        s3Data.push({path: path, content: buf.toString()});
        next(null, {statusCode: 200});
      });
    }
    var options = {
      nvmUse: '',
      nvmWhich: '',
      repos: ['project3'],
      noprompt: true,
      environment: 'test',
      service: true,
      knox: {putBuffer: putBuffer}
    };
    options.options = options;
    var localBosco = boscoMock(options);
    var staticData = [];
    localBosco.staticUtils = StaticUtils(localBosco);
    localBosco.staticUtils.oldGetStaticAssets = localBosco.staticUtils.getStaticAssets;
    localBosco.staticUtils.getStaticAssets = function(options, next) {
      return localBosco.staticUtils.oldGetStaticAssets(options, function(err, staticAssets) {
        staticData = _.filter(_.map(staticAssets, function(val) {
          if(val.assetKey === 'formattedAssets') { return; }
          return {path: 'test/' + val.assetKey, content: val.content};
        }));
        next(err, staticAssets);
      });
    };

    var repoPath = localBosco.getRepoPath('project3');
    s3push.cmd(localBosco, [], function(err) {
      if (err) return done(err);
      expect(s3Data).to.eql(staticData);
      done();
    });
  });
});
