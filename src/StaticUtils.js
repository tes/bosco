const fs = require('fs');
const path = require('path');
const _ = require('lodash');
const async = require('async');
const glob = require('glob');
const getAssetHelperFactory = require('./getAssetHelper');
const getMinify = require('./getMinify');
const ExternalBuild = require('./ExternalBuild');
const Html = require('./Html');

module.exports = function StaticUtils(bosco) {
  const getAssetHelper = getAssetHelperFactory(bosco);
  const minify = getMinify(bosco);
  const { doBuildWithInterpreter } = ExternalBuild(bosco);
  const html = Html(bosco);
  const { createAssetHtmlFiles } = html;
  const { attachFormattedRepos } = html;

  function loadService(repo, next) {
    const repoPath = bosco.getRepoPath(repo);
    const boscoRepoConfig = path.join(repoPath, 'bosco-service.json');
    const repoPackageFile = path.join(repoPath, 'package.json');
    let boscoRepo = {};
    let boscoConfig;

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
    const resolvedBasePath = path.resolve(basePath);
    const assets = glob.sync(assetGlob, { cwd: resolvedBasePath, nodir: true });
    return assets;
  }

  function createAssetList(boscoRepo, buildNumber, minified, tagFilter, warnMissing, next) {
    const assetHelper = getAssetHelper(boscoRepo, tagFilter);
    const { fileTypesWhitelist } = bosco.options;
    const staticAssets = [];
    let assetKey;
    let assetBasePath;
    let minificationConfig = {};

    if (boscoRepo.assets) {
      assetBasePath = boscoRepo.assets.basePath || '.';
      minificationConfig = {
        alreadyMinified: !!boscoRepo.assets.alreadyMinified,
        sourceMapExtension: boscoRepo.assets.sourceMapExtension || '.map',
      };
      _.forEach(_.pick(boscoRepo.assets, fileTypesWhitelist), (assets, type) => {
        _.forOwn(assets, (value, tag) => {
          if (!value) return;
          _.forEach(value, (potentialAsset) => {
            const globbedAssets = globAsset(potentialAsset, path.join(boscoRepo.path, assetBasePath));
            if (globbedAssets.length === 0) {
              const noMatchError = `${path.join(assetBasePath, potentialAsset)}: No matching files found.`;
              if (warnMissing) { bosco.warn(noMatchError); }
              assetHelper.addError(staticAssets, tag, noMatchError);
            }
            _.forEach(globbedAssets, (asset) => {
              assetKey = path.join(boscoRepo.serviceName, buildNumber, asset);
              assetHelper.addAsset(staticAssets, buildNumber, assetKey, asset, tag, type, assetBasePath, true, minificationConfig);
            });
          });
        });
      });
    }

    if (boscoRepo.files) {
      _.forOwn(boscoRepo.files, (assetTypes, tag) => {
        assetBasePath = assetTypes.basePath || '.';
        minificationConfig = {
          alreadyMinified: !!assetTypes.alreadyMinified,
          sourceMapExtension: assetTypes.sourceMapExtension || '.map',
        };
        _.forEach(_.pick(assetTypes, fileTypesWhitelist), (value, type) => {
          if (!value) return;
          _.forEach(value, (potentialAsset) => {
            const assets = globAsset(potentialAsset, path.join(boscoRepo.path, assetBasePath));
            if (assets.length === 0) {
              const warning = `${path.join(assetBasePath, potentialAsset)}: No matching files found.`;
              if (warnMissing) { bosco.warn(warning); }
              assetHelper.addError(staticAssets, tag, warning);
            }
            _.forEach(assets, (asset) => {
              assetKey = path.join(boscoRepo.serviceName, buildNumber, asset);
              assetHelper.addAsset(staticAssets, buildNumber, assetKey, asset, tag, type, assetBasePath, true, minificationConfig);
            });
          });
        });
      });
    }

    if (boscoRepo.libraries) {
      _.forEach(boscoRepo.libraries, (library) => {
        const assets = globAsset(library.glob, path.join(boscoRepo.path, library.basePath));
        _.forEach(assets, (asset) => {
          assetKey = path.join('vendor', 'library', asset);
          assetHelper.addAsset(staticAssets, 'library', assetKey, asset, 'vendor', 'library', library.basePath, true, { alreadyMinified: true });
        });
      });
    }

    if (boscoRepo.siteAssets) {
      _.forEach(boscoRepo.siteAssets, (siteAsset) => {
        const assets = globAsset(siteAsset.glob, path.join(boscoRepo.path, siteAsset.basePath));
        _.forEach(assets, (asset) => {
          assetKey = path.join('asset', asset);
          assetHelper.addAsset(staticAssets, 'asset', assetKey, asset, 'site', 'asset', siteAsset.basePath, true, { alreadyMinified: true });
        });
      });
    }

    next(null, staticAssets);
  }

  function shouldBuildService(assets) {
    const allAssetsExist = _.reduce(_.map(assets, 'assetExists'), (allExist, exists) => allExist && exists, true);
    return !allAssetsExist;
  }

  function getStaticAssets(options, next) {
    const { repoTag } = options;
    const { ignoreFailure } = options;
    const failedBuilds = [];

    async.map(options.repos, loadService, (loadServiceErr, services) => {
      if (loadServiceErr) return next(loadServiceErr);

      // Remove any service that doesnt have an assets child
      // or doesn't match repo tag
      const assetServices = _.filter(services, (service) => (!repoTag || _.includes(service.tags, repoTag))
          && (service.assets || service.files) && service.name.match(options.repoRegex));

      async.mapLimit(assetServices, bosco.concurrency.cpu, (service, cb) => {
        createAssetList(service, options.buildNumber, options.minify, options.tagFilter, false, (createAssetListErr, preBuildAssets) => {
          doBuildWithInterpreter(service, options, shouldBuildService(preBuildAssets), (doBuildWithInterpreterErr) => {
            if (doBuildWithInterpreterErr) {
              if (!ignoreFailure) return cb(doBuildWithInterpreterErr);
              failedBuilds.push({ name: service.name, err: doBuildWithInterpreterErr });
            }
            // Do this a second time to
            createAssetList(service, options.buildNumber, options.minify, options.tagFilter, true, (err, assets) => {
              if (err) {
                if (!ignoreFailure) return cb(err);
                failedBuilds.push({ name: service.name, err });
              }
              cb(null, assets);
            });
          });
        });
      }, (err, assetList) => {
        if (err && !ignoreFailure) return next(err);

        const buildCount = assetList.length;
        const failedBuildCount = failedBuilds.length;
        const succeededBuildCount = buildCount - failedBuilds.length;

        bosco.console.log();
        bosco.log(`${succeededBuildCount} out of ${buildCount} succeeded.`);
        if (failedBuildCount) {
          bosco.error(`${failedBuildCount} out of ${buildCount} failed:`);
          _.forEach(failedBuilds, (data) => {
            const message = data.err.message.replace(/^\s+|\s+$/g, '');
            bosco.error(`${data.name.red}: ${message}`);
          });
        }

        const staticAssets = _.compact(_.flatten(assetList));

        if (staticAssets.length === 0) {
          return next();
        }

        const concatenateOnly = !options.minify;
        minify(staticAssets, concatenateOnly, (minifyErr, minifiedAssets) => {
          if (minifyErr && !ignoreFailure) return next(minifyErr);
          createAssetHtmlFiles(minifiedAssets, options.isCdn, next);
        });
      });
    });
  }

  function getStaticRepos(options, next) {
    async.map(options.repos, loadService, (err, repos) => {
      if (err) return next(err);
      attachFormattedRepos(repos, next);
    });
  }

  return {
    getStaticAssets,
    getStaticRepos,
  };
};
