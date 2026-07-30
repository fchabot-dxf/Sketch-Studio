# Penplotter → Sketch-Studio: Parity Gap Roadmap

Exhaustive per-area audit (2026-07-11) of the ORIGINAL plotter (`C:\Users\danse\APPS\penplotter\app\js`) vs the MERGED
app (`apps/penplotter/src` + `#core`/`#ui`). 8 areas, **125 features**. This is the AUTHORITATIVE restoration plan —
work down it instead of discovering gaps one at a time.

> **ROOT PATTERN (why so much "disappeared"):** the migration retired the art store and left the old **Draw panel hidden**
> (`drawHost.hidden=true`; stages re-parent only `#canvasWrap`). So a lot of *working* UI code is either **STRANDED** in
> that hidden host (the whole Pens editor, the per-toolpath editor) or **dead-wired to the empty `state.artLayers`** (Delete,
> Scissors/Rotate/Scale, drag). Most fixes = **re-home a panel** or **re-point a handler at `#core`** — cheap. Only a
> handful are genuine rebuilds/decisions.
>
> **CORRECTION:** machine SETTINGS (pen up/down Z, feeds, tolerance, doc size, auto-recalc) **WORK** — wired in the Export
> tab (`mountExportStage → installSettingsPanel`). Earlier "orphaned dead code" claim was stale. Only caveat: discoverability.
> **USER DECISION (2026-07-11): settings do NOT belong in Export.** RELOCATE the machine-settings block from `export-stage.js`
> to the **Toolpath** (machine/CAM) tab, next to the Pens panel — it's setup, not an export step. Fold into **S3** (both are
> machine-setup UI that belongs in Toolpath). Export keeps only the export action + the pen-width sim preview.

## Status legend
STRANDED = code correct, host hidden/absent · ORPHANED_DEAD = code shipped, nothing calls it · MISSING = not ported ·
PARTIAL/BROKEN = half-wired/silently wrong · SUPERSEDED = deliberately replaced by a richer `#core`/`#ui` equivalent.

## Top findings (highest user impact)
1. **Per-toolpath fill/outline editor unreachable from Toolpath tab** (STRANDED, small) — `#activeLayerContent` only in
   `fill-stage`; row-click `renderActiveLayerPanel()` no-ops. → **MERGE-1** (in flight).
2. **The whole Pens editor is in a hidden host** (STRANDED, med) — `#plotColors` lives in hidden `#drawPanel`. Can't
   rename/recolor/delete a pen, and **per-pen tip width (drives the export sim) is frozen at 0.5mm with no UI**. → **S3**.
3. **Delete/Backspace is dead for #core geometry** (BROKEN, med) — `deleteSelected` iterates empty `state.layers`. → **S4**.
4. **Fill panel shows BOTH outline+fill for every toolpath** (BROKEN, small) — `tp.type` gate dropped; a fill tp shows an
   inert outline editor. → **S2**.
5. **Scissors / Rotate / Scale fully non-functional** (ORPHANED_DEAD, large ×3) — route through empty artLayers. → **S7**.
6. **SVG `<ellipse>` dropped; path S/T/A flattened to straight chords** (MISSING/BROKEN, med) — curve regressions. → **S6**.
7. **"Draw outline" on/off checkbox gone** while `tp.drawOutline` stays live downstream (MISSING, small). → **S2**.
8. **No clickable Undo/Redo; dead tool-hotkeys shadow typing** (MISSING/ORPHANED, small). → **S4**.

## Restoration roadmap — cheap-high-value first · [R]=straight restore · [D]=user decision

- **MERGE-1** *(in flight)* — merge Fill→Toolpath; add `#activeLayerContent` to `toolpath-stage` + render editor for the
  selected row (un-strands finding #1); delete dead `#transformHud` + its driver. **[R]**
- **S2 — Fill-editor correctness** *(small, one file, rides on MERGE-1)* **[R]** — re-gate sections by `tp.type` (#4);
  re-add Draw-outline checkbox (#7); dynamic `<h2>` header; field min/max/step + concentric default 1.2. `active-layer-panel.js`.
- **S3 — Surface the Pens panel** *(med, highest structural value)* **[R]** — relocate the Pens `<section>` (`#plotColors`
  + `#addPlotColor`) out of hidden `#drawPanel` into a visible Toolpath sub-panel. Auto-restores pen list/add/rename/recolor,
  **per-pen width**, delete-with-reassign, `uiChoose` (#2). `renderPlotColorsPanel` already guards on `#plotColors`.
- **S4 — Delete + keyboard hygiene** *(med)* **[R]** + one **[D]** — route Delete/Backspace to the #core selection (#3);
  add `#undoBtn/#redoBtn` to the header (history.js auto-wires); **[D]** remap or drop the dead hotkeys `v/t/s/l/r/e/p/f/x/n`.
- **S5 — Canvas feedback overlays** *(small, render-art.js)* **[R]** — port `buildMarquee` (invisible marquee box) +
  `updateTargetEditingBanner`. (Snap marker moot while drag is dead.)
- **S6 — Import fidelity** *(med–large)* mix **[R]/[D]** — [R] `<ellipse>`→polyline; [R] S/T/A smooth+arc flattening (#6);
  [R] dragover/drop on the Design canvas + remove dead Draw import button. **[D]** Inkscape-layer split; **[D]** set doc
  size from import.
- **S7 — Core-native transforms & node/region edit** *(large, [D]-heavy)* — Scissors/trim on #core geometry; per-node
  delete+bridge; Rotate/Scale as #core joint transforms about a pivot (re-purpose the HUD); free-ellipse draw (needs a
  #core ellipse shape); region-hover on `#core findLoops` for fill targeting. Split as needed. **DECISION:** how much of
  the imperative transform UX to rebuild vs. leave to constraint-driven editing. (Ties to the earlier declare-vs-bake talk.)
- **S8 — Per-shape styling parity** *(med, [D]-heavy)* — preset pen-color popover; mixed-value cue. Fill/stroke separation,
  "None" sentinel, per-shape width = **[D]** (the merged model collapsed to one color/shape + pen mapping).
- **S9 — Boolean union (Merge shapes)** *(large)* **[D]** — port clip/union; #core has no boolean op — decide home.
- **S10 — Cloud stage** *(large, deferred by design)* **[D]** — port cloud client/config/picker/panel; un-stub
  `plot-colors-panel`; add save/load-palette + project + config UI. Revives palette presets + whole-session save. deps: S3.
- **S11 — Responsive layout & splitters** *(small–med, low priority)* **[D]** — port `mobile.js` only if not desktop-only.

```
 MERGE-1 ─▶ S2 (fill correctness)
    │       S4 (delete + undo keys)   ← independent, cheap
    │       S5 (marquee / banner)     ← independent, cheap
    └─ S3 (surface Pens) ───────────▶ S10 (Cloud) [D]
 S6 (import fidelity) — independent
 S7 (core transforms / scissors / node) [D] — independent, large
 S8 (styling)[D]  ·  S9 (boolean union)[D]  ·  S11 (responsive)[D]
```
**Do first:** S2 + S4 + S5 (small, high-visibility, mostly single-file). **Biggest structural win:** S3 (unlocks pen
width→export-sim + five stranded controls at once).
