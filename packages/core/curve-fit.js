// packages/core/curve-fit.js — UNIFY-3-fit: fit a freehand point stream to a chain of CUBIC BEZIER segments via
// Schneider's algorithm ("An Algorithm for Automatically Fitting Digitized Curves", Graphics Gems, 1990). PURE, no
// DOM. Used by the plotter's Freehand tool (UNIFY-4) and available to any app.
//
//   fitCubic(points, tolerance) -> [{ p0, c1, c2, p3 }, ...]
//
// `points` = an array of {x,y} (or [x,y]); `tolerance` = the max allowed distance (world units) from any input point
// to the fitted curve. Fits ONE cubic across the run (least-squares with endpoint tangents); if the worst point
// exceeds tolerance it SPLITS there, computes a tangent at the split, and recurses on both halves. Each returned
// segment is ready to become a #core bezier via makeBezier (endpoints -> joints, c1/c2 -> [x,y] data).
// Degenerate: <2 points -> []; exactly 2 -> one straight line-cubic.

const MAX_ITER = 4;   // Newton-Raphson reparameterization passes before giving up + splitting a run
const EPS = 1e-12;

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a, s) => ({ x: a.x * s, y: a.y * s });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const len = (a) => Math.hypot(a.x, a.y);
const normalize = (a) => { const l = len(a); return l < EPS ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l }; };
const toXY = (p) => Array.isArray(p) ? { x: p[0], y: p[1] } : { x: p.x, y: p.y };

// Cubic Bernstein basis.
const B0 = (u) => (1 - u) * (1 - u) * (1 - u);
const B1 = (u) => 3 * u * (1 - u) * (1 - u);
const B2 = (u) => 3 * u * u * (1 - u);
const B3 = (u) => u * u * u;

// Evaluate a cubic [p0,c1,c2,p3] (control points {x,y}) at parameter t.
function bezier(bez, t) {
  const [p0, c1, c2, p3] = bez, b0 = B0(t), b1 = B1(t), b2 = B2(t), b3 = B3(t);
  return { x: p0.x * b0 + c1.x * b1 + c2.x * b2 + p3.x * b3, y: p0.y * b0 + c1.y * b1 + c2.y * b2 + p3.y * b3 };
}
// First derivative at t.
function bezierPrime(bez, t) {
  const [p0, c1, c2, p3] = bez;
  const q0 = mul(sub(c1, p0), 3), q1 = mul(sub(c2, c1), 3), q2 = mul(sub(p3, c2), 3), u = 1 - t;
  return { x: q0.x * u * u + q1.x * 2 * u * t + q2.x * t * t, y: q0.y * u * u + q1.y * 2 * u * t + q2.y * t * t };
}
// Second derivative at t: 6[(1-t)(p0-2c1+c2) + t(c1-2c2+p3)].
function bezierPrimePrime(bez, t) {
  const [p0, c1, c2, p3] = bez;
  const r0 = mul(add(sub(p0, mul(c1, 2)), c2), 6), r1 = mul(add(sub(c1, mul(c2, 2)), p3), 6), u = 1 - t;
  return { x: r0.x * u + r1.x * t, y: r0.y * u + r1.y * t };
}

// Normalized cumulative chord length -> initial parameter values in [0,1].
function chordLengthParameterize(points) {
  const u = [0];
  for (let i = 1; i < points.length; i++) u[i] = u[i - 1] + len(sub(points[i], points[i - 1]));
  const total = u[u.length - 1] || 1;
  return u.map((v) => v / total);
}

// Least-squares fit a single cubic through `points` at parameters `u`, honoring the endpoint tangents.
function generateBezier(points, u, leftTangent, rightTangent) {
  const n = points.length, p0 = points[0], p3 = points[n - 1];
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  for (let i = 0; i < n; i++) {
    const a0 = mul(leftTangent, B1(u[i])), a1 = mul(rightTangent, B2(u[i]));
    c00 += dot(a0, a0); c01 += dot(a0, a1); c11 += dot(a1, a1);
    const tmp = sub(points[i], bezier([p0, p0, p3, p3], u[i]));
    x0 += dot(a0, tmp); x1 += dot(a1, tmp);
  }
  const detC = c00 * c11 - c01 * c01;
  const segLen = len(sub(p3, p0));
  let alphaL = detC === 0 ? 0 : (x0 * c11 - x1 * c01) / detC;
  let alphaR = detC === 0 ? 0 : (c00 * x1 - c01 * x0) / detC;
  // Degenerate/negative alphas -> Wu/Barsky fallback: control points at 1/3 of the chord along each tangent.
  const epsilon = 1e-6 * segLen;
  if (alphaL < epsilon || alphaR < epsilon) {
    const d = segLen / 3;
    return [p0, add(p0, mul(leftTangent, d)), add(p3, mul(rightTangent, d)), p3];
  }
  return [p0, add(p0, mul(leftTangent, alphaL)), add(p3, mul(rightTangent, alphaR)), p3];
}

// One Newton-Raphson step improving a point's parameter along the curve.
function newtonRaphson(bez, point, u) {
  const d = sub(bezier(bez, u), point), d1 = bezierPrime(bez, u), d2 = bezierPrimePrime(bez, u);
  const den = dot(d1, d1) + dot(d, d2);
  if (Math.abs(den) < EPS) return u;
  return u - dot(d, d1) / den;
}

// Max distance from any input point to the fitted curve (+ the index of the worst point, clamped to interior).
function computeMaxError(points, bez, u) {
  let maxDist = 0, split = points.length >> 1;
  for (let i = 0; i < points.length; i++) {
    const dist = len(sub(bezier(bez, u[i]), points[i]));
    if (dist > maxDist) { maxDist = dist; split = i; }
  }
  return [maxDist, Math.max(1, Math.min(points.length - 2, split))];
}

function fitRecursive(points, leftTangent, rightTangent, tol) {
  if (points.length === 2) {
    const d = len(sub(points[1], points[0])) / 3, p0 = points[0], p3 = points[1];
    return [[p0, add(p0, mul(leftTangent, d)), add(p3, mul(rightTangent, d)), p3]];
  }
  let u = chordLengthParameterize(points);
  let bez = generateBezier(points, u, leftTangent, rightTangent);
  let [maxError, split] = computeMaxError(points, bez, u);
  if (maxError <= tol) return [bez];
  // Close enough to iterate: Newton-Raphson reparameterize + refit a few times before splitting.
  if (maxError <= tol * 4) {
    for (let i = 0; i < MAX_ITER; i++) {
      const uPrime = u.map((ui, k) => newtonRaphson(bez, points[k], ui));
      bez = generateBezier(points, uPrime, leftTangent, rightTangent);
      [maxError, split] = computeMaxError(points, bez, uPrime);
      if (maxError <= tol) return [bez];
      u = uPrime;
    }
  }
  // Split at the worst point (tangent from its neighbors) + recurse on both halves.
  const centerTangent = normalize(sub(points[split - 1], points[split + 1]));
  const left = fitRecursive(points.slice(0, split + 1), leftTangent, centerTangent, tol);
  const right = fitRecursive(points.slice(split), mul(centerTangent, -1), rightTangent, tol);
  return left.concat(right);
}

export function fitCubic(points, tolerance) {
  // Normalize input + drop consecutive duplicates (zero-length chords break the parameterization).
  const raw = (points || []).map(toXY);
  const pts = [];
  for (const p of raw) { const q = pts[pts.length - 1]; if (!q || len(sub(p, q)) > EPS) pts.push(p); }
  if (pts.length < 2) return [];
  const tol = tolerance > 0 ? tolerance : 1;
  const leftTangent = normalize(sub(pts[1], pts[0]));
  const rightTangent = normalize(sub(pts[pts.length - 2], pts[pts.length - 1]));
  return fitRecursive(pts, leftTangent, rightTangent, tol).map(([p0, c1, c2, p3]) => ({ p0, c1, c2, p3 }));
}
