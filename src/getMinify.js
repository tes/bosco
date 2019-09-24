var _ = require('lodash');
var fs = require('fs');
var UglifyJS = require('uglify-js');
var CleanCSS = require('clean-css');
var createKey = require('./assetCreateKey');

module.exports = function (bosco) {
  function compileJs(staticAssets, jsAssets, concatenateOnly, next) {
    var bundleKeys = _.uniq(_.map(jsAssets, 'bundleKey'));
    var err;
    _.forEach(bundleKeys, function (bundleKey) {
      var items = _.filter(jsAssets, { bundleKey: bundleKey });

      if (items.length === 0) { return; }

      var compiled;
      var serviceName;
      var buildNumber;
      var tag;
      var minificationConfig;

      // On first item retrieve shared properties
      if (!serviceName) {
        var firstItem = items[0];
        serviceName = firstItem.serviceName;
        buildNumber = firstItem.buildNumber;
        tag = firstItem.tag;
        minificationConfig = firstItem.minificationConfig;
      }

      function addSourceMap(content) {
        if (!content) return;
        var mapKey = createKey(serviceName, buildNumber, tag, 'js', 'js', 'map');
        var mapItem = {};
        mapItem.assetKey = mapKey;
        mapItem.serviceName = serviceName;
        mapItem.buildNumber = buildNumber;
        mapItem.path = 'js-source-map';
        mapItem.relativePath = 'js-source-map';
        mapItem.extname = '.map';
        mapItem.tag = tag;
        mapItem.type = 'js';
        mapItem.mimeType = 'application/javascript';
        mapItem.content = content;
        staticAssets.push(mapItem);
      }

      function addMinifiedJs(content, sourceFiles) {
        if (!content) return;
        var minifiedKey = createKey(serviceName, buildNumber, tag, null, 'js', 'js');
        var minifiedItem = {};
        minifiedItem.assetKey = minifiedKey;
        minifiedItem.serviceName = serviceName;
        minifiedItem.buildNumber = buildNumber;
        minifiedItem.path = 'minified-js';
        minifiedItem.relativePath = 'minified-js';
        minifiedItem.extname = '.js';
        minifiedItem.tag = tag;
        minifiedItem.type = 'js';
        minifiedItem.mimeType = 'application/javascript';
        minifiedItem.content = content;
        minifiedItem.sourceFiles = sourceFiles;
        staticAssets.push(minifiedItem);
      }

      // If a bundle is already minified it can only have a single item
      if (minificationConfig.alreadyMinified || concatenateOnly) {
        if (!concatenateOnly) {
          bosco.log('Adding already minified ' + bundleKey.blue + ' JS assets ...');
        }
        var sourceMapContent = '';
        var jsContent = '';
        var sourceFiles = [];
        _.forEach(items, function (item) {
          if (item.extname === minificationConfig.sourceMapExtension) {
            sourceMapContent += item.content;
          } else {
            jsContent += item.content;
            sourceFiles.push(item.path);
          }
        });
        if (sourceMapContent) {
          addSourceMap(sourceMapContent);
        }
        if (jsContent) {
          addMinifiedJs(jsContent, sourceFiles);
        }
      } else {
        bosco.log('Compiling ' + _.size(items) + ' ' + bundleKey.blue + ' JS assets ...');

        var uglifyConfig = bosco.config.get('js:uglify');

        var uglifyOptions = {
          output: uglifyConfig ? uglifyConfig.outputOptions : null,
          compressor: uglifyConfig ? uglifyConfig.compressorOptions : null,
          mangle: uglifyConfig ? uglifyConfig.mangle : null,
          outSourceMap: tag + '.js.map',
          sourceMapIncludeSources: true
        };

        try {
          compiled = UglifyJS.minify(_.values(_.map(items, 'path')), uglifyOptions);
        } catch (ex) {
          var errorMsg = 'There was an error minifying files in ' + bundleKey.blue + ', error: ' + ex.message;
          err = new Error(errorMsg);
          compiled = {
            code: ''
          };
        }

        addSourceMap(compiled.map);
        addMinifiedJs(compiled.code);
      }
    });

    next(err, staticAssets);
  }

  function compileCss(staticAssets, cssAssets, concatenateOnly, next) {
    var bundleKeys = _.uniq(_.map(cssAssets, 'bundleKey'));

    _.forEach(bundleKeys, function (bundleKey) {
      var items = _.filter(cssAssets, { bundleKey: bundleKey });
      var cssContent = '';
      var serviceName;
      var buildNumber;
      var tag;
      var sourceFiles = [];

      if (items.length === 0) { return; }

      if (!serviceName) {
        var firstItem = items[0];
        serviceName = firstItem.serviceName;
        buildNumber = firstItem.buildNumber;
        tag = firstItem.tag;
      }

      if (!concatenateOnly) {
        bosco.log('Compiling ' + _.size(items) + ' ' + bundleKey.blue + ' CSS assets ...');
      }

      _.forEach(items, function (file) {
        cssContent += fs.readFileSync(file.path);
        sourceFiles.push(file.path);
      });

      if (!concatenateOnly) {
        var cleanCssConfig = bosco.config.get('css:clean');
        if (cleanCssConfig && cleanCssConfig.enabled) {
          cssContent = new CleanCSS(cleanCssConfig.options).minify(cssContent).styles;
        }
      }

      if (cssContent.length === 0) {
        next({ message: 'No css for tag ' + tag });
        return;
      }

      var assetKey = createKey(serviceName, buildNumber, tag, null, 'css', 'css');

      var minifiedItem = {};
      minifiedItem.assetKey = assetKey;
      minifiedItem.serviceName = serviceName;
      minifiedItem.buildNumber = buildNumber;
      minifiedItem.path = 'minified-css';
      minifiedItem.relativePath = 'minified-css';
      minifiedItem.extname = '.css';
      minifiedItem.tag = tag;
      minifiedItem.type = 'css';
      minifiedItem.mimeType = 'text/css';
      minifiedItem.content = cssContent;
      minifiedItem.sourceFiles = sourceFiles;
      staticAssets.push(minifiedItem);
    });

    next(null, staticAssets);
  }

  function minify(staticAssets, concatenateOnly, next) {
    var jsAssets = _.filter(staticAssets, { type: 'js' });
    var cssAssets = _.filter(staticAssets, { type: 'css' });
    var remainingAssets = _.filter(staticAssets, function (item) {
      return item.type !== 'js' && item.type !== 'css';
    });
    var noCssAssets = _.filter(staticAssets, function (item) {
      return item.type !== 'css';
    });

    compileJs(concatenateOnly ? noCssAssets : remainingAssets, jsAssets, concatenateOnly, function (err, minifiedStaticAssets) {
      if (err) { return next(err); }
      compileCss(minifiedStaticAssets, cssAssets, concatenateOnly, next);
    });
  }

  return minify;
};
