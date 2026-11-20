// tests/settings-table-812-node.test.js — TASK 812 (S0 of docs/OPERATIONS-MODEL.md, 1.5): the settings an operation is made of are declared ONCE per cut type
// (shaper.js CUT_TYPES[].fields) and operations.js settingsOf reads that table.
//  1. for every cut type, over a corpus of records with every setting varied, the keys settingsOf answers are EXACTLY the type's declared fields (none outside the
//     table, every declared field reached), in the table's order; a type that is not cut (Guide, Stock) declares none and answers null;
//  2. the operation key is byte for byte what it was before the table (literal keys from the code before 812), and `loopPitch` joins it (a Loop-on pocket with
//     pitch 1 and 2 are two operations; the default pitch adds nothing);
//  3. the cut card asks the same table (cutTypeHasField).
import assert from 'node:assert';
import { CUT_TYPES, cutTypeHasField } from '../apps/shaper/src/shaper.js';
import { settingsOf, opKeyOf } from '../apps/shaper/src/operations.js';

const axes = {
  cutDepth: ['unset', 3, 6], cutOffset: [0, 0.4], toolDia: [3.175, 6.35], cutterShape: ['endmill', 'vbit'], cutterAngle: [60, 90],
  stepDepth: [undefined, 1.5], adaptiveSteps: [false, true], stepDeviation: [undefined, 0.2], finishAllowance: [undefined, 0, 0.5],
  roughLayout: [undefined, 'nested'], minTerraceWidth: [undefined, 2], smoothing: [undefined, 0, 0.3],
  holdPart: [undefined, 'tabs', 'skin'], tabCount: ['auto', 3], tabWidth: [4], holdThickness: [1],
  clearing: [undefined, 'raster', 'linked', 'morphed'], stepover: [undefined, 50], rasterAngle: [undefined, 45], loop: [undefined, true], loopPitch: [undefined, 1.5],
  leadIn: [undefined, true], leadInRadius: [undefined, 2], leadInSweep: [undefined, 90], leadInLength: [undefined, 1], leadInSide: [undefined, 'inside'], leadInAt: [undefined, 0.3],
  slope: [undefined, { a: 1 }], levels: [undefined, [{ z: 1 }]],
};
let seed = 812;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const record = (id) => {
  const rec = { cutType: id };
  for (const [n, vals] of Object.entries(axes)) { const v = vals[Math.floor(rnd() * vals.length)]; if (v !== undefined) rec[n] = v; }
  return rec;
};

// ---- 1. settingsOf = the table
assert.deepStrictEqual(CUT_TYPES.map((t) => t.id), ['exterior', 'interior', 'pocket', 'online', 'guide', 'stock', 'roughing', 'contour'], 'the cut types');
for (const t of CUT_TYPES) {
  assert(Array.isArray(t.fields), `${t.id} declares its settings fields`);
  const seen = new Set();
  for (let i = 0; i < 600; i++) {
    const s = settingsOf(record(t.id));
    if (t.opRank === 0) { assert.strictEqual(s, null, `${t.id} is not cut: no settings`); continue; }
    const keys = Object.keys(s);
    for (const k of keys) { assert(t.fields.includes(k), `${t.id}: settingsOf answered "${k}", which the table does not declare`); seen.add(k); }
    assert.deepStrictEqual(keys, t.fields.filter((f) => keys.includes(f)), `${t.id}: the keys follow the table's order`);
  }
  assert.deepStrictEqual([...seen].sort(), [...t.fields].sort(), `${t.id}: every declared field is reached by some record (declared: ${t.fields}; reached: ${[...seen]})`);
}
for (const t of CUT_TYPES) for (const f of ['depth', 'offset', 'steps', 'allowance', 'layout', 'minWidth', 'smoothing', 'hold', 'clearing', 'leadIn']) {
  assert.strictEqual(cutTypeHasField(t.id, f), t.fields.includes(f), `cutTypeHasField(${t.id}, ${f})`);
}
assert.strictEqual(cutTypeHasField(null, 'clearing'), false, 'no type picked: no field');
assert.strictEqual(cutTypeHasField('pocket', 'clearing'), true, 'a pocket has clearing');
assert.strictEqual(cutTypeHasField('roughing', 'clearing'), false, 'a roughing has none');

// ---- 2. the keys are the keys of before the table (literal), and loopPitch joins them
const base = { cutType: 'pocket', cutDepth: 6, cutOffset: 0, toolDia: 6.35, cutterShape: 'endmill', clearing: 'morphed', stepover: 50, finishAllowance: 0.5 };
assert.strictEqual(opKeyOf(base), '["endmill|6.35|","pocket",{"depth":6,"offset":0,"clearing":{"pattern":"morphed","stepover":50,"allowance":0.5}}]', 'a Spiral pocket: the key before 812');
assert.strictEqual(opKeyOf({ ...base, loop: true }), '["endmill|6.35|","pocket",{"depth":6,"offset":0,"clearing":{"pattern":"morphed","stepover":50,"allowance":0.5,"loop":true}}]', 'Loop on, the default pitch: the key before 812');
assert.strictEqual(opKeyOf({ ...base, loop: true, loopPitch: 1 }), opKeyOf({ ...base, loop: true }), 'the default pitch (1) adds nothing');
assert.notStrictEqual(opKeyOf({ ...base, loop: true, loopPitch: 1 }), opKeyOf({ ...base, loop: true, loopPitch: 2 }), 'loopPitch 1 vs 2 (Loop on) are two operations');
assert.strictEqual(opKeyOf({ ...base, loop: true, loopPitch: 2 }), '["endmill|6.35|","pocket",{"depth":6,"offset":0,"clearing":{"pattern":"morphed","stepover":50,"allowance":0.5,"loop":true,"loopPitch":2}}]', 'the pitch is in the key');
assert.strictEqual(opKeyOf({ ...base, loopPitch: 2 }), opKeyOf(base), 'a pitch with Loop off cuts nothing different: the same operation');
assert.strictEqual(opKeyOf({ cutType: 'online', cutDepth: 3, cutOffset: 0, toolDia: 3.175, holdPart: 'tabs', tabCount: 3, tabWidth: 4 }), '["endmill|3.175|","online",{"depth":3,"offset":0,"hold":{"mode":"tabs","count":3,"width":4}}]', 'an On line cut with tabs: the key before 812');
assert.strictEqual(opKeyOf({ cutType: 'contour', toolDia: 3.175, cutterShape: 'ballnose' }), '["ballnose|3.175|","contour",{"steps":{"step":0.25}}]', 'a Contour: the key before 812');

console.log('settings-table-812-node: ok');
