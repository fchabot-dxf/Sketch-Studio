// tests/bezier-pick-762-node.test.js — TASK 762: a BEZIER body is picked by THE shared pick (#ui/snap-detection.js findSnap), from its geometry as
// #core/curve-kinds.js CURVE_KINDS declares it; lines, arcs and circles are picked exactly as before.
//  1. LINE / ARC / CIRCLE PICK UNCHANGED: a scene of lines, arcs (both windings), circles, free joints and the origin, at 4 zooms (0.2, 1, 5 and 78 px
//     per world unit) and both reaches (mouse, touch boost): findSnap at every point of a 4 px screen grid, hashed per zoom and reach, equals the
//     digest written on origin/main 09ecfb3 BEFORE this task (tests/fixtures/bezier-pick-762/pick-digest.json; `node tests/bezier-pick-762-node.test.js
//     --write-digest` rewrites it, only ever on the base).
//  2. THE BEZIER HIT: a bezier body is hit at its nearest curve point (within CURVE_TOLERANCE_MM of the exact cubic) at LINE_PX - 1 screen px from it,
//     inside or outside the curve, missed at LINE_PX + 1, hit at 2 x LINE_PX - 1 with the touch reach; never at its chord; at the same 4 zooms.
//  3. IN THE APP (tests/helpers/node-app.js: the app's own pointer listeners, ribbon and render loop), SketchStudio and Shaper:
//     a. Select: hover and a click on the body pick it; a body drag moves its two end joints AND its control points by the same vector; a double click
//        selects its chain (the two beziers the Bezier tool drew);
//     b. the Bezier tool CLOSES on its first anchor: the snap marker (state.snapTarget) is on the first anchor while the pointer is within the magnet;
//        the press there makes ONE coincident (the new joint, the first anchor) and ends the path; findLoops returns the loop of the 3 beziers; a
//        DRAGGED closing anchor is smooth (the first segment leaves along the closing handle), a clicked one a corner; a press outside the magnet
//        places an ordinary anchor;
//     c. every refused tool pressed on the body: the declared notice (#core/curve-kinds.js CURVE_REFUSALS), nothing changed, the tool kept; Mirror's
//        line step too; Offset says its own reason; the Line tool ending on the body: the point lands on the curve, no constraint, the point-on-curve notice;
//     d. Close path picked by the BODY of an open bezier chain closes it (findLoops: one loop).
import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { findSnap, snapBoostFor } from '#ui/snap-detection.js';
import { SNAP } from '#core/constants.js';
import { CURVE_TOLERANCE_MM, CURVE_REFUSALS } from '#core/curve-kinds.js';
import { findLoops } from '#core/loop-finder.js';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { setConstraintNotifier } from '#core/constraint-manager.js';
import { showNotification } from '#ui/notification-manager.js';

const DIGEST_FILE = path.resolve('tests/fixtures/bezier-pick-762/pick-digest.json');
const WRITE = process.argv.includes('--write-digest');
const ZOOMS = [0.2, 1, 5, 78];
// a canvas whose centre (500, 500) is the world origin at `ppu` px per world unit
const svgAt = (ppu) => { const w = 1000 / ppu; return { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }), viewBox: { baseVal: { x: -w / 2, y: -w / 2, width: w, height: w } } }; };

// ── 1. the line / arc / circle scene (screen px / ppu = world), deterministic ──
let seed = 762;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
function lineArcScene(ppu) {
  seed = 762;
  const joints = new Map([['j_origin', { x: 0, y: 0, fixed: true }]]);
  const shapes = [];
  let n = 0;
  const J = (px, py) => { const id = 'j' + (++n); joints.set(id, { x: px / ppu, y: py / ppu }); return id; };
  for (let i = 0; i < 14; i++) shapes.push({ id: 'l' + i, type: 'line', joints: [J(rnd() * 800 - 400, rnd() * 800 - 400), J(rnd() * 800 - 400, rnd() * 800 - 400)] });
  for (let i = 0; i < 8; i++) {
    const cx = rnd() * 700 - 350, cy = rnd() * 700 - 350, r = 30 + rnd() * 120, a0 = rnd() * 2 * Math.PI, a1 = a0 + 0.4 + rnd() * 4.5;
    shapes.push({ id: 'a' + i, type: 'arc', subType: 'CENTER', sweep: i % 2 === 0, joints: [J(cx, cy), J(cx + r * Math.cos(a0), cy + r * Math.sin(a0)), J(cx + r * Math.cos(a1), cy + r * Math.sin(a1))] });
  }
  for (let i = 0; i < 4; i++) shapes.push({ id: 'c' + i, type: 'circle', joints: [J(rnd() * 700 - 350, rnd() * 700 - 350)], radius: (20 + rnd() * 100) / ppu });
  for (let i = 0; i < 6; i++) J(rnd() * 800 - 400, rnd() * 800 - 400); // free points
  return { joints, shapes };
}
const fmt = (r) => (r ? `${r.type}:${r.targetId}:${Number(r.x).toPrecision(12)}:${Number(r.y).toPrecision(12)}` : '-');
function pickDigest() {
  const out = {};
  for (const ppu of ZOOMS) {
    const svg = svgAt(ppu), { joints, shapes } = lineArcScene(ppu);
    for (const touch of [false, true]) {
      const h = crypto.createHash('sha256'), counts = {};
      for (let y = 100; y <= 900; y += 4) for (let x = 100; x <= 900; x += 4) {
        const r = findSnap(joints, shapes, svg, { x, y }, [], false, false, snapBoostFor(touch));
        const k = r ? r.type : 'none'; counts[k] = (counts[k] || 0) + 1;
        h.update(fmt(r) + '\n');
      }
      out[`${ppu}px/${touch ? 'touch' : 'mouse'}`] = { hash: h.digest('hex').slice(0, 24), counts };
    }
  }
  return out;
}

const digest = pickDigest();
if (WRITE) {
  fs.mkdirSync(path.dirname(DIGEST_FILE), { recursive: true });
  fs.writeFileSync(DIGEST_FILE, JSON.stringify(digest, null, 1) + '\n');
  console.log('wrote ' + DIGEST_FILE);
} else {
  const want = JSON.parse(fs.readFileSync(DIGEST_FILE, 'utf8'));
  assert.deepStrictEqual(digest, want, '1: line / arc / circle picks identical to the digest written before task 762');
}
let checks = 1;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };

// ── 2. the bezier hit (screen px / ppu = world) ──
const cubic = (P, t) => { const u = 1 - t; const k = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]; return { x: k.reduce((a, w, i) => a + w * P[i].x, 0), y: k.reduce((a, w, i) => a + w * P[i].y, 0) }; };
for (const ppu of ZOOMS) {
  const svg = svgAt(ppu), W = (x, y) => ({ x: x / ppu, y: y / ppu });
  const P = [W(-300, 100), W(-300, -200), W(300, -200), W(300, 100)];
  const joints = new Map([['b0', P[0]], ['b1', P[3]]]);
  const shapes = [{ id: 'bz', type: 'bezier', joints: ['b0', 'b1'], c1: [P[1].x, P[1].y], c2: [P[2].x, P[2].y] }];
  const top = 500 - 125; // the curve at t = 0.5: screen (500, 375), its tangent horizontal
  const at = (x, y, touch = false) => findSnap(joints, shapes, svg, { x, y }, [], false, false, snapBoostFor(touch));
  // the distance from r to the exact cubic: the nearest of 4000 samples, refined by a ternary search around it
  const exact = (r) => {
    const D = (t) => { const q = cubic(P, t); return Math.hypot(q.x - r.x, q.y - r.y); };
    let bi = 0; for (let i = 1; i <= 4000; i++) if (D(i / 4000) < D(bi / 4000)) bi = i;
    let lo = Math.max(0, (bi - 1) / 4000), hi = Math.min(1, (bi + 1) / 4000);
    for (let k = 0; k < 100; k++) { const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3; if (D(m1) < D(m2)) hi = m2; else lo = m1; }
    return D((lo + hi) / 2);
  };
  for (const d of [-(SNAP.LINE_PX - 1), 0, SNAP.LINE_PX - 1]) {
    const r = at(500, top + d);
    ok(r && r.type === 'shape' && r.targetId === 'bz', `${ppu} px/unit: the body hit ${d} px from the curve (${d < 0 ? 'outside' : 'inside'})`);
    ok(Math.abs(r.dist - Math.abs(d)) < 0.5, `${ppu}: the hit's screen distance is the pointer's from the curve: ${r.dist} vs ${Math.abs(d)}`);
    ok(exact(r) <= CURVE_TOLERANCE_MM + 1e-6 / ppu, `${ppu}: the hit point is on the curve (within CURVE_TOLERANCE_MM): ${exact(r)}`);
  }
  ok(at(500, top - SNAP.LINE_PX - 1) === null && at(500, top + SNAP.LINE_PX + 1) === null, `${ppu}: missed at LINE_PX + 1 on both sides`);
  ok(at(500, top - 2 * SNAP.LINE_PX + 1, true)?.targetId === 'bz' && at(500, top - 2 * SNAP.LINE_PX - 1, true) === null, `${ppu}: the touch reach is 2 x LINE_PX`);
  ok(at(500, 600) === null, `${ppu}: the chord (screen y 600) is not the curve: nothing hit there`);
  const side = at(500 + 290, 500 + 40); // beside the curve near its right end, out of the end joint's reach
  ok(side && side.type === 'shape' && exact(side) <= CURVE_TOLERANCE_MM + 1e-6 / ppu, `${ppu}: a pointer beside the curve near its end hits the curve there: ${JSON.stringify(side && [side.type, side.dist])}`);
}

// ── 3. in the app ──
const profile = await createProfile();
await createNamedDesign(profile, 'sketchstudio', 'Bezier pick 762');
for (const host of ['sketchstudio', 'shaper']) {
  const app = await open({ host, profile });
  // SketchStudio's page script sets the constraint notices' notifier (apps/sketchstudio/main.js setConstraintNotifier(showNotification)); the kit
  // mounts the canvas without the page script, so the test makes that one call (Shaper's canvas, packages/ui/sketch-canvas.js, makes it itself)
  if (host === 'sketchstudio') setConstraintNotifier(showNotification);
  try {
    const st = app.state, doc = app.document;
    const toasts = () => [...doc.querySelectorAll('#notification-container [data-level]')].map((e) => e.textContent.replace(/^\W+/u, '').trim());
    const clearToasts = () => doc.querySelectorAll('#notification-container [data-level]').forEach((e) => e.remove());
    const r = app.svg.getBoundingClientRect(), C = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    // the view: 4 to 8 px per mm
    for (let i = 0; i < 30 && app.toScreen(1, 0).x - app.toScreen(0, 0).x < 4; i++) app.wheel(C.x, C.y, -300);
    for (let i = 0; i < 30 && app.toScreen(1, 0).x - app.toScreen(0, 0).x > 8; i++) app.wheel(C.x, C.y, 300);
    const S = (x, y) => app.toScreen(x, y);
    const scene = () => {
      app.esc(); app.esc(); st.clearDocument(); st.selectedShapes.clear(); st.selectedJoints.clear(); clearToasts();
      const J = (id, x, y) => st.joints.set(id, { x, y, fixed: false });
      J('jl1', -60, 0); J('jl2', -20, 0); st.shapes.push({ id: 'L', type: 'line', joints: ['jl1', 'jl2'] });
      J('jb0', 0, 0); J('jb1', 30, 0); J('jb2', 60, 0);
      st.shapes.push({ id: 'B1', type: 'bezier', joints: ['jb0', 'jb1'], c1: [0, -25], c2: [30, -25], groupId: 'bz' });
      st.shapes.push({ id: 'B2', type: 'bezier', joints: ['jb1', 'jb2'], c1: [30, 25], c2: [60, 25], groupId: 'bz' });
      st.saveState('scene 762'); app.tool('select');
    };
    const BODY = () => S(15, -18.75); // B1 at t = 0.5
    const snap = () => JSON.stringify([[...st.joints].map(([k, j]) => [k, +j.x.toFixed(6), +j.y.toFixed(6)]), st.shapes.map((s) => [s.id, s.c1, s.c2]), st.constraints.map((c) => c.type)]);

    // a. Select
    scene(); const b = BODY(); app.move(b.x, b.y);
    ok(st.hoveredShape === 'B1', `${host} a: hover on the body lights B1: ${st.hoveredShape}`);
    app.click(b.x, b.y);
    ok(JSON.stringify([...st.selectedShapes]) === '["B1"]', `${host} a: a click on the body selects B1: ${[...st.selectedShapes]}`);
    scene();
    const B1a = st.shapes.find((s) => s.id === 'B1');
    const g0 = { a: { ...st.joints.get('jb0') }, b: { ...st.joints.get('jb1') }, c1: [...B1a.c1], c2: [...B1a.c2] };
    app.drag(BODY(), { x: BODY().x + 40, y: BODY().y + 30 }, 10);
    const B1 = st.shapes.find((s) => s.id === 'B1'), va = [st.joints.get('jb0').x - g0.a.x, st.joints.get('jb0').y - g0.a.y];
    const moved = [[st.joints.get('jb1').x - g0.b.x, st.joints.get('jb1').y - g0.b.y], [B1.c1[0] - g0.c1[0], B1.c1[1] - g0.c1[1]], [B1.c2[0] - g0.c2[0], B1.c2[1] - g0.c2[1]]];
    ok(Math.hypot(...va) > 3, `${host} a: the body drag moved the curve: ${va}`);
    ok(moved.every((v) => Math.hypot(v[0] - va[0], v[1] - va[1]) < 1e-6), `${host} a: both ends and both control points moved by the same vector: ${JSON.stringify([va, ...moved])}`);
    scene(); app.dblclick(BODY().x, BODY().y);
    ok(JSON.stringify([...st.selectedShapes].sort()) === '["B1","B2"]', `${host} a: a double click selects the chain: ${[...st.selectedShapes]}`);

    // b. the Bezier tool closes on its first anchor
    for (const smooth of [false, true]) {
      scene(); st.clearDocument(); st.saveState('clear'); app.tool('bezier');
      const A = S(10, 10), B = S(70, 10), Cc = S(40, -30); // TASK 872: off the Y axis (an anchor ON the axis now gets its point-on-line)
      app.click(A.x, A.y); app.click(B.x, B.y); app.drag(Cc, { x: Cc.x - 50, y: Cc.y }, 6);
      const first = st.shapes[0].joints[0];
      app.move(A.x + 5, A.y - 4);
      ok(st.snapTarget && st.snapTarget.type === 'joint' && st.snapTarget.targetId === first, `${host} b: the snap marker is on the first anchor: ${JSON.stringify(st.snapTarget && [st.snapTarget.type, st.snapTarget.targetId])}`);
      if (smooth) app.drag({ x: A.x + 5, y: A.y - 4 }, { x: A.x + 5 - 40, y: A.y - 4 }, 6); else app.click(A.x + 5, A.y - 4);
      ok(st.shapes.length === 3 && st.shapes.every((s) => s.type === 'bezier'), `${host} b: three beziers: ${st.shapes.map((s) => s.type)}`);
      ok(JSON.stringify(st.constraints.map((c) => c.type)) === '["coincident"]', `${host} b: ONE coincident: ${st.constraints.map((c) => c.type)}`);
      const last = st.shapes[2], k = st.constraints[0];
      ok(k.joints.includes(first) && k.joints.includes(last.joints[1]), `${host} b: the coincident ties the closing joint to the first anchor: ${k.joints}`);
      const pa = st.joints.get(first), pz = st.joints.get(last.joints[1]);
      ok(Math.hypot(pa.x - pz.x, pa.y - pz.y) < 1e-6, `${host} b: the closing joint is on the first anchor`);
      ok(!st.active, `${host} b: the path ended`);
      const loops = findLoops(st);
      ok(loops.length === 1 && loops[0].edges.length === 3, `${host} b: findLoops returns the loop of the three beziers: ${JSON.stringify(loops.map((l) => l.edges))}`);
      const u = [last.c2[0] - pa.x, last.c2[1] - pa.y], v = [st.shapes[0].c1[0] - pa.x, st.shapes[0].c1[1] - pa.y];
      if (smooth) ok(Math.abs(u[0] * v[1] - u[1] * v[0]) < 1e-6 * Math.hypot(...u) * Math.hypot(...v) && u[0] * v[0] + u[1] * v[1] < 0, `${host} b: a dragged closing anchor is smooth: ${JSON.stringify([u, v])}`);
      else ok(Math.hypot(...u) < 1e-9, `${host} b: a clicked closing anchor is a corner (its incoming handle on the point): ${u}`);
    }
    // a press OUTSIDE the magnet is an ordinary anchor
    scene(); st.clearDocument(); st.saveState('clear'); app.tool('bezier');
    {
      const A = S(10, 10), B = S(70, 10), Cc = S(40, -30); // TASK 872: off the Y axis (an anchor ON the axis now gets its point-on-line)
      app.click(A.x, A.y); app.click(B.x, B.y); app.click(Cc.x, Cc.y); app.click(A.x + 16, A.y);
      ok(st.constraints.length === 0 && st.shapes.length === 3 && !!st.active, `${host} b: 16 px off the first anchor: an ordinary anchor, the path goes on`);
      app.enter();
    }

    // c. the refusals
    for (const [tool, msg] of Object.entries(CURVE_REFUSALS.bezier)) {
      if (tool.includes(':') || tool === 'pointOnCurve') continue;
      scene(); app.tool(tool); clearToasts(); const before = snap(); app.click(BODY().x, BODY().y);
      ok(toasts().some((t) => t.includes(msg)), `${host} c: ${tool} on the body says: ${msg} (got ${JSON.stringify(toasts())})`);
      ok(snap() === before && st.currentTool === tool, `${host} c: ${tool}: nothing changed, the tool kept (${st.currentTool})`);
    }
    scene(); app.click(S(-40, 0).x, S(-40, 0).y); app.tool('mirror'); clearToasts(); app.click(BODY().x, BODY().y);
    ok(toasts().some((t) => t.includes(CURVE_REFUSALS.bezier['mirror:line'])), `${host} c: Mirror's line step on the body: ${JSON.stringify(toasts())}`);
    scene(); app.tool('offset'); clearToasts(); app.click(BODY().x, BODY().y);
    ok(toasts().some((t) => t.includes('a bezier cannot be offset')), `${host} c: Offset on the body says its own reason: ${JSON.stringify(toasts())}`);
    scene(); app.tool('line'); clearToasts(); app.click(S(15, 20).x, S(15, 20).y); const nC = st.constraints.length; app.click(BODY().x, BODY().y);
    const ln = st.shapes.filter((s) => s.type === 'line').pop(), end = st.joints.get(ln.joints[1]);
    ok(Math.hypot(end.x - 15, end.y + 18.75) < 0.5, `${host} c: the line's end lands on the curve: ${end.x}, ${end.y}`);
    ok(!st.constraints.slice(nC).some((c) => c.type === 'pointOnLine'), `${host} c: no point-on-line on the bezier: ${st.constraints.slice(nC).map((c) => c.type)}`);
    ok(toasts().some((t) => t.includes(CURVE_REFUSALS.bezier.pointOnCurve)), `${host} c: the point-on-curve notice: ${JSON.stringify(toasts())}`);
    app.esc(); app.esc();

    // d. Close path by the body
    // (B2 turned to end at (30, 20) bulging right, so the closing line (30, 20) - (0, 0) crosses neither curve)
    scene(); { const B2 = st.shapes.find((s) => s.id === 'B2'); st.joints.set('jb2', { x: 30, y: 20, fixed: false }); B2.c1 = [40, 5]; B2.c2 = [40, 15]; st.saveState('d'); }
    app.tool('closePath'); app.click(BODY().x, BODY().y);
    ok(findLoops(st).some((l) => l.edges.includes('B1') && l.edges.includes('B2')), `${host} d: Close path on B1's body closed the chain: ${JSON.stringify(findLoops(st).map((l) => l.edges))}`);
  } finally { await app.close(); }
}
console.log(`bezier-pick-762-node: ALL CHECKS PASSED (${checks} checks)`);
