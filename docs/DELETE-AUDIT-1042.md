# Delete audit (task 1042): what Delete removes, what it leaves, and how it compares with Fusion 360

AUDIT ONLY: no code in `packages/` or `apps/` changed. Owner-approved 2026-11-27 ("we need an extensive delete audit"). Worktree `delete-audit-1042`, branch
`agents/delete-audit-1042`, from `origin/main` b12c00d2. Following audit rule 5, there are no BUG-ARCHIVE entries: the advisor files them.

## How it was run

**OUR column.** The probes live outside the gate. They run the REAL Design tab in Node through `tests/helpers/node-app.js`: the page's own pointer and key
listeners, the ribbon tools, the value boxes, the undo history, and autosave to the shared project store. Each scene is **drawn with the real tools**:
clicks, typed values, the Fillet / Offset boxes, and the Mirror and Pattern commands. The target is **picked with a real click** at its screen point: a
point, a curve, a glyph's inked pixel, or a dimension label as the DOM target. The probe then **deletes through a real path**: the Delete key, Backspace,
the right-click menu row, the footer's red X, or the Parameters window. Nothing is asserted. Each probe prints one `ROW <id> | ...` line per case and exits 0.

| file | rows |
|---|---|
| `tests/audits/delete-audit-1042-kit.js` | shared driver: scene builders on the real tools, picks, delete paths, the document read, leftovers, solver, undo / redo, save + reload |
| `delete-audit-1042-points.mjs` | D-01..D-25 points |
| `delete-audit-1042-curves.mjs` | D-26..D-46 curves |
| `delete-audit-1042-constraints.mjs` | D-47..D-72 glyphs and dimensions |
| `delete-audit-1042-selections.mjs` | D-73..D-78 selections, D-79..D-84 paths, O-01..O-12 the origin (owner rule) |
| `delete-audit-1042-hosts.mjs` | the same rows in Shaper and Pen Plotter (H-shaper-*, H-penplotter-*) |
| `delete-audit-1042-phone-live.mjs` | LIVE headless: the phone's touch-and-hold menu and footer red X (390 x 844), the desktop footer and right-click (1280 x 800) |

Run: `node tests/audits/delete-audit-1042-<name>.mjs`. `ONLY=<regex>` reruns a subset of rows. The outputs of this run are in `.evidence/1042/*.out`
(local only).

Each ROW carries the following fields:

- `sel{S.. J.. C..}`: what the click selected.
- `deleted shapes [..] points -n cons [..]`: what went. `ADDED` marks a record that changed rather than went, such as a pattern instance being suppressed.
- `after`: a census of what remains.
- `LEFT [..]`: the leftovers. These are a point on no curve, a constraint, dimension or pattern naming a missing shape or point, an empty group, and a model
  parameter with no dimension.
- `residual / dof`: the solver after the delete.
- `undo exact`: one Ctrl+Z gives back the exact document, compared by ids, every constraint field and the parameters.
- `redo exact`: Ctrl+Y gives back the deleted state.
- `reload same`: the stored design reopened in a new page equals the after-delete document.
- `REPEAT DIFFERS`: the same case run twice gave different results. It never appeared in the final run.

One seam belongs to the probe only and is documented in the kit. The Text tool fetches its bundled font from a `file:` URL that Node's fetch cannot read,
so the kit answers `file:` URLs from disk. The app code is unchanged.

**FUSION column.** The advisor measured it on 2026-11-27 in Fusion Personal: the scenes were built with the API, the target was selected, then the REAL
Delete key and a real Ctrl+Z were sent. The method was calibrated against hand measurements on D-01, D-02 and D-26. The source is the advisor's
`delete-1042-fusion-column.txt`, quoted below. "not measured" means that case cannot be built through Fusion's API.

Facts measured before the audit and quoted as given:

- A curve's END POINT is never deletable. This covers a lone line end, a shared corner, a coincident-glued stack, and a stack after Delete Coincident. The
  Delete key does nothing; right-click Delete opens the Delete command with an empty selection and OK greyed.
- A FREE sketch point is deleted.
- Deleting a shared point's SharedPointCoincident glyph splits the point: the curve that joined last keeps the point and what is attached to it.
  Right-click "Delete Coincident" does the same.
- Three curves on one point show 2 glyphs; each one detaches one curve.
- Splitting an offset copy's corner or a pattern SOURCE corner dissolves the offset or pattern. Splitting a pattern COPY corner keeps the pattern.
- The Coincident tool never merges points; it glues separate points.

**Verdicts.** SAME means the same user-visible result. DIFFERENT means a divergence (owner rule: report it, the owner decides). BUG covers a stray leftover,
an undo that does not restore, a crash, or inconsistent results from the same action. NOT MEASURED means no Fusion number exists; OUR column is still
filled in.

**Joins in OUR app.** These were measured in the scenes, not assumed:

- **Glued** (separate points plus a Coincident constraint): Line-tool chains, 2-point and centre rectangles, and lines glued with the Coincident tool.
- **Shared** (one point id): the polygon (6 sides and 6 construction radius lines on one centre), the slot (sides and caps), offset copies, pattern copies,
  mirror copies, fillet tangent points, and a line started on an existing point (D-05b).
- Fusion's Line-tool chain and rectangle corners are SHARED. Ours are glued.

## Summary

The D matrix has **103 rows: 40 SAME, 35 DIFFERENT, 5 BUG, 22 NOT MEASURED, 1 ours-only** (the footer red X). The origin rows (owner rule: the origin is
never deletable) have **19 rows: 15 PASS, 4 BUG**. Every BUG row maps to one of **4 distinct bugs**, listed below.

**Paths and hosts:**

- The Delete key, Backspace, the right-click Delete row, the footer red X, and the phone's hold menu and footer give the same result for the same selection.
- One exception is an origin-only selection: the footer refuses it, but Delete deletes curves (BUG-B).
- Shaper and Pen Plotter give the same rows as SketchStudio (28 H-rows, identical).

**Undo, redo, save and reload:**

- One Ctrl+Z restored the exact document in **every** row that deleted something.
- Redo and save + reload were exact everywhere except one field in D-65: `isDriven` is undefined before the save and false after it. It has no user-visible
  effect and is noted, not a BUG.
- The solver converged (residual ok) after every delete.

**The main divergence: the point rule.** A picked point + Delete deletes every curve that uses the point (24 point rows). Fusion never deletes a curve end
point. The cause is `packages/core/delete-manager.js:213-221`: every shape with a selected joint goes, and 244-251 then take its orphaned points.

## BUGs

**BUG-A: deleting a curve that SHARES the origin removes the OTHER curves' constraints and dimensions to the origin** (rows O-09b, O-09c).

- Scene: a line drawn from the origin uses the point `j_origin` itself (O-07: `line joints before [["j_origin","j265_..."]]`). A second, separate line has a
  dimension to the origin, or is glued to it.
- Action: delete the first line.
- Result: the second line's dimension or coincident goes too.
- Probe lines:
  - `ROW O-09b | ... | deleted shapes [line] points -1 cons [distance:d1] | ... | before: cons [["distance",["p","ORIGIN"],"d1"]]; origin kept at (0, 0) fixed=true; constraints naming the origin none`
  - `ROW O-09c | ... | deleted shapes [line] points -1 cons [coincident] | ... | before: cons [["coincident",["p","ORIGIN"]]]; ... constraints naming the origin none`
- Control: when the other curve also USES the origin, its dimension survives (O-09: `constraints naming the origin distance`).
- Cause: `delete-manager.js:104,113` collect the deleted shape's points, `j_origin` included. Line 138 counts only the points surviving SHAPES use. So 140
  puts `j_origin` in `goneJ`, and 143 splices every constraint that names it. The origin point itself survives: `removeOrphanJoints` protects it at
  `joints.js:39`.
- Same in Shaper and Pen Plotter (`ROW H-shaper-O-09b`, `ROW H-penplotter-O-09b`: `cons [distance:d1]`).

**BUG-B: an origin-only selection: the Delete key deletes every curve drawn from the origin, while the footer refuses the same selection** (rows O-08,
O-08b; compare O-08c and O-08d).

- `ROW O-08b | TWO lines from the origin: the origin clicked, Delete | sel{S J1(origin) C} | deleted shapes [line,line] points -2`
- `ROW O-08c | ... the origin clicked, footer red X | sel{S J1(origin) C} | NOTHING deleted | ... | path "footer button DISABLED ..."`
- `ROW O-08d | ... right-click the origin | ... NOTHING deleted | ... | path []` (the right-click offers no menu on the origin)
- The origin itself always stays, so the owner rule holds for the point. But the same selection deletes 2 curves by one path and nothing by the other.
  Fusion deletes nothing (D-20: NOTHING).
- Cause: `delete-manager.js:213-221` adds every shape that uses a selected joint, `j_origin` included. 244-251 add those shapes' other points, and
  253 filters out only `j_origin` itself, so `deleteJoints` (261) removes the lines. Meanwhile `hasSelection` (292-296) counts an origin-only selection as
  empty, and the footer disables its button by it (`app-footer.js:348`).

**BUG-C: a stray fillet virtual-sharp point after the fillet is gone** (rows D-09, D-33).

- `ROW D-33 | fillet arc (rectangle corner, R6) | ... deleted shapes [arc] points -1 ... | LEFT [point j98_... on no curve (virtual sharp)]`
- `ROW D-09 | filleted corner: the fillet arc end ... | deleted shapes [line,arc] points -3 ... | LEFT [point j158_... on no curve (virtual sharp)]`
- With no dimension on the corner, the corner point V outlives its fillet. In D-33 it stays tied by 2 point-on-line constraints, in D-09 by one. It is
  drawn as a cross that is "never hidden" (`svg-renderer.js:1632-1641`).
- The documented exception keeps V only while a measurement dimension holds it (`delete-manager.js:11-25`, `virtualSharpProtectedJoints`). D-33b is that
  case and is NOT MEASURED.
- Fusion D-33: the arc + its 2 Tangent + 1 point go, and no point stays.
- Cause: V is no curve's point, so `removeGeometry` never makes it a candidate (`delete-manager.js:104-140`). `removeOrphanJoints` keeps any point a
  constraint names (`joints.js:28-39`), and the point-on-line constraints on the surviving sides name it.

**BUG-D: a glyph drawn within a point's pick reach cannot be picked by a LEFT click, so Delete removes curves instead** (rows D-56, D-60, D-48; the
right-click rows D-56b, D-60b and D-48b work).

- `ROW D-56 | Tangent glyph (line-arc, a slot side and cap) | sel{S J1 C} | deleted shapes [line,arc] points -1 cons [equal,tangent,tangent,tangent,parallel,distance:d1Ø]`
- `ROW D-56b | Tangent glyph: RIGHT-click on it > Delete constraint | ... cons [tangent] | ... | path ["con-delete"]`
- `ROW D-60 | Symmetric glyph ... | sel{S J1 C} | deleted shapes [line] points -2 cons [symmetric]` versus `ROW D-60b | ... cons [symmetric] | ... | path ["con-delete"]`
- `ROW D-48 | one Coincident glyph of 3 GLUED ends (the second) | sel{S J0 C} | NOTHING deleted` versus `ROW D-48b | ... cons [coincident] | ... path ["con-delete"]`
- `.evidence/1042/glyph3.out`: `w 200 tangent glyph px to nearest point 6.0 hover at glyph ink: joint j3_... constraint null`. The result is the same at
  view width 60.
- A tangent glyph is always drawn 6 px off its touch point (`svg-renderer.js:578` `TANGENT_GLYPH_OFFSET_PX = 6`, placed at 2345-2351). A left click and the
  hover take a joint first (`hover-manager.js:65-66` `selectPick`; joint reach 30 px, `constants.js:33`). The right-click takes the glyph first
  (`input-manager.js:1411-1425` `pickContextTarget`).
- So the same aim selects the constraint with the right button, but the point with the left. Delete then removes the line + arc and 6 constraints. Fusion's
  tangent glyph is picked and deleted alone (D-56: only itself).

## The matrix

Rows are grouped by kind. The OURS cells name what went; the full lines are in `.evidence/1042/*.out`. Every OURS row has `undo exact`, `redo exact`,
`reload same` and `residual ok` unless the row says otherwise.

### Points (select the point, Delete)

| id | scene | OURS | FUSION | verdict |
|---|---|---|---|---|
| D-01 | lone point. Ours has no Point tool; the nearest is a centre rectangle's centre point | the point + its 2 point-on-line constraints; the diagonals stay | deleted | SAME |
| D-02 | free end of a line | the line + 2 points + H | NOTHING | DIFFERENT |
| D-03 | glued end, 2 lines | the picked point's line + Coincident | NOTHING | DIFFERENT |
| D-04 / 04b | glued end, 3 lines (either point of the stack) | the picked point's line + H + 1 Coincident; 2 lines stay glued | NOTHING | DIFFERENT |
| D-05 | Line-tool chain corner (ours: glued) | 1 line + Coincident + Vertical | NOTHING | DIFFERENT |
| D-05b | a 3rd line started ON a chain corner (shared) | 2 lines (the 3rd line and the chain line it shares the point with) | not measured | DIFFERENT (point rule) |
| D-06 | rectangle corner | 1 side + Vertical + 2 Coincident | NOTHING | DIFFERENT |
| D-07 | polygon corner (shared) | 2 sides + the construction radius + 3 Equal | NOTHING | DIFFERENT |
| D-08 | slot side meets cap (shared) | side + cap + Equal + 3 Tangent + Parallel + the Ø dimension | not measured (an end point) | DIFFERENT (point rule) |
| D-09 | fillet arc end (tangent point) | 1 side + the arc + 7 constraints, **V left on no curve** | NOTHING | **BUG-C** |
| D-10 | offset COPY corner | 2 copy lines + the offset relation (and its dimension) | NOTHING | DIFFERENT |
| D-10b | offset SOURCE corner | 1 source side + the offset relation | not measured | DIFFERENT (point rule) |
| D-11 / 11b | pattern COPY corner (copy 2 or 3 of 3) | the whole copy (4 lines); the pattern keeps that instance suppressed | NOTHING | DIFFERENT |
| D-12 | pattern SOURCE corner | 1 source side + its constraints + the pattern (the copies stay as plain lines) | NOTHING | DIFFERENT |
| D-13 / 13b | mirror COPY / SOURCE corner | copy: 2 copy lines + 1 Symmetric; source: 1 side + 3 constraints + 1 Symmetric | not measured (an end point) | DIFFERENT (point rule) |
| D-14 | circle centre | the circle | NOTHING | DIFFERENT |
| D-15 | arc centre | the arc | NOTHING | DIFFERENT |
| D-16 | free arc end | the arc | NOTHING | DIFFERENT |
| D-17 | end with a Midpoint constraint | that line + Midpoint | NOTHING | DIFFERENT |
| D-18 | on-curve point | that line + point-on-line | NOTHING | DIFFERENT |
| D-19 | fixed line end (F) | the line | NOTHING | DIFFERENT |
| D-20 | the origin, nothing drawn on it | NOTHING | NOTHING | SAME |
| D-21 | fillet virtual sharp (corner dimensioned, then filleted) | V + its dimension + 2 point-on-line | not measured | NOT MEASURED |
| D-22 | bezier anchor (middle of a 2-segment path) | both segments (the whole path) | spline fit point: the point goes, the spline re-fits | DIFFERENT |
| D-23 | bezier handle end (smooth anchor) | a handle is not pickable: the click clears the selection, NOTHING deleted | not measured | NOT MEASURED |
| D-24 | text anchor | the click selects the whole text; text + its letters deleted | not measured | NOT MEASURED |
| D-25 | point with a dimension to the origin (ours: a line end; no free point) | the line + H + the dimension | lone point + its dimension deleted | DIFFERENT (point rule) |

### Curves (select the curve, Delete)

| id | scene | OURS | FUSION | verdict |
|---|---|---|---|---|
| D-26 | lone line | line + 2 points + H | line + its 2 points | SAME |
| D-27 | one rectangle side | that side + its H + 2 corner Coincidents; the neighbours keep their ends | that line only; corners stay | SAME |
| D-28 | one polygon side | that side + 1 Equal (9 of 10 Equal stay) | that line only; the Polygon constraint stays | SAME |
| D-29 | the polygon's construction radius line | that line + 1 Equal | Fusion's polygon has none | NOT MEASURED |
| D-30 | slot side | side + 2 Tangent + Parallel | line + 2 Tangent + Parallel | SAME |
| D-31 | slot cap | arc + 2 Tangent | arc + 2 Tangent | SAME |
| D-32 | slot construction centre line | that line + its H | that line only | SAME |
| D-33 | fillet arc R6 | arc + centre + Equal + 2 Tangent + radius dim; the sides stay trimmed; **V left on no curve** | arc + 2 Tangent + 1 point; not back to sharp | **BUG-C** |
| D-33b | fillet arc, corner dimensioned | as D-33; V stays, held by the dimension (deliberate, `delete-manager.js:11-25`) | not measured | NOT MEASURED |
| D-34 | lone arc | arc + 3 points | arc + 3 points | SAME |
| D-35 | circle | circle + centre | circle + centre | SAME |
| D-36 | bezier: one click on a 2-segment path | ONE segment; the other half stays | the whole spline + its points | DIFFERENT |
| D-36b | bezier: both segments selected | both + 3 points | the whole spline | SAME |
| D-37 | construction line | line + 2 points | line + 2 points | SAME |
| D-38 | offset COPY side | that line + the offset relation and its dimension (the other 3 copies stay as plain lines) | that line only; the Offset STAYS | DIFFERENT |
| D-39 | offset SOURCE side | that side + H + 2 Coincident + the offset relation | that line only; the Offset STAYS | DIFFERENT |
| D-40 | mirror COPY curve | that line only; the 4 Symmetric stay | not measured | NOT MEASURED |
| D-41 | mirror SOURCE curve | that side + H + 2 Coincident + 2 Symmetric | not measured | NOT MEASURED |
| D-42 | the mirror line | that line + its Vertical + all 4 Symmetric (the copies stay free) | not measured | NOT MEASURED |
| D-43 | pattern COPY side | the whole copy instance (4 lines); the pattern stays with that instance suppressed (`pattern.js:622-625`) | that line only; the pattern STAYS | DIFFERENT |
| D-44 | pattern SOURCE side | that side + its constraints + the pattern (the copies stay) | that line + the pattern constraint (the copies stay) | SAME |
| D-45 | line with a length dim, H, Parallel, Equal | the line + H + dim + Parallel + Equal; the other lines untouched | the same | SAME |
| D-46 | text | text + its letters | text + its 4 construction box lines | SAME |

### Constraints and dimensions (select the glyph or label, Delete)

| id | scene | OURS | FUSION | verdict |
|---|---|---|---|---|
| D-47 | Coincident of 2 glued ends | only it; the lines separate | only it | SAME |
| D-48 | the 2nd Coincident of 3 glued ends, LEFT click | its point clicked (the glyph shows), then a left click on the glyph: nothing selected, NOTHING deleted | only it | **BUG-D** |
| D-48b | the same, RIGHT-click > Delete constraint | only it | only it | SAME |
| D-49 | Coincident at a Line-tool chain corner | only it: the chain splits | split (SharedPointCoincident) | SAME |
| D-50 | a polygon corner (shared, 3 curves) | no glyph to pick (0 Coincident in a polygon); a click beside the corner takes a side, so its side + 1 Equal go | 2 glyphs, each detaches one curve | DIFFERENT |
| D-51 | point-on-curve glyph | only it | only it | SAME |
| D-52 .. D-55 | Horizontal, Vertical, Parallel, Perpendicular | only it | only it | SAME (4 rows) |
| D-56 | Tangent (slot), LEFT click | the click takes the tangency POINT: side + cap + 6 constraints | only it | **BUG-D** |
| D-56b | Tangent, RIGHT-click > Delete constraint | only it | only it | SAME |
| D-57 .. D-59 | Equal, Collinear, Midpoint | only it | only it | SAME (3 rows) |
| D-60 | Symmetric (2 line ends about a line), LEFT click | the click takes a POINT: that line + Symmetric | only it | **BUG-D** |
| D-60b | Symmetric, RIGHT-click > Delete constraint | only it | only it | SAME |
| D-61 | Fix | a point flag, no glyph; the point pick deletes the line | not measured | NOT MEASURED |
| D-62 | Concentric | ours has no Concentric constraint: a circle started on a centre is glued by a Coincident; deleting the circle takes it | not measured | NOT MEASURED |
| D-63 | rectangular pattern label | the pattern; the copies stay as plain geometry | the pattern; the copies stay | SAME |
| D-64 | one of a Mirror's Symmetric glyphs | only it | not measured | NOT MEASURED |
| D-65 | Offset dimension label | the dimension goes and the relation stays with a FREE distance (`dimensioned=false value=5`, dof 4 to 5; `delete-manager.js:44-46` `undimensionOffset`) | the Offset constraint goes, replaced by 4 separate Offset dimensions (the copy keeps its distance) | DIFFERENT |
| D-66 .. D-70 | driving linear, reference linear, angle, radius, diameter | only it | only it | SAME (5 rows) |
| D-71 | d2 = d1 * 2, delete d1 | d1 goes with NO question; the parameter d1 stays as a value (`"30 mm"`); d2 keeps `d1 * 2` = 60 | a DIALOG "This dimension is referenced by a parameter in an equation. Are you sure...?"; confirmed: the parameter d1 stays, d2 keeps its formula | DIFFERENT (no dialog) |
| D-72 | right-click a chain corner | menu `["geo-lock","geo-delete"]`, no Delete Coincident; Delete takes 1 line | Delete Coincident = split; Delete opens an empty command | DIFFERENT |
| D-72b | right-click a polygon (shared) corner | same menu; Delete takes 2 sides + the radius line | the same split | DIFFERENT |

### Selections

| id | scene | OURS | FUSION | verdict |
|---|---|---|---|---|
| D-73 | 3 lines, Shift+click | all 3 + 6 points | all 3 + 6 points | SAME |
| D-73b | 3 lines, Ctrl+click | Ctrl+click does not add: only the last line is selected, 1 line deleted | not measured | NOT MEASURED |
| D-74 | WINDOW box around a rectangle's left half (1 side inside, 2 corners inside) | the box takes the 2 corner POINTS too, so 3 sides go | not measured | NOT MEASURED |
| D-74b | CROSSING box, same half | 3 sides | not measured | NOT MEASURED |
| D-74c | WINDOW box around one polygon corner only | the point is boxed: 2 sides + the radius line | not measured | NOT MEASURED |
| D-75 | a line + a point (ours: another line's end) | both lines | a line + a FREE point: both | DIFFERENT (point rule) |
| D-76 / 76c | a whole rectangle (box, or 4 clicks) | 4 lines + 8 points + 8 constraints, nothing left | 4 lines + 4 corners | SAME |
| D-76b | a whole centre rectangle (box) | 4 sides, 2 diagonals, the centre point, 14 constraints | not measured | NOT MEASURED |
| D-76d | a slot: 2 sides + 2 caps | those 4 + 2 Equal + 4 Tangent + Parallel + the Ø dim; the centre line stays | those 4 + 4 Tangent + Parallel + Diameter; the centre line stays | SAME |
| D-77 | Ctrl+A, Delete | ours has no Select-all: NOTHING selected | not measured | NOT MEASURED |
| D-78 | window box over a LOCKED and a HIDDEN sketch + the active one | only the active sketch's line | not measured | NOT MEASURED |
| D-78b | click on a locked sketch's line, Delete | NOTHING | not measured | NOT MEASURED |

### Paths (a lone line selected unless said)

| id | path | OURS | FUSION | verdict |
|---|---|---|---|---|
| D-79 | Delete key | the line | the line | SAME |
| D-80 | Backspace | the line | the line | SAME |
| D-81 | right-click the line > Delete | the line (menu `["geo-lock","geo-delete"]`) | not measured | NOT MEASURED |
| D-81b | right-click a dimension label > Delete dimension | only the dimension | not measured | NOT MEASURED |
| D-81c | right-click a line END > Delete | the line | the Delete command opens with an empty selection, OK greyed | DIFFERENT |
| D-83 | Parameters window | a sketch dimension's row (`pt-dim:d1`, built at `parameter-table.js:633`) has NO bin; only a user parameter row has one (568), refused while in use (586-588) | not measured | NOT MEASURED |
| D-84 | footer red X | the line | (Fusion has none) | ours only |
| L-01..L-06 (live) | phone tap + footer red X; touch-and-hold menu Delete (row 44 px); line end; origin. Desktop: the same by mouse | the same results as the node rows: line deleted, undo restores, origin: nothing, and no hold menu on the origin | — | consistent across devices |

Live probe lines (`.evidence/1042/phone-live.out`):

- `ROW L-02-phone | touch and hold the line, the menu's Delete | before {"shapes":1,...} | after {"shapes":0,...} | undo {"shapes":1,...} | menu ["geo-lock","geo-delete"] delete row 44 px tall phone-hold-menu-line.png md5 2ec1cb3fb022c7476140eaa99c8a6196`
- `ROW L-03-phone | tap the line END, footer red X (the point rule) | ... after {"shapes":0,...}`
- `ROW L-05-phone | tap the ORIGIN, footer red X | ... after {"shapes":1,...} | undo "n/a (nothing deleted)"`

The screenshot `.evidence/1042/phone-hold-menu-line.png` shows the selected line (blue, its 2 end rings) above the phone's hold menu, which has two rows:
"Lock" and "Delete".

### The origin (owner rule 2026-11-27: never deletable, by any path)

| id | case | OURS | verdict |
|---|---|---|---|
| O-01 / 01b | origin clicked, Delete key | NOTHING; the origin is kept at (0, 0), fixed | PASS |
| O-02 | origin clicked, Backspace | NOTHING | PASS |
| O-03 | right-click on the origin | no menu (`path []`); NOTHING | PASS |
| O-04 | origin clicked, footer red X | button disabled; NOTHING | PASS |
| O-05 | Ctrl+A, Delete | Ctrl+A selects nothing; NOTHING | PASS |
| O-06 | window box including the origin + a line, Delete | the line; the origin is never boxed (`selection-tools.js:1046`) | PASS |
| O-06b | box around the origin only | NOTHING | PASS |
| O-07 | a line drawn FROM the origin (it uses `j_origin` itself): the line deleted | the line; the origin kept | PASS |
| O-08 | that line's origin end clicked, Delete | **the line is deleted** (the origin kept) | **BUG-B** |
| O-08b | 2 lines from the origin: the origin clicked, Delete | **both lines deleted** | **BUG-B** |
| O-08c | the same, footer red X | button disabled, NOTHING | (BUG-B's other half) |
| O-08d | the same, right-click on the origin | no menu, NOTHING | PASS |
| O-09 | 2 lines from the origin + a dimension origin-to-point on the 2nd; the 1st deleted | the 2nd line's dimension stays | PASS |
| O-09b | a line from the origin + a SEPARATE line dimensioned to the origin; the 1st deleted | **the other line's dimension to the origin is deleted** | **BUG-A** |
| O-09c | the same with the other line GLUED to the origin | **its Coincident to the origin is deleted** | **BUG-A** |
| O-10 | a rectangle with a corner glued on the origin: the side through it deleted | that side's Coincident to the origin goes; the other side's stays | PASS |
| O-11 / O-12 | X axis / Y axis clicked with the Select tool, Delete | the axes are not pickable in Select (`reference-lines.js:52-56`, only in the reference-pick tools); NOTHING | PASS |

Undo after each: every O-row that deleted something restored exactly (`undo exact`). In no row was the origin removed, moved or orphaned, and no constraint
was left pointing at a missing origin (the `LEFT` column is `none` everywhere).

### Other hosts (spot check)

Rows D-02, D-06, D-07, D-26, D-27, D-52, D-66, D-74, D-80, D-81, D-84, O-01, O-08b and O-09b were rerun in Shaper and Pen Plotter
(`.evidence/1042/hosts.out`). All 28 rows give the same deleted set, leftovers, undo, redo and reload as the SketchStudio rows of the same id. Pen Plotter's
own Delete handler (`apps/penplotter/src/keyboard.js:56-70`) adds no second undo step: `history +1`.

## The DIFFERENT rows, by cause (for the owner)

1. **The point rule** (D-02..D-19 except D-09, plus D-22, D-25, D-75, D-81c): ours deletes every curve that uses a picked point. Fusion never deletes a curve
   end point, centre or origin. Cause: `delete-manager.js:213-221`.
2. **No way to split a joined point** (D-50, D-72, D-72b): Fusion shows SharedPointCoincident glyphs and a "Delete Coincident" menu row. Ours has neither.
   A shared point (polygon, slot, copies) has no glyph, and a glued point's glyph shows only while its point is hovered or selected
   (`svg-renderer.js:2194-2205`).
3. **Copies and relations** (D-10, D-11, D-38, D-39, D-43, D-65):
   - Deleting one pattern-copy curve suppresses the whole instance (`pattern.js:622-625`).
   - Deleting any offset copy or source curve dissolves the offset relation (`delete-manager.js:143`: it names every chain shape). Fusion keeps the
     pattern and offset and deletes only that curve.
   - Deleting the offset dimension keeps a free relation, where Fusion turns it into 4 Offset dimensions.
4. **Bezier is a path of segments** (D-22, D-36): ours deletes one segment, or both at an anchor. Fusion's spline is one curve, and deleting a fit point
   re-fits it.
5. **No confirmation dialog** when a deleted dimension is used by another's formula (D-71). The kept-value behaviour matches Fusion.

## Questions for the owner

1. **The point rule.** Should a picked curve point + Delete do NOTHING, as in Fusion? Ours deletes every curve through the point: a polygon corner takes 2
   sides and the radius line. This is 24 rows of the matrix, and it also decides BUG-B.
2. **Copies.** Deleting ONE curve of a pattern copy or an offset copy: should it delete only that curve and keep the pattern / offset, as in Fusion? Ours
   suppresses the whole pattern instance (D-43: 4 lines) and dissolves the offset relation (D-38).

The rest of the DIFFERENT rows wait behind these two: the split / Delete Coincident, the offset-dimension conversion, the bezier, and the formula dialog.
