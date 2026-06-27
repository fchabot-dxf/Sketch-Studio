# NEXT-SESSION — current worker instruction (advisor-owned)

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

## TASK — Slice 1: the three extractions, ONE PER COMMIT (option B)

These are the same three extractions from the reset `8b7db3d` (see WORK-LOG for the diff summary) —
redone correctly: **each as its own commit, each with its shell wiring, each load-verified.**
**IN PLACE — no file moves. Do NOT split geometry** (screen helpers stay in `geometry.js`; that
split is deferred to the shell batch per advisor ruling).

**Commit 1 — metrics callback.**
- `constraint-solver.js`: replace `window.__updateSolverMetrics` with an injected `onMetrics`
  callback; `createEngine` takes an options object.
- **Wire the shell:** update every `createEngine(...)` caller to the new signature and pass
  `onMetrics` so the tuning-wizard metric updates still happen (this is also what keeps the app
  loading — the signature change ripples to all callers).
- Verify: app **loads** · metrics still update · oracle **12/12**. Commit.

**Commit 2 — notify callback.**
- `core/constraint-manager.js`: drop `import { showNotification } from '../ui/notification-manager.js'`;
  add a module-level `notify` + `setConstraintNotifier(fn)`; repoint the 4 call-sites to `notify(...)`.
- **Wire the shell:** call `setConstraintNotifier(showNotification)` at startup.
- Verify: app **loads** · conflict notifications still fire · oracle **12/12**. Commit.

**Commit 3 — snap-detection pass-throughs.**
- `constraint-solver.js`: remove the `findSnap` / `hitJointAtScreen` screen-space pass-throughs and
  their `snap-detection` import; the shell calls `snap-detection` directly wherever it used those.
- Verify: app **loads** · snapping unchanged · oracle **12/12**. Commit.

After **each** commit: append a WORK-LOG entry (did / why / tried / state). When all three are
committed, **STOP and report** — do NOT move any files. Hold for advisor review.

## After slice 1 (do NOT start without advisor go)
- **Shell batch:** `git mv` shell → `apps/sketchstudio`, AND extract the geometry screen helpers →
  `apps/sketchstudio/coords.js` at the same time (importers touched once). Big `git mv`s carry
  re-export shims at OLD paths so imports resolve through the move — but **never a `core → apps/`
  re-export**.
- **Core batch:** `git mv` core → `packages/core` + co-locate the solver oracle → `packages/core/tests`.
- ⚠ **Cloudflare:** moving `index.html` out of repo root breaks the Pages deploy (output `/`) —
  decide a thin root loader vs changing the output dir before that lands on `main`.
- **[DEBT-1]** solver-config `localStorage` → injected persistence adapter (deferred).
