// tests/audits/solver-ux-audit-1000-kit.js -- TASK 1000 (AUDIT, outside the gate): what the probes of tests/audits/solver-ux-audit-1000-*.mjs share.
// Every probe opens the REAL SketchStudio Design tab in Node through tests/helpers/node-app.js (the page's own pointer / key listeners, tools,
// value box, undo history, autosave) on a stored design, drives it with pointer and key events as a user does, and PRINTS what happened
// (one `ROW <id> | ...` line per observation). Nothing is asserted: the probes exit 0 whatever they see (docs/SOLVER-UX-AUDIT-1000.md reads the rows).
import { open, createProfile, createNamedDesign } from '../helpers/node-app.js';
import { findLabel, labelEl } from '../helpers/node-dom-read.js';
import SettingsManager from '#core/settings-manager.js';
import { measureResidual } from '#core/constraint-verifier.js';
import { analyzeConstraintStatus } from '#core/constraint-status.js';
import { setConstraintNotifier } from '#core/constraint-manager.js';
import { showNotification } from '#ui/notification-manager.js';

SettingsManager.set('GRID_MAGNETISM', 0.001, { persist: 'none' }); // no grid magnet: the cursor is what is followed (as tests/drag-like-fusion-node.test.js)

export const f = (v, d = 3) => (typeof v === 'number' ? (Math.abs(v) < 5e-7 ? '0' : v.toFixed(d).replace(/\.?0+$/, '')) : String(v));
export const pt = (p) => (p ? `(${f(p.x)}, ${f(p.y)})` : 'null');
export const row = (id, text) => console.log(`ROW ${id} | ${text}`);
const realLog = console.log;
/** run fn with the app's own console chatter silenced (the solver logs each refusal) */
export async function quiet(fn) { console.log = () => {}; const w = console.warn; console.warn = () => {}; try { return await fn(); } finally { console.log = realLog; console.warn = w; } }

/** a stored design from joints { id: [x, y, fixed] } (mm), shapes, constraints, parameters */
export function design(joints, shapes, constraints = [], parameters = []) {
  return { version: 3, hosts: {}, geometry: {
    joints: [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }], ...Object.entries(joints).map(([id, [x, y, fixed]]) => [id, { x, y, fixed: !!fixed, sketchId: 'sketch-1' }])],
    shapes: shapes.map((s) => ({ sketchId: 'sketch-1', ...s })), constraints, parameters,
    sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }], activeSketchId: 'sketch-1', groups: [], profiles: [] } };
}
let app = null;
/** open `doc` in a host's Design tab (closes the previous one: one app per process); centre + width of the view in mm */
export async function openDesign(doc, { centre = { x: 40, y: 20 }, w = 260, width = 1600, height = 900, host = 'sketchstudio' } = {}) {
  if (app) { await app.close(); app = null; }
  const profile = await createProfile();
  await quiet(async () => {
    await createNamedDesign(profile, host, 'Audit 1000', doc);
    app = await open({ host, profile, width, height });
  });
  setConstraintNotifier(showNotification); // the page's wiring (sketch-canvas.js mountSketch does the same)
  const st = app.state; app.tool('select');
  const r = app.svg.getBoundingClientRect();
  Object.assign(st.view, { x: centre.x, y: centre.y, w }); st.view.h = st.view.w / (r.width / r.height);
  app.svg.setAttribute('viewBox', `${st.view.x - st.view.w / 2} ${st.view.y - st.view.h / 2} ${st.view.w} ${st.view.h}`); app.frames();
  return app;
}
export async function closeAll() { if (app) { await app.close(); app = null; } }

export const J = (id) => { const j = app.state.joints.get(id); return j ? { x: j.x, y: j.y } : null; };
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const snapshot = () => new Map([...app.state.joints].map(([id, j]) => [id, { x: j.x, y: j.y }]));
/** the largest joint move between two snapshots (and which joint) */
export function moved(a, b = snapshot()) { let m = 0, who = null; for (const [id, p] of a) { const q = b.get(id); if (!q) continue; const d = dist(p, q); if (d > m) { m = d; who = id; } } return { max: m, who, gone: [...a.keys()].filter((id) => !b.has(id)), added: [...b.keys()].filter((id) => !a.has(id)) }; }
export const movedText = (a, b) => { const m = moved(a, b); return `max move ${f(m.max, 4)}${m.who ? ' (' + m.who + ')' : ''}${m.gone.length ? ' gone ' + m.gone : ''}${m.added.length ? ' added ' + m.added.length : ''}`; };
/** the worst residual of the driving constraints and which constraint */
export function residual() { const st = app.state; let max = 0, worst = null; for (const c of st.constraints) { if (!c || c.driven || c.isDriven || c.type === 'mouse_spring') continue; let r; try { r = measureResidual(c, st.joints, st.shapes); } catch (e) { r = NaN; } if (!(r <= max)) { max = r; worst = c; } } return { max, worst: worst ? `${worst.type}${worst.name ? ' ' + worst.name : ''}` : null }; }
export const residualText = () => { const r = residual(); return `residual ${r.max < 1e-6 ? 'ok' : f(r.max, 5) + ' on ' + r.worst}`; };
/** the status the renderer colours from: DOF of the sketch, and per shape 'fixed' (drawn fully constrained / locked) | 'constrained' | 'free' */
export function status() {
  const st = app.state;
  const s = analyzeConstraintStatus({ joints: st.joints, shapes: st.shapes, constraints: st.constraints.filter((c) => c && c.type !== 'mouse_spring'), groups: st.groups });
  const shapes = {}; for (const sh of st.shapes) { if (String(sh.id).startsWith('ref_')) continue; shapes[sh.id] = s.fixedShapes.has(sh.id) ? 'fixed' : s.constrainedShapes.has(sh.id) ? 'constrained' : 'free'; }
  return { dof: s.dof, shapes };
}
export const statusText = () => { const s = status(); return `dof ${s.dof} {${Object.entries(s.shapes).map(([k, v]) => k + ':' + v).join(' ')}}`; };
export const toasts = () => [...app.document.querySelectorAll('#notification-container [data-level]')].map((e) => `[${e.dataset.level}] ${e.textContent.trim().replace(/\s+/g, ' ').slice(0, 150)}`);
export const clearToasts = () => app.document.querySelectorAll('#notification-container [data-level]').forEach((e) => e.remove());
export const boxEl = () => app.document.getElementById('dimInput');
export const hintEl = () => app.document.getElementById('dimHint');
export const boxOpen = () => !boxEl().classList.contains('hidden');
export const hintText = () => { const h = hintEl(); return h && !h.classList.contains('hidden') ? h.textContent.trim().replace(/\s+/g, ' ').slice(0, 150) : ''; };

/** the real mouse: press at world point `from`, `steps` moves in a straight line to `to`, release. Returns whether a drag started. */
export async function dragWorld(from, to, steps = 30, o = {}) {
  return quiet(async () => {
    const a = app.toScreen(from.x, from.y), b = app.toScreen(to.x, to.y);
    app.move(a.x, a.y); app.down(a.x, a.y);
    const d = app.state.drag;
    const kind = d ? (d.id ? 'joint ' + d.id : (d.type || d.kind || 'drag')) : 'none';
    const trail = [];
    for (let k = 1; k <= steps; k++) { app.move(a.x + (b.x - a.x) * k / steps, a.y + (b.y - a.y) * k / steps, { buttons: 1 }); if (o.watch) trail.push(o.watch(k)); }
    if (!o.hold) app.up(b.x, b.y);
    return { started: !!d, kind, trail };
  });
}
export const dragJoint = (id, to, steps = 30, o = {}) => dragWorld(J(id), to, steps, o);
export const dim = (name) => app.state.constraints.find((c) => c && c.name === name);
/** edit dimension `name` as a user does: a double click on its label, type `text`, Enter. Returns what the user is left with. */
export async function editDim(name, text) {
  const st = app.state; const idx = st.constraints.indexOf(dim(name));
  if (idx < 0) return { opened: false, why: 'no dimension ' + name };
  app.tool('select'); app.esc(); clearToasts();
  const el = () => labelEl(app, idx);
  if (!el()) return { opened: false, why: 'no label on the canvas' };
  const g = st.constraints[idx].glyphPos; const p = app.toScreen(g.x, g.y);
  await app.pause(550);
  await quiet(async () => { app.dblclick(p.x, p.y, { target: el }); });
  try { await app.waitFor(boxOpen, 'the edit box', 600); } catch { return { opened: false, why: 'the box did not open', toasts: toasts() }; }
  const h0 = st.history.length;
  await quiet(async () => { const i = boxEl(); i.focus(); i.select(); app.key('a', { ctrl: true }); app.type(text); app.enter(); });
  const res = { opened: true, boxStillOpen: boxOpen(), boxText: boxEl().value, hint: hintText(), invalid: boxEl().getAttribute('aria-invalid') === 'true', toasts: toasts(), undoSteps: st.history.length - h0 };
  if (res.boxStillOpen) await quiet(async () => { app.esc(); });
  return res;
}
export const editText = (r) => (r.opened ? `box ${r.boxStillOpen ? 'STAYS OPEN' : 'closed'}${r.hint ? ` hint "${r.hint}"` : ''} toasts ${JSON.stringify(r.toasts)} undo steps +${r.undoSteps}` : `NOT OPENED (${r.why}) toasts ${JSON.stringify(r.toasts || [])}`);
export { findLabel, labelEl };
export const theApp = () => app;
