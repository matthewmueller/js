
'use strict';

let bpack = require('browser-pack');
let builtins = require('./lib/builtins');
let concat = require('concat-stream');
let convert = require('convert-source-map');
let debug = require('debug')('mako-js');
let deps = require('file-deps');
let envify = require('envify');
let flatten = require('array-flatten');
let insertGlobals = require('insert-module-globals');
let path = require('path');
let readable = require('string-to-stream');
let resolve = require('browser-resolve');
let sourcemaps = require('mako-sourcemaps');
let syntax = require('syntax-error');
let values = require('object-values');

const pwd = process.cwd();
const relative = abs => path.relative(pwd, abs);

// default plugin configuration
const defaults = {
  extensions: [],
  resolveOptions: null,
  root: pwd,
  sourceMaps: false,
  sourceRoot: 'file://mako'
};

// memory-efficient way of tracking mappings per-build
const mappings = new WeakMap();

/**
 * Initialize the mako js plugin.
 *
 * Available options:
 *  - root {String}  The root directory (default: pwd)
 *
 * @param {Object} options  Configuration.
 * @return {Function}
 */
module.exports = function (options) {
  debug('initialize %j', options);
  let config = extend(defaults, options);

  return function (mako) {
    mako.postread('json', json);
    mako.predependencies([ 'js', 'json' ], id);
    mako.predependencies('js', check);
    mako.dependencies('js', npm);
    mako.postdependencies([ 'js', 'json' ], pack);

    if (config.sourceMaps) {
      mako.use(sourcemaps('js', { inline: config.sourceMaps === 'inline' }));
    }
  };

  /**
   * Convert a JSON file into a valid JS function that can be inlined.
   *
   * @param {File} file  The current file being processed.
   */
  function json(file) {
    file.contents = 'module.exports = ' + file.contents + ';';
  }

  /**
   * Adds an id for each file that's the relative path from the root.
   *
   * @param {File} file  The current file being processed.
   */
  function id(file) {
    file.id = path.relative(config.root, file.path);
  }

  /**
   * Performs a syntax check on the source file before attempting to parse
   * dependencies. This will give a better error than simply dropping into
   * file-deps.
   *
   * @param {File} file    The current file being processed.
   * @param {Tree} tree    The current build tree.
   * @param {Build} build  The current build.
   */
  function check(file, tree, build) {
    let timer = build.time('js:syntax');
    var err = syntax(file.contents, file.path);
    timer();
    if (err) throw err;
  }

  /**
   * Mako dependencies hook that parses a JS file for `require` statements,
   * resolving them to absolute paths and adding them as dependencies.
   *
   * @param {File} file    The current file being processed.
   * @param {Tree} tree    The current build tree.
   * @param {Build} build  The current build.
   */
  function* npm(file, tree, build) {
    let timer = build.time('js:resolve');

    file.deps = Object.create(null);

    // include node globals and environment variables
    file.contents = yield postprocess(file, config.root);

    // traverse dependencies
    yield Promise.all(deps(file.contents, 'js').map(function (dep) {
      return new Promise(function (accept, reject) {
        let options = extend(config.resolveOptions, {
          filename: file.path,
          extensions: flatten([ '.js', '.json', config.extensions ]),
          modules: builtins
        });

        let parent = relative(file.path);
        debug('resolving %s from %s', dep, parent);
        resolve(dep, options, function (err, res, pkg) {
          if (err) return reject(err);
          let child = relative(res);
          debug('resolved %s -> %s from %s', dep, child, parent);
          file.pkg = pkg;
          file.deps[dep] = path.relative(config.root, res);
          file.addDependency(res);
          accept();
        });
      });
    }));

    timer();
  }

  /**
   * Mako prewrite hook that packs all JS entry files into a single file. (also
   * removes all dependencies from the build tree)
   *
   * @param {File} file    The current file being processed.
   * @param {Tree} tree    The current build tree.
   * @param {Build} build  The current build.
   */
  function* pack(file, tree, build) {
    let timer = build.time('js:pack');

    let mapping = getMapping(tree);
    let root = isRoot(file);

    // add this file to the mapping
    mapping[file.id] = prepare(file);

    // remove the dependency links for the direct dependants
    file.dependants().forEach(function (parent) {
      tree.removeDependency(parent, file.path);
    });

    // only leave the entry files behind
    if (!root) {
      tree.removeFile(file.path);
    } else {
      debug('packing %s', relative(file.path));
      let sourceMaps = config.sourceMaps;
      let sourceRoot = config.sourceRoot;
      let root = config.root;
      let results = yield doPack(sort(values(mapping)), sourceMaps, sourceRoot, root);

      file.contents = results.code;
      file.sourcemap = results.map;
    }

    timer();
  }

  /**
   * Transforms the given `file` into an object that is recognized by duo-pack.
   *
   * @param {File} file      The current file being processed.
   * @param {Boolean} entry  Whether or not this file is the entry.
   * @return {Object}
   */
  function prepare(file) {
    return {
      id: file.id,
      deps: file.deps || {},
      source: file.contents,
      sourceFile: config.sourceMaps ? file.id : null,
      entry: isRoot(file)
    };
  }
};

/**
 * Helper for generating objects. The returned value is always a fresh object
 * with all arguments assigned as sources.
 *
 * @return {Object}
 */
function extend() {
  var sources = [].slice.call(arguments);
  var args = [ Object.create(null) ].concat(sources);
  return Object.assign.apply(null, args);
}

/**
 * Sort the dependencies
 *
 * @param {Array} deps  The deps to sort. (with id props)
 * @return {Array}
 */
function sort(deps) {
  return deps.sort(function (a, b) {
    return a.id < b.id ? -1 : 1;
  });
}

/**
 * Inject node globals and env variables into the JS source code.
 *
 * @param {File} file    The file to process.
 * @param {String} root  The root directory.
 * @return {Promise}
 */
function postprocess(file, root) {
  return new Promise(function (resolve, reject) {
    readable(file.contents)
      .pipe(envify(file.path))
      .on('error', reject)
      .pipe(insertGlobals(file.path, { basedir: root }))
      .on('error', reject)
      .pipe(concat({ encoding: 'string' }, resolve));
  });
}

/**
 * Retrieve the mapping for this build tree, create one if necessary.
 *
 * @param {Tree} tree  The build tree to use as the key.
 * @return {Object}
 */
function getMapping(tree) {
  if (!mappings.has(tree)) {
    mappings.set(tree, Object.create(null));
  }

  return mappings.get(tree);
}

/**
 * Determine if a JS file is at the root of a dependency chain. (allows for
 * non-JS dependants, such as HTML)
 *
 * @param {File} file  The file to examine.
 * @return {Boolean}
 */
function isRoot(file) {
  // short-circuit, an entry file is automatically considered a root
  if (file.entry) return true;

  // if there are no dependants, this is assumed to be a root (this could
  // possibly be inferred from file.entry)
  let dependants = file.dependants({ objects: true });
  if (dependants.length === 0) return true;

  // if any of the dependants are not js, (ie: html) this is a root.
  return dependants.some(file => file.type !== 'js');
}

/**
 * Perform the actual pack, which converts the mapping into an object with
 * the output code and map.
 *
 * @param {Array} mapping              The code mapping (see module-deps)
 * @param {Boolean|String} sourceMaps  Whether to include source-maps
 * @param {String} sourceRoot          The root url for the source-maps
 * @param {String} root                The build root
 * @return {Object}
 */
function* doPack(mapping, sourceMaps, sourceRoot, root) {
  let code = yield runBrowserPack(mapping, root);
  let map = convert.fromSource(code);

  if (map) map.setProperty('sourceRoot', sourceRoot);

  return {
    code: convert.removeComments(code),
    map: sourceMaps ? map.toObject() : null
  };
}

/**
 * Run the code through browser-pack, which only does an inline source map.
 *
 * @param {Array} mapping  The code mapping (see module-deps)
 * @param {String} root    The build root
 * @return {Promise}
 */
function runBrowserPack(mapping, root) {
  return new Promise(function (resolve, reject) {
    readable(JSON.stringify(mapping))
      .pipe(bpack({ basedir: root }))
      .on('error', reject)
      .pipe(concat({ encoding: 'string' }, resolve));
  });
}
