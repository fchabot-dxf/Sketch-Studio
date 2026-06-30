// packages/core/svg-import.js — DECLARED SVG → #core-shape importer (IMPORT-2, a v1 subset). PURE (no DOM).
//
// The HOST (Shaper, has the DOM) extracts per-element DESCRIPTORS `{ tag, ...rawAttrs }` + the root width/height/
// viewBox; this module MAPS them → #core `joints` + `shapes`. The mapping is a DECLARED table (element → emitter),
// not a hand-rolled chain. Output is STATIC, UNCONSTRAINED geometry — we mint joints + plain shape objects DIRECTLY
// (never the constraint-adding factories in shapes.js), so a flattened path can't flood the GLOBAL solver. Béziers
// (C/Q) flatten via pure de Casteljau. The world is Y-DOWN (== SVG), so no Y-flip — only a mm scale.
//
// v1 subset: <line> <rect> <circle> <polyline> <polygon> <path>(M/L/H/V/C/Q/Z, abs+rel). FLAGGED-not-dropped:
// <ellipse>, <path> S/T/A (→ line-to-endpoint + a skip note), transforms, <g> (the host flags these). IMPORT-3 widens.

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

// parsePoints('0,0 10,0 10,10') → [{x,y}, …] (commas and/or whitespace separated).
export function parsePoints(str) {
  if (!str) return [];
  const nums = String(str).trim().split(/[\s,]+/).map(Number).filter((n) => isFinite(n));
  const pts = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
  return pts;
}

function flattenCubic(x0, y0, x1, y1, x2, y2, x3, y3, push) {
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

// parsePathSubpaths(d) → { subpaths: [{ pts:[{x,y}…], closed }], skipped: [{ reason, count }] }.
// Supports M/L/H/V/C/Q/Z (absolute + relative). S/T/A are FLAGGED + drawn as a line to their endpoint (keeps the
// path connected) — full smooth-curve / elliptical-arc handling is IMPORT-3.
export function parsePathSubpaths(d) {
  const subpaths = []; const skipped = [];
  const skip = (r) => { const e = skipped.find((s) => s.reason === r); if (e) e.count++; else skipped.push({ reason: r, count: 1 }); };
  if (!d) return { subpaths, skipped };
  const toks = String(d).match(/[a-zA-Z]|-?\.?\d[\d.]*(?:e-?\d+)?/gi) || [];
  let i = 0, cx = 0, cy = 0, startX = 0, startY = 0, cmd = '';
  let cur = null;
  const N = () => num(toks[i++]);
  const push = (x, y) => { if (cur) cur.pts.push({ x, y }); };
  const begin = (x, y) => { if (cur && cur.pts.length) subpaths.push(cur); cur = { pts: [{ x, y }], closed: false }; };
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) { cmd = toks[i]; i++; }
    if (!cmd) { i++; continue; }
    const rel = cmd === cmd.toLowerCase();
    switch (cmd.toUpperCase()) {
      case 'M': { let x = N(), y = N(); if (rel) { x += cx; y += cy; } cx = x; cy = y; startX = x; startY = y; begin(x, y); cmd = rel ? 'l' : 'L'; break; }
      case 'L': { let x = N(), y = N(); if (rel) { x += cx; y += cy; } cx = x; cy = y; push(x, y); break; }
      case 'H': { let x = N(); if (rel) x += cx; cx = x; push(x, cy); break; }
      case 'V': { let y = N(); if (rel) y += cy; cy = y; push(cx, y); break; }
      case 'C': { let x1 = N(), y1 = N(), x2 = N(), y2 = N(), x = N(), y = N(); if (rel) { x1 += cx; y1 += cy; x2 += cx; y2 += cy; x += cx; y += cy; } flattenCubic(cx, cy, x1, y1, x2, y2, x, y, push); cx = x; cy = y; break; }
      case 'Q': { let x1 = N(), y1 = N(), x = N(), y = N(); if (rel) { x1 += cx; y1 += cy; x += cx; y += cy; } flattenQuad(cx, cy, x1, y1, x, y, push); cx = x; cy = y; break; }
      case 'S': { N(); N(); let x = N(), y = N(); if (rel) { x += cx; y += cy; } push(x, y); cx = x; cy = y; skip('S (smooth cubic) → line'); break; }
      case 'T': { let x = N(), y = N(); if (rel) { x += cx; y += cy; } push(x, y); cx = x; cy = y; skip('T (smooth quad) → line'); break; }
      case 'A': { N(); N(); N(); N(); N(); let x = N(), y = N(); if (rel) { x += cx; y += cy; } push(x, y); cx = x; cy = y; skip('A (elliptical arc) → line'); break; }
      case 'Z': { if (cur) { cur.closed = true; subpaths.push(cur); cur = null; } cx = startX; cy = startY; break; }
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
  const J = (x, y) => { const id = genJ(); joints.push({ id, x: x * scale, y: y * scale }); return id; };
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
    switch (d.tag) {
      case 'line': { const a = J(num(d.x1), num(d.y1)), b = J(num(d.x2), num(d.y2)); shapes.push({ id: SID(), type: 'line', joints: [a, b] }); break; }
      case 'rect': {
        const x = num(d.x), y = num(d.y), w = num(d.width), h = num(d.height);
        if (d.rx || d.ry) bump('rect', 'rounded corners squared off');
        polyline([{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], true);
        break;
      }
      case 'circle': { const c = J(num(d.cx), num(d.cy)); shapes.push({ id: SID(), type: 'circle', joints: [c], radius: num(d.r) * scale }); break; }
      case 'polyline': polyline(parsePoints(d.points), false); break;
      case 'polygon': polyline(parsePoints(d.points), true); break;
      case 'path': { const { subpaths, skipped: sk } = parsePathSubpaths(d.d); for (const sp of subpaths) polyline(sp.pts, sp.closed); for (const r of sk) bump('path', r.reason, r.count); break; }
      case 'ellipse': bump('ellipse', 'not supported in v1'); break;
      default: bump(d.tag, 'element not supported in v1'); break;
    }
  }
  return { joints, shapes, stats: { shapeCount: shapes.length, jointCount: joints.length, skipped } };
}
