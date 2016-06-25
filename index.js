'use strict'

let bpack = require('browser-pack')
let bresolve = require('browser-resolve')
let builtins = require('./lib/builtins')
let concat = require('concat-stream')
let convert = require('convert-source-map')
let debug = require('debug')('mako-js')
let detective = require('detective')
let envify = require('envify')
let flatten = require('array-flatten')
let insertGlobals = require('insert-module-globals')
let path = require('path')
let Promise = require('bluebird')
let pump = require('pump')
let readable = require('string-to-stream')
let resolve = require('resolve')
let sortBy = require('sort-by')
let streamify = require('stream-array')
let syntax = require('syntax-error')
let values = require('object-values')

const pwd = process.cwd()
const relative = abs => path.relative(pwd, abs)
const bundles = new WeakMap()

// default plugin configuration
const defaults = {
  browser: true,
  bundle: false,
  checkSyntax: true,
  detectiveOptions: null,
  extensions: [],
  resolveOptions: null,
  sourceMaps: false,
  sourceRoot: 'file://mako'
}

/**
 * Initialize the mako js plugin.
 *
 * Available options:
 *  - bundle {String}          a path to a shared bundle file.
 *  - extensions {Array}       additional extensions to process.
 *  - resolveOptions {Object}  options for the resolve module.
 *  - sourceMaps {Boolean}     enable source maps.
 *  - sourceRoot {String}      source map root.
 *
 * @param {Object} options  Configuration.
 * @return {Function}
 */
module.exports = function (options) {
  debug('initialize %j', options)
  let config = extend(defaults, options)

  return function (mako) {
    mako.postread('json', json)
    if (config.checkSyntax) mako.predependencies('js', check)
    mako.dependencies('js', npm)
    mako.postdependencies([ 'js', 'json' ], pack)
    if (config.bundle) mako.precompile(shared)
  }

  /**
   * Convert a JSON file into a valid JS function that can be inlined.
   *
   * @param {File} file  The current file being processed.
   */
  function json (file) {
    file.contents = Buffer.concat([
      new Buffer('module.exports = '),
      file.contents,
      new Buffer(';')
    ])
  }

  /**
   * Performs a syntax check on the source file before attempting to parse
   * dependencies. This will give a better error than simply dropping into
   * file-deps.
   *
   * @param {File} file    The current file being processed.
   * @param {Build} build  The current build.
   */
  function check (file, build) {
    let timer = build.time('js:syntax')
    var err = syntax(file.contents.toString(), file.path)
    timer()
    if (err) throw err
  }

  /**
   * Mako dependencies hook that parses a JS file for `require` statements,
   * resolving them to absolute paths and adding them as dependencies.
   *
   * @param {File} file    The current file being processed.
   * @param {Build} build  The current build.
   */
  function * npm (file, build) {
    let timer = build.time('js:resolve')
    let resolver = config.browser ? bresolve : resolve

    // include node globals and environment variables
    if (config.browser) file.contents = yield postprocess(file, build.tree.root)

    file.deps = Object.create(null)
    let deps = detective(file.contents, config.detectiveOptions)
    debug('%d dependencies found for %s:', deps.length, relative(file.path))
    deps.forEach(dep => debug('> %s', dep))

    // traverse dependencies
    yield Promise.map(deps, function (dep) {
      return Promise.fromCallback(function (done) {
        let options = extend(config.resolveOptions, {
          filename: file.path,
          basedir: file.dirname,
          extensions: flatten([ '.js', '.json', config.extensions ]),
          modules: builtins
        })

        debug('resolving %s from %s', dep, relative(file.path))
        resolver(dep, options, function (err, res, pkg) {
          if (err) return done(err)
          debug('resolved %s -> %s from %s', dep, relative(res), relative(file.path))
          file.pkg = pkg
          if (!resolve.isCore(res)) {
            let depFile = build.tree.findFile(res)
            if (!depFile) depFile = build.tree.addFile(res)
            file.deps[dep] = depFile.id
            file.addDependency(depFile)
          }
          done()
        })
      })
    })

    timer()
  }

  /**
   * Inspects each file in the tree to see if it is a candidate for adding to
   * the shared bundle.
   *
   * Currently, a file is considered shared if it imported by more than 1 file.
   * This threshold will eventually be configurable.
   *
   * When a file is determined to be shared, all of it's dependencies will also
   * be included implicitly.
   *
   * @param {Build} build  The current build.
   */
  function shared (build) {
    let timer = build.time('js:bundle')
    let tree = build.tree

    let files = tree.getFiles()
      .filter(file => file.type === 'js' || file.type === 'json')

    files.forEach(file => {
      if (file.bundle) return // short-circuit
      if (tree.graph.outDegree(file.id) > 1) {
        debug('marking %s as shared', relative(file.path))
        file.bundle = true
        file.dependencies({ recursive: true }).forEach(file => {
          debug('marking %s as shared (implicitly)', relative(file.path))
          file.bundle = true
        })
      }
    })

    timer()
  }

  /**
   * Mako prewrite hook that packs all JS entry files into a single file. (also
   * removes all dependencies from the build tree)
   *
   * @param {File} file    The current file being processed.
   * @param {Build} build  The current build.
   */
  function * pack (file, build) {
    debug('pack %s', relative(file.path))
    let timer = build.time('js:pack')
    let root = isRoot(file)
    let dep = prepare(file)

    let bundle = config.bundle ? getBundle(build.tree) : null
    if (file.bundle) bundle[file.id] = dep

    // remove the dependency links for the direct dependants and merge their
    // mappings as we roll up
    file.dependants().forEach(function (parent) {
      Object.assign(initMapping(parent, bundle ? null : dep), file.mapping)
      build.tree.removeDependency(parent, file)
    })

    // only leave the entry files behind
    if (!root) {
      build.tree.removeFile(file)
    } else {
      debug('packing %s', relative(file.path))
      let mapping = values(initMapping(file, dep)).sort(sortBy('path'))
      yield doPack(file, mapping, file.base, config)

      if (bundle) {
        let bundlePath = path.resolve(file.base, config.bundle)
        if (!build.tree.findFile(bundlePath)) {
          let file = build.tree.addFile(bundlePath)
          debug('packing bundle %s', relative(file.path))
          let mapping = values(bundle).sort(sortBy('path'))
          yield doPack(file, mapping, file.base, config)
        }
      }
    }

    timer()
  }

  /**
   * Transforms the given `file` into an object that is recognized by duo-pack.
   *
   * @param {File} file      The current file being processed.
   * @param {Boolean} entry  Whether or not this file is the entry.
   * @return {Object}
   */
  function prepare (file) {
    return {
      id: file.id,
      deps: file.deps || {},
      source: file.contents.toString(),
      sourceFile: config.sourceMaps ? file.relative : null,
      entry: isRoot(file)
    }
  }

  /**
   * Helper for initializing a browserify-compatible file mapping. (without
   * clobbering an existing one)
   *
   * @param {File} file   The file object to add a mapping property to.
   * @param {Object} dep  The mapping entry to initialize with.
   * @return {Object}     The new/existing mapping.
   */
  function initMapping (file, dep) {
    if (!file.mapping) file.mapping = Object.create(null)
    if (dep) file.mapping[dep.id] = dep
    return file.mapping
  }
}

/**
 * Helper for generating objects. The returned value is always a fresh object
 * with all arguments assigned as sources.
 *
 * @return {Object}
 */
function extend () {
  var sources = [].slice.call(arguments)
  var args = [ Object.create(null) ].concat(sources)
  return Object.assign.apply(null, args)
}

/**
 * Inject node globals and env variables into the JS source code.
 *
 * @param {File} file    The file to process.
 * @param {String} root  The root directory.
 * @return {Promise}
 */
function postprocess (file, root) {
  return new Promise(function (resolve, reject) {
    pump(
      readable(file.contents),
      envify(file.path),
      insertGlobals(file.path, { basedir: root }),
      concat(resolve),
      reject
    )
  })
}

/**
 * Determine if a JS file is at the root of a dependency chain. (allows for
 * non-JS dependants, such as HTML)
 *
 * @param {File} file  The file to examine.
 * @return {Boolean}
 */
function isRoot (file) {
  // if there are no dependants, this is assumed to be a root
  let dependants = file.dependants()
  if (dependants.length === 0) return true

  // if any of the dependants are not js, (ie: html) this is a root.
  return dependants.some(file => file.type !== 'js')
}

/**
 * Perform the actual pack, which converts the mapping into an object with
 * the output code and map.
 *
 * @param {File} file      The file to send the packed results to.
 * @param {Array} mapping  The code mapping. (see module-deps)
 * @param {String} root    The build root
 * @param {Object} config  The plugin configuration.
 */
function * doPack (file, mapping, root, config) {
  let bpack = config.bundle ? { hasExports: true } : null
  let code = yield runBrowserPack(mapping, root, bpack)
  let map = convert.fromSource(code.toString())
  if (map) map.setProperty('sourceRoot', config.sourceRoot)
  file.contents = new Buffer(convert.removeComments(code.toString()))
  file.sourceMap = config.sourceMaps ? map.toObject() : null
}

/**
 * Run the code through browser-pack, which only does an inline source map.
 *
 * @param {Array} mapping     The code mapping (see module-deps)
 * @param {String} root       The build root
 * @param {Object} [options]  Additional options to pass to browser-pack
 * @return {Promise}
 */
function runBrowserPack (mapping, root, options) {
  return new Promise(function (resolve, reject) {
    pump(
      streamify(mapping),
      bpack(Object.assign({ basedir: root, raw: true }, options)),
      concat(resolve),
      reject
    )
  })
}

/**
 * Uses the build tree as a key for init/getting a bundle mapping. (this works
 * because each assemble has it's own build/tree)
 *
 * @param {Tree} tree  The build tree to use as the key.
 * @return {Object}
 */
function getBundle (tree) {
  if (!bundles.has(tree)) bundles.set(tree, Object.create(null))
  return bundles.get(tree)
}
