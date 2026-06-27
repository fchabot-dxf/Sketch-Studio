# Sketch-Studio — context for next session

> Paste this whole document into the next agent (e.g. Claude Code in VS Code) at the start of the session. It captures everything decided so far so you don't have to re-explain.

> **Companion docs:** `ROADMAP.md` = the plan + the six north-star principles · `NEXT-SESSION.md`
> = the current task in flight · **this file** = the environment, architecture, deployment, and
> gotchas a fresh agent needs. Keep all three current.

## What this project is

A 2D CAD sketch application with constraint solving (Newton-Raphson + Levenberg-Marquardt). Browser-based, ES modules, no bundler. Used personally for designing G-code paths for an Ultimate Bee CNC running a DDCS Expert 1.1 controller.

**Current direction — platform pivot.** SketchStudio is becoming the **first shell of a shared "one brain, many shells" CAD platform**: a headless, app-agnostic core (model · constraint solver · geometry · units · interaction) reused by SketchStudio, a **Shaper Origin** cut-path editor, and future apps (laser / 3D-print / other CNC). The solver in this repo *is* that brain and is being **reused, not rewritten**. We're in **Phase 0** — finishing solver honesty/robustness (the blockers) in the current structure, before the Phase 1 monorepo carve-out. Plan + principles live in `ROADMAP.md`.

- **GitHub:** https://github.com/fchabot-dxf/Sketch-Studio
- **Live:** https://sketch-studio.pages.dev (Cloudflare Pages, auto-deploys on push to `main`)
- **Local:** `C:\Users\danse\APPS\SketchStudio\SketchStudio Newton Raphson\Sketch-Studio`
- **Backup elsewhere:** `C:\Users\danse\Dropbox\DDCS Expest repo\Sketch-Studio` (do not modify)

## Architecture in one paragraph

`index.html` at repo root loads `src/main.js` as an ES module; that module imports the rest of `src/`. Tailwind comes in via the **CDN script** in `index.html` (no local compile). The constraint solver is a Newton-Raphson + Levenberg-Marquardt engine in `src/core/solver/engine.js` with analytic Jacobians per constraint and Cholesky linear solve. Tests are plain Node ESM modules in `tests/`, run via `node scripts/run-tests.js`. Deployment is just `git push` — Cloudflare Pages does the rest with no build command configured.

## Project layout

```
Sketch-Studio/                  (repo root, also web root served by Cloudflare)
├── index.html                  Tailwind CDN + favicon + entry script tag
├── server.js                   Local dev server (optional)
├── src/
│   ├── main.js                 App entry, render loop
│   ├── ui-manager.js
│   ├── svg-renderer.js         141 KB; the big one. Renders everything.
│   ├── snap-detection.js
│   ├── constraint-solver.js    Orchestrator (calls solver-core)
│   ├── solver-core.js          14-line facade → delegates to NewtonSolver
│   ├── solver-core.legacy.js   Old relaxation solver, kept for reference
│   ├── inference-engine.js
│   ├── core/                   Engine internals
│   │   ├── solver/
│   │   │   ├── engine.js       NewtonSolver class (~450 LOC, the actual math)
│   │   │   ├── algebra.js      Cholesky, Gram matrix
│   │   │   ├── definitions.js  Per-constraint residual + Jacobian
│   │   │   └── interaction.js  Drag-impulse pre-pass
│   │   ├── solver-config.js    Tunable parameters (LM_LAMBDA_INIT, tolerances)
│   │   ├── settings-manager.js User-tunable settings (UI-driven)
│   │   ├── constraint-manager.js
│   │   ├── constraint-status.js
│   │   ├── constraints.js
│   │   ├── geometry.js
│   │   ├── joints.js
│   │   ├── shapes.js
│   │   └── ...
│   └── ui/                     UI managers + input handlers
├── tests/                      ~110 test files, plain ESM, run via npm test
├── scripts/                    run-tests.js, build-inline.cjs, smoke-test.cjs
├── docs/                       architecture/, ai/, development/, features/
├── assets/                     constraint glyph SVGs/XMLs
├── .env                        CLOUDFLARE_API_TOKEN (legacy; not used for deploy now)
├── .gitignore                  node_modules/, .env, .triggers/, .wrangler/, etc.
├── package.json                3 scripts: test, test:unit, build:inline. Zero devDeps.
└── package-lock.json
```

## Solver state — what's there

The Newton-Raphson engine is implemented and working. From earlier analysis:

- `engine.js` (`NewtonSolver`): assembles full m×n Jacobian, builds normal equations `A = JᵀJ` and `g = Jᵀr`, adds LM damping `A[i,i] += λ`, solves with in-place Cholesky.
- λ init `1e-3`, `×10` up on bad step, `×0.1` down on good.
- Convergence: residual `√(2·cost) < 1e-6` OR step magnitude `< 1e-6`.
- Iter cap: 2000.
- Coincident-joint clustering (lines 27-78 of engine.js) handles one common rank-deficiency case.
- Optional zero-damping polishing pass at the end.
- `solver-core.js` is a 14-line facade that just calls `createNewtonSolver()` and `engine.solve()`.

## What got done this session

1. Recovered from a corrupted Google Drive sync that was truncating `package.json` and creating 0-byte `node_modules` files. **Project is no longer on Google Drive** — local-only now.
2. Wiped a toxic `.git` directory at `C:\Users\danse\` that had been silently tracking the entire user profile (including `AppData/Roaming/Autodesk/`, which had been ending up on GitHub). Repo is now clean.
3. Phase A: deleted cruft (`.venv/`, `.wrangler/`, `output/`, `count_syntax.js`, `tailwind.config.cjs`, dead duplicate scripts, `desktop.ini` files everywhere).
4. Phase B: flattened the tree — removed the nested `sketch-studio-unified-Newton-Ralphson/` wrapper. `index.html` and `src/` now live at the repo root. Updated 235 path references across tests and scripts.
5. Phase D: dropped the local Tailwind compile pipeline. The app already loaded Tailwind via CDN (`<script src="https://cdn.tailwindcss.com">` in `index.html`). Deleted `src/style.css`, `src/tailwind.css`, `src/style/` (b-spline-gen CSS sheets that didn't fit). Removed `tailwindcss` and `@tailwindcss/cli` from devDependencies. Removed `build:css` and `watch:css` scripts.
6. Set up Cloudflare Pages with **GitHub auto-deploy** (no build command, output `/`, branch `main`). Old "sketchstudio" Direct-Upload project still exists in their Cloudflare account; can be deleted.
7. Test environment cleanup — fixed 3 of 4 issues:
   - `src/core/solver-config.js`: added `typeof require === 'function'` and `typeof localStorage !== 'undefined'` guards. No more warnings from these on every test run.
   - `src/svg-renderer.js:734`: stricter guard `typeof document.getElementById === 'function' && document.head` — was failing because the test stub document only mocks `createElement`, not `getElementById`.
8. Updated `README.md` to describe the CDN setup. Updated `scripts/README.md` to list only the scripts that still exist.

## What's still to do

### 1. One real test failure (low priority — pre-existing)

`tests/ai-vision-label-spacing.test.js` fails with `Expected label text lines at AI_VISION=false`. The test calls `draw()` with one joint and expects `<text class="debug-joint-label">` elements in `svg.innerHTML`. None appear. Started a diagnostic script but the auto-runner choked on `{}` characters in the inline JS — abandoned that approach. Next agent has terminal access and can run the diagnostic directly. Probable cause is somewhere in the `if (showDebugOverlay)` block in `svg-renderer.js` lines 345-735, or in how `SettingsManager.set()` interacts with the renderer's read.

### 2. Solver robustness — current status

The live to-do is in **NEXT-SESSION.md**. Short version, on branch `solver-robustness`:

- **Blocker 1 — "converged but lying"** ✅ **committed** (`88336cd`): geometry now decides
  convergence; `solve()` returns a `conflicts` list and `error` as the max geometric residual.
- **Blocker 2 — "bouncy" drag** ✅ implemented & **staged, pending bounce-repro review**:
  Cholesky guard `EPS` `1e-14`→`1e-8` in `algebra.js` so the undamped polish step is skipped near
  singularity and the damped LM result stands.
- **Medium — point-on-circle silently ignored** ← next (before exposing circle snapping).

These three came from reproducing the user's **"bouncy / doesn't reflect the constraint"**
complaints. Separately, an **earlier** robustness backlog already landed — relaxation pre-pass,
branch lock, rank-deficiency detection, drag-step cap — those four are done and detailed below.
See `docs/architecture/SOLVER_WALKTHROUGH.md` for the engine walkthrough.

- ~~**Relaxation pre-pass before Newton.**~~ ✅ Steepest-descent with optimal Cauchy step (`α = ‖g‖²/‖Jg‖²`) + Armijo backtracking, in `engine._preRelax`. Toggle via `SolverConfig.RELAX_PREPASS_ENABLED`. Test: `tests/solver-relaxation-prepass.test.js`.
- ~~**Branch locking on tangent / perpendicular.**~~ ✅ Tangent gets `branch: 'external' | 'internal'` (default external); perpendicular gets `branch: +1 | -1` using the combined residual `cross(u,v) − branch·‖u‖‖v‖` (single row, no kinks, no local minima on the wrong half). Auto-detected at constraint creation by `ConstraintManager.lockTangentBranch` / `lockPerpendicularBranch`. Test: `tests/solver-branch-lock.test.js`.
- ~~**Rank-deficiency detection.**~~ ✅ Polishing pass's undamped Cholesky doubles as a rank-deficiency probe; `result.rankDeficient` is plumbed through `lastSolveStats.rankDeficient` so the existing `window.__updateSolverMetrics` UI hook receives it. Test: `tests/solver-rank-deficiency.test.js`. UI panel still needs to render the flag — that's a tiny renderer-side follow-up, not engine work.
- ~~**Drag step cap.**~~ ✅ `SolverConfig.MAX_DRAG_STEP` (default 100 world units) clamps the per-frame `dragTarget` distance from the joint's current position. Set to 0 to disable. Test: `tests/drag-step-cap.test.js`.

### 3. Detailed walkthrough of `src/core/solver/` ✅ DONE

Written as `docs/architecture/SOLVER_WALKTHROUGH.md`. Covers file map, data structures, packing/unification, assembly, the four-stage solve pipeline (pre-pass → LM → polish → rank check), the constraint zoo with branch-lock formulations, tunable knobs, known limitations, extension recipes, and the test surface.

## Gotchas / things to know

- **VS Code is running another AI agent in parallel.** Coordinate edits — don't both modify the same file at once. The user uses both alongside each other.
- **Never put this project on Google Drive / OneDrive / Dropbox sync paths.** It corrupts files (truncated package.json, 0-byte node_modules). Local-only is the new rule.
- **Do not edit `.env`.** It contains a Cloudflare API token. Hands-off.
- **Do not commit `.triggers/` to git** (already in .gitignore). It's a tooling folder for a file-watcher pattern that this session set up but is no longer needed if you have direct terminal access.
- **Mount cache flakiness:** if you're running through a sandboxed bash with the project mounted via a cloud bridge (some Anthropic agents do this), expect lag — Windows-side reads via direct file tools are reliable, sandbox bash sometimes shows stale content.
- **Tailwind comes from a CDN.** Don't try to "fix" the missing local Tailwind compile — it's intentionally gone. The CDN script in `index.html` does the work in-browser.
- **Cloudflare Pages config:** Build command empty, Build output directory `/`, Production branch `main`. Don't change these unless we actively want a build step.
- **Test runner caveats:** tests are loaded sequentially via `await import()`. Each test file wraps in `(async () => {...})().catch(e => process.exit(1))`. A failure halts the run — there's no per-test isolation.

## User profile (Frederic / dansemur@gmail.com)

- Practical CAD/CNC user, not a web developer.
- Designs G-code in Fusion 360 for an Ultimate Bee CNC running a DDCS Expert 1.1 controller.
- Has several parallel hobby projects (`b-spline-gen`, `frame-builder`, `template-maker`, `ddcs-studio-project`, etc.) — different design system from Sketch-Studio.
- Strong preference for minimal back-and-forth, clear actionable steps, no lectures.
- Hates tooling friction. Don't ask permission for obvious fixes.
- The phrase "now the real work begins" came after the cleanup — meaning the *real work* is the solver, not the infrastructure.

## Suggested first move for next session

**→ `NEXT-SESSION.md` governs** (currently: commit Blocker 2 after the bounce-repro review, then
point-on-circle, then the monorepo carve-out). The items below are older background ideas — *not*
the current task:

1. **UI surface for `rankDeficient`** — wire the new flag through `lastSolveStats.rankDeficient` to a visible "sketch is under-constrained" indicator. Renderer-side work, not engine.
2. **Triage pre-existing failures** — 23 broken tests, most are DOM-stub issues (`document is not defined`); a few are stale assertions from before the engine evolved. Worth one cleanup pass to either fix or quarantine.
3. **Extend branch lock pattern** — Parallel currently has the `alignParallelOrientation` swap-at-creation hack; could be replaced with a proper branch field for symmetry with perp/tangent.
4. **Conflict UX from `rankDeficient` + residual** — combine "well-constrained but won't converge" (over-constrained, conflicts) with rankDeficient to surface a meaningful per-constraint diagnostic.

Note: test runner (`scripts/run-tests.js`) halts on first failure. Run individual files with `node tests/<name>.test.js` while iterating; the nine solver/drag tests all pass.

## Test suite status (as of relaxation pre-pass session)

- 78 tests pass when run individually (including the new `solver-relaxation-prepass.test.js`).
- 23 pre-existing failures, none introduced by the pre-pass. Buckets:
  - **DOM-dependent UI tests** (~15): `document is not defined`, `document.createElement is not a function`, etc. Tests load UI modules in pure Node. Pre-existing.
  - **Stale solver assertions** (~5): `mouse-spring-structural`, `jacobian-dof-audit`, `cluster-dof-sync`, `cascading-fixity`, `radial-locked` — confirmed unchanged by toggling pre-pass off. The `mouse-spring-structural` test, for instance, expects `b ≈ 0` but the cost minimum with stiffness=1e8 mouse spring vs unit-weight coincident is mathematically `b ≈ 99.999999`.
  - **Misc**: `constraint-conflict` (NotificationManager DOM dep), `midpoint-inference*` (logic regression), `live-dimension-race`, `input-manager-midpoint`.
