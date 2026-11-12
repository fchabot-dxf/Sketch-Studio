# Solver coverage audit (SketchStudio)

(Section "Matrix" is task 512's. This file holds section "Properties", task 514.)

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
| 1 | N-F1 | HIGH | Fillet on a corner AT the origin deletes `j_origin`. Repro: closed triangle with a corner on (0,0), fillet it: origin gone. | `packages/core/fillet.js:328-331` (deletes the whole corner cluster; the cluster includes every joint within 1e-4, `fillet.js:50-58`) | applyFillet: keep j_origin, re-link to it |
| 2 | N-F4 | HIGH | A REFERENCE angle dimension becomes DRIVING again after save / load or undo. | `packages/core/constraints.js:272-284` (ANGLE whitelist has no isDriven/driven; radius lacks driven/drivenReason, `:209-221`; DISTANCE has them) | carry the flags |
| 3 | N-F7 | HIGH | Tangent between two arcs sharing a rim joint (S-curve) is degenerate: nullity 1 vs finite-difference 2, radius dim demoted, 0/3 jittered restarts return, analytic Jacobian differs from fd. | `packages/core/solver/definitions.js:355-373` (\|C1C2\| = r1+r2 at its extremum; radii constants in the Jacobian) | shared-rim form cross(C1-Q, C2-Q) = 0, like the line case's `sharedEnd` |
| 4 | N-F5 | MEDIUM | Collinear on two lines that meet at a corner: panel DOF one too low (panel 4, fd 5); deleting it raises panel DOF by 2, true contribution 1. 26 of 300 random cases. | `packages/core/solver/definitions.js:233-247` (one-sided Jacobian), same family as F6 | symmetric Jacobian or drop the degenerate row |
| 5 | N-F2 | MEDIUM | Fillet cannot be applied to any corner of a Polygon-tool polygon. | `packages/core/fillet.js:92` (3 lines on a corner: the construction radial counts) with `shapes.js:260` | ignore construction lines when counting |
| 6 | N-F6 | MEDIUM | Editing a dimension can move a tangent circle to the other side of its line or invert an under-constrained arc (5 of 300 cases). | `packages/core/constraint-manager.js:197-203` (tangent branch lock intentionally off) | lock the side / sweep sign |
| 7 | N-F3 | LOW | Save and undo drop `dimSign` / `dimSignMode`; re-derived from the current geometry afterwards. | `packages/core/constraints.js:244-257` | carry the fields |
| 8 | N-U1 | LOW | Unexplained: deleting a vertical dimension raises the panel DOF 1, fd rank unchanged (4-gon, 4 ops, seed 7090). | repro `N-U1` in `prop-findings.js` | solver owner |
| 9 | N-U2 | LOW | Unexplained: edit x0.9 and back leaves a determined joint 8e-3 away (point-to-line dimension involved). Not hit by the random run since task 510 (F4 fix); the standalone repro still fails. | repro `N-U2` | solver owner |

Round-1 findings seen again by the random run: F6 (pointOnLine DOF lie), F3 (angle), F4, F5. F2 and F8 never triggered.

### Limits

Random sketches rarely become fully constrained (1 of 300), so I7's "determined joints" are usually few; the recipe drawings cover the fully constrained case. The PlaneGCS comparison is only as good as the translation: arc/arc tangent at a shared rim is degenerate in PlaneGCS as well (dof 2), so N1 is excluded from the PlaneGCS assertion.
