// tests/bezier-loops-761-node.test.js — TASK 761: an outline with a BEZIER is a real closed profile everywhere.
//  1. NO-BEZIER DOCUMENTS ARE BIT-IDENTICAL: every fixture drawing without a bezier (the document fixtures, the 137 legacy-angle drawings, the DXF
//     files, the Fusion selections imported through the Shaper node kit) gives the SAME findLoops (ids, order, joints, edges), open chains, loop paths
//     (both ways), loop polygons, chain paths, Shaper downloads (every loop Outside + every chain On line; every loop a Spiral pocket; every loop Outside
//     with tabs; the Fusion import's own plan), 3D Review footprints and SketchStudio SVG / DXF as the digest written on origin/main 97a5dba (before this
//     task) in tests/fixtures/bezier-loops-761/no-bezier-digest.json. `node tests/bezier-loops-761-node.test.js --write-digest` rewrites that file (only
//     ever run on the base commit). TASK 786: its Shaper download facets (shaperOutside / shaperSpiral / shaperTabs / download) re-written by the 786 exporter,
//     every change explained (WORK-LOG TURN 786): the page grown to hold every written element, the start mark stroke-only, a mixed-kind hole wound opposite.
//  2. findLoops: a bezier is an EDGE; the angular sort at a node uses each curve's TANGENT there, the bounded test the curve's real area: line + bezier,
//     bezier + bezier, arc + its chord, a lens of two arcs, bezier + line two-edge loops, a bezier outline with a hole, nesting; areas and orientation.
//  3. ONE geometry per curve kind (#core/curve-kinds.js): containment / interior point on curved loops, the export's cubic `C` (round trip within 1e-6),
//     an OPEN chain with a bezier exports its curve, pocket clearing / hold part on a bezier outline give closed paths inside the region.
//  4. EXISTING CUT PLANS (advisor ruling on the 761 STOP): a stored `chain:` record on an outline that is now a loop MOVES to `loop:<id>` (its operation
//     order place kept), records with no exact match are removed, both counted in the one notice; a second open changes nothing.
//  (Close path, 760: an arc closed by its own chord and a chain with a bezier closed by Close path are loops: tests/close-path-760-node.test.js section 3.)
import assert from 'node:assert';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { findLoops, findOpenChains } from '#core/loop-finder.js';
import { loopPolygon, loopToPathD, chainToPathD, polyArea, pointInPolygon, polygonContains } from '#core/loop-geometry.js';
import { CURVE_TOLERANCE_MM, bezierSteps } from '#core/curve-kinds.js';
import { resolveProfileAtPoint, directlyContainedLoops } from '#core/profile-model.js';
import { deriveCuts } from '#core/stepped-cut.js';
import { exportShaperSVG } from '#core/shaper-export.js';
import { importDxf } from '#core/dxf-import.js';
import { buildSVG, buildDXF } from '../apps/sketchstudio/ui/export-manager.js';
import { shaperSvgOf } from '../apps/shaper/src/export-payload.js';
import { planEntries, planReliefItems, reconcileCutPlan, cutPlanNotice } from '../apps/shaper/src/cut-plan.js';
import { opKeyOf, describeOperations } from '../apps/shaper/src/operations.js';
import { importFusionSelection } from '../apps/shaper/src/fusion-import.js';
import { captureShaperDoc, applyShaperDoc } from '../apps/shaper/src/shaper-doc.js';
import { exportEncoding } from '../apps/shaper/src/shaper.js';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { V2_PLAN } from './helpers/plan-v2.js'; // TASK S1: the test's v2 document of the plan, loaded through applyShaperDoc

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const fx = (p) => new URL('./fixtures/' + p, import.meta.url);
const DIGEST_FILE = fx('bezier-loops-761/no-bezier-digest.json');
const WRITE = process.argv.includes('--write-digest');

// ── 1. the digest of a drawing: everything a loop / curve consumer writes, hashed per facet ──
// the Fusion import names its shapes `fusion<Date.now()>_<n>_s<k>` and its joints `j<n>_<Date.now()>` (#core/shape-id): the clock part is replaced before hashing
const hash = (v) => crypto.createHash('sha256').update((typeof v === 'string' ? v : JSON.stringify(v)).replace(/fusion\d{10,}_/g, 'fusion#_').replace(/(j\d+_)\d{10,}/g, '$1#')).digest('hex').slice(0, 24);
const hasBezier = (st) => (st.shapes || []).some((s) => s && s.type === 'bezier');
const stateOf = (g) => ({
  joints: new Map((g.joints || []).map((e) => (Array.isArray(e) ? [e[0], { ...e[1] }] : [e.id, { ...e }]))),
  shapes: (g.shapes || []).map((s) => ({ ...s, joints: [...(s.joints || [])] })),
  constraints: (g.constraints || []).map((c) => ({ ...c })),
  profiles: (g.profiles || []).map((p) => ({ ...p })),
});
const rec = (cutType, extra = {}) => ({ cutType, cutDepth: 6, cutOffset: 0, toolDia: 3.175, cutterShape: 'endmill', cutterAngle: 90, ...extra });
function digestOf(st, { heavy = false } = {}) {
  const loops = findLoops(st), chains = findOpenChains(st, loops);
  const byId = new Map(st.shapes.map((s) => [s.id, s]));
  const out = {
    loops: hash(loops), chains: hash(chains.map((c) => c.id)),
    loopPaths: hash(loops.map((l) => [loopToPathD(l, st), loopToPathD(l, st, { reverse: true })])),
    loopPolys: hash(loops.map((l) => loopPolygon(l, st, byId))),
    chainPaths: hash(chains.map((c) => chainToPathD(c, st))),
    shaperOutside: hash(shaperSvgOf(st, [...loops.map((l) => ({ target: { kind: 'loop', id: l.id }, rec: rec('exterior') })), ...chains.map((c) => ({ target: { kind: 'chain', id: c.id }, rec: rec('online') }))])),
    studioSvg: hash(buildSVG(st) || ''), studioDxf: hash(buildDXF(st) || ''),
  };
  if (heavy) {
    // TASK 778: programmed pockets add ONLY their guide start-mark element(s); strip ONLY those guide elements to prove everything else is bit-identical
    const START_MARK_D = /d="M [^"]+ A [^"]+ A [^"]+ M [^"]+ L [^"]+ M [^"]+ L [^"]+"/;
    const stripStartMarks = (svg) => {
      const lines = svg.split('\n'), kept = [];
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (/^  <path /.test(l) && START_MARK_D.test(l) && l.includes('shaper:cutType="guide"')) continue;
        if (/^  <g [^>]*shaper:cutType="guide"[^>]*>$/.test(l)) {
          let j = i + 1, allMarks = true;
          while (j < lines.length && lines[j] !== '  </g>') { if (!(/^    <path /.test(lines[j]) && START_MARK_D.test(lines[j]))) allMarks = false; j++; }
          if (allMarks && j < lines.length && lines[j] === '  </g>') { i = j; continue; }
        }
        kept.push(l);
      }
      return kept.join('\n');
    };
    out.shaperSpiral = hash(stripStartMarks(shaperSvgOf(st, loops.map((l) => ({ target: { kind: 'loop', id: l.id }, rec: rec('pocket', { clearing: 'linked', toolDia: 25.4 }) })))));
    out.shaperTabs = hash(shaperSvgOf(st, loops.map((l) => ({ target: { kind: 'loop', id: l.id }, rec: rec('exterior', { holdPart: 'tabs', holdThickness: 1, tabWidth: 6, tabCount: 'auto' }) }))));
  }
  return out;
}
const docs = [];
for (const f of ['owner-trapezoid.document.json', 'pattern-params-694-old.document.json', 'pre-577-two-sketches.document.json', 'angle-dimension/owner-trapezoid-angle.json',
  'dimension/owner-drag-frozen-589.document.json', 'dimension/owner-rect-line-line-589.document.json', 'drag/owner-two-arcs-575.json']) {
  docs.push({ name: f, st: stateOf(JSON.parse(fs.readFileSync(fx(f), 'utf8')).geometry), heavy: true });
}
for (const f of ['report/drag-frozen.json', 'report/line-line-driven.json', 'report/midpoint-move.json']) {
  docs.push({ name: f, st: stateOf(JSON.parse(fs.readFileSync(fx(f), 'utf8')).document.geometry), heavy: true });
}
JSON.parse(fs.readFileSync(fx('angle-dimension/legacy-angles.json'), 'utf8')).docs.forEach((d, i) => docs.push({ name: `legacy-angles#${i} ${d.name}`, st: stateOf(d.doc.geometry) }));
for (const f of ['bulge-loop-in.dxf', 'close-path-760-gap.dxf', 'fusion-sketch4.dxf', 'part-mm.dxf']) {
  let n = 0;
  const res = importDxf(fs.readFileSync(fx('dxf/' + f), 'utf8'), { genJ: () => 'j' + (n++), idPrefix: 'd' });
  docs.push({ name: 'dxf/' + f, st: { joints: new Map((res.joints || []).map((j) => [j.id, { x: j.x, y: j.y }])), shapes: res.shapes || [], constraints: res.constraints || [], profiles: [] }, heavy: true });
}
const digest = {};
for (const d of docs) digest[d.name] = { bezier: hasBezier(d.st), ...digestOf(d.st, { heavy: d.heavy }) };
// the Fusion selections, imported by the Shaper's own import (its plan: pockets, holes, tabs, steps), through the node kit
{
  const app = await open({ host: 'shaper' });
  try {
    app.modes.showMode('prepare');
    for (const f of ['real-solid-plate-711.json', ...fs.readdirSync(fx('sa7-slope')).map((x) => 'sa7-slope/' + x)]) {
      V2_PLAN.clear(); V2_PLAN.setOrder([]);
      importFusionSelection(fs.readFileSync(fx(f), 'utf8'), { controller: app.controller, prepare: app.prepare });
      const st = app.state;
      const relief = planReliefItems(st).map((i) => [i.key, i.sig, i.cutType, i.cutDepth, i.footprints]);
      digest['fusion/' + f] = { bezier: hasBezier(st), ...digestOf(st), plan: hash([...V2_PLAN]), download: hash(shaperSvgOf(st, planEntries())), relief: hash(relief) };
    }
  } finally { V2_PLAN.clear(); V2_PLAN.setOrder([]); await app.close(); }
}
if (WRITE) {
  fs.mkdirSync(new URL('.', DIGEST_FILE), { recursive: true });
  fs.writeFileSync(DIGEST_FILE, JSON.stringify(digest, null, 1) + '\n');
  console.log(`wrote ${Object.keys(digest).length} drawings (${Object.values(digest).filter((d) => d.bezier).length} with a bezier) to ${DIGEST_FILE.pathname}`);
  process.exit(0);
}
{
  const base = JSON.parse(fs.readFileSync(DIGEST_FILE, 'utf8'));
  eq(Object.keys(digest).sort(), Object.keys(base).sort(), 'the same drawings as the base digest');
  let n = 0;
  for (const [name, d] of Object.entries(base)) {
    if (d.bezier) continue; // a drawing with a bezier is what this task changes
    eq(digest[name], d, `${name}: no bezier -> every facet bit-identical to origin/main 97a5dba (TASK 786: its downloads to the 786 exporter)`);
    n++;
  }
  console.log(`no-bezier drawings bit-identical: ${n} (with a bezier, expected to change: ${Object.values(base).filter((d) => d.bezier).length})`);
}

// ── 2. findLoops: a bezier is an edge; tangents and real areas at the nodes ──
const J = (o) => new Map(Object.entries(o).map(([k, [x, y]]) => [k, { x, y }]));
const line = (id, a, b) => ({ id, type: 'line', joints: [a, b] });
const arc = (id, c, s, e, extra = {}) => ({ id, type: 'arc', subType: 'CENTER', joints: [c, s, e], ...extra });
const bez = (id, a, b, c1, c2) => ({ id, type: 'bezier', joints: [a, b], c1, c2 });
const st = (joints, shapes) => ({ joints: J(joints), shapes, constraints: [], profiles: [] });
const loopsOf = (s) => findLoops(s).map((l) => [l.id, l.joints, l.edges]);
const byIdOf = (s) => new Map(s.shapes.map((x) => [x.id, x]));
const signed = (poly) => { let a = 0; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j].x * poly[i].y - poly[i].x * poly[j].y; return a / 2; };
// ∫ y dx along the cubic P (an array of 4 [x, y]) by Simpson on 20000 steps: an independent check of the areas (not the loop finder's quadrature)
const underCubic = (P) => {
  const at = (t, k) => (1 - t) ** 3 * P[0][k] + 3 * (1 - t) ** 2 * t * P[1][k] + 3 * (1 - t) * t * t * P[2][k] + t ** 3 * P[3][k];
  const dx = (t) => 3 * ((1 - t) ** 2 * (P[1][0] - P[0][0]) + 2 * (1 - t) * t * (P[2][0] - P[1][0]) + t * t * (P[3][0] - P[2][0]));
  const N = 20000; let A = 0;
  for (let i = 0; i <= N; i++) { const t = i / N; A += at(t, 1) * dx(t) * (i === 0 || i === N ? 1 : i % 2 ? 4 : 2); }
  return A / (3 * N);
};
// the outline of the facts (1a): 3 lines + 1 bezier (its control points 40 above the top chord)
const OUTLINE = { a: [0, 0], b: [100, 0], c: [100, 50], d: [0, 50] };
const outlineShapes = () => [line('L1', 'a', 'b'), line('L2', 'b', 'c'), bez('B1', 'c', 'd', [70, 90], [30, 90]), line('L3', 'd', 'a')];
const S1 = st(OUTLINE, outlineShapes());
{
  eq(loopsOf(S1), [['loop_B1-L1-L2-L3', ['a', 'b', 'c', 'd'], ['L1', 'L2', 'B1', 'L3']]], '2: 3 lines + 1 bezier: ONE loop, counter-clockwise a b c d');
  eq(findOpenChains(S1).length, 0, '2: no open chain left');
  const poly = loopPolygon(findLoops(S1)[0], S1, byIdOf(S1));
  ok(signed(poly) > 0, '2: its polygon winds counter-clockwise (positive area)');
  const real = -underCubic([[100, 50], [70, 90], [30, 90], [0, 50]]); // the region under the curve (walked right to left), down to y = 0
  ok(Math.abs(polyArea(poly) - real) < 1 && polyArea(poly) <= real + 1e-9, `2: its area is the real one (${real.toFixed(4)}; sampled ${polyArea(poly).toFixed(4)}, within the tolerance, inscribed)`);
  // the DXF spline outline of the facts (1b) is the same loop
  const dxf = ['0', 'SECTION', '2', 'ENTITIES', '0', 'LINE', '8', '0', '10', '0', '20', '0', '11', '100', '21', '0', '0', 'LINE', '8', '0', '10', '100', '20', '0', '11', '100', '21', '50',
    '0', 'SPLINE', '8', '0', '70', '8', '71', '3', '72', '8', '73', '4', ...[0, 0, 0, 0, 1, 1, 1, 1].flatMap((k) => ['40', String(k)]),
    '10', '100', '20', '50', '10', '70', '20', '90', '10', '30', '20', '90', '10', '0', '20', '50', '0', 'LINE', '8', '0', '10', '0', '20', '50', '11', '0', '21', '0', '0', 'ENDSEC', '0', 'EOF'].join('\n');
  let n = 0;
  const res = importDxf(dxf, { genJ: () => 'j' + (n++), idPrefix: 'x' });
  const sd = { joints: new Map(res.joints.map((j) => [j.id, { x: j.x, y: j.y }])), shapes: res.shapes, constraints: res.constraints || [] };
  eq(sd.shapes.map((x) => x.type), ['line', 'line', 'bezier', 'line'], '2: the DXF SPLINE outline imports as 3 lines + 1 bezier');
  eq(findLoops(sd).length, 1, '2: and is ONE loop');
}
{ // two-edge loops: their edges share BOTH end nodes (a chord cannot tell them apart)
  const chordArc = st({ o: [0, 0], p: [10, 0], q: [-10, 0] }, [arc('A1', 'o', 'p', 'q', { sweep: true }), line('L1', 'p', 'q')]);
  eq(loopsOf(chordArc), [['loop_A1-L1', ['p', 'q'], ['A1', 'L1']]], '2: an arc + its chord: a loop (counter-clockwise: over the arc, back along the chord)');
  eq(loopToPathD(findLoops(chordArc)[0], chordArc), 'M 10 0 A 10 10 0 0 1 -10 0 Z', '2: its path: the arc, the chord closed by Z');
  const chordArcCw = st({ o: [0, 0], p: [10, 0], q: [-10, 0] }, [arc('A1', 'o', 'p', 'q', { sweep: false }), line('L1', 'p', 'q')]);
  eq(loopsOf(chordArcCw), [['loop_A1-L1', ['q', 'p'], ['A1', 'L1']]], '2: the arc the other way (under the chord): walked from q, still counter-clockwise');
  const lens = st({ o1: [0, -5], o2: [0, 5], p: [10, 0], q: [-10, 0] }, [arc('A1', 'o1', 'p', 'q'), arc('A2', 'o2', 'q', 'p')]);
  eq(loopsOf(lens), [['loop_A1-A2', ['p', 'q'], ['A1', 'A2']]], '2: a lens of two arcs: a loop');
  const bl = st({ p: [0, 0], q: [100, 0] }, [bez('B1', 'p', 'q', [30, 60], [70, 60]), line('L1', 'q', 'p')]);
  eq(loopsOf(bl), [['loop_B1-L1', ['q', 'p'], ['B1', 'L1']]], '2: a bezier + a line between the same two points: a loop');
  const A = underCubic([[0, 0], [30, 60], [70, 60], [100, 0]]); // its real area (the chord is on y = 0)
  const pbl = loopPolygon(findLoops(bl)[0], bl, byIdOf(bl));
  ok(Math.abs(polyArea(pbl) - A) < 0.5 && signed(pbl) > 0, `2: bezier + line: area ${polyArea(pbl).toFixed(3)} ~ ${A.toFixed(3)}, counter-clockwise`);
  const bb = st({ p: [0, 0], q: [100, 0] }, [bez('B1', 'p', 'q', [30, 60], [70, 60]), bez('B2', 'q', 'p', [70, -40], [30, -40])]);
  eq(loopsOf(bb), [['loop_B1-B2', ['q', 'p'], ['B1', 'B2']]], '2: bezier + bezier: a loop');
  // the documented LIMITATION fixed at its cause: at p an arc's CHORD runs along a line (both to q); its TANGENT leaves upward
  const d = st({ o: [0, 0], p: [10, 0], q: [-10, 0], r: [0, 5] }, [arc('A1', 'o', 'p', 'q', { sweep: true }), line('L1', 'p', 'q'), line('Lpr', 'p', 'r'), line('Lrq', 'r', 'q')]);
  eq(findLoops(d).map((l) => l.edges.slice().sort()), [['A1', 'Lpr', 'Lrq'], ['L1', 'Lpr', 'Lrq']], '2: an arc whose chord is a line of the drawing: the arc face and the triangle (sorted by tangent)');
}
{ // a bezier outline with a hole; nesting; containment, the interior point and picking on the curve
  const withHole = st({ ...OUTLINE, h1: [40, 10], h2: [60, 10], h3: [60, 30], h4: [40, 30] }, [...outlineShapes(), line('H1', 'h1', 'h2'), line('H2', 'h2', 'h3'), line('H3', 'h3', 'h4'), line('H4', 'h4', 'h1')]);
  const loops = findLoops(withHole), polys = Object.fromEntries(loops.map((l) => [l.id, loopPolygon(l, withHole, byIdOf(withHole))]));
  const outer = loops.find((l) => l.id === 'loop_B1-L1-L2-L3'), hole = loops.find((l) => l.id === 'loop_H1-H2-H3-H4');
  ok(outer && hole, '2: the bezier outline and its hole are both loops');
  eq(directlyContainedLoops(outer, loops, polys, withHole).map((l) => l.id), [hole.id], '2: the hole is directly inside the bezier outline');
  ok(polygonContains(polys[outer.id], polys[hole.id]), '2: polygonContains(outline, hole) (the interior point of TASK 732)');
  const atCurve = resolveProfileAtPoint({ x: 50, y: 78 }, withHole, loops, polys); // under the curve's top (80), above the chord (50)
  eq([atCurve && atCurve.outer, atCurve && atCurve.inners], [outer.id, [hole.id]], '2: a click inside the bulge picks the outline (with its hole)');
  eq(resolveProfileAtPoint({ x: 50, y: 82 }, withHole, loops, polys), null, '2: a click just above the curve picks nothing');
  eq(resolveProfileAtPoint({ x: 50, y: 20 }, withHole, loops, polys).outer, hole.id, '2: a click in the hole picks the hole');
  const nested = st({ ...OUTLINE, g1: [-50, -50], g2: [150, -50], g3: [150, 150], g4: [-50, 150] }, [...outlineShapes(), line('G1', 'g1', 'g2'), line('G2', 'g2', 'g3'), line('G3', 'g3', 'g4'), line('G4', 'g4', 'g1')]);
  const nl = findLoops(nested), np = Object.fromEntries(nl.map((l) => [l.id, loopPolygon(l, nested, byIdOf(nested))]));
  eq(directlyContainedLoops(nl.find((l) => l.id === 'loop_G1-G2-G3-G4'), nl, np, nested).map((l) => l.id), ['loop_B1-L1-L2-L3'], '2: nested: the bezier outline inside a plate');
}

// ── 3. ONE geometry per curve kind: the export's `C`, an open chain's curve, pocket clearing and hold part on a bezier outline ──
// a tiny reader of path data: [{ c: 'M'|'L'|'C'|'A'|'Z', v: [numbers] }]
const parseD = (d) => [...d.matchAll(/([MLCAZ])([^MLCAZ]*)/g)].map((m) => ({ c: m[1], v: m[2].trim() ? m[2].trim().split(/[\s,]+/).map(Number) : [] }));
{
  const d = loopToPathD(findLoops(S1)[0], S1);
  const cmds = parseD(d);
  const C = cmds.filter((x) => x.c === 'C');
  eq(C.length, 1, '3: the loop path has ONE cubic C (the bezier), not a polyline: ' + d);
  const [x1, y1, x2, y2, x, y] = C[0].v, P = [S1.shapes[2].c1, S1.shapes[2].c2, [0, 50]];
  ok([x1 - P[0][0], y1 - P[0][1], x2 - P[1][0], y2 - P[1][1], x - P[2][0], y - P[2][1]].every((e) => Math.abs(e) <= 1e-6), '3: round trip: the C carries the shape\'s control points and end within 1e-6 (walked c -> d: c1 then c2)');
  ok(cmds.every((x) => x.c !== 'L' || x.v.length === 2) && cmds.at(-1).c === 'Z', '3: lines stay L, the path closes');
  const rev = parseD(loopToPathD(findLoops(S1)[0], S1, { reverse: true })).find((x) => x.c === 'C').v;
  eq(rev, [30, 90, 70, 90, 100, 50], '3: walked the other way (a hole): the control points swap, the curve is the same');
  const rec = { cutType: 'exterior', cutDepth: 6, cutOffset: 0, toolDia: 3.175 };
  const svg = exportShaperSVG({ state: S1, entries: [{ target: { kind: 'loop', id: 'loop_B1-L1-L2-L3' }, rec }], encoding: exportEncoding(), docUnit: 'mm' });
  ok(/<path d="M 0 0 L 100 0 L 100 50 C 70 90 30 90 0 50 Z"/.test(svg), '3: the Shaper SVG writes the outline as a path with the real cubic C');
  // an OPEN chain with a bezier (the curve was MISSING from the file before this task: facts (1a))
  const open1 = st(OUTLINE, outlineShapes().filter((x) => x.id !== 'L3'));
  const ch = findOpenChains(open1);
  eq(ch.map((c) => c.id), ['chain_B1-L1-L2'], '3: without its closing line the outline is an open chain');
  eq(chainToPathD(ch[0], open1), 'M 0 0 L 100 0 L 100 50 C 70 90 30 90 0 50', '3: the chain path has the bezier as a C');
  const svg2 = exportShaperSVG({ state: open1, entries: [{ target: { kind: 'chain', id: ch[0].id }, rec: { ...rec, cutType: 'online' } }], encoding: exportEncoding(), docUnit: 'mm' });
  ok(svg2.includes('d="M 0 0 L 100 0 L 100 50 C 70 90 30 90 0 50"'), '3: the On line export of an open chain with a bezier now contains the curve');
  // SketchStudio SVG / DXF: the cubic, and a DXF SPLINE that the DXF import reads back as the same bezier
  ok(/C 70\.000000 90\.000000 30\.000000 90\.000000 0\.000000 50\.000000/.test(buildSVG(S1)), '3: SketchStudio SVG writes the bezier as a cubic C');
  const dx = buildDXF(S1);
  ok(dx.includes('SPLINE'), '3: SketchStudio DXF writes a SPLINE');
  let n = 0;
  const back = importDxf(dx.replace(/\r\n/g, '\n'), { genJ: () => 'k' + (n++), idPrefix: 'r' }).shapes.filter((x) => x.type === 'bezier');
  eq(back.map((b) => [b.c1, b.c2]), [[[70, -90], [30, -90]]], '3: and the DXF import reads it back as one bezier (its control points; the import flips y)');
}
{ // pocket clearing (Spiral, Loop on) and hold part (tabs) on the bezier outline
  const loops = findLoops(S1), loopPolys = Object.fromEntries(loops.map((l) => [l.id, loopPolygon(l, S1, byIdOf(S1))]));
  const poly = loopPolys['loop_B1-L1-L2-L3'], target = { kind: 'loop', id: 'loop_B1-L1-L2-L3' };
  const pocket = { cutType: 'pocket', cutDepth: 6, cutOffset: 0, toolDia: 6, clearing: 'linked', loop: true, autoOffset: 1.5 };
  const cuts = deriveCuts(target, pocket, S1, loops, loopPolys, new Set());
  const clear = cuts.filter((c) => c.kind === 'clearing');
  ok(clear.length >= 1 && clear.every((c) => c.centers.every((cc) => cc.closed && cc.points.length >= 3)), `3: the Spiral (Loop on) clearing of the bezier pocket: ${clear.length} closed loops`);
  ok(clear.every((c) => c.centers.every((cc) => cc.points.every((p) => pointInPolygon(poly, p)))), '3: every clearing path point is inside the curved region');
  ok(clear.some((c) => c.centers.some((cc) => cc.points.some((p) => p.y > 60))), '3: the clearing reaches into the bulge (above the chord y = 50)');
  const held = { cutType: 'exterior', cutDepth: 12, cutOffset: 0, toolDia: 6, holdPart: 'tabs', holdThickness: 2, tabWidth: 10, tabCount: 'auto' };
  const hc = deriveCuts(target, held, S1, loops, loopPolys, new Set());
  const pass = hc.find((c) => c.hold && c.hold.role === 'pass'), strips = hc.filter((c) => c.hold && c.hold.role === 'strip');
  ok(pass && pass.hold.count >= 3 && strips.length === pass.hold.count, `3: tabs on the bezier outline: ${pass && pass.hold.count} tabs, ${strips.length} gap strips`);
  ok(pass.hold.marks.some((m) => parseD(m)[0].v[1] > 50.5), '3: a tab sits on the curve (the bezier is one walk segment)');
  const dist = (p) => Math.min(...poly.map((a, i) => { const b = poly[(i + 1) % poly.length], vx = b.x - a.x, vy = b.y - a.y, L = vx * vx + vy * vy, t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / L)) : 0; return Math.hypot(p.x - a.x - t * vx, p.y - a.y - t * vy); }));
  ok(strips.every((s) => s.hold.outline.length >= 3 && s.hold.outline.every((p) => dist(p) <= 7 + 0.01 && (!pointInPolygon(poly, p) || dist(p) <= 0.01))), '3: every gap strip is a closed ring outside the part, within the strip width of the outline');
  const svg = shaperSvgOf(S1, [{ target, rec: held }]);
  ok(/C 70 90 30 90 0 50/.test(svg), '3: the held outline is exported with its cubic');
  eq([CURVE_TOLERANCE_MM, bezierSteps([{ x: 100, y: 50 }, { x: 70, y: 90 }, { x: 30, y: 90 }, { x: 0, y: 50 }])], [0.005, 79], '3: the outline\'s bezier is sampled at 0.005 mm: 79 steps (ceil(sqrt(0.75 * |(-10, -40)| / 0.005)))');
}

// ── 4. EXISTING CUT PLANS (the advisor's ruling on the 761 STOP) ──
const docOf = (joints, shapes, shaper) => ({ version: 2, geometry: { joints: [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }], ...Object.entries(joints).map(([k, [x, y]]) => [k, { x, y, fixed: false, sketchId: 'sketch-1' }])],
  shapes: shapes.map((x) => ({ ...x, sketchId: 'sketch-1' })), constraints: [], sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }], activeSketchId: 'sketch-1' }, hosts: { shaper: shaper } });
const online = { cutType: 'online', cutDepth: 3, cutOffset: 0, toolDia: 3.175, cutterShape: 'endmill', cutterAngle: 90 };
const pocketRec = { cutType: 'pocket', cutDepth: 5, cutOffset: 0, toolDia: 3.175, cutterShape: 'endmill', cutterAngle: 90 };
const outsideRec = { cutType: 'exterior', cutDepth: 12, cutOffset: 0, toolDia: 3.175, cutterShape: 'endmill', cutterAngle: 90 };
const noticeOf = (app) => { const el = app.document.getElementById('prepare-notice'); return el && !el.hidden ? el.textContent : null; };
const profile = await createProfile();
{ // (a) an On line record on the closed bezier outline (a chain when it was saved) + a pocket elsewhere; the stored order puts the pocket first
  const rect = { r1: [200, 0], r2: [260, 0], r3: [260, 40], r4: [200, 40] };
  const shapes = [...outlineShapes(), line('R1', 'r1', 'r2'), line('R2', 'r2', 'r3'), line('R3', 'r3', 'r4'), line('R4', 'r4', 'r1')];
  const stored = [['loop:loop_R1-R2-R3-R4', pocketRec], ['chain:chain_B1-L1-L2-L3', online]];
  const order = [opKeyOf(pocketRec), opKeyOf(online)];
  await createNamedDesign(profile, 'shaper', 'Old chain 761', docOf({ ...OUTLINE, ...rect }, shapes, { version: 1, cutPlan: stored, stock: null, opOrder: order }));
  V2_PLAN.clear(); V2_PLAN.setOrder([]);
  const app = await open({ host: 'shaper', profile });
  try {
    eq([...V2_PLAN.keys()], ['loop:loop_R1-R2-R3-R4', 'loop:loop_B1-L1-L2-L3'], '4a: the chain record MOVED to the loop with the same shapes, in its place in the plan');
    eq(V2_PLAN.get('loop:loop_B1-L1-L2-L3'), online, '4a: same cut type and settings (On line)');
    const ops = describeOperations(app.state, planEntries());
    eq(ops.map((o) => [o.cutType, o.records.map((r) => r.planKey)]), [['pocket', ['loop:loop_R1-R2-R3-R4']], ['online', ['loop:loop_B1-L1-L2-L3']]], '4a: the Operations list keeps the stored order (pocket first), the On line operation now on the loop');
    const svg = shaperSvgOf(app.state, planEntries());
    ok(/shaper:cutType="online"[^>]*\/>|<g[^>]*shaper:cutType="online"/.test(svg) && svg.includes('C 70 90 30 90 0 50'), '4a: the export writes the On line cut WITH the curve (missing from the file before)');
    app.modes.showMode('prepare');
    eq(noticeOf(app), 'Cut plan updated: 1 cut was on an outline that is now a closed shape and was kept', '4a: the one-time notice, exact');
    // once: the reconciled plan reconciles to itself; a document saved after it opens without a notice
    eq(reconcileCutPlan(app.state), { edgeMoved: 0, edgeDropped: 0, kept: 0, removed: 0 }, '4a: a second reconciliation changes nothing');
    const before = JSON.stringify([...V2_PLAN]);
    eq(applyShaperDoc(captureShaperDoc(), app.state), { edgeMoved: 0, edgeDropped: 0, kept: 0, removed: 0, keptHoles: 0, lostHoles: 0 }, '4a: the saved plan opens with nothing to change (TASK 774: + the hole-rule counts)');
    eq(JSON.stringify([...V2_PLAN]), before, '4a: and the same plan');
  } finally { V2_PLAN.clear(); V2_PLAN.setOrder([]); await app.close(); }
}
{ // (b) the records with no exact match: a chain that is now a loop + a tail; a line loop a bezier now splits; the bezier's own old chain
  const j = { ...OUTLINE, t: [-30, -20], e1: [300, 0], e2: [400, 0], e3: [400, 50], e4: [300, 50], q1: [500, 0], q2: [520, 0], q3: [520, 20], q4: [500, 20] };
  const shapes = [...outlineShapes(), line('T1', 'a', 't'),
    line('E1', 'e1', 'e2'), line('E2', 'e2', 'e3'), line('E3', 'e3', 'e4'), line('E4', 'e4', 'e1'), bez('BX', 'e1', 'e3', [340, 0], [360, 50]),
    line('Q1', 'q1', 'q2'), line('Q2', 'q2', 'q3'), line('Q3', 'q3', 'q4'), line('Q4', 'q4', 'q1')];
  const stored = [['chain:chain_B1-L1-L2-L3-T1', online], ['loop:loop_E1-E2-E3-E4', outsideRec], ['chain:chain_BX', online], ['loop:loop_Q1-Q2-Q3-Q4', pocketRec], ['loop:loop_gone1-gone2', pocketRec]];
  await createNamedDesign(profile, 'shaper', 'Split 761', docOf(j, shapes, { version: 1, cutPlan: stored, stock: null, opOrder: [] }));
  V2_PLAN.clear(); V2_PLAN.setOrder([]);
  const app = await open({ host: 'shaper', profile });
  try {
    eq([...V2_PLAN.keys()], ['loop:loop_Q1-Q2-Q3-Q4', 'loop:loop_gone1-gone2'], '4b: the three records the new loops broke are REMOVED; the plain square kept; an unrelated stale record (its shapes are gone) left as before');
    app.modes.showMode('prepare');
    eq(noticeOf(app), 'Cut plan updated: 3 cuts no longer match a shape and were removed: assign them again', '4b: counted in the notice, exact');
  } finally { V2_PLAN.clear(); V2_PLAN.setOrder([]); await app.close(); }
}
{ // (c) a document without a bezier: its plan opens unchanged, no notice
  const stored = [['loop:loop_L1-L2-L3-L4', outsideRec], ['chain:chain_T1', online]];
  const j = { a: [0, 0], b: [100, 0], c: [100, 50], d: [0, 50], t1: [150, 0], t2: [180, 30] };
  await createNamedDesign(profile, 'shaper', 'No bezier 761', docOf(j, [line('L1', 'a', 'b'), line('L2', 'b', 'c'), line('L3', 'c', 'd'), line('L4', 'd', 'a'), line('T1', 't1', 't2')], { version: 1, cutPlan: stored, stock: null, opOrder: [] }));
  V2_PLAN.clear(); V2_PLAN.setOrder([]);
  const app = await open({ host: 'shaper', profile });
  try {
    eq([...V2_PLAN], stored, '4c: no bezier: the plan opens exactly as stored');
    app.modes.showMode('prepare');
    eq(noticeOf(app), null, '4c: no notice');
  } finally { V2_PLAN.clear(); V2_PLAN.setOrder([]); await app.close(); }
}
eq(cutPlanNotice({ edgeMoved: 1, edgeDropped: 2, kept: 0, removed: 0 }), 'Cut plan updated: 1 edge cut moved to chain, 2 dropped from closed loops', '4: the legacy edge notice keeps its words');
eq(cutPlanNotice({ edgeMoved: 0, edgeDropped: 0, kept: 2, removed: 1 }), 'Cut plan updated: 2 cuts were on outlines that are now closed shapes and were kept; 1 cut no longer matches a shape and was removed: assign it again', '4: the ruling\'s wording');

console.log(`bezier-loops-761-node: ${checks} checks passed`);
