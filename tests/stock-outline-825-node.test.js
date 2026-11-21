// tests/stock-outline-825-node.test.js — TASK 825 V9 (owner ruling, turn 2819: "the file should hold exactly the lines the user drew: the board edge + his Guide, never a
// copy"): a STOCK writes ONLY its own outline. The loops inside it reach the file only through their own operations, exactly once (#core profile-model ownedLoopIds /
// deriveProfileCuts: a type the encoding declares `exportFirst` owns its inner loops). Task 814's rule stays for the CUT profiles (Outside / Inside / On line: an un-owned
// hole is still cut). On the Shaper node page, a 200 x 120 board:
//  A. the Stock + 2 Guides inside it: the file has 1 Stock path + the 2 Guide paths (was 3 + 2 Stock-guide copies); the Export list counts 1 for "Stock · 1 region";
//  B. the Stock + an unassigned rectangle inside it: the file has the Stock path alone (was 2);
//  C. (unchanged) an Outside part with an unassigned hole: the hole is still cut (the 814 rule).
import assert from 'node:assert/strict';
import { open } from './helpers/node-app.js';
import SettingsManager from '#core/settings-manager.js';
import { findLoops } from '#core/loop-finder.js';
import { keyOf, planEntries } from '../apps/shaper/src/cut-plan.js';
import { shaperSvgOf, exportFileOf } from '../apps/shaper/src/export-payload.js';
import { storeOps } from '../apps/shaper/src/operations-store.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
SettingsManager.set('DOC_UNIT', 'mm', { persist: false });
const rect = (st, n, x0, y0, x1, y1) => {
  [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].forEach(([x, y], i) => st.joints.set(`${n}j${i}`, { x, y, sketchId: 'sketch-1' }));
  for (let i = 0; i < 4; i++) st.shapes.push({ id: `${n}s${i}`, type: 'line', joints: [`${n}j${i}`, `${n}j${(i + 1) % 4}`], sketchId: 'sketch-1' });
};
const target = (key) => { const i = key.indexOf(':'); return { kind: key.slice(0, i), id: key.slice(i + 1) }; };
const elements = (svg) => svg.split('\n').slice(1, -1);
const kindOf = (el) => (el.match(/ d="M ([-\d.]+ [-\d.]+)/) || [])[1]; // the path's start point: which drawn rectangle it is

const app = await open({ host: 'shaper' });
try {
  const st = app.state;
  rect(st, 'SB', 0, 0, 200, 120); rect(st, 'G1', 10, 10, 40, 40); rect(st, 'G2', 50, 10, 80, 40); rect(st, 'IN', 100, 30, 170, 90);
  const loops = findLoops(st);
  const K = Object.fromEntries(['SB', 'G1', 'G2', 'IN'].map((n) => [n, keyOf('loop', loops.find((l) => l.edges.includes(`${n}s0`)).id)]));
  app.modes.showMode('prepare');
  const pv = app.prepare.view();
  const edit = (k, o) => { app.prepare.ok(); pv.setSelection([target(K[k])]); for (const [f, v] of Object.entries(o)) (f === 'cutType' ? (app.prepare.openId() ? app.prepare.pickType(v) : app.prepare.addOperation(v)) : pv.setOpField(f, v)); app.prepare.ok(); }; // TASK S3: a type with no operation open = the operations toolbar's button (addOperation)
  const files = () => elements(shaperSvgOf(st, planEntries())).map(kindOf);

  // B first (no Guides yet): the Stock + the unassigned rectangles inside it
  edit('SB', { cutType: 'stock' });
  eq(files(), ['0 0'], 'B: the Stock + three unassigned inner rectangles: the Stock\'s outline alone (was 4 paths)');

  // A: two of them become Guides
  edit('G1', { cutType: 'guide', cutDepth: 0 });
  edit('G2', { cutType: 'guide', cutDepth: 1.5, cutOffset: 1 });
  eq(files(), ['0 0', '10 10', '50 10'], 'A: the Stock + 2 Guides: 1 Stock path + the 2 Guide paths, each once (was 3 + 2)');
  const prev = exportFileOf(st, { preview: true });
  const perOp = prev.ops.map((o) => [o.cutType, (prev.svg.match(new RegExp(`data-op="${o.id}"`, 'g')) || []).length]);
  eq(perOp, [['stock', 1], ['guide', 1], ['guide', 1]], 'A: the Export list counts: the Stock row 1 (was 3), each Guide 1');

  // C: an Outside part inside the Stock with an unassigned hole: the hole is still cut (task 814: an un-owned hole of a CUT profile)
  rect(st, 'HL', 120, 50, 140, 70);
  const loops2 = findLoops(st);
  K.IN = keyOf('loop', loops2.find((l) => l.edges.includes('INs0')).id);
  edit('IN', { cutType: 'exterior', toolDia: 3.175, cutDepth: 10 });
  const kinds = elements(shaperSvgOf(st, planEntries())).map((e) => [(e.match(/shaper:cutType="([a-z]+)"/) || [])[1], kindOf(e)]);
  eq(kinds, [['guide', '0 0'], ['guide', '10 10'], ['guide', '50 10'], ['inside', '120 50'], ['outside', '100 30']], 'C: the Stock + 2 Guides, then the Outside part: its unassigned hole cut (an inside cut) and its outline');
} finally { await app.close(); }
console.log(`stock-outline-825: ${checks} checks passed`);
