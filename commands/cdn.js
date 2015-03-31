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

            var asset = getAsset(staticAssets, url);

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

    var getAsset = function(staticAssets, url) {
      return _.filter(staticAssets, function(item) {
        if(item.assetKey === url) {
          return item;
        }
      })[0];
    }

    var startMonitor = function(staticAssets) {

      var watchSet = {}, reloading = {};

      _.forEach(staticAssets, function(asset) {
          var key = asset.assetKey;
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

      var getIndexForKey = function(assetList, fileKey) {
        var foundKey;
        _.forEach(assetList, function(asset, key) {
          if(asset.assetKey === fileKey) {
            foundKey = key;
          }
        });
        return foundKey;
      }

      var reloadFile = function(fileKey) {
          if(!minify) {
              if(fileKey) {

                  var assetIndex = getIndexForKey(staticAssets, fileKey);
                  if(!assetIndex) {
                    bosco.error('Unable to locate asset with key: ' + fileKey);
                    return;
                  }
                  fs.readFile(staticAssets[assetIndex].path, function (err, data) {
                      if (err) {
                          bosco.log('Error reloading '+fileKey);
                          bosco.log(err.toString());
                          return;
                      }
                      staticAssets[assetIndex].data = data;
                      staticAssets[assetIndex].content = data.toString();
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
                      _.forEach(updatedAssets, function(value) {
                          var index = getIndexForKey(staticAssets, value.assetKey);
                          staticAssets[index] = value;
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
