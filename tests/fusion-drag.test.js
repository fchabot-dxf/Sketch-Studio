// TASK 530 phase 2 -- DRAGGING with REAL mouse input, qualitative. Pure node: replays the recorded Fusion answers
// (tests/fixtures/fusion-oracle/drag-fusion.json, Fusion version + date inside) against OUR real pointer-drag path
// (handleSelectionPointerDown / Move / Up, see tests/harness/fusion-oracle/drag-cells.js). Fusion's constrained drag is path dependent (phase 1),
// so only the QUALITATIVE record is compared: which points / radii moved, did the dragged point move, constraints kept, rigid or stretch, refused.
// Every class of difference is a KNOWN entry (drag-known.json, regenerate with scripts/fusion-oracle/drag-known.mjs); the test fails loudly
// when a KNOWN cell starts agreeing (delete the entry) or an agreeing cell starts differing (new divergence).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCells, compareCell, runOurs, PATH } from './harness/fusion-oracle/drag-cells.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const load = (f) => JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures/fusion-oracle', f), 'utf8'));
const failures = [];
const fail = (m) => failures.push(m);

const fx = load('drag-fusion.json'), declared = load('drag-cells.json'), KNOWN = load('drag-known.json');
if (!fx.fusion || !fx.date) fail('drag-fusion.json carries no Fusion version / date');
if (JSON.stringify(fx.path) !== JSON.stringify(PATH)) fail('the drag path of the recording differs from drag-cells.js PATH: re-record in Fusion');
const cells = buildCells();
if (JSON.stringify(cells) !== JSON.stringify(declared.cells)) fail('the cell list changed (drag-cells.json is stale: node scripts/fusion-oracle/drag-cli.mjs cells, and re-record in Fusion)');

let same = 0, diff = 0, unstable = 0;
const cache = new Map();
for (const cell of cells) {
  const c = compareCell(cell, fx, cache);
  if (c.state === 'missing') { fail(`${cell.id}: no Fusion answer`); continue; }
  if (c.state === 'unstable') { unstable++; if (KNOWN[cell.id]) fail(`${cell.id}: Fusion's two runs differ, so the cell is not compared: delete its KNOWN entry`); continue; }
  if (c.state === 'same') { same++; if (KNOWN[cell.id]) fail(`${cell.id}: KNOWN (${KNOWN[cell.id].reason}) but ours now agrees with Fusion: delete the entry`); continue; }
  diff++;
  if (!KNOWN[cell.id]) fail(`${cell.id}: NEW divergence (${c.cls}). Fusion ${c.f.moved} ${c.f.mode} | ours ${c.o.moved} ${c.o.mode}`);
  else if (KNOWN[cell.id].class !== c.cls) fail(`${cell.id}: KNOWN as "${KNOWN[cell.id].class}" but now "${c.cls}": regenerate drag-known.json`);
  else if (KNOWN[cell.id].reason === 'UNEXPLAINED') fail(`${cell.id}: KNOWN entry has no reason`);
}
// task 538 guards over EVERY cell (ours): no line / arc / circle collapses during or after the drag; a fully constrained sketch (nullity 0)
// does not move; every constraint and dimension holds after the drag.
let guarded = 0;
for (const cell of cells) {
  const o = cache.get(cell.id) || runOurs(cell);
  if (o.collapsed) fail(`${cell.id}: ${o.collapsed} collapsed (findCollapsedShape)`);
  if (o.nullity0 === 0 && /M|r/.test(o.moved)) fail(`${cell.id}: fully constrained (nullity 0) but moved: ${o.moved}`);
  if (!(o.residual < 1e-6)) fail(`${cell.id}: a constraint is broken after the drag (worst residual ${o.residual})`);
  guarded++;
}
const ids = new Set(cells.map(c => c.id));
for (const id of Object.keys(KNOWN)) if (!ids.has(id)) fail(`KNOWN entry ${id} has no cell`);

if (failures.length) {
  console.error('fusion-drag FAILED:\n  ' + failures.join('\n  '));
  process.exit(1);
}
console.log(`fusion-drag: ${cells.length} cells, ${guarded} guarded (0 collapses, nothing fully constrained moved, every residual < 1e-6), ${same} same as Fusion, ${diff} KNOWN differences, ${unstable} unstable in Fusion (two runs differ, not compared) (Fusion ${fx.fusion}, recorded ${fx.date})`);
