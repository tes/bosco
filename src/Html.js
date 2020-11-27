const _ = require('lodash');
const hb = require('handlebars');
const fs = require('fs');
const createKey = require('./assetCreateKey');

module.exports = function Html(bosco) {
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
    const assets = { services: [] };
    const templateContent = fs.readFileSync(`${__dirname}/../templates/assetList.html`);
    const template = hb.compile(templateContent.toString());

    const assetsByService = _.groupBy(staticAssets, 'serviceName');

    _.forOwn(assetsByService, (serviceAssets, serviceName) => {
      const service = { serviceName, bundles: [] };
      const bundlesByTag = _.groupBy(serviceAssets, 'tag');
      _.forOwn(bundlesByTag, (bundleAssets, bundleTag) => {
        _.forEach(bundleAssets, (asset) => {
          asset.url = bosco.getAssetCdnUrl(asset.assetKey); // eslint-disable-line no-param-reassign
        });
        const bundle = { bundle: bundleTag, assets: bundleAssets };
        service.bundles.push(bundle);
      });
      assets.services.push(service);
    });

    assets.user = bosco.config.get('github:user');
    assets.date = (new Date()).toString();

    return template(assets);
  }

  function formattedRepos(repos) {
    const templateContent = fs.readFileSync(`${__dirname}/../templates/repoList.html`);
    const template = hb.compile(templateContent.toString());
    const templateData = { repos };

    templateData.user = bosco.config.get('github:user');
    templateData.date = (new Date()).toString();

    return template(templateData);
  }

  function attachFormattedRepos(repos, next) {
    repos.formattedRepos = formattedRepos(repos);// eslint-disable-line no-param-reassign
    next(null, repos);
  }

  function createAssetHtmlFiles(staticAssets, isCdn, next) {
    const htmlAssets = {};

    _.forEach(staticAssets, (asset) => {
      const htmlFile = createKey(asset.serviceName, asset.buildNumber, asset.tag, asset.type, 'html', 'html');

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
        extraFiles: asset.extraFiles,
      };

      if (isCdn && isMinified(asset)) return;

      if (isJavascript(asset)) {
        htmlAssets[htmlFile].content += _.template('<script src="<%= url %>"></script>\n')({
          url: bosco.getAssetCdnUrl(asset.assetKey),
        });
      }

      if (isStylesheet(asset)) {
        htmlAssets[htmlFile].content += _.template('<link rel="stylesheet" href="<%=url %>" type="text/css" media="all" />\n')({
          url: bosco.getAssetCdnUrl(asset.assetKey),
        });
      }
    });

    const allStaticAssets = _.union(_.values(htmlAssets), staticAssets);

    allStaticAssets.formattedAssets = formattedAssets(allStaticAssets);

    next(null, allStaticAssets);
  }

  return {
    createAssetHtmlFiles,
    attachFormattedRepos,
  };
};
