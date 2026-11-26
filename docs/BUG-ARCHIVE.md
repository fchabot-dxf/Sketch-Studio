# Bug Archive

An archive of bugs reported by the owner and bugs found by the advisor or worker seats during live Fusion checks, merge-gate checks, and code reviews (Sketch-Studio and its paired `shaper-addin`).

## Rule for adding to this archive

1. **Report day:** Every owner-reported bug — and every bug found by the advisor or a worker during live checks, merge gates, or reviews — gets one `BUG-NNN` entry the day it is reported, with `Status: open` (and `unknown` for any uninvestigated field).
2. **Fix day:** The fixing task updates its entry in the same commit: `Cause`, `Task id(s)`, `Fix merge sha`, `Guarding test file(s)`, and `Status` (`fixed`, `parked`, or `not reproduced`), and appends a `History` step if status changed over time.
3. **Evolution & links:** Keep `Related`, `Regression of`, and `Led to` updated so recurring patterns and fix chains stay visible; never rewrite old entries' facts — append corrections as `History` (git history tracks every revision).
4. **Re-reports:** A repeat report of the same bug links back to the original `BUG-NNN` entry (`Regression of` / `History`) instead of creating a duplicate.
5. **Audit-only findings:** Systematic audit findings belong in their audit documents (linked under [Audits](#audits)), not copied here unless independently reported by the owner or hit in live/gate use.

---

## Entries (oldest first)

### BUG-001
- **Date / turn:** 2026-11-14 (advisor log line 1; pre-turn 1521; merge date from git log)
- **Reported by:** owner (with race found by worker 635)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (website, Google Drive)
- **Owner's words:** unknown (not quoted verbatim in log; advisor log summary: `renaming a design ("bromont") does not rename the Drive file: Drive still shows Untitled.sketch.json and the JSON "name" is "Untitled". Owner screenshots: scratchpad/owner-rename-menu.png, owner-rename-drive.png.`)
- **What was wrong:** Renaming a Drive design left the file named `Untitled.sketch.json` (on the pre-624 build), and on current main renaming during a pending or in-flight autosave could overwrite the renamed file with stale/empty drawing data.
- **Cause:** `store.rename` ran without the per-design `withLock` serialization used by the autosave writer.
- **Task id(s):** `635`
- **Fix merge sha:** `99ecf4e2`
- **Guarding test file(s):** `tests/drive-rename.test.js`, `tests/drive-rename-live.test.js`
- **Status:** fixed
- **Family:** `sync`
- **Related:** BUG-002, BUG-036
- **Led to:** BUG-002 (task 639 moveDesign lock)
- **History:** reported pre-1521 (pre-624 build symptom) -> 635 fixed autosave lock 2026-11-14 -> test flaked until 899 (BUG-087) 2026-11-25

### BUG-002
- **Date / turn:** 2026-11-14 (advisor log line 3; turn ~1515-1521)
- **Reported by:** advisor
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (website, Google Drive)
- **Report:** `"store.moveDesign runs outside the per-design write lock, the same race 635 fixed in rename (a move during a pending autosave can drop the drawing)."`
- **What was wrong:** Moving a Drive design to another project folder during a pending autosave could drop the latest drawing changes.
- **Cause:** `store.moveDesign` ran outside the per-design `withLock` write lock.
- **Task id(s):** `639`
- **Fix merge sha:** `8d5485f1`
- **Guarding test file(s):** `tests/drive-move-autosave.test.js`
- **Status:** fixed
- **Family:** `sync`
- **Related:** BUG-001, BUG-036

### BUG-003
- **Date / turn:** 2026-11-14 (advisor log line 5; turn ~1515-1521)
- **Reported by:** advisor
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (website)
- **Report:** `"mobile-drawer.js:86 and style-panel.js:337 close only on outside click, not on a press on a disabled control (same bug 619 fixed in the Rect popover)."`
- **What was wrong:** Pressing on a disabled control outside the mobile drawer or Style/Settings panel did not close the panel.
- **Cause:** `mobile-drawer.js` and `style-panel.js` listened only to `click` (which browsers suppress on disabled buttons) instead of an outside-press helper on `pointerdown`.
- **Task id(s):** `640`
- **Fix merge sha:** `d0a4cc48`
- **Guarding test file(s):** `tests/outside-press-live.test.js`
- **Status:** fixed
- **Family:** `ui-input`
- **Related:** BUG-027, BUG-042

### BUG-004
- **Date / turn:** 2026-11-15 (turn 1679, turn 1684)
- **Reported by:** advisor
- **App(s) & host:** Test harness (Windows local environment / Edge CDP runner)
- **Report:** `"batch gate 669+668 RED = DISK FULL (C: 0.1 GB free): 1422 leaked sk-test-* browser profiles in %LOCALAPPDATA%\\Temp (~47 GB, since Nov 7)."` / `"Temp = 680 GB: scoped_dir* 486 GB ..., loose GUID *.tmp 142 GB ..."`
- **What was wrong:** Fresh-profile headless Edge test launches downloaded components into `Temp` (`scoped_dir*`, `*.tmp`) and left leaked `sk-test-*` browser profiles on failures, filling `C:` (~680 GB).
- **Cause:** `tests/helpers/cdp-browser.js` launched Edge without component-disable flags and did not reliably remove its temporary profile directory on crash/close.
- **Task id(s):** `671`
- **Fix merge sha:** `19723091`
- **Guarding test file(s):** `tests/cdp-launch-cleanup-live.test.js`, `tests/gate-profile-sweep.test.js`
- **Status:** fixed
- **Family:** `flaky-test`
- **Related:** BUG-011, BUG-068, BUG-087
- **Led to:** BUG-068 (task 860 teardown retry timeout)

### BUG-005
- **Date / turn:** 2026-11-15 (turns 1688-1689; follow-up in 680)
- **Reported by:** owner (with 680 follow-up found by worker 680)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (website templates / Design)
- **Owner's words:** unknown (not quoted verbatim in log; advisor log summary: `OWNER box-frame screenshots -> reproduced: shrinking box-frame overall length (1500->1200/900/591) FOLDS the top end board above the top edge` / `OWNER turn 1689: confirms top board ends OUTSIDE the sides after shrink.`)
- **What was wrong:** Shrinking the `Box frame` template's overall length caused the top end board to flip/fold above the top edge instead of staying inside the frame.
- **Cause:** Task 669 used unsigned `equal-lengths` constraints (fixed with signed H/V dims in 670), and when rebuilt via tool-ops in 680 `detectDimMode` created aligned dimensions instead of H/V on level/plumb pairs.
- **Task id(s):** `670`, `680`
- **Fix merge sha:** `ad0e0088` (670), `dd5f8adc` (680)
- **Guarding test file(s):** `tests/template-params-670.test.js`, `tests/template-recipes-680.test.js`
- **Status:** fixed
- **Family:** `solver`
- **Related:** BUG-018, BUG-046
- **Regression of:** BUG-005 (re-exposed in 680 tool-ops rebuild after 670 fix)
- **History:** reported 2026-11-15 -> fixed 670 2026-11-15 -> folded again in 680 tool-ops -> fixed 680 2026-11-15

### BUG-006
- **Date / turn:** 2026-11-15 (turn 1703)
- **Reported by:** owner
- **App(s) & host:** SketchStudio (website, phone landscape `844x390`)
- **Owner's words:** unknown (not quoted verbatim in log; advisor log summary: `OWNER turn 1703: phone landscape screenshot - floating footer (undo/redo/clear/delete/recenter) straddles canvas bottom edge (844x390: canvas bottom 373, buttons 346..390).`)
- **What was wrong:** In phone landscape, the floating footer buttons straddled and extended past the bottom edge of SketchStudio's canvas frame.
- **Cause:** SketchStudio's canvas ends 17 px above the viewport bottom (padding + border), while `.sk-footer` was pinned at `bottom: 0` instead of inside the canvas frame inset (`--sk-canvas-edge` + `--sk-canvas-inset`).
- **Task id(s):** `676`
- **Fix merge sha:** `6083829e`
- **Guarding test file(s):** `tests/phone-landscape-sketchstudio-live.test.js` (via `tests/helpers/phone-landscape.js`)
- **Status:** fixed
- **Family:** `layout-overlap`
- **Related:** BUG-020, BUG-055

### BUG-007
- **Date / turn:** 2026-11-15 (turn 1732)
- **Reported by:** owner
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (website templates / Design)
- **Owner's words:** unknown (not quoted verbatim in log; advisor log summary: `OWNER turn 1732: template dims too close to the outline (rounded rectangle screenshot) -> 672 ADDITION 2: one offset rule in the template dim helper`)
- **What was wrong:** Template dimensions sat too close to (or overlapped) the template outline in the rounded rectangle and other templates.
- **Cause:** Template dimension placement did not compute a size-proportional outward offset or step stacked dimensions clear of the outline.
- **Task id(s):** `672`
- **Fix merge sha:** `def2e277`
- **Guarding test file(s):** `tests/templates-672.test.js`, `tests/templates-672-live.test.js`
- **Status:** fixed
- **Family:** `layout-overlap`
- **Related:** BUG-026, BUG-070

### BUG-008
- **Date / turn:** 2026-11-15 (turn ~1749, during 679)
- **Reported by:** worker (`679`)
- **App(s) & host:** Core solver / SketchStudio, Shaper, Pen Plotter, Trace (website)
- **Report:** `"Hidden bug found: chained joints.set wrappers stamped entities with newest state's sketch (fixed by separate stores)."`
- **What was wrong:** Multiple `createEngine` / `createSketchState` instances chained module-level store wrappers, causing `joints.set` to stamp entities with the newest state's active sketch id.
- **Cause:** `constraint-solver.js` held a module-level engine store shared across `createEngine` calls.
- **Task id(s):** `679`
- **Fix merge sha:** `b74b6737`
- **Guarding test file(s):** `tests/engine-store-isolated.test.js`, `tests/engine-store-isolated-live.test.js`
- **Status:** fixed
- **Family:** `solver`
- **Related:** BUG-005, BUG-059

### BUG-009
- **Date / turn:** 2026-11-15 (turn 1752, during 675)
- **Reported by:** worker (`675`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (website, Design)
- **Report:** `"hover narrowed to active sketch for offset/mirror/fillet/trim/break (click picks were already fine)"`
- **What was wrong:** Hovering in Offset, Mirror, Fillet, Trim, or Break highlighted another visible sketch's nearer curve over an active-sketch curve even though those tools only act on the active sketch.
- **Cause:** `updateHover` in `packages/ui/hover-manager.js` ran `pickScene` without `activeSketchScene` narrowing for `ACTIVE_SKETCH_HOVER_TOOLS`.
- **Task id(s):** `675`
- **Fix merge sha:** `8701c3e2`
- **Guarding test file(s):** `tests/active-sketch-pick-675-node.test.js`, `tests/active-sketch-pick-675-live.test.js`
- **Status:** fixed
- **Family:** `ui-input`
- **Related:** BUG-010, BUG-053

### BUG-010
- **Date / turn:** 2026-11-15 (turn 1752)
- **Reported by:** worker (`675`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (website, Design)
- **Report:** `"NEW BUG -> backlog 682: Line tool start click ~3.6 px off a joint aborts the line (line-tool.js:358 movedSinceStart vs snapped startPt)."`
- **What was wrong:** Starting a line by clicking within the snap radius (~3.6 px) of an existing joint aborted the line on release instead of starting from that joint.
- **Cause:** `movedSinceStart` compared the raw pointer position against the snapped `startPt` rather than checking screen-space pointer movement.
- **Task id(s):** `682`
- **Fix merge sha:** `6f3fefa5`
- **Guarding test file(s):** `tests/line-start-snap-click-682-node.test.js`, `tests/line-start-snap-click-682-live.test.js`
- **Status:** fixed
- **Family:** `ui-input`
- **Related:** BUG-009, BUG-073, BUG-075

### BUG-011
- **Date / turn:** 2026-11-15 to 2026-11-17 (turns 1765, 1810, 2120, 2180, 2323)
- **Reported by:** advisor
- **App(s) & host:** Test harness + Pen Plotter / Shaper (`document-buffer.js`, `notification-manager.js`)
- **Report:** `"penplotter-cosmetics.test.js:82 flake (fixed sleep(300) before reading #mixStatus -> waitFor), 3 red gates today."` / `"first canvas press after a ribbon tool click sometimes never reaches the page"` / `"FIRST-CLICK-DROPPED bug, 4th sighting"`
- **What was wrong:** The first canvas click right after picking a tool was dropped while initial IndexedDB `restore()` gated `#design-canvas` events or while a passive toast sat over the target, causing repeated merge-gate failures (`penplotter-cosmetics`, `bezier-loops-761-shaper-live`).
- **Cause:** `document-buffer.js` `gate()` silently discarded `#design-canvas` pointer events while `data-doc-ready="0"`, passive toasts intercepted clicks, and `penplotter-cosmetics.test.js` used fixed sleeps without waiting for mousemove/DOM readiness.
- **Task id(s):** `683`, `744`, `744b`, `771`
- **Fix merge sha:** `1c51403d` (683), `10b923f8` (744), `a51e9df6` (771)
- **Guarding test file(s):** `tests/penplotter-cosmetics.test.js`, `tests/first-click-771-live.test.js`
- **Status:** fixed
- **Family:** `flaky-test`
- **Related:** BUG-004, BUG-016, BUG-023, BUG-087
- **Led to:** BUG-087 (893 settledCentre toast wait)
- **History:** flaked 2026-11-15 -> waitFor in 683 2026-11-15 -> mousemove wait in 744 2026-11-16 -> step waits in 744b 2026-11-17 -> app click replay + click-through toasts in 771 2026-11-17 -> toast settle wait in 893 2026-11-25

### BUG-012
- **Date / turn:** 2026-11-15 (turn 1776)
- **Reported by:** worker (`681`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (website)
- **Report:** `"side bug: empty tab shows unsaved dot after reload"` / `"phone-rotation-live asserts desktop tab row 26 (now 33)"`
- **What was wrong:** An untouched empty document tab showed an unsaved indicator dot after page reload.
- **Cause:** `684` fixed the empty-tab dirty state when consolidating the shared `openTabsBuffer` (while `681` updated the desktop tab row height assertion).
- **Task id(s):** `681`, `684`
- **Fix merge sha:** `b2ecda4e` (681), `7bc14006` (684)
- **Guarding test file(s):** `tests/shared-tabs-684-live.test.js`
- **Status:** fixed
- **Family:** `sync`
- **Related:** BUG-014, BUG-015
- **History:** found in 681 2026-11-15 -> fixed in 684 2026-11-15

### BUG-013
- **Date / turn:** 2026-11-15 (turn 1791)
- **Reported by:** owner
- **App(s) & host:** Shaper (Fusion panel)
- **Owner's words:** unknown (not quoted verbatim in log; owner screenshot reported `palette in Fusion says 'Fusion host unavailable (window.adsk missing)'`)
- **What was wrong:** Opening the Shaper palette in Fusion displayed `"Fusion host unavailable (window.adsk missing)"` with `Add selection` disabled.
- **Cause:** `mountFusionPrepareBar` in `apps/shaper/src/fusion-bridge.js` checked `window.adsk` once at mount before Fusion injected `window.adsk.fusionSendData` asynchronously.
- **Task id(s):** `685`
- **Fix merge sha:** `0f11ba70`
- **Guarding test file(s):** `tests/fusion-adsk-wait-685-node.test.js`, `tests/fusion-adsk-wait-685-live.test.js`
- **Status:** fixed
- **Family:** `sync`
- **Related:** BUG-065

### BUG-014
- **Date / turn:** 2026-11-15 (turn ~1793, during 684)
- **Reported by:** worker (`684`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (website, IndexedDB / Drive)
- **Report:** `"Drive sidecar-loss bug fixed, Trace photo / Shaper Explore SVG DataCloneError (silent catch!) fixed"`
- **What was wrong:** Writing Trace photo or Shaper Explore SVG data through the shared tabs buffer threw `DataCloneError` in IndexedDB (swallowed by a silent catch), and saving from one app could drop another app's Drive sidecar.
- **Cause:** Unserializable/non-cloned fields hit IndexedDB `put` inside a silent `catch`, and Drive saves dropped foreign host sidecars not tracked as `foreign`.
- **Task id(s):** `684`
- **Fix merge sha:** `7bc14006`
- **Guarding test file(s):** `tests/shared-tabs-684.test.js`, `tests/shared-tabs-684-live.test.js`
- **Status:** fixed
- **Family:** `storage-lifecycle`
- **Related:** BUG-012, BUG-015
- **Led to:** BUG-012 (empty-tab dot), BUG-015 (task 687 sidecar-on-show)

### BUG-015
- **Date / turn:** 2026-11-15 (turn 1811)
- **Reported by:** advisor
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (website, IndexedDB / Drive)
- **Report:** `"Pen Plotter/Trace default sidecar on show"` / `"viewing a saved design in Pen Plotter then Trace wrote default hosts.penplotter / hosts.trace to buffer, store AND Drive"`
- **What was wrong:** Merely opening or viewing a saved design in Pen Plotter or Trace (or zooming/panning) wrote default host sidecars into the shared buffer, IndexedDB store, and Google Drive.
- **Cause:** `document-buffer.js` `docChangeSig` included render cache fields (`glyphPos`, `__visible`), triggering autosave, and `currentDoc` always emitted the current app's default sidecar.
- **Task id(s):** `687`
- **Fix merge sha:** `a2a3e20b`
- **Guarding test file(s):** `tests/sidecar-on-show-687-live.test.js`
- **Status:** fixed
- **Family:** `storage-lifecycle`
- **Related:** BUG-012, BUG-014

### BUG-016
- **Date / turn:** 2026-11-15 (turn 1811)
- **Reported by:** advisor
- **App(s) & host:** Pen Plotter (website, test suite)
- **Report:** `"penplotter-cosmetics:74 not reproduced in 78 loaded runs ... Lead: the test does not waitForApp('design-canvas') after the Design stage switch (ResizeObserver fit / updateViewBox async). Parked"`
- **What was wrong:** `penplotter-cosmetics:74` (`"strokeColor enabled after selecting line"`) intermittently failed under parallel gate load.
- **Cause:** Suspected missing `waitForApp('design-canvas')` after switching to Design stage; could not be reproduced in 78 loaded runs.
- **Task id(s):** `686`
- **Fix merge sha:** unmerged (parked)
- **Guarding test file(s):** `tests/penplotter-cosmetics.test.js`
- **Status:** not reproduced
- **Family:** `flaky-test`
- **Related:** BUG-011, BUG-087
- **History:** flaked in 680 gate 2026-11-15 -> not reproduced in 78 loaded runs (686) -> parked 2026-11-15

### BUG-017
- **Date / turn:** 2026-11-15 (turn 1833)
- **Reported by:** worker (`691`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (website, phone)
- **Report:** `"phone double-tap on a pattern label: 2nd tap's click can hit the done check that moved near the label (test moved O to avoid it) -> real bug"`
- **What was wrong:** Double-tapping a pattern label on a phone caused the second tap to hit the `done-button` green check that appeared in the above-right slot at `pointerup` instead of opening the pattern edit dialog.
- **Cause:** `done-button.js` allowed the check button to land over the active press rectangle when the bottom sheet blocked below-right placement.
- **Task id(s):** `701`
- **Fix merge sha:** `13873962`
- **Guarding test file(s):** `tests/dbltap-done-701-live.test.js`, `tests/done-press-701-node.test.js`
- **Status:** fixed
- **Family:** `layout-overlap`
- **Related:** BUG-006, BUG-057

### BUG-018
- **Date / turn:** 2026-11-15 (turn ~1835, during 693)
- **Reported by:** worker (`693`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (website templates)
- **Report:** `"found real bug: thickD 250 drew inverted with Open enabled."`
- **What was wrong:** On the Right-angle brace template, entering a diagonal thickness too large to leave an inner opening (`thickD = 250`) drew an inverted geometry instead of refusing with an error.
- **Cause:** The template lacked the exact incircle-style refusal check (`H*tv + W*th + hyp*td >= W*H`).
- **Task id(s):** `693`
- **Fix merge sha:** `ca2476f2`
- **Guarding test file(s):** `tests/template-polish-693-node.test.js`, `tests/template-polish-693-live.test.js`
- **Status:** fixed
- **Family:** `solver`
- **Related:** BUG-005, BUG-060

### BUG-019
- **Date / turn:** 2026-11-16 (turn ~1840, during 694)
- **Reported by:** worker (`694`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (website, Parameters table)
- **Report:** `"parameter-table .pt-fx display:inline-block overrides [hidden] (fx badge on every row, pre-existing)"`
- **What was wrong:** The `fx` formula badge displayed on every row in the Parameters table, even for plain constant values.
- **Cause:** `.pt-fx { display: inline-block }` in `parameter-table.js` CSS overrode the HTML `[hidden]` attribute.
- **Task id(s):** `699`
- **Fix merge sha:** `bded9dc4`
- **Guarding test file(s):** `tests/parameters-fx-badge-699-live.test.js`
- **Status:** fixed
- **Family:** `layout-overlap`
- **Related:** BUG-031

### BUG-020
- **Date / turn:** 2026-11-16 (turn 1863)
- **Reported by:** owner
- **App(s) & host:** Shaper (`shaper-svg.pages.dev`, phone)
- **Owner's words:** unknown (not quoted verbatim in log; advisor log summary: `OWNER turn 1863: phone screenshot shaper-svg broken -> reproduced on main AND pre-696 (02a8f40): Shaper phone = Explore 3-col squeezed, stage bar hidden.`)
- **What was wrong:** On mobile viewports, Shaper opened on the 3-column Explore desktop grid (`220px 1fr 300px`), squeezing the canvas column to `0 px` width and pushing the inspector off-screen.
- **Cause:** `apps/shaper/styles/main.css` lacked `@media` phone layout rules for `.layout`, `#vcarve-panel`, and `#review-side`.
- **Task id(s):** `705`
- **Fix merge sha:** `4499cbf2`
- **Guarding test file(s):** `tests/shaper-phone-705-live.test.js`, `tests/short-viewport-node.test.js`
- **Status:** fixed
- **Family:** `layout-overlap`
- **Related:** BUG-006, BUG-021, BUG-040, BUG-070, BUG-078

### BUG-021
- **Date / turn:** 2026-11-16 (turn 1867)
- **Reported by:** owner
- **App(s) & host:** Shaper (website, phone)
- **Owner's words:** unknown (not quoted verbatim in log; advisor log summary: `OWNER turn 1867: Design 'Import SVG / DXF…' on phone: picked file, nothing appeared`)
- **What was wrong:** Importing an SVG/DXF file on phone in Shaper appeared to do nothing after picking the file.
- **Cause:** Shaper opened on the Explore stage, and `showDocument()` / `importIntoSketch()` left the UI on Explore while importing into the hidden Design canvas.
- **Task id(s):** `705`
- **Fix merge sha:** `4499cbf2`
- **Guarding test file(s):** `tests/shaper-phone-import-705-live.test.js`, `tests/shaper-stage-open-705-node.test.js`
- **Status:** fixed
- **Family:** `ui-input`
- **Related:** BUG-020, BUG-040

### BUG-022
- **Date / turn:** 2026-11-16 (turn 1901)
- **Reported by:** advisor
- **App(s) & host:** Shaper (Fusion panel + website SVG export)
- **Report:** `"EXPORT BUG: pocket outlines A/step/island written as INSIDE 19mm (through!) + holes & slot duplicated -> TASK 711 (Opus) URGENT."`
- **What was wrong:** Exporting a real Fusion solid plate with pockets and holes wrote the pocket walls as full-depth (19 mm through) Inside cuts and duplicated holes and slots.
- **Cause:** `deriveProfileCuts` in `packages/core/profile-model.js` emitted every inner loop of an Outside cut as an automatic through-hole cut even when that loop already had its own Pocket/Inside record (`ownedLoopIds`).
- **Task id(s):** `711`
- **Fix merge sha:** `44573da9`
- **Guarding test file(s):** `tests/export-own-hole-711-node.test.js`, `tests/export-own-hole-711-live.test.js`
- **Status:** fixed
- **Family:** `export-svg`
- **Related:** BUG-043, BUG-051
- **Led to:** BUG-051 (task 814 Guide-on-hole skipped hole in Outside)

### BUG-023
- **Date / turn:** 2026-11-16 (turn ~1910) and 2026-11-21 (turn 3210)
- **Reported by:** advisor
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (website + Edge bfcache / test runner)
- **Report:** `"page left mid IndexedDB creation (fresh profile) parked in bfcache (Edge 157 doesn't evict mid-upgrade) -> every later open waits forever"` / `"Edge 158 update (today 12:10) caches pages mid-IndexedDB-open; fix in packages/ui/project-store.js (Web Lock during open, unload listener removed)."`
- **What was wrong:** Navigating away while a fresh browser profile was creating the IndexedDB database froze the `onupgradeneeded` transaction in bfcache, blocking every subsequent tab/open at `data-doc-ready="0"`.
- **Cause:** `project-store.js` `createIdbAdapter` allowed the page to enter bfcache mid-IDB-open; `713` used an `unload` listener, and Edge 158 later required a Web Lock during `openDatabase`.
- **Task id(s):** `713`, `801e`
- **Fix merge sha:** `11567260` (713), `76004257` (801e)
- **Guarding test file(s):** `tests/store-open-left-713-live.test.js`
- **Status:** fixed
- **Family:** `storage-lifecycle`
- **Related:** BUG-011, BUG-087
- **Regression of:** BUG-023 (Edge 158 update re-broke 713 unload workaround)
- **History:** found 2026-11-16 -> fixed 713 (unload) 2026-11-16 -> regressed in Edge 158 2026-11-21 -> fixed 801e (Web Lock) 2026-11-21

### BUG-024
- **Date / turn:** 2026-11-16 (turn 1911)
- **Reported by:** advisor
- **App(s) & host:** `shaper-addin` (Fusion add-in)
- **Report:** `"MATRIX turn 1911: 16 Fusion solids extracted (matrix/*.json): bugs 03 floor fillet shrinks pocket, 06 countersink loses hole; 02 draft floor-vs-opening owner Q"`
- **What was wrong:** On 3D solid extraction, a pocket with a floor fillet shrank its region to the inner fillet radius, a countersunk hole lost the inner through-hole, and drafted pockets needed the conservative intersection/union rule.
- **Cause:** `body_extract` used floor/single-loop bounds instead of conservative ring intersection (pockets/holes) and union (outside) across sloped/filleted walls.
- **Task id(s):** `SA-6`, `SA-8`
- **Fix merge sha:** `a7a5904` (SA-6), `9b1d929` / `9caec44` (SA-8, `shaper-addin`)
- **Guarding test file(s):** unknown (`shaper-addin` repo; not inspected from Sketch-Studio worktree)
- **Status:** fixed
- **Family:** `fusion-frame`
- **Related:** BUG-048, BUG-064, BUG-071
- **History:** found 2026-11-16 -> fixed SA-6 2026-11-16 -> conservative rule reversed SA-6 in SA-8 2026-11-16

### BUG-025
- **Date / turn:** 2026-11-16 (turn 1993)
- **Reported by:** owner
- **App(s) & host:** Shaper (website, Export 2D preview)
- **Owner's words:** unknown (not quoted verbatim in log; advisor log summary: `OWNER turn 1993: stepped-inside rings not shaded -> TASK 720`)
- **What was wrong:** In the 2D export preview, stepped-pocket and stepped-outside rings were shaded by depth (task 719), but stepped-inside rings were left unshaded.
- **Cause:** `apps/shaper/src/export-preview.js` only implemented shading for stepped pocket and outside cuts, omitting `insideStepShades`.
- **Task id(s):** `720`
- **Fix merge sha:** `92cd4be7`
- **Guarding test file(s):** `tests/export-preview-720-node.test.js`, `tests/export-preview-720-live.test.js`
- **Status:** fixed
- **Family:** `export-svg`
- **Related:** BUG-033, BUG-034

### BUG-026
- **Date / turn:** 2026-11-16 (turn 2002)
- **Reported by:** owner
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (website, Templates)
- **Owner's words:** `"templates are still in mm even if I set my file as inches"` (from `WORK-LOG.md` TURN 722)
- **What was wrong:** Template parameters, start-modal defaults, and previews always stayed in millimetres even when the document unit was set to inches.
- **Cause:** `packages/core/templates.js` and `packages/ui/template-picker.js` did not convert defaults, parameters, or refusal limits to `docUnit()`.
- **Task id(s):** `722`
- **Fix merge sha:** `70a78b2a`
- **Guarding test file(s):** `tests/template-units-722-node.test.js`, `tests/template-units-722-live.test.js`
- **Status:** fixed
- **Family:** `units`
- **Related:** BUG-029, BUG-037, BUG-039

### BUG-027
- **Date / turn:** 2026-11-16 (turn 2008)
- **Reported by:** owner
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (website, Design)
- **Owner's words:** unknown (not quoted verbatim in log; advisor log summary: `OWNER turn 2008: dimension edit box stays open while editing other geometry -> TASK 723`)
- **What was wrong:** Clicking away or starting another tool while a dimension edit box was open left `#dimInput` open with its typed text uncommitted and its label hidden.
- **Cause:** `packages/ui/numeric-input-manager.js` `showEditInput` attached only keyboard handlers (`Enter`/`Esc`/`Ctrl+Z`) and no capture `pointerdown` listener for outside presses.
- **Task id(s):** `723`
- **Fix merge sha:** `9946de5d`
- **Guarding test file(s):** `tests/dim-box-outside-press-723-live.test.js`
- **Status:** fixed
- **Family:** `ui-input`
- **Related:** BUG-003, BUG-028, BUG-042

### BUG-028
- **Date / turn:** 2026-11-16 (turn ~2015, during 723)
- **Reported by:** worker (`723`)
- **App(s) & host:** SketchStudio (website, Design)
- **Report:** `"FIX found bug: edit box positioned in viewport coords inside container (~180px off in SketchStudio) -> share placeLiveBox's offsetParent conversion."`
- **What was wrong:** The dimension edit box opened ~190 px off from its label in SketchStudio.
- **Cause:** `placeEditBox` wrote viewport coordinates directly into a positioned container without converting relative to `offsetParent`.
- **Task id(s):** `723`
- **Fix merge sha:** `9946de5d`
- **Guarding test file(s):** `tests/dim-box-place-723-live.test.js`
- **Status:** fixed
- **Family:** `layout-overlap`
- **Related:** BUG-027

### BUG-029
- **Date / turn:** 2026-11-16 (turn ~2020, during 724)
- **Reported by:** advisor
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (website, Design)
- **Report:** `"SENT BACK: untouched prefilled box must not commit rounded value (precision 0: 4.6 -> 5)."`
- **What was wrong:** Pressing Enter on an untouched dimension edit box when display precision was reduced (e.g., 0 decimals) overwrote the exact geometry value `4.6` with the rounded display string `5`.
- **Cause:** Commit handlers did not distinguish an untouched prefilled box from a user-edited value.
- **Task id(s):** `724`
- **Fix merge sha:** `6bfa340a`
- **Guarding test file(s):** `tests/display-precision-724-node.test.js`, `tests/display-precision-724-live.test.js`
- **Status:** fixed
- **Family:** `units`
- **Related:** BUG-026, BUG-037, BUG-039

### BUG-030
- **Date / turn:** 2026-11-16 (turn 2057)
- **Reported by:** owner
- **App(s) & host:** Shaper (website, Prepare)
- **Owner's words:** unknown (not quoted verbatim in log; advisor log summary: `OWNER turn 2057: Prepare depth chip too big`)
- **What was wrong:** Depth chips in Prepare scaled with world coordinates, appearing huge (e.g., 81 px tall) when zoomed in on small shapes.
- **Cause:** `apps/shaper/src/prepare-view.js` `depthChip` drew the chip and `.sk-chip-text` in fixed world units (`h 8.5, font 5`) rather than screen pixels via `worldTolerance`.
- **Task id(s):** `731`
- **Fix merge sha:** `aa5e1327`
- **Guarding test file(s):** `tests/depth-chip-731-live.test.js`
- **Status:** fixed
- **Family:** `layout-overlap`
- **Related:** BUG-041

### BUG-031
- **Date / turn:** 2026-11-16 (turn ~2060)
- **Reported by:** owner (spotted in owner screenshot; also noted in 699/712/717)
- **App(s) & host:** Shaper (website, Prepare cut card)
- **Report:** `"FOUND (owner screenshot): .cut-row/.cut-card display:flex override [hidden] -> stepped rows + card always visible -> added to 730."`
- **What was wrong:** Hidden cut-card rows and the cut card itself remained visible (showing stale values) even when `[hidden]` was set.
- **Cause:** `.cut-row` and `.cut-card` in `apps/shaper/index.html` declared `display: flex` without a `:not([hidden])` / `[hidden] { display: none }` guard.
- **Task id(s):** `730`
- **Fix merge sha:** `daa9527d`
- **Guarding test file(s):** `tests/number-stepper-730-live.test.js`
- **Status:** fixed
- **Family:** `layout-overlap`
- **Related:** BUG-019

### BUG-032
- **Date / turn:** 2026-11-16 (turn 2060)
- **Reported by:** owner
- **App(s) & host:** Shaper (website, Prepare)
- **Owner's words:** unknown (not quoted verbatim in log; advisor log summary: `OWNER turn 2060: Prepare click in the box-frame bottom board selects bottom board + dividers + left end as one region`)
- **What was wrong:** Clicking inside the bottom board of the `Box frame (front view)` template in Prepare selected the bottom board together with the left end and dividers as one merged region.
- **Cause:** `packages/core/loop-geometry.js` `polygonContains` tested `inner[0]` (which lay on a shared edge), misclassifying adjacent boards as holes inside the clicked board instead of testing a strictly interior point.
- **Task id(s):** `732`
- **Fix merge sha:** `d531fdc4`
- **Guarding test file(s):** `tests/prepare-pick-732-node.test.js`, `tests/prepare-pick-732-live.test.js`
- **Status:** fixed
- **Family:** `toolpath-geometry`
- **Related:** BUG-056

### BUG-033
- **Date / turn:** 2026-11-16 (turn ~2075, during 736)
- **Reported by:** advisor
- **App(s) & host:** Shaper (website, Stepped cuts)
- **Report:** `"736 SENT BACK: removing floors exposed merge-chain collapse (sameOutline vs replaced step -> fine step gives 1 step); fix = compare to run's first outline."`
- **What was wrong:** With fine step depths, `steppedTerraces` gradually drifted and collapsed an entire slope into a single step.
- **Cause:** `sameOutline` compared each step against the immediately preceding kept step instead of against the first outline in the current merge run.
- **Task id(s):** `736`
- **Fix merge sha:** `bf6a1757`
- **Guarding test file(s):** `tests/no-min-736-node.test.js`
- **Status:** fixed
- **Family:** `toolpath-geometry`
- **Related:** BUG-025

### BUG-034
- **Date / turn:** 2026-11-16 (turn 2116, during 742)
- **Reported by:** worker (`742`)
- **App(s) & host:** Shaper (website, Export 2D preview)
- **Report:** `"Found: Export 2D outside fill covers plate hole (pre-existing)."`
- **What was wrong:** In Export 2D preview, the Stock / outside guide fill hid the part and covered plate holes.
- **Cause:** Export 2D preview painted guide fills over cut shapes instead of drawing guides as outlines behind the cuts.
- **Task id(s):** `757`
- **Fix merge sha:** `08bfe05f`
- **Guarding test file(s):** `tests/polish-757-node.test.js`, `tests/polish-757-live.test.js`
- **Status:** fixed
- **Family:** `export-svg`
- **Related:** BUG-025, BUG-043

### BUG-035
- **Date / turn:** 2026-11-17 (turn 2283, during 761)
- **Reported by:** worker (`761`)
- **App(s) & host:** Shaper (website, SVG export)
- **Report:** `"Found bug: chainToPathD drops beziers from On-line export today (in scope)."`
- **What was wrong:** On-line SVG exports omitted Bezier curve segments in open chains.
- **Cause:** `chainToPathD` in the exporter lacked a cubic Bezier segment writer.
- **Task id(s):** `761`
- **Fix merge sha:** `09ecfb3d`
- **Guarding test file(s):** `tests/bezier-loops-761-node.test.js`, `tests/bezier-loops-761-shaper-live.test.js`
- **Status:** fixed
- **Family:** `export-svg`
- **Related:** BUG-043, BUG-045

### BUG-036
- **Date / turn:** 2026-11-17 (turns 2307, 2311, 2312)
- **Reported by:** owner
- **App(s) & host:** Shaper (website, Prepare + Google Drive)
- **Owner's words:** `"Another device changed this design. Your unsaved changes were kept as \"tester (conflicted copy ...)\""` (notice quoted by owner in turn 2312; turns 2307/2311 summarized as `Prepare view resets + selection dropped 'randomly' while editing a path (Drive design 'bromont')` and `Prepare erases toolpath settings (data loss; 118.png shows a pocket back at defaults)`)
- **What was wrong:** While editing a cut card on a Drive design, Prepare unexpectedly reset the viewport, dropped the selection, erased recent cut settings, and saved a false `"conflicted copy"`.
- **Cause:** If a Drive autosave's metadata/version request failed after the content PATCH succeeded, `project-store.js` didn't record the new Drive version; the retry saw `rec.version !== base` and invoked `onConflict`, which auto-reloaded Drive's older state over the running design.
- **Task id(s):** `766`
- **Fix merge sha:** `1fe8fa5e`
- **Guarding test file(s):** `tests/drive-own-write-766-node.test.js`, `tests/prepare-drive-own-write-766-live.test.js`, `tests/prepare-drive-conflict-766-live.test.js`, `tests/drive-first-safety.test.js`
- **Status:** fixed
- **Family:** `sync`
- **Related:** BUG-001, BUG-002, BUG-037

### BUG-037
- **Date / turn:** 2026-11-17 (turns 2307, 2307b)
- **Reported by:** owner
- **App(s) & host:** Shaper (website, Prepare cut card & Operations list)
- **Owner's words:** `"steppers dont increment by correct amount"` (and turn 2307: `card 0.187 vs ops list 0.188 for 3/16`; `bit dia shows 0.313`)
- **What was wrong:** A stepped `3/16 in` value displayed as `0.187` on the cut card while showing `0.188` in the Operations list (and `5/16` displayed as `0.313` under 3-decimal rounding).
- **Cause:** Floating-point arithmetic left `3/16 in` as `4.762499999999999 mm` (`0.18749999999999997 in` -> `"0.187"`) vs typed `4.7625 mm` (`"0.188"`); fixed in `packages/core/units.js` `format` (12 significant digits before rounding; 3-decimal default kept by owner ruling turn 2338).
- **Task id(s):** `766`
- **Fix merge sha:** `1fe8fa5e`
- **Guarding test file(s):** `tests/inch-text-766-node.test.js`
- **Status:** fixed
- **Family:** `units`
- **Related:** BUG-026, BUG-029, BUG-036, BUG-039

### BUG-038
- **Date / turn:** 2026-11-17 (turns 2309, 2309b)
- **Reported by:** owner
- **App(s) & host:** Shaper (website, Export & ShaperHub Sync)
- **Owner's words:** `"worked but it also said my file name was already used"`, `"shaper_export"`, `"it's not using my project fname"` (from `WORK-LOG.md` TURN 767; plus Chrome autofill causing 401 when password wasn't typed by hand)
- **What was wrong:** Shaper exported and uploaded every design as hardcoded `shaper-export.svg` instead of the design name, colliding with previous uploads in ShaperHub My Files and failing after uploading the blob.
- **Cause:** Generate, Download, and Sync all hardcoded `'shaper-export.svg'`, and `uploadToShaperHub` uploaded the blob and created the file entry without first checking if the name existed.
- **Task id(s):** `767`
- **Fix merge sha:** `6ee66044`
- **Guarding test file(s):** `tests/shaperhub-name-767.test.js`, `tests/shaperhub-name-767-live.test.js`
- **Status:** fixed
- **Family:** `sync`
- **Related:** BUG-082

### BUG-039
- **Date / turn:** 2026-11-17 (turn 2315)
- **Reported by:** owner
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (website, Design drawing tools)
- **Owner's words:** unknown (not quoted verbatim in log; advisor log summary: `OWNER BUG 2315: live size box/labels while drawing show raw mm in an inch document (317.5 x 167.6)` and `WORK-LOG.md` TURN 769: `Owner turn 2315 (Shaper, inch document): the Rectangle drew 12.5 x 6.6 in and its live labels and floating box read "317.5" / "167.6" (millimetres, no unit).`)
- **What was wrong:** Live size labels and floating creation input boxes displayed raw millimetres and parsed typed bare numbers as millimetres even in inch or cm documents.
- **Cause:** Creation live labels and floating draw boxes bypassed document unit formatting and parsing.
- **Task id(s):** `769`
- **Fix merge sha:** `f607296c`
- **Guarding test file(s):** `tests/live-units-769-node.test.js`, `tests/live-units-769-shaper-live.test.js`, `tests/live-units-769-studio-live.test.js`
- **Status:** fixed
- **Family:** `units`
- **Related:** BUG-026, BUG-029, BUG-037

### BUG-040
- **Date / turn:** 2026-11-18 (turn 2415)
- **Reported by:** owner
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (website, phone)
- **Owner's words:** unknown (not quoted verbatim in log; advisor log summary: `Owner 2415: template modal can't be closed on phone (100vh panel hides the X under the address bar)`)
- **What was wrong:** On mobile browsers, the New design / template modal's header and close `X` button were pushed above the visible viewport so the modal could not be closed.
- **Cause:** `.sk-tp-panel` at `max-width: 640px` used `height: 100vh` inside a flex-centered `inset: 0` backdrop, overflowing the dynamic mobile viewport height.
- **Task id(s):** `779`
- **Fix merge sha:** `d66e1d3a`
- **Guarding test file(s):** `tests/tp-close-779-live.test.js`
- **Status:** fixed
- **Family:** `layout-overlap`
- **Related:** BUG-020, BUG-055

### BUG-041
- **Date / turn:** 2026-11-18 (turn ~2425, during 778/780)
- **Reported by:** worker (`778`)
- **App(s) & host:** Shaper (website, Prepare)
- **Report:** `"Follow-up: Prepare depth badge sits on the pocket start mark."`
- **What was wrong:** A programmed pocket's depth chip overlapped and covered its start mark target in Prepare.
- **Cause:** `prepare-view.js` anchored the depth chip at the pocket's start point without offsetting clear of the pocket start mark in screen pixels.
- **Task id(s):** `780`
- **Fix merge sha:** `75b02b9a`
- **Guarding test file(s):** `tests/badge-780-live.test.js`, `tests/badge-780-phone-live.test.js`
- **Status:** fixed
- **Family:** `layout-overlap`
- **Related:** BUG-030

### BUG-042
- **Date / turn:** 2026-11-18 (turn 2439; hunt 784/785)
- **Reported by:** advisor / worker (`781`, `782`, `783`, `784`, `785`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (website)
- **Report:** `781` (all-tangent closed chain offset not holding distance), `782` (centre rect typed sizes, 0-size shapes, CCW line angle, centre slot full length, typed `<= 0` refused), `783` (keys in overlays acting on canvas behind, focus loss, Drawing phone landscape footer)
- **What was wrong:** Multi-tool polish/solver bugs from the round-1 bug hunt: rounded-outline offsets failed to hold distance, typed creation inputs had inconsistent dimensions/signs, and keyboard shortcuts inside menus/dialogs still triggered canvas tools behind them.
- **Cause:** Missing N-row anchor on all-tangent offset chains (`781`), per-tool typed box inconsistencies (`782`), and missing `OVERLAY_SELECTOR` guard in `shortcuts.js` (`783`).
- **Task id(s):** `781`, `782`, `783`
- **Fix merge sha:** `9c2ea930` (781), `7a217cbe` (782), `70edc73d` (783)
- **Guarding test file(s):** `tests/offset-781-node.test.js`, `tests/offset-781-live.test.js`, `tests/typed-sizes-782-node.test.js`, `tests/typed-sizes-782-live.test.js`, `tests/overlay-keys-783-live.test.js`, `tests/drawing-footer-landscape-783-live.test.js`
- **Status:** fixed
- **Family:** `ui-input`
- **Related:** BUG-027, BUG-045
- **Led to:** BUG-047 (task 791 overlay-keys-783-live timeout)

### BUG-043
- **Date / turn:** 2026-11-18 to 2026-11-19 (turns 2448, 2454; hunt 785)
- **Reported by:** worker (`785`)
- **App(s) & host:** Shaper (website, SVG export)
- **Report:** `"BUG 1 (CRITICAL, a wrong cut): a pocket whose island is of ANOTHER kind ... wound the SAME way as the outer, so under the default nonzero rule ... the island was filled"`, plus `BUG 4` (`viewBox` ignored tab strips, start mark, stepped rings, curve bulges) and `BUG 6` (start mark hoisted into Stock's guide `<g>`)
- **What was wrong:** Exported SVG pockets with mixed-kind islands filled the island under the nonzero winding rule, the `viewBox` clipped tabs/start marks/curve bulges, and the pocket start mark could be drawn behind the pocket wall.
- **Cause:** `compoundPathD` reversed inner paths blindly instead of checking actual signed area (`pathSignedArea`), `boundsOf` missed non-shape elements, and `groupByCut` hoisted start marks into Stock's `<g>`.
- **Task id(s):** `786`
- **Fix merge sha:** `203b3b57`
- **Guarding test file(s):** `tests/cam-export-786-node.test.js`, `tests/cam-export-786-live.test.js`
- **Status:** fixed
- **Family:** `export-svg`
- **Related:** BUG-022, BUG-034, BUG-035, BUG-049

### BUG-044
- **Date / turn:** 2026-11-18 to 2026-11-19 (turns 2448, 2454; hunt 785)
- **Reported by:** worker (`785`)
- **App(s) & host:** Shaper (website, CAM path generation & 3D Review)
- **Report:** Bugs 2, 3, 5, 7a, 7b, 13: inside arc lead-in ignored holes; negative cut offset narrowed tabs; 3D Review crashed on depth-unset label near start mark; tight Raster/Morphed Loop pocket emitted nothing; depth-unset programmed pocket cut through in 3D; Lead-in Radius stepper dead-ended.
- **What was wrong:** Six Shaper CAM path / 3D Review bugs spanning lead-in hole avoidance, tab offset width compensation, Review crash, tight pockets, unset-depth programmed pockets, and stepper bounds.
- **Cause:** `lead-in.js` checked only the outer loop, `hold-part.js` ignored cut offset when sizing tab strips, `relief-model.js` merged depth-unset labels with start marks and treated unset-depth pocket pieces as through-cuts, `pocket-clearing.js` skipped loop/mark when `A0` was empty, and `number-stepper.js` early-returned `positive` before decrementing.
- **Task id(s):** `787`
- **Fix merge sha:** `dd88f9e2`
- **Guarding test file(s):** `tests/cam-paths-787-node.test.js`, `tests/cam-paths-787-review-live.test.js`
- **Status:** fixed
- **Family:** `toolpath-geometry`
- **Related:** BUG-043, BUG-054, BUG-066, BUG-067

### BUG-045
- **Date / turn:** 2026-11-18 to 2026-11-19 (turns 2448, 2454; hunt 785)
- **Reported by:** worker (`785`)
- **App(s) & host:** Shaper (website, Sync modal & Prepare UI)
- **Report:** Bugs 8, 9, 10, 12: Switch account left `pendingQuestion` stuck/Send hidden; sync auto-close timer shut a re-opened dialog; `.cut-offset-pop` and legend overflowed phone viewport; open Bezier curve had no hover/select highlight or centreline.
- **What was wrong:** Four Shaper UI bugs in the ShaperHub Sync dialog state/timer lifecycle, phone popover clamping, and Prepare open-Bezier highlighting.
- **Cause:** Switch account didn't clear `pendingQuestion`, `setTimeout(closeSyncModal, 1200)` wasn't cleared on dialog close, `.cut-offset-pop` missed the phone width clamp, and `edgeStrokeMarkup` had no Bezier branch.
- **Task id(s):** `788`
- **Fix merge sha:** `f810fbb4`
- **Guarding test file(s):** `tests/sync-fixes-788-live.test.js`, `tests/prepare-phone-788-live.test.js`, `tests/prepare-bezier-788-live.test.js`
- **Status:** fixed
- **Family:** `ui-input`
- **Related:** BUG-042, BUG-057

### BUG-046
- **Date / turn:** 2026-11-18 to 2026-11-19 (turns 2448, 2454, 2465; hunt 784)
- **Reported by:** worker (`784`) and owner (turn 2465 on distance `<= 0`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (website, solver & Parameters)
- **Owner's words:** unknown (not quoted verbatim in log; turn 2465 summary: `Owner 2465: distance 0 between different shapes NOT allowed -> 789b`)
- **Report (worker 784):** Bugs 1-6: tangent circle/arc lost branch; dimensions allowed `<= 0`; coincident-joint distance had zero Jacobian row; imported DXF/SVG arcs lacked structural equal constraint; Trim dropped H/V constraints; Parameters window omitted reference dimensions' live values.
- **What was wrong:** Six solver/dimension bugs affecting tangent branch persistence, zero/negative sizes & distances, collapsed `d=0` line repair, imported arc integrity, Trim constraint retention, and reference dimension readouts.
- **Cause:** Missing `lockTangentBranch` persistence, missing `<= 0` refusal across distance/size paths (`789` + `789b`), zero distance Jacobian at `r=0`, missing `arcStructuralConstraints` on import, missing `keepLineConstraints` in Trim, and missing `measureDimension` in Parameters table.
- **Task id(s):** `789`, `789b`
- **Fix merge sha:** `ecad5736` (789), `9096e98c` (789b)
- **Guarding test file(s):** `tests/tangent-branch-789-node.test.js`, `tests/dimension-size-789-node.test.js`, `tests/dimension-collapsed-789-node.test.js`, `tests/import-arc-equal-789-node.test.js`, `tests/trim-constraints-789-node.test.js`, `tests/parameters-reference-789-live.test.js`
- **Status:** fixed
- **Family:** `solver`
- **Related:** BUG-005, BUG-059, BUG-060, BUG-076
- **History:** found in hunt 784 2026-11-18 -> 789 merged 2026-11-19 -> owner widened <=0 refusal to all distances -> 789b merged 2026-11-19

### BUG-047
- **Date / turn:** 2026-11-19 (turn ~2478)
- **Reported by:** advisor
- **App(s) & host:** Test suite (`tests/overlay-keys-783-live.test.js`)
- **Report:** `"overlay-keys-783 fixed sleeps -> waitFor; 88-90 s -> 29-34 s (was hitting gate FILE_LIMIT 90 s under load)"`
- **What was wrong:** `overlay-keys-783-live.test.js` took 88-90 s and timed out repeatedly on merge gates under load.
- **Cause:** The test used fixed `sleep` pauses instead of `waitFor` on the UI conditions it checked.
- **Task id(s):** `791`
- **Fix merge sha:** `058ef26e`
- **Guarding test file(s):** `tests/overlay-keys-783-live.test.js`
- **Status:** fixed
- **Family:** `flaky-test`
- **Related:** BUG-069, BUG-087
- **Regression of:** BUG-042 (test added in 783 timed out under load)

### BUG-048
- **Date / turn:** 2026-11-19 (turns 2500, 2512) and live check line 632
- **Reported by:** owner (`SA-12`) and advisor (`SA-12b`)
- **App(s) & host:** `shaper-addin` (Fusion add-in)
- **Owner's words:** unknown (not quoted verbatim in log; advisor log summary: `Owner 2500 (screenshots): Faces mode with top+floor+4 slanted walls -> 'Faces must be parallel'` and `Owner screenshot: lone slanted face via today's add-in = projected pocket, depth unset`)
- **What was wrong:** Selecting top, floor, and 4 slanted walls in Fusion Faces mode was refused with `'Faces must be parallel'`, a lone slanted face produced a projected pocket with depth unset, and the initial `SA-12` overlay had low-contrast colours, dense rings, and false skipped warnings (`SA-12b`).
- **Cause:** `_classify_faces_mode` in `fusion_selection.py` rejected non-parallel faces instead of separating flat reference faces from sloped walls, and `SA-12` initially used low-contrast overlay colours/ring spacing.
- **Task id(s):** `SA-12`, `SA-12b`
- **Fix merge sha:** `05b500e` (SA-12), `ee6f70f` (SA-12b, `shaper-addin`)
- **Guarding test file(s):** unknown (`shaper-addin` repo; not inspected from Sketch-Studio worktree)
- **Status:** fixed
- **Family:** `fusion-frame`
- **Related:** BUG-024, BUG-064
- **History:** reported 2026-11-19 -> fixed SA-12 2026-11-19 -> overlay colours/warnings fixed SA-12b 2026-11-19

### BUG-049
- **Date / turn:** 2026-11-19 (turn ~2560, pre-line 650)
- **Reported by:** owner (measured on Shaper Origin; root cause found by advisor)
- **App(s) & host:** Shaper (website, SVG export & Export 2D preview)
- **Owner's words:** `"unset"` (reported on Origin screen for spiral/loop paths; `WORK-LOG.md` TURN 802: `Measured (owner, Origin): a Spiral pocket 0.125 in deep, Loop off: wall 0.125 in but the 2 spiral on-line paths "unset"; Loop on: both closed loops "unset".`)
- **What was wrong:** Exported Spiral and Loop pocket paths arrived on the Shaper Origin with depth `"unset"` (wrong cut on machine).
- **Cause:** `shaper-export.js` `options.groupByCut` placed `fill`/`stroke`/`shaper:*` attributes on `<g>` wrapper elements instead of each `<path>`, whereas the Origin only reads attributes on each path element.
- **Task id(s):** `802`
- **Fix merge sha:** `b8154aff`
- **Guarding test file(s):** `tests/export-own-attrs-802-node.test.js`
- **Status:** fixed
- **Family:** `export-svg`
- **Related:** BUG-043

### BUG-050
- **Date / turn:** 2026-11-19 (turns 2631-2635)
- **Reported by:** owner
- **App(s) & host:** Shaper (website, STL import)
- **Owner's words:** `"feature is just stupid, ill just draw it"` (turn 2638; turns 2631-2635 summarized as `STL reliefs fail (rose clutter, Green Man 89s/463 regions/spikes, floral no outline)`)
- **What was wrong:** Opening complex STL carvings (rose, Green Man, floral) took ~89 s, emitted hundreds of fragmented feature pockets/regions, produced plane-slicer spikes, or lost the outline.
- **Cause:** The plane-slicer + per-feature extraction tried to classify relief triangles into 2.5D pockets and unstable slice polygons instead of slicing a continuous height-map grid.
- **Task id(s):** `807`
- **Fix merge sha:** `aa374389`
- **Guarding test file(s):** `tests/stl-relief-807-node.test.js`
- **Status:** fixed
- **Family:** `stl-relief`
- **Related:** BUG-058, BUG-063

### BUG-051
- **Date / turn:** 2026-11-19 (turn ~2680, during 811)
- **Reported by:** worker (`811`)
- **App(s) & host:** Shaper (website, Prepare / Export)
- **Report:** `"Found bug: Guide on a hole makes the plate's Outside skip that hole (profile-model.js:669-677)."`
- **What was wrong:** Assigning `Guide` to a hole inside an enclosing `Outside` (or `Inside`/`On line`) plate stopped the plate from cutting that hole.
- **Cause:** `ownedLoopIds` treated any record with a `cutType` as owning its loop, including drawn-only `Guide` cuts.
- **Task id(s):** `814`
- **Fix merge sha:** `c5d4bb10`
- **Guarding test file(s):** `tests/export-own-hole-711-node.test.js`
- **Status:** fixed
- **Family:** `toolpath-geometry`
- **Related:** BUG-022

### BUG-052
- **Date / turn:** 2026-11-19 (turn ~2695) and 2026-11-21 (turn 3214)
- **Reported by:** advisor
- **App(s) & host:** Test suite (`tests/selection-list-795-live.test.js`)
- **Report:** `"selection-list-795-live 'Undo sends nothing to Fusion' flaky (1/2 in merge rerun, 2/2 alone in nocross)"` / `"chronic flake, 16 gates"`
- **What was wrong:** `selection-list-795-live.test.js` flaked across 16 merge gates, falsely asserting that Undo triggered a hover send to Fusion.
- **Cause:** Removing a row caused another row to slide under the stationary mouse pointer, triggering a real hover event before the Undo assertion ran.
- **Task id(s):** `854`
- **Fix merge sha:** `ea7cd5d7`
- **Guarding test file(s):** `tests/selection-list-795-live.test.js`
- **Status:** fixed
- **Family:** `flaky-test`
- **Related:** BUG-011, BUG-087
- **History:** flaked across 16 gates 2026-11-19..21 -> fixed 854 2026-11-21

### BUG-053
- **Date / turn:** 2026-11-20 (turn 2767)
- **Reported by:** owner
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (website, Design)
- **Owner's words:** unknown (not quoted verbatim in log; advisor log summary: `OWNER: vertical constraint highlight lights arc -> cause geometry-labels.js:41-42 any-joint fallback`)
- **What was wrong:** Hovering or selecting a Vertical (or other) constraint glyph highlighted an adjacent arc or unrelated line sharing an endpoint instead of only the constrained shape(s).
- **Cause:** `constraintTargets` in `packages/ui/geometry-labels.js` fell back to highlighting every shape touching any joint of a joints-only constraint, and didn't resolve 4-joint constraints per pair.
- **Task id(s):** `820`
- **Fix merge sha:** `a896d867`
- **Guarding test file(s):** `tests/constraint-targets-820.test.js`, `tests/keyhole-constraint-highlight-820-live.test.js`
- **Status:** fixed
- **Family:** `ui-input`
- **Related:** BUG-009, BUG-074

### BUG-054
- **Date / turn:** 2026-11-20 (turn 2771)
- **Reported by:** owner
- **App(s) & host:** Shaper (website, Prepare Hold part / Tabs)
- **Owner's words:** `"i dont see the tabs anymore.. also would be good to allow to drag tabs"` (from `WORK-LOG.md` TURN 822)
- **What was wrong:** On a keyhole outline, selecting Tabs refused the entire hold because one candidate tab fell on a tight strip where the gap strip couldn't fit.
- **Cause:** `hold-part.js` (`351-370`) refused the whole Hold operation if any single candidate tab strip failed to fit instead of placing tabs where strips fit (checked as pre-existing behaviour since 742, not a regression).
- **Task id(s):** `822`
- **Fix merge sha:** `bd012658`
- **Guarding test file(s):** `tests/hold-part-822-node.test.js`, `tests/hold-part-822-live.test.js`
- **Status:** fixed
- **Family:** `toolpath-geometry`
- **Related:** BUG-044

### BUG-055
- **Date / turn:** 2026-11-20 (turn 2813)
- **Reported by:** owner
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (website, phone landscape)
- **Owner's words:** unknown (not quoted verbatim in log; advisor log summary: `OWNER: avatar oval slivers -> cause 35x44 button with border-radius 50% + floating bg`)
- **What was wrong:** On phones in landscape, the floating account avatar button showed dark oval slivers above and below the round avatar circle.
- **Cause:** `packages/ui/app-footer.js` painted the floating background fill and shadow onto the `35 x 44 px` `.sk-account` button (with `border-radius: 50%`) instead of onto `.sk-account-circle`.
- **Task id(s):** `826`
- **Fix merge sha:** `04b4e31f`
- **Guarding test file(s):** `tests/account-avatar-shape-826-live.test.js`
- **Status:** fixed
- **Family:** `layout-overlap`
- **Related:** BUG-006, BUG-040

### BUG-056
- **Date / turn:** 2026-11-20 (turns 2955-2965)
- **Reported by:** owner
- **App(s) & host:** Shaper (website, Design -> Prepare)
- **Owner's words:** `"NOTHING TO CUT AFTER SIMPLY SNAPPING THE SHAPE ONTO ANOTHER"`, `"this makes the toolpath out of date, but not nothing to cut, simple recalc"` (from `WORK-LOG.md` TURN 832)
- **What was wrong:** Snapping squares onto each other by a corner in Design (or editing geometry via fillet/break/split/merge/pin) made existing Prepare pocket/cut operations report `"nothing to cut"`.
- **Cause:** `#core/loop-finder.js` failed on non-planar vertex interleaving when closed shapes shared one corner (returning no loop), and stored `loop:<edgeIds>` keys were never migrated when Design edits changed edge IDs.
- **Task id(s):** `832`
- **Fix merge sha:** `52990844`
- **Guarding test file(s):** `tests/follow-design-832-node.test.js`, `tests/follow-design-832-live.test.js`
- **Status:** fixed
- **Family:** `toolpath-geometry`
- **Related:** BUG-032, BUG-061

### BUG-057
- **Date / turn:** 2026-11-20 (turn 3039)
- **Reported by:** worker (`817c`)
- **App(s) & host:** Shaper, Pen Plotter (website, phone touch tooltips)
- **Report:** `"4th = real phone bug in #ui cursor-tooltip finger placement (flips far left near right edge)"`
- **What was wrong:** Long-pressing a button near the right edge of a 390 px phone screen flipped the tooltip ~105 px to the left of the finger instead of keeping it centred above the finger.
- **Cause:** `packages/ui/cursor-tooltip.js` `placeTooltip` applied horizontal edge flipping (`flipX`) for touch finger tooltips as well as desktop cursor tooltips.
- **Task id(s):** `817c` (merged in `817`)
- **Fix merge sha:** `9781ff82`
- **Guarding test file(s):** `tests/cursor-tooltip-finger-817c-node.test.js`
- **Status:** fixed
- **Family:** `layout-overlap`
- **Related:** BUG-045

### BUG-058
- **Date / turn:** 2026-11-20 (turns 3059-3062)
- **Reported by:** advisor (from `838` showcase screenshots)
- **App(s) & host:** Shaper (website, Export 3D preview)
- **Report:** `"(2) 3D info box repeats pocket/AutoPass notes per pocket; ... (4) pocket around a through hole = island/boss -> counterbore impossible"`
- **What was wrong:** In 3D preview, a pocket/counterbore around a through Inside cut left the inner disc standing as a raised boss, and the 3D info box repeated generic pocket/AutoPass notes once per pocket.
- **Cause:** `relief-model.js` subtracted only the outer pocket depth without removing discs freed by through Inside cuts, and `review-view.js` emitted generic notes inside the per-pocket loop.
- **Task id(s):** `839`
- **Fix merge sha:** `86185f83`
- **Guarding test file(s):** `tests/relief-through-839-node.test.js`, `tests/review-notes-839-node.test.js`
- **Status:** fixed
- **Family:** `stl-relief`
- **Related:** BUG-050, BUG-063

### BUG-059
- **Date / turn:** 2026-11-20 (turn 3088)
- **Reported by:** worker (`840`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (website, solver)
- **Report:** `"840 found solver O(n^3) on patterns (gear 24 teeth 2.7 s, 60: 67 s)"`
- **What was wrong:** Solving large patterned sketches (such as a 60-tooth spur gear) took 20-67 seconds and timed out browser tests.
- **Cause:** Dense Cholesky elimination on unordered pattern unknowns + `O(rows x unknowns)` assembly + linear `findShape` scans (`844` added RCM ordering; `847-A` numbered high-degree hub nodes last and indexed pattern lookup).
- **Task id(s):** `844`, `847` (Part A)
- **Fix merge sha:** `7b3e441d` (844), `f650477d` (847-A)
- **Guarding test file(s):** `tests/solver-gear-847.test.js`, `tests/solver-pattern-order.test.js`
- **Status:** fixed
- **Family:** `solver`
- **Related:** BUG-008, BUG-046, BUG-060
- **Led to:** BUG-060 (task 847-B/C)

### BUG-060
- **Date / turn:** 2026-11-20 (turns 3099-3101) and 2026-11-21 (turn 3119)
- **Reported by:** advisor / worker (`846`)
- **App(s) & host:** SketchStudio / Shaper (core solver & Node arc fallback)
- **Report:** `"846: NOT a pattern bug: deleted fillet radius dims + big move -> solver absorbed into free fillet radii, one inverted -> self-crossing loop -> Inside cuts nothing silently."` + `"curve-kinds Node sampleArc fallback slip."`
- **What was wrong:** (a) Moving a geometry after deleting fillet radius dimensions inverted a free fillet into a self-crossing loop, causing Inside cuts to drop silently; (b) Node `sampleArc` fallback returned `[centre, end]` instead of `[start, end]`.
- **Cause:** (a) Solver allowed negative/inverted fillet radii (`847-B` held on branch due to 9 Fusion divergence cells); (b) `packages/core/curve-kinds.js` `sampleArc` fallback returned centre instead of start.
- **Task id(s):** `846`, `847` (Part C fixed; Part B parked)
- **Fix merge sha:** `1bb14dfc` (846 guard), `3b37ff24` (847-C)
- **Guarding test file(s):** `tests/pattern-arcs-846-node.test.js`, `tests/sample-arc-ends-847-node.test.js` (Part B test `tests/fillet-no-invert-847-node.test.js` unmerged)
- **Status:** parked (Part B fillet inversion unmerged pending Fusion divergence ruling; Part C fixed)
- **Family:** `solver`
- **Related:** BUG-018, BUG-046, BUG-059
- **History:** found 2026-11-20 (846) -> guard test 846 merged 2026-11-20 -> 847-C sampleArc merged 2026-11-21 -> 847-B fillet inversion parked on agents/solver-847-bc

### BUG-061
- **Date / turn:** 2026-11-20 (turn 3118)
- **Reported by:** worker (`841`)
- **App(s) & host:** Shaper (website, Export -> Recalculate)
- **Report:** `"fixed S3 bug: Recalculate from Export used stale Prepare pass"`
- **What was wrong:** Triggering Recalculate while on the Export stage used stale Prepare paths without reconciling Design edits first.
- **Cause:** Recalculate from Export skipped calling `followDesign` before deriving paths.
- **Task id(s):** `841`
- **Fix merge sha:** `db12734b`
- **Guarding test file(s):** `tests/insert-stl-841-node.test.js`, `tests/insert-stl-841-live.test.js`
- **Status:** fixed
- **Family:** `toolpath-geometry`
- **Related:** BUG-056

### BUG-062
- **Date / turn:** 2026-11-21 (turns 3171, 3175)
- **Reported by:** owner / advisor
- **App(s) & host:** SketchStudio (`sketch-studio.pages.dev` Cloudflare Pages build)
- **Owner's words:** `"the Sketch site has none of 829's tags"` (from `WORK-LOG.md` TURN 851; advisor found 19 consecutive Cloudflare build failures since task 829)
- **What was wrong:** The live `sketch-studio.pages.dev` site stayed stale without 829's icons and SEO meta tags because every production build failed.
- **Cause:** Task 829 added `@resvg/resvg-js` to `package.json` `devDependencies` without updating `package-lock.json`, causing Cloudflare's `npm ci` to fail (also Node version unpinned).
- **Task id(s):** `851`
- **Fix merge sha:** `27162c26`
- **Guarding test file(s):** `tests/site-identity-829.test.js`, `tests/og-card-837.test.js`
- **Status:** fixed
- **Family:** `build-deploy`
- **Related:** none

### BUG-063
- **Date / turn:** 2026-11-21 (turns 3191, 3203)
- **Reported by:** owner
- **App(s) & host:** Shaper (website, Export 3D preview)
- **Owner's words:** `"cant be right"` (turn 3191 on stepped bowl 3D preview; turn 3203 summary: `OWNER: bowl preview must look like a 3/16 bowl -> 852b: verify radius geometry (bug?)`)
- **What was wrong:** A pocket cut with a `3/16 in` corner-radius bowl bit rendered in 3D with a wide vertical wall and tall `0.5-1.4 mm` steps instead of a smooth rounded corner.
- **Cause:** `packages/core/cutter-profile.js` `cutterTerraces` sampled uniformly in `x` (6 slices), putting the widest terrace at depth `5.141 mm` instead of `3.24 mm` and turning the steepest quarter-circle section into a vertical wall.
- **Task id(s):** `852b`, `852c`
- **Fix merge sha:** `1a28cec9`
- **Guarding test file(s):** `tests/my-bits-852-node.test.js`, `tests/relief-model.test.js`
- **Status:** fixed
- **Family:** `stl-relief`
- **Related:** BUG-050, BUG-058
- **History:** reported 2026-11-21 -> initial smooth attempt reverted 2026-11-21 -> re-applied with budget + smoothStairs 852b/c 2026-11-21

### BUG-064
- **Date / turn:** 2026-11-21 (turn 3218)
- **Reported by:** advisor
- **App(s) & host:** `shaper-addin` (Fusion add-in)
- **Report:** `"Pre-existing bugs: flat+vertical cyl wall = '4 sloped faces' + slope warnings; flat+vertical planar walls = 'Faces must be parallel' refusal."`
- **What was wrong:** Selecting flat top faces plus vertical cylindrical or planar walls in Fusion Faces mode misclassified cylindrical walls as `"4 sloped faces"` and refused vertical planar walls with `'Faces must be parallel'`.
- **Cause:** `fusion_selection.py` `_classify_faces_mode` failed to filter vertical walls (normal perpendicular to reference normal) out of sloped/parallel checks.
- **Task id(s):** `SA-18`
- **Fix merge sha:** `bd8854c` (`shaper-addin`)
- **Guarding test file(s):** unknown (`shaper-addin` repo; not inspected from Sketch-Studio worktree)
- **Status:** fixed
- **Family:** `fusion-frame`
- **Related:** BUG-024, BUG-048

### BUG-065
- **Date / turn:** 2026-11-21 (turns 3221, 3230, 3234)
- **Reported by:** advisor
- **App(s) & host:** Shaper (Fusion panel)
- **Report:** `"palette restores saved work per origin: a 'top face' chip from an earlier closed Fusion doc reappeared"` / `"855 FAIL live: switch to new empty design B kept A's workspace (ops emptied) and WROTE A's project into B"` / `"Race found: a select_for_operation dialog that opens after a switch resolves tokens in the wrong design"`
- **What was wrong:** Work from one Fusion document leaked into other Fusion documents via browser storage, switching to a new empty design wrote the old design's project into it, and stale notices / wrong-design `select_for_operation` dialogs could fire across design switches.
- **Cause:** Fusion mode wrote to browser `openTabsBuffer` instead of an isolated per-design in-memory store backed by `shaper-addin/project` attributes, lacked `docToken` guards on `select_for_operation`/`save_project`, and didn't clear `#prepare-notice` on design switch.
- **Task id(s):** `855`, `855b`, `855c`, `855d` (+ `SA-19`, `SA-20` in `shaper-addin`)
- **Fix merge sha:** `daa9d117` (855/855b/855c), `65359bec` (855d) (`shaper-addin`: `a57d9eb` SA-20)
- **Guarding test file(s):** `tests/perdesign-855-node.test.js`, `tests/perdesign-855-live.test.js`
- **Status:** fixed
- **Family:** `sync`
- **Related:** BUG-013, BUG-081, BUG-082
- **History:** chip leak found in 795c 2026-11-21 -> 855 live failed switch to empty design B 2026-11-21 -> fixed 855b/855c/855d + SA-20 2026-11-21

### BUG-066
- **Date / turn:** 2026-11-21 (turn 3233)
- **Reported by:** worker (`852d`)
- **App(s) & host:** Shaper (website, `packages/core/pocket-clearing.js`)
- **Report:** `"MEASURED: morphedSpiral 70 rings = 16-31 s / ~3 GB heap, >=100 rings hang/OOM, SAME for 1/16 end mill (pre-existing core bug)"`
- **What was wrong:** Morphed spiral pocket clearing with fine tools (`1/16 in` end mill or `0.02 in` V-bit tip) took 16-31 s at 70 rings and hung or OOM'd at 100+ rings.
- **Cause:** `propagate` appended every outer ring sample onto every inner ring and stacked zero-length corner segments (`O(K^3..4)` sample growth).
- **Task id(s):** `856`
- **Fix merge sha:** `98b7819e`
- **Guarding test file(s):** `tests/pocket-morphed-perf-856-node.test.js`
- **Status:** fixed
- **Family:** `toolpath-geometry`
- **Related:** BUG-044

### BUG-067
- **Date / turn:** 2026-11-22 (turn 3286)
- **Reported by:** advisor
- **App(s) & host:** Shaper (website, Prepare)
- **Report:** `"857 RED: pocket-clearing-745-live (+phone) REAL on main+857 alone ... (857 replaced the open op's selected band / finish ring with the cut band)"`
- **What was wrong:** Task `857`'s initial Prepare cut band replaced an open operation's selected `.sk-band` footprint and finish ring.
- **Cause:** `857` modified Prepare's existing `.sk-band` styling; resolved in `857c` by keeping Prepare identical to `main` and showing the cut band / sim trail in Export Paths and 2D sim only.
- **Task id(s):** `857`
- **Fix merge sha:** `2b0b0994`
- **Guarding test file(s):** `tests/cut-band-857-node.test.js`, `tests/cut-band-857-live.test.js`
- **Status:** fixed
- **Family:** `toolpath-geometry`
- **Related:** BUG-044

### BUG-068
- **Date / turn:** 2026-11-22 (turn 3314)
- **Reported by:** advisor
- **App(s) & host:** Test harness (`tests/helpers/cdp-teardown.js`)
- **Report:** `"859 merge RED 25 unrelated (tests print ok then hang in cdp-browser teardown: taskkill failed + rmSync EPERM + linear-backoff retries ~65 s -> 90 s TIMEOUT)"`
- **What was wrong:** Live tests finished and printed `ok`, then hung in `cdp-browser` teardown for ~65 s until hitting the 90 s gate timeout.
- **Cause:** `taskkill` race (`not found`), leaked timers, and a 65 s linear-backoff `rmSync` retry loop in teardown.
- **Task id(s):** `860`
- **Fix merge sha:** `73db5ce3`
- **Guarding test file(s):** `tests/cdp-teardown-860.test.js`
- **Status:** fixed
- **Family:** `flaky-test`
- **Related:** BUG-004, BUG-069, BUG-087

### BUG-069
- **Date / turn:** 2026-11-23 (turn 3326)
- **Reported by:** advisor
- **App(s) & host:** Test suite (`tests/export-sim-801-perf-live.test.js`)
- **Report:** `"export-sim-801-perf-live fails in all 4: alone it takes 102 s > FILE_LIMIT 90 s (structural)."`
- **What was wrong:** `export-sim-801-perf-live.test.js` exceeded the gate's 90 s per-file limit even when run alone (102 s), failing four queued merges.
- **Cause:** Three heavy simulation benchmarks (wave 3D, wave passes, raster) were packed into a single test file.
- **Task id(s):** `861`
- **Fix merge sha:** `397f8070`
- **Guarding test file(s):** `tests/export-sim-801-perf-wave-3d-live.test.js`, `tests/export-sim-801-perf-wave-passes-live.test.js`, `tests/export-sim-801-perf-raster-live.test.js`
- **Status:** fixed
- **Family:** `flaky-test`
- **Related:** BUG-047, BUG-068, BUG-087

### BUG-070
- **Date / turn:** 2026-11-20 (turn 2455-6) and 2026-11-23 (turn 3336)
- **Reported by:** advisor
- **App(s) & host:** Shaper (Fusion panel & website, Prepare)
- **Report:** `"Seen: Prepare notice's first letters hidden under the Operations panel"` (turn 2455-6) / `"Prepare-notice bug"` (turn 3336, task `900`)
- **What was wrong:** The centred `#prepare-notice` banner sat underneath the `#prepare-ops` Operations card (`z-index: 7`), clipping its left characters in Fusion mode and at 860 px desktop width.
- **Cause:** `#prepare-notice` used centred positioning spanning into `#prepare-ops`'s `12..300 px` column instead of starting to its right and wrapping before the cut card column.
- **Task id(s):** `900`
- **Fix merge sha:** `5f76bbc6`
- **Guarding test file(s):** `tests/prepare-notice-900-live.test.js`
- **Status:** fixed
- **Family:** `layout-overlap`
- **Related:** BUG-078, BUG-083

### BUG-071
- **Date / turn:** 2026-11-23 (turns 3336, 3343)
- **Reported by:** advisor
- **App(s) & host:** `shaper-addin` (Fusion add-in)
- **Report:** `"SA-23 partial chamfer ... cause found (_loop_points_mm fixed 2deg arc step; r 1524 mm -> 0.051-0.080 mm > BBOX_TOL 0.05)"`
- **What was wrong:** Large-radius arcs (such as `bromont` at `r = 1524 mm`) produced partial chamfer/sloped wall matching errors in `shaper-addin`.
- **Cause:** `_loop_points_mm` sampled arcs with a fixed 2-degree angle step, producing chord sagitta error (`0.051-0.080 mm`) exceeding `BBOX_TOL` (`0.05 mm`).
- **Task id(s):** `SA-23`
- **Fix merge sha:** `05751ba` (`shaper-addin`)
- **Guarding test file(s):** unknown (`shaper-addin` repo; not inspected from Sketch-Studio worktree)
- **Status:** fixed
- **Family:** `fusion-frame`
- **Related:** BUG-024, BUG-080

### BUG-072
- **Date / turn:** 2026-11-23 (turn 3349)
- **Reported by:** owner
- **App(s) & host:** Shaper (Fusion panel)
- **Owner's words:** unknown (not quoted verbatim in log; advisor log summary: `OWNER bug: Fusion add-in stock set from geometry doesn't persist after changing another toolpath`)
- **What was wrong:** Setting a Stock operation from Fusion geometry lost the Stock's geometry (`[]`) as soon as another operation was updated via `Select in Fusion -> Update`.
- **Cause:** `apps/shaper/src/fusion-bridge.js` `buildSelectForOperationPayload` skipped `other.type === STOCK_TYPE_ID` when collecting `keepTokens`, causing the add-in to drop Stock's region from `selection_data`.
- **Task id(s):** `864` (queued initially as Yoga task 901)
- **Fix merge sha:** `57a6bce4`
- **Guarding test file(s):** `tests/stockkeep-864-live.test.js`
- **Status:** fixed
- **Family:** `stock`
- **Related:** BUG-080, BUG-088

### BUG-073
- **Date / turn:** 2026-11-23 (turn 3379; `.evidence/1002/owner-report-3380.txt` Finding 1)
- **Reported by:** owner
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (website, Design)
- **Owner's words:** unknown (not quoted verbatim in log; advisor log summary: `OWNER: rectangle doesn't start snapped on lines` and `.evidence/1002/owner-report-3380.txt` Finding 1: `[rect-tool] pointerDown` hitSnap on `_482`, `NO applySnapConstraint / pointOnLine for the FIRST corner (j890 / j892) on _482`; plus 8 `"Duplicate coincident constraint rejected"` logs)
- **What was wrong:** Drawing a 2-point rectangle with its first corner snapped to a line placed the corner on the line but never added a `pointOnLine` snap constraint, so only the opposite corner was constrained. (Also, `makeRectFromTwoJoints` + corner loop emitted 8 duplicate coincident rejections; reported separately in `867`/`869`.)
- **Cause:** `rect-tool.js` stored `state.active.startSnapTarget` on pointer down, but `handleRectPointerUp` and `finalizeRectFromActive` never called `applySnapConstraint` for the first corner (or 3-pt second click); fixed via shared `applyLockedSnap` in `base-tool.js` (with `870` fixing circle rim / polygon vertex / 3-pt slot arc point).
- **Task id(s):** `867` (and `870` for audit causes C/D/E)
- **Fix merge sha:** `e490f6f4`
- **Guarding test file(s):** `tests/rect-snap-constraint-867-node.test.js`, `tests/rect-snap-constraint-867-live.test.js`
- **Status:** fixed
- **Family:** `snap-not-applied`
- **Related:** BUG-010, BUG-074, BUG-075
- **Led to:** Audit 869 (docs/SNAP-CONSTRAINT-AUDIT-869.md) -> task 870 (circle/polygon/slot)

### BUG-074
- **Date / turn:** 2026-11-23 (turn 3380; `.evidence/1002/owner-report-3380.txt` Finding 2)
- **Reported by:** owner
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (website, Design)
- **Owner's words:** unknown (not quoted verbatim in log; advisor log summary: `OWNER report: coincident tool adds nothing (corner + offset line)` and `.evidence/1002/owner-report-3380.txt` Finding 2: `Coincident with a point then a line` -> `"Setting tool to: select" <- the tool ends on the second pick WITHOUT adding a constraint (no "[ConstraintManager] Added ..." line, no error logged; lastError null)`)
- **What was wrong:** Using the Coincident tool on a point (rectangle corner) then an offset line returned silently to Select without creating a `pointOnLine` constraint or showing an error.
- **Cause:** `packages/ui/input-handlers/constraint-tools.js` `handleCoincidentPointerDown` only handled joint+joint and joint+built-in axis, falling through silently on real lines/curves (`input-manager.js` "EXIT ON INVALID CLICK").
- **Task id(s):** `868` (plus `871` for H/V clicked line + refusal notices, and `874` for `'Sketch geometry over constrained'` notice)
- **Fix merge sha:** `2dbfaa8f` (868), `347df75c` (871), `74b1c833` (874)
- **Guarding test file(s):** `tests/coincident-868-node.test.js`, `tests/coincident-868-live.test.js`, `tests/constraint-refusals-871-node.test.js`, `tests/over-constrained-874-node.test.js`
- **Status:** fixed
- **Family:** `tool-bypasses-constraint-manager`
- **Related:** BUG-073, BUG-075, BUG-076, BUG-090
- **Led to:** Audit 869 -> tasks 871 (H/V + notices), 874 (overconstrained notice)
- **History:** reported 2026-11-23 -> Coincident fixed 868 2026-11-23 -> H/V + notices 871 2026-11-23 -> Fusion-style overconstrained notice 874 2026-11-23

### BUG-075
- **Date / turn:** 2026-11-23 (turn 3393; also audit 869 cause J)
- **Reported by:** owner
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (website, Design)
- **Owner's words:** unknown (not quoted verbatim in log; advisor log summary: `OWNER: never decided Bezier snaps only to its first anchor (762 seat's own choice) -> Bezier anchors must snap + attach like Fusion's spline / the Line tool.`)
- **What was wrong:** The Bezier pen hid and ignored all snaps except its own first anchor, placing anchors at raw unattached world coordinates.
- **Cause:** `bezier-tool.js` explicitly suppressed snaps except closing on anchor 0 (task 762 worker choice) and wasn't in `isDrawingTool` hover snapping.
- **Task id(s):** `872`
- **Fix merge sha:** `3db753ce`
- **Guarding test file(s):** `tests/bezier-snap-872-node.test.js`, `tests/bezier-snap-872-live.test.js`
- **Status:** fixed
- **Family:** `snap-not-applied`
- **Related:** BUG-010, BUG-073

### BUG-076
- **Date / turn:** 2026-11-23 (turn 3397)
- **Reported by:** worker (`871`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (website, solver & Design)
- **Report:** `"H midpoint-on-arc: solver has no arc midpoint -> now a notice; OWNER Q: solver task for arc midpoint?"`
- **What was wrong:** Midpoint constraint could not constrain a point to an arc's midpoint (solver lacked arc-midpoint support; fixed in `875` after Fusion API verified `addMidPoint(point, arc)`).
- **Cause:** `packages/core/solver/definitions.js` had no midpoint row for arcs, and `constraint-tools.js` only accepted lines for Midpoint.
- **Task id(s):** `871` (notice), `875` (solver + tool)
- **Fix merge sha:** `347df75c` (871), `500c3214` (875)
- **Guarding test file(s):** `tests/midpoint-arc-875-node.test.js`, `tests/midpoint-arc-875-live.test.js`
- **Status:** fixed
- **Family:** `solver`
- **Related:** BUG-046, BUG-074
- **History:** noticed in 871 2026-11-23 (notice added) -> solver + tool fixed in 875 2026-11-24

### BUG-077
- **Date / turn:** 2026-11-23 (turn 3448)
- **Reported by:** advisor
- **App(s) & host:** `shaper-addin` (Fusion add-in)
- **Report:** `"SA-28 live: dialog CRASH (adsk.__file__ None, namespace pkg) -> sent back to SA-28 agent."`
- **What was wrong:** Opening the `Add to Shaper` dialog crashed immediately on `SA-28` when resolving Fusion's icon directory.
- **Cause:** `adsk` is a Python namespace package whose `adsk.__file__` is `None`.
- **Task id(s):** `SA-28`
- **Fix merge sha:** `482354a` (`shaper-addin`)
- **Guarding test file(s):** unknown (`shaper-addin` repo; not inspected from Sketch-Studio worktree)
- **Status:** fixed
- **Family:** `fusion-frame`
- **Related:** BUG-078

### BUG-078
- **Date / turn:** 2026-11-23 (turn 3452)
- **Reported by:** owner
- **App(s) & host:** `shaper-addin` (Fusion add-in, `Add to Shaper` dialog)
- **Owner's words:** unknown (not quoted verbatim in log; advisor log summary: `OWNER: row icon not aligned with text (icon top, text lower) -> added to SA-29.`)
- **What was wrong:** In the Fusion dialog's Selections table, each row's icon sat higher than its text label with an uneven gap.
- **Cause:** `shaper-addin.py` used a tall multi-line layout/icon column sizing that didn't align button icons with single-line text.
- **Task id(s):** `SA-29`
- **Fix merge sha:** `82cc23d` (`shaper-addin`)
- **Guarding test file(s):** unknown (`shaper-addin` repo; not inspected from Sketch-Studio worktree)
- **Status:** fixed
- **Family:** `layout-overlap`
- **Related:** BUG-070, BUG-077

### BUG-079
- **Date / turn:** 2026-11-24 (turn 3472)
- **Reported by:** owner
- **App(s) & host:** `shaper-addin` (Fusion add-in) + Shaper (Fusion panel)
- **Owner's words:** `"stupid"` (turn 3472 on the sloped-walls warning; `advisor-log.txt` also notes `'1 regions'` plural nit on turn 1902)
- **What was wrong:** Importing a Fusion body emitted a noisy sloped-walls warning (`"stupid"`), and the Shaper panel selection notice printed ungrammatical counts such as `"1 regions"` and `"0 chains"`.
- **Cause:** `fusion_selection.py` emitted an informational warning on normal sloped faces, and `fusion-bridge.js` / `fusion-import.js` formatted notices with hardcoded plural strings and zero counts instead of one `selectionCountText` builder.
- **Task id(s):** `SA-30` (`shaper-addin`), `877` (Sketch-Studio)
- **Fix merge sha:** `b903bc4` (SA-30, `shaper-addin`), `0ab16e4f` (877)
- **Guarding test file(s):** `tests/selection-notice-877-node.test.js`
- **Status:** fixed
- **Family:** `notice-wording`
- **Related:** BUG-090

### BUG-080
- **Date / turn:** 2026-11-24 (turn 3478)
- **Reported by:** owner
- **App(s) & host:** Shaper (website & Fusion panel, Export 3D board / Simulate / SVG page)
- **Owner's words:** `"a hardcoded stock dim i dont know where it comes from"` (from `WORK-LOG.md` TURN 879; advisor log summary: `OWNER: Export board huge/strange`)
- **What was wrong:** For `bromont` (whose large-radius arcs are centred at `(0, 0)` far from the part), the Export 3D board and SVG page stretched into a huge `171 x 1556 mm` strip.
- **Cause:** `apps/shaper/src/main.js` `reviewInputs` and `packages/core/shaper-export.js` `boundsOf` computed bounds over every joint in `st.joints` (including `j_origin` and arc centre joints at `(0, 0)`) instead of only the drawn shapes' geometric extent.
- **Task id(s):** `879`
- **Fix merge sha:** `8d5cef0e`
- **Guarding test file(s):** `tests/board-extent-879-node.test.js`, `tests/board-extent-879-live.test.js`
- **Status:** fixed
- **Family:** `stock`
- **Related:** BUG-071, BUG-072, BUG-088

### BUG-081
- **Date / turn:** 2026-11-24 (turn 3599)
- **Reported by:** advisor
- **App(s) & host:** `shaper-addin` (Fusion add-in ShaperHub upload relay)
- **Report:** `"Live relay probe {action:probe-sa34}: 403 Cloudflare 1010 (Python-urllib UA banned)."`
- **What was wrong:** Relaying `POST /api/shaper-upload` from the offline add-in server to `shaper-svg.pages.dev` failed with `403` (Cloudflare error `1010`).
- **Cause:** `palette_server.py` used Python's default `Python-urllib` `User-Agent` header, which Cloudflare blocks (`1010`), instead of `shaper-addin/<manifest version>`.
- **Task id(s):** `SA-34`
- **Fix merge sha:** `b32f277` (`shaper-addin`)
- **Guarding test file(s):** unknown (`shaper-addin` repo; not inspected from Sketch-Studio worktree)
- **Status:** fixed
- **Family:** `sync`
- **Related:** BUG-038, BUG-065

### BUG-082
- **Date / turn:** 2026-11-24 (turn 3608; WORK-LOG 884)
- **Reported by:** advisor (with owner ruling turn 3608)
- **App(s) & host:** Shaper (website & Fusion panel, Autosend to ShaperHub)
- **Report:** `"advisor heads-up (targets per ticked set)"` / `"replaces the last-sent file on each Generate"` (pre-dispatch spec bug: unchecked partial export would overwrite the full file on ShaperHub)
- **What was wrong:** Under the initial single-target 884 spec, generating a partial export (only some operations ticked) would overwrite the full-design file on ShaperHub.
- **Cause:** Storing one ShaperHub target per design instead of keying `hubTargets` by `tickedSetKey` (and `chunkSetKey` in `888`) and naming partial files after the ticked operations.
- **Task id(s):** `884`, `888` (adds chunkSetKey for split files)
- **Fix merge sha:** `d14b4778` (884), `a1745be1` (888)
- **Guarding test file(s):** `tests/shaperhub-keep-884-node.test.js`, `tests/shaperhub-keep-884-live.test.js`, `tests/shaperhub-keep-884-fusion-live.test.js`
- **Status:** fixed
- **Family:** `sync`
- **Related:** BUG-038, BUG-065
- **Led to:** task 888 chunkSetKey

### BUG-083
- **Date / turn:** 2026-11-24 (turn 3624)
- **Reported by:** advisor
- **App(s) & host:** Shaper (website, Prepare / Roughing card)
- **Report:** `"Findings: Prepare draws paths only for the open op (Contour sparse dashes vs 218 passes); Roughing card Layout row clipped ('erraceNested'); relief Paths view dense dark streak at left edge"`
- **What was wrong:** In Prepare, Contour operations showed only sparse thinned dashes instead of all 218 passes, and the Roughing card's `Layout` (`Terraces` | `Nested`) row was clipped into `'erraceNested'` on desktop. (The Paths dark streak was verified to be real geometry cuts on a steep cliff.)
- **Cause:** `prepare-view.js` `computeLook` drew stepped passes only as thinned travel marks (dropping rings within 16 px via `thinTravel`), and `data-row="roughLayout"` in `apps/shaper/index.html` fell onto the 4-column bit-preset grid instead of a 2-column choice row.
- **Task id(s):** `889`
- **Fix merge sha:** `76f30a8b`
- **Guarding test file(s):** `tests/relief-view-889-node.test.js`, `tests/relief-view-889-live.test.js`
- **Status:** fixed
- **Family:** `layout-overlap`
- **Related:** BUG-070

### BUG-084
- **Date / turn:** 2026-11-25 (turn 3656)
- **Reported by:** advisor
- **App(s) & host:** `shaper-addin` (Fusion add-in)
- **Report:** `"LIVE: deployed 6ba70c2, restarted add-in; extract on test freeform mesh Body1 RAISED: planeIntersection InternalValidationError when the plane misses the body (measured: max+0.5/min-0.5 raise; inside/at extremes ok)."`
- **What was wrong:** Extracting a curved-top relief body in Fusion crashed with `RuntimeError: 2 : InternalValidationError : result` when the sectioning search probed above or below the body.
- **Cause:** Fusion's `TemporaryBRepManager.planeIntersection` raises `InternalValidationError : result` (rather than returning `None`) when a plane misses a whole body, and `_brep_section.edges_at` did not catch that miss signal.
- **Task id(s):** `SA-35` (for `_brep_section.edges_at`; see BUG-089 for `_face_slicer`)
- **Fix merge sha:** `9bed1ca` (`shaper-addin`)
- **Guarding test file(s):** `tests/test_sa35_relief_orientation.py` (`shaper-addin` repo)
- **Status:** fixed
- **Family:** `fusion-frame`
- **Related:** BUG-085, BUG-086, BUG-089
- **Led to:** BUG-089 (task SA-38 _face_slicer shared miss helper)

### BUG-085
- **Date / turn:** 2026-11-25 (turn 3657)
- **Reported by:** advisor
- **App(s) & host:** `shaper-addin` (Fusion add-in viewport overlay)
- **Report:** `"FINDING: Fusion overlay of Contour = 195 stacked 20% volume walls -> solid opaque mint, paths unreadable (SA-33 stacking saturates for many-level ops)."`
- **What was wrong:** On a 195-level Contour operation, SA-33's per-segment translucent volume walls stacked into a solid opaque mint block that hid the toolpaths.
- **Cause:** Additive/alpha stacking of 195 per-level 20% opacity `CustomGraphics` walls saturates visually.
- **Task id(s):** unknown
- **Fix merge sha:** unmerged
- **Guarding test file(s):** unknown
- **Status:** open
- **Family:** `fusion-frame`
- **Related:** BUG-084, BUG-086

### BUG-086
- **Date / turn:** 2026-11-25 (turns 3667, 3671)
- **Reported by:** advisor (during owner live session turns 3666-3669)
- **App(s) & host:** `shaper-addin` (Fusion add-in) + Shaper (Fusion panel)
- **Report:** `"BUG: 2-body payload -> the relief's overlay lands BESIDE the part (offset), the box outline is on the box."`
- **What was wrong:** When selecting a sculpted relief body and a flat box together in one Single Solid Body selection, the relief's toolpaths in Fusion rendered ~36 mm too low / beside the relief body.
- **Cause:** Each body was extracted in its own frame (`depth 0` = that body's top), but the merged payload carried only one inferred frame (the box's top) instead of keeping each region's frame.
- **Task id(s):** `SA-36` (`shaper-addin`), `891` (Sketch-Studio)
- **Fix merge sha:** `542eab6f` (891; `shaper-addin` SA-36 merged prior to `a176a28`)
- **Guarding test file(s):** `tests/fusion-multibody-891-node.test.js`
- **Status:** fixed
- **Family:** `fusion-frame`
- **Related:** BUG-084, BUG-085, BUG-089
- **Led to:** BUG-089 (task SA-38 top_point per body)

### BUG-087
- **Date / turn:** 2026-11-25 (turns 3677-3706)
- **Reported by:** advisor
- **App(s) & host:** Test suite + `scripts/gate.cjs`
- **Report:** `"892 DONE ... (corpus split same checks 4768/11826; stepper mock timers; gate-shared-lock orphan sleep kill)"`, `"893 DONE ... (settledCentre helper, sidebar-drive checkFinished, fonts wait, gate retry-once...)"`, `"opselect-806 phone goStage wait"`, `"wall-time test not marked exclusive"`, `"drive-rename-live flaked 3x now"`
- **What was wrong:** Multiple live and quick tests flaked or hit the 90 s gate timeout under parallel load due to sliding animations during clicks, unwaited Drive checks/fonts/labels, orphaned sleep processes, missing `gate: exclusive` markers on wall-time tests, and `0xC0000142` helper spawn failures.
- **Cause:** Tests clicked mid-animation or asserted before async Drive/font/label state settled, slow corpus/stepper tests exceeded budgets under load, and wall-time tests ran concurrently in the shared gate.
- **Task id(s):** `892`, `893`, `895`, `896`, `899`
- **Fix merge sha:** `1b5b429e` (892), `1759a39d` (893), `26f3bde4` (895), `ac337ba6` (896), `dddd689d` (899)
- **Guarding test file(s):** `tests/gate-shared-lock.test.js`, `tests/number-stepper-730-node.test.js`, `tests/gate-start-retry-893.test.js`, `tests/stockkeep-864-live.test.js`, `tests/selection-mirror-795c-live.test.js`, `tests/drive-rename-live.test.js`
- **Status:** fixed
- **Family:** `flaky-test`
- **Related:** BUG-004, BUG-011, BUG-047, BUG-052, BUG-068, BUG-069
- **Regression of:** BUG-001 (drive-rename-live flaked 3x before 899), BUG-011 (first-click-771 flaked before 893)

### BUG-088
- **Date / turn:** 2026-11-25 (turns 3709, 3712, 3727)
- **Reported by:** advisor (merge gate `898` RED)
- **App(s) & host:** Shaper (website & Fusion panel, Operations list & Stock)
- **Report:** `"898 merge RED: REAL on branch: selection-mirror-795c undo stock 19.05!==12; split-files-888 Fusion name now 'Contour 3' (Stock row is op 1)."`
- **What was wrong:** Adding the default Stock row at the top of Fusion setups counted Stock as operation #1, shifting exported cut operation names (`Contour 2` -> `Contour 3`).
- **Cause:** `op-list` / `listNumbers` included the Stock row when numbering operations (owner ruled turn 3712: Stock row at top, unnumbered; cuts numbered without it).
- **Task id(s):** `898`
- **Fix merge sha:** open (`fde8bfe0` on branch, merging)
- **Guarding test file(s):** `tests/split-files-888-live.test.js` (inferred from log; exact 898 test file unmerged at `dddd689d`)
- **Status:** open
- **Family:** `stock`
- **Related:** BUG-072, BUG-080
- **History:** found in 898 merge gate 2026-11-25 -> unnumbered Stock fix fde8bfe0 merging 2026-11-25

### BUG-089
- **Date / turn:** 2026-11-25 (turn 3720; reported in SA-35/SA-36)
- **Reported by:** advisor / worker (`SA-36`)
- **App(s) & host:** `shaper-addin` (Fusion add-in, `fusion_selection.py`)
- **Report:** `"extract_selection ... passes the FIRST picked face's click point to EVERY face-picked body ... _face_slicer ... treats a None result of planeIntersection as a miss; the advisor measured live (2026-11-24) that Fusion RAISES RuntimeError: 2 : InternalValidationError : result"`
- **What was wrong:** In a multi-body selection without an Orientation Z pick, a second body with a curved top face read its Z normal from the first body's click point; and `_face_slicer` crashed if `planeIntersection` raised `InternalValidationError` on a miss instead of returning `None`.
- **Cause:** `extract_selection` / `extract_active_selection` carried only a single `top_point`, and `_face_slicer` did not share `_brep_section`'s `InternalValidationError` miss handler.
- **Task id(s):** `SA-38`
- **Fix merge sha:** open (`95993ff` on `shaper-addin` branch `sa-38-top-point-per-body`, awaiting merge)
- **Guarding test file(s):** `tests/test_sa38_top_point_per_body.py` (`shaper-addin` repo)
- **Status:** open
- **Family:** `fusion-frame`
- **Related:** BUG-084, BUG-086
- **Regression of:** BUG-084 (same planeIntersection miss signal missed in _face_slicer)
- **History:** found in SA-35/SA-36 2026-11-25 -> fixed on sa-38-top-point-per-body (95993ff) 2026-11-25, awaiting live check

### BUG-090
- **Date / turn:** 2026-11-25 (turn 3721; pre-reported in turn 3504)
- **Reported by:** advisor
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (website, notices)
- **Report:** `"1001 notices cleanup (SketchStudio 'Export started' + silent catches; raw 'Reason/Args/[ERR-..]' notices in dimension-tool:465, live-dimension-input:300, input-manager:1376)."`
- **What was wrong:** Dimension/input failures displayed raw developer diagnostics (`Reason:`, `Args: {...}`, `[ERR-..]`) to users, and SketchStudio emitted an unnecessary `'Export started'` toast and silent catches.
- **Cause:** `dimension-tool.js:465`, `live-dimension-input.js:300`, and `input-manager.js:1376` serialized internal diagnostic payloads into user-facing error notices.
- **Task id(s):** `1001`
- **Fix merge sha:** open
- **Guarding test file(s):** unknown (in progress)
- **Status:** open
- **Family:** `notice-wording`
- **Related:** BUG-074, BUG-079
- **History:** noticed turn 3504 (2026-11-24) -> task 1001 dispatched 2026-11-25

### BUG-091
- **Date / turn:** 2026-11-26 (audit ID `UX-04`; fixed in task `1007`)
- **Reported by:** audit `1000` (`solver-ux-audit-1000-constraints-status-undo.mjs` `M1.5`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `UX-04`: breaking a horizontal, dimensioned line left constraints behind on `[a, b]` so dragging the break point bent it into a V.
- **What was wrong:** `breakShape` split `[a, b]` into `[a, M]` + `[M, b]` without updating `state.constraints`, leaving `horizontal(a, b)` on `[a, b]` and leaving the two pieces unconstrained relative to each other.
- **Cause:** `packages/core/break.js` (`breakShape`, lines 24-58 orig) ignored `state.constraints`.
- **Task id(s):** `1007`
- **Fix merge sha:** open (`agents/trimbreak-1007`, awaiting merge)
- **Guarding test file(s):** `tests/break-constraints-ux04-node.test.js`
- **Status:** fixed
- **Family:** `solver`
- **Related:** BUG-046
- **History:** found in `SOLVER-UX-AUDIT-1000` (`UX-04`) -> fixed in task `1007` (shared `transferOrientationConstraints`, `collinear` between `[shape.id, newShapeId]`, retargeted `pointOnLine` past `t`, kept whole-line distance on `[a, b]`)

### BUG-092
- **Date / turn:** 2026-11-26 (audit ID `UX-11`; fixed in task `1007`)
- **Reported by:** audit `1000` (`solver-ux-audit-1000-constraints-status-undo.mjs` `M1.6`, `M1.7`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `UX-11`: after Trim the cut end is not held to the cutting line, and a dimension across the removed span survives when shared corners keep the old endpoints alive.
- **What was wrong:** Trimming a line against a crossing or T-junction cutter left the newly created endpoint unconstrained (`dragging cutter` detached from the cut end), and trimming a shared-corner rectangle edge left the old edge width dimension (`d1=[a,b]`) alive across the removed span.
- **Cause:** `packages/core/trim.js` (`trimShape`, `keepLineConstraints`) did not track cutter IDs at intersection parameters to call `applySnapConstraint(state, mId, onShapeSnap(cutterId, pt))`, and `keepLineConstraints` only ran `removeGeometry` when endpoints became unused (`gone.length`).
- **Task id(s):** `1007`
- **Fix merge sha:** open (`agents/trimbreak-1007`, awaiting merge)
- **Guarding test file(s):** `tests/trim-constraints-ux11-node.test.js`, `tests/trim-constraints-789-node.test.js`
- **Status:** fixed
- **Family:** `solver`
- **Related:** BUG-046, BUG-091, BUG-094
- **History:** `789` kept shared-corner dimensions (`BUG-046`) -> overturned by `SOLVER-UX-AUDIT-1000` (`UX-11`) -> fixed in task `1007`

### BUG-093
- **Date / turn:** 2026-11-26 (audit ID `UX-25`; fixed in task `1007`)
- **Reported by:** audit `1000` (`solver-ux-audit-1000-irregularities.mjs` `IR2.3`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `UX-25`: clicking an arc or circle with Trim or Break did nothing and showed no notice (unlike Bezier).
- **What was wrong:** Neither `trim.js` nor `break.js` supports arcs or circles, yet clicking an arc or circle with Trim/Break returned silently instead of showing a plain refusal notice.
- **Cause:** `CURVE_REFUSALS` in `packages/core/curve-kinds.js` only declared `[TOOL_MODES.TRIM]` and `[TOOL_MODES.BREAK]` entries under `bezier`, omitting `arc` and `circle`.
- **Task id(s):** `1007`
- **Fix merge sha:** open (`agents/trimbreak-1007`, awaiting merge)
- **Guarding test file(s):** `tests/trim-break-curve-refusal-ux25-node.test.js`
- **Status:** fixed
- **Family:** `ui-input`
- **Related:** BUG-079, BUG-090
- **History:** found in `SOLVER-UX-AUDIT-1000` (`UX-25`) -> fixed in task `1007` (`CURVE_REFUSALS.arc` and `CURVE_REFUSALS.circle`)

### BUG-094
- **Date / turn:** 2026-11-26 (audit ID `D-7`; fixed in task `1007`)
- **Reported by:** audit `1003` (`dimension-audit-1003-values-driven.mjs` `V2.6.deleteSharedEdge`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `D-7`: deleting one edge `L1(a,b)` of a shared-corner rectangle left point-to-line dimension `d2=[p,a,b]` and edge dimension `d1=[a,b]` hanging on the deleted line.
- **What was wrong:** Because corners `a` and `b` stayed used by surviving adjacent edges `L4` and `L2`, `removeGeometry` saw `goneJ` empty and left `H(a,b)`, `d1=[a,b]`, and point-to-line `d2=[p,a,b]` behind.
- **Cause:** `packages/core/delete-manager.js` (`removeGeometry`) only matched deleted shape IDs (`SHAPE_FIELDS`) and orphaned/deleted joint IDs (`JOINT_FIELDS`), without matching constraints/dimensions keyed by a removed line's `[a,b]` endpoint pair.
- **Task id(s):** `1007`
- **Fix merge sha:** open (`agents/trimbreak-1007`, awaiting merge)
- **Guarding test file(s):** `tests/delete-shared-edge-d7-node.test.js`
- **Status:** fixed
- **Family:** `solver`
- **Related:** BUG-092
- **History:** found in `DIMENSION-AUDIT-1003` (`D-7`) -> fixed in task `1007`

### BUG-095
- **Date / turn:** 2026-11-26 (audit IDs `UX-07`, `B-5`, `D-21`; fixed in task `1007`)
- **Reported by:** audits `1000`, `1000B`, `1003` (`C2.1`, `5b`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `UX-07` / `B-5` / `D-21`: in a locked sketch, `deleteSelection(state)` still deleted selected constraints/dimensions (`delete-manager.js:182-187`).
- **What was wrong:** Even after filtering out inert entities on line 178 (`!isConstraintInert(inert, c)`), a second unconditional loop in `deleteSelection` re-pushed every constraint from `state.selectedConstraints` (deleting locked-sketch dimensions/constraints).
- **Cause:** `packages/core/delete-manager.js` lines 182-187 (orig) re-pushed all `state.selectedConstraints` without the inert/locked guard.
- **Task id(s):** `1007`
- **Fix merge sha:** open (`agents/trimbreak-1007`, awaiting merge)
- **Guarding test file(s):** `tests/delete-locked-ux07-node.test.js`
- **Status:** fixed
- **Family:** `solver`
- **History:** found in `1000` (`UX-07`), `1000B` (`B-5`), `1003` (`D-21`) -> fixed in task `1007` (removed duplicate loop)

---

## Family index

Entries in each family are listed in chronological date order (`MM-DD`, oldest first) so recurring patterns read as a timeline.

| Family | Timeline (oldest first) |
|---|---|
| `build-deploy` | BUG-062 (11-21) |
| `export-svg` | BUG-022 (11-16), BUG-025 (11-16), BUG-034 (11-16), BUG-035 (11-17), BUG-043 (11-18), BUG-049 (11-19) |
| `flaky-test` | BUG-004 (11-15), BUG-011 (11-15), BUG-016 (11-15), BUG-047 (11-19), BUG-052 (11-19), BUG-068 (11-22), BUG-069 (11-23), BUG-087 (11-25) |
| `fusion-frame` | BUG-024 (11-16), BUG-048 (11-19), BUG-064 (11-21), BUG-071 (11-23), BUG-077 (11-23), BUG-084 (11-25), BUG-085 (11-25), BUG-086 (11-25), BUG-089 (11-25) |
| `layout-overlap` | BUG-006 (11-15), BUG-007 (11-15), BUG-017 (11-15), BUG-019 (11-16), BUG-020 (11-16), BUG-028 (11-16), BUG-030 (11-16), BUG-031 (11-16), BUG-040 (11-18), BUG-041 (11-18), BUG-055 (11-20), BUG-057 (11-20), BUG-070 (11-20), BUG-078 (11-23), BUG-083 (11-24) |
| `notice-wording` | BUG-079 (11-24), BUG-090 (11-25) |
| `snap-not-applied` | BUG-073 (11-23), BUG-075 (11-23) |
| `solver` | BUG-005 (11-15), BUG-008 (11-15), BUG-018 (11-15), BUG-046 (11-18), BUG-059 (11-20), BUG-060 (11-20), BUG-076 (11-23), BUG-091 (11-26), BUG-092 (11-26), BUG-094 (11-26), BUG-095 (11-26) |
| `stl-relief` | BUG-050 (11-19), BUG-058 (11-20), BUG-063 (11-21) |
| `stock` | BUG-072 (11-23), BUG-080 (11-24), BUG-088 (11-25) |
| `storage-lifecycle` | BUG-014 (11-15), BUG-015 (11-15), BUG-023 (11-16) |
| `sync` | BUG-001 (11-14), BUG-002 (11-14), BUG-012 (11-15), BUG-013 (11-15), BUG-036 (11-17), BUG-038 (11-17), BUG-065 (11-21), BUG-081 (11-24), BUG-082 (11-24) |
| `tool-bypasses-constraint-manager` | BUG-074 (11-23) |
| `toolpath-geometry` | BUG-032 (11-16), BUG-033 (11-16), BUG-044 (11-18), BUG-051 (11-19), BUG-054 (11-20), BUG-056 (11-20), BUG-061 (11-20), BUG-066 (11-21), BUG-067 (11-22) |
| `ui-input` | BUG-003 (11-14), BUG-009 (11-15), BUG-010 (11-15), BUG-021 (11-16), BUG-027 (11-16), BUG-042 (11-18), BUG-045 (11-18), BUG-053 (11-20), BUG-093 (11-26) |
| `units` | BUG-026 (11-16), BUG-029 (11-16), BUG-037 (11-17), BUG-039 (11-17) |

---

## Audits

Audit-only findings live in their dedicated audit documents rather than being duplicated in the table above:

- [docs/SNAP-CONSTRAINT-AUDIT-869.md](SNAP-CONSTRAINT-AUDIT-869.md) — Snap / pick constraint audit (`424` live cells, `102` failures across causes A–J; paired with BUG-073, BUG-074, BUG-075).
- [docs/STOCK-MODEL-890.md](STOCK-MODEL-890.md) — Unified Stock model inventory findings `F1`–`F5` (empty Stock thickness, `reviewSig`, Stock loop depth, per-selection `thicknessMm`, multi-body thickness).
- [docs/SOLVER-UX-AUDIT-1000.md](SOLVER-UX-AUDIT-1000.md), [docs/SOLVER-UX-AUDIT-1000B.md](SOLVER-UX-AUDIT-1000B.md), [docs/DIMENSION-AUDIT-1003.md](DIMENSION-AUDIT-1003.md) — Solver UI/UX & Dimension audits (tasks `1000`, `1000B`, `1003`; paired with BUG-091..BUG-095 fixed in task `1007`).
