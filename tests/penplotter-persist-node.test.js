// tests/penplotter-persist-node.test.js — TASK 583 (node port of tests/penplotter-persist.test.js, TASK 451): the Pen Plotter's own document survives a page
// reload (close + open on the same profile, the kit's reload). Import an SVG, build pens / toolpaths / settings / styles + a non-default doc size, wait for the
// autosave, reload, compare the persisted plotter document, the exported G-code (byte-identical) and the panels. Then strip the host sidecar from the saved
// design (an OLD document) and reload: defaults, geometry kept. Through tests/helpers/node-app.js with the real stages.
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { importDrawing } from '../apps/penplotter/src/sketch-stage.js';
import { capturePlotterDoc } from '../apps/penplotter/src/plotter-doc.js';
import { buildGcodeEntries } from '../apps/penplotter/src/export.js';
import { state, makeToolpath, uid } from '../apps/penplotter/src/state.js';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="80mm" viewBox="0 0 100 80">'
  + '<path d="M10 10 L40 10 L40 30 Z" stroke="#ff0000" fill="none"/>'
  + '<circle cx="70" cy="25" r="12" stroke="#0000ff" fill="#00ff00"/></svg>';

const profile = await createProfile();
await createNamedDesign(profile, 'penplotter', 'Persist test'); // TASK 558: only a NAMED design autosaves; the next load restores it

const observe = (app) => JSON.parse(JSON.stringify({
  plotter: capturePlotterDoc(),
  shapes: app.state.shapes.length,
  gcode: buildGcodeEntries(),
  penRows: app.document.querySelectorAll('#plotColors .pc-row').length,
  docInfo: (app.document.getElementById('docInfo') || {}).textContent || '',
  stage: app.document.querySelector('.stage-btn.active').dataset.stage,
  drawFeedInput: (app.document.getElementById('drawFeed') || {}).value,
}));

let before, storedId;
{
  const app = await open({ host: 'penplotter', profile });
  try {
    const doc = app.document;
    const imp = importDrawing(SVG, 'persist.svg'); assert(imp.ok, 'SVG import: ' + imp.message); // the File menu entry runs this after its chooser
    assert(app.state.shapes.length > 0, 'SVG import produced geometry');
    // Build the plotter state: a click on + Pen, then toolpaths/settings/styles (test setup, not the gesture under test).
    app.press(doc.querySelector('.stage-btn[data-stage="toolpath"]'));
    assert(doc.querySelector('.stage-btn[data-stage="toolpath"]').classList.contains('active') && doc.getElementById('addPlotColor'), 'toolpath stage shown');
    app.press(doc.getElementById('addPlotColor'));
    assert(doc.querySelectorAll('#plotColors .pc-row').length >= 1, 'pen row added');
    const shapes = app.state.shapes;
    const circle = shapes.find((s) => s.type === 'circle').id;
    const lines = shapes.map((s) => s.id).filter((i) => i !== circle);
    state.doc = { w: 100, h: 80 };
    const a = makeToolpath('Tri', 'outline'); a.targetShapeIds = lines; a.plotColorId = state.plotColors[0].id; a.outline.passes = 2; a.outline.style = 'dashed';
    const b = makeToolpath('Disc', 'fill'); b.targetShapeIds = [circle]; b.plotColorId = state.plotColors[state.plotColors.length - 1].id;
    b.fill = { pattern: 'crosshatch', angle: 30, spacing: 1.5, offset: 0.5 };
    state.toolpaths = [a, b]; state.activeToolpathId = b.id;
    state.settings = { pen_up_z: 7, pen_down_z: -2, draw_feed: 1234, z_feed: 567, tolerance_mm: 0.2, export_files: 'pen' };
    state.plotColors[0].name = 'Fine red'; state.plotColors[0].width = 0.3;
    // the sidecar written AFTER the setup is the one saved: the autosave (the page-hide path) stores the setup
    const saved = await app.storedDoc();
    const p = saved.hosts && saved.hosts.penplotter;
    assert(!!p && p.toolpaths.length === 2 && p.settings.draw_feed === 1234 && p.plotColors[0].name === 'Fine red', 'the setup is persisted');
    assert.strictEqual(app.saveStatus(), 'Saved', 'autosave reports Saved');
    before = observe(app);
    assert(before.plotter.toolpaths.length === 2 && before.plotter.plotColors.length >= 2, 'setup built the plotter state');
    assert(before.gcode.length === 2, 'two exportable toolpaths before reload: ' + before.gcode.length);
    assert(before.shapes > 0, 'geometry imported');
    storedId = (await app.store.loadCurrent({ app: 'penplotter' })).id;
  } finally { await app.close(); }
}

{ // reload
  const app = await open({ host: 'penplotter', profile });
  try {
    const after = observe(app);
    console.log('before:', before.docInfo, '| pens', before.plotter.plotColors.length, '| toolpaths', before.plotter.toolpaths.length, '| feed', before.plotter.settings.draw_feed);
    console.log('after :', after.docInfo, '| pens', after.plotter.plotColors.length, '| toolpaths', after.plotter.toolpaths.length, '| feed', after.plotter.settings.draw_feed);
    assert.strictEqual(after.stage, before.stage, 'active stage restored');
    assert.deepStrictEqual(after.plotter, before.plotter, 'the whole plotter document (doc, pens, toolpaths, settings, styles, static ids) is equal after reload');
    assert.strictEqual(after.shapes, before.shapes, 'geometry restored');
    assert.deepStrictEqual(after.gcode, before.gcode, 'the exported G-code is byte-identical after reload');
    assert.strictEqual(after.penRows, before.plotter.plotColors.length, 'the Pens panel shows the restored pens');
    assert(/100 × 80 mm/.test(after.docInfo), 'canvas readout shows the restored doc size: ' + after.docInfo);
    assert.strictEqual(after.drawFeedInput, '1234', 'the Toolpath settings inputs show the restored feed');
    // ids minted after the restore must not collide with restored ones
    const fresh = [uid('toolpath'), uid('pen')];
    const all = [...state.toolpaths.map((t) => t.id), ...state.plotColors.map((p) => p.id)];
    assert.deepStrictEqual(fresh.filter((x) => all.includes(x)), [], 'new ids do not collide with restored ids');
  } finally { await app.close(); }
}

// OLD document: strip the host sidecar from the saved buffer, reload -> plotter defaults, geometry kept.
await profile.adapter.updateDesign(storedId, (d) => { delete d.document.hosts.penplotter; return d; });
{
  const app = await open({ host: 'penplotter', profile });
  try {
    const old = observe(app);
    console.log('old doc :', old.docInfo, '| pens', old.plotter.plotColors.length, '| toolpaths', old.plotter.toolpaths.length, '| shapes', old.shapes);
    assert.strictEqual(old.shapes, before.shapes, 'an old document still restores its geometry');
    assert.deepStrictEqual(old.plotter.doc, { w: 200, h: 200 }, 'old document: default doc size');
    assert.strictEqual(old.plotter.plotColors.length, 0, 'old document: no pens');
    assert.strictEqual(old.plotter.toolpaths.length, 1, 'old document: the single default toolpath');
    assert.strictEqual(old.plotter.settings.draw_feed, 2000, 'old document: default feed');
  } finally { await app.close(); }
}
console.log('penplotter-persist-node: ok');
