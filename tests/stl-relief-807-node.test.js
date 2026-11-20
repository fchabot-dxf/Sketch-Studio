// tests/stl-relief-807-node.test.js — TASK 807: an STL is a RELIEF (owner turns 2631-2640). Every mesh is BUILT IN THE TEST (never the owner's files).
//  1. THE GREEN MAN'S SPIKES. The owner's Green Man showed spiky stray lines along its edge. Their cause, in the plane slicer of TASK 790: a mesh edge
//     lying exactly ON a section plane whose two triangles are both above it (the relief's low skirt, a micron over the plate face, touches the plate
//     along a long edge) gave the same segment twice; chained end point to end point, the loop ran out along the edge and back (a 6 mm spike there),
//     or two loops shared it. The mesh here is a cut-down piece of the Green Man around one spike: its triangles 312885 and 380717 (the shared edge
//     B-D on the plate face at z 4.041001797, their third points A 1.744e-3 mm and C 3.939e-4 mm above it: the file's own coordinates) set into a
//     closed 20 mm plate whose flat top is that face (the rest of the top: earcut round the quad A-B-C-D). On the plane slicer (origin/main bd2dbd6)
//     this test FAILED: the plate-face section was 2 loops sharing the edge B-D. TASK 807 (owner turn 2640) replaced the plane slicer by the HEIGHT
//     MAP (#core/height-map.js meshHeightGrid + gridContours): every level of the piece is one clean closed loop.
//  2. DEFECTS: a boss on a plate, clean and with deliberate defects (a crack between two halves of the plate's top: their points 0.004 mm apart, a
//     needle sliver standing on the top, a degenerate triangle, every boss face twice, a face inside the plate): the SAME levels and work area; the
//     face inside the part is the one thing the top cannot see (the warning).
//  3. GEOMETRY: the 10-degree drafted pocket (60 x 40 x 8 in a 120 x 80 x 19 block): each level's pocket opening is the top opening inset by
//     depth x tan 10 within the grid's tolerance (a cell + the simplification); the block's outline within half a cell; the 45-degree wall too.
//  4. THE PAYLOAD: ONE region (Relief, Roughing, depth = the height, the work area = the silhouette, no holes); upside down the pocket is out of the
//     top's reach: one warning with its area (2400 mm²); the dovetail's overhang (700 mm²).
//  5. THE APP (tests/helpers/node-app.js): Open STL -> ONE Roughing record (Terraces) with the levels, the notice, the STL card (Up, Units, Size: no
//     other row), one operation, the export (pocket paths); a design saved with an STL before 807 (no `relief` mark, per-feature records) is sliced
//     again as a relief when it is opened.
import assert from 'node:assert';
import earcut from '../packages/core/plot/vendor/earcut.js';
import { sliceStl, STL_SLICE } from '#core/stl-slice.js';
import { MESH_GRID } from '#core/height-map.js';
import SettingsManager from '#core/settings-manager.js';
import * as M from './helpers/stl-mesh.js';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { worldToScreen } from '#ui/coords.js';
import { planEntries } from '../apps/shaper/src/cut-plan.js';
import { getStock } from '../apps/shaper/src/stock.js';
import { getStlSource } from '../apps/shaper/src/stl-source.js';
import { shaperSvgOf } from '../apps/shaper/src/export-payload.js';
import { describeOperations } from '../apps/shaper/src/operations.js';
import { V2_PLAN } from './helpers/plan-v2.js'; // TASK S1: the test's v2 document of the plan, loaded through applyShaperDoc

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b} (tol ${tol})`); checks++; };
SettingsManager.set('DOC_UNIT', 'mm');

const slice = (tris, opts = {}) => { const r = sliceStl(tris, { name: 'part.stl', ...opts }); assert.ok(r.ok, r.message); return r; };
const loopPts = (loop) => loop.segments.map((s) => [s.x1, s.y1]);
// a loop is CLEAN: its segments follow each other end to start and close, no point visited twice, no turn back on itself (a zero-width spike)
function defectsOf(loop) {
  const found = [], segs = loop.segments, pts = loopPts(loop), seen = new Set();
  segs.forEach((s, i) => { const n = segs[(i + 1) % segs.length]; if (s.x2 !== n.x1 || s.y2 !== n.y1) found.push(`segment ${i} does not meet the next`); });
  pts.forEach((p, i) => {
    const k = p[0] + ',' + p[1];
    if (seen.has(k)) found.push(`point ${k} visited twice`);
    seen.add(k);
    const a = pts[(i - 1 + pts.length) % pts.length], c = pts[(i + 1) % pts.length];
    const ux = a[0] - p[0], uy = a[1] - p[1], vx = c[0] - p[0], vy = c[1] - p[1], lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
    if (lu > 0 && lv > 0 && (ux * vx + uy * vy) / (lu * lv) > 0.999) found.push(`turns back at ${k}`);
  });
  return found;
}
const allDefects = (payload) => payload.regions[0].levels.flatMap((l) => l.loops.flatMap((L) => defectsOf(L).map((d) => `${l.zFromTopMm} mm: ${d}`)));
// the farthest a point of A is from the polygon B (closed, [[x, y]...])
const segDist = (p, a, b) => { const vx = b[0] - a[0], vy = b[1] - a[1], L = vx * vx + vy * vy; let t = L ? ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(p[0] - a[0] - t * vx, p[1] - a[1] - t * vy); };
const toPoly = (p, B) => Math.min(...B.map((b, i) => segDist(p, b, B[(i + 1) % B.length])));
const apart = (A, B) => Math.max(Math.max(...A.map((p) => toPoly(p, B))), Math.max(...B.map((p) => toPoly(p, A))));
const area = (pts) => { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1]; return a / 2; };

// ── 1. the Green Man piece ──
function greenManSpikePiece() {
  const zf = 4.041001797; // the plate face (the file's flat face)
  const A = [112.6502, 103.2488, zf + 1.744e-3], B = [114.9866, 109.1233, zf], C = [111.6489, 105.5630, zf + 3.939e-4], D = [112.1495, 103.4268, zf];
  const x0 = 103, y0 = 96, x1 = 123, y1 = 116; // the plate around them (20 x 20, its bottom at z 0)
  const out = [];
  const tri = (a, b, c) => out.push(...a, ...b, ...c);
  const outer = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const quad = [A, B, C, D];
  const flat = [...outer.flat(), ...quad.flatMap((p) => [p[0], p[1]])];
  const at = (i) => (i < 4 ? [outer[i][0], outer[i][1], zf] : quad[i - 4]);
  const t = earcut(flat, [4]);
  for (let k = 0; k < t.length; k += 3) tri(at(t[k]), at(t[k + 1]), at(t[k + 2])); // the top around the quad (near-flat where it meets A or C)
  tri(A, B, D); tri(C, D, B); // the two Green Man triangles: their shared edge B-D lies ON the plate face, both above it
  for (let i = 0; i < 4; i++) { // the walls and the bottom
    const p = outer[i], q = outer[(i + 1) % 4];
    tri([p[0], p[1], zf], [p[0], p[1], 0], [q[0], q[1], 0]); tri([p[0], p[1], zf], [q[0], q[1], 0], [q[0], q[1], zf]);
  }
  tri([x0, y0, 0], [x1, y1, 0], [x1, y0, 0]); tri([x0, y0, 0], [x0, y1, 0], [x1, y1, 0]);
  return new Float32Array(out);
}
{
  const r = slice(greenManSpikePiece(), { name: 'greenman-piece.stl' });
  const reg = r.payload.regions[0];
  eq(allDefects(r.payload), [], 'the Green Man piece: every level clean (closed, no point twice, no spike)');
  ok(reg.levels.length >= 16 && reg.levels.every((l) => l.loops.length === 1), `every level is ONE loop: the plate (${reg.levels.length} levels)`);
  const square = [[0, 0], [20, 0], [20, 20], [0, 20]];
  for (const l of reg.levels) ok(apart(loopPts(l.loops[0]), square) <= MESH_GRID.cellMm, `${l.zFromTopMm} mm: the plate's 20 x 20 square within a cell`);
  eq(r.payload.warnings, [], 'nothing out of the top\'s reach');
}

// ── 2. defects ──
const bossPlate = () => M.lofted({ outer: [{ z: 10, pts: M.rect(15, 10, 25, 20) }, { z: 6, pts: M.rect(15, 10, 25, 20) }, { z: 6, pts: M.rect(0, 0, 40, 30) }, { z: 0, pts: M.rect(0, 0, 40, 30) }] });
{
  const clean = bossPlate();
  const ref = slice(clean).payload;
  eq(allDefects(ref), [], 'the clean boss plate: clean levels');
  // the defects
  const tris = [];
  const isPlateTop = (o) => clean[o + 2] === 6 && clean[o + 5] === 6 && clean[o + 8] === 6;
  for (let o = 0; o < clean.length; o += 9) if (!isPlateTop(o)) tris.push(...clean.subarray(o, o + 9));
  // the plate's top (the ring round the boss at z 6) re-made in two halves split at x = 30.03 / 30.034 (a crack of 0.004 mm: points that should be
  // one, apart): the left half round the boss, the right half a rectangle
  const left = earcut([0, 0, 30.03, 0, 30.03, 30, 0, 30, 15, 10, 15, 20, 25, 20, 25, 10], [4]), lp = [[0, 0], [30.03, 0], [30.03, 30], [0, 30], [15, 10], [15, 20], [25, 20], [25, 10]];
  for (let k = 0; k < left.length; k += 3) for (const i of [left[k], left[k + 1], left[k + 2]]) tris.push(lp[i][0], lp[i][1], 6);
  tris.push(30.034, 0, 6, 40, 0, 6, 40, 30, 6, 30.034, 0, 6, 40, 30, 6, 30.034, 30, 6);
  tris.push(5, 5, 6, 5.001, 5, 6, 5.0005, 5, 8); // a needle sliver standing 2 mm on the top
  tris.push(2, 2, 6, 4, 4, 6, 6, 6, 6); // a degenerate triangle (its points on one line)
  for (let o = 0; o < clean.length; o += 9) if (clean[o + 2] >= 6 && clean[o + 5] >= 6 && clean[o + 8] >= 6 && !isPlateTop(o)) tris.push(...clean.subarray(o, o + 9)); // every boss face twice
  const withInner = [...tris, 1, 1, 3, 39, 1, 3, 20, 29, 3]; // a face inside the plate
  for (const [name, mesh] of [['crack + sliver + degenerate + doubled faces', tris], ['+ a face inside the part', withInner]]) {
    const P = slice(new Float32Array(mesh)).payload;
    eq(allDefects(P), [], `${name}: clean levels`);
    eq(P.regions[0].levels, ref.regions[0].levels, `${name}: the same levels as the clean mesh`);
    eq(P.regions[0].outer, ref.regions[0].outer, `${name}: the same work area`);
  }
  eq(slice(new Float32Array(tris)).payload.warnings, [], 'the crack, the sliver, the doubled faces: no warning');
  ok(/^\d+(\.\d)? mm² of the part is out of the top's reach/.test(slice(new Float32Array(withInner)).payload.warnings.join('')), 'the face inside the part: the one warning (something under the top)');
}

// ── 3. geometry ──
{
  const TAN = Math.tan((10 * Math.PI) / 180), tol = MESH_GRID.cellMm + STL_SLICE.simplifyMm;
  const P = slice(M.draftedPocket(10), { name: 'drafted.stl' }).payload;
  const reg = P.regions[0];
  let worst = 0, n = 0;
  for (const l of reg.levels) {
    const d = l.zFromTopMm;
    const outers = l.loops.filter((L) => area(loopPts(L)) > 0), holes = l.loops.filter((L) => area(loopPts(L)) < 0);
    eq(outers.length, 1, `${d} mm: one outer loop (the block)`);
    worst = Math.max(worst, apart(loopPts(outers[0]), M.rect(0, 0, 120, 80)));
    if (d > 0.01 && d < 8 - 0.01) { // the pocket: open at this level, inset by (d - zSnap) tan 10 (the level is zSnap above its height)
      eq(holes.length, 1, `${d} mm: one hole (the pocket)`);
      const t = (d - STL_SLICE.zSnapMm) * TAN;
      const e = apart(loopPts(holes[0]), M.rect(30 + t, 20 + t, 90 - t, 60 - t));
      ok(e <= tol, `${d} mm: the pocket opening inset ${t.toFixed(3)} mm within ${tol} mm (${e.toFixed(3)})`);
      n++;
    } else if (d > 8) eq(holes.length, 0, `${d} mm: below the floor, no hole`);
  }
  ok(worst <= MESH_GRID.cellMm / 2 * Math.SQRT2 + 1e-9, `the block's outline within half a cell's diagonal at every level (worst ${worst.toFixed(4)})`);
  ok(n >= 30, `the pocket checked at ${n} levels`);
  // the 45-degree wall (interpolated: within the simplification of the true inset)
  const Q = slice(M.draftedPocket(45)).payload.regions[0];
  let w45 = 0;
  for (const l of Q.levels.filter((x) => x.zFromTopMm > 0.5 && x.zFromTopMm < 7.5)) {
    const t = l.zFromTopMm - STL_SLICE.zSnapMm, hole = l.loops.find((L) => area(loopPts(L)) < 0);
    w45 = Math.max(w45, apart(loopPts(hole), M.rect(30 + t, 20 + t, 90 - t, 60 - t)));
  }
  ok(w45 <= tol, `45 degrees: every opening within ${tol} mm (worst ${w45.toFixed(3)})`);
  console.log(`drafted 10: block outline worst ${worst.toFixed(4)} mm; 45 degrees worst ${w45.toFixed(4)} mm`);
}

// ── 4. the payload ──
{
  const r = slice(M.blockPocketHole(), { name: 'block.stl' });
  const P = r.payload;
  eq(P.regions.length, 1, 'ONE region');
  const g = P.regions[0];
  eq([g.label, g.cutType, g.depthMm, g.through, g.holes, P.stock], ['Relief', 'roughing', 19, true, [], { thicknessMm: 19 }], 'the relief: Roughing, the height, through, no holes; the stock = the height');
  ok(apart(loopPts(g.outer), M.rect(0, 0, 120, 80)) <= MESH_GRID.cellMm, 'the work area = the silhouette (the 120 x 80 block) within a cell');
  eq(P.warnings, [], 'nothing hidden: no warning');
  ok(r.info.grid.cols === 1200 && r.info.grid.rows === 800 && r.info.grid.cellMm === 0.1, 'the grid: 1200 x 800 nodes, 0.1 mm: ' + JSON.stringify(r.info.grid));
  eq(slice(M.blockPocketHole(), { up: '-Z' }).payload.warnings, ['2400 mm² of the part is out of the top\'s reach (an overhang, a hollow, a recess under it): the wood there is left'], 'upside down: the 60 x 40 pocket is under the part');
  eq(slice(M.dovetailPocket()).payload.warnings, ['700 mm² of the part is out of the top\'s reach (an overhang, a hollow, a recess under it): the wood there is left'], 'the dovetail: its overhang (50 x 30 - 40 x 20)');
  // several separate pieces seen from above: the work area is the rectangle round them
  const two = new Float32Array([...M.lofted({ outer: [{ z: 5, pts: M.rect(0, 0, 10, 10) }, { z: 0, pts: M.rect(0, 0, 10, 10) }] }), ...M.lofted({ outer: [{ z: 5, pts: M.rect(20, 0, 30, 10) }, { z: 0, pts: M.rect(20, 0, 30, 10) }] })]);
  eq(loopPts(slice(two).payload.regions[0].outer), [[0, 0], [30, 0], [30, 10], [0, 10]], 'two separate parts: the work area is their bounds');
}

// ── 5. the app ──
const harness = (app) => {
  const doc = app.document, q = (s) => doc.querySelector(s);
  const pressEl = (s) => { const e = q(s); assert(e, s + ' not found'); app.press(e); };
  const pc = doc.getElementById('prepare-canvas');
  const clickAt = (x, y) => { const p = worldToScreen(pc, { x, y }); app.click(Math.round(p.x), Math.round(p.y), { target: pc }); };
  return { q, pressEl, clickAt };
};
const plan = () => [...V2_PLAN.values()].map((r) => `${r.cutType}@${r.cutDepth}`);
{
  V2_PLAN.clear();
  const profile = await createProfile();
  await createNamedDesign(profile, 'shaper', 'Relief 807');
  let saved = null;
  {
    const app = await open({ host: 'shaper', profile });
    try {
      const h = harness(app);
      const res = app.stl.openFile(M.binaryStl(M.blockPocketHole()), 'block.stl');
      const n = res.info.sections;
      eq([res.ok, res.message], [true, `Added block.stl: a relief, ${n} levels`], 'Open STL: the notice');
      eq(app.document.getElementById('prepare-notice').textContent, `Added block.stl: a relief, ${n} levels`, "Prepare's notice");
      eq(plan(), ['roughing@19'], 'ONE record: Roughing to the full height');
      const rec = [...V2_PLAN.values()][0];
      ok(Array.isArray(rec.levels) && rec.levels.length === n, 'it carries the levels');
      eq(getStock().thickness, 19, 'the stock = the height');
      eq([...app.document.querySelectorAll('.stl-card .cut-field-label')].map((b) => b.textContent), ['Up', 'Units', 'Size'], 'the STL card: Up, Units, Size (no Import as)');
      h.clickAt(1, -1);
      eq(h.q('.cut-type-cur').textContent, 'Roughing', 'its card: Roughing');
      eq(h.q('.cut-layout-modes .is-active').textContent, 'Terraces', 'Layout: Terraces');
      const ops = describeOperations(app.state, planEntries());
      eq(ops.length, 1, 'the Operations list: one operation');
      const svg = shaperSvgOf(app.state, planEntries());
      const paths = (svg.match(/<path /g) || []).length;
      ok(paths >= 2 && /shaper:cutType="pocket"/.test(svg), `the Shaper SVG: ${paths} pocket paths`);
      saved = await app.storedDoc();
      eq(saved.hosts.shaper.stl.relief, true, 'the document marks its STL as a relief');
    } finally { await app.close(); }
  }
  {
    // a design saved with an STL before 807: no relief mark, the per-feature records -> sliced again as a relief when opened
    const old = JSON.parse(JSON.stringify(saved));
    delete old.hosts.shaper.stl.relief;
    const [key] = old.hosts.shaper.cutPlan[0];
    old.hosts.shaper.cutPlan = [[key, { cutType: 'exterior', cutDepth: 19, cutOffset: 0, toolDia: 3.175, cutterShape: 'endmill', cutterAngle: 90 }]];
    V2_PLAN.clear();
    const p2 = await createProfile();
    await createNamedDesign(p2, 'shaper', 'Old STL', old);
    const app = await open({ host: 'shaper', profile: p2 });
    try {
      app.modes.showMode('design');
      eq(plan(), ['roughing@19'], 'an STL design from before 807 opens as the relief (Roughing)');
      ok([...V2_PLAN.values()][0].levels.length > 70, 'with its levels');
      eq(getStlSource().old, undefined, 'its STL source is a relief now (the stored file is rewritten at the next change: the re-import is part of opening it)');
    } finally { await app.close(); }
  }
}

console.log(`stl-relief-807-node: ${checks} checks passed`);
