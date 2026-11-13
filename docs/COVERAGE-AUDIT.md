# Solver coverage audit (SketchStudio): Matrix (task 512) and Properties (task 514)

Scope (owner ruling): what reaches the SKETCHSTUDIO SOLVER. Shaper, Pen Plotter, Trace, import/export and non-solver UI are out. This is part 1 of 3 (inventory +
constraint x geometry matrix). AUDIT ONLY: no application code was changed. Round-1 findings F1..F8 (docs/CONSTRAINT-AUDIT.md) are known: a failure they cause is
labelled "FAIL F<n>", not reported as new.

* Re-run: `node scripts/coverage-audit.cjs` (all rows; `... perpend` for one row; `--cells` also lists every failing cell). The full run of this report is kept as
  `.evidence/512/audit-run.txt` (local, not committed). PlaneGCS prints `Sketcher::Redundant...` lines: that is the oracle talking, not an error.
* The assertions: `node tests/coverage-matrix.test.js` (in the gate, about 13 s). It asserts (1) the inventory matches the code, (2) every inventory item is a
  matrix row / column or explicitly deferred, (3) every one of the 3384 cells is PASS, N/A (checked refusal), a tolerated round-1 finding, or a pinned NEW finding.
  A pinned NEW finding is a `KNOWN` entry: its cells and its repro are expected to FAIL, and the test fails loudly when one starts passing (delete the entry then).
  Round-1 cells (F1..F6) are tolerated, not required, so the F1..F6 fix tasks do not have to edit this test.
* Files: `tests/harness/coverage/inventory.js` (derived from the code, file:line per item), `matrix-build.js` (operands, variants, document snapshot), `matrix-oracle.js`
  (PlaneGCS), `matrix-run.js` (rows, cell runner, classification), `matrix-findings.js` (one repro per NEW finding). It reuses `tests/harness/audit/lib.js` of task 508
  (newSketch, fdJacobian, planegcs translation, residuals, jitter).

## Inventory (derived from the code)

`tests/harness/coverage/inventory.js` exports `{ tools, constraintTypes, definitions, shapeKinds, dimensionModes, editFeatures, apps, ... }`, each item with the file:line it
came from (ribbon arrays of `packages/ui/tool-ribbon.js`, `CONSTRAINT_TYPES`, the solver `Definitions`, the shape makers, the Dimension tool's creation sites, the edit
functions). SketchStudio mounts the ribbon without profile actions (`apps/sketchstudio/ui/ui-manager.js`), so its tool list is the whole ribbon:

* 19 tools: select, line, rect, circle, polygon, arc, bezier, trim, break, fillet, dim, coincident, hv, parallel, perp, collinear, tangent, equal, midpoint (+ pan, not in the ribbon).
* 12 constraint types (all structural except distance and angle) and 13 solver Definitions (the 12 + mouse_spring).
* 9 shape kinds: line, construction line, circle, arc (centre/start/end), fillet arc, polygon side, rect side, bezier, point / joint.
* 8 dimension modes: point-point aligned / horizontal / vertical, line length, point-line, line-line, angle, radius.
* 21 edit features: fillet, fillet radius edit, trim, break, polygon, rect x3 modes, construction toggle, lock, delete x4, undo, redo, driving/reference x2, delete dimension,
  geometry context menu, drag (mouse_spring).

Could not classify / things the task listed that do not exist in SketchStudio (the inventory test asserts each by a source scan, so a new one fails the gate):

* **3-point arc**: `ARC_MODES` has only `arc-cse`; `makeArc` has a `subType` parameter but nothing creates another one. There is one arc kind.
* **Diameter dimension**: `svg-renderer.js` and `design-info-panel.js` have label branches for `isDiameter`, but no tool creates one (no `createConstraint` with it). Not a matrix row.
* **Mirror, offset, copy / paste**: no code in `packages/core`, `packages/ui` or `apps/sketchstudio` (scan for mirrorShape / pasteSelection / copySelection / offsetShape / duplicateShape finds nothing).
* **Bezier constrainable?** Only its two END joints are solver joints (control points are shape data): it is a column, and only joint-based rows reach it.
* `pan` is a tool mode that is not in the ribbon (a navigation mode, no solver effect).
* Edit features the matrix does not exercise cell by cell are listed as DEFERRED in the test (trim, break, rect centre / 3-point, construction toggle, delete shapes / joints /
  selection, redo, driving / reference toggle, delete dimension, drag): they are edit audits (parts 2/3), not constraint x geometry cells. `lock`, `fillet`, `polygon`, rect
  2-point, `delete constraints`, `undo` and the numeric dimension edit run in every cell.

## Matrix

### Method

Every cell is a fresh sketch with two operands of the given kinds (columns), built with the real builders (`makeArc`, `makePolygon`, `applyFillet`, `makeRectFromTwoJoints`,
`makeBezier`, the line-tool coincident joins), then ONE constraint made through the REAL tool handler: `handleConstraintPointerDown` for the constraint tools and
`handleDimensionPointerDown` + `anchorPlacingDimension` for dimensions (stubbed hit objects and svg; the pointer position picks H / V / aligned exactly as a user's pull does).
Kinds: L line, C construction line, S polygon side, R rect side, O circle, A arc, F fillet arc, B bezier, P point. Columns are the unordered pairs (45), or the 9 single kinds
for one-operand rows. Four variants per cell, in this order:

| variant | what it is |
|---|---|
| sep | two separate shapes, separate joints |
| shared | the second shape's own point is merged into the first's last joint (a weld, a polygon corner, a fillet rim, an import) |
| locked | every joint of the first shape locked through the real `toggleFixedSelection` (Lock / F key) |
| dimmed | already constrained by something else: a driving aligned distance between the two operands (or the length / radius of a lone shape) |

Per cell: accepted or refused (+ `ERR-*` code); whether the TOOL would allow the selection at all (`ui`); converged; max verifier residual (tolerance =
`SolverConfig.VERIFIER_TOLERANCE`, 0.001, the app's own); NaN; nullity delta of the Design panel (`jointFreedom().nullity`) vs the expected DOF removed; the finite-difference
nullity (`fdJacobian`, independent of the analytic Jacobian) and the PlaneGCS dof delta (independent of our solver; 508 translation plus collinear and circle-circle tangent, which
508 left unmapped); bite (a 3% jittered start re-solves with every driving constraint satisfied); a dimension placed at its measured value must not move the drawing; the typed
edit x1.25; then `deleteConstraints` (nullity back to the baseline) and `undo` (document identical, compared in canonical form).

A refusal the tool makes by its own rule is **N/A by UI** and is checked, not skipped: the real handler is run with that selection and the cell passes only when no constraint of
that kind exists afterwards and the document is byte-identical. When the UI allows the selection but the app refuses, PlaneGCS decides whether the refusal was right (a raw add
of what the tool tried, then a solve; a solution that collapses a line to a point does not count as feasible): feasible and refused is a finding.

Expected DOF removed (sep variant; the variants must only agree between panel, finite difference and PlaneGCS, and are reported "implied" when they remove less):

| row | expected | row | expected |
|---|---|---|---|
| coincident | 2 | tangent (line/circle/arc, circle/arc pair) | 1 |
| horizontal / vertical (2 joints or a line) | 1 | equal (two lines) | 1 |
| parallel / perpendicular | 1 | equal (arc/arc, arc/circle) | 1 |
| collinear | 2 | equal (circle/circle: the radius is shape data) | 0 |
| midpoint (line + joint, or 3 joints) | 2 | equal (fillet/fillet: each already has its driving R) | 0 |
| every point-point / line length / line-line / angle dimension | 1 | radius dimension: arc 1, circle 0 (shape data), fillet arc 0 (already driven) | see left |
| point-to-line dimension | 1 (the helper joint is its own 2 DOF and must net out) | | |

N/A-by-build ("-"): no meaningful sketch (the shared variant of a one-operand row; two joints that are both ends of one shape for coincident; lines that are not parallel for the
line-line distance, or that are parallel for an angle, because the tool offers the other one; near-axis pairs for H / V dimensions, which the tool keeps aligned).

### The grid

Rows are constraints / dimensions, columns are shape-pair kinds, four characters per column (sep shared locked dimmed). Verbatim from `node scripts/coverage-audit.cjs`.

```
LEGEND  variants per cell in this order: sep shared locked dimmed
        P pass   n refused by the UI (the real tool refused, document untouched)   - no meaningful sketch for the cell
        1..6 = F1..F6 of docs/CONSTRAINT-AUDIT.md   A..H = NEW-1..NEW-8 of docs/COVERAGE-AUDIT.md   ? unexplained
=== coincident  [coincident]  expected DOF removed (sep): 2
  LL    LC    LS    LR    LO    LA    LF    LB    LP    CC    CS    CR    CO    CA    CF   
  PPPP  PPPP  PPPP  PPPP  P-PP  PPPP  PPPP  PPPP  P-PP  PPPP  PPPP  PPPP  P-PP  PPPP  PPPP 
  CB    CP    SS    SR    SO    SA    SF    SB    SP    RR    RO    RA    RF    RB    RP   
  PPPP  P-PP  PPPP  PPPP  P-PP  PPPP  PPPP  PPPP  P-PP  PPPP  P-PP  PPPP  PPPP  PPPP  P-PP 
  OO    OA    OF    OB    OP    AA    AF    AB    AP    FF    FB    FP    BB    BP    PP   
  PnPP  P-PP  P-PP  P-PP  PnPP  PPPP  PPPP  PPPP  P-PP  PPPP  PPPP  P-PP  PPPP  P-PP  PnPP 
  N/A=3  NA-BUILD=14  PASS=163
=== horizontal (2 joints)  [horizontal-2pt]  expected DOF removed (sep): 1
  LL    LC    LS    LR    LO    LA    LF    LB    LP    CC    CS    CR    CO    CA    CF   
  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP 
  CB    CP    SS    SR    SO    SA    SF    SB    SP    RR    RO    RA    RF    RB    RP   
  PPPP  PPPP  PPPP  PPPP  P-PP  PPPP  P-PP  PPPP  P-PP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP 
  OO    OA    OF    OB    OP    AA    AF    AB    AP    FF    FB    FP    BB    BP    PP   
  PnPP  PPPP  P-PP  PPPP  PnPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  P-PP  PPPP  PPPP  PnPP 
  N/A=3  NA-BUILD=5  PASS=172
=== vertical (2 joints)  [vertical-2pt]  expected DOF removed (sep): 1
  LL    LC    LS    LR    LO    LA    LF    LB    LP    CC    CS    CR    CO    CA    CF   
  PPPP  PPPP  PPPP  PPPP  P-PP  PPPP  PPPP  PPPP  P-PP  PPPP  PPPP  PPPP  P-PP  PPPP  PPPP 
  CB    CP    SS    SR    SO    SA    SF    SB    SP    RR    RO    RA    RF    RB    RP   
  PPPP  P-PP  PPPP  PPPP  PPPP  PPPP  P-PP  PPPP  PPPP  P-PP  P-PP  PPPP  P-PP  PPPP  P-PP 
  OO    OA    OF    OB    OP    AA    AF    AB    AP    FF    FB    FP    BB    BP    PP   
  PnPP  PPPP  PPPP  PPPP  PnPP  PPPP  PPPP  PPPP  P-PP  PPPP  PPPP  PPPP  PPPP  P-PP  PnPP 
  N/A=3  NA-BUILD=11  PASS=166
=== horizontal (a line)  [horizontal-line]  expected DOF removed (sep): 1
  L     C     S     R     O     A     F     B     P    
  P-PP  P-PP  ----  P-P-  n-nn  n-nn  n-n-  n-n-  n-n- 
  N/A=12  NA-BUILD=16  PASS=8
=== vertical (a line)  [vertical-line]  expected DOF removed (sep): 1
  L     C     S     R     O     A     F     B     P    
  P-PP  P-PP  P-PP  ----  n-nn  n-nn  n-n-  n-n-  n-n- 
  N/A=12  NA-BUILD=15  PASS=9
=== parallel  [parallel]  expected DOF removed (sep): 1
  LL    LC    LS    LR    LO    LA    LF    LB    LP    CC    CS    CR    CO    CA    CF   
  PPPP  PPPP  P4PP  P4PP  nnnn  nnnn  nnnn  nnnn  nnnn  PPPP  P4PP  P4PP  nnnn  nnnn  nnnn 
  CB    CP    SS    SR    SO    SA    SF    SB    SP    RR    RO    RA    RF    RB    RP   
  nnnn  nnnn  PPPP  P4HP  nnnn  nnnn  nnnn  nnnn  nnnn  P6PP  nnnn  nnnn  nnnn  nnnn  nnnn 
  OO    OA    OF    OB    OP    AA    AF    AB    AP    FF    FB    FP    BB    BP    PP   
  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn 
  F4=5  F6=1  N/A=140  NEW-8=1  PASS=33
=== perpendicular  [perpendicular]  expected DOF removed (sep): 1
  LL    LC    LS    LR    LO    LA    LF    LB    LP    CC    CS    CR    CO    CA    CF   
  CPPC  CPPC  PPPP  P4PP  nnnn  nnnn  nnnn  nnnn  nnnn  CPPC  PPPP  P4PP  nnnn  nnnn  nnnn 
  CB    CP    SS    SR    SO    SA    SF    SB    SP    RR    RO    RA    RF    RB    RP   
  nnnn  nnnn  CPPC  PPPP  nnnn  nnnn  nnnn  nnnn  nnnn  PPPP  nnnn  nnnn  nnnn  nnnn  nnnn 
  OO    OA    OF    OB    OP    AA    AF    AB    AP    FF    FB    FP    BB    BP    PP   
  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn 
  F4=2  N/A=140  NEW-3=8  PASS=30
=== collinear  [collinear]  expected DOF removed (sep): 2
  LL    LC    LS    LR    LO    LA    LF    LB    LP    CC    CS    CR    CO    CA    CF   
  PPPP  PPPP  PPPP  PPPP  nnnn  nnnn  nnnn  nnnn  nnnn  PPPP  PPPP  PPPP  nnnn  nnnn  nnnn 
  CB    CP    SS    SR    SO    SA    SF    SB    SP    RR    RO    RA    RF    RB    RP   
  nnnn  nnnn  PPPG  PPPP  nnnn  nnnn  nnnn  nnnn  nnnn  P6PP  nnnn  nnnn  nnnn  nnnn  nnnn 
  OO    OA    OF    OB    OP    AA    AF    AB    AP    FF    FB    FP    BB    BP    PP   
  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn 
  F6=1  N/A=140  NEW-7=1  PASS=38   (as of task 512; after task 511: PASS=39, F6 and NEW-7 gone from this row)
=== tangent  [tangent]  expected DOF removed (sep): 1
  LL    LC    LS    LR    LO    LA    LF    LB    LP    CC    CS    CR    CO    CA    CF   
  nnnn  nnnn  nnnn  nnnn  PPPP  PPPP  PPPP  nnnn  nnnn  nnnn  nnnn  nnnn  PPPP  PPPP  PPPP 
  CB    CP    SS    SR    SO    SA    SF    SB    SP    RR    RO    RA    RF    RB    RP   
  nnnn  nnnn  nnnn  nnnn  PPPP  PPPP  PPPP  nnnn  nnnn  nnnn  PPPP  PPPP  PPPP  nnnn  nnnn 
  OO    OA    OF    OB    OP    AA    AF    AB    AP    FF    FB    FP    BB    BP    PP   
  PFPP  PPPP  PPPP  nnnn  nnnn  PFPP  PPPP  nnnn  nnnn  PPPP  nnnn  nnnn  nnnn  nnnn  nnnn 
  N/A=108  NEW-6=2  PASS=70
=== equal  [equal]  expected DOF removed (sep): 1/0
  LL    LC    LS    LR    LO    LA    LF    LB    LP    CC    CS    CR    CO    CA    CF   
  PPPP  PPPP  PPPP  PPPP  nnnn  nnnn  nnnn  nnnn  nnnn  PPPP  PPPP  PPPP  nnnn  nnnn  nnnn 
  CB    CP    SS    SR    SO    SA    SF    SB    SP    RR    RO    RA    RF    RB    RP   
  nnnn  nnnn  PPPP  PPPP  nnnn  nnnn  nnnn  nnnn  nnnn  PPPP  nnnn  nnnn  nnnn  nnnn  nnnn 
  OO    OA    OF    OB    OP    AA    AF    AB    AP    FF    FB    FP    BB    BP    PP   
  PPPP  2222  PPPP  nnnn  nnnn  PPPP  PPPP  nnnn  nnnn  PPPP  nnnn  nnnn  nnnn  nnnn  nnnn 
  F2=4  N/A=116  PASS=60
=== midpoint (line + joint)  [midpoint-line]  expected DOF removed (sep): 2
  LL    LC    LS    LR    LO    LA    LF    LB    LP    CC    CS    CR    CO    CA    CF   
  PPPP  PPPP  PPPP  PPPP  PnPP  PPPP  PPPP  PPPP  PnPP  PPPP  PPPP  PPPP  PnPP  PPPP  PPPP 
  CB    CP    SS    SR    SO    SA    SF    SB    SP    RR    RO    RA    RF    RB    RP   
  PPPP  PnPP  PPPP  PPPP  PnPP  PPPP  PPPP  PPPP  PnPP  PPPP  PnPP  PPPP  PPPP  PPPP  PnPP 
  OO    OA    OF    OB    OP    AA    AF    AB    AP    FF    FB    FP    BB    BP    PP   
  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn 
  N/A=68  PASS=112
=== midpoint (3 joints)  [midpoint-3pt]  expected DOF removed (sep): 2
  LL    LC    LS    LR    LO    LA    LF    LB    LP    CC    CS    CR    CO    CA    CF   
  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP 
  CB    CP    SS    SR    SO    SA    SF    SB    SP    RR    RO    RA    RF    RB    RP   
  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP 
  OO    OA    OF    OB    OP    AA    AF    AB    AP    FF    FB    FP    BB    BP    PP   
  PnPP  PPPP  PPPP  PPPP  PnPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PnPP 
  N/A=3  PASS=177
=== dim point-point aligned  [dim-aligned]  expected DOF removed (sep): 1
  LL    LC    LS    LR    LO    LA    LF    LB    LP    CC    CS    CR    CO    CA    CF   
  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP 
  CB    CP    SS    SR    SO    SA    SF    SB    SP    RR    RO    RA    RF    RB    RP   
  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP 
  OO    OA    OF    OB    OP    AA    AF    AB    AP    FF    FB    FP    BB    BP    PP   
  PnPP  PPPP  PPPP  PPPP  PnPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PnPP 
  N/A=3  PASS=177
=== dim point-point H  [dim-horizontal]  expected DOF removed (sep): 1
  LL    LC    LS    LR    LO    LA    LF    LB    LP    CC    CS    CR    CO    CA    CF   
  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP 
  CB    CP    SS    SR    SO    SA    SF    SB    SP    RR    RO    RA    RF    RB    RP   
  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  P-PP  P-PP  PPPP  P-PP  PPPP  P-PP 
  OO    OA    OF    OB    OP    AA    AF    AB    AP    FF    FB    FP    BB    BP    PP   
  PnPP  PPPP  PPPP  PPPP  PnPP  PPPP  PPPP  PPPP  P-PP  PPPP  PPPP  P-PP  PPPP  PPPP  PnPP 
  N/A=3  NA-BUILD=6  PASS=171
=== dim point-point V  [dim-vertical]  expected DOF removed (sep): 1
  LL    LC    LS    LR    LO    LA    LF    LB    LP    CC    CS    CR    CO    CA    CF   
  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP 
  CB    CP    SS    SR    SO    SA    SF    SB    SP    RR    RO    RA    RF    RB    RP   
  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  P-PP  P-PP  PPPP  P-PP  PPPP  P-PP 
  OO    OA    OF    OB    OP    AA    AF    AB    AP    FF    FB    FP    BB    BP    PP   
  PnPP  PPPP  PPPP  PPPP  PnPP  PPPP  PPPP  PPPP  P-PP  PPPP  PPPP  P-PP  PPPP  PPPP  PnPP 
  N/A=3  NA-BUILD=6  PASS=171
=== dim line length  [dim-length]  expected DOF removed (sep): 1
  L     C     S     R     O     A     F     B     P    
  P-PP  P-PP  P-PP  P-P-  n-nn  n-nn  n-n-  n-n-  n-n- 
  N/A=12  NA-BUILD=13  PASS=11
=== dim point to line  [dim-point-line]  expected DOF removed (sep): 1
  LL    LC    LS    LR    LO    LA    LF    LB    LP    CC    CS    CR    CO    CA    CF   
  AAAA  AAAA  AAAA  AAAA  AnAA  AAAA  AAAA  AAAA  AnAA  AAAA  AAAA  AAAA  AnAA  AAAA  AAAA 
  CB    CP    SS    SR    SO    SA    SF    SB    SP    RR    RO    RA    RF    RB    RP   
  AAAA  AnAA  AAAA  AAAA  AnAA  AAAA  AAAA  AAAA  AnAA  AAAA  AnAA  AAAA  AAAA  AAAA  AnAA 
  OO    OA    OF    OB    OP    AA    AF    AB    AP    FF    FB    FP    BB    BP    PP   
  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn 
  N/A=68  NEW-1=112
=== dim line to line (parallel)  [dim-line-line]  expected DOF removed (sep): 1
  LL    LC    LS    LR    LO    LA    LF    LB    LP    CC    CS    CR    CO    CA    CF   
  E-PP  E-PP  ----  ----  nnnn  nnnn  nnnn  nnnn  nnnn  E-PP  ----  ----  nnnn  nnnn  nnnn 
  CB    CP    SS    SR    SO    SA    SF    SB    SP    RR    RO    RA    RF    RB    RP   
  nnnn  nnnn  P-PP  ----  nnnn  nnnn  nnnn  nnnn  nnnn  E-PP  nnnn  nnnn  nnnn  nnnn  nnnn 
  OO    OA    OF    OB    OP    AA    AF    AB    AP    FF    FB    FP    BB    BP    PP   
  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn 
  N/A=140  NA-BUILD=25  NEW-5=4  PASS=11
=== dim line to line (other pick order)  [dim-line-line-yx]  expected DOF removed (sep): 1
  LL    LC    LS    LR    LO    LA    LF    LB    LP    CC    CS    CR    CO    CA    CF   
  P-PP  P-PP  ----  ----  nnnn  nnnn  nnnn  nnnn  nnnn  P-PP  ----  ----  nnnn  nnnn  nnnn 
  CB    CP    SS    SR    SO    SA    SF    SB    SP    RR    RO    RA    RF    RB    RP   
  nnnn  nnnn  E-PP  ----  nnnn  nnnn  nnnn  nnnn  nnnn  P-PP  nnnn  nnnn  nnnn  nnnn  nnnn 
  OO    OA    OF    OB    OP    AA    AF    AB    AP    FF    FB    FP    BB    BP    PP   
  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn 
  N/A=140  NA-BUILD=25  NEW-5=1  PASS=14
=== dim angle (X then Y)  [dim-angle-xy]  expected DOF removed (sep): 1
  LL    LC    LS    LR    LO    LA    LF    LB    LP    CC    CS    CR    CO    CA    CF   
  PPPP  PPPP  PDPP  3D33  nnnn  nnnn  nnnn  nnnn  nnnn  PPPP  PDPP  3D33  nnnn  nnnn  nnnn 
  CB    CP    SS    SR    SO    SA    SF    SB    SP    RR    RO    RA    RF    RB    RP   
  nnnn  nnnn  -4--  3DDD  nnnn  nnnn  nnnn  nnnn  nnnn  ----  nnnn  nnnn  nnnn  nnnn  nnnn 
  OO    OA    OF    OB    OP    AA    AF    AB    AP    FF    FB    FP    BB    BP    PP   
  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn 
  F3=7  F4=1  N/A=140  NA-BUILD=7  NEW-4=7  PASS=18   (as of task 512; after task 511: F3=0, NEW-4=0, PASS=32)
=== dim angle (Y then X)  [dim-angle-yx]  expected DOF removed (sep): 1
  LL    LC    LS    LR    LO    LA    LF    LB    LP    CC    CS    CR    CO    CA    CF   
  3333  3333  3433  PPPP  nnnn  nnnn  nnnn  nnnn  nnnn  3333  3433  PPPP  nnnn  nnnn  nnnn 
  CB    CP    SS    SR    SO    SA    SF    SB    SP    RR    RO    RA    RF    RB    RP   
  nnnn  nnnn  -P--  PPPP  nnnn  nnnn  nnnn  nnnn  nnnn  ----  nnnn  nnnn  nnnn  nnnn  nnnn 
  OO    OA    OF    OB    OP    AA    AF    AB    AP    FF    FB    FP    BB    BP    PP   
  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn 
  F3=18  F4=2  N/A=140  NA-BUILD=7  PASS=13
=== dim radius  [dim-radius]  expected DOF removed (sep): 1/0
  L     C     S     R     O     A     F     B     P    
  n-nn  n-nn  n-nn  n-n-  P-Pn  P-Pn  n-n-  n-n-  n-n- 
  N/A=19  NA-BUILD=13  PASS=4
```

### Result

3384 cells: **1625 PASS, 1416 N/A by UI (the real tool refused the selection, document untouched), 163 not buildable, 41 FAIL caused by a round-1 finding, 139 FAIL NEW**

AFTER TASK 511 (F6, F3, full-derivative Jacobian, Fusion collinear/pointOnLine placement; `node scripts/coverage-audit.cjs`): 3384 cells: **1657 PASS**, 1416 N/A, 163 not buildable, 16 FAIL caused by a round-1 finding (F2=4, F4=11, F6=1: a `parallel` between two rect sides that share a corner, whose analytic Jacobian differs from finite differences because the shared joint index repeats in one row), 132 FAIL NEW (NEW-1=112, NEW-3=8, NEW-5=5, NEW-6=6, NEW-8=1). NEW-4 (fixed in 511: the ANGLE branch carries the reference flags) and NEW-7 (its repro passes; the one cell that remained, collinear of two already-collinear rect sides, is redundant: DOF delta 0 agrees with the finite-difference count, PlaneGCS counts -1, expectation updated in matrix-run.js `preCollinear`) are gone from the matrix.
(0 unexplained; counts as of the merge with main after task 510 and the other fixes on main: the F1 cells are gone, F4 fell from 28 to 10). Round-1 attribution (cells, tolerated not required): F1 0 (fixed), F2 4 (equal circle/arc refused),
F3 25 (clockwise angle pick order moves the drawing at its own measured value; 3 of these are the dim-angle-yx LL/LC/CC shared-joint cells, which showed F4 no-ops before task 510 and now show the F3 signature: accepted, residual 7e-11, bite 4.8e-9, DOF delta -1 on panel, finite difference and PlaneGCS, only the geometry moves, the same signature as the sep cells of that row while the xy order passes), F4 10 (parallel / perpendicular / angle between lines sharing a joint, the rest),
F6 2 (collinear DOF != finite difference), F5 0 (F5's order-dependent refusal did not show; NEW-6 is the same family), F7/F8 not reachable from a single-constraint cell.

Everything not listed passed: a refused selection is refused cleanly, accepted constraints converge, the Design panel delta equals the finite-difference and the PlaneGCS delta
(except F6/NEW-7), the 3% jittered re-solve keeps every constraint, delete brings the nullity back and undo restores the document, in all four variants. In particular coincident,
horizontal / vertical, midpoint (both forms), tangent line/circle, parallel, collinear, point-point dimensions and radius dimensions of circles and arcs all behave on every
buildable pair; the fillet arc, polygon side, rect side and bezier endpoints behave like their plain counterparts.

## New findings (ranked)

Each is pinned as a `KNOWN` entry in `tests/coverage-matrix.test.js`; the repro is in `tests/harness/coverage/matrix-findings.js` (`node scripts/coverage-audit.cjs` prints it). The ones marked FIXED have had their pin deleted (see "Fixed in task 520" below).

### 1. NEW-1 (HIGH) [FIXED task 520]: the point-to-line dimension throws ReferenceError on every use (and leaves its undo group open)

* Verdict: BUG. Cells: 112 (e.g. dim-point-line LL/sep, dim-point-line LL/shared, dim-point-line LL/locked, dim-point-line LL/dimmed).
* Repro (verbatim, `node scripts/coverage-audit.cjs`): `second click (joint, then line): ReferenceError: c is not defined; constraints created: pointOnLine, distance=40.000; undo group left open: true`
* Diagnosis: packages/ui/input-handlers/dimension-tool.js:619 calls finalizeDimBirth(c, state) AFTER the block that declares `const c` (line 610): `c` is out of scope. The constraints are already created when it throws, but endDimUndo never runs.
* Proposed task: declare c before the if (a && b && firstJ) block, or move finalizeDimBirth inside it; add a node test that drives joint-then-line and asserts no throw and one undo step.

### 2. NEW-5 (HIGH) [FIXED task 520]: a line-to-line dimension made with the Dimension tool is born as a REFERENCE (ERR-CSOLVE-02) with a NEGATIVE value, in one of the two click orders

* Verdict: BUG. Cells: 5 (e.g. dim-line-line LL/sep, dim-line-line LC/sep, dim-line-line CC/sep, dim-line-line RR/sep).
* Repro (verbatim, `node scripts/coverage-audit.cjs`): `click line 1 then line 2: value -75.89 driven=true (sandbox-conflict [ERR-CSOLVE-02]); click line 2 then line 1: value 75.89 driven=false`
* Diagnosis: dimension-tool.js:437 passes value: perpendicularDistance(j1a, j2a, j2b), which is SIGNED (geometry.js:122-130 uses a normal vector); definitions.js:32 compares Math.abs(signed) - value, so a negative value is a conflict and the sandbox demotes it. Which order breaks depends on which side line 2 is on.
* Proposed task: pass Math.abs(...) (the solver already uses |signed|); test: both click orders on any two parallel lines give a driving, positive dimension.

### 3. NEW-3 (HIGH) [FIXED task 520]: perpendicular is refused (ERR-CSOLVE-01) between two EXACTLY parallel lines (angle 0 or 180), e.g. two lines that are both horizontal

* Verdict: BUG. Cells: 8 (e.g. perpendicular LL/sep, perpendicular LL/dimmed, perpendicular LC/sep, perpendicular LC/dimmed).
* Repro (verbatim, `node scripts/coverage-audit.cjs`): `first line horizontal; second line direction (60,0) parallel: accepted=false; (60,0.01) 0.01 deg: accepted=true; (60,30) 27 deg: accepted=true`
* Diagnosis: constraint-manager.js:1019-1020 lockPerpendicularBranch skips the branch lock when |sin theta| < 0.1, so definitions.js:288 falls back to r = u.v. From an EXACTLY parallel start cross(u,v) = 0 is a stationary point of that residual: 500 iterations stay at the start (residual pi/2; the forced add does not converge either). A 0.01 degree tilt already solves, so the failure is only the exact-parallel case, which is the common one (lines with H or V constraints, snapped lines). PlaneGCS solves the same constraint.
* Proposed task: give the branchless perpendicular a starting rotation (pick the branch from the sign of cross, or +1 when it is 0) instead of skipping; test: perpendicular on two parallel horizontal lines is accepted and solves.

### 4. NEW-2 (HIGH) [FIXED task 520]: the point-to-line dimension does not hold a perpendicular distance: the helper joint slides along the line

* Verdict: BUG. Cells: 22 (e.g. dim-point-line LL/sep, dim-point-line LC/sep, dim-point-line LS/sep, dim-point-line LO/sep).
* Repro (verbatim, `node scripts/coverage-audit.cjs`): `perpendicular distance 40.000 when dimensioned; after swinging the line end it is 22.283 with max residual 1.5e-8 (the dimension reads satisfied)`
* Diagnosis: dimension-tool.js:597-612 makes a helper joint on the line (pointOnLine) and dimensions |P - helper|; nothing makes P-helper perpendicular to the line, so the helper slides and the real perpendicular distance changes while every residual is 0. It also leaves the helper as 1 free DOF in the Design panel.
* Proposed task: add a perpendicular (or a point-line distance row in definitions.js, as line-line has) so the dimension is the true point-to-line distance; test: lock P and one line end, swing the other end, the distance must hold.

### 5. NEW-4 (MEDIUM) [FIXED task 511]: a REFERENCE angle dimension comes back as a DRIVING one after undo (its driven flag is lost; redo restores through the same function, not separately verified)

* Verdict: BUG. Cells: 7 (e.g. dim-angle-xy LS/shared, dim-angle-xy LR/shared, dim-angle-xy CS/shared, dim-angle-xy CR/shared).
* Repro (verbatim, `node scripts/coverage-audit.cjs`): `reference angle created isDriven=true nullity 6; after delete + undo: isDriven=false nullity 5`
* Diagnosis: packages/core/constraints.js:275-283 createConstraint(ANGLE) builds {type, shapes, value, offset, glyphPos} and drops isDriven / driven / drivenReason (the distance and line-line branches carry them, :226-250). Undo restores constraints through addConstraintObject -> addConstraint -> createConstraint, so the reference becomes a driver and the DOF drops.
* Proposed task: carry isDriven / driven / drivenReason in the ANGLE branch like the line-line distance does; test: a reference angle survives saveState + undo with the same nullity.

### 6. NEW-6 (LOW) [radius cells FIXED tasks 515 + 523]: a feasible tangent between a circle and an arc (or two arcs) is refused when the arc radius has to change a lot; PlaneGCS solves it

* Verdict: BUG. Cells: 6 (e.g. tangent RA/shared, tangent OA/shared, tangent OA/dimmed, tangent AA/shared).
* Repro (verbatim, `node scripts/coverage-audit.cjs`): `tangent circle/arc, centres dimensioned 151 apart: accepted=false errors=ERR-CSOLVE-01 oracleFeasible=true`
* Diagnosis: the radius of an arc is a joint distance the solver must move; from the current pose even 500 iterations leave the residual at 53 (circle 15 / arc 20 with the centres dimensioned 151 apart: tangent needs R 136). Same family as F5 (feasibility judged from the pose) but not a sandbox-burst issue: a forced add does not converge either.
* Proposed task: seed the arc radius from the tangency (like seedFilletForRadius does for fillets) or verify with a continuation; test: the tangent in this repro is accepted.
* Task 515: the circle/arc cells (tangent OA/shared, OA/dimmed) PASS, the circle's radius is a solver unknown and moves. The repro now uses the
  still-failing arc/arc pair (`tangent arc/arc, centres dimensioned 151 apart: accepted=false errors=ERR-CSOLVE-01 oracleFeasible=true`). Found while
  doing it: the ARC side of the tangent rows (line-arc away from a shared rim, circle-arc, arc-arc) reads the arc radius as a constant taken from
  the joints at assembly, so its rim columns differ from finite differences by 0.98 (`.evidence/515/arc-tangent-probe.txt`, same on origin/main):
  a likely cause of the remaining NEW-6 cells; arcs were out of scope for 515.
* Task 523: confirmed and fixed. Every tangent form with an arc read the arc radius as a constant (`line-arc {line,circle}: rows 1, max |J - fd| = 9.81e-1 at as.x`, the
  same for circle-arc, arc-circle, arc-arc, both branches). definitions.js now has ONE radius operand (`radiusValue` / `addRadiusDerivative`: a circle's unknown, an
  arc's live |rim - centre| through its first rim joint, or a constant) shared by point-on-circle and every tangent form, declared once in engine.js
  (`_radiusOperand`); every arc tangent form now equals finite differences (max 2.5e-9, tests/jacobian-fd-guard.test.js). Cells 5 -> 3 in the test run
  (`scripts/coverage-audit.cjs`: 4 -> 2): the dimmed cells (AA/dimmed, AF/dimmed, the repro) are accepted and the repro was deleted from matrix-findings.js.
  The KNOWN entry stays for two other families (diagnosed, not fixed):
  * tangent OO/shared: two concentric circles of equal radius (15). `ConstraintManager.lockTangentBranch` locks 'external' when the radii are equal ("Equal radii ->
    tInt = 0 (concentric); always pick external"); external needs r1 + r2 = 0, reachable only by a collapse or a negative radius (refused). The internal branch is
    already satisfied, which is what PlaneGCS finds.
  * tangent AA/shared: arc Y is centred ON arc X's first rim (the shared variant merges Y's centre into X's joints[1]). |C1C2| = r1, so the nearest solution of
    either branch is rY = 0 (Y collapses, refused by task 521's rule); the non-degenerate solution (internal, rY = 2 rX) is far from the pose.
  * Run order: SA/shared and RA/shared (an arc centred on the end of a polygon / rect side) show as NEW-6 when the tangent row runs alone and PASS in the full
    matrix. OUR answer is the same in both orders (refused, ERR-CSOLVE-01); only the PlaneGCS oracle verdict flips (oracleFeasible true alone, false in the
    full run). The geometry (the line passes through the arc's centre) is infeasible without collapsing the arc.

### 7. NEW-8 (LOW): parallel between a polygon side and a LOCKED rect top converges slowly

* Verdict: BUG (marginal). Cells: 1 (parallel SR/locked).
* Observed: the constraint is accepted at residual 8.1e-4 (inside the 0.001 tolerance), and a re-solve from a 3% jitter stops at 6.3e-3 after 500 iterations (outside it).
* Diagnosis: UNVERIFIED. A rigid polygon (equal sides and radii) has to rotate as a whole about its centre to satisfy the parallel; the Newton step is slow there. One cell of 3384.
* Proposed task: none yet; fold into the convergence work of NEW-6 if it recurs.

### 8. NEW-7 (LOW) [FIXED task 511]: collinear removes 1 DOF in the Design panel (and in the finite-difference count) where PlaneGCS removes 2, for two polygon sides with an aligned dimension between their start joints

* Verdict: BUG. Cells: 1 (e.g. collinear SS/dimmed).
* Repro (verbatim, `node scripts/coverage-audit.cjs`): `collinear polygon sides, pre-dimensioned: panel delta -1, finite-difference delta -1, PlaneGCS delta -2, expected -2`
* Diagnosis: UNVERIFIED root: collinear is one-sided (constraint-manager.js anchors the first line; the solver only moves the second line points), so the DOF the panel reads may not be the DOF of the geometric constraint. Same family as F6.
* Proposed task: check the one-sided collinear rows in jointFreedom the way F6 proposes for pointOnLine, then re-run this cell.

## Fixed in task 515 (F2: a circle's radius is a solver unknown)

Cell counts (`node tests/coverage-matrix.test.js`): 3384 cells: **1789 PASS**, 1416 N/A, 163 not buildable, 12 FAIL caused by a round-1 finding (F4=11, F6=1), 4 FAIL NEW (NEW-6=3, NEW-8=1), 0 unexplained. The four F2 cells (equal OA sep/shared/locked/dimmed) and two NEW-6 cells (tangent OA shared/dimmed) pass. Expectations changed because a circle has 3 DOF (each agrees with the finite-difference count and with PlaneGCS, whose circle has a free radius): `dim-radius` on a circle removes 1 (was 0), `equal` circle/circle removes 1 (was 0); the PlaneGCS translation (tests/harness/audit/lib.js) no longer fixes an undimensioned circle's radius. One cell is not compared with PlaneGCS: tangent between two circles that SHARE their centre (dist - |r1 - r2| with dist = 0 is r1 = r2, 1 DOF for us and finite differences; PlaneGCS's tangent_cc counts 0 there while its equal_radius_cc counts 1: `.evidence/515/planegcs-concentric-probe.txt`). The NEW-6 count varies between 3 and 5 with the run order (tangent SA/RA shared, arc cells with no circle, also on origin/main).

## Fixed in task 520 (NEW-1, NEW-2, NEW-3, NEW-5)

Cell counts after the fixes (`node tests/coverage-matrix.test.js`): 3384 cells: **1783 PASS**, 1416 N/A, 163 not buildable, 16 FAIL caused by a round-1 finding (F2=4, F4=11, F6=1), 6 FAIL NEW (NEW-6=5, NEW-8=1), 0 unexplained. The repros of NEW-1, NEW-2, NEW-3, NEW-5 became passing assertions in `tests/dimension-point-line.test.js` (node) and `tests/dimension-point-line-live.test.js` (real pointer, SketchStudio); their `KNOWN` entries, repro pins and classify rules are deleted.

* NEW-1: `handleDimensionPointerDown` is now a wrapper that closes any undo group the click opened on every exit (return or throw, nothing caught); the scope bug is gone with the rewrite below.
* NEW-2: a point-to-line dimension is now ONE `distance` constraint stored with three joints `[point, line end A, line end B]` (the arity is the declaration, like a joint-form collinear / equal). The solver reuses the existing line-line row (`distance.__lineLine`: |perpendicular distance from P to line AB| - value), no helper joint and no pointOnLine, so it removes exactly 1 DOF and holds when the line swings. The verifier, the renderer, the live value check, `toggleDriving` and the conflict pre-checks understand the form (`isPointLineDistance` in geometry.js).
* NEW-5: the line-line value is `Math.abs(perpendicularDistance(...))`; the side is not stored (the solver row is |signed|, as before).
* NEW-3: `ConstraintManager.placeForCreation` rotates the second-picked line 90 degrees counter-clockwise (pivot: a fixed or shared joint of that line, else its midpoint) when the start is EXACTLY parallel; `_sandboxVerify` starts from the same placed pose, so the check judges the real add. No branch is locked afterwards: the branched residual is stationary at 90 degrees (its Jacobian row is zero there and would hide the removed DOF).

## Fixed in task 523 (NEW-6 radius cells: the arc side of the tangent rows)

Cell counts (`node tests/coverage-matrix.test.js`): 3384 cells: **1788 PASS**, 1416 N/A, 163 not buildable, 12 FAIL caused by a round-1 finding (F4=11, F6=1), 5 FAIL NEW (NEW-6=3, NEW-9=2), 0 unexplained (before: PASS=1786, NEW-6=5). Properties: the S-curve's tangent rows now equal finite differences, its panel DOF equals the finite-difference nullity and its second arc radius dimension is no longer demoted (3 N-F7 KNOWN entries deleted; the S-curve still has nullity 1 and does not return from a 2% jitter: the double root of N-F7 remains). Who moves (docs/FUSION-COMPARISON.md "After task 523"): an arc's radius now takes part in the least-change solve, so a tangent to an arc may resize it where Fusion keeps it; KNOWN as placement, task 525.

F6 measured (not fixed): a `parallel` between two lines that share a corner joint (the F6 rect-side cell). Probe (L1 a-b, L2 b-c): `shared corner (L2 starts at L1 end b): max |J - fd| = 2.90e+1 at b.x` (b.x analytic 1.000, finite difference 30.000), against `separate (L2 = c-d): max |J - fd| = 4.11e-8`. Cause: `Definitions.parallel.computeJacobian` ASSIGNS the four joints' columns (`outRow[bI*2] = vy`, then `outRow[cI*2] = uy`), so when c === b the v part overwrites the u part instead of adding to it: the same overwrite bug turn 404 fixed for `equal`. Not the arc-radius family (that one was a missing dependency). `perpendicular` and `angle` assign their columns the same way, a likely cause of the F4 shared-joint cells (not measured). tests/jacobian-fd-guard.test.js does not catch it: its cases use distinct joints.

## Fixed in task 533 (F6 / F4: a row that names the same joint twice ACCUMULATES)

Cause, measured on every row (`.evidence/533/probe-shared-joints.mjs`, engine._assemble against central finite differences): 57 of 106 row x
sharing patterns were wrong before, 0 after. Every row that ASSIGNED a joint's columns lost all but the last partial when its joint list
repeated an index: parallel / perpendicular (plain and branch +-1) / angle with the two lines sharing any end or being the same line
(up to `1.40e+1`), the line-line distance and the point-to-line distance / pointOnLine whose point is an end of its own line (`9.58e-1`),
tangent line-circle / line-arc whose line ends on the centre, H / V / coincident / H-V dimension given one joint twice, midpoint with the
midpoint on an end, collinear given `[a, b, a]`. Already right: equal (turn 404), the tangent shared-rim form, every arc radius term
(addRadiusDerivative), collinear from shapes (it dedupes). Fix: ONE helper in `solver/definitions.js`, `addGrad(outRow, joint, gx, gy)`
(`+=` on the joint's two columns), used by EVERY row for every joint column (addRadiusDerivative uses it too); every row starts at zero
(engine._assemble allocates a fresh zero-filled row per constraint, `rowBuf.fill(0.0)` / `outRows[k].fill(0.0)`), so a distinct-joint row is
bit-identical. The two private zeroings (equal's `outRow.fill`, the tangent shared-rim block) are gone. Guard: tests/jacobian-fd-guard.test.js
now runs 82 shared-joint cases (every two-line row x b=c, b=d, a=c, a=d, the same line, the same line reversed; and the point / centre /
same-joint cases); on the old definitions it fails `58 of 82 shared-joint rows differ from finite differences`.

Counts before -> after (same commands, old vs new definitions):
* coverage-matrix: PASS 1789 -> **1801**, F4 11 -> 0, F6 1 -> 0, NEW-6 2, NEW-9 2, 0 unexplained. Cell changes (`.evidence/533/matrix-cells-diff.txt`):
  parallel CR / CS / LR / LS / SR shared and perpendicular CR / LR shared were REFUSED (PlaneGCS: feasible) and are now accepted, DOF -1 = finite
  differences = PlaneGCS; dim-angle-xy / -yx CS / LS shared now keep the angle after a jittered re-solve; parallel RR shared (two horizontal rect
  sides sharing a corner): DOF -1 -> 0, now equal to finite differences (0); PlaneGCS still counts -1, the same PlaneGCS miscount as collinear on
  that pair, so `preCollinear` in matrix-run.js now covers parallel too (proof: the row is a combination of the two H rows,
  `.evidence/533/rr-shared-oracle-after.txt`: `panel nullity 6, finite-difference nullity 6, PlaneGCS dof 5 (redundant 0`).
* extreme-arcs: PASS 1711 -> **1721**, FAIL 205 -> 195; F6 15 -> 0, F4 4 -> 0, EA-6 15 -> 17, EA-1 51 -> 52, EA-2 99 -> 98, the rest unchanged
  (`.evidence/533/arcs-cells-diff.txt`, 21 cells). Accepted now, refused before: f90r0.5 parallel-chord and perpendicular-chord shared,
  r0.5s181cw parallel-chord shared, r5000c20ccw perpendicular-chord shared (was a clean refusal), r5000s5cw parallel-chord shared. Refused now,
  accepted before: s30cw perpendicular-chord shared (PlaneGCS: infeasible, refused cleanly). The jitter bite of every accepted parallel /
  perpendicular shared cell (`.evidence/533/shared-chord-bite-table.txt`): under the 1e-3 tolerance in all of them except EA-6: f90r0.5
  perpendicular (2.3e+0, newly accepted), r0.5s181cw parallel (4.0e-3, newly accepted) and perpendicular (1.3e+0 -> 3.0e-1), r5000c20ccw
  perpendicular (6.7e-2, newly accepted); r5000c20cw perpendicular left EA-6 (4.1e+0 -> 2.8e-5). Other verdicts: f2r10 parallel-chord shared now
  shows EA-1 (a radius edit x1.5 / x0.67 collapses the sweep; before, only the Jacobian issue was recorded), s180cw perpendicular keeps EA-2
  but no longer shows drag-stale-large-arc, s181cw perpendicular now shows EA-2 (drag-stale-large-arc). The task 525
  control cell `s30cw parallel-chord shared` is refused on main before and after (ERR-CSOLVE-01, PlaneGCS infeasible).
* coverage-properties: I2 285 -> **299** of 300 (F6 14 -> 0), I3 294 -> 296 (F6 2 -> 0), I7 293 -> 294 (F6 2 -> 1), I1 292 unchanged (F6 8:
  the pointOnLine trigger, not this family), unexplained 0. Ops: refused 400 -> 399, demoted to reference 119 -> 117
  (`.evidence/533/prop-ops-outcome-diff.txt`): seed 7071 op 7 perpendicular and 7079 op 7 parallel refused -> driving; 7160 ops 5 and 9 (H/V and
  aligned dimensions) reference -> driving; 7191 op 6 collinear driving -> refused (a different start: the earlier ops solve differently; PlaneGCS
  finds it feasible, our solve collapses line 5, the NEW-9 / task 521 refusal, `.evidence/533/prop-7191-oracle-after.txt`). In every one of
  these final states panel = finite differences = PlaneGCS (before: 7191 11 / 12 / 12, 7160 0 / 2 / 2).
* constraint-audit, fusion-oracle (315 / 2438 graded / 954 drawing rows), fusion-dim-edit (864 runs), solver-scenarios: output identical.
* Fixture DOF: every recorded drawing (13, nullity after every recipe step) and owner-trapezoid.document.json identical
  (`.evidence/533/fixture-dof-before.txt` = `-after.txt`).

EA-6 after the fix (`node tests/extreme-arcs.test.js --cell r0.5s30cw perpendicular-chord sep`, unchanged by it: a sep cell repeats no joint):
measured in `.evidence/533/ea6-diagnose-after.txt`. The tool locks the branch (`"branch":1`), so the row is `u x v - |u||v|`, which has a DOUBLE
root at the target: r ~ |u||v| d^2 / 2 for an angle error d, its gradient vanishes there (`rankDeficient true`). The solve stops with r at the
1e-6 tolerance, i.e. d = sqrt(2e-6 / (|u||v|)) = 1.163e-3 for |chord| 0.1847 x |line| 7.999; measured `u.v/(|u||v|) -1.162e-3`, above
VERIFIER_TOLERANCE 1e-3, and four more 500-iteration solves do not move it. So for the perpendicular cells the un-normalised scale is not the
cause: normalising by |u||v| would leave d = sqrt(2e-6) = 1.41e-3 at every size (worse here). The parallel / collinear EA-6 cells (`u x v`, a
simple root) are not explained by this and were not diagnosed. EA-7 (`r0.5s0.1cw collinear-chord sep`) is unchanged by the fix (no repeated
joint), so it is not the F6 family.

## Observations that are not failures

* **O3 silent redundancy**: a parallel between two rect tops (both already horizontal), an equal between two fillet arcs (both already R-dimensioned) are accepted with no
  warning and no effect (delta 0). The app flags redundant dimensions (reference) but not redundant geometric constraints (same as O1 of round 1).
* The H / V dimension rows pass in the sep, shared and locked variants (F1 only appears when an aligned dimension is already on the pair).
* `toggleDriving` (`dimension-seams.js:109-122`) demotes the other driver on a pair by joint pair only (no `dimMode`), the same family as F1; no matrix cell exercises it (the driving / reference toggle is a deferred edit feature).
* PlaneGCS needed two extra mappings (collinear = both end points on the other line; tangent_cc) and a "collapsed line is not a solution" rule to give honest feasibility
  verdicts; without them it reported collapsing a rect top onto a slanted locked line as feasible.
* One matrix cell is not deterministic across a cold start (a tangent pair of the NEW-6 family flips between PASS and NEW-6); the test only requires at least one NEW-6 cell. Task 523: it is the PlaneGCS oracle's verdict that flips (SA/RA shared), not our answer (see NEW-6).

## Proposed tasks (in this order)

1. NEW-1 + NEW-2 together (one file, one tool): `dimension-tool.js` point-to-line: fix the scope of `c`, and replace the helper-joint construction by a true point-to-line
   distance (perpendicular foot) so the dimension holds and the helper stops being a free DOF; node test that drives joint-then-line.
2. NEW-5: `Math.abs` the line-line value (one line) + a test of both click orders.
3. NEW-3: break the exact-parallel stall in the branchless perpendicular (pick a branch when cross is 0).
4. NEW-4: carry `isDriven / driven / drivenReason` in the ANGLE branch of `createConstraint` (3 lines) + an undo test.
5. NEW-6 / NEW-8 (convergence, LOW) and NEW-7 (verify first; may fold into the F6 task).

## Properties

Scope: the SketchStudio solver. Audit only: no app code was changed. Reproduce everything with `node scripts/coverage-properties.cjs`; the assertions are `tests/coverage-properties.test.js` (about 17 s). Harness: `tests/harness/coverage/prop-*.js` and `tests/harness/coverage/drawings/n1..n8`. It reuses `tests/harness/audit/lib.js` (applyStep, fdJacobian, PlaneGCS oracle); `prop-oracle.js` adds the two PlaneGCS mappings round 1 lacked (collinear, tangent between arcs). Base: origin/main with task 510's fixes of round-1 F1, F4, F7 merged.

### 1. New drawings (light pipeline: build, recipe one constraint at a time, final state, 3 jittered restarts, PlaneGCS)

| drawing | joints | constr | nullity | panel | finite-diff | PlaneGCS | verifier | Jacobian rows != fd |
|---|---|---|---|---|---|---|---|---|
| N1 scurve (line, arc, arc, line) | 8 | 13 | **1** | 1 | **2** | 2 | 0 | tangent (N-F7) |
| N2 slot | 7 | 13 | 0 | 0 | 0 | 0 | 2e-31 | - |
| N3 collinear + concentric + midpoint symmetry + point on arc | 12 | 19 | 0 | 0 | 0 | 0 | 7e-15 | collinear, pointOnLine on arc (N-F5, F6) |
| N4 construction axis driving symmetry | 15 | 20 | 0 | 0 | 0 | 0 | 0 | pointOnLine (F6) |
| N5 outline, one joint per corner | 9 | 15 | 0 | 0 | 0 | 0 | 0 | - |
| N6 pentagon, fillet on every corner | 21 | 39 | 0 | 0 | 0 | 0 | 9e-15 | - |
| N7 every shape kind (line, construction line, circle, arc, fillet arc, polygon side, rect side, bezier, point) | 29 | 43 | 9 (loose by design) | 9 | 9 | 9 | 5e-9 | pointOnLine (F6) |
| N8 two sketches + a link | 15 | 20 | 0 | 0 | 0 | 0 | 6e-55 | - |

The five round-1 drawings run through the same light pipeline and agree (nullity 0, panel = fd = PlaneGCS; the triangle has the F6 row). N1 is the only drawing that does not reach its designed nullity (finding N-F7). Recipe steps that did not work first time and how they were resolved: N3, N7 and N8 used a second joint pair for the vertical dimension (F1, since fixed on main); N6 needs its polygon off the origin (N-F1) and drawn with the line tool (N-F2).

### 2. Randomised properties: 300 cases, seeds 7000..7299, about 12 s

Geometry: 179 closed polygons (3-9 sides), 64 open polylines, 57 rectangles, plus 0-2 circles and 0-1 arcs each. Ops (2469): every constraint type of `inventory.constraintTypes`, every dimension mode of `inventory.dimensionModes` (point-line through the tool's own three calls; line-line only for parallel lines, so only 4 of 61 tries applied), and Lock. 2401 applied, 374 refused, 149 demoted to reference, 68 not applicable. Dimensions are placed at the measured value and then typed to 0.75..1.3 x (the UI flow).

| invariant | pass | failures explained by | unexplained |
|---|---|---|---|
| I1 adding never raises the nullity | 287/300 | F6 12, N-F5 1 | 0 |
| I2 panel DOF == finite-difference nullity | 251/300 | N-F5 26, F6 18, F4 2, F5 1, mixes 2 | 0 |
| I3 deleting a driving constraint: panel delta == fd rank contribution | 282/300 | N-F5 6, F6 6, F4 2, F5 2, F3 1 | 1 (seed 7090, N-U1) |
| I4 undo restores the document exactly (every history step, JSON-identical) | 292/300 | N-F4 8 | 0 |
| I5 a refused constraint leaves the geometry unchanged | 294/300 | F6 5, F4 1 | 0 |
| I6 no NaN, at any step | 300/300 | - | 0 |
| I7 dimension x0.9 then back restores determined joints, keeps orientation signature | 279/300 | F6 7, N-F6 5, F4 3, F3 3, N-F5 3 | 0 (N-U2 was seed 7091 before task 510's F4 fix) |

How a failure is attributed: removing the ops of one finding (or of all findings present) must make the invariant hold again (ablation); for I7 an edited angle dimension is F3 and a changed orientation signature is N-F6, because ablating dimensions would cure I7 trivially. Anything else is unexplained, is shrunk to a minimal op list with its seed, and fails the test unless pinned (N-U1, N-U2). The F4 attributions remain after task 510: the trigger (perpendicular/angle on lines sharing a joint or coincident cluster) is wider than what that fix covers; I did not check which of those 8 cases still fail for the F4 reason.

Choices that differ from the task text, so the owner can overrule: (a) I7 compares determined joints at 1e-5, not 1e-6, because 1e-6 is the solver's own convergence tolerance (cases between 1e-6 and 1e-5 are solver noise); (b) I7 requires driving residuals below 1e-3 (not 1e-6): the verifier's perpendicular/parallel/equal residuals are in length-squared units, a 40-unit perpendicular pair that the solver calls converged shows u.v = 4.6e-5; (c) I5 is judged only when the sketch was solved before the op (a solve after a refusal otherwise keeps polishing an unsolved sketch); (d) I4 leaves out dimSign / dimSignMode (N-F3 would otherwise fail 44 of 60 cases) and treats "no sketchId" and the default sketch id as equal (undo re-stamps the untagged origin joint; harmless).

### 3. Drag (the select tool's solver calls: dragTarget + QUICK_SOLVE per frame; 6,4 in 5 frames)

Under-constrained (first half of each recipe, every joint with freedom dragged): driving constraints stay within 2e-5 during the drag for 12 of 13 drawings; the filleted pentagon reaches 1.8e-3 (the drag spring is soft). After one full solve every drag returns to < 1e-6 (all 13). No NaN. Fully constrained (11 drawings; scurve and every-kind are not): dragging any joint moves nothing by more than 7.8e-5 (the spring is soft, so it is not exactly zero). A locked joint (fixed) moved 0.0 in every drag, including drags of the locked joint itself. I could not call the UI axis mask (`getDragDOF`, not exported, DOM-bound); it is the panel DOF, which I2 and section 1 already check.

### 4. Save / reload / undo round trip, all 13 drawings

Save to the project store (memory backend, `createProjectStore`), read back, load into a fresh sketch: nullity, panel DOF, geometry (0.0 deviation), constraint count and driving/driven flags identical for all 13. The document is byte-identical for 3 of 13 and identical except `dimSign` / `dimSignMode` for all 13 (N-F3). `replayJournal(buildJournal(...))` rebuilds the identical document for all 13 (9..33 steps each, hash verified).

### 5. Fusion oracle

Not done. `mcp__fusion360__fusion_execute` answered "Cannot connect to Fusion 360 on port 7654" (Fusion not running). Nothing was created in Fusion.

### 6. New findings, ranked

| # | id | severity | what | where | proposed task |
|---|---|---|---|---|---|
| 1 | N-F1 | HIGH | FIXED (task 517). Fillet on a corner AT the origin deletes `j_origin`. Repro: closed triangle with a corner on (0,0), fillet it: origin gone. | `packages/core/fillet.js:328-331` (deletes the whole corner cluster; the cluster includes every joint within 1e-4, `fillet.js:50-58`) | applyFillet: keep j_origin, re-link to it |
| 2 | N-F4 | HIGH | FIXED (task 517). A REFERENCE angle dimension becomes DRIVING again after save / load or undo. | `packages/core/constraints.js:272-284` (ANGLE whitelist has no isDriven/driven; radius lacks driven/drivenReason, `:209-221`; DISTANCE has them) | carry the flags |
| 3 | N-F7 | HIGH | Tangent between two arcs sharing a rim joint (S-curve) is degenerate: nullity 1, 0/3 jittered restarts return. (Task 523 fixed the analytic Jacobian, which now equals fd: panel 1, analytic 1, fd 1; the radius dimension is no longer demoted.) | `packages/core/solver/definitions.js` tangent circle-circle (\|C1C2\| = r1+r2 at its extremum) | shared-rim form cross(C1-Q, C2-Q) = 0, like the line case's `sharedEnd` |
| 4 | N-F5 | MEDIUM | Collinear on two lines that meet at a corner: panel DOF one too low (panel 4, fd 5); deleting it raises panel DOF by 2, true contribution 1. 26 of 300 random cases. | `packages/core/solver/definitions.js:233-247` (one-sided Jacobian), same family as F6 | symmetric Jacobian or drop the degenerate row |
| 5 | N-F2 | MEDIUM | FIXED (task 517). Fillet cannot be applied to any corner of a Polygon-tool polygon. | `packages/core/fillet.js:92` (3 lines on a corner: the construction radial counts) with `shapes.js:260` | ignore construction lines when counting |
| 6 | N-F6 | MEDIUM | Editing a dimension can move a tangent circle to the other side of its line or invert an under-constrained arc (5 of 300 cases). | `packages/core/constraint-manager.js:197-203` (tangent branch lock intentionally off) | lock the side / sweep sign |
| 7 | N-F3 | LOW | FIXED (task 517). Save and undo drop `dimSign` / `dimSignMode`; re-derived from the current geometry afterwards. | `packages/core/constraints.js:244-257` | carry the fields |
| 8 | N-U1 | LOW | Unexplained: deleting a vertical dimension raises the panel DOF 1, fd rank unchanged (4-gon, 4 ops, seed 7090). | repro `N-U1` in `prop-findings.js` | solver owner |
| 9 | N-U2 | LOW | Unexplained: edit x0.9 and back leaves a determined joint 8e-3 away (point-to-line dimension involved). Not hit by the random run since task 510 (F4 fix); the standalone repro still fails. | repro `N-U2` | solver owner |

Round-1 findings seen again by the random run: F6 (pointOnLine DOF lie), F3 (angle), F4, F5. F2 and F8 never triggered.

### Limits

Random sketches rarely become fully constrained (1 of 300), so I7's "determined joints" are usually few; the recipe drawings cover the fully constrained case. The PlaneGCS comparison is only as good as the translation: arc/arc tangent at a shared rim is degenerate in PlaneGCS as well (dof 2), so N1 is excluded from the PlaneGCS assertion.

## Extreme arcs (task 531)

A measuring audit of arcs at the edges: very short and almost full sweeps, tiny and huge radii, fillet arcs, under every constraint and dimension an arc takes. Nothing under `packages/` was changed; diagnosis only. Test: `tests/extreme-arcs.test.js` (in the gate, 15 s). Harness: `tests/harness/coverage/arcs-variants.js` (the variants as data, the builders, the arc measurements), `arcs-rows.js` (the rows and the cell runner), `arcs-ui.js` (pick facts), `arcs-findings.js` (EA-n, the classification rule, the repros). The only edit outside the new files: seven helpers of `tests/harness/coverage/matrix-run.js` got an `export` (svgStub, muted, driveConstraintTool, driveDimensionTool, spyOn, spyOff, selfSelection) so the tool drivers are reused, not copied.

### What was built

24 arc variants (data, `arcs-variants.js`). Sign convention: sweep > 0 is the positive-angle direction (stored `sweep` flag true, clockwise on screen), cw / ccw below mean that.
- **Made by the real arc tool** (its own pointer handlers: centre click, start click, pointer moves round the centre, end click): sweeps 0.1 / 1 / 5 / 30 (the control) / 179 / 180 / 181 / 355 / 359.9 degrees at R 20, both directions for 0.1, 1, 30, 181, 359.9; R 0.5 at 30, 0.1 (chord 0.0009, below VERIFIER_TOLERANCE) and 181 degrees; R 5000 with chord 20 (sweep 0.229, both directions) and R 5000 at 5 degrees.
- **Made by the real fillet** (findCornerBetweenLines + applyFillet): r 0.5 and r 10 (control) on a 90 degree corner, r 10 on a 179 degree corner (sweep 1) and on a 2 degree corner (sweep 178).
- 30 rows: tangent to a line / an arc / a circle (partner starts at the arc start), coincident of the start, the end, the centre (concentric), the arc's own two ends, point on arc (the snap path; point inside the sweep and point on the circle outside it), equal to an arc / a circle, midpoint of the chord, horizontal-or-vertical between start-end / centre-end / centre-start / on the chord line (the H/V tool decides the orientation), parallel / perpendicular / collinear of the chord line (a line through the two end joints) with a free line, radius dimension, aligned dimension start-end / centre-start / centre-end, H and V dimensions start-end and centre-end, lock (fix) of the start, end, centre.
- 4 hold states per row: sep, shared (the partner's point merged into the arc start), locked (every arc joint locked through the real Lock toggle), dimmed (the arc carries a driving radius dimension).
- Per accepted cell: residual, convergence, DOF delta against the nominal, the finite-difference count and PlaneGCS, analytic Jacobian against finite differences, the arc's radius / signed sweep / flag coherence / drawn path before and after, a 3% jitter re-solve (satisfied; a fully determined sketch returns to the same pose), a radius or dimension edit x1.5 and x0.67 (the row's own dimension, or the driving radius), a small end drag (2, 1.5 world units through the solver seam of the select tool, `prop-drag.js dragJoint`), delete + undo (document identical), save + load (flags, radius, sweep identical). Refusals: PlaneGCS is asked whether the refused constraint was feasible.
- Totals: 2880 cells = **PASS 1711, N/A (refused, document untouched) 176, NA-BUILD 788 (no such cell: no second shape to share with, a lock row under the locked state, ...), FAIL 205**. The 205 failing cells carry EA-1..EA-9 and the inherited round-1 F4 / F5 / F6 (below); none is unexplained. After task 533 (shared-joint rows accumulate): PASS 1721, N/A 176, NA-BUILD 788, FAIL 195 (EA-1=52 EA-2=98 EA-3=33 EA-4=19 EA-5=14 EA-6=17 EA-7=3 EA-8=10 EA-9=13 F5=1; F4 and F6 0).

### Tolerances in force (quoted from the code, printed by the test)

| tolerance | value | where |
|---|---|---|
| joint pick radius SNAP.JOINT_PX | 30 px | constants.js:25 |
| arc / line / circle pick radius SNAP.LINE_PX | 20 px | constants.js:27 |
| a joint this close always wins over a shape | 15 px | snap-detection.js:225-226 JOINT_PRIORITY_RADIUS |
| snap lock SNAP_MAGNETISM | 16 px | solver-config.js:33 |
| math pre-check "close enough" GEOMETRY_TOLERANCE | 0.05 world | solver-config.js:10 |
| point snapped to a shape becomes coincident with its end SNAP_WORLD_EPS | 0.1 world | solver-config.js:13 |
| "satisfied" VERIFIER_TOLERANCE | 0.001 world | solver-config.js:8 |
| AUTO_COINCIDENT_TOL | 0.01 world | solver-config.js:14 |

At the default zoom 1 world unit = 1 px. The 0.1 degree arc (chord 0.035) and the 359.9 degree arc (end 0.035 from the start) are under GEOMETRY_TOLERANCE and under one pixel; the R 0.5 x 0.1 degree arc (chord 0.00087) is under VERIFIER_TOLERANCE.

### Result: variant x constraint

Each cell is the union of the four hold states. `.` = every state passes (or is a checked refusal), `-` = no such cell, a number = the EA-n finding(s) seen in some state, F4 / F5 / F6 = inherited round-1 findings (the ordinary control arc shows them too).

| row \ variant | s30cw | s30ccw | s0.1cw | s0.1ccw | s1cw | s1ccw | s5cw | s179cw | s180cw | s181cw | s181ccw | s355cw | s359.9cw | s359.9ccw | r0.5s30cw | r0.5s0.1cw | r0.5s181cw | r5000c20cw | r5000c20ccw | r5000s5cw | f90r0.5 | f90r10 | f179r10 | f2r10 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| tangent-line | . | . | 2,3 | . | 2,3 | . | 2,3 | 2 | 2 | 2 | 2 | . | . | 2,3 | 5 | 2,3 | 2 | 2,3 | . | . | . | . | 5 | . |
| tangent-arc | . | . | 2,3 | . | 2,3 | . | 2,3,4 | 2 | 2 | 2 | 2 | . | . | 2,3 | . | 2,3 | 2 | . | . | . | . | . | 5 | . |
| tangent-circle | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | 1 |
| coincident-start | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . |
| coincident-end | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . |
| coincident-centre | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . |
| coincident-own-ends | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1,3 | 1,2,3 | 1,2,3 | 1,2,3 | 1,2,3 | 1,2,3 | 1 | 1,9 | 1,2,3 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| point-on-arc | . | . | . | . | . | . | . | 2 | 2 | 2 | 2 | . | . | . | . | . | 2 | . | . | . | . | . | . | 1 |
| point-on-arc-off | . | . | . | . | . | . | . | 2 | 2 | 2 | 2 | . | . | . | . | . | 2 | . | . | . | . | . | . | 1 |
| equal-arc | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | 2,3 | . | . | 2,3 | . | . | . | 5 | 1 |
| equal-circle | . | . | . | . | . | . | . | . | . | . | . | . | . | . | 5 | 5 | . | . | . | . | . | . | . | . |
| midpoint-chord | . | . | . | . | . | . | . | 2 | 2 | . | 2 | . | . | . | . | . | . | . | . | . | . | . | . | . |
| hv-start-end | . | . | 9 | 2,4,9 | . | 2,4 | . | . | 9 | 2 | . | 2,4 | 2,4,9 | 9 | . | . | . | . | . | . | 8 | 1 | 1 | . |
| hv-centre-end | . | . | . | 2,4 | . | . | . | 2 | 2,9 | 2 | 2 | . | 2,4 | . | . | 9 | 2 | . | . | . | . | . | 5 | . |
| hv-centre-start | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | 5 | . |
| parallel-chord | . | . | . | . | . | . | . | 2 | 2 | . | 2 | . | . | . | 6 | . | 6 | . | . | . | . | . | . | 1 |
| perpendicular-chord | . | . | 8 | 8 | 8 | 8 | . | . | 2 | 2 | . | . | 8 | 8 | 6,8 | . | 6 | . | 6 | . | 6 | . | 8 | . |
| collinear-chord | . | . | . | . | . | . | F5 | . | . | . | . | . | . | . | . | 5,7 | 6 | 6 | 6 | . | . | . | . | 5 |
| hv-chord-line | . | . | 9 | 2,4,9 | . | 2,4 | . | . | 9 | 2 | . | 2,4 | 2,4,9 | 9 | . | . | . | . | . | . | 8 | . | 1 | . |
| dim-radius | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . |
| dim-chord | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | 5 | . | . | . | . | . | . | . | . |
| dim-centre-start | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . |
| dim-centre-end | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . |
| dim-h-chord | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | 5 | . | . | . | . | . | . | . | . |
| dim-v-chord | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | 5 | . | . | . | . | . | . | . | . |
| dim-h-centre-end | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . |
| dim-v-centre-end | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . |
| lock-start | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | 5 | . |
| lock-end | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . |
| lock-centre | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . | . |

### Findings, most important first

Repro lines are `node tests/extreme-arcs.test.js --cell <variant> <row> <state>` (prints the whole cell record). Counts are failing cells of 2880.

**Is a zero-sweep collapse accepted anywhere? YES (EA-1).** Task 521's check (`measureShapeSizes`) measures an arc by its radius `|centre - start|` only, so an arc whose start and end become one point passes it. Accepted in 45 cells, on all 24 variants: the coincident tool on the arc's own start and end (every arc, state sep and dimmed; only refused when the joints are locked, ERR-CMATH-01), H/V between the two ends of a fillet arc, and a fillet radius edit (x1.5, x0.67) on a 2 degree corner with a point on the arc. This is true of the ordinary 30 degree control arc too.

1. **EA-1 HIGH, 51 cells: zero sweep accepted.** Diagnosis: `constraint-verifier.js:314-324` (arc size = centre-start distance), `:329-341` findCollapsedShape, used at `constraint-manager.js:356`, `:495`, `dimension-seams.js:74`; the coincident tool (`constraint-tools.js:120-132`) has no own-ends check. Proposed task: measure the chord / sweep of an arc in measureShapeSizes and refuse the own-ends coincident. Repro: `node tests/extreme-arcs.test.js --cell s30cw coincident-own-ends sep` -> chord 10.35 -> 0, signedDeg 30 -> 0, accepted.
2. **EA-2 HIGH, 99 cells: the stored `largeArc` flag is never recomputed.** An arc whose sweep crosses 180 degrees through any solve, edit or drag keeps its creation-time flag, so the renderer draws the other arc (and the exporters, which read the same flag, export it). Diagnosis: flags are set once at `arc-tool.js:232-233`; used by `geometry.js:234-236` (calculateArcPath), `shaper-export.js:49-53`, `loop-geometry.js:111-115`, `export-manager.js:148-166`, `svg-renderer.js:1141-1142`; nothing writes them back. Seen on arcs within a few degrees of 180 (after tangent, midpoint, H/V, perpendicular, a radius edit x1.5 / x0.67, an end drag) and on every arc that wraps (EA-3). Repro: `node tests/extreme-arcs.test.js --cell s179cw hv-centre-end sep` -> the 179 degree arc (largeArc false, sweep true) becomes 180.5 degrees, the flag stays false, path `A 19.9988 19.9988 0 0 1 ...`: the drawn arc is the 179.5 degree one, the implied centre is 0.17 from the stored centre (`.evidence/531/ea2.mjs`). Proposed task: derive largeArc from the live span in one place (calculateArcPath / arcSweepInfo) or write it back after every solve.
3. **EA-3 HIGH, 33 cells: a constraint on a very short or almost full arc makes the sweep jump to the complement.** The sweep is not a solver quantity: its direction is the stored `sweep` flag and its size `mod((end - start) * dir, 2 PI)` (`geometry.js:285-288`); the solver has no orientation term. A rim joint that moves a hair past the other turns 0.1 degree into 359.8 degrees. Repro: `node tests/extreme-arcs.test.js --cell s0.1cw tangent-line sep` -> signedDeg 0.1 -> 359.7925, R 20 -> 21.70 (also tangent-arc, equal-arc; 0.1 / 1 / 5 / 355 / 359.9 degrees, R 0.5 and R 5000). Proposed task: keep the arc's side as state (like the perpendicular branch lock) or refuse a wrapping solution.
4. **EA-4 MEDIUM, 19 cells: dragging the end of a short arc past its start gives a ~360 degree arc** (same cause). Repro: `--cell s0.1ccw hv-start-end sep` (the drag step). Whether Fusion does the same is open: replay list.
5. **EA-5 MEDIUM, 14 cells: the sweep shrinks to under a quarter without being asked** (the solver moves the least in coordinates; a short arc's sweep is the sensitive quantity). Repro: `--cell r0.5s30cw tangent-line sep` -> sweep 30 -> 0.84 degrees, R 0.5 -> 1.28 (the tangent resizes the arc, the task 525 family).
6. **EA-6 MEDIUM, 15 cells: parallel / perpendicular / collinear of the chord line of a tiny arc is accepted but not satisfied after a jitter re-solve (once not converged at all).** The rows are the un-normalised `u x v` / `u . v` (`solver/definitions.js:277-306`, `:309-345`); the cause is suspected (the row scales with the line lengths), not proven. Repro: `--cell r0.5s30cw perpendicular-chord sep` -> accepted, then no-converge + residual + bite. Proposed task: normalise the rows by |u||v|. **Measured in task 533** (section "Fixed in task 533"): for the perpendicular cells the cause is the DOUBLE root of the branch-locked row `u x v - |u||v|` (r ~ |u||v| d^2 / 2: the solve stops at r = 1e-6 with d = 1.162e-3 rad, predicted 1.163e-3); normalising would not fix it. 17 cells after task 533.
7. **EA-8 MEDIUM, 10 cells: a feasible constraint is refused (ERR-CSOLVE-01).** PlaneGCS satisfies the same row. `constraint-manager.js:456` (_sandboxVerify), reported at `:295`. Repro: `--cell s0.1cw perpendicular-chord locked` (also 1 and 359.9 degrees, R 0.5, fillet r 0.5 with H/V on its ends). Proposed task: a size-relative sandbox tolerance.
8. **EA-10 MEDIUM (UI): an arc is picked from anywhere on its circle.** `snap-detection.js:196-210` projects the mouse on the full circle, no `angleInArcSweep` test (geometry.js:296). A 0.1 degree arc is hit 180 degrees away from itself, and "point on arc" is a point on the whole circle (row point-on-arc-off accepts it). Repro: `node tests/extreme-arcs.test.js` prints `known EA-10 ... mouse on the circle OUTSIDE the 30 degree sweep picks: the arc`.
9. **EA-7 LOW, 3 cells:** Jacobian of collinear against finite differences, 5.7e-3 on a 0.00087 long chord line (`--cell r0.5s0.1cw collinear-chord sep`). Possibly the F6 family; not proven. Task 533: unchanged by the shared-joint fix (the cell repeats no joint), so not the F6 family.
10. **EA-9 LOW, 13 cells:** H/V between two LOCKED arc joints within 0.05 of aligned is accepted as already satisfied (`constraint-manager.js:693-696`, `:768`; GEOMETRY_TOLERANCE 0.05 is larger than the 0.1 degree arc); PlaneGCS counts a conflict, DOF -1 against our 0. Repro: `--cell s0.1cw hv-start-end locked`.

Inherited, already in docs/CONSTRAINT-AUDIT.md and shown by the control arc: F6 (15 cells, parallel / perpendicular Jacobian with a shared joint), F4 (4 cells, refused although feasible on a shared joint), F5 (1 cell). After task 533: F6 0, F4 0, F5 1.

### What is clean

- **Radius, aligned / H / V dimensions, coincident of start / end / centre, equal to a circle, lock and midpoint of the chord (except near 180) pass on every variant** (a few EA-5 shrinks on the R 0.5 arcs), including R 0.5, R 5000 and the 0.1 degree arcs, with the dimension edits x1.5 / x0.67, jitter, drag, delete + undo and save + load. Save and load keep the flags, radius and sweep of every variant (no `saveload-*` issue in any cell).
- The ordinary control arcs (30 degree both directions, 90 degree fillet) fail only EA-1 (own ends) and the inherited F4 / F6.
- R 5000 (nearly straight, chord 20 or 436) passes everything except the wrap under a shared tangent (EA-3) and the chord-line rows (EA-6).
- A fillet arc behaves like a tool arc except at the extremes of its corner (EA-1 on the 2 degree corner after a radius edit, EA-5 on the 179 degree corner).
- The renderer path is valid for every variant: no NaN or Infinity (24 of 24). The large-arc flag as BUILT by the arc tool is right at 179 / 180 / 181 / -181 degrees (the tool nudges an exact 180 by 1e-6; a 180 degree arc is ambiguous, the audit tolerates 1e-4 rad).
- Picking (findSnap, one function for hover, click and select; default zoom): on the sub-tolerance arcs (chord 0.035) of the 225 integer pixels around the END joint 105 pick the end and 120 pick the START (49 / 56 at chord 0.00087): both joints can be picked but a click is a coin flip; no variant leaves a joint unpickable.

### The 20 cells most worth replaying in Fusion

Fusion decides these; we only know what PlaneGCS and finite differences say. (variant row state) - question:
1. s30cw coincident-own-ends sep - does Fusion refuse the coincident of an arc's own ends?
2. f90r10 hv-start-end sep - H/V on the ends of a fillet arc.
3. f2r10 point-on-arc sep, then radius x1.5 - fillet radius too large for the corner.
4. s0.1cw tangent-line sep - does a 0.1 degree arc become 359.8 degrees?
5. s0.1cw tangent-line shared
6. s359.9ccw tangent-line sep
7. r0.5s0.1cw tangent-arc sep
8. r5000c20cw tangent-line shared
9. s0.1ccw hv-start-end sep - mouse drag of the end across the start: flip or wrap?
10. s1ccw hv-centre-end sep - mouse drag.
11. s179cw hv-centre-end sep - crossing 180 degrees (the flag).
12. s179cw midpoint-chord sep
13. s181cw tangent-arc dimmed, radius x1.5
14. s180cw tangent-line sep - exactly 180 degrees.
15. s30cw point-on-arc-off sep - is a point on the circle outside the arc accepted as "on the arc"?
16. s0.1cw perpendicular-chord locked - refused here, feasible.
17. r0.5s30cw perpendicular-chord sep - not satisfied here.
18. s0.1cw hv-start-end locked - tolerance (Fusion's own, much tighter).
19. s5cw tangent-arc shared - wrap at 5 degrees.
20. f179r10 hv-start-end sep, then drag the end - collapse by drag.

### Limits and what I did not check

- The drag is the solver seam of the select tool (`prop-drag.js dragJoint`, as task 514): the DOM-bound parts (the UI axis mask `getDragDOF`, the stroke hit target of the SVG path, and the select tool's cluster set that adds the other arc joints when a rim joint is picked, `selection-tools.js:354-360`) are not callable in node. The mouse path may therefore differ from the cell for a free arc.
- H/V rows are one row each: the tool decides the orientation from the geometry, so the other orientation of a given pair is not reached through the tool (the dimension rows cover H and V explicitly).
- The partner shapes (line, arc, circle, point) are placed near the arc by a fixed rule (15 / 25 degrees off tangent): another placement can change an individual cell.
- The Jacobian check uses a threshold scaled with the coordinate size (1e-4 x max(1, max|coordinate| / 100)) because finite differences lose digits at R 5000; below it nothing was flagged.
- PlaneGCS verdicts on refusals flip with run order in some cells (task 523 saw the same); the EA-8 cells were checked against the oracle in this run only.
- Fusion was not called (another seat holds it).

### After task 525 (who moves at creation)

Same test after task 525 (the who-moves placement; merged with task 533's per-joint Jacobian rows): 2880 cells = **PASS 1793, N/A 132, NA-BUILD 788, FAIL 167** (from PASS 1711 / N/A 176 / FAIL 205 at task 531; the task 531 numbers above stay as measured). Cells per finding now: EA-1 52, EA-2 70, EA-3 15, EA-4 18, EA-5 12, EA-6 21, EA-7 3, EA-8 8, EA-9 13, F5 1. Per-cell diff of main's placement code against the task 525 branch (`.evidence/525/arc-verdicts-diff2.txt` on that branch): 84 cells differ, 35 better, 41 shifted between findings / refusals, 8 worse.

Rule that keeps arcs safe: "who moves" is a question between two DIFFERENT shapes. When both operands of a new constraint belong to the SAME shape (an arc's centre and end, its own start and end, a line's two ends, a radius) nothing is placed and the constraint goes to the solve from the untouched pose, as before task 525. No same-shape cell differs from main (the one hv-start-end cell that differed in one run, `f90r0.5 hv-start-end sep`, is N/A on both side by side: a PlaneGCS refusal verdict that flips between runs, see Limits).

The 8 cells that passed on main and fail now. Each is a constraint main refused or left alone that is now placed and accepted, exposing an existing finding:

| cell (variant row state) | main | after task 525 |
|---|---|---|
| s181cw tangent-line dimmed | PASS | EA-2 |
| r0.5s181cw tangent-line dimmed | PASS | EA-2 |
| r0.5s30cw parallel-chord shared | N/A (refused) | EA-6 |
| r0.5s0.1cw parallel-chord sep | N/A (refused) | EA-6 |
| r0.5s0.1cw parallel-chord locked | N/A (refused) | EA-6 |
| r0.5s0.1cw parallel-chord dimmed | N/A (refused) | EA-6 |
| f179r10 parallel-chord sep | N/A (refused) | EA-6 |
| f179r10 tangent-line sep | PASS | EA-5 |

- f179r10 tangent-line sep: the table moved the LINE (the fillet arc is the anchor and stays at creation: sweep -1 degree, R 10 before and after the add); the EA-5 shrink is in the harness's later drag step (`drag-sweep-shrunk`: the edits and drag then move the arc to -0.034 degrees from the new tangent pose).
- The EA-3 and EA-5 repros of task 531 (`s0.1cw tangent-line sep`, `r0.5s30cw tangent-line sep`) PASS now: the placement moves the line and keeps the arc (sweep 0.1 and 30 degrees unchanged). The findings keep their other cells; their repros are now `--cell s180cw coincident-own-ends sep` (EA-3) and `--cell r0.5s0.1cw dim-chord sep` (EA-5).
- The control arc's `s30cw parallel-chord shared` is accepted now (main refused it): it passes (no Jacobian difference since task 533, jitter re-solve residual 5.5e-8).

### After task 550 (arcs keep their direction, Fusion; angle dimension direction)

Same test after task 550: 2880 cells = **PASS 1839, N/A 177, NA-BUILD 788, FAIL 76** (main before task 550: PASS 1793, N/A 132, NA-BUILD 788, FAIL 167). Cells per finding: EA-1 52 -> 2, EA-2 70 -> 0 (entry deleted), EA-3 15 -> 1, EA-4 18, EA-5 12 -> 10, EA-6 21, EA-7 3, EA-8 8, EA-9 13, F5 1; EA-10 (UI) fixed (entry deleted). Per-cell diff against main: 45 EA-1 cells (14 with EA-3, 12 with EA-2) became N/A (refused, document untouched), 5 EA-1 and 2 EA-5 fillet cells PASS (their fillet radius edits are refused instead of closing the arc), every EA-2 cell lost EA-2; no cell that passed on main fails now.

- **EA-2 fixed**: the large-arc choice is derived from the joints and the arc's direction by ONE function, `geometry.js arcSweepInfo` (`large = span > 180`), for the renderer, the SVG / DXF exports, the loop paths (profiles, Shaper) and the bounds. A stored `largeArc` (old files) is ignored and no longer written. The harness measures the large-arc flag the renderer's path DRAWS (`arcs-variants.js measureArc`), not a stored field.
- **EA-1 refused at creation and on every edit**: `findCollapsedShape` measures an arc's ends (an arc collapses when its chord AND chord / radius both fall under 1 %): the coincident of an arc's own ends is refused on every variant (Fusion: "failed to solve"). A fillet RADIUS edit goes through the same function for every shape except the fillet's own tangent legs, which `filletHasCollapsedLine` judges by an absolute zero length (a leg legitimately gets under 1 % of its length as R nears its singular value). Left (EA-1, 2 cells): a drag that closes an arc (f179r10).
- **EA-3**: the 14 own-ends cells are EA-1 refusals now; one cell remains (`r0.5s0.1cw tangent-arc shared`: 0.1 -> 359.7 degrees) where no solution keeps the arc's side. An orientation lock in the solve was built and measured (`.evidence/550/arc-side-lock-attempt.patch` on the task 550 branch): with a fallback it changes no cell (our least-change solve already keeps the side wherever a same-side solution exists, Fusion's fixed-ends radius sequence included); refusing the wrap instead turns 67 passing cells into jitter re-solve failures and 10 Fusion graded cells + 1 dimension-edit run into new divergences. Advisor ruling: left out (one cell is not worth 67 jitter failures and 11 new Fusion divergences).
- **EA-10 fixed**: `snap-detection.js` hits an arc only on its drawn sweep (the mouse on its circle outside the sweep snaps to the nearer end, or to nothing).
- The coverage matrix's oracle counts an arc whose two ends meet as "not a drawing" (like a collapsed line). New matrix entry NEW-10 (advisor ruling: the refusal is accepted, a zero-sweep arc must never be accepted): a coincident onto a fillet arc that shares its centre with the other operand (LF / CF / SF shared, 3 cells) is feasible (PlaneGCS keeps the fillet arc at 83 degrees) but our solve collapses it: refused (main accepted the collapse and the cell read PASS). Same in the Fusion graded grid: `tangent-circle-circle|FF|0,c` (main accepted fillet 1 collapsed 90 -> 0 degrees, which read like Fusion's "deform"; now refused). Solving to the non-collapsed pose is follow-up work, the same family as the feasible cells refused by task 521.

## Symmetric (task 563)
New row `symmetric (about the Y axis)` (tests/harness/coverage/matrix-run.js): the real Symmetric tool, entity 1, entity 2, then the Y axis as the
third pick. Two line-likes are picked as LINES (task 572: both ends of line 2 on the mirror of line 1's infinite line, 2 DOF; task 563 mirrored
the end pairs, 4), two circle-likes as CIRCLES (centres + radius, 3 DOF; two fillet
arcs already carry their driving R: 2), any other pair as two POINTS (2 DOF). PlaneGCS oracle: `p2p_symmetric_ppl` per pair + `equal_radius_cc`; a
pair that is ONE joint (two lines sharing an end, two circles sharing a centre) is given as point-on-line (PlaneGCS's symmetric of a point with
itself has an identically zero equation and reports it conflicting). The finite-difference Jacobian of the harness (audit/lib.js fdJacobian) now
resolves operands in the scene, as the app's engine does, so a constraint naming an axis has rows there too (no other cell changed).
```
  LL    LC    LS    LR    LO    LA    LF    LB    LP    CC    CS    CR    CO    CA    CF
  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP
  CB    CP    SS    SR    SO    SA    SF    SB    SP    RR    RO    RA    RF    RB    RP
  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP
  OO    OA    OF    OB    OP    AA    AF    AB    AP    FF    FB    FP    BB    BP    PP
  PPPP  PPPP  PPPP  PPPP  PnPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PPPP  PnPP
  N/A=2  PASS=178   (the 2 N/A: the shared variant picks the same joint twice, refused by the tool)
```

Task 572 (line form = infinite lines): the row's line cells now remove 2 (implied 1 where line 2 is a rect top held horizontal, or the lines share a
corner). Two cells needed a harness rule, both judged by our finite-difference nullity because PlaneGCS's translation (a free helper point per end:
`p2p_symmetric_ppl` + `point_on_line_ppp`) miscounts at these degenerate poses: SR/shared removes 1 (ours = fd, PlaneGCS 2; hand derivation in
.evidence/572/sr-shared-derivation.txt: line 2's horizontal line mirrors onto itself, so only line 1's direction is fixed), and RR/shared is
refused as redundant (two rect tops sharing a corner are one horizontal line; the raw add leaves the fd nullity unchanged; PlaneGCS says 6 -> 4).
Row after task 572: `PASS=178 N/A=2`; whole matrix `3564 cells: N/A=1418 NA-BUILD=163 NEW-10=3 NEW-6=2 PASS=1978` (unchanged counts).
