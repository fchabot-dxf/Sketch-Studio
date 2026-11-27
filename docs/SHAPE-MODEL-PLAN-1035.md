# Shape model plan (task 1035): how shapes are BUILT from elementary parts, and how they are DRAWN

Status: PLAN ONLY. No app code is changed by this task. Companion of `docs/INPUT-UNIFY-PLAN-1031.md` (on `origin/agents/input-unify-1031`). That plan ends every tool in ONE `build`; this plan is what `build`, every other writer and the renderer stand on.

Owner ask (2026-11-27): "look at how shapes are drawn and how elementary parts are too, joints etc."

**How to read the references**
- `file:line` is at `origin/main` **b3f90902** (this worktree's base). Paths are relative to `packages/` unless they start with `apps/` or `tests/`.
- Short names: `R` = `ui/svg-renderer.js`, `PM` = `ui/preview-manager.js`, `IH/` = `ui/input-handlers/`, `CK` = `core/curve-kinds.js`, `G` = `core/geometry.js`, `CM` = `core/constraint-manager.js`, `TO` = `core/tool-ops.js`.
- I read every line this plan rests on myself: `core/shapes.js`, `core/slot.js`, the six tool commits, `TO` header, `core/constraints.js` `addConstraint`, `CM.createConstraint`, the renderer's shape loop, point loop, fills and previews, `PM`, `core/document.js`, the SVG export, the profile-fill signature, both import landings, the thumbnail, and the trim / break / pattern / offset / import-arcs writer lines.
- Rows marked **(h)** were read by a helper agent (read-only survey) and not re-read by me. Treat them as likely, not proven.
- **(read, not run)** = inferred from the code alone. **(probed)** = run in node on the real app (`tests/helpers/node-app.js`); the probe and its output are in `.evidence/1035/` (untracked), quoted in the appendix.

**The answer in one paragraph.** No. There is no declared set of elementary parts. The four curve kinds (line, circle, arc, bezier), the text record and the joint are implicit: each consumer re-derives what a kind is with its own `type ===` switch. Compound shapes (rectangle, polygon, slot) are stored only as parts plus ordinary constraints; their only identity is a `groupId` string prefix. Shapes are written by about 20 writers. Only arcs, rectangles, polygons, slots and beziers share a maker (`core/shapes.js`, `core/slot.js`), and even those makers' outputs are finished differently by each caller (sweep, constraints entry, groupId). Lines and circles have no maker at all: they are hand-built in 8 places. Drawing: one `draw()` function for every host, but no drawer per part. The final shapes are one inline `if / else` (R:1291-1333). Every preview is separate inline code (R:1644-1860), and five tools draw their own overlays (fillet, offset, pattern, trim, break). Two of those preview copies are wrong today (appendix N-1, N-2, probed).

---

## 1. Elementary parts today

### 1.1 The joint

| Field | Meaning | Where |
|---|---|---|
| key (id) | `state.joints` is a `Map` id → record. Ids come from `state.genJ()` (`j<n>_<time>`) | `core/sketch-state.js` (h) |
| `x`, `y` | world position, Y down | every writer |
| `fixed` | solver: not an unknown | `fixed:false` from the tools (e.g. `IH/rect-tool.js:190`); absent from trim / break / import joints (h, `core/trim.js:83-86`, `ui/sketch-import.js:160`) |
| `orphanAllowed` | the joint survives when its last shape goes (a rect / slot centre) | `core/shapes.js:119-122`, `core/slot.js:251`, `:271`, `:339` |
| `sketchId` | stamped on `joints.set` when absent: the ACTIVE sketch | `core/sketch-state.js:359-360` (h), `core/sketch-model.js:29-32` (h) |
| `textOutline` | a text letter's joint: derived, never saved | `core/text.js:108` (h), `core/document.js:68` |
| `dragTarget` | the solver's mouse spring while dragging: never saved | `core/document.js:43-48` |

The origin is a reserved joint `j_origin`, `{x:0, y:0, fixed:true, sketchId}` (`core/constants.js:58-63`). The two axes are NOT in `state.shapes`: they are `REFERENCE_SHAPES` (`core/reference-lines.js:10-12`) added only to constraint and render "scenes".

### 1.2 The part kinds (records in `state.shapes`)

| Kind | Stored fields (beyond `id`, `type`) | Joints | Where the kind is defined |
|---|---|---|---|
| `line` | `isConstruction` | `[a, b]` | nowhere: an object literal in 8 writers (1.3, 2.2) |
| `circle` | `radius` (a solver unknown, task 515), `isConstruction` | `[centre]` (a legacy rim joint is ignored, R:1302) | nowhere: object literals (`IH/circle-tool.js:112`, `TO:124`, `core/offset.js:354`, imports) |
| `arc` | `subType: 'CENTER'` (the only one drawn: `G:209-216` returns "" for any other), `sweep` boolean (true = increasing angle; absent = the shortest way, `G:264-279`), `isConstruction`, `groupId`, `filletSharp` (a fillet arc's virtual corner) | `[centre, start, end]` | `makeArc` `core/shapes.js:273-285` + `arcStructuralConstraints` `:294-297`; also `arcShape` `core/import-arcs.js:12-14` (a second arc literal, no `groupId`) |
| `bezier` | `c1`, `c2` (ABSOLUTE `[x, y]`, shape data, not solver unknowns), `groupId`, `isConstruction` | `[p0, p3]` | `makeBezier` `core/shapes.js:306-318` |
| `text` | `text`, `font`, `fontKind`, `fallback`, `size`, `letterSpacing`, `lineSpacing`, `align`, `rotation`, `userGroupId` | `[anchor]` | `addText` `core/text.js:170` (fields `:4-5`). Its letters are derived `line` / `bezier` parts marked `textOutline` (`core/text.js:99-133`), never saved (`core/document.js:66-69`) |

Fields every kind may carry: `groupId` (a maker's compound id, 1.3), `userGroupId` (the user's group, `core/group-model.js`), `sketchId` (stamped by the `shapes.push` wrap, `core/sketch-state.js:361-362` (h)), `isConstruction`, `descId` (import only, deleted after landing, `ui/sketch-import.js:170`), `dragTarget` (transient).

**What is declared per kind today, and where.** Nothing declares the kinds as a set. Per-kind knowledge sits in at least six separate tables or switches:
- `CK:143-185` `CURVE_KINDS`: line, arc, bezier only (no circle, no text). It has `ends`, `leave`, `bulge`, `points`, `pathSeg` (h for the full list).
- `core/curve-cuts.js:20-31` `curveGeom`: line, arc, circle (no bezier) (h).
- `R:1462-1476`: which joints are a centre / an end / a curve joint, by its own `type` switch.
- `core/geometry-bounds.js:83-141`, `ui/snap-detection.js:51-102`, `core/core-shape-to-polyline.js:23-52`: one switch each (h).
- The SVG / DXF writers (`apps/sketchstudio/ui/export-manager.js:14`, `:144-230`): their own switch.

### 1.3 Compound shapes: stored as parts only

No compound is stored as one record except text. A rectangle, polygon or slot is its lines and arcs, plus constraints that are ordinary constraints. Its identity is only a `groupId` string. Nothing on a constraint says it is part of a shape's definition: `CM:43-48` `STRUCTURAL_TYPES` means "a geometric, non-dimension type", not "this shape's own rule", and the `source: 'rect'` option is only logged (`CM:446`).

| Compound | Parts written | Joint convention | Its own (defining) constraints | `groupId` | Where |
|---|---|---|---|---|---|
| Rect 2-point | 4 lines | 8 joints: two per corner (the input corners are reused) | H, V, H, V + 4 COINCIDENT | `rect_<seq>` | `core/shapes.js:13-62` |
| Rect centre | 4 lines + 2 construction diagonals (in the group) | 12 corner joints (three per corner) + the centre (`orphanAllowed`) | H, V, H, V + 8 COINCIDENT + 2 POINT_ON_LINE (centre on each diagonal) | `rect_<seq>` | `:68-145` |
| Rect 3-point | 4 lines | 8 joints | 4 PERPENDICULAR + 4 COINCIDENT | `rect_<seq>` | `:152-216` (returns `[]` on failure at `:157`, `:163`, an object elsewhere) |
| Polygon | N lines + N construction radii (no group) | N SHARED corners (no coincident) + the centre | 2(N-1) EQUAL (sides, radii) | `poly_<seq>` (sides only) | `:236-268` |
| Arc (tool) | 1 arc | `[c, s, e]` | EQUAL `joints:[c,s,c,e]` | `arc_<seq>` | `:273-297` |
| Bezier path | 1 bezier per segment | anchors shared between segments | none | `bezier_<seq>`, overwritten with the path's id | `:306-318`, `IH/bezier-tool.js:155` |
| Straight slot (3 modes) | 2 lines, 2 arcs, 1 construction centreline | caps' rim joints shared with the sides | 2 arc EQUAL, 4 TANGENT (line-arc), PARALLEL, a width DISTANCE (diameter); Overall: + 4 POINT_ON_LINE; Center: + MIDPOINT | `slot_<seq>` (not the centreline) | `core/slot.js:159-265` |
| Arc slot (2 modes) | 5 arcs (the centre arc construction, no group) | shared | 5 arc EQUAL, 3 TANGENT (with `branch`), width DISTANCE; 3-point: + POINT_ON_LINE for a bound p3 | `slot_<seq>` | `core/slot.js:267-358` |
| Text | 1 `text` record; letters derived | letters' joints shared within a contour (h) | none (constraints on letters refused, `CM:168`) | none; `userGroupId` from `makeGroup` | `core/text.js:170-178` |

Who reads `groupId` (grep `.groupId` outside tests): the renderer's closed-shape tint (R:720-780, section 3.6), the Select tool's "centre of a group" drag (`IH/selection-tools.js:438-456`), the bezier tool's path, and paste / mirror / pattern, which remap it (`ui/clipboard.js:140`, `core/mirror.js:125`, `core/pattern.js:459`). No code reads the prefix (`rect_`, `slot_`): grep for `'rect_'` finds only the makers.

---

## 2. Builders

### 2.1 The tools

| Tool / variant | The commit that writes the document | Parts made by | How its defining constraints are added |
|---|---|---|---|
| Line (chain) | inline, TWICE: the click `IH/line-tool.js:524` and Enter `:613`; the next segment's start = a new joint + COINCIDENT (`:561`, `:636`) | object literal | raw `addConstraint` (`core/constraints.js:525`) |
| Circle | `commitCircle` `IH/circle-tool.js:108-139` (one path for click and Enter, task 1013) | object literal (`:112`) | none (a typed Ø → a DISTANCE through raw `addConstraint`, `:117`) |
| Arc, Center Point + 3-Point | `commitArc` `IH/arc-tool.js:435-446` | `makeArc`, then `sweep` set by the tool (`:446`) | `ConstraintManager.createConstraint` (`:441`) |
| Rect, 3 variants | `placeRect` `IH/rect-tool.js:186-212` | `makeRect*` | `ConstraintManager.createConstraint` (`:197`), plus a COINCIDENT with any joint within 0.01 (`:203-207`) |
| Polygon | `createPolygon` `IH/polygon-tool.js:136-179` | `makePolygon` | raw `addConstraint` (`:161`) |
| Slot, 5 modes | `commitSlot` `IH/slot-tool.js:271-397` | `makeSlot*` | raw `addConstraint` (`:352`) |
| Bezier | `handleBezierPointerUp` `IH/bezier-tool.js:135-177` | `makeBezier`, then `groupId` and `isConstruction` set by the tool (`:155-156`) | none |
| Text | `addText` `core/text.js:170` | its own literal | none |

**`core/tool-ops.js` is a second copy of every tool's build.** Its header (`TO:1-8`) says each operation "calls EXACTLY the core function(s) the tool's input handler calls, in the same order". It is used by templates (`core/templates.js`), the dimension tool, the audit harness and tests. `TO.polyline :87`, `TO.circle :121` rebuild the line and circle literals a third time. BUG-005 was this copy drifting from the tool (re-exposed in task 680).

**Divergences between tool builders**

| Id | What differs | Status |
|---|---|---|
| B-1 | **Two constraint entry points for a shape's own rules.** Rect and Arc go through `CM.createConstraint` (`CM:146-300`): validation, branch locks (perpendicular handedness `:209-211`, tangent side `:216-218`, parallel orientation `:179-181`), a duplicate check, the math pre-check and a sandbox solve per constraint (`:259-300`), which may REFUSE a structural constraint (`:266-271`). Polygon, Slot, the Line chain and every non-tool writer use raw `addConstraint` (duplicate check, then push; no branch lock, no verify). So a rect's 8 rules each cost a sandbox solve, a polygon's 2(N-1) cost none, and a refused rect rule would leave the rect half-defined. | open (read, not run) |
| B-2 | Line and Circle have no maker; their literal is written in the tool, `TO`, offset, close path and the imports (2.2). | open |
| B-3 | Line commit written twice (click vs Enter): the input plan's L-2. | open (1031 step 5) |
| B-4 | `makeArc` writes no `sweep`; every caller sets it by its own rule (2.3 W-3). | open |
| B-5 | `makeRectFrom3Points` returns `[]` on failure, the other makers `{shapes:[], constraints:[]}` (`core/shapes.js:157`, `:163` vs `:17`, `:72`). Callers survive only because they test `rectResult.shapes`. | open (harmless today) |
| B-6 | The tool's `isConstruction`: rect, polygon, line, circle and the slot's lines write a boolean always; every arc made by `makeArc` (the slot's too) and the bezier write it only when true (`core/shapes.js:283`, `:316`). | open |

### 2.2 The non-tool writers

| Writer | Where | Through a maker? | Arc's EQUAL rule | Arc `sweep` from | `groupId` | Joints |
|---|---|---|---|---|---|---|
| Paste / duplicate | `ui/clipboard.js:117` `pasteDocument` (h) | no: copies every field but `sketchId`, `userGroupId` (`:138`) | copied with the other constraints whose operands are all copied, `addConstraintObject` (`:166`) | copied | remapped `paste_<seq>_<n>` (`:140`) | 1:1 as in the source |
| Circular / rect pattern | `core/pattern.js:446` `makeInstance` | no: copies the rest of the fields (`:457-458`) | `makeArc(null, ...)` is called only for its constraints; its shape is thrown away (`:462`); pushed raw | copied | `pattern_<seq>_<n>` (`:459`) | coincident clusters COLLAPSED to one shared joint (h, `:110-117`) |
| Mirror | `core/mirror.js:89` (h) | no | `makeArc(...).constraints`, `addConstraintObject` | flipped if boolean (`:37`) | `mirror_<seq>_<n>` (`:125`) | clusters collapsed (h) |
| Offset | `core/offset.js:336-366` | arcs `makeArc` (`:357`); lines (`:350`), circles (`:354`) literals | pushed raw (`:361`) | `p.dir > 0` (`:359`) | lines / circles none; arcs `arc_*` | SHARED vertices, no coincident |
| Fillet | `core/fillet.js:458` (h) | `makeArc` (`:589`) | pushed raw (`:596`) | `arcSweepInfo(...).dir > 0` (`:591`; BUG-096 was its absence) | `arc_*` | tangent joints shared with the trimmed legs |
| Trim | `core/trim.js:66` | no: `{...target, id:'Atrm_..', joints, sweep}` (`:171`) | dropped and `arcStructuralConstraints` pushed raw per piece (h, `:257-266`) | `g.dir > 0` | **inherited**: both halves keep the parent's | two fresh cut joints `{x,y}` |
| Break | `core/break.js:103`, `:143`, `:216` (h) | no: `{...shape}` copies | pushed raw per piece | `g.dir > 0`; a circle's pieces `true` (`:248-254`) | inherited; a circle turned arc gets none | the split joint shared |
| Close path | `core/close-path.js:186-204` (h) | literal (`:201`) | n/a | n/a | none | 2 new joints + COINCIDENT (the Line tool's way) |
| Templates | `core/templates.js:1094` (h) | through `TO` only | as `TO` | always `false` (`:120`) | as the makers | as `TO` |
| SVG import | `core/svg-import.js:240` (h) | literals (`:259`, `:290`, `:304`, `:321`) + `arcShape` | added at landing | `fS`, flipped when det < 0 (`:289`) | **none** | shared along a subpath |
| DXF import | `core/dxf-import.js:256` (h) | literals + `arcShape`; beziers literal (`:302`) | added at landing | `yUp ? !ccw : ccw` (`:299`) | **none** | merged by tolerance |
| Import landing (shared) | `ui/sketch-import.js:150-167` | pushes the parsed parts | `arcStructuralConstraints` pushed raw (`:164`, TASK 789) | as parsed | none; `userGroupId` from `groupImported` (`:167`) | `{x,y}`, no `fixed` (`:160`) |
| **Fusion / STL import landing (Shaper)** | `apps/shaper/src/fusion-import.js:382-398` | `buildShapesFromPrimitives` (the DXF builder) | **not added** | as parsed | none | as parsed |
| Text letters | `core/text.js:99-133`, rebuilt by `syncTextOutlines` (`ui/text-fonts.js`, not checked) | literals | n/a | n/a | none | shared within a contour |
| Document load | `core/document.js:123-167` | pushes stored records verbatim minus `dragTarget` (`:138`) | as stored (no repair) | as stored | as stored | as stored |
| Undo / redo restore | `core/sketch-state.js:122`, `:304` (h) | snapshot copies (a second codec of the same fields, `core/document.js:8-10`) | as captured | as captured | as captured | as captured |
| Headless sketch / demo | `ui/sketch-canvas.js:45`, `:64` (h) | literals `L_a_b` | n/a | n/a | none | as given |

### 2.3 Divergences between writers of the same part

| Id | Divergence | Status |
|---|---|---|
| W-1 | **A Fusion / STL import's arcs get no EQUAL rule.** The shared landing adds `arcStructuralConstraints` (`ui/sketch-import.js:164`, BUG-046 / task 789); Shaper's Fusion landing (`apps/shaper/src/fusion-import.js:389-398`) pushes the same parsed arcs without it, and without `groupImported`. Dragging one end of such an arc then stops it being circular (BUG-046's symptom). | **NEW** (read, not run): appendix N-5 |
| W-2 | Arcs without a `groupId`: imports (`core/import-arcs.js:13`) and a circle turned arc (`core/break.js:248-254`). Trim / break pieces share the parent's. Copies get `paste_` / `mirror_` / `pattern_`. | open |
| W-3 | `sweep`: 10 rules for one field (2.2 column). The rule "true = increasing angle" is one (`G:264-279`), but each writer derives it itself; BUG-096 (fillet arcs had none) was this class. | open; BUG-096 fixed |
| W-4 | The EQUAL rule enters by four routes: `CM.createConstraint` (Arc tool, `TO`), `addConstraintObject` (paste, mirror), raw `addConstraint` (slot), raw `state.constraints.push` (pattern, offset, fillet, trim, break, import landing). | open |
| W-5 | Field sets: a circle's `isConstruction` is a boolean from the tool, absent from offset / imports (h); joints `{x,y,fixed:false}` from tools, `{x,y}` from trim / break / import landing. | open |
| W-6 | **Three joint conventions for "two parts meet here"**: (a) two joints + COINCIDENT: Line tool, close path, rect makers; (b) one shared joint: polygon, bezier path, offset, fillet, break, imports, text letters; (c) a coincident cluster collapsed into one shared joint: mirror, pattern (h). The renderer and solver handle all three through cluster leaders (R:1595-1596). | open (owner question Q2) |
| W-7 | `filletSharp` is copied onto BOTH pieces by trim (`core/trim.js:171`, spread of `target`) and break (`core/break.js:157`, h), so two arcs can claim one virtual corner. Mirror / pattern strip it (`core/pattern.js:457`). | **NEW** (read, not run): appendix N-7 |
| W-8 | Load repairs nothing: a file saved before task 789 keeps its arcs without the EQUAL rule (`core/document.js:138`). | open (by design: a load restores exactly, task 1019) |
| W-9 | Pattern builds a whole `makeArc` shape (burning an id) to obtain one constraint (`core/pattern.js:462`). | open (harmless) |

---

## 3. Drawing

### 3.1 One `draw()`, no drawer per part

`draw()` (R:439, 19 positional parameters) builds every frame into one markup collector and writes `innerHTML` once (h, R:2925-2932). Every host calls it (3.7). Inside it there is **no function per part kind**: the final shapes are one inline `if / else` on `s.type`:

| Kind | Final drawer | Path maths |
|---|---|---|
| line | R:1291-1297 `<line>` | inline |
| circle | R:1298-1309 `<circle>` | inline, `s.radius` |
| arc | R:1310-1322 `<path>` | `calculateArcPath` `G:209-217` → `arcSweepInfo` `G:264-279` |
| bezier | R:1323-1333 `<path>` | `cubicPathD` `G:223-226`; end = `joints[1]` (CK uses `joints[length-1]`, h) |
| text | no branch: the record draws nothing; its letters draw as lines / beziers | — |

Selection, hover, construction, locked, conflict and dimmed are **attributes on that same element**, computed in the loop (R:1257-1290) and by `getConstructionStyles` (R:620-629) (h for the colour order). That part is already "one element, a declared style". The rest is not.

### 3.2 Preview (mid-draw) vs final: separate code for every kind

Tools call `safeUpdatePreview` (`IH/base-tool.js:89`) → `PM.updatePreview` (`PM:25-72`), which writes `state.preview` and mirrors a reduced copy into `state.active.preview` (`PM:39-66`). The renderer reads only `active.preview`.

| Preview | Drawer | Same code as the final part? | Its geometry |
|---|---|---|---|
| line | R:1772-1773 | no | from `active.start` / `startPt`, not `preview.p1` |
| circle | R:1774-1776 | no | radius = cursor distance; `preview.radius` **ignored** → N-2 |
| arc | R:1644-1680 | no: a hand-built `A` string (R:1673), not `calculateArcPath` | its own flags; `PM:58` drops the tool's `largeArc` / `sweep`, so R:1668-1671's fallback runs → N-1 |
| bezier | R:1687-1700 | no: the `C` string written again (R:1691) | the tool's segment |
| polygon | R:1777-1789 `<polygon>` | no (final: N lines) | the vertex loop written again (same formula as `core/shapes.js:247-253`) |
| rect / rect-centre | R:1790-1825 `<rect>` | no | corners computed in the renderer |
| rect-3pt | R:1827-1858 | no | c3 / c4 again (`core/shapes.js:159-173`'s maths) |
| slot | R:1702-1760 | partly: its arcs use `calculateArcPath` (R:1704) | the core's `computeStraightSlotPoints` / `computeArcSlotPoints` (`core/slot.js:62`, `:110`): **the one preview that shares the builder's geometry** |
| size labels | plain `<text>` (R:1803-1805, 1822-1824, 1847, 1854) | not the dimension drawer | — |
| a dimension being placed | the real constraint flagged `__placing`, drawn by the normal dimension code at 40 % (h, R:2666-2667) | **yes** | — |
| fillet / offset / pattern / trim / break | each tool's own `innerHTML` overlay (h): `IH/fillet-tool.js:559-651`, `IH/offset-tool.js:304-343`, `IH/pattern-tool.js:961-991` (an arc ghost drawn as a full circle, `:981`), `IH/trim-tool.js:105-127`, `IH/break-tool.js:106-131` | no | from core geometry functions (`cornerFilletGeometry`, `offsetChainGeometry`, `patternSlotGeometry`, `trimPreview`) |

Copies of the arc's `A` command outside `G:209-217` (h for those I did not open): R:1673 (preview), R:1943 and R:2789 (angle dimension), R:2686 and R:2800 (dimension extensions), R:1159 (debug), `IH/fillet-tool.js:591`, `:607`, `:626`, `IH/offset-tool.js:326`, `:334`, `IH/trim-tool.js:107`, `ui/template-picker.js:353`, the export (`apps/sketchstudio/ui/export-manager.js:182-189`, `:273`), and a dead one reading the ignored `largeArc` (`core/shaper-export.js:41-52`).

### 3.3 Points

- **One visibility RULE**, `isPointVisible` (R:421-429): hidden follower → never; else hovered, selected, active snap, open end, centre or lone (task 622).
- Its inputs come from the renderer's own per-kind switch: centre = circle / text `joints[0]` or a CENTER arc's `joints[0]` (R:1466-1474); arc ends get a handle (R:1475-1476); open end = cluster end count 1, not on a curve, not a letter (R:1596); lone (R:1595).
- **Several point DRAWERS** (h for those outside R:1593-1620): the regular joint (R:1600-1608), the arc-end handle ring (R:1612-1618, arcs only although its comment says arc/circle), the origin (R:1530-1573), red discs under origin-coincident joints (R:1439-1443), virtual-sharp crosses (R:1585-1592), close-path open-end rings (R:1630-1634), snap rings (R:1985-1994), the dots inside the arc / slot / bezier / rect-centre previews (R:1677-1679, R:1698, R:1816), and outside R: fillet dots, break markers, the pattern centre ring (`IH/pattern-tool.js:971`).
- Held picks: the constraint tools put their picks in `state.selectedJoints` (h, `IH/constraint-tools.js:222`, `:302`, `:451`), so they show as "selected". Task 1034 is adding "held picks drawn as point marks in one place"; I did not read its branch (worker rule: no git outside this worktree).

### 3.4 Dimensions and constraint glyphs

Drawn only inside `draw()`, so shared by every host: glyphs through `drawUnifiedGlyph` (R:678-713) on the glyph sheet (`ui/fusion-glyphs.js`, `ui/glyph-sheet.js`); dimensions R:2654-2836; picking through `ui/hover-manager.js:21-60` (h). The angle-dimension PREVIEW is a separate copy of the final angle arc (R:1911-1950 vs R:2771-2836, h). Dimensions are the model to copy: one drawer, the placing state a style flag.

### 3.5 Styling and tokens (h)

The renderer maps colours to CSS tokens by hex (R:116-133). Free geometry `#60A5FA` maps to `--sk-constraint-fill`, not `--sk-geo-free`, and `--sk-hover` is never read, so a host's `--sk-geo-free` / `--sk-hover` override does not reach the geometry (h). Construction's orange overrides the hover / selection colour (R:620-629, h).

### 3.6 Fills: three mechanisms, one keyed on `groupId`

| Fill | Where | What it fills |
|---|---|---|
| closed-shape tint | R:720-780 | only `line` shapes that carry a `groupId`, grouped by it, when they form one simple loop: **a tool-made rect or polygon**. The same closed outline drawn with the Line tool, imported, or offset (no `groupId`) gets no tint (read, not run). A second loop finder beside `core/loop-finder.js`. |
| PROFILE_FILL | R:785-797, `ui/profile-fill.js` | every closed loop through `findLoops`; off unless the `PROFILE_FILL` setting is `on` (R:506) |
| profile tints | R:800-816 | stored `state.profiles`; only when `ctx.getState` exists, which SketchStudio's frame does not pass (h) |

### 3.7 Hosts

- All four call the same `draw()`: SketchStudio through `studioFrame` (`apps/sketchstudio/design-canvas.js:61`); Shaper, Pen Plotter and Trace through `mountSketch` (`ui/sketch-canvas.js:175`). No host check exists in R, PM or the tool previews (h: grep for `appId`, `isShaper`, `penplotter`, `trace` finds comments only).
- Per-host differences are options and CSS, not branches:
  - **Pen Plotter `isStatic`** (`ui/sketch-canvas.js:160-174`): untouched shapes and their joints are removed from `draw()` and drawn instead by the plotter's own underlay as polylines through `coreShapeToPolyline` (h, `apps/penplotter/src/sketch-stage.js:190-212`). So in Pen Plotter one arc is drawn by two different drawers depending on whether it is selected.
  - **Shaper Prepare**: its own edge renderer with three per-type switches (h, `apps/shaper/src/prepare-view.js:39-57`, `:201-207`, `:302-304`).
  - **SketchStudio Drawing view**: `CLEAN_DISPLAY` (R:197), a declared display profile: the right shape for host differences.

### 3.8 Export and other consumers (h unless cited with a probe)

| Consumer | Kinds | Arc / circle sampling | Notes |
|---|---|---|---|
| SVG / DXF export (`apps/sketchstudio/ui/export-manager.js`) | `EXPORTED_TYPES` line, arc, bezier, circle, not construction (`:14-15`, BUG-300) | own `sampleArcPoints` / `sampleCirclePoints`, 32 by default (`:24-49`, `:56`) | closed LINE loops detected by its own coordinate-key cycle finder (`:76-141`) and written as `<polygon>` **without the Y flip** → N-3 (probed). Text: the record skipped, its letters exported. |
| `core-shape-to-polyline` (Pen Plotter, thumbnail) | L, C (64), A (`sampleArc` 24), B; text → [] | `sampleArc` uses the DOM's `getPointAtLength`; in Node only the end points (CK:62-77) | does not filter construction |
| loop-finder / loop-geometry / profile-model / Shaper export | L, A, B through `CURVE_KINDS`; circle special-cased; text ignored | circle 48 in `loopPolygon`; arcs 24 | |
| hold-part / pocket-clearing | L, A, C exact, B by `curvePointsFrom` | chord tolerance 0.005 mm | |
| geometry-bounds | L, C, A, B exact; any other kind by its joints | — | counts a text's anchor (not drawn) in `drawingExtent` |
| design thumbnail (`ui/design-thumbnail.js:13-30`) | through `coreShapeToPolyline` on the STORED document | as above | the stored document has no letters → a text-only design has no thumbnail (N-4, probed); draws construction (export does not) |
| profile-fill cache (`ui/profile-fill.js:15-30`) | hashes joints, type, construction, radius, sweep | — | **not** a bezier's `c1` / `c2` → N-6 (read, not run) |

So the same arc is sampled at 24, 32, 48 (circle), 64 (circle) points or by a 0.005 mm tolerance, depending on the consumer.

---

## 4. The target

### 4.1 One part model: what is a part, what is a shape

- **A PART** is one record of a declared **part kind**: `joint`, `line`, `arc`, `circle`, `bezier`. A part kind declares its fields, its joint roles, its own structural rule and its geometry. Text stays a record with DERIVED parts (its letters), the one existing example of a compound kept as one record.
- **A SHAPE** (a compound: rect, polygon, slot, a bezier path, a text) is a **declared recipe**: from plain points and values it returns the parts and the defining constraints. It is stored as today: its parts, its constraints, one `groupId`. Nothing new is stored (section 6 and Q1).
- The joint conventions of W-6 are declared per recipe, not chosen per writer (Q2).

### 4.2 Declare it once: `PART_KINDS` (extend `core/curve-kinds.js`, do not add a seventh table)

`CK` is already "the per-kind table" (its header, `CK:1-4`) and is imported by loop-finder, loop-geometry, profile-model, Prepare and the export. It grows to cover every part kind, and the other tables (1.2) read it instead of their own switch:

| Entry | Replaces |
|---|---|
| `circle` kind (today missing) | every "circle is its own loop" special case (loop-finder, loop-geometry, snap, bounds, export) |
| `fields(kind)` + `make(kind, fields)`: the one normalised field set (`isConstruction` boolean, `sweep` boolean for an arc, `subType`, `radius`, `c1`/`c2`) | the 8 literals of 2.2 and W-5 |
| `structure(part)`: the kind's own rule (today only the arc's EQUAL, `core/shapes.js:294-297`) | `arcStructuralConstraints` and its four entry routes (W-4) |
| `roles(part)`: centre / ends / controls | R:1462-1476, `curveEnds`, the end-joint index disagreement (`joints[1]` vs `joints[length-1]`) |
| `pathD(part, J)`: the ONE SVG path | `calculateArcPath`, `cubicPathD`, the inline line / circle, the 14 `A` copies (3.2) |
| `points(part, J, tol)`: ONE sampler by chord tolerance, no DOM | `sampleArc` (DOM, 24), export 32, `loopPolygon` 48, polyline 64, hold-part's own |
| `bounds(part, J)` | `core/geometry-bounds.js`' switch |

`core/curve-cuts.js` `curveGeom` (trim / break) becomes the cut entries of the same table.

### 4.3 One builder per part kind, used by every writer

- `addPart(state, kind, fields, { joints })` in `#core`: makes the record through `make`, pushes it (the `shapes.push` wrap stamps the sketch as today), and adds `structure(part)` through ONE constraint entry, `addStructural`. Returns the id.
- `addStructural`: the defining rule's meaning-carrying steps of `CM.createConstraint` (normalise, the branch locks: tangent side, perpendicular handedness, parallel orientation) and the duplicate check, **without** the conflict refusal and the sandbox solve: a fresh shape's own rules are consistent by construction. This is B-1 decided one way; see behaviour change BC-2.
- **Recipes** (`#core`, beside `core/shapes.js` / `core/slot.js`): `RECIPES.rect2pt`, `rectCenter`, `rect3pt`, `polygon`, the 5 slots, `arc`, `bezierSegment`, `lineSegment`, `circle`. Each is `points + values → { parts, constraints }` as plain data (no state), so **the preview and the build run the same recipe**: the build passes the result to `addPart` / `addStructural`; the preview hands it to the drawer.
- **`core/tool-ops.js` becomes the tools' `build`.** The input plan's ONE `build` per tool is the `TO` operation (or calls the same recipe), so the second copy of B-2 / BUG-005 goes.
- **Every other writer uses `addPart`**: paste, mirror, pattern (a copy = `addPart` with the source's fields transformed), offset, fillet, trim, break, close path, both import landings (the Fusion landing calls the shared landing: fixes W-1), the text letters (`make` for the field set). Load and undo restore stay verbatim (they put back what was stored; section 6).

### 4.4 One drawer per part kind, used by preview and final

- `drawPart(part, J, style)` in `#ui` (one function per kind, from `pathD` and `roles`), called by: the final shape loop (R:1291-1333), every preview, the tool overlays (fillet / offset / pattern ghosts, trim / break pieces), hover and selection (style only), and the Pen Plotter underlay and Shaper Prepare (as a declared style / display profile instead of their own drawers).
- **A preview is ghost parts.** The input plan's step `preview` returns what the recipe returns for the current picks and the cursor (or the typed values). The renderer draws those parts with `drawPart(..., 'preview')`. Then a typed Ø or a sweep across 180° is drawn exactly as built (fixes N-1, N-2), and R:1644-1860, `PM:39-66` and the rect / polygon geometry copies go.
- **One point drawer**, `drawPoint(pt, role, style)`, for every point kind of 3.3 (regular, selected, hovered, origin, virtual sharp, end handle, snap ring, preview dot, held pick). `isPointVisible` stays THE rule; its inputs come from `roles`. The session's held picks (input plan 2.2: "picks are plain points held in the session") are drawn by it, which is what task 1034 starts.
- **Styles are declared data**: `DRAW_STYLES = { final, construction, preview, ghost, lit, selected, hovered, static, dimmed }` (stroke, dash, opacity, width factor, token). Hosts differ only by display profile (as `EDIT_DISPLAY` / `CLEAN_DISPLAY`, R:195-197) and CSS tokens; the hex-to-token map (3.5) maps every geometry colour to its token.
- **One fill**: the closed-shape tint comes from `findLoops` (the one loop finder) for every closed outline, not from `groupId` (BC-4).

### 4.5 Consumers

The export (SVG / DXF), the thumbnail, the plotter polylines, loops and bounds read parts through `PART_KINDS` (`pathD`, `points`, `bounds`). The SVG export's own cycle finder (`export-manager.js:76-141`) is replaced by `findLoops` (fixes N-3 as a side effect; N-3 should first be fixed on its own as a bug).

---

## 5. Migration, interleaved with the input plan

**Rules**: one step per merge; the old path deleted in the same merge; every step byte-compares documents and draw output before and after on fixtures (below) and explains every difference. Bugs N-1..N-4 can be fixed first as small bug tasks; the steps below then keep them fixed.

### 5.1 Step 0 (before or with the input plan's Circle trial, 1031 5.1)

- `PART_KINDS` extended (circle entry, `make`, `structure`, `roles`, `pathD`); `addPart`, `addStructural`; `drawPart` and `drawPoint` in `#ui`; R's final shape loop and point loop switched to them.
- **No behaviour change.** Proof: a new node test renders fixture designs (every tool's shape, construction, selected, hovered, a text, an import) through `draw()` and compares the markup before and after (a golden file taken on main first); `tests/svg-renderer-arc.test.js`, `tests/svg-renderer-coincident-visual.test.js`, `tests/joint-display-node.test.js` / `-live.test.js`, `tests/arc-direction.test.js`, `tests/extreme-arcs.test.js`, `tests/profile-fill.test.js`, shell-smoke 12/12.

### 5.2 The steps, against the input plan's merges (1031 5.2)

| # | Input-plan merge | What this plan brings in the same merge (or just before) | Fixes | Guarding tests (beyond the 1031 list for that tool) |
|---|---|---|---|---|
| 1 | Circle trial | `RECIPES.circle`; `commitCircle` and `TO.circle` → `addPart('circle')`; the preview = ghost parts | N-2 | `circle-tool.test.js`, `circle-radius-dof.test.js`, `circle-typed-snap-b8-1013-node`, `draw-undo-shapes-node`, the step-0 golden render |
| 2 | Polygon | `RECIPES.polygon` (from `makePolygon`), `addStructural`; R:1777-1789 deleted | — | `polygon-tool.test.js`, `polygon-tool-live`, `template-recipes-680` (hexagon) |
| 3 | Arc | `RECIPES.arc` with an explicit `sweep`; `commitArc` / `TO.arc` → it; `PM:56-59` and R:1644-1680 deleted | N-1 | `arc-tool.test.js`, `arc-3point-1022-node/-live`, `arc-preview-contract.test.js` (rewritten to the ghost parts), `arc-direction`, `extreme-arcs`, `arc-no-self-weld-1009-node` |
| 4 | Rect (3 variants) | `RECIPES.rect*`; B-1 decided (`addStructural`); R:1790-1858 deleted; B-5 gone | — | `rect-two-point-click`, `rect-center-click`, `rect-snap-constraint-867-*`, `rectangle-anchor-dof`, `filleted-rectangle-rigidity`, `template-recipes-680` |
| 5 | Slot (5) | slot recipes (`core/slot.js` already pure); raw `addConstraint` → `addStructural`; R:1702-1760 → `drawPart` | — | `slot-tool-node/-live`, `done-button-slot-653` |
| 6 | Line | `RECIPES.lineSegment` = THE segment build (1031's L-2) and `TO.polyline` | B-3 | `line-tool*.test.js`, `line-start-double-joint`, `joint-id-unique` |
| 7 | Bezier | `RECIPES.bezierSegment` (`groupId` rule declared, B-6); preview R:1687-1700 → ghost parts | — | `bezier-*-node`, `bezier-loops-761-*`, `bezier-fixed-ends-b20b-node` |
| 8 | Trim, Break | pieces through `addPart` (W-2, W-5, W-7); overlays → `drawPart('ghost')` | N-7 | `trim-break.test.js`, `trim-*-1018-node`, `trim-constraints-789-node`, `break-*-node` |
| 9 | Close Path | `addPart('line')` | — | `close-path-760-*` |
| 10 | Constraint tools | none (held picks: `drawPoint`, with 1034) | — | as 1031 |
| 11 | Mirror | copies through `addPart` | — | `mirror*.test.js`, `selection-mirror-795c-*` |
| 12 | Fillet | the arc through `addPart`; overlay → `drawPart` | — | `fillet-*` (node + live), `fillet-sweep-1009` |
| 13 | Offset | `addPart` for lines / circles / arcs; overlay → `drawPart` | W-5 | `offset-*` |
| 14 | Text | letters through `make` (field set only) | — | `text-845-*` (all hosts) |
| 15 | Patterns | `makeInstance` through `addPart`; ghosts → `drawPart` (an arc ghost becomes an arc) | W-9 | `pattern-*`, `solver-pattern-order` |
| 16 | Dimension | none (already one drawer); the angle preview → the final angle drawer | — | `angle-dimension-*`, `svg-renderer-angle-preview` |
| 17 | Select | not checked (drag ghosts, transform box) | — | as 1031 |

**Steps that do not wait for a tool merge** (any time after step 0):
- N-a **Import landings**: the Fusion / STL landing calls the shared landing (W-1, N-5). Tests: `import-arc-equal-789-node`, `fusion-import-664-node/-live`, `sketch-import-*`, `dxf-import*`, `svg-import*`, `files-audit-1024-import.mjs`.
- N-b **Paste** through `addPart`. Tests: `clipboard*.test.js`, `reference-lines-clipboard`.
- N-c **Consumers** on `PART_KINDS.points` / `pathD` (one sampler): export, thumbnail, polylines, bounds. Tests: `export.test.js`, `export-roundtrip-1027-node`, `export-own-*`, `shaper-export.test.js`, `penplotter-export*.test.js`, `loop-finder`, `loop-geometry`, `stock-loop*`, `pocket-*`, `files-audit-1024-export.mjs`, `files-audit-1024-roundtrip.mjs`. A sampler change moves sampled points: each changed number is explained, not re-baselined blind.
- N-d **Fill**: one `findLoops` tint (BC-4). Tests: `profile-fill.test.js`, the golden render.
- N-e **Hosts**: the Pen Plotter underlay and Shaper Prepare onto `drawPart` with a declared style. Tests: `penplotter-*`, `prepare-*`, `text-845-penplotter*`, `text-845-shaper*`.

Every step also runs: the audits whose rows touch the tool (`tests/audits/drawbox-audit-1026-*`, `interrupts-audit-1023-*`, `design-run-audit-1016/1017-*`, `files-audit-1024-*`, `snap-constraint-audit-869`), ROW lines diffed before / after; `draw-undo-*-node`; shell-smoke 12/12.

---

## 6. Risks, behaviour changes, format

### 6.1 Risks

- R-1. The renderer is about 2930 lines with many closures sharing loop state (cluster leaders, hover sets). Moving the final loop onto `drawPart` must be byte-identical; the golden render (5.1) is the only proof. If it cannot be byte-identical, every difference is listed and explained.
- R-2. The input plan holds picks as plain points until `build` (its R-4). The ghost-part preview depends on that; the preview code that reads `active.start` as a joint (R:1764-1766) must go in the same merge as each tool.
- R-3. `addStructural` drops the sandbox verify for a shape's own rules (B-1). If a rect's rule was ever refused in practice, that refusal disappears. Measured in step 4: run the rect audits and count refusals on main first.
- R-4. One sampler (4.2) changes sampled points in Pen Plotter, thumbnails and arc-approximated exports. Those are user-visible files.
- R-5. Pen Plotter's `isStatic` underlay exists for speed in dense scenes (`ui/sketch-canvas.js:154-158`). `drawPart` there must not cost more per frame; measured by `tests/bench-perf-702.test.js` and the penplotter perf tests.
- R-6. Things not checked: Select's drag ghosts, `ui/transform-box.js`, `syncTextOutlines`, `apps/penplotter` writers of `layer.shapes` (a separate model), the internals of `core/mirror.js` / `core/fillet.js` beyond the cited lines (h).

### 6.2 Behaviour changes for existing users (each one line)

- BC-1. Previews show what will be built: a typed circle Ø, a polygon / rect with typed sides and an arc across 180° (N-1, N-2) are drawn at their final geometry. Look (dash, opacity, colour) unchanged.
- BC-2. A rect's / arc's own rules are no longer sandbox-verified one by one (B-1); polygons and slots gain the branch locks (tangent side, perpendicular handedness) that rects and arcs already get.
- BC-3. Copies (paste, mirror, pattern), trims, breaks, offsets and imports write the same field set as the tools: `isConstruction:false` appears where it was absent, imported arcs and beziers get a `groupId`, cut / imported joints get `fixed:false`. No drawing or solving change expected.
- BC-4. The closed-shape tint covers every closed outline (Line-tool outlines, imports, offsets), not only tool-made rects and polygons.
- BC-5. Fusion / STL imports in Shaper get the arc EQUAL rule and user groups as SVG / DXF imports do (W-1).
- BC-6. A trimmed / broken fillet arc keeps its virtual corner on one piece only (W-7).
- BC-7. One sampler: arc-approximated SVG / DXF exports, Pen Plotter output and thumbnails change by sub-tolerance amounts (R-4).
- BC-8. A text-only design gets a thumbnail; the thumbnail stops drawing construction (if N-4 is fixed as proposed: from the live letters or the export's filter).

### 6.3 Document format

- **Stored today** (`core/document.js:61-85`, `DOCUMENT_VERSION = 3`): `geometry.joints` as `[id, {x, y, fixed, orphanAllowed?, sketchId}]` (letters and `dragTarget` dropped), `geometry.shapes` (every field but `textOutline` shapes and `dragTarget`), `constraints`, `sketches`, `activeSketchId`, `groups`, `profiles`, `parameters`; `hosts` opaque.
- **This plan changes no stored field and no version.** Parts stay parts; compounds stay parts + constraints + `groupId`; text stays its record. New shapes may carry fields that some old writers omitted (BC-3): every one is a field the current reader already reads, so an older build of this app loads them.
- **Old files load unchanged**: `deserializeDocument` stays verbatim (`:138`), no repair on load (W-8 stays). Arcs saved without `sweep` keep the shortest-way rule (`G:275-278`); arcs saved before task 789 keep no EQUAL rule. A repair pass would change what a saved file solves to, so it is NOT in this plan.
- Undo snapshots are a second codec of the same fields (`core/document.js:8-10`); untouched.

### 6.4 Fusion parity notes (all **unverified**: not measured in Fusion for this task; each is a divergence to flag, the owner decides)

- Fusion's 2-point rectangle is 4 lines sharing their corner points, with H / V constraints and no coincident constraints. Ours has two joints per corner + 4 COINCIDENT (W-6, Q2).
- A Fusion arc is a native entity: its radius is one value, no separate "equal" constraint. Ours keeps it with the EQUAL rule (task 789). Same behaviour to the user, different storage.
- Fusion's polygon (inscribed) has a construction circle; ours has N construction radii + EQUAL chains (`core/shapes.js:226-235`).
- Fusion's on-canvas preview is the real geometry as it will be created; that is the target of 4.4.

---

## 7. Owner questions (two, both change the plan)

- **Q1. Compound shapes: keep them as parts (+ `groupId` + their rules), or store each as one record like text?** Parts is what Fusion does (unverified) and keeps every file as it is. A record (`{ kind:'rect', corners, ... }` with derived lines) would make "edit the rectangle" and "the rectangle's own rules" first-class, but changes the document format, the solver feed and every consumer. **Proposed default: parts**, with each compound declared as a recipe (4.3).
- **Q2. One joint convention for where two parts meet?** Today three (W-6): two joints + coincident (Line tool, rect), one shared joint (polygon, offset, imports, bezier path), collapsed clusters (mirror, pattern). **Proposed default: keep each recipe's current convention, declared in the recipe** (no change to what is drawn or stored). The alternative, one convention for every new shape (shared joints, as Fusion's points are, unverified), changes how a new rect or line chain drags apart, deletes and dimensions, and many tests.

---

## Appendix: new bugs found while reading (reported to the advisor; NOT entered in BUG-ARCHIVE, audit rule 5)

Probe: `.evidence/1035/probe-preview-vs-final.mjs` (real SketchStudio page in the node kit, real pointer / key events), output `.evidence/1035/probe-preview-vs-final.out`:
```
A preview object: type arc largeArc undefined sweep undefined totalSweep(rad) 0.354
A preview path d: M -29.24648786717752,5.938697318007668 A 29.843343954722524,29.843343954722524 0 1,0 -29.491086247680215,-4.571762278570515
A committed arc: sweep true span(deg) 20.29 large false
B preview object radius 30  drawn dashed circle r: 10.000
B committed circle radius 30
C polygon: 0.000,0.000 10.000,0.000 10.000,5.000 0.000,5.000
C line   : <line x1="20.000" y1="-2.000" x2="30.000" y2="-2.000" stroke="black" stroke-width="1.000" stroke-linecap="round" stroke-linejoin="round" fill="none" /
```
Probe: `.evidence/1035/probe-thumbnail.mjs`, output `.evidence/1035/probe-thumbnail.out`:
```
D text-only design thumbnail: null
D construction-only circle thumbnail drawn: yes, 955 chars
```

1. **N-1 (probed): the Center Point Arc preview goes the wrong way when the sweep crosses 180°.** Centre, start at 170°, cursor moved +20° to 190°: the preview path is `A ... 0 1,0` (the 340° arc the other way), the committed arc is `sweep true`, 20.29°. Cause: `PM:56-59` copies only `center, radius, startAngle, endAngle, pt` and drops the `largeArc` / `sweep` the tool passes (`IH/arc-tool.js:165-166`, `:111-112`), so R:1668-1671's fallback compares raw `atan2` angles (`endAngle > startAngle`). Also hits the 3-Point Arc preview (same mirror; read, not run).
2. **N-2 (probed): the Circle preview ignores a typed diameter.** Ø 60 typed, cursor 10 from the centre: the preview object carries `radius 30`, the drawn dashed circle has `r 10`, the committed circle 30. Cause: R:1774-1776 computes the radius from the cursor and never reads `preview.radius`; `IH/circle-tool.js:88-90` sets `r = lockedRadius` but passes the cursor as the point.
3. **N-3 (probed): SVG export with "Invert Y axis (SVG)" does not flip closed line loops.** A closed 4-line loop comes out at y 0..5 while a lone line at y 2 comes out at y -2. Cause: `emitPolygonFromCycle` (`apps/sketchstudio/ui/export-manager.js:99-100`) applies `scale` but not the `invertY` of `transform()` (`:68-73`). Every closed rectangle in such an export is mirrored against the rest.
4. **N-4 (probed): a design that is only text has no thumbnail** (`designThumbnailSvg` returns null), and a mixed design's thumbnail has no letters. Cause: the thumbnail reads the STORED document (`ui/design-thumbnail.js:13-19`), and `serializeDocument` drops every letter (`core/document.js:68-69`); `coreShapeToPolyline` returns [] for the text record (h). Also: the thumbnail draws construction geometry, which the export leaves out (probe line 2).
5. **N-5 (read, not run): Shaper's Fusion / STL import gives its arcs no EQUAL rule** (`apps/shaper/src/fusion-import.js:389-398` vs `ui/sketch-import.js:164`): BUG-046's fix (task 789) landed only in the shared landing.
6. **N-6 (read, not run, latent): the profile-fill cache ignores a bezier's control points** (`ui/profile-fill.js:15-30`), so a change of `c1` / `c2` alone keeps a stale fill. Today `c1` / `c2` change alone only where joints change too or a shape is added in the same frame (grep `.c1 =`: `IH/bezier-tool.js:161`, `IH/selection-tools.js:326-327`, `core/solver/engine.js:41`, `:48-49`), so I found no user path that shows it. The fill is off by default (R:506).
7. **N-7 (read, not run): trim and break copy `filletSharp` onto both pieces of a fillet arc** (`core/trim.js:171` spreads `target`; `core/break.js:157`, h), so two arcs claim one virtual corner. What the renderer and the fillet radius dimension then do with two claimants was not checked.
