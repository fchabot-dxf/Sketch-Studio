// tests/audits/dimension-audit-1003-kit.js -- TASK 1003 (AUDIT ONLY, outside the gate)
// Shared Node probe kit for the focused Dimension Tool audit.
// Adapted from tests/audits/solver-ux-audit-1000-kit.js (origin/agents/solveraudit-1000) with attribution,
// extended with dimension-specific inspection, pick/place, label-read, and ribbon helpers.
import { open, createProfile, createNamedDesign } from '../helpers/node-app.js';
import { findLabel, labelEl } from '../helpers/node-dom-read.js';
import SettingsManager from '#core/settings-manager.js';
import { measureResidual } from '#core/constraint-verifier.js';
import { analyzeConstraintStatus } from '#core/constraint-status.js';
import { setConstraintNotifier } from '#core/constraint-manager.js';
import { showNotification } from '#ui/notification-manager.js';
import { resetDimensionState } from '#ui/input-handlers/dimension-tool.js';

SettingsManager.set('GRID_MAGNETISM', 0.001, { persist: 'none' });

export const f = (v, d = 3) => (typeof v === 'number' ? (Math.abs(v) < 5e-7 ? '0' : v.toFixed(d).replace(/\.?0+$/, '')) : String(v));
export const pt = (p) => (p ? `(${f(p.x)}, ${f(p.y)})` : 'null');
export const row = (id, text) => console.log(`ROW ${id} | ${text}`);

const realLog = console.log;
export async function quiet(fn) {
  console.log = () => {};
  const w = console.warn;
  console.warn = () => {};
  try { return await fn(); } finally { console.log = realLog; console.warn = w; }
}

export function design(joints, shapes, constraints = [], parameters = []) {
  return {
    version: 3,
    hosts: {},
    geometry: {
      joints: [
        ['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }],
        ...Object.entries(joints).map(([id, [x, y, fixed, extra]]) => [id, { x, y, fixed: !!fixed, sketchId: 'sketch-1', ...(extra || {}) }]),
      ],
      shapes: shapes.map((s) => ({ sketchId: 'sketch-1', isConstruction: false, ...s })),
      constraints,
      parameters,
      sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }],
      activeSketchId: 'sketch-1',
      groups: [],
      profiles: [],
    },
  };
}

let app = null;

export async function openDesign(doc, { centre = { x: 40, y: 20 }, w = 260, width = 1600, height = 900, host = 'sketchstudio' } = {}) {
  if (app) {
    try { resetDimensionState(app.state); } catch (_) {}
    await app.close();
    app = null;
  }
  const profile = await createProfile();
  await quiet(async () => {
    await createNamedDesign(profile, host, 'DimAudit 1003', doc);
    app = await open({ host, profile, width, height });
  });
  setConstraintNotifier(showNotification);
  const st = app.state;
  app.tool('select');
  resetDimensionState(st);
  const r = app.svg.getBoundingClientRect();
  Object.assign(st.view, { x: centre.x, y: centre.y, w });
  st.view.h = st.view.w / (r.width / r.height);
  app.svg.setAttribute('viewBox', `${st.view.x - st.view.w / 2} ${st.view.y - st.view.h / 2} ${st.view.w} ${st.view.h}`);
  app.frames();
  return app;
}

export async function closeAll() {
  if (app) {
    try { resetDimensionState(app.state); } catch (_) {}
    await app.close();
    app = null;
  }
}

export const theApp = () => app;
export const J = (id) => { const j = app.state.joints.get(id); return j ? { x: j.x, y: j.y } : null; };
export const S = (id) => app.state.shapes.find((s) => s && s.id === id) || null;
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const snapshot = () => new Map([...app.state.joints].map(([id, j]) => [id, { x: j.x, y: j.y }]));

export function moved(a, b = snapshot()) {
  let m = 0, who = null;
  for (const [id, p] of a) {
    const q = b.get(id);
    if (!q) continue;
    const d = dist(p, q);
    if (d > m) { m = d; who = id; }
  }
  return { max: m, who, gone: [...a.keys()].filter((id) => !b.has(id)), added: [...b.keys()].filter((id) => !a.has(id)) };
}

export const movedText = (a, b) => {
  const m = moved(a, b);
  return `maxMove=${f(m.max, 4)}${m.who ? '(' + m.who + ')' : ''}${m.gone.length ? ' gone=' + m.gone : ''}`;
};

export function residual() {
  const st = app.state;
  let max = 0, worst = null;
  for (const c of st.constraints) {
    if (!c || c.driven || c.isDriven || c.type === 'mouse_spring') continue;
    let r;
    try { r = measureResidual(c, st.joints, st.shapes); } catch (_) { r = NaN; }
    if (!(r <= max)) { max = r; worst = c; }
  }
  return { max, worst: worst ? `${worst.type}${worst.name ? ' ' + worst.name : ''}` : null };
}

export const residualText = () => {
  const r = residual();
  return r.max < 1e-6 ? 'res=ok' : `res=${f(r.max, 5)}(${r.worst})`;
};

export function status() {
  const st = app.state;
  const s = analyzeConstraintStatus({
    joints: st.joints,
    shapes: st.shapes,
    constraints: st.constraints.filter((c) => c && c.type !== 'mouse_spring'),
    groups: st.groups,
  });
  const shapes = {};
  for (const sh of st.shapes) {
    if (String(sh.id).startsWith('ref_')) continue;
    shapes[sh.id] = s.fixedShapes.has(sh.id) ? 'fixed' : s.constrainedShapes.has(sh.id) ? 'constrained' : 'free';
  }
  return { dof: s.dof, shapes };
}

export const toasts = () => [...app.document.querySelectorAll('#notification-container [data-level]')].map((e) => `[${e.dataset.level}] ${e.textContent.trim().replace(/\s+/g, ' ').slice(0, 160)}`);
export const clearToasts = () => app.document.querySelectorAll('#notification-container [data-level]').forEach((e) => e.remove());
export const boxEl = () => app.document.getElementById('dimInput');
export const hintEl = () => app.document.getElementById('dimHint');
export const completeEl = () => app.document.getElementById('dimComplete');
export const boxOpen = () => { const el = boxEl(); return !!el && !el.classList.contains('hidden'); };
export const hintText = () => { const h = hintEl(); return h && !h.classList.contains('hidden') ? h.textContent.trim().replace(/\s+/g, ' ').slice(0, 160) : ''; };

export function dimSummary(c) {
  if (!c) return 'null';
  const parts = [`${c.name || '?'}:${c.type}`];
  if (c.dimMode) parts.push(`mode=${c.dimMode}`);
  if (c.isRadius) parts.push(c.isDiameter ? 'DIAM' : 'RAD');
  if (c.shape) parts.push(`sh=${c.shape}`);
  if (c.shapes) parts.push(`shs=[${c.shapes.join(',')}]`);
  if (c.joints) parts.push(`js=[${c.joints.join(',')}]`);
  if (typeof c.value === 'number') parts.push(`v=${f(c.value, 3)}`);
  if (c.expression) parts.push(`expr="${c.expression}"`);
  if (c.isDriven || c.driven) parts.push('REF');
  if (c.__placing) parts.push('PLACING');
  if (c.sector) parts.push(`sec=${JSON.stringify(c.sector)}`);
  return parts.join(' ');
}

export function allDims() {
  return app.state.constraints.filter((c) => c && (c.type === 'distance' || c.type === 'angle' || (c.type === 'offset' && c.dimensioned !== false)));
}

export function labelTextOf(c) {
  const idx = app.state.constraints.indexOf(c);
  if (idx < 0) return null;
  app.frames();
  const el = labelEl(app, idx);
  if (!el) return null;
  const txt = el.querySelector('text');
  return txt ? txt.textContent.trim() : el.textContent.trim();
}

export async function moveW(w, opts = {}) {
  const p = app.toScreen(w.x, w.y);
  await quiet(() => { app.move(p.x, p.y, opts); });
  return p;
}

export async function clickW(w, opts = {}) {
  const p = app.toScreen(w.x, w.y);
  await quiet(() => {
    app.move(p.x, p.y);
    app.down(p.x, p.y, opts);
    app.up(p.x, p.y, opts);
  });
  app.frames();
  return p;
}

export async function dragWorld(from, to, steps = 20, o = {}) {
  return quiet(async () => {
    const a = app.toScreen(from.x, from.y), b = app.toScreen(to.x, to.y);
    app.move(a.x, a.y);
    app.down(a.x, a.y, o.downOpts || {});
    const d = app.state.drag;
    const kind = d ? (d.id ? 'joint ' + d.id : (d.type || d.kind || 'drag')) : 'none';
    for (let k = 1; k <= steps; k++) {
      if (o.stepMs) await app.pause(o.stepMs);
      app.move(a.x + (b.x - a.x) * k / steps, a.y + (b.y - a.y) * k / steps, { buttons: 1 });
    }
    if (!o.hold) app.up(b.x, b.y);
    app.frames();
    return { started: !!d, kind };
  });
}

export const dim = (name) => app.state.constraints.find((c) => c && c.name === name);

export async function editDim(name, text, { tool = 'select', commit = 'enter' } = {}) {
  const st = app.state;
  const idx = st.constraints.indexOf(dim(name));
  if (idx < 0) return { opened: false, why: 'no dimension ' + name };
  app.tool(tool);
  if (tool === 'select') app.esc();
  clearToasts();
  const el = () => labelEl(app, idx);
  if (!el()) return { opened: false, why: 'no label on canvas' };
  const g = st.constraints[idx].glyphPos;
  const p = app.toScreen(g.x, g.y);
  await app.pause(550);
  await quiet(async () => { app.dblclick(p.x, p.y, { target: el }); });
  try { await app.waitFor(boxOpen, 'edit box', 600); } catch { return { opened: false, why: 'box did not open', toasts: toasts() }; }
  const h0 = st.history.length;
  const r0 = st.redoStack ? st.redoStack.length : 0;
  await quiet(async () => {
    const i = boxEl();
    i.focus();
    i.select();
    app.key('a', { ctrl: true });
    if (text !== null) app.type(text);
    if (commit === 'enter') app.enter();
    else if (commit === 'esc') app.esc();
    else if (commit === 'tab') app.key('Tab');
  });
  app.frames();
  const res = {
    opened: true,
    boxStillOpen: boxOpen(),
    boxText: boxEl().value,
    hint: hintText(),
    invalid: boxEl().getAttribute('aria-invalid') === 'true',
    toasts: toasts(),
    undoSteps: st.history.length - h0,
    redoDelta: (st.redoStack ? st.redoStack.length : 0) - r0,
  };
  if (res.boxStillOpen) await quiet(() => { app.esc(); });
  app.frames();
  return res;
}

export { findLabel, labelEl, resetDimensionState };
