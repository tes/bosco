var _ = require('lodash');
var fs = require('fs');
var path = require('path');
var UglifyJS = require('uglify-js');
var CleanCSS = require('clean-css');
var async = require('async');

module.exports = function(bosco) {

  var createKey = require('./AssetHelper')(bosco).createKey;

  function minify(staticAssets, next) {

      // Create simple collections of css and js
      var jsAssets = {},
          cssAssets = {},
          otherAssets = [];

      _.forEach(staticAssets, function(asset) {

          if (asset.type === 'js') {
              if (!(asset.bundleKey in jsAssets)) jsAssets[asset.bundleKey] = {};
              jsAssets[asset.bundleKey][asset.assetKey] = {
                serviceName: asset.serviceName,
                buildNumber: asset.buildNumber,
                tag: asset.tag,
                path: asset.path
              }
          } else if (asset.type === 'css') {
              if (!(asset.bundleKey in cssAssets)) cssAssets[asset.bundleKey] = {};
              cssAssets[asset.bundleKey][asset.assetKey] = {
                serviceName: asset.serviceName,
                buildNumber: asset.buildNumber,
                tag: asset.tag,
                path: asset.path
              }
          } else {
            otherAssets.push(asset);
          }
      });

      staticAssets = createManifest(staticAssets);

      async.series([
              function pcompileJs(next) {
                  compileJs(staticAssets, jsAssets, next);
              },
              function pcompileCss(next) {
                  compileCss(staticAssets, cssAssets, next);
              }
          ],
          function(err) {
              next(err, _.union(staticAssets, otherAssets));
          });

  }

  return {
      minify: minify
  }

  function createManifest(staticAssets) {

      var manifests = {};

      _.forEach(staticAssets, function(value) {

          var manifestFile = createKey(value.serviceName, value.buildNumber, value.tag, value.type, 'manifest', 'txt');

          manifests[manifestFile] = manifests[manifestFile] || {
              content: '',
              assetKey: manifestFile,
              serviceName: value.serviceName,
              buildNumber: value.buildNumber,
              type: 'plain',
              mimeType: 'text/plain',
              assetType: value.type,
              tag: value.tag,
              isMinifiedFragment: true,
              extname: '.manifest',
              files: []
          };

          var repoPath = value.repo || '';
          var basePath = value.basePath || '';
          var assetPath = value.asset || '';
          var relativePath = path.join(repoPath, basePath, assetPath);

          manifests[manifestFile].content += relativePath + ', Last commit: ' + value.commit;
          manifests[manifestFile].files.push({
              key: createKey(value.serviceName, value.buildNumber, relativePath, '', 'src', ''),
              relativePath: relativePath,
              content: value.content,
              path: value.path,
              type: value.type
          });
      });

      return _.values(manifests);

  }

  function compileJs(staticAssets, jsAssets, next) {

      _.forOwn(jsAssets, function(items, bundleKey) {

          if(items.length === 0) { return; }

          var compiled, serviceName, buildNumber, tag;

          bosco.log('Compiling ' + _.size(items) + ' ' + bundleKey.blue + ' JS assets ...');

          var uglifyConfig = bosco.config.get('js:uglify');

          if(!serviceName) {
            var firstItem = _.values(items)[0];
            serviceName = firstItem.serviceName;
            buildNumber = firstItem.buildNumber;
            tag = firstItem.tag;
          }

          var uglifyOptions = {
            output: uglifyConfig ? uglifyConfig.outputOptions : null,
            compressor: uglifyConfig ? uglifyConfig.compressorOptions : null,
            mangle: uglifyConfig ? uglifyConfig.mangle : null,
                outSourceMap: tag + '.js.map',
                sourceMapIncludeSources: true
            };

          try {
            compiled = UglifyJS.minify(_.values(_.pluck(items,'path')), uglifyOptions);
          } catch (ex) {
              bosco.error('There was an error minifying files in ' + bundleKey.blue + ', error:');
              console.log(ex.message + '\n');
              compiled = {
                  code: ''
              };
          }

          var mapKey = createKey(serviceName, buildNumber, tag, 'js', 'js', 'map');

          var mapItem = {};
          mapItem.assetKey = mapKey;
          mapItem.serviceName = serviceName;
          mapItem.buildNumber = buildNumber;
          mapItem.path = '';
          mapItem.path = '';
          mapItem.extname = '.map';
          mapItem.tag = tag;
          mapItem.type = 'js';
          mapItem.mimeType = 'application/javascript';
          mapItem.content = compiled.map;
          staticAssets.push(mapItem);

          var minifiedKey = createKey(serviceName, buildNumber, tag, null, 'js', 'js');
          var minifiedItem = {};
          minifiedItem.assetKey = minifiedKey;
          minifiedItem.serviceName = serviceName;
          minifiedItem.buildNumber = buildNumber;
          minifiedItem.path = '';
          minifiedItem.extname = '.js';
          minifiedItem.tag = tag;
          minifiedItem.type = 'js';
          minifiedItem.mimeType = 'application/javascript';
          minifiedItem.content = compiled.code;
          staticAssets.push(minifiedItem);

      });

      next(null);

  }

  function compileCss(staticAssets, cssAssets, next) {

      var compiledCss = [];

      _.forOwn(cssAssets, function(items) {

          var compiled = {
              css: '',
              count: 0
          };

          _.forOwn(items, function(file) {
              compiled.serviceName = file.serviceName;
              compiled.buildNumber = file.buildNumber;
              compiled.tag = file.tag;
              compiled.css += fs.readFileSync(file.path);
              compiled.count++;
          });

          compiledCss.push(compiled)

      });

      async.map(compiledCss, function(css, next) {

          bosco.log('Compiling ' + css.count + ' ' + css.tag.blue + ' CSS assets ...');

            var cssContent = css.css, serviceName = css.serviceName, buildNumber = css.buildNumber;

            var cleanCssConfig = bosco.config.get('css:clean');

            if(cleanCssConfig && cleanCssConfig.enabled) {
              cssContent = new CleanCSS(cleanCssConfig.options).minify(cssContent);
            }

            if (cssContent.length === 0) return next({
                message: 'No css for tag ' + css.tag
            });

            var assetKey = createKey(serviceName, buildNumber, css.tag, null, 'css', 'css');

            var minifiedItem = {};
            minifiedItem.assetKey = assetKey;
            minifiedItem.serviceName = serviceName;
            minifiedItem.buildNumber = buildNumber;
            minifiedItem.path = '';
            minifiedItem.extname = '.css';
            minifiedItem.tag = css.tag;
            minifiedItem.type = 'css';
            minifiedItem.mimeType = 'text/css';
            minifiedItem.content = cssContent;
            staticAssets.push(minifiedItem);

            next();

      }, function(err) {
          if (err) return bosco.warn('No CSS assets: ' + err.message);
          next(null);
      });

  }


}
