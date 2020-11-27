const _ = require('lodash');
const fs = require('fs');
const UglifyJS = require('uglify-js');
const CleanCSS = require('clean-css');
const createKey = require('./assetCreateKey');

module.exports = function Minify(bosco) {
  function compileJs(staticAssets, jsAssets, concatenateOnly, next) {
    const bundleKeys = _.uniq(_.map(jsAssets, 'bundleKey'));
    let err;
    _.forEach(bundleKeys, (bundleKey) => {
      const items = _.filter(jsAssets, { bundleKey });

      if (items.length === 0) { return; }

      let compiled;
      let serviceName;
      let buildNumber;
      let tag;
      let minificationConfig;

      /* eslint-disable prefer-destructuring */
      // On first item retrieve shared properties
      if (!serviceName) {
        const firstItem = items[0];
        serviceName = firstItem.serviceName;
        buildNumber = firstItem.buildNumber;
        tag = firstItem.tag;
        minificationConfig = firstItem.minificationConfig;
      }
      /* eslint-enable prefer-destructuring */

      function addSourceMap(content) {
        if (!content) return;
        const mapKey = createKey(serviceName, buildNumber, tag, 'js', 'js', 'map');
        const mapItem = {};
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
        const minifiedKey = createKey(serviceName, buildNumber, tag, null, 'js', 'js');
        const minifiedItem = {};
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
          bosco.log(`Adding already minified ${bundleKey.blue} JS assets ...`);
        }
        let sourceMapContent = '';
        let jsContent = '';
        const sourceFiles = [];
        _.forEach(items, (item) => {
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
        bosco.log(`Compiling ${_.size(items)} ${bundleKey.blue} JS assets ...`);

        const uglifyConfig = bosco.config.get('js:uglify');

        const uglifyOptions = {
          output: (uglifyConfig && uglifyConfig.outputOptions) || {},
          compress: (uglifyConfig && uglifyConfig.compressorOptions) || null,
          mangle: (uglifyConfig && uglifyConfig.mangle) || null,
          sourceMap: {
            url: `${tag}.js.map`,
          },
        };

        const files = _.reduce(items, (acc, i) => ({
          ...acc,
          [i.path]: i.data.toString(),
        }), {});

        compiled = UglifyJS.minify(files, uglifyOptions);

        if (compiled.error) {
          const errorMsg = `There was an error minifying files in ${bundleKey.blue}, error: ${compiled.error.message}`;
          err = new Error(errorMsg);
          compiled = {
            code: '',
          };
        }

        addSourceMap(compiled.map);
        addMinifiedJs(compiled.code);
      }
    });

    next(err, staticAssets);
  }

  function compileCss(staticAssets, cssAssets, concatenateOnly, next) {
    const bundleKeys = _.uniq(_.map(cssAssets, 'bundleKey'));

    _.forEach(bundleKeys, (bundleKey) => {
      const items = _.filter(cssAssets, { bundleKey });
      let cssContent = '';
      let serviceName;
      let buildNumber;
      let tag;
      const sourceFiles = [];

      if (items.length === 0) { return; }

      /* eslint-disable prefer-destructuring */
      if (!serviceName) {
        const firstItem = items[0];
        serviceName = firstItem.serviceName;
        buildNumber = firstItem.buildNumber;
        tag = firstItem.tag;
      }
      /* eslint-enable prefer-destructuring */

      if (!concatenateOnly) {
        bosco.log(`Compiling ${_.size(items)} ${bundleKey.blue} CSS assets ...`);
      }

      _.forEach(items, (file) => {
        cssContent += fs.readFileSync(file.path);
        sourceFiles.push(file.path);
      });

      if (!concatenateOnly) {
        const cleanCssConfig = bosco.config.get('css:clean');
        if (cleanCssConfig && cleanCssConfig.enabled) {
          cssContent = new CleanCSS(cleanCssConfig.options).minify(cssContent).styles;
        }
      }

      if (cssContent.length === 0) {
        next({ message: `No css for tag ${tag}` });
        return;
      }

      const assetKey = createKey(serviceName, buildNumber, tag, null, 'css', 'css');

      const minifiedItem = {};
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
    const jsAssets = _.filter(staticAssets, { type: 'js' });
    const cssAssets = _.filter(staticAssets, { type: 'css' });
    const remainingAssets = _.filter(staticAssets, (item) => item.type !== 'js' && item.type !== 'css');
    const noCssAssets = _.filter(staticAssets, (item) => item.type !== 'css');

    compileJs(concatenateOnly ? noCssAssets : remainingAssets, jsAssets, concatenateOnly, (err, minifiedStaticAssets) => {
      if (err) { return next(err); }
      compileCss(minifiedStaticAssets, cssAssets, concatenateOnly, next);
    });
  }

  return minify;
};
