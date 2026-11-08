// tests/penplotter-doc.test.js — TASK 451: the ONE plotter-document serializer (apps/penplotter/src/plotter-doc.js).
// Undo takes the history subset; persistence takes that PLUS settings / shape styles / static ids; a restore keeps every
// part and moves the id counter past the restored ids.
import assert from 'node:assert';
import { state, makeToolpath, makePlotColor, setShapeStyle, uid } from '../apps/penplotter/src/state.js';
import { captureHistoryState, applyHistoryState, capturePlotterDoc, applyPlotterDoc } from '../apps/penplotter/src/plotter-doc.js';

// 1. the history subset is exactly what undo has always held (settings/styles/static ids are NOT rewound by undo)
{
  const keys = Object.keys(captureHistoryState()).sort();
  assert.deepStrictEqual(keys, ['activeArtLayerId', 'activeToolpathId', 'artLayers', 'doc', 'plotColors', 'toolpaths'], 'history subset keys');
  const doc = capturePlotterDoc();
  for (const k of keys) assert(k in doc, 'persisted doc carries the history key ' + k);
  for (const k of ['settings', 'shapeStyles', 'staticShapeIds', 'version']) assert(k in doc, 'persisted doc adds ' + k);
}

// 2. round trip: build state, capture through JSON (what IndexedDB does), wipe, apply -> equal
{
  state.doc = { w: 100, h: 80 };
  const pen = makePlotColor('Fine red', '#ff0000', 0.3); state.plotColors = [pen];
  const tp = makeToolpath('Disc', 'fill'); tp.targetShapeIds = ['s9']; tp.plotColorId = pen.id;
  tp.fill = { pattern: 'zigzag', angle: 30, spacing: 1.5, offset: 0.5 };
  const ol = makeToolpath('Tri', 'outline'); ol.outline.passes = 3; ol.outline.style = 'dashed';
  state.toolpaths = [ol, tp]; state.activeToolpathId = tp.id;
  state.settings = { pen_up_z: 7, pen_down_z: -2, draw_feed: 1234, z_feed: 567, tolerance_mm: 0.2, export_files: 'pen' };
  setShapeStyle('s9', { stroke: '#0000ff', fill: '#00ff00', width: 0.8 });
  state.staticShapeIds = new Set(['s9', 's10']);
  const saved = JSON.parse(JSON.stringify(capturePlotterDoc()));
  // restored ids sit exactly at the NEXT counter value, as after a page load whose counter restarted below them:
  // without the reseed the first fresh uid() would reproduce them.
  const n = +uid('probe').replace('probe', '') + 1;
  saved.toolpaths[1].id = 'toolpath' + n; saved.activeToolpathId = 'toolpath' + n; saved.plotColors[0].id = 'pen' + n;
  saved.toolpaths[1].plotColorId = 'pen' + n;

  state.doc = { w: 200, h: 200 }; state.plotColors = []; state.toolpaths = []; state.activeToolpathId = null;
  state.settings = { pen_up_z: 5, pen_down_z: -1, draw_feed: 2000, z_feed: 1000, tolerance_mm: 0.1, export_files: 'pen' };
  state.shapeStyles = new Map(); state.staticShapeIds = new Set();

  applyPlotterDoc(saved);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(capturePlotterDoc())), saved, 'apply(capture) reproduces the document');
  assert(state.shapeStyles instanceof Map && state.shapeStyles.get('s9').fill === '#00ff00', 'styles are a Map again');
  assert(state.staticShapeIds instanceof Set && state.staticShapeIds.has('s10'), 'static ids are a Set again');

  // 3. ids minted after the restore never collide with restored ids
  const fresh = [uid('toolpath'), uid('pen'), uid('toolpath')];
  const all = [...state.toolpaths.map(t => t.id), ...state.plotColors.map(p => p.id)];
  assert(fresh.every(f => !all.includes(f)), 'fresh ids ' + fresh + ' vs restored ' + all);
}

// 4. a document with only the history keys (no settings/styles/static ids) keeps the current defaults for those
{
  const before = JSON.stringify(state.settings);
  applyPlotterDoc({ ...captureHistoryState() });
  assert.strictEqual(JSON.stringify(state.settings), before, 'absent settings keep their value');
  assert.strictEqual(state.shapeStyles.size, 0, 'absent styles -> empty');
}

// 5. undo's restore leaves settings / styles / static ids alone
{
  setShapeStyle('s1', { stroke: '#123456' });
  state.settings.draw_feed = 4321;
  const snap = JSON.parse(JSON.stringify(captureHistoryState()));
  applyHistoryState(snap);
  assert.strictEqual(state.settings.draw_feed, 4321, 'undo restore does not touch settings');
  assert(state.shapeStyles.has('s1'), 'undo restore does not touch styles');
}
console.log('penplotter-doc: ok');
