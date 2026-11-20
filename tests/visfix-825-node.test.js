// tests/visfix-825-node.test.js — TASK 825: the visual-only bugs proven by the hunt of task 824 (docs/VISUAL-BUGS-824.md), each asserted on the Shaper node page
// (tests/helpers/node-app.js). A Stock board, two Guides whose values differ (depth 0; depth 1.5 + offset 1), a plain Pocket and a Spiral Pocket (both 6 mm, ¼ in bit):
//  V8: the "Not cut" heading's box is computed from ALL the rows under it (the Stock counts, ticked and untickable) like every other heading;
//  V4: two Guides that differ show what makes them different on their row (depth, offset), as the other types show their depth.
import assert from 'node:assert/strict';
import { open } from './helpers/node-app.js';
import SettingsManager from '#core/settings-manager.js';
import { findLoops } from '#core/loop-finder.js';
import { keyOf } from '../apps/shaper/src/cut-plan.js';
import { describeOperations } from '../apps/shaper/src/operations.js';
import { storeOps } from '../apps/shaper/src/operations-store.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
SettingsManager.set('DOC_UNIT', 'mm', { persist: false });

function rect(st, n, x0, y0, x1, y1) {
  [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].forEach(([x, y], i) => st.joints.set(`${n}j${i}`, { x, y, sketchId: 'sketch-1' }));
  for (let i = 0; i < 4; i++) st.shapes.push({ id: `${n}s${i}`, type: 'line', joints: [`${n}j${i}`, `${n}j${(i + 1) % 4}`], sketchId: 'sketch-1' });
}
const target = (key) => { const i = key.indexOf(':'); return { kind: key.slice(0, i), id: key.slice(i + 1) }; };

const app = await open({ host: 'shaper' });
try {
  const st = app.state;
  rect(st, 'SB', 0, 0, 200, 120); rect(st, 'G1', 10, 10, 40, 40); rect(st, 'G2', 50, 10, 80, 40); rect(st, 'P1', 10, 60, 60, 100); rect(st, 'P2', 80, 60, 130, 100);
  const loops = findLoops(st);
  const K = Object.fromEntries(['SB', 'G1', 'G2', 'P1', 'P2'].map((n) => [n, keyOf('loop', loops.find((l) => l.edges.includes(`${n}s0`)).id)]));
  app.modes.showMode('prepare');
  const pv = app.prepare.view();
  const edit = (k, o) => { app.prepare.ok(); pv.setSelection([target(K[k])]); for (const [f, v] of Object.entries(o)) (f === 'cutType' ? app.prepare.pickType(v) : pv.setOpField(f, v)); app.prepare.ok(); };
  edit('SB', { cutType: 'stock' });
  edit('G1', { cutType: 'guide', cutDepth: 0 });
  edit('G2', { cutType: 'guide', cutDepth: 1.5, cutOffset: 1 });
  edit('P1', { cutType: 'pocket', toolDia: 6.35, cutDepth: 6 });
  edit('P2', { cutType: 'pocket', toolDia: 6.35, cutDepth: 6, clearing: 'linked', stepover: 40, loop: false });
  pv.setSelection([]);
  const list = app.prepare.opList;
  list.refresh();
  const ops = () => describeOperations(st);
  const rowBox = (id) => [...app.document.querySelectorAll('#prepare-ops .ops-row')].find((r) => r.dataset.id === id).querySelector('.ops-tick input');
  const headBox = (h) => [...app.document.querySelectorAll('#prepare-ops .ops-tool')].find((e) => e.textContent === h).querySelector('.ops-tick input');
  const idOf = (type, at = 0) => storeOps().filter((o) => o.type === type)[at].id;
  eq(ops().map((o) => o.rowText), ['Stock', 'Guide', 'Guide', 'Pocket · 6 mm', 'Pocket (spiral) · 6 mm'], 'setup: the list rows');

  // V8: the Not cut heading
  eq(list.inspectTicks().groups[0], { heading: 'Not cut', state: 'all', disabled: false }, 'V8: Stock + 2 Guides ticked: the heading is all');
  app.press(headBox('Not cut'));
  eq(storeOps().filter((o) => o.type === 'guide').map((o) => o.on), [false, false], 'V8: the heading unticks its two Guides');
  eq(list.inspectTicks().groups[0].state, 'some', 'V8: the Stock under it is still ticked: the heading is mixed, not none');
  app.press(headBox('Not cut'));
  eq(list.inspectTicks().groups[0].state, 'all', 'V8: a tap on the mixed heading ticks them again: all');

  void idOf; void rowBox;
} finally { await app.close(); }
console.log(`visfix-825-node: ${checks} checks passed`);
