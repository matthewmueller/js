/* eslint-env mocha */

'use strict'

let chai = require('chai')
let convert = require('convert-source-map')
let js = require('..')
let mako = require('mako')
let path = require('path')
let stat = require('mako-stat')
let buffer = require('mako-buffer')
let vm = require('vm')

chai.use(require('chai-as-promised'))
let assert = chai.assert
let fixture = path.resolve.bind(path, __dirname, 'fixtures')

describe('js plugin', function () {
  it('should create a script that executes and returns the top-level export', function () {
    let entry = fixture('simple/index.js')

    return mako()
      .use(plugins())
      .build(entry)
      .then(function (build) {
        let file = build.tree.findFile(entry)
        assert.isTrue(exec(file)(file.id))
      })
  })

  it('should work with nested modules', function () {
    let entry = fixture('nested/index.js')

    return mako()
      .use(plugins())
      .build(entry)
      .then(function (build) {
        let file = build.tree.findFile(entry)
        assert.isTrue(exec(file)(file.id))
      })
  })

  it('should work with installed modules', function () {
    let entry = fixture('modules/index.js')

    return mako()
      .use(plugins())
      .build(entry)
      .then(function (build) {
        let file = build.tree.findFile(entry)
        assert.isTrue(exec(file)(file.id))
      })
  })

  it('should allow for json files to be read directly', function () {
    let entry = fixture('json/index.js')

    return mako()
      .use(plugins())
      .build(entry)
      .then(function (build) {
        let file = build.tree.findFile(entry)
        assert.isTrue(exec(file)(file.id))
      })
  })

  it('should include shims for node core modules', function () {
    let entry = fixture('core/index.js')

    return mako()
      .use(plugins())
      .build(entry)
      .then(function (build) {
        let file = build.tree.findFile(entry)
        assert.strictEqual(exec(file)(file.id), '.js')
      })
  })

  it('should inject any node globals that are used', function () {
    let entry = fixture('globals/index.js')

    return mako()
      .use(plugins())
      .build(entry)
      .then(function (build) {
        let file = build.tree.findFile(entry)
        let exported = exec(file)(file.id)
        assert.strictEqual(exported.global.test, 'test')
        assert.strictEqual(exported.Buffer.name, Buffer.name)
        assert.strictEqual(exported.isBuffer.name, Buffer.isBuffer.name)
      })
  })

  it('should inject the current environment variables', function () {
    let entry = fixture('envvars/index.js')
    process.env.TEST = 'test'
    return mako()
      .use(plugins())
      .build(entry)
      .then(function (build) {
        let file = build.tree.findFile(entry)
        assert.strictEqual(exec(file)(file.id), 'test')
        delete process.env.TEST
      })
  })

  it('should build sub-entries properly', function () {
    let entry = fixture('subentries/entry.txt')

    return mako()
      .use(buffer([ 'txt' ]))
      .dependencies('txt', function parseText (file, build) {
        let filepath = path.resolve(path.dirname(file.path), file.contents.toString().trim())
        let dep = build.tree.addFile(filepath)
        file.addDependency(dep)
      })
      .use(plugins())
      .build(entry)
      .then(function (build) {
        let file = build.tree.findFile(fixture('subentries/index.js'))
        // assert.include(file.contents.toString(), '{},["test/fixtures/subentries/index.js"]);')
        assert.strictEqual(exec(file)(file.id), 'nested')
      })
  })

  it('should throw for syntax errors in JS files', function () {
    let entry = fixture('syntax-error/index.js')
    let builder = mako().use(plugins())

    return assert.isRejected(builder.build(entry), 'Unexpected token')
  })

  it('should work for non-JS dependencies', function () {
    let entry = fixture('non-js-deps/index.js')
    return mako()
      .use(buffer('txt'))
      .postread('txt', function txt (file) {
        file.contents = new Buffer(`module.exports = "${file.contents.toString().trim()}";`)
        file.type = 'js'
      })
      .use(plugins())
      .build(entry)
      .then(function (build) {
        let file = build.tree.findFile(entry)
        assert.strictEqual(exec(file)(file.id), 'hi from a text file!')
      })
  })

  it('should work for non-JS entry files', function () {
    let entry = fixture('non-js-entry/glob.txt')
    let dep = fixture('non-js-entry/index.js')
    let runner = mako().use(plugins())

    runner.use(buffer('txt')).dependencies('txt', function (file, build) {
      let depFile = build.tree.addFile(dep)
      file.addDependency(depFile)
    })

    return runner.build(entry).then(function (build) {
      let file = build.tree.findFile(dep)
      assert.strictEqual(exec(file)(file.id), 42)
    })
  })

  it('should propagate resolve errors', function () {
    let entry = fixture('resolve-error/index.js')
    let runner = mako().use(plugins())

    return assert.isRejected(runner.build(entry))
  })

  context('multiple entries', function () {
    it('should not smush multiple entries together', function () {
      let entries = [
        fixture('multiple-entries/a.js'),
        fixture('multiple-entries/b.js')
      ]

      return mako()
        .use(plugins())
        .build(entries)
        .then(function (build) {
          let a = build.tree.findFile(entries[0])
          assert.strictEqual(exec(a)(a.id), 4)
          let b = build.tree.findFile(entries[1])
          assert.strictEqual(exec(b)(b.id), 5)
        })
    })
  })

  context('circular dependencies', function () {
    it('should work with the node docs example', function () {
      let entry = fixture('circular-deps/index.js')
      return mako()
        .use(plugins())
        .build(entry)
        .then(function (build) {
          let file = build.tree.findFile(entry)
          assert.isTrue(exec(file)(file.id))
        })
    })

    it('should work with the more common example', function () {
      let entry = fixture('circular-deps-2/index.js')
      return mako()
        .use(plugins())
        .build(entry)
        .then(function (build) {
          let file = build.tree.findFile(entry)
          assert.strictEqual(exec(file)(file.id), 'a')
        })
    })

    it('should work with the large cycle example', function () {
      let entry = fixture('circular-deps-3/index.js')
      return mako()
        .use(plugins())
        .build(entry)
        .then(function (build) {
          let file = build.tree.findFile(entry)
          assert.strictEqual(exec(file)(file.id), 'a')
        })
    })
  })

  context('with options', function () {
    context('.browser', function () {
      it('should bundle node-compatible scripts when set to false', function () {
        let entry = fixture('no-browser/index.js')

        return mako()
          .use(plugins({ browser: false }))
          .build(entry)
          .then(function (build) {
            let file = build.tree.findFile(entry)
            // wrap our code so we can pass a valid require fn to the eval'd script
            let code = `(function (require) {\nreturn ${file.contents.toString()}\n})`
            // just check that we got an array from fs.readdirSync
            assert.isArray(vm.runInThisContext(code)(require)(file.id))
          })
      })
    })

    context('.checkSyntax', function () {
      it('should now throw for syntax errors in JS files', function () {
        let entry = fixture('syntax-error/index.js')
        let builder = mako().use(plugins({ checkSyntax: false }))

        return builder.build(entry)
      })
    })

    context('.extensions', function () {
      it('should allow resolving the extra extensions', function () {
        let entry = fixture('extensions/index.js')
        return mako()
          .use([ stat('es'), buffer('es') ])
          .postread('es', file => { file.type = 'js' })
          .use(plugins({ extensions: [ '.es' ] }))
          .build(entry)
          .then(function (build) {
            let file = build.tree.findFile(entry)
            assert.isTrue(exec(file)(file.id))
          })
      })

      it('should allow flatten the specified list', function () {
        let entry = fixture('extensions/index.js')
        return mako()
          .use([ stat('es'), buffer('es') ])
          .postread('es', file => { file.type = 'js' })
          .use(plugins({ extensions: '.es' }))
          .build(entry)
          .then(function (build) {
            let file = build.tree.findFile(entry)
            assert.isTrue(exec(file)(file.id))
          })
      })
    })

    context('.resolveOptions', function () {
      it('should pass other options to resolve', function () {
        let entry = fixture('modules-alt-dir/index.js')

        return mako()
          .use(plugins({ resolveOptions: { moduleDirectory: 'npm' } }))
          .build(entry)
          .then(function (build) {
            let file = build.tree.findFile(entry)
            assert.isTrue(exec(file)(file.id))
          })
      })
    })

    context('.sourceMaps', function () {
      it('should not break the original code', function () {
        let entry = fixture('source-maps/index.js')
        return mako()
          .use(plugins({ sourceMaps: true }))
          .build(entry)
          .then(function (build) {
            let code = build.tree.findFile(entry)
            assert.strictEqual(exec(code)(code.id), 4)
          })
      })

      it('should generate file.sourceMap', function () {
        let entry = fixture('source-maps/index.js')
        return mako()
          .use(plugins({ sourceMaps: true }))
          .build(entry)
          .then(function (build) {
            let code = build.tree.findFile(entry)
            assert(convert.fromObject(code.sourceMap), 'should have a source-map object')
          })
      })
    })

    context('.bundle', function () {
      it('should add a shared js file', function () {
        let entries = [
          fixture('bundle/a.js'),
          fixture('bundle/b.js')
        ]

        return mako()
          .use(plugins({ bundle: fixture('bundle/shared.js') }))
          .build(entries)
          .then(function (build) {
            let file = build.tree.findFile(fixture('bundle/shared.js'))
            assert.isDefined(file)
          })
      })

      it('should introduce a global require var in the shared js', function () {
        let entries = [
          fixture('bundle/a.js'),
          fixture('bundle/b.js')
        ]

        return mako()
          .use(plugins({ bundle: fixture('bundle/shared.js') }))
          .build(entries)
          .then(function (build) {
            let file = build.tree.findFile(fixture('bundle/shared.js'))
            let ctx = vm.createContext()
            exec(file, ctx)
            assert.isFunction(ctx.require)
          })
      })

      it('should fail to run the normal entries without the shared js', function () {
        let entries = [
          fixture('bundle/a.js'),
          fixture('bundle/b.js')
        ]

        return mako()
          .use(plugins({ bundle: fixture('bundle/shared.js') }))
          .build(entries)
          .then(function (build) {
            let file = build.tree.findFile(fixture('bundle/a.js'))
            assert.throws(() => exec(file))
          })
      })

      it('should correctly run shared + entry', function () {
        let entries = [
          fixture('bundle/a.js'),
          fixture('bundle/b.js')
        ]

        return mako()
          .use(plugins({ bundle: fixture('bundle/shared.js') }))
          .build(entries)
          .then(function (build) {
            let shared = build.tree.findFile(fixture('bundle/shared.js'))
            let a = build.tree.findFile(fixture('bundle/a.js'))
            let b = build.tree.findFile(fixture('bundle/b.js'))
            let ctx = vm.createContext()
            exec(shared, ctx)
            assert.strictEqual(exec(a, ctx)(a.id), 4)
            assert.strictEqual(exec(b, ctx)(b.id), 5)
          })
      })

      it('should correctly handle deep bundles', function () {
        let entries = [
          fixture('bundle-deep/a.js'),
          fixture('bundle-deep/b.js')
        ]

        return mako()
          .use(plugins({ bundle: fixture('bundle-deep/shared.js') }))
          .build(entries)
          .then(function (build) {
            let shared = build.tree.findFile(fixture('bundle-deep/shared.js'))
            let a = build.tree.findFile(fixture('bundle-deep/a.js'))
            let b = build.tree.findFile(fixture('bundle-deep/b.js'))
            let ctx = vm.createContext()
            exec(shared, ctx)
            assert.strictEqual(exec(a, ctx)(a.id), 8)
            assert.strictEqual(exec(b, ctx)(b.id), 9)
          })
      })
    })
  })
})

/**
 * Executes the given code, returning it's return value.
 *
 * @param {String} file   The file from the build tree to execute.
 * @param {Object} [ctx]  An optional vm context to use
 * @return {*}
 */
function exec (file, ctx) {
  return ctx
    ? vm.runInContext(file.contents, ctx)
    : vm.runInThisContext(file.contents)
}

/**
 * Return the basic plugins for running tests.
 *
 * @param {Object} [options]  Passed to the js plugin directly.
 * @return {Array}
 */
function plugins (options) {
  return [
    stat([ 'js', 'json' ]),
    buffer([ 'js', 'json' ]),
    js(options)
  ]
}
