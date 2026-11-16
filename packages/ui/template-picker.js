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

import { TEMPLATES, TemplateRefusal, buildTemplate, paramKind, paramUnit, paramRefusal, paramActive, defaultParams, templateCorners, fitCorners } from '#core/templates.js';
import SettingsManager from '#core/settings-manager.js';
import { dbg } from '#core/debug.js';
import { GLYPHS } from './template-glyphs.js';
import { calculateArcPath, arcSweepInfo, angleInArcSweep, getLineIntersection } from '#core/geometry.js';
import { angleSectorOf, angleSectorArc } from '#core/angle-sector.js';
import { listenOutsidePress } from './outside-press.js';

export const GENERIC_REFUSAL = "These values can't be drawn. Try other values.";
export const TEMPLATE_FAVOURITES_KEY = 'TEMPLATE_FAVOURITES';
export const TEMPLATE_FAVOURITES_VERSION = 1;

let warnedFavsRaw;
/** Reads stored TEMPLATE_FAVOURITES against known template ids: deduplicates and drops unknown/removed ids. */
export function normalizeFavouriteIds(raw, knownIds = TEMPLATES.map((t) => t.id)) {
  if (raw == null) return [];
  if (typeof raw !== 'object' || raw.v !== TEMPLATE_FAVOURITES_VERSION || !Array.isArray(raw.ids)) {
    if (warnedFavsRaw !== raw) {
      warnedFavsRaw = raw;
      dbg.warn('template-picker', '[template-picker] TEMPLATE_FAVOURITES has an unknown shape; no favourites loaded', raw);
    }
    return [];
  }
  const known = new Set(knownIds);
  const out = [];
  const seen = new Set();
  for (const id of raw.ids) {
    if (typeof id !== 'string' || !known.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Loads favourite template ids from SettingsManager, dropping any id not in `templates`. */
export function loadFavouriteIds(templates = TEMPLATES, settings = SettingsManager) {
  return normalizeFavouriteIds(settings.get(TEMPLATE_FAVOURITES_KEY), templates.map((t) => t.id));
}

/** Saves favourite template ids locally via SettingsManager (shared across all four apps). */
export function saveFavouriteIds(ids, templates = TEMPLATES, settings = SettingsManager) {
  const clean = normalizeFavouriteIds({ v: TEMPLATE_FAVOURITES_VERSION, ids }, templates.map((t) => t.id));
  settings.set(TEMPLATE_FAVOURITES_KEY, { v: TEMPLATE_FAVOURITES_VERSION, ids: clean }, { persist: 'local' });
  return clean;
}

/** Toggles `id` in `favIds`, preserving starred order, and persists the updated list. */
export function toggleFavouriteId(favIds, id, templates = TEMPLATES, settings = SettingsManager) {
  const current = normalizeFavouriteIds({ v: TEMPLATE_FAVOURITES_VERSION, ids: favIds }, templates.map((t) => t.id));
  const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
  return saveFavouriteIds(next, templates, settings);
}

/** Splits `templates` into `{ favs, rest }`: favourites in starred order, then every other template in bank order. */
export function orderTemplatesByFavourites(templates, favIds) {
  const byId = new Map(templates.map((t) => [t.id, t]));
  const favSet = new Set();
  const favs = [];
  for (const id of favIds) {
    const t = byId.get(id);
    if (!t || favSet.has(id)) continue;
    favSet.add(id);
    favs.push(t);
  }
  return { favs, rest: templates.filter((t) => !favSet.has(t.id)) };
}

const SVGNS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, text) => {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
};
const fmt = (n) => String(Math.round(n * 100) / 100);
// TASK 672: the modal panel's class. Not `sk-tp`: Shaper's page styles its toolpaths `.sk-tp` (no fill, a dashed stroke), which drew every
// template preview in this panel dashed there (since task 651). Every rule below and the panel itself use this one name.
const PANEL = 'sk-tp-panel';
// TASK 680: a template is built by its RECIPE (the app's tools, #core/templates.js), so a build costs real time (milliseconds to seconds for a
// large count). THE place the picker builds: each template's default document once per page (the cards, the start view at its defaults), and
// in the start view one build per settled value (PREVIEW_DELAY after the last change), never one per keystroke.
const PREVIEW_DELAY = 200;
const defaultDocs = new WeakMap(); // template -> its document at its defaults
const defaultDocument = (t) => { if (!defaultDocs.has(t)) defaultDocs.set(t, buildTemplate(t)); return defaultDocs.get(t); };
const boxesOverlap = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
// TASK 674: the room (px) a corner's glyph picker keeps from the drawing's lines and from the other corners' pickers
const GLYPH_GAP = 4;
// whether the segment p q crosses (or lies in) the box (Liang-Barsky clipping of the segment against the box)
function segmentHitsBox(p, q, b) {
  let t0 = 0, t1 = 1;
  const dx = q.x - p.x, dy = q.y - p.y;
  for (const [num, den] of [[p.x - b.x0, -dx], [b.x1 - p.x, dx], [p.y - b.y0, -dy], [b.y1 - p.y, dy]]) {
    if (den === 0) { if (num < 0) return false; continue; }
    const t = num / den;
    if (den < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

// ── the preview: a version-3 document -> an <svg> (world coordinates, Y down as stored; non-scaling strokes keep it crisp at any size) ──
export function renderTemplatePreview(document_, { labels = true } = {}) {
  const g = document_.geometry;
  const J = new Map(g.joints.map(([id, j]) => [id, j]));
  const shapes = g.shapes;
  const dims = g.constraints.filter((c) => c.type === 'distance' && !c.isDriven && !c.driven);
  const angleDims = g.constraints.filter((c) => c.type === 'angle' && !c.isDriven && !c.driven); // TASK 672
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
    // TASK 672: a line-to-line distance is drawn SQUARE to the first line: from the middle of the second line to its foot on the first one (the
    // middles of two lines of different lengths, the brace's diagonal faces, are not opposite each other; two opposite equal sides draw as before)
    const gapEnds = ([id1, id2]) => {
      const s1 = shapes.find((x) => x.id === id1), p = J.get(s1.joints[0]), q = J.get(s1.joints[1]), b = lineMid(id2);
      const dx = q.x - p.x, dy = q.y - p.y, u = ((b.x - p.x) * dx + (b.y - p.y) * dy) / (dx * dx + dy * dy);
      return [{ x: p.x + u * dx, y: p.y + u * dy }, b];
    };

    // Classify dims: axis-aligned ('top'|'bottom'|'left'|'right'), 'aligned', or 'radius'
    const axisGroups = { top: [], bottom: [], left: [], right: [] };
    const alignedDims = [], radiusDims = [];
    for (const c of dims) {
      if (c.isRadius) { radiusDims.push(c); continue; }
      const [a, b] = c.shapes ? gapEnds(c.shapes) : [J.get(c.joints[0]), J.get(c.joints[1])];
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
    // 4. TASK 672: angle dimensions: the arc of the measured sector (#core/angle-sector.js, the one the dimension stores) about the two lines'
    // crossing, its value in degrees at the middle of the arc; the arc grows by lanes until its label is clear of the placed ones
    for (const c of angleDims) {
      const [[a1, b1], [a2, b2]] = c.shapes.map((id) => shapes.find((x) => x.id === id).joints.map((j) => J.get(j)));
      const at = getLineIntersection(a1, b1, a2, b2);
      if (!at) continue; // two parallel lines (0 or 180 degrees): no crossing to draw an arc about
      const arc = angleSectorArc(angleSectorOf(c), Math.atan2(b1.y - a1.y, b1.x - a1.x), Math.atan2(b2.y - a2.y, b2.x - a2.x));
      const mid = (arc.start + arc.end) / 2, t = fmt(c.value) + '°';
      let rr = size * 0.18, tx, ty;
      for (let k = 0; k < 8; k++) {
        tx = at.x + (rr + fs * 0.9) * Math.cos(mid); ty = at.y + (rr + fs * 0.9) * Math.sin(mid);
        if (clearOfPlaced(labelBox(tx, ty, t, 'middle'))) break;
        rr += laneStep;
      }
      const p0 = { x: at.x + rr * Math.cos(arc.start), y: at.y + rr * Math.sin(arc.start) }, p1 = { x: at.x + rr * Math.cos(arc.end), y: at.y + rr * Math.sin(arc.end) };
      frame(p0.x, p0.y); frame(p1.x, p1.y);
      dg.appendChild(stroke(el('path', { d: `M ${p0.x} ${p0.y} A ${rr} ${rr} 0 ${arc.end - arc.start > Math.PI ? 1 : 0} 1 ${p1.x} ${p1.y}` })));
      text(tx, ty, t, 'middle');
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
.${PANEL} { position: relative; width: min(1000px, 94vw); height: min(720px, 92vh); box-sizing: border-box; display: flex; flex-direction: column; overflow: hidden;
  background: var(--sk-sidebar-bg, var(--sk-header-bg, #fff)); color: var(--sk-sidebar-fg, var(--sk-header-fg, #1e293b));
  font: 14px system-ui, sans-serif; border-radius: 10px; box-shadow: 0 10px 40px rgba(0,0,0,0.5); }
.${PANEL} * { box-sizing: border-box; }
.sk-tp-head { display: flex; align-items: center; gap: 10px; padding: 12px 14px 8px; }
.sk-tp-title { font-size: 17px; font-weight: 600; margin: 0; flex: 1; }
.sk-tp-x { background: transparent; color: inherit; border: 0; cursor: pointer; font: inherit; padding: 4px 10px; border-radius: 6px; font-size: 22px; line-height: 1; }
.sk-tp-x:hover { background: var(--sk-sidebar-hover, rgba(127,127,127,0.18)); }
.sk-tp-body { flex: 1; min-height: 0; overflow: auto; padding: 4px 14px 16px; }
.sk-tp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 12px; }
.sk-tp-item { position: relative; display: flex; }
.sk-tp-item .sk-tp-card { width: 100%; flex: 1; }
.sk-tp-card { display: flex; flex-direction: column; gap: 6px; padding: 8px; text-align: left; cursor: pointer; font: inherit; color: inherit; background: transparent;
  border: 1px solid var(--sk-sidebar-sep, rgba(127,127,127,0.35)); border-radius: 8px; }
.sk-tp-card:hover { background: var(--sk-sidebar-hover, rgba(127,127,127,0.14)); }
.sk-tp-card:focus-visible, .sk-tp-star:focus-visible { outline: 2px solid var(--sk-sidebar-accent, var(--sk-selection, #2c65ff)); outline-offset: 1px; }
.sk-tp-star { position: absolute; bottom: 2px; right: 2px; width: 44px; height: 44px; padding: 8px; border: 0; border-radius: 8px; background: transparent;
  color: inherit; cursor: pointer; display: flex; align-items: center; justify-content: center; touch-action: manipulation; }
.sk-tp-star svg { display: block; fill: none; stroke: currentColor; opacity: 0.45; transition: opacity 0.12s, color 0.12s; }
.sk-tp-star:hover { background: var(--sk-sidebar-hover, rgba(127,127,127,0.14)); }
.sk-tp-star:hover svg, .sk-tp-star:focus-visible svg { opacity: 0.9; }
.sk-tp-star[aria-pressed="true"] { color: #f59e0b; }
.sk-tp-star[aria-pressed="true"] svg { fill: currentColor; stroke: currentColor; opacity: 1; }
.sk-tp-prev { aspect-ratio: 4 / 3; width: 100%; display: flex; align-items: center; justify-content: center; border-radius: 6px; background: rgba(127,127,127,0.10); color: inherit; overflow: hidden; }
.sk-tp-prev .sk-tp-svg { width: 100%; height: 100%; display: block; }
.sk-tp-blank { font-size: 44px; opacity: 0.55; }
/* TASK 700: the star sits at the card's bottom-right, OUTSIDE the preview: the name row is 36 px tall (card padding 8 = 44) and the text keeps clear of the star */
.sk-tp-item .sk-tp-name { min-height: 36px; display: flex; align-items: center; padding-right: 40px; }
.sk-tp-item .sk-tp-desc { padding-right: 40px; }
.sk-tp-name { font-weight: 600; }
.sk-tp-desc { font-size: 12.5px; opacity: 0.75; line-height: 1.35; }
@media (max-width: 640px) {
  .${PANEL} { width: 100vw; height: 100vh; border-radius: 0; }
  .sk-tp-grid { grid-template-columns: repeat(2, 1fr); gap: 8px; }
  .sk-tp-desc { display: none; }
}
/* TASK 681: a question in the same modal (openChoiceModal): the small panel, its answers as full-height buttons */
.sk-tp-ask { display: flex; flex-direction: column; gap: 14px; padding: 4px 14px 14px; }
.sk-tp-ask .sk-tp-actions { flex-wrap: wrap; }
@media (max-width: 640px) { .sk-tp-ask .sk-tp-actions { flex-direction: column; } .sk-tp-ask .sk-tp-btn { width: 100%; } }
/* TASK 670: the START view of a template (the same panel, small) */
.${PANEL}.sk-tp-small { width: min(400px, calc(100vw - 24px)); height: auto; max-height: calc(100vh - 24px); border-radius: 10px; }
.sk-tp-start { display: flex; flex-direction: column; gap: 10px; padding: 0 14px 14px; min-height: 0; overflow: auto; }
.sk-tp-start .sk-tp-prev { aspect-ratio: auto; height: 140px; flex: none; }
.sk-tp-fields { display: flex; flex-direction: column; gap: 6px; }
.sk-tp-field { display: flex; align-items: center; gap: 8px; min-height: 44px; }
.sk-tp-field > label, .sk-tp-field > .sk-tp-label { flex: 1; min-width: 0; }
.sk-tp-field[hidden] { display: none; }
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
.sk-tp-btn:disabled { opacity: 0.45; cursor: not-allowed; }
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
.sk-tp-board { stroke: currentColor; fill: currentColor; }
.sk-tp-board-light { fill-opacity: 0.14; }
.sk-tp-board-dark { fill-opacity: 0.32; }
/* TASK 674: the WIDE start view of a frame template: a big preview (the stage) with a joint glyph picker on every corner, the form beside it
   (desktop) or under it (phone: the stage spans the panel, the form scrolls, Open / Cancel stay in view). The preview keeps a margin round
   the drawing so the corner pickers (44 px buttons) sit off it. */
.${PANEL}.sk-tp-wide { width: min(880px, calc(100vw - 24px)); }
.sk-tp-wide .sk-tp-start { display: grid; grid-template-columns: minmax(0, 1fr) minmax(250px, 300px); grid-template-rows: auto auto 1fr; column-gap: 16px; }
.sk-tp-stage { position: relative; grid-row: 1 / span 3; height: min(470px, calc(100vh - 110px)); }
.sk-tp-start .sk-tp-stage .sk-tp-prev { height: 100%; padding: 44px; }
.sk-tp-wide .sk-tp-fields, .sk-tp-wide .sk-tp-err { grid-column: 2; }
.sk-tp-wide .sk-tp-actions { grid-column: 2; align-self: end; }
.sk-tp-corners { position: absolute; inset: 0; pointer-events: none; }
.sk-tp-choice.sk-tp-corner { position: absolute; left: 0; top: 0; padding: 2px; gap: 4px; pointer-events: auto;
  background: var(--sk-sidebar-bg, var(--sk-header-bg, #fff)); box-shadow: 0 1px 4px rgba(0,0,0,0.25); }
.sk-tp-choice.sk-tp-corner[data-expanded="true"] { z-index: 2; box-shadow: 0 4px 14px rgba(0,0,0,0.35); }
@media (max-width: 640px) {
  .sk-tp-wide .sk-tp-start { display: flex; }
  .sk-tp-stage { height: auto; aspect-ratio: 1 / 1; flex: none; }
  .sk-tp-wide .sk-tp-start { padding-bottom: 0; scroll-padding-bottom: 76px; } /* a field scrolled into view (focus, a tap) stays above the bar */
  .sk-tp-wide .sk-tp-actions { align-self: stretch; position: sticky; bottom: 0; z-index: 3; padding: 8px 0 14px; background: var(--sk-sidebar-bg, var(--sk-header-bg, #fff)); }
}
`;
  document.head.appendChild(s); stylesInjected = true;
}

/** Open the modal (Blank design first and focused). One click/tap on a card opens it. Resolves with the choice, or null when closed. */
export function openTemplatePicker({ templates = TEMPLATES } = {}) {
  injectStyles();
  const returnTo = document.activeElement;
  return new Promise((resolve) => {
    const backdrop = document.createElement('div'); backdrop.className = 'sk-tp-backdrop';
    const panel = document.createElement('div'); panel.className = PANEL; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', 'New design');
    backdrop.appendChild(panel); document.body.appendChild(backdrop);
    let stopOutside = null, done = false;
    const finish = (value) => {
      if (done) return; done = true;
      if (stopOutside) stopOutside();
      if (stopStart) stopStart();
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      if (returnTo && returnTo.focus && returnTo.isConnected) returnTo.focus();
      resolve(value);
    };
    // Esc closes from anywhere in the modal; it does not reach a modal underneath (the Projects window) or the canvas
    let backToCards = null; // set while the START view of a template shows: Esc / Cancel go back to the cards
    let stopStart = null; // TASK 674: undoes what a start view listens to (the window's resize: its corner pickers follow the preview)
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

    const starSvg = () => {
      const svg = el('svg', { viewBox: '0 0 24 24', width: '18', height: '18', 'aria-hidden': 'true' });
      svg.appendChild(el('path', {
        d: 'M12 2.5l2.93 5.94 6.56.95-4.74 4.62 1.12 6.53L12 17.46l-5.87 3.08 1.12-6.53L2.51 9.39l6.56-.95L12 2.5z',
        'stroke-width': '1.8',
        'stroke-linejoin': 'round',
      }));
      return svg;
    };

    panel.replaceChildren(head('New design'));
    const body = document.createElement('div'); body.className = 'sk-tp-body';
    const grid = document.createElement('div'); grid.className = 'sk-tp-grid'; grid.dataset.section = 'templates';
    const plus = document.createElement('div'); plus.className = 'sk-tp-blank'; plus.textContent = '+';
    const blankCard = card('blank', 'Blank design', 'An empty sketch.', plus);
    blankCard.addEventListener('click', () => finish({ blank: true }));

    // TASK 692: each template card has an independent star toggle button; favourites follow Blank in starred order.
    let favIds = loadFavouriteIds(templates);

    const entries = new Map();
    const unbuiltMap = new Map();
    for (const t of templates) {
      const preview = defaultDocs.has(t) ? renderTemplatePreview(defaultDocs.get(t)) : document.createElement('div');
      const wrap = document.createElement('div'); wrap.className = 'sk-tp-item'; wrap.dataset.template = t.id;
      const c = card(t.id, t.name, t.description, preview);
      c.addEventListener('click', () => startView(t, c));
      const star = document.createElement('button');
      star.type = 'button'; star.className = 'sk-tp-star'; star.dataset.template = t.id;
      star.setAttribute('aria-label', `Favourite ${t.name}`);
      star.title = `Favourite ${t.name}`;
      star.setAttribute('aria-pressed', 'false');
      star.appendChild(starSvg());
      star.addEventListener('click', (e) => {
        e.stopPropagation();
        const keepFocus = document.activeElement === star;
        favIds = toggleFavouriteId(favIds, t.id, templates);
        applyOrder(keepFocus ? star : null);
      });
      wrap.append(c, star);
      const slot = c.querySelector('.sk-tp-prev');
      entries.set(t.id, { t, wrap, card: c, star, slot });
      if (!defaultDocs.has(t)) unbuiltMap.set(t.id, [t, slot]);
    }

    const applyOrder = (focusEl = null) => {
      const { favs, rest } = orderTemplatesByFavourites(templates, favIds);
      const favSet = new Set(favs.map((t) => t.id));
      for (const [id, entry] of entries) {
        entry.star.setAttribute('aria-pressed', favSet.has(id) ? 'true' : 'false');
      }
      const nodes = [blankCard];
      for (const t of favs) nodes.push(entries.get(t.id).wrap); // TASK 721: one continuous grid, no heading or divider spanning it
      for (const t of rest) nodes.push(entries.get(t.id).wrap);
      grid.replaceChildren(...nodes);
      if (focusEl && focusEl.isConnected && document.activeElement !== focusEl) focusEl.focus();
      return { favs, rest };
    };

    const { favs: initFavs, rest: initRest } = applyOrder();
    // TASK 680: build unbuilt card previews in visible order (favourites first, one per task), without rebuilding moved cards on toggle.
    const unbuilt = [];
    for (const t of [...initFavs, ...initRest]) {
      const pair = unbuiltMap.get(t.id);
      if (pair) unbuilt.push(pair);
    }
    // TASK 674: the grid says when every card's preview is drawn (data-previews "building" -> "ready"): what a test waits for before it reads them
    const buildNextCard = () => {
      if (done) return;
      if (!unbuilt.length) { grid.dataset.previews = 'ready'; return; }
      const [t, slot] = unbuilt.shift();
      slot.replaceChildren(renderTemplatePreview(defaultDocument(t)));
      setTimeout(buildNextCard, 0);
    };
    grid.dataset.previews = 'building';
    setTimeout(buildNextCard, 0);
    body.appendChild(grid); panel.appendChild(body);
    blankCard.focus();

    // TASK 670: the START view of a template, in THIS panel: its declared params; Open (Enter) builds it with these values
    // TASK 674: a template with corners (the frames: #core/templates.js templateCorners) gets the WIDE start view: a big preview with a joint
    // glyph picker on each corner (frame-calc's per-vertex JointPicker: the corner's active joint, a tap expands it, a pick selects and folds
    // back, one corner open at a time), the form beside it (under it on a phone, scrolling, Open / Cancel kept in view). A corner's pick is its
    // own entry of the template's per-corner choice (or the corner's own choice param, the brace / triangle / corner: picked on the preview only,
    // no form row); the "Corner joint" row of a per-corner choice sets every corner. A pick is a settled value: the preview is rebuilt at once.
    function startView(t, fromCard) {
      const values = defaultParams(t);
      const hasCorners = templateCorners(t).length > 0;
      const lastAll = {}; // a per-corner param -> the option last set for every corner (corners a larger count adds take it)
      const valid = () => Object.entries(t.params).every(([k, spec]) => !paramActive(spec, values) || !paramRefusal(spec, values[k]));
      const view = document.createElement('div'); view.className = 'sk-tp-start'; view.dataset.template = t.id;
      const prev = document.createElement('div'); prev.className = 'sk-tp-prev';
      const stage = document.createElement('div'); stage.className = 'sk-tp-stage';
      const layer = document.createElement('div'); layer.className = 'sk-tp-corners';
      stage.append(prev, layer);
      // TASK 672: a choice's glyphs draw with the current values (#ui/template-glyphs.js): each picker reads THIS values object, and is told
      // to draw its glyphs again (REDRAW) when a value changes; only with valid values, like the preview
      const pickers = [], cornerPickers = [];
      // TASK 680: the preview is built once the values settle (PREVIEW_DELAY after the last change). A value set the recipe cannot draw shows
      // why in the error line, keeps the last good preview and disables Open until a value set draws.
      const defaultsKey = JSON.stringify(defaultParams(t));
      let timer = null, built = null; // built = { key, doc, values }: the values the preview shows and their document (null: they cannot be drawn)
      let shown = null; // TASK 674: the last good build, the one the preview (and its corner pickers) shows
      let refocus = null; // TASK 674: the corner whose picker had the pick (its new picker takes the focus back)
      // TASK 703: a refusal (#core/templates.js TemplateRefusal) carries its plain message and the param it concerns: the line says it and that
      // field is marked. Any other error is a bug: one generic line, the technical text logged.
      const showRefusal = (e) => {
        if (e instanceof TemplateRefusal) {
          err.textContent = e.message;
          const input = inputs.get(e.param);
          if (input) input.setAttribute('aria-invalid', 'true');
          return;
        }
        err.textContent = GENERIC_REFUSAL;
        dbg.error('template-picker', `${t.id}: ${e.message}`, e);
      };
      const clearError = () => { err.textContent = ''; for (const input of inputs.values()) input.removeAttribute('aria-invalid'); }; // a change: the old refusal no longer stands
      const draw = () => {
        clearTimeout(timer); timer = null;
        if (!valid()) return;
        Object.assign(values, fitCorners(t, values, lastAll)); // TASK 674: a count changed: the corner list follows
        const key = JSON.stringify(values);
        if (built && built.key === key) return;
        let doc;
        try {
          doc = key === defaultsKey ? defaultDocument(t) : buildTemplate(t, values);
        } catch (e) {
          built = null; refocus = null; openBtn.disabled = true;
          showRefusal(e);
          return;
        }
        built = shown = { key, doc, values: structuredClone(values) }; openBtn.disabled = false;
        prev.replaceChildren(renderTemplatePreview(doc));
        if (hasCorners) placeCorners();
      };
      const fields = document.createElement('div'); fields.className = 'sk-tp-fields';
      const rows = new Map(); // param key -> its row (TASK 674: a row whose param does not apply with these values is hidden)
      const showRows = () => { for (const [k, row] of rows) row.hidden = !paramActive(t.params[k], values); };
      // a value changed: the rows that apply, the glyphs (with valid values) and the preview (once settled; at once for a pick)
      const changed = (now = false) => {
        showRows();
        if (!valid()) return;
        for (const el of [...pickers, ...cornerPickers]) el.dispatchEvent(new Event(REDRAW));
        clearTimeout(timer); timer = null;
        if (now) draw(); else timer = setTimeout(draw, PREVIEW_DELAY);
      };
      const err = document.createElement('div'); err.className = 'sk-tp-err'; err.setAttribute('role', 'alert');
      const inputs = new Map(); // param key -> its value box
      const sameForAll = (v) => (Array.isArray(v) ? (v.every((x) => x === v[0]) ? v[0] : null) : v); // a per-corner choice's one value, or null (mixed)
      // TASK 674 (owner: "joint type on the preview directly like in frame calc"): a choice the preview's corners carry is picked THERE only, not
      // also in a form row; a per-corner choice keeps its one row, the "Corner joint" row that sets every corner
      const onPreview = new Set(templateCorners(t).filter((c) => !t.params[c.param].perCorner).map((c) => c.param));
      for (const [k, spec] of Object.entries(t.params)) {
        if (onPreview.has(k)) continue;
        const row = document.createElement('div'); row.className = 'sk-tp-field'; row.dataset.param = k;
        rows.set(k, row);
        const kind = paramKind(spec);
        if (kind === 'choice') {
          const name = document.createElement('span'); name.className = 'sk-tp-label'; name.textContent = spec.label;
          // a per-corner choice's row sets EVERY corner; its glyph draws the first corner's angle (TASK 674)
          const firstCorner = () => { const c = templateCorners(t, values).find((x) => x.param === k); return c && { interior: c.interior }; };
          const el = choicePicker(spec, {
            read: () => (spec.perCorner ? sameForAll(values[k]) : values[k]),
            onPick: (v) => { values[k] = v; if (spec.perCorner) lastAll[k] = v; clearError(); changed(true); },
            values, corner: spec.perCorner ? firstCorner : () => undefined,
          });
          pickers.push(el);
          row.append(name, el);
        } else {
          const id = `sk-tp-f-${t.id}-${k}`;
          const label = document.createElement('label'); label.htmlFor = id; label.textContent = spec.label;
          const input = document.createElement('input'); input.id = id; input.className = 'sk-tp-input'; input.type = 'number';
          input.value = String(values[k]);
          if (kind === 'count') { input.step = '1'; input.min = String(spec.min); input.max = String(spec.max); input.inputMode = 'numeric'; } else { input.step = 'any'; input.min = '0'; input.inputMode = 'decimal'; }
          input.addEventListener('input', () => { values[k] = input.value.trim() === '' ? NaN : Number(input.value); clearError(); changed(); });
          const unit = document.createElement('span'); unit.className = 'sk-tp-unit'; unit.textContent = paramUnit(spec);
          row.append(label, input, unit);
          inputs.set(k, input);
        }
        fields.appendChild(row);
      }
      showRows();
      // ── TASK 674: the corner glyph pickers over the preview, one per corner of the drawing the preview shows ──
      function placeCorners() {
        const list = templateCorners(t, shown.values);
        layer.replaceChildren(); cornerPickers.length = 0;
        list.forEach((c) => {
          const k = c.param, spec = t.params[k], count = list.filter((x) => x.param === k).length;
          const el = choicePicker(spec, {
            read: () => (spec.perCorner ? (Array.isArray(values[k]) ? values[k][c.index] : values[k]) : values[k]),
            onPick: (v) => {
              if (spec.perCorner) { const each = Array.isArray(values[k]) ? [...values[k]] : Array(count).fill(values[k]); each[c.index] = v; values[k] = each; } else values[k] = v;
              refocus = { k, index: c.index }; clearError(); changed(true);
            },
            values, corner: () => c,
            onToggle: (open) => {
              if (open) for (const o of cornerPickers) if (o !== el) o.dispatchEvent(new Event(COLLAPSE)); // one corner open at a time
              fitInStage(el);
            },
          });
          el.classList.add('sk-tp-corner'); el.dataset.param = k;
          if (c.index != null) el.dataset.corner = String(c.index);
          el.setAttribute('aria-label', spec.perCorner ? `${spec.label}, corner ${c.index + 1}` : spec.label);
          layer.appendChild(el); cornerPickers.push(el);
        });
        layoutCorners(list);
        if (refocus) {
          const el = cornerPickers.find((x) => x.dataset.param === refocus.k && (refocus.index == null || x.dataset.corner === String(refocus.index)));
          refocus = null;
          if (el) el.querySelector('button:not([hidden])').focus();
        }
      }
      // each corner's picker (collapsed) sits off its corner along the corner's `out` direction: the nearest spot where it crosses no line of
      // the drawing, covers no dimension value and no other corner's picker (GLYPH_GAP apart), inside the stage. Pixel positions from the
      // preview's own viewBox fit.
      let laid = null;
      function layoutCorners(list = laid) {
        laid = list;
        const svg = prev.querySelector('svg'), sb = stage.getBoundingClientRect(), r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal;
        const s = Math.min(r.width / vb.width, r.height / vb.height);
        const ox = r.left - sb.left + (r.width - vb.width * s) / 2 - vb.x * s, oy = r.top - sb.top + (r.height - vb.height * s) / 2 - vb.y * s;
        const px = (p) => ({ x: ox + p.x * s, y: oy + p.y * s });
        const J = new Map(shown.doc.geometry.joints);
        const lines = shown.doc.geometry.shapes.filter((x) => x.type === 'line' && !x.isConstruction).map((x) => x.joints.map((id) => px(J.get(id))));
        const placed = [...prev.querySelectorAll('svg text')].map((e) => { const b = e.getBoundingClientRect(); return { x0: b.left - sb.left, y0: b.top - sb.top, x1: b.right - sb.left, y1: b.bottom - sb.top }; });
        cornerPickers.forEach((el, i) => {
          const c = list[i], at = px(c), w = el.offsetWidth, h = el.offsetHeight;
          const boxAt = (D) => {
            const x0 = Math.max(0, Math.min(sb.width - w, at.x + c.out.x * D - w / 2)), y0 = Math.max(0, Math.min(sb.height - h, at.y + c.out.y * D - h / 2));
            return { x0, y0, x1: x0 + w, y1: y0 + h };
          };
          let box = null;
          for (let D = 0; D <= sb.width + sb.height && !box; D += 2) {
            const b = boxAt(D), g = { x0: b.x0 - GLYPH_GAP, y0: b.y0 - GLYPH_GAP, x1: b.x1 + GLYPH_GAP, y1: b.y1 + GLYPH_GAP };
            if (!lines.some(([p, q]) => segmentHitsBox(p, q, g)) && !placed.some((o) => boxesOverlap(o, g))) box = b;
          }
          box = box || boxAt(0);
          placed.push(box);
          el.dataset.left = String(box.x0);
          el.style.left = `${box.x0}px`; el.style.top = `${box.y0}px`;
        });
      }
      // an expanded corner picker (wider) is moved left as far as it must to stay in the stage; folded, it goes back to its spot
      function fitInStage(el) {
        const left = Number(el.dataset.left), w = el.offsetWidth, room = stage.clientWidth;
        el.style.left = `${Math.max(0, Math.min(left, room - w))}px`;
      }
      const onResize = () => layoutCorners();
      const actions = document.createElement('div'); actions.className = 'sk-tp-actions';
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'sk-tp-btn sk-tp-cancel'; cancel.textContent = 'Cancel';
      const openBtn = document.createElement('button'); openBtn.type = 'button'; openBtn.className = 'sk-tp-btn sk-tp-open'; openBtn.textContent = 'Open';
      actions.append(cancel, openBtn);
      const open = () => {
        for (const [k, spec] of Object.entries(t.params)) { // the ONE value rule (#core/templates.js paramRefusal): the first refused value is named
          const why = paramActive(spec, values) && paramRefusal(spec, values[k]);
          if (!why) continue;
          err.textContent = why;
          const input = inputs.get(k);
          if (input) { input.setAttribute('aria-invalid', 'true'); input.focus(); }
          return;
        }
        draw(); // the values typed last (a pending preview is built now)
        if (!built || built.key !== JSON.stringify(values)) return; // they cannot be drawn: the error line says why
        finish({ template: t, document: structuredClone(built.doc), name: t.name }); // a copy: the document the picker keeps stays its own
      };
      openBtn.addEventListener('click', open);
      cancel.addEventListener('click', () => backToCards());
      // Enter in a value box opens (on a button, Enter is that button's own click)
      view.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT') { e.preventDefault(); open(); } });
      view.append(hasCorners ? stage : prev, fields, err, actions);
      draw();
      const cards = [...panel.children];
      const startHead = head(t.name);
      startHead.querySelector('.sk-tp-x').remove(); // the start view closes with Cancel / Esc (back to the cards) or Open
      panel.classList.add('sk-tp-small'); panel.classList.toggle('sk-tp-wide', hasCorners); panel.setAttribute('aria-label', t.name);
      panel.replaceChildren(startHead, view);
      if (hasCorners) { layoutCorners(); window.addEventListener('resize', onResize); stopStart = () => window.removeEventListener('resize', onResize); }
      backToCards = () => {
        backToCards = null;
        if (stopStart) { stopStart(); stopStart = null; }
        panel.classList.remove('sk-tp-small', 'sk-tp-wide'); panel.setAttribute('aria-label', 'New design');
        panel.replaceChildren(...cards);
        if (fromCard.isConnected) fromCard.focus();
      };
      openBtn.focus(hasCorners ? { preventScroll: true } : undefined); // TASK 674: the wide view's Open is always in view (kept at the bottom): the view opens at its top
    }
  });
}

/**
 * TASK 670: the GLYPH PICKER of a choice param (frame-calc's CornerJointPicker interaction, built with this app's own DOM): collapsed it shows only
 * the active option as its glyph; a tap expands it to every option; a pick selects that option and collapses it again. Each option is a 44 px
 * button named by its label (aria-label and title), aria-pressed on the active one. onPick(value) after every pick.
 * TASK 672: `values` = the start view's current values (read at each draw), given to each glyph (GLYPHS[glyph](option, { active, values }));
 * the event REDRAW on the picker draws its glyphs again (another value changed), keeping its state (expanded or not) and its buttons.
 * TASK 674: the picker READS its value (read(): the option, or null when it stands for several corners that differ: then no option is pressed
 * and, collapsed, it shows the option it showed last); corner() = the corner its glyphs are drawn for (#core/templates.js templateCorners), if
 * any; onToggle(expanded) after it expands or folds; the event COLLAPSE folds it (another corner's picker opened).
 */
export const REDRAW = 'sk-tp-redraw';
export const COLLAPSE = 'sk-tp-collapse';
export function choicePicker(spec, { read, onPick, values, corner = () => undefined, onToggle = () => {} }) {
  const wrap = document.createElement('div'); wrap.className = 'sk-tp-choice'; wrap.setAttribute('role', 'group'); wrap.setAttribute('aria-label', spec.label);
  let shown = read() ?? spec.default, expanded = false;
  const glyph = GLYPHS[spec.glyph];
  const buttons = spec.options.map((o) => {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.value = o.value;
    b.addEventListener('click', () => {
      if (!expanded) { expanded = true; render(); onToggle(true); return; }
      expanded = false; shown = o.value; onPick(o.value); render(); onToggle(false);
      if (b.isConnected) b.focus(); // (a corner's picker is rebuilt with the preview: its new one takes the focus)
    });
    return b;
  });
  function render() {
    const current = read();
    if (current != null) shown = current;
    wrap.dataset.expanded = expanded ? 'true' : 'false';
    wrap.dataset.mixed = current == null ? 'true' : 'false';
    const at = corner();
    spec.options.forEach((o, i) => {
      const b = buttons[i], active = o.value === current;
      const text = spec.optionLabel ? spec.optionLabel(o, values) : o.label;
      b.hidden = !expanded && o.value !== shown;
      b.setAttribute('aria-label', text); b.title = text;
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
      b.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      b.replaceChildren(glyph(o.value, { active, values, corner: at }));
    });
  }
  wrap.append(...buttons);
  wrap.addEventListener(REDRAW, render);
  wrap.addEventListener(COLLAPSE, () => { if (expanded) { expanded = false; render(); onToggle(false); } });
  render();
  return wrap;
}

/** TASK 681: the shared modal shell (backdrop + small panel, role=dialog aria-modal): `fill(body, actions, finish)` adds the content and the buttons; it returns the element to focus.
 *  Esc and a press outside finish(null). Focus goes back to where it was. */
function openSmallModal(label, fill) {
  injectStyles();
  const returnTo = document.activeElement;
  return new Promise((resolve) => {
    const backdrop = document.createElement('div'); backdrop.className = 'sk-tp-backdrop';
    const panel = document.createElement('div'); panel.className = PANEL + ' sk-tp-small'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', label);
    const head = document.createElement('div'); head.className = 'sk-tp-head';
    const title = document.createElement('h2'); title.className = 'sk-tp-title'; title.textContent = label; head.appendChild(title);
    const body = document.createElement('div'); body.className = 'sk-tp-ask';
    const actions = document.createElement('div'); actions.className = 'sk-tp-actions';
    panel.append(head, body); backdrop.appendChild(panel); document.body.appendChild(backdrop);
    let stopOutside = null, done = false;
    const finish = (value) => {
      if (done) return; done = true;
      if (stopOutside) stopOutside();
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      if (returnTo && returnTo.focus && returnTo.isConnected) returnTo.focus();
      resolve(value);
    };
    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); finish(null); } }
    document.addEventListener('keydown', onKey, true);
    stopOutside = listenOutsidePress((e) => { if (!e.composedPath().includes(panel)) finish(null); });
    const mk = (cls, text, id, onClick) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'sk-tp-btn ' + cls; b.textContent = text; b.dataset.choice = id; b.addEventListener('click', onClick); actions.appendChild(b); return b; };
    const focusEl = fill(body, mk, finish);
    body.appendChild(actions);
    focusEl.focus(); if (focusEl.select) focusEl.select();
  });
}

/** TASK 681: ask a question in this same modal (a dimmed backdrop, a centred small panel, role=dialog aria-modal): `label` is the question, `options` the answers
 *  [{ id, label }] (the first is the default: it is focused, so Enter picks it) and a Cancel button last. Resolves the chosen id; Cancel, Esc and a press outside resolve null. */
export function openChoiceModal({ label, options }) {
  return openSmallModal(label, (body, mk, finish) => {
    const btns = options.map((o, i) => mk(i === 0 ? 'sk-tp-open' : '', o.label, o.id, () => finish(o.id)));
    mk('sk-tp-cancel', 'Cancel', '__cancel', () => finish(null));
    return btns[0];
  });
}

/** TASK 681: a name prompt in the same modal: a text field (focused, selected), Save (Enter) and Cancel (Esc). Resolves the trimmed name, or null. */
export function openPromptModal({ label, value = '', okLabel = 'OK' }) {
  return openSmallModal(label, (body, mk, finish) => {
    const inp = document.createElement('input'); inp.type = 'text'; inp.className = 'sk-tp-input sk-tp-name-input'; inp.value = value; inp.setAttribute('aria-label', label); inp.style.width = '100%';
    body.appendChild(inp);
    const ok = () => { const v = inp.value.trim(); if (v) finish(v); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } });
    mk('sk-tp-open', okLabel, 'ok', ok); mk('sk-tp-cancel', 'Cancel', '__cancel', () => finish(null));
    return inp;
  });
}
