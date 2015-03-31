var _ = require('lodash');
var async = require('async');
var fs = require('fs');
var http = require('http');
var watch = require('watch');

module.exports = {
    name:'cdn',
    description:'Aggregates all the static assets across all microservices and serves them via a pseudo local CDN url',
    example:'bosco cdn <minify>',
    cmd:cmd,
    options: [{
        option: 'tag',
        syntax: ['-t, --tag [tag]', 'Filter by a tag defined within bosco-service.json']
    },
    {
        option: 'watch',
        syntax: ['-w, --watch [regex]', 'Filter by a regex of services to watch (similar to -r in run)']
    }]
}

function cmd(bosco, args) {

    var minify = _.contains(args,'minify');
    var port = bosco.config.get('cdn:port') || 7334;
    var repoPattern = bosco.options.repo;
    var repoRegex = new RegExp(repoPattern);
    var watchPattern = bosco.options.watch || '$a';
    var watchRegex = new RegExp(watchPattern);
    var repoTag = bosco.options.tag;

    bosco.log('Starting pseudo CDN on port: ' + (port+'').blue);

    var repos = bosco.getRepos();
    if(!repos) return bosco.error('You are repo-less :( You need to initialise bosco first, try \'bosco clone\'.');

    var startServer = function(staticAssets, staticRepos, serverPort) {

        var server = http.createServer(function(request, response) {

            var url = request.url.replace('/','');
            var asset = getAssetForUrl(staticAssets, url);

            if(asset) {

                response.writeHead(200, {
                    'Content-Type': asset.mimeType,
                    'Cache-Control': 'no-cache, must-revalidate',
                    'Pragma': 'no-cache',
                    'Expires': 'Sat, 21 May 1952 00:00:00 GMT'
                });

                getContent(asset, function(err, content) {
                    if(err) {
                        response.writeHead(500, {'Content-Type': 'text/html'});
                        response.end('<h2>There was an error: ' + err.message + '</h2>');
                    } else {
                        response.end(content);
                    }
                });

          } else {
              if (request.url == '/repos') {
                  response.writeHead(200, {'Content-Type': 'text/html'});
                  return response.end(staticRepos.formattedRepos);
              }
              response.writeHead(404, {'Content-Type': 'text/html'});
              response.end(staticAssets.formattedAssets);
          }
        });

        server.listen(serverPort);
        bosco.log('Server is listening on ' + serverPort);

    }

    var startMonitor = function(staticAssets) {

      var watchSet = {}, reloading = {};

      _.forOwn(staticAssets, function(asset, key) {
          if(asset.repo && !asset.repo.match(watchRegex)) {
            return;
          }
          if(!minify) {
            if(asset.path) {
              watchSet[asset.path] = key;
            }
            return;
          }
          if(asset.extname == '.manifest') {
              var manifestFiles = asset.files;
              manifestFiles.forEach(function(file) {
                  if(file) {
                    watchSet[file.path] = asset.tag;
                  }
              });
          }
      });

      var filterFn = function(f, stat) {
        return f.match(watchRegex) && stat.isDirectory() || watchSet[f];
      }

      var reloadFile = function(fileKey) {

          if(!minify) {
              if(fileKey) {
                  fs.readFile(staticAssets[fileKey].path, function (err, data) {
                      if (err) {
                          bosco.log('Error reloading '+fileKey);
                          bosco.log(err.toString());
                          return;
                      }

                      staticAssets[fileKey].data = data;
                      staticAssets[fileKey].content = data.toString();
                      bosco.log('Reloaded ' + fileKey);
                      reloading[fileKey] = false;
                  });
              }
          } else {
              if(fileKey) {
                  bosco.log('Recompiling tag ' + fileKey.blue);
                  var options = {
                    repos: repos,
                    minify: minify,
                    buildNumber: 'local',
                    tagFilter: fileKey,
                    watchBuilds: false,
                    reloadOnly: true
                  }
                  bosco.staticUtils.getStaticAssets(options, function(err, updatedAssets) {
                      // Clear old for tag
                      _.forOwn(staticAssets, function(value, key) {
                          if(value.tag == fileKey) delete staticAssets[key];
                      });
                      // Add new
                      _.forOwn(updatedAssets, function(value, key) {
                          staticAssets[key] = value;
                      });
                      bosco.log('Reloaded minified assets for tag ' + fileKey.blue);
                      reloading[fileKey] = false;
                  });
              }
          }

      }

      watch.createMonitor(bosco.getOrgPath(), {filter: filterFn, ignoreDotFiles: true, ignoreUnreadableDir: true, ignoreDirectoryPattern: /node_modules|\.git|coverage/, interval: 1000}, function (monitor) {

        bosco.log('Watching '+ _.keys(monitor.files).length + ' files ...');

        monitor.on('changed', function (f) {

          var fileKey = watchSet[f];

          if(reloading[fileKey]) return;
          reloading[fileKey] = true;

          reloadFile(fileKey);

        });

      });

    }

    var getAssetForUrl = function(staticAssets, url) {

      if(staticAssets[url]) {
        return staticAssets[url];
      }

      return dynamicBundle(staticAssets, url);

    }

    var dynamicBundle = function(staticAssets, url) {

      /**
       * This is added to allow the local mode to serve bundles in un-minified mode now that
       * the individual items are  prefixed with the bundle name to allow duplication
       * of resources across bundles (a good thing).
       *
       *    https://github.com/tes/bosco/issues/68
       *
       * It very specifically looks for a request for a bundle (css or js only)
       *
       *    app-resource/local/js/adyen.js
       *
       * vs
       *
       *    app-resource/bottom-v2/local/js/ratings.js
       *
       * This is clearly quite brittle, but I can't currently think of a better way
       * short of completely refactoring the entire static asset code to no longer use a
       * map keyed by the asset as the final output.
       *
       * This will work with 'watch' as it always dynamically retrieves the asset content.
       */

      var splitUrl = url.split('/');

      if(splitUrl.length === 4) {

        var serviceName = splitUrl[0];
        var buildName = splitUrl[1];
        var type = splitUrl[2];
        var bundle = splitUrl[3];

        var isBundleRequest = buildName === 'local' && (type === 'js' || type === 'css');

        if(isBundleRequest) {

          var bundleName = splitUrl[3].split('.')[0];
          var bundleContent = '';
          var bundleMimetype = '';

          _.mapValues(staticAssets, function(item) {
            if(item.serviceName === serviceName && item.tag === bundleName && item.type === type) {
              bundleContent += item.content;
              bundleMimetype = bundle.mimeType;
            }
          });

          if(bundleContent) {
            return {
              mimeType: bundleMimetype,
              content: bundleContent
            }
          }

        }

      }

    }

    var getContent = function(asset, next) {
        next(null, asset.data || asset.content);
    }

    if(minify) bosco.log('Minifying front end assets, this can take some time ...');

    var options = {
        repos: repos,
        buildNumber: 'local',
        minify: minify,
        tagFilter: null,
        watchBuilds: true,
        reloadOnly: false,
        watchRegex: watchRegex,
        repoRegex: repoRegex,
        repoTag: repoTag
    }

    var executeAsync = {
        staticAssets: bosco.staticUtils.getStaticAssets.bind(null, options),
        staticRepos: bosco.staticUtils.getStaticRepos.bind(null, options)
    }

    async.parallel(executeAsync, function(err, results){
        startServer(results.staticAssets, results.staticRepos, port);
        startMonitor(results.staticAssets);
    });

}
