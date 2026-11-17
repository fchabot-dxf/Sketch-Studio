// tests/groups-exports-756-node.test.js — TASK 756 (node): user groups are part of the shared Design tab in EVERY app, and change nothing
// outside it. In each app the letters file is imported through the app's own import (the ONE shared importer) and lands GROUPED (each
// profile / chain a group, the whole file one group around them); then each app's output is made twice, with the groups and with them
// stripped (no userGroupId, no group entries; even a group entered and one hovered), and must be BYTE-IDENTICAL:
//   SketchStudio  the SVG and DXF exporters (ui/export-manager.js) and the Drawing stage (drawing-view.js drawDrawing's markup, planPrint);
//   Shaper        the Shaper SVG file and its 2D preview copy (export-payload.js), and Prepare's region picks (a click in each region selects the
//                 same target);
//   Pen Plotter   the toolpath shapes (core-geometry.js collectToolpathShapes) and the G-code files (export.js buildGcodeEntries);
//   Trace         its SVG / DXF downloads (export.js: they read the tracer's own SVG, never the Edit sketch the groups live in).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { Window } from 'happy-dom';
import { open } from './helpers/node-app.js';
import SettingsManager from '#core/settings-manager.js';
import { shapesInGroup } from '#core/group-model.js';
import { worldToScreen } from '#ui/coords.js';
import { buildSVG, buildDXF } from '../apps/sketchstudio/ui/export-manager.js';
import { drawDrawing, planPrint } from '../apps/sketchstudio/drawing-view.js';
import { cutPlanEntries } from '../apps/shaper/src/cut-plan.js';
import { shaperSvgOf, shaperPreviewOf } from '../apps/shaper/src/export-payload.js';
import { importDrawing } from '../apps/penplotter/src/sketch-stage.js';
import { collectToolpathShapes } from '../apps/penplotter/src/core-geometry.js';
import { buildGcodeEntries } from '../apps/penplotter/src/export.js';

SettingsManager.set('GRID_MAGNETISM', 0.001, { persist: 'none' });
const quiet = (fn) => async (...a) => { const log = console.log; console.log = () => {}; try { return await fn(...a); } finally { console.log = log; } };
let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const measured = {};
const SVG = fs.readFileSync(path.resolve('tests/fixtures/svg/letters-756.svg'), 'utf8');
const FILE_GROUPS = ['O<letters', 'A<letters', 'B<letters', 'T<letters', 'isl<letters', 'tail<letters', 'letters'];
const names = (st) => st.groups.map((g) => g.name + (g.parentId ? '<' + st.groups.find((p) => p.id === g.parentId).name : ''));

// strip the user groups IN PLACE (the app's own state objects, which its exporters read), run fn, put them back. Also: the file group
// entered and hovered while grouped (the session UI must not reach an export either).
function withAndWithout(st, fn) {
  const file = st.groups.find((g) => !g.parentId);
  st.enteredGroupId = file.id; st.hoverOwner = st.shapes.find((s) => s.userGroupId).id;
  const grouped = fn();
  const saved = { groups: st.groups.map((g) => ({ ...g })), ids: st.shapes.map((s) => s.userGroupId) };
  st.groups.length = 0; for (const s of st.shapes) delete s.userGroupId; st.enteredGroupId = null; st.hoverOwner = null;
  const plain = fn();
  st.groups.push(...saved.groups); st.shapes.forEach((s, i) => { if (saved.ids[i]) s.userGroupId = saved.ids[i]; });
  return { grouped, plain };
}
const landedGrouped = (st, host) => {
  eq(names(st), FILE_GROUPS, host + ': the import lands grouped (each profile / chain a group inside the file group)');
  eq(shapesInGroup(st, st.groups.find((g) => !g.parentId).id).length, st.shapes.filter((s) => s.sketchId === st.activeSketchId).length, host + ': every imported shape is in the file group');
};

// ---- SketchStudio: SVG / DXF exporters, the Drawing stage
{
  const app = await quiet(open)({ host: 'sketchstudio', sidebar: true });
  try {
    const st = app.state;
    await quiet(app.importFile)(SVG, 'letters.svg');
    landedGrouped(st, 'sketchstudio');
    const world = app.document.createElementNS('http://www.w3.org/2000/svg', 'g'); app.svg.appendChild(world);
    const r = withAndWithout(st, () => {
      drawDrawing({ state: st, svg: app.svg, world });
      return { svg: buildSVG(st), dxf: buildDXF(st), drawing: world.innerHTML, print: JSON.stringify(planPrint(st)) };
    });
    ok(r.grouped.svg.length > 500 && r.grouped.drawing.length > 500, 'sketchstudio: the outputs have content');
    eq(r.grouped, r.plain, 'sketchstudio: SVG, DXF, the Drawing stage markup and its print plan are byte-identical with and without groups');
    measured.sketchstudio = { svg: r.grouped.svg.length, dxf: r.grouped.dxf.length, drawing: r.grouped.drawing.length };
  } finally { await app.close(); }
}

// ---- Shaper: its file, the 2D preview copy, Prepare's region picks
{
  const app = await quiet(open)({ host: 'shaper', sidebar: true });
  try {
    const st = app.state, doc = app.document;
    await quiet(app.importFile)(SVG, 'letters.svg');
    landedGrouped(st, 'shaper');
    const entries = cutPlanEntries();
    const r = withAndWithout(st, () => ({ svg: shaperSvgOf(st, entries), preview: shaperPreviewOf(st, entries).svg }));
    ok(entries.length >= 7 && r.grouped.svg.includes('<path'), 'shaper: the export has the cuts');
    eq(r.grouped, r.plain, 'shaper: the Shaper SVG file and its 2D preview copy are byte-identical with and without groups');
    // Prepare: a click inside each region (the ring of O, the ring of T, the island, the open chain's line, empty space) selects the same target
    const box = (name) => { const ids = shapesInGroup(st, st.groups.find((g) => g.name === name).id); const xs = [], ys = []; for (const s of st.shapes) if (ids.includes(s.id)) for (const j of s.joints) { const p = st.joints.get(j); xs.push(p.x); ys.push(p.y); } return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }; };
    const O = box('O'), T = box('T'), I = box('isl');
    const tail = st.shapes.find((s) => shapesInGroup(st, st.groups.find((g) => g.name === 'tail').id).includes(s.id));
    const ta = st.joints.get(tail.joints[0]), tb = st.joints.get(tail.joints[1]);
    const pts = [[O.x0 + 1, (O.y0 + O.y1) / 2], [T.x0 + 1.5, (T.y0 + T.y1) / 2], [(I.x0 + I.x1) / 2, (I.y0 + I.y1) / 2], [(ta.x + tb.x) / 2, (ta.y + tb.y) / 2], [O.x0 - 30, O.y0 - 30]];
    const picks = () => {
      app.press(doc.querySelector('.sk-header-tab[data-tab="prepare"]')); app.frames();
      const pc = doc.getElementById('prepare-canvas');
      return pts.map(([x, y]) => { const p = worldToScreen(pc, { x, y }); app.click(Math.round(p.x), Math.round(p.y), { target: pc }); const t = app.prepare.view().selectedTarget(); return t ? t.kind + ':' + t.id : null; });
    };
    const leave = () => { app.press(doc.querySelector('.sk-header-tab[data-tab="design"]')); app.frames(); };
    const rp = withAndWithout(st, () => { const p = picks(); leave(); return p; });
    ok(rp.grouped.slice(0, 4).every((t) => t) && rp.grouped[4] === null, 'shaper: Prepare picks a target in each region, nothing on empty space: ' + JSON.stringify(rp.grouped));
    eq(rp.grouped, rp.plain, 'shaper: Prepare picks the same regions on grouped geometry as without groups');
    measured.shaper = { bytes: r.grouped.svg.length, entries: entries.length, prepare: rp.grouped };
  } finally { await app.close(); }
}

// ---- Pen Plotter: toolpath shapes and G-code
{
  const app = await quiet(open)({ host: 'penplotter' });
  try {
    const st = app.state;
    const res = quiet(importDrawing)(SVG, 'letters.svg');
    await res;
    landedGrouped(st, 'penplotter');
    const pen = (app.plotter.pens && app.plotter.pens[0] && app.plotter.pens[0].id) || 'p1';
    const ids = st.shapes.filter((s) => s.sketchId === st.activeSketchId).map((s) => s.id);
    app.plotter.toolpaths = [
      { id: 'tp1', name: 'Outline', type: 'outline', export: true, penId: pen, targetShapeIds: ids, fill: null },
      { id: 'tp2', name: 'Half', type: 'outline', export: true, penId: pen, targetShapeIds: ids.slice(0, 9), fill: null },
    ];
    const r = withAndWithout(st, () => ({ shapes: app.plotter.toolpaths.map((tp) => collectToolpathShapes(tp).map((s) => s.id)), gcode: buildGcodeEntries() }));
    ok(r.grouped.gcode.length > 0 && r.grouped.gcode[0].content.includes('G1'), 'penplotter: the G-code has moves');
    eq(r.grouped, r.plain, 'penplotter: the toolpath shapes and the G-code files are byte-identical with and without groups');
    measured.penplotter = { files: r.grouped.gcode.length, bytes: r.grouped.gcode.reduce((n, f) => n + f.content.length, 0) };
  } finally { await app.close(); }
}

// ---- Trace: the Edit tab's import lands grouped; the SVG / DXF downloads (the tracer's SVG) are identical with and without those groups
{
  const saved = {};
  const PAGE_GLOBALS = ['window', 'self', 'document', 'navigator', 'DOMParser', 'XMLSerializer', 'Node', 'Element', 'HTMLElement',
    'SVGElement', 'Event', 'KeyboardEvent', 'PointerEvent', 'MouseEvent', 'localStorage', 'ResizeObserver', 'URL', 'Blob'];
  for (const k of PAGE_GLOBALS) saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
  const win = new Window({ url: 'http://127.0.0.1/apps/trace/index.html', width: 1200, height: 800, settings: {
    disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, handleDisabledFileLoadingAsSuccess: true, disableIframePageLoading: true } });
  win.document.write(fs.readFileSync(path.resolve('apps/trace/index.html'), 'utf8'));
  const downloads = [];
  class FakeBlob { constructor(parts, opts) { this.textContent = parts.join(''); this.type = (opts && opts.type) || ''; } }
  const fakeURL = { createObjectURL: (blob) => { downloads.push(blob.textContent); return 'blob:trace-756-' + downloads.length; }, revokeObjectURL: () => {} };
  for (const k of ['window', 'self', 'document', 'navigator', 'DOMParser', 'XMLSerializer', 'Node', 'Element', 'HTMLElement', 'SVGElement', 'Event', 'KeyboardEvent', 'PointerEvent', 'MouseEvent', 'localStorage']) {
    const v = win[k];
    Object.defineProperty(globalThis, k, { value: k === 'window' || k === 'self' ? win : (typeof v === 'function' && /^[a-z]/.test(k) ? v.bind(win) : v), writable: true, configurable: true });
  }
  Object.defineProperty(globalThis, 'ResizeObserver', { value: class { observe() {} unobserve() {} disconnect() {} }, writable: true, configurable: true });
  Object.defineProperty(globalThis, 'Blob', { value: FakeBlob, writable: true, configurable: true });
  Object.defineProperty(globalThis, 'URL', { value: fakeURL, writable: true, configurable: true });
  win.URL = fakeURL;
  const doc = win.document;
  doc.getElementById('tab-edit').hidden = false;
  doc.getElementById('design-canvas').getBoundingClientRect = () => ({ left: 0, top: 80, width: 1200, height: 680, x: 0, y: 80, right: 1200, bottom: 760 });
  const origRaf = globalThis.requestAnimationFrame, origCancelRaf = globalThis.cancelAnimationFrame;
  win.requestAnimationFrame = () => 0; win.cancelAnimationFrame = () => {};
  globalThis.requestAnimationFrame = win.requestAnimationFrame; globalThis.cancelAnimationFrame = win.cancelAnimationFrame;
  try {
    const { mountEdit, getEditState, getEditBuffer, importToEdit } = await import('../apps/trace/src/edit-view.js');
    const { downloadSVG, downloadDXF } = await import('../apps/trace/src/export.js');
    mountEdit({ isActive: () => true, getHostData: () => ({}), applyHost: () => {} });
    await getEditBuffer().ready;
    const st = getEditState();
    const res = await quiet(async () => importToEdit(SVG, 'letters'))();
    ok(res.ok, 'trace: the letters imported into Edit: ' + res.message);
    landedGrouped(st, 'trace');
    const traced = SVG; // the tracer's output (state.svgString) is what Trace exports
    const r = withAndWithout(st, () => { downloads.length = 0; downloadSVG(traced, 'letters', 0.5, 60, 'mm'); downloadDXF(traced, 'letters', 0.5, 60, 'mm'); return downloads.slice(); });
    ok(r.grouped.length === 2 && r.grouped[1].includes('ENTITIES'), 'trace: the SVG and DXF downloads were made');
    eq(r.grouped, r.plain, 'trace: the SVG / DXF downloads are byte-identical with and without the Edit groups');
    measured.trace = { svg: r.grouped[0].length, dxf: r.grouped[1].length };
  } finally {
    await win.happyDOM.close();
    globalThis.requestAnimationFrame = origRaf; globalThis.cancelAnimationFrame = origCancelRaf;
    for (const k of PAGE_GLOBALS) { if (saved[k]) Object.defineProperty(globalThis, k, saved[k]); else delete globalThis[k]; }
  }
}

console.log(`groups-exports-756-node: ok (${checks} checks) ${JSON.stringify(measured)}`);
process.exit(0); // the mounted Trace Edit page keeps timers (as tests/construction-toggle-output-node.test.js)
