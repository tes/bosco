var _ = require('lodash');
var async = require('async');
var zlib = require('zlib');
var mime = require('mime');
var iltorb = require('iltorb');

module.exports = {
  name: 's3push',
  description: 'Builds all of the front end assets for each microservice and pushes them to S3 for the current environment',
  usage: '[-e <environment>] [-b <build>] [<tag>]',
  requiresNvm: true,
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
    .then(function(output) {
      next(null, output);
    }).catch(function(err) {
      next(err);
    });
}

function cmd(bosco, args, callback) {
  if (args.length > 0) tag = args[0];

  var cdnUrl = bosco.config.get('aws:cdn') + '/';
  noprompt = bosco.options.noprompt;

  var maxAge = bosco.config.get('aws:maxage');
  if (typeof maxAge !== 'number') maxAge = 365000000;

  bosco.log('Compile front end assets across services ' + (tag ? 'for tag: ' + tag.blue : ''));

  var repos = bosco.getRepos();
  if (!repos) {
    bosco.error('You are repo-less :( You need to initialise bosco first, try \'bosco clone\'.');
    return callback(new Error('no repos'));
  }

  function getS3Filename(file) {
    return bosco.options.environment + '/' + file;
  }

  function pushToS3(file, next) {
    if (!bosco.knox) {
      bosco.warn('Knox AWS not configured for environment ' + bosco.options.envrionment + ' - so not pushing ' + file.path + ' to S3.');
      return next(null, {file: file});
    }

    function upload(encoding, suffix, buffer, cb) {
      var headers = {
        'Content-Type': file.mimeType,
        'Content-Encoding': encoding,
        'Cache-Control': ('max-age=' + (maxAge === 0 ? '0, must-revalidate' : maxAge) + ', immutable'),
      };
      var filePath = file.path + suffix;
      bosco.knox.putBuffer(buffer, filePath, headers, function(error, res) {
        var err = error;
        if (!err && res.statusCode >= 300) {
          err = new Error('S3 error, code ' + res.statusCode);
          err.statusCode = res.statusCode;
        }

        if (err) return cb(err);

        bosco.log('Pushed to S3: ' + cdnUrl + filePath + ' [' + encoding + ']');
        return cb();
      });
    }

    async.parallel({
      gzip: async.apply(gzip, file.content),
      brotli: async.apply(brotli, file.content),
    }, function(err, compressedContent) {
      if (err) return next(err);
      upload('gzip', '', compressedContent.gzip, function(err) {
        if (err) return next(err);
        upload('br', '.br', compressedContent.brotli, function(err) {
          if (err) return next(err);
          return next(null, {file: file});
        });
      });
    });
  }

  function pushAllToS3(staticAssets, next) {
    var toPush = [];
    _.forEach(staticAssets, function(asset) {
      var key = asset.assetKey;

      if (key === 'formattedAssets') return;
      if (tag && tag !== asset.tag) return;
      if (isContentEmpty(asset)) {
        bosco.log('Skipping asset: ' + key.blue + ' (content empty)');
        return;
      }

      var s3Filename = getS3Filename(key);
      var mimeType = asset.mimeType || mime.lookup(key);

      bosco.log('Staging publish: ' + s3Filename.blue + ' (' + mimeType + ')');

      toPush.push({
        content: getS3Content(asset),
        path: s3Filename,
        type: asset.type,
        mimeType: mimeType,
      });
    });

    // Add index if doing full s3 push
    if (!bosco.options.service) {
      toPush.push({
        content: staticAssets.formattedAssets,
        path: getS3Filename('index.html'),
        type: 'html',
        mimeType: 'text/html',
      });
    }

    async.mapSeries(toPush, pushToS3, next);
  }

  function confirm(message, next) {
    bosco.prompt.start();
    bosco.prompt.get({
      properties: {
        confirm: {
          description: message,
        },
      },
    }, function(err, result) {
      if (!result) return next({message: 'Did not confirm'});
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
      isCdn: false,
    };

    bosco.staticUtils.getStaticAssets(options, function(err, staticAssets) {
      if (err) {
        bosco.error('There was an error: ' + err.message);
        return next(err);
      }
      if (!staticAssets) {
        bosco.warn('No assets found to push ...');
        return next();
      }
      var erroredAssets = _.filter(staticAssets, {type: 'error'});
      if (erroredAssets.length > 0) {
        bosco.error('There were errors encountered above that you must resolve:');
        erroredAssets.forEach(function(e) {
          bosco.error(e.message);
        });
        return next(new Error('Errors encountered during build'));
      }
      pushAllToS3(staticAssets, function(err) {
        if (err) {
          bosco.error('There was an error: ' + err.message);
          return next(err);
        }
        bosco.log('Done');
        next();
      });
    });
  }

  if (noprompt) return go(callback);

  var confirmMsg = 'Are you sure you want to publish '.white + (tag ? 'all ' + tag.blue + ' assets in ' : 'ALL'.red + ' assets in ').white + bosco.options.environment.blue + ' (y/N)?'.white;
  confirm(confirmMsg, function(err, confirmed) {
    if (err) return callback(err);
    if (!confirmed) return callback(new Error('Not confirmed'));
    go(callback);
  });
}

module.exports.cmd = cmd;
