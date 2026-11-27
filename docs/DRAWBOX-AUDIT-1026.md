# Draw-box audit (task 1026): every combination of typed size input in the drawing tools

AUDIT ONLY (no code in `packages/` or `apps/` changed). Owner request (turn 3832). Worktree `drawbox-1026`, branch `agents/drawbox-1026` from `origin/main` 0822cda9.

Task 1013 (merged) made the draw-time boxes reuse the edit box's parse / refusal / autocomplete path (BUG-180..183). This audit drives EVERY drawing tool and variant that opens a size box with real pointer and keyboard events, in every combination the owner listed, and reads the result back from the stored document.

Out of scope here: Esc / tool switch / undo / zoom in the middle of a box (task 1023, INTERRUPTIONS). Already filed and not re-filed: **R2-04** (a Line's typed length drops H/V), **R1-08** (Slot has no H/V inference), **R2-06** (Offset: a click to choose the side steals the focus from the distance box), **R1-16** (the backwards "a plain number cannot be a length" wording), **R2-12** (no 3-point Arc). R2-04 and R1-08 are being fixed by task 1021.

## How it was run

Probes (outside the gate, live headless Chrome through `tests/helpers/cdp-browser.js`, real `Input.dispatchMouseEvent` / `Input.dispatchTouchEvent` / key events, no app state written by the probe; pattern of `design-run-audit-1017-kit.js`):

| file | covers |
|---|---|
| `tests/audits/drawbox-audit-1026-kit.js` | shared driver: variant picking, document read (shapes, constraints, parameters), DOF, box / hint / toast read, undo counting, `ROW` printing |
| `drawbox-audit-1026-line.mjs` | Line length + angle, chains |
| `drawbox-audit-1026-rect.mjs` | Rectangle 2-point, centre, 3-point |
| `drawbox-audit-1026-round.mjs` | Circle, Arc (radius then sweep), Polygon (R + N) |
| `drawbox-audit-1026-slot.mjs` | Slot: centre-to-centre, overall, centre point, 3-point arc, centre-point arc |
| `drawbox-audit-1026-modify.mjs` | Fillet, Offset, Circular and Rectangular Pattern dialogs |
| `drawbox-audit-1026-extra.mjs`, `-extra2.mjs` | follow-up cells found while reading the runs; inch document; over-constrain against a locked point; Bezier |
| `drawbox-audit-1026-phone.mjs` | phone 390x844 subset, real touch taps |
| `drawbox-audit-1026-evidence.mjs` | cropped screenshots |

Run: `node tests/audits/drawbox-audit-1026-<name>.mjs` (each prints one `ROW <id> | tool | combination | OK or DEV: ...  || LIVE <state> || FINAL <state> || undo=<n>` line per cell; `ONLY=<regex>` reruns a subset). Desktop 1280x800; the canvas shows x -104..104, y -46..46 mm (the SKETCHES card covers x < -61, y < -33: no cell clicks there).

After EVERY cell the probe reads: the geometry (from the stored document), the dimensions (driving or reference, value, formula kept, name kept, Ø or R), the constraints (coincident, H/V, tangent, point-on-line, ...), DOF and the fully-constrained flag, the undo steps (Ctrl+Z until Undo is disabled: **exactly one step per drawn shape in every cell**; a 3-segment chain = 3), the box (open / closed, focus, field texts, `aria-invalid`), the `#dimHint` text and any toast. `LIVE` is read before the probe presses Esc, `FINAL` after.

Totals: **425 cells**: **345 OK, 43 BUG, 24 FRICTION, 13 DIVERGENCE** (owner rule: any unexpected result is a bug; FRICTION = works but misleads or surprises; DIVERGENCE = differs from Fusion's documented or declared behaviour, to verify in Fusion). 9 of the 43 BUG cells are already-filed bugs (R2-04 x2, R1-08 x6, R2-06 x1: cited, not re-filed). The other 34 have 9 new causes (B-01..B-09; B-L13 is the consequence of the declared divergence B-12).

Variants that exist: Rectangle has three (2-point, centre, 3-point). Slot has five. **Circle has ONE (centre + diameter) and Arc has ONE (centre-start-end)** in this app (`tool-ribbon.js` offers no other variant), so "each variant" is one for those. **Bezier opens no size box** (B-BZ1: no box after clicks, none after typing). Patterns are dialogs, not on-canvas boxes: their Quantity / Distance / Angle fields were driven the same way.

Expected-result rule used (the one most tools already follow, "(unverified)" in Fusion unless a fixture says so; no fixture under `tests/fixtures/fusion-oracle/` or `docs/` covers a draw-time box, only `FUSION-COMPARISON.md` "Line / arc / circle value boxes on the first click (task 597)", whose cells are all "to verify in Fusion"):

1. A typed field locks THAT quantity; the other follows the cursor (direction, quadrant, side).
2. Emptying a typed field unlocks it (back to the cursor).
3. A typed length becomes a driving dimension carrying its formula and its name (circle Ø, arc R); a typed name or formula is kept; a user parameter is reused.
4. Enter and a click place the same shape; one undo step per shape.
5. A typed size that is 0, negative, a syntax error or a name nothing defines is refused: the box stays open, the field is red, an inline hint says why, nothing is drawn.
6. A typed size wins over a snap; a click on an existing point with nothing typed is coincident.
7. A bare number is in the document unit; a suffix (`in`, `mm`, `cm`, `1/2"`) wins.

## Summary of findings (group identical failures by cause)

Cell ids are `B-<tool><nn>` as in the matrix below. Severity: lost work / wrong geometry / wrong constraint / misleading UI / friction.

| id | cells | verdict | what happened vs expected | repro | severity | cause (file:line) |
|---|---|---|---|---|---|---|
| **B-01** | B-C06, B-A11, B-X09, B-X12, B-C2C07, B-C2C21, B-OV07, B-OV21, B-CP07, B-CP21 (10) | **BUG** | EMPTYING a box does not unlock it: the last valid text keeps the lock. Circle: Ø 60, Backspace twice (box shows EMPTY), Enter: a circle of Ø **6** with driving dimension d1 = 6 (screenshot E1). Arc: sweep 90, Backspace x2, click: a **9** degree arc; radius 25, Backspace x2, click the start: radius **2** with a driving R = 2. Slot (all three straight variants): span 40, Backspace x2, click: span dimension **4**; width 12, Backspace x2, click: width dimension **1**. Polygon: N 4, Backspace, Enter: **4** sides, not the remembered 9. The two-field Line and Rectangle boxes DO unlock (B-L07, B-X06, B-R207): rule 2. | Circle tool, click centre, type `60`, Backspace, Backspace, Enter | wrong geometry (and a driving dimension with a number the user deleted) | `numeric-input-manager.js:939-942` (`handlePreview` of a single box sends no `field` / `value` when the text reads NaN); every single-field tool's guard then drops that event: `circle-tool.js:39`, `arc-tool.js:127`, `slot-tool.js:436`; the commit paths do not clear on NaN: `circle-tool.js:25`, `polygon-tool.js:42,60` (`Number.isFinite(detail.height)` keeps the old count) |
| **B-02** | B-R203, B-R205, B-R220, B-RC04, B-RC05, B-RC08, B-RC20 (7) | **BUG** | A rectangle committed by ENTER gets extra snap constraints that the same rectangle committed by CLICK does not: when a typed size puts a corner or a side on an axis or the origin, Enter adds `pointOnLine` binding the side to the fixed axis (2-point W 40 H 20 from (-40,-10): the right side lands on the Y axis; Enter: `pointOnLine` + DOF 8, click (B-R209): none + DOF 16; centre mode: a third `pointOnLine` on top of the 2 the shape always has). Rule 4. | Rect (2-point), click (-40,-10), type 40, Tab, 20, Enter, read constraints; repeat committing by click | wrong constraint (the rectangle can no longer be moved across the axis; silent) | `rect-tool.js:135,148,162` (`finalizeRectFromActive` re-runs `findSnap` on every corner of the placed rectangle; the click path `handleRectPointerUp` does not) |
| **B-03** | B-R302, B-R303, B-R304, B-R305, B-R306, B-R307, B-R308, B-R309, B-R310 (9: 7 BUG, 2 DIVERGENCE) | **BUG** | The 3-point rectangle has NO value box on the first or second click (B-R302, B-R305: the 2-point and centre rectangles open W x H at once). A typed digit DOES open a box (screenshot E3), but: after click 1, Enter closes the box and draws nothing, silently (B-R303, B-R304); after click 2, typed height `20` is ignored and the rectangle is placed at the cursor's height with no dimension (B-R306, B-R307); `0` is not refused (B-R309); `40 Tab 20` or `h = 20` draws nothing (B-R308, B-R310). | Rect, variant 3-Point, click, move, type `40`, Enter | lost work (typed values dropped without a word) | `rect-tool.js:88` (`onPreview` only handles the sized modes), `:112` (`finalizeRectFromActive` returns false for a 3-point rectangle with no second point), `:303-317` (`handleRectKeyDown` opens a box this tool never reads) |
| **B-04** | B-A303, B-A305 (2) | **BUG** | 3-point arc slot: a typed span (`30`) or span formula (`d1 / 2`) creates NO dimension (width keeps its name). The centre-point arc slot keeps it as a radius (B-AC03, B-AC05); every straight slot keeps it. Rule 3. | Slot, variant Three Point Arc Slot, click, click, type `30`, Enter, finish by clicks, read dimensions | wrong constraint (typed number silently becomes geometry only) | `slot-tool.js:344-366` (the span dimension is made for straight modes and `CENTER_POINT_ARC` only) |
| **B-05** | B-L30, B-X02 (2) | **BUG** | Line: type a length, then RIGHT-click on the canvas (finalize): TWO segments, the typed one (40) and a stray one from its end to the cursor (1.03 mm here). Without typing (B-X01) right-click makes one segment. | Line, click, move, type `40`, right-click | wrong geometry | `drawing-tools.js:68` finalizes on pointer DOWN; the matching pointer UP reaches `handleLinePointerUp` (`line-tool.js:344`) and places a click segment from the new chain start to the cursor (traced by reading, not instrumented) |
| **B-06** | B-X03 (1) | **BUG** | An Enter-committed Line merges its end with ANY joint within **0.5 mm** (no snap shown); a typed 40.3 landing 0.4 mm from an unrelated endpoint MOVED that existing line (x 10 -> 10.1) because the solver satisfies the new dimension. The click path uses 0.01. | draw a vertical line at x = 10 (30..40); Line from (-30.2,30), type `40.3`, Enter; read the old line | wrong geometry (an unrelated shape moves) | `line-tool.js:549` (`finalizeLineFromActive`: `findNearbyJoint(..., 0.5)`; the click path is `:436` with 0.01) |
| **B-07** | B-A20a, B-A20b (BUG); B-A20c, B-A20d (FRICTION) | **BUG** | Arc sweep: `0` and `-90` are silently ignored: Enter places an arc at the cursor's sweep (no hint, the box closes). `360` / `720` clamp to 359.999: an arc whose start and end are the same point. Lengths are refused with a hint (rule 5). | Arc, click centre, click start, type `0`, Enter | misleading UI (typed value ignored) | `arc-tool.js:85` (`detail.value > 0 ? min(value, 359.999) : null`); no refusal for a typed angle in `numeric-input-manager.js` `liveRefusal` (lengths only) |
| **B-08** | B-OC1 (1) | **BUG** | A typed length that conflicts with a LOCKED point: Line from the fixed origin, existing endpoint locked at distance 40, type `40.3`, Enter: the end merges with the locked point, the dimension becomes a REFERENCE `(40)`, no toast, no hint: the typed number is dropped without a word. (The edit box refuses with "Can't set to ..."; BUG-181.) | lock a point 40 mm from the origin; Line from the origin, cursor on it, type `40.3`, Enter | misleading UI | `line-tool.js:579-583` (`finalizeLineFromActive` creates the typed dimension and ignores that the solver made it a reference; the edit box has its refusal, `numeric-input-manager.js` `handleCommit`) (cause: unverified) |
| **B-09** | B-F14d (1) | **BUG** | Fillet: radius `6abc` (a syntax error) toasts "Enter a radius greater than zero"; `abc` toasts the right reason ("unknown parameter"). | Fillet, click a corner, type `6abc`, Enter | misleading UI | `fillet-tool.js:469-470` (only 5 parse codes show their own message) |
| B-10 | B-L17, B-L20 (2) | BUG, **R2-04 (cited, not re-filed)** | Typed length drops the H/V inference (B-L17: cursor exactly horizontal, `30`, Enter: no `horizontal`; the control by click B-L18 has it). **Extension to cite in task 1021: the tangent inference is dropped the same way** (B-L20 vs the click control B-L21, which makes `tangent`). | as R2-04 | wrong constraint | `line-tool.js:56` and `:64` (`redrawLinePreview` / `handleLinePointerMove` clear `state.activeInference` whenever a size is locked, so `finalizeLineFromActive` (`:592`) finds none) |
| B-11 | B-C2C13/14, B-OV13/14, B-CP13/14 (6) | BUG, **R1-08 (cited, not re-filed)** | Slot has no H/V inference: not by typed span (B-xx13) and, as the control shows, **not by click either** (B-xx14). | as R1-08 | wrong constraint | `slot-tool.js` (no `findInference`) |
| **B-12** | B-L04, B-L05, B-L11, B-L19, B-X05, B-A04, B-A05, B-A10 (DIVERGENCE); B-L13 (BUG) | DIVERGENCE (declared) / BUG | A typed ANGLE (Line) and a typed SWEEP (Arc) create no dimension and no H/V (typed 90 is neither V nor an angle: B-L19). Declared in `FUSION-COMPARISON.md` ("Not the same / not done: a typed line ANGLE adds no constraint ... a typed arc sweep adds none either"), all "to verify in Fusion". **Consequence (B-L13, BUG):** typed length 40 + angle 30, then the NEXT segment's inference (perpendicular) re-solves and the first line rotates to **32.69** degrees: the number the user typed is lost. | Line, type `40`, Tab, `30`, Enter, move, Enter; read angle | wrong geometry (B-L13) | `line-tool.js:579-583` (only `lockedLength` becomes a constraint), `arc-tool.js:328` (only the radius becomes a constraint) |
| B-13 | B-X04, B-A17, B-P15 (3) | DIVERGENCE | A name in an angle or count field is refused (`"=" is not allowed here`): Line angle `ang = 30`, Arc sweep `sw = 90`, Polygon N `n = 6`. The pattern dialog ACCEPTS names and formulas in its Quantity and Angle fields (B-PC06h, B-PC07f, B-PC07g). One rule needed (Fusion allows a named parameter for any value). | Line, Tab, `ang = 30`, Enter | friction | `numeric-input-manager.js:32` (`readBoxText`: `allowAssign` defaults to true only for a `length` field; the pattern dialog reads its fields through another path) |
| B-14 | B-R202, B-R202b, B-RC02, B-RC02b (4) | FRICTION | Rectangle (2-point and centre): click, Enter with no size: the box CLOSES and the draw stays armed, so the next move and click work with no box. Line, Circle, Polygon, Slot, Arc keep the box open (rule). | Rect, click, Enter, move, click | friction | `rect-tool.js:34,77` (`enterCorner` returns null with no cursor yet, so the `tooSmall` / `keepOpen` guard is skipped and `handleCommit` hides the box) |
| B-15 | B-C04, B-X08 (2) | FRICTION | Tab inside a single-field box (Circle Ø, Arc radius / sweep, Slot span / width) moves focus OUT to the page: the SKETCHES card's collapse button takes it (screenshot E5); Enter then presses that button. The two-field boxes cycle. | Circle, click, move, Tab | friction (a later Enter acts on a toolbar button) | `numeric-input-manager.js:359-363` (the single box's Tab commits only in edit / view mode; live-single falls through to the browser) |
| B-16 | B-P18a, d, e, f, g (5) | FRICTION | Polygon N out of range is clamped silently: 2 -> 3, 0 -> 3, -5 -> 3, 65 -> 64, 5.5 -> 6. No hint, the box keeps the typed text. Lengths are refused (rule 5). | Polygon, Tab, `65`, Enter | friction | `shapes.js:219` (`clampPolygonSides`) |
| B-17 | B-P13 (1) | FRICTION, **R1-16 (cited, not re-filed)** | Polygon N formula `d1 / 8` (a length): hint "a plain number cannot be a length" in the COUNT field: accurate but cryptic (it means: a count cannot take a length). | Polygon, Tab, `d1 / 8` | friction | `expression.js:531` (the UNIT_MISMATCH wording) |
| B-18 | B-F06, B-F14a, b, e, B-F15, B-O04, B-O10a, d, e (9) | FRICTION | Fillet and Offset boxes refuse with a TOAST only; the draw-time boxes and the edit box show an inline `#dimHint` (rule 5). The same input gives different wording: empty field: Fillet "Enter a radius greater than zero", Offset "Offset: nothing to evaluate.". | Fillet, corner, Backspace to empty, Enter | friction | `fillet-tool.js:469-471`, `offset-tool.js:267,275,284` (`showNotification`; neither calls the live boxes' inline hint) |
| B-19 | B-F08 (FRICTION); B-O06 (BUG, **R2-06 cited, not re-filed**) | FRICTION | A click on the canvas while a typed value is in the Fillet box CANCELS the fillet (typed radius lost, no hint); in the draw boxes a click commits. B-O06 reproduces R2-06 (Offset: a click to "choose the side" takes the focus from the box, the next typed digits go nowhere and Enter does nothing; the tool's own hint says "choose the side, type the distance"). | Offset, click a side (rect), click the outside, type `8`, Enter | friction (lost typing) | not traced (fillet-tool.js / offset-tool.js: an outside press cancels the fillet; the offset box is not re-focused after the side click) |

Not bugs (checked, OK): formulas, names and existing parameters in every box (BUG-182 holds: Line, Rect, Circle, Arc, Polygon, Slot, Fillet, Offset, both patterns); the centre snap of a typed circle (BUG-183 holds: B-C09, B-C10); refusals and hints of the draw boxes for `0`, `-5`, `abc`, `40abc`, `40 +`, `4,5` (BUG-180 holds); units `2 in`, `25.4mm`, `1/2"`, `3cm`, bare numbers in an inch document (B-I*; BUG-181 text not re-tested here); Circle gets Ø (d = 2r), Arc and Fillet get R (task 1008); Slot width is a Ø dimension (always created, also with nothing typed: B-xx01, by design); a typed size beats the snap (no coincident when they disagree: B-L15, B-C12, B-A14, B-R212); a typed value with the cursor moved keeps its lock and the direction / quadrant / side follows (B-L09, B-R208, B-RC07, B-C2C08, B-O05); one undo step per shape. Fillet with a radius larger than its sides (B-F14c) lengthens the sides and runs them backwards BY OWNER RULING ("NO clamp (owner ruling) ... like Fusion", `packages/core/fillet.js:369-372`): not filed.

No REGRESSION of BUG-180..183, BUG-140..147 or BUG-170..174 was seen. The open BUG-240..245 are unrelated.

## Fusion checks needed (disputed cells for the advisor)

1. Line typed ANGLE: does Fusion add an angle dimension (to the horizontal / previous line) when the angle box is used? (B-12, B-L04, B-L05, B-L19, B-A04.) And a typed 0 / 90 : an H / V constraint?
2. Does a typed value that is later EMPTIED in Fusion's box fall back to the live cursor value (rule 2)? (B-01.)
3. 3-point rectangle: which boxes does Fusion show after click 1 and click 2 (length / angle then width)? (B-03.)
4. Arc sweep `0`, negative, 360, 720: refused, flipped direction, or clamped? Polygon sides below 3 / above the maximum: refused or clamped? (B-07, B-16.)
5. Tab in a one-field box: does Fusion keep focus in the box? (B-15.)
6. Right-click in a Line with a typed length: a context menu (OK / Cancel), or a finalize? (B-05.)
7. A rectangle whose typed size lands a side on an axis or the origin: does Fusion add a constraint (coincident / on-axis) or leave it free? (B-02.)
8. A typed length ending within 0.5 mm of another point: Fusion does not merge, we do (B-06).
9. A typed length that conflicts with a locked point: refuse, or a reference dimension with a warning? (B-08.)
10. Names in angle / count fields (`ang = 30`): allowed in Fusion? (B-13.)
11. A huge typed size (99999): accepted everywhere here (Line, Rect, Circle, Slot, Polygon, Offset), drawn off screen with no zoom (cells ...c / B-xx17c). Does Fusion cap it?
12. Click away with a typed fillet radius: apply or cancel? (B-19.)

## Not covered / limits

- INTERRUPTIONS (Esc, tool switch, undo, zoom mid-box): task 1023. Pen Plotter, Shaper, Trace host the same Design tab code; only SketchStudio was driven.
- Phone: a 390x844 subset with real touch taps (B-PH*, 14 cells: Line, Rect, Circle, Polygon, Slot, Arc, Fillet, Offset). Every box opens inside the viewport and unfocused (tap focuses it; by design); no phone-only defect found. The phone has no mouse move, so a typed angle with no length has no direction (B-PHL3: Enter refused, box stays).
- Pattern dialogs were driven through Quantity, Distance and Angle with a pre-selected circle and an Origin / line direction; the Distribution select was set by an `change` event on the real `<select>`, not a pointer press.
- B-OC1 is the only over-constrain cell where the typed value contradicts a locked point; the others (B-OC2, B-OC3) agreed with the geometry.
- Screenshots (copied to `.evidence/1026/`, local, not committed): E1 `62105ea7ba3169e5db8c307d5c80a4dd` (empty Circle box) and `357d1cf247b1b738f1819a3c14586dd0` (the resulting Ø6, label "Ø6"); E2 `acc064222be2f6db22fa4a95ff5c5032` / `6efcd353ed91b370188975e88438db08` (rectangle before / after a fillet of radius 1000: the sides run past the corner); E3 `03818cb828f9146acfd40250ff2b44f7` (the 3-point rectangle's typed `40` box) / `3f7a2c6bd89c7f9007aa8e378250b921` (after Enter: nothing drawn); E5 `279443877e3a7f1322866b7959eb402c` (focus ring on the SKETCHES collapse button after Tab); E4 `96ece3795f7a6b76c24e46cef0eda136` (right-click stray segment: not a clear picture, the numeric rows B-L30 / B-X02 are the evidence); OC1 `9afb31cfbd6541e32856c6d8bc56bf3d` (the `(40)` reference label). The raw `ROW` logs are `.evidence/1026/*-run*.log`.

## Matrix (every cell)

`result` = the final stored state: shapes (count, first two sizes), dimensions (`distance=value{formula}:name`, `Ø` / `R`, `(ref)` reference), constraint counts (coincident, point-on-line, H/V, tangent), DOF, plus the box hint or toast seen. `undo` = Ctrl+Z presses to empty (the whole cell, including set-up shapes). A slot always carries `SLOT` constraints (equal, tangent, parallel) and a width dimension d?Ø. The centre rectangle always carries 2 `pointOnLine` (its diagonals). Coordinates (mm, y up the screen is negative): Line start (-60,10), M1 (-20,0), M2 (-30,38); Rect first click (-40,-10), C2 (10,25); Circle / Arc / Polygon centre O (-30,0), R1 (10,0); Slot P1 (-50,5), P2d (-5,-15), W1 (-25,22). A click or end that lands on the X axis (y = 0) or the Y axis (x = 0) gets the usual point-on-axis constraint, so a `pointOnLine` there is expected (B-L01 end on M1, the circle / arc / polygon centre at O).

### Line (length + angle)

| id | combination | verdict | result (final state; the box and hint are in the probe log) | undo |
|---|---|---|---|---|
| B-L01 | nothing typed, click then click (baseline) | OK | 1 shape: L[len 41.23 ang=14.04]; ptOnLine 1; dof 3 | 1 |
| B-L02 | click only, then Enter (cursor still on the start) | OK | nothing drawn; dof 0 | 0 |
| B-L03 | length only (40), Enter | OK | 1 shape: L[len 40 ang=14.04]; dims distance=40:d1; dof 4 | 1 |
| B-L04 | angle only (Tab, 30), Enter | DIVERGENCE (B-12) | 1 shape: L[len 41.23 ang=30]; dof 4 | 1 |
| B-L05 | length 40 + angle 30, Enter | DIVERGENCE (B-12) | 1 shape: L[len 40 ang=30]; dims distance=40:d1; dof 4 | 1 |
| B-L06 | length 40 then retyped 25, Enter | OK | 1 shape: L[len 25 ang=14.04]; dims distance=25:d1; dof 4 | 1 |
| B-L07 | length 40, Backspace x2 (empty), move cursor to M2, Enter | OK | 1 shape: L[len 41.03 ang=-42.89]; dof 4 | 1 |
| B-L08 | length 40, Backspace once (=4), Enter | OK | 1 shape: L[len 4 ang=14.04]; dims distance=4:d1; dof 4 | 1 |
| B-L09 | length 40, then the mouse moves to M2 (lock holds? direction follows?), Enter | OK | 1 shape: L[len 40 ang=-42.89]; dims distance=40:d1; dof 4 | 1 |
| B-L10 | length 40 typed, commit by CLICK at M2 | OK | 1 shape: L[len 40 ang=-42.89]; dims distance=40:d1; dof 4 | 1 |
| B-L11 | angle 30 typed (Tab), commit by CLICK at M1 | DIVERGENCE (B-12) | 1 shape: L[len 41.23 ang=30]; dof 4 | 1 |
| B-L12 | chain: seg1 L=40, seg2 box value after Enter, seg2 L=25, seg3 untouched cursor click | OK | 3 shapes: L[len 40 ang=14.04] L[len 25 ang=-35.79] ...; dims distance=40:d1 distance=25:d2; coinc 2; dof 12 | 3 |
| B-L13 | chain: seg1 L=40 A=30 Enter, seg2 only moves + Enter (no typing): is the box empty or carried? | BUG (B-12) | 2 shapes: L[len 40 ang=32.69] L[len 65.44 ang=-57.31]; dims distance=40:d1; coinc 1; dof 8 | 2 |
| B-L14 | typed length 40 whose end is exactly an existing endpoint (cursor on it), Enter | OK | 2 shapes: L[len 30 ang=0] L[len 40 ang=0]; dims distance=40:d1; ptOnLine 1; H/V 1; dof 4 | 2 |
| B-L14b | control: the same end placed by a CLICK on the existing endpoint (no typing) | OK | 2 shapes: L[len 30 ang=0] L[len 40 ang=0]; coinc 1; ptOnLine 1; H/V 2; dof 7 | 2 |
| B-L14c | typed length 40 (end exactly on the endpoint), commit by CLICK on the point | OK | 2 shapes: L[len 30 ang=0] L[len 40 ang=0]; dims distance=40:d1; coinc 1; ptOnLine 1; H/V 1; dof 5 | 2 |
| B-L15 | start at the fixed origin, cursor on a joint, typed length 20 != distance (snap vs typed) | OK | 2 shapes: L[len 30 ang=0] L[len 20 ang=23.2]; dims distance=20:d1; H/V 1; dof 5 | 2 |
| B-L16 | angle 0 typed (Tab,0), then CLICK on an existing point on that horizontal | OK | 2 shapes: L[len 30 ang=0] L[len 40 ang=0]; coinc 1; ptOnLine 1; H/V 1; dof 7 | 2 |
| B-L17 | cursor exactly horizontal (H inference), type length 30, Enter  [R2-04, task 1021] | BUG (B-10, R2-04) | 1 shape: L[len 30 ang=0]; dims distance=30:d1; dof 4 | 1 |
| B-L18 | cursor exactly horizontal, click (no typing): the H inference is applied | OK | 1 shape: L[len 50 ang=0]; H/V 1; dof 4 | 1 |
| B-L19 | typed angle 90 (Tab,90), Enter: vertical by angle, is V made? | DIVERGENCE (B-12) | 1 shape: L[len 41.23 ang=90]; dof 4 | 1 |
| B-L20 | circle first; line from a rim point, cursor on the tangent direction, typed length 30, Enter | BUG (B-10, R2-04) | 2 shapes: C[r=20 c=0,0] L[len 30 ang=-43.03]; dims distance=30:d1; coinc 1; ptOnLine 1; dof 4 | 2 |
| B-L21 | same tangent setup, click (no typing) | OK | 2 shapes: C[r=20 c=0,0] L[len 35.88 ang=-43.51]; coinc 1; ptOnLine 1; tang 1; dof 4 | 2 |
| B-L22 | formula: first a named line d1=40; then length "d1 / 2", Enter | OK | 2 shapes: L[len 40 ang=0] L[len 20 ang=14.04]; dims distance=40:d1 distance=20{d1; dof 8 | 2 |
| B-L23 | name: "w = 50", Enter | OK | 1 shape: L[len 50 ang=14.04]; dims distance=50:w; dof 4 | 1 |
| B-L24 | existing user parameter: "w = 50" on line 1, then on line 2 length "w", and "w = 60" (reassign) | OK | 2 shapes: L[len 50 ang=0] L[len 50 ang=14.04]; dims distance=50:w distance=50{w}:d1; dof 8 | 2 |
| B-L25a | units: "2 in" in an mm document | OK | 1 shape: L[len 50.8 ang=14.04]; dims distance=50.8:d1; dof 4 | 1 |
| B-L25b | units: "25.4mm" | OK | 1 shape: L[len 25.4 ang=14.04]; dims distance=25.4:d1; dof 4 | 1 |
| B-L25c | units: fraction 1/2" in an mm document | OK | 1 shape: L[len 12.7 ang=14.04]; dims distance=12.7:d1; dof 4 | 1 |
| B-L25d | units: "3cm" | OK | 1 shape: L[len 30 ang=14.04]; dims distance=30:d1; dof 4 | 1 |
| B-L26a | length value 0, Enter | OK | nothing drawn; dof 0; hint "A length must be more than 0." | 0 |
| B-L26b | length negative -5, Enter | OK | nothing drawn; dof 0; hint "A length must be more than 0." | 0 |
| B-L26c | length huge 99999, Enter | OK | 1 shape: L[len 99999 ang=14.04]; dims distance=99999:d1; dof 4 | 1 |
| B-L26d | length trailing garbage "40abc", Enter | OK | nothing drawn; dof 0; hint "unexpected 'abc' at 2" | 0 |
| B-L26e | length garbage "abc", Enter | OK | nothing drawn; dof 0; hint "unknown parameter 'abc' (type abc = 30 to create it)" | 0 |
| B-L26f | length exponent "1e3", Enter | OK | 1 shape: L[len 1000 ang=14.04]; dims distance=1000:d1; dof 4 | 1 |
| B-L26g | length dangling operator "40 +", Enter | OK | nothing drawn; dof 0; hint "unexpected the end of the input at 4" | 0 |
| B-L26h | length comma "4,5", Enter | OK | nothing drawn; dof 0; hint "unexpected ',' at 1" | 0 |
| B-L27a | angle angle -30, Enter | OK | 1 shape: L[len 41.23 ang=-30]; dof 4 | 1 |
| B-L27b | angle angle 360, Enter | OK | 1 shape: L[len 41.23 ang=0]; dof 4 | 1 |
| B-L27c | angle angle 450, Enter | OK | 1 shape: L[len 41.23 ang=90]; dof 4 | 1 |
| B-L27d | angle angle "abc", Enter | OK | nothing drawn; dof 0; hint "unknown parameter 'abc' (type abc = 30 to create it)" | 0 |
| B-L27e | angle angle "30deg", Enter | OK | 1 shape: L[len 41.23 ang=30]; dof 4 | 1 |
| B-L27f | angle angle "1/2", Enter | OK | 1 shape: L[len 41.23 ang=0.5]; dof 4 | 1 |
| B-L28 | Tab Tab: focus returns to the first field; second Tab back | OK | nothing drawn; dof 0 | 0 |
| B-L29 | length 40 typed, Ctrl+Z inside the box (resets that field only), Enter | OK | 1 shape: L[len 41.23 ang=14.04]; dof 4 | 1 |
| B-L30 | length 40 typed, RIGHT-click on the canvas (finalizes the segment) | BUG (B-05) | 2 shapes: L[len 40 ang=-42.89] L[len 1.03 ang=-42.89]; dims distance=40:d1; coinc 1; dof 8 | 2 |
| B-X01 | control: right-click on the canvas with NOTHING typed (finalizes the segment) | OK | 1 shape: L[len 41.03 ang=-42.89]; dof 4 | 1 |
| B-X02 | right-click with a typed length 40 and cursor at M2 (1 mm from the typed end): one segment? | BUG (B-05) | 2 shapes: L[len 40 ang=-42.89] L[len 1.03 ang=-42.89]; dims distance=40:d1; coinc 1; dof 8 | 2 |
| B-X03 | typed length 40 whose end lands 0.3 mm from an existing endpoint (no snap on it): merged? is the old point moved? | BUG (B-06) | 2 shapes: L[len 10 ang=-90] L[len 40.3 ang=0]; dims distance=40.3:d1; H/V 1; dof 6 | 2 |
| B-X04 | angle box: a name "ang = 30" (Tab first), Enter | DIVERGENCE (B-13) | nothing drawn; dof 0 | 0 |
| B-X05 | angle box: formula "90 / 3" (Tab first), Enter | DIVERGENCE (B-12) | 1 shape: L[len 41.23 ang=30]; dof 4 | 1 |
| B-X06 | angle typed 30 then Backspace x2 (empty): unlocks? cursor to M2, Enter | OK | 1 shape: L[len 41.03 ang=-42.89]; dof 4 | 1 |
| B-X07 | phone-style: after typing a length, does the second field show the live angle (not stale)? read both fields after a mouse move | OK | nothing drawn; dof 0 | 0 |
| B-X13 | chain: seg 2 box, type 25, Backspace x2, Enter (seg 2 unlocked?) | OK | 2 shapes: L[len 40 ang=14.04] L[len 50.79 ang=-35.79]; dims distance=40:d1; coinc 1; dof 8 | 2 |

### Rectangle: 2-point and centre (W x H)

| id | combination | verdict | result (final state; the box and hint are in the probe log) | undo |
|---|---|---|---|---|
| B-R201 | nothing typed: click then click (baseline) | OK | 4 shapes: L[len 49.98 ang=0] L[len 34.95 ang=-90] ...; coinc 4; H/V 4; dof 16 | 1 |
| B-R202 | click only, then Enter (cursor still on the first point) | FRICTION (B-14) | nothing drawn; dof 0 | 0 |
| B-R203 | first field only (W 40), Enter | BUG (B-02) | 4 shapes: L[len 40 ang=0] L[len 34.95 ang=-90] ...; dims distance=40:d1; coinc 4; ptOnLine 1; H/V 4; dof 8 | 1 |
| B-R204 | second field only (Tab, H 20), Enter | OK | 4 shapes: L[len 49.98 ang=0] L[len 20 ang=-90] ...; dims distance=20:d1; coinc 4; H/V 4; dof 16 | 1 |
| B-R205 | both fields (W 40, H 20), Enter | BUG (B-02) | 4 shapes: L[len 40 ang=0] L[len 20 ang=-90] ...; dims distance=40:d1 distance=20:d2; coinc 4; ptOnLine 1; H/V 4; dof 8 | 1 |
| B-R206 | W 40 then retyped 25, Enter | OK | 4 shapes: L[len 25 ang=0] L[len 34.95 ang=-90] ...; dims distance=25:d1; coinc 4; H/V 4; dof 16 | 1 |
| B-R207 | W 40 then Backspace x2 (empty): unlocks? then cursor to C2b, Enter | OK | 4 shapes: L[len 35.02 ang=-180] L[len 14.95 ang=90] ...; coinc 4; H/V 4; dof 16 | 1 |
| B-R208 | W 40 H 20 typed, then the mouse moves to the OPPOSITE quadrant, Enter: size holds, side follows | OK | 4 shapes: L[len 40 ang=-180] L[len 20 ang=90] ...; dims distance=40:d1 distance=20:d2; coinc 4; H/V 4; dof 16 | 1 |
| B-R209 | W 40 H 20 typed, commit by CLICK at C2 | OK | 4 shapes: L[len 40 ang=0] L[len 20 ang=-90] ...; dims distance=40:d1 distance=20:d2; coinc 4; H/V 4; dof 16 | 1 |
| B-R210 | first click ON the origin (fixed point) + W 40 H 20: coincident with the origin | OK | 4 shapes: L[len 40 ang=0] L[len 20 ang=-90] ...; dims distance=40:d1 distance=20:d2; coinc 6; H/V 4; dof 0 fully constrained | 1 |
| B-R211 | first click on an existing endpoint (a line end) + W 40, Enter | OK | 5 shapes: L[len 14.93 ang=-90] L[len 40 ang=0] ...; dims distance=40:d1; coinc 8; H/V 5; dof 20 | 2 |
| B-R212 | typed W 40 H 20 while the cursor sits on an existing point (snap): typed size wins, no coincident | OK | 5 shapes: L[len 20 ang=0] L[len 40 ang=0] ...; dims distance=40:d1 distance=20:d2; coinc 6; H/V 5; dof 4 | 2 |
| B-R213 | formula: a named dim d1 first, then W "d1 / 2", H "d1 / 4" | OK | 5 shapes: L[len 40 ang=0] L[len 20 ang=0] ...; dims distance=40:d1 distance=20{d1 distance=10{d1; coinc 4; ptOnLine 1; H/V 4; dof 12 | 2 |
| B-R214 | names: W "w = 50", H "h = 30" | OK | 4 shapes: L[len 50 ang=0] L[len 30 ang=-90] ...; dims distance=50:w distance=30:h; coinc 4; H/V 4; dof 16 | 1 |
| B-R215 | existing parameter: rect 1 "w = 50" then rect 2 with W "w" and H "w / 2" | OK | 8 shapes: L[len 50 ang=0] L[len 30 ang=-90] ...; dims distance=50:w distance=30:d1 distance=50{w}:d2 distance=25{w; coinc 8; H/V 8; dof 32 | 2 |
| B-R216a | units W "2 in" in an mm document, Enter | OK | 4 shapes: L[len 50.8 ang=0] L[len 34.95 ang=-90] ...; dims distance=50.8:d1; coinc 4; H/V 4; dof 16 | 1 |
| B-R216b | units W "25.4mm" in an mm document, Enter | OK | 4 shapes: L[len 25.4 ang=0] L[len 34.95 ang=-90] ...; dims distance=25.4:d1; coinc 4; H/V 4; dof 16 | 1 |
| B-R216c | units W 1/2" in an mm document, Enter | OK | 4 shapes: L[len 12.7 ang=0] L[len 34.95 ang=-90] ...; dims distance=12.7:d1; coinc 4; H/V 4; dof 16 | 1 |
| B-R217a | W 0, Enter | OK | nothing drawn; dof 0; hint "A length must be more than 0." | 0 |
| B-R217b | W -5, Enter | OK | nothing drawn; dof 0; hint "A length must be more than 0." | 0 |
| B-R217c | W 99999, Enter | OK | 4 shapes: L[len 99999 ang=0] L[len 34.95 ang=-90] ...; dims distance=99999:d1; coinc 4; H/V 4; dof 16 | 1 |
| B-R217d | W "40abc", Enter | OK | nothing drawn; dof 0; hint "unexpected 'abc' at 2" | 0 |
| B-R217e | W "abc", Enter | OK | nothing drawn; dof 0; hint "unknown parameter 'abc' (type abc = 30 to create it)" | 0 |
| B-R218 | H 0 typed after valid W, Enter | OK | nothing drawn; dof 0; hint "A length must be more than 0." | 0 |
| B-R219 | click while a typed W is refused (W 0 typed, click at C2) | OK | nothing drawn; dof 0; hint "A length must be more than 0." | 0 |
| B-R220 | undo steps for a typed rectangle (both fields) | BUG (B-02) | 4 shapes: L[len 40 ang=0] L[len 20 ang=-90] ...; dims distance=40:d1 distance=20:d2; coinc 4; ptOnLine 1; H/V 4; dof 8 | 1 |
| B-RC01 | nothing typed: click then click (baseline) | OK | 6 shapes: L[len 99.97 ang=0] L[len 69.9 ang=-90] ...; coinc 8; ptOnLine 2; H/V 4; dof 26 | 1 |
| B-RC02 | click only, then Enter (cursor still on the first point) | FRICTION (B-14) | nothing drawn; dof 0 | 0 |
| B-RC03 | first field only (W 40), Enter | OK | 6 shapes: L[len 40 ang=0] L[len 69.9 ang=-90] ...; dims distance=40:d1; coinc 8; ptOnLine 2; H/V 4; dof 26 | 1 |
| B-RC04 | second field only (Tab, H 20), Enter | BUG (B-02) | 6 shapes: L[len 99.97 ang=0] L[len 20 ang=-90] ...; dims distance=20:d1; coinc 8; ptOnLine 3; H/V 4; dof 13 | 1 |
| B-RC05 | both fields (W 40, H 20), Enter | BUG (B-02) | 6 shapes: L[len 40 ang=0] L[len 20 ang=-90] ...; dims distance=40:d1 distance=20:d2; coinc 8; ptOnLine 3; H/V 4; dof 13 | 1 |
| B-RC06 | W 40 then retyped 25, Enter | OK | 6 shapes: L[len 25 ang=0] L[len 69.9 ang=-90] ...; dims distance=25:d1; coinc 8; ptOnLine 2; H/V 4; dof 26 | 1 |
| B-RC07 | W 40 then Backspace x2 (empty): unlocks? then cursor to C2b, Enter | OK | 6 shapes: L[len 70.03 ang=-180] L[len 29.91 ang=90] ...; coinc 8; ptOnLine 2; H/V 4; dof 26 | 1 |
| B-RC08 | W 40 H 20 typed, then the mouse moves to the OPPOSITE quadrant, Enter: size holds, side follows | BUG (B-02) | 6 shapes: L[len 40 ang=-180] L[len 20 ang=90] ...; dims distance=40:d1 distance=20:d2; coinc 8; ptOnLine 3; H/V 4; dof 13 | 1 |
| B-RC09 | W 40 H 20 typed, commit by CLICK at C2 | OK | 6 shapes: L[len 40 ang=0] L[len 20 ang=-90] ...; dims distance=40:d1 distance=20:d2; coinc 8; ptOnLine 2; H/V 4; dof 26 | 1 |
| B-RC10 | first click ON the origin (fixed point) + W 40 H 20: coincident with the origin | OK | 6 shapes: L[len 40 ang=0] L[len 20 ang=-90] ...; dims distance=40:d1 distance=20:d2; coinc 9; ptOnLine 2; H/V 4; dof 0 fully constrained | 1 |
| B-RC11 | first click on an existing endpoint (a line end) + W 40, Enter | OK | 7 shapes: L[len 14.93 ang=-90] L[len 40 ang=0] ...; dims distance=40:d1; coinc 9; ptOnLine 2; H/V 5; dof 30 | 2 |
| B-RC12 | typed W 40 H 20 while the cursor sits on an existing point (snap): typed size wins, no coincident | OK | 7 shapes: L[len 20 ang=0] L[len 40 ang=0] ...; dims distance=40:d1 distance=20:d2; coinc 9; ptOnLine 2; H/V 5; dof 4 | 2 |
| B-RC13 | formula: a named dim d1 first, then W "d1 / 2", H "d1 / 4" | OK | 7 shapes: L[len 40 ang=0] L[len 20 ang=0] ...; dims distance=40:d1 distance=20{d1 distance=10{d1; coinc 8; ptOnLine 2; H/V 4; dof 30 | 2 |
| B-RC14 | names: W "w = 50", H "h = 30" | OK | 6 shapes: L[len 50 ang=0] L[len 30 ang=-90] ...; dims distance=50:w distance=30:h; coinc 8; ptOnLine 2; H/V 4; dof 26 | 1 |
| B-RC15 | existing parameter: rect 1 "w = 50" then rect 2 with W "w" and H "w / 2" | OK | 12 shapes: L[len 50 ang=0] L[len 30 ang=-90] ...; dims distance=50:w distance=30:d1 distance=50{w}:d2 distance=25{w; coinc 16; ptOnLine 4; H/V 8; dof 52 | 2 |
| B-RC16a | units W "2 in" in an mm document, Enter | OK | 6 shapes: L[len 50.8 ang=0] L[len 69.9 ang=-90] ...; dims distance=50.8:d1; coinc 8; ptOnLine 2; H/V 4; dof 26 | 1 |
| B-RC16b | units W "25.4mm" in an mm document, Enter | OK | 6 shapes: L[len 25.4 ang=0] L[len 69.9 ang=-90] ...; dims distance=25.4:d1; coinc 8; ptOnLine 2; H/V 4; dof 26 | 1 |
| B-RC16c | units W 1/2" in an mm document, Enter | OK | 6 shapes: L[len 12.7 ang=0] L[len 69.9 ang=-90] ...; dims distance=12.7:d1; coinc 8; ptOnLine 2; H/V 4; dof 26 | 1 |
| B-RC17a | W 0, Enter | OK | nothing drawn; dof 0; hint "A length must be more than 0." | 0 |
| B-RC17b | W -5, Enter | OK | nothing drawn; dof 0; hint "A length must be more than 0." | 0 |
| B-RC17c | W 99999, Enter | OK | 6 shapes: L[len 99999 ang=0] L[len 69.9 ang=-90] ...; dims distance=99999:d1; coinc 8; ptOnLine 2; H/V 4; dof 26 | 1 |
| B-RC17d | W "40abc", Enter | OK | nothing drawn; dof 0; hint "unexpected 'abc' at 2" | 0 |
| B-RC17e | W "abc", Enter | OK | nothing drawn; dof 0; hint "unknown parameter 'abc' (type abc = 30 to create it)" | 0 |
| B-RC18 | H 0 typed after valid W, Enter | OK | nothing drawn; dof 0; hint "A length must be more than 0." | 0 |
| B-RC19 | click while a typed W is refused (W 0 typed, click at C2) | OK | nothing drawn; dof 0; hint "A length must be more than 0." | 0 |
| B-RC20 | undo steps for a typed rectangle (both fields) | BUG (B-02) | 6 shapes: L[len 40 ang=0] L[len 20 ang=-90] ...; dims distance=40:d1 distance=20:d2; coinc 8; ptOnLine 3; H/V 4; dof 13 | 1 |
| B-R202b | click, Enter (refused, no size), then move: is the box still there? then click C2 | FRICTION (B-14) | 4 shapes: L[len 49.98 ang=0] L[len 34.95 ang=-90] ...; coinc 4; H/V 4; dof 16 | 1 |
| B-RC02b | click, Enter (refused, no size), then move: is the box still there? then click C2 | FRICTION (B-14) | 6 shapes: L[len 99.97 ang=0] L[len 69.9 ang=-90] ...; coinc 8; ptOnLine 2; H/V 4; dof 26 | 1 |

### Rectangle: 3-point

| id | combination | verdict | result (final state; the box and hint are in the probe log) | undo |
|---|---|---|---|---|
| B-R301 | nothing typed: click, click, click (baseline) | OK | 4 shapes: L[len 50 ang=0] L[len 30 ang=-90] ...; coinc 4; ptOnLine 2; dof 12 | 1 |
| B-R302 | after click 1: does a box open on its own? | DIVERGENCE (B-03) | nothing drawn; dof 0 | 0 |
| B-R303 | after click 1: type 40 (opens a box?), Enter | BUG (B-03) | nothing drawn; dof 0 | 0 |
| B-R304 | after click 1: type 40, Tab, 20, Enter | BUG (B-03) | nothing drawn; dof 0 | 0 |
| B-R305 | after click 2 (base set): box open? | DIVERGENCE (B-03) | nothing drawn; dof 0 | 0 |
| B-R306 | after click 2: type 20 (height), Enter | BUG (B-03) | 4 shapes: L[len 50 ang=0] L[len 30 ang=-90] ...; coinc 4; ptOnLine 2; dof 12 | 1 |
| B-R307 | after click 2: type 20 (height), commit by CLICK at B3 | BUG (B-03) | 4 shapes: L[len 50 ang=0] L[len 30 ang=-90] ...; coinc 4; ptOnLine 2; dof 12 | 1 |
| B-R308 | after click 2: type 40 Tab 20 Enter (a dual box on the third step?) | BUG (B-03) | nothing drawn; dof 0 | 0 |
| B-R309 | after click 2: type 0, Enter | BUG (B-03) | 4 shapes: L[len 50 ang=0] L[len 30 ang=-90] ...; coinc 4; ptOnLine 2; dof 12 | 1 |
| B-R310 | after click 2: formula/name: "h = 20" | BUG (B-03) | nothing drawn; dof 0 | 0 |
| B-R311 | first and second click on existing points (snap): coincidents made | OK | 5 shapes: L[len 14.99 ang=-90] L[len 50.04 ang=0] ...; coinc 6; ptOnLine 1; H/V 1; dof 18 | 2 |

### Circle (diameter)

| id | combination | verdict | result (final state; the box and hint are in the probe log) | undo |
|---|---|---|---|---|
| B-X08 | Tab inside the single box, then Enter: what takes the focus / does a toolbar button fire? | FRICTION (B-15) | nothing drawn; dof 0 | 0 |
| B-C01 | nothing typed: click then click (baseline) | OK | 1 shape: C[r=40 c=-30,0]; ptOnLine 1; dof 1 | 1 |
| B-C02 | click only, then Enter (cursor still on the centre) | OK | nothing drawn; dof 0 | 0 |
| B-C03 | diameter only (60), Enter | OK | 1 shape: C[r=30 c=-30,0]; dims distance=60:d1Ø; ptOnLine 1; dof 1 | 1 |
| B-C04 | second field: none (a single box). Tab inside the box: where does focus go? | FRICTION (B-15) | nothing drawn; dof 0 | 0 |
| B-C05 | diameter 60 then retyped 20, Enter | OK | 1 shape: C[r=10 c=-30,0]; dims distance=20:d1Ø; ptOnLine 1; dof 1 | 1 |
| B-C06 | diameter 60 then Backspace x2 (empty): unlocks? cursor to R2, Enter | BUG (B-01) | 1 shape: C[r=3 c=-30,0]; dims distance=6:d1Ø; ptOnLine 1; dof 1 | 1 |
| B-C07 | diameter 60 typed, mouse moved far (R2): lock holds | OK | 1 shape: C[r=30 c=-30,0]; dims distance=60:d1Ø; ptOnLine 1; dof 1 | 1 |
| B-C08 | diameter 60 typed, commit by CLICK at R1 | OK | 1 shape: C[r=30 c=-30,0]; dims distance=60:d1Ø; ptOnLine 1; dof 1 | 1 |
| B-C09 | centre click ON an existing point + diameter 60, Enter: coincident (BUG-183) | OK | 2 shapes: L[len 24.95 ang=90] C[r=30 c=-29.97,0]; dims distance=60:d1Ø; coinc 1; ptOnLine 1; H/V 1; dof 4 | 2 |
| B-C10 | centre click on an existing point + diameter 60, commit by CLICK | OK | 2 shapes: L[len 24.95 ang=90] C[r=30 c=-29.97,0]; dims distance=60:d1Ø; coinc 1; ptOnLine 1; H/V 1; dof 4 | 2 |
| B-C11 | rim click on an existing point, NOTHING typed: point on the circle | OK | 2 shapes: L[len 10 ang=-90] C[r=40 c=-30,20]; ptOnLine 1; H/V 1; dof 6 | 2 |
| B-C12 | rim click on an existing point with a TYPED diameter that differs: typed wins, no constraint | OK | 2 shapes: L[len 10 ang=-90] C[r=15 c=-30,20]; dims distance=30:d1Ø; H/V 1; dof 6 | 2 |
| B-C13 | centre on the FIXED origin + typed diameter 60 (over-constrain risk: circle centre fixed) | OK | 1 shape: C[r=30 c=0,0]; dims distance=60:d1Ø; coinc 1; dof 0 fully constrained | 1 |
| B-C14 | formula "d1 / 2" (d1 = a line of 40 first) | OK | 2 shapes: L[len 40 ang=0] C[r=10 c=-30,0]; dims distance=40:d1 distance=20{d1; ptOnLine 1; dof 5 | 2 |
| B-C15 | name "dia = 50" | OK | 1 shape: C[r=25 c=-30,0]; dims distance=50:diaØ; ptOnLine 1; dof 1 | 1 |
| B-C16 | existing parameter: circle 1 "dia = 50", circle 2 "dia" | OK | 2 shapes: C[r=25 c=-30,0] C[r=25 c=60,0]; dims distance=50:diaØ distance=50{dia}:d1Ø; ptOnLine 2; dof 2 | 2 |
| B-C17a | units: Ø "2 in" (diameter) | OK | 1 shape: C[r=25.4 c=-30,0]; dims distance=50.8:d1Ø; ptOnLine 1; dof 1 | 1 |
| B-C17b | units: Ø "25.4mm" (diameter) | OK | 1 shape: C[r=12.7 c=-30,0]; dims distance=25.4:d1Ø; ptOnLine 1; dof 1 | 1 |
| B-C17c | units: Ø 1/2" (diameter) | OK | 1 shape: C[r=6.35 c=-30,0]; dims distance=12.7:d1Ø; ptOnLine 1; dof 1 | 1 |
| B-C18a | diameter 0, Enter | OK | nothing drawn; dof 0; hint "A length must be more than 0." | 0 |
| B-C18b | diameter -5, Enter | OK | nothing drawn; dof 0; hint "A length must be more than 0." | 0 |
| B-C18c | diameter 99999, Enter | OK | 1 shape: C[r=49999.5 c=-30,0]; dims distance=99999:d1Ø; ptOnLine 1; dof 1 | 1 |
| B-C18d | diameter "40abc", Enter | OK | nothing drawn; dof 0; hint "unexpected 'abc' at 2" | 0 |
| B-C18e | diameter "abc", Enter | OK | nothing drawn; dof 0; hint "unknown parameter 'abc' (type abc = 30 to create it)" | 0 |
| B-C19 | box shows the live diameter while the mouse moves (before typing) | OK | nothing drawn; dof 0 | 0 |

### Arc (radius, then sweep)

| id | combination | verdict | result (final state; the box and hint are in the probe log) | undo |
|---|---|---|---|---|
| B-X09 | radius 25, Backspace x2 (empty), commit the START by CLICK at the cursor (radius 40): unlocked? | BUG (B-01) | 1 shape: arc[-30,0 -28,0 -30,-2]; dims distance=2:d1R; ptOnLine 1; dof 4 | 1 |
| B-X10 | sweep 90, Backspace x2 (empty), Enter: unlocked (box then holds nothing)? | OK | 1 shape: arc[-30,0 10,0 -6.7,-32.52]; ptOnLine 2; dof 4 | 1 |
| B-X11 | radius "rr = 25" (a legal name) | OK | 1 shape: arc[-30,0 -5,0 -30,-25]; dims distance=25:rrR; ptOnLine 1; dof 4 | 1 |
| B-A01 | nothing typed: click centre, click start, click end (baseline) | OK | 1 shape: arc[-30,0 10,0 -30,-40]; ptOnLine 2; dof 4 | 1 |
| B-A02 | centre click only, then Enter (cursor on the centre) | OK | nothing drawn; dof 0 | 0 |
| B-A03 | radius only (25), Enter: sweep box follows? then click end | OK | 1 shape: arc[-30,0 -5,0 -30,-25]; dims distance=25:d1R; ptOnLine 1; dof 4 | 1 |
| B-A04 | radius 25 Enter, then sweep only (90) Enter | DIVERGENCE (B-12) | 1 shape: arc[-30,0 -5,0 -30,-25]; dims distance=25:d1R; ptOnLine 1; dof 4 | 1 |
| B-A05 | radius NOT typed (cursor radius 40), start by click, sweep 120 typed, Enter | DIVERGENCE (B-12) | 1 shape: arc[-30,0 10,0 -50,-34.64]; ptOnLine 2; dof 4 | 1 |
| B-A06 | radius 25 then retyped 35, Enter, sweep 90 Enter | OK | 1 shape: arc[-30,0 5,0 -30,-35]; dims distance=35:d1R; ptOnLine 1; dof 5 | 1 |
| B-A07 | radius 25 then Backspace x2 (empty): unlocks? cursor radius 40, Enter then click end | OK | 1 shape: arc[-30,0 10,0 -30,-40]; ptOnLine 1; dof 5 | 1 |
| B-A08 | radius 25 typed, mouse moved to another direction (R2), Enter: start follows the cursor direction | OK | 1 shape: arc[-30,0 -30,-25 -5.19,-3.1]; dims distance=25:d1R; ptOnLine 1; dof 4 | 1 |
| B-A09 | radius 25 typed, commit the start by CLICK (not Enter), then end by click | OK | 1 shape: arc[-30,0 -5,0 -30,-25]; dims distance=25:d1R; ptOnLine 1; dof 4 | 1 |
| B-A10 | sweep 90 typed, commit by CLICK at the end cursor | DIVERGENCE (B-12) | 1 shape: arc[-30,0 10,0 -30,-40]; ptOnLine 2; dof 4 | 1 |
| B-A11 | sweep typed then Backspace x2 (empty), then click end: unlocks? | BUG (B-01) | 1 shape: arc[-30,0 10,0 9.51,-6.26]; ptOnLine 2; dof 4 | 1 |
| B-A12 | centre click ON an existing point + radius 25 typed | OK | 2 shapes: L[len 24.95 ang=90] arc[-29.97,0 -4.97,0 -29.99,-25]; dims distance=25:d1R; coinc 1; ptOnLine 1; H/V 1; dof 8 | 2 |
| B-A13 | start click on an existing point, NO radius typed (control), end click | OK | 2 shapes: L[len 24.95 ang=90] arc[-30,0 9.99,0 -30,-39.99]; coinc 1; ptOnLine 2; H/V 1; dof 7 | 2 |
| B-A14 | radius typed 25, start click on an existing point 40 away: typed wins, no constraint | OK | 2 shapes: L[len 24.95 ang=90] arc[-30,0 -5,0 -30,-25]; dims distance=25:d1R; ptOnLine 2; H/V 1; dof 7 | 2 |
| B-A15 | formula "d1 / 2" as radius | OK | 2 shapes: L[len 40 ang=0] arc[-30,0 -10,0 -30,-20]; dims distance=40:d1 distance=20{d1; ptOnLine 1; dof 8 | 2 |
| B-A16 | name "rad = 25" as radius | OK | nothing drawn; dof 0; hint "'rad' is a unit name" | 0 |
| B-A17 | sweep formula "360 / 4" and name "sw = 90" | DIVERGENCE (B-13) | nothing drawn; dof 0 | 0 |
| B-A18a | units: radius "1 in" | OK | 1 shape: arc[-30,0 -4.6,0 -30,-25.4]; dims distance=25.4:d1R; ptOnLine 1; dof 4 | 1 |
| B-A18b | units: radius "12.7mm" | OK | 1 shape: arc[-30,0 -17.3,0 -30,-12.7]; dims distance=12.7:d1R; ptOnLine 1; dof 4 | 1 |
| B-A18c | units: radius 1/2" | OK | 1 shape: arc[-30,0 -17.3,0 -30,-12.7]; dims distance=12.7:d1R; ptOnLine 1; dof 4 | 1 |
| B-A19a | radius 0, Enter | OK | nothing drawn; dof 0; hint "A length must be more than 0." | 0 |
| B-A19b | radius -5, Enter | OK | nothing drawn; dof 0; hint "A length must be more than 0." | 0 |
| B-A19c | radius 99999, Enter | OK | nothing drawn; dof 0 | 0 |
| B-A19d | radius "40abc", Enter | OK | nothing drawn; dof 0; hint "unexpected 'abc' at 2" | 0 |
| B-A19e | radius "abc", Enter | OK | nothing drawn; dof 0; hint "unknown parameter 'abc' (type abc = 30 to create it)" | 0 |
| B-A20a | sweep 0, Enter | BUG (B-07) | 1 shape: arc[-30,0 10,0 -6.7,-32.52]; ptOnLine 2; dof 4 | 1 |
| B-A20b | sweep -90, Enter | BUG (B-07) | 1 shape: arc[-30,0 10,0 -6.7,-32.52]; ptOnLine 2; dof 4 | 1 |
| B-A20c | sweep 360, Enter | FRICTION (B-07) | 1 shape: arc[-30,0 10,0 10,0]; ptOnLine 2; dof 4 | 1 |
| B-A20d | sweep 720, Enter | FRICTION (B-07) | 1 shape: arc[-30,0 10,0 10,0]; ptOnLine 2; dof 4 | 1 |
| B-A20e | sweep "abc", Enter | OK | nothing drawn; dof 0; hint "unknown parameter 'abc' (type abc = 30 to create it)" | 0 |
| B-A20f | sweep "90abc", Enter | OK | nothing drawn; dof 0; hint "unexpected 'abc' at 2" | 0 |
| B-A21 | box value after radius Enter is the sweep box (starts "0"?) and focus | OK | nothing drawn; dof 0 | 0 |

### Polygon (R + N)

| id | combination | verdict | result (final state; the box and hint are in the probe log) | undo |
|---|---|---|---|---|
| B-X12 | a first polygon with N 9 (remembered), then a second: N 4 typed, Backspace (empty), Enter: falls back to 9? | BUG (B-01) | 26 shapes: L[len 13.68 ang=-110] L[len 20 ang=0] ...; dims distance=20:d1 distance=20:d2; ptOnLine 2; dof 28 | 2 |
| B-P01 | nothing typed: click centre, click corner (baseline, default sides) | OK | 12 shapes: L[len 40 ang=-120] L[len 40 ang=0] ...; ptOnLine 2; dof 12 | 1 |
| B-P02 | click only, then Enter | OK | nothing drawn; dof 0 | 0 |
| B-P03 | R only (25), Enter | OK | 12 shapes: L[len 25 ang=-120] L[len 25 ang=0] ...; dims distance=25:d1; ptOnLine 1; dof 13 | 1 |
| B-P04 | N only (Tab, 5), Enter | OK | 10 shapes: L[len 47.02 ang=-126] L[len 40 ang=0] ...; ptOnLine 1; dof 11 | 1 |
| B-P05 | both (R 25, N 5), Enter | OK | 10 shapes: L[len 29.39 ang=-126] L[len 25 ang=0] ...; dims distance=25:d1; ptOnLine 1; dof 11 | 1 |
| B-P06 | R 25 then retyped 35, N 5 then retyped 7, Enter | OK | 14 shapes: L[len 30.37 ang=-115.71] L[len 35 ang=0] ...; dims distance=35:d1; ptOnLine 1; dof 15 | 1 |
| B-P07 | R 25 and N 5 typed, then Backspace both to empty, Enter: unlock both? | OK | 10 shapes: L[len 47.02 ang=-126] L[len 40 ang=0] ...; ptOnLine 1; dof 11 | 1 |
| B-P08 | R 25 typed, mouse moved to R2 direction: size holds, rotation follows | OK | 10 shapes: L[len 29.39 ang=-36] L[len 25 ang=90] ...; dims distance=25:d1; ptOnLine 1; dof 10 | 1 |
| B-P09 | R 25 N 5 typed, commit by CLICK at R1 | OK | 10 shapes: L[len 29.39 ang=-126] L[len 25 ang=0] ...; dims distance=25:d1; ptOnLine 1; dof 11 | 1 |
| B-P10 | centre click ON an existing point + R 25, Enter (coincident) | OK | 11 shapes: L[len 24.95 ang=90] L[len 29.39 ang=-126] ...; dims distance=25:d1; coinc 1; ptOnLine 1; H/V 1; dof 14 | 2 |
| B-P11 | corner click on an existing point, NOTHING typed (control) | OK | 11 shapes: L[len 24.95 ang=90] L[len 47.01 ang=-126] ...; coinc 1; ptOnLine 2; H/V 1; dof 13 | 2 |
| B-P12 | corner click on an existing point with R 25 typed (differs): typed wins | OK | 11 shapes: L[len 24.95 ang=90] L[len 29.39 ang=-126] ...; dims distance=25:d1; ptOnLine 2; H/V 1; dof 14 | 2 |
| B-P13 | formula R "d1 / 2" and N "d1 / 8" | FRICTION (B-17, R1-16) | 1 shape: L[len 40 ang=0]; dims distance=40:d1; dof 4; hint "a plain number cannot be a length" | 1 |
| B-P14 | name R "pr = 25" | OK | 10 shapes: L[len 29.39 ang=-126] L[len 25 ang=0] ...; dims distance=25:pr; ptOnLine 1; dof 11 | 1 |
| B-P15 | name N "n = 6": a name in the count field | DIVERGENCE (B-13) | nothing drawn; dof 0 | 0 |
| B-P16a | units: R "1 in" | OK | 10 shapes: L[len 29.86 ang=-126] L[len 25.4 ang=0] ...; dims distance=25.4:d1; ptOnLine 1; dof 11 | 1 |
| B-P16b | units: R "12.7mm" | OK | 10 shapes: L[len 14.93 ang=-126] L[len 12.7 ang=0] ...; dims distance=12.7:d1; ptOnLine 1; dof 11 | 1 |
| B-P16c | units: R 1/2" | OK | 10 shapes: L[len 14.93 ang=-126] L[len 12.7 ang=0] ...; dims distance=12.7:d1; ptOnLine 1; dof 11 | 1 |
| B-P17a | R 0, Enter | OK | nothing drawn; dof 0; hint "A length must be more than 0." | 0 |
| B-P17b | R -5, Enter | OK | nothing drawn; dof 0; hint "A length must be more than 0." | 0 |
| B-P17c | R 99999, Enter | OK | 10 shapes: L[len 117555.87 ang=-126] L[len 99999 ang=0] ...; dims distance=99999:d1; ptOnLine 1; dof 11 | 1 |
| B-P17d | R "40abc", Enter | OK | nothing drawn; dof 0; hint "unexpected 'abc' at 2" | 0 |
| B-P17e | R "abc", Enter | OK | nothing drawn; dof 0; hint "unknown parameter 'abc' (type abc = 30 to create it)" | 0 |
| B-P18a | N 2 (below min), Enter (R 25) | FRICTION (B-16) | 6 shapes: L[len 43.3 ang=-150] L[len 25 ang=0] ...; dims distance=25:d1; ptOnLine 1; dof 7 | 1 |
| B-P18b | N 3, Enter (R 25) | OK | 6 shapes: L[len 43.3 ang=-150] L[len 25 ang=0] ...; dims distance=25:d1; ptOnLine 1; dof 7 | 1 |
| B-P18c | N 64, Enter (R 25) | OK | 128 shapes: L[len 2.45 ang=-92.81] L[len 25 ang=0] ...; dims distance=25:d1; ptOnLine 1; dof 129 | 1 |
| B-P18d | N 65 (above max), Enter (R 25) | FRICTION (B-16) | 128 shapes: L[len 2.45 ang=-92.81] L[len 25 ang=0] ...; dims distance=25:d1; ptOnLine 1; dof 129 | 1 |
| B-P18e | N 0, Enter (R 25) | FRICTION (B-16) | 6 shapes: L[len 43.3 ang=-150] L[len 25 ang=0] ...; dims distance=25:d1; ptOnLine 1; dof 7 | 1 |
| B-P18f | N -5, Enter (R 25) | FRICTION (B-16) | 6 shapes: L[len 43.3 ang=-150] L[len 25 ang=0] ...; dims distance=25:d1; ptOnLine 1; dof 7 | 1 |
| B-P18g | N 5.5, Enter (R 25) | FRICTION (B-16) | 12 shapes: L[len 25 ang=-120] L[len 25 ang=0] ...; dims distance=25:d1; ptOnLine 1; dof 13 | 1 |
| B-P18h | N "abc", Enter (R 25) | OK | nothing drawn; dof 0; hint "unknown parameter 'abc' (type abc = 30 to create it)" | 0 |
| B-P18i | N "1e1", Enter (R 25) | OK | 20 shapes: L[len 15.45 ang=-108] L[len 25 ang=0] ...; dims distance=25:d1; ptOnLine 1; dof 21 | 1 |
| B-P19 | the next polygon: does the N box carry the last count (5)? | OK | 20 shapes: L[len 29.39 ang=-126] L[len 25 ang=0] ...; dims distance=25:d1; ptOnLine 3; dof 21 | 2 |

### Slot: centre-to-centre

| id | combination | verdict | result (final state; the box and hint are in the probe log) | undo |
|---|---|---|---|---|
| B-C2C01 | nothing typed: click, click, click (baseline) | OK | 5 shapes: L[len 49.3 ang=23.88] arc[-4.99,-14.97 5.41,8.51 -15.39,-38.46] ...; dims distance=51.37:d1Ø; tang 4; dof 12 | 1 |
| B-C2C02 | click only (span box), Enter with no length | OK | nothing drawn; dof 0 | 0 |
| B-C2C03 | span only (40), Enter, then width by click | OK | 5 shapes: L[len 40 ang=23.88] arc[-13.49,-11.21 -3.09,12.28 -23.89,-34.69] ...; dims distance=51.37:d1Ø distance=40:d2; tang 4; dof 12 | 1 |
| B-C2C04 | width only (12): spans by click, width typed, Enter | OK | 5 shapes: L[len 49.3 ang=23.88] arc[-4.99,-14.97 -2.56,-9.49 -7.42,-20.46] ...; dims distance=12:d1Ø; tang 4; dof 12 | 1 |
| B-C2C05 | both: span 40 Enter, width 12 Enter | OK | 5 shapes: L[len 40 ang=23.88] arc[-13.49,-11.21 -11.06,-5.72 -15.92,-16.69] ...; dims distance=12:d1Ø distance=40:d2; tang 4; dof 12 | 1 |
| B-C2C06 | span 40 then retyped 25, Enter, width by click | OK | 5 shapes: L[len 25 ang=23.88] arc[-27.21,-5.13 -16.81,18.35 -37.61,-28.62] ...; dims distance=51.37:d1Ø distance=25:d2; tang 4; dof 12 | 1 |
| B-C2C07 | span 40 then Backspace x2 (empty): unlocks, then click the end | BUG (B-01) | 5 shapes: L[len 4 ang=23.88] arc[-46.41,3.37 -36.01,26.85 -56.81,-20.12] ...; dims distance=51.37:d1Ø distance=4:d2; tang 4; dof 12 | 1 |
| B-C2C08 | span 40 typed, mouse moved to the other quadrant (-80,-20): lock holds, direction follows | OK | 5 shapes: L[len 40 ang=140.15] arc[-80.77,-20.65 -79.96,-21.62 -81.59,-19.67] ...; dims distance=2.54:d1Ø distance=40:d2; tang 4; dof 12 | 1 |
| B-C2C09 | span 40 typed, advance by CLICK (not Enter), width by click | OK | 5 shapes: L[len 40 ang=23.88] arc[-13.49,-11.21 -3.09,12.28 -23.89,-34.69] ...; dims distance=51.37:d1Ø distance=40:d2; tang 4; dof 12 | 1 |
| B-C2C10 | width 12 typed, commit by CLICK | OK | 5 shapes: L[len 49.3 ang=23.88] arc[-4.99,-14.97 -2.56,-9.49 -7.42,-20.46] ...; dims distance=12:d1Ø; tang 4; dof 12 | 1 |
| B-C2C11 | first click ON an existing point (coincident), second click on another existing point + typed span that differs | OK | 7 shapes: L[len 24.99 ang=90] L[len 40 ang=-90] ...; dims distance=26.03:d1Ø distance=40:d2; coinc 1; H/V 2; tang 4; dof 20 | 3 |
| B-C2C12 | second click on an existing point, NOTHING typed (control) | OK | 6 shapes: L[len 40 ang=-90] L[len 111.08 ang=-7.77] ...; dims distance=26.02:d1Ø; coinc 1; H/V 1; tang 4; dof 16 | 2 |
| B-C2C13 | H inference: cursor exactly horizontal, typed span 40 [R1-08, task 1021] | BUG (B-11, R1-08) | 5 shapes: L[len 40 ang=0] arc[-10.07,4.99 -10.07,21.95 -10.07,-11.98] ...; dims distance=33.93:d1Ø distance=40:d2; tang 4; dof 12 | 1 |
| B-C2C14 | H inference, NOTHING typed (control): exactly horizontal click | BUG (B-11, R1-08) | 5 shapes: L[len 50.07 ang=0] arc[0,4.99 0,21.95 0,-11.98] ...; dims distance=33.93:d1Ø; tang 4; dof 12 | 1 |
| B-C2C15 | formula: d1 = a line of 40 first, then span "d1 / 2" and width "d1 / 4" | OK | 6 shapes: L[len 40 ang=0] L[len 20 ang=23.88] ...; dims distance=40:d1 distance=10{d1 distance=20{d1; tang 4; dof 16 | 2 |
| B-C2C16 | names: span "len = 50", width "wd = 10" | OK | 5 shapes: L[len 50 ang=23.88] arc[-4.35,-15.26 -2.32,-10.69 -6.37,-19.83] ...; dims distance=10:wdØ distance=50:len; tang 4; dof 12 | 1 |
| B-C2C17 | existing parameter: slot 1 "len = 50" (span), slot 2 span "len" | OK | 10 shapes: L[len 50 ang=23.88] arc[-4.35,-15.26 -2.32,-10.69 -6.37,-19.83] ...; dims distance=10:d1Ø distance=50:len distance=23.58:d2Ø distance=50{len}:d3; tang 8; dof 24 | 2 |
| B-C2C18a | units: span "2 in" | OK | 5 shapes: L[len 50.8 ang=23.88] arc[-3.62,-15.58 6.78,7.9 -14.01,-39.07] ...; dims distance=51.37:d1Ø distance=50.8:d2; tang 4; dof 12 | 1 |
| B-C2C18b | units: span "25.4mm" | OK | 5 shapes: L[len 25.4 ang=23.88] arc[-26.84,-5.3 -16.44,18.19 -37.24,-28.78] ...; dims distance=51.37:d1Ø distance=25.4:d2; tang 4; dof 12 | 1 |
| B-C2C18c | units: span 1/2" | OK | 5 shapes: L[len 12.7 ang=23.88] arc[-38.45,-0.15 -28.05,23.33 -48.85,-23.64] ...; dims distance=51.37:d1Ø distance=12.7:d2; tang 4; dof 12 | 1 |
| B-C2C19a | span 0, Enter | OK | nothing drawn; dof 0; hint "A length must be more than 0." | 0 |
| B-C2C19b | span -5, Enter | OK | nothing drawn; dof 0; hint "A length must be more than 0." | 0 |
| B-C2C19c | span 99999, Enter | OK | nothing drawn; dof 0 | 0 |
| B-C2C19d | span "40abc", Enter | OK | nothing drawn; dof 0; hint "unexpected 'abc' at 2" | 0 |
| B-C2C19e | span "abc", Enter | OK | nothing drawn; dof 0; hint "unknown parameter 'abc' (type abc = 30 to create it)" | 0 |
| B-C2C20a | width 0, Enter | OK | nothing drawn; dof 0; hint "A length must be more than 0." | 0 |
| B-C2C20b | width -5, Enter | OK | nothing drawn; dof 0; hint "A length must be more than 0." | 0 |
| B-C2C20c | width 99999, Enter | OK | 5 shapes: L[len 49.3 ang=23.88] arc[-4.99,-14.97 20239.1,45702.93 -20249.08,-45732.88] ...; dims distance=99999:d1Ø; tang 4; dof 12 | 1 |
| B-C2C20d | width "12abc", Enter | OK | nothing drawn; dof 0; hint "unexpected 'abc' at 2" | 0 |
| B-C2C21 | width typed then Backspace x2 (empty): unlocks, commit by click | BUG (B-01) | 5 shapes: L[len 49.3 ang=23.88] arc[-4.99,-14.97 -4.78,-14.52 -5.19,-15.43] ...; dims distance=1:d1Ø; tang 4; dof 12 | 1 |
| B-C2C22 | undo-step count for a typed slot (span + width) | OK | 5 shapes: L[len 40 ang=23.88] arc[-13.49,-11.21 -11.06,-5.72 -15.92,-16.69] ...; dims distance=12:d1Ø distance=40:d2; tang 4; dof 12 | 1 |

### Slot: overall

| id | combination | verdict | result (final state; the box and hint are in the probe log) | undo |
|---|---|---|---|---|
| B-OV01 | nothing typed: click, click, click (baseline) | OK | 5 shapes: L[len 4.93 ang=23.88] arc[-25.27,-5.99 -16.29,14.29 -34.26,-26.28] ...; dims distance=44.37:d1Ø; ptOnLine 4; tang 4; dof 16 | 1 |
| B-OV02 | click only (span box), Enter with no length | OK | nothing drawn; dof 0 | 0 |
| B-OV03 | span only (40), Enter, then width by click | OK | 5 shapes: L[len 4 ang=23.88] arc[-29.95,-3.92 -22.66,12.54 -37.24,-20.38] ...; dims distance=36:d1Ø distance=40:d2; ptOnLine 4; tang 4; dof 16 | 1 |
| B-OV04 | width only (12): spans by click, width typed, Enter | OK | 5 shapes: L[len 37.3 ang=23.88] arc[-10.47,-12.54 -8.04,-7.06 -12.9,-18.03] ...; dims distance=12:d1Ø; ptOnLine 4; tang 4; dof 16 | 1 |
| B-OV05 | both: span 40 Enter, width 12 Enter | OK | 5 shapes: L[len 28 ang=23.88] arc[-18.98,-8.78 -16.55,-3.29 -21.41,-14.27] ...; dims distance=12:d1Ø distance=40:d2; ptOnLine 4; tang 4; dof 16 | 1 |
| B-OV06 | span 40 then retyped 25, Enter, width by click | OK | 5 shapes: L[len 2.5 ang=23.88] arc[-37.49,-0.58 -32.94,9.71 -42.05,-10.87] ...; dims distance=22.5:d1Ø distance=25:d2; ptOnLine 4; tang 4; dof 16 | 1 |
| B-OV07 | span 40 then Backspace x2 (empty): unlocks, then click the end | BUG (B-01) | 5 shapes: L[len 0.4 ang=23.88] arc[-48.05,4.1 -47.33,5.74 -48.78,2.45] ...; dims distance=3.6:d1Ø distance=4:d2; ptOnLine 4; tang 4; dof 16 | 1 |
| B-OV08 | span 40 typed, mouse moved to the other quadrant (-80,-20): lock holds, direction follows | OK | 5 shapes: L[len 37.46 ang=140.15] arc[-79.8,-19.83 -78.99,-20.81 -80.61,-18.86] ...; dims distance=2.54:d1Ø distance=40:d2; ptOnLine 4; tang 4; dof 16 | 1 |
| B-OV09 | span 40 typed, advance by CLICK (not Enter), width by click | OK | 5 shapes: L[len 4 ang=23.88] arc[-29.95,-3.92 -22.66,12.54 -37.24,-20.38] ...; dims distance=36:d1Ø distance=40:d2; ptOnLine 4; tang 4; dof 16 | 1 |
| B-OV10 | width 12 typed, commit by CLICK | OK | 5 shapes: L[len 37.3 ang=23.88] arc[-10.47,-12.54 -8.04,-7.06 -12.9,-18.03] ...; dims distance=12:d1Ø; ptOnLine 4; tang 4; dof 16 | 1 |
| B-OV11 | first click ON an existing point (coincident), second click on another existing point + typed span that differs | OK | 7 shapes: L[len 24.99 ang=90] L[len 40 ang=-90] ...; dims distance=26.03:d1Ø distance=40:d2; coinc 1; ptOnLine 4; H/V 2; tang 4; dof 24 | 3 |
| B-OV12 | second click on an existing point, NOTHING typed (control) | OK | 6 shapes: L[len 40 ang=-90] L[len 85.06 ang=-7.77] ...; dims distance=26.02:d1Ø; coinc 1; ptOnLine 4; H/V 1; tang 4; dof 20 | 2 |
| B-OV13 | H inference: cursor exactly horizontal, typed span 40 [R1-08, task 1021] | BUG (B-11, R1-08) | 5 shapes: L[len 6.07 ang=0] arc[-27.03,4.99 -27.03,21.95 -27.03,-11.98] ...; dims distance=33.93:d1Ø distance=40:d2; ptOnLine 4; tang 4; dof 16 | 1 |
| B-OV14 | H inference, NOTHING typed (control): exactly horizontal click | BUG (B-11, R1-08) | 5 shapes: L[len 16.14 ang=0] arc[-16.96,4.99 -16.96,21.95 -16.96,-11.98] ...; dims distance=33.93:d1Ø; ptOnLine 4; tang 4; dof 16 | 1 |
| B-OV15 | formula: d1 = a line of 40 first, then span "d1 / 2" and width "d1 / 4" | OK | 6 shapes: L[len 40 ang=0] L[len 10 ang=23.88] ...; dims distance=40:d1 distance=10{d1 distance=20{d1; ptOnLine 4; tang 4; dof 20 | 2 |
| B-OV16 | names: span "len = 50", width "wd = 10" | OK | 5 shapes: L[len 40 ang=23.88] arc[-8.92,-13.23 -6.89,-8.66 -10.94,-17.8] ...; dims distance=10:wdØ distance=50:len; ptOnLine 4; tang 4; dof 16 | 1 |
| B-OV17 | existing parameter: slot 1 "len = 50" (span), slot 2 span "len" | OK | 10 shapes: L[len 40 ang=23.88] arc[-8.92,-13.23 -6.89,-8.66 -10.94,-17.8] ...; dims distance=10:d1Ø distance=50:len distance=23.58:d2Ø distance=50{len}:d3; ptOnLine 8; tang 8; dof 32 | 2 |
| B-OV18a | units: span "2 in" | OK | 5 shapes: L[len 5.08 ang=23.88] arc[-24.52,-6.33 -15.26,14.58 -33.77,-27.23] ...; dims distance=45.72:d1Ø distance=50.8:d2; ptOnLine 4; tang 4; dof 16 | 1 |
| B-OV18b | units: span "25.4mm" | OK | 5 shapes: L[len 2.54 ang=23.88] arc[-37.29,-0.67 -32.66,9.78 -41.92,-11.12] ...; dims distance=22.86:d1Ø distance=25.4:d2; ptOnLine 4; tang 4; dof 16 | 1 |
| B-OV18c | units: span 1/2" | OK | 5 shapes: L[len 1.27 ang=23.88] arc[-43.68,2.16 -41.36,7.38 -45.99,-3.07] ...; dims distance=11.43:d1Ø distance=12.7:d2; ptOnLine 4; tang 4; dof 16 | 1 |
| B-OV19a | span 0, Enter | OK | nothing drawn; dof 0; hint "A length must be more than 0." | 0 |
| B-OV19b | span -5, Enter | OK | nothing drawn; dof 0; hint "A length must be more than 0." | 0 |
| B-OV19c | span 99999, Enter | OK | nothing drawn; dof 0 | 0 |
| B-OV19d | span "40abc", Enter | OK | nothing drawn; dof 0; hint "unexpected 'abc' at 2" | 0 |
| B-OV19e | span "abc", Enter | OK | nothing drawn; dof 0; hint "unknown parameter 'abc' (type abc = 30 to create it)" | 0 |
| B-OV20a | width 0, Enter | OK | nothing drawn; dof 0; hint "A length must be more than 0." | 0 |
| B-OV20b | width -5, Enter | OK | nothing drawn; dof 0; hint "A length must be more than 0." | 0 |
| B-OV20c | width 99999, Enter | OK | 5 shapes: L[len 4.93 ang=23.88] arc[-25.27,-5.99 -16.29,14.29 -34.26,-26.28] ...; dims distance=44.37:d1Ø; ptOnLine 4; tang 4; dof 16 | 1 |
| B-OV20d | width "12abc", Enter | OK | nothing drawn; dof 0; hint "unexpected 'abc' at 2" | 0 |
| B-OV21 | width typed then Backspace x2 (empty): unlocks, commit by click | BUG (B-01) | 5 shapes: L[len 48.3 ang=23.88] arc[-5.44,-14.77 -5.24,-14.31 -5.65,-15.23] ...; dims distance=1:d1Ø; ptOnLine 4; tang 4; dof 16 | 1 |
| B-OV22 | undo-step count for a typed slot (span + width) | OK | 5 shapes: L[len 28 ang=23.88] arc[-18.98,-8.78 -16.55,-3.29 -21.41,-14.27] ...; dims distance=12:d1Ø distance=40:d2; ptOnLine 4; tang 4; dof 16 | 1 |

### Slot: centre point

| id | combination | verdict | result (final state; the box and hint are in the probe log) | undo |
|---|---|---|---|---|
| B-CP01 | nothing typed: click, click, click (baseline) | OK | 5 shapes: L[len 98.6 ang=23.88] arc[-4.99,-14.97 5.41,8.51 -15.39,-38.46] ...; dims distance=51.37:d1Ø; tang 4; dof 14 | 1 |
| B-CP02 | click only (span box), Enter with no length | OK | nothing drawn; dof 0 | 0 |
| B-CP03 | span only (40), Enter, then width by click | OK | 5 shapes: L[len 40 ang=23.88] arc[-31.78,-3.11 -21.38,20.37 -42.18,-26.59] ...; dims distance=51.37:d1Ø distance=40:d2; tang 4; dof 14 | 1 |
| B-CP04 | width only (12): spans by click, width typed, Enter | OK | 5 shapes: L[len 98.6 ang=23.88] arc[-4.99,-14.97 -2.56,-9.49 -7.42,-20.46] ...; dims distance=12:d1Ø; tang 4; dof 14 | 1 |
| B-CP05 | both: span 40 Enter, width 12 Enter | OK | 5 shapes: L[len 40 ang=23.88] arc[-31.78,-3.11 -29.35,2.38 -34.21,-8.6] ...; dims distance=12:d1Ø distance=40:d2; tang 4; dof 14 | 1 |
| B-CP06 | span 40 then retyped 25, Enter, width by click | OK | 5 shapes: L[len 25 ang=23.88] arc[-38.64,-0.07 -28.24,23.41 -49.04,-23.56] ...; dims distance=51.37:d1Ø distance=25:d2; tang 4; dof 14 | 1 |
| B-CP07 | span 40 then Backspace x2 (empty): unlocks, then click the end | BUG (B-01) | 5 shapes: L[len 4 ang=23.88] arc[-48.24,4.18 -37.84,27.66 -58.64,-19.31] ...; dims distance=51.37:d1Ø distance=4:d2; tang 4; dof 14 | 1 |
| B-CP08 | span 40 typed, mouse moved to the other quadrant (-80,-20): lock holds, direction follows | OK | 5 shapes: L[len 40 ang=140.15] arc[-65.42,-7.83 -64.61,-8.8 -66.23,-6.86] ...; dims distance=2.54:d1Ø distance=40:d2; tang 4; dof 14 | 1 |
| B-CP09 | span 40 typed, advance by CLICK (not Enter), width by click | OK | 5 shapes: L[len 40 ang=23.88] arc[-31.78,-3.11 -21.38,20.37 -42.18,-26.59] ...; dims distance=51.37:d1Ø distance=40:d2; tang 4; dof 14 | 1 |
| B-CP10 | width 12 typed, commit by CLICK | OK | 5 shapes: L[len 98.6 ang=23.88] arc[-4.99,-14.97 -2.56,-9.49 -7.42,-20.46] ...; dims distance=12:d1Ø; tang 4; dof 14 | 1 |
| B-CP11 | first click ON an existing point (coincident), second click on another existing point + typed span that differs | OK | 7 shapes: L[len 24.99 ang=90] L[len 40 ang=-90] ...; dims distance=26.03:d1Ø distance=40:d2; coinc 1; H/V 2; tang 4; dof 22 | 3 |
| B-CP12 | second click on an existing point, NOTHING typed (control) | OK | 6 shapes: L[len 40 ang=-90] L[len 222.17 ang=-7.77] ...; dims distance=26.02:d1Ø; coinc 1; H/V 1; tang 4; dof 18 | 2 |
| B-CP13 | H inference: cursor exactly horizontal, typed span 40 [R1-08, task 1021] | BUG (B-11, R1-08) | 5 shapes: L[len 40 ang=0] arc[-30.07,4.99 -30.07,21.95 -30.07,-11.98] ...; dims distance=33.93:d1Ø distance=40:d2; tang 4; dof 14 | 1 |
| B-CP14 | H inference, NOTHING typed (control): exactly horizontal click | BUG (B-11, R1-08) | 5 shapes: L[len 100.14 ang=0] arc[0,4.99 0,21.95 0,-11.98] ...; dims distance=33.93:d1Ø; tang 4; dof 14 | 1 |
| B-CP15 | formula: d1 = a line of 40 first, then span "d1 / 2" and width "d1 / 4" | OK | 6 shapes: L[len 40 ang=0] L[len 20 ang=23.88] ...; dims distance=40:d1 distance=10{d1 distance=20{d1; tang 4; dof 18 | 2 |
| B-CP16 | names: span "len = 50", width "wd = 10" | OK | 5 shapes: L[len 50 ang=23.88] arc[-27.21,-5.13 -25.18,-0.56 -29.23,-9.71] ...; dims distance=10:wdØ distance=50:len; tang 4; dof 14 | 1 |
| B-CP17 | existing parameter: slot 1 "len = 50" (span), slot 2 span "len" | OK | 10 shapes: L[len 50 ang=23.88] arc[-27.21,-5.13 -25.18,-0.56 -29.23,-9.71] ...; dims distance=10:d1Ø distance=50:len distance=23.58:d2Ø distance=50{len}:d3; tang 8; dof 28 | 2 |
| B-CP18a | units: span "2 in" | OK | 5 shapes: L[len 50.8 ang=23.88] arc[-26.84,-5.3 -16.44,18.19 -37.24,-28.78] ...; dims distance=51.37:d1Ø distance=50.8:d2; tang 4; dof 14 | 1 |
| B-CP18b | units: span "25.4mm" | OK | 5 shapes: L[len 25.4 ang=23.88] arc[-38.45,-0.15 -28.05,23.33 -48.85,-23.64] ...; dims distance=51.37:d1Ø distance=25.4:d2; tang 4; dof 14 | 1 |
| B-CP18c | units: span 1/2" | OK | 5 shapes: L[len 12.7 ang=23.88] arc[-44.26,2.42 -33.86,25.9 -54.66,-21.07] ...; dims distance=51.37:d1Ø distance=12.7:d2; tang 4; dof 14 | 1 |
| B-CP19a | span 0, Enter | OK | nothing drawn; dof 0; hint "A length must be more than 0." | 0 |
| B-CP19b | span -5, Enter | OK | nothing drawn; dof 0; hint "A length must be more than 0." | 0 |
| B-CP19c | span 99999, Enter | OK | nothing drawn; dof 0 | 0 |
| B-CP19d | span "40abc", Enter | OK | nothing drawn; dof 0; hint "unexpected 'abc' at 2" | 0 |
| B-CP19e | span "abc", Enter | OK | nothing drawn; dof 0; hint "unknown parameter 'abc' (type abc = 30 to create it)" | 0 |
| B-CP20a | width 0, Enter | OK | nothing drawn; dof 0; hint "A length must be more than 0." | 0 |
| B-CP20b | width -5, Enter | OK | nothing drawn; dof 0; hint "A length must be more than 0." | 0 |
| B-CP20c | width 99999, Enter | OK | 5 shapes: L[len 98.6 ang=23.88] arc[-4.99,-14.97 20239.1,45702.93 -20249.08,-45732.88] ...; dims distance=99999:d1Ø; tang 4; dof 14 | 1 |
| B-CP20d | width "12abc", Enter | OK | nothing drawn; dof 0; hint "unexpected 'abc' at 2" | 0 |
| B-CP21 | width typed then Backspace x2 (empty): unlocks, commit by click | BUG (B-01) | 5 shapes: L[len 98.6 ang=23.88] arc[-4.99,-14.97 -4.78,-14.52 -5.19,-15.43] ...; dims distance=1:d1Ø; tang 4; dof 14 | 1 |
| B-CP22 | undo-step count for a typed slot (span + width) | OK | 5 shapes: L[len 40 ang=23.88] arc[-31.78,-3.11 -29.35,2.38 -34.21,-8.6] ...; dims distance=12:d1Ø distance=40:d2; tang 4; dof 14 | 1 |

### Slot: 3-point arc and centre-point arc

| id | combination | verdict | result (final state; the box and hint are in the probe log) | undo |
|---|---|---|---|---|
| B-A301 | nothing typed: 3 clicks + width click (baseline) | OK | 5 shapes: arc[-19.96,10.46 -51.59,17.6 11.67,17.6] arc[0,14.97 11.67,17.6 -11.67,12.33] ...; dims distance=23.92:d1Ø; ptOnLine 1; tang 3; dof 13 | 1 |
| B-A302 | first click, then which box? (live read of the box after click 1 and click 2) | OK | nothing drawn; dof 0 | 0 |
| B-A303 | typed 30 in the first box (span/radius), Enter, then the rest by click | BUG (B-04) | 5 shapes: arc[-24.92,6.51 -50.08,20.7 0.25,20.7] arc[-9.92,14.97 0.25,20.7 -20.08,9.23] ...; dims distance=23.34:d1Ø; tang 3; dof 14 | 1 |
| B-A304 | width typed 8 at the end, Enter | OK | 5 shapes: arc[-19.96,10.46 -43.82,15.85 3.9,15.85] arc[0,14.97 3.9,15.85 -3.9,14.09] ...; dims distance=8:d1Ø; ptOnLine 1; tang 3; dof 13 | 1 |
| B-A305 | formula "d1 / 2" in the first box and name "wd = 8" for the width | BUG (B-04) | 6 shapes: L[len 40 ang=0] arc[-29.92,2.52 -42.42,18.09 -17.41,18.09] ...; dims distance=40:d1 distance=8:wdØ; tang 3; dof 18 | 2 |
| B-AC01 | nothing typed: 3 clicks + width click (baseline) | OK | 5 shapes: arc[-39.92,14.97 2.06,14.97 -13.74,-17.85] arc[-15.02,-16.24 -13.74,-17.85 -16.31,-14.63] ...; dims distance=4.12:d1Ø; ptOnLine 1; tang 3; dof 12 | 1 |
| B-AC02 | first click, then which box? (live read of the box after click 1 and click 2) | OK | nothing drawn; dof 0 | 0 |
| B-AC03 | typed 30 in the first box (span/radius), Enter, then the rest by click | OK | 5 shapes: arc[-39.92,14.97 2.06,14.97 -13.74,-17.85] arc[-21.21,-8.48 -13.74,-17.85 -28.68,0.88] ...; dims distance=23.95:d1Ø distance=30:d2R; tang 3; dof 14 | 1 |
| B-AC04 | width typed 8 at the end, Enter | OK | 5 shapes: arc[-39.92,14.97 4,14.97 -12.53,-19.36] arc[-15.02,-16.24 -12.53,-19.36 -17.52,-13.11] ...; dims distance=8:d1Ø; ptOnLine 1; tang 3; dof 12 | 1 |
| B-AC05 | formula "d1 / 2" in the first box and name "wd = 8" for the width | OK | 6 shapes: L[len 40 ang=0] arc[-39.92,14.97 -15.92,14.97 -24.95,-3.79] ...; dims distance=40:d1 distance=8:wdØ distance=20{d1; tang 3; dof 18 | 2 |

### Fillet (radius)

| id | combination | verdict | result (final state; the box and hint are in the probe log) | undo |
|---|---|---|---|---|
| B-F01 | click the corner, Enter (nothing typed: the default radius) | OK | 5 shapes: L[len 44.98 ang=0] L[len 34.95 ang=-90] ...; dims distance=5:d1R; coinc 3; ptOnLine 2; H/V 4; tang 2; dof 20 | 2 |
| B-F03 | radius 8, Enter | OK | 5 shapes: L[len 41.98 ang=0] L[len 34.95 ang=-90] ...; dims distance=8:d1R; coinc 3; ptOnLine 2; H/V 4; tang 2; dof 20 | 2 |
| B-F05 | radius 8 then retyped 6, Enter | OK | 5 shapes: L[len 43.98 ang=0] L[len 34.95 ang=-90] ...; dims distance=6:d1R; coinc 3; ptOnLine 2; H/V 4; tang 2; dof 20 | 2 |
| B-F06 | radius 8 then Backspace x2 (empty), Enter | FRICTION (B-18) | 4 shapes: L[len 49.98 ang=0] L[len 34.95 ang=-90] ...; coinc 4; H/V 4; dof 16; toast ["⚠️Enter a radius greater than zero"] | 1 |
| B-F07 | radius 8 typed, the mouse moves elsewhere (hover another corner), Enter | OK | 5 shapes: L[len 41.98 ang=0] L[len 34.95 ang=-90] ...; dims distance=8:d1R; coinc 3; ptOnLine 2; H/V 4; tang 2; dof 20 | 2 |
| B-F08 | radius 8 typed, then a click on the canvas (outside the box): applies? cancels? | FRICTION (B-19) | 4 shapes: L[len 49.98 ang=0] L[len 34.95 ang=-90] ...; coinc 4; H/V 4; dof 16 | 1 |
| B-F09 | a second corner: the box carries the last radius? | OK | 6 shapes: L[len 41.98 ang=0] L[len 26.95 ang=-90] ...; dims distance=8:d1R distance=8:d2R; coinc 2; ptOnLine 4; H/V 4; tang 4; dof 24 | 3 |
| B-F10 | formula: line d1=40 first; radius "d1 / 8" | OK | 6 shapes: L[len 40 ang=0] L[len 44.98 ang=0] ...; dims distance=40:d1 distance=5{d1; coinc 3; ptOnLine 2; H/V 4; tang 2; dof 24 | 3 |
| B-F11 | name "fr = 6" | OK | 5 shapes: L[len 43.98 ang=0] L[len 34.95 ang=-90] ...; dims distance=6:frR; coinc 3; ptOnLine 2; H/V 4; tang 2; dof 20 | 2 |
| B-F12 | existing parameter: fillet 1 "fr = 6", fillet 2 radius "fr" | OK | 6 shapes: L[len 43.98 ang=0] L[len 28.95 ang=-90] ...; dims distance=6:frR distance=6{fr}:d1R; coinc 2; ptOnLine 4; H/V 4; tang 4; dof 24 | 3 |
| B-F13a | units: radius "0.25 in" | OK | 5 shapes: L[len 43.63 ang=0] L[len 34.95 ang=-90] ...; dims distance=6.35:d1R; coinc 3; ptOnLine 2; H/V 4; tang 2; dof 20 | 2 |
| B-F13b | units: radius "6.35mm" | OK | 5 shapes: L[len 43.63 ang=0] L[len 34.95 ang=-90] ...; dims distance=6.35:d1R; coinc 3; ptOnLine 2; H/V 4; tang 2; dof 20 | 2 |
| B-F13c | units: radius 1/4" | OK | 5 shapes: L[len 43.63 ang=0] L[len 34.95 ang=-90] ...; dims distance=6.35:d1R; coinc 3; ptOnLine 2; H/V 4; tang 2; dof 20 | 2 |
| B-F14a | radius 0, Enter | FRICTION (B-18) | 4 shapes: L[len 49.98 ang=0] L[len 34.95 ang=-90] ...; coinc 4; H/V 4; dof 16; toast ["⚠️Enter a radius greater than zero"] | 1 |
| B-F14b | radius -3, Enter | FRICTION (B-18) | 4 shapes: L[len 49.98 ang=0] L[len 34.95 ang=-90] ...; coinc 4; H/V 4; dof 16; toast ["⚠️Enter a radius greater than zero"] | 1 |
| B-F14c | radius 1000 (larger than the sides), Enter | OK | 5 shapes: L[len 950.02 ang=-180] L[len 34.95 ang=-90] ...; dims distance=1000:d1R; coinc 3; ptOnLine 2; H/V 4; tang 2; dof 20 | 2 |
| B-F14d | radius "6abc", Enter | BUG (B-09) | 4 shapes: L[len 49.98 ang=0] L[len 34.95 ang=-90] ...; coinc 4; H/V 4; dof 16; toast ["⚠️Enter a radius greater than zero"] | 1 |
| B-F14e | radius "abc", Enter | FRICTION (B-18) | 4 shapes: L[len 49.98 ang=0] L[len 34.95 ang=-90] ...; coinc 4; H/V 4; dof 16; toast ["⚠️unknown parameter 'abc' (type abc = 30 to create it)"] | 1 |
| B-F15 | the box after a refused Enter: still open, text kept? (radius abc) | FRICTION (B-18) | 4 shapes: L[len 49.98 ang=0] L[len 34.95 ang=-90] ...; coinc 4; H/V 4; dof 16; toast ["⚠️unknown parameter 'abc' (type abc = 30 to create it)"] | 1 |
| B-F16 | undo steps for one typed fillet | OK | 5 shapes: L[len 41.98 ang=0] L[len 34.95 ang=-90] ...; dims distance=8:d1R; coinc 3; ptOnLine 2; H/V 4; tang 2; dof 20 | 2 |

### Offset (distance)

| id | combination | verdict | result (final state; the box and hint are in the probe log) | undo |
|---|---|---|---|---|
| B-O01 | click the chain, cursor outside, Enter (the default distance) | OK | 8 shapes: L[len 49.98 ang=0] L[len 34.95 ang=-90] ...; dims offset=5:d1; coinc 4; H/V 4; dof 24 | 2 |
| B-O02 | distance 8, cursor outside, Enter | OK | 8 shapes: L[len 49.98 ang=0] L[len 34.95 ang=-90] ...; dims offset=8:d1; coinc 4; H/V 4; dof 24 | 2 |
| B-O03 | distance 8 then retyped 6, Enter | OK | 8 shapes: L[len 49.98 ang=0] L[len 34.95 ang=-90] ...; dims offset=6:d1; coinc 4; H/V 4; dof 24 | 2 |
| B-O04 | distance 8, Backspace x2 (empty), Enter | FRICTION (B-18) | 4 shapes: L[len 49.98 ang=0] L[len 34.95 ang=-90] ...; coinc 4; H/V 4; dof 16; toast ["⚠️Offset: nothing to evaluate."] | 1 |
| B-O05 | distance 8 typed, the mouse moves to the inside (side flips): lock holds, side follows | OK | 8 shapes: L[len 49.98 ang=0] L[len 34.95 ang=-90] ...; dims offset=8:d1; coinc 4; H/V 4; dof 24 | 2 |
| B-O06 | distance 8 typed, then a CLICK on the canvas (choose the side by click): typing still goes to the box? | BUG (B-19, R2-06) | 4 shapes: L[len 49.98 ang=0] L[len 34.95 ang=-90] ...; coinc 4; H/V 4; dof 16 | 1 |
| B-O07 | formula: d1=40 line first; distance "d1 / 8" | OK | 9 shapes: L[len 40 ang=0] L[len 49.98 ang=0] ...; dims distance=40:d1 offset=5{d1; coinc 4; H/V 4; dof 28 | 3 |
| B-O08 | name "od = 6" | OK | 8 shapes: L[len 49.98 ang=0] L[len 34.95 ang=-90] ...; dims offset=6:od; coinc 4; H/V 4; dof 24 | 2 |
| B-O09a | units: distance "0.25 in" | OK | 8 shapes: L[len 49.98 ang=0] L[len 34.95 ang=-90] ...; dims offset=6.35:d1; coinc 4; H/V 4; dof 24 | 2 |
| B-O09b | units: distance "6.35mm" | OK | 8 shapes: L[len 49.98 ang=0] L[len 34.95 ang=-90] ...; dims offset=6.35:d1; coinc 4; H/V 4; dof 24 | 2 |
| B-O09c | units: distance 1/4" | OK | 8 shapes: L[len 49.98 ang=0] L[len 34.95 ang=-90] ...; dims offset=6.35:d1; coinc 4; H/V 4; dof 24 | 2 |
| B-O10a | distance 0, Enter | FRICTION (B-18) | 4 shapes: L[len 49.98 ang=0] L[len 34.95 ang=-90] ...; coinc 4; H/V 4; dof 16; toast ["⚠️Offset: an offset distance cannot be 0 (a negative distance puts the offset on the other side)."] | 1 |
| B-O10b | distance -8 (a negative distance), Enter | OK | 8 shapes: L[len 49.98 ang=0] L[len 34.95 ang=-90] ...; dims offset=-8:d1; coinc 4; H/V 4; dof 24 | 2 |
| B-O10c | distance 99999, Enter | OK | 8 shapes: L[len 49.98 ang=0] L[len 34.95 ang=-90] ...; dims offset=99999:d1; coinc 4; H/V 4; dof 24 | 2 |
| B-O10d | distance "6abc", Enter | FRICTION (B-18) | 4 shapes: L[len 49.98 ang=0] L[len 34.95 ang=-90] ...; coinc 4; H/V 4; dof 16; toast ["⚠️Offset: unexpected 'abc' at 1."] | 1 |
| B-O10e | distance "abc", Enter | FRICTION (B-18) | 4 shapes: L[len 49.98 ang=0] L[len 34.95 ang=-90] ...; coinc 4; H/V 4; dof 16; toast ["⚠️Offset: unknown parameter 'abc' (type abc = 30 to create it)."] | 1 |
| B-O11 | undo steps for one typed offset | OK | 8 shapes: L[len 49.98 ang=0] L[len 34.95 ang=-90] ...; dims offset=8:d1; coinc 4; H/V 4; dof 24 | 2 |

### Circular pattern (dialog)

| id | combination | verdict | result (final state; the box and hint are in the probe log) | undo |
|---|---|---|---|---|
| B-PC01 | dialog: nothing typed (default Quantity), Enter in the dialog | OK | 3 shapes: C[r=10 c=40,0] C[r=10 c=-20,-34.64] ...; dims circularPattern; ptOnLine 1; dof 3 | 2 |
| B-PC02 | Quantity 5 (full 360), Enter | OK | 5 shapes: C[r=10 c=40,0] C[r=10 c=12.36,-38.04] ...; dims circularPattern; ptOnLine 1; dof 5 | 2 |
| B-PC03 | Distribution Angle: Angle 90 + Quantity 4, Enter | OK | 4 shapes: C[r=10 c=40,0] C[r=10 c=34.64,-20] ...; dims circularPattern; ptOnLine 1; dof 4 | 2 |
| B-PC04 | Quantity 5 then retyped 3, Enter | OK | 3 shapes: C[r=10 c=40,0] C[r=10 c=-20,-34.64] ...; dims circularPattern; ptOnLine 1; dof 3 | 2 |
| B-PC05 | Quantity 5 then Backspace (empty), Enter | OK | 1 shape: C[r=10 c=40,0]; ptOnLine 1; dof 1; toast ["⚠️Circular Pattern: type a value."] | 1 |
| B-PC06a | Quantity 1, Enter | OK | 1 shape: C[r=10 c=40,0]; ptOnLine 1; dof 1; toast ["⚠️Circular Pattern: the quantity must be a whole number of 2 or more."] | 1 |
| B-PC06b | Quantity 0, Enter | OK | 1 shape: C[r=10 c=40,0]; ptOnLine 1; dof 1; toast ["⚠️Circular Pattern: the quantity must be a whole number of 2 or more."] | 1 |
| B-PC06c | Quantity -3, Enter | OK | 1 shape: C[r=10 c=40,0]; ptOnLine 1; dof 1; toast ["⚠️Circular Pattern: the quantity must be a whole number of 2 or more."] | 1 |
| B-PC06d | Quantity 2.5, Enter | OK | 1 shape: C[r=10 c=40,0]; ptOnLine 1; dof 1; toast ["⚠️Circular Pattern: the quantity must be a whole number of 2 or more."] | 1 |
| B-PC06e | Quantity 9999, Enter | OK | 1 shape: C[r=10 c=40,0]; ptOnLine 1; dof 1; toast ["⚠️Circular Pattern: the quantity must be at most 1000."] | 1 |
| B-PC06f | Quantity "abc", Enter | OK | 1 shape: C[r=10 c=40,0]; ptOnLine 1; dof 1; toast ["⚠️Circular Pattern: unknown parameter 'abc' (type abc = 30 to create it)."] | 1 |
| B-PC06g | Quantity "4abc", Enter | OK | 1 shape: C[r=10 c=40,0]; ptOnLine 1; dof 1; toast ["⚠️Circular Pattern: unexpected 'abc' at 1."] | 1 |
| B-PC06h | Quantity name "n = 4", Enter | OK | 4 shapes: C[r=10 c=40,0] C[r=10 c=0,-40] ...; dims circularPattern; ptOnLine 1; dof 4 | 2 |
| B-PC06i | Quantity formula "12 / 3", Enter | OK | 4 shapes: C[r=10 c=40,0] C[r=10 c=0,-40] ...; dims circularPattern; ptOnLine 1; dof 4 | 2 |
| B-PC07a | Distribution Angle, Angle 90, Quantity 3, Enter | OK | 3 shapes: C[r=10 c=40,0] C[r=10 c=28.28,-28.28] ...; dims circularPattern; ptOnLine 1; dof 3 | 2 |
| B-PC07b | Distribution Angle, Angle 0, Quantity 3, Enter | OK | 1 shape: C[r=10 c=40,0]; ptOnLine 1; dof 1; toast ["⚠️Circular Pattern: the total angle must be between -360 and 360 degrees, not 0."] | 1 |
| B-PC07c | Distribution Angle, Angle -45, Quantity 3, Enter | OK | 3 shapes: C[r=10 c=40,0] C[r=10 c=36.96,15.31] ...; dims circularPattern; ptOnLine 1; dof 3 | 2 |
| B-PC07d | Distribution Angle, Angle 720, Quantity 3, Enter | OK | 1 shape: C[r=10 c=40,0]; ptOnLine 1; dof 1; toast ["⚠️Circular Pattern: the total angle must be between -360 and 360 degrees, not 0."] | 1 |
| B-PC07e | Distribution Angle, Angle "45abc", Quantity 3, Enter | OK | 1 shape: C[r=10 c=40,0]; ptOnLine 1; dof 1; toast ["⚠️Circular Pattern: unexpected 'abc' at 2."] | 1 |
| B-PC07f | Distribution Angle, Angle name "a1 = 60", Quantity 3, Enter | OK | 3 shapes: C[r=10 c=40,0] C[r=10 c=34.64,-20] ...; dims circularPattern; ptOnLine 1; dof 3 | 2 |
| B-PC07g | Distribution Angle, Angle formula "180 / 3", Quantity 3, Enter | OK | 3 shapes: C[r=10 c=40,0] C[r=10 c=34.64,-20] ...; dims circularPattern; ptOnLine 1; dof 3 | 2 |
| B-PC07h | Distribution Angle, Angle "1.5 rad", Quantity 3, Enter | OK | 3 shapes: C[r=10 c=40,0] C[r=10 c=29.27,-27.27] ...; dims circularPattern; ptOnLine 1; dof 3 | 2 |
| B-PC08 | undo steps for one typed circular pattern | OK | 5 shapes: C[r=10 c=40,0] C[r=10 c=12.36,-38.04] ...; dims circularPattern; ptOnLine 1; dof 5 | 2 |

### Rectangular pattern (dialog)

| id | combination | verdict | result (final state; the box and hint are in the probe log) | undo |
|---|---|---|---|---|
| B-PR01 | direction = a horizontal line; dialog state | OK | 2 shapes: L[len 29.94 ang=0] C[r=10 c=40,0]; ptOnLine 2; H/V 1; dof 4 | 2 |
| B-PR02 | Quantity 1 = 3, Distance 1 = 20, Enter | OK | 4 shapes: L[len 29.94 ang=0] C[r=10 c=40,0] ...; dims rectangularPattern; ptOnLine 2; H/V 1; dof 6 | 3 |
| B-PR03 | Distance only (30), default quantity, Enter | OK | 3 shapes: L[len 29.94 ang=0] C[r=10 c=40,0] ...; dims rectangularPattern; ptOnLine 2; H/V 1; dof 5 | 3 |
| B-PR04 | Quantity only (4), default distance, Enter | OK | 5 shapes: L[len 29.94 ang=0] C[r=10 c=40,0] ...; dims rectangularPattern; ptOnLine 2; H/V 1; dof 7 | 3 |
| B-PR05 | Distance retyped 20 -> 15, Enter | OK | 4 shapes: L[len 29.94 ang=0] C[r=10 c=40,0] ...; dims rectangularPattern; ptOnLine 2; H/V 1; dof 6 | 3 |
| B-PR06 | Distance typed then Backspace (empty), Enter | OK | 2 shapes: L[len 29.94 ang=0] C[r=10 c=40,0]; ptOnLine 2; H/V 1; dof 4; toast ["⚠️Rectangular Pattern: type a value."] | 2 |
| B-PR07 | formula: d1 line first; Distance "d1 / 2" | OK | 5 shapes: L[len 20 ang=0] L[len 29.94 ang=0] ...; dims distance=20:d1 rectangularPattern; ptOnLine 2; H/V 1; dof 10 | 4 |
| B-PR08 | name: Distance "gap = 25" | OK | 4 shapes: L[len 29.94 ang=0] C[r=10 c=40,0] ...; dims rectangularPattern; ptOnLine 2; H/V 1; dof 6 | 3 |
| B-PR09a | Distance "1 in", Quantity 3, Enter | OK | 4 shapes: L[len 29.94 ang=0] C[r=10 c=40,0] ...; dims rectangularPattern; ptOnLine 2; H/V 1; dof 6 | 3 |
| B-PR09b | Distance 0, Quantity 3, Enter | OK | 2 shapes: L[len 29.94 ang=0] C[r=10 c=40,0]; ptOnLine 2; H/V 1; dof 4; toast ["⚠️Rectangular Pattern: distance 1 must be a number other than 0."] | 2 |
| B-PR09c | Distance -20, Quantity 3, Enter | OK | 4 shapes: L[len 29.94 ang=0] C[r=10 c=40,0] ...; dims rectangularPattern; ptOnLine 2; H/V 1; dof 6 | 3 |
| B-PR09d | Distance 99999, Quantity 3, Enter | OK | 4 shapes: L[len 29.94 ang=0] C[r=10 c=40,0] ...; dims rectangularPattern; ptOnLine 2; H/V 1; dof 6 | 3 |
| B-PR09e | Distance "20abc", Quantity 3, Enter | OK | 2 shapes: L[len 29.94 ang=0] C[r=10 c=40,0]; ptOnLine 2; H/V 1; dof 4; toast ["⚠️Rectangular Pattern: unexpected 'abc' at 2."] | 2 |

### Inch document

| id | combination | verdict | result (final state; the box and hint are in the probe log) | undo |
|---|---|---|---|---|
| B-ILa | length a bare 2 (= 2 in), Enter | OK | 1 shape: L[len 50.8 ang=14.04]; dims distance=50.8:d1; dof 4 | 1 |
| B-ILb | length "2 in", Enter | OK | 1 shape: L[len 50.8 ang=14.04]; dims distance=50.8:d1; dof 4 | 1 |
| B-ILc | length "25.4mm", Enter | OK | 1 shape: L[len 25.4 ang=14.04]; dims distance=25.4:d1; dof 4 | 1 |
| B-ILd | length 1/2", Enter | OK | 1 shape: L[len 12.7 ang=14.04]; dims distance=12.7:d1; dof 4 | 1 |
| B-ILe | length a bare 1.5, Enter | OK | 1 shape: L[len 38.1 ang=14.04]; dims distance=38.1:d1; dof 4 | 1 |
| B-ILf | length "3 mm", Enter | OK | 1 shape: L[len 3 ang=14.04]; dims distance=3:d1; dof 4 | 1 |
| B-ILg | length a bare fraction 1/2, Enter | OK | 1 shape: L[len 12.7 ang=14.04]; dims distance=12.7:d1; dof 4 | 1 |
| B-IRa | W bare 2, Enter | OK | 4 shapes: L[len 50.8 ang=0] L[len 35.56 ang=-90] ...; dims distance=50.8:d1; coinc 4; H/V 4; dof 16 | 1 |
| B-IRb | W "25.4mm", Enter | OK | 4 shapes: L[len 25.4 ang=0] L[len 35.56 ang=-90] ...; dims distance=25.4:d1; coinc 4; H/V 4; dof 16 | 1 |
| B-ICa | Ø bare 2 (= 2 in, r 25.4), Enter | OK | 1 shape: C[r=25.4 c=-30.48,0]; dims distance=50.8:d1Ø; ptOnLine 1; dof 1 | 1 |
| B-ICb | Ø 1/2", Enter | OK | 1 shape: C[r=6.35 c=-30.48,0]; dims distance=12.7:d1Ø; ptOnLine 1; dof 1 | 1 |
| B-ID | radius bare 1 (= 1 in) then sweep 90 | OK | 1 shape: arc[-30.48,0 -5.08,0 -30.48,-25.4]; dims distance=25.4:d1R; ptOnLine 1; dof 4 | 1 |
| B-IE | R bare 1 (= 1 in) | OK | 12 shapes: L[len 25.4 ang=-120] L[len 25.4 ang=0] ...; dims distance=25.4:d1; ptOnLine 1; dof 13 | 1 |
| B-IF | span bare 2 (= 2 in), width bare 0.5 | OK | 5 shapes: L[len 50.8 ang=23.96] arc[-4.38,-15.55 -1.8,-9.75 -6.96,-21.35] ...; dims distance=12.7:d1Ø distance=50.8:d2; tang 4; dof 12 | 1 |
| B-IG | radius bare 0.25 (= 0.25 in) | OK | 5 shapes: L[len 44.45 ang=0] L[len 35.56 ang=-90] ...; dims distance=6.35:d1R; coinc 3; ptOnLine 2; H/V 4; tang 2; dof 20 | 2 |
| B-IH | angle box in an inch document: unaffected (30) | OK | 1 shape: L[len 41.89 ang=30]; dof 4 | 1 |

### Over-constrain

| id | combination | verdict | result (final state; the box and hint are in the probe log) | undo |
|---|---|---|---|---|
| B-OC1 | start at the fixed origin, existing endpoint LOCKED 0.3 mm beyond the typed length: end merges with the locked point? | BUG (B-08) | 2 shapes: L[len 20 ang=90] L[len 40 ang=0]; dims distance=40.3:d1(ref); ptOnLine 1; H/V 1; dof 1 | 3 |
| B-OC2 | typed length 40 exactly to a locked point: a redundant dimension? | OK | 2 shapes: L[len 20 ang=90] L[len 40 ang=0]; dims distance=40:d1(ref); ptOnLine 1; H/V 1; dof 1 | 3 |
| B-OC3 | W 40 H 20 with the first corner on the origin (fixed) and the opposite corner on a locked point: typed vs locked | OK | 5 shapes: L[len 10 ang=-90] L[len 40 ang=0] ...; dims distance=40:d1 distance=20:d2; coinc 6; H/V 5; dof 1 | 3 |

### Bezier

| id | combination | verdict | result (final state; the box and hint are in the probe log) | undo |
|---|---|---|---|---|
| B-BZ1 | does the Bezier tool open any size box? (click, click, click, Enter) | OK | nothing drawn; ptOnLine 1; dof 3 | 1 |

### Phone 390x844 (touch)

| id | combination | verdict | result (final state; the box and hint are in the probe log) | undo |
|---|---|---|---|---|
| B-PHL1 | tap start, tap end, nothing typed | OK | 1 shape: L[len 9.56 ang=20.04]; dof 4 | 1 |
| B-PHL2 | tap start, tap the length box, type 20, Enter | OK | 1 shape: L[len 20 ang=0]; dims distance=20:d1; dof 4 | 1 |
| B-PHL3 | tap start, tap the ANGLE box, type 30, Enter (no cursor length) | OK | nothing drawn; dof 0 | 0 |
| B-PHL4 | length 20 + angle 30 both typed, Enter | OK | 1 shape: L[len 20 ang=30]; dims distance=20:d1; dof 4 | 1 |
| B-PHL5 | length 20 typed then Backspace x2 (empty), tap end: unlocks | OK | 1 shape: L[len 9.56 ang=20.04]; dof 4 | 1 |
| B-PHL6 | length 20 typed, commit by TAP on the canvas | OK | 1 shape: L[len 20 ang=20.04]; dims distance=20:d1; dof 4 | 1 |
| B-PHR1 | tap corner, W 20 H 10 typed, Enter | OK | 4 shapes: L[len 20 ang=0] L[len 10 ang=-90] ...; dims distance=20:d1 distance=10:d2; coinc 4; H/V 4; dof 16 | 1 |
| B-PHR2 | tap corner, tap again with nothing typed (the tapped point is the opposite corner) | OK | 4 shapes: L[len 8.98 ang=0] L[len 6.99 ang=-90] ...; coinc 4; H/V 4; dof 16 | 1 |
| B-PHC1 | tap centre, Ø 30 typed in the box, Enter | OK | 1 shape: C[r=15 c=0,-4.99]; dims distance=30:d1Ø; ptOnLine 1; dof 1 | 1 |
| B-PHP1 | tap centre, R 20 + N 5 typed, Enter | OK | 10 shapes: L[len 23.51 ang=-126] L[len 20 ang=0] ...; dims distance=20:d1; ptOnLine 1; dof 10 | 1 |
| B-PHS1 | tap start, span 40 typed Enter, width 10 typed Enter | OK | 5 shapes: L[len 40 ang=0] arc[36.5,-1.5 36.5,3.5 36.5,-6.5] ...; dims distance=10:d1Ø distance=40:d2; tang 4; dof 12 | 1 |
| B-PHA1 | tap centre, radius 20 typed Enter, sweep 90 typed Enter | OK | 1 shape: arc[-0.49,-1.5 19.51,-1.5 -0.49,18.5]; dims distance=20:d1R; dof 6 | 1 |
| B-PHF1 | rect by taps, fillet tool, tap the corner, radius box visible and inside the viewport? | OK | 4 shapes: L[len 8.98 ang=0] L[len 6.99 ang=-90] ...; coinc 4; H/V 4; dof 16 | 1 |
| B-PHO1 | rect by taps, offset tool, tap a side, distance box visible and inside the viewport? | OK | 4 shapes: L[len 8.98 ang=0] L[len 6.99 ang=-90] ...; coinc 4; H/V 4; dof 16 | 1 |
