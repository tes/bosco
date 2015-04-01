var _ = require('lodash'),
     async = require('async'),
    http = require('http'),
    url = require('url'),
    zlib = require('zlib'),
    mime = require('mime');

module.exports = {
    name:'s3push',
    description:'Builds all of the front end assets for each microservice and pushes them to S3 for the current environment',
    example:'bosco -e <environment> -b <build> s3push <tag>',
    cmd:cmd
}

var tag = '', noprompt = false;

function cmd(bosco, args) {

    if(args.length > 0) tag = args[0];

    var cdnUrl = bosco.config.get('aws:cdn') + '/';
    var compoxureUrl = bosco.config.get('compoxure') ? bosco.config.get('compoxure')[bosco.options.environment] : '';
    noprompt = bosco.options.noprompt;

    var maxAge = bosco.config.get('aws:maxage');
    if(typeof maxAge !== 'number') maxAge = 31536000; // Default to one year

    bosco.log('Compile front end assets across services ' + (tag ? 'for tag: ' + tag.blue : ''));

    var repos = bosco.getRepos();
    if(!repos) return bosco.error('You are repo-less :( You need to initialise bosco first, try \'bosco clone\'.');

    var pushAllToS3 = function(staticAssets, next) {

        var toPush = [];
        _.forEach(staticAssets, function(asset) {

            var key = asset.assetKey;

            if(key == 'formattedAssets') return;
            if(tag && tag !== asset.tag) return;
            if(isContentEmpty(asset)) {
                bosco.log('Skipping asset: ' + key.blue + ' (content empty)');
                return;
            }

            var s3Filename = getS3Filename(key);
            var mimeType = asset.mimeType || mime.lookup(key);

            bosco.log('Staging publish: ' + s3Filename.blue + ' ('+ mimeType +')');

            toPush.push({
                content:  getS3Content(asset),
                path:     s3Filename,
                type:     asset.type,
                mimeType: mimeType
            });

        });

        // Add index if doing full s3 push
        if(!bosco.options.service) {
            toPush.push({
                content:staticAssets.formattedAssets,
                path: getS3Filename('index.html'),
                type:'html',
                mimeType:'text/html'
            });
        }

        async.mapSeries(toPush, pushToS3, next);
    }

    var gzip = function(content, next) {
        zlib.gzip(content, next);
    }

    var pushToS3 = function(file, next) {
        if(!bosco.knox) return bosco.warn('Knox AWS not configured for environment ' + bosco.options.envrionment + ' - so not pushing ' + file.path + ' to S3.');
        gzip(file.content, function(err, buffer) {
            var headers = {
              'Content-Type':file.mimeType,
              'Content-Encoding':'gzip',
              'Cache-Control': ('max-age=' + (maxAge === 0 ? '0, must-revalidate' : maxAge))
            };
            bosco.knox.putBuffer(buffer, file.path, headers, function(err, res) {
              if(res.statusCode != 200 && !err) err = {message:'S3 error, code ' + res.statusCode};
              bosco.log('Pushed to S3: ' + cdnUrl + file.path);
              if(compoxureUrl && file.type == 'html') {
                primeCompoxure(cdnUrl + file.path, file.content.toString(), function(err) {
                    if(err) bosco.error('Error flushing compoxure: ' + err.message);
                    next(err, {file: file});
                });
              } else {
                next(err, {file: file});
              }
            });
        });
    }

    var primeCompoxure = function(htmlUrl, content, next) {

        var compoxureKey = s3cxkey(htmlUrl);
        var ttl = 999 * 60 * 60 * 24; // 999 Days
        var cacheData = {
            expires: Date.now()+ ttl,
            content: content,
            ttl: ttl
        }
        var cacheUrl = url.parse(compoxureUrl + compoxureKey);
        var cacheString = JSON.stringify(cacheData);
        var headers = {
          'Content-Type': 'application/json',
          'Content-Length': cacheString.length
        };
        var calledNext = false;

        var options = {
          host: cacheUrl.hostname,
          port: cacheUrl.port,
          path: cacheUrl.path,
          method: 'POST',
          headers: headers
        };

        var req = http.request(options, function(res) {
          res.setEncoding('utf-8');
          var responseString = '';
          res.on('data', function(data) {
            responseString += data;
          });
          res.on('end', function() {
            bosco.log(res.statusCode + ' ' + responseString);
            if(!calledNext) {
                calledNext = true;
                return next();
            }
          });
        });

        req.on('error', function(e) {
          // TODO: handle error.
          bosco.error('There was an error posting fragment to Compoxure: ' + e.message);
          if(!calledNext) {
            calledNext = true;
            return next();
          }
        });

        bosco.log('Priming compoxure cache at url: ' + compoxureUrl + compoxureKey);
        req.write(cacheString);
        req.end();

    }

    var confirm = function(message, next) {
         bosco.prompt.start();
         bosco.prompt.get({
            properties: {
              confirm: {
                description: message
              }
            }
          }, function (err, result) {
            if(!result) return next({message:'Did not confirm'});
            if(result.confirm == 'Y' || result.confirm == 'y') {
                next(null, true);
            } else {
                next(null, false);
            }
         });
    }

    var go = function() {

        bosco.log('Compiling front end assets, this can take a while ... ');

        var options = {
            repos: repos,
            minify: true,
            buildNumber: bosco.options.build || 'default',
            tagFilter: tag,
            watchBuilds: false,
            reloadOnly: false
        }

        bosco.staticUtils.getStaticAssets(options, function(err, staticAssets) {
            pushAllToS3(staticAssets, function(err) {
                if(err) return bosco.error('There was an error: ' + err.message);
                bosco.log('Done');
            });
        });
    }

    if(!noprompt) {
        var confirmMsg = 'Are you sure you want to publish '.white + (tag ? 'all ' + tag.blue + ' assets in ' : 'ALL'.red + ' assets in ').white + bosco.options.environment.blue + ' (y/N)?'.white
        confirm(confirmMsg, function(err, confirmed) {
            if(!err && confirmed) go();
        })
    } else {
        go();
    }

    function getS3Content(file) {
        return file.data || new Buffer(file.content);
    }

    // Create a Compoxure cache key for a given S3 url
    function s3cxkey(url) {
        var key = _.clone(url);
        key = key.replace('http://','');
        key = key.replace(/\./g,'_');
        key = key.replace(/-/g,'_');
        key = key.replace(/:/g,'_');
        key = key.replace(/\//g,'_');
        return key;
    }

    function isContentEmpty(file) {
        return !(file.data || file.content);
    }

    function getS3Filename(file) {
        file = bosco.options.environment + '/' + file;
        return file;
    }
}
