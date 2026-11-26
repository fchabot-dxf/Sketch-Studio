# Solver UI/UX & Irregularity Audit (TASK 1000)

> **Audit only — no app code or existing tests changed.**
> Scope: the shared Design tab (`packages/core` solver + `ConstraintManager` + `dimension-seams` + `delete-manager` + `constraint-status` + modify ops, `packages/ui` input/numeric/snap/renderer layer, and host wiring across `SketchStudio`, `Shaper`, and `Pen Plotter`).
> Owner asks: *"Take another look at past bugs and make another audit of the solver for ui ux bugs"* / *"Trying to match standard sketching cads, fusion, etc, let me know of bugs"* / *"well wrong also if we just don't have expected result"* / turn 3725: *"Find irregularities in ui ux of the solver logic"*.

---

## Method & Probe Suite

Six audit scripts under `tests/audits/` (outside `scripts/gate.cjs`, which runs only `*.test.js`; each exits `0` and prints `ROW <id> | ...` lines):

| Probe | Command | What it drives |
|---|---|---|
| Shared Node kit | `tests/audits/solver-ux-audit-1000-kit.js` | Real SketchStudio / Shaper / Pen Plotter Design tab via `tests/helpers/node-app.js` (same pointer/key/box/undo/autosave path as the page) |
| Dimensions | `node tests/audits/solver-ux-audit-1000-dimensions.mjs` | Invalid/impossible/degenerate/extreme/unit/formula edits, reference dims, angle across 180°, `toggleDriving`, `D` preselection |
| Drag | `node tests/audits/solver-ux-audit-1000-drag.mjs` | Under-/fully-/over-constrained drags, branch & side flips, singular configs, sticking/lag, fast flicks, multi-select, coincident arc centres |
| Constraints, Status, Undo, Modify | `node tests/audits/solver-ux-audit-1000-constraints-status-undo.mjs` | Redundant/conflicting adds & notices, delete constraints/geometry, locked sketches, DOF status & recovery, undo/redo, Fillet / Mirror / Offset / Pattern / Trim / Break |
| Pairwise Irregularities | `node tests/audits/solver-ux-audit-1000-irregularities.mjs` | All pairwise context asymmetries (button vs key vs ribbon, host vs host, shape kind vs shape kind, snap vs tool, A-then-B vs B-then-A, undo/redo, draw-time vs edit box) |
| Performance (~200 items) | `node tests/audits/solver-ux-audit-1000-perf.mjs` | `quickSolve(8)`, `fullSolve(500)`, `analyzeConstraintStatus`, and real `pointermove` frame times at 50–200 constrained items |
| Live Headless Browser | `node tests/audits/solver-ux-audit-1000-live.mjs` | Real headless Chrome (CDP, non-local requests blocked via `--host-resolver-rules`) at **Desktop 1280×800** and **Phone 390×844**, with zoomed screenshots saved locally to `.evidence/1000/` |

*Yardstick*: Fusion 360 first (SolidWorks, Onshape, FreeCAD Sketcher where they agree). Expected Fusion behaviour not previously measured in `docs/FUSION-COMPARISON.md` or `WORK-LOG.md` is explicitly marked **(unverified)**.
*Note on Chamfer*: there is **no Chamfer tool** in the Design tab (`git grep -i chamfer packages/ apps/` returns only Shaper CAM 3D stepped-cut comments and V-bit hint text), so Chamfer is N/A.

---

## STEP 1 — Past Solver UI/UX Bugs Grouped into Families

Mined from `WORK-LOG.md` (turns 370–896), `docs/CONSTRAINT-AUDIT.md`, `docs/COVERAGE-AUDIT.md`, `docs/FUSION-COMPARISON.md`, `docs/SNAP-CONSTRAINT-AUDIT-869.md`, and `git log`.

### Family F1 — Tool / UI paths bypassing the shared seam (`ConstraintManager`, `commitDimensionEdits`, `saveState`, `switchToTool`)
- **Fixed past instances**:
  - Task 370 (circle radius edit bypassed solver); task 438/545/549/571 (draw / drag / constraint tools missing undo grouping); task 517 (lost dimension fields on normalise); task 520 (NEW-1/2/5 dimension-tool bugs); task 589 (`live-dimension-input` left temp constraint on throw); task 789/789b (length `<= 0` bypassed by formula/param path); task 876 (draw-time boxes bypassed `evaluateBoxText`).
- **Where the same pattern still lives (grep-verified)**:
  - **Direct `state.constraints.push(...)` bypassing `ConstraintManager`**: `packages/core/fillet.js:526,530-531,542-543,573`, `packages/core/offset.js:350,365`, `packages/core/pattern.js:462,527`, `packages/core/trim.js:153`, `packages/core/close-path.js:123,127`, `packages/ui/input-handlers/dimension-tool.js:275,437`, `packages/ui/input-handlers/live-dimension-input.js:195`.
  - **Missing `state.saveState(...)` (un-undoable solver state mutations)**:
    - `packages/ui/input-manager.js:1439-1443` (`toggleDriving` in context menu — never snapshots, even though it deletes `c.expression` and re-solves!).
    - `packages/ui/input-manager.js:1495-1516` (`toggleFixedSelection` for `F` key / Lock ribbon / context menu — never snapshots!).
    - `packages/ui/numeric-input-manager.js:474-482` (`showEditInput` silently demotes an existing determined driving dimension to reference with no snapshot!).
  - **Missing redo-stack restore on discarded no-op snapshot**: `packages/ui/input-handlers/selection-tools.js:512-521` (`settleDragUndo` discards the snapshot on 0-DOF drag without restoring `state.redoStack`, unlike `dimension-seams.js:224-243`).

### Family F2 — Dual-path / host / modality irregularities (SketchStudio vs Shaper/PenPlotter, ribbon vs keyboard, draw-time box vs edit box)
- **Fixed past instances**:
  - Task 596/597 (unified creation boxes); task 618/619 (shared app chrome/footer); task 629 (DESIGN-PARITY G2-G7); task 867/870/871/872 (snap & constraint-tool parity); task 876 (draw-time formula reading).
- **Where the same pattern still lives (grep-verified)**:
  - **Two divergent constraint-tool activation implementations**: `apps/sketchstudio/ui/ui-manager.js:58-100` (`handleToolActivate`) vs `packages/ui/input-manager.js:1522-1587` (`switchToTool` used by Shaper, Pen Plotter, Trace, and keyboard shortcuts):
    - Pre-selected line + H/V ribbon switches to `select` in SketchStudio (`ui-manager.js:70`) vs stays in `hv` in Shaper/PenPlotter (`input-manager.js:1578`).
    - Clicking a constraint ribbon button twice toggles back to `select` in SketchStudio (`ui-manager.js:90-94`) vs stays stuck in the tool in Shaper/PenPlotter (`input-manager.js:1566-1585`).
    - Coincident with 2 selected items clears selection and skips `pendingConstraint` in SketchStudio (`ui-manager.js:76-84`) vs keeps selection and sets `pendingConstraint` in Shaper/PenPlotter.
  - **Keyboard-only preselection paths**: `packages/ui/input-manager.js:1349-1387` (`H` ignores `selectedJoints`; `E` applies immediately to 2 preselected shapes and emits raw `[ERR-EQUAL-01]` JSON toast on mismatch — neither works from the ribbon buttons!).
  - **Draw-time live box vs Edit box (`packages/ui/numeric-input-manager.js`)**:
    - `<= 0` refuses inline & keeps box open in draw-time (`liveRefusal`, `:901-934`), but closes box & drops typed text with a warning toast in edit (`handleCommit`, `:680-685`).
    - `w = 50` works in edit box (`previewDimensionInput`), but draw-time box refuses it with `"=" only as name = value at the start` (`evaluateBoxText`).
    - Autocomplete `#dimComplete` runs only in edit mode (`attachCompletion`, `:1004`), never in draw-time boxes.
    - Circle draw-time box prompts **DIAMETER** (`circle-tool.js:17`) but creates a **RADIUS** dimension with rewritten expression `(d1) / 2` (`circle-tool.js:127,163`); Dimension tool on circle also creates Radius (`dimension-tool.js:607`).
  - **Dimension tool preselection vs click**: `dimension-tool.js:185` (`hasDrivingDistanceForJoints`) blocks `D` on 2 joints that already have an H dim (preventing adding V), whereas clicking with Dimension tool allows both H and V.
  - **Dimension tool pick order**: `dimension-tool.js` handles `Line -> Axis` (creates angle) but ignores `Axis -> Line` (creates line length instead).

### Family F3 — Heuristic guard or pre-check over-firing or under-firing
- **Fixed past instances**:
  - Task 521 (`findCollapsedShape` 1% rule); task 520 (NEW-3 perp refused on parallel lines); task 516 (rank-redundancy check for dims); task 789 (collapsed line distance Jacobian at `r = 0`).
- **Where the same pattern still lives (grep-verified)**:
  - `packages/core/constraint-verifier.js:380,409-427` (`findCollapsedShape` exempts only the single shape directly named by the edited dimension, so shrinking a 500×40 rectangle to 4 mm width falsely flags the opposite side `L3` as `< 1%` collapsed and refuses the edit!).
  - `packages/core/constraint-manager.js:462-495` (`_sandboxVerify` solves the entire sketch globally, so one pre-existing conflict blocks adding constraints to completely unrelated free geometry).
  - `packages/core/constraint-manager.js` (`_mathPreCheck` does not forbid `coincident` between an arc's own start & end joints; when a drag snaps `e` onto `s` first, `chord` is already 0 so `findCollapsedShape` skips it and the arc permanently collapses to zero sweep!).
  - `packages/core/delete-manager.js:178-187` (filters out inert/locked-sketch constraints on line 178, then lines 183-187 unconditionally re-push every `state.selectedConstraints` entry — deleting constraints on locked sketches!).
  - `packages/core/constraint-manager.js:220-255` (redundant *non-duplicate* geometric constraints like `parallel` on two H lines or `equal` on opposite rect sides are silently accepted, whereas `symmetric` and `distance` run `isDistanceRedundant` and refuse/demote).

### Family F4 — Incomplete constraint / mode handling in geometry & dimension operations
- **Fixed past instances**:
  - Task 372/789 (imported arcs missing structural equal); task 402/406/524 (fillet virtual sharp & fixed corners); task 709 (`removeGeometry` cleaning constraints); task 789 (Trim keeping H/V and cleaning removed-end dims).
- **Where the same pattern still lives (grep-verified)**:
  - `packages/core/dimension-seams.js:361-364` (`toggleDriving` ignores `c.dimMode === 'horizontal' | 'vertical'` and assigns Euclidean `getDist(j1, j2)` — promoting a reference H or V dim on a diagonal jumps geometry to the hypotenuse!).
  - `packages/core/break.js:24-58` (`breakShape` never updates `state.constraints`: H/V and length dims stay on `[a, b]`, leaving the break joint `M` completely free so the line bends into a V!).
  - `packages/core/trim.js:92-135,149-159` (`trimShape` creates no `pointOnLine` binding the trimmed end to the cutter line, and on a dimensioned rectangle edge whose corner `b` is still used by an adjacent edge, the old length dim `D(a, b)` stays orphaned across the gap).
  - `packages/ui/input-manager.js:1495-1516` (`toggleFixedSelection` fixes only `s.joints` — on a circle, `s.joints` is only the centre, so locking a circle reports `locked: true` while leaving `radius` free to drag!).
  - `packages/ui/input-manager.js:1484-1492` (`selectionLockState` checks `joint.fixed` on every joint of the shape, so after filleting two locked lines the trimmed line reports `locked: false` even though it is 0 DOF).

### Family F5 — Branch / side / orientation flips & missing sweep/direction locks
- **Fixed past instances**:
  - Task 511 (F3 clockwise angle collapse); task 543/553 (angle `sector` up to 360°); task 550 (arc `sweep` stored, no stale `largeArc`); task 611 (`solveGivingWay` stops free mirror line rotating on dimension edit); task 654/656 (offset arc/line flip guards); task 789 (tangent internal/external branch lock); task 875 (arc midpoint single-solution chord-normal row).
- **Where the same pattern still lives (grep-verified)**:
  - `packages/core/fillet.js:522` (fillet arc is created with `sweep: undefined` — **known open NEW-11**: arc midpoint on a fillet bent near 180° flips shortest-way side; AND dragging a fillet's leg past 180° folds the fillet arc inside-out with `residual ok`; AND `packages/core/mirror.js:37` checks `typeof src.sweep === 'boolean'`, so mirroring a fillet arc also produces `sweep: undefined`).
  - `packages/ui/input-handlers/selection-tools.js` (`solveGivingWay` is used only in `dimension-seams.js:169`, NOT during drags — dragging a mirrored line rotates a free mirror line!).
  - `packages/core/dimension-seams.js:120` (`revert()` calls `engine.solve(ITER())` after `restoreAll()`, letting a near-singular sketch drift slightly on a supposedly "Reverted" edit — observed `0.0018 mm` on degenerate triangle).

### Family F6 — Wrong fixed set / drag masking / snap-vs-tool asymmetry
- **Fixed past instances**:
  - Task 538 (body drag); task 546 (snap-release slip); task 548 (drag sub-moves instead of clamp); task 575 (no stale drag targets / redundant snap); task 578 (arc end drags itself); task 582/584 (arc centre drag & pivot, cluster drag no inference); task 594/598 (Fusion drag inferences); task 867-872 (snap audit 869 fixes).
- **Where the same pattern still lives (grep-verified)**:
  - `packages/ui/input-handlers/selection-tools.js:420` (checks `s.joints[0] === hitJoint.id` instead of `cluster.has(s.joints[0])` — dragging a point coincident with an arc centre translates rigidly or shrinks the arc depending on SVG/Map order!).
  - `packages/ui/input-handlers/selection-tools.js:694` (drag sub-moves gate on `state.joints.has(state.drag.id)`, which is ALWAYS false for body drags where `drag.id` is a shape ID — fast body flicks skip sub-moves and lag badly!).
  - `packages/ui/input-handlers/selection-tools.js:89-99` (`getDragDOF` locks the ENTIRE multi-selection group drag if ANY single selected member is fixed, freezing unrelated free selected shapes!).
  - `packages/ui/input-handlers/selection-tools.js:314-322` (`carryControlPoints` runs on body/group drags, NOT when dragging a bezier's end joint — dragging an end joint leaves its handle stationary!).
  - `packages/ui/snap-detection.js:93-114` (midpoint snap implemented for lines only — no arc midpoint snap despite task 875 adding arc Midpoint constraint!).

### Family F7 — Misleading / inconsistent notices, raw `[ERR-*]` leaks, silent refusals, & missing conflict visuals
- **Fixed past instances**:
  - Task 613 (notice levels); task 868/871 (silent constraint picks now tell why); task 874 (single Fusion-style red X `'Sketch geometry over constrained'` notice, moving ERR codes to debug log); task 878 (no-nag removal of confirmation toasts).
- **Where the same pattern still lives (grep-verified)**:
  - **7 sites still leak raw `[ERR-*]` codes (and 3 leak raw JSON `Args:` dumps!) into user toasts**:
    - `packages/ui/numeric-input-manager.js:478` (`'Dimension added as Driven (already determined by existing constraints). [ERR-DRIVEN-02]'` — ALSO says "added" when double-clicking an EXISTING dim!)
    - `packages/core/constraint-manager.js:268` (`[ERR-CMATH-01]`, level `'error'` with Copy button)
    - `packages/core/constraint-manager.js:275` (`[ERR-CMATH-02]`)
    - `packages/core/constraint-manager.js:308` (`[ERR-CSOLVE-02]`)
    - `packages/ui/input-manager.js:1376` (`[ERR-EQUAL-01]` + JSON `Args:`)
    - `packages/ui/input-manager.js:1442` (`[ERR-DRIVE-02]`)
    - `packages/ui/input-handlers/dimension-tool.js:291,465` (`[ERR-DIM-02]` + JSON `Args:` on `:465`)
    - `packages/ui/input-handlers/live-dimension-input.js:300` (`[ERR-OVERCON-01]` + JSON `Args:` — legacy path, static grep only)
  - `packages/ui/numeric-input-manager.js:684` (`pv.value` is in base mm, so inch documents show `"Can't set to 2540"` when the user typed `100` in!).
  - `packages/ui/input-handlers/trim-tool.js` & `break-tool.js` (warn on Bezier, completely SILENT on Arc & Circle!).
  - `packages/core/parameters.js` (`"d1 -> d1"` / `"d1 -> d2 -> d1"` cryptic cycle hint; `"=" only as name = value at the start"` shown for `w = 50` in draw-time boxes!).
  - `packages/ui/svg-renderer.js` / `packages/core/constraint-status.js` (a conflicted sketch with 10 mm residual shows ZERO over-constrained colour/icon/warning — renders one line black and two blue!).

### Family F8 — Per-frame drag cost at ~200 constrained items
- **Fixed past instances**:
  - Task 541 (sparse Cholesky solver: 400 constraints 3043 ms -> 38 ms); task 579 (perf guard tests); `cachedFreedom` in `constraint-status.js:13-23`.
- **Where the bottleneck still lives**:
  - During a drag, `selection-tools.js:730` calls `analyzeConstraintStatus` (cache miss on every moved position: `JSON.stringify` + RREF nullspace) + `quickSolve(8)` (1–2×), then the rAF frame in `sketch-canvas.js:151` calls `engine.solve(500)` AND `svg-renderer.js` calls `analyzeConstraintStatus` again + full SVG DOM rebuild. At 200 coupled segments (`P2.chain200`), each pointer move averages **64.6 ms (p95 87.0 ms)** in Node; at 50 rects (200 lines / 250 constraints) in real Chrome 1280×800, rAF averages **20.7 ms (p95 33.4 ms, 30 fps)**.

---

## STEP 2 & STEP 3 — Findings Table

Severity order: **wrong geometry** > **misleading UI** > **cosmetic**.
Confidence: `N/N` independent runs reproduced (`+live` = also reproduced in headless Chrome 1280×800 and/or 390×844).

| id | family | exact repro | what happens vs expected / Fusion | class | severity | confidence | suggested fix location (ONE place?) |
|---|---|---|---|---|---|---|---|
| **UX-01** | F4 | `node tests/audits/solver-ux-audit-1000-dimensions.mjs` (`D9.1`, `D9.2`): diagonal `(0,0)-(30,40)` with reference H-dim (`30`) or V-dim (`40`); call `toggleDriving` | Sets `d1.value = 50` (Euclidean hypotenuse!) and solves, **jumping `b` from `(30,40)` to `(50,40)` (+20 mm)** or `(30,50)` (+10 mm). Expected / Fusion (unverified): promoting a reference H/V dim keeps its H (`30`) or V (`40`) value with zero geometry jump. | **BUG** | **wrong geometry** | 2/2 reproduced | `packages/core/dimension-seams.js:361-365` (**ONE place**: branch on `c.dimMode === 'horizontal'` / `'vertical'` before `getDist`) |
| **UX-02** | F3 | `node tests/audits/solver-ux-audit-1000-dimensions.mjs` (`D7.1`, `D1.8`) + `node tests/audits/solver-ux-audit-1000-live.mjs` (`L1.desktop`, `L1.phone`): 500×40 rect, double-click width `d1`, type `4`, Enter | **Refused** with `"Can't set to 4 — 4.00 would collapse a line to a point. Reverted."` (5 mm passes; 4 mm fails!). Opposite side `L3` is not directly named by `d1`, so `findCollapsedShape`'s 1% ratio (`4/500 < 0.01`) falsely treats a valid resize as a collapse. Expected / Fusion (unverified): any positive dimension edit that leaves all shapes > absolute tolerance succeeds. | **BUG** | **wrong geometry** | 3/3 reproduced (+live desktop & phone) | `packages/core/constraint-verifier.js:409-427` (**ONE place**: use an absolute collapse floor or exempt shapes driven by the edited dimension's solve) |
| **UX-03** | F3 / F6 | `node tests/audits/solver-ux-audit-1000-drag.mjs` (`DR4.1`) vs `solver-ux-audit-1000-irregularities.mjs` (`IR4.1a`): free-end arc `c(0,0) s(40,0) e(0,40)`, drag `e` around past `s(40,0)` | Dragging `e` near `s` snaps `e` onto `s` and **adds permanent `coincident:e,s`**, collapsing the arc to zero sweep (`(40,0)`). Coincident *tool* (`IR4.1a`) refuses `(s,e)` via `findCollapsedShape`, but drag-snap moves `e` onto `s` *before* calling `ConstraintManager`, so `_sizesBefore` sees `chord = 0` and skips the collapse check! Expected / Fusion (measured EA-1): arc ends cannot be made coincident / collapsed to zero sweep. | **BUG** | **wrong geometry** | 2/2 reproduced | `packages/core/constraint-manager.js` (`_mathPreCheck`, forbid coincident of an arc's own ends) + `packages/ui/snap-detection.js` (don't snap an arc end to its own other end) (**2 places**) |
| **UX-04** | F4 | `node tests/audits/solver-ux-audit-1000-constraints-status-undo.mjs` (`M1.5`): horizontal 80 mm line `L1`, `breakShape(state, 'L1', 0.5)`, drag break joint `M` to `(40,30)` | `breakShape` ignores `state.constraints`: `H(a,b)` and `D(a,b)=80` remain on `[a,b]`, leaving `M` at 2 DOF so dragging `M` **bends the horizontal line into a V `(0,0)-(40,30)-(80,0)`**. Expected / Fusion (unverified): broken segments stay collinear/horizontal (H/V on each piece, or collinear + drop/keep length cleanly). | **BUG** | **wrong geometry** | 2/2 reproduced | `packages/core/break.js:24-58` (**ONE place**: update/transfer line constraints as `trim.js:keepLineConstraints` does) |
| **UX-05** | F5 | `node tests/audits/solver-ux-audit-1000-drag.mjs` (`DR4.2a`, `DR4.2b`): 90° corner `a-b-c` with R10 fillet (`arc.sweep = undefined`), drag `c` down past 180° to `(95,-15)` | Fillet arc centre stays above `L1` at `(51.63, 10)` while `c` is at `(97.42, -15.86)`, and `arcS=(51.63, 0)` crosses past `arcE=(48.46, 0.52)` — **fillet arc folds back inside-out** with `residual ok`. Also compounds open **NEW-11** (fillet arc midpoint flips near 180°) and mirrored fillet arcs (`M1.3`: `mir.sweep = undefined`). Expected / Fusion (unverified): fillet either refuses/stops at 180° or flips cleanly to the new interior side without self-crossing. | **BUG** | **wrong geometry** | 2/2 reproduced | `packages/core/fillet.js:522` (store explicit `sweep` on fillet arcs) + solver/tangent side guard (**2 places**) |
| **UX-06** | F4 / F2 | `node tests/audits/solver-ux-audit-1000-irregularities.mjs` (`IR2.1.C1`): select free circle `C1(R=20)`, press `F` (Lock), then drag rim `(110,0)->(130,0)` | `selectionLockState` reports `locked: true`, context menu switches to "Unlock", **yet `C1` stays `free` (blue, DOF 1) and its rim drags freely from R20 to R40.026!** Contrast `L1` and `A1`, which become 0-DOF `fixed`. Expected / Fusion (unverified): Fix/Lock on a circle fixes both centre AND radius (green/black, immovable). | **BUG** | **wrong geometry** | 2/2 reproduced | `packages/ui/input-manager.js:1495-1516` + `packages/core/solver/engine.js` (`radiusFixed` or fixed flag on circle shape) (**2 places**) |
| **UX-07** | F3 | `node tests/audits/solver-ux-audit-1000-constraints-status-undo.mjs` (`C2.1`): lock `sketch-1`, select shape `L1` and dim `d1` from `sketch-1`, call `deleteSelection(state)` | `L1` survives (`shapes 1->1`), **but `d1` on the LOCKED sketch is DELETED (`constraints 2->1`)**! Line 178 filters out inert constraints, then lines 183-187 unconditionally re-push all `state.selectedConstraints`. Expected / Fusion (unverified): nothing on a locked sketch can be deleted. | **BUG** | **wrong geometry** | 2/2 reproduced | `packages/core/delete-manager.js:182-187` (**ONE place**: delete the redundant duplicate loop) |
| **UX-08** | F1 / F2 | `node tests/audits/solver-ux-audit-1000-dimensions.mjs` (`D9.3b`) + `solver-ux-audit-1000-irregularities.mjs` (`IR2.1.L1`, `IR2.1.undo`): (a) context menu `toggleDriving` on dim with formula `d2*2`, Ctrl+Z; (b) press `F` (Lock) on line, Ctrl+Z | **Neither `toggleDriving` nor Lock/Unlock (`F` / ribbon / context menu) records an undo step!** `Ctrl+Z` undoes the *previous* edit instead, leaving the lock or reference toggle permanently applied (and `toggleDriving` permanently discards the dimension's formula). Expected / Fusion (unverified): every sketch state change is undoable in 1 step. | **BUG** | **wrong geometry** | 2/2 reproduced | `packages/ui/input-manager.js:1439` (`toggleDriving` -> `saveState`) & `packages/ui/input-manager.js:1495` (`toggleFixedSelection` -> `saveState`) (**2 places**, same file) |
| **UX-09** | F6 | `node tests/audits/solver-ux-audit-1000-drag.mjs` (`DR6.4a` vs `DR6.4b`): arc centre `c` coincident with line end `p` at `(20,20)`, drag `(+20,+20)` | **Irregularity by Map/z-order**: when `c` is hit (`DR6.4b`), arc translates rigidly (`r 30->30`); when `p` is hit (`DR6.4a`), rims are NOT carried and **arc radius shrinks `30->22.374`**! Expected / Fusion (measured task 584): dragging an arc centre point translates the arc rigidly regardless of which coincident joint was drawn last. | **BUG** | **wrong geometry** | 2/2 reproduced | `packages/ui/input-handlers/selection-tools.js:420` (**ONE place**: `cluster.has(s.joints[0])` instead of `s.joints[0] === hitJoint.id`) |
| **UX-10** | F5 | `node tests/audits/solver-ux-audit-1000-drag.mjs` (`DR4.3b`): mirror line `L1` about FREE construction line `ML(0,-50)-(0,50)`, drag `a(30,10)->(40,35)` | **Mirror line `ML` rotates/drifts** (`m1 -> (8.135, -49.643)`, `m2 -> (-0.403, 49.995)`). Irregularity vs dimension edits (task 611 fixed dimension edits with `solveGivingWay` so the free mirror line stays fixed, but drag never does). Expected / Fusion (measured task 611 for dim edit; drag unverified): dragging mirrored geometry moves the mirror copy, not the mirror axis. | **BUG** | **wrong geometry** | 2/2 reproduced | `packages/ui/input-handlers/selection-tools.js` / `packages/core/solver/engine.js` (hold symmetric mirror line during drag unless mirror line itself is dragged) (**1–2 places**) |
| **UX-11** | F4 | `node tests/audits/solver-ux-audit-1000-constraints-status-undo.mjs` (`M1.6`, `M1.7`): (a) Trim `L1` against vertical cutter `L2`, drag `L2` `x=50->70`; (b) Trim right half of dimensioned rect top edge `L1(a-b)` at `x=40` | (a) Trimmed end stays behind at `(50,20)` — **no `pointOnLine` holds it to cutter `L2`**. (b) On a rect edge, corner `b` is still used by `L2`, so old width dim **`d1=80` survives on `[a,b]` spanning across the trimmed gap** while `L1` is now length 40! Expected / Fusion (unverified): Trim creates coincident/point-on-curve at the cutter and removes/updates length dims tied to the trimmed span. | **BUG** | **wrong geometry** | 2/2 reproduced | `packages/core/trim.js:92-135,149-159` (**ONE place**) |
| **UX-12** | F1 | `node tests/audits/solver-ux-audit-1000-drag.mjs` (`DR2.3`): undo a drag (`redoStack.length === 1`), then drag a 0-DOF rect corner `c` | Corner `c` moves `0`, `history` stays `0`, **but `redoStack` is silently WIPED `1 -> 0`!** `ensureDragUndo` calls `saveState` (clearing `redoStack`), and `settleDragUndo` discards the snapshot without restoring `redoStack`. Expected / Fusion (unverified): touching/pulling a fully-constrained item never destroys Redo history. | **BUG** | **misleading UI** | 2/2 reproduced | `packages/ui/input-handlers/selection-tools.js:506-521` (**ONE place**: save & restore `redoStack`/`evicted` as `dimension-seams.js:224-243` does) |
| **UX-13** | F2 | `node tests/audits/solver-ux-audit-1000-irregularities.mjs` (`IR5.4.L-then-AxisX` vs `IR5.4.AxisX-then-L`): Dimension tool on slanted line `L1` and X-axis | **Selection-order irregularity**: clicking `L1` then `X-axis` creates **angle `26.565°`**; clicking `X-axis` then `L1` **silently ignores the X-axis** and creates **length `67.082` on `L1`**! Expected / Fusion (unverified): A-then-B and B-then-A produce the same angle dimension. | **BUG** | **misleading UI** | 2/2 reproduced | `packages/ui/input-handlers/dimension-tool.js` (allow built-in axis as first pick in `handleDimensionPointerDown`) (**ONE place**) |
| **UX-14** | F2 | `node tests/audits/solver-ux-audit-1000-irregularities.mjs` (`IR1.1a/b`, `IR1.2a/b`, `IR1.3`): preselect 2 lines `L1+L2` (or `L1+C1`), press `E` vs click Equal / Parallel ribbon | **Keyboard vs Ribbon irregularity**: `E` key applies Equal immediately to 2 preselected lines (and on `L1+C1` dumps raw `[ERR-EQUAL-01] ... Args: {"selectedShapes":["line","circle"]}`); Equal ribbon button **drops the 2-item preselection** (`firstElement: null`) and asks you to re-pick; Parallel/Perp/Collinear/Tangent/Coincident/Midpoint ribbon buttons also drop 2-item preselections. Expected / Fusion (unverified): ribbon button and shortcut run the exact same action, and 2-item preselection applies any 2-entity constraint immediately. | **BUG** | **misleading UI** | 2/2 reproduced | `packages/ui/input-manager.js:1363-1387,1566-1585` + `apps/sketchstudio/ui/ui-manager.js:58-100` (unify into ONE activation helper) |
| **UX-15** | F2 | `node tests/audits/solver-ux-audit-1000-irregularities.mjs` (`IR1.host.sketchstudio` vs `shaper` vs `penplotter`): (a) preselect line + click H/V ribbon; (b) click Parallel ribbon twice; (c) preselect 2 shapes + click Coincident; (d) preselect line + joint + `H` key vs H/V button | **4 host/button irregularities violating ONE reusable Design tab**: (a) H/V returns to `select` in SketchStudio vs stays in `hv` in Shaper/PenPlotter; (b) 2nd click on Parallel cancels to `select` in SketchStudio vs stays in `parallel` in Shaper/PenPlotter; (c) Coincident clears selection (`selCount=0, pending=null`) in SketchStudio vs keeps selection (`selCount=2, pending!=null`) in Shaper/PenPlotter; (d) `H` key applies H/V when 1 line + 1 joint selected, H/V button does not. | **BUG** | **misleading UI** | 2/2 reproduced | `apps/sketchstudio/ui/ui-manager.js:58-100` & `packages/ui/input-manager.js:1349-1361,1566-1585` (**ONE shared `activateTool` in `input-manager.js`**, delete SketchStudio's duplicate `handleToolActivate`) |
| **UX-16** | F7 / F1 | `node tests/audits/solver-ux-audit-1000-dimensions.mjs` (`D5.1`) + `live.mjs` (`L2.desktop`, `L2.phone`): double-click an existing driving dimension on a fixed-endpoint line | Editor never opens; **silently demotes the dimension to Reference (`(80)`) with NO undo step** and shows toast `"Dimension added as Driven (already determined by existing constraints). [ERR-DRIVEN-02]"` (says *"added"* during an edit and leaks `[ERR-DRIVEN-02]`). Expected / Fusion (unverified): either open read-only/refuse cleanly or tell user it is already determined without raw ERR code or saying "added", and any state change is undoable. | **BUG** | **misleading UI** | 3/3 reproduced (+live desktop & phone) | `packages/ui/numeric-input-manager.js:474-482` (**ONE place**) |
| **UX-17** | F2 / F7 | `node tests/audits/solver-ux-audit-1000-irregularities.mjs` (`IR8.1a/b/c/d`, `IR8.4`) + `dimensions.mjs` (`D1.1`, `D1.2`) + `live.mjs` (`L4.desktop`, `L4.phone`): type `-5`, `w = 50`, or `d` in Line draw-time box vs Edit box | **3 draw-time vs edit-box irregularities**: (a) typing `w = 50` in draw-time box is refused with the **self-contradictory hint `"=" only as name = value at the start"`** (works in Edit box!); (b) typing `-5` or `0` keeps draw-time box open with inline `#dimHint`, whereas Edit box **closes immediately, discards text, and pops a toast**; (c) typing `d` shows parameter autocomplete `#dimComplete` in Edit box (`true`) but NOT in draw-time box (`false`). | **BUG** | **misleading UI** | 3/3 reproduced (+live desktop & phone; screenshots `.evidence/1000/draw-box-eq-hint-{desktop,phone}.png`) | `packages/ui/numeric-input-manager.js:671-686,901-934,1004` + `packages/core/parameters.js` (`evaluateBoxText`) (**2 places**) |
| **UX-18** | F7 | `node tests/audits/solver-ux-audit-1000-dimensions.mjs` (`D8.1`, `D8.2`): set `DOC_UNIT = 'in'`, type `100` (impossible) or `-2` into triangle `d3` | Refusal toast prints **raw internal millimeters** instead of the user's inch input: `"Can't set to 2540 — conflicts with distance. Reverted."` and `"Can't set to -50.8 — a length must be more than 0. Reverted."` Expected: display the typed text or formatted document units (`100 in` / `-2 in`). | **BUG** | **misleading UI** | 2/2 reproduced | `packages/ui/numeric-input-manager.js:684` (**ONE place**: use `uiState.singleInput.value.trim()` or `formatUnit(pv.value, docUnit(), { unit: true })`) |
| **UX-19** | F7 | `node tests/audits/solver-ux-audit-1000-constraints-status-undo.mjs` (`C1.8`, `C1.9`), `dimensions.mjs` (`D5.1`), `irregularities.mjs` (`IR1.2a`) + grep | **Raw `[ERR-*]` codes & developer JSON dumps leak into user-visible toasts** in 7 places (`[ERR-CMATH-01]`, `[ERR-CMATH-02]`, `[ERR-CSOLVE-02]`, `[ERR-DRIVEN-02]`, `[ERR-EQUAL-01]` + `Args:` JSON, `[ERR-DIM-02]` + `Args:` JSON, `[ERR-DRIVE-02]`, plus static legacy `[ERR-OVERCON-01]` + `Args:` in `live-dimension-input.js:300`). Violates task 874's rule that ERR codes & diagnostics go to the debug log only. | **BUG** | **misleading UI** | 2/2 reproduced (`C1.8`, `C1.9`, `D5.1`, `IR1.2a`; `live-dimension-input.js:300` static grep only, not reproduced) | `packages/core/constraint-manager.js:268,275,308`, `packages/ui/numeric-input-manager.js:478`, `packages/ui/input-manager.js:1376,1442`, `packages/ui/input-handlers/dimension-tool.js:291,465`, `packages/ui/input-handlers/live-dimension-input.js:300` (**multiple places — unify via ONE notice helper**) |
| **UX-20** | F7 | `node tests/audits/solver-ux-audit-1000-drag.mjs` (`DR3.0`) + `live.mjs` (`L3.desktop`, `L3.phone`): load triangle with contradictory dims `(50, 40, 120)` | Solver flattens triangle to collinear `(0,0)-(60,0)-(110,0)` with **10 mm error on every side**, yet renders **ZERO conflict warning/badge/colour**: `L1` renders **black (`rgb(0,0,0)`)** and `L2`/`L3` render **blue (`rgb(43,155,214)`)** with labels `50`, `40`, `120`! Expected / Fusion (unverified): over-constrained / unsolved constraints show red/amber conflict highlighting or a clear error indicator. | **BUG** | **misleading UI** | 3/3 reproduced (+live desktop & phone; screenshot `.evidence/1000/conflicted-triangle-desktop.png`) | `packages/core/constraint-status.js` + `packages/ui/svg-renderer.js` (**2 places**: surface `residual > tol` status from solver/verifier) |
| **UX-21** | F3 | `node tests/audits/solver-ux-audit-1000-constraints-status-undo.mjs` (`C1.13`): conflicted triangle `(50,40,120)` plus an UNRELATED free slanted line `L4(p,q)`, apply Horizontal to `L4` | **Refused** with `"Sketch geometry over constrained"`! `_sandboxVerify` solves the entire sketch globally and sees the triangle's 10 mm residual, blocking all new constraints on completely unrelated free geometry. Expected / Fusion (unverified): constraints on an independent connected component succeed, or sandbox compares delta residual. | **BUG** | **misleading UI** | 2/2 reproduced | `packages/core/constraint-manager.js:462-495` (**ONE place**: solve/check connected component or compare against pre-existing baseline residual) |
| **UX-22** | F6 | `node tests/audits/solver-ux-audit-1000-drag.mjs` (`DR6.3a` vs `DR6.3b`): select fixed line `L1` + free line `L2` together, drag `L2` by `(+0, +40)` | **`L2` refuses to move at all (`max move 0`)** because `getDragDOF` locks the ENTIRE group drag if ANY single selected joint is fixed/0-DOF. Dragging `L2` alone moves it `(+0, +40)`. Expected / Fusion (unverified): fixed items stay put while free items in the selection still move. | **BUG** | **misleading UI** | 2/2 reproduced | `packages/ui/input-handlers/selection-tools.js:89-99` (**ONE place**: exclude fixed members from group drag lock, or let solver hold fixed joints without zeroing the cursor delta) |
| **UX-23** | F6 | `node tests/audits/solver-ux-audit-1000-drag.mjs` (`DR6.2a/b`, `DR6.2c/d`): 1-step fast flick of 1-DOF line (`60->-60`) and 2-bar linkage (`(40,40)->(-40,-40)`) — joint drag vs body drag | **Joint drag vs Body drag lag irregularity**: joint flick runs task 548 sub-moves and reaches `(-12.7, 58.6)` / `(-18.6, -35.2)`; body flick skips sub-moves (`selection-tools.js:694` checks `state.joints.has(state.drag.id)`, always false for shapes!) and stalls far behind at `(56.9, 19.1)` / `(-9.3, -8.0)`. | **BUG** | **misleading UI** | 2/2 reproduced | `packages/ui/input-handlers/selection-tools.js:694` (**ONE place**: enable sub-moves for `state.drag.body` as well as joint drags) |
| **UX-24** | F2 | `node tests/audits/solver-ux-audit-1000-dimensions.mjs` (`D10.1`): diagonal line `L1(a,b)` with existing horizontal dim `d1=30`; preselect joints `a` and `b`, press `D` | **Refused** with `"Joints already dimensioned. Click the label to edit existing dimension."` — blocks adding the vertical dimension! Contrast clicking `a` then `b` with Dimension tool, which allows adding the vertical dimension. | **BUG** | **misleading UI** | 2/2 reproduced | `packages/ui/input-handlers/dimension-tool.js:185` (**ONE place**: remove redundant `hasDrivingDistanceForJoints` gate; `ConstraintManager._edgeHasDrivingDistance` already checks per `dimMode`!) |
| **UX-25** | F7 / F2 | `node tests/audits/solver-ux-audit-1000-irregularities.mjs` (`IR2.3.trim.*`, `IR2.3.break.*`): click Arc `A1`, Circle `C1`, and Bezier `B1` with Trim and Break tools | **Shape-kind feedback irregularity**: clicking Bezier shows helpful toast (`"Trim: not available on a Bezier curve (Trim cuts lines only)"` / `"Break: not available on a Bezier curve (Break splits lines only)"`); clicking **Arc or Circle is completely SILENT (`toasts=[]`)**! | **BUG** | **misleading UI** | 2/2 reproduced | `packages/ui/input-handlers/trim-tool.js` & `packages/ui/input-handlers/break-tool.js` (**2 places**: emit the same non-line notice for arcs/circles as for Beziers) |
| **UX-26** | F4 | `node tests/audits/solver-ux-audit-1000-constraints-status-undo.mjs` (`S1.1`): lock two meeting lines `L1`, `L2` (`fixed: true`), apply R10 fillet, inspect `selectionLockState` on `L1` | `L1` is 0-DOF (`L1:fixed`), **yet `selectionLockState(L1)` returns `{ has: true, locked: false }`** because the fillet replaced `b` with an unlocked tangent joint (`L1 joints fixed: true,false`). Context menu falsely offers "Lock" instead of "Unlock". | **BUG** | **cosmetic** | 2/2 reproduced | `packages/ui/input-manager.js:1484-1492` or `packages/core/fillet.js` (also tracked in NEXT-SESSION) |
| **UX-27** | F6 | `node tests/audits/solver-ux-audit-1000-irregularities.mjs` (`IR4.3`): hover at a line's midpoint vs an arc's sweep midpoint | Line midpoint snaps with `type=midpoint`; **arc midpoint returns `type=shape` (no midpoint snap)** even though task 875 added Midpoint constraint on arcs. Expected / Fusion (unverified): arcs show a midpoint snap triangle like lines. | **BUG** | **cosmetic** | 2/2 reproduced | `packages/ui/snap-detection.js` (**ONE place**: add arc midpoint candidate using `arcSweepMidpoint`) |
| **UX-28** | F5 | `node tests/audits/solver-ux-audit-1000-dimensions.mjs` (`D2.6`): degenerate triangle `(30,40,10)`, type `5` into `d3` | Toast claims `"Can't set to 5 — conflicts with distance. Reverted."`, **yet `c` drifts by `0.0018 mm`** because `revert()` runs `engine.solve(ITER())` after `restoreAll()`. Expected: a reverted edit leaves joint coordinates bit-identical. | **BUG** | **cosmetic** | 2/2 reproduced | `packages/core/dimension-seams.js:120` (**ONE place**: omit the redundant post-restore `engine.solve(ITER())` since `snap` was already solved) |
| **UX-29** | F7 | `node tests/audits/solver-ux-audit-1000-dimensions.mjs` (`D1.4`, `D1.6`): type `d1 * 2` into `d1`, or create cycle `d2 = d1 / 2` | `#dimHint` shows only raw edge arrow text **`"d1 -> d1"`** / **`"d1 -> d2 -> d1"`** with no explanation (e.g. `"Circular reference: d1 -> d1"`). | **BUG** | **cosmetic** | 2/2 reproduced | `packages/core/parameters.js` (cycle error string, **ONE place**) |
| **DIV-01** | F2 | `node tests/audits/solver-ux-audit-1000-irregularities.mjs` (`IR8.3`, `IR2.2.dim.C1`): draw circle typing `d1` (`60`) in draw-time box; click circle with Dimension tool | Draw-time box prompts **DIAMETER** (`60`), sets `r = 30`, and creates a **RADIUS** dimension with rewritten formula `expr="(d1) / 2"` (`R 30`); Dimension tool on a circle also creates **Radius** (`isRadius=true, isDiameter=false`). In Fusion 360 (measured task 597 for box; dim tool unverified), circles default to **Diameter (`Ø`)** dimensions and arcs to **Radius (`R`)**. | **DIVERGENCE** | **misleading UI** | 2/2 reproduced | `packages/ui/input-handlers/circle-tool.js:127,163` + `packages/ui/input-handlers/dimension-tool.js:607` |
| **DIV-02** | F3 | `node tests/audits/solver-ux-audit-1000-constraints-status-undo.mjs` (`C1.10`, `C1.11`, `C1.12`): on 0-DOF H/V rect, add `parallel(L1,L3)`, `perpendicular(L1,L2)`, `equal(L1,L3)` | All 3 **silently accepted** as redundant constraints, whereas `symmetric` (`constraint-manager.js:282`) and Fusion (`VCS_SKETCH_OVER_CONSTRAINTS`, measured task 518/526) refuse redundant geometric constraints. (Previously queued as task 526; owner to confirm.) | **DIVERGENCE** | **misleading UI** | 2/2 reproduced | `packages/core/constraint-manager.js:280-288` (**ONE place**: extend `isDistanceRedundant` check from `SYMMETRIC` to all `STRUCTURAL_TYPES` when `source === 'toolbar'`) |
| **DIV-03** | F2 | `node tests/audits/solver-ux-audit-1000-dimensions.mjs` (`D3.1`, `D3.2`, `D3.3`): double-click any Reference dimension | Completely silent — box never opens, no toast, no read-only copyable view. (Fusion (unverified): double-clicking a driven dimension either offers to copy/inspect or tells you it's driven.) | **DIVERGENCE** | **cosmetic** | 2/2 reproduced | `packages/ui/numeric-input-manager.js:472` (**ONE place**) |
| **DIV-04** | F6 | `node tests/audits/solver-ux-audit-1000-drag.mjs` (`DR1.5` vs `DR1.6`): drag bezier end joint `a` vs drag bezier body `B1` | Dragging body translates handles `c1`, `c2` with the endpoints; dragging end joint `a` leaves `c1` stationary (`delta 0,0`), bending the curve tangent. (Declared MVP limit in `mirror.js:30`; Fusion/Illustrator move attached spline handle with anchor, unverified.) | **DIVERGENCE** | **cosmetic** | 2/2 reproduced | `packages/ui/input-handlers/selection-tools.js:314-329` (**ONE place**) |

### Verified OK Baselines (no bug found)
- **Angle edits across 180° (`D4.120..D4.360`, `D4.j1/j2`, `U1.2`)**: continuous from `60° -> 120° -> 170° -> 180° -> 190° -> 270° -> 359° -> 360°`, refuses `0°`, `-30°`, `361°`, jump `60° -> 300° -> 60°` returns to `(25, 43.301)` with `residual ok`, Undo/Redo reproduces exact positions and values (`max move 0`).
- **Tangent & Perpendicular branch locks during drag (`DR4.4a/b/c`, `DR4.5`)**: external tangent circles, internal tangent circles, line-circle tangent, and perpendicular handedness all held their side with zero flips.
- **2-bar straight singular linkage (`DR5.1`)**: smoothly unfolds off singularity to `(50.032, 29.994)` with `|ab|=30, |bc|=40, residual ok`.
- **Point-on-line drag on built-in `ref_axis_x` vs fixed line (`DR6.1a/b`)**: both slide cleanly to `(70.013, 0)` with `residual ok`.
- **Delete geometry cleanup (`C3.1–C3.4`)**: deleting fillet arc, mirror line, offset copy, or one side of offset source leaves `dangling=[]`.
- **Offset & Pattern drags (`M1.1`, `M1.2`, `M1.4a`, `M1.4b`)**: offset rect drag, `undimensionOffset` + copy drag, negative offset `-10` flip, rectangular pattern (3×1) drag source/copy, and circular pattern (4×360) drag source/copy all maintain `residual ok`.
- **Undo/Redo of constrained drag (`U1.1`) & O10 kept dimension delete (`C2.2`)**: exact positions restored (`max move 0`).

---

## Pairwise Irregularities Summary (Owner Turn 3725 Focus)

Every one of the 9 requested context pairs checked systematically:

1. **Tool button vs keyboard shortcut vs ribbon**:
   - **Preselect 2 lines -> `E` key vs Equal ribbon (`UX-14`)**: `E` applies immediately (`IR1.1a`); ribbon drops selection (`IR1.1b`).
   - **Preselect line + circle -> `E` key vs Equal ribbon (`UX-14`, `UX-19`)**: `E` shows raw JSON `[ERR-EQUAL-01]` toast (`IR1.2a`); ribbon is silent (`IR1.2b`).
   - **Preselect line + joint -> `H` key vs H/V ribbon (`UX-15`)**: `H` key applies Horizontal immediately; H/V button does not (`IR1.host.*`).
   - **Preselect 2 joints with existing H-dim -> `D` key vs Dimension tool clicks (`UX-24`)**: `D` blocks adding V-dim (`D10.1`); clicking with Dimension tool allows it.
   - **Preselect 2 lines -> `E` key vs Parallel/Perp/Collinear ribbon (`UX-14`)**: only `E` (keyboard) applies to 2 preselected shapes; all other 2-entity constraints drop the selection (`IR1.3`).
2. **Desktop (1280×800) vs Phone/Touch (390×844)**:
   - Draw-time Line box opens **focused** beside cursor on desktop (`L4.desktop: focused=true, rect={left:665,top:270}`) vs **unfocused** docked top-center on phone (`L4.phone: focused=false, rect={left:95,top:191}`) — deliberate touch keyboard avoidance (task 597/602), verified clean with no overlap on `draw-box-eq-hint-phone.png`.
   - Core bugs `UX-02` (`L1.phone`), `UX-16` (`L2.phone`), `UX-17` (`L4.phone`), and `UX-20` (`L3.phone`) reproduce identically on phone and desktop.
3. **Line vs Arc vs Circle vs Spline (Bezier) for the same action**:
   - **Lock (`F`) (`UX-06`)**: locks Line & Arc to 0 DOF, leaves **Circle** at 1 DOF (rim drags `20 -> 40`) while reporting `locked: true` (`IR2.1.*`).
   - **Trim & Break (`UX-25`)**: warns on **Bezier**, completely silent on **Arc & Circle** (`IR2.3.*`).
   - **Dimension (`DIV-01`, `IR2.2.*`)**: Line -> length, Arc -> radius, Circle -> radius (mismatching its own diameter draw-time box!), Bezier -> warning toast.
   - **Midpoint snap (`UX-27`)**: works on **Line** (`type=midpoint`), missing on **Arc** (`type=shape`) (`IR4.3`).
   - **Bezier end drag vs body drag (`DIV-04`)**: body carries control points, end drag leaves handles behind (`DR1.5/1.6`).
4. **First apply vs second apply**:
   - **Duplicate exact constraint**: 1st adds cleanly, 2nd shows 874 red X `'Sketch geometry over constrained'` (`C1.1`) — OK.
   - **Redundant non-duplicate constraint (`DIV-02`)**: 2nd equivalent constraint (`parallel` on two H lines, `perp` on H+V, `equal` on opposite rect sides) silently accepted (`C1.10–C1.12`), whereas `symmetric` refuses (`constraint-manager.js:282`).
   - **2nd click on same constraint ribbon button (`UX-15`)**: cancels to `select` in SketchStudio, does nothing in Shaper / Pen Plotter (`IR1.host.*`).
   - **1st vs 2nd dimension on an edge / determined angle (`UX-19`)**: 2nd distance gives clean `info` toast (`C1.7`), while angle on H+V lines gives `warning` toast with raw `[ERR-CMATH-02]` (`C1.8`).
5. **Constraint made by a snap vs by a tool**:
   - **Arc's own start & end (`UX-03`)**: Coincident *tool* refuses `(s,e)` with `'Sketch geometry over constrained'` (`IR4.1a`); drag-*snap* accepts and adds `coincident:e,s`, collapsing the arc to 0° (`DR4.1`)!
   - **Arc midpoint (`UX-27`)**: Midpoint *tool* works on arcs (task 875), *snap* does not detect arc midpoints (`IR4.3`).
6. **Selection order A-then-B vs B-then-A**:
   - **Dimension tool Line vs X-axis (`UX-13`)**: `Line -> AxisX` makes **angle `26.565°`**; `AxisX -> Line` ignores the axis and makes **length `67.082`** (`IR5.4.*`)!
   - Coincident `P+L` vs `L+P`, Midpoint `P+A` vs `A+P`, Dim `L+P` vs `P+L`, Parallel/Equal/Tangent `A+B` vs `B+A` all behave symmetrically / per Fusion placement table (`IR5.1–IR5.3, IR5.5`).
   - **Coincident joint z-order (`UX-09`)**: hitting arc centre `c` vs coincident line end `p` at the same point translates rigidly vs shrinks radius (`DR6.4a/b`).
7. **SketchStudio vs Shaper / Pen Plotter Design tab (`UX-15`)**:
   - 3 distinct divergences in `IR1.host.*` (H/V post-tool state, double-click constraint tool toggle-off, Coincident selection clearing & `pendingConstraint`), all caused by SketchStudio keeping its own `apps/sketchstudio/ui/ui-manager.js:handleToolActivate` instead of using shared `switchToTool`.
8. **Before vs after Undo/Redo**:
   - `toggleDriving` (`UX-08`, `D9.3b`), `toggleFixedSelection` Lock (`UX-08`, `IR2.1.undo`), and double-click determined-dim auto-demote (`UX-16`, `D5.1`) are **NOT undoable** (`history +0`).
   - Dragging a 0-DOF item **wipes `redoStack`** (`UX-12`, `DR2.3`).
   - Standard drag (`U1.1`), angle > 180° edit (`U1.2`), and O10 formula-referenced dim delete (`C2.2`) undo/redo cleanly (`max move 0`).
9. **Dimension typed in draw-time box vs edited afterwards**:
   - `w = 50` works in edit box (`IR8.1c`), fails in draw-time box with contradictory hint `"=" only as name = value at the start` (`UX-17`, `IR8.1b`).
   - `-5` / `0` stays open with inline `#dimHint` in draw-time box (`IR8.1a`), closes & discards text with warning toast in edit box (`UX-17`, `D1.1/D1.2`).
   - Parameter autocomplete `#dimComplete` opens in edit box (`true`), never in draw-time box (`false`) (`UX-17`, `IR8.4`).
   - Circle draw-time box asks **diameter** (`d1 = 60`), creates **radius** dim with rewritten `(d1) / 2` (`DIV-01`, `IR8.3`).
   - Drawing a 4×40 rect works; editing a 500×40 rect's width to `4` is falsely refused (`UX-02`, `D7.1`).

---

## Performance Feel (~200 Constrained Items)

Verbatim measurements from `node tests/audits/solver-ux-audit-1000-perf.mjs` and real Chrome 1280×800 (`solver-ux-audit-1000-live.mjs`):

```text
ROW P1.rect15   | shapes=60  joints=61  constraints=75  | quickSolve(8): mean=1.3ms  p95=4.64ms | fullSolve(500): mean=0.31ms  p95=1.68ms  | analyzeStatus(1x): mean=0.82ms | realPointerMove(incl. render): mean=11.6ms  p95=16.97ms
ROW P1.rect25   | shapes=100 joints=101 constraints=125 | quickSolve(8): mean=1.59ms p95=6.39ms | fullSolve(500): mean=0.22ms  p95=0.29ms  | analyzeStatus(1x): mean=0.96ms | realPointerMove(incl. render): mean=14.52ms p95=18.76ms
ROW P1.rect50   | shapes=200 joints=201 constraints=250 | quickSolve(8): mean=2.55ms p95=7.65ms | fullSolve(500): mean=0.35ms  p95=0.7ms   | analyzeStatus(1x): mean=2.57ms | realPointerMove(incl. render): mean=26.6ms  p95=32.17ms
ROW P2.chain50  | shapes=50  joints=52  constraints=50  | quickSolve(8): mean=0.9ms  p95=1.92ms | fullSolve(500): mean=6.74ms  p95=9.82ms  | analyzeStatus(1x): mean=0.48ms | realPointerMove(incl. render): mean=16.07ms p95=22.44ms
ROW P2.chain100 | shapes=100 joints=102 constraints=100 | quickSolve(8): mean=1.27ms p95=3.46ms | fullSolve(500): mean=9.51ms  p95=14.57ms | analyzeStatus(1x): mean=0.63ms | realPointerMove(incl. render): mean=31.76ms p95=37.72ms
ROW P2.chain200 | shapes=200 joints=202 constraints=200 | quickSolve(8): mean=1.95ms p95=2.44ms | fullSolve(500): mean=16.74ms p95=21.31ms | analyzeStatus(1x): mean=1.6ms  | realPointerMove(incl. render): mean=64.6ms  p95=87.01ms
ROW L5.perf.desktop | real Chrome drag on 50 rects (200 lines, 250 constraints): {"frames":91,"meanMs":20.7,"p50Ms":16.7,"p95Ms":33.4,"maxMs":33.4}
```

**Takeaway**: The sparse solver itself is fast (`quickSolve` = 1.95–2.55 ms at 200 items), **but end-to-end per-frame drag drops to ~30 fps on 200 independent lines (real Chrome p95 = 33.4 ms) and ~15 fps on a 200-segment coupled chain (Node `realPointerMove` mean = 64.6 ms, p95 = 87.0 ms)** because every drag move runs `getDragDOF` (`analyzeConstraintStatus` + `JSON.stringify` + RREF nullspace), 1–2 quick solves, then rAF runs `engine.solve(500)` + another `analyzeConstraintStatus` + full SVG DOM rebuild. Skipping `analyzeConstraintStatus` re-computation mid-drag (DOF topology cannot change during a drag!) and capping per-frame solve iterations during active drags would cut frame cost substantially.

---

## Divergences from Standard CAD Sketchers

Deliberate or design-level differences from Fusion 360 / SolidWorks / Onshape for the owner to decide (not mixed with unambiguous BUGs):

1. **Circle dimensions default to Radius (`R`) while draw-time circle box asks Diameter (`DIV-01`)**: Fusion 360 uses Diameter (`Ø`) for both circle creation and circle Dimension tool, reserving Radius (`R`) for arcs. Typing `d1` into the circle draw-time box here rewrites the expression to `(d1) / 2` on a radius dimension.
2. **Redundant non-duplicate geometric constraints silently accepted (`DIV-02`)**: Adding `parallel` to two Horizontal lines or `equal` to opposite sides of a rectangle succeeds silently here (`C1.10–C1.12`), whereas Fusion refuses all redundant geometric constraints (`VCS_SKETCH_OVER_CONSTRAINTS`, queued earlier as task 526).
3. **Reference dimensions do nothing on double-click (`DIV-03`)**: Double-clicking a driven/reference dimension is completely silent (`D3.1–D3.3`).
4. **Bezier end drag does not move its control point handle (`DIV-04`)**: Dragging a bezier body carries `c1`/`c2`, while dragging an endpoint leaves `c1`/`c2` stationary (`DR1.5` vs `DR1.6`; declared MVP limit).
5. **No Chamfer tool in the Design tab**: Fusion / SolidWorks / Onshape offer Sketch Chamfer alongside Sketch Fillet; Sketch-Studio currently has Fillet only.

---

## Top 10 to Fix First (BUGs first)

1. **UX-01 (`wrong geometry`, ONE place)**: `toggleDriving` on reference H/V dimensions sets `c.value = getDist(j1, j2)` (hypotenuse) and jumps geometry (`dimension-seams.js:361-365`).
2. **UX-02 (`wrong geometry`, ONE place)**: `findCollapsedShape` 1% rule falsely refuses shrinking a 500×40 rectangle to 4 mm width (`constraint-verifier.js:409-427`).
3. **UX-03 (`wrong geometry`, 2 places)**: Dragging an arc's end onto its own start snaps and adds `coincident:e,s`, permanently collapsing the arc to zero sweep (`constraint-manager.js` + `snap-detection.js`).
4. **UX-04 (`wrong geometry`, ONE place)**: `breakShape` ignores constraints, letting a broken horizontal/dimensioned line bend into a V (`break.js:24-58`).
5. **UX-08 (`wrong geometry`, 2 places same file)**: `toggleDriving` and Lock/Unlock (`F` / ribbon / context menu) take no undo snapshot — permanently un-undoable and `toggleDriving` permanently destroys formulas (`input-manager.js:1439,1495`).
6. **UX-06 (`wrong geometry`, 2 places)**: Locking a circle (`F` / Lock) reports `locked: true` while leaving its radius 1-DOF blue and freely draggable (`input-manager.js:1495-1516` + `engine.js`).
7. **UX-07 (`wrong geometry`, ONE place)**: `deleteSelection` re-pushes filtered-out constraints, allowing deletion of constraints on **locked sketches** (`delete-manager.js:182-187`).
8. **UX-05 (`wrong geometry`, 2 places)**: Fillet arcs have `sweep: undefined`, folding inside-out when a corner is dragged past 180° (and driving open NEW-11 fillet arc midpoint flip) (`fillet.js:522`).
9. **UX-15 + UX-14 (`misleading UI`, ONE shared activation helper)**: Delete SketchStudio's duplicate `handleToolActivate` (`apps/sketchstudio/ui/ui-manager.js:58-100`) and unify `E`/`H`/ribbon preselection in `packages/ui/input-manager.js` so SketchStudio, Shaper, Pen Plotter, ribbon buttons, and keyboard shortcuts behave identically.
10. **UX-17 + UX-16 + UX-18 + UX-19 (`misleading UI`)**: Clean up dimension/constraint UX notices & box rules — stop draw-time box telling `w = 50` `"=" only as name = value at the start"`, keep edit box open on `<= 0` like draw-time box, format refusal toast in document units (not mm), stop double-click fixed dim from saying `"added as Driven"` without undo, and strip the remaining 7 raw `[ERR-*]` / JSON `Args:` toast leaks.

---

## Verbatim Evidence Excerpts

### Dimensions (`node tests/audits/solver-ux-audit-1000-dimensions.mjs`)
```text
ROW D1.1 | type "-5" into d1 (was 80): box closed toasts ["[warning] ⚠️Can't set to -5 — a length must be more than 0. Reverted."] undo steps +0; now value 80 driving; max move 0; residual ok; history 0 -> 0
ROW D1.4 | type "d1 * 2" into d1 (was 80): box STAYS OPEN hint "d1 -> d1" toasts [] undo steps +0; now value 80 driving; max move 0; residual ok; history 0 -> 0
ROW D1.8 | type "1000000" into d1 (was 1000000000): box closed toasts ["[warning] ⚠️Can't set to 1000000 — 1000000.00 would collapse a line to a point. Reverted."] undo steps +0; now value 1000000000 driving; max move 0 (b); residual ok; history 2 -> 2
ROW D2.6 | below the limit: type "5" into d3 (was 10): box closed toasts ["[warning] ⚠️Can't set to 5 — conflicts with distance. Reverted."] undo steps +0; now value 10 driving; max move 0.0018 (c); residual ok; history 4 -> 4
ROW D5.1 | both ends fixed: type "70" into d1 (was 50): NOT OPENED (the box did not open) toasts ["[info] ℹ️Dimension added as Driven (already determined by existing constraints). [ERR-DRIVEN-02]"]; now value 50 REFERENCE; max move 0; residual ok; history 0 -> 0
ROW D7.1 | 500x40 rect shrunk to 4 mm (<1%): type "4" into d1 (was 500): box closed toasts ["[warning] ⚠️Can't set to 4 — 4.00 would collapse a line to a point. Reverted."] undo steps +0; now value 500 driving; max move 0; residual ok; history 0 -> 0
ROW D7.2 | 500x40 rect shrunk to 5 mm (=1%): type "5" into d1 (was 500): box closed toasts [] undo steps +1; now value 5 driving; max move 495 (b); residual ok; history 0 -> 1
ROW D8.1 | DOC_UNIT=in, type "100" (inches): type "100" into d3 (was 50): box closed toasts ["[warning] ⚠️Can't set to 2540 — conflicts with distance. Reverted."] undo steps +0; now value 50 driving; max move 0; residual ok; history 0 -> 0
ROW D9.1 | toggleDriving ref H-dim on diagonal (30,40): res={"nowDriving":true,"refused":false,"error":null}; d1.value=50 (expected 30, hyp=50); b=(50, 40); max move 20 (b); residual ok; history 0 -> 0
ROW D9.2 | toggleDriving ref V-dim on diagonal (30,40): res={"nowDriving":true,"refused":false,"error":null}; d1.value=50 (expected 40, hyp=50); b=(30, 50); max move 10 (b); residual ok; history 0 -> 0
ROW D10.1 | preselect 2 joints with existing H-dim, press D: tool=dim, constraints=1, toasts=["[info] ℹ️Joints already dimensioned. Click the label to edit existing dimension."]
```

### Drag (`node tests/audits/solver-ux-audit-1000-drag.mjs`)
```text
ROW DR2.3 | drag 0-DOF corner c while redoStack had 1 item(s): max move 0, hist 0->0, redoStack 1->0
ROW DR3.0 | conflicted triangle (50,40,120) loaded: a=(0, 0) b=(60, 0) c=(110, 0), residual 10 on distance d1, dof 1 {L1:fixed L2:free L3:constrained}
ROW DR4.1 | arc drag sweep=true: at180={"e":"(-40, 0.064)","ang":"179.9","sweep":true,"r":"40"} at270={"e":"(0, -40)","ang":"-90","sweep":true,"r":"40"} at355={"e":"(39.887, -3.004)","ang":"-4.3","sweep":true,"r":"40"} cross0={"e":"(40, 0)","ang":"0","sweep":true,"r":"40","constraints":["equal:c,s,c,e","coincident:e,s"]} residual ok
ROW DR4.2b | fillet leg dragged near/past 180: near180={"c":"(99.738, 5.108)","arcC":"(49.488, 10)","arcS":"(49.488, 0)","arcE":"(50.509, 0.052)","res":"residual ok"}; past180={"c":"(97.417, -15.864)","arcC":"(51.628, 10)","arcS":"(51.628, 0)","arcE":"(48.456, 0.517)","res":"residual ok"}
ROW DR4.3b | mirror about FREE line ML, drag a (30,10)->(40,35): ML m1 (0, -50)->(8.135, -49.643), m2 (0, 50)->(-0.403, 49.995), residual ok
ROW DR6.2c | FAST 1-step flick 2-bar JOINT c (40,40)->(-40,-40): b=(21.332, -33.837), c=(-18.644, -35.215), residual ok
ROW DR6.2d | FAST 1-step flick 2-bar BODY L2 (40,20)->(-40,-20): b=(21.203, -33.918), c=(-9.261, -7.997), residual ok
ROW DR6.3a | multi-select (fixed L1 + free L2), drag free L2 (+0,+40): kind=joint p, p=(60, 20), q=(100, 20), max move 0
ROW DR6.4a | arc centre 'c' first in map, coincident with line end 'p', drag (+20,+20): kind=joint p, c=(40.077, 40), s=(50.032, 19.962), e=(20.042, 49.961), r 30->22.374
ROW DR6.4b | line end 'p' first in map, coincident with arc centre 'c', drag (+20,+20): kind=joint c, c=(40.077, 40), s=(70.077, 40), e=(40.077, 70), r 30->30
```

### Constraints, Status, Undo, Modify (`node tests/audits/solver-ux-audit-1000-constraints-status-undo.mjs`)
```text
ROW C1.8 | add angle (toolbar): res=REFERENCE, count 7->8, max move 0, toasts=["[warning] ⚠️Dimension set to reference — lines are H and V (angle is 90°) [ERR-CMATH-02]"]
ROW C1.9 | add symmetric (toolbar): res=null, count 8->8, max move 0, toasts=["[error] Copy⚠️Symmetric rejected — the two entities are the same point [ERR-CMATH-01]"]
ROW C1.10 | add parallel (toolbar): res=ADDED, count 8->9, max move 0, toasts=[]
ROW C1.13 | add H to UNRELATED free line L4 while triangle is conflicted: res=null, toasts=["[overconstrained] Sketch geometry over constrained"], residual 10 on distance d1
ROW C2.1 | deleteSelection with LOCKED sketch-1 shape L1 + dim d1 selected: shapes 1->1, constraints 2->1 (d1 still present: false)
ROW S1.1 | fillet on two locked lines L1,L2: before=dof 0 {L1:fixed L2:fixed}; after=dof 0 {L1:fixed L2:fixed s_arc_...:fixed}; selectionLockState(L1)={"has":true,"locked":false} (L1 joints fixed: true,false)
ROW M1.5 | BREAK H+D80 line L1 at t=0.5 -> drag midJoint ... to (40,30): statusAfterBreak=(dof 2 {L1:constrained Lbrk_...:free}); mid=(40, 29.994) (bent into V!), a=(0, 0), b=(80, 0), constraints=["horizontal:a,b","distance:a,b"]
ROW M1.6 | TRIM L1 against vertical cutter L2 -> drag cutter x=50->70: trimmedEnd (50, 20)->(50, 20), cutter c=(70.077, 0)
ROW M1.7 | TRIM right half of dimensioned rect edge L1(a-b): L1.joints=["a","j39_..."], d1 still exists=true, d1.joints=["a","b"], L1 len=40, d1.val=80
```

### Pairwise Irregularities (`node tests/audits/solver-ux-audit-1000-irregularities.mjs`)
```text
ROW IR1.1a | SketchStudio preselect L1+L2, press E key: tool=select, constraints=equal, toasts=[]
ROW IR1.1b | SketchStudio preselect L1+L2, click Equal ribbon (found=true): tool=equal, pending={"type":"equal","firstElement":null}, constraints=, toasts=[]
ROW IR1.2a | preselect L1+C1, press E key: tool=select, toasts=["[warning] ⚠️Equal constraint requires two lines or two circles/arcs [ERR-EQUAL-01] Reason: Invalid selection for equal constraint. Args: {\"selectedShapes\":[\"lin"]
ROW IR1.host.sketchstudio | HV-preselect={"okHV":true,"tool":"select","constraints":["horizontal"]}; parallel-2x=parallel->select; coin-2sel={"tool":"coincident","selCount":0,"pending":null}; L1+j(c) H-key={"tool":"select","constraints":["horizontal"]} vs H-btn={"tool":"hv","constraints":[]}
ROW IR1.host.shaper | HV-preselect={"okHV":true,"tool":"hv","constraints":["horizontal"]}; parallel-2x=parallel->parallel; coin-2sel={"tool":"coincident","selCount":2,"pending":{"type":"coincident","firstElement":null}}; L1+j(c) H-key={"tool":"select","constraints":["horizontal"]} vs H-btn={"tool":"hv","constraints":[]}
ROW IR2.1.C1 | Lock C1 via F: hist 0->1, lockState={"has":true,"locked":true}, dof 10 {L1:fixed C1:free A1:free B1:free} rimDrag r:20->40.026
ROW IR2.3.trim.A1 | trim click A1: shapes 4->4, toasts=[]
ROW IR2.3.trim.B1 | trim click B1: shapes 4->4, toasts=["[warning] ⚠️Trim: not available on a Bezier curve (Trim cuts lines only)"]
ROW IR4.1a | Coincident tool on arc's own start & end (s,e): res=null, e=(0, 40), toasts=["[overconstrained] Sketch geometry over constrained"]
ROW IR4.3 | snap at LINE midpoint (-35,0): type=midpoint; snap at ARC midpoint (61.213,21.213): type=shape (no arc midpoint snap!)
ROW IR5.4.L-then-AxisX | Dim tool L-then-AxisX: constraints=["angle(s=ref_axis_x,L1,v=26.565,drv=false)"], placing=false, toasts=[]
ROW IR5.4.AxisX-then-L | Dim tool AxisX-then-L: constraints=["distance(s=,v=67.082,drv=false)"], placing=false, toasts=[]
ROW IR8.1a | Line draw-time box type "-5"+Enter: opened=true, stillOpen=true, invalid=true, hint="A length must be more than 0.", toasts=[], shapes=1
ROW IR8.1b | Line draw-time box type "w = 50"+Enter: stillOpen=true, invalid=true, hint=""=" only as name = value at the start", params=, shapes=1
ROW IR8.1c | EDIT box type "w = 50"+Enter: box closed toasts [] undo steps +1, dim name=w val=50 expr="undefined", params=
ROW IR8.3 | Circle draw-time box type "d1" (d1=60): circle.radius=30, created dim: isRadius=true, isDiameter=undefined, value=30, expr="(d1) / 2"
ROW IR8.4 | typing "d" autocomplete (#dimComplete) visible: draw-time box=false vs edit box=true
```

### Live Headless Chrome (`node tests/audits/solver-ux-audit-1000-live.mjs`, local screenshots `.evidence/1000/`)
```text
ROW L1.desktop | 500x40 rect type "4" into d1: opened=true, boxStill=false, toasts=["[warning] ⚠️Can't set to 4 — 4.00 would collapse a line to a point. Reverted."]
ROW L2.desktop | dblclick driving dim on fixed line: label "80"->"(80)", toasts=["[info] ℹ️Dimension added as Driven (already determined by existing constraints). [ERR-DRIVEN-02]"]
ROW L3.desktop | conflicted triangle (50,40,120) visual: {"lines":[{"id":"L1","cls":"shape-elem","stroke":"rgb(0, 0, 0)",...},{"id":"L2","cls":"shape-elem","stroke":"rgb(43, 155, 214)",...},{"id":"L3","cls":"shape-elem","stroke":"rgb(43, 155, 214)",...}],"labels":["50","40","120"]}
ROW L4.desktop | Line draw-time box: {"visible":true,"focused":true,"rect":{"left":665,"top":270,"w":160,"h":40}}; type "w = 50" hint={"visible":true,"text":"\"=\" only as  name = value  at the start","rect":{"left":665,"top":245}}
ROW L1.phone   | 500x40 rect type "4" into d1: opened=true, boxStill=false, toasts=["[warning] ⚠️Can't set to 4 — 4.00 would collapse a line to a point. Reverted."]
ROW L2.phone   | dblclick driving dim on fixed line: label "80"->"(80)", toasts=["[info] ℹ️Dimension added as Driven (already determined by existing constraints). [ERR-DRIVEN-02]"]
ROW L4.phone   | Line draw-time box: {"visible":true,"focused":false,"rect":{"left":95,"top":191,"w":184,"h":60}}; type "w = 50" hint={"visible":true,"text":"\"=\" only as  name = value  at the start","rect":{"left":95,"top":253}}
```
Verified local screenshots (`.evidence/1000/`, untracked):
- `draw-box-eq-hint-desktop.png` & `draw-box-eq-hint-phone.png`: show the Line draw-time dual box with red-bordered `w = 50` and the dark-red hint pill `"=" only as name = value at the start` cleanly above (desktop) / below (phone, docked top-center with green Done button).
- `rect-collapse-refusal-phone.png`: shows the 500×40 rectangle under the orange warning toast `Can't set to 4 — 4.00 would collapse a line to a point. Reverted.`.
- `conflicted-triangle-desktop.png`: shows the impossible `(50, 40, 120)` triangle flattened into a single horizontal line (blue `L2`/`L3` over black `L1`) with normal `50`, `120`, `40` dimension labels and zero conflict highlight.
