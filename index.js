
'use strict';

let builtins = require('./lib/builtins');
let concat = require('concat-stream');
let defaults = require('defaults');
let deps = require('file-deps');
let envify = require('envify');
let insertGlobals = require('insert-module-globals');
let Pack = require('duo-pack');
let path = require('path');
let readable = require('string-to-stream');
let resolve = require('browser-resolve');
let syntax = require('syntax-error');

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
  let config = defaults(options, { root: process.cwd() });

  return function (mako) {
    mako.postread('json', json);
    mako.predependencies([ 'js', 'json' ], relative);
    mako.predependencies('js', check);
    mako.dependencies('js', npm);
    mako.postdependencies([ 'js', 'json' ], combine);
    mako.prewrite('js', pack);
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
  function relative(file) {
    file.id = path.relative(config.root, file.path);
  }

  /**
   * Performs a syntax check on the source file before attempting to parse
   * dependencies. This will give a better error than simply dropping into
   * file-deps.
   *
   * @param {File} file  The current file being processed.
   */
  function check(file) {
    var err = syntax(file.contents, file.path);
    if (err) throw err;
  }

  /**
   * Mako dependencies hook that parses a JS file for `require` statements,
   * resolving them to absolute paths and adding them as dependencies.
   *
   * @param {File} file     The current file being processed.
   * @param {Tree} tree     The build tree.
   * @param {Builder} mako  The mako builder instance.
   * @return {Promise}
   */
  function* npm(file) {
    file.deps = Object.create(null);

    // include node globals and environment variables
    file.contents = yield postprocess(file, config.root);

    // traverse dependencies
    return yield Promise.all(deps(file.contents, 'js').map(function (dep) {
      return new Promise(function (accept, reject) {
        let options = {
          filename: file.path,
          extensions: [ '.js', '.json' ],
          modules: builtins
        };

        resolve(dep, options, function (err, id, pkg) {
          if (err) return reject(err);
          file.pkg = pkg;
          file.deps[dep] = path.relative(config.root, id);
          file.addDependency(id);
          accept();
        });
      });
    }));
  }

  /**
   * Mako prewrite hook that packs all JS entry files into a single file. (also
   * removes all dependencies from the build tree)
   *
   * @param {File} file     The current file being processed.
   * @param {Tree} tree     The build tree.
   * @param {Builder} mako  The mako builder instance.
   */
  function combine(file, tree) {
    let mapping = getMapping(tree);

    // add this file to the mapping
    mapping[file.id] = prepare(file);

    // remove the dependency links for the direct dependants
    file.dependants().forEach(function (parent) {
      tree.removeDependency(parent, file.path);
    });

    // only leave the entry files behind
    if (!isRoot(file)) tree.removeFile(file.path);
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
      type: file.type,
      src: file.contents,
      entry: file.isEntry()
    };
  }

  /**
   * Transform the actual file code via duo-pack.
   *
   * @param {File} file  The current file being processed.
   * @param {Tree} tree  The build tree.
   */
  function pack(file, tree) {
    let mapping = getMapping(tree);
    let pack = new Pack(mapping);
    let results = pack.pack(file.id);
    file.contents = results.code;
    // TODO: sourcemaps
  }
};


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
      .pipe(concat(resolve));
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
  // TODO: support other file types (eg: coffee, es, ts)
  return dependants.some(file => file.type !== 'js');
}
