# ROADMAP — from "SketchStudio app" to "one brain, many shells"

> Strategic plan. Durable. For *what to do this very next session*, read **NEXT-SESSION.md**.
> This supersedes the solver sections of `CONTEXT.md` (which predates the platform pivot and
> says "solver robustness ALL DONE" — that was a different, earlier backlog; see lineage note
> in NEXT-SESSION.md).

## The vision in one paragraph

We are replacing a dependency on **Shaper Studio** (the web design tool for the Shaper Origin
handheld CNC). Two frustrations drive it: (1) **unstable encoding**, (2) **no real CAD drawing
features**. The answer grew from "an app" into a **platform: one shared, app-agnostic brain +
many thin app shells**. SketchStudio is no longer the product — it becomes the *first shell*
over a headless core that a Shaper editor (and future laser / 3D-print / other-CNC apps) also
sit on. The constraint solver in this repo is that brain's heart, and it gets *reused, not
rewritten*.

```
            ┌─────────── packages/core  (THE BRAIN — app-agnostic) ───────────┐
            │   model · constraints · SOLVER · geometry · units · interaction  │
            │   exposes stable SEAMS (public API + extension points)           │
            └───┬────────────────────────────┬─────────────────────┬──────────┘
          apps/sketchstudio              apps/shaper            future apps
          (CAD + export-param)           (toolpath + sim +      (laser / 3dp /
                                          Shaper-SVG export)     other CNC)
                    ▲ PEERS over a shared core — never parent/child
```

## The six north stars (decision rules — when two designs conflict, these pick the winner)

Each lists what it **forbids** — that's what makes it bite.

1. **Model is the single source of truth.** The parametric sketch (joints · entities ·
   constraints · cut-intent) *is the document*. Canvas render, Shaper SVG, every export are
   PURE PROJECTIONS recomputed from it. *Forbids:* DOM/SVG-as-state, geometry in two places,
   treating an export as input. (This cures the #1 pain: Shaper Studio's instability is the
   SVG *being* the state.)
2. **One capability, one home.** Solver, geometry math, units, cut-type encoding, IO each live
   in exactly one module behind a clean API. **Vendor don't fork; wrap don't reimplement.**
   *Forbids:* a second offset/unit/cut-type impl; reaching past a module's API into internals.
3. **Declared, derived, or banished.** Every value is exactly one kind:
   - **Declared** — authored intent (constraints, dims, cut type/depth/tool, toolpath params,
     export params). THE truth; this is what gets saved.
   - **Derived** — a pure function of declared truth (solved positions, offsets, regions, bbox,
     SVG `d` strings, the generated cut file). Computed on demand; never saved as truth.
   - **Inferred** — guessed from appearance/proximity (color→cut type, nearness→coincident).
     Lives ONLY in the live editing layer (snap, drag, preview ghosts). **Commit is the act of
     declaration:** every accepted inference is promoted to a *declared* fact on commit; nothing
     inferred survives into saved truth.
   *Forbids:* storing derived geometry as truth; letting an inferred/visual property persist as
   semantics. *Architectural consequence:* a hard boundary between a **committed model**
   (declared only) and an **ephemeral interaction layer** (inference/snap/drag live and die).
4. **Pure core, thin shell.** Solver/geometry/encoding are framework-free pure functions; UI is
   a thin reactive layer. *Forbids:* DOM access inside core; business logic in event handlers.
5. **One geometry & units language; convert only at the edges.** One canonical representation in
   one model unit; px / mm-in / SVG coords convert ONLY at input/render/export boundaries.
   *Forbids:* px leaking into the model; unit math scattered through the UI.
6. **The core is a platform; apps are layers.** The brain is app-agnostic and exposes stable,
   documented seams. Each app is a thin stack of param-editor layers. New apps attach at the
   same seams **without touching the core**. *Forbids:* app-specific logic (Shaper/CNC
   assumptions, a particular export format) leaking into the brain; breaking a seam for one app.

> "Nothing is sacred" — bold restructuring (including SketchStudio itself) is licensed to reach
> these. Deliberately NOT a north star: "keep it simple" (good practice, but doesn't arbitrate).

## Foundation strategy (settled)

**Fix + modularize OUR pure-JS solver, and PORT IN specific proven *parts* — not wrap a WASM
monolith, not wholesale-port a heavy C++ engine.**

- **Verdict on the solver: REUSE-AFTER-FIX, no rewrite.** All 18 constraint types solve
  correctly in isolation; the 5 suspected Jacobians match finite-difference to ~1e-10. The math
  is sound — the user's "bouncy / doesn't reflect the constraint" complaints are
  reporting/robustness defects, not bad math.
- **Parts to port in** (reimplemented in pure JS, no build): **per-constraint residual
  convergence** (done — Blocker 1); the **damped step** (done — Blocker 2: tightened the Cholesky
  guard so the undamped polish is skipped near singularity, keeping the damped LM result);
  **QR-rank DOF + redundant/conflict diagnosis** (still to do — surface as *advisory*, not a hard
  block; needs a pure-JS dense QR/SVD).
- **No build step / no bundler** — confirmed user preference, not inherited. Browser-native ESM
  + import map. The one primitive the QR work needs is a pure-JS dense QR/SVD (hand-roll ~couple
  hundred LOC; no WASM).
- **License is off the table** (internal tool, willing to open-source) — we may read and
  directly adapt references. **jsketcher** (MIT, mature pure-JS 2D solver) = easiest to lift
  from; **SolveSpace** (~614-LOC clean Newton) / **planegcs** = algorithm references;
  **@salusoft89/planegcs** (WASM) = run-only **test oracle**, never bundled.

## Phases

```
PHASE 0 — Solver honesty + robustness  (in THIS repo, current structure)
  ▸ Blocker 1  "converged but lying"   ✅ DONE, committed (88336cd)
  ▸ Blocker 2  "bouncy" drag oscillation ✅ DONE, committed (8fe623c)
  ▸ Medium     point-on-circle silently ignored ✅ DONE, committed (a4d423e)
  ✅ PHASE 0 COMPLETE — solver is honest + robust; the carve-out (Phase 1) is unblocked.
  (all on branch solver-robustness; each pinned by a fail-first repro test; solver suite green)

PHASE 1 — Monorepo carve-out  (one structural move, validated by the green blocker tests)
  Promote THIS repo to the platform root; split src/ into packages/core + apps/sketchstudio.

PHASE 2 — Shaper shell  (apps/shaper, peer to sketchstudio)
  toolpath-param layer + visual-simulation layer + Shaper cut-path SVG export.
  Reuse shaper.js (correct cut-type encoding) from the old Shaper Origin Editor folder.

FUTURE — laser / 3D-print / other-CNC apps attach at the same seams, no core edits.
```

### Sequencing principle (why this order)

**Change one variable at a time.** Blocker 1 and Blocker 2 change *behavior*; the carve-out
changes *structure*. Finish all behavior work first (B1 → B2), each pinned by a repro test in
the current known-good structure, then do the structural move **once** — using both green
blocker tests as proof the migration preserved behavior. Interleaving a structural move between
two behavior fixes means debugging numerics in freshly-moved files. Batch like with like.

## Phase 1 carve-out — target layout

```
cad-platform/                    ← promote THIS repo here (keeps solver git history);
│                                  rename neutral, NOT "SketchStudio" (it's the platform now)
├── packages/
│   └── core/                    ← headless brain: model · solver · geometry · units · interaction
│                                  (lifted out of today's src/ + src/core/)
├── apps/
│   ├── sketchstudio/            ← SketchStudio's shell (demoted from root → peer) + export-param
│   └── shaper/                  ← Shaper Origin Editor files land here; toolpath + sim + SVG export
├── index.html + import map      ← no bundler
├── package.json
└── .gitignore
```

- **Promote the existing repo**, don't start fresh — keeps all solver history incl. the blocker
  commits. The old Shaper Origin Editor folder is *not* a git repo, so its files just drop into
  `apps/shaper`.
- **Peers, not parent/child:** Shaper does NOT live "inside SketchStudio." Both are thin shells
  over `packages/core` (north star #6). Anything that knows "this is a CNC cut" lives in a shell;
  anything true for all apps lives in the brain.
- **VS Code:** today's multi-root workspace is fine through Phase 0. At carve-out, reopen on the
  single new root (File → Open Folder → cad-platform).

## Reusable assets

- From the old **Shaper Origin Editor** folder (`C:\Users\danse\APPS\Shaper Origin Editor`):
  `shaper.js` (correct cut-type encoding: exterior/interior/pocket/on-line/guide;
  `shaper:cutDepth/cutOffset/toolDia`; namespace `http://www.shapertools.com/namespaces/shaper`)
  → feeds the Shaper shell's export-param layer. `svgio.js`, `canvas.js` (pan/zoom/selection)
  are candidate shell pieces. The old `store.doc` DOM-as-state model is **discarded** (violates #1).

## What's locked (do not relitigate)

- Full parametric CAD; the constraint solver is the heart.
- Centralise, don't copy — SketchStudio's solver *becomes* the shared core's solver.
- Monorepo, browser-native ESM + import map, **no build step / no bundler**.
- Full headless core shared (model + solver + geometry + units + interaction), not just the solver.
- UI keeps & refines the **Fusion 360-like** look — no UI rewrites, no divergent design language.

## References

- Project memories (the canonical source these docs summarize): `north-star-principles`,
  `project-shaper-param-editor`, `solver-known-issues-and-fixes`, `oss-2d-solver-references`,
  `ui-fusion-like-look`.
- `docs/architecture/SOLVER_WALKTHROUGH.md` — the engine internals walkthrough.
- jsketcher (github.com/xibyte/jsketcher, MIT) · planegcs / SolveSpace (algorithm refs) ·
  `@salusoft89/planegcs` (WASM, run-only test oracle).
