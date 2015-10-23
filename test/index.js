
'use strict';

let chai = require('chai');
let js = require('..');
let mako = require('mako');
let path = require('path');
let stat = require('mako-stat');
let text = require('mako-text');
let vm = require('vm');

chai.use(require('chai-as-promised'));
let assert = chai.assert;
let fixture = path.resolve.bind(path, __dirname, 'fixtures');

let plugins = [
  stat([ 'js', 'json' ]),
  text([ 'js', 'json' ]),
  js()
];

describe('text plugin', function () {
  it('should create a script that executes and returns the top-level export', function () {
    let entry = fixture('simple/index.js');

    return mako()
      .use(plugins)
      .build(entry)
      .then(function (tree) {
        let file = tree.getFile(entry);
        assert.isTrue(exec(file.contents));
      });
  });

  it('should work with nested modules', function () {
    let entry = fixture('nested/index.js');

    return mako()
      .use(plugins)
      .build(entry)
      .then(function (tree) {
        let file = tree.getFile(entry);
        assert.isTrue(exec(file.contents));
      });
  });

  it('should work with installed modules', function () {
    let entry = fixture('modules/index.js');

    return mako()
      .use(plugins)
      .build(entry)
      .then(function (tree) {
        let file = tree.getFile(entry);
        assert.isTrue(exec(file.contents));
      });
  });

  it('should allow for json files to be read directly', function () {
    let entry = fixture('json/index.js');

    return mako()
      .use(plugins)
      .build(entry)
      .then(function (tree) {
        let file = tree.getFile(entry);
        assert.isTrue(exec(file.contents));
      });
  });
});

function exec(code) {
  return vm.runInNewContext(`${code}(1)`);
}
