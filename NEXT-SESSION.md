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

## TASK — COLLINEAR of a vertical + a horizontal line (perpendicular) → REFUSE (don't rotate either off-axis).

GEOMETRIC ANCHOR done (`7548e4a`) — a freehand vertical now anchors over an ANGLED line, both orders → 90°.
**USER: "vert and horiz are not the same"** — making a VERTICAL and a HORIZONTAL line collinear should be
REFUSED, not rotate one off its axis. Advisor repro confirms both orderings are bad: vertical-first →
vertical=90° but horizontal=0° (NOT actually collinear, a degenerate "converged"); horizontal-first → the
vertical ROTATES to 0° (the user's objection).

**▶ FIX — `constraint-manager.js`, the collinear add path (pre-add, where `anchorEstablishedLine` runs ~:130,
or fold into the structural math-precheck):** before applying a 2-shape COLLINEAR, if the two lines are
axis-aligned on DIFFERENT axes — one within ~1.5° of VERTICAL **and** the other within ~1.5° of HORIZONTAL
(reuse `_lineIsGeometricallyAxisAligned` / the axis detection) — **REFUSE**: do NOT add the constraint, leave
the geometry untouched, notify `"Can't make a vertical and a horizontal line collinear — they're
perpendicular."` This is a clean PRE-ADD reject (like the math-precheck), not add-then-revert.
- UNAFFECTED: same-axis pairs (both vertical, or both horizontal) still apply; vertical/horizontal + ANGLED
  still anchors the axis-aligned line + applies. Only the perpendicular axis-aligned pair is refused.

**▶ Scenario:** a vertical line + a horizontal line → collinear REFUSED (constraint NOT added, both lines keep
their angle, clear error). Keep #19/#20 (vert+angled anchor → 90°) green.

**VERIFY:** all scenarios GREEN; conformance 15/15; oracle 12/12; baseline-diff ⊆ the 8, 0 net-new; fuzzer
`node tests/harness/solver-fuzz.test.js 400` → `400/400 clean`; a vertical + ANGLED collinear STILL anchors
the vertical (don't over-refuse the angled case).

Append a WORK-LOG entry ending with exactly `=== COLLINEAR PERPENDICULAR REFUSE DONE — HOLD ===`. **Then STOP.**

---
### Queued after this (advisor-owned backlog — do NOT start without dispatch)
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
