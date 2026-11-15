// packages/ui/template-picker.js -- TASK 651 / 668: the ONE modal that starts a new design: a grid of cards (a "Blank design" card first, then the bank of
// template drawings declared in #core/templates.js), each with a crisp PREVIEW drawn as SVG from the template's own document (its geometry and its
// dimensions, not an image). One click/tap on any card opens it as a new design. The "+" tab button, the menu's "New design" and "Templates..."
// all open THIS same modal with Blank first (one picker configuration, not two).
// TASK 670: a press on a TEMPLATE card turns the same modal into a small START view (one view for every template, built from its declared
// params): each param prefilled with its default (label + value + unit; a count as a whole-number spinner; a CHOICE as a glyph picker,
// template-glyphs.js), a live preview, Cancel and Open (Enter). Open right away = the defaults. The lengths / angles typed here become the
// document's live user parameters (#core/templates.js buildTemplate); counts and choices are chosen here because they cannot change after
// opening. Cancel / Esc go back to the cards. Blank design opens at once. Phones: the start view is a small card that fits 390 px.
//   openTemplatePicker() -> Promise of { blank: true } | { template, document, name } | null (Esc, a press outside, the X: no new design)
// Phones: full-screen, two cards per row. Esc / an outside press (outside-press.js) / the X close it; focus goes back to where it was.

import { TEMPLATES, buildTemplate, paramKind, paramUnit, paramRefusal, defaultParams } from '#core/templates.js';
import { GLYPHS } from './template-glyphs.js';
import { calculateArcPath, arcSweepInfo, angleInArcSweep } from '#core/geometry.js';
import { listenOutsidePress } from './outside-press.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, text) => {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
};
const fmt = (n) => String(Math.round(n * 100) / 100);
const boxesOverlap = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

// ── the preview: a version-3 document -> an <svg> (world coordinates, Y down as stored; non-scaling strokes keep it crisp at any size) ──
export function renderTemplatePreview(document_, { labels = true } = {}) {
  const g = document_.geometry;
  const J = new Map(g.joints.map(([id, j]) => [id, j]));
  const shapes = g.shapes;
  const dims = g.constraints.filter((c) => c.type === 'distance' && !c.isDriven && !c.driven);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const solidPts = [], solidCurves = [];
  const grow = (x, y) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); };
  for (const s of shapes) {
    if (s.isConstruction) continue;
    if (s.type === 'line') {
      for (const id of s.joints) { const p = J.get(id); grow(p.x, p.y); solidPts.push(p); }
    } else if (s.type === 'circle') {
      const c = J.get(s.joints[0]); grow(c.x - s.radius, c.y - s.radius); grow(c.x + s.radius, c.y + s.radius);
      solidCurves.push({ x: c.x, y: c.y, r: s.radius, info: null });
    } else if (s.type === 'arc') {
      const [c, a, b] = s.joints.map((id) => J.get(id)), r = Math.hypot(a.x - c.x, a.y - c.y);
      grow(a.x, a.y); grow(b.x, b.y); solidPts.push(a, b);
      const info = arcSweepInfo(c, a, b, { sweep: s.sweep });
      solidCurves.push({ x: c.x, y: c.y, r, info });
      for (const ang of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) if (angleInArcSweep(info, ang)) grow(c.x + r * Math.cos(ang), c.y + r * Math.sin(ang));
    }
  }
  const W = x1 - x0, H = y1 - y0, size = Math.max(W, H, 1), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const gap = size * 0.095, fs = size * 0.072, laneStep = fs * 1.8;
  // Exact convex-hull extent of the solid drawing along unit vector (ux, uy): every dimension line and label is placed outside this extent.
  const maxProj = (ux, uy) => {
    let m = -Infinity;
    for (const p of solidPts) m = Math.max(m, p.x * ux + p.y * uy);
    const ang = Math.atan2(uy, ux);
    for (const c of solidCurves) if (c.info == null || angleInArcSweep(c.info, ang)) m = Math.max(m, c.x * ux + c.y * uy + c.r);
    return m;
  };
  const svg = el('svg', { class: 'sk-tp-svg', role: 'img', preserveAspectRatio: 'xMidYMid meet' });
  const body = el('g', { fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' });
  const stroke = (n, dash) => { n.setAttribute('vector-effect', 'non-scaling-stroke'); if (dash) { n.setAttribute('stroke-dasharray', '4 3'); n.setAttribute('stroke-width', 1); n.setAttribute('opacity', '0.45'); } return n; };
  for (const s of shapes) {
    const dash = !!s.isConstruction;
    if (s.type === 'line') { const [a, b] = s.joints.map((id) => J.get(id)); body.appendChild(stroke(el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y }), dash)); }
    else if (s.type === 'circle') { const c = J.get(s.joints[0]); body.appendChild(stroke(el('circle', { cx: c.x, cy: c.y, r: s.radius }), dash)); }
    else if (s.type === 'arc') { const [c, a, b] = s.joints.map((id) => J.get(id)); body.appendChild(stroke(el('path', { d: calculateArcPath(c, a, b, 'CENTER', { sweep: s.sweep }) }), dash)); }
  }
  svg.appendChild(body);
  // Dimensions: ONE rule for every card — dimension lines sit outside the solid drawing (never through it), ordered into non-overlapping lanes/angles
  // checked against all already-placed label rects.
  let bx0 = x0, by0 = y0, bx1 = x1, by1 = y1;
  const frame = (x, y, hw = 0, hh = 0) => { bx0 = Math.min(bx0, x - hw); bx1 = Math.max(bx1, x + hw); by0 = Math.min(by0, y - hh); by1 = Math.max(by1, y + hh); };
  if (labels) {
    const dg = el('g', { fill: 'none', stroke: 'currentColor', 'stroke-width': 1, opacity: 0.75 });
    const placed = []; // bounding boxes of placed labels (plus a small margin)
    const labelBox = (x, y, t, anchor = 'middle', margin = fs * 0.15) => {
      const w = String(t).length * fs * 0.64 + margin * 2, h = fs * 1.15 + margin * 2;
      const lx0 = anchor === 'start' ? x - margin : anchor === 'end' ? x - w + margin : x - w / 2;
      return { x0: lx0, y0: y - h / 2, x1: lx0 + w, y1: y + h / 2 };
    };
    const clearOfPlaced = (box) => !placed.some((p) => boxesOverlap(p, box));
    const text = (x, y, t, anchor = 'middle') => {
      const box = labelBox(x, y, t, anchor, 0);
      placed.push(labelBox(x, y, t, anchor));
      frame((box.x0 + box.x1) / 2, y, (box.x1 - box.x0) / 2, (box.y1 - box.y0) / 2);
      dg.appendChild(el('text', { x, y, 'font-size': fs, fill: 'currentColor', stroke: 'none', 'text-anchor': anchor, 'dominant-baseline': 'middle', 'font-family': 'system-ui, sans-serif', 'font-weight': 600 }, t));
    };
    const seg = (ax, ay, bx, by) => { frame(ax, ay); frame(bx, by); return dg.appendChild(stroke(el('line', { x1: ax, y1: ay, x2: bx, y2: by }))); };
    const lineMid = (id) => { const s = shapes.find((x) => x.id === id), p = J.get(s.joints[0]), q = J.get(s.joints[1]); return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }; };

    // Classify dims: axis-aligned ('top'|'bottom'|'left'|'right'), 'aligned', or 'radius'
    const axisGroups = { top: [], bottom: [], left: [], right: [] };
    const alignedDims = [], radiusDims = [];
    for (const c of dims) {
      if (c.isRadius) { radiusDims.push(c); continue; }
      const [a, b] = c.shapes ? [lineMid(c.shapes[0]), lineMid(c.shapes[1])] : [J.get(c.joints[0]), J.get(c.joints[1])];
      const mode = c.shapes
        ? (Math.abs(a.x - b.x) < 1e-6 ? 'vertical' : Math.abs(a.y - b.y) < 1e-6 ? 'horizontal' : 'aligned')
        : (c.dimMode || 'aligned');
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (mode === 'horizontal') {
        const side = my >= cy ? 'bottom' : 'top';
        axisGroups[side].push({ c, a, b, u0: Math.min(a.x, b.x), u1: Math.max(a.x, b.x) });
      } else if (mode === 'vertical') {
        const side = mx >= cx ? 'right' : 'left';
        axisGroups[side].push({ c, a, b, u0: Math.min(a.y, b.y), u1: Math.max(a.y, b.y) });
      } else {
        alignedDims.push({ c, a, b });
      }
    }

    // 1. Axis-aligned dimensions: shorter spans on inner lanes so extension lines don't cross outer dim lines
    for (const [side, items] of Object.entries(axisGroups)) {
      items.sort((p, q) => (p.u1 - p.u0) - (q.u1 - q.u0));
      const lanes = [];
      const horiz = side === 'top' || side === 'bottom';
      const dir = side === 'bottom' || side === 'right' ? 1 : -1;
      const sideBase = horiz ? (dir > 0 ? y1 : y0) : (dir > 0 ? x1 : x0);
      for (const { c, a, b, u0, u1 } of items) {
        const spanPad = fs * 0.4;
        const t = fmt(c.value);
        let lane = 0;
        let pos, tx, ty, anchor;
        for (; ; lane++) {
          const info = lanes[lane] || { pos: lane === 0 ? sideBase + dir * gap : lanes[lane - 1].nextPos, spans: [], nextPos: null };
          const spanFree = !info.spans.some(([s0, s1]) => u0 - spanPad < s1 && u1 + spanPad > s0);
          pos = info.pos;
          if (horiz) {
            tx = (a.x + b.x) / 2; ty = pos + dir * fs * 0.8; anchor = 'middle';
          } else {
            tx = pos + dir * fs * 0.4; ty = (a.y + b.y) / 2; anchor = dir > 0 ? 'start' : 'end';
          }
          if (spanFree && clearOfPlaced(labelBox(tx, ty, t, anchor))) {
            const box = labelBox(tx, ty, t, anchor, 0);
            const far = horiz ? (dir > 0 ? box.y1 : box.y0) : (dir > 0 ? box.x1 : box.x0);
            const minNext = pos + dir * laneStep;
            const labelNext = far + dir * fs * 0.55;
            info.spans.push([u0, u1]);
            const candidateNext = dir > 0 ? Math.max(minNext, labelNext) : Math.min(minNext, labelNext);
            info.nextPos = info.nextPos == null ? candidateNext : (dir > 0 ? Math.max(info.nextPos, candidateNext) : Math.min(info.nextPos, candidateNext));
            lanes[lane] = info;
            break;
          }
          if (!lanes[lane]) {
            info.nextPos = pos + dir * laneStep;
            lanes[lane] = info;
          }
        }
        if (horiz) {
          seg(a.x, a.y, a.x, pos); seg(b.x, b.y, b.x, pos); seg(a.x, pos, b.x, pos);
          placed.push({ x0: Math.min(a.x, b.x), y0: pos - fs * 0.2, x1: Math.max(a.x, b.x), y1: pos + fs * 0.2 });
        } else {
          seg(a.x, a.y, pos, a.y); seg(b.x, b.y, pos, b.y); seg(pos, a.y, pos, b.y);
          placed.push({ x0: pos - fs * 0.2, y0: Math.min(a.y, b.y), x1: pos + fs * 0.2, y1: Math.max(a.y, b.y) });
        }
        text(tx, ty, t, anchor);
      }
    }

    // 2. Aligned dimensions: offset along outward normal strictly past the solid convex hull
    for (const { c, a, b } of alignedDims) {
      const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      let nx = -dy / l, ny = dx / l;
      if ((mx - cx) * nx + (my - cy) * ny < 0) { nx = -nx; ny = -ny; }
      const t = fmt(c.value);
      const minA = Math.min(a.x * nx + a.y * ny, b.x * nx + b.y * ny);
      let d = Math.max(gap, maxProj(nx, ny) - minA + gap * 0.9);
      const w = String(t).length * fs * 0.64, h = fs * 1.15;
      const textOff = 0.5 * (w * Math.abs(nx) + h * Math.abs(ny)) + fs * 0.3;
      let tx, ty;
      for (let k = 0; k < 8; k++) {
        tx = mx + nx * (d + textOff); ty = my + ny * (d + textOff);
        if (clearOfPlaced(labelBox(tx, ty, t, 'middle'))) break;
        d += laneStep;
      }
      seg(a.x, a.y, a.x + nx * d, a.y + ny * d); seg(b.x, b.y, b.x + nx * d, b.y + ny * d);
      seg(a.x + nx * d, a.y + ny * d, b.x + nx * d, b.y + ny * d);
      text(tx, ty, t, 'middle');
    }

    // 3. Radius leaders: outward angle past the solid convex hull, avoiding placed labels and dim lines
    for (const c of radiusDims) {
      const sh = shapes.find((s) => s.id === c.shape), cc = J.get(sh.joints[0]);
      const r = sh.type === 'circle' ? sh.radius : Math.hypot(J.get(sh.joints[1]).x - cc.x, J.get(sh.joints[1]).y - cc.y);
      const t = 'R' + fmt(c.value);
      const candidates = [];
      if (sh.type === 'arc') {
        const info = arcSweepInfo(cc, J.get(sh.joints[1]), J.get(sh.joints[2]), { sweep: sh.sweep });
        const mid = info.startAngle + info.delta / 2;
        for (const a of [mid, -Math.PI / 4, -3 * Math.PI / 4, 3 * Math.PI / 4, Math.PI / 4]) {
          if (angleInArcSweep(info, a)) candidates.push(a);
        }
        candidates.push(-Math.PI / 4, -3 * Math.PI / 4, Math.PI / 4, 3 * Math.PI / 4);
      } else {
        const distFromCenter = Math.hypot(cc.x - cx, cc.y - cy);
        if (distFromCenter > size * 0.05) {
          const base = Math.atan2(cc.y - cy, cc.x - cx);
          candidates.push(base, base - Math.PI / 4, base + Math.PI / 4, base - Math.PI / 2, base + Math.PI / 2);
        }
        candidates.push(-Math.PI / 4, -3 * Math.PI / 4, 3 * Math.PI / 4, Math.PI / 4, -Math.PI / 2, Math.PI / 2);
      }
      let chosen = null;
      outer: for (let step = 0; step < 4; step++) {
        for (const ang of candidates) {
          const ux = Math.cos(ang), uy = Math.sin(ang);
          const outDist = Math.max(r + fs * 1.15, maxProj(ux, uy) - (cc.x * ux + cc.y * uy) + gap * 0.85) + step * laneStep;
          const ox = cc.x + outDist * ux, oy = cc.y + outDist * uy;
          const anchor = Math.abs(ux) < 0.25 ? 'middle' : (ux > 0 ? 'start' : 'end');
          const tx = ox + (anchor === 'middle' ? 0 : ux > 0 ? fs * 0.3 : -fs * 0.3);
          const ty = oy + (uy >= 0 ? fs * 0.75 : -fs * 0.75);
          if (clearOfPlaced(labelBox(tx, ty, t, anchor))) {
            chosen = { ang, ox, oy, tx, ty, anchor, ux, uy };
            break outer;
          }
        }
      }
      if (!chosen) {
        const ang = candidates[0], ux = Math.cos(ang), uy = Math.sin(ang);
        const outDist = Math.max(r + fs * 1.15, maxProj(ux, uy) - (cc.x * ux + cc.y * uy) + gap * 0.85);
        const ox = cc.x + outDist * ux, oy = cc.y + outDist * uy;
        const anchor = Math.abs(ux) < 0.25 ? 'middle' : (ux > 0 ? 'start' : 'end');
        chosen = { ang, ox, oy, tx: ox + (anchor === 'middle' ? 0 : ux > 0 ? fs * 0.3 : -fs * 0.3), ty: oy + (uy >= 0 ? fs * 0.75 : -fs * 0.75), anchor, ux, uy };
      }
      const px = cc.x + r * chosen.ux, py = cc.y + r * chosen.uy;
      seg(cc.x, cc.y, px, py); seg(px, py, chosen.ox, chosen.oy);
      text(chosen.tx, chosen.ty, t, chosen.anchor);
    }
    svg.appendChild(dg);
  }
  const pad = size * 0.06;
  svg.setAttribute('viewBox', `${fmt(bx0 - pad)} ${fmt(by0 - pad)} ${fmt(bx1 - bx0 + 2 * pad)} ${fmt(by1 - by0 + 2 * pad)}`);
  return svg;
}

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined' || !document.head) return;
  if (document.getElementById('sk-tp-styles')) { stylesInjected = true; return; }
  const s = document.createElement('style'); s.id = 'sk-tp-styles';
  s.textContent = `
.sk-tp-backdrop { position: fixed; inset: 0; z-index: 9700; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; }
.sk-tp { position: relative; width: min(1000px, 94vw); height: min(720px, 92vh); box-sizing: border-box; display: flex; flex-direction: column; overflow: hidden;
  background: var(--sk-sidebar-bg, var(--sk-header-bg, #fff)); color: var(--sk-sidebar-fg, var(--sk-header-fg, #1e293b));
  font: 14px system-ui, sans-serif; border-radius: 10px; box-shadow: 0 10px 40px rgba(0,0,0,0.5); }
.sk-tp * { box-sizing: border-box; }
.sk-tp-head { display: flex; align-items: center; gap: 10px; padding: 12px 14px 8px; }
.sk-tp-title { font-size: 17px; font-weight: 600; margin: 0; flex: 1; }
.sk-tp-x { background: transparent; color: inherit; border: 0; cursor: pointer; font: inherit; padding: 4px 10px; border-radius: 6px; font-size: 22px; line-height: 1; }
.sk-tp-x:hover { background: var(--sk-sidebar-hover, rgba(127,127,127,0.18)); }
.sk-tp-body { flex: 1; min-height: 0; overflow: auto; padding: 4px 14px 16px; }
.sk-tp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 12px; }
.sk-tp-card { display: flex; flex-direction: column; gap: 6px; padding: 8px; text-align: left; cursor: pointer; font: inherit; color: inherit; background: transparent;
  border: 1px solid var(--sk-sidebar-sep, rgba(127,127,127,0.35)); border-radius: 8px; }
.sk-tp-card:hover { background: var(--sk-sidebar-hover, rgba(127,127,127,0.14)); }
.sk-tp-card:focus-visible { outline: 2px solid var(--sk-sidebar-accent, var(--sk-selection, #2c65ff)); outline-offset: 1px; }
.sk-tp-prev { aspect-ratio: 4 / 3; width: 100%; display: flex; align-items: center; justify-content: center; border-radius: 6px; background: rgba(127,127,127,0.10); color: inherit; overflow: hidden; }
.sk-tp-prev .sk-tp-svg { width: 100%; height: 100%; display: block; }
.sk-tp-blank { font-size: 44px; opacity: 0.55; }
.sk-tp-name { font-weight: 600; }
.sk-tp-desc { font-size: 12.5px; opacity: 0.75; line-height: 1.35; }
@media (max-width: 640px) {
  .sk-tp { width: 100vw; height: 100vh; border-radius: 0; }
  .sk-tp-grid { grid-template-columns: repeat(2, 1fr); gap: 8px; }
  .sk-tp-desc { display: none; }
}
/* TASK 670: the START view of a template (the same panel, small) */
.sk-tp.sk-tp-small { width: min(400px, calc(100vw - 24px)); height: auto; max-height: calc(100vh - 24px); border-radius: 10px; }
.sk-tp-start { display: flex; flex-direction: column; gap: 10px; padding: 0 14px 14px; min-height: 0; overflow: auto; }
.sk-tp-start .sk-tp-prev { aspect-ratio: auto; height: 140px; flex: none; }
.sk-tp-fields { display: flex; flex-direction: column; gap: 6px; }
.sk-tp-field { display: flex; align-items: center; gap: 8px; min-height: 44px; }
.sk-tp-field > label, .sk-tp-field > .sk-tp-label { flex: 1; min-width: 0; }
.sk-tp-input { width: 104px; font: inherit; padding: 8px; border-radius: 6px; color: inherit; background: transparent; min-height: 40px;
  border: 1px solid var(--sk-sidebar-sep, rgba(127,127,127,0.45)); }
.sk-tp-input[aria-invalid="true"] { border-color: var(--sk-error, #e5484d); }
.sk-tp-unit { width: 30px; opacity: 0.75; }
.sk-tp-err { color: var(--sk-error, #e5484d); font-size: 12.5px; min-height: 1em; }
.sk-tp-actions { display: flex; justify-content: flex-end; gap: 8px; }
.sk-tp-btn { font: inherit; min-height: 44px; min-width: 88px; padding: 0 16px; border-radius: 8px; cursor: pointer; color: inherit; background: transparent;
  border: 1px solid var(--sk-sidebar-sep, rgba(127,127,127,0.45)); }
.sk-tp-btn:hover { background: var(--sk-sidebar-hover, rgba(127,127,127,0.14)); }
.sk-tp-btn.sk-tp-open { background: var(--sk-sidebar-accent, var(--sk-selection, #2c65ff)); border-color: transparent; color: #fff; font-weight: 600; }
.sk-tp-btn:focus-visible, .sk-tp-choice button:focus-visible { outline: 2px solid var(--sk-sidebar-accent, var(--sk-selection, #2c65ff)); outline-offset: 1px; }
/* the glyph picker (frame-calc's CornerJointPicker interaction): the active option only; a tap shows all; a pick selects and folds back */
.sk-tp-choice { display: flex; gap: 6px; padding: 4px; border-radius: 12px; border: 1px solid var(--sk-sidebar-sep, rgba(127,127,127,0.35)); }
.sk-tp-choice button { width: 44px; height: 44px; padding: 4px; border-radius: 8px; cursor: pointer; color: inherit; display: flex; align-items: center; justify-content: center;
  background: rgba(127,127,127,0.08); border: 1px solid var(--sk-sidebar-sep, rgba(127,127,127,0.35)); touch-action: manipulation; }
.sk-tp-choice button[aria-pressed="true"] { border-color: var(--sk-sidebar-accent, var(--sk-selection, #2c65ff));
  background: color-mix(in srgb, var(--sk-sidebar-accent, var(--sk-selection, #2c65ff)) 12%, transparent); }
.sk-tp-choice button[hidden] { display: none; }
.sk-tp-glyph { width: 100%; height: 100%; overflow: visible; color: inherit; }
.sk-tp-glyph-active { color: var(--sk-sidebar-accent, var(--sk-selection, #2c65ff)); }
.sk-tp-board { stroke: currentColor; fill: currentColor; stroke-dasharray: none; } /* none: Shaper's page styles its toolpath class .sk-tp with a dash that the panel would pass down */
.sk-tp-board-light { fill-opacity: 0.14; }
.sk-tp-board-dark { fill-opacity: 0.32; }
`;
  document.head.appendChild(s); stylesInjected = true;
}

/** Open the modal (Blank design first and focused). One click/tap on a card opens it. Resolves with the choice, or null when closed. */
export function openTemplatePicker({ templates = TEMPLATES } = {}) {
  injectStyles();
  const returnTo = document.activeElement;
  return new Promise((resolve) => {
    const backdrop = document.createElement('div'); backdrop.className = 'sk-tp-backdrop';
    const panel = document.createElement('div'); panel.className = 'sk-tp'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', 'New design');
    backdrop.appendChild(panel); document.body.appendChild(backdrop);
    let stopOutside = null, done = false;
    const finish = (value) => {
      if (done) return; done = true;
      if (stopOutside) stopOutside();
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      if (returnTo && returnTo.focus && returnTo.isConnected) returnTo.focus();
      resolve(value);
    };
    // Esc closes from anywhere in the modal; it does not reach a modal underneath (the Projects window) or the canvas
    let backToCards = null; // set while the START view of a template shows: Esc / Cancel go back to the cards
    function onKey(e) {
      if (e.key !== 'Escape') return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (backToCards) backToCards(); else finish(null);
    }
    document.addEventListener('keydown', onKey, true);
    let pressInside = null;
    stopOutside = listenOutsidePress((e) => {
      // the event's path, not contains(): a pressed button of the start view (Cancel, a glyph) may already be replaced when this runs (TASK 670)
      if (e.type === 'pointerdown') pressInside = e.composedPath().includes(panel);
      const inside = pressInside !== null ? pressInside : e.composedPath().includes(panel);
      if (e.type === 'click') pressInside = null;
      if (!inside) finish(null);
    });

    const head = (title) => {
      const h = document.createElement('div'); h.className = 'sk-tp-head';
      const t = document.createElement('h2'); t.className = 'sk-tp-title'; t.textContent = title; h.appendChild(t);
      const x = document.createElement('button'); x.type = 'button'; x.className = 'sk-tp-x'; x.dataset.action = 'close'; x.setAttribute('aria-label', 'Close'); x.textContent = '×'; x.addEventListener('click', () => finish(null));
      h.appendChild(x); return h;
    };
    const card = (id, name, desc, previewNode) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'sk-tp-card'; b.dataset.template = id;
      const p = document.createElement('div'); p.className = 'sk-tp-prev'; p.appendChild(previewNode);
      const n = document.createElement('div'); n.className = 'sk-tp-name'; n.textContent = name;
      const d = document.createElement('div'); d.className = 'sk-tp-desc'; d.textContent = desc;
      b.append(p, n, d); return b;
    };

    panel.replaceChildren(head('New design'));
    const body = document.createElement('div'); body.className = 'sk-tp-body';
    const grid = document.createElement('div'); grid.className = 'sk-tp-grid'; grid.dataset.section = 'templates';
    const plus = document.createElement('div'); plus.className = 'sk-tp-blank'; plus.textContent = '+';
    const blankCard = card('blank', 'Blank design', 'An empty sketch.', plus);
    blankCard.addEventListener('click', () => finish({ blank: true }));
    grid.appendChild(blankCard);
    for (const t of templates) {
      const c = card(t.id, t.name, t.description, renderTemplatePreview(buildTemplate(t)));
      c.addEventListener('click', () => startView(t, c));
      grid.appendChild(c);
    }
    body.appendChild(grid); panel.appendChild(body);
    blankCard.focus();

    // TASK 670: the START view of a template, in THIS panel: its declared params; Open (Enter) builds it with these values
    function startView(t, fromCard) {
      const values = defaultParams(t);
      const valid = () => Object.entries(t.params).every(([k, spec]) => !paramRefusal(spec, values[k]));
      const view = document.createElement('div'); view.className = 'sk-tp-start'; view.dataset.template = t.id;
      const prev = document.createElement('div'); prev.className = 'sk-tp-prev';
      const redraw = () => { if (valid()) prev.replaceChildren(renderTemplatePreview(buildTemplate(t, values))); };
      const fields = document.createElement('div'); fields.className = 'sk-tp-fields';
      const err = document.createElement('div'); err.className = 'sk-tp-err'; err.setAttribute('role', 'alert');
      const inputs = new Map(); // param key -> its value box
      for (const [k, spec] of Object.entries(t.params)) {
        const row = document.createElement('div'); row.className = 'sk-tp-field'; row.dataset.param = k;
        const kind = paramKind(spec);
        if (kind === 'choice') {
          const name = document.createElement('span'); name.className = 'sk-tp-label'; name.textContent = spec.label;
          row.append(name, choicePicker(spec, values[k], (v) => { values[k] = v; redraw(); }));
        } else {
          const id = `sk-tp-f-${t.id}-${k}`;
          const label = document.createElement('label'); label.htmlFor = id; label.textContent = spec.label;
          const input = document.createElement('input'); input.id = id; input.className = 'sk-tp-input'; input.type = 'number';
          input.value = String(values[k]);
          if (kind === 'count') { input.step = '1'; input.min = String(spec.min); input.max = String(spec.max); input.inputMode = 'numeric'; } else { input.step = 'any'; input.min = '0'; input.inputMode = 'decimal'; }
          input.addEventListener('input', () => { values[k] = input.value.trim() === '' ? NaN : Number(input.value); input.removeAttribute('aria-invalid'); err.textContent = ''; redraw(); });
          const unit = document.createElement('span'); unit.className = 'sk-tp-unit'; unit.textContent = paramUnit(spec);
          row.append(label, input, unit);
          inputs.set(k, input);
        }
        fields.appendChild(row);
      }
      const actions = document.createElement('div'); actions.className = 'sk-tp-actions';
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'sk-tp-btn sk-tp-cancel'; cancel.textContent = 'Cancel';
      const openBtn = document.createElement('button'); openBtn.type = 'button'; openBtn.className = 'sk-tp-btn sk-tp-open'; openBtn.textContent = 'Open';
      actions.append(cancel, openBtn);
      const open = () => {
        for (const [k, spec] of Object.entries(t.params)) { // the ONE value rule (#core/templates.js paramRefusal): the first refused value is named
          const why = paramRefusal(spec, values[k]);
          if (!why) continue;
          err.textContent = why;
          const input = inputs.get(k);
          if (input) { input.setAttribute('aria-invalid', 'true'); input.focus(); }
          return;
        }
        finish({ template: t, document: buildTemplate(t, values), name: t.name });
      };
      openBtn.addEventListener('click', open);
      cancel.addEventListener('click', () => backToCards());
      // Enter in a value box opens (on a button, Enter is that button's own click)
      view.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT') { e.preventDefault(); open(); } });
      view.append(prev, fields, err, actions);
      redraw();
      const cards = [...panel.children];
      const startHead = head(t.name);
      startHead.querySelector('.sk-tp-x').remove(); // the start view closes with Cancel / Esc (back to the cards) or Open
      panel.classList.add('sk-tp-small'); panel.setAttribute('aria-label', t.name);
      panel.replaceChildren(startHead, view);
      backToCards = () => {
        backToCards = null;
        panel.classList.remove('sk-tp-small'); panel.setAttribute('aria-label', 'New design');
        panel.replaceChildren(...cards);
        if (fromCard.isConnected) fromCard.focus();
      };
      openBtn.focus();
    }
  });
}

/**
 * TASK 670: the GLYPH PICKER of a choice param (frame-calc's CornerJointPicker interaction, built with this app's own DOM): collapsed it shows only
 * the active option as its glyph; a tap expands it to every option; a pick selects that option and collapses it again. Each option is a 44 px
 * button named by its label (aria-label and title), aria-pressed on the active one. onPick(value) after every pick.
 */
export function choicePicker(spec, value, onPick) {
  const wrap = document.createElement('div'); wrap.className = 'sk-tp-choice'; wrap.setAttribute('role', 'group'); wrap.setAttribute('aria-label', spec.label);
  let current = value, expanded = false;
  const glyph = GLYPHS[spec.glyph];
  const buttons = spec.options.map((o) => {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.value = o.value;
    b.setAttribute('aria-label', o.label); b.title = o.label;
    b.addEventListener('click', () => {
      if (!expanded) { expanded = true; render(); return; }
      current = o.value; expanded = false; render(); onPick(current);
      b.focus();
    });
    return b;
  });
  function render() {
    wrap.dataset.expanded = expanded ? 'true' : 'false';
    spec.options.forEach((o, i) => {
      const b = buttons[i], active = o.value === current;
      b.hidden = !expanded && !active;
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
      b.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      b.replaceChildren(glyph(o.value, { active }));
    });
  }
  wrap.append(...buttons);
  render();
  return wrap;
}
