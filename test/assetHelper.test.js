'use strict';

var { expect } = require('chai');

describe('Asset Helper', function() {
  it("Warns the user if an asset can't be located, but continues anyway", function(done) {
    var message;

    var bosco = {warn: function(msg) { message = msg }};
    var staticAssets = {'my-key': {}};
    var addAsset = require('../src/getAssetHelper')(bosco)({name: 'our-repo', path: '/tmp'}, null).addAsset;

    // when
    addAsset(staticAssets, '100', 'my-key', 'asset.hole', 'tag', 'html', '.');

    // expect
    expect(message).equal('Asset my-key not found at path /tmp/asset.hole, declared in our-repo');
    done();
  });
});
