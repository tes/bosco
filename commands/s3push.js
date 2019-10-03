var _ = require('lodash');
var async = require('async');
var zlib = require('zlib');
var mime = require('mime');
var iltorb = require('iltorb');
var Table = require('tty-table');
var StaticUtils = require('../src/StaticUtils');

module.exports = {
  name: 's3push',
  description: 'Builds all of the front end assets for each microservice and pushes them to S3 for the current environment',
  usage: '[-e <environment>] [-b <build>] [<tag>]',
  requiresNvm: true
};

var tag = '';
var noprompt = false;

function getS3Content(file) {
  return file.data || new Buffer(file.content);
}

function isContentEmpty(file) {
  return !(file.data || file.content);
}

function gzip(content, next) {
  zlib.gzip(content, next);
}

function brotli(content, next) {
  iltorb.compress(content)
    .then(function (output) {
      next(null, output);
    }).catch(function (err) {
      next(err);
    });
}

function bytesToSize(bytes) {
  var sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  if (bytes === 0) return 'n/a';
  var i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)), 10);
  if (i === 0) return bytes + ' ' + sizes[i];
  return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + sizes[i];
}

function cmd(bosco, args, callback) {
  bosco.staticUtils = bosco.staticUtils || StaticUtils(bosco);
  if (args.length > 0) tag = args[0];

  var cdnUrl = bosco.config.get('aws:cdn') + '/';
  noprompt = bosco.options.noprompt;

  var maxAge = bosco.config.get('aws:maxage');
  if (typeof maxAge !== 'number') maxAge = 365000000;

  var assetLog = {};

  bosco.log('Compile front end assets across services ' + (tag ? 'for tag: ' + tag.blue : ''));

  var repos = bosco.getRepos();
  if (!repos) {
    bosco.error('You are repo-less :( You need to initialise bosco first, try \'bosco clone\'.');
    return callback(new Error('no repos'));
  }

  function printAssets(assets) {
    var header = [
      {
        value: 'path', headerColor: 'cyan', headerAlign: 'left', align: 'left'
      },
      { value: 'encoding', headerColor: 'cyan', align: 'left' },
      { value: 'duration', headerColor: 'cyan' },
      { value: 'size', headerColor: 'cyan' }
    ];

    var rows = [];
    var options = { compact: true, borderStyle: 0 };
    var imageCount = 0;

    _.forEach(assets, function (asset) {
      if (asset.mimeType.includes('image') || asset.mimeType.includes('font')) {
        imageCount++;
        return;
      }
      rows.push([asset.fullPath, asset.encodings ? asset.encodings.join(',') : 'raw', asset.duration + ' ms', bytesToSize(asset.fileSize)]);
    });

    rows.push(['Uploaded ' + imageCount + ' images or fonts', '', '', '']);

    var table = new Table(header, rows, options);

    bosco.console.log(table.render());
    bosco.console.log('\r');
  }

  function getS3Filename(file) {
    return bosco.options.environment + '/' + file;
  }

  function pushToS3(file, next) {
    if (!bosco.knox) {
      bosco.warn('Knox AWS not configured for environment ' + bosco.options.environment + ' - so not pushing ' + file.path + ' to S3.');
      return next(null, { file: file });
    }

    assetLog[file.path].started = Date.now();

    function upload(encoding, suffix, buffer, cb) {
      var headers = {
        'Content-Type': file.mimeType,
        Vary: 'accept-encoding',
        'Cache-Control': ('max-age=' + (maxAge === 0 ? '0, must-revalidate' : maxAge) + ', immutable')
      };

      if (encoding) {
        headers['Content-Encoding'] = encoding;
      }

      var filePath = file.path + suffix;

      assetLog[file.path].fullPath = cdnUrl + file.path;
      assetLog[file.path].encodings.push(encoding);
      assetLog[file.path].fileSize = buffer.byteLength;

      if (bosco.options.verbose) {
        bosco.log('Uploading ' + filePath + ' ... ');
      }

      // This is useful for testing
      // bosco.knox.putBuffer = function(buffer, filePath, headers, pcb) {
      //   pcb(null, {statusCode: 200});
      // }

      bosco.knox.putBuffer(buffer, filePath, headers, function (error, res) {
        var err = error;
        if (!err && res.statusCode >= 300) {
          err = new Error('S3 error, code ' + res.statusCode);
          err.statusCode = res.statusCode;
        }
        if (err) return cb(err);
        assetLog[file.path].finished = Date.now();
        assetLog[file.path].duration = assetLog[file.path].finished - assetLog[file.path].started;
        return cb();
      });
    }

    var zipTypes = bosco.config.compressFileTypes || ['application/javascript', 'application/json', 'application/xml', 'text/html', 'text/xml', 'text/css', 'text/plain', 'image/svg+xml'];
    if (zipTypes.includes(file.mimeType)) {
      async.parallel({
        gzip: async.apply(gzip, file.content),
        brotli: async.apply(brotli, file.content)
      }, function (err, compressedContent) {
        if (err) return next(err);
        upload('gzip', '', compressedContent.gzip, function (err) {
          if (err) return next(err);
          upload('br', '.br', compressedContent.brotli, function (err) {
            if (err) return next(err);
            return next(null, { file: file });
          });
        });
      });
    } else {
      upload('', '', file.content, function () {
        return next(null, { file: file });
      });
    }
  }

  function pushAllToS3(staticAssets, next) {
    var toPush = [];
    bosco.log('Compressing and pushing ' + staticAssets.length + ' assets to S3, here we go ...');
    _.forEach(staticAssets, function (asset) {
      var key = asset.assetKey;

      if (key === 'formattedAssets') return;
      if (tag && tag !== asset.tag) return;
      if (isContentEmpty(asset)) {
        bosco.log('Skipping asset: ' + key.blue + ' (content empty)');
        return;
      }
      if (asset.type === 'html') {
        // No longer upload html to S3
        return;
      }

      var s3Filename = getS3Filename(key);
      var mimeType = asset.mimeType || mime.lookup(key);

      assetLog[s3Filename] = {
        mimeType: mimeType,
        encodings: []
      };

      toPush.push({
        content: getS3Content(asset),
        path: s3Filename,
        type: asset.type,
        mimeType: mimeType
      });
    });

    // Add index if doing full s3 push
    if (!bosco.options.service) {
      toPush.push({
        content: staticAssets.formattedAssets,
        path: getS3Filename('index.html'),
        type: 'html',
        mimeType: 'text/html'
      });
    }

    async.mapSeries(toPush, pushToS3, next);
  }

  function confirm(message, next) {
    bosco.prompt.start();
    bosco.prompt.get({
      properties: {
        confirm: {
          description: message
        }
      }
    }, function (err, result) {
      if (!result) return next({ message: 'Did not confirm' });
      if (result.confirm === 'Y' || result.confirm === 'y') {
        next(null, true);
      } else {
        next(null, false);
      }
    });
  }

  function go(next) {
    bosco.log('Compiling front end assets, this can take a while ... ');

    var options = {
      repos: repos,
      minify: true,
      buildNumber: bosco.options.build || 'default',
      tagFilter: tag,
      watchBuilds: false,
      reloadOnly: false,
      isCdn: false
    };

    bosco.staticUtils.getStaticAssets(options, function (err, staticAssets) {
      if (err) {
        bosco.error('There was an error: ' + err.message);
        return next(err);
      }
      if (!staticAssets) {
        bosco.warn('No assets found to push ...');
        return next();
      }
      var erroredAssets = _.filter(staticAssets, { type: 'error' });
      if (erroredAssets.length > 0) {
        bosco.error('There were errors encountered above that you must resolve:');
        erroredAssets.forEach(function (e) {
          bosco.error(e.message);
        });
        return next(new Error('Errors encountered during build'));
      }
      pushAllToS3(staticAssets, function (err) {
        if (err) {
          bosco.error('There was an error: ' + err.message);
          return next(err);
        }
        printAssets(assetLog);
        bosco.log('Done');
        next();
      });
    });
  }

  if (noprompt) return go(callback);

  var confirmMsg = 'Are you sure you want to publish '.white + (tag ? 'all ' + tag.blue + ' assets in ' : 'ALL'.red + ' assets in ').white + bosco.options.environment.blue + ' (y/N)?'.white;
  confirm(confirmMsg, function (err, confirmed) {
    if (err) return callback(err);
    if (!confirmed) return callback(new Error('Not confirmed'));
    go(callback);
  });
}

module.exports.cmd = cmd;
