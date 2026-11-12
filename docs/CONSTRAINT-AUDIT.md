# Constraint audit (TASK 508)

Five medium drawings (plate, trapezoid, bracket, triangle + circle, polygon + spokes) were built from scratch through the same core APIs the
tools use, constrained one constraint at a time from a data recipe, then verified, edited, abused and checked against two independent oracles.
This is an AUDIT: no application code was changed. Every finding has a repro, a one-line diagnosis and a proposed task.

* Re-run the tables any time: `node scripts/constraint-audit.cjs` (one drawing: `node scripts/constraint-audit.cjs bracket`). The full run of
  this report is kept as `.evidence/508/audit-run.txt` (local, not committed). PlaneGCS prints `Sketcher::Redundant...` lines to stdout when it
  finds a redundant constraint: that is the oracle talking, not an error.
* The assertions: `node tests/constraint-audit.test.js` (in the gate, 1.3 s). Everything that should hold today is asserted; each bug is a named
  entry in the `KNOWN` object at the top of the file whose check runs, is expected to FAIL, and fails the test loudly if it ever passes (delete
  the entry when the bug is fixed). There was no precedent in `scripts/gate.cjs` (`KNOWN_FAILURES` is a list of whole files); this is the local
  `check(name, ok)` + `KNOWN` helper the task allowed.
* Files: `tests/harness/audit/lib.js` (the pipeline), `d1-plate.js` ... `d5-polygon.js` (one file per drawing, recipe as data at the top),
  `findings.js` (one minimal repro per finding), `fixture-compare.js` (the owner's trapezoid).
* No browser: everything is pure node. The real UI path is reached through the same seams the UI uses (`ConstraintManager.createConstraint`,
  `commitDimensionEdit` from `packages/ui/dimension-seams.js`, `deleteConstraints`, `state.saveState/undo`, `applyFillet`, `makePolygon`).

## Method

| step | what is measured | how |
|---|---|---|
| A | geometry only | nullity with every constraint stripped must be 2 x movable joints; also the nullity with the builders' own constraints (rect welds, arc equal radius, polygon equals, fillet tangents) |
| B | the recipe | each step through `ConstraintManager.createConstraint` (dimensions are PLACED at the measured value and the typed value goes through `commitDimensionEdit`, as the Dimension tool does): accepted?, ERR-* codes, converged?, max residual, nullity so far, demoted to a reference? |
| C | final state | `engine.jointFreedom()` nullity (= the Design panel DOF), free joints, plus a finite-difference nullity (below) |
| D | verify | `measureResidual` of every driving constraint < 1e-6; 5 fixed-seed jittered starts (every free joint moved by up to 5% of the drawing size, seeds 11 23 37 51 73) must converge back to the same geometry within 1e-4 |
| E | edit every dimension | 0.8x and 1.25x through `commitDimensionEdit`, then: not refused, converged, residual < 1e-6, no NaN, nullity 0, orientation signature unchanged (cross product of consecutive edges, each arc's sweep sign, the side of each tangent line the circle centre is on), and the original value restores the geometry within 1e-4 |
| F | abuse | a redundant dimension, a conflicting dimension (1.5x), delete one dimension (nullity must rise by exactly 1), undo it (`state.saveState/undo`) |
| G | oracle | the final state is translated into PlaneGCS primitives (points, lines, circles, tangent_lc / endpoint perpendicularity, point_on_line, midpoint, equal_length, angle ...): its `dof()`, conflicting/redundant lists, and a solve from the same jittered starts |
| + | finite-difference Jacobian | the same residual rows differentiated numerically in a second solver object (`fdJacobian` in lib.js): per-type error of the analytic Jacobian, and a nullity computed from the numeric rows. This is independent of `jointFreedom()` and of PlaneGCS |

## Summary (verbatim, `node scripts/constraint-audit.cjs`)

```
drawing    joints  constr  nullity  panelDOF  planegcs  verifier  jittered  edits ok  refused  demoted
plate      21      42      0        0         0         OK        5/5       10/12     0        0
trapezoid  19      33      0        0         0         OK        5/5       14/14     0        0
bracket    24      43      0        0         0         OK        5/5       30/30     0        3
triangle   9       13      0        0         0         OK        5/5       3/4       0        0
polygon    12      21      0        0         0         OK        5/5       6/6       0        0
```

AFTER TASK 515 (a circle's radius is a solver unknown, like Fusion; F2 and O2 fixed; `node scripts/constraint-audit.cjs`, verbatim):

```
drawing    joints  constr  nullity  panelDOF  planegcs  verifier  jittered  edits ok  refused  demoted
plate      21      42      0        0         0         OK        5/5       12/12     0        0
trapezoid  19      33      0        0         0         OK        5/5       14/14     0        0
bracket    24      40      0        0         0         OK        5/5       30/30     0        0
triangle   9       13      0        0         0         OK        5/5       3/4       0        0
polygon    12      21      0        0         0         OK        5/5       6/6       0        0
```

(the bracket's 40 constraints and 0 demoted are task 510's F1 fix; the plate's edits are 12/12 since task 515.) The tables of the five drawings
below are the original task 508 run: since task 515 every circle adds one DOF until its radius is dimensioned or tied (plate steps 17-20 now read
nullity 3, 2, 1, 0; the PlaneGCS translation leaves a circle's radius free instead of fixing it at the stored value).

All five drawings reach nullity 0, the Design panel agrees with the nullity, PlaneGCS agrees (dof 0, no conflict, same geometry), the verifier is
clean and every jittered start returns to the same geometry (no fillet-flip family showed up with the line-tool joint structure).
"edits ok" is not 100% for two reasons that are explained below: plate 2/12 refused (finding F2) and triangle 1/4 refused (EXPECTED, impossible
value). "demoted" is 3 in the bracket (finding F1). Observations that are not bugs are listed after the findings.

## Per drawing

Tables are the recipe output of the script, verbatim. Step labels marked "(workaround)" were added while iterating towards nullity 0 because the
step before them was demoted by a bug.

### 1. PLATE: 200 x 120 rectangle, 4 fillets (equal R 15), 4 holes (R 8), symmetric about the origin

Recipe (data at the top of `tests/harness/audit/d1-plate.js`): midpoint(vTL,vBR) = origin; width 200 and height 120 on the fillets' virtual
sharps; delete the radius dimensions of 3 fillets and make them equal to the first; the 4 hole centres a rectangle (H/V), midpoint(c1,c3) =
origin, spacing 140 x 70; radius 8 and equal radii on the holes. Final nullity 0; PlaneGCS dof 0.

```
  #  step                                          accepted  conv  resid    nullity notes
  1  centre: midpoint(vTL,vBR) = origin            yes       yes   0        10
  2  width  vTL-vTR (horizontal) 200               yes       yes   0        9
  3  height vTR-vBR (vertical) 120                 yes       yes   0        8
  4  delete R dim of fillet TR (keep TL)           yes       yes   0        9
  5  delete R dim of fillet BR                     yes       yes   0        10
  6  delete R dim of fillet BL                     yes       yes   0        11
  7  equal radius aTR = aTL                        yes       yes   0        10
  8  equal radius aBR = aTL                        yes       yes   0        9
  9  equal radius aBL = aTL                        yes       yes   0        8
  10 hole centres c1-c2 horizontal                 yes       yes   0        7
  11 hole centres c2-c3 vertical                   yes       yes   0        6
  12 hole centres c3-c4 horizontal                 yes       yes   0        5
  13 hole centres c4-c1 vertical                   yes       yes   0        4
  14 holes symmetric: midpoint(c1,c3) = origin     yes       yes   0        2
  15 hole spacing c1-c2 (horizontal) 140           yes       yes   0        1
  16 hole spacing c2-c3 (vertical) 70              yes       yes   0        0
  17 hole radius h1 = 8                            yes       yes   0        0
  18 equal radius h2 = h1                          yes       yes   0        0
  19 equal radius h3 = h1                          yes       yes   0        0
  20 equal radius h4 = h1                          yes       yes   0        0
```

* Steps 17-20 change nothing (nullity 0 before and after). 17 is the inert circle radius dimension, 18-20 are finding **F2** (equal on circles is
  a no-op). FIXED task 515: the four holes' radii are solver unknowns, steps 17-20 take the nullity 4 -> 3 -> 2 -> 1 -> 0.
* E: the 10 edits of the width / height / spacing / fillet R all pass; the two hole-radius edits are **REFUSED (equal)**: finding F2. Since task 515:
  12/12 (`distance(R)=12.000 x0.8 ok`, `distance(R)=18.750 x1.25 ok`, both holes' radii follow).
* X (does a declared constraint bite): `equal-radius on two circles drags the radius: FAIL: h2.radius set to 12, after solve = 12 (h1 = 8); max
  residual 4.00e+0 (equal)`.
* F: redundant diagonal -> driven (reference); conflicting 1.5x -> driven, stored value 349.86 -> 233.24 (the geometry value replaces the typed
  one), geometry moved 0.0; delete width: nullity 0 -> 1; undo: 0, 42/42 constraints, geometry moved 0.0.

### 2. TRAPEZOID: the owner's shape rebuilt (top 400, bottom 150, height 431.8, centre line, 4 x R20)

Recipe: H on top and bottom, centre line vertical, midpoint of top edge = P, midpoint of bottom edge = Q, Q at the origin, height (line-to-line)
431.8, bottom width 150, top width 400; each fillet arrives with its own driving R20 (as in the owner's file). Final nullity 0.

```
  #  step                                          accepted  conv  resid    nullity notes
  1  top line horizontal                           yes       yes   0        11
  2  bottom line horizontal                        yes       yes   0        10
  3  centre line vertical                          yes       yes   0        9
  4  midpoint of top edge = P                      yes       yes   0        7
  5  midpoint of bottom edge = Q                   yes       yes   0        5
  6  Q at the origin                               yes       yes   0        3
  7  height (line-to-line) 431.8                   yes       yes   0        2
  8  bottom width vBL-vBR 150                      yes       yes   0        1
  9  top width vTL-vTR 400                         yes       yes   0        0
```

Comparison with `tests/fixtures/owner-trapezoid.document.json` (verbatim):

```
FIXTURE (owner-trapezoid.document.json): 34 constraints / 19 joints, nullity 1 as saved (top width saved as a reference), 0 with the top width driving; mine: 33 / 19, nullity 0
  fixture constraints: {"horizontal":2,"distance":3,"midpoint":2,"vertical":1,"coincident":1,"pointOnLine":9,"equal":4,"tangent":8,"distance(R)":4}
  mine:                {"equal":4,"pointOnLine":8,"tangent":8,"distance(R)":4,"horizontal":2,"vertical":1,"midpoint":2,"coincident":1,"distance":3}
```

Same joints, same constraint kinds; the only difference is the owner's one extra `pointOnLine` (the top-edge point P on the top line, redundant
with the midpoint). The owner's file is saved with the 400 width as a reference (nullity 1, the old driven bug); with it driving it is 0, like
mine. All 14 edits (4 radii, height, 2 widths) pass with no orientation change; the reversibility is 6e-14.
PlaneGCS landed on ANOTHER branch from the jittered start seed 23 (dev 40.6, a fillet flip); ours returned to the reference every time.

### 3. BRACKET: 8-line L outline (two chamfered arm ends), a slot, a hole

Recipe: the outline is drawn like the line tool (8 segments, corners joined by coincident constraints), H/V on six lines, A at the origin, 8
dimensions; the slot is two semicircle arcs (rim joints symmetric about the centre by `midpoint`) + two lines tangent to both arcs, equal radius,
R8, horizontal axis, length 50, position 60 / 20; the hole is a circle at 20 / 90, R8. Final nullity 0.

```
  #  step                                          accepted  conv  resid    nullity notes
  1  A at the origin                               yes       yes   0        26
  2  AB horizontal                                 yes       yes   0        25
  ...
  9  chamfer BC across 10                          yes       yes   0        18
  10 chamfer BC up 10                              yes       yes   0        18      DRIVEN | edge already has a driving dimension — added as reference
  11 chamfer BC up 10 via A-C (workaround)         yes       yes   0        17
  ...
  22 slot bottom line tangent to right arc         yes       yes   0        7
  23 slot arcs equal radius                        yes       yes   0        7
  24 slot radius 8                                 yes       yes   0        6
  ...
  27 slot position: CL x = 60 from A               yes       yes   0        3
  28 slot position: CL y = 20 from A               yes       yes   0        3       DRIVEN | edge already has a driving dimension — added as reference
  29 slot y = 20 via CL-E (workaround)             yes       yes   0        2
  30 hole x = 20 from A                            yes       yes   0        1
  31 hole y = 90 from A                            yes       yes   0        1       DRIVEN | edge already has a driving dimension — added as reference
  32 hole y = 50 above F (workaround)              yes       yes   0        0
  33 hole radius 8                                 yes       yes   0        0
```

* Three steps (10, 28, 31) are **DEMOTED to references**: a vertical dimension between two points that already have a horizontal one. Without them
  the nullity would sit at 3 (verified while iterating: 1 + 1 + 1). Finding **F1**. The recipe reaches 0 only through three workaround steps that
  dimension against a different point.
* Steps 22 and 23 change nothing: the 4th tangent and the equal radius are consistent with the rest (a slot's two lines are parallel, so both are
  implied). Accepted silently, not flagged (observation O1).
* D 5/5 jittered starts; E 30/30 edits with no orientation change; PlaneGCS dof 0.
* The SAME outline with one joint per corner (what a DXF/SVG import or a weld makes) is not clean: seed 51 does not converge (residual 3.5) and two
  AB-length edits flip a corner sign. Finding **F8**.

### 4. TRIANGLE + CIRCLE: isosceles triangle, inscribed circle (3 tangents), centre by midpoint + point-on-line, one angle

Recipe: A at the origin, AB horizontal, equal sides CA = BC, interior angle at A 70 (the dimension reads 110 = 180 - 70, see F3), M = midpoint of
AB, the circle centre on the construction axis C-M, tangent to AB / BC / CA, radius 20 (the only size dimension). Final nullity 0.

```
  #  step                                          accepted  conv  resid    nullity notes
  1  A at the origin                               yes       yes   0        8
  2  base AB horizontal                            yes       yes   0        7
  3  equal sides CA = BC                           yes       yes   0        6
  4  interior angle at A = 70 (the dimension reads yes       yes   9.2e-9   5
  5  M = midpoint of the base                      yes       yes   6.0e-8   3
  6  circle centre on the axis C-M                 yes       yes   5.1e-8   2
  7  circle tangent to AB                          yes       yes   5.1e-8   1
  8  circle tangent to BC                          yes       yes   1.8e-7   0
  9  circle tangent to CA (3rd: consistent by symm yes       yes   2.8e-8   0
  10 circle radius 20 (sets the size)              yes       yes   5.7e-8   0
```

* The recipe order was changed while iterating: with the order AB, CA, BC the 3rd tangent (CA) was **REFUSED `ERR-CSOLVE-01`** although it is
  feasible (finding **F5**); and the angle dimension has to use the shape order `[CA, AB]` or it deforms the triangle (finding **F3**).
* The analytic Jacobian of the non-mutual `pointOnLine` (centre on the axis) differs from finite differences (0.745): finding **F6**. At this
  final state the sketch IS fully constrained, so nullity 0 is right; the lie shows up as soon as the angle is removed (F: delete).
* F: deleting the angle dimension: **nullity 0 -> 0 (expected +1)**. PlaneGCS says dof 1; jittered re-solves land C at y = 82.60 / 80.85 / 74.87.
* E: angle 110 x0.8 = 88 is refused: EXPECTED (the angle reads 180 - base angle of an isosceles triangle; 88 needs a base angle of 92 degrees, the
  apex at infinity; from 92 up it works, from 90 down it is refused, the geometry is untouched, backDev 1.3e-8).
* The circle radius is shape data, not a solver unknown (observation O2): the 20 does not appear in the nullity. FIXED task 515: the radius
  20 takes the last DOF (the 3rd tangent CA is then the redundant step).

### 5. POLYGON + SPOKES: regular hexagon (makePolygon), concentric circle, second circle tangent to two edges, midpoint axis

Recipe: centre O at the origin, circumradius 40, M0/M3 = midpoints of two opposite edges, axis M0-M3 horizontal (rotation), the axis symmetric about
O (`midpoint(M0,M3)=O`), concentric circle (centre coincident with O) R25, a second circle tangent to edges e1 and e2, R8. Final nullity 0.

```
  #  step                                          accepted  conv  resid    nullity notes
  1  centre O at the origin                        yes       yes   5.7e-9   10
  2  circumradius O-k0 = 40                        yes       yes   7.2e-8   9
  3  M0 = midpoint of edge e0 (k0,k1)              yes       yes   3.2e-7   7
  4  M3 = midpoint of the opposite edge e3 (k3,k4) yes       yes   3.5e-8   5
  5  axis M0-M3 horizontal (rotation)              yes       yes   2.1e-7   4
  6  axis symmetric about O: midpoint(M0,M3)=O     yes       yes   3.6e-7   4
  7  concentric circle: centre = O                 yes       yes   3.6e-7   2
  8  concentric circle radius 25                   yes       yes   3.6e-7   2
  9  second circle tangent to edge e1              yes       yes   2.1e-8   1
  10 second circle tangent to edge e2              yes       yes   0        0
  11 second circle radius 8                        yes       yes   0        0
```

* Step 6 is redundant with the regular polygon (opposite edge midpoints are symmetric about the centre): accepted, nullity unchanged, not flagged
  (O1). Steps 8 and 11 are the inert circle radius dimensions (O2). FIXED task 515: each removes the circle's radius DOF.
* The hexagon's corners are SHARED joints (makePolygon), so an angle or perpendicular between two of its sides would hit finding F4.
* D 5/5, E 6/6, PlaneGCS dof 0, no conflict.

## Findings (verdict, repro, diagnosis, proposed task)

Repro for every finding: `node scripts/constraint-audit.cjs` (section FINDING REPROS prints the observed behaviour) or
`node tests/constraint-audit.test.js` (the `known F<n>` lines); the code of each repro is in `tests/harness/audit/findings.js`.

### F6 (FIXED task 511): the DOF count says "fully constrained" while a degree of freedom is free (one-sided `pointOnLine` Jacobian)

* Observed: triangle with the angle dimension deleted: `nullity=0, finite-difference nullity=1, planegcs dof=1; re-solves from jittered starts
  put C.y at 82.60, 80.85, 74.87 (a free family)`. With `mutual: true` on the pointOnLine the nullity is 1. The analytic Jacobian differs from
  finite differences by 0.745 on that row.
* Diagnosis: `definitions.point_on_line` differentiates only the POINT unless `mutual` is set; `engine.jointFreedom()` (task 496) reads the
  nullspace of that analytic Jacobian, so a point-on-line onto a line that can still move hides the line's freedom. The owner's fixture also
  contains a non-mutual pointOnLine.
* Proposed task: `jointFreedom()` and `isDistanceRedundant` must use the full derivative for one-sided rows (take the line endpoint columns for
  the nullity only, keep the one-sided row for solving), and add `fdJacobian` (tests/harness/audit/lib.js) as a guard test over the Definitions.

### F1 (BUG, HIGH): a horizontal and a vertical dimension between the same two points: the second becomes a reference

* Observed: `H dim: driven=false nullity=1; V dim: driven=true (edge already has a driving dimension — added as reference) nullity=1`.
  Positioning a hole or slot from a corner needs exactly this pair; the bracket shows it three times.
* Diagnosis: `ConstraintManager._edgeHasDrivingDistance` matches on the joint pair only and ignores `dimMode` (horizontal / vertical / aligned
  measure different quantities).
* Proposed task: compare `dimMode` (an H and a V dimension never block each other; H+V+aligned on one pair is the redundant case for
  `isDistanceRedundant` to flag), with a test that both drive and the nullity drops by 2.

### F3 (FIXED task 511): an angle dimension on two lines whose signed angle is clockwise deforms / collapses the sketch

* Observed: `angle at its measured value 125.54: accepted=true converged=true residual=5.5e-8; |AB| 100.00 -> 48.4629`; in the triangle drawing
  (isosceles) the same step collapsed AB to length 0 (`B(0.00,-0.00)`), "converged", and a typed 110 was refused.
* Diagnosis: the dimension seams measure `|a1 - a2|` (unsigned), but `definitions.angle` is the signed counter-clockwise angle from line 1 to
  line 2; for a clockwise pair the dimension is unsatisfiable at its own value and the solver converges on a zero-length line (cross = dot = 0).
  Passing the lines in the other order works.
* Proposed task: measure the signed angle (or sort the pair CCW) when the angle constraint is created, and refuse a result that shortens a line
  to zero; test: both orders of any triangle's two edges give the same interior angle.

### F2 (FIXED task 515): `equal` on two circles is accepted but does nothing

* Fix (task 515, owner ruling "match Fusion for circles"): a circle's radius is ONE solver unknown, declared by `hasRadiusUnknown` in
  packages/core/solver/engine.js and laid out after the joint unknowns; `_unpack` writes the solved value back to `shape.radius`. `equal` with a
  circle operand compares the radius unknown with the other shape's size (circle-circle r1 - r2; circle-arc r - |rim - centre|). Repro after:
  `equal accepted=true nullity=5; after b.radius=12 and a solve: radii 10 / 10, residual 0.00e+0 (-); radius edit refused=false`. Test:
  tests/circle-radius-dof.test.js (equal(c1,c2) then edit c1 8 -> 11: both 11).

* Observed: `equal accepted=true nullity=4; after b.radius=12 and a solve: radii 8 / 12, residual 4.00e+0 (equal); radius edit refused=true`.
  In the plate the hole-radius edits are refused (`REFUSED (equal)`).
* Diagnosis: a circle has ONE joint and its radius is shape data; engine.js builds `equal`'s joint list from the shapes' joints, so the row has no
  radii, while the verifier measures the radii: the sketch reports a conflict the solver cannot reduce, and editing one radius is refused.
* Proposed task: either make `equal` between circles/arcs write the radius (like `commitDimensionEdit` does for a radius dimension) or refuse it at
  creation; test: equal(c1,c2) then edit c1's radius, both follow.

### F4 (BUG, MEDIUM): angle / perpendicular between two lines that share a joint

* Observed: `angle 60 typed: nullity 6 -> 5 (counted as a constraint) but AC is at 60.26 deg (typed value 60 REFUSED: angle); perpendicular
  accepted=false errors=ERR-CSOLVE-01`.
* Diagnosis: engine.js dedupes the joints of the two shapes (`[...new Set(jointList)]`) for everything except `equal`, so a shared corner leaves
  3 joints where `definitions.angle/perpendicular/parallel` read 4 (`joints[3]` undefined -> NaN row). Corners are shared in `makePolygon`, in
  fillet rims, in DXF/SVG imports and after a weld; the line tool makes coincident pairs, which is why the drawings built that way work.
* Proposed task: pass the four endpoints positionally (as `equal` already does) for angle / perpendicular / parallel; test on a polygon corner.
* Task 533: with the endpoints positional, the shared corner repeated one joint index inside the row, and parallel / perpendicular / angle
  ASSIGNED each joint's columns, so the second line's partial overwrote the first (`|J - fd|` up to 14 on a shared corner, 10 for the same line
  twice). Every row now accumulates through one helper, `addGrad` (definitions.js). Coverage matrix F4 11 -> 0 (7 feasible shared-corner
  parallel / perpendicular cells were refused and are accepted now, 4 shared angle cells now keep the angle after a jitter), extreme arcs F4 4 -> 0;
  the random properties still attribute F4 to 8 cases (I2 1, I3 3, I5 2, I7 2: their trigger is any perpendicular / angle between lines that share
  a joint or a coincident cluster), not re-examined here.

### F5 (BUG, MEDIUM): a feasible tangent is refused `ERR-CSOLVE-01` depending on the order

* Observed: `tangent CA right after tangent AB: accepted=false errors=ERR-CSOLVE-01 Tangent rejected — creates a conflict (res: 0.0462)`; the
  same constraint is accepted after the BC tangent, and the result is nullity 0 with all three.
* Diagnosis: `_sandboxVerify` judges feasibility from a 45-iteration burst starting at the current geometry, which is far from the solution
  here; a slow-but-feasible structural constraint looks like a conflict.
* Proposed task: confirm a sandbox refusal with the full solve budget (as the post-add path already does with `HIGH` iterations) before refusing.

### F8 (UNCLEAR, MEDIUM): an outline with one joint per corner flips / fails to converge

* Observed: bracket with shared corner joints: `perturbed starts that did not return: seeds 51 (residual 3.5e+0); dimension edits that flipped an
  orientation sign: 2`; the line-tool version (coincident pairs) is clean.
* Diagnosis: not found. Candidates: the corner has no coincident rows, so the chamfer / arm corners have more freedom to fold; F4 does not apply
  (no angle used).
* Proposed task: bisect which constraint family folds (start with the chamfer H/V pair), then decide.

### F7 (BUG, LOW): `makeArc` ids collide inside one millisecond

* Observed: `two makeArc calls produced the same shape id`. The harness had to wait for the clock between fillets; PlaneGCS refuses duplicate ids.
* Diagnosis: `shapes.js` makeArc `id: \`s_arc_${Date.now()}\``, `groupId` likewise (applyFillet, import, scripted use).
* Proposed task: use the shared id generator (a counter) for shapes and groups; test: 1000 arcs, 1000 ids.

## Observations that are not bugs (verdicts)

* **O1 (UNCLEAR)**: redundant (consistent) geometric constraints are accepted silently and not flagged: bracket steps 22-23, triangle step 9,
  polygon step 6. Redundant DIMENSIONS are flagged as references. Pinned in the test (`NO_EFFECT`). Proposed: a redundant-constraint badge
  (PlaneGCS exposes the list; the nullspace gives the same via `isDistanceRedundant`-style rank test).
* **O2 (FIXED task 515)**: a circle's radius is not a solver unknown, so an undimensioned circle is "fully constrained" once its centre is, and the radius
  dimension never changes the DOF (steps 17, 33, 10 and 8/11 above). Fusion counts the radius as a DOF. Now: a free circle has 3 DOF, its centre on
  the origin 1, plus a radius dimension 0 (Design panel, `jointFreedom().radiusFree`, the circle's fully-constrained colour); radius / diameter
  dimension, equal, tangent (line-circle, circle-circle, arc-circle) and point-on-circle act on the radius. An ARC keeps its 3-joint model: 6
  coordinates minus its structural equal radius = 5 DOF, which is Fusion's arc (centre 2, radius, 2 angles).
* **O3 (RESOLVED, task 516)**: a dimension on a quantity the sketch already determines is now placed DRIVEN at its measured value, shown in brackets,
  and no value box opens (it was: typed value accepted, then replaced by the measured one with a toast). Measured in Fusion 2706.1.17: on a fully
  constrained square a driving diagonal is refused (over-constrained), a driven one is accepted at the measured value, driven -> driving is refused
  while the sketch determines it, and works after a side dimension is deleted. One rule for every mode (aligned/horizontal/vertical, point-to-line,
  line-line, angle, radius), one test (`isDimensionDetermined` in dimension-seams.js = the engine rank test `isDistanceRedundant`): placement
  (ConstraintManager for distances, the value box `showEditInput` for every mode) and the right-click Driving toggle (`toggleDriving`, refused with
  a message; the old swap of two drivers is gone). A driven dimension never opens the value box (`showEditInput` is the only opener). The old
  typed-then-demoted path stays only as the safety net for a conflict the rank test cannot see (nonlinear, e.g. a diagonal of 50 against a fixed
  width of 100): reachable only by creating a dimension with a preset value (`createConstraint`, sandbox-conflict), not by the pointer path.
  Tests: tests/dimension-redundant-driven-live.test.js (real pointer), tests/dimension-determined.test.js. Since task 515 a circle's radius is a solver
  unknown (O2), so the same rank test covers a circle radius dimension (e.g. a second circle equal to a dimensioned one).
* **O4 (EXPECTED)**: triangle angle 110 x0.8 refused: mathematically impossible (see the triangle section); the refusal restores the geometry.
* **O5 (EXPECTED)**: PlaneGCS lands on another fillet branch from one jittered start of the trapezoid (seed 23, dev 40.6); our solver returned to
  the reference in all 5 starts of all 5 drawings. During the slot recipe PlaneGCS's DOF reads 1-2 below ours between the two arc `midpoint`
  steps (by hand: a semicircle with symmetric rims has 4 DOF, which is ours); both agree again at the final state, so the oracle's mid-recipe
  numbers are not used.
* The oracle needed one mapping decision worth knowing: a line ending ON an arc's rim is tangent AT that point (radius perpendicular to the line,
  `perpendicular_pppp`), as FreeCAD does; `tangent_lc` plus rim-on-circle is a double root there (PlaneGCS reports it redundant and miscounts DOF).

## Ranked findings

| rank | id | severity | verdict | one line |
|---|---|---|---|---|
| 1 | F6 | HIGH | BUG | DOF says fully constrained while a DOF is free (one-sided pointOnLine Jacobian) |
| 2 | F1 | HIGH | BUG | H and V dimension on the same two points: the second is demoted |
| 3 | F3 | HIGH | BUG | clockwise angle dimension deforms / collapses the sketch at its own value |
| 4 | F2 | HIGH | FIXED (515) | `equal` on circles is a silent no-op; hole radius edits are refused |
| 5 | F4 | MEDIUM | FIXED (510, 533) | angle / perpendicular on a shared joint (polygon, fillet rim, import); 533: the shared joint's Jacobian columns accumulate |
| 6 | F5 | MEDIUM | BUG | feasible tangent refused ERR-CSOLVE-01, order dependent |
| 7 | F8 | MEDIUM | UNCLEAR | shared-corner outline folds / fails from a jittered start |
| 8 | F7 | LOW | BUG | makeArc same-millisecond id collision |
| - | O1, O2, O3 | - | UNCLEAR / FIXED (O2, 515) / EXPECTED | silent redundancy, circle radius not a DOF, typed conflicting value becomes a reference |
