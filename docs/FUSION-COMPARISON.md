# Fusion 360 as an oracle for the SketchStudio solver (TASK 518)

Audit only: nothing in `packages/` changed. Fusion answers were recorded from a live Fusion 360 (`app.version` 2706.1.17, 2026-11-11, a scratch
document made for the run and closed without saving) through `scripts/fusion-oracle/run-which-moves.py` and stored as data in
`tests/fixtures/fusion-oracle/`. `tests/fusion-oracle.test.js` (pure node, in the gate) replays every recipe through OUR pipeline and compares.
Units: our mm; Fusion's API is cm (x10 on the way out). Divergences are reported, not changed: the owner decides each one.

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

Fusion 2706.1.17, recorded 2026-11-11; 315 cells, 94 identical, 221 differ (all KNOWN in tests/fixtures/fusion-oracle/which-moves-known.json). Data: tests/fixtures/fusion-oracle/which-moves.json (before / after coordinates in mm of every entity, per cell).

| constraint / dimension | cells | same as Fusion |
|---|---|---|
| horizontal-line | 6 | 6 |
| vertical-line | 6 | 6 |
| horizontal-2pt | 6 | 4 |
| vertical-2pt | 6 | 4 |
| coincident-pp | 18 | 0 |
| parallel | 20 | 4 |
| perpendicular | 20 | 4 |
| collinear | 20 | 14 |
| equal-line-line | 20 | 0 |
| pointOnLine | 6 | 5 |
| pointOnCircle | 5 | 4 |
| midpoint | 6 | 2 |
| equal-circle-circle | 14 | 0 |
| equal-arc-arc | 14 | 4 |
| equal-arc-circle | 2 | 2 |
| tangent-line-circle | 16 | 6 |
| tangent-line-arc | 16 | 4 |
| tangent-circle-circle | 14 | 0 |
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

#### collinear  (14 of 20 cells the same)

Fusion's rule: The FIRST-picked line stays, the second lands on it; a fixed, H/V-constrained or dimensioned line stays whichever order.

Verdict: PENDING TASK 511 (placement at creation); recheck after it merges.

| variant | AB Fusion | AB ours | AB same | BA Fusion | BA ours | BA same |
|---|---|---|---|---|---|---|
| free | A:.. B:MM | A:.. B:MM | yes | A:MM B:.. | A:MM B:.. | yes |
| A_fix1 | A:.. B:MM | A:.. B:MM | yes | A:.. B:MM | refused | pending 511 |
| A_fixfull | A:.. B:MM | A:.. B:MM | yes | A:.. B:MM | refused | pending 511 |
| A_hv | A:.. B:MM | A:.. B:MM | yes | A:.. B:MM | A:.. B:MM | yes |
| A_dim | A:.. B:MM | A:.. B:MM | yes | A:.. B:MM | A:MM B:.. | pending 511 |
| B_fix1 | A:MM B:.. | refused | pending 511 | A:MM B:.. | A:MM B:.. | yes |
| B_fixfull | A:MM B:.. | refused | pending 511 | A:MM B:.. | A:MM B:.. | yes |
| B_hv | A:MM B:.. | A:MM B:.. | yes | A:MM B:.. | A:MM B:.. | yes |
| B_dim | A:MM B:.. | A:.. B:MM | pending 511 | A:MM B:.. | A:MM B:.. | yes |
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

#### pointOnLine  (5 of 6 cells the same)

Fusion's rule: The point moves onto the line and the line stays; only when the point is fixed does the line move (translated). (Fusion's API wants the point first.)

Verdict: PENDING TASK 511 (the pointOnLine rows); the rest agrees.

| variant | AB Fusion | AB ours | AB same |
|---|---|---|---|
| free | A:M B:.. | A:M B:.. | yes |
| A_fix1 | A:. B:MM | refused | pending 511 |
| B_fix1 | A:M B:.. | A:M B:.. | yes |
| B_fixfull | A:M B:.. | A:M B:.. | yes |
| B_hv | A:M B:.. | A:M B:.. | yes |
| B_dim | A:M B:.. | A:M B:.. | yes |

#### pointOnCircle  (4 of 5 cells the same)

Fusion's rule: The point moves radially onto the rim; the circle stays; a fixed point moves the circle instead.

Verdict: PENDING TASK 511 (it also changed the on-circle placement).

| variant | AB Fusion | AB ours | AB same |
|---|---|---|---|
| free | A:M B:.. | A:M B:.. | yes |
| A_fix1 | A:. B:M. | refused | pending 511 |
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

#### equal-circle-circle  (0 of 14 cells the same)

Fusion's rule: The SECOND-picked circle is resized (its centre stays); a circle with a driving radius or fully fixed stays; a circle with a fixed centre is the one that resizes, even when picked first.

Verdict: OUR BUG (F2): refused.

Proposed fix: OUR BUG F2 (docs/CONSTRAINT-AUDIT.md): the radius is shape data, not a solver unknown; nothing to place until the radius is a DOF (task 510 / the O2 decision). Not a createConstraint fix.

| variant | AB Fusion | AB ours | AB same | BA Fusion | BA ours | BA same |
|---|---|---|---|---|---|---|
| free | A:.. B:.r | refused | **NO** | A:.r B:.. | refused | **NO** |
| A_fix1 | A:.r B:.. | refused | **NO** | A:.r B:.. | refused | **NO** |
| A_fixfull | A:.. B:.r | refused | **NO** | A:.. B:.r | refused | **NO** |
| A_dim | A:.. B:.r | refused | **NO** | A:.. B:.r | refused | **NO** |
| B_fix1 | A:.. B:.r | refused | **NO** | A:.. B:.r | refused | **NO** |
| B_fixfull | A:.r B:.. | refused | **NO** | A:.r B:.. | refused | **NO** |
| B_dim | A:.r B:.. | refused | **NO** | A:.r B:.. | refused | **NO** |

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

#### equal-arc-circle  (2 of 2 cells the same)

Fusion's rule: Fusion's API REFUSES equal(arc, circle) with "invalid argument value" (the interactive tool may differ; not measurable through the API).

Verdict: SAME (both refuse) - ours refuses for the F2 reason, Fusion for an API reason: do not read it as agreement.

| variant | AB Fusion | AB ours | AB same | BA Fusion | BA ours | BA same |
|---|---|---|---|---|---|---|
| free | refused | refused | yes | refused | refused | yes |

#### tangent-line-circle  (6 of 16 cells the same)

Fusion's rule: The LINE moves (rotates and translates; pick order is irrelevant) and the circle stays; a pinned or fixed line stays and the circle's centre moves; a circle with a dimensioned radius moves its centre while the line stays.

Verdict: FUSION DIFFERENT BY DESIGN (ours moves both).

Proposed fix: placeForCreation: move the line (never the circle) onto tangency, nearest side, unless the line is pinned (then move the circle centre) or the circle's radius is dimensioned. Ours moves both the line and the circle centre.

| variant | AB Fusion | AB ours | AB same | BA Fusion | BA ours | BA same |
|---|---|---|---|---|---|---|
| free | A:MM B:.. | A:MM B:M. | **NO** | A:MM B:.. | A:MM B:M. | **NO** |
| A_fix1 | A:.. B:M. | A:.M B:M. | **NO** | A:.. B:M. | A:.M B:M. | **NO** |
| A_fixfull | A:.. B:M. | A:.. B:M. | yes | A:.. B:M. | A:.. B:M. | yes |
| A_hv | A:MM B:.. | A:MM B:M. | **NO** | A:MM B:.. | A:MM B:M. | **NO** |
| A_dim | A:MM B:.. | A:MM B:M. | **NO** | A:MM B:.. | A:MM B:M. | **NO** |
| B_fix1 | A:MM B:.. | A:MM B:.. | yes | A:MM B:.. | A:MM B:.. | yes |
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

#### tangent-circle-circle  (0 of 14 cells the same)

Fusion's rule: The SECOND-picked circle moves AND is re-sized (centre and radius); the first stays; a circle with a dimensioned radius or fixed centre keeps its radius, so the other circle's centre absorbs the change.

Verdict: FUSION DIFFERENT BY DESIGN, tied to the open O2 question (circle radius as a DOF).

Proposed fix: Not a createConstraint fix: our circle radius is shape data (O2 / F2). Ours moves both centres and never touches a radius.

| variant | AB Fusion | AB ours | AB same | BA Fusion | BA ours | BA same |
|---|---|---|---|---|---|---|
| free | A:.. B:Mr | A:M. B:M. | **NO** | A:Mr B:.. | A:M. B:M. | **NO** |
| A_fix1 | A:.. B:Mr | A:.. B:M. | **NO** | A:.r B:.. | A:.. B:M. | **NO** |
| A_fixfull | A:.. B:Mr | A:.. B:M. | **NO** | A:.. B:Mr | A:.. B:M. | **NO** |
| A_dim | A:M. B:.. | A:M. B:M. | **NO** | A:M. B:.. | A:M. B:M. | **NO** |
| B_fix1 | A:.. B:.r | A:M. B:.. | **NO** | A:Mr B:.. | A:M. B:.. | **NO** |
| B_fixfull | A:Mr B:.. | A:M. B:.. | **NO** | A:Mr B:.. | A:M. B:.. | **NO** |
| B_dim | A:.. B:M. | A:M. B:M. | **NO** | A:.. B:M. | A:M. B:M. | **NO** |

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
