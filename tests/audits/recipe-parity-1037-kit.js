// tests/audits/recipe-parity-1037-kit.js — TASK 1037 (AUDIT ONLY, outside the gate): the numeric DOF model shared by
// tests/audits/recipe-parity-1037-node.mjs (both sides of the parity audit go through the SAME model code).
import { CONSTRAINT_TYPES } from '#core/constants.js';

// ------------------------------------------------------------------------------------------------ MODEL: one numeric DOF model for both sides
// Unknowns: every point (x, y) and every circle's radius. An arc is centre + start + end with |s - c| = |e - c| (Fusion's own arc, our EQUAL).
// DOF = unknowns - rank(J) at a point where the equations hold (Gauss-Newton projects the rounded coordinates onto them first).
// Residuals per constraint kind are listed in eqs(); Fusion's Polygon constraint is modelled as "a regular N-gon about its centre point"
// (corners equidistant from the centre, sides equal): its entities are not exposed by the recording (shp_step.py con() finds none).
export function modelDof(model) {
  const P = model.points; // id -> [x, y]
  const ids = Object.keys(P);
  const circles = model.curves.filter((c) => c.type === 'circle');
  const n = ids.length * 2 + circles.length;
  const idx = new Map(ids.map((id, i) => [id, i * 2]));
  const ridx = new Map(circles.map((c, i) => [c.id, ids.length * 2 + i]));
  const x0 = new Float64Array(n);
  ids.forEach((id, i) => { x0[2 * i] = P[id][0]; x0[2 * i + 1] = P[id][1]; });
  circles.forEach((c) => { x0[ridx.get(c.id)] = c.r; });
  const curve = new Map(model.curves.map((c) => [c.id, c]));
  const g = (x, id) => [x[idx.get(id)], x[idx.get(id) + 1]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
  const len = (a) => Math.hypot(a[0], a[1]);
  const radius = (x, c) => c.type === 'circle' ? x[ridx.get(c.id)] : len(sub(g(x, c.s), g(x, c.c)));
  const dir = (x, l) => sub(g(x, l.e), g(x, l.s));
  const ptLine = (x, p, l) => cross(dir(x, l), sub(g(x, p), g(x, l.s))) / len(dir(x, l));
  const ptCurve = (x, p, k) => k.type === 'line' ? ptLine(x, p, k) : len(sub(g(x, p), g(x, k.c))) - radius(x, k);
  const branchAt = new Map(); // tangent arc-arc: internal / external from the starting geometry
  function eqs(x) {
    const r = [];
    for (const c of model.curves) if (c.type === 'arc') r.push(len(sub(g(x, c.s), g(x, c.c))) - len(sub(g(x, c.e), g(x, c.c))));
    model.cons.forEach((k, ki) => {
      const C = (i) => curve.get(k.curves[i]);
      switch (k.t) {
        case 'H': r.push(g(x, k.pts[0])[1] - g(x, k.pts[1])[1]); break;
        case 'V': r.push(g(x, k.pts[0])[0] - g(x, k.pts[1])[0]); break;
        case 'coincident': { const a = g(x, k.pts[0]), b = g(x, k.pts[1]); r.push(a[0] - b[0], a[1] - b[1]); break; }
        case 'onCurve': r.push(ptCurve(x, k.pts[0], C(0))); break;
        case 'mid': { const a = g(x, k.pts[0]), b = g(x, k.pts[1]), m = g(x, k.pts[2]); r.push(m[0] - (a[0] + b[0]) / 2, m[1] - (a[1] + b[1]) / 2); break; }
        case 'perp': { const a = dir(x, C(0)), b = dir(x, C(1)); r.push(dot(a, b) / (len(a) * len(b))); break; }
        case 'par': { const a = dir(x, C(0)), b = dir(x, C(1)); r.push(cross(a, b) / (len(a) * len(b))); break; }
        case 'tangent': {
          const a = C(0), b = C(1);
          // Two curves that SHARE an end point P touch there: the regular form of the tangency is "the radius at P is perpendicular to the
          // line" (line - arc) or "the two centres and P are collinear" (arc - arc). The distance form (|dist(C, line)| - r, |C1C2| - (r1 + r2))
          // is an EXTREMUM at such a solution (P is on both curves, so dist <= r always): its gradient is ZERO there and a rank count would
          // call the tangency free. The distance form is kept for curves that do not share an end.
          const endsOf = (q) => (q.type === 'line' || q.type === 'arc') ? [q.s, q.e] : [];
          const P = endsOf(a).find((p) => endsOf(b).includes(p));
          if (P && (a.type === 'line' || b.type === 'line')) { const l = a.type === 'line' ? a : b, q = a.type === 'line' ? b : a; const u = dir(x, l), w = sub(g(x, P), g(x, q.c)); r.push(dot(u, w) / (len(u) * len(w))); }
          else if (P) { const w1 = sub(g(x, P), g(x, a.c)), w2 = sub(g(x, P), g(x, b.c)); r.push(cross(w1, w2) / (len(w1) * len(w2))); }
          else if (a.type === 'line' || b.type === 'line') { const l = a.type === 'line' ? a : b, q = a.type === 'line' ? b : a; r.push(Math.abs(ptLine(x, q.c, l)) - radius(x, q)); }
          else {
            const d = len(sub(g(x, a.c), g(x, b.c))), ra = radius(x, a), rb = radius(x, b);
            if (!branchAt.has(ki)) branchAt.set(ki, Math.abs(d - (ra + rb)) < Math.abs(d - Math.abs(ra - rb)) ? 'ext' : 'int');
            r.push(branchAt.get(ki) === 'ext' ? d - (ra + rb) : d - Math.abs(ra - rb));
          }
          break;
        }
        case 'equalLen': { const a = g(x, k.pts[0]), b = g(x, k.pts[1]), c2 = g(x, k.pts[2]), d = g(x, k.pts[3]); r.push(len(sub(b, a)) - len(sub(d, c2))); break; }
        case 'equalCurve': { const a = C(0), b = C(1); const L = (q) => q.type === 'line' ? len(dir(x, q)) : radius(x, q); r.push(L(a) - L(b)); break; }
        case 'dist': r.push(len(sub(g(x, k.pts[0]), g(x, k.pts[1]))) - k.v); break;
        case 'radius': r.push(radius(x, C(0)) - k.v); break;
        case 'fix': { const a = g(x, k.pts[0]); r.push(a[0] - k.at[0], a[1] - k.at[1]); break; }
        case 'polygon': {
          const cen = k.pts[0], ls = k.curves.map((id) => curve.get(id));
          const R0 = len(sub(g(x, ls[0].s), g(x, cen)));
          for (let i = 1; i < ls.length; i++) r.push(len(sub(g(x, ls[i].s), g(x, cen))) - R0);
          const L0 = len(dir(x, ls[0]));
          for (let i = 1; i < ls.length; i++) r.push(len(dir(x, ls[i])) - L0);
          break;
        }
        default: throw new Error('model: unknown constraint ' + k.t);
      }
    });
    return r;
  }
  const jac = (x) => { const f0 = eqs(x); const m = f0.length; const Jm = Array.from({ length: m }, () => new Float64Array(n)); const h = 1e-7;
    for (let j = 0; j < n; j++) { const xp = Float64Array.from(x); const xm = Float64Array.from(x); xp[j] += h; xm[j] -= h; const fp = eqs(xp), fm = eqs(xm); for (let i = 0; i < m; i++) Jm[i][j] = (fp[i] - fm[i]) / (2 * h); }
    return { f: f0, J: Jm }; };
  // Gauss-Newton (minimum-norm step through J J^T + mu I) onto the equations
  let x = Float64Array.from(x0);
  for (let it = 0; it < 60; it++) {
    const { f, J } = jac(x); const m = f.length; if (!m) break;
    const res = Math.sqrt(f.reduce((s, v) => s + v * v, 0)); if (res < 1e-11) break;
    const A = Array.from({ length: m }, (_, i) => Array.from({ length: m }, (_, k) => { let s = 0; for (let j = 0; j < n; j++) s += J[i][j] * J[k][j]; return s + (i === k ? 1e-10 : 0); }));
    const y = solveSym(A, f.map((v) => -v)); for (let j = 0; j < n; j++) { let s = 0; for (let i = 0; i < m; i++) s += J[i][j] * y[i]; x[j] += s; }
  }
  const { f, J } = jac(x);
  const residual = Math.sqrt(f.reduce((s, v) => s + v * v, 0));
  return { unknowns: n, equations: f.length, rank: rankOf(J, n), dof: n - rankOf(J, n), residual };
}
function solveSym(A, b) { const m = b.length; const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < m; c++) { let p = c; for (let i = c + 1; i < m; i++) if (Math.abs(M[i][c]) > Math.abs(M[p][c])) p = i; [M[c], M[p]] = [M[p], M[c]]; const d = M[c][c]; if (Math.abs(d) < 1e-14) continue;
    for (let i = 0; i < m; i++) if (i !== c) { const fct = M[i][c] / d; for (let k = c; k <= m; k++) M[i][k] -= fct * M[c][k]; } }
  return M.map((row, i) => Math.abs(row[i]) < 1e-14 ? 0 : row[m] / row[i]); }
function rankOf(J, n) { // row-normalised modified Gram-Schmidt, the solver's own rank tolerance (engine.js _nullspace TOL 1e-7)
  const basis = []; let rank = 0;
  for (const row0 of J) { let v = Float64Array.from(row0); let s = Math.hypot(...v); if (s < 1e-9) continue; v = v.map((t) => t / s);
    for (const b of basis) { let d = 0; for (let i = 0; i < n; i++) d += v[i] * b[i]; for (let i = 0; i < n; i++) v[i] -= d * b[i]; }
    const nv = Math.hypot(...v); if (nv > 1e-6) { basis.push(v.map((t) => t / nv)); rank++; } }
  return rank; }

// Fusion's recording -> the model. Points: every curve end / centre, one point per distinct coordinate (Fusion SHARES a point where curves
// meet), plus the lone points; checked against the recorded point count.
export function fusionModel(rec) {
  const points = {}; const key = (p) => p[0].toFixed(3) + ',' + p[1].toFixed(3);
  const at = (p) => { const k = key(p); if (!points['p' + k]) points['p' + k] = [p[0], p[1]]; return 'p' + k; };
  const curves = rec.curves.map((c) => {
    const type = c.id.replace(/\d+$/, '').toLowerCase();
    if (type === 'line') return { id: c.id, type, s: at(c.s), e: at(c.e), construction: c.construction };
    if (type === 'arc') return { id: c.id, type, c: at(c.c), s: at(c.s), e: at(c.e), construction: c.construction };
    return { id: c.id, type: 'circle', c: at(c.c), r: c.rad, construction: c.construction };
  });
  for (const p of rec.lonePoints) at(p);
  const byId = new Map(curves.map((c) => [c.id, c]));
  const ref = (s) => { // 'Line4.start', 'Arc1.center', 'pt[42.0, 1.0]', 'Line0'
    let m = s.match(/^pt\[([-\d.]+), ([-\d.]+)\]$/); if (m) return { pt: at([+m[1], +m[2]]) };
    m = s.match(/^(\w+)\.(start|end|center)$/); if (m) { const c = byId.get(m[1]); return { pt: c[{ start: 's', end: 'e', center: 'c' }[m[2]]] }; }
    if (byId.has(s)) return { curve: s };
    throw new Error('fusion ref ' + s);
  };
  const cons = rec.constraints.map((k) => {
    const m = k.match(/^(\w+)\((.*)\)$/); const t = m[1]; const args = m[2] ? m[2].split(/,(?![^[]*\])/).map(ref) : [];
    const cur = [...new Set(args.filter((a) => a.curve).map((a) => a.curve))]; const pts = args.filter((a) => a.pt).map((a) => a.pt);
    switch (t) {
      case 'Horizontal': { const l = byId.get(cur[0]); return { t: 'H', pts: [l.s, l.e] }; }
      case 'Vertical': { const l = byId.get(cur[0]); return { t: 'V', pts: [l.s, l.e] }; }
      case 'Perpendicular': return { t: 'perp', curves: cur };
      case 'Parallel': return { t: 'par', curves: cur };
      case 'Tangent': return { t: 'tangent', curves: cur };
      case 'Coincident': return { t: 'onCurve', pts, curves: cur };
      case 'MidPoint': { const l = byId.get(cur[0]); return { t: 'mid', pts: [l.s, l.e, pts[0]] }; }
      case 'Polygon': return { t: 'polygon', pts: [at(rec.lonePoints[0])], curves: curves.filter((c) => c.type === 'line').map((c) => c.id) };
      default: throw new Error('fusion constraint ' + t);
    }
  });
  return { points, curves, cons, pointCount: Object.keys(points).length };
}
// Our state -> the model (every joint id its own point; a coincident is two equations, as our solver feeds it)
export function oursModel(app) {
  const st = app.state; const points = {};
  for (const [id, j] of st.joints) points[id] = [j.x, j.y];
  const curves = st.shapes.filter((s) => !s.textOutline).map((s) => s.type === 'line' ? { id: s.id, type: 'line', s: s.joints[0], e: s.joints[1] }
    : s.type === 'arc' ? { id: s.id, type: 'arc', c: s.joints[0], s: s.joints[1], e: s.joints[2] } : { id: s.id, type: 'circle', c: s.joints[0], r: s.radius });
  const byId = new Map(curves.map((c) => [c.id, c]));
  const cons = [];
  for (const c of st.constraints) {
    if (c.isDriven || c.driven) continue;
    switch (c.type) {
      case CONSTRAINT_TYPES.HORIZONTAL: cons.push({ t: 'H', pts: c.joints || [byId.get(c.shape).s, byId.get(c.shape).e] }); break;
      case CONSTRAINT_TYPES.VERTICAL: cons.push({ t: 'V', pts: c.joints || [byId.get(c.shape).s, byId.get(c.shape).e] }); break;
      case CONSTRAINT_TYPES.COINCIDENT: for (let i = 1; i < c.joints.length; i++) cons.push({ t: 'coincident', pts: [c.joints[0], c.joints[i]] }); break;
      case CONSTRAINT_TYPES.POINT_ON_LINE: cons.push({ t: 'onCurve', pts: [c.joint], curves: [c.shape] }); break;
      case CONSTRAINT_TYPES.MIDPOINT: cons.push(c.joints && c.joints.length === 3 ? { t: 'mid', pts: c.joints } : { t: 'mid', pts: [byId.get(c.shape).s, byId.get(c.shape).e, c.joint] }); break;
      case CONSTRAINT_TYPES.PERPENDICULAR: cons.push({ t: 'perp', curves: c.shapes }); break;
      case CONSTRAINT_TYPES.PARALLEL: cons.push({ t: 'par', curves: c.shapes }); break;
      case CONSTRAINT_TYPES.TANGENT: cons.push({ t: 'tangent', curves: c.shapes || [c.line, c.circle] }); break;
      case CONSTRAINT_TYPES.EQUAL: cons.push(c.joints && c.joints.length === 4 ? { t: 'equalLen', pts: c.joints } : { t: 'equalCurve', curves: c.shapes }); break;
      case CONSTRAINT_TYPES.DISTANCE: cons.push(c.shape && c.isRadius ? { t: 'radius', curves: [c.shape], v: c.isDiameter ? c.value / 2 : c.value } : { t: 'dist', pts: c.joints, v: c.value }); break;
      default: throw new Error('ours model: constraint ' + c.type);
    }
  }
  // a fixed joint (the origin, a locked point) is no unknown: two equations hold it where it is
  for (const [id, j] of st.joints) if (id === 'j_origin' || j.fixed) cons.push({ t: 'fix', pts: [id], at: [j.x, j.y] });
  return { points, curves, cons };
}

