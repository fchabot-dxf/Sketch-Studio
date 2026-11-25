# Third-party notices

Sketch Studio's own code (the four apps and their shared packages) is under the PolyForm Noncommercial License 1.0.0 (`LICENSE.md`: free for any
noncommercial purpose). The third-party parts below keep their own licences, reproduced or pointed to here.

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
Besides the library and OrbitControls, Shaper's website carries two of its example loaders (three@0.170.0 `examples/jsm/loaders/OBJLoader.js` and
`3MFLoader.js`, unmodified, in `addons/loaders/`: task 897, Open / Insert 3D mesh), under the same licence.

## fflate

`packages/ui/vendor/three/addons/libs/fflate.module.js` : fflate 0.8.2 by Arjun Barrett, https://github.com/101arrowz/fflate : MIT licence, as three@0.170.0
ships it (`examples/jsm/libs/fflate.module.js`, unmodified; its header names the licence: https://github.com/101arrowz/fflate/blob/master/LICENSE). The 3MF
loader unzips a 3MF package with it.

```
MIT License

Copyright (c) 2023 Arjun Barrett

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

## earcut

`packages/core/plot/vendor/` : https://github.com/mapbox/earcut : ISC licence. Its licence file is kept beside it:
`packages/core/plot/vendor/earcut.LICENSE`.

## Clipper

`packages/core/plot/vendor/clipper.js` : the Clipper library by Angus Johnson (JavaScript port) : Boost Software Licence 1.0. The licence
notice is in the header of that file.

## opentype.js

`packages/ui/vendor/opentype/` : opentype.js 1.3.4 (npm `opentype.js@1.3.4`, `dist/opentype.module.js`, unmodified), https://opentype.js.org : MIT
licence. Its licence file is kept beside it: `packages/ui/vendor/opentype/LICENSE`. The Text tool reads its outline fonts with it.

## The Text tool's fonts

`packages/ui/vendor/fonts/` : the fonts the Text tool offers, each with its licence file in its folder (sources and pins: `packages/ui/vendor/fonts/README.txt`):
Inter, Roboto, Merriweather, Oswald, Anton, Bebas Neue, Pacifico (SIL Open Font License 1.1) and Roboto Slab (Apache License 2.0), the Fontsource
"latin" WOFF files; the Hershey fonts (Simplex, Duplex, Complex, Script, Italic; the Hershey Fonts notice in `hershey/LICENSE`, the hersheytext package's
MIT licence in `hershey/LICENSE-hersheytext`); Relief SingleLine (SIL Open Font License 1.1, `relief/OFL.txt`).
