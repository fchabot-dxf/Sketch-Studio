// tests/hole-rule-774-node.test.js — TASK 774 item 7 (owner turn 2357, review of commit 27c00a4 "restrict derived auto-holes to same sketch"):
//   a Shaper document SAVED BEFORE the same-sketch hole rule keeps the cut geometry it was saved with. Its export must be BYTE-IDENTICAL to the export the
//   same document had before 27c00a4 (tests/fixtures/hole-rule-774/<case>.svg, generated once on 27c00a4^ in a temporary worktree from the SAME documents,
//   tests/fixtures/hole-rule-774/docs.js); the notice appears once; a second open (the saved migrated document) changes nothing; a document the rule
//   never changed is untouched. A pocket island with its own record cannot keep its hole (a combined profile would take that island's record): counted, named.
//   (c) the shape index is built once per resolve: listSketchProfiles reads state.shapes a fixed number of times whatever the number of loops.
import assert from 'node:assert';
import fs from 'node:fs';
import { exportShaperSVG } from '#core/shaper-export.js';
import { findLoops } from '#core/loop-finder.js';
import { loopPolygon } from '#core/loop-geometry.js';
import { listSketchProfiles } from '#core/profile-model.js';
import { exportEncoding } from '../apps/shaper/src/shaper.js';
import { CUT_PLAN, cutPlanEntries, cutPlanNotice } from '../apps/shaper/src/cut-plan.js';
import { applyShaperDoc, captureShaperDoc } from '../apps/shaper/src/shaper-doc.js';
import { HOLE_RULE_CASES, holeRuleDoc } from './fixtures/hole-rule-774/docs.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
// the exporter writes LF; a Windows checkout (core.autocrlf) gives the fixture CRLF: compared with the exporter's line ends
const baseline = (name) => fs.readFileSync(new URL(`./fixtures/hole-rule-774/${name}.svg`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// the export of `state` with the plan in CUT_PLAN (Shaper's shaperSvgOf, docUnit fixed to mm)
function exportNow(state) {
  const loops = findLoops(state);
  const sById = new Map(state.shapes.map((s) => [s.id, s]));
  const loopPolys = {}; for (const l of loops) loopPolys[l.id] = loopPolygon(l, state, sById);
  return exportShaperSVG({ state, entries: cutPlanEntries(), encoding: exportEncoding(), docUnit: 'mm', options: { groupByCut: true }, loopPolys });
}
// the stored Shaper sidecar of a case, saved before the rule (version 1), and its loop ids
function savedDoc(name, version = 1) {
  const { state, plan } = holeRuleDoc(name);
  const loops = findLoops(state);
  const cutPlan = plan.map(([t, rec]) => [`loop:${loops.find((l) => l.edges.includes(t.edge)).id}`, rec]);
  return { state, sidecar: { version, cutPlan, stock: null, opOrder: [] } };
}
const counts = (r) => ({ keptHoles: r.keptHoles, lostHoles: r.lostHoles });

// 1. the review finding's case: a Pocket on a Sketch 1 face with two Sketch 2 islands
{
  const { state, sidecar } = savedDoc('islands');
  // without the fix the plan derives without the islands (what main does): shown here by opening it AS IF saved under the new rule (version 2)
  const asNew = savedDoc('islands', 2);
  applyShaperDoc(asNew.sidecar, asNew.state);
  ok(exportNow(asNew.state) !== baseline('islands'), 'islands: under the same-sketch rule the pocket loses its islands (the regression the fix guards)');
  ok(!/M 10 10/.test(exportNow(asNew.state)), 'islands: ... no island subpath in it');

  const r = applyShaperDoc(sidecar, state);
  eq(counts(r), { keptHoles: 1, lostHoles: 0 }, 'islands: the one record kept its holes');
  eq(exportNow(state), baseline('islands'), 'islands: the export is byte-identical to the export before 27c00a4');
  eq([...CUT_PLAN.keys()], [`profile:${state.profiles[0].id}`], 'islands: the record moved to an explicit combined profile');
  eq(state.profiles.length, 1, 'islands: one combined profile (visible in Design, Uncombine undoes it)');
  eq(state.profiles[0].inners.length, 2, 'islands: with the two islands');
  eq(cutPlanNotice(r), 'Cut plan updated: 1 cut kept its holes from other sketches (now a combined profile)', 'islands: the one-time notice');

  // a second open of the SAVED (migrated) document changes nothing: the sidecar is version 2 now, the record a profile record
  const saved = captureShaperDoc();
  eq(saved.version, 2, 'the saved sidecar is version 2 (the same-sketch rule)');
  const r2 = applyShaperDoc(saved, state);
  eq(counts(r2), { keptHoles: 0, lostHoles: 0 }, 'second open: nothing to keep');
  eq(cutPlanNotice(r2), null, 'second open: no notice');
  eq(state.profiles.length, 1, 'second open: no second profile');
  eq(exportNow(state), baseline('islands'), 'second open: the same bytes');

  // the same UNSAVED old document opened again on a fresh copy: the same result (deterministic)
  const again = savedDoc('islands');
  applyShaperDoc(again.sidecar, again.state);
  eq(again.state.profiles, state.profiles, 'opened again unsaved: the same profile, the same id');
  eq(exportNow(again.state), baseline('islands'), 'opened again unsaved: the same bytes');
}

// 2. a document the rule never changed: untouched, byte-identical
for (const name of ['same-sketch']) {
  const { state, sidecar } = savedDoc(name);
  const before = JSON.stringify(sidecar.cutPlan);
  const r = applyShaperDoc(sidecar, state);
  eq(counts(r), { keptHoles: 0, lostHoles: 0 }, `${name}: nothing to keep`);
  eq(JSON.stringify([...CUT_PLAN]), before, `${name}: the plan is unchanged`);
  eq(state.profiles.length, 0, `${name}: no profile made`);
  eq(exportNow(state), baseline(name), `${name}: byte-identical to the export before 27c00a4`);
}

// 3. an Outside plate: its Sketch 2 hole (no own record) keeps its inside cut; with a second hole that HAS its own record (TASK 711), that hole stays out of
//    the profile (cut by its own record only, as before) and its record still resolves to itself
for (const name of ['plate', 'plate-owned']) {
  const { state, sidecar } = savedDoc(name);
  const r = applyShaperDoc(sidecar, state);
  eq(counts(r), { keptHoles: 1, lostHoles: 0 }, `${name}: the plate record kept its hole`);
  eq(exportNow(state), baseline(name), `${name}: byte-identical to the export before 27c00a4`);
  eq(state.profiles[0].inners.length, 1, `${name}: the profile has the one hole without its own record`);
  if (name === 'plate-owned') eq([...CUT_PLAN.keys()][1], sidecar.cutPlan[1][0], 'plate-owned: the hole\'s own record is unchanged');
}

// 4. a Pocket whose Sketch 2 island has its own record: not convertible without changing the island's record -> left, counted, named
{
  const { state, sidecar } = savedDoc('own-island');
  const r = applyShaperDoc(sidecar, state);
  eq(counts(r), { keptHoles: 0, lostHoles: 1 }, 'own-island: counted as not kept');
  eq(JSON.stringify([...CUT_PLAN]), JSON.stringify(sidecar.cutPlan), 'own-island: the plan is unchanged');
  eq(state.profiles.length, 0, 'own-island: no profile made');
  eq(cutPlanNotice(r), 'Cut plan updated: 1 cut no longer has its holes from other sketches (a hole has its own cut): check it in Prepare', 'own-island: the notice names it');
  ok(exportNow(state) !== baseline('own-island'), 'own-island: (its export differs from before 27c00a4: reported, owner decision)');
}

// 5. NEW work follows the same-sketch rule: a version 2 document with a pocket on the face keeps its record as it is (no profile made)
{
  const { state, sidecar } = savedDoc('islands', 2);
  const r = applyShaperDoc(sidecar, state);
  eq(counts(r), { keptHoles: 0, lostHoles: 0 }, 'version 2: the same-sketch rule applies, nothing converted');
  eq(state.profiles.length, 0, 'version 2: no profile');
}

// 6. (c) the shape index once per resolve: listSketchProfiles reads state.shapes the same number of times for 3 loops as for 30
function shapeReads(nRects) {
  const st = { joints: new Map(), shapes: [], constraints: [], profiles: [] };
  for (let i = 0; i < nRects; i++) {
    const x = i * 20;
    [[x, 0], [x + 10, 0], [x + 10, 10], [x, 10]].forEach(([px, py], k) => st.joints.set(`r${i}j${k}`, { x: px, y: py }));
    for (let k = 0; k < 4; k++) st.shapes.push({ id: `r${i}s${k}`, type: 'line', joints: [`r${i}j${k}`, `r${i}j${(k + 1) % 4}`] });
  }
  let maps = 0;
  const shapes = st.shapes;
  st.shapes = new Proxy(shapes, { get(t, p, rcv) { if (p === 'map') maps++; return Reflect.get(t, p, rcv); } });
  const loops = findLoops(st);
  maps = 0;
  listSketchProfiles(st, loops);
  return maps;
}
const few = shapeReads(3), many = shapeReads(30);
eq(few, many, `(c) state.shapes indexed a fixed number of times per listSketchProfiles (3 loops: ${few}, 30 loops: ${many})`);

ok(HOLE_RULE_CASES.length === 5, 'every case checked');
console.log(`hole-rule-774-node: ${checks} checks passed`);
