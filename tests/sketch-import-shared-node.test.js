// tests/sketch-import-shared-node.test.js — TASK 601 (node port of part A of tests/sketch-import.test.js, TASK 566): the shared importer
// (#ui/sketch-import.js importIntoSketch) on small SVG / DXF fixtures gives the SAME shapes the old Shaper-only path gave
// (tests/fixtures/svg/import-baseline-shaper.json, captured from the old Shaper code before it was deleted) and lands as ONE undo snapshot.
// The importer runs as the page runs it: the DOMParser is the kit's page (happy-dom), the state is the same plain stand-in the browser test built.
// Same asserts, same fixtures. Part B (the File menu entry, the real file chooser, a drop, in the four apps) stays in tests/sketch-import.test.js.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './helpers/node-app.js'; // the page globals (DOMParser, document) the importer reads
import { importIntoSketch } from '#ui/sketch-import.js';
import { createSketches } from '#core/sketch-model.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = (...p) => path.join(REPO_ROOT, 'tests', 'fixtures', ...p);
const baseline = JSON.parse(fs.readFileSync(FIX('svg', 'import-baseline-shaper.json'), 'utf8'));

const runShared = (text, name, keep) => {
  let n = 0; const saves = [];
  const state = { ...createSketches(), joints: new Map(), shapes: [], view: { x: 0, y: 0, w: 120, h: 90 }, genJ: () => 'j' + (++n), saveState: (l) => saves.push(l) };
  const svg = { getBoundingClientRect: () => ({ width: 800, height: 600 }), setAttribute() {} }; // the canvas the importer fits the view on (TASK 570)
  const res = importIntoSketch(text, name, { state, svg }, { keepDescIds: keep });
  const J = (id) => { const j = state.joints.get(id); return [Math.round(j.x * 1e6) / 1e6, Math.round(j.y * 1e6) / 1e6]; };
  return JSON.parse(JSON.stringify({ ok: res.ok, message: res.message, saves, shapes: state.shapes.map((s) => ({ type: s.type, joints: s.joints.map(J), radius: s.radius == null ? null : Math.round(s.radius * 1e6) / 1e6, sweep: s.sweep == null ? null : s.sweep, isConstruction: !!s.isConstruction, descId: s.descId || null })), sketches: state.sketches.map((s) => s.name) }));
};
const cases = [
  ['import-basic.svg', FIX('svg', 'import-basic.svg'), 'import-basic.svg'],
  ['dxf:part-mm.dxf', FIX('dxf', 'part-mm.dxf'), 'part-mm.dxf'],
  ['dxf:fusion-sketch4.dxf', FIX('dxf', 'fusion-sketch4.dxf'), 'fusion-sketch4.dxf'],
  ['svg:fusion-shaper-addin-arcs.svg', FIX('svg', 'fusion-shaper-addin-arcs.svg'), 'fusion-shaper-addin-arcs.svg'],
];
for (const [key, file, name] of cases) {
  const r = runShared(fs.readFileSync(file, 'utf8'), name, true);
  assert.ok(r.ok, key + ': ' + r.message);
  assert.deepStrictEqual(r.shapes, baseline[key].shapes, key + ': the same shapes (types, joint coordinates, radii, sweeps, construction flags) as the old Shaper path');
  assert.deepStrictEqual(r.sketches, baseline[key].sketches, key + ': the same new sketch');
  assert.strictEqual(r.saves.length, 1, key + ': ONE undo snapshot per import');
  console.log(key, '->', r.shapes.length, 'shapes |', r.message);
}
const basic = runShared(fs.readFileSync(FIX('svg', 'import-basic.svg'), 'utf8'), 'x.svg', false);
assert.ok(basic.shapes.every((s) => s.descId === null), 'descIds are dropped unless the host keeps them');
assert.ok(basic.shapes.some((s) => s.type === 'arc') && basic.shapes.some((s) => s.type === 'circle'), 'the arc path and the circle became real arc / circle shapes');
const bad = runShared('<svg><oops', 'bad.svg', false);
assert.ok(!bad.ok && /^Import failed: /.test(bad.message) && bad.saves.length === 0 && bad.shapes.length === 0, 'a malformed SVG is a readable failure and changes nothing: ' + bad.message);
console.log('sketch-import-shared-node: ok');
