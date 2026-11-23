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

<!-- TOTALS -->

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
| J | `packages/ui/input-handlers/bezier-tool.js:12-14` and `:105-113`: the Bezier pen snaps only to its own first anchor (TASK 762, declared: "Anchors land at the raw world point"); every other snap is hidden and dropped. | Bezier anchor 1, anchor 2 x all 11 targets: FAIL-NOSNAP, 4 px off = **22** | a DECLARED behaviour (task 762), listed for the owner: Fusion's spline snaps its points. |

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

Saved by `AUDIT_869_EVIDENCE=.evidence/869/final` (local evidence, not committed), 3x zoom, 340 x 220 px around the target:

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

<!-- TABLES -->
