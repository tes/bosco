const fs = require('fs');
const path = require('path');
const mime = require('mime');
const sf = require('sf');
const checksum = require('./assetChecksum');

module.exports = function AssetHelper(bosco) {
  function resolve(boscoRepo, basePath, asset, assetKey) {
    const resolvedPath = path.join(boscoRepo.path, basePath, asset);

    if (!fs.existsSync(resolvedPath)) {
      return bosco.warn(sf('Asset {asset} not found at path {path}, declared in {repo}', {
        asset: assetKey,
        path: resolvedPath,
        repo: boscoRepo.name,
      }));
    }

    return resolvedPath;
  }

  function getAssetHelper(boscoRepo, tagFilter) {
    return {
      addAsset(staticAssets, buildNumber, assetKey, asset, tag, type, basePath, externalBuild, minificationConfig) {
        if (tagFilter && tag !== tagFilter) return;

        const newAsset = {};
        const resolvedPath = resolve(boscoRepo, basePath, asset, assetKey);

        if (resolvedPath) {
          newAsset.serviceName = boscoRepo.serviceName;
          newAsset.buildNumber = buildNumber;
          newAsset.mimeType = mime.getType(asset);
          newAsset.assetKey = assetKey;
          newAsset.asset = asset;
          newAsset.externalBuild = externalBuild;
          newAsset.repoPath = boscoRepo.repoPath;
          newAsset.basePath = path.join(newAsset.repoPath, basePath);
          newAsset.relativePath = path.join('.', basePath || '', asset);
          newAsset.path = resolvedPath;
          newAsset.fileName = path.basename(asset);
          newAsset.extname = path.extname(asset);
          newAsset.bundleKey = `${boscoRepo.serviceName}/${tag}`;
          newAsset.tag = tag;
          newAsset.repo = boscoRepo.name;
          newAsset.type = type;
          newAsset.tagType = `${tag}.${type}`;
          try {
            newAsset.data = fs.readFileSync(newAsset.path);
            newAsset.content = newAsset.data.toString();
            newAsset.assetExists = true;
          } catch (ex) {
            newAsset.data = '';
            newAsset.content = '';
            newAsset.assetExists = false;
          }
          newAsset.checksum = checksum(newAsset.content, 'sha1', 'hex');
          newAsset.uniqueKey = `${newAsset.bundleKey}:${assetKey}`;
          newAsset.minificationConfig = minificationConfig;
          staticAssets.push(newAsset);
        }
      },
      addError(staticAssets, tag, message) {
        const newAsset = {};
        newAsset.serviceName = boscoRepo.serviceName;
        newAsset.assetKey = 'formattedAssets';
        newAsset.bundleKey = `${boscoRepo.serviceName}/${tag}`;
        newAsset.buildNumber = '';
        newAsset.tag = tag;
        newAsset.repo = boscoRepo.name;
        newAsset.type = 'error';
        newAsset.repoPath = boscoRepo.repoPath;
        newAsset.basePath = boscoRepo.repoPath;
        newAsset.relativePath = boscoRepo.repoPath;
        newAsset.path = boscoRepo.repoPath;
        newAsset.message = message;
        newAsset.content = '';
        staticAssets.push(newAsset);
      },
    };
  }

  return getAssetHelper;
};
