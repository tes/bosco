var fs = require('fs');
var path = require('path');
var _ = require('lodash');
var async = require('async');
var glob = require('glob');
var getAssetHelperFactory = require('./getAssetHelper');
var getMinify = require('./getMinify');
var ExternalBuild = require('./ExternalBuild');

module.exports = function (bosco) {
  var getAssetHelper = getAssetHelperFactory(bosco);
  var minify = getMinify(bosco);
  var doBuildWithInterpreter = ExternalBuild(bosco).doBuildWithInterpreter;
  var html = require('./Html')(bosco);
  var createAssetHtmlFiles = html.createAssetHtmlFiles;
  var attachFormattedRepos = html.attachFormattedRepos;

  function loadService(repo, next) {
    var repoPath = bosco.getRepoPath(repo);
    var boscoRepoConfig = path.join(repoPath, 'bosco-service.json');
    var repoPackageFile = path.join(repoPath, 'package.json');
    var boscoRepo = {};
    var boscoConfig;

    boscoRepo.name = repo;
    boscoRepo.path = repoPath;
    boscoRepo.repoPath = repoPath;

    if (bosco.exists(boscoRepoConfig)) {
      boscoConfig = JSON.parse(fs.readFileSync(boscoRepoConfig)) || {};
      boscoRepo = _.merge(boscoRepo, boscoConfig);
      boscoRepo.serviceName = boscoRepo.service && boscoRepo.service.name ? boscoRepo.service.name : repo;
      if (boscoRepo.assets && boscoRepo.assets.basePath) {
        boscoRepo.basePath = boscoRepo.assets.basePath;
      }
    }

    if (bosco.exists(repoPackageFile)) {
      boscoRepo.info = JSON.parse(fs.readFileSync(repoPackageFile) || {});
    }

    next(null, boscoRepo);
  }

  function globAsset(assetGlob, basePath) {
    var resolvedBasePath = path.resolve(basePath);
    var assets = glob.sync(assetGlob, { cwd: resolvedBasePath, nodir: true });
    return assets;
  }

  function createAssetList(boscoRepo, buildNumber, minified, tagFilter, warnMissing, next) {
    var assetHelper = getAssetHelper(boscoRepo, tagFilter);
    var fileTypesWhitelist = bosco.options.fileTypesWhitelist;
    var staticAssets = [];
    var assetKey;
    var assetBasePath;
    var minificationConfig = {};

    if (boscoRepo.assets) {
      assetBasePath = boscoRepo.assets.basePath || '.';
      minificationConfig = {
        alreadyMinified: !!boscoRepo.assets.alreadyMinified,
        sourceMapExtension: boscoRepo.assets.sourceMapExtension || '.map'
      };
      _.forEach(_.pick(boscoRepo.assets, fileTypesWhitelist), function (assets, type) {
        _.forOwn(assets, function (value, tag) {
          if (!value) return;
          _.forEach(value, function (potentialAsset) {
            var globbedAssets = globAsset(potentialAsset, path.join(boscoRepo.path, assetBasePath));
            if (globbedAssets.length === 0) {
              var noMatchError = path.join(assetBasePath, potentialAsset) + ': No matching files found.';
              if (warnMissing) { bosco.warn(noMatchError); }
              assetHelper.addError(staticAssets, tag, noMatchError);
            }
            _.forEach(globbedAssets, function (asset) {
              assetKey = path.join(boscoRepo.serviceName, buildNumber, asset);
              assetHelper.addAsset(staticAssets, buildNumber, assetKey, asset, tag, type, assetBasePath, true, minificationConfig);
            });
          });
        });
      });
    }

    if (boscoRepo.files) {
      _.forOwn(boscoRepo.files, function (assetTypes, tag) {
        assetBasePath = assetTypes.basePath || '.';
        minificationConfig = {
          alreadyMinified: !!assetTypes.alreadyMinified,
          sourceMapExtension: assetTypes.sourceMapExtension || '.map'
        };
        _.forEach(_.pick(assetTypes, fileTypesWhitelist), function (value, type) {
          if (!value) return;
          _.forEach(value, function (potentialAsset) {
            var assets = globAsset(potentialAsset, path.join(boscoRepo.path, assetBasePath));
            if (assets.length === 0) {
              var warning = path.join(assetBasePath, potentialAsset) + ': No matching files found.';
              if (warnMissing) { bosco.warn(warning); }
              assetHelper.addError(staticAssets, tag, warning);
            }
            _.forEach(assets, function (asset) {
              assetKey = path.join(boscoRepo.serviceName, buildNumber, asset);
              assetHelper.addAsset(staticAssets, buildNumber, assetKey, asset, tag, type, assetBasePath, true, minificationConfig);
            });
          });
        });
      });
    }

    if (boscoRepo.libraries) {
      _.forEach(boscoRepo.libraries, function (library) {
        var assets = globAsset(library.glob, path.join(boscoRepo.path, library.basePath));
        _.forEach(assets, function (asset) {
          assetKey = path.join('vendor', 'library', asset);
          assetHelper.addAsset(staticAssets, 'library', assetKey, asset, 'vendor', 'library', library.basePath, true, { alreadyMinified: true });
        });
      });
    }

    if (boscoRepo.siteAssets) {
      _.forEach(boscoRepo.siteAssets, function (siteAsset) {
        var assets = globAsset(siteAsset.glob, path.join(boscoRepo.path, siteAsset.basePath));
        _.forEach(assets, function (asset) {
          assetKey = path.join('asset', asset);
          assetHelper.addAsset(staticAssets, 'asset', assetKey, asset, 'site', 'asset', siteAsset.basePath, true, { alreadyMinified: true });
        });
      });
    }

    next(null, staticAssets);
  }

  function shouldBuildService(assets) {
    var allAssetsExist = _.reduce(_.map(assets, 'assetExists'), function (allExist, exists) { return allExist && exists; }, true);
    return !allAssetsExist;
  }

  function getStaticAssets(options, next) {
    var repoTag = options.repoTag;
    var ignoreFailure = options.ignoreFailure;
    var failedBuilds = [];

    async.map(options.repos, loadService, function (err, services) {
      if (err) return next(err);

      // Remove any service that doesnt have an assets child
      // or doesn't match repo tag
      var assetServices = _.filter(services, function (service) {
        return (!repoTag || _.includes(service.tags, repoTag))
          && (service.assets || service.files) && service.name.match(options.repoRegex);
      });

      async.mapLimit(assetServices, bosco.concurrency.cpu, function (service, cb) {
        createAssetList(service, options.buildNumber, options.minify, options.tagFilter, false, function (err, preBuildAssets) {
          doBuildWithInterpreter(service, options, shouldBuildService(preBuildAssets), function (err) {
            if (err) {
              if (!ignoreFailure) return cb(err);
              failedBuilds.push({ name: service.name, err: err });
            }
            // Do this a second time to
            createAssetList(service, options.buildNumber, options.minify, options.tagFilter, true, function (err, assets) {
              if (err) {
                if (!ignoreFailure) return cb(err);
                failedBuilds.push({ name: service.name, err: err });
              }
              cb(null, assets);
            });
          });
        });
      }, function (err, assetList) {
        if (err && !ignoreFailure) return next(err);

        var buildCount = assetList.length;
        var failedBuildCount = failedBuilds.length;
        var succeededBuildCount = buildCount - failedBuilds.length;

        bosco.console.log();
        bosco.log(succeededBuildCount + ' out of ' + buildCount + ' succeeded.');
        if (failedBuildCount) {
          bosco.error(failedBuildCount + ' out of ' + buildCount + ' failed:');
          _.forEach(failedBuilds, function (data) {
            var message = data.err.message.replace(/^\s+|\s+$/g, '');
            bosco.error(data.name.red + ': ' + message);
          });
        }

        var staticAssets = _.compact(_.flatten(assetList));

        if (staticAssets.length === 0) {
          return next();
        }

        var concatenateOnly = !options.minify;
        minify(staticAssets, concatenateOnly, function (err, minifiedAssets) {
          if (err && !ignoreFailure) return next(err);
          createAssetHtmlFiles(minifiedAssets, options.isCdn, next);
        });
      });
    });
  }

  function getStaticRepos(options, next) {
    async.map(options.repos, loadService, function (err, repos) {
      if (err) return next(err);
      attachFormattedRepos(repos, next);
    });
  }

  return {
    getStaticAssets: getStaticAssets,
    getStaticRepos: getStaticRepos
  };
};
