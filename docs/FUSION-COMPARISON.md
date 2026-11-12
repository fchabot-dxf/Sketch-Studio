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

## Which geometry moves: graded

<!-- graded:begin -->

Fusion 2706.1.17, recorded 2026-11-11. 2438 cells; data `tests/fixtures/fusion-oracle/which-moves-graded.json` (positions before / after in mm, per cell), known differences `which-moves-graded-known.json` (per class: constraint x kind pair; "all" when the whole class differs). The cells are built by `tests/harness/fusion-oracle/graded.js` with the matrix builders (rect tool, polygon tool, fillet tool, arc, circle), the level applied with real constraints, then replayed in Fusion by `scripts/fusion-oracle/run-jobs.py`.

**How to read it.** A = the FIRST pick, B = the SECOND pick (so pick order is the row / column order). Levels of a free-standing line: `0` free, `1` one end coincident with another free line (a chain), `2` length dimension, `3` H or V, `4` one end fixed, `5` end fixed + length, `6` H/V + end fixed, `7` fully constrained by constraints and dimensions only (H/V + length + the two position dimensions from the origin), `o` one end coincident with the origin, `m` midpoint at the origin. Rect side: `0`, `8` the whole rectangle fully constrained by dimensions. Polygon side: `0`. Construction line: `0`, `4`. Circle / arc: `0`, `c` centre fixed, `r` radius dimension, `cr` both; fillet arc: `0`, `c`. Point: `0`, `4` fixed. Origin (`Z`): the origin point. Cell symbol: `a` only the first pick moves, `b` only the second, `X` both, `-` neither, `R` refused. `Fusion/ours`; a trailing `*` = they differ.

**Reductions (the full cross product is about 40 000 cells).** Line-line groups: free-standing line x free-standing line at the 8 levels (10 with `o`, `m` in the point groups), every other line-like kind (construction line `C`, polygon side `S`, rect side `R`) only against a plain line and against itself, at 2 levels (S: 1). A plain line against a non-line operand: levels 0, 3, 4, 7. Point groups: points of a line (end), rect corner, circle / arc centre, free point and the origin; the compound kinds only free. Not covered: bezier (not constrainable in ours: its endpoints are plain joints, covered as points; Fusion cannot express our cubic), polygon side and fillet arc beyond level 0 / `c`, B-kinds crossed with each other beyond the listed pairs, the point-to-line distance dimension (ours projects a helper joint: finding NEW-1), diameter dimension (no creation path), concentric (not in `CONSTRAINT_TYPES`; a coincident of two centres is the same cell). Fusion exposes no DOF count, only `isFullyConstrained` per entity and per sketch: the DOF before / after is therefore **not** recorded for Fusion (ours: nullity, see the 512 matrix).

| constraint / dimension | cells | same as Fusion | Fusion refuses, ours accepts | ours refuses, Fusion accepts |
|---|---|---|---|---|
| parallel | 113 | 11 | 21 | 0 |
| perpendicular | 113 | 31 | 0 | 14 |
| collinear | 113 | 39 | 0 | 27 |
| equal-line-line | 113 | 35 | 0 | 0 |
| dim-angle | 113 | 19 | 21 | 0 |
| coincident-pp | 232 | 100 | 4 | 0 |
| dim-aligned | 232 | 60 | 48 | 0 |
| dim-horizontal | 157 | 45 | 28 | 0 |
| dim-vertical | 157 | 53 | 30 | 0 |
| horizontal-2pt | 157 | 68 | 2 | 0 |
| vertical-2pt | 157 | 58 | 2 | 0 |
| pointOnLine | 117 | 36 | 0 | 42 |
| pointOnCircle | 130 | 41 | 4 | 41 |
| midpoint | 117 | 48 | 0 | 0 |
| equal-circle | 100 | 80 | 12 | 0 |
| tangent-line-circle | 180 | 88 | 0 | 8 |
| tangent-circle-circle | 100 | 44 | 0 | 16 |
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
| 3 H/V | b/X* | b/X* | b/X* | R/-* | b/X* | b/X* | R/-* | R/-* |
| 4 end fixed | a/X* | a/X* | a/X* | a/X* | b/X* | a/X* | a/X* | a/a |
| 5 end+length | b/X* | b/X* | a/X* | a/X* | b/X* | b/X* | a/X* | a/a |
| 6 H/V+end | b/X* | b/X* | b/X* | R/-* | b/X* | b/X* | R/-* | R/-* |
| 7 full | b/b | b/b | b/b | R/-* | b/b | b/b | R/-* | R/-* |

| kinds (A,B) | cells | same | Fusion who-moves | ours who-moves | how Fusion moves it | how ours moves it |
|---|---|---|---|---|---|---|
| LL | 64 | 6 | a:22 b:33 R:9 | a:5 b:5 X:45 -:9 | one end:35 rotate:20 | stretch:42 one end:42 rotate:16 |
| LC | 8 | 1 | a:1 b:7 | b:2 X:6 | one end:5 rotate:3 | stretch:8 one end:6 |
| CL | 8 | 1 | a:5 b:3 | a:2 X:6 | one end:5 rotate:3 | stretch:8 one end:6 |
| LS | 4 | 0 | a:2 b:2 | b:1 X:3 | rotate:3 one end:1 | scale:4 stretch:2 one end:1 |
| SL | 4 | 0 | a:2 b:2 | a:1 X:3 | rotate:3 one end:1 | scale:4 stretch:2 one end:1 |
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
| SS | 1 | 0 | b:1 | R:1 | rotate:1 |  |
| RR | 4 | 4 | R:4 | R:4 |  |  |

#### collinear

Fusion's rule (fitted on the 39 accepted one-mover cells of the free-standing line pair): rank the levels {0} < {2} < {1,3,5} < {4,6,7} (lowest moves first); the operand with the LOWER rank is the one that moves, a tie means the SECOND pick moves. It predicts 39 of 39 (no contradiction); 11 cells move both operands and are outside the rule. In words: the operand held least (level 0) is the one that gives way, the most held (4, 6, 7) always stays; two operands at the same rank: the first pick stays and the second is moved.

Grid, line (A) x line (B), `Fusion/ours`:

| A \ B | 0 free | 1 corner | 2 length | 3 H/V | 4 end fixed | 5 end+length | 6 H/V+end | 7 full |
|---|---|---|---|---|---|---|---|---|
| 0 free | b/b | a/b* | a/b* | a/a | a/R* | a/R* | a/a | a/a |
| 1 corner | b/b | X/b* | b/b | X/a* | a/R* | X/R* | a/a | a/a |
| 2 length | b/b | a/b* | b/b | a/a | a/R* | a/R* | a/a | a/a |
| 3 H/V | b/b | X/b* | b/b | b/b | X/R* | X/R* | a/R* | a/R* |
| 4 end fixed | b/b | b/b | b/b | R/R | X/R* | X/R* | R/R | R/R |
| 5 end+length | b/b | X/b* | b/b | R/R | X/R* | X/R* | R/R | R/R |
| 6 H/V+end | b/b | b/b | b/b | b/b | R/R | R/R | R/R | R/R |
| 7 full | b/b | b/b | b/b | b/b | R/R | R/R | R/R | R/R |

| kinds (A,B) | cells | same | Fusion who-moves | ours who-moves | how Fusion moves it | how ours moves it |
|---|---|---|---|---|---|---|
| LL | 64 | 29 | a:18 b:21 X:11 R:14 | a:9 b:27 R:28 | rotate:32 one end:12 stretch:11 translate:6 | stretch:22 rotate:11 translate:3 |
| LC | 8 | 1 | a:1 b:4 X:2 R:1 | b:4 R:4 | rotate:5 one end:3 stretch:1 | stretch:4 |
| CL | 8 | 2 | a:3 b:2 X:1 R:2 | a:2 b:2 R:4 | rotate:5 one end:2 | stretch:4 |
| LS | 4 | 0 | a:1 b:3 | b:4 | rotate:4 | scale:2 deform:2 |
| SL | 4 | 0 | a:3 b:1 | a:2 b:1 R:1 | rotate:4 | scale:2 stretch:1 |
| LR | 8 | 2 | a:4 b:1 X:1 R:2 | a:2 b:2 R:4 | translate:3 rotate:2 one end:1 deform:1 | stretch:2 deform:2 |
| RL | 8 | 4 | a:1 b:4 X:1 R:2 | b:4 R:4 | translate:3 rotate:2 deform:1 one end:1 | stretch:2 translate:2 |
| CC | 4 | 0 | a:1 b:2 X:1 | b:2 R:2 | rotate:3 one end:2 | stretch:2 |
| SS | 1 | 0 | b:1 | b:1 | translate:1 | deform:1 |
| RR | 4 | 1 | a:1 b:2 R:1 | b:2 R:2 | translate:3 | deform:2 |

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
| 6 H/V+end | b/X* | b/X* | b/X* | R/-* | b/X* | b/X* | R/-* | R/a* |
| 7 full | b/b | b/b | b/b | R/-* | b/b | b/b | R/b* | R/-* |

| kinds (A,B) | cells | same | Fusion who-moves | ours who-moves | how Fusion moves it | how ours moves it |
|---|---|---|---|---|---|---|
| LL | 64 | 10 | a:24 b:31 R:9 | a:6 b:6 X:45 -:7 | one end:20 stretch:20 rotate:15 | one end:44 stretch:42 rotate:16 |
| LC | 8 | 2 | a:1 b:7 | b:2 X:6 | stretch:4 one end:3 rotate:1 | stretch:8 one end:6 |
| CL | 8 | 2 | a:5 b:3 | a:2 X:6 | stretch:4 one end:3 rotate:1 | stretch:8 one end:6 |
| LS | 4 | 1 | a:1 b:3 | b:1 X:3 | scale:3 rotate:1 | scale:4 stretch:2 one end:1 |
| SL | 4 | 0 | a:3 b:1 | a:1 X:3 | scale:3 rotate:1 | scale:3 stretch:2 one end:1 deform:1 |
| LR | 8 | 2 | a:4 R:4 | a:3 b:1 X:3 -:1 | stretch:2 one end:2 | stretch:4 deform:4 one end:2 |
| RL | 8 | 2 | b:4 R:4 | b:2 X:2 -:4 | stretch:2 one end:2 | deform:2 stretch:2 one end:2 |
| CC | 4 | 0 | a:1 b:3 | X:4 | stretch:2 rotate:1 one end:1 | stretch:4 one end:4 |
| SS | 1 | 0 | b:1 | X:1 | rotate:1 | scale:2 |
| RR | 4 | 0 | R:4 | a:1 b:1 X:1 -:1 |  | deform:4 |

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
| o end at origin | b/b | b/b | b/b | b/b | R/R | R/R | R/R | R/R | -/- | R/b* |
| m mid at origin | b/b | a/b* | a/X* | a/X* | a/a | a/a | a/a | a/a | R/a* | b/X* |

| kinds (A,B) | cells | same | Fusion who-moves | ours who-moves | how Fusion moves it | how ours moves it |
|---|---|---|---|---|---|---|
| LL | 100 | 33 | a:32 b:41 -:1 R:26 | a:25 b:35 X:15 -:1 R:24 | translate:57 stretch:16 | one end:36 stretch:35 rotate:18 translate:1 |
| LR | 6 | 0 | a:3 b:3 | b:3 X:3 | translate:5 stretch:1 | deform:6 stretch:2 one end:1 |
| LO | 12 | 10 | a:3 b:6 R:3 | a:3 b:6 R:3 | translate:8 stretch:1 | translate:6 stretch:2 one end:1 |
| LA | 6 | 0 | a:3 b:3 | b:3 X:3 | translate:5 stretch:1 | deform+radius:6 stretch:2 one end:1 |
| LP | 12 | 10 | a:3 b:6 R:3 | a:3 b:6 R:3 | translate:8 stretch:1 | translate:6 stretch:2 one end:1 |
| LZ | 6 | 3 | a:2 R:4 | a:3 R:3 | translate:2 | stretch:2 one end:1 |
| RL | 6 | 0 | a:3 b:3 | a:3 b:1 X:2 | translate:5 stretch:1 | deform:5 stretch:2 one end:1 |
| RR | 1 | 0 | b:1 | X:1 | translate:1 | deform:2 |
| RO | 2 | 1 | a:1 b:1 | a:1 b:1 | translate:2 | translate:1 deform:1 |
| RA | 1 | 0 | b:1 | X:1 | translate:1 | deform:1 deform+radius:1 |
| RP | 2 | 1 | a:1 b:1 | a:1 b:1 | translate:2 | translate:1 deform:1 |
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
| ZL | 6 | 3 | b:2 R:4 | b:3 R:3 | translate:2 | stretch:2 one end:1 |
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
| RL | 6 | 0 | a:3 b:3 | a:3 X:3 | translate:5 stretch:1 | deform:6 one end:1 translate:1 stretch:1 |
| RR | 1 | 0 | a:1 | X:1 | translate:1 | deform:2 |
| RO | 2 | 0 | a:1 b:1 | a:1 X:1 | translate:2 | deform:2 translate:1 |
| RA | 1 | 0 | b:1 | X:1 | translate:1 | deform:1 deform+radius:1 |
| RP | 2 | 0 | a:1 b:1 | a:1 X:1 | translate:2 | deform:2 translate:1 |
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
| LR | 6 | 0 | a:3 b:3 | b:3 X:3 | translate:5 stretch:1 | deform:6 one end:2 stretch:1 |
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
| 3 H/V | b/a* | b/a* | b/a* | a/a |  |  |
| 4 end fixed | b/R* | b/R* | b/R* | R/R |  |  |
| 7 full | b/R* | b/R* | b/R* | R/R |  |  |
| o end at origin | b/R* | b/R* | b/R* | R/R |  |  |
| m mid at origin | b/a* | a/a | b/a* | a/a |  |  |

| kinds (A,B) | cells | same | Fusion who-moves | ours who-moves | how Fusion moves it | how ours moves it |
|---|---|---|---|---|---|---|
| LL | 24 | 6 | a:5 b:16 R:3 | a:12 R:12 | translate:13 one end:6 stretch:2 | stretch:6 one end:4 translate:2 |
| LC | 12 | 0 | b:12 | a:6 R:6 | translate:6 one end:6 | stretch:4 one end:2 |
| LS | 6 | 1 | a:3 b:3 | a:3 R:3 | translate:5 stretch:1 | stretch:2 one end:1 |
| LR | 12 | 7 | a:6 b:3 R:3 | a:6 R:6 | translate:7 stretch:2 | one end:2 translate:2 stretch:2 |
| RL | 4 | 0 | a:1 b:3 | a:4 | translate:3 one end:1 | deform:4 |
| RC | 2 | 0 | b:2 | a:2 | translate:1 one end:1 | deform:2 |
| RS | 1 | 0 | a:1 | a:1 | translate:1 | deform:1 |
| RR | 2 | 0 | a:1 b:1 | a:2 | translate:2 | deform:2 |
| OL | 8 | 4 | a:3 b:4 R:1 | a:4 R:4 | translate:5 one end:2 | translate:4 |
| OC | 4 | 1 | a:1 b:3 | a:2 R:2 | translate:2 one end:2 | translate:2 |
| OS | 2 | 1 | a:1 b:1 | a:1 R:1 | translate:2 | translate:1 |
| OR | 4 | 3 | a:2 b:1 R:1 | a:2 R:2 | translate:3 | translate:2 |
| AL | 4 | 0 | a:1 b:3 | a:4 | translate:3 one end:1 | deform+radius:4 |
| AC | 2 | 0 | b:2 | a:2 | translate:1 one end:1 | deform+radius:2 |
| AS | 1 | 0 | a:1 | a:1 | translate:1 | deform+radius:1 |
| AR | 2 | 0 | a:2 | a:2 | translate:2 | deform+radius:2 |
| PL | 8 | 5 | a:4 b:3 R:1 | a:4 R:4 | translate:6 one end:1 | translate:4 |
| PC | 4 | 2 | a:2 b:2 | a:2 R:2 | translate:3 one end:1 | translate:2 |
| PS | 2 | 1 | a:1 b:1 | a:1 R:1 | translate:2 | translate:1 |
| PR | 4 | 3 | a:2 b:1 R:1 | a:2 R:2 | translate:3 | translate:2 |
| ZL | 4 | 1 | b:3 R:1 | R:4 | translate:2 one end:1 |  |
| ZC | 2 | 0 | b:2 | R:2 | translate:1 one end:1 |  |
| ZS | 1 | 0 | b:1 | R:1 | translate:1 |  |
| ZR | 2 | 1 | b:1 R:1 | R:2 | translate:1 |  |

#### pointOnCircle

| kinds (A,B) | cells | same | Fusion who-moves | ours who-moves | how Fusion moves it | how ours moves it |
|---|---|---|---|---|---|---|
| LO | 24 | 5 | a:6 b:15 R:3 | a:12 R:12 | translate:16 radius:3 stretch:2 | stretch:8 one end:4 |
| LA | 24 | 7 | a:12 b:9 R:3 | a:12 R:12 | translate:14 stretch:4 scale+radius:3 | stretch:8 one end:4 |
| LF | 12 | 5 | a:6 b:3 R:3 | a:6 R:6 | translate:5 deform:2 stretch:2 | stretch:4 one end:2 |
| RO | 4 | 0 | a:2 b:2 | a:4 | translate:4 | deform:4 |
| RA | 4 | 0 | a:2 b:2 | a:4 | translate:4 | deform:4 |
| RF | 2 | 0 | a:1 b:1 | a:2 | deform:1 translate:1 | deform:2 |
| OO | 8 | 3 | a:2 b:5 R:1 | a:4 R:4 | translate:6 radius:1 | translate:4 |
| OA | 8 | 5 | a:4 b:3 R:1 | a:4 R:4 | translate:6 scale+radius:1 | translate:4 |
| OF | 4 | 3 | a:2 b:1 R:1 | a:2 R:2 | translate:2 deform:1 | translate:2 |
| AO | 4 | 0 | a:2 b:2 | a:4 | translate:4 | one point (deform)+radius:4 |
| AA | 4 | 0 | a:3 b:1 | a:4 | translate:4 | one point (deform)+radius:4 |
| AF | 2 | 0 | a:2 | a:2 | translate:2 | one point (deform)+radius:2 |
| PO | 8 | 5 | a:4 b:3 R:1 | a:4 R:4 | translate:6 radius:1 | translate:4 |
| PA | 8 | 5 | a:4 b:3 R:1 | a:4 R:4 | translate:6 scale+radius:1 | translate:4 |
| PF | 4 | 0 | R:4 | -:4 |  |  |
| ZO | 4 | 1 | b:3 R:1 | R:4 | translate:2 radius:1 |  |
| ZA | 4 | 1 | b:3 R:1 | R:4 | translate:2 scale+radius:1 |  |
| ZF | 2 | 1 | b:1 R:1 | R:2 | translate:1 |  |

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
| LS | 6 | 0 | a:3 b:3 | b:3 X:3 | translate:5 stretch:1 | scale:4 stretch:2 deform:2 one end:1 |
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
| ZS | 1 | 0 | b:1 | b:1 | translate:1 | deform:1 |
| ZR | 2 | 1 | b:1 R:1 | b:1 R:1 | translate:1 | deform:1 |

#### equal-circle

| kinds (A,B) | cells | same | Fusion who-moves | ours who-moves | how Fusion moves it | how ours moves it |
|---|---|---|---|---|---|---|
| OO | 16 | 12 | -:12 R:4 | -:16 |  |  |
| OA | 16 | 16 | R:16 | R:16 |  |  |
| OF | 8 | 8 | R:8 | R:8 |  |  |
| AO | 16 | 16 | R:16 | R:16 |  |  |
| AA | 16 | 12 | -:12 R:4 | -:16 |  |  |
| AF | 8 | 4 | a:4 R:4 | X:4 R:4 | scale+radius:4 | deform:4 deform+radius:2 scale+radius:2 |
| FO | 8 | 8 | R:8 | R:8 |  |  |
| FA | 8 | 4 | b:4 R:4 | X:4 R:4 | scale+radius:4 | deform:4 deform+radius:2 scale+radius:2 |
| FF | 4 | 0 | R:4 | -:4 |  |  |

#### tangent-line-circle

| kinds (A,B) | cells | same | Fusion who-moves | ours who-moves | how Fusion moves it | how ours moves it |
|---|---|---|---|---|---|---|
| LO | 16 | 8 | a:8 b:7 R:1 | a:6 b:2 X:6 R:2 | translate:10 stretch:2 one end:2 radius:1 | translate:12 stretch:4 one end:4 |
| LA | 16 | 7 | a:10 b:5 R:1 | a:6 b:2 X:6 R:2 | translate:8 stretch:4 one end:2 scale+radius:1 | stretch:4 deform+radius:4 deform:4 translate:4 |
| LF | 8 | 4 | a:5 b:2 R:1 | a:3 b:1 X:3 R:1 | stretch:2 translate:2 deform:2 one end:1 | stretch:4 deform:4 one end:2 |
| CO | 8 | 3 | a:5 b:3 | a:4 X:4 | translate:4 stretch:2 one end:2 | stretch:4 translate:4 one end:4 |
| CA | 8 | 4 | a:6 b:2 | a:4 X:4 | stretch:4 translate:2 one end:2 | stretch:4 one end:4 deform+radius:2 deform:2 |
| CF | 4 | 2 | a:3 b:1 | a:2 X:2 | stretch:2 deform:1 one end:1 | stretch:2 deform:2 one end:2 |
| SO | 4 | 2 | a:3 b:1 | a:2 X:2 | scale:3 translate:1 | scale:4 translate:2 |
| SA | 4 | 2 | a:4 | a:2 X:2 | scale:4 | scale:4 deform+radius:1 deform:1 |
| SF | 2 | 1 | a:2 | a:1 X:1 | scale:2 | scale:2 deform:1 |
| RO | 8 | 5 | a:3 b:4 R:1 | a:2 b:2 X:2 R:2 | deform:3 translate:3 radius:1 | deform:4 translate:4 |
| RA | 8 | 3 | a:4 b:3 R:1 | a:2 b:2 X:2 R:2 | deform:4 translate:2 scale+radius:1 | deform:6 deform+radius:2 |
| RF | 4 | 3 | a:2 b:1 R:1 | a:1 b:1 X:1 R:1 | deform:3 | deform:4 |
| OL | 16 | 8 | a:7 b:8 R:1 | a:2 b:6 X:6 R:2 | translate:10 stretch:2 one end:2 radius:1 | translate:12 stretch:4 one end:4 |
| OC | 8 | 3 | a:3 b:5 | b:4 X:4 | translate:4 stretch:2 one end:2 | translate:4 stretch:4 one end:4 |
| OS | 4 | 2 | a:1 b:3 | b:2 X:2 | scale:3 translate:1 | scale:4 translate:2 |
| OR | 8 | 5 | a:4 b:3 R:1 | a:2 b:2 X:2 R:2 | deform:3 translate:3 radius:1 | translate:4 deform:4 |
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
| OO | 16 | 5 | a:5 b:10 R:1 | a:4 b:4 X:4 R:4 | translate:7 translate+radius:4 radius:4 | translate:16 |
| OA | 16 | 5 | a:12 b:3 R:1 | a:4 b:4 X:4 R:4 | translate+radius:4 radius:4 translate:4 deform+radius:1 | translate:8 deform+radius:4 deform:4 |
| OF | 8 | 4 | a:4 b:3 R:1 | a:2 b:2 X:2 R:2 | deform:3 translate:2 translate+radius:1 radius:1 | translate:4 deform:4 |
| AO | 16 | 5 | a:3 b:12 R:1 | a:4 b:4 X:4 R:4 | translate+radius:4 radius:4 translate:4 deform+radius:1 | translate:8 deform+radius:4 deform:4 |
| AA | 16 | 8 | a:5 b:10 R:1 | a:4 b:4 X:4 R:4 | deform:7 deform+radius:4 scale+radius:4 | deform+radius:8 deform:8 |
| AF | 8 | 5 | a:3 b:4 R:1 | a:2 b:2 X:2 R:2 | deform:5 deform+radius:1 scale+radius:1 | deform:6 deform+radius:2 |
| FO | 8 | 4 | a:3 b:4 R:1 | a:2 b:2 X:2 R:2 | deform:3 translate:2 translate+radius:1 radius:1 | deform:4 translate:4 |
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
