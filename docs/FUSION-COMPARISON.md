# Fusion 360 as an oracle for the SketchStudio solver (TASK 518)

Audit only: nothing in `packages/` changed. Fusion answers were recorded from a live Fusion 360 (`app.version` 2706.1.17, 2026-11-11, a scratch
document made for the run and closed without saving) through `scripts/fusion-oracle/run-which-moves.py` and stored as data in
`tests/fixtures/fusion-oracle/`. `tests/fusion-oracle.test.js` (pure node, in the gate) replays every recipe through OUR pipeline and compares.
Units: our mm; Fusion's API is cm (x10 on the way out). Divergences are reported, not changed: the owner decides each one.

## Summary

Fusion 360 (2706.1.17) answered 315 + 2438 which-moves cells and replayed 13 drawings (954 comparison rows) with the same recipes as our audits. Divergences are **reported, not changed**: the owner decides each one.

1. **Who moves when a constraint is added to geometry that does not satisfy it.** Fusion moves the operand that is held LEAST and never meets in the middle: with equal holds the first pick stays and the second is moved (parallel / perpendicular / angle: rotate about its midpoint; equal(line): keep the start, change the length; coincident: translate the whole second line; dimensions: the free end slides). One ranking of the hold levels per constraint predicts 55/55 (parallel, perpendicular, equal), 39/39 (collinear), 73/73 (coincident), 54/55 (angle) of the one-mover cells (section "graded"). Ours moves BOTH operands for most constraints and ignores the pick order for several (coincident, 2-point H/V); collinear / pointOnLine / pointOnCircle placement was task 511: after it most of those cells agree and the rest are relabelled as real remaining differences (table below). Proposed fixes per constraint are in "Which geometry moves" (one place: `placeForCreation` in `createConstraint`, the hook task 511 added; dimension rows: `commitDimensionEdit`).
2. **Refusals.** Fusion refuses an over-constraining or redundant constraint or dimension (`VCS_SKETCH_OVER_CONSTRAINTS`, "already has the same dimension"); ours keeps a redundant geometric constraint silently (O1) and a redundant / conflicting dimension as a driven reference (O3). The reverse (ours refuses what Fusion accepts): the hole-radius edits (F2), `perpendicular` / `collinear` / `pointOnLine` placements on a held operand (task 511 for the last two), and the S-curve (N-F7).
3. **Circles.** `equal` on circles is refused in ours (F2) and `tangent` between circles never changes a radius (Fusion resizes the moving circle): both follow from the radius being shape data (O2). FIXED by task 515 (a circle's radius is a solver unknown): equal on circles works and a tangent / point-on-circle can resize a circle. What remains is WHO gives way: ours spreads the correction over every free unknown (least change), so a free radius changes too where Fusion translates the moving circle and keeps its radius (see "After task 515").
4. **The origin** is an operand like any point: in all 2438 graded cells (both pick orders, every point constraint, the levels "end at origin" and "midpoint at origin") it never moved and was never deleted, in Fusion (`sk.originPoint`) and in ours (`j_origin`). Ours has no axis entities, so axis constraints cannot be run in ours.
5. **Fully-constrained flags.** Fusion reports `isFullyConstrained` per entity and for the sketch (no DOF count); they differed from ours mainly on circles (O2, fixed by task 515: the plate's two circle rows now agree) and on fillet arcs; every row is in the per-drawing tables.

The 512 coverage matrix is indexed in `tests/fixtures/fusion-oracle/matrix.json`: 604 classes (constraint / dimension row x kind-pair class x variant sep | shared | locked | dimmed); a representative cell was run in Fusion for 249 of them (how it was picked is in `scripts/fusion-oracle/matrix-index.mjs`); the 355 others are listed with the reason (shared joint outside the line-line rows 122, pair class outside the graded set 108, midpoint of three free points has no Fusion equivalent 64, the point-to-line dimension throws in ours 28, other 33). Kinds skipped in Fusion with the reason: bezier (no equivalent), `equal(arc, circle)` (Fusion's API refuses), concentric / symmetric (not in our constraint list).

### After task 511 (merge of origin/main d703ebb+): differing cells before -> after

Same Fusion answers (data), ours re-run on main after 511 (full-derivative Jacobian, angle pair stored CCW, collinear and point-on-line / circle placed at creation by Fusion's rule, reference angle keeps its flag) and 512's classification fix. Only the rows that changed are listed.

| section | constraint / drawing | differing before | differing after |
|---|---|---|---|
| which-moves (315 cells) | collinear | 6 | 4 |
| which-moves (315 cells) | pointOnCircle | 1 | 0 |
| which-moves (315 cells) | pointOnLine | 1 | 0 |
| graded (2438 cells) | collinear | 74 | 68 |
| graded (2438 cells) | dim-angle | 94 | 93 |
| graded (2438 cells) | pointOnCircle | 89 | 73 |
| graded (2438 cells) | pointOnLine | 81 | 75 |
| drawings (954 rows) | triangle | 12 | 11 |
| TOTAL which-moves | all | 221 | 217 |
| TOTAL graded | all | 1554 | 1525 |
| TOTAL drawings | all | 132 | 131 |

The classes marked "pending task 511" before are now labelled "remaining after task 511" where a difference is left (collinear: which line gives way or a refusal; pointOnLine / pointOnCircle with a held operand); the cells that now agree were removed from the KNOWN files.

### After tasks 517 + 520 (merge of origin/main 9feea55): differing cells before -> after

517 (fillet keeps the origin / works on polygon corners) and 520 (point-to-line dimension is one distance constraint, line-line dimension always positive, perpendicular accepted on exactly parallel lines, the second pick turns +90 deg CCW). The oracle harness never built a point-to-line dimension, so nothing there changed. Only the rows that changed:

| section | constraint / drawing | before | after |
|---|---|---|---|
| graded | collinear | 68 | 69 |
| TOTAL which-moves | all | 217 | 217 |
| TOTAL graded | all | 1525 | 1526 |
| TOTAL drawings | all | 131 | 131 |

### After task 515 (a circle's radius is a solver unknown; merge of origin/main 6da9d8d + task 516): differing cells before -> after

Same Fusion answers (data), ours re-run; the KNOWN files regenerated with `scripts/fusion-oracle/{which-moves,graded,drawings}-known.mjs` (reason texts of the circle groups updated) and the three sections below with the `*-doc.mjs` scripts. No Fusion run. Only the rows that changed:

| section | constraint / drawing | before | after |
|---|---|---|---|
| which-moves | equal-circle-circle | 14 | 6 |
| which-moves | tangent-circle-circle | 14 | 10 |
| which-moves | tangent-line-circle | 10 | 14 |
| which-moves | pointOnCircle | 0 | 1 |
| which-moves | equal-arc-circle | 0 | 2 |
| graded | equal-circle | 20 | 52 |
| graded | tangent-circle-circle | 56 | 44 |
| graded | tangent-line-circle | 92 | 106 |
| graded | pointOnCircle | 73 | 74 |
| drawings | plate | 14 | 12 |
| TOTAL which-moves | all | 217 | 212 |
| TOTAL graded | all | 1526 | 1561 |
| TOTAL drawings | all | 131 | 129 |

Now agree with Fusion (40): which-moves equal-circle-circle 8 (A/B_fixfull, A/B_dim: the free circle takes the held one's radius) and tangent-circle-circle 4 (A/B_fixfull: the free circle resizes); graded tangent-circle-circle 16, pointOnCircle 6, tangent-line-circle 4; plate 2 fully-constrained rows.

Moved AWAY from Fusion (68), two reasons, each a cell that agreed before:
* **Fusion's API refuses `equal(arc, circle)`; ours now accepts it** (34: graded equal-circle 32, all in the circle/arc class OA; which-moves equal-arc-circle free AB/BA 2). Before 515 both refused (ours by F2). The refusal is Fusion's API ("invalid argument value", see "Not covered"), not a sketch rule; ours makes the circle radius equal to the arc's. Owner decides whether to refuse it like Fusion.
* **A free circle radius now also changes (least change), where Fusion keeps the moving circle's radius** (34: graded tangent-line-circle 18, pointOnCircle 7, tangent-circle-circle 4; which-moves tangent-line-circle A_fixfull AB/BA and B_fix1 AB/BA 4, pointOnCircle A_fix1 AB 1). E.g. tangent to a fixed line: Fusion `A:.. B:M.` (the circle translates), ours `A:.. B:Mr` (it translates AND resizes); circle centre fixed: Fusion moves the line, ours moves the line and resizes. Before 515 our radius could not change, so these cells matched by construction. This is the who-moves question (one placement mechanism, task 519): Fusion's rule is "the least-held operand moves, a free radius is kept unless resizing is the only way".

Re-run: `node tests/fusion-oracle.test.js` (offline, a few seconds). Re-record in Fusion: `scripts/fusion-oracle/*` (the runners need a scratch document holding the user parameter `CLAUDE_MARK`; they refuse to run anywhere else).

### After task 521 (a constraint is never satisfied by collapsing a line / arc / circle to a point; merge of origin/main 66d8648): differing cells before -> after

Same Fusion answers, ours re-run, KNOWN files regenerated (`graded-known.mjs`) and the graded section with `graded-doc.mjs`. No Fusion run. Ours used to "satisfy" an impossible constraint by shrinking a line to a point (collinear|LL|6,4: A went from (20,26)-(80,26) to a point); it now refuses, as Fusion does.

| section | all | before | after |
|---|---|---|---|
| TOTAL which-moves | all | 212 | 212 |
| TOTAL graded | all | 1561 | 1549 |
| TOTAL drawings | all | 129 | 129 |

In the other direction, 15 graded cells where Fusion accepts are now refused by ours (our solve's answer there collapsed a shape): coincident-pp RL 0,4 / RO 0,c / RP 0,4; collinear LS 3,0 / 7,0; horizontal-2pt RL 0,4 / RO 0,c / RP 0,4; midpoint LS m,0 / o,0, ZS 0,0; parallel LC 3,4, LL 3,4 / 3,5, SL 0,4; vertical-2pt LR 3,0 (counted in the totals above).

## Which geometry moves

Question (owner): when a constraint is added to geometry that does not satisfy it, which entity moves and which stays? Method: each case starts from
geometry that deliberately does NOT satisfy the constraint, gets a prep (a point or a whole line fixed, H/V, a driving dimension, a shared joint), then
the constraint is added in pick order A-B and B-A. Before / after coordinates (mm) are recorded per entity; "moved" = any point or radius changed by
more than 1e-6 mm in Fusion (1e-4 in ours, the solver's stop tolerance). Every constraint type of `CONSTRAINT_TYPES` plus every dimension mode that
changes geometry is covered: 315 cells. The same scenario list (`tests/harness/fusion-oracle/which-moves.js`) runs in Fusion and through
`ConstraintManager.createConstraint` (dimensions: placed at the measured value, then edited through `commitDimensionEdit`, the UI flow).

Reading the tables: a cell is `A:.M B:MM` = per entity, one character per point (`.` stayed, `M` moved; arcs: centre, start, end; a trailing `r` =
the radius changed). Prep names: `A_fix1` = A's first point fixed, `A_fixfull` = all of A fixed (circle: centre + radius dimension), `A_hv` = A made
horizontal / vertical, `A_dim` = A carries a driving length (radius) dimension, `shared` = B's start is A's end. "refused" = the constraint was not added.

Not covered, and why: `concentric` and `symmetric` are not in `CONSTRAINT_TYPES` (a Fusion-only constraint); the 3-point `midpoint` has no Fusion
equivalent; `equal(arc, circle)` is refused by Fusion's API ("invalid argument value"); a diameter dimension has no creation path in ours; the
point-to-line distance dimension projects a helper joint in ours (not a which-moves question).

Pick order in Fusion's API: `pointOnLine`, `pointOnCircle` and `midpoint` take the point FIRST (curve first is a type error), and ours has no order for
them, so only A-B is run for those rows.

<!-- which-moves:begin -->

Fusion 2706.1.17, recorded 2026-11-11; 315 cells, 286 identical, 29 differ (all KNOWN in tests/fixtures/fusion-oracle/which-moves-known.json). Data: tests/fixtures/fusion-oracle/which-moves.json (before / after coordinates in mm of every entity, per cell).

| constraint / dimension | cells | same as Fusion |
|---|---|---|
| horizontal-line | 6 | 6 |
| vertical-line | 6 | 6 |
| horizontal-2pt | 6 | 6 |
| vertical-2pt | 6 | 6 |
| coincident-pp | 18 | 18 |
| parallel | 20 | 20 |
| perpendicular | 20 | 20 |
| collinear | 20 | 20 |
| equal-line-line | 20 | 19 |
| pointOnLine | 6 | 6 |
| pointOnCircle | 5 | 5 |
| midpoint | 6 | 6 |
| equal-circle-circle | 14 | 14 |
| equal-arc-arc | 14 | 14 |
| equal-arc-circle | 2 | 0 |
| tangent-line-circle | 16 | 16 |
| tangent-line-arc | 16 | 16 |
| tangent-circle-circle | 14 | 14 |
| tangent-arc-arc | 14 | 14 |
| dim-aligned | 18 | 17 |
| dim-horizontal | 18 | 8 |
| dim-vertical | 18 | 8 |
| dim-length | 6 | 3 |
| dim-radius-circle | 4 | 4 |
| dim-radius-arc | 4 | 2 |
| dim-angle | 18 | 18 |

#### horizontal-line  (6 of 6 cells the same)

Fusion's rule: The unpinned end(s) move; a free line rotates about its midpoint (length kept); a pinned end stays; already horizontal or fully fixed is refused.

Verdict: SAME.

| variant | A Fusion | A ours | A same |
|---|---|---|---|
| free | A:MM | A:MM | yes |
| A_fix1 | A:.M | A:.M | yes |
| A_fix2 | A:M. | A:M. | yes |
| A_fixfull | refused | refused | yes |
| A_hv | refused | refused | yes |
| A_dim | A:MM | A:MM | yes |

#### vertical-line  (6 of 6 cells the same)

Fusion's rule: As horizontal: the unpinned end(s) move, a free line rotates about its midpoint, a pinned end stays.

Verdict: SAME.

| variant | A Fusion | A ours | A same |
|---|---|---|---|
| free | A:MM | A:MM | yes |
| A_fix1 | A:.M | A:.M | yes |
| A_fix2 | A:M. | A:M. | yes |
| A_fixfull | refused | refused | yes |
| A_hv | refused | refused | yes |
| A_dim | A:MM | A:MM | yes |

#### horizontal-2pt  (6 of 6 cells the same)

Fusion's rule: The FIRST-picked point stays and the SECOND is moved onto its row; a fixed point always stays.

Verdict: FUSION DIFFERENT BY DESIGN (ours: both points meet in the middle; pick order has no effect).

Proposed fix: createConstraint, placeForCreation (the task 511 hook): for horizontal / vertical with two joints, set the second-picked joint's y (x) to the first's before the solve, unless the second is fixed (then move the first). The solver row stays as it is.

| variant | AB Fusion | AB ours | AB same | BA Fusion | BA ours | BA same |
|---|---|---|---|---|---|---|
| free | A:. B:M | A:. B:M | yes | A:M B:. | A:M B:. | yes |
| A_fix1 | A:. B:M | A:. B:M | yes | A:. B:M | A:. B:M | yes |
| B_fix1 | A:M B:. | A:M B:. | yes | A:M B:. | A:M B:. | yes |

#### vertical-2pt  (6 of 6 cells the same)

Fusion's rule: As horizontal (2 points): the first-picked point stays, the second moves onto its column.

Verdict: FUSION DIFFERENT BY DESIGN.

Proposed fix: Same hook as horizontal-2pt.

| variant | AB Fusion | AB ours | AB same | BA Fusion | BA ours | BA same |
|---|---|---|---|---|---|---|
| free | A:. B:M | A:. B:M | yes | A:M B:. | A:M B:. | yes |
| A_fix1 | A:. B:M | A:. B:M | yes | A:. B:M | A:. B:M | yes |
| B_fix1 | A:M B:. | A:M B:. | yes | A:M B:. | A:M B:. | yes |

#### coincident-pp  (18 of 18 cells the same)

Fusion's rule: The FIRST-picked point's line stays and the whole SECOND line is TRANSLATED (length and direction kept) so its point lands on the first; a line with one pinned end stretches its free end to the other point instead; a fixed or dimensioned line stays whichever order.

Verdict: FUSION DIFFERENT BY DESIGN (ours moves only the second picked joint, in BOTH orders: the line is stretched / rotated, and the pick order is ignored).

Proposed fix: placeForCreation: translate the second-picked joint's whole line (both endpoints) by the gap vector, instead of moving that one joint (the rubber-band that changes the line's length). Needs "which line owns the joint": shape.joints lookup. Pick order must reach createConstraint (the Coincident tool already passes it).

| variant | AB Fusion | AB ours | AB same | BA Fusion | BA ours | BA same |
|---|---|---|---|---|---|---|
| free | A:.. B:MM | A:.. B:MM | yes | A:MM B:.. | A:MM B:.. | yes |
| A_fix1 | A:.M B:.. | A:.M B:.. | yes | A:.M B:.. | A:.M B:.. | yes |
| A_fixfull | A:.. B:MM | A:.. B:MM | yes | A:.. B:MM | A:.. B:MM | yes |
| A_hv | A:.. B:MM | A:.. B:MM | yes | A:MM B:.. | A:MM B:.. | yes |
| A_dim | A:.. B:MM | A:.. B:MM | yes | A:.. B:MM | A:.. B:MM | yes |
| B_fix1 | A:MM B:.. | A:MM B:.. | yes | A:MM B:.. | A:MM B:.. | yes |
| B_fixfull | A:MM B:.. | A:MM B:.. | yes | A:MM B:.. | A:MM B:.. | yes |
| B_hv | A:.. B:MM | A:.. B:MM | yes | A:MM B:.. | A:MM B:.. | yes |
| B_dim | A:MM B:.. | A:MM B:.. | yes | A:MM B:.. | A:MM B:.. | yes |

#### parallel  (20 of 20 cells the same)

Fusion's rule: The FIRST-picked line stays and the SECOND rotates about its own midpoint (length kept); a line with one pinned end pivots about it (and the other stays); a fully fixed, H/V-constrained or dimensioned line stays whichever order; with a shared joint the SECOND picked pivots about it.

Verdict: FUSION DIFFERENT BY DESIGN (ours: both lines rotate, always).

Proposed fix: Done in task 525: placeForCreation reads the who-moves table (packages/core/creation-placement-table.js, fitted to these cells) and turns the giving line about its held point, else its single attached end, else its midpoint. The solver row is untouched.

| variant | AB Fusion | AB ours | AB same | BA Fusion | BA ours | BA same |
|---|---|---|---|---|---|---|
| free | A:.. B:MM | A:.. B:MM | yes | A:MM B:.. | A:MM B:.. | yes |
| A_fix1 | A:.M B:.. | A:.M B:.. | yes | A:.M B:.. | A:.M B:.. | yes |
| A_fixfull | A:.. B:MM | A:.. B:MM | yes | A:.. B:MM | A:.. B:MM | yes |
| A_hv | A:.. B:MM | A:.. B:MM | yes | A:.. B:MM | A:.. B:MM | yes |
| A_dim | A:.. B:MM | A:.. B:MM | yes | A:.. B:MM | A:.. B:MM | yes |
| B_fix1 | A:.. B:.M | A:.. B:.M | yes | A:.. B:.M | A:.. B:.M | yes |
| B_fixfull | A:MM B:.. | A:MM B:.. | yes | A:MM B:.. | A:MM B:.. | yes |
| B_hv | A:MM B:.. | A:MM B:.. | yes | A:MM B:.. | A:MM B:.. | yes |
| B_dim | A:MM B:.. | A:MM B:.. | yes | A:MM B:.. | A:MM B:.. | yes |
| shared | A:.. B:.M | A:.. B:.M | yes | A:M. B:.. | A:M. B:.. | yes |

#### perpendicular  (20 of 20 cells the same)

Fusion's rule: Same as parallel: the first-picked line stays, the second rotates about its midpoint (shared joint: about the joint); pinned end pivots; fixed / H-V / dimensioned lines stay.

Verdict: FUSION DIFFERENT BY DESIGN.

Proposed fix: Same hook as parallel (target direction = first line rotated 90 degrees, branch from the existing lockPerpendicularBranch).

| variant | AB Fusion | AB ours | AB same | BA Fusion | BA ours | BA same |
|---|---|---|---|---|---|---|
| free | A:.. B:MM | A:.. B:MM | yes | A:MM B:.. | A:MM B:.. | yes |
| A_fix1 | A:.M B:.. | A:.M B:.. | yes | A:.M B:.. | A:.M B:.. | yes |
| A_fixfull | A:.. B:MM | A:.. B:MM | yes | A:.. B:MM | A:.. B:MM | yes |
| A_hv | A:.. B:MM | A:.. B:MM | yes | A:.. B:MM | A:.. B:MM | yes |
| A_dim | A:.. B:MM | A:.. B:MM | yes | A:.. B:MM | A:.. B:MM | yes |
| B_fix1 | A:.. B:.M | A:.. B:.M | yes | A:.. B:.M | A:.. B:.M | yes |
| B_fixfull | A:MM B:.. | A:MM B:.. | yes | A:MM B:.. | A:MM B:.. | yes |
| B_hv | A:MM B:.. | A:MM B:.. | yes | A:MM B:.. | A:MM B:.. | yes |
| B_dim | A:MM B:.. | A:MM B:.. | yes | A:MM B:.. | A:MM B:.. | yes |
| shared | A:.. B:.M | A:.. B:.M | yes | A:M. B:.. | A:M. B:.. | yes |

#### collinear  (20 of 20 cells the same)

Fusion's rule: The FIRST-picked line stays, the second lands on it; a fixed, H/V-constrained or dimensioned line stays whichever order.

Verdict: AFTER TASK 511: most cells agree; the remaining differences are listed in the table.

| variant | AB Fusion | AB ours | AB same | BA Fusion | BA ours | BA same |
|---|---|---|---|---|---|---|
| free | A:.. B:MM | A:.. B:MM | yes | A:MM B:.. | A:MM B:.. | yes |
| A_fix1 | A:.. B:MM | A:.. B:MM | yes | A:.. B:MM | A:.. B:MM | yes |
| A_fixfull | A:.. B:MM | A:.. B:MM | yes | A:.. B:MM | A:.. B:MM | yes |
| A_hv | A:.. B:MM | A:.. B:MM | yes | A:.. B:MM | A:.. B:MM | yes |
| A_dim | A:.. B:MM | A:.. B:MM | yes | A:.. B:MM | A:.. B:MM | yes |
| B_fix1 | A:MM B:.. | A:MM B:.. | yes | A:MM B:.. | A:MM B:.. | yes |
| B_fixfull | A:MM B:.. | A:MM B:.. | yes | A:MM B:.. | A:MM B:.. | yes |
| B_hv | A:MM B:.. | A:MM B:.. | yes | A:MM B:.. | A:MM B:.. | yes |
| B_dim | A:MM B:.. | A:MM B:.. | yes | A:MM B:.. | A:MM B:.. | yes |
| shared | A:.. B:.M | A:.. B:.M | yes | A:M. B:.. | A:M. B:.. | yes |

#### equal-line-line  (19 of 20 cells the same)

Fusion's rule: The FIRST-picked line stays and the SECOND keeps its START point and direction and only changes length (its last end slides along its own line); a fixed or dimensioned line stays; a pinned end is the end that stays.

Verdict: FUSION DIFFERENT BY DESIGN (ours: both lines change length and direction).

Proposed fix: placeForCreation: set the second line's length to the first's by moving its END joint along its own direction (the unpinned end, else the second joint). Keeps direction; ours currently rotates and resizes both lines.

| variant | AB Fusion | AB ours | AB same | BA Fusion | BA ours | BA same |
|---|---|---|---|---|---|---|
| free | A:.. B:.M | A:.. B:.M | yes | A:.M B:.. | A:.M B:.. | yes |
| A_fix1 | A:.. B:.M | A:.. B:.M | yes | A:.M B:.. | A:.M B:.. | yes |
| A_fixfull | A:.. B:.M | A:.. B:.M | yes | A:.. B:.M | A:.. B:.M | yes |
| A_hv | A:.. B:.M | A:.. B:.M | yes | A:.. B:.M | A:.. B:.M | yes |
| A_dim | A:.. B:.M | A:.. B:.M | yes | A:.. B:.M | A:.. B:.M | yes |
| B_fix1 | A:.. B:.M | A:.. B:.M | yes | A:.M B:.. | A:.M B:.. | yes |
| B_fixfull | A:.M B:.. | A:.M B:.. | yes | A:.M B:.. | A:.M B:.. | yes |
| B_hv | A:.M B:.. | A:.M B:.. | yes | A:.M B:.. | A:.M B:.. | yes |
| B_dim | A:.M B:.. | A:.M B:.. | yes | A:.M B:.. | A:.M B:.. | yes |
| shared | A:.. B:.M | A:.. B:.M | yes | A:MM B:M. | A:M. B:.. | **NO** |

#### pointOnLine  (6 of 6 cells the same)

Fusion's rule: The point moves onto the line and the line stays; only when the point is fixed does the line move (translated). (Fusion's API wants the point first.)

Verdict: AFTER TASK 511: agrees except the cells marked NO.

| variant | AB Fusion | AB ours | AB same |
|---|---|---|---|
| free | A:M B:.. | A:M B:.. | yes |
| A_fix1 | A:. B:MM | A:. B:MM | yes |
| B_fix1 | A:M B:.. | A:M B:.. | yes |
| B_fixfull | A:M B:.. | A:M B:.. | yes |
| B_hv | A:M B:.. | A:M B:.. | yes |
| B_dim | A:M B:.. | A:M B:.. | yes |

#### pointOnCircle  (5 of 5 cells the same)

Fusion's rule: The point moves radially onto the rim; the circle stays; a fixed point moves the circle instead.

Verdict: AFTER TASK 511: agrees except the cells marked NO.

| variant | AB Fusion | AB ours | AB same |
|---|---|---|---|
| free | A:M B:.. | A:M B:.. | yes |
| A_fix1 | A:. B:M. | A:. B:M. | yes |
| B_fix1 | A:M B:.. | A:M B:.. | yes |
| B_fixfull | A:M B:.. | A:M B:.. | yes |
| B_dim | A:M B:.. | A:M B:.. | yes |

#### midpoint  (6 of 6 cells the same)

Fusion's rule: The point moves to the midpoint and the line stays; only a fixed point moves the line (translated).

Verdict: FUSION DIFFERENT BY DESIGN (ours also moves the line when the point is free).

Proposed fix: createConstraint, placeForCreation: move the free point to the midpoint before the solve; the solver row stays as it is, but its Jacobian must not move the line while the point is free (use the same one-sided option pointOnLine had: `mutual` off unless the point is fixed). Today the line's two ends move too.

| variant | AB Fusion | AB ours | AB same |
|---|---|---|---|
| free | A:M B:.. | A:M B:.. | yes |
| A_fix1 | A:. B:MM | A:. B:MM | yes |
| B_fix1 | A:M B:.. | A:M B:.. | yes |
| B_fixfull | A:M B:.. | A:M B:.. | yes |
| B_hv | A:M B:.. | A:M B:.. | yes |
| B_dim | A:M B:.. | A:M B:.. | yes |

#### equal-circle-circle  (14 of 14 cells the same)

Fusion's rule: The SECOND-picked circle is resized (its centre stays); a circle with a driving radius or fully fixed stays; a circle with a fixed centre is the one that resizes, even when picked first.

Verdict: OUR BUG (F2): refused.

Proposed fix: OUR BUG F2 (docs/CONSTRAINT-AUDIT.md): the radius is shape data, not a solver unknown; nothing to place until the radius is a DOF (task 510 / the O2 decision). Not a createConstraint fix.

| variant | AB Fusion | AB ours | AB same | BA Fusion | BA ours | BA same |
|---|---|---|---|---|---|---|
| free | A:.. B:.r | A:.. B:.r | yes | A:.r B:.. | A:.r B:.. | yes |
| A_fix1 | A:.r B:.. | A:.r B:.. | yes | A:.r B:.. | A:.r B:.. | yes |
| A_fixfull | A:.. B:.r | A:.. B:.r | yes | A:.. B:.r | A:.. B:.r | yes |
| A_dim | A:.. B:.r | A:.. B:.r | yes | A:.. B:.r | A:.. B:.r | yes |
| B_fix1 | A:.. B:.r | A:.. B:.r | yes | A:.. B:.r | A:.. B:.r | yes |
| B_fixfull | A:.r B:.. | A:.r B:.. | yes | A:.r B:.. | A:.r B:.. | yes |
| B_dim | A:.r B:.. | A:.r B:.. | yes | A:.r B:.. | A:.r B:.. | yes |

#### equal-arc-arc  (14 of 14 cells the same)

Fusion's rule: The SECOND-picked arc is re-sized (centre, ends and radius all move); the first stays; an arc with a pinned centre is the one that resizes (even when first); a fully fixed or radius-dimensioned arc stays.

Verdict: FUSION DIFFERENT BY DESIGN (ours moves both arcs).

Proposed fix: The arc has real joints, so the solver can do it; the change is the anchor choice (first picked stays, the arc with a pinned centre or a radius dimension is held) in the same placeForCreation hook. Fusion moves the whole second arc (centre too), not only its radius.

| variant | AB Fusion | AB ours | AB same | BA Fusion | BA ours | BA same |
|---|---|---|---|---|---|---|
| free | A:.... B:MMMr | A:.... B:MMMr | yes | A:MMMr B:.... | A:MMMr B:.... | yes |
| A_fix1 | A:.MMr B:.... | A:.MMr B:.... | yes | A:.MMr B:.... | A:.MMr B:.... | yes |
| A_fixfull | A:.... B:MMMr | A:.... B:MMMr | yes | A:.... B:MMMr | A:.... B:MMMr | yes |
| A_dim | A:.... B:MMMr | A:.... B:MMMr | yes | A:.... B:MMMr | A:.... B:MMMr | yes |
| B_fix1 | A:.... B:.MMr | A:.... B:.MMr | yes | A:.... B:.MMr | A:.... B:.MMr | yes |
| B_fixfull | A:MMMr B:.... | A:MMMr B:.... | yes | A:MMMr B:.... | A:MMMr B:.... | yes |
| B_dim | A:MMMr B:.... | A:MMMr B:.... | yes | A:MMMr B:.... | A:MMMr B:.... | yes |

#### equal-arc-circle  (0 of 2 cells the same)

Fusion's rule: Fusion's API REFUSES equal(arc, circle) with "invalid argument value" (the interactive tool may differ; not measurable through the API).

Verdict: SAME (both refuse) - ours refuses for the F2 reason, Fusion for an API reason: do not read it as agreement.

| variant | AB Fusion | AB ours | AB same | BA Fusion | BA ours | BA same |
|---|---|---|---|---|---|---|
| free | refused | A:.... B:.r | **NO** | refused | A:MMMr B:.. | **NO** |

#### tangent-line-circle  (16 of 16 cells the same)

Fusion's rule: The LINE moves (rotates and translates; pick order is irrelevant) and the circle stays; a pinned or fixed line stays and the circle's centre moves; a circle with a dimensioned radius moves its centre while the line stays.

Verdict: FUSION DIFFERENT BY DESIGN (ours moves both).

Proposed fix: placeForCreation: move the line (never the circle) onto tangency, nearest side, unless the line is pinned (then move the circle centre) or the circle's radius is dimensioned. Ours moves both the line and the circle centre.

| variant | AB Fusion | AB ours | AB same | BA Fusion | BA ours | BA same |
|---|---|---|---|---|---|---|
| free | A:MM B:.. | A:MM B:.. | yes | A:MM B:.. | A:MM B:.. | yes |
| A_fix1 | A:.. B:M. | A:.. B:M. | yes | A:.. B:M. | A:.. B:M. | yes |
| A_fixfull | A:.. B:M. | A:.. B:M. | yes | A:.. B:M. | A:.. B:M. | yes |
| A_hv | A:MM B:.. | A:MM B:.. | yes | A:MM B:.. | A:MM B:.. | yes |
| A_dim | A:MM B:.. | A:MM B:.. | yes | A:MM B:.. | A:MM B:.. | yes |
| B_fix1 | A:MM B:.. | A:MM B:.. | yes | A:MM B:.. | A:MM B:.. | yes |
| B_fixfull | A:MM B:.. | A:MM B:.. | yes | A:MM B:.. | A:MM B:.. | yes |
| B_dim | A:.. B:M. | A:.. B:M. | yes | A:.. B:M. | A:.. B:M. | yes |

#### tangent-line-arc  (16 of 16 cells the same)

Fusion's rule: The LINE moves and the arc stays (even with a dimensioned radius); a pinned or fixed line stays and the whole arc is translated.

Verdict: FUSION DIFFERENT BY DESIGN (ours moves both, and re-sizes the arc).

Proposed fix: Same hook as tangent-line-circle. Ours also changes the arc's radius and all three points.

| variant | AB Fusion | AB ours | AB same | BA Fusion | BA ours | BA same |
|---|---|---|---|---|---|---|
| free | A:MM B:.... | A:MM B:.... | yes | A:MM B:.... | A:MM B:.... | yes |
| A_fix1 | A:.. B:MMM. | A:.. B:MMM. | yes | A:.. B:MMM. | A:.. B:MMM. | yes |
| A_fixfull | A:.. B:MMM. | A:.. B:MMM. | yes | A:.. B:MMM. | A:.. B:MMM. | yes |
| A_hv | A:MM B:.... | A:MM B:.... | yes | A:MM B:.... | A:MM B:.... | yes |
| A_dim | A:MM B:.... | A:MM B:.... | yes | A:MM B:.... | A:MM B:.... | yes |
| B_fix1 | A:MM B:.... | A:MM B:.... | yes | A:MM B:.... | A:MM B:.... | yes |
| B_fixfull | A:MM B:.... | A:MM B:.... | yes | A:MM B:.... | A:MM B:.... | yes |
| B_dim | A:MM B:.... | A:MM B:.... | yes | A:MM B:.... | A:MM B:.... | yes |

#### tangent-circle-circle  (14 of 14 cells the same)

Fusion's rule: The SECOND-picked circle moves AND is re-sized (centre and radius); the first stays; a circle with a dimensioned radius or fixed centre keeps its radius, so the other circle's centre absorbs the change.

Verdict: FUSION DIFFERENT BY DESIGN, tied to the open O2 question (circle radius as a DOF).

Proposed fix: Not a createConstraint fix: our circle radius is shape data (O2 / F2). Ours moves both centres and never touches a radius.

| variant | AB Fusion | AB ours | AB same | BA Fusion | BA ours | BA same |
|---|---|---|---|---|---|---|
| free | A:.. B:Mr | A:.. B:Mr | yes | A:Mr B:.. | A:Mr B:.. | yes |
| A_fix1 | A:.. B:Mr | A:.. B:Mr | yes | A:.r B:.. | A:.r B:.. | yes |
| A_fixfull | A:.. B:Mr | A:.. B:Mr | yes | A:.. B:Mr | A:.. B:Mr | yes |
| A_dim | A:M. B:.. | A:M. B:.. | yes | A:M. B:.. | A:M. B:.. | yes |
| B_fix1 | A:.. B:.r | A:.. B:.r | yes | A:Mr B:.. | A:Mr B:.. | yes |
| B_fixfull | A:Mr B:.. | A:Mr B:.. | yes | A:Mr B:.. | A:Mr B:.. | yes |
| B_dim | A:.. B:M. | A:.. B:M. | yes | A:.. B:M. | A:.. B:M. | yes |

#### tangent-arc-arc  (14 of 14 cells the same)

Fusion's rule: The SECOND-picked arc moves and re-sizes (3 points + radius); the first stays; a pinned centre makes that arc the one that changes; fixed / radius-dimensioned arcs stay.

Verdict: FUSION DIFFERENT BY DESIGN (ours moves both).

Proposed fix: Same anchor choice as equal-arc-arc.

| variant | AB Fusion | AB ours | AB same | BA Fusion | BA ours | BA same |
|---|---|---|---|---|---|---|
| free | A:.... B:MMMr | A:.... B:MMMr | yes | A:MMMr B:.... | A:MMMr B:.... | yes |
| A_fix1 | A:.... B:MMMr | A:.... B:MMMr | yes | A:.MMr B:.... | A:.MMr B:.... | yes |
| A_fixfull | A:.... B:MMMr | A:.... B:MMMr | yes | A:.... B:MMMr | A:.... B:MMMr | yes |
| A_dim | A:MMM. B:.... | A:MMM. B:.... | yes | A:MMM. B:.... | A:MMM. B:.... | yes |
| B_fix1 | A:.... B:.MMr | A:.... B:.MMr | yes | A:MMMr B:.... | A:MMMr B:.... | yes |
| B_fixfull | A:MMMr B:.... | A:MMMr B:.... | yes | A:MMMr B:.... | A:MMMr B:.... | yes |
| B_dim | A:.... B:MMM. | A:.... B:MMM. | yes | A:.... B:MMM. | A:.... B:MMM. | yes |

#### dim-aligned  (17 of 18 cells the same)

Fusion's rule: Pick order is IGNORED: the unconstrained line (the later-created one when both are free) is TRANSLATED whole to the new distance; a fixed, H/V or dimensioned line stays.

Verdict: FUSION DIFFERENT BY DESIGN.

Proposed fix: The edit path (commitDimensionEdit, packages/ui/dimension-seams.js): before the solve translate the whole line that owns the unconstrained joint along the measured direction. Ours moves just the two dimension points.

| variant | AB Fusion | AB ours | AB same | BA Fusion | BA ours | BA same |
|---|---|---|---|---|---|---|
| free | A:.. B:MM | A:.. B:MM | yes | A:.. B:MM | A:MM B:.. | **NO** |
| A_fix1 | A:.. B:MM | A:.. B:MM | yes | A:.. B:MM | A:.. B:MM | yes |
| A_fixfull | A:.. B:MM | A:.. B:MM | yes | A:.. B:MM | A:.. B:MM | yes |
| A_hv | A:.. B:MM | A:.. B:MM | yes | A:.. B:MM | A:.. B:MM | yes |
| A_dim | A:.. B:MM | A:.. B:MM | yes | A:.. B:MM | A:.. B:MM | yes |
| B_fix1 | A:MM B:.. | A:MM B:.. | yes | A:MM B:.. | A:MM B:.. | yes |
| B_fixfull | A:MM B:.. | A:MM B:.. | yes | A:MM B:.. | A:MM B:.. | yes |
| B_hv | A:MM B:.. | A:MM B:.. | yes | A:MM B:.. | A:MM B:.. | yes |
| B_dim | A:MM B:.. | A:MM B:.. | yes | A:MM B:.. | A:MM B:.. | yes |

#### dim-horizontal  (8 of 18 cells the same)

Fusion's rule: The FIRST-picked point moves (along x only, nothing else) and the second stays; when the first-picked point is on a fixed line, the SECOND line is translated; when the second point is pinned or its line is fixed / dimensioned, the first moves (its line translates if the first-picked point is itself pinned).

Verdict: FUSION DIFFERENT BY DESIGN (ours: first picked is the anchor, Fusion: it is the one that moves).

Proposed fix: commitDimensionEdit: move the first-picked joint only, along the dimension axis. Ours moves the second point and (when held) the first.

| variant | AB Fusion | AB ours | AB same | BA Fusion | BA ours | BA same |
|---|---|---|---|---|---|---|
| free | A:.M B:.. | A:MM B:.. | **NO** | A:.. B:M. | A:.. B:MM | **NO** |
| A_fix1 | A:.M B:.. | A:.M B:.. | yes | A:.. B:M. | A:.. B:MM | **NO** |
| A_fixfull | A:.. B:MM | A:.. B:MM | yes | A:.. B:M. | A:.. B:MM | **NO** |
| A_hv | A:MM B:.. | A:MM B:.. | yes | A:.. B:M. | A:.. B:MM | **NO** |
| A_dim | A:MM B:.. | A:MM B:.. | yes | A:.. B:M. | A:.. B:MM | **NO** |
| B_fix1 | A:.M B:.. | A:MM B:.. | **NO** | A:MM B:.. | A:MM B:.. | yes |
| B_fixfull | A:.M B:.. | A:MM B:.. | **NO** | A:MM B:.. | A:MM B:.. | yes |
| B_hv | A:.M B:.. | A:MM B:.. | **NO** | A:.. B:MM | A:.. B:MM | yes |
| B_dim | A:.M B:.. | A:MM B:.. | **NO** | A:.. B:MM | A:.. B:MM | yes |

#### dim-vertical  (8 of 18 cells the same)

Fusion's rule: As horizontal dimension: the first-picked point moves (along y only), the second stays.

Verdict: FUSION DIFFERENT BY DESIGN.

Proposed fix: Same as dim-horizontal.

| variant | AB Fusion | AB ours | AB same | BA Fusion | BA ours | BA same |
|---|---|---|---|---|---|---|
| free | A:.M B:.. | A:MM B:.. | **NO** | A:.. B:M. | A:.. B:MM | **NO** |
| A_fix1 | A:.M B:.. | A:.M B:.. | yes | A:.. B:M. | A:.. B:MM | **NO** |
| A_fixfull | A:.. B:MM | A:.. B:MM | yes | A:.. B:M. | A:.. B:MM | **NO** |
| A_hv | A:MM B:.. | A:MM B:.. | yes | A:.. B:M. | A:.. B:MM | **NO** |
| A_dim | A:MM B:.. | A:MM B:.. | yes | A:.. B:M. | A:.. B:MM | **NO** |
| B_fix1 | A:.M B:.. | A:MM B:.. | **NO** | A:MM B:.. | A:MM B:.. | yes |
| B_fixfull | A:.M B:.. | A:MM B:.. | **NO** | A:MM B:.. | A:MM B:.. | yes |
| B_hv | A:.M B:.. | A:MM B:.. | **NO** | A:.. B:MM | A:.. B:MM | yes |
| B_dim | A:.M B:.. | A:MM B:.. | **NO** | A:.. B:MM | A:.. B:MM | yes |

#### dim-length  (3 of 6 cells the same)

Fusion's rule: The START end stays and the END slides along the line (direction kept); a pinned end stays; fully fixed or already dimensioned is refused ("over constrained" / "already has the same dimension").

Verdict: FUSION DIFFERENT BY DESIGN; the fully-fixed case is a leniency in ours (kept as a reference, no error).

Proposed fix: commitDimensionEdit: for a lone line length keep joints[0], move joints[1]. Ours moves both ends (the line grows about its midpoint). Also ours ACCEPTS a length on a fully fixed line as a reference instead of refusing.

| variant | A Fusion | A ours | A same |
|---|---|---|---|
| free | A:.M | A:MM | **NO** |
| A_fix1 | A:.M | A:.M | yes |
| A_fix2 | A:M. | A:M. | yes |
| A_fixfull | refused | A:.. (reference) | **NO** |
| A_hv | A:.M | A:MM | **NO** |
| A_dim | refused | refused | yes |

#### dim-radius-circle  (4 of 4 cells the same)

Fusion's rule: The radius changes, the centre stays.

Verdict: SAME.

| variant | A Fusion | A ours | A same |
|---|---|---|---|
| free | A:.r | A:.r | yes |
| A_fix1 | A:.r | A:.r | yes |
| A_fixfull | refused | refused | yes |
| A_dim | refused | refused | yes |

#### dim-radius-arc  (2 of 4 cells the same)

Fusion's rule: The arc's centre stays and its two ends move (radius changes); a pinned centre is the same.

Verdict: FUSION DIFFERENT BY DESIGN.

Proposed fix: commitDimensionEdit: keep the arc centre fixed on a free arc. Ours moves the centre too when the arc is free.

| variant | A Fusion | A ours | A same |
|---|---|---|---|
| free | A:.MMr | A:MMMr | **NO** |
| A_fix1 | A:.MMr | A:.MMr | yes |
| A_fixfull | refused | A:.... (reference) | **NO** |
| A_dim | refused | refused | yes |

#### dim-angle  (18 of 18 cells the same)

Fusion's rule: The FIRST-picked line stays and the SECOND rotates about its midpoint (length kept); a fixed / H-V / dimensioned line stays whichever order; a pinned end pivots.

Verdict: FUSION DIFFERENT BY DESIGN (ours: both rotate).

Proposed fix: commitDimensionEdit: rotate the second line about its midpoint onto the new angle, anchor chosen like parallel. Ours rotates both lines.

| variant | AB Fusion | AB ours | AB same | BA Fusion | BA ours | BA same |
|---|---|---|---|---|---|---|
| free | A:.. B:MM | A:.. B:MM | yes | A:.. B:MM | A:.. B:MM | yes |
| A_fix1 | A:.. B:MM | A:.. B:MM | yes | A:.. B:MM | A:.. B:MM | yes |
| A_fixfull | A:.. B:MM | A:.. B:MM | yes | A:.. B:MM | A:.. B:MM | yes |
| A_hv | A:.. B:MM | A:.. B:MM | yes | A:.. B:MM | A:.. B:MM | yes |
| A_dim | A:.. B:MM | A:.. B:MM | yes | A:.. B:MM | A:.. B:MM | yes |
| B_fix1 | A:MM B:.. | A:MM B:.. | yes | A:MM B:.. | A:MM B:.. | yes |
| B_fixfull | A:MM B:.. | A:MM B:.. | yes | A:MM B:.. | A:MM B:.. | yes |
| B_hv | A:MM B:.. | A:MM B:.. | yes | A:MM B:.. | A:MM B:.. | yes |
| B_dim | A:MM B:.. | A:MM B:.. | yes | A:MM B:.. | A:MM B:.. | yes |

<!-- which-moves:end -->

## Which geometry moves: graded

<!-- graded:begin -->

Fusion 2706.1.17, recorded 2026-11-11. 2438 cells; data `tests/fixtures/fusion-oracle/which-moves-graded.json` (positions before / after in mm, per cell), known differences `which-moves-graded-known.json` (per class: constraint x kind pair; "all" when the whole class differs). The cells are built by `tests/harness/fusion-oracle/graded.js` with the matrix builders (rect tool, polygon tool, fillet tool, arc, circle), the level applied with real constraints, then replayed in Fusion by `scripts/fusion-oracle/run-jobs.py`.

**How to read it.** A = the FIRST pick, B = the SECOND pick (so pick order is the row / column order). Levels of a free-standing line: `0` free, `1` one end coincident with another free line (a chain), `2` length dimension, `3` H or V, `4` one end fixed, `5` end fixed + length, `6` H/V + end fixed, `7` fully constrained by constraints and dimensions only (H/V + length + the two position dimensions from the origin), `o` one end coincident with the origin, `m` midpoint at the origin. Rect side: `0`, `8` the whole rectangle fully constrained by dimensions. Polygon side: `0`. Construction line: `0`, `4`. Circle / arc: `0`, `c` centre fixed, `r` radius dimension, `cr` both; fillet arc: `0`, `c`. Point: `0`, `4` fixed. Origin (`Z`): the origin point. Cell symbol: `a` only the first pick moves, `b` only the second, `X` both, `-` neither, `R` refused. `Fusion/ours`; a trailing `*` = they differ.

**Reductions (the full cross product is about 40 000 cells).** Line-line groups: free-standing line x free-standing line at the 8 levels (10 with `o`, `m` in the point groups), every other line-like kind (construction line `C`, polygon side `S`, rect side `R`) only against a plain line and against itself, at 2 levels (S: 1). A plain line against a non-line operand: levels 0, 3, 4, 7. Point groups: points of a line (end), rect corner, circle / arc centre, free point and the origin; the compound kinds only free. Not covered: bezier (not constrainable in ours: its endpoints are plain joints, covered as points; Fusion cannot express our cubic), polygon side and fillet arc beyond level 0 / `c`, B-kinds crossed with each other beyond the listed pairs, the point-to-line distance dimension (ours projects a helper joint: finding NEW-1), diameter dimension (no creation path), concentric (not in `CONSTRAINT_TYPES`; a coincident of two centres is the same cell). Fusion exposes no DOF count, only `isFullyConstrained` per entity and per sketch: the DOF before / after is therefore **not** recorded for Fusion (ours: nullity, see the 512 matrix).

| constraint / dimension | cells | same as Fusion | Fusion refuses, ours accepts | ours refuses, Fusion accepts |
|---|---|---|---|---|
| parallel | 113 | 90 | 21 | 0 |
| perpendicular | 113 | 74 | 0 | 0 |
| collinear | 113 | 98 | 3 | 0 |
| equal-line-line | 113 | 112 | 0 | 0 |
| dim-angle | 113 | 78 | 21 | 0 |
| coincident-pp | 232 | 229 | 0 | 0 |
| dim-aligned | 232 | 113 | 48 | 0 |
| dim-horizontal | 157 | 93 | 28 | 0 |
| dim-vertical | 157 | 89 | 30 | 0 |
| horizontal-2pt | 157 | 153 | 2 | 0 |
| vertical-2pt | 157 | 155 | 2 | 0 |
| pointOnLine | 117 | 117 | 0 | 0 |
| pointOnCircle | 130 | 122 | 4 | 0 |
| midpoint | 117 | 117 | 0 | 0 |
| equal-circle | 100 | 52 | 44 | 0 |
| tangent-line-circle | 180 | 168 | 0 | 0 |
| tangent-circle-circle | 100 | 100 | 0 | 0 |
| horizontal-line | 9 | 7 | 0 | 0 |
| vertical-line | 9 | 7 | 0 | 0 |
| dim-length | 9 | 5 | 1 | 0 |
| dim-radius | 10 | 9 | 0 | 0 |

**One rule per constraint** (line x line, Fusion). Rank the 8 (10) levels of the operands; the operand with the LOWER rank is the one that moves, a tie means the SECOND pick moves. Ranks are not DOF counts: a line with one end fixed (4) is the first to give way (it pivots about the fixed end), then the free-ish ones, direction-held lines (H/V, full) always stay.

| constraint | rank order (lowest moves first) | cells predicted | contradicting cells |
|---|---|---|---|
| parallel | {4} < {0,1,5} < {2} < {3,6,7} | 55/55 | - |
| perpendicular | {4} < {0,1,5} < {2} < {3,6,7} | 55/55 | - |
| collinear | {0} < {2} < {1,3,5} < {4,6,7} | 39/39 | - |
| equal-line-line | {0,4} < {3,6} < {1} < {2,5,7} | 55/55 | - |
| dim-angle | {0,1} < {2,4} < {5} < {3,6,7} | 54/55 | dim-angle|LL|2,4 |
| coincident-pp | {0,m} < {2,3} < {1} < {4,5,6,7,o} | 73/73 | - |
| dim-aligned | {0,2} < {1,m} < {3} < {4,5,6,7,o} | 73/75 | dim-aligned|LL|0,2, dim-aligned|LL|1,m |
| dim-horizontal | {0} < {3} < {2} < {4,7} | 16/21 | dim-horizontal|LL|0,0, dim-horizontal|LL|2,0, dim-horizontal|LL|2,2, dim-horizontal|LL|2,3, dim-horizontal|LL|3,3 |
| dim-vertical | {0} < {3} < {2} < {4,7} | 17/21 | dim-vertical|LL|0,0, dim-vertical|LL|2,0, dim-vertical|LL|2,2, dim-vertical|LL|2,3 |
| horizontal-2pt | {0} < {3} < {2} < {4,7} | 20/21 | horizontal-2pt|LL|3,3 |
| vertical-2pt | {0} < {2,3} < {4,7} | 21/21 | - |
| pointOnLine | {0,4,m} < {3,o} < {7} | 20/21 | pointOnLine|LL|4,3 |
| midpoint | {0,4,m} < {3,o} < {7} | 20/21 | midpoint|LL|4,3 |

**The who-moves table the app reads** (task 525: `packages/core/creation-placement-table.js`, generated by `scripts/fusion-oracle/fit-placement-table.mjs` from these cells and the 315 scenarios; a test asserts it equals the fit). The classes come from ONE classifier (`creation-placement.js` holdClass: the shape family and what holds it, from the solver's joint freedom and the constraints on it). The lowest tier gives way; inside one tier (or for a class the table does not rank) the tie rule says which pick gives way. Then the giving operand is PLACED (one rigid / similarity move of it, or the least-change solve of it alone) before the solve.

| table key | tiers (lowest gives way first) | tie: gives way | one-mover cells predicted |
|---|---|---|---|
| coincident-pp | {line:pinned, point:free} < {circle:free} < {line:centred} < {line:free, line:hv} < {arc:free, line:sized} < {line:corner, line:hv+chain} < {point:fixed} | second | 192/195 |
| collinear | {line:free} < {line:chain, line:sized} < {line:corner, line:hv, line:pinned+sized} < {line:hv+chain, line:hv+pinned, line:pinned} < {line:full} | second | 94/94 |
| dim-aligned | {point:free} < {circle:free} < {line:free} < {arc:free, line:pinned, line:sized} < {line:corner} < {line:centred} < {line:hv} < {line:hv+chain} < {point:fixed} | second | 198/199 |
| dim-angle | {line:corner, line:free} < {line:chain, line:sized} < {line:hv+chain, line:pinned} < {line:full, line:pinned+sized} < {line:hv, line:hv+pinned} | second | 109/110 |
| dim-horizontal | {arc:free, circle:free} < {line:free, line:hv, line:pinned, line:sized, point:free} < {line:centred} < {line:hv+chain} < {point:fixed} | first | 137/145 |
| dim-vertical | {arc:free, circle:free} < {line:free, line:hv, line:pinned, line:sized, point:free} < {line:centred} < {line:hv+chain} < {point:fixed} | first | 135/145 |
| equal-circle | {arc:pinned, circle:pinned} < {arc:free, circle:free} < {arc:full, arc:pinned+sized+chain, arc:sized, arc:sized+chain, circle:full, circle:sized} | second | 36/36 |
| equal-line-line | {line:free, line:pinned} < {line:hv, line:hv+pinned} < {line:chain, line:corner, line:hv+chain} < {line:full, line:pinned+sized, line:sized} | second | 119/119 |
| horizontal-2pt | {point:free} < {circle:free} < {line:centred, line:free} < {line:hv} < {arc:free, line:sized} < {line:hv+chain} < {point:fixed} | second | 131/133 |
| midpoint | {point:free} < {circle:free, line:pinned, line:sized} < {line:centred, line:free} < {arc:free, line:hv} < {line:hv+chain} < {line:chain, line:full, point:fixed} | second | 111/111 |
| parallel | {line:pinned} < {line:corner, line:free, line:pinned+sized} < {line:chain, line:hv+chain, line:sized} < {line:full, line:hv, line:hv+pinned} | second | 111/111 |
| perpendicular | {line:pinned} < {line:corner, line:free, line:pinned+sized} < {line:chain, line:hv+chain, line:sized} < {line:full, line:hv, line:hv+pinned} | second | 112/112 |
| pointOnCircle | {point:free} < {circle:free, circle:sized, line:centred, line:free, line:hv} < {arc:free, arc:sized} < {arc:sized+chain, line:hv+chain} < {arc:pinned, arc:pinned+sized, arc:pinned+sized+chain, circle:full, circle:pinned, point:fixed} | second | 113/114 |
| pointOnLine | {point:free} < {circle:free, line:pinned, line:sized} < {line:centred, line:free} < {arc:free, line:hv} < {line:hv+chain} < {line:chain, line:full, point:fixed} | second | 111/111 |
| tangent-circle-circle | {circle:sized} < {arc:sized+chain} < {circle:free, circle:pinned} < {arc:sized} < {arc:free, arc:pinned} < {arc:full, arc:pinned+sized, arc:pinned+sized+chain, circle:full} | second | 119/119 |
| tangent-line-circle | {circle:sized, line:chain, line:free, line:hv, line:hv+chain, line:sized} < {arc:free, arc:full, arc:sized, arc:sized+chain, circle:free, line:pinned} < {arc:pinned, arc:pinned+sized, arc:pinned+sized+chain, circle:full, circle:pinned, line:full} | second | 200/200 |
| vertical-2pt | {point:free} < {circle:free} < {line:centred, line:free} < {line:hv, line:sized} < {arc:free} < {line:hv+chain} < {point:fixed} | second | 133/133 |

#### The origin as an operand

Ours identifies the origin as the joint `j_origin` (created by `createEngine`: `{ x: 0, y: 0, fixed: true }`); a constraint names it like any joint (`joints: ['j_origin', ...]`) and the solver skips fixed joints, so it can only be a point of a constraint, never an entity. Fusion's is `sketch.originPoint` (a SketchPoint, `isFixed` true, read-only geometry; `gc.addCoincident(sk.originPoint, p)` is how a constraint reaches it). **172 cells have the origin as A or B (both pick orders)** with every constraint that takes a point (coincident, point-on-line / on circle, midpoint with the origin as the midpoint, H / V between two points, every point-point dimension mode) and the point kinds line end, rect corner, circle / arc centre, free point; plus the levels `o` (a line end coincident with the origin) and `m` (a line centred on the origin by midpoint). **The origin never moved and was never deleted in any of the 2438 cells, in Fusion (`originPoint` read back after every act) and in ours (`j_origin` still in `joints` at 0,0): confirmed** (origin cells alone: ok). The N-F1 bug (a fillet on an origin corner deletes the origin) is not reached by these cells: no cell applies a fillet at the origin, so no cell is marked "caused by N-F1" (it stays a finding of the 512 audit).

Axes: ours has NO axis entities (no X / Y axis line in the sketch model: only the origin joint), so "constrain to an axis" cannot be run in ours. Fusion probe (one call, not stored): `sketch.project(root.xConstructionAxis)` gives a SketchLine; a coincident of a free line end with it moves only that point onto the axis (end (20,20) became (20,0), the other end stayed); parallel to it rotates the free line about its midpoint. A user can still get an axis in ours as an ordinary line through the origin (levels `o` / `7`).

#### parallel

Fusion's rule (fitted on the 55 accepted one-mover cells of the free-standing line pair): rank the levels {4} < {0,1,5} < {2} < {3,6,7} (lowest moves first); the operand with the LOWER rank is the one that moves, a tie means the SECOND pick moves. It predicts 55 of 55 (no contradiction). In words: the operand held least (level 4) is the one that gives way, the most held (3, 6, 7) always stays; two operands at the same rank: the first pick stays and the second is moved.

Grid, line (A) x line (B), `Fusion/ours`:

| A \ B | 0 free | 1 corner | 2 length | 3 H/V | 4 end fixed | 5 end+length | 6 H/V+end | 7 full |
|---|---|---|---|---|---|---|---|---|
| 0 free | b/b | b/b | a/a | a/a | b/b | b/b | a/a | a/a |
| 1 corner | b/b | b/b | a/a | a/a | b/b | b/b | a/a | a/a |
| 2 length | b/b | b/b | b/b | a/a | b/b | b/b | a/a | a/a |
| 3 H/V | b/b | b/b | b/b | R/-* | b/b | b/b | R/-* | R/-* |
| 4 end fixed | a/a | a/a | a/a | a/a | b/b | a/a | a/a | a/a |
| 5 end+length | b/b | b/b | a/a | a/a | b/b | b/b | a/a | a/a |
| 6 H/V+end | b/b | b/b | b/b | R/-* | b/b | b/b | R/-* | R/-* |
| 7 full | b/b | b/b | b/b | R/-* | b/b | b/b | R/-* | R/-* |

| kinds (A,B) | cells | same | Fusion who-moves | ours who-moves | how Fusion moves it | how ours moves it |
|---|---|---|---|---|---|---|
| LL | 64 | 53 | a:22 b:33 R:9 | a:22 b:33 -:9 | one end:35 rotate:20 | one end:37 rotate:18 |
| LC | 8 | 8 | a:1 b:7 | a:1 b:7 | one end:5 rotate:3 | one end:5 rotate:3 |
| CL | 8 | 8 | a:5 b:3 | a:5 b:3 | one end:5 rotate:3 | one end:5 rotate:3 |
| LS | 4 | 4 | a:2 b:2 | a:2 b:2 | rotate:3 one end:1 | rotate:3 one end:1 |
| SL | 4 | 4 | a:2 b:2 | a:2 b:2 | rotate:3 one end:1 | rotate:3 one end:1 |
| LR | 8 | 4 | a:4 R:4 | a:4 -:4 | rotate:2 one end:2 | rotate:2 one end:2 |
| RL | 8 | 4 | b:4 R:4 | b:4 -:4 | rotate:2 one end:2 | rotate:2 one end:2 |
| CC | 4 | 4 | a:1 b:3 | a:1 b:3 | one end:3 rotate:1 | one end:3 rotate:1 |
| SS | 1 | 1 | -:1 | -:1 |  |  |
| RR | 4 | 0 | R:4 | -:4 |  |  |

#### perpendicular

Fusion's rule (fitted on the 55 accepted one-mover cells of the free-standing line pair): rank the levels {4} < {0,1,5} < {2} < {3,6,7} (lowest moves first); the operand with the LOWER rank is the one that moves, a tie means the SECOND pick moves. It predicts 55 of 55 (no contradiction). In words: the operand held least (level 4) is the one that gives way, the most held (3, 6, 7) always stays; two operands at the same rank: the first pick stays and the second is moved.

Grid, line (A) x line (B), `Fusion/ours`:

| A \ B | 0 free | 1 corner | 2 length | 3 H/V | 4 end fixed | 5 end+length | 6 H/V+end | 7 full |
|---|---|---|---|---|---|---|---|---|
| 0 free | b/b | b/b | a/a | a/a | b/b | b/b | a/a | a/a |
| 1 corner | b/b | b/b | a/a | a/a | b/b | b/b | a/a | a/a |
| 2 length | b/b | b/b | b/b | a/a | b/b | b/b | a/a | a/a |
| 3 H/V | b/b | b/b | b/b | R/R | b/b | b/b | R/R | R/R |
| 4 end fixed | a/a | a/a | a/a | a/a | b/b | a/a | a/a | a/a |
| 5 end+length | b/b | b/b | a/a | a/a | b/b | b/b | a/a | a/a |
| 6 H/V+end | b/b | b/b | b/b | R/R | b/b | b/b | R/R | R/R |
| 7 full | b/b | b/b | b/b | R/R | b/b | b/b | R/R | R/R |

| kinds (A,B) | cells | same | Fusion who-moves | ours who-moves | how Fusion moves it | how ours moves it |
|---|---|---|---|---|---|---|
| LL | 64 | 42 | a:22 b:33 R:9 | a:22 b:33 R:9 | one end:35 rotate:20 | one end:26 stretch:22 rotate:7 |
| LC | 8 | 5 | a:1 b:7 | a:1 b:7 | one end:5 rotate:3 | one end:5 stretch:3 |
| CL | 8 | 5 | a:5 b:3 | a:5 b:3 | one end:5 rotate:3 | one end:5 stretch:3 |
| LS | 4 | 1 | a:2 b:2 | a:2 b:2 | rotate:3 one end:1 | scale:2 stretch:1 one end:1 |
| SL | 4 | 1 | a:2 b:2 | a:2 b:1 X:1 | rotate:3 one end:1 | rotate:2 scale:2 one end:1 |
| LR | 8 | 6 | a:4 R:4 | a:4 R:4 | rotate:2 one end:2 | stretch:2 one end:2 |
| RL | 8 | 6 | b:4 R:4 | b:4 R:4 | rotate:2 one end:2 | stretch:2 one end:2 |
| CC | 4 | 3 | a:1 b:3 | a:1 b:3 | one end:3 rotate:1 | one end:3 stretch:1 |
| SS | 1 | 1 | b:1 | b:1 | rotate:1 | rotate:1 |
| RR | 4 | 4 | R:4 | R:4 |  |  |

#### collinear

Fusion's rule (fitted on the 39 accepted one-mover cells of the free-standing line pair): rank the levels {0} < {2} < {1,3,5} < {4,6,7} (lowest moves first); the operand with the LOWER rank is the one that moves, a tie means the SECOND pick moves. It predicts 39 of 39 (no contradiction); 11 cells move both operands and are outside the rule. In words: the operand held least (level 0) is the one that gives way, the most held (4, 6, 7) always stays; two operands at the same rank: the first pick stays and the second is moved.

Grid, line (A) x line (B), `Fusion/ours`:

| A \ B | 0 free | 1 corner | 2 length | 3 H/V | 4 end fixed | 5 end+length | 6 H/V+end | 7 full |
|---|---|---|---|---|---|---|---|---|
| 0 free | b/b | a/a | a/a | a/a | a/a | a/a | a/a | a/a |
| 1 corner | b/b | X/b* | b/b | X/a* | a/a | X/a* | a/a | a/a |
| 2 length | b/b | a/a | b/b | a/a | a/a | a/a | a/a | a/a |
| 3 H/V | b/b | X/b* | b/b | b/b | X/X | X/X | a/a | a/a |
| 4 end fixed | b/b | b/b | b/b | R/X* | X/X | X/X | R/R | R/R |
| 5 end+length | b/b | X/b* | b/b | R/X* | X/X | X/X | R/R | R/R |
| 6 H/V+end | b/b | b/b | b/b | b/b | R/R | R/R | R/R | R/R |
| 7 full | b/b | b/b | b/b | b/b | R/R | R/R | R/R | R/R |

| kinds (A,B) | cells | same | Fusion who-moves | ours who-moves | how Fusion moves it | how ours moves it |
|---|---|---|---|---|---|---|
| LL | 64 | 55 | a:18 b:21 X:11 R:14 | a:20 b:24 X:8 R:12 | rotate:32 one end:12 stretch:11 translate:6 | rotate:39 one end:12 translate:5 stretch:4 |
| LC | 8 | 8 | a:1 b:4 X:2 R:1 | a:1 b:4 X:2 R:1 | rotate:5 one end:3 stretch:1 | rotate:5 one end:3 stretch:1 |
| CL | 8 | 7 | a:3 b:2 X:1 R:2 | a:3 b:2 X:2 R:1 | rotate:5 one end:2 | rotate:5 one end:3 stretch:1 |
| LS | 4 | 4 | a:1 b:3 | a:1 b:3 | rotate:4 | rotate:4 |
| SL | 4 | 4 | a:3 b:1 | a:3 b:1 | rotate:4 | rotate:4 |
| LR | 8 | 7 | a:4 b:1 X:1 R:2 | a:4 b:1 X:1 R:2 | translate:3 rotate:2 one end:1 deform:1 | rotate:2 translate:2 deform:2 one end:1 |
| RL | 8 | 7 | a:1 b:4 X:1 R:2 | a:1 b:4 X:1 R:2 | translate:3 rotate:2 deform:1 one end:1 | rotate:2 translate:2 deform:2 one end:1 |
| CC | 4 | 4 | a:1 b:2 X:1 | a:1 b:2 X:1 | rotate:3 one end:2 | rotate:3 one end:2 |
| SS | 1 | 1 | b:1 | b:1 | translate:1 | translate:1 |
| RR | 4 | 1 | a:1 b:2 R:1 | a:1 b:2 R:1 | translate:3 | deform:3 |

#### equal-line-line

Fusion's rule (fitted on the 55 accepted one-mover cells of the free-standing line pair): rank the levels {0,4} < {3,6} < {1} < {2,5,7} (lowest moves first); the operand with the LOWER rank is the one that moves, a tie means the SECOND pick moves. It predicts 55 of 55 (no contradiction). In words: the operand held least (levels 0, 4) is the one that gives way, the most held (2, 5, 7) always stays; two operands at the same rank: the first pick stays and the second is moved.

Grid, line (A) x line (B), `Fusion/ours`:

| A \ B | 0 free | 1 corner | 2 length | 3 H/V | 4 end fixed | 5 end+length | 6 H/V+end | 7 full |
|---|---|---|---|---|---|---|---|---|
| 0 free | b/b | a/a | a/a | a/a | b/b | a/a | a/a | a/a |
| 1 corner | b/b | b/b | a/a | b/b | b/b | a/a | b/b | a/a |
| 2 length | b/b | b/b | R/R | b/b | b/b | R/R | b/b | R/R |
| 3 H/V | b/b | a/a | a/a | b/b | b/b | a/a | b/b | a/a |
| 4 end fixed | b/b | a/a | a/a | a/a | b/b | a/a | a/a | a/a |
| 5 end+length | b/b | b/b | R/R | b/b | b/b | R/R | b/b | R/R |
| 6 H/V+end | b/b | a/a | a/a | b/b | b/b | a/a | b/b | a/a |
| 7 full | b/b | b/b | R/R | b/b | b/b | R/R | b/b | R/R |

| kinds (A,B) | cells | same | Fusion who-moves | ours who-moves | how Fusion moves it | how ours moves it |
|---|---|---|---|---|---|---|
| LL | 64 | 64 | a:23 b:32 R:9 | a:23 b:32 R:9 | one end:55 | one end:55 |
| LC | 8 | 8 | b:8 | b:8 | one end:8 | one end:8 |
| CL | 8 | 8 | a:4 b:4 | a:4 b:4 | one end:8 | one end:8 |
| LS | 4 | 4 | a:3 b:1 | a:3 b:1 | one end:3 scale:1 | one end:3 scale:1 |
| SL | 4 | 4 | a:1 b:3 | a:1 b:3 | one end:3 scale:1 | one end:3 scale:1 |
| LR | 8 | 8 | a:6 b:1 R:1 | a:6 b:1 R:1 | one end:6 deform:1 | one end:6 deform:1 |
| RL | 8 | 8 | a:1 b:6 R:1 | a:1 b:6 R:1 | one end:6 deform:1 | one end:6 deform:1 |
| CC | 4 | 4 | b:4 | b:4 | one end:4 | one end:4 |
| SS | 1 | 1 | -:1 | -:1 |  |  |
| RR | 4 | 3 | a:1 b:2 R:1 | a:1 b:1 X:1 R:1 | deform:3 | deform:4 |

#### dim-angle

Fusion's rule (fitted on the 55 accepted one-mover cells of the free-standing line pair): rank the levels {0,1} < {2,4} < {5} < {3,6,7} (lowest moves first); the operand with the LOWER rank is the one that moves, a tie means the SECOND pick moves. It predicts 54 of 55; contradicting cells: dim-angle|LL|2,4. In words: the operand held least (levels 0, 1) is the one that gives way, the most held (3, 6, 7) always stays; two operands at the same rank: the first pick stays and the second is moved.

Grid, line (A) x line (B), `Fusion/ours`:

| A \ B | 0 free | 1 corner | 2 length | 3 H/V | 4 end fixed | 5 end+length | 6 H/V+end | 7 full |
|---|---|---|---|---|---|---|---|---|
| 0 free | b/b | b/b | a/a | a/a | a/a | a/a | a/a | a/a |
| 1 corner | b/b | b/b | a/a | a/a | a/a | a/a | a/a | a/a |
| 2 length | b/b | b/b | b/b | a/a | a/a | a/a | a/a | a/a |
| 3 H/V | b/b | b/b | b/b | R/-* | b/b | b/b | R/-* | R/-* |
| 4 end fixed | b/b | b/b | b/b | a/a | b/b | a/a | a/a | a/a |
| 5 end+length | b/b | b/b | b/b | a/a | b/b | b/b | a/a | a/a |
| 6 H/V+end | b/b | b/b | b/b | R/-* | b/b | b/b | R/-* | R/-* |
| 7 full | b/b | b/b | b/b | R/-* | b/b | b/b | R/-* | R/-* |

| kinds (A,B) | cells | same | Fusion who-moves | ours who-moves | how Fusion moves it | how ours moves it |
|---|---|---|---|---|---|---|
| LL | 64 | 47 | a:24 b:31 R:9 | a:24 b:31 -:9 | one end:20 stretch:20 rotate:15 | stretch:28 one end:16 rotate:11 |
| LC | 8 | 7 | a:1 b:7 | a:1 b:7 | stretch:4 one end:3 rotate:1 | stretch:5 one end:3 |
| CL | 8 | 7 | a:5 b:3 | a:5 b:3 | stretch:4 one end:3 rotate:1 | stretch:5 one end:3 |
| LS | 4 | 3 | a:1 b:3 | a:1 b:3 | scale:3 rotate:1 | scale:3 stretch:1 |
| SL | 4 | 3 | a:3 b:1 | a:3 b:1 | scale:3 rotate:1 | scale:3 stretch:1 |
| LR | 8 | 4 | a:4 R:4 | a:4 -:4 | stretch:2 one end:2 | stretch:2 one end:2 |
| RL | 8 | 4 | b:4 R:4 | b:4 -:4 | stretch:2 one end:2 | stretch:2 one end:2 |
| CC | 4 | 3 | a:1 b:3 | a:1 b:3 | stretch:2 rotate:1 one end:1 | stretch:3 one end:1 |
| SS | 1 | 0 | b:1 | b:1 | rotate:1 | scale:1 |
| RR | 4 | 0 | R:4 | -:4 |  |  |

#### coincident-pp

Fusion's rule (fitted on the 73 accepted one-mover cells of the free-standing line pair): rank the levels {0,m} < {2,3} < {1} < {4,5,6,7,o} (lowest moves first); the operand with the LOWER rank is the one that moves, a tie means the SECOND pick moves. It predicts 73 of 73 (no contradiction); 1 cells move both operands and are outside the rule. In words: the operand held least (levels 0, m) is the one that gives way, the most held (4, 5, 6, 7, o) always stays; two operands at the same rank: the first pick stays and the second is moved.

Grid, line (A) x line (B), `Fusion/ours`:

| A \ B | 0 free | 1 corner | 2 length | 3 H/V | 4 end fixed | 5 end+length | 6 H/V+end | 7 full | o end at origin | m mid at origin |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 free | b/b | a/a | a/a | a/b* | a/a | a/a | a/a | a/a | a/a | b/b |
| 1 corner | b/b | b/b | b/b | b/b | a/a | a/a | a/a | a/a | a/a | b/b |
| 2 length | b/b | a/a | b/b | b/b | a/a | a/a | a/a | a/a | a/a | b/b |
| 3 H/V | b/b | a/a | b/a* | b/b | a/a | a/a | a/a | a/a | a/a | b/b |
| 4 end fixed | b/b | b/b | b/b | b/b | R/R | R/R | R/R | R/R | R/R | b/b |
| 5 end+length | b/b | b/b | b/b | b/b | R/R | R/R | R/R | R/R | R/R | b/b |
| 6 H/V+end | b/b | b/b | b/b | b/b | R/R | R/R | R/R | R/R | R/R | b/b |
| 7 full | b/b | b/b | b/b | b/b | R/R | R/R | R/R | R/R | R/R | b/b |
| o end at origin | b/b | b/b | b/b | b/b | R/R | R/R | R/R | R/R | -/- | R/R |
| m mid at origin | b/a* | a/a | a/a | a/a | a/a | a/a | a/a | a/a | R/R | b/b |

| kinds (A,B) | cells | same | Fusion who-moves | ours who-moves | how Fusion moves it | how ours moves it |
|---|---|---|---|---|---|---|
| LL | 100 | 97 | a:32 b:41 -:1 R:26 | a:33 b:40 -:1 R:26 | translate:57 stretch:16 | translate:56 stretch:17 |
| LR | 6 | 6 | a:3 b:3 | a:3 b:3 | translate:5 stretch:1 | translate:5 stretch:1 |
| LO | 12 | 12 | a:3 b:6 R:3 | a:3 b:6 R:3 | translate:8 stretch:1 | translate:8 stretch:1 |
| LA | 6 | 6 | a:3 b:3 | a:3 b:3 | translate:5 stretch:1 | translate:5 stretch:1 |
| LP | 12 | 12 | a:3 b:6 R:3 | a:3 b:6 R:3 | translate:8 stretch:1 | translate:8 stretch:1 |
| LZ | 6 | 6 | a:2 R:4 | a:2 R:4 | translate:2 | translate:2 |
| RL | 6 | 6 | a:3 b:3 | a:3 b:3 | translate:5 stretch:1 | translate:5 stretch:1 |
| RR | 1 | 1 | b:1 | b:1 | translate:1 | translate:1 |
| RO | 2 | 2 | a:1 b:1 | a:1 b:1 | translate:2 | translate:2 |
| RA | 1 | 1 | b:1 | b:1 | translate:1 | translate:1 |
| RP | 2 | 2 | a:1 b:1 | a:1 b:1 | translate:2 | translate:2 |
| RZ | 1 | 1 | a:1 | a:1 | translate:1 | translate:1 |
| OL | 12 | 12 | a:6 b:3 R:3 | a:6 b:3 R:3 | translate:8 stretch:1 | translate:8 stretch:1 |
| OR | 2 | 2 | a:1 b:1 | a:1 b:1 | translate:2 | translate:2 |
| OO | 4 | 4 | a:1 b:2 R:1 | a:1 b:2 R:1 | translate:3 | translate:3 |
| OA | 2 | 2 | a:1 b:1 | a:1 b:1 | translate:2 | translate:2 |
| OP | 4 | 4 | a:1 b:2 R:1 | a:1 b:2 R:1 | translate:3 | translate:3 |
| OZ | 2 | 2 | a:1 R:1 | a:1 R:1 | translate:1 | translate:1 |
| AL | 6 | 6 | a:3 b:3 | a:3 b:3 | translate:5 stretch:1 | translate:5 stretch:1 |
| AR | 1 | 1 | a:1 | a:1 | translate:1 | translate:1 |
| AO | 2 | 2 | a:1 b:1 | a:1 b:1 | translate:2 | translate:2 |
| AA | 1 | 1 | b:1 | b:1 | translate:1 | translate:1 |
| AP | 2 | 2 | a:1 b:1 | a:1 b:1 | translate:2 | translate:2 |
| AZ | 1 | 1 | a:1 | a:1 | translate:1 | translate:1 |
| PL | 12 | 12 | a:6 b:3 R:3 | a:6 b:3 R:3 | translate:8 stretch:1 | translate:8 stretch:1 |
| PR | 2 | 2 | a:1 b:1 | a:1 b:1 | translate:2 | translate:2 |
| PO | 4 | 4 | a:2 b:1 R:1 | a:2 b:1 R:1 | translate:3 | translate:3 |
| PA | 2 | 2 | a:1 b:1 | a:1 b:1 | translate:2 | translate:2 |
| PP | 4 | 4 | a:1 b:2 R:1 | a:1 b:2 R:1 | translate:3 | translate:3 |
| PZ | 2 | 2 | a:1 R:1 | a:1 R:1 | translate:1 | translate:1 |
| ZL | 6 | 6 | b:2 R:4 | b:2 R:4 | translate:2 | translate:2 |
| ZR | 1 | 1 | b:1 | b:1 | translate:1 | translate:1 |
| ZO | 2 | 2 | b:1 R:1 | b:1 R:1 | translate:1 | translate:1 |
| ZA | 1 | 1 | b:1 | b:1 | translate:1 | translate:1 |
| ZP | 2 | 2 | b:1 R:1 | b:1 R:1 | translate:1 | translate:1 |

#### dim-aligned

Fusion's rule (fitted on the 75 accepted one-mover cells of the free-standing line pair): rank the levels {0,2} < {1,m} < {3} < {4,5,6,7,o} (lowest moves first); the operand with the LOWER rank is the one that moves, a tie means the SECOND pick moves. It predicts 73 of 75; contradicting cells: dim-aligned|LL|0,2, dim-aligned|LL|1,m; 1 cells move both operands and are outside the rule. In words: the operand held least (levels 0, 2) is the one that gives way, the most held (4, 5, 6, 7, o) always stays; two operands at the same rank: the first pick stays and the second is moved.

Grid, line (A) x line (B), `Fusion/ours`:

| A \ B | 0 free | 1 corner | 2 length | 3 H/V | 4 end fixed | 5 end+length | 6 H/V+end | 7 full | o end at origin | m mid at origin |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 free | b/b | a/a | a/a | a/a | a/a | a/a | a/a | a/a | a/a | a/a |
| 1 corner | b/b | b/b | b/b | a/a | a/a | a/a | a/a | a/a | a/a | a/a |
| 2 length | b/b | a/a | b/b | a/a | a/a | a/a | a/a | a/a | a/a | a/a |
| 3 H/V | b/b | b/b | b/b | b/b | a/a | a/a | a/a | a/a | a/a | b/b |
| 4 end fixed | b/b | b/b | b/b | b/b | R/-* | R/-* | R/-* | R/-* | R/-* | b/b |
| 5 end+length | b/b | b/b | b/b | b/b | R/-* | R/-* | R/-* | R/-* | R/-* | b/b |
| 6 H/V+end | b/b | b/b | b/b | b/b | R/-* | R/-* | R/-* | R/-* | R/-* | b/b |
| 7 full | b/b | b/b | b/b | b/b | R/-* | R/-* | R/-* | R/-* | R/-* | b/b |
| o end at origin | b/b | b/b | b/b | b/b | R/-* | R/-* | R/-* | R/-* | -/- | b/b |
| m mid at origin | b/b | b/b | b/b | a/a | a/a | a/a | a/a | a/a | a/a | b/b |

| kinds (A,B) | cells | same | Fusion who-moves | ours who-moves | how Fusion moves it | how ours moves it |
|---|---|---|---|---|---|---|
| LL | 100 | 33 | a:35 b:40 -:1 R:24 | a:35 b:40 -:25 | stretch:41 translate:20 rotate:14 | translate:62 stretch:13 |
| LR | 6 | 5 | a:3 b:3 | a:3 b:3 | translate:4 stretch:2 | translate:5 stretch:1 |
| LO | 12 | 8 | a:3 b:6 R:3 | a:3 b:6 -:3 | translate:7 stretch:2 | translate:8 stretch:1 |
| LA | 6 | 1 | a:1 b:5 | a:1 b:5 | deform+radius:5 translate:1 | translate:6 |
| LP | 12 | 8 | a:3 b:6 R:3 | a:3 b:6 -:3 | translate:7 stretch:2 | translate:8 stretch:1 |
| LZ | 6 | 2 | a:3 -:1 R:2 | a:3 -:3 | stretch:2 translate:1 | translate:2 stretch:1 |
| RL | 6 | 5 | a:3 b:3 | a:3 b:3 | translate:4 stretch:2 | translate:5 stretch:1 |
| RR | 1 | 1 | b:1 | b:1 | translate:1 | translate:1 |
| RO | 2 | 2 | a:1 b:1 | a:1 b:1 | translate:2 | translate:2 |
| RA | 1 | 0 | b:1 | b:1 | deform+radius:1 | translate:1 |
| RP | 2 | 2 | a:1 b:1 | a:1 b:1 | translate:2 | translate:2 |
| RZ | 1 | 1 | a:1 | a:1 | translate:1 | translate:1 |
| OL | 12 | 8 | a:6 b:3 R:3 | a:6 b:3 -:3 | translate:7 stretch:2 | translate:8 stretch:1 |
| OR | 2 | 2 | a:1 b:1 | a:1 b:1 | translate:2 | translate:2 |
| OO | 4 | 3 | a:1 b:2 R:1 | a:1 b:2 -:1 | translate:3 | translate:3 |
| OA | 2 | 1 | a:1 b:1 | a:1 b:1 | translate:1 deform+radius:1 | translate:2 |
| OP | 4 | 3 | a:1 b:2 R:1 | a:1 b:2 -:1 | translate:3 | translate:3 |
| OZ | 2 | 1 | a:1 R:1 | a:1 -:1 | translate:1 | translate:1 |
| AL | 6 | 1 | a:5 b:1 | a:5 b:1 | deform+radius:5 translate:1 | translate:6 |
| AR | 1 | 0 | a:1 | a:1 | deform+radius:1 | translate:1 |
| AO | 2 | 1 | a:1 b:1 | a:1 b:1 | translate:1 deform+radius:1 | translate:2 |
| AA | 1 | 1 | b:1 | b:1 | translate:1 | translate:1 |
| AP | 2 | 1 | a:1 b:1 | a:1 b:1 | translate:1 deform+radius:1 | translate:2 |
| AZ | 1 | 0 | a:1 | a:1 | deform+radius:1 | translate:1 |
| PL | 12 | 8 | a:6 b:3 R:3 | a:6 b:3 -:3 | translate:7 stretch:2 | translate:8 stretch:1 |
| PR | 2 | 2 | a:1 b:1 | a:1 b:1 | translate:2 | translate:2 |
| PO | 4 | 3 | a:2 b:1 R:1 | a:2 b:1 -:1 | translate:3 | translate:3 |
| PA | 2 | 1 | a:1 b:1 | a:1 b:1 | translate:1 deform+radius:1 | translate:2 |
| PP | 4 | 3 | a:1 b:2 R:1 | a:1 b:2 -:1 | translate:3 | translate:3 |
| PZ | 2 | 1 | a:1 R:1 | a:1 -:1 | translate:1 | translate:1 |
| ZL | 6 | 2 | b:3 -:1 R:2 | b:3 -:3 | stretch:2 translate:1 | translate:2 stretch:1 |
| ZR | 1 | 1 | b:1 | b:1 | translate:1 | translate:1 |
| ZO | 2 | 1 | b:1 R:1 | b:1 -:1 | translate:1 | translate:1 |
| ZA | 1 | 0 | b:1 | b:1 | deform+radius:1 | translate:1 |
| ZP | 2 | 1 | b:1 R:1 | b:1 -:1 | translate:1 | translate:1 |

#### dim-horizontal

Fusion's rule (fitted on the 21 accepted one-mover cells of the free-standing line pair): rank the levels {0} < {3} < {2} < {4,7} (lowest moves first); the operand with the LOWER rank is the one that moves, a tie means the SECOND pick moves. It predicts 16 of 21; contradicting cells: dim-horizontal|LL|0,0, dim-horizontal|LL|2,0, dim-horizontal|LL|2,2, dim-horizontal|LL|2,3, dim-horizontal|LL|3,3. In words: the operand held least (level 0) is the one that gives way, the most held (4, 7) always stays; two operands at the same rank: the first pick stays and the second is moved.

Grid, line (A) x line (B), `Fusion/ours`:

| A \ B | 0 free | 2 length | 3 H/V | 4 end fixed | 7 full |
|---|---|---|---|---|---|
| 0 free | a/a | a/a | a/a | a/a | a/a |
| 2 length | a/a | a/a | a/a | a/a | a/a |
| 3 H/V | b/a* | a/a | a/a | a/a | a/a |
| 4 end fixed | b/b | b/b | b/b | R/-* | R/-* |
| 7 full | b/b | b/b | b/b | R/-* | R/-* |

| kinds (A,B) | cells | same | Fusion who-moves | ours who-moves | how Fusion moves it | how ours moves it |
|---|---|---|---|---|---|---|
| LL | 25 | 10 | a:14 b:7 R:4 | a:15 b:6 -:4 | translate:11 one end:5 rotate:5 | translate:21 |
| LR | 6 | 5 | a:3 b:3 | a:3 b:3 | translate:4 one end:1 stretch:1 | translate:5 stretch:1 |
| LO | 12 | 7 | a:4 b:5 R:3 | a:3 b:6 -:3 | translate:6 one end:2 stretch:1 | translate:8 stretch:1 |
| LA | 6 | 3 | a:3 b:3 | b:6 | translate:4 one end:1 stretch:1 | translate:6 |
| LP | 12 | 6 | a:4 b:5 R:3 | a:5 b:4 -:3 | translate:6 one end:2 stretch:1 | translate:8 stretch:1 |
| LZ | 6 | 3 | a:3 R:3 | a:3 -:2 R:1 | one end:1 translate:1 stretch:1 | translate:2 stretch:1 |
| RL | 6 | 6 | a:3 b:3 | a:3 b:3 | translate:5 stretch:1 | translate:5 stretch:1 |
| RR | 1 | 1 | a:1 | a:1 | translate:1 | translate:1 |
| RO | 2 | 2 | a:1 b:1 | a:1 b:1 | translate:2 | translate:2 |
| RA | 1 | 1 | b:1 | b:1 | translate:1 | translate:1 |
| RP | 2 | 2 | a:1 b:1 | a:1 b:1 | translate:2 | translate:2 |
| RZ | 1 | 1 | a:1 | a:1 | translate:1 | translate:1 |
| OL | 12 | 9 | a:6 b:3 R:3 | a:6 b:3 -:3 | translate:8 stretch:1 | translate:8 stretch:1 |
| OR | 2 | 2 | a:1 b:1 | a:1 b:1 | translate:2 | translate:2 |
| OO | 4 | 3 | a:2 b:1 R:1 | a:2 b:1 -:1 | translate:3 | translate:3 |
| OA | 2 | 2 | a:1 b:1 | a:1 b:1 | translate:2 | translate:2 |
| OP | 4 | 3 | a:2 b:1 R:1 | a:2 b:1 -:1 | translate:3 | translate:3 |
| OZ | 2 | 1 | a:1 R:1 | a:1 -:1 | translate:1 | translate:1 |
| AL | 6 | 0 | a:6 | a:6 | deform+radius:6 | translate:6 |
| AR | 1 | 0 | a:1 | a:1 | deform+radius:1 | translate:1 |
| AO | 2 | 0 | a:2 | a:2 | deform+radius:2 | translate:2 |
| AA | 1 | 0 | a:1 | a:1 | deform+radius:1 | translate:1 |
| AP | 2 | 0 | a:2 | a:2 | deform+radius:2 | translate:2 |
| AZ | 1 | 0 | a:1 | a:1 | deform+radius:1 | translate:1 |
| PL | 12 | 9 | a:6 b:3 R:3 | a:6 b:3 -:3 | translate:8 stretch:1 | translate:8 stretch:1 |
| PR | 2 | 2 | a:1 b:1 | a:1 b:1 | translate:2 | translate:2 |
| PO | 4 | 2 | a:2 b:1 R:1 | a:1 b:2 -:1 | translate:3 | translate:3 |
| PA | 2 | 1 | a:1 b:1 | b:2 | translate:2 | translate:2 |
| PP | 4 | 3 | a:2 b:1 R:1 | a:2 b:1 -:1 | translate:3 | translate:3 |
| PZ | 2 | 1 | a:1 R:1 | a:1 -:1 | translate:1 | translate:1 |
| ZL | 6 | 4 | b:3 R:3 | b:3 -:2 R:1 | translate:2 stretch:1 | translate:2 stretch:1 |
| ZR | 1 | 1 | b:1 | b:1 | translate:1 | translate:1 |
| ZO | 2 | 1 | b:1 R:1 | b:1 -:1 | translate:1 | translate:1 |
| ZA | 1 | 1 | b:1 | b:1 | translate:1 | translate:1 |
| ZP | 2 | 1 | b:1 R:1 | b:1 -:1 | translate:1 | translate:1 |

#### dim-vertical

Fusion's rule (fitted on the 21 accepted one-mover cells of the free-standing line pair): rank the levels {0} < {3} < {2} < {4,7} (lowest moves first); the operand with the LOWER rank is the one that moves, a tie means the SECOND pick moves. It predicts 17 of 21; contradicting cells: dim-vertical|LL|0,0, dim-vertical|LL|2,0, dim-vertical|LL|2,2, dim-vertical|LL|2,3. In words: the operand held least (level 0) is the one that gives way, the most held (4, 7) always stays; two operands at the same rank: the first pick stays and the second is moved.

Grid, line (A) x line (B), `Fusion/ours`:

| A \ B | 0 free | 2 length | 3 H/V | 4 end fixed | 7 full |
|---|---|---|---|---|---|
| 0 free | a/a | a/a | a/a | a/a | a/a |
| 2 length | a/a | a/a | a/a | a/a | a/a |
| 3 H/V | b/a* | a/a | b/a* | a/a | a/a |
| 4 end fixed | b/b | b/b | b/b | R/-* | R/-* |
| 7 full | b/b | b/b | b/b | R/-* | R/-* |

| kinds (A,B) | cells | same | Fusion who-moves | ours who-moves | how Fusion moves it | how ours moves it |
|---|---|---|---|---|---|---|
| LL | 25 | 9 | a:13 b:8 R:4 | a:15 b:6 -:4 | translate:11 one end:5 rotate:5 | translate:21 |
| LR | 6 | 5 | a:3 b:3 | a:3 b:3 | translate:4 one end:1 stretch:1 | translate:5 stretch:1 |
| LO | 12 | 7 | a:4 b:5 R:3 | a:3 b:6 -:3 | translate:6 one end:2 stretch:1 | translate:8 stretch:1 |
| LA | 6 | 3 | a:3 b:3 | b:6 | translate:4 one end:1 stretch:1 | translate:6 |
| LP | 12 | 6 | a:4 b:5 R:3 | a:5 b:4 -:3 | translate:6 one end:2 stretch:1 | translate:8 stretch:1 |
| LZ | 6 | 2 | a:3 R:3 | a:3 -:3 | one end:1 translate:1 stretch:1 | translate:2 stretch:1 |
| RL | 6 | 6 | a:3 b:3 | a:3 b:3 | translate:5 stretch:1 | translate:5 stretch:1 |
| RR | 1 | 0 | b:1 | a:1 | translate:1 | translate:1 |
| RO | 2 | 2 | a:1 b:1 | a:1 b:1 | translate:2 | translate:2 |
| RA | 1 | 1 | b:1 | b:1 | translate:1 | translate:1 |
| RP | 2 | 2 | a:1 b:1 | a:1 b:1 | translate:2 | translate:2 |
| RZ | 1 | 1 | a:1 | a:1 | translate:1 | translate:1 |
| OL | 12 | 9 | a:6 b:3 R:3 | a:6 b:3 -:3 | translate:8 stretch:1 | translate:8 stretch:1 |
| OR | 2 | 2 | a:1 b:1 | a:1 b:1 | translate:2 | translate:2 |
| OO | 4 | 3 | a:2 b:1 R:1 | a:2 b:1 -:1 | translate:3 | translate:3 |
| OA | 2 | 2 | a:1 b:1 | a:1 b:1 | translate:2 | translate:2 |
| OP | 4 | 3 | a:2 b:1 R:1 | a:2 b:1 -:1 | translate:3 | translate:3 |
| OZ | 2 | 1 | a:1 R:1 | a:1 -:1 | translate:1 | translate:1 |
| AL | 6 | 0 | a:6 | a:6 | deform+radius:6 | translate:6 |
| AR | 1 | 0 | a:1 | a:1 | deform+radius:1 | translate:1 |
| AO | 2 | 0 | a:2 | a:2 | deform+radius:2 | translate:2 |
| AA | 1 | 0 | a:1 | a:1 | deform+radius:1 | translate:1 |
| AP | 2 | 0 | a:2 | a:2 | deform+radius:2 | translate:2 |
| AZ | 1 | 0 | a:1 | a:1 | deform+radius:1 | translate:1 |
| PL | 12 | 9 | a:6 b:3 R:3 | a:6 b:3 -:3 | translate:8 stretch:1 | translate:8 stretch:1 |
| PR | 2 | 2 | a:1 b:1 | a:1 b:1 | translate:2 | translate:2 |
| PO | 4 | 2 | a:2 b:1 R:1 | a:1 b:2 -:1 | translate:3 | translate:3 |
| PA | 2 | 1 | a:1 b:1 | b:2 | translate:2 | translate:2 |
| PP | 4 | 3 | a:2 b:1 R:1 | a:2 b:1 -:1 | translate:3 | translate:3 |
| PZ | 2 | 1 | a:1 R:1 | a:1 -:1 | translate:1 | translate:1 |
| ZL | 6 | 3 | b:3 R:3 | b:3 -:3 | translate:2 stretch:1 | translate:2 stretch:1 |
| ZR | 1 | 1 | b:1 | b:1 | translate:1 | translate:1 |
| ZO | 2 | 1 | b:1 R:1 | b:1 -:1 | translate:1 | translate:1 |
| ZA | 1 | 1 | b:1 | b:1 | translate:1 | translate:1 |
| ZP | 2 | 1 | b:1 R:1 | b:1 -:1 | translate:1 | translate:1 |

#### horizontal-2pt

Fusion's rule (fitted on the 21 accepted one-mover cells of the free-standing line pair): rank the levels {0} < {3} < {2} < {4,7} (lowest moves first); the operand with the LOWER rank is the one that moves, a tie means the SECOND pick moves. It predicts 20 of 21; contradicting cells: horizontal-2pt|LL|3,3. In words: the operand held least (level 0) is the one that gives way, the most held (4, 7) always stays; two operands at the same rank: the first pick stays and the second is moved.

Grid, line (A) x line (B), `Fusion/ours`:

| A \ B | 0 free | 2 length | 3 H/V | 4 end fixed | 7 full |
|---|---|---|---|---|---|
| 0 free | b/b | a/a | a/a | a/a | a/a |
| 2 length | b/b | b/b | b/b | a/a | a/a |
| 3 H/V | b/b | a/a | a/b* | a/a | a/a |
| 4 end fixed | b/b | b/b | b/b | R/R | R/R |
| 7 full | b/b | b/b | b/b | R/R | R/R |

| kinds (A,B) | cells | same | Fusion who-moves | ours who-moves | how Fusion moves it | how ours moves it |
|---|---|---|---|---|---|---|
| LL | 25 | 24 | a:10 b:11 R:4 | a:9 b:12 R:4 | translate:21 | translate:21 |
| LR | 6 | 6 | a:3 b:3 | a:3 b:3 | translate:5 stretch:1 | translate:5 stretch:1 |
| LO | 12 | 12 | a:3 b:6 R:3 | a:3 b:6 R:3 | translate:8 stretch:1 | translate:8 stretch:1 |
| LA | 6 | 6 | a:3 b:3 | a:3 b:3 | translate:5 stretch:1 | translate:5 stretch:1 |
| LP | 12 | 12 | a:3 b:6 R:3 | a:3 b:6 R:3 | translate:8 stretch:1 | translate:8 stretch:1 |
| LZ | 6 | 5 | a:3 R:3 | a:3 -:1 R:2 | translate:2 stretch:1 | translate:2 stretch:1 |
| RL | 6 | 6 | a:3 b:3 | a:3 b:3 | translate:5 stretch:1 | translate:5 stretch:1 |
| RR | 1 | 0 | a:1 | b:1 | translate:1 | translate:1 |
| RO | 2 | 2 | a:1 b:1 | a:1 b:1 | translate:2 | translate:2 |
| RA | 1 | 1 | b:1 | b:1 | translate:1 | translate:1 |
| RP | 2 | 2 | a:1 b:1 | a:1 b:1 | translate:2 | translate:2 |
| RZ | 1 | 1 | a:1 | a:1 | translate:1 | translate:1 |
| OL | 12 | 12 | a:6 b:3 R:3 | a:6 b:3 R:3 | translate:8 stretch:1 | translate:8 stretch:1 |
| OR | 2 | 2 | a:1 b:1 | a:1 b:1 | translate:2 | translate:2 |
| OO | 4 | 4 | a:1 b:2 R:1 | a:1 b:2 R:1 | translate:3 | translate:3 |
| OA | 2 | 2 | a:1 b:1 | a:1 b:1 | translate:2 | translate:2 |
| OP | 4 | 4 | a:1 b:2 R:1 | a:1 b:2 R:1 | translate:3 | translate:3 |
| OZ | 2 | 2 | a:1 R:1 | a:1 R:1 | translate:1 | translate:1 |
| AL | 6 | 6 | a:3 b:3 | a:3 b:3 | translate:5 stretch:1 | translate:5 stretch:1 |
| AR | 1 | 1 | a:1 | a:1 | translate:1 | translate:1 |
| AO | 2 | 2 | a:1 b:1 | a:1 b:1 | translate:2 | translate:2 |
| AA | 1 | 1 | b:1 | b:1 | translate:1 | translate:1 |
| AP | 2 | 2 | a:1 b:1 | a:1 b:1 | translate:2 | translate:2 |
| AZ | 1 | 1 | a:1 | a:1 | translate:1 | translate:1 |
| PL | 12 | 12 | a:6 b:3 R:3 | a:6 b:3 R:3 | translate:8 stretch:1 | translate:8 stretch:1 |
| PR | 2 | 2 | a:1 b:1 | a:1 b:1 | translate:2 | translate:2 |
| PO | 4 | 4 | a:2 b:1 R:1 | a:2 b:1 R:1 | translate:3 | translate:3 |
| PA | 2 | 2 | a:1 b:1 | a:1 b:1 | translate:2 | translate:2 |
| PP | 4 | 4 | a:1 b:2 R:1 | a:1 b:2 R:1 | translate:3 | translate:3 |
| PZ | 2 | 2 | a:1 R:1 | a:1 R:1 | translate:1 | translate:1 |
| ZL | 6 | 5 | b:3 R:3 | b:3 -:1 R:2 | translate:2 stretch:1 | translate:2 stretch:1 |
| ZR | 1 | 1 | b:1 | b:1 | translate:1 | translate:1 |
| ZO | 2 | 2 | b:1 R:1 | b:1 R:1 | translate:1 | translate:1 |
| ZA | 1 | 1 | b:1 | b:1 | translate:1 | translate:1 |
| ZP | 2 | 2 | b:1 R:1 | b:1 R:1 | translate:1 | translate:1 |

#### vertical-2pt

Fusion's rule (fitted on the 21 accepted one-mover cells of the free-standing line pair): rank the levels {0} < {2,3} < {4,7} (lowest moves first); the operand with the LOWER rank is the one that moves, a tie means the SECOND pick moves. It predicts 21 of 21 (no contradiction). In words: the operand held least (level 0) is the one that gives way, the most held (4, 7) always stays; two operands at the same rank: the first pick stays and the second is moved.

Grid, line (A) x line (B), `Fusion/ours`:

| A \ B | 0 free | 2 length | 3 H/V | 4 end fixed | 7 full |
|---|---|---|---|---|---|
| 0 free | b/b | a/a | a/a | a/a | a/a |
| 2 length | b/b | b/b | b/b | a/a | a/a |
| 3 H/V | b/b | b/b | b/b | a/a | a/a |
| 4 end fixed | b/b | b/b | b/b | R/R | R/R |
| 7 full | b/b | b/b | b/b | R/R | R/R |

| kinds (A,B) | cells | same | Fusion who-moves | ours who-moves | how Fusion moves it | how ours moves it |
|---|---|---|---|---|---|---|
| LL | 25 | 25 | a:8 b:13 R:4 | a:8 b:13 R:4 | translate:21 | translate:21 |
| LR | 6 | 6 | a:3 b:3 | a:3 b:3 | translate:5 stretch:1 | translate:5 stretch:1 |
| LO | 12 | 12 | a:3 b:6 R:3 | a:3 b:6 R:3 | translate:8 stretch:1 | translate:8 stretch:1 |
| LA | 6 | 6 | a:3 b:3 | a:3 b:3 | translate:5 stretch:1 | translate:5 stretch:1 |
| LP | 12 | 12 | a:3 b:6 R:3 | a:3 b:6 R:3 | translate:8 stretch:1 | translate:8 stretch:1 |
| LZ | 6 | 5 | a:3 R:3 | a:3 -:1 R:2 | translate:2 stretch:1 | translate:2 stretch:1 |
| RL | 6 | 6 | a:3 b:3 | a:3 b:3 | translate:5 stretch:1 | translate:5 stretch:1 |
| RR | 1 | 1 | b:1 | b:1 | translate:1 | translate:1 |
| RO | 2 | 2 | a:1 b:1 | a:1 b:1 | translate:2 | translate:2 |
| RA | 1 | 1 | b:1 | b:1 | translate:1 | translate:1 |
| RP | 2 | 2 | a:1 b:1 | a:1 b:1 | translate:2 | translate:2 |
| RZ | 1 | 1 | a:1 | a:1 | translate:1 | translate:1 |
| OL | 12 | 12 | a:6 b:3 R:3 | a:6 b:3 R:3 | translate:8 stretch:1 | translate:8 stretch:1 |
| OR | 2 | 2 | a:1 b:1 | a:1 b:1 | translate:2 | translate:2 |
| OO | 4 | 4 | a:1 b:2 R:1 | a:1 b:2 R:1 | translate:3 | translate:3 |
| OA | 2 | 2 | a:1 b:1 | a:1 b:1 | translate:2 | translate:2 |
| OP | 4 | 4 | a:1 b:2 R:1 | a:1 b:2 R:1 | translate:3 | translate:3 |
| OZ | 2 | 2 | a:1 R:1 | a:1 R:1 | translate:1 | translate:1 |
| AL | 6 | 6 | a:3 b:3 | a:3 b:3 | translate:5 stretch:1 | translate:5 stretch:1 |
| AR | 1 | 1 | a:1 | a:1 | translate:1 | translate:1 |
| AO | 2 | 2 | a:1 b:1 | a:1 b:1 | translate:2 | translate:2 |
| AA | 1 | 1 | b:1 | b:1 | translate:1 | translate:1 |
| AP | 2 | 2 | a:1 b:1 | a:1 b:1 | translate:2 | translate:2 |
| AZ | 1 | 1 | a:1 | a:1 | translate:1 | translate:1 |
| PL | 12 | 12 | a:6 b:3 R:3 | a:6 b:3 R:3 | translate:8 stretch:1 | translate:8 stretch:1 |
| PR | 2 | 2 | a:1 b:1 | a:1 b:1 | translate:2 | translate:2 |
| PO | 4 | 4 | a:2 b:1 R:1 | a:2 b:1 R:1 | translate:3 | translate:3 |
| PA | 2 | 2 | a:1 b:1 | a:1 b:1 | translate:2 | translate:2 |
| PP | 4 | 4 | a:1 b:2 R:1 | a:1 b:2 R:1 | translate:3 | translate:3 |
| PZ | 2 | 2 | a:1 R:1 | a:1 R:1 | translate:1 | translate:1 |
| ZL | 6 | 5 | b:3 R:3 | b:3 -:1 R:2 | translate:2 stretch:1 | translate:2 stretch:1 |
| ZR | 1 | 1 | b:1 | b:1 | translate:1 | translate:1 |
| ZO | 2 | 2 | b:1 R:1 | b:1 R:1 | translate:1 | translate:1 |
| ZA | 1 | 1 | b:1 | b:1 | translate:1 | translate:1 |
| ZP | 2 | 2 | b:1 R:1 | b:1 R:1 | translate:1 | translate:1 |

#### pointOnLine

Fusion's rule (fitted on the 21 accepted one-mover cells of the free-standing line pair): rank the levels {0,4,m} < {3,o} < {7} (lowest moves first); the operand with the LOWER rank is the one that moves, a tie means the SECOND pick moves. It predicts 20 of 21; contradicting cells: pointOnLine|LL|4,3. In words: the operand held least (levels 0, 4, m) is the one that gives way, the most held (7) always stays; two operands at the same rank: the first pick stays and the second is moved.

Grid, line (A) x line (B), `Fusion/ours`:

| A \ B | 0 free | 3 H/V | 4 end fixed | 7 full | o end at origin | m mid at origin |
|---|---|---|---|---|---|---|
| 0 free | b/b | a/a | b/b | a/a |  |  |
| 3 H/V | b/b | b/b | b/b | a/a |  |  |
| 4 end fixed | b/b | b/b | b/b | R/R |  |  |
| 7 full | b/b | b/b | b/b | R/R |  |  |
| o end at origin | b/b | b/b | b/b | R/R |  |  |
| m mid at origin | b/b | a/a | b/b | a/a |  |  |

| kinds (A,B) | cells | same | Fusion who-moves | ours who-moves | how Fusion moves it | how ours moves it |
|---|---|---|---|---|---|---|
| LL | 24 | 24 | a:5 b:16 R:3 | a:5 b:16 R:3 | translate:13 one end:6 stretch:2 | translate:13 one end:6 stretch:2 |
| LC | 12 | 12 | b:12 | b:12 | translate:6 one end:6 | translate:6 one end:6 |
| LS | 6 | 6 | a:3 b:3 | a:3 b:3 | translate:5 stretch:1 | translate:5 stretch:1 |
| LR | 12 | 12 | a:6 b:3 R:3 | a:6 b:3 R:3 | translate:7 stretch:2 | translate:7 stretch:2 |
| RL | 4 | 4 | a:1 b:3 | a:1 b:3 | translate:3 one end:1 | translate:3 one end:1 |
| RC | 2 | 2 | b:2 | b:2 | translate:1 one end:1 | translate:1 one end:1 |
| RS | 1 | 1 | a:1 | a:1 | translate:1 | translate:1 |
| RR | 2 | 2 | a:1 b:1 | a:1 b:1 | translate:2 | translate:2 |
| OL | 8 | 8 | a:3 b:4 R:1 | a:3 b:4 R:1 | translate:5 one end:2 | translate:5 one end:2 |
| OC | 4 | 4 | a:1 b:3 | a:1 b:3 | translate:2 one end:2 | translate:2 one end:2 |
| OS | 2 | 2 | a:1 b:1 | a:1 b:1 | translate:2 | translate:2 |
| OR | 4 | 4 | a:2 b:1 R:1 | a:2 b:1 R:1 | translate:3 | translate:3 |
| AL | 4 | 4 | a:1 b:3 | a:1 b:3 | translate:3 one end:1 | translate:3 one end:1 |
| AC | 2 | 2 | b:2 | b:2 | translate:1 one end:1 | translate:1 one end:1 |
| AS | 1 | 1 | a:1 | a:1 | translate:1 | translate:1 |
| AR | 2 | 2 | a:2 | a:2 | translate:2 | translate:2 |
| PL | 8 | 8 | a:4 b:3 R:1 | a:4 b:3 R:1 | translate:6 one end:1 | translate:6 one end:1 |
| PC | 4 | 4 | a:2 b:2 | a:2 b:2 | translate:3 one end:1 | translate:3 one end:1 |
| PS | 2 | 2 | a:1 b:1 | a:1 b:1 | translate:2 | translate:2 |
| PR | 4 | 4 | a:2 b:1 R:1 | a:2 b:1 R:1 | translate:3 | translate:3 |
| ZL | 4 | 4 | b:3 R:1 | b:3 R:1 | translate:2 one end:1 | translate:2 one end:1 |
| ZC | 2 | 2 | b:2 | b:2 | translate:1 one end:1 | translate:1 one end:1 |
| ZS | 1 | 1 | b:1 | b:1 | translate:1 | translate:1 |
| ZR | 2 | 2 | b:1 R:1 | b:1 R:1 | translate:1 | translate:1 |

#### pointOnCircle

| kinds (A,B) | cells | same | Fusion who-moves | ours who-moves | how Fusion moves it | how ours moves it |
|---|---|---|---|---|---|---|
| LO | 24 | 24 | a:6 b:15 R:3 | a:6 b:15 R:3 | translate:16 radius:3 stretch:2 | translate:16 radius:3 stretch:2 |
| LA | 24 | 24 | a:12 b:9 R:3 | a:12 b:9 R:3 | translate:14 stretch:4 scale+radius:3 | translate:14 stretch:4 scale+radius:3 |
| LF | 12 | 11 | a:6 b:3 R:3 | a:6 b:3 R:3 | translate:5 deform:2 stretch:2 | translate:4 deform:3 stretch:2 |
| RO | 4 | 4 | a:2 b:2 | a:2 b:2 | translate:4 | translate:4 |
| RA | 4 | 4 | a:2 b:2 | a:2 b:2 | translate:4 | translate:4 |
| RF | 2 | 1 | a:1 b:1 | a:2 | deform:1 translate:1 | translate:2 |
| OO | 8 | 8 | a:2 b:5 R:1 | a:2 b:5 R:1 | translate:6 radius:1 | translate:6 radius:1 |
| OA | 8 | 8 | a:4 b:3 R:1 | a:4 b:3 R:1 | translate:6 scale+radius:1 | translate:6 scale+radius:1 |
| OF | 4 | 4 | a:2 b:1 R:1 | a:2 b:1 R:1 | translate:2 deform:1 | translate:2 deform:1 |
| AO | 4 | 4 | a:2 b:2 | a:2 b:2 | translate:4 | translate:4 |
| AA | 4 | 3 | a:3 b:1 | a:2 b:2 | translate:4 | translate:4 |
| AF | 2 | 2 | a:2 | a:2 | translate:2 | translate:2 |
| PO | 8 | 8 | a:4 b:3 R:1 | a:4 b:3 R:1 | translate:6 radius:1 | translate:6 radius:1 |
| PA | 8 | 8 | a:4 b:3 R:1 | a:4 b:3 R:1 | translate:6 scale+radius:1 | translate:6 scale+radius:1 |
| PF | 4 | 0 | R:4 | -:4 |  |  |
| ZO | 4 | 4 | b:3 R:1 | b:3 R:1 | translate:2 radius:1 | translate:2 radius:1 |
| ZA | 4 | 4 | b:3 R:1 | b:3 R:1 | translate:2 scale+radius:1 | translate:2 scale+radius:1 |
| ZF | 2 | 1 | b:1 R:1 | b:1 R:1 | translate:1 | deform:1 |

#### midpoint

Fusion's rule (fitted on the 21 accepted one-mover cells of the free-standing line pair): rank the levels {0,4,m} < {3,o} < {7} (lowest moves first); the operand with the LOWER rank is the one that moves, a tie means the SECOND pick moves. It predicts 20 of 21; contradicting cells: midpoint|LL|4,3. In words: the operand held least (levels 0, 4, m) is the one that gives way, the most held (7) always stays; two operands at the same rank: the first pick stays and the second is moved.

Grid, line (A) x line (B), `Fusion/ours`:

| A \ B | 0 free | 3 H/V | 4 end fixed | 7 full | o end at origin | m mid at origin |
|---|---|---|---|---|---|---|
| 0 free | b/b | a/a | b/b | a/a |  |  |
| 3 H/V | b/b | b/b | b/b | a/a |  |  |
| 4 end fixed | b/b | b/b | b/b | R/R |  |  |
| 7 full | b/b | b/b | b/b | R/R |  |  |
| o end at origin | b/b | b/b | b/b | R/R |  |  |
| m mid at origin | b/b | a/a | b/b | a/a |  |  |

| kinds (A,B) | cells | same | Fusion who-moves | ours who-moves | how Fusion moves it | how ours moves it |
|---|---|---|---|---|---|---|
| LL | 24 | 24 | a:5 b:16 R:3 | a:5 b:16 R:3 | translate:13 one end:6 stretch:2 | translate:13 one end:6 stretch:2 |
| LC | 12 | 12 | b:12 | b:12 | translate:6 one end:6 | translate:6 one end:6 |
| LS | 6 | 6 | a:3 b:3 | a:3 b:3 | translate:5 stretch:1 | translate:5 stretch:1 |
| LR | 12 | 12 | a:6 b:3 R:3 | a:6 b:3 R:3 | translate:7 stretch:2 | translate:7 stretch:2 |
| RL | 4 | 4 | a:1 b:3 | a:1 b:3 | translate:3 one end:1 | translate:3 one end:1 |
| RC | 2 | 2 | b:2 | b:2 | translate:1 one end:1 | translate:1 one end:1 |
| RS | 1 | 1 | a:1 | a:1 | translate:1 | translate:1 |
| RR | 2 | 2 | a:1 b:1 | a:1 b:1 | translate:2 | translate:2 |
| OL | 8 | 8 | a:3 b:4 R:1 | a:3 b:4 R:1 | translate:5 one end:2 | translate:5 one end:2 |
| OC | 4 | 4 | a:1 b:3 | a:1 b:3 | translate:2 one end:2 | translate:2 one end:2 |
| OS | 2 | 2 | a:1 b:1 | a:1 b:1 | translate:2 | translate:2 |
| OR | 4 | 4 | a:2 b:1 R:1 | a:2 b:1 R:1 | translate:3 | translate:3 |
| AL | 4 | 4 | a:1 b:3 | a:1 b:3 | translate:3 one end:1 | translate:3 one end:1 |
| AC | 2 | 2 | b:2 | b:2 | translate:1 one end:1 | translate:1 one end:1 |
| AS | 1 | 1 | a:1 | a:1 | translate:1 | translate:1 |
| AR | 2 | 2 | a:2 | a:2 | translate:2 | translate:2 |
| PL | 8 | 8 | a:4 b:3 R:1 | a:4 b:3 R:1 | translate:6 one end:1 | translate:6 one end:1 |
| PC | 4 | 4 | a:2 b:2 | a:2 b:2 | translate:3 one end:1 | translate:3 one end:1 |
| PS | 2 | 2 | a:1 b:1 | a:1 b:1 | translate:2 | translate:2 |
| PR | 4 | 4 | a:2 b:1 R:1 | a:2 b:1 R:1 | translate:3 | translate:3 |
| ZL | 4 | 4 | b:3 R:1 | b:3 R:1 | translate:2 one end:1 | translate:2 one end:1 |
| ZC | 2 | 2 | b:2 | b:2 | translate:1 one end:1 | translate:1 one end:1 |
| ZS | 1 | 1 | b:1 | b:1 | translate:1 | translate:1 |
| ZR | 2 | 2 | b:1 R:1 | b:1 R:1 | translate:1 | translate:1 |

#### equal-circle

| kinds (A,B) | cells | same | Fusion who-moves | ours who-moves | how Fusion moves it | how ours moves it |
|---|---|---|---|---|---|---|
| OO | 16 | 12 | -:12 R:4 | -:16 |  |  |
| OA | 16 | 4 | R:16 | a:5 b:7 R:4 |  | radius:5 scale+radius:4 deform+radius:3 |
| OF | 8 | 4 | R:8 | a:4 R:4 |  | radius:4 |
| AO | 16 | 4 | R:16 | a:5 b:7 R:4 |  | radius:7 scale+radius:3 deform+radius:2 |
| AA | 16 | 12 | -:12 R:4 | -:16 |  |  |
| AF | 8 | 6 | a:4 R:4 | a:4 R:4 | scale+radius:4 | deform+radius:2 scale+radius:2 |
| FO | 8 | 4 | R:8 | b:4 R:4 |  | radius:4 |
| FA | 8 | 6 | b:4 R:4 | b:4 R:4 | scale+radius:4 | deform+radius:2 scale+radius:2 |
| FF | 4 | 0 | R:4 | -:4 |  |  |

#### tangent-line-circle

| kinds (A,B) | cells | same | Fusion who-moves | ours who-moves | how Fusion moves it | how ours moves it |
|---|---|---|---|---|---|---|
| LO | 16 | 15 | a:8 b:7 R:1 | a:8 b:7 R:1 | translate:10 stretch:2 one end:2 radius:1 | translate:9 stretch:3 one end:2 radius:1 |
| LA | 16 | 16 | a:10 b:5 R:1 | a:10 b:5 R:1 | translate:8 stretch:4 one end:2 scale+radius:1 | translate:8 stretch:4 one end:2 scale+radius:1 |
| LF | 8 | 5 | a:5 b:2 R:1 | a:6 b:1 R:1 | stretch:2 translate:2 deform:2 one end:1 | stretch:4 one end:2 deform:1 |
| CO | 8 | 7 | a:5 b:3 | a:5 b:3 | translate:4 stretch:2 one end:2 | stretch:3 translate:3 one end:2 |
| CA | 8 | 8 | a:6 b:2 | a:6 b:2 | stretch:4 translate:2 one end:2 | stretch:4 translate:2 one end:2 |
| CF | 4 | 3 | a:3 b:1 | a:4 | stretch:2 deform:1 one end:1 | stretch:2 one end:2 |
| SO | 4 | 4 | a:3 b:1 | a:3 b:1 | scale:3 translate:1 | scale:3 translate:1 |
| SA | 4 | 4 | a:4 | a:4 | scale:4 | scale:4 |
| SF | 2 | 2 | a:2 | a:2 | scale:2 | scale:2 |
| RO | 8 | 8 | a:3 b:4 R:1 | a:3 b:4 R:1 | deform:3 translate:3 radius:1 | deform:3 translate:3 radius:1 |
| RA | 8 | 8 | a:4 b:3 R:1 | a:4 b:3 R:1 | deform:4 translate:2 scale+radius:1 | deform:4 translate:2 scale+radius:1 |
| RF | 4 | 4 | a:2 b:1 R:1 | a:2 b:1 R:1 | deform:3 | deform:3 |
| OL | 16 | 15 | a:7 b:8 R:1 | a:7 b:8 R:1 | translate:10 stretch:2 one end:2 radius:1 | translate:9 stretch:3 one end:2 radius:1 |
| OC | 8 | 7 | a:3 b:5 | a:3 b:5 | translate:4 stretch:2 one end:2 | stretch:3 translate:3 one end:2 |
| OS | 4 | 4 | a:1 b:3 | a:1 b:3 | scale:3 translate:1 | scale:3 translate:1 |
| OR | 8 | 8 | a:4 b:3 R:1 | a:4 b:3 R:1 | deform:3 translate:3 radius:1 | deform:3 translate:3 radius:1 |
| AL | 16 | 16 | a:5 b:10 R:1 | a:5 b:10 R:1 | translate:8 stretch:4 one end:2 scale+radius:1 | translate:8 stretch:4 one end:2 scale+radius:1 |
| AC | 8 | 8 | a:2 b:6 | a:2 b:6 | stretch:4 translate:2 one end:2 | stretch:4 translate:2 one end:2 |
| AS | 4 | 4 | b:4 | b:4 | scale:4 | scale:4 |
| AR | 8 | 8 | a:3 b:4 R:1 | a:3 b:4 R:1 | deform:4 translate:2 scale+radius:1 | deform:4 translate:2 scale+radius:1 |
| FL | 8 | 5 | a:2 b:5 R:1 | a:1 b:6 R:1 | stretch:2 translate:2 deform:2 one end:1 | stretch:4 one end:2 deform:1 |
| FC | 4 | 3 | a:1 b:3 | b:4 | stretch:2 deform:1 one end:1 | stretch:2 one end:2 |
| FS | 2 | 2 | b:2 | b:2 | scale:2 | scale:2 |
| FR | 4 | 4 | a:1 b:2 R:1 | a:1 b:2 R:1 | deform:3 | deform:3 |

#### tangent-circle-circle

| kinds (A,B) | cells | same | Fusion who-moves | ours who-moves | how Fusion moves it | how ours moves it |
|---|---|---|---|---|---|---|
| OO | 16 | 16 | a:5 b:10 R:1 | a:5 b:10 R:1 | translate:7 translate+radius:4 radius:4 | translate:7 translate+radius:4 radius:4 |
| OA | 16 | 16 | a:12 b:3 R:1 | a:12 b:3 R:1 | translate+radius:4 radius:4 translate:4 deform+radius:1 | translate+radius:4 radius:4 translate:4 deform+radius:1 |
| OF | 8 | 8 | a:4 b:3 R:1 | a:4 b:3 R:1 | deform:3 translate:2 translate+radius:1 radius:1 | deform:3 translate:2 translate+radius:1 radius:1 |
| AO | 16 | 16 | a:3 b:12 R:1 | a:3 b:12 R:1 | translate+radius:4 radius:4 translate:4 deform+radius:1 | translate+radius:4 radius:4 translate:4 deform+radius:1 |
| AA | 16 | 16 | a:5 b:10 R:1 | a:5 b:10 R:1 | deform:7 deform+radius:4 scale+radius:4 | deform:7 deform+radius:4 scale+radius:4 |
| AF | 8 | 8 | a:3 b:4 R:1 | a:3 b:4 R:1 | deform:5 deform+radius:1 scale+radius:1 | deform:5 deform+radius:1 scale+radius:1 |
| FO | 8 | 8 | a:3 b:4 R:1 | a:3 b:4 R:1 | deform:3 translate:2 translate+radius:1 radius:1 | deform:3 translate:2 translate+radius:1 radius:1 |
| FA | 8 | 8 | a:4 b:3 R:1 | a:4 b:3 R:1 | deform:5 deform+radius:1 scale+radius:1 | deform:5 deform+radius:1 scale+radius:1 |
| FF | 4 | 4 | a:1 b:2 R:1 | a:1 b:2 R:1 | deform:3 | deform:3 |

#### horizontal-line

Single operand: L@0: F one end / - | ours stretch / -; L@3: F refused | ours refused; L@4: F one end / - | ours one end / -; L@7: F refused | ours refused; C@0: F one end / - | ours stretch / -; C@4: F one end / - | ours one end / -; S@0: F scale / - | ours scale / -; R@0: F refused | ours refused; R@8: F refused | ours refused

| kinds (A,B) | cells | same | Fusion who-moves | ours who-moves | how Fusion moves it | how ours moves it |
|---|---|---|---|---|---|---|
| L | 4 | 3 | a:2 R:2 | a:2 R:2 | one end:2 | stretch:1 one end:1 |
| C | 2 | 1 | a:2 | a:2 | one end:2 | stretch:1 one end:1 |
| S | 1 | 1 | a:1 | a:1 | scale:1 | scale:1 |
| R | 2 | 2 | R:2 | R:2 |  |  |

#### vertical-line

Single operand: L@0: F one end / - | ours stretch / -; L@3: F refused | ours refused; L@4: F one end / - | ours one end / -; L@7: F refused | ours refused; C@0: F one end / - | ours stretch / -; C@4: F one end / - | ours one end / -; S@0: F scale / - | ours scale / -; R@0: F refused | ours refused; R@8: F refused | ours refused

| kinds (A,B) | cells | same | Fusion who-moves | ours who-moves | how Fusion moves it | how ours moves it |
|---|---|---|---|---|---|---|
| L | 4 | 3 | a:2 R:2 | a:2 R:2 | one end:2 | stretch:1 one end:1 |
| C | 2 | 1 | a:2 | a:2 | one end:2 | stretch:1 one end:1 |
| S | 1 | 1 | a:1 | a:1 | scale:1 | scale:1 |
| R | 2 | 2 | R:2 | R:2 |  |  |

#### dim-length

Single operand: L@0: F one end / - | ours stretch / -; L@3: F one end / - | ours stretch / -; L@4: F one end / - | ours one end / -; L@7: F refused | ours refused; C@0: F one end / - | ours stretch / -; C@4: F one end / - | ours one end / -; S@0: F scale / - | ours scale / -; R@0: F deform / - | ours deform / -; R@8: F refused | ours . / - (reference)

| kinds (A,B) | cells | same | Fusion who-moves | ours who-moves | how Fusion moves it | how ours moves it |
|---|---|---|---|---|---|---|
| L | 4 | 2 | a:3 R:1 | a:3 R:1 | one end:3 | stretch:2 one end:1 |
| C | 2 | 1 | a:2 | a:2 | one end:2 | stretch:1 one end:1 |
| S | 1 | 1 | a:1 | a:1 | scale:1 | scale:1 |
| R | 2 | 1 | a:1 R:1 | a:1 -:1 | deform:1 | deform:1 |

#### dim-radius

Single operand: O@0: F radius / - | ours radius / -; O@c: F radius / - | ours radius / -; O@r: F refused | ours refused; O@cr: F refused | ours refused; A@0: F scale+radius / - | ours deform+radius / -; A@c: F scale+radius / - | ours scale+radius / -; A@r: F refused | ours refused; A@cr: F refused | ours refused; F@0: F refused | ours refused; F@c: F refused | ours refused

| kinds (A,B) | cells | same | Fusion who-moves | ours who-moves | how Fusion moves it | how ours moves it |
|---|---|---|---|---|---|---|
| O | 4 | 4 | a:2 R:2 | a:2 R:2 | radius:2 | radius:2 |
| A | 4 | 3 | a:2 R:2 | a:2 R:2 | scale+radius:2 | deform+radius:1 scale+radius:1 |
| F | 2 | 2 | R:2 | R:2 |  |  |

Kind letters: L line, C construction line, S polygon side, R rect side, O circle, A arc, F fillet arc, P point, Z origin. Who-moves letters as above (`a` first pick only, `b` second only, `X` both, `-` none, `R` refused). `how`: translate, rotate (rigid), stretch (a line changes length), `one end` (one endpoint of a line moves: rotate / stretch about the other), scale, deform, radius, `+radius` (the radius changed as well).

<!-- graded:end -->


## Per drawing: Fusion's answers step by step

<!-- drawings:begin -->

Rows are one per recipe step; `same?` needs the outcome (accepted / reference / refused), the per-shape and sketch "fully constrained" flags and the coordinates to agree. Coordinates: the same solution within 0.01 mm, or "another valid branch": Fusion landed elsewhere but its geometry satisfies OUR constraint set (residual <= 1e-3). Fusion has no DOF count, so the flags are `isFullyConstrained` of each entity and of the sketch; ours is "every joint of the shape has zero freedom (the finite-difference nullspace)", plus, for a circle, a driving radius dimension (a circle's radius is shape data: audit O2).

| drawing | recipe steps | comparisons | same | KNOWN differences |
|---|---|---|---|---|
| plate (round 1) | 20 | 96 | 84 | 12 |
| trapezoid (round 1) | 9 | 54 | 49 | 5 |
| bracket (round 1) | 30 | 148 | 126 | 22 |
| triangle (round 1) | 10 | 45 | 34 | 11 |
| polygon (round 1) | 11 | 54 | 51 | 3 |
| scurve (round 2) | 11 | 54 | 45 | 9 |
| slot (round 2) | 11 | 46 | 40 | 6 |
| collinear-concentric (round 2) | 18 | 94 | 86 | 8 |
| axis-symmetry (round 2) | 15 | 76 | 73 | 3 |
| welded-T (round 2) | 15 | 76 | 61 | 15 |
| filleted-polygon (round 2) | 9 | 55 | 45 | 10 |
| every-kind (round 2) | 19 | 106 | 89 | 17 |
| two-sketches (round 2) | 9 | 50 | 46 | 4 |

#### plate: Plate: filleted rectangle + 4 holes (round 1)

* fillets are an arc + tangent constraints + a radius dimension + a virtual sharp point (a plain sketch point on both lines), as the fillet tool builds them
* units: ours mm, Fusion API cm (x 0.1 on the way in); angle dimensions are given in degrees

| step | ours | Fusion | same? | coordinates | fully constrained (per shape, F = yes) ours / Fusion |
|---|---|---|---|---|---|
| 1 centre: midpoint(vTL,vBR) = origin | accepted | accepted | yes | same | ............ / ............ ; sketch: nullity 14 / not fully constrained |
| 2 width  vTL-vTR (horizontal) 200 | accepted | accepted | **NO** | same | ............ / .F.F........ * ; sketch: nullity 13 / not fully constrained |
| 3 height vTR-vBR (vertical) 120 | accepted | accepted | yes | same | FFFFFFFF.... / FFFFFFFF.... ; sketch: nullity 12 / not fully constrained |
| 4 delete R dim of fillet TR (keep TL) | accepted | accepted | **NO** | same | ..FF.FFF.... / FFFF.FFF.... * ; sketch: nullity 13 / not fully constrained |
| 5 delete R dim of fillet BR | accepted | accepted | **NO** | same | ...F..FF.... / FFFF..FF.... * ; sketch: nullity 14 / not fully constrained |
| 6 delete R dim of fillet BL | accepted | accepted | **NO** | same | .......F.... / FFFF...F.... * ; sketch: nullity 15 / not fully constrained |
| 7 equal radius aTR = aTL | accepted | accepted | **NO** | same | F...F..F.... / FFFFF..F.... * ; sketch: nullity 14 / not fully constrained |
| 8 equal radius aBR = aTL | accepted | accepted | **NO** | same | FF..FF.F.... / FFFFFF.F.... * ; sketch: nullity 13 / not fully constrained |
| 9 equal radius aBL = aTL | accepted | accepted | yes | same | FFFFFFFF.... / FFFFFFFF.... ; sketch: nullity 12 / not fully constrained |
| 10 hole centres c1-c2 horizontal | accepted | accepted | yes | same | FFFFFFFF.... / FFFFFFFF.... ; sketch: nullity 11 / not fully constrained |
| 11 hole centres c2-c3 vertical | accepted | accepted | yes | same | FFFFFFFF.... / FFFFFFFF.... ; sketch: nullity 10 / not fully constrained |
| 12 hole centres c3-c4 horizontal | accepted | accepted | yes | same | FFFFFFFF.... / FFFFFFFF.... ; sketch: nullity 9 / not fully constrained |
| 13 hole centres c4-c1 vertical | accepted | accepted | yes | same | FFFFFFFF.... / FFFFFFFF.... ; sketch: nullity 8 / not fully constrained |
| 14 holes symmetric: midpoint(c1,c3) = origin | accepted | accepted | yes | same | FFFFFFFF.... / FFFFFFFF.... ; sketch: nullity 6 / not fully constrained |
| 15 hole spacing c1-c2 (horizontal) 140 | accepted | accepted | yes | same | FFFFFFFF.... / FFFFFFFF.... ; sketch: nullity 5 / not fully constrained |
| 16 hole spacing c2-c3 (vertical) 70 | accepted | accepted | yes | same | FFFFFFFF.... / FFFFFFFF.... ; sketch: nullity 4 / not fully constrained |
| 17 hole radius h1 = 8 | accepted | accepted | yes | same | FFFFFFFFF... / FFFFFFFFF... ; sketch: nullity 3 / not fully constrained |
| 18 equal radius h2 = h1 | accepted | accepted | **NO** | same | FFFFFFFFF... / FFFFFFFFFF.. * ; sketch: nullity 2 / not fully constrained |
| 19 equal radius h3 = h1 | accepted | accepted | **NO** | same | FFFFFFFFF... / FFFFFFFFFFF. * ; sketch: nullity 1 / not fully constrained |
| 20 equal radius h4 = h1 | accepted | accepted | **NO** | same | FFFFFFFFF... / FFFFFFFFFFFF * ; sketch: nullity 0 / fully constrained * |

Step E, 12 dimension edits (0.8x, 1.25x): 12 agree (accepted or refused alike).

Step F: redundant dimension: ours reference, Fusion refused (3 : VCS_SKETCH_OVER_CONSTRAINTS - Sketch geometry is over co) *; conflict dimension: ours reference, Fusion refused (3 : VCS_SKETCH_OVER_CONSTRAINTS - Sketch geometry is over co) *; delete one dimension: ours accepted, Fusion accepted; delete one dimension: fully constrained afterwards?: ours nullity 1, Fusion not fully constrained.

Divergences and verdicts:

* UNCLEAR: per-entity "fully constrained" differs; circles: a circle's radius is shape data in ours (O2) while Fusion needs a radius dimension; otherwise it follows an upstream refusal difference: step 1 full, step 3 full, step 4 full, step 5 full, step 6 full, step 7 full, step 17 full, step 18 full, step 19 full
* UNCLEAR: same cause as the per-entity flags (O2 circle radius, or an upstream refusal difference): step 19 sketchFull
* FUSION DIFFERENT BY DESIGN: Fusion refuses an over-constraining dimension (VCS_SKETCH_OVER_CONSTRAINTS); ours keeps it as a driven reference (O3: the owner's ruling on references decides): redundant outcome, conflict outcome

#### trapezoid: Trapezoid: slanted sides, centre line, 4 fillets (owner shape) (round 1)

* fillets are an arc + tangent constraints + a radius dimension + a virtual sharp point (a plain sketch point on both lines), as the fillet tool builds them
* units: ours mm, Fusion API cm (x 0.1 on the way in); angle dimensions are given in degrees

| step | ours | Fusion | same? | coordinates | fully constrained (per shape, F = yes) ours / Fusion |
|---|---|---|---|---|---|
| 1 top line horizontal | accepted | accepted | yes | another valid branch | ......... / ......... ; sketch: nullity 11 / not fully constrained |
| 2 bottom line horizontal | accepted | accepted | yes | another valid branch | ......... / ......... ; sketch: nullity 10 / not fully constrained |
| 3 centre line vertical | accepted | accepted | yes | another valid branch | ......... / ......... ; sketch: nullity 9 / not fully constrained |
| 4 midpoint of top edge = P | accepted | accepted | yes | another valid branch | ......... / ......... ; sketch: nullity 7 / not fully constrained |
| 5 midpoint of bottom edge = Q | accepted | accepted | yes | another valid branch | ......... / ......... ; sketch: nullity 5 / not fully constrained |
| 6 Q at the origin | accepted | accepted | **NO** | another valid branch | ......... / ..F.....F * ; sketch: nullity 3 / not fully constrained |
| 7 height (line-to-line) 431.8 | accepted | accepted | **NO** | another valid branch | ........F / F.F.....F * ; sketch: nullity 2 / not fully constrained |
| 8 bottom width vBL-vBR 150 | accepted | accepted | **NO** | another valid branch | ........F / F.F.....F * ; sketch: nullity 1 / not fully constrained |
| 9 top width vTL-vTR 400 | accepted | accepted | yes | another valid branch | FFFFFFFFF / FFFFFFFFF ; sketch: fully constrained / fully constrained |

Step E, 14 dimension edits (0.8x, 1.25x): 14 agree (accepted or refused alike).

Step F: redundant dimension: ours reference, Fusion refused (3 : VCS_SKETCH_OVER_CONSTRAINTS - Sketch geometry is over co) *; conflict dimension: ours reference, Fusion refused (3 : VCS_SKETCH_OVER_CONSTRAINTS - Sketch geometry is over co) *; delete one dimension: ours accepted, Fusion accepted; delete one dimension: fully constrained afterwards?: ours nullity 1, Fusion not fully constrained.

Divergences and verdicts:

* UNCLEAR: per-entity "fully constrained" differs; circles: a circle's radius is shape data in ours (O2) while Fusion needs a radius dimension; otherwise it follows an upstream refusal difference: step 5 full, step 6 full, step 7 full
* FUSION DIFFERENT BY DESIGN: Fusion refuses an over-constraining dimension (VCS_SKETCH_OVER_CONSTRAINTS); ours keeps it as a driven reference (O3: the owner's ruling on references decides): redundant outcome, conflict outcome

#### bracket: Bracket: 8-line L outline + slot + hole (round 1)

* fillets are an arc + tangent constraints + a radius dimension + a virtual sharp point (a plain sketch point on both lines), as the fillet tool builds them
* units: ours mm, Fusion API cm (x 0.1 on the way in); angle dimensions are given in degrees

| step | ours | Fusion | same? | coordinates | fully constrained (per shape, F = yes) ours / Fusion |
|---|---|---|---|---|---|
| 1 A at the origin | accepted | accepted | yes | same | ............. / ............. ; sketch: nullity 27 / not fully constrained |
| 2 AB horizontal | accepted | accepted | **NO** | same | ............. / F............ * ; sketch: nullity 26 / not fully constrained |
| 3 CD vertical | accepted | accepted | **NO** | same | ............. / F............ * ; sketch: nullity 25 / not fully constrained |
| 4 DE horizontal | accepted | accepted | **NO** | same | ............. / F............ * ; sketch: nullity 24 / not fully constrained |
| 5 EF vertical | accepted | accepted | **NO** | same | ............. / F............ * ; sketch: nullity 23 / not fully constrained |
| 6 FG horizontal | accepted | accepted | **NO** | same | ............. / F............ * ; sketch: nullity 22 / not fully constrained |
| 7 HA vertical | accepted | accepted | **NO** | same | ............. / F......F..... * ; sketch: nullity 21 / not fully constrained |
| 8 AB length 130 | accepted | accepted | **NO** | same | F............ / F......F..... * ; sketch: nullity 20 / not fully constrained |
| 9 chamfer BC across 10 | accepted | accepted | **NO** | same | F............ / F.F....F..... * ; sketch: nullity 19 / not fully constrained |
| 10 chamfer BC up 10 | accepted | accepted | **NO** | same | FF........... / FFF....F..... * ; sketch: nullity 18 / not fully constrained |
| 11 CD length 30 | accepted | accepted | **NO** | same | FFF.......... / FFFF...F..... * ; sketch: nullity 17 / not fully constrained |
| 12 DE length 100 | accepted | accepted | **NO** | same | FFFF......... / FFFFF..F..... * ; sketch: nullity 16 / not fully constrained |
| 13 EF length 100 | accepted | accepted | **NO** | same | FFFFF........ / FFFFFF.F..... * ; sketch: nullity 15 / not fully constrained |
| 14 FG length 30 | accepted | accepted | **NO** | same | FFFFFF....... / FFFFFF.F..... * ; sketch: nullity 14 / not fully constrained |
| 15 chamfer GH down 10 | accepted | accepted | yes | same | FFFFFFFF..... / FFFFFFFF..... ; sketch: nullity 13 / not fully constrained |
| 16 slot left end: midpoint(a1,b1)=CL | accepted | accepted | yes | same | FFFFFFFF..... / FFFFFFFF..... ; sketch: nullity 12 / not fully constrained |
| 17 slot right end: midpoint(a2,b2)=CR | accepted | accepted | yes | same | FFFFFFFF..... / FFFFFFFF..... ; sketch: nullity 11 / not fully constrained |
| 18 slot top line tangent to left arc | accepted | accepted | yes | same | FFFFFFFF..... / FFFFFFFF..... ; sketch: nullity 10 / not fully constrained |
| 19 slot top line tangent to right arc | accepted | accepted | yes | same | FFFFFFFF..... / FFFFFFFF..... ; sketch: nullity 9 / not fully constrained |
| 20 slot bottom line tangent to left arc | accepted | accepted | yes | same | FFFFFFFF..... / FFFFFFFF..... ; sketch: nullity 8 / not fully constrained |
| 21 slot bottom line tangent to right arc | accepted | refused (3 : failed to create offset: VCS_SKETCH_OVER_CONSTRAINTS - S) | **NO** | - | - |
| 22 slot arcs equal radius | accepted | refused (3 : failed to create offset: VCS_SKETCH_OVER_CONSTRAINTS - S) | **NO** | - | - |
| 23 slot radius 8 | accepted | accepted | yes | same | FFFFFFFF..... / FFFFFFFF..... ; sketch: nullity 7 / not fully constrained |
| 24 slot axis horizontal CL-CR | accepted | accepted | yes | same | FFFFFFFF..... / FFFFFFFF..... ; sketch: nullity 6 / not fully constrained |
| 25 slot length CL-CR 50 | accepted | accepted | yes | same | FFFFFFFF..... / FFFFFFFF..... ; sketch: nullity 5 / not fully constrained |
| 26 slot position: CL x = 60 from A | accepted | accepted | yes | same | FFFFFFFF..... / FFFFFFFF..... ; sketch: nullity 4 / not fully constrained |
| 27 slot position: CL y = 20 from A | accepted | accepted | **NO** | same | FFFFFFFFFFFF. / FFFFFFFFF.... * ; sketch: nullity 3 / not fully constrained |
| 28 hole x = 20 from A | accepted | accepted | **NO** | same | FFFFFFFFFFFF. / FFFFFFFFF.... * ; sketch: nullity 2 / not fully constrained |
| 29 hole y = 90 from A | accepted | accepted | **NO** | same | FFFFFFFFFFFF. / FFFFFFFFF.... * ; sketch: nullity 1 / not fully constrained |
| 30 hole radius 8 | accepted | accepted | **NO** | same | FFFFFFFFFFFFF / FFFFFFFFF...F * ; sketch: fully constrained / not fully constrained * |

Step E, 30 dimension edits (0.8x, 1.25x): 30 agree (accepted or refused alike).

Step F: redundant dimension: ours reference, Fusion refused (3 : VCS_SKETCH_OVER_CONSTRAINTS - Sketch geometry is over co) *; conflict dimension: ours reference, Fusion refused (3 : VCS_SKETCH_OVER_CONSTRAINTS - Sketch geometry is over co) *; delete one dimension: ours accepted, Fusion accepted; delete one dimension: fully constrained afterwards?: ours nullity 1, Fusion not fully constrained.

Divergences and verdicts:

* UNCLEAR: per-entity "fully constrained" differs; circles: a circle's radius is shape data in ours (O2) while Fusion needs a radius dimension; otherwise it follows an upstream refusal difference: step 1 full, step 2 full, step 3 full, step 4 full, step 5 full, step 6 full, step 7 full, step 8 full, step 9 full, step 10 full, step 11 full, step 12 full (+5 more)
* UNCLEAR / O1: a redundant geometric constraint: Fusion refuses it as over-constrained, ours accepts it silently (audit O1: "the app flags redundant dimensions but not redundant constraints"): step 20 outcome, step 21 outcome
* UNCLEAR: same cause as the per-entity flags (O2 circle radius, or an upstream refusal difference): step 29 sketchFull
* FUSION DIFFERENT BY DESIGN: Fusion refuses an over-constraining dimension (VCS_SKETCH_OVER_CONSTRAINTS); ours keeps it as a driven reference (O3: the owner's ruling on references decides): redundant outcome, conflict outcome

#### triangle: Triangle + inscribed circle (three tangents) (round 1)

* fillets are an arc + tangent constraints + a radius dimension + a virtual sharp point (a plain sketch point on both lines), as the fillet tool builds them
* units: ours mm, Fusion API cm (x 0.1 on the way in); angle dimensions are given in degrees

| step | ours | Fusion | same? | coordinates | fully constrained (per shape, F = yes) ours / Fusion |
|---|---|---|---|---|---|
| 1 A at the origin | accepted | accepted | yes | same | ..... / ..... ; sketch: nullity 9 / not fully constrained |
| 2 base AB horizontal | accepted | accepted | **NO** | same | ..... / F.... * ; sketch: nullity 8 / not fully constrained |
| 3 equal sides CA = BC | accepted | accepted | **NO** | same | ..... / F.... * ; sketch: nullity 7 / not fully constrained |
| 4 interior angle at A = 70 (the dimension reads the angle between the di | accepted | accepted | **NO** | same | ..... / F.F.. * ; sketch: nullity 6 / not fully constrained |
| 5 M = midpoint of the base | accepted | accepted | **NO** | same | ..... / F.F.. * ; sketch: nullity 4 / not fully constrained |
| 6 circle centre on the axis C-M | accepted | accepted | **NO** | same | ..... / F.F.. * ; sketch: nullity 3 / not fully constrained |
| 7 circle tangent to AB | accepted | accepted | **NO** | same | ..... / F.F.. * ; sketch: nullity 2 / not fully constrained |
| 8 circle tangent to BC | accepted | accepted | **NO** | another valid branch | ..... / F.F.. * ; sketch: nullity 1 / not fully constrained |
| 9 circle tangent to CA (3rd: consistent by symmetry) | accepted | refused (3 : failed to create offset: VCS_SKETCH_OVER_CONSTRAINTS - S) | **NO** | - | - |
| 10 circle radius 20 (sets the size) | accepted | accepted | yes | same | FFFFF / FFFFF ; sketch: fully constrained / fully constrained |

Step E, 4 dimension edits (0.8x, 1.25x): 3 agree (accepted or refused alike); differ: edit x0.8 of dimension 110.000 -> 88.000 (ours refused, Fusion accepted).

Step F: redundant dimension: ours reference, Fusion refused (3 : VCS_SKETCH_OVER_CONSTRAINTS - Sketch geometry is over co) *; conflict dimension: ours reference, Fusion refused (3 : VCS_SKETCH_OVER_CONSTRAINTS - Sketch geometry is over co) *; delete one dimension: ours accepted, Fusion accepted; delete one dimension: fully constrained afterwards?: ours nullity 1, Fusion not fully constrained.

Divergences and verdicts:

* UNCLEAR: per-entity "fully constrained" differs; circles: a circle's radius is shape data in ours (O2) while Fusion needs a radius dimension; otherwise it follows an upstream refusal difference: step 1 full, step 2 full, step 3 full, step 4 full, step 5 full, step 6 full, step 7 full
* UNCLEAR / O1: a redundant geometric constraint: Fusion refuses it as over-constrained, ours accepts it silently (audit O1: "the app flags redundant dimensions but not redundant constraints"): step 8 outcome
* UNCLEAR: the angle dimension reads 180 - base angle in ours (the 0.8x value is geometrically impossible there); Fusion measures the other side, so the same number is feasible: edit0 outcome
* FUSION DIFFERENT BY DESIGN: Fusion refuses an over-constraining dimension (VCS_SKETCH_OVER_CONSTRAINTS); ours keeps it as a driven reference (O3: the owner's ruling on references decides): redundant outcome, conflict outcome

#### polygon: Hexagon + concentric circle + tangent circle + midpoint axis (round 1)

* the polygon is our tool's structure (sides + construction radials + equal constraints), replayed as lines and equals, not a Fusion polygon
* fillets are an arc + tangent constraints + a radius dimension + a virtual sharp point (a plain sketch point on both lines), as the fillet tool builds them
* units: ours mm, Fusion API cm (x 0.1 on the way in); angle dimensions are given in degrees

| step | ours | Fusion | same? | coordinates | fully constrained (per shape, F = yes) ours / Fusion |
|---|---|---|---|---|---|
| 1 centre O at the origin | accepted | accepted | yes | same | ............... / ............... ; sketch: nullity 12 / not fully constrained |
| 2 circumradius O-k0 = 40 | accepted | accepted | yes | same | ............... / ............... ; sketch: nullity 11 / not fully constrained |
| 3 M0 = midpoint of edge e0 (k0,k1) | accepted | accepted | yes | same | ............... / ............... ; sketch: nullity 9 / not fully constrained |
| 4 M3 = midpoint of the opposite edge e3 (k3,k4) | accepted | accepted | yes | same | ............... / ............... ; sketch: nullity 7 / not fully constrained |
| 5 axis M0-M3 horizontal (rotation) | accepted | accepted | yes | another valid branch | FFFFFFFFFFFFF.. / FFFFFFFFFFFFF.. ; sketch: nullity 6 / not fully constrained |
| 6 axis symmetric about O: midpoint(M0,M3)=O | accepted | accepted | yes | another valid branch | FFFFFFFFFFFFF.. / FFFFFFFFFFFFF.. ; sketch: nullity 6 / not fully constrained |
| 7 concentric circle: centre = O | accepted | accepted | yes | another valid branch | FFFFFFFFFFFFF.. / FFFFFFFFFFFFF.. ; sketch: nullity 4 / not fully constrained |
| 8 concentric circle radius 25 | accepted | accepted | yes | another valid branch | FFFFFFFFFFFFFF. / FFFFFFFFFFFFFF. ; sketch: nullity 3 / not fully constrained |
| 9 second circle tangent to edge e1 | accepted | accepted | yes | another valid branch | FFFFFFFFFFFFFF. / FFFFFFFFFFFFFF. ; sketch: nullity 2 / not fully constrained |
| 10 second circle tangent to edge e2 | accepted | accepted | yes | another valid branch | FFFFFFFFFFFFFF. / FFFFFFFFFFFFFF. ; sketch: nullity 1 / not fully constrained |
| 11 second circle radius 8 | accepted | accepted | yes | another valid branch | FFFFFFFFFFFFFFF / FFFFFFFFFFFFFFF ; sketch: fully constrained / fully constrained |

Step E, 6 dimension edits (0.8x, 1.25x): 6 agree (accepted or refused alike).

Step F: redundant dimension: ours reference, Fusion refused (3 : VCS_SKETCH_OVER_CONSTRAINTS - Sketch geometry is over co) *; conflict dimension: ours reference, Fusion refused (3 : VCS_SKETCH_OVER_CONSTRAINTS - Sketch geometry is over co) *; delete one dimension: ours accepted, Fusion accepted; delete one dimension: fully constrained afterwards?: ours nullity 1, Fusion fully constrained *.

Divergences and verdicts:

* FUSION DIFFERENT BY DESIGN: Fusion refuses an over-constraining dimension (VCS_SKETCH_OVER_CONSTRAINTS); ours keeps it as a driven reference (O3: the owner's ruling on references decides): redundant outcome, conflict outcome
* UNCLEAR: same cause as the per-entity flags (O2 circle radius, or an upstream refusal difference): delete sketchFull

#### scurve: S-curve: line - arc - arc - line, all tangent (round 2)

* fillets are an arc + tangent constraints + a radius dimension + a virtual sharp point (a plain sketch point on both lines), as the fillet tool builds them
* units: ours mm, Fusion API cm (x 0.1 on the way in); angle dimensions are given in degrees

| step | ours | Fusion | same? | coordinates | fully constrained (per shape, F = yes) ours / Fusion |
|---|---|---|---|---|---|
| 1 P0 at the origin | accepted | accepted | yes | another valid branch | .... / .... ; sketch: nullity 10 / not fully constrained |
| 2 l1 horizontal | accepted | accepted | **NO** | another valid branch | .... / F... * ; sketch: nullity 9 / not fully constrained |
| 3 l1 length 40 | accepted | accepted | yes | another valid branch | F... / F... ; sketch: nullity 8 / not fully constrained |
| 4 l1 tangent to arc a1 | accepted | accepted | yes | another valid branch | F... / F... ; sketch: nullity 7 / not fully constrained |
| 5 arc a1 radius 30 | accepted | accepted | **NO** | another valid branch | F... / FF.. * ; sketch: nullity 6 / not fully constrained |
| 6 a1 quarter turn: C1-Q horizontal | accepted | accepted | yes | another valid branch | FF.. / FF.. ; sketch: nullity 5 / not fully constrained |
| 7 arc a1 tangent to arc a2 | accepted | accepted | yes | another valid branch | FF.. / FF.. ; sketch: nullity 5 / not fully constrained |
| 8 arc a2 radius 25 | accepted | accepted | **NO** | another valid branch | FF.. / FFF. * ; sketch: nullity 4 / not fully constrained |
| 9 l2 horizontal | accepted | accepted | **NO** | another valid branch | FF.. / FFF. * ; sketch: nullity 3 / not fully constrained |
| 10 l2 tangent to arc a2 | accepted | accepted | **NO** | another valid branch | FF.. / FFFF * ; sketch: nullity 2 / not fully constrained |
| 11 l2 length 40 | accepted | accepted | **NO** | another valid branch | FF.. / FFFF * ; sketch: nullity 1 / fully constrained * |

Step E, 6 dimension edits (0.8x, 1.25x): 6 agree (accepted or refused alike).

Step F: redundant dimension: ours accepted, Fusion refused (3 : VCS_SKETCH_OVER_CONSTRAINTS - Sketch geometry is over co) *; conflict dimension: ours accepted, Fusion refused (3 : VCS_SKETCH_OVER_CONSTRAINTS - Sketch geometry is over co) *; delete one dimension: ours accepted, Fusion accepted; delete one dimension: fully constrained afterwards?: ours nullity 2, Fusion not fully constrained.

Divergences and verdicts:

* OUR BUG N-F7 (tangent between two arcs sharing a rim joint is degenerate): step 1 full, step 4 full, step 7 full, step 8 full, step 9 full, step 10 full, step 10 sketchFull, redundant outcome, conflict outcome

#### slot: Slot: two arcs + two lines (4 tangents) (round 2)

* fillets are an arc + tangent constraints + a radius dimension + a virtual sharp point (a plain sketch point on both lines), as the fillet tool builds them
* units: ours mm, Fusion API cm (x 0.1 on the way in); angle dimensions are given in degrees

| step | ours | Fusion | same? | coordinates | fully constrained (per shape, F = yes) ours / Fusion |
|---|---|---|---|---|---|
| 1 left centre at the origin | accepted | accepted | yes | same | .... / .... ; sketch: nullity 8 / not fully constrained |
| 2 centres horizontal | accepted | accepted | yes | another valid branch | .... / .... ; sketch: nullity 7 / not fully constrained |
| 3 centre distance 50 | accepted | accepted | yes | another valid branch | .... / .... ; sketch: nullity 6 / not fully constrained |
| 4 left end is a diameter: midpoint(a1,b1)=CL | accepted | accepted | yes | another valid branch | .... / .... ; sketch: nullity 5 / not fully constrained |
| 5 right end is a diameter: midpoint(a2,b2)=CR | accepted | accepted | yes | another valid branch | .... / .... ; sketch: nullity 4 / not fully constrained |
| 6 top line tangent to left arc | accepted | accepted | yes | another valid branch | .... / .... ; sketch: nullity 3 / not fully constrained |
| 7 top line tangent to right arc | accepted | accepted | yes | another valid branch | .... / .... ; sketch: nullity 2 / not fully constrained |
| 8 bottom line tangent to left arc | accepted | accepted | yes | another valid branch | .... / .... ; sketch: nullity 1 / not fully constrained |
| 9 bottom line tangent to right arc | accepted | refused (3 : failed to create offset: VCS_SKETCH_OVER_CONSTRAINTS - S) | **NO** | - | - |
| 10 arcs equal radius | accepted | refused (3 : failed to create offset: VCS_SKETCH_OVER_CONSTRAINTS - S) | **NO** | - | - |
| 11 radius 8 | accepted | accepted | **NO** | same | FFFF / F... * ; sketch: fully constrained / not fully constrained * |

Step E, 4 dimension edits (0.8x, 1.25x): 4 agree (accepted or refused alike).

Step F: redundant dimension: ours reference, Fusion refused (3 : VCS_SKETCH_OVER_CONSTRAINTS - Sketch geometry is over co) *; conflict dimension: ours reference, Fusion refused (3 : VCS_SKETCH_OVER_CONSTRAINTS - Sketch geometry is over co) *; delete one dimension: ours accepted, Fusion accepted; delete one dimension: fully constrained afterwards?: ours nullity 1, Fusion not fully constrained.

Divergences and verdicts:

* UNCLEAR / O1: a redundant geometric constraint: Fusion refuses it as over-constrained, ours accepts it silently (audit O1: "the app flags redundant dimensions but not redundant constraints"): step 8 outcome, step 9 outcome
* UNCLEAR: per-entity "fully constrained" differs; circles: a circle's radius is shape data in ours (O2) while Fusion needs a radius dimension; otherwise it follows an upstream refusal difference: step 10 full
* UNCLEAR: same cause as the per-entity flags (O2 circle radius, or an upstream refusal difference): step 10 sketchFull
* FUSION DIFFERENT BY DESIGN: Fusion refuses an over-constraining dimension (VCS_SKETCH_OVER_CONSTRAINTS); ours keeps it as a driven reference (O3: the owner's ruling on references decides): redundant outcome, conflict outcome

#### collinear-concentric: Collinear lines, concentric circle + arc, midpoint symmetry, point on arc (round 2)

* fillets are an arc + tangent constraints + a radius dimension + a virtual sharp point (a plain sketch point on both lines), as the fillet tool builds them
* units: ours mm, Fusion API cm (x 0.1 on the way in); angle dimensions are given in degrees

| step | ours | Fusion | same? | coordinates | fully constrained (per shape, F = yes) ours / Fusion |
|---|---|---|---|---|---|
| 1 A at the origin | accepted | accepted | yes | another valid branch | ..... / ..... ; sketch: nullity 20 / not fully constrained |
| 2 AB horizontal | accepted | accepted | **NO** | another valid branch | ..... / F.... * ; sketch: nullity 19 / not fully constrained |
| 3 AB length 30 | accepted | accepted | yes | another valid branch | F.... / F.... ; sketch: nullity 18 / not fully constrained |
| 4 CD collinear with AB | accepted | accepted | **NO** | another valid branch | F.... / FF... * ; sketch: nullity 16 / not fully constrained |
| 5 CD length 40 | accepted | accepted | **NO** | another valid branch | F.... / FF... * ; sketch: nullity 15 / not fully constrained |
| 6 gap B-C 20 | accepted | accepted | yes | another valid branch | FF... / FF... ; sketch: nullity 14 / not fully constrained |
| 7 circle centre 45 right of the origin | accepted | accepted | yes | another valid branch | FF... / FF... ; sketch: nullity 13 / not fully constrained |
| 8 circle centre 60 below A (the origin joint pair is taken by the H dim: | accepted | accepted | yes | another valid branch | FF... / FF... ; sketch: nullity 12 / not fully constrained |
| 9 circle radius 15 | accepted | accepted | yes | another valid branch | FFF.. / FFF.. ; sketch: nullity 11 / not fully constrained |
| 10 concentric: arc centre = circle centre | accepted | accepted | yes | another valid branch | FFF.. / FFF.. ; sketch: nullity 9 / not fully constrained |
| 11 arc radius 25 | accepted | accepted | **NO** | another valid branch | FFF.. / FFFF. * ; sketch: nullity 8 / not fully constrained |
| 12 arc start level with its centre | accepted | accepted | **NO** | another valid branch | FFF.. / FFFF. * ; sketch: nullity 7 / not fully constrained |
| 13 arc end above its centre | accepted | accepted | yes | another valid branch | FFFF. / FFFF. ; sketch: nullity 6 / not fully constrained |
| 14 E-F horizontal | accepted | accepted | yes | another valid branch | FFFF. / FFFF. ; sketch: nullity 5 / not fully constrained |
| 15 symmetry: O is the midpoint of E-F | accepted | accepted | **NO** | another valid branch | FFFF. / FFFFF * ; sketch: nullity 3 / not fully constrained |
| 16 E-F length 70 | accepted | accepted | yes | another valid branch | FFFFF / FFFFF ; sketch: nullity 2 / not fully constrained |
| 17 point P on the arc | accepted | accepted | yes | another valid branch | FFFFF / FFFFF ; sketch: nullity 1 / not fully constrained |
| 18 P 10 right of the arc centre | accepted | accepted | yes | another valid branch | FFFFF / FFFFF ; sketch: fully constrained / fully constrained |

Step E, 18 dimension edits (0.8x, 1.25x): 18 agree (accepted or refused alike).

Step F: redundant dimension: ours reference, Fusion refused (3 : VCS_SKETCH_OVER_CONSTRAINTS - Sketch geometry is over co) *; conflict dimension: ours reference, Fusion refused (3 : VCS_SKETCH_OVER_CONSTRAINTS - Sketch geometry is over co) *; delete one dimension: ours accepted, Fusion accepted; delete one dimension: fully constrained afterwards?: ours nullity 1, Fusion not fully constrained.

Divergences and verdicts:

* UNCLEAR: per-entity "fully constrained" differs; circles: a circle's radius is shape data in ours (O2) while Fusion needs a radius dimension; otherwise it follows an upstream refusal difference: step 1 full, step 3 full, step 4 full, step 10 full, step 11 full, step 14 full
* FUSION DIFFERENT BY DESIGN: Fusion refuses an over-constraining dimension (VCS_SKETCH_OVER_CONSTRAINTS); ours keeps it as a driven reference (O3: the owner's ruling on references decides): redundant outcome, conflict outcome

#### axis-symmetry: House outline symmetric about a construction centre line (round 2)

* fillets are an arc + tangent constraints + a radius dimension + a virtual sharp point (a plain sketch point on both lines), as the fillet tool builds them
* units: ours mm, Fusion API cm (x 0.1 on the way in); angle dimensions are given in degrees

| step | ours | Fusion | same? | coordinates | fully constrained (per shape, F = yes) ours / Fusion |
|---|---|---|---|---|---|
| 1 axis top A0 at the origin | accepted | accepted | yes | same | ...... / ...... ; sketch: nullity 16 / not fully constrained |
| 2 axis vertical | accepted | accepted | **NO** | same | ...... / .....F * ; sketch: nullity 15 / not fully constrained |
| 3 axis length 120 | accepted | accepted | yes | same | .....F / .....F ; sketch: nullity 14 / not fully constrained |
| 4 apex T on the axis | accepted | accepted | yes | same | .....F / .....F ; sketch: nullity 13 / not fully constrained |
| 5 apex 10 below A0 | accepted | accepted | yes | same | .....F / .....F ; sketch: nullity 12 / not fully constrained |
| 6 shoulder midpoint Mc on the axis | accepted | accepted | yes | same | .....F / .....F ; sketch: nullity 11 / not fully constrained |
| 7 shoulders L2-R2 horizontal | accepted | accepted | yes | same | .....F / .....F ; sketch: nullity 10 / not fully constrained |
| 8 shoulders symmetric: midpoint(L2,R2)=Mc | accepted | accepted | yes | same | .....F / .....F ; sketch: nullity 8 / not fully constrained |
| 9 shoulder width 50 | accepted | accepted | yes | same | .....F / .....F ; sketch: nullity 7 / not fully constrained |
| 10 shoulder level 30 below A0 | accepted | accepted | yes | same | F...FF / F...FF ; sketch: nullity 6 / not fully constrained |
| 11 base midpoint Mb on the axis | accepted | accepted | yes | same | F...FF / F...FF ; sketch: nullity 5 / not fully constrained |
| 12 base L1-R1 horizontal | accepted | accepted | yes | same | F...FF / F...FF ; sketch: nullity 4 / not fully constrained |
| 13 base symmetric: midpoint(L1,R1)=Mb | accepted | accepted | yes | same | F...FF / F...FF ; sketch: nullity 2 / not fully constrained |
| 14 base width 60 | accepted | accepted | yes | same | F...FF / F...FF ; sketch: nullity 1 / not fully constrained |
| 15 base level 80 below A0 | accepted | accepted | yes | same | FFFFFF / FFFFFF ; sketch: fully constrained / fully constrained |

Step E, 12 dimension edits (0.8x, 1.25x): 12 agree (accepted or refused alike).

Step F: redundant dimension: ours reference, Fusion refused (3 : VCS_SKETCH_OVER_CONSTRAINTS - Sketch geometry is over co) *; conflict dimension: ours reference, Fusion refused (3 : VCS_SKETCH_OVER_CONSTRAINTS - Sketch geometry is over co) *; delete one dimension: ours accepted, Fusion accepted; delete one dimension: fully constrained afterwards?: ours nullity 1, Fusion not fully constrained.

Divergences and verdicts:

* UNCLEAR: per-entity "fully constrained" differs; circles: a circle's radius is shape data in ours (O2) while Fusion needs a radius dimension; otherwise it follows an upstream refusal difference: step 1 full
* FUSION DIFFERENT BY DESIGN: Fusion refuses an over-constraining dimension (VCS_SKETCH_OVER_CONSTRAINTS); ours keeps it as a driven reference (O3: the owner's ruling on references decides): redundant outcome, conflict outcome

#### welded-T: T outline, one shared joint per corner (round 2)

* fillets are an arc + tangent constraints + a radius dimension + a virtual sharp point (a plain sketch point on both lines), as the fillet tool builds them
* units: ours mm, Fusion API cm (x 0.1 on the way in); angle dimensions are given in degrees

| step | ours | Fusion | same? | coordinates | fully constrained (per shape, F = yes) ours / Fusion |
|---|---|---|---|---|---|
| 1 A at the origin | accepted | accepted | yes | same | ........ / ........ ; sketch: nullity 14 / not fully constrained |
| 2 AB horizontal | accepted | accepted | **NO** | same | ........ / F....... * ; sketch: nullity 13 / not fully constrained |
| 3 BC vertical | accepted | accepted | **NO** | same | ........ / F....... * ; sketch: nullity 12 / not fully constrained |
| 4 CD horizontal | accepted | accepted | **NO** | same | ........ / F....... * ; sketch: nullity 11 / not fully constrained |
| 5 DE vertical | accepted | accepted | **NO** | same | ........ / F....... * ; sketch: nullity 10 / not fully constrained |
| 6 EF horizontal | accepted | accepted | **NO** | same | ........ / F....... * ; sketch: nullity 9 / not fully constrained |
| 7 FG vertical | accepted | accepted | **NO** | same | ........ / F....... * ; sketch: nullity 8 / not fully constrained |
| 8 GH horizontal | accepted | accepted | **NO** | same | ........ / F....... * ; sketch: nullity 7 / not fully constrained |
| 9 HA vertical | accepted | accepted | **NO** | same | ........ / F......F * ; sketch: nullity 6 / not fully constrained |
| 10 AB length 100 | accepted | accepted | **NO** | same | F....... / FF.....F * ; sketch: nullity 5 / not fully constrained |
| 11 BC height 20 | accepted | accepted | **NO** | same | FF...... / FFF....F * ; sketch: nullity 4 / not fully constrained |
| 12 CD length 40 | accepted | accepted | **NO** | same | FFF..... / FFFF...F * ; sketch: nullity 3 / not fully constrained |
| 13 DE height 60 | accepted | accepted | **NO** | same | FFFF.... / FFFFF..F * ; sketch: nullity 2 / not fully constrained |
| 14 EF length 20 | accepted | accepted | **NO** | same | FFFFF... / FFFFFF.F * ; sketch: nullity 1 / not fully constrained |
| 15 HA height 20 | accepted | accepted | yes | same | FFFFFFFF / FFFFFFFF ; sketch: fully constrained / fully constrained |

Step E, 12 dimension edits (0.8x, 1.25x): 12 agree (accepted or refused alike).

Step F: redundant dimension: ours reference, Fusion refused (3 : VCS_SKETCH_OVER_CONSTRAINTS - Sketch geometry is over co) *; conflict dimension: ours reference, Fusion refused (3 : VCS_SKETCH_OVER_CONSTRAINTS - Sketch geometry is over co) *; delete one dimension: ours accepted, Fusion accepted; delete one dimension: fully constrained afterwards?: ours nullity 1, Fusion not fully constrained.

Divergences and verdicts:

* UNCLEAR: per-entity "fully constrained" differs; circles: a circle's radius is shape data in ours (O2) while Fusion needs a radius dimension; otherwise it follows an upstream refusal difference: step 1 full, step 2 full, step 3 full, step 4 full, step 5 full, step 6 full, step 7 full, step 8 full, step 9 full, step 10 full, step 11 full, step 12 full (+1 more)
* FUSION DIFFERENT BY DESIGN: Fusion refuses an over-constraining dimension (VCS_SKETCH_OVER_CONSTRAINTS); ours keeps it as a driven reference (O3: the owner's ruling on references decides): redundant outcome, conflict outcome

#### filleted-polygon: House pentagon, every corner filleted (R6) (round 2)

* the polygon is our tool's structure (sides + construction radials + equal constraints), replayed as lines and equals, not a Fusion polygon
* fillets are an arc + tangent constraints + a radius dimension + a virtual sharp point (a plain sketch point on both lines), as the fillet tool builds them
* units: ours mm, Fusion API cm (x 0.1 on the way in); angle dimensions are given in degrees

| step | ours | Fusion | same? | coordinates | fully constrained (per shape, F = yes) ours / Fusion |
|---|---|---|---|---|---|
| 1 sharp A at the origin | accepted | accepted | yes | another valid branch | .......... / .......... ; sketch: nullity 8 / not fully constrained |
| 2 AB horizontal | accepted | accepted | **NO** | another valid branch | .......... / F......... * ; sketch: nullity 7 / not fully constrained |
| 3 BC vertical | accepted | accepted | **NO** | another valid branch | .......... / F......... * ; sketch: nullity 6 / not fully constrained |
| 4 EA vertical | accepted | accepted | **NO** | another valid branch | .........F / F...F....F * ; sketch: nullity 5 / not fully constrained |
| 5 width vA-vB 60 | accepted | accepted | **NO** | another valid branch | F....F...F / FF..FF...F * ; sketch: nullity 4 / not fully constrained |
| 6 right wall vB-vC 40 | accepted | accepted | **NO** | another valid branch | F....F...F / FF..FF...F * ; sketch: nullity 3 / not fully constrained |
| 7 left wall vA-vE 40 | accepted | accepted | **NO** | another valid branch | F....F...F / FF..FF...F * ; sketch: nullity 2 / not fully constrained |
| 8 roof sides equal: /vC vD/ = /vD vE/ | accepted | accepted (skipped: the arc keeps its radius structurally in Fusion) | yes | - | - |
| 9 apex 30 below vE | accepted | accepted | **NO** | same | FFFFFFFFFF / FF..FF...F * ; sketch: fully constrained / not fully constrained * |

Step E, 18 dimension edits (0.8x, 1.25x): 18 agree (accepted or refused alike).

Step F: redundant dimension: ours reference, Fusion refused (3 : VCS_SKETCH_OVER_CONSTRAINTS - Sketch geometry is over co) *; conflict dimension: ours reference, Fusion refused (3 : VCS_SKETCH_OVER_CONSTRAINTS - Sketch geometry is over co) *; delete one dimension: ours accepted, Fusion accepted; delete one dimension: fully constrained afterwards?: ours nullity 1, Fusion not fully constrained.

Divergences and verdicts:

* UNCLEAR: per-entity "fully constrained" differs; circles: a circle's radius is shape data in ours (O2) while Fusion needs a radius dimension; otherwise it follows an upstream refusal difference: step 1 full, step 2 full, step 3 full, step 4 full, step 5 full, step 6 full, step 8 full
* UNCLEAR: same cause as the per-entity flags (O2 circle radius, or an upstream refusal difference): step 8 sketchFull
* FUSION DIFFERENT BY DESIGN: Fusion refuses an over-constraining dimension (VCS_SKETCH_OVER_CONSTRAINTS); ours keeps it as a driven reference (O3: the owner's ruling on references decides): redundant outcome, conflict outcome

#### every-kind: Every shape kind in one drawing (round 2)

* not expressible in Fusion and left out: s_bezier (bezier) (Fusion has no cubic bezier with our control-point data; its two end joints are kept as points)
* the polygon is our tool's structure (sides + construction radials + equal constraints), replayed as lines and equals, not a Fusion polygon
* fillets are an arc + tangent constraints + a radius dimension + a virtual sharp point (a plain sketch point on both lines), as the fillet tool builds them
* units: ours mm, Fusion API cm (x 0.1 on the way in); angle dimensions are given in degrees

| step | ours | Fusion | same? | coordinates | fully constrained (per shape, F = yes) ours / Fusion |
|---|---|---|---|---|---|
| 1 rect corner c1 at the origin | accepted | accepted | **NO** | another valid branch | ...................... / F..F...............?.. * ; sketch: nullity 28 / not fully constrained |
| 2 rect width 60 | accepted | accepted | **NO** | another valid branch | F...F................. / FF.FF..............?.. * ; sketch: nullity 27 / not fully constrained |
| 3 rect height V-c3 43 (V = the filleted TR sharp; the pair c1-c3 is take | accepted | accepted | yes | another valid branch | FFFFF................. / FFFFF..............?.. ; sketch: nullity 26 / not fully constrained |
| 4 hexagon centre 150 right | accepted | accepted | yes | another valid branch | FFFFF................. / FFFFF..............?.. ; sketch: nullity 25 / not fully constrained |
| 5 hexagon centre 20 down | accepted | accepted | yes | another valid branch | FFFFF................. / FFFFF..............?.. ; sketch: nullity 24 / not fully constrained |
| 6 hexagon circumradius 20 | accepted | accepted | yes | another valid branch | FFFFF................. / FFFFF..............?.. ; sketch: nullity 23 / not fully constrained |
| 7 hexagon first radial horizontal | accepted | accepted | **NO** | another valid branch | FFFFFFFFFFFFFFFFF..... / FFFFFFFFFFFFF.F....?.. * ; sketch: nullity 22 / not fully constrained |
| 8 circle centre 40 right | accepted | accepted | **NO** | another valid branch | FFFFFFFFFFFFFFFFF..... / FFFFFFFFFFFFF.F....?.. * ; sketch: nullity 21 / not fully constrained |
| 9 circle centre 90 down | accepted | accepted | **NO** | another valid branch | FFFFFFFFFFFFFFFFF..... / FFFFFFFFFFFFF.F....?.. * ; sketch: nullity 20 / not fully constrained |
| 10 circle radius 10 | accepted | accepted | **NO** | another valid branch | FFFFFFFFFFFFFFFFFF.... / FFFFFFFFFFFFF.F..F.?.. * ; sketch: nullity 19 / not fully constrained |
| 11 arc centre 100 right | accepted | accepted | **NO** | another valid branch | FFFFFFFFFFFFFFFFFF.... / FFFFFFFFFFFFF.F..F.?.. * ; sketch: nullity 18 / not fully constrained |
| 12 arc centre 90 down | accepted | accepted | **NO** | another valid branch | FFFFFFFFFFFFFFFFFF.... / FFFFFFFFFFFFF.F..F.?.. * ; sketch: nullity 17 / not fully constrained |
| 13 arc radius 15 | accepted | accepted | **NO** | another valid branch | FFFFFFFFFFFFFFFFFF.... / FFFFFFFFFFFFF.F..FF?.. * ; sketch: nullity 16 / not fully constrained |
| 14 arc start level with its centre | accepted | accepted | **NO** | another valid branch | FFFFFFFFFFFFFFFFFF.... / FFFFFFFFFFFFF.F..FF?.. * ; sketch: nullity 15 / not fully constrained |
| 15 bezier start = arc end | accepted | accepted | **NO** | another valid branch | FFFFFFFFFFFFFFFFFF.... / FFFFFFFFFFFFF.F..FF?.. * ; sketch: nullity 13 / not fully constrained |
| 16 line horizontal | accepted | accepted | **NO** | another valid branch | FFFFFFFFFFFFFFFFFF.... / FFFFFFFFFFFFF.F..FF?.. * ; sketch: nullity 12 / not fully constrained |
| 17 line length 30 | accepted | accepted | **NO** | another valid branch | FFFFFFFFFFFFFFFFFF.... / FFFFFFFFFFFFF.F..FF?.. * ; sketch: nullity 11 / not fully constrained |
| 18 construction line vertical | accepted | accepted | **NO** | another valid branch | FFFFFFFFFFFFFFFFFF.... / FFFFFFFFFFFFF.F..FF?.. * ; sketch: nullity 10 / not fully constrained |
| 19 lone point on the line | accepted | accepted | **NO** | another valid branch | FFFFFFFFFFFFFFFFFF.... / FFFFFFFFFFFFF.F..FF?.. * ; sketch: nullity 9 / not fully constrained |

Step E, 26 dimension edits (0.8x, 1.25x): 26 agree (accepted or refused alike).

Step F: redundant dimension: ours reference, Fusion refused (3 : VCS_SKETCH_OVER_CONSTRAINTS - Sketch geometry is over co) *; conflict dimension: ours reference, Fusion refused (3 : VCS_SKETCH_OVER_CONSTRAINTS - Sketch geometry is over co) *; delete one dimension: ours accepted, Fusion accepted; delete one dimension: fully constrained afterwards?: ours nullity 10, Fusion not fully constrained.

Divergences and verdicts:

* UNCLEAR: per-entity "fully constrained" differs; circles: a circle's radius is shape data in ours (O2) while Fusion needs a radius dimension; otherwise it follows an upstream refusal difference: step 0 full, step 1 full, step 6 full, step 7 full, step 8 full, step 9 full, step 10 full, step 11 full, step 12 full, step 13 full, step 14 full, step 15 full (+3 more)
* FUSION DIFFERENT BY DESIGN: Fusion refuses an over-constraining dimension (VCS_SKETCH_OVER_CONSTRAINTS); ours keeps it as a driven reference (O3: the owner's ruling on references decides): redundant outcome, conflict outcome

#### two-sketches: Two sketches, constraints in each, one link (round 2)

* built in ONE Fusion sketch: Fusion constraints cannot cross sketches, and our solver is one global system that never reads sketchId, so the comparison is of the constraint maths only
* fillets are an arc + tangent constraints + a radius dimension + a virtual sharp point (a plain sketch point on both lines), as the fillet tool builds them
* units: ours mm, Fusion API cm (x 0.1 on the way in); angle dimensions are given in degrees

| step | ours | Fusion | same? | coordinates | fully constrained (per shape, F = yes) ours / Fusion |
|---|---|---|---|---|---|
| 1 S1 rect corner c1 at the origin | accepted | accepted | **NO** | same | ....... / F..F... * ; sketch: nullity 8 / not fully constrained |
| 2 S1 rect width 60 | accepted | accepted | **NO** | same | F...... / FF.F... * ; sketch: nullity 7 / not fully constrained |
| 3 S1 rect height 40 (right side; the pair c1-c3 is taken by the width: F | accepted | accepted | yes | same | FFFF... / FFFF... ; sketch: nullity 6 / not fully constrained |
| 4 S2 triangle base AB horizontal | accepted | accepted | yes | same | FFFF... / FFFF... ; sketch: nullity 5 / not fully constrained |
| 5 S2 triangle sides CA = BC | accepted | accepted | yes | same | FFFF... / FFFF... ; sketch: nullity 4 / not fully constrained |
| 6 S2 base length 60 | accepted | accepted | yes | same | FFFF... / FFFF... ; sketch: nullity 3 / not fully constrained |
| 7 S2 apex 50 above the base (line-to-point) | accepted | accepted | yes | same | FFFF... / FFFF... ; sketch: nullity 2 / not fully constrained |
| 8 LINK: A is 100 right of the rect corner c1 | accepted | accepted | yes | same | FFFF... / FFFF... ; sketch: nullity 1 / not fully constrained |
| 9 LINK: A is level with the rect corner c1 | accepted | accepted | yes | same | FFFFFFF / FFFFFFF ; sketch: fully constrained / fully constrained |

Step E, 10 dimension edits (0.8x, 1.25x): 10 agree (accepted or refused alike).

Step F: redundant dimension: ours reference, Fusion refused (3 : VCS_SKETCH_OVER_CONSTRAINTS - Sketch geometry is over co) *; conflict dimension: ours reference, Fusion refused (3 : VCS_SKETCH_OVER_CONSTRAINTS - Sketch geometry is over co) *; delete one dimension: ours accepted, Fusion accepted; delete one dimension: fully constrained afterwards?: ours nullity 1, Fusion not fully constrained.

Divergences and verdicts:

* UNCLEAR: per-entity "fully constrained" differs; circles: a circle's radius is shape data in ours (O2) while Fusion needs a radius dimension; otherwise it follows an upstream refusal difference: step 0 full, step 1 full
* FUSION DIFFERENT BY DESIGN: Fusion refuses an over-constraining dimension (VCS_SKETCH_OVER_CONSTRAINTS); ours keeps it as a driven reference (O3: the owner's ruling on references decides): redundant outcome, conflict outcome

<!-- drawings:end -->

## Dragging (real mouse, qualitative)

**Method (task 530).** Fusion's API cannot reproduce a constrained drag (task 527: `point.move` / `sketch.move` leave a length-dimensioned point where it is or put it on the wrong branch), so
the drag is done with REAL Windows mouse input (`scripts/fusion-oracle/win-mouse.py`, SendInput) into a live Fusion 360 (2706.1.17), only into a new scratch document, only while Fusion is the foreground
window; the bridge builds the sketch and reads every point back (`drag-batch-setup.py`, `drag-batch-frame.py`, outside driver `drag-batch-run.py`). 146 cells (`tests/harness/fusion-oracle/drag-cells.js`, data in
`tests/fixtures/fusion-oracle/drag-cells.json`): line, rectangle (H/V + coincident), circle, arc, two lines sharing a corner, line tangent to a circle; holds free / H / length / one end fixed / corner on
the origin / fully constrained; grab an end point, a body (line mid, rectangle edge, circle rim), a centre or a corner; drag along / across / diagonal, 30 % of the shape size. ONE path for every cell:
straight line from the grab point to the target, 20 steps over 600 ms, 120 ms settle. Each cell was built and dragged TWICE in Fusion (two independent copies in the same sketch); 4 cells whose two
runs differ in class are "unstable" and not compared. Ours: the same sketch and the same 20-point cursor path through the app's real pointer code (`handleSelectionPointerDown` / `Move` / `Up` in
`packages/ui/input-handlers/selection-tools.js`, plus the app's per-frame `engine.solve` from `apps/sketchstudio/main.js`) in node. Fusion's grid Snap could not be switched off (the `ToggleGridSnapCommand` execute left the Sketch Palette checkbox
checked, also after re-entering the sketch), so it stayed on; the free-line endpoints land on the cursor within about 2 px, the 0.06 cm alternation of phase 1 shows up as sub-tolerance noise only.

**Path dependence (why only the qualitative outcome is compared).** Phase 1, line (0,0)-(10,0), start fixed, length dimensioned 10, drag the end from (10,0) to (13,5): the projection onto the circle is
(9.34,3.60) but Fusion's result depends on the cursor path: 20 steps / 600 ms gives (6.98656,7.15458) (three runs, spread 2e-4 cm); 2 steps (5.88,8.09); 60 steps / 3 s (7.16,6.98); 200 steps / 4 s did not
start at all ((10,0)). Same path = same answer to 1e-4, a different path = a different answer, so coordinates are kept for reference only and a class is compared: which points / radii moved (the which-moves
M / . / r notation), did the dragged point move, were all constraints and dimensions kept, rigid (translate / rotate) or stretch (an undimensioned length or radius changed), nothing moved (refused). Tolerance 0.005 cm.

**Result.** 146 cells: 91 same as Fusion, 51 KNOWN differences, 4 unstable in Fusion (`line.H.end.across`, `line.fix0len.end.diag`, `tangent.free.lineend.across`, `tangent.full.lineend.across`). Fusion
kept every constraint and dimension in every run (`kept=y` everywhere); so did ours. A "nothing moved" cell in Fusion is either a refusal (fully constrained) or a drag that did not start; the same cell moved in a
sibling vector in every case I checked, so I read the 'none' cells as refusals.

**Replay correction (checked in the real app).** The first version of the node replay called only the pointer handlers and reported "dragging a body does nothing in ours" (37 cells). That was a replay
artefact: the real app also runs `engine.solve(SolverConfig.ITERATIONS || 500)` every animation frame (`apps/sketchstudio/main.js` `loop()`), and that frame solve is what moves a body drag (it auto-detects the first
free joint carrying `joint.dragTarget`; the move handler's own solve puts its spring on the shape id). The replay now runs one such frame solve after every pointer move and after the release. Proof:
`tests/fusion-drag-live.test.js` (headless browser, real `Input.dispatchMouseEvent`, the same 20-step path, geometry read from the DOM) drags five cells in the real SketchStudio and the replay gives the same class for
each: free line by its body = stretch (one end follows), rectangle edge by its body = stretch (4 of 8 drawn points move), circle by its rim = translate, arc by its end = stretch (radius changes), length-dimensioned
free line by an end = rotate (both ends move, length kept). 39 of the 146 "ours" records changed with the correction (all body / arc / dimensioned-line cells; the other 107 are identical).

| class (what was grabbed) | same | differs | unstable |
| --- | --- | --- | --- |
| line end | 15 | 2 | 2 |
| line mid (body) | 6 | 12 | 0 |
| rectangle corner | 13 | 0 | 0 |
| rectangle edge (body) | 8 | 4 | 0 |
| circle centre | 12 | 0 | 0 |
| circle rim | 6 | 6 | 0 |
| arc end | 0 | 12 | 0 |
| arc centre | 6 | 6 | 0 |
| two lines, free end | 9 | 0 | 0 |
| two lines, shared corner | 9 | 0 | 0 |
| tangent: line end | 4 | 3 | 2 |
| tangent: circle rim | 3 | 6 | 0 |

**The 5 most important differences, in plain words.**
1. **Dragging a body (line, rectangle edge, circle rim) is not a rigid move in ours** (22 differing cells). Ours moves only the FIRST free joint to the cursor (a free line stretches, one rectangle corner pair follows),
   or nothing in some hold states; the circle rim translates the circle (Fusion resizes it). Fusion translates a line / rectangle as a whole and resizes the circle.
2. **Circle rim**: Fusion resizes the circle (radius changes, centre stays); ours has no rim handle, so a rim drag moves the circle. With a radius dimension Fusion moves the whole circle instead (same as ours).
3. **Arc ends and arc centre**: Fusion resizes the arc (end drag, free), rotates it about the fixed centre (radius dimensioned) or translates it; ours stretches or rotates it and moves a different set of its three joints (12 of 12 end cells and 6 of 12 centre cells differ).
4. **A free line with a length dimension grabbed by an end**: Fusion drags the whole line along (it translates); ours rotates it (both ends move, length kept).
5. **Tangent line + circle**: grabbing the circle rim or the line end, ours moves / resizes the circle in a different set of cells than Fusion (9 differing cells).
Agreement is complete for a rectangle corner (13/13), a circle centre (12/12), both cells of two lines sharing a corner (18/18) and every fully constrained cell (nothing moves in either).
KNOWN list: `tests/fixtures/fusion-oracle/drag-known.json` (regenerate with `node scripts/fusion-oracle/drag-known.mjs`), tests `tests/fusion-drag.test.js` and `tests/fusion-drag-live.test.js`.

## Editing a dimension (task 528)

Question: when the value of an EXISTING driving dimension is changed, does our `commitDimensionEdit` (packages/ui/dimension-seams.js, the one path the app uses when a value is typed) re-solve the sketch the way Fusion does? Measured in Fusion 2706.1.17 (recorded 2026-11-12), replayed offline by `tests/fusion-dim-edit.test.js` (fixture `tests/fixtures/fusion-oracle/fusion-dim-edit.json`, KNOWN list `fusion-dim-edit-known.json`). Nothing under `packages/` was changed: this is measurement only.

**How Fusion is driven.** `sketchDimension.parameter.expression = '<v> mm'` (or `deg`), in a new unsaved scratch document. The recorded runs: 144 cells x 6 edits = 864. A cell = a hold state of the graded grid (tests/harness/fusion-oracle/graded.js: the same builders and levels: free, H/V, one end fixed, other dimension present, corner shared, origin as one end, fully constrained, fillet arc) with the dimension placed at its measured value. Dimension modes: aligned, horizontal, vertical, line length, angle, radius (circle, arc, fillet arc), point-to-line, line-line (parallel). The graded cells are SAMPLED by a fixed stride (aligned every 5th, horizontal and vertical every 10th, angle every 4th, length and radius all), point-to-line and line-line are 11 and 6 extra cells of the same builders. No diameter dimension: no tool creates one. The edits: x2, x0.5, +1% (angle +0.5 degrees), x20 (angle 179 degrees: may make a neighbour impossible), 0, minus the value. Fusion's side is `scripts/fusion-oracle/run-dim-edit.py`, jobs by `dim-edit-jobs.mjs`, merge by `dim-edit-cli.mjs merge`, KNOWN by `dim-edit-known.mjs`.

**Step 1: does setting the parameter behave like a typed edit?** Measured on three hand cases (a free line with a length dimension; a rectangle with H/V and width and height dimensions; an L of two lines with H/V and two length dimensions plus a diagonal reference):
- The geometry follows the value: line 50 -> 100 moved the free end (40,30) -> (80,60); rectangle width 50 -> 80 moved the two right corners and kept the left side; height 30 -> 15 moved the top side; the L followed (diagonal reference 50 -> 72.11).
- The sketch stays valid (`healthState` 0) after every possible value.
- An impossible value is NOT refused by an exception. The API accepts it, the parameter keeps the typed number, the sketch goes to `healthState` 1 with "Failed to solve. Please try revising dimensions or constraints." and the geometry stays at the last valid shape (0 mm and 1e9 mm on a line length). The next possible value (40 mm) solves again and the health returns to 0. A recorded run counts as "refused" when the health is not 0.
- Negative values are accepted and are SIGNED: -30 mm on a line from the origin moved its end to (-24,-18) (the other side of the start point), 40 mm after that stayed on the negative side.
- Setting the value of a REFERENCE dimension is accepted by the API (the value reads back); not examined further.
- Limit: this is the API route. Whether the Fusion dialog shows a refusal message instead of the error state could not be measured here (no UI driving).
- Repeatability: all 864 runs were recorded twice; the two recordings are identical (max coordinate difference 0, same refusals).

**Result.** 864 runs: 381 same as Fusion, 483 differ (all KNOWN, 9 classes). "Same" = the same set of moved ends (which END of the dimension moved: a, b, line1, line2, point, line, radius, centre; "+others" = other joints moved), the same refused / not-editable outcome, the dimension reaches its value, the other dimensions keep theirs.

| dimension | runs | same | differ |
|---|---|---|---|
| aligned (point-point) | 282 | 131 | 151 |
| horizontal | 96 | 47 | 49 |
| vertical | 96 | 47 | 49 |
| line length | 54 | 26 | 28 |
| angle | 174 | 22 | 152 |
| radius (circle, arc, fillet) | 60 | 51 | 9 |
| point-to-line | 66 | 36 | 30 |
| line-line | 36 | 21 | 15 |

| edit | same | differ |
|---|---|---|
| x2 | 71 | 73 |
| x0.5 | 72 | 72 |
| +1% | 71 | 73 |
| x20 / 179 degrees | 71 | 73 |
| to 0 | 70 | 74 |
| to minus the value | 26 | 118 |

| class of difference | runs |
|---|---|
| both-operands: Fusion moves ONE operand, ours spreads the change over both | 312 |
| negative-refused: Fusion accepts a negative value, ours refuses | 90 |
| neighbours: same operand, Fusion also moves the far end / connected points | 56 |
| zero-length: Fusion cannot solve a zero length, ours collapses it | 5 |
| arc-centre: Fusion keeps the arc centre on a radius edit, ours moves it | 5 |
| fusion-refuses-dimension: Fusion refuses a redundant dimension (angle on a fully constrained rectangle), ours places it driving | 6 |
| ours-reference: ours places a zero distance to the origin as a reference, Fusion edits it | 6 |
| negative-radius: Fusion leaves a circle alone, ours stores a negative radius | 2 |
| zero-refused: zero distance between two points, Fusion allows, ours refuses | 1 |

132 further runs agree on "not editable": Fusion refuses to place the dimension at all (96 over-constrained, 42 "Already has same dimension"), ours places it as a reference.

**The 5 most important differences, in plain words**
1. **Who moves.** Typing a new value moves ONE thing in Fusion: the second-picked point or line (or the one that is not held) is carried along (a free line moves as a whole). Ours splits the change between the two ends (a free line given length 100 grows from both ends, the start point slides away from where the user put it). 312 of 483 differences. This is the same "least change" behaviour as the creation cases of the graded grid, now on an edit.
2. **Negative values.** Fusion accepts a negative number (the value is signed: the geometry keeps its side or flips to the other one). Ours refuses (reverts) 90 times, and a negative circle radius is stored as a negative radius on the circle (2 runs: the circle is left with radius -15).
3. **Zero.** Fusion cannot solve a zero LENGTH (the sketch goes to the error state and the geometry stays); ours accepts 0 for the edited dimension's own line and collapses it to a point (5 runs, the task 521 exemption). For a zero distance between two points Fusion makes them coincide where ours refuses it (1 run).
4. **Neighbours.** With the same operand moving, Fusion also nudges the far end of the line or the connected points (its solver minimises the movement of all free points); ours moves only the dimensioned point and keeps the rest (56 runs).
5. **Redundant dimensions.** An angle on two sides of a fully constrained rectangle: Fusion refuses to place it (over-constrained), ours places it driving and the edit moves nothing or is refused (6 runs). The other way round, a zero distance from a point to the origin: Fusion places and edits it, ours turns it into a reference (6 runs). Also on arcs: Fusion keeps the centre on a radius edit, ours moves the centre (5 runs).

Not found different: a radius edit of a circle, a fillet radius edit and the line-length edits of held lines agree with Fusion (the 381 agreeing runs), and the other dimensions of the sketch kept their values in every agreeing run.

#### After task 525 (who moves from the declared table)

The numbers above are task 528's measurement on main (2026-11-12). Task 525 makes `commitDimensionEdit` place the operand that gives way (the who-moves table, `packages/core/creation-placement.js`) at every value step before the solve; a dimension between two points of ONE shape (a line's length, an arc's radius, centre to end) is not pre-placed (no anchor between two points of one shape). Same test, same fixture: **864 runs: 672 same as Fusion, 192 differ (all KNOWN, 11 classes)**, from 381 / 483. Per run, main's KNOWN class -> now (`.evidence/525/dim-edit-compare-r6.txt` on the task branch):

| class on main -> class now | runs |
|---|---|
| same -> same | 371 |
| both-operands -> same | 244 |
| neighbours -> same | 56 |
| zero-refused -> same | 1 |
| both-operands -> both-operands | 46 |
| negative-refused -> negative-refused | 90 |
| fusion-refuses-dimension, ours-reference, zero-length, arc-centre, negative-radius (unchanged) | 6, 6, 5, 5, 2 |
| same -> point-alone (NEW) | 10 |
| both-operands -> point-alone | 10 |
| both-operands -> other-operand | 10 |
| both-operands -> fusion-angle-supplement (NEW) | 1 |
| both-operands -> angle-short (NEW) | 1 |

| dimension | runs | same | differ |
|---|---|---|---|
| aligned (point-point) | 282 | 238 | 44 |
| horizontal | 96 | 67 | 29 |
| vertical | 96 | 67 | 29 |
| line length | 54 | 26 | 28 |
| angle | 174 | 166 | 8 |
| radius (circle, arc, fillet) | 60 | 51 | 9 |
| point-to-line | 66 | 36 | 30 |
| line-line | 36 | 21 | 15 |

| edit | same | differ |
|---|---|---|
| x2 | 125 | 19 |
| x0.5 | 125 | 19 |
| +1% | 125 | 19 |
| x20 / 179 degrees | 123 | 21 |
| to 0 | 124 | 20 |
| to minus the value | 50 | 94 |

New classes (RULES in `tests/harness/fusion-oracle/dim-edit.js`):
- **point-alone (20 runs; 10 of them were same on main: dim-horizontal / dim-vertical LP 0,4, all five edits).** H / V dimension: Fusion moves the picked line end alone (the line stretches); ours translates the line (the giving operand's whole body).
- **fusion-angle-supplement (1 run).** dim-angle|LL|1,4#huge20: the Fusion parameter reads 179 (health 0), but its lines end at the supplementary angle by the unsigned measure (line1 shrinks from 61.8 to 2.1 long and turns; the lines are 1.1 degrees apart), so the harness reads "value not reached"; ours turns line1 to 179 degrees.
- **angle-short (1 run).** dim-angle|SS|0,0#huge20: two parallel polygon sides, 0 -> 179 degrees: ours turns the same side but does not read 179 (the angle row holds modulo 180 degrees); Fusion reaches it.
- A "start-geometry" class (45 runs) existed in round 3 of task 525, while the placement also moved one end of a single line (an H / V on one line in the cells' level setup), which changed our start geometry against the recorded one; with no placement between two points of one shape the start geometry matches again and those runs agree with Fusion.

Proposed follow-up (tried in task 525, reverted): moving only the picked POINT when the first pick gives way for an H / V dimension. It fixes point-alone and helps the other oracles (which-moves 287 -> 299, graded 1996 -> 2011, this test 644 -> 654 same), but it re-opens coverage-properties N-F6 (a tangent circle flips sides on a horizontal dimension edit). It needs the N-F6 branch lock (the tangent side recorded at creation) first.

## Symmetric (task 572)
Measured by the advisor through the Fusion API (new unsaved document, `addSymmetry`, entity 1, entity 2, then the symmetry line; cm). Ours =
tests/symmetric.test.js (the same numbers through ConstraintManager.createConstraint and the solver).

| case | Fusion | ours (task 572) | same? |
|---|---|---|---|
| two lines about the Y axis: a (-4,0)-(-1,3) len 4.2426, b (1.5,0.5)-(6,2.5) len 4.9244 | a unchanged; b (1.8132,2.1868)-(5.2953,-1.2953), len 4.9244 | a unchanged; b (1.3840,2.6160)-(4.8660,-0.8660), len 4.9244 | rule yes; pose differs along the line |
| what the line form holds | b on the mirror of a's INFINITE line (y = -x + 4); ends NOT mirrored; both lengths free | both ends of b on the mirror of a's line (2 rows, 2 DOF); lengths free | yes |
| who moves (lines) | the SECOND pick (b) | the second pick (the declared who-moves row, task 563) | yes |
| arcs | centre mirrored, equal radius, ends free (sweeps 90 vs 167.4) | centre mirrored, equal radius (3 rows), ends free | yes |
| circles | centre mirrored, equal radius | centre mirrored, equal radius (3 rows) | yes |

Divergence (reported, owner decides): where b lands ALONG the mirrored line. Both turn b by -69 degrees (its start goes to the upper end) and keep
its length; ours slides it straight onto the line from its turned midpoint (the collinear placement: midpoint (3.125, 0.875)), Fusion's lands
0.607 further along the line (midpoint (3.554, 0.446)). The position along the line is a free DOF of the constraint.
Before task 572 (task 563) the line form mirrored the END PAIRS (4 rows: b became exactly a's mirror image, equal length): not Fusion's.

## Dragging: snap and arc centre (task 582)
Measured by the advisor in Fusion 360 with the REAL mouse (new unsaved document, sketch on XY, cm; 2026-11-13). Ours = tests/drag-like-fusion-node.test.js
(the node kit, tests/helpers/node-app.js: the app's own pointer listeners, 30 pointer moves in a straight line, the view about 101 px per cm, no grid
magnet; ours is mm, shown here in cm).

| case | Fusion | ours before task 582 | ours after task 582 | same? |
|---|---|---|---|---|
| M1: a HELD point over a target. C (0,0)-(10,5) construction, both ends fixed; line (2,-3) fixed - P (6,3), P on C; free point Q (8,4.3), 0.3 off C. Press on P, move onto Q, release | P slides along C to (6.709, 3.355); NO constraint (1 -> 1); Q stays | P (8.120, 4.060) on C; Coincident P-Q ADDED (1 -> 2); Q pulled 0.27 onto C | P (8.124, 4.062) on C; no constraint (1 -> 1); Q stays | rule yes; P's place along C differs |
| M2: a FREE point R (2,6) dragged the same way onto Q | R on Q (8, 4.3); Coincident R-Q ADDED (1 -> 2) | R on Q; Coincident R-Q added | R on Q; Coincident R-Q added | yes |
| M3: arc by its CENTRE, start FIXED. Centre (-2,2), r 1.2, start (-0.8,2) fixed, end (-2,3.2) (sweep 90). Press on the centre, move to (-3,3), release | centre (-1.556, 2.932), start stays, end (-0.356, 2.943), radius 1.2, sweep about 51, no constraint | nothing moves (the centre drag locked on the fixed rim) | centre (-1.893, 2.496) on the circle r 1.2 about the start, start stays, end (-2.012, 3.690), radius 1.2, sweep 120.1, no constraint | rule yes (pivot about the held end, radius kept); the pose differs |
| M3 with the start held by a coincident with a fixed point | (not measured) | nothing moves | the same pivot as M3 | - |
| M3 with the start fixed AND a radius dimension 1.2 | (not measured) | nothing moves | the same pivot (end (-2.016, 3.689), sweep 120.3) | - |

**The rule (ours, task 582).** A point drag (packages/ui/input-handlers/selection-tools.js `dragToward`) first solves toward the masked cursor in the same pointer event
(the PRE-SOLVE); the cursor's snap candidate (input-manager `updateSnapTarget`, unchanged, shared with the drawing tools) is TAKEN only when the dragged point's
solved position is within the snap magnet of the candidate's point (the release distance when the previous step held the same target). A candidate it does not
take is no lock: no snap shown, no constraint at release. A free point reaches the cursor, so its snap is the cursor's, as before (M2). The INFERENCE
(H / V / parallel / perpendicular / midpoint / tangent) is still found at the masked cursor: found where the quick at-pointer pass (task 548) put the point, it
stalled stiff drawings (the owner's drawing at the framed view: the j3 corner stopped after 3 events of 4 px; worst gap 36 px), because that pass leaves the point
behind the cursor and the pin then holds it there; a converged pre-solve fixes that but changes task 548's "quick pass at the pointer" (open question to the
advisor). Instead a parallel / perpendicular inference the sketch already IMPLIES (the engine's rank test, task 575's snap rule) pins nothing and adds nothing. An arc grabbed by its centre with ONE held rim (fixed, 0 DOF, or coincident
with such a point) turns about that rim (getDragDOF `pivot`): the centre's target is the point of its circle about the rim nearest the cursor, so the radius stays;
two held rims still lock it, a held centre still locks it, a free arc is unchanged.

**Divergences (reported, owner decides).**
- M1: WHERE P stops on C. Ours goes to the point of C nearest the cursor (8.124, 4.062); Fusion stopped at (6.709, 3.355), a third of the way. Fusion's drag is path dependent
  (task 530 phase 1); its rule (no snap, no constraint, Q untouched) is ours.
- M3: the POSE. Ours puts the centre at the point of the circle about the start nearest the cursor (1.217 from it) and the free end moves least (sweep 90 -> 120.1); Fusion's centre
  is 1.446 from the cursor and its end swung to the start's side (sweep about 51). Both keep the radius and the fixed end.
- Not M1-M3 but found on the way: the arc CENTRE cells of the recorded drag oracle for a FREE arc (`arc.free.centre.*`) are KNOWN differences, not "same": Fusion translates the
  arc (MMM.), ours stretches it (MMMr, only the centre has a solver spring). Unchanged by task 582 (no held rim, no pivot). The radius-dimensioned arc (`arc.rad.centre.*`):
  Fusion translates, ours rotates; unchanged.
- Drag oracle (tests/fusion-drag.test.js): 140 same / 17 KNOWN / 4 unstable before and after task 582, every cell identical (its replay calls the pointer handlers without
  input-manager's snap search, so it has no snap candidates; no cell has a held arc rim with a centre grab).

**Owner drawing (tests/fixtures/drag/owner-two-arcs-575.json), j8 dragged 160 px along its circle in 40 events.** No grid magnet: worst gap to the cursor 40.43 -> 1.08 px,
events with an inference 40 -> 0, constraints at release 17 -> 18 (a redundant parallel(side, its collinear construction line)) before, 17 -> 17 after (the task 578
parallel-inference staircase: the side is collinear with a construction line, so the parallel inference held the end on its own line until the cursor left the angle tolerance).
At the view the app frames the drawing in (as tests/arc-rim-drag-live.test.js): j8 worst gap 19.8 -> 19.8 px (the events where the end takes the Y-axis snap it reaches),
the j3 corner (a cluster) 0.8 -> 0.8 px.
Default grid magnet: worst gap 16.23 -> 10.40 px, snap lock changes per drag 13 -> 13 (grid nodes the end passes, each within the magnet of where the end is). A LOCKED point
(the outer centre j7, welded to the origin) dragged 40 x (4, 2) px with the default grid magnet: lock changes 15 -> 2, events locked 26 -> 3 of 40 (task 575 item 3: the snap no
longer locks onto grid nodes / targets under the cursor that the held point cannot reach). Evidence: .evidence/582/probe-owner.mjs (local).

## Dragging: an arc by its centre, the origin snap, cluster inferences (task 584)
**Arc by its CENTRE, nothing held: translates whole, like Fusion.** The recorded drag oracle (tests/fusion-drag.test.js, the task 530 real-mouse cells) has Fusion
"MMM. translate" for a free arc (`arc.free.centre.along / across / diag`) and for a radius-dimensioned arc (`arc.rad.centre.*`). Ours was "MMMr stretch" (free; across:
"M..r") and "MMM. rotate" (radius). Cause: the select tool set a drag target on the centre AND both rims (selection-tools.js pullDrag), but every solve pulled ONE joint
only (engine.solve: the explicit spring of the grabbed joint in the pointer event's pass; in the app's frame solve the FIRST joint carrying a target, in joint insertion
order), so the rims followed the radius equality, not the drag. Now (one place, packages/core/solver/engine.js `_jointDragSprings`) every solve pulls EVERY joint
carrying a drag target, one spring per solver variable (coincident joints are one point), and the select tool gives a target only to the joints the drag CARRIES
(`state.drag.carried`): the grabbed point's coincident cluster, plus both rims for an arc grabbed by its centre. Unchanged: one HELD rim makes it task 582's pivot (the
rims are not carried, the radius is kept, the free end follows the constraints); a held centre locks the drag; a centre-point rectangle's group is masked with its centre
but not carried (as before, only the centre is pulled). Changed by the same cause: a BEZIER grabbed by its body (no body point declared, so its drag keeps member
targets on all four control points) moved only its FIRST control point (the one spring); it now translates whole (`.evidence/584/probe-clusters-*.txt`: control
points 2-4 (20, 30) / (40, 30) / (50, 10) stayed, now each moves by (6, -4) with the first). Fusion: not measured.

| oracle class | same / KNOWN before | after |
|---|---|---|
| arc.free.centre (3 cells) | 0 / 3 (ours MMMr / M..r stretch) | 3 / 0 (MMM. translate) |
| arc.rad.centre (3 cells) | 0 / 3 (ours MMM. rotate) | 3 / 0 (MMM. translate) |
| arc centre (kind.target, 12 cells; fixc / fixcrad: the lock, same both) | 6 / 6 | 12 / 0 |
| all 161 cells | 140 same / 17 KNOWN / 4 unstable | 146 same / 11 KNOWN / 4 unstable |

No other cell changed (`.evidence/584/oracle-before.txt` vs `oracle-after.txt`: only those 6 rows). In the node kit (tests/drag-cluster-node.test.js, 30 pointer moves, mm):
a free arc centre (-20, 20) -> (-9.954, 26.039), both rims moved by the same displacement (0.0e+0 mm off), radius 12 -> 12; before, start (-8, 20) -> (-5.174, 18.542),
radius 12 -> 8.892. The same with a radius dimension and with a rim coincident with a free line end (the line end follows, its other end stays).

**The origin is not a snap target of a drag that holds it.** input-manager.js updateSnapTarget offered `j_origin` through its explicit origin check even when the drag's
coincident cluster contains the origin (the owner's outer centre j7, welded to it: 14 offers, snapTarget + activeSnap, in 10 pointer events of (2, 1) px). The check now respects the drag's excluded joints,
as findSnap does. A free point dragged onto the origin still snaps to it (Coincident added); the drawing tools still snap to it (they have no drag, nothing excluded).

**A CLUSTER drag shows no inference.** findInference has the attached-line tests (H / V, parallel / perpendicular to another line, midpoint) for a single dragged JOINT
only; for any other drag it read the displacement start -> cursor as a line being DRAWN: a tangent to a circle the start lies on, parallel / perpendicular to a nearby
line. That is the point's motion, not a line of the sketch, so the inferred pose is one the point cannot take: the owner's j3 corner (j3 = j14 = j16: the inner arc's end,
the radial side, the radial construction line) showed a TANGENT to the inner arc on 38 of 40 events although the side is radial (it adds nothing at release only because
no snap was locked with it). Now a cluster drag (a coincident corner, an arc by its centre, a centre-point rectangle's centre) infers nothing. A single-joint drag keeps its
inferences (task 582's rules). **Fusion: to verify** what Fusion shows while dragging a corner shared by an arc and a line (not measured); the conservative choice was taken:
no inference the sketch already implies, none the point cannot satisfy.

Owner drawing (`.evidence/584/probe-owner.mjs`, `probe-j3.mjs`), before -> after: j8 40 x 4 px along / against its circle, no grid magnet: worst gap 1.08 -> 1.08 / 1.01 ->
1.01 px, lock changes 0 -> 0; default grid: 10.40 -> 10.40 / 8.96 -> 8.96 px, lock changes 13 -> 13 / 14 -> 14. j7 (welded to the origin) 40 x (4, 2) px: no grid magnet,
lock changes 2 [joint:j_origin] -> 0; default grid 2 [joint:j_origin] -> 2 [grid:0,0] (the grid node at the origin, where the held point is: a grid snap adds nothing).
j3 corner 40 x 4 px each way, zoomed: inferences 38 / 38 events -> 0 / 0, worst gap 0.99 -> 0.99 px, constraints 17 -> 17.

## Dragging: inferences of a single point (task 594)
**Fusion, measured** (2026-11-13, Fusion 360 Personal, a new unsaved document, sketch built through the bridge, edit mode entered and every drag done with
the REAL mouse, screenshots taken while the button was held; cm). Ours = tests/drag-inference-scan-node.test.js (node kit, the app's pointer listeners, mm).

| Case | Fusion while dragging / at release | Ours before | Ours after |
|---|---|---|---|
| A lone point on a circle, a vertical line 0.4 beside it, dragged along the tangent | no glyph / nothing added (the circle stretched to follow) | PARALLEL to the vertical line shown on 1 event (a point with no line) | none |
| A line end on a circle, dragged along the tangent | no glyph / nothing added | none (the circle's curve snap holds most events; canApplyInference refused the tangent) | none |
| A free line end moved parallel to a nearby line M | no glyph / nothing added | PARALLEL to M on 30 of 30 events, the end pinned on its motion line, and a Parallel L-M ADDED at release (L was 15 deg off) | none, nothing added |
| A free line end moved along its own line | no glyph / nothing added | PARALLEL to its OWN line on 30 of 30 events (pinned on its direction) | none |
| A line end shared with an arc end, dragged along the arc / its tangent | no glyph (no tangent) / nothing added | TANGENT to the arc on 5 / 5 / 12 events for a line 11-12 mm off tangent (nothing added at release) | none |
| A free line end turned until its line is parallel to M (0.06 deg) | NO parallel glyph / nothing added | PARALLEL to M (attached-line test), Parallel added | unchanged |
| A free line end turned horizontal | Horizontal glyph / Horizontal ADDED | (attached-line H, task 548 rules) | unchanged |
| A hexagon corner moved in 12 directions | not measured | none shown (canApplyInference refuses every relation the regular polygon implies); findInference's raw answer had a drawing-scan PERPENDICULAR to a side at 150 / 330 deg | none shown; raw 150 / 330 deg: none |

**The rule (ours, task 594, one place: packages/core/inference-engine.js findInference).** The DRAWING scan (H / V of the displacement, perpendicular to a line
through the start, the global parallel scan, tangent to a circle / arc the start lies on) reads startPt -> endPt as the line being drawn. In a drag that is the
point's motion, so it never runs when the options name a drag (`draggedType`); a drag gets only the tests tied to the lines through the dragged joint (and
the midpoint test), task 582's rules unchanged. The line tool (no drag in the options) keeps every drawing inference (controls in the test: tangent,
parallel, perpendicular).

**Divergence (reported, not changed).** Fusion showed no PARALLEL glyph when a free line end was turned parallel to another line (0.06 deg off) and added
nothing; ours (attached-line test, ANGLE_SNAP_DEG 3) shows it and adds a Parallel at release. Fusion's Horizontal on the same drag matches ours.
(Resolved by task 598, next section: the attached-line parallel / perpendicular test is gone.)

## Dragging: the attached-line inferences of a line end (task 598)
**Fusion, measured** (2026-11-13, Fusion 360 Personal, a new unsaved document, sketch built through the bridge, edit mode entered and every drag done with
the REAL mouse, 25 steps over 2 s, screenshots while the button was held, constraints read back after each release; cm; local evidence .evidence/598/,
fusion-summary.txt). Fusion's sketch grid snap (0.05 in in that inch document) puts a dragged point on a grid point, so the angle / length targets are the
grid points where the relation holds best; the error at release is given. Ours = tests/drag-attached-inference-node.test.js (node kit, the app's pointer
listeners, the same rows in mm, 30 events to the target).

| Row (the free end of a line L dragged; two directions each) | Fusion while held / at release | Ours before | Ours after |
|---|---|---|---|
| L turned horizontal (from above / below) | Horizontal glyph / Horizontal added | the same | the same |
| L turned vertical (from the right / left) | Vertical glyph / Vertical added | the same | the same |
| L turned parallel to another line M (0.069 / 0.033 deg; a first try at 1.0 deg) | nothing / nothing | PARALLEL shown, the end pinned, Parallel added | nothing / nothing |
| L turned perpendicular to an unconnected line N (0.003 / 0.153 deg) | nothing / nothing | PERPENDICULAR shown, Perpendicular added | nothing / nothing |
| L turned perpendicular to K, K and L sharing their corner point (0.077 / 0.074 deg) | nothing / nothing | PERPENDICULAR to K shown, added | nothing / nothing |
| L lengthened / shortened to another line's length (2.9995 / 3.0129 cm vs 3) | nothing / nothing | nothing (no equal-length inference) | nothing |
| L turned tangent to the arc it shares its other end with (0.048 / 0.009 deg) | nothing / nothing | nothing (gone since task 594) | nothing |
| L's end onto another line's midpoint (from above / the upper right) | Midpoint glyph / MidPoint added | Midpoint shown / midpoint added | the same |
| L's end onto a lone point (snap) | lands on it / Coincident added | joint snap / coincident added | the same |
| L's end onto a line, 0.8 cm from its midpoint (snap) | snap marker / Coincident (point on the line) added | line snap / pointOnLine added | the same |
| L's end onto a circle, from outside / inside (snap) | snap marker / Coincident (point on the circle) added | curve snap / pointOnLine added | the same |

**The rule (ours, task 598, one place: packages/core/inference-engine.js findInference, the attached-line tests of a joint drag).** A line through the
dragged joint offers Horizontal / Vertical only (plus the midpoint test); the parallel / perpendicular test against every other line (ANGLE_SNAP_DEG 3)
is removed. The coincident snaps are input-manager's (task 582), unchanged and already as Fusion. The line tool (no drag in the options) keeps every
drawing inference: H, V, tangent, parallel, perpendicular (the test's control).
Seen during the run: a sketch point left selected by a drag is dragged by the next press made elsewhere (Fusion), and a press under a cursor that did
not move since the view changed starts a window select.

## Mirror (task 585)
Measured by the advisor in Fusion 360 with the REAL UI (Create > Mirror, select the objects, select the mirror line, Enter; new unsaved document, cm; 2026-11-13).
Ours = tests/mirror-fusion-node.test.js (the node kit: SketchStudio's ribbon Mirror, the objects by clicks, Enter, the line by a click, Enter; ours is mm, shown
here in cm). Sketch: construction line x = 0 from (0,-1) to (0,5); line A (0,4)->(-3,4) horizontal, its start on the construction line, length dimension 3;
line B (-3,4)->(-3,1) vertical, sharing A's end; circle (-1.5,2), diameter dimension 1 (ours: radius dimension 0.5). Mirror {A, B, circle} about the
construction line.

| item | Fusion | ours (task 585) | same? |
|---|---|---|---|
| new curves | Line (0,4)->(3,4), Line (3,4)->(3,1), Circle (1.5,2) r 0.5 | the same three | yes |
| the copy's corner | shared (the chain stays connected) | ONE shared joint (our original corner is two joints + a coincident: the line tool's chain; a coincident cluster becomes one copy point) | yes |
| the point ON the mirror line | its own copy point at (0,4), linked by symmetry, not merged | the same | yes |
| new constraints | 4 symmetries: Pt(0,4)-Pt(0,4)', Pt(-3,4)-Pt(3,4), Pt(-3,1)-Pt(3,1), Circle-Circle' | the same 4 symmetric constraints (3 point form, 1 circle form) | yes |
| copied | nothing else: no horizontal, vertical, coincident-to-line, no dimension (2 stay 2) | the same | yes |
| points | 7 -> 11 (4 new) | 4 new (our total differs: the chain corner is two joints) | yes (new count) |
| undo | one step | one step ('mirror'); redo identical | yes |
| A 3 -> 4, diameter 1 -> 1.6 | copy (4,4), (4,1), r 0.8 | with the construction line held on x = 0: copy x 4, y 4.0008 / 0.9982, r 0.8 | x and r yes; y within 0.002 cm |
| A 3 -> 4 with a FREE construction line | the line stayed | task 585: the line turned 3.0 degrees (to (-0.19,-1.00)-(0.13,5.00)), A's start went to (0.080, 4.115). Since task 611: the line stays, A (0,4)->(-4,4), the copy (4,4), (4,1) exactly (mirror-fusion-node, the line free) | yes since task 611 ("Dimension edit: what moves (task 611)") |
| arcs | not measured | the circle form (centre + equal radius) PLUS point links on both ends: the copy is the true mirror image; its sweep flips | to verify in Fusion |
| the mirror line among the objects | not measured | refused ("the mirror line cannot be one of the objects to mirror") | to verify in Fusion |

Divergences (reported, owner decides):
- A FREE mirror line moves under a dimension edit: our edit's least-change solve (task 528) turns a free construction line, mirror or no mirror. Measured
  (tests/harness lib sketch, mm): without the mirror, A 30 -> 40 moves the line to (1.040,-10.034)-(5.253,49.826) and A's start to (4.569, 40.104); with the
  mirror, to (-1.905,-9.953)-(1.270,49.972), A's start (0.802, 41.146). Fusion kept the line. Held (vertical + start on the Y axis), A's height still drifts
  by 0.008 mm (0.026 mm without the mirror): the same least-change spread.
- Our circle dimension is a radius; Fusion's measured one is a diameter (the same driving, value halved).

## Dimension tool: starting with a selection, reference notice (task 589)
**Starting the Dimension tool with a selection (task 589; Fusion NOT measured, this follows the advisor's knowledge: with geometry selected, Sketch Dimension (D) takes the selection as its first pick, the label attached to the cursor).** Ours: a selected line = its length preview, a circle / arc = its RADIUS (the tool's click rule; Fusion's circle gives a diameter and a diameter dimension has no creation path in ours: divergence, unchanged), two joints = their distance, a line and a point = point-to-line distance, two lines = line-line distance (parallel) or the angle, one joint = a first pick waiting for the second. Three or more items, or a pair the tool cannot take (line + circle, two circles): the tool starts with no pick and the selection stays. To verify in Fusion: a selected circle's diameter, and what Fusion does with 3+ selected items.

**A REFERENCE (driven) dimension is announced on placement, not on the pick (task 589; Fusion NOT measured, advisor's knowledge: Fusion says nothing when a line whose length is already determined is picked, and asks about a driven dimension when it is placed).** Ours: the line's length preview is still a reference while it follows the cursor (shown in parentheses like every placing label), but "Dimension added as reference" now shows when it is placed (click, Enter, release of a press-drag), once; a second pick (another line, a point, an axis) that turns it into another dimension shows nothing. Divergence kept: ours places it as a reference with a notice, Fusion asks first.

## Select tool: double-click chain and moving a selection (task 588)
NOT measured in Fusion: the advisor's live check was cut short (a display problem), so both rows below are the advisor's knowledge of Fusion and are **to verify in
Fusion**. Ours = tests/chain-select-move-node.test.js (the node kit) and tests/chain-select-move-live.test.js (SketchStudio, real mouse and keys).

| case | Fusion (to verify in Fusion) | ours (task 588) |
|---|---|---|
| Double-click a sketch curve | selects the whole CONNECTED chain of curves through it (end-to-end lines and arcs; a closed profile's outline) | the same: every curve connected END TO END to it (an end joint shared or made coincident), THROUGH branches; only curves of the same kind (construction chains construction, normal chains normal); never into a locked or hidden sketch; a circle (no ends) is a chain of itself; a line from an arc's centre is not connected to the arc (a centre is not an end). Shift + double-click adds the chain to the selection |
| Drag a curve when several are selected | the WHOLE selection moves; its constraints, and those to unselected geometry, still hold (the solver decides what moves); fixed or fully constrained parts do not move | the same through the solver: one drag spring per selected joint (each toward its start + the cursor's displacement), every constraint holds, unselected geometry tied to the selection follows as the solver decides; a held member (fixed, 0 DOF, or coincident with such a point) locks the WHOLE group (the cluster-drag rule, getDragDOF), an axis lock of any member masks that axis for all; no snap, no inference, no constraint at release; ONE undo step "move selection" |
| Click inside a closed profile (not on an edge) | (not checked) | starts a box selection, as before (no region pick) |

To verify in Fusion: whether the double-click chain goes through branches and whether it mixes construction and normal curves; whether a group drag with a fixed member
moves the free part (ours: nothing moves); whether a group drag snaps (ours: never).

## Line / arc / circle value boxes on the first click (task 597)
Fusion was NOT measured: the task needs the REAL mouse in Fusion and this session has no mouse driver (script-launched Fusion commands are not allowed), so every Fusion cell below is the task's fallback, **to verify in Fusion**. Ours = tests/creation-boxes.test.js (node kit) and tests/line-boxes-live.test.js (real mouse and keys).

| tool, after the first click | Fusion (to verify in Fusion) | ours (task 597) |
|---|---|---|
| Line | length and angle boxes, length focused | the same: L and angle (degrees, world atan2); a typed one locks while the other follows the cursor; Tab / Shift+Tab switch; Enter or a click places and the next segment of the chain has its boxes |
| Arc (centre-start-end, the only kind the app has; 3-point and tangent do not exist here) | radius, then the sweep angle | radius after the centre click, sweep (degrees) after the start click; typed radius = the start point at that distance along the cursor and the same radius dimension as before; typed sweep = that exact angle, the winding direction follows the cursor |
| Circle | diameter | the DIAMETER box (was radius); the circle keeps its radius and a typed one adds the SAME radius dimension (isRadius, value = diameter / 2) |

Not the same / not done: a typed line ANGLE adds no constraint (geometry exact only; ours never had an angle constraint for a line); a typed arc sweep adds none either; a typed length is the existing distance constraint.

## Dimension edit: what moves (task 611)
Measured in Fusion 2706.1.17 with the REAL mouse and keys (2026-11-14): a new unsaved document (CLAUDE_MARK_611, cm), one sketch CLAUDE_TEST_611_A built through the API (geometry, constraints, dimensions; no command run), sketch edit mode by a real double-click on the timeline, then for each cell a real double-click on the dimension's value, the new value typed, Enter; every point read back after each edit; the document closed without saving. Ours = tests/dimension-edit-who-moves.test.js (mm = cm x10, the dimension box's seam commitDimensionEdit) and tests/mirror-fusion-node.test.js. Evidence (local): .evidence/611/fusion-read-*.json, fusion-*-box-crop.png, fusion-C2-*-crop.png.

| cell (Fusion, cm) | Fusion | ours before (main) | ours now |
|---|---|---|---|
| C1 free CONSTRUCTION line K x = 0 (0,-1)-(0,5); A (0,4)->(-3,4) horizontal, start on K; length 3 -> 4 | A's END to (-4,4); K and A's start stay | K turns to (0.068,-1.001)-(0.341,4.994), A's start slides to (0.296,4.004) | as Fusion |
| C2 = C1 + B (-3,4)->(-3,1) vertical sharing A's end + circle (-1.5,2) d 1, all mirrored about K (Fusion's 4 symmetries); 3 -> 4 | A's end and B move by -1 in x, the copy by +1; K and both circles stay | K turns (-0.190,-0.996)-(0.127,4.997), everything moves | as Fusion |
| C3 = C1 with K a NORMAL line | as C1 | as C1 before | as Fusion |
| C4 = C1 without the horizontal (A to (-3,3)); 3.162 -> 4 | A's end slides along A to (-3.795,2.735); K, A's start stay | K and A's start move | as Fusion |
| C5 point-to-line distance, free A's start (-1,2) to free line L x = 0; 1 -> 2 | L translates +1 in x; A stays | both move (L +0.333, A's start -0.667) | as Fusion |
| C6 angle between free L x = 0 and free A (0,2)->(-3,2), A's start on L; 90 -> 60 deg | L stays; A turns, its start sliding down L: (0,1.480), (-2.475,2.909) | L stays; A (0,1.213), (-2.726,2.787) | unchanged (same operand; the two ends share the turn differently: divergence) |
| C7 A (0,4)->(-3,4) horizontal, start on free L1 x = 0, end on free L2 x = -3; 3 -> 4 | BOTH lines translate, L1 +0.556, L2 -0.444; A stays at y 4 | both lines turn, A rises to y 4.023 | L1 and A's start stay, A stays at y 4, L2 turns through (-4,4): divergence |
| C8 = C7 without the horizontal (A to (-3,3)); 3.162 -> 4 | A's end slides down L2 to (-3,1.354); both lines and A's start stay | everything moves | as Fusion |
| R1 / R4 / R8 = C1 / C4 / C8 with the dimension picked END first | the same as C1 / C4 / C8 (the pick order does not decide) | as C1 / C4 / C8 before | as Fusion |
| R9 = C1 drawn the other way (A (-3,4)->(0,4), its END on K) | A's free START to (-4,4); K and A's end stay | K and A's end move | as Fusion |

**Fusion's rule, from these cells and the task 528 recordings:** a typed value moves the operand that GIVES WAY and what must follow it (a chain corner, a mirror copy); everything else stays, a free construction or normal line included; a moving point slides along a line it sits on rather than moving the line. Two points of one line: the point NOT attached to other geometry gives way (R1, R9); both attached (C2, C8, R8): the line's END point gives way, whichever was picked first. Two bodies: the who-moves table (task 525). A point-to-line distance: the point-on-line ranking of the table (a lone free point gives way; a line's end against a free line is a tie and the line gives way: C5, and 528's PL / LL cells).

**Ours (task 611):** `solveGivingWay` (packages/core/creation-placement.js), called by commitDimensionEdits for every value step of a SINGLE edit, after the who-moves placement: the giving operand (`editGiver`: the rule above; a radius edit: the rim gives way, the centre stays) is the only unknown, every other joint and circle radius held; when that cannot satisfy every driving constraint, the constraints left unsatisfied bring their operands in (never a symmetric's line; the anchor only through a constraint of its own), stage by stage; then the anchor; then the plain least-change solve of the whole sketch (the old behaviour). A batch of edits (a formula changing several dimensions, a paste) keeps the plain solve. Before, every edit solved every free unknown by least change, so a free line that only shared a point with the dimensioned line took part of the change (the 585 Mirror divergence).

Oracles after task 611 (before -> after, nothing that agreed stopped agreeing): fusion-dim-edit 615 -> 656 same of 864 (36 both-operands runs: line length L|0, L|3, C|0, R|0 and point-to-line PL|0,0 / 0,3 / 0,4, LL|0,0 now move Fusion's one operand; the 5 arc-centre runs: the arc's centre stays on a radius edit); which-moves 286 -> 289 of 315 (dim-length.free.A, dim-length.A_hv.A, dim-radius-arc.free.A); graded 1987 -> 1991 of 2438 (dim-length L|0, L|3, C|0, dim-radius A|0); drawings 829 of 954 unchanged; fusion-drag 146 of 161 unchanged; constraint-audit, coverage-matrix, coverage-properties, extreme-arcs, drag-like-fusion-node, solver-perf-guard pass unchanged.

Divergences (reported, owner decides): C6 (angle: the same operand moves, the turn is shared differently between A's ends); C7 (when the dimensioned line cannot absorb the change, Fusion translates both lines it sits between; ours keeps the first and turns the second); a batch edit still moves free geometry (not measured in Fusion: does Fusion's Change Parameters hold a free mirror line?); dim-line-line LL|0,0 (Fusion moves line 1, the first pick; ours both lines: no giver rule for a line-line distance yet).
