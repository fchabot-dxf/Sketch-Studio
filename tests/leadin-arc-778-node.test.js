// tests/leadin-arc-778-node.test.js — TASK 778: Tangential ARC lead-in (On line outlines), calculated defaults (2b), draggable leadInAt (8),
// 775 migration, and Pocket Start Mark + removal of pocketLeg (7).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { worldToScreen } from '#ui/coords.js';
import SettingsManager from '#core/settings-manager.js';
import { exportShaperSVG } from '#core/shaper-export.js';
import { findLoops } from '#core/loop-finder.js';
import { loopPolygon } from '#core/loop-geometry.js';
import { loopWalk } from '#core/hold-part.js';
import { deriveCuts } from '#core/stepped-cut.js';
import { deriveProfileCuts } from '#core/profile-model.js';
import { buildRelief } from '#core/relief-model.js';
import { LEAD_IN, outlineArc, outlineJunction, leadInDragAt, migrateLeadInRecord } from '#core/lead-in.js';
import { POCKET_CLEARING, planClearing, clearingSettings, pocketRings } from '#core/pocket-clearing.js';
import { planEntries, keyOf, planReliefItems } from '../apps/shaper/src/cut-plan.js';
import { exportEncoding } from '../apps/shaper/src/shaper.js';
import { shaperSvgOf } from '../apps/shaper/src/export-payload.js';
import { PARAM_HINTS } from '../apps/shaper/src/param-hints.js';
import { V2_PLAN } from './helpers/plan-v2.js'; // TASK S1: the test's v2 document of the plan, loaded through applyShaperDoc


let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b} (tol ${tol})`); checks++; };

function polyState(loops, circles = []) {
  const joints = new Map(), shapes = [];
  loops.forEach((pts, li) => pts.forEach((p, i) => {
    joints.set(`j${li}_${i}`, { x: p[0], y: p[1] });
    shapes.push({ id: `s${li}_${i}`, type: 'line', joints: [`j${li}_${i}`, `j${li}_${(i + 1) % pts.length}`] });
  }));
  for (const [id, c, r] of circles) { joints.set(id + 'o', { x: c[0], y: c[1] }); shapes.push({ id, type: 'circle', joints: [id + 'o'], radius: r }); }
  return { joints, shapes, constraints: [], groups: [], profiles: [] };
}
const area = (p) => { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j].x * p[i].y - p[i].x * p[j].y; return a / 2; };
const polysOf = (st) => { const by = new Map(st.shapes.map((s) => [s.id, s])); const lp = {}; for (const l of findLoops(st)) lp[l.id] = loopPolygon(l, st, by); return lp; };
const outerOf = (st) => { const loops = findLoops(st), lp = polysOf(st); return loops.reduce((a, l) => (Math.abs(area(lp[l.id])) > Math.abs(area(lp[a.id])) ? l : a), loops[0]); };
const exportOf = (st, rec, options = {}) => exportShaperSVG({ state: st, entries: [{ target: { kind: 'loop', id: outerOf(st).id }, rec }], encoding: exportEncoding(), docUnit: 'mm', options, loopPolys: polysOf(st) });
const cutsOf = (st, rec) => deriveCuts({ kind: 'loop', id: outerOf(st).id }, rec, st, findLoops(st), polysOf(st), new Set());
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const distSeg = (p, a, b) => { const vx = b.x - a.x, vy = b.y - a.y, L = vx * vx + vy * vy; const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / L)) : 0; return Math.hypot(p.x - a.x - t * vx, p.y - a.y - t * vy); };
const distPoly = (p, pts, closed) => { let m = Infinity; const n = closed ? pts.length : pts.length - 1; for (let i = 0; i < n; i++) m = Math.min(m, distSeg(p, pts[i], pts[(i + 1) % pts.length])); return m; };
const inPoly = (p, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c; } return c; };
const XY = (a) => a.map(([x, y]) => ({ x, y }));
function elementsOf(svg) {
  const attrs = (s) => Object.fromEntries([...s.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  const out = []; let group = null;
  for (const line of svg.split('\n').map((l) => l.trim())) {
    if (line.startsWith('<g')) throw new Error('TASK 802: the export has a <g>, every element must carry its own cut attributes: ' + line);
    if (line.startsWith('</g')) { group = null; continue; }
    const m = /^<(path|circle|polygon)\s(.*)\/>$/.exec(line);
    if (!m) continue;
    const a = { ...(group || {}), ...attrs(m[2]) };
    out.push({ tag: m[1], cutType: a['shaper:cutType'], depth: a['shaper:cutDepth'], d: a.d || null, a });
  }
  return out;
}
function parseCmds(d) {
  const tok = d.trim().split(/\s+/), out = [];
  for (let i = 0; i < tok.length;) {
    const c = tok[i++];
    if (c === 'Z') { out.push({ c }); continue; }
    const n = c === 'A' ? 7 : c === 'C' ? 6 : 2;
    out.push({ c, v: tok.slice(i, i + n).map(Number) }); i += n;
  }
  return out;
}

const RECT = [[0, 0], [100, 0], [100, 60], [0, 60]];
const IN1 = [[0, 0], [25.4, 0], [25.4, 25.4], [0, 25.4]]; // 1 in square
const ISLAND = [[40, 20], [60, 20], [60, 40], [40, 40]];
const DUMBBELL = [[0, 0], [40, 0], [40, 18], [60, 18], [60, 0], [100, 0], [100, 40], [60, 40], [60, 22], [40, 22], [40, 40], [0, 40]];
const ONLINE = (more = {}) => ({ cutType: 'online', cutDepth: 3.175, cutOffset: 0, toolDia: 3.175, ...more });
const POCKET = (more = {}) => ({ cutType: 'pocket', cutDepth: 6, cutOffset: 0, toolDia: 6, stepover: 40, finishAllowance: 0.5, rasterAngle: 0, ...more });

// ── 1. Tangential ARC geometry: tangent (1e-6), side, exact radius (0.01 mm), sweep 15 / 45 / 90 / 180, Length 0 & > 0 ──
{
  const rect = polyState([RECT]), circ = polyState([], [['c', [50, 50], 30]]);
  for (const [label, st] of [['rectangle', rect], ['circle', circ]]) {
    const w = loopWalk(outerOf(st), st);
    for (const side of ['outside', 'inside']) {
      for (const sweep of [15, 45, 90, 180]) {
        for (const length of [0, 5]) {
          const R = 6.35;
          const res = outlineArc(w, { radius: R, sweep, length, side, r: 1.5875, toolDia: 3.175 });
          eq(res.error, undefined, `${label} ${side} sw=${sweep} L=${length}: fits`);
          // Exact radius of every arc point from center C
          const arcPts = length > 0 ? res.points.filter((p) => dist(p, res.center) > 0 && Math.abs(dist(p, res.center) - R) < 0.01) : res.points;
          ok(arcPts.length >= 8, `${label} ${side} sw=${sweep} L=${length}: arc sampled`);
          for (const p of res.points.slice(length > 0 ? Math.max(2, Math.ceil(length)) : 0)) {
            near(dist(p, res.center), R, 1e-6, `${label} ${side} sw=${sweep} L=${length}: arc point exact radius`);
          }
          // Exact sweep angle between (arcStart - C) and (J - C)
          const u = { x: (res.arcStart.x - res.center.x) / R, y: (res.arcStart.y - res.center.y) / R };
          const v = { x: (res.junction.x - res.center.x) / R, y: (res.junction.y - res.center.y) / R };
          const ang = Math.acos(Math.max(-1, Math.min(1, u.x * v.x + u.y * v.y))) * 180 / Math.PI;
          near(ang, sweep, 1e-6, `${label} ${side} sw=${sweep}: sweep angle exact`);
          // Exact tangency at junction J: end tangent of arc == loop tangent t (1e-6)
          // Vector from C to J is -n (unit); rotating -n in the arc's travel direction gives the exact end tangent
          const sign = side === 'inside' ? 1 : -1; // svgSweep=1 (CW in y-down) -> (-v.y, v.x); svgSweep=0 (CCW) -> (v.y, -v.x)
          const endTan = { x: -sign * v.y, y: sign * v.x };
          near(endTan.x, res.tangent.x, 1e-6, `${label} ${side} sw=${sweep}: end tangent x == loop start tangent x`);
          near(endTan.y, res.tangent.y, 1e-6, `${label} ${side} sw=${sweep}: end tangent y == loop start tangent y`);
          // Check finite-difference direction of last arc chord aligns with +t (no cusp, arrives in cut direction)
          const prev = res.points.at(-2), last = res.points.at(-1);
          const chord = { x: (last.x - prev.x) / dist(last, prev), y: (last.y - prev.y) / dist(last, prev) };
          ok(chord.x * res.tangent.x + chord.y * res.tangent.y > 0.999, `${label} ${side} sw=${sweep}: arrives in loop cut direction (no cusp)`);
          // Side check: arc midpoint is on the requested side
          const midPt = res.points[Math.floor(res.points.length * 0.7)];
          if (label === 'rectangle') ok(inPoly(midPt, XY(RECT)) === (side === 'inside'), `${label} ${side} sw=${sweep}: arc lies on ${side} side`);
          else ok((dist(midPt, { x: 50, y: 50 }) < 30) === (side === 'inside'), `${label} ${side} sw=${sweep}: arc lies on ${side} side`);
          // Straight part check
          if (length === 0) {
            near(dist(res.tip, res.arcStart), 0, 1e-9, `${label} L=0: tip === arcStart`);
            if (sweep === 90 && label === 'rectangle') {
              near(Math.abs(res.tip.y - res.junction.y), R, 1e-6, `90°: tip is 1R out from line`);
              near(Math.abs(res.tip.x - res.junction.x), R, 1e-6, `90°: tip is 1R back along line`);
            }
          } else {
            near(dist(res.tip, res.arcStart), length, 1e-6, `${label} L=${length}: straight part exact length`);
            const sDir = { x: (res.arcStart.x - res.tip.x) / length, y: (res.arcStart.y - res.tip.y) / length };
            const arcStartTan = { x: -sign * u.y, y: sign * u.x };
            near(sDir.x, arcStartTan.x, 1e-6, `${label} L=${length}: straight segment tangent to arc start (x)`);
            near(sDir.y, arcStartTan.y, 1e-6, `${label} L=${length}: straight segment tangent to arc start (y)`);
          }
          // Written SVG path
          const svg = exportOf(st, ONLINE({ leadIn: true, leadInRadius: R, leadInSweep: sweep, leadInLength: length, leadInSide: side }));
          const els = elementsOf(svg);
          eq(els.length, 1, `${label} ${side} sw=${sweep} L=${length}: ONE SVG path`);
          const cmds = parseCmds(els[0].d);
          ok(!cmds.some((c) => c.c === 'Z'), `${label} ${side} sw=${sweep} L=${length}: open path (no Z)`);
          eq(cmds.filter((c) => c.c === 'M').length, 1, 'single subpath');
          near(dist({ x: cmds[0].v[0], y: cmds[0].v[1] }, res.tip), 0, 1e-3, 'starts at tip');
          const arcCmd = length > 0 ? cmds[2] : cmds[1];
          if (length > 0) eq(cmds[1].c, 'L', 'L to arcStart before A');
          eq(arcCmd.c, 'A', 'SVG A arc command written');
          near(arcCmd.v[0], R, 1e-3, 'A rx === R');
          near(arcCmd.v[1], R, 1e-3, 'A ry === R');
          eq(arcCmd.v[3], 0, 'largeArcFlag = 0');
          eq(arcCmd.v[4], side === 'inside' ? 1 : 0, 'correct svgSweep flag');
          near(dist({ x: arcCmd.v[5], y: arcCmd.v[6] }, res.junction), 0, 1e-3, 'arc ends at junction');
          const endPt = cmds.at(-1).v.slice(-2);
          near(dist({ x: endPt[0], y: endPt[1] }, res.junction), 0, 1e-3, 'path ends back at junction');
        }
      }
    }
  }
  // Owner's exact 1 in square test: 0.25 in radius Outside & Inside must BOTH pass!
  const sq1 = polyState([IN1]);
  for (const side of ['outside', 'inside']) {
    const c = cutsOf(sq1, ONLINE({ leadIn: true, leadInRadius: 6.35, leadInSweep: 90, leadInLength: 0, leadInSide: side }))[0];
    eq(c.leadIn.role, 'arc', `1 in square ${side} R=0.25 in (6.35 mm) 90°: fits`);
  }
  const tooBig = cutsOf(sq1, ONLINE({ leadIn: true, leadInRadius: 13, leadInSweep: 90, leadInSide: 'inside' }))[0];
  eq([tooBig.leadIn.role, tooBig.leadIn.error], ['refused', 'room'], '1 in square Inside R=13 mm (> half width) at 90°: refused room');
}

// ── 2. Calculated defaults (2b): big square, small inside hole (reduced R), tighter inside hole (reduced sweep), bit change ──
{
  // Big square, 6 mm bit -> R = 6, sweep = 90, L = 0
  const big = polyState([RECT]);
  const cBig = cutsOf(big, ONLINE({ toolDia: 6, leadIn: true, leadInSide: 'inside' }))[0].leadIn;
  eq([cBig.role, cBig.radius, cBig.sweep, cBig.length, cBig.isCalc.radius, cBig.isCalc.sweep, cBig.isCalc.length],
    ['arc', 6, 90, 0, true, true, true], 'big square Inside 6 mm bit: calculated R = 6, sweep = 90, L = 0');
  // Small inside square (16x16 mm, 6 mm bit -> bit dia 6 too big since 8 - 6 < 6, reduces R to ~4 mm, keeps 90°)
  const sm = polyState([[[0, 0], [16, 0], [16, 16], [0, 16]]]);
  const cSm = cutsOf(sm, ONLINE({ toolDia: 6, leadIn: true, leadInSide: 'inside' }))[0].leadIn;
  ok(cSm.role === 'arc' && cSm.radius >= 3 && cSm.radius < 4.05 && cSm.sweep === 90 && cSm.isCalc.radius && cSm.isCalc.sweep,
    `16x16 mm square Inside 6 mm bit: reduced R=${cSm.radius} (< 6, >= 3), sweep=90`);
  // Tighter inside square (8x8 mm, 6 mm bit -> even R=3 at 90° hits ROOM, so R=3 and sweep reduces from 90°!)
  const tight = polyState([[[0, 0], [8, 0], [8, 8], [0, 8]]]);
  const cTight = cutsOf(tight, ONLINE({ toolDia: 6, leadIn: true, leadInSide: 'inside' }))[0].leadIn;
  ok(cTight.role === 'arc' && Math.abs(cTight.radius - 3) < 1e-6 && cTight.sweep >= 15 && cTight.sweep < 90 && cTight.isCalc.radius && cTight.isCalc.sweep,
    `8x8 mm square Inside 6 mm bit: R=bit radius (3), reduced sweep=${cTight.sweep}° (< 90°, >= 15°)`);
  // Tiny inside square (0.5x0.5 mm, 6 mm bit): even R=3 at 15° doesn't fit -> refused room
  const tiny = polyState([[[0, 0], [0.5, 0], [0.5, 0.5], [0, 0.5]]]);
  const cTiny = cutsOf(tiny, ONLINE({ toolDia: 6, leadIn: true, leadInSide: 'inside' }))[0].leadIn;
  eq([cTiny.role, cTiny.error], ['refused', 'room'], '0.5x0.5 mm square Inside 6 mm bit: refused room');
  // Bit change moves calculated radius
  const cBit3 = cutsOf(big, ONLINE({ toolDia: 3.175, leadIn: true }))[0].leadIn;
  const cBit6 = cutsOf(big, ONLINE({ toolDia: 6.35, leadIn: true }))[0].leadIn;
  eq([cBit3.radius, cBit6.radius], [3.175, 6.35], 'bit change moves calculated radius (3.175 -> 6.35)');
}

// ── 3. Draggable leadInAt (item 8): moves junction, stays tangent, ROOM refusal, null = calculated ──
{
  const st = polyState([RECT]);
  const loop = outerOf(st);
  const w = loopWalk(loop, st);
  const defJ = outlineJunction(w, null);
  const defArc = outlineArc(w, { toolDia: 3.175 });
  eq([defJ.at, defArc.junction], ['line', { x: 50, y: 0 }], 'null leadInAt = middle of longest straight edge');
  // Move to 25% of perimeter (320 * 0.25 = 80 mm along top edge -> (80, 0))
  const cMoved = cutsOf(st, ONLINE({ leadIn: true, leadInAt: 80 / 320 }))[0].leadIn;
  eq([cMoved.role, cMoved.at, cMoved.isCalc.at], ['arc', 'line', false], 'leadInAt = 0.25: moved (isCalc.at = false)');
  near(dist(cMoved.junction, { x: 80, y: 0 }), 0, 1e-6, 'junction moved to (80, 0)');
  // Move to right edge (100 + 30 = 130 mm -> (100, 30)): tangent is (0, 1), Outside normal is (1, 0)
  const cRight = cutsOf(st, ONLINE({ leadIn: true, leadInAt: 130 / 320 }))[0].leadIn;
  near(dist(cRight.junction, { x: 100, y: 30 }), 0, 1e-6, 'junction moved to right edge (100, 30)');
  near(cRight.tangent.x, 0, 1e-6, 'tangent on right edge x = 0');
  near(cRight.tangent.y, 1, 1e-6, 'tangent on right edge y = 1');
  ok(cRight.tip.x > 100, 'Outside tip on right edge is to the right of x=100');
  // Drag helper: valid spot vs tight inside corner (ROOM refusal)
  const okDrag = leadInDragAt(loop, ONLINE({ leadIn: true, leadInSide: 'inside', leadInRadius: 6.35, leadInSweep: 90 }), st, { x: 50, y: 2 });
  ok(okDrag && okDrag.leadIn.role === 'arc' && dist(okDrag.leadIn.junction, { x: 50, y: 0 }) < 1e-6, 'leadInDragAt middle of top edge: valid arc');
  // Near top-left corner (x=2, y=0): an Inside 90° arc of R=6.35 sweeping back along top edge (toward x<0) hits the left edge x=0 -> refused room!
  const badDrag = leadInDragAt(loop, ONLINE({ leadIn: true, leadInSide: 'inside', leadInRadius: 6.35, leadInSweep: 90 }), st, { x: 2, y: 0 });
  eq([badDrag.leadIn.role, badDrag.leadIn.error], ['refused', 'room'], 'leadInDragAt tight inside corner: refused room');
  // Calculated Radius/Sweep recalculate when dragged closer to a corner!
  const calcCorner = leadInDragAt(loop, ONLINE({ leadIn: true, leadInSide: 'inside', toolDia: 6 }), st, { x: 4, y: 0 });
  ok(calcCorner.leadIn.role === 'arc' && calcCorner.leadIn.radius < 6 && calcCorner.leadIn.isCalc.radius,
    `drag near corner with calculated defaults reduces radius from 6 to ${calcCorner.leadIn.radius}`);
}

// ── 4. 775 Migration (item 2) ──
{
  const oldOnline = { cutType: 'online', cutDepth: 3, toolDia: 3.175, leadIn: true, leadInLength: 6.35, leadInSide: 'outside' };
  const mig = migrateLeadInRecord(oldOnline);
  eq([mig.leadIn, mig.leadInRadius, mig.leadInSweep ?? null, mig.leadInLength, mig.leadInSide], [true, 6.35, null, null, 'outside'],
    '775 On line record with leadInLength=6.35 opens as leadInRadius=6.35, leadInLength=null (same reach, arc)');
  // Idempotent: a 778 record with leadInRadius: null, leadInLength: 5 keeps Length = 5
  const newRec = { cutType: 'online', cutDepth: 3, toolDia: 3.175, leadIn: true, leadInRadius: null, leadInSweep: null, leadInLength: 5, leadInSide: 'outside' };
  eq(migrateLeadInRecord(newRec), newRec, '778 record with explicit straight leadInLength=5 is untouched');
  // 775 pocket record with leadIn: true simply ignores it and shows the start mark (tested in section 5 too)
  const oldPocket = POCKET({ clearing: 'linked', loop: true, leadIn: true, leadInLength: 6 });
  const pocketEls = elementsOf(exportOf(polyState([RECT]), migrateLeadInRecord(oldPocket)));
  eq(pocketEls.map((e) => [e.cutType, /Z$/.test(e.d)]), [['online', true], ['guide', false]],
    '775 pocket record with leadIn:true ignores lead-in, stays closed, and emits the guide start mark');
}

// ── 5. Pocket Start Mark (item 7) & zero pocketLeg anywhere in codebase ──
{
  const cases = [
    ['rectangle', polyState([RECT])],
    ['island', polyState([RECT, ISLAND])],
    ['dumbbell', polyState([DUMBBELL])],
    ['circle', polyState([], [['c', [50, 50], 30]])],
  ];
  for (const [name, st] of cases) {
    const pocket = deriveProfileCuts({ kind: 'loop', id: outerOf(st).id }, { cutType: 'pocket' }, st, findLoops(st), polysOf(st)).find((c) => c.isCompound);
    const rings = pocketRings(pocket, st);
    const outer = XY(rings.outer.slice(0, -1)), holes = rings.holes.map((h) => XY(h.slice(0, -1)));
    for (const pat of ['linked', 'raster', 'morphed']) {
      if (pat === 'morphed' && (name === 'island' || name === 'dumbbell')) continue;
      for (const loop of [false, true]) {
        const rec = POCKET({ clearing: pat, loop });
        const plan = planClearing(rings, clearingSettings(rec));
        ok(plan.startPoint && Number.isFinite(plan.startPoint.x) && Number.isFinite(plan.startPoint.y), `${name} ${pat} loop=${loop}: startPoint computed`);
        const sp = plan.startPoint;
        // Must be ON a clearing route (within 1e-6 mm)
        const dRoute = Math.min(...plan.clear.map((c) => distPoly(sp, c.points, c.closed)));
        ok(dRoute < 1e-6, `${name} ${pat} loop=${loop}: startPoint is ON the clearing route (dist=${dRoute})`);
        // Must be inside pocket, NEVER on an island, at least bit radius from wall & islands
        ok(inPoly(sp, outer) && !holes.some((h) => inPoly(sp, h)), `${name} ${pat} loop=${loop}: startPoint inside pocket, off every island`);
        const dWall = Math.min(distPoly(sp, outer, true), ...holes.map((h) => distPoly(sp, h, true)));
        ok(dWall >= 3 - 0.02, `${name} ${pat} loop=${loop}: startPoint >= bit radius from wall/islands (d=${dWall.toFixed(3)})`);
        // Loop off: startPoint is the exact start point of the first clearing path!
        if (!loop) near(dist(sp, plan.clear[0].points[0]), 0, 1e-6, `${name} ${pat} loop=false: startPoint === clear[0].points[0]`);
        // Exported SVG has ONE guide start mark of ~2 bit diameters across, and pocket path is closed when Loop ON
        const svg = exportOf(st, rec);
        const els = elementsOf(svg);
        const guides = els.filter((e) => e.cutType === 'guide');
        eq(guides.length, 1, `${name} ${pat} loop=${loop}: exactly 1 guide start mark in exported SVG`);
        ok(guides[0].a.stroke === '#0068FF' && guides[0].d.includes(' A ') && guides[0].d.includes(' L '), `${name} ${pat} loop=${loop}: guide start mark is blue circle + cross`);
        const rAttr = Number((/A ([\d.]+)/.exec(guides[0].d) || [])[1]);
        near(rAttr, 6 * POCKET_CLEARING.startMarkDiaMult * POCKET_CLEARING.startMarkCircleRatio / 2, 0.02, `${name} ${pat}: circle radius matches declared startMarkDiaMult`);
        if (loop) {
          const online = els.filter((e) => e.cutType === 'online');
          ok(online.length >= 1 && online.every((e) => /Z$/.test(e.d)), `${name} ${pat} loop=true: pocket loop(s) remain closed with Z`);
        }
        // Saved pocket with leadIn: true exports byte-identical to without (ignored, shows start mark)
        eq(exportOf(st, { ...rec, leadIn: true, leadInLength: 6 }), svg, `${name} ${pat} loop=${loop}: saved leadIn:true ignored on pocket`);
      }
      // Spiral & Morphed: Loop ON startPoint === Loop OFF startPoint (both on innermost ring!)
      if (pat === 'linked' || pat === 'morphed') {
        const offSp = planClearing(rings, clearingSettings(POCKET({ clearing: pat, loop: false }))).startPoint;
        const onSp = planClearing(rings, clearingSettings(POCKET({ clearing: pat, loop: true }))).startPoint;
        near(dist(offSp, onSp), 0, 1e-6, `${name} ${pat}: Loop ON startPoint === Loop OFF startPoint (innermost ring)`);
      }
    }
  }
  // 3D buildRelief emits pocket-start mark in rel.marks without adding it to skipped
  const st = polyState([RECT]);
  V2_PLAN.clear();
  V2_PLAN.set(keyOf('loop', outerOf(st).id), POCKET({ clearing: 'linked', loop: true }));
  const rel = buildRelief({ state: st, items: planReliefItems(st), stock: { thickness: 19 } });
  eq(rel.stats.skipped.length, 0, '3D relief: pocket start mark is NOT in skipped');
  eq(rel.marks.length, 1, '3D relief: 1 pocket-start mark emitted');
  eq([rel.marks[0].kind, rel.marks[0].dia], ['pocket-start', 12], '3D relief mark kind & dia (2 * toolDia)');
  V2_PLAN.clear();

  // Zero pocketLeg anywhere in packages/ or apps/
  const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'vendor' && e.name !== 'node_modules') walk(p); }
      else if (/\.(js|html|css)$/.test(e.name)) {
        fs.readFileSync(p, 'utf8').split('\n').forEach((l, i) => { if (/\bpocketLeg\b/.test(l)) hits.push(`${p}:${i + 1}`); });
      }
    }
  };
  walk(path.join(root, 'packages'));
  walk(path.join(root, 'apps'));
  eq(hits, [], 'ZERO pocketLeg remains in packages/ or apps/');
}

// ── 6. Param hints exact text (item 2) ──
{
  ok(PARAM_HINTS.leadInRadius.hint.includes('The lead-in curves onto the line along this radius, so the bit joins the cut smoothly instead of turning a corner.'), 'leadInRadius hint has required sentence');
  ok(PARAM_HINTS.leadInSweep.label === 'Sweep' && PARAM_HINTS.leadInSweep.hint.length > 10, 'leadInSweep hint present');
  ok(PARAM_HINTS.leadInLength.label === 'Length' && PARAM_HINTS.leadInLength.hint.length > 10, 'leadInLength hint present');
  ok(PARAM_HINTS.leadInAt.label === 'Position' && PARAM_HINTS.leadInAt.hint.length > 10, 'leadInAt hint present');
}

// ── 7. App UI (node kit): calculated tag, typing removes tag, Reset to calculated restores null & tag, Position moved/reset, 775 doc load ──
SettingsManager.set('DOC_UNIT', 'mm');
SettingsManager.set('LENGTH_PRECISION', null);
{
  const profile = await createProfile();
  await createNamedDesign(profile, 'shaper', 'Arc 778');
  V2_PLAN.clear(); V2_PLAN.setOrder([]);
  const app = await open({ host: 'shaper', profile });
  try {
    const doc = app.document, q = (s) => doc.querySelector(s), st = app.state;
    const pressEl = (s) => { const e = typeof s === 'string' ? q(s) : s; assert(e, s + ' not found'); app.press(e); };
    const clickAt = (x, y) => { const pc = doc.getElementById('prepare-canvas'); const p = worldToScreen(pc, { x, y }); app.click(Math.round(p.x), Math.round(p.y), { target: pc }); };
    const typed = (cls, v) => { const i = q(cls); i.value = v; i.dispatchEvent(new app.window.Event('change')); };
    pressEl('.sk-header-tab[data-tab="design"]');
    for (const k of [...st.joints.keys()]) st.joints.delete(k);
    st.shapes.length = 0; st.constraints.length = 0;
    const src = polyState([RECT]);
    for (const [k, v] of src.joints) st.joints.set(k, v);
    st.shapes.push(...src.shapes);
    st.saveState('draw');
    pressEl('.sk-header-tab[data-tab="prepare"]');
    clickAt(10, 10);
    pressEl('.cut-type-trigger'); pressEl('.cut-type-opt[data-id="online"]');
    typed('.cut-depth', '3');
    pressEl('.cut-row[data-row="leadIn"] .cut-preset[data-value="true"]');
    const kA = [...V2_PLAN.keys()][0];
    // Calculated tags visible, reset buttons hidden
    for (const row of ['leadInRadius', 'leadInSweep', 'leadInLength', 'leadInAt']) {
      eq(q(`.cut-row[data-row="${row}"] .cut-calc-tag`).hidden, false, `${row}: calculated tag shown`);
      eq(q(`.cut-row[data-row="${row}"] .cut-calc-reset`).hidden, true, `${row}: Reset button hidden while calculated`);
    }
    eq(q('.cut-pos-state').textContent, 'calculated', 'Position state reads calculated');
    // Bit change moves calculated Radius in the input box
    typed('.cut-bit', '6.35');
    eq(q('.cut-lead-radius').value, '6.35', 'bit change moves calculated radius box to 6.35');
    // Typing Radius stores it, hides calculated tag, shows Reset to calculated
    typed('.cut-lead-radius', '8');
    eq(V2_PLAN.get(kA).leadInRadius, 8, 'typed Radius stored');
    eq(q('.cut-row[data-row="leadInRadius"] .cut-calc-tag').hidden, true, 'Radius calculated tag hidden after typing');
    eq(q('.cut-row[data-row="leadInRadius"] .cut-calc-reset').hidden, false, 'Radius Reset button shown after typing');
    // Bit change no longer overwrites typed Radius
    typed('.cut-bit', '3.175');
    eq([V2_PLAN.get(kA).leadInRadius, q('.cut-lead-radius').value], [8, '8'], 'typed Radius sticks across bit change');
    // Reset to calculated clears to null, restores tag, recalculates to 3.175 (ONE undo step)
    const h0 = st.history.length;
    pressEl('.cut-calc-reset[data-reset="leadInRadius"]');
    eq([V2_PLAN.get(kA).leadInRadius, q('.cut-lead-radius').value, st.history.length], [null, '3.175', h0 + 1], 'Reset to calculated restores null & recalculated value in ONE undo step');
    eq(q('.cut-row[data-row="leadInRadius"] .cut-calc-tag').hidden, false, 'Radius calculated tag returns after reset');
    // Sweep & Length typing + reset
    typed('.cut-lead-sweep', '45');
    eq([V2_PLAN.get(kA).leadInSweep, q('.cut-row[data-row="leadInSweep"] .cut-calc-tag').hidden], [45, true], 'typed Sweep=45 hides tag');
    typed('.cut-lead-length', '4');
    eq([V2_PLAN.get(kA).leadInLength, q('.cut-row[data-row="leadInLength"] .cut-calc-tag').hidden], [4, true], 'typed Length=4 hides tag');
    ok(q('.cut-note').textContent.includes('45°') && q('.cut-note').textContent.includes('+ 4 mm straight'), 'note reports sweep 45° and straight length 4 mm');
    pressEl('.cut-calc-reset[data-reset="leadInSweep"]');
    pressEl('.cut-calc-reset[data-reset="leadInLength"]');
    eq([V2_PLAN.get(kA).leadInSweep, V2_PLAN.get(kA).leadInLength], [null, null], 'Reset clears Sweep and Length to null');
    // Draggable handle exists in Prepare DOM when selected; dragging it moves leadInAt, updates Position row, ONE undo step, Reset clears it
    const handle = q('#prepare-canvas .sk-lead-handle');
    ok(handle, 'Prepare renders 1 draggable lead-in handle at junction');
    const pc = doc.getElementById('prepare-canvas');
    const p0 = worldToScreen(pc, { x: 50, y: 0 }), p1 = worldToScreen(pc, { x: 80, y: 0 });
    const hDrag = st.history.length;
    handle.dispatchEvent(new app.window.PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, button: 0, isPrimary: true, clientX: p0.x, clientY: p0.y }));
    pc.dispatchEvent(new app.window.PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId: 1, buttons: 1, clientX: p1.x, clientY: p1.y }));
    pc.dispatchEvent(new app.window.PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1, button: 0, clientX: p1.x, clientY: p1.y }));
    ok(V2_PLAN.get(kA).leadInAt != null && Math.abs(V2_PLAN.get(kA).leadInAt - 80 / 320) < 0.02, `drag moved leadInAt to ~0.25: ${V2_PLAN.get(kA).leadInAt}`);
    eq(st.history.length, hDrag + 1, 'handle drag commits ONE undo step');
    eq([q('.cut-pos-state').textContent, q('.cut-pos-state').classList.contains('is-moved'), q('.cut-calc-reset[data-reset="leadInAt"]').hidden],
      ['moved', true, false], 'Position row shows moved and Reset button');
    pressEl('.cut-calc-reset[data-reset="leadInAt"]');
    eq([V2_PLAN.get(kA).leadInAt, q('.cut-pos-state').textContent], [null, 'calculated'], 'Position Reset returns to calculated');
  } finally { await app.close(); }
}
// ── 8. End-to-end 775 document reload through shaper-doc.js ──
{
  const joints = [['j0', { x: 0, y: 0, sketchId: 'sketch-1' }], ['j1', { x: 100, y: 0, sketchId: 'sketch-1' }], ['j2', { x: 100, y: 60, sketchId: 'sketch-1' }], ['j3', { x: 0, y: 60, sketchId: 'sketch-1' }]];
  const shapes = [['s0', 'j0', 'j1'], ['s1', 'j1', 'j2'], ['s2', 'j2', 'j3'], ['s3', 'j3', 'j0']].map(([id, a, b]) => ({ id, type: 'line', joints: [a, b], sketchId: 'sketch-1' }));
  const scratch = polyState([RECT]);
  const loopId = findLoops({ joints: new Map(joints), shapes, constraints: [] })[0].id;
  void scratch;
  const doc775 = {
    version: 3,
    geometry: { joints, shapes, constraints: [], sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }], activeSketchId: 'sketch-1', groups: [], profiles: [], parameters: [] },
    hosts: { shaper: { version: 2, cutPlan: [[keyOf('loop', loopId), { cutType: 'online', cutDepth: 3, cutOffset: 0, toolDia: 3.175, cutterShape: 'endmill', cutterAngle: 90, leadIn: true, leadInLength: 6.35, leadInSide: 'outside' }]], stock: { thickness: 19.05, width: null, height: null, margin: 12.7 }, opOrder: [] } },
  };
  const pf = await createProfile();
  await createNamedDesign(pf, 'shaper', 'Mig 775', doc775);
  V2_PLAN.clear(); V2_PLAN.setOrder([]);
  const app = await open({ host: 'shaper', profile: pf });
  try {
    const rec = V2_PLAN.get(keyOf('loop', loopId));
    eq([rec.leadIn, rec.leadInRadius, rec.leadInLength, rec.leadInSide], [true, 6.35, null, 'outside'], 'saved 775 document migrates on open: leadInLength 6.35 -> leadInRadius 6.35, leadInLength null');
    const svg = shaperSvgOf(app.state, planEntries());
    const els = elementsOf(svg);
    ok(els.length === 1 && els[0].d.includes(' A 6.35 6.35 ') && !/Z$/.test(els[0].d), 'migrated 775 document exports tangential arc of radius 6.35 mm');
  } finally { await app.close(); }
}
V2_PLAN.clear(); V2_PLAN.setOrder([]);
console.log(`leadin-arc-778-node: ok (${checks} checks)`);
