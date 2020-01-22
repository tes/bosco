const path = require('path');

function createKey(name, buildNumber, tag, hash, type, extension) {
  return path.join(name, buildNumber, type, tag + (hash ? `.${hash}` : '') + (extension ? `.${extension}` : ''));
}

module.exports = createKey;
