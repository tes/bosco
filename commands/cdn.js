var _ = require('lodash');
var async = require('async');
var fs = require('fs');
var http = require('http');
var watch = require('watch');
var url = require('url');
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
  }],
};

function cmd(bosco, args) {
  var minify = _.contains(args, 'minify');
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
    var onWorkspaceFolder = bosco.options.workspace === process.cwd();
    var hasDefaultRepoOption = !bosco.options.repo || CmdHelper.isDefaulOption('repo', bosco.options.repo);
    var hasDefaultTagOption = !bosco.options.tag || CmdHelper.isDefaulOption('tag', bosco.options.tag);

    // Tag and repo options take precendence over cwd
    if (!onWorkspaceFolder && hasDefaultRepoOption && hasDefaultTagOption) {
      bosco.options.service = true;
      bosco.checkInService();
    }

    repos = bosco.getRepos();
  }

  if (!repos) return bosco.error('You are repo-less :( You need to initialise bosco first, try \'bosco clone\'.');

  function getRunList(next) {
    RunListHelper.getRunList(bosco, repos, repoRegex, watchRegex, repoTag, next);
  }

  function startServer(staticAssets, staticRepos, serverPort) {
    var isAsset = function(path) {
      return path && !fs.lstatSync(path).isDirectory();
    };

    function getAsset(assetUrl) {
      var key = assetUrl.replace('/', '');
      return _.find(staticAssets, 'assetKey', key);
    }

    var server = http.createServer(function(request, response) {
      if (request.method === 'OPTIONS') {
        response.writeHead(200, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, GET, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Credentials': true,
          'Access-Control-Max-Age': '86400', // 24 hours
          'Access-Control-Allow-Headers': 'X-Requested-With, Access-Control-Allow-Origin, X-HTTP-Method-Override, Content-Type, Authorization, Accept',
        });
        return response.end();
      }

      var pathname = url.parse(request.url).pathname;
      if (pathname === '/repos') {
        response.writeHead(200, {'Content-Type': 'text/html'});
        return response.end(staticRepos.formattedRepos);
      }

      var asset = getAsset(pathname);
      if (!asset) {
        response.writeHead(404, {'Content-Type': 'text/html'});
        return response.end(staticAssets.formattedAssets);
      }

      response.writeHead(200, {
        'Content-Type': asset.mimeType,
        'Cache-Control': 'no-cache, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': 'Sat, 21 May 1952 00:00:00 GMT',
        'Access-Control-Allow-Origin': '*',
      });

      if (isAsset(asset.path)) {
        fs.readFile(asset.path, function(err, content) {
          response.end(content);
        });
      } else {
        response.end(asset.content || asset.data);
      }
    });

    server.listen(serverPort);

    if (bosco.options['browser-sync']) {
      var assets = _.filter(_.map(staticAssets, 'path'), isAsset);
      bs.init({
        proxy: bosco.options['browser-sync-proxy'] || 'http://local.tescloud.com:5000',
        files: assets,
      });
    }

    bosco.log('Server is listening on ' + serverPort);
  }

  function startMonitor(staticAssets) {
    var watchSet = {};
    var reloading = {};

    _.forEach(staticAssets, function(asset) {
      if (asset.repo && !asset.repo.match(watchRegex)) return;

      if (minify && asset.extname === '.manifest') {
        asset.files.forEach(function(file) {
          if (file) watchSet[file.path] = asset.tag;
        });
        return;
      }

      if (asset.path) watchSet[asset.path] = asset.assetKey;
    });

    function filterFn(f, stat) {
      return f.match(watchRegex) && stat.isDirectory() || watchSet[f];
    }

    function getIndexForKey(assetList, fileKey) {
      var find = (_.isObject(assetList)) ? _.findKey : _.findIndex;
      return find(assetList, 'assetKey', fileKey);
    }

    function reloadFile(fileKey) {
      if (!fileKey) return;

      if (!minify) {
        var assetIndex = getIndexForKey(staticAssets, fileKey);
        if (!assetIndex) {
          bosco.error('Unable to locate asset with key: ' + fileKey);
          return;
        }
        fs.readFile(staticAssets[assetIndex].path, function(err, data) {
          if (err) {
            bosco.log('Error reloading ' + fileKey);
            bosco.log(err.toString());
            return;
          }
          staticAssets[assetIndex].data = data;
          staticAssets[assetIndex].content = data.toString();
          bosco.log('Reloaded ' + fileKey);
          reloading[fileKey] = false;
        });
        return;
      }

      bosco.log('Recompiling tag ' + fileKey.blue);
      var staticAssetOptions = {
        repos: repos,
        minify: minify,
        buildNumber: 'local',
        tagFilter: fileKey,
        watchBuilds: false,
        reloadOnly: true,
      };
      bosco.staticUtils.getStaticAssets(staticAssetOptions, function(err, updatedAssets) {
        _.forEach(updatedAssets, function(value) {
          var index = getIndexForKey(staticAssets, value.assetKey);
          staticAssets[index] = value;
        });
        bosco.log('Reloaded minified assets for tag ' + fileKey.blue);
        reloading[fileKey] = false;
      });
    }

    watch.createMonitor(bosco.getOrgPath(), {filter: filterFn, ignoreDotFiles: true, ignoreUnreadableDir: true, ignoreDirectoryPattern: /node_modules|\.git|coverage/, interval: 1000}, function(monitor) {
      bosco.log('Watching ' + _.keys(monitor.files).length + ' files ...');

      function onChange(f) {
        var fileKey = watchSet[f];

        if (reloading[fileKey]) return;
        reloading[fileKey] = true;
        reloadFile(fileKey);
      }

      monitor.on('changed', onChange);
      monitor.on('created', onChange);
    });
  }

  if (minify) bosco.log('Minifying front end assets, this can take some time ...');

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
    };

    var executeAsync = {
      staticAssets: bosco.staticUtils.getStaticAssets.bind(null, options),
      staticRepos: bosco.staticUtils.getStaticRepos.bind(null, options),
    };

    async.parallel(executeAsync, function(err, results) {
      startServer(results.staticAssets, results.staticRepos, port);
      startMonitor(results.staticAssets);
    });
  });
}

module.exports.cmd = cmd;
