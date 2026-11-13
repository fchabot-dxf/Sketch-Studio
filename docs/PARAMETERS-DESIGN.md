# Parameters: a Fusion-style parameter table (task 535, PHASE 1 = DESIGN ONLY)

Status: design for review by the advisor and the owner. Nothing under `packages/` or `apps/` is changed by this task.
Base: origin/main d2e31b7. Every "seam" below is quoted as `file:line` at that commit. Task 525 is about to change
`packages/ui/dimension-seams.js`: this design names its FUNCTIONS (commitDimensionEdit, isDimensionDetermined, toggleDriving), not
its lines.

Fusion facts carry one of three tags:
- **measured (API)**: measured by the advisor through the Fusion API, 2706.1.17, an inch document, 2026-11-12.
- **measured (528)**: from docs/FUSION-COMPARISON.md "Editing a dimension (task 528)".
- **to verify in Fusion UI**: what we believe but have not measured.

---

## J. Summary for the owner (plain language)

**What you will see.** A new **fx Parameters** button in the Design tab's ribbon (next to Dim). It opens a small window that
floats over the drawing, can be dragged, and remembers where you left it. The window has two lists:

1. **User parameters**: your own named values, e.g. `width = 120 mm`, `gap = width / 4 + 2 mm`, `holes = 4`. Each row: Name,
   Expression, Value, Unit, Comment. You can add, rename and delete them (a parameter that is still used cannot be deleted).
2. **Sketch dimensions**: every dimension of the drawing, named automatically `d1`, `d2`, `d3` ... like Fusion. You can rename
   them (`d3` -> `slot_len`) and type a formula into them.

**What you will be able to do.**
- Type a formula into any dimension, on the canvas or in the window: `120`, `5 in`, `width`, `width / 2 + 5 mm`, `d2 / 4`,
  `sqrt(d1^2 + d2^2)`, `max(width; 50 mm)`.
- **Create a parameter by writing it**: type `width = 120` in a dimension's box on the canvas. The parameter `width` is created
  (if it did not exist) and that dimension now follows it. Same in the window.
- Change `width` once: every dimension that uses it changes together, in ONE solve and ONE undo step. If the new drawing is
  impossible, nothing changes and you are told which value is the problem.
- A dimension that follows a formula shows `fx: 60.0` on the canvas (Fusion's mark).
- Parameters are saved in the project file, travel between SketchStudio, Shaper and Pen Plotter, and are undone/redone like any
  other edit.

**What version 1 will NOT do.**
- Formulas while DRAWING (the length box shown while you drag a new line or rectangle) stay plain numbers.
- No text parameters, no favourites star, no comments on dimensions (only on user parameters), no `m` / `ft` units.
- Exports (SVG, DXF, Shaper SVG) carry the numbers only; no export of parameters to Fusion yet.
- Formulas cannot read a REFERENCE (driven, grey) dimension in v1 (owner decision O9).

**Your decisions** are the table at the end of this section; each has a recommended answer. The two owner requirements given
on 2026-11-12 are designed in as DECIDED: (R1) a parameter may use other parameters, any depth, with cycle detection; (R2)
writing `name = value` creates the parameter.

### Owner decisions (each with a recommended answer)

| # | Question | Recommended | Alternative |
|---|---|---|---|
| O1 | Parameters per document or per sketch? | **Per document**, one name space for all sketches (Fusion: per design, measured (API) that d-names share one counter) | Per sketch: names repeat between sketches, cross-sketch formulas impossible |
| O2 | File version | **Always write document version 2** once shipped; v1 files load and are migrated | Write v2 only when a parameter / formula / renamed dimension exists (keeps open->save of an untouched v1 file byte-identical, but two writers to keep correct) |
| O3 | `name = value` on the canvas | DECIDED (R2): creates a USER parameter `name`, the dimension's expression becomes `name`. Divergence to report: Fusion's API refuses `gap = 33 mm` (measured (API)); whether the Fusion UI accepts it and whether it RENAMES the dimension instead is **to verify in Fusion UI** | Make it rename the dimension (`d7` -> `gap`) like Fusion may do |
| O4 | `name = value` when `name` already exists | **Set that parameter's expression**, with a live hint under the box BEFORE Enter: `sets width 120 -> 140 mm, also changes d3, d7`. Enter applies it through the batch rule (D), one undo step | Refuse with "width already exists: type `width` to use it, or change it in Parameters" |
| O5 | A bare unknown name, no `=` (`gap`) | **Refuse**: "unknown parameter 'gap' (type `gap = 30` to create it)". A typo must never create a parameter | Offer to create `gap` with the dimension's current value |
| O6 | Name case | **Case-sensitive like Fusion** (measured (API): `w` beside `width`; Fusion names are case-sensitive). `Width` and `width` may both exist | Refuse a name that differs from an existing one only by case |
| O7 | Names of the form `d12` | **Reserved for automatic dimension names**: a user parameter cannot be called `d<digits>`; a dimension may be renamed to anything valid | Allow any free name (Fusion refuses only names already taken: measured (API)) |
| O8 | Function argument separator | **Accept `;` (Fusion, measured (API): `max(a; b)`) AND `,`**; the stored form uses `;` | `;` only, exactly Fusion |
| O9 | May a formula read a REFERENCE (driven) dimension? | **No in v1** (error "d5 is a reference dimension"): its value is measured from geometry that the formula itself may move, a loop through the solver. Fusion: **to verify in Fusion UI** (the task brief says Fusion allows it) | Yes: evaluate it at its last measured value, documented as order-dependent |
| O10 | Deleting a DIMENSION that a formula uses | **OWNER RULING 2026-11-12 (replaces the earlier "freeze")**: every dimension CREATES a `dN` PARAMETER; deleting a dimension removes it from the drawing but KEEPS its `dN` parameter (with its last expression / value) in the parameter list, so every formula that uses it keeps working; it can then be changed, renamed, or deleted once nothing uses it. `freezeReferencesTo` will be removed in the deletion slice. | (was: freeze each formula to its current number / refuse the delete / leave the formula broken) |
| O11 | Toggling a dimension that has a formula to REFERENCE | **Allowed; its formula is cleared** (a reference has no formula). **Refused** while another formula uses its name (O9) with "d4 is used by gap, d9" | Keep the formula dormant and restore it when made driving again |
| O12 | A fillet on a line whose length has a formula (the dimension is a joint-pair measure: applyFillet re-links it to the virtual sharp and keeps its value; the branch of fillet.js that shortened a `shape`-form length never ran and was removed in slice 3; tests/parameters-canvas.test.js verifies the formula, the value and the virtual-sharp link survive a fillet) | **OWNER RULING 2026-11-12: like Fusion.** Measured in Fusion: a fillet on a line whose length has a formula KEEPS the dimension and its formula, measured to the sharp corner. | (was: formula dropped, the new number kept, notice shown / refuse the fillet) |
| O13 | The window component | **Reuse the shared `createTabbedDockPanel`** (packages/ui/tabbed-dock-panel.js: floating, draggable, resizable, dockable, remembers position; today it has NO user) with one "Parameters" tab, plus a close button and open/close API | A new shared `#ui/floating-window.js` |
| O14 | Which hosts show the button | **SketchStudio, Shaper, Pen Plotter: yes. Trace: no** (Trace has no project file: its Design view is a cleanup step, apps/trace/src/edit-view.js:38-42, no document buffer) | All four |
| O15 | Formulas in the drawing-time boxes (line length, rect W x H while drawing) | **Not in v1** | Same parser there in a later slice |
| O16 | Keyboard on phones for the dimension box | **Full text keyboard** (`type="text"`, no numeric `inputmode`): names and `=` must be typable | Numeric keypad by default plus an `fx` key that switches to text |
| O17 | Favourites star, comments on dimensions | **Not in v1** (comments on user parameters only) | Add both |
| O18 | Units accepted | **mm, cm, in (also `"`), deg, rad**: the units the app already has plus angle units | Also m, ft |
| O19 | The document unit is a per-BROWSER setting today (packages/core/settings-manager.js:95, written with `persist: 'local'` at packages/ui/style-panel.js:169), not saved in the file | **Stored formulas always carry their units** (`width + 5` is stored `width + 5 mm`, exactly what Fusion stores back, measured (API)), so a file means the same thing in any browser. Making the unit a property of the document is a SEPARATE question for later | Make DOC_UNIT a document property now |
| O20 | `1/2 in` | **A fraction of two whole numbers written right before a unit is one number** (`1/2 in` = 0.5 in); otherwise a unit binds to the number or bracket just before it. Fusion: **to verify in Fusion UI** | Strict: `1/2 in` is `1 / (2 in)` = a unit error, write `(1/2) in` |
| O21 | A loaded file whose dimension value differs from its formula | **Keep the stored numbers** (the geometry matches them), flag the row "value differs from formula" in the window; never re-solve on load | Re-evaluate and solve on load |
| O22 | Automatic number after deletions | **Next = highest existing dN + 1** (derived, nothing stored; a number may be reused after the highest is deleted) | A stored counter that never reuses (Fusion: one counter, measured (API); reuse **to verify in Fusion UI**) |
| O23 | Zero / negative results | **Not decided here**: a formula's number goes through the same dimension-edit seam as a typed number, so the pending rulings in FUSION-COMPARISON ("negative-refused", "zero-length") apply unchanged whichever way they go | - |

---

## The code as it is (the seams this design relies on)

| Seam | Where | What it means for parameters |
|---|---|---|
| A dimension's value | `c.value` on a DISTANCE / ANGLE constraint, built in `createConstraint` packages/core/constraints.js:226-273; angles in DEGREES (packages/ui/dimension-seams.js toggleDriving computes `(a1 - a2) * 180 / Math.PI`), lengths in mm (packages/core/units.js:1-6 "1 world unit = 1 mm") | The number stays the solver's truth. The formula is extra |
| The ONE dimension-state helper | `withDimensionState(obj, params)` packages/core/constraints.js:129-142, used by every dimension mode (radius :228, line-line :238, joints :246, angle :268) | `name` and `expression` are added HERE only; save/load/undo already rebuild every constraint through `createConstraint` (document.js:95-98, sketch-state.js:96-103 and :233-236), so they carry through with no per-type copy |
| The add funnel | `addConstraint(state, type, params)` constraints.js:440 (push at :480); `ConstraintManager.createConstraint` reaches it (packages/core/constraint-manager.js:320); `addConstraintObject` constraints.js:491 is the restore path | The automatic name `dN` is given HERE when a dimension has none: new dimensions AND v1 files get names in one place |
| Constraints have no id | packages/ui/design-info-panel.js:102 "Constraints carry no id" | The dimension NAME becomes its stable, user-visible identity |
| The ONE typed-value path | `commitDimensionEdit(state, c, val)` packages/ui/dimension-seams.js (snapshot, stepped walk of at most 40 steps of 10 %, fillet seeding, collapse check of task 521 via `findCollapsedShape` packages/core/constraint-verifier.js:329, revert on non-convergence) | Generalised to a batch (D); the single edit becomes the 1-element case |
| Redundancy | `isDimensionDetermined(state, c)` dimension-seams.js | A determined dimension is placed driven and never typed (showEditInput, packages/ui/numeric-input-manager.js:271-279): unchanged; such a dimension never gets a formula |
| Driving toggle | `toggleDriving(state, c)` dimension-seams.js; context menu items packages/ui/context-menu.js:112-113 | Rule O11 lives here |
| The canvas edit box | `showEditInput` numeric-input-manager.js:265 (prefill :306-322), `handleCommit` :356-383 (parse :363, undo snapshot :369, commit :374, refusal notice :376-379) | The box parses through the ONE expression parser instead of `parseUnit` / `parseFloat` |
| The box element | SketchStudio declares `<input type="number" id="dimInput" ... inputmode="decimal">` apps/sketchstudio/index.html:390; other hosts get a plain text input created at numeric-input-manager.js:146-148 | **Blocker for formulas in SketchStudio**: a number input cannot hold `width` (its value reads back empty). By the HTML value-sanitisation rule it also cannot hold `0.25in` today, so the U2 unit suffix probably never worked in SketchStudio (derived from the code, not measured) |
| Units | packages/core/units.js: `TO_MM` :16, `basePer` :19, `UNITS` :22, `parse` :28 (number + optional mm/cm/in; "Fractions like '1/8' are NOT supported here"), `format` :47 | The ONE unit table. Angle units are ADDED to it (B), never a second table |
| Document unit | `SettingsManager.get('DOC_UNIT')` numeric-input-manager.js:13; default settings-manager.js:95; a per-browser setting (style-panel.js:169) | O19 |
| Label text | `formatConstraintValue(c, options)` packages/ui/svg-renderer.js:30, "single source of truth for both canvas dimension labels and the side panel's sketch tree"; `formatLenLabel` :22 | The `fx:` mark is added HERE only |
| Hover / select highlight | svg-renderer.js:1069 "the Design panel sets state.hoveredConstraint on row hover"; design-info-panel.js:5 row click toggles `state.selectedConstraints` | The parameter window uses the SAME two fields |
| Saved document | packages/core/document.js: `DOCUMENT_VERSION = 1` :21, `serializeDocument` :30-53, `validateDocument` refuses a newer version :61-68, `deserializeDocument` :80-127 | `geometry.parameters` added; version 2 (A) |
| Project file | packages/ui/project-file.js: envelope version :17, refuses newer :34, "open -> save again gives the same bytes" :8 | The envelope does not change; only the inner document version |
| Undo | packages/ui/sketch-state.js: `_captureSnapshot` :64-80, `_restoreSnapshot` :90-121, `cancelUndoGroup` restores INLINE a third copy :228-245, `beginUndoGroup`/`endUndoGroup` :188-215, `addHistoryListener` :125 | `parameters` rides in the snapshot through ONE clone helper (precedent: `cloneProfiles`, imported at :10 and used at :75/:110/:243) |
| Journal / diagnostic report | packages/core/journal.js:33/55 and packages/ui/diagnostic-log.js:134 both use `serializeDocument` | Slice 1b correction: `serializeDocument` carries them, but the journal's patches are keyed per document PART (`LIST_PARTS` in journal.js), so `parameters` was added there as a part keyed by name (otherwise a replayed report loses them and fails its own hash check) |
| Autosave and cross-app carry | `createDocumentBuffer` packages/ui/document-buffer.js:43 (serialize :52, load :69): SketchStudio apps/sketchstudio/main.js:189, Shaper apps/shaper/src/main.js:577, Pen Plotter apps/penplotter/src/sketch-stage.js:275. Trace: none | Parameters travel with the geometry |
| Ribbon | `createToolRibbon({..., profiles})` packages/ui/tool-ribbon.js:137; the opt-in precedent `PROFILE_ACTIONS` :33-36 joined at :262; `INSPECT = [Dim]` :37-39. Hosts: SketchStudio apps/sketchstudio/ui/ui-manager.js:125, Shaper apps/shaper/src/main.js:510, Pen Plotter apps/penplotter/src/sketch-stage.js:294, Trace apps/trace/src/edit-view.js:42 | The button is DECLARED in INSPECT (F) |
| Pop-ups that exist | Shared: style panel (fixed centred modal, own CSS, packages/ui/style-panel.js:72, factory :112), diagnostic log (full-screen overlay, packages/ui/diagnostic-log.js:168), context menu (packages/ui/context-menu.js), sidebar drawer (packages/ui/app-sidebar.js:138), mobile drawer (packages/ui/mobile-drawer.js), tabbed dock (packages/ui/tabbed-dock-panel.js, NO importer anywhere). App-local: Pen Plotter `ui-dialog.js` (prompt/confirm), Pen Plotter `#docModal`, Shaper `<dialog id="shaper-sync-modal">` (apps/shaper/index.html:396) | There is NO single shared dialog component. O13 |
| Keyboard focus | input-manager.js:992 and :1046 skip global shortcuts when the target is an INPUT | Typing in the window never triggers a tool |
| Mobile | numeric-input-manager.js:33 (`max-width: 640px` box), mobile-drawer.js:50 (breakpoint 768) | F |
| Dimension modes | tests/harness/coverage/inventory.js:161-166: aligned, horizontal, vertical, line length, point-line, line-line, angle, radius (circle / arc / fillet arc) | H: every mode round-trips a formula |
| Other writers of `c.value` | fillet.js:327-328 (line-length dims shortened by a fillet); dimension-tool.js:293-303, :562-566, :1052-1060, :1095-1099 (while PLACING, before any formula); toggleDriving (O11); live-dimension-input.js:324 | Only the fillet one can meet a formula (O12). See "blockers" for live-dimension-input |
| Constraint removal | 15+ splice sites: delete-manager.js:32/38/45/90/106/147 (funnels `deleteConstraints` :21, `deleteShapes` :61, `deleteJoints` :123), constraint-manager.js:359/422/519, fillet.js:300, line-tool.js:453/609, base-tool.js:55, dimension-tool.js (placement temp) | O10 must run where a DIMENSION can disappear (C) |

---

## A. Data model

### Where parameters live
`state.parameters`: an array on the shared sketch state, created in `createSketchState` (packages/ui/sketch-state.js:18) beside
`groups` / `profiles` / `vcarves` (:49-51), and in the test harness state (tests/harness/sketch.js:38). One list per DOCUMENT (O1):
the solver never reads it. Dimensions are listed per sketch in the window (grouping by `constraintSketch`, packages/core/sketch-model.js:33),
but names are unique across the whole document.

### A user parameter
```json
{ "name": "width", "unit": "mm", "expression": "120 mm", "comment": "outer width" }
```
- `name`: valid name (B). `unit`: one of `mm`, `cm`, `in`, `deg`, `rad`, or `""` (unitless, e.g. a count). It fixes the
  parameter's KIND (length / angle / none) and the unit its value is displayed in. `expression`: canonical text (B). `comment`:
  optional, omitted when empty.
- Its VALUE is not stored: it is derived by evaluation (load, and after every change). The window shows it.

### A dimension
Two new optional fields on DISTANCE and ANGLE constraints, kept by `withDimensionState` (constraints.js:129):
```json
{ "type": "distance", "joints": ["j3","j4"], "value": 60, "isDriven": false, "driven": false,
  "name": "d3", "expression": "width / 2" }
```
- `name`: always present after creation or load (given in `addConstraint`, constraints.js:440, when absent: `d` + (highest
  existing dN + 1), O22). Driving AND reference dimensions get names (Fusion names every sketch dimension, measured (API)).
- `expression`: present ONLY when the user typed something other than a plain number. A plain number typed into a dimension
  deletes the field (E). So a drawing that never uses formulas stores exactly what it stores today plus `name`.
- `value` stays the solver's truth: after every committed change `value === evaluate(expression)` (to 1e-9); the batch commit
  (D) is the only code that writes `value` for a dimension that has an expression.
- Placement-only fields (`__editing`, `__placing`) are untouched.

Considered and rejected: (a) the expression as the ONLY source and the value derived at solve time: the solver, the 30+ tests that
read `c.value` and the Fusion oracle would all change; (b) per-type fields (`radiusExpression` ...): forbidden by the one-helper
rule; (c) references by internal id instead of by name: no constraint id exists (design-info-panel.js:102) and files would be
unreadable.

### Saved file
`serializeDocument` (document.js:30) adds `geometry.parameters` (via the ONE clone helper `cloneParameters` in the new
`packages/core/parameters.js`, like `cloneProfiles`); `deserializeDocument` (:80) restores it (absent -> `[]`). Constraints need
no change: `{ ...c }` (:38) already copies `name` / `expression`, and `addConstraintObject` -> `createConstraint` ->
`withDimensionState` keeps them.

A whole v2 document:
```json
{
  "version": 2,
  "geometry": {
    "joints": [["j_origin", {"x":0,"y":0,"fixed":true}], ["j1", {"x":0,"y":0}], ["j2", {"x":120,"y":0}]],
    "shapes": [{"id":"L1","type":"line","joints":["j1","j2"]}],
    "constraints": [{"type":"distance","joints":["j1","j2"],"value":120,"offset":30,"isRadius":false,
                     "isDriven":false,"driven":false,"dimMode":"aligned","name":"d1","expression":"width"}],
    "parameters": [{"name":"width","unit":"mm","expression":"120 mm"}],
    "sketches": [{"id":"sketch-1","name":"Sketch 1","visible":true}], "activeSketchId": "sketch-1"
  },
  "hosts": {}
}
```

### Version and migration
- `DOCUMENT_VERSION` 1 -> 2 (O2). Why a bump is required, not optional: an OLD build reading a v2 file would silently drop
  `expression`, `name` and `parameters` (`createConstraint` keeps only known fields; `geometry.parameters` is unknown to it) and
  its autosave would write the loss back. With the bump the old build refuses the file with the existing "made by a newer
  version" message (document.js:64-66, project-file.js:39-41).
- v1 -> v2 migration = nothing to rewrite: `parameters` absent -> `[]`; every dimension gets `d1..dn` in constraint-array order
  by the naming rule in `addConstraint`; no `expression` exists. Geometry, values and flags are untouched.
- Proof that old files load unchanged (a test, H): every v1 document fixture in the repo is loaded; joints, shapes, every
  constraint field except the new `name`, sketches, groups, profiles, vcarves are deep-equal to the file; the solve residual is
  unchanged; no solve is triggered by the load.
- Undo snapshots are in memory only: no version.

### Undo
`_captureSnapshot` / `_restoreSnapshot` / `cancelUndoGroup` (sketch-state.js:64, :90, :217) add `parameters` through
`cloneParameters` (one helper, three call sites, exactly the `cloneProfiles` pattern). Dimension `name` / `expression` ride the
constraint copies already. Every parameter operation is preceded by ONE `saveState(label)` so it is ONE undo step: create
parameter + rewire a dimension, rename (all references rewritten), delete, a batch change of N dimensions.
Note (debt, not fixed here): the snapshot codec exists twice (document.js header :8-10 says so) plus the inline third copy in
`cancelUndoGroup`. Slice 1 adds one line to each; folding them into one codec is a separate cleanup task.

### Dimension names
- Automatic: `d1`, `d2`, ... (Fusion, measured (API)). Given once, at creation or v1 load, in `addConstraint`; undo/load restore
  the stored name.
- Shown on the canvas? **No** (Fusion shows only the value, with `fx:` when it has a formula). The name shows in the window and in
  the hover tooltip of the label.
- Renamed: in the window's Name cell (F). Rename rules = C.

---

## B. Expressions

### One parser, one evaluator
New pure module `packages/core/expression.js` (no DOM, no `eval()`, no `Function()`): a hand-written tokenizer + recursive-descent
parser producing an AST, an evaluator over the AST, and a printer producing the canonical text. Every place that reads a typed
value for a dimension or parameter calls it: the canvas box, the window cells, load-time verification. `units.parse` stays for
the other numeric fields (cut parameters); a test asserts `evaluate(s) === units.parse(s)` for every string `units.parse` accepts
(the two may never disagree on a plain number).

### Grammar (EBNF)
```
input      = ws, ( assignment | expr ), ws, EOF ;
assignment = NAME, ws, "=", ws, expr ;               (* only here: "=" anywhere else is a syntax error *)
expr       = term, { ws, ("+" | "-"), ws, term } ;
term       = unary, { ws, ("*" | "/"), ws, unary } ;
unary      = { ("+" | "-"), ws }, power ;
power      = postfix, [ ws, "^", ws, unary ] ;        (* right-associative; -2^2 = -4 *)
postfix    = primary, [ ws, UNIT ] ;                   (* "10 mm", "(1/2) in", "30 deg" *)
primary    = NUMBER | FRACTION_UNIT | NAME | call | "(", ws, expr, ws, ")" ;
call       = FUNC, ws, "(", ws, expr, { ws, (";" | ","), ws, expr }, ws, ")" ;
NUMBER     = digits [ "." digits ] | "." digits , [ ("e"|"E") ["+"|"-"] digits ] ;
FRACTION_UNIT = digits, ws, "/", ws, digits, ws, UNIT ;   (* "1/2 in" = 0.5 in (O20); only two whole numbers *)
UNIT       = "mm" | "cm" | "in" | '"' | "deg" | "rad" ;   (* case-insensitive, like units.parse *)
NAME       = letter, { letter | digit | "_" } ;        (* letter = A-Z a-z or "_" *)
FUNC       = "sqrt" | "abs" | "floor" | "ceil" | "round" | "min" | "max" | "sin" | "cos" | "tan" | "asin" | "acos" | "atan" ;
constant   = "PI" ;                                     (* a NAME the evaluator knows *)
```
- No implicit multiplication (`2 width` is a syntax error), no comparison, no strings.
- Fusion measured (API): `sqrt()`, `abs()`, `floor()`, `max(a; b)` with `;`, `^`, `PI` accepted. Our extra functions
  (`ceil`, `round`, `min`, trig) and `E`: **to verify in Fusion UI** (we include only those we can map 1:1; `E` is left out).

### Units and dimension analysis (yes, like Fusion)
- One unit table: `packages/core/units.js` grows from `TO_MM` (:16) to a declared table
  `{ mm:{kind:'length',f:1}, cm:{kind:'length',f:10}, in:{kind:'length',f:25.4}, '"':{alias:'in'}, deg:{kind:'angle',f:1}, rad:{kind:'angle',f:180/Math.PI} }`;
  `basePer`, `parse`, `format` read it. Nothing else holds a conversion factor.
- Every evaluated value carries `{ v, L, A }`: `v` in the base (mm, degrees), `L` the length exponent, `A` the angle exponent.
- `+` `-`: both sides must have the same `(L, A)`. A unitless literal next to a length (or angle) is PROMOTED to the context
  unit (Fusion, measured (API): `width + 1` is stored back `width + 1 mm`). The context unit is the parameter's own unit for a
  parameter's expression, the document unit for a dimension.
- `*` `/` multiply / divide the exponents. `^`: the exponent must be unitless; a unit base needs an integer exponent.
  `sqrt` halves even exponents (`sqrt(d1^2 + d2^2)` is a length), refuses odd ones.
- Trig takes an angle (a unitless argument is promoted to `deg`) and returns unitless; `asin` / `acos` / `atan` return degrees.
`floor` / `ceil` / `round` round in the unit the ARGUMENT IS WRITTEN IN, never the document's or the parameter's
  unit (so a stored file means the same in any browser, O19). **measured (API)** Fusion, 2026-11-12, inch document: `floor(2.7 mm)` = 2 mm;
  `floor(27 mm)` = 27 mm; `ceil(2.7 mm)` = 3 mm; `round(2.4 mm)` = 2 mm; `floor(30.5 mm)` = 30 mm; `floor(2.7 in)` = 2 in (5.08 cm);
  `floor(1 in)` in a parameter whose unit is mm = 1 in (2.54 cm); `round(25.4 mm)` in a parameter whose unit is in = 25 mm;
  `floor(2.7)` is stored back as `( floor(2.7) ) * 1 mm` = 2 mm; `floor(27 mm / 1 mm) * 1 mm` = 27 mm. Our rule: a unitless argument rounds
  plainly (result unitless); a single literal with a unit (optionally signed, optionally the O20 fraction `1/2 in`) rounds that number in that
  unit; any other argument with a length or angle (a name, a sum, a product) is UNIT_MISMATCH, with the message naming the explicit form
  `floor(gap / 1 mm) * 1 mm`. Fusion's behaviour for a NAME argument (`floor(gap)`) is not measured: **to verify in Fusion UI**.
- The result must match the target: a length dimension needs `(1,0)`, an angle dimension `(0,1)`, a parameter its unit's kind.
  A unitless RESULT for a length / angle target is taken in the context unit (Fusion, measured (API): `7` typed in an inch
  dimension became `7 "`).
- The canonical printer writes the promoted units into the stored text (`50` -> `50 mm`; `width/2+5` -> `width / 2 + 5 mm`;
  `2*3` -> `(2 * 3) mm`). A stored expression therefore never depends on the per-browser document unit (O19).

### Errors are data
`parseInput(text, ctx)` and `evaluate(ast, scope)` never throw; they return `{ ok: false, code, message, at: {start, end}, names? }`:

| code | when | message (example) |
|---|---|---|
| SYNTAX | not in the grammar | `unexpected '*' at 7` |
| ASSIGN_NOT_TOP | `=` other than one top-level assignment (`(a = 3)`, `a = b = 3`), or an assignment where none is allowed (a user parameter's Expression cell) | `"=" only as  name = value  at the start` |
| BAD_NAME | name not matching NAME, or longer than 64 | `'2x' is not a valid name` |
| RESERVED_NAME | a unit, function, `PI`, or `d<digits>` for a user parameter (O7) | `'mm' is a unit name` |
| NAME_TAKEN | renaming/creating to a name in use (one name space for parameters and dimensions; Fusion measured (API)) | `'d2' is already used` |
| UNKNOWN_NAME | a name that is neither a parameter nor a dimension (O5) | `unknown parameter 'gap' (type gap = 30 to create it)` |
| REFERENCE_DIM | a formula reads a reference dimension (O9) | `d5 is a reference dimension` |
| CYCLE | the dependency graph has a loop (C) | `width -> gap -> width` |
| UNIT_MISMATCH | `+`/`-` of different kinds, result kind != target kind, bad `^` / `sqrt` | `a length dimension cannot be 30 deg` |
| DIV_ZERO | division by zero | `division by zero` |
| NOT_FINITE | NaN / Infinity anywhere (`sqrt(-1)`, overflow) | `the result is not a number` |

Fusion, measured (API): unknown name, cycle and unit mismatch are all refused with "Expression is invalid" and the previous
expression is kept. Ours refuses the same cases, keeps the previous expression, and says WHICH error.

### Names
- Syntax `^[A-Za-z_][A-Za-z0-9_]*$`, at most 64 characters, no space (Fusion measured (API): a space is invalid).
- Case-sensitive (O6, Fusion measured (API)).
- Reserved: unit names (any case), function names, `PI`; and `d<digits>` for user parameters (O7).
- One name space: a user parameter and a dimension can never share a name.

---

## C. Dependencies

- Graph nodes: every user parameter; every DRIVING dimension (with or without a formula: one without is a constant leaf, its
  value `c.value`). Edges: node -> each name its expression references. Reference dimensions are not nodes (O9).
- Built fresh on demand from `state.parameters` + `state.constraints` (pure, `packages/core/parameters.js`); never stored.
- Cycle detection: depth-first search with three colours; the first back edge gives the cycle path for the message. A change that
  would create a cycle is refused before anything is touched (Fusion, measured (API): `width = p2` while p2 uses width: refused).
- Evaluation order: topological (Kahn), ties broken by list order (user parameters in table order, then dimensions in
  constraint order), so results never depend on hash order. Chains of any depth (R1: `p2 = p1 + 1 mm`, `p3 = p2 * 2`, ...).
- Rename (user parameter or dimension): validated (B), then every expression that references the old name is rewritten
  token-by-token through the AST printer (never a text replace: `width2` must not change when `width` is renamed). One undo
  step. Fusion: references follow a rename: **to verify in Fusion UI** (the advisor's API rename did not take effect).
- Delete a user parameter in use: REFUSED, message lists its users ("width is used by d3, d7, gap"). Fusion, measured (API):
  `deleteMe()` returns False, `isDeletable` False. Delete an unused one: allowed, one undo step.
- A dimension disappears (deleted, or its geometry deleted / trimmed) while formulas use its name: O10 freeze. Mechanism, in ONE
  function `freezeReferencesTo(state, removedNames)` in parameters.js: each dependent formula is replaced by the canonical text
  of its CURRENT value (a dimension: its `value` with the unit; a user parameter: its evaluated value), so nothing moves.
  It must run where a dimension can be removed. The user-facing deletes go through `deleteConstraints` / `deleteShapes` /
  `deleteJoints` (delete-manager.js:21/61/123); the other splice sites (list in the seam table) are audited in slice 6: each that
  can remove a DIMENSION is routed through `deleteConstraints` first (one funnel), or the slice STOPs and reports.

---

## D. Applying a change

### The one path
```
text typed (canvas box or window cell)
  -> expression.parseInput(text, ctx)                         (B; pure)
  -> parameters.planChange(state, change)                     (pure: builds the graph, checks names / cycle / units,
                                                               evaluates everything that depends on the change,
                                                               returns { ok, paramsAfter, edits: [{ c, value, expression }], affected } )
  -> state.saveState(label)                                   (ONE undo step)
  -> commitDimensionEdits(state, edits)                       (dimension-seams.js; the ONE solve path, below)
  -> on success: write paramsAfter + each c.expression; on refusal: nothing to undo (see below), message
```
`change` is one of: set a dimension's input (number, formula, or `name = expr`), set a parameter's expression, create / rename /
delete a parameter, rename a dimension. Renames and comment edits produce no `edits` and skip the solve.

### commitDimensionEdits(state, edits): the batch generalisation
- `commitDimensionEdit(state, c, val)` becomes `commitDimensionEdits(state, [{ c, value: val }])`: ONE implementation; every
  existing caller and test keeps its exact result (slice 2 proves it by running the existing dimension tests unchanged).
- PLACEMENT RULE (task 535-2, advisor ruling 2026-11-12), stated once in `commitDimensionEdits`: the creation placement ("who moves", task 525) answers a
  question about the ONE dimension the user typed. A batch of EXACTLY ONE edit keeps today's per-step placement (bit-identical to the old
  `commitDimensionEdit`); a batch of MORE than one edit is a re-solve of the sketch at new values (what Fusion does for a parameter change) and does
  NOT place. A parameter used by exactly one dimension therefore behaves like a single edit. Behaviour note (known consequence): N independent single
  edits place, the batch does not, so their final poses MAY differ where the placement picks a different operand to give way; measured on a
  parameter used by two independent rectangles the worst difference was 3.4e-8 (no visible difference), tests/parameters-batch.test.js prints it.
- ONE combined solve, not N sequential commits: all edited values move TOGETHER along the same stepped walk (step count = the
  largest any single edit needs, capped at the existing 40). Sequential commits were rejected: they are order-dependent (width
  100 -> 50 then gap 40 -> 20 passes through an impossible gap 40 in width 50 and would be refused although the end state is fine).
- Fillet radii in the batch are seeded analytically first (the existing `seedFilletForRadius`), each one; a refusal there refuses
  the batch.
- All-or-nothing: one snapshot of the whole solver state (joints + circle radii, `snapshotSolverState`) and of every edited
  `value` before; any refusal (non-convergence, the task 521 collapse check `findCollapsedShape`, a fillet collapse) restores ALL
  values and positions, re-solves, and leaves `state.parameters` and every `expression` as they were (they are only written after
  success). The `saveState` snapshot taken before is then popped with `discardSnapshotAt` (sketch-state.js:172) so a refused change
  leaves no empty undo step.
- Which dimension is reported: the message names the change ("width 120 -> 300 mm is impossible"), the solver's conflicting
  constraint types (as today, numeric-input-manager.js:376-379) and the FIRST dimension in the batch that is impossible ALONE
  (a diagnostic pass, only on refusal: from the restored state, each edit tried alone in table order; "the combination is
  impossible" when none fails alone).
- Order sensitivity: none (one combined walk, deterministic topological evaluation).
- Performance (measured in slice 2, Node 24; the 2 s STOP of the slice table is LIFTED by the advisor, the cost is the solver's): 1 / 2 / 10 /
  30 dimensions changed at once take 2 / 2 / 18 / 80 ms; 100 take about 4-5 s (about 580 ms per combined-walk solve, 7 solves) against 30 ms for a solve at
  rest. With per-edit placement the same batch took 50.7 s (700 `placeForCreation` calls at about 65 ms), hence the placement rule above. CPU profile
  of the 100-dimension batch: `gram` (solver/algebra.js) 24.7 s, `copyRow` (engine.js) 9.2 s, `_assemble` 7.2 s, `solve` 6.0 s, `choleskySolve` 3.9 s,
  i.e. dense J*J^T algebra, cubic in the number of rows. It also slows dragging on large sketches: queued as its own solver performance task (541).
  KNOWN P-1: "100 dimensions take ~4 s (target 2 s; solver algebra, task 541)": tests/parameters-batch.test.js prints it and FAILS LOUDLY when three
  consecutive measurements drop under 2 s (then delete this entry and the one in the test). Evaluation itself is linear in nodes + edges.
- Driven / reference dimensions: read-only rows; never in `edits`; a formula cannot read them in v1 (O9).
- A dimension whose formula would be set while it is DETERMINED (task 516 rule): it is a reference, so it never takes a formula;
  `showEditInput` already refuses to open (numeric-input-manager.js:271). Toggling a formula dimension to reference: O11.
- Zero / negative results: passed as numbers to the same seam; whatever rule the seam has (owner rulings pending in
  FUSION-COMPARISON "Editing a dimension": negative-refused, zero-length) applies to formulas too (O23). A USER PARAMETER may be
  zero or negative (`offset = -5 mm`); only a dimension judges its own value.
- Fusion difference to note: on an impossible value Fusion KEEPS the typed expression and puts the sketch in an error state
  (measured (528): `healthState` 1, geometry at the last valid shape); ours refuses and keeps the previous expression (today's rule
  for a typed number). Unchanged by this design.

---

## E. Typing on the canvas

- The box (`showEditInput`) is prefilled with the dimension's `expression` when it has one, else the formatted value (today's
  prefill numeric-input-manager.js:306-322).
- Enter -> the D path. What each input does:

| typed into d3's box | result |
|---|---|
| `60`, `2.5 in`, `1/2 in` | plain number: `value` set, `expression` deleted (Fusion: a number replaces the formula) |
| `width`, `width / 2 + 5`, `d2 / 4` | formula: `expression` = canonical text (`width / 2 + 5 mm`), `value` = its result |
| `width = 120` (width does not exist) | creates user parameter `width` (unit: the dimension's kind in the document unit, e.g. `mm`; `deg` for an angle dimension; a radius is a length), expression `120 mm`; d3's expression becomes `width`. One undo step removes the parameter AND restores d3's previous expression and value |
| `width = 140` (width exists, O4) | live hint under the box while typing: `sets width 120 -> 140 mm, also changes d7, d9`; Enter = set width's expression and rewire d3 to `width`; batch rule D for d3 + d7 + d9 |
| `gap = width / 4 + 2 mm` | as above with a formula; the parameter's unit comes from the dimension's kind; a result of the wrong kind (`gap = 30 deg` in a length box) is UNIT_MISMATCH and nothing is created |
| `d5 = 40`, `mm = 3`, `sqrt = 2` | refused: the left side must be a user-parameter name (NAME_TAKEN / RESERVED_NAME) |
| `gap` (unknown) | refused, O5 message |
| empty / Esc | cancel, as today |

- What the label shows: `formatConstraintValue` (svg-renderer.js:30) adds `fx: ` before the number when `c.expression` is set
  (Fusion shows `fx:` on a dimension driven by an expression: to verify in Fusion UI the exact text). Hover tooltip:
  `d3 = width / 2 (60.0 mm)`. The side panel tree uses the same formatter, so it shows `fx:` too, for free.
- The live hint is one small line under the box (same style family as `.dim-input`), filled from `planChange` on every `input`
  event (pure evaluation, no solve), showing either the value preview (`= 60.0 mm`) or the error message.
- Assignment only at the top level of an input (grammar), never inside an expression.
- SketchStudio's `#dimInput` must become `type="text"` (apps/sketchstudio/index.html:390), O16. The other hosts' created input is
  already text (numeric-input-manager.js:146).

### Autocomplete (OWNER REQUIREMENT R3, 2026-11-12: DECIDED; built in slice 3, reused by slice 5)
Owner: "Writing a param name in an input box like `pa` should show results in a box near the cursor: param1, param2."
- WHERE: every expression input: the dimension box on the canvas (slice 3) and the window's expression cells (slice 5).
- WHEN: while typing, whenever the caret is inside an identifier (the letters before the caret, up to the last operator / space / `(` / `;`).
- THE LIST: a small list just under / near the caret. It NEVER hides the input. At most about 8 rows. Each row: the name, its current value and unit
  (`width  120 mm`, `d3  60 mm`, `holes  4`). Order: user parameters and dimension names (`d1`..) first, then the functions (`sqrt`, `max`, ...).
  Within each group: names that START with the typed letters first, then names that merely CONTAIN them, each group in table order.
- CASE (O6 says names are case-sensitive): MATCHING is case-insensitive, the INSERTED name keeps its exact case (recommended and decided: typing `wi`
  offers `width` and `Width` both, inserting writes the one picked).
- KEYS: Up / Down move, Enter or Tab insert (the identifier typed so far is replaced by the full name; the caret goes after it), Esc closes the list
  (a second Esc is the box's own Esc), a mouse click on a row inserts. With no list open, Enter / Tab / Esc keep their normal meaning.
- ONE SOURCE: the list is produced by ONE pure function (`completionsFor(state, text, caret)` in parameters.js) over the SAME name table the parser
  and `validateName` use (expression.js `foldName`, the nodes of the dependency graph, the function table of expression.js): no second list of names,
  and a name that cannot be used in a formula (a reference dimension, O9) is never offered. The DOM list (position, keys) is a thin view over it.
- Fusion shows a similar list in its expression fields: **to verify in Fusion UI**.
- Test (slice 3): `completionsFor` table-driven (prefix before contains, case, functions after names, max rows, reference dims absent) + a live test
  that types `pa` and sees the rows, Down + Enter inserts, Esc closes.
- AS BUILT (slice 3, task 535-3). Choices the text above left open: (a) no row is picked when the list opens; Down / Up pick, so a plain Enter still commits
  and only Enter-on-a-picked-row inserts; Tab inserts the picked row, or the first when none is picked. (b) A function inserts `name(` (caret after the
  bracket). (c) A name equal to what is typed is not offered back (typing `width` then Enter commits, it never re-inserts). (d) Left of `name =` only user
  parameters are offered. (e) After an insert the list stays closed until the next keystroke. (f) The list sits right under the box and the hint under the list;
  when the screen (or the canvas area that clips them) has no room below, both go above the box. (g) The hint also shows while a name is half typed
  ("unknown parameter 'wi' ..."), because that is what Enter would do. (h) A text the parser refuses keeps the box OPEN with the typed text and the hint
  (the old box closed silently and dropped it); an empty box still just closes. (i) The edit box asks a phone for the text keyboard (`inputmode=text`);
  the boxes shown WHILE DRAWING keep `inputmode=decimal` and plain numbers (O15). Not built: the hover tooltip `d3 = width / 2 (60.0 mm)` of section E.

---

## F. The pop-up window

- **Opened from**: a ribbon button DECLARED in the INSPECT group of the shared ribbon (tool-ribbon.js:37), as an ACTION entry
  `{ action: 'parameters', id: 'btn-parameters', label: 'Params', title: 'Change Parameters (fx)' }`, like the `lock` action.
  Default ON for every host of the Design tab; a host opts OUT with `createToolRibbon({ parameters: false })` (the inverse of the
  `profiles` opt-in at :262, because the north star is ONE Design tab and only Trace is excluded, O14). Test: Trace's ribbon has
  no `#btn-parameters`; SketchStudio / Shaper / Pen Plotter have it.
- **Component** (O13): `createTabbedDockPanel` (tabbed-dock-panel.js:68) with one tab "Parameters" whose `render(body)` is the
  new `packages/ui/parameter-table.js`. The dock already floats, drags, resizes, docks to an edge and persists position/size
  (`persistKey: 'sk-parameters'`). Additions to the dock (it has no users today, so no host can regress): a close button in its
  header and `open()` / `close()` / `isOpen()`. No second dialog system; no table widget exists to reuse (the design info panel
  uses div rows), so the table is a plain `<table>` inside parameter-table.js.
- **Modeless** (recommended): the canvas stays usable while it is open; the table refreshes on every history change
  (`state.addHistoryListener`, sketch-state.js:125) and after each commit. Fusion's dialog: modal or not is **to verify in
  Fusion UI**.
- **Layout**:
  ```
  ┌ Parameters ─────────────────────────────────────────────────── ✕ ┐
  │ [filter…]                                                         │
  │ USER PARAMETERS                                         [+ Add]   │
  │  Name    Expression            Value      Unit  Comment       🗑  │
  │  width   120 mm                120.0      mm    outer width       │
  │  gap     width / 4 + 2 mm      32.0       mm                      │
  │ SKETCH 1 DIMENSIONS                                               │
  │  d1      width                 120.0      mm    ↔ L1              │
  │  d2      30 deg                30.0       deg   ∠ L1 L2           │
  │  d3      (reference)           (45.2)     mm    ↔ j3 j4  (grey)   │
  └───────────────────────────────────────────────────────────────────┘
  ```
  Dimension rows: Name (editable = rename), Expression (editable when driving), Value (read only), Unit (read only: the
  document unit or `deg`), and in place of Comment the geometry it measures (`constraintGeometryText`,
  packages/ui/geometry-labels.js:47, already used by the side panel). Reference dimensions: grey, read only, value in brackets
  (the existing `formatConstraintValue` driven form).
- **Editing**: apply on Enter or on leaving the cell, never per keystroke; while typing, the row shows the live value preview or
  the error (the same `planChange`, no solve). Errors: the cell gets `aria-invalid="true"`, a red border and the message on a
  line under the row; the previous expression stays in force until a valid one is applied.
- **Add**: `+ Add` appends an empty row with its Name cell focused (no invented default name); the parameter is created when a
  valid name and expression are both applied (Enter); the new-row Expression cell also accepts `name = expr`, which fills both. Typing `name = expr` in a DIMENSION row's Expression cell does what it does on
  the canvas (E). In a user parameter's Expression cell `=` is ASSIGN_NOT_TOP ("use the Name cell to rename").
- **Delete**: the bin on a user parameter row; disabled with a tooltip listing its users when in use (C).
- **Filter**: one text box filtering rows by name or expression. No column sorting in v1 (rows keep creation order, like Fusion's
  list by feature: to verify in Fusion UI).
- **Canvas link**: hovering a dimension row sets `state.hoveredConstraint` (the existing highlight, svg-renderer.js:1069);
  clicking selects it (`state.selectedConstraints`, as the side panel does, design-info-panel.js:5). Clicking a user parameter row
  selects every dimension that depends on it.
- **Keyboard**: Tab / Shift+Tab move Name -> Expression -> Comment -> next row; Enter applies and moves down one row in the same
  column; Esc reverts the cell being edited, a second Esc (nothing being edited) closes the window. Global tool shortcuts are
  already ignored while an INPUT has focus (input-manager.js:992, :1046).
- **Narrow screens** (max-width 640px, the dimension box's own breakpoint numeric-input-manager.js:33): the window becomes a
  full-width bottom sheet (no drag), Value and Unit merge into one column ("120.0 mm"), Comment hidden behind the row's tap.
  Inputs 36 px high like the dimension box's mobile rule.
- **Accessibility**: the dock gets `role="dialog"`, `aria-label="Parameters"`; the ribbon button `aria-haspopup="dialog"` and
  `aria-expanded`; a real `<table>` with `<th scope="col">`; group headings as `<th scope="rowgroup">`; error text linked with
  `aria-describedby`; focus returns to the ribbon button on close. Not modal, so no focus trap.

---

## G. Hosts and export

- SketchStudio, Shaper and Pen Plotter share the Design tab and the document buffer: parameters live in `geometry.parameters`, so
  they are in every project file, autosave and cross-app carry with no host code. Host sidecars (`hosts.*`) do not change.
- Trace: no button (O14). If a document with formulas is ever shown there, labels still show `fx:` (shared renderer) and the box
  still accepts formulas (shared box): consistent, just no window.
- Exports (SketchStudio `buildSVG` / `buildDXF` apps/sketchstudio/ui/export-manager.js:33/186, Shaper SVG
  packages/core/shaper-export.js) write geometry only: unchanged, numbers only. SVG / DXF import create plain geometry: no
  parameters.
- The diagnostic report and the ops journal include parameters automatically (both use `serializeDocument`), so a bug report
  replays with its formulas.
- Fusion direction (note only, not v1): user parameters map 1:1 to Fusion `UserParameters.add(name, ValueInput.createByString(expr),
  unit, comment)` and dimension formulas to `ModelParameter.expression`; our canonical text is Fusion-compatible if the separator
  is `;` and `in` is written `in` (Fusion accepts `in`; to verify in Fusion UI). A later Fusion oracle for parameter evaluation
  (H) would test exactly that mapping.

---

## H. Tests

| Test | What it asserts | Kind |
|---|---|---|
| `tests/expression-parser.test.js` | table-driven: ~150 rows `input -> canonical text / value / L,A / error code` covering every grammar rule, every unit, `1/2 in`, `"`, promotion, every function, `;` and `,`, precedence (`-2^2`, `2^3^2`), every error code with its `at` span; `evaluate(s) === units.parse(s)` for every string `parse` accepts | unit, gate |
| `tests/parameters-graph.test.js` | chains of depth 1..10, diamond, self-reference, 2- and 3-cycles (path in the message), rename follows references (and `width2` untouched), delete in use refused, freeze on dimension removal, deterministic order | unit, gate |
| `tests/parameters-roundtrip.test.js` | for EVERY dimension mode of tests/harness/coverage/inventory.js:161-166 (aligned, horizontal, vertical, line length, point-line, line-line, angle, radius circle / arc / fillet arc): a formula survives save -> load, undo -> redo, `cancelUndoGroup`, the journal; name survives; value == evaluated formula | unit, gate |
| `tests/parameters-old-files.test.js` | every v1 document fixture loads unchanged (A, "proof"); a v2 document is refused by a build whose DOCUMENT_VERSION is 1 (validateDocument); an old file shows `d1..dn` in constraint order | unit, gate |
| `tests/parameters-batch.test.js` | a parameter used by N dimensions (rectangle with holes, the trapezoid fixture) changed: all reach their values in one undo step; an impossible change restores EVERYTHING (joints, radii, values, expressions, parameters, deep-equal) and leaves no undo step; the reported dimension; order independence (permuting the edit list gives identical geometry); 100-dimension timing | integration, gate |
| `tests/parameters-property.test.js` | seeded random sequence of 500 parameter edits / renames / creates / deletes / undo / redo: after each step every formula dimension has `value == evaluate(expression)` to 1e-9, no cycle exists, every reference resolves, and a refused step leaves the state deep-equal to before | property, gate |
| existing dimension tests | unchanged and green after `commitDimensionEdit` becomes the 1-element batch (circle-radius-dof, dimension-point-line, distance-hv-dims, fillet-corner-dimension-drives, dimension-undo-step, dimension-determined, ...) | regression, gate |
| `tests/parameters-canvas-live.test.js` | headless real SketchStudio: double-click a dimension, type `width = 120` + Enter through CDP key events: the label reads `fx: 120.0`, the window lists width; type `width / 2`; undo once restores the old label; screenshot evidence | live, gate |
| `tests/parameters-window-live.test.js` | headless real app, each of SketchStudio / Shaper / Pen Plotter: `#btn-parameters` opens the window; edit width -> 3 labels change; an error row shows the message; Esc closes; position remembered after reload; Trace has no button; at 400 px width the window is a bottom sheet | live, gate |
| Fusion oracle (slice 6) | Fusion evaluates the parser's table of expressions (as user parameter expressions in a scratch document holding `CLAUDE_MARK`, the existing oracle rule); fixture under tests/fixtures/fusion-oracle/; offline comparison in the gate; divergences in a KNOWN list (`*-known.json`, regenerated by its script, an entry that starts passing is deleted), the audits' pattern | oracle |

What an old file looks like: unchanged on disk (version 1, no `name`, no `parameters`); after open it shows `d1..dn`; after the
next save it is version 2 with `name` on each dimension and `"parameters": []`.

---

## I. Build plan (each slice leaves main green and useful)

| Slice | Content | Files | Tests | STOP if | Size |
|---|---|---|---|---|---|
| **1a Parser** (invisible) | `expression.js` (tokenize, parse, evaluate, print, errors); units.js table + angle units | packages/core/expression.js (new), packages/core/units.js | expression-parser.test.js | `units.parse` and the evaluator disagree on any accepted string; a unit needs a factor outside units.js | M: ~450 lines + ~300 test rows |
| **1b Model + persistence** (invisible) | `parameters.js` (names, graph, cycle, planChange, cloneParameters, freezeReferencesTo); `name`/`expression` in withDimensionState; naming in addConstraint; `state.parameters` (sketch-state, harness); document v2; snapshot (3 sites) | packages/core/parameters.js (new), constraints.js, document.js, packages/ui/sketch-state.js, tests/harness/sketch.js | parameters-graph, parameters-roundtrip (data only), parameters-old-files | any existing test changes result; a v1 fixture does not load identical | M: ~400 lines |
| **2 Batch seam** (invisible) | `commitDimensionEdits`; `commitDimensionEdit` = 1-element case | packages/ui/dimension-seams.js | parameters-batch, all existing dimension tests unchanged | any existing dimension test changes; 100 dims > 30 s (the 2 s STOP was lifted, KNOWN P-1); task 525 not merged yet (wait for it) | M: ~150 lines |
| **3 Canvas** (visible, DONE in task 535-3: O12 verified, a former dead branch of fillet.js that would have overwritten a formula's value removed) | box parses formulas and `name = …`; expression prefill; live hint line; `fx:` in formatConstraintValue; SketchStudio `#dimInput` type text; toggleDriving rule O11; fillet rule O12; **autocomplete R3** (`completionsFor` + the list near the caret, section E) | numeric-input-manager.js, svg-renderer.js, dimension-seams.js (toggleDriving), fillet.js, apps/sketchstudio/index.html | parameters-canvas-live, property test | shell-smoke < 12/12; a host's box behaves differently from another's; the dead edit path in live-dimension-input.js turns out reachable | M |
| **4 Window, read-only** (visible) | dock close/open API; parameter-table.js rows (both groups, filter, hover / select link); ribbon action + host opt-out (Trace) | tabbed-dock-panel.js, packages/ui/parameter-table.js (new), tool-ribbon.js, apps/trace/src/edit-view.js | parameters-window-live (read-only parts) | the dock change would alter any other host (it has none today: re-check with grep) | M |
| **5 Window editing** | inline edit of expressions; add / rename / delete / comment of user parameters; rename of dimensions; per-row errors; keyboard; mobile sheet; **autocomplete R3 in the expression cells** (same `completionsFor`) | parameter-table.js | parameters-window-live (full) | an edit path that does not go through planChange + commitDimensionEdits | M-L |
| **6 Hardening** | O10 freeze on every dimension-removal site (route through deleteConstraints); Fusion oracle for expressions + KNOWN list; docs | delete-manager.js and the sites the audit finds, scripts/fusion-oracle/, tests/fixtures/fusion-oracle/ | parameters-graph (freeze), oracle test | a removal site cannot be routed through the funnel without a behaviour change | M |

Parallel: 1a and 1b can run together (1b needs only the parser's API stub: agree the signatures first). Slice 2 waits for task 525
(same file). 3 and 4 can run in parallel after 1 + 2 (different files, except tool-ribbon.js is only in 4). 5 after 4. 6 after 3.

---

## What in the current code blocks or bends this design

1. **SketchStudio's dimension box is `type="number"`** (apps/sketchstudio/index.html:390): no formula can be typed there. It also
   blocks the existing unit suffix (`0.25in`) in SketchStudio today (from the HTML spec's value sanitisation; not measured here).
   Fixed in slice 3.
2. **The document unit is per browser, not per file** (settings-manager.js:95, style-panel.js:169). Handled by storing units in
   every formula (O19); the broader question stays open.
3. **Constraints have no id** (design-info-panel.js:102): the new dimension `name` becomes the identity.
4. **Three copies of the snapshot codec** (document.js, `_captureSnapshot`/`_restoreSnapshot`, the inline restore in
   `cancelUndoGroup` sketch-state.js:228-245): each gets one `cloneParameters` call; merging them is separate debt.
5. **No single removal funnel for constraints** (15+ splice sites): O10's freeze needs one; slice 6 audits it.
6. **A second, unreachable dimension-edit path**: `showEditInput` and the edit branch of `processCommit` in
   packages/ui/input-handlers/live-dimension-input.js:418 and :319-333 write `c.value` directly (bypassing commitDimensionEdit);
   nothing imports that `showEditInput` (grep: the file's only importers are line-tool.js:19, input-manager.js:36 and two tests,
   none import it). Reported, not fixed; slice 3 STOPs if it is reachable.
7. **No shared dialog component** exists (F): the unused tabbed dock is the reusable floating chrome; O13.
8. `fillet.js:327-328` rewrites a line-length dimension's value: O12.
9. Task 525 is changing dimension-seams.js; slice 2 must start from its merged result.
