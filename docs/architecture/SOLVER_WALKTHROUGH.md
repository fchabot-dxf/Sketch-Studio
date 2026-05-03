# Constraint Solver — Code Walkthrough

> **Purpose:** Deep, file-by-file reading of `src/core/solver/*` and the modules that wrap it. Aimed at any future maintainer (human or AI) who needs to change the math, debug a sketch that won't converge, or extend the constraint vocabulary.
>
> Maintained alongside the code — when you change the algorithm, update this doc.

---

## 1. What the solver does, in two sentences

Given a `Map<id, {x, y, fixed}>` of joints, an array of geometric constraints, and an array of shapes, the solver moves every non-fixed joint so that all constraints are simultaneously satisfied (residual ≈ 0). It does this by formulating the problem as a least-squares minimization of `½‖r(x)‖²` over the free coordinates `x`, then solving with a four-stage hybrid: **(1)** coincident-cluster unification, **(2)** steepest-descent pre-pass, **(3)** Levenberg-Marquardt-damped Newton iterations, **(4)** a final undamped Gauss-Newton polishing step that doubles as a rank-deficiency probe.

```
joints + constraints + shapes
        │
        ▼
  ┌─────────────┐   pack: assign each free joint to a column index
  │   _pack     │   (coincident clusters share one column)
  └──────┬──────┘
         ▼  x ∈ ℝⁿ
  ┌─────────────┐   relaxation pre-pass: a few cheap steepest-descent
  │  _preRelax  │   steps with optimal Cauchy step length, only if the
  └──────┬──────┘   initial residual is large enough to be worth it
         ▼
  ┌─────────────┐   LM loop: assemble J and r, build (JᵀJ + λI), solve
  │  LM main    │   via Cholesky, accept/reject step by cost change,
  └──────┬──────┘   adapt λ × 10 / 0.1
         ▼
  ┌─────────────┐   polishing pass: zero-damping Gauss-Newton; the
  │   polish    │   Cholesky outcome here is also the rank check
  └──────┬──────┘
         ▼
  unpack → joints mutated in place
  return { converged, error, rankDeficient }
```

---

## 2. File map

```
src/
├── constraint-solver.js          UI-facing engine wrapper. Manages stats,
│                                 emits to tuning wizard, plumbs config.
├── solver-core.js                14-line façade so old call sites still work.
└── core/
    ├── solver-config.js          User-tunable parameters with localStorage.
    └── solver/
        ├── engine.js             NewtonSolver class — _pack, _assemble,
        │                         _preRelax, solve, _checkRankDeficient.
        ├── algebra.js            Dense linear algebra: gram, atx, Cholesky.
        ├── definitions.js        Per-constraint computeError + computeJacobian.
        └── interaction.js        InteractionSolver — mouse spring.
```

The engine is intentionally self-contained: `engine.js` imports from `algebra.js`, `definitions.js`, `interaction.js`, and `solver-config.js`, but nothing UI-related leaks into the solver core.

---

## 3. Data structures the engine consumes

| Input | Shape | Notes |
|-------|-------|-------|
| `joints` | `Map<string, {x:number, y:number, fixed?:boolean, dragTarget?:{x,y}}>` | `j_origin` is implicitly fixed; mutated in place after solve. |
| `constraints` | `Array<{type:string, joints?, shapes?, value?, branch?, ...}>` | See [definitions.js](#7-the-constraint-zoo-srccoresolvedefinitionsjs) for per-type fields. |
| `shapes` | `Array<{id:string, type:'line'|'circle'|'arc', joints:[...], radius?:number}>` | Used by tangent / collinear / parallel / perpendicular synthesis. |

Output: the input `joints` are mutated in place, and `solve()` returns `{converged: boolean, error: number, rankDeficient: boolean}`.

---

## 4. Variable packing & the coincident cluster trick (`_pack` / `_unpack`)

`_pack` builds the search vector `x ∈ ℝ²ᵏ` where `k` is the number of free coordinate-pair variables. Naïvely, `k` would be the count of non-fixed joints. The trick: **coincident joints share a single variable**.

Why this matters: if joints `a` and `b` are constrained `coincident`, the assembled Jacobian has two columns (one for `a`'s position, one for `b`'s position) that the constraint forces to be identical. This makes `JᵀJ` rank-deficient — the solver hits the LM `λ`-bump path repeatedly, wasting iterations.

The fix (engine.js:27-78): for every non-fixed joint, transitively walk the `coincident` constraint graph via `getCoincidentJoints` (in `joints.js`) to build the full cluster. Pick the first member by insertion order as the "representative" and map *every* member of the cluster to the representative's column index. Assembly later sums Jacobian contributions from every member into that one column (engine.js:265-272), so no information is lost.

`_unpack` (engine.js:82-94) writes the solved positions back to *all* members of each cluster, keeping their stored `x`/`y` consistent.

`_positionsFromVector` (engine.js:97-113) builds a "dense" position array indexed by joint insertion order — this is what the `Definitions` per-constraint code reads.

---

## 5. Assembly: building `r` and `J` (`_assemble`)

This is the heart of the engine (engine.js:116-296). Given a current `x`, it produces:
- `r ∈ ℝᵐ` — residual vector (one scalar per constraint row)
- `J ∈ ℝᵐˣⁿ` — Jacobian, row-major in a flat `Float64Array`

### Two passes

**Pass 1 — count rows.** Each constraint contributes a known number of rows (engine.js:120-148):
- If `def.rows` is a number → use it.
- If `def.rows` is a function → call it on the constraint (added to support variable-row constraints; currently unused after the perpendicular branch lock was simplified to one row, but kept for future use).
- A few legacy types (`coincident`, `collinear`, `mouse_spring`) are hardcoded.

**Pass 2 — fill `r` and `J`.** For each constraint:
1. Translate joint IDs to dense indices using a temporary `jointIndexMap`.
2. Synthesize `params.joints` from `params.shape`/`params.shapes` for shape-based constraints (`pointOnLine`, `tangent`, `collinear`, `parallel`, `perpendicular`, `equal`). This "synthesis" is engine.js:212-262 and is mostly defensive — it normalizes the many input shapes the solver has historically accepted.
3. Call `def.computeError(params, densePositions)` — returns scalar or array.
4. Call `def.computeJacobian(params, densePositions, outRow|outRows)` — fills a length-`(2 · numJoints)` buffer (one entry per dense position component).
5. Reduce dense columns down to packed columns by summing over each cluster's members (engine.js:260-272 for multi-row, engine.js:279-289 for single-row).

### The mouse_spring shortcut

`mouse_spring` is special-cased at engine.js:171-200 because it isn't really a sketch constraint — it's a temporary 2-row attractor injected by `InteractionSolver` during a drag. Its rows contribute `√stiffness · (current − target)` and a unit Jacobian on the target joint's column. With stiffness ≈ `1e7`, the spring dominates the cost surface, so the dragged joint goes where the cursor goes (subject to other constraints).

---

## 6. The four-stage solve pipeline (`solve()`)

`solve(iter, options)` is engine.js:392-474. The story in order:

### 6.1 Stage zero — drag detection and spring attach

If the caller passed `options.dragTarget`, or any joint has a `dragTarget` field set by the UI input handler, an `InteractionSolver` attaches a `mouse_spring` constraint to `this.constraints` and returns a cleanup function. The spring stays attached for the duration of `solve()` and is removed at the end.

### 6.2 Stage one — relaxation pre-pass (`_preRelax`)

**Why:** Newton converges quadratically *inside* its basin of attraction, but when started far away it can oscillate, blow up the LM damping `λ` to huge values, or land on a bad local quadratic model and reject step after step. A handful of cheap steepest-descent steps moves us close enough that LM's quadratic model is accurate.

**The math** (engine.js:299-374):
- gradient `g = Jᵀr` (we already need `Jᵀr` for LM, so this is free)
- direction is `−g` (steepest descent)
- linearized cost `cost(α) = ½‖r + αJd‖²` → optimal `α = ‖g‖² / ‖Jg‖²` (the "Cauchy step")
- accept the step if cost actually drops, otherwise halve `α` (Armijo backtracking, up to 6 times)

**Skip and handoff thresholds:**
- If initial residual `< prepassResidualSkip` (default 1e-3), the pre-pass doesn't run — Newton alone will finish in 2-3 steps.
- During the pre-pass, if residual drops below `prepassHandoffResidual` (default 1e-2), we exit the pre-pass loop and let LM take over.

If the pre-pass converges all the way to `tol`, we still run a rank-deficiency check before returning, so the caller gets an accurate `rankDeficient` flag even on the early-exit path.

### 6.3 Stage two — Levenberg-Marquardt main loop

For each iteration (engine.js:429-485):
1. `_assemble` to get the current `J` and `r`.
2. Compute cost `½‖r‖²` and check the convergence guard `√(2·cost) < tol` — if so, we're done.
3. Build normal equations: `A = JᵀJ` (via `Algebra.gram`), `g = Jᵀr` (via `Algebra.atx`).
4. Add LM damping: `A[i,i] += λ + 1e-12` (the `1e-12` is a numerical floor to keep Cholesky happy on diagonally-tiny rows).
5. Solve `(A + λI) dx = −g` via `Algebra.choleskySolve` (in-place, destructive).
6. **If Cholesky failed** (matrix not positive-definite): `λ *= lambdaUp`, retry next iteration. Bail at `λ > 1e12`.
7. **If Cholesky succeeded:** evaluate cost at the candidate `x + dx`. If lower than current cost → accept the step and decrease `λ` (`λ *= lambdaDown`, but never below `lambdaInit`). Otherwise reject and increase `λ`.
8. Convergence by step magnitude: if `maxStep < tol`, declare converged.

The two convergence criteria — residual norm and step magnitude — are both important. Residual catches "we hit the target." Step magnitude catches "we can't make progress" (which can mean either converged or stuck — see [§9 known limitations](#9-known-limitations)).

### 6.4 Stage three — polishing pass + rank check

After the LM loop (engine.js:489-516):
1. One final `_assemble`.
2. Build `A = JᵀJ` with **no** damping.
3. Try `Algebra.choleskySolve(A, n, dx)`. **The outcome is the rank-deficiency signal**: success ⟺ `JᵀJ` is positive-definite ⟺ `rank(J) = n` ⟺ the sketch is well-constrained. We capture `rankDeficient = !ok`.
4. If Cholesky succeeded, apply the polish step but only if it reduces cost by a meaningful margin (`cost_polish < ½ · finalError²`). This guards against floating-point creep that makes things slightly worse.

The final return is `{ converged, error: finalError, rankDeficient }`.

### 6.5 The fast path for empty problems

If `_pack` returns `x.length === 0` (no free coordinates at all — every joint is fixed), `solve` short-circuits to `{ converged: true, error: 0, rankDeficient: false }` without doing any work.

---

## 7. The constraint zoo (`src/core/solver/definitions.js`)

Each entry has three things:
- `rows`: how many scalar residual rows this constraint contributes (a number, or a function of `params` for variable-row cases).
- `computeError(params, positions) → number | number[]`: the residual(s).
- `computeJacobian(params, positions, outRow | outRows) → void`: writes derivatives into the caller-provided buffer(s), indexed by dense position component.

### The vocabulary

| Type | Rows | Residual | Notes |
|------|-----:|----------|-------|
| `distance` | 1 | `‖a−b‖ − value` | Standard Euclidean distance constraint. |
| `point_on_line` | 1 | `(P−A) × (B−A) / ‖B−A‖` | Signed perpendicular distance. Jacobian only updates the *point*, not the line endpoints — by design the point snaps to the line, not vice versa. |
| `coincident` | 2 | `[ax−bx, ay−by]` | Two scalar rows. Cluster unification in `_pack` usually makes this constraint trivially satisfied at the variable level. |
| `horizontal` | 1 | `ay − by` | Same Y. |
| `vertical` | 1 | `ax − bx` | Same X. |
| `parallel` | 1 | `cross(u, v)` where `u = b−a`, `v = d−c` | Cross product = 0 means colinear directions. The pre-processor `alignParallelOrientation` swaps endpoints to prevent anti-parallel flip. |
| `perpendicular` | 1 | `dot(u, v)` (no branch) **or** `cross(u,v) − branch · ‖u‖‖v‖` (branch ±1) | See [§7.1 branch lock](#71-branch-lock-on-perpendicular). |
| `tangent` | 1 | line-circle: `(C−A) · (B−A)` ; circle-circle: `‖C₂−C₁‖ − target` where `target = r₁+r₂` (external) or `|r₁−r₂|` (internal) | See [§7.2 branch lock](#72-branch-lock-on-tangent). |
| `equal` | 1 | `length₁ − length₂` (lines) or `r₁ − r₂` (circles/arcs) | |
| `collinear` | variable | one perpendicular-distance residual per joint past the first two | Joints-based (N−2 rows) or shapes-based (sum−2). |
| `midpoint` | 1 | distance from mid to `(ep1+ep2)/2` | |
| `angle` | 1 | angular difference modulo π | Has its own normalization to handle 180° symmetry of lines. |

### 7.1 Branch lock on `perpendicular`

The naïve perpendicular constraint is `u · v = 0`, which is **symmetric under v → −v**. Under a continuous drag, the solver can flip one line through 180° and still satisfy the constraint — visually, the sketch snaps inside-out.

**Branch-locked formulation** (definitions.js:225-275): when `params.branch` is `+1` or `−1`, the residual changes to:

```
r = u × v − branch · ‖u‖ · ‖v‖
```

This is zero **iff** `sin(θ) = branch`, i.e. `θ = +90°` (branch +1) or `θ = −90°` (branch −1). Single residual, no kinks, single global minimum at the chosen perpendicular configuration.

**An earlier attempt** used `[u·v, max(0, −branch·cross(u,v))]` (a 2-row formulation with a one-sided guard). It created a local minimum at the wrong-half perpendicular plus length-shrunk because the guard's gradient could balance the dot's gradient. The combined `cross − branch·‖u‖‖v‖` formulation has no such local minima.

**Auto-detect at constraint creation:** `ConstraintManager.lockPerpendicularBranch` (constraint-manager.js:760-780) computes the current `cross(u, v)` and sets `branch = sign(cross)`. Skipped when `|cross| < 0.1·‖u‖·‖v‖` (i.e. lines within ~5° of parallel) — the branch is undefined there; the user can re-add the constraint when geometry is clearer.

### 7.2 Branch lock on `tangent`

For circle-circle tangent there are two valid configurations:
- **External** (default): `‖C₂−C₁‖ = r₁ + r₂` — circles touch on the outside.
- **Internal**: `‖C₂−C₁‖ = |r₁ − r₂|` — one circle inside the other.

`params.branch === 'internal'` switches the target distance; `'external'` (or unset) is the default. The Jacobian is identical for both branches — the partial derivatives of `‖C₂−C₁‖` w.r.t. center positions don't depend on the constant target.

**Auto-detect:** `ConstraintManager.lockTangentBranch` picks whichever target the current center distance is closest to. Defaults to `'external'` when ambiguous (e.g. equal radii, where internal target collapses to zero).

---

## 8. Tuning knobs (`solver-config.js`)

Everything tunable lives in one place. The keys that the solver actually reads:

| Key | Default | Effect |
|-----|--------:|--------|
| `ITERATIONS` | 500 | Max LM iterations per `solve()`. |
| `LM_TOL` | 1e-6 | World-space convergence tolerance. |
| `LM_LAMBDA_INIT` | 1e-3 | Starting damping. |
| `LM_LAMBDA_UP` | 10 | Multiplier on bad/rejected step. |
| `LM_LAMBDA_DOWN` | 0.1 | Multiplier on good step. |
| `RELAX_PREPASS_ENABLED` | `true` | Toggle the steepest-descent pre-pass. |
| `RELAX_PREPASS_ITERS` | 10 | Max pre-pass iterations. |
| `RELAX_PREPASS_SKIP_RESIDUAL` | 1e-3 | Skip pre-pass when initial residual is below this. |
| `RELAX_PREPASS_HANDOFF` | 1e-2 | Hand off to LM when pre-pass residual drops below this. |
| `MAX_DRAG_STEP` | 100 | Per-frame world-space cap on the dragTarget seen by the solver. 0 disables. |
| `DRAG_STRENGTH` | 1.0 | Multiplier on mouse-spring stiffness (final stiffness ≈ `DRAG_STRENGTH × 1e4`). |

`SANDBOX_ITERATIONS` (default 50) is used by `ConstraintManager._sandboxVerify` for conflict detection, not by the engine directly.

---

## 9. Known limitations

- **Polishing pass uses zero damping.** When `JᵀJ` is near-singular, the polish step can be huge. Currently guarded by "only accept if cost halves," but a near-singular Jacobian can still produce a misleading `rankDeficient` flag if numerical noise tips Cholesky one way or the other.
- **Convergence by step magnitude can lie.** `maxStep < tol` declares converged even at high residual — happens when LM damping is so high the step shrinks below tolerance. The returned `error` exposes the actual residual, but a caller that only checks `converged` will be misled. Workaround: also test `error < someTolerance`.
- **Multi-row constraints capped at 2 rows.** `_assemble` allocates `outRows` as a length-2 array (engine.js:268). Adding a 3+ row constraint requires extending this.
- **Synthesis logic for shape-based constraints is fragile.** The big `if (!params.joints)` block in `_assemble` (engine.js:212-262) special-cases each shape-based constraint type. New shape types will need new branches here.
- **`mouse_spring` cleanup leaks on exception.** `cleanup()` only runs at the end of `solve()`. If `_assemble` throws partway through, the temp constraint stays in `this.constraints`. Mostly theoretical (LM is straight-line code), but worth knowing.
- **No conflict detection at solve time.** Over-constrained sketches that have no valid solution converge to "best fit" with non-zero residual. The caller (`constraint-solver.js → constraint-verifier.js`) post-processes per-constraint residuals to identify the worst offender; the solver itself doesn't flag this.

---

## 10. How to extend

### Adding a new constraint type

1. Define it in `definitions.js` with `rows`, `computeError`, `computeJacobian`.
2. If it's shape-based (uses `params.shape`/`params.shapes`), extend the synthesis block in `_assemble` (engine.js:212-262) so joint indices get filled in.
3. Add to `CONSTRAINT_TYPES` in `core/constants.js`.
4. Plumb through `ConstraintManager.validateParams` and (optionally) `_mathPreCheck` for early conflict detection.
5. Add a test under `tests/solver-*.test.js`.

### Adding branch lock to another multi-solution constraint

Use the perpendicular/tangent pattern:
1. Add an optional `branch` field to the constraint.
2. Modify `definitions.js` to switch residual formula based on `params.branch`.
3. Add an auto-detect helper in `ConstraintManager` similar to `lockPerpendicularBranch`.
4. Wire it into `createConstraint` in `constraint-manager.js`.
5. Update `core/constraints.js` `createConstraint(type, params)` to *preserve* the branch field on the persisted constraint object (otherwise it gets stripped).

### Tuning convergence behavior

- Solver runs slowly → reduce `ITERATIONS` cap or relax `LM_TOL`.
- Solver overshoots / oscillates on hard sketches → increase `LM_LAMBDA_INIT` (start more conservative).
- Drag feels sluggish → increase `MAX_DRAG_STEP` or `DRAG_STRENGTH`.
- Sketch-end crashes when geometry is far from satisfied → confirm `RELAX_PREPASS_ENABLED = true`.

---

## 11. Test surface

All solver-relevant tests live under `tests/solver-*.test.js` plus `tests/drag-step-cap.test.js`. They run via `node tests/<file>.test.js` (the project's test runner halts on first failure, so individual invocation is usually how you iterate). Current set:

| File | Covers |
|------|--------|
| `solver-cholesky-coincident.test.js` | Coincident clustering produces a non-singular `JᵀJ`. |
| `solver-convergence.test.js` | Already-satisfied sketch is a no-op (no joint movement). |
| `solver-core-uses-newton.test.js` | `solver-core.js` façade delegates to Newton. |
| `solver-pack-coincident.test.js` | `_pack` correctly unifies coincident clusters. |
| `solver-tangent-arc-arc.test.js` | Circle-circle tangent reduces center distance. |
| `solver-relaxation-prepass.test.js` | Steepest-descent pre-pass progresses on a far-from-solution triangle and is a no-op when already satisfied. |
| `solver-rank-deficiency.test.js` | `result.rankDeficient` is true for under-constrained sketches, false for well-constrained ones. |
| `solver-branch-lock.test.js` | Tangent honors `branch: 'internal' / 'external'`; perpendicular `branch: ±1` resolves to the chosen handedness. |
| `drag-step-cap.test.js` | `MAX_DRAG_STEP` clamps per-frame cursor jumps. |
