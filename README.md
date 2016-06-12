# mako-js

> A mako plugin for working with JS, using npm as a package manager.

[![npm version](https://img.shields.io/npm/v/mako-js.svg)](https://www.npmjs.com/package/mako-js)
[![npm dependencies](https://img.shields.io/david/makojs/js.svg)](https://david-dm.org/makojs/js)
[![npm dev dependencies](https://img.shields.io/david/dev/makojs/js.svg)](https://david-dm.org/makojs/js#info=devDependencies)
[![build status](https://img.shields.io/travis/makojs/js.svg)](https://travis-ci.org/makojs/js)
[![coverage](https://img.shields.io/coveralls/makojs/js.svg)](https://coveralls.io/github/makojs/js)

## Usage

This plugin allows writing JS in such a way that it can be consumed by both Node and the browser.
(in many ways, this mirrors the functionality of [Browserify](http://browserify.org/), but it still
needs some work to come to 100% feature parity)

```js
var mako = require('mako');
var text = require('mako-text');
var js = require('mako-js');
var path = require('path');

var entry = path.resolve('./index.js');

mako()
  // read JS and JSON files as text
  .use(text([ 'js', 'json' ]))
  // set up the JS plugin
  .use(js())
  // build
  .build(entry)
  .then(function (tree) {
    var file = tree.getFile(entry);
    console.log(file.contents);
    // the bundled JS
  });
```

## API

### js(options)

Create a new plugin instance, with the following `options` available:

 - `bundle` if set, should be a pathname (relative to `root`) that specifies an extra file to put shared dependencies in
 - `extensions` additional extensions to resolve with **in addition to** `.js` and `.json` (eg: `.coffee`)
 - `resolveOptions` additional options to be passed to [resolve](https://www.npmjs.com/package/resolve)
 - `sourceMaps` specify `true` to enable source-maps (default: `false`)
 - `sourceRoot` specifies the path used as the source map root (default: `"mako://"`)

## Dependencies

 - a read plugin for `js` and `json` extensions that has populated `file.contents` with a string

## Effects

During **analyze**, this will parse JS files for `require(...)` statements for dependencies, then
resolving them via [resolve](https://www.npmjs.com/package/resolve).

During **assemble**, each _entry_ JS file will have all of it's dependencies bundled into a single
file. Along the way, those dependencies will be _removed_ from the tree, leaving only the output
files behind.

## About Source Maps

By enabling source-maps with `sourceMaps: true`, this simply generates `file.sourceMap` which is a plain
object with the source-map metadata. Use another plugin such as [mako-sourcemaps](https://github.com/makojs/sourcemaps)
to take this object and write it to an external file or as an inline comment.
