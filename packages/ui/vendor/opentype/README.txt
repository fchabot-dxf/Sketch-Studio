opentype.js 1.3.4 (MIT, LICENSE beside it): dist/opentype.module.js of the npm package opentype.js@1.3.4, vendored unmodified.
TASK 845: it reads the TEXT tool's outline fonts (the bundled WOFF files in ../fonts and a font the user loads: .ttf / .otf / .woff).
Loaded only when a text needs an outline font (packages/ui/text-fonts.js imports it dynamically).
