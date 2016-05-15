
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
      .then(function (build) {
        let file = build.tree.getFile(entry);
        assert.isTrue(exec(file));
      });
  });

  it('should work with nested modules', function () {
    let entry = fixture('nested/index.js');

    return mako()
      .use(plugins())
      .build(entry)
      .then(function (build) {
        let file = build.tree.getFile(entry);
        assert.isTrue(exec(file));
      });
  });

  it('should work with installed modules', function () {
    let entry = fixture('modules/index.js');

    return mako()
      .use(plugins())
      .build(entry)
      .then(function (build) {
        let file = build.tree.getFile(entry);
        assert.isTrue(exec(file));
      });
  });

  it('should allow for json files to be read directly', function () {
    let entry = fixture('json/index.js');

    return mako()
      .use(plugins())
      .build(entry)
      .then(function (build) {
        let file = build.tree.getFile(entry);
        assert.isTrue(exec(file));
      });
  });

  it('should include shims for node core modules', function () {
    let entry = fixture('core/index.js');

    return mako()
      .use(plugins())
      .build(entry)
      .then(function (build) {
        let file = build.tree.getFile(entry);
        assert.strictEqual(exec(file), '.js');
      });
  });

  it('should inject any node globals that are used', function () {
    let entry = fixture('globals/index.js');

    return mako()
      .use(plugins())
      .build(entry)
      .then(function (build) {
        let file = build.tree.getFile(entry);
        let exported = exec(file);
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
      .then(function (build) {
        let file = build.tree.getFile(entry);
        assert.strictEqual(exec(file), 'test');
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
      .then(function (build) {
        let file = build.tree.getFile(fixture('subentries/index.js'));
        assert.include(file.contents, '{},["test/fixtures/subentries/index.js"]);');
        assert.strictEqual(exec(file), 'nested');
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
      .then(function (build) {
        let file = build.tree.getFile(entry);
        assert.strictEqual(exec(file), 'hi from a text file!');
      });
  });

  context('multiple entries', function () {
    it('should not smush multiple entries together', function () {
      let entries = [
        fixture('multiple-entries/a.js'),
        fixture('multiple-entries/b.js')
      ];

      return mako()
        .use(plugins())
        .build(entries)
        .then(function (build) {
          let a = build.tree.getFile(entries[0]);
          assert.strictEqual(exec(a), 4);
          let b = build.tree.getFile(entries[1]);
          assert.strictEqual(exec(b), 5);
        });
    });
  });

  context('circular dependencies', function () {
    it('should work with the node docs example', function () {
      let entry = fixture('circular-deps/index.js');
      return mako()
        .use(plugins())
        .build(entry)
        .then(function (build) {
          let file = build.tree.getFile(entry);
          assert.isTrue(exec(file));
        });
    });

    it('should work with the more common example', function () {
      let entry = fixture('circular-deps-2/index.js');
      return mako()
        .use(plugins())
        .build(entry)
        .then(function (build) {
          let file = build.tree.getFile(entry);
          assert.strictEqual(exec(file), 'a');
        });
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
          .then(function (build) {
            let file = build.tree.getFile(entry);
            assert.isTrue(exec(file));
          });
      });

      it('should allow flatten the specified list', function () {
        let entry = fixture('extensions/index.js');
        return mako()
          .use([ stat('es'), text('es') ])
          .postread('es', file => file.type = 'js')
          .use(plugins({ extensions: '.es' }))
          .build(entry)
          .then(function (build) {
            let file = build.tree.getFile(entry);
            assert.isTrue(exec(file));
          });
      });
    });

    context('.resolveOptions', function () {
      it('should pass other options to resolve', function () {
        let entry = fixture('modules-alt-dir/index.js');

        return mako()
          .use(plugins({ resolveOptions: { moduleDirectory: 'npm' } }))
          .build(entry)
          .then(function (build) {
            let file = build.tree.getFile(entry);
            assert.isTrue(exec(file));
          });
      });
    });

    context('.sourceMaps', function () {
      it('should include an inline source-map', function () {
        let entry = fixture('source-maps/index.js');
        return mako()
          .use(plugins({ sourceMaps: 'inline' }))
          .build(entry)
          .then(function (build) {
            let code = build.tree.getFile(entry);
            assert(convert.fromSource(code.contents), 'should have an inline source-map');
          });
      });

      it('should not break the original code', function () {
        let entry = fixture('source-maps/index.js');
        return mako()
          .use(plugins({ sourceMaps: 'inline' }))
          .build(entry)
          .then(function (build) {
            let code = build.tree.getFile(entry);
            assert.strictEqual(exec(code), 4);
          });
      });

      it('should add an external source-map to the build', function () {
        let entry = fixture('source-maps/index.js');
        return mako()
          .use(plugins({ sourceMaps: true }))
          .build(entry)
          .then(function (build) {
            let map = build.tree.getFile(entry + '.map');
            assert(convert.fromJSON(map.contents), 'should be a valid source-map file');
          });
      });

      it('should include a link to the external source-map', function () {
        let entry = fixture('source-maps/index.js');
        return mako()
          .use(plugins({ sourceMaps: true }))
          .build(entry)
          .then(function (build) {
            let file = build.tree.getFile(entry);
            assert.isTrue(convert.mapFileCommentRegex.test(file.contents));
          });
      });

      it('should not break the original code', function () {
        let entry = fixture('source-maps/index.js');
        return mako()
          .use(plugins({ sourceMaps: true }))
          .build(entry)
          .then(function (build) {
            let code = build.tree.getFile(entry);
            assert.strictEqual(exec(code), 4);
          });
      });
    });

    context('.bundle', function () {
      it('should add a shared js file', function () {
        let entries = [
          fixture('bundle/a.js'),
          fixture('bundle/b.js')
        ];

        return mako()
          .use(plugins({ bundle: fixture('bundle/shared.js') }))
          .build(entries)
          .then(function (build) {
            assert.isTrue(build.tree.hasFile(fixture('bundle/shared.js')));
          });
      });

      it('should introduce a global require var in the shared js', function () {
        let entries = [
          fixture('bundle/a.js'),
          fixture('bundle/b.js')
        ];

        return mako()
          .use(plugins({ bundle: fixture('bundle/shared.js') }))
          .build(entries)
          .then(function (build) {
            let file = build.tree.getFile(fixture('bundle/shared.js'));
            let ctx = vm.createContext();
            exec(file, ctx);
            assert.isFunction(ctx.require);
          });
      });

      it('should fail to run the normal entries without the shared js', function () {
        let entries = [
          fixture('bundle/a.js'),
          fixture('bundle/b.js')
        ];

        return mako()
          .use(plugins({ bundle: fixture('bundle/shared.js') }))
          .build(entries)
          .then(function (build) {
            let file = build.tree.getFile(fixture('bundle/a.js'));
            assert.throws(() => exec(file));
          });
      });

      it('should correctly run shared + entry', function () {
        let entries = [
          fixture('bundle/a.js'),
          fixture('bundle/b.js')
        ];

        return mako()
          .use(plugins({ bundle: fixture('bundle/shared.js') }))
          .build(entries)
          .then(function (build) {
            let shared = build.tree.getFile(fixture('bundle/shared.js'));
            let a = build.tree.getFile(fixture('bundle/a.js'));
            let b = build.tree.getFile(fixture('bundle/b.js'));
            let ctx = vm.createContext();
            exec(shared, ctx);
            assert.strictEqual(exec(a, ctx), 4);
            assert.strictEqual(exec(b, ctx), 5);
          });
      });
    });
  });
});

/**
 * Executes the given code, returning it's return value.
 *
 * @param {String} file   The file from the build tree to execute.
 * @param {Object} [ctx]  An optional vm context to use
 * @return {*}
 */
function exec(file, ctx) {
  let exported = ctx
    ? vm.runInContext(file.contents, ctx)
    : vm.runInNewContext(file.contents);

  return file.id ? exported(file.id) : exported;
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
