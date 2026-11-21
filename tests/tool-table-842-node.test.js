// tests/tool-table-842-node.test.js — TASK 842 (owner turns 3079-3081 + "Mm or inches right?"): Shaper's TOOL TABLE (apps/shaper/src/tool-table.js) and the TAPERED
// bits (#core/cutter-profile.js).
//  1. the bit model's ONE validation: its plain refusal lines; only the fields of its type are kept.
//  2. units: a bit keeps the unit it was entered in; fractions shown as fractions, the other unit in brackets; stored in base mm EXACTLY (no drift on round trips).
//  3. the tapered profiles: the cutter's height at radius r for both tapered types (ball / flat tip), the shank cap, the groove's widest half-width.
//  4. the table persists across a reload (the settings store), first use = the declared defaults (the exact list).
//  5. an operation that picks a bit: the card's Bit row, the record's copy, the operation's name and its tool change say the bit's NAME, the Bit diameter / Cutter
//     shape rows greyed; deeper than its cutting length = one plain note line; the bit DELETED from the table = the design exports the same (also saved + reloaded);
//     a tapered bit writes its TIP diameter as shaper:toolDia.
//  6. Roughing and Contour levels with a tapered ball nose on a fixture relief (the boss-on-a-plate STL of tests/helpers/stl-mesh.js): the 3D Review's grooves follow
//     the tapered profile (the one profile function), the paths and the file use the tip.
import assert from 'node:assert/strict';
import { open } from './helpers/node-app.js';
import * as M from './helpers/stl-mesh.js';
import { worldToScreen } from '#ui/coords.js';
import SettingsManager, { createSettingsManager } from '#core/settings-manager.js';
import { parse as parseUnit } from '#core/units.js';
import { cutterHeightAt, cutterProfile, cutterTerraces, SHAPE_SLICES, isShapedCutter } from '#core/cutter-profile.js';
import { buildRelief } from '#core/relief-model.js';
import { findLoops } from '#core/loop-finder.js';
import { DEFAULT_BITS, validateBit, normalizeBit, loadBits, saveBits, bitLengthText, bitSizeText, parseBitLength, recordFieldsOf, cutLengthNote, TOOL_TABLE_KEY, duplicateBit } from '../apps/shaper/src/tool-table.js';
import { planEntries, planReliefItems, keyOf } from '../apps/shaper/src/cut-plan.js';
import { storeOps } from '../apps/shaper/src/operations-store.js';
import { describeOperations, toolOf } from '../apps/shaper/src/operations.js';
import { shaperSvgOf } from '../apps/shaper/src/export-payload.js';
import { captureShaperDoc, applyShaperDoc } from '../apps/shaper/src/shaper-doc.js';
import { V2_PLAN, addContourV2 } from './helpers/plan-v2.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b} (tol ${tol})`); checks++; };
SettingsManager.set('DOC_UNIT', 'mm', { persist: false });
SettingsManager.set('LENGTH_PRECISION', null);
const memStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const IN = (t) => parseUnit(t, 'in');

// ── 1. the bit model's validation ──
{
  const good = { id: 'b1', name: '1/8 upcut', type: 'endmill', unit: 'in', diameter: IN('1/8') };
  eq(validateBit(good), [], 'a valid end mill: no refusal');
  eq(validateBit({ ...good, name: '  ' }), ['Give the bit a name.'], 'no name');
  eq(validateBit({ ...good, diameter: 0 }), ['The diameter must be more than 0.'], 'a zero diameter');
  eq(validateBit({ ...good, type: 'drill' }), ['Pick the bit’s type.'], 'an unknown type');
  eq(validateBit({ ...good, id: 'b2' }, [good]), ['Another bit is already named “1/8 upcut”.'], 'a name used twice in the table');
  eq(validateBit({ id: 'v', name: 'V', type: 'vbit', unit: 'mm', diameter: 6, angle: 180 }), ['The V-bit’s angle must be between 0° and 180°.'], 'a V-bit angle out of range');
  eq(validateBit({ id: 't', name: 'T', type: 'taperball', unit: 'mm', tipDiameter: 1, taperAngle: 3.5, shankDiameter: 1 }), ['The shank must be wider than the tip.'], 'a tapered shank no wider than its tip');
  eq(validateBit({ id: 't', name: 'T', type: 'taperflat', unit: 'mm', tipDiameter: 1, taperAngle: 0, shankDiameter: 6 }), ['The taper angle (per side) must be between 0° and 90°.'], 'a zero taper');
  eq(validateBit({ ...good, cutLength: -1 }), ['The cutting length must be more than 0 (or empty).'], 'a negative cutting length');
  eq(validateBit({ id: 'x', name: '', type: 'taperball', unit: 'mm' }).length, 4, 'every problem is its own line (name, tip, taper, shank)');
  eq(Object.keys(normalizeBit({ ...good, angle: 60, tipDiameter: 1, junk: 1 })).sort(), ['diameter', 'id', 'name', 'type', 'unit'], 'only the fields of its type are kept');
  eq(Object.keys(normalizeBit({ id: 't', name: 'T', type: 'taperball', unit: 'mm', tipDiameter: 1, taperAngle: 3.5, shankDiameter: 6.35, diameter: 9, notes: 'a note', cutLength: 25 })).sort(), ['cutLength', 'id', 'name', 'notes', 'shankDiameter', 'taperAngle', 'tipDiameter', 'type', 'unit'], 'a tapered bit: tip, taper, shank (+ cutting length, notes)');
  console.log('1 validation: ok');
}

// ── 2. units: the bit's own unit, exact ──
{
  eq(IN('1/4'), 6.35, '1/4 in is 6.35 mm exactly');
  eq([bitLengthText(IN('1/4'), 'in'), bitLengthText(IN('3/8'), 'in'), bitLengthText(IN('1 1/2'), 'in'), bitLengthText(IN('0.125'), 'in'), bitLengthText(IN('.02'), 'in'), bitLengthText(6, 'mm')], ['1/4', '3/8', '1 1/2', '1/8', '0.02', '6'], 'an inch size that is an exact 64th shows as its fraction (typed 0.125 too), others as decimals; a mm size in mm');
  eq([bitSizeText(IN('1/4'), 'in'), bitSizeText(6, 'mm')], ['1/4 in (6.35 mm)', '6 mm (0.236 in)'], 'the other unit in brackets');
  SettingsManager.set('DOC_UNIT', 'in', { persist: false });
  eq([bitSizeText(6, 'mm'), bitSizeText(IN('1/8'), 'in')], ['6 mm (0.236 in)', '1/8 in (3.175 mm)'], 'whatever the document unit is (an inch document)');
  SettingsManager.set('DOC_UNIT', 'mm', { persist: false });
  for (const [text, unit] of [['1/8', 'in'], ['1/4', 'in'], ['3/8', 'in'], ['1/2', 'in'], ['1 1/2', 'in'], ['0.125', 'in'], ['.02', 'in'], ['0.0625', 'in'], ['6', 'mm'], ['3.175', 'mm'], ['0.5', 'mm'], ['12.7', 'mm']]) {
    const mm = parseBitLength(text, unit), shown = bitLengthText(mm, unit);
    ok(Object.is(parseBitLength(shown, unit), mm), `round trip ${text} ${unit} -> ${mm} mm -> "${shown}" -> the same mm, bit for bit`);
  }
  eq(parseBitLength('6 mm', 'in'), 6, 'a typed unit suffix wins');
  // a bit saved, loaded, saved again (no field touched) keeps its exact values
  const st = createSettingsManager({ storage: memStorage() });
  const mixed = [{ id: 'a', name: 'A', type: 'endmill', unit: 'in', diameter: IN('3/8') }, { id: 'b', name: 'B', type: 'endmill', unit: 'mm', diameter: 6 }];
  saveBits(mixed, st); saveBits(loadBits(st), st); saveBits(loadBits(st), st);
  eq(loadBits(st).map((b) => [b.unit, b.diameter]), [['in', IN('3/8')], ['mm', 6]], 'saved three times: the same units, the same exact mm');
  console.log('2 units: ok');
}

// ── 3. the tapered profiles ──
{
  const taper = { taperAngle: 3.5, shankDia: 6.35 }, a = (3.5 * Math.PI) / 180, t = Math.tan(a);
  // TAPERED END MILL: a flat 1 mm tip, then the cone
  eq(cutterHeightAt('taperflat', 1, 0, taper), 0, 'flat tip: height 0 at the centre');
  eq(cutterHeightAt('taperflat', 1, 0.5, taper), 0, 'flat tip: height 0 at the tip radius');
  near(cutterHeightAt('taperflat', 1, 1.5, taper), 1 / t, 1e-12, 'on the cone: (r - rt) / tan(a)');
  near(cutterHeightAt('taperflat', 1, 3.175, taper), (3.175 - 0.5) / t, 1e-12, 'the cone reaches the shank radius');
  eq(cutterHeightAt('taperflat', 1, 3.2, taper), null, 'past the shank: no cutter (the shank is a straight side)');
  // TAPERED BALL NOSE: a 1 mm ball tip, the cone tangent to it at x_t = rt cos a, h_t = rt (1 - sin a)
  const rt = 0.5, xt = rt * Math.cos(a), ht = rt * (1 - Math.sin(a));
  eq(cutterHeightAt('taperball', 1, 0, taper), 0, 'ball tip: height 0 at the centre');
  near(cutterHeightAt('taperball', 1, 0.3, taper), rt - Math.sqrt(rt * rt - 0.09), 1e-12, 'on the ball: rt - sqrt(rt^2 - r^2)');
  near(cutterHeightAt('taperball', 1, xt, taper), ht, 1e-12, 'the tangent point: rt (1 - sin a)');
  near(cutterHeightAt('taperball', 1, 2, taper), ht + (2 - xt) / t, 1e-12, 'on the cone: h_t + (r - x_t) / tan a');
  { const e = 1e-7, s1 = (cutterHeightAt('taperball', 1, xt, taper) - cutterHeightAt('taperball', 1, xt - e, taper)) / e, s2 = (cutterHeightAt('taperball', 1, xt + e, taper) - cutterHeightAt('taperball', 1, xt, taper)) / e;
    near(s1, s2, 1e-3, 'the cone is TANGENT to the ball (the same slope either side of x_t)'); }
  eq(cutterHeightAt('taperball', 1, 3.2, taper), null, 'past the shank: no cutter');
  ok(cutterHeightAt('taperball', 1, 1, taper) > cutterHeightAt('taperflat', 1, 1, taper), 'a ball tip stands higher than a flat tip at the same radius');
  eq(cutterHeightAt('ballnose', 1, 0.2, taper), null, 'a shape that is not tapered: no taper height');
  // the groove profile: its widest half-width (on the cone, capped by the shank) and its depth across
  near(cutterProfile('taperflat', 1, 90, 5, taper).xMax, 0.5 + 5 * t, 1e-12, 'flat tip 5 deep: as wide as the cone at 5 mm');
  near(cutterProfile('taperball', 1, 90, 0.01, taper).xMax, Math.sqrt(0.25 - 0.49 * 0.49), 1e-12, 'ball tip, 0.01 deep: only on the ball');
  near(cutterProfile('taperball', 1, 90, 5, taper).xMax, xt + (5 - ht) * t, 1e-12, 'ball tip 5 deep: on the cone');
  eq(cutterProfile('taperball', 1, 90, 60, taper).xMax, 3.175, 'deeper than the cone is tall: capped at the shank radius');
  near(cutterProfile('taperball', 1, 90, 5, taper).depthAt(2), 5 - (ht + (2 - xt) / t), 1e-12, 'the depth at 2 mm = the cut depth minus the cutter height there');
  eq(cutterProfile('taperball', 1, 90, 5, { taperAngle: 3.5 }), null, 'no shank: no profile (never guessed)');
  const ter = cutterTerraces('taperball', 1, 90, 5, SHAPE_SLICES.taperball, taper);
  eq([ter.length, ter[0].depth], [SHAPE_SLICES.taperball, 5], 'its terraces: the innermost at the cut depth');
  ok(ter.every((x, i) => i === 0 || (x.depth < ter[i - 1].depth && x.halfWidth > ter[i - 1].halfWidth)), 'wider = shallower');
  ok(isShapedCutter('taperball') && isShapedCutter('taperflat'), 'both tapered shapes make terraced grooves');
  console.log('3 tapered profiles: ok');
}

// ── 4. the stored table: defaults on first use, persists across a reload ──
{
  eq(DEFAULT_BITS.map((b) => [b.name, b.type, b.unit, b.diameter ?? null, b.angle ?? null, b.tipDiameter ?? null, b.taperAngle ?? null, b.shankDiameter ?? null]), [
    ['1/16 in end mill', 'endmill', 'in', IN('1/16'), null, null, null, null],
    ['1/8 in end mill', 'endmill', 'in', 3.175, null, null, null, null],
    ['1/4 in end mill', 'endmill', 'in', 6.35, null, null, null, null],
    ['3/8 in end mill', 'endmill', 'in', IN('3/8'), null, null, null, null],
    ['1/2 in end mill', 'endmill', 'in', 12.7, null, null, null, null],
  ], 'the first-use bits (TASK 852: the five inch end mills, the exact list)');
  ok(DEFAULT_BITS.every((b, i) => validateBit(b, DEFAULT_BITS.slice(0, i)).length === 0), 'every default bit is valid');
  const storage = memStorage();
  const s1 = createSettingsManager({ storage });
  eq(loadBits(s1).map((b) => b.id), DEFAULT_BITS.map((b) => b.id), 'nothing stored: the defaults');
  eq(s1.get(TOOL_TABLE_KEY), null, 'reading the table writes nothing');
  const mine = [...loadBits(s1).filter((b) => b.id !== 'em-1-4in'), { id: 'bit-9', name: '1/8 upcut', type: 'endmill', unit: 'in', diameter: IN('1/8'), cutLength: IN('1/2'), notes: 'Amana 46170' }];
  saveBits(mine, s1);
  const s2 = createSettingsManager({ storage }); // the page reloaded (the same browser storage)
  eq(loadBits(s2), mine.map(normalizeBit), 'the table after a reload: the same bits, the same exact values (1/4 in deleted, 1/8 upcut added)');
  eq(saveBits([], s2).length, 0, 'every bit deleted');
  eq(loadBits(createSettingsManager({ storage })), [], 'an empty table stays empty (the defaults are for first use only)');
  assert.throws(() => saveBits([{ id: 'z', name: '', type: 'endmill', unit: 'mm', diameter: 1 }], s2), /invalid bit/, 'an invalid bit is never saved'); checks++;
  eq(duplicateBit(mine[0], mine).name, '1/16 in end mill copy', 'Duplicate: a new name');
  console.log('4 persistence: ok');
}

// ── 5 + 6: the app ──
const UPCUT = { id: 'bit-up', name: '1/8 upcut', type: 'endmill', unit: 'in', diameter: IN('1/8'), cutLength: IN('1/2') };
const TBN = { id: 'bit-tbn', name: 'TBN 1mm', type: 'taperball', unit: 'mm', tipDiameter: 1, taperAngle: 3.5, shankDiameter: IN('1/4') };
{
  // the record a bit sets (pure)
  eq(recordFieldsOf(UPCUT), { bitId: 'bit-up', bitName: '1/8 upcut', cutterShape: 'endmill', toolDia: 3.175, cornerRadius: undefined, taperAngle: undefined, shankDia: undefined, cutLength: 12.7 }, 'an end mill: its name, shape, diameter, cutting length (no cone)');
  eq(recordFieldsOf(TBN), { bitId: 'bit-tbn', bitName: 'TBN 1mm', cutterShape: 'taperball', toolDia: 1, cornerRadius: undefined, taperAngle: 3.5, shankDia: 6.35, cutLength: undefined }, 'a tapered bit: toolDia = its TIP, its cone');
  eq(toolOf({ cutType: 'pocket', ...recordFieldsOf(UPCUT) }).label, '1/8 upcut', 'the tool is named by the bit');
  eq(toolOf({ cutType: 'pocket', toolDia: 3.175, cutterShape: 'endmill' }).label, '⅛″ end mill', 'a Custom bit: named as before');
  ok(toolOf({ cutType: 'pocket', ...recordFieldsOf(UPCUT) }).key !== toolOf({ cutType: 'pocket', toolDia: 3.175, cutterShape: 'endmill' }).key, 'two bits of one size, one named: two tools');
  eq(toolOf({ cutType: 'pocket', toolDia: 1, cutterShape: 'taperball', taperAngle: 3.5, shankDia: 6.35 }).label, '1 mm 3.5° tapered ball nose', 'a tapered bit without a name: its tip and taper');
  eq(cutLengthNote({ cutLength: 12.7, bitName: '1/8 upcut' }, 20, 'mm'), 'This cut goes 20 mm deep, deeper than the 12.7 mm cutting length of 1/8 upcut.', 'the note line');
  eq([cutLengthNote({ cutLength: 12.7 }, 12.7, 'mm'), cutLengthNote({}, 50, 'mm')], [null, null], 'no note at the cutting length, nor without one');
}

const app = await open({ host: 'shaper' });
try {
  const st = app.state, doc = app.document, q = (s) => doc.querySelector(s), qa = (s) => [...doc.querySelectorAll(s)];
  saveBits([...DEFAULT_BITS, UPCUT, TBN]); // the user's table (the page's settings store)
  [[0, 0], [40, 0], [40, 30], [0, 30]].forEach(([x, y], i) => st.joints.set(`Aj${i}`, { x, y, sketchId: 'sketch-1' }));
  for (let i = 0; i < 4; i++) st.shapes.push({ id: `As${i}`, type: 'line', joints: [`Aj${i}`, `Aj${(i + 1) % 4}`], sketchId: 'sketch-1' });
  const K = keyOf('loop', findLoops(st)[0].id);
  app.modes.showMode('prepare');
  const pc = doc.getElementById('prepare-canvas');
  const p = worldToScreen(pc, { x: 0, y: 15 }); app.click(Math.round(p.x), Math.round(p.y), { target: pc });
  const pressEl = (s) => { const e = q(s); assert.ok(e, s + ' not found'); app.press(e); };
  const typed = (cls, v) => { const i = q(cls); i.value = v; i.dispatchEvent(new app.window.Event('change')); };
  const rowState = (name) => { const r = q(`.cut-row[data-row="${name}"], .cut-row[data-param="${name}"]`); return r.style.display === 'none' ? 'none' : 'off' in r.dataset ? 'greyed' : 'live'; };
  const exportOf = () => shaperSvgOf(st, planEntries());
  const toolDiaAttrs = (svg) => [...svg.matchAll(/shaper:toolDia="([^"]+)"/g)].map((m) => m[1]);
  pressEl('#op-type-pocket'); // TASK S3: the toolbar's Pocket: a new Pocket of the selected shape, open
  typed('.cut-depth', '20');
  eq([q('.cut-bit-cur').textContent, rowState('bit'), rowState('toolDia'), rowState('cutterShape')], ['Custom', 'live', 'live', 'live'], 'a new operation: Custom (today\'s typed bit), its rows live');
  const before = exportOf();
  pressEl('.cut-bit-trigger');
  eq(qa('.cut-bit-opt').map((o) => o.querySelector('.cut-opt-name').textContent), [...DEFAULT_BITS.map((b) => b.name), '1/8 upcut', 'TBN 1mm'], 'the Bit menu: every bit of the table');
  eq(q('.cut-bit-opt[data-bit="bit-up"] .cut-bit-size').textContent, '1/8 in (3.175 mm)', 'each with its size in its own unit');
  ok(q('.cut-bit-custom.is-current') && q('.cut-bit-edit'), 'then Custom (current) and Edit my bits...');
  pressEl('.cut-bit-opt[data-bit="bit-up"]');
  const opRec = () => storeOps().find((o) => o.type === 'pocket').settings;
  eq([opRec().bitId, opRec().bitName, opRec().toolDia, opRec().cutterShape, opRec().cutLength], ['bit-up', '1/8 upcut', 3.175, 'endmill', 12.7], 'picked: the operation holds the bit\'s copy');
  eq([q('.cut-bit-cur').textContent, rowState('toolDia'), rowState('cutterShape')], ['1/8 upcut', 'greyed', 'greyed'], 'the Bit row names it; Bit diameter and Cutter shape greyed in place');
  ok(qa('.cut-note div').map((d) => d.textContent).includes('This cut goes 20 mm deep, deeper than the 12.7 mm cutting length of 1/8 upcut.'), 'deeper than its cutting length: the one note line');
  app.prepare.ok();
  const ops = describeOperations(st, planEntries());
  eq([ops[0].heading, ops[0].tool.label], ['Change to 1/8 upcut', '1/8 upcut'], 'the tool change and the operation say the bit\'s NAME');
  ok(app.prepare.opList.inspect().items.some((i) => i.heading === 'Change to 1/8 upcut'), 'the Operations list shows it');
  const withBit = exportOf();
  eq(withBit, before, 'the same 1/8 in bit: the file is the same as the Custom 1/8 in end mill');
  // the bit DELETED from the table: the design cuts the same
  saveBits([...DEFAULT_BITS, TBN]);
  eq(exportOf(), withBit, 'the bit deleted from the table: the design exports the same');
  app.prepare.edit(storeOps()[0].id);
  eq(q('.cut-bit-cur').textContent, '1/8 upcut (not in My bits)', 'its card still names the copy');
  app.prepare.cancel();
  const saved = JSON.parse(JSON.stringify(captureShaperDoc()));
  applyShaperDoc(saved, st);
  eq([exportOf(), storeOps()[0].settings.bitName], [withBit, '1/8 upcut'], 'saved and reloaded without the bit in the table: the same file, the same copy');
  // a TAPERED bit: its tip diameter goes to the file
  app.prepare.edit(storeOps()[0].id);
  pressEl('.cut-bit-trigger'); pressEl('.cut-bit-opt[data-bit="bit-tbn"]');
  eq([opRec().toolDia, opRec().cutterShape, opRec().taperAngle, opRec().shankDia, 'cutLength' in opRec()], [1, 'taperball', 3.5, 6.35, false], 'a tapered bit: its tip, its cone (the upcut\'s cutting length gone)');
  eq(q('.cut-shape-cur').textContent, 'tapered ball nose 3.5°', 'the Cutter shape row shows it');
  ok(!qa('.cut-note div').some((d) => /cutting length/.test(d.textContent)), 'no cutting length: no note');
  app.prepare.ok();
  eq([...new Set(toolDiaAttrs(exportOf()))], ['1.000 mm'], 'shaper:toolDia = the TIP diameter');
  eq(describeOperations(st, planEntries())[0].heading, 'Change to TBN 1mm', 'its tool change');
  // Custom again: the name unlinked, the cutter kept; a custom shape drops the cone
  app.prepare.edit(storeOps()[0].id);
  pressEl('.cut-bit-trigger'); pressEl('.cut-bit-custom');
  eq(['bitId' in opRec(), 'bitName' in opRec(), opRec().cutterShape, opRec().toolDia, rowState('toolDia')], [false, false, 'taperball', 1, 'live'], 'Custom: the link gone, the cutter as it was, the rows live');
  pressEl('.cut-shape-trigger');
  eq(qa('.cut-shape-pop .cut-type-opt').map((o) => o.dataset.shape), ['endmill', 'ballnose', 'vbit'], 'the Custom shapes (a tapered bit comes from the table)');
  pressEl('.cut-shape-pop .cut-type-opt[data-shape="ballnose"]');
  eq([opRec().cutterShape, 'taperAngle' in opRec(), 'shankDia' in opRec()], ['ballnose', false, false], 'a Custom shape drops the cone');
  app.prepare.cancel();
  console.log('5 the card: ok');

  // ── 6. Roughing and Contour levels with a tapered ball nose on a fixture relief ──
  const bossPlate = () => M.lofted({ outer: [{ z: 10, pts: M.rect(20, 10, 40, 30) }, { z: 6, pts: M.rect(20, 10, 40, 30) }, { z: 6, pts: M.rect(0, 0, 60, 40) }, { z: 0, pts: M.rect(0, 0, 60, 40) }] });
  V2_PLAN.use(st);
  app.stl.openFile(M.binaryStl(bossPlate()), 'boss.stl');
  const [pk, prec] = [...V2_PLAN.entries()].find(([, r]) => r.levels);
  ok(prec.cutType === 'roughing', 'the relief opens as one Roughing');
  V2_PLAN.set(pk, { ...prec, stepDepth: 1, ...recordFieldsOf(TBN) });
  const items = planReliefItems(st);
  ok(items.length > 0 && items.every((it) => it.shape.cutterShape === 'taperball' && it.shape.taperAngle === 3.5 && it.shape.shankDia === 6.35 && it.shape.toolDia === 1), 'every Roughing item carries the tapered cone to the 3D Review');
  const stock = { thickness: 12 };
  const relief = buildRelief({ stock, items });
  const want = [...new Set(items.map((it) => it.cutDepth))].flatMap((d) => cutterTerraces('taperball', 1, 90, d, SHAPE_SLICES.taperball, items[0].shape).map((x) => x.depth));
  const got = relief.levels.map((l) => l.depth);
  ok(want.every((d) => got.some((g) => Math.abs(g - d) < 1e-9)), `the Roughing grooves are the tapered ball nose's terraces at each level (${got.map((d) => d.toFixed(3)).join(', ')})`);
  eq(Math.max(...got), 10, 'the deepest terrace at the plate level');
  ok(got.length >= 2 * SHAPE_SLICES.taperball - 1, 'each level is a shaped groove (not one flat floor)');
  eq([...new Set(toolDiaAttrs(exportOf()))], ['1.000 mm'], 'its pockets are written with the tip diameter');
  // the CONTOUR of the part with the same tapered bit
  addContourV2(pk);
  const ck = [...V2_PLAN.keys()].find((k) => k.startsWith('contour:'));
  V2_PLAN.set(ck, { ...V2_PLAN.get(ck), ...recordFieldsOf(TBN) });
  const citems = planReliefItems(st).filter((it) => it.key === ck);
  ok(citems.length > 0 && citems.every((it) => it.shape.cutterShape === 'taperball' && it.shape.taperAngle === 3.5), 'the Contour items carry the tapered cone');
  const crel = buildRelief({ stock, items: citems });
  const cwant = [...new Set(citems.map((it) => it.cutDepth))].flatMap((d) => cutterTerraces('taperball', 1, 90, d, SHAPE_SLICES.taperball, citems[0].shape).map((x) => x.depth));
  ok(cwant.every((d) => crel.levels.some((l) => Math.abs(l.depth - d) < 1e-9)), 'the Contour grooves are the tapered terraces at each level');
  const contourDia = [...exportOf().matchAll(/<path [^>]*shaper:cutType="outside"[^>]*>/g)].map((m) => (/shaper:toolDia="([^"]+)"/.exec(m[0]) || [])[1]);
  ok(contourDia.length > 0 && contourDia.every((d) => d === '1.000 mm'), 'its passes are written with the tip diameter: ' + JSON.stringify([...new Set(contourDia)]));
  eq(describeOperations(st, planEntries()).filter((o) => o.tool).map((o) => o.heading), ['Change to TBN 1mm', 'Change to TBN 1mm'], 'both operations under the bit\'s tool change');
  console.log('6 tapered levels: ok');
  // TASK S3: the toolbar's TOOLS section (fixed, after Recalculate) holds the Tool table button
  eq([...doc.querySelectorAll('#prepare-ribbon .sk-ribbon-group')].map((g) => g.dataset.section).slice(-2), ['recalculate', 'tools'], 'the Tools section is the toolbar\'s last, after Recalculate');
  ok('fixed' in q('#prepare-ribbon .sk-ribbon-group[data-section="tools"]').dataset && q('#op-tool-table .sk-ribbon-lbl').textContent === 'My bits', 'a fixed section (as Recalculate): its one button, My bits');
} finally {
  saveBits(DEFAULT_BITS.map((b) => ({ ...b })));
  SettingsManager.set(TOOL_TABLE_KEY, null, { persist: 'local' });
  await app.close?.();
}
console.log(`tool-table-842-node: ${checks} checks pass`);
