# Snap / pick constraint audit (task 869)

Owner turn 3382: "these bugs are from a certain family, can you sniff out more". This is an AUDIT: nothing in the app was changed.

**The family.** A snap or a pick is DETECTED but its constraint is never APPLIED, or a tool ends without doing what its picks asked
and without telling the user. The owner's report (2026-11-23) showed two members, both being fixed elsewhere:

- task 867: the Rectangle tool receives the snap of its FIRST corner but applies a snap constraint only to the opposite corner;
- task 868: the Coincident tool, picks = a point then a line, goes back to Select with no constraint and no message.

## How it was measured

`tests/snap-constraint-audit-869-live.test.js` (an audit tool: it prints one line per cell and exits 0 whatever the cells say;
`AUDIT_869_ONLY=<regexp>` narrows it, `AUDIT_869_EVIDENCE=<dir>` saves the screenshots and the rows as JSON). The cells are in
`tests/snap-constraint-audit-869-cells.js`.

- The real SketchStudio page, headless, desktop 1600 x 900, real mouse and keys through CDP (no app state is touched: the design is
  read back from the project store after the autosave, as the other SketchStudio live tests do). Grid magnet off, as in
  `tests/drag-target-release-live.test.js`, so a free click lands where it is.
- The fixture is drawn with the real tools at a user's scale (3.36 px per mm, set with the wheel): a line, a circle, an arc, a
  construction line, a 2-point rectangle and its Offset (an offset-made inner loop), a slanted line, plus a line and a rectangle to drag.
- Every click on a target is 4 px OFF it (inside the 10 px snap magnet), as a hand never hits the pixel. So a point that lands on the
  target was SNAPPED, and a point 4 px away was not.
- The other clicks of a tool are placed at least 45 px from every piece of the fixture and the axes, and never on a panel over the canvas
  (the floating Sketches card: a first run put one click there and the rectangle never got it; the runner now asks the page what a press
  hits). Before every press the runner also waits until nothing covers that point: a notice (toast) with its Copy button takes a press
  under it (a first run lost the Equal tool's second pick under a "Perpendicular rejected" notice left by an earlier cell).
- Between cells the design goes back to the fixture (Esc, then Undo; the runner reloads the fixture if Undo did not restore it exactly:
  it never had to).
- The node kit (`tests/helpers/node-app.js`, the same input path in happy-dom) was used to iterate (an untracked driver, not committed);
  it gave the same status as the live page in EVERY cell. Its notices need the page script's notifier (`apps/sketchstudio/main.js:66`
  `setConstraintNotifier(showNotification)`), which the kit does not run: the driver wired it as the page does.

Cell results: **PASS**; **FAIL-NOSNAP** (no snap marker on hover); **FAIL-OFFTARGET d** (the placed point is d px off the target: the snap
position was dropped); **FAIL-NOCONSTRAINT** (on the target, but nothing holds it there); **FAIL-SILENT** (the tool made nothing and said
nothing). For a click that sets a CURVE through the target (a circle's rim, a 3-point arc slot's arc point) no point of the new shape is
placed there: on a line, curve or axis only the position is expected (as in Fusion: no constraint); on a point, a point-on-curve is
expected. Constraint cells: **PASS**; **REFUSED-TOLD** (nothing made, a notice says why); **PASS-TOLD** (a pair that is not valid, and the
user is told); **FAIL-SILENT**.

**Totals (live, after merging origin/main at 2a0c106d): 424 cells, 322 PASS, 102 not.** Drawing 341 cells (31 tool points x 11
targets): 262 PASS, 38 FAIL-NOCONSTRAINT, 19 FAIL-OFFTARGET, 22 FAIL-NOSNAP. Constraint tools 61 pick sets: 38 PASS, 3 REFUSED-TOLD,
20 FAIL-SILENT. Select drags 22: 22 PASS. One run of the whole file takes 10 - 12 minutes (1.4 - 1.7 s a cell, with other seats' tests running on the PC).

## Failing cells, grouped by cause (one row per cause)

| # | cause (file:line) | cells | covered by |
|---|---|---|---|
| A | `packages/ui/input-handlers/rect-tool.js:174-175` stores the first click's snap in `state.active.startSnapTarget`; nothing ever reads it (`grep startSnapTarget rect-tool.js` = line 175 only). `handleRectPointerUp` applies a snap only to the LAST click (`:235`, `:250`, `:265`). The first corner on a point still ends coincident (the corner loop `findNearbyJoint` 0.01 mm, `:244`/`:259`/`:274`), on a line / curve / axis it is on the target with no constraint. | 2-point corner 1, 3-point point 1 x 8 targets (line mid-span, midpoint, arc edge, circle edge, construction line, offset-made line, X axis, Y axis); centre rectangle CENTRE x all 11 targets (the centre is no corner, so even the point targets get nothing) = **27** | **867** (the owner's report: 2-point corner 1 on an offset-made line). 867 must cover the centre mode's centre and the 3-point mode's first point too. |
| B | `rect-tool.js:232`: the 3-point rectangle's SECOND click stores only the joint (`state.active.secondPt = endId`); its snap is never kept, so it is never applied (`:235` applies the third click's). | 3-point point 2 x 8 targets (same as A) = **8** | not covered (same file as 867: worth adding to 867) |
| C | `packages/ui/input-handlers/circle-tool.js:99-105`: the second click throws away the click's snap (`hitSnap`, locked by `packages/ui/input-manager.js:600-605`) and asks `findSnap` again; `findSnap` (`packages/ui/snap-detection.js:62`/`:114`) returns no `isLocked`, so `snapForEnd.isLocked` is always false: the radius goes to the raw pointer. No snap constraint is made for the rim at all (only the centre's, `:124-126`). | circle RIM x 8 targets: OFFTARGET 2.8 - 4 px; on a joint, the origin and a circle centre also no point-on-circle = **8** (the 3 other rim cells, mid-span / circle edge / construction line, pass only because the 4 px offset ran along the new rim there: the snap is dropped for every rim click) | not covered |
| D | `packages/ui/input-handlers/polygon-tool.js:118-122`: the same re-query as C (`findSnap` has no `isLocked`): the vertex goes to the raw pointer; `createPolygon` applies only the centre's snap (`:148`). | polygon VERTEX x all 11 targets: OFFTARGET 4 px, no constraint = **11** | not covered |
| E | `packages/ui/input-handlers/slot-tool.js:278` (and `:244`): the joint reuse / binding tests `snap.jointId`, a field no snap has (the input manager names the point `targetId` / `id`, `input-manager.js:521-525`), so the 3-point arc slot's arc point is never bound to a point (`bindThirdJoint` stays false, `packages/core/slot.js:369-370`); and in that mode the third pick's snap is never queued (`slot-tool.js:283-284` queue only picks 1 and 2). | 3-point arc slot ARC POINT x joint, circle centre, origin (on the target, no constraint) = **3** | not covered |
| F | `packages/ui/input-handlers/constraint-tools.js:130-134`: the Coincident tool knows joint + joint and joint + a built-in axis only; a real line, arc or circle as either pick returns false, and `input-manager.js:758-762` ("EXIT ON INVALID CLICK") switches to Select with no notice. A line / curve as the FIRST pick ends the tool at once. | coincident point + line, line + point, rectangle corner + offset-made line (both orders), point + construction line, point + arc (both orders), point + circle (both orders) = **9** | **868** (point then line). 868 must cover both orders, arcs, circles, construction and offset-made lines. |
| G | `constraint-tools.js:69`: the H / V tool refuses a LINE pick whenever `state.pendingConstraint` exists, but entering ANY constraint tool always sets it, `{ type, firstElement: null }` when nothing is pre-selected (SketchStudio's ribbon path `apps/sketchstudio/ui/ui-manager.js:97`; the shared `switchToTool`, keys and the other hosts, `packages/ui/input-manager.js:1589`): a click on a line can never be made horizontal / vertical (only a pre-selected line works, `ui-manager.js:64-70` / `input-manager.js:1578-1586`); the tool goes back to Select silently (`input-manager.js:758-762`). | hv on a slanted line, hv on a line = **2** (every H / V click on a line) | not covered |
| H | `constraint-tools.js:291` (Midpoint: only a line is a shape pick) and `input-manager.js:758-762`: a point + an ARC (Fusion makes a midpoint on an arc) ends the tool silently, in both orders. | midpoint point + arc, arc + point = **2** | not covered |
| I | Invalid pairs: the handlers return false or only `console.warn`, so the user is never told why: `constraint-tools.js:113` (parallel / perpendicular with an arc or circle: warn + silent Select), `:134` (coincident line + line), `:69` (H / V point then line), `:343` (symmetric point + line), `:246` (tangent line + line: warn, the tool stays, nothing made), `:391` (equal line + circle: warn, tool stays). | 7 invalid-pair cells, all FAIL-SILENT | not covered (owner's call: a notice for an invalid pick) |
| J | `packages/ui/input-handlers/bezier-tool.js:12-14` and `:105-113`: the Bezier pen snaps only to its own first anchor (TASK 762, declared: "Anchors land at the raw world point"); every other snap is hidden and dropped. | Bezier anchor 1, anchor 2 x all 11 targets: FAIL-NOSNAP, 4 px off = **22** | a DECLARED behaviour (task 762), listed for the owner (a divergence from Fusion if Fusion's spline points snap: not checked in Fusion here). |

What passes, for reference: the Line tool (the reference: every click x every target), the Arc tool (centre / start / end), the circle's
CENTRE, the polygon's CENTRE, the rectangle's last click (2-point corner 2, centre-mode corner, 3-point point 3), every slot point except
the 3-point arc point on a point, the Text anchor, and every Select-tool drag of a free line end or a rectangle corner onto every target.
The constraint tools pass for: coincident point + point / origin / axis (both orders), rectangle corner + point; midpoint point + line
(both orders); tangent line / offset-made line + circle / arc, arc + circle; parallel and perpendicular between lines, construction lines,
offset-made lines and the X axis; equal; collinear; H / V two points; symmetric. Perpendicular / midpoint picks that contradict the
sketch are REFUSED-TOLD (the constraint manager's "rejected — creates a conflict" notice).

Not in this family, seen on the way: the Rectangle's 8 "Duplicate coincident constraint rejected" (each corner pair's coincident is
made by `makeRect…` and again by the corner loop, `rect-tool.js:244`/`:259`/`:274`): in 867's report already.

## Representative failures (screenshots)

Saved by `AUDIT_869_EVIDENCE=.evidence/869/final3` (local evidence, not committed), 3x zoom, 340 x 220 px around the target:

- `circle-rim-on-joint.png` (cause C): the Circle tool, rim clicked 4 px off a line's end point. The snap ring shows on the point, but the
  new circle's rim passes beside it (its radius went to the raw pointer) and no point-on-circle holds it.
- `polygon-vertex-on-line.png` (cause D): the Polygon tool, vertex clicked 4 px off a line (the snap diamond on the line). The hexagon's
  right vertex sits below the line, not on it, with no point-on-line.
- `hv-tool-on-slanted-line.png` (cause G): the H / V tool, one click on a slanted line. The line stays slanted, no H / V glyph; the
  tool is back to Select (the row prints `toolAfter=["select"]`) and no notice was shown.

## The matrix

Abbreviations: ok = PASS, NOCON = FAIL-NOCONSTRAINT, OFF d = FAIL-OFFTARGET (d px), NOSNAP = FAIL-NOSNAP, SILENT = FAIL-SILENT.
Targets: joint = a line's free end; midspan = a line at 25 %; midpoint = a line's middle; arcEdge = the middle of an arc's sweep;
circleEdge / circleCentre; construction = a construction line at 25 %; offsetLine = the inner loop of an Offset at 25 %; origin; axisX / axisY.

### 1. Drawing tools x snap targets (each cell: the point placed by that click, 4 px off the target)

| tool | point | joint | midspan | midpoint | arcEdge | circleEdge | circleCentre | construction | offsetLine | origin | axisX | axisY |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| line | start | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| line | end | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| arc | centre | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| arc | start | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| arc | end | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| circle | centre | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| circle | rim | OFF 4.0 | ok | OFF 2.8 | OFF 2.8 | ok | OFF 2.8 | ok | OFF 2.8 | OFF 4.0 | OFF 2.9 | OFF 4.0 |
| rect(rect-2pt) | corner 1 | ok | NOCON | NOCON | NOCON | NOCON | ok | NOCON | NOCON | ok | NOCON | NOCON |
| rect(rect-2pt) | corner 2 | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| rect(rect-center) | centre | NOCON | NOCON | NOCON | NOCON | NOCON | NOCON | NOCON | NOCON | NOCON | NOCON | NOCON |
| rect(rect-center) | corner | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| rect(rect-3pt) | point 1 | ok | NOCON | NOCON | NOCON | NOCON | ok | NOCON | NOCON | ok | NOCON | NOCON |
| rect(rect-3pt) | point 2 | ok | NOCON | NOCON | NOCON | NOCON | ok | NOCON | NOCON | ok | NOCON | NOCON |
| rect(rect-3pt) | point 3 | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| polygon | centre | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| polygon | vertex | OFF 4.0 | OFF 4.0 | OFF 4.0 | OFF 4.0 | OFF 4.0 | OFF 4.0 | OFF 4.0 | OFF 4.0 | OFF 4.0 | OFF 4.0 | OFF 4.0 |
| slot(slot-c2c) | centre 1 | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| slot(slot-c2c) | centre 2 | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| slot(slot-overall) | end 1 | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| slot(slot-overall) | end 2 | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| slot(slot-center) | centre | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| slot(slot-center) | end centre | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| slot(slot-arc-3pt) | start | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| slot(slot-arc-3pt) | end | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| slot(slot-arc-3pt) | arc point | NOCON | ok | ok | ok | ok | NOCON | ok | ok | NOCON | ok | ok |
| slot(slot-arc-center) | centre | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| slot(slot-arc-center) | start | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| slot(slot-arc-center) | end | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| bezier | anchor 1 | NOSNAP | NOSNAP | NOSNAP | NOSNAP | NOSNAP | NOSNAP | NOSNAP | NOSNAP | NOSNAP | NOSNAP | NOSNAP |
| bezier | anchor 2 | NOSNAP | NOSNAP | NOSNAP | NOSNAP | NOSNAP | NOSNAP | NOSNAP | NOSNAP | NOSNAP | NOSNAP | NOSNAP |
| text | anchor | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |

### 3. Select tool: drag onto the target, release

| tool | point | joint | midspan | midpoint | arcEdge | circleEdge | circleCentre | construction | offsetLine | origin | axisX | axisY |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| select-drag | line end | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| select-drag | rect corner | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok | ok |

### 2. Constraint tools x picks (P = a free point (a line end), RC = a rectangle corner (twin joints), ORG = the origin, CC = the circle centre,
LA = a line, DL = another line, SL = a slanted line, K = a construction line, OL = an offset-made line, RS = a rectangle side, A = an arc,
C = a circle, AX = the X axis; "tool after each pick" = the active tool after each press)

| tool | picks | valid pair | result | made | tool after each pick | notice |
|---|---|---|---|---|---|---|
| coincident | P+CC | yes | PASS | ["coincident"] | ["coincident","coincident"] | [] |
| coincident | P+ORG | yes | PASS | ["coincident"] | ["coincident","coincident"] | [] |
| coincident | RC+P | yes | PASS | ["coincident"] | ["coincident","coincident"] | [] |
| coincident | P+LA | yes | FAIL-SILENT | [] | ["coincident","select"] | [] |
| coincident | LA+P | yes | FAIL-SILENT | [] | ["select","select"] | [] |
| coincident | RC+OL | yes | FAIL-SILENT | [] | ["coincident","select"] | [] |
| coincident | OL+RC | yes | FAIL-SILENT | [] | ["select","select"] | [] |
| coincident | P+K | yes | FAIL-SILENT | [] | ["coincident","select"] | [] |
| coincident | P+A | yes | FAIL-SILENT | [] | ["coincident","select"] | [] |
| coincident | A+P | yes | FAIL-SILENT | [] | ["select","select"] | [] |
| coincident | P+C | yes | FAIL-SILENT | [] | ["coincident","select"] | [] |
| coincident | C+P | yes | FAIL-SILENT | [] | ["select","select"] | [] |
| coincident | P+AX | yes | PASS | ["pointOnLine"] | ["coincident","coincident"] | [] |
| coincident | AX+P | yes | PASS | ["pointOnLine"] | ["coincident","coincident"] | [] |
| coincident | LA+K | no | FAIL-SILENT | [] | ["select","select"] | [] |
| midpoint | P+K | yes | PASS | ["midpoint"] | ["midpoint","midpoint"] | [] |
| midpoint | K+P | yes | PASS | ["midpoint"] | ["midpoint","midpoint"] | [] |
| midpoint | RC+OL | yes | REFUSED-TOLD | [] | ["midpoint","midpoint"] | ["⚠️Midpoint rejected — creates a conflict (res: 5.3224) [ERR-CSOLVE-01]"] |
| midpoint | P+A | yes | FAIL-SILENT | [] | ["midpoint","select"] | [] |
| midpoint | A+P | yes | FAIL-SILENT | [] | ["select","select"] | [] |
| tangent | LA+C | yes | PASS | ["tangent"] | ["tangent","tangent"] | [] |
| tangent | C+LA | yes | PASS | ["tangent"] | ["tangent","tangent"] | [] |
| tangent | LA+A | yes | PASS | ["tangent"] | ["tangent","tangent"] | [] |
| tangent | A+LA | yes | PASS | ["tangent"] | ["tangent","tangent"] | [] |
| tangent | A+C | yes | PASS | ["tangent"] | ["tangent","tangent"] | [] |
| tangent | OL+C | yes | PASS | ["tangent"] | ["tangent","tangent"] | [] |
| tangent | LA+K | no | FAIL-SILENT | [] | ["tangent","tangent"] | [] |
| parallel | LA+K | yes | PASS | ["parallel"] | ["parallel","parallel"] | [] |
| parallel | K+LA | yes | PASS | ["parallel"] | ["parallel","parallel"] | [] |
| parallel | LA+OL | yes | PASS | ["parallel"] | ["parallel","parallel"] | [] |
| parallel | DL+AX | yes | PASS | ["parallel"] | ["parallel","parallel"] | [] |
| parallel | AX+DL | yes | PASS | ["parallel"] | ["parallel","parallel"] | [] |
| parallel | LA+C | no | FAIL-SILENT | [] | ["parallel","select"] | [] |
| perp | LA+RS | yes | PASS | ["perpendicular"] | ["perp","perp"] | [] |
| perp | SL+OL | yes | PASS | ["perpendicular"] | ["perp","perp"] | [] |
| perp | OL+SL | yes | PASS | ["perpendicular"] | ["perp","perp"] | [] |
| perp | SL+AX | yes | PASS | ["perpendicular"] | ["perp","perp"] | [] |
| perp | OL+DL | yes | REFUSED-TOLD | [] | ["perp","perp"] | ["⚠️Perpendicular rejected — creates a conflict (res: 1.3807) [ERR-CSOLVE-01]"] |
| perp | LA+AX | yes | REFUSED-TOLD | [] | ["perp","perp"] | ["⚠️Perpendicular rejected — creates a conflict (res: 0.0000) [ERR-CSOLVE-01]"] |
| perp | LA+A | no | FAIL-SILENT | [] | ["perp","select"] | [] |
| parallel | SL+LA | yes | PASS | ["parallel"] | ["parallel","parallel"] | [] |
| equal | LA+K | yes | PASS | ["equal"] | ["equal","equal"] | [] |
| equal | LA+OL | yes | PASS | ["equal"] | ["equal","equal"] | [] |
| equal | A+C | yes | PASS | ["equal"] | ["equal","equal"] | [] |
| equal | C+A | yes | PASS | ["equal"] | ["equal","equal"] | [] |
| equal | LA+C | no | FAIL-SILENT | [] | ["equal","equal"] | [] |
| collinear | LA+DL | yes | PASS | ["collinear"] | ["collinear","collinear"] | [] |
| collinear | LA+OL | yes | PASS | ["collinear"] | ["collinear","collinear"] | [] |
| collinear | DL+AX | yes | PASS | ["collinear"] | ["collinear","collinear"] | [] |
| collinear | K+LA | yes | PASS | ["collinear"] | ["collinear","collinear"] | [] |
| hv | SL | yes | FAIL-SILENT | [] | ["select"] | [] |
| hv | DL | yes | FAIL-SILENT | [] | ["select"] | [] |
| hv | P+CC | yes | PASS | ["horizontal"] | ["hv","hv"] | [] |
| hv | P+ORG | yes | PASS | ["horizontal"] | ["hv","hv"] | [] |
| hv | RC+P | yes | PASS | ["vertical"] | ["hv","hv"] | [] |
| hv | P+LA | no | FAIL-SILENT | [] | ["hv","select"] | [] |
| symmetric | P+CC+K | yes | PASS | ["symmetric"] | ["symmetric","symmetric","symmetric"] | [] |
| symmetric | LA+DL+K | yes | PASS | ["symmetric"] | ["symmetric","symmetric","symmetric"] | [] |
| symmetric | A+C+K | yes | PASS | ["symmetric"] | ["symmetric","symmetric","symmetric"] | [] |
| symmetric | P+CC+AX | yes | PASS | ["symmetric"] | ["symmetric","symmetric","symmetric"] | [] |
| symmetric | P+LA+K | no | FAIL-SILENT | [] | ["symmetric","select","select"] | [] |

