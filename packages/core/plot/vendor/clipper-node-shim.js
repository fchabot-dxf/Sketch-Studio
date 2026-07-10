// PP-2b-1: Node-load shim for the PRISTINE vendored clipper.js (a browser UMD). Its top-level does
// `self['ClipperLib'] = ClipperLib` on the non-Node, non-document branch — which THROWS in Node ESM (no `self`).
// Aliasing self -> globalThis makes that assignment land harmlessly. Imported BEFORE clipper.js in clip.js so it
// runs first (ESM evaluates a module's imports in source order). No-op in a browser (self already exists; there
// the `document` branch is taken anyway). Keeps clipper.js UNFORKED and #core/plot Node-testable.
globalThis.self ??= globalThis;
