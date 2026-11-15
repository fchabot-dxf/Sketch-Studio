// packages/ui/template-picker.js -- TASK 651: the ONE modal that starts a new design: a grid of cards (a "Blank design" card first, then the bank of
// template drawings declared in #core/templates.js), each with a large crisp PREVIEW drawn as SVG from the template's own document (its geometry and its
// dimensions, not an image). A template card opens a detail view (a bigger preview, the description, the dimensions) with the one primary button
// "Open as new design". The "+" tab button, the menu's "New design" and its "Templates..." item all open THIS modal (project-actions.js newDesign).
//   openTemplatePicker({ blank: true }) -> Promise of { blank: true } | { template, document, name } | null (Esc, a press outside, the X: no new design)
// Phones: full-screen, two cards per row. Esc / an outside press (outside-press.js) / the X close it; focus goes back to where it was.

import { TEMPLATES, buildTemplate } from '#core/templates.js';
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

// ── the preview: a version-3 document -> an <svg> (world coordinates, Y down as stored; non-scaling strokes keep it crisp at any size) ──
export function renderTemplatePreview(document_, { labels = true } = {}) {
  const g = document_.geometry;
  const J = new Map(g.joints.map(([id, j]) => [id, j]));
  const shapes = g.shapes;
  const dims = g.constraints.filter((c) => c.type === 'distance' && !c.isDriven && !c.driven);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (x, y) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); };
  for (const s of shapes) {
    if (s.isConstruction) continue;
    if (s.type === 'line') for (const id of s.joints) grow(J.get(id).x, J.get(id).y);
    else if (s.type === 'circle') { const c = J.get(s.joints[0]); grow(c.x - s.radius, c.y - s.radius); grow(c.x + s.radius, c.y + s.radius); }
    else if (s.type === 'arc') {
      const [c, a, b] = s.joints.map((id) => J.get(id)), r = Math.hypot(a.x - c.x, a.y - c.y);
      grow(a.x, a.y); grow(b.x, b.y);
      const info = arcSweepInfo(c, a, b, { sweep: s.sweep });
      for (const ang of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) if (angleInArcSweep(info, ang)) grow(c.x + r * Math.cos(ang), c.y + r * Math.sin(ang));
    }
  }
  const W = x1 - x0, H = y1 - y0, size = Math.max(W, H, 1), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const gap = size * 0.1, fs = size * 0.065;
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
  // the dimensions: a dimension line outside the drawing (on the side its joints are on), extension lines, the value
  let bx0 = x0, by0 = y0, bx1 = x1, by1 = y1; // the frame: the drawing plus everything the dimensions draw
  const frame = (x, y, hw = 0, hh = 0) => { bx0 = Math.min(bx0, x - hw); bx1 = Math.max(bx1, x + hw); by0 = Math.min(by0, y - hh); by1 = Math.max(by1, y + hh); };
  if (labels) {
    const dg = el('g', { fill: 'none', stroke: 'currentColor', 'stroke-width': 1, opacity: 0.75 });
    const text = (x, y, t, anchor = 'middle') => { const w = String(t).length * fs * 0.62; frame(anchor === 'start' ? x + w / 2 : anchor === 'end' ? x - w / 2 : x, y, w / 2, fs * 0.6); const n = el('text', { x, y, 'font-size': fs, fill: 'currentColor', stroke: 'none', 'text-anchor': anchor, 'dominant-baseline': 'middle', 'font-family': 'system-ui, sans-serif', 'font-weight': 600 }, t); dg.appendChild(n); };
    const seg = (ax, ay, bx, by) => { frame(ax, ay); frame(bx, by); return dg.appendChild(stroke(el('line', { x1: ax, y1: ay, x2: bx, y2: by }))); };
    dims.forEach((c, i) => {
      if (c.isRadius) {
        const sh = shapes.find((s) => s.id === c.shape), cc = J.get(sh.joints[0]);
        const ang = [-Math.PI / 4, -3 * Math.PI / 4, Math.PI / 4][i % 3];
        const r = sh.type === 'circle' ? sh.radius : Math.hypot(J.get(sh.joints[1]).x - cc.x, J.get(sh.joints[1]).y - cc.y);
        const px = cc.x + r * Math.cos(ang), py = cc.y + r * Math.sin(ang);
        const ox = cc.x + (r + (sh.radius && sh.radius < size * 0.1 ? size * 0.12 : r * 0.35)) * Math.cos(ang), oy = cc.y + (r + (sh.radius && sh.radius < size * 0.1 ? size * 0.12 : r * 0.35)) * Math.sin(ang);
        seg(cc.x, cc.y, px, py); seg(px, py, ox, oy);
        text(ox + (Math.cos(ang) > 0 ? fs * 0.3 : -fs * 0.3), oy + (Math.sin(ang) > 0 ? fs * 0.9 : -fs * 0.9), 'R' + fmt(c.value), Math.cos(ang) > 0 ? 'start' : 'end');
        return;
      }
      let a, b;
      if (c.shapes) { // a gap between two lines: measured between their midpoints
        const mid = (id) => { const s = shapes.find((x) => x.id === id), p = J.get(s.joints[0]), q = J.get(s.joints[1]); return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }; };
        a = mid(c.shapes[0]); b = mid(c.shapes[1]);
        const nx = b.y - a.y, ny = a.x - b.x, nl = Math.hypot(nx, ny) || 1, side = gap * 1.1 / nl;
        const ax = a.x + nx * side, ay = a.y + ny * side, bx = b.x + nx * side, by = b.y + ny * side;
        seg(a.x, a.y, ax, ay); seg(b.x, b.y, bx, by); seg(ax, ay, bx, by);
        text((ax + bx) / 2 + nx * side * 0.5 + fs * 0.2, (ay + by) / 2 + ny * side * 0.5, fmt(c.value), 'start');
        return;
      }
      a = J.get(c.joints[0]); b = J.get(c.joints[1]);
      const mode = c.dimMode || 'aligned';
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      let ax = a.x, ay = a.y, bx = b.x, by = b.y, tx, ty;
      const lane = gap * (1 + 0.55 * (i % 3)); // dimension lines of one drawing stay apart
      if (mode === 'horizontal') {
        const dir = my >= cy ? 1 : -1, yy = (dir > 0 ? Math.max(y1, a.y, b.y) : Math.min(y0, a.y, b.y)) + dir * lane;
        seg(a.x, a.y, a.x, yy); seg(b.x, b.y, b.x, yy); seg(a.x, yy, b.x, yy); tx = mx; ty = yy + dir * fs * 0.8; ay = by = yy;
      } else if (mode === 'vertical') {
        const dir = mx >= cx ? 1 : -1, xx = (dir > 0 ? Math.max(x1, a.x, b.x) : Math.min(x0, a.x, b.x)) + dir * lane;
        seg(a.x, a.y, xx, a.y); seg(b.x, b.y, xx, b.y); seg(xx, a.y, xx, b.y); tx = xx + dir * fs * 0.4; ty = my; ax = bx = xx;
        text(tx, ty, fmt(c.value), dir > 0 ? 'start' : 'end');
        return;
      } else {
        const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
        let nx = -dy / l, ny = dx / l;
        if ((mx - cx) * nx + (my - cy) * ny < 0) { nx = -nx; ny = -ny; }
        const d = gap * 0.8;
        seg(a.x, a.y, a.x + nx * d, a.y + ny * d); seg(b.x, b.y, b.x + nx * d, b.y + ny * d); seg(a.x + nx * d, a.y + ny * d, b.x + nx * d, b.y + ny * d);
        tx = mx + nx * (d + fs * 0.8); ty = my + ny * (d + fs * 0.8);
      }
      text(tx, ty, fmt(c.value));
    });
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
.sk-tp-x, .sk-tp-back { background: transparent; color: inherit; border: 0; cursor: pointer; font: inherit; padding: 4px 10px; border-radius: 6px; }
.sk-tp-x { font-size: 22px; line-height: 1; }
.sk-tp-x:hover, .sk-tp-back:hover { background: var(--sk-sidebar-hover, rgba(127,127,127,0.18)); }
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
.sk-tp-detail { display: flex; flex-direction: column; gap: 12px; height: 100%; }
.sk-tp-detail .sk-tp-prev { aspect-ratio: auto; flex: 1; min-height: 240px; }
.sk-tp-dname { font-size: 18px; font-weight: 600; margin: 0; }
.sk-tp-actions { display: flex; gap: 10px; flex-wrap: wrap; }
.sk-tp-primary { padding: 10px 18px; border: 0; border-radius: 8px; cursor: pointer; font: inherit; font-weight: 600; background: var(--sk-sidebar-accent, var(--sk-selection, #2c65ff)); color: #fff; }
.sk-tp-primary:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
@media (max-width: 640px) {
  .sk-tp { width: 100vw; height: 100vh; border-radius: 0; }
  .sk-tp-grid { grid-template-columns: repeat(2, 1fr); gap: 8px; }
  .sk-tp-desc { display: none; }
  .sk-tp-primary { flex: 1; }
}
`;
  document.head.appendChild(s); stylesInjected = true;
}

/** Open the modal. blank: show the "Blank design" card first (and focus it). Resolves with the choice, or null when it was closed. */
export function openTemplatePicker({ blank = true, templates = TEMPLATES } = {}) {
  injectStyles();
  const returnTo = document.activeElement;
  return new Promise((resolve) => {
    const backdrop = document.createElement('div'); backdrop.className = 'sk-tp-backdrop';
    const panel = document.createElement('div'); panel.className = 'sk-tp'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', blank ? 'New design' : 'Templates');
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
    function onKey(e) {
      if (e.key !== 'Escape') return;
      e.preventDefault(); e.stopImmediatePropagation(); finish(null);
    }
    document.addEventListener('keydown', onKey, true);
    // a press that STARTED inside is not an outside press, though its click may find the card already replaced by the detail view
    let pressInside = null;
    stopOutside = listenOutsidePress((e) => {
      if (e.type === 'pointerdown') pressInside = panel.contains(e.target);
      const inside = pressInside !== null ? pressInside : panel.contains(e.target);
      if (e.type === 'click') pressInside = null;
      if (!inside) finish(null);
    });

    const head = (title, back) => {
      const h = document.createElement('div'); h.className = 'sk-tp-head';
      if (back) { const b = document.createElement('button'); b.type = 'button'; b.className = 'sk-tp-back'; b.dataset.action = 'back'; b.setAttribute('aria-label', 'Back to all templates'); b.textContent = '← Back'; b.addEventListener('click', showGrid); h.appendChild(b); }
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

    function showGrid() {
      panel.replaceChildren(head(blank ? 'New design' : 'Templates', false));
      const body = document.createElement('div'); body.className = 'sk-tp-body';
      const grid = document.createElement('div'); grid.className = 'sk-tp-grid'; grid.dataset.section = 'templates';
      if (blank) {
        const plus = document.createElement('div'); plus.className = 'sk-tp-blank'; plus.textContent = '+';
        const c = card('blank', 'Blank design', 'An empty sketch.', plus);
        c.addEventListener('click', () => finish({ blank: true }));
        grid.appendChild(c);
      }
      for (const t of templates) {
        const doc = buildTemplate(t);
        const c = card(t.id, t.name, t.description, renderTemplatePreview(doc));
        c.addEventListener('click', () => showDetail(t, doc));
        grid.appendChild(c);
      }
      body.appendChild(grid); panel.appendChild(body);
      const first = grid.querySelector('.sk-tp-card'); if (first) first.focus();
    }
    function showDetail(t, doc) {
      panel.replaceChildren(head(t.name, true));
      const body = document.createElement('div'); body.className = 'sk-tp-body';
      const d = document.createElement('div'); d.className = 'sk-tp-detail'; d.dataset.section = 'detail'; d.dataset.template = t.id;
      const p = document.createElement('div'); p.className = 'sk-tp-prev'; p.appendChild(renderTemplatePreview(doc));
      const desc = document.createElement('div'); desc.className = 'sk-tp-desc'; desc.style.fontSize = '14px'; desc.textContent = t.description + ' Sizes are in mm; every dimension can be changed after it opens.';
      const act = document.createElement('div'); act.className = 'sk-tp-actions';
      const open = document.createElement('button'); open.type = 'button'; open.className = 'sk-tp-primary'; open.dataset.action = 'open-template'; open.textContent = 'Open as new design';
      open.addEventListener('click', () => finish({ template: t, document: doc, name: t.name }));
      act.appendChild(open); d.append(p, desc, act); body.appendChild(d); panel.appendChild(body);
      open.focus();
    }
    showGrid();
  });
}
