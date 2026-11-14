// tests/construction-toggle-output-node.test.js — TASK 619:
// 1. Construction toggle (.sk-canvas-corner #btn-construct-toggle + K shortcut) is shared via #ui/design-browser.js
//    across SketchStudio, Shaper, and Trace (NOT in app-footer), and stays disabled in Pen Plotter per Safety Check.
// 2. K key and button toggle isConstructionMode, mark drawn shapes as construction, and toggle selected shape
//    isConstruction in one undo step (when Design view is active; ignored while input focused or tab hidden).
// 3. Safety / exclusion checks:
//    - Shaper: construction geometry is excluded from findLoops, findOpenChains, and exportShaperSVG cut output.
//    - Trace: construction geometry drawn in Edit does not appear in Trace's SVG / DXF exports.
//    - Pen Plotter: toggle & K stay disabled because collectToolpathShapes / buildGcodeEntries do not skip isConstruction.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { Window } from 'happy-dom';
import { open } from './helpers/node-app.js';
import { findLoops, findOpenChains } from '#core/loop-finder.js';
import { loopPolygon } from '#core/loop-geometry.js';
import { exportShaperSVG } from '#core/shaper-export.js';
import { exportEncoding } from '../apps/shaper/src/shaper.js';
import { collectToolpathShapes } from '../apps/penplotter/src/core-geometry.js';
import { buildGcodeEntries } from '../apps/penplotter/src/export.js';
import { downloadSVG, downloadDXF } from '../apps/trace/src/export.js';

// ---- 1. Enabled node-app hosts (SketchStudio + Shaper): toggle in .sk-canvas-corner (NOT footer), K & button work
for (const host of ['sketchstudio', 'shaper']) {
  const app = await open({ host, designBrowser: true });
  try {
    const doc = app.document;
    const footer = doc.querySelector('footer');
    const corner = doc.querySelector('.sk-canvas-corner');
    const cBtn = doc.getElementById('btn-construct-toggle');
    assert(corner && cBtn, host + ': #btn-construct-toggle mounted');
    assert.strictEqual(cBtn.closest('.sk-canvas-corner'), corner, host + ': button sits in .sk-canvas-corner');
    assert.strictEqual(cBtn.closest('footer'), null, host + ': button is NOT in footer');
    assert(!footer.querySelector('#btn-construct-toggle'), host + ': footer contains no construction button');
    assert.strictEqual(cBtn.getAttribute('aria-pressed'), 'false', host + ': initially OFF');
    assert.strictEqual(cBtn.title, 'Construction: OFF (K)', host + ': title advertises K shortcut');

    // K toggles mode ON -> draws construction line -> K toggles OFF -> draws solid line
    app.key('k');
    assert.strictEqual(app.state.isConstructionMode, true, host + ': K toggles isConstructionMode ON');
    assert.strictEqual(cBtn.getAttribute('aria-pressed'), 'true', host + ': aria-pressed updates on K');
    assert.strictEqual(cBtn.title, 'Construction: ON (K)', host + ': title updates on K');

    const r = app.svg.getBoundingClientRect();
    const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
    app.tool('line');
    app.click(cx - 80, cy - 30); app.click(cx + 80, cy - 30); app.esc();
    assert.strictEqual(app.state.shapes.length, 1, host + ': first line drawn');
    assert.strictEqual(app.state.shapes[0].isConstruction, true, host + ': line drawn while ON is construction');

    // Toggle back OFF via button click and draw a normal solid line
    cBtn.click(); app.frames();
    assert.strictEqual(app.state.isConstructionMode, false, host + ': button click toggles isConstructionMode OFF');
    assert.strictEqual(cBtn.getAttribute('aria-pressed'), 'false');

    app.tool('line');
    app.click(cx - 80, cy + 40); app.click(cx + 80, cy + 40); app.esc();
    assert.strictEqual(app.state.shapes.length, 2, host + ': second line drawn');
    assert.strictEqual(!!app.state.shapes[1].isConstruction, false, host + ': line drawn while OFF is solid');

    // Selecting a shape + K toggles that shape's isConstruction in 1 undo step
    app.tool('select');
    app.click(cx, cy + 40);
    assert.strictEqual(app.state.selectedShapes.size, 1, host + ': solid line selected');
    const histBefore = app.state.history.length;
    app.key('k');
    assert.strictEqual(app.state.shapes[1].isConstruction, true, host + ': K toggles selected shape to construction');
    assert.strictEqual(app.state.history.length, histBefore + 1, host + ': toggling selection is 1 undo step');
    app.undo();
    assert.strictEqual(!!app.state.shapes[1].isConstruction, false, host + ': Undo restores shape construction flag');

    // Typing k in an <input> must NOT toggle construction
    const inp = doc.createElement('input');
    doc.body.appendChild(inp);
    inp.focus();
    const modeBefore = app.state.isConstructionMode;
    app.key('k');
    assert.strictEqual(app.state.isConstructionMode, modeBefore, host + ': K inside input does not toggle construction');
    inp.blur(); inp.remove();

    // Shaper hidden Design tab: K does NOT toggle while Prepare is active
    if (host === 'shaper') {
      app.modes.showMode('prepare');
      const m0 = app.state.isConstructionMode;
      app.key('k');
      assert.strictEqual(app.state.isConstructionMode, m0, 'shaper: K ignored when Design stage is hidden');
      app.modes.showMode('design');
    }
  } finally {
    await app.close();
  }
}

// ---- 2. Shaper output exclusion: construction line drawn via K inside a closed square never splits loops, never forms chains, never exports
{
  const app = await open({ host: 'shaper', designBrowser: true });
  try {
    const r = app.svg.getBoundingClientRect();
    const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);

    // Draw closed 100x80 rectangle using 4 separate solid lines sharing corners? Even cleaner: rect tool creates 4 solid lines!
    app.tool('rect');
    app.click(cx - 50, cy - 40); app.click(cx + 50, cy + 40); app.esc();
    const solidIds = app.state.shapes.map((s) => s.id);
    assert.strictEqual(solidIds.length, 4, 'shaper: 4 solid rectangle sides');
    assert(app.state.shapes.every((s) => !s.isConstruction), 'shaper: rectangle sides are solid');

    // Turn construction ON with K and draw a construction diagonal bisecting the rectangle
    app.key('k');
    assert.strictEqual(app.state.isConstructionMode, true);
    app.tool('line');
    app.click(cx - 50, cy - 40); app.click(cx + 50, cy + 40); app.esc();
    assert.strictEqual(app.state.shapes.length, 5, 'shaper: construction diagonal added');
    const diag = app.state.shapes[4];
    assert.strictEqual(diag.isConstruction, true, 'shaper: diagonal is marked isConstruction: true');

    const loops = findLoops(app.state);
    assert.strictEqual(loops.length, 1, 'shaper: findLoops skips construction diagonal (1 loop, not 2 triangles)');
    assert(!loops[0].edges.includes(diag.id), 'shaper: construction diagonal is not in loop edges');

    const chains = findOpenChains(app.state, loops);
    assert.strictEqual(chains.length, 0, 'shaper: findOpenChains excludes construction diagonal');

    const sById = new Map(app.state.shapes.map((s) => [s.id, s]));
    const loopPolys = { [loops[0].id]: loopPolygon(loops[0], app.state, sById) };
    const svg = exportShaperSVG({
      state: app.state,
      entries: [{ target: { kind: 'loop', id: loops[0].id }, rec: { cutType: 'exterior', cutDepth: 5, cutOffset: 0, toolDia: 3.175 } }],
      encoding: exportEncoding(),
      docUnit: 'mm',
      options: { groupByCut: true },
      loopPolys,
    });
    const pathMatches = svg.match(/<path\b/g) || [];
    const lineMatches = svg.match(/<line\b/g) || [];
    assert.strictEqual(pathMatches.length, 1, 'shaper: exportShaperSVG emits only the 1 solid loop path');
    assert.strictEqual(lineMatches.length, 0, 'shaper: exportShaperSVG emits no construction line element');
  } finally {
    await app.close();
  }
}

// ---- 3. Pen Plotter safety gate: Construction stays disabled; confirm why (collectToolpathShapes / buildGcodeEntries do not skip isConstruction)
{
  const app = await open({ host: 'penplotter' });
  try {
    assert.strictEqual(app.document.getElementById('btn-construct-toggle'), null, 'penplotter: Construction button is NOT mounted');
    app.key('k');
    assert.strictEqual(app.state.isConstructionMode, false, 'penplotter: K does NOT enable construction mode');

    // Confirm the unfixed leak in Pen Plotter's toolpath/G-code pipeline that justifies keeping Construction disabled there:
    const j1 = app.engine.genJ(), j2 = app.engine.genJ();
    app.engine.addJoint(j1, 10, 10, false);
    app.engine.addJoint(j2, 60, 10, false);
    const leakedId = 'S_leak_con';
    app.state.shapes.push({ id: leakedId, type: 'line', joints: [j1, j2], isConstruction: true, sketchId: app.state.activeSketchId });
    app.plotter.toolpaths = [{ id: 'tp1', name: 'T1', type: 'outline', export: true, penId: app.plotter.pens?.[0]?.id || 'p1', targetShapeIds: [leakedId], fill: null }];
    const tpShapes = collectToolpathShapes(app.plotter.toolpaths[0]);
    const gcode = buildGcodeEntries();
    assert(tpShapes.some((s) => s.id === leakedId), 'penplotter safety audit confirmed: collectToolpathShapes still includes isConstruction shapes');
    assert(gcode.length > 0, 'penplotter safety audit confirmed: buildGcodeEntries emits G-code for unguarded isConstruction shapes');
  } finally {
    await app.close();
  }
}

// ---- 4. Trace: Construction toggle works on Edit canvas, and Edit construction geometry never leaks into Trace exports
{
  const saved = {};
  const PAGE_GLOBALS = ['window', 'self', 'document', 'navigator', 'DOMParser', 'XMLSerializer', 'Node', 'Element', 'HTMLElement',
    'SVGElement', 'Event', 'KeyboardEvent', 'PointerEvent', 'MouseEvent', 'localStorage', 'ResizeObserver', 'URL', 'Blob'];
  for (const k of PAGE_GLOBALS) saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);

  const traceHtml = fs.readFileSync(path.resolve('apps/trace/index.html'), 'utf8');
  const win = new Window({ url: 'http://127.0.0.1/apps/trace/index.html', width: 1200, height: 800, settings: {
    disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, handleDisabledFileLoadingAsSuccess: true,
    disableIframePageLoading: true } });
  win.document.write(traceHtml);

  const downloads = [];
  class FakeBlob {
    constructor(parts, opts) { this.textContent = parts.join(''); this.type = opts?.type || ''; }
    async text() { return this.textContent; }
  }
  const origURL = win.URL || globalThis.URL;
  const fakeURL = {
    createObjectURL: (blob) => { downloads.push(blob); return 'blob:trace-test-' + downloads.length; },
    revokeObjectURL: () => {},
  };
  for (const k of ['window', 'self', 'document', 'navigator', 'DOMParser', 'XMLSerializer', 'Node', 'Element', 'HTMLElement',
    'SVGElement', 'Event', 'KeyboardEvent', 'PointerEvent', 'MouseEvent', 'localStorage']) {
    const v = win[k];
    Object.defineProperty(globalThis, k, { value: k === 'window' || k === 'self' ? win : (typeof v === 'function' && /^[a-z]/.test(k) ? v.bind(win) : v), writable: true, configurable: true });
  }
  Object.defineProperty(globalThis, 'ResizeObserver', { value: class { observe() {} unobserve() {} disconnect() {} }, writable: true, configurable: true });
  Object.defineProperty(globalThis, 'Blob', { value: FakeBlob, writable: true, configurable: true });
  Object.defineProperty(globalThis, 'URL', { value: fakeURL, writable: true, configurable: true });
  win.URL = fakeURL;

  const doc = win.document;
  const tabEdit = doc.getElementById('tab-edit');
  tabEdit.hidden = false;
  const svgEl = doc.getElementById('design-canvas');
  svgEl.getBoundingClientRect = () => ({ left: 0, top: 80, width: 1200, height: 680, x: 0, y: 80, right: 1200, bottom: 760 });
  const rafQueue = [];
  win.requestAnimationFrame = (fn) => { rafQueue.push(fn); return rafQueue.length; };
  win.cancelAnimationFrame = () => {};
  const origRaf = globalThis.requestAnimationFrame, origCancelRaf = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = win.requestAnimationFrame;
  globalThis.cancelAnimationFrame = win.cancelAnimationFrame;

  try {
    const { mountEdit, getEditState, getEditBuffer } = await import('../apps/trace/src/edit-view.js');
    mountEdit({ isActive: () => !tabEdit.hidden, getHostData: () => ({}), applyHost: () => {} });
    await getEditBuffer().ready;
    const st = getEditState();
    const cBtn = doc.getElementById('btn-construct-toggle');
    assert(cBtn && cBtn.closest('.sk-canvas-corner'), 'trace: #btn-construct-toggle mounted in .sk-canvas-corner');

    // K toggles ON on visible Edit tab -> hidden Edit tab ignores K
    doc.body.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'k', bubbles: true }));
    assert.strictEqual(st.isConstructionMode, true, 'trace: K turns Construction ON when Edit tab visible');
    assert.strictEqual(cBtn.getAttribute('aria-pressed'), 'true');
    tabEdit.hidden = true;
    doc.body.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'k', bubbles: true }));
    assert.strictEqual(st.isConstructionMode, true, 'trace: K ignored while Edit tab is hidden');
    tabEdit.hidden = false;

    // Button toggles OFF then ON, draw a line in Edit with construction ON (distinct coords 777..888)
    cBtn.click();
    assert.strictEqual(st.isConstructionMode, false, 'trace: button click toggles OFF');
    cBtn.click();
    assert.strictEqual(st.isConstructionMode, true, 'trace: button click toggles ON');
    const j1 = st.engine.genJ(), j2 = st.engine.genJ();
    st.engine.addJoint(j1, 777, 111, false);
    st.engine.addJoint(j2, 888, 222, false);
    st.shapes.push({ id: 'tr_con_line', type: 'line', joints: [j1, j2], isConstruction: st.isConstructionMode, sketchId: st.activeSketchId });
    assert.strictEqual(st.shapes[0].isConstruction, true, 'trace: Edit line marked isConstruction');

    // Export traced raster SVG & DXF -> neither includes Edit's construction line (777 / 888)
    const tracedSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M 10 10 L 90 10 L 90 90 Z"/></svg>';
    downloadSVG(tracedSvg, 'traced-test', 1, 100, 'mm');
    downloadDXF(tracedSvg, 'traced-test', 1, 100, 'mm');
    assert.strictEqual(downloads.length, 2, 'trace: downloaded SVG and DXF');
    const svgOut = downloads[0].textContent;
    const dxfOut = downloads[1].textContent;
    assert(!svgOut.includes('777') && !svgOut.includes('888'), 'trace: exported SVG excludes Edit construction line');
    assert(!dxfOut.includes('777') && !dxfOut.includes('888'), 'trace: exported DXF excludes Edit construction line');
  } finally {
    await win.happyDOM.close();
    globalThis.requestAnimationFrame = origRaf;
    globalThis.cancelAnimationFrame = origCancelRaf;
    for (const k of PAGE_GLOBALS) {
      if (saved[k]) Object.defineProperty(globalThis, k, saved[k]);
      else delete globalThis[k];
    }
    if (!saved.URL && origURL) globalThis.URL = origURL;
  }
}

console.log('construction-toggle-output-node: OK');
process.exit(0);
