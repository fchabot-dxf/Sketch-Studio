# WORK-LOG — worker's durable trail (APPEND ONLY)

> One entry per step/handoff. `git diff` records WHAT changed; these entries record WHY —
> micro-decisions, dead-ends, anything not visible in the code. ROADMAP.md is the advisor's
> (read-only here); this file is the worker's. Newest entries at the bottom.

---

## 2026-06-27 — Inaugural: Phase 1 carve-out gate BLESSED (split + geometry override)

- **did:** Posted the full `src/` core/shell classification gate; advisor verified every call
  against git (not summary) and blessed it, with one override + one debt-log. First real use of the
  worker loop. No files moved yet — gate just cleared.
- **the blessed split:**
  - → **packages/core** (brain; app-agnostic, framework-free): `core/solver/*`;
    `core/{geometry,joints,shapes,constraints,constraint-status,constraint-verifier,snap-constraints,
    delete-manager,geometry-fans,state,constants,solver-config}.js`; `constraint-solver.js`;
    `solver-core.js`; `solver-core.legacy.js`; `ui/inference-engine.js` (pure inference, misfiled under ui/).
  - → **apps/sketchstudio** (shell): `main.js`, `svg-renderer.js`, `snap-detection.js`,
    `core/debug.js`, `core/settings-manager.js`, `ui/**`, `index.html`, `styles/`, `assets/`.
- **three extractions** (keep core clean — emit via callback, don't exile the logic):
  1. `constraint-solver.js:97` `window.__updateSolverMetrics` (also set by `tuning-wizard.js:20`) → injected metrics callback.
  2. `constraint-solver.js` `findSnap`/`hitJointAtScreen` pass-throughs import `snap-detection` (screen-space) → leave in shell; only the pure solve-wrapper goes to core.
  3. `constraint-manager.js:5` `showNotification` from `ui/notification-manager.js` (used ×4) → injected notify callback.
- **advisor OVERRIDE — geometry.js: SPLIT NOW, don't defer.** `screenToWorld`/`worldToScreen`
  (`geometry.js:68,95`) call `svg.getBoundingClientRect()` + read `svg.viewBox.baseVal` = DOM in
  the brain (#4). ALL callers are shell (snap-detection, svg-renderer, ui/**); ZERO core callers →
  clean, low-churn extraction. Move them (and `getZoomFactor` if screen-coupled) to
  `apps/sketchstudio/coords.js`; `core/geometry.js` keeps the pure math. "#5 done right — convert
  only at the edges."
- **debt logged (advisor-approved defer) — [DEBT-1] solver-config.js:** guarded `localStorage`
  persistence (no DOM-tree); clean fix (inject a persistence adapter) is more entangled than worth
  mid-move. KEEP in core for this move; EXTRACT later as a #4 persistence-seam via the same callback
  pattern.
- **shims/dead to delete (blessed):** `src/inference-engine.js` (empty re-export),
  `src/ui-manager.js` (1-line re-export), `src/core-utils.js` (throw-stub) — delete + repoint importers.
- **why:** the gate exists because misclassification is cheap now, expensive once files move and
  imports rewire. The DOM grep alone missed the two core→shell *import* leaks (notify, snap-detection);
  the dependency trace caught them.
- **state:** tests 12/12 (solver oracle green) · branch `carve-out` (off `main`@`31b33be`, Phase 0
  integrated) · next: CORE batch — extractions + geometry split (in place, verify), then
  history-preserving `git mv` core→`packages/core` + co-locate tests (verify), oracle green at each
  commit, then hand to advisor for git-diff verification.

## 2026-06-27 · `8b7db3d` — carve-out(core) step 1: extract core→shell leaks + split geometry (pre-move)

- **did** (git diff `8b7db3d`): the three blessed extractions + the geometry override, in place, **no git mv yet**:
  - `constraint-solver.js` — `window.__updateSolverMetrics` → injected `onMetrics` callback (`createEngine` now takes an options object, not `svg`); dropped `findSnap`/`hitJointAtScreen` + the `snap-detection` import.
  - `core/constraint-manager.js` — dropped `import showNotification from ../ui/`; added module-level `notify` + `setConstraintNotifier(fn)`; 4 call-sites `showNotification(`→`notify(` (default no-op → headless brain).
  - `core/geometry.js` — moved `screenToWorld`/`worldToScreen`/`getZoomFactor` (verbatim) → new `apps/sketchstudio/coords.js`; geometry.js is now pure math.
- **why:** do the behavior-affecting changes FIRST as their own reviewable commit, so the advisor can verify the *contract* changes (callbacks, removed exports, `createEngine` signature) before the mechanical mass-move — keeps the move diff a pure `git mv`.
- **tried/abandoned:** considered repointing the shell importers of the screen-helpers in this commit to keep the shell green — abandoned: the blessed sequence defers ALL import rewiring to step 4, and cross-tree repoints (`src/ui` → `apps/sketchstudio/coords`) would be double-churn (they move again in the shell batch). Shell stays red until rewire, by design.
- **state:** **solver oracle 12/12 GREEN** (the invariant holds) · full suite 8→**58** fail — every new failure is a SHELL test importing the moved screen-helpers or the old `createEngine` interface; all recover at the step-4 rewire. Verified no core-logic regression: `constraint-manager`/`constraint-conflict` tests still pass. · branch `carve-out` · **next: GATE — `git mv` core→`packages/core` + co-locate the solver oracle → `packages/core/tests` + repath. Holding for advisor go on the restructure.**

## 2026-06-27 — RESET `8b7db3d`: split-before-move breaks the live no-build app

- **did:** `git reset --hard 31b33be` (dropped `8b7db3d`). The extraction commit broke the **served** app — removing `screenToWorld`/`worldToScreen`/`getZoomFactor` from `geometry.js` threw `does not provide an export named 'worldToScreen'` in `svg-renderer.js`. 17 shell files import the moved helpers. Oracle was green but the browser app was dead.
- **why:** the blessed sequence defers ALL import rewiring to step 4, which assumes the app isn't served until then. But this is a **no-build ESM app the user runs live** — a commit that relocates an export breaks it immediately, and the node solver oracle can't catch it (it doesn't import the shell). **LESSON: for a no-build served app the invariant is "app still LOADS" at every commit, not just "oracle green."**
- **also:** the three extractions each need SHELL-SIDE WIRING to preserve behavior (`createEngine({onMetrics})`, `setConstraintNotifier`, shell calling snap-detection directly). Done in the core batch — before the shell is touched — they regress behavior (no conflict notifications, no metric updates) even where they don't break load. Extraction + its wiring belong in the *same* commit.
- **tried/abandoned:** patching all 17 shell importers to `coords.js` to keep the split — abandoned: throwaway (re-churns when shell moves) and doesn't fix the metrics/notify wiring regressions. Reset was the clean recovery.
- **state:** oracle 12/12 · full suite back to 8 (clean) · **app loads** · branch `carve-out`@`31b33be` (= main tip) · **next: AWAITING ADVISOR ruling on revised sequencing — NO further `git mv` until ruled.**

## 2026-06-27 · `a8245de` — carve-out slice 1, COMMIT 1 of 3: metrics callback (extraction + shell wiring, in place)

- **did** (git diff `a8245de`, 2 files): the metrics-callback extraction redone correctly as ONE
  load-safe commit — extraction + its shell wiring together (the lesson from the `8b7db3d` reset).
  - `constraint-solver.js` — `createEngine(svg)` → `createEngine(options = {})`; null-safe destructure
    `const { svg = null, onMetrics = null } = options || {}`. Solve loop's `window.__updateSolverMetrics`
    read replaced by `if (onMetrics) onMetrics(lastSolveStats)`. The core no longer touches `window`.
  - `main.js` (shell) — sole `createEngine` caller updated to `createEngine({ svg, onMetrics })`; the
    injected `onMetrics` forwards to `window.__updateSolverMetrics` (the window glue moves brain→shell).
- **why — scope discipline:** did ONLY commit 1; left `findSnap`/`hitJointAtScreen` + the `snap-detection`
  import (commit 3) and the notify callback (commit 2) untouched. `svg` is therefore STILL needed by the
  screen-space pass-throughs, so the options object carries `svg` for now — it drops out in commit 3.
- **why — wiring choice:** kept the `window.__updateSolverMetrics` *check* but moved it into the shell's
  injected `onMetrics`, rather than wiring `onMetrics` straight to the tuning wizard. Reason: the wizard
  is lazy-loaded (dev/localhost only) and mounts AFTER `createEngine` runs at module load — it registers
  `window.__updateSolverMetrics` on mount. A direct binding at `createEngine` time would capture an
  undefined callback. Forwarding through the window global (shell-appropriate) preserves the exact
  original late-binding behavior with zero change to `tuning-wizard.js`.
- **why — null-safe destructure:** the solver oracle calls `createEngine(null)`; `options || {}` keeps
  that path working (svg=null, no metrics) without touching the test files. Test files left as-is (they're
  not "the shell"; updating them is out of commit 1's scope).
- **tried/abandoned:** nothing dead-ended; the design was decided before editing. Did NOT touch
  `tuning-wizard.js` (its `window.__updateSolverMetrics = updateSolverMetrics` registration is the other
  half of the contract and stays put).
- **verify:** app **LOADS** — `node --check` clean on `constraint-solver.js`, `main.js`, `tuning-wizard.js`;
  no exports removed/added, no imports changed, so no missing-export/unresolved-import risk. `onMetrics`
  smoke-tested in Node (fires with `{iterations, converged, constraintErrors}`); `createEngine(null)` still
  works. **Solver oracle 12/12 GREEN** (ran each `solver-*.test.js` individually).
- **state:** tests **12/12** (oracle) · app loads · branch `carve-out`@`a8245de` · committed only the 2
  source files (WORK-LOG + NEXT-SESSION left in working tree) · **next: COMMIT 2 — notify callback in
  `core/constraint-manager.js` + `setConstraintNotifier(showNotification)` shell wiring. NOT started
  (per instruction: stop after commit 1, hold for advisor).**

## DEBT
- **[DEBT-1]** `solver-config.js` `localStorage` → extract to an injected persistence adapter
  (#4 persistence-seam), same callback pattern as metrics/notify. Deferred from the carve-out by
  advisor ruling.
