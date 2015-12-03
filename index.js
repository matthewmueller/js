
'use strict';

let readable = require('string-to-stream');
let resolve = require('browser-resolve');
let builtins = require('./lib/builtins');
let concat = require('concat-stream');
let defaults = require('defaults');
let deps = require('file-deps');
let Pack = require('duo-pack');
let path = require('path');

/**
 * Core plugins
 */

let insertGlobals = require('insert-module-globals');
let envify = require('envify');

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
  let mapping = Object.create(null);

  return function (mako) {
    mako.postread('json', json);
    mako.postread([ 'js', 'json' ], relative);
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
    file.contents = yield function compile(done) {
      readable(file.contents)
        .pipe(envify(file.path))
        .pipe(insertGlobals(file.path, { basedir: config.root }))
        .pipe(concat(function (buf) {
          done(null, buf);
        }));
    };

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
    var dependants = file.dependants();

    // check if the file is the topmost js file,
    // but it may not be an entry file
    // ex. html file includes a js file
    var isEntry = !dependants
      .filter(function (parent) {
        var file = tree.getFile(parent);
        return file.type === 'js';
      })
      .length;

    // add the file to the mapping
    mapping[file.id] = prepare(file, isEntry);

    // remove these dependency links
    dependants.forEach(function (parent) {
      tree.removeDependency(parent, file.path);
    });

    // only leave the entry files behind
    if (!isEntry) tree.removeFile(file.path);
  }

  /**
   * Transforms the given `file` into an object that is recognized by duo-pack.
   *
   * @param {File} file      The current file being processed.
   * @param {Boolean} entry  Whether or not this file is the entry.
   * @return {Object}
   */
  function prepare(file, entry) {
    return {
      id: file.id,
      deps: file.deps || {},
      type: file.type,
      src: file.contents,
      entry: entry
    };
  }

  /**
   * Transform the actual file code via duo-pack.
   *
   * @param {File} file  The current file being processed.
   */
  function pack(file) {
    let pack = new Pack(mapping);
    let results = pack.pack(file.id);
    file.contents = results.code;
    // TODO: sourcemaps
  }
};
