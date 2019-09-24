var _ = require('lodash');
var hb = require('handlebars');
var fs = require('fs');
var createKey = require('./assetCreateKey');

module.exports = function (bosco) {
  function isJavascript(asset) {
    if (asset.type !== 'js') return false;
    if (asset.extname !== '.js') return false;

    return true;
  }

  function isStylesheet(asset) {
    return asset.type === 'css';
  }

  function isMinified(asset) {
    return asset.path === ('minified-js' || 'minified-css');
  }

  function formattedAssets(staticAssets) {
    var assets = { services: [] };
    var templateContent = fs.readFileSync(__dirname + '/../templates/assetList.html');
    var template = hb.compile(templateContent.toString());

    var assetsByService = _.groupBy(staticAssets, 'serviceName');

    _.forOwn(assetsByService, function (serviceAssets, serviceName) {
      var service = { serviceName: serviceName, bundles: [] };
      var bundlesByTag = _.groupBy(serviceAssets, 'tag');
      _.forOwn(bundlesByTag, function (bundleAssets, bundleTag) {
        _.forEach(bundleAssets, function (asset) {
          asset.url = bosco.getAssetCdnUrl(asset.assetKey);
        });
        var bundle = { bundle: bundleTag, assets: bundleAssets };
        service.bundles.push(bundle);
      });
      assets.services.push(service);
    });

    assets.user = bosco.config.get('github:user');
    assets.date = (new Date()).toString();

    return template(assets);
  }

  function formattedRepos(repos) {
    var templateContent = fs.readFileSync(__dirname + '/../templates/repoList.html');
    var template = hb.compile(templateContent.toString());
    var templateData = { repos: repos };

    templateData.user = bosco.config.get('github:user');
    templateData.date = (new Date()).toString();

    return template(templateData);
  }

  function attachFormattedRepos(repos, next) {
    repos.formattedRepos = formattedRepos(repos);
    next(null, repos);
  }

  function createAssetHtmlFiles(staticAssets, isCdn, next) {
    var htmlAssets = {};

    _.forEach(staticAssets, function (asset) {
      var htmlFile = createKey(asset.serviceName, asset.buildNumber, asset.tag, asset.type, 'html', 'html');

      if (!isJavascript(asset) && !isStylesheet(asset)) return;

      htmlAssets[htmlFile] = htmlAssets[htmlFile] || {
        content: '',
        type: 'html',
        asset: htmlFile,
        repo: asset.serviceName,
        serviceName: asset.serviceName,
        buildNumber: asset.buildNumber,
        tag: asset.tag,
        assetType: asset.type,
        assetKey: htmlFile,
        relativePath: 'cx-html-fragment',
        isMinifiedFragment: true,
        mimeType: 'text/html',
        extname: '.html',
        extraFiles: asset.extraFiles
      };

      if (isCdn && isMinified(asset)) return;

      if (isJavascript(asset)) {
        htmlAssets[htmlFile].content += _.template('<script src="<%= url %>"></script>\n')({
          url: bosco.getAssetCdnUrl(asset.assetKey)
        });
      }

      if (isStylesheet(asset)) {
        htmlAssets[htmlFile].content += _.template('<link rel="stylesheet" href="<%=url %>" type="text/css" media="all" />\n')({
          url: bosco.getAssetCdnUrl(asset.assetKey)
        });
      }
    });

    var allStaticAssets = _.union(_.values(htmlAssets), staticAssets);

    allStaticAssets.formattedAssets = formattedAssets(allStaticAssets);

    next(null, allStaticAssets);
  }

  return {
    createAssetHtmlFiles: createAssetHtmlFiles,
    attachFormattedRepos: attachFormattedRepos
  };
};
