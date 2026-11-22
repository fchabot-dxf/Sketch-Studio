// tests/cut-band-857-node.test.js — TASK 857: 2D cut band (open op in Prepare, selected op in Export Paths) + 2D Simulate dimmer trail.
import assert from 'node:assert/strict';
import { open } from './helpers/node-app.js';
import SettingsManager from '#core/settings-manager.js';
import { findLoops } from '#core/loop-finder.js';
import { CUT_TYPES, CUT_BAND_STYLE, cutBandColor } from '../apps/shaper/src/shaper.js';
import { keyOf } from '../apps/shaper/src/cut-plan.js';
import { storeOps } from '../apps/shaper/src/operations-store.js';
import { V2_PLAN } from './helpers/plan-v2.js';
import { exportFileOf, bitCentrePaths, simElements } from '../apps/shaper/src/export-payload.js';
import { createPathsServer } from '../apps/shaper/src/op-derive.js';
import { setPathsPort } from '../apps/shaper/src/op-paths.js';
import { mountExportPreview, fileLengthMm, previewItems, parseShaperSvg } from '../apps/shaper/src/export-preview.js';
import { buildTimeline, stepIndexAt, pointOnStep, travelledOf, elementStateAt } from '../apps/shaper/src/cut-timeline.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b}`); checks++; };

// 1. Declared cut-band style + helpers
ok(CUT_BAND_STYLE.opacity > 0 && CUT_BAND_STYLE.opacity < 1, 'CUT_BAND_STYLE.opacity is translucent');
ok(CUT_BAND_STYLE.simOpacity > 0 && CUT_BAND_STYLE.simOpacity < CUT_BAND_STYLE.opacity, '2D Simulate trail opacity is dimmer than active cut band');
for (const ct of CUT_TYPES.filter((t) => t.passColor)) {
  eq(cutBandColor(ct.id), ct.passColor, `cutBandColor(${ct.id}) reads passColor`);
}
eq(cutBandColor('guide'), null, 'guides have no cut-band colour');
eq(cutBandColor('stock'), null, 'stock has no cut-band colour');
near(fileLengthMm('0.25in'), 6.35, 1e-6, 'fileLengthMm inches');
near(fileLengthMm('6 mm'), 6, 1e-6, 'fileLengthMm mm');
eq(fileLengthMm(''), null, 'fileLengthMm empty');

function manualPort() {
  const turns = [], answers = [];
  let deliver = () => {};
  const server = createPathsServer({ post: (m) => answers.push(structuredClone(m)), schedule: (fn) => turns.push(fn) });
  return {
    kind: 'manual', post: (m) => server.receive(structuredClone(m)), listen: (fn) => { deliver = fn; }, close() {},
    flush() {
      let n = 0;
      while (turns.length || answers.length) {
        while (turns.length) turns.shift()();
        while (answers.length) { deliver(answers.shift()); n++; }
      }
      return n;
    },
  };
}
function addRect(st, n, x0, y0, x1, y1) {
  [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].forEach(([x, y], i) => st.joints.set(`${n}j${i}`, { x, y, sketchId: 'sketch-1' }));
  for (let i = 0; i < 4; i++) st.shapes.push({ id: `${n}s${i}`, type: 'line', joints: [`${n}j${i}`, `${n}j${(i + 1) % 4}`], sketchId: 'sketch-1' });
}
function addCircle(st, n, cx, cy, r) {
  st.joints.set(`${n}c`, { x: cx, y: cy, sketchId: 'sketch-1' });
  st.shapes.push({ id: `${n}s0`, type: 'circle', joints: [`${n}c`], radius: r, sketchId: 'sketch-1' });
}
function bboxOfPathD(d) {
  const nums = (d || '').match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi).map(Number);
  const xs = [], ys = [];
  for (let i = 0; i + 1 < nums.length; i += 2) { xs.push(nums[i]); ys.push(nums[i + 1]); }
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

SettingsManager.set('DOC_UNIT', 'mm', { persist: false });
SettingsManager.set('LENGTH_PRECISION', null);

const port = manualPort();
setPathsPort(port);
const app = await open({ host: 'shaper' });
try {
  const st = app.state, doc = app.document, q = (s) => doc.querySelector(s), qa = (s) => [...doc.querySelectorAll(s)];
  for (const k of [...st.joints.keys()]) st.joints.delete(k);
  st.shapes.length = 0; st.constraints.length = 0; if (st.profiles) st.profiles.length = 0;
  // Outside rect A (0..60 x 0..40), Inside circle B (center 100,20, r=14), Freehand pocket C (130..190 x 0..40),
  // Programmed Raster pocket D (210..270 x 0..40), On line rect E (290..330 x 0..40)
  addRect(st, 'A', 0, 0, 60, 40);
  addCircle(st, 'B', 100, 20, 14);
  addRect(st, 'C', 130, 0, 190, 40);
  addRect(st, 'D', 210, 0, 270, 40);
  addRect(st, 'E', 290, 0, 330, 40);
  const loops = findLoops(st);
  const loopKey = (prefix) => keyOf('loop', loops.find((l) => l.edges.some((e) => e.startsWith(prefix))).id);
  const K = { A: loopKey('A'), B: loopKey('B'), C: loopKey('C'), D: loopKey('D'), E: loopKey('E') };

  const BIT = 6, R = BIT / 2;
  V2_PLAN.clear();
  V2_PLAN.use(st).load([
    [K.A, { cutType: 'exterior', cutDepth: 12, cutOffset: 0, toolDia: BIT }],
    [K.B, { cutType: 'interior', cutDepth: 12, cutOffset: 0, toolDia: BIT }],
    [K.C, { cutType: 'pocket', cutDepth: 5, cutOffset: 0, toolDia: BIT, clearing: 'freehand' }],
    [K.D, { cutType: 'pocket', cutDepth: 5, cutOffset: 0, toolDia: BIT, clearing: 'raster', stepover: 40, finishAllowance: 0.5, rasterAngle: 0 }],
    [K.E, { cutType: 'online', cutDepth: 3, cutOffset: 0, toolDia: BIT }],
  ]);
  const opFor = (key) => storeOps().find((o) => o.geometry.some((g) => g.key === key));
  const outOp = opFor(K.A), inOp = opFor(K.B), freeOp = opFor(K.C), rasterOp = opFor(K.D), onOp = opFor(K.E);

  const baselineSvg = exportFileOf(st).svg;

  const generate = async () => { port.flush(); await new Promise((r) => setTimeout(r, 15)); };
  app.modes.showMode('prepare');
  await generate();
  const pv = app.prepare.view();
  const pressEl = (s) => { const e = typeof s === 'string' ? q(s) : s; assert.ok(e, `${s} not found`); app.press(e); };
  const selectRow = (id) => pressEl(`#prepare-ops .ops-row[data-id="${id}"] .ops-pick`);
  const openOp = (id) => { selectRow(id); pressEl(`#prepare-ops .ops-row[data-id="${id}"] .ops-edit`); eq(app.prepare.openId(), id, `${id} open`); };

  // Trigger paths generation for all ops then settle
  for (const op of storeOps()) { selectRow(op.id); await generate(); }

  // When NO operation is open: normal selection shows .sk-band, zero .sk-cutband
  selectRow(outOp.id);
  await generate();
  eq(qa('#prepare-cut-group .sk-cutband').length, 0, 'no open op: no .sk-cutband shown');
  ok(qa('#prepare-cut-group .sk-band').length >= 1, 'no open op: normal .sk-band still renders');

  // Open Outside op: shows bit-wide cut band (rect bit path +- r = 3 around [0..60]x[0..40])
  openOp(outOp.id);
  // TASK 817: an operation just opened draws its paths as they were, FAINT (until its Preview / OK): its band is part of that look, faint with it
  console.log('Prepare Outside just opened: band faint =', !!q('#prepare-cut-group .sk-cutband').closest('.sk-faint'), ', paths faint =', !!q('#prepare-toolpath-group .sk-faint'));
  eq(Boolean(q('#prepare-cut-group .sk-cutband').closest('.sk-faint')), Boolean(q('#prepare-toolpath-group .sk-faint')), 'Prepare: the band of the open operation is faint exactly when its paths are');
  eq(qa('#prepare-cut-group .sk-st-sel .sk-band, #prepare-cut-group .sk-st-hot .sk-band').length, 0, 'Prepare: the open operation draws its cut band in place of its selection band');
  let cutBands = qa('#prepare-cut-group .sk-cutband');
  eq(cutBands.length, 1, 'Prepare Outside open: exactly ONE .sk-cutband group');
  eq(cutBands[0].getAttribute('data-op'), outOp.id, 'Prepare Outside: data-op matches open op');
  eq(cutBands[0].style.color, cutBandColor('exterior'), 'Prepare Outside: colour matches exterior passColor');
  const outStrokes = [...cutBands[0].querySelectorAll('.sk-cutband-stroke')];
  eq(outStrokes.length, 1, 'Prepare Outside: 1 stroke path');
  eq(outStrokes[0].getAttribute('stroke-width'), String(BIT), 'Prepare Outside: stroke-width == 2*r (6 mm)');
  const outBox = bboxOfPathD(outStrokes[0].getAttribute('d'));
  near(outBox.minX, -R, 0.05, 'Prepare Outside bit center minX == -r');
  near(outBox.maxX, 60 + R, 0.05, 'Prepare Outside bit center maxX == 60 + r');
  near(outBox.minY, -R, 0.05, 'Prepare Outside bit center minY == -r');
  near(outBox.maxY, 40 + R, 0.05, 'Prepare Outside bit center maxY == 40 + r');
  // z-order: #prepare-cut-group sits before #prepare-world-group and #prepare-toolpath-group
  const children = [...doc.getElementById('prepare-canvas').children];
  ok(children.indexOf(doc.getElementById('prepare-cut-group')) < children.indexOf(doc.getElementById('prepare-toolpath-group')),
    'Prepare: cut-group (with .sk-cutband) is under toolpath-group');

  // Open Inside circle op: bit center radius == 14 - 3 = 11, stroke-width == 6 (covers r in [8, 14])
  openOp(inOp.id);
  cutBands = qa('#prepare-cut-group .sk-cutband');
  eq(cutBands.length, 1, 'Prepare Inside open: exactly ONE .sk-cutband group');
  eq(cutBands[0].getAttribute('data-op'), inOp.id, 'Prepare Inside: data-op matches open op');
  eq(cutBands[0].style.color, cutBandColor('interior'), 'Prepare Inside: colour matches interior passColor');
  const inStrokes = [...cutBands[0].querySelectorAll('.sk-cutband-stroke')];
  eq(inStrokes.length, 1, 'Prepare Inside: 1 stroke path');
  eq(inStrokes[0].getAttribute('stroke-width'), String(BIT), 'Prepare Inside: stroke-width == 2*r (6 mm)');
  const inBox = bboxOfPathD(inStrokes[0].getAttribute('d'));
  near(inBox.maxX - inBox.minX, 2 * (14 - R), 0.1, 'Prepare Inside bit center diameter == 2*(14 - 3)');

  // Open Freehand Pocket op: light fill of area cleared, no clearing stroke paths
  openOp(freeOp.id);
  cutBands = qa('#prepare-cut-group .sk-cutband');
  eq(cutBands.length, 1, 'Prepare Freehand Pocket open: ONE .sk-cutband group');
  eq(cutBands[0].style.color, cutBandColor('pocket'), 'Prepare Freehand Pocket: colour matches pocket passColor');
  ok(cutBands[0].querySelectorAll('.sk-cutband-fill').length >= 1, 'Prepare Freehand Pocket: filled cleared area');
  eq(cutBands[0].querySelectorAll('.sk-cutband-stroke').length, 0, 'Prepare Freehand Pocket: no pass strokes');
  const freeBox = bboxOfPathD([...cutBands[0].querySelectorAll('.sk-cutband-fill')].map((e) => e.getAttribute('d')).join(' '));
  near(freeBox.minX, 130, 0.05, 'Prepare Freehand Pocket fill = the cleared area: minX = the wall'); near(freeBox.maxX, 190, 0.05, 'Prepare Freehand Pocket fill maxX = the wall');
  near(freeBox.minY, 0, 0.05, 'Prepare Freehand Pocket fill minY = the wall'); near(freeBox.maxY, 40, 0.05, 'Prepare Freehand Pocket fill maxY = the wall');

  // Open Programmed Raster Pocket: ALL passes wrapped inside ONE .sk-cutband group so overlaps don't darken
  openOp(rasterOp.id);
  cutBands = qa('#prepare-cut-group .sk-cutband');
  eq(cutBands.length, 1, 'Prepare Raster Pocket open: ONE union .sk-cutband group for all overlapping passes');
  ok(cutBands[0].querySelectorAll('.sk-cutband-stroke').length >= 2, 'Prepare Raster Pocket: multiple programmed pass strokes in the single union group');

  // Open On-line op
  openOp(onOp.id);
  cutBands = qa('#prepare-cut-group .sk-cutband');
  eq(cutBands.length, 1, 'Prepare On-line open: ONE .sk-cutband group');
  eq(cutBands[0].style.color, cutBandColor('online'), 'Prepare On-line: colour matches online passColor');
  eq(cutBands[0].querySelector('.sk-cutband-stroke').getAttribute('stroke-width'), String(BIT), 'Prepare On-line: stroke-width == 2*r');

  // 3. Export Paths & 2D Simulate
  const svgCanvas = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const stageDiv = doc.createElement('div');
  stageDiv.appendChild(svgCanvas);
  const listDiv = doc.createElement('div');
  const infoDiv = doc.createElement('div');
  const exp = exportFileOf(st, { preview: true });
  const bitPaths = bitCentrePaths(st, exp.written);
  const simEls = simElements(st, exp.written, bitPaths);
  const preview = { svg: exp.svg, ops: storeOps().map((o) => ({ id: o.id, label: o.type, typeLabel: o.type, cutType: o.type, tool: { dia: o.settings.toolDia } })), bitPaths, simElements: simEls };

  const ep = mountExportPreview({ canvas: svgCanvas, list: listDiv, info: infoDiv, getPreview: () => preview, emptyText: 'empty' });
  ep.setMode('paths');
  ep.refresh('sig-1');

  const topChildren = [...svgCanvas.firstChild.children];
  const bandEl = svgCanvas.querySelector('.rv2d-cutband');
  const simBandsEl = svgCanvas.querySelector('.rv2d-sim-bands');
  const docEl = svgCanvas.querySelector('.rv2d-doc');
  ok(topChildren.indexOf(bandEl) < topChildren.indexOf(docEl), 'Export Paths: .rv2d-cutband sits under .rv2d-doc path lines');
  ok(topChildren.indexOf(simBandsEl) < topChildren.indexOf(docEl), 'Export Paths: .rv2d-sim-bands sits under .rv2d-doc path lines');
  eq(bandEl.children.length, 0, 'Export Paths initial (no selection): no cut band');

  ep.pickOp(outOp.id);
  eq(bandEl.getAttribute('data-op'), outOp.id, 'Export Paths Outside selected');
  eq(bandEl.style.color, cutBandColor('exterior'), 'Export Paths Outside: colour matches exterior passColor');
  eq(bandEl.querySelectorAll('.rv2d-cutband-stroke').length, 1, 'Export Paths Outside: 1 stroke');
  eq(bandEl.querySelector('.rv2d-cutband-stroke').getAttribute('stroke-width'), String(BIT), 'Export Paths Outside: stroke-width == shaper:toolDia');
  const expOutBox = bboxOfPathD(bandEl.querySelector('.rv2d-cutband-stroke').getAttribute('d'));
  near(expOutBox.minX, -R, 0.05, 'Export Paths Outside bit centre minX == -r'); near(expOutBox.maxX, 60 + R, 0.05, 'Export Paths Outside bit centre maxX == 60 + r');
  near(expOutBox.minY, -R, 0.05, 'Export Paths Outside bit centre minY == -r'); near(expOutBox.maxY, 40 + R, 0.05, 'Export Paths Outside bit centre maxY == 40 + r');

  ep.pickOp(inOp.id);
  eq(bandEl.getAttribute('data-op'), inOp.id, 'Export Paths Inside selected (only selected op gets band)');
  eq(bandEl.style.color, cutBandColor('interior'), 'Export Paths Inside: colour matches interior passColor');
  const expInBox = bboxOfPathD(bandEl.querySelector('.rv2d-cutband-stroke').getAttribute('d'));
  near(expInBox.maxX - expInBox.minX, 2 * (14 - R), 0.1, 'Export Paths Inside bit center diameter == 2*(14 - 3)');

  ep.pickOp(freeOp.id);
  eq(bandEl.getAttribute('data-op'), freeOp.id, 'Export Paths Freehand Pocket selected');
  eq(bandEl.style.color, cutBandColor('pocket'), 'Export Paths Freehand Pocket: colour matches pocket passColor');
  ok(bandEl.querySelectorAll('.rv2d-cutband-fill').length >= 1, 'Export Paths Freehand Pocket: light fill of cleared area');
  eq(bandEl.querySelectorAll('.rv2d-cutband-stroke').length, 0, 'Export Paths Freehand Pocket: no stroke passes');
  const expFreeBox = bboxOfPathD([...bandEl.querySelectorAll('.rv2d-cutband-fill')].map((e) => e.getAttribute('d')).join(' '));
  eq([expFreeBox.minX, expFreeBox.maxX, expFreeBox.minY, expFreeBox.maxY].map((v) => Math.round(v * 100) / 100), [freeBox.minX, freeBox.maxX, freeBox.minY, freeBox.maxY].map((v) => Math.round(v * 100) / 100), 'Export Paths Freehand Pocket fill = the Prepare fill (the same cleared area)');

  ep.pickOp(rasterOp.id);
  ok(bandEl.querySelectorAll('.rv2d-cutband-stroke').length >= 2, 'Export Paths Raster Pocket: all programmed passes inside ONE .rv2d-cutband group');
  const rasterEls = previewItems(parseShaperSvg(exp.svg, doc)).filter((it) => it.op === rasterOp.id);
  ok(rasterEls.some((it) => it.cutType === 'guide'), 'the raster pocket has a guide element (its start mark)');
  eq(bandEl.querySelectorAll('.rv2d-cutband-stroke').length, rasterEls.filter((it) => it.cutType !== 'guide').length, 'Export Paths Raster Pocket: one band per cutting element, none for its guide (a guide removes nothing)');

  ep.pickOp(onOp.id);
  eq(bandEl.style.color, cutBandColor('online'), 'Export Paths On-line: colour matches online passColor');
  eq(bandEl.querySelectorAll('.rv2d-cutband-stroke').length, 1, 'Export Paths On-line: stroke width == 2*r');

  ep.pickOp(null);
  eq(bandEl.children.length, 0, 'Export Paths cleared: cut band removed');

  // Simulate dim trail + scrub back
  const simItems = previewItems(parseShaperSvg(exp.svg, doc));
  ok(simItems.filter((it) => it.op && it.cutType !== 'guide').every((it) => it.toolDia === BIT), 'previewItems: toolDia = the shaper:toolDia the file encodes, in mm');
  const tl = buildTimeline({ items: simItems, ops: preview.ops, bitPaths, elements: simEls });
  const viewAt = (t) => {
    const at = stepIndexAt(tl, t);
    const step = at >= 0 && t < tl.total ? tl.steps[at] : null;
    const travelled = step && t > step.t0 ? travelledOf(step, t) : null;
    const states = simItems.map((it, i) => (!it.op || !it.cutType || it.cutType === 'guide' ? null : elementStateAt(tl, i, t) || 'todo'));
    const p = step ? pointOnStep(step, t) : null;
    return {
      states,
      marker: p ? { ...p, r: R } : null,
      trail: step && step.role === 'scribble' ? null : travelled,
      band: {
        key: 'sim-1',
        carved: [],
        run: tl,
        doneSteps: at < 0 ? 0 : (t >= tl.total ? tl.steps.length : (t <= 0 ? 0 : at)),
        active: step && p && t > step.t0 ? { step, pts: travelledOf(step, t) } : null,
      },
    };
  };

  const simMid = ep.setSim(viewAt(tl.total * 0.55));
  ok(simMid.band.groups >= 1 && simMid.band.paths >= 2, `2D Simulate mid-run has dim bit-wide trail (${JSON.stringify(simMid.band)})`);
  const simBandStroke = svgCanvas.querySelector('.rv2d-sim-band .rv2d-sim-band-stroke');
  eq(simBandStroke.getAttribute('stroke-width'), String(BIT), '2D Simulate trail stroke-width == 2*r (6 mm)');
  const midPaths = simMid.band.paths;

  const simEarly = ep.setSim(viewAt(tl.total * 0.05));
  ok(simEarly.band.paths < midPaths, `scrubbing back shrinks trail (${midPaths} -> ${simEarly.band.paths})`);

  const simZero = ep.setSim(viewAt(0));
  eq(simZero.band.paths, 0, 'scrubbing back to 0 removes trail completely');

  // Verify exported SVG byte-identical
  eq(exportFileOf(st).svg, baselineSvg, 'exported SVG is byte-identical');
  console.log(`cut-band-857-node: ${checks} checks ok`);
} finally {
  app.close();
}
