// tests/export-own-hole-711-node.test.js — TASK 711: an inner loop that has its OWN record in the cut plan is cut by that record only,
// never also as an automatic hole cut of the enclosing Outside / Inside profile, and every cut is written once. Drawn plates (lines and
// circles: Node's loop polygons are exact for these), exported the way Review -> Generate Shaper SVG does (apps/shaper/src/main.js
// generateShaperSvgPayload) and the 3D Review's input (planReliefItems) from the same plan:
// (1) an inner circle with NO record still gets its automatic Inside cut at the plate's depth; once it has its own record it is cut by that
//     record only;
// (2) the Fusion solid's case in drawn form: an Outside plate around a stepped pocket (a pocket inside a pocket) and a pocket around an
//     island: no pocket outline is cut through the plate, the outer pocket keeps the inner one as its hole, the island stays uncut.
// The real Fusion payload (arcs, which Node samples as chords) runs in the browser: tests/export-own-hole-711-live.test.js.
import assert from 'node:assert';
import { CUT_PLAN, cutPlanEntries, planReliefItems, keyOf } from '../apps/shaper/src/cut-plan.js';
import { exportEncoding } from '../apps/shaper/src/shaper.js';
import { exportShaperSVG } from '#core/shaper-export.js';
import { findLoops } from '#core/loop-finder.js';
import { loopPolygon } from '#core/loop-geometry.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

// The export's elements, each with its cut attributes (a <g> hoists shared attributes; its children inherit them).
function elementsOf(svg) {
  const attrs = (s) => Object.fromEntries([...s.matchAll(/([\w:]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  const out = []; let group = null;
  for (const line of svg.split('\n').map((l) => l.trim())) {
    if (line.startsWith('<g')) throw new Error('TASK 802: the export has a <g>, every element must carry its own cut attributes: ' + line);
    if (line.startsWith('</g')) { group = null; continue; }
    const m = /^<(path|circle|polygon)\s(.*)\/>$/.exec(line);
    if (!m) continue;
    const a = { ...(group || {}), ...attrs(m[2]) };
    const geom = m[1] === 'circle' ? `circle ${a.cx},${a.cy} r${a.r}` : `${m[1]} ${a.d}`;
    out.push({ cutType: a['shaper:cutType'], depth: a['shaper:cutDepth'], geom, subpaths: m[1] === 'path' ? (a.d.match(/M/g) || []).length : 1 });
  }
  return out;
}
const exportNow = (st) => {
  const by = new Map(st.shapes.map((s) => [s.id, s])); const lp = {};
  for (const l of findLoops(st)) lp[l.id] = loopPolygon(l, st, by);
  return exportShaperSVG({ state: st, entries: cutPlanEntries(), encoding: exportEncoding(), docUnit: 'mm', options: {}, loopPolys: lp });
};

// ── (1) a drawn plate: an unassigned inner circle keeps its automatic Inside cut; an assigned one is cut by its own record only ──
{
  CUT_PLAN.clear();
  const st = {
    joints: new Map([['a', { x: 0, y: 0 }], ['b', { x: 100, y: 0 }], ['c', { x: 100, y: 60 }], ['d', { x: 0, y: 60 }], ['o', { x: 30, y: 30 }], ['p', { x: 70, y: 30 }]]),
    shapes: [
      { id: 's1', type: 'line', joints: ['a', 'b'] }, { id: 's2', type: 'line', joints: ['b', 'c'] },
      { id: 's3', type: 'line', joints: ['c', 'd'] }, { id: 's4', type: 'line', joints: ['d', 'a'] },
      { id: 'c1', type: 'circle', joints: ['o'], radius: 5 }, { id: 'c2', type: 'circle', joints: ['p'], radius: 5 },
    ],
    constraints: [], groups: [], profiles: [],
  };
  const loops = findLoops(st);
  const plate = loops.find((l) => l.edges.includes('s1'));
  const hole1 = loops.find((l) => l.edges.includes('c1'));
  CUT_PLAN.set(keyOf('loop', plate.id), { cutType: 'exterior', cutDepth: 12, cutOffset: 0, toolDia: 3.175 });

  let els = elementsOf(exportNow(st));
  eq(els.map((e) => e.cutType + ' ' + e.depth).sort(), ['inside 12.000 mm', 'inside 12.000 mm', 'outside 12.000 mm'],
    'no hole records: both circles get the automatic Inside cut at the plate depth');
  let items = planReliefItems(st);
  eq(items.filter((i) => i.cutType === 'interior').length, 2, 'Review: both automatic hole cuts');

  CUT_PLAN.set(keyOf('loop', hole1.id), { cutType: 'pocket', cutDepth: 3, cutOffset: 0, toolDia: 3.175 });
  els = elementsOf(exportNow(st));
  eq(els.map((e) => e.cutType + ' ' + e.depth).sort(), ['inside 12.000 mm', 'outside 12.000 mm', 'pocket 3.000 mm'],
    'the circle with its own Pocket record is pocketed only; the unassigned circle keeps its automatic Inside cut');
  ok(els.find((e) => e.cutType === 'inside').geom === 'circle 70,30 r5', 'the automatic Inside cut is the UNASSIGNED circle');
  items = planReliefItems(st);
  eq(items.filter((i) => i.cutType === 'interior').length, 1, 'Review: one automatic hole cut');
  eq(items.filter((i) => i.cutType === 'pocket').length, 1, 'Review: the pocket');

  CUT_PLAN.set(keyOf('loop', hole1.id), { cutType: 'interior', cutDepth: 12, cutOffset: 0, toolDia: 3.175 });
  els = elementsOf(exportNow(st));
  eq(els.length, 3, 'a circle with its own Inside record is written once (not also as the plate\'s hole)');
  eq(new Set(els.map((e) => e.geom)).size, 3, 'three distinct elements');
  CUT_PLAN.clear();
}

// ── (2) an Outside plate around a stepped pocket and a pocket with an island (the Fusion solid, drawn with lines) ──
{
  CUT_PLAN.clear();
  const st = { joints: new Map(), shapes: [], constraints: [], groups: [], profiles: [] };
  let n = 0;
  const rect = (x, y, w, h) => {
    const ids = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([px, py]) => { const id = 'j' + (++n); st.joints.set(id, { x: px, y: py }); return id; });
    const first = 's' + (n + 1);
    for (let i = 0; i < 4; i++) st.shapes.push({ id: 's' + (++n), type: 'line', joints: [ids[i], ids[(i + 1) % 4]] });
    return first;
  };
  const sPlate = rect(0, 0, 200, 120), sStep = rect(100, 20, 50, 40), sInner = rect(115, 32, 20, 16), sIsl = rect(155, 20, 40, 40), sIsland = rect(168, 33, 14, 14);
  const loops = findLoops(st);
  const loopOf = (sid) => loops.find((l) => l.edges.includes(sid));
  const rec = (cutType, cutDepth) => ({ cutType, cutDepth, cutOffset: 0, toolDia: 3.175 });
  CUT_PLAN.set(keyOf('loop', loopOf(sPlate).id), rec('exterior', 19));
  CUT_PLAN.set(keyOf('loop', loopOf(sStep).id), rec('pocket', 4));
  CUT_PLAN.set(keyOf('loop', loopOf(sInner).id), rec('pocket', 10));
  CUT_PLAN.set(keyOf('loop', loopOf(sIsl).id), rec('pocket', 8)); // its derived profile: the island is its hole, the island has no record

  const els = elementsOf(exportNow(st));
  eq(els.map((e) => e.cutType + ' ' + e.depth + ' ' + e.subpaths).sort(),
    ['outside 19.000 mm 1', 'pocket 10.000 mm 1', 'pocket 4.000 mm 2', 'pocket 8.000 mm 2'],
    'one Outside (the plate), the 4 mm pocket with the 10 mm step as its hole, the 10 mm step, the 8 mm pocket around the island; no Inside cut');
  const items = planReliefItems(st);
  eq(items.map((i) => i.cutType + ' ' + i.cutDepth).sort(), ['exterior 19', 'pocket 10', 'pocket 4', 'pocket 8'], 'Review: the same four cuts');
  CUT_PLAN.clear();
}

// ── (3) advisor ruling (a), every cut type: a Stock loop (exported as a guide) writes no extra guide line for a child loop that has its
//     own record (an unassigned child keeps it), and a Guide-assigned hole is not cut by its Outside plate ──
{
  CUT_PLAN.clear();
  const st = { joints: new Map(), shapes: [], constraints: [], groups: [], profiles: [] };
  let n = 0;
  const rect = (x, y, w, h) => {
    const ids = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([px, py]) => { const id = 'j' + (++n); st.joints.set(id, { x: px, y: py }); return id; });
    const first = 's' + (n + 1);
    for (let i = 0; i < 4; i++) st.shapes.push({ id: 's' + (++n), type: 'line', joints: [ids[i], ids[(i + 1) % 4]] });
    return first;
  };
  const sBoard = rect(0, 0, 200, 100), sPartA = rect(10, 10, 80, 80);
  rect(110, 10, 80, 80); // part B: no record
  const loops = findLoops(st);
  const loopOf = (sid) => loops.find((l) => l.edges.includes(sid));
  const rec = (cutType, cutDepth) => ({ cutType, cutDepth, cutOffset: 0, toolDia: 3.175 });
  // the board: a Stock loop around part A (its own Pocket record) and part B (no record)
  CUT_PLAN.set(keyOf('loop', loopOf(sBoard).id), rec('stock', 18));
  CUT_PLAN.set(keyOf('loop', loopOf(sPartA).id), rec('pocket', 5));
  let els = elementsOf(exportNow(st));
  const guides = els.filter((e) => e.cutType === 'guide');
  eq(guides.length, 2, 'Stock: the board outline + the UNASSIGNED part B as guide lines, no guide line for part A (it has its own record)');
  const pocketA = els.filter((e) => e.cutType === 'pocket');
  eq(pocketA.length, 1, 'part A is pocketed by its own record');
  ok(!guides.some((e) => e.geom === pocketA[0].geom), 'no guide line along part A: ' + guides.map((e) => e.geom).join(' | '));
  ok(guides.some((e) => /M 110 10 /.test(e.geom)), 'part B keeps its guide line: ' + guides.map((e) => e.geom).join(' | '));
  CUT_PLAN.clear();

  // an Outside plate with a hole assigned Guide: the hole is a guide line only, the plate does not cut it
  const st2 = { joints: new Map(), shapes: [], constraints: [], groups: [], profiles: [] };
  n = 0;
  const rect2 = (x, y, w, h) => {
    const ids = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([px, py]) => { const id = 'j' + (++n); st2.joints.set(id, { x: px, y: py }); return id; });
    const first = 's' + (n + 1);
    for (let i = 0; i < 4; i++) st2.shapes.push({ id: 's' + (++n), type: 'line', joints: [ids[i], ids[(i + 1) % 4]] });
    return first;
  };
  const s2Plate = rect2(0, 0, 90, 80), s2Mark = rect2(30, 20, 20, 20);
  const loops2 = findLoops(st2);
  CUT_PLAN.set(keyOf('loop', loops2.find((l) => l.edges.includes(s2Plate)).id), rec('exterior', 12));
  CUT_PLAN.set(keyOf('loop', loops2.find((l) => l.edges.includes(s2Mark)).id), rec('guide', 0));
  els = elementsOf(exportNow(st2));
  eq(els.map((e) => e.cutType).sort(), ['guide', 'outside'], 'a Guide-assigned hole: the guide line and the plate outline, no Inside cut');
  eq(planReliefItems(st2).filter((i) => i.cutType === 'interior').length, 0, 'Review: the plate does not cut the Guide-assigned hole');
  CUT_PLAN.clear();
}

console.log(`export-own-hole-711-node: ${checks} checks passed`);
