# mako-js

> A mako plugin that bundles a collection of JS files into a single output file.
(example: [duo](http://duojs.org/), [browserify](http://browserify.org/))

[![npm version](https://img.shields.io/npm/v/mako-js.svg)](https://www.npmjs.com/package/mako-js)
[![npm dependencies](https://img.shields.io/david/makojs/js.svg)](https://david-dm.org/makojs/js)
[![npm dev dependencies](https://img.shields.io/david/dev/makojs/js.svg)](https://david-dm.org/makojs/js#info=devDependencies)
[![build status](https://img.shields.io/travis/makojs/js.svg)](https://travis-ci.org/makojs/js)

## Usage

```js
var mako = require('mako');
var stat = require('mako-stat');
var text = require('mako-text');
var js = require('mako-js');

mako()
  .use(stat([ 'js', 'json' ]))
  .use(text([ 'js', 'json' ]))
  .use(js())
  .build('./index.js')
  .then(function () {
    // done!
  });
```

## API

### js(options)

Create a new plugin instance, with the following `options` available:

 - `root` the root for the project, paths will be set relative to here (default: `pwd`)

## Dependencies

 - a read plugin for `js` and `json` extensions that has populated `file.contents` with a string

## Side Effects

During analyze, this will parse JS files for `require` statements that are used to resolve dependencies.

During build, each entry JS file will be bundled into a single output file, all the dependencies will be pruned from the build tree.

## Use-Cases

This seeks to accomplish what build tools like Duo and Browserify do for front-end workflows.
