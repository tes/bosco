const _ = require('lodash');
const async = require('async');
const fs = require('fs');
const path = require('path');
const http = require('http');
const url = require('url');
const requestLib = require('request');
const RunListHelper = require('../src/RunListHelper');
const StaticUtils = require('../src/StaticUtils');

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
  bosco.staticUtils = bosco.staticUtils || StaticUtils(bosco); // eslint-disable-line no-param-reassign
  const minify = _.includes(args, 'minify');
  const port = bosco.config.get('cdn:port') || 7334;
  const repoPattern = bosco.options.repo;
  const repoRegex = new RegExp(repoPattern);
  const watchPattern = bosco.options.watch || '$a';
  let watchRegex = new RegExp(watchPattern);
  const repoTag = bosco.options.tag;
  let repos;

  bosco.log(`Starting pseudo CDN on port: ${(`${port}`).blue}`);

  if (bosco.options.list) {
    repos = bosco.options.list.split(',');
  } else {
    if (bosco.cmdHelper.checkInService()) {
      bosco.options.watch = bosco.options.watch || new RegExp(bosco.getRepoName()); // eslint-disable-line no-param-reassign
      watchRegex = new RegExp(bosco.options.watch);
    }

    repos = bosco.getRepos();
  }

  if (!repos) return bosco.error('You are repo-less :( You need to initialise bosco first, try \'bosco clone\'.');

  async function getRunList(next) {
    try {
      next(null, await RunListHelper.getRunList(bosco, repos, repoRegex, watchRegex, repoTag, false));
    } catch (err) {
      next(err);
    }
  }

  function startServer(staticAssets, staticRepos, serverPort) {
    const isWatchedFile = (asset) => {
      const hasSourceFiles = asset.sourceFiles && asset.sourceFiles.length > 0;
      const assetPath = hasSourceFiles ? asset.sourceFiles[0] : asset.path;
      let watched;
      try {
        watched = assetPath && !fs.lstatSync(assetPath).isDirectory() && assetPath.match(watchRegex);
      } catch (ex) {
        watched = false;
      }
      return watched;
    };

    function getAsset(assetUrl) {
      const key = assetUrl.replace('/', '');
      return _.find(staticAssets, { assetKey: key });
    }

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Credentials': true,
      'Access-Control-Max-Age': '86400', // 24 hours
      'Access-Control-Allow-Headers': 'X-Requested-With, Access-Control-Allow-Origin, X-HTTP-Method-Override, Content-Type, Authorization, Accept',
    };

    const server = http.createServer((request, response) => {
      if (request.method === 'OPTIONS') {
        response.writeHead(200, corsHeaders);
        return response.end();
      }

      const headers = {
        'Cache-Control': 'no-cache, must-revalidate',
        Pragma: 'no-cache',
        Expires: 'Sat, 21 May 1952 00:00:00 GMT',
        'Access-Control-Allow-Origin': '*',
      };

      const { pathname } = url.parse(request.url);
      if (pathname === '/repos') {
        headers['Content-Type'] = 'text/html';
        response.writeHead(200, headers);
        return response.end(staticRepos.formattedRepos);
      }

      const isLibraryAsset = pathname.indexOf('/vendor/library/') >= 0;
      /*
        Path matches something that is service-name/build e.g:
        - /app-home/720/css/logged-in.css
        - /app-home/ec701e5/css/logged-in.css

        but not what bundle-version gives us locally:
        - /app-home/local/css/logged-in.css
      */
      const isRemoteAsset = pathname.match(/^\/([^/]+)\/(?!local)([^/]+)\//);
      const serveRemoteAsset = isRemoteAsset || (isLibraryAsset && !bosco.options.localVendor);
      if (serveRemoteAsset) {
        const baseCdn = bosco.config.get('cdn:remoteUrl') || 'https://duqxiy1o2cbw6.cloudfront.net/tes';
        const cdnUrl = baseCdn + pathname;
        const localCacheFolder = path.join(bosco.findConfigFolder(), 'cache');
        const cachePrefix = 'v1-';
        const localCacheFile = path.join(localCacheFolder, `${cachePrefix + pathname.replace(/\//g, '_')}.json`);

        // Ensure local cache folder exists
        if (!fs.existsSync(localCacheFolder)) {
          fs.mkdirSync(localCacheFolder);
        }

        const useLocalCacheFile = !bosco.options.nocache && fs.existsSync(localCacheFile);

        let responseContent;
        if (useLocalCacheFile) {
          const cacheContent = require(localCacheFile); // eslint-disable-line global-require,import/no-dynamic-require
          response.writeHead(200, cacheContent.headers);
          responseContent = cacheContent.isBinary ? Buffer.from(cacheContent.body, 'base64') : cacheContent.body;
          response.end(responseContent);
        } else {
          const baseBoscoCdnUrl = bosco.getBaseCdnUrl();
          requestLib.get({
            uri: cdnUrl, gzip: true, timeout: 5000, encoding: null,
          }, (err, cdnResponse, body) => { // body is a buffer
            if (err) {
              bosco.error(`Error proxying asset for: ${cdnUrl}, Error: ${err.message}`);
              response.writeHead(500);
              return response.end();
            }
            const contentType = cdnResponse.headers['content-type'];
            responseContent = body;

            if (contentType === 'text/css' || contentType === 'application/javascript') {
              responseContent = body.toString();
              // We want to convert all of the in content urls to local bosco ones to take advantage of offline caching
              // For the js / css files contained within the html fragments for remote services
              responseContent = responseContent.replace(new RegExp(baseCdn, 'g'), baseBoscoCdnUrl);
            }

            const responseHeaders = _.defaults({
              'content-type': contentType,
              'content-length': Buffer.byteLength(responseContent),
            }, corsHeaders);

            response.writeHead(200, responseHeaders);
            response.end(responseContent);

            const cacheContentToSave = {
              headers: responseHeaders,
              body: typeof responseContent === 'string' ? responseContent : responseContent.toString('base64'),
              isBinary: typeof responseContent !== 'string',
            };
            fs.writeSync(fs.openSync(localCacheFile, 'w'), JSON.stringify(cacheContentToSave, null, 2));
          });
        }
        return 'served-remote';
      }

      const asset = getAsset(pathname);
      if (!asset) {
        headers['Content-Type'] = 'text/html';
        response.writeHead(404, headers);
        return staticAssets ? response.end(staticAssets.formattedAssets) : response.end();
      }

      headers['content-Type'] = asset.mimeType;
      response.writeHead(200, headers);

      const hasSourceFiles = asset.sourceFiles && asset.sourceFiles.length > 0;

      if (isWatchedFile(asset)) {
        if (hasSourceFiles && !minify) {
          async.reduce(asset.sourceFiles, '', (memo, item, callback) => {
            fs.readFile(item, (err, content) => {
              callback(null, memo + content);
            });
          }, (err, content) => {
            response.end(content);
          });
        } else {
          fs.readFile(asset.path, (err, content) => {
            response.end(content);
          });
        }
      } else {
        response.end(asset.data || asset.content);
      }
    });

    server.listen(serverPort);

    bosco.log(`Server is listening on ${serverPort}`);
  }

  function watchCallback(err, service) {
    if (err) { return bosco.error(err); }
    bosco.log(`Local CDN ready after build for service: ${service.name.green}`);
  }

  if (minify) bosco.log('Running per service builds for front end assets, this can take some time ...');

  getRunList((runListErr, repoList) => {
    const repoNames = _.map(repoList, 'name');
    const options = {
      repos: repoNames,
      buildNumber: 'local',
      minify,
      tagFilter: null,
      watchBuilds: true,
      reloadOnly: false,
      ignoreFailure: true,
      watchRegex,
      repoRegex,
      repoTag,
      watchCallback,
      isCdn: true,
    };

    const executeAsync = {
      staticAssets: bosco.staticUtils.getStaticAssets.bind(null, options),
      staticRepos: bosco.staticUtils.getStaticRepos.bind(null, options),
    };

    async.parallel(executeAsync, (err, results) => {
      startServer(results.staticAssets, results.staticRepos, port);
    });
  });
}

module.exports.cmd = cmd;
