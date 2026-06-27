# NEXT-SESSION — handoff (tactical)

> What to do *right now*. For the strategy behind it, read **ROADMAP.md**.
> Last updated by the session that committed Blocker 1 and implemented Blocker 2 (branch `solver-robustness`).

## TL;DR

**Phase 0 (solver honesty + robustness) is COMPLETE and committed** on branch `solver-robustness`:
Blocker 1 (`88336cd`), Blocker 2 (`8fe623c`), point-on-circle medium (`a4d423e`) — each pinned by
a fail-first repro test, full solver suite green. Next: **the Phase 1 carve-out** — promote this
repo to the platform root and split into `packages/core` + `apps/sketchstudio` (+ `apps/shaper`).
Optional/anytime: the `_detectConflict` watch-item test. The carve-out reorganizes folders and the
VS Code workspace — do it deliberately, as one move.

## Where we are exactly

### Blocker 1 — DONE ✅ (committed — branch `solver-robustness`, `88336cd`)

The solver no longer returns `converged:true` while a constraint is unsatisfied. Geometry — not
the engine's step-norm flag — now decides convergence.

- **Changed:** `src/constraint-solver.js` (wire through the already-computed per-constraint
  geometric residuals; derive `converged` from them vs `VERIFIER_TOLERANCE`; return
  `error = max geometric residual` + a `conflicts` list), and `src/core/solver/engine.js` (the
  `x0.length === 0` early-return now checks the assembled residual instead of unconditionally
  claiming `converged:true`).
- **Added:** `tests/solver-converged-honesty.test.js` — the regression test. Fails on the
  original code (first assertion: `converged` was `true`), passes now.
- **Verified independently this session** (not just trusted from the report):
  - `node tests/solver-converged-honesty.test.js` → passes. Mode A: `converged:false, error:5,
    conflicts:[c_dist]`. Mode A/engine: `converged:false, error:5`. Mode B (parallel+angle30):
    `converged:false, error:0.263, conflicts:[c_ang, c_par]`.
  - All **10** `solver-*` tests pass → no regressions.
  - Diff audited: surgical (only the two named spots), headless (no DOM/app coupling), so it
    rides through the future `git mv` untouched.

**Committed** on branch `solver-robustness` (off `main`), commit `88336cd` — both source changes
+ the test in one commit. All 10 `solver-*` tests green; the 8 unrelated DOM/wizard failures were
confirmed pre-existing by stashing the changes and re-running.

### ⚠ Watch-item carried out of the Blocker 1 review (not a blocker — record it)

Blocker 1 changed the wrapper's `solve()` return contract: `error` went from *engine step-norm*
→ *geometric residual (world units/radians)*. Every live caller was audited; all fine except one
ripple in `src/core/constraint-manager.js` (the conflict-detection sandbox, ~lines 199-214):
`errors.push(result.error)` now feeds **geometric** residuals into `_detectConflict(errors,
CONFLICT_THRESHOLD)`. This is almost certainly a **latent fix** — `CONFLICT_THRESHOLD` is
documented as "world units — same as verifier tolerance", so the heuristic was *always* meant to
see a world-unit residual but was previously fed a step-norm (a unit mismatch). The loop is
bounded (`BURSTS=3`, no runaway), so it's safe to ship. **But `_detectConflict` has no test** —
add a targeted before/after test for the sandbox conflict path soon so this heuristic is pinned
to the new, correct input scale.

### Blocker 2 — DONE ✅ (committed: `8fe623c`)

The undamped Gauss-Newton **polish** step (`src/core/solver/engine.js`, the `try{}` block after
the LM loop, ~579-603) flung geometry near rank-deficiency: the Cholesky guard `EPS` in
`src/core/solver/algebra.js` `choleskySolve` was `1e-14` — so loose that a near-singular pivot
(~1e-10) passed and back-substitution emitted a ~1e10-magnitude step, accepted because the
mouse-spring-dominated cost dropped → next frame pulled it back → bounce.

- **Changed:** `src/core/solver/algebra.js` — one line, `EPS` `1e-14` → `1e-8`. Near-singular
  matrices are now **rejected** (`ok=false`), so the polish's own `if (ok)` already skips the
  undamped step and the stable, damped LM result stands. (This is the "skip the undamped step,
  keep the damped result" reading of the damped-step strategy — minimal, one variable, and it
  sharpens `rankDeficient` detection too. `1e-8` sits safely above the LM-damped pivot floor
  (~`lambdaInit` `1e-3`), so the main LM loop is untouched.)
- **Added:** `tests/solver-polish-bounce.test.js` — deterministic fail-first: asserts
  `choleskySolve` rejects near-singular SPD matrices (which produced `maxdx ~1e10` before), still
  solves a well-conditioned system correctly, and that a rank-deficient sketch solves to a finite,
  bounded result flagged `rankDeficient`. Fails on the original `EPS`, passes after.
- **Verified:** bounce test passes; full suite shows only the **8** pre-existing DOM/wizard
  failures — all fail identically on the original code; no new regressions; every `solver-*`
  test (incl. rank-deficiency & cholesky-coincident) green.
- **Deliberately NOT done (one variable at a time):** excluding mouse-spring rows from the polish
  accept test, and the cheap config amplifiers (lower `DRAG_STRENGTH`, rAF-throttle the
  pointermove→solve, clamp the solver `dx`). The guard fix removes the fling at its root —
  revisit these only if the interactive bounce repro still shows residual wobble.

### Medium — point-on-circle — DONE ✅ (committed: `a4d423e`)

Snap creates a `pointOnLine` targeting a circle, but `engine.js` `_assemble` synthesized joints
only for `shape.type === 'line'` → empty joints → NaN → the point was silently never pulled.
**Fixed:** `_assemble` handles circle/arc targets (`joints=[point, center]`, radius captured from
the shape as a constant) and `point_on_line` gained a point-on-circle branch (residual =
`dist(point, center) − radius`, moving only the point — mirrors `constraint-verifier`). Test
`tests/solver-point-on-circle.test.js` (point pulled (8,6)→(4,3) onto the radius-5 circle).

## Next actions, in order

### 1. Phase 1 — the carve-out (the next big move)

See ROADMAP.md → "Phase 1 carve-out — target layout". Promote this repo to the platform root;
split `src/` into `packages/core` + `apps/sketchstudio`; bring the old Shaper Origin Editor folder
in as `apps/shaper`. Run the three green blocker tests before and after the `git mv` as proof the
structural move preserved behavior. Reopen VS Code on the new single root then — not before. ONE
deliberate structural move; don't interleave behavior changes.

### 2. (Anytime, not blocking) targeted test for the conflict-detection sandbox

Pin `_detectConflict` (`constraint-manager.js`) to the new geometric-residual input scale — see
the watch-item above.

## Key paths (verified this session)

- Repo root: `C:\Users\danse\APPS\SketchStudio\SketchStudio Newton Raphson\Sketch-Studio`
- Solver wrapper / orchestrator: `src/constraint-solver.js`
- Newton-Raphson engine (the math): `src/core/solver/engine.js`
- Cholesky / linear algebra: `src/core/solver/algebra.js`
- Per-constraint residual + Jacobian: `src/core/solver/definitions.js`
- Drag-impulse pre-pass: `src/core/solver/interaction.js`
- Tunable knobs: `src/core/solver-config.js`
- Conflict-detection sandbox (watch-item): `src/core/constraint-manager.js`
- Tests: `tests/solver-*.test.js`

## How to run things

- Single test (use this while iterating): `node tests/solver-converged-honesty.test.js`
- All solver tests: `for f in tests/solver-*.test.js; do node "$f"; done`
- Full suite (per-file, reliable): `for f in tests/*.test.js; do node "$f"; done` — **8**
  pre-existing DOM/wizard test files fail under bare node (unrelated to the solver); every
  `solver-*` test passes. `npm test` (`node scripts/run-tests.js`) halts on first failure and its
  `await import` doesn't truly await each async test, so prefer the per-file loop while iterating.

## Caveats / things to know

- **Recalled line numbers may have drifted.** Trust the *described defect*, not the line number —
  re-verify against the current file before editing (this is exactly how Blocker 1 was handled).
- **CONTEXT.md lineage:** `CONTEXT.md` predates the platform pivot. Its "solver robustness ALL
  DONE" list (relaxation pre-pass, branch lock, rank-deficiency detection, drag-step cap) was a
  *different, earlier* backlog. The current Blocker 1/2 + point-on-circle work came from
  *reproducing the user's specific "bouncy / doesn't reflect the constraint" complaints* — a
  separate diagnosis. Both are true; don't read CONTEXT.md as "solver is finished."
- **No build / no bundler** is a confirmed preference — never introduce one.
- **Don't reorganize folders or change the VS Code workspace yet.** Phase 0 (the blockers) runs
  in the current structure. One structural move, later, at carve-out.
- **Don't edit `.env`** (Cloudflare token). **Don't commit `.triggers/`** (in .gitignore).
