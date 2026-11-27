# Bug Archive, BUG-134 (11-26), BUG-135 (11-26)

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
- **History:** found in hunt 784 2026-11-18 -> 789 merged 2026-11-19 -> owner widened <=0 refusal to all distances -> 789b merged 2026-11-19 -> audit 1035 (N-5) found Shaper's Fusion / STL import landing without the arc equal: BUG-373, fixed in task 1036 (one shared landing)

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
- **History (2026-11-26, task `1018`):** the arc / circle refusal is REPLACED by the owner's ruling (turn 3826): Trim and Break now take arcs and circles (BUG-190); `CURVE_REFUSALS` keeps only the Bezier, whose notice still fires (`tests/trim-break-curve-refusal-ux25-node.test.js`, Bezier only). Status stays `fixed` for the Bezier notice.

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

### BUG-096
- **Date / turn:** 2026-11-26 (task 1009; `NEW-11` from task 875 / `1000`)
- **Reported by:** coverage audit (`NEW-11`) / solver UX audit `1000`
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (Design tab, `packages/core/fillet.js`)
- **Report:** `"fillet arcs are created with no sweep (fillet.js ~:520, sweep undefined)"` (`NEW-11`: fillet arc midpoint near 180 deg flips shortest-way on bite jitter; mirrored fillet inherits `sweep: undefined`).
- **What was wrong:** Fillet arcs stored no `sweep` direction boolean, so `arcSweepInfo` defaulted to the shortest arc between endpoints near 180 deg, causing bite jitter flips in `coverage-matrix` (`NEW-11`, 6 cells) and missing `sweep` on mirrored fillets (`mirror.js:37`).
- **Cause:** `packages/core/fillet.js:520` (`applyFillet`) called `makeArc(...)` without assigning `arcShape.sweep`.
- **Task id(s):** `1009`
- **Fix merge sha:** pending merge of `agents/arcsweep-1009`
- **Guarding test file(s):** `tests/fillet-sweep-1009.test.js`, `tests/coverage-matrix.test.js` (`NEW-11` removed from `KNOWN`)
- **Status:** fixed
- **Family:** `solver`
- **Related:** BUG-060, BUG-098
- **History:** `NEW-11` recorded in `coverage-matrix` -> fixed in `packages/core/fillet.js:522` (`arcShape.sweep = arcSweepInfo(centerPt, tA, tB).dir > 0`), `NEW-11` removed from `KNOWN` (`2026-11-26`)

### BUG-097
- **Date / turn:** 2026-11-26 (task 1009; `UX-03` from `1000` / `1000B`)
- **Reported by:** solver UX audits `1000` / `1000B`
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (Design tab, `packages/ui/input-manager.js`)
- **Report:** `"UX-03: dragging an arc's end onto its own start snaps and adds coincident:e,s, collapsing the arc to zero sweep permanently."`
- **What was wrong:** Dragging an arc's endpoint onto its own opposite endpoint snapped onto it and created `coincident` on release, permanently collapsing the arc to zero sweep (even though the Coincident tool refused `(s, e)`).
- **Cause:** `packages/ui/input-manager.js:451` (`updateSnapTarget`) only excluded `state.drag.jointIds` when calling `toolSnap` -> `findSnap` and checking `j_origin`, so an arc's own opposite endpoint (and `j_origin` when coincident with it) remained a snap candidate.
- **Task id(s):** `1009`
- **Fix merge sha:** pending merge of `agents/arcsweep-1009`
- **Guarding test file(s):** `tests/arc-no-self-weld-1009-node.test.js`
- **Status:** fixed
- **Family:** `ui-input`
- **Related:** BUG-099
- **History:** reported in `1000` (`DR4.1`) / `1000B` -> fixed in one place at `packages/ui/input-manager.js:451-462` (`2026-11-26`)

### BUG-098
- **Date / turn:** 2026-11-26 (task 1009; `UX-05` / `B-12a` from `1000` / `1000B`)
- **Reported by:** solver UX audits `1000` (`DR4.2b`) / `1000B` (`6d`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (Design tab, `packages/core/fillet.js` + `packages/core/solver/engine.js`)
- **Report:** `"UX-05 = B-12a: dragging a corner far folds the fillet arc inside-out (centre jumps past the edge, a cusp)."`
- **What was wrong:** Without `arc.sweep` (`BUG-096`) and without checking smooth tangent orientation during drags, dragging a filleted corner past 180 deg or shrinking a free-radius fillet folded the arc into a cusp (`filletTravel <= 0`, e.g., `6d` center jumping into a cusp). Fusion live check `(a)` (L1 `(-6,0)-(-2,0)`, L2 `(-2,0)-(-2,4)`, `r=0.6`, L2 far end dragged past straight to lower right): the fillet stays tangent on its original side and its sweep grows smoothly past 180 deg to `358.85 deg` (`r=3.079`), with no cusp and no flip.
- **Cause:** `packages/core/fillet.js:520` omitted `arcShape.sweep`, and `packages/core/solver/engine.js` (`NewtonSolver.solve`) accepted `hasSpring` drag steps that turned a fillet's shared tangent transitions (`filletTravel`) to `<= 0` (`cusp`). (Note: parked `847-B` applied `_filletTurnedOut` to non-drag constraint solves too, breaking 5 `coverage-matrix` + 9 `fusion-oracle` graded cells; scoping `_keepsFillets` strictly to `hasSpring` drags preserves all Fusion-oracle and coverage-matrix green cells.)
- **Task id(s):** `1009`
- **Fix merge sha:** pending merge of `agents/arcsweep-1009`
- **Guarding test file(s):** `tests/fillet-no-cusp-drag-1009.test.js`
- **Status:** fixed (drag fold); see `BUG-060` for parked non-drag `847-B` dim-edit case
- **Family:** `solver`
- **Related:** BUG-060, BUG-096, BUG-099
- **History:** reported in `1000` / `1000B` -> confirmed against Fusion LIVE `(a)` (`358.85 deg`, `r=3.079`) -> fixed in `fillet.js:522` + `engine.js` `_keepsFillets` (`hasSpring` drags only) (`2026-11-26`)

### BUG-099
- **Date / turn:** 2026-11-26 (task 1009; `B-12b` / `EA-4` from `1000B` / task `531`)
- **Reported by:** extreme-arcs coverage (`EA-4`) & solver UX audit `1000B` (`6f`), Fusion LIVE checked `2026-11-26`
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (Design tab, `packages/core/solver/engine.js`)
- **Report:** `"B-12b / EA-4: a 10 degree arc whose end is dragged past its start wraps to ~352 degrees."`
- **What was wrong:** Dragging the endpoint of a short arc (`10 deg` in `6f`, `0.1 deg` in `EA-4` `s0.1ccw`) past its start wraps the arc to `~352-355 deg`.
  - **Fusion LIVE fact `(a)` (fillet):** L1 `(-6,0)-(-2,0)`, L2 `(-2,0)-(-2,4)` with fillet `r 0.6`, L2 far end dragged past straight to lower right -> fillet stays tangent on its original side, sweep grows smoothly to `358.85 deg` (`r=3.079`), no cusp, no flip.
  - **Fusion LIVE fact `(b)` (short arc):** `10 deg` arc (centre `(-4.5, 2.5)`, `r 1.2`), end dragged `~35 deg` past start -> arc stays short (`6.97 deg`), centre and radius re-solve to centre `(0.476, 1.207)`, `r 3.991` (no `~352 deg` wrap).
  - **Task 1009 finding (`extreme-arcs.test.js`):** once `fillet.js` sets `arc.sweep`, `f179r10` (`179 deg` corner = `1 deg` fillet) matches Fusion `(a)` (`-358.873 deg` smooth reflex loop), but `tests/harness/coverage/arcs-rows.js:129` (`Math.abs(g1.span - g0.span) > Math.PI`) still labels those 16 `f179r10` cells `EA-4`; meanwhile a Cartesian LM min-sweep clamp does not match Fusion `(b)` (which re-solves centre across the chord). `EA-4` and `EA-5` stay in `KNOWN` and `arcs-rows.js` stays unchanged pending dedicated `B-12b` solver design.
- **Cause:** Cartesian joint LM solver (`engine.js`) updates joint positions incrementally on one side of `s..e`, wrapping `arcSweepInfo` across `0 deg` to `~352 deg` instead of re-solving centre/radius across the chord as Fusion `(b)` does.
- **Task id(s):** open (deferred from `1009`)
- **Fix merge sha:** open
- **Guarding test file(s):** `tests/extreme-arcs.test.js` (`KNOWN['EA-4']`, `KNOWN['EA-5']`)
- **Status:** open, waiting for Fusion `(b)` centre-flip / `extreme-arcs` design
- **Family:** `solver`
- **Related:** BUG-097, BUG-098
- **History:** `EA-4` logged in task `531` -> Fusion LIVE `(a)` & `(b)` measured and `f179r10` vs `arcs-rows.js:129` interaction documented in task `1009` (`2026-11-26`); deferred to its own task

### BUG-100
- **Date / turn:** 2026-11-26 (audit `D-1`, task 1003 -> fixed in task 1004)
- **Reported by:** worker (`1003`, Dimension tool focused audit)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (Design tab, desktop & phone)
- **Report:** `"Audit D-1: Quick-typing 4 then 5 + Enter while placing a dimension sets the dimension to 5 instead of 45."`
- **What was wrong:** Typing a multi-digit value while placing a dimension overwrote the first digit on the second keystroke (`45` became `5`).
- **Cause:** `packages/ui/input-manager.js:1297-1298` called `anchorPlacingDimension(svgEl, state)` (which called `showEditInput` without `initialKey`, queuing `requestAnimationFrame(() => uiState.singleInput.select())`) and then immediately called `showEditInput(svgEl, state, pc, e.key)`; on the next animation frame the stale rAF selected `'4'`, so typing `'5'` replaced it.
- **Fix:** Pass `initialKey` through `anchorPlacingDimension(svg, state, initialKey)` (`packages/ui/input-handlers/dimension-tool.js`) so `packages/ui/input-manager.js` makes a single `showEditInput` call, and track/cancel `uiState.focusRafId` in `packages/ui/numeric-input-manager.js` (focusing synchronously with caret at end when `typeof initialKey === 'string'`).
- **Task id(s):** `1003` (audit), `1004` (fix)
- **Fix merge sha:** pending (`agents/dimfix-1004`)
- **Guarding test file(s):** `tests/dimension-1004-node.test.js`, `tests/dimension-1004-live.test.js`
- **Status:** fixed
- **Family:** `ui-input`
- **Related:** BUG-101, BUG-102, BUG-103, BUG-104

### BUG-101
- **Date / turn:** 2026-11-26 (audit `D-2`, task 1003 -> fixed in task 1004)
- **Reported by:** worker (`1003`, Dimension tool focused audit)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (Design tab)
- **Report:** `"Audit D-2: Clicking an already-dimensioned parallel or angle line pair re-enters placing on the existing dimension; pressing Esc permanently deletes it with zero undo."`
- **What was wrong:** Picking a line pair that already had a parallel distance or angle dimension recovered the existing constraint into `__placing`, and pressing `Esc` (or switching tools) spliced it out of `state.constraints` without an undo entry.
- **Cause:** `resetDimensionState` (`packages/ui/input-handlers/dimension-tool.js`) spliced `pc` out of `state.constraints` unconditionally instead of gating removal on `pc.__newlyPlaced === true`.
- **Fix:** Gate constraint removal and birth-snapshot discard in `resetDimensionState` (`packages/ui/input-handlers/dimension-tool.js`) on `pc.__newlyPlaced === true` so `Esc` / tool switch only removes a dimension born in the current placement and keeps an existing dimension intact.
- **Task id(s):** `1003` (audit), `1004` (fix)
- **Fix merge sha:** pending (`agents/dimfix-1004`)
- **Guarding test file(s):** `tests/dimension-1004-node.test.js`
- **Status:** fixed
- **Family:** `ui-input`
- **Related:** BUG-100, BUG-102, BUG-104

### BUG-102
- **Date / turn:** 2026-11-26 (audit `D-3`, task 1003 -> fixed in task 1004)
- **Reported by:** worker (`1003`, Dimension tool focused audit)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (Design tab)
- **Report:** `"Audit D-3: Press-drag-release placement (>250 ms) leaves __newlyPlaced = true, so a later double-click + Esc deletes the dimension."`
- **What was wrong:** Placing a dimension by press-drag-release (>250 ms) cleared `__placing` but left `__newlyPlaced = true`; later double-clicking its label and pressing `Esc` caused `numeric-input-manager.js` `handleCancel` to delete the committed dimension.
- **Cause:** `handleDimensionPointerUp` (and driven drop paths in `anchorPlacingDimension` / `dimensionPointerDown`) in `packages/ui/input-handlers/dimension-tool.js` cleared `__placing` without clearing `__newlyPlaced` / `__restoredDimension`.
- **Fix:** Route every placement-end-without-edit path (`handleDimensionPointerUp` drag-release and driven drops in `packages/ui/input-handlers/dimension-tool.js`) through a single `finishPlacementWithoutEdit(c, state)` helper that clears `__placing`, `__newlyPlaced`, `__restoredDimension`, and `placingConstraint`.
- **Task id(s):** `1003` (audit), `1004` (fix)
- **Fix merge sha:** pending (`agents/dimfix-1004`)
- **Guarding test file(s):** `tests/dimension-1004-node.test.js`
- **Status:** fixed
- **Family:** `ui-input`
- **Related:** BUG-101, BUG-104

### BUG-103
- **Date / turn:** 2026-11-26 (audit `D-5` + `D-6`, task 1003 -> fixed in task 1004)
- **Reported by:** worker (`1003`, Dimension tool focused audit)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (Design tab)
- **Report:** `"Audit D-5 + D-6: Point-first dimensions leak state.active = { mode: 'dim' }; Point -> Circle/Arc rim or switching tool mid-pick leaves pendingDimension behind and hijacks the next click into an unintended point-to-point dimension."`
- **What was wrong:** Completing a point-first dimension (`P->P`, `P->L`, `P->Axis`) left `state.active = { mode: 'dim' }` set, and clicking a circle/arc rim after a point pick or switching tools mid-pick left `dimensionState.pendingDimension` active so returning to Dimension tool and clicking a point silently dimensioned from the stale point.
- **Cause:** `packages/ui/input-handlers/dimension-tool.js` did not clear `state.active` on point-first completion or clear `pendingDimension` when a non-line shape superseded a point pick, and the shared tool-switch path did not call `resetDimensionState(state)`.
- **Fix:** Add a single `clearPointPick(state)` helper in `packages/ui/input-handlers/dimension-tool.js` called on placement start (`startPlacing`, selection start, non-line supersede, creation failure) and inside `resetDimensionState(state)`, and call `resetDimensionState(state)` via `leaveActiveTool(state, nextTool)` on tool switches.
- **Task id(s):** `1003` (audit), `1004` (fix)
- **Fix merge sha:** pending (`agents/dimfix-1004`)
- **Guarding test file(s):** `tests/dimension-1004-node.test.js`
- **Status:** fixed
- **Family:** `ui-input`
- **Related:** BUG-104

### BUG-104
- **Date / turn:** 2026-11-26 (audit `B-7` / `D-20`, tasks 1000B & 1003 -> fixed in task 1004)
- **Reported by:** worker (`1000B` solver UX audit & `1003` Dimension tool focused audit)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (Design tab, desktop & phone)
- **Report:** `"Audit B-7 / D-20: Switching tool mid-placement (ribbon button or keyboard shortcut) leaves the half-placed __placing dimension and its birth undo snapshot in the document in all 4 hosts."`
- **What was wrong:** Selecting another tool via the ribbon or a shortcut while a dimension was in `__placing` mode left the phantom dimension in `state.constraints` with `__placing = true` and a dangling undo step across SketchStudio, Shaper, Pen Plotter, and Trace.
- **Cause:** Neither `switchToTool` (`packages/ui/input-manager.js`) nor `selectTool` (`packages/ui/tool-ribbon.js`) called `resetDimensionState(state)` when leaving the Dimension tool.
- **Fix:** Extract `leaveActiveTool(state, nextTool)` in `packages/ui/input-manager.js` (calling `resetDimensionState(state)` whenever `nextTool !== TOOL_MODES.DIMENSION`, keeping re-click/re-key on Dimension active per owner ruling) and call it from `switchToTool` and `tool-ribbon.js`'s `onToolClick` branch.
- **Task id(s):** `1000B`, `1003` (audit), `1004` (fix)
- **Fix merge sha:** pending (`agents/dimfix-1004`)
- **Guarding test file(s):** `tests/dimension-1004-node.test.js`, `tests/dimension-1004-live.test.js`
- **Status:** fixed
- **Family:** `ui-input`
- **Related:** BUG-101, BUG-102, BUG-103

### BUG-105
- **Date / turn:** 2026-11-26 (audit `DD-4`, task 1003; final owner ruling turn 3764 `"leave tool"`)
- **Reported by:** worker (`1003`, Dimension tool focused audit — logged as divergence `DD-4`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (Design tab)
- **Report:** `"Audit DD-4: Pressing Esc mid-pick or mid-placement in the Dimension tool cancels the in-progress pick/placement and immediately exits to Select in one step."`
- **What was wrong:** Not a bug. Initially flagged as an unverified divergence against Fusion (`DD-4`); advisor verified Fusion 360 live on 2026-11-26 that ONE `Esc` in Sketch Dimension exits mid-pick and mid-placement, and the owner ruled (turn 3764, `"leave tool"`) to keep one-step `Esc` (cancels whatever is in progress — new dimension removed, existing dimension kept per BUG-101 — and leaves the Dimension tool).
- **Cause:** Intentional behaviour matching Fusion 360 (`packages/ui/input-manager.js` `handleEscape`).
- **Task id(s):** `1003` (audit), `1004` (ruling recorded)
- **Fix merge sha:** n/a (no code change; existing behaviour kept)
- **Guarding test file(s):** `tests/dimension-1004-node.test.js`
- **Status:** not a bug (closed; Fusion verified live 2026-11-26: one Esc exits mid-pick and mid-placement)
- **Family:** `ui-input`
- **Related:** BUG-101, BUG-104
- **History:** logged as unverified divergence `DD-4` in task 1003 -> temporary two-step `Esc` ruling turn 3759 held after live Fusion check 2026-11-26 -> final owner ruling turn 3764 `"leave tool"` closed `DD-4` as not a bug

### BUG-110
- **Date / turn:** 2026-11-26 (audit 1000B `B-15`, owner ruling turn 3741)
- **Reported by:** worker (auditor 1000B)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (Design tab, constraint tools)
- **Report:** Audit `B-15` (`docs/SOLVER-UX-AUDIT-1000B.md`): after a refused / invalid pick, Parallel, Perpendicular, Collinear, H/V, Midpoint and Symmetric dropped to Select while Coincident, Tangent and Equal stayed active.
- **What was wrong:** Refused clicks in 6 of the 9 constraint tools exited the tool back to Select instead of keeping the tool active.
- **Cause:** `packages/ui/input-manager.js:758-763` (`EXIT ON INVALID CLICK`) called `switchToTool(state, TOOL_MODES.SELECT)` whenever `handleConstraintPointerDown` returned `false`.
- **Fix:** Removed the `if (!handled) switchToTool(state, TOOL_MODES.SELECT)` exit branch in `packages/ui/input-manager.js`; constraint tools now stay active after every use or refusal (only `Esc` or picking another tool exits).
- **Task id(s):** `1005`
- **Fix merge sha:** pending (`agents/toolexit-1005`)
- **Guarding test file(s):** `tests/constraint-refusal-stay-b15-1005-node.test.js`, `tests/constraint-activation-ux15-1005-node.test.js`
- **Status:** fixed
- **Family:** `ui-input`
- **Related:** BUG-111, BUG-112
- **History:** found in audit 1000B (`B-15`) 2026-11-25 -> fixed in task 1005 2026-11-26

### BUG-111
- **Date / turn:** 2026-11-26 (audits 1000 `UX-15` / 1000B `B-14b,d` & second-click matrix, owner ruling turn 3741)
- **Reported by:** workers (auditors 1000, 1000B)
- **App(s) & host:** SketchStudio (vs Shaper, Pen Plotter, Trace)
- **Report:** Audit `UX-15` / `B-14b,d` (`docs/SOLVER-UX-AUDIT-1000.md`, `docs/SOLVER-UX-AUDIT-1000B.md`, `docs/SOLVER-UX-CROSS-1000B.md`): in SketchStudio only, re-clicking an active constraint tool's ribbon button exited to Select, H/V with a preselected line exited to Select, and Coincident cleared the selection.
- **What was wrong:** SketchStudio diverged from Shaper and Pen Plotter on constraint tool activation and re-click behaviour.
- **Cause:** SketchStudio kept its own duplicate `handleToolActivate` / `setTool` in `apps/sketchstudio/ui/ui-manager.js:26-110` wired through `onToolClick` and `defaultInputCtx.setActiveTool` / `resetToSelectTool`.
- **Fix:** Deleted `handleToolActivate`, `setTool`, `onToolClick` override, and duplicate Esc listener from `apps/sketchstudio/ui/ui-manager.js` and removed `defaultInputCtx.setActiveTool` / `resetToSelectTool` in `packages/ui/input-manager.js` so all hosts share `switchToTool`; re-clicking an active constraint tool now stays in the tool.
- **Task id(s):** `1005`
- **Fix merge sha:** pending (`agents/toolexit-1005`)
- **Guarding test file(s):** `tests/constraint-activation-ux15-1005-node.test.js`
- **Status:** fixed
- **Family:** `ui-input`
- **Related:** BUG-110, BUG-113, BUG-115
- **History:** found in audits 1000 (`UX-15`) / 1000B (`B-14b,d`) 2026-11-25 -> fixed in task 1005 2026-11-26

### BUG-112
- **Date / turn:** 2026-11-26 (audit 1000B `B-10`)
- **Reported by:** worker (auditor 1000B)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (Design tab, Midpoint tool)
- **Report:** Audit `B-10` (`docs/SOLVER-UX-AUDIT-1000B.md`): Midpoint picked on a line's own endpoint was silent and wedged its pick buffer until Esc; on an arc's own endpoint/centre it warned and exited to Select.
- **What was wrong:** Line own-endpoint picks silently left `[shape, joint]` in `selectionBuffer` so subsequent valid midpoint picks failed; arc own-endpoint picks left the curve in buffer and exited the tool.
- **Cause:** `packages/ui/input-handlers/constraint-tools.js:353-381` (`handleMidpointPointerDown`) only refused arc own endpoints (without clearing the full buffer) and had no refusal/reset path when `!endpoints.includes(midpoint)` failed on a line.
- **Fix:** Unified own-endpoint/centre refusal for both lines and arcs in `packages/ui/input-handlers/constraint-tools.js` (`handleMidpointPointerDown`): shows a plain refusal message, clears selection and `pendingConstraint`, and stays in the Midpoint tool.
- **Task id(s):** `1005`
- **Fix merge sha:** pending (`agents/toolexit-1005`)
- **Guarding test file(s):** `tests/midpoint-own-end-b10-1005-node.test.js`
- **Status:** fixed
- **Family:** `ui-input`
- **Related:** BUG-110
- **History:** found in audit 1000B (`B-10`) 2026-11-25 -> fixed in task 1005 2026-11-26

### BUG-113
- **Date / turn:** 2026-11-26 (audits 1000 `UX-14` / 1000B `B-14a`)
- **Reported by:** workers (auditors 1000, 1000B)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (Design tab, Equal tool)
- **Report:** Audit `UX-14` / `B-14a` (`docs/SOLVER-UX-AUDIT-1000.md`, `docs/SOLVER-UX-AUDIT-1000B.md`): pressing `E` with 2 preselected shapes applied Equal (or refused an invalid pair) while clicking the Equal ribbon button ignored the 2-shape preselection.
- **What was wrong:** Ribbon button and `E` shortcut ran separate code paths with different preselection behaviour.
- **Cause:** `packages/ui/input-manager.js:1363-1385` handled 2-shape Equal preselection only in the `E` keydown branch, while `switchToTool` / `handleToolActivate` only inspected single-item preselections.
- **Fix:** Moved `tool.equal` and `tool.horizontalVertical` into `TOOL_SHORTCUTS` -> `switchToTool` -> `activateConstraintTool` (`packages/ui/input-handlers/constraint-tools.js`), which handles 2-shape Equal preselection identically for ribbon clicks and the `E` key across all hosts.
- **Task id(s):** `1005`
- **Fix merge sha:** pending (`agents/toolexit-1005`)
- **Guarding test file(s):** `tests/equal-preselect-ux14-1005-node.test.js`
- **Status:** fixed
- **Family:** `ui-input`
- **Related:** BUG-111, BUG-115
- **History:** found in audits 1000 (`UX-14`) / 1000B (`B-14a`) 2026-11-25 -> fixed in task 1005 2026-11-26

### BUG-114
- **Date / turn:** 2026-11-26 (audit 1000B `B-14c`)
- **Reported by:** worker (auditor 1000B)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (Design tab, H/V tool)
- **Report:** Audit `B-14c` (`docs/SOLVER-UX-AUDIT-1000B.md`): adding a duplicate H/V via preselection + `H` key or H/V ribbon button was silent, while clicking the line in the H/V tool showed `"Sketch geometry over constrained"`.
- **What was wrong:** Duplicate H/V gave different user feedback depending on whether preselection or click-in-tool was used.
- **Cause:** `packages/core/constraint-manager.js:1022` (`ConstraintManager.addHorizontalOrVertical`) passed `{ source: 'auto-detect' }`, which bypassed the `opts.source === 'toolbar'` duplicate notice at `constraint-manager.js:223`.
- **Fix:** Changed `ConstraintManager.addHorizontalOrVertical`'s default source in `packages/core/constraint-manager.js:1022` to `'toolbar'`, so preselect + `H`, preselect + H/V ribbon, and H/V tool click all emit the same over-constrained notice.
- **Task id(s):** `1005`
- **Fix merge sha:** pending (`agents/toolexit-1005`)
- **Guarding test file(s):** `tests/hv-dup-notice-b14c-1005-node.test.js`
- **Status:** fixed
- **Family:** `notice-wording`
- **Related:** BUG-079, BUG-111
- **History:** found in audit 1000B (`B-14c`) 2026-11-25 -> fixed in task 1005 2026-11-26

### BUG-115
- **Date / turn:** 2026-11-26 (audit 1000B `B-6`)
- **Reported by:** worker (auditor 1000B)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (Design tab, constraint preselection)
- **Report:** Audit `B-6` (`docs/SOLVER-UX-AUDIT-1000B.md`): preselecting a joint then activating Parallel and clicking a line created a corrupt `parallel` constraint with a joint ID in `shapes[0]`; preselecting a circle then activating H/V caused a nonsensical second-point refusal on a line click.
- **What was wrong:** Incompatible single-item preselections were stuffed into `pendingConstraint.firstElement` without validating element kind/shape type for the chosen constraint tool.
- **Cause:** `packages/ui/input-manager.js:1568-1585` (and deleted `apps/sketchstudio/ui/ui-manager.js:62-98`) assigned any single selected joint or shape into `pendingConstraint.firstElement`, and `handleShapeConstraintPointerDown` (`constraint-tools.js:136`) did not verify `firstElement.type === 'shape'`.
- **Fix:** Added a declared `CONSTRAINT_PRESELECT` table in `packages/ui/input-handlers/constraint-tools.js` (`activateConstraintTool`) that refuses invalid single preselections with a plain warning, leaves `firstElement: null` and the tool active, plus guarded `firstElement.type === 'shape'` in `handleShapeConstraintPointerDown`.
- **Task id(s):** `1005`
- **Fix merge sha:** pending (`agents/toolexit-1005`)
- **Guarding test file(s):** `tests/constraint-preselect-b6-1005-node.test.js`
- **Status:** fixed
- **Family:** `ui-input`
- **Related:** BUG-111, BUG-113
- **History:** found in audit 1000B (`B-6`) 2026-11-25 -> fixed in task 1005 2026-11-26

### BUG-120
- **Date / turn:** 2026-11-26 (audit IDs `UX-01`, `B-2`, `D-17`; fixed in task `1006`)
- **Reported by:** audits `1000` (`D9.1`, `D9.2`), `1000B` (`2b`), `1003` (`V2.4.toggle.Href->Drv`, `Vref->Drv`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `UX-01` / `B-2` / `D-17`: making a horizontal or vertical reference dimension on a diagonal Driving set its value to the slanted length (50 on a 30 x 40 diagonal), so the shape jumped (`b (30,40) -> (50,40)`).
- **What was wrong:** the promotion re-measured every joint-pair distance as the aligned length, whatever its mode.
- **Cause:** `packages/core/dimension-seams.js` `toggleDriving` hand-rolled its own measurement (`getDist` for any 2-joint distance), not the one the label and the Parameters table read (`#core/constraint-verifier.js` `measureDimension`).
- **Fix:** `toggleDriving` takes the value `measureDimension` gives (H / V: `|dx|` / `|dy|`), then re-solves; the hand-rolled branches are gone.
- **Task id(s):** `1006`
- **Fix merge sha:** open (`agents/driving-1006`, awaiting merge)
- **Guarding test file(s):** `tests/driving-reference-1006-node.test.js` (section 1)
- **Status:** fixed
- **Family:** `solver`
- **Related:** BUG-121, BUG-122
- **History:** found in `1000` (`UX-01`), `1000B` (`B-2`), `1003` (`D-17`) -> fixed in task `1006`

### BUG-121
- **Date / turn:** 2026-11-26 (audit ID `B-3`, part of `D-17`; fixed in task `1006`)
- **Reported by:** audits `1000B` (`2c`, `2d`), `1003` (`V2.4.toggle.ParRef->Drv`, `PtAxisRef->Drv`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `B-3`: making a MOVED line-line or point-to-axis reference dimension Driving snapped the geometry back to the value it was born with (`55 -> 20`, `60 -> 25`).
- **What was wrong:** the promotion had no line-line branch at all, and its point-to-line branch read `state.joints`, where the axis ends (`j_origin`, `j_ref_x`) are not: the stale value stayed and the solve moved the geometry to it.
- **Cause:** `packages/core/dimension-seams.js` `toggleDriving` (same hand-rolled measurement as BUG-120).
- **Fix:** the same one change as BUG-120: `measureDimension` (line-line perpendicular distance; an axis resolved in the scene).
- **Task id(s):** `1006`
- **Fix merge sha:** open (`agents/driving-1006`, awaiting merge)
- **Guarding test file(s):** `tests/driving-reference-1006-node.test.js` (section 2)
- **Status:** fixed
- **Family:** `solver`
- **Related:** BUG-120, BUG-122
- **History:** found in `1000B` (`B-3`) and `1003` (`D-17`) -> fixed in task `1006`

### BUG-122
- **Date / turn:** 2026-11-26 (audit ID `D-4`; fixed in task `1006`)
- **Reported by:** audit `1003` (`V2.4.toggle.AngAxisRef->Drv`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `D-4`: making an angle-to-axis reference dimension Driving collapsed the line to the origin (`b = (0, -0)`).
- **What was wrong:** the promotion looked the axis (`ref_axis_x` / `ref_axis_y`) up in `state.shapes`, where it is not, so the stale value stayed and the solve folded the line.
- **Cause:** `packages/core/dimension-seams.js` `toggleDriving` angle branch (same hand-rolled measurement as BUG-120).
- **Fix:** new `#core/constraint-verifier.js` `measureAngleDimension` (`{ value, sector, parallel }`, axes resolved in the scene: the sector under the label, as before; parallel lines 0 / 180), the one angle measurement: `measureDimension` reads its value, `toggleDriving` its value and sector.
- **Task id(s):** `1006`
- **Fix merge sha:** open (`agents/driving-1006`, awaiting merge)
- **Guarding test file(s):** `tests/driving-reference-1006-node.test.js` (section 3)
- **Status:** fixed
- **Family:** `solver`
- **Related:** BUG-120, BUG-121
- **History:** found in `1003` (`D-4`) -> fixed in task `1006`

### BUG-123
- **Date / turn:** 2026-11-26 (audit IDs `UX-08`, `B-4`, `D-19`; fixed in task `1006`)
- **Reported by:** audits `1000` (`D9.3b`, `IR2.1`), `1000B` (`P8-A`, `2a`), `1003` (`V2.4.ctxToggle`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `UX-08` / `B-4` / `D-19`: Driving <-> Reference (context menu) and Lock / Unlock (F, the ribbon Lock, the context menu) recorded no undo step: Ctrl+Z undid the edit before (it deleted a line drawn before the lock), and a switch to Reference lost the dimension's formula for good.
- **What was wrong:** neither change took a snapshot before it.
- **Cause:** `packages/core/dimension-seams.js` `toggleDriving` and `packages/ui/input-manager.js` `toggleFixedSelection` (the one Lock / Unlock every way calls) never called `saveState`.
- **Fix:** each records ONE undo step (`#core/sketch-model.js` `recordUndo`, the shared undo path) before it changes anything; a refused switch, and a Lock that changes no point, record none.
- **Task id(s):** `1006`
- **Fix merge sha:** open (`agents/driving-1006`, awaiting merge)
- **Guarding test file(s):** `tests/driving-reference-1006-node.test.js` (sections 4a, 4b)
- **Status:** fixed
- **Family:** `solver`
- **History:** found in `1000` (`UX-08`), `1000B` (`B-4`), `1003` (`D-19`) -> fixed in task `1006`

### BUG-124
- **Date / turn:** 2026-11-26 (audit ID `UX-16`, part `a` of `D-25`; fixed in task `1006`)
- **Reported by:** audits `1000` (`D5.1`, `L2.desktop`, `L2.phone`), `1000B` cross (`MAIN1001.UX16`), `1003` (`V2.4.autoRef.redundantAngleTri`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `UX-16`: double-clicking an existing driving dimension the sketch already determines (a line with both ends locked) never opened its box and silently made it a Reference, with no undo step and (since task 1001) no message.
- **What was wrong:** the birth rule "a dimension placed on a quantity the sketch already determines is born driven" ran on every open of the value box, a double-click on an existing dimension included.
- **Cause:** `packages/ui/numeric-input-manager.js` `showEditInput`: the `isDimensionDetermined` demotion was not limited to a just-placed dimension.
- **Fix:** the demotion runs only for a dimension being born (`__newlyPlaced`); an existing driving dimension opens its box like any other. A typed value the sketch cannot take is refused by the existing edit refusal ("Can't set to 70 — d1 is already determined by the other constraints. Reverted."), nothing changes, no undo step.
- **Task id(s):** `1006`
- **Fix merge sha:** open (`agents/driving-1006`, awaiting merge)
- **Guarding test file(s):** `tests/driving-reference-1006-node.test.js` (section 5)
- **Status:** fixed
- **Family:** `ui-input`
- **Related:** BUG-125, BUG-126
- **History:** found in `1000` (`UX-16`); toast removed by task 1001, silent demotion left (`1000B` cross) -> fixed in task `1006`

### BUG-125
- **Date / turn:** 2026-11-26 (audit IDs `DIV-03`, `DD-3`; fixed in task `1006`)
- **Reported by:** audits `1000` (`D3.1`-`D3.3`), `1003` (`DD-3`, `V2.4.autoRef.redundantAngleTri`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `DIV-03` / `DD-3`: double-clicking a Reference dimension did nothing at all: no box, no message (owner rule: no result = bug).
- **What was wrong:** the value box refused to open for a reference without a word.
- **Cause:** `packages/ui/numeric-input-manager.js` `showEditInput` returned at once for a reference (`if (constraint.isDriven || constraint.driven) return;`).
- **Fix:** a reference opens the same box READ-ONLY (mode `'view'`), on its label, showing what its label shows (`#core/constraint-verifier.js` `measureDimension`), with the hint "Reference dimension: measured, not typed. To type a value, make it Driving (right-click it, or touch and hold)." Enter, Esc or a press outside closes it; nothing changes, no undo step. Chosen over offering the Driving / Reference choice because it reuses the box, its placement and its hint line (the menu's actions live in input-manager, which the box cannot call).
- **Task id(s):** `1006`
- **Fix merge sha:** open (`agents/driving-1006`, awaiting merge)
- **Guarding test file(s):** `tests/driving-reference-1006-node.test.js` (section 6), `tests/reference-dim-box-1006-live.test.js` (desktop mouse 1280 x 800, phone touch 390 x 844), `tests/dimension-redundant-driven-node.test.js` (section 2 updated)
- **Status:** fixed
- **Family:** `ui-input`
- **Related:** BUG-124
- **History:** found in `1000` (`DIV-03`) and `1003` (`DD-3`) -> fixed in task `1006`

### BUG-126
- **Date / turn:** 2026-11-26 (audit IDs `B-9`, part `a` of `D-25`; fixed in task `1006`)
- **Reported by:** audits `1000B` (`B-9`, `XB-9`), `1003` (`V2.4.autoRef.redundantAngleTri`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `B-9` / `D-25`: a redundant Angle dimension (90 between an H and a V line, or an angle of a triangle whose three sides are dimensioned) was born Driving, while every redundant distance is born Reference.
- **What was wrong:** the birth rank test (a dimension the existing driving constraints already determine comes in as a Reference) was asked for distances only.
- **Cause:** `packages/core/constraint-manager.js` `createConstraint`: the `isDistanceRedundant` test was guarded by `type === DISTANCE`.
- **Fix:** the same test for `DISTANCE` and `ANGLE` (the types `isDimensionDetermined` reads): one rule.
- **Task id(s):** `1006`
- **Fix merge sha:** open (`agents/driving-1006`, awaiting merge)
- **Guarding test file(s):** `tests/driving-reference-1006-node.test.js` (section 7)
- **Status:** fixed
- **Family:** `solver`
- **Related:** BUG-124
- **History:** found in `1000B` (`B-9`) and `1003` (`D-25`) -> fixed in task `1006`

### BUG-140
- **Date / turn:** 2026-11-26 (audit `DD-1` / `DIV-01` / `B-19a`, tasks 1000, 1000B & 1003; owner ruling turn 3760 -> fixed in task 1008)
- **Reported by:** worker (`1000` solver UX audit, `1003` Dimension tool audit); owner ruling turn 3760
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (Design tab, desktop & phone)
- **Report:** `"Circle dimensions default to Radius (R) while the draw-time circle box asks for a Diameter; Fusion 360 gives a circle a Diameter (Ø, SketchDiameterDimension) and an arc a Radius (R)."`
- **What was wrong:** A click on a circle in the Dimension tool, `D` with a circle selected, and the circle's draw-time box (which asks a DIAMETER) all made a RADIUS dimension (`R 20`); a typed diameter formula was rewritten to `(d1) / 2`.
- **Cause:** Three creators each built the radial dimension params by hand (`dimension-tool.js` `startShapeDimension`, `circle-tool.js` x2) with `isRadius: true` and the radius as value; the model already carried `isDiameter` (solver, label `Ø`, slot width) but no creator for a circle set it.
- **Fix:** ONE decision, `radialDimensionParams(shape, radius)` in `packages/core/constraints.js`: a circle gets `isDiameter` and value = 2 x radius, an arc stays a radius. `dimension-tool.js` and `circle-tool.js` take their params from it (the draw-time box now keeps the typed formula as typed: no `(x) / 2`). Two readers that took a radial value as the radius now read a diameter (`constraint-manager.js` EQUAL conflict check, `live-dimension-input.js` sandbox check: BUG-146). Saved designs with a circle Radius dimension are read as stored (no migration). `tool-ops.js` (the template recipe builder) keeps its radius dimensions on purpose. Fusion's right-click Radius/Diameter toggle was NOT added (needs hunks in `input-manager.js` / `dimension-seams.js`, files in other seats' hands).
- **Task id(s):** `1000`, `1000B`, `1003` (audit), `1008` (fix)
- **Fix merge sha:** pending (`agents/dimpicks-1008`)
- **Guarding test file(s):** `tests/dimpicks-1008-node.test.js` (1a-1g), `tests/dimpicks-1008-live.test.js`; updated `tests/creation-boxes.test.js`, `tests/live-box-names-876-node.test.js`, `tests/harness/coverage/inventory.js`
- **Status:** fixed
- **Family:** `ui-input`
- **Related:** BUG-146

### BUG-141
- **Date / turn:** 2026-11-26 (audit `D-8`, task 1003 -> fixed in task 1008)
- **Reported by:** worker (`1003`, Dimension tool focused audit)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (Design tab, desktop & phone)
- **Report:** `"Audit D-8: circle and arc rims cannot be picked as 1st or 2nd pick for point-circle, line-circle, circle-circle distances; clicking a rim drops a radius or a line length instead."`
- **What was wrong:** A circle / arc rim was never a pick for a distance: point then rim, rim then point, line then rim, rim then line, rim then rim all made the circle's own size dimension (or a line length) instead of the distance.
- **Cause:** `dimension-tool.js` only upgraded a line's length preview (line / point second pick); a circle's size preview and a pending point pick had no second-pick path for a rim (a non-line shape just superseded the pending point).
- **Fix:** In `packages/ui/input-handlers/dimension-tool.js`: `upgradeRadialToDistance` (a circle's / arc's size preview + a point, line or other rim = the distance from its CENTRE), a pending point + a rim (Case B2), a line preview + a rim (2b2); all end in the shared creators `createPointPointDimension` (extracted from the point-to-point case, now the ONE creation) and `createPointLineDimension`. Centre distances only (no tangent distance; unverified vs Fusion). A point that is the circle's own centre / rim, or a second click on its own rim, is still the circle's own dimension / a drop. Behaviour change: a click on a point, line or another rim while a circle's size is being placed now starts that distance instead of dropping the label there.
- **Task id(s):** `1003` (audit), `1008` (fix)
- **Fix merge sha:** pending (`agents/dimpicks-1008`)
- **Guarding test file(s):** `tests/dimpicks-1008-node.test.js` (item 2), `tests/dimpicks-1008-live.test.js`; `tests/dimension-1004-node.test.js` D-5b comments updated
- **Status:** fixed
- **Family:** `ui-input`
- **Related:** BUG-140

### BUG-142
- **Date / turn:** 2026-11-26 (audit `D-10`, task 1003 -> fixed in task 1008)
- **Reported by:** worker (`1003`, Dimension tool focused audit)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (Design tab, desktop & phone)
- **Report:** `"Audit D-10: existing dimension labels cannot be dragged while the Dimension tool is active; near a line on phone the press can start a duplicate dimension."`
- **What was wrong:** In the Dimension tool a single press on an existing label did nothing (it fell through to the shape under it, which could start a new dimension); the label could only be moved in the Select tool.
- **Cause:** `dimension-tool.js` ended the label branch with a comment ("let the selection tool handle dragging") and no drag; the drag start existed only inline in `selection-tools.js`.
- **Fix:** `startDimensionLabelDrag` (exported from `dimension-tool.js`) is the ONE start of a label press-drag; `selection-tools.js` now calls it too (its inline copy removed) and the Dimension tool's press on a label starts it (not while a dimension is being placed: its own label is under the pointer and the press drops it). Pattern labels still have no drag. One undo step per drag (`dragDimensionLabel`).
- **Task id(s):** `1003` (audit), `1008` (fix)
- **Fix merge sha:** pending (`agents/dimpicks-1008`)
- **Guarding test file(s):** `tests/dimpicks-1008-node.test.js` (item 3), `tests/dimpicks-1008-live.test.js` (desktop mouse + phone touch)
- **Status:** fixed
- **Family:** `ui-input`

### BUG-143
- **Date / turn:** 2026-11-26 (audit `D-13`, task 1003 -> fixed in task 1008)
- **Reported by:** worker (`1003`, Dimension tool focused audit; extends `B-13`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (Design tab)
- **Report:** `"Audit D-13: a circle with only a Reference radius dimension behaves differently when clicked in the Dimension tool than a circle with no dimension; a reference dimension blocks adding a driving one."`
- **What was wrong:** Clicking a circle that carried only a Reference dimension re-offered that reference (the created one was refused as a duplicate and the tool grabbed the last constraint in the list); no new driving dimension could be placed.
- **Cause:** `hasConstraint` (`packages/core/constraints.js`, DISTANCE radial duplicate check) counted any radial dimension on the shape as a duplicate, and `hasDrivingDistanceForShape` (`dimension-tool.js`) counted a reference as "driving".
- **Fix:** A reference radial dimension no longer blocks a new driving one (`hasConstraint`), and `hasDrivingDistanceForShape` ignores references: a circle with only a reference behaves like a circle with none (a new driving Diameter is placed; the reference stays). Not changed (found, not asked): a circle that already has a DRIVING dimension still re-offers it by the last-constraint fallback in `startShapeDimension`.
- **Task id(s):** `1003` (audit), `1008` (fix)
- **Fix merge sha:** pending (`agents/dimpicks-1008`)
- **Guarding test file(s):** `tests/dimpicks-1008-node.test.js` (item 4)
- **Status:** fixed
- **Family:** `ui-input`
- **Related:** BUG-140

### BUG-144
- **Date / turn:** 2026-11-26 (audit `D-14`, task 1003 -> fixed in task 1008)
- **Reported by:** worker (`1003`, values & driven-ness audit)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (Design tab)
- **Report:** `"Audit D-14: while editing a value, clicking a Reference dimension inserts its name, so a formula can depend on a reference (then fails with 'd3 is a reference dimension')."`
- **What was wrong:** Clicking a Reference dimension's label in the value box inserted its name (`d1 + d3`); the formula was then refused by the parser only after the insert.
- **Cause:** `handleOutsidePress` (`packages/ui/numeric-input-manager.js`) inserted the name of any clicked dimension other than the one being edited.
- **Fix:** `refusesReferenceName(dim)` in `numeric-input-manager.js`: a click on a Reference dimension inserts nothing and the hint under the box says "dN is a reference dimension: a formula cannot use it" (both the edit box and the draw-time boxes go through the same branch). A driving dimension still inserts. (Fusion's rule is unverified.)
- **Task id(s):** `1003` (audit), `1008` (fix)
- **Fix merge sha:** pending (`agents/dimpicks-1008`)
- **Guarding test file(s):** `tests/dimpicks-1008-node.test.js` (item 5)
- **Status:** fixed
- **Family:** `ui-input`

### BUG-145
- **Date / turn:** 2026-11-26 (audit `D-15`, task 1003 -> fixed in task 1008)
- **Reported by:** worker (`1003`, values & driven-ness audit)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (Design tab)
- **Report:** `"Audit D-15: Tab in the dimension edit box leaves it without saving what was typed (box stays open, value unchanged)."`
- **What was wrong:** Typing a value and pressing Tab moved focus out of the box and committed nothing.
- **Cause:** The single-input `keydown` handler (`packages/ui/numeric-input-manager.js`) handled Enter and Escape only.
- **Fix:** In the dimension EDIT box Tab commits exactly as Enter (same `handleCommit`, one undo step) and keeps focus (`preventDefault`). The autocomplete list still takes Tab first when open; the draw-time single boxes and the two-field boxes are unchanged. (Fusion: Tab moves to the next field after committing; unverified.)
- **Task id(s):** `1003` (audit), `1008` (fix)
- **Fix merge sha:** pending (`agents/dimpicks-1008`)
- **Guarding test file(s):** `tests/dimpicks-1008-node.test.js` (item 6)
- **Status:** fixed
- **Family:** `ui-input`

### BUG-146
- **Date / turn:** 2026-11-26 (found by task 1008 while making circles Diameter dimensions)
- **Reported by:** worker (`1008`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (Design tab)
- **Report:** `"EQUAL between a circle with a Diameter dimension (40) and a circle with a Radius dimension (20) was refused as 'conflicting fixed dimensions (40.0 vs 20.0)'; the live-dimension sandbox compared a diameter edit with the radius."`
- **What was wrong:** Two readers took a radial dimension's value as the radius even when it is a diameter (`isDiameter`, already true for the Slot width): the EQUAL conflict check and the live-dimension sandbox error.
- **Cause:** `ConstraintManager.validateParams` EQUAL `getDriving` returned `c.value`; `live-dimension-input.js` `validateWithSandbox` measured `s.radius` against the edit value.
- **Fix:** Both read the radius (`c.value / 2`) / the diameter (`radius * 2`) when `c.isDiameter`.
- **Task id(s):** `1008`
- **Fix merge sha:** pending (`agents/dimpicks-1008`)
- **Guarding test file(s):** `tests/dimpicks-1008-node.test.js` (1g)
- **Status:** fixed
- **Family:** `solver`
- **Related:** BUG-140

### BUG-147
- **Date / turn:** 2026-11-26 (found by task 1008 merge check: `tests/coverage-matrix.test.js` after merging main)
- **Reported by:** advisor / clerical merge agent (1008)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (Design tab)
- **Report:** `"Clicking a dimensioned arc, then a line, silently deleted the arc's radius."`
- **What was wrong:** With the new rim picks (BUG-141), a placement's second pick spliced out the dimension being placed; when the first pick had created nothing (the arc / circle already has a driving dimension) that dimension was the EXISTING radius.
- **Cause:** `startShapeDimension` (`dimension-tool.js`) falls back to `state.constraints[last]` when `createConstraint` refuses, then stamped it as born in this placement (`finalizeDimBirth`), and `discardPlacingLength` spliced any placing dimension out.
- **Fix:** `discardPlacingLength` discards only a dimension born in the placement (`__newlyPlaced === true`, the rule of `resetDimensionState`'s Esc); `startShapeDimension` no longer stamps a re-offered existing dimension as born (and drops the birth snapshot). Tab in a reference dimension's read-only `view` box closes it like Enter.
- **Open hazard (NOT fixed here, by ruling):** the `c = res || state.constraints[last]` fallback itself (in `startShapeDimension` and `createPointPointDimension`): when nothing is created, the LAST constraint of any kind is taken as the dimension; it is only the right one by luck. A circle that already has a driving dimension re-offers whatever constraint is last.
- **Task id(s):** `1008`
- **Fix merge sha:** pending (`agents/dimpicks-1008`)
- **Guarding test file(s):** `tests/dimpicks-1008-node.test.js` (7, 8)
- **Status:** fixed (fallback hazard open)
- **Family:** `ui-input`
- **Related:** BUG-141, BUG-143

---

### BUG-130
- **Date / turn:** 2026-11-26 (audit ID `D-9`; fixed in task `1010`)
- **Reported by:** audit `1003` (`V2.6.angleArrows`, `L1.visual.desktop`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `D-9`: both arrowheads of an angle dimension point 90 degrees off (radial instead of along the arc).
- **What was wrong:** The two arrow polygons of every angle dimension were built with their base spread along the tangent and set back along the radial, so each arrowhead pointed along the radius (`dotRadial=+-1, dotTangent=0`).
- **Cause:** `packages/ui/svg-renderer.js` (angle dimension, 'Draw Arrows'): the tangent and radial vectors were swapped in the two `<polygon>` strings; now one `arcArrow` helper builds both (tip on the arc end, base one arrow length back along the arc).
- **Task id(s):** `1010`
- **Fix merge sha:** open (`agents/display-1010`, awaiting merge)
- **Guarding test file(s):** `tests/angle-arrows-d9-node.test.js`, `tests/dim-visuals-d9-d12-d16-live.test.js` (desktop + phone)
- **Status:** fixed
- **Family:** `dimension-display`
- **History:** found in `1003` (`D-9`) -> fixed in task `1010`

---

### BUG-131
- **Date / turn:** 2026-11-26 (audit ID `D-12`; investigated in task `1010`)
- **Reported by:** audit `1003` (`V2.6.radiusLeader`, `L1.visual.desktop`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `D-12`: the radius dimension's leader line runs into / under its own `R 18` text (`leaderCrossesText: true`).
- **What was wrong:** nothing found. The probe's `leaderCrossesText` compares the leader's bounding box with the bounding box of the ROTATED text, which overlap for any diagonal leader that ends next to the text. Against the text's real rotated box (it sits above its baseline point by the font ascent, `dim-placement.js placeDimText`) the leader ends `DIM_TEXT_GAP_PX` (3 px) clear of it: node run `leader end vs the text box: along=-0.000 across=-0.456 half box 0.746 x 0.271; clear by 0.185 world units`, phone and desktop live runs clear by 0.46 / 1.51 world units. Task 636's `tests/radius-diameter-label-beside-leader.test.js` already asserts that gap.
- **Cause:** none (audit false positive). A first attempt that stopped the leader at the text box was reverted: it left the leader touching the box and broke the task 636 / 448 tests for no visible gain.
- **Task id(s):** `1010`
- **Fix merge sha:** none (no code change)
- **Guarding test file(s):** `tests/radius-leader-d12-node.test.js` and `tests/dim-visuals-d9-d12-d16-live.test.js` (pin: the leader ends outside the text's real box; they pass before and after)
- **Status:** not reproduced
- **Family:** `dimension-display`
- **History:** reported in `1003` (`D-12`) -> not reproduced in task `1010`

---

### BUG-132
- **Date / turn:** 2026-11-26 (audit ID `D-16`; fixed in task `1010`)
- **Reported by:** audit `1003` (`L1.visual.desktop`, `svg-renderer.js:2701,2751,2813`, `hover-manager.js:38-48`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `D-16`: a narrow dimension label such as `5` (6 x 15 px) has a tiny hover / click area.
- **What was wrong:** `dimLabelAt` tested the pointer against the label's exact drawn box only, so a 6 px wide value was almost impossible to hit, most of all with a finger.
- **Cause:** `packages/ui/hover-manager.js` `dimLabelAt`: no minimum hit size. It now grows every label's box to at least `DIM_LABEL_MIN_HIT_PX` (24 px) either way; hover, click, double-click edit and touch all go through this one function.
- **Task id(s):** `1010`
- **Fix merge sha:** open (`agents/display-1010`, awaiting merge)
- **Guarding test file(s):** `tests/dim-label-hit-d16-node.test.js`, `tests/dim-visuals-d9-d12-d16-live.test.js` (desktop hover + phone tap, Shaper)
- **Status:** fixed
- **Family:** `dimension-display`
- **History:** found in `1003` (`D-16`) -> fixed in task `1010`

---

### BUG-133
- **Date / turn:** 2026-11-26 (audit ID `UX-20`; fixed in task `1010`)
- **Reported by:** audit `1000` (`DR3.0`, `L3.desktop`, `L3.phone`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `UX-20`: an over-constrained triangle (sides 50 / 40 / 120) shows no conflict colour: L1 black, L2/L3 blue, no conflict class.
- **What was wrong:** The renderer coloured geometry only by DOF (free blue / fully rigid black / locked); a constraint the solver could not satisfy changed nothing on the canvas.
- **Cause:** `packages/ui/svg-renderer.js` shape colour rule had no conflict state. The app has no geometry conflict colour of its own; its conflict red is `--sk-error` (the over-constrained notice, the Design panel's failing-constraint rows), so geometry bound by an unsatisfied constraint is now drawn `var(--sk-error, #ef4444)` (`CONFLICT_COLOR`). The set comes from one new helper, `unsatisfiedConstraints` in `packages/core/constraint-verifier.js` (the solver's own `conflicts` rule: non-driven, residual above `VERIFIER_TOLERANCE`), mapped to shapes with `constraintTargets`. Hover and selection colours still win; the Clean display profile (no status colours) is unchanged.
- **Task id(s):** `1010`
- **Fix merge sha:** open (`agents/display-1010`, awaiting merge)
- **Guarding test file(s):** `tests/conflict-colour-ux20-node.test.js`
- **Status:** fixed
- **Family:** `dimension-display`
- **History:** found in `1000` (`UX-20`) -> fixed in task `1010`

---

### BUG-134
- **Date / turn:** 2026-11-26 (audit ID `B-20b`; fixed in task `1010`)
- **Reported by:** audit `1000B` (`1b FIXED-ENDPOINTS BEZIER`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `B-20b`: a Bezier with both end points fixed turns black ("fully constrained") although its two control points still move.
- **What was wrong:** `analyzeConstraintStatus` decided a shape is fixed / constrained from its joints alone; a Bezier's joints are its two ends only, its control points `c1` / `c2` are plain shape data (shapes.js) that no constraint or lock holds.
- **Cause:** `packages/core/constraint-status.js` shape loop: a bezier is now treated like a circle with a free radius (`radiusFree`), so it never enters `fixedShapes` / `constrainedShapes`. Nothing can fix a Bezier's control points today, so there is no case in which it is black.
- **Task id(s):** `1010`
- **Fix merge sha:** open (`agents/display-1010`, awaiting merge)
- **Guarding test file(s):** `tests/bezier-fixed-ends-b20b-node.test.js`
- **Status:** fixed
- **Family:** `solver`
- **History:** found in `1000B` (`B-20b`) -> fixed in task `1010`. Behaviour change: a Bezier on a locked sketch (every end joint fixed) is drawn in the free blue instead of the locked colour.

---

### BUG-135
- **Date / turn:** 2026-11-26 (audit IDs `UX-29`, `D-26`; fixed in task `1010`)
- **Reported by:** audits `1000` (`D1.4`, `D1.6`), `1003` (`V2.3.bad.d2 * 2`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `UX-29`: typing `d1 * 2` into `d1` shows the bare hint `d1 -> d1` (one item, nothing to cycle).
- **What was wrong:** The cycle refusal's message was the raw path joined with `->`; for a name that reads itself the path is the same name twice.
- **Cause:** `packages/core/parameters.js` `cycleError`: a one-item cycle now reads `d1 refers to itself`; a loop through several names still shows its path (`d1 -> d2 -> d1`).
- **Task id(s):** `1010`
- **Fix merge sha:** open (`agents/display-1010`, awaiting merge)
- **Guarding test file(s):** `tests/cycle-hint-ux29-node.test.js`
- **Status:** fixed
- **Family:** `ui-input`
- **History:** found in `1000` (`UX-29`), `1003` (`D-26`) -> fixed in task `1010` (one-item case only; the multi-name path text is unchanged, existing tests assert it)

---

### BUG-136
- **Date / turn:** 2026-11-26 (audit ID `B-20c`; fixed in task `1010`)
- **Reported by:** audit `1000B` (F7, `snap-detection.js:187`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `B-20c`: `JOINT_PRIORITY_RADIUS = 15` is not scaled by the touch boost, so on a phone a line under the finger beats a point 15-30 px away.
- **What was wrong:** Every other snap reach of `findSnap` grows by `snapBoostFor(isTouch)` (task 562); the joint-over-line priority radius stayed 15 px.
- **Cause:** `packages/ui/snap-detection.js` `findSnap`: `JOINT_PRIORITY_RADIUS = 15` -> `15 * boost` (30 px for a touch); the header comment lists it with the other scaled reaches.
- **Task id(s):** `1010`
- **Fix merge sha:** none (B-20c reverted in task `1010`)
- **Guarding test file(s):** none yet
- **Status:** open
- **Family:** `snap-not-applied`
- **History:** found in `1000B` (`B-20c`); a fix (`15 * boost`) was tried in task `1010` and REVERTED by the advisor: needs a touch design, a flat 30 px point priority breaks line picks near endpoints (coincident-868-live, offset-fusion-match-667-live, pattern-params-694-live, toast-done-689-live fail with it). Task `1020` (BUG-210) narrowed WHICH points get the 15 px priority: an end of a curve or a point on the curve under the pointer keeps it, and a point that ends no curve and lies beside that curve competes on distance. The radius itself and its touch scaling are unchanged: still open.

---

### BUG-137
- **Date / turn:** 2026-11-26 (audit IDs `UX-27`, `B-18b`; fixed in task `1010`)
- **Reported by:** audits `1000` (`IR4.3`), `1000B` (`P5-B`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `UX-27` / `B-18b`: an arc has no midpoint snap (a line has one); hovering the middle of an arc gives a plain `shape` snap.
- **What was wrong:** `findSnap` offered a midpoint candidate for lines only; and `applySnapConstraint` / `previewSnapConstraint` would have built a line-style Midpoint on an arc's first two joints (centre, start).
- **Cause:** `packages/ui/snap-detection.js` `findSnap`: the line's midpoint-or-shape rule is now one closure (`offerMidpointOrShape`) used by lines and arcs; an arc offers `arcSweepMidpoint` (the middle of its drawn sweep). `packages/core/snap-constraints.js` midpoint apply / preview: an arc target gives the arc form `{ joint, shape }` (task 875's Midpoint on an arc).
- **Task id(s):** `1010`
- **Fix merge sha:** open (`agents/display-1010`, awaiting merge)
- **Guarding test file(s):** `tests/arc-midpoint-snap-ux27-node.test.js`, `tests/snap-display-1010-live.test.js` (desktop + phone: hover the arc's midpoint with the Line tool)
- **Status:** fixed
- **Family:** `snap-not-applied`
- **History:** found in `1000` (`UX-27`), `1000B` (`B-18b`) -> fixed in task `1010`. Behaviour change: every tool that uses `findSnap` now offers the midpoint of an arc, as of a line (hover marker, and the point gets a Midpoint constraint on a click / drop).

---

### BUG-138
- **Date / turn:** 2026-11-26 (audit ID `B-18a`; fixed in task `1010`)
- **Reported by:** audit `1000B` (`P5-A`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `B-18a`: the snap preview shows the midpoint of a line but a rectangle corner dragged to it ends elsewhere.
- **What was wrong:** The drag loop pulled the dragged point to a locked snap only for `joint`, `line`, `shape`, `grid` and axis snaps; a `midpoint` snap was previewed (and its constraint added on release) but never used as the point's position while dragging. Measured before the fix: the corner sat at (0.0568, 3.9470) instead of the previewed midpoint (0, 4).
- **Cause:** `packages/ui/input-handlers/selection-tools.js` (drag step, the snap-point whitelist): `midpoint` was missing for a CLUSTER drag (a corner of coincident joints), which infers nothing (task 584) so has no other way to reach the midpoint; added for that drag type only (a single-joint drag gets the midpoint from findInference, unchanged (tests/drag-attached-inference-node.test.js)). The cluster now sits exactly on the previewed point, and the release applies that same snap.
- **Task id(s):** `1010`
- **Fix merge sha:** open (`agents/display-1010`, awaiting merge)
- **Guarding test file(s):** `tests/drag-midpoint-snap-b18a-node.test.js`, `tests/snap-display-1010-live.test.js` (desktop: a joint dragged to a line midpoint is at (0, 8) during the drag and after release)
- **Status:** fixed
- **Family:** `snap-not-applied`
- **History:** found in `1000B` (`B-18a`) -> fixed in task `1010`

---

### BUG-150
- **Date / turn:** 2026-11-26 (audit ID `UX-12`; fixed in task `1011`)
- **Reported by:** audit `1000` (`DR2.3`) and `1000B` cross-review
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `UX-12`: dragging a fully-constrained (0-DOF) item moves nothing and records no undo step, but wipes `state.redoStack` (`1 -> 0`).
- **What was wrong:** `ensureDragUndo` called `state.saveState` on the first pointer move (which clears `redoStack` and evicts the oldest history entry at `maxHistory`), and `settleDragUndo` discarded the no-op snapshot on pointer-up without restoring `redoStack` or any evicted entry.
- **Cause:** `packages/ui/input-handlers/selection-tools.js` (`ensureDragUndo` / `settleDragUndo`): now saves `undoEvicted` and `undoRedo` before `saveState` and restores both plus `_notifyHistory()` when `settleDragUndo` discards a no-op snapshot (same pattern as `packages/core/dimension-seams.js`).
- **Task id(s):** `1011`
- **Fix merge sha:** open (`agents/drag-1011`, awaiting merge)
- **Guarding test file(s):** `tests/drag-noop-redo-ux12-1011-node.test.js`
- **Status:** fixed
- **Family:** `ui-input`
- **History:** found in `1000` (`UX-12`), confirmed in `1000B` -> fixed in task `1011`; task `1030` (BUG-322): the hand copy of the Redo branch in `settleDragUndo` is gone, the ONE rule in `packages/core/sketch-state.js` (`discardSnapshotAt` gives back the Redo its save cleared) covers the no-op drag; guard re-run: `drag-noop-redo-ux12-1011-node: ok`

### BUG-151
- **Date / turn:** 2026-11-26 (audit ID `UX-22`; fixed in task `1011`)
- **Reported by:** audit `1000` (`DR6.3a`) and `1000B` cross-review
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `UX-22`: selecting a fixed/locked item together with a free item and dragging freezes the free item (`max move 0`).
- **What was wrong:** `getDragDOF` returned `{ lockX: true, lockY: true }` for the entire group drag whenever ANY single selected joint was fixed or 0-DOF.
- **Cause:** `packages/ui/input-handlers/selection-tools.js` (`getDragDOF` / `pullDrag`): for a multi-selection group drag (`drag.group`), held/0-DOF members are excluded into `movable`; the drag locks only when every member is held (e.g. a full-locked user group or an all-fixed selection), axis locks apply only when every movable member is locked on that axis, and `pullDrag` pulls only `movable` joints.
- **Task id(s):** `1011`
- **Fix merge sha:** open (`agents/drag-1011`, awaiting merge)
- **Guarding test file(s):** `tests/drag-mixed-selection-ux22-1011-node.test.js`, `tests/chain-select-move-node.test.js` (section 2b updated from old all-locked rule)
- **Status:** fixed
- **Family:** `ui-input`
- **History:** found in `1000` (`UX-22`), confirmed in `1000B` -> fixed in task `1011`. Behaviour change: multi-selecting fixed and free geometry now moves the free items while fixed/0-DOF items stay put (previously the whole selection was locked).

### BUG-152
- **Date / turn:** 2026-11-26 (audit ID `UX-23`; fixed in task `1011`)
- **Reported by:** audit `1000` (`DR6.2a/b`) and `1000B` cross-review
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `UX-23`: a fast 1-step flick on a line's body skips sub-moves and stalls far behind an equivalent flick on its joint (`(56.89, 19.07)` vs `(-12.73, 58.63)`).
- **What was wrong:** Two causes: (1) `handleSelectionPointerMove` gated `MAX_DRAG_STEP` sub-moves on `state.joints.has(state.drag.id)`, which is always false for a body drag (`state.drag.id` is a shape ID); (2) `NewtonSolver.bodyDragTarget` projected `rank === 1` body drags onto the instantaneous linear tangent `f.dir`, discarding the off-tangent pull on curved 1-DOF motion (such as a rotating distance-constrained line).
- **Cause:** `packages/ui/input-handlers/selection-tools.js` (`handleSelectionPointerMove`): include `state.drag.body` in the `MAX_DRAG_STEP` sub-move check; `packages/core/solver/definitions.js` (`BODY_POINTS` / `RIM_POINT.projectRank1: true`) and `packages/core/solver/engine.js` (`bodyDragTarget`): restrict the `rank === 1` instantaneous tangent projection to rim drags (`kind.projectRank1`), so line body drags do not stall on curved 1-DOF motion while fixed-end arc tangential flings stay bounded.
- **Task id(s):** `1011`
- **Fix merge sha:** open (`agents/drag-1011`, awaiting merge)
- **Guarding test file(s):** `tests/drag-body-flick-ux23-1011-node.test.js`, `tests/drag-step-cap.test.js` (case 5 updated)
- **Status:** fixed
- **Family:** `solver`
- **History:** found in `1000` (`UX-23`), confirmed in `1000B` -> fixed in task `1011`. Behaviour change: body drags now step through `MAX_DRAG_STEP` sub-moves like joint drags and do not project curved 1-DOF body targets onto the instantaneous tangent.

### BUG-153
- **Date / turn:** 2026-11-26 (audit ID `UX-09`; fixed in task `1011`)
- **Reported by:** audit `1000` (`DR6.4a/b`) and `1000B` cross-review
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `UX-09`: when an arc centre `c` is coincident with a line endpoint `p`, dragging the point translates the arc rigidly (`r 30 -> 30`) or shrinks its radius (`r 30 -> 22.374`) depending on joint Map / z-order.
- **What was wrong:** `handleJointSelection` checked `s.joints[0] === hitJoint.id` instead of checking the coincident cluster, so hitting `p` omitted the arc's rim joints from `arcRims` / `carried`.
- **Cause:** `packages/ui/input-handlers/selection-tools.js` (`handleJointSelection`): changed `s.joints[0] === hitJoint.id` to `cluster.has(s.joints[0])` so dragging any joint coincident with an arc centre translates the arc rigidly (and pivots cleanly when one rim is held), consistent with Fusion (task 584).
- **Task id(s):** `1011`
- **Fix merge sha:** open (`agents/drag-1011`, awaiting merge)
- **Guarding test file(s):** `tests/drag-arc-centre-coincident-ux09-1011-node.test.js`
- **Status:** fixed
- **Family:** `ui-input`
- **History:** found in `1000` (`UX-09`), confirmed in `1000B` -> fixed in task `1011`

### BUG-154
- **Date / turn:** 2026-11-26 (audit IDs `UX-10`, `B-12d`; fixed in task `1011`)
- **Reported by:** audit `1000` (`DR4.3b`) and `1000B` (`6c`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `UX-10` / `B-12d`: dragging mirrored geometry rotates and translates a FREE mirror line (`ML m1 (0,-50) -> (8.135,-49.643)`).
- **What was wrong:** Dimension edits held free mirror lines via `solveGivingWay` (task 611), but interactive drags left free mirror-line endpoints as free solver unknowns, so least-change solves tilted/shifted the mirror line instead of moving only the mirrored pair.
- **Cause:** `packages/core/solver/engine.js` (`NewtonSolver.solve` / `_mirrorLineDragHolds`): during any active drag (`dragOpt` or `j.dragTarget`), temporarily holds every free driving `symmetric` constraint's mirror-line endpoints (restored in `finally`) unless the mirror line itself is being dragged (by its body, an endpoint, or a joint coincident with an endpoint).
- **Task id(s):** `1011`
- **Fix merge sha:** open (`agents/drag-1011`, awaiting merge)
- **Guarding test file(s):** `tests/drag-mirror-line-stay-ux10-1011-node.test.js`
- **Status:** fixed
- **Family:** `solver`
- **History:** found in `1000` (`UX-10`) and `1000B` (`B-12d`) -> fixed in task `1011`. Behaviour change: dragging mirrored geometry keeps a free mirror line stationary; dragging the mirror line itself still moves it freely.

---

### BUG-160
- **Date / turn:** 2026-11-26 (audit IDs `UX-06`, `B-1`; fixed in task `1012`)
- **Reported by:** audits `1000` (`IR2.1.C1`) & `1000B` (`1a`, `LIVE-1`, `LIVE-P2-1`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab, desktop & phone)
- **Report:** `UX-06` / `B-1`: Lock (`F` / ribbon / context menu) on a circle reported `locked: true` and switched the menu to `"Unlock"`, yet the circle stayed blue (1 DOF) and its rim dragged freely (`r: 20 -> 40.026`).
- **What was wrong:** `toggleFixedSelection` only set `j.fixed = true` on `s.joints` (a circle's centre joint), leaving its scalar `radius` unknown free in the solver, while `selectionLockState` checked only joints and falsely reported `locked: true` (including on origin-centred circles with free radii).
- **Cause:** No unified lock declaration for scalar-radius circles (`packages/core/lock-state.js`), `hasRadiusUnknown` in `packages/core/solver/engine.js` did not exclude `s.fixed`, `cachedFreedom` in `packages/core/constraint-status.js` did not include `s.fixed` in its cache key, and `input-manager.js` / `svg-renderer.js` only checked `s.joints`.
- **Fix:** Added single source of truth `packages/core/lock-state.js` (`isJointLocked`, `isScalarRadiusCircle`, `shapeLockJoints`, `isShapeLocked`, `lockTargets`); `toggleFixedSelection` / `selectionLockState` (`packages/ui/input-manager.js`) lock/unlock both centre and `circle.fixed` in one undo step; `packages/core/solver/engine.js` (`hasRadiusUnknown`, `_sizeTerm`, constant-radius `distance`/`equal`) and `packages/core/solver/definitions.js` treat locked circle radii as constants; `packages/core/constraint-status.js` includes `s.fixed` in `cachedFreedom`; `packages/ui/svg-renderer.js` renders locked circles in `LOCKED_LINE_COLOR` via `isShapeLocked`. Also verified Arc lock keeps centre, radius, and endpoints fixed.
- **Task id(s):** `1012`
- **Fix merge sha:** pending (`agents/lock-1012`)
- **Guarding test file(s):** `tests/lock-1012-node.test.js`, `tests/lock-1012-live.test.js`
- **Status:** fixed
- **Family:** `solver`
- **Related:** BUG-123, BUG-161
- **History:** found in `1000` (`UX-06`) & `1000B` (`B-1`) -> undo step added in `1006` (`BUG-123`) -> circle radius lock + single source of truth fixed in `1012`

### BUG-161
- **Date / turn:** 2026-11-26 (audit ID `UX-26`; fixed in task `1012`)
- **Reported by:** audit `1000` (`S1.1`) & `1000B` cross-exam (`UX-26`); originally noted in task `524`
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab, desktop & phone)
- **Report:** `UX-26`: after filleting two locked lines `L1`, `L2`, `L1` stayed in `fixedShapes` (0 DOF), yet `selectionLockState(L1)` returned `{ has: true, locked: false }` and the context menu falsely offered `"Lock"` instead of `"Unlock"`.
- **What was wrong:** `applyFillet` replaced each locked line's corner joint with an unlocked tangent joint (`jTA`, `jTB`, kept unlocked so the fillet radius stays editable) while keeping the locked corner as `arc.filletSharp` held on each line via `pointOnLine`; both `selectionLockState` and `svg-renderer.js` checked only `s.joints.every(j => j.fixed)` and missed the locked virtual sharp.
- **Cause:** `packages/ui/input-manager.js` (`selectionLockState`, `toggleFixedSelection`) and `packages/ui/svg-renderer.js` each checked raw `s.joints` separately instead of sharing one lock predicate.
- **Fix:** Unified lock state in `packages/core/lock-state.js` (`shapeLockJoints` resolves an unlocked fillet tangent end to its fillet's locked virtual sharp `arc.filletSharp` when held on the shape by `pointOnLine`), shared by `selectionLockState`, `toggleFixedSelection`, and `svg-renderer.js`. Filleted locked lines stay locked & green (`LOCKED_LINE_COLOR`), the fillet arc stays unlocked & constrained-black, fillet radius edits continue to work, and Unlock/Undo operate cleanly in one step.
- **Task id(s):** `1012`
- **Fix merge sha:** pending (`agents/lock-1012`)
- **Guarding test file(s):** `tests/lock-1012-node.test.js`, `tests/lock-1012-live.test.js`
- **Status:** fixed
- **Family:** `ui-input`
- **Related:** BUG-123, BUG-160
- **History:** noted in task `524` -> logged in `1000` (`UX-26`) & confirmed in `1000B` cross-exam -> fixed in `1012`

---

### BUG-170
- **Date / turn:** 2026-11-26 (audit ID `UX-21`; fixed in task `1014`)
- **Reported by:** audits `1000` (`C1.13`), `1000B` (`CROSS UX-21`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `UX-21`: one conflicted triangle `(50, 40, 120)` blocks adding `Horizontal` (or driving dimensions) on unrelated free line `L4` with `"Sketch geometry over constrained"`.
- **What was wrong:** `ConstraintManager._sandboxVerify` judged global `engine.solve().error` across every disconnected component, and `createConstraint` checked global `_solveRes.converged === false` / `mangled` against every constraint in the sketch.
- **Cause:** `packages/core/constraint-manager.js`: added `_componentConstraints` (reusing `creation-placement.js` `constraintOperands`) so `_sandboxVerify` evaluates only the candidate constraint's connected component (and relative deltas against baseline), and `createConstraint` checks `unsatisfiedConstraints` restricted to `created` and newly-violated constraints (`!unsatisfiedBefore.has(oc)`).
- **Task id(s):** `1014`
- **Fix merge sha:** open (`agents/misc-1014`, awaiting merge)
- **Guarding test file(s):** `tests/constraint-logic-1014-node.test.js`
- **Status:** fixed
- **Family:** `solver`
- **History:** found in `1000` (`C1.13`), `1000B` -> fixed in task `1014`. Probe `CROSS UX-20 & UX-21` before: `l4HorizontalBlocked=true`, `[overconstrained]`; after: `l4HorizontalBlocked=false`, `l4Toasts=[]`.

---

### BUG-171
- **Date / turn:** 2026-11-26 (audit ID `UX-02`; fixed in task `1014`)
- **Reported by:** audits `1000` (`D7.1`, `L1`), `1003` (`V2.3.rect500to4`), `1000B` (`CROSS UX-02`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `UX-02`: shrinking a `500 x 40` rectangle's width `d1` to `4 mm` is falsely refused with `"Can't set to 4 — 4.00 would collapse a line to a point. Reverted."`.
- **What was wrong:** `findCollapsedShape` exempted the dimensioned side `L1` (`a-b`) but judged the opposite side `L3` (`c-d`) by `COLLAPSE_RATIO = 0.01` alone (`4 < 500 * 0.01 = 5`).
- **Cause:** `packages/core/constraint-verifier.js` (`findCollapsedShape`): separated length/radius/chord check `fellSize` (`now[k] < Math.min(COLLAPSE_ABS_SIZE, was[k] * COLLAPSE_RATIO)` with `COLLAPSE_ABS_SIZE = 0.02` mm) from angular sweep ratio `fellAngle`, so only a genuine collapse toward zero (`< 0.02 mm`) is refused while valid large shrink edits like `500 -> 4 mm` succeed.
- **Task id(s):** `1014`
- **Fix merge sha:** open (`agents/misc-1014`, awaiting merge)
- **Guarding test file(s):** `tests/constraint-logic-1014-node.test.js`
- **Status:** fixed
- **Family:** `solver`
- **History:** found in `1000` (`UX-02`), `1003`, `1000B` -> fixed in task `1014`. Probe `CROSS UX-02` before: `valAfter4=500`, `would collapse a line to a point`; after: `valAfter4=4`, `t4=[]`.

---

### BUG-172
- **Date / turn:** 2026-11-26 (audit ID `B-11`; fixed in task `1014`)
- **Reported by:** audits `1000B` (`F2`), `CROSS-1000` (`XB-11`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `B-11`: Coincident on an arc and its own centre or endpoint silently adds a `pointOnLine` (`polCount: 1, toasts: []`), while a line refuses the same pick with `Sketch geometry over constrained`.
- **What was wrong:** `applyPointOnShape` only checked `shape.type === 'line' && shape.joints.some(j => cluster.has(j))`.
- **Cause:** `packages/ui/input-handlers/constraint-tools.js` (`applyPointOnShape`): removed the `shape.type === 'line' &&` filter so own-joint picks on arcs, circles, and lines alike hit the same `announceOverConstrained()` refusal.
- **Task id(s):** `1014`
- **Fix merge sha:** open (`agents/misc-1014`, awaiting merge)
- **Guarding test file(s):** `tests/constraint-logic-1014-node.test.js`
- **Status:** fixed
- **Family:** `ui-input`
- **History:** found in `1000B` (`B-11`), `CROSS-1000` (`XB-11`) -> fixed in task `1014`. Probe `XB-11` before: `arcOwn={"pol":1,"toasts":[]}`; after: `arcOwn={"pol":0,"toasts":["[overconstrained] Sketch geometry over constrained"]}`.

---

### BUG-173
- **Date / turn:** 2026-11-26 (audit ID `B-17`; fixed in task `1014`)
- **Reported by:** audits `1000B` (`P6`), `CROSS-1000` (`XB-17`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `B-17`: Tangent between same-tier `line:free` and `circle:sized` always moves the circle regardless of pick order (`WHO_MOVES['tangent-line-circle'].tie` is `"second"`).
- **What was wrong:** `handleTangentPointerDown` passed only `{ line: line.id, circle: circle.id }` (discarding `[s1.id, s2.id]` pick order), `constraints.js` dropped `shapes` when `{ line, circle }` were present, and `creation-placement.js` always read `[c.line, c.circle]` first.
- **Cause:** `packages/ui/input-handlers/constraint-tools.js` (`handleTangentPointerDown`) now passes `{ line, circle, shapes: [s1.id, s2.id] }`, `packages/core/constraints.js` preserves `shapes` on `TANGENT` `{ line, circle }` records, and `packages/core/creation-placement.js` (`tangent-line-circle`) reads `c.shapes` when present so same-tier ties move the second-picked shape per `WHO_MOVES`.
- **Task id(s):** `1014`
- **Fix merge sha:** open (`agents/misc-1014`, awaiting merge)
- **Guarding test file(s):** `tests/constraint-logic-1014-node.test.js`
- **Status:** fixed
- **Family:** `fusion-frame`
- **History:** recast by `CROSS-1000` (`B-17`: `free+free` always moves line like Fusion 200/200; same-tier `line:free + circle:sized` tie failed) -> fixed in task `1014`. Probe `XB-17.tie-lineFree-circleSized.C-then-L` before: `lineMoved=0, circleMoved=25`; after: `lineMoved=25, circleMoved=0`.

---

### BUG-174
- **Date / turn:** 2026-11-26 (audit ID `B-16`; fixed in task `1014`)
- **Reported by:** audits `1000B` (`P5`), `CROSS-1000` (`XB-16`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `B-16`: double-clicking a pattern's label in the Dimension tool opens `#dimInput` instead of the pattern values dialog (Select tool's behavior).
- **What was wrong:** `dimensionPointerDown` omitted the `isPatternConstraint(constraint)` check that `selection-tools.js` has on `.dim-label` double-click.
- **Cause:** `packages/ui/input-handlers/dimension-tool.js` (`dimensionPointerDown`) now dispatches `isPatternConstraint(constraint)` double-clicks to `editPatternFromLabel(svg, state, constraint)` (same as Select) and consumes non-placing pattern-label presses; `packages/ui/svg-renderer.js` (`patternLabels`) also uses `pointer` cursor in Dimension tool.
- **Task id(s):** `1014`
- **Fix merge sha:** open (`agents/misc-1014`, awaiting merge)
- **Guarding test file(s):** `tests/constraint-logic-1014-node.test.js`
- **Status:** fixed
- **Family:** `ui-input`
- **History:** found in `1000B` (`B-16`), `CROSS-1000` (`XB-16`) -> fixed in task `1014`. Probe `XB-16` before: `dimInputOpened=true`; after: `dimInputOpened=false` (opens pattern values dialog).

---

### BUG-180
- **Date / turn:** 2026-11-26 (audit ID `UX-17`; fixed in task `1013`)
- **Reported by:** audits `1000` (`IR8.1a/b/c`, `IR8.4`, `D1.1/D1.2`), `CROSS-1000B` (`UX-17`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `UX-17`: draw-time value boxes diverge from the dimension edit box: (a) typing `w = 50` in the Line draw-time box is refused with the self-contradictory hint `"=" only as  name = value  at the start` while the edit box accepts it; (b) typing `-5` or `0` keeps draw-time boxes open with inline `#dimHint` while the edit box closes and discards typed text with a toast; (c) `#dimComplete` autocomplete works in the edit box but not in draw-time boxes.
- **What was wrong:** `evaluateBoxText` called `parseInput(text, { allowAssign: false })`, `expression.js` emitted `"=" only as name = value at the start` even when `allowAssign` was `false`, `previewDimensionInput` omitted the value-domain check (`dimensionValueRefusal`, so `-5`/`0` fell through to `commitDimensionEdits` + toast + `hideInput`), and `numeric-input-manager.js` gated `#dimComplete` completion strictly on `mode === 'edit'` and `singleInput`.
- **Cause:** ONE shared parse/validate/autocomplete path: `packages/core/parameters.js` exports `dimensionValueRefusal` (used by `previewDimensionInput`, `evaluateBoxText`, and `commitDimensionEdits`), `evaluateBoxText` supports `name = expr` (dimension naming + O4 user-param update) with `expression.js` reporting `"=" is not allowed here` when `allowAssign: false`, `packages/ui/parameter-completion.js` accepts a dynamic input getter, and `packages/ui/numeric-input-manager.js` binds the ONE `#dimComplete` list to `#dimInput`, `#dualInput` fields, and external Fillet/Offset boxes while passing `detail.names` / `detail.assigns` to drawing tools via `base-tool.js` (`liveName`, `liveAssign`, `applyLiveAssign`).
- **Task id(s):** `1013`
- **Fix merge sha:** open (`agents/boxes-1013`, awaiting merge)
- **Guarding test file(s):** `tests/boxes-parity-ux17-1013-node.test.js`, `tests/boxes-parity-ux17-1013-live.test.js`
- **Status:** fixed
- **Family:** `ui-input`
- **History:** found in `1000` (`UX-17`) -> fixed in task `1013`. Probes before: `IR8.1b` `invalid=true, hint="\"=\" only as name = value at the start", shapes=1`, `D1.1/D1.2` `box closed toasts [...]`, `IR8.4` `draw-time box=false vs edit box=true`; after: `IR8.1b` `invalid=false, hint="", shapes=2`, `D1.1/D1.2` `box STAYS OPEN hint "a length must be more than 0" toasts []`, `IR8.4` `draw-time box=true vs edit box=true`.

---

### BUG-181
- **Date / turn:** 2026-11-26 (audit ID `UX-18`; fixed in task `1013`)
- **Reported by:** audits `1000` (`D8.1`, `D8.2`), `CROSS-1000B` (`UX-18`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `UX-18`: in an inch document (`DOC_UNIT = 'in'`), a refused dimension edit's warning toast prints raw internal millimetres (`"Can't set to 2540"` for `100 in`, `"-50.8"` for `-2 in`).
- **What was wrong:** `handleCommit` interpolated raw base-unit `pv.value` directly into `Can't set to ${pv.value} ... Reverted.`.
- **Cause:** `packages/ui/numeric-input-manager.js` (`handleCommit`): formats `pv.value` with `quantityText(pv.value, dimensionUnit(target, docUnit()), 'unit')`, using the existing document-unit formatter (decimal inches `"100 in"`, fractional `100"`, millimetres `"100 mm"`, degrees `"180 deg"`).
- **Task id(s):** `1013`
- **Fix merge sha:** open (`agents/boxes-1013`, awaiting merge)
- **Guarding test file(s):** `tests/refusal-units-ux18-1013-node.test.js`
- **Status:** fixed
- **Family:** `units`
- **History:** found in `1000` (`UX-18`) -> fixed in task `1013`. Probe `D8.1` before: `Can't set to 2540 — conflicts with distance. Reverted.`; after: `Can't set to 100 in — conflicts with distance. Reverted.`.

---

### BUG-182
- **Date / turn:** 2026-11-26 (audit ID `B-19b/c/e`; fixed in task `1013`)
- **Reported by:** audits `1000B` (`P9`), `CROSS-1000` (`XB-19b/c/e`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `B-19b/c/e`: draw-time and modify boxes drop or reject typed formulas: (b) Polygon `d1 / 2` evaluates once, drops the formula, and creates no radius dimension; (c) Slot `slot-c2c` / `slot-overall` drop span dim+formula and all slot modes drop width formula; (e) Fillet and Offset boxes call `parseUnit` and reject formulas like `d1 / 2`.
- **What was wrong:** `polygon-tool.js` never stored `radiusExpression` or created a driving radial `DISTANCE` constraint; `slot-tool.js` only created a span dim for `CENTER_POINT` and never stored `widthExpression` on `widthDim`; `fillet.js` / `offset.js` called `parseUnit` and accepted no `expression`/`name` options.
- **Cause:** `packages/ui/input-handlers/polygon-tool.js` creates a driving radial `DISTANCE` constraint carrying `expression`/`name`; `packages/ui/input-handlers/slot-tool.js` creates the typed span dim across all straight modes (`CENTER_TO_CENTER`, `OVERALL`, `CENTER_POINT`) + `CENTER_POINT_ARC` and preserves `widthExpression`/`widthName` on `widthDim`; `packages/core/fillet.js` (`evaluateFilletRadius`, `applyFillet`) and `packages/core/offset.js` (`evaluateOffsetDistance`, `applyOffset`) plus `fillet-tool.js` / `offset-tool.js` evaluate through `evaluateBoxText`, preserve `expression`/`name`, and attach `#dimComplete`. (`B-19a` skipped for task `1008`; `B-19d` is a separate divergence, not formula dropping.)
- **Task id(s):** `1013`
- **Fix merge sha:** open (`agents/boxes-1013`, awaiting merge)
- **Guarding test file(s):** `tests/formulas-draw-boxes-b19-1013-node.test.js`
- **Status:** fixed
- **Family:** `ui-input`
- **History:** found in `1000B` (`B-19`), `CROSS-1000` (`XB-19`) -> fixed in task `1013`. Probes before: `XB-19b` `distDims=[d1]`, `XB-19c.slot-c2c` `newDims=[{"val":"15","expr":null}]`, Fillet/Offset rejected `d1 / 2`; after: `XB-19b` `d2=30 expr="d1 / 2"`, `XB-19c.slot-c2c` `[{"val":"15","expr":"d1 / 4"},{"val":"30","expr":"d1 / 2"}]`, Fillet/Offset accept `d1 / 4` / `d1 / 6` and follow `d1`.

---

### BUG-183
- **Date / turn:** 2026-11-26 (audit ID `B-8`; fixed in task `1013`)
- **Reported by:** audits `1000B` (`P9`), `CROSS-1000` (`XB-8a/b`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `B-8`: Circle tool clicked with centre snapped onto an existing joint then committed via typed diameter + Enter drops the centre's `coincident` constraint (whereas click-2 keeps it); typing diameter + Enter without prior mouse move does nothing.
- **What was wrong:** `finalizeCircleFromActive` duplicated `handleCirclePointerUp`'s commit logic, omitted `applySnapConstraint(state, state.active.start, state.active.centerSnapTarget)`, and returned `false` whenever `state.active.preview` was `null`.
- **Cause:** `packages/ui/input-handlers/circle-tool.js` (`commitCircle`, `finalizeCircleFromActive`, `onPreview`): unified both click and Enter commits into ONE `commitCircle` helper that always applies `centerSnapTarget` and allows `finalizeCircleFromActive` to commit from `circleState.lockedRadius` when `previewPt` is `null` (while keeping the box open on Enter with no move and no typed diameter).
- **Task id(s):** `1013`
- **Fix merge sha:** open (`agents/boxes-1013`, awaiting merge)
- **Guarding test file(s):** `tests/circle-typed-snap-b8-1013-node.test.js`
- **Status:** fixed
- **Family:** `snap-not-applied`
- **History:** found in `1000B` (`B-8`), `CROSS-1000` (`XB-8`) -> fixed in task `1013`. Probes before: `XB-8a` `coincidentOnCenter=0`, `XB-8b` `created=false, stillActive=true`; after: `XB-8a` `coincidentOnCenter=1`, `XB-8b` `created=true, stillActive=false`.

---

### BUG-190
- **Date / turn:** 2026-11-26 (audit ID `R1-12` + owner ruling turn 3826; fixed in task `1018`)
- **Reported by:** audit `1016` (`design-run-audit-1016-partB.mjs` `B8`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `R1-12`: Trim refused a circle (`"Trim: not available on a circle (Trim cuts lines only)"`), so a keyway could not be cut into a bore. Owner ruling: Trim cuts circles and arcs and Break splits them, like Fusion: a circle trimmed between two cutters becomes an arc, an arc trimmed becomes a shorter arc.
- **What was wrong:** `trim.js` / `break.js` handled lines only, and task `1007` (BUG-093) declared a refusal for arcs and circles.
- **Cause:** no curve maths for arcs / circles: `packages/core/trim.js` and `packages/core/break.js` read lines only; `packages/core/curve-kinds.js` `CURVE_REFUSALS.arc` / `.circle` refused Trim / Break.
- **Fix:** ONE new module `packages/core/curve-cuts.js` declares a cuttable curve's geometry and parameter (line / CENTER arc / circle), `curveCuts` (where the active sketch's other lines, arcs and circles cross it), `boundsAround`, `heldJointsOn`. `trim.js` `trimPieceAt` (the piece a click removes; also the hover's `trimPreview`), `trimArc` (a leading / trailing piece moves the rim, an interior piece splits it into two arcs on the same centre), `trimCircle` (the circle becomes the remaining arc, the SAME shape id, `break.js` `circleToArc`); `break.js` `breakArc` (two arcs sharing the centre and the split point), `breakCircle` + `breakAt` (a circle splits between the two cut points around the click; fewer than two: the notice `CIRCLE_BREAK_REFUSAL`, nothing written). Kept pieces follow the 1007 rules: each cut end bound to its cutter (`applySnapConstraint` / `onShapeSnap`), each arc piece its own structural equal, constraints on removed rims through `removeGeometry`; `splitArcConstraints` moves point-on-curve / tangent constraints to the piece they sit on and drops an arc midpoint. A circle's DIAMETER dimension stays on the arc, as a diameter (the record is unchanged; Fusion keeps the dimension on the trimmed arc: unverified). `CURVE_REFUSALS` keeps only the Bezier (its text now says "lines, arcs and circles"). UI: `trim-tool.js` / `break-tool.js` pick the nearest line, arc or circle (`curveDistance`) and draw core's piece / points (their line-only copies of the interval maths removed).
- **Task id(s):** `1018`
- **Fix merge sha:** open (`agents/trimcurves-1018`, awaiting merge)
- **Guarding test file(s):** `tests/trim-break-curves-r112-1018-node.test.js`, `tests/trim-break-curve-refusal-ux25-node.test.js` (Bezier only now)
- **Status:** fixed
- **Family:** `ui-input`
- **Related:** BUG-093, BUG-191
- **History:** found in `DESIGN-RUN-AUDIT-1016` (`R1-12`) -> owner ruling turn 3826 -> fixed in task `1018`. Probe before: `ROW R1-12 | Part B / B8 | BUG | Trim cannot trim circle/arc for keyway (hoverOverlay=false, toast="⚠️Trim: not available on a circle (Trim cuts lines only)")`.

---

### BUG-191
- **Date / turn:** 2026-11-26 (audit ID `R2-01`; fixed in task `1018`)
- **Reported by:** audit `1017` (`design-run-audit-1017-part-d.mjs` `D-05c`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `R2-01`: trimming the 15 mm stub of a gusset leg where the R 15 relief arc meets it deleted the WHOLE leg (both legs, with their dimensions).
- **What was wrong:** an arc was never a cutter, so the stub had no cut and the whole line was the clicked interval.
- **Cause:** `packages/core/trim.js:57` (before) skipped every cutter that was not a line (`other.type !== 'line'`).
- **Fix:** `packages/core/curve-cuts.js` `curveCuts` takes lines, arcs and circles as cutters (a carrier crossing counts only on both drawn curves); the cut end is bound to the arc (coincident with its rim where it meets it there, else point-on-curve). The leg's length dimension across the removed stub still goes (task 1007 rule, `trimmedPairs`).
- **Task id(s):** `1018`
- **Fix merge sha:** open (`agents/trimcurves-1018`, awaiting merge)
- **Guarding test file(s):** `tests/trim-curve-cutter-r201-1018-node.test.js`
- **Status:** fixed
- **Family:** `solver`
- **Related:** BUG-092, BUG-190
- **History:** found in `DESIGN-RUN-AUDIT-1017` (`R2-01`) -> fixed in task `1018`.

---

### BUG-192
- **Date / turn:** 2026-11-26 (audit ID `R2-03`; fixed in task `1018`)
- **Reported by:** audit `1017` (`design-run-audit-1017-part-c.mjs` `C-08b`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `R2-03`: trimming the tails of a mirrored pair of lines dropped their mirror: editing the angle 30 -> 45 turned one side only (`angR=45deg angL=142.06deg(expected 135deg)`).
- **What was wrong:** Mirror ties the copy by its two END pairs (point symmetric, Fusion's); Trim removed the tail ends and their pair went with them (THE delete rule), leaving the copy's direction free.
- **Cause:** `packages/core/trim.js` `keepLineConstraints` transferred only the orientation (H / V) before `removeGeometry` deleted the removed end's constraints.
- **Fix:** `packages/core/trim.js` `transferMirrorPairs` (called from `keepLineConstraints`, the one place): when a removed end's mirror pair names the end of another line whose OTHER end mirrors this line's kept end (the two lines were mirror images), the pair becomes the symmetric LINE form `{ shapes: [line, other], line }` (#core/symmetric.js: the infinite lines mirror; each segment keeps its own cut). A lone pair still goes, as before.
- **Task id(s):** `1018`
- **Fix merge sha:** open (`agents/trimcurves-1018`, awaiting merge)
- **Guarding test file(s):** `tests/trim-mirror-r203-1018-node.test.js`
- **Status:** fixed
- **Family:** `solver`
- **Related:** BUG-092
- **History:** found in `DESIGN-RUN-AUDIT-1017` (`R2-03`) -> fixed in task `1018`.

---

### BUG-193
- **Date / turn:** 2026-11-26 (audit ID `R2-05`; fixed in task `1018`)
- **Reported by:** audit `1017` (`design-run-audit-1017-extra.mjs` `E-02a/b`, `part-d.mjs` `D-10a`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `R2-05`: Break clicked on a hole's centre lying on the line made a new detached joint beside it (`(74.94, -50.04)` next to `(75, -50)`); dragging the break point slid it away from the hole.
- **What was wrong:** Break always minted a new joint at the click's projection.
- **Cause:** `packages/ui/input-handlers/break-tool.js` passed only `t` and `packages/core/break.js` `breakShape` always minted a joint.
- **Fix:** `packages/core/break.js` `breakAt` (the plan the tool's hover and press both read): a joint HELD on the curve (`curve-cuts.js` `heldJointsOn`: a point-on-line, a line midpoint `[a, b, m]`, an arc midpoint) within the joint pick radius (`SNAP.JOINT_PX`) of the click is the split point; `breakShape(state, id, t, { joint })` splits AT it (no new joint) and drops the constraint that held it on the curve (it is both pieces' end now); a line midpoint `[a, b, m]` stays (no geometry removed).
- **Task id(s):** `1018`
- **Fix merge sha:** open (`agents/trimcurves-1018`, awaiting merge)
- **Guarding test file(s):** `tests/break-at-joint-r205-1018-node.test.js`
- **Status:** fixed
- **Family:** `snap-not-applied`
- **Related:** BUG-091
- **History:** found in `DESIGN-RUN-AUDIT-1017` (`R2-05`) -> fixed in task `1018`.

---

### BUG-194
- **Date / turn:** 2026-11-26 (audit ID `R1-05`; fixed in task `1018`)
- **Reported by:** audit `1016` (`design-run-audit-1016-partA.mjs` `A15b/c`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `R1-05`: deleting a fillet arc left a 5 x 5 gap, and Fillet then refused the two lines (`"Curves must meet at a corner to fillet"`).
- **What was wrong:** a two-curve Fillet pick needed the curves to share a corner joint.
- **Cause:** `packages/core/fillet.js` `findCornerAtJoint` returned null unless exactly two curves touched the corner cluster.
- **Fix:** Fusion (unverified) keeps the lines cut back when the arc is deleted, and its Fillet takes two curves that do not touch and extends them: matched. `packages/core/fillet.js` `gapCorner` (from `findCornerAtJoint`, two-curve pick only): two LINES whose extensions meet at P beyond the ends nearest P (P inside neither segment, nothing else ending there) are a corner at P; a virtual sharp held on both lines at P (the deleted fillet's) is kept as the new fillet's (`applyFillet` `keptSharp`; its point-on-lines are not doubled).
- **Task id(s):** `1018`
- **Fix merge sha:** open (`agents/trimcurves-1018`, awaiting merge)
- **Guarding test file(s):** `tests/fillet-gap-r105-1018-node.test.js`
- **Status:** fixed
- **Family:** `ui-input`
- **History:** found in `DESIGN-RUN-AUDIT-1016` (`R1-05`) -> fixed in task `1018`.

---

### BUG-195
- **Date / turn:** 2026-11-26 (audit ID `R1-07`; fixed in task `1018`)
- **Reported by:** audit `1016` (`design-run-audit-1016-partA.mjs` `A18a`); root of `R1-01`, `R1-02`, `R1-03` (traced by task `1019`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `R1-07`: Save + Reload dropped a constraint (`cons 65 -> 64`): `pointOnLine(j9, ref_axis_y)`, the corner (0, -50) snapped on the Y axis, orphaned when the fillet replaced `j9`.
- **What was wrong:** the fillet deleted the corner joint and left a constraint naming it by its single `joint` field. Its solver residual was NaN, so every later edit that moved geometry was refused (BUG-196..BUG-198). A reload pruned it: `packages/core/document.js` `deserializeDocument` (task 589, `unknownJointOf`), which also cleans any older saved file already holding such an orphan.
- **Cause:** `packages/core/fillet.js` `applyFillet`, the "Update constraints referencing the corner joints" loop, relinked only constraints with a `joints` ARRAY.
- **Fix:** the same loop: a constraint naming the corner by `joint` (a point-on-line / point-on-curve, a midpoint) is relinked to the virtual sharp `jV`, like a measurement ("keeps meaning the sharp corner": the sharp stays on the axis; Fusion: unverified); a point-on-line of the corner on one of the two filleted lines is dropped (applyFillet makes V's own).
- **Task id(s):** `1018`
- **Fix merge sha:** open (`agents/trimcurves-1018`, awaiting merge)
- **Guarding test file(s):** `tests/fillet-corner-axis-r107-1018-node.test.js`
- **Status:** fixed
- **Family:** `solver`
- **Related:** BUG-196, BUG-197, BUG-198
- **History:** found in `DESIGN-RUN-AUDIT-1016` (`R1-07`) -> cause of R1-01..R1-03 traced by task `1019` -> fixed in task `1018`.

---

### BUG-196
- **Date / turn:** 2026-11-26 (audit ID `R1-01`; fixed in task `1018`)
- **Reported by:** audit `1016` (`A11a`, `A11c`, `A13`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `R1-01`: a point-to-line dimension from a sized circle (or a slot arc) to an edge or an axis refused every typed value (`"Can't set to 10 mm — conflicts with distance. Reverted."`).
- **What was wrong:** not the dimension itself: the filleted outline held BUG-195's orphaned point-on-line, whose NaN residual made the solver reject every step (task `1019`'s trace on the probe's documents).
- **Cause:** `packages/core/fillet.js` `applyFillet` (BUG-195).
- **Fix:** BUG-195's.
- **Task id(s):** `1018`
- **Fix merge sha:** open (`agents/trimcurves-1018`, awaiting merge)
- **Guarding test file(s):** `tests/fillet-corner-axis-r107-1018-node.test.js` (`R1-01` step)
- **Status:** fixed
- **Family:** `solver`
- **Related:** BUG-195
- **History:** found in `DESIGN-RUN-AUDIT-1016` (`R1-01`) -> cause traced by task `1019` -> fixed in task `1018`.

---

### BUG-197
- **Date / turn:** 2026-11-26 (audit ID `R1-02`; fixed in task `1018`)
- **Reported by:** audit `1016` (`A10b`, `A14`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `R1-02`: editing the overall width `d1` 80 -> 100 on the 6-fillet L-bracket was refused (`"Can't set to 100 mm — conflicts with distance. Reverted."`).
- **What was wrong:** not the dimension itself: the filleted outline held BUG-195's orphaned point-on-line, whose NaN residual made the solver reject every step (task `1019`'s trace on the probe's documents).
- **Cause:** `packages/core/fillet.js` `applyFillet` (BUG-195).
- **Fix:** BUG-195's.
- **Task id(s):** `1018`
- **Fix merge sha:** open (`agents/trimcurves-1018`, awaiting merge)
- **Guarding test file(s):** `tests/fillet-corner-axis-r107-1018-node.test.js` (`R1-02` step)
- **Status:** fixed
- **Family:** `solver`
- **Related:** BUG-195
- **History:** found in `DESIGN-RUN-AUDIT-1016` (`R1-02`) -> cause traced by task `1019` -> fixed in task `1018`.

---

### BUG-198
- **Date / turn:** 2026-11-26 (audit ID `R1-03`; fixed in task `1018`)
- **Reported by:** audit `1016` (`A16`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `R1-03`: moving Hole 1 by its horizontal dimension `d12` 10 -> 15 was refused (`"Can't set to 15 mm — conflicts with distance. Reverted."`).
- **What was wrong:** not the dimension itself: the filleted outline held BUG-195's orphaned point-on-line, whose NaN residual made the solver reject every step (task `1019`'s trace on the probe's documents).
- **Cause:** `packages/core/fillet.js` `applyFillet` (BUG-195).
- **Fix:** BUG-195's.
- **Task id(s):** `1018`
- **Fix merge sha:** open (`agents/trimcurves-1018`, awaiting merge)
- **Guarding test file(s):** `tests/fillet-corner-axis-r107-1018-node.test.js` (`R1-03` step)
- **Status:** fixed
- **Family:** `solver`
- **Related:** BUG-195
- **History:** found in `DESIGN-RUN-AUDIT-1016` (`R1-03`) -> cause traced by task `1019` -> fixed in task `1018`.

---

### BUG-199
- **Date / turn:** 2026-11-26 (audit ID `R2-13`; recorded in task `1018`)
- **Reported by:** audit `1017` (`design-run-audit-1017-extra.mjs` `E-02c`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `R2-13`: no Join / Merge command to reunite two collinear pieces after Break.
- **What was wrong:** nothing to fix: Fusion has no Join either (unverified); owner: record only, don't build.
- **Cause:** none (Fusion parity).
- **Task id(s):** `1018` (record only)
- **Fix merge sha:** none
- **Guarding test file(s):** none
- **Status:** parked (Fusion parity: no Join)
- **Family:** `ui-input`
- **History:** found in `DESIGN-RUN-AUDIT-1017` (`R2-13`) -> recorded, not built, task `1018`.

---

### BUG-220
- **Date / turn:** 2026-11-26 (real-design audit `R2-04`)
- **Reported by:** worker (audits 1016 / 1017, Gemini Neon seat)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (Design tab)
- **Report:** "Line draw-time box: a typed length or formula + Enter drops the Horizontal/Vertical inference."
- **What was wrong:** Typing only a length cleared the inferred H / V, so the segment stayed free to rotate.
- **Cause:** `line-tool.js` `redrawLinePreview` and the pointer-move branch cleared `activeInference` whenever ANY size was typed (`hasLock()`), also when only `lockedLength` was set; a stale inference also survived a committed segment.
- **Fix:** Only a typed ANGLE clears the inference; a typed length runs along the inferred (or cursor) direction (`redrawLinePreview`, `handleLinePointerMove`); both commit paths clear `activeInference` so the next segment infers afresh.
- **Task id(s):** `1021` (audit `R2-04`)
- **Fix merge sha:** pending (`agents/toolux-1021`)
- **Guarding test file(s):** `tests/toolux-1021-node.test.js`
- **Status:** fixed
- **Family:** `ui-input`

### BUG-221
- **Date / turn:** 2026-11-26 (real-design audit `R1-08`)
- **Reported by:** worker (audits 1016 / 1017, Gemini Neon seat)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (Design tab)
- **Report:** "Slot: a typed span drops the horizontal inference."
- **What was wrong:** A slot drawn along an axis never got a Horizontal / Vertical constraint, typed span or clicked (the Slot tool had no inference at all).
- **Cause:** `slot-tool.js` had no inference code (R1-08 as reported was wrong: it was not dropped, it never existed).
- **Fix:** ADVISOR-APPROVED behaviour change: the straight slot's centreline infers H / V through the Line tool's `findInference` (`spanInference` / `resolveSpanEnd`, one place) and applies it through the Line tool's ONE `applyLineInference` (factored out of its two duplicated commit blocks). Clicked and typed spans alike. Fusion expectation (unverified).
- **Task id(s):** `1021` (audit `R1-08`)
- **Fix merge sha:** pending (`agents/toolux-1021`)
- **Guarding test file(s):** `tests/toolux-1021-node.test.js`
- **Status:** fixed
- **Family:** `ui-input`

### BUG-222
- **Date / turn:** 2026-11-26 (real-design audit `R2-06`)
- **Reported by:** worker (audits 1016 / 1017, Gemini Neon seat)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (Design tab)
- **Report:** "Offset: clicking to choose the side moves focus to the canvas, so typing the distance + Enter does nothing."
- **What was wrong:** After the side click the distance box was no longer focused; the typed 8 + Enter was swallowed by the canvas.
- **Cause:** `offset-tool.js` `handleOffsetPointerUp` set the side but never gave the focus back to the box (the press focuses `#svgCanvas`).
- **Fix:** `handleOffsetPointerUp` refocuses and selects the box after `setSide`.
- **Task id(s):** `1021` (audit `R2-06`)
- **Fix merge sha:** pending (`agents/toolux-1021`)
- **Guarding test file(s):** `tests/toolux-1021-node.test.js`
- **Status:** fixed
- **Family:** `ui-input`

### BUG-223
- **Date / turn:** 2026-11-26 (real-design audit `R2-07` + `R1-09`)
- **Reported by:** worker (audits 1016 / 1017, Gemini Neon seat)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (Design tab)
- **Report:** "Offset and Fillet need TWO Esc presses to leave the tool."
- **What was wrong:** The first Esc only closed the box / pending pick and stayed in the tool.
- **Cause:** `handleOffsetKeyDown` / `handleFilletKeyDown` and the boxes' own Esc handlers cancelled their session and swallowed the key, so the shared `handleEscape` (which leaves to Select) never ran. Owner ruling BUG-105 (Fusion verified live 2026-11-26): ONE Esc cancels and leaves.
- **Fix:** The per-tool Esc handlers are removed; the box Esc raises `liveDimensionCancelled` and `input-manager.js` runs the shared `handleEscape` for Offset and Fillet (the path of the drawing tools), which resets both tools and returns to Select through `switchToTool` / `leaveActiveTool`.
- **Task id(s):** `1021` (audit `R2-07` + `R1-09`)
- **Fix merge sha:** pending (`agents/toolux-1021`)
- **Guarding test file(s):** `tests/toolux-1021-node.test.js`
- **Status:** fixed
- **Family:** `ui-input`
- **Related:** BUG-105

### BUG-224
- **Date / turn:** 2026-11-26 (real-design audit `R2-10`)
- **Reported by:** worker (audits 1016 / 1017, Gemini Neon seat)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (Design tab)
- **Report:** "Parameters window: the `ref` badge is squeezed into 3 stacked letters."
- **What was wrong:** On a reference row the badge was crushed to one character wide.
- **Cause:** `.pt-ref` (`parameter-table.js`) lacked the `flex: 0 0 auto; white-space: nowrap` that `.pt-fx` has, so the 100%-wide Name input squeezed it.
- **Fix:** `.pt-ref` gets `flex: 0 0 auto; white-space: nowrap`.
- **Task id(s):** `1021` (audit `R2-10`)
- **Fix merge sha:** pending (`agents/toolux-1021`)
- **Guarding test file(s):** `tests/toolux-1021-node.test.js`
- **Status:** fixed
- **Family:** `layout-overlap`

### BUG-225
- **Date / turn:** 2026-11-26 (real-design audit `R2-11`)
- **Reported by:** worker (audits 1016 / 1017, Gemini Neon seat)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (Design tab)
- **Report:** "Reference radius / diameter labels read `R (15)` / `Ø (5)`."
- **What was wrong:** The parentheses wrapped only the number.
- **Cause:** `svg-renderer.js` `constraintValueText` wrapped the number in `(...)` before prepending `R ` / `Ø `.
- **Fix:** The whole label is wrapped: `(R 15)` / `(Ø 5)`.
- **Task id(s):** `1021` (audit `R2-11`)
- **Fix merge sha:** pending (`agents/toolux-1021`)
- **Guarding test file(s):** `tests/toolux-1021-node.test.js`
- **Status:** fixed
- **Family:** `dimension-display`

### BUG-226
- **Date / turn:** 2026-11-26 (real-design audit `R1-15` + `R1-11`)
- **Reported by:** worker (audits 1016 / 1017, Gemini Neon seat)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (Design tab)
- **Report:** "Auto-placed labels pile up: concentric circles' Ø labels all at 0 degrees; d1 30 mm away; a hole's leader runs into the slot."
- **What was wrong:** A dimension born with no placement of its own always took the one fixed offset (30) and angle 0.
- **Cause:** `constraints.js` `createConstraint` gave every distance `offset: SolverConfig.DIMENSION_OFFSET` and the renderer angle 0, whatever was already there.
- **Fix:** `defaultLabelPlacement` (`dim-label.js`, called once from `ConstraintManager.createConstraint` for a distance born without a placement): a circle's Ø label sits just outside its rim at the first of 0, +-45, +-90 ... degrees that keeps 40 degrees from the other diameter labels round the same centre, is 12 mm from every other label and whose leader touches no other shape; a linear label takes an offset of 0.2 x its length (10..30), stepped out until clear. Dimensions with a placement (the Dimension tool) are untouched. Live screenshots: see WORK-LOG TURN 1021.
- **Task id(s):** `1021` (audit `R1-15` + `R1-11`)
- **Fix merge sha:** pending (`agents/toolux-1021`)
- **Guarding test file(s):** `tests/toolux-1021-node.test.js`
- **Status:** fixed
- **Family:** `layout-overlap`

### BUG-227
- **Date / turn:** 2026-11-26 (real-design audit `R1-16`)
- **Reported by:** worker (audits 1016 / 1017, Gemini Neon seat)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (Design tab)
- **Report:** "Parameters `+ Add`: the Unit can't be changed after creation, and a mm parameter in the Circular Pattern Quantity says 'a plain number cannot be a length' (backwards)."
- **What was wrong:** A count made as mm had to be deleted and re-made; the refusal read backwards.
- **Cause:** The Unit cell of a user row was text; `expression.js` evaluate (target `none`) said `a plain number cannot be <kind>`.
- **Fix:** New `setUnit` change in `parameters.js` `planChange` (`planTableEdit` column `unit`; the row's Unit cell is a select): the same kind keeps the value (mm -> cm); a typed number changing kind keeps its NUMBER (6 mm -> 6); a formula asks to be retyped; an in-use parameter changing kind is refused naming the dimensions that read it and what they would read. The evaluator says `needs a plain number, not a length` and a count box prefixes its label: `Quantity needs a plain number, not a length`.
- **Task id(s):** `1021` (audit `R1-16`)
- **Fix merge sha:** pending (`agents/toolux-1021`)
- **Guarding test file(s):** `tests/toolux-1021-node.test.js`
- **Status:** fixed
- **Family:** `notice-wording`

### BUG-228
- **Date / turn:** 2026-11-26 (real-design audit `R1-17`)
- **Reported by:** worker (audits 1016 / 1017, Gemini Neon seat)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (Design tab)
- **Report:** "The construction toggle shortcut should be X like Fusion, not K."
- **What was wrong:** Construction was K; X (Fusion's) was Coincident.
- **Cause:** Divergence from Fusion (`shortcuts.js`).
- **Fix:** OWNER RULING (turn 3830): `sketch.construction` = X; `tool.coincident` has NO default key (ribbon only; a key can still be set in Settings > Shortcuts). Tooltip and docs updated.
- **Task id(s):** `1021` (audit `R1-17`)
- **Fix merge sha:** pending (`agents/toolux-1021`)
- **Guarding test file(s):** `tests/toolux-1021-node.test.js`
- **Status:** fixed
- **Family:** `ui-input`

### BUG-240
- **Date / turn:** 2026-11-26 (advisor turn ~3790)
- **Reported by:** advisor, live Fusion check (audit ids `B-12b` / `EA-4`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** Dragging a short free arc's end past its start makes our arc wrap the long way round.
- **What was wrong:** Fusion (verified live 2026-11-26: a free 10° arc, end dragged past its start, stays short at 6.97°, centre and radius re-solve) keeps the arc short; ours wraps.
- **Cause:** unknown
- **Task id(s):** unknown
- **Fix merge sha:** none
- **Guarding test file(s):** none yet
- **Status:** open
- **Related:** `SOLVER-UX-AUDIT-1000B.md` B-12b
- **History:** found by the advisor in a live Fusion comparison; not yet assigned.

---
### BUG-241
- **Date / turn:** 2026-11-26 (advisor review of task 1008)
- **Reported by:** advisor, code review
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `startShapeDimension` (packages/ui/input-handlers/dimension-tool.js) falls back to `c = res || state.constraints[last]` when nothing was created, so the code can treat an unrelated existing constraint as the new dimension.
- **What was wrong:** Task 1008 guards the discard path (only `__newlyPlaced` dims are removed), but the fallback itself still returns an arbitrary last constraint.
- **Cause:** unknown
- **Task id(s):** unknown
- **Fix merge sha:** none
- **Guarding test file(s):** none yet
- **Status:** open
- **Related:** BUG-147
- **History:** found in review of task 1008; the 1008 guard limits the damage, the fallback remains.

---
### BUG-242
- **Date / turn:** 2026-11-26 (advisor live Fusion check, turn ~3790)
- **Reported by:** advisor, live Fusion check
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** A circle's Ø dimension: Fusion draws a full-width leader across the circle and offers a right-click Radius/Diameter switch; ours draws a one-sided leader and has no switch.
- **What was wrong:** Display and menu differ from Fusion (task 1008 made circles Ø but left these two out).
- **Cause:** unknown
- **Task id(s):** unknown
- **Fix merge sha:** none
- **Guarding test file(s):** none yet
- **Status:** open
- **Related:** BUG-140..147 (task 1008)
- **History:** found in the advisor's live Fusion check; left out of task 1008 by scope.

---
### BUG-243
- **Date / turn:** 2026-11-26 (merge gates)
- **Reported by:** advisor, merge gate
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `tests/ui-fixes-774-live.test.js` fails intermittently under gate load and passes alone.
- **What was wrong:** NOT only a flaky test: a real UI bug. Hovering a Settings row's "i" near its edge opened the hint, the hint grew the panel, and the panel (centred by translate(-50%,-50%)) shifted, so the "i" slid from under the resting pointer: pointerleave closed the hint, the panel shrank, pointerenter reopened it (a ~16 ms flicker loop) and a click missed (no pin). The test's `.sk-hint:not([hidden])` read then hit null (`Cannot read properties of null (reading 'textContent')`).
- **Cause:** `.sk-style-panel` in packages/ui/style-panel.js re-centred itself vertically whenever its content grew.
- **Task id(s):** 1029 (fix: the panel is centred once on open and keeps that top; max-height min(82vh, room below the top), it scrolls inside)
- **Fix merge sha:** (pending merge of agents/flaky774-1029)
- **Guarding test file(s):** tests/settings-hint-stays-put-1029-live.test.js (desktop 1280x800 and phone 390; fails without the fix), tests/ui-fixes-774-live.test.js
- **Status:** fixed
- **Related:** unknown
- **History:** seen in several merge gates on 2026-11-26.

---
### BUG-244
- **Date / turn:** 2026-11-26 (merge gate of task 1008)
- **Reported by:** advisor, merge gate
- **App(s) & host:** Shaper
- **Report:** `tests/op-paths-817-live.test.js` (already `// gate: exclusive`) fails its "no main-thread long task over 100 ms" check at 101-107 ms, even when run alone (1 pass / 1 fail on rerun).
- **What was wrong:** A timing limit at the edge of what the machine does under the shared CPU lock's other projects; it turned one merge gate red.
- **Cause:** unknown
- **Task id(s):** unknown
- **Fix merge sha:** none
- **Guarding test file(s):** none yet
- **Status:** open
- **Related:** unknown
- **History:** seen in the 1004, 1006, 1007 and 1008 merge gates.

---
### BUG-245
- **Date / turn:** 2026-11-26 (audit `UX-20`, advisor watch)
- **Reported by:** audit `1000` (UX-20), advisor
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** A dimension flashes red (conflict colour) for a frame mid-drag when nothing conflicts.
- **What was wrong:** Task 1010 changed the conflict colour token but the mid-drag flash itself was not confirmed fixed.
- **Cause:** unknown
- **Task id(s):** unknown
- **Fix merge sha:** none
- **Guarding test file(s):** none yet
- **Status:** open
- **Related:** `SOLVER-UX-AUDIT-1000.md` UX-20, BUG-130..138
- **History:** kept open to watch after task 1010.

---

### BUG-200
- **Date / turn:** 2026-11-26 (audit ID `R1-04`; fixed in task `1019`)
- **Reported by:** audit `1016` (`R1-04`, Part A `A11b`, `A12`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `R1-04`: a 2nd orthogonal point-point dimension (Vertical `Origin -> Hole 1` after Horizontal `d12 = 10`; Vertical `(50,-30) -> Hole 2` after aligned `d15 = 10`) is born `[ref]` while the point can still move (`nullity = 1`). Fusion places it driving (`bracket.json` `hole x` + `hole y`).
- **What was wrong:** the rank test (`isDimensionDetermined`) answers right (`d13 vertical redundant false`); two other demotions overrode it at birth.
- **Cause:** (1) `packages/ui/input-handlers/dimension-tool.js` (finalize placement and `anchorPlacingDimension`): a legacy "both joints fixed" sandbox read `analyzeConstraintStatus` WITH the new dimension in it (so its last free point read fixed), then solved an ALIGNED test distance at the H / V value, which cannot hold, and forced the dimension driven (`ERR-DIM-02`). (2) `packages/core/dim-label.js` `updateConstraintOffset`: the same-edge `hasConflict` reference flag was sticky during placement, so a pointer passing through the mode of the pair's driving dimension on its way to another mode left the new dimension a reference.
- **Fix:** both sandbox blocks removed: the ONE rank test (`numeric-input-manager.js` `showEditInput` -> `isDimensionDetermined`) decides at birth. A dimension born in the placement keeps only ConstraintManager's decision (it carries `drivenReason`); `hasConflict` follows the current mode.
- **Task id(s):** `1019`
- **Fix merge sha:** open (`agents/dimsolve-1019`, awaiting merge)
- **Guarding test file(s):** `tests/dimsolve-1019-node.test.js` (`R1-04a`, `R1-04b`, `R1-04c`); `tests/notices-1001-node.test.js` (fixed joints: now `ERR-DRIVEN-02`)
- **Status:** fixed
- **Family:** `ui-input`
- **Related:** BUG-120..126 (task 1006 birth rule)
- **History:** found in audit `1016` -> fixed in task `1019`. Probe before: `ROW R1-04 | ... | BUG | 2nd orthogonal point-to-point dim born [ref] while Y free (A11b d13Ref=true nullity=1; A12 d16Ref=true)`. After: `ROW R1-04 | Part A / A11b,A12 | OK | ... (A11b d13Ref=false nullity=1; A12 d16Ref=false)`.

---
### BUG-201
- **Date / turn:** 2026-11-26 (audit ID `R2-02`; fixed in task `1019`)
- **Reported by:** audit `1017` (`R2-02`, `E-01a`, `E-01b`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `R2-02`: a reference dimension `(80)` placed beside an edge's driving `80` is lost by one Undo + Redo (`["80","(80)"] -> ["80"] -> ["80"]`), and on undo-all + redo-all.
- **What was wrong:** undo / redo (`sketch-state.js` `_restoreSnapshot`) and loading a file (`document.js` `deserializeDocument`) rebuilt each constraint through `addConstraintObject` -> `addConstraint` -> `hasConstraint`, which took the reference for a duplicate and dropped it.
- **Cause:** the restore paths applied CREATION's duplicate rule: `hasConstraint` (`packages/core/constraints.js`, DISTANCE, joint form) ignores `isDriven`, and two references of one edge are alike, so a reference beside the driving dimension, or a second reference, was dropped as a duplicate.
- **Fix:** ONE `restoreConstraintObject` in `packages/core/constraints.js` (addConstraintObject's validation: createConstraint's fields, the coincident expansion, a missing name; NO duplicate check), called by `sketch-state.js` `_restoreSnapshot` and `cancelUndoGroup` and `document.js` `deserializeDocument`: what was saved comes back exactly. Creation (addConstraintObject, ConstraintManager, paste, mirror) keeps its duplicate check. Behaviour change: a file that holds a real duplicate (two driving distances on one pair) now loads both instead of silently dropping the second; equal values solve, different ones show as a conflict.
- **Task id(s):** `1019`
- **Fix merge sha:** open (`agents/dimsolve-1019`, awaiting merge)
- **Guarding test file(s):** `tests/dimsolve-1019-node.test.js` (`R2-02a` undo + redo, `R2-02b` undo of a later step, `R2-02c` save + reload, `R2-02d` a second reference, `R2-02 behaviour change` a file with a duplicate driving distance)
- **Status:** fixed
- **Family:** `solver`
- **History:** found in audit `1017` -> fixed in task `1019`. Probe before: `ROW E-01a.autoRefUndoRedo | afterPlace=["80","(80)"] ... afterRedo=["80"]`. After: `ROW E-01a.autoRefUndoRedo | ... afterRedo=["80","(80)"]`, `ROW E-01b.singleUndoAutoRef | before=["80","(80)","(80)"] after1Undo=["80","(80)"] after1Redo=["80","(80)","(80)"]`.

### BUG-210
- **Date / turn:** 2026-11-27 (real-design audits `R2-09` + `R1-14`)
- **Reported by:** worker (audits 1016 / 1017, Gemini Neon seat)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (Design tab)
- **Report:** "Equal on a small circle (Ø5, r ~ 10 px) picks its centre point instead of its rim (C2 stays 4.92); Circular Pattern on an Ø8 bolt hole's rim picks the centre joint ('1 selected', patterning a bare point)."
- **What was wrong:** A click on a small circle's rim went to the circle's centre point, also in a tool that takes no point (Equal, Tangent, Parallel, Perpendicular, Collinear).
- **Cause:** `packages/ui/snap-detection.js` `findSnap`: (1) it searched points for every tool, even one that takes none; (2) `JOINT_PRIORITY_RADIUS = 15` gave ANY point within 15 px priority over the nearer curve under the pointer, a circle's own centre included.
- **Fix:** ONE pick filter in `findSnap`. Its new `picks` argument is what the active tool takes, and `points: false` means a point is never the pick. It is declared once, from `CONSTRAINT_PRESELECT` (`constraint-tools.js` `constraintToolPicks`), and passed by both callers of the pick, the click (`input-manager.js` `toolSnap`) and the hover (`hover-manager.js` `updateHover`). The 15 px priority stays for a point that ENDS a curve (a line's or arc's end) or lies ON the curve under the pointer. A point that ends no curve (a circle or arc centre, a virtual sharp, a lone point, the origin) and lies beside that curve competes on plain distance (advisor ruling, option C).
- **Task id(s):** `1020`
- **Fix merge sha:** pending (`agents/picks-1020`)
- **Guarding test file(s):** `tests/picks-1020-node.test.js` (`BUG-210 R2-09 Equal takes no point`, `BUG-210 R1-14 pattern rim, not centre`), `tests/picks-1020-live.test.js` (desktop + phone), `tests/bezier-pick-762-node.test.js` (digest rewritten: only centre / lone point / origin cells changed)
- **Status:** fixed
- **Family:** `snap-not-applied`
- **Related:** BUG-136 (open: the touch scaling of the same radius; this fix only narrows WHICH points get it)
- **History:** found in audits `1016` / `1017` -> fixed in task `1020`. Probe before: `ROW D-06c.smallCircleRimBug | at vw~310 Equal(C1 r=2.5, C2): C2.r=4.92 (expected 2.5) toasts=[]`, `ROW R1-14 | Part B / B6a | BUG | Circular Pattern at flange zoom picked bolt center joint instead of Ø8 rim ("1 selected") ...`. After: `ROW D-06c.smallCircleRimBug | at vw~310 Equal(C1 r=2.5, C2): C2.r=2.5 (expected 2.5) toasts=[]`, `ROW R1-14 | Part B / B6a | OK | ...`.

### BUG-211
- **Date / turn:** 2026-11-27 (real-design audit `R1-14b`)
- **Reported by:** worker (audit 1016, Gemini Neon seat)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (Design tab)
- **Report:** "Esc out of Circular Pattern leaves its mistaken joint selected, so reopening the tool starts with '1 selected'."
- **What was wrong:** The pattern dialog's picks ARE the selection, and Cancel left them there, so they became the next session's objects.
- **Cause:** `packages/ui/input-handlers/pattern-tool.js` `cancelSession` undid the live pattern but left `state.selectedShapes` / `state.selectedJoints` as the session had made them.
- **Fix:** `cancelSession` gives back the selection the session began with (`selectionBefore`, taken in `beginPattern` and `editPatternFromLabel`). A pre-selection made before the tool survives Cancel, and a pick made inside the dialog does not.
- **Task id(s):** `1020`
- **Fix merge sha:** pending (`agents/picks-1020`)
- **Guarding test file(s):** `tests/picks-1020-node.test.js` (`BUG-211 R1-14b Esc clears the pattern picks`)
- **Status:** fixed
- **Family:** `ui-input`
- **History:** found in audit `1016` -> fixed in task `1020`. Probe after: `ROW R1-14 | Part B / B6a | OK | ... Esc leaked selection into reopened dialog ("Select")`.

### BUG-212
- **Date / turn:** 2026-11-27 (real-design audit `R1-06`)
- **Reported by:** worker (audit 1016, Gemini Neon seat)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (Design tab)
- **Report:** "Clicking an R5 fillet arc at normal desktop zoom selects the virtual sharp next to it. Delete then removes the overall dimensions d1 and d4, and the arc stays."
- **What was wrong:** The fillet's virtual sharp, 2 mm (6.8 px) beside the arc's middle, won the click over the arc under the pointer.
- **Cause:** `packages/ui/snap-detection.js` `findSnap` `JOINT_PRIORITY_RADIUS = 15`: the same cause as BUG-210 (a point that ends no curve took the priority over the curve under the pointer).
- **Fix:** the BUG-210 point priority (one place). Should deleting a virtual sharp ever delete dims? Yes: a virtual sharp is a point, and deleting a point deletes the dimensions on it, as for any point (Fusion: deleting a sketch point deletes its dimensions, unverified). The bug was the pick, not the delete.
- **Task id(s):** `1020`
- **Fix merge sha:** pending (`agents/picks-1020`)
- **Guarding test file(s):** `tests/picks-1020-node.test.js` (`BUG-212 R1-06 fillet arc, not virtual sharp`)
- **Status:** fixed (the virtual-sharp steal). In the real bracket the arc's middle is still covered by its tangent glyph: BUG-215.
- **Family:** `snap-not-applied`
- **Led to:** BUG-215
- **History:** found in audit `1016` -> fixed in task `1020`. Probe before: `ROW R1-06 | Part A / A15a | BUG | ... Delete removed ["d1","d4"] while arc survived=true`. After: `ROW R1-06 | Part A / A15a | OK | ... Delete removed [] while arc survived=true` (tangent count 16 -> 15: the glyph was hit, BUG-215).

### BUG-213
- **Date / turn:** 2026-11-27 (real-design audit `R2-08`)
- **Reported by:** worker (audit 1017, Gemini Neon seat)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (Design tab)
- **Report:** "Where a construction line and a solid curve overlap, the click hits the wrong one with no feedback: Tangent on an arc apex over the Y centreline ('not two lines'); Equal on construction pieces over the hypotenuse ('Pick a second curve, a different one.'); Collinear on the broken halves; Break at (90, -60) split the construction line."
- **What was wrong:** Between overlapping curves, the shapes' order decided the pick: a later curve had to be strictly nearer.
- **Cause:** `packages/ui/snap-detection.js` `findSnap` (the shape loop's "dist + 2 < best" rule) and `packages/ui/input-handlers/break-tool.js` `findClosestLine` (its own picker, `d < bestDist`): neither had a rule for a tie.
- **Fix:** ONE overlap rule, `snap-detection.js` `pickRank` + `OVERLAP_PX` (3 px). Among curves whose hits lie within 3 px of the nearest one, the winner is first a curve the tool takes, then one it has not already picked for this constraint (`picks.picked`), then a solid curve over a construction line or a reference axis. `findSnap` (`pickShape`) applies it, and Break's `findClosestLine` reuses the same exported rank to break its distance ties. Where all the overlapping curves have the same rank, the pick is exactly as before.
- **Task id(s):** `1020`
- **Fix merge sha:** pending (`agents/picks-1020`)
- **Guarding test file(s):** `tests/picks-1020-node.test.js` (`BUG-213 R2-08a`..`R2-08d`), `tests/picks-1020-live.test.js` (Tangent apex, desktop + phone)
- **Status:** fixed
- **Family:** `snap-not-applied`
- **Related:** BUG-216 (no Select Other: a first click aimed at a construction piece lying on a solid line takes the solid line)
- **History:** found in audit `1017` -> fixed in task `1020`. Probe before: `ROW C-09b.apexHitBug | ... toasts=["[warning] ⚠️Tangent takes a line and a circle or arc, or two circles / arcs (not two lines)."]`, `ROW D-10c.afterRejoin | ... toasts=["[warning] ⚠️Pick a second line, a different one."]`. After: `ROW C-09b.apexHitBug | ... tool=tool-tangent toasts=[]`, `ROW D-10a.afterBreak | midHole={"cx":"90","cy":"-60"} solidLines:3->4 ...`. Break was first thought covered by 1018 (its probe row passed), but that was the shapes' order: once 1020 changed the run upstream, the row split the construction line, so the rule was extended to Break (advisor ruling).

### BUG-214
- **Date / turn:** 2026-11-27 (real-design audit `R1-10`)
- **Reported by:** worker (audit 1016, Gemini Neon seat)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (Design tab)
- **Report:** "After dragging a corner, pressing D and clicking the adjacent line makes nothing."
- **What was wrong:** The press on the corner selected it, and the finished drag left it selected, so Dimension started a point pick from it and the click on its own line cancelled silently.
- **Cause:** `packages/ui/input-handlers/selection-tools.js` `handleSelectionPointerUp` kept the selection the press had made, also after a real drag of a point.
- **Fix:** after a moved (> 5 px) drag of a point (`DRAG_TYPES.JOINT` / `CLUSTER`, not a group), nothing stays selected. A plain click still selects the point. A dragged curve stays selected (task 588 ruling). Fusion: a dragged sketch point is not left selected (unverified).
- **Task id(s):** `1020`
- **Fix merge sha:** pending (`agents/picks-1020`)
- **Guarding test file(s):** `tests/picks-1020-node.test.js` (`BUG-214 R1-10 drag leaves no selection`)
- **Status:** fixed
- **Family:** `ui-input`
- **History:** found in audit `1016` -> fixed in task `1020`. Probe before: `ROW R1-10 | Part A / A7b->A8a | FRICTION | ... (dim50FirstTry=false)`. After: `ROW R1-10 | Part A / A7b->A8a | OK | ... (dim50FirstTry=true)`.

### BUG-215
- **Date / turn:** 2026-11-27 (found in task `1020`, audit row `R1-06`)
- **Reported by:** worker (task 1020 after-probe)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (Design tab)
- **Report:** "A click on a fillet arc's middle at normal zoom hits its tangent glyph."
- **What was wrong:** At the bracket's desktop zoom (~3.3 px/mm) an R5 fillet arc is about 23 px long, and its tangent glyph badge covers its middle. A click there selects the tangent constraint, and Delete removes that tangent (tangent 16 -> 15). The arc stays.
- **Cause:** the Select pick order (`hover-manager.js` `selectPick`: a joint, then a glyph the pointer is ON (badge + 3 px), then a shape; task 588). On a curve shorter than its glyph badge, the curve's body is only reachable outside the badge.
- **Task id(s):** none yet (owner decision: glyph priority vs a short curve)
- **Fix merge sha:** none
- **Guarding test file(s):** none yet. Probe: `node tests/audits/design-run-audit-1016-partA.mjs`, `ROW R1-06 | Part A / A15a | OK | clicking R5 fillet arc at normal desktop zoom hits virtual sharp; Delete removed [] while arc survived=true` (its A15a summary shows `"tangent":15`, it was 16 before the click).
- **Status:** open
- **Family:** `ui-input`
- **Related:** BUG-212

### BUG-216
- **Date / turn:** 2026-11-27 (real-design audit `R2-14`)
- **Reported by:** worker (audit 1017, Gemini Neon seat)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (Design tab)
- **Report:** "No 'Select Other' disambiguation picker for overlapping curves (Fusion: click and hold, unverified)."
- **What was wrong:** Where curves overlap, the user cannot choose which one a click takes. BUG-213's rule picks the likely one, but a first click aimed at a construction piece that lies on a solid line takes the solid line (audit `D-06b`: Equal then makes hyp + seg3, not seg1 + seg3).
- **Cause:** no such picker exists (feature gap).
- **Task id(s):** none (recorded only in task `1020`, not built)
- **Fix merge sha:** none
- **Guarding test file(s):** none
- **Status:** open
- **Family:** `ui-input`
- **Related:** BUG-213

### BUG-300
- **Date / turn:** 2026-11-27 (task 1027, from the files and documents audit 1024, row F-81 / F-81b)
- **Reported by:** audit `1024`
- **App(s) & host:** SketchStudio
- **Report:** Download SVG and Download DXF dropped every circle, and wrote construction geometry as real solid lines.
- **What was wrong:** Download SVG of a design with 9 circles wrote 16 `<line>`, 0 `<circle>`; the construction line came out as a solid black line.
- **Cause:** `buildSVG` and `buildDXF` (`apps/sketchstudio/ui/export-manager.js`) each filtered `line | arc | bezier` only, and never read `isConstruction`.
- **Fix:** One declared filter `exportedShapes` (export-manager.js, `EXPORTED_TYPES` incl. circle, never `isConstruction`) feeds both writers; a circle is an SVG `<circle>` / a DXF CIRCLE (with arcApprox its sampled points).
- **Task id(s):** `1027`
- **Fix merge sha:** pending (set at merge)
- **Guarding test file(s):** `tests/export-roundtrip-1027-node.test.js`
- **Status:** fixed (on branch `agents/files-fix-1027`, awaiting merge)
- **Family:** `export-svg`
- **Related:** BUG-301
- **History:** F-id `F-81 / F-81b` of `docs/FILES-AUDIT-1024.md`; probe `tests/audits/files-audit-1024-*.mjs`.

---
### BUG-301
- **Date / turn:** 2026-11-27 (task 1027, from the files and documents audit 1024, row F-84)
- **Reported by:** audit `1024`
- **App(s) & host:** SketchStudio
- **Report:** Our own DXF re-imported mirrored top to bottom.
- **What was wrong:** First lines `(80,4)-(80,40)` came back `(80,-4)-(80,-40)`.
- **Cause:** The DXF importer negates Y (DXF is Y-up, the world Y-down); `buildDXF` wrote the world Y unchanged (the sidebar passed `invertY:false`).
- **Fix:** The DXF writer ALWAYS negates Y and computes an arc's angles and direction from the points as written, so export then import is the identity. Behaviour change (owner/advisor ruling): the Export view's "Invert Y axis" box no longer reaches a DXF (it used to keep the world Y there); it is SVG only and relabelled "Invert Y axis (SVG)". The box is not a stored setting, so nothing stored changes.
- **Task id(s):** `1027`
- **Fix merge sha:** pending (set at merge)
- **Guarding test file(s):** `tests/export-roundtrip-1027-node.test.js`, `tests/arc-direction.test.js` (the DXF arc check now reads Y-up angles)
- **Status:** fixed (on branch `agents/files-fix-1027`, awaiting merge)
- **Family:** `export-svg`
- **Related:** BUG-300
- **History:** F-id `F-84` of `docs/FILES-AUDIT-1024.md`; probe `tests/audits/files-audit-1024-*.mjs`.

---
### BUG-302
- **Date / turn:** 2026-11-27 (task 1027, from the files and documents audit 1024, row F-47a)
- **Reported by:** audit `1024`
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (SVG import)
- **Report:** A NaN coordinate in an SVG became 0: a made-up line.
- **What was wrong:** `<line x1="NaN" ...>` imported as the line (0,0)-(5,5), nothing said.
- **Cause:** `num()` (`packages/core/svg-import.js`) turned every unparsable number into 0; `parsePoints` dropped bad tokens and re-paired the rest.
- **Fix:** `coord()` returns null for a present non-numeric value (an absent one is still SVG's default 0); line, rect, circle, ellipse, polyline and polygon holding one are skipped and counted ("non-numeric coordinate, not imported"), shown by the import's one notice. `parsePoints` returns null on a bad token.
- **Task id(s):** `1027`
- **Fix merge sha:** pending (set at merge)
- **Guarding test file(s):** `tests/svg-import-1027-node.test.js`
- **Status:** fixed (on branch `agents/files-fix-1027`, awaiting merge)
- **Family:** `import-svg`
- **Related:** BUG-303
- **History:** F-id `F-47a` of `docs/FILES-AUDIT-1024.md`; probe `tests/audits/files-audit-1024-*.mjs`.

---
### BUG-303
- **Date / turn:** 2026-11-27 (task 1027, from the files and documents audit 1024, row F-47b)
- **Reported by:** audit `1024`
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (SVG import)
- **Report:** A circle of radius 0 or less imported as a radius-0 circle, silently.
- **What was wrong:** `<circle r="-5">` and `r="0"` gave two circles of radius 0.
- **Cause:** The `circle` emitter (`packages/core/svg-import.js`) took `num(d.r)` with no check.
- **Fix:** A circle with r <= 0 is skipped and counted ("radius zero or negative, not imported") in the same notice.
- **Task id(s):** `1027`
- **Fix merge sha:** pending (set at merge)
- **Guarding test file(s):** `tests/svg-import-1027-node.test.js`
- **Status:** fixed (on branch `agents/files-fix-1027`, awaiting merge)
- **Family:** `import-svg`
- **Related:** BUG-302
- **History:** F-id `F-47b` of `docs/FILES-AUDIT-1024.md`; probe `tests/audits/files-audit-1024-*.mjs`.

---
### BUG-304
- **Date / turn:** 2026-11-27 (task 1027, from the files and documents audit 1024, row F-58)
- **Reported by:** audit `1024`
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (SVG import)
- **Report:** A circle under a non-uniform scale imported as ONE circle of a wrong radius.
- **What was wrong:** `<circle r="5" transform="scale(2,1)">` came in as a circle of radius 7.071.
- **Cause:** The `circle` emitter scaled the radius by `linearScaleOf(ctm)` (sqrt of the determinant), right only for a similarity.
- **Fix:** When the CTM is not a similarity (`isSimilarity`), the circle comes in as the same flattened ring an `<ellipse>` gives (`ellipsePoints` with the CTM applied). A uniform scale still gives a circle.
- **Task id(s):** `1027`
- **Fix merge sha:** pending (set at merge)
- **Guarding test file(s):** `tests/svg-import-1027-node.test.js`
- **Status:** fixed (on branch `agents/files-fix-1027`, awaiting merge)
- **Family:** `import-svg`
- **Related:** BUG-302
- **History:** F-id `F-58` of `docs/FILES-AUDIT-1024.md`; probe `tests/audits/files-audit-1024-*.mjs`.

---
### BUG-305
- **Date / turn:** 2026-11-27 (task 1027, from the files and documents audit 1024, row F-105)
- **Reported by:** audit `1024`
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (open a file / a stored design)
- **Report:** A shape of a file that names a joint the file does not have vanished with no word.
- **What was wrong:** `dangling-refs.sketch.json` (a line on a joint `ghost`) opened as a tab with 0 shapes drawn and no toast.
- **Cause:** `deserializeDocument` (`packages/core/document.js`) loaded the shape as it was and only logged dropped constraints (`dbg.warn`); nothing told the user.
- **Fix:** `deserializeDocument` returns `damagedShapes` (shapes naming a missing joint; what loads is unchanged); the document buffer's `restored()` (`packages/ui/document-buffer-core.js`) shows ONE warning "1 shape in this design was damaged and could not be loaded" for a stored design or a file load (not for a tab switch).
- **Task id(s):** `1027`
- **Fix merge sha:** pending (set at merge)
- **Guarding test file(s):** `tests/files-tabs-1027-node.test.js`
- **Status:** fixed (on branch `agents/files-fix-1027`, awaiting merge)
- **Family:** `storage-lifecycle`
- **Related:** 1016 R1-07
- **History:** F-id `F-105` of `docs/FILES-AUDIT-1024.md`; probe `tests/audits/files-audit-1024-*.mjs`.

---
### BUG-306
- **Date / turn:** 2026-11-27 (task 1027, from the files and documents audit 1024, row F-03 / F-32)
- **Reported by:** audit `1024`
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (document tabs)
- **Report:** A file opened and not edited was lost as a tab on a reload or when switching apps.
- **What was wrong:** Open a file, edit nothing, reload: one empty Untitled. Switching to Shaper: an empty Untitled.
- **Cause:** `captureBufferSnapshot` (`packages/ui/document-buffer-core.js`) wrote no buffer for "one unbound tab without content"; a file home has no content (its baseline is the file) so it counted as an empty Untitled.
- **Fix:** The same test also asks for `!fileHome`: a design opened from a file is kept like an edited one.
- **Task id(s):** `1027`
- **Fix merge sha:** pending (set at merge)
- **Guarding test file(s):** `tests/files-tabs-1027-node.test.js`, `tests/files-1027-live.test.js` (desktop 1280 and phone 390)
- **Status:** fixed (on branch `agents/files-fix-1027`, awaiting merge)
- **Family:** `storage-lifecycle`
- **Related:** BUG-015
- **History:** F-id `F-03 / F-32` of `docs/FILES-AUDIT-1024.md`; probe `tests/audits/files-audit-1024-*.mjs`.

---
### BUG-307
- **Date / turn:** 2026-11-27 (task 1027, from the files and documents audit 1024, row F-94)
- **Reported by:** audit `1024`
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (Save as / Open dialog, and every small modal)
- **Report:** Tab left the aria-modal Save as / Open dialog for the page behind.
- **What was wrong:** Tab x9 from the name field reached the sidebar button, header tabs, document tabs and ribbon behind the dialog.
- **Cause:** The shared small modal shell (`openSmallModal`, `packages/ui/template-picker.js`) handled only Escape.
- **Fix:** One shared `trapTab(panel, e)` (`packages/ui/template-picker.js`) wraps Tab / Shift+Tab inside the panel's own visible controls; `openSmallModal` and `openTemplatePicker` both call it. Behaviour change: the name prompt, choice and close-unsaved modals trap Tab too.
- **Task id(s):** `1027`
- **Fix merge sha:** pending (set at merge)
- **Guarding test file(s):** `tests/files-1027-live.test.js` (desktop 1280 and phone 390)
- **Status:** fixed (on branch `agents/files-fix-1027`, awaiting merge)
- **Family:** `ui-input`
- **Related:** none
- **History:** F-id `F-94` of `docs/FILES-AUDIT-1024.md`; probe `tests/audits/files-audit-1024-*.mjs`.

---

### BUG-310
- **Date / turn:** 2026-11-27 (audit ID `B-01`; fixed in task `1028`)
- **Reported by:** audit `1026` (`B-C06`, `B-A11`, `B-X09`, `B-X12`, `B-C2C07`, `B-C2C21`, `B-OV07`, `B-OV21`, `B-CP07`, `B-CP21`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `B-01`: emptying a draw-time box does not unlock it. The last valid text keeps the lock: Circle Ø 60, Backspace x2, Enter gives a Ø 6 circle with a driving `d1 = 6`. The Arc radius / sweep, the Slot span / width and the Polygon N do the same. The two-field Line and Rectangle boxes already unlocked.
- **What was wrong:** an emptied single box sent a preview event with no `field` and no `value`, and each single-field tool's guard dropped it (`circle-tool.js`, `arc-tool.js`, `slot-tool.js` read the event by its field). The polygon's N field kept its count (`polygon-tool.js` keeps the old N when the text reads no number).
- **Cause:** `packages/ui/numeric-input-manager.js` `handlePreview`: "unlocked" was sent only for a Ctrl+Z reset (`detail.reset`). A typed field the user emptied was not read as unlocked, and the single box's field was omitted when its text read nothing.
- **Fix:** in `handlePreview` (ONE place): a typed field whose text is empty is sent as `detail.reset` (the unlock every tool already honours), and the single box always sends its `field`. No tool guard changed.
- **Task id(s):** `1028`
- **Fix merge sha:** open (`agents/drawbox-fix-1028`, awaiting merge)
- **Guarding test file(s):** `tests/drawbox-fix-1028-node.test.js` (`B-01 circle`, `B-01 arc`, `B-01 slot`, `B-01 polygon`)
- **Status:** fixed
- **Family:** `ui-input`
- **History:** found in audit `1026` -> fixed in task `1028`. Probe before: `ROW B-C06 | Circle | ... | DEV: circles [3] dims 1 || ... FINAL shapes{C[r=3 c=-30,0]} cons{distance=6:d1Ø pointOnLine}`. After: `ROW B-C06 | ... | OK || ... FINAL shapes{C[r=30 c=-30,0]} cons{pointOnLine}`. `B-C2C07` before `dims [[51.37,false],[4,false]]`, after `dims [[51.37,false]]`: only the slot's own width dimension, which every slot gets, so the probe's check still prints DEV. `B-P07` before: N 5 kept; after: the remembered N (7).

---

### BUG-311
- **Date / turn:** 2026-11-27 (audit ID `B-02`; fixed in task `1028`)
- **Reported by:** audit `1026` (`B-R203`, `B-R205`, `B-R220`, `B-RC04`, `B-RC05`, `B-RC08`, `B-RC20`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `B-02`: a rectangle committed by Enter gets `pointOnLine` snaps to an axis that the same rectangle committed by a click does not. Example: 2-point W 40 H 20 from (-40,-10), where the right side lands on the Y axis.
- **What was wrong:** the click path and the Enter path were two copies of the placement. Enter's copy re-ran `findSnap` on every corner of the placed rectangle.
- **Cause:** `packages/ui/input-handlers/rect-tool.js` `finalizeRectFromActive` (the three `findSnap` / `applySnapConstraint` loops, one per mode).
- **Fix:** ONE `placeRect(state, endPt, endSnap)` in `rect-tool.js`, called by the click (`handleRectPointerUp`) and by Enter (`finalizeRectFromActive`). The click's rules apply to both: snaps recorded at the clicks, a 0.01 coincident to an existing joint, and the typed sides as dimensions.
- **Task id(s):** `1028`
- **Fix merge sha:** open (`agents/drawbox-fix-1028`, awaiting merge)
- **Guarding test file(s):** `tests/drawbox-fix-1028-node.test.js` (`B-02`: Enter and click give equal constraint counts, 2-point and centre)
- **Status:** fixed
- **Family:** `snap-not-applied`
- **History:** found in audit `1026` -> fixed in task `1028`. Probe before: `ROW B-R205 ... cons{horizontal vertical horizontal vertical coincident coincident coincident coincident pointOnLine distance=40:d1 distance=20:d2} dof=8`. After: `cons{horizontal vertical horizontal vertical coincident coincident coincident coincident distance=40:d1 distance=20:d2} dof=16`, which is the click's `B-R209`. Centre: `B-RC05` after `dof=26` = `B-RC09` (click) `dof=26`.

---

### BUG-312
- **Date / turn:** 2026-11-27 (audit ID `B-03`; fixed in task `1028`)
- **Reported by:** audit `1026` (`B-R302`..`B-R310`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `B-03`: the 3-point rectangle has no value box on click 1 or click 2. A typed digit opens the legacy box, but Enter then draws nothing or ignores the typed height, and `0` is not refused.
- **What was wrong:** the rectangle tool's preview / commit listeners read only the two-field W x H box. A 3-point rectangle had no box of its own, and Enter returned false without a second point.
- **Cause:** `packages/ui/input-handlers/rect-tool.js` (`onPreview` handled the sized modes only; `finalizeRectFromActive` returned false for a 3-point rectangle; no `openCreationBoxes` for the 3-point mode).
- **Fix:** the 3-point rectangle opens a LENGTH box after click 1 and a HEIGHT box once the base is placed, both through the shared `openCreationBoxes` path. A typed length holds the base along the cursor's direction, and a typed height holds the third point on the cursor's side. Enter and a click place the same thing through `placeBase` / `placeRect`. The typed length and height become the base side's and the next side's dimensions (name / formula / `param = value` kept). `0` is refused by the shared size rule.
- **Task id(s):** `1028`
- **Fix merge sha:** open (`agents/drawbox-fix-1028`, awaiting merge)
- **Guarding test file(s):** `tests/drawbox-fix-1028-node.test.js` (`B-03 ... by enter`, `B-03 ... by click`, `B-03 ... a typed 0 is refused`)
- **Status:** fixed
- **Family:** `ui-input`
- **History:** found in audit `1026` -> fixed in task `1028`. Probe before: `ROW B-R306 | Rect 3-point | after click 2: type 20 (height), Enter | DEV: bbox {"w":50,"h":30,...}`. After: `ROW B-R306 ... | OK || ... L[len=50 ...] L[len=20 ang=-90 ...]`. `B-R309` (typed 0) before: 4 shapes drawn; after: `shapes{}`. `B-R303` / `B-R304` still print `DEV: bbox null`: their cells expected a W x H box at click 1. Enter now places the base and opens the height box (`LIVE ... box=single[0] focus=dimInput`).

---

### BUG-313
- **Date / turn:** 2026-11-27 (audit ID `B-04`; fixed in task `1028`)
- **Reported by:** audit `1026` (`B-A303`, `B-A305`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `B-04`: the 3-point arc slot drops a typed span (`30`) and its formula (`d1 / 2`). The centre-point arc slot keeps its span.
- **What was wrong:** the span dimension was made for the straight modes and the centre-point arc only.
- **Cause:** `packages/ui/input-handlers/slot-tool.js` `commitSlot` (`spanJoints` required `!isArcMode(mode)`).
- **Fix:** the same condition now includes the 3-point arc slot. Its span box is the distance between its two end centres (`resolveSpanEnd`), so a typed span is a driving distance on `c1Id`-`c2Id`. The centre-point arc slot keeps its radius.
- **Task id(s):** `1028`
- **Fix merge sha:** open (`agents/drawbox-fix-1028`, awaiting merge)
- **Guarding test file(s):** `tests/drawbox-fix-1028-node.test.js` (`B-04`)
- **Status:** fixed
- **Family:** `ui-input`
- **History:** found in audit `1026` -> fixed in task `1028`. Probe before: `ROW B-A303 ... cons{... distance=23.34:d1Ø}` (no span). After: `cons{... distance=23.34:d1Ø distance=30:d2}`. `B-A305` after: `distance=20{d1 / 2}`.

---

### BUG-314
- **Date / turn:** 2026-11-27 (audit ID `B-05`; fixed in task `1028`)
- **Reported by:** audit `1026` (`B-L30`, `B-X02`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `B-05`: Line, a typed length, then a right-click: TWO segments, the typed one (40) and a stray one to the cursor (1.03).
- **What was wrong:** the right button's DOWN committed the segment and started the next one. Its UP then reached `handleLinePointerUp` and placed a click segment to the cursor. Untyped, the same UP made a zero-length segment, which ended the chain only by accident (the abort).
- **Cause:** `packages/ui/input-handlers/drawing-tools.js` `handleDrawingPointerDown` (the right-click branch committed the segment and left the chain open).
- **Fix:** the right-click branch (ONE place) commits the segment and finishes the chain (`finishLineChain`), typed or not. The release finds no line being drawn. A typed length the sketch refuses (BUG-315) keeps the chain.
- **Task id(s):** `1028`
- **Fix merge sha:** open (`agents/drawbox-fix-1028`, awaiting merge)
- **Guarding test file(s):** `tests/drawbox-fix-1028-node.test.js` (`B-05`), `tests/drawbox-fix-1028-live.test.js` (`B-05`, desktop 1280x800, real right button)
- **Status:** fixed
- **Family:** `ui-input`
- **History:** found in audit `1026` -> fixed in task `1028`. Probe before: `ROW B-L30 ... FINAL shapes{L[len=40 ...] L[len=1.03 ...]}`. After: `ROW B-L30 ... FINAL shapes{L[len=40 ang=-42.89 -60,10>-30.69,37.22]} cons{distance=40:d1}`. Behaviour change (advisor-approved): after a typed right-click the chain ends, as it already did untyped. Task `1030` (BUG-330, advisor ruling): an UNTYPED right-click ends the chain with NO segment (it made one); the rule moved to `line-tool.js rightClickLine`, reached from the one right-button guard in `input-manager.js`.

---

### BUG-315
- **Date / turn:** 2026-11-27 (audit IDs `B-06`, `B-08`; fixed in task `1028`)
- **Reported by:** audit `1026` (`B-X03`, `B-OC1`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `B-06`: an Enter-committed Line merged its end with ANY joint within 0.5 mm, and the solver moved an unrelated line. `B-08`: a typed length that conflicts with a LOCKED point silently became a reference `(40)`.
- **What was wrong:** the Enter path (`finalizeLineFromActive`) reused an existing joint within 0.5 mm as the end, while the click path makes a new end joint with a coincident within 0.01. A typed distance that the sketch could not hold came in as a reference, and nothing told the user.
- **Cause:** `packages/ui/input-handlers/line-tool.js` `finalizeLineFromActive` (`findNearbyJoint(..., 0.5)` reused as the end joint). For B-08, both commit paths created the typed distance and never checked that it drives.
- **Fix:** ONE merge rule, `mergeEndWithNearby` (the click's: a new end joint, coincident with a joint within `END_MERGE_TOL` = 0.01), used by both paths. ONE `addTypedSizes` makes the typed length's dimension in both paths. When it came in as a reference measuring another value, the segment is put back (`refuseSegment`: the snapshot from before it, the draw goes on) and the length field is refused with the edit box's wording (`numeric-input-manager.js` `cantSetText`, BUG-181: `Can't set to 40.004 mm — the sketch is over constrained`) until it is typed again (`refuseLiveValue`).
- **Task id(s):** `1028`
- **Fix merge sha:** open (`agents/drawbox-fix-1028`, awaiting merge)
- **Guarding test file(s):** `tests/drawbox-fix-1028-node.test.js` (`B-06`, `B-08` by Enter and by click)
- **Status:** fixed
- **Family:** `ui-input`
- **History:** found in audit `1026` -> fixed in task `1028`. Probe before: `ROW B-X03 ... L[len=10 ang=-90 10.1,30>10.1,40] L[len=40.3 ang=0 -30.2,30>10.1,30]` (the old line moved to x 10.1). After: `ROW B-X03 ... FINAL shapes{L[len=10 ang=-90 10,30>10,40] L[len=40.3 ang=0 -30,30>10.3,30]}` (the old line stays at x 10). `B-L14` (end exactly on an existing endpoint) before `DEV: end landed on the point but no coincident`, after `OK ... cons{horizontal coincident distance=40:d1 ...}`. The audit's `B-OC1` (locked point 0.3 mm past the typed end) no longer merges, so the typed 40.3 now drives (`cons{... distance=40.3:d1 ...}`, before `distance=40.3:d1(ref)`). The probe still prints `DEV: no warning`, but nothing is refused because nothing conflicts. A real conflict (an end within 0.01 of a locked point, typed 40.004 to a point 40 away) is refused: node test `B-08`.

---

### BUG-316
- **Date / turn:** 2026-11-27 (audit ID `B-07`; fixed in task `1028`)
- **Reported by:** audit `1026` (`B-A20a`..`B-A20d`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `B-07`: an Arc sweep of `0` or `-90` was silently ignored (the arc was placed at the cursor's sweep). `360` / `720` were clamped to 359.999 and made an arc whose start and end are the same point.
- **What was wrong:** the box refused only lengths. The arc tool dropped a sweep of 0 or less and clamped 360 or more.
- **Cause:** `packages/ui/input-handlers/arc-tool.js` `takeTyped` (`detail.value > 0 ? Math.min(value, 359.999) : null`); `numeric-input-manager.js` `liveRefusal` had no rule for an angle field.
- **Fix:** a box may declare its own value rule (`{ single: { field, quantity, refuse } }` -> `showSingleInput(..., refuse)`). `numeric-input-manager.js` `boxRefusal` is the ONE refusal: the parser's message, else the field's rule, else its quantity's. The arc's sweep box declares `sweepRefusal` ("A sweep must be more than 0 and less than 360 degrees."), and the same rule decides what locks the sweep. Enter and a click place nothing until the text is fixed.
- **Task id(s):** `1028`
- **Fix merge sha:** open (`agents/drawbox-fix-1028`, awaiting merge)
- **Guarding test file(s):** `tests/drawbox-fix-1028-node.test.js` (`B-07`)
- **Status:** fixed
- **Family:** `ui-input`
- **History:** found in audit `1026` -> fixed in task `1028`. Probe before: `ROW B-A20a | Arc | sweep 0, Enter | ... FINAL shapes{arc[-30,0 10,0 -6.7,-32.52]}`, `B-A20c` `arc[-30,0 10,0 10,0]`. After: `B-A20a`..`B-A20d` `FINAL shapes{}`.

---

### BUG-317
- **Date / turn:** 2026-11-27 (audit IDs `B-09`, `B-18`, `B-19`; fixed in task `1028`)
- **Reported by:** audit `1026` (`B-F14d`; `B-F06`, `B-F14a`, `B-F14b`, `B-F14e`, `B-F15`, `B-O04`, `B-O10a`, `B-O10d`, `B-O10e`; `B-F08`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `B-09`: Fillet `6abc` said "Enter a radius greater than zero". `B-18`: Fillet and Offset refused by toast only, and with different wording from each other and from the draw boxes. `B-19`: a canvas click with a typed radius CANCELLED the fillet.
- **What was wrong:** Fillet showed its own sentence except for 5 parse codes. Offset prefixed "Offset: ". Neither used the draw boxes' inline hint. A click on empty canvas with the radius box open ran `cancelAll`.
- **Cause:** `packages/ui/input-handlers/fillet-tool.js` `commitFilletInput` (the `formulaErr` whitelist + toast) and `pickWhileInputOpen` (`cancelAll` on an empty-canvas click); `packages/ui/input-handlers/offset-tool.js` `commitOffsetInput` (toast).
- **Fix:** both boxes refuse through `numeric-input-manager.js` `boxRefusal`, the draw boxes' rule and wording (Offset passes its own value rule, `core/offset.js` `offsetDistanceRefusal`: any sign, never 0). The text is shown under the box, in the ONE hint line, by the external box's handle `refuse(text)` (`attachExternalCompletion`), live while typing and on Enter, with no toast. An empty-canvas click with the Fillet box open commits it (`commitFilletInput`), as a click commits a draw box. Esc still cancels.
- **Task id(s):** `1028`
- **Fix merge sha:** open (`agents/drawbox-fix-1028`, awaiting merge)
- **Guarding test file(s):** `tests/drawbox-fix-1028-node.test.js` (`B-09 / B-18 fillet`, `B-18 offset`, `B-19 fillet`); updated: `tests/fillet-polish-666-node.test.js`, `tests/fillet-polish-666-live.test.js` (F9: the refusal is inline, no toast), `tests/fillet-handle-646.test.js` (section 6: a click on empty canvas applies the box's R=5 in one undo step; it asserted the old abandon and turned the merge gate red)
- **Status:** fixed
- **Family:** `notice-wording`
- **History:** found in audit `1026` -> fixed in task `1028`. Probe before: `ROW B-F14d | Fillet | radius "6abc", Enter | ... toasts=["⚠️Enter a radius greater than zero"]`, `B-O10d ... toasts=["⚠️Offset: unexpected 'abc' at 1."]`, `B-F08 | DEV: arcs 0`. After: `B-F14d ... hint="unexpected 'abc' at 1" toasts=[]`, `B-F14a ... hint="A length must be more than 0." toasts=[]`, `B-O10d ... hint="unexpected 'abc' at 1" toasts=[]`, `B-O10a ... hint="an offset distance cannot be 0 (a negative distance puts the offset on the other side)" toasts=[]`, `B-F08 | OK` (1 arc). `B-F06` prints `DEV: arcs 0 toasts []`: its check wants a toast, and the refusal is now the hint `"nothing to evaluate"`.

---

### BUG-318
- **Date / turn:** 2026-11-27 (audit ID `B-13`; fixed in task `1028`)
- **Reported by:** audit `1026` (`B-X04`, `B-A17`, `B-P15`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `B-13`: a name in an angle or count field was refused (`"=" is not allowed here`): Line angle `ang = 30`, Arc sweep `sw = 90`, Polygon N `n = 6`. The pattern dialog accepts names in its Quantity / Angle fields.
- **What was wrong:** `readBoxText` let `name = value` through in a length field only.
- **Cause:** `packages/ui/numeric-input-manager.js` `readBoxText` (`allowAssign` defaulted to `quantity === 'length'`).
- **Fix (advisor ruling, option c):** `readBoxText` reads `name = value` in every box (ONE place). An angle or a count box makes no dimension: `param = value` with an existing user parameter updates that parameter (the tools apply `liveAssign` at their commit: line angle, arc sweep, polygon N, as they already do for a length), and a FREE name is refused with "a name needs a dimension; this value makes none".
- **Task id(s):** `1028`
- **Fix merge sha:** open (`agents/drawbox-fix-1028`, awaiting merge)
- **Guarding test file(s):** `tests/drawbox-fix-1028-node.test.js` (`B-13`)
- **Status:** fixed
- **Family:** `ui-input`
- **History:** found in audit `1026` -> fixed in task `1028`. Probe before: `ROW B-X04 | Line | angle box: a name "ang = 30" ... hint=""=" is not allowed here"`. After: `ROW B-X04 ... hint="a name needs a dimension; this value makes none"` (likewise `B-A17` `sw = 90`, `B-P15` `n = 6`: no such parameter, so it is a free name). An existing parameter (`ang = 30`, `n = 5`) updates it and draws: node test `B-13`.

---

### BUG-319
- **Date / turn:** 2026-11-27 (audit IDs `B-14`, `B-15`; fixed in task `1028`)
- **Reported by:** audit `1026` (`B-R202`, `B-R202b`, `B-RC02`, `B-RC02b`; `B-C04`, `B-X08`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `B-14`: Rectangle (2-point, centre): click, then Enter with no size closed the box and left the draw armed. `B-15`: Tab inside a one-field box (Circle Ø, Arc, Slot) moved the focus out to the page (the SKETCHES card's collapse button), so a later Enter pressed that button.
- **What was wrong:** `enterCorner` returned null before the cursor moved, so the too-small check (which keeps the box open) was skipped. The one-field box let Tab go to the browser in draw mode.
- **Cause:** `packages/ui/input-handlers/rect-tool.js` `enterCorner`; `packages/ui/numeric-input-manager.js` single-box keydown (Tab handled in edit / view mode only).
- **Fix:** `enterCorner` falls back to the first click itself (a size of 0: the box stays open). In a draw-time one-field box, Tab goes to the "next" field, which is this field: the focus stays and the text is selected, like the two-field box's Tab.
- **Task id(s):** `1028`
- **Fix merge sha:** open (`agents/drawbox-fix-1028`, awaiting merge)
- **Guarding test file(s):** `tests/drawbox-fix-1028-node.test.js` (`B-14`, `B-15`), `tests/drawbox-fix-1028-live.test.js` (`B-15`, desktop 1280x800 + phone 390x844)
- **Status:** fixed
- **Family:** `ui-input`
- **History:** found in audit `1026` -> fixed in task `1028`. Probe before: `ROW B-R202 ... | DEV: box closed on a refused Enter`; after: `OK`. `ROW B-C04 ... LIVE ... box=single[80] focus=BUTTON`; after: `focus=dimInput`.

### BUG-320
- **Date / turn:** 2026-11-27 (audit ID `I-01`; fixed in task `1030`)
- **Reported by:** audit `1023` (`SWR-025..039`, `RCC-025..039`, phone `tap other tool` / `tap same tool`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `I-01`: Slot (every variant), a pick made, a value typed, then another tool picked (or Slot re-clicked): the slot is dropped but its value box (`#dimInput "22"`) stays on the canvas over the next tool.
- **What was wrong:** a tool switch only closed the boxes of a draw that had opened a draw step (`closeDrawStep` fires its cancel listeners); Slot never opens one, so nothing closed its box. Esc worked because `handleEscape` reset every draw tool itself.
- **Cause:** `packages/ui/input-manager.js` `leaveActiveTool` (it ran `closeDrawStep` only, not the Esc cleanup).
- **Fix:** ONE cancel for what a tool holds, `cancelActiveWork` (`input-manager.js:1515`), shared by Esc, a tool switch (`leaveActiveTool`, `:1544`) and Undo with a pick pending: it resets every tool's state (`resetDrawingState` closes the Slot boxes). The re-click half is BUG-323 (a re-click keeps the slot and its box).
- **Task id(s):** `1030`
- **Fix merge sha:** open (`agents/interrupts-fix-1030`, awaiting merge)
- **Guarding test file(s):** `tests/interrupts-fix-1030-node.test.js` (`I-01`, every Slot variant)
- **Status:** fixed
- **Family:** `ui-input`
- **History:** found in audit `1023` -> fixed in task `1030`. Probe before: `SWR-014 | slot-c2c | boxTyped | ribbon-switch | ... tool=circle boxes=[dimInput("22")]`; after: `SWR-014 | slot-c2c | boxTyped | ribbon-switch | ... tool=circle boxes=[none] ... hist=(U:1,R:1)`.

### BUG-321
- **Date / turn:** 2026-11-27 (audit ID `I-02`; fixed in task `1030`)
- **Reported by:** audit `1023` (`ESC-044`, `ESC-070`, `ESC-013`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `I-02`: ONE Esc inside the Text editor or the Dimension value box closed the box only; a second Esc was needed to leave the tool (owner ruling BUG-105: one Esc cancels and leaves the tool). The 3-point rectangle box had the same fault; task `1028` rebuilt that box (`ESC-004 ... tool=select` on main before this task).
- **What was wrong:** the box's Esc reaches the canvas Esc through the `liveDimensionCancelled` event, and its listener ran `handleEscape` only for the draw tools with `state.active` and Offset / Fillet. The Text editor's Esc never raised the event.
- **Cause:** `packages/ui/input-manager.js` `liveDimensionCancelled` listener (a tool list), `packages/ui/input-handlers/text-tool.js` editor keydown.
- **Fix:** the listener (`input-manager.js:1299`) runs the canvas Esc for EVERY tool but Select (in Select a box's Esc only closes that box: the dimension edit box, a text edited from its menu); the Text editor's Esc raises the same event (`text-tool.js:298`). The box's Ctrl+Z at its opening value raises it with `{ undo: true }` (`numeric-input-manager.js:1069`): the canvas Undo then (BUG-324).
- **Task id(s):** `1030`
- **Fix merge sha:** open (`agents/interrupts-fix-1030`, awaiting merge)
- **Guarding test file(s):** `tests/interrupts-fix-1030-node.test.js` (`I-02` text, dimension)
- **Status:** fixed
- **Family:** `ui-input`
- **Related:** BUG-105, BUG-223
- **History:** found in audit `1023` -> fixed in task `1030`. Probe before: `ESC-006 | text | boxTyped | Esc | ... post=tool=text`, `ESC-010 | dim | boxTyped | Esc | ... post=tool=dim`; after: `ESC-033 | dim | boxTyped | Esc | ... tool=select ... hist=(U:1,R:1)`.

### BUG-322
- **Date / turn:** 2026-11-27 (audit ID `I-03`; fixed in task `1030`)
- **Reported by:** audit `1023` (Esc x17, ribbon switch x18, key switch x4, phone x6; `F2-*`, `F4-esc2`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `I-03`: the 1st click of Line / Rect / Circle / Arc / Polygon / Bezier / Dimension opens an undo step, which clears Redo; Esc or a tool switch drops the step but Redo stays empty: a cancelled draw lost the user's redo history.
- **What was wrong:** every saved step clears the Redo branch; a step that is later DROPPED (it changed nothing) never gave it back. Two hand copies restored it for one case each (a no-op drag, BUG-150; a refused parameter edit).
- **Cause:** `packages/core/sketch-state.js` `saveStateForce` / `closeDrawStep` / `discardSnapshotAt`.
- **Fix:** ONE rule in `sketch-state.js` (`:84`, `:208`): ONE slot on the state, `_clearedRedo = { entry, redo }`, holds the newest save that cleared a non-empty Redo branch and that branch (overwritten by the next clearing save, so at most one extra branch is held and the HISTORY_DEPTH bound stays: only the newest step can ever be dropped), and `closeDrawStep` (a cancelled draw) and `discardSnapshotAt` (a cancelled Dimension placement, a no-op drag, a refused edit, a no-op Shaper Prepare cut edit) give it back when they drop that entry. The two hand copies are deleted (`selection-tools.js settleDragUndo`, `dimension-seams.js applyParameterChange`). Behaviour change (advisor-approved): a no-op Shaper Prepare cut-plan edit no longer wipes Redo either.
- **Task id(s):** `1030`
- **Fix merge sha:** open (`agents/interrupts-fix-1030`, awaiting merge)
- **Guarding test file(s):** `tests/interrupts-fix-1030-node.test.js` (`I-03`, `I-03 memory`: one retained branch), `tests/drag-noop-redo-ux12-1011-node.test.js` (BUG-150), `tests/parameters-batch.test.js` (a refused edit keeps the stacks)
- **Status:** fixed
- **Family:** `ui-input`
- **Related:** BUG-150
- **History:** found in audit `1023` -> fixed in task `1030`. Probe before: `ESC-002 | line | after1st | Esc | base(U:1,R:1) -> ... hist=(U:1,R:0)`; after: `ESC-002 | line | after1st | Esc | base(U:1,R:1) -> ... hist=(U:1,R:1)`.

### BUG-323
- **Date / turn:** 2026-11-27 (audit ID `I-04`; fixed in task `1030`)
- **Reported by:** audit `1023` (`RCC-002..042`, phone x6)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `I-04`: re-clicking the active draw tool's button kept the tool but wiped the half-made draw and the typed box value; the constraint tools kept theirs. Advisor default (one rule): a re-click does nothing.
- **What was wrong:** `switchToTool` returned early on a same-tool call for the constraint tools only; every other tool ran `leaveActiveTool`, which cancels the draw.
- **Cause:** `packages/ui/input-manager.js` `switchToTool`.
- **Fix:** `switchToTool` (`input-manager.js:1580`) returns for ANY same-tool call (re-click or key): the tool keeps what it holds. The activation itself is `armTool` (`:1592`). A Rect / Slot variant changed from the dropdown mid-draw starts the tool again (`tool-ribbon.js:402`, `restartActiveTool`), since the draw was the old shape. This also ends the Rectangular Pattern re-click making a live pattern (`I-13`).
- **Task id(s):** `1030`
- **Fix merge sha:** open (`agents/interrupts-fix-1030`, awaiting merge)
- **Guarding test file(s):** `tests/interrupts-fix-1030-node.test.js` (`I-04` rect, line, circle, slot)
- **Status:** fixed
- **Family:** `ui-input`
- **History:** found in audit `1023` -> fixed in task `1030`. After: `RCC-006 | rect-2pt | boxTyped | re-click-same | ... boxes=[dualInput(["25","0.6"])] active=rect ... COMPLETION(Enter): dShapes=4`.

### BUG-324
- **Date / turn:** 2026-11-27 (audit ID `I-05`; fixed in task `1030`)
- **Reported by:** audit `1023` (`UND` 14 cells, `RED` 15 cells)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `I-05`: Ctrl+Z partway through a tool: the draw tools cancelled the draw and LEFT the tool; Fillet / Mirror / Dimension / the constraint tools undid the PREVIOUS finished step (an older step undone by a mid-pick Ctrl+Z) and Ctrl+Y redid a step and dropped the pick. Owner ruling: Ctrl+Z with a pick pending cancels the pick / half-made shape and STAYS in the tool, no undo step; the next Ctrl+Z undoes the previous finished step; Ctrl+Y with a pick pending does nothing to the pick.
- **What was wrong:** the history source knew only "a draw tool with `state.active`" (then Esc, which leaves the tool); a pick held by any other tool fell through to a normal undo / redo.
- **Cause:** `packages/ui/input-manager.js` `sketchHistory` (the ONE undo / redo of the Design surface, keys and footer buttons).
- **Fix:** `TOOL_PENDING` (`input-manager.js:1554`) declares what each tool holds between its picks; `sketchHistory` undo (`:1256`) runs `restartActiveTool` (cancel what it holds, clear the selection its picks lit, arm the same tool) when one is pending, else `state.undo()`; redo does nothing while one is pending (BUG-329).
- **Task id(s):** `1030`
- **Fix merge sha:** open (`agents/interrupts-fix-1030`, awaiting merge)
- **Guarding test file(s):** `tests/interrupts-fix-1030-node.test.js` (`I-05`), `tests/draw-undo-node-runner.js` (`ctrl+z while line active`: the Line tool now stays)
- **Status:** fixed
- **Family:** `ui-input`
- **History:** found in audit `1023` -> fixed in task `1030`. Probe before: `UND-019 | fillet | after1st | Ctrl+Z | base(U:1,R:1) -> tool=fillet ... hist=(U:0,R:2)` (the older step undone); after: `UND-019 | fillet | after1st | Ctrl+Z | base(U:1,R:1) -> tool=fillet ... hist=(U:1,R:1)`. Behaviour change (owner ruling): Ctrl+Z mid-draw stays in the draw tool (TASK 549 had it end the tool).

### BUG-325
- **Date / turn:** 2026-11-27 (audit ID `I-06`; fixed in task `1030`)
- **Reported by:** audit `1023` (`UND-067`, `F2-dim`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `I-06`: Ctrl+Z while a dimension label was being placed removed the dimension from the document but left `placing=true`; Ctrl+Y brought the half-placed dimension back.
- **What was wrong:** the undo restored the snapshot under the placement instead of cancelling the placement.
- **Cause:** `packages/ui/input-manager.js` `sketchHistory` (a placement was not a pending pick).
- **Fix:** the same rule as BUG-324: a placement is the Dimension tool's pending pick (`TOOL_PENDING[DIMENSION]`), so Ctrl+Z cancels it (`resetDimensionState` drops its birth step, giving Redo back, BUG-322) and stays in the tool.
- **Task id(s):** `1030`
- **Fix merge sha:** open (`agents/interrupts-fix-1030`, awaiting merge)
- **Guarding test file(s):** `tests/interrupts-fix-1030-node.test.js` (`I-06`)
- **Status:** fixed
- **Family:** `ui-input`
- **History:** found in audit `1023` -> fixed in task `1030`. Probe before: `UND-026 | dim | dimPlacing | Ctrl+Z | ... placing=true ... hist=(U:1,R:1)`, `UZY-026 | dim | dimPlacing | Ctrl+Z,Ctrl+Y | ... placing=true`; after: `UND-026 | dim | dimPlacing | Ctrl+Z | ... placing=false ... hist=(U:1,R:1)`.

### BUG-326
- **Date / turn:** 2026-11-27 (audit ID `I-08`; fixed in task `1030`)
- **Reported by:** audit `1023` (`ESC-063`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `I-08`: Esc during a point drag ended the drag but KEPT the moved position as an undo step (`U:1->2`, `R:1->0`). Owner ruling: Esc during a drag puts everything back, no undo step.
- **What was wrong:** `handleEscape` set `state.drag = null` without restoring the drag's start (only the transform-box gesture had a put-back).
- **Cause:** `packages/ui/input-manager.js` `handleEscape`.
- **Fix:** `cancelPointDrag` (`selection-tools.js:542`): the drag's ONE snapshot is restored and its step dropped (Redo given back, BUG-322). `cancelActiveWork` runs it with `cancelTransformGesture`, so Esc and a tool switch (BUG-328) both put a drag back.
- **Task id(s):** `1030`
- **Fix merge sha:** open (`agents/interrupts-fix-1030`, awaiting merge)
- **Guarding test file(s):** `tests/interrupts-fix-1030-node.test.js` (`I-08`), `tests/drag-target-release-live.test.js` (its Esc mid-drag step now asserts the put-back, owner ruling)
- **Status:** fixed
- **Family:** `ui-input`
- **History:** found in audit `1023` -> fixed in task `1030`. Probe before: `ESC-027 | select-drag | midDrag | Esc | base(U:1,R:1) -> ... hist=(U:2,R:0)`; after: `ESC-027 | select-drag | midDrag | Esc | base(U:1,R:1) -> ... hist=(U:1,R:1)`.

### BUG-327
- **Date / turn:** 2026-11-27 (audit ID `I-09`; fixed in task `1030`)
- **Reported by:** audit `1023` (`SWR-063`, screenshot `transform-box-zombie-after-switch-to-circle.png`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `I-09`: a value typed in the transform box (`#tbox-input` "30"), then the Circle tool from the ribbon: the box stayed on the canvas.
- **What was wrong:** the tool switch did not close the transform box's typed value.
- **Cause:** `packages/ui/input-manager.js` `leaveActiveTool`.
- **Fix:** `cancelActiveWork` closes it (`transform-box.js closeTransformInput`, exported for it).
- **Task id(s):** `1030`
- **Fix merge sha:** open (`agents/interrupts-fix-1030`, awaiting merge)
- **Guarding test file(s):** `tests/interrupts-fix-1030-live.test.js` (`I-09`, desktop 1280x800)
- **Status:** fixed
- **Family:** `ui-input`
- **History:** found in audit `1023` -> fixed in task `1030`. Probe before: `SWR-027 | transform | transformBoxTyped | ribbon-switch | ... tool=circle boxes=[tboxInput("30")]`; after: `SWR-027 | transform | transformBoxTyped | ribbon-switch | ... tool=circle boxes=[none]`.

### BUG-328
- **Date / turn:** 2026-11-27 (audit ID `I-12`; fixed in task `1030`)
- **Reported by:** audit `1023` (`SWK-063`, `SWK-064`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `I-12`: a tool key during a drag (a point, a transform handle) switched the tool with the drag still live until the release.
- **What was wrong:** the tool switch did not touch `state.drag`.
- **Cause:** `packages/ui/input-manager.js` `leaveActiveTool`.
- **Fix:** `cancelActiveWork` (run by `leaveActiveTool`) first puts the drag back (`cancelTransformGesture`, `cancelPointDrag`, BUG-326), then the switch.
- **Task id(s):** `1030`
- **Fix merge sha:** open (`agents/interrupts-fix-1030`, awaiting merge)
- **Guarding test file(s):** `tests/interrupts-fix-1030-node.test.js` (`I-12`)
- **Status:** fixed
- **Family:** `ui-input`
- **History:** found in audit `1023` -> fixed in task `1030`. Probe before: `SWK-027 | select-drag | midDrag | key-switch | ... tool=circle ... drag=joint ... hist=(U:2,R:0)`, `SWK-028 | transform | transformDrag | key-switch | ... drag=transform`; after: `SWK-027 ... tool=circle ... drag=no ... hist=(U:1,R:1)`, `SWK-028 ... drag=no`.

### BUG-329
- **Date / turn:** 2026-11-27 (audit ID `I-15`; fixed in task `1030`)
- **Reported by:** audit `1023` (`RED-011`, `RED-012`, `RED-041`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `I-15`: Ctrl+Y with nothing to redo cancelled a half-made 3-point rectangle / Bezier.
- **What was wrong:** `state.redo` ran `closeDrawStep` before its empty-Redo check.
- **Cause:** `packages/ui/input-manager.js` `sketchHistory` redo (it called `state.redo` mid-draw).
- **Fix:** with a pick pending (`toolPickPending`, BUG-324) the history source's redo does nothing (`input-manager.js:1256`).
- **Task id(s):** `1030`
- **Fix merge sha:** open (`agents/interrupts-fix-1030`, awaiting merge)
- **Guarding test file(s):** `tests/interrupts-fix-1030-node.test.js` (`I-15`, `I-05` Ctrl+Y)
- **Status:** fixed
- **Family:** `ui-input`
- **History:** found in audit `1023` -> fixed in task `1030`. Probe before: `RED-016 | bezier | after1st | Ctrl+Y | ... active=no ... hist=(U:1,R:0)`; after: `RED-016 | bezier | after1st | Ctrl+Y | ... active=bezier ... hist=(U:2,R:0)` (the draw's own step kept).

### BUG-330
- **Date / turn:** 2026-11-27 (audit ID `I-17`; fixed in task `1030`)
- **Reported by:** audit `1023` (`RCK` 31 cells; same cause as `B-05`, BUG-314)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `I-17`: a right-click on empty canvas in a draw tool acted as a left click: it started the shape, placed the next point or completed it (rect `shapes 8->12`, polygon `8->20`).
- **What was wrong:** only Select / Dimension consumed the right press (for the context menu); every other tool got it as a left press, and its release as a left release.
- **Cause:** `packages/ui/input-manager.js` `handlePointerDown` / `handlePointerUp`.
- **Fix:** `rightPressIgnored` (`input-manager.js:546`): in every tool but Select, a right press and its release reach no tool (after the Select / Dimension menu check). Line keeps its ruling in ONE place, `line-tool.js:130 rightClickLine`: a typed length is committed, then the chain ends; never a segment to the cursor (the `drawing-tools.js` branch is gone). Behaviour change (advisor ruling): an UNTYPED Line right-click ends the chain with NO segment (task 1028 made one); the constraint / modify tools no longer take a pick from a right press either.
- **Task id(s):** `1030`
- **Fix merge sha:** open (`agents/interrupts-fix-1030`, awaiting merge)
- **Guarding test file(s):** `tests/interrupts-fix-1030-node.test.js` (`I-17`, every draw tool and variant), `tests/interrupts-fix-1030-live.test.js` (`I-17`, desktop real right button), `tests/drawbox-fix-1028-node.test.js` (`B-05`, the untyped half now expects no segment)
- **Status:** fixed
- **Family:** `ui-input`
- **Related:** BUG-314
- **History:** found in audit `1023` -> fixed in task `1030`. Probe before: `RCK-005 | rect-2pt | after1st | right-click | DIFF[... shapes:8->12 ...]`; after: `RCK-005 | rect-2pt | after1st | right-click | ... active=rect ... shapes=8`.

### BUG-331
- **Date / turn:** 2026-11-27 (audit ID `I-18`; fixed in task `1030`)
- **Reported by:** audit `1023` (`RCK-066`, `RCK-067`, `PNF-067`, `P9B-067`, `PNP-067`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `I-18`: Dimension, a pick or a placement pending, then a right-click on empty canvas: the pick / placement was dropped. Advisor default: Dimension keeps it across a right-click and a panel click, like the other tools.
- **What was wrong:** the right press on empty canvas reached the Dimension tool as a left press (BUG-330).
- **Cause:** `packages/ui/input-manager.js` `handlePointerDown`.
- **Fix:** the BUG-330 rule (`rightPressIgnored`); the footer click already kept the pick.
- **Task id(s):** `1030`
- **Fix merge sha:** open (`agents/interrupts-fix-1030`, awaiting merge)
- **Guarding test file(s):** `tests/interrupts-fix-1030-node.test.js` (`I-18`)
- **Status:** fixed
- **Family:** `ui-input`
- **History:** found in audit `1023` -> fixed in task `1030`. Probe before: `RCK-046 | dim | after1st | right-click | DIFF[hasActive:true->false ...]`; after: `RCK-035 | dim | after1st | right-click | ... active=dim`.

### BUG-332
- **Date / turn:** 2026-11-27 (audit ID `I-19`; fixed in task `1030`)
- **Reported by:** audit `1023` (112 cells: middle pan, footer, Sketches browser, Parameters window)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab)
- **Report:** `I-19`: with a value box open, a middle-drag pan or a click on the footer bar took the keyboard focus out of the box (`input -> body`): Enter then did nothing. Advisor default: a pan or a footer click gives the focus back to the box; a click INTO the Parameters window or the Sketches browser keeps the focus there, and the next canvas press gives it back.
- **What was wrong:** the document pointerdown handler gave the canvas the focus on every press outside a text field, and nothing gave it back to the box.
- **Cause:** `packages/ui/input-manager.js` document `pointerdown` listener.
- **Fix:** the same listener (`input-manager.js:1190`) remembers the value box being typed in (`.dim-input`, `.sk-dual-input input`); a press into `FOCUS_KEEPING_PANELS` (`:541`) keeps the focus there; a middle-button press on the canvas, a press on the footer bar (`FOCUS_RETURNING_BARS`), or the first canvas press after a panel visit gives the focus back to that box once the press is done (when it is still shown). A tool's own canvas press is left to the tool; any other press (a ribbon button, the Done check) is as before.
- **Task id(s):** `1030`
- **Fix merge sha:** open (`agents/interrupts-fix-1030`, awaiting merge)
- **Guarding test file(s):** `tests/interrupts-fix-1030-live.test.js` (`I-19`, desktop 1280x800)
- **Status:** fixed
- **Family:** `ui-input`
- **History:** found in audit `1023` -> fixed in task `1030`. Probe before: `PAN-009 | circle | boxTyped | middle-pan | ... focus=body.sk-has-footer || COMPLETION(Enter): dShapes=0`; after: `PAN-009 | circle | boxTyped | middle-pan | ... focus=#dimInput || COMPLETION(Enter): dShapes=1`.

### BUG-333
- **Date / turn:** 2026-11-27 (audit ID `I-21`; fixed in task `1030`)
- **Reported by:** audit `1023` (phone 390x844, pinch 8 + pan 9 cells)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab, phone)
- **Report:** `I-21`: the first finger of a two-finger pinch / pan acted as a press: it started a Line, completed a Rect / Polygon / Bezier, trimmed, picked in Coincident / Dimension, before the second finger made it a pinch.
- **What was wrong:** the canvas handled a finger's press at once; the second finger only stopped LATER presses. The second finger's own release then reached the tool as a click.
- **Cause:** `packages/ui/input-manager.js` svg `pointerdown` / `pointerup` listeners.
- **Fix:** a finger's press is held back (`input-manager.js:1046`) until it is the press of ONE finger: it lifts, leaves the `LONG_PRESS_SLOP` circle, or `LONG_PRESS_MS` pass (the hold's own window, `#ui/long-press.js`; no new number). A second finger in that time drops the held press; the pinch fingers' releases go to the pan / zoom only. The finger is known to the pinch at once. A long press is unchanged (the held press runs first, then the hold decides; a finger on a transform-box handle is never a hold). A finger on a tool's drag arrow (Fillet / Offset / Pattern) grabs it at once, not held (`drag-arrow-handle.js dragArrowUnder`, the arrow's own reach rule; merge-gate fix: `offset-arrow-652`, `fillet-arc-arc-648` read the drag state at the press).
- **Task id(s):** `1030`
- **Fix merge sha:** open (`agents/interrupts-fix-1030`, awaiting merge)
- **Guarding test file(s):** `tests/interrupts-fix-1030-live.test.js` (`I-21`, phone 390x844, real touch); `tests/offset-arrow-652.test.js`, `tests/fillet-arc-arc-648.test.js` (a finger on the arrow drags at once)
- **Status:** fixed
- **Family:** `ui-input`
- **History:** found in audit `1023` -> fixed in task `1030`. Probe before: `PH-003 | rect-2pt | after1st | pinch zoom (2 fingers) | ... active=no shapes=12`; after: `PH-003 | rect-2pt | after1st | pinch zoom (2 fingers) | ... active=rect shapes=8`.

### BUG-340
- **Date / turn:** 2026-11-27 (task `1032`)
- **Reported by:** owner (phone screenshot)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab, Select tool; desktop and phone)
- **Report:** dragging a line by its middle, the grabbed spot snaps to what it passes over (the Y axis showed the on-line diamond), so the line jumps.
- **What was wrong:** a drag that starts on a curve's BODY (a line by its middle, a circle or arc by its rim, a bezier) took the snap found at the cursor: the grabbed spot was pulled onto the Y / X axis, a grid node, a line it crossed or a point it passed, and drawn with the snap glyph. The release added nothing (only a point drag's release adds a constraint), but the shape landed on the snap point, not at the cursor. Fusion, measured by the advisor with the real mouse 2026-11-27 (scratch doc, 101 px/cm): A: one free line dragged by its middle, its end dropped 0.1 cm from another line's end point (8,3): end at (8.0861, 3.0596), no constraint added; C: the grabbed spot itself dropped 0.1 cm from that point: no snap, no constraint; B: two lines box-selected (with their end points), dragged by one line's middle: both move, no snap, no constraint.
- **Cause:** `packages/ui/input-handlers/selection-tools.js dragToward`: the no-snap rule covered only the GROUP drag (`state.drag.group`, task 588); a body drag (`DRAG_TYPES.LINE`, `startShapeDrag`) kept the cursor's snap ("A BODY / LINE drag is unchanged: its snap is taken at the cursor").
- **Fix:** the group drag's one no-snap rule in `dragToward` also covers a drag of `DRAG_TYPES.LINE` (every body drag: line, circle rim, arc rim, bezier, rectangle / polygon edge): no snap is held or drawn during the drag and the grabbed spot stays at the cursor; the release was already snap-free for it. A drag that starts on a point (joint / cluster) snaps as before.
- **Task id(s):** `1032`
- **Fix merge sha:** open (`agents/bodydrag-1032`, awaiting merge)
- **Guarding test file(s):** `tests/body-drag-no-snap-1032-node.test.js` (Fusion cells A, B, C; a circle rim and an arc rim; a point drag still snaps and adds the coincident); `tests/body-drag-no-snap-1032-live.test.js` (Shaper, desktop 1280x800 mouse and phone 390x844 touch: no snap glyph at any pointer of the body drag)
- **Status:** fixed
- **Family:** `ui-input`
- **History:** reported by the owner -> fixed in task `1032`. Node before: `A: end (80.9132, 30.0000) want (80.9132, 30.5939)` (the grabbed spot on line T), `C: grabbed spot (80.0000, 30.0000) cursor (80.8557, 30.5939)`, circle radius `120.4159` (snapped to the point) vs cursor `121.2212`; after: `A: end (80.9132, 30.5939) want (80.9132, 30.5939)`, `C: grabbed spot (80.8557, 30.5939) cursor (80.8557, 30.5939)`, circle radius `121.2212`. Behaviour change: a body drag no longer snaps to the grid, the axes, points or curves.

### BUG-370
- **Date / turn:** 2026-11-27 (audit `1035` appendix `N-1`; fixed in task `1036`)
- **Reported by:** audit `1035` (probe `probe-preview-vs-final.mjs`, section A)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (shared Design tab, Arc tool)
- **Report:** `N-1`: the Center Point Arc PREVIEW goes the wrong way when the sweep crosses 180 deg. Centre, start at 170 deg, cursor moved +20 deg to 190 deg: the preview path is `A ... 0 1,0` (the 340 deg arc the other way); the committed arc is `sweep true`, 20.29 deg. Also the 3-Point Arc preview (same mirror).
- **What was wrong:** the dashed preview drew the long way round whenever the atan2 angles wrapped at the +-180 deg line; the arc placed by the click was the short one.
- **Cause:** `packages/ui/preview-manager.js` `updatePreview` (`case 'arc'`) copied only centre / radius / angles / cursor into `state.active.preview` and dropped the `largeArc` / `sweep` the Arc tool passes (`arc-tool.js` `drawSweepPreview`, `drawThreePointPreview`), so the renderer's fallback (`svg-renderer.js` arc preview) guessed the flags from the raw angles (`endAngle > startAngle`).
- **Fix:** `preview-manager.js` passes the tool's `largeArc` and `sweep` with the angles (one place); the renderer already prefers them. The arc slots' previews were already right (`calculateArcPath` with the slot's own sweep, the commit's data): guarded, not changed.
- **Task id(s):** `1036`
- **Fix merge sha:** open (`agents/shape-bugs-1036`, awaiting merge)
- **Guarding test file(s):** `tests/shape-bugs-1036-node.test.js` (`N-1a` Center Point Arc both ways + a 270 deg sweep, `N-1b` 3-Point Arc, `N-1c` arc slots), `tests/arc-preview-1036-live.test.js` (desktop 1280x800 mouse, phone 390x844 touch)
- **Status:** fixed
- **Family:** `ui-input`
- **History:** found in audit `1035` (`N-1`) -> fixed in task `1036`. Probe before: `A preview path d: M -29.246...,5.938... A 29.843...,29.843... 0 1,0 ...` vs `A committed arc: sweep true span(deg) 20.29 large false`; after: the live test prints `desktop: preview flags 0,1 ..., committed flags 0,1`.

### BUG-371
- **Date / turn:** 2026-11-27 (audit `1035` appendix `N-3`; fixed in task `1036`)
- **Reported by:** audit `1035` (probe `probe-preview-vs-final.mjs`, section C)
- **App(s) & host:** SketchStudio (Export SVG, "Invert Y axis (SVG)")
- **Report:** `N-3`: SVG export with "Invert Y axis (SVG)" does not flip closed line loops: a closed 4-line loop comes out at y 0..5 while a lone line at y 2 comes out at y -2. Every closed rectangle in such an export is mirrored against the rest.
- **What was wrong:** the closed line loops (written as one `<polygon>`) kept their Y while every other part was flipped.
- **Cause:** `apps/sketchstudio/ui/export-manager.js` `buildSVG` `emitPolygonFromCycle` applied `scale` itself and not the Y flip of `transform()`.
- **Fix:** ONE Y flip in `buildSVG`: every written point goes through `transform` (the polygon's corners now too); a mirrored arc turns the other way (`turn`, see BUG-376). With the box off the output is byte-identical (probe `probe-n3-svg-invert`, `OFF-IDENTICAL`). The DXF writer (always Y-up, task `1027`) is untouched.
- **Task id(s):** `1036`
- **Fix merge sha:** open (`agents/shape-bugs-1036`, awaiting merge)
- **Guarding test file(s):** `tests/shape-bugs-1036-node.test.js` (`N-3`: every part, with and without arcApprox, and the DXF unchanged by the box), `tests/export-roundtrip-1027-node.test.js`
- **Status:** fixed
- **Family:** `export-svg`
- **Related:** BUG-301, BUG-376
- **History:** found in audit `1035` (`N-3`) -> fixed in task `1036`. Probe before: `polygon  points="0.000,0.000 10.000,0.000 10.000,5.000 0.000,5.000"` with invertY; after: `polygon  points="0.000,0.000 10.000,0.000 10.000,-5.000 0.000,-5.000"`.

### BUG-372
- **Date / turn:** 2026-11-27 (audit `1035` appendix `N-4`; fixed in task `1036`)
- **Reported by:** audit `1035` (probe `probe-thumbnail.mjs`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (project manager thumbnails)
- **Report:** `N-4`: a design that is only text has no thumbnail; a mixed design's thumbnail has no letters; the thumbnail draws construction geometry, which the export leaves out. Advisor rule: the thumbnail draws what the export draws (no construction) plus the text's letters.
- **What was wrong:** text-only designs showed the blank placeholder; letters never appeared; construction circles / lines were drawn.
- **Cause:** `packages/ui/design-thumbnail.js` flattened the STORED document's shapes as they are: `serializeDocument` (`core/document.js`) never stores a text's letters (they are rebuilt from the font on a read), and no filter left construction out.
- **Fix:** `designThumbnailSvg` (now async) reads the shapes the export reads (`exportedShapes`, BUG-300's rule moved from `export-manager.js` to `#core/curve-kinds.js` so both read one declaration) on a working copy of the geometry, after THE letter rebuild a document read runs (`#ui/text-fonts.js syncTextOutlines`, from the page's one font library: each font downloaded once). `project-manager.js fillThumbs` fills each tile when its thumbnail settles and does not wait for it, so a design without text never waits on a font. Measured (live, 20 designs, 6 with text, 3 rounds): non-text tiles shown 93 / 85 / 83 ms before, 121 / 145 / 146 ms after; every tile (letters included) shown 121 / 145 / 146 ms after (never before).
- **Task id(s):** `1036`
- **Fix merge sha:** open (`agents/shape-bugs-1036`, awaiting merge)
- **Guarding test file(s):** `tests/shape-bugs-1036-node.test.js` (`N-4a` text-only, `N-4b` mixed + construction, `N-4c` no font wait), `tests/project-actions.test.js`
- **Status:** fixed
- **Family:** `storage-lifecycle`
- **Related:** BUG-300
- **History:** found in audit `1035` (`N-4`) -> fixed in task `1036`. Probe before: `D text-only design thumbnail: null`, `D construction-only circle thumbnail drawn: yes, 955 chars`.

### BUG-373
- **Date / turn:** 2026-11-27 (audit `1035` appendix `N-5`; fixed in task `1036`)
- **Reported by:** audit `1035` (read, not run); probed in task `1036` (`probe-n5-shaper-arc.mjs`)
- **App(s) & host:** Shaper (Fusion selection / STL import)
- **Report:** `N-5`: Shaper's Fusion / STL import gives its arcs no equal-radius rule; BUG-046's fix (task `789`) went only into the shared import landing.
- **What was wrong:** an arc imported from Fusion had no structural equal: a radius edit moved its start only (probe: `radius 30 -> 40 applied true   radii after (start,end) 40.000,30.000`).
- **Cause:** `apps/shaper/src/fusion-import.js importFusionSelection` landed the parsed joints and shapes with its own loops and never added `arcStructuralConstraints` (the shared landing in `packages/ui/sketch-import.js` did).
- **Fix:** the landing is ONE function, `landImportedGeometry` (`packages/ui/sketch-import.js`: joints, shapes, each arc's structural equal); the SVG / DXF import and Shaper's Fusion / STL import both call it. Shaper's explicit `stampSketch` calls went with its loops (the state's own `joints.set` / `shapes.push` stamp the active sketch). Not changed: Shaper's import still adds no import groups (`groupImported`), as before.
- **Task id(s):** `1036`
- **Fix merge sha:** open (`agents/shape-bugs-1036`, awaiting merge)
- **Guarding test file(s):** `tests/shape-bugs-1036-node.test.js` (`N-5`), `tests/import-arc-equal-789-node.test.js`, `tests/fusion-import-664-node.test.js`
- **Status:** fixed
- **Family:** `solver`
- **Related:** BUG-046
- **History:** found in audit `1035` (`N-5`, read only) -> probed and fixed in task `1036`. Probe before: `N5 structural equal constraints on the arc: 0`, radii after a 30 -> 40 edit `40.000,30.000`; after: the node test `N-5` holds both ends at 40.

### BUG-374
- **Date / turn:** 2026-11-27 (audit `1035` appendix `N-6`)
- **Reported by:** audit `1035` (read, not run; latent)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (profile fill)
- **Report:** `N-6`: the profile-fill cache ignores a bezier's control points, so a change of `c1` / `c2` alone keeps a stale fill.
- **What was wrong:** unknown (no user path found that changes `c1` / `c2` alone in a frame; the fill is off by default).
- **Cause:** `packages/ui/profile-fill.js geometrySignature` hashes joints, type, construction, radius and arc sweep, not a bezier's `c1` / `c2`.
- **Fix:** none yet (task `1036` was told to record it only).
- **Task id(s):** none
- **Fix merge sha:** none
- **Guarding test file(s):** none
- **Status:** open
- **Family:** `toolpath-geometry`
- **History:** found in audit `1035` (`N-6`), recorded open in task `1036`.

### BUG-375
- **Date / turn:** 2026-11-27 (audit `1035` appendix `N-7`; fixed in task `1036`)
- **Reported by:** audit `1035` (read, not run); probed in task `1036` (`probe-n7-fillet-split.mjs`)
- **App(s) & host:** SketchStudio, Shaper, Pen Plotter, Trace (Trim, Break on a fillet arc)
- **Report:** `N-7`: trim and break copy `filletSharp` onto both pieces, so two arcs claim one virtual corner.
- **What was wrong:** probe: after a Break both pieces claim the corner V. While each piece is tangent to a leg V is held on, that is needed (the lock rule, `#core/lock-state.js`, reads V through the arc at each leg: both legs stay locked). A piece that touches NO leg (one leg deleted first, then Break / Trim) still claimed V: a copy + paste of it brought a stray virtual-sharp cross with it.
- **Cause:** `packages/core/break.js splitArcConstraints` (THE split that Break of an arc, Break of a circle and Trim of an arc's middle share) moved the tangents onto the piece that meets each leg, but the piece is a copy of the target (`{ ...target }`), so both kept `filletSharp`.
- **Fix:** at the end of `splitArcConstraints`, an arc that is tangent to no curve V is held on (`touchesFilletLeg`) drops `filletSharp`; one that still touches a leg keeps it (no change for a fillet with both legs).
- **Task id(s):** `1036`
- **Fix merge sha:** open (`agents/shape-bugs-1036`, awaiting merge)
- **Guarding test file(s):** `tests/shape-bugs-1036-node.test.js` (`N-7a` both legs: both keep V, legs still locked; `N-7b` Break with a leg gone; `N-7c` Trim with a leg gone)
- **Status:** fixed
- **Family:** `solver`
- **History:** found in audit `1035` (`N-7`, read only) -> probed and fixed in task `1036`. Probe before: `B after break: arcs claiming V ...: 2 [... live=false legs=s..._3_1 | Abrk_... live=false legs=-]`; after: `N-7b`: only the piece on the remaining leg claims V, a paste of the legless piece adds 0 virtual sharps.

### BUG-376
- **Date / turn:** 2026-11-27 (found in task `1036` while fixing BUG-371)
- **Reported by:** worker (task `1036`, probe `probe-n3-svg-invert.mjs`)
- **App(s) & host:** SketchStudio (Export SVG, "Invert Y axis (SVG)", arcs written as `A` paths)
- **Report:** with "Invert Y axis" an arc centred (50,10) from (60,10) to (50,20) was written `M 60 -10 A 10 10 0 0 1 50 0`: its centre flipped but the arc itself only moved (not mirrored, the same turning).
- **What was wrong:** an exported arc kept its shape and direction under the flip; with arcApprox (sampled points) it was right.
- **Cause:** `apps/sketchstudio/ui/export-manager.js buildSVG` wrote the arc's ends as the flipped centre plus the UNflipped `r sin(angle)`, and kept the sweep flag.
- **Fix:** the BUG-371 rule: the ends go through `transform` and the sweep flag turns with the mirror; after: `M 60 -10 A 10 10 0 0 0 50 -20`.
- **Task id(s):** `1036`
- **Fix merge sha:** open (`agents/shape-bugs-1036`, awaiting merge)
- **Guarding test file(s):** `tests/shape-bugs-1036-node.test.js` (`N-3`, both arc directions)
- **Status:** fixed
- **Family:** `export-svg`
- **Related:** BUG-371
- **History:** found and fixed in task `1036`.

---

## Family index

Entries in each family are listed in chronological date order (`MM-DD`, oldest first) so recurring patterns read as a timeline.

| Family | Timeline (oldest first) |
|---|---|
| `build-deploy` | BUG-062 (11-21) |
| `export-svg` | BUG-300 (11-27), BUG-301 (11-27), BUG-022 (11-16), BUG-025 (11-16), BUG-034 (11-16), BUG-035 (11-17), BUG-043 (11-18), BUG-049 (11-19), BUG-371 (11-27), BUG-376 (11-27) |
| `flaky-test` | BUG-004 (11-15), BUG-011 (11-15), BUG-016 (11-15), BUG-047 (11-19), BUG-052 (11-19), BUG-068 (11-22), BUG-069 (11-23), BUG-087 (11-25) |
| `fusion-frame` | BUG-024 (11-16), BUG-048 (11-19), BUG-064 (11-21), BUG-071 (11-23), BUG-077 (11-23), BUG-084 (11-25), BUG-085 (11-25), BUG-086 (11-25), BUG-089 (11-25), BUG-173 (11-26) |
| `layout-overlap` | BUG-006 (11-15), BUG-007 (11-15), BUG-017 (11-15), BUG-019 (11-16), BUG-020 (11-16), BUG-028 (11-16), BUG-030 (11-16), BUG-031 (11-16), BUG-040 (11-18), BUG-041 (11-18), BUG-055 (11-20), BUG-057 (11-20), BUG-070 (11-20), BUG-078 (11-23), BUG-083 (11-24), BUG-224 (11-26), BUG-226 (11-26) |
| `notice-wording` | BUG-079 (11-24), BUG-090 (11-25), BUG-114 (11-26), BUG-227 (11-26), BUG-317 (11-27) |
| `snap-not-applied` | BUG-073 (11-23), BUG-075 (11-23), BUG-136 (11-26, open), BUG-137 (11-26), BUG-138 (11-26), BUG-183 (11-26), BUG-193 (11-26), BUG-210 (11-27), BUG-212 (11-27), BUG-213 (11-27), BUG-311 (11-27) |
| `solver` | BUG-005 (11-15), BUG-008 (11-15), BUG-018 (11-15), BUG-046 (11-18), BUG-059 (11-20), BUG-060 (11-20), BUG-076 (11-23), BUG-091 (11-26), BUG-092 (11-26), BUG-094 (11-26), BUG-095 (11-26), BUG-096 (11-26), BUG-098 (11-26), BUG-099 (11-26), BUG-120 (11-26), BUG-121 (11-26), BUG-122 (11-26), BUG-123 (11-26), BUG-126 (11-26), BUG-134 (11-26), BUG-146 (11-26), BUG-152 (11-26), BUG-154 (11-26), BUG-160 (11-26), BUG-170 (11-26), BUG-171 (11-26), BUG-191 (11-26), BUG-192 (11-26), BUG-195 (11-26), BUG-196 (11-26), BUG-197 (11-26), BUG-198 (11-26), BUG-201 (11-26), BUG-373 (11-27), BUG-375 (11-27) |
| `dimension-display` | BUG-130 (11-26), BUG-131 (11-26), BUG-132 (11-26), BUG-133 (11-26), BUG-225 (11-26) |
| `stl-relief` | BUG-050 (11-19), BUG-058 (11-20), BUG-063 (11-21) |
| `stock` | BUG-072 (11-23), BUG-080 (11-24), BUG-088 (11-25) |
| `storage-lifecycle` | BUG-305 (11-27), BUG-306 (11-27), BUG-014 (11-15), BUG-015 (11-15), BUG-023 (11-16), BUG-372 (11-27) |
| `sync` | BUG-001 (11-14), BUG-002 (11-14), BUG-012 (11-15), BUG-013 (11-15), BUG-036 (11-17), BUG-038 (11-17), BUG-065 (11-21), BUG-081 (11-24), BUG-082 (11-24) |
| `tool-bypasses-constraint-manager` | BUG-074 (11-23) |
| `toolpath-geometry` | BUG-032 (11-16), BUG-033 (11-16), BUG-044 (11-18), BUG-051 (11-19), BUG-054 (11-20), BUG-056 (11-20), BUG-061 (11-20), BUG-066 (11-21), BUG-067 (11-22), BUG-374 (11-27, open) |
| `ui-input` | BUG-003 (11-14), BUG-009 (11-15), BUG-010 (11-15), BUG-021 (11-16), BUG-027 (11-16), BUG-042 (11-18), BUG-045 (11-18), BUG-053 (11-20), BUG-093 (11-26), BUG-097 (11-26), BUG-100 (11-26), BUG-101 (11-26), BUG-102 (11-26), BUG-103 (11-26), BUG-104 (11-26), BUG-105 (11-26), BUG-110 (11-26), BUG-111 (11-26), BUG-112 (11-26), BUG-113 (11-26), BUG-115 (11-26), BUG-124 (11-26), BUG-125 (11-26), BUG-135 (11-26), BUG-140 (11-26), BUG-141 (11-26), BUG-142 (11-26), BUG-143 (11-26), BUG-144 (11-26), BUG-145 (11-26), BUG-147 (11-26), BUG-150 (11-26), BUG-151 (11-26), BUG-153 (11-26), BUG-161 (11-26), BUG-172 (11-26), BUG-174 (11-26), BUG-180 (11-26), BUG-182 (11-26), BUG-190 (11-26), BUG-194 (11-26), BUG-199 (11-26), BUG-200 (11-26), BUG-220 (11-26), BUG-221 (11-26), BUG-222 (11-26), BUG-223 (11-26), BUG-228 (11-26), BUG-307 (11-27), BUG-310 (11-27), BUG-312 (11-27), BUG-313 (11-27), BUG-314 (11-27), BUG-315 (11-27), BUG-316 (11-27), BUG-318 (11-27), BUG-319 (11-27), BUG-211 (11-27), BUG-214 (11-27), BUG-215 (11-27, open), BUG-216 (11-27, open), BUG-320 (11-27), BUG-321 (11-27), BUG-322 (11-27), BUG-323 (11-27), BUG-324 (11-27), BUG-325 (11-27), BUG-326 (11-27), BUG-327 (11-27), BUG-328 (11-27), BUG-329 (11-27), BUG-330 (11-27), BUG-331 (11-27), BUG-332 (11-27), BUG-333 (11-27), BUG-340 (11-27), BUG-370 (11-27) |
| `import-svg` | BUG-302 (11-27), BUG-303 (11-27), BUG-304 (11-27) |
| `units` | BUG-026 (11-16), BUG-029 (11-16), BUG-037 (11-17), BUG-039 (11-17), BUG-181 (11-26) |

---

## Audits

Audit-only findings live in their dedicated audit documents rather than being duplicated in the table above:

- [docs/SNAP-CONSTRAINT-AUDIT-869.md](SNAP-CONSTRAINT-AUDIT-869.md) — Snap / pick constraint audit (`424` live cells, `102` failures across causes A–J; paired with BUG-073, BUG-074, BUG-075).
- [docs/STOCK-MODEL-890.md](STOCK-MODEL-890.md) — Unified Stock model inventory findings `F1`–`F5` (empty Stock thickness, `reviewSig`, Stock loop depth, per-selection `thicknessMm`, multi-body thickness).
- [docs/SOLVER-UX-AUDIT-1000.md](SOLVER-UX-AUDIT-1000.md), [docs/SOLVER-UX-AUDIT-1000B.md](SOLVER-UX-AUDIT-1000B.md), [docs/DIMENSION-AUDIT-1003.md](DIMENSION-AUDIT-1003.md) — Solver UI/UX & Dimension audits (tasks `1000`, `1000B`, `1003`; paired with BUG-091..BUG-095 fixed in task `1007`; BUG-100..BUG-105 fixed in task `1004`; BUG-120..BUG-126 fixed in task `1006`; BUG-130..BUG-138 fixed in task `1010`; BUG-150..BUG-154 fixed in task `1011`; BUG-160..BUG-161 fixed in task `1012`; BUG-170..BUG-174 fixed in task `1014`; BUG-180..BUG-183 fixed in task `1013`; BUG-140..BUG-147 fixed in task `1008`).
- [docs/FILES-AUDIT-1024.md](FILES-AUDIT-1024.md) — Files and documents audit (task `1024`: Save / Open / tabs / import / templates / export / file dialog; rows `F-01`..).
- [docs/DESIGN-RUN-AUDIT-1016.md](DESIGN-RUN-AUDIT-1016.md), [docs/DESIGN-RUN-AUDIT-1017.md](DESIGN-RUN-AUDIT-1017.md) — Real-design audits, parts A-D (tasks `1016`, `1017`; rows `R1-*` / `R2-*`; fixes in tasks `1018`-`1021`; BUG-190..BUG-199 from task `1018`: R1-01, R1-02, R1-03, R1-05, R1-07, R1-12, R2-01, R2-03, R2-05, R2-13).
- [docs/DRAWBOX-AUDIT-1026.md](DRAWBOX-AUDIT-1026.md) — Draw-box audit (task `1026`; every typed size input of the drawing and modify tools, `425` live cells, rows `B-01`..`B-19`; B-01..B-09, B-13, B-14, B-15, B-18, B-19 fixed in task `1028` as BUG-310..BUG-319).
- `docs/SHAPE-MODEL-PLAN-1035.md` (branch `agents/shape-model-1035`) — Shape-model audit (task `1035`, plan only; appendix `N-1`..`N-7`: N-1, N-3, N-4, N-5, N-7 fixed in task `1036` as BUG-370..BUG-373 and BUG-375, with BUG-376 found there; N-6 open as BUG-374; N-2 belongs to task `1034`).
- [docs/INTERRUPTS-AUDIT-1023.md](INTERRUPTS-AUDIT-1023.md) — Interruptions audit (task `1023`: every ribbon tool x Esc / tool switch / re-click / Ctrl+Z / Ctrl+Y / right-click / zoom / pan / panel click / Delete / blur / phone touch; findings `I-01`..`I-23`; I-01..I-06, I-08, I-09, I-12, I-15, I-17..I-19, I-21 fixed in task `1030` as BUG-320..BUG-333; I-07 fixed before it (task `1020`), I-20 / I-22 and the 3-point rectangle half of I-02 by task `1028`; the 1030 guards cover them).
