# Refactor Suggestions — Sketch Studio (Compact)

> Short, prioritized refactor suggestions to improve readability, testability, and long-term maintainability.

---

## 🎯 Goal
Make the codebase easier to reason about and extend by modularizing, extracting responsibilities, and adding small testable units.

---

## ✅ Quick Wins (High impact, low risk)

1. **Extract glyph rendering** 🔧
   - Move `drawConstraintGlyph()` and related glyph layout from `src/4-render.js` into `src/render/glyphs.js`.
   - Benefit: smaller `draw()` function and independent testing of glyph placement and preview behavior.

2. **Centralize selection logic** 🔁 — **DONE (2026-01-29)**
   - Implemented: `src/selection.js` with `attachSelection(state)` and helpers (`selectItem`, `clearSelection`, `add`, `remove`, `toggle`, `get`, `isSelected`). Backwards-compatible shims (`state.selectItem`, `state.clearSelection`, `state.selectionAdd`, etc.) were attached for incremental migration.
   - Migration & tests: migrated several callers (dim label single click, joint auto-select, line selection) to use `state.selectItem()`; added `test/selection.test.mjs` and updated `package.json` test script; tests pass locally (Node v24).
   - Benefit: selection semantics centralized, easier to test, and safer to refactor (reduces scattered direct mutations).

2.1 **Centralize deletion logic** 🗑️ — **DONE (2026-01-29)**
   - Implemented: `src/delete.js` which exports `deleteSelected(state)` to make deletes atomic and undoable. `src/6-input.js` now delegates Delete key handling and glyph deletion to `deleteSelected(state)` (with safe fallbacks).
   - Tests: added `test/delete.test.mjs`, `test/delete-routing.test.mjs`, and `test/no-direct-selection-writes.test.mjs` to validate delete behavior and to ensure direct `state.selected*` writes only exist in `src/selection.js`.
   - Notes: I intentionally did **not** edit the duplicate `SKETCH STUDIO` folder or generated files in `export/` (those are build artifacts). Recommend regenerating exports if you want artifacts updated.

3. **Tidy draw signature** ✨
   - Replace long argument list with a `renderOpts` object (e.g., `draw(state, svg, opts)`).
   - Benefit: reduces churn when adding render flags and makes calls clearer.

---

## ⚡ Medium-term (Moderate impact)

4. **Split tools in `6-input.js`** 🧩
   - Move per-tool logic into `src/tools/` (e.g., `line.js`, `rect.js`, `constraints/coincident.js`). Keep a small dispatcher in `6-input.js`.
   - Benefit: readable tool modules, easier to unit test pointer flows and fix tool-specific bugs.

5. **Separate snap & inference** 🧭
   - Split `3-snap.js` into `snap/hit.js` and `snap/inference.js`.
   - Benefit: independent tuning of hit tests vs inference heuristics.

6. **Modularize solver cases** 🧮
   - Implement a constraint handler registry: `constraint-handlers/coincident.js`, `horizontal.js`, etc. Use a simple map `type -> handler` inside `2-solver.js`.
   - Benefit: easier to add a new constraint and unit-test solver logic per type.

---

## 🧰 Architectural Changes (Longer term)

7. **History / Undo module** ⏪
   - Move undo grouping (`beginGroup`, `endGroup`, `cancelGroup`, `saveState`, `undo`) into `src/history.js`.
   - Benefit: enables future improvements (patch diffs, redo, time-travel) while keeping `state` small.

8. **Canonical deletion API in engine** ⚙️
   - Add `removeShapeCascade(id)`, `removeJointCascade(id)`, `removeConstraint(id)` in `src/5-engine.js` to centralize safe deletions and cleanup.
   - Benefit: prevents orphan joint/constraint bugs and removes ad-hoc splices across modules.

9. **Dev-only `validateState()`** 🔎
   - Add `src/debug/validateState.js` that checks invariants (shape joints exist, constraints referents exist, no duplicate constraints, no orphan joints).
   - Benefit: catch regressions during refactors and especially when changing undo/group semantics.

---

## ✅ Tests & Migration Plan

- Add unit tests for:
  - Selection semantics and toggling
  - Per-constraint solve handlers
  - Hit tests and inference
  - Undo group commit/cancel behavior

- Migration approach:
  1. Implement new module with identical behavior + tests.
  2. Add a thin compatibility shim that proxies old calls to the new API.
  3. Replace usages and remove old code once tests pass.

---

## 📋 Prioritization & Rough Estimates

- **Short term (1–2 days):** Extract glyphs, move selection helpers, add `validateState()` (low risk).
- **Mid term (3–5 days):** Split `6-input.js` into tool modules and add tests (medium risk).
- **Long term (1–2 weeks):** Solver registry, history module, engine cascade deletions (higher risk; requires tests).

---

If you want, I can implement one of the **quick wins** now and add tests and a thin compatibility shim. Which one should I start with? ✅

---

## Change Log

- **2026-01-29**: Created `src/selection.js` and attached a canonical selection API (`attachSelection(state)`). The module exports helper functions: `selectItem`, `clearSelection`, `add`, `remove`, `toggle`, `get`, and `isSelected`. It also attaches backward-compatible shims on `state` (`state.selectItem`, `state.clearSelection`, `state.selectionAdd`, etc.) to make incremental migration straightforward.
- **2026-01-29**: Added `test/selection.test.mjs` and updated `package.json` to include a `test` script (`node --test`). Unit tests for the selection module pass locally (Node v24).
- **2026-01-29**: Migrated several selection call paths in `src/6-input.js` to use the canonical API (dim label click, joint auto-select, line selection) and attached selection in bootstrap (`attachSelection(state)` in `src/8-main.js`).
- **2026-01-29**: Implemented `src/delete.js` with `deleteSelected(state)` and migrated Delete handling in `src/6-input.js` to delegate to it. Added tests `test/delete-routing.test.mjs` and `test/no-direct-selection-writes.test.mjs` to assert Delete routing and to ensure direct writes to `state.selectedShape`/`state.selectedConstraint` only exist in `src/selection.js`. All added tests pass locally.

**Notes:** I did not modify the `SKETCH STUDIO` duplicate folder or generated `export/` artifacts; regenerate exports if you want the artifacts updated.

**Next steps:** migrate remaining direct selection writes (other spots in `6-input.js` and `7-ui.js`), add CI (recommended: GitHub Actions running `node --test` on push/PR), and add `validateState()` dev checks to detect invariant breaks early.
