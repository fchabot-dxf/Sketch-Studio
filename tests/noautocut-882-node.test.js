// tests/noautocut-882-node.test.js — TASK 882 (owner turn 3530: "adding a selection from fusion shouldnt create toolpath ever"): a Fusion selection imports GEOMETRY
// only (apps/shaper/src/fusion-import.js importFusionSelection). Its payload hints (cutType, depthMm) stay as each region's SOURCE (regions[key].source), so a cut
// type the user gives it afterwards prefills the depth. A same-id update keeps the operations the USER made and makes none.
import assert from 'node:assert';
import { open } from './helpers/node-app.js';
import { importFusionSelection } from '../apps/shaper/src/fusion-import.js';
import { getCutRecord, getPlanRecord, newOperation } from '../apps/shaper/src/cut-plan.js';
import { storeOps, regionKeys, regionOf } from '../apps/shaper/src/operations-store.js';
import { getSelections } from '../apps/shaper/src/selection-list.js';

let checks = 0;
const eq = (a, b, m) => { assert.strictEqual(JSON.stringify(a), JSON.stringify(b), m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const rect = (x, y, w, h) => ({ closed: true, segments: [
  { type: 'line', x1: x, y1: y, x2: x + w, y2: y }, { type: 'line', x1: x + w, y1: y, x2: x + w, y2: y + h },
  { type: 'line', x1: x + w, y1: y + h, x2: x, y2: y + h }, { type: 'line', x1: x, y1: y + h, x2: x, y2: y },
] });
const circ = (cx, cy, r) => ({ closed: true, segments: [{ type: 'circle', cx, cy, r }] });
const body = (w, extra = {}) => ({
  action: 'selection_data', version: 1, units: 'mm', coordSystem: { yAxis: 'up', frame: 'plane-2d' }, source: { kind: 'body', name: 'Body1' },
  stock: { thicknessMm: 12 }, selectionId: 'sel-882',
  regions: [
    { id: 'o', label: 'Outline', cutType: 'outside', depthMm: 12, outer: rect(0, 0, w, 20), holes: [circ(10, 10, 3)] },
    { id: 'h', label: 'Hole', cutType: 'inside', depthMm: 12, outer: circ(10, 10, 3), holes: [] },
    ...(extra.more || []),
  ], chains: [], warnings: [],
});

const app = await open({ host: 'shaper' });
try {
  const imp = (p) => importFusionSelection(p, { controller: app.controller, prepare: app.prepare });

  // 1. an outside region + inside holes: NO operation
  const r1 = imp(body(40));
  ok(r1.ok && r1.imported > 0, 'the body imported');
  eq(storeOps().length, 0, '1: a body import (outside outline + inside hole) makes 0 operations');
  ok(regionKeys().length >= 2, '1: its regions are there (unassigned)');
  const types = regionKeys().map((k) => regionOf(k).source).map((s) => `${s.cutType}:${s.cutDepth}`).sort();
  eq(types, ['exterior:12', 'interior:12'], '1: each region keeps its payload hints as its source');

  // 2. the user gives the outline Outside: the depth prefills from the payload
  const outKey = regionKeys().find((k) => regionOf(k).source.cutType === 'exterior');
  eq(getCutRecord(outKey).cutDepth, 12, '2: an unassigned region\'s record carries the depth from Fusion');
  const op = newOperation('exterior', [outKey]);
  eq([storeOps().length, op.settings.cutDepth, getPlanRecord(outKey).cutDepth], [1, 'model', 12], '2: Outside given afterwards: Depth "From model" = 12');

  // 3. a re-sent selection (same id, the outline unchanged, a NEW region added): the user's operation is kept, none is added
  const more = [{ id: 'p', label: 'Pocket', cutType: 'pocket', depthMm: 4, outer: rect(100, 0, 10, 10), holes: [] }];
  const r3 = imp(body(40, { more }));
  ok(r3.ok, '3: the update went in');
  eq(getSelections().length, 1, '3: still one selection (updated in place)');
  eq(storeOps().length, 1, '3: the update added no operation');
  eq(storeOps()[0].id, op.id, '3: the user\'s operation is the same one');
  ok(r3.cutKeys.length >= 3, '3: the new region is in the selection');
  ok(r3.cutKeys.some((k) => regionOf(k) && regionOf(k).source && regionOf(k).source.cutDepth === 4), '3: the new region keeps its payload depth');
  eq(storeOps()[0].geometry.length, 1, '3: the operation still holds just the one outline the user gave it');
  eq(getPlanRecord(storeOps()[0].geometry[0].key).cutDepth, 12, '3: its depth is kept');

  // 4. the outline CHANGED in Fusion (50 long): today's rule (795c) keeps the user's operation, now empty; still no operation is made
  const r4 = imp(body(50, { more }));
  ok(r4.ok, '4: the changed selection went in');
  eq([storeOps().length, storeOps()[0].id === op.id], [1, true], '4: the user operation is kept (its outline is gone: it is empty), none is added');

  console.log(`noautocut-882-node: ${checks} checks passed`);
} finally {
  await app.close();
}
