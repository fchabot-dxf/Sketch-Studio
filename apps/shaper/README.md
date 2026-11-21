# Shaper

The Shaper app of Sketch Studio: turn a sketch into cuts for the Shaper Origin handheld CNC. It is a thin app over the shared Design tab
(`packages/ui/`) and engine (`packages/core/`); the repo's overview is `README.md` at the repo root.

- Steps (declared in `apps/shaper/src/modes.js`): **Design** (the shared sketcher), **Prepare** (the cuts), **Export** (the 3D board and the
  export card). In a Fusion 360 palette (`?host=fusion`) the Design step is hidden.
- The Origin export is in `packages/core/shaper-export.js`; the Origin's rules are indexed in `docs/ORIGIN-RULES.md`.
- Run it: `node server.js` at the repo root, then open http://localhost:8000/apps/shaper/.
- Its own folders: `src/` (modules), `styles/`, `assets/`, `samples/`.
