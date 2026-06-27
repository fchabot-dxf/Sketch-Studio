# NEXT-SESSION — handoff (tactical)

> What to do *right now*. For the strategy behind it, read **ROADMAP.md**.
> Last updated: Phase 0 complete & committed; the Phase 1 **workspace carve-out** is the next action (detailed in §1 below).

## TL;DR

**Phase 0 (solver honesty + robustness) is COMPLETE and committed** on branch `solver-robustness`:
Blocker 1 (`88336cd`), Blocker 2 (`8fe623c`), point-on-circle medium (`a4d423e`) — each pinned by
a fail-first repro test, full solver suite green. **Do this first — the Phase 1 workspace
carve-out:** reshape this single-app repo into the monorepo (`packages/core` + `apps/sketchstudio`
+ `apps/shaper`), browser-native ESM + import map, **no bundler** — full step-by-step in §1 below.
Everything else (the `_detectConflict` watch-item test) waits until after. One deliberate,
behavior-preserving structural move: green solver tests before and after.

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

### 1. Phase 1 — workspace carve-out  ⭐ DO THIS FIRST

Phase 0 behavior work is done & committed, so this is now the one clean **structural** move:
reshape this single-app repo into the monorepo from ROADMAP.md → "Phase 1 carve-out — target
layout" (`packages/core` brain + `apps/sketchstudio` + `apps/shaper`, browser-native ESM + import
map, **no bundler**). Do it before anything else; the watch-item test (§2) waits.

**Preconditions — clear these IN ORDER, before any `git mv`:**

- **A. Clean the tree.** Commit any stray edits (this file included) so the structural-move commits
  don't tangle with doc/other changes — `git status --short` must be empty.
- **B. Integrate Phase 0 to `main`, then branch off it.** Phase 0 currently lives ONLY on
  `solver-robustness` (`88336cd` B1 · `8fe623c` B2 · `a4d423e` pt-on-circle · `b8e258c` docs);
  `main` (`44c6d4b`) can **fast-forward** — clean linear history, no divergence:
  ```
  git checkout main && git merge --ff-only solver-robustness
  git checkout -b carve-out
  ```
  Pushing `main` auto-deploys Phase 0 to Cloudflare — fine (solver fixes only, no structural
  change). Do the carve-out **on `carve-out`, NOT on `main`**: the `index.html` move must not reach
  the deploy until the Cloudflare call (step 4 gotcha) is made and verified.
- **C. Record the baseline oracle.** Run the per-file solver loop now; confirm every `solver-*`
  test green. That green set proves the move preserved behavior — re-run it after.

**Procedure (verifiable; commit after each batch):**

0. **Safety.** `git checkout -b carve-out`. **Snapshot the untracked Shaper Origin Editor folder**
   (`C:\Users\danse\APPS\Shaper Origin Editor` — no `.git`, no safety net) before touching it.

1. **Map the brain/shell boundary BEFORE moving — THREE buckets, not two.** The DOM grep is
   necessary but NOT sufficient. Run it to find DOM-touchers:
   `grep -rlnE "document|window\.|requestAnimationFrame|innerHTML|getElementById|localStorage" src/`
   then classify EVERY `src/` file into one of three:
   - **pure logic + app-agnostic → `packages/core`** (the brain; #4 framework-free).
   - **pure logic BUT app-specific / shell-orchestration → `apps/sketchstudio`.** DOM-free does NOT
     auto-promote to core — anything Shaper/CNC/export-shaped, or that merely wires the UI, is shell
     (#6: no app logic in the brain).
   - **touches DOM → `apps/sketchstudio`** — EXCEPT a mostly-pure module with one stray
     `window`/`document` hook: that goes to **core, with the leak EXTRACTED** (emit via a callback
     the shell wires up — don't exile the logic). Known case: `constraint-manager.js` →
     `window.__updateSolverMetrics` (the Blocker 1 watch-item; a #4 violation to fix during the move).

   Best-guess starting split (VERIFY against the grep — don't trust blind):
   - → core: `src/core/solver/*`, `src/core/{geometry,joints,shapes,constraints,constraint-manager,
     constraint-status,solver-config}.js`, `src/constraint-solver.js`, `src/solver-core.js`, units,
     `src/inference-engine.js` (interaction seam).
   - → sketchstudio: `src/main.js`, `ui-manager.js`, `svg-renderer.js`, `snap-detection.js`,
     `settings-manager.js`, `src/ui/**`, `index.html`, `styles/`, `assets/`.

   **▶ GATE — post the proposed core/shell list (and where each DOM hit landed) for north-star
   review BEFORE any `git mv`.** Misclassification is cheap now, expensive once files move and
   imports rewire. No moves until the list is blessed.

2. **Skeleton.** `mkdir -p packages/core apps/sketchstudio apps/shaper`.

3. **Move WITH history.** `git mv` core files → `packages/core/…`, shell files →
   `apps/sketchstudio/…`, in logical batches. The Shaper folder is untracked → copy it into
   `apps/shaper/` then `git add` (gains git history for the first time). Co-locate tests: solver
   tests → `packages/core/tests/`, UI tests → `apps/sketchstudio/tests/`.

4. **Rewire imports (ESM import map — no bundler).** Add an import map to each app's `index.html`,
   e.g. `<script type="importmap">{"imports":{"@core/":"/packages/core/"}}</script>` (path is the
   **serving** root). Shell imports of the brain `../src/… / ./core/…` → `@core/…`. Fix intra-core
   relative paths that shifted. **Node tests do NOT read HTML import maps** → keep test imports as
   **relative paths** (or add a `package.json` `"imports"` map); don't use `@core/` in Node tests.

5. **Verify behavior preserved (the whole point).** Re-run the per-file solver loop → the same
   tests green. Then **serve** `index.html` (via `server.js`) and smoke-test in a browser: sketch
   loads, constraints solve, drag is stable. `file://` won't honor the import map — you must serve.

6. **Cut over the workspace.** Reopen VS Code on the new single root (File → Open Folder); retire
   the multi-root workspace. Update CONTEXT.md "Project layout" + key paths to the new tree.

**Gotchas specific to this refactor:**
- ⚠ **Cloudflare deploy breaks if `index.html` leaves the repo root.** Pages is configured output
  `/`, branch `main`, no build (see CONTEXT.md gotchas). Moving `index.html` into
  `apps/sketchstudio/` will 404 the deploy. Either keep a thin root `index.html` that loads the
  app, or change the Pages **output directory** to `apps/sketchstudio`. Decide deliberately.
- Use `git mv` (preserves history) — never delete + recreate.
- Import-map paths are relative to the **serving** root — verify by serving, not `file://`.
- Optional final polish (AFTER the move is committed & verified): rename the on-disk root to a
  neutral name (`cad-platform`) and flatten the `…\SketchStudio Newton Raphson\Sketch-Studio`
  nesting. Don't do it mid-move — it confuses git/VS Code.

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
- **The carve-out IS the current task** (Phase 0 is done). Make it ONE deliberate, behavior-
  preserving structural move — green solver tests before and after the `git mv`, no behavior
  changes interleaved. See §1.
- **Don't edit `.env`** (Cloudflare token). **Don't commit `.triggers/`** (in .gitignore).
