const _ = require('lodash');
const async = require('async');
const zlib = require('zlib');
const mime = require('mime');
const Table = require('tty-table');
const StaticUtils = require('../src/StaticUtils');

module.exports = {
  name: 's3push',
  description: 'Builds all of the front end assets for each microservice and pushes them to S3 for the current environment',
  usage: '[-e <environment>] [-b <build>] [<tag>]',
  requiresNvm: true,
};

let tag = '';
let noprompt = false;

function getS3Content(file) {
  return file.data || Buffer.from(file.content);
}

function isContentEmpty(file) {
  return !(file.data || file.content);
}

function gzip(content, next) {
  zlib.gzip(content, next);
}

function brotli(content, next) {
  zlib.brotliCompress(content, next);
}

function bytesToSize(bytes) {
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  if (bytes === 0) return 'n/a';
  const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)), 10);
  if (i === 0) return `${bytes} ${sizes[i]}`;
  return `${(bytes / (1024 ** i)).toFixed(1)} ${sizes[i]}`;
}

function cmd(bosco, args, callback) {
  bosco.staticUtils = bosco.staticUtils || StaticUtils(bosco); // eslint-disable-line no-param-reassign
  if (args.length > 0) [tag] = args;

  const cdnUrl = `${bosco.config.get('aws:cdn')}/`;
  noprompt = bosco.options.noprompt; // eslint-disable-line prefer-destructuring

  let maxAge = bosco.config.get('aws:maxage');
  if (typeof maxAge !== 'number') maxAge = 365000000;

  const assetLog = {};

  bosco.log(`Compile front end assets across services ${tag ? `for tag: ${tag.blue}` : ''}`);

  const repos = bosco.getRepos();
  if (!repos) {
    bosco.error('You are repo-less :( You need to initialise bosco first, try \'bosco clone\'.');
    return callback(new Error('no repos'));
  }

  function printAssets(assets) {
    const header = [
      {
        value: 'path', headerColor: 'cyan', headerAlign: 'left', align: 'left',
      },
      { value: 'encoding', headerColor: 'cyan', align: 'left' },
      { value: 'duration', headerColor: 'cyan' },
      { value: 'size', headerColor: 'cyan' },
    ];

    const rows = [];
    const options = { compact: true, borderStyle: 0 };
    let imageCount = 0;

    _.forEach(assets, (asset) => {
      if (asset.mimeType.includes('image') || asset.mimeType.includes('font')) {
        imageCount += 1;
        return;
      }
      rows.push([asset.fullPath, asset.encodings ? asset.encodings.join(',') : 'raw', `${asset.duration} ms`, bytesToSize(asset.fileSize)]);
    });

    rows.push([`Uploaded ${imageCount} images or fonts`, '', '', '']);

    const table = new Table(header, rows, options);

    bosco.console.log(table.render());
    bosco.console.log('\r');
  }

  function getS3Filename(file) {
    return `${bosco.options.environment}/${file}`;
  }

  function pushToS3(file, next) {
    if (!bosco.knox) {
      bosco.warn(`Knox AWS not configured for environment ${bosco.options.environment} - so not pushing ${file.path} to S3.`);
      return next(null, { file });
    }

    assetLog[file.path].started = Date.now();

    function upload(encoding, suffix, buffer, cb) {
      const headers = {
        'Content-Type': file.mimeType,
        Vary: 'accept-encoding',
        'Cache-Control': (`max-age=${maxAge === 0 ? '0, must-revalidate' : maxAge}, immutable`),
      };

      if (encoding) {
        headers['Content-Encoding'] = encoding;
      }

      const filePath = file.path + suffix;

      assetLog[file.path].fullPath = cdnUrl + file.path;
      assetLog[file.path].encodings.push(encoding);
      assetLog[file.path].fileSize = buffer.byteLength;

      if (bosco.options.verbose) {
        bosco.log(`Uploading ${filePath} ... `);
      }

      // This is useful for testing
      // bosco.knox.putBuffer = function(buffer, filePath, headers, pcb) {
      //   pcb(null, {statusCode: 200});
      // }

      bosco.knox.putBuffer(buffer, filePath, headers, (error, res) => {
        let err = error;
        if (!err && res.statusCode >= 300) {
          err = new Error(`S3 error, code ${res.statusCode}`);
          err.statusCode = res.statusCode;
        }
        if (err) return cb(err);
        assetLog[file.path].finished = Date.now();
        assetLog[file.path].duration = assetLog[file.path].finished - assetLog[file.path].started;
        return cb();
      });
    }

    const zipTypes = bosco.config.compressFileTypes || ['application/javascript', 'application/json', 'application/xml', 'text/html', 'text/xml', 'text/css', 'text/plain', 'image/svg+xml'];
    if (zipTypes.includes(file.mimeType)) {
      async.parallel({
        gzip: async.apply(gzip, file.content),
        brotli: async.apply(brotli, file.content),
      }, (err, compressedContent) => {
        if (err) return next(err);
        upload('gzip', '', compressedContent.gzip, (uploadGZErr) => {
          if (uploadGZErr) return next(uploadGZErr);
          upload('br', '.br', compressedContent.brotli, (uploadBRErr) => {
            if (uploadBRErr) return next(uploadBRErr);
            return next(null, { file });
          });
        });
      });
    } else {
      upload('', '', file.content, () => next(null, { file }));
    }
  }

  function pushAllToS3(staticAssets, next) {
    const toPush = [];
    bosco.log(`Compressing and pushing ${staticAssets.length} assets to S3, here we go ...`);
    _.forEach(staticAssets, (asset) => {
      const key = asset.assetKey;

      if (key === 'formattedAssets') return;
      if (tag && tag !== asset.tag) return;
      if (isContentEmpty(asset)) {
        bosco.log(`Skipping asset: ${key.blue} (content empty)`);
        return;
      }
      if (asset.type === 'html') {
        // No longer upload html to S3
        return;
      }

      const s3Filename = getS3Filename(key);
      const mimeType = asset.mimeType || mime.getType(key);

      assetLog[s3Filename] = {
        mimeType,
        encodings: [],
      };

      toPush.push({
        content: getS3Content(asset),
        path: s3Filename,
        type: asset.type,
        mimeType,
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
    }, (err, result) => {
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

    const options = {
      repos,
      minify: true,
      buildNumber: bosco.options.build || 'default',
      tagFilter: tag,
      watchBuilds: false,
      reloadOnly: false,
      isCdn: false,
    };

    bosco.staticUtils.getStaticAssets(options, (getStaticErr, staticAssets) => {
      if (getStaticErr) {
        bosco.error(`There was an error: ${getStaticErr.message}`);
        return next(getStaticErr);
      }
      if (!staticAssets) {
        bosco.warn('No assets found to push ...');
        return next();
      }
      const erroredAssets = _.filter(staticAssets, { type: 'error' });
      if (erroredAssets.length > 0) {
        bosco.error('There were errors encountered above that you must resolve:');
        erroredAssets.forEach((e) => {
          bosco.error(e.message);
        });
        return next(new Error('Errors encountered during build'));
      }
      pushAllToS3(staticAssets, (pushErr) => {
        if (pushErr) {
          bosco.error(`There was an error: ${pushErr.message}`);
          return next(pushErr);
        }
        printAssets(assetLog);
        bosco.log('Done');
        next();
      });
    });
  }

  if (noprompt) return go(callback);

  const confirmMsg = 'Are you sure you want to publish '.white + (tag ? `all ${tag.blue} assets in ` : `${'ALL'.red} assets in `).white + bosco.options.environment.blue + ' (y/N)?'.white;
  confirm(confirmMsg, (err, confirmed) => {
    if (err) return callback(err);
    if (!confirmed) return callback(new Error('Not confirmed'));
    go(callback);
  });
}

module.exports.cmd = cmd;
