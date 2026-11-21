// packages/core/gear-geometry.js -- TASK 840: the geometry of a standard SPUR GEAR tooth (involute, full-depth). PURE, no DOM.
//
// THE GEAR (metric, ISO 53 basic rack): z teeth, module m, pressure angle alpha (20 or 14.5 degrees):
//   pitch radius rp = z m / 2, base radius rb = rp cos(alpha), tip radius ra = rp + m (addendum 1 m), root radius rf = rp - 1.25 m (dedendum 1.25 m).
// THE TOOTH, in the template's user coordinates (Y up, the gear's centre on the origin, the tooth's axis the +Y axis). Its RIGHT flank is the
// involute of the base circle that unwinds counter-clockwise from the base point B at polar angle beta = 90 deg - psiB, where psiB (the half
// tooth angle at the base circle, from the axis) = pi / (2 z) + inv(alpha) - delta: the tooth is pi m / 2 thick on the pitch circle, less the
// BACKLASH allowance. inv(a) = tan(a) - a. Its point at roll angle t: P(t) = rb (cos(beta + t) + t sin(beta + t), sin(beta + t) - t cos(beta + t)),
// at radius rb sqrt(1 + t^2). The left flank is its mirror in the Y axis.
// BACKLASH (wood): each flank moves b / 2 into the tooth ALONG ITS NORMAL, so the tooth is b thinner (normal measure) and two such gears, centred
// in mesh, keep b between their flanks on each side. A parallel curve of an involute is the same involute turned about the centre, so this is
// EXACT as a turn of the flank by delta = (b / 2) / rb toward the axis (no second curve).
// BELOW THE BASE CIRCLE (rf < rb: under 42 teeth at 20 deg, under 79 at 14.5 deg) there is no involute: the flank goes on as a plain RADIAL
// line from B down to the root circle (the undercut a rack cutter would make is NOT generated; tests/spur-gear-840-node.test.js measures the
// mesh clearance this leaves). At or above it (rf >= rb) the involute starts on the root circle (its point F at roll tF).
// THE ARCS (the app has no involute curve): the flank's involute, from its start S (B, or F) to its tip point A (on the tip circle), is TWO
// circular arcs S -> J -> A, all three points ON the involute (so the flank meets the radial line, the tip arc and the other arc exactly): each
// arc's centre on its chord's bisector at the offset that makes its largest RADIAL deviation from the involute the least (a Chebyshev fit, golden
// section), and the junction J at the roll angle where the two arcs' deviations are equal (bisection). The fit depends only on z and alpha: the
// whole tooth scales with m (the turn by delta does not change its shape), so it is done once at m = 1. Measured (the worst over 6..200 teeth,
// both angles): under 0.0022 m (0.22 % of the module: 0.0065 mm at the default 3 mm module).

// the template's choice (a choice's value is text, as every template choice's: the start view's buttons carry it as data-value): the degrees
export const GEAR_PRESSURE_ANGLES = Object.freeze([
  Object.freeze({ value: '20', label: '20 deg pressure angle' }),
  Object.freeze({ value: '14.5', label: '14.5 deg pressure angle' }),
]);
export const ADDENDUM = 1, DEDENDUM = 1.25; // in modules (the basic rack)

const DEG = Math.PI / 180;
/** The involute function inv(a) = tan(a) - a (radians). */
export const involuteFn = (a) => Math.tan(a) - a;
/** The gear's circles: { rp, rb, ra, rf } (mm) for z teeth, module m, pressure angle alphaDeg. */
export function gearCircles(z, m, alphaDeg) {
  const rp = z * m / 2;
  return { rp, rb: rp * Math.cos(alphaDeg * DEG), ra: rp + ADDENDUM * m, rf: rp - DEDENDUM * m };
}
/** The point at roll angle t of the involute of the circle rb that unwinds counter-clockwise from the base point at polar angle beta. */
export function involutePoint(rb, beta, t) {
  const a = beta + t;
  return { x: rb * (Math.cos(a) + t * Math.sin(a)), y: rb * (Math.sin(a) - t * Math.cos(a)) };
}
/** The roll angle at radius r on the involute of rb (0 at or under the base circle). */
export const rollAt = (rb, r) => Math.sqrt(Math.max(0, (r / rb) ** 2 - 1));

const SAMPLES = 64;
// the arc through the involute's points at t0 and t1 whose centre is `s` off the chord's middle, along its left normal -> { c, r }
function arcOn(rb, t0, t1, s) {
  const p = involutePoint(rb, 0, t0), q = involutePoint(rb, 0, t1), dx = q.x - p.x, dy = q.y - p.y, L = Math.hypot(dx, dy);
  const c = { x: (p.x + q.x) / 2 - s * dy / L, y: (p.y + q.y) / 2 + s * dx / L };
  return { c, r: Math.hypot(p.x - c.x, p.y - c.y) };
}
// the largest radial deviation of the involute between t0 and t1 from the arc { c, r }
function arcDeviation(rb, t0, t1, { c, r }) {
  let e = 0;
  for (let i = 1; i < SAMPLES; i++) { const u = involutePoint(rb, 0, t0 + (t1 - t0) * i / SAMPLES); e = Math.max(e, Math.abs(Math.hypot(u.x - c.x, u.y - c.y) - r)); }
  return e;
}
// the best arc through the involute's points at t0 and t1 (golden section on its centre's offset, bracketed round the centre of curvature at
// the middle of the piece, which lies on the base circle) -> { c, r, err }
function bestArc(rb, t0, t1) {
  const p = involutePoint(rb, 0, t0), q = involutePoint(rb, 0, t1), dx = q.x - p.x, dy = q.y - p.y, L = Math.hypot(dx, dy);
  const tm = (t0 + t1) / 2, cc = { x: rb * Math.cos(tm), y: rb * Math.sin(tm) };
  const s0 = (cc.x - (p.x + q.x) / 2) * (-dy / L) + (cc.y - (p.y + q.y) / 2) * (dx / L);
  const g = (Math.sqrt(5) - 1) / 2, err = (s) => arcDeviation(rb, t0, t1, arcOn(rb, t0, t1, s));
  let a = s0 * 0.25, b = s0 * 1.75;
  for (let i = 0; i < 80; i++) { const c1 = b - g * (b - a), c2 = a + g * (b - a); if (err(c1) < err(c2)) b = c2; else a = c1; }
  const arc = arcOn(rb, t0, t1, (a + b) / 2);
  return { ...arc, err: arcDeviation(rb, t0, t1, arc) };
}

/**
 * The two-arc fit of the flank of a z-tooth gear at pressure angle alphaDeg, at MODULE 1, in the involute's own frame (base point at polar angle
 * 0, unwinding counter-clockwise): { rb, ra, rf, tS (the roll angle of the start: 0 = B on the base circle, or tF on the root circle), tJ, tA,
 * arcs: [{ c, r }, { c, r }] (S -> J, J -> A), err (the fit's largest radial deviation, in modules) }.
 */
export function fitFlank(z, alphaDeg) {
  const { rb, ra, rf } = gearCircles(z, 1, alphaDeg);
  const tS = rollAt(rb, Math.max(rb, rf)), tA = rollAt(rb, ra);
  let lo = tS, hi = tA; // e1(tJ) grows with tJ, e2(tJ) shrinks: their crossing makes the larger of the two the least
  for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (bestArc(rb, tS, mid).err < bestArc(rb, mid, tA).err) lo = mid; else hi = mid; }
  const tJ = (lo + hi) / 2, a1 = bestArc(rb, tS, tJ), a2 = bestArc(rb, tJ, tA);
  return { rb, ra, rf, tS, tJ, tA, arcs: [{ c: a1.c, r: a1.r }, { c: a2.c, r: a2.r }], err: Math.max(a1.err, a2.err) };
}

/**
 * THE TOOTH of a spur gear: { teeth, module, pressureAngle (deg), backlash (mm) } -> its RIGHT half in user coordinates (Y up, the tooth's axis
 * the +Y axis; the left half is its mirror in the Y axis), mm:
 *   circles { rp, rb, ra, rf }; radial (true when rf < rb: a radial line F -> B under the involute);
 *   G (the middle of the gap on the root circle, at pi / z from the axis), F (the flank's foot on the root circle), B (on the base circle, radial
 *   only), J, A (on the tip circle), C1, C2 (the two arcs' centres), rho1, rho2 (their radii);
 *   S = the involute's start (B, or F), psiS = its angle from the axis (deg), delta = the backlash turn (rad), fit = fitFlank's (at module 1).
 */
export function spurTooth({ teeth: z, module: m, pressureAngle: alphaDeg, backlash: b = 0 }) {
  const fit = fitFlank(z, alphaDeg), circles = gearCircles(z, m, alphaDeg);
  const delta = (b / 2) / circles.rb;
  const psiB = Math.PI / (2 * z) + involuteFn(alphaDeg * DEG) - delta, beta = Math.PI / 2 - psiB;
  const turn = (p) => ({ x: m * (p.x * Math.cos(beta) - p.y * Math.sin(beta)), y: m * (p.x * Math.sin(beta) + p.y * Math.cos(beta)) }); // the fit's frame -> user
  const radial = circles.rf < circles.rb;
  const S = turn(involutePoint(fit.rb, 0, fit.tS)), J = turn(involutePoint(fit.rb, 0, fit.tJ)), A = turn(involutePoint(fit.rb, 0, fit.tA));
  const polar = (r, psi) => ({ x: r * Math.sin(psi), y: r * Math.cos(psi) }); // at radius r, psi (rad) right of the axis
  const psiS = Math.atan2(S.x, S.y);
  return {
    circles, radial, delta, fit,
    G: polar(circles.rf, Math.PI / z), F: polar(circles.rf, psiS), B: radial ? S : null, S, J, A,
    C1: turn(fit.arcs[0].c), C2: turn(fit.arcs[1].c), rho1: m * fit.arcs[0].r, rho2: m * fit.arcs[1].r,
    psiS: psiS / DEG,
  };
}
