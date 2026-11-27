# Interruptions audit (task 1023)

Audit only. No product code was changed. Probes: `tests/audits/interrupts-audit-1023-*.mjs` (outside the gate, real pointer / keyboard / wheel / touch events through `tests/helpers/cdp-browser.js`; one `ROW id | tool | stage | interruption | result` line per cell). Branch `agents/interrupts-1023`, merged with `origin/main` at `62df6c98` (fixes 1008, 1013, 1018, 1019, 1021 in: ONE Esc leaves Offset / Fillet).

## 1. Result

**1490 cells run: 1018 OK, 132 BUG, 146 FRICTION, 82 DIVERGENCE** (plus 112 cells that do not apply or could not be reached, listed as `n/a`). They group into **23 findings** (table below): 10 BUG, 5 DIVERGENCE, 8 FRICTION. **No regression** of a FIXED archive entry was found (checked against `docs/BUG-ARCHIVE.md` and `docs/*AUDIT*.md`); two findings are siblings of fixed or filed ones: I-03 (BUG-150, same cause family, fixed only for the drag) and I-17 (B-05, same cause, Line only).

Cells: desktop 1335 (OK 917, BUG 102, FRICTION 140, DIVERGENCE 76, n/a 100), phone 135 (OK 86, BUG 25, FRICTION 6, DIVERGENCE 6, n/a 12), follow-up rows 20 (OK 15, BUG 5). A cell counts once per interruption, so one cause shows up in many cells.

Where Fusion is not known the expectation is marked (unverified). Known Fusion fact used: ONE Esc cancels and leaves the tool (verified live 2026-11-26, owner ruling BUG-105). Owner rule used: re-clicking the same tool's button does NOT exit.

## 2. Findings (summary table)

| id | cell(s) | verdict | what happened vs expected | repro | severity |
|---|---|---|---|---|---|
| **I-01** | Slot (all 5 variants) after the 1st pick / 2nd pick / box typed x ribbon switch (SWR-025..039, 11 cells) and x re-click of the Slot button (RCC-025..039, 11 cells); phone: tap other tool / tap Slot | **BUG** | Another tool is picked (or Slot is re-clicked) in the middle of a slot: the slot is dropped but its value box stays open on the canvas (`#dimInput` still shows the typed value, nothing behind it), now over the next tool. Every other draw tool closes its box. Expected: the box goes with the draw (like Line / Rect / Circle). | Slot (any variant), click 1, type `22` in the box, click the Circle button: the box "22" stays. Screenshot `.evidence/1023/slot-box-zombie-after-switch-to-circle.png`. | misleading UI |
| **I-02** | Esc inside the open box of Text (ESC-044), of Dimension (ESC-070) and of the 3-point rectangle width box (ESC-013) | **BUG** | ONE Esc closes the box only; the tool stays (`tool=text`, `tool=dim`, `tool=rect`) and a SECOND Esc is needed. Owner ruling (BUG-105, Fusion verified 2026-11-26): ONE Esc cancels and leaves the tool; BUG-223 fixed this for Offset / Fillet / the draw boxes, not for these three boxes. | Dimension tool, pick 2 things, click to place, type `35`, Esc: box gone, Dimension still active. Same for Text (click, type, Esc) and Rect 3-point (click, move, type `25`, Esc). | misleading UI |
| **I-03** | Every draw tool (and Dimension placing) after the 1st pick, then Esc / tool switch / re-click: Esc x17 cells, ribbon switch x18, key switch x4, phone tap other tool x6; plus follow-ups F2-line, F2-circle, F2-rect, F4-esc2 | **BUG** | The 1st click of Line / Rect / Circle / Arc / Polygon / Bezier / Dimension opens an undo step, which clears the Redo stack (`R:1->0`). Esc or a tool switch then drops the step (`U` back to the old value) but the Redo stack stays empty: a cancelled draw loses the user's redo history. Expected: cancel leaves undo AND redo exactly as before (Slot, Fillet, Offset, constraints do: `R:1`). Same family as BUG-150 (a no-op drag wiped Redo; fixed for the drag only). | Draw 2 shapes, Ctrl+Z once (Redo now has 1), pick Line, click once, Esc: Redo is empty (Ctrl+Y does nothing). | lost work (redo history) |
| **I-04** | Re-click of the same tool's ribbon button in Line, Rect x3, Circle, Arc, Polygon, Bezier (RCC-002..042, 18 cells; phone x6) | **DIVERGENCE** | Owner rule: re-click does NOT exit. The tool stays, but the half-made draw is wiped (`hasActive true->false`, the first joint and its undo step removed) and a typed box value is lost. Constraint tools, Fillet, Offset, Dimension, Trim, Break keep their pick / box on a re-click (RCC rows). Expected: one consistent rule; Fusion restarts the command on a re-click (unverified), so state which of the two is meant. | Rect, click once, type `25`, click the Rect button again: the box and the first corner are gone, tool still Rect. | friction (typed value lost) |
| **I-05** | Ctrl+Z / Ctrl+Y after the 1st pick in Fillet, Mirror, Dimension, every constraint tool (UND 14 cells, RED 15 cells) | **DIVERGENCE** | Draw tools: Ctrl+Z cancels the half-made draw, makes no extra undo step and LEAVES the tool (`tool->select`). Constraint / Mirror / Fillet / Dimension (pick pending): Ctrl+Z undoes the PREVIOUS finished step, drops the picked item and stays in the tool; Ctrl+Y redoes a step and drops the pick. Two rules for one gesture. Expected (unverified): a mid-pick Undo cancels the pick, not an older step. | Draw a line, pick Coincident, click a point, Ctrl+Z: the line is undone, the tool stays. | wrong geometry risk (an older step is undone by a mid-pick Ctrl+Z) |
| **I-06** | Dimension, label being placed, Ctrl+Z (UND-067, F2-dim) | **BUG** | Ctrl+Z removes the dimension being placed from the document (`cons 2->1`) but the tool still reports `placing=true`; Ctrl+Y then brings the half-placed dimension back (`cons 1->2`, still `placing=true`). Expected: Ctrl+Z cancels the placement and the placement state; Redo has nothing to bring back. | Dimension, pick 2 points, move (label follows), Ctrl+Z, then Ctrl+Y. | misleading UI |
| **I-07** | Circular / Rectangular Pattern after the pick, then Esc (ESC-058, 059, 061, 062) | **FRICTION** | Esc leaves the Select tool with the source shape still selected (`S:1`); every other tool's Esc clears the selection (S:0). | Circular Pattern, click a line, Esc. | friction |
| **I-08** | Select tool, joint drag in progress, Esc (ESC-063) | **DIVERGENCE** | Esc ends the drag but KEEPS the moved position as an undo step (`U:1->2`, `R:1->0`). Esc during a transform-box handle drag puts the group back (TASK 753). Expected (unverified): Esc cancels a drag in both. | Drag a free point, press Esc before releasing. | wrong geometry risk |
| **I-09** | Transform box, value typed, another tool picked from the ribbon (SWR-063; screenshot) | **BUG** | The tool switches to Circle but the transform box (`#tbox-input`, typed `30`) stays on the canvas. Screenshot `.evidence/1023/transform-box-zombie-after-switch-to-circle.png`. | Select a user group, click its rotate handle, type `30`, click the Circle button. | misleading UI |
| **I-10** | Typed value in Dimension box / Dimension edit box / Text editor, then another tool, re-click, right-click, a click on a panel (16 cells) | **DIVERGENCE** | These three COMMIT what was typed when anything else is clicked (+1 undo step: TASK 723 for the dimension edit box, TASK 845 for Text); every draw box DISCARDS it. Known design, recorded as a consistency difference, not re-filed as a bug. Expected (unverified): one rule for a typed, unconfirmed value. | Dimension edit: double-click a label, type `45`, click the footer: 45 is applied. Rect: type `25`, click the footer: discarded. | friction |
| **I-11** | Tool shortcut key while the Circular / Rectangular Pattern window is open (SWK-057..062) | **FRICTION** | The key (`c`) does nothing: the window's keys are its own. The ribbon button switches tools. Not a defect by itself, but nothing tells the user. | Circular Pattern (window open), press `c`. | friction |
| **I-12** | Select tool, drag in progress (joint drag, transform handle), then a tool key (SWK-063, 064) | **BUG** | The tool switches to Circle while `state.drag` stays live (`drag=joint` / `drag=transform`) until the mouse is released. Expected: the drag ends (or the key is held back) before the switch. | Drag a point, press `c` while holding the button. | misleading UI |
| **I-13** | Re-click Rectangular Pattern after its pick (RCC-061, 062) | **FRICTION** | A live pattern appears (`shapes 8->9`, `U 1->2`, `R 1->0`); the same re-click on Circular Pattern changes nothing. | Rectangular Pattern, click a line, click the Rectangular Pattern button again. | friction |
| **I-14** | Ctrl+Z inside a draw box with typed text (UND-003, 006, 009, 016, 023, 030, 033, 036, 039, 053) | **FRICTION** | Undo inside the box (right: it is the box's own undo) puts `0` in the field, not the live cursor value the field had before typing (Arc and Slot-c2c show a live value). | Line, click, type `25`, Ctrl+Z: the length box shows `0`. | friction |
| **I-15** | Rect 3-point / Bezier after the 1st / 2nd pick, Ctrl+Y with nothing to redo (RED-011, 012, 041) | **BUG** | Redo with an empty Redo stack still cancels the half-made draw (`hasActive true->false`, `U 2->1`) and the tool stays. Expected: nothing happens. The boxed draw tools ignore the key (box focused). | Rect 3-point, click, move, Ctrl+Y: the first corner is gone. | lost work |
| **I-16** | Delete while a constraint tool / Mirror holds a pick: Coincident, H/V, Parallel, Perpendicular, Collinear, Tangent, Equal, Midpoint, Symmetric, Mirror (DEL-055..087, K-DEL-*, 12 cells) | **DIVERGENCE** | The picked line / point is DELETED with its attached geometry (`shapes 8->7`, one undo step) and the tool stays. Whether a pending pick counts as a selection to delete is the open question. | Coincident, click a point, press Delete: the line is gone. | lost work (undoable) |
| **I-17** | Right-click on empty canvas in Line, Rect x3, Circle, Arc, Polygon, Slot x5, Bezier (RCK 31 cells) | **BUG** | A right-click acts as a left click: before the 1st pick it STARTS the shape, after the 1st pick it places the next point or COMPLETES the shape at the cursor (rect `shapes 8->12`, polygon `8->20`, circle `8->9`). Only Select / Dimension have a right-button guard (`input-manager.js:564`). Line: the finalizing right-click is already filed as B-05 (DRAWBOX-AUDIT-1026) and is not re-filed; this row is the same cause in every other draw tool. Expected (unverified): a right-click never places a point; Fusion opens its marking menu. | Rect, click once, right-click elsewhere: a rectangle appears. | wrong geometry |
| **I-18** | Dimension tool, a pick or a placement pending, then a right-click / a click on a panel (RCK-066, 067, PNF-067, P9B-067, PNP-067) | **FRICTION** | The pending pick / placement is dropped (`hasActive true->false`, `placing true->false`). Other tools keep a pick across a panel click. | Dimension, click a point, click the footer, click the 2nd point: it starts a new first pick. | friction |
| **I-19** | A box open (typed or not) then middle-drag pan, a click on the footer bar, on the Sketches browser, on the Parameters window (112 cells) | **FRICTION** | The state is kept (box open, values, active draw) but keyboard focus leaves the box (`focus: input -> body`). Enter does nothing until the user clicks back into the box (completion probe: Enter after the pan gives `dShapes=0`, the control gives 1+). Wheel zoom keeps the focus (WHL: 89/89 ok). | Line, click, type `25`, pan with the middle button, press Enter: nothing. | friction |
| **I-20** | Rect 3-point, the width box, Delete (DEL-013) | **FRICTION** | Delete closes the box like Esc (`live-dimension-input.js:360`, `Escape || Delete`) instead of deleting a character; the draw goes on with no box. Every other box treats Delete as a text key. | Rect 3-point, click, move, type `2`, press Delete. | friction |
| **I-21** | Phone 390x844: two-finger pinch or pan with a tool active (8 + 9 cells) | **BUG** | The first finger is a normal press: it starts a Line, completes a Rect (`shapes 8->12`), Polygon (`8->20`) or Bezier, trims in Trim (`cons +1`), picks in Coincident / Dimension (`cons +1`, one undo step), before the second finger turns it into a pinch. Pinch and pan then work, but the shape / trim / constraint is already made. The probe puts both fingers down in one event (a real pinch lands the second finger 10-100 ms later, the first finger's press is still handled first). | Phone, Rect, tap once, put two fingers on the canvas: the rectangle is completed. | wrong geometry |
| **I-22** | Rect 3-point, typing in its width box (any interruption after it; DEL-013, PAN-006, P9S-013 ...) | **BUG** | Typing in the box scrolls the WHOLE page (`scrollX 1607, scrollY 922`): the header, ribbon and burger leave the window (burger `y=-915`) and the next clicks land elsewhere. The box `#live-dim-width` opens at `x=1193 y=783 w=158` in a 1280x800 window, partly outside it. Esc puts the page back. Cells marked `*` in the grids are affected. | Rect 3-point, click, move, type `2`, look at the page; click the burger. | misleading UI |
| **I-23** | Phone: a 750 ms press on the canvas in a draw tool (6 cells) | **FRICTION** | A long press is a plain click in Line / Rect / Circle / Arc / Polygon / Bezier (places or completes). Only Select / Dimension open a context menu on a hold. Expected (unverified): same as a tap, so no bug, but nothing tells the user. | Phone, Rect, tap once, press and hold elsewhere. | friction |

## Status after task 1030

| id | status | where | guard |
|---|---|---|---|
| I-01 | fixed (BUG-320) | `input-manager.js` `cancelActiveWork`, run by `leaveActiveTool` | `tests/interrupts-fix-1030-node.test.js` |
| I-02 | Text / Dimension fixed (BUG-321); the 3-point rectangle half was already fixed by task 1028 | `input-manager.js` `liveDimensionCancelled` listener, `text-tool.js` | node |
| I-03 | fixed (BUG-322) | `sketch-state.js` (a dropped step gives back the Redo its save cleared) | node |
| I-04 | fixed (BUG-323) | `input-manager.js` `switchToTool` | node |
| I-05 | fixed (BUG-324) | `input-manager.js` `sketchHistory`, `TOOL_PENDING`, `restartActiveTool` | node |
| I-06 | fixed (BUG-325) | as I-05 | node |
| I-07 | already fixed on main before 1030 (task 1020) | | node (guard) |
| I-08 | fixed (BUG-326) | `selection-tools.js` `cancelPointDrag` | node |
| I-09 | fixed (BUG-327) | `cancelActiveWork` (`transform-box.js closeTransformInput`) | `tests/interrupts-fix-1030-live.test.js` |
| I-12 | fixed (BUG-328) | `cancelActiveWork` | node |
| I-15 | fixed (BUG-329) | `sketchHistory` redo | node |
| I-17 | fixed (BUG-330) | `input-manager.js` `rightPressIgnored`, `line-tool.js rightClickLine` | node + live |
| I-18 | fixed (BUG-331) | as I-17 | node |
| I-19 | fixed (BUG-332) | `input-manager.js` document `pointerdown` | live |
| I-20 | already fixed by task 1028 | | node (guard) |
| I-21 | fixed (BUG-333) | `input-manager.js` svg pointer listeners (the held press) | live (phone) |
| I-22 | already fixed by task 1028 | | live (guard) |
| I-10, I-11, I-13, I-14, I-16, I-23 | not in task 1030 (I-13 no longer happens: a re-click does nothing, BUG-323) | | |

## Causes (grouped; file:line)

- **Draw step: first click clears Redo; cancel does not restore it** (I-03): `packages/core/sketch-state.js:196` (`saveStateForce`: `redoStack.length = 0`), reached from `beginUndoGroup` (`:221`) at the first click of line / rect / circle / arc / polygon / bezier / dimension; `closeDrawStep` (`:260`) drops the step but never restores `redoStack`. Slot never calls `beginDrawStep` (`slot-tool.js:553-578`), so it keeps Redo.
- **Slot has no draw step, so a tool switch cannot close its box** (I-01): `packages/ui/input-handlers/slot-tool.js:446-451` registers `onDrawCancelled`, but `closeDrawStep` (`sketch-state.js:260`) returns `none` before it fires the listeners when no `beginDrawStep` group is open, and `handleSlotPointerDown` (`slot-tool.js:553-578`) never opens one. `leaveActiveTool` (`input-manager.js:1433-1439`) relies on it. Esc works because `handleEscape` calls `resetDrawingState` itself (`input-manager.js:1541`).
- **Re-click runs the "leave the tool" cleanup** (I-04, I-01): `switchToTool` (`input-manager.js:1442`): only the constraint tools return early on a same-tool call (`:1444`); every other tool runs `leaveActiveTool` (`:1448` -> `closeDrawStep` `:1435`), which cancels the half-made draw.
- **Esc in three boxes does not raise the shared Esc** (I-02): The `liveDimensionCancelled` listener (`input-manager.js:1222-1226`) handles drawing tools and Offset / Fillet only; Dimension is not in it, the Text editor handles Esc itself (`text-tool.js:294`) and the 3-point rectangle box hides on Esc (`live-dimension-input.js:360`) without leaving the tool.
- **Right button is not filtered in the pointer path** (I-17): `input-manager.js:540-566` (`handlePointerDown`): `e.button === 1` pans and `e.button === 2` is consumed only for Select / Dimension (`:564`); every other tool receives the right press as a left press.
- **Tool switch does not close the transform box or end a drag** (I-09, I-12): `leaveActiveTool` (`input-manager.js:1433-1439`) commits the text editor, closes the draw step and resets Dimension, but touches neither the transform value box (`transform-box.js:310`) nor `state.drag`.
- **Undo / Redo run `closeDrawStep` first** (I-05, I-15): `sketch-state.js:316` (`undo`) and `:325-326` (`redo`: `closeDrawStep()` runs BEFORE the empty-Redo check). Constraint / Mirror / Fillet / Dimension picks have no draw step, so the key falls through to a normal undo / redo of the previous step.
- **Pointer press handled before the second finger arrives** (I-21): `input-manager.js:1017-1030` (svg `pointerdown`): the primary touch runs `handlePointerDown`; `touchPointerDown = e.isPrimary` only stops LATER fingers. The draw / trim / constraint tools act on the first press.
- **Box loses keyboard focus on a canvas pan or a panel click** (I-19): (unverified) the press on the page body moves focus (`body.sk-has-footer`); nothing returns focus to the open box. Wheel zoom has no press and keeps it.
- **Dimension placing survives its own undo** (I-06): (unverified) `resetDimensionState` (`dimension-tool.js:139`) is not run by `undo` when the placing constraint was removed by the snapshot restore; `placingConstraint` stays set.
- **Delete closes a live box** (I-20): `packages/ui/input-handlers/live-dimension-input.js:360`.
- **Pattern cancel re-selects the source** (I-07): `pattern-tool.js:171-179` (`cancelSession` undoes the live step; the restored state carries the pick) after `handleEscape` cleared the selection (`input-manager.js:1528-1531`). (unverified)
- **Esc during a joint drag** (I-08): `handleEscape` (`input-manager.js:1546-1547`) sets `state.drag = null` without restoring the start pose (only `cancelTransformGesture` does, `transform-box.js:234`).

## 3. Rules used (expected behaviour)

Stages: **before 1st pick** (tool armed, cursor over the canvas), **after 1st pick** (first point / first object picked, box open where the tool has one), **after 2nd pick** (3-point rect, arc, slot c2c), **box open, text typed** (a value typed in the open box, not confirmed), plus the special stages Mirror step 2, Dimension placing, a joint drag, a transform-handle drag, the transform value box, the dimension edit box.

| interruption | expected |
|---|---|
| Esc | ONE Esc cancels the pick / box / placement and leaves the tool (Select); nothing made, no undo step, Redo untouched (Esc after a committed Bezier / Line chain keeps what was committed). |
| another tool, ribbon or key | the pick is cancelled like Esc, the new tool is active, no box from the old tool remains; typed unconfirmed box values are discarded (except the Text / dimension-edit commit rule, TASK 845 / 723). A typed letter in a focused box is text, not a shortcut. |
| re-click the same tool's button | does NOT exit (owner rule). Pending pick / box kept (the constraint tools do this). |
| Ctrl+Z / Ctrl+Y mid-tool | (unverified) Ctrl+Z cancels the half-made pick, one undo step at most, no older step undone; inside a focused box it is the box's own undo. |
| Delete mid-tool | (unverified) never deletes geometry while a pick is pending; inside a box it edits the text. |
| right-click | (unverified) never places a point; opens the context menu in Select / Dimension only. |
| wheel zoom, middle-drag pan | the tool state is kept; the view changes; focus stays where it was. |
| click a panel and back | the tool state is kept (typed values kept or consistently committed); focus returns. |
| window blur / focus | state kept. Headless Chrome gives no real blur: synthetic `blur` / `visibilitychange` / `focus` events (labelled). |
| phone touch | the same rules; a pinch / pan never makes geometry. |

How "ok" was decided per cell: the probe takes the full state before and after (active tool, open boxes and focus, drawing in progress, drag, placing, constraint flags, overlays, shapes / joints / constraints, selection, undo and redo stack lengths, page errors) and then, for the state-keeping interruptions, finishes the tool with the next real clicks / Enter ("completion probe") to prove the pick really survived. A control run with no interruption (`p7.log`) shows what the probe itself can finish; cells where the control cannot finish are not used as evidence.

## 4. Full matrix, grouped by interruption

Cell codes in the grids: `ok` = as expected, `I-nn` = finding, `n/a` = not applicable or not reached, `*` = the page was scrolled by finding I-22 in this cell (the typed 3-point rectangle box), results there are less reliable.

### Esc

{'OK': 64, 'BUG': 20, 'FRICTION': 4, 'DIVERGENCE': 1}

| tool | before 1st pick | after 1st pick | after 2nd pick | box open, text typed | other stage |
|---|---|---|---|---|---|
| line | ok | I-03 |  | I-03 |  |
| rect-2pt | ok | I-03 |  | I-03 |  |
| rect-center | ok | I-03 |  | I-03 |  |
| rect-3pt | ok | I-03 | I-03 | I-02* |  |
| circle | ok | I-03 |  | I-03 |  |
| arc | ok | I-03 | I-03 | I-03 |  |
| polygon | ok | I-03 |  | I-03 |  |
| slot-c2c | ok | ok | ok | ok |  |
| slot-overall | ok | ok |  | ok |  |
| slot-center | ok | ok |  | ok |  |
| slot-arc3 | ok | ok |  | ok |  |
| slot-arccenter | ok | ok |  | ok |  |
| bezier | ok | I-03 | ok |  |  |
| text | ok |  |  | I-02 |  |
| trim | ok |  |  |  |  |
| break | ok |  |  |  |  |
| closePath | ok |  |  |  |  |
| fillet | ok | ok |  | ok |  |
| offset | ok | ok |  | ok |  |
| mirror | ok | ok |  |  | step 2: ok |
| circularPattern | ok | I-07 |  | I-07 |  |
| rectangularPattern | ok | I-07 |  | I-07 |  |
| select-drag |  |  |  |  | mid-drag: I-08 |
| transform |  |  |  |  | handle drag: ok; box typed: ok |
| dim-edit |  |  |  |  | box typed: ok |
| dim | ok | ok |  | I-02 | placing: I-03 |
| coincident | ok | ok |  |  |  |
| hv | ok | ok |  |  |  |
| parallel | ok | ok |  |  |  |
| perp | ok | ok |  |  |  |
| collinear | ok | ok |  |  |  |
| tangent | ok | ok |  |  |  |
| equal | ok | ok |  |  |  |
| midpoint | ok | ok |  |  |  |
| symmetric | ok | ok | ok |  |  |

### Tool switch: ribbon click

{'OK': 56, 'BUG': 30, 'N/A': 2, 'DIVERGENCE': 1}

| tool | before 1st pick | after 1st pick | after 2nd pick | box open, text typed | other stage |
|---|---|---|---|---|---|
| line | ok | I-03 |  | I-03 |  |
| rect-2pt | ok | I-03 |  | I-03 |  |
| rect-center | ok | I-03 |  | I-03 |  |
| rect-3pt | ok | I-03 | I-03 | I-03* |  |
| circle | ok | I-03 |  | I-03 |  |
| arc | ok | I-03 | I-03 | I-03 |  |
| polygon | ok | I-03 |  | I-03 |  |
| slot-c2c | ok | I-01 | I-01 | I-01 |  |
| slot-overall | ok | I-01 |  | I-01 |  |
| slot-center | ok | I-01 |  | I-01 |  |
| slot-arc3 | ok | I-01 |  | I-01 |  |
| slot-arccenter | ok | I-01 |  | I-01 |  |
| bezier | ok | I-03 | ok |  |  |
| text | ok |  |  | ok |  |
| trim | ok |  |  |  |  |
| break | ok |  |  |  |  |
| closePath | ok |  |  |  |  |
| fillet | ok | ok |  | ok |  |
| offset | ok | ok |  | ok |  |
| mirror | ok | ok |  |  | step 2: ok |
| circularPattern | ok | ok |  | ok |  |
| rectangularPattern | ok | ok |  | ok |  |
| select-drag |  |  |  |  | mid-drag: n/a |
| transform |  |  |  |  | handle drag: n/a; box typed: I-09 |
| dim-edit |  |  |  |  | box typed: ok |
| dim | ok | ok |  | I-10 | placing: I-03 |
| coincident | ok | ok |  |  |  |
| hv | ok | ok |  |  |  |
| parallel | ok | ok |  |  |  |
| perp | ok | ok |  |  |  |
| collinear | ok | ok |  |  |  |
| tangent | ok | ok |  |  |  |
| equal | ok | ok |  |  |  |
| midpoint | ok | ok |  |  |  |
| symmetric | ok | ok | ok |  |  |

### Tool switch: shortcut key

{'OK': 77, 'BUG': 6, 'FRICTION': 6}

| tool | before 1st pick | after 1st pick | after 2nd pick | box open, text typed | other stage |
|---|---|---|---|---|---|
| line | ok | ok |  | ok |  |
| rect-2pt | ok | ok |  | ok |  |
| rect-center | ok | ok |  | ok |  |
| rect-3pt | ok | I-03 | I-03 | ok* |  |
| circle | ok | ok |  | ok |  |
| arc | ok | ok | ok | ok |  |
| polygon | ok | ok |  | ok |  |
| slot-c2c | ok | ok | ok | ok |  |
| slot-overall | ok | ok |  | ok |  |
| slot-center | ok | ok |  | ok |  |
| slot-arc3 | ok | ok |  | ok |  |
| slot-arccenter | ok | ok |  | ok |  |
| bezier | ok | I-03 | ok |  |  |
| text | ok |  |  | ok |  |
| trim | ok |  |  |  |  |
| break | ok |  |  |  |  |
| closePath | ok |  |  |  |  |
| fillet | ok | ok |  | ok |  |
| offset | ok | ok |  | ok |  |
| mirror | ok | ok |  |  | step 2: ok |
| circularPattern | I-11 | I-11 |  | I-11 |  |
| rectangularPattern | I-11 | I-11 |  | I-11 |  |
| select-drag |  |  |  |  | mid-drag: I-12 |
| transform |  |  |  |  | handle drag: I-12; box typed: ok |
| dim-edit |  |  |  |  | box typed: ok |
| dim | ok | ok |  | ok | placing: I-03 |
| coincident | ok | ok |  |  |  |
| hv | ok | ok |  |  |  |
| parallel | ok | ok |  |  |  |
| perp | ok | ok |  |  |  |
| collinear | ok | ok |  |  |  |
| tangent | ok | ok |  |  |  |
| equal | ok | ok |  |  |  |
| midpoint | ok | ok |  |  |  |
| symmetric | ok | ok | ok |  |  |

### Re-click the same tool button

{'OK': 52, 'DIVERGENCE': 21, 'BUG': 11, 'FRICTION': 2, 'N/A': 3}

| tool | before 1st pick | after 1st pick | after 2nd pick | box open, text typed | other stage |
|---|---|---|---|---|---|
| line | ok | I-04 |  | I-04 |  |
| rect-2pt | ok | I-04 |  | I-04 |  |
| rect-center | ok | I-04 |  | I-04 |  |
| rect-3pt | ok | I-04 | I-04 | I-04* |  |
| circle | ok | I-04 |  | I-04 |  |
| arc | ok | I-04 | I-04 | I-04 |  |
| polygon | ok | I-04 |  | I-04 |  |
| slot-c2c | ok | I-01 | I-01 | I-01 |  |
| slot-overall | ok | I-01 |  | I-01 |  |
| slot-center | ok | I-01 |  | I-01 |  |
| slot-arc3 | ok | I-01 |  | I-01 |  |
| slot-arccenter | ok | I-01 |  | I-01 |  |
| bezier | ok | I-04 | I-04 |  |  |
| text | ok |  |  | I-10 |  |
| trim | ok |  |  |  |  |
| break | ok |  |  |  |  |
| closePath | ok |  |  |  |  |
| fillet | ok | ok |  | ok |  |
| offset | ok | ok |  | ok |  |
| mirror | ok | ok |  |  | step 2: ok |
| circularPattern | ok | ok |  | ok |  |
| rectangularPattern | ok | I-13 |  | I-13 |  |
| select-drag |  |  |  |  | mid-drag: n/a |
| transform |  |  |  |  | handle drag: n/a; box typed: n/a |
| dim-edit |  |  |  |  | box typed: I-10 |
| dim | ok | ok |  | I-10 | placing: ok |
| coincident | ok | ok |  |  |  |
| hv | ok | ok |  |  |  |
| parallel | ok | ok |  |  |  |
| perp | ok | ok |  |  |  |
| collinear | ok | ok |  |  |  |
| tangent | ok | ok |  |  |  |
| equal | ok | ok |  |  |  |
| midpoint | ok | ok |  |  |  |
| symmetric | ok | ok | ok |  |  |

### Ctrl+Z

{'OK': 62, 'FRICTION': 10, 'DIVERGENCE': 14, 'N/A': 2, 'BUG': 1}

| tool | before 1st pick | after 1st pick | after 2nd pick | box open, text typed | other stage |
|---|---|---|---|---|---|
| line | ok | ok |  | I-14 |  |
| rect-2pt | ok | ok |  | I-14 |  |
| rect-center | ok | ok |  | I-14 |  |
| rect-3pt | ok | ok | ok | ok* |  |
| circle | ok | ok |  | I-14 |  |
| arc | ok | ok | ok | ok |  |
| polygon | ok | ok |  | I-14 |  |
| slot-c2c | ok | ok | ok | ok |  |
| slot-overall | ok | ok |  | I-14 |  |
| slot-center | ok | ok |  | I-14 |  |
| slot-arc3 | ok | ok |  | I-14 |  |
| slot-arccenter | ok | ok |  | I-14 |  |
| bezier | ok | ok | ok |  |  |
| text | ok |  |  | ok |  |
| trim | ok |  |  |  |  |
| break | ok |  |  |  |  |
| closePath | ok |  |  |  |  |
| fillet | ok | I-05 |  | ok |  |
| offset | ok | ok |  | ok |  |
| mirror | ok | I-05 |  |  | step 2: I-05 |
| circularPattern | ok | ok |  | ok |  |
| rectangularPattern | ok | ok |  | ok |  |
| select-drag |  |  |  |  | mid-drag: n/a |
| transform |  |  |  |  | handle drag: n/a; box typed: I-14 |
| dim-edit |  |  |  |  | box typed: ok |
| dim | ok | I-05 |  | ok | placing: I-06 |
| coincident | ok | I-05 |  |  |  |
| hv | ok | I-05 |  |  |  |
| parallel | ok | I-05 |  |  |  |
| perp | ok | I-05 |  |  |  |
| collinear | ok | I-05 |  |  |  |
| tangent | ok | I-05 |  |  |  |
| equal | ok | I-05 |  |  |  |
| midpoint | ok | I-05 |  |  |  |
| symmetric | ok | I-05 | I-05 |  |  |

### Ctrl+Y

{'OK': 69, 'BUG': 3, 'DIVERGENCE': 15, 'N/A': 2}

| tool | before 1st pick | after 1st pick | after 2nd pick | box open, text typed | other stage |
|---|---|---|---|---|---|
| line | ok | ok |  | ok |  |
| rect-2pt | ok | ok |  | ok |  |
| rect-center | ok | ok |  | ok |  |
| rect-3pt | ok | I-15 | I-15 | ok* |  |
| circle | ok | ok |  | ok |  |
| arc | ok | ok | ok | ok |  |
| polygon | ok | ok |  | ok |  |
| slot-c2c | ok | ok | ok | ok |  |
| slot-overall | ok | ok |  | ok |  |
| slot-center | ok | ok |  | ok |  |
| slot-arc3 | ok | ok |  | ok |  |
| slot-arccenter | ok | ok |  | ok |  |
| bezier | ok | I-15 | I-05 |  |  |
| text | ok |  |  | ok |  |
| trim | ok |  |  |  |  |
| break | ok |  |  |  |  |
| closePath | ok |  |  |  |  |
| fillet | ok | I-05 |  | ok |  |
| offset | ok | ok |  | ok |  |
| mirror | ok | I-05 |  |  | step 2: I-05 |
| circularPattern | ok | ok |  | ok |  |
| rectangularPattern | ok | ok |  | ok |  |
| select-drag |  |  |  |  | mid-drag: n/a |
| transform |  |  |  |  | handle drag: n/a; box typed: ok |
| dim-edit |  |  |  |  | box typed: ok |
| dim | ok | I-05 |  | ok | placing: ok |
| coincident | ok | I-05 |  |  |  |
| hv | ok | I-05 |  |  |  |
| parallel | ok | I-05 |  |  |  |
| perp | ok | I-05 |  |  |  |
| collinear | ok | I-05 |  |  |  |
| tangent | ok | I-05 |  |  |  |
| equal | ok | I-05 |  |  |  |
| midpoint | ok | I-05 |  |  |  |
| symmetric | ok | I-05 | I-05 |  |  |

### Delete

{'OK': 74, 'FRICTION': 1, 'DIVERGENCE': 12, 'N/A': 2}

| tool | before 1st pick | after 1st pick | after 2nd pick | box open, text typed | other stage |
|---|---|---|---|---|---|
| line | ok | ok |  | ok |  |
| rect-2pt | ok | ok |  | ok |  |
| rect-center | ok | ok |  | ok |  |
| rect-3pt | ok | ok | ok | I-20* |  |
| circle | ok | ok |  | ok |  |
| arc | ok | ok | ok | ok |  |
| polygon | ok | ok |  | ok |  |
| slot-c2c | ok | ok | ok | ok |  |
| slot-overall | ok | ok |  | ok |  |
| slot-center | ok | ok |  | ok |  |
| slot-arc3 | ok | ok |  | ok |  |
| slot-arccenter | ok | ok |  | ok |  |
| bezier | ok | ok | ok |  |  |
| text | ok |  |  | ok |  |
| trim | ok |  |  |  |  |
| break | ok |  |  |  |  |
| closePath | ok |  |  |  |  |
| fillet | ok | ok |  | ok |  |
| offset | ok | ok |  | ok |  |
| mirror | ok | I-16 |  |  | step 2: I-16 |
| circularPattern | ok | ok |  | ok |  |
| rectangularPattern | ok | ok |  | ok |  |
| select-drag |  |  |  |  | mid-drag: n/a |
| transform |  |  |  |  | handle drag: n/a; box typed: ok |
| dim-edit |  |  |  |  | box typed: ok |
| dim | ok | ok |  | ok | placing: ok |
| coincident | ok | I-16 |  |  |  |
| hv | ok | I-16 |  |  |  |
| parallel | ok | I-16 |  |  |  |
| perp | ok | I-16 |  |  |  |
| collinear | ok | I-16 |  |  |  |
| tangent | ok | I-16 |  |  |  |
| equal | ok | I-16 |  |  |  |
| midpoint | ok | I-16 |  |  |  |
| symmetric | ok | I-16 | I-16 |  |  |

### Right-click on empty canvas

{'BUG': 31, 'OK': 51, 'DIVERGENCE': 3, 'N/A': 2, 'FRICTION': 2}

| tool | before 1st pick | after 1st pick | after 2nd pick | box open, text typed | other stage |
|---|---|---|---|---|---|
| line | I-17 | I-17 |  | I-17 |  |
| rect-2pt | I-17 | I-17 |  | I-17 |  |
| rect-center | I-17 | I-17 |  | I-17 |  |
| rect-3pt | I-17 | I-17 | I-17 | ok* |  |
| circle | I-17 | I-17 |  | I-17 |  |
| arc | I-17 | I-17 | I-17 | I-17 |  |
| polygon | I-17 | I-17 |  | I-17 |  |
| slot-c2c | I-17 | ok | I-17 | ok |  |
| slot-overall | I-17 | ok |  | ok |  |
| slot-center | I-17 | ok |  | ok |  |
| slot-arc3 | I-17 | ok |  | ok |  |
| slot-arccenter | I-17 | ok |  | ok |  |
| bezier | I-17 | I-17 | I-17 |  |  |
| text | ok |  |  | I-10 |  |
| trim | ok |  |  |  |  |
| break | ok |  |  |  |  |
| closePath | ok |  |  |  |  |
| fillet | ok | ok |  | ok |  |
| offset | ok | ok |  | ok |  |
| mirror | ok | ok |  |  | step 2: ok |
| circularPattern | ok | ok |  | ok |  |
| rectangularPattern | ok | ok |  | ok |  |
| select-drag |  |  |  |  | mid-drag: n/a |
| transform |  |  |  |  | handle drag: n/a; box typed: ok |
| dim-edit |  |  |  |  | box typed: I-10 |
| dim | ok | I-18 |  | I-10 | placing: I-18 |
| coincident | ok | ok |  |  |  |
| hv | ok | ok |  |  |  |
| parallel | ok | ok |  |  |  |
| perp | ok | ok |  |  |  |
| collinear | ok | ok |  |  |  |
| tangent | ok | ok |  |  |  |
| equal | ok | ok |  |  |  |
| midpoint | ok | ok |  |  |  |
| symmetric | ok | ok | ok |  |  |

### Wheel zoom

{'OK': 89}

| tool | before 1st pick | after 1st pick | after 2nd pick | box open, text typed | other stage |
|---|---|---|---|---|---|
| line | ok | ok |  | ok |  |
| rect-2pt | ok | ok |  | ok |  |
| rect-center | ok | ok |  | ok |  |
| rect-3pt | ok | ok | ok | ok* |  |
| circle | ok | ok |  | ok |  |
| arc | ok | ok | ok | ok |  |
| polygon | ok | ok |  | ok |  |
| slot-c2c | ok | ok | ok | ok |  |
| slot-overall | ok | ok |  | ok |  |
| slot-center | ok | ok |  | ok |  |
| slot-arc3 | ok | ok |  | ok |  |
| slot-arccenter | ok | ok |  | ok |  |
| bezier | ok | ok | ok |  |  |
| text | ok |  |  | ok |  |
| trim | ok |  |  |  |  |
| break | ok |  |  |  |  |
| closePath | ok |  |  |  |  |
| fillet | ok | ok |  | ok |  |
| offset | ok | ok |  | ok |  |
| mirror | ok | ok |  |  | step 2: ok |
| circularPattern | ok | ok |  | ok |  |
| rectangularPattern | ok | ok |  | ok |  |
| select-drag |  |  |  |  | mid-drag: ok |
| transform |  |  |  |  | handle drag: ok; box typed: ok |
| dim-edit |  |  |  |  | box typed: ok |
| dim | ok | ok |  | ok | placing: ok |
| coincident | ok | ok |  |  |  |
| hv | ok | ok |  |  |  |
| parallel | ok | ok |  |  |  |
| perp | ok | ok |  |  |  |
| collinear | ok | ok |  |  |  |
| tangent | ok | ok |  |  |  |
| equal | ok | ok |  |  |  |
| midpoint | ok | ok |  |  |  |
| symmetric | ok | ok | ok |  |  |

### Middle-drag pan

{'OK': 55, 'FRICTION': 31, 'DIVERGENCE': 1, 'N/A': 2}

| tool | before 1st pick | after 1st pick | after 2nd pick | box open, text typed | other stage |
|---|---|---|---|---|---|
| line | ok | I-19 |  | I-19 |  |
| rect-2pt | ok | I-19 |  | I-19 |  |
| rect-center | ok | I-19 |  | I-19 |  |
| rect-3pt | ok | ok | ok | I-19* |  |
| circle | ok | I-19 |  | I-19 |  |
| arc | ok | I-19 | I-19 | I-19 |  |
| polygon | ok | I-19 |  | I-19 |  |
| slot-c2c | ok | I-19 | I-19 | I-19 |  |
| slot-overall | ok | I-19 |  | I-19 |  |
| slot-center | ok | I-19 |  | I-19 |  |
| slot-arc3 | ok | I-19 |  | I-19 |  |
| slot-arccenter | ok | I-19 |  | I-19 |  |
| bezier | ok | ok | ok |  |  |
| text | ok |  |  | I-10 |  |
| trim | ok |  |  |  |  |
| break | ok |  |  |  |  |
| closePath | ok |  |  |  |  |
| fillet | ok | ok |  | I-19 |  |
| offset | ok | ok |  | I-19 |  |
| mirror | ok | ok |  |  | step 2: ok |
| circularPattern | ok | ok |  | I-19 |  |
| rectangularPattern | ok | ok |  | I-19 |  |
| select-drag |  |  |  |  | mid-drag: n/a |
| transform |  |  |  |  | handle drag: n/a; box typed: ok |
| dim-edit |  |  |  |  | box typed: I-19 |
| dim | ok | ok |  | I-19 | placing: ok |
| coincident | ok | ok |  |  |  |
| hv | ok | ok |  |  |  |
| parallel | ok | ok |  |  |  |
| perp | ok | ok |  |  |  |
| collinear | ok | ok |  |  |  |
| tangent | ok | ok |  |  |  |
| equal | ok | ok |  |  |  |
| midpoint | ok | ok |  |  |  |
| symmetric | ok | ok | ok |  |  |

### Click the footer bar

{'OK': 58, 'FRICTION': 26, 'DIVERGENCE': 3, 'N/A': 2}

| tool | before 1st pick | after 1st pick | after 2nd pick | box open, text typed | other stage |
|---|---|---|---|---|---|
| line | ok | ok |  | I-19 |  |
| rect-2pt | ok | ok |  | I-19 |  |
| rect-center | ok | ok |  | I-19 |  |
| rect-3pt | ok | ok | ok | I-19* |  |
| circle | ok | I-19 |  | I-19 |  |
| arc | ok | I-19 | I-19 | I-19 |  |
| polygon | ok | ok |  | I-19 |  |
| slot-c2c | ok | I-19 | I-19 | I-19 |  |
| slot-overall | ok | I-19 |  | I-19 |  |
| slot-center | ok | I-19 |  | I-19 |  |
| slot-arc3 | ok | I-19 |  | I-19 |  |
| slot-arccenter | ok | I-19 |  | I-19 |  |
| bezier | ok | ok | ok |  |  |
| text | ok |  |  | I-10 |  |
| trim | ok |  |  |  |  |
| break | ok |  |  |  |  |
| closePath | ok |  |  |  |  |
| fillet | ok | ok |  | I-19 |  |
| offset | ok | ok |  | I-19 |  |
| mirror | ok | ok |  |  | step 2: ok |
| circularPattern | ok | ok |  | I-19 |  |
| rectangularPattern | ok | ok |  | I-19 |  |
| select-drag |  |  |  |  | mid-drag: n/a |
| transform |  |  |  |  | handle drag: n/a; box typed: ok |
| dim-edit |  |  |  |  | box typed: I-10 |
| dim | ok | ok |  | I-10 | placing: I-18 |
| coincident | ok | ok |  |  |  |
| hv | ok | ok |  |  |  |
| parallel | ok | ok |  |  |  |
| perp | ok | ok |  |  |  |
| collinear | ok | ok |  |  |  |
| tangent | ok | ok |  |  |  |
| equal | ok | ok |  |  |  |
| midpoint | ok | ok |  |  |  |
| symmetric | ok | ok | ok |  |  |

### Click the Sketches browser panel

{'OK': 57, 'FRICTION': 27, 'DIVERGENCE': 3, 'N/A': 2}

| tool | before 1st pick | after 1st pick | after 2nd pick | box open, text typed | other stage |
|---|---|---|---|---|---|
| line | ok | ok |  | I-19 |  |
| rect-2pt | ok | ok |  | I-19 |  |
| rect-center | ok | I-19 |  | I-19 |  |
| rect-3pt | ok | ok | ok | I-19* |  |
| circle | ok | I-19 |  | I-19 |  |
| arc | ok | I-19 | I-19 | I-19 |  |
| polygon | ok | ok |  | I-19 |  |
| slot-c2c | ok | I-19 | I-19 | I-19 |  |
| slot-overall | ok | I-19 |  | I-19 |  |
| slot-center | ok | I-19 |  | I-19 |  |
| slot-arc3 | ok | I-19 |  | I-19 |  |
| slot-arccenter | ok | I-19 |  | I-19 |  |
| bezier | ok | ok | ok |  |  |
| text | ok |  |  | I-10 |  |
| trim | ok |  |  |  |  |
| break | ok |  |  |  |  |
| closePath | ok |  |  |  |  |
| fillet | ok | ok |  | I-19 |  |
| offset | ok | ok |  | I-19 |  |
| mirror | ok | ok |  |  | step 2: ok |
| circularPattern | ok | ok |  | I-19 |  |
| rectangularPattern | ok | ok |  | I-19 |  |
| select-drag |  |  |  |  | mid-drag: n/a |
| transform |  |  |  |  | handle drag: n/a; box typed: ok |
| dim-edit |  |  |  |  | box typed: I-10 |
| dim | ok | ok |  | I-10 | placing: I-18 |
| coincident | ok | ok |  |  |  |
| hv | ok | ok |  |  |  |
| parallel | ok | ok |  |  |  |
| perp | ok | ok |  |  |  |
| collinear | ok | ok |  |  |  |
| tangent | ok | ok |  |  |  |
| equal | ok | ok |  |  |  |
| midpoint | ok | ok |  |  |  |
| symmetric | ok | ok | ok |  |  |

### Open the Parameters window, click it, close it

{'OK': 57, 'FRICTION': 28, 'DIVERGENCE': 2, 'N/A': 2}

| tool | before 1st pick | after 1st pick | after 2nd pick | box open, text typed | other stage |
|---|---|---|---|---|---|
| line | ok | ok |  | I-19 |  |
| rect-2pt | ok | ok |  | I-19 |  |
| rect-center | ok | I-19 |  | I-19 |  |
| rect-3pt | ok | ok | ok | I-19* |  |
| circle | ok | I-19 |  | I-19 |  |
| arc | ok | I-19 | I-19 | I-19 |  |
| polygon | ok | ok |  | I-19 |  |
| slot-c2c | ok | I-19 | I-19 | I-19 |  |
| slot-overall | ok | I-19 |  | I-19 |  |
| slot-center | ok | I-19 |  | I-19 |  |
| slot-arc3 | ok | I-19 |  | I-19 |  |
| slot-arccenter | ok | I-19 |  | I-19 |  |
| bezier | ok | ok | ok |  |  |
| text | ok |  |  | I-10 |  |
| trim | ok |  |  |  |  |
| break | ok |  |  |  |  |
| closePath | ok |  |  |  |  |
| fillet | ok | ok |  | I-19 |  |
| offset | ok | ok |  | I-19 |  |
| mirror | ok | ok |  |  | step 2: ok |
| circularPattern | ok | ok |  | I-19 |  |
| rectangularPattern | ok | ok |  | I-19 |  |
| select-drag |  |  |  |  | mid-drag: n/a |
| transform |  |  |  |  | handle drag: n/a; box typed: ok |
| dim-edit |  |  |  |  | box typed: I-19 |
| dim | ok | ok |  | I-10 | placing: I-18 |
| coincident | ok | ok |  |  |  |
| hv | ok | ok |  |  |  |
| parallel | ok | ok |  |  |  |
| perp | ok | ok |  |  |  |
| collinear | ok | ok |  |  |  |
| tangent | ok | ok |  |  |  |
| equal | ok | ok |  |  |  |
| midpoint | ok | ok |  |  |  |
| symmetric | ok | ok | ok |  |  |

### Open the sidebar, click outside

{'OK': 9, 'FRICTION': 3, 'N/A': 77}

| tool | before 1st pick | after 1st pick | after 2nd pick | box open, text typed | other stage |
|---|---|---|---|---|---|
| line | ok | ok |  | I-19 |  |
| rect-2pt | ok | ok |  | I-19 |  |
| rect-center | ok | ok |  | I-19 |  |
| rect-3pt | ok | ok | ok | n/a |  |
| circle | n/a | n/a |  | n/a |  |
| arc | n/a | n/a | n/a | n/a |  |
| polygon | n/a | n/a |  | n/a |  |
| slot-c2c | n/a | n/a | n/a | n/a |  |
| slot-overall | n/a | n/a |  | n/a |  |
| slot-center | n/a | n/a |  | n/a |  |
| slot-arc3 | n/a | n/a |  | n/a |  |
| slot-arccenter | n/a | n/a |  | n/a |  |
| bezier | n/a | n/a | n/a |  |  |
| text | n/a |  |  | n/a |  |
| trim | n/a |  |  |  |  |
| break | n/a |  |  |  |  |
| closePath | n/a |  |  |  |  |
| fillet | n/a | n/a |  | n/a |  |
| offset | n/a | n/a |  | n/a |  |
| mirror | n/a | n/a |  |  | step 2: n/a |
| circularPattern | n/a | n/a |  | n/a |  |
| rectangularPattern | n/a | n/a |  | n/a |  |
| select-drag |  |  |  |  | mid-drag: n/a |
| transform |  |  |  |  | handle drag: n/a; box typed: n/a |
| dim-edit |  |  |  |  | box typed: n/a |
| dim | n/a | n/a |  | n/a | placing: n/a |
| coincident | n/a | n/a |  |  |  |
| hv | n/a | n/a |  |  |  |
| parallel | n/a | n/a |  |  |  |
| perp | n/a | n/a |  |  |  |
| collinear | n/a | n/a |  |  |  |
| tangent | n/a | n/a |  |  |  |
| equal | n/a | n/a |  |  |  |
| midpoint | n/a | n/a |  |  |  |
| symmetric | n/a | n/a | n/a |  |  |

### Window blur / focus (synthetic events)

{'OK': 87, 'N/A': 2}

| tool | before 1st pick | after 1st pick | after 2nd pick | box open, text typed | other stage |
|---|---|---|---|---|---|
| line | ok | ok |  | ok |  |
| rect-2pt | ok | ok |  | ok |  |
| rect-center | ok | ok |  | ok |  |
| rect-3pt | ok | ok | ok | ok* |  |
| circle | ok | ok |  | ok |  |
| arc | ok | ok | ok | ok |  |
| polygon | ok | ok |  | ok |  |
| slot-c2c | ok | ok | ok | ok |  |
| slot-overall | ok | ok |  | ok |  |
| slot-center | ok | ok |  | ok |  |
| slot-arc3 | ok | ok |  | ok |  |
| slot-arccenter | ok | ok |  | ok |  |
| bezier | ok | ok | ok |  |  |
| text | ok |  |  | ok |  |
| trim | ok |  |  |  |  |
| break | ok |  |  |  |  |
| closePath | ok |  |  |  |  |
| fillet | ok | ok |  | ok |  |
| offset | ok | ok |  | ok |  |
| mirror | ok | ok |  |  | step 2: ok |
| circularPattern | ok | ok |  | ok |  |
| rectangularPattern | ok | ok |  | ok |  |
| select-drag |  |  |  |  | mid-drag: n/a |
| transform |  |  |  |  | handle drag: n/a; box typed: ok |
| dim-edit |  |  |  |  | box typed: ok |
| dim | ok | ok |  | ok | placing: ok |
| coincident | ok | ok |  |  |  |
| hv | ok | ok |  |  |  |
| parallel | ok | ok |  |  |  |
| perp | ok | ok |  |  |  |
| collinear | ok | ok |  |  |  |
| tangent | ok | ok |  |  |  |
| equal | ok | ok |  |  |  |
| midpoint | ok | ok |  |  |  |
| symmetric | ok | ok | ok |  |  |

## 5. Phone, 390x844, real touch events

A click in the kit is a finger tap (touchStart + touchEnd). View `cx 20, cy 0, vw 150` so the fixture fits the screen. Tools tested: Line (before and after 1st), Rect, Circle, Arc, Polygon, Slot, Bezier, Trim, Fillet, Offset, Mirror, Dimension, Coincident, Parallel. The phone has no Esc key and no Ctrl+Z: its "Esc / Undo / Done" are the footer Undo button and the Done check. Right-click is a long press.

| interruption | line/befor | line/after | rect-2pt/after | circle/after | arc/after | polygon/after | slot-c2c/after | bezier/after | trim/befor | fillet/after | offset/after | mirror/after | dim/after | coincident/after | parallel/after |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| tap other tool (ribbon) | ok | I-03 | I-03 | I-03 | I-03 | I-03 | I-01 | I-03 | ok | ok | ok | ok | ok | ok | ok |
| tap same tool (ribbon) | ok | I-04 | I-04 | I-04 | I-04 | I-04 | I-01 | I-04 | ok | ok | ok | ok | ok | ok | ok |
| pinch zoom (2 fingers) | ok | I-21 | I-21 | I-21 | ok | I-21 | ok | I-21 | I-21 | ok | ok | ok | I-21 | I-21 | ok |
| two-finger pan | I-21 | I-21 | I-21 | I-21 | ok | I-21 | ok | I-21 | I-21 | ok | ok | ok | I-21 | I-21 | ok |
| long-press on canvas (750 ms) | I-23 | I-23 | I-23 | I-23 | ok | I-23 | ok | I-23 | ok | ok | ok | ok | ok | ok | ok |
| tap footer blank | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| tap Done button | n/a | ok | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | ok | ok | n/a | n/a | n/a |
| tap Undo button | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| window blur/focus (synthetic) | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |

Phone findings: I-21 (pinch / pan makes geometry), I-23 (long press is a click), the same I-01 / I-03 / I-04 as the desktop. `tap Done button`: the Done check is only shown for Offset / Mirror / Fillet-type chains; for the draw tools there was none (n/a). Pinch zoom itself keeps the view change and the tool (view `w 150 -> ~50`).

## 6. Follow-up rows (desktop)

| row | what | result |
|---|---|---|
| F1-trim / break / fillet / offset / parallel / coincident | right-click ON geometry with that tool | no geometry change; Coincident selects the joint (`J:1`); no context menu (OK) |
| F1-select | control: right-click on a line in Select | context menu opens (OK) |
| F2-line / circle / rect | half-made draw, Ctrl+Z, then Ctrl+Y | draw cancelled, tool left, Redo empty: nothing comes back (BUG I-03: the Redo stack was already wiped by the 1st click) |
| F2-dim | Dimension placing, Ctrl+Z, Ctrl+Y | `cons 2->1` after Z with `placing=true`, `cons 2` again after Y: BUG I-06 |
| F3-dimedit | double-click a dimension label (box position looked up in the DOM) | the edit box `#dimInput` opens (the first kit missed the label; the dim-edit cells of parts 1-3 are void and were re-run in part 5, `p5.log`) |
| F4-esc2 | Line, 1 click, Esc, Esc | the second Esc changes nothing (OK) but Redo was wiped by the first click (I-03) |
| F5 x7 | burger opened (checked in the DOM) with Line / Rect / Circle box typed / Fillet / Coincident / Dimension placing / Offset box typed active, then a click outside | sidebar opens and closes, tool, box, pick and counts unchanged (OK x7) |

## 7. Probe limits and voided runs

- **Void and re-run**: (a) the first kit picked the ORIGIN, not the line, for Parallel / Perpendicular / Collinear / Equal / Midpoint (`L5_MID` was inside the origin's snap range): their cells in parts 1-3 and 6 are replaced by part 8 (`p8.log`, `K-*` rows). (b) the dimension EDIT box did not open in parts 1-3: replaced by part 5 (`p5.log`, `E5-*`). (c) the Sketches-browser click of part 3 used fixed coordinates that sometimes hit the canvas: replaced by part 9 (`p9b.log`, DOM-checked target, `P9B` rows). (d) the sidebar run opened the sidebar in only 12 of 87 cells (`p9s.log`): after the typed 3-point rectangle box the page was scrolled (I-22) and the burger was off-screen; only those 12 cells plus the 7 follow-ups F5 are used, the other sidebar cells are `n/a`.
- The 3-point rectangle width box (`#live-dim-width`) is not in the probe's "open box" list; its cells use the focus field instead.
- Window blur / focus: headless Chrome never reports a real blur; the events are synthetic (page-level `blur`, `visibilitychange`, `focus`). Everything else uses real CDP input events.
- A "Done" check exists only for a few tools; the phone probe taps it when it is on screen.
- The Parameters window cell opens it with the footer fx button, clicks its title and closes it again.
- Fusion 360 was not driven in this task: every expectation other than "ONE Esc" is marked (unverified).
- `p1.log` (Esc, switch, re-click) ran before the kit fixes (a)-(c); its re-click section `REK-*` is superseded by `p6.log` (`RCC-*`, with the completion probe); its `GEOM_DELTA` notes on Dimension rows compare with the stage start, not the base, and are not used.

## 8. Evidence

Local, not committed (`.evidence/` is untracked): `.evidence/1023/`.

| file | md5 |
|---|---|
| `slot-box-typed-before-switch.png` | `d4008d310ac48be5db5cfbcc84b607f1` |
| `slot-box-zombie-after-switch-to-circle.png` | `93b4b8c9bef487b8b85991ed9f1bf81b` |
| `transform-box-zombie-after-switch-to-circle.png` | `cea4cfdbeefd0625f56220fc3d0f0554` |
| `p1.log` | `a1dd592202491c4f432eefe20078531e` |
| `p2.log` | `a04a168e4a94fad68fad2535cc35528d` |
| `p3.log` | `93965490afed4e7e59f20f5187a5cbb5` |
| `p4d.log` | `be1ae6fd9f908db1bae4b1974166b3a2` |
| `p4p.log` | `19a12b8fa5dd9340436c7abf49928139` |
| `p5.log` | `9edaeec4476247f40f635423a50e32b6` |
| `p6.log` | `02584689db4fa2fa1062f9c5130e3309` |
| `p7.log` | `075dc9ee7db973a7544de2eaa5dd116a` |
| `p8.log` | `5fcd3e49a108716e5a8a981ba4052940` |
| `p9b.log` | `5ade3e19aad9fd3b9f6bc59f2d1fbd1f` |
| `p9s.log` | `72f13340b808203c03b1473e69e1f8e3` |

Screenshots: the slot box "22" left on the canvas with the Circle tool active (before and after the switch), and the transform box "30" left after the same switch.

Probe files (`tests/audits/`): `interrupts-audit-1023-kit.js` (host, real input helpers, fixture, `inspect`, `enterStage`), `-matrix.js` (tool x stage list, generic cell runner, completion probe), `-esc-switch.mjs` (part 1: Esc, ribbon switch, key switch, re-click), `-part2.mjs` (Ctrl+Z, Ctrl+Y, Delete, right-click), `-part3.mjs` (wheel, pan, panels, blur), `-part4.mjs` (`desk`: follow-ups F1-F5; `phone`), `-part5.mjs` (dimension edit box), `-part6.mjs` (re-click + completion), `-part7.mjs` (control), `-part8.mjs` (line-pair constraints re-run), `-part9.mjs` (sidebar), `-evidence.mjs` (screenshots). Run one with `node tests/audits/interrupts-audit-1023-part2.mjs > .evidence/1023/p2.log`.
