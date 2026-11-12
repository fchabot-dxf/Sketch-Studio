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
  nnnn  nnnn  nnnn  nnnn  PPPP  PPPP  PPPP  nnnn  nnnn  nnnn  PPPP  PFPP  PPPP  nnnn  nnnn 
  OO    OA    OF    OB    OP    AA    AF    AB    AP    FF    FB    FP    BB    BP    PP   
  PPPP  PFPF  PPPP  nnnn  nnnn  PFPF  PPPF  nnnn  nnnn  PPPP  nnnn  nnnn  nnnn  nnnn  nnnn 
  N/A=108  NEW-6=6  PASS=66
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

### 6. NEW-6 (LOW): a feasible tangent between a circle and an arc (or two arcs) is refused when the arc radius has to change a lot; PlaneGCS solves it

* Verdict: BUG. Cells: 6 (e.g. tangent RA/shared, tangent OA/shared, tangent OA/dimmed, tangent AA/shared).
* Repro (verbatim, `node scripts/coverage-audit.cjs`): `tangent circle/arc, centres dimensioned 151 apart: accepted=false errors=ERR-CSOLVE-01 oracleFeasible=true`
* Diagnosis: the radius of an arc is a joint distance the solver must move; from the current pose even 500 iterations leave the residual at 53 (circle 15 / arc 20 with the centres dimensioned 151 apart: tangent needs R 136). Same family as F5 (feasibility judged from the pose) but not a sandbox-burst issue: a forced add does not converge either.
* Proposed task: seed the arc radius from the tangency (like seedFilletForRadius does for fillets) or verify with a continuation; test: the tangent in this repro is accepted.

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

## Fixed in task 520 (NEW-1, NEW-2, NEW-3, NEW-5)

Cell counts after the fixes (`node tests/coverage-matrix.test.js`): 3384 cells: **1783 PASS**, 1416 N/A, 163 not buildable, 16 FAIL caused by a round-1 finding (F2=4, F4=11, F6=1), 6 FAIL NEW (NEW-6=5, NEW-8=1), 0 unexplained. The repros of NEW-1, NEW-2, NEW-3, NEW-5 became passing assertions in `tests/dimension-point-line.test.js` (node) and `tests/dimension-point-line-live.test.js` (real pointer, SketchStudio); their `KNOWN` entries, repro pins and classify rules are deleted.

* NEW-1: `handleDimensionPointerDown` is now a wrapper that closes any undo group the click opened on every exit (return or throw, nothing caught); the scope bug is gone with the rewrite below.
* NEW-2: a point-to-line dimension is now ONE `distance` constraint stored with three joints `[point, line end A, line end B]` (the arity is the declaration, like a joint-form collinear / equal). The solver reuses the existing line-line row (`distance.__lineLine`: |perpendicular distance from P to line AB| - value), no helper joint and no pointOnLine, so it removes exactly 1 DOF and holds when the line swings. The verifier, the renderer, the live value check, `toggleDriving` and the conflict pre-checks understand the form (`isPointLineDistance` in geometry.js).
* NEW-5: the line-line value is `Math.abs(perpendicularDistance(...))`; the side is not stored (the solver row is |signed|, as before).
* NEW-3: `ConstraintManager.placeForCreation` rotates the second-picked line 90 degrees counter-clockwise (pivot: a fixed or shared joint of that line, else its midpoint) when the start is EXACTLY parallel; `_sandboxVerify` starts from the same placed pose, so the check judges the real add. No branch is locked afterwards: the branched residual is stationary at 90 degrees (its Jacobian row is zero there and would hide the removed DOF).

## Observations that are not failures

* **O3 silent redundancy**: a parallel between two rect tops (both already horizontal), an equal between two fillet arcs (both already R-dimensioned) are accepted with no
  warning and no effect (delta 0). The app flags redundant dimensions (reference) but not redundant geometric constraints (same as O1 of round 1).
* The H / V dimension rows pass in the sep, shared and locked variants (F1 only appears when an aligned dimension is already on the pair).
* `toggleDriving` (`dimension-seams.js:109-122`) demotes the other driver on a pair by joint pair only (no `dimMode`), the same family as F1; no matrix cell exercises it (the driving / reference toggle is a deferred edit feature).
* PlaneGCS needed two extra mappings (collinear = both end points on the other line; tangent_cc) and a "collapsed line is not a solution" rule to give honest feasibility
  verdicts; without them it reported collapsing a rect top onto a slanted locked line as feasible.
* One matrix cell is not deterministic across a cold start (a tangent pair of the NEW-6 family flips between PASS and NEW-6); the test only requires at least one NEW-6 cell.

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
| 3 | N-F7 | HIGH | Tangent between two arcs sharing a rim joint (S-curve) is degenerate: nullity 1 vs finite-difference 2, radius dim demoted, 0/3 jittered restarts return, analytic Jacobian differs from fd. | `packages/core/solver/definitions.js:355-373` (\|C1C2\| = r1+r2 at its extremum; radii constants in the Jacobian) | shared-rim form cross(C1-Q, C2-Q) = 0, like the line case's `sharedEnd` |
| 4 | N-F5 | MEDIUM | Collinear on two lines that meet at a corner: panel DOF one too low (panel 4, fd 5); deleting it raises panel DOF by 2, true contribution 1. 26 of 300 random cases. | `packages/core/solver/definitions.js:233-247` (one-sided Jacobian), same family as F6 | symmetric Jacobian or drop the degenerate row |
| 5 | N-F2 | MEDIUM | FIXED (task 517). Fillet cannot be applied to any corner of a Polygon-tool polygon. | `packages/core/fillet.js:92` (3 lines on a corner: the construction radial counts) with `shapes.js:260` | ignore construction lines when counting |
| 6 | N-F6 | MEDIUM | Editing a dimension can move a tangent circle to the other side of its line or invert an under-constrained arc (5 of 300 cases). | `packages/core/constraint-manager.js:197-203` (tangent branch lock intentionally off) | lock the side / sweep sign |
| 7 | N-F3 | LOW | FIXED (task 517). Save and undo drop `dimSign` / `dimSignMode`; re-derived from the current geometry afterwards. | `packages/core/constraints.js:244-257` | carry the fields |
| 8 | N-U1 | LOW | Unexplained: deleting a vertical dimension raises the panel DOF 1, fd rank unchanged (4-gon, 4 ops, seed 7090). | repro `N-U1` in `prop-findings.js` | solver owner |
| 9 | N-U2 | LOW | Unexplained: edit x0.9 and back leaves a determined joint 8e-3 away (point-to-line dimension involved). Not hit by the random run since task 510 (F4 fix); the standalone repro still fails. | repro `N-U2` | solver owner |

Round-1 findings seen again by the random run: F6 (pointOnLine DOF lie), F3 (angle), F4, F5. F2 and F8 never triggered.

### Limits

Random sketches rarely become fully constrained (1 of 300), so I7's "determined joints" are usually few; the recipe drawings cover the fully constrained case. The PlaneGCS comparison is only as good as the translation: arc/arc tangent at a shared rim is degenerate in PlaneGCS as well (dof 2), so N1 is excluded from the PlaneGCS assertion.
