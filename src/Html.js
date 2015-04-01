var _ = require('lodash');
var hb = require('handlebars');
var fs = require('fs');

module.exports = function(bosco) {

    var createKey = require('./AssetHelper')(bosco).createKey;

    function createAssetHtmlFiles(staticAssets, next) {

        var htmlAssets = {};

        _.forEach(staticAssets, function(asset) {

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
                extname: '.html'
            };

            if (isJavascript(asset)) {
                htmlAssets[htmlFile].content += _.template('<script src="<%= url %>"></script>\n')({
                    'url': bosco.getAssetCdnUrl(asset.assetKey)
                });
            }

            if (isStylesheet(asset)) {
                htmlAssets[htmlFile].content += _.template('<link rel="stylesheet" href="<%=url %>" type="text/css" media="screen" />\n')({
                    'url': bosco.getAssetCdnUrl(asset.assetKey)
                });
            }

        });

        staticAssets = _.union(_.values(htmlAssets), staticAssets);

        staticAssets.formattedAssets = formattedAssets(staticAssets);

        next(null, staticAssets);

    }

    function isJavascript(asset) {
        if (asset.type !== 'js') return false;
        if (asset.extname !== '.js') return false;

        return true;
    }

    function isStylesheet(asset) {
        return asset.type === 'css';
    }

    function attachFormattedRepos(repos, next) {
        repos.formattedRepos = formattedRepos(repos);
        next(null, repos);
    }


    function formattedAssets(staticAssets) {

        var assets = {services:[]};
        var templateContent = fs.readFileSync(__dirname + '/../templates/assetList.html');
        var template = hb.compile(templateContent.toString());

        var assetsByService = _.groupBy(staticAssets,'serviceName');

        _.forOwn(assetsByService, function(serviceAssets, serviceName) {
            var service = {serviceName: serviceName, bundles: []};
            var bundlesByTag = _.groupBy(serviceAssets, 'tag');
            _.forOwn(bundlesByTag, function(bundleAssets, bundleTag) {
                bundleAssets = _.map(bundleAssets, function(asset) {
                    asset.url = bosco.getAssetCdnUrl(asset.assetKey);
                    return asset;
                })
                var bundle = {bundle:bundleTag, assets:bundleAssets};
                service.bundles.push(bundle);
            });
            assets.services.push(service);
        });

        assets.user = bosco.config.get('github:user');
        assets.date = (new Date()).toString();

        return template(assets);

    }

    function formattedRepos(repos) {

        var templateContent = fs.readFileSync(__dirname + '/../templates/repoList.html'),
            template = hb.compile(templateContent.toString()),
            templateData = { repos: repos };

        templateData.user = bosco.config.get('github:user');
        templateData.date = (new Date()).toString();

        return template(templateData);

    }

    return {
        createAssetHtmlFiles:createAssetHtmlFiles,
        attachFormattedRepos: attachFormattedRepos
    }

}
