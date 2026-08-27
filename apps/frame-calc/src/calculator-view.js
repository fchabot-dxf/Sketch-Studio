// apps/frame-calc's Trapezoid calculator: form + SVG preview, ported to plain DOM code from
// geometric-frame-calc/trapezoid-frame-calculator/src/{TrapezoidCalculator,TrapezoidControlsPanel,
// TrapezoidCanvasView}.js. Mechanical port, not a redesign — same 3 primary dimension sliders
// (bottom width / top width / height) + thickness, same live numeric readouts, same 4-stat info strip
// (base/top corner angle + base/top saw gauge), same overall shape drawn as filled board polygons
// between the outer and inner rings.
//
// Deliberately trimmed for this cycle (noted in WORK-LOG, not silently dropped): the plywood-shell
// clearance feature (toggle + slider + inside/outside dim mode) and the per-vertex joint-type picker
// (Miter/CW-Through/CCW-Through UI) — every board defaults to 'Miter' at all 4 corners, matching the
// original tool's own default. Neither is needed to prove the CAD-toggle pattern this cycle; both are
// straightforward to port later using the same calculateQuadFrameGeometry inputs.

import { calculateQuadFrameGeometry, formatDim } from '#core/frame-geometry.js';
import { mapTrapezoidVertices } from './trapezoid-mapper.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const JOINTS = ['Miter', 'Miter', 'Miter', 'Miter']; // all 4 vertices — see the trim note above

function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) e.appendChild(c);
  return e;
}
function svgEl(tag, attrs = {}) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

export function createCalculatorView({ formEl, previewEl, onChange }) {
  const state = {
    bottomWidth: 24,
    topWidth: 12,
    height: 10,
    thick: 1.5,
    unitMode: 'fraction', // 'fraction' | 'decimal'
    precision: 16,        // fraction denominator (unitMode='fraction') or decimal places ('decimal')
  };

  function geom() {
    return calculateQuadFrameGeometry({
      P: mapTrapezoidVertices(state),
      thick: state.thick,
      joints: JOINTS,
    });
  }

  function fmt(n) { return formatDim(n, state.precision, state.unitMode); }

  // ── form ───────────────────────────────────────────────────────────────
  let readouts = {}; // field -> {span, range, number}

  function sliderField(key, label, { min, max, step, accent }) {
    const valueSpan = el('span', { style: `color:${accent}`, text: fmt(state[key]) });
    const head = el('div', { class: 'fc-field-head' }, [el('span', { text: label }), valueSpan]);
    const range = el('input', { type: 'range', min, max, step, value: state[key] });
    const number = el('input', { type: 'number', min, max, step, value: state[key] });
    const row = el('div', { class: 'fc-field' }, [head, range, number]);
    const commit = (v) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return;
      state[key] = Math.min(max, Math.max(min, n));
      range.value = state[key];
      number.value = state[key];
      recompute();
    };
    range.addEventListener('input', () => commit(range.value));
    number.addEventListener('change', () => commit(number.value));
    readouts[key] = { valueSpan, range, number };
    return row;
  }

  const statBaseAngle = el('span');
  const statTopAngle = el('span');
  const statBaseGauge = el('b');
  const statTopGauge = el('b');

  function buildForm() {
    formEl.innerHTML = '';
    const dimsCard = el('div', { class: 'fc-card' }, [
      el('h2', { text: 'Trapezoid Configuration' }),
      sliderField('bottomWidth', 'Bottom Width', { min: 2, max: 120, step: 0.0625, accent: '#7c3aed' }),
      sliderField('topWidth', 'Top Width', { min: 2, max: 120, step: 0.0625, accent: '#059669' }),
      sliderField('height', 'Height', { min: 2, max: 120, step: 0.0625, accent: '#0284c7' }),
      el('div', { class: 'fc-stats' }, [
        el('span', {}, [document.createTextNode('Base Corner: '), statBaseAngle]),
        el('span', {}, [document.createTextNode('Top Corner: '), statTopAngle]),
        el('span', {}, [document.createTextNode('Base Saw Gauge: '), statBaseGauge]),
        el('span', {}, [document.createTextNode('Top Saw Gauge: '), statTopGauge]),
      ]),
    ]);
    const thickCard = el('div', { class: 'fc-card' }, [
      el('h2', { text: 'Board Thickness' }),
      sliderField('thick', 'All Sides', { min: 0.5, max: 5.5, step: 0.0625, accent: '#2563eb' }),
    ]);
    formEl.append(dimsCard, thickCard);
  }

  // ── preview (SVG) ─────────────────────────────────────────────────────────
  function drawPreview(g) {
    while (previewEl.firstChild) previewEl.removeChild(previewEl.firstChild);
    const pts = [...g.P, ...g.Q];
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
    const pad = Math.max(w, h) * 0.35;
    previewEl.setAttribute('viewBox', `${minX - pad} ${minY - pad} ${w + pad * 2} ${h + pad * 2}`);
    const scale = Math.max(w, h) / 100;

    // Outer reference polygon P (dashed slate).
    previewEl.appendChild(svgEl('polygon', {
      points: g.P.map((p) => `${p.x},${p.y}`).join(' '), fill: 'none', stroke: '#94a3b8',
      'stroke-width': scale * 0.6, 'stroke-dasharray': `${scale * 2},${scale * 1.5}`,
    }));
    // Each board, filled.
    for (const b of g.boards) {
      previewEl.appendChild(svgEl('polygon', {
        points: `${b.p1.x},${b.p1.y} ${b.p2.x},${b.p2.y} ${b.p3.x},${b.p3.y} ${b.p4.x},${b.p4.y}`,
        fill: '#dbeafe', stroke: '#2563eb', 'stroke-width': scale * 1,
      }));
    }
    // Inner polygon Q (dashed).
    previewEl.appendChild(svgEl('polygon', {
      points: g.Q.map((p) => `${p.x},${p.y}`).join(' '), fill: 'none', stroke: '#64748b',
      'stroke-width': scale * 0.5, 'stroke-dasharray': `${scale * 1.5},${scale * 1.5}`,
    }));
    // Vertex markers.
    for (const p of g.P) {
      previewEl.appendChild(svgEl('circle', { cx: p.x, cy: p.y, r: scale * 2, fill: '#2563eb', stroke: '#fff', 'stroke-width': scale * 0.6 }));
    }
    // Dimension labels — bottom width, top width, height (plain text, not the fancy click-to-edit
    // dimension-line component the original tool has; the sketch view is where real, editable
    // dimensions live for this app).
    const labelStyle = { 'font-size': scale * 6, fill: '#1e293b', 'text-anchor': 'middle', 'font-family': 'system-ui, sans-serif', 'font-weight': '600' };
    const label = (x, y, text) => { const t = svgEl('text', { x, y, ...labelStyle }); t.textContent = text; previewEl.appendChild(t); };
    label((g.P[0].x + g.P[3].x) / 2, g.P[0].y + scale * 9, `${fmt(state.bottomWidth)} bottom`);
    label((g.P[1].x + g.P[2].x) / 2, g.P[1].y - scale * 4, `${fmt(state.topWidth)} top`);
    label(g.P[0].x - scale * 9, (g.P[0].y + g.P[1].y) / 2, `${fmt(state.height)} h`);
  }

  function recompute() {
    const g = geom();
    readouts.bottomWidth.valueSpan.textContent = fmt(state.bottomWidth);
    readouts.topWidth.valueSpan.textContent = fmt(state.topWidth);
    readouts.height.valueSpan.textContent = fmt(state.height);
    readouts.thick.valueSpan.textContent = fmt(state.thick);
    statBaseAngle.textContent = `${g.interiorAnglesDeg[0].toFixed(1)}°`;
    statTopAngle.textContent = `${g.interiorAnglesDeg[1].toFixed(1)}°`;
    statBaseGauge.textContent = `${g.cutList[0].topSawGauge.toFixed(1)}°`;
    statTopGauge.textContent = `${g.cutList[1].topSawGauge.toFixed(1)}°`;
    drawPreview(g);
    if (typeof onChange === 'function') onChange(g, state);
    return g;
  }

  buildForm();
  recompute();

  return {
    get state() { return state; },
    geom,
    recompute,
  };
}
