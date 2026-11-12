// packages/ui/angle-dimension.js -- TASK 543: which of the four sectors two crossing lines make an ANGLE dimension measures. Pure (no DOM).
//
// Two crossing lines make four sectors: two of span s (between the +direction rays of the two lines, and between the -direction rays)
// and two of span 180 - s. The stored constraint says which pair it measures: the value is the span of the +d1/+d2 sector (the solver's
// signed CCW line-to-line angle, task 511), or, when `supplement: true`, the span of the other pair (the row's sin(t) is negated,
// definitions.js). The sector where the label is dropped when the dimension is CREATED decides it (Fusion: measured through its API).

const TAU = Math.PI * 2;
const norm = (a) => ((a % TAU) + TAU) % TAU;

// The arc's sector. d1, d2 = the line directions (radians); labelAngle = the direction from the intersection to the label;
// value = a driving dimension's value in degrees (then only the two sectors of that span qualify, the label picks which: the one it
// sits in, else the nearer), or null (the sector the label sits in). Returns { start, end } in radians, end - start = the CCW span.
export function angleDimensionSector(d1, d2, labelAngle, value) {
  const ccw = norm(d2 - d1);
  const first = ccw <= Math.PI ? d1 : d2;                  // the ray the +d1/+d2 sector starts from (CCW)
  const s = ccw <= Math.PI ? ccw : TAU - ccw;              // that sector's span, 0..PI
  const sectors = [
    { start: first, span: s },
    { start: first + s, span: Math.PI - s },
    { start: first + Math.PI, span: s },
    { start: first + Math.PI + s, span: Math.PI - s },
  ].map((x) => ({ start: x.start, end: x.start + x.span, span: x.span }));
  let pool = sectors;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const v = value * Math.PI / 180;
    const useS = Math.abs(s - v) <= Math.abs((Math.PI - s) - v);
    pool = sectors.filter((x, i) => (i % 2 === 0) === useS);
  }
  const l = norm(labelAngle);
  let best = null, bestScore = Infinity;
  for (const x of pool) {
    const mid = x.start + x.span / 2;
    const off = norm(l - x.start);
    const score = off <= x.span ? -1 : Math.abs(norm(l - mid + Math.PI) - Math.PI);
    if (score < bestScore) { bestScore = score; best = x; }
  }
  return { start: best.start, end: best.end };
}

// Where the dimension's label sits as a direction from the intersection (glyphPos, then __pos, else between the two lines).
export function angleLabelAngle(c, int, d1, d2) {
  const at = c.glyphPos || c.__pos;
  return at ? Math.atan2(at.y - int.y, at.x - int.x) : (d1 + d2) / 2;
}

// What a dimension whose label sits at `labelAngle` measures, for the pair stored as [line 1, line 2] (the CCW pair): { value, supplement }.
// theta = the CCW angle from line 1 to line 2 (0..180). The label in a sector of span theta -> value theta; in a sector of span
// 180 - theta -> value 180 - theta with supplement true (at exactly 90 both are the same: the plain row).
export function angleDimensionChoice(j1, j2, j3, j4, labelAngle) {
  const d1 = Math.atan2(j2.y - j1.y, j2.x - j1.x), d2 = Math.atan2(j4.y - j3.y, j4.x - j3.x);
  let theta = norm(d2 - d1) * 180 / Math.PI;
  if (theta > 180) theta = 360 - theta;                    // an unordered (clockwise) pair: the unsigned angle
  const { start, end } = angleDimensionSector(d1, d2, labelAngle, null);
  const span = (end - start) * 180 / Math.PI;
  return Math.abs(span - theta) <= Math.abs(span - (180 - theta)) ? { value: theta, supplement: false } : { value: 180 - theta, supplement: true };
}

// The same, read off a stored dimension and the geometry (the value a reference dimension takes when it becomes driving, task 543).
export function angleDimensionChoiceFor(c, j1, j2, j3, j4, int) {
  const d1 = Math.atan2(j2.y - j1.y, j2.x - j1.x), d2 = Math.atan2(j4.y - j3.y, j4.x - j3.x);
  return angleDimensionChoice(j1, j2, j3, j4, angleLabelAngle(c, int, d1, d2));
}
