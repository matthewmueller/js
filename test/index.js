
'use strict';

let chai = require('chai');
let convert = require('convert-source-map');
let js = require('..');
let mako = require('mako');
let path = require('path');
let stat = require('mako-stat');
let text = require('mako-text');
let vm = require('vm');

chai.use(require('chai-as-promised'));
let assert = chai.assert;
let fixture = path.resolve.bind(path, __dirname, 'fixtures');

describe('js plugin', function () {
  it('should create a script that executes and returns the top-level export', function () {
    let entry = fixture('simple/index.js');

    return mako()
      .use(plugins())
      .build(entry)
      .then(function (tree) {
        let file = tree.getFile(entry);
        assert.isTrue(exec(file.contents));
      });
  });

  it('should work with nested modules', function () {
    let entry = fixture('nested/index.js');

    return mako()
      .use(plugins())
      .build(entry)
      .then(function (tree) {
        let file = tree.getFile(entry);
        assert.isTrue(exec(file.contents));
      });
  });

  it('should work with installed modules', function () {
    let entry = fixture('modules/index.js');

    return mako()
      .use(plugins())
      .build(entry)
      .then(function (tree) {
        let file = tree.getFile(entry);
        assert.isTrue(exec(file.contents));
      });
  });

  it('should allow for json files to be read directly', function () {
    let entry = fixture('json/index.js');

    return mako()
      .use(plugins())
      .build(entry)
      .then(function (tree) {
        let file = tree.getFile(entry);
        assert.isTrue(exec(file.contents));
      });
  });

  it('should include shims for node core modules', function () {
    let entry = fixture('core/index.js');

    return mako()
      .use(plugins())
      .build(entry)
      .then(function (tree) {
        let file = tree.getFile(entry);
        assert.strictEqual(exec(file.contents), '.js');
      });
  });

  it('should inject any node globals that are used', function () {
    let entry = fixture('globals/index.js');

    return mako()
      .use(plugins())
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
      .use(plugins())
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
      .dependencies('txt', function parseText(file) {
        var filepath = path.resolve(path.dirname(file.path), file.contents.trim());
        file.addDependency(filepath);
      })
      .use(plugins())
      .build(entry)
      .then(function (tree) {
        let file = tree.getFile(fixture('subentries/index.js'));
        assert.strictEqual(exec(file.contents), 'nested');
      });
  });

  it('should throw for syntax errors in JS files', function () {
    let entry = fixture('syntax-error/index.js');
    let builder = mako().use(plugins());

    return assert.isRejected(builder.build(entry), 'Unexpected token');
  });

  it('should work for non-JS dependencies', function () {
    let entry = fixture('non-js-deps/index.js');
    return mako()
      .use(text('txt'))
      .postread('txt', function txt(file) {
        file.contents = `module.exports = "${file.contents.trim()}";`;
        file.type = 'js';
      })
      .use(plugins())
      .build(entry)
      .then(function (tree) {
        let file = tree.getFile(entry);
        assert.strictEqual(exec(file.contents), 'hi from a text file!');
      });
  });

  context('with options', function () {
    // TODO .root

    context('.extensions', function () {
      it('should allow resolving the extra extensions', function () {
        let entry = fixture('extensions/index.js');
        return mako()
          .use([ stat('es'), text('es') ])
          .postread('es', file => file.type = 'js')
          .use(plugins({ extensions: [ '.es' ] }))
          .build(entry)
          .then(function (tree) {
            let file = tree.getFile(entry);
            assert.isTrue(exec(file.contents));
          });
      });

      it('should allow flatten the specified list', function () {
        let entry = fixture('extensions/index.js');
        return mako()
          .use([ stat('es'), text('es') ])
          .postread('es', file => file.type = 'js')
          .use(plugins({ extensions: '.es' }))
          .build(entry)
          .then(function (tree) {
            let file = tree.getFile(entry);
            assert.isTrue(exec(file.contents));
          });
      });
    });

    context('.resolveOptions', function () {
      it('should pass other options to resolve', function () {
        let entry = fixture('modules-alt-dir/index.js');

        return mako()
          .use(plugins({ resolveOptions: { moduleDirectory: 'npm' } }))
          .build(entry)
          .then(function (tree) {
            let file = tree.getFile(entry);
            assert.isTrue(exec(file.contents));
          });
      });
    });

    context('.sourceMaps', function () {
      it('should include an inline source-map', function () {
        let entry = fixture('source-maps/index.js');
        return mako()
          .use(plugins({ sourceMaps: 'inline' }))
          .build(entry)
          .then(function (tree) {
            let code = tree.getFile(entry);
            assert(convert.fromSource(code.contents), 'should have an inline source-map');
          });
      });

      it('should not break the original code', function () {
        let entry = fixture('source-maps/index.js');
        return mako()
          .use(plugins({ sourceMaps: 'inline' }))
          .build(entry)
          .then(function (tree) {
            let code = tree.getFile(entry);
            assert.strictEqual(exec(code.contents), 4);
          });
      });

      it('should include an external source-map', function () {
        let entry = fixture('source-maps/index.js');
        return mako()
          .use(plugins({ sourceMaps: true }))
          .build(entry)
          .then(function (tree) {
            let map = tree.getFile(entry + '.map');
            assert(convert.fromJSON(map.contents), 'should be a valid source-map file');
          });
      });

      it('should not break the original code', function () {
        let entry = fixture('source-maps/index.js');
        return mako()
          .use(plugins({ sourceMaps: true }))
          .build(entry)
          .then(function (tree) {
            let code = tree.getFile(entry);
            assert.strictEqual(exec(code.contents), 4);
          });
      });
    });
  });
});

/**
 * Executes the given code, returning it's return value.
 *
 * @param {String} code  The source code to run. (ie: the result of a build)
 * @return {*}
 */
function exec(code) {
  return vm.runInNewContext(code)(1);
}

/**
 * Return the basic plugins for running tests.
 *
 * @param {Object} [options]  Passed to the js plugin directly.
 * @return {Array}
 */
function plugins(options) {
  return [
    stat([ 'js', 'json' ]),
    text([ 'js', 'json' ]),
    js(options)
  ];
}
