# Coverage audit (TASK 512)

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
  P4PP  P4PP  P4PP  P4PP  nnnn  nnnn  nnnn  nnnn  nnnn  P4PP  P4PP  P4PP  nnnn  nnnn  nnnn 
  CB    CP    SS    SR    SO    SA    SF    SB    SP    RR    RO    RA    RF    RB    RP   
  nnnn  nnnn  P4PP  P4HP  nnnn  nnnn  nnnn  nnnn  nnnn  P4PP  nnnn  nnnn  nnnn  nnnn  nnnn 
  OO    OA    OF    OB    OP    AA    AF    AB    AP    FF    FB    FP    BB    BP    PP   
  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn 
  F4=10  N/A=140  NEW-8=1  PASS=29
=== perpendicular  [perpendicular]  expected DOF removed (sep): 1
  LL    LC    LS    LR    LO    LA    LF    LB    LP    CC    CS    CR    CO    CA    CF   
  C4PC  C4PC  P4PP  P4PP  nnnn  nnnn  nnnn  nnnn  nnnn  C4PC  P4PP  P4PP  nnnn  nnnn  nnnn 
  CB    CP    SS    SR    SO    SA    SF    SB    SP    RR    RO    RA    RF    RB    RP   
  nnnn  nnnn  C4PC  P4PP  nnnn  nnnn  nnnn  nnnn  nnnn  PPPP  nnnn  nnnn  nnnn  nnnn  nnnn 
  OO    OA    OF    OB    OP    AA    AF    AB    AP    FF    FB    FP    BB    BP    PP   
  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn 
  F4=9  N/A=140  NEW-3=8  PASS=23
=== collinear  [collinear]  expected DOF removed (sep): 2
  LL    LC    LS    LR    LO    LA    LF    LB    LP    CC    CS    CR    CO    CA    CF   
  PPPP  PPPP  PPPP  PPPP  nnnn  nnnn  nnnn  nnnn  nnnn  PPPP  PPPP  PPPP  nnnn  nnnn  nnnn 
  CB    CP    SS    SR    SO    SA    SF    SB    SP    RR    RO    RA    RF    RB    RP   
  nnnn  nnnn  PPPG  PPPP  nnnn  nnnn  nnnn  nnnn  nnnn  P6PP  nnnn  nnnn  nnnn  nnnn  nnnn 
  OO    OA    OF    OB    OP    AA    AF    AB    AP    FF    FB    FP    BB    BP    PP   
  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn 
  F6=1  N/A=140  NEW-7=1  PASS=38
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
  PPP1  PPP1  PPP1  PPP1  PPP1  PPP1  PPP1  PPP1  PPP1  PPP1  PPP1  PPP1  PPP1  PPP1  PPP1 
  CB    CP    SS    SR    SO    SA    SF    SB    SP    RR    RO    RA    RF    RB    RP   
  PPP1  PPP1  PPP1  PPP1  PPP1  PPP1  PPP1  PPP1  PPP1  P-P1  P-P1  PPP1  P-P1  PPP1  P-P1 
  OO    OA    OF    OB    OP    AA    AF    AB    AP    FF    FB    FP    BB    BP    PP   
  PnP1  PPP1  PPP1  PPP1  PnP1  PPP1  PPP1  PPP1  P-P1  PPP1  PPP1  P-P1  PPP1  PPP1  PnP1 
  F1=45  N/A=3  NA-BUILD=6  PASS=126
=== dim point-point V  [dim-vertical]  expected DOF removed (sep): 1
  LL    LC    LS    LR    LO    LA    LF    LB    LP    CC    CS    CR    CO    CA    CF   
  PPP1  PPP1  PPP1  PPP1  PPP1  PPP1  PPP1  PPP1  PPP1  PPP1  PPP1  PPP1  PPP1  PPP1  PPP1 
  CB    CP    SS    SR    SO    SA    SF    SB    SP    RR    RO    RA    RF    RB    RP   
  PPP1  PPP1  PPP1  PPP1  PPP1  PPP1  PPP1  PPP1  PPP1  P-P1  P-P1  PPP1  P-P1  PPP1  P-P1 
  OO    OA    OF    OB    OP    AA    AF    AB    AP    FF    FB    FP    BB    BP    PP   
  PnP1  PPP1  PPP1  PPP1  PnP1  PPP1  PPP1  PPP1  P-P1  PPP1  PPP1  P-P1  PPP1  PPP1  PnP1 
  F1=45  N/A=3  NA-BUILD=6  PASS=126
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
  P4PP  P4PP  PDPP  3D33  nnnn  nnnn  nnnn  nnnn  nnnn  P4PP  PDPP  3D33  nnnn  nnnn  nnnn 
  CB    CP    SS    SR    SO    SA    SF    SB    SP    RR    RO    RA    RF    RB    RP   
  nnnn  nnnn  -D--  3DDD  nnnn  nnnn  nnnn  nnnn  nnnn  ----  nnnn  nnnn  nnnn  nnnn  nnnn 
  OO    OA    OF    OB    OP    AA    AF    AB    AP    FF    FB    FP    BB    BP    PP   
  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn 
  F3=7  F4=3  N/A=140  NA-BUILD=7  NEW-4=8  PASS=15
=== dim angle (Y then X)  [dim-angle-yx]  expected DOF removed (sep): 1
  LL    LC    LS    LR    LO    LA    LF    LB    LP    CC    CS    CR    CO    CA    CF   
  3D33  3D33  3433  P4PP  nnnn  nnnn  nnnn  nnnn  nnnn  3D33  3433  P4PP  nnnn  nnnn  nnnn 
  CB    CP    SS    SR    SO    SA    SF    SB    SP    RR    RO    RA    RF    RB    RP   
  nnnn  nnnn  -4--  P4PP  nnnn  nnnn  nnnn  nnnn  nnnn  ----  nnnn  nnnn  nnnn  nnnn  nnnn 
  OO    OA    OF    OB    OP    AA    AF    AB    AP    FF    FB    FP    BB    BP    PP   
  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn  nnnn 
  F3=15  F4=6  N/A=140  NA-BUILD=7  NEW-4=3  PASS=9
=== dim radius  [dim-radius]  expected DOF removed (sep): 1/0
  L     C     S     R     O     A     F     B     P    
  n-nn  n-nn  n-nn  n-n-  P-Pn  P-Pn  n-n-  n-n-  n-n- 
  N/A=19  NA-BUILD=13  PASS=4
```

### Result

3384 cells: **1516 PASS, 1416 N/A by UI (the real tool refused the selection, document untouched), 163 not buildable, 145 FAIL caused by a round-1 finding, 144 FAIL NEW**
(0 unexplained). Round-1 attribution (cells): F1 90 (an H or V dimension beside an aligned one on the same pair is demoted), F2 4 (equal circle/arc refused),
F3 22 (clockwise angle pick order moves the drawing), F4 28 (parallel / perpendicular / angle between lines sharing a joint), F6 1 (collinear DOF != finite difference),
F5 0 (F5's order-dependent refusal did not show; NEW-6 is the same family), F7/F8 not reachable from a single-constraint cell.

Everything not listed passed: a refused selection is refused cleanly, accepted constraints converge, the Design panel delta equals the finite-difference and the PlaneGCS delta
(except F6/NEW-7), the 3% jittered re-solve keeps every constraint, delete brings the nullity back and undo restores the document, in all four variants. In particular coincident,
horizontal / vertical, midpoint (both forms), tangent line/circle, parallel, collinear, point-point dimensions and radius dimensions of circles and arcs all behave on every
buildable pair; the fillet arc, polygon side, rect side and bezier endpoints behave like their plain counterparts.

## New findings (ranked)

Each is pinned as a `KNOWN` entry in `tests/coverage-matrix.test.js`; the repro is in `tests/harness/coverage/matrix-findings.js` (`node scripts/coverage-audit.cjs` prints it).

### 1. NEW-1 (HIGH): the point-to-line dimension throws ReferenceError on every use (and leaves its undo group open)

* Verdict: BUG. Cells: 112 (e.g. dim-point-line LL/sep, dim-point-line LL/shared, dim-point-line LL/locked, dim-point-line LL/dimmed).
* Repro (verbatim, `node scripts/coverage-audit.cjs`): `second click (joint, then line): ReferenceError: c is not defined; constraints created: pointOnLine, distance=40.000; undo group left open: true`
* Diagnosis: packages/ui/input-handlers/dimension-tool.js:619 calls finalizeDimBirth(c, state) AFTER the block that declares `const c` (line 610): `c` is out of scope. The constraints are already created when it throws, but endDimUndo never runs.
* Proposed task: declare c before the if (a && b && firstJ) block, or move finalizeDimBirth inside it; add a node test that drives joint-then-line and asserts no throw and one undo step.

### 2. NEW-5 (HIGH): a line-to-line dimension made with the Dimension tool is born as a REFERENCE (ERR-CSOLVE-02) with a NEGATIVE value, in one of the two click orders

* Verdict: BUG. Cells: 5 (e.g. dim-line-line LL/sep, dim-line-line LC/sep, dim-line-line CC/sep, dim-line-line RR/sep).
* Repro (verbatim, `node scripts/coverage-audit.cjs`): `click line 1 then line 2: value -75.89 driven=true (sandbox-conflict [ERR-CSOLVE-02]); click line 2 then line 1: value 75.89 driven=false`
* Diagnosis: dimension-tool.js:437 passes value: perpendicularDistance(j1a, j2a, j2b), which is SIGNED (geometry.js:122-130 uses a normal vector); definitions.js:32 compares Math.abs(signed) - value, so a negative value is a conflict and the sandbox demotes it. Which order breaks depends on which side line 2 is on.
* Proposed task: pass Math.abs(...) (the solver already uses |signed|); test: both click orders on any two parallel lines give a driving, positive dimension.

### 3. NEW-3 (HIGH): perpendicular is refused (ERR-CSOLVE-01) between two EXACTLY parallel lines (angle 0 or 180), e.g. two lines that are both horizontal

* Verdict: BUG. Cells: 8 (e.g. perpendicular LL/sep, perpendicular LL/dimmed, perpendicular LC/sep, perpendicular LC/dimmed).
* Repro (verbatim, `node scripts/coverage-audit.cjs`): `first line horizontal; second line direction (60,0) parallel: accepted=false; (60,0.01) 0.01 deg: accepted=true; (60,30) 27 deg: accepted=true`
* Diagnosis: constraint-manager.js:1019-1020 lockPerpendicularBranch skips the branch lock when |sin theta| < 0.1, so definitions.js:288 falls back to r = u.v. From an EXACTLY parallel start cross(u,v) = 0 is a stationary point of that residual: 500 iterations stay at the start (residual pi/2; the forced add does not converge either). A 0.01 degree tilt already solves, so the failure is only the exact-parallel case, which is the common one (lines with H or V constraints, snapped lines). PlaneGCS solves the same constraint.
* Proposed task: give the branchless perpendicular a starting rotation (pick the branch from the sign of cross, or +1 when it is 0) instead of skipping; test: perpendicular on two parallel horizontal lines is accepted and solves.

### 4. NEW-2 (HIGH): the point-to-line dimension does not hold a perpendicular distance: the helper joint slides along the line

* Verdict: BUG. Cells: 22 (e.g. dim-point-line LL/sep, dim-point-line LC/sep, dim-point-line LS/sep, dim-point-line LO/sep).
* Repro (verbatim, `node scripts/coverage-audit.cjs`): `perpendicular distance 40.000 when dimensioned; after swinging the line end it is 22.283 with max residual 1.5e-8 (the dimension reads satisfied)`
* Diagnosis: dimension-tool.js:597-612 makes a helper joint on the line (pointOnLine) and dimensions |P - helper|; nothing makes P-helper perpendicular to the line, so the helper slides and the real perpendicular distance changes while every residual is 0. It also leaves the helper as 1 free DOF in the Design panel.
* Proposed task: add a perpendicular (or a point-line distance row in definitions.js, as line-line has) so the dimension is the true point-to-line distance; test: lock P and one line end, swing the other end, the distance must hold.

### 5. NEW-4 (MEDIUM): a REFERENCE angle dimension comes back as a DRIVING one after undo (its driven flag is lost; redo restores through the same function, not separately verified)

* Verdict: BUG. Cells: 11 (e.g. dim-angle-xy LS/shared, dim-angle-xy LR/shared, dim-angle-xy CS/shared, dim-angle-xy CR/shared).
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

### 8. NEW-7 (LOW): collinear removes 1 DOF in the Design panel (and in the finite-difference count) where PlaneGCS removes 2, for two polygon sides with an aligned dimension between their start joints

* Verdict: BUG. Cells: 1 (e.g. collinear SS/dimmed).
* Repro (verbatim, `node scripts/coverage-audit.cjs`): `collinear polygon sides, pre-dimensioned: panel delta -1, finite-difference delta -1, PlaneGCS delta -2, expected -2`
* Diagnosis: UNVERIFIED root: collinear is one-sided (constraint-manager.js anchors the first line; the solver only moves the second line points), so the DOF the panel reads may not be the DOF of the geometric constraint. Same family as F6.
* Proposed task: check the one-sided collinear rows in jointFreedom the way F6 proposes for pointOnLine, then re-run this cell.

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
