// packages/core/svg-import.js — DECLARED SVG → #core-shape importer (IMPORT-2, a v1 subset). PURE (no DOM).
//
// The HOST (Shaper, has the DOM) extracts per-element DESCRIPTORS `{ tag, ...rawAttrs }` + the root width/height/
// viewBox; this module MAPS them → #core `joints` + `shapes`. The mapping is a DECLARED table (element → emitter),
// not a hand-rolled chain. Output is STATIC, UNCONSTRAINED geometry — we mint joints + plain shape objects DIRECTLY
// (never the constraint-adding factories in shapes.js), so a flattened path can't flood the GLOBAL solver. Béziers
// (C/Q) flatten via pure de Casteljau. The world is Y-DOWN (== SVG), so no Y-flip — only a mm scale.
//
// Coverage: <line> <rect> <circle> <ellipse> <polyline> <polygon> <path>(M/L/H/V/C/Q/S/T/A/Z, abs+rel).
// IMPORT-2B-2: <ellipse> flattens to a closed polyline ring (#core has no ellipse shape) at the same curve density
// as the béziers. IMPORT-2B-3: S/T reflect the previous control point and A is a real sampled elliptical arc (all
// three were previously drawn as a straight CHORD). GRIEVANCE-2: group (g) nesting + a transform=
// attribute are now APPLIED: the host recurses the tree and threads a composed CTM (per element) into each
// descriptor; parseTransform / multiplyMatrix / applyMatrix below build + bake it. IMPORT-3 widens coverage.

const PHYS = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72 }; // physical units → mm
const PX_MM = 25.4 / 96;                                  // 1 CSS px → mm (SVG default, 96 dpi)
const FLATTEN_STEPS = 16;                                 // de Casteljau subdivision per bézier

function num(v) { const n = parseFloat(v); return isFinite(n) ? n : 0; }

// parseLength('100mm') → { value:100, unit:'mm' }; '50' → { value:50, unit:'' }; malformed → null.
export function parseLength(str) {
  if (str == null) return null;
  const m = String(str).trim().match(/^(-?\.?\d[\d.]*(?:e-?\d+)?)\s*([a-z%]*)$/i);
  if (!m) return null;
  const value = parseFloat(m[1]);
  if (!isFinite(value)) return null;
  return { value, unit: (m[2] || '').toLowerCase() };
}

function parseViewBox(vb) {
  if (!vb) return null;
  const p = String(vb).trim().split(/[\s,]+/).map(Number);
  if (p.length !== 4 || p.some((n) => !isFinite(n))) return null;
  return { minX: p[0], minY: p[1], w: p[2], h: p[3] };
}

function fmtScale(s) { return (Math.round(s * 1e4) / 1e4) + ' mm/unit'; }

// computeImportScale({ width, height, viewBox }) → { scale (mm per SVG user-unit), label, assumed }.
// Policy (documented + SURFACED, never a silent wrong scale):
//   • physical width (mm/cm/in/pt) + viewBox → widthMm / vbW          (exact; the CAD/laser case)
//   • viewBox, no physical width            → 1 mm/unit  (assumed)    (unitless export)
//   • no viewBox                            → 25.4/96 mm/unit (assumed; px @ 96 dpi, the SVG default)
export function computeImportScale({ width, height, viewBox } = {}) {
  const vb = parseViewBox(viewBox);
  const w = parseLength(width);
  const physical = w && PHYS[w.unit] != null;
  if (physical && vb && vb.w > 0) {
    const scale = (w.value * PHYS[w.unit]) / vb.w;
    return { scale, label: fmtScale(scale), assumed: false };
  }
  if (vb && vb.w > 0) return { scale: 1, label: '1 mm/unit', assumed: true };
  return { scale: PX_MM, label: fmtScale(PX_MM) + ' (96 dpi)', assumed: true };
}

// computeImportSize({ width, height, viewBox }) → { w, h (mm), scale, label, assumed } | null.
// The DOCUMENT EXTENT of the incoming SVG, in mm — for a host that sizes its paper from the import
// (IMPORT-DOC-SIZE). Derived from the SAME scale importSvgGeometry bakes into the coords, so the paper
// ALWAYS matches the geometry that landed on it (that invariant is the whole point of deriving rather
// than re-reading width/height independently):
//   • viewBox present  → (vbW, vbH) × scale                (covers physical-width + viewBox exactly)
//   • no viewBox       → width/height, physical units taken AS mm (per SVG: they size the viewport
//                        directly), unitless taken as user units × scale (= px @ 96 dpi)
// null when the size is unknowable (no viewBox and no usable width/height, or a % width) — the host
// then keeps its current doc size rather than guessing.
export function computeImportSize({ width, height, viewBox } = {}) {
  const { scale, label, assumed } = computeImportScale({ width, height, viewBox });
  const vb = parseViewBox(viewBox);
  if (vb && vb.w > 0 && vb.h > 0) return { w: vb.w * scale, h: vb.h * scale, scale, label, assumed };
  const w = parseLength(width), h = parseLength(height);
  if (!w || !h || !(w.value > 0) || !(h.value > 0)) return null;
  if (w.unit === '%' || h.unit === '%') return null; // relative to a viewport we don't have
  const mm = (L) => (PHYS[L.unit] != null ? L.value * PHYS[L.unit] : L.value * scale);
  return { w: mm(w), h: mm(h), scale, label, assumed };
}

// parsePoints('0,0 10,0 10,10') → [{x,y}, …] (commas and/or whitespace separated).
export function parsePoints(str) {
  if (!str) return [];
  const nums = String(str).trim().split(/[\s,]+/).map(Number).filter((n) => isFinite(n));
  const pts = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
  return pts;
}

export function flattenCubic(x0, y0, x1, y1, x2, y2, x3, y3, push) {
  for (let s = 1; s <= FLATTEN_STEPS; s++) {
    const t = s / FLATTEN_STEPS, u = 1 - t;
    push(u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
         u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3);
  }
}
function flattenQuad(x0, y0, x1, y1, x2, y2, push) {
  for (let s = 1; s <= FLATTEN_STEPS; s++) {
    const t = s / FLATTEN_STEPS, u = 1 - t;
    push(u * u * x0 + 2 * u * t * x1 + t * t * x2, u * u * y0 + 2 * u * t * y1 + t * t * y2);
  }
}

// arcSteps(sweep) — FLATTEN_STEPS per 90° of sweep. The SAME density de Casteljau gives one bézier quadrant, so an
// ellipse or an arc flattens at the resolution of the C/Q curves beside it (a full ring = 4 quadrants = 64 segments).
// One rule, so the pipeline never sees a mix of fine curves and coarse arcs.
function arcSteps(sweep) { return Math.max(2, Math.ceil(FLATTEN_STEPS * Math.abs(sweep) / (Math.PI / 2))); }

// ellipsePoints(cx, cy, rx, ry) → the sampled ring of an axis-aligned ellipse in SVG USER space; the caller's CTM
// then supplies any rotation/skew (so a rotated <ellipse transform="rotate(30)"> comes in rotated, not re-derived).
// No duplicate closing point — the caller closes the ring.
export function ellipsePoints(cx, cy, rx, ry) {
  const n = arcSteps(Math.PI * 2), pts = [];
  for (let k = 0; k < n; k++) {
    const t = (k / n) * Math.PI * 2;
    pts.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
  }
  return pts;
}

// flattenArc(x1,y1, rx,ry, rotDeg, fA,fS, x2,y2, push) → '' | a degeneracy reason.
// IMPORT-2B-3: a REAL SVG elliptical-arc segment (A/a). Endpoint → centre parameterization exactly per the SVG
// implementation notes (F.6.5 + the F.6.6 radius correction), then arcSteps() samples along the TRUE ellipse — so
// the result IS the arc, with neither the chord it used to draw nor the error of a cubic approximation. The two
// spec degeneracies are reported so a degraded import is never silent.
export function flattenArc(x1, y1, rx, ry, rotDeg, fA, fS, x2, y2, push) {
  if (x1 === x2 && y1 === y2) return 'A (arc) with coincident endpoints → omitted';  // spec: omit the segment
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (!(rx > 0) || !(ry > 0)) { push(x2, y2); return 'A (arc) with a zero radius → line'; } // spec: straight line
  const phi = (rotDeg || 0) * DEG, cosP = Math.cos(phi), sinP = Math.sin(phi);
  const hdx = (x1 - x2) / 2, hdy = (y1 - y2) / 2;
  const x1p = cosP * hdx + sinP * hdy, y1p = -sinP * hdx + cosP * hdy;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }   // F.6.6: grow radii that can't span the endpoints
  const rx2 = rx * rx, ry2 = ry * ry, px2 = x1p * x1p, py2 = y1p * y1p;
  const den = rx2 * py2 + ry2 * px2;
  const co = Math.sqrt(Math.max(0, (rx2 * ry2 - rx2 * py2 - ry2 * px2) / den)) * (fA === fS ? -1 : 1);
  const cxp = co * (rx * y1p / ry), cyp = co * (-ry * x1p / rx);
  const cx0 = cosP * cxp - sinP * cyp + (x1 + x2) / 2;
  const cy0 = sinP * cxp + cosP * cyp + (y1 + y2) / 2;
  const ang = (ax, ay, bx, by) => {                              // signed angle from (ax,ay) to (bx,by)
    const l = Math.hypot(ax, ay) * Math.hypot(bx, by);
    const a = Math.acos(Math.min(1, Math.max(-1, l ? (ax * bx + ay * by) / l : 0)));
    return (ax * by - ay * bx < 0) ? -a : a;
  };
  const ux = (x1p - cxp) / rx, uy = (y1p - cyp) / ry;
  const th1 = ang(1, 0, ux, uy);
  let dth = ang(ux, uy, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fS && dth > 0) dth -= 2 * Math.PI;                        // the sweep flag picks which of the two arcs
  else if (fS && dth < 0) dth += 2 * Math.PI;
  const n = arcSteps(dth);
  for (let s = 1; s <= n; s++) {
    const th = th1 + dth * (s / n), ct = Math.cos(th), st = Math.sin(th);
    push(cosP * rx * ct - sinP * ry * st + cx0, sinP * rx * ct + cosP * ry * st + cy0);
  }
  return '';
}

// parsePathSubpaths(d) → { subpaths: [{ pts:[{x,y}…], closed }], skipped: [{ reason, count }] }.
// Supports M/L/H/V/C/Q/S/T/A/Z (absolute + relative). IMPORT-2B-3: S/T reflect the previous control point and A is a
// real elliptical arc — all three used to be drawn as a straight CHORD to their endpoint.
export function parsePathSubpaths(d) {
  const subpaths = []; const skipped = [];
  const skip = (r) => { const e = skipped.find((s) => s.reason === r); if (e) e.count++; else skipped.push({ reason: r, count: 1 }); };
  if (!d) return { subpaths, skipped };
  const toks = String(d).match(/[a-zA-Z]|-?\.?\d[\d.]*(?:e-?\d+)?/gi) || [];
  let i = 0, cx = 0, cy = 0, startX = 0, startY = 0, cmd = '';
  let cur = null;
  // IMPORT-2B-3: the previous curve's TRAILING control point + which family it belonged to — what S and T reflect.
  // Any non-curve command clears pKind, which is exactly the spec's "if the previous command was not a C/S (Q/T),
  // the first control point is the current point".
  let pcx = 0, pcy = 0, pKind = '';
  const N = () => num(toks[i++]);
  // An arc's large-arc/sweep flags are single digits that MAY be GLUED to the number after them ("a1 1 0 011 1" =
  // flags 0,1 then x=1) — SVGO and Illustrator both emit that. The tokenizer sees "011" as ONE number, so read a
  // flag by taking its leading digit and leaving the remainder in place as the next number. ONLY the A branch uses
  // this, so M/L/H/V/C/Q/Z tokenize byte-for-byte as before.
  const FLAG = () => {
    const t = toks[i];
    if (t == null) { i++; return 0; }
    if (t.length > 1 && (t[0] === '0' || t[0] === '1')) { toks[i] = t.slice(1); return t[0] === '1' ? 1 : 0; }
    i++; return num(t) ? 1 : 0;
  };
  const push = (x, y) => { if (cur) cur.pts.push({ x, y }); };
  const begin = (x, y) => { if (cur && cur.pts.length) subpaths.push(cur); cur = { pts: [{ x, y }], closed: false }; };
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) { cmd = toks[i]; i++; }
    if (!cmd) { i++; continue; }
    const rel = cmd === cmd.toLowerCase();
    switch (cmd.toUpperCase()) {
      case 'M': { let x = N(), y = N(); if (rel) { x += cx; y += cy; } cx = x; cy = y; startX = x; startY = y; begin(x, y); cmd = rel ? 'l' : 'L'; pKind = ''; break; }
      case 'L': { let x = N(), y = N(); if (rel) { x += cx; y += cy; } cx = x; cy = y; push(x, y); pKind = ''; break; }
      case 'H': { let x = N(); if (rel) x += cx; cx = x; push(x, cy); pKind = ''; break; }
      case 'V': { let y = N(); if (rel) y += cy; cy = y; push(cx, y); pKind = ''; break; }
      case 'C': { let x1 = N(), y1 = N(), x2 = N(), y2 = N(), x = N(), y = N(); if (rel) { x1 += cx; y1 += cy; x2 += cx; y2 += cy; x += cx; y += cy; } flattenCubic(cx, cy, x1, y1, x2, y2, x, y, push); cx = x; cy = y; pcx = x2; pcy = y2; pKind = 'C'; break; }
      case 'Q': { let x1 = N(), y1 = N(), x = N(), y = N(); if (rel) { x1 += cx; y1 += cy; x += cx; y += cy; } flattenQuad(cx, cy, x1, y1, x, y, push); cx = x; cy = y; pcx = x1; pcy = y1; pKind = 'Q'; break; }
      // S = a cubic whose FIRST control point is the reflection of the previous cubic's SECOND control point about
      // the current point; after a non-cubic it collapses onto the current point (spec). Was: a chord.
      case 'S': {
        let x2 = N(), y2 = N(), x = N(), y = N(); if (rel) { x2 += cx; y2 += cy; x += cx; y += cy; }
        const x1 = pKind === 'C' ? 2 * cx - pcx : cx, y1 = pKind === 'C' ? 2 * cy - pcy : cy;
        flattenCubic(cx, cy, x1, y1, x2, y2, x, y, push); cx = x; cy = y; pcx = x2; pcy = y2; pKind = 'C'; break;
      }
      // T = a quad whose control point is the reflection of the previous quad's control point about the current point.
      case 'T': {
        let x = N(), y = N(); if (rel) { x += cx; y += cy; }
        const x1 = pKind === 'Q' ? 2 * cx - pcx : cx, y1 = pKind === 'Q' ? 2 * cy - pcy : cy;
        flattenQuad(cx, cy, x1, y1, x, y, push); cx = x; cy = y; pcx = x1; pcy = y1; pKind = 'Q'; break;
      }
      // A = a real elliptical arc (flattenArc). NOTE the flag reads: FLAG(), not N() — see FLAG above.
      case 'A': {
        const rx = N(), ry = N(), rot = N(), fA = FLAG(), fS = FLAG();
        let x = N(), y = N(); if (rel) { x += cx; y += cy; }
        const degraded = flattenArc(cx, cy, rx, ry, rot, fA, fS, x, y, push);
        if (degraded) skip(degraded);
        cx = x; cy = y; pKind = ''; break;
      }
      case 'Z': { if (cur) { cur.closed = true; subpaths.push(cur); cur = null; } cx = startX; cy = startY; pKind = ''; break; }
      default: i++; break;
    }
  }
  if (cur && cur.pts.length) subpaths.push(cur);
  return { subpaths, skipped };
}

// importSvgGeometry(descriptors, { genJ, scale, idPrefix }) → { joints:[{id,x,y}], shapes:[…], stats }.
// descriptors = the host's per-element extraction (raw attrs as strings):
//   { tag:'line', x1,y1,x2,y2 } | { tag:'rect', x,y,width,height,rx?,ry? } | { tag:'circle', cx,cy,r }
//   | { tag:'ellipse', … } | { tag:'polyline'|'polygon', points } | { tag:'path', d } | { tag:<other> }
// Returns STATIC geometry (NO constraints). Coords are scaled to world mm; ids minted via genJ (joints) + idPrefix.
export function importSvgGeometry(descriptors, { genJ, scale = 1, idPrefix = 'imp' } = {}) {
  const joints = [], shapes = [], skipped = [];
  let nShape = 0;
  const bump = (tag, reason, n = 1) => { const e = skipped.find((s) => s.tag === tag && s.reason === reason); if (e) e.count += n; else skipped.push({ tag, reason, count: n }); };
  let curCtm = IDENTITY_MATRIX; // the current descriptor's composed CTM (host-threaded); identity = untransformed
  // J mints a joint at (x,y) SVG user coords: apply the element's CTM (group + element transforms) THEN the mm
  // scale. Default identity CTM keeps the no-transform path byte-identical with the pre-GRIEVANCE-2 importer.
  const J = (x, y) => { const p = applyMatrix(curCtm, x, y); const id = genJ(); joints.push({ id, x: p.x * scale, y: p.y * scale }); return id; };
  const SID = () => idPrefix + '_s' + (nShape++);
  // a connected chain of line shapes through fresh joints; closed → also link last→first.
  const polyline = (pts, closed) => {
    if (!pts || pts.length < 2) return;
    const ids = pts.map((p) => J(p.x, p.y));
    for (let k = 0; k < ids.length - 1; k++) shapes.push({ id: SID(), type: 'line', joints: [ids[k], ids[k + 1]] });
    if (closed && ids.length > 2) shapes.push({ id: SID(), type: 'line', joints: [ids[ids.length - 1], ids[0]] });
  };

  for (const d of (descriptors || [])) {
    if (!d || !d.tag) continue;
    curCtm = d.ctm || IDENTITY_MATRIX; // GRIEVANCE-2: bake the host-composed group/element transform per descriptor
    switch (d.tag) {
      case 'line': { const a = J(num(d.x1), num(d.y1)), b = J(num(d.x2), num(d.y2)); shapes.push({ id: SID(), type: 'line', joints: [a, b] }); break; }
      case 'rect': {
        const x = num(d.x), y = num(d.y), w = num(d.width), h = num(d.height);
        if (d.rx || d.ry) bump('rect', 'rounded corners squared off');
        polyline([{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], true);
        break;
      }
      case 'circle': { const c = J(num(d.cx), num(d.cy)); shapes.push({ id: SID(), type: 'circle', joints: [c], radius: num(d.r) * scale * linearScaleOf(curCtm) }); break; }
      case 'polyline': polyline(parsePoints(d.points), false); break;
      case 'polygon': polyline(parsePoints(d.points), true); break;
      case 'path': { const { subpaths, skipped: sk } = parsePathSubpaths(d.d); for (const sp of subpaths) polyline(sp.pts, sp.closed); for (const r of sk) bump('path', r.reason, r.count); break; }
      // IMPORT-2B-2: <ellipse> → a closed polyline ring. #core has no ellipse SHAPE, so this is the audit's [R]
      // route: flatten at the pipeline's own curve density (arcSteps). SVG2 rx/ry="auto" = "use the other radius";
      // either radius still 0 means the browser does not render it either, so it is FLAGGED, not silently dropped.
      case 'ellipse': {
        let rx = num(d.rx), ry = num(d.ry);
        if (!(rx > 0) && ry > 0) rx = ry;
        if (!(ry > 0) && rx > 0) ry = rx;
        if (!(rx > 0) || !(ry > 0)) { bump('ellipse', 'zero radius (not rendered)'); break; }
        polyline(ellipsePoints(num(d.cx), num(d.cy), rx, ry), true);
        break;
      }
      default: bump(d.tag, 'element not supported in v1'); break;
    }
  }
  return { joints, shapes, stats: { shapeCount: shapes.length, jointCount: joints.length, skipped } };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// GRIEVANCE-2: SVG transform layer. An SVG affine transform is a 2x3 matrix [a,b,c,d,e,f] with
//   x' = a*x + c*y + e ,  y' = b*x + d*y + f .
// potrace/Illustrator/Inkscape exports nest ALL art inside a transformed group (e.g. the potrace idiom
// "translate(0,H) scale(0.1,-0.1)" = a 10x downscale + a Y-flip); the importer MUST parse+compose+apply
// it or the geometry lands 10x off and mirrored — or, with the group skipped, does not import at all.
// A matrix is DECLARED DATA: the host composes parent-then-child down the tree and hands each descriptor
// its CTM; importSvgGeometry bakes it (above). PURE — no DOM.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────

export const IDENTITY_MATRIX = [1, 0, 0, 1, 0, 0];

// multiplyMatrix(outer, inner) = outer*inner. A point maps as outer*(inner*p), so parent-then-child
// composition down the tree is multiplyMatrix(parentCTM, childTransform).
export function multiplyMatrix(m1, m2) {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

// applyMatrix(m, x, y) returns the transformed point { x, y }.
export function applyMatrix(m, x, y) {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

// linearScaleOf(m) returns the uniform linear scale factor sqrt(|det|) — for scaling a circle radius or a
// length. Exact for a uniform scale (potrace scale(0.1,-0.1): sqrt(0.01)=0.1); an approximation under a
// non-uniform scale or shear (a true ellipse is IMPORT-3).
export function linearScaleOf(m) {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

// parseTransform(str) returns the composed matrix for an SVG transform= attribute. Supports translate /
// scale / rotate / matrix / skewX / skewY; multiple primitives compose LEFT-to-RIGHT as written (SVG
// semantics). Empty/null gives identity; an unknown primitive is skipped (its geometry still imports).
const DEG = Math.PI / 180;
export function parseTransform(str) {
  let m = IDENTITY_MATRIX;
  if (!str) return m;
  const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let t;
  while ((t = re.exec(String(str)))) {
    const fn = t[1].toLowerCase();
    const n = t[2].trim().split(/[\s,]+/).map(Number).filter((v) => isFinite(v));
    let prim = null;
    switch (fn) {
      case 'translate': prim = [1, 0, 0, 1, n[0] || 0, n[1] || 0]; break;
      case 'scale': { const sx = n[0] != null ? n[0] : 1; const sy = n[1] != null ? n[1] : sx; prim = [sx, 0, 0, sy, 0, 0]; break; }
      case 'rotate': {
        const c = Math.cos((n[0] || 0) * DEG), s = Math.sin((n[0] || 0) * DEG);
        const rot = [c, s, -s, c, 0, 0];
        prim = (n[1] != null && n[2] != null)
          ? multiplyMatrix(multiplyMatrix([1, 0, 0, 1, n[1], n[2]], rot), [1, 0, 0, 1, -n[1], -n[2]])
          : rot;
        break;
      }
      case 'skewx': prim = [1, 0, Math.tan((n[0] || 0) * DEG), 1, 0, 0]; break;
      case 'skewy': prim = [1, Math.tan((n[0] || 0) * DEG), 0, 1, 0, 0]; break;
      case 'matrix': if (n.length === 6) prim = n.slice(0, 6); break;
      default: break;
    }
    if (prim) m = multiplyMatrix(m, prim);
  }
  return m;
}
