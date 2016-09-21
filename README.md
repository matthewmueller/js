# mako-js

> A [mako][mako] plugin for working with JS, using npm as a package manager.

[![npm version][npm-badge]][npm]
[![build status][travis-badge]][travis]
[![coverage][coveralls-badge]][coveralls]
[![npm dependencies][david-badge]][david]
[![npm dev dependencies][david-dev-badge]][david-dev]
[![code style][standard-badge]][standard]

## Purpose

 - compiles each entry file recursively via `require(...)` statements into a single output file
   (similar to browserify/webpack)
 - makes JSON files `require`-able
 - allow for creating a shared dependency bundle
 - generates proper source maps (to be written by [mako-sourcemaps][mako-sourcemaps])

## API

### js(options)

Create a new plugin instance, with the following `options` available:

 - `browser` if unset, will disable browser-specific features, resulting in a script that can run in node
 - `bundle` if set, should be a pathname (relative to `root`) that specifies an extra file to put shared dependencies in
 - `checkSyntax` if unset, will disable the syntax check hook
 - `core` adds a list of custom "core modules" to [resolve][resolve]
 - `detectiveOptions` additional options to be passed to [detective][detective]
 - `extensions` additional extensions to resolve with **in addition to** `.js` and `.json` (eg: `.coffee`)
 - `modules` additional modules to be passed to [browser-resolve][browser-resolve]
 - `resolveOptions` additional options to be passed to [resolve][resolve]
 - `sourceMaps` specify `true` to enable source-maps (default: `false`)
 - `sourceRoot` specifies the path used as the source map root (default: `"mako://"`)


[mako]: https://github.com/makojs/core
[mako-sourcemaps]: https://github.com/makojs/sourcemaps
[resolve]: https://www.npmjs.com/package/resolve
[browser-resolve]: https://www.npmjs.com/package/browser-resolve
[detective]: https://www.npmjs.com/package/detective
[coveralls]: https://coveralls.io/github/makojs/js
[coveralls-badge]: https://img.shields.io/coveralls/makojs/js.svg
[david]: https://david-dm.org/makojs/js
[david-badge]: https://img.shields.io/david/makojs/js.svg
[david-dev]: https://david-dm.org/makojs/js#info=devDependencies
[david-dev-badge]: https://img.shields.io/david/dev/makojs/js.svg
[npm]: https://www.npmjs.com/package/mako-js
[npm-badge]: https://img.shields.io/npm/v/mako-js.svg
[standard]: http://standardjs.com/
[standard-badge]: https://img.shields.io/badge/code%20style-standard-brightgreen.svg
[travis]: https://travis-ci.org/makojs/js
[travis-badge]: https://img.shields.io/travis/makojs/js.svg
