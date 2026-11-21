// tests/vbit-tipwidth-852d-node.test.js — TASK 852d: V-bit tipWidth field, read-time default, validation, record round-trip,
// pocket planning with tipWidth, pocketScallop math, and cut-card notes under the Bit row.
import assert from 'node:assert/strict';
import { open } from './helpers/node-app.js';
import { worldToScreen } from '#ui/coords.js';
import SettingsManager, { createSettingsManager } from '#core/settings-manager.js';
import { parse as parseUnit } from '#core/units.js';
import { pocketScallop } from '#core/cutter-profile.js';
import { CUTTER_SHAPES, exportEncoding } from '../apps/shaper/src/shaper.js';
import { exportShaperSVG } from '#core/shaper-export.js';
import { PARAM_HINTS, hintLabel, hintText } from '../apps/shaper/src/param-hints.js';
import {
  DEFAULT_VBIT_TIP_WIDTH_MM, BIT_RECORD_FIELDS, TOOL_TABLE_KEY,
  validateBit, normalizeBit, loadBits, saveBits, recordFieldsOf, vbitTipWidth,
} from '../apps/shaper/src/tool-table.js';
import { createToolTableWindow } from '../apps/shaper/src/tool-table-window.js';
import { planEntries, keyOf, getPlanRecord, clearingSummary, pocketToolDia } from '../apps/shaper/src/cut-plan.js';
import { storeOps } from '../apps/shaper/src/operations-store.js';
import { describeOperations, toolOf } from '../apps/shaper/src/operations.js';
import { shaperSvgOf } from '../apps/shaper/src/export-payload.js';
import { captureShaperDoc, applyShaperDoc } from '../apps/shaper/src/shaper-doc.js';
import { V2_PLAN } from './helpers/plan-v2.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b} (tol ${tol})`); checks++; };
const memStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const IN = (t) => parseUnit(t, 'in');

SettingsManager.set('DOC_UNIT', 'mm', { persist: false });
SettingsManager.set('LENGTH_PRECISION', null);

// ── 1. Declarations, defaults, validation, read-time default ──
{
  const vbitType = CUTTER_SHAPES.find((s) => s.id === 'vbit');
  ok(vbitType && vbitType.fields.includes('tipWidth'), 'CUTTER_SHAPES vbit declares tipWidth');
  ok(BIT_RECORD_FIELDS.includes('tipWidth'), 'BIT_RECORD_FIELDS includes tipWidth');
  eq(DEFAULT_VBIT_TIP_WIDTH_MM, 0.508, 'default V-bit tipWidth is 0.508 mm (0.02 in)');
  ok(PARAM_HINTS.ttTipWidth && hintLabel('ttTipWidth') === 'Tip width', 'param-hints has ttTipWidth');
  ok(PARAM_HINTS.vbitPocketNote && PARAM_HINTS.pocketScallopNote, 'param-hints has both pocket note entries');

  const good = { id: 'vb1', name: '1/4 90 V-bit', type: 'vbit', unit: 'in', diameter: IN('1/4'), angle: 90, tipWidth: IN('0.02') };
  eq(validateBit(good), [], 'valid V-bit with tipWidth');
  eq(validateBit({ ...good, tipWidth: null }), ['The tip width must be more than 0.'], 'null tipWidth rejected');
  eq(validateBit({ ...good, tipWidth: 0 }), ['The tip width must be more than 0.'], 'zero tipWidth rejected');
  eq(validateBit({ ...good, tipWidth: -0.5 }), ['The tip width must be more than 0.'], 'negative tipWidth rejected');
  eq(validateBit({ ...good, tipWidth: IN('1/4') }), ['The tip width must be smaller than the diameter.'], 'tipWidth == diameter rejected (not clamped)');
  eq(validateBit({ ...good, tipWidth: IN('1/2') }), ['The tip width must be smaller than the diameter.'], 'tipWidth > diameter rejected (not clamped)');

  // Read-time default for a stored V-bit without tipWidth; stored JSON stays byte-identical
  const storage = memStorage();
  const rawStored = JSON.stringify({ [TOOL_TABLE_KEY]: { v: 1, bits: [{ id: 'vb-old', name: 'Old 60 V-bit', type: 'vbit', unit: 'in', diameter: IN('1/4'), angle: 60 }] } });
  storage.setItem('sketch-studio-settings', rawStored);
  const mgr = createSettingsManager({ storage });
  const loaded = loadBits(mgr);
  eq(loaded.length, 1, 'stored V-bit without tipWidth loads');
  eq(loaded[0].tipWidth, 0.508, 'read-time default 0.508 mm applied');
  eq(storage.getItem('sketch-studio-settings'), rawStored, 'stored table stays byte-identical on read (no migration)');
  console.log('1 field & validation: ok');
}

// ── 2. pocketScallop pure math in cutter-profile.js ──
{
  const R = 3.175, D = 6.35, s = 2.54;
  const bn = pocketScallop('ballnose', D, s);
  near(bn.flatWidth, 0, 1e-12, 'ballnose flatWidth is 0');
  near(bn.scallopHeight, R - Math.sqrt(R * R - (s / 2) ** 2), 1e-12, 'ballnose scallop = R - sqrt(R^2 - (s/2)^2)');

  const c = 1.5; // bowl: D=6.35, c=1.5 -> flatWidth = 3.35 mm
  const bowlOverlap = pocketScallop('bowl', D, 2.54, { cornerRadius: c });
  near(bowlOverlap.flatWidth, D - 2 * c, 1e-12, 'bowl flatWidth = diameter - 2 * cornerRadius');
  eq(bowlOverlap.scallopHeight, 0, 'bowl scallop is 0 when stepover <= flatWidth');

  const sWide = 5.0; // > 3.35 -> delta = (5.0 - 3.35)/2 = 0.825
  const bowlWide = pocketScallop('bowl', D, sWide, { cornerRadius: c });
  near(bowlWide.flatWidth, D - 2 * c, 1e-12, 'bowl flatWidth unchanged at wider stepover');
  near(bowlWide.scallopHeight, c - Math.sqrt(c * c - ((sWide - (D - 2 * c)) / 2) ** 2), 1e-12, 'bowl scallop from corners');

  // bowl with cornerRadius == D/2 equals ballnose
  const bowlBall = pocketScallop('bowl', D, s, { cornerRadius: R });
  near(bowlBall.flatWidth, bn.flatWidth, 1e-12, 'bowl with c=D/2 has flatWidth 0');
  near(bowlBall.scallopHeight, bn.scallopHeight, 1e-12, 'bowl with c=D/2 matches ballnose scallop');

  eq(pocketScallop('endmill', D, s), null, 'endmill returns null');
  eq(pocketScallop('vbit', D, s), null, 'vbit returns null');
  eq(pocketScallop('bowl', D, s, {}), null, 'bowl without cornerRadius returns null');
  console.log('2 pocketScallop: ok');
}

// ── 3. Record, save/load, pocket planning, exports, and card notes ──
const VBIT = { id: 'vb-quarter', name: '1/4 90 V-bit', type: 'vbit', unit: 'in', diameter: IN('1/4'), angle: 90, tipWidth: IN('0.02') };
const VBIT_FINE = { id: 'vb-fine', name: '1/4 60 fine', type: 'vbit', unit: 'mm', diameter: 6.35, angle: 60, tipWidth: 0.25 };
const BALL = { id: 'bn-quarter', name: '1/4 ball nose', type: 'ballnose', unit: 'in', diameter: IN('1/4') };
const BOWL = { id: 'bw-half', name: '1/2 bowl', type: 'bowl', unit: 'in', diameter: IN('1/2'), cornerRadius: IN('3/16') };
const ENDMILL = { id: 'em-quarter', name: '1/4 end mill', type: 'endmill', unit: 'in', diameter: IN('1/4') };

eq(recordFieldsOf(VBIT).tipWidth, 0.508, 'recordFieldsOf(vbit) carries tipWidth');
eq(recordFieldsOf(ENDMILL).tipWidth, undefined, 'recordFieldsOf(endmill) clears tipWidth');

const app = await open({ host: 'shaper' });
try {
  // New V-bit in My bits window defaults to 0.02 in / 0.508 mm
  {
    const winMgr = createSettingsManager({ storage: memStorage() });
    SettingsManager.set('DOC_UNIT', 'in', { persist: false });
    const tt = createToolTableWindow({ doc: app.document, settings: winMgr });
    tt.dialog.querySelector('.tt-add').click();
    tt.dialog.querySelector('.tt-template[data-type="vbit"]').click();
    eq(tt.dialog.querySelector('#tt-tipWidth').value, '0.02', 'new V-bit in inch mode defaults tipWidth input to 0.02');
    tt.dialog.querySelector('.tt-unit-btn[data-unit="mm"]').click();
    eq(tt.dialog.querySelector('#tt-tipWidth').value, '0.508', 'switching unit shows 0.508 mm');
    tt.dialog.remove();
    SettingsManager.set('DOC_UNIT', 'mm', { persist: false });
  }
  const st = app.state, doc = app.document, q = (s) => doc.querySelector(s);
  saveBits([VBIT, VBIT_FINE, BALL, BOWL, ENDMILL]);
  // 60 x 60 mm square + 40 x 30 mm square + open line
  const addRect = (p, x0, y0, w, h) => {
    [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]].forEach(([x, y], i) => st.joints.set(`${p}j${i}`, { x, y, sketchId: 'sketch-1' }));
    for (let i = 0; i < 4; i++) st.shapes.push({ id: `${p}s${i}`, type: 'line', joints: [`${p}j${i}`, `${p}j${(i + 1) % 4}`], sketchId: 'sketch-1' });
  };
  addRect('A', 0, 0, 60, 60);
  addRect('B', 80, 0, 40, 30);
  st.joints.set('Lj0', { x: 0, y: 80, sketchId: 'sketch-1' });
  st.joints.set('Lj1', { x: 60, y: 80, sketchId: 'sketch-1' });
  st.shapes.push({ id: 'Ls0', type: 'line', joints: ['Lj0', 'Lj1'], sketchId: 'sketch-1' });

  app.modes.showMode('prepare');
  const pc = doc.getElementById('prepare-canvas');
  const pressEl = (s) => { const e = q(s); assert.ok(e, s + ' not found'); app.press(e); };
  const typed = (cls, v) => { const i = q(cls); i.value = v; i.dispatchEvent(new app.window.Event('change')); };

  // Check isPocketType & pocketToolDia across all cut kinds
  eq(pocketToolDia({ cutType: 'pocket', cutterShape: 'vbit', toolDia: 6.35, tipWidth: 0.508 }), 0.508, 'pocket V-bit plans with tipWidth');
  eq(pocketToolDia({ cutType: 'roughing', cutterShape: 'vbit', toolDia: 6.35, tipWidth: 0.508 }), 0.508, 'roughing (pocket slope/default) V-bit plans with tipWidth');
  eq(pocketToolDia({ cutType: 'roughing', slope: { kind: 'outside', depth: 3, angle: 45 }, cutterShape: 'vbit', toolDia: 6.35, tipWidth: 0.508 }), 6.35, 'roughing outside-wall keeps full diameter');
  eq(pocketToolDia({ cutType: 'exterior', cutterShape: 'vbit', toolDia: 6.35, tipWidth: 0.508 }), 6.35, 'exterior V-bit keeps full diameter');
  eq(pocketToolDia({ cutType: 'interior', cutterShape: 'vbit', toolDia: 6.35, tipWidth: 0.508 }), 6.35, 'interior V-bit keeps full diameter');
  eq(pocketToolDia({ cutType: 'online', cutterShape: 'vbit', toolDia: 6.35, tipWidth: 0.508 }), 6.35, 'online V-bit keeps full diameter');
  eq(pocketToolDia({ cutType: 'contour', cutterShape: 'vbit', toolDia: 6.35, tipWidth: 0.508 }), 6.35, 'contour V-bit keeps full diameter');

  // Select 60x60 rect -> Pocket
  const pA = worldToScreen(pc, { x: 0, y: 30 });
  app.click(Math.round(pA.x), Math.round(pA.y), { target: pc });
  pressEl('#op-type-pocket');
  typed('.cut-depth', '3');
  pressEl('.cut-clear-trigger');
  pressEl('.cut-clear-opt[data-clearing="linked"]');
  pressEl('.cut-bit-trigger');
  pressEl('.cut-bit-opt[data-bit="vb-quarter"]');
  app.prepare.ok();

  // Check op record, tool name, clearing plan, export, and save/load
  const op = storeOps()[0];
  eq(op.settings.tipWidth, 0.508, 'operation copy carries tipWidth');
  eq(toolOf({ cutType: op.type, ...op.settings }).label, '1/4 90 V-bit', 'tool name uses My bits name');
  eq(toolOf({ cutType: 'pocket', toolDia: 6.35, cutterShape: 'vbit', cutterAngle: 90, tipWidth: 0.508 }).label, '¼″ 90° V-bit', 'Custom V-bit tool name keeps 1/4 in diameter');

  const keyA = keyOf('loop', op.geometry[0].key.slice(5));
  const sum = clearingSummary(op.geometry[0].key, { cutType: op.type, ...op.settings }, st);
  ok(sum && !sum.refused, 'V-bit Spiral pocket planned');
  near(sum.settings.toolDia, 0.508, 1e-9, 'clearing plans with toolDia = tipWidth (0.508 mm)');
  near(sum.settings.stepover, 0.2032, 1e-9, 'stepover = 40% of 0.508 = 0.2032 mm');
  eq(sum.loops, 144, '60x60 1/4 in V-bit Spiral pocket has 144 passes');

  const svgVbitPocket = shaperSvgOf(st, planEntries());
  ok(/shaper:toolDia="0\.508 mm"/.test(svgVbitPocket), 'exported V-bit pocket writes shaper:toolDia="0.508 mm"');

  // Reopen op -> card note under Bit row and stepover length
  app.prepare.edit(op.id);
  eq(q('.cut-stepover-len').textContent, '= 0.203 mm', 'stepover length matches tipWidth stepover');
  const bitNote = q('.cut-row[data-row="bit"] .cut-bit-note');
  ok(bitNote && !bitNote.hidden, 'V-bit pocket bit note is visible');
  eq(bitNote.textContent, 'V-bit pocket: 144 passes per depth with a 0.508 mm tip', 'exact V-bit pocket note');

  // Switch to ball-nose -> scallop note
  pressEl('.cut-bit-trigger');
  pressEl('.cut-bit-opt[data-bit="bn-quarter"]');
  ok(!bitNote.hidden, 'ball-nose pocket bit note is visible');
  ok(/Flat width 0 mm per pass; scallop 0\.265 mm between passes/.test(bitNote.textContent), 'ball-nose scallop note: ' + bitNote.textContent);

  // Switch to bowl bit -> flat width + scallop note
  pressEl('.cut-bit-trigger');
  pressEl('.cut-bit-opt[data-bit="bw-half"]');
  ok(!bitNote.hidden, 'bowl bit pocket bit note is visible');
  ok(/Flat width 3\.175 mm per pass; scallop 0\.096 mm between passes/.test(bitNote.textContent), 'bowl scallop note: ' + bitNote.textContent);

  // Switch to end mill -> no note
  pressEl('.cut-bit-trigger');
  pressEl('.cut-bit-opt[data-bit="em-quarter"]');
  ok(bitNote.hidden && bitNote.textContent === '', 'end mill has no bit note');

  // Back to fine V-bit and save/load round-trip
  pressEl('.cut-bit-trigger');
  pressEl('.cut-bit-opt[data-bit="vb-fine"]');
  app.prepare.ok();
  const savedDoc = JSON.parse(JSON.stringify(captureShaperDoc()));
  eq(savedDoc.operations[0].settings.tipWidth, 0.25, 'saved document carries tipWidth 0.25');
  applyShaperDoc(savedDoc, st);
  eq(storeOps()[0].settings.tipWidth, 0.25, 'reloaded document preserves tipWidth 0.25');

  // Old document without tipWidth reads 0.508 mm
  const oldDoc = JSON.parse(JSON.stringify(savedDoc));
  delete oldDoc.operations[0].settings.tipWidth;
  oldDoc.operations[0].settings.bitId = undefined;
  oldDoc.operations[0].settings.bitName = undefined;
  applyShaperDoc(oldDoc, st);
  eq(getPlanRecord(storeOps()[0].geometry[0].key).tipWidth, 0.508, 'old document without tipWidth reads 0.508 mm');
  ok(/shaper:toolDia="0\.508 mm"/.test(shaperSvgOf(st, planEntries())), 'old V-bit pocket exports with 0.508 mm tip');

  // Outside / Inside / On-line cuts with V-bit are byte-identical to pre-852d (toolDia = diameter, not tipWidth)
  const pB = worldToScreen(pc, { x: 80, y: 15 });
  app.click(Math.round(pB.x), Math.round(pB.y), { target: pc });
  pressEl('#op-type-exterior');
  typed('.cut-depth', '3');
  pressEl('.cut-bit-trigger');
  pressEl('.cut-bit-opt[data-bit="vb-quarter"]');
  ok(q('.cut-row[data-row="bit"] .cut-bit-note').hidden, 'Outside V-bit cut has no pocket bit note');
  app.prepare.ok();
  const extEntry = planEntries().find((e) => e.rec.cutType === 'exterior');
  eq(extEntry.rec.toolDia, 6.35, 'Outside V-bit keeps 6.35 mm toolDia');
  const extRaw = exportShaperSVG({ state: st, entries: [{ target: extEntry.target, rec: { cutType: 'exterior', cutDepth: 3, cutOffset: 0, toolDia: 6.35, cutterShape: 'vbit', cutterAngle: 90 } }], encoding: exportEncoding(), docUnit: 'mm', options: {} });
  eq(shaperSvgOf(st, [extEntry]), extRaw, 'Outside V-bit export is byte-identical');
  // Inside V-bit byte-identical check
  const intNow = shaperSvgOf(st, [{ target: extEntry.target, rec: { ...extEntry.rec, cutType: 'interior' } }]);
  const intRaw = exportShaperSVG({ state: st, entries: [{ target: extEntry.target, rec: { cutType: 'interior', cutDepth: 3, cutOffset: 0, toolDia: 6.35, cutterShape: 'vbit', cutterAngle: 90 } }], encoding: exportEncoding(), docUnit: 'mm', options: {} });
  eq(intNow, intRaw, 'Inside V-bit export is byte-identical');
  // On-line V-bit byte-identical check (on open chain Ls0)
  const pL = worldToScreen(pc, { x: 30, y: 80 });
  app.click(Math.round(pL.x), Math.round(pL.y), { target: pc });
  pressEl('#op-type-online');
  typed('.cut-depth', '3');
  pressEl('.cut-bit-trigger');
  pressEl('.cut-bit-opt[data-bit="vb-quarter"]');
  app.prepare.ok();
  const onEntry = planEntries().find((e) => e.rec.cutType === 'online');
  eq(onEntry.rec.toolDia, 6.35, 'On-line V-bit keeps 6.35 mm toolDia');
  const onRaw = exportShaperSVG({ state: st, entries: [{ target: onEntry.target, rec: { cutType: 'online', cutDepth: 3, cutOffset: 0, toolDia: 6.35, cutterShape: 'vbit', cutterAngle: 90 } }], encoding: exportEncoding(), docUnit: 'mm', options: {} });
  eq(shaperSvgOf(st, [onEntry]), onRaw, 'On-line V-bit export is byte-identical');

  // Non-V-bit pocket export is byte-identical
  const pocketOp = storeOps().find((o) => o.type === 'pocket');
  app.prepare.edit(pocketOp.id);
  pressEl('.cut-bit-trigger');
  pressEl('.cut-bit-opt[data-bit="em-quarter"]');
  app.prepare.ok();
  const emEntry = planEntries().find((e) => e.rec.cutType === 'pocket');
  const emRaw = exportShaperSVG({ state: st, entries: [{ target: emEntry.target, rec: { ...emEntry.rec, tipWidth: undefined, bitId: undefined, bitName: undefined } }], encoding: exportEncoding(), docUnit: 'mm', options: {} });
  eq(shaperSvgOf(st, [emEntry]), emRaw, 'End mill pocket export is byte-identical');

  // Raster 40x30 V-bit pocket pass count (~140)
  const opB = storeOps().find((o) => o.type === 'exterior');
  app.prepare.edit(opB.id);
  pressEl('.cut-type-trigger');
  pressEl('.cut-type-opt[data-id="pocket"]');
  pressEl('.cut-clear-trigger');
  pressEl('.cut-clear-opt[data-clearing="raster"]');
  app.prepare.ok();
  const opBRaster = storeOps().find((o) => o.id === opB.id);
  const sumRaster = clearingSummary(opBRaster.geometry[0].key, { cutType: 'pocket', ...opBRaster.settings }, st);
  eq(sumRaster.passes, 140, '40x30 1/4 in V-bit Raster pocket has 140 passes');
  app.prepare.edit(opB.id);
  eq(q('.cut-row[data-row="bit"] .cut-bit-note').textContent, 'V-bit pocket: 140 passes per depth with a 0.508 mm tip', 'Raster V-bit pocket note shows 140 passes');
  app.prepare.cancel();

  console.log('3 record, planning, exports, notes: ok');
} finally {
  SettingsManager.set(TOOL_TABLE_KEY, null, { persist: 'local' });
  await app.close?.();
}
console.log(`vbit-tipwidth-852d-node: ${checks} checks pass`);
