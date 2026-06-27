// Export manager: build SVG or DXF exports from sketch data (only lines & arcs)
import { CONSTRAINT_TYPES } from '#core/constants.js';
import SettingsManager from '#core/settings-manager.js';

function getJointPos(state, jid) {
  const j = state.joints.get(jid);
  return j ? { x: j.x, y: j.y } : null;
}

function formatNum(n, precision=6) { return Number(n).toFixed(precision); }

function sampleArcPoints(cx, cy, r, startAngle, endAngle, sweep, segments) {
  // Normalize sweep direction and compute total angle (CCW if sweep===true)
  let a0 = startAngle;
  let a1 = endAngle;
  // compute delta in range -PI..PI
  let delta = a1 - a0;
  while (delta <= -Math.PI) delta += Math.PI * 2;
  while (delta > Math.PI) delta -= Math.PI * 2;

  let total = delta;
  if (sweep && total < 0) total += Math.PI * 2;
  if (!sweep && total > 0) total -= Math.PI * 2;
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const ang = a0 + total * t;
    pts.push({ x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) });
  }
  return pts;
}

export function buildSVG(state, opts = {}) {
  const precision = (typeof opts.precision === 'number') ? opts.precision : 6;
  const scale = (typeof opts.scale === 'number') ? opts.scale : 1;
  const invertY = !!opts.invertY;
  const arcApprox = !!opts.arcApprox;
  const arcSeg = parseInt(opts.arcSeg || 32, 10) || 32;
  const lineCap = opts.lineCap || SettingsManager.get('LINE_CAP') || 'round';
  const lineJoin = opts.lineJoin || SettingsManager.get('LINE_JOIN') || 'round';
  const closeTolerance = (typeof opts.tolerance === 'number') ? opts.tolerance : 1e-6;

  const shapes = state.shapes.filter(s => s && (s.type === 'line' || s.type === 'arc'));
  if (shapes.length === 0) return null;

  // Compute bounds
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const elems = [];

  const transform = (p) => {
    let x = p.x * scale;
    let y = p.y * scale;
    if (invertY) y = -y;
    return { x, y };
  };

  // Build mapping of joint positions and cluster by coordinate to handle double joints
  const coordKey = (p) => `${p.x.toFixed(6)},${p.y.toFixed(6)}`;
  const jointPos = new Map();
  for (const [jid, j] of state.joints) jointPos.set(jid, { x: j.x, y: j.y, key: coordKey(j) });

  // Build adjacency of coordinate keys for line segments
  const lineShapes = shapes.filter(s => s.type === 'line');
  const coordAdj = new Map();
  const edgeToLines = new Map();
  for (const s of lineShapes) {
    const a = jointPos.get(s.joints[0]);
    const b = jointPos.get(s.joints[1]);
    if (!a || !b) continue;
    const ka = a.key, kb = b.key;
    if (!coordAdj.has(ka)) coordAdj.set(ka, new Set());
    if (!coordAdj.has(kb)) coordAdj.set(kb, new Set());
    coordAdj.get(ka).add(kb); coordAdj.get(kb).add(ka);
    const pair = (ka < kb) ? `${ka}|${kb}` : `${kb}|${ka}`;
    if (!edgeToLines.has(pair)) edgeToLines.set(pair, []);
    edgeToLines.get(pair).push(s);
  }

  // Detect simple cycles (all nodes degree==2, nodeCount>=3) and emit polygons
  const emittedEdgePairs = new Set();
  const emitPolygonFromCycle = (cycleKeys) => {
    const pts = cycleKeys.map(k => { const [x,y] = k.split(','); return { x: Number(x) * scale, y: Number(y) * scale }; });
    const pointsAttr = pts.map(p => `${formatNum(p.x, precision)},${formatNum(p.y, precision)}`).join(' ');
    const lineStroke = (typeof opts.strokeWidth === 'number') ? opts.strokeWidth : (Number(SettingsManager.get('LINE_STROKE')) || 1);
    // Update bounds from polygon points
    for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
    elems.push(`<polygon points="${pointsAttr}" stroke="black" stroke-width="${formatNum(lineStroke, precision)}" stroke-linecap="${lineCap}" stroke-linejoin="${lineJoin}" fill="none" />`);
  };

  const visited = new Set();
  for (const [key, neighbors] of coordAdj.entries()) {
    if (visited.has(key)) continue;
    // collect component
    const comp = new Set(); const q = [key]; comp.add(key);
    while (q.length) {
      const cur = q.shift();
      for (const n of coordAdj.get(cur) || []) { if (!comp.has(n)) { comp.add(n); q.push(n); } }
    }

    // check simple cycle
    let allDeg2 = true; let nodeCount = 0;
    for (const k of comp) { nodeCount++; if ((coordAdj.get(k) || new Set()).size !== 2) { allDeg2 = false; break; } }
    if (allDeg2 && nodeCount >= 3) {
      // walk cycle
      const cycle = []; let start = comp.values().next().value; let prev = null; let cur = start;
      do {
        cycle.push(cur); visited.add(cur);
        const nbrs = Array.from(coordAdj.get(cur));
        const next = (nbrs[0] === prev) ? nbrs[1] : nbrs[0];
        // mark edge
        const pair = (cur < next) ? `${cur}|${next}` : `${next}|${cur}`;
        emittedEdgePairs.add(pair);
        prev = cur; cur = next;
      } while (cur !== start && cycle.length <= comp.size + 2);

      if (cur === start) {
        emitPolygonFromCycle(cycle);
        continue;
      }
    }

    for (const k of comp) visited.add(k);
  }

  // Emit remaining lines and arcs (skip edges part of emitted polygons)
  for (const s of shapes) {
    if (s.type === 'line') {
      const a0 = getJointPos(state, s.joints[0]);
      const b0 = getJointPos(state, s.joints[1]);
      if (!a0 || !b0) continue;
      const ka = coordKey(a0), kb = coordKey(b0);
      const pair = (ka < kb) ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (emittedEdgePairs.has(pair)) continue; // already emitted as polygon edge

      const a = transform(a0); const b = transform(b0);
      minX = Math.min(minX, a.x, b.x); minY = Math.min(minY, a.y, b.y);
      maxX = Math.max(maxX, a.x, b.x); maxY = Math.max(maxY, a.y, b.y);
      const lineStroke = (typeof opts.strokeWidth === 'number') ? opts.strokeWidth : (Number(SettingsManager.get('LINE_STROKE')) || 1);
      elems.push(`<line x1="${formatNum(a.x, precision)}" y1="${formatNum(a.y, precision)}" x2="${formatNum(b.x, precision)}" y2="${formatNum(b.y, precision)}" stroke="black" stroke-width="${formatNum(lineStroke, precision)}" stroke-linecap="${lineCap}" stroke-linejoin="${lineJoin}" fill="none" />`);
    } else if (s.type === 'arc') {
      const c0 = getJointPos(state, s.joints[0]);
      const st0 = getJointPos(state, s.joints[1]);
      const en0 = getJointPos(state, s.joints[2]);
      if (!c0 || !st0 || !en0) continue;
      const r0 = Math.hypot(st0.x - c0.x, st0.y - c0.y);
      const startAngle = Math.atan2(st0.y - c0.y, st0.x - c0.x);
      const endAngle = Math.atan2(en0.y - c0.y, en0.x - c0.x);
      const largeArc = !!s.largeArc; const sweep = !!s.sweep;

      // Transform center and radius
      const center = transform(c0);
      const r = r0 * scale;
      minX = Math.min(minX, center.x - r); minY = Math.min(minY, center.y - r);
      maxX = Math.max(maxX, center.x + r); maxY = Math.max(maxY, center.y + r);

      if (arcApprox) {
        const pts = sampleArcPoints(c0.x, c0.y, r0, startAngle, endAngle, sweep, arcSeg).map(p => transform(p));
        const pointsAttr = pts.map(p => `${formatNum(p.x, precision)},${formatNum(p.y, precision)}`).join(' ');
        const lineStroke = (typeof opts.strokeWidth === 'number') ? opts.strokeWidth : (Number(SettingsManager.get('LINE_STROKE')) || 1);
        elems.push(`<polyline points="${pointsAttr}" stroke="black" stroke-width="${formatNum(lineStroke, precision)}" stroke-linecap="${lineCap}" stroke-linejoin="${lineJoin}" fill="none" />`);
      } else {
        const startX = center.x + r * Math.cos(startAngle);
        const startY = center.y + r * Math.sin(startAngle);
        const endX = center.x + r * Math.cos(endAngle);
        const endY = center.y + r * Math.sin(endAngle);
        const la = largeArc ? 1 : 0;
        const sw = sweep ? 1 : 0;
        const lineStroke = (typeof opts.strokeWidth === 'number') ? opts.strokeWidth : (Number(SettingsManager.get('LINE_STROKE')) || 1);
        elems.push(`<path d="M ${formatNum(startX, precision)} ${formatNum(startY, precision)} A ${formatNum(r, precision)} ${formatNum(r, precision)} 0 ${la} ${sw} ${formatNum(endX, precision)} ${formatNum(endY, precision)}" stroke="black" stroke-width="${formatNum(lineStroke, precision)}" stroke-linecap="${lineCap}" stroke-linejoin="${lineJoin}" fill="none" />`);
      }
    }
  }

  // Default viewBox padding
  if (minX === Infinity) return null;
  const pad = Math.max((maxX - minX), (maxY - minY)) * 0.05 || 10;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const width = maxX - minX, height = maxY - minY;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="${formatNum(minX, precision)} ${formatNum(minY, precision)} ${formatNum(width, precision)} ${formatNum(height, precision)}">\n  <g fill="none" stroke="black">\n    ${elems.join('\n    ')}\n  </g>\n</svg>`;
  return svg;
}

function deg(v) { return (v * 180 / Math.PI); }

export function buildDXF(state, opts = {}) {
  const precision = (typeof opts.precision === 'number') ? opts.precision : 6;
  const scale = (typeof opts.scale === 'number') ? opts.scale : 1;
  const invertY = !!opts.invertY;
  const arcApprox = !!opts.arcApprox;
  const arcSeg = parseInt(opts.arcSeg || 32, 10) || 32;

  const shapes = state.shapes.filter(s => s && (s.type === 'line' || s.type === 'arc'));
  if (shapes.length === 0) return null;

  const to = (p) => {
    let x = p.x * scale; let y = p.y * scale; if (invertY) y = -y; return { x, y };
  };

  const lines = [];
  lines.push('0','SECTION','2','ENTITIES');
  for (const s of shapes) {
    if (s.type === 'line') {
      const a0 = getJointPos(state, s.joints[0]);
      const b0 = getJointPos(state, s.joints[1]);
      if (!a0 || !b0) continue;
      const a = to(a0); const b = to(b0);
      lines.push('0','LINE','8','0','10',formatNum(a.x, precision),'20',formatNum(a.y, precision),'11',formatNum(b.x, precision),'21',formatNum(b.y, precision));
    } else if (s.type === 'arc') {
      const c0 = getJointPos(state, s.joints[0]);
      const st0 = getJointPos(state, s.joints[1]);
      const en0 = getJointPos(state, s.joints[2]);
      if (!c0 || !st0 || !en0) continue;
      const r0 = Math.hypot(st0.x - c0.x, st0.y - c0.y);
      let startAngle = deg(Math.atan2(st0.y - c0.y, st0.x - c0.x));
      let endAngle = deg(Math.atan2(en0.y - c0.y, en0.x - c0.x));
      if (startAngle < 0) startAngle += 360; if (endAngle < 0) endAngle += 360;
      if (s.sweep === false) { const tmp = startAngle; startAngle = endAngle; endAngle = tmp; }

      if (arcApprox) {
        // approximate arc using line segments
        const pts = sampleArcPoints(c0.x, c0.y, r0, startAngle * Math.PI/180, endAngle * Math.PI/180, s.sweep, arcSeg).map(p => to(p));
        for (let i = 0; i < pts.length - 1; i++) {
          const p1 = pts[i], p2 = pts[i+1];
          lines.push('0','LINE','8','0','10',formatNum(p1.x, precision),'20',formatNum(p1.y, precision),'11',formatNum(p2.x, precision),'21',formatNum(p2.y, precision));
        }
      } else {
        const c = to(c0); const r = r0 * scale;
        lines.push('0','ARC','8','0','10',formatNum(c.x, precision),'20',formatNum(c.y, precision),'40',formatNum(r, precision),'50',formatNum(startAngle, precision),'51',formatNum(endAngle, precision));
      }
    }
  }
  lines.push('0','ENDSEC','0','EOF');
  return lines.join('\r\n');
}

export function downloadFile(content, filename, mime) {
  const blob = new Blob([content], { type: mime || 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); try{ a.remove(); }catch(_){} }, 1000);
}

export function exportToFile(state, filename, filetype, opts = {}) {
  if (!filename) filename = 'sketch';
  if (filetype === 'svg') {
    const svg = buildSVG(state, opts);
    if (!svg) return { ok: false, reason: 'No line/arc shapes to export' };
    downloadFile(svg, filename + '.svg', 'image/svg+xml');
    return { ok: true };
  } else if (filetype === 'dxf') {
    const dxf = buildDXF(state, opts);
    if (!dxf) return { ok: false, reason: 'No line/arc shapes to export' };
    downloadFile(dxf, filename + '.dxf', 'application/dxf');
    return { ok: true };
  }
  return { ok: false, reason: 'Unknown filetype' };
}
