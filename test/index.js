
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

describe('js plugin', function () {
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

  it('should include shims for node core modules', function () {
    let entry = fixture('core/index.js');

    return mako()
      .use(plugins)
      .build(entry)
      .then(function (tree) {
        let file = tree.getFile(entry);
        assert.strictEqual(exec(file.contents), '.js');
      });
  });

  it('should inject any node globals that are used', function () {
    let entry = fixture('globals/index.js');

    return mako()
      .use(plugins)
      .build(entry)
      .then(function (tree) {
        let file = tree.getFile(entry);
        let exported = exec(file.contents);
        assert.strictEqual(exported.global.test, 'test');
        assert.strictEqual(exported.Buffer.name, Buffer.name);
        assert.strictEqual(exported.isBuffer.name, Buffer.isBuffer.name);
      });
  });

  it('should inject the current environment variables', function () {
    let entry = fixture('envvars/index.js');
    process.env.TEST = 'test';
    return mako()
      .use(plugins)
      .build(entry)
      .then(function (tree) {
        let file = tree.getFile(entry);
        assert.strictEqual(exec(file.contents), 'test');
        delete process.env.TEST;
      });
  });

  it('should build sub-entries properly', function () {
    let entry = fixture('subentries/entry.txt');

    return mako()
      .use(text([ 'txt' ]))
      .use(parseText)
      .use(plugins)
      .build(entry)
      .then(function (tree) {
        let file = tree.getFile(fixture('subentries/index.js'));
        assert.strictEqual(exec(file.contents), 'nested');
      });

    /**
     * parse test plugin
     *
     * @param {Mako} mako mako object
     */
    function parseText(mako) {
      mako.dependencies('txt', function (file) {
        var filepath = path.resolve(path.dirname(file.path), file.contents.trim());
        file.addDependency(filepath);
      });
    }
  });

  it('should throw for syntax errors in JS files', function () {
    let entry = fixture('syntax-error/index.js');
    let builder = mako().use(plugins);

    return assert.isRejected(builder.build(entry), 'Unexpected token');
  });
});
/**
 * Executes the given code, returning it's return value.
 *
 * @param {String} code  The source code to run. (ie: the result of a build)
 * @return {*}
 */
function exec(code) {
  return vm.runInNewContext(code + '(1)');
}
