# Shell UI architecture — the translucent tabbed dock-panel

> The shared UI layer for the platform. Pairs with `packages/core` (the shared brain). Both shells
> (`apps/sketchstudio`, `apps/shaper`) are thin layers that fill the SAME panel's tabs over the SAME core.
> Status: design locked (advisor + human, this session). Build = a v1 shell, then iterate by feel.

## The shared UI primitive — `TabbedDockPanel`

A generic, **app-agnostic** widget (lives in `apps/sketchstudio/ui` for now; promote to `packages/ui`
when Shaper consumes it). It knows NOTHING app-specific — no solver, no cut-paths — it just takes a list
of tabs and handles all the chrome:

- **Floating** over the canvas, **translucent** (the drawing shows through).
- **Dockable** — drag to a screen edge → snaps to a docked strip there.
- **Drag-resizable** — drag a corner; the icon grid **reflows one icon at a time** (floor = 1 icon wide,
  widest = single row).
- **Tabbed** — a horizontal tab strip; click to switch the panel's content.
- **Persists** position + size + active tab across sessions.
- **Config-driven:** `createTabbedDockPanel({ tabs: [{ label, icon, render() }], persistKey })`.

## The tabs = the workflow spine (shared by every shell)

`Design · Prepare · Export/Simulate · ⚙ Settings`  — Settings right-aligned (utility, not part of the
left-to-right flow).

| tab | SketchStudio | Shaper | shared? |
|-----|--------------|--------|---------|
| **Design** | draw (line/rect/circle/arc) + constrain (coincident/⊥/∥/=/dim) over the solver | **SAME** draw + constrain, **plus** SVG import | **YES — the whole design experience is shared.** This is the win: Shaper gets the real CAD drawing it never had. |
| **Prepare** | feeds / depths / path params | cut type + toolpath | app-specific |
| **Export/Simulate** | G-code / DXF | Shaper cut-path SVG + cut simulation | app-specific |
| **⚙ Settings** | units · display · solver tuning (`SettingsManager`) | units · display · … | mostly shared |

## Shared vs app-specific (summary)

- **Always shared:** the panel widget (`packages/ui`) + the brain (`packages/core`) + the **Design tab
  tools** (draw + constrain).
- **App-specific:** Prepare + Export/Simulate content (different machines, different outputs).
- Each shell is a thin layer that fills the same panel's tabs with its content over the shared core.

## v1 build (the shell, then iterate)

1. `TabbedDockPanel` — float / dock / drag-resize / translucent / persist / reflow.
2. The 4 tabs. **Design wired to SketchStudio's existing draw + constrain tools** (the survey maps where
   those live today); **Prepare / Export/Sim as light stubs**; **Settings surfaces the existing
   `SettingsManager`** (folding in `settings-panel` / `tuning-wizard`).
3. Built generic in `apps/sketchstudio/ui`; promote to `packages/ui` when Shaper consumes it (proven
   pattern — same as the core lift).
4. Sensible defaults (override by feel): float on desktop + mobile · drag header = move · corner = resize ·
   edge = dock · remember pos/size/active-tab.

## Design-tab tools — backlog (new tools, separate from the panel v1)

- **Constrain across independent shapes — NO merge step.** Already true (constraints act on joints, not
  whole shapes; coincident clusters under the hood). A hard requirement to preserve — Shaper Studio's
  forced merge-to-constrain is the anti-pattern we're replacing.
- **Merge (×3 kinds — TBD: boolean trio Union/Subtract/Intersect, vs join-style Weld/Join/Union) + a
  Scissor (split a path/shape at a clicked point into two).** Merge as an INTENTIONAL tool, never a
  prerequisite for constraining.
- **HARD REQUIREMENT — merge is NON-DESTRUCTIVE / parametric-preserving.** The result KEEPS its joints
  editable and their constraints live. It's a MODEL op on joints + constraints (add shared/coincident
  joints where shapes meet; keep everything solvable), NOT an SVG-path boolean that flattens to a dead
  path. This is the real-CAD differentiator vs Shaper Studio and ties to north-star #1 (model is truth).
