# Input unification plan (task 1031)

Status: PLAN ONLY. No app code is changed by this task. Owner-approved 2026-11-27.

**How to read the references**
- `file:line` is at `origin/main` **f04e30c5** unless it is marked **[1030]**. A [1030] reference is at `origin/agents/interrupts-fix-1030` **7577a2cb**, which is merging now.
- Paths are relative to `packages/`. `IM` = `ui/input-manager.js`, `NIM` = `ui/numeric-input-manager.js`, `BT` = `ui/input-handlers/base-tool.js`, `HM` = `ui/hover-manager.js`, `SD` = `ui/snap-detection.js`.
- Every line was found by reading the code. Some entries were read by helper agents. I re-read the ones the plan rests on: Circle, base-tool, drawing-tools, input-manager down/move/up/keys/listeners, the 1030 diff, the Enter snap path, Arc drag, Slot span, Polygon Enter, the legacy Rect box.
- Three things were run as untracked read-only probes in `.evidence/1031/`: the Enter-vs-click snap, the Arc drag, and the Slot typed span. Their output is quoted where it is used.
- **(read, not run)** marks a behaviour inferred from the code alone.

## The owner's target (his words, kept)

- Every tool keeps every way of drawing it has:
  - variants (Rect 2-point / 3-point / centre, the 5 Slots, the Arcs);
  - typing values while drawing OR just clicking;
  - the phone and desktop interactions that differ. Phone: tap, hold, the Done check, two-finger pan/zoom, drawers. Desktop: hover, right-click menus, keys, Tab between boxes.
- What becomes ONE is the plumbing under them.
  - Each input device is translated ONCE, into a few shared events: one desktop translator, one touch translator, one box/keyboard translator, NOT per tool. The events are, for example: step done at a point with its typed values, preview move, cancel, undo, finish.
  - A tool describes itself as data, plus ONE build function that turns the finished points and values into geometry. Per variant, the data is: its list of steps, what each step's pick accepts, and which value boxes each step offers.
  - Same step = same result whatever the input device.
- Tool files then never listen to pointer, key or touch events. A gate test (grep) enforces it.

Today's state, in one sentence: `ui-input` is the largest family in `docs/BUG-ARCHIVE.md`. It has 61 entries on main, and 75 at [1030] (BUG-320..333 added). Most of those bugs are one tool with two code paths for one step that disagree.

---

## 1. Inventory

### 1.0 The plumbing every tool shares today

| Entry | Where | What it does today |
|---|---|---|
| svg `pointerdown` | IM:1017-1032 ([1030] :1057-1086) | Syncs the Done check (IM:1001-1015), then `handlePointerDown`. [1030] holds a finger's press back until it lifts, leaves `LONG_PRESS_SLOP`, or `LONG_PRESS_MS` passes. A second finger drops the press (`heldTouch`, `pinchFingers`, [1030] :1048-1056). |
| `handlePointerDown` | IM:540-741 ([1030] :549) | Steps in order: touch pinch first (:553-555); middle-button pan (:558); right press consumed for Select/Dimension on a menu target (:564); [1030] `rightPressIgnored`: a right press reaches no other tool except Line's `rightClickLine` ([1030] :547, :575-579); snap update (:567); hit pick: a locked hover snap wins, else a fresh `toolSnap` with `snapBoostFor(isTouch)` (:597-650); other-sketch pick (:653-657); `constraintAt` (:661); pattern session (:664); transform box (:668); Select/PAN empty pan (:671-674); `curveRefusal` gate (:676-681); per-tool `switch` (:685-737); pan fallback (:739). |
| `toolSnap` | IM:393-400 | Drawing tools: `findSnap` on every sketch; a locked or hidden sketch or a text letter gives a position only. Other tools: `findSnap` with `constraintToolPicks(state)` (task 1020). |
| `updateSnapTarget` | IM:402-537 | Writes `state.snapTarget` (locked or null, :496-512), `state.activeSnap`, and **`state.active.preview.snapTarget`** (:519-527). Also drives the magnifier (:536). |
| svg `pointermove` → `handlePointerMove` | IM:1033-1036, :743-856 | Pattern drag first (:744), pan (:747), snap update (:759), idle hover (:785-787), edge pan for drag/draw (:790-824), per-tool `switch` (:829-854). The Rect legacy preview runs on every move (:839-842). |
| svg `pointerup` → `handlePointerUp` | IM:1037-1052, :858-955 | [1030] a right release is ignored (:876). Touch pinch release (:864-866); pattern (:867); transform box (:868-872); lost-snap recovery within 200 ms (:885-891); pan release unless a geometry drag (:898-909); per-tool `switch` (:915-945); Rect `getLiveLockedPoint` and `applyLiveRectConstraints` (:927-935). |
| svg `pointercancel` | IM:1053-1058 | Touch only. |
| wheel (svg + document fallback) | IM:1059, :1067-1076, :1139-1157 | Zoom, then a fake mouse move re-previews the drawing tools (:1148-1150). |
| `panzoom:viewportChanged` | IM:1096-1114 | Same fake mouse move after a pan (:1104-1106). |
| document `contextmenu` | IM:1083-1092 ([1030] :1142) | Line-while-active: suppressed. Select/Dimension: the shared menu. **Every other tool: the browser's native menu shows** (:1086). |
| touch hold (long press) | IM:962-982, `ui/long-press.js:9-29` | Select/Dimension on a context target: opens the menu (`openContextMenuFor` IM:1348). |
| Done check | IM:983-1015, `ui/done-button.js:70-130` | `DONE_ACTIONS` per tool: Line, Mirror, Fillet, Offset, Slot (:986-996), plus the pattern session (:998). |
| `live-rect-commit` (window) | IM:1117-1127 | The legacy Rect box's Enter fakes a pointerup at (0,0) with pointerId -1. |
| document `pointerdown` focus | IM:1130-1135 ([1030] focus rules :544, I-19) | Gives the canvas the focus; [1030] gives it back to a typing box after a pan or footer press. |
| document `keydown` | IM:1227-1320 ([1030] :1307) | Skips INPUT/TEXTAREA targets (:1230). Order: clipboard; profile keys; Dimension `dim.place` / `dim.typeValue` (:1259-1277); per-tool keys: Line :1279, Rect (legacy) :1282-1286, Slot :1287, Circle :1290, Bezier :1293, Fillet :1296, Mirror :1299, pattern :1300; group; Delete; Esc → `handleEscape` (:1305); Undo/Redo (:1306); F (:1310); tool keys (:1318). Keys are declared in `ui/shortcuts.js` (e.g. `draw.typeValue` :104, `line.finish` :109). |
| `liveDimensionCancelled` (window) | IM:1222-1226 ([1030] :1301) | A box's Esc = the canvas Esc. [1030]: every tool except Select; `detail.undo` = the canvas Undo. |
| Value boxes | NIM `showSingleInput` :426, `showDualInput` :463, `handleCommit` :719, `handleCancel` :1067 | Enter dispatches window `liveDimensionApplied` with `{confirmedBy:'enter', typed, expressions, names, assigns}` (:757-770). Input dispatches `liveDimensionPreview` (:932-961). Each tool listens through `BT` `setupDimensionListeners` (:143-161) and filters by `field` / `kind`. |
| Cancel / tool switch / Undo | [1030] `cancelActiveWork` :1517, `leaveActiveTool` :1546, `TOOL_PENDING` :1556, `toolPickPending` :1567, `restartActiveTool` :1574, `switchToTool` :1582, `armTool` :1594, `handleEscape` :1645, history `undo` :1258 | One cancel for Esc, tool switch and Undo with a pick pending. Each tool is still reset by its own `reset*State` call (IM [1030] :1517-1540). |

### 1.1 Steps, picks, boxes and commit: one row per tool and variant

"Locked snap" = the snap the cursor shows within magnet reach (IM:496). "Raw" = the pointer's world point.

| Tool / variant | Steps | Each step accepts | Value boxes | Commit |
|---|---|---|---|---|
| **Circle** (centre + Ø; the only variant: `ui/tool-ribbon.js:52`) | 1. centre: press (joint made at the press, `BT:49-66`). 2. rim: release of a drag, or the release of the 2nd click (`ui/input-handlers/circle-tool.js:141-162`). | 1: locked snap point, else raw (`BT:51-52`); its snap becomes a constraint at commit (:124-128). 2: locked snap, else raw (:154-155). A joint or point snap on the rim gives point-on-circle (`applyRimSnap` :99-102). A curve snap only places. | Step 2: single `diameter` (length), opened at release 1 (:149, `BOX` :17). Typed Ø → a diameter DISTANCE (:115-122). | `commitCircle` circle-tool.js:108-139. Click :161; Enter `finalizeCircleFromActive` :169-179. |
| **Polygon** (one variant; N = `state.polygonSides`) | 1. centre: press (`ui/input-handlers/polygon-tool.js:94-102`). 2. corner: release, which sets radius and rotation (:129-132). | 1: locked snap (applied at commit :172-174). 2: locked snap (`applyLockedSnap` :175), dropped when R is typed (:132). | Step 2: dual `polygon` R (length) / N (count) (:21), opened at release 1 with [0, N] (:126). | `createPolygon` :136-179. Click :132; Enter :65. |
| **Arc** (centre-start-end, the only mode: `core/constants.js:178-180`, declared again at `ui/input-handlers/arc-tool.js:34-36`; no dropdown, `ui/tool-ribbon.js:56`) | 1. centre: press (:172-199). 2. start: click, or release of a drag (`handleCenterArc` phase `center` :274-293). 3. end: click (phase `start` :294-364). | 1: locked snap. 2: locked snap, dropped when R is typed (:276); a start on the centre is ignored (:277). 3: the cursor's angle at the start radius (:305-312); a typed sweep holds it (:301-303). Snaps applied with `applySnapConstraint`: centre :346, start :347, end only if no sweep is typed (:349-351). | 2: single `radius` (length), opened at release 1 (:251). 3: single `sweep` (angle, refused outside (0,360), B-07) (:43-48, :291). | `handleCenterArc` :273-365. Click :262; Enter :142 / :149. (`finalizeArcFromActive` :368-381 is used only by tests.) |
| **Rect 2-point** (`rect-2pt`) and **Rect centre** (`rect-center`); `state.rectMode`, `core/constants.js:162-166` | 1. corner or centre: press (joint at the press, `ui/input-handlers/rect-tool.js:243-248`). 2. opposite corner: release of a drag, or the 2nd click (:308-313). | 1: `snapPoint(locked)` (:245). 2: the same (:295); its snap is dropped when a side is typed (:313). Every corner is made COINCIDENT with a joint within 0.01 (:203-207). Centre: half sides (:30-36). | Step 2: dual `rect` W / H (lengths) (:16), opened at release 1 (:289). One DISTANCE per typed side (:70-91). | `placeRect` :186-212 (BUG-311 / B-02). Click :313; Enter `finalizeRectFromActive` :217-223. |
| **Rect 3-point** (`rect-3pt`) | 1. p1: press. 2. base end: click (or release of a drag) → `placeBase` (:296-302, :173-179). 3. third point: click → `placeRect` (:304-306). | 2: `baseEnd` (:49-54); snap dropped when length is typed (:301). 3: `thirdPoint` on the cursor's side (:59-64); snap dropped when height is typed (:306). | 2: single `rect3-length`. 3: single `rect3-height` (:19-22, BUG-312 / B-03). | `placeBase` :173 (click :301, Enter :140); `placeRect` :186 (click :306, Enter :145). |
| **Slot C2C / Overall / Center-point** (`slot-c2c`, `slot-overall`, `slot-center`; `state.slotMode`, `core/constants.js:169-175`; all 5 in the ribbon, `ui/tool-ribbon.js:36-42`) | 1. p1: press (`ui/input-handlers/slot-tool.js:554-589`). 2. span end: release of a drag, or 2nd click (`advanceFromSpan` :641-647). 3. width: click → commit (:655-657). | 2: `resolveSpanEnd`: H/V inference, then a typed length along it (:90-101). A span of MIN_SPAN or less is ignored (:643). The width click's snap is unused. Snaps on j1 and j2 at commit (:333-334, :354). | 2: single `slot-span` (:638). 3: single `slot-width` (:423-427). | `commitSlot` :272-397. Click :656, Enter :509, Done :542. |
| **Slot 3-point arc** (`slot-arc-3pt`) | 1. c1. 2. c2: the span is the chord (:415-421). 3. p3 on the arc (`advanceFromArc3` :431-444; collinear refused). 4. width. | 3: p3's snap binds only a locked joint snap (`bindThirdJoint` :296-304). No H/V inference (:85). | `slot-span` (chord, BUG-313 / B-04), `slot-arc`, `slot-width`. | `commitSlot` (as above). |
| **Slot centre-point arc** (`slot-arc-center`) | 1. arc centre. 2. c1: the span is the radius. 3. sweep end, projected onto the radius (:117-132, :146-161, :436). 4. width. | 3: snap applied to `jc2` (:315). | `slot-span` (radius, :374-383), `slot-arc`, `slot-width`. | `commitSlot`. |
| **Line** (one mode, a chain; `ui/input-handlers/line-tool.js`) | 1. start: press; the joint is made at the release, or the existing joint on a joint snap (:305-358, :444-471). 2..n. end: every later click's release commits a segment, and the chain goes on from its end (:478-567). Finish: Enter on the canvas, Done, a right-click, or a click on the start point. | Start: `hitSnap.pt` or joint (:335-347). End: locked snap or raw (:488-490). At commit: start snap (:529-531); end snap only when nothing is typed (:533-537); merge within 0.01 (B-06, :64-73, :509); inference H/V/perp/parallel/tangent/midpoint (`applyLineInference` :170-205, :539); a typed angle turns inference off (:381-384). | Dual `line` L (length) / ° (angle), separator `∠` (:28). Opened after the first click and after every segment (:463, :563). Typed L → DISTANCE (B-08 refusal :77-93). | Click: inline in `handleLinePointerUp` :417-568. Enter and right-click: `finalizeLineFromActive` :574-643. Finish: `finishLineChain` :124-126 → `deactivateLineTool` :646-677. [1030] right-click: `rightClickLine` line-tool.js:130. |
| **Bezier** (one mode, `ui/input-handlers/bezier-tool.js`) | Each press is an anchor; a drag makes symmetric handles; each release makes the anchor joint plus a segment from the last anchor (:64-177). Finish: Enter (`bezier.finish`), a double-click, or a press on the first anchor (closes the path, :89-90, :159-166). | Anchor: locked snap except its own last joint (:104-110). Handles do not snap (:121-130). | none | Inline in `handleBezierPointerUp` :135-177; `endPath` :57-62. |
| **Text** (`ui/input-handlers/text-tool.js`) | 1. anchor: press, then `addText` (`core/text.js:170`) and the editor opens (:40-46). 2. type and style live; OK, Enter in a field, or an outside press commits. | 1: locked snap or raw (:42); like a drawing tool's (`DRAW_SNAP_TOOLS` IM:389). | Own dialog DOM (:222-309): textarea, font, size / letter / line, alignment, OK / Cancel. | `commitTextEditor` :93-109; `cancelTextEditor`. |
| **Trim** (`ui/input-handlers/trim-tool.js`) | One pick on **press**; the tool stays on. Hover shows the piece that would go (:110-127). | The nearest line/arc/circle within `SNAP.LINE_PX` in the active sketch (:95-101). Bezier and text letter refused by the IM gate (`core/curve-kinds.js:215`, :240). | none | `saveState('trim')` :64 then `trimShape` (`core/trim.js:66`). |
| **Break** (`ui/input-handlers/break-tool.js`) | One pick on **press**; hover marks the split (:107-132). | Line/arc/circle; overlaps ranked by `pickRank` (R2-08, :83-105). A circle needs two cuts (:64). | none | `saveState('break')` :66 then `applyBreak` (`core/break.js:203`). |
| **Fillet** (`ui/input-handlers/fillet-tool.js`) | 1. curve 1 (or a corner, which opens the box at once :254-255). 2. curve 2 → corner → radius box (:243-250). With the box open: a click adds a corner (multi-corner session) or starts a new curve-1 pick (:202-227). Apply: Enter, an empty-canvas click (B-19), or Done. | Lines and arcs in the active sketch (`core/fillet.js:791`); a T-junction gets a message (:257-259); curves that do not meet are refused (:248). | Own `<input id="fillet-radius-input">` (:306-361), using NIM helpers: `placeAnchoredBox`, `boxRefusal`, `attachExternalCompletion`, `handleBoxUndoKey`. Plus a drag arrow (:392-441). | `commitFilletInput` :465-525 → `applyFillet` (`core/fillet.js:458`). Enter :350, Done IM:992, click :233. |
| **Offset** (`ui/input-handlers/offset-tool.js`) | 1. a curve picks its chain and the box opens (:123-128). 2. side: hover (mouse), or a click / tap on release (:106, :116-119). Optional arrow drag. Apply: Enter or Done, then the tool goes to Select (:284-286). | `hitShape` (active sketch, boosted); `offsetChainOf` refusals (`core/offset.js:133`). | Own `<input id="offset-distance-input">` (:173-225), signed (TASK 690), exact if unedited (TASK 724). | `commitOffsetInput` :258-287 → `applyOffset` (`core/offset.js:336`). |
| **Close Path** (`ui/close-path-actions.js`) | Tool start with a selection: closes its chains at once (:71-74). Otherwise each click on an open outline closes it; the tool stays (:9). | `closePathPick` (`core/close-path.js:52`); a joint picks its first accepted curve (:83-84). | none | `closePathOnShapes` :35-51 → `applyClosePath` (`core/close-path.js:186`). Also the menu (:97-102) and the import offer (:121-131). |
| **Mirror** (`ui/input-handlers/mirror-tool.js`) | `beginMirror`: with a selection, start at LINE, else at OBJECTS (:28-32). OBJECTS: clicks toggle items; Enter or Done → LINE. LINE: click the line; Enter or Done mirrors; the tool ends (IM:1507-1509). | OBJECTS: active joints (not the origin) and shapes (:41-42). LINE: a line or a reference axis (:46-53). | none | `mirrorDone` :67-83 → `recordConstraintStep(..., mirrorObjects)` (`core/mirror.js:89`). |
| **Circular Pattern** (`ui/input-handlers/pattern-tool.js`, one session `_s`) | `beginPattern` opens the dialog (:113-126). Objects → centre (a joint click creates the live pattern, :382-387) → values (dialog, spinners, suppression) → OK / Enter / Done. Also an edit mode from a label double-click (:129-142). | `pickRule` :102-105, `handlePatternPointerDown` :364-410. | Own dock dialog and fields (:566-801); `handleBoxUndoKey` only. | `commitPattern` :190-201. The document is live: `applyPattern` (`core/pattern.js:519`), `editPatternValues` (`core/dimension-seams.js:274`). |
| **Rectangular Pattern** | Objects → Enter creates it on the X/Y axes (:227) → values; the Direction buttons give `dir0` / `dir1` line picks (:389-394). Arrow drag and the inline Distance + Quantity pair (:820-913). | Directions: a line or an axis (:390). | Dock and inline pair (:751-791, :820-866). | `commitPattern` (as above). |
| **Coincident** (`ui/input-handlers/constraint-tools.js`, `CT`) | 2 picks on **press** (`handleConstraintPointerDown` CT:154-159). joint + joint → COINCIDENT; joint + curve → POINT_ON_LINE (:283-326). The tool stays (B-15). | `CONSTRAINT_PRESELECT` :26-29 (also feeds `findSnap` picks, CT:71-83). Curve + curve refused (:316-317). | none | `ConstraintManager.createConstraint` via `recordConstraintStep` (:146-152). |
| **Horizontal / Vertical** | A line: applied at once. Or point then point (:191-243). Preselected line: applied at activation (:125-130). | :30-33 | none | `makeHorizontalVertical` :187-189 |
| **Parallel / Perpendicular** | line then line (:245-263) | :34-41 (axes pickable) | none | `createConstraint` :258 |
| **Collinear** | line then line (:331-368) | :42-45 | none | :359 |
| **Tangent** | shape then shape; the pair is checked at pick 2 (:373-416) | :46-49 | none | :402 / :406 |
| **Equal** | shape then shape; preselected 2 are applied at activation (:96-110, :547-584) | `canConstrainEqual` :14-17 | none | :571 / :101 |
| **Midpoint** | point + line/arc (either order), or three points (:421-496) | :54-57 | none | :478 / :491 |
| **Symmetric** | entity 1, entity 2 (same family), then the symmetry line (:505-542) | :58-61; axis only at step 3 (`core/reference-lines.js:45-46`) | none | :538 |
| **Fix / Lock** | No tool mode: F key (IM:1310), ribbon (`ui/tool-ribbon.js:101-102`), menu (IM:1380) | the selection, or the hovered shape (`core/lock-state.js:73-76`) | none | `toggleFixedSelection` IM:1408-1426 |
| **Dimension** (`ui/input-handlers/dimension-tool.js`, `DT`), all kinds | Pick 1 (a joint → `startPointPick` :523-526; a shape → `startShapeDimension` :531-593). Pick 2 (:476-505), or an upgrade while placing (:410-435). Placement drag; drop by click (box opens), Enter, or a release more than 250 ms after the press (no box). Value. Preselection: `startDimensionFromSelection` cases A-F (:169-286). | Point-point `createPointPointDimension` :732-749; line length :535-557; point-line :770-795; line-line distance or angle `lineLineDimension` :609-702; circle Ø / arc R :558-591; centre-to-X (D-8) :708-729. | NIM `showEditInput` :515-598 (mode `edit` / `view`); Tab commits (:372). | `startPlacing` :798-822, `anchorPlacingDimension` :301-340, `finishPlacementWithoutEdit` :78-85, NIM `handleCommit` :719-752. |
| **Select / drag** (`ui/input-handlers/selection-tools.js`, `ST`) | One press: a label (DOM target :197-224), a group member (:384-408), a joint (`handleJointSelection` :413-489), a shape (`selectShape` :547-561 + `startShapeDrag` :564-591), a glyph (:635-648), or empty (marquee :270-280, :658-671, :973-1033). Drag past 5 px (:690-695). Release: snap and inference commit (:1105-1251). Double press 500 ms, 5 px or 22 px on touch (:283-288). | `selectPick` = the hover's pick (task 588). | Label edit → `showEditInput`; text → editor; pattern label → dialog. | `ensureDragUndo` :514-521, `settleDragUndo` :523-536, `dragToward` :728-919; [1030] `cancelPointDrag` :542. |
| **Transform box** (`ui/transform-box.js`, groups under Select) | Press a padlock, rotate or corner (:172-199); drag (:216-231); a release with no move opens a typed value (:244-252, :304-337). | `hitBox` :82-90 | Own `<input id="tbox-input">` (:304-337) | `commitTransform` :257-277 |

### 1.2 Every input entry point each tool has today

These are in addition to the shared plumbing in 1.0. "down / move / up" = the tool's handler reached from the IM `switch`.

| Tool | Pointer | Keys | Listeners in the tool's own file | Right-click | Touch special cases | Drag vs click |
|---|---|---|---|---|---|---|
| Circle | down :61 (IM:699 → `ui/input-handlers/drawing-tools.js:89`), move :79, up :141 (refused-box gate `drawing-tools.js:161`) | `handleCircleKeyDown` :181-194: a digit opens the Ø box at the chord midpoint with that digit (IM:1290-1292) | `setupDimensionListeners` → window `liveDimensionApplied` / `Preview` / `Cancelled` (:22-53, `BT:147-160`); `state.onDrawCancelled` :21 | Before 1030: a left press. [1030]: ignored. Native menu not suppressed (IM:1086). | Box opens unfocused on touch (`BT:106`); boost 2x on the pick | `checkDragThreshold` 3 px (:82); a drag-release commits with no box (:146) |
| Polygon | down :94, move :104, up :118 | none (a digit on the canvas does nothing) | :38-67, `onDrawCancelled` :37 | as Circle | box unfocused | 3 px (:106) |
| Arc | down :172, move :201, up :246 | none | :127-158 (guard needs subMode `arc-cse`), `onDrawCancelled` :125 | as Circle | box unfocused | `SNAP.DRAG_THRESHOLD \|\| 2` (:207); `_tempStart` click-ignored (:249-252) |
| Rect (3 variants) | down :228, move :254, up :279; IM extra: `updateLiveRectPreview` on every move (IM:841), `getLiveLockedPoint` / `applyLiveRectConstraints` / `hideLiveInputs` on up (IM:928-935) | legacy `handleLiveRectKeyDown` (`ui/input-handlers/live-dimension-input.js:458-475`, IM:1285): a digit opens the **legacy** W/H inputs; their own keys: Tab, Enter → window `live-rect-commit`, Esc / Delete (:334-365). `handleRectKeyDown` rect-tool.js:316-334 is imported (IM:42) but never called. | rect-tool.js :129-160, `onDrawCancelled` :128; live-dimension-input.js `input` listeners :367-381 | as Circle | box unfocused | 3 px (:256) |
| Slot (5 variants) | down :554, move :591, up :624 | `handleSlotKeyDown` :662-679: a digit opens the current step's box (IM:1287-1289) | :454-526, `onDrawCancelled` :447-453 | as Circle | `active.pointerType` kept so a box opened by Enter is unfocused on touch (:201) | 3 px (:594); every press resets drag tracking (:555-556) |
| Line | down :305, move :360, up :417 | `handleLineKeyDown` :278-294: Enter on the canvas = finish (IM:1279-1281) | :244-275, `onDrawCancelled` :243 | `drawing-tools.js:70-74` (B-05); [1030] `rightClickLine` line-tool.js:130, via IM [1030] :575-579; native menu suppressed (IM:1085) | box unfocused | 2 px (:363); 500 ms debounce near the start (:134, :437-442) |
| Bezier | down :64, move :114, up :135 (IM:702, :844, :937; not through `drawing-tools.js`, so no refused-box gate) | `handleBezierKeyDown` :179-183: Enter = `endPath` (IM:1293) | none | a left press before 1030 | none; no Done entry | 2 px (:123); double-click 300 ms / 30 px (:74-79) |
| Text | down only (IM:704-705) | the editor's own keydown :292-296 (Esc, Ctrl+Enter, Enter in an INPUT) | field `input` / `change` listeners :253-290; `listenOutsidePress` :306 (`ui/outside-press.js:8-9`) | none | `@media (pointer: coarse)` docking :299-300 | none |
| Trim | down :50 (acts on press), move :40 (hover), up :77 (no-op) | none | none | `e.button !== 0` → false (:51) | the pick radius is not boosted (:59, :96) | none |
| Break | down :52 (acts on press), move :42 (hover), up :79 (no-op) (IM:707-708, :845-846, :938-939) | none | none | `e.button` check (:53) | not boosted | none |
| Fillet | down :157, move :110, up :273 (IM:713, :849, :942) | `handleFilletKeyDown` (`r` = default-radius prompt, :285-302; IM:1296); its input's keydown :346-352 | `input` :345; window `pointerup` once :359; document `panzoom:viewportChanged` :448; `addHistoryListener` :323 | `e.button !== 0` (:158) | no hover on touch (:118); the arrow hit is boosted (:394-397) | 6 px press slop with the box open (:117); arrow drag at once (:166-170) |
| Offset | down :80, move :98, up :110 (IM:719, :851, :944) | its input's keydown :212-218 | `input` :211; window `pointerup` once :223; `panzoom:viewportChanged` :251; `addHistoryListener` :188 | button check (:81) | no hover: the side follows taps (:102); arrow boosted (:133-136) | 6 px slop (:101) |
| Close Path | down only (`ui/close-path-actions.js:80`, IM:722-723) | none | none | button check (:81) | none | none |
| Mirror | down only (IM:716-717) | Enter `mirror.finish` (IM:1299) | none | **no button check (:37-60)**: a right press picked before 1030 | none | none |
| Patterns | down IM:664 (under ANY tool while a session is open), move IM:744, up IM:867 | `handlePatternKeyDown` (IM:1300, :428-429); field keys `wireFieldKeys` :599-617; dock keydown :573-578 | many dialog listeners :573-866; `panzoom:viewportChanged` :953; `addHistoryListener` :153 | button check (:365) | arrow boosted (:440); no hover on touch (:416) | an arrow press drags at once |
| Constraint tools | down only (IM:735; `handleConstraintPointerMove` / `Up` CT:586-587 are imported and never called) | none of their own | none | no button check: a right press picked before 1030 | 2x pick reach (`SD:43`); hover 1.0 (`HM:119`) | acts on press |
| Dimension | down DT:345 (`dimensionPointerDown` :354-520), move :842-963, up :969-1008 | IM:1259-1277: `dim.place` Enter, `dim.typeValue` digits | window `liveDimensionApplied` DT:112-136 (looks unreachable, read, not run) | menu target consumed (IM:564); empty-canvas right press while placing: fixed by [1030] (I-18) | the placement drag starts only after 6 px (DT:846-863); the touch hold | 250 ms release rule (:981-999) |
| Select | down ST:178-280, move :653-716, up :970-1273 | Esc / Delete / F via IM | none | the menu (IM:564, :1083-1092) | the hold menu; an 8 px dead zone while a hold is a candidate (IM:1034); 22 px double-tap | 5 px (:690-695) |

### 1.3 Where two paths for the same step differ today

Status:
- **open**: still true at [1030].
- **fixed**: fixed by the cited task.
- **NEW**: not in `docs/BUG-ARCHIVE.md`. Reported to the advisor (audit rule 5), not archived here.

| Id | Tool / step | The two paths, and what differs | Status |
|---|---|---|---|
| **X-01** | Line end, Rect corner (all variants), Circle rim, Polygon corner, Arc start / end, Slot span / p3 | **Enter never applies the snap the cursor shows; the click does.** `updateSnapTarget` writes `state.active.preview.snapTarget` (IM:519-527). The same move then calls the tool's `updatePreview`, which **replaces** `state.active.preview` (`ui/preview-manager.js:37-62`). So the Enter paths that read it get nothing: line-tool.js:620, rect-tool.js:222, arc-tool.js:376. The others pass no snap at all: circle-tool.js:177, polygon-tool.js:65, rect-tool.js:140 / :145, arc-tool.js:142 / :149, slot-tool.js:491 / :495. The rest of the problem B-02 found: BUG-311 made Enter call the click's `placeRect`, but with this always-null snap. Probe `.evidence/1031/probe-enter-snap.out` (nothing typed; the same last point; click, then Enter; quoted below). | **NEW** (probed) |
| X-02 | every tool except Line / Select / Dimension | A right press acted as a left press (I-17, BUG-330). | fixed [1030] (`rightPressIgnored`). The native context menu still shows in those tools (IM:1086 = [1030] :1145): **open** |
| X-03 | every tool | The first finger of a pinch acted as a press (I-21, BUG-333). | fixed [1030] (held touch) |
| X-04 | draw tools | Drag threshold: 2 px for Line / Arc / Bezier (line-tool.js:363, arc-tool.js:207, bezier-tool.js:123), 3 px for Rect / Slot / Polygon / Circle (`BT:39`). | open |
| X-05 | draw tools | The refused-box click gate is checked only on the drawing tools' pointerup (`drawing-tools.js:161`): not on press, not for Bezier, not for Fillet / Offset clicks. | open |
| X-06 | draw tools | A digit on the canvas opens a box in Circle (at the chord midpoint, circle-tool.js:188-190), Slot (the width box starts at 10, slot-tool.js:674) and Rect (the **legacy** box). In Line, Polygon and Arc it does nothing. | open |
| X-07 | every box | Esc inside the Dimension or Text box kept the tool (I-02, BUG-321). | fixed [1030] |
| X-08 | every tool | Undo mid-pick left the tool or undid an older step (I-05, BUG-324). | fixed [1030] |
| C-1 | Circle rim | Enter: no point-on-circle for a joint under the cursor (circle-tool.js:177 vs :161 → :129). Part of X-01. Probe: `Circle rim on point p  click ... [pointOnLine,pointOnLine]` / `enter ... [pointOnLine]`. | **NEW** |
| C-2 | Circle box | The digit-opened box sits at the chord midpoint (:188-190). The click-opened box sits at cursor +15 px (`BT:105`). | open |
| C-3 | Circle rim | A drag-release places the circle with no box; two clicks give a box (:146). Kept by design (drag-draw). | (design) |
| P-1 | Polygon corner | Enter: no vertex snap (:65 vs :132). Probe: `Polygon corner on line L2  click ... pointOnLine,pointOnLine` / `enter ... pointOnLine`. | **NEW** (X-01) |
| P-2 | Polygon corner | A click on the centre **cancels the whole polygon** (:148-153). Enter keeps the box (:63). Rect / Arc / Circle ignore such a click and keep waiting. | open |
| A-1 | Arc end | **After a drag-set radius, the end click is swallowed.** `_tempStart` (:193) is cleared only on the no-drag path (:250), so the next click is "clickIgnored" (:249) and swaps the sweep box for a radius box. Probe `.evidence/1031/probe-arc-drag-centre.out` (quoted below). | **NEW** (probed) |
| A-2 | Arc start / end | Enter in the radius box drops the start snap even when nothing is typed (:142 vs :276). Enter in the sweep box: no end snap (:149 vs :349). | **NEW** (X-01) |
| A-3 | Arc end | Zero sweep: Enter refuses (:147); the click has no check (:294-364). | open (read, not run) |
| R-1 | Rect corner | Enter: no corner snap (:222 vs :313). Probe: `Rect 2-pt corner on line L2  click ... pointOnLine ...` / `enter` without it. | **NEW** (X-01; BUG-311 follow-up) |
| R-2 | Rect, all variants | **A second, legacy box system.** A digit on the canvas (no box focused: a press in progress, a touch box) opens `#live-dim-width/height` (`ui/input-handlers/live-dimension-input.js:432-475`). Its Enter fires `live-rect-commit`, which fakes a pointerup (IM:1117-1127). Its locks never reach `rectState`: no dimensions are made (`applyLiveRectConstraints` only hides, :643-646). In 3-point mode its Tab shows H (:335-341). Relates to BUG-312 (B-03). | open (read, not run) |
| R-3 | Rect 3-point | Enter on the base or height: no snap (:140 / :145 vs :301 / :306). A box opened by Enter sits at the last pointer (:124). | **NEW** (X-01) |
| S-1 | Slot span (straight and arc modes) | **A typed span keeps the span-end snap**, although `resolveSpanEnd` moved the point off it (slot-tool.js:646 → `advanceFromSpan` :399-401 → `commitSlot` :354). Rect :301, Arc :276, Polygon :132 and Line :534 all drop it. The solver then moves the slot. Probe `.evidence/1031/probe-slot-typed-span.out`: `span typed 20: ... new pointOnLine 1, centres (40.00,6.96) (20.00,6.96)`. The first centre was clicked at x 10 and moved to x 20. | **NEW** (probed) |
| S-2 | Slot span / p3 | Enter: no snap (:491, :495). | **NEW** (X-01) |
| S-3 | Slot width | Enter with nothing typed locks the **displayed, rounded** width (:506-508). The click uses the exact width (:110-113). Done does not lock it (:542). | open (read, not run) |
| S-4 | Slot arc modes | A typed `slot-arc` value is ignored (:460-470, :493-499): a box that does nothing. | open |
| S-5 | Slot centre-point arc | The p3 snap is applied to `jc2`, which sits at the projected c2, not at the snap point (:315 vs :311 / :436). | open (read, not run) |
| S-6 | Slot, all | The release snap is `hitSnap \|\| snapTarget`, not `activeSnap` like the other tools (:628). | open |
| L-1 | Line finish | Enter **in the box** commits a segment and goes on (:258-274). Enter **on the canvas** ends the chain and drops the rubber band (:283-290). With a mouse the box has the focus after every click (:563); on touch it does not. Same key, opposite results by device. | open |
| L-2 | Line end | Enter: no end snap (:620 vs :535). Probe: `Line end on line L2  click ... [coincident,pointOnLine]` / `enter ... [coincident]`. The click places at the raw snap point (:490-492); Enter at the inferred preview point (:579). Snap vs inference order is swapped (:528-539 vs :617-620). Only the click calls `saveState` (:511). | **NEW** (X-01) |
| L-3 | Line end | A click on the start point (under MIN_LEN) ends the chain (:501-506). Enter keeps the box (:270). | open (kept by design: a click on the last point finishes) |
| L-4 | Line finish | Done ends the chain without committing a typed segment (IM:987, `finishLineChain`). The right-click commits it first ([1030] `rightClickLine` :130-134; B-05, BUG-314). | open (owner question Q1) |
| L-5 | Line Enter | The Enter-merge radius was 0.5 mm vs the click's 0.01 (B-06, BUG-315). | fixed 1028 |
| L-6 | Line start | The start takes `hitSnap.pt` without checking `isLocked` (:335-337). Every other tool checks it. | open (read, not run) |
| B-1 | Bezier finish | A quick genuine click near the last anchor is read as a double-click and ends the path (:74-79). | open |
| B-2 | Bezier finish | There is no Done check (IM:986-996), so on touch only a double-tap or closing ends a path. | open |
| T-1 | Text commit | Any outside pointerdown commits, including the first finger of a pinch and a middle-button pan (text-tool.js:306). | open |
| T-2 | Text fields | An invalid field only sets `aria-invalid`: OK commits the last valid value silently (:274, :282). Fillet, Offset and Pattern refuse instead. | open |
| TB-1 | Trim / Break pick | The pick radius is not boosted on touch (trim-tool.js:59 / :96), while the IM refusal pick is. | open |
| TB-2 | Trim / Break overlap | Trim takes the nearest curve; Break ranks with `pickRank` (break-tool.js:83-105). | open |
| F-1 | Fillet apply | An empty-canvas click commits (B-19, BUG-317), except while curve 1 is pending (:204-206, :233). The header comment still says a click abandons (:12-13). | fixed 1028 (stale comment open) |
| F-2 | Fillet apply | Done is gated by `filletInputValid` (IM:992); Enter parses fresh (:465-525). | open |
| F-3 | Fillet value | An arrow drag clears the typed formula / name / assign (:432-438); typed text keeps them. | open (design) |
| F-4 | Fillet focus | After Done or a pinch the box does not get the focus back (:281). | open |
| O-1 | Offset vs Fillet | An empty-canvas click sets the side in Offset and commits in Fillet. | (design, two tools) |
| O-2 | Offset apply | Done has no `enabled` gate (IM:994). | open |
| O-3 | Offset value | A drag across the curve flips the side and writes a positive value (:144-158). A typed negative keeps the side and stores d < 0 (:280). | open |
| O-4 | Offset | Picking another chain while the box is open loses the typed value (:175, :189). | open |
| M-1 | Mirror | The Done label is "Mirror: next step" even at the step where it mirrors (IM:990). | open |
| PA-1 | Pattern apply | Field Enter checks only the focused field (:608-611). OK and Done check every row (:194-195, :805-808). | open |
| PA-2 | Pattern Done | Hidden until something is picked (:96); Enter always works. | open |
| K-1 | Constraint tools | Hover lights a glyph (`HM:65-70`); the click ignores glyphs (CT:154-159). | open |
| K-2 | Constraint tools | The picks are not step-aware (CT:71-83). Symmetric step 3 still offers joints and circles (:58-61 vs :534-535). | open |
| K-3 | Constraint tools | The picks live in the selection, so Delete mid-pick deletes the picked geometry (:216, :252, :350). | open (read, not run) |
| K-4 | Fix / Lock | F locks the hovered shape with nothing selected; the ribbon button stays disabled (`core/lock-state.js:73-76` vs `ui/tool-ribbon.js:656-657`). | open |
| D-1 | Dimension drop | A click-drop (DT:399-473) vs Enter (`anchorPlacingDimension` :301-340): Enter has no second-pick upgrades, re-measures differently and sets no `glyphPos`. | open |
| D-2 | Dimension drop | A release more than 250 ms after the press drops the dimension with no box (:981-999): time, not distance. | open |
| D-3 | Dimension drag | Mouse: the drag starts at the press (:810-818). Touch: after 6 px (:846-863). | (device, belongs in the touch translator) |
| D-4 | Dimension label | The label branch uses the DOM target (:366); hover uses the 24 px `dimLabelAt` (`HM:41-55`). | open |
| D-5 | Dimension double-click | 400 ms by index only (:373) vs Select's 500 ms + 5 / 22 px (`ST:283-288`). | open |
| D-6 | Dimension preselect | Case B (two joints, :215-263) has a duplicate check and `isDriven:false`; the click path has neither (:732-749). | open |
| D-7 | Dimension, touch hold | The hold resets only a placement the press started (IM:978): a point pick survives it. | open (read, not run) |
| SE-1 | Select | The label drag and double-click use the DOM target; hover and click use the hit box. | open |
| SE-2 | Select release | The inference commit appears three times (ST:1110-1151, :1158-1203, :1208-1251); with no `activeSnap`, two of them may both run. | open (read, not run) |
| TX-1 | Transform box | The touch hit radius comes from `pointerType` (`ui/transform-box.js:83`); the layout comes from `(pointer: coarse)` (:45). | open |

Probe output for X-01, run in node on the real app (`tests/helpers/node-app.js`), saved as `.evidence/1031/probe-enter-snap.out`:
```
Rect 2-pt corner on line L2    click hover snap: shape locked shapes +4  new constraints: [coincident,coincident,coincident,coincident,horizontal,horizontal,pointOnLine,vertical,vertical]
Rect 2-pt corner on line L2    enter hover snap: shape locked shapes +4  new constraints: [coincident,coincident,coincident,coincident,horizontal,horizontal,vertical,vertical]
Circle rim on point p          click hover snap: joint locked shapes +1  new constraints: [pointOnLine,pointOnLine]
Circle rim on point p          enter hover snap: joint locked shapes +1  new constraints: [pointOnLine]
Line end on line L2            click hover snap: shape locked shapes +1  new constraints: [coincident,pointOnLine]
Line end on line L2            enter hover snap: shape locked shapes +1  new constraints: [coincident]
Polygon corner on line L2      click hover snap: shape locked shapes +12  new constraints: [equal,equal,equal,equal,equal,equal,equal,equal,equal,equal,pointOnLine,pointOnLine]
Polygon corner on line L2      enter hover snap: shape locked shapes +12  new constraints: [equal,equal,equal,equal,equal,equal,equal,equal,equal,equal,pointOnLine]
```
Probe output for A-1 (`.evidence/1031/probe-arc-drag-centre.out`). The radius is set by a press-drag-release from the centre, then the end is clicked:
```
after drag-release: phase start _tempStart true
after end click: shapes 0 phase start
after a second end click: shapes 1 phase null
```

---

## 2. The contract

### 2.1 The shared events (what the three translators produce)

A tool never sees a DOM event. It sees only these events, delivered to its **session**: the shared engine, `ui/tool-session.js`, new.

| Event | Payload | Produced by |
|---|---|---|
| `hover` | `{ at, snap }` | desktop: a move. touch: a finger move while drawing (there is no hover between taps). Also the re-preview after a wheel or pan (today's fake mouse move, IM:1104-1106, :1148-1150). |
| `step` | `{ at, snap, via }` | desktop: a click, or the release of a drag that started on a press-step. touch: a tap, or the lift of a drag. box: **Enter**, which steps at the session's `lastHover` (`at` + `snap`). Done check (for a tool whose Done applies). |
| `values` | `{ field, value, typed, reset, expression, name, assign }` | box: every edit. This is today's `liveDimensionPreview` detail (NIM:932-961). |
| `finish` | `{}` | Ends an open-ended tool: the Line chain, the Bezier path, Mirror's objects step, a Fillet session. desktop: Enter on the canvas; a right-click when the tool declares `rightClick: 'finish'` (Line). touch: Done. A Bezier double-click. |
| `cancel` | `{}` | desktop: Esc, another tool. box: Esc. Runs [1030] `cancelActiveWork`. |
| `undo` / `redo` | `{}` | Ctrl+Z / Ctrl+Y, the header buttons, Ctrl+Z in a box at its opening value. [1030] rule: with a pick pending, `undo` = restart the tool, `redo` = nothing. |
| `restart` | `{}` | A ribbon variant change ([1030] `ui/tool-ribbon.js:401-407`). |
| `handle` | `{ phase: 'start'\|'move'\|'end', at, id }` | A drag on a tool-owned handle: the Fillet / Offset / Pattern arrows, a dimension label, the transform box handles. |
| `gesture` | `{ phase: 'press'\|'move'\|'release', at, screen, mods, target }` | Only for the tools that stay outside the step model (section 4: Select, the Dimension placement drag). The translators still produce it. |

`via` (`'click' | 'release' | 'enter' | 'done'`) is recorded for the step log only. **No tool and no engine rule may branch on it.** The grep gate checks this.

### 2.2 One step, one result: the engine rule

`session.step({ at, snap })` runs the same code whatever produced it:
1. The box refusal gate (today NIM `refuseLiveInputClick` :1034, run on only one path, X-05). A refused typed value refuses every step, from any device.
2. `point = step.resolve ? step.resolve(picks, at, values) : at`. The typed values hold the point here (today: `lockedCorner`, `resolveSpanEnd`, `startPointFor`, `lockedEnd`, …).
3. **Snap kept unless a typed field positions the point.** `keepSnap = snap && snap.isLocked && !step.boxes.some(f => f.positions && values[f.id].typed)`. This is the rule Rect / Arc / Polygon / Line already apply in their click paths. It fixes S-1. Because Enter supplies `lastHover.snap`, it fixes X-01 too.
4. `tooSmall(...step.tooSmall(picks, point))` (`BT:30`) → the step is ignored and the tool keeps waiting. Enter keeps the box open (today's `detail.keepOpen`). One rule for P-2, L-3-on-Enter and A-3.
5. `picks[step.id] = { at: point, snap: keepSnap ? snap : null, values }`. Then either the next step becomes current (its boxes open and follow the hover), or, after the last step, **`tool.build(state, picks, values)` runs ONCE** inside the draw's undo step (`beginDrawStep` at the first step, `endUndoGroup` after the build). Then the tool does what it declares in `after`: `'stay'` (draw tools), `'select'` (Offset, Mirror, a pattern in create mode), or `'chain'` (Line: the end becomes the next start).

Two rules follow from this:
- The session keeps `lastHover = { at, snap }` itself, from the `hover` events. It never reads `state.active.preview`. This removes the cause of X-01 in ONE place: `updatePreview` (`ui/preview-manager.js:37-62`) may keep rebuilding the preview object for the renderer, because nothing reads a snap from it any more.
- Until the build, the picks are plain points held in the session. Today a pick's joint is created early: `BT:54` at the press, `rect-tool.js:243-248`, `arc-tool.js:179`. Under this plan the document is written once, in `build`; `cancel` then has nothing to remove. See risk R-4.

### 2.3 The tool description format

Every tool file exports ONE description, built with `defineTool` from `ui/tool-session.js`. `defineTool` checks the shape; a node test validates every description. The description holds:
- `tool`: its `TOOL_MODES` id;
- `variantKey`: the state key that holds its variant (`rectMode`, `slotMode`);
- `variants`, each a list of `steps`;
- `build`;
- `after`;
- optional `finish`, `rightClick`, `done`, `begin`: today's `DONE_ACTIONS` / `TOOL_BEGIN` entries, declared here instead of in `IM`.

A step holds:
- `id`;
- `pick`: what it accepts, a `findSnap` picks spec (section 3);
- `fires`: `'press'` or `'release'`, today's timing (section 7, Q2);
- `boxes`: the value boxes this step offers;
- `resolve`;
- `tooSmall`;
- `preview`.

**Circle** (`ui/input-handlers/circle-tool.js`, the trial):
```js
export const CIRCLE = defineTool({
  tool: TOOL_MODES.CIRCLE,
  variants: {
    centre: {
      steps: [
        { id: 'centre', pick: PICK.point, fires: 'press' },
        { id: 'rim', pick: PICK.point, fires: 'release',
          boxes: [{ id: 'diameter', quantity: 'length', positions: true, refuse: refusePositive }],
          resolve: ({ centre }, at, v) => (v.diameter.typed ? along(centre.at, at, v.diameter.value / 2) : at),
          tooSmall: ({ centre }, p) => [dist(centre.at, p)],
          preview: ({ centre }, p) => ({ type: 'circle', fixed: [centre.at], radius: dist(centre.at, p) }) },
      ],
    },
  },
  // ONE build: today's commitCircle (circle-tool.js:108-139). The centre snap -> applySnapConstraint; a joint snap on the rim ->
  // point-on-circle (applyRimSnap :99-102); a typed Ø -> the diameter DISTANCE with its expression / name / assign (:115-122).
  build: (state, { centre, rim }, values) => buildCircle(state, centre, rim, values.rim),
  after: 'stay',
});
```

**Rect 3-point** (one of the three variants in `rect-tool.js`):
```js
'rect-3pt': {
  steps: [
    { id: 'p1', pick: PICK.point, fires: 'press' },
    { id: 'p2', pick: PICK.point, fires: 'release',
      boxes: [{ id: 'rect3-length', quantity: 'length', positions: true, refuse: refusePositive }],
      resolve: ({ p1 }, at, v) => baseEnd(p1.at, at, v['rect3-length']),               // rect-tool.js:49-54
      tooSmall: ({ p1 }, p) => [dist(p1.at, p)] },
    { id: 'p3', pick: PICK.point, fires: 'release',
      boxes: [{ id: 'rect3-height', quantity: 'length', positions: true, refuse: refusePositive }],
      resolve: ({ p1, p2 }, at, v) => thirdPoint(p1.at, p2.at, at, v['rect3-height']),  // rect-tool.js:59-64
      tooSmall: ({ p1, p2 }, p) => sideSizes3(p1.at, p2.at, p) },
  ],
},
// build for every Rect variant: today's placeRect (rect-tool.js:186-212). The pick snaps (kept by the engine rule), the 0.01 coincident merge,
// and one DISTANCE per typed side.
```

**Line** (a chain):
```js
export const LINE = defineTool({
  tool: TOOL_MODES.LINE,
  variants: { line: { steps: [
    { id: 'start', pick: PICK.point, fires: 'release' },
    { id: 'end', pick: PICK.point, fires: 'release',
      boxes: [{ id: 'length', label: 'L', quantity: 'length', positions: true },
              { id: 'angle', label: '°', quantity: 'angle', positions: true }],   // one dual box, separator ∠ (line-tool.js:28)
      resolve: ({ start }, at, v, hover) => lockedEnd(start.at, hover.inferred || at, v), // the inferred direction, then the typed L / angle
      inference: 'line',                                                           // applyLineInference (:170-205), off when the angle is typed
      tooSmall: ({ start }, p) => [dist(start.at, p)],
      onTooSmall: 'finish' },                                                      // a click on the chain's last point ends it (:501-506), kept
  ] } },
  build: (state, { start, end }, values) => buildLineSegment(state, start, end, values.end),  // the ONE segment commit (today two: :417-568 and :574-643)
  after: 'chain',                                       // the end becomes the next start (today's continueFrom + COINCIDENT :549-561)
  finish: { commitTyped: true },                        // Q1: canvas Enter / Done / right-click end the chain the same way
  rightClick: 'finish',                                 // [1030] rightClickLine
});
```

### 2.4 The three translators

All three live in `packages/ui`, are shared by every host, and are the only code that reads DOM input:

- **Desktop translator** (`ui/input-translate-desktop.js`, cut out of IM `handlePointerDown/Move/Up`, :540-955).
  - It keeps today's routing order exactly: pinch → middle button → menu target → [1030] `rightPressIgnored` → snap → pattern session → transform box → curve refusal.
  - It makes the click's snap the way it does today (IM:597-650: a locked hover snap wins, else a fresh `toolSnap`), but with the **current step's** `pick` spec.
  - It owns ONE drag threshold (X-04). It decides `step` (press-step on press, release-step on a click or a drag's release), `hover`, `finish` (right-click when declared) and `handle` (a press within an arrow's reach, `ui/drag-arrow-handle.js:27-29`).
  - Mouse and pen are the same.
- **Touch translator** (`ui/input-translate-touch.js`). **This is the only place the phone differs:**
  - the held press ([1030] `heldTouch` / `pinchFingers`, IM [1030] :1048-1056);
  - the long-press hold → the menu (IM:962-982, `ui/long-press.js`);
  - two-finger pan / zoom (IM:553-555 → `ui/input-handlers/pan-zoom.js:334-346`);
  - the 2x pick reach (`snapBoostFor(true)`, `SD:43`), applied to every tool's pick (fixes TB-1, K-1's boost half);
  - the drag slop (the Dimension 6 px, DT:846-863; the Select 8 px hold dead zone, IM:1034);
  - no hover between taps;
  - the boxes open unfocused (today `BT:106`, NIM:452 / :490: the translator tells the box layer; the tool never knows);
  - the Done check's size and placement (`ui/done-button.js:44-65`).
  - The drawers and the docked text editor are layout, not input, and stay where they are.
- **Box / keyboard translator** (`ui/input-translate-box.js`, around NIM).
  - The box DOM, parsing and refusals stay in NIM. Instead of dispatching window `liveDimensionApplied` / `Preview` / `Cancelled` for every tool to filter, it calls the session:
    - edit → `values`;
    - Enter → `step` at `lastHover`, `via:'enter'`;
    - Tab: the dual box moves between fields (NIM:403-411); a one-field box keeps the focus (B-15);
    - Esc → `cancel`;
    - Ctrl+Z at the opening value → `undo`.
  - The canvas keys come from `ui/shortcuts.js` (already declared):
    - Enter → `finish` for a tool that declares one, `step` for a press with a box;
    - a digit → focus the current step's box with that digit (ONE rule, X-06);
    - Esc, Undo / Redo, the tool keys, Delete, F as today.
  - The session opens and closes the step's declared boxes. `openCreationBoxes` / `followCreationBoxes` (`BT:104-113`) become the session's, called for every tool.

---

## 3. Reuse, don't hand-roll

| Existing | Where | What it becomes |
|---|---|---|
| `beginDrawing` | `BT:49-66` | The session's first-step start: `beginDrawStep`, `startSnapTarget`. The early joint goes to `build` (R-4). |
| `tooSmall` / `MIN_SHAPE_SIZE` | `BT:29-30` | The engine's step check (2.2 rule 4), run once for click and Enter. Today each tool calls it on two paths. |
| `checkDragThreshold` | `BT:39-42` | The desktop / touch translators' ONE threshold. |
| `applyLockedSnap`, `snapPoint` | `BT:13-22` | Called by each `build` for every kept pick snap. |
| `openCreationBoxes`, `followCreationBoxes` | `BT:104-113` (in base-tool, not NIM) | The session opens / follows the current step's declared `boxes`. |
| `setupDimensionListeners` | `BT:143-161` | Retired. The box translator calls the session directly, so no window events filtered by field name. |
| `liveExpression` / `liveName` / `liveAssign` / `applyLiveAssign` | `BT:118-135` | The `values` record carries them; `build` applies them (one place per tool). |
| `showSingleInput` / `showDualInput` / `handleCommit` / `handleCancel` | NIM :426, :463, :719, :1067 | The box layer, unchanged in look. `handleCommit`'s live branch (:753-773) becomes `session.step(lastHover)`. |
| `readBoxText` → `evaluateBoxText` | NIM:30-37 → `core/parameters.js:663` | THE parser for every box, the Fillet / Offset / transform inputs included (today they use `boxRefusal` / `evaluateFilletRadius` beside it). |
| `boxRefusal`, `refuseLiveInputClick`, `refuseLiveValue` | NIM :1002, :1034, :1026 | The engine's step gate (2.2 rule 1), for every device and every tool. |
| `handleBoxUndoKey`, `attachExternalCompletion`, `placeAnchoredBox` | NIM :334, :1162, :686 | Shared by every box. Fillet, Offset and the transform box move their own `<input>`s onto the NIM single box. |
| `findSnap(..., picks)` (task 1020) | `SD:120`, spec `{ points, curve, picked }` (`SD:116-119`); today built only by `constraintToolPicks` (CT:71-83) | Every step's `pick` compiles to this spec. The click (IM:397), the hover (`HM:119`) and Enter's `lastHover` all use the **current step's** spec. That makes picks step-aware (K-2) and gives drawing tools the same mechanism. |
| `CONSTRAINT_PRESELECT` | CT:25-62 | Becomes each constraint description's step `pick`, plus its preselection fill (`begin`). |
| `curveRefusal` / `CURVE_REFUSALS` | `core/curve-kinds.js`, IM:676-681 | Stays the translator's refusal gate, keyed by the step's pick. |
| [1030] `cancelActiveWork` | IM [1030] :1517 | For a migrated tool its per-tool `reset*` line becomes `session.cancel()`. The list shrinks by one per merge; at the end it is one call. |
| [1030] `restartActiveTool` | IM [1030] :1574 | `session.restart()` + `armTool`: unchanged callers (Undo with a pick pending, a variant change). |
| [1030] `TOOL_PENDING` / `toolPickPending` | IM [1030] :1556-1570 | For a migrated tool: `session.pending()` (any pick made or any box typed), derived, not hand-declared. The table shrinks as tools migrate. |
| [1030] `rightPressIgnored` + `rightClickLine` | IM [1030] :547, :575-579; line-tool.js [1030] :130 | Stays in the desktop translator. Line's special case becomes its declared `rightClick: 'finish'`. |
| [1030] held touch press, `pinchFingers` | IM [1030] :1048-1086 | The touch translator's front door, unchanged. |
| `DONE_ACTIONS`, `TOOL_BEGIN` | IM:986-996, :1210-1215 | Become each description's `done` / `begin` fields; IM builds the Done check from the descriptions. |
| `createLongPress`, `createDoneButton` | `ui/long-press.js`, `ui/done-button.js` | Used by the touch translator, unchanged. |

---

## 4. Tools that do not fit the step model as they are

| Tool | How it fits, or why it stays separate | What still goes through the shared translators |
|---|---|---|
| **Constraint tools** | They fit: a list of `pick` steps and one `build` (`createConstraint`). The build is chosen by the kinds picked: H/V takes 1 or 2 picks, Coincident point-point vs point-curve, Midpoint 2 or 3 picks. That is an **optional step** (`optional: (picks) => bool`) and a `build` that switches on the pick kinds, which is what the handlers do inline today. Refusals stay per tool (keep the pick, reset, or clear: CT:320-325, :469-475), declared as `onRefuse`. The picks move out of the global selection into the session (fixes K-3; the highlight comes from the session). | all of it |
| **Trim / Break** | They fit: one step, `fires: 'press'` (today's timing), `after: 'stay'`, plus a `hover` preview. Their own `getScale` hit test is replaced by the shared pick with the touch boost (TB-1). | all |
| **Close Path** | Fits as Trim. Its `begin` closes the selection's chains at once (:71-74). | all |
| **Mirror** | Fits: step 1 is a **multi-pick** step (`pick: PICK.objects, repeat: true`, ended by `finish`), step 2 the line. `begin` skips step 1 with a selection. | all |
| **Fillet** | Partly. Steps 1-2 (curve, curve → corner) are steps; the radius box is the step's `boxes`. The **multi-corner session** (each extra click adds a corner, :202-216) is a `repeat` step that collects corners until `finish` (Enter, Done, empty click: F-1). The drag arrow is a `handle` event that writes the box value. | picks, box, `handle`, finish |
| **Offset** | Partly. Step 1 is the chain pick; the side is a `values`-like input from `hover` (mouse) or a `step` tap (touch, today :102). Plus a `handle` (arrow) and `finish` → `after: 'select'`. | all |
| **Text** | Step 1 (the anchor) fits. The editor is a dialog session: it stays its own DOM. Its keys (Esc / Ctrl+Enter / Enter in a field, :292-296) go through the box translator's `cancel` / `finish`. The outside-press commit (T-1) moves to the touch / desktop translators, so a pinch's first finger or a middle-button pan no longer commits. | anchor step, cancel, finish |
| **Patterns** | They stay a **dialog session** (live document edit, re-enterable steps, edit-from-label mode, suppression). The canvas picks inside it (objects, centre, directions, arrows) become `step` / `handle` events, so the session no longer grabs raw presses at IM:664 / :744 / :867. The field keys go through the box translator (Enter / Esc / Ctrl+Z, :599-617). | picks, handles, field keys, cancel |
| **Dimension** | Picks 1-2 fit as steps; Case A-F preselection becomes `begin`. The **placement** (a live constraint dragged until dropped, which can still be upgraded by another pick, DT:399-473) does not: it stays the tool's own phase, fed by `gesture` events. ONE drop rule replaces the three ends (D-1): click, Enter and Done all call the same `drop`. The 250 ms release rule (D-2) is decided as a gesture in the translator (a press-drag-release is a drop with no box; a click is a drop with the box), by distance not time. That is a behaviour change; see 6. | picks, gesture, the edit box keys |
| **Select / drag** | Stays separate. It has no fixed steps: what a press does depends on the target, the selection, Shift and the movement. It reads `gesture` events with `mods` (Shift) instead of DOM events, and its drag / marquee / double-press thresholds come from the translators (one double-press rule: D-5 / SE-1). The transform box and the label drag use `handle`. | gesture, handle, keys |

---

## 5. Migration

**Prerequisite:** task 1030 merged. This plan builds on its `cancelActiveWork` / `restartActiveTool` / `TOOL_PENDING` / `rightPressIgnored` / held touch.

**Rules for every migration merge:**
- ONE tool, with all its variants, per merge.
- Its old handlers are deleted in the same merge (no second path left behind).
- The grep gate's list grows by that tool's files.
- Any test that drove the old handlers directly is rewritten to drive the shared events, and keeps every assertion it had. 55 test files import tool pointer / key / finalize handlers today. Each rewrite is diff-reviewed for weakened checks.

### 5.1 Circle first: the trial

The trial merge brings, with Circle as their ONLY user, so nothing else moves:
- `ui/tool-session.js` (the engine + `defineTool`);
- the three translators;
- the grep gate.

**What proves it** is a new node test plus a live test, desktop 1280x800 and phone 390x844. Each of these produces **the identical document**: the shapes and constraints JSON, ids normalised.

1. Typed Ø, four ways:
   - mouse: click the centre, type `60`, Enter;
   - mouse: click the centre, type `60`, click anywhere;
   - touch: tap the centre, tap the box, type `60`, Enter;
   - touch: tap the centre, tap the box, type `60`, tap the canvas.
2. Untyped, with a joint under the rim:
   - mouse: click-click;
   - mouse: click, hover the joint, Enter;
   - touch: tap-tap.
   
   All three give point-on-circle. This closes C-1 / X-01 for Circle; today Enter gives one constraint less (probe above).
3. Drag-release (mouse and touch) = click-click at the same two points.
4. **The identical code:**
   - the session's step log for every case above is the same sequence (`centre`, `rim`) with the same picks and values (only `via` differs);
   - a counter on the ONE `build` shows one call per circle;
   - the grep gate passes on `circle-tool.js`;
   - `commitCircle`'s two callers (:161, :177) are gone.
5. Existing guards stay green:
   - `tests/circle-tool.test.js` (rewritten to the session), `tests/circle-typed-snap-b8-1013-node.test.js`;
   - `tests/drawbox-fix-1028-node.test.js` and `-live.test.js` (B-15, the Ø box Tab);
   - `tests/creation-boxes.test.js`, `tests/live-box-names-876-node.test.js`, `tests/live-box-canvas-697-live.test.js`, `tests/mobile-touch-live.test.js`;
   - `tests/draw-undo-*-node.test.js` (esc, session, switch: Circle rows);
   - `tests/interrupts-fix-1030-node.test.js` and `-live.test.js`;
   - the audit rows `B-C*` (`tests/audits/drawbox-audit-1026-round.mjs`) and `B-PHC*` (`-phone.mjs`), and the Circle rows of `tests/audits/interrupts-audit-1023-*.mjs`. These are re-run before and after, and their ROW lines diffed: only C-1 may change, and only to the click's result.

### 5.2 The order of the rest (each line is one merge)

1. **Polygon**: the same two-step shape as Circle; fixes P-1, and P-2 by the `tooSmall` rule.
2. **Arc**: three steps; fixes A-1 (there is no `_tempStart` any more), A-2, A-3.
3. **Rect** (2-point, centre, 3-point): fixes R-1 / R-3. **Deletes the legacy `live-dimension-input.js` box system** (R-2), `live-rect-commit`, `getLiveLockedPoint`, `applyLiveRectConstraints` and the dead `handleRectKeyDown`.
4. **Slot** (all 5): fixes S-1 / S-2 / S-6 by the engine rule. S-3 and S-4 are fixed as declared box rules: an untyped Enter keeps the exact value; `slot-arc` either positions p3 or is not offered (an owner ruling only if it is not obvious; reported then).
5. **Line**: the chain (`after: 'chain'`), one segment build (L-2), one finish (L-1 / L-4, Q1).
6. **Bezier**: anchor steps with a drag payload (the handles); `finish` (Enter, double-click with one rule, B-1); a Done entry on touch (B-2).
7. **Trim**, then **Break** (two merges): press-steps, the shared boosted pick (TB-1, TB-2).
8. **Close Path**.
9. **Constraint tools**: one merge per tool family. Coincident; H/V; Parallel + Perpendicular + Collinear; Tangent + Equal; Midpoint; Symmetric. Fixes K-1..K-3.
10. **Mirror**.
11. **Fillet**: steps, multi-corner `repeat`, arrow `handle`; its `<input>` onto the NIM box.
12. **Offset**: the same.
13. **Text**: the anchor step, plus the editor keys through the box translator; T-1.
14. **Patterns** (Circular and Rectangular in one merge, one session file).
15. **Dimension**: picks and preselection as steps, the placement on `gesture`, ONE drop.
16. **Select / drag + transform box**: `gesture` / `handle` only.
17. **Close-out**: the grep gate covers every tool file. `cancelActiveWork`'s reset list is one call. `TOOL_PENDING` is gone (all derived).

### 5.3 The guarding tests per tool

| Tool | Audit probes (re-run before and after, ROW lines diffed) | Existing tests that must stay green (node, then live) |
|---|---|---|
| Circle | `drawbox-audit-1026-round` B-C*, `-phone` B-PHC*, `interrupts-audit-1023-*` Circle rows | listed in 5.1 |
| Polygon | `-round` B-P*, interrupts rows | `polygon-tool.test.js`, `polygon-tool-live.test.js`, `drawbox-fix-1028-*` (B-P07) |
| Arc | `-round` B-A*, interrupts rows | `arc-tool.test.js`, `arc-drag.test.js`, `arc-integration.test.js`, `arc-snap-constraint-node/-live`, `arc-no-self-weld-1009-node`, `arc-preview-contract.test.js`, `arc-temp-button.test.js` |
| Rect | `drawbox-audit-1026-rect` B-R*, `-phone` B-PHR*, interrupts rows | `rect-two-point-click.test.js`, `rect-center-click.test.js`, `rect-snap-constraint-867-node/-live`, `rect-menu-*-live`, `direction-777-*`, `drawbox-fix-1028-*` (B-02, B-03, B-14) |
| Slot | `drawbox-audit-1026-slot` B-S*, interrupts rows (I-01) | `slot-tool-node.test.js`, `slot-tool-live.test.js`, `done-button-slot-653.test.js`, `drawbox-fix-1028-*` (B-04) |
| Line | `drawbox-audit-1026-line` B-L*, `-phone` B-PHL*, `-extra` B-X*, interrupts rows | `line-tool.test.js`, `line-tool-inference.test.js`, `line-snap*.test.js`, `line-start-*`, `line-tangent.test.js`, `line-boxes-live.test.js`, `line-start-snap-click-682-live.test.js`, `dbltap-done-701-live.test.js`, `drawbox-fix-1028-*` (B-05, B-06, B-08) |
| Bezier | `-extra2` B-BZ*, interrupts rows | `bezier-*-node.test.js`, `bezier-pick-762-*-live.test.js`, `bezier-snap-872-live.test.js`, `bezier-loops-761-*-live.test.js` |
| Trim / Break | `design-run-audit-1016-partA/B` trim / break steps | `trim-break.test.js`, `trim-*-1018-node`, `break-*-node`, `trim-break-curve-refusal-ux25-node` |
| Close Path | none | `close-path-760-node.test.js`, `close-path-760-*-live.test.js` |
| Constraint tools | `interrupts-audit-1023-part8` (line-pair tools), `design-run-audit-1017-part-c/d` | `constraint-tools.test.js`, `constraint-activation-ux15-1005-node`, `constraint-preselect-b6-1005-node`, `constraint-refusal-stay-b15-1005-node`, `constraint-refusals-871-*`, `coincident-868-*`, `midpoint-*`, `symmetric*`, `equal-*`, `input-manager-equal*.test.js`, `constraint-glyph-menu-live.test.js` |
| Mirror | interrupts rows | `mirror*.test.js`, `selection-mirror-795c-*` |
| Fillet | `drawbox-audit-1026-modify` B-F* | `fillet-*` (node), `fillet-*-live.test.js`, `done-check-fillet-edge-653-live.test.js`, `fillet-handle-646.test.js` |
| Offset | `-modify` B-O* | `offset-*` (node and live), `offset-arrow-652.test.js` |
| Text | interrupts rows (I-02) | `text-845-node.test.js`, `text-845-*-live.test.js` (studio, shaper, penplotter, each with a phone file) |
| Patterns | `-modify` B-PC*, B-PR* | `pattern-*` (node and live) |
| Dimension | `dimension-audit-1003-*`, `interrupts-audit-1023-part5` | `dimension-*` (node), `dimension-1004-live`, `dimension-pick-live-*`, `dimension-enter-once-*`, `dimpicks-1008-*`, `dim-box-*-723-live` |
| Select | `solver-ux-audit-1000-drag` | `selection-*`, `drag-*` (node), `drag-follow-live`, `drag-target-release-live`, `chain-select-move-live`, `transform-753-node.test.js` |

Every merge also runs `interrupts-fix-1030-node` / `-live`, `draw-undo-*-node` and shell-smoke 12/12 (SketchStudio unregressed). The live test of the migrated tool runs in each host that has the tool (all four share the Design tab).

### 5.4 The grep gate

`tests/tool-input-boundary-node.test.js` (quick tier, no browser) holds a list of migrated tool files; the list only grows.
- **It fails when a listed file contains:** `addEventListener`, `pointerdown|pointermove|pointerup|pointercancel|keydown|contextmenu|touchstart`, `setPointerCapture`, `.button`, `.pointerType`, `.isPrimary`, `.clientX|.clientY`, `.shiftKey`, `matchesShortcut`, `e.key`, `liveDimension(Applied|Preview|Cancelled)`, or `via ===` / `via !==`.
- **It also checks:**
  - IM no longer imports a migrated tool's `handle*Pointer*` / `handle*KeyDown`;
  - `ui/tool-session.js` has exactly one `build(` call site;
  - every migrated file's description passes `defineTool`.
- At the close-out (5.2 step 17) the list is "every file under `ui/input-handlers/` and `ui/close-path-actions.js`, `ui/transform-box.js`".

---

## 6. Risks and what existing behaviour could change

**Risks**
- R-1. 1030 is not merged yet. The [1030] line numbers move with its merge; the plan's names (`cancelActiveWork`, …) do not.
- R-2. 55 test files call tool handlers directly. Rewriting them could weaken them; each rewrite is diffed for removed or loosened assertions.
- R-3. Four hosts share IM (`TODO(shaper)` IM:5: ~54 DOM-id reaches). The translators must keep the host gates (`isActiveFn`, `inputCtx`) exactly. Shell-smoke 12/12 every merge.
- R-4. Picks are held as plain points until `build` (2.2), so a half-drawn shape's centre / start joint no longer exists in `state.joints` mid-draw. Today the renderer and the snap exclude lists read it. The preview must come from the session. Who reads `state.active.start` mid-draw was not checked; it is checked in the Circle trial.
- R-5. The hover path runs on every move. The session must not add work per move beyond today's `updatePreview`.
- R-6. The legacy Rect preview (`updateLiveRectPreview`, IM:841) also rewrites `tempMousePos`. What the renderer takes from it was not checked (R-2's removal is checked in the Rect merge).
- R-7. A pattern session grabs presses under any tool (IM:664): the desktop translator must keep that order.

**Behaviour changes for existing users** (each comes from making two paths one; none is a new feature)
- B-1. Enter now applies the snap the cursor shows, as the click does: Line end, Rect corners, Circle rim joint, Polygon corner, Arc start / end, Slot span / p3 (X-01). This is the B-02 owner rule "the click's rules apply to both", applied to every tool.
- B-2. A typed Slot span no longer keeps the span-end snap; the first centre stays where it was clicked (S-1).
- B-3. Arc: after a drag-set radius, the next click places the end (A-1).
- B-4. A digit typed on the canvas goes into the current step's box in every draw tool. Today: Circle, Slot, legacy Rect; nothing in Line, Polygon, Arc (X-06). Circle's box then opens beside the cursor, not at the chord midpoint (C-2).
- B-5. Rect's legacy box is gone. A digit during a Rect press types into the W×H box, and its typed sides become dimensions; today the legacy box makes none (R-2).
- B-6. One drag threshold for every draw tool: today 2 px or 3 px (X-04).
- B-7. Polygon: a click on the centre is ignored and the tool keeps waiting; today it cancels the polygon (P-2).
- B-8. Constraint tools: the hover lights only what the current step takes (K-2). Delete mid-pick no longer deletes the picked geometry (K-3).
- B-9. Trim / Break: the 2x touch pick reach (TB-1).
- B-10. Text: a pinch or a middle-button pan no longer commits the open editor (T-1).
- B-11. Dimension: a press-drag-release is a drop with no box decided by distance, not 250 ms; a still mouse held 250 ms then opens the box like a click (D-2). Click, Enter and Done drop the same way (D-1).
- B-12. Line finish: depends on Q1.
- B-13. Bezier: on touch, a Done check ends the path (B-2). A slow second click near the last anchor no longer ends it (B-1, one double-press rule).

**Fusion parity notes** (all **unverified**: not checked in Fusion for this task; each is a divergence to flag, the owner decides)
- In Fusion, a value typed in the on-canvas box plus Enter places the point, and the snap shown at that moment is kept. This matches B-1.
- Fusion's Line ends on Esc, on a double-click, or via the right-click menu's OK. Ours: Enter on the canvas, Done, right-click, a click on the last point (Q1).
- Fusion has 2-point, 3-point and tangent circles, and 3-point and tangent arcs. Ours: centre-Ø and centre-start-end only. The owner's "the Arcs" are today one variant. The description format adds variants without new plumbing, but adding them is not in scope.
- In Fusion, a sketch constraint command applies to a selection made before it starts. Ours does that for H/V, Equal and preselection (CT:91-134).

---

## 7. Owner questions (two, both change the plan)

- **Q1. Line: one "finish" for canvas Enter, the Done check and the right-click?** Today the right-click commits a typed length, then ends the chain ([1030] `rightClickLine`, B-05). Canvas Enter and Done end the chain and **drop** the typed segment (line-tool.js:283-290, IM:987). Proposed default: all three commit a typed segment first, then end (the right-click's rule).
- **Q2. When does a step fire: press or release, one rule or per tool?** Today Trim, Break, Close Path, Mirror and the constraint tools act on the **press** (a drag that starts on a curve trims and never pans). The draw tools act on the **release**. On a phone, [1030] already delays every press to the lift. Proposed default: keep each tool's timing as a declared `fires` field, so nothing changes. The alternative, one rule "a step fires on release", makes desktop and phone identical but changes the press tools.

---

## Appendix: new bugs found while reading (reported to the advisor; NOT entered in BUG-ARCHIVE, audit rule 5)

1. **X-01: Enter drops the snap the cursor shows**, in Line, Rect (all variants), Circle, Polygon, Arc and Slot. Probed (Rect, Circle, Line, Polygon), output above. Cause: `state.active.preview.snapTarget` is overwritten by the tool's own `updatePreview` (IM:519-527 vs `ui/preview-manager.js:37-62`); the other Enter paths pass no snap at all.
2. **A-1: Arc: after a drag-set radius, the end click is swallowed** and the sweep box becomes a radius box. Probed, output above. Cause: `_tempStart` is not cleared on the drag path (arc-tool.js:193, :249-252, :264).
3. **S-1: Slot: a typed span keeps the span-end snap** and the solver moves the slot. Probed: `span typed 20: hover snap shape, new shapes 5, new pointOnLine 1, centres (40.00,6.96) (20.00,6.96)`. Cause: slot-tool.js:646 → :401 → :354.
4. Read, not run (likely): the Rect legacy box makes no dimensions (R-2), Slot centre-point arc p3 snap on the wrong joint (S-5), Slot width rounding on Enter (S-3), constraint picks deleted by Delete (K-3), Select's double inference commit (SE-2).
