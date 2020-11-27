'use strict';

var _ = require('lodash');
var { expect } = require('chai');
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
      nvmUseDefault: '',
      nvmWhich: '',
      repos: ['projectFail'],
      noprompt: true,
      fileTypesWhitelist: ['js', 'css', 'img', 'html', 'swf', 'fonts', 'pdf']
    };
    options.options = options;
    var localBosco = boscoMock(options);
    localBosco.staticUtils = StaticUtils(localBosco);

    s3push.cmd(localBosco, [], function(err) {
      expect(err).to.be.an.instanceof(Error);
      expect(err).to.have.property('code', 1);
      done();
    });
  });


  it('should fail if the minification fails', function(done) {
    var options = {
      nvmUse: '',
      nvmUseDefault: '',
      nvmWhich: '',
      repos: ['projectFail2'],
      noprompt: true,
      fileTypesWhitelist: ['js', 'css', 'img', 'html', 'swf', 'fonts', 'pdf']
    };
    options.options = options;
    var localBosco = boscoMock(options);
    localBosco.staticUtils = StaticUtils(localBosco);

    s3push.cmd(localBosco, [], function(err) {
      expect(err).to.be.an.instanceof(Error);
      done();
    });
  });

  it('should not minify if bundle is declared already minified', function(done) {
    var options = {
      nvmUse: '',
      nvmUseDefault: '',
      nvmWhich: '',
      repos: ['projectFail2'],
      noprompt: true,
      fileTypesWhitelist: ['js', 'css', 'img', 'html', 'swf', 'fonts', 'pdf']
    };
    options.options = options;
    var localBosco = boscoMock(options);
    localBosco.staticUtils = StaticUtils(localBosco);

    s3push.cmd(localBosco, [], function(err) {
      expect(err).to.be.an.instanceof(Error);
      done();
    });
  });

  it('should not fail if their are no assets to push to s3', function(done) {
    var options = {
      nvmUse: '',
      nvmUseDefault: '',
      nvmWhich: '',
      repos: ['projectEmpty'],
      noprompt: true,
      fileTypesWhitelist: ['js', 'css', 'img', 'html', 'swf', 'fonts', 'pdf']
    };
    options.options = options;
    var localBosco = boscoMock(options);
    localBosco.staticUtils = StaticUtils(localBosco);

    s3push.cmd(localBosco, [], function(err) {
      expect(err).to.equal(undefined);
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
      nvmUseDefault: '',
      nvmWhich: '',
      repos: ['project3'],
      noprompt: true,
      knox: {putBuffer: putBuffer},
      fileTypesWhitelist: ['js', 'css', 'img', 'html', 'swf', 'fonts', 'pdf']
    };
    options.options = options;
    var localBosco = boscoMock(options);
    localBosco.staticUtils = StaticUtils(localBosco);
    s3push.cmd(localBosco, [], function(err) {
      expect(err).to.be.an.instanceof(Error);
      expect(err).to.have.property('message', message);
      done();
    });
  });

  it('should fail if any of the files specified in a bundle are missing', function(done) {
    var options = {
      nvmUse: '',
      nvmUseDefault: '',
      nvmWhich: '',
      repos: ['projectFail2'],
      noprompt: true,
      fileTypesWhitelist: ['js', 'css', 'img', 'html', 'swf', 'fonts', 'pdf']
    };
    options.options = options;
    var localBosco = boscoMock(options);
    localBosco.staticUtils = StaticUtils(localBosco);
    s3push.cmd(localBosco, [], function(err) {
      expect(err).to.be.an.instanceof(Error);
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
      nvmUseDefault: '',
      nvmWhich: '',
      repos: ['project3'],
      noprompt: true,
      knox: {putBuffer: putBuffer},
      fileTypesWhitelist: ['js', 'css', 'img', 'html', 'swf', 'fonts', 'pdf']
    };
    options.options = options;
    var localBosco = boscoMock(options);
    localBosco.staticUtils = StaticUtils(localBosco);

    s3push.cmd(localBosco, [], function(err) {
      expect(err).to.be.an.instanceof(Error);
      expect(err).to.have.property('statusCode', 300);

      statusCode = 400;
      s3push.cmd(localBosco, [], function(err) {
        expect(err).to.be.an.instanceof(Error);
        expect(err).to.have.property('statusCode', 400);

        statusCode = 500;
        s3push.cmd(localBosco, [], function(err) {
          expect(err).to.be.an.instanceof(Error);
          expect(err).to.have.property('statusCode', 500);
          done();
        });
      });
    });
  });

  it('should push all files to s3', function(done) {
    var s3Data = [];
    function putBuffer(buffer, path, headers, next) {
      if (headers['Content-Encoding']) {
        if (headers['Content-Encoding'] === 'gzip') {
          zlib.gunzip(buffer, function(err, buf) {
            if (err) return next(err);
            s3Data.push({content: buf.toString(), path: path});
            next(null, {statusCode: 200});
          });
        } else {
          // Test only checks gzip
          next(null, {statusCode: 200});
        }
      } else {
        s3Data.push({content: buffer.toString(), path: path});
        next(null, {statusCode: 200});
      }
    }
    var options = {
      nvmUse: '',
      nvmUseDefault: '',
      nvmWhich: '',
      repos: ['project3'],
      noprompt: true,
      environment: 'test',
      service: true,
      knox: {putBuffer: putBuffer},
      fileTypesWhitelist: ['js', 'css', 'img', 'swf', 'fonts', 'pdf']
    };
    options.options = options;
    var localBosco = boscoMock(options);
    var staticData = [];
    localBosco.staticUtils = StaticUtils(localBosco);
    localBosco.staticUtils.oldGetStaticAssets = localBosco.staticUtils.getStaticAssets;
    localBosco.staticUtils.getStaticAssets = function(options, next) {
      return localBosco.staticUtils.oldGetStaticAssets(options, function(err, staticAssets) {
        staticData = _.filter(_.map(staticAssets, function(val) {
          var isEmpty = !(val.data || val.content);
          if (isEmpty || val.assetKey === 'formattedAssets') return;
          if (val.type === 'html') return;
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
