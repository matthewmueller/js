# mako-js

> A mako plugin for working with JS, using npm as a package manager.

[![npm version](https://img.shields.io/npm/v/mako-js.svg)](https://www.npmjs.com/package/mako-js)
[![build status](https://img.shields.io/travis/makojs/js.svg)](https://travis-ci.org/makojs/js)
[![coverage](https://img.shields.io/coveralls/makojs/js.svg)](https://coveralls.io/github/makojs/js)
[![npm dependencies](https://img.shields.io/david/makojs/js.svg)](https://david-dm.org/makojs/js)
[![npm dev dependencies](https://img.shields.io/david/dev/makojs/js.svg)](https://david-dm.org/makojs/js#info=devDependencies)

## Purpose

 - compiles each entry file recursively via `require(...)` statements into a single output file
   (similar to browserify/webpack)
 - makes JSON files `require`-able
 - allow for creating a shared dependency bundle
 - generates proper source maps (to be written by [mako-sourcemaps](https://github.com/makojs/sourcemaps))

## API

### js(options)

Create a new plugin instance, with the following `options` available:

 - `bundle` if set, should be a pathname (relative to `root`) that specifies an extra file to put shared dependencies in
 - `detectiveOptions` additional options to be passed to [detective](https://www.npmjs.com/package/detective)
 - `extensions` additional extensions to resolve with **in addition to** `.js` and `.json` (eg: `.coffee`)
 - `resolveOptions` additional options to be passed to [resolve](https://www.npmjs.com/package/resolve)
 - `sourceMaps` specify `true` to enable source-maps (default: `false`)
 - `sourceRoot` specifies the path used as the source map root (default: `"mako://"`)
