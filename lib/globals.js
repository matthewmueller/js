/**
 * Module dependencies
 */

var parseScope = require('lexical-scope')
var merge = require('xtend')

var path = require('path')
var processPath = require.resolve('process/browser.js')
var isbufferPath = require.resolve('is-buffer')
var combineSourceMap = require('combine-source-map')

/**
 * Defaults
 */

var defaultVars = {
  process: function (file) {
    var relpath = getRelativeRequirePath(processPath, file)
    return 'require(' + JSON.stringify(relpath) + ')'
  },
  global: function () {
    return 'typeof global !== "undefined" ? global : ' +
      'typeof self !== "undefined" ? self : ' +
      'typeof window !== "undefined" ? window : {}'
  },
  'Buffer.isBuffer': function (file) {
    var relpath = getRelativeRequirePath(isbufferPath, file)
    return 'require(' + JSON.stringify(relpath) + ')'
  },
  Buffer: function () {
    return 'require("buffer").Buffer'
  },
  __filename: function (file, basedir) {
    var filename = '/' + path.relative(basedir, file)
    return JSON.stringify(filename)
  },
  __dirname: function (file, basedir) {
    var dir = path.dirname('/' + path.relative(basedir, file))
    return JSON.stringify(dir)
  }
}

/**
 * Export `globals`
 */

module.exports = globals

function getRelativeRequirePath (fullPath, fromPath) {
  var relpath = path.relative(path.dirname(fromPath), fullPath)
  // If fullPath is in the same directory as fromPath, relpath will
  // result in something like "index.js". require() needs "./" prepended
  // to these paths.
  if (path.dirname(relpath) === '.') {
    relpath = './' + relpath
  }
  // On Windows: Convert path separators to what require() expects
  if (path.sep === '\\') {
    relpath = relpath.replace(/\\/g, '/')
  }
  return relpath
}

/**
 * Initialize `globals`
 */

function globals (contents, filepath, opts) {
  var basedir = opts.basedir || '/'
  var vars = merge(defaultVars, opts.vars)
  var varNames = Object.keys(vars).filter(function (name) {
    return typeof vars[name] === 'function'
  })

  var quick = RegExp(varNames.map(function (name) {
    return '\\b' + name + '\\b'
  }).join('|'))

  var source = contents.toString('utf8')
    .replace(/^\ufeff/, '')
    .replace(/^#![^\n]*\n/, '\n')

  if (opts.always !== true && !quick.test(source)) {
    return source
  }

  try {
    var scope = opts.always
      ? { globals: { implicit: varNames } }
      : parseScope('(function(){\n' + source + '\n})()')
  } catch (err) {
    var e = new SyntaxError(
      (err.message || err) + ' while parsing ' + filepath
    )
    e.type = 'syntax'
    e.filename = filepath
    return this.emit('error', e)
  }

  var globals = {}

  varNames.forEach(function (name) {
    if (!/\./.test(name)) return
    var parts = name.split('.')
    var prop = (scope.globals.implicitProperties || {})[parts[0]]
    if (!prop || prop.length !== 1 || prop[0] !== parts[1]) return
    var value = vars[name](filepath, basedir)
    if (!value) return
    globals[parts[0]] = '{' + JSON.stringify(parts[1]) + ':' + value + '}'
  })
  varNames.forEach(function (name) {
    if (/\./.test(name)) return
    if (globals[name]) return
    if (scope.globals.implicit.indexOf(name) < 0) return
    var value = vars[name](filepath, basedir)
    if (!value) return
    globals[name] = value
  })

  return closeOver(globals, source, filepath, opts)
}

function closeOver (globals, src, file, opts) {
  var keys = Object.keys(globals)
  if (keys.length === 0) return src
  var values = keys.map(function (key) { return globals[key] })

  var wrappedSource
  if (keys.length <= 3) {
    wrappedSource = '(function (' + keys.join(',') + '){\n' +
      src + '\n}).call(this,' + values.join(',') + ')'
  } else {
    // necessary to make arguments[3..6] still work for workerify etc
    // a,b,c,arguments[3..6],d,e,f...
    var extra = [ '__argument0', '__argument1', '__argument2', '__argument3' ]
    var names = keys.slice(0, 3).concat(extra).concat(keys.slice(3))
    values.splice(3, 0,
      'arguments[3]', 'arguments[4]',
      'arguments[5]', 'arguments[6]'
    )
    wrappedSource = '(function (' + names.join(',') + '){\n' +
      src + '\n}).call(this,' + values.join(',') + ')'
  }

  // Generate source maps if wanted. Including the right offset for
  // the wrapped source.
  if (!opts.debug) {
    return wrappedSource
  }
  var sourceFile = path.relative(opts.basedir, file)
    .replace(/\\/g, '/')
  var sourceMap = combineSourceMap.create().addFile(
    { sourceFile: sourceFile, source: src },
    { line: 1 })
  return combineSourceMap.removeComments(wrappedSource) + '\n' +
    sourceMap.comment()
}
