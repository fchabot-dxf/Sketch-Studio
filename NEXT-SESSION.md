# NEXT-SESSION — current worker instruction (advisor-owned)

## ⭐ PROJECT PRINCIPLES — re-anchor here EVERY rep (advisor + worker). NO SHORTCUTS. (user directive, kept across reps)

- **NORTH STAR — ONE reusable Design tab.** Any host (CAD / CNC / pen-plotter) embeds the SAME shared `#core`/`#ui`
  Design tab; other tabs differ per host. New engines land in `#core` (units · polygon-offset · loop-finder ·
  shaper-export · …) — REUSABLE, never a host one-off. **SketchStudio stays functionally UNREGRESSED at every commit**
  (shell-smoke 12/12; the 16-control style panel + behavior intact; the shared layer must not regress the other host).
  *Relaxed 2026-06-30 (user-approved): the ONE deliberate SketchStudio change is the shared header app-switcher (SWITCH-1)
  — additive nav, must keep shell-smoke 12/12. Default for everything else stays: don't touch Studio.*
- **DECLARE over hand-roll.** A "bug" is usually a missing DECLARATION (data / a named reusable thing), not a missing
  patch. Default DECLARE; INJECT/pass it (e.g. the export ENCODING is injected → #core never imports the app). Hand-roll
  only below the abstraction floor or a throwaway spike. Declared forms here: the cut RECORD · `CUT_TYPES` +
  `targetKind`/preview colors · `BIT_PRESETS`-as-data · the `{kind,id}` selection · the units BASE+lens · the V-bit /
  joint specs (coming).
- **NO SHORTCUTS.** No GUESS where the exact data exists (use the stored arc sweep; probe the real walk order) — no
  chord-approximation, coin-flip color, or rubber-stamp. Review from GROUND TRUTH (read the diff + run the
  oracle/shell-smoke yourself). Gate risky moves (plan-first; oracle the hard geometry); never big-bang. Quality >
  speed; momentum never buys a corner-cut.

---


> Read this + the **WORK-LOG.md** tail before starting. Target layout / plan: **ROADMAP.md**.
> Why the last attempt (`8b7db3d`) was reset: see the WORK-LOG entry for it — it broke the live
> no-build app and lacked shell-side wiring.

## Revised sequencing (post-reset) — the invariant changed

The carve-out runs as **load-safe vertical slices**, NOT "extract-all → move-all → rewire-all"
(that sequence killed the served app). **Invariant for EVERY commit, both required:**
1. `index.html` still **LOADS** in a browser — no missing-export / unresolved-import errors.
2. The **12-test solver oracle is green**.
"Oracle green" alone is NOT enough — the Node oracle can't see the shell, and this is a no-build
ESM app you run live. **Each extraction ships WITH its shell-side wiring in the same commit**, or
behavior regresses even where load doesn't break.

## ★ USER PUNCH LIST + REFINED MODEL — pen plotter (durable, pinned per request)

**THE MODEL (refined this session):** Draw + Sketch **MERGE into ONE "Design" tab** — freehand + precise + constraint tools
on one canvas, one `#core` geometry store, pen-colors. Shell collapses **5 -> 4 tabs: `Design -> Fill -> Toolpath -> Export`**.
**NO Bake seam** (one store; the pipeline targets the geometry directly — bake only existed to cross the two stores). Freehand
= the ONLY non-constrainable geometry. The items below are PROPERTIES of that model (verify each lands):
1. ~~Drop "optional" on Sketch~~ -> ABSORBED: no separate Sketch tab (merged into Design).
2. Imported SVG visible + editable in the Design tab (import lands in the `#core` geometry).
3. ~~Remove "Bake to Draw"~~ -> ABSORBED: one store, no bake bridge.
4. FREEHAND -> a `#core` shape stored as a BEZIER (curve-FITTED on stroke-end, NOT a dense polyline) => compact -> solver-light,
   smooth, editable; NON-constrainable for now. Imported SVG -> CONSTRAINABLE. Full DATA-merge (freehand lives in `#core`).
   NEEDS a freehand->bezier fitter (Schneider, ~150 LOC, pure). Pipeline already samples curves->polylines (from-path/PP-8).
   BEZIER itself = a SHARED feature, see #12.
5. Pen-color UNDERLAY on the Design canvas ("a layer of colors below") — host-side, `#ui` byte-identical.
6. Design tab uses the plotter's color UI (pen-color geometry via the underlay, NO DOF-blue recolor; chrome -> paper-light).
7. UNIFY — ONE `#core` geometry store + a plotter-side pen layer = THE MERGE above.
8. Draw + Sketch = ONE tab, different TOOLS (not two tabs, not a reorder). Import is a tool on it; import-before-constrain flow.
9. CONSISTENT pan + zoom on ALL plotter canvases — match `#ui`/other-apps (today the plotter canvas uses its own `viewport.js`).
10. **COLOR vs PEN is STAGED (resolves the pen-model question).** PEN = PHYSICAL, SVG = DIGITAL. Geometry carries a DIGITAL
    color (SVG/RGB) — edited in the **Design** tab. The PHYSICAL pen palette + the DIGITAL->PHYSICAL mapping live in the
    **Toolpath** tab (keeps PP-3c: the palette is a toolpath-stage concern). Fewer pens than colors (e.g. 8 SVG colors -> 4
    pens) => MATCH each digital color to the NEAREST physical pen (or the user reassigns). Design = digital color; Toolpath =
    physical-pen mapping.
11. **(FUTURE / optional) COLOR-MIXING — "hash color mixes":** approximate a digital color the palette can't hit by COMBINING
    physical pens (cross-hatch red+yellow -> orange; stipple/dither two pens -> a blend). REUSES `#core/plot/fills`
    (hatch/crosshatch/stipple). A DISTINCT new feature — parked AFTER the core migration; nail nearest-match first.
12. **BEZIER = a SHARED `#core`/`#ui` feature (a SUB-EPIC, PRECEDES the plotter unify).** Bezier is NEW to `#core`. Add a
    first-class bezier SHAPE (`#core`) + a bezier TOOL in the `#ui` ribbon for **ALL apps** (Studio + Shaper + plotter). The
    plotter's freehand curve-fits into the SAME shape. **Guardrail shift (deliberate, user-approved):** `#core`/`#ui` go from
    byte-identical to ADDITIVE — a new shape+tool, existing shapes/tools/constraints/tests UNREGRESSED (shell-smoke + core
    oracle stay green); all apps just GAIN the tool. **MVP** = draw/edit-control-points/render/export, NOT solver-constrained
    (constrainable control points = a big planegcs job, LATER). Sub-epic `BEZIER-*` lands FIRST; then UNIFY consumes it.
13. **MERGED RIBBON dedups REDUNDANT tools.** Select/Line/Rect appear in BOTH the Draw ribbon and the `#core` sketcher;
    Ellipse (plotter) ≈ Circle (`#core`). The merged Design ribbon = the UNION with dupes REMOVED — shared tools use the
    `#core` versions (constrainable). Keep unique-Draw (Freehand->bezier · Node · Scissors · Rotate · Scale) + unique-Sketch
    (Arc · constraints · dimension). GAP: `#core` has Circle, NOT Ellipse -> a small `#core` add (like bezier) or keep as-is.

14. **RENDER PARITY (normal sketch) — BUG, found debugging UNIFY-throttle.** Joints + DIMENSIONS + constraint glyphs must
    ALWAYS display in the Design tab like Studio/Shaper — they currently show ONLY ON SELECTION. Color theming is FINE (keep
    the plotter theme). ROOT CAUSE: the static-skip OVER-APPLIED (made normal sketch selection-gated). FIX: normal sketch =
    ALWAYS live (overlays always); static-skip triggers ONLY on a DENSE IMPORT (large batch), NEVER by default. (Folded into
    UNIFY-throttle via amends.)

Deferred (behind the unify): bulk fill-edit · cloud palette save/load · PP-8 path-parser dedup (tracked debt) · #11 color-mixing.

---

## ★ REDIRECT (2026-08-26) — pen-plotter burn-down PAUSED. New priority: SketchStudio core/solver bug hunt

**Context:** the user (talking directly to the advisor session, not through a queued batch) reports "the core and
solver have a lot of bugs, constraints are not applied correctly" in **`apps/sketchstudio`** (the original CAD
sketcher, NOT the pen-plotter). Concrete example given: **a simple rectangle or triangle should be easy to
dimension and constrain, and isn't working the way the user expects.**

**Advisor ground-truth check before dispatching:** ran every solver/constraint gate that exists —
`tests/harness/{solver-scenarios,constraint-conformance,solver-fuzz,differential-planegcs}.test.js` (23 scenarios +
15/15 canonical shapes + 400 fuzz sims + 9/9 vs the FreeCAD PlaneGCS oracle) + all 10
`packages/core/tests/solver-*.test.js`. **16/16 GREEN, right now, on this tree.** So this is NOT a known regression
any existing gate would catch — the gap is between test coverage (synthetic scenarios, driven through
`tests/harness/sketch.js` / the dimension-seams) and the REAL interactive app (mouse clicks, the actual dimension
tool UI, actual drag). Do not assume the Newton engine's math is at fault until the live repro says so — it is
just as likely a UI/interaction-layer bug (wrong joints wired to a constraint at creation time, a dimension input
that doesn't call solve(), a snap/selection bug that picks the wrong joint) as a solver Jacobian bug.

**Batch 3 (style tool) is DONE** (`d7ceb3c..a862032`, WORK-LOG `398b9e5`) — advisor-reviewed, all plotter-side, 0
`#core`/`#ui` touch. **Batch 4 (pen-plotter transforms) is DEFERRED, not cancelled** — resume it after this bug
hunt closes. Do not mix the two in one commit.

**▶ Scope — LIVE-DRIVE `apps/sketchstudio` (real browser clicks, e.g. via the CDP driver pattern from turn
366/368's `verify.cjs`, or `run` if that's faster), not just the test suite:**
1. **Rectangle:** draw one with the rect tool. Add a **Distance** dimension on one edge, then an **Equal** or a
   second **Distance** on an adjacent edge (so it's fully dimensioned — width+height). Drag a corner/edge —
   confirm it resizes along the dimensioned edges and does NOT deform into a non-rectangle (H/V should hold).
   Try toggling a dimension driver↔reference. Try over-constraining (a 3rd redundant distance) — should refuse or
   go reference, never silently corrupt geometry (per the "rectangle-or-refuse" invariant already tested in
   `solver-scenarios.test.js` — reproduce the SAME moves by actual click, not the harness seam, and see if they
   still hold).
2. **Triangle:** draw 3 lines forming a closed triangle (coincident corners). Add a Distance on each side (SSS) or
   an Angle + 2 Distances. Drag a vertex — confirm it resizes correctly, doesn't flip/mirror, doesn't leave a gap
   at a corner (coincidence should hold under drag).
3. **For each step, name the EXACT click sequence and what went wrong** (wrong shape, constraint didn't apply,
   dimension shows stale value, drag fights the constraint, console error, etc.) — this is the repro the fix
   proceeds from. If everything above actually works fine live, say so explicitly and ask the user for a MORE
   specific repro (which constraint type, which shape, which gesture) rather than guessing further.
4. **Root-cause + fix** whatever concretely breaks. Likely places to check first (not a prescription — verify,
   don't assume): `apps/sketchstudio/ui/input-handlers/{constraint-tools,dimension-tool,dimension-input}.js` (does
   the click path wire the SAME joints the solver expects?), `packages/core/constraint-manager.js` (does
   `createConstraint` get called with the right joint indices for a freshly-drawn rect/triangle?), and whether
   `solve()` actually runs after each constraint add / drag frame in the live app (vs. the harness which calls it
   explicitly).

**VERIFY LIVE (by clicks, screenshot or paste the console):** the rectangle flow (draw → dimension both edges →
drag → still a rectangle, correct size) and the triangle flow (draw → SSS dimension → drag a vertex → still
closed, correct lengths) both work as a CAD user would expect. Re-run the 16/16 solver/harness gate — must stay
green (don't regress the math while chasing a UI bug). `node --check` clean on any touched file.

Append a WORK-LOG entry (repro found, root cause, fix, live-verify) ending with exactly
`=== CORE-BUG-HUNT (rect/triangle dimension+constrain) DONE — HOLD ===`. **Then pass the ball back to advisor and STOP.**

---

## ★ AMENDMENT (2026-08-26, while worker was mid-task) — a CONFIRMED, real `#core` bug: circle radius dimensions cannot be edited

**This supersedes priority — fix THIS first, the rect/triangle live-click hunt above is now SECONDARY** (the
advisor's isolated breaker probe already proved rect/triangle dimension+constrain+drag is solid in `#core` —
26/26 adversarial checks incl. real line-tool triangle topology, incremental drag, EQUAL stacking, over-constrain
— so that hunt is unlikely to find a `#core` math bug; still worth a quick live sanity pass, but not the priority).

**The bug (reproduced headlessly, in the isolated `advisor-breaker` worktree, `tests/harness/breaker-rect-triangle.test.js`
Scenario 3 — NOT on your tree, don't look for the file there; the repro is copy-pasteable):**
1. Draw a circle with a locked radius (`circle-tool.js:104/139` → `state.shapes.push({id, type:'circle',
   joints:[centerId], radius:r})` + `addConstraint(state, DISTANCE, {shape, value:r, isRadius:true})` — note this
   uses `packages/core/constraints.js`'s plain `addConstraint`, NOT `ConstraintManager.createConstraint`). Solve
   converges fine (checked — the dead row does NOT corrupt the rest of the document either, checked that too).
2. **Edit the radius dimension's value** via the real edit seam (`dimension-seams.js` `commitDimensionEdit` — the
   exact function `numeric-input-manager.js:299` calls on every dimension edit, radius included). **The edit is
   REVERTED every time**, with `conflicts` naming `distance` — i.e., in the live app this reads as "Can't set to
   35 — conflicts with distance. Reverted," on a totally ordinary "change this circle's size" edit.

**Root cause (traced, not guessed):** `packages/core/solver/engine.js` lines 327-333, the `isRadius` joint
synthesis:
```js
else if (c.type === 'distance' && c.isRadius && c.shape) {
  const shape = this.shapes.find(s => s.id === c.shape);
  if (shape && (shape.type === 'circle' || shape.type === 'arc') && shape.joints && shape.joints.length >= 2) {
    params.joints = [jointIndexMap.get(shape.joints[0]), jointIndexMap.get(shape.joints[1])];
  }
}
```
requires a **second "rim" joint** (`shape.joints.length >= 2`) to build a solvable center→rim distance row. But
a REAL circle (`circle-tool.js`) is created with **exactly one joint — the center — always**; there is no rim
joint anywhere in the app (confirmed: grepped every `.radius =` write in `packages/ui/` — the ONLY write is at
circle creation; nothing ever mutates `shape.radius` afterward, and no interaction creates/drags a rim joint).
So for every real circle, this constraint's `params.joints` stays `[]`, and the row is inert — `shape.radius` is
a plain data field the solver never touches. Editing the dimension only changes `c.value`; the post-solve
geometric-honesty check (the one from `docs/architecture/SOLVER_WALKTHROUGH.md` "converged but lying" fix) then
correctly notices `c.value` (35) no longer matches the real geometry (`shape.radius` still 20) and refuses. The
refusal logic is doing its job — the actual bug is one layer up: **nothing ever had a mechanism to move
`shape.radius` toward the edited value in the first place.**

**The fix is narrow — do NOT build a rim-joint system, that's a much bigger change than this needs.** Every
existing consumer of a circle/arc's radius (the tangent branches at `engine.js:284, 302-303, 321-323`) ALREADY
reads `shape.radius` directly as the source of truth, not a joint distance. So radius is already, by convention,
a plain scalar property outside the joint/Jacobian system — the dimension EDIT path is the one place that
doesn't honor that convention. Fix in `packages/ui/dimension-seams.js`'s `commitDimensionEdit` (and check
`toggleDriving` too, which already does the mirror-image read at line 90-92 — `if (c.isRadius && c.shape) { ...
c.value = s.radius }` — but has no matching WRITE when editing): when `c.isRadius && c.shape`, also set the
shape's `radius = val` directly (before/alongside `c.value = val`) so the geometry actually moves, THEN let
`engine.solve()` run normally — any tangent constraint on that circle will naturally re-satisfy against the new
radius since it already reads `shape.radius` live. Verify: does a snapshot/revert on non-convergence (the
existing `reverted` path) still need to restore `shape.radius` too, not just joint positions + `c.value` — trace
the `snap`/restore logic in `commitDimensionEdit` for exactly this.

**Scope — VERIFY LIVE + FIX:**
1. Reproduce live in the browser: draw a circle, give it a radius, double-click the radius dimension, type a new
   value — confirm it currently reverts/refuses (or shows a wrong number). Screenshot or paste the console.
2. Fix per above (or a better-verified alternative if the trace turns up something more precise than this
   advisor's read of the code).
3. Also check: does the SAME gap affect `isRadius` on an **arc** (not just circle)? `engine.js:330` checks
   `shape.type === 'circle' || shape.type === 'arc'` — arcs are built by `makeArc` (`shapes.js:262`) with 3
   joints (per that function's docstring) — check whether an arc's radius dimension edit already works (3
   joints might satisfy `length >= 2` differently) or has the identical gap.
4. Re-run the 16/16 existing solver/harness gate (must stay green) + this advisor's breaker probe if you want a
   second oracle (ask the advisor for the worktree path, or just re-verify with your own repro — don't assume
   the breaker file, re-derive the check).

**VERIFY LIVE:** draw a circle, radius 20 → edit the radius dimension to 35 (or any new value) → the circle
VISIBLY resizes to the new radius, no revert, no console error. Do the same on an arc if #3 finds it's affected.

Append a WORK-LOG entry (repro, root cause, fix, live-verify) ending with exactly
`=== CIRCLE-RADIUS-EDIT-FIX DONE — HOLD ===`. **Then pass the ball back to advisor and STOP.**

---

## ★ TASK — arc structural integrity: an arc's two rim points must stay equidistant from center, ALWAYS (not just when dimensioned)

**Ground truth, independently confirmed twice** (advisor's headless breaker probe, `advisor-breaker`
worktree, Scenario 5 — AND the worker's own live-click repro during CIRCLE-RADIUS-EDIT-FIX, same
numbers): `makeArc()` (`packages/core/shapes.js:262-272`) builds an arc from 3 joints
`[center, start, end]`, placed equidistant from center **at creation time only** — it returns
`constraints: []`. Nothing ties `center↔end` to `center↔start` afterward. So:
- Dragging the arc's END joint (with or without a radius dimension) leaves `start` alone while `end`
  drifts to whatever distance the drag left it at — the arc silently stops being circular.
- Editing an isRadius dimension only moves `start` (the joint the synthesis wires in,
  `engine.js:328-333`, `shape.joints[1]`); `end` is untouched, same distortion.

**Advisor's ruling on the question the worker flagged ("is single-rim-point radius intentional or a
gap?"): it's a gap, fix it.** Nothing in the codebase or the project's docs treats "an arc's far
endpoint can silently leave the circle" as intentional — it's a byproduct of `isRadius` synthesis being
written generically for "distance + isRadius + shape" without accounting for arcs having TWO meaningful
rim points where circles conceptually have none. An arc that stops being circular after an ordinary drag
is a basic correctness bug for a CNC/CAD sketch tool, not a design choice.

**Fix direction (declare, don't hand-roll — this needs NO new solver math):** the real invariant is
`dist(center, start) == dist(center, end)`, which is EXACTLY what the existing `equal` constraint
definition already computes when given `joints:[a,b,c,d]` → `len(a,b) - len(c,d)`
(`packages/core/solver/definitions.js:414-451`). So: make `makeArc()`
(`packages/core/shapes.js:262-272`) return a **structural EQUAL constraint** —
`{ type: 'equal', joints: [center, start, center, end] }` — in its `constraints` array instead of the
current `[]`, mirroring how `makeRectFromTwoJoints` already bakes in H/V constraints at creation to keep
a rectangle a rectangle. The wiring is ALREADY THERE on the consumer side —
`arc-tool.js:227` already does `res.constraints.forEach(c => ConstraintManager.createConstraint(state,
c.type, c, {source:'arc'}))` for whatever `makeArc` returns; today that loop runs zero times. This is a
small, targeted change, not "build a rim-joint system."

**Scope — verify, fix, prove it holds under everything that already touches an arc:**
1. Add the structural EQUAL constraint in `makeArc()`. Confirm `finalizeArcFromActive` / wherever else an
   arc gets created goes through this same function (grep — don't assume there's only one call site).
2. Verify LIVE: draw an arc → drag its end handle → it stays circular (both rim points track). Add/edit
   a radius dimension → both ends move to the new radius, not just `start`.
3. Regression-check anything that ALREADY relies on an arc's two rim points being independently
   draggable (if any UI flow intentionally reshapes an arc's sweep by moving just one endpoint at a
   fixed radius — that should still work fine with EQUAL in place, since EQUAL only pins the two
   *radii* equal, not the angle/position — but verify this live, don't assume). Check the arc-drag /
   arc-integration specs still pass and still test what they claim to.
4. Keep the 16/16 solver/harness gate green + all the arc/circle-adjacent specs from last turn
   (`arc-tool`, `arc-integration`, `arc-drag`, `radial-locked`, `solver-tangent-arc-arc`).

**VERIFY LIVE:** draw an arc, radius ~any → drag the far endpoint around → the arc visibly stays a
constant-radius curve (both ends track center distance) instead of stretching one end while the other
stays put. Same check after a radius-dimension edit.

Append a WORK-LOG entry (repro, fix, live-verify, regression) ending with exactly
`=== ARC-STRUCTURAL-INTEGRITY DONE — HOLD ===`. **Then pass the ball back to advisor and STOP.**

---

## ★ TASK (user-reported, screenshot) — the Style/settings panel force-opens on every app load

**Root-caused already, small isolated fix — land this FIRST, before or interleaved with the arc task
since it's a different file and a glaring, immediate UX bug (visible the instant the app loads).**

**Root cause (traced via WORK-LOG history, not guessed):** `packages/ui/input-manager.js:280` —
`try { opts.openSettings?.(svg, state); } catch(_) { }` — calls the injected `openSettings` callback
**unconditionally, once, during `setupInput`'s init sequence.** That's correct IF `openSettings` is an
*install* hook (its original purpose per WORK-LOG t~1995: `openSettings: (s,st) =>
import('./ui/settings-panel.js').then(m => m.default?.(s,st))` — lazily import a module that itself
wires a `#btn-settings-toggle` DOM button's click listener; nothing shown yet, just installed).

But WORK-LOG (t3468) records: *"redirected the input-manager `openSettings` seam → `stylePanel.open()`"*
— and `apps/sketchstudio/main.js:166` now has `setupInput(svg, state, { openSettings: () =>
stylePanel.open() })`. Since `input-manager.js` still calls this unconditionally at setup (the OLD
"install" contract), and the callback now means "show the dialog" (the NEW contract), **every app load
calls `stylePanel.open()` once, forcing the panel open on start.** One name (`openSettings`), two
meanings, and the call site still obeys the old one — the exact "codebase lies about itself" class of
bug (a seam whose behavior silently changed meaning under it).

**The old `#btn-settings-toggle` this seam was built for is explicitly retired** (main.js's own comment:
*"The input-manager's settings gesture now opens the SHARED style panel (the old #settings-panel is
retired)"*), and the header already has a real, working **Style** button
(`app-header.js`'s `onStyle: () => stylePanel.toggle()`, confirmed wired at `main.js:152`) — so this
seam is now pure legacy surface with no live purpose. Confirmed Shaper doesn't use `setupInput`'s
`openSettings` option at all (grepped `apps/shaper/` — zero hits), so nothing else depends on it.

**Fix (no legacy path — remove, don't patch around):** drop the `openSettings` option from the
`setupInput(...)` call in `apps/sketchstudio/main.js:166` entirely (the Style header button is the sole,
correct way to open the panel now). Then check whether `input-manager.js`'s `opts.openSettings?.(...)`
call + its now-stale comment (lines 5, 278-280) should be deleted too, since grep shows this was its
ONLY caller across the whole repo — verify that yourself before deleting (don't assume from this
advisor's grep alone).

**VERIFY LIVE:** reload the app — the Style panel must NOT be open on load. Click the header's Style
button — it still opens/closes the panel normally (16 controls, Save/Reset/Close all still work).

Append a WORK-LOG entry ending with exactly `=== STYLE-PANEL-AUTOOPEN-FIX DONE — HOLD ===` (append this
one whenever you land it relative to the arc task — they're independent, land + verify + WORK-LOG each
separately rather than bundling one commit).

---

## ★ TASK (found by the advisor's breaker sweep, 2026-08-26) — a "converged but lying" gap: TANGENT doesn't re-satisfy after a shape's radius changes externally

**Both prior turns reviewed and independently re-verified — excellent work, no notes.** Diff read,
16/16 gate + every named unit spec re-run by the advisor personally (all green), and the advisor's own
headless breaker probe confirms both fixes hold under adversarial conditions (arc: 7/7 checks now pass
where 2 failed before; style-panel: confirmed absent on load). This is genuinely a NEW bug the breaker
sweep found while testing tangent constraints on top of your radius-edit fix — not a regression from
your work, but a gap your fix makes newly REACHABLE (see below).

**Confirmed behavior (`advisor-breaker` worktree, Scenario 6 in `breaker-rect-triangle.test.js`,
reproducible standalone — copy the repro, don't take this write-up on faith):**
1. A circle, tangent-constrained to a line (`ConstraintManager.createConstraint(state, TANGENT, {line,
   circle})`), with a radius dimension (`isRadius`). Converges correctly, tangent holds.
2. Edit the radius dimension (via the real `commitDimensionEdit` seam your last-but-one turn fixed) —
   **the edit gets reverted, "conflicts with tangent."** That revert is *correct behavior given what's
   underneath it* — not the bug itself.
3. **Root cause, isolated (bypassing the edit seam, mutating `shape.radius` directly + calling
   `engine.solve()` raw, exactly like `commitDimensionEdit` does internally):** the solve returns
   `{converged: true, error: ~1e-15, rankDeficient: true}` — but the ACTUAL tangent residual
   (hand-computed from the final joint positions: `|centerY| − radius`) is off by several units, not
   zero. **The solver is reporting success on a genuinely unsatisfied constraint.**
4. **Ruled out the obvious suspect:** this looked like it might be the circle's fully-free `x` direction
   (a rank-deficient null-space direction) fooling the convergence check. Tested with the circle's
   center `x` independently pinned via a `VERTICAL` constraint to a fixed anchor — **identical wrong
   result** (`rankDeficient: true` still reported, same wrong final position). So it is NOT simply "free
   x direction confuses the rank-deficiency logic" — something about the LM/convergence machinery
   mishandles a SUDDEN external change to `shape.radius` specifically (a value the Newton loop doesn't
   itself own or step incrementally, unlike joint positions), most likely: the LM damping parameter (λ)
   was calibrated for the OLD, already-converged state and doesn't get reset/re-probed for a fresh large
   jump, so it may spike and stall the step size while the "converged" check reads a stale or
   incorrectly-scoped residual. **This is a hypothesis, not a traced root cause — the advisor's bounded
   look stopped at confirming the symptom precisely; find the actual mechanism in `engine.js`'s
   iteration/convergence/λ-management code.**

**Why this matters now, specifically:** before your circle-radius-edit fix, this path was UNREACHABLE
(every radius edit reverted immediately for an unrelated reason — the isRadius joint-synthesis gap). Now
that radius edits actually flow through to `shape.radius` and re-solve, this pre-existing solver gap is
live for any circle that's ALSO tangent-constrained (or presumably constrained by anything else that
reads `shape.radius` live at assembly time — `point_on_line`'s `onCircle` mode, circle-circle tangent —
worth checking those too, not just line-tangent).

**Scope — investigate + fix + verify, this is solver-internals work, take the time it needs:**
1. Reproduce with the exact repro above (or the committed test in the breaker worktree — ask for the
   path, or re-derive it standalone, your call).
2. Find why `converged`/`error` come back clean when the geometry demonstrably isn't. Check: does the
   convergence/geometric-honesty check re-derive residuals fresh from final positions AND current
   `shape.radius`, or does it reuse something computed mid-iteration that could be stale relative to an
   externally-changed `shape.radius`? Check the λ/damping schedule's behavior on a large, sudden
   residual jump (does it reset per `solve()` call, or carry state that could saturate/stall on an
   unusually large initial residual from an external mutation?).
3. Fix so a `solve()` call after `shape.radius` changes externally either (a) actually converges to the
   TRUE tangent-satisfying position, or (b) if it genuinely can't, HONESTLY reports non-convergence
   (never silently claim success on an unsatisfied constraint — this is the project's own stated
   invariant from the "converged but lying" fix history, `docs/architecture/SOLVER_WALKTHROUGH.md`).
4. Once fixed, the circle-radius-edit-on-a-tangent-constrained-circle case should stop reverting and
   should correctly re-satisfy tangency at the new radius (verify: edit → circle resizes, stays tangent
   to the line, no revert).
5. Check the sibling cases while you're in there (point-on-circle, circle-circle tangent) for the same
   shape.radius-mid-flight-change gap — name what you checked even if you don't fix all of them this
   turn; flag anything you find but don't fix.

**VERIFY LIVE:** draw a circle tangent to a line with a radius dimension → edit the radius → the circle
resizes AND stays visually tangent to the line (no revert, no gap). Keep the 16/16 gate + everything from
the last 3 turns' regression lists green.

Append a WORK-LOG entry (repro, investigation trail, root cause, fix, live-verify) ending with exactly
`=== TANGENT-RADIUS-CONVERGENCE-FIX DONE — HOLD ===`. **Then pass the ball back to advisor and STOP.**

---
<!-- superseded (provenance): cycle 188 closed here (handoff.py done) after TANGENT-RADIUS-CONVERGENCE-FIX
     landed and was independently re-verified (including catching and fixing a flawed assumption in the
     advisor's own breaker test — see WORK-LOG). New cycle starts below, user-reported (2026-08-27). -->

## ★ TASK (user-reported, 2026-08-27) — the tool ribbon can't be scrolled on mobile; hides tools off-screen

**Root-caused already — the fix is small and precise, land it before anything else this cycle.**

**What's actually happening (traced, not guessed):** `apps/sketchstudio/index.html` has CSS (~line 84-104)
for a "TWO stacked rows on mobile/tablet" toolbar design — `.toolbar-row { touch-action: pan-x;
-webkit-overflow-scrolling: touch; ...}` plus a `@media (max-width: 767px)` stacking rule. **This CSS
matches NOTHING in the DOM.** Grepped every `.js` file in the repo for the string `toolbar-row` — **zero
hits**. The comment right above the CSS confirms why: *"S7c-2d-cleanup: inline button markup removed; the
shared tool ribbon (createToolRibbon) mounts here at runtime"* — the OLD ribbon markup that this CSS was
written for was replaced by the shared `packages/ui/tool-ribbon.js` component, and the CSS was never
updated or removed to match. Classic "styles nothing" dead CSS.

**The REAL ribbon** (`createToolRibbon()` in `packages/ui/tool-ribbon.js:115-214`) builds ONE flat
`.sk-ribbon` div (`display:flex; align-items:stretch;`, defined in that file's own injected
`<style>`, ~line 60) holding all four groups (Create/Edit/Inspect/Constrain) in a single row, with
**no `overflow-x`, no wrapping, and no mobile handling of any kind.** On a narrow viewport, the row
simply overflows the screen width with nothing to scroll it into view — the later groups (Constrain:
Coinc/H-V/Para/Perp/Coll/Tang/Equal/Mid) become inaccessible on mobile.

**Fix — two parts, both needed:**
1. **Add real horizontal scroll to `.sk-ribbon`** in `packages/ui/tool-ribbon.js`'s injected stylesheet:
   `overflow-x: auto; -webkit-overflow-scrolling: touch; touch-action: pan-x;` (this is exactly the intent
   the dead `.toolbar-row` CSS was going for — reuse that idea, on the ACTUAL container). Hide the
   scrollbar on touch devices if you want to match the old `.no-scrollbar` look
   (`scrollbar-width: none` + `::-webkit-scrollbar { display:none }`), but a visible thin scrollbar is
   also fine — your call, verify it looks reasonable at a mobile width in devtools or a real device.
   `tool-ribbon.js` is the SHARED `#ui` component (Studio + Shaper + the pen-plotter Design tab all use
   it) — this fix is host-agnostic and benefits all three; don't scope it to SketchStudio only.
2. **Remove the dead CSS** in `apps/sketchstudio/index.html` (the `.toolbar-row` rules + its two
   `@media` blocks, ~lines 84-104) — it styles a DOM structure that no longer exists and its continued
   presence is exactly the kind of "codebase lies about itself" surface this project's principles flag.
   Confirm (don't assume) nothing else in `apps/sketchstudio` still references `.toolbar-row` before
   deleting — the advisor's grep found none, but re-verify yourself.

**VERIFY LIVE:** open the app at a mobile viewport width (devtools responsive mode, ~375px, or a real
phone) — the ribbon should be horizontally scrollable/swipeable by touch, and every tool group
(including Constrain's 8 buttons) must be reachable. Desktop width unaffected (still fits in one row,
scrolling is a no-op there). Check Shaper + the pen-plotter Design tab too, briefly, since this is a
shared `#ui` component — confirm you didn't regress their ribbon (even though neither reported this bug).

**Then, per the user's explicit instruction, this is the ONLY task for the cycle** — once verified, come
back to the advisor; the fixes from the LAST cycle (7 bugs, already reviewed + merged into `carve-out`)
are queued to merge into `main` and deploy live right after this lands, not before.

Append a WORK-LOG entry ending with exactly `=== RIBBON-MOBILE-SCROLL-FIX DONE — HOLD ===`. **Then pass
the ball back to advisor and STOP.**

---

## ★ NEW FEATURE (cycle 190, user-approved plan, 2026-08-27) — `apps/frame-calc`: a Sketch-Studio toggle for the shop framing calculators

**This is a NEW APP, not a bug fix — read the whole task before starting, it's bigger than recent
turns.** Plan-mode-approved with the user directly; treat the plan below as authoritative, but verify
every file path/API call cited against the real code before using it (the plan was written from an
advisor-level read, not a full implementation pass) — flag and adapt if something doesn't match.

**Context:** a SEPARATE repo/deploy, `geometric-frame-calc` (`C:\Users\danse\APPS\geometric frame calc`
— NOT in this monorepo, browse it read-only for reference), is a family of 5 no-build React shop-framing
calculators (Triangle, Polygon, Trapezoid, Parallelogram, Stud-layout). Each computes exact board
geometry + saw-gauge cut lists from typed dimensions and draws a disposable SVG/Canvas preview. The user
wants a toggle, per tool, that turns the calculated shape into a real, editable, exportable CAD drawing
using Sketch-Studio's ACTUAL shared sketcher (`mountSketch()` etc.) — not a copy of it, not a plain
export button. Confirmed with the user: a rewrite is acceptable, dimensions must be genuine
`ConstraintManager` distance/angle objects (editable + deletable, not a locked annotation layer), and
export is plain SVG (reuse `shaper-export.js`, no new format).

**Why this belongs in THIS monorepo, not a bridge from the other repo:** `#core`/`#ui` resolve via
`package.json`'s bare `imports` map (`#core/*`, `#ui/*`) — only code living inside this monorepo can
import them without copying the packages into the other repo (which would create a duplicated-source
drift the project's own principles rule out). This is also exactly what NORTH STAR already says: "any
host (CAD/CNC/pen-plotter) embeds the SAME shared `#core`/`#ui` Design tab" — a frame-calculator host is
squarely that pattern, just like Shaper and the pen-plotter.

**Scope for THIS cycle: ONE tool only, prove the pattern end-to-end.** Pick **Trapezoid**
(`trapezoid-frame-calculator/` in the other repo) unless you find a concrete reason mid-investigation to
prefer Polygon or Parallelogram — all three already share one geometry engine
(`shared/utils/quadFrameCalculator.js`'s `calculateQuadFrameGeometry`, returns
`{P, boards:[{p1,p2,p3,p4},...], cutList:[{part,maxLen,minLen,topSawGauge,botSawGauge},...], Q, S,
interiorAnglesDeg, minX/maxX/minY/maxY, width, height}`), so porting one gets the CAD-toggle machinery
working for all three's geometry shape. Triangle and Stud-layout use their own bespoke calculators
(different output shape) — explicitly OUT of scope this cycle, next phase once this proves out.

**▶ Steps (commit per step, verify each, pass back ONCE — mirrors the STYLE-TOOL batch pattern from
earlier this session):**
1. **Scaffold `apps/frame-calc/`** in THIS repo, following `apps/shaper/`'s shape (`index.html` with the
   same importmap `#core/*`→`packages/core/*`, `#ui/*`→`packages/ui/*`, plus `src/main.js`). Confirm the
   exact importmap syntax from `apps/shaper/index.html` — copy its convention, don't reinvent it.
2. **Move the shared geometry engine into `#core`**: copy `shared/utils/quadFrameCalculator.js` +
   `shared/utils/geometry.js` from the OTHER repo into `packages/core/` (e.g.
   `packages/core/frame-geometry.js`) verbatim — it's a pure function, framework-free, no porting needed
   for the math itself. This becomes the ONE engine both the new calculator form and the CAD-toggle read.
3. **Port trapezoid's form + preview to plain JS.** Read `trapezoid-frame-calculator/src/`'s actual
   components (its `ControlsPanel`/`CanvasView` equivalents — the plan cited triangle's file names as a
   pattern reference, trapezoid's may differ, READ THE REAL FILES) and port them to plain DOM code:
   inputs writing into a small state object, a render function, same visual layout/labels/behavior. This
   is mechanical porting, not a redesign.
4. **Wire the toggle** — two view states in `apps/frame-calc`'s shell, same pattern as
   `apps/sketchstudio/main.js`'s `showView` Design/Export switch or the pen-plotter's tab switch:
   - **Calculator view** (default): the ported form + static preview, as today.
   - **Sketch view** (the toggle): mount the real sketcher — `mountSketch()` from `#ui/sketch-canvas.js`
     (same call `apps/shaper/src/main.js:10` makes), `createToolRibbon()`, `createDesignInfoPanel()` —
     the SAME shared chrome Shaper/SketchStudio use.
5. **Build the sketch from calculator output on toggle.** Translate `calculateQuadFrameGeometry`'s
   `boards` array into a Sketch-Studio document: per board quad `{p1,p2,p3,p4}` → 4 joints
   (`fixed: true` — the calculator's math is authoritative) + 4 line shapes forming a closed loop.
   Mirrors `tests/harness/sketch.js`'s `load()` document shape (`{joints, shapes, constraints}`) — READ
   that file for the exact `engine.addJoint`/`engine.addShape` calls to mirror.
6. **Dimensions are REAL constraint objects, not a separate annotation layer.** Each board's length
   (`cutList[i].maxLen`/`minLen`) → a real `{type:'distance', joints:[...], value}` constraint via
   `ConstraintManager.createConstraint` (same call the dimension tool makes); each saw-gauge angle → a
   real `{type:'angle', ...}` constraint the same way. Since the joints are fixed, these settle as
   reference (non-driving) dimensions initially — but MUST be fully editable/deletable/toggleable-to-
   driving through the ordinary dimension UI, exactly like any dimension a user adds by hand (no
   special-cased/locked variant — verify this live, don't assume it falls out for free).
7. **Export = SVG**, reusing `packages/core/shaper-export.js`'s `exportShaperSVG` — the same serializer
   Shaper already exports through. No new format.

**Explicitly OUT of scope this cycle:** Triangle/Stud-layout ports; unlocking the board JOINTS
themselves for free-drag editing (they stay `fixed:true` — only dimensions are editable/deletable this
cycle; letting a user drag a corner and have the frame re-solve is a v2); touching
`geometric-frame-calc`'s existing separate deploy (leave it running, no decision needed on retiring it);
any change to `apps/sketchstudio`, `apps/shaper`, or existing `packages/*` behavior for the other hosts.

**VERIFY LIVE:** enter dimensions in the Calculator view → toggle to Sketch view → the drawn shape's
board outlines match the calculator's own preview (same corner coordinates, same scale) → each board's
dimension is visible, editable (type a new value, toggle driving, the board resizes), and deletable →
Export → the SVG opens correctly. `node --check` on every new/ported file. `npm run test:shell` (or the
equivalent) stays green — this only ADDS an app, it must not touch `apps/sketchstudio`/`apps/shaper`/
`packages/*` behavior for the existing hosts. If trapezoid's real files diverge meaningfully from the
plan's assumptions, adapt and note what changed in WORK-LOG rather than forcing a mismatch.

Append a WORK-LOG entry (what was built, any deviation from the plan + why, live-verify) ending with
exactly `=== FRAME-CALC-TOGGLE-V1 DONE — HOLD ===`. **Then pass the ball back to advisor and STOP.**

---

## ★ TASK (user-reported, 2026-08-27) — `apps/frame-calc` has no way to switch to/from the other apps

**Small, well-scoped, already root-caused.** The shared app-switcher (`packages/ui/app-switcher.js`)
has a hardcoded `APPS` list (~line 10-12): `sketchstudio`, `shaper`, `penplotter` — no `frame-calc`
entry. Separately, wiring the switcher INTO `apps/frame-calc` itself was explicitly deferred in last
turn's dispatch ("App-switcher integration deliberately left out... reachable via direct URL for v1").
Together these mean: from `apps/frame-calc` there's no way to navigate anywhere else, and from every
OTHER app there's no way to navigate TO frame-calc either.

**Fix — two small pieces:**
1. Add `{ id: 'frame-calc', name: 'Frame Calc', href: '../frame-calc/' }` to `app-switcher.js`'s `APPS`
   list (same shape as the existing 3 entries). This is a SHARED file — the addition automatically
   makes Frame Calc reachable from Sketch Studio/Shaper/Pen Plotter's existing switcher dropdowns too,
   verify that live (open each of the other 3 apps, confirm Frame Calc now appears in their switcher).
2. Wire `createAppSwitcher({ current: 'frame-calc' })` into `apps/frame-calc/src/main.js`, mirroring
   `apps/shaper/src/main.js:33-34`'s pattern (`document.getElementById('app-switcher-host')` +
   `.appendChild(...).el`) or `apps/sketchstudio/main.js:148`'s pattern (passed as a header `leading`
   element) — pick whichever fits `apps/frame-calc/index.html`'s current header markup with the least
   disruption; add the `#app-switcher-host` element to that header if neither pattern fits cleanly.

**VERIFY LIVE:** open `apps/frame-calc` — the switcher is visible and lets you jump to Sketch
Studio/Shaper/Pen Plotter. Open Pen Plotter (or any other app) — Frame Calc now appears in ITS switcher
and clicking it navigates there correctly. `npm run test:shell` (or equivalent) stays green.

Append a WORK-LOG entry ending with exactly `=== FRAME-CALC-APP-SWITCHER DONE — HOLD ===`. **Then pass
the ball back to advisor and STOP.**

---

## ★ TASK (user-reported, screenshot, 2026-08-27) — SketchStudio's ribbon shifts up ~2s after load on mobile, overlapping the header

**Needs a REAL mobile device or an actual (non-headless) mobile-emulated browser to reproduce — a
headless CDP check CANNOT catch this class of bug** (see why below). Don't trust a headless "looks fine"
result for this one.

**User's exact report:** on `sketch-studio.pages.dev` on a phone, the page loads looking correct, then
**~2 seconds later the toolbar visibly shifts upward**, ending up overlapping/covering the bottom of the
header above it (screenshot showed the header's "Studio" label + an active-tab button sliver poking out
from BEHIND the now-higher ribbon).

**Advisor's investigation so far (ruled one thing out, found a real lead — verify both before
concluding):**
- **Ruled out:** `apps/sketchstudio/main.js:23-34`'s `window.addEventListener('resize', updateView)` —
  `updateView()` only sets the SVG canvas's `viewBox` attribute; it cannot move the ribbon or header,
  they're unrelated DOM. Don't chase this as the cause — confirmed by reading the function, not assumed.
- **A real, well-known contributing factor:** only `body` has `overflow: hidden`
  (`apps/sketchstudio/index.html:20`, mirrored in `apps/sketchstudio/overrides.css:6`) — `html` does
  NOT. This is a classic setup for exactly this symptom: mobile browsers auto-collapse their address bar
  ~1-2 seconds after load (very common, not app-controlled), which changes the viewport height and fires
  a native `resize`. If the page had ANY scroll offset before that collapse (even a few px, from content
  briefly taller than the shorter address-bar-visible viewport), nothing forces it back to `scrollTo(0,
  0)` afterward — the content stays scrolled relative to the NOW-taller viewport, which reads exactly as
  "the header scrolls partially out of view, the ribbon ends up higher than it should be."
- **Why headless testing missed this:** headless Chrome has no address bar at all, so this exact
  trigger (a real browser's UI chrome collapsing after load) never fires in a headless CDP check,
  static-viewport or not. The advisor's own mobile-viewport headless check (375×667, static) came back
  clean — that result is NOT evidence this is fine, it's a blind spot in the test method. Verify this
  live on an actual phone, or in Chrome DevTools' device-toolbar mode (NOT headless — the visible,
  interactive emulator, which mimics some viewport-resize-on-scroll behavior more realistically), or by
  scripting a REAL `visualViewport`/`window` resize + scroll-position check ~1.5-2s after load if you
  build a better headless probe for this class of bug specifically.

**Fix direction (standard mobile-web pattern for this exact class of issue — verify it's the right fix
for THIS symptom before landing it, don't assume):** add `overflow: hidden` (and likely `height: 100%`)
to `html` as well as `body`, and/or listen for `window.visualViewport`'s `resize`/`scroll` events (or a
plain `scroll` event on `window`) and force `window.scrollTo(0, 0)` whenever it fires — a standard fix
for "mobile browser chrome collapse leaves the page scrolled." Land the minimal version that actually
fixes the REPRODUCED symptom; don't over-build defensive scroll-locking beyond what's needed.

**VERIFY LIVE, on an actual mobile device or realistic emulation (not headless):** load the app on
mobile, wait 3+ seconds, confirm the ribbon/header stay in their original relative position — no shift,
no overlap. Also confirm normal pinch/pan/draw interaction on the canvas is unaffected (this app
deliberately uses `touch-action: none` for its own gesture handling — don't accidentally re-enable
native browser scroll/zoom on the canvas while fixing the outer page scroll).

Append a WORK-LOG entry (repro method used, root cause confirmed, fix, live-verify) ending with exactly
`=== MOBILE-RIBBON-SHIFT-FIX DONE — HOLD ===`. **Then pass the ball back to advisor and STOP.**

---

## ★ CORRECTION (user, 2026-08-27) — the mobile symptom is a SIZING bug (100vh), not primarily a scroll-drift one

**The user clarified the actual symptom precisely, after the scroll-reset fix above already landed:**
*"the app sits under the address bar after load, it covers the app"* — i.e. the TOP of the app (header
+ ribbon) renders at a position the still-visible browser address bar physically overlaps, while the
bar is showing. This reframes last turn's model: the primary bug is that the page is SIZED against the
address-bar-COLLAPSED (taller) viewport from the first paint, not that it drifts via scroll after the
fact. The scroll-reset fix from last turn may still be valid defensive cleanup, but it does not fix
THIS symptom on its own — verify that live once the real fix below lands, don't assume the old fix
already covers it.

**Confirmed root cause:** `apps/sketchstudio/index.html:286` — `<body class="flex flex-col h-screen
...">`. Tailwind's `h-screen` = `height: 100vh`. On many mobile browsers, `100vh` resolves against the
LARGER, address-bar-collapsed viewport even while the bar is still visible on screen — so a
`height:100vh` element is taller than what's actually visible right now, and gets positioned assuming
space that doesn't exist yet. This is exactly the class of bug the CSS `dvh` (dynamic viewport height)
unit was invented to fix: `100dvh` tracks the REAL, currently-visible viewport and updates live as the
browser chrome shows/hides — no JS scroll hack needed for the sizing itself.

**Fix direction — verify feasibility first, this repo uses Tailwind via CDN (no build):**
1. Check what Tailwind CDN version is loading (`apps/sketchstudio/index.html`'s script tag) and whether
   it supports the `h-dvh` utility (Tailwind added `dvh`/`svh`/`lvh` height utilities in v3.4). If it
   does, swap `h-screen` → `h-dvh` on `body` (and anywhere else using `h-screen`/`100vh` for full-page
   sizing — grep for it, don't assume `body` is the only spot).
2. If the CDN version predates that utility, add a plain CSS override instead (`body { height: 100dvh;
   }`) in the existing `<style>` block — but **verify the CASCADE ORDER carefully**: Tailwind's CDN
   script injects its own stylesheet at runtime, and depending on WHEN that injection happens relative
   to this page's inline `<style>` block, your override could either win or silently lose to
   `.h-screen`. This file already has precedent for using `!important` to win exactly this kind of
   ordering fight (see the `#toolsRibbon { z-index: 100 !important; }` reassertions) — use that pattern
   if a plain override doesn't reliably win, and explain in WORK-LOG which case you hit.
3. Add a `@supports not (height: 100dvh)` (or equivalent feature-detection) fallback to the existing
   `100vh`/`h-screen` behavior for older browsers that don't support `dvh` at all, so this isn't a
   regression there.

**VERIFY LIVE, on an actual mobile device or realistic emulation (still not headless — same limitation
as last turn, `dvh` behavior specifically depends on real mobile browser chrome, which headless doesn't
have):** load the app with the address bar visible — the header/ribbon must be FULLY visible, not
tucked under the bar, from the very first paint, with no shift needed as the bar later collapses/expands.

Append a WORK-LOG entry (what `100vh` was actually doing wrong, the dvh fix + cascade-order finding,
live-verify) ending with exactly `=== MOBILE-VIEWPORT-DVH-FIX DONE — HOLD ===`. **Then pass the ball
back to advisor and STOP.**

---

## ★ TASK (user-reported, confirmed still present after the dvh/scroll fixes deployed) — the canvas visibly vibrates on mobile

**User's exact report, confirmed NOT fixed by anything already live:** "the canvas is vibrating very
fast" on load; touching the canvas makes an app-switcher-adjacent element disappear AND the vibration
stops (the two are correlated observations from the user, not necessarily two separate bugs — the
vibration is the one that must be fixed; the switcher-disappearing-on-touch may just be a symptom of
whatever's oscillating, or may be unrelated/expected — investigate, don't assume either way).

**Advisor's investigation so far:**
- Ruled out (via a headless CDP probe polling `#toolsRibbon`/`.sk-ribbon`/`#app-header-host`'s
  `getBoundingClientRect()` every 150ms for 3s + after a simulated touch, against the LIVE deployed
  site): NO layout/position oscillation shows up in headless Chrome at all — every sample was pixel-
  identical. This does NOT mean there's no bug; it means either (a) headless can't reproduce whatever
  real-device condition triggers it (same limitation as the address-bar work — no real mobile browser
  chrome, no real GPU/CPU throttling behavior), or (b) the vibration isn't a ribbon/header LAYOUT issue
  at all, but something else entirely — e.g. the drawn CANVAS CONTENT itself (grid, origin markers,
  construction lines) jittering, which my probe didn't check.
- **A strong, concrete lead, found by reading the code (not proven as root cause yet — verify before
  committing to a fix):** `apps/sketchstudio/main.js`'s render loop —
  ```js
  function loop(){
    const iters = SolverConfig.ITERATIONS || 500;
    engine.solve(iters);          // <-- runs EVERY frame, unconditionally, forever
    draw(...);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  ```
  calls `engine.solve(500)` on **every single animation frame** (~60/sec) regardless of whether
  anything changed — no dirty-flag, no early-out when nothing is being dragged/edited. For a
  perfectly-determined sketch this is wasteful but should be stable (LM resets `lambdaInit` fresh each
  call and a converged system should re-converge to the same point near-instantly). But this session's
  own solver work found MULTIPLE `rankDeficient: true` cases (a free/undetermined direction in the
  system) — re-solving a rank-deficient configuration from scratch every frame can legitimately land on
  a microscopically different point along that free direction each time (floating-point path-dependence
  in an iterative method), which rendered at 60fps reads as visible high-frequency jitter. **Check
  whether the DEFAULT/empty canvas's own construction geometry (the origin marker, the red/green
  construction axis lines visible in the user's screenshot) constitutes such a rank-deficient system**
  — that would explain why this happens even with nothing drawn yet.

**Scope — investigate this specific hypothesis, then fix the real cause (verify, don't assume the
hypothesis is right just because it's plausible):**
1. Load the app (real device if you have one, or reproduce the CPU-load signature headlessly — e.g. log
   `engine.getSolveStats()` / joint positions across consecutive frames on the DEFAULT empty canvas and
   check for `rankDeficient:true` and/or sub-pixel position drift frame-to-frame).
2. If confirmed as the cause: the fix is a DIRTY-FLAG gate on the render loop — only call `engine.solve()`
   when something actually changed since the last frame (a drag in progress, a joint/constraint/shape
   added or edited) — not unconditionally every frame. This is also a legitimate mobile
   performance/battery fix regardless of whether it's THE vibration cause, since 500 Newton iterations
   60x/sec forever is real, continuous CPU load for no reason on a static sketch.
3. If NOT confirmed (frame-to-frame positions are stable even on a rank-deficient default sketch):
   name what you checked and keep investigating — check the drawn canvas content specifically (do the
   construction axis lines/grid actually redraw with different coordinates frame-to-frame?), and
   consider whether this is a REAL device-only phenomenon (GPU/CPU thermal throttling causing dropped-
   frame stutter that reads as vibration, unrelated to the solver at all) that may need the user's own
   device to fully diagnose — say so plainly rather than force-fitting an unconfirmed fix.
4. Investigate the switcher-disappearing-on-touch correlation too, but treat it as SECONDARY to the
   vibration — don't spend the bulk of the turn there if the vibration cause is still open.

**VERIFY LIVE:** load the app, wait several seconds with nothing touched — no visible jitter of any
on-screen element (grid, axes, ribbon, header). If a real device isn't available, say so and describe
exactly what WAS checked headlessly and what could not be verified that way — same honesty standard as
the last two turns.

Append a WORK-LOG entry (investigation trail, root cause confirmed or ruled out, fix if found, what
still needs a real device) ending with exactly `=== MOBILE-VIBRATION-FIX DONE — HOLD ===` (or, if the
cause is genuinely not found this turn, `=== MOBILE-VIBRATION-INVESTIGATION (unresolved) — HOLD ===`
— either is an acceptable outcome, an honest non-fix is better than a guessed one). **Then pass the
ball back to advisor and STOP.**

---

## ★ NEW FEATURE (user, 2026-08-27) — a SHARED mobile drawer for the side info-panel, across ALL apps

**User's ask, verbatim intent: "frame calc need to use a mobile ui layout too, with drawer control
panel" → then broadened: "actually all app should have one."** So this is NOT a frame-calc-only fix —
every host app (`sketchstudio`, `shaper`, `penplotter`, `frame-calc`, and `trace` if it has an
equivalent side panel) needs its side info/constraint panel to become a collapsible DRAWER on mobile
widths, instead of a permanently-visible fixed-width sidebar eating a big fraction of a phone screen.

**Ground truth, checked before dispatching (don't re-derive, verify current if it's drifted):**
- Every app currently mounts its info/constraint panel (`createDesignInfoPanel` from
  `packages/ui/design-info-panel.js`) into a fixed-width `<aside>` (e.g. `apps/frame-calc/index.html`'s
  `#sketch-panel { flex: 0 0 244px; ... }`, matching the same ~244px convention `apps/shaper` and
  `apps/sketchstudio` use) — always visible, no collapse/toggle, no mobile variant at all today.
- `packages/ui/tabbed-dock-panel.js` (`createTabbedDockPanel`) exists but is **completely unused**
  anywhere (grepped — zero importers). It's a multi-TAB dock container, not a slide-in/out drawer — it
  does NOT already solve this (no open/close/toggle-visibility API). Don't force-fit it; a new small
  shared component is the right call here, but re-verify this yourself before ruling it out entirely.
- **Precedent to follow:** this session's mobile ribbon fix (`packages/ui/tool-ribbon.js`, the
  `.sk-ribbon` component) is the model — ONE shared `#ui` component gets the mobile-aware behavior
  once, and every host automatically benefits since they all import the same file. Do the SAME thing
  here: don't hand-roll a drawer per app.

**Scope — build ONE shared drawer, wire it into every host:**
1. **A new shared `#ui` component** (e.g. `packages/ui/mobile-drawer.js`, name it whatever reads
   cleanest) that wraps the EXISTING info-panel content: on desktop widths, renders exactly as today
   (fixed-visible sidebar, byte-identical behavior — this must stay unregressed); below the same mobile
   breakpoint the ribbon fix uses (`max-width: 767px`, matching the existing convention), the panel
   becomes a DRAWER — hidden/collapsed by default, a visible toggle affordance (a button/tab/handle) to
   slide it in over (or push aside) the canvas, and a way to close it again (tap outside, a close
   button, or both — your call, follow whatever feels native to a mobile CAD tool, look at how the
   existing style-panel/modal patterns in this codebase handle open/close for consistency).
2. **Wire it into every host** that has a side info-panel: `apps/sketchstudio`, `apps/shaper`,
   `apps/penplotter` (pen-plotter — check its actual mount point name, it may differ from
   `#design-panel-info`), `apps/frame-calc`, and `apps/trace` if it has an equivalent panel (check —
   don't assume). Each host's wiring change should be small (swap the panel's mount call for the new
   drawer wrapper's mount call) — the actual drawer LOGIC lives once, in `#ui`.
3. Don't touch the RIBBON (already fixed this session) or anything else about desktop layout.

**VERIFY LIVE, at a mobile width, on AT LEAST 3 of the apps (sketchstudio + frame-calc + one more —
your call which, but don't only check one):** the side panel is collapsed/out of the way by default,
a clear affordance opens it as a drawer, it's usable (readable, scrollable if long) while open, and
closing it returns to the normal canvas view. **At desktop width, confirm ZERO change** — same fixed
sidebar as before, byte-identical rendering (screenshot or DOM diff, your call) for at least one app.
`npm run test:shell` (or equivalent) stays green.

**Split authorized if this is bigger than one turn:** land the shared component + ONE host fully
verified first, flag remaining hosts as a clear follow-up rather than rushing all 5 half-done.

Append a WORK-LOG entry (component design, which hosts got wired this turn, any deferred, live-verify)
ending with exactly `=== MOBILE-DRAWER-PANEL DONE — HOLD ===` (or `=== MOBILE-DRAWER-PANEL (partial,
N/5 hosts) — HOLD ===` if split). **Then pass the ball back to advisor and STOP.**

---

## ★ TASK (user-reported, mobile, HIGH SEVERITY — core interaction) — Select/drag doesn't work on touch, and pinch-to-zoom zooms the whole page instead of just the canvas

**Sketch Studio, on a phone. Two symptoms, likely the same root cause (touch-action / gesture
capture), reported together:**
1. "select tool doesn't seem to work correctly, selecting and move aren't working" — tapping a shape to
   select it, or dragging a joint/shape, doesn't do what it should on touch.
2. "pinch to zoom zooms whole UI but should be canvas only" — a two-finger pinch gesture is being
   handled by the BROWSER (native page zoom) instead of being captured by the app's own canvas
   pan/zoom logic.

**Advisor's starting point (found, NOT yet diagnosed as the cause — verify before fixing):**
`apps/sketchstudio/index.html` has this existing (NOT new this session — present before any of this
session's fixes, confirmed by checking) touch-action setup:
```css
body { touch-action: none; ... }
#svgCanvas { width: 100%; height: 100%; touch-action: none; ... }
@supports (touch-action: pan-x pan-y) {
    #svgCanvas { touch-action: pan-x pan-y; }
}
```
The `@supports` override REPLACES `none` with `pan-x pan-y` on any browser that supports the
multi-value syntax (i.e., basically all current mobile browsers) — meaning on a real phone, the canvas
is currently running with `touch-action: pan-x pan-y`, NOT `none`. That changes what the BROWSER itself
is allowed to do with one- and two-finger gestures on that element vs. what the app's own JS pointer
handlers (`packages/ui/input-manager.js`) expect to see. This is a plausible mechanism for BOTH
symptoms (a native pan/gesture recognition competing with the JS's own drag/select logic; pinch
specifically escaping to a differently-configured ancestor if the canvas element doesn't fully own it)
— but it is UNCONFIRMED and it is NOT NEW CODE, so don't assume it's simply "the bug" without checking
whether this exact rule predates a recent regression or has always behaved this way. **Find out:**
- Is this genuinely new-broken (something this session's changes exposed — e.g. the dvh/height fixes
  changing the canvas element's actual computed size or stacking context in a way that changes how
  touch-action resolves), or has select/drag on mobile touch always been broken and the user is only
  now testing it seriously on a phone?
- Check `git log -p` / `git blame` on this `@supports` block and on `packages/ui/input-manager.js`'s
  touch/pointer handling for anything that changed recently vs. is long-standing.

**Scope — diagnose for real (this is touch-gesture behavior; a headless CDP touch-event dispatch can
simulate SOME of this but real multi-touch pinch gesture recognition is a genuine gap — same class of
limitation as the address-bar work; use a real device or the most realistic emulation you can, and say
plainly what you could and couldn't verify):**
1. Confirm exactly what's broken: does a single tap fail to select at all, or select the wrong
   thing, or select correctly but not respond to a subsequent drag? Does pinch zoom the WHOLE
   document (visual page zoom, browser chrome included) or just visually scale the app's own
   container? Precise symptom narrows the fix a lot.
2. Root-cause the touch-action interaction (or find the real cause if it's something else — a pointer-
   event listener registration issue, a recent CSS change affecting hit-testing coordinates, etc.).
3. Fix so: single-finger tap/drag on the canvas selects and moves shapes correctly (matching desktop
   mouse behavior), and a two-finger pinch is captured by the app's OWN zoom logic, never the browser's
   native page zoom.

**VERIFY LIVE, on an actual phone (this is exactly the class of gesture bug that can't be trusted from
headless alone):** tap a shape → it selects (highlight/handles appear); drag it → it moves with your
finger; pinch with two fingers → only the CANVAS content scales, the rest of the UI (header, ribbon,
footer) stays fixed, no browser-level page zoom.

Append a WORK-LOG entry (exact symptom confirmed, root cause, fix, live-verify) ending with exactly
`=== MOBILE-TOUCH-SELECT-ZOOM-FIX DONE — HOLD ===`. **Then pass the ball back to advisor and STOP.**

---

## ★ TASK (user-reported, screenshots, HIGH SEVERITY — the last fix was scoped too narrowly) — Shaper/Pen Plotter/Frame Calc have NO touch-action protection at all; panning pans the whole PAGE

**The last turn's fix only touched `apps/sketchstudio/index.html`. User's next report, WITH
screenshots, is from SHAPER** (dark theme, the "Panel" drawer button visible top-right confirms it) —
**"panning is just panning the page not the canvas."** One screenshot shows the app's content shifted
so half the screen is bare black background — that's the PAGE itself having scrolled/panned, not the
canvas.

**Advisor's ground-truth check (confirmed, don't re-derive):** grepped `touch-action` across
`apps/shaper/index.html`, `apps/penplotter/index.html`, `apps/frame-calc/index.html`,
`packages/ui/sketcher.css`, and `packages/ui/sketch-canvas.js` — **zero hits, anywhere.** Sketch
Studio's canvas only ever worked because IT (a standalone app that predates the monorepo carve-out)
independently wrote its own `touch-action: none` rules in its own `index.html` — that protection was
NEVER part of the shared `#ui` layer `mountSketch()` and friends give every OTHER host. Shaper/Pen
Plotter/Frame Calc have been running with ZERO touch-gesture ownership this whole time; the browser's
default native pan/zoom has always been free to act on their canvases and the surrounding page.

**Fix this ONCE, at the shared level — do NOT repeat the per-host index.html pattern the last turn
used.** The right place is almost certainly `#ui/sketch-canvas.js`'s `mountSketch()` itself (or
`packages/ui/sketcher.css` if that's genuinely shared/loaded by every host — check which) — set
`touch-action: none` on the canvas element it creates/binds, structurally, so EVERY current and future
host gets correct touch ownership automatically without each one needing to remember its own CSS.
Verify this is really the single right injection point before committing to it — trace exactly how
Sketch Studio's OWN (now-correct) canvas touch-action rule relates to what `mountSketch` does, so the
shared fix produces the SAME effective behavior Sketch Studio now has, not something subtly different.

**Also check the PAGE-level scroll lock, not just the canvas element:** Sketch Studio's `index.html`
has `body { touch-action: none; overflow: hidden; ...}` (page-level, not just canvas-level) — confirm
whether Shaper/Pen Plotter/Frame Calc's `index.html`s have an equivalent body-level lock or not. If
they don't, that's likely WHY the whole page pans (nothing stops it) even independent of the canvas fix
above — both may be needed. Don't assume; check each host's actual `<body>` CSS.

**Scope:**
1. Add the canvas-level `touch-action: none` fix in the shared `#ui` layer (one place, benefits every
   host).
2. Audit + fix the page-level (`body`/`html`) scroll/touch lock in `apps/shaper/index.html`,
   `apps/penplotter/index.html`, `apps/frame-calc/index.html` — each host's own HTML shell, matching
   Sketch Studio's pattern where it's missing.
3. Same honesty standard as every mobile-gesture turn this session: headless CANNOT prove this fixes
   the real symptom (no native gesture to fight over in a headless browser with nothing to scroll) —
   verify what's checkable (no regression, the rule is present and correctly scoped) and say plainly
   that real-device confirmation is still needed.

**VERIFY LIVE, on an actual phone, on ALL THREE previously-unprotected apps (Shaper, Pen Plotter, Frame
Calc) — not just one:** single-finger drag pans/selects/moves WITHIN the canvas only; the page itself
never scrolls or shifts; pinch only scales canvas content, never the browser page. Also re-confirm
Sketch Studio is unregressed (it already worked after the last turn — don't break it while fixing the
others).

Append a WORK-LOG entry (what was missing in each host, the shared fix, per-host body-lock audit
results, live-verify) ending with exactly `=== SHARED-TOUCH-ACTION-FIX DONE — HOLD ===`. **Then pass
the ball back to advisor and STOP.**

---

## ★ NEW EPIC (user-approved after a long design discussion, 2026-08-27) — PROJECT PERSISTENCE: documents that save, reopen, and travel between apps

**THIS TURN = SLICE 1 + 2 ONLY** (the serializer + the autosave buffer). Slice 3 (named Save/Open
files) follows next turn. Commit per slice, verify each, pass back once. **Split authorized** if it
balloons — land slice 1 completely and flag slice 2, rather than half-doing both.

### Why (the design decisions already made with the user — do not re-litigate these)

- **Nothing persists today.** Verified: no app saves the sketch. Only UI prefs sit in localStorage.
  Export (SVG/DXF) is the only way out, and it's **one-way and lossy** — SVG/DXF have no concept of
  constraints, so every hop between the user's own apps silently flattens the parametric model. The
  constraint solver is this codebase's crown jewel and the current story destroys its output.
- **Audience = the user + a few coworkers.** Ruled: **no accounts, no server, ever.** Local-first.
  Sharing is "send the file." BYO-cloud (the user's OWN Drive, DDCS-Studio-style) is a LATER,
  optional slice for the user's own phone↔desktop sync — NOT in scope now.
  - 📌 **Credential already registered for that future slice (2026-08-27), recorded here so it isn't
    lost.** Sketch Studio has its OWN Google Cloud project (separate from DDCS Studio's, so the
    consent screen brands correctly). The **public** OAuth client ID — safe in source, ships in the
    page exactly like DDCS's does in its `providers.js`; there is NO secret in this design:
    `983232817866-b4pl67uuhfmqdrtah42vaf22ivimfh3j.apps.googleusercontent.com`
    Scope will be `drive.file` (non-sensitive → no Google verification review). When the slice lands,
    it goes in a `providers.js`-shaped config, mirroring
    `C:\Users\danse\APPS\ddcs-studio-project\DDCS-Studio\web\ui\cloud\providers.js` (read-only ref).
  - 📌 **USER RULING (2026-08-27) — the header AVATAR is THE single connection point.** A signed-in
    account avatar sits top-right in the header and IS the one sign-in door. DDCS already paid for
    every lesson below (`web/ui/headerAccount.js` + `web/ui/cloudAccount.js`, read-only ref) — steal
    them, don't rediscover:
    1. **ONE door, not two.** DDCS had sign-in reachable from two places reading different state;
       a user connected in one, saw the other say "not connected," and concluded it failed. The human
       hit exactly that and asked for one login. One door, in the header.
    2. **It belongs in the header** because it's a first-run action, not a setting you go hunting for
       — and it gets real width (reads "Sign in" when signed out, not a bare glyph).
    3. ⭐ **The avatar costs NO extra OAuth scope**: `photoLink` comes from Drive's OWN `about.get`
       (see `googleDrive.js getUserInfo`). Asking for `userinfo.profile` to get a picture the normal
       way would widen consent into SENSITIVE scopes and drag the app into Google verification —
       forfeiting the whole `drive.file`-only advantage. Initials are the fallback, and a broken or
       expired photo URL must fall back to initials too, never a dead image.
    4. ⭐ **ONE ACCOUNT, TWO FEATURES.** Signing in signs in the ACCOUNT — it must NOT by itself turn
       any feature on. DDCS's words: *"signing in must not silently start routing a user's G-code
       through the cloud."* For us: signing in must not silently start syncing sketches to Drive.
       Using the account is a separate, explicit choice.
    5. **The identity-backfill trap** (their t2113, a two-part bug): the backfill condition was
       `!name && !email` from when identity meant name+email only; once the PICTURE was added, anyone
       already connected had name+email, so the backfill never ran and their avatar stayed initials
       forever — only fixable by disconnect/reconnect. AND it lived in a function only the Settings /
       Project-Manager panels called, so the HEADER (the one surface that shows the picture) could
       never trigger it. Fix both halves: a missing picture is equally a reason to re-ask, and the
       header must be able to trigger the backfill itself.
- **Geometry is SHARED across apps; the DOCUMENT is the travel mechanism.** This matches the repo's
  own north star ("ONE reusable Design tab… other tabs differ per host"). All 5 apps are
  **same-origin** (`/apps/<name>/`), so a shared IndexedDB buffer makes cross-app carry nearly free —
  no export/import dance, constraints intact.
- **EDITORS vs GENERATORS** (the one nuance): editors (`sketchstudio`, `shaper`, `penplotter`) share
  the live document. Generators (`frame-calc`, `trace`) PRODUCE a new document rather than inheriting
  whatever was open — you must never dump 4000 traced paths into the sketch someone was editing.
  Slice 2 wires the editors only; generators keep their current behavior this turn.

### Ground truth checked by the advisor (verify if it's drifted, but don't re-derive from scratch)

- **`#core` has NO geometry serializer.** `apps/penplotter/src/history.js`'s `serialize()` covers
  `artLayers`/`toolpaths`/`doc` ONLY — it never captures joints/shapes/constraints. A comment in
  `apps/penplotter/src/state.js:129` admits it: *"no app persists this map today — history.serialize
  covers artLayers/toolpaths/doc only."*
- ⚠ **SIDE FINDING, likely a real live bug — do NOT fix this turn, just confirm + record it in
  WORK-LOG:** if penplotter's undo snapshot never captures `#core` geometry, then undo/redo in its
  Design tab probably does NOT undo drawn geometry. Verify the symptom cheaply (draw a line in the
  Design tab, press undo) and record the result. It's a separate dispatch.
- **A real head start exists:** `tests/harness/sketch.js` already implements `load(model)` and
  `serialize()` over exactly `{joints, shapes, constraints}` — the right document shape, already
  handling Map/array/object joint forms. **Promote/adapt that into `#core` rather than writing fresh**
  — but re-read it first; it's harness code and may not cover every shape kind.

### Lessons to STEAL from DDCS Studio (already paid for there — do not rediscover them)

Read these files before designing: `web/data/backup.js` (header), `web/data/fsHandles.js` (header),
`web/ui/fileSaveState.js:164`, `web/ui/projects/projectStore.js` (header) under
`C:\Users\danse\APPS\ddcs-studio-project\DDCS-Studio` — **read-only, that repo is not ours to edit.**

1. **Buffer ≠ file.** Work is ALWAYS persisted to a local buffer; a named file is a separate explicit
   artifact. Two concepts.
2. **NO `beforeunload` warning** (their t1221 user ruling). The buffer survives reload, so the warning
   cried wolf every refresh: *"Being interrupted by a false alarm teaches people to click through real
   ones."* Use a passive **dirty indicator** instead, never a blocking prompt.
3. **Move each store's OWN persisted bytes; never re-serialize through a second codec.** One codec per
   thing. Adding a store = one row in a declared registry, not new machinery.
4. **Opening a document replaces the WHOLE state** — clear every declared store to default first, then
   write the file's. Their old keep-what's-missing behavior produced *"a blend that was neither the
   file nor what you had, and then marked that blend 'saved'."*
5. **Version field, and flag a document NEWER than we understand** rather than half-reading it.
6. **Never auto-download anything** — *"a file appearing in Downloads that nobody asked for is not
   consent."*
7. **All storage best-effort:** a failure means "re-pick next time," never a broken save.

### ▶ SLICE 1 — the `#core` document format + serializer (pure, no UI, no storage)

1. **A new `packages/core/document.js`** (name it as fits) exporting a versioned serialize/deserialize
   pair over the shared sketch state: `{ version, geometry: { joints, shapes, constraints }, hosts: {} }`
   — the exact top-level shape is yours to design, but it MUST have: a schema **version** field, the
   shared geometry, and a **namespaced per-host side-car section** (`hosts.shaper`, `hosts.penplotter`,
   …) so host data (pen colors, cut types, board thickness) never leaks into `#core` geometry. That
   host/core separation is an established rule in this repo — the plotter already keeps its colors
   plotter-side and `#core` pure. Keep it.
2. **Cover EVERY shape kind** — line, rect, circle, arc, bezier — and every constraint type. Check
   `#core/shapes.js` + `CONSTRAINT_TYPES` for the full list; a shape kind silently dropped on save is
   exactly the "worst defect class" this project's docs name.
3. **Deserialize must reject/flag a newer version**, not half-read it (lesson 5).
4. **A round-trip ORACLE** in `packages/core/tests/`: build a sketch containing every shape kind + a
   representative spread of constraint types (including a dimension, a tangent, a coincident-welded
   rect, an arc with its structural equal-radius constraint) → serialize → deserialize into a FRESH
   engine → assert the geometry and constraint set are equivalent, and that a `solve()` on the restored
   document converges to the same positions. This oracle is the real deliverable — it's what proves
   nothing is silently dropped.

### ▶ SLICE 2 — the autosave buffer (IndexedDB) + restore + cross-app carry

5. **A shared `#ui` (or `#core`, your call — justify it) buffer module** persisting the current
   document to **IndexedDB** under one well-known key, debounced on change. IndexedDB, not
   localStorage: geometry documents can get large and localStorage's ~5MB cap + synchronous API are
   both wrong for this (DDCS uses IndexedDB for exactly this reason).
6. **Restore on boot:** an app that mounts the shared sketcher loads the buffer if present. Because all
   apps are same-origin, this IS the cross-app carry — draw in Shaper, switch to Pen Plotter, the
   geometry is there with constraints intact. **Wire the EDITORS only** (`shaper`, `penplotter`, and
   `sketchstudio` if feasible — note it does NOT call `mountSketch()`, so it may need its own wiring;
   flag rather than force it). **Do NOT wire `frame-calc` or `trace`** (generators — see above).
7. **A passive dirty/saved indicator** somewhere unobtrusive. **NO `beforeunload` prompt** (lesson 2).

**VERIFY LIVE:** draw a constrained sketch (a dimensioned rect + a tangent circle) → hard-refresh the
page → it comes back intact, constraints included, and still solves. Then: draw in Shaper → switch apps
via the switcher → the same geometry is there. Confirm `frame-calc`/`trace` did NOT inherit it. Confirm
no exit-warning prompt appears on refresh. Round-trip oracle + the existing 16/16 solver gate + shell-smoke
stay green.

Append a WORK-LOG entry (format design + why, what the oracle covers, the penplotter-undo side finding,
live-verify) ending with exactly `=== PERSIST-1-2 (document format + autosave buffer) DONE — HOLD ===`
(or `=== PERSIST-1 (document format) DONE — HOLD ===` if you split). **Then pass the ball back to
advisor and STOP.**

---

## ★ QUEUED (user, 2026-08-27) — port the remaining 4 frame-calc shapes into `apps/frame-calc`

**Not dispatched yet — queued behind the persistence epic above.** Recorded now with the advisor's
groundwork done so it's ready to go.

Only **Trapezoid** is ported (`apps/frame-calc`, cycle 190). The other four live in the read-only
reference repo `C:\Users\danse\APPS\geometric frame calc`. **Advisor checked each engine's actual
return shape** — that's what determines the real cost, and they fall into three tiers:

| Shape | Engine | Returns | Cost |
|---|---|---|---|
| **Parallelogram** | `shared/utils/quadFrameCalculator.js` — **already ported** to `#core/frame-geometry.js` | `{P,Q,S,boards,cutList}` | **UI porting only** — engine + sketch-builder both work unchanged |
| **Polygon** | its own `polygonCalculator.js` (regular N-gon) | **same** `{P,Q,S,boards,cutList}` (+ `N,s,r,R,acrossFlats,…`) | port the engine to `#core`; sketch-builder needs NO change |
| **Triangle** | its own `framingCalculator.js` (right) **+** `obliqueCalculator.js` (oblique — two sub-modes) | **different** — named board objects (`V`,`H_board`,`D` with `tl/tr/br/bl` corners), NOT a `boards[]` array | needs an ADAPTER to the sketch-builder, plus a sub-mode selector |
| **Stud layout** | `boxGeometry.js` | unverified — a different KIND of tool (stud spacing inside a box, not a frame perimeter) | assess before committing; may not fit the frame model at all |

**⭐ THE KEY DESIGN INSTRUCTION — DECLARE, don't hand-roll five branches.** Everything downstream of
the engine call is already shared and proven (`sketch-builder.js` → fixed joints + lines + real
dimension constraints → `exportShaperSVG`). The only per-shape parts are **(a)** the input form and
**(b)** the engine call + vertex mapping. So introduce a **declared calculator REGISTRY** — one row per
shape, e.g. `{ id, label, engine, formFields, mapVertices }` — and drive both the shape-picker UI and
the calculation off that data. A new shape must be a new ROW, not new machinery. This is exactly the
project's own "DECLARE over hand-roll" principle, and the reason the Trapezoid work generalizes cheaply.

**UI shape:** add a **shape picker** (tabs or a dropdown) selecting which calculator is active. It is
ORTHOGONAL to the existing Calculator/Sketch view toggle — picking a shape changes the form + geometry;
the Sketch view, dimensions, drawer, and export stay exactly as they are. Retire the hardcoded
"Frame Calc — Trapezoid" title in favour of the active shape's label.

**⚠ SLICE 0 COMES FIRST — reach PARITY on Trapezoid before porting anything else (user-flagged:
"the trapezoid calculator is not as full blown as the original").** Cycle 190 deliberately shipped a
reduced Trapezoid to prove the CAD-toggle pattern. Advisor diffed the original's controls
(`trapezoid-frame-calculator/src/components/TrapezoidControlsPanel.js`) against the port — **three
features are missing**, and every one of them is SHARED across the quad shapes + polygon:
1. **Joint-type picker** — per-corner `Miter` / `CW-Through` / `CCW-Through`. The engine already takes
   this (`calculateQuadFrameGeometry({ joints: [...] })`) and it materially changes both board geometry
   AND the saw gauges; without it you're locked to all-Miter. There's a shared glyph component for it
   in the reference repo (`shared/components`, the `QuadJointGlyph` the roadmap mentions) — reuse it.
2. **Plywood Sheathing Shell + Shell Clearance** — the engine already computes the shell ring (`S` /
   `shellPolyString` from `shellOffset`); the port simply never surfaces or draws it.
3. **Target Dimension Mode** (incl. an "All Sides" option) — governs what the typed dimensions
   actually measure. Read the original to pin its exact semantics before implementing.
Also compare the CANVAS: the original's `TrapezoidCanvasView.js` is 443 lines (dimension lines, angle
arcs, joint glyphs); the port's preview is far simpler. Decide what's genuinely needed vs. what the
Sketch view now covers better — don't blind-port 443 lines, but don't silently drop shop-critical
readouts either.

**⭐ WHAT A SCREENSHOT OF THE ORIGINAL REVEALS (user-supplied, 2026-08-27) — read this before designing:**
- **The joint picker is IN-CANVAS, not a form control.** Each of the 4 corners carries a clickable
  glyph button showing that corner's current joint type. That's the `QuadJointGlyph` component. Follow
  that design — it's better than a separate dropdown list, because the choice is spatial.
- ⭐ **The original's visual language ALREADY MATCHES Sketch-Studio's dimension semantics.** Driving
  inputs (12" top, 24" bottom, 10" height) render GREEN and un-parenthesized; every DERIVED value
  (board lengths `(10 5/16")`, `(8 3/16")`, angles `(29.5°)`, `(121.0°)`) renders **in parentheses** —
  which is exactly how `svg-renderer.js` already draws a DRIVEN/REFERENCE dimension vs. a driving one.
  **So much of this doesn't need re-drawing at all** — in the Sketch view, the calculator's typed
  inputs should become DRIVING dimensions and the derived board/angle values REFERENCE dimensions, and
  the existing renderer produces the same convention natively. Exploit that instead of porting a
  parallel drafting layer.
- **Saw-gauge readouts are shop-critical and must survive** — note the `(-45° = 15.5°)` annotation with
  its dashed reference line: that's the actual miter-saw setting, the whole point of the tool. The
  repo's ROADMAP calls a wrong displayed number "the worst defect class."
- **The original already has SHAPE TABS** (Parallelogram · Polygon visible in its header) and a
  **History** control with a count badge. So the shape-picker design in Slice A can follow the
  original's own pattern rather than being invented from scratch.
**Why first:** all three are shared across the remaining shapes. Port 4 more shapes at today's fidelity
and you replicate the same gap 4× and then fix it 5×.

**⚠ QUEUED BUG (found during Slice 0, confirmed PRE-EXISTING via git-stash A/B — not caused by that
work):** the **Sketch view opens severely over-zoomed** for a frame of this size — there is NO view-fit
logic anywhere in `apps/frame-calc/src/main.js`. Mounting the sketcher should fit the built geometry to
the canvas (compute the geometry's bounds → set `state.view` to frame it with a margin). Small, and it
badly hurts first impressions of the toggle. **Do this with Slice A** (or before it) — every additional
shape ported makes it more visible.

**Suggested slicing (one per turn, review each):**
- **0** — ✅ **DONE** (cycle 199, commit `ee34837`) — Trapezoid parity: in-canvas per-corner joint
  picker (real `QuadJointGlyph` port, click-to-cycle), Plywood Sheathing Shell (toggle + clearance +
  ring), and Target Dimension Mode (Wood Frame Inside / Sheathing Shell Outside, correctly gated behind
  the shell being ON, with the back-calculation trig ported). Corner stats extended 2→4 (2 was only
  valid under the all-Miter assumption). **`sketch-builder.js` needed ZERO changes** — it consumes
  `geom.boards` generically, verified live with a CW-Through corner.
  - **Dispatch correction recorded:** the advisor's "Target Dimension Mode incl. an 'All Sides' option"
    conflated two unrelated things — **"All Sides" is just the Board Thickness slider's label**; the
    real dimension mode is the inside/outside shell-vs-frame target. Implemented with the correct
    semantics.
  - Deliberately NOT ported (reasoned, dispatch-permitted): click-to-edit-on-canvas, zoom/pan, PNG
    export, angle arcs — the Sketch view's real solver-backed editing covers these better.
- **A** — the registry + shape picker + **Parallelogram** (cheapest; proves the registry with 2 rows).
- **B** — **Polygon** (port `polygonCalculator.js` into `#core`; same output shape, so the toggle
  should light up with no sketch-builder change — verify that claim, don't assume it).
- **C** — **Triangle** (the adapter + right/oblique sub-modes — the real work).
- **D** — **Stud layout** (assess first: does it even produce frame-style boards? If not, it may
  belong as its own thing rather than forced into this registry — flag rather than force-fit).

---
<!-- superseded (provenance) -->
## TASK — BATCH 3 (BURN-DOWN cont'd): STYLE-TOOL — per-shape STROKE color+width / FILL color, driving outline-pen / fill-pen. COMMIT PER ITEM (4 + a tiny 5th); verify each; pass back ONCE.

**Foundation (LOCKED):** merged single-`#core`-store; invariant = **FREE ART BYPASSES THE SOLVER**. Plan = `PARITY-ROADMAP.md`.
**MODEL (user-CONFIRMED, no other option): stroke color → the OUTLINE pen; fill color → the FILL pen.** Reference original =
`SketchStudio/legacy pen plotter/app/js/style-panel.js` (stroke/fill/width/None). All plotter-side (`#core`/`#ui` untouched);
`#core` stays pure — the style record is PLOTTER state, like `shapeColors` today.

1. **STATE — per-shape digital STYLE record** (`state.js`): replace the single `state.shapeColors` (Map id→hex) with a style record
   `{ stroke: hex, fill: hex|null, width: mm }` (fill `null` = None; width = DISPLAY-only — the plotted line is the pen's physical
   width). MIGRATE in place: existing entries → `{stroke: oldHex, fill: null, width: default}`; keep `penColorForShape` reading the
   STROKE so every current consumer (underlay, bucketing, mix) works unchanged before items 2–4 land. Check for any serializer that
   persists `shapeColors` and migrate it too.
2. **UI — the Style section** (`sketch-stage.js` sidebar): replace the lone "Pen color" row with **Stroke** (color + width input) and
   **Fill** (color + a None toggle), per the legacy style-panel. **Pen-mix stays**, now applying to the FILL color when one is set
   (mix generates cross-hatch FILLS), else the stroke — note this in the WORK-LOG for review. Multi-select edits all selected (as today).
3. **RENDER — see the style in Design** (`sketch-stage.js` underlay): stroke drawn in the stroke color at the display width; a CLOSED
   shape with a fill color also gets a translucent SVG fill in that color (so fills are VISIBLE while designing, like the legacy).
4. **BUCKETING — styles drive the pens** (`toolpath-layers-panel.js` `createToolpathsFromSelection`): **+Outline buckets the selection
   by STROKE color** (skip shapes with no stroke), **+Fill buckets by FILL color** (skip fill=None) — the legacy's pickColor precedence,
   now on the #core style record. Nearest-pen match / pen auto-create per color unchanged.
5. **(tiny) Document button unit label**: it hardcodes "mm" — honor `state.docUnit` (in inches show `in`, converted values).

**VERIFY (the workbench flow, by clicks):** circle with stroke=red width=0.8 fill=blue → Design shows a red outline + translucent blue
fill; select → Toolpath **+Outline** → an outline op on the RED pen; **+Fill** → a fill op on the BLUE pen; overlay + Export gcode per
pen. An OLD doc/shape (single color) still renders + buckets via the migration. Pen-mix on a fill color still produces mixed fills.
shell-smoke 12/12; plot oracles green STANDALONE; Studio/Shaper unregressed; 0 console errors. If an item balloons, SPLIT + flag.

**DECISIONS RULED (advisor, turn 367):** keep `inheritPaint`/`penColorFor` (SHARED — core-import runs through them); keep
`importSvgText` + its art-store helpers as the REFERENCE IMPLEMENTATION for the still-open S6 [D] Inkscape-layer-split decision —
do not delete them in cleanup. Repo-local `handoff.py` was STALE (no `amendments`) — synced from the skill copy this turn; use either.

**AFTER Batch 3:** Batch 4 = transforms (scissors/rotate/scale/node as #core joint transforms — turnkey plan in WORK-LOG t344).
Batch 5 = boolean union · cloud · responsive [D]. Remaining S8 bits (preset swatch popover, mixed-value cue) ride with Batch 5 polish.

Append a WORK-LOG entry (per-item: root + fix + verify) ending with exactly `=== BATCH-3 DONE — HOLD ===`. **Then pass the ball back to advisor and STOP.**

---
<!-- superseded (provenance) -->
## BATCH 2 (DONE `167a32a..1a98467` + WORK-LOG `3f4498a`): import sets the paper size (declared pure `computeImportSize` in #core + `setDocSize` fan-out) · `<ellipse>` → closed ring at bézier density (`arcSteps`) · S/T reflect + REAL `flattenArc` (F.6.5/F.6.6, glued-flag reader scoped to A) · Design drag-drop + dead importer retired. Additive proof: 56 already-supported inputs geometry-identical; Shaper live drag-drop unregressed (23 shapes). Advisor re-ran svg-import test + 5/5 plot oracles + 12/12 shell-smoke. Approved t367.

---
<!-- superseded (provenance) -->
## BATCH 1 (DONE `4c0ecd0..2be55da`, 6 commits): Delete→#core (dead art-store iteration retired) · docked Undo/Redo (+ additive `#ui` `redo()`, undo behavior unchanged) · visible marquee (window=solid/crossing=dashed) · target-editing banner · modal Done/Cancel (on-open-snapshot revert) · smaller Design joints (`JOINT_RADIUS=2` runtime-only, persist:false). Each live-verified; 12/12 + 5/5; Studio/Shaper unregressed. Loop then closed at cycle 183 (user pause) — REOPENED for Batch 2.

---
<!-- superseded (provenance) -->
## DESIGN-PAPER-BOUNDS (DONE `da1abf8`): Document button un-clipped (full-width); Design canvas draws the paper rect+10mm grid at doc size BEHIND the geometry (backmost `#design-paper` svg), matching Toolpath/Export; extracted shared `paperGridMarkup(doc)` (`paper-grid.js`) — render-art reuses it (−40 lines). viewBox-synced, resizes live (200→150 verified). Plotter-side, 23/23 + 12/12.

---
<!-- superseded (provenance) -->
## DOC-SIZE-IN-DESIGN (DONE `2c7e8e1`): added a discoverable "Document · W×H" button to the Design sidebar opening the EXISTING `#docModal`; extracted idempotent `installDocModal()` wired from BOTH the Design mount + `installSettingsPanel` (dialog works from the first tab); panelTick syncs the label. No dup ids; 23/23 + 12/12. (tiny: label hardcodes "mm" in inch mode — later.)

---
<!-- superseded (provenance) -->
## LAYOUT-UNIFY (DONE `f95fb2e`): Toolpath/Export adopt the Design frame — reserved 80px top strip + panel LEFT 244px + `#canvasWrap` RIGHT. Measured canvas rect IDENTICAL on all 3 tabs (x244 y124 w1056 h705); only the left panel content swaps. Plotter-shell only, 23/23 + 12/12. (Strip=80px pixel-perfect; can shorten if a small vertical offset is OK.)

Append a WORK-LOG entry ending with exactly `=== LAYOUT-UNIFY DONE — HOLD ===`. **Then pass the ball back to advisor and STOP.**

---
<!-- superseded (provenance) -->
## EDITOR-TIDY (DONE `9f15f11`): removed the doubled Active-Toolpath heading (dropped both `subhead(...)` calls + the orphaned helper; static "Active Toolpath" header). Plotter-only, 23/23 + 12/12.

---
<!-- superseded (provenance) -->
## TOOLPATH-POLISH (DONE — Part A `93217f4`, Part B `6fff25a`): ported the legacy `.panel` look (section+h2, 2-col `.field` grid, scrollable lists) to the paper-light theme; doc-size→`#docModal` + auto-recalc→`#settingsModal` (⚙), inline settings = feeds only. Reads like the legacy; plotter-only, 23/23 + 12/12.

---
<!-- superseded (provenance) -->
## S3 (DONE `e3231e5`): surfaced the stranded Pens palette + relocated machine settings out of Export into the Toolpath tab (pure re-home; verified feed→F1234, penUp→Z7.000; 23/23 + 12/12). Exposed the messy-stack layout → TOOLPATH-POLISH.

---
<!-- superseded (provenance) -->
## S2 (DONE — Part1 `09bb06e`, Part2 `ec7253b`): op-editor type-gated (outline vs fill) + Draw-outline toggle + dynamic header + schema step; live op rows (hover/selected CSS + bidirectional row↔canvas cross-highlight via `renderArt({skipPanels})` / panel-only refresh). Verified: plot oracles 5/5 standalone, shell-smoke 12/12, additive `step:` #core touch only.

> **QUEUED — the AUTHORITATIVE plan is now `PARITY-ROADMAP.md`** (exhaustive 125-feature audit, original vs merged, 2026-07-11).
> MERGE-1 (in flight) = its first slice. Then S2→S11, cheap-high-value first. Advisor dispatches one slice per turn from there.
> **Correction folded in:** machine SETTINGS are NOT orphaned — they're wired in the **Export tab** (`mountExportStage →
> installSettingsPanel`); only discoverability is weak. Earlier "settings orphaned / feeds not editable" was WRONG.
> **Next after MERGE-1 (per roadmap):** S2 fill-editor correctness (re-gate by `tp.type`, re-add Draw-outline checkbox) ·
> S3 surface the hidden Pens panel (unlocks pen rename/width/delete — highest structural win) · S4 Delete-key→#core + undo/redo
> buttons · S5 marquee/banner overlays. Panel row hover/selected/cross-highlight folds into S2/S3 (the editor+pens live there).

---
<!-- superseded (provenance) -->
## PARITY-AUDIT + RESTORE (DONE `458796d`): audited original vs merged (full table in WORK-LOG t344); restored #core vector HOVERING (Design #ui + Fill/Toolpath ghost). rotate/scale/scissors re-bucketed RESTORABLE-for-size (turnkey plan); node-edit + snapping flagged. FOUNDATION then LOCKED = stay merged.
## WORKFLOW-FIX (DONE `c379576`): #core vectors selectable in Fill/Toolpath (data-shape-id + coreShapeAtPoint) -> +Outline/+Fill target the selection + assign pen. Verified by clicks: draw->select->toolpath+pen->fill->export 3 gcode.

**Context (user, frustrated):** "there's no UI at all, how do I apply fills and toolpath." RENDER-FIX made geometry VISIBLE,
but there's NO usable UI to APPLY a FILL or CREATE/ASSIGN a TOOLPATH. The migration verified the PIPELINE (programmatic
toolpath -> gcode) but NEVER the user-facing WORKFLOW. Likely the Fill/Toolpath panels lost their wiring / actions in the
stage-merge + render changes (toolpath-layers-panel PP-4b; active-layer-panel UNIFY-4c). The Fill tab shows OUTLINE/FILL
dropdowns but no way to apply them; the Toolpath create/pen UI may be missing.

**ROOT CAUSE (user pinned it): "we can't SELECT vectors in Fill or Toolpath."** So targeting a shape with a toolpath/fill is
impossible -> the whole workflow is dead. RENDER-FIX drew the `#core` geometry on `#canvasWrap` as VISUAL paths but did NOT
wire CLICK-SELECTION (the paths lack `data-shape-id` / the plotter canvas click-handler doesn't map a click -> the `#core`
shape). **FIX SELECTION FIRST**, then the create/apply/assign actions hang off it.

**▶ Scope — DIAGNOSE live (drive the app), then FIX the WORKFLOW UI:**
1. **Selection (the root):** make the RENDER-FIX'd `#core` geometry on the Fill/Toolpath `#canvasWrap` SELECTABLE by CLICK —
   tag each rendered path with its `#core` `data-shape-id` (as render-art did for art shapes) + wire the plotter canvas
   click-handler (interaction.js) to select the `#core` shape -> `state.selectedShapeIds` (marquee too). Then a toolpath can
   target the selection (UNIFY-2). VERIFY: click a vector in Fill/Toolpath -> it highlights/selects.
2. **Then the actions:** TOOLPATH tab — CREATE a toolpath (+Outline/+Fill) targeting the SELECTION, ASSIGN a pen, order/feeds.
   FILL tab — apply a Pattern/Outline to the selected shape's toolpath. Report + reconnect whatever's MISSING vs the
   pre-UNIFY panels (toolpath-layers-panel PP-4b, active-layer-panel UNIFY-4c).
2. **FIX so a user can, ENTIRELY VIA CLICKS (no console/window.__ seams):** select geometry -> create a toolpath (outline OR
   fill) -> assign a physical pen -> tune the fill pattern / outline style -> see the toolpath overlay -> Export gcode.
   RECONNECT whatever the migration disconnected (create-toolpath buttons, target-selection, pen-assign, fill/outline apply).
3. Keep it working end-to-end; don't regress Design/render.

**VERIFY LIVE (must be doable by CLICKS, screenshot the working panels):** draw a rect in Design -> Toolpath tab: create an
outline toolpath targeting it + assign a pen (the buttons/UI are THERE and work) -> Fill tab: give it a hatch fill -> the
overlay updates -> Export = gcode. NO console seams used. 3 apps load; `npm run test:shell` **12/12**; oracles green.

Append a WORK-LOG entry (what was disconnected + the reconnect + the by-clicks verify) ending with exactly
`=== WORKFLOW-FIX (fill/toolpath UI usable by clicks) DONE — HOLD ===`. **Then pass the ball back to advisor and STOP.**

---
<!-- superseded (provenance) -->
## RENDER-FIX (DONE `669df07`): #core geometry (drawn+imported) now renders in pen colors in Fill/Toolpath/Export; removed the dead #allTools draw toolbar. Live-verified in all 4 tabs.

**Context:** the user reports drawn sketches + imported SVGs are INVISIBLE in Fill/Toolpath (and maybe imports don't show at
all). LIKELY CAUSE: UNIFY-7 gutted `render-art` (draws on the Fill/Toolpath/Export `#canvasWrap`) to only paper/grid +
toolpath-overlay + sim — NOT the `#core` geometry. Design shows it (sketcher live + pen-underlay for static imports), but the
other 3 tabs draw nothing underneath.

**▶ Scope — DIAGNOSE live, then FIX:**
1. **Diagnose (report exactly what's invisible where):** a drawn `#core` shape in DESIGN? an IMPORTED SVG in Design
   (underlay)? EITHER in Fill/Toolpath/Export? Pin it down.
2. **FIX — `#core` geometry must RENDER in Fill/Toolpath/Export:** `render-art` (on `#canvasWrap`) must draw the `#core`
   geometry (via `coreShapeToPolyline`, in pen colors — like the Design underlay) BENEATH the toolpath overlay/sim, so the
   user SEES their sketch + imports in those tabs. (Cleanest may be to reuse the underlay-render on `#canvasWrap`, OR converge
   Fill/Toolpath/Export onto the shared `#ui` canvas + underlay — if that's a bigger change, FLAG + do the direct render fix.)
3. **If imports don't show in Design either:** fix the underlay/static-import display so imports render.
4. **REMOVE the leftover draw toolbar** (`#allTools` / `.tool` stack in `draw-stage.js` TOOLBAR/TOOLS) — dead scaffold showing
   in Fill/Toolpath (UNIFY-7b cleanup). Fill/Toolpath/Export must NOT show draw tools.

**VERIFY LIVE (the user's exact symptom):** draw a line/circle in Design + import an SVG -> BOTH show in Design AND Fill AND
Toolpath (as geometry, pen colors) -> a toolpath overlays correctly -> Export works. NO stray draw toolbar in any tab. 3
apps load; `npm run test:shell` **12/12**; oracles green standalone; Studio/Shaper unregressed.

Append a WORK-LOG entry ending with exactly `=== RENDER-FIX (geometry visible in all tabs) DONE — HOLD ===`. **Then pass the ball back to advisor and STOP.**

---
<!-- superseded (provenance) -->
## COLOR-MIX-3 (DONE `097d72e`) — #11 COMPLETE: opt-in Pen-mix -> N per-pen fill toolpaths via the existing pipeline; orange -> 2-pen hatching. 23/23 oracles.

**Context:** COLOR-MIX-1 (`mixForColor`) + COLOR-MIX-2 (`mixFillStrokes`) are the pure math+geometry. Now WIRE it: a shape
whose digital color the palette can't hit is PLOTTED as a pen-mix. OPT-IN; nearest-single-pen stays the default (UNIFY-4c).

**▶ Scope — integration + opt-in:**
1. **A "Mix" opt-in** (Design or Toolpath tab): for a selected shape/region, "reproduce color as pen-mix" ->
   `mixForColor(shapeColor, palette)`. Single pen within tol -> NO mix (default). Else -> generate the mix.
2. **Per-pen plot geometry (REUSE the pipeline):** for each `{penId, weight}`, create a FILL TOOLPATH targeting the shape
   (pattern=hatch, spacing=penWidth/weight, angle=distinct-per-pen, pen=penId) so the EXISTING fill->pipeline->export plots
   each pen's hatching. (Or call `mixFillStrokes` directly and emit per-pen toolpaths — your call; reuse existing fill/
   toolpath machinery, NO new pipeline.)
3. **Export:** a mixed shape -> N per-pen gcode files (one per pen) -> load + swap pens -> the blend. Surface the mix (pens +
   weights) in the UI.

**VERIFY LIVE:** a shape with orange `#ff8000` on a {red,yellow,blue,...} palette -> Mix ON -> Export = TWO pens' hatching
(red + yellow) at interleaved angles/densities (paste gcode showing BOTH pens' G1 runs); Mix OFF -> nearest single pen. 3
apps load; `npm run test:shell` **12/12**; oracles green standalone; Studio/Shaper unregressed.

**GUARDRAILS:** REUSE the fill/toolpath/export pipeline (no new pipeline); OPT-IN (default = nearest single pen). Plotter-side
+ the `#core` mix functions. 0 net-new.

Append a WORK-LOG entry ending with exactly `=== COLOR-MIX-3 (WIRE PEN-MIX) DONE — #11 COMPLETE — HOLD ===`. **Then pass the ball back to advisor and STOP.**

---
<!-- superseded (provenance) -->
## COLOR-MIX-2 (DONE `3465144`): pure `mixFillStrokes` — per-pen cross-hatch at spacing=penWidth/weight, distinct angles; oracle measures real spacing. 23/23 oracles.

**Context:** COLOR-MIX-1 (`c2cb596`) gives `mixForColor -> [{penId, weight}]`. Model BLESSED: linear-RGB best-pair = correct
for OPTICAL cross-hatch mixing (interleaved strokes -> the eye averages -> weighted average; NOT subtractive/overlap). The
weight = area coverage. Now render a mix: interleave each pen's hatching so the eye blends to the target.

**▶ Scope — the fill-layering (geometry), pure:**
1. **`mixFillStrokes(region, mix, penWidth) -> [{ penId, strokes }]`** (pure `#core`, reuse `#core/plot/fills` hatch): per pen
   in the mix, a HATCH fill of `region` at DENSITY ∝ its weight (coverage = weight => spacing ≈ penWidth / weight) at a
   DISTINCT ANGLE per pen (spread e.g. 0/60/120°) so the pens INTERLEAVE (adjacent strokes, optical blend), not overlap.
   Returns per-pen stroke sets.
2. **ORACLE:** a square region + orange mix {red:.5, yellow:.5}, penWidth w -> 2 hatch sets (red + yellow), each at spacing
   ≈ w/.5 = 2w, distinct angles; a single-pen mix ({p:1}) -> one denser fill (spacing ≈ w). Green standalone.
3. Do NOT wire to the toolpath pipeline / UI yet (COLOR-MIX-3). Pure.

**VERIFY:** the oracle + all 23 core oracles green STANDALONE; `node --check` clean; Studio/Shaper unaffected; shell-smoke
**12/12**; 0 net-new.

**GUARDRAILS:** pure `#core` (reuse fills, no fork); no pipeline/UI this slice.

Append a WORK-LOG entry ending with exactly `=== COLOR-MIX-2 (MIX FILL-LAYERING) DONE — HOLD ===`. **Then pass the ball back to advisor and STOP.**

---
<!-- superseded (provenance) -->
## COLOR-MIX-1 (DONE `c2cb596`): pure `#core/color-mix.js` mixForColor (linear-RGB best-pair) + oracle. Model BLESSED (optical cross-hatch = weighted average). 23/23 oracles.

**Context:** the digital->physical model (UNIFY-4c) maps each digital color to its NEAREST SINGLE pen. #11 "hash color mixes":
a color the palette can't hit (e.g. orange on red+yellow+blue) is APPROXIMATED by COMBINING pens (cross-hatch red+yellow ->
visual orange). This slice = the pure MATH only; the fill-layering/plot + the UI wiring are COLOR-MIX-2/3.

**▶ Scope — the pure function + oracle:**
1. **`mixForColor(targetRgb, palette) -> [{ penId, weight }]`** (pure `#core`, e.g. extend `#core/color-match.js` or a new
   `#core/color-mix.js`): if a SINGLE pen is within tolerance of the target -> `[{that pen, 1}]` (no mix). Else find the small
   set (2, maybe 3) of pens whose WEIGHTED blend best approximates the target + the weights (weights in [0,1], sum 1). MVP
   model: linear-RGB (or a simple subtractive) blend; pick the pens that best span/bracket the target; least-squares or
   nearest-2-that-bracket. Deterministic, no DOM.
2. **ORACLE** (`packages/core/tests/`): orange `#ff8000` on a {red,yellow,blue,black,white} palette -> ~{red:0.5, yellow:0.5}
   (assert the blended weights reconstruct the target within tolerance); a color that IS a pen -> that single pen weight 1;
   grey -> black+white weights; guard empty palette. Green standalone.
3. Do NOT wire it to fills or UI yet (COLOR-MIX-2). Pure additive `#core`.

**VERIFY:** the mix oracle + all 22 core oracles green STANDALONE; `node --check` clean; Studio/Shaper unaffected (new/extended
pure file, no behavior change); shell-smoke 12/12; 0 net-new.

**GUARDRAILS:** pure `#core` color math (additive); no fills/UI this slice. If the "best mix" model has real choices (which
pens, how many, blend space), pick a defensible MVP + FLAG the model in WORK-LOG for review.

Append a WORK-LOG entry ending with exactly `=== COLOR-MIX-1 (PURE MIX FUNCTION) DONE — HOLD ===`. **Then pass the ball back to advisor and STOP.**

---
<!-- superseded (provenance) -->
## UNIFY-3-tool (DONE `cc2734d`): shared #ui bezier PEN tool for ALL apps (punch #12). Additive (new TOOL_MODE + ribbon button + preview branch + interaction); verified live in Studio/Shaper/plotter; 22/22 oracles + shell-smoke; output-unregressed. FLAG: curve-body click-select gap (UNIFY-4b, tracked).

**Context:** the redesign is functionally complete; the user picked the deferred **`#ui` bezier tool** first. The `#core`
bezier SHAPE (UNIFY-3) + fitter (UNIFY-3-fit) are in; the plotter Freehand (UNIFY-4b) is a plotter-side capture. Now the
SHARED explicit tool the user asked for ("a bezier tool in ALL the sketch studio apps") — place/drag control points to draw
precise beziers. A `#ui` tool, so all 3 apps gain it.

**Guardrail (ADDITIVE + output-unregressed):** a NEW tool mode + interaction in `#ui`; existing tools/shapes/constraints/
tests UNCHANGED. Studio/Shaper existing content renders/exports IDENTICALLY (shell-smoke 12/12; core oracle 22/22; a
render/import proof). All apps GAIN the button; existing behavior byte-identical in output.

**▶ Scope — the shared bezier pen tool:**
1. **A `bezier` TOOL MODE** (`#core/constants.js` TOOL_MODES) + a bezier button in the `#ui` tool ribbon (CREATE group, by
   line/rect/circle/arc). Additive.
2. **The pen interaction** in the `#ui` input layer (add a `bezier` case to the `switch(currentTool)` the survey found —
   additive): CLICK places an anchor (endpoint JOINT); CLICK-DRAG pulls the tangent handles (smooth point); each new anchor
   commits a cubic segment (`makeBezier` from the previous anchor + handles) into the `#core` store. Live PREVIEW of the
   pending segment; Enter/Esc/double-click ends the path. Corner (click) vs smooth (click-drag) anchors.
3. Reuse `makeBezier` (UNIFY-3) — a chain of connected cubics sharing endpoint joints.
4. **SPLIT authorized:** if the full pen (handle-drag + preview + corner/smooth) is big, land BASIC first (click anchors ->
   cubics with straight 1/3-2/3 handles, no drag) + FLAG, then handles/preview.

**VERIFY LIVE (in ALL 3 apps):** the bezier button appears in Studio, Shaper, AND the plotter Design ribbon; draw a bezier
path (place anchors, drag handles) -> `#core` bezier shapes render + are selectable; in the plotter, target a toolpath ->
Export = the curve. Studio/Shaper existing behavior UNREGRESSED (shell-smoke 12/12; 22/22 oracles; existing render/export
identical). `node --check` clean; 0 net-new.

**GUARDRAILS:** `#ui`/`#core` ADDITIVE (new tool mode + ribbon button + interaction case); existing tools/behavior output-identical.

Append a WORK-LOG entry ending with exactly `=== UNIFY-3-tool (SHARED #ui BEZIER TOOL) DONE — HOLD ===`. **Then pass the ball back to advisor and STOP.**

---
<!-- superseded (provenance) -->
## CIRCLE-FIX (DONE `4896845`): closed-polyline collapse — root cause douglas-peucker float cancellation (not linemerge); surgical closed-loop guard; byte-exact golden held; circle exports full rim.

**Context:** UNIFY-7's verify DISCOVERED a pre-existing pipeline bug: a CLOSED polyline (first==last — e.g. a circle's 65-pt
flatten) collapses to a 2-POINT stroke in `toolpathToPolylines` (`#core/plot` optimize) EVEN with lineSimplify off, so a
circle exports as ~1 gcode move (doesn't plot). Lines / open polylines / beziers are fine. Root cause: `linemerge`
self-merges the coincident start/end of a LONE closed loop. `#core/plot` untouched since PP-2a.

**▶ Scope:**
1. **Diagnose `#core/plot/optimize/linemerge.js`:** confirm a closed polyline (start==end within tol) fed to linemerge folds
   (it treats its own shared endpoint as a merge join).
2. **Fix — preserve closed loops:** linemerge must NOT merge a polyline's OWN start/end into itself (only join DISTINCT
   polylines); OR detect closed inputs and pass them through intact; OR drop the single duplicate closing vertex before merge
   + re-close. Cleanest option; keep OPEN-polyline merging unchanged.
3. **ORACLE** (`packages/core/tests/`): a CLOSED polyline (65-pt circle, first==last) -> `toolpathToPolylines`/`renderGcode`
   produces the FULL loop (correct move count), NOT a 2-pt collapse. Two-distinct-segment merge + open polylines still
   correct (regression). Green standalone.

**VERIFY LIVE:** draw a CIRCLE in Design -> toolpath -> Export -> the gcode WALKS THE FULL RIM (many G1, not 1). PASTE a
snippet. ALL plot oracles (esp. the PP-2a BYTE-EXACT DDCS golden — a closed-loop fix must NOT change open-path output) + the
new oracle green STANDALONE; shell-smoke 12/12; `node --check` clean; Studio/Shaper unregressed; 0 net-new.

**GUARDRAILS:** targeted `#core/plot` fix (closed loops only); the existing byte-exact open-path golden must stay green.

Append a WORK-LOG entry ending with exactly `=== CIRCLE-FIX (closed-polyline linemerge) DONE — HOLD ===`. **Then pass the ball back to advisor and STOP.**

---
<!-- superseded (provenance) -->
## UNIFY-7 (DONE `ccd9e7c`, SAFE SUBSET): retired the dormant art store + Bake-to-Draw (punch #3); ~427 LOC removed; full pipeline verified. FLAG: circle-export bug (fix = this task); dormant art code (interaction/svg-import/tools/state) deferred to UNIFY-7b.

**Context:** the unify is functionally complete (Design on `#core`, import->#core, pen model, throttle, shared pan/zoom). The
two-store era's ART side is now DORMANT — retire it. This kills "Bake to Draw" (punch #3).

**▶ Scope — SURGICAL delete (prove NO regression):**
1. **Retire the ART STORE + its rendering:** `state.artLayers` + `render-art`'s art-drawing + the art layers panel (if
   art-only) + `svg-import->art` (import goes to `#core` now, UNIFY-5) + the dormant art tools in `interaction.js` (the ones
   that drew into `artLayers` — the Design tab uses `#core` tools + the plotter Freehand now).
2. **Remove the Bake-to-Draw button** + its handler (punch #3 — now meaningless).
3. **KEEP what Fill/Toolpath/Export need:** the plotter `#canvasWrap` + `initDom` + the toolpath model +
   `state.toolpaths`/`plotColors`/`settings` + `preview`/`export`. They render `#core` geometry on `#canvasWrap` (UNIFY-2/6)
   — do NOT break them. (Retiring the plotter canvas ITSELF = a LATER optional consolidation, NOT this slice.)
4. If the art store is more entangled than expected (Fill/Toolpath/Export secretly depend on it), FLAG + do the safe subset.

**VERIFY LIVE (full pipeline, POST-delete):** draw in Design (`#core` line/circle + Freehand bezier) -> Fill (a pattern) ->
Toolpath (a pen) -> Export (gcode); import an SVG -> shows in pen colors -> plots; all 4 tabs work; NO Bake-to-Draw button;
pan/zoom consistent. PASTE a gcode snippet. 3 apps load; `npm run test:shell` **12/12**; oracles green standalone; `node
--check` clean; Studio/Shaper unregressed; 0 net-new. REPORT the LOC deleted.

**GUARDRAILS:** DELETE only the dormant ART side; KEEP the toolpath/canvas infra. PROVE the full pipeline still works.
penplotter-only.

Append a WORK-LOG entry ending with exactly `=== UNIFY-7 (RETIRE ART STORE + BAKE) DONE — HOLD ===`. **Then pass the ball back to advisor and STOP.**

---
<!-- superseded (provenance) -->
## UNIFY-6 (DONE `bfa6675`): pan/zoom convergence — all 4 tabs share one `#ui` state.view; viewport.js a thin adapter; wired the never-wired wheel-zoom. + import-display flip (imports show in pen colors). Punch #9. Plotter-side only.

**Context:** UNIFY-5 (`07be65a`) landed import->#core (colored, dense-static). Now punch-list **#9**: all plotter canvases use
consistent pan/zoom like the other apps. Today the Design tab uses `#ui`'s pan/zoom (`state.view{x,y,w,h}`) while
Fill/Toolpath/Export use the plotter's `viewport.js{scale,panX,panY}` — CONVERGE on the `#ui` model.

**▶ Scope:**
0. **(UNIFY-5 follow-up, one-liner — DECIDED):** mark ALL imports STATIC (not just >threshold) so an imported SVG DISPLAYS in
   its PEN colors (via the underlay) by default; the user activates a subset (select) to constrain. Small live imports were
   showing in DOF colors instead of pen colors.
1. **Converge pan/zoom on `#ui` `state.view`:** the Fill/Toolpath/Export canvas reads/writes the SAME `state.view` the Design
   sketcher uses (wheel-zoom + pan + fit), so pan/zoom is IDENTICAL across all 4 stages and matches Studio/Shaper. Retire
   `viewport.js`'s separate `{scale,panX,panY}` model (or make it a thin adapter over `state.view`).
2. Keep the two physical canvases for now (UNIFY-7 retires the plotter one); they just SHARE the view model + fit.

**VERIFY LIVE:** pan/zoom on Design, then Fill/Toolpath/Export — the view is CONSISTENT (same gesture, same feel) across all
4 tabs; fit works on each; a small import now shows in PEN colors. 3 apps load; `npm run test:shell` **12/12**; oracles green;
Studio/Shaper unregressed.

**GUARDRAILS:** prefer plotter-side / reuse `#ui`'s existing pan/zoom (`state.view` + its wheel/pan); any `#ui` touch =
additive + output-unregressed. 0 net-new.

Append a WORK-LOG entry ending with exactly `=== UNIFY-6 (PAN/ZOOM CONVERGENCE) DONE — HOLD ===`. **Then pass the ball back to advisor and STOP.**

---
<!-- superseded (provenance) -->
## UNIFY-5 (DONE `07be65a`): import SVG -> #core (constrainable, colored, dense-static 60fps); reused #core/svg-import (no fork). Punch #2/#4. Ellipse/S-T-A surfaced (IMPORT-3).

**Context:** UNIFY-throttle (`1467078`) CLEARED the perf blocker (0.7->60 FPS via a marked-static skip + a solve-gate) AND fixed
the render-parity bug (normal sketch overlays always live). Now IMPORT: SVG -> `#core` sketch geometry so imported art is
CONSTRAINABLE + shows in the Design tab. Punch-list #2/#4.

**▶ Scope:**
1. **Import SVG -> `#core`:** an Import action in the Design tab -> the plotter's SVG parse -> `#core/svg-import`
   (`importSvgGeometry` + CTM + `parsePathSubpaths` + `computeImportScale`) -> a new sketch's `#core` shapes. REUSE Shaper's
   `importSvgToSketch` pattern (`apps/shaper/src/main.js`) — no fork.
2. **Capture colors -> the pen-layer:** each imported element's SVG fill/stroke -> the shape's DIGITAL color
   (`state.shapeColors`); the Toolpath nearest-pen map (UNIFY-4c) derives the physical pen (8-color SVG -> 8 digital ->
   mapped to the palette).
3. **Mark DENSE imports STATIC:** if the import batch exceeds a threshold (e.g. > a few hundred shapes), MARK them static
   (`state.staticShapeIds`) so the throttle holds ~60 FPS. SMALL imports stay LIVE/constrainable.
4. **Import limits (tracked IMPORT-3):** ellipse -> approximate (arcs/beziers) or flag; path S/T/A -> the existing flatten.
   COUNT + surface skipped/approximated — never silently drop.

**VERIFY LIVE:** import a multi-color SVG -> its geometry shows in the Design tab (`#core`, in mapped pen colors via the
underlay); a DENSE import stays ~60 FPS (marked static); a toolpath targets imported geometry -> Export = its gcode (paste a
snippet); a SMALL import is live/constrainable. 3 apps load; `npm run test:shell` **12/12**; oracles green; Studio/Shaper
unregressed.

**GUARDRAILS:** REUSE `#core/svg-import` (no fork); import colors are PLOTTER-side (`shapeColors`). Any `#core`/`#ui` touch =
additive + output-unregressed. 0 net-new.

Append a WORK-LOG entry ending with exactly `=== UNIFY-5 (IMPORT SVG -> #core + COLORS + STATIC) DONE — HOLD ===`. **Then pass the ball back to advisor and STOP.**

---
<!-- superseded (provenance) -->
## UNIFY-throttle (DONE `1467078`): static-skip + solve-gate seams (additive #ui) -> 6716 shapes 0.7->60 FPS; MARKED-STATIC policy fixed the render-parity bug (normal sketch overlays always live, not selection-gated). Punch #14. FLAG: solve() O(joints)/call = a later #core slice.

**Context:** the perf probe found ~6716 `#core` shapes = **0.7 FPS** — the `#ui` renderer rebuilds ALL paths + joints per RAF
frame. The color UNDERLAY (UNIFY-4c) already renders `#core` geometry ONCE (dirty-flagged). THROTTLE = stop the LIVE sketcher
re-rendering STATIC geometry (the underlay shows it); only the FEW active/edited shapes redraw per frame.

**▶ Scope:**
1. **A host-injected STATIC-SKIP seam in `#ui`** (mountSketch / svg-renderer): an optional `isStatic(shape)` predicate OR a
   `staticIds` Set the host passes; the renderer SKIPS those shapes + their joint glyphs in the per-frame render. **ADDITIVE:**
   default (no predicate) = render everything = BYTE-IDENTICAL (Studio/Shaper pass nothing -> unchanged output). Keep "static"
   a HOST concept — do NOT put a static flag on `#core` shapes (mirror the pen-model decision).
2. **Plotter marks geometry STATIC:** imported/dense + unedited geometry is static (drawn by the underlay). Freshly-drawn /
   selected geometry is LIVE (drawn by the sketcher for editing/constraining).
3. **ACTIVATION:** selecting a static shape (or a "make editable" action) moves it LIVE (out of static) to edit/constrain;
   deselect -> back to static. (Dense imports = static-by-default; activate a subset to constrain.)
4. **MEASURE:** the 6716-shape all-static scene -> REPORT the new frame time (target interactive, ~<=16 ms; only live shapes redraw).

**VERIFY:** the perf MEASUREMENT (6716 static -> interactive fps, vs 0.7 before); a static shape shows in the underlay,
activates on select (renders live), edits, deactivates; **Studio/Shaper OUTPUT-unregressed** (no skip -> byte-identical;
shell-smoke 12/12 + a render/import proof); all oracles green standalone; `node --check` clean. FLAG if the `#ui` seam proves
complicated.

**GUARDRAILS:** the `#ui` edit is ADDITIVE (a skip seam; default = render-all = unchanged). "static" is HOST-side. 0 net-new.

Append a WORK-LOG entry ending with exactly `=== UNIFY-throttle (STATIC-SKIP RENDER) DONE — HOLD ===`. **Then pass the ball back to advisor and STOP.**

---
<!-- superseded (provenance) -->
## UNIFY-4c (DONE `011413c`): pen model (digital shapeColors + Toolpath nearest-pen) + color UNDERLAY (mapped pen, dirty-flagged). Additive #core color-match + oracle; #ui byte-identical; 21 oracles green. Punch #5/#6/#10.

**Context:** UNIFY-4b (`626b2d7`) landed Freehand (plotter-side; capture WON over `#ui` pan-zoom; `#ui` byte-identical). UNIFY-4c
is the pen/color story (punch-list #5/#6/#10). SPARSE canvases only for now (the dense-import THROTTLE is the NEXT slice,
before UNIFY-5).

**▶ Scope:**
1. **Pen DATA model (folds UNIFY-3b):** `state.shapeColors: Map<shapeId,'#rgb'>` = per-shape DIGITAL color (plotter-side; `#core`
   pure). A **Design-tab color control**: select a shape -> pick its digital color (writes `shapeColors`).
2. **Toolpath nearest-pen mapping (digital->physical):** the physical pen palette (`state.plotColors`) + a NEAREST-pen match
   (color distance) maps each shape's digital color -> the pen that plots it; lives in the Toolpath tab (keeps PP-3c). ORACLE
   the nearest-match (8 digital colors -> 4 pens -> correct assignments).
3. **Color UNDERLAY:** an `<svg>` BENEATH `#design-canvas` (same viewBox), rendering the `#core` geometry
   (`coreShapeToPolyline`) with each shape in its MAPPED PHYSICAL pen color; the `#ui` sketcher draws the DOF/scaffold on the
   transparent canvas ON TOP. Host-side, `#ui` byte-identical. **Render the underlay ON CHANGE (dirty-flagged), NOT per RAF
   frame** — this is the substrate the dense THROTTLE builds on.
4. Split allowed (pen-data+UI / underlay) if big — FLAG.

**VERIFY LIVE:** Design tab -> draw/select a shape -> set its digital color -> the UNDERLAY shows it in the mapped PHYSICAL
pen color under the scaffold; changing the color updates the underlay; the mapped pen drives the toolpath/export. 3 apps
load; nearest-pen oracle + all oracles green standalone; `npm run test:shell` **12/12**; Studio/Shaper unregressed.

**GUARDRAILS:** plotter-side + host-side underlay (`#ui` byte-identical); pen is a PLOTTER concept (NOT pushed into `#core`).
0 net-new.

Append a WORK-LOG entry ending with exactly `=== UNIFY-4c (PEN MODEL + COLOR UNDERLAY) DONE — HOLD ===`. **Then pass the ball back to advisor and STOP.**

---
<!-- superseded (provenance) -->
## UNIFY-4b (DONE `626b2d7`): Freehand tool, PLOTTER-SIDE (capture won over #ui pan-zoom, #ui byte-identical). Stroke -> compact #core bezier -> gcode. FLAG: bezier click-select needs a later #ui pick slice.

**Context:** UNIFY-4a (`06e0f6b`) landed the merged Design shell (5->4). **PERF NOTE:** the probe found ~6716 `#core` shapes =
**0.7 FPS** (the `#ui` renderer rebuilds all paths+joints per frame) -> RENDER THROTTLING is REQUIRED before UNIFY-5 (dense
import). But HAND SKETCHES (few shapes) are FINE, so UNIFY-4b proceeds unaffected.

**▶ Scope — the plotter-side Freehand tool:**
1. A **Freehand ribbon button** in the Design tab. When active, a **plotter-side capture-phase listener** on `#design-canvas`:
   pointerdown/move collect raw WORLD points (`screenToWorld`, `#ui/coords.js`), `stopImmediatePropagation` so `#ui` pan-zoom
   doesn't fire; pointerup -> `fitCubic(points, tol)` -> per segment `makeBezier` (2 endpoint joints + c1/c2) -> add to the
   `#core` store. VERIFY the capture WINS over `#ui`'s svg listeners (the stopImmediatePropagation ordering); if fragile,
   fall back to a `#ui` FREEHAND switch-mode (ADDITIVE + output-unregressed) and FLAG.
2. **Selection reconcile:** toolpath targeting keys off shape ids (UNIFY-2 works); ensure a freehand bezier's `#core` id is
   selectable/targetable. Reconcile the plotter `selectedShapeIds` with the `#ui` selection as needed.
3. Node-move = rely on `#ui` joint-drag (no new tool); Scissors/Rotate/Scale stay DEFERRED.

**VERIFY LIVE:** Design tab -> Freehand -> draw a stroke -> COMPACT `#core` beziers (few control points, not a dense
polyline) -> target a toolpath -> Export = the curve as gcode (paste a snippet). 3 apps load; `npm run test:shell` **12/12**;
oracles green standalone; Studio/Shaper unregressed (if you touched `#ui`, prove output-unregressed).

**GUARDRAILS:** prefer PLOTTER-SIDE (no `#ui` edit); a `#ui` switch-add, if needed, is ADDITIVE + output-unregressed. 0 net-new.

Append a WORK-LOG entry ending with exactly `=== UNIFY-4b (FREEHAND TOOL) DONE — HOLD ===`. **Then pass the ball back to advisor and STOP.**

---
<!-- superseded (provenance) -->
## UNIFY-4a (DONE `06e0f6b`): merged Design shell 5->4 + canvas re-home + degree-field cleanup (GONE). PERF PROBE: 6716 shapes = 0.7 FPS -> throttling required before UNIFY-5.

**Blessing (UNIFY-4 plan `037f192` APPROVED) + decisions:** Freehand = PLOTTER-SIDE capture listener (stopImmediatePropagation
before `#ui` pan-zoom; fall back to a `#ui` switch-add if fragile) = UNIFY-4b. Scissors/Rotate/Scale = DEFERRED (fight the
solver; not MVP); Node-move reuses `#ui` joint-drag; node-delete later. Ellipse = drop/approx (track IMPORT-3). Two canvases
coexist this stage (Design on `#ui` `#design-canvas`; Fill/Toolpath/Export on the plotter `#canvasWrap` via UNIFY-2); UNIFY-6
converges. Sub-slicing: **4a (this) shell+probe -> 4b Freehand+selection -> 4c pen model+underlay.**

**▶ Scope — UNIFY-4a (ADDITIVE / dormant, no deletes):**
1. **STAGES 5->4:** drop the separate `draw` + `sketch` entries -> ONE `design` stage (drop "optional"). The router mounts the
   sketcher composition (today's `sketch-stage`) for `design`. KEEP the art store / render-art / svg-import->art / bake /
   interaction art tools DORMANT (retired in UNIFY-7) — so this stays additive + reviewable.
2. **Re-home the plotter canvas** (`#canvasWrap`) via a STARTUP mount so Fill/Toolpath/Export still render `#core` geometry
   (UNIFY-2) once Draw is no longer a tab.
3. **PERF PROBE (blessed):** frame time with ~6716 `#core` shapes loaded (Shaper's dense-import case) -> REPORT the number; it
   GATES whether 4b/4c need render throttling (static geometry -> the underlay once).
4. **Degree-field cleanup:** the DEFERRED Rotate/Scale tools' transform HUD (`#transformHud`, the "°" angle field) must NOT
   appear in the Design tab — VERIFY the user's stray top-left degree field is GONE.

**VERIFY LIVE:** 4-tab shell (Design/Fill/Toolpath/Export); Design shows the `#ui` sketcher (draw a line/circle -> solves); a
`#core` shape still flows to gcode via Fill/Toolpath/Export; NO stray degree field; PERF number reported. 3 apps load;
`npm run test:shell` **12/12**; `node --check` clean; oracles green standalone; Studio/Shaper unregressed.

**GUARDRAILS:** additive/dormant — NO deletes (art store stays until UNIFY-7); the sketcher composition is `#ui` byte-identical
(only STAGES + the router change). 0 net-new.

Append a WORK-LOG entry ending with exactly `=== UNIFY-4a (DESIGN SHELL 5->4 + PERF PROBE) DONE — HOLD ===`. **Then pass the ball back to advisor and STOP.**

---
<!-- superseded (provenance) -->
## UNIFY-4-plan (DONE `037f192` — BLESSED turn 315): merged Design-tab composition survey. CRUX: no `#ui` host tool-seam -> freehand plotter-side. 4a/b/c sub-slicing.

**Context:** the `#core` substrate is READY — UNIFY-2 (no-bake), UNIFY-3 (bezier shape), UNIFY-3-fit (fitter). UNIFY-4 is the
CENTERPIECE: merge Draw + Sketch into ONE "Design" tab (one canvas, one ribbon, Freehand->bezier, pen underlay; shell 5->4).
Biggest, most interaction-heavy slice -> map the composition + slice it before building.

**▶ Scope — SURVEY the composition mechanism + PROPOSE the sub-slicing (build nothing):**
1. **Canvas:** the merged tab uses the ONE `#ui` sketcher canvas (blessed). Confirm how the 4 stages share it (UNIFY-1b D/E).
2. **FREEHAND wiring:** how does a stroke capture -> `fitCubic` -> `makeBezier` -> `#core` beziers ON the sketcher canvas?
   **PLOTTER-SIDE** (compose on the sketcher, keep `#ui` minimal — "freehand where needed") vs a `#ui` tool-mode addition.
   Recommend + justify. (The explicit `#ui` bezier tool for ALL apps = the DEFERRED UNIFY-3-tool, separate.)
3. **Tool porting:** the plotter's unique tools — Node / Scissors / Rotate / Scale — operated on the ART store; they must
   operate on `#core` geometry now. Which port cleanly, which need work, which stay plotter-side? Ribbon DEDUP
   (line/rect/circle/arc/select = the `#core` sketch tools; #11/#13 lists — ellipse gap).
4. **Pen model + underlay (folds in UNIFY-3b):** where the per-shape DIGITAL color (`state.shapeColors`) + the Toolpath
   nearest-pen mapping + the Design-tab color UI + the pen UNDERLAY land in the sub-slicing.
5. **Stage collapse:** separate Draw + Sketch -> one Design stage (shell 5->4); what stays until UNIFY-7 (art-store retire).
6. **Propose UNIFY-4a/b/c...** each a reviewable, verifiable increment. Flag the dense-import PERF probe (due around here).
7. Write the composition survey + sub-slicing to WORK-LOG. PASS BACK for blessing. Build nothing.

Append a WORK-LOG entry ending with exactly `=== UNIFY-4 PLAN (MERGED-TAB COMPOSITION) — AWAIT BLESSING ===`. **Then pass the ball back to advisor and STOP.**

---
<!-- superseded (provenance) -->
## UNIFY-3-fit (DONE `aa06919`): the freehand->bezier FITTER (`#core/curve-fit.js`, pure Schneider) + oracle. Additive; 20 core oracles + shell-smoke green.

**Context:** UNIFY-3 (`5a7aacd`) added the `#core` bezier SHAPE. Now the FITTER: fit a freehand point sequence -> cubic bezier
segments, so a stroke becomes compact `#core` bezier shapes (not a dense polyline). Pure `#core` module; used by the plotter's
Freehand tool (UNIFY-4) and available to any app.

**▶ Scope:**
1. **`#core/curve-fit.js` `fitCubic(points, tolerance)` -> [{p0,c1,c2,p3}, ...]** — Schneider's algorithm: fit one cubic to
   the run; if max error > tolerance, split at the worst point + recurse; endpoint tangents. Pure, no DOM (~150 LOC). Each
   segment is ready to become a `#core` bezier via `makeBezier`.
2. **ORACLE** (`packages/core/tests/`): a straight run -> 1 segment reproducing the line; a smooth curve-like run -> a few
   segments WITHIN tolerance (assert EVERY input point is within `tolerance` of the fitted curve); ≤2-pt degenerate guarded.
   Green standalone.
3. Do NOT wire it to any tool yet (UNIFY-4's Freehand does that). Additive pure `#core`.

**VERIFY:** the fitter oracle + all 19 core oracles + shell-smoke **12/12** green STANDALONE; `node --check` clean;
Studio/Shaper unaffected (NEW file, no existing edits); 0 net-new.

**GUARDRAILS:** additive `#core` — a NEW file (`curve-fit.js`) + its oracle; NO existing `#core`/`#ui` edits.

Append a WORK-LOG entry ending with exactly `=== UNIFY-3-fit (FREEHAND->BEZIER FITTER) DONE — HOLD ===`. **Then pass the ball back to advisor and STOP.**

---
<!-- superseded (provenance) -->
## UNIFY-3 (DONE `5a7aacd`): first-class cubic BEZIER shape in `#core` (shared, Branch A, additive). Shape kind + renderer + flatten + oracle; 19 oracles + shell-smoke green; Studio/Shaper output-unregressed.

**Context:** UNIFY-2 (`0515a26`) proved the no-bake path. UNIFY-3 = the SHARED bezier (blessed Branch A) — the FIRST migration
slice that EDITS `#core` (additively). This slice = the `#core` bezier SHAPE only (represent + render + flatten). The `#ui`
bezier TOOL (all apps) = UNIFY-3-tool; the Schneider freehand FITTER (`#core/curve-fit.js`) = UNIFY-3-fit.

**Guardrail (SHIFTED — blessed): ADDITIVE + Studio/Shaper OUTPUT-unregressed.** We now edit `packages/#core`(+`#ui`) — but
ADDITIVELY: a NEW shape kind; existing shapes/constraints/solver/tests UNCHANGED. PROVE it: shell-smoke 12/12; the `#core`
oracle 12/12; existing Studio/Shaper geometry renders/exports IDENTICALLY (no existing shape's behavior moved).

**▶ Scope — the `#core` bezier shape:**
1. Add a **bezier/cubic shape kind** to the `#core` shape model (`packages/core/shapes.js` + the shape-type switch). A cubic =
   start joint + end joint + 2 control points. RECOMMEND (MVP): endpoints are JOINTS (so a bezier connects to other geometry),
   the 2 control points are shape DATA, NOT solver-constrained yet. MATCH `#core`'s conventions; if the data model gets
   complicated, FLAG before pressing on.
2. **Renderer case** in `#ui/svg-renderer.js` — draw the cubic (`<path d="M..C..">`) via the same `--sk-*` geometry vars.
3. **`coreShapeToPolyline` bezier case** (`#core/core-shape-to-polyline.js`) — flatten the cubic to a polyline (~16-step de
   Casteljau, matching parsePathSubpaths' C/Q) so the plotter pipeline plots beziers.
4. **ORACLE** (`packages/core/tests/`): a known cubic -> a correct `d`; `coreShapeToPolyline` -> the expected sampled polyline
   (vertex count / bounds). Wire in; green standalone.

**VERIFY:** the new bezier oracle + all existing oracles (12 core + 6 plot) green STANDALONE; shell-smoke 12/12; `node --check`
clean; **Studio + Shaper OUTPUT-unregressed** (existing geometry renders/exports identically — describe the proof); 3 apps
load; 0 net-new.

**GUARDRAILS:** ADDITIVE to `#core`/`#ui` — a new shape kind + renderer case; NO existing shape/constraint/solver behavior
changed. NO tool, NO fitter this slice.

Append a WORK-LOG entry ending with exactly `=== UNIFY-3 (#core BEZIER SHAPE, shared) DONE — HOLD ===`. **Then pass the ball back to advisor and STOP.**

---
<!-- superseded (provenance) -->
## UNIFY-2 (DONE `0515a26`): toolpaths target `#core` geometry DIRECTLY — proved `#core` shape -> toolpath -> gcode with NO bake (artLayers unchanged). ADDITIVE.

**Blessing (UNIFY-1b plan `bad6a10`/`44a9bca` APPROVED) + decisions:**
- **Bezier = Branch A** (shared `#core`/`#ui` bezier, ALL apps; guardrail -> ADDITIVE + Studio/Shaper OUTPUT-unregressed via
  shell-smoke + a Shaper-import proof). Lands at UNIFY-3.
- **One shared `#ui` canvas** for the 4 stages; converge pan/zoom on `#ui` `state.view` (retire `viewport.js`) = UNIFY-6.
- **Fitter in `#core/curve-fit.js`** (reusable). **Accept ellipse / S-T-A import limits now**, track as IMPORT-3 debt.
- **Perf probe (~6716 shapes) BEFORE the merge/delete** (UNIFY-4/7). **Pen model** resolved (Design=digital per-shape color;
  Toolpath=physical palette + nearest-pen map) = UNIFY-3b.
- **SEQUENCE:** UNIFY-2 (this) -> 3 bezier(shared) -> 3b pen -> 4 merged Design tab (5->4) -> 5 import->#core+colors ->
  6 pan/zoom -> 7 RETIRE art store+bake (big DELETE, perf-gated) -> 8 perf(conditional). The destructive delete is LAST.

**▶ Scope — UNIFY-2 (ADDITIVE, no deletes):**
1. Make a toolpath TARGET `#core` SKETCH geometry directly: `collectToolpathShapes` / `resolveToolpathShapes` also read the
   sketcher's `controller.state.shapes`, and `coreShapeToPolyline` (PP-7b) resolves them at collect-time -> the pipeline. A
   `#core` shape flows shape -> toolpath -> optimize -> gcode with **NO bake**.
2. Keep it ADDITIVE — do NOT remove the art store, the Bake-to-Draw button, or the separate stages (that's UNIFY-7). Both
   targeting paths (art + `#core`) COEXIST this slice.
3. REUSE `coreShapeToPolyline`, the vpype pipeline, export, the toolpath/target model.

**VERIFY LIVE (no-bake proof):** serve; Sketch/Design -> draw a `#core` line/circle -> target a toolpath at it (NO
Bake-to-Draw) -> the Toolpath overlay optimizes it -> Export -> the gcode contains the `#core` geometry. PASTE a snippet.
Studio/Shaper UNREGRESSED; 3 apps load; `npm run test:shell` **12/12**; `node --check` clean; all plot oracles green standalone.

**GUARDRAILS:** penplotter-only additive (READS `#core`; NO `#core`/`#ui` edits this slice — bezier's `#core` add is UNIFY-3).
0 net-new.

Append a WORK-LOG entry ending with exactly `=== UNIFY-2 (TOOLPATHS TARGET #core DIRECTLY, NO BAKE) DONE — HOLD ===`. **Then pass the ball back to advisor and STOP.**

---
<!-- superseded (provenance) -->
## UNIFY-1b (DONE turn 306, `bad6a10`/`44a9bca` — plan BLESSED turn 307): probe `#core` bezier support + propose the migration to ONE "Design" tab.

**Context — the model MERGED (user-driven; supersedes UNIFY-1's two-tab framing; REUSE your turn-304 wiring map):**
- **Draw + Sketch -> ONE "Design" tab**: one canvas, one ribbon with tool groups (freehand | precise line/rect/circle/arc |
  constraints), one `#core` geometry store. Shell **5 -> 4**: `Design -> Fill -> Toolpath -> Export`. **NO bake seam.**
- **Freehand -> a `#core` BEZIER shape** (curve-fitted on stroke-end; compact -> solver-light; non-constrainable for now).
- **Import -> `#core`** (constrainable), SVG colors preserved as a plotter-side PEN layer.
- **Pen-color UNDERLAY** on the Design canvas + CONTEXTUAL constraint scaffold; `#ui` BYTE-IDENTICAL (plotter-side
  composition, NOT a `#ui` change — confirm).
- **Consistent pan/zoom** across all plotter canvases.

**▶ Scope — SURVEY + PROPOSE, build nothing:**
1. **THE PIVOTAL PROBE — does `#core` hold BEZIER/cubic geometry as a FIRST-CLASS editable shape** (in the store + rendered +
   selectable + a create tool), or ONLY as a static `path` import blob? Check the shape model, `svg-renderer`, the `#ui` tool
   ribbon (is there a curve/spline tool?). This decides REUSE vs. a real `#core` bezier-shape addition — scope BOTH branches.
2. **Merged-tab composition (plotter-side, `#ui` byte-identical):** mount the shared sketcher + layer the freehand tool +
   pen-color underlay + contextual scaffold; ONE ribbon grouping draw/precise/constraint tools. Confirm no `#ui` edit needed.
3. **The freehand->bezier fitter** (Schneider, pure ~150 LOC): where it lives, tolerance, output shape.
4. **Migration slicing (UNIFY-2..):** what two-store code (art store, render-art, the separate Draw stage, the bake seam) is
   REUSED vs REMOVED; import routing to `#core`+pen-layer; pan/zoom unification; the color underlay + contextual scaffold.
5. **Flag risks:** the `#core`-bezier answer (biggest); solver perf on many imported shapes; `#core`/`#ui` byte-identical.
6. Write the survey + slicing to WORK-LOG. PASS BACK for blessing. Build nothing.

Append a WORK-LOG entry ending with exactly `=== UNIFY-1b PLAN (MERGED-TAB MIGRATION) — AWAIT BLESSING ===`. **Then pass the ball back to advisor and STOP.**

---
<!-- superseded (provenance) -->
## UNIFY-1 (DONE turn 304, two-tab framing SUPERSEDED by the merge): survey the two-store geometry model + propose the migration to a UNIFIED `#core` geometry store. Plan only — build NOTHING.

**Context (user-driven redesign, supersedes the polish queue):** the core epic shipped a TWO-store model (freeform art store +
`#core` sketch + the `coreShapeToPolyline` bake seam). The USER wants to UNIFY. Their decision + clarifications:
- **Import SVG -> `#core` sketch -> CONSTRAINABLE** (reuse Shaper's `importSvgToSketch` / `#core/svg-import`). Today import
  lands in the freeform art store -> not in Sketch, not constrainable. THE main change; preserve the SVG's colors as the pen-layer.
- **Freehand tool -> NON-constrainable** (ACCEPTED — the ONLY non-constrainable geometry; dense polyline, 0 constraints ->
  solver stays light). Recommend how freehand is stored (freeform kind vs a `#core` static-polyline kind) + justify.
- **Pen-color UNDERLAY in the Sketch tab** ("add a layer of colors below"): stack a pen-color layer BENEATH the shared
  Design canvas so Sketch shows pen-colored art + the constraint scaffold (joints/dims) on top. NO DOF-blue recolor. GOAL:
  host-side composition, `#ui` BYTE-IDENTICAL (confirm, or flag if `#ui` must change).
- **Remove "Bake to Draw" + "optional"** — geometry IS the sketch; toolpaths target the `#core` geometry DIRECTLY
  (`coreShapeToPolyline` at collect-time, no bake button).
- Model: ONE `#core` geometry store; a per-shape PEN attribute as a PLOTTER-SIDE layer (do NOT push plotter concepts into
  shared `#core`).

**▶ Scope — SURVEY + PROPOSE, build nothing:**
1. **Map the current two-store wiring:** freeform art store (`state.artLayers` + render-art + interaction + svg-import->art)
   vs the `#core` sketch (sketch-stage) + the `coreShapeToPolyline` bake. What produces/consumes each; where import lands;
   how toolpaths target art today.
2. **Propose the unified model + migration slicing (UNIFY-2..):** where geometry lives; how the pen attribute attaches
   (shapeId->pen side-table, plotter-side); import->`#core` preserving colors; freehand as non-constrainable (+ the
   solver-perf mitigation: 0 constraints); the pen-color underlay (host-side?); removing bake/optional; toolpaths targeting
   `#core` geometry directly. Say how much completed two-store code is REUSED vs REPLACED.
3. **Flag risks:** solver perf on dense imports (Shaper does 6716 — probe if needed); `#core`/`#ui` byte-identical (underlay
   + import must not regress Studio/Shaper); the underlay aligning with the geometry.
4. Write the survey + migration slicing to WORK-LOG. PASS BACK for blessing. Build nothing.

Append a WORK-LOG entry ending with exactly `=== UNIFY-1 PLAN (GEOMETRY-UNIFY MIGRATION) — AWAIT BLESSING ===`. **Then pass the ball back to advisor and STOP.**

---
<!-- superseded / resolved tasks (kept for provenance) -->
## PP-8 (RESOLVED — DEFERRED, option D `9f1d819`): reconcile `#core/plot` `from-path` onto pure `parsePathSubpaths` — north-star-#2 path-parser duplication.
Worker assess found the RISKY case: `parsePathSubpaths` is a PARTIAL sampler (M/L/H/V/C/Q; S/T/A degrade to a chord),
while `from-path` (getTotalLength) samples ALL commands faithfully and is the LIVE gcode flatten. A swap regresses S/T/A
curves; full closure means extending the shared parser (touches Shaper's importer). **Advisor decision: DEFER (option D)** —
declare the boundary as TRACKED DEBT, revisit under IMPORT-3 (not worth a Shaper-affecting slice now; the UNIFY redesign
may reshape path handling). No code changed; Shaper byte-identical.

**Context:** the PENPLOTTER CORE EPIC (PP-1..PP-7) is COMPLETE + reviewed. User opted to continue with POLISH. First: the
tracked north-star-#2 debt. `#core/plot/polylines/from-path.js` samples an SVG path via `getTotalLength` (DOM-guarded ->
returns null in Node), DUPLICATING `#core`'s pure `parsePathSubpaths` (`#core/svg-import.js`, from GRIEVANCE-2). Two path
handlers = one capability, two homes (#2 violation). Reconcile onto ONE — the PURE parser (so `#core/plot` path->polyline
also works in Node, not only the browser).

**▶ Scope — assess, then act (complete the clean case; GATE the risky one):**
1. **Assess `parsePathSubpaths`:** does it SAMPLE curves (C/Q/S/T/A) into points, or only line segments (M/L/H/V/Z)?
   - **Clean case — it samples curves:** route `from-path.js` onto `parsePathSubpaths` (pure, no DOM), drop the
     `getTotalLength` path. DO IT this turn + oracle. `#core/plot` path->polyline now works in Node.
   - **Risky case — line-segments only (a swap would LOSE curve fidelity), OR extending `parsePathSubpaths` would touch
     Shaper's SVG-import behavior:** do NOT unilaterally swap or regress Shaper. STOP, write the exact trade-off + a
     proposal (extend the pure parser as the one home vs. keep two with a declared boundary), and pass back for blessing.
2. If you act: **`parsePathSubpaths` must NOT change Shaper's SVG-import output** (byte-identical; existing call sites
   unchanged). The reconciliation removes the DUPLICATE, it does not regress the shared parser.
3. **ORACLE:** a curved path (e.g. `M0,0 C10,0 10,10 0,10`) -> `from-path`/`coreShapeToPolyline` yields the expected sampled
   polyline IN NODE (the win: no DOM dependency); existing path cases still pass.

**VERIFY:** new/updated oracle + all plot oracles green STANDALONE; Shaper SVG-import UNREGRESSED (import a path-heavy SVG
-> same result); `npm run test:shell` **12/12**; `node --check` clean; 0 net-new.

Append a WORK-LOG entry ending with exactly `=== PP-8 (from-path -> parsePathSubpaths RECONCILE) DONE — HOLD ===` (or
`=== PP-8 PLAN (PATH RECONCILE) — AWAIT BLESSING ===` if you hit the risky case). **Then pass the ball back to advisor and STOP.**

---
<!-- superseded task (kept for provenance) -->
## PP-7b (DONE `c2b3ead`): the `coreShapeToPolyline` SEAM — a solved `#core` sketch bakes into plotter art polylines, CLOSED the epic.

**Context:** PP-7a (`7ebd215`) mounted the shared Design tab (Sketch stage), `#core`/`#ui` byte-identical. PP-7b is the FINAL
seam: let SOLVED `#core` sketch geometry flow into the plotter pipeline as polylines — realizing INTEGRATION.md's "#core
geometry + art meet at the bake seam as polylines." Cleanest minimal seam: bake the solved sketch -> a plotter ART layer,
then the existing Draw/Fill/Toolpath/Export pipeline carries it unchanged (and the DOF->pen color switch happens at the bake).

**▶ Scope:**
1. **`coreShapeToPolyline(shape, joints)`** — a NEW ADDITIVE `#core` module (app-agnostic: a `#core` shape -> a polyline).
   Resolve the shape's joints; line -> `[[x1,y1],[x2,y2]]`; arc/circle -> sampled via `#core`'s EXISTING arc sampler
   (reuse loop-geometry / `sampleArc` — do NOT hand-roll a 2nd sampler, north star #2). PURE, no DOM. **Additive `#core`**
   (a NEW file; Studio/Shaper stay byte-identical — verify). ORACLE (a `#core` line -> its endpoints; an arc -> sampled
   polyline with expected vertex count / bounds).
2. **A "Bake to Draw" action** in the Sketch stage: `engine.solve` the active sketch, convert each solved `#core` shape via
   `coreShapeToPolyline` -> plotter polyline shapes -> a NEW art LAYER (`state.artLayers`) -> switch to Draw. The sketch
   geometry is now ART (pen-color world); the existing pipeline handles it.
3. The `#core` sketch stays the SOURCE (re-baking re-derives; the art layer is the baked projection).

**VERIFY LIVE (closes the epic — `#core` geometry -> G-code):** serve; Sketch tab -> draw a constrained line + circle, solve
-> "Bake to Draw" -> the geometry appears as a plotter art layer in Draw -> target a toolpath at it -> Export -> the gcode
contains the SKETCH geometry (came through `coreShapeToPolyline` -> the pipeline). PASTE a gcode snippet. SketchStudio +
Shaper Design UNREGRESSED (`#core` additive-only). 3 apps load; the new `#core` oracle + all plot oracles green STANDALONE;
`npm run test:shell` **12/12**; `node --check` clean.

**GUARDRAILS:** `#core` gets ONE new ADDITIVE file (`coreShapeToPolyline`) + its oracle — NO existing `#core`/`#ui` file
modified (byte-identical). The rest is penplotter-only. 0 net-new.

Append a WORK-LOG entry (the `coreShapeToPolyline` adapter + oracle + the "Bake to Draw" action + the end-to-end
`#core`-geometry->gcode verify) ending with exactly
`=== PP-7b (coreShapeToPolyline SEAM) DONE — PP-7 + THE PENPLOTTER EPIC COMPLETE — HOLD ===`. **Then pass the ball back to advisor and STOP.**

> **DONE this cycle:** GRIEVANCE-1 `fcafcc6` · GRIEVANCE-2 `37163db` · PP-1 `de23e01` · PP-2a (vpype pipeline -> #core/plot) `e32d913`.
>
> **PENPLOTTER EPIC (in flight)** — fold the pen-plotter in as app #3 (north star #6). Design: `penplotter/INTEGRATION.md`.
> Ahead of VCARVE-4 (human redirect). ONE slice per turn, reviewed before the next:
> - **PP-2 (port the pure engines -> `#core/plot/`)**, split load-safe:
>   - **PP-2a** vpype PIPELINE + oracle + declared DDCS profile. DONE `e32d913`.
>   - **PP-2b** fills — OFFSET GATE plan BLESSED `fff4927` (Option B: Clipper as the robust engine, keep polygon-offset). Port split:
>     - **PP-2b-1** Clipper -> `#core/plot/` (pristine vendor + clip.js wrapper, Node-load shim) + oracle + boundary decl. DONE `09c72e9`.
>     - **PP-2b-2** fills registry SHAPE + hatch + concentric archetypes + expandLayerWithFill + oracle. DONE `11c372b`.
>     - **PP-2b-3** remaining fills (crosshatch, zigzag, stipple, dots) — registry now 6, COMPLETE. DONE `bb71940`.
>       (NB: broke plot-fills.test.js's stale `length===2` assert; masked by the runner halting at ai-vision → PP-2b-3-fix.)
>     - **PP-2b-3-fix** stale plot-fills.test.js assertion -> assert-by-id + plot oracles verified standalone. DONE.
>   - **PP-2c** outlines -> `#core/plot/outlines/` (mirror fills) + oracle. DONE `d8c7c59`. **PP-2 COMPLETE** — #core/plot = pipeline+clip+fills+outlines, all oracle-pinned.
> - **PP-3** Draw stage — DONE (`8da8e56` / `bf1b247` / `c887c47`). **PP-3 COMPLETE** — the plotter's freeform canvas draws live.
>   NB (PP-3c finding): pens attach to TOOLPATHS (`tp.plotColorId`), NOT layers — INTEGRATION.md seam corrected accordingly.
> - **PP-4 DOWNSTREAM plan BLESSED `111f787`** — no separate art bake; the per-toolpath recompute IS the seam; `coreShapeToPolyline`
>   (PP-7) is the only new geometry. `autoRecalc` = the art<->machine recompute gate. Sequence:
>   - **PP-4** Toolpath stage — PP-4a `3e2090e` + PP-4b `0b44d68`. **PP-4 COMPLETE** (ops panel + pen-assign + target-editing).
>     (PP-4b left a 7-line active-layer-panel no-op stub -> PP-5 replaces it with the real registry-driven Fill panel.)
>   - **PP-5** Fill stage — registry-driven panel (controls GENERATED from `params`); 2nd tab over the same toolpaths. DONE `f6c9e71`.
>   - **PP-6** Export stage — real DDCS gcode + pen-width sim + settings. DONE `82e05c4`. **PIPELINE END-TO-END: Draw->Fill->Toolpath->Export.**
>   - **PP-7** Sketch stage: PP-7a `7ebd215` (shared Design tab, #core/#ui byte-identical) + PP-7b `c2b3ead` (coreShapeToPolyline seam).
> - **★ PENPLOTTER CORE EPIC (PP-1..PP-7) COMPLETE + reviewed.** app #3 folded in: #core/plot brain (oracle-pinned) · 5-stage shell ·
>   the shared Design tab as the optional Sketch stage · the bake seam. Draw->Fill->Toolpath->Export->DDCS G-code, end-to-end.
> - **PP-8** path-parser dedup -> RESOLVED: DEFERRED (option D, plan `9f1d819`) — a swap regresses S/T/A or touches Shaper's
>   shared importer; tracked debt, revisit under IMPORT-3.
> - **★ UNIFY redesign (user-driven — supersedes polish). REFINED to a MERGE:** Draw + Sketch -> ONE "Design" tab (freehand +
>   precise + constraint tools, one canvas, ONE `#core` geometry store, pen-colors). Shell 5->4: `Design->Fill->Toolpath->Export`.
>   NO bake. Freehand = a `#core` BEZIER (curve-fitted, compact). Import->`#core` constrainable, colors as a pen-layer. Pen
>   underlay + contextual scaffold, `#ui` byte-identical. Consistent pan/zoom. (Full punch list #1-#9 above.)
>   - **UNIFY-1** two-tab survey — SUPERSEDED by the merge (turn 304). **UNIFY-1b** merged-migration survey — DONE + BLESSED (`bad6a10`).
>     Verdict: `#core` has NO bezier -> add it SHARED (Branch A); pen model resolved (Design=digital / Toolpath=physical+nearest);
>     one `#ui` canvas; fitter in `#core/curve-fit.js`; import limits tracked; perf-probe before the delete.
>   - **UNIFY-2** toolpaths target `#core` directly (NO bake). ADDITIVE. DONE `0515a26`.
>   - **UNIFY-3** SHARED bezier `#core` SHAPE — DONE `5a7aacd` (additive; 19 oracles + shell-smoke green; output-unregressed).
>   - **UNIFY-3-fit** freehand->bezier fitter (`#core/curve-fit.js`, pure) + oracle. DONE `aa06919` (20 core oracles green).
>   - **UNIFY-4-plan** merged-tab composition — DONE + BLESSED `037f192` (crux: no `#ui` tool seam -> freehand plotter-side).
>   - **UNIFY-4a** Design shell 5->4 + canvas re-home + degree-field GONE. DONE `06e0f6b`. ⚠ PERF PROBE: 6716 shapes = **0.7 FPS**.
>   - **UNIFY-4b** Freehand — plotter-side capture WON over #ui pan-zoom; stroke -> compact #core bezier -> gcode. DONE `626b2d7`.
>     (FLAG: bezier click-select needs a later #ui pick slice; targetable by id/mirror meanwhile.)
>   - **UNIFY-4c** pen model (digital shapeColors) + color UNDERLAY (mapped pen, dirty-flagged). DONE `011413c`. Punch #5/#6/#10.
>   - **UNIFY-throttle** static-skip + solve-gate (additive #ui) -> 0.7->**60 FPS**; MARKED-STATIC fixed render parity (#14). DONE `1467078`.
>   - **UNIFY-5** import SVG -> #core (constrainable, colored, dense-static 60fps). DONE `07be65a`. Punch #2/#4.
>   - **UNIFY-6** pan/zoom converge (#9) + import-pen-display flip. DONE `bfa6675` (also wired the never-wired wheel-zoom). Plotter-side.
>   - **UNIFY-7** retired art store + Bake-to-Draw (punch #3); ~427 LOC. DONE `ccd9e7c` (SAFE SUBSET). Discovered the circle-export bug.
>   - **CIRCLE-FIX** DONE `4896845` — root cause was douglas-peucker float cancellation on a closed loop (NOT linemerge); surgical
>     closed-loop guard; byte-exact golden held; a circle now exports 32 moves (was 1). 22/22 oracles.
> - **★★ THE UNIFY REDESIGN IS FUNCTIONALLY COMPLETE** (punch #1-#10,#12-#14 done; #11 deferred). User picked DEFERRED POLISH:
>   - **UNIFY-3-tool** shared `#ui` bezier PEN tool (all apps) — #12 COMPLETE. DONE `cc2734d`.
>   - **COLOR-MIX-1** pure mix function (linear-RGB best-pair, model blessed). DONE `c2cb596`.
>   - **COLOR-MIX-2** fill-layering (per-pen cross-hatch at density ∝ weight) + oracle; then **COLOR-MIX-3** pipeline+UI wiring. <- THIS TASK
>   - user's polish queue after: bulk fill-edit · cloud palette · bezier control-handle edit
>   - **UNIFY-7b** finish the art-code delete (dormant interaction/svg-import/tools/state art bits; keep pan+toolpath) ·
>     **UNIFY-8** perf(cond., likely moot) · later-optional: retire plotter canvas · #ui bezier tool · bezier click-select · control-handle edit
>   - tracked #core: solve() O(joints)/call (heavy constraint-edit of dense scenes) · bezier control-handle editing · #core ellipse
>   - deferred/tracked: Scissors/Rotate/Scale (fight solver) · #core ellipse · **UNIFY-3-tool** #ui bezier tool (all apps)
>   - **UNIFY-4** merged Design tab (ribbon dedup, shell 5->4) · **UNIFY-5** import->`#core`+colors · **UNIFY-6** pan/zoom converge
>   - **UNIFY-7** RETIRE art store + bake (big DELETE, perf-gated) · **UNIFY-8** perf (conditional)
> - Deferred polish: PP-9 bulk fill-edit · PP-10 cloud palette. Parked: VCARVE-4/5 · Shaper grievances.
>   - **PP-6** Export stage — `export.js` (per-pen gcode+zip) + pen-width sim + `settings` (un-stub `syncDocFields`).
>   - **PP-7** Sketch stage — shared `#core`/`#ui` Design tab + the `coreShapeToPolyline` seam (a toolpath targets #core geometry).
> - Cloud (palette save/load) = OUTSIDE the epic; stays stubbed unless requested.
>
> **Tracked debt (north star #2):** `#core/plot` `fromPath` (path->polyline via getTotalLength) DUPLICATES `#core` svg-import
> `parsePathSubpaths` — reconcile onto the pure parser in a later slice (flagged in PP-2a).
> **Backlog (after the epic):** further Design grievances TBD · VCARVE-4 gated vcarve export · VCARVE-5.

> **WHY vcarve at all:** the Shaper Origin / Studio have NO native v-carve (only flat-bottom cuts). Our offset-stack
> EMULATES one using primitives the Origin DOES support — a stack of `online` cuts, each a contour offset inward + a
> deeper `cutDepth`; the cumulative passes cut the V-groove. A feature Shaper Studio LACKS → its own tab + the hack is the
> point (not asking the Origin to v-carve; precomputing a toolpath it can run).
>
> **VCARVE arc:** VCARVE-2 offset-stack core (THIS, UX-agnostic) → **VCARVE-3 a DEDICATED VCARVE TAB** (user call: vcarve is
> a post-processing/tuning transform, NOT a Prepare cut-mode — its own space to edit + fine-tune): region select · the
> V-bit record (angle) + depth-step/max-depth controls · a live contour-stack PREVIEW (depth-shaded) · recompute. Two
> halves: ① ADAPT the imported SVG (clean → a usable boundary) ② HACK (the offset-stack → V-groove contours). **Placed
> BEFORE Prepare** (user call): Explore · Design · **Vcarve** · Prepare · Sim/Export — vcarve is UPSTREAM (adapts art →
> contours that Prepare then treats as `online` cuts). Plan the tab first (a meaty UI). → VCARVE-4 the
> GATED inverted export (host boundary poly → `online` + per-path `cutDepth` stack; standard + SketchStudio byte-identical)
> → VCARVE-5+ the TRUE medial axis · holes/islands vcarve · flat-tip bits. **v1 = the offset-stack APPROXIMATION** (discrete
> depth steps; the true smooth axis is VCARVE-5) — a real usable V-carve. The CORE (VCARVE-2) is the same regardless of UX.

> **Deferred (return after vcarve):** IMPORT-3 (SVG breadth full path/transforms/`<g>` + DXF) · **HOME-1** (`/` IS Studio
> in-place [rewrite+`<base>` or move-to-root], Shaper from inside — the deploy works for now) · hidden-sketch EXCLUDE ·
> sketch→`<g>` · widen islands · group tree-node · GRID-1 (staged) · SP1i · JOINTS.

---

## STAGED — GRID-1 (quick win — dispatch after the sketch foundation): declared `GRID_MODE` setting (grid / off / draft-points) + the Shaper settings-modal control. Shared, SketchStudio byte-identical.

User wants a **visible-grid setting in the Shaper settings modal**: **grid vs no grid vs draft points**. DECLARE it as a
shared `GRID_MODE` enum (like `DOC_UNIT`) read by the canvas grid renderer; surface a 3-way control in the Shaper modal,
GATED so SketchStudio's panel stays byte-identical. Default = the CURRENT grid → SketchStudio unchanged.

**▶ GRID-1 scope:**
1. **DECLARE the setting** — `settings-manager.js`: add `GRID_MODE`, enum `'lines' | 'off' | 'points'`, **default
   `'lines'`** (= today's grid). Same pattern as `DOC_UNIT` (pick persist: a genuine display preference → persist is
   fine; default 'lines' keeps SketchStudio's render identical regardless).
2. **Grid renderer reads it** — find where the grid is drawn (svg-renderer / a grid helper). `'lines'` → the current
   grid lines (UNCHANGED bytes for the default); `'off'` → no grid; `'points'` → **draft points = a small DOT at each
   grid intersection** (a light dot-grid, not full lines). *If "draft points" maps to an existing notion in the code,
   FLAG it; else implement the dot-grid.*
3. **Shaper settings-modal control** — `style-panel.js`: add a `showGrid`-GATED 3-way control (select/segmented: **Grid /
   None / Draft points**) bound to `GRID_MODE` — gated exactly like `showDocUnit` so SketchStudio's modal control count
   stays byte-identical. Shaper passes `showGrid:true`.
4. **SketchStudio byte-identical** — default `'lines'` + the control gated off there → its canvas + 16-control panel
   unchanged.

**VERIFY (live + tight):** Shaper settings modal shows the **Grid / None / Draft points** control; switching updates the
canvas grid LIVE (lines / nothing / dots); drawing + snapping still work. SketchStudio UNREGRESSED (`npm run test:shell`
12/12, 16-control panel, grid lines render as before); baseline ⊆ the 8, 0 net-new; `node --check` clean; both apps load.

Append a WORK-LOG entry ending with exactly `=== GRID-1 (GRID_MODE SETTING + DRAFT-POINTS) DONE — HOLD ===`. **Then STOP.**

**Backlog (minor, from SP1j-4):** the Sim/Export status counts ASSIGNED entries; the file silently drops live-orphaned
ones (export resolves vs live `findLoops`) → a cosmetic over-count. Future refine: count EMITTED elements.

> **Sequencing:** SP1 EXPORT ENGINE ✅ LIVE (j1/j2/j4; j3a datum+groups ✅) → **SKETCH SYSTEM arc (NOW)** — the Design
> panel becomes a Fusion-style sketch tree; an additive overlay over the global solver. PLAN ✅ → S-1a container ✅ →
> **SKETCH SYSTEM + ISLANDS arc ✅ COMPLETE**. → **IMPORT + VCARVING arc (user-picked, high)**: IMPORT-1 plan ✅ →
> VCARVE-2 core ✅ → VCARVE-3 tab plan ✅ → VCARVE-3a shell mode + skeleton ✅ → **VCARVE-3b live workspace (V-bit + region +
> depth-shaded preview, building)** → VCARVE-4 gated export → -5 true medial axis. Deferred: IMPORT-3 breadth+DXF · HOME-1
> root-serving · hidden-exclude · sketch→`<g>` · widen islands · group tree-node · GRID-1 · SP1i · JOINTS.
>
> **SWITCH-2 (queued, do right after IMPORT-2):** `packages/ui/app-switcher.js` `APPS` hrefs `/apps/<id>/` → **relative
> `../<id>/`** (both apps are siblings under `apps/` → resolves from ANY server root AND deployed; fixes the local-dev
> switcher the user hit). Verify: switch both ways from a non-repo-root local server; shell-smoke 12/12.

> **⚑ DEPLOY PLAN (user-approved "plan it"; production branch = `main` [confirmed]). Advisor-executed; HARD STOP for the
> user's GO before the push (outward-facing).** ① SETTLE → land IMPORT-2 + SWITCH-2 (bless both) → carve-out = a coherent
> checkpoint (sketch system + switcher + SVG-import foundation), worker IDLE, tree CLEAN. ② PRE-FLIGHT gate (all pass):
> tree clean · `shell-smoke` 12/12 · oracles green · both apps load · `node --check` · `carve-out`=`main`+N clean
> fast-forward (re-verify no divergence). ③ DEPLOY ⟨user GO⟩: `git checkout main && git merge --ff-only carve-out &&
> git push origin main && git checkout carve-out` → CF auto-deploys. ④ VERIFY live: `/`=Studio · `/shaper`=Shaper ·
> switcher both ways · sketches+import. ⮌ ROLLBACK: CF dashboard → prior deployment (or reset `main`). NOTE: do the git
> surgery ONLY when the tree is settled (never mid-worker-task with uncommitted files).
> (folded in: an island = a group) + export threading. Then: GRID-1 (staged quick win) · SVG/DXF import + VCARVING
> (high) · JOINTS (lower). Specs: [[project_grouping_sketches_layers]] · [[reference-shaper-svg-encoding]].

> **SP1j EXPORT — now a real export ENGINE (user domain-dump → [[reference-shaper-svg-encoding]]):** emit raw
> machine-ready SVG, not Studio's surface — the `xmlns:shaper` header + width/height (mm/in) + viewBox 1:1; per-element
> `shaper:cutType` (EXPLICIT, wins over color) / `cutDepth` (unit-suffixed — our `units.format({unit:true})`) /
> `cutOffset` / `toolDia`; reuse `offsetPolygon`/`openPolygon` for real toolpaths. The UNSURFACED edge over Studio:
> `<g>` group-inheritance (batch params), `fill-rule="evenodd"` islands, a red 90° right-triangle (#FF0000) DATUM
> anchor ("Drop Datum"). COLOR caveat: official fill-hex vs a user stroke-list conflict → lean on the `cutType` ATTR;
> verify hex on a real Origin.

> **BACKLOG — JOINTS arc (user-flagged):** the export engine precomputes finger/box/mortise joints (the on-tool joint
> apps are closed): toolpath from bit Ø + **dogbone/T-bone overcuts** at inside corners + a global **Fit-Tolerance**
> slider (±mm, male/female scaling). CORE/shared. [[reference-shaper-svg-encoding]]

> **BACKLOG — VCARVING tab (user-flagged; HIGH PRIORITY — strong differentiator, Studio does it poorly):**
> **PRIORITY: HIGH, PAIRED with the SVG/DXF-import arc** (user: v-carve assets are usually imported SVG/DXF, so import
> is ON PAR with vcarve) — and **ABOVE JOINTS** (user: joints are lower priority). **CORE PROCESSING (user clarified):
> imported assets are closed OUTLINES (text/logo REGIONS) with NO centerline → the vcarve space must EXTRACT the MEDIAL
> AXIS (skeleton) from them; distance-to-boundary at each skeleton point = the depth (`dist ÷ tan(half-angle)`).**
> Medial axis of regions-with-holes (letters have counters) = the hard geometry; our loop-finder already yields the
> closed regions, the medial axis is the layer on top. A NEW Shaper mode/tab
> **"VCarving"** — TEXT (font → vector outlines) + vector input → a **V-carve toolpath** with a V-bit (angle + max
> depth) where the carve DEPTH VARIES with local shape WIDTH (medial-axis / Voronoi: deeper where wider; the bit
> traces the medial axis → crisp variable-width lettering). Hard geometry (medial axis). Connects to export
> (depth-varying toolpath) + the 4-mode nav (a 5th mode). Its own arc; reusable Design-tab spirit.
> · **The Origin "hack" (feasible — composes from what we have):** the Origin only cuts FIXED-depth paths, so
> decompose the v-carve into STACKED constant-depth CONTOUR passes with a V-bit — level k = `offsetPolygon(loop, −k·t)`
> cut at `cutDepth = k·t / tan(α)` (α = V-bit half-angle); the innermost contour ≈ the medial axis (deepest). Stack all
> levels in ONE SVG via per-element `shaper:cutDepth` + `<g>` (the unsurfaced 2.5D feature). Stepped approximation
> (#levels = smoothness); reuses `offsetPolygon` + the export engine. User's "interpolate loops → central path" = the
> medial axis = the innermost pass.
>
> **SETTLED — settings home = a sectioned settings MODAL (user, over a tab):** evolve the shared `#ui/style-panel.js`
> into a Fusion-'Preferences'-style modal — a category sidebar (Appearance / Units / …) + the selected category's
> controls; overlays any view, stackable, shared (both apps; hosts add categories). The **doc-unit toggle → its Units
> section** (U3). Heavy CNC settings (tool library / machine profile / post-processor) are EDITORS → their OWN dedicated
> views later, NOT crammed into the modal. (Modal wins for contextual/adjust-and-return/stackable; the tab's edge —
> room for settings-as-content + no stacking — applies only to those heavy editors, which get their own views.)

> **DESIGN VISION (user mockups) — the per-cut-type LOOK is TOOL-AWARE, not a recolor (SP1h):**
> - **outside** region + DASHED toolpath OUTSIDE the boundary (offset = +toolDia/2 ± cutOffset).
> - **inside** region + DASHED toolpath INSIDE.
> - **on line** a tool-WIDTH band centered on the path + a DASHED centerline.
> - **pocket** HATCHED fill (cleared area) with internal corners ROUNDED by the tool radius (a 0.5" bit visibly rounds
>   them vs ⅛"); depth shown as a label.
> - **guide** thin DASHED reference — NO toolpath, NO fill.
> The **bit diameter DRIVES the geometry** (offset distance, band width, corner rounding) → params (SP1g) MUST land
> before the look. **MULTI-SELECT (SP1i):** select many targets (a count badge, e.g. "9"); fields that differ show
> **"mixed"** (Figma-style); edits apply to ALL. Selection is already a collection (forward-safe).

> **SP1 open question (now tracked for SP1f):** a Prepare LOOP/EDGE is a DERIVED target (a cycle / a single #core
> edge), NOT one SVG path — so target↔cut-type is a NEW per-target model; the `shaper.js` per-SVG-element encoding is
> the EXPORT output (later). Unresolved: does the Design #core sketch correspond to Explore's edited SVG, or is
> Prepare's cut model independent until export? Doesn't block SP1d-e; settle at SP1f (likely a user call).

> **BACKLOG — SVG/DXF import into the Design sketch (user-raised):** today the #core sketch is build-by-drawing only;
> file I/O is one-way OUT (`export-manager.js` `buildSVG`/`buildDXF`). There is NO importer that turns SVG paths / DXF
> entities INTO #core joints + line/arc shapes (+ optional auto-constrain). A real feature: a parser (`#core/` or a
> shell importer) SVG/DXF → sketch, with cleanup (flatten transforms, etc.) so geometry is sketch-ready. Synergy:
> Shaper's Explore SVG-editor already flattens transforms / strips Affinity metadata — it could pre-clean, then import
> into Design. Not started; sized as its own arc.
>
> **BACKLOG — dockable / repositionable Design panels (CORE, user-raised):** the Design tool UI splits into SEPARATE
> dockable panels — a **sketch-tools** panel (select/line/rect/circle/arc) + a **constraint-tools** panel
> (coincident/H-V/parallel/perp/…) — each INDEPENDENTLY dockable (snaps to a dock zone) AND repositionable (drag to
> re-dock at another edge, or float free). Build a CORE dockable-panel framework in `#ui/` so the REUSABLE Design tab
> carries it → every host gets it ([[project-design-tab-reusable]]); the Design tab registers the sketch + constraint
> panels, and each HOST appends its own (Shaper: the cut card; the info/DOF panel) — same host-extensibility spirit as
> the ribbon's `extraGroups`. Open Qs (settle on pickup): dock-zones-only vs free-float; persist position; orientation
> reflow (H docked top/bottom ⇄ V docked left/right); which panels are dockable. Supersedes the S6b 'fixed side panel'
> call; relates to the retired-but-KEPT `tabbed-dock-panel.js` (a prior floating-dock widget). New arc, its own plan;
> NOT part of SP1.
>
> **BACKLOG — sketch FILLET (radius) tool, CORE (user-raised):** transform a SHARP CORNER (two lines meeting at a
> joint) into a TANGENT ARC, kept **constrained but editable**. DECLARE it as constrained geometry (NOT a one-off
> arc): create the tangent arc between the two lines, TRIM both lines to the tangent points (replace the corner
> joint), then add TANGENCY constraints (arc↔line ×2) + coincidence at the new tangent joints + a RADIUS dimension —
> so the solver MAINTAINS tangency on re-solve and the radius is editable/parametric. Feasibility HIGH — pure
> orchestration of EXISTING primitives (arcs + the tangent constraint the solver already handles, see
> `packages/core/tests/solver-tangent-arc-arc.test.js`; + dimensions); NO new solver machinery. CORE sketcher tool
> (#core geometry + a #ui fillet tool button + the constraint orchestration) → the reusable Design tab carries it
> ([[project-design-tab-reusable]]); every host gets it. Open Qs: selection gesture (pick the corner JOINT vs the two
> LINES); default radius + edit via a radius dimension; behaviour when the lines are too short for the radius. New
> arc; well-scoped + high-value; NOT part of SP1.
>
> **BACKLOG — multi-sketch / sketch layers (user-raised):** today the #core sketcher holds ONE flat `state`
> (joints/shapes/constraints) = a single sketch. Feature: a SKETCH SYSTEM — multiple named sketches/layers in one
> workspace, drawn/edited in the **Design** tab, MANAGED in another tab (a layers list: create / rename / show-hide /
> reorder / set-active; Shaper's Explore element-tree is a candidate host). Touches: the core model (`state` → a
> collection of sketches + an active one), the renderer (draw N layers, dim inactive), persistence, and the
> tab/router. Big architectural arc, its own plan. Connects to cut-types (a layer ≈ a cut group) + the Prepare loop
> work (loops per layer).
>   · **Inter-layer constraining (Fusion-style):** geometry in one layer constrained to geometry in another
>     (cross-sketch references / projected geometry). **Linked / cross-layer geometry renders PURPLE** (Fusion's
>     projected-geometry convention) so it reads as "from another layer." Implies the constraint model + solver span
>     layers (a constraint can reference joints across sketches) and the renderer color-codes provenance. Details TBD
>     when we're in it.
>
> **DEBT-SHELL-TEST — CLOSED by S7c-3** (`scripts/shell-smoke.cjs`, `npm run test:shell`, 12/12).
>
> **(closed) DEBT-SHELL-TEST (original note):** the new JS-rendered header + Design/Export router + style-panel adoption
> (2c) has NO durable regression test — only the per-slice CDP smokes. Deferred on purpose while the shell is still
> moving (ribbon swap 2d, export popup→tab 2e). Add a persistent DOM/CDP structural test at **2e/3** once it settles.
>
> **DEBT-RIBBON-CLEANUP (advisor-tracked):** S7c-2d adopted the shared ribbon via runtime-clear (`#toolsRibbon.innerHTML=''`
> then mount) rather than static removal — load-safe, but it leaves the inline ribbon MARKUP in index.html + the
> dead rect-dropdown wiring (`setupToolDropdown`/RECT_MODES) + a few harmless leaked document listeners in
> ui-manager.js. Static removal deferred to its own low-risk cleanup slice (after S7c-2d-pre migrates the per-button
> logic out). Functionally inert today (no live null-deref — verified; the auto-SELECT/Escape paths were fixed).

## (DONE) VCARVE-3a: the Vcarve shell mode + docked skeleton — blessed `HEAD`. Shaper-only; SketchStudio byte-identical.

`apps/shaper/index.html`+`main.js`: a `data-mode="vcarve"` nav btn BETWEEN Design & Prepare (auto-wired via
`modeBtns.forEach`) → **Explore·Design·Vcarve·Prepare·Sim/Export**; a `#view-vcarve` (absolute-inset, hidden-toggled) +
`VIEWS.vcarve` + a `showMode` toggle (static skeleton, no mount branch yet); a docked LEFT `#vcarve-panel` (244px, per the
dock-layout feedback) with placeholder ① Adapt (Region) + ② Carve (V-bit/dStep/max-depth/recompute, disabled) beside a
cream `#vcarve-canvas` that REUSES the `#design-canvas` cream selector (DRY). Advisor-verified: scope = index.html+main.js;
shell-smoke 12/12; the diff shows the `#view-vcarve` panel/canvas + `VIEWS.vcarve`. Worker CDP: nav order
`explore,design,vcarve,prepare,simexport`; Vcarve shows the docked panel + cream canvas; other modes still work.

## (DONE-plan, BLESSED) VCARVE-3 the Vcarve TAB plan — `HEAD~1` WORK-LOG (81 lines, code-free). **Declared vcarve record + derive.**

Shell mode AUTO-WIRES (a `.mode-btn[data-mode]` → `modeBtns.forEach → showMode`; advisor-confirmed the nav ground) →
insert `'vcarve'` before Prepare = nav btn + `#view-vcarve` + `VIEWS.vcarve` + a mount branch, Shaper-only → byte-identical.
**Data-model call (blessed):** a DECLARED `state.vcarves=[{id, region, vbit:{angle}, dStep, maxDepth}]` (like sketches/
groups) — the Vcarve tab edits+previews; `vcarveContours` DERIVES the stack at PREVIEW **and** EXPORT (one source of truth,
NOT materializing N contours into the cut plan). Prepare sees a vcarve region as "vcarve-handled" (excluded from std cut
assign). V-bit record `{kind:'vbit',angle}` + `VBIT_PRESETS` (90/60/45/30/20°); `vbitHalfAngleTan(angle)` feeds VCARVE-2.
Workspace = docked panel + cream canvas + depth-shaded contour preview. Slices: 3a shell+skeleton → 3b bit+region+preview
→ 4 gated export. (Shell is now 5 modes → [[feedback_shaper_dock_layout]] to refresh.)

## (DONE) VCARVE-2: the PURE offset-stack core — `#core/vcarve.js` `vcarveContours` + oracle — blessed `HEAD~1`. Additive; byte-identical.

`packages/core/vcarve.js` (PURE, no DOM): `vcarveContours(boundary, {dStep, halfAngleTan, maxIters=1000}) → [{polygon,
depth}]` — insets `offsetPolygon(boundary, -d)` for d = dStep, 2·dStep, … pushing `{contour, depth: d/halfAngleTan}` while
a valid loop, STOP when `offsetPolygon` returns `[]` (over-collapse = the local MEDIAL AXIS → FINITE). Guards (<3-pt
boundary / non-positive dStep|tan → `[]`; maxIters cap). PURITY: the HOST computes the boundary poly; the module never
touches the DOM. Advisor-verified: scope clean; **I ran the vcarve oracle (passes: a 40×40 sq → nested contours, depths
2,4,6…=d/tan, finite termination, 60°≈1.73·d deeper, guards)** + shell-smoke 12/12 (additive, no consumer → byte-identical).

## (DONE-plan, BLESSED) VCARVE-1 vcarve arc plan — `HEAD~1` WORK-LOG (94 lines, code-free, crux verified).

THE KEY INSIGHT: `offsetPolygon(boundary, -d)` returns `[]` on over-inset (winding-flip + self-intersection guards,
advisor-verified) → insetting until `[]` **TERMINATES at the medial axis** — the offset engine implicitly traces it, no
medial-axis computation. OFFSET-HACK (v1): `vcarveContours` = the stack `C(d)=offsetPolygon(boundary,-d)` while ≥3 pts;
`depth(d)=d/tan(halfAngle)` (V-bit groove half-width=d reaches the boundary). EXPORT (inverted+gated): the APP
precomputes + emits each contour as `<path … shaper:cutType="online" shaper:cutDepth="Xmm">` (V-bit rides each centered;
increasing depth = the V-groove; toolDia omitted); HOST computes the boundary poly (S-4e purity); GATED → standard +
SketchStudio byte-identical. Declared V-BIT record `{kind:'vbit', angle}`. UX: a Prepare 'vcarve' cut-mode on a closed
loop. MEDIAL-AXIS survey: distance-transform / Voronoi / straight-skeleton all hard → DEFER (VCARVE-5). SLICES: VCARVE-2
core → -3 V-bit+cut-mode → -4 gated export → -5 true axis. Specs: [[reference_shaper_svg_encoding]].

## (DONE ✅) DEPLOY — both apps LIVE on Cloudflare Pages — `main` @ `318ca13`, user-verified working.

Pushed `origin/main` `44c6d4b → 318ca13` (clean fast-forward, 167 commits — the FIRST time main got the whole `src/→
packages/+apps/` restructure + this session's work). CF auto-deployed; **user confirmed the site works** at
`sketch-studio.pages.dev` (NOT `sketchstudio` — the hyphenated project name). `/` → Studio (via `_redirects` 302), `/shaper`
→ Shaper, switcher both ways, sketches + SVG import live. Build config (user screenshot): production=main · auto-deploy ON ·
no build command · output=`/` (repo root) · framework=None — correct for the static no-bundler site. ROLLBACK: CF
dashboard → prior deployment. **HOME-1 (`/` IS Studio in-place, no redirect hop)** deferred to backlog — the deploy works.

## (DONE) BUG-1: box-select marquee coincident-glyph leak — gated snap OFF during a marquee — blessed `HEAD`. Both apps; surgical.

ROOT CAUSE (traced): `input-manager.js` `updateSnapTarget` ran BEFORE the marquee handler; its `needsSnap` included
`state.active`, which the marquee SETS (`type:'marquee'`, no `state.drag`) → it computed a `snapTarget` near the line →
the renderer drew the icon-coincident PREVIEW glyph. FIX (2 lines): `const isMarquee = !!(state.active && state.active.type
=== 'marquee'); needsSnap = !isMarquee && (…)` → during a marquee `needsSnap=false` → snapTarget/activeSnap cleared → no
glyph. SCOPED: `isMarquee` true ONLY for the marquee → every other state is BYTE-IDENTICAL → can't break drag-to-snap /
drawing-snap / cluster glyphs. Shared `#ui` → fixes BOTH apps. Advisor-verified: scope = input-manager.js only; the
`isMarquee` gate in the diff; shell-smoke 12/12. Worker CDP POSITIVE CONTROLS (non-vacuous): marquee box rendered + 0
glyphs; a real line-draw at the SAME near-line spot → 1 glyph (snap intact). Clean contrast.

## (DONE) SWITCH-2: app-switcher RELATIVE hrefs — blessed `HEAD~1`. Fixes the local-dev switcher; works from any server root.

`packages/ui/app-switcher.js`: `APPS` hrefs `/apps/<id>/` → `../<id>/`. Both apps are siblings at `apps/<id>/`, so
`../<other>/` resolves to the sibling from ANY server root (deployed repo-root AND local dev served from an ancestor) +
robust to the `/shaper` redirect; `location.href` unchanged. Advisor-verified: scope = app-switcher.js only; shell-smoke
12/12; the relative hrefs in the diff. Worker CDP across TWO roots: repo-root (siblings resolve, mounts on both apps) +
PARENT-root (the bug case — `../sketchstudio/` carries the `/Sketch-Studio/` prefix the old absolute path dropped → 404).

## (DONE) IMPORT-2: SVG IMPORT foundation — declared parser → `#core` shapes → a new sketch (static) — blessed `HEAD~1`. Both apps byte-identical.

NEW `#core/svg-import.js` (PURE): a DECLARED element table (line / rect→4 lines / circle→center+radius / polyline /
polygon / path [M/L/H/V/C/Q/Z; C/Q FLATTEN via de Casteljau; S/T/A FLAGGED-not-dropped]) → STATIC joints/shapes (NO
constraints → no solver flood). `computeImportScale` (physical-width+viewBox exact · viewBox-only=1mm/unit · none=px@96dpi
— each SURFACED). Host (`main.js`, Shaper-only) extracts per-element descriptors + size → `importSvgGeometry` → `saveState`
→ `addSketch(file)` → `activateSketch` → push (the wrap stamps `sketchId`) → toast "Imported N → <sketch> @ X mm/unit · K
skipped". One import = one named sketch. **User feedback (mid-task): the Import button FLOATED over the ribbon → moved
INTO the side panel `#design-panel-info`** + saved memory [[feedback_dock_buttons_in_panel]]. Worker caught+fixed a missing
`addSketch` import during verify. Advisor-verified: scope clean; **I ran the svg-import oracle (passes)** + shell-smoke
12/12; the declared table + scale + static + the side-panel button confirmed. CDP: a live drop imported 10 shapes → a new
sketch, no solver explosion.

## (DONE-plan, BLESSED) IMPORT-1 SVG/DXF IMPORT + VCARVING arc plan — `HEAD~1` WORK-LOG (149 lines, code-free, verified).

GROUND: geometry = `state.joints` + `state.shapes` (line/circle/arc); the shape factories AUTO-add H/V/coincident (an
importer must NOT — mint joints + push shapes directly; the sketch-state wrap auto-stamps `sketchId=active`); `svgio.js`
is parse-only/DISCONNECTED from the #core sketch; `buildDXF` (export-manager) is a write-mapping the DXF importer mirrors;
vcarve = greenfield. ARCH: a DECLARED importer (`#core/svg-import.js`+`dxf-import.js`, a mapping table; purity-split
host-parse/#core-map; beziers FLATTEN v1); lands in a NEW sketch per import (the layers model); STATIC/unconstrained
(no solver flood); units → world mm (SURFACE the scale). VCARVE: the MEDIAL-AXIS/centerline is the HARD part → its OWN
deep plan; shippable v1 = the stacked-offset-contour hack (`offsetPolygon` + per-path `cutDepth`); export INVERTS for
vcarve (app emits computed contours) — a NEW gated mode (standard + SketchStudio byte-identical). SLICES (import-first):
IMPORT-2 SVG → IMPORT-3 breadth+DXF → VCARVE-1 plan → VCARVE-2+. Specs: [[reference_shaper_svg_encoding]] · [[project_grouping_sketches_layers]].

## (DONE) SKETCH-4e: ISLANDS export — a group of nested loops → compound `evenodd` — blessed `HEAD~1`. **The j3b payoff; SKETCH-4 COMPLETE.**

`#core/group-model.js` `groupOfLoop(loop,state)`; `#core/shaper-export.js` takes `loopPolys` (host-computed) + `options.
islands` (default OFF): for a POCKET cut on a loop L in a user group, the group's OTHER loops STRICTLY CONTAINED in L
(`polygonContains` on the passed polys) = HOLES → ONE `<path fill-rule="evenodd" d="<L> Z <hole> Z…" pocket>` (subpaths
via the PURE `loopToPathD`; holes absorbed). CONSERVATIVE (POCKET + explicitly-grouped + contained only). `main.js` (host)
computes `loopPolys` via the DOM `loopPolygon` + passes them in → the serializer stays PURE. Advisor-verified: scope clean;
**I ran the export oracle (passes: the evenodd compound + 5 island cases + the j-series exact-strings)** + shell-smoke
12/12 (SketchStudio imports neither module + the change is gated → byte-identical). **Worker's architectural call BLESSED:**
the hidden-sketch exclude belongs at `cutPlanEntries` (entry collection), NOT the serializer — flagged, not shoehorned.

## (DONE) SKETCH-4d: the GROUP action (Ctrl+G / Ctrl+Shift+G) + toast — blessed `HEAD~1`. Shaper-only; the first model consumer.

`apps/shaper/src/main.js` (Shaper-only): a `keydown` gated to `currentMode==='design'` — **Ctrl+G** groups
`state.selectedShapes` (≥2): `saveState()` → `makeGroup(state, [...sel])`; **Ctrl+Shift+G** ungroups the selection's
group(s) (`groupOf` → `ungroup`); `preventDefault` (browser find). Feedback = a transient status TOAST in `#design-view`
(chosen over a group-mate highlight, which would touch the shared selection render); rich visuals + a tree-node DEFERRED.
The factory `groupId`/fill is UNTOUCHED (only `userGroupId` is set). Advisor-verified: scope = Shaper main.js only;
shell-smoke 12/12; diff confirms the mode-gated handler + `makeGroup`/`ungroup` + `saveState`. Worker CDP: the mechanism
(makeGroup stamps `userGroupId`, factory `groupId` stays, undo restores) + the live mode-gated handler/toasts verified.

## (DONE) SKETCH-4c: the user-GROUP substrate DECLARED (`userGroupId` ≠ factory `groupId`) + helpers + oracle — blessed `HEAD~1`. Additive.

NEW `#core/group-model.js` (PURE): a `userGroupId` membership tag on SHAPES (default none, DISTINCT from the factory
`groupId`) + `state.groups=[{id,name,sketchId}]` (`createSketches` now returns `groups:[]`); helpers `groupOf` /
`makeGroup(state,shapeIds,name?)` (mint `group-N`, stamp shapes, append the entry for the active sketch) / `ungroup` /
`renameGroup` / `shapesInGroup` / `loopsInGroup` (a loop ∈ a group iff ALL its edge-shapes carry the gid = fully-grouped).
Undo snapshots `groups` (deep) + the stamps ride the shape snapshot. Advisor-verified: scope clean; **I ran the group-model
oracle (passes)** + shell-smoke 12/12; **additive** — `userGroupId`/`groups` read only by group-model + the undo snapshot;
**the renderer + shape factory are NOT in the diff** → the factory `groupId`/fill is untouched (byte-identical). The
"declare everything" slice — the UX (S-4d) rides on top.

## (DONE-plan, BLESSED) SKETCH-4b GROUP/ISLAND-FLOW plan — `HEAD~1` WORK-LOG (code-free, verified). **Explicit groups + `userGroupId`.**

KEY CATCH: **`groupId` is ALREADY TAKEN** — the shape factories auto-assign it + the renderer buckets line-fill by it →
a user group must use a DISTINCT `userGroupId` (or go group-less). Worker recommended geometry-driven islands (no group;
detect unassigned-loop-in-pocket via `polygonContains`); **USER chose EXPLICIT** (more general — groups non-nested too;
"declare everything → changeable UX"). Output = SAME Shaper `<g>`/evenodd either way; only input-detection differs.
**Defaults confirmed:** unassigned inner inside a pocket = the island (uncut; assign it → a through-window instead);
hidden sketch EXCLUDED from export. Purity (S-4a): export HOST computes loop polys → the serializer stays pure. Slices:
S-4c declare the group model → S-4d the Group action + islands → S-4e export threading. Spec: [[project_grouping_sketches_layers]].

## (DONE) SKETCH-4a: `#core` loop-geometry LIFT + containment helper + oracle — blessed `HEAD~1`. Additive; Prepare look unchanged.

NEW `packages/core/loop-geometry.js`: lifted VERBATIM from prepare-view (`sampleArc`, `loopPolygon`, `polyArea`,
`pointInPolygon`) + NEW pure `polygonContains(outer,inner)` (STRICT: representative inner point inside outer AND
`polyArea(inner)<polyArea(outer)` AND no proper edge-crossing). `prepare-view.js` RE-IMPORTS them (local defs deleted →
behaviour-identical). Oracle: `pointInPolygon` + `polygonContains` (rect-in-rect / disjoint / overlap / equal) +
`loopPolygon` line/circle. **PURITY FLAG (carry to S-4d):** `loopPolygon` for ARCS needs the DOM (`getPointAtLength`) →
the export HOST computes loop polygons + passes them into the PURE serializer (never call the DOM-dependent `sampleArc`
from `#core`). Advisor-verified: scope clean; **I ran the loop-geometry oracle (passes)** + shell-smoke 12/12; the diff
shows the re-import + deleted local defs + strict `polygonContains`. Worker CDP: the Prepare tool-aware look (band, hatch)
renders unchanged.

## (DONE) SKETCH-3: cross-sketch LINKS in the panel tree (user request) — blessed `HEAD~1`. Pure render; single-sketch unchanged.

`design-info-panel.js` (tree): the tree loop resolves `constraintSketch(c,state)` — a STRING (home) → a plain nested row;
a SET (spans ≥2) → a `buildRow(c,sel,linkTo)` LINK with a `.sk-link-row` class + an accent `⇄ Sketch N` reference naming
the OTHER sketch(es) (`[...set]` minus the current id, via a `nameById` map); a spanning constraint already appeared under
each member (S-1b) → now MARKED as a link from each perspective; the row click still selects (unchanged). NO model change.
Advisor-verified: scope clean (design-info-panel only); shell-smoke 12/12; diff confirms the Set→link + the named
reference. Worker CDP: a cross-sketch coincidence shows `⇄ Sketch 2` under Sketch 1 AND `⇄ Sketch 1` under Sketch 2; a
local Distance stays plain; single-sketch → zero links.

## (DONE) SWITCH-1: shared two-way app-switcher in BOTH headers — blessed `HEAD~1`. Studio's 1st deliberate change = 2 additive lines.

NEW `packages/ui/app-switcher.js` (shared, pure `#ui`): `createAppSwitcher({current})` → name + chevron → a dropdown of
apps (current marked) → `location.href`; **roster DECLARED as DATA** `APPS=[{id,name,href}]` (real `/apps/` paths; a 3rd
host = one entry); themed via the shared `--sk-*` vars (fits light Studio + dark Shaper). `app-header.js` gained a reusable
`leading` slot. Shaper mounts `current:'shaper'` (replacing the redundant DEPLOY-1 back-link); **SketchStudio mounts
`current:'sketchstudio'` — the deliberate change = exactly an import + `leading: createAppSwitcher(...).el` (2 lines).**
Advisor-verified: scope clean; **shell-smoke 12/12 with Studio changed** (the switcher uses distinct `.sk-appsw-*` classes →
the tested tabs/Style-button/16-control panel are untouched, NO assertion change needed); the DATA roster + the 2-line
Studio diff confirmed in the diff. CDP: both apps switch both ways. The byte-identical relaxation cost 2 additive lines.

## (DONE) DEPLOY-1: `/shaper` route on the shared Cloudflare Pages site — blessed `HEAD~1`. No 2nd project; SketchStudio byte-identical.

`_redirects` (repo-root infra): ADDED `/shaper → /apps/shaper/ 302` FIRST, kept `/ → /apps/sketchstudio/`. Both apps already
ship on Studio's git-connected Pages site → Shaper just needed a front door. Plus a Shaper-only `<a href="/">SketchStudio</a>`
back-link (Studio untouched). Advisor-verified: scope = `_redirects` + `apps/shaper/index.html` only; shell-smoke 12/12
(SketchStudio byte-identical); `_redirects` correct (`/shaper` first; `/` matches exact root, no collision). **Deploy = the
USER's push** (git-connected auto-deploy → Shaper live at `…/shaper`); not pushed by advisor (outward-facing = user's call).

## (DONE) SKETCH-2b: inline RENAME + show/hide VISIBILITY — blessed `HEAD~1`. The layers-node UX complete; default byte-identical.

`#core/sketch-model.js`: `hiddenSketchIds(state)` (visible===false ids; default empty). `sketch-canvas.js`: a canvas
VISIBILITY filter guarded by `if (hidden.size)` — **default all-visible → the filter is SKIPPED, originals pass through →
byte-identical** (advisor-verified the early-out in the diff); a constraint is kept if ANY end is visible. Panel: inline
RENAME (dbl-click name → `<input>`; Enter/blur commit + `keydown` stopPropagation so typing won't fire tool shortcuts;
Esc cancels) + an EYE toggle for `sketch.visible` (dims the node); FOUR clean click targets (caret/name/eye/head + rows),
each stopPropagation; undo via the S-2a snapshot. Active+hidden = ORTHOGONAL (hiding never changes active). Export
visibility DEFERRED to S-4 (flagged). Advisor-verified: scope clean; shell-smoke 12/12; CDP hide drops canvas 12→2,
un-hide restores, rename commit/cancel/undo work.

## (DONE) SKETCH-2a: multi-sketch CORE — new / select-to-activate / live-tool stamping / undo — blessed `HEAD~1`. Single-sketch byte-identical.

`#core/sketch-model.js`: `addSketch(state[,name])` (lowest-free "Sketch N"; no auto-activate) + `activateSketch(state,id)`.
`sketch-state.js`: undo now snapshots `sketches` (deep) + `activeSketchId` (both restore paths). Panel: a "+" new-sketch
button; THREE clean targets (caret=collapse w/ stopPropagation · head=activate · rows=select); active head = accent bar +
bold + dot. **DELIBERATE DEVIATION — BLESSED (wrap over per-site):** instead of 26 per-site stamps, a CENTRALIZED wrap of
`state.joints.set`/`state.shapes.push` stamps any entity lacking a `sketchId` with the active sketch → provably can't miss
a site (my "miss none" requirement, better). **Advisor-verified the safety crux myself:** the solver mutates joints
IN-PLACE (`j.x=…`) and NEVER calls `joints.set` (grep of `solver/engine.js`) → the wrap is never tripped during solve; the
`sketchId==null` guard preserves undo-restore. Scope clean; shell-smoke 12/12; CDP: stamp/re-route/undo-drop all correct.

## (DONE) SKETCH-1c: collapsible sketch nodes (user request) — blessed `HEAD~1`. UI-only collapse state; export model untouched.

`design-info-panel.js` (tree mode only): a closure-level `collapsedSketchIds = new Set()` — PANEL/UI state, survives
re-renders because it lives in the closure (not rebuilt per `refresh()`), and does NOT touch the export-bound
`state.sketches`. Each sketch head shows a caret (▾ expanded / ▸ collapsed); a head click toggles the Set + refreshes
(collapsed → children not appended). Click separation kept: head = collapse, nested rows = `selectedConstraints`.
Advisor-verified: scope clean (design-info-panel only); shell-smoke 12/12; diff confirms the UI-only Set + caret. Worker
CDP: collapse survives an external re-render (tool-switch → refresh, still collapsed); expand restores; row-click intact.

## (DONE) SKETCH-1b: the GATED panel SKETCH-TREE (first consumer) — blessed `HEAD~1`. Shaper-only panel; SketchStudio byte-identical.

`design-info-panel.js`: a `showSketchTree=false` gate; `buildRow(c,sel)` extracted (BOTH modes → identical row markup +
click→`selectedConstraints`). Gate ON → a Sketch node per `state.sketches` (name + child count) with constraints NESTED,
bucketed via `constraintSketch` (home id, or matched under each member of a spanning Set); DOF/status header kept.
`main.js` opts in (`showSketchTree:true`). **Finding:** `createDesignInfoPanel` is Shaper-ONLY (SketchStudio has its own
constraint display, never mounts it) → byte-identity doubly safe; the shared-Design-tab convergence is future. Advisor-
verified: scope clean; shell-smoke 12/12 + sketch-model oracle pass; diff confirms gate-off=flat, buildRow reuse, the
tree render. Worker CDP: constraints nest under Sketch 1 (nested=2, flat_direct=0), row-click highlight + DOF intact.

## (DONE) SKETCH-1a: the Sketch container data model + pure helpers + oracle — blessed `HEAD~1`. Additive, both apps byte-identical.

NEW `packages/core/sketch-model.js` (PURE, reusable by panel/export/vcarve): `createSketches()` → `{sketches:[{id,name,
visible}], activeSketchId}` (default single `Sketch 1`); `sketchOf(e)=e.sketchId||'sketch-1'` (the FALLBACK — untagged →
Sketch 1, so the single-sketch default is correct without stamping every site); `stampSketch`; `constraintSketch` →
home id | spanning SET (the cross-sketch LINK signal); `entitiesInSketch`. Wired additively into `sketch-canvas.js`
(headless createSketch + stamp) + `sketch-state.js` (live state gets the container). **Minimal-touch call (blessed):**
live-tool stamping (6+ handlers) DEFERRED to S-2 (where select-to-activate makes it matter); the `sketchOf` fallback
covers the single-sketch default now. Undo doesn't snapshot the sketches list yet → an S-2 note. Advisor-verified: scope
clean; **I ran the container oracle (passes: default Sketch 1, fallback, `constraintSketch` home + spanning
`Set{sketch-1,sketch-2}`)**; ADDITIVE (only the 3 wiring files touch sketchId — nothing consumes it) → shell-smoke 12/12
+ both apps load/render identical (CDP). Solver stays GLOBAL.

## (DONE-plan, BLESSED) SKETCH-1 SKETCH-SYSTEM foundation plan — `HEAD~1` WORK-LOG. **Overlay confirmed; building the sketch system.**

The OVERLAY model holds (advisor ground-truth verified: ZERO existing `sketchId`; one GLOBAL `createNewtonSolver` over
flat `joints`/`shapes`/`constraints` — nothing scopes; the Design panel is a flat constraint-status list). Plan:
`state.sketches=[{id,name,visible}]` + `activeSketchId`; each entity gets a STORED `sketchId` (= active at creation) +
shapes an optional `groupId`; a constraint's sketch is DERIVED from its joints (same → home, spanning → a cross-sketch
LINK); cross-sketch coincidence "just works" (global solver); islands = a group of nested loops → compound evenodd;
export sketch→`<g>`, group→nested `<g>`/evenodd (reuse SP1j-3a). **Flags resolved:** joint `sketchId` STORED; scope
SHARED-but-GATED (north-star). **Slices:** S-1a container data (THIS) → S-1b gated panel sketch-tree → S-2 multi-sketch
UX → S-3 cross-sketch links → S-4 groups+islands+export. Full vision: [[project_grouping_sketches_layers]].

## (DONE-investigation, REFRAMED) SP1j-3b ISLANDS plan — `HEAD~?` WORK-LOG. **Folded into the SKETCH SYSTEM (islands = a group).**

Investigation blessed (the worker traced the real model, didn't guess). **Key finding:** a pocket-with-a-hole is TWO
independent geometrically-nested loops — the hole is GEOMETRY, not a topological ring face (`findLoops` confirms) → "the
face encodes the hole" RULED OUT. The worker recommended an infer-gated rule (unassigned-loop-inside-pocket = island,
behind `options.islands`), flagging the inference as a UX fork. **USER REDIRECTED the trigger:** islands should be
**GROUP-driven** — Shaper detects a compound shape via a `<g>` of nested same-fill paths + even-odd/winding (the native
model), NOT inference. So **j3b-build = explicit GROUPING**: the user groups the outer + contained loops → emit one
`<g>`/compound `fill-rule="evenodd"` path, the contained loop = the hole.
- **SURVIVES the reframe (reuse):** the DECLARED `#core` containment helper (`pointInPolygon` + `polygonContains`) +
  lifting `loopPolygon`/`sampleArc` to `#core` — still needed to order a group into BOUNDARY vs HOLES (largest-area =
  boundary; strictly-contained = holes). evenodd output, POCKET semantics, reuse j2 subpaths — all stand.
- **CHANGES:** the "these loops form a compound" TRIGGER → from geometric-inference to EXPLICIT user grouping.
- **NEW DEPENDENCY:** j3b islands now RIDE ON a grouping action = the deferred **SP1i multi-select** (now well
  motivated). Re-sequence: a grouping/multi-select slice → then j3b group-islands. (Advisor to lay out the path with
  the user after GRID-1.)

## (DONE) SP1j-3a: datum triangle + `<g>` group-inheritance — two DECLARED serializer options — blessed `HEAD~1`.

`exportShaperSVG({…, options={datum, groupByCut}})`, DEFAULT OFF (j1/j2 exact-strings unchanged). Element builders
refactored to return GEOMETRY only (`{tag, a}`) → cut attrs carry per-element OR hoist to a `<g>` (the default assembly
is byte-identical). `options.datum` → `<polygon points="0,0 20,0 0,10" fill="#FF0000" stroke="none"/>` (right triangle,
90° vertex at 0,0, the registration anchor; emitted FIRST; bounds expand to fit; `{legX,legY}` override). `groupByCut` →
elements sharing IDENTICAL cut attrs grouped under one `<g common>` (attrs hoisted, dropped off the inheriting children;
first-seen order; group-of-1 unchanged). `main.js` Generate passes `{groupByCut:true}` (cleaner files); datum OFF →
future Drop-Datum UI toggle. Advisor-verified: scope clean; **I ran the export oracle (passes: datum-first, the `<g>`
with attr-less children, default-off j1/j2 unchanged)** + shell-smoke 12/12.

## (DONE) SP1j-4: cut-plan store + Sim/Export download — the export engine is END-TO-END LIVE — blessed `HEAD~1`. **SP1j EXPORT ENGINE LIVE.**

NEW `apps/shaper/src/cut-plan.js` — the per-target cut store relocated from `prepare-view.js` (the `CUT_PLAN` Map +
`keyOf`/`parseKey`/`getCutRecord`/`setFieldFor` + `cutPlanEntries()`; app STATE, NOT #core) → now the SINGLE source of
truth read by BOTH the Prepare look AND the exporter (unblocks vcarve/joints too). `prepare-view.js` imports it
(behaviour UNCHANGED). Sim/Export tab (`#view-simexport`) → a **Generate Shaper SVG** button + status; the handler:
`cutPlanEntries()` (empty → graceful no-download) else `exportShaperSVG({state, entries, encoding: CUT_TYPES, docUnit})`
→ Blob → `.svg` download. **Encoding INJECTED** (#core stays app-agnostic); docUnit from settings. Advisor-verified:
scope Shaper-only (no #core/SketchStudio leak); **I ran the export oracle (passes) + shell-smoke 12/12** (SketchStudio
unregressed, 16-control panel); the wiring diff confirms `#core` import + injected `CUT_TYPES` + the empty-guard. Worker
CDP: a REAL Generate click → a valid `xmlns:shaper` Blob, "Exported 3 cuts" (outside 0.25in / pocket / online, inch
doc). **From design to a machine-ready Origin SVG.**

## (DONE) SP1j-2: full geometry (arcs/circles/edges) + cut-param attrs, all 5 types — blessed `HEAD~1`.

Pure additive `#core/shaper-export.js` (still no importer → both apps byte-identical). **ARCS** in `loopToPathD` →
`A r r 0 largeArc sweep x y`, **direction-aware** — sweep from the arc's STORED `[center,start,end]`+flags (NOT a chord
guess), FLIPS on reverse traversal (detected by nearest endpoint → robust to joint-id remap); the closing edge is
emitted explicitly ONLY when it's an arc (a line → `Z`, so a pure-line loop is **byte-identical to j1** — the j1
exact-string still passes). CIRCLES → `<circle>` (bbox center±r). Open EDGES → true `<line>`/`<path>`/`<circle>`.
Cut-param attrs attribute-first: `shaper:cutDepth`/`cutOffset`/`toolDia` via `units.format({unit:true})` → docUnit drives
the suffixes (6.35mm / 0.25in), geometry stays mm-canonical; omit cutDepth=unset / cutOffset=0 / toolDia≤0. All 5 types
via the injected encoding. Advisor-verified: scope clean; **I ran the export oracle (passes: arc BOTH dirs sweep 1↔0,
circle, edge, mm+inch params, j1 exact-string still green)** + node --check + shell-smoke 12/12.

## (DONE) SP1j-1: pure `#core/shaper-export.js` serializer (header + line-loop) + exact-string oracle — blessed `HEAD~1`.

PURE additive `#core/shaper-export.js` (no importer yet → both apps byte-identical; reusable by vcarve/joints).
`exportShaperSVG({state, entries, encoding, docUnit}) → string`: `xmlns:shaper` header + **mm-canonical** (viewBox +
path coords = base mm, UNSCALED; width/height labelled mm; docUnit = display lens only); per loop → a closed
`<path d>` via `loopToPathD` (LINES only) + **attribute-first** `shaper:cutType` from the **injected** encoding (#core
never imports app CUT_TYPES) + fill (always) / stroke (omitted when none). Robust skips (orphaned loop / missing
encoding / missing joint / edge-kind). `num()` ≤4dp + trim + no `-0`. Oracle (exact-string 100×50 rect → `M 0 0 L 100 0
L 100 50 L 0 50 Z` + `shaper:cutType="outside"`; empty→valid; orphan→skipped). Advisor-verified: scope clean; **I ran
the export oracle (passes)** + node --check + shell-smoke 12/12 + grep confirms NO importer (additive). Worker probed
the real findLoops walk order so the exact string is correct, not guessed.

## (DONE) Shaper Design canvas → CREAM + light geometry theme — blessed `HEAD~1`. **SP1 Prepare experience visually COMPLETE.**

Shaper-only (`apps/shaper/index.html`, ONE scoped CSS block — no JS, no #core); SketchStudio byte-identical. Worker
confirmed the mechanism first (no gate): the #ui svg-renderer routes geometry colours through `var(--sk-NAME,
fallback)`; re-overriding `--sk-*` on a CLOSER ancestor (`#design-canvas`) wins for THAT canvas only (CSS-var
inheritance); canvas bg = a plain `background-color` on the SVG; Design omits the grid. DID: `#design-canvas {
background-color:#F4EFE1; --sk-geo-fixed:#202020; --sk-geo-free:#3b82f6; --sk-dimension:#2563eb; joint-fill cream-hollow
… }` = warm paper cream + a dark-on-cream light palette; `.snapping` → warmer cream. Scoped to `#design-canvas` →
ribbon/info-panel/mode-nav stay DARK; Prepare/Explore untouched; shared `sketcher.css` defaults (SketchStudio reads)
NOT edited. Advisor-verified: scope index.html only; CDP cream `#F4EFE1` present + scoped; **shell-smoke 12/12**
(SketchStudio canvas still white, dark `:root` untouched) + loop oracle. Dark shell, cream paper.

## (DONE) SP1h6: pocket hatch → the TOOL-CENTER region (inset by toolDia/2) — blessed `HEAD~1`. **SP1h tool-aware look COMPLETE.**

Shaper-only (`prepare-view.js` pocket branch); SketchStudio byte-identical. Per the user (3×, images): pocket hatch = the
ERODED region — `openPolygon(loop, toolDia/2, cutOffset)` → `offsetPolygon(loop, -(toolDia/2+cutOffset))` (inset by
toolDia/2; a margin to the wall, NOT reaching it). Empty-on-over-inset kept; removed the now-orphaned `openPolygon`
import (stays in #core for SP1j export). Advisor-verified: scope prepare-view.js only; node --check + shell-smoke 12/12
+ offset oracle; worker CDP (60×40 rect, bit 3.175 → hatch 56.825×36.825 margin 1.587=toolDia/2; bigger bit insets more;
over-inset empty). **Worker FOLLOW-UP flag:** inset corners are miter/sharp (correct at convex); a concave pocket's
REFLEX corners would ideally round by the bit — one-word: `offsetPolygon(…, {join:'round'})`. Left miter per dispatch.

## (DONE) SP1h5: cut feedback = tool-width band + dashed centerline; flat fill dropped; pocket-only hatch — blessed `HEAD~1`.

Shaper-only (`prepare-view.js` `computeLook`); SketchStudio byte-identical. Per the user's 2 directives: dropped the
SP1f flat region tint (a cut target gets NO solid fill); cutting types render a tool-width BAND (`stroke-width=toolDia`
world units = the kerf) + a dashed CENTERLINE (tool-center path) in the type's previewStroke — outside/inside center on
the boundary offset OUT/IN by `toolDia/2±cutOffset`, on-line on the boundary; guide = dashed ref (no band); pocket = the
ONLY fill (hatch + depth). `sigOf` keys toolDia/cutOffset/cutDepth/DOC_UNIT → band re-widths + centerline shifts LIVE.
Advisor-verified: scope prepare-view.js only; `node --check` + shell-smoke 12/12 + offset + loop oracles; worker CDP
(exterior band 3.175 + centerline 63.175→72.7 on bit change; inside 12.7/47.3; guide no band; pocket hatch+depth).

## (DONE) SP1h4: POCKET look — morphological-opening cleared region + hatch + depth label — blessed `HEAD~2`.

Closes the per-cut-type tool-aware look. **DECLARE-gate (worker):** added TWO reusable #core concepts (vs hand-rolling
pocket geometry) — `offsetPolygon(...,{join:'round'})` (additive; miter is default, byte-unchanged) + `openPolygon(pts,
radius,offset)` = morphological OPENING (erode by r, dilate back with round joins) — both REUSED by SP1j export.
**INTERPRETATION (worker, advisor-confirmed CORRECT):** built the true opening — straight walls REACH the boundary,
only CONVEX corners round by the bit (a literal inset-by-toolDia/2 would draw a false uncut margin along every wall and
mislead a CNC user). Matches the user's `.5"` mockup. `prepare-view.js`: `<defs>` diagonal HATCH pattern (world-unit
spacing) + centroid depth label (`↓` + `units.format(cutDepth, DOC_UNIT, {unit:true})`; unset→none); `sigOf` keys on
cutDepth + DOC_UNIT. Advisor-verified: scope clean; **I ran the offset oracle (passes: miter-default-unchanged + round
+ opening)** + node --check + shell-smoke 12/12 + loop-finder; worker CDP (40-rect: rounded cleared area 1597.6, bit
½→1599.9 near-sharp, bit too big→empty, depth label live in doc unit). **Superseded by SP1h5 directive** (drop the
flat region tint; cutting types get a tool-width band) — the pocket hatch + depth stays. Follow-up: DOC_UNIT live
re-label not wired to a Prepare refresh (label updates next refreshLook).

## (DONE) SP1h3: offset robustness (concave / arc-density / tiny-edge / thin-neck) — blessed `HEAD~2`.

Pure `#core/polygon-offset.js` + oracle; Shaper wiring UNCHANGED → SketchStudio byte-identical. Worker EMPIRICALLY
checked SP1h2 first: the miter offset already handled concave (miter trims the reflex overlap), arc-density (small
stable miters), and over-inset (edge-reversal); only TINY/dup edges + a self-intersection guard were missing. Added:
`dedupe(1e-7)` (drop near-dup vertices, keeps real arc curvature) + `selfIntersects()` (O(n²) true-crossing test) →
`offsetPolygon` returns `[]` on a thin-neck/concave fold (clean empty, no garbage); full self-int CLIPPING deferred
(detect-and-empty contract). Oracle += L-shape reflex / 32-vtx circle (~concentric) / thin-rect inset→[] / tiny-dup.
Advisor-verified: scope clean; **I ran the offset oracle (passes, incl new cases)** + `node --check` + shell-smoke
12/12 + loop-finder; diff = dedupe + selfIntersects + the kept SP1h2 guards.

## (DONE) SP1h2: `#core/polygon-offset.js` + oracle + outside/inside dashed toolpath — blessed `HEAD~2`.

PURE additive `#core/polygon-offset.js` (only `prepare-view.js` imports it → SketchStudio byte-identical; REUSED by
SP1j export): `offsetPolygon(points, distance)` (+OUTWARD/−INWARD, winding-normalized); per-edge outward-normal shift +
MITER join (`getLineIntersection`); over-inset caught via per-edge **direction-reversal** test (a bare winding-sign
test missed an inverted-ghost polygon — found + fixed) + collapsed-area guard → `[]`. Oracle `tests/polygon-offset.test.js`
(square OUT→14²/IN→6², triangle, degenerate→[], CW-input, edge cases). `prepare-view.js`: exterior→outward / interior→
inward by `toolDia/2+cutOffset` dashed toolpath, region tint kept, re-uses the SP1h1 cache. Advisor-verified: scope
clean; **I ran the offset oracle (passes)** + `node --check` + shell-smoke 12/12 + loop-finder; grep confirms ONLY
prepare-view.js imports it (additive); worker CDP (60-rect: exterior 63.175, interior 47.3, re-widens live). SIMPLE
loops only — concave/arc/thin-neck = SP1h3.

## (DONE) SP1h1: tool-aware look foundation — toolpath layer + reactivity + guide + on-line — blessed `d74b88d`.

Shaper-only (`prepare-view.js`); SketchStudio byte-identical. New `#prepare-toolpath-group` (z cut-tint < edges <
toolpath < select < hover). Signature-cached look engine: `lookCache` keyed `(cutType,toolDia,cutOffset)`, `computeLook
→ {region, path}`, `getLook` memoized, `refreshLook` repaints cut layer (.region) + toolpath layer (.path); BOTH
`applyCutTypeToSelected` AND `setFieldOnSelected` route through `refreshLook` → live update on any cut-field change.
**GUIDE** = dashed reference (no fill/band); **ON-LINE** = a band `stroke-width=toolDia` (world units = base mm,
dimensionally correct) + dashed centerline (loop & edge). outside/inside/pocket keep the SP1f flat tint (h2–h4).
Advisor-verified: read the diff (cache + two-layer split + toolDia band); scope prepare-view.js only; `node --check` +
shell-smoke 12/12 + loop-finder oracle; worker CDP (guide 1 dashed elem; on-line band 3.175→6.35 on bit change;
exterior flat fill).

## ✅ UNITS ARC COMPLETE (U1→U2→U3a→U3b→U3c) — doc unit (Shaper inch / SketchStudio mm) drives the dim edit field + canvas labels + Shaper cut params, toggled from the Settings modal; base 1 world unit = 1 mm; switch RE-LABELS; SketchStudio byte-identical throughout. `units.format({unit:true})` ready for SP1j export.

## (DONE) U3c: canvas dimension LABELS re-label via units (`svg-renderer.js`) — blessed `f757d94`.

SHARED renderer change, byte-identical at mm. `formatLenLabel(v) = formatUnit(v, DOC_UNIT||'mm', {decimals:1})` (=
`v.toFixed(1)` at mm); routed the RADIUS + 3 DISTANCE labels + the dim-placement PREVIEW through it; **ANGLE labels
stay `°` (unchanged)**. Re-label rides the Design solve→draw RAF (no explicit subscribe needed). Advisor-verified:
scope `svg-renderer.js` only; `node --check` + **shell-smoke 12/12** (SketchStudio renderer byte-identical) +
loop-finder oracle; diff confirms length-only routing + angle untouched; worker CDP mm `50.8`→in `2.0`, angle `90.0°`.
Logged follow-up: the draw-time rect/line size-hints (while dragging) still show base mm — minor, candidate cleanup.

## (DONE) U3b: Shaper settings — header gear → shared style-panel modal + doc-unit toggle — blessed `4cbf8e3`.

`style-panel.js` (host-opt-in) + Shaper `index.html` (gear `#btn-settings` + CSS) + Shaper `main.js` (mount modal,
wire gear → `toggle()`, conditional inch default). `createStylePanel({…, showDocUnit=false})` — when true, append ONE
Document-Unit `<select>` (mm|cm|in from `units.UNITS`) writing `DOC_UNIT` (persist:local) + repopulate on subscribe.
**SketchStudio does NOT pass `showDocUnit` → no control → panel stays exactly 16 CONTROLS / byte-identical** (the
`units.UNITS` import is inert there). Shaper inch-default is **in-memory** (`persist:false` if no persisted DOC_UNIT) →
**no localStorage leak**. Advisor-verified: read the diff (select gated on `showDocUnit`); **shell-smoke "16 controls"
PASS + 12/12**; `node --check` clean; scope = style-panel.js + Shaper index/main. **Caveat (logged, non-blocker):** an
EXPLICITLY-toggled unit persists to the shared `localStorage` key → same-origin Shaper+SketchStudio share it; the real
deploy is separate-origin (independent). A future app-scoped settings key isolates it.

## (DONE) U3a: Shaper cut params → base mm + units (`cut-panel.js`) — blessed `c450f20`.

Shaper-only (`cut-panel.js` + `shaper.js`); SketchStudio UNTOUCHED. `defaultCutRecord` `toolDia` 0.125→**3.175mm**
base; `BIT_PRESETS` values ×25.4 (labels kept imperial .02/⅛/¼/½); cut fields parse via `units.parse(value,docUnit)`,
display `units.format(baseMM,docUnit,{decimals:3})`; depth STEPPER steps in the DOC unit (base→doc→±step→base);
`renderFields` re-formats; the panel SUBSCRIBES to `DOC_UNIT` → re-label live (no resize), **unsub on destroy**
(leak-free). No migration (`CUT_PLAN` in-memory). Advisor-verified: read the diff (toolDia→3.175, stepper doc-unit
math, leak-free subscribe); scope Shaper-only; `node --check` + shell-smoke 12/12 (SketchStudio untouched) +
loop-finder oracle. (proc_health `watch` still throws the `JSONDecodeError` → census blind.)

## (DONE) U2: units in the #core dimension EDIT field (length dims) — blessed `2b36939`.

`numeric-input-manager.js` only (the REAL dim-edit seam — worker corrected the dispatch's dead `live-dimension-input.js`
ref). LENGTH dim prefill → `formatUnit(v, docUnit)`, commit → `parseUnit(value, docUnit)` (suffix overrides; bare =
docUnit, default `'mm'`); ANGLE dims (`CONSTRAINT_TYPES.ANGLE`) stay raw `toFixed(1)` / `parseFloat` degrees; guard
`val!=null && !isNaN` rejects invalid exactly as NaN did. `constraint.value` still base mm → NO migration/resize.
**Both apps byte-identical at the default** (mm + bare number → parse/format parity). Advisor-verified: read the diff;
`node --check` + shell-smoke 12/12 + loop-finder + units oracles; worker's CDP covered BOTH apps (Shaper text-input
0.25in→6.35 / 5mm→5 / angle 45→45 unconverted; **SketchStudio `#dimInput` is `type=number` → rejects suffixes →
unregressed**). Worker FLAG for U3: SketchStudio's `#dimInput` should become `type=text` when it adopts the toggle.

## (DONE) U1: pure `#core/units.js` (parse/format + oracle) + inert `DOC_UNIT` setting — blessed `4328b12`.

INERT, additive → both apps BYTE-IDENTICAL (only `settings-manager.js` gains a `DOC_UNIT:'mm'` DEFAULTS key;
`units.js` + `units.test.js` are NEW with NO importer). `units.js` (pure): `BASE='mm'` (1 world unit = 1 mm),
`TO_MM{mm,cm,in}`, `parse(str,docUnit)→baseMM|null` (suffix `mm|cm|in` case-insens OVERRIDES; bare=docUnit;
signed/decimal/leading-dot; fractions→null, noted for U3), `format(baseMM,docUnit,opts)→string` (`decimals` default
1 = today's `toFixed(1)`; `{unit:true}`→ trimmed Shaper export form `0.25in`/`6.35mm`/`1in` for SP1j). Advisor-verified:
read the diff (parse/format correct, settings additive); **I ran the units oracle (passes) + `node --check` +
shell-smoke 12/12 (SketchStudio byte-identical) + loop-finder oracle**; INERT confirmed by grep (only a comment refs
`units.js` — no live importer); worker tree clean.

## (PLAN BLESSED — build paused pending UNITS) SP1h: per-cut-type tool-aware look — plan `900fe95`.

Worker plan (WORK-LOG `900fe95`, NO code): offset the loop's CCW arc-sampled boundary by `toolDia/2 ± cutOffset`
(outward=outside / inward=inside) → dashed toolpath, reusing `perpendicularNormal` + `getLineIntersection`; convex gap
→ round arc, concave → trim; pocket = morphological OPENING (corners filleted by r) + hatch + depth label; on-line =
tool-width band + dashed centerline; guide = dashed ref. Offset HOME = a pure **`#core/polygon-offset.js`** (additive,
oracle-testable, REUSED by SP1j export). Render = new `#prepare-toolpath-group` (z: cut-tint < edges < toolpath <
select < hover); one `refreshLook(target)` + per-target cache. **Advisor: BLESSED + took the worker's slicing REORDER**
over my offset-first — h1 (layer+reactivity+guide+on-line) → h2 (#core offset+oracle+outside/inside) → h3
(concave/arc/self-int robustness) → h4 (pocket) — and blessed the `#core/polygon-offset.js` home. **BUILD PAUSED
pending the UNITS arc** — the offset is a PHYSICAL distance, needs a unit→world scale (same decision as SP1j export);
the user chose a switchable DOCUMENT UNIT → UNITS is now the prerequisite.

## (DONE) SP1g: cut-param rows (depth / offset+flip / bit-diameter+presets) — blessed `f834f78`.

Shaper-only (4 files: cut-panel.js + prepare-view.js + main.js + index.html); SketchStudio + shared #core/#ui
byte-identical; single-select. Fills SP1f's `.cut-rows` slot, wired to the SAME per-target record. `cut-panel.js`:
3 rows reflecting+editing the record — DEPTH (−/＋ stepper, default 'unset', steps from `DEPTH_START` 0.1 by
`DEPTH_STEP` 0.05), OFFSET (typed + FLIP toggle negating the cutOffset sign, lit when negative), BIT DIAMETER (typed +
presets **declared as data** `BIT_PRESETS` .02/⅛/¼/½, rendered in a loop). Pure view: emits `onSetField`;
`update(model)` reflects all fields + active-preset/flip; forward-compat note for a future 'mixed' model.
`prepare-view.js`: generalized `setCutTypeFor`→`setFieldFor(key,field,value)`; NEW `setFieldOnSelected` persists numeric
fields with NO recolor (they drive SP1h's tool-aware look, not the SP1f color). `main.js`: wired `onSetField`.
Advisor-verified: read the diff (declared presets, pure view, generalized apply, no-recolor correct); node --check +
shell-smoke 12/12 (SketchStudio byte-identical) + oracle green; worker tree clean.

## (DONE) SP1f: cut-type panel + assign (Prepare cut-settings card) — blessed `9603c52`. User-confirmed.

Shaper-only (5 files: shaper.js + prepare-view.js + NEW cut-panel.js + index.html + main.js); SketchStudio code
UNTOUCHED. `shaper.js` ADDITIVE on `CUT_TYPES` (export `fill`/`stroke` INTACT for SP1j) — `targetKind` region|path,
`menuLabel`, dark-legible `previewFill`/`previewStroke` (green family); helpers `cutTypeById`, `defaultCutRecord()`
(full record forward-safe), `availableTypes(kind)` gating (loop→all 5; edge→path only). `prepare-view.js`:
module-level `CUT_PLAN` (persists across re-mounts), `#prepare-cut-group` behind select/hover painting each assigned
target in its preview color via the shared `targetMarkup`; `renderCuts` guards stale targets;
selectedTarget/recordFor/availableTypesFor/applyCutTypeToSelected + onSelectionChange. `cut-panel.js` (NEW): pure-view
dark card + gated cut-type dropdown (leak-free), `.cut-rows` slot left for SP1g. `index.html`: #prepare-panel host
(top-right, pointer-events:none) + .cut-card CSS. `main.js`: wires selection↔panel↔apply. Advisor-verified: read all
diffs (CUT_TYPES additive, export untouched; declarative gate; real persistence); node --check + shell-smoke 12/12
(SketchStudio byte-identical) + oracle green; worker tree clean. **User-confirmed live: "all function operating";
panel stays top-right.** Logged: `CUT_PLAN` never-cleared (fine while geometry static).

## (DONE) SP1e: proximity edge target — on-stroke hover/click selects a single vector — blessed `16e21d6`.

`prepare-view.js` only (Shaper; SketchStudio + shared #core/#ui byte-identical). Fills SP1d's `'edge'` seam → the
PROXIMITY rule live: edge branch in `resolveTarget` FIRST (nearest shape stroke within tolerance WINS over the loop;
else innermost loop) → OPEN paths selectable. Tolerance = 6 screen px → world via live CTM (zoom-stable); hit math
line=point-seg, circle=|d−r|, arc=nearest of 32 samples; edge-hit geometry PRECOMPUTED once at mount. Render
generalized: `polyOf` → ONE `targetMarkup(t, loopStyle, edgeStyle)` (loop=filled polygon; edge=true geometry as a
glowing stroke via `calculateArcPath`), distinct from loop fills. Advisor-verified: read the diff (edge-first,
precompute, one render path); ran `node --check` + `npm run test:shell` (12/12) + loop-finder oracle (green); scope
prepare-view.js only. **Worker re-registered FROM THE REPO ROOT → `.proc/` split-brain CURED (advisor.pid + worker.pid
side-by-side); worker tree censused clean (0 zombies).** CDP verify (AB→edge, interior→loop, open line→edge,
outside→null) credible.

## (DONE) SP1d: declared kind-tagged Prepare selection model + loop click-select — blessed `cd01af9`.

`prepare-view.js` only (Shaper; SketchStudio + shared #core/#ui byte-identical; main.js untouched — return additive).
DECLARED model (declare-over-hand-roll): target `{kind:'loop'|'edge', id}`, selection = Map keyed `${kind}:${id}` (a
COLLECTION — single-select BEHAVIOR now, forward-safe for multi-select + the `'edge'` kind). ONE kind-aware
`resolveTarget(worldPt)→{kind,id}|null` (today innermost loop; the on-stroke `'edge'` branch is a documented SP1e
seam, NOT built). pointerdown commits the loop under the cursor; SELECTED render in a separate `#prepare-select-group`
(stronger fill + solid `--sk-selection` outline, distinct from light `--sk-hover`), persist across move/leave; a
hovered-already-selected loop suppresses its hover (no double-draw); click empty clears; redraw on selection/hover-
change only (no RAF). Advisor-verified: read the diff (clean declared model + genuine seam); ran `node --check`
(clean) + `npm run test:shell` (12/12, SketchStudio byte-identical) + loop-finder oracle (green); scope = prepare-
view.js only. Worker's CDP verify (nested rects: select inner w20, move→persists, click ring→outer w80, click
empty→size0, resolveTarget outside→null) credible. **User-eyeballed live: "hover and select are perfect."**

## (DONE) BUGFIX — Shaper/SketchStudio Design click crash (line→line midpoint snap) — blessed `0ffccb2`.

`handleShapeSelection:398` read `hitShape.shape.id` → "Cannot read properties of undefined (reading 'id')" + an
"Input Error" toast on clicking a feature. ROOT CAUSE (worker traced, I confirmed vs the diff): `findSnap`
(snap-detection.js) builds a line→line MIDPOINT snap with NO `.shape` (unlike the per-line midpoint at :177);
input-manager treats every line|shape|midpoint snap as a shape-hit → `hitShape={shape:undefined}`. Needs ≥2 lines
(the i<j loop) → appears only AFTER drawing (rect=4 lines), not on the 1-line seed. SHARED code → SketchStudio
equally exposed. FIX (source, minimal): one chokepoint guard after the 4 hitShape builds —
`if (hitShape && !hitShape.shape) hitShape = null;` (a virtual line→line midpoint is not a selectable feature →
SELECT/DIMENSION falls through to marquee; drawing reads clickSnap, unaffected). 2 stray `[DEBUG]` logs removed; the
real `console.error` kept. Advisor-verified: guard predicate safe (real shapes are truthy → only the virtual midpoint
nulled), placed after all 4 builds; **I ran `node --check` (clean) + `npm run test:shell` (12/12)** → SketchStudio
unregressed; scope `input-manager.js` + `.gitignore`(`.proc/`); SP1c re-verified by worker post-fix.
**Declare-gate note (BACKLOG):** the true upstream smell is `findSnap` emitting midpoint snaps in TWO shapes (one
with `.shape`, one without) — a consistent snap contract (every shape-hit snap carries `.shape`, or a declared
`selectable` flag) is the clean fix; deferred (shared-contract refactor touching the drawing path, out of scope for a
bugfix).

## (DONE) SP1c: Prepare loop HOVER-HIGHLIGHT (user's first target) + SP1b arc-convention fix — blessed `d1f2020`.

`prepare-view.js` → a Prepare controller `mountPrepareView(state, svgEl)`: `findLoops` once on enter, precompute each
loop's boundary polygon (arcs sampled via `calculateArcPath`+`getPointAtLength` = TRUE curve); on pointermove,
cursor→world, even-odd point-in-loop, **innermost (smallest-area) wins**; highlight = semi-transparent fill+outline in
`--sk-hover`, redraw on hover-CHANGE only (no RAF); pointerleave clears. **Caught + fixed an SP1b bug I let through:**
the loop-finder used the wrong arc convention (center→end) — an arc is `[center, start, end]`, so the edge is
start→end (`joints[1]→joints[2]`); **the SP1b oracle fixture shared the same wrong convention so it passed
spuriously.** Both corrected (verified vs `export.test.js` + live `calculateArcPath`; oracle re-passes). Advisor-
verified: arc fix correct vs ground truth, oracle passes when I ran it, scope Shaper + additive #core (no SketchStudio
code), shell-smoke 12/12, CDP hover logic (nested→inner, outside→none, arc→true curve) sound. **Lesson: a fixture
that encodes the code's own assumption proves nothing — cross-check against the real model.**

## (DONE) SP1b: `#core/loop-finder.js` + oracle — blessed `0c4a4e1`.

PURE + ADDITIVE (2 new files; existing #core untouched). `findLoops(state) → Loop[]` via planar FACE TRAVERSAL:
joint↔edge graph (coincident joints union-find-merged; lines + arc CHORDS as edges; circles = standalone loops); at
each node CCW angular sort + next-clockwise walk → bounded faces (signed area > 0) kept, outer face (CW) dropped =
MINIMAL loops; deterministic ids. Arcs chord-approximated (2-arcs-same-chord ambiguity flagged/deferred; loop keeps
arc shapeId for true-curve render). Advisor-verified: **I ran the oracle — all 8 cases + determinism pass**, incl.
the key "two rects sharing an edge → 2 minimal loops"; additive → SketchStudio byte-identical (shell-smoke 12/12).

## (DONE) SP1a: Prepare renders the Design geometry, joints hidden — blessed `e752e91`.

New `apps/shaper/src/prepare-view.js` `renderPrepareGeometry(state, svgEl)` paints `state.shapes` EDGES
(line/circle/arc via `#core/geometry.js calculateArcPath`) into `#prepare-world-group` — NO joints; does NOT call the
shared `draw()`. `main.js showMode('prepare')` `ensureSketch()`s + REUSES `designController.state` (no 2nd engine),
`engine.solve(500)` once, render-on-demand (no Prepare RAF). Advisor-verified: **zero changes outside `apps/shaper/`**
(shared #core/#ui + SketchStudio byte-identical; `shell-smoke` 12/12 when I ran it), edges match Design exactly, no
joints rendered. Option B (Prepare-local renderer) as planned.

## (DONE) SP1: Shaper Prepare loop-select — INVESTIGATION + PLAN — blessed `6325249` (WORK-LOG only, no code).

Plan: Prepare renders the SHARED #core sketch (`designController.state`), NOT the Explore SVG canvas — REUSE the state
(no 2nd engine), render-on-demand (no solve-RAF in Prepare). Loop detection is NET-NEW → propose `#core/loop-finder.js`
(joint↔edge graph, coincident joints merged, minimal closed cycles = topological loops; cached per geometry change).
Render: option **B** recommended (Prepare-LOCAL renderer, no shared `draw()` change) over option A (gated default-off
flag). Hover = point-in-loop (even-odd). Slices: **SP1a** render joints-hidden → SP1b loop-finder (+oracle) → SP1c
hover-highlight (user's first target) → SP1d selection → SP1e cut-type assignment. Honors the topological-only
decision; Shaper-only; surfaced the loop↔SVG open question (tracked for SP1e). Advisor-verified: WORK-LOG only.

## ✅ S7c ARC COMPLETE — SketchStudio rides the shared #ui/ shell (header + style panel + tool ribbon + Export tab), router-owned nav, full CAD UX, guarded by `shell-smoke.cjs` (12/12). Shaper untouched. (Last: tuning-dock fix `10d9bdf`.)

## (DONE) S7c-fix-tuning-dock: dock the floating dev tuning toggle into the footer — blessed `10d9bdf`.

`tuning-wizard.js` only. The dev tuning toggle (`#btn-tuning-toggle`) floated because its anchor `#btn-settings-toggle`
was removed in 2c → fallback `position:fixed`. Re-anchored after `#btn-mag-toggle` in the footer; dropped the float;
restyled to a small footer button. Advisor-verified: diff correct, `npm run test:shell` still 12/12, scope
tuning-wizard.js only. (Side note: `.tool-btn` CSS now has no live user — joins `.tool-dropdown` dead-CSS, a future
low-value sweep.)

## (DONE) S7c-3: durable shell smoke (DEBT-SHELL-TEST) — blessed `3d8d007`.

Added `scripts/shell-smoke.cjs` (self-contained: tiny static server + headless Edge/Chrome over CDP via Node's
built-in WebSocket — NO puppeteer dep) + `package.json` `test:shell`. Asserts 12 checks: console errors=0; header
tabs Design/Export + Style + Debug; Design-default ribbon groups Create/Inspect/Constrain/Edit + canvas; router both
directions; Style opens the panel (16 controls) + Esc closes. Advisor-verified: **I ran it — 12/12 passed**; oracle
23/23; scope = script + package.json (no app code). The shell now has durable regression coverage.

## (DONE) S7c-2d-cleanup: static removal of the dead inline ribbon (DEBT-RIBBON-CLEANUP) — blessed `259b989`.

Pure deletion (309 del / 6 ins): removed the inline `#toolsRibbon` button markup (index.html) + the dead
rect-dropdown machinery (`setupToolDropdown`/`updateToolButtonUI`/`RECT_MODES_CONFIG`/`_MAP`, ui-manager). Advisor-
verified: oracle 23/23, **no orphaned calls** to the removed funcs (no load crash), behavior unchanged. Worker
grep-confirmed `.tool-btn` CSS is LIVE (tuning-wizard.js:237) → correctly KEPT it; `arc-icon.test.js` passes. Only
residue: a little `.tool-dropdown` dead CSS (low-value, left).

## (DONE) S7c-2e: Export popup→tab (router-owned) — blessed `4587eb7`. **S7c-2 shell arc COMPLETE.**

`#export-panel` floating popup → in-flow `flex-1 overflow-auto` tab view (form in `max-w-md mx-auto`); dropped the
popup `✕`. Removed ui-manager's dead popup-open machinery (`exportBtn`/`closeExport`/outside-esc) — no dangling refs;
kept `#btn-export-do`'s export logic, router returns to Design on Cancel/success. main.js back-to-Design array →
`[btn-export-cancel, btn-export-do]`. `export-panel-html.test.js` properly evolved (asserts in-flow structure + no
popup chrome) and passes. Advisor-verified: oracle 23/23, `closeExport` fully gone, test runs green, scope clean.
→ Studio now rides shared header + style panel + tool ribbon (full CAD UX) + Export tab; router owns nav.

## (DONE) S7c-2d-pre: restore CAD pre-selection workflows via `handleToolActivate` — blessed `e98ab76`.

ui-manager.js only (net −11). Added DOM-button-INDEPENDENT `handleToolActivate(t)` (migrated the per-button logic;
every `.tool-btn`/`#tool-select`/`classList` swap → `setTool()`); `onToolClick:(t)=>handleToolActivate(t)`; removed
the redundant per-button binding loop + `toolIdMap`. Restores pre-selection (firstElement), H/V-immediate,
cancel-on-repeat (now `setTool(SELECT)`, no null-deref), mode-text hints, coincident fresh-start,
dimension-from-selection. Advisor-verified: oracle 23/23, code is a faithful migration of the previously-working
logic, no live null-deref, scope ui-manager.js only.

## (DONE) S7c-2d: Studio adopts the shared tool ribbon — blessed `4530cf6`.

Load-safe (oracle 23/23, ~50-line diff). ui-manager mounts `createToolRibbon({state, onToolClick:(t)=>setTool(t),
extraGroups:[Edit]})` into `#toolsRibbon` via runtime-clear (`innerHTML=''` after the inline wiring binds, so no
warns); `setTool`'s `.tool-btn` active-management → `toolRibbon.refresh()`; main.js's render loop calls `refresh()`
each frame so KEYBOARD `switchToTool` syncs; Edit Clear/Undo via `extraGroups` keep their ids (existing handlers +
undo-`disabled` bind them, R-BIND-ORDER); the Escape auto-SELECT null-deref was found + fixed. Advisor-verified:
oracle 23/23, no live null-deref, scope ui-manager.js+main.js (index.html untouched). **Two follow-ups:** the
per-button pre-selection/H-V-immediate/dimension-from-selection workflows dropped → **S7c-2d-pre** (next, user-confirmed
restore); the dead inline markup/wiring → **DEBT-RIBBON-CLEANUP**.

## (DONE) S7c-2c-fix: restore the over-deleted `#export-panel` test coverage — blessed `4b996d9`.

Tests-only. Added `tests/export-panel-html.test.js` with the 2 still-valid `#export-panel` asserts (header title
styling + `#btn-export-close` styling) that the 2c retirement of `settings-panel-html.test.js` wrongly bundled with
the obsolete `#settings-panel` asserts. `header-icons` + `settings-panel-style` + `settings-panel-html` stay retired.
Advisor-verified: new test passes when run; scope `tests/` only; retirements held.

## (DONE) S7c-2c: Studio adopts shared header + style panel + Design/Export router — blessed `e14b721`.

First live-app slice, load-safe (oracle 23/23). `main.js` mounts `createAppHeader` synchronously into
`#app-header-host` (Debug action `id=btn-debug-toggle` bound by `debug-panel.js`, no double-wire) + `createStylePanel`
(`onSaveProject→saveProjectFile`, `onNotify→showNotification`); `onStyle→toggle`; `showView()` display-toggles
ribbon/main/footer + re-runs `updateView` so the canvas survives tab switches; the `openSettings` gesture → shared
panel; retired the `#settings-panel` popup + the ribbon Actions group. Export tab reuses `#export-panel` (2e
converts it). Advisor-verified: oracle 23/23, wiring on read, `#settings-panel` gone, `#export-panel` intact,
surviving settings tests pass. **Test retirement:** `header-icons` + `settings-panel-style` retired OK;
`settings-panel-html` over-deleted → export half restored in S7c-2c-fix. See DEBT-SHELL-TEST.

## (DONE) S7c-2b: shared `#ui/style-panel.js` (standalone, byte-identical) — blessed `2b8ee6a`.

`createStylePanel({settings?,onSaveProject?,onNotify?,title?})` → `{el,open,close,toggle,render,destroy}`. DOM-
ownership INVERSION: builds its OWN DOM from a 16-control SPEC (vs settings-panel.js adopting `#s-*`). Binds the
shared `#core/settings-manager.js`: `populate`←`getAll`, write→`set{persist:'local'}`, `subscribe`→re-populate with
**`unsub()` called in `destroy()`** (leak-free), Reset→`resetToDefaults`. Owns open/close/toggle + Esc + deferred
outside-click. Save renders only if `onSaveProject`; toast via optional `onNotify` (no Tailwind). Inject-once
`#sk-style-panel-styles`. No adopter → both apps byte-identical. Advisor-verified: `settings-manager` +
`settings-panel-sliders` tests pass; labels match `#settings-panel` HTML; scope `#ui` only.

## (DONE) S7c-2a: shared `#ui/app-header.js` shell (standalone, byte-identical) — blessed `f0fc229`.

`createAppHeader({tabs,actions?,onTabChange?,activeTab?,onStyle?,styleButton?,styleLabel?,styleIcon?})` → `{el,
render(container),setActiveTab(id),getActiveTab(),destroy}`. Tab strip (USER click → highlight + `onTabChange`;
programmatic `setActiveTab` does NOT fire `onTabChange` — no router loop) + right actions area (built-in **Style**
button → `onStyle()`; per-app `actions` keep their id). Inject-once `#sk-header-styles`, `--sk-*` light defaults,
imports nothing; no adopter → both apps byte-identical. CDP smoke errors=0; guard green; baseline 8, 0 net-new.
**Seam for 2c:** header `onStyle: () => stylePanel.toggle()`.

Full 5-slice S7c-2 plan: WORK-LOG @ the revised S7c-2 plan entry (2a header / 2b style panel / 2c Studio adopts
header+style / 2d ribbon / 2e Export-tab / 3 polish).

---

## (DONE) S7c-1: extend the shared ribbon with an `onToolClick` hook. Shaper byte-identical.

S7c plan BLESSED — converges with the advisor steer: keep the ribbon a dumb view, make the click-handler
host-overridable (default `switchToTool` for Shaper; SketchStudio routes to its rich `setTool`/`handleToolActivate`
— behavior STAYS in ui-manager, no rewrite). Split-3: **S7c-1 = extend the module FIRST** (this slice), then S7c-2
SketchStudio wire-up, S7c-3 visual polish. S7c-1 keeps Shaper byte-identical (additive default).

**▶ S7c-1 — in `packages/ui/tool-ribbon.js`:**
1. Add an OPTIONAL `onToolClick(tool)` to `createToolRibbon({ state, extraGroups?, on?, onToolClick? })`. When
   provided, the ribbon calls `onToolClick(tool)` on a tool-button click AND on a rect-variant select (after
   setting `state.rectMode`), INSTEAD of the internal `switchToTool`. When ABSENT, behavior is UNCHANGED (internal
   `switchToTool`) — so Shaper / standalone stay byte-identical.
2. Keep `on('tool'|'rectMode')` events as-is (still emit). `refresh()` unchanged. NO other behavior change — purely
   the additive hook so a host (SketchStudio) can route tool clicks to its own rich handler in S7c-2.

**VERIFY:** CDP — default (no `onToolClick`): clicking a tool still calls `switchToTool` (`state.currentTool`
updates) + rect dropdown still works — UNCHANGED. With `onToolClick` supplied (test stub): clicks call IT instead
(switchToTool NOT called), incl rect-variant select; `state.rectMode` still set; `on('tool')` still fires;
`refresh()` syncs `.active`. **Shaper byte-identical** (still uses the default); SketchStudio untouched (no adopter
yet); both apps load; guard green; baseline ⊆ the 8, 0 net-new.

Append a WORK-LOG entry ending with exactly `=== S7c-1 (RIBBON onToolClick HOOK) DONE — HOLD ===`. **Then STOP.**

---

## (DONE as plan) PLAN S7c: SketchStudio adopts the shared `createToolRibbon`. PLAN ONLY.

User approved: SketchStudio uses the shared toolbar too (one ribbon, no drift). This is the RISKIEST slice — it
replaces SketchStudio's deeply-wired inline `#toolsRibbon` with the shared component; **acceptance = VISUAL parity
(pixel-faithful), NOT byte-identical.** Given the reset history + that this is the polished main app, PLAN it in
detail first. PLAN ONLY (no code).

**▶ INVESTIGATE + propose (WORK-LOG; no code):**
1. **Adoption shape** — replace `#toolsRibbon`'s Create+Inspect+Constrain with the shared `createToolRibbon`;
   provide **Edit** (clear/undo) + **Actions** (settings/debug/export) via `extraGroups`. Confirm the shared
   ribbon's Create/Inspect/Constrain matches SketchStudio's set exactly.
2. **Wiring reconciliation** — how do the `extraGroups` buttons (clear/undo/settings/debug/export) reach
   SketchStudio's EXISTING handlers (`ui-manager.js` — currently bound by id: `#btn-clear`/`#btn-undo`/
   `#btn-settings-toggle`/`#btn-debug-toggle`/`#btn-export`)? Same ids so existing bindings still attach, or wire
   via the ribbon's `on`/`onClick` callbacks? Pick the clean one.
3. **Tool `.active` sync** — `ui-manager` currently syncs `.active` on tool change (`TOOL_MODES`→button-id). The
   shared ribbon has its own `refresh()`. RECONCILE so there's ONE source (does ui-manager call `ribbon.refresh()`,
   or does the ribbon's sync replace ui-manager's loop?) — avoid double-sync/conflict.
4. **rect/arc dropdowns** — the shared ribbon's rect dropdown vs ui-manager's `RECT_MODES_CONFIG`: one source of
   truth; confirm arc stays single-mode.
5. **Pixel parity** — HOW to verify the de-Tailwind'd shared ribbon visually matches today's Tailwind ribbon
   (screenshot diff and/or computed-style comparison of button size/spacing/labels/active state). State the bar.
6. **Sub-slice?** — is S7c one slice or should it split (e.g. wire-up vs visual-polish)? Recommend.
7. **Risks** — visual regression, the deep ui-manager wiring, settings/debug/export handlers, the footer/modeText
   (left as-is?), reset-risk (slice; this is SketchStudio — extra care).

Append a WORK-LOG entry ending with exactly `=== S7c PLAN READY — HOLD ===`. **Do NOT implement. Then STOP.**

---

## (DONE) S7b: Shaper Design adopts the shared ribbon (TOP) + collapsible list/DOF side panel. Shaper-only.

S7a blessed (`ae3de47`) — shared `createToolRibbon` standalone, byte-identical. User chose: ribbon at the TOP +
KEEP the constraint list/DOF as a side panel (Shaper Design = SketchStudio ribbon + the live overview). Shaper-ONLY
→ SketchStudio byte-identical. **Canvas untouched.**

**▶ S7b — Shaper Design view (`apps/shaper/...`):**
1. **Top ribbon** — mount `createToolRibbon({ state })` in a FULL-WIDTH bar at the TOP of `#design-view` (above the
   panel+canvas row), replacing the simple `createDesignToolPalette`. Dark via `--sk-*` (Shaper's `:root`). Wire
   `ribbon.refresh()` into the existing render tick so `.active` tracks the current tool (ribbon click OR keyboard).
2. **Layout** — below the ribbon, a flex ROW: the LEFT side panel now holds ONLY `createDesignInfoPanel`
   (constraint list + DOF — keep it) | the canvas (UNTOUCHED). Tools are no longer in the left panel.
   **The side panel is COLLAPSIBLE** — a small toggle (chevron) collapses it to a thin strip / hides it so the
   canvas goes full-width (clean SketchStudio-style view), and expands it back to the list/DOF. Persist the
   collapsed state. Don't touch the canvas when toggling (it just reflows).
3. **Cleanup** — Shaper no longer uses `createDesignToolPalette`. If `packages/ui/design-tool-palette.js` has NO
   other users (confirm — SketchStudio doesn't use it), REMOVE it + its import (surgical orphan cleanup). If unsure,
   leave it + flag.
4. Shaper-ONLY → SketchStudio byte-identical.

**VERIFY:** CDP — Shaper Design shows a FULL-WIDTH top ribbon (Create/Inspect/Constrain, icon-over-label, dark);
clicking a ribbon tool switches it (`state.currentTool`) + draws; keyboard tool-switch also syncs the ribbon's
`.active`; the LEFT panel shows the live constraint list + DOF; the canvas is unchanged; clicking a constraint row
highlights it; rect dropdown works; other modes (Explore/Prepare/Sim) still switch. SketchStudio UNTOUCHED
(byte-identical); both apps load, errors=0; guard green; baseline ⊆ the 8, 0 net-new.

Append a WORK-LOG entry ending with exactly `=== S7b (SHAPER ADOPTS RIBBON) DONE — HOLD ===`. **Then STOP.**

---

## (DONE) S7a: extract the shared `#ui/tool-ribbon.js` (standalone, byte-identical).

S7 plan BLESSED — split is right (CREATE+INSPECT+CONSTRAIN shared; EDIT optional; ACTIONS app-specific via
`extraGroups`); the `extraGroups`/`on` hooks serve the north star (any host — a pen-plotter, etc. — appends its own
groups around the SHARED sketcher ribbon). S7a = the standalone extraction (byte-identical; nothing adopts it yet).

**▶ S7a — build `packages/ui/tool-ribbon.js`:**
1. `createToolRibbon({ state, extraGroups?, on? })` → `{ el, render(container), refresh, destroy }`. Renders the
   SHARED groups (icon-over-label `.tool-btn`): **Create** (select/line/rect[+2pt/center/3pt dropdown]/circle/arc
   [+variant menu]), **Inspect** (dim), **Constrain** (coincident/h-v/parallel/perp/collinear/tangent/equal/
   midpoint). Optional **Edit** (clear/undo) — built-in or via `extraGroups`, your call. `extraGroups` lets a host
   append app-specific groups; `on` surfaces button events the host wires.
2. **Wire** buttons to the shared tools — reuse `switchToTool` (+ the constraint tools), like
   `createDesignToolPalette`. `refresh()` syncs `.active` to `state.currentTool`. The rect/arc dropdowns set the variant.
3. **Icons (keep byte-identical)** — the ribbon must resolve its `#icon-*` glyphs in ANY host. Use an
   **inject-IF-MISSING (idempotent)** sprite strategy: on mount, inject only `<symbol>`s NOT already in the
   document. In SketchStudio (symbols already present inline + via `cursor-manager`) → nothing re-injects
   (byte-identical); a bare host / Shaper gets them. Don't double-inject or clash IDs.
4. **Styling** — plain CSS (de-Tailwind'd faithfully), `--sk-*`-themed so it's light in SketchStudio / dark in
   Shaper from the SAME component. Self-contained (inject its `<style>` once, like other `#ui/` widgets).
5. **Standalone** — no app adopts it yet → BOTH apps byte-identical.

**VERIFY:** CDP smoke in ISOLATION — `createToolRibbon({state})` renders the groups + icon-over-label buttons; the
rect/arc dropdowns open + set variants; clicking a tool calls `switchToTool` (`state.currentTool` updates);
`refresh()` syncs the `.active` highlight; icons resolve (no broken `<use>`). Both apps load + **byte-identical**
(no adopter); guard green; baseline ⊆ the 8, 0 net-new.

**NOTE for S7b (don't act yet):** a SketchStudio-style ribbon is HORIZONTAL/full-width — at S7b we'll likely put it
at the TOP of Shaper's Design view (above the canvas), NOT in the 244px left panel. The Design LAYOUT (top ribbon
vs the S6b left panel; what happens to list/DOF) is an S7b decision — surface options then.

Append a WORK-LOG entry ending with exactly `=== S7a (SHARED TOOL RIBBON) DONE — HOLD ===`. **Then STOP.**

---

## (DONE as plan) PLAN S7: extract SketchStudio's TOOL RIBBON → shared `#ui/`. PLAN ONLY.

User direction: Shaper's Design tool **buttons** should look like SketchStudio's ribbon (grouped, icon-over-label),
and since BOTH apps have a Design tab, the ribbon should be **SHARED** (other tabs can differ per app). **The canvas
is FINE — do NOT touch it.** Scope = the tool BUTTONS only. Given the reset history, PLAN it in slices first. PLAN
ONLY (no code).

**▶ INVESTIGATE + propose (WORK-LOG; no code):**
1. **SketchStudio's ribbon** (`apps/sketchstudio/index.html` `#toolsRibbon` + its `<style>` + the SVG icon sprite):
   the GROUPS (Edit / Create / Inspect / Constrain / Actions), each button (id, sprite icon `#icon-tool-*`, label),
   the rect/arc **dropdowns** (variants), and the `.tool-btn` styling (Tailwind classes + inline `<style>`).
2. **Shared vs app-specific** — which groups are the SHARED sketcher ribbon (Create + Inspect + Constrain — tools
   that act on the shared sketch) vs app-shell (Edit = clear/undo; Actions = settings/debug/export — likely
   app-specific)? Propose the shared ribbon's contents.
3. **Extraction** — a `#ui/` ribbon component (renders groups/buttons/icons + the rect/arc dropdowns) + **plain-CSS**
   styling (de-Tailwind'd, `--sk-*`-themed so it's light in SketchStudio / dark in Shaper) + the **icon sprite**
   shared (move to `#ui/` or inject). Buttons wire to the shared tools (`switchToTool` + the constraint tools).
4. **Adoption** — Shaper Design replaces the simple `createDesignToolPalette` with the shared ribbon; SketchStudio
   replaces its inline `#toolsRibbon` with the shared one (**VISUALLY identical, NOT byte-identical** — sequence
   it LAST + use a visual-parity acceptance bar, like the dock-adopt plan).
5. **Slice sequence** — e.g. S7a extract shared ribbon (standalone, byte-identical) → S7b Shaper adopts → S7c
   SketchStudio adopts (visual parity). Each: both apps load, guard + baseline green.
6. **Risks** — rect/arc dropdowns, icon-sprite sharing, Tailwind→plain-CSS fidelity, SketchStudio visual identity,
   the reset-risk (keep sliced).

Append a WORK-LOG entry ending with exactly `=== S7 PLAN READY — HOLD ===`. **Do NOT implement. Then STOP.**

---

## (DONE) S6b: Design mode's FIXED side panel (list/DOF top, tools bottom; retire floating dock). Shaper-only.

S6a blessed (`8893d08`) — 4-mode nav + router in, `isActive` tied to `currentMode==='design'`, byte-identical. S6b
gives Design mode its final shape: replace the floating `TabbedDockPanel` with a PLAIN FIXED side panel.

**▶ S6b — Shaper Design view (`apps/shaper/...`):**
1. **Fixed side panel** — in `#design-view`, lay out a FIXED side column (flex row: panel | canvas; panel on the
   **LEFT**, not floating, not draggable). Inside it (flex column): **`createDesignInfoPanel` (constraint list +
   DOF) on TOP**, **`createDesignToolPalette` (tools) at the BOTTOM** (this REVERSES S5c2's order). Reuse the
   existing factories — just mount them in the fixed panel instead of the dock tabs.
2. **Retire the floating dock for Shaper** — remove `buildDock`/`createTabbedDockPanel` usage + its now-dead import
   from `main.js`. **KEEP `packages/ui/tabbed-dock-panel.js`** (don't delete — other/later uses).
3. **Live refresh carries over** — keep the `onRender → dockTick` refresh wiring (now refreshing the panel's info +
   palette). Dark theming automatic (`--sk-*`). Shaper-ONLY → SketchStudio byte-identical.

**VERIFY:** CDP — Design mode shows a FIXED side panel (does NOT float) with the constraint list + DOF on TOP and
the tool buttons at the BOTTOM; clicking a tool switches it (`state.currentTool`) + draws; the list/DOF live-update
as you draw; clicking a constraint row highlights it on the canvas; dark; no floating `.sk-dock`. The other modes
(Explore/Prepare/Sim-Export) + the nav still work. SketchStudio UNTOUCHED (byte-identical); both apps load,
errors=0; guard green; baseline ⊆ the 8, 0 net-new.

Append a WORK-LOG entry ending with exactly `=== S6b (DESIGN FIXED PANEL) DONE — HOLD ===`. **Then STOP.**

---

## (DONE) S6a: Shaper 4-mode nav + view router (Explore/Design/Prepare/Sim-Export). Shaper-only.

S6 plan BLESSED (matches the advisor's independent map). S6a = the SKELETON: the 4-mode header nav + a view
router over 4 containers. **Design KEEPS its current floating dock this slice** (S6b swaps it for the fixed panel).
Shaper-ONLY → SketchStudio byte-identical. SLICE it — no big-bang (reset history).

**▶ S6a — `apps/shaper/index.html` + `src/main.js`:**
1. **Header nav** — replace the `#tab-design` Design button + the `← Editor` back toggle with a **4-mode nav**:
   `Explore | Design | Prepare | Simulate/Export` (active one highlighted).
2. **View containers** (show one, hide the rest):
   - **Explore** = the existing `main.layout` (SVG editor) — DON'T touch its internals; just make it the
     Explore-mode container. `Open SVG`/`Fit`/`Export(SVG)` are Explore-mode actions.
   - **Design** = `#design-view` (the sketcher) — KEEP the current floating dock for now (S6b changes it).
   - **Prepare** = a new stub view (`Prepare — cut type + toolpath (coming soon)`).
   - **Simulate/Export** = a new stub view (`Simulate / Export (coming soon)`) — distinct from Explore's SVG Export.
3. **Router** — clicking a mode shows its container, hides the others (replaces `showDesign`/`showEditor`). PERSIST
   the active mode (localStorage). Init the editor ONCE; the router just shows/hides.
4. **Design lifecycle + coexistence** — mount the sketcher once; RAF `start()` when Design becomes active, `stop()`
   when it leaves. **Tie the input `isActive` gate to "Design mode is active"** (NOT just design-view visibility)
   so Explore/Prepare/Sim-Export keystrokes never reach the sketcher (R-COEXIST).
5. Shaper-ONLY → SketchStudio byte-identical.

**VERIFY:** CDP — the 4 mode tabs switch views (one visible, active highlighted); Explore = the SVG editor (Open
SVG/Fit/Export still work); Design = the sketcher renders (dock still present this slice), RAF starts on enter /
stops on leave; Prepare + Sim/Export = stubs; a keypress in Explore does NOT mutate the sketch (isActive gate);
active mode persists across reload. SketchStudio UNTOUCHED (byte-identical); both apps load, errors=0; guard
green; baseline ⊆ the 8, 0 net-new.

Append a WORK-LOG entry ending with exactly `=== S6a (4-MODE NAV + ROUTER) DONE — HOLD ===`. **Then STOP.**

---

## (SUPERSEDED — done as plan) PLAN S6: restructure Shaper's shell into a 4-mode app nav. PLAN ONLY.

User defined the target app structure (live iteration): the **top nav = the 4 modes**, each with its own tools,
replacing the old `Design`/`Export` buttons:
- **Explore** = today's SVG editor (renamed).
- **Design** = the sketcher (canvas + a **DOCKED** side panel — NOT floating — with the **constraint list + DOF on
  TOP** and the **tool-palette buttons at the BOTTOM**).
- **Prepare** = cut type + toolpath (stub for now).
- **Simulate/Export** = cut sim + export (stub for now).

This is a real shell restructure. **Given this project's history (a big restructure got RESET), PLAN it in load-safe
slices first — do NOT big-bang it.** PLAN ONLY (no code this turn).

**▶ INVESTIGATE + propose (WORK-LOG; no code):**
1. **Current shell** — map Shaper's `index.html` + `src/main.js`: the header (the `Open SVG/Fit/Export/Design`
   buttons), the SVG-editor body, `#design-view`, the editor↔Design toggle, the floating dock mount.
2. **Target structure** — a 4-mode app nav in the header (Explore/Design/Prepare/Sim-Export) + 4 view containers +
   a simple view router (show one, hide others). Removes the old `Design`/`Export` buttons + the `← Editor` toggle.
   Where do `Open SVG`/`Fit` live (Explore-mode actions?).
3. **Design mode** — replace the floating `TabbedDockPanel` with a FIXED docked side panel that reuses
   `createDesignInfoPanel` (list/DOF, TOP) + `createDesignToolPalette` (tools, BOTTOM). What becomes of the
   `TabbedDockPanel` widget — retired for Shaper, or kept for other uses?
4. **Explore mode** = the existing SVG editor, shown under the Explore tab (minimal change to it).
5. **Slice sequence** — propose load-safe slices (e.g. S6a nav router + 4 view containers, Explore=editor /
   Design=existing / Prepare+Sim-Export=stubs; S6b Design fixed-panel + tools-at-bottom; …). Each: Shaper loads,
   SketchStudio byte-identical, guard + baseline green.
6. **Risks** — editor/Design wiring, the reset-risk (keep sliced), persistence, anything that should stay.

Append a WORK-LOG entry ending with exactly `=== S6 PLAN READY — HOLD ===`. **Do NOT implement. Then STOP.**

---

## (DONE) TASK — S5-fix (Shaper): move the workflow tabs INTO the header + strip the stale banner. Shaper-only.

User feedback after seeing the dock: (a) the Design-view banner **"Design — shared #core sketcher (click to add
line points)"** is "not useful" (leftover S1 demo scaffolding); (b) **"make the tabs in the header"** — the
workflow tabs (Design/Prepare/Export/Settings) should live in the HEADER as primary nav, NOT inside the floating
panel. So: header carries the TABS; the panel shows only the active tab's CONTENT.

**▶ Fix:**
1. **`TabbedDockPanel` gains an option `tabStripTarget`** (a host DOM element): when provided, render the tab
   strip INTO that element (the app header) instead of atop the floating panel, and the panel shows ONLY the
   active tab's content (no internal tab strip). Tab clicks still switch content + sync the active highlight +
   persist. **Default (no `tabStripTarget`) = tabs atop the panel — unchanged, so nothing else is affected.**
2. **Shaper** — pass the top header bar (the `SVG Editor … Open SVG | Fit | Export | Design` row, or a clean
   strip just under it) as `tabStripTarget`, so Design/Prepare/Export/Settings render in the HEADER. Keep the
   existing buttons + the `← Editor` toggle working.
3. **Strip the stale banner** (`— shared #core sketcher (click to add line points)`); keep `← Editor`.
4. Shaper-ONLY → SketchStudio byte-identical (it doesn't use the dock; the `tabStripTarget` default is unchanged).

**VERIFY:** Shaper Design view — the tabs (Design/Prepare/Export/Settings) appear in the HEADER; clicking a header
tab switches the floating panel's content; the panel shows the active content with NO internal tab strip; the
stale banner text is gone; `← Editor` still works; dark; persists active tab. The widget's default (tabs atop the
panel) still works in isolation (CDP smoke). Both apps load; guard green; baseline ⊆ the 8, 0 net-new.

Append a WORK-LOG entry ending with exactly `=== S5-FIX (TABS IN HEADER) DONE — HOLD ===`. **Then STOP.**

---

## (SUPERSEDED) TASK — S5c2: build a shared Design tool palette + mount in Shaper's dock Design tab. S5c2 ONLY. (Shaper-only mount.)

S5c blessed (`b6ad527`) — Shaper's Design view has the live dock (info panel, dark). S5c2 adds the **tool palette**
to the Design tab (Shaper has no toolbar → this is its tool access; SketchStudio keeps its `#toolsRibbon`). Built
shared in `#ui/`, mounted in SHAPER only → SketchStudio byte-identical.

**▶ S5c2:**
1. Build `packages/ui/design-tool-palette.js`: `createDesignToolPalette({ state, … })` → `{ el | render(body),
   refresh, destroy }`. Buttons for the DRAW tools (select, line, rect, circle, arc) — each sets the current tool
   (reuse the existing tool-switch path; active tool highlights). `render(body)` shape (drops above the info panel
   in the Design tab); themed `--sk-*`.
2. **Constraints** — first determine how SketchStudio APPLIES constraints: button-driven (toolbar) vs canvas-driven
   (select joints → inference/apply). If button-driven, add constraint buttons (coincident/⊥/∥/=/dim) wired to the
   EXISTING apply path. If canvas-driven, NOTE constraints are already applied on-canvas (shared) → palette is
   draw-tools only for v1. **Don't reinvent the apply path — reuse it.**
3. Mount the palette in Shaper's dock Design tab, ABOVE the S5b info panel. `refresh()` reflects the active tool.
   Shaper-only mount → SketchStudio byte-identical. **GATE/split** if the constraint wiring is sizable.

**VERIFY (state how):** CDP — Shaper's dock Design tab shows the tool palette; clicking a draw-tool button switches
the tool (`state.currentTool`) + highlights; drawing still works on the canvas; (if constraint buttons) clicking
applies the constraint to the selection; dark-themed. **SketchStudio UNTOUCHED** (doesn't mount the palette —
byte-identical); both apps load, errors=0; guard green; baseline ⊆ the 8, 0 net-new.

Append a WORK-LOG entry ending with exactly `=== S5c2 (DESIGN TOOL PALETTE) DONE — HOLD ===`. **Then STOP.**

---
### Queued after this (advisor-owned backlog — do NOT start without dispatch)
- **Variable / parameter system (CORE feature, user-flagged)** — named parameters reusable across dimensions,
  e.g. `width = 7`; a dimension's value can REFERENCE a variable (and ideally an expression, `height = width*2`);
  change the variable once → re-solve everything. The heart of parametric CAD. Spans `packages/core` (dimensions
  resolve variable refs; the solver uses the resolved value) + UI (a variables panel + the dim input accepting
  names). Belongs to the shared Design tab → every host (incl a pen-plotter) gets parameters. See
  [[project-design-tab-reusable]].
- **Shaper Explore should match the Design style (user-flagged)** — the Explore tab (the original SVG editor)
  keeps its own light look while Design is now dark + ribboned + polished; restyle Explore (header / tree / canvas
  / inspector) to the dark `--sk-*`-consistent chrome so Shaper reads as ONE app. Shaper-only polish; after the S7
  ribbon work.
- **Free-center shapes-form TANGENT over-refused by the createEngine sandbox** (worker-flagged @`6cbf22d`,
  pre-existing engine/solveConstraints divergence — not introduced by the refuse work). Low priority.
- **v1 tabbed dock-panel shell** — per `docs/architecture/UI_SHELL.md`. Toolbar facts for the build:
  `#toolsRibbon` = one flex row, 5 sections **EDIT·CREATE·CONSTRAIN·INSPECT·ACTIONS**; handlers bind by
  `id`/`.tool-btn` (reparenting safe); ⚠ `ui-manager.js:~319` grabs `#toolsRibbon` for drag-scroll.
- **Merge (×3, kinds TBD) + scissor** — non-destructive (keeps joints editable + constrained).
- **Merge carve-out → main / deploy** (confirm `_redirects` on the preview) — separate track.

---
Slice 1 (three in-place extractions, one commit each, reviewed between) is **done and fully blessed**:
- ✅ **Commit 1 — metrics → `onMetrics`** (`a8245de`): sole `createEngine` caller updated (load-safe),
  core stopped touching `window`. Oracle 12/12.
- ✅ **Commit 2 — notify → `setConstraintNotifier`** (`5d73c02`): leak gone (no `showNotification`
  in `core/`), 4 call-sites repointed verbatim, wired in `main.js`, real-symptom notifier test passed.
- ✅ **Commit 3 — drop dead snap pass-throughs** (`18e0a22`): pure removal — engine `findSnap`/
  `hitJointAtScreen` had zero callers (shell imports `snap-detection` directly); orphaned `svg` option
  dropped. `node --check` OK, no surviving `.findSnap`/`.hitJointAtScreen` in `src/`.
- WORK-LOG recorded at `9dc279a`. **Oracle 12/12 at HEAD.** Branch `carve-out`, app loads.

**Net effect of slice 1:** `constraint-solver.js` and `core/constraint-manager.js` no longer import
the UI/shell or touch `window` — the brain is now import-clean of the shell, so the `git mv` to
`packages/core` won't drag UI imports along. That was the whole point of doing the extractions first.

## After slice 1 (do NOT start without advisor go) — needs a fresh GATE
- **Shell batch:** `git mv` shell → `apps/sketchstudio`, AND extract the geometry screen helpers →
  `apps/sketchstudio/coords.js` at the same time (importers touched once). Big `git mv`s carry
  re-export shims at OLD paths so imports resolve through the move — but **never a `core → apps/`
  re-export**.
- **Core batch:** `git mv` core → `packages/core` + co-locate the solver oracle → `packages/core/tests`.
- ✅ **Cloudflare DECIDED (human gate):** move `index.html` into `apps/sketchstudio` and change the
  Pages **Build output directory** `/` → `apps/sketchstudio`. The dashboard change is a HUMAN action
  timed with the merge to `main` (the `carve-out` branch move doesn't affect live deploy). NOT a thin
  root loader.
- **[DEBT-1]** solver-config `localStorage` → injected persistence adapter (deferred).
