// packages/core/frame-geometry.js — the shared shop-framing geometry engine, ported VERBATIM from the
// separate `geometric-frame-calc` repo (C:\Users\danse\APPS\geometric frame calc), where it's a plain,
// framework-free pure-function module shared by that repo's Trapezoid AND Parallelogram calculators
// (shared/utils/quadFrameCalculator.js + shared/utils/geometry.js). Copied here (not imported across
// repos) because #core/#ui only resolve for code living inside THIS monorepo's package.json `imports`
// map — a cross-repo import would mean copying packages/* into the other repo instead, creating a
// duplicated-source drift.
//
// Only the pieces `apps/frame-calc`'s Trapezoid port actually uses were carried over: `distance` (the
// engine's own dependency) and the dimension-formatting helpers (`formatImperial`/`formatDecimal`/
// `formatDim`) + `toPoly`. The original geometry.js also has `cornerJointPoints`/`mapPoint`/
// `computeOffsetShellPoints`/`dimLabelMidpoint`/`formatNum`, used only by the OTHER repo's Triangle tool
// (explicitly out of scope this cycle) — left behind rather than vendored unused; re-port them if a
// future Triangle/Polygon port needs them.

// ── from shared/utils/geometry.js ───────────────────────────────────────────────────────────────────

/**
 * Calculates Euclidean distance between two 2D points.
 * @param {{x: number, y: number}} p1
 * @param {{x: number, y: number}} p2
 * @returns {number}
 */
export function distance(p1, p2) {
  return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
}

/**
 * Formats a number as an imperial fraction string (e.g. 9.75 -> `9 3/4"`),
 * rounded to the nearest 1/denominator inch.
 * @param {number} num
 * @param {number} [denominator=16]
 * @returns {string}
 */
export function formatImperial(num, denominator = 16) {
  const sign = num < 0 ? '-' : '';
  num = Math.abs(num);

  let whole = Math.floor(num);
  let numerator = Math.round((num - whole) * denominator);
  if (numerator === denominator) {
    whole += 1;
    numerator = 0;
  }

  if (numerator === 0) return `${sign}${whole}"`;

  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(numerator, denominator);
  const n = numerator / g;
  const d = denominator / g;

  return whole === 0 ? `${sign}${n}/${d}"` : `${sign}${whole} ${n}/${d}"`;
}

/**
 * Formats a number as a decimal inch string (e.g. 9.75 -> `9.75"`).
 * @param {number} num
 * @param {number} [decimals=2]
 * @returns {string}
 */
export function formatDecimal(num, decimals = 2) {
  return `${Number(num).toFixed(decimals)}"`;
}

/**
 * Formats a dimension per the given unit mode. `precision` means fraction
 * denominator when mode is 'fraction' (default), or decimal places when
 * mode is 'decimal'.
 * @param {number} num
 * @param {number} precision
 * @param {'fraction'|'decimal'} [mode='fraction']
 * @returns {string}
 */
export function formatDim(num, precision, mode = 'fraction') {
  return mode === 'decimal' ? formatDecimal(num, precision) : formatImperial(num, precision);
}

/**
 * Converts a board object of points into an SVG polygon points attribute string.
 * @param {Object.<string, {x: number, y: number}>} board
 * @returns {string}
 */
export function toPoly(board) {
  return Object.values(board)
    .map(p => `${p.x},${p.y}`)
    .join(' ');
}

// ── from shared/utils/quadFrameCalculator.js ────────────────────────────────────────────────────────

/**
 * Per-vertex generalization of polygon-frame-calculator's regular-N-gon
 * engine (calculatePolygonFramingGeometry in polygonCalculator.js) to ANY
 * convex quadrilateral: same board/joint/shell geometry, but each vertex
 * carries its own interior angle instead of the constant used by a regular
 * polygon's central symmetry.
 *
 * Winding: normalized internally to the convention the reference engine's
 * regular-polygon vertex generator produces — positive signed area under
 * the standard shoelace formula. Callers may pass P in either order; if the
 * input is wound the other way, P and joints are reversed internally before
 * processing. Reversal swaps the array-index roles at every vertex (what
 * was the "current/start" board becomes the "previous/end" board), so
 * 'CW-Through'/'CCW-Through' are swapped on reversal to preserve each
 * joint's physical meaning — 'Miter' is unaffected.
 *
 * Saw gauge convention (miter-saw-scale readings, deviation from a square
 * cut) — matches polygonCalculator.js's stored cutList values and what
 * every app in this repo displays (framingCalculator.js stores the raw
 * θ/2 half-angle instead and displays the 90−x complement at render time —
 * same number on screen, different storage convention, so it is NOT the
 * same "stored" reference this engine's cutList matches):
 *   through board at that end:  0
 *   squared (butt) board:       |90 - interiorAngle_k|
 *   miter board:                |90 - interiorAngle_k / 2|
 *
 * @param {Object} inputs
 * @param {Array<{x:number,y:number}>} inputs.P - 4 ordered outer vertices (SVG y-down)
 * @param {number} [inputs.thick=1.5] - uniform board thickness
 * @param {Array<string>} [inputs.joints] - per-vertex 'Miter'|'CW-Through'|'CCW-Through',
 *   joints[k] between incoming board k-1 and outgoing board k (same semantics as polygonCalculator.js)
 * @param {number} [inputs.shellOffset=0] - sheathing shell clearance
 */
export function calculateQuadFrameGeometry({ P: inputP, thick = 1.5, joints: inputJoints = [], shellOffset = 0 }) {
  const n = inputP.length;
  const T = Math.max(0.1, thick);
  const d = Math.max(0.0, shellOffset);

  let P = inputP;
  let joints = inputJoints;
  if (signedArea(inputP) < 0) {
    P = inputP.slice().reverse();
    joints = inputJoints.slice().reverse().map(swapThroughLabel);
  }

  // Per-vertex interior angle and inward bisector direction. u1/u2 are unit
  // vectors from the vertex toward its neighbors; their sum bisects the
  // interior angle and points into the polygon regardless of winding (a
  // convex-polygon-only identity — see WORK-LOG for the derivation).
  const interiorAngleRad = [];
  const bisectorDir = [];
  for (let k = 0; k < n; k++) {
    const prevK = (k - 1 + n) % n;
    const nextK = (k + 1) % n;
    const u1 = unit(sub(P[prevK], P[k]));
    const u2 = unit(sub(P[nextK], P[k]));
    const dot = Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y));
    interiorAngleRad.push(Math.acos(dot));
    bisectorDir.push(unit({ x: u1.x + u2.x, y: u1.y + u2.y }));
  }

  const Q = [];
  const S = [];
  for (let k = 0; k < n; k++) {
    const half = interiorAngleRad[k] / 2;
    const offsetQ = T / Math.sin(half);
    const offsetS = d / Math.sin(half);
    Q.push({ x: P[k].x + bisectorDir[k].x * offsetQ, y: P[k].y + bisectorDir[k].y * offsetQ });
    S.push({ x: P[k].x - bisectorDir[k].x * offsetS, y: P[k].y - bisectorDir[k].y * offsetS });
  }

  const shellPolyString = S.map(pt => `${pt.x},${pt.y}`).join(' ');

  const boards = [];
  const cutList = [];

  for (let k = 0; k < n; k++) {
    const nextK = (k + 1) % n;
    const prevK = (k - 1 + n) % n;
    const nextNextK = (k + 2) % n;

    const jStart = joints[k] || 'Miter';
    const jEnd = joints[nextK] || 'Miter';

    const pStart = P[k];
    const pEnd = P[nextK];
    const qStart = Q[k];
    const qEnd = Q[nextK];

    let bP1 = { ...pStart };
    let bP2 = { ...pEnd };
    let bP3 = { ...qEnd };
    let bP4 = { ...qStart };

    const boardLen = distance(pStart, pEnd);
    const dirX = (pEnd.x - pStart.x) / boardLen;
    const dirY = (pEnd.y - pStart.y) / boardLen;

    const pPrev = P[prevK];
    const prevLen = distance(pPrev, pStart);
    const dirPrevX = (pStart.x - pPrev.x) / prevLen;
    const dirPrevY = (pStart.y - pPrev.y) / prevLen;

    const pNextNext = P[nextNextK];
    const nextLen = distance(pEnd, pNextNext);
    const dirNextX = (pNextNext.x - pEnd.x) / nextLen;
    const dirNextY = (pNextNext.y - pEnd.y) / nextLen;

    // Butt-joint corner shift uses the vertex's OWN exterior angle.
    const extSinStart = Math.sin(Math.PI - interiorAngleRad[k]);
    const extSinEnd = Math.sin(Math.PI - interiorAngleRad[nextK]);

    if (jStart === 'CW-Through') { // previous board runs through, this board butts
      const shift = T / extSinStart;
      bP1 = { x: pStart.x + dirX * shift, y: pStart.y + dirY * shift };
      bP4 = { ...qStart };
    } else if (jStart === 'CCW-Through') { // this board runs through, previous board butts
      const shift = T / extSinStart;
      bP1 = { ...pStart };
      bP4 = { x: pStart.x - dirPrevX * shift, y: pStart.y - dirPrevY * shift };
    }

    if (jEnd === 'CCW-Through') { // next board runs through, this board butts
      const shift = T / extSinEnd;
      bP2 = { x: pEnd.x - dirX * shift, y: pEnd.y - dirY * shift };
      bP3 = { ...qEnd };
    } else if (jEnd === 'CW-Through') { // this board runs through, next board butts
      const shift = T / extSinEnd;
      bP2 = { ...pEnd };
      bP3 = { x: pEnd.x + dirNextX * shift, y: pEnd.y + dirNextY * shift };
    }

    boards.push({ p1: bP1, p2: bP2, p3: bP3, p4: bP4 });

    const maxLen = distance(bP1, bP2);
    const minLen = distance(bP4, bP3);

    const interiorDegStart = interiorAngleRad[k] * 180 / Math.PI;
    const interiorDegEnd = interiorAngleRad[nextK] * 180 / Math.PI;
    const buttGaugeStart = Math.abs(90 - interiorDegStart);
    const buttGaugeEnd = Math.abs(90 - interiorDegEnd);
    const miterGaugeStart = Math.abs(90 - interiorDegStart / 2);
    const miterGaugeEnd = Math.abs(90 - interiorDegEnd / 2);

    const startGauge = jStart === 'CCW-Through' ? 0 : jStart === 'CW-Through' ? buttGaugeStart : miterGaugeStart;
    const endGauge = jEnd === 'CW-Through' ? 0 : jEnd === 'CCW-Through' ? buttGaugeEnd : miterGaugeEnd;

    cutList.push({
      part: `Side ${k + 1}`,
      maxLen,
      minLen,
      topSawGauge: startGauge,
      botSawGauge: endGauge,
    });
  }

  const xs = P.map(p => p.x);
  const ys = P.map(p => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return {
    P,
    Q,
    S,
    boards,
    cutList,
    interiorAnglesDeg: interiorAngleRad.map(r => r * 180 / Math.PI),
    shellPolyString,
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

function unit(v) {
  const len = Math.hypot(v.x, v.y);
  return { x: v.x / len, y: v.y / len };
}

function signedArea(P) {
  let area = 0;
  const n = P.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += P[i].x * P[j].y - P[j].x * P[i].y;
  }
  return area / 2;
}

function swapThroughLabel(j) {
  if (j === 'CW-Through') return 'CCW-Through';
  if (j === 'CCW-Through') return 'CW-Through';
  return j;
}
