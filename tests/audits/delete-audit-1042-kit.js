// tests/audits/delete-audit-1042-kit.js — TASK 1042 (AUDIT ONLY, outside the gate): what the delete probes tests/audits/delete-audit-1042-*.mjs share.
// Every probe opens the REAL Design tab of a host in Node through tests/helpers/node-app.js (the page's own pointer / key listeners, ribbon tools,
// value boxes, undo history, autosave on the shared project store), DRAWS the scene with the real tools (clicks and typed values), PICKS with real
// clicks on screen points (points, curves, glyphs, dimension labels), DELETES through a real path (the Delete key, Backspace, the right-click menu's
// Delete row, the footer's red X), and PRINTS what happened, one `ROW <id> | ...` line per case. Nothing is asserted: the probes exit 0 whatever
// they see (docs/DELETE-AUDIT-1042.md reads the rows).
// Per case: what went, what is left (stray points, constraints / dimensions naming missing things, empty groups, pattern / offset / mirror records
// pointing at missing shapes), ONE Ctrl+Z restores the document exactly (ids, constraints, dimensions, parameters), save + reload gives the same
// document, and the solver after (residual of the driving constraints, DOF).
import fs from 'node:fs';
import { open, createProfile, createNamedDesign, loadGlyphSheetFromDisk } from '../helpers/node-app.js';
import SettingsManager from '#core/settings-manager.js';
import { measureResidual } from '#core/constraint-verifier.js';
import { analyzeConstraintStatus } from '#core/constraint-status.js';
import { setConstraintNotifier } from '#core/constraint-manager.js';
import { showNotification } from '#ui/notification-manager.js';
import { arcSweepInfo } from '#core/geometry.js';
import { glyphAt as appGlyphAt } from '#ui/hover-manager.js';

// PROBE-ONLY seam (not the app's code): the Text tool downloads its bundled font with fetch(new URL('./vendor/fonts/...', import.meta.url)); the
// browser serves that URL over http, Node's fetch has no file: scheme. Here a file: URL is answered from disk; every other URL goes to Node's fetch.
const nodeFetch = globalThis.fetch;
globalThis.fetch = async (u, o) => { const s = String(u && u.href ? u.href : u); if (s.startsWith('file:')) { const b = fs.readFileSync(new URL(s)); return new Response(b, { status: 200 }); } return nodeFetch(u, o); };

SettingsManager.set('GRID_MAGNETISM', 0.001, { persist: 'none' }); // no grid magnet: the cursor is what is followed

export const f = (v, d = 3) => (typeof v === 'number' ? (Math.abs(v) < 5e-7 ? '0' : v.toFixed(d).replace(/\.?0+$/, '')) : String(v));
const realLog = console.log, realWarn = console.warn, realInfo = console.info, realErr = console.error;
const errors = [];
/** run fn with the app's console chatter silenced (console.error is KEPT in `errors`: a thrown delete is a finding) */
export async function quiet(fn) {
  console.log = () => {}; console.warn = () => {}; console.info = () => {}; console.debug = () => {};
  console.error = (...a) => errors.push(a.map((x) => (x && x.stack) || String(x)).join(' ').slice(0, 300));
  try { return await fn(); } finally { console.log = realLog; console.warn = realWarn; console.info = realInfo; console.error = realErr; }
}
export const takeErrors = () => errors.splice(0);
export const row = (id, text) => realLog(`ROW ${id} | ${text}`);
export const say = (...a) => realLog(...a);

let glyphsLoaded = false;
let app = null, profile = null;
/** open a host's Design tab on a NEW named design (only a named design autosaves); centre + width of the view in mm */
export async function openBlank({ host = 'sketchstudio', centre = { x: 0, y: 0 }, w = 200, width = 1600, height = 900, designBrowser = false, doc = null } = {}) {
  if (!glyphsLoaded) { await loadGlyphSheetFromDisk(); glyphsLoaded = true; }
  if (app) { await quiet(() => app.close()); app = null; }
  profile = await createProfile();
  await quiet(async () => {
    await createNamedDesign(profile, host, 'Audit 1042', doc);
    app = await open({ host, profile, width, height, designBrowser });
  });
  setConstraintNotifier(showNotification); // the page's wiring (sketch-canvas.js mountSketch does the same)
  setView(centre, w);
  await quiet(() => app.tool('select'));
  return app;
}
export function setView(centre, w) {
  const st = app.state; const r = app.svg.getBoundingClientRect();
  Object.assign(st.view, { x: centre.x, y: centre.y, w }); st.view.h = st.view.w / (r.width / r.height);
  app.svg.setAttribute('viewBox', `${st.view.x - st.view.w / 2} ${st.view.y - st.view.h / 2} ${st.view.w} ${st.view.h}`); app.frames(2);
}
/** re-open the SAME profile (the stored design, as a page reload does) */
export async function reopen(host = app.host) {
  const v = { ...app.state.view };
  await quiet(async () => { await app.storedDoc(); await app.close(); app = await open({ host, profile }); });
  setConstraintNotifier(showNotification);
  setView({ x: v.x, y: v.y }, v.w);
  return app;
}
export async function closeAll() { if (app) { await quiet(() => app.close()); app = null; } }
export const theApp = () => app;

// ------------------------------------------------------------------------------------------------ input in WORLD mm
export const W = (x, y) => app.toScreen(x, y);
export const click = (x, y, o) => quiet(() => { const p = W(x, y); app.click(p.x, p.y, o); });
export const move = (x, y, o) => quiet(() => { const p = W(x, y); app.move(p.x, p.y, o); });
export const key = (k, o) => quiet(() => app.key(k, o));
export const esc2 = () => quiet(() => { app.esc(); app.esc(); });
export const tool = (n) => quiet(() => app.tool(n));
export const typeText = (t) => quiet(() => app.type(t));
/** the world point of joint `id` */
export const jp = (id) => { const j = app.state.joints.get(id); if (!j) throw new Error('no joint ' + id); return [j.x, j.y]; };
/** a world point ON shape `id` at parameter t (line: along it; arc: along its sweep; circle: the rim at angle t * 360; bezier: the curve) */
export function onShape(id, t = 0.5) {
  const st = app.state; const s = st.shapes.find((x) => x.id === id); if (!s) throw new Error('no shape ' + id);
  const P = (k) => st.joints.get(s.joints[k]);
  if (s.type === 'line') { const a = P(0), b = P(1); return [a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t]; }
  if (s.type === 'circle') { const c = P(0); const a = t * 2 * Math.PI; return [c.x + s.radius * Math.cos(a), c.y + s.radius * Math.sin(a)]; }
  if (s.type === 'arc') {
    const c = P(0), a = P(1), b = P(2); const r = Math.hypot(a.x - c.x, a.y - c.y);
    const info = arcSweepInfo(c, a, b, { sweep: s.sweep });
    const m = info.a0 + info.dir * info.span * t; return [c.x + r * Math.cos(m), c.y + r * Math.sin(m)];
  }
  if (s.type === 'bezier') {
    const a = P(0), b = P(1), c1 = { x: s.c1[0], y: s.c1[1] }, c2 = { x: s.c2[0], y: s.c2[1] }; const u = 1 - t;
    return [u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x, u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y];
  }
  const a = P(0); return [a.x, a.y];
}
export const clickJoint = (id, o) => click(...jp(id), o);
export const clickShape = (id, t = 0.5, o) => click(...onShape(id, t), o);
/** the shapes (user curves, not the ref axes) of a type, in creation order */
export const shapesOf = (pred = () => true) => app.state.shapes.filter((s) => !String(s.id).startsWith('ref_') && pred(s));
/** the joint shared by two shapes / the joint of shape a at end k */
export const sharedJoint = (a, b) => { const A = app.state.shapes.find((s) => s.id === a), B = app.state.shapes.find((s) => s.id === b); return A.joints.find((j) => B.joints.includes(j)); };

/** a click on a glyph / label: at its stored world position (the renderer's glyphPos; the pick is geometric, hover-manager glyphAt) */
export const clickConstraint = (c, o = {}) => quiet(() => {
  const idx = app.state.constraints.indexOf(c);
  const label = () => app.svg.querySelector(`.dim-label[data-constraint-idx="${idx}"]`);
  if (label()) { const g = Array.isArray(c.glyphPos) ? c.glyphPos[0] : c.glyphPos; const p = W(g.x, g.y); app.click(p.x, p.y, { ...o, target: label }); return true; } // a dimension / pattern label: a DOM pick
  // a glyph: the click goes where its icon is INKED, as a user aims at it (the pick is the drawn icon's outlines, not a disc: hover-manager.js
  // glyphAt + fusion-glyphs glyphPickHit, so the centre of a ring-shaped icon is a miss). Around each place the renderer drew a glyph of c
  // (c.glyphPos), the first screen pixel the app's own glyphAt gives c for.
  const q = glyphInk(c, o.which || 0); if (q) { app.click(q.x, q.y, o); return true; }
  return false;
});
/** the first screen pixel, around each place the renderer drew a glyph of c, that the app's own glyphAt gives c for (null: none) */
export function glyphInk(c, which = 0) {
  const spots = (Array.isArray(c.glyphPos) ? c.glyphPos : c.glyphPos ? [c.glyphPos] : []).map((g) => W(g.x, g.y));
  if (which) spots.push(...spots.splice(0, which));
  for (const p of spots) for (let r = 0; r <= 14; r += 1) for (let a = 0; a < 16; a++) {
    const x = Math.round(p.x + r * Math.cos(a * Math.PI / 8)), y = Math.round(p.y + r * Math.sin(a * Math.PI / 8));
    if (appGlyphAt(app.svg, app.state, x, y) === c) return { x, y };
    if (r === 0) break;
  }
  return null;
}
/** the world point of a constraint's glyph / label */
export const glyphAt = (c, which = 0) => { const g = Array.isArray(c.glyphPos) ? c.glyphPos[which] : c.glyphPos; return [g.x, g.y]; };
/** the label element of a constraint (the right-click target) */
export const labelOf = (c) => () => app.svg.querySelector(`.dim-label[data-constraint-idx="${app.state.constraints.indexOf(c)}"]`);
/** the right-click menu at a world point (target: the element a browser's hit test finds), then a click on the row whose id is `rowId` */
export async function rightClickDelete(x, y, { target, screen = null } = {}) {
  const ids = [];
  await quiet(async () => {
    const p = screen || W(x, y); app.rightClick(p.x, p.y, { target });
    const rows = [...app.document.querySelectorAll('.sk-context-menu .sk-context-item')];
    for (const r of rows) ids.push(r.dataset.id);
    const del = rows.find((r) => /^(geo|dim|con)-delete$/.test(r.dataset.id || ''));
    if (del) app.press(del); else app.esc();
  });
  return ids;
}
/** the footer's red X (packages/ui/app-footer.js) */
/** a press-drag-release on the canvas from world a to world b (the Select tool's box selection when it starts on empty canvas) */
export const dragW = (a, b, o) => quiet(() => { app.drag(W(...a), W(...b), 8, o); });
export const footerDelete = () => quiet(() => {
  const b = app.document.getElementById('btn-delete-selection');
  if (!b) throw new Error('no footer delete button');
  if (b.disabled) return 'footer button DISABLED (a browser sends no click to a disabled button: not pressed)';
  app.press(b); return 'footer button pressed';
});

// ------------------------------------------------------------------------------------------------ drawing with the real tools
export async function line(...pts) { await tool('line'); for (const p of pts) await click(p[0], p[1]); await esc2(); await tool('select'); }
export async function rect2(a, b) { await tool('rect'); app.state.rectMode = 'rect-2pt'; await click(...a); await click(...b); await esc2(); await tool('select'); }
export async function circle(c, r) { await tool('circle'); await click(...c); await click(c[0] + r, c[1]); await esc2(); await tool('select'); }
export async function polygon(c, r, n = 6) {
  await tool('polygon'); await click(...c); await move(c[0] + r, c[1]);
  const b = app.document.getElementById('dualInput'); const ins = b ? [...b.querySelectorAll('input')] : [];
  if (ins[1] && n !== 6) await quiet(() => { ins[1].focus(); ins[1].select(); app.type(String(n)); });
  await click(c[0] + r, c[1]); await esc2(); await tool('select');
}
export async function arc3(c, s, e) { await tool('arc'); await click(...c); await click(...s); await click(...e); await esc2(); await tool('select'); }
export async function slotCC(a, b, w) { await tool('slot'); app.state.slotMode = 'slot-c2c'; await click(...a); await click(...b); await click(b[0], b[1] + w / 2); await esc2(); await tool('select'); }
/** Fillet: click the corner, type the radius, Enter */
export async function fillet(corner, r) {
  await tool('fillet'); await click(...corner);
  const box = app.document.getElementById('fillet-radius-input');
  if (box) await quiet(() => { box.focus(); box.select(); app.type(String(r)); app.enter(); });
  await esc2(); await tool('select');
}
/** Offset: click a curve, click the side, type the distance, Enter */
export async function offset(curvePt, sidePt, d) {
  await tool('offset'); await click(...curvePt); await click(...sidePt);
  const box = app.document.getElementById('offset-distance-input');
  if (box) await quiet(() => { box.focus(); box.select(); app.type(String(d)); app.enter(); });
  await esc2(); await tool('select');
}
/** Mirror: select the objects (click, Shift+click), the ribbon's Mirror, click the mirror line, Enter */
export async function mirror(objPts, linePt) {
  await tool('select'); await esc2();
  for (let i = 0; i < objPts.length; i++) await click(objPts[i][0], objPts[i][1], { shift: i > 0 });
  await tool('mirror'); await click(...linePt); await quiet(() => app.enter()); await esc2(); await tool('select');
}
/** Rectangular pattern: select objects, the ribbon's tool (live at once from the pre-selection), Quantity 1 = qty, Distance 1 = extent (Extent), OK (Enter) */
export async function rectPattern(objPts, qty = 3, extent = 60) {
  await tool('select'); await esc2();
  for (let i = 0; i < objPts.length; i++) await click(objPts[i][0], objPts[i][1], { shift: i > 0 });
  await tool('rectangularPattern');
  const up = app.document.querySelector('.sk-pattern-dialog [data-spin-for="Quantity 1"][data-spin="up"]');
  for (let i = 2; i < qty && up; i++) await quiet(() => { up.click(); app.frames(); });
  const d = app.document.querySelector('.sk-pattern-dialog [data-field="Distance 1"]');
  if (d) await quiet(() => { d.focus(); d.select(); app.type(String(extent)); d.blur(); app.frames(); });
  await quiet(() => app.enter()); await esc2(); await tool('select');
}
/** a two-pick constraint tool (coincident, midpoint, parallel, perp, equal, collinear, tangent, hv): click each pick */
export async function constrain(toolName, ...picks) { await tool(toolName); for (const p of picks) await click(p[0], p[1]); await esc2(); await tool('select'); }
/** the Dimension tool: picks, then the label place, then the typed value, Enter */
export async function dimension(picks, place, value = null) {
  await tool('dim'); for (const p of picks) await click(p[0], p[1]); await click(...place);
  const i = app.document.getElementById('dimInput');
  if (value != null && i && !i.classList.contains('hidden')) await quiet(() => { i.focus(); i.select(); app.type(String(value)); app.enter(); });
  else await quiet(() => app.enter());
  await esc2(); await tool('select');
}

// ------------------------------------------------------------------------------------------------ reading the document
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const asList = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const DROP = new Set(['glyphPos', 'labelPos', 'labelAngle']); // render caches (and every `__` key: the renderer's per-frame flags)
/** the document as plain data (what undo / save must give back): shapes, joints (rounded 1e-6), constraints minus render caches, parameters, groups, sketches */
export function docOf(st = app.state) {
  const clean = (o) => JSON.parse(JSON.stringify(o, (k, v) => (DROP.has(k) || k.startsWith('__') ? undefined : typeof v === 'number' ? +v.toFixed(6) : v)));
  return clean({
    shapes: st.shapes.filter((s) => !String(s.id).startsWith('ref_')),
    joints: [...st.joints].map(([id, j]) => [id, { x: j.x, y: j.y, fixed: !!j.fixed, virtualSharp: !!j.virtualSharp }]).sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    constraints: st.constraints.filter((c) => c && c.type !== 'mouse_spring'),
    parameters: st.parameters || [], groups: st.groups || [],
  });
}
const J = (st, id) => st.joints.get(id);
const typeTag = (c) => `${c.type}${c.name ? ':' + c.name : ''}${c.isRadius ? (c.isDiameter ? 'Ø' : 'R') : ''}${c.isDriven || c.driven ? '(ref)' : ''}`;
/** the leftovers a delete must not leave (each a short tag) */
export function leftovers(st = app.state) {
  const out = [];
  const shapeIds = new Set(st.shapes.map((s) => s.id));
  const used = new Set(st.shapes.flatMap((s) => asList(s.joints)));
  for (const [id, j] of st.joints) {
    if (id === 'j_origin') continue;
    if (!used.has(id)) out.push(`point ${id} on no curve${j.virtualSharp ? ' (virtual sharp)' : ''}${j.orphanAllowed ? ' (orphanAllowed)' : ''}`);
  }
  const SHAPE_FIELDS = ['shapes', 'shape', 'line', 'circle', 'directions', 'sources'];
  for (const c of st.constraints) {
    if (!c || c.type === 'mouse_spring') continue;
    for (const fld of SHAPE_FIELDS) for (const s of asList(c[fld])) if (typeof s === 'string' && !s.startsWith('ref_') && !shapeIds.has(s)) out.push(`${typeTag(c)}.${fld} -> missing shape ${s}`);
    for (const fld of ['joints', 'joint', 'centre']) for (const j of asList(c[fld])) if (typeof j === 'string' && !st.joints.has(j)) out.push(`${typeTag(c)}.${fld} -> missing point ${j}`);
    if (Array.isArray(c.instances)) for (const inst of c.instances) for (const s of asList(inst && inst.shapes)) if (!shapeIds.has(s)) out.push(`${typeTag(c)} instance -> missing shape ${s}`);
  }
  for (const g of (st.groups || [])) { const m = asList(g.shapes || g.members); if (!m.length) out.push(`group ${g.id} empty`); for (const s of m) if (typeof s === 'string' && !shapeIds.has(s)) out.push(`group ${g.id} -> missing shape ${s}`); }
  const names = new Set(st.constraints.filter((c) => c && c.name).map((c) => c.name));
  for (const p of (st.parameters || [])) if (p && p.kind === 'model' && p.name && !names.has(p.name)) out.push(`model parameter ${p.name} with no dimension`);
  return out;
}
/** the solver after: worst residual of the driving constraints, DOF */
export function solverText(st = app.state) {
  let max = 0, worst = null;
  for (const c of st.constraints) {
    if (!c || c.driven || c.isDriven || c.type === 'mouse_spring') continue;
    let r; try { r = measureResidual(c, st.joints, st.shapes); } catch (e) { r = NaN; }
    if (!(r <= max)) { max = r; worst = c; }
  }
  let dof = '?';
  try { dof = analyzeConstraintStatus({ joints: st.joints, shapes: st.shapes, constraints: st.constraints.filter((c) => c && c.type !== 'mouse_spring'), groups: st.groups }).dof; } catch (e) { dof = 'threw ' + e.message; }
  return `residual ${max < 1e-6 ? 'ok' : f(max, 5) + ' on ' + (worst && worst.type)} dof ${dof}`;
}
/** short census: shape kinds, point count, constraint types */
export function census(st = app.state) {
  const k = {}; for (const s of st.shapes) { if (String(s.id).startsWith('ref_')) continue; const t = s.type + (s.isConstruction ? '(c)' : ''); k[t] = (k[t] || 0) + 1; }
  const c = {}; for (const x of st.constraints) { if (!x || x.type === 'mouse_spring') continue; const t = typeTag(x).replace(/:[^(Ø]*/, ''); c[t] = (c[t] || 0) + 1; }
  return `shapes ${JSON.stringify(k)} points ${[...st.joints.keys()].filter((id) => id !== 'j_origin').length} cons ${JSON.stringify(c)}`;
}
/** what changed between two docOf()s: shapes / points / constraints gone and added */
export function diff(a, b) {
  const ids = (d) => new Set(d.shapes.map((s) => s.id)), jids = (d) => new Set(d.joints.map((j) => j[0]));
  const ckey = (c) => JSON.stringify(canon(c));
  const minus = (xs, ys) => { const left = ys.map(ckey); return xs.filter((c) => { const k = ckey(c), i = left.indexOf(k); if (i < 0) return true; left.splice(i, 1); return false; }); };
  const sa = ids(a), sb = ids(b), ja = jids(a), jb = jids(b);
  const typeOf = (d, id) => { const s = d.shapes.find((x) => x.id === id); return s ? s.type + (s.isConstruction ? '(c)' : '') : '?'; };
  const goneS = [...sa].filter((x) => !sb.has(x)).map((x) => typeOf(a, x));
  const addS = [...sb].filter((x) => !sa.has(x)).map((x) => typeOf(b, x));
  const goneJ = [...ja].filter((x) => !jb.has(x)).length, addJ = [...jb].filter((x) => !ja.has(x)).length;
  const goneC = minus(a.constraints, b.constraints).map(typeTag), addC = minus(b.constraints, a.constraints).map(typeTag);
  return `deleted shapes [${goneS}] points -${goneJ} cons [${goneC}]${addS.length || addJ || addC.length ? ` ADDED shapes [${addS}] points +${addJ} cons [${addC}]` : ''}`;
}
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b)); // key order is not content
/** a doc with every generated id (s..., j..., a time stamp inside) replaced by its order of appearance: two runs of the same case compare */
export function normalised(d) {
  const map = new Map();
  const txt = JSON.stringify(d).replace(/"(\w*\d{9,}\w*)"/g, (m, id) => { if (!map.has(id)) map.set(id, 'id' + map.size); return JSON.stringify(map.get(id)); });
  return JSON.parse(txt);
}
/** where two docs first differ (a short path) */
export function firstDiff(a, b, p = '') {
  if (same(a, b)) return null;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return `${p}: ${JSON.stringify(a)?.slice(0, 80)} vs ${JSON.stringify(b)?.slice(0, 80)}`;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) { const d = firstDiff(a[k], b[k], p + '.' + k); if (d) return d; }
  return p + ': ?';
}

/**
 * ONE case: `scene()` draws, `pick()` selects (real clicks), `del()` deletes (default: the Delete key). Prints
 * ROW id | label | sel {...} | <what went> | after <census> | LEFT [...] | solver | undo: exact / DIFF | redo | reload: same / DIFF | errors
 */
export async function runCase(id, label, { host = 'sketchstudio', scene, pick, del = () => key('Delete'), view = { centre: { x: 0, y: 0 }, w: 200 }, extra = null } = {}) {
  if (process.env.ONLY && !new RegExp(process.env.ONLY).test(id)) return null;
  takeErrors();
  try {
    await openBlank({ host, ...view });
    await scene();
    const st = app.state;
    const before = docOf();
    const h0 = st.history ? st.history.length : null;
    await pick();
    const sel = `sel{S${[...(st.selectedShapes || [])].map((s) => (st.shapes.find((x) => x.id === s) || {}).type || s).join(',')} J${(st.selectedJoints || new Set()).size}${[...(st.selectedJoints || [])].includes('j_origin') ? '(origin)' : ''} C${[...(st.selectedConstraints || [])].map(typeTag).join(',')}}`;
    const delOut = await del();
    const after = docOf();
    const h1 = st.history ? st.history.length : null;
    const changed = !same(before, after);
    const what = changed ? diff(before, after) : 'NOTHING deleted';
    const afterCensus = census();
    const left = leftovers();
    const solver = solverText();
    const extraText = extra ? await extra({ before, after }) : '';
    // save + reload
    let reload = 'n/a';
    try { await reopen(host); const back = docOf(); reload = same(after, back) ? 'same' : 'DIFF ' + firstDiff(after, back); } catch (e) { reload = 'threw ' + e.message; }
    // undo / redo: the reloaded page has no history, so the case runs again (same scene, same picks) and its own `before` is the reference
    await openBlank({ host, ...view }); await scene(); const before2 = docOf(); await pick(); await del();
    const afterAgain = docOf();
    const sum2 = `${same(before2, afterAgain) ? 'NOTHING deleted' : diff(before2, afterAgain)} ${census()} ${leftovers().length}`;
    const repeat = sum2 === `${what} ${afterCensus} ${left.length}` ? '' : ' | REPEAT DIFFERS: ' + sum2;
    let undo = 'n/a', redo = 'n/a';
    if (changed) {
      await key('z', { ctrl: true });
      const u = docOf(); undo = same(u, before2) ? 'exact' : 'DIFF ' + firstDiff(before2, u);
      await key('y', { ctrl: true });
      const r = docOf(); redo = same(r, afterAgain) ? 'exact' : 'DIFF ' + firstDiff(afterAgain, r);
    }
    const errs = takeErrors();
    row(id, `${label} | ${sel} | ${what} | after ${afterCensus} | LEFT ${left.length ? '[' + left.join('; ') + ']' : 'none'} | ${solver} | undo ${undo} (history +${h0 != null ? h1 - h0 : '?'}) | redo ${redo} | reload ${reload}${repeat}${delOut !== undefined && delOut !== null && !(delOut instanceof Promise) ? ' | path ' + JSON.stringify(delOut) : ''}${extraText ? ' | ' + extraText : ''}${errs.length ? ' | ERRORS ' + JSON.stringify(errs) : ''}`);
    return { before, after, left };
  } catch (e) {
    row(id, `${label} | PROBE THREW ${e.stack.split('\n').slice(0, 3).join(' / ')}${errors.length ? ' | ERRORS ' + JSON.stringify(takeErrors()) : ''}`);
    return null;
  }
}

/** the scene's census (to check a scene draws what it says, before running cases on it) */
export async function sceneCheck(id, scene, view = { centre: { x: 0, y: 0 }, w: 200 }, host = 'sketchstudio') {
  await openBlank({ host, ...view }); await scene();
  const st = app.state;
  row(id, `SCENE ${census()} | shapes ${st.shapes.filter((s) => !String(s.id).startsWith('ref_')).map((s) => `${s.id}:${s.type}${s.isConstruction ? '(c)' : ''}[${asList(s.joints).join(',')}]`).join(' ')} | cons ${st.constraints.filter((c) => c && c.type !== 'mouse_spring').map((c) => `${typeTag(c)}${c.joints ? '[' + c.joints + ']' : ''}${c.shapes ? '{' + c.shapes + '}' : ''}`).join(' ')} | ${solverText()}`);
}
export { asList };
