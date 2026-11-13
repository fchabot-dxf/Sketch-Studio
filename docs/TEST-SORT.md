# Test sort: which browser tests only check logic (task 569, phase 1)

Every test the gate runs in the **live** tier (it launches a browser through `tests/helpers/cdp-browser.js`, directly or through a
`*-runner.js`), from `node scripts/gate.cjs --list` on origin/main 2c66d4d (after tasks 558 and 567 landed): **92 files**. Seconds are each file's last run time from the
gate's timings file (`%LOCALAPPDATA%\sketch-studio-gate-timings.json`, task 568), so they move a little from run to run.

Classes:
- **LOGIC**: asserts state / document / store / undo / solver results that a node replay can reach.
- **SCREEN**: asserts rendered pixels, layout, overlap, CSS, screenshots.
- **REAL-INPUT**: needs real pointer / touch / keyboard event semantics, focus rules, the file chooser, the clipboard permission, a page
  load / reload, IndexedDB or real event timing.
- **MIXED**: both; the note says which asserts are which.

Hosts: SS = SketchStudio, PP = Pen Plotter, "all 4" = SketchStudio, Shaper, Pen Plotter, Trace.

## Totals

| class | files | seconds | minutes |
|---|---|---|---|
| LOGIC | 37 | 1089 | 18.1 |
| MIXED | 39 | 1075 | 17.9 |
| SCREEN | 7 | 133 | 2.2 |
| REAL-INPUT | 9 | 204 | 3.4 |
| all | 92 | 2500 | 41.7 |

The live tier runs 6 files side by side (task 568), so its wall time is about the sum / 6 (about 7 min with the quick tier and smoke).

## The node test kit (`tests/helpers/node-app.js`)

`open({ host, profile })` opens a host's Design canvas in Node and returns `app` with `state`, `engine`, `svg`, `toScreen(wx, wy)`,
`move / down / up / click / drag` (pointer events dispatched on the canvas, where the app's own listeners are), `key`, `esc`, `enter`,
`undo` (Ctrl+Z), `redo` (Ctrl+Y), `tool(name)` (a click on the ribbon's `#tool-<name>` button), `storedDoc()` (the page-hide autosave,
then the stored current design), `waitFor`, `close()`. A **profile** is what a browser profile keeps across page loads: localStorage and
the project store's records. A reload or a switch to another app is `close()` and `open()` on the same profile.

The page is a **happy-dom** Window (devDependency `happy-dom` 21.0.4, exact; released 2026-10-20) loaded with the host's real
`index.html` (its scripts are not run). What runs is the app's own code: `createSketchState`, `setupInput` (SketchStudio) /
`mountSketch` (Shaper, Pen Plotter), SketchStudio's `setupUI` ribbon or the shared `createToolRibbon`, the host loop (solve, then the
shared renderer `draw`, which also places the constraint glyphs that clicks hit-test), `createDocumentBuffer` on `createProjectStore` with
the store's own in-memory adapter (`createMemoryAdapter`) and a real BroadcastChannel per profile.

Each host DECLARES its Design-canvas setup in one module that its page script and the kit both import (task 569 1b), so the kit copies
nothing from a host:
- `apps/sketchstudio/design-canvas.js`: `CANVAS_ID`, `INITIAL_VIEW` (w 20 at 1.5, -1.5), `initStudioCanvas` (state defaults, empty store,
  initial view + viewBox), `studioBufferOptions` (app, canvas, restore = solve + fit, status text), `studioFrame` (one loop frame: solve,
  draw, ribbon highlight). Read by `apps/sketchstudio/main.js`.
- `apps/shaper/src/design-canvas.js`: `DESIGN_CANVAS_ID`, `DESIGN_CANVAS_OPTIONS` (mountSketch: seedDemo false, grid, profiles),
  `RIBBON_OPTIONS`, `shaperBufferOptions` (restore = solve + fit + page views, then the cut plan / stock sidecar). Read by `apps/shaper/src/main.js`.
- `apps/penplotter/src/design-canvas.js`: `DESIGN_CANVAS_OPTIONS` (seedDemo false), `plotterBufferOptions` (restore = solve + panels, then the
  plotter sidecar or its reset). Read by `apps/penplotter/src/sketch-stage.js`.
Page-only hooks (info panel, Vcarve, Prepare, Review, the Freehand button, the header) come in as callbacks; the kit passes none.

Other seams used, already there and used by the app: the store's `adapter` and `channel` options, the buffer's `store`, `doc`, `win`.

What is not the browser (KIT_OVERRIDES at the top of the kit, the only differences):
1. layout: happy-dom has none, so the canvas reports the size it has in the real page at 1600 x 900 (measured); every other element 0 x 0.
2. requestAnimationFrame: a queue the kit steps, one frame after each dispatched event instead of a 16 ms clock; no pauses between events.
3. ResizeObserver: happy-dom's never reports; the kit's reports each observed element once (a browser's first observation).
4. fetch stays Node's, so the glyph sheet's relative URL fails at once instead of going to a network (the renderer draws without it).
Page timers are happy-dom's and die with the page (`close()`); Node's timers come back after it.

## Proof: three tests converted

The old browser files were deleted in phase 2 (task 576). Times: one run each, same machine, `node <file>`
(`.evidence/569/timing.txt`).

| old browser test | seconds | new node test | seconds |
|---|---|---|---|
| tests/snap-origin-coincident.test.js (drawing / constraint) | 72.10 | tests/snap-origin-coincident-node.test.js | 0.63 |
| tests/draw-undo-live-lines.test.js (undo) | 18.22 | tests/draw-undo-lines-node.test.js | 0.53 |
| tests/document-buffer-hosts.test.js (project store / save) | 17.63 | tests/document-buffer-hosts-node.test.js | 1.75 |

(node times with happy-dom, task 569 1b; with the first hand-written DOM they were 0.16 / 0.16 / 1.47 s.)

All three start, like their browser versions since task 558, from a NAMED current design (only a named design autosaves):
`createNamedDesign(profile, app)` in the kit does on the profile's store what `tests/helpers/named-design.js` does in a page.

**snap-origin-coincident**: the same asserts, the same scenarios at the same screen offsets from the origin, read from the stored design:
a shape drawn in every scenario; a COINCIDENT with `j_origin` for line end at 0 / 12 / 15 px and circle centre; none at 24 px; a line
started on the origin uses `j_origin` as its start joint. Rows printed by both are identical (`nearOrigin`, `shapes`, constraint types,
`originCoincident`), joint ids aside. Broken on purpose (`applySnapConstraint` refuses a `j_origin` target): the node test fails with
`AssertionError [ERR_ASSERTION]: circle centre: a COINCIDENT constraint with j_origin exists; got []`.

**draw-undo-live-lines**: the runner's measure / canon / orphans / diff helpers and asserts, verbatim: one Ctrl+Z restores the pre-draw
document exactly, no orphan joint, Ctrl+Y restores the drawn one (line empty-to-empty, line from an existing point, fillet); the chain of 3:
one line removed per Ctrl+Z ([2,1,0]), no orphan, exact after the third, three redos exact. The ROW lines both print are identical. Broken
on purpose (the fillet takes no `saveState('fillet')`): `fillet: one Ctrl+Z must restore the pre-draw document exactly; got
{... "afterUndo":"j8 s4 c5" ...}`.

**document-buffer-hosts**: the same asserts: Pen Plotter autosaved its sidecar (toolpath Tri, draw_feed 1234), status Saved, hosts
include penplotter; SketchStudio autosaved its edit (more shapes) and kept the penplotter sidecar; Pen Plotter opened again restores a
plotter document deep-equal to before; buffers A / B / host-less on one store keep every sidecar (the 5 printed rows are identical).
Setup differs: the Pen Plotter geometry is drawn with the Line tool (the browser test imported an SVG through the file chooser) and the
pen is pushed into the plotter state (the browser test clicked "+ Pen"). Broken on purpose (`mergeHosts` keeps only the incoming hosts):
`AssertionError [ERR_ASSERTION]: SketchStudio's save dropped the Pen Plotter sidecar (hosts: [])`.

## Phase 2 recommendation

Convert the LOGIC tests and the LOGIC half of the MIXED ones in three batches, keep a small browser set end to end.

- **Batch A, the kit as it is** (28 files, 847 s): the other 7 draw-undo-live-*, the 10 origin-snap-live-* (they reuse the converted
  runner pattern), axis-snap-live-* (state.activeSnap instead of the highlight), drag-own-midpoint, body-drag-owner, dimension-point-line,
  dimension-redundant-driven, recentre-on-reload, clear-all (counts); dimension-delete-live and fusion-drag-live already have node twins
  (tests/dimension-delete.test.js, tests/fusion-drag.test.js): delete them.
- **Batch B, small kit additions** (12 files, 465 s; the screen halves stay as slimmer browser tests): drag-undo-live and journal-live (read
  the report from the diagnostic log, not the clipboard), clipboard-live-shaper / -sketchstudio (an injected clipboard: check the seam
  first), context-menu (its actions), symmetric-live-*, reference-lines-glyph-live-a/b/c (stored constraints), parameters-canvas-live
  (parameters + undo), angle-dimension-arc-live (angle value).
- **Batch C, the host stages** (10 files, 180 s): penplotter-pen-undo / -stage-undo / -persist / -active-panel / -validation, shaper-cut-undo,
  shaper-persist, studio-encoding, cut-offset-types, stock-loop-live. These need the Pen Plotter toolpath stage and Shaper Prepare in the
  kit; do it after the hosts declare their stage wiring importable (owner decision, see the kit notes).
- **Batch D, the save rule** (8 files, 209 s; task 558): save-key-leave-live-* and unsaved-prompt-live-* (their LOGIC half: what is stored
  and which design is open after each answer). Needs the shared sidebar / File menu and the question dialog mounted in the kit; the
  beforeunload dialog stays in one browser test.
- **Keep in the browser, end to end** (one per host per area where a test exists): drawing = polygon-tool-live (all 4 hosts); constraints =
  reference-lines-live (SS, Shaper); dimensions = dimension-pick-live-studio + -shaper; projects = open-recent-modal-live (3 hosts),
  project-store-idb, document-restore-gate; import = sketch-import (all 4), dxf-import-live; mobile touch = mobile-touch-live; plus every
  SCREEN and REAL-INPUT file. Gaps: Pen Plotter and Trace have no constraint / dimension browser test today.
- **Expected gate time after phase 2**: the live tier drops from about 2500 s of file time to about 690 s (the 31 files left), plus the
  browser halves kept from batches B and D (roughly 150 to 250 s), so about 2.5 to 3 min wall at 6 wide instead of about 7 min; the
  longest live file becomes sketch-import (45 s) instead of snap-origin-coincident (72 s). The quick tier grows by about 60 node files of
  0.2 to 2 s each, run 22 wide: a few seconds.

## The sort

| file | s | class | host | what it asserts | node / why not |
|---|---|---|---|---|---|
| angle-dimension-arc-live.test.js | 22.9 | MIXED | SS | A: the drawn ANGLE arc spans 10 deg, label 10.0; B: dragging the label across the vertex never changes the measured angle, moves no geometry | LOGIC: angle value + joints unchanged after a label drag; SCREEN: the arc read back from the SVG path, the label text |
| app-sidebar.test.js | 24.5 | REAL-INPUT | all 4 | the shared sidebar in every host: GO TO lists 4 apps, Esc / outside click close it, focus trapped while open, old switcher gone, favicons | focus trap + favicon render: browser |
| axis-snap-live-lines.test.js | 19.1 | MIXED | SS | line end / start / rect corner snapped onto an axis: stored joint exactly on it + pointOnLine(ref_axis) stored; the axis highlight shows | CONVERTED (task 576): axis-snap-lines-node.test.js |
| axis-snap-live-session.test.js | 17.8 | MIXED | SS | axis snap across a session; the setting off disables it | CONVERTED (task 576): axis-snap-session-node.test.js |
| axis-snap-live-shapes.test.js | 20.1 | MIXED | SS | circle / polygon / arc centre and a select-drag land on an axis | CONVERTED (task 576): axis-snap-shapes-node.test.js |
| body-drag-owner-live.test.js | 21.3 | LOGIC | SS | the owner's arc pulled by its body: centre stays, radius grows by the pull, ends keep their angles, pull back returns | CONVERTED (task 576): body-drag-owner-node.test.js |
| canvas-grid-labels-live.test.js | 36.9 | SCREEN | SS, Shaper, PP, Trace | grid axis numbers in the file unit, follow zoom, never overlap, vanish with GRID_MODE off, not in the world group, absent in PP / Trace | layout + overlap |
| clear-all-live.test.js | 6.3 | MIXED | SS | Clear All empties the board even with a selection; a repeated click is harmless | CONVERTED (task 576): clear-all-node.test.js |
| clipboard-live-cross.test.js | 43.3 | REAL-INPUT | SS -> Shaper | copy in SketchStudio, reload into Shaper, Ctrl+V there: the SYSTEM clipboard crosses apps | browser clipboard permission + reload |
| clipboard-live-shaper.test.js | 22.2 | MIXED | Shaper | rectangle: marquee, Ctrl+C, Ctrl+V x2, Ctrl+Z / Ctrl+Y, Ctrl+X; text fields keep their own copy / paste | LOGIC: pasted geometry + undo steps (needs the clipboard injected in the kit); REAL-INPUT: system clipboard, native text-field copy |
| clipboard-live-sketchstudio.test.js | 64.8 | MIXED | SS | as clipboard-live-shaper, SketchStudio | as clipboard-live-shaper |
| context-menu-live.test.js | 31.4 | MIXED | SS | right click opens ONE shared menu (dimension: Driving / Reference / Delete; geometry: Lock / Delete); its actions | LOGIC: action effects (driving flag, delete keeps geometry, lock); REAL-INPUT: right button + contextmenu event |
| cut-offset-types.test.js | 14.1 | MIXED | Shaper | On Line / Guide take no offset: the cut card hides it, the export and the preview ignore it | LOGIC: export attributes; SCREEN: the card fields, the preview |
| design-info-panel-right-dock.test.js | 11.9 | SCREEN | Shaper, PP | the Design info panel docks right of the canvas, no overlap, collapse arrow direction | layout |
| diagnostic-log-copy-live.test.js | 16.4 | REAL-INPUT | SS, Shaper | one Copy Report click puts the minified report on the clipboard; a rejected write offers a download | clipboard + download |
| diagnostic-log-in-statusbar.test.js | 13.8 | SCREEN | SS | the Log button in the status bar at 390 and 1440 px, on screen, no sideways overflow, a click opens the log | layout |
| dimension-delete-live.test.js | 54.9 | LOGIC | SS | deleting a DIMENSION removes only its constraint, never geometry (Delete key and the panel) | CONVERTED (task 576): dimension-delete-select-node.test.js (panel-row route stays in the browser file) |
| dimension-pick-live-shaper.test.js | 19.1 | LOGIC | Shaper | the Dimension tool picks like Fusion: one pick = length preview, a second pick changes kind, an empty click places, Esc cancels; the axis lights | reads the rendered labels; node reads the placing constraint (kind, value) |
| dimension-pick-live-studio.test.js | 17.9 | LOGIC | SS | as dimension-pick-live-shaper, SketchStudio | as dimension-pick-live-shaper |
| dimension-point-line-live.test.js | 20.4 | LOGIC | SS | point-to-line dimension is driving, holds the perpendicular distance under a drag, a typed value drives, ONE undo removes it; line-to-line both orders driving | CONVERTED (task 576): dimension-point-line-node.test.js |
| dimension-redundant-driven-live.test.js | 17.5 | LOGIC | SS | a dimension on an already-determined quantity is placed DRIVEN and cannot be typed; a non-redundant one opens the value box | CONVERTED (task 576): dimension-redundant-driven-node.test.js |
| document-buffer-hosts.test.js | 17.4 | LOGIC | PP, SS | the autosave keeps OTHER apps' host sidecars (PP -> SS edit -> PP unchanged); buffers alternating keep both; a host-less save deletes none | CONVERTED (task 576): document-buffer-hosts-node.test.js (569), original deleted |
| document-restore-gate.test.js | 13.5 | REAL-INPUT | PP | input before the initial restore settles is ignored; data-doc-ready set after | page-load lifecycle (a held-back restore in a fixture page) |
| drag-follow-live.test.js | 32.7 | REAL-INPUT | SS, Shaper | at a large zoom the dragged point keeps up with the pointer every animation frame (gap per rAF) | real 16 ms frame timing |
| drag-own-midpoint-live.test.js | 17.8 | LOGIC | SS | a line end dragged 50 px from its own midpoint stays exactly under the cursor (no self-midpoint snap) | CONVERTED (task 576): drag-own-midpoint-node.test.js |
| drag-undo-live.test.js | 50.5 | LOGIC | SS, Shaper | each drag (joint, line body, circle rim) = ONE labelled undo step, Ctrl+Z exact, Ctrl+Y re-applies, a click without movement adds none | reads the journal through Copy Report (clipboard); node reads state.history |
| draw-undo-live-esc-2.test.js | 17.5 | LOGIC | SS | Esc mid-draw (arc, polygon, bezier) leaves nothing and no undo step | CONVERTED (task 576): draw-undo-esc-2-node.test.js |
| draw-undo-live-esc.test.js | 17.3 | LOGIC | SS | Esc mid-draw (line, rect, circle) leaves nothing and no undo step | CONVERTED (task 576): draw-undo-esc-node.test.js |
| draw-undo-live-lines.test.js | 18.8 | LOGIC | SS | one line = ONE undo step (empty-to-empty, from a point); chain of 3 = 3 steps, no orphan; fillet = one step | CONVERTED (task 576): draw-undo-lines-node.test.js (569), original deleted |
| draw-undo-live-session.test.js | 18.5 | LOGIC | SS | LINE_CHAIN_UNDO per-tool-session: one Ctrl+Z removes the chain; Ctrl+Z while the Line tool is active; rect, circle | CONVERTED (task 576): draw-undo-session-node.test.js |
| draw-undo-live-shaper.test.js | 41.9 | LOGIC | Shaper | every scenario of the runner in the Shaper Design tab + journal labels | CONVERTED (task 576): draw-undo-shaper-node.test.js |
| draw-undo-live-shapes.test.js | 16.9 | LOGIC | SS | arc, polygon, bezier are one undo step each | CONVERTED (task 576): draw-undo-shapes-node.test.js |
| draw-undo-live-switch-2.test.js | 17.5 | LOGIC | SS | picking another tool mid-draw (arc, polygon, bezier) leaves nothing, no step | CONVERTED (task 576): draw-undo-switch-2-node.test.js |
| draw-undo-live-switch.test.js | 17.7 | LOGIC | SS | picking another tool mid-draw (line, rect, circle) leaves nothing, no step | CONVERTED (task 576): draw-undo-switch-node.test.js |
| dxf-import-live.test.js | 19.2 | MIXED | Shaper | a Fusion DXF through the real file input lands as lines + arcs + construction, counted skips; loops selectable in Prepare; a bad DXF is a status; Fusion SVG cut types | REAL-INPUT: file chooser; LOGIC: the import result (the importer has node tests) |
| fusion-drag-live.test.js | 0.1 | LOGIC | SS | the drag cells the node replay claims, checked in the real app (line body, rect edge, circle rim, arc end, dimensioned line) | CONVERTED (task 576): fusion-drag-app-node.test.js |
| header-status-no-shift.test.js | 12.3 | SCREEN | PP, Shaper, SS | the autosave status text never moves the header controls | layout |
| journal-live.test.js | 11.9 | LOGIC | SS | a scripted session's Copy Report replays to exactly the reported document; step labels in gesture order | reads the report through the clipboard; node reads it from the diagnostic log directly |
| mobile-touch-live.test.js | 31.9 | REAL-INPUT | SS, shared tab | touch and hold menu, 44 px rows, magnifier under the finger, Done ends a chain, touch snap boost, phone layout | touch emulation + layout |
| numeric-input-self-hiding.test.js | 12.4 | MIXED | Shaper, PP | idle numeric inputs are display:none; after Enter #dimInput is not focused | SCREEN: computed display; REAL-INPUT: focus after Enter |
| open-recent-modal-live.test.js | 12.7 | MIXED | all 3 | "Open recent" opens the project manager on its Recent pane, newest first, a tile opens the design | UI flow (sidebar + modal DOM); LOGIC: the design opened |
| origin-snap-live-shaper-off-a.test.js | 55.7 | LOGIC | Shaper | after "New design" every tool snaps onto the origin (axis snap off, zoom 0 / +4) | CONVERTED (task 576): origin-snap-shaper-off-a-node.test.js |
| origin-snap-live-shaper-off-b.test.js | 36.8 | LOGIC | Shaper | as above, zoom -4, no axis snap away from the origin | CONVERTED (task 576): origin-snap-shaper-off-b-node.test.js |
| origin-snap-live-shaper-on-a.test.js | 55.4 | LOGIC | Shaper | as above, axis snap on, zoom 0 / +4 | CONVERTED (task 576): origin-snap-shaper-on-a-node.test.js |
| origin-snap-live-shaper-on-b.test.js | 37.1 | LOGIC | Shaper | as above, axis snap on, zoom -4, axis snap away from the origin | CONVERTED (task 576): origin-snap-shaper-on-b-node.test.js |
| origin-snap-live-studio-off-z0.test.js | 45.5 | LOGIC | SS | SketchStudio, axis off, zoom 0, + away | CONVERTED (task 576): origin-snap-studio-off-z0-node.test.js |
| origin-snap-live-studio-off-zin.test.js | 42.2 | LOGIC | SS | SketchStudio, axis off, zoom +4 | CONVERTED (task 576): origin-snap-studio-off-zin-node.test.js |
| origin-snap-live-studio-off-zout.test.js | 42.6 | LOGIC | SS | SketchStudio, axis off, zoom -4 | CONVERTED (task 576): origin-snap-studio-off-zout-node.test.js |
| origin-snap-live-studio-on-z0.test.js | 45.3 | LOGIC | SS | SketchStudio, axis on, zoom 0, + away | CONVERTED (task 576): origin-snap-studio-on-z0-node.test.js |
| origin-snap-live-studio-on-zin.test.js | 42.9 | LOGIC | SS | SketchStudio, axis on, zoom +4 | CONVERTED (task 576): origin-snap-studio-on-zin-node.test.js |
| origin-snap-live-studio-on-zout.test.js | 42.7 | LOGIC | SS | SketchStudio, axis on, zoom -4 | CONVERTED (task 576): origin-snap-studio-on-zout-node.test.js |
| parameters-canvas-live.test.js | 34.9 | MIXED | SS (+hosts) | formulas typed into a dimension box create / follow parameters, one undo step, refused names, the autocomplete list, a text input | LOGIC: parameters + undo; SCREEN / REAL-INPUT: the autocomplete list, hints, typing in a text box |
| parameters-window-live.test.js | 31.1 | MIXED | SS, Shaper, PP, Trace | the fx Parameters pop-up: button per host, open / close / Esc / focus, modeless, rows follow dimensions, a selection lights its row | LOGIC: rows follow state; SCREEN / REAL-INPUT: placement, focus |
| penplotter-active-panel.test.js | 17.3 | MIXED | PP | the Active Toolpath panel follows activeToolpathId (+Fill, row click, delete, undo / redo) | LOGIC: activeToolpathId; the panel is PP toolpath-stage UI (not in the kit yet) |
| penplotter-cosmetics.test.js | 17.1 | MIXED | PP | wording / labels, Export's toast, the Pen-mix reason, an import seeds a pen per colour, + Outline replaces the starter | SCREEN: wording; LOGIC: pens seeded, starter replaced |
| penplotter-panel-overflow.test.js | 20.4 | SCREEN | PP | no toolpath panel row past the panel edge at 1280 / 1600 / 1920 px | layout |
| penplotter-pen-undo.test.js | 15.3 | LOGIC | PP | pen add / rename / delete undo and redo (history.js) | needs the PP toolpath stage in the kit |
| penplotter-persist.test.js | 15.1 | LOGIC | PP | the plotter document, the G-code (byte-identical) and the panels survive a reload; an old document loads defaults | reload = close + open on the same profile; the panels part is SCREEN |
| penplotter-stage-undo.test.js | 15.0 | LOGIC | PP | one keystroke = one history, chosen by the active stage | needs PP stage switching in the kit |
| penplotter-validation-live.test.js | 35.1 | MIXED | PP | inputs clamp / refuse bad values and show the value kept; the G-code never holds F0 / NaN | LOGIC: sanitize + G-code; REAL-INPUT: typing into the inputs |
| polygon-tool-live.test.js | 20.7 | MIXED | all 4 | Polygon in the Create group of every ribbon, Sides clamps 3..64 and is remembered across a reload, a drag draws N lines + N radii, ONE undo removes it | LOGIC: drawing, undo, clamp, localStorage; SCREEN: the button in its group |
| prepare-look.test.js | 22.3 | SCREEN | Shaper | Prepare looks like Shaper Studio: idle / hover / selected states, --sk-prep-* tokens only, the card | CSS + rendering |
| project-store-idb.test.js | 11.6 | REAL-INPUT | fixture | the store on REAL IndexedDB: legacy migration once with two tabs, CRUD, ordering, pinning, moving, host merge across two instances, cross-tab change | IndexedDB + BroadcastChannel lifecycle (the memory adapter is covered by tests/project-store.test.js) |
| recentre-on-reload-live.test.js | 58.2 | LOGIC | SS, Shaper | a restored drawing is framed (centred, inside, 10 % margin) after a reload and after Open recent; an empty design keeps the view | CONVERTED (task 576): recentre-on-reload-node.test.js (SketchStudio, Shaper; Pen Plotter stays in the browser file, batch C) |
| reference-lines-glyph-live-a.test.js | 46.4 | MIXED | SS | a constraint on an axis (parallel / perpendicular) shows its glyph on the real line only and is stored against the axis | SCREEN: glyph count; LOGIC: stored constraint |
| reference-lines-glyph-live-b.test.js | 46.2 | MIXED | SS | as -a for collinear / point on | as -a |
| reference-lines-glyph-live-c.test.js | 58.6 | MIXED | SS | as -a for tangent / dimension | as -a |
| reference-lines-live.test.js | 26.2 | MIXED | SS, Shaper | the X axis is lit only while a constraint tool targets it; Select ignores it; parallel(line, axis) stored and the line turns horizontal; a real line on the axis wins | LOGIC: stored constraint, geometry, selection; SCREEN: data-ref-axis lit |
| review-live.test.js | 15.4 | SCREEN | Shaper | the Review tab builds the 3D workpiece (software WebGL), orbit, Reset / Top | WebGL |
| save-to-file-in-projects.test.js | 14.2 | MIXED | SS, Shaper | the project manager modal: actions, thumbnails, search, rename, duplicate, Save to file bytes | UI flow; known flaky (task 558) |
| shaper-cut-undo.test.js | 19.6 | LOGIC | Shaper | every cut-plan edit is ONE step of the shared history; undoing an SVG import restores the cut plan | needs Shaper Prepare in the kit |
| shaper-persist.test.js | 20.2 | LOGIC | Shaper | cut plan + stock survive a reload via doc.hosts.shaper; an old document gets defaults; a SketchStudio save keeps the sidecar; export byte-identical | reload = reopen; needs the Shaper sidecar in the kit |
| sidebar-account.test.js | 16.4 | REAL-INPUT | fixture | account row states, avatar fallback, signIn() called synchronously from the click, sign out, the 404 -> GIS popup path | user-gesture popup rule |
| sidebar-drive.test.js | 15.7 | MIXED | fixture | Drive status line, the Save to Google Drive action, the default toggle, the connection check steps (real Drive adapter over a fake Drive) | UI + Drive adapter logic |
| sidebar-projects.test.js | 44.8 | MIXED | Shaper | the sidebar wired to the store: new design, inline rename, Open recent, browse / move / pin, refused delete, refused newer file | UI flow + store LOGIC |
| sketch-import.test.js | 45.2 | MIXED | all 4 | A: the shared importer gives the baseline shapes as ONE undo step; B: every host's File menu imports SVG and DXF through the real file chooser | A LOGIC; B REAL-INPUT (file chooser) |
| snap-origin-coincident.test.js | 72.4 | LOGIC | SS | a point snapped onto the origin leaves a COINCIDENT with j_origin (line end 0 / 12 / 15 px, not 24 px; circle centre); a line started on it uses j_origin | CONVERTED (task 569): tests/snap-origin-coincident-node.test.js |
| snap-release-slip-live.test.js | 13.2 | REAL-INPUT | Shaper | the < 200 ms release recovery puts back a SLIP, not a fast flick away | real event timing |
| stock-loop-live.test.js | 17.1 | MIXED | Shaper | Stock as a cut type: picked on a loop, moves with a notice, Ctrl+Z, the Review shows the board | LOGIC: the role + undo; SCREEN: Review WebGL |
| studio-encoding.test.js | 11.7 | LOGIC | Shaper | the export writes cut ENCODING exactly like Shaper Studio (attribute run, cutOffset / toolDia, hole winding, no fill-rule) | pure export output computed in the page |
| style-panel-tabs.test.js | 19.3 | MIXED | Shaper, SS | the Style panel tabs, one Units tab per host, keyboard access, the tab persisted per host across a reload, a unit flip re-labels the cut panel | SCREEN / REAL-INPUT: tabs, keyboard; LOGIC: persistence |
| symmetric-live-shaper.test.js | 27.5 | MIXED | Shaper | Symmetric tool picks: line pairs, circle pairs, points about the Y axis mirror; glyphs; one undo step | LOGIC: stored constraints, mirrored geometry, undo; SCREEN: six glyphs, the axis lit |
| symmetric-live-sketchstudio.test.js | 47.9 | MIXED | SS | as -shaper + right-click Delete constraint | as -shaper |
| save-key-leave-live-penplotter.test.js | 20.8 | MIXED | PP | TASK 558: Ctrl+S on an unsaved design opens Save as, on a named one writes now; the leave-page warning only when something is unsaved | LOGIC: what Ctrl+S stores (buffer decision); REAL-INPUT: the beforeunload dialog |
| save-key-leave-live-sketchstudio.test.js | 21.1 | MIXED | SS | as save-key-leave-live-penplotter, SketchStudio | as -penplotter |
| trace-projects.test.js | 37.4 | MIXED | all 4 (Trace) | TASK 567: the four File menus list the same items in the same order; Trace imports, saves "T1", a reload restores shapes + trace parameters; designs travel between Trace and the other apps | LOGIC: hosts.trace sidecar round trip; UI: the menus; REAL-INPUT: file chooser, reload |
| unsaved-prompt-live-penplotter-cancel.test.js | 28.1 | MIXED | PP | TASK 558: the unsaved-design question on every entry path (New, Open, Open recent, open file, ...), answer Cancel: nothing changes | LOGIC: the store / open design after the answer; UI: the question dialog and the menu paths (needs the shared sidebar in the kit) |
| unsaved-prompt-live-penplotter-discard.test.js | 27.2 | MIXED | PP | as -cancel, answer Discard: the drawing is dropped, the action goes on | as -cancel |
| unsaved-prompt-live-penplotter-save.test.js | 27.3 | MIXED | PP | as -cancel, answer Save: the drawing is saved under a name first | as -cancel |
| unsaved-prompt-live-sketchstudio-cancel.test.js | 28.9 | MIXED | SS | as unsaved-prompt-live-penplotter-cancel, SketchStudio | as -penplotter-cancel |
| unsaved-prompt-live-sketchstudio-discard.test.js | 27.9 | MIXED | SS | as unsaved-prompt-live-penplotter-discard, SketchStudio | as -penplotter-cancel |
| unsaved-prompt-live-sketchstudio-save.test.js | 27.7 | MIXED | SS | as unsaved-prompt-live-penplotter-save, SketchStudio | as -penplotter-cancel |

## Phase 2, batch A: converted (task 576)

28 batch A browser files plus the 3 phase 1 originals and 4 runners were replaced by 28 node tests (plus 3 node runners the wrappers import).
`node scripts/gate.cjs --list`: before 261 quick + 94 live = 355 files; after 289 quick + 65 live = 354 files (29 browser test files
deleted, 28 node test files added; the runners `draw-undo-runner.js`, `origin-snap-live-runner.js`, `axis-snap-live-runner.js` are not test files and
went with their wrappers). Each node file runs in 0.4 to 2.9 s (the recentre test 8 s: it keeps the real 3.2 s autosave-tick wait per host).

### Kit additions (declared in KIT_OVERRIDES at the top of tests/helpers/node-app.js, the only changes to the kit)
5. **hit testing**: happy-dom has no layout, so a pointer event goes to the canvas, where the app's own hit tests (snap, glyphs) read it. The app
   also reads WHICH ELEMENT a browser's hit test found (`e.target.closest('.dim-label')`): `target` option on `down / up / move / click / drag`
   (an element or a function returning it, since the renderer replaces elements), plus `dblclick` and `rightClick` (press, release, then the
   `contextmenu` event on the target) built on it. Needed by dimension-delete-select, dimension-point-line, dimension-redundant-driven.
6. **focus**: a browser cannot focus an `<svg>` element without a tabindex (the app calls `svg.focus()` on every pointerdown and must not take the focus
   from the value box it just opened); happy-dom can, so `SVGElement.focus` follows the browser's rule. Without it the dimension value box never kept focus
   (Enter went to the canvas).
Also fixed in the kit's SketchStudio host, not an override but a faithfulness fix found by recentre-on-reload: `main.js` does not wait for
`buffer.restore()` before `setupInput(svg, state)`; the kit awaited it first, so setupInput's 50 px per unit initial zoom overwrote the width a
restored huge drawing had just been framed to. The kit now starts the restore, runs setupInput, then awaits the restore, as the page does.
New helper (not the kit): `tests/helpers/node-dom-read.js` reads what the browser tests read from the drawn canvas (line elements in screen px,
dimension labels, the `#dimInput` box) through the app's own world to screen.

### Moved to batch C or kept as a slimmer browser test (splits)
- **recentre-on-reload-live**: SketchStudio and Shaper moved to node. The Pen Plotter case stays in `tests/recentre-on-reload-live.test.js`
  (trimmed to that host): its framing is wired in the page script (`apps/penplotter/src/sketch-stage.js` `fitToDrawing`), not in the declared
  `design-canvas.js`, so the kit does not run it. Joins batch C (the host stages).
- **dimension-delete-live**: the label routes (A click + Delete, D Undo, B line then label, E mixed Shift selection) moved to node (Shaper). Route C (a line
  selected first, then the constraint's ROW in the Design info panel, then Delete) stays in `tests/dimension-delete-live.test.js`: the info panel is a page hook
  the kit does not mount. The old "node twin" `tests/dimension-delete.test.js` covers only `deleteSelection`, not these selection routes, so it was not a replacement.
  The info panel refreshes only when its signature (counts, values, selected constraints) changes, so route C used to find fresh rows only because the label routes ran before it; the trimmed file now selects a label and clicks empty canvas after each re-seed (found by the first gate:merge: `panel row for constraint 0 exists`).

### Same asserts, old vs new

Every browser assert and its node counterpart. "same" = the same expression on the same values read from the same canvas / state.

| converted (new file) | browser assert (old) | node assert (new) |
|---|---|---|
| draw-undo-{esc,esc-2,switch,switch-2,session,shapes,shaper}-node.test.js (all through draw-undo-node-runner.js; each old wrapper's ONLY list kept) | per scenario: Ctrl+Z restores the pre-draw document exactly, no orphan joint, Ctrl+Y restores the drawn one (line, rect, circle, arc, polygon, bezier, fillet); chain of 3: [2,1,0] lines, no orphan, exact, 3 redos exact; Esc / tool switch mid-draw (6 tools each): unchanged document, Ctrl+Z undoes the PREVIOUS element, undo stack length unchanged, Ctrl+Y brings it back; per-tool-session chain: 3 lines, one Ctrl+Z exact with no orphan, old points kept, one Ctrl+Y exact; Ctrl+Z while the Line tool is active: 2 lines kept, no orphan, tool ended, then 1 line, then exact; Shaper: the journal labels line, rect, circle, arc, polygon, bezier, fillet exist | same, line for line (the runner's helper functions copied verbatim). One change: "the tool ended" read `.sk-ribbon-btn.active` is not `tool-line`; the ribbon highlight is the host's page hook (`panelTick`), so the node test reads `state.currentTool !== 'line'` (SketchStudio's highlight was asserted by the 569 kit too). The runner's "the click is on the canvas" guard is dropped (events are dispatched on the canvas). A new assert: at least one scenario ran |
| origin-snap-{shaper-off-a,shaper-off-b,shaper-on-a,shaper-on-b,studio-off-z0,studio-off-zin,studio-off-zout,studio-on-z0,studio-on-zin,studio-on-zout}-node.test.js (through origin-snap-node-runner.js; HOST / AXIS / ZOOMS / AWAY of each old file kept) | per cell (7 tools x zoom levels): New design has the origin joint and the origin marker; origin stays fixed at (0, 0); an element was made; the snap shown on the origin is `joint:j_origin`; attached to the origin (uses j_origin or a joint at (0, 0) coincident with it); a zoomed level has a different scale, each level its own scale; AWAY: axis snap shown and pointOnLine(end, ref_axis_x) stored when on, none when off | same; the rows printed are the same fields. "New design" runs the SAME project action (`createProjectActions` toolbar item `new-design`, unsaved question answered Don't save, then Save as for SketchStudio) instead of clicking the sidebar DOM (not mounted in the kit); the wheel is a WheelEvent on the canvas; AXIS_SNAP is set through the settings manager; the zoom scale is read through the app's world to screen |
| axis-snap-{lines,session,shapes}-node.test.js (axis-snap-node-runner.js; each old ONLY list kept) | 8 scenarios: stored joint exactly on the axis + a pointOnLine(ref_axis_x / ref_axis_y) constraint (line end X / Y, line start, rect corner, circle centre, polygon centre, arc centre, select drag); session: no axis highlight 60 px off, the X axis highlight while snapping, end joint y exactly 0, pointOnLine stored, undo removes it, redo brings it back on the axis, first-point drag keeps the end on the axis, survives save / load; setting off: no highlight, no axis constraint | same; the highlight is the `[data-snap-axis]` elements the renderer drew (the node kit's DOM draws them); a fresh page = a fresh profile with a named design, save / load = close and open on the same profile. The before / after screenshots (evidence only, no assert) are not taken |
| drag-own-midpoint-node.test.js | the line end is drawn where placed; at the default zoom (78.3 px per unit) and zoomed out (37 px per unit) a dragged end stays under the cursor (gap < 1 px) | same, gap 0.00 px at both zooms; settings AXIS_SNAP off and GRID_MAGNETISM 0.001 set through the settings manager |
| body-drag-owner-node.test.js | a driving 1.5 dimension; centre held 1.5 below the origin on the Y axis; arc as drawn (ends 20 / 160 deg); pulled down 0.3: centre stays, radius +0.3, ends keep angles, sweep flags kept; pulled back up: centre kept, radius back, ends keep angles | same; the middle-button pan is a pointer drag with button 1; typed value via `#dimInput` |
| dimension-point-line-node.test.js | A: two lines; one undo removes the dimension and the geometry is where it was; a driving 3.0 label (no parentheses); no extra shape; double click on the label opens the editor, typed 4.5 scales the perpendicular distance by 1.5; swinging the long line moves the geometry (> 20 px) and the distance holds (< 2 %); B: line-to-line in both click orders: label exists, positive, driving, one undo removes it | same; the double click names the label element (kit override 5); the dimension box takes focus (kit override 6) |
| dimension-redundant-driven-node.test.js | rect, locked corner, two typed 3.0 dimensions (box opens each time); the diagonal opens no box, 3 labels, bracketed (4.2); double click on it in the Dimension and the Select tool opens no box, nothing changed; right click offers Driving, clicking it is refused (still bracketed) with the "already determines it" toast; after deleting a side dimension Driving works, no brackets, double click opens the box | same; right click = right button + `contextmenu` on the label (kit `rightClick`); the corner's Lock from its context menu |
| clear-all-node.test.js | 3 shapes drawn; one selected renders differently; Clear All empties the board (<= 1 joint); repeated clicks change nothing; drawing works afterwards; Clear All with no selection empties it | same (the browser's 3-point drag path is a straight 8-step drag) |
| recentre-on-reload-node.test.js (SketchStudio, Shaper) | empty design view stable across reloads; small off-centre drawing framed (centred, inside, aspect, 10 % margin); a wheel zoom then two autosave ticks (3.2 s) do not re-fit; huge and tiny drawings framed after reload; Open recent small and huge each fit THAT design | same; Open recent = the `open` action of `designItems` (what the tile runs), reload = close and open on the profile. Pen Plotter stays in the browser (see above) |
| dimension-delete-select-node.test.js (Shaper) | per kind (6): label click selects only the dimension; Delete removes exactly one constraint, no shape / joint removed or moved; one Ctrl+Z gives it back; a line selected first then the label drops the geometry selection and Delete removes only the dimension; E: line + dimension with Shift removes both | same. Route C (panel row) stays in the browser file, see above |
| fusion-drag-app-node.test.js | 5 cells: free line by body (2 points move, length kept), rect edge (8 points, no length change), circle rim (centre kept, radius changes), arc end (radius changes), length-dimensioned line by an end (2 points, length kept); the node replay class equals the app's for each | same, plus one new assert: the length dimension exists (the browser run only logged the labels) |
| (deleted, node twin from task 569) snap-origin-coincident, draw-undo-live-lines, document-buffer-hosts | see "Proof: three tests converted" above | unchanged |

### Bites (a behaviour broken on purpose, the node test fails, reverted)

Spread over the kinds; each reverted with `git checkout` (the tree is clean of app code changes; `git status` shows tests / docs only).

| kind | break | test | failure |
|---|---|---|---|
| origin snap | a snap onto `j_origin` makes no COINCIDENT (`snap-constraints.js`) | origin-snap-studio-on-zin | `AssertionError ... circle centre: the element is attached to the origin (uses j_origin, or a joint at exactly (0, 0) coincident with it)` |
| origin snap (Shaper) | same | origin-snap-shaper-on-b | `... shaper axis on zoom -4 (5.503 px/unit) circle centre: the element is attached to the origin` |
| origin snap, axis away | the axis snap makes no constraint | origin-snap-studio-on-z0 | `AssertionError ... the line end sits on the X axis with pointOnLine(end, ref_axis_x): {"h":[],...}` |
| axis snap | same | axis-snap-lines / -session / -shapes | `line end on X axis: ... got {"shapes":1,"h":0,"v":0,"onX":[...],"constraints":[]}`; `pointOnLine(end, ref_axis_x) stored`; `circle centre on Y axis: ... "constraints":[]` |
| undo | `closeDrawStep` does nothing | draw-undo-esc / -switch-2 / -session / -shaper | `draw-undo (sketchstudio) failures:` / `draw-undo (shaper) failures:` |
| undo | `beginDrawStep` opens no step | draw-undo-shapes, draw-undo-lines-node (569) | `draw-undo (sketchstudio) failures:`, `draw-undo-lines-node failures:` |
| drag | the own line is a midpoint target again and the threshold is one world unit (the pre task 552 rule) | drag-own-midpoint | `AssertionError ... default: the dragged end stays under the cursor (gap 68.20 px)` |
| body drag | a body drag sets no target and solves nothing | body-drag-owner | `AssertionError ... the radius grows by 0.3 (0.8999999999999987 -> 0.8999999999999987)` |
| body drag | the line body drag holds its first end | fusion-drag-app | `AssertionError ... free line by its body: both ends move, the length is kept (translate, like Fusion)` |
| body drag | the rim point holds nothing | fusion-drag-app | `AssertionError ... circle grabbed on its rim resizes (centre kept, radius changes, like Fusion)` |
| dimension | `commitDimensionEdits` commits nothing | dimension-point-line | `AssertionError ... a driving (no parentheses) 3.0 dimension label is shown: ["2.0"]` |
| dimension | a refused Driving is not refused | dimension-redundant-driven | `AssertionError ... still bracketed (driven) after the refused Driving` |
| selection | a clicked dimension label keeps the earlier geometry selection (task 485) | dimension-delete-select | `AssertionError ... distance (two points): clicking a dimension drops the earlier geometry selection` |
| view | the fit margin 10 % to 20 % | recentre-on-reload | `AssertionError ... sketchstudio small off-centre after reload: 10% margin (fill 0.7142857142857143)` |
| clear all | Clear All with a selection does nothing | clear-all | `AssertionError ... Clear All with a selection empties the board: {"shapes":3,"joints":1}` |

Two first attempts did not fail the test and are recorded as what they say: removing `saveState()` from the polygon / circle tool (and the `closeDrawStep` calls in
`handleEscape` / the tool switch) changes nothing, because another layer (`beginDrawStep`, and Undo's own `closeDrawStep`) takes the same step. The
bites above break the layer all of them share.
