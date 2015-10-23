
'use strict';

let defaults = require('defaults');
let deps = require('file-deps');
let Pack = require('duo-pack');
let path = require('path');
let resolve = require('resolve');

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
    mako.extensions('js', [ 'js', 'json' ]);
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
    file.contents = `module.exports = ${file.contents}`;
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
  function npm(file, tree, mako) {
    let basedir = path.dirname(file.path);
    let extensions = mako.extensions('js').map(function (ext) {
      return `.${ext}`;
    });

    file.deps = Object.create(null);
    if (file.isEntry()) file.mapping = Object.create(null);

    return Promise.all(deps(file.contents, 'js').map(function (dep) {
      return new Promise(function (accept, reject) {
        let options = {
          basedir: basedir,
          extensions: extensions
        };

        resolve(dep, options, function (err, res, pkg) {
          if (err) return reject(err);
          file.deps[dep] = path.relative(config.root, res);
          file.pkg = pkg;
          file.addDependency(res);
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
    // add to the mapping for any linked entry files
    tree.getEntries()
      .filter(function (entry) {
        return file.path === entry || tree.graph.hasPath(file.path, entry);
      })
      .forEach(function (entry) {
        tree.getFile(entry).mapping[file.id] = prepare(file);
      });

    // remove these dependency links
    file.dependants()
      .forEach(function (parent) {
        tree.removeDependency(parent, file.path);
      });
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
   */
  function pack(file) {
    let pack = new Pack(file.mapping);
    let results = pack.pack(file.id);
    file.contents = results.code;
    // TODO: sourcemaps
  }
};
