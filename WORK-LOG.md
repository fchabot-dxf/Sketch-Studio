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

## 2026-06-27 · `5d73c02` — carve-out slice 1, COMMIT 2 of 3: notify callback (extraction + shell wiring, in place)

- **did** (git diff `5d73c02`, 2 files): the notify-callback extraction as ONE load-safe commit —
  extraction + its shell wiring together (the `8b7db3d` lesson).
  - `core/constraint-manager.js` — dropped `import { showNotification } from '../ui/notification-manager.js'`;
    added a module-level seam: `let notify = () => {}` + `export function setConstraintNotifier(fn)`
    (coerces non-functions back to a no-op). The 4 conflict call-sites (ERR-CMATH-01/02, ERR-CSOLVE-01/02)
    now call `notify(...)` instead of `showNotification(...)`; signatures unchanged (msg, type, duration).
  - `main.js` (shell) — added `import { setConstraintNotifier }` (core) + `import { showNotification }` (ui);
    call `setConstraintNotifier(showNotification)` once at module load, right after `createEngine`, so
    conflict toasts still fire.
- **why — default no-op, not throw:** the brain must stay headless (north star #4 — no UI import in core).
  Default `notify` is a silent no-op so the oracle / any headless consumer runs without a notifier; the
  shell opts in by injecting `showNotification`. Same seam shape as commit 1's `onMetrics`.
- **why — wire at top-level, not in initApp:** `setConstraintNotifier` only stores a function (no DOM,
  no `showNotification` invocation at wiring time), and constraints are only created later via UI
  interaction — so top-level module load is the earliest correct point and can't race ahead of any
  createConstraint call.
- **why — `import` removed, not an export:** removing constraint-manager's *import* of showNotification
  can't break any importer of constraint-manager (no export was removed); the only NEW export is
  `setConstraintNotifier`, which main.js consumes. So the module graph still links → app loads.
- **tried/abandoned:** nothing dead-ended. Considered wiring inside `initApp` for symmetry with other
  setup — abandoned: top-level is strictly earlier and equally safe (no DOM needed), and keeps the
  wiring next to its sibling `onMetrics` injection.
- **verify — REAL symptom, not a proxy:** `node --input-type=module` harness — injected a spy notifier,
  then triggered a structural math-conflict (COINCIDENT on two fixed joints at different positions) →
  `createConstraint` returned `null` (rejected) AND the injected notifier fired with type `error`. That
  exercises the exact path the shell uses with `showNotification`, proving conflict notifications still
  fire through the seam. `node --check` clean on constraint-manager.js + main.js + notification-manager.js.
  **Solver oracle 12/12 GREEN** (each `solver-*.test.js` run individually). Notification-path tests still
  pass: constraint-conflict, constraint-manager, constraint-manager-sandbox-notification (the last relies
  on the real notifier running under a DOM shim — now a no-op, still passes since it never asserts on the toast).
- **state:** tests **12/12** (oracle) · app loads · branch `carve-out`@`5d73c02` · committed only the 2
  source files (WORK-LOG committed separately at slice end; NEXT-SESSION untouched — it was already
  modified in the working tree before this session, advisor-owned, left as-is) · **next: COMMIT 3 —
  remove findSnap/hitJointAtScreen pass-throughs + snap-detection import + orphaned `svg` option.**

## 2026-06-27 · `18e0a22` — carve-out slice 1, COMMIT 3 of 3: drop snap-detection pass-throughs (SLICE 1 COMPLETE)

- **did** (git diff `18e0a22`, 2 files): removed the screen-space snap pass-throughs from the brain.
  - `constraint-solver.js` — removed `import { findSnap as snapFind, hitJointAtScreen as snapHit } from './snap-detection.js'`;
    removed the `findSnap(lastMouse)` / `hitJointAtScreen(...)` wrapper functions and dropped both from
    the returned engine object; removed the now-orphaned `svg` option from the `createEngine` destructure
    (it existed ONLY to feed those two pass-throughs — commit 1's note flagged it would "drop out in
    commit 3"). `createEngine` now destructures only `{ onMetrics }`.
  - `main.js` (shell) — dropped `svg,` from the `createEngine({...})` options (engine no longer reads it;
    `svg` is still used throughout main.js for view/DOM, just not handed to the engine).
- **why — pure removal, zero behavior change:** grep proved NO call-site ever called `engine.findSnap`
  / `engine.hitJointAtScreen` (`\.findSnap\(` / `\.hitJointAtScreen\(` → no matches anywhere). Every
  shell snap consumer (input-manager, hover-manager, rect-tool, circle-tool, selection-tools) already
  imports `findSnap`/`hitJointAtScreen` straight from `snap-detection.js`. So the brain's wrappers were
  dead pass-throughs — removing them touches no live path; snapping is untouched.
- **why — `svg` dropped from createEngine:** once the pass-throughs are gone, `svg` has no reader inside
  the engine. Leaving it would be a dead option (and a lingering DOM-ish coupling in the brain, #4).
  Removing it is cleanup of the orphan this same change created.
- **tried/abandoned:** none — design was fixed by commit 1's note and confirmed by the no-caller grep.
- **verify — REAL symptom:** orphan grep clean (no `snapFind`/`snapHit`/`svg` left in constraint-solver.js);
  `node --check` clean on both files; node import harness confirms `createEngine({onMetrics})` and
  `createEngine(null)` both still build an engine, and the returned object no longer exposes
  `findSnap`/`hitJointAtScreen`. **Solver oracle 12/12 GREEN.** Snap tests (snap-detection-priority,
  snap-to-cluster, midpoint-snap) still pass — they import `snap-detection` directly, which this commit
  never touched. App loads: no export any importer relies on was removed (only engine-object methods that
  nothing referenced); `createEngine` is still an options-object factory so main.js (its sole shell caller) links.
- **state:** tests **12/12** (oracle) · app loads · branch `carve-out`@`18e0a22` · **SLICE 1 COMPLETE
  (commits 1 `a8245de` · 2 `5d73c02` · 3 `18e0a22`)** · **next: STOP — hold for advisor review. Do NOT
  start the shell/core `git mv` batches without advisor go (NEXT-SESSION "After slice 1"). NEXT-SESSION.md
  remains modified in the working tree from before this session — advisor-owned, left untouched.**

## 2026-06-27 — SHELL BATCH STEP 0: migration PLAN (plan-only, NO files moved) — HOLD FOR ADVISOR

Plan-only per NEXT-SESSION. Nothing was `git mv`'d. Data gathered from the full `src/` import graph
(every `import … from` in src), `tests/` importers, `index.html`, and `apps/shaper` precedent.
Two **gates** surfaced (path strategy + debug/settings classification) — flagged with ⚠ and options.

### 0. Ground facts discovered (these shape everything below)
- **No import map exists.** `index.html` is pure relative-path ESM: one `<script type="module"
  src="src/main.js">`, no `<script type="importmap">` anywhere in the repo. `apps/shaper/index.html`
  is the same shape (`<script type="module" src="src/main.js">`). ROADMAP target layout *does* list
  "index.html + import map" — so a map is sanctioned but **not yet present**.
- **Consequence — the move breaks imports in BOTH directions.** A re-export shim at the OLD path only
  fixes importers-OF-the-moved-file. The moved file's OWN relative imports to *unmoved* `core/` also
  break (a file at `apps/sketchstudio/ui/x.js` can't reach `../core/…` anymore). This is exactly what
  killed `8b7db3d` (missing-export at load). So **every move must fix the moved file's own imports too**,
  not just drop a shim. → see GATE A (path strategy).
- **`assets/` has ZERO runtime references** (`grep 'assets/'` over src = none; toolbar icons are inline
  `<symbol>`s in index.html). The 10 files in `assets/` are design source (`.af`, `.svg`, `.xml`), not
  loaded by the app. Moving them is cosmetic — no path updates, no load risk.

### 1. MOVE-LIST — every shell file → destination, with importer count (low fan-out first)
Destination convention = files directly under `apps/sketchstudio/` (mirrors current `src/` tree;
matches the inaugural override's `apps/sketchstudio/coords.js`). Counts = **distinct src importers**;
`+Nt` = test importers; ⚠ = a CORE importer (a leak risk).

**Entry pair (move together, last):**
- `index.html` → `apps/sketchstudio/index.html` — 0 importers (HTML); holds the importmap + script src.
- `src/main.js` → `apps/sketchstudio/main.js` — **0** src importers (the entry module).

**Top-level shell modules:**
- `src/svg-renderer.js` → `apps/sketchstudio/svg-renderer.js` — **2** (main, ui-manager) +~4t
- `src/snap-detection.js` → `apps/sketchstudio/snap-detection.js` — **5** (hover-manager, input-manager,
  circle-tool, selection-tools, rect-tool) +~10t. (imports the coords helpers — see §5.)

**`src/ui/` → `apps/sketchstudio/ui/`:**
- `export-manager.js` — **1** (ui-manager) +1t  ← **LOWEST leaf → the §3 proof file**
- `ui-manager.js` — 1 (main) | `input-manager.js` — 1 (main) | `debug-panel.js` — 1 (main, dynamic)
  | `tuning-wizard.js` — 1 (main, dynamic) | `settings-panel.js` — ~0–1 (dynamic; verify)
- `cursor-manager.js` — 2 | `snap-magnet.js` — 2 | `wizard-base.js` — 3 | `hover-manager.js` — 4
- `notification-manager.js` — 5 (now core-clean after slice-1 c2) | `preview-manager.js` — 7
- `numeric-input-manager.js` — 8 (highest in ui/)

**`src/ui/input-handlers/` → `apps/sketchstudio/ui/input-handlers/`:**
- `dimension-input.js` — 0 static (⚠ verify dead/dynamic) | `polygon-tool.js` — 0 static (⚠ likely
  dead — no toolbar button, no importer; flag for delete-not-move)
- `drawing-tools.js` — 1 | `constraint-tools.js` — 1 | `pan-zoom.js` — 1
- `rect-tool.js` — 2 | `circle-tool.js` — 2 | `arc-tool.js` — 2 | `selection-tools.js` — 2
  | `dimension-tool.js` — 2 | `live-dimension-input.js` — 2 | `line-tool.js` — 3 | `base-tool.js` — 4

**Assets:** `assets/` → `apps/sketchstudio/assets/` — 0 runtime refs (move whenever; no risk).

**NEW file:** `apps/sketchstudio/coords.js` — created by the §5 geometry split.

**DELETE (do NOT move — blessed dead in the inaugural gate):** `src/inference-engine.js` (empty
re-export), `src/ui-manager.js` (1-line re-export), `src/core-utils.js` (throw-stub). Repoint/confirm
no live importer first (the live UI manager is `src/ui/ui-manager.js`, a different file).

### 2. SHIM STRATEGY (per move)
Rule honored: **shims are SHELL→shell re-exports only; NEVER core→apps/** (that re-introduces the leak
slice 1 just removed). With the advisor's "move-with-shim, rewire-later" model:
- **For each moved file Y:** leave a re-export shim at Y's OLD path (`export * from '<new path>'`) so
  unmoved importers + tests resolve through the move → load stays green. Shims deleted in a final
  rewire slice (§3) once all importers point at the new path.
- **The moved file's own imports** to unmoved `core/` get rewritten to the stable `core/` alias (GATE A)
  — NOT to throwaway relative paths (those would churn again at the core batch). This is the half a
  shim can't cover.
- **No shim needed when** a file moves in the SAME slice as all its importers (e.g. the tightly-coupled
  `input-handlers/*` cluster can move as one slice; only cross-cluster importers need shims).
- **Tests** import via `../src/…` (mostly dynamic `import()`); they are importers too — the OLD-path
  shim keeps them green without editing test files (this is what the `8b7db3d` reset proved necessary).

### 3. SLICE PLAN (each commit: app-LOADS + oracle 12/12)
- **Slice 0 — import map, additive, ZERO moves.** Add `<script type="importmap">` to `index.html`
  mapping a stable `core/` alias (→ `./src/core/`) and `app/` (→ `./apps/sketchstudio/`). Existing
  relative imports keep working (a map only adds bare-specifier resolution), so this is provably
  load-safe on its own. Verify load + oracle. *Proves the map breaks nothing before any file moves.*
- **Slice 1 — PROOF (smallest end-to-end).** `git mv src/ui/export-manager.js
  apps/sketchstudio/ui/export-manager.js`; rewrite its 2 imports (`constants`, `settings-manager`) to
  the `core/` alias; leave a re-export shim at `src/ui/export-manager.js`. Verify: app loads · oracle
  12/12 · `export.test.js` green (resolves via shim). *Validates import-map + shim mechanic on one
  file before the mass move.*
- **Slices 2…N — mass move, leaves→roots, fan-out order.** Group the cohesive `input-handlers/*`
  cluster as one slice (move together, internal imports need no shims). Then `ui/*` leaves, then the
  higher-fan-out `ui/*` (numeric-input, preview), then `svg-renderer` + `snap-detection`. Each: git mv
  + alias-rewrite own imports + shim old paths. Verify load + oracle each commit.
- **Slice (entry) — `index.html` + `main.js` together.** Move both to `apps/sketchstudio/`; update the
  `<script src>` to the new `main.js` location (and confirm the importmap paths from the new index.html
  location). This is where §4's Cloudflare note applies.
- **Slice (rewire + cleanup, last).** Repoint all remaining importers off the OLD paths onto `app/`
  aliases; DELETE every shim; delete the dead files (§1). Verify load + oracle. End state: no shims,
  no relative cross-tree paths.

### 4. index.html / Cloudflare
- `index.html` lands at `apps/sketchstudio/index.html`. Its `<script type="module" src="…">` becomes
  the new `main.js` location (`./main.js` if main.js sits beside it in `apps/sketchstudio/`), and it
  carries the importmap. Relative `core/` alias target must be correct from the NEW index.html depth.
- ⚠ **Pages output dir is a HUMAN, merge-time action** (already DECIDED at the human gate): change the
  Cloudflare Pages **Build output directory** `/` → `apps/sketchstudio`, timed with the merge to `main`.
  The `carve-out` branch move does NOT affect the live deploy (it runs off `main`). NOT a thin root
  loader. The worker does not touch the dashboard.

### 5. GEOMETRY COORDS SPLIT — confirmed, rides in this batch
- Extract `screenToWorld` (geometry.js:67), `worldToScreen` (:94), `getZoomFactor` (:275) → NEW
  `apps/sketchstudio/coords.js`. All three are DOM-coupled (`svg.getBoundingClientRect()` +
  `svg.viewBox.baseVal`) → shell, per #5 "convert only at the edges." `core/geometry.js` keeps pure math.
- **Zero core importers** of the three (verified): every importer is shell — `svg-renderer`,
  `hover-manager`, `input-manager`, `numeric-input-manager`, `circle/arc/rect/line/selection/
  dimension/live-dimension` tools, `snap-detection` (~11–17 shell files; the reset note counted 17).
  Because all importers move in THIS batch, they're "touched once": repoint their screen-helper imports
  to `coords.js` as they move. Do the extraction as its own slice within the batch (it's the change that
  broke `8b7db3d` — isolate + verify it hardest: load + oracle + a real drag/snap still maps coords).

### ⚠ GATE A — PATH STRATEGY (advisor ruling needed before Slice 0)
The moved-file-own-imports problem (§0) forces a choice:
- **(A) Import map + `core/`/`app/` aliases [RECOMMENDED].** Matches ROADMAP target. Moved files'
  imports rewritten to `core/…` ONCE and stay valid even after the core batch moves `src/core` →
  `packages/core` (just update the map). Minimal churn; one-time map setup. Slice 0 above assumes this.
- **(B) Per-move relative-path rewrites, no map.** Each moved file's `../core/…` rewritten to the new
  relative depth, then rewritten AGAIN when core moves. Double churn; no new mechanism. Simpler to
  understand, worse to execute across 30+ files twice.
Recommend **A**.

### ⚠ GATE B — `debug.js` + `settings-manager.js` CLASSIFICATION (the blessed split is internally inconsistent here)
The inaugural gate put `core/debug.js` and `core/settings-manager.js` in the SHELL bucket, but:
- **`core/debug.js` is imported by 4 CORE files** — `constraint-manager.js`, `joints.js`,
  `snap-constraints.js`, `constraints.js` (all import `{ dbg }`). Moving it to `apps/` = **core→apps
  leak** — forbidden. BUT debug.js also has a DOM half: lines 57–136 are a `window`/`requestAnimationFrame`
  overlay + `window.ug.debug` controls that import `SettingsManager`. So it's neither cleanly core nor
  cleanly shell as-is.
- **`core/settings-manager.js`** is environment-agnostic (every `process`/`document`/`localStorage`
  access is guarded). Imported only by shell files + debug.js. No TRUE-core file imports it directly.
Options:
- **(A) Split debug.js [principled end state].** Pure `dbg` logger (lines 22–55, no window, no
  SettingsManager) stays `core/debug.js`; the overlay + `window.ug.debug` + SettingsManager import →
  `apps/sketchstudio/debug-overlay.js` (side-effect import from main.js). Then settings-manager is
  shell-only → moves in this batch. Mirrors the geometry/coords split + slice-1 callback extractions.
  Cost: a behavior-affecting extraction (verify the overlay/`window.ug.debug` still works) — its own slice.
- **(C) Defer both [RECOMMENDED for THIS batch].** Do NOT move debug.js or settings-manager.js in the
  shell batch. They stay in `src/core`, reached by shell via the `core/` alias (shell→core, fine) and by
  core via relative `./debug.js` (core→core, fine). No leak crosses an apps/packages boundary yet (it's
  still `src/core`, not `packages/core`). The split (option A) becomes a gated step in/just-before the
  CORE batch. Keeps the shell batch's scope to true shell files.
- (B) Reclassify whole debug.js → core: rejected — drags the DOM overlay + a localStorage-persistence
  concern into the brain (violates #4); also forces settings-manager into core.
Recommend **C now, A before the core batch.**

### ⚠ Minor — `ui/inference-engine.js` is CORE but lives in `ui/`
Classified core (pure inference) in the inaugural gate, but physically under `src/ui/`. If `ui/**` moves
to `apps/sketchstudio/ui/`, this file would wrongly ride into the shell. Importers (4, all shell:
snap-detection, input-manager, selection-tools, line-tool). **Proposal:** before moving `ui/`, relocate
`src/ui/inference-engine.js` → `src/core/inference-engine.js` (toward packages/core) with a shim at the
old path for the 4 shell importers. Small, isolates the misplacement. Flag for advisor.

### State
- tests **12/12** (oracle, unchanged — no code touched) · branch `carve-out`@`9dc279a` · **NO files
  moved.** Working tree clean except this WORK-LOG append + the pre-existing NEXT-SESSION mod.
- **next: STOP — hold for advisor.** Advisor rulings needed on GATE A (path = import map?), GATE B
  (debug/settings = defer?), and the `ui/inference-engine.js` relocation, before Slice 0 executes.

## DEBT
- **[DEBT-1]** `solver-config.js` `localStorage` → extract to an injected persistence adapter
  (#4 persistence-seam), same callback pattern as metrics/notify. Deferred from the carve-out by
  advisor ruling.
