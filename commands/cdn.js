var _ = require('lodash');
var async = require('async');
var fs = require('fs');
var path = require('path');
var http = require('http');
var url = require('url');
var requestLib = require('request');
var browserSync = require('browser-sync');
var RunListHelper = require('../src/RunListHelper');
var CmdHelper = require('../src/CmdHelper');

module.exports = {
  name: 'cdn',
  usage: '[-r <repoPattern>] [-w <repoPattern>] [<minify>]',
  description: 'Aggregates all the static assets across all microservices and serves them via a pseudo local CDN url',
  requiresNvm: true,
  options: [{
    name: 'tag',
    alias: 't',
    type: 'string',
    desc: 'Filter by a tag defined within bosco-service.json',
  },
  {
    name: 'watch',
    alias: 'w',
    type: 'string',
    desc: 'Filter by a regex of services to watch (similar to -r in run)',
  },
  {
    name: 'local-vendor',
    alias: 'lv',
    type: 'boolean',
    desc: 'Force vendor library files to come from local cdn instead of remote cdn',
  }],
};

function cmd(bosco, args) {
  var minify = _.includes(args, 'minify');
  var port = bosco.config.get('cdn:port') || 7334;
  var repoPattern = bosco.options.repo;
  var repoRegex = new RegExp(repoPattern);
  var watchPattern = bosco.options.watch || '$a';
  var watchRegex = new RegExp(watchPattern);
  var repoTag = bosco.options.tag;
  var bs = browserSync.create();
  var repos;

  bosco.log('Starting pseudo CDN on port: ' + (port + '').blue);

  if (bosco.options.list) {
    repos = bosco.options.list.split(',');
  } else {
    if (CmdHelper.checkInService(bosco)) {
      bosco.options.watch = bosco.options.watch || new RegExp(bosco.getRepoName());
      watchRegex = new RegExp(bosco.options.watch);
    }

    repos = bosco.getRepos();
  }

  if (!repos) return bosco.error('You are repo-less :( You need to initialise bosco first, try \'bosco clone\'.');

  function getRunList(next) {
    RunListHelper.getRunList(bosco, repos, repoRegex, watchRegex, repoTag, false, next);
  }

  function startServer(staticAssets, staticRepos, serverPort) {
    var isWatchedFile = function(asset) {
      var hasSourceFiles = asset.sourceFiles && asset.sourceFiles.length > 0;
      var assetPath = hasSourceFiles ? asset.sourceFiles[0] : asset.path;
      var watched;
      try {
        watched = assetPath && !fs.lstatSync(assetPath).isDirectory() && assetPath.match(watchRegex);
      } catch (ex) {
        watched = false;
      }
      return watched;
    };

    function getAsset(assetUrl) {
      var key = assetUrl.replace('/', '');
      return _.find(staticAssets, {assetKey: key});
    }

    var corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Credentials': true,
      'Access-Control-Max-Age': '86400', // 24 hours
      'Access-Control-Allow-Headers': 'X-Requested-With, Access-Control-Allow-Origin, X-HTTP-Method-Override, Content-Type, Authorization, Accept',
    };

    var server = http.createServer(function(request, response) {
      if (request.method === 'OPTIONS') {
        response.writeHead(200, corsHeaders);
        return response.end();
      }

      var headers = {
        'Cache-Control': 'no-cache, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': 'Sat, 21 May 1952 00:00:00 GMT',
        'Access-Control-Allow-Origin': '*',
      };

      var pathname = url.parse(request.url).pathname;
      if (pathname === '/repos') {
        headers['Content-Type'] = 'text/html';
        response.writeHead(200, headers);
        return response.end(staticRepos.formattedRepos);
      }

      var isLibraryAsset = pathname.indexOf('/vendor/library/') >= 0;
      // Path matches something that is service-name/build e.g. /app-home/720/css/logged-in.css
      var isRemoteAsset = pathname.match(/^\/(.*)\/(\d+)\//);
      var serveRemoteAsset = isRemoteAsset || (isLibraryAsset && !bosco.options.localVendor);
      if (serveRemoteAsset) {
        var baseCdn = bosco.config.get('cdn:remoteUrl') || 'https://duqxiy1o2cbw6.cloudfront.net/tes';
        var cdnUrl = baseCdn + pathname;
        var localCacheFolder = path.join(bosco.findConfigFolder(), 'cache');
        var localCacheFile = path.join(localCacheFolder, pathname.replace(/\//g, '_') + '.json');

        // Ensure local cache folder exists
        if (!fs.existsSync(localCacheFolder)) {
          fs.mkdirSync(localCacheFolder);
        }

        var useLocalCacheFile = !bosco.options.nocache && fs.existsSync(localCacheFile);

        if (useLocalCacheFile) {
          var cacheContent = require(localCacheFile);
          response.writeHead(200, cacheContent.headers);
          response.end(cacheContent.body, 'binary');
        } else {
          var baseBoscoCdnUrl = bosco.getBaseCdnUrl();
          requestLib.get({uri: cdnUrl, gzip: true, timeout: 5000}, function(err, cdnResponse, body) {
            if (err) {
              bosco.error('Error proxying asset for: ' + cdnUrl + ', Error: ' + err.message);
              response.writeHead(500);
              return response.end();
            }

            var contentType = cdnResponse.headers['content-type'];
            var responseContent = body;
            var responseHeaders;

            if (contentType === 'text/css' || contentType === 'application/javascript') {
              responseContent = body.toString();
              // We want to convert all of the in content urls to local bosco ones to take advantage of offline caching
              // For the js / css files contained within the html fragments for remote services
              responseContent = responseContent.replace(new RegExp(baseCdn, 'g'), baseBoscoCdnUrl);
              responseHeaders = _.defaults({
                'content-type': contentType,
                'content-length': responseContent.length,
              }, corsHeaders);
            } else {
              // All other content we send as binary, where lenght matters
              responseHeaders = _.defaults({
                'content-type': contentType,
                'content-length': cdnResponse.headers['content-length'],
              }, corsHeaders);
            }

            response.writeHead(200, responseHeaders);
            response.end(responseContent, 'binary');

            var cacheContentToSave = {
              headers: responseHeaders,
              body: responseContent,
            };
            fs.writeSync(fs.openSync(localCacheFile, 'w'), JSON.stringify(cacheContentToSave, null, 2));
          });
        }
        return 'served-remote';
      }

      var asset = getAsset(pathname);
      if (!asset) {
        headers['Content-Type'] = 'text/html';
        response.writeHead(404, headers);
        return staticAssets ? response.end(staticAssets.formattedAssets) : response.end();
      }

      headers['content-Type'] = asset.mimeType;
      response.writeHead(200, headers);

      var hasSourceFiles = asset.sourceFiles && asset.sourceFiles.length > 0;

      if (isWatchedFile(asset)) {
        if (hasSourceFiles && !minify) {
          async.reduce(asset.sourceFiles, '', function(memo, item, callback) {
            fs.readFile(item, function(err, content) {
              callback(null, memo + content);
            });
          }, function(err, content) {
            response.end(content);
          });
        } else {
          fs.readFile(asset.path, function(err, content) {
            response.end(content);
          });
        }
      } else {
        response.end(asset.data || asset.content);
      }
    });

    server.listen(serverPort);

    if (bosco.options['browser-sync']) {
      var assets = _.map(_.filter(staticAssets, isWatchedFile), 'path');
      var extraFiles = _.filter(_.uniq(_.flattenDeep(_.map(staticAssets, 'extraFiles'))));
      var assetsToWatch = _.union(assets, extraFiles);
      bs.init({
        proxy: bosco.options['browser-sync-proxy'],
        files: assetsToWatch,
        reloadDelay: bosco.options['browser-sync-delay'],
      });
    }

    bosco.log('Server is listening on ' + serverPort);
  }

  function watchCallback(err, service) {
    if (err) { return bosco.error(err); }
    bosco.log('Local CDN ready after build for service: ' + service.name.green);
  }

  if (minify) bosco.log('Running per service builds for front end assets, this can take some time ...');

  getRunList(function(err, repoList) {
    var repoNames = _.map(repoList, 'name');
    var options = {
      repos: repoNames,
      buildNumber: 'local',
      minify: minify,
      tagFilter: null,
      watchBuilds: true,
      reloadOnly: false,
      ignoreFailure: true,
      watchRegex: watchRegex,
      repoRegex: repoRegex,
      repoTag: repoTag,
      watchCallback: watchCallback,
      isCdn: true,
    };

    var executeAsync = {
      staticAssets: bosco.staticUtils.getStaticAssets.bind(null, options),
      staticRepos: bosco.staticUtils.getStaticRepos.bind(null, options),
    };

    async.parallel(executeAsync, function(err, results) {
      startServer(results.staticAssets, results.staticRepos, port);
    });
  });
}

module.exports.cmd = cmd;
