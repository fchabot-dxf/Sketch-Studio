// MOVED → apps/sketchstudio/ui/export-manager.js (shell batch slice 1).
// Re-export shim at the OLD path so unmoved importers + tests resolve through the move.
// SHELL→shell re-export via the #app/ alias (isomorphic: browser importmap + Node package.json
// "imports"). Removed in the later rewire/cleanup slice once all importers point at #app/.
// export-manager has only named exports (no default), so `export *` is complete.
export * from '#app/ui/export-manager.js';
