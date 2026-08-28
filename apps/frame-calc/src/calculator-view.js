// apps/frame-calc's Trapezoid calculator: form + SVG preview, ported to plain DOM code from
// geometric-frame-calc/trapezoid-frame-calculator/src/{TrapezoidCalculator,TrapezoidControlsPanel,
// TrapezoidCanvasView}.js. Mechanical port, not a redesign — same 3 primary dimension sliders
// (bottom width / top width / height) + thickness, same live numeric readouts, same 4-stat info strip
// (per-corner joint type + saw gauge), same overall shape drawn as filled board polygons between the
// outer and inner rings.
//
// SLICE 0 PARITY (turn 396): the per-corner joint-type picker, the Plywood Sheathing Shell, and Target
// Dimension Mode are now ported — see the ground-truth read of TrapezoidCalculator.js/ControlsPanel.js/
// CanvasView.js in WORK-LOG before assuming any of this. Deliberately still NOT ported (noted, not
// silently dropped — the dispatch's own "don't blind-port 443 lines" permission): the original's
// click-to-edit-on-canvas dimension inputs, zoom/pan canvas, PNG export, DualAngleArc corner-angle
// arcs, hand-tuned per-board dimension-line collision offsets, and the locked-glow pulse animation. The
// Sketch view already gives REAL interactive dimension editing backed by the actual constraint solver
// (click a shape, edit its dimension) — materially better than the calculator preview's fake overlay
// math, so re-implementing that whole subsystem here would be redundant, not "parity." The calculator's
// own number/slider inputs stay the primary way to edit dimensions HERE, matching this file's own
// pre-existing comment that "the sketch view is where real, editable dimensions live for this app."
//
// The per-corner joint picker is simplified from the original's expand-to-3-choices JointPicker menu to
// a single click-to-CYCLE (Miter -> CW-Through -> CCW-Through -> Miter) on the same in-canvas glyph —
// same functional outcome (spatial, in-canvas, not a form dropdown), much less UI machinery; the glyph
// RENDERING itself (quad-joint-glyph.js) is a faithful port of the original's QuadJointGlyph, per the
// dispatch's explicit "reuse it" instruction.

import { calculateQuadFrameGeometry, formatDim } from '#core/frame-geometry.js';
import { mapTrapezoidVertices } from './trapezoid-mapper.js';
import { quadJointGlyph } from './quad-joint-glyph.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const JOINT_TYPES = ['Miter', 'CW-Through', 'CCW-Through'];
const JOINT_LABEL = { Miter: 'Miter', 'CW-Through': 'CW Through', 'CCW-Through': 'CCW Through' };

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
  const previewWrap = previewEl.parentElement;
  if (previewWrap) previewWrap.style.position = previewWrap.style.position || 'relative';

  const state = {
    bottomWidth: 24,
    topWidth: 12,
    height: 10,
    thick: 1.5,
    unitMode: 'fraction', // 'fraction' | 'decimal'
    precision: 16,        // fraction denominator (unitMode='fraction') or decimal places ('decimal')
    // SLICE 0 — per-corner joint types (default all Miter, matching the original's own default).
    joints: ['Miter', 'Miter', 'Miter', 'Miter'],
    // SLICE 0 — Plywood Sheathing Shell.
    enableShell: false,
    shellOffset: 1.0,
    // SLICE 0 — Target Dimension Mode: 'inside' (the frame) or 'outside' (the shell), governs what an
    // edited bottom/top/height value is taken to mean when the shell is enabled.
    shellDimMode: 'inside',
  };

  function geom() {
    return calculateQuadFrameGeometry({
      P: mapTrapezoidVertices(state),
      thick: state.thick,
      joints: state.joints,
      shellOffset: state.enableShell ? state.shellOffset : 0,
    });
  }

  function fmt(n) { return formatDim(n, state.precision, state.unitMode); }

  const targetingShellOutside = () => state.enableShell && state.shellDimMode === 'outside';

  // Outward-facing edits under shell-outside targeting describe the SHELL, not the frame — back the
  // shell offset out before storing (verbatim port of TrapezoidCalculator.js's handleEditDim math: for a
  // symmetric trapezoid, offsetting the boundary outward by shellOffset widens the bottom/top edges by
  // 2*shellOffset/tan(cornerAngle/2) each, and adds 2*shellOffset straight to height since those edges
  // are parallel). Uses the CURRENT (pre-edit) angle — a single-step approximation, exact at rest and
  // self-correcting on the next edit, same as the original.
  function frameValueFor(key, typedVal, g) {
    if (!targetingShellOutside()) return typedVal;
    if (key === 'bottomWidth') {
      const a = g.interiorAnglesDeg[0] * Math.PI / 180;
      return typedVal - 2 * state.shellOffset / Math.tan(a / 2);
    }
    if (key === 'topWidth') {
      const a = g.interiorAnglesDeg[1] * Math.PI / 180;
      return typedVal - 2 * state.shellOffset / Math.tan(a / 2);
    }
    if (key === 'height') return typedVal - 2 * state.shellOffset;
    return typedVal;
  }

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
      const g = geom(); // pre-edit geom, for the shell-outside back-calculation above
      const frameVal = frameValueFor(key, n, g);
      state[key] = Math.min(max, Math.max(min, frameVal));
      range.value = state[key];
      number.value = state[key];
      recompute();
    };
    range.addEventListener('input', () => commit(range.value));
    number.addEventListener('change', () => commit(number.value));
    readouts[key] = { valueSpan, range, number };
    return row;
  }

  const cornerStatEls = [0, 1, 2, 3].map(() => ({ type: el('b'), gauge: el('b') }));

  function buildForm() {
    formEl.innerHTML = '';
    const dimsCard = el('div', { class: 'fc-card' }, [
      el('h2', { text: 'Trapezoid Configuration' }),
      sliderField('bottomWidth', 'Bottom Width', { min: 2, max: 120, step: 0.0625, accent: '#7c3aed' }),
      sliderField('topWidth', 'Top Width', { min: 2, max: 120, step: 0.0625, accent: '#059669' }),
      sliderField('height', 'Height', { min: 2, max: 120, step: 0.0625, accent: '#0284c7' }),
      el('div', { class: 'fc-stats fc-corner-stats' }, [0, 1, 2, 3].map((k) =>
        el('span', {}, [document.createTextNode(`Corner ${k + 1}: `), cornerStatEls[k].type, document.createTextNode(' — '), cornerStatEls[k].gauge]))),
    ]);
    const thickCard = el('div', { class: 'fc-card' }, [
      el('h2', { text: 'Board Thickness' }),
      sliderField('thick', 'All Sides', { min: 0.5, max: 5.5, step: 0.0625, accent: '#2563eb' }),
    ]);

    // SLICE 0 — Plywood Sheathing Shell card.
    const shellToggleBtn = el('button', { type: 'button', class: 'fc-toggle', text: state.enableShell ? 'ON' : 'OFF' });
    const shellBody = el('div', { class: 'fc-shell-body' });
    function renderShellBody() {
      shellBody.innerHTML = '';
      if (!state.enableShell) {
        shellBody.appendChild(el('p', { class: 'fc-hint', text: 'Sheathing shell is disabled. Toggle ON to add sheathing clearance and a shell target mode.' }));
        return;
      }
      shellBody.appendChild(sliderField('shellOffset', 'Shell Clearance', { min: 0, max: 5, step: 0.0625, accent: '#d97706' }));
      const modeRow = el('div', { class: 'fc-dimmode' });
      const insideBtn = el('button', { type: 'button', class: 'fc-dimmode-btn' + (state.shellDimMode === 'inside' ? ' active' : ''), text: 'Wood Frame (Inside)' });
      const outsideBtn = el('button', { type: 'button', class: 'fc-dimmode-btn' + (state.shellDimMode === 'outside' ? ' active' : ''), text: 'Sheathing Shell (Outside)' });
      insideBtn.addEventListener('click', () => { state.shellDimMode = 'inside'; renderShellBody(); });
      outsideBtn.addEventListener('click', () => { state.shellDimMode = 'outside'; renderShellBody(); });
      modeRow.append(el('span', { class: 'fc-hint', text: 'Target Dimension Mode' }), insideBtn, outsideBtn);
      shellBody.appendChild(modeRow);
    }
    renderShellBody();
    shellToggleBtn.addEventListener('click', () => {
      state.enableShell = !state.enableShell;
      shellToggleBtn.textContent = state.enableShell ? 'ON' : 'OFF';
      shellToggleBtn.classList.toggle('active', state.enableShell);
      renderShellBody();
      recompute();
    });
    const shellCard = el('div', { class: 'fc-card' }, [
      el('div', { class: 'fc-card-head' }, [el('h2', { text: 'Plywood Sheathing Shell' }), shellToggleBtn]),
      shellBody,
    ]);

    formEl.append(dimsCard, thickCard, shellCard);
    // sliderField() calls above replaced readouts.thick etc; re-bind shellOffset's row each render
    // since renderShellBody() rebuilds it (only exists while enableShell is true).
  }

  // ── preview (SVG) ─────────────────────────────────────────────────────────
  // Corner-glyph overlay buttons live in previewWrap (HTML, positioned over the SVG) so they can use
  // quad-joint-glyph.js's real SVG rendering inside a clickable button, matching the original's
  // in-canvas (not dropdown) design.
  let cornerButtons = [];
  function ensureCornerButtons() {
    if (cornerButtons.length) return;
    for (let k = 0; k < 4; k++) {
      const btn = el('button', { type: 'button', class: 'fc-joint-glyph', title: '' });
      btn.addEventListener('click', () => {
        const i = JOINT_TYPES.indexOf(state.joints[k]);
        state.joints[k] = JOINT_TYPES[(i + 1) % JOINT_TYPES.length];
        recompute();
      });
      previewWrap.appendChild(btn);
      cornerButtons.push(btn);
    }
  }

  function drawPreview(g) {
    while (previewEl.firstChild) previewEl.removeChild(previewEl.firstChild);
    const pts = [...g.P, ...g.Q, ...(state.enableShell ? g.S : [])];
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
    const pad = Math.max(w, h) * 0.35;
    const vbx = minX - pad, vby = minY - pad, vbw = w + pad * 2, vbh = h + pad * 2;
    previewEl.setAttribute('viewBox', `${vbx} ${vby} ${vbw} ${vbh}`);
    const scale = Math.max(w, h) / 100;

    // Shell ring (dashed amber), gated on enableShell.
    if (state.enableShell) {
      previewEl.appendChild(svgEl('polygon', {
        points: g.S.map((p) => `${p.x},${p.y}`).join(' '), fill: 'rgba(251,191,36,0.08)', stroke: '#d97706',
        'stroke-width': scale * 0.6, 'stroke-dasharray': `${scale * 2.4},${scale * 1.8}`,
      }));
    }
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

    const labelStyle = { 'font-size': scale * 6, fill: '#1e293b', 'text-anchor': 'middle', 'font-family': 'system-ui, sans-serif', 'font-weight': '600' };
    const label = (x, y, text) => { const t = svgEl('text', { x, y, ...labelStyle }); t.textContent = text; previewEl.appendChild(t); };
    label((g.P[0].x + g.P[3].x) / 2, g.P[0].y + scale * 9, `${fmt(state.bottomWidth)} bottom`);
    label((g.P[1].x + g.P[2].x) / 2, g.P[1].y - scale * 4, `${fmt(state.topWidth)} top`);
    const heightLabelY = (g.P[0].y + g.P[1].y) / 2 + (state.enableShell ? scale * 8 : 0); // shift down when the shell label (above) also occupies this edge
    label(g.P[0].x - scale * 9, heightLabelY, `${fmt(state.height)} h`);
    // Shell dims (reference-style — the shell is derived, not directly typed) — shown in parentheses,
    // matching how svg-renderer.js already draws a REFERENCE dimension vs. a driving one.
    if (state.enableShell) {
      const shellStyle = { ...labelStyle, fill: '#92400e' };
      const slabel = (x, y, text) => { const t = svgEl('text', { x, y, ...shellStyle }); t.textContent = `(${text})`; previewEl.appendChild(t); };
      const shellBottomW = Math.hypot(g.S[0].x - g.S[3].x, g.S[0].y - g.S[3].y);
      const shellTopW = Math.hypot(g.S[1].x - g.S[2].x, g.S[1].y - g.S[2].y);
      const shellH = Math.abs(g.S[0].y - g.S[1].y);
      slabel((g.S[0].x + g.S[3].x) / 2, g.S[0].y + scale * 15, `${fmt(shellBottomW)} shell bottom`);
      slabel((g.S[1].x + g.S[2].x) / 2, g.S[1].y - scale * 10, `${fmt(shellTopW)} shell top`);
      slabel(g.S[0].x - scale * 18, (g.S[0].y + g.S[1].y) / 2 - scale * 8, `${fmt(shellH)} shell h`);
    }

    // Reposition the corner joint-glyph buttons over their P vertices. previewEl fits its wrapper via
    // preserveAspectRatio="xMidYMid meet" — replicate that letterbox math (uniform scale, centered) to
    // place HTML overlay buttons at the right pixel spot rather than assuming a naive % mapping (which
    // would be wrong whenever the wrapper's aspect ratio doesn't match the viewBox's).
    ensureCornerButtons();
    const rect = previewWrap.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      const s = Math.min(rect.width / vbw, rect.height / vbh);
      const padX = (rect.width - vbw * s) / 2, padY = (rect.height - vbh * s) / 2;
      const cx = g.P.reduce((s, p) => s + p.x, 0) / 4, cy = g.P.reduce((s, p) => s + p.y, 0) / 4;
      g.P.forEach((p, k) => {
        const px = padX + (p.x - vbx) * s, py = padY + (p.y - vby) * s;
        const btn = cornerButtons[k];
        const size = 34;
        btn.style.cssText = `position:absolute;left:${px}px;top:${py}px;width:${size}px;height:${size}px;transform:translate(${p.x >= cx ? '0%' : '-100%'},${p.y >= cy ? '0%' : '-100%'}) translate(${p.x >= cx ? 4 : -4}px,${p.y >= cy ? 4 : -4}px);`;
        btn.title = `Corner ${k + 1}: ${JOINT_LABEL[state.joints[k]]} (click to change)`;
        btn.innerHTML = '';
        const rotation = Math.atan2(py - (padY + (cy - vby) * s), px - (padX + (cx - vbx) * s)) * 180 / Math.PI + 90;
        btn.appendChild(quadJointGlyph(state.joints[k], true, g.interiorAnglesDeg[k], rotation));
      });
    }
  }

  function recompute() {
    const g = geom();
    readouts.bottomWidth.valueSpan.textContent = fmt(state.bottomWidth);
    readouts.topWidth.valueSpan.textContent = fmt(state.topWidth);
    readouts.height.valueSpan.textContent = fmt(state.height);
    readouts.thick.valueSpan.textContent = fmt(state.thick);
    if (state.enableShell && readouts.shellOffset) readouts.shellOffset.valueSpan.textContent = fmt(state.shellOffset);
    for (let k = 0; k < 4; k++) {
      cornerStatEls[k].type.textContent = JOINT_LABEL[state.joints[k]];
      cornerStatEls[k].gauge.textContent = `${g.cutList[k].topSawGauge.toFixed(1)}°`;
    }
    drawPreview(g);
    if (typeof onChange === 'function') onChange(g, state);
    return g;
  }

  buildForm();
  recompute();
  window.addEventListener('resize', () => drawPreview(geom())); // reposition overlay buttons on layout change

  return {
    get state() { return state; },
    geom,
    recompute,
  };
}
