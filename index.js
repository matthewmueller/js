
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
let streamify = require('stream-array');
let syntax = require('syntax-error');
let values = require('object-values');

const pwd = process.cwd();
const relative = abs => path.relative(pwd, abs);
const bundles = new WeakMap();

// default plugin configuration
const defaults = {
  bundle: false,
  extensions: [],
  resolveOptions: null,
  root: pwd,
  sourceMaps: false,
  sourceRoot: 'file://mako'
};

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
    if (config.bundle) mako.postanalyze(bundle);
    mako.postdependencies([ 'js', 'json' ], pack);
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
   * @param {Build} build  The current build.
   */
  function check(file, build) {
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
   * @param {Build} build  The current build.
   */
  function* npm(file, build) {
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
  function bundle(build) {
    let timer = build.time('js:bundle');
    let tree = build.tree;

    tree.getFiles({ objects: true })
      .filter(file => file.type === 'js' || file.type === 'json')
      .forEach(file => {
        if (file.bundle) return; // short-circuit
        if (tree.graph.outDegree(file.path) > 1) {
          debug('adding %s to shared bundle', relative(file.path));
          file.bundle = true;
          file.dependencies({ recursive: true, objects: true }).forEach(file => {
            debug('adding %s to shared bundle (implicitly)', relative(file.path));
            file.bundle = true;
          });
        }
      });

    timer();
  }

  /**
   * Mako prewrite hook that packs all JS entry files into a single file. (also
   * removes all dependencies from the build tree)
   *
   * @param {File} file    The current file being processed.
   * @param {Build} build  The current build.
   */
  function* pack(file, build) {
    let timer = build.time('js:pack');
    let root = isRoot(file);
    let dep = prepare(file);

    let bundle = config.bundle ? getBundle(build.tree) : null;
    if (file.bundle) bundle[file.id] = dep;

    // remove the dependency links for the direct dependants and merge their
    // mappings as we roll up
    file.dependants({ objects: true }).forEach(function (parent) {
      Object.assign(initMapping(parent, bundle ? null : dep), file.mapping);
      build.tree.removeDependency(parent.path, file.path);
    });

    // only leave the entry files behind
    if (!root) {
      build.tree.removeFile(file.path);
    } else {
      debug('packing %s', relative(file.path));
      let mapping = sort(values(initMapping(file, dep)));
      yield doPack(file, mapping, config);

      if (bundle) {
        let bundlePath = path.resolve(config.root, config.bundle);
        let file = build.tree.addFile(bundlePath);
        debug('packing bundle %s', relative(file.path));
        let mapping = sort(values(bundle));
        yield doPack(file, mapping, config);
      }
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

  /**
   * Helper for initializing a browserify-compatible file mapping. (without
   * clobbering an existing one)
   *
   * @param {File} file   The file object to add a mapping property to.
   * @param {Object} dep  The mapping entry to initialize with.
   * @return {Object}     The new/existing mapping.
   */
  function initMapping(file, dep) {
    if (!file.mapping) file.mapping = Object.create(null);
    if (dep) file.mapping[dep.id] = dep;
    return file.mapping;
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
 * @param {File} file      The file to send the packed results to.
 * @param {Array} mapping  The code mapping. (see module-deps)
 * @param {Object} config  The plugin configuration.
 */
function* doPack(file, mapping, config) {
  let bpack = config.bundle ? { hasExports: true } : null;
  let code = yield runBrowserPack(mapping, config.root, bpack);
  let map = convert.fromSource(code);
  if (map) map.setProperty('sourceRoot', config.sourceRoot);
  file.contents = convert.removeComments(code);
  file.sourcemap = config.sourceMaps ? map.toObject() : null;
}

/**
 * Run the code through browser-pack, which only does an inline source map.
 *
 * @param {Array} mapping     The code mapping (see module-deps)
 * @param {String} root       The build root
 * @param {Object} [options]  Additional options to pass to browser-pack
 * @return {Promise}
 */
function runBrowserPack(mapping, root, options) {
  return new Promise(function (resolve, reject) {
    streamify(mapping)
      .pipe(bpack(Object.assign({ basedir: root, raw: true }, options)))
      .on('error', reject)
      .pipe(concat({ encoding: 'string' }, resolve));
  });
}

/**
 * Uses the build tree as a key for init/getting a bundle mapping. (this works
 * because each assemble has it's own build/tree)
 *
 * @param {Tree} tree  The build tree to use as the key.
 * @return {Object}
 */
function getBundle(tree) {
  if (!bundles.has(tree)) {
    bundles.set(tree, Object.create(null));
  }

  return bundles.get(tree);
}
