// tests/my-bits-852-node.test.js — TASK 852 (owner turns 3180-3184): the tool table is "My bits", built from bit-type TEMPLATES, + the BOWL (corner-radius) bit.
//  1. names: the user-visible "Tool table" is "My bits" (all from the param-hints table).
//  2. the first-use bits are the five inch END MILLS (1/16, 1/8, 1/4, 3/8, 1/2); a stored table is kept exactly (read and re-saved unchanged).
//  3. the bowl type: its fields, its validation lines, its name suggestion (suggestBitName for every type), the "this is a ball nose" note.
//  4. cutterHeightAt / cutterProfile / cutterTerraces for the bowl: flat floor, corner, edge; cornerRadius = diameter / 2 is the ball nose.
//  5. an operation with a bowl bit: the record's copy (cornerRadius), the 3D item's shape, save / load, the export = the same end mill's export; a copy whose bit left My bits.
import assert from 'node:assert/strict';
import { open } from './helpers/node-app.js';
import { worldToScreen } from '#ui/coords.js';
import SettingsManager, { createSettingsManager } from '#core/settings-manager.js';
import { parse as parseUnit } from '#core/units.js';
import { cutterHeightAt, cutterProfile, cutterTerraces, terraceCount, TERRACE_STEP_MM, isShapedCutter } from '#core/cutter-profile.js';
import { DEFAULT_BITS, validateBit, normalizeBit, loadBits, saveBits, recordFieldsOf, suggestBitName, bitNote, bitSummary, BIT_RECORD_FIELDS, TOOL_TABLE_KEY } from '../apps/shaper/src/tool-table.js';
import { CUTTER_SHAPES } from '../apps/shaper/src/shaper.js';
import { hintLabel, hintText } from '../apps/shaper/src/param-hints.js';
import { planEntries, planReliefItems } from '../apps/shaper/src/cut-plan.js';
import { storeOps } from '../apps/shaper/src/operations-store.js';
import { toolOf } from '../apps/shaper/src/operations.js';
import { shaperSvgOf } from '../apps/shaper/src/export-payload.js';
import { captureShaperDoc, applyShaperDoc } from '../apps/shaper/src/shaper-doc.js';
import { buildRelief } from '#core/relief-model.js';
import { V2_PLAN } from './helpers/plan-v2.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b} (tol ${tol})`); checks++; };
SettingsManager.set('DOC_UNIT', 'mm', { persist: false });
SettingsManager.set('LENGTH_PRECISION', null);
const memStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const IN = (t) => parseUnit(t, 'in');

// ── 1. the names ──
{
  eq([hintLabel('toolTable'), hintLabel('toolTableEdit')], ['My bits', 'Edit my bits…'], 'the window title and the Bit menu entry');
  const keys = ['toolTable', 'toolTableEdit', 'toolBit', 'ttAdd', 'ttSave', 'ttType', 'cutterShape:taperball', 'cutterShape:taperflat', 'cutterShape:bowl'];
  const bad = keys.filter((k) => /tool table/i.test(`${hintText(k)} ${hintLabel(k)}`));
  eq(bad, [], 'no hint says "tool table" any more');
  console.log('1 names: ok');
}

// ── 2. the defaults ──
{
  eq(DEFAULT_BITS.map((b) => [b.name, b.type, b.unit, b.diameter]), [
    ['1/16 in end mill', 'endmill', 'in', IN('1/16')], ['1/8 in end mill', 'endmill', 'in', IN('1/8')], ['1/4 in end mill', 'endmill', 'in', IN('1/4')],
    ['3/8 in end mill', 'endmill', 'in', IN('3/8')], ['1/2 in end mill', 'endmill', 'in', IN('1/2')],
  ], 'first use: exactly the five inch end mills');
  eq(loadBits(createSettingsManager({ storage: memStorage() })).map((b) => b.name), DEFAULT_BITS.map((b) => b.name), 'nothing stored: those five');
  // a user who already has a stored table (the old defaults, with a ball nose and a V-bit) keeps it exactly
  const storage = memStorage(), s = createSettingsManager({ storage });
  const old = [
    { id: 'em-3mm', name: '3 mm end mill', type: 'endmill', unit: 'mm', diameter: 3 }, { id: 'bn-1-8in', name: '1/8 in ball nose', type: 'ballnose', unit: 'in', diameter: IN('1/8') },
    { id: 'vb-60', name: '60° V-bit', type: 'vbit', unit: 'in', diameter: IN('1/4'), angle: 60 },
  ];
  s.set(TOOL_TABLE_KEY, { v: 1, bits: old }, { persist: 'local' });
  const before = JSON.stringify(s.get(TOOL_TABLE_KEY));
  const again = createSettingsManager({ storage });
  eq(loadBits(again), old.map((b) => normalizeBit(b.type === 'vbit' ? { tipWidth: 0.508, ...b } : b)), 'a stored table reads a V-bit without tipWidth as 0.508 mm');
  eq(JSON.stringify(again.get(TOOL_TABLE_KEY)), before, 'reading it writes nothing');
  console.log('2 defaults: ok');
}

// ── 3. the bowl type ──
{
  const bowl = CUTTER_SHAPES.find((t) => t.id === 'bowl');
  ok(bowl && bowl.custom === false, 'the bowl type exists (a table bit only: its corner radius has no row on the card)');
  eq(bowl.fields, ['diameter', 'cornerRadius'], 'its fields');
  eq(hintLabel('cutterShape:bowl'), 'Bowl bit (corner radius)', 'its label');
  ok(hintText('cutterShape:bowl').length > 10, 'and its one-line hint');
  const b = { id: 'w', name: 'Bowl', type: 'bowl', unit: 'in', diameter: IN('1/4'), cornerRadius: IN('1/16') };
  eq(validateBit(b), [], 'a valid bowl bit');
  eq(validateBit({ ...b, cornerRadius: null }), ['The corner radius must be more than 0.'], 'no corner radius');
  eq(validateBit({ ...b, cornerRadius: 0 }), ['The corner radius must be more than 0.'], 'a zero corner radius');
  eq(validateBit({ ...b, cornerRadius: IN('1/8') + 0.001 }), ['The corner radius can be at most half the diameter.'], 'more than half the diameter: a plain line, never clamped');
  eq(validateBit({ ...b, cornerRadius: IN('1/8') }), [], 'exactly half the diameter is valid (a ball nose)');
  eq(normalizeBit({ ...b, angle: 60, junk: 1 }).cornerRadius, IN('1/16'), 'the corner radius is kept, exactly');
  eq(Object.keys(normalizeBit({ ...b, tipDiameter: 1 })).sort(), ['cornerRadius', 'diameter', 'id', 'name', 'type', 'unit'], 'only its fields');
  eq(bitNote(b), null, 'no note for a real corner');
  ok(/ball nose/i.test(bitNote({ ...b, cornerRadius: IN('1/8') })), 'half the diameter: the note suggests Ball nose');
  eq(suggestBitName(b), '1/4 in bowl bit, 1/16 in corner', 'the suggested name');
  eq(suggestBitName({ id: 'm', type: 'bowl', unit: 'mm', diameter: 6, cornerRadius: 1.5 }), '6 mm bowl bit, 1.5 mm corner', 'in mm');
  eq([suggestBitName({ type: 'endmill', unit: 'in', diameter: IN('1/4') }), suggestBitName({ type: 'ballnose', unit: 'mm', diameter: 3 }), suggestBitName({ type: 'vbit', unit: 'in', diameter: IN('1/4'), angle: 60 }),
    suggestBitName({ type: 'taperball', unit: 'mm', tipDiameter: 1, taperAngle: 3.5, shankDiameter: 6.35 })], ['1/4 in end mill', '3 mm ball nose', '1/4 in 60° V-bit', '1 mm 3.5° tapered ball nose'], 'the other types');
  eq(suggestBitName({ type: 'bowl', unit: 'mm', diameter: null }), '', 'no size yet: no suggestion');
  eq(bitSummary(b), '1/4 in (6.35 mm), 1/16 in (1.587 mm) corner', 'listed with its corner radius');
  ok(BIT_RECORD_FIELDS.includes('cornerRadius'), 'the record field');
  eq(recordFieldsOf(b), { bitId: 'w', bitName: 'Bowl', cutterShape: 'bowl', toolDia: IN('1/4'), tipWidth: undefined, cornerRadius: IN('1/16'), taperAngle: undefined, shankDia: undefined, cutLength: undefined }, 'the operation copy');
  eq(recordFieldsOf({ id: 'e', name: 'E', type: 'endmill', unit: 'mm', diameter: 6 }).cornerRadius, undefined, 'an end mill: no corner radius (the operation\'s own is removed)');
  console.log('3 bowl type: ok');
}

// ── 4. the bowl profile ──
{
  const D = 6.35, c = 1.5, r = D / 2, sh = { cornerRadius: c };
  eq([cutterHeightAt('bowl', D, 0, sh), cutterHeightAt('bowl', D, r - c, sh), cutterHeightAt('bowl', D, r - c - 0.5, sh)], [0, 0, 0], 'flat across diameter - 2 cornerRadius');
  near(cutterHeightAt('bowl', D, r - c + 0.6, sh), c - Math.sqrt(c * c - 0.36), 1e-12, 'in the corner: c - sqrt(c^2 - (x - (r - c))^2)');
  near(cutterHeightAt('bowl', D, r, sh), c, 1e-12, 'at the edge: the corner radius');
  eq(cutterHeightAt('bowl', D, r + 0.01, sh), null, 'past the bit: nothing');
  eq(cutterHeightAt('bowl', D, 1, { cornerRadius: r + 0.1 }), null, 'an invalid corner radius (more than half): no profile, never guessed');
  eq(cutterHeightAt('bowl', D, 1, {}), null, 'no corner radius: no profile');
  eq(cutterHeightAt('ballnose', D, 1, sh), null, 'a ball nose has no height here (unchanged)');
  // cornerRadius = d / 2 IS the ball nose
  for (const x of [0, 0.4, 1.1, 2, 3, r]) near(cutterHeightAt('bowl', D, x, { cornerRadius: r }), r - Math.sqrt(Math.max(0, r * r - x * x)), 1e-9, `corner = d/2 at x ${x}: the ball nose`);
  for (const d of [0.5, 2, 3.175, 8]) {
    const pb = cutterProfile('ballnose', D, 90, d), pw = cutterProfile('bowl', D, 90, d, { cornerRadius: r });
    near(pw.xMax, pb.xMax, 1e-9, `d ${d}: the same widest half-width`);
    for (const x of [0, 0.7, 1.9, Math.min(2.5, pb.xMax)]) near(pw.depthAt(x), pb.depthAt(x), 1e-9, `d ${d}: depth at ${x}`);
    const tb = cutterTerraces('ballnose', D, 90, d), tw = cutterTerraces('bowl', D, 90, d, { cornerRadius: r });
    eq([tw.length, tw.every((t, i) => Math.abs(t.halfWidth - tb[i].halfWidth) < 1e-9 && Math.abs(t.depth - tb[i].depth) < 1e-9)], [tb.length, true], `d ${d}: the same terraces as the ball nose`);
  }
  // a real bowl: a deep cut = a flat floor at the depth out to r - c, then the corner rising to d - c at the edge
  const p = cutterProfile('bowl', D, 90, 5, sh);
  near(p.xMax, r, 1e-12, 'deep: as wide as the bit'); near(p.depthAt(r - c), 5, 1e-12, 'flat floor at the depth'); near(p.depthAt(r), 5 - c, 1e-12, 'the edge is a corner radius above the floor');
  const ps = cutterProfile('bowl', D, 90, 0.5, sh);
  near(ps.xMax, (r - c) + Math.sqrt(c * c - (c - 0.5) ** 2), 1e-12, 'shallow (less than the corner): only as wide as the corner reaches the surface');
  // 852b: the corner is a SMOOTH surface: no step taller than TERRACE_STEP_MM, and the stepped floor follows the true bowl within one step across the whole width
  for (const [bc, bd] of [[1.5, 5], [4.7625, 8], [0.5, 3], [3.175, 8]]) {
    const bp = cutterProfile('bowl', 12.7, 90, bd, { cornerRadius: bc });
    const ter = cutterTerraces('bowl', 12.7, 90, bd, { cornerRadius: bc });
    ok(ter[0].depth === bd && ter.every((t, i) => i === 0 || (t.depth < ter[i - 1].depth && t.halfWidth > ter[i - 1].halfWidth)), `corner ${bc}: wider = shallower, the innermost at the depth`);
    near(ter[ter.length - 1].halfWidth, bp.xMax, 1e-12, `corner ${bc}: the last terrace reaches the bit edge`);
    const stepMax = Math.max(TERRACE_STEP_MM, (bd - bp.depthAt(bp.xMax)) / 64) * 1.5 + 1e-9; // the cap (64 terraces) binds on a corner taller than 3.2 mm
    let tallest = 0; for (let i = 1; i < ter.length; i++) tallest = Math.max(tallest, ter[i - 1].depth - ter[i].depth);
    ok(tallest <= stepMax, `corner ${bc}: the tallest step between terraces is ${tallest.toFixed(4)} mm (declared ${TERRACE_STEP_MM}, cap-bound ${stepMax.toFixed(3)})`);
    const stepped = (x) => (ter.find((t) => x <= t.halfWidth + 1e-12) || { depth: 0 }).depth;
    let worst = 0; for (let x = 0; x <= bp.xMax; x += bp.xMax / 4000) worst = Math.max(worst, Math.abs(stepped(x) - bp.depthAt(x)));
    ok(worst <= stepMax, `corner ${bc}: the stepped floor is within ${worst.toFixed(4)} mm of the true profile`);
  }
  eq(terraceCount('bowl', 12.7, 90, 8, { cornerRadius: 4.7625 }), 64, 'the count is capped (the cap is stated in the WORK-LOG)');
  ok(isShapedCutter('bowl'), 'a bowl is a shaped cutter (terraced grooves)');
  console.log('4 bowl profile: ok');
}

// ── 5. an operation with a bowl bit ──
const BOWL = { id: 'bit-bowl', name: '1/8 bowl', type: 'bowl', unit: 'in', diameter: IN('1/8'), cornerRadius: IN('1/32') };
const app = await open({ host: 'shaper' });
try {
  const st = app.state, doc = app.document, q = (s) => doc.querySelector(s);
  saveBits([...DEFAULT_BITS, BOWL]);
  [[0, 0], [40, 0], [40, 30], [0, 30]].forEach(([x, y], i) => st.joints.set(`Aj${i}`, { x, y, sketchId: 'sketch-1' }));
  for (let i = 0; i < 4; i++) st.shapes.push({ id: `As${i}`, type: 'line', joints: [`Aj${i}`, `Aj${(i + 1) % 4}`], sketchId: 'sketch-1' });
  app.modes.showMode('prepare');
  const pc = doc.getElementById('prepare-canvas');
  const p = worldToScreen(pc, { x: 0, y: 15 }); app.click(Math.round(p.x), Math.round(p.y), { target: pc });
  const pressEl = (s) => { const e = q(s); assert.ok(e, s + ' not found'); app.press(e); };
  const typed = (cls, v) => { const i = q(cls); i.value = v; i.dispatchEvent(new app.window.Event('change')); };
  const exportOf = () => shaperSvgOf(st, planEntries());
  pressEl('#op-type-pocket');
  typed('.cut-depth', '2');
  const rec = () => storeOps().find((o) => o.type === 'pocket').settings;
  const customEnd = exportOf(); // Custom: the default 1/8 in end mill
  pressEl('.cut-bit-trigger');
  eq(q('.cut-bit-edit').textContent, 'Edit my bits…', 'the Bit menu says My bits');
  eq([...doc.querySelectorAll('.cut-bit-opt .cut-opt-name')].map((o) => o.textContent), [...DEFAULT_BITS.map((b) => b.name), '1/8 bowl'], 'the Bit menu lists the table');
  pressEl('.cut-bit-opt[data-bit="bit-bowl"]');
  eq([rec().bitName, rec().cutterShape, rec().toolDia, rec().cornerRadius], ['1/8 bowl', 'bowl', IN('1/8'), IN('1/32')], 'the operation holds the bowl bit\'s copy, corner radius included');
  const items = planReliefItems(st);
  ok(items.length > 0 && items.every((it) => it.shape.cutterShape === 'bowl' && it.shape.cornerRadius === IN('1/32') && it.shape.toolDia === IN('1/8')), 'the 3D Review items carry the bowl and its corner radius');
  eq(exportOf(), customEnd, 'the file is byte-identical to a Custom end mill of the same diameter (the bit name, shape and corner radius are not written)');
  ok(!/cornerRadius|bowl/i.test(exportOf()), 'nothing of the bowl in the SVG');
  const tool = toolOf({ cutType: 'pocket', ...rec() }), tool2 = toolOf({ cutType: 'pocket', ...rec(), cornerRadius: IN('1/64') });
  ok(tool.key !== tool2.key, 'two bowls of one size and name with another corner: two tools');
  app.prepare.ok();
  // save / load round trip
  const saved = JSON.parse(JSON.stringify(captureShaperDoc()));
  applyShaperDoc(saved, st);
  eq([rec().bitName, rec().cutterShape, rec().cornerRadius], ['1/8 bowl', 'bowl', IN('1/32')], 'saved and reloaded: the same copy');
  eq(exportOf(), customEnd, 'and the same file');
  // the bit leaves My bits: the copy stays, the card says so
  saveBits([...DEFAULT_BITS]);
  app.prepare.edit(storeOps()[0].id);
  eq(q('.cut-bit-cur').textContent, '1/8 bowl (not in My bits)', 'a copy whose bit is no longer in My bits');
  eq(rec().cornerRadius, IN('1/32'), 'its copy is kept');
  app.prepare.cancel();
  // TASK 852b: the BUILT mesh of a 1/2 in bowl (3/16 in corner = 4.7625 mm) pocket 8 mm deep: the rounded zone is the bottom 4.76 mm of the wall and 4.76 mm in from the wall,
  // INTO the floor (the owner saw sharp steps: the old 6 uniform steps left the last 1.9 mm of the quarter circle a vertical wall)
  {
    const K = [...V2_PLAN.keys()][0];
    V2_PLAN.set(K, { ...V2_PLAN.get(K), cutDepth: 8, ...recordFieldsOf({ id: 'z', name: 'z', type: 'bowl', unit: 'in', diameter: IN('1/2'), cornerRadius: IN('3/16') }) });
    const rel = buildRelief({ stock: { thickness: 19.05 }, items: planReliefItems(st) });
    const box = (reg) => { const xs = reg.outer.map((q) => q[0]); return [Math.min(...xs), Math.max(...xs)]; };
    const L = rel.levels.map((l) => ({ depth: l.depth, x0: box(l.regions[0])[0] }));
    const wall = L[L.length - 1].x0 - 0 ; // the floor's inset at the deepest level
    const c = IN('3/16');
    eq(L[L.length - 1].depth, 8, 'the floor is at the cut depth');
    const span = L[L.length - 1].x0 - L[0].x0; // the wall -> the flat floor, in the plan
    ok(span <= c + 1e-6 && span >= c - Math.sqrt(2 * c * 0.075) - 1e-6, `the rounded zone spans ${span.toFixed(3)} mm in from the wall: the 3/16 in corner radius (${c.toFixed(3)}) less its first step`);
    ok(L[0].depth >= 8 - c - 0.1 && L[0].depth <= 8 - c + 0.1, `the widest terrace is at ${L[0].depth.toFixed(3)} mm: within 0.1 of floor - corner radius (${(8 - c).toFixed(3)}); the wall above it is the vertical part`);
    let tallest = 0; for (let i = 1; i < L.length; i++) tallest = Math.max(tallest, L[i].depth - L[i - 1].depth);
    ok(tallest < 0.2, `no step of the corner is taller than 0.2 mm (the tallest is ${tallest.toFixed(3)} mm); wall ${wall.toFixed(2)}`);
  }
  console.log('5 operation: ok');
} finally {
  SettingsManager.set(TOOL_TABLE_KEY, null, { persist: 'local' });
  await app.close?.();
}
console.log(`my-bits-852-node: ${checks} checks pass`);
