'use strict';

var _ = require('lodash');
var expect = require('expect.js');
var fs = require('fs');
var zlib = require('zlib');

var ExternalBuild = require('../src/ExternalBuild');
var boscoMock = require('./boscoMock');

describe('ExternalBuild', function() {
  this.timeout(2000);
  this.slow(500);

  it('should do nothing without build config', function(done) {
    var localBosco = boscoMock();
    var doBuild = ExternalBuild(localBosco).doBuild;
    var service = {
      name: 'service',
      repoPath: localBosco.getRepoPath('')
    };

    doBuild(service, {}, null, function(err) {
      if (err) return done(err);

      expect(localBosco).to.not.have.property('_log');
      expect(localBosco).to.not.have.property('_error');
      expect(localBosco).to.not.have.property('_warn');
      expect(localBosco.console).to.not.have.property('_log');
      expect(localBosco.console).to.not.have.property('_error');
      expect(localBosco.console).to.not.have.property('_warn');
      done();
    });
  });

  it('should run build command', function(done) {
    var localBosco = boscoMock();
    var doBuild = ExternalBuild(localBosco).doBuild;
    var service = {
      name: 'service',
      repoPath: localBosco.getRepoPath(''),
      build: {
        command: 'echo hi'
      }
    };

    doBuild(service, {}, null, function(err) {
      if (err) return done(err);

      expect(localBosco.console).to.not.have.property('_log');
      done();
    });
  });

  it('should error and log failed command', function(done) {
    var localBosco = boscoMock();
    var doBuild = ExternalBuild(localBosco).doBuild;
    var service = {
      name: 'service',
      repoPath: localBosco.getRepoPath(''),
      build: {
        command: ['bash', '-c', 'echo -n hi; echo -n bye >&2;false'],
      }
    };

    doBuild(service, {}, null, function(err) {
      expect(err).to.be.an(Error);
      expect(err).to.have.property('code', 1);
      expect(localBosco.console._log).to.eql(['hi']);
      expect(localBosco._error).to.have.length(2);
      expect(localBosco._error[0]).to.contain('with code 1');
      expect(localBosco._error[1]).to.be('bye');
      done();
    });
  });

  it('should error with exit code of failed command', function(done) {
    var localBosco = boscoMock();
    var doBuild = ExternalBuild(localBosco).doBuild;
    var service = {
      name: 'service',
      repoPath: localBosco.getRepoPath(''),
      build: {
        command: ['bash', '-c', 'exit 7'],
      }
    };

    doBuild(service, {}, null, function(err) {
      expect(err).to.be.an(Error);
      expect(err).to.have.property('code', 7);
      done();
    });
  });

  it('should not run if watchBuilds and reloadOnly', function(done) {
    var localBosco = boscoMock();
    var doBuild = ExternalBuild(localBosco).doBuild;
    var service = {
      name: 'service',
      repoPath: localBosco.getRepoPath(''),
      build: {
        command: ['bash', '-c', 'echo -n hi; echo -n bye >&2;false'],
      }
    };
    var options = {
      watchBuilds: true,
      watchRegex: /./,
      reloadOnly: true
    };

    doBuild(service, options, null, function(err) {
      if (err) return done(err);
      expect(localBosco).to.not.have.property('_log');
      expect(localBosco).to.not.have.property('_error');
      expect(localBosco.console).to.not.have.property('_log');
      done();
    });
  });

  it('should run build command as watch command', function(done) {
    var localBosco = boscoMock();
    var doBuild = ExternalBuild(localBosco).doBuild;
    var service = {
      name: 'service',
      repoPath: localBosco.getRepoPath(''),
      build: {
        command: 'echo hi; sleep 1',
        watch: {
          ready: 'hi',
        }
      }
    };
    var options = {
      watchBuilds: true,
      watchRegex: /./
    };

    doBuild(service, options, null, function(err) {
      if (err) return done(err);
      expect(localBosco.console).to.not.have.property('_log');
      expect(localBosco._log).to.be.an('array');
      expect(localBosco._log[0]).to.contain('echo hi; sleep 1');
      done();
    });
  });

  it('should error and log if watch exits', function(done) {
    var localBosco = boscoMock();
    var doBuild = ExternalBuild(localBosco).doBuild;
    var service = {
      name: 'service',
      repoPath: localBosco.getRepoPath(''),
      build: {
        command: 'bash -c echo',
        watch: {
          ready: 'hi',
        }
      }
    };
    var options = {
      watchBuilds: true,
      watchRegex: /./
    };

    doBuild(service, options, null, function(err) {
      expect(err).to.be.an(Error);
      expect(err).to.have.property('code', 0);
      expect(localBosco._error).to.be.an('array');
      expect(localBosco._error).to.have.length(2);
      expect(localBosco._error[1]).to.contain('with code 0');
      done();
    });
  });

  it('should error and log if watch times out', function(done) {
    var localBosco = boscoMock();
    var doBuild = ExternalBuild(localBosco).doBuild;
    var service = {
      name: 'service',
      repoPath: localBosco.getRepoPath(''),
      build: {
        command: 'echo hello; sleep 1',
        watch: {
          timeout: 1
        }
      }
    };
    var options = {
      watchBuilds: true,
      watchRegex: /./
    };

    doBuild(service, options, null, function(err) {
      expect(err).to.be.an(Error);
      expect(err).to.not.have.property('code');
      expect(localBosco._error).to.be.an('array');
      expect(localBosco._error.length).to.be.greaterThan(0);
      expect(localBosco._error[0]).to.contain('timed out');
      done();
    });
  });

  it('should use watch command if provided', function(done) {
    var localBosco = boscoMock();
    var doBuild = ExternalBuild(localBosco).doBuild;
    var service = {
      name: 'service',
      repoPath: localBosco.getRepoPath(''),
      build: {
        command: ['echo -n build >&2;false'],
        watch: {
          command: ['echo -n watch >&2;sleep 1;false'],
          ready: 'watch'
        }
      }
    };
    var options = {
      watchBuilds: true,
      watchRegex: /./
    };

    doBuild(service, options, null, function(err) {
      if (err) return done(err);
      expect(localBosco.process.stderr).to.have.property('_data');
      expect(localBosco.process.stderr._data).to.eql(['watch']);
      expect(localBosco.process.stdout).to.not.have.property('_data');
      expect(localBosco).to.have.property('_log');
      expect(localBosco).to.not.have.property('_error');
      done();
    });
  });
});
