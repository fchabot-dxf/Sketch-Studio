# Third-party notices

Sketch Studio (the four apps and their shared packages) is free to use; its own code is not offered under an open-source licence
(package.json: UNLICENSED). It includes or builds on the work below, each under its own licence, reproduced or pointed to here.

## shaper-sync (ShaperHub upload)

`packages/core/shaper-cloud.js` (used by `functions/api/shaper-upload.js` and `server.js`: the Shaper app's "Sync to ShaperHub") is a
JavaScript port of the ShaperHub calls of **shaper-sync** by Antoine Millet, https://github.com/NaPs/shaper-sync (`shaper_sync.py`).

```
MIT License

Copyright (c) 2026 Antoine Millet

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## three.js

`packages/ui/vendor/three/` : https://threejs.org : MIT licence. Its licence file is kept beside it: `packages/ui/vendor/three/LICENSE`.

## earcut

`packages/core/plot/vendor/` : https://github.com/mapbox/earcut : ISC licence. Its licence file is kept beside it:
`packages/core/plot/vendor/earcut.LICENSE`.

## Clipper

`packages/core/plot/vendor/clipper.js` : the Clipper library by Angus Johnson (JavaScript port) : Boost Software Licence 1.0. The licence
notice is in the header of that file.
