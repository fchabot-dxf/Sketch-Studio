// tests/prepare-pick-732-node.test.js — TASK 732 (owner turn 2060): in Prepare, one click inside the BOTTOM BOARD of the "Box frame (front
// view)" template highlighted the bottom board TOGETHER WITH the dividers and the left end board. Cause: a board that SHARES an edge with
// the clicked board was taken for one of its HOLES (#core/loop-geometry.js polygonContains tested only the inner polygon's first vertex,
// which sits ON the shared edge, where the ray test is ambiguous), so the derived face = the board "minus" its neighbours, drawn evenodd.
// Fusion's profile pick: a click picks the smallest closed region containing the point; a face that only touches it is never its hole.
// Checks, on the template as the app builds it (an inch document, Horizontal layout, 4 compartments: 34 shapes, as the owner's):
//   1. every board and divider is its own face (the faces tile the frame);
//   2. a point inside each face resolves (resolveProfileAtPoint, what Prepare's interior pick calls) to exactly that face, with NO holes,
//      its polygon bbox = the board's;
//   3. a pocket on the bottom board exports ONE path (one subpath) = the bottom board's outline only;
//   4. polygonContains: a neighbour sharing an edge (first vertex on the shared edge) is not contained; a true hole still is, also one that
//      touches the outer boundary from inside.
import assert from 'node:assert';
import { buildTemplate, templateById } from '#core/templates.js';
import { findLoops } from '#core/loop-finder.js';
import { loopPolygon, polyArea, polygonContains } from '#core/loop-geometry.js';
import { resolveProfileAtPoint, derivedProfileForLoop } from '#core/profile-model.js';
import { exportShaperSVG } from '#core/shaper-export.js';
import { planEntries, keyOf } from '../apps/shaper/src/cut-plan.js';
import { exportEncoding } from '../apps/shaper/src/shaper.js';
import { V2_PLAN } from './helpers/plan-v2.js'; // TASK S1: the test's v2 document of the plan, loaded through applyShaperDoc

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const r3 = (v) => Math.round(v * 1000) / 1000 + 0;
const bbox = (p) => [Math.min(...p.map((q) => q.x)), Math.min(...p.map((q) => q.y)), Math.max(...p.map((q) => q.x)), Math.max(...p.map((q) => q.y))].map(r3);

// ── the template as the app builds it in an inch document ──
const doc = buildTemplate(templateById('box-frame'), { length: 23.5, width: 5.6, thickness: 0.625, compartments: 4, layout: 'Horizontal' }, 'in');
const g = doc.geometry;
const st = { joints: new Map(g.joints), shapes: g.shapes, constraints: g.constraints, groups: [], profiles: [] };
eq(st.shapes.length, 34, 'the owner\'s design: 34 shapes');
const loops = findLoops(st);
const by = new Map(st.shapes.map((s) => [s.id, s]));
const polys = Object.fromEntries(loops.map((l) => [l.id, loopPolygon(l, st, by)]));
const T = 15.875, L = 596.9, H = 142.24, n = 4, gap = (L - (n + 1) * T) / n;

// 1. the faces: top and bottom boards (full length), the two ends and the three dividers between them, the four openings
const want = [[0, -T, L, 0], [0, -H, L, -H + T]]; // bottom, top
for (let k = 0; k <= n; k++) want.push([k * (gap + T), -H + T, k * (gap + T) + T, -T]); // ends + dividers
for (let k = 0; k < n; k++) want.push([k * (gap + T) + T, -H + T, (k + 1) * (gap + T), -T]); // openings
const got = loops.map((l) => bbox(polys[l.id]));
const key = (b) => b.map((v) => v.toFixed(3)).join(',');
eq(got.map(key).sort(), want.map((b) => b.map(r3)).map(key).sort(), '1. every board, divider and opening is its own face');
ok(Math.abs(loops.reduce((a, l) => a + polyArea(polys[l.id]), 0) - L * H) < 1e-6, '1. the faces tile the frame');

// 2. a point inside each face picks exactly that face, no holes
for (const b of want) {
  const p = { x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2 };
  const prof = resolveProfileAtPoint(p, st, loops, polys);
  ok(prof && prof.isDerived, `2. a derived face at ${JSON.stringify(p)}`);
  eq(bbox(polys[prof.outer]), b.map(r3), `2. the click at ${JSON.stringify(p)} picks the face ${key(b)}`);
  eq(prof.inners, [], `2. the face ${key(b)} has no holes (a neighbour sharing an edge is not a hole)`);
}
// the owner's click: inside the bottom board under the 3rd divider
const bottom = resolveProfileAtPoint({ x: 2 * (gap + T) + T / 2, y: -T / 2 }, st, loops, polys);
eq([bbox(polys[bottom.outer]), bottom.inners], [[0, -T, L, 0].map(r3), []], '2. the owner\'s click: the bottom board only');
eq(derivedProfileForLoop(bottom.outer, loops, polys, st).inners, [], '2. the bottom board\'s derived face has no holes');

// 3. a pocket on the bottom board exports only the bottom board's outline
V2_PLAN.clear();
V2_PLAN.set(keyOf('loop', bottom.outer), { cutType: 'pocket', cutDepth: 6, cutOffset: 0, toolDia: 3.175 });
const svg = exportShaperSVG({ state: st, entries: planEntries(), encoding: exportEncoding(), docUnit: 'mm', options: {}, loopPolys: polys });
const paths = [...svg.matchAll(/<path\s[^>]*\bd="([^"]*)"/g)].map((m) => m[1]);
eq(paths.length, 1, '3. one element in the export:\n' + svg);
eq((paths[0].match(/M/g) || []).length, 1, '3. one subpath (no neighbour board written as a hole): ' + paths[0]);
const pts = [...paths[0].matchAll(/(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
const bb = bbox(pts);
eq([r3(bb[2] - bb[0]), r3(bb[3] - bb[1])], [r3(L), r3(T)], '3. the exported outline is the bottom board: ' + paths[0]);
V2_PLAN.clear();

// 4. polygonContains on the case itself and on true holes
const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const board = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 10 }, { x: 60, y: 10 }, { x: 40, y: 10 }, { x: 0, y: 10 }]; // split at a T
ok(!polygonContains(board, [{ x: 40, y: 10 }, { x: 60, y: 10 }, { x: 60, y: 50 }, { x: 40, y: 50 }]), '4. a divider standing on the board is not inside it');
ok(!polygonContains(board, [{ x: 60, y: 10 }, { x: 60, y: 50 }, { x: 40, y: 50 }, { x: 40, y: 10 }]), '4. the same, any first vertex');
ok(polygonContains(rect(0, 0, 100, 100), rect(20, 20, 40, 40)), '4. a true hole is contained');
ok(polygonContains(rect(0, 0, 100, 100), [{ x: 0, y: 50 }, { x: 30, y: 40 }, { x: 30, y: 60 }]), '4. a hole touching the outer boundary from inside is contained (as before)');
ok(!polygonContains(rect(0, 0, 100, 100), [{ x: 0, y: 50 }, { x: -30, y: 40 }, { x: -30, y: 60 }]), '4. a triangle touching it from outside is not');

console.log(`prepare-pick-732-node: ${checks} checks passed`);
