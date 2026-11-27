# Recipe parity audit (task 1037): are our compound shapes built like Fusion 360's?

Status: AUDIT ONLY. No app code is changed by this task. Owner ask (2026-11-27): "tools that have basic parts combined are as they would be in Fusion: arc, rect etc." Owner rule: report divergences, the owner decides; no symmetry for its own sake.

**Sources**
- Fusion side: measured by the advisor on 2026-11-27 with the real mouse and Fusion's own commands (grid snap on), one scratch sketch, one cell per case. Recording `.evidence/1037/shp_results.json` (md5 `ac676a7711e32820da45811ed8c52b52`), made by `.evidence/1037/shp_step.py` (local evidence, not committed).
- Our side: `tests/audits/recipe-parity-1037-node.mjs` (+ `tests/audits/recipe-parity-1037-kit.js`), outside the gate. It draws each case in the real SketchStudio page (the node kit, `tests/helpers/node-app.js`): the ribbon button, the variant row of its menu, then the same clicks (Fusion cm → our mm, Y flipped, a cell away from the origin and axes). Run: `node tests/audits/recipe-parity-1037-node.mjs`. Output of the run quoted here: `.evidence/1037/probe-run.txt` (md5 `b4b7bf1795a535534a7bb05e8492643b`).
- `file:line` is at `origin/main` **e16c9352**. Paths are relative to `packages/` unless they start with `apps/` or `tests/`.

**How DOF is counted.** Ours: the solver's nullspace, `engine.jointFreedom().nullity` (`core/solver/engine.js:1447-1559`, the ground truth of task 496), which is also what the Design panel shows. Both sides: one independent numeric model in the kit (unknowns = points + circle radii; an arc is centre + start + end with |s-c| = |e-c|; DOF = unknowns - rank of the Jacobian after projecting onto the equations). On every case where our solver's rows are regular, the model equals the solver (table below), so the same model gives the Fusion DOF. Where they differ, the solver is wrong (appendix N-A, N-B), not the model. Fusion's `Polygon` constraint does not expose its entities in the recording; the model treats it as "a regular N-gon about its centre point" (an assumption, see uncertain).

**"Inferred" vs "structural" (ours).** Each case is drawn twice, the second time with every click rotated 7° about the first click. A constraint kind whose count changes was put there by the drawing direction. Result: only the straight slots' `horizontal` on the centre line (`horizontal 1->0`, `ui/input-handlers/slot-tool.js:358`, R1-08). Every other constraint of ours is structural (the maker's). On the Fusion side the slots' `Horizontal(Line4)` is also from the horizontal drawing (an inference, not measured rotated; the clicks were horizontal).

**Classes.** (a) SAME. (b) MODELLING ONLY: a user sees no difference (how that is known is stated). (c) BEHAVIOUR DIVERGENCE: the user sees a difference.

---

## 1. DOF as built

| Case | Fusion (model) | Ours, true (model) | Ours, solver / Design panel | Class |
|---|---|---|---|---|
| 2-Point Rectangle | 4 | 4 | 4 | (a) |
| Center Rectangle | 4 | 4 | 4 | (a) |
| 3-Point Rectangle | 5 | 5 | **8** | (a) by recipe; the 8 is bug N-A |
| Circle (centre) | 3 | 3 | 3 | (a) |
| Circle 2-point / 3-point | 3 | no variant | — | — |
| 3-Point Arc | 5 | 5 | 5 | (a) |
| Center Point Arc | 5 | 5 | 5 | (a) |
| Polygon inscribed | 4 | 4 | 4 | (a) |
| Polygon circumscribed / edge | 4 | no variant | — | — |
| Slot C2C / Overall / Center Point | 4 (with the inferred H; 5 without) | **3** (4 without H) | 3 | (c): our width dimension, D-6 |
| Arc slot 3-point / center | 6 | **5** (rank count 6) | **9** | (c): width dimension D-6; recipe rank D-7; the 9 is bug N-B |

Quoted (`probe-run.txt`, DOF SUMMARY: "ours" there is the solver; "model" is ours true):
```
DOF ShapeRectangleThreePoint: fusion 5 | ours 8 (model 5, rotated 8)
DOF ShapeSlotCenterToCenter: fusion 4 | ours 3 (model 3, rotated 4)
DOF ShapeArcSlotThreePoint: fusion 6 | ours 9 (model 6, rotated 9)
```
The arc slot's model 6 is a first-order count: our recipe has a tangential intersection (D-7), its finite DOF is 5 (P-07: adding Fusion's 4th tangent makes the rank regular, DOF 5).

---

## 2. One row per case

Fusion entity names are the recording's (`Line0`, `Arc1`, ...). Ours: `L0`, `A1` in the order the maker pushes them, `.s / .e / .c` = start / end / centre; `X=Y` = one joint shared by both.

| # | Case | Fusion recipe (as recorded) | Ours (as built) | Divergences |
|---|---|---|---|---|
| 1 | **2-Point Rectangle** (`rect` / `rect-2pt`) | 4 lines, 4 **shared** corners (4 points); `Horizontal x2, Vertical x2` | 4 lines, **8 joints** + 4 `coincident` (`core/shapes.js:24-58`); `horizontal x2, vertical x2` | D-1 joints (b) |
| 2 | **Center Rectangle** (`rect-center`) | 4 lines + 2 construction diagonals, 5 points (corners shared by sides and diagonals; centre lone, on both diagonals); `Horizontal(Line0)`, `Perpendicular(Line1,Line0)`, `Parallel(Line2,Line0)`, `Parallel(Line3,Line1)`, `Coincident(centre,Line4/Line5)` | 4 lines + 2 construction diagonals, **13 joints** + 8 `coincident`, the centre lone with 2 `pointOnLine` (`core/shapes.js:82-142`); `horizontal x2, vertical x2` | D-1 joints (b); **D-2** H,V,H,V vs H + Perp + Par x2 (c) |
| 3 | **3-Point Rectangle** (`rect-3pt`) | 4 lines, 4 shared corners; `Perpendicular(Line1,Line0)`, `Parallel(Line2,Line0)`, `Parallel(Line3,Line1)` (no H/V) | 4 lines, 8 joints + 4 `coincident`; **4 `perpendicular`** (branch-locked, one redundant) (`core/shapes.js:203-213`, `ui/input-handlers/rect-tool.js:197`) | D-1 (b); **D-3** 4 Perp vs Perp + Par x2 (c); bug N-A |
| 4 | **Center Diameter Circle** (`circle`) | 1 circle + its centre, no constraint | 1 circle (centre joint + `radius` unknown), no constraint (`ui/input-handlers/circle-tool.js:112`) | none (a) |
| 5 | **2-Point Circle** | 1 circle + centre, no constraint | **no variant** (Circle is centre + radius only) | D-8 missing variant |
| 6 | **3-Point Circle** | 1 circle + centre, no constraint | **no variant** | D-8 |
| 7 | **3-Point Arc** (`arc` / `arc-3pt`) | 1 arc, 3 points (centre, start, end; the through-point not kept), no constraint | 1 arc, 3 joints, 1 `equal(c,s,c,e)` (`core/shapes.js:273-297`) | D-4 the arc's EQUAL (b) |
| 8 | **Center Point Arc** (`arc-cse`) | as 7 | as 7 | D-4 (b) |
| 9 | **Inscribed Polygon** (`polygon`, 6 sides) | 6 lines, 6 shared corners + a **lone centre**; **one `Polygon` constraint**; no construction | 6 lines + **6 construction radii** (centre → corner), shared joints; **10 `equal`** (5 sides chain, 5 radii chain) (`core/shapes.js:236-268`) | **D-5** (c) |
| 10 | **Circumscribed Polygon** | as 9 | **no variant** (the Polygon tool's second click is a corner, `ui/input-handlers/polygon-tool.js:136-179`) | D-8 |
| 11 | **Edge Polygon** | as 9 | **no variant** | D-8 |
| 12 | **Center to Center Slot** (`slot-c2c`) | 2 lines + 2 arcs + a construction centre line whose ends ARE the arc centres (6 points, all shared); `Tangent x4`, `Parallel`; `Horizontal(Line4)` (inferred); **no dimension** | same parts and sharing (6 joints); 2 arc `equal`, `tangent x4`, `parallel`, `horizontal` (inferred) + **a DRIVING width (diameter) dimension** (`core/slot.js:168-193`) | D-4 (b); **D-6** width dimension (c) |
| 13 | **Overall Slot** (`slot-overall`) | as 12, the centre line from tip to tip (8 points); + `Coincident(Line4.start,Arc3)`, `Coincident(Line4.end,Arc1)`, `Coincident(Arc1.center,Line4)`, `Coincident(Arc3.center,Line4)` | as 12 + the same 4 incidences as `pointOnLine` (`core/slot.js:232-237`); width dimension | D-4 (b); D-6 (c) |
| 14 | **Center Point Slot** (`slot-center`) | as 12 + a lone centre with `MidPoint(pt, Line4)` | as 12 + a lone centre with `midpoint(c1, c2, m)` (`core/slot.js:259-261`); width dimension | D-4 (b); D-6 (c) |
| 15 | **Three Point Arc Slot** (`slot-arc-3pt`) | 4 arcs + a construction centre arc whose ends are the caps' centres, 7 shared points; **`Tangent x4`**; no dimension | same parts and sharing (7 joints); 5 arc `equal`, **`tangent x3`** (branch-locked), **a DRIVING width dimension** (`core/slot.js:286-320`) | D-4 (b); D-6 (c); **D-7** 3 vs 4 tangents (c); bugs N-B, N-C |
| 16 | **Center Point Arc Slot** (`slot-arc-center`) | as 15 | as 15 | as 15 |

Joint counts quoted (`probe-run.txt`): `OURS joints 8 | shared none | coincident constraints 4` (2-point rect), `OURS joints 13 | shared none | coincident constraints 8 | lone ["(70,-50)"]` (centre rect), `OURS joints 7 | shared A0.c=A2.c=A4.c A0.s=A3.e A0.e=A1.s A1.c=A4.e A1.e=A2.e A2.s=A3.s A3.c=A4.s | coincident constraints 0` (arc slot). Fusion point counts equal the distinct coordinates of every case (`points 4 (model 4)`, `points 5 (model 5)`, `points 7 (model 7)`, ...): Fusion never records a point-to-point coincident; every Fusion `Coincident` is a point on a curve.

---

## 3. The divergences

### D-1 (b) Two joints + coincident at a rectangle corner (ours) vs one shared point (Fusion)
All three rect makers (`core/shapes.js:24-58`, `:82-137`, `:175-212`). Every other compound of ours (polygon, both slot kinds) already shares its joints, as Fusion does everywhere.
**Why (b):** the DOF is the same (4 = 4, 4 = 4, 5 = 5) and a corner drag moves both sides together and keeps the angles:
```
P-01 rect-2pt as built: DOF ours 4 (Fusion model 4); glyphs {"horizontal":2,"vertical":2}
P-01 drag L0.e by (+6,-4): L0.e (96.054,-44.017) L1.s (96.054,-44.017) together true; angles L0/L1 90 L1/L2 90 L2/L3 90
```
**One difference a user can reach** (flagged, the owner decides whether it counts): a corner clicked with Select shows a coincident glyph, which can be selected and deleted (the corner then comes apart). Fusion has no constraint there to show or delete.
```
P-01 corner L0.e clicked with Select (selected joints 1): visible glyphs {"horizontal":2,"vertical":2,"coincident":1} (Fusion: a shared point has no coincident to show)
```

### D-2 (c) Center Rectangle: H, V, H, V (ours) vs H + Perpendicular + Parallel x2 (Fusion)
As built the two are the same (DOF 4, axis-aligned). **The first edit differs.** Delete the one Horizontal: Fusion's rectangle can rotate and stays a rectangle (Perpendicular + 2 Parallel). Ours becomes a trapezoid: the side whose H was deleted tilts.
```
P-02 rect-centre, its first side's Horizontal deleted: DOF ours 5 | Fusion model without Horizontal(Line0): 5
P-02 then drag that side's end up 6: angles L0/L1 81.842 L1/L2 90 L2/L3 90 L3/L0 81.842 (Fusion: Perpendicular(Line1,Line0) + Parallel x2 keep every angle 90)
```
To rotate our centre rectangle a user must delete four constraints and add perpendiculars. **Fix = recipe only** (`core/shapes.js:124-128`: the existing PERPENDICULAR and PARALLEL types). Note the 2-Point Rectangle is H, V, H, V in BOTH (row 1: same), so only the centre recipe differs.

### D-3 (c) 3-Point Rectangle: 4 Perpendicular (ours) vs Perpendicular + Parallel x2 (Fusion)
Same true DOF (5), same shape as built. Differences a user sees: 8 perpendicular glyphs (2 per constraint) instead of Fusion's one Perpendicular and two Parallel; deleting one of ours changes nothing (the other three still define the rectangle), while in Fusion deleting the Perpendicular leaves a parallelogram. Ours also feeds the solver one redundant constraint (model rank 13 of 14 rows: `model: unknowns 18 equations 14 rank 13 DOF 5`), which `core/shapes.js:229-230` says the polygon avoids on purpose ("a redundant constraint, which the solver must not be fed").
```
OURS constraints (8): perpendicular(L0,L1)[-1] perpendicular(L1,L2)[1] perpendicular(L2,L3)[-1] perpendicular(L3,L0)[1] coincident(L0.s,L3.s) ...
OURS visible glyphs (nothing selected): {"perpendicular":8}
```
**Fix = recipe only** (`core/shapes.js:203-207`). It does NOT fix bug N-A (Fusion's recipe still has one branch-locked perpendicular).

### D-4 (b) The arc's own EQUAL (ours) vs Fusion's native arc
Fusion's arc is three points with one radius; ours stores the same three points plus `equal(c,s,c,e)` (`core/shapes.js:294-297`, task 789). **Why (b):** the same DOF (5 = 5 for both arc modes, 3 = 3 points), and the EQUAL draws no glyph (`OURS visible glyphs (nothing selected): {}` on both arcs), so a user can neither see nor delete it. The same holds for the slots' arcs. Nothing to adopt.

### D-5 (c) Polygon: N construction radii + 2(N-1) EQUAL (ours) vs one `Polygon` constraint, no construction (Fusion)
Same DOF (4), same shape. What a user sees differently:
- six dashed construction radii from the centre to each corner, which can be snapped to, selected and dimensioned; Fusion draws none (its centre is a lone point);
- 20 equal glyphs (10 constraints) instead of one Polygon constraint;
- deleting one equal makes the polygon partly irregular (DOF 5); in Fusion the one Polygon constraint goes as a whole.
```
P-04 polygon: construction lines 6 (Fusion 0); constraints 10 (Fusion 1: Polygon); glyphs {"equal":20}
P-04 delete ONE equal (the user's Delete on one glyph): DOF 5 (was 4): the polygon is no longer regular. Fusion: the one Polygon constraint goes as a whole (model without it: 14)
```
**Fix options (owner decides):** (i) recipe only: drop the radii and keep the corners on one circle with the joints form of EQUAL (`equal(c, v0, c, vi)`, the arc's own form, which draws no glyph), keeping the N-1 side equals. That removes the construction lines and the radius glyphs; the N-1 side equals still show (2 glyphs each). (ii) a declared polygon constraint (one glyph, deleted as a whole, like Fusion): a NEW constraint type, not a recipe change.

### D-6 (c) Every slot gets a DRIVING width dimension (ours); Fusion adds none
`core/slot.js:191-193` (straight) and `:315-320` (arc) always call `makeWidthDimension` (`:148-157`), also when nothing was typed. Fusion's recording has `dims 0` for every slot. The user sees a dimension Fusion does not place and has one DOF less; deleting it gives Fusion's DOF:
```
P-05 ShapeSlotCenterToCenter: width dimension DRIVING 16.028; DOF with it: solver 3 model 3; deleted: solver 4 model 4 | Fusion model 4
P-06 ShapeArcSlotThreePoint: width dimension DRIVING 10.102; DOF with it: solver 9 model 6; deleted: solver 10 model 7 | Fusion model 6
```
(The arc slot numbers there also carry D-7 and N-B.) **Fix = recipe only**: place the width dimension only for a typed width, as the span (`ui/input-handlers/slot-tool.js:359-388`) and the other tools' typed sizes already do. Unverified on the Fusion side: whether Fusion places a width dimension when the width IS typed (not measured).

### D-7 (c) Arc slot: 3 tangents (ours) vs 4 (Fusion)
`core/slot.js:309-311` adds outer-cap1, inner-cap1, outer-cap2; Fusion also has inner-cap2. With 3, the inner arc and cap 2 meet as two circles that are themselves tangent at the corner (a tangential intersection), so the recipe is rank-deficient: the first-order DOF is one more than the real one. Adding the 4th tangent makes it regular:
```
P-07 ShapeArcSlotThreePoint: ours model rank 10 DOF 6; + the 4th tangent (inner arc - end cap 2, Fusion has it): rank 11 DOF 5 | solver nullity 9 | Design panel DOF 9
```
The geometry itself holds: a width edit keeps the 4th corner tangent (`sin(angle C,c2,i2) before 2.0e-5 after 2.0e-5`). So the user-visible effect is in the DOF / redundancy analysis only: even with bug N-B fixed, the Design panel would show one DOF that cannot move. The missing tangent also has no glyph (moot today: N-C draws none of the three). **Fix = recipe only** (one more `createConstraint(TANGENT, { shapes: [ai.id, e2.id], branch: 'external' })` beside `:309-311`).

### D-8 Missing variants (feature gap, not a recipe divergence)
2-Point Circle, 3-Point Circle, Circumscribed Polygon, Edge Polygon: we have no such variant (`core/constants.js:107-182` declares rect, slot and arc modes only; the circle and polygon tools have one mode each). If added, Fusion's recipes are recorded above (circles: no constraint; polygons: as row 9). Not a bug; the owner decides whether to add them.

---

## 4. For the shape-model plan (`docs/SHAPE-MODEL-PLAN-1035.md` on `origin/agents/shape-model-1035`)

**Recipes worth adopting from Fusion** (each is a recipe change only, in the plan's `RECIPES`; the owner decides each):
1. `rectCenter`: Horizontal(first side) + Perpendicular + Parallel x2 instead of H, V, H, V (D-2).
2. `rect3pt`: Perpendicular + Parallel x2 instead of 4 Perpendicular (D-3; also removes a redundant row).
3. The 5 slots: no width dimension unless a width was typed (D-6).
4. Arc slots: the 4th tangent (D-7).
5. `polygon`: no construction radii (D-5 option i), or a declared polygon constraint (option ii, a new constraint type).

**Not worth changing:** the arc's EQUAL (D-4, invisible, same DOF); the 2-Point Rectangle's H, V, H, V (Fusion has the same); the slots' parts, sharing, tangents, parallel, overall incidences and midpoint (same as Fusion); the H/V inference on a slot's centre line (Fusion infers it too).

**Q2 (one joint convention: shared point vs coincident), answered from this evidence.** Fusion shares the point in all 16 cases: its point count is the number of distinct coordinates in every case and it never records a point-to-point coincident. Ours already shares in every compound except the three rectangles. For a user the two are the same (D-1: same DOF, a corner drag moves both sides), with one reachable difference: our corner shows a deletable coincident glyph when selected. So the evidence supports **shared points as THE convention for recipes** (it is Fusion's, and our polygon / slots / arc slots already use it); adopting it changes only the rect makers. Behaviour changes if adopted (for existing users): a new rectangle's corner can no longer be split by deleting a coincident; a corner selection shows no coincident glyph; the rect's joint count falls from 8 / 13 / 8 to 4 / 5 / 4. Not probed: delete-one-side and trim / break on a shared-corner rectangle (they work on the polygon today, which shares). The plan's proposed default (keep each recipe's current convention) remains possible; the owner decides.

---

## Appendix: new bugs found (NOT entered in BUG-ARCHIVE, audit rule 5)

**N-A. A branch-locked perpendicular has a zero Jacobian row where it holds exactly, so the DOF and the redundancy test are wrong on a 3-point rectangle as built.** `core/solver/definitions.js:527-530`: with a branch the row is `u × v − branch·|u||v|`, which is never above 0 (branch 1) and touches 0 at the target: a double root (its gradient vanishes there; the mechanism was noted for EA-6 in `docs/COVERAGE-AUDIT.md:407-411`, not its DOF effect). The rect maker builds the rectangle exactly perpendicular, so all four rows are zero and `jointFreedom` counts them as free. Every perpendicular made through `CM.createConstraint` is branch-locked (`core/constraint-manager.js:209-210`, `:1156-1175`), so the same holds for any exactly-perpendicular pair (read, not run, beyond the rectangle). Probe lines (`node tests/audits/recipe-parity-1037-node.mjs`):
```
P-03 rect-3pt as built: solver nullity 8 | Design panel DOF 8 | model (ours) 5 | Fusion model 5 | angles 90 90 | dimensions: side L0 DRIVING, opposite side L2 (equal by the rectangle) DRIVING
P-03 rect-3pt after a corner drag (third corner +3,+2; the drag added nothing): solver nullity 5 | Design panel DOF 5 | model (ours) 5 | Fusion model 5 | angles 90 90 | dimensions: side L0 DRIVING, opposite side L2 (equal by the rectangle) reference
P-03 control rect-2pt as built: solver nullity 4 | Design panel DOF 4 | model (ours) 4 | Fusion model 4 | angles 90 90 | dimensions: side L0 DRIVING, opposite side L2 (equal by the rectangle) reference
P-03b rect-3pt, DOF after each step (true = model): coincident(corner, origin): model 3 solver 6 | + Horizontal(base): model 2 solver 1 | + base 40: model 1 solver 1 | + side 20: model 0 solver 0
```
What the user sees: a fresh 3-point rectangle shows DOF 8 (true 5); a dimension on the side opposite a dimensioned side is placed DRIVING (a redundant driving dimension; on a 2-point rectangle, or after a drag, it is correctly a reference); and the count can also be too LOW (P-03b: 1 shown, 2 free). The answer depends on how exactly the last solve landed. Likely fix: the regular form at the solution (the dot-product row, keeping the branch only as a side check, as `sharedEnd` does for line-arc tangency, `core/solver/engine.js:839-843`); not tried.

**N-B. An arc-arc tangent at a shared end point has a zero row too: the arc slot shows DOF 9 (true 5).** `core/solver/definitions.js:587-598`: `|C1C2| − (r1 + r2)` (or `|r1 − r2|`) is an extremum when the two arcs share their touching point. The line-arc case already switches to the regular endpoint form for exactly this reason (`core/solver/engine.js:839-843`, comment: "distance-to-line has a double root there"); the arc-arc case has no counterpart. Probe lines:
```
P-07 ShapeArcSlotThreePoint: ours model rank 10 DOF 6; + the 4th tangent (inner arc - end cap 2, Fusion has it): rank 11 DOF 5 | solver nullity 9 | Design panel DOF 9
P-07 ShapeArcSlotCenterTwoPoint: ours model rank 10 DOF 6; + the 4th tangent (inner arc - end cap 2, Fusion has it): rank 11 DOF 5 | solver nullity 9 | Design panel DOF 9
```
(9 = the model's 6 + the 3 zero tangent rows.) Also likely hit: a fillet between two arcs and any arc-arc Tangent placed where the arcs share an end (read, not run).

**N-C. A tangent between two circles / arcs draws no glyph.** `ui/svg-renderer.js:2293-2295`: the TANGENT glyph reads `c.line` and `c.circle` and returns when either is missing; a circle-circle or arc-arc tangent is stored as `{ shapes, branch }`. So the arc slot's three tangents, and a tangent the Tangent tool places between two circles, are invisible: they cannot be seen, hovered, selected or deleted through a glyph. Probe lines:
```
P-07 ShapeArcSlotThreePoint: tangent constraints 3, tangent glyphs drawn 0 (Fusion: 4 Tangent constraints)
P-08 two circles + Tangent (ConstraintManager.createConstraint, the Tangent tool's seam): created true fields shapes,branch; glyphs drawn {}
```
