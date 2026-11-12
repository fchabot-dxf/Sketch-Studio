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

Fusion 2706.1.17, recorded 2026-11-11; 315 cells, 103 identical, 212 differ (all KNOWN in tests/fixtures/fusion-oracle/which-moves-known.json). Data: tests/fixtures/fusion-oracle/which-moves.json (before / after coordinates in mm of every entity, per cell).

| constraint / dimension | cells | same as Fusion |
|---|---|---|
| horizontal-line | 6 | 6 |
| vertical-line | 6 | 6 |
| horizontal-2pt | 6 | 4 |
| vertical-2pt | 6 | 4 |
| coincident-pp | 18 | 0 |
| parallel | 20 | 4 |
| perpendicular | 20 | 4 |
| collinear | 20 | 16 |
| equal-line-line | 20 | 0 |
| pointOnLine | 6 | 6 |
| pointOnCircle | 5 | 4 |
| midpoint | 6 | 2 |
| equal-circle-circle | 14 | 8 |
| equal-arc-arc | 14 | 4 |
| equal-arc-circle | 2 | 0 |
| tangent-line-circle | 16 | 2 |
| tangent-line-arc | 16 | 4 |
| tangent-circle-circle | 14 | 4 |
| tangent-arc-arc | 14 | 6 |
| dim-aligned | 18 | 0 |
| dim-horizontal | 18 | 3 |
| dim-vertical | 18 | 3 |
| dim-length | 6 | 3 |
| dim-radius-circle | 4 | 4 |
| dim-radius-arc | 4 | 2 |
| dim-angle | 18 | 4 |

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

#### horizontal-2pt  (4 of 6 cells the same)

Fusion's rule: The FIRST-picked point stays and the SECOND is moved onto its row; a fixed point always stays.

Verdict: FUSION DIFFERENT BY DESIGN (ours: both points meet in the middle; pick order has no effect).

Proposed fix: createConstraint, placeForCreation (the task 511 hook): for horizontal / vertical with two joints, set the second-picked joint's y (x) to the first's before the solve, unless the second is fixed (then move the first). The solver row stays as it is.

| variant | AB Fusion | AB ours | AB same | BA Fusion | BA ours | BA same |
|---|---|---|---|---|---|---|
| free | A:. B:M | A:M B:M | **NO** | A:M B:. | A:M B:M | **NO** |
| A_fix1 | A:. B:M | A:. B:M | yes | A:. B:M | A:. B:M | yes |
| B_fix1 | A:M B:. | A:M B:. | yes | A:M B:. | A:M B:. | yes |

#### vertical-2pt  (4 of 6 cells the same)

Fusion's rule: As horizontal (2 points): the first-picked point stays, the second moves onto its column.

Verdict: FUSION DIFFERENT BY DESIGN.

Proposed fix: Same hook as horizontal-2pt.

| variant | AB Fusion | AB ours | AB same | BA Fusion | BA ours | BA same |
|---|---|---|---|---|---|---|
| free | A:. B:M | A:M B:M | **NO** | A:M B:. | A:M B:M | **NO** |
| A_fix1 | A:. B:M | A:. B:M | yes | A:. B:M | A:. B:M | yes |
| B_fix1 | A:M B:. | A:M B:. | yes | A:M B:. | A:M B:. | yes |

#### coincident-pp  (0 of 18 cells the same)

Fusion's rule: The FIRST-picked point's line stays and the whole SECOND line is TRANSLATED (length and direction kept) so its point lands on the first; a line with one pinned end stretches its free end to the other point instead; a fixed or dimensioned line stays whichever order.

Verdict: FUSION DIFFERENT BY DESIGN (ours moves only the second picked joint, in BOTH orders: the line is stretched / rotated, and the pick order is ignored).

Proposed fix: placeForCreation: translate the second-picked joint's whole line (both endpoints) by the gap vector, instead of moving that one joint (the rubber-band that changes the line's length). Needs "which line owns the joint": shape.joints lookup. Pick order must reach createConstraint (the Coincident tool already passes it).

| variant | AB Fusion | AB ours | AB same | BA Fusion | BA ours | BA same |
|---|---|---|---|---|---|---|
| free | A:.. B:MM | A:.. B:M. | **NO** | A:MM B:.. | A:.. B:M. | **NO** |
| A_fix1 | A:.M B:.. | A:.. B:M. | **NO** | A:.M B:.. | A:.. B:M. | **NO** |
| A_fixfull | A:.. B:MM | A:.. B:M. | **NO** | A:.. B:MM | A:.. B:M. | **NO** |
| A_hv | A:.. B:MM | A:.. B:M. | **NO** | A:MM B:.. | A:.. B:M. | **NO** |
| A_dim | A:.. B:MM | A:.. B:M. | **NO** | A:.. B:MM | A:.. B:M. | **NO** |
| B_fix1 | A:MM B:.. | A:.M B:.. | **NO** | A:MM B:.. | A:.M B:.. | **NO** |
| B_fixfull | A:MM B:.. | A:.M B:.. | **NO** | A:MM B:.. | A:.M B:.. | **NO** |
| B_hv | A:.. B:MM | A:.M B:MM | **NO** | A:MM B:.. | A:.M B:MM | **NO** |
| B_dim | A:MM B:.. | A:.M B:MM | **NO** | A:MM B:.. | A:.M B:MM | **NO** |

#### parallel  (4 of 20 cells the same)

Fusion's rule: The FIRST-picked line stays and the SECOND rotates about its own midpoint (length kept); a line with one pinned end pivots about it (and the other stays); a fully fixed, H/V-constrained or dimensioned line stays whichever order; with a shared joint the SECOND picked pivots about it.

Verdict: FUSION DIFFERENT BY DESIGN (ours: both lines rotate, always).

Proposed fix: placeForCreation: rotate the second line about its midpoint onto the first's direction (shared joint: about the joint) before the solve, choosing the anchor by the existing _lineEstablishmentScore (fixed 4, H/V 2, aligned 1) extended with "carries a driving dimension" and "one end pinned means it pivots". The solver row is untouched.

| variant | AB Fusion | AB ours | AB same | BA Fusion | BA ours | BA same |
|---|---|---|---|---|---|---|
| free | A:.. B:MM | A:MM B:MM | **NO** | A:MM B:.. | A:MM B:MM | **NO** |
| A_fix1 | A:.M B:.. | A:.M B:MM | **NO** | A:.M B:.. | A:.M B:MM | **NO** |
| A_fixfull | A:.. B:MM | A:.. B:MM | yes | A:.. B:MM | A:.. B:MM | yes |
| A_hv | A:.. B:MM | A:MM B:MM | **NO** | A:.. B:MM | A:MM B:MM | **NO** |
| A_dim | A:.. B:MM | A:MM B:MM | **NO** | A:.. B:MM | A:MM B:MM | **NO** |
| B_fix1 | A:.. B:.M | A:MM B:.M | **NO** | A:.. B:.M | A:MM B:.M | **NO** |
| B_fixfull | A:MM B:.. | A:MM B:.. | yes | A:MM B:.. | A:MM B:.. | yes |
| B_hv | A:MM B:.. | A:MM B:MM | **NO** | A:MM B:.. | A:MM B:MM | **NO** |
| B_dim | A:MM B:.. | A:MM B:MM | **NO** | A:MM B:.. | A:MM B:MM | **NO** |
| shared | A:.. B:.M | A:MM B:MM | **NO** | A:M. B:.. | A:MM B:MM | **NO** |

#### perpendicular  (4 of 20 cells the same)

Fusion's rule: Same as parallel: the first-picked line stays, the second rotates about its midpoint (shared joint: about the joint); pinned end pivots; fixed / H-V / dimensioned lines stay.

Verdict: FUSION DIFFERENT BY DESIGN.

Proposed fix: Same hook as parallel (target direction = first line rotated 90 degrees, branch from the existing lockPerpendicularBranch).

| variant | AB Fusion | AB ours | AB same | BA Fusion | BA ours | BA same |
|---|---|---|---|---|---|---|
| free | A:.. B:MM | A:MM B:MM | **NO** | A:MM B:.. | A:MM B:MM | **NO** |
| A_fix1 | A:.M B:.. | A:.M B:MM | **NO** | A:.M B:.. | A:.M B:MM | **NO** |
| A_fixfull | A:.. B:MM | A:.. B:MM | yes | A:.. B:MM | A:.. B:MM | yes |
| A_hv | A:.. B:MM | A:MM B:MM | **NO** | A:.. B:MM | A:MM B:MM | **NO** |
| A_dim | A:.. B:MM | A:MM B:MM | **NO** | A:.. B:MM | A:MM B:MM | **NO** |
| B_fix1 | A:.. B:.M | A:MM B:.M | **NO** | A:.. B:.M | A:MM B:.M | **NO** |
| B_fixfull | A:MM B:.. | A:MM B:.. | yes | A:MM B:.. | A:MM B:.. | yes |
| B_hv | A:MM B:.. | A:MM B:MM | **NO** | A:MM B:.. | A:MM B:MM | **NO** |
| B_dim | A:MM B:.. | A:MM B:MM | **NO** | A:MM B:.. | A:MM B:MM | **NO** |
| shared | A:.. B:.M | A:MM B:MM | **NO** | A:M. B:.. | A:MM B:MM | **NO** |

#### collinear  (16 of 20 cells the same)

Fusion's rule: The FIRST-picked line stays, the second lands on it; a fixed, H/V-constrained or dimensioned line stays whichever order.

Verdict: AFTER TASK 511: most cells agree; the remaining differences are listed in the table.

| variant | AB Fusion | AB ours | AB same | BA Fusion | BA ours | BA same |
|---|---|---|---|---|---|---|
| free | A:.. B:MM | A:.. B:MM | yes | A:MM B:.. | A:MM B:.. | yes |
| A_fix1 | A:.. B:MM | A:.. B:MM | yes | A:.. B:MM | A:.M B:MM | **NO** |
| A_fixfull | A:.. B:MM | A:.. B:MM | yes | A:.. B:MM | A:.. B:MM | yes |
| A_hv | A:.. B:MM | A:.. B:MM | yes | A:.. B:MM | A:.. B:MM | yes |
| A_dim | A:.. B:MM | A:.. B:MM | yes | A:.. B:MM | A:MM B:.. | **NO** |
| B_fix1 | A:MM B:.. | A:MM B:.M | **NO** | A:MM B:.. | A:MM B:.. | yes |
| B_fixfull | A:MM B:.. | A:MM B:.. | yes | A:MM B:.. | A:MM B:.. | yes |
| B_hv | A:MM B:.. | A:MM B:.. | yes | A:MM B:.. | A:MM B:.. | yes |
| B_dim | A:MM B:.. | A:.. B:MM | **NO** | A:MM B:.. | A:MM B:.. | yes |
| shared | A:.. B:.M | A:.. B:.M | yes | A:M. B:.. | A:M. B:.. | yes |

#### equal-line-line  (0 of 20 cells the same)

Fusion's rule: The FIRST-picked line stays and the SECOND keeps its START point and direction and only changes length (its last end slides along its own line); a fixed or dimensioned line stays; a pinned end is the end that stays.

Verdict: FUSION DIFFERENT BY DESIGN (ours: both lines change length and direction).

Proposed fix: placeForCreation: set the second line's length to the first's by moving its END joint along its own direction (the unpinned end, else the second joint). Keeps direction; ours currently rotates and resizes both lines.

| variant | AB Fusion | AB ours | AB same | BA Fusion | BA ours | BA same |
|---|---|---|---|---|---|---|
| free | A:.. B:.M | A:MM B:MM | **NO** | A:.M B:.. | A:MM B:MM | **NO** |
| A_fix1 | A:.. B:.M | A:.M B:MM | **NO** | A:.M B:.. | A:.M B:MM | **NO** |
| A_fixfull | A:.. B:.M | A:.. B:MM | **NO** | A:.. B:.M | A:.. B:MM | **NO** |
| A_hv | A:.. B:.M | A:MM B:MM | **NO** | A:.. B:.M | A:MM B:MM | **NO** |
| A_dim | A:.. B:.M | A:.. B:MM | **NO** | A:.. B:.M | A:.. B:MM | **NO** |
| B_fix1 | A:.. B:.M | A:MM B:.M | **NO** | A:.M B:.. | A:MM B:.M | **NO** |
| B_fixfull | A:.M B:.. | A:MM B:.. | **NO** | A:.M B:.. | A:MM B:.. | **NO** |
| B_hv | A:.M B:.. | A:MM B:MM | **NO** | A:.M B:.. | A:MM B:MM | **NO** |
| B_dim | A:.M B:.. | A:MM B:.. | **NO** | A:.M B:.. | A:MM B:.. | **NO** |
| shared | A:.. B:.M | A:MM B:MM | **NO** | A:MM B:M. | A:MM B:MM | **NO** |

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

#### pointOnCircle  (4 of 5 cells the same)

Fusion's rule: The point moves radially onto the rim; the circle stays; a fixed point moves the circle instead.

Verdict: AFTER TASK 511: agrees except the cells marked NO.

| variant | AB Fusion | AB ours | AB same |
|---|---|---|---|
| free | A:M B:.. | A:M B:.. | yes |
| A_fix1 | A:. B:M. | A:. B:Mr | **NO** |
| B_fix1 | A:M B:.. | A:M B:.. | yes |
| B_fixfull | A:M B:.. | A:M B:.. | yes |
| B_dim | A:M B:.. | A:M B:.. | yes |

#### midpoint  (2 of 6 cells the same)

Fusion's rule: The point moves to the midpoint and the line stays; only a fixed point moves the line (translated).

Verdict: FUSION DIFFERENT BY DESIGN (ours also moves the line when the point is free).

Proposed fix: createConstraint, placeForCreation: move the free point to the midpoint before the solve; the solver row stays as it is, but its Jacobian must not move the line while the point is free (use the same one-sided option pointOnLine had: `mutual` off unless the point is fixed). Today the line's two ends move too.

| variant | AB Fusion | AB ours | AB same |
|---|---|---|---|
| free | A:M B:.. | A:M B:MM | **NO** |
| A_fix1 | A:. B:MM | A:. B:MM | yes |
| B_fix1 | A:M B:.. | A:M B:.M | **NO** |
| B_fixfull | A:M B:.. | A:M B:.. | yes |
| B_hv | A:M B:.. | A:M B:MM | **NO** |
| B_dim | A:M B:.. | A:M B:MM | **NO** |

#### equal-circle-circle  (8 of 14 cells the same)

Fusion's rule: The SECOND-picked circle is resized (its centre stays); a circle with a driving radius or fully fixed stays; a circle with a fixed centre is the one that resizes, even when picked first.

Verdict: OUR BUG (F2): refused.

Proposed fix: OUR BUG F2 (docs/CONSTRAINT-AUDIT.md): the radius is shape data, not a solver unknown; nothing to place until the radius is a DOF (task 510 / the O2 decision). Not a createConstraint fix.

| variant | AB Fusion | AB ours | AB same | BA Fusion | BA ours | BA same |
|---|---|---|---|---|---|---|
| free | A:.. B:.r | A:.r B:.r | **NO** | A:.r B:.. | A:.r B:.r | **NO** |
| A_fix1 | A:.r B:.. | A:.r B:.r | **NO** | A:.r B:.. | A:.r B:.r | **NO** |
| A_fixfull | A:.. B:.r | A:.. B:.r | yes | A:.. B:.r | A:.. B:.r | yes |
| A_dim | A:.. B:.r | A:.. B:.r | yes | A:.. B:.r | A:.. B:.r | yes |
| B_fix1 | A:.. B:.r | A:.r B:.r | **NO** | A:.. B:.r | A:.r B:.r | **NO** |
| B_fixfull | A:.r B:.. | A:.r B:.. | yes | A:.r B:.. | A:.r B:.. | yes |
| B_dim | A:.r B:.. | A:.r B:.. | yes | A:.r B:.. | A:.r B:.. | yes |

#### equal-arc-arc  (4 of 14 cells the same)

Fusion's rule: The SECOND-picked arc is re-sized (centre, ends and radius all move); the first stays; an arc with a pinned centre is the one that resizes (even when first); a fully fixed or radius-dimensioned arc stays.

Verdict: FUSION DIFFERENT BY DESIGN (ours moves both arcs).

Proposed fix: The arc has real joints, so the solver can do it; the change is the anchor choice (first picked stays, the arc with a pinned centre or a radius dimension is held) in the same placeForCreation hook. Fusion moves the whole second arc (centre too), not only its radius.

| variant | AB Fusion | AB ours | AB same | BA Fusion | BA ours | BA same |
|---|---|---|---|---|---|---|
| free | A:.... B:MMMr | A:MMMr B:MMMr | **NO** | A:MMMr B:.... | A:MMMr B:MMMr | **NO** |
| A_fix1 | A:.MMr B:.... | A:.MMr B:MMMr | **NO** | A:.MMr B:.... | A:.MMr B:MMMr | **NO** |
| A_fixfull | A:.... B:MMMr | A:.... B:MMMr | yes | A:.... B:MMMr | A:.... B:MMMr | yes |
| A_dim | A:.... B:MMMr | A:MMM. B:MMMr | **NO** | A:.... B:MMMr | A:MMM. B:MMMr | **NO** |
| B_fix1 | A:.... B:.MMr | A:MMMr B:.MMr | **NO** | A:.... B:.MMr | A:MMMr B:.MMr | **NO** |
| B_fixfull | A:MMMr B:.... | A:MMMr B:.... | yes | A:MMMr B:.... | A:MMMr B:.... | yes |
| B_dim | A:MMMr B:.... | A:MMMr B:MMM. | **NO** | A:MMMr B:.... | A:MMMr B:MMM. | **NO** |

#### equal-arc-circle  (0 of 2 cells the same)

Fusion's rule: Fusion's API REFUSES equal(arc, circle) with "invalid argument value" (the interactive tool may differ; not measurable through the API).

Verdict: SAME (both refuse) - ours refuses for the F2 reason, Fusion for an API reason: do not read it as agreement.

| variant | AB Fusion | AB ours | AB same | BA Fusion | BA ours | BA same |
|---|---|---|---|---|---|---|
| free | refused | A:MMMr B:.r | **NO** | refused | A:MMMr B:.r | **NO** |

#### tangent-line-circle  (2 of 16 cells the same)

Fusion's rule: The LINE moves (rotates and translates; pick order is irrelevant) and the circle stays; a pinned or fixed line stays and the circle's centre moves; a circle with a dimensioned radius moves its centre while the line stays.

Verdict: FUSION DIFFERENT BY DESIGN (ours moves both).

Proposed fix: placeForCreation: move the line (never the circle) onto tangency, nearest side, unless the line is pinned (then move the circle centre) or the circle's radius is dimensioned. Ours moves both the line and the circle centre.

| variant | AB Fusion | AB ours | AB same | BA Fusion | BA ours | BA same |
|---|---|---|---|---|---|---|
| free | A:MM B:.. | A:MM B:Mr | **NO** | A:MM B:.. | A:MM B:Mr | **NO** |
| A_fix1 | A:.. B:M. | A:.M B:Mr | **NO** | A:.. B:M. | A:.M B:Mr | **NO** |
| A_fixfull | A:.. B:M. | A:.. B:Mr | **NO** | A:.. B:M. | A:.. B:Mr | **NO** |
| A_hv | A:MM B:.. | A:MM B:Mr | **NO** | A:MM B:.. | A:MM B:Mr | **NO** |
| A_dim | A:MM B:.. | A:MM B:Mr | **NO** | A:MM B:.. | A:MM B:Mr | **NO** |
| B_fix1 | A:MM B:.. | A:MM B:.r | **NO** | A:MM B:.. | A:MM B:.r | **NO** |
| B_fixfull | A:MM B:.. | A:MM B:.. | yes | A:MM B:.. | A:MM B:.. | yes |
| B_dim | A:.. B:M. | A:MM B:M. | **NO** | A:.. B:M. | A:MM B:M. | **NO** |

#### tangent-line-arc  (4 of 16 cells the same)

Fusion's rule: The LINE moves and the arc stays (even with a dimensioned radius); a pinned or fixed line stays and the whole arc is translated.

Verdict: FUSION DIFFERENT BY DESIGN (ours moves both, and re-sizes the arc).

Proposed fix: Same hook as tangent-line-circle. Ours also changes the arc's radius and all three points.

| variant | AB Fusion | AB ours | AB same | BA Fusion | BA ours | BA same |
|---|---|---|---|---|---|---|
| free | A:MM B:.... | A:MM B:MMMr | **NO** | A:MM B:.... | A:MM B:MMMr | **NO** |
| A_fix1 | A:.. B:MMM. | A:.M B:MMMr | **NO** | A:.. B:MMM. | A:.M B:MMMr | **NO** |
| A_fixfull | A:.. B:MMM. | A:.. B:MMMr | **NO** | A:.. B:MMM. | A:.. B:MMMr | **NO** |
| A_hv | A:MM B:.... | A:MM B:MMMr | **NO** | A:MM B:.... | A:MM B:MMMr | **NO** |
| A_dim | A:MM B:.... | A:MM B:MMMr | **NO** | A:MM B:.... | A:MM B:MMMr | **NO** |
| B_fix1 | A:MM B:.... | A:MM B:.... | yes | A:MM B:.... | A:MM B:.... | yes |
| B_fixfull | A:MM B:.... | A:MM B:.... | yes | A:MM B:.... | A:MM B:.... | yes |
| B_dim | A:MM B:.... | A:MM B:MMM. | **NO** | A:MM B:.... | A:MM B:MMM. | **NO** |

#### tangent-circle-circle  (4 of 14 cells the same)

Fusion's rule: The SECOND-picked circle moves AND is re-sized (centre and radius); the first stays; a circle with a dimensioned radius or fixed centre keeps its radius, so the other circle's centre absorbs the change.

Verdict: FUSION DIFFERENT BY DESIGN, tied to the open O2 question (circle radius as a DOF).

Proposed fix: Not a createConstraint fix: our circle radius is shape data (O2 / F2). Ours moves both centres and never touches a radius.

| variant | AB Fusion | AB ours | AB same | BA Fusion | BA ours | BA same |
|---|---|---|---|---|---|---|
| free | A:.. B:Mr | A:Mr B:Mr | **NO** | A:Mr B:.. | A:Mr B:Mr | **NO** |
| A_fix1 | A:.. B:Mr | A:.r B:Mr | **NO** | A:.r B:.. | A:.r B:Mr | **NO** |
| A_fixfull | A:.. B:Mr | A:.. B:Mr | yes | A:.. B:Mr | A:.. B:Mr | yes |
| A_dim | A:M. B:.. | A:M. B:Mr | **NO** | A:M. B:.. | A:M. B:Mr | **NO** |
| B_fix1 | A:.. B:.r | A:Mr B:.r | **NO** | A:Mr B:.. | A:Mr B:.r | **NO** |
| B_fixfull | A:Mr B:.. | A:Mr B:.. | yes | A:Mr B:.. | A:Mr B:.. | yes |
| B_dim | A:.. B:M. | A:Mr B:M. | **NO** | A:.. B:M. | A:Mr B:M. | **NO** |

#### tangent-arc-arc  (6 of 14 cells the same)

Fusion's rule: The SECOND-picked arc moves and re-sizes (3 points + radius); the first stays; a pinned centre makes that arc the one that changes; fixed / radius-dimensioned arcs stay.

Verdict: FUSION DIFFERENT BY DESIGN (ours moves both).

Proposed fix: Same anchor choice as equal-arc-arc.

| variant | AB Fusion | AB ours | AB same | BA Fusion | BA ours | BA same |
|---|---|---|---|---|---|---|
| free | A:.... B:MMMr | A:MMMr B:MMMr | **NO** | A:MMMr B:.... | A:MMMr B:MMMr | **NO** |
| A_fix1 | A:.... B:MMMr | A:.... B:MMMr | yes | A:.MMr B:.... | A:.... B:MMMr | **NO** |
| A_fixfull | A:.... B:MMMr | A:.... B:MMMr | yes | A:.... B:MMMr | A:.... B:MMMr | yes |
| A_dim | A:MMM. B:.... | A:MMM. B:MMMr | **NO** | A:MMM. B:.... | A:MMM. B:MMMr | **NO** |
| B_fix1 | A:.... B:.MMr | A:MMMr B:.... | **NO** | A:MMMr B:.... | A:MMMr B:.... | yes |
| B_fixfull | A:MMMr B:.... | A:MMMr B:.... | yes | A:MMMr B:.... | A:MMMr B:.... | yes |
| B_dim | A:.... B:MMM. | A:MMMr B:MMM. | **NO** | A:.... B:MMM. | A:MMMr B:MMM. | **NO** |

#### dim-aligned  (0 of 18 cells the same)

Fusion's rule: Pick order is IGNORED: the unconstrained line (the later-created one when both are free) is TRANSLATED whole to the new distance; a fixed, H/V or dimensioned line stays.

Verdict: FUSION DIFFERENT BY DESIGN.

Proposed fix: The edit path (commitDimensionEdit, packages/ui/dimension-seams.js): before the solve translate the whole line that owns the unconstrained joint along the measured direction. Ours moves just the two dimension points.

| variant | AB Fusion | AB ours | AB same | BA Fusion | BA ours | BA same |
|---|---|---|---|---|---|---|
| free | A:.. B:MM | A:.M B:M. | **NO** | A:.. B:MM | A:.M B:M. | **NO** |
| A_fix1 | A:.. B:MM | A:.M B:M. | **NO** | A:.. B:MM | A:.M B:M. | **NO** |
| A_fixfull | A:.. B:MM | A:.. B:M. | **NO** | A:.. B:MM | A:.. B:M. | **NO** |
| A_hv | A:.. B:MM | A:MM B:M. | **NO** | A:.. B:MM | A:MM B:M. | **NO** |
| A_dim | A:.. B:MM | A:MM B:M. | **NO** | A:.. B:MM | A:MM B:M. | **NO** |
| B_fix1 | A:MM B:.. | A:.M B:.. | **NO** | A:MM B:.. | A:.M B:.. | **NO** |
| B_fixfull | A:MM B:.. | A:.M B:.. | **NO** | A:MM B:.. | A:.M B:.. | **NO** |
| B_hv | A:MM B:.. | A:.M B:MM | **NO** | A:MM B:.. | A:.M B:MM | **NO** |
| B_dim | A:MM B:.. | A:.M B:MM | **NO** | A:MM B:.. | A:.M B:MM | **NO** |

#### dim-horizontal  (3 of 18 cells the same)

Fusion's rule: The FIRST-picked point moves (along x only, nothing else) and the second stays; when the first-picked point is on a fixed line, the SECOND line is translated; when the second point is pinned or its line is fixed / dimensioned, the first moves (its line translates if the first-picked point is itself pinned).

Verdict: FUSION DIFFERENT BY DESIGN (ours: first picked is the anchor, Fusion: it is the one that moves).

Proposed fix: commitDimensionEdit: move the first-picked joint only, along the dimension axis. Ours moves the second point and (when held) the first.

| variant | AB Fusion | AB ours | AB same | BA Fusion | BA ours | BA same |
|---|---|---|---|---|---|---|
| free | A:.M B:.. | A:.M B:M. | **NO** | A:.. B:M. | A:.M B:M. | **NO** |
| A_fix1 | A:.M B:.. | A:.M B:M. | **NO** | A:.. B:M. | A:.M B:M. | **NO** |
| A_fixfull | A:.. B:MM | A:.. B:M. | **NO** | A:.. B:M. | A:.. B:M. | yes |
| A_hv | A:MM B:.. | A:.M B:M. | **NO** | A:.. B:M. | A:.M B:M. | **NO** |
| A_dim | A:MM B:.. | A:MM B:M. | **NO** | A:.. B:M. | A:MM B:M. | **NO** |
| B_fix1 | A:.M B:.. | A:.M B:.. | yes | A:MM B:.. | A:.M B:.. | **NO** |
| B_fixfull | A:.M B:.. | A:.M B:.. | yes | A:MM B:.. | A:.M B:.. | **NO** |
| B_hv | A:.M B:.. | A:.M B:M. | **NO** | A:.. B:MM | A:.M B:M. | **NO** |
| B_dim | A:.M B:.. | A:.M B:MM | **NO** | A:.. B:MM | A:.M B:MM | **NO** |

#### dim-vertical  (3 of 18 cells the same)

Fusion's rule: As horizontal dimension: the first-picked point moves (along y only), the second stays.

Verdict: FUSION DIFFERENT BY DESIGN.

Proposed fix: Same as dim-horizontal.

| variant | AB Fusion | AB ours | AB same | BA Fusion | BA ours | BA same |
|---|---|---|---|---|---|---|
| free | A:.M B:.. | A:.M B:M. | **NO** | A:.. B:M. | A:.M B:M. | **NO** |
| A_fix1 | A:.M B:.. | A:.M B:M. | **NO** | A:.. B:M. | A:.M B:M. | **NO** |
| A_fixfull | A:.. B:MM | A:.. B:M. | **NO** | A:.. B:M. | A:.. B:M. | yes |
| A_hv | A:MM B:.. | A:MM B:M. | **NO** | A:.. B:M. | A:MM B:M. | **NO** |
| A_dim | A:MM B:.. | A:MM B:M. | **NO** | A:.. B:M. | A:MM B:M. | **NO** |
| B_fix1 | A:.M B:.. | A:.M B:.. | yes | A:MM B:.. | A:.M B:.. | **NO** |
| B_fixfull | A:.M B:.. | A:.M B:.. | yes | A:MM B:.. | A:.M B:.. | **NO** |
| B_hv | A:.M B:.. | A:.M B:MM | **NO** | A:.. B:MM | A:.M B:MM | **NO** |
| B_dim | A:.M B:.. | A:.M B:MM | **NO** | A:.. B:MM | A:.M B:MM | **NO** |

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

#### dim-angle  (4 of 18 cells the same)

Fusion's rule: The FIRST-picked line stays and the SECOND rotates about its midpoint (length kept); a fixed / H-V / dimensioned line stays whichever order; a pinned end pivots.

Verdict: FUSION DIFFERENT BY DESIGN (ours: both rotate).

Proposed fix: commitDimensionEdit: rotate the second line about its midpoint onto the new angle, anchor chosen like parallel. Ours rotates both lines.

| variant | AB Fusion | AB ours | AB same | BA Fusion | BA ours | BA same |
|---|---|---|---|---|---|---|
| free | A:.. B:MM | A:MM B:MM | **NO** | A:.. B:MM | A:MM B:MM | **NO** |
| A_fix1 | A:.. B:MM | A:.M B:MM | **NO** | A:.. B:MM | A:.M B:MM | **NO** |
| A_fixfull | A:.. B:MM | A:.. B:MM | yes | A:.. B:MM | A:.. B:MM | yes |
| A_hv | A:.. B:MM | A:MM B:MM | **NO** | A:.. B:MM | A:MM B:MM | **NO** |
| A_dim | A:.. B:MM | A:MM B:MM | **NO** | A:.. B:MM | A:MM B:MM | **NO** |
| B_fix1 | A:MM B:.. | A:MM B:.M | **NO** | A:MM B:.. | A:MM B:.M | **NO** |
| B_fixfull | A:MM B:.. | A:MM B:.. | yes | A:MM B:.. | A:MM B:.. | yes |
| B_hv | A:MM B:.. | A:MM B:MM | **NO** | A:MM B:.. | A:MM B:MM | **NO** |
| B_dim | A:MM B:.. | A:MM B:MM | **NO** | A:MM B:.. | A:MM B:MM | **NO** |

<!-- which-moves:end -->

## Which geometry moves: graded

<!-- graded:begin -->

Fusion 2706.1.17, recorded 2026-11-11. 2438 cells; data `tests/fixtures/fusion-oracle/which-moves-graded.json` (positions before / after in mm, per cell), known differences `which-moves-graded-known.json` (per class: constraint x kind pair; "all" when the whole class differs). The cells are built by `tests/harness/fusion-oracle/graded.js` with the matrix builders (rect tool, polygon tool, fillet tool, arc, circle), the level applied with real constraints, then replayed in Fusion by `scripts/fusion-oracle/run-jobs.py`.

**How to read it.** A = the FIRST pick, B = the SECOND pick (so pick order is the row / column order). Levels of a free-standing line: `0` free, `1` one end coincident with another free line (a chain), `2` length dimension, `3` H or V, `4` one end fixed, `5` end fixed + length, `6` H/V + end fixed, `7` fully constrained by constraints and dimensions only (H/V + length + the two position dimensions from the origin), `o` one end coincident with the origin, `m` midpoint at the origin. Rect side: `0`, `8` the whole rectangle fully constrained by dimensions. Polygon side: `0`. Construction line: `0`, `4`. Circle / arc: `0`, `c` centre fixed, `r` radius dimension, `cr` both; fillet arc: `0`, `c`. Point: `0`, `4` fixed. Origin (`Z`): the origin point. Cell symbol: `a` only the first pick moves, `b` only the second, `X` both, `-` neither, `R` refused. `Fusion/ours`; a trailing `*` = they differ.

**Reductions (the full cross product is about 40 000 cells).** Line-line groups: free-standing line x free-standing line at the 8 levels (10 with `o`, `m` in the point groups), every other line-like kind (construction line `C`, polygon side `S`, rect side `R`) only against a plain line and against itself, at 2 levels (S: 1). A plain line against a non-line operand: levels 0, 3, 4, 7. Point groups: points of a line (end), rect corner, circle / arc centre, free point and the origin; the compound kinds only free. Not covered: bezier (not constrainable in ours: its endpoints are plain joints, covered as points; Fusion cannot express our cubic), polygon side and fillet arc beyond level 0 / `c`, B-kinds crossed with each other beyond the listed pairs, the point-to-line distance dimension (ours projects a helper joint: finding NEW-1), diameter dimension (no creation path), concentric (not in `CONSTRAINT_TYPES`; a coincident of two centres is the same cell). Fusion exposes no DOF count, only `isFullyConstrained` per entity and per sketch: the DOF before / after is therefore **not** recorded for Fusion (ours: nullity, see the 512 matrix).

| constraint / dimension | cells | same as Fusion | Fusion refuses, ours accepts | ours refuses, Fusion accepts |
|---|---|---|---|---|
| parallel | 113 | 11 | 21 | 4 |
| perpendicular | 113 | 31 | 0 | 13 |
| collinear | 113 | 52 | 0 | 2 |
| equal-line-line | 113 | 35 | 0 | 0 |
| dim-angle | 113 | 20 | 21 | 0 |
| coincident-pp | 232 | 104 | 0 | 3 |
| dim-aligned | 232 | 60 | 48 | 0 |
| dim-horizontal | 157 | 45 | 28 | 0 |
| dim-vertical | 157 | 53 | 30 | 0 |
| horizontal-2pt | 157 | 68 | 2 | 3 |
| vertical-2pt | 157 | 58 | 2 | 1 |
| pointOnLine | 117 | 42 | 0 | 0 |
| pointOnCircle | 130 | 56 | 4 | 0 |
| midpoint | 117 | 48 | 0 | 3 |
| equal-circle | 100 | 48 | 44 | 0 |
| tangent-line-circle | 180 | 74 | 0 | 4 |
| tangent-circle-circle | 100 | 56 | 0 | 7 |
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

#### The origin as an operand

Ours identifies the origin as the joint `j_origin` (created by `createEngine`: `{ x: 0, y: 0, fixed: true }`); a constraint names it like any joint (`joints: ['j_origin', ...]`) and the solver skips fixed joints, so it can only be a point of a constraint, never an entity. Fusion's is `sketch.originPoint` (a SketchPoint, `isFixed` true, read-only geometry; `gc.addCoincident(sk.originPoint, p)` is how a constraint reaches it). **172 cells have the origin as A or B (both pick orders)** with every constraint that takes a point (coincident, point-on-line / on circle, midpoint with the origin as the midpoint, H / V between two points, every point-point dimension mode) and the point kinds line end, rect corner, circle / arc centre, free point; plus the levels `o` (a line end coincident with the origin) and `m` (a line centred on the origin by midpoint). **The origin never moved and was never deleted in any of the 2438 cells, in Fusion (`originPoint` read back after every act) and in ours (`j_origin` still in `joints` at 0,0): confirmed** (origin cells alone: ok). The N-F1 bug (a fillet on an origin corner deletes the origin) is not reached by these cells: no cell applies a fillet at the origin, so no cell is marked "caused by N-F1" (it stays a finding of the 512 audit).

Axes: ours has NO axis entities (no X / Y axis line in the sketch model: only the origin joint), so "constrain to an axis" cannot be run in ours. Fusion probe (one call, not stored): `sketch.project(root.xConstructionAxis)` gives a SketchLine; a coincident of a free line end with it moves only that point onto the axis (end (20,20) became (20,0), the other end stayed); parallel to it rotates the free line about its midpoint. A user can still get an axis in ours as an ordinary line through the origin (levels `o` / `7`).

#### parallel

Fusion's rule (fitted on the 55 accepted one-mover cells of the free-standing line pair): rank the levels {4} < {0,1,5} < {2} < {3,6,7} (lowest moves first); the operand with the LOWER rank is the one that moves, a tie means the SECOND pick moves. It predicts 55 of 55 (no contradiction). In words: the operand held least (level 4) is the one that gives way, the most held (3, 6, 7) always stays; two operands at the same rank: the first pick stays and the second is moved.

Grid, line (A) x line (B), `Fusion/ours`:

| A \ B | 0 free | 1 corner | 2 length | 3 H/V | 4 end fixed | 5 end+length | 6 H/V+end | 7 full |
|---|---|---|---|---|---|---|---|---|
| 0 free | b/X* | b/X* | a/X* | a/X* | b/X* | b/X* | a/X* | a/a |
| 1 corner | b/X* | b/X* | a/X* | a/X* | b/X* | b/X* | a/X* | a/a |
| 2 length | b/X* | b/X* | b/X* | a/X* | b/X* | b/X* | a/X* | a/a |
| 3 H/V | b/X* | b/X* | b/X* | R/-* | b/R* | b/R* | R/-* | R/-* |
| 4 end fixed | a/X* | a/X* | a/X* | a/X* | b/X* | a/X* | a/X* | a/a |
| 5 end+length | b/X* | b/X* | a/X* | a/X* | b/X* | b/X* | a/X* | a/a |
| 6 H/V+end | b/X* | b/X* | b/X* | R/-* | b/X* | b/X* | R/-* | R/-* |
| 7 full | b/b | b/b | b/b | R/-* | b/b | b/b | R/-* | R/-* |

| kinds (A,B) | cells | same | Fusion who-moves | ours who-moves | how Fusion moves it | how ours moves it |
|---|---|---|---|---|---|---|
| LL | 64 | 6 | a:22 b:33 R:9 | a:5 b:5 X:43 -:9 R:2 | one end:35 rotate:20 | stretch:40 one end:40 rotate:16 |
| LC | 8 | 1 | a:1 b:7 | b:2 X:5 R:1 | one end:5 rotate:3 | stretch:7 one end:5 |
| CL | 8 | 1 | a:5 b:3 | a:2 X:6 | one end:5 rotate:3 | stretch:8 one end:6 |
| LS | 4 | 0 | a:2 b:2 | b:1 X:3 | rotate:3 one end:1 | scale:4 stretch:2 one end:1 |
| SL | 4 | 0 | a:2 b:2 | a:1 X:2 R:1 | rotate:3 one end:1 | scale:3 stretch:2 |
| LR | 8 | 1 | a:4 R:4 | a:2 X:2 -:4 | rotate:2 one end:2 | stretch:2 deform:2 one end:2 |
| RL | 8 | 1 | b:4 R:4 | b:2 X:2 -:4 | rotate:2 one end:2 | deform:2 stretch:2 one end:2 |
| CC | 4 | 0 | a:1 b:3 | X:4 | one end:3 rotate:1 | stretch:4 one end:4 |
| SS | 1 | 1 | -:1 | -:1 |  |  |
| RR | 4 | 0 | R:4 | -:4 |  |  |

#### perpendicular

Fusion's rule (fitted on the 55 accepted one-mover cells of the free-standing line pair): rank the levels {4} < {0,1,5} < {2} < {3,6,7} (lowest moves first); the operand with the LOWER rank is the one that moves, a tie means the SECOND pick moves. It predicts 55 of 55 (no contradiction). In words: the operand held least (level 4) is the one that gives way, the most held (3, 6, 7) always stays; two operands at the same rank: the first pick stays and the second is moved.

Grid, line (A) x line (B), `Fusion/ours`:

| A \ B | 0 free | 1 corner | 2 length | 3 H/V | 4 end fixed | 5 end+length | 6 H/V+end | 7 full |
|---|---|---|---|---|---|---|---|---|
| 0 free | b/X* | b/X* | a/X* | a/X* | b/X* | b/X* | a/X* | a/a |
| 1 corner | b/X* | b/X* | a/X* | a/X* | b/X* | b/X* | a/X* | a/a |
| 2 length | b/X* | b/X* | b/X* | a/X* | b/X* | b/X* | a/X* | a/a |
| 3 H/V | b/R* | b/R* | b/R* | R/R | b/R* | b/R* | R/R | R/R |
| 4 end fixed | a/X* | a/X* | a/X* | a/R* | b/X* | a/X* | a/X* | a/a |
| 5 end+length | b/X* | b/X* | a/X* | a/R* | b/X* | b/X* | a/X* | a/a |
| 6 H/V+end | b/X* | b/X* | b/X* | R/R | b/R* | b/R* | R/R | R/R |
| 7 full | b/b | b/b | b/b | R/R | b/b | b/b | R/R | R/R |

| kinds (A,B) | cells | same | Fusion who-moves | ours who-moves | how Fusion moves it | how ours moves it |
|---|---|---|---|---|---|---|
| LL | 64 | 15 | a:22 b:33 R:9 | a:5 b:5 X:36 R:18 | one end:35 rotate:20 | one end:34 stretch:33 rotate:15 |
| LC | 8 | 1 | a:1 b:7 | b:2 X:4 R:2 | one end:5 rotate:3 | stretch:5 one end:5 |
| CL | 8 | 1 | a:5 b:3 | a:2 X:5 R:1 | one end:5 rotate:3 | stretch:7 one end:5 |
| LS | 4 | 0 | a:2 b:2 | b:1 X:3 | rotate:3 one end:1 | scale:4 stretch:2 one end:1 |
| SL | 4 | 0 | a:2 b:2 | a:1 X:3 | rotate:3 one end:1 | rotate:3 scale:2 stretch:1 one end:1 |
| LR | 8 | 5 | a:4 R:4 | a:2 X:2 R:4 | rotate:2 one end:2 | stretch:2 deform:2 one end:2 |
| RL | 8 | 5 | b:4 R:4 | b:2 X:1 R:5 | rotate:2 one end:2 | stretch:2 deform:1 one end:1 |
| CC | 4 | 0 | a:1 b:3 | X:4 | one end:3 rotate:1 | stretch:4 one end:4 |
| SS | 1 | 0 | b:1 | X:1 | rotate:1 | scale:2 |
| RR | 4 | 4 | R:4 | R:4 |  |  |

#### collinear

Fusion's rule (fitted on the 39 accepted one-mover cells of the free-standing line pair): rank the levels {0} < {2} < {1,3,5} < {4,6,7} (lowest moves first); the operand with the LOWER rank is the one that moves, a tie means the SECOND pick moves. It predicts 39 of 39 (no contradiction); 11 cells move both operands and are outside the rule. In words: the operand held least (level 0) is the one that gives way, the most held (4, 6, 7) always stays; two operands at the same rank: the first pick stays and the second is moved.

Grid, line (A) x line (B), `Fusion/ours`:

| A \ B | 0 free | 1 corner | 2 length | 3 H/V | 4 end fixed | 5 end+length | 6 H/V+end | 7 full |
|---|---|---|---|---|---|---|---|---|
| 0 free | b/b | a/b* | a/b* | a/a | a/X* | a/X* | a/a | a/a |
| 1 corner | b/b | X/b* | b/b | X/a* | a/X* | X/X | a/a | a/a |
| 2 length | b/b | a/b* | b/b | a/a | a/X* | a/X* | a/a | a/a |
| 3 H/V | b/b | X/b* | b/b | b/b | X/X | X/X | a/X* | a/a |
| 4 end fixed | b/b | b/b | b/b | R/R | X/X | X/X | R/R | R/R |
| 5 end+length | b/b | X/b* | b/b | R/R | X/X | X/X | R/R | R/R |
| 6 H/V+end | b/b | b/b | b/b | b/b | R/R | R/R | R/R | R/R |
| 7 full | b/b | b/b | b/b | b/b | R/R | R/R | R/R | R/R |

| kinds (A,B) | cells | same | Fusion who-moves | ours who-moves | how Fusion moves it | how ours moves it |
|---|---|---|---|---|---|---|
| LL | 64 | 36 | a:18 b:21 X:11 R:14 | a:10 b:27 X:13 R:14 | rotate:32 one end:12 stretch:11 translate:6 | stretch:30 one end:17 rotate:13 translate:3 |
| LC | 8 | 3 | a:1 b:4 X:2 R:1 | b:4 X:3 R:1 | rotate:5 one end:3 stretch:1 | stretch:6 one end:4 |
| CL | 8 | 3 | a:3 b:2 X:1 R:2 | a:2 b:2 X:2 R:2 | rotate:5 one end:2 | stretch:5 one end:3 |
| LS | 4 | 0 | a:1 b:3 | X:2 R:2 | rotate:4 | deform:2 stretch:1 one end:1 |
| SL | 4 | 0 | a:3 b:1 | a:1 b:1 X:2 | rotate:4 | stretch:2 deform:2 scale:1 one end:1 |
| LR | 8 | 3 | a:4 b:1 X:1 R:2 | a:3 b:2 X:1 R:2 | translate:3 rotate:2 one end:1 deform:1 | stretch:3 deform:3 one end:1 |
| RL | 8 | 5 | a:1 b:4 X:1 R:2 | a:1 b:4 X:1 R:2 | translate:3 rotate:2 deform:1 one end:1 | stretch:2 translate:2 deform:2 one end:1 |
| CC | 4 | 1 | a:1 b:2 X:1 | b:2 X:2 | rotate:3 one end:2 | stretch:3 one end:3 |
| SS | 1 | 0 | b:1 | X:1 | translate:1 | scale:1 deform:1 |
| RR | 4 | 1 | a:1 b:2 R:1 | a:1 b:2 R:1 | translate:3 | deform:3 |

#### equal-line-line

Fusion's rule (fitted on the 55 accepted one-mover cells of the free-standing line pair): rank the levels {0,4} < {3,6} < {1} < {2,5,7} (lowest moves first); the operand with the LOWER rank is the one that moves, a tie means the SECOND pick moves. It predicts 55 of 55 (no contradiction). In words: the operand held least (levels 0, 4) is the one that gives way, the most held (2, 5, 7) always stays; two operands at the same rank: the first pick stays and the second is moved.

Grid, line (A) x line (B), `Fusion/ours`:

| A \ B | 0 free | 1 corner | 2 length | 3 H/V | 4 end fixed | 5 end+length | 6 H/V+end | 7 full |
|---|---|---|---|---|---|---|---|---|
| 0 free | b/X* | a/X* | a/a | a/X* | b/X* | a/a | a/X* | a/a |
| 1 corner | b/X* | b/X* | a/a | b/X* | b/X* | a/a | b/X* | a/a |
| 2 length | b/b | b/b | R/R | b/b | b/b | R/R | b/b | R/R |
| 3 H/V | b/X* | a/X* | a/a | b/X* | b/X* | a/a | b/X* | a/a |
| 4 end fixed | b/X* | a/X* | a/a | a/X* | b/X* | a/a | a/X* | a/a |
| 5 end+length | b/b | b/b | R/R | b/b | b/b | R/R | b/b | R/R |
| 6 H/V+end | b/X* | a/X* | a/a | b/X* | b/X* | a/a | b/X* | a/a |
| 7 full | b/b | b/b | R/R | b/b | b/b | R/R | b/b | R/R |

| kinds (A,B) | cells | same | Fusion who-moves | ours who-moves | how Fusion moves it | how ours moves it |
|---|---|---|---|---|---|---|
| LL | 64 | 21 | a:23 b:32 R:9 | a:15 b:15 X:25 R:9 | one end:55 | stretch:48 one end:32 |
| LC | 8 | 1 | b:8 | b:2 X:6 | one end:8 | stretch:8 one end:6 |
| CL | 8 | 1 | a:4 b:4 | a:2 X:6 | one end:8 | stretch:8 one end:6 |
| LS | 4 | 1 | a:3 b:1 | b:1 X:3 | one end:3 scale:1 | scale:4 stretch:2 one end:1 |
| SL | 4 | 1 | a:1 b:3 | a:1 X:3 | one end:3 scale:1 | scale:4 stretch:2 one end:1 |
| LR | 8 | 3 | a:6 b:1 R:1 | a:3 b:1 X:3 R:1 | one end:6 deform:1 | stretch:4 deform:4 one end:2 |
| RL | 8 | 3 | a:1 b:6 R:1 | a:1 b:3 X:3 R:1 | one end:6 deform:1 | deform:4 stretch:4 one end:2 |
| CC | 4 | 0 | b:4 | X:4 | one end:4 | stretch:4 one end:4 |
| SS | 1 | 1 | -:1 | -:1 |  |  |
| RR | 4 | 3 | a:1 b:2 R:1 | a:1 b:1 X:1 R:1 | deform:3 | deform:4 |

#### dim-angle

Fusion's rule (fitted on the 55 accepted one-mover cells of the free-standing line pair): rank the levels {0,1} < {2,4} < {5} < {3,6,7} (lowest moves first); the operand with the LOWER rank is the one that moves, a tie means the SECOND pick moves. It predicts 54 of 55; contradicting cells: dim-angle|LL|2,4. In words: the operand held least (levels 0, 1) is the one that gives way, the most held (3, 6, 7) always stays; two operands at the same rank: the first pick stays and the second is moved.

Grid, line (A) x line (B), `Fusion/ours`:

| A \ B | 0 free | 1 corner | 2 length | 3 H/V | 4 end fixed | 5 end+length | 6 H/V+end | 7 full |
|---|---|---|---|---|---|---|---|---|
| 0 free | b/X* | b/X* | a/X* | a/X* | a/X* | a/X* | a/X* | a/a |
| 1 corner | b/X* | b/X* | a/X* | a/X* | a/X* | a/X* | a/X* | a/a |
| 2 length | b/X* | b/X* | b/X* | a/X* | a/X* | a/X* | a/X* | a/a |
| 3 H/V | b/X* | b/X* | b/X* | R/-* | b/X* | b/X* | R/-* | R/-* |
| 4 end fixed | b/X* | b/X* | b/X* | a/X* | b/X* | a/X* | a/X* | a/a |
| 5 end+length | b/X* | b/X* | b/X* | a/X* | b/X* | b/X* | a/X* | a/a |
| 6 H/V+end | b/X* | b/X* | b/X* | R/-* | b/X* | b/X* | R/-* | R/-* |
| 7 full | b/b | b/b | b/b | R/-* | b/b | b/b | R/-* | R/-* |

| kinds (A,B) | cells | same | Fusion who-moves | ours who-moves | how Fusion moves it | how ours moves it |
|---|---|---|---|---|---|---|
| LL | 64 | 10 | a:24 b:31 R:9 | a:5 b:5 X:45 -:9 | one end:20 stretch:20 rotate:15 | stretch:42 one end:42 rotate:16 |
| LC | 8 | 2 | a:1 b:7 | b:2 X:6 | stretch:4 one end:3 rotate:1 | stretch:8 one end:6 |
| CL | 8 | 2 | a:5 b:3 | a:2 X:6 | stretch:4 one end:3 rotate:1 | stretch:8 one end:6 |
| LS | 4 | 1 | a:1 b:3 | b:1 X:3 | scale:3 rotate:1 | scale:4 stretch:2 one end:1 |
| SL | 4 | 1 | a:3 b:1 | a:1 X:3 | scale:3 rotate:1 | scale:4 stretch:2 one end:1 |
| LR | 8 | 2 | a:4 R:4 | a:2 X:2 -:4 | stretch:2 one end:2 | stretch:2 deform:2 one end:2 |
| RL | 8 | 2 | b:4 R:4 | b:2 X:2 -:4 | stretch:2 one end:2 | deform:2 stretch:2 one end:2 |
| CC | 4 | 0 | a:1 b:3 | X:4 | stretch:2 rotate:1 one end:1 | stretch:4 one end:4 |
| SS | 1 | 0 | b:1 | X:1 | rotate:1 | scale:2 |
| RR | 4 | 0 | R:4 | -:4 |  |  |

#### coincident-pp

Fusion's rule (fitted on the 73 accepted one-mover cells of the free-standing line pair): rank the levels {0,m} < {2,3} < {1} < {4,5,6,7,o} (lowest moves first); the operand with the LOWER rank is the one that moves, a tie means the SECOND pick moves. It predicts 73 of 73 (no contradiction); 1 cells move both operands and are outside the rule. In words: the operand held least (levels 0, m) is the one that gives way, the most held (4, 5, 6, 7, o) always stays; two operands at the same rank: the first pick stays and the second is moved.

Grid, line (A) x line (B), `Fusion/ours`:

| A \ B | 0 free | 1 corner | 2 length | 3 H/V | 4 end fixed | 5 end+length | 6 H/V+end | 7 full | o end at origin | m mid at origin |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 free | b/b | a/b* | a/X* | a/X* | a/a | a/a | a/a | a/a | a/a | b/X* |
| 1 corner | b/b | b/b | b/X* | b/X* | a/a | a/a | a/a | a/a | a/a | b/X* |
| 2 length | b/b | a/b* | b/X* | b/X* | a/a | a/a | a/a | a/a | a/a | b/X* |
| 3 H/V | b/b | a/b* | b/X* | b/X* | a/a | a/a | a/a | a/a | a/a | b/X* |
| 4 end fixed | b/b | b/b | b/b | b/b | R/R | R/R | R/R | R/R | R/R | b/b |
| 5 end+length | b/b | b/b | b/b | b/b | R/R | R/R | R/R | R/R | R/R | b/b |
| 6 H/V+end | b/b | b/b | b/b | b/b | R/R | R/R | R/R | R/R | R/R | b/b |
| 7 full | b/b | b/b | b/b | b/b | R/R | R/R | R/R | R/R | R/R | b/b |
| o end at origin | b/b | b/b | b/b | b/b | R/R | R/R | R/R | R/R | -/- | R/R |
| m mid at origin | b/b | a/b* | a/X* | a/X* | a/a | a/a | a/a | a/a | R/R | b/X* |

| kinds (A,B) | cells | same | Fusion who-moves | ours who-moves | how Fusion moves it | how ours moves it |
|---|---|---|---|---|---|---|
| LL | 100 | 35 | a:32 b:41 -:1 R:26 | a:24 b:34 X:15 -:1 R:26 | translate:57 stretch:16 | one end:36 stretch:33 rotate:18 translate:1 |
| LR | 6 | 0 | a:3 b:3 | b:3 X:3 | translate:5 stretch:1 | deform:6 stretch:2 one end:1 |
| LO | 12 | 10 | a:3 b:6 R:3 | a:3 b:6 R:3 | translate:8 stretch:1 | translate:6 stretch:2 one end:1 |
| LA | 6 | 0 | a:3 b:3 | b:3 X:3 | translate:5 stretch:1 | deform+radius:6 stretch:2 one end:1 |
| LP | 12 | 10 | a:3 b:6 R:3 | a:3 b:6 R:3 | translate:8 stretch:1 | translate:6 stretch:2 one end:1 |
| LZ | 6 | 4 | a:2 R:4 | a:2 R:4 | translate:2 | one end:1 stretch:1 |
| RL | 6 | 0 | a:3 b:3 | a:2 b:1 X:2 R:1 | translate:5 stretch:1 | deform:4 stretch:2 one end:1 |
| RR | 1 | 0 | b:1 | X:1 | translate:1 | deform:2 |
| RO | 2 | 1 | a:1 b:1 | b:1 R:1 | translate:2 | translate:1 |
| RA | 1 | 0 | b:1 | X:1 | translate:1 | deform:1 deform+radius:1 |
| RP | 2 | 1 | a:1 b:1 | b:1 R:1 | translate:2 | translate:1 |
| RZ | 1 | 0 | a:1 | a:1 | translate:1 | deform:1 |
| OL | 12 | 7 | a:6 b:3 R:3 | a:3 b:4 X:2 R:3 | translate:8 stretch:1 | translate:5 stretch:4 one end:2 |
| OR | 2 | 0 | a:1 b:1 | b:1 X:1 | translate:2 | deform:2 translate:1 |
| OO | 4 | 4 | a:1 b:2 R:1 | a:1 b:2 R:1 | translate:3 | translate:3 |
| OA | 2 | 0 | a:1 b:1 | b:1 X:1 | translate:2 | deform+radius:2 translate:1 |
| OP | 4 | 4 | a:1 b:2 R:1 | a:1 b:2 R:1 | translate:3 | translate:3 |
| OZ | 2 | 2 | a:1 R:1 | a:1 R:1 | translate:1 | translate:1 |
| AL | 6 | 0 | a:3 b:3 | a:3 b:1 X:2 | translate:5 stretch:1 | deform+radius:4 stretch:2 one end:1 one point (deform)+radius:1 |
| AR | 1 | 0 | a:1 | X:1 | translate:1 | deform+radius:1 deform:1 |
| AO | 2 | 1 | a:1 b:1 | a:1 b:1 | translate:2 | translate:1 deform+radius:1 |
| AA | 1 | 0 | b:1 | X:1 | translate:1 | deform+radius:2 |
| AP | 2 | 1 | a:1 b:1 | a:1 b:1 | translate:2 | translate:1 deform+radius:1 |
| AZ | 1 | 0 | a:1 | a:1 | translate:1 | one point (deform)+radius:1 |
| PL | 12 | 7 | a:6 b:3 R:3 | a:3 b:4 X:2 R:3 | translate:8 stretch:1 | translate:5 stretch:4 one end:2 |
| PR | 2 | 0 | a:1 b:1 | b:1 X:1 | translate:2 | deform:2 translate:1 |
| PO | 4 | 3 | a:2 b:1 R:1 | a:1 b:2 R:1 | translate:3 | translate:3 |
| PA | 2 | 0 | a:1 b:1 | b:1 X:1 | translate:2 | deform+radius:2 translate:1 |
| PP | 4 | 4 | a:1 b:2 R:1 | a:1 b:2 R:1 | translate:3 | translate:3 |
| PZ | 2 | 2 | a:1 R:1 | a:1 R:1 | translate:1 | translate:1 |
| ZL | 6 | 4 | b:2 R:4 | b:2 R:4 | translate:2 | one end:1 stretch:1 |
| ZR | 1 | 0 | b:1 | b:1 | translate:1 | deform:1 |
| ZO | 2 | 2 | b:1 R:1 | b:1 R:1 | translate:1 | translate:1 |
| ZA | 1 | 0 | b:1 | b:1 | translate:1 | deform+radius:1 |
| ZP | 2 | 2 | b:1 R:1 | b:1 R:1 | translate:1 | translate:1 |

#### dim-aligned

Fusion's rule (fitted on the 75 accepted one-mover cells of the free-standing line pair): rank the levels {0,2} < {1,m} < {3} < {4,5,6,7,o} (lowest moves first); the operand with the LOWER rank is the one that moves, a tie means the SECOND pick moves. It predicts 73 of 75; contradicting cells: dim-aligned|LL|0,2, dim-aligned|LL|1,m; 1 cells move both operands and are outside the rule. In words: the operand held least (levels 0, 2) is the one that gives way, the most held (4, 5, 6, 7, o) always stays; two operands at the same rank: the first pick stays and the second is moved.

Grid, line (A) x line (B), `Fusion/ours`:

| A \ B | 0 free | 1 corner | 2 length | 3 H/V | 4 end fixed | 5 end+length | 6 H/V+end | 7 full | o end at origin | m mid at origin |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 free | b/X* | a/X* | a/X* | a/X* | a/a | a/a | a/a | a/a | a/a | a/X* |
| 1 corner | b/X* | b/X* | b/X* | a/X* | a/a | a/a | a/a | a/a | a/a | a/X* |
| 2 length | b/X* | a/X* | b/X* | a/X* | a/a | a/a | a/a | a/a | a/a | a/X* |
| 3 H/V | b/X* | b/X* | b/X* | b/X* | a/a | a/a | a/a | a/a | a/a | b/X* |
| 4 end fixed | b/b | b/b | b/b | b/b | R/-* | R/-* | R/-* | R/-* | R/-* | b/b |
| 5 end+length | b/b | b/b | b/b | b/b | R/-* | R/-* | R/-* | R/-* | R/-* | b/b |
| 6 H/V+end | b/b | b/b | b/b | b/b | R/-* | R/-* | R/-* | R/-* | R/-* | b/b |
| 7 full | b/b | b/b | b/b | b/b | R/-* | R/-* | R/-* | R/-* | R/-* | b/b |
| o end at origin | b/b | b/b | b/b | b/b | R/-* | R/-* | R/-* | R/-* | -/- | b/b |
| m mid at origin | b/X* | b/X* | b/X* | a/X* | a/a | a/a | a/a | a/a | a/a | b/X* |

| kinds (A,B) | cells | same | Fusion who-moves | ours who-moves | how Fusion moves it | how ours moves it |
|---|---|---|---|---|---|---|
| LL | 100 | 20 | a:35 b:40 -:1 R:24 | a:25 b:25 X:25 -:25 | stretch:41 translate:20 rotate:14 | one end:40 stretch:40 rotate:20 |
| LR | 6 | 0 | a:3 b:3 | b:3 X:3 | translate:4 stretch:2 | deform:6 stretch:2 one end:1 |
| LO | 12 | 4 | a:3 b:6 R:3 | a:3 b:3 X:3 -:3 | translate:7 stretch:2 | translate:6 stretch:4 one end:2 |
| LA | 6 | 3 | a:1 b:5 | b:3 X:3 | deform+radius:5 translate:1 | deform+radius:6 stretch:2 one end:1 |
| LP | 12 | 4 | a:3 b:6 R:3 | a:3 b:3 X:3 -:3 | translate:7 stretch:2 | translate:6 stretch:4 one end:2 |
| LZ | 6 | 1 | a:3 -:1 R:2 | a:3 -:3 | stretch:2 translate:1 | stretch:2 one end:1 |
| RL | 6 | 0 | a:3 b:3 | a:3 X:3 | translate:4 stretch:2 | deform:6 stretch:2 one end:1 |
| RR | 1 | 0 | b:1 | X:1 | translate:1 | deform:2 |
| RO | 2 | 0 | a:1 b:1 | a:1 X:1 | translate:2 | deform:2 translate:1 |
| RA | 1 | 0 | b:1 | X:1 | deform+radius:1 | deform:1 deform+radius:1 |
| RP | 2 | 0 | a:1 b:1 | a:1 X:1 | translate:2 | deform:2 translate:1 |
| RZ | 1 | 0 | a:1 | a:1 | translate:1 | deform:1 |
| OL | 12 | 4 | a:6 b:3 R:3 | a:3 b:3 X:3 -:3 | translate:7 stretch:2 | translate:6 stretch:4 one end:2 |
| OR | 2 | 0 | a:1 b:1 | b:1 X:1 | translate:2 | deform:2 translate:1 |
| OO | 4 | 2 | a:1 b:2 R:1 | a:1 b:1 X:1 -:1 | translate:3 | translate:4 |
| OA | 2 | 1 | a:1 b:1 | b:1 X:1 | translate:1 deform+radius:1 | deform+radius:2 translate:1 |
| OP | 4 | 2 | a:1 b:2 R:1 | a:1 b:1 X:1 -:1 | translate:3 | translate:4 |
| OZ | 2 | 1 | a:1 R:1 | a:1 -:1 | translate:1 | translate:1 |
| AL | 6 | 2 | a:5 b:1 | a:3 X:3 | deform+radius:5 translate:1 | deform+radius:5 stretch:2 one end:1 one point (deform)+radius:1 |
| AR | 1 | 0 | a:1 | X:1 | deform+radius:1 | deform+radius:1 deform:1 |
| AO | 2 | 1 | a:1 b:1 | a:1 X:1 | translate:1 deform+radius:1 | deform+radius:2 translate:1 |
| AA | 1 | 0 | b:1 | X:1 | translate:1 | deform+radius:2 |
| AP | 2 | 1 | a:1 b:1 | a:1 X:1 | translate:1 deform+radius:1 | deform+radius:2 translate:1 |
| AZ | 1 | 0 | a:1 | a:1 | deform+radius:1 | one point (deform)+radius:1 |
| PL | 12 | 4 | a:6 b:3 R:3 | a:3 b:3 X:3 -:3 | translate:7 stretch:2 | translate:6 stretch:4 one end:2 |
| PR | 2 | 0 | a:1 b:1 | b:1 X:1 | translate:2 | deform:2 translate:1 |
| PO | 4 | 2 | a:2 b:1 R:1 | a:1 b:1 X:1 -:1 | translate:3 | translate:4 |
| PA | 2 | 1 | a:1 b:1 | b:1 X:1 | translate:1 deform+radius:1 | deform+radius:2 translate:1 |
| PP | 4 | 2 | a:1 b:2 R:1 | a:1 b:1 X:1 -:1 | translate:3 | translate:4 |
| PZ | 2 | 1 | a:1 R:1 | a:1 -:1 | translate:1 | translate:1 |
| ZL | 6 | 1 | b:3 -:1 R:2 | b:3 -:3 | stretch:2 translate:1 | stretch:2 one end:1 |
| ZR | 1 | 0 | b:1 | b:1 | translate:1 | deform:1 |
| ZO | 2 | 1 | b:1 R:1 | b:1 -:1 | translate:1 | translate:1 |
| ZA | 1 | 1 | b:1 | b:1 | deform+radius:1 | deform+radius:1 |
| ZP | 2 | 1 | b:1 R:1 | b:1 -:1 | translate:1 | translate:1 |

#### dim-horizontal

Fusion's rule (fitted on the 21 accepted one-mover cells of the free-standing line pair): rank the levels {0} < {3} < {2} < {4,7} (lowest moves first); the operand with the LOWER rank is the one that moves, a tie means the SECOND pick moves. It predicts 16 of 21; contradicting cells: dim-horizontal|LL|0,0, dim-horizontal|LL|2,0, dim-horizontal|LL|2,2, dim-horizontal|LL|2,3, dim-horizontal|LL|3,3. In words: the operand held least (level 0) is the one that gives way, the most held (4, 7) always stays; two operands at the same rank: the first pick stays and the second is moved.

Grid, line (A) x line (B), `Fusion/ours`:

| A \ B | 0 free | 2 length | 3 H/V | 4 end fixed | 7 full |
|---|---|---|---|---|---|
| 0 free | a/X* | a/X* | a/X* | a/a | a/a |
| 2 length | a/X* | a/X* | a/X* | a/a | a/a |
| 3 H/V | b/X* | a/X* | a/X* | a/a | a/a |
| 4 end fixed | b/b | b/b | b/b | R/-* | R/-* |
| 7 full | b/b | b/b | b/b | R/-* | R/-* |

| kinds (A,B) | cells | same | Fusion who-moves | ours who-moves | how Fusion moves it | how ours moves it |
|---|---|---|---|---|---|---|
| LL | 25 | 4 | a:14 b:7 R:4 | a:6 b:6 X:9 -:4 | translate:11 one end:5 rotate:5 | one end:20 rotate:10 |
| LR | 6 | 0 | a:3 b:3 | b:3 X:3 | translate:4 one end:1 stretch:1 | deform:6 one end:2 stretch:1 |
| LO | 12 | 5 | a:4 b:5 R:3 | a:3 b:3 X:3 -:3 | translate:6 one end:2 stretch:1 | translate:6 one end:4 stretch:2 |
| LA | 6 | 0 | a:3 b:3 | b:3 X:3 | translate:4 one end:1 stretch:1 | deform+radius:6 one end:2 stretch:1 |
| LP | 12 | 5 | a:4 b:5 R:3 | a:3 b:3 X:3 -:3 | translate:6 one end:2 stretch:1 | translate:6 one end:4 stretch:2 |
| LZ | 6 | 3 | a:3 R:3 | a:3 -:2 R:1 | one end:1 translate:1 stretch:1 | one end:2 stretch:1 |
| RL | 6 | 0 | a:3 b:3 | a:3 X:3 | translate:5 stretch:1 | deform:6 one end:2 stretch:1 |
| RR | 1 | 0 | a:1 | X:1 | translate:1 | deform:2 |
| RO | 2 | 0 | a:1 b:1 | a:1 X:1 | translate:2 | deform:2 translate:1 |
| RA | 1 | 0 | b:1 | X:1 | translate:1 | deform:1 deform+radius:1 |
| RP | 2 | 0 | a:1 b:1 | a:1 X:1 | translate:2 | deform:2 translate:1 |
| RZ | 1 | 0 | a:1 | a:1 | translate:1 | deform:1 |
| OL | 12 | 4 | a:6 b:3 R:3 | a:3 b:3 X:3 -:3 | translate:8 stretch:1 | translate:6 one end:4 stretch:2 |
| OR | 2 | 0 | a:1 b:1 | b:1 X:1 | translate:2 | deform:2 translate:1 |
| OO | 4 | 2 | a:2 b:1 R:1 | a:1 b:1 X:1 -:1 | translate:3 | translate:4 |
| OA | 2 | 0 | a:1 b:1 | b:1 X:1 | translate:2 | deform+radius:2 translate:1 |
| OP | 4 | 2 | a:2 b:1 R:1 | a:1 b:1 X:1 -:1 | translate:3 | translate:4 |
| OZ | 2 | 1 | a:1 R:1 | a:1 -:1 | translate:1 | translate:1 |
| AL | 6 | 3 | a:6 | a:3 X:3 | deform+radius:6 | deform+radius:6 one end:2 stretch:1 |
| AR | 1 | 0 | a:1 | X:1 | deform+radius:1 | deform+radius:1 deform:1 |
| AO | 2 | 1 | a:2 | a:1 X:1 | deform+radius:2 | deform+radius:2 translate:1 |
| AA | 1 | 0 | a:1 | X:1 | deform+radius:1 | deform+radius:2 |
| AP | 2 | 1 | a:2 | a:1 X:1 | deform+radius:2 | deform+radius:2 translate:1 |
| AZ | 1 | 1 | a:1 | a:1 | deform+radius:1 | deform+radius:1 |
| PL | 12 | 4 | a:6 b:3 R:3 | a:3 b:3 X:3 -:3 | translate:8 stretch:1 | translate:6 one end:4 stretch:2 |
| PR | 2 | 0 | a:1 b:1 | b:1 X:1 | translate:2 | deform:2 translate:1 |
| PO | 4 | 2 | a:2 b:1 R:1 | a:1 b:1 X:1 -:1 | translate:3 | translate:4 |
| PA | 2 | 0 | a:1 b:1 | b:1 X:1 | translate:2 | deform+radius:2 translate:1 |
| PP | 4 | 2 | a:2 b:1 R:1 | a:1 b:1 X:1 -:1 | translate:3 | translate:4 |
| PZ | 2 | 1 | a:1 R:1 | a:1 -:1 | translate:1 | translate:1 |
| ZL | 6 | 2 | b:3 R:3 | b:3 -:2 R:1 | translate:2 stretch:1 | one end:2 stretch:1 |
| ZR | 1 | 0 | b:1 | b:1 | translate:1 | deform:1 |
| ZO | 2 | 1 | b:1 R:1 | b:1 -:1 | translate:1 | translate:1 |
| ZA | 1 | 0 | b:1 | b:1 | translate:1 | deform+radius:1 |
| ZP | 2 | 1 | b:1 R:1 | b:1 -:1 | translate:1 | translate:1 |

#### dim-vertical

Fusion's rule (fitted on the 21 accepted one-mover cells of the free-standing line pair): rank the levels {0} < {3} < {2} < {4,7} (lowest moves first); the operand with the LOWER rank is the one that moves, a tie means the SECOND pick moves. It predicts 17 of 21; contradicting cells: dim-vertical|LL|0,0, dim-vertical|LL|2,0, dim-vertical|LL|2,2, dim-vertical|LL|2,3. In words: the operand held least (level 0) is the one that gives way, the most held (4, 7) always stays; two operands at the same rank: the first pick stays and the second is moved.

Grid, line (A) x line (B), `Fusion/ours`:

| A \ B | 0 free | 2 length | 3 H/V | 4 end fixed | 7 full |
|---|---|---|---|---|---|
| 0 free | a/X* | a/X* | a/X* | a/a | a/a |
| 2 length | a/X* | a/X* | a/X* | a/a | a/a |
| 3 H/V | b/X* | a/X* | b/X* | a/a | a/a |
| 4 end fixed | b/b | b/b | b/b | R/-* | R/-* |
| 7 full | b/b | b/b | b/b | R/-* | R/-* |

| kinds (A,B) | cells | same | Fusion who-moves | ours who-moves | how Fusion moves it | how ours moves it |
|---|---|---|---|---|---|---|
| LL | 25 | 8 | a:13 b:8 R:4 | a:6 b:6 X:9 -:4 | translate:11 one end:5 rotate:5 | one end:10 rotate:10 translate:10 |
| LR | 6 | 0 | a:3 b:3 | b:3 X:3 | translate:4 one end:1 stretch:1 | deform:6 one end:1 translate:1 stretch:1 |
| LO | 12 | 6 | a:4 b:5 R:3 | a:3 b:3 X:3 -:3 | translate:6 one end:2 stretch:1 | translate:8 one end:2 stretch:2 |
| LA | 6 | 0 | a:3 b:3 | b:3 X:3 | translate:4 one end:1 stretch:1 | deform+radius:6 one end:1 translate:1 stretch:1 |
| LP | 12 | 6 | a:4 b:5 R:3 | a:3 b:3 X:3 -:3 | translate:6 one end:2 stretch:1 | translate:8 one end:2 stretch:2 |
| LZ | 6 | 3 | a:3 R:3 | a:3 -:3 | one end:1 translate:1 stretch:1 | one end:1 translate:1 stretch:1 |
| RL | 6 | 0 | a:3 b:3 | a:3 X:3 | translate:5 stretch:1 | deform:6 one end:1 translate:1 stretch:1 |
| RR | 1 | 0 | b:1 | X:1 | translate:1 | deform:2 |
| RO | 2 | 0 | a:1 b:1 | a:1 X:1 | translate:2 | deform:2 translate:1 |
| RA | 1 | 0 | b:1 | X:1 | translate:1 | deform:1 deform+radius:1 |
| RP | 2 | 0 | a:1 b:1 | a:1 X:1 | translate:2 | deform:2 translate:1 |
| RZ | 1 | 0 | a:1 | a:1 | translate:1 | deform:1 |
| OL | 12 | 5 | a:6 b:3 R:3 | a:3 b:3 X:3 -:3 | translate:8 stretch:1 | translate:8 one end:2 stretch:2 |
| OR | 2 | 0 | a:1 b:1 | b:1 X:1 | translate:2 | deform:2 translate:1 |
| OO | 4 | 2 | a:2 b:1 R:1 | a:1 b:1 X:1 -:1 | translate:3 | translate:4 |
| OA | 2 | 0 | a:1 b:1 | b:1 X:1 | translate:2 | deform+radius:2 translate:1 |
| OP | 4 | 2 | a:2 b:1 R:1 | a:1 b:1 X:1 -:1 | translate:3 | translate:4 |
| OZ | 2 | 1 | a:1 R:1 | a:1 -:1 | translate:1 | translate:1 |
| AL | 6 | 3 | a:6 | a:3 X:3 | deform+radius:6 | deform+radius:6 one end:1 translate:1 stretch:1 |
| AR | 1 | 0 | a:1 | X:1 | deform+radius:1 | deform+radius:1 deform:1 |
| AO | 2 | 1 | a:2 | a:1 X:1 | deform+radius:2 | deform+radius:2 translate:1 |
| AA | 1 | 0 | a:1 | X:1 | deform+radius:1 | deform+radius:2 |
| AP | 2 | 1 | a:2 | a:1 X:1 | deform+radius:2 | deform+radius:2 translate:1 |
| AZ | 1 | 1 | a:1 | a:1 | deform+radius:1 | deform+radius:1 |
| PL | 12 | 5 | a:6 b:3 R:3 | a:3 b:3 X:3 -:3 | translate:8 stretch:1 | translate:8 one end:2 stretch:2 |
| PR | 2 | 0 | a:1 b:1 | b:1 X:1 | translate:2 | deform:2 translate:1 |
| PO | 4 | 2 | a:2 b:1 R:1 | a:1 b:1 X:1 -:1 | translate:3 | translate:4 |
| PA | 2 | 0 | a:1 b:1 | b:1 X:1 | translate:2 | deform+radius:2 translate:1 |
| PP | 4 | 2 | a:2 b:1 R:1 | a:1 b:1 X:1 -:1 | translate:3 | translate:4 |
| PZ | 2 | 1 | a:1 R:1 | a:1 -:1 | translate:1 | translate:1 |
| ZL | 6 | 2 | b:3 R:3 | b:3 -:3 | translate:2 stretch:1 | one end:1 translate:1 stretch:1 |
| ZR | 1 | 0 | b:1 | b:1 | translate:1 | deform:1 |
| ZO | 2 | 1 | b:1 R:1 | b:1 -:1 | translate:1 | translate:1 |
| ZA | 1 | 0 | b:1 | b:1 | translate:1 | deform+radius:1 |
| ZP | 2 | 1 | b:1 R:1 | b:1 -:1 | translate:1 | translate:1 |

#### horizontal-2pt

Fusion's rule (fitted on the 21 accepted one-mover cells of the free-standing line pair): rank the levels {0} < {3} < {2} < {4,7} (lowest moves first); the operand with the LOWER rank is the one that moves, a tie means the SECOND pick moves. It predicts 20 of 21; contradicting cells: horizontal-2pt|LL|3,3. In words: the operand held least (level 0) is the one that gives way, the most held (4, 7) always stays; two operands at the same rank: the first pick stays and the second is moved.

Grid, line (A) x line (B), `Fusion/ours`:

| A \ B | 0 free | 2 length | 3 H/V | 4 end fixed | 7 full |
|---|---|---|---|---|---|
| 0 free | b/X* | a/X* | a/X* | a/a | a/a |
| 2 length | b/X* | b/X* | b/X* | a/a | a/a |
| 3 H/V | b/X* | a/X* | a/X* | a/a | a/a |
| 4 end fixed | b/b | b/b | b/b | R/R | R/R |
| 7 full | b/b | b/b | b/b | R/R | R/R |

| kinds (A,B) | cells | same | Fusion who-moves | ours who-moves | how Fusion moves it | how ours moves it |
|---|---|---|---|---|---|---|
| LL | 25 | 8 | a:10 b:11 R:4 | a:6 b:6 X:9 R:4 | translate:21 | one end:10 rotate:10 translate:10 |
| LR | 6 | 0 | a:3 b:3 | b:3 X:3 | translate:5 stretch:1 | deform:6 one end:1 translate:1 stretch:1 |
| LO | 12 | 8 | a:3 b:6 R:3 | a:3 b:3 X:3 R:3 | translate:8 stretch:1 | translate:8 one end:2 stretch:2 |
| LA | 6 | 0 | a:3 b:3 | b:3 X:3 | translate:5 stretch:1 | deform+radius:6 one end:1 translate:1 stretch:1 |
| LP | 12 | 8 | a:3 b:6 R:3 | a:3 b:3 X:3 R:3 | translate:8 stretch:1 | translate:8 one end:2 stretch:2 |
| LZ | 6 | 4 | a:3 R:3 | a:3 -:1 R:2 | translate:2 stretch:1 | one end:1 translate:1 stretch:1 |
| RL | 6 | 0 | a:3 b:3 | a:2 X:3 R:1 | translate:5 stretch:1 | deform:5 one end:1 translate:1 stretch:1 |
| RR | 1 | 0 | a:1 | X:1 | translate:1 | deform:2 |
| RO | 2 | 0 | a:1 b:1 | X:1 R:1 | translate:2 | deform:1 translate:1 |
| RA | 1 | 0 | b:1 | X:1 | translate:1 | deform:1 deform+radius:1 |
| RP | 2 | 0 | a:1 b:1 | X:1 R:1 | translate:2 | deform:1 translate:1 |
| RZ | 1 | 0 | a:1 | a:1 | translate:1 | deform:1 |
| OL | 12 | 8 | a:6 b:3 R:3 | a:3 b:3 X:3 R:3 | translate:8 stretch:1 | translate:8 one end:2 stretch:2 |
| OR | 2 | 0 | a:1 b:1 | b:1 X:1 | translate:2 | deform:2 translate:1 |
| OO | 4 | 3 | a:1 b:2 R:1 | a:1 b:1 X:1 R:1 | translate:3 | translate:4 |
| OA | 2 | 0 | a:1 b:1 | b:1 X:1 | translate:2 | deform+radius:2 translate:1 |
| OP | 4 | 3 | a:1 b:2 R:1 | a:1 b:1 X:1 R:1 | translate:3 | translate:4 |
| OZ | 2 | 2 | a:1 R:1 | a:1 R:1 | translate:1 | translate:1 |
| AL | 6 | 0 | a:3 b:3 | a:3 X:3 | translate:5 stretch:1 | deform+radius:6 one end:1 translate:1 stretch:1 |
| AR | 1 | 0 | a:1 | X:1 | translate:1 | deform+radius:1 deform:1 |
| AO | 2 | 0 | a:1 b:1 | a:1 X:1 | translate:2 | deform+radius:2 translate:1 |
| AA | 1 | 0 | b:1 | X:1 | translate:1 | deform+radius:2 |
| AP | 2 | 0 | a:1 b:1 | a:1 X:1 | translate:2 | deform+radius:2 translate:1 |
| AZ | 1 | 0 | a:1 | a:1 | translate:1 | deform+radius:1 |
| PL | 12 | 8 | a:6 b:3 R:3 | a:3 b:3 X:3 R:3 | translate:8 stretch:1 | translate:8 one end:2 stretch:2 |
| PR | 2 | 0 | a:1 b:1 | b:1 X:1 | translate:2 | deform:2 translate:1 |
| PO | 4 | 3 | a:2 b:1 R:1 | a:1 b:1 X:1 R:1 | translate:3 | translate:4 |
| PA | 2 | 0 | a:1 b:1 | b:1 X:1 | translate:2 | deform+radius:2 translate:1 |
| PP | 4 | 3 | a:1 b:2 R:1 | a:1 b:1 X:1 R:1 | translate:3 | translate:4 |
| PZ | 2 | 2 | a:1 R:1 | a:1 R:1 | translate:1 | translate:1 |
| ZL | 6 | 4 | b:3 R:3 | b:3 -:1 R:2 | translate:2 stretch:1 | one end:1 translate:1 stretch:1 |
| ZR | 1 | 0 | b:1 | b:1 | translate:1 | deform:1 |
| ZO | 2 | 2 | b:1 R:1 | b:1 R:1 | translate:1 | translate:1 |
| ZA | 1 | 0 | b:1 | b:1 | translate:1 | deform+radius:1 |
| ZP | 2 | 2 | b:1 R:1 | b:1 R:1 | translate:1 | translate:1 |

#### vertical-2pt

Fusion's rule (fitted on the 21 accepted one-mover cells of the free-standing line pair): rank the levels {0} < {2,3} < {4,7} (lowest moves first); the operand with the LOWER rank is the one that moves, a tie means the SECOND pick moves. It predicts 21 of 21 (no contradiction). In words: the operand held least (level 0) is the one that gives way, the most held (4, 7) always stays; two operands at the same rank: the first pick stays and the second is moved.

Grid, line (A) x line (B), `Fusion/ours`:

| A \ B | 0 free | 2 length | 3 H/V | 4 end fixed | 7 full |
|---|---|---|---|---|---|
| 0 free | b/X* | a/X* | a/X* | a/a | a/a |
| 2 length | b/X* | b/X* | b/X* | a/a | a/a |
| 3 H/V | b/X* | b/X* | b/X* | a/a | a/a |
| 4 end fixed | b/b | b/b | b/b | R/R | R/R |
| 7 full | b/b | b/b | b/b | R/R | R/R |

| kinds (A,B) | cells | same | Fusion who-moves | ours who-moves | how Fusion moves it | how ours moves it |
|---|---|---|---|---|---|---|
| LL | 25 | 4 | a:8 b:13 R:4 | a:6 b:6 X:9 R:4 | translate:21 | one end:20 rotate:10 |
| LR | 6 | 0 | a:3 b:3 | b:3 X:2 R:1 | translate:5 stretch:1 | deform:5 one end:1 stretch:1 |
| LO | 12 | 7 | a:3 b:6 R:3 | a:3 b:3 X:3 R:3 | translate:8 stretch:1 | translate:6 one end:4 stretch:2 |
| LA | 6 | 0 | a:3 b:3 | b:3 X:3 | translate:5 stretch:1 | deform+radius:6 one end:2 stretch:1 |
| LP | 12 | 7 | a:3 b:6 R:3 | a:3 b:3 X:3 R:3 | translate:8 stretch:1 | translate:6 one end:4 stretch:2 |
| LZ | 6 | 3 | a:3 R:3 | a:3 -:1 R:2 | translate:2 stretch:1 | one end:2 stretch:1 |
| RL | 6 | 0 | a:3 b:3 | a:3 X:3 | translate:5 stretch:1 | deform:6 one end:2 stretch:1 |
| RR | 1 | 0 | b:1 | X:1 | translate:1 | deform:2 |
| RO | 2 | 0 | a:1 b:1 | a:1 X:1 | translate:2 | deform:2 translate:1 |
| RA | 1 | 0 | b:1 | X:1 | translate:1 | deform:1 deform+radius:1 |
| RP | 2 | 0 | a:1 b:1 | a:1 X:1 | translate:2 | deform:2 translate:1 |
| RZ | 1 | 0 | a:1 | a:1 | translate:1 | deform:1 |
| OL | 12 | 7 | a:6 b:3 R:3 | a:3 b:3 X:3 R:3 | translate:8 stretch:1 | translate:6 one end:4 stretch:2 |
| OR | 2 | 0 | a:1 b:1 | b:1 X:1 | translate:2 | deform:2 translate:1 |
| OO | 4 | 3 | a:1 b:2 R:1 | a:1 b:1 X:1 R:1 | translate:3 | translate:4 |
| OA | 2 | 0 | a:1 b:1 | b:1 X:1 | translate:2 | deform+radius:2 translate:1 |
| OP | 4 | 3 | a:1 b:2 R:1 | a:1 b:1 X:1 R:1 | translate:3 | translate:4 |
| OZ | 2 | 2 | a:1 R:1 | a:1 R:1 | translate:1 | translate:1 |
| AL | 6 | 0 | a:3 b:3 | a:3 X:3 | translate:5 stretch:1 | deform+radius:6 one end:2 stretch:1 |
| AR | 1 | 0 | a:1 | X:1 | translate:1 | deform+radius:1 deform:1 |
| AO | 2 | 0 | a:1 b:1 | a:1 X:1 | translate:2 | deform+radius:2 translate:1 |
| AA | 1 | 0 | b:1 | X:1 | translate:1 | deform+radius:2 |
| AP | 2 | 0 | a:1 b:1 | a:1 X:1 | translate:2 | deform+radius:2 translate:1 |
| AZ | 1 | 0 | a:1 | a:1 | translate:1 | deform+radius:1 |
| PL | 12 | 7 | a:6 b:3 R:3 | a:3 b:3 X:3 R:3 | translate:8 stretch:1 | translate:6 one end:4 stretch:2 |
| PR | 2 | 0 | a:1 b:1 | b:1 X:1 | translate:2 | deform:2 translate:1 |
| PO | 4 | 3 | a:2 b:1 R:1 | a:1 b:1 X:1 R:1 | translate:3 | translate:4 |
| PA | 2 | 0 | a:1 b:1 | b:1 X:1 | translate:2 | deform+radius:2 translate:1 |
| PP | 4 | 3 | a:1 b:2 R:1 | a:1 b:1 X:1 R:1 | translate:3 | translate:4 |
| PZ | 2 | 2 | a:1 R:1 | a:1 R:1 | translate:1 | translate:1 |
| ZL | 6 | 3 | b:3 R:3 | b:3 -:1 R:2 | translate:2 stretch:1 | one end:2 stretch:1 |
| ZR | 1 | 0 | b:1 | b:1 | translate:1 | deform:1 |
| ZO | 2 | 2 | b:1 R:1 | b:1 R:1 | translate:1 | translate:1 |
| ZA | 1 | 0 | b:1 | b:1 | translate:1 | deform+radius:1 |
| ZP | 2 | 2 | b:1 R:1 | b:1 R:1 | translate:1 | translate:1 |

#### pointOnLine

Fusion's rule (fitted on the 21 accepted one-mover cells of the free-standing line pair): rank the levels {0,4,m} < {3,o} < {7} (lowest moves first); the operand with the LOWER rank is the one that moves, a tie means the SECOND pick moves. It predicts 20 of 21; contradicting cells: pointOnLine|LL|4,3. In words: the operand held least (levels 0, 4, m) is the one that gives way, the most held (7) always stays; two operands at the same rank: the first pick stays and the second is moved.

Grid, line (A) x line (B), `Fusion/ours`:

| A \ B | 0 free | 3 H/V | 4 end fixed | 7 full | o end at origin | m mid at origin |
|---|---|---|---|---|---|---|
| 0 free | b/a* | a/a | b/a* | a/a |  |  |
| 3 H/V | b/X* | b/X* | b/X* | a/a |  |  |
| 4 end fixed | b/b | b/b | b/b | R/R |  |  |
| 7 full | b/b | b/b | b/b | R/R |  |  |
| o end at origin | b/b | b/b | b/b | R/R |  |  |
| m mid at origin | b/X* | a/X* | b/X* | a/a |  |  |

| kinds (A,B) | cells | same | Fusion who-moves | ours who-moves | how Fusion moves it | how ours moves it |
|---|---|---|---|---|---|---|
| LL | 24 | 7 | a:5 b:16 R:3 | a:6 b:9 X:6 R:3 | translate:13 one end:6 stretch:2 | stretch:18 one end:9 |
| LC | 12 | 3 | b:12 | a:2 b:6 X:4 | translate:6 one end:6 | stretch:9 one end:7 |
| LS | 6 | 0 | a:3 b:3 | a:1 b:3 X:2 | translate:5 stretch:1 | scale:4 stretch:2 one end:1 deform:1 |
| LR | 12 | 4 | a:6 b:3 R:3 | a:4 b:3 X:2 R:3 | translate:7 stretch:2 | deform:5 stretch:4 one end:2 |
| RL | 4 | 0 | a:1 b:3 | a:1 X:3 | translate:3 one end:1 | deform:4 stretch:2 one end:1 |
| RC | 2 | 0 | b:2 | X:2 | translate:1 one end:1 | deform:2 stretch:1 one end:1 |
| RS | 1 | 0 | a:1 | X:1 | translate:1 | deform:1 scale:1 |
| RR | 2 | 0 | a:1 b:1 | a:1 X:1 | translate:2 | deform:3 |
| OL | 8 | 5 | a:3 b:4 R:1 | a:4 b:3 R:1 | translate:5 one end:2 | translate:4 stretch:2 one end:1 |
| OC | 4 | 2 | a:1 b:3 | a:2 b:2 | translate:2 one end:2 | translate:2 stretch:1 one end:1 |
| OS | 2 | 1 | a:1 b:1 | a:1 b:1 | translate:2 | translate:1 scale:1 |
| OR | 4 | 3 | a:2 b:1 R:1 | a:2 b:1 R:1 | translate:3 | translate:2 deform:1 |
| AL | 4 | 0 | a:1 b:3 | a:1 X:3 | translate:3 one end:1 | deform+radius:4 rotate:1 translate:1 one end:1 |
| AC | 2 | 0 | b:2 | X:2 | translate:1 one end:1 | deform+radius:2 rotate:1 one end:1 |
| AS | 1 | 0 | a:1 | X:1 | translate:1 | deform+radius:1 scale:1 |
| AR | 2 | 0 | a:2 | a:1 X:1 | translate:2 | deform+radius:2 deform:1 |
| PL | 8 | 6 | a:4 b:3 R:1 | a:4 b:3 R:1 | translate:6 one end:1 | translate:4 stretch:2 one end:1 |
| PC | 4 | 3 | a:2 b:2 | a:2 b:2 | translate:3 one end:1 | translate:2 stretch:1 one end:1 |
| PS | 2 | 1 | a:1 b:1 | a:1 b:1 | translate:2 | translate:1 scale:1 |
| PR | 4 | 3 | a:2 b:1 R:1 | a:2 b:1 R:1 | translate:3 | translate:2 deform:1 |
| ZL | 4 | 2 | b:3 R:1 | b:3 R:1 | translate:2 one end:1 | stretch:2 one end:1 |
| ZC | 2 | 1 | b:2 | b:2 | translate:1 one end:1 | stretch:1 one end:1 |
| ZS | 1 | 0 | b:1 | b:1 | translate:1 | deform:1 |
| ZR | 2 | 1 | b:1 R:1 | b:1 R:1 | translate:1 | deform:1 |

#### pointOnCircle

| kinds (A,B) | cells | same | Fusion who-moves | ours who-moves | how Fusion moves it | how ours moves it |
|---|---|---|---|---|---|---|
| LO | 24 | 10 | a:6 b:15 R:3 | a:6 b:9 X:6 R:3 | translate:16 radius:3 stretch:2 | stretch:8 translate+radius:5 radius:5 translate:5 |
| LA | 24 | 7 | a:12 b:9 R:3 | a:6 b:9 X:6 R:3 | translate:14 stretch:4 scale+radius:3 | stretch:8 deform+radius:5 scale+radius:5 deform:5 |
| LF | 12 | 5 | a:6 b:3 R:3 | a:2 b:3 X:4 R:3 | translate:5 deform:2 stretch:2 | deform:7 stretch:4 one end:2 |
| RO | 4 | 0 | a:2 b:2 | a:1 X:3 | translate:4 | deform:4 translate+radius:1 radius:1 translate:1 |
| RA | 4 | 0 | a:2 b:2 | a:1 X:3 | translate:4 | deform:5 deform+radius:1 scale+radius:1 |
| RF | 2 | 0 | a:1 b:1 | X:2 | deform:1 translate:1 | deform:4 |
| OO | 8 | 5 | a:2 b:5 R:1 | a:4 b:3 R:1 | translate:6 radius:1 | translate:5 translate+radius:1 radius:1 |
| OA | 8 | 6 | a:4 b:3 R:1 | a:4 b:3 R:1 | translate:6 scale+radius:1 | translate:4 deform+radius:1 scale+radius:1 deform:1 |
| OF | 4 | 4 | a:2 b:1 R:1 | a:2 b:1 R:1 | translate:2 deform:1 | translate:2 deform:1 |
| AO | 4 | 0 | a:2 b:2 | a:4 | translate:4 | one point (deform)+radius:4 |
| AA | 4 | 0 | a:3 b:1 | a:4 | translate:4 | one point (deform)+radius:4 |
| AF | 2 | 0 | a:2 | a:2 | translate:2 | one point (deform)+radius:2 |
| PO | 8 | 7 | a:4 b:3 R:1 | a:4 b:3 R:1 | translate:6 radius:1 | translate:5 translate+radius:1 radius:1 |
| PA | 8 | 6 | a:4 b:3 R:1 | a:4 b:3 R:1 | translate:6 scale+radius:1 | translate:4 deform+radius:1 scale+radius:1 deform:1 |
| PF | 4 | 0 | R:4 | -:4 |  |  |
| ZO | 4 | 3 | b:3 R:1 | b:3 R:1 | translate:2 radius:1 | translate+radius:1 radius:1 translate:1 |
| ZA | 4 | 2 | b:3 R:1 | b:3 R:1 | translate:2 scale+radius:1 | deform+radius:1 scale+radius:1 deform:1 |
| ZF | 2 | 1 | b:1 R:1 | b:1 R:1 | translate:1 | deform:1 |

#### midpoint

Fusion's rule (fitted on the 21 accepted one-mover cells of the free-standing line pair): rank the levels {0,4,m} < {3,o} < {7} (lowest moves first); the operand with the LOWER rank is the one that moves, a tie means the SECOND pick moves. It predicts 20 of 21; contradicting cells: midpoint|LL|4,3. In words: the operand held least (levels 0, 4, m) is the one that gives way, the most held (7) always stays; two operands at the same rank: the first pick stays and the second is moved.

Grid, line (A) x line (B), `Fusion/ours`:

| A \ B | 0 free | 3 H/V | 4 end fixed | 7 full | o end at origin | m mid at origin |
|---|---|---|---|---|---|---|
| 0 free | b/X* | a/X* | b/X* | a/a |  |  |
| 3 H/V | b/X* | b/X* | b/X* | a/a |  |  |
| 4 end fixed | b/b | b/b | b/b | R/R |  |  |
| 7 full | b/b | b/b | b/b | R/R |  |  |
| o end at origin | b/b | b/b | b/b | R/R |  |  |
| m mid at origin | b/X* | a/X* | b/X* | a/a |  |  |

| kinds (A,B) | cells | same | Fusion who-moves | ours who-moves | how Fusion moves it | how ours moves it |
|---|---|---|---|---|---|---|
| LL | 24 | 13 | a:5 b:16 R:3 | a:3 b:9 X:9 R:3 | translate:13 one end:6 stretch:2 | translate:12 one end:10 stretch:8 |
| LC | 12 | 6 | b:12 | b:6 X:6 | translate:6 one end:6 | one end:8 translate:6 stretch:4 |
| LS | 6 | 0 | a:3 b:3 | b:2 X:2 R:2 | translate:5 stretch:1 | scale:4 one end:1 stretch:1 |
| LR | 12 | 4 | a:6 b:3 R:3 | a:3 b:3 X:3 R:3 | translate:7 stretch:2 | deform:6 stretch:4 one end:2 |
| RL | 4 | 0 | a:1 b:3 | a:1 X:3 | translate:3 one end:1 | deform:4 translate:2 one end:1 |
| RC | 2 | 0 | b:2 | X:2 | translate:1 one end:1 | deform:2 translate:1 one end:1 |
| RS | 1 | 0 | a:1 | X:1 | translate:1 | deform:1 scale:1 |
| RR | 2 | 0 | a:1 b:1 | a:1 X:1 | translate:2 | deform:3 |
| OL | 8 | 5 | a:3 b:4 R:1 | a:1 b:3 X:3 R:1 | translate:5 one end:2 | translate:8 one end:2 |
| OC | 4 | 2 | a:1 b:3 | b:2 X:2 | translate:2 one end:2 | translate:4 one end:2 |
| OS | 2 | 0 | a:1 b:1 | b:1 X:1 | translate:2 | scale:2 translate:1 |
| OR | 4 | 2 | a:2 b:1 R:1 | a:1 b:1 X:1 R:1 | translate:3 | translate:2 deform:2 |
| AL | 4 | 0 | a:1 b:3 | a:1 X:3 | translate:3 one end:1 | deform+radius:4 translate:2 one end:1 |
| AC | 2 | 0 | b:2 | X:2 | translate:1 one end:1 | deform+radius:2 translate:1 one end:1 |
| AS | 1 | 0 | a:1 | X:1 | translate:1 | deform+radius:1 scale:1 |
| AR | 2 | 0 | a:2 | a:1 X:1 | translate:2 | deform+radius:2 deform:1 |
| PL | 8 | 5 | a:4 b:3 R:1 | a:1 b:3 X:3 R:1 | translate:6 one end:1 | translate:8 one end:2 |
| PC | 4 | 2 | a:2 b:2 | b:2 X:2 | translate:3 one end:1 | translate:4 one end:2 |
| PS | 2 | 0 | a:1 b:1 | b:1 X:1 | translate:2 | scale:2 translate:1 |
| PR | 4 | 2 | a:2 b:1 R:1 | a:1 b:1 X:1 R:1 | translate:3 | translate:2 deform:2 |
| ZL | 4 | 4 | b:3 R:1 | b:3 R:1 | translate:2 one end:1 | translate:2 one end:1 |
| ZC | 2 | 2 | b:2 | b:2 | translate:1 one end:1 | translate:1 one end:1 |
| ZS | 1 | 0 | b:1 | R:1 | translate:1 |  |
| ZR | 2 | 1 | b:1 R:1 | b:1 R:1 | translate:1 | deform:1 |

#### equal-circle

| kinds (A,B) | cells | same | Fusion who-moves | ours who-moves | how Fusion moves it | how ours moves it |
|---|---|---|---|---|---|---|
| OO | 16 | 12 | -:12 R:4 | -:16 |  |  |
| OA | 16 | 4 | R:16 | a:2 b:4 X:6 R:4 |  | radius:8 deform+radius:4 scale+radius:4 deform:2 |
| OF | 8 | 4 | R:8 | X:4 R:4 |  | radius:4 deform:4 |
| AO | 16 | 4 | R:16 | a:4 b:2 X:6 R:4 |  | radius:8 deform+radius:4 scale+radius:4 deform:2 |
| AA | 16 | 12 | -:12 R:4 | -:16 |  |  |
| AF | 8 | 4 | a:4 R:4 | X:4 R:4 | scale+radius:4 | deform:4 deform+radius:2 scale+radius:2 |
| FO | 8 | 4 | R:8 | X:4 R:4 |  | deform:4 radius:4 |
| FA | 8 | 4 | b:4 R:4 | X:4 R:4 | scale+radius:4 | deform:4 deform+radius:2 scale+radius:2 |
| FF | 4 | 0 | R:4 | -:4 |  |  |

#### tangent-line-circle

| kinds (A,B) | cells | same | Fusion who-moves | ours who-moves | how Fusion moves it | how ours moves it |
|---|---|---|---|---|---|---|
| LO | 16 | 5 | a:8 b:7 R:1 | a:3 b:3 X:9 R:1 | translate:10 stretch:2 one end:2 radius:1 | translate:8 stretch:4 translate+radius:4 radius:4 |
| LA | 16 | 7 | a:10 b:5 R:1 | a:6 b:2 X:6 R:2 | translate:8 stretch:4 one end:2 scale+radius:1 | stretch:4 deform+radius:4 deform:4 translate:4 |
| LF | 8 | 4 | a:5 b:2 R:1 | a:3 b:1 X:3 R:1 | stretch:2 translate:2 deform:2 one end:1 | stretch:4 deform:4 one end:2 |
| CO | 8 | 1 | a:5 b:3 | a:2 X:6 | translate:4 stretch:2 one end:2 | stretch:4 one end:4 translate+radius:2 radius:2 |
| CA | 8 | 4 | a:6 b:2 | a:4 X:4 | stretch:4 translate:2 one end:2 | stretch:4 one end:4 deform+radius:2 deform:2 |
| CF | 4 | 2 | a:3 b:1 | a:2 X:2 | stretch:2 deform:1 one end:1 | stretch:2 deform:2 one end:2 |
| SO | 4 | 1 | a:3 b:1 | a:1 X:3 | scale:3 translate:1 | scale:4 translate+radius:1 radius:1 translate:1 |
| SA | 4 | 2 | a:4 | a:2 X:2 | scale:4 | scale:4 deform+radius:1 deform:1 |
| SF | 2 | 1 | a:2 | a:1 X:1 | scale:2 | scale:2 deform:1 |
| RO | 8 | 4 | a:3 b:4 R:1 | a:1 b:3 X:3 R:1 | deform:3 translate:3 radius:1 | deform:4 translate+radius:2 radius:2 translate:2 |
| RA | 8 | 3 | a:4 b:3 R:1 | a:2 b:2 X:2 R:2 | deform:4 translate:2 scale+radius:1 | deform:6 deform+radius:2 |
| RF | 4 | 3 | a:2 b:1 R:1 | a:1 b:1 X:1 R:1 | deform:3 | deform:4 |
| OL | 16 | 5 | a:7 b:8 R:1 | a:3 b:3 X:9 R:1 | translate:10 stretch:2 one end:2 radius:1 | translate:8 translate+radius:4 stretch:4 one end:4 |
| OC | 8 | 1 | a:3 b:5 | b:2 X:6 | translate:4 stretch:2 one end:2 | stretch:4 one end:4 translate+radius:2 radius:2 |
| OS | 4 | 1 | a:1 b:3 | b:1 X:3 | scale:3 translate:1 | scale:4 translate+radius:1 radius:1 translate:1 |
| OR | 8 | 4 | a:4 b:3 R:1 | a:3 b:1 X:3 R:1 | deform:3 translate:3 radius:1 | deform:4 translate+radius:2 radius:2 translate:2 |
| AL | 16 | 7 | a:5 b:10 R:1 | a:2 b:6 X:6 R:2 | translate:8 stretch:4 one end:2 scale+radius:1 | deform+radius:4 stretch:4 translate:4 one end:4 |
| AC | 8 | 4 | a:2 b:6 | b:4 X:4 | stretch:4 translate:2 one end:2 | stretch:4 one end:4 deform+radius:2 deform:2 |
| AS | 4 | 2 | b:4 | b:2 X:2 | scale:4 | scale:4 deform+radius:1 deform:1 |
| AR | 8 | 3 | a:3 b:4 R:1 | a:2 b:2 X:2 R:2 | deform:4 translate:2 scale+radius:1 | deform:6 deform+radius:2 |
| FL | 8 | 4 | a:2 b:5 R:1 | a:1 b:3 X:3 R:1 | stretch:2 translate:2 deform:2 one end:1 | deform:4 stretch:4 one end:2 |
| FC | 4 | 2 | a:1 b:3 | b:2 X:2 | stretch:2 deform:1 one end:1 | deform:2 stretch:2 one end:2 |
| FS | 2 | 1 | b:2 | b:1 X:1 | scale:2 | scale:2 deform:1 |
| FR | 4 | 3 | a:1 b:2 R:1 | a:1 b:1 X:1 R:1 | deform:3 | deform:4 |

#### tangent-circle-circle

| kinds (A,B) | cells | same | Fusion who-moves | ours who-moves | how Fusion moves it | how ours moves it |
|---|---|---|---|---|---|---|
| OO | 16 | 7 | a:5 b:10 R:1 | a:3 b:3 X:9 R:1 | translate:7 translate+radius:4 radius:4 | translate+radius:8 radius:8 translate:8 |
| OA | 16 | 9 | a:12 b:3 R:1 | a:6 b:2 X:6 R:2 | translate+radius:4 radius:4 translate:4 deform+radius:1 | translate+radius:4 deform+radius:4 deform:4 radius:4 |
| OF | 8 | 5 | a:4 b:3 R:1 | a:3 b:1 X:3 R:1 | deform:3 translate:2 translate+radius:1 radius:1 | deform:4 translate+radius:2 radius:2 translate:2 |
| AO | 16 | 9 | a:3 b:12 R:1 | a:2 b:6 X:6 R:2 | translate+radius:4 radius:4 translate:4 deform+radius:1 | deform+radius:4 translate+radius:4 radius:4 translate:4 |
| AA | 16 | 8 | a:5 b:10 R:1 | a:4 b:4 X:4 R:4 | deform:7 deform+radius:4 scale+radius:4 | deform+radius:8 deform:8 |
| AF | 8 | 5 | a:3 b:4 R:1 | a:2 b:2 X:2 R:2 | deform:5 deform+radius:1 scale+radius:1 | deform:6 deform+radius:2 |
| FO | 8 | 5 | a:3 b:4 R:1 | a:1 b:3 X:3 R:1 | deform:3 translate:2 translate+radius:1 radius:1 | deform:4 translate+radius:2 radius:2 translate:2 |
| FA | 8 | 5 | a:4 b:3 R:1 | a:2 b:2 X:2 R:2 | deform:5 deform+radius:1 scale+radius:1 | deform:6 deform+radius:2 |
| FF | 4 | 3 | a:1 b:2 R:1 | a:1 b:1 X:1 R:1 | deform:3 | deform:4 |

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
| scurve (round 2) | 11 | 54 | 41 | 13 |
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
| 4 interior angle at A = 70 (the dimension reads the angle between the di | accepted | accepted | **NO** | another valid branch | ..... / F.F.. * ; sketch: nullity 6 / not fully constrained |
| 5 M = midpoint of the base | accepted | accepted | **NO** | another valid branch | ..... / F.F.. * ; sketch: nullity 4 / not fully constrained |
| 6 circle centre on the axis C-M | accepted | accepted | **NO** | another valid branch | ..... / F.F.. * ; sketch: nullity 3 / not fully constrained |
| 7 circle tangent to AB | accepted | accepted | **NO** | another valid branch | ..... / F.F.. * ; sketch: nullity 2 / not fully constrained |
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
| 1 centre O at the origin | accepted | accepted | yes | another valid branch | ............... / ............... ; sketch: nullity 12 / not fully constrained |
| 2 circumradius O-k0 = 40 | accepted | accepted | yes | another valid branch | ............... / ............... ; sketch: nullity 11 / not fully constrained |
| 3 M0 = midpoint of edge e0 (k0,k1) | accepted | accepted | yes | another valid branch | ............... / ............... ; sketch: nullity 9 / not fully constrained |
| 4 M3 = midpoint of the opposite edge e3 (k3,k4) | accepted | accepted | yes | another valid branch | ............... / ............... ; sketch: nullity 7 / not fully constrained |
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
| 7 arc a1 tangent to arc a2 | accepted | accepted | yes | another valid branch | FF.. / FF.. ; sketch: nullity 4 / not fully constrained |
| 8 arc a2 radius 25 | reference | accepted | **NO** | another valid branch | FF.. / FFF. * ; sketch: nullity 4 / not fully constrained |
| 9 l2 horizontal | accepted | accepted | **NO** | another valid branch | FF.. / FFF. * ; sketch: nullity 3 / not fully constrained |
| 10 l2 tangent to arc a2 | accepted | accepted | **NO** | another valid branch | FF.. / FFFF * ; sketch: nullity 2 / not fully constrained |
| 11 l2 length 40 | accepted | accepted | **NO** | another valid branch | FF.. / FFFF * ; sketch: nullity 1 / fully constrained * |

Step E, 6 dimension edits (0.8x, 1.25x): 3 agree (accepted or refused alike); differ: edit x0.8 of dimension 40.000 -> 32.000 (ours refused, Fusion accepted); edit x1.25 of dimension 30.000 -> 37.500 (ours refused, Fusion accepted); edit x0.8 of dimension 40.000 -> 32.000 (ours refused, Fusion accepted).

Step F: redundant dimension: ours accepted, Fusion refused (3 : VCS_SKETCH_OVER_CONSTRAINTS - Sketch geometry is over co) *; conflict dimension: ours accepted, Fusion refused (3 : VCS_SKETCH_OVER_CONSTRAINTS - Sketch geometry is over co) *; delete one dimension: ours accepted, Fusion accepted; delete one dimension: fully constrained afterwards?: ours nullity 2, Fusion not fully constrained.

Divergences and verdicts:

* OUR BUG N-F7 (tangent between two arcs sharing a rim joint is degenerate): step 1 full, step 4 full, step 7 outcome, step 7 full, step 8 full, step 9 full, step 10 full, step 10 sketchFull, edit0 outcome, edit3 outcome, edit4 outcome, redundant outcome (+1 more)

#### slot: Slot: two arcs + two lines (4 tangents) (round 2)

* fillets are an arc + tangent constraints + a radius dimension + a virtual sharp point (a plain sketch point on both lines), as the fillet tool builds them
* units: ours mm, Fusion API cm (x 0.1 on the way in); angle dimensions are given in degrees

| step | ours | Fusion | same? | coordinates | fully constrained (per shape, F = yes) ours / Fusion |
|---|---|---|---|---|---|
| 1 left centre at the origin | accepted | accepted | yes | another valid branch | .... / .... ; sketch: nullity 8 / not fully constrained |
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
| 1 S1 rect corner c1 at the origin | accepted | accepted | **NO** | another valid branch | ....... / F..F... * ; sketch: nullity 8 / not fully constrained |
| 2 S1 rect width 60 | accepted | accepted | **NO** | another valid branch | F...... / FF.F... * ; sketch: nullity 7 / not fully constrained |
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
