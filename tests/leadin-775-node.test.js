// tests/leadin-775-node.test.js — TASK 775 (verified on the owner's Origin 2026-11-17): LEAD-IN legs, TABS on On line cuts, honest LOOP wording.
//  1. LEAD-IN on an On line OUTLINE (#core/lead-in applyLeadIn, through #core/stepped-cut deriveCuts): the download is ONE OPEN path (no Z) whose two ends
//     are the leg tip and the junction: M tip L junction, the whole loop, back to the junction; the junction is the middle of the longest straight edge
//     (a circle: the middle of its one segment); the leg is `length` long along the outline's normal, Outside = away from the shape, Inside = into it;
//     default length = one bit diameter; refused (closed loop, byte-identical to no lead-in, its reason) when another part of the outline is in the way,
//     under the bit radius, with tabs; an open line ignores it; the viewBox holds an outside tip; the preview copy says data-lead="in" (never the file);
//     the footprint sweeps the leg.
//  2. LEAD-IN on a programmed pocket with Loop on (Spiral / Raster / Morphed spiral; rectangle, island, L, circle): every loop is ONE OPEN path from the
//     leg tip to the loop's start, round, back to it (no Z); the leg is `length` long, inside the pocket region at least the bit radius from the wall and
//     every island (0.02 mm: never across the wall or an island); refused (closed loops, its reason) when no leg fits / under the bit radius; Loop off or
//     Freehand ignore it; the leftover is not larger.
//  3. TABS on an On line outline (#core/hold-part, 742's rows): separate OPEN strokes, stroke count = tab count, each gap exactly the tab width (0.01 mm), at
//     the full depth; the Review leaves the tabs standing; onion skin = the whole line at depth - skin (an open line too); refused (as without) on an open
//     line, a tab not wider than the bit, no room; a profile's hole loops stay closed.
//  4. LOOP WORDING: no "ends where it starts" left in apps/shaper or packages/core; Prepare draws no dot on a closed loop.
//  5. BYTE-IDENTICAL without the new options: tests/fixtures/leadin-775-before.json (written by origin/main 5e79336's own code, tests/helpers/leadin-775-digest.js).
//  6. The app (node kit): the cut card rows (Lead-in Off | On, Length, Side; On line's Hold part with no Tab thickness), ONE undo step each, the notes, the
//     last values remembered, Prepare's leg and dots, the operations row, save + reload.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { leadinDigest } from './helpers/leadin-775-digest.js';
import { worldToScreen } from '#ui/coords.js';
import SettingsManager from '#core/settings-manager.js';
import { exportShaperSVG } from '#core/shaper-export.js';
import { findLoops, findOpenChains } from '#core/loop-finder.js';
import { loopPolygon } from '#core/loop-geometry.js';
import { deriveCuts } from '#core/stepped-cut.js';
import { deriveCutFootprint, deriveProfileCuts } from '#core/profile-model.js';
import { planClearing, clearingSettings, pocketRings } from '#core/pocket-clearing.js';
import { CUT_PLAN, cutPlanEntries, planReliefItems, keyOf, planLeadInNotes } from '../apps/shaper/src/cut-plan.js';
import { exportEncoding } from '../apps/shaper/src/shaper.js';
import { shaperSvgOf } from '../apps/shaper/src/export-payload.js';
import { setOpOrder, planOperations } from '../apps/shaper/src/operations.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b} (tol ${tol})`); checks++; };
const BIT = 3.175, R = BIT / 2;
const TRADE_OFF = "Lead-in: you start at the leg's end; AutoPass then reverses at each end, so the cutting direction alternates.";

function polyState(loops, circles = [], chains = []) {
  const joints = new Map(), shapes = [];
  loops.forEach((pts, li) => pts.forEach((p, i) => { joints.set(`j${li}_${i}`, { x: p[0], y: p[1] }); shapes.push({ id: `s${li}_${i}`, type: 'line', joints: [`j${li}_${i}`, `j${li}_${(i + 1) % pts.length}`] }); }));
  for (const [id, c, r] of circles) { joints.set(id + 'o', { x: c[0], y: c[1] }); shapes.push({ id, type: 'circle', joints: [id + 'o'], radius: r }); }
  chains.forEach((pts, ci) => pts.forEach((p, i) => { joints.set(`k${ci}_${i}`, { x: p[0], y: p[1] }); if (i) shapes.push({ id: `c${ci}_${i}`, type: 'line', joints: [`k${ci}_${i - 1}`, `k${ci}_${i}`] }); }));
  return { joints, shapes, constraints: [], groups: [], profiles: [] };
}
const RECT = [[0, 0], [100, 0], [100, 60], [0, 60]];
const ISLAND = [[40, 20], [60, 20], [60, 40], [40, 40]];
const LSHAPE = [[0, 0], [100, 0], [100, 40], [40, 40], [40, 100], [0, 100]];
const area = (p) => { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j].x * p[i].y - p[i].x * p[j].y; return a / 2; };
const polysOf = (st) => { const by = new Map(st.shapes.map((s) => [s.id, s])); const lp = {}; for (const l of findLoops(st)) lp[l.id] = loopPolygon(l, st, by); return lp; };
const outerOf = (st) => { const loops = findLoops(st), lp = polysOf(st); return loops.reduce((a, l) => (Math.abs(area(lp[l.id])) > Math.abs(area(lp[a.id])) ? l : a), loops[0]); };
const exportOf = (st, entries, options = { groupByCut: true }) => exportShaperSVG({ state: st, entries, encoding: exportEncoding(), docUnit: 'mm', options, loopPolys: polysOf(st) });
const one = (st, rec, options) => exportOf(st, [{ target: { kind: 'loop', id: outerOf(st).id }, rec }], options);
const cutsOf = (st, rec) => deriveCuts({ kind: 'loop', id: outerOf(st).id }, rec, st, findLoops(st), polysOf(st), new Set());
const ONLINE = (more = {}) => ({ cutType: 'online', cutDepth: 3, cutOffset: 0, toolDia: BIT, ...more });
function elementsOf(svg) {
  const attrs = (s) => Object.fromEntries([...s.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  const out = []; let group = null;
  for (const line of svg.split('\n').map((l) => l.trim())) {
    if (line.startsWith('<g')) { group = attrs(line); continue; }
    if (line.startsWith('</g')) { group = null; continue; }
    const m = /^<(path|circle|polygon)\s(.*)\/>$/.exec(line);
    if (!m) continue;
    const a = { ...(group || {}), ...attrs(m[2]) };
    out.push({ tag: m[1], cutType: a['shaper:cutType'], depth: a['shaper:cutDepth'], d: a.d || null, a });
  }
  return out;
}
// a path's end points in order (M / L / A / C: the point each command ends at) and whether it closes (Z)
function pathPoints(d) {
  const tok = d.trim().split(/\s+/), pts = [];
  let i = 0, closed = false, subpaths = 0;
  while (i < tok.length) {
    const c = tok[i++];
    if (c === 'Z') { closed = true; continue; }
    const n = c === 'A' ? 7 : c === 'C' ? 6 : 2;
    const v = tok.slice(i, i + n).map(Number); i += n;
    if (c === 'M') subpaths++;
    pts.push({ x: v[n - 2], y: v[n - 1], c });
  }
  return { pts, closed, subpaths };
}
const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
const distSeg = (p, a, b) => { const vx = b.x - a.x, vy = b.y - a.y, L = vx * vx + vy * vy; const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / L)) : 0; return Math.hypot(p.x - a.x - t * vx, p.y - a.y - t * vy); };
const distRing = (p, pts) => { let m = Infinity; for (let i = 0; i < pts.length; i++) m = Math.min(m, distSeg(p, pts[i], pts[(i + 1) % pts.length])); return m; };
const inPoly = (p, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c; } return c; };
const XY = (a) => a.map(([x, y]) => ({ x, y }));

// ── 1. LEAD-IN on an On line outline ──
{
  const st = polyState([RECT]);
  const plain = one(st, ONLINE());
  for (const side of ['outside', 'inside']) {
    const svg = one(st, ONLINE({ leadIn: true, leadInSide: side }));
    const els = elementsOf(svg);
    eq(els.map((e) => [e.tag, e.cutType, e.depth]), [['path', 'online', '3.000 mm']], `${side}: ONE on-line path`);
    const { pts, closed, subpaths } = pathPoints(els[0].d);
    eq([closed, subpaths], [false, 1], `${side}: OPEN (no Z), one stroke`);
    const tip = pts[0], J = pts[1];
    ok((dist(J, { x: 50, y: 0 }) < 1e-9) || dist(J, { x: 50, y: 60 }) < 1e-9, `${side}: the junction is the middle of a longest (100 mm) straight edge: ${JSON.stringify(J)}`);
    eq([pts.at(-1).x, pts.at(-1).y], [J.x, J.y], `${side}: the path ends back at the junction (its other end)`);
    near(dist(tip, J), BIT, 1e-9, `${side}: the leg is one bit diameter (default)`);
    eq(tip.x, J.x, `${side}: the leg runs along the edge's normal`);
    ok(side === 'outside' ? !inPoly(tip, XY(RECT)) : inPoly(tip, XY(RECT)), `${side}: the tip is ${side} the shape`);
    for (const c of RECT) ok(pts.some((p) => p.x === c[0] && p.y === c[1]), `${side}: the loop goes round every corner ${c}`);
    if (side === 'outside') ok(/viewBox="0 -3\.175 100 63\.175"|viewBox="0 0 100 63\.175"/.test(svg), 'outside: the viewBox holds the tip: ' + svg.split('\n')[0]);
    else ok(svg.split('\n')[0] === plain.split('\n')[0], 'inside: the viewBox is the drawing\'s');
    ok(!/data-/.test(svg), `${side}: the download has no data-* attribute`);
    eq(elementsOf(one(st, ONLINE({ leadIn: true, leadInSide: side }), { groupByCut: true, previewData: true }))[0].a['data-lead'], 'in', `${side}: the preview copy says data-lead="in"`);
    // the footprint sweeps the leg (its middle is inside the band) and carries it as a tool path
    const rec = ONLINE({ leadIn: true, leadInSide: side }), fp = deriveCutFootprint(cutsOf(st, rec), rec, st)[0];
    const mid = { x: (tip.x + J.x) / 2, y: (tip.y + J.y) / 2 };
    ok(fp.leadIn && fp.leadIn.role === 'leg' && fp.toolPaths.some((t) => !t.closed && t.points.length === 2), `${side}: the footprint carries the leg`);
    ok(fp.rings.some((r) => inPoly(mid, r)), `${side}: the leg's middle is inside the swept band`);
  }
  // a longer leg, typed
  const long = pathPoints(elementsOf(one(st, ONLINE({ leadIn: true, leadInLength: 6.35 })))[0].d).pts;
  near(dist(long[0], long[1]), 6.35, 1e-9, 'Length 6.35 mm: the leg is 6.35 mm');
  // Off / Lead-in fields with leadIn false: byte-identical
  eq(one(st, ONLINE({ leadIn: false, leadInLength: 9, leadInSide: 'inside' })), plain, 'Lead-in Off (its fields set): byte-identical to a record without them');
  // refusals: closed loop, as without, with its reason
  const thin = polyState([[[0, 0], [100, 0], [100, 4], [0, 4]]]);
  const thinCuts = cutsOf(thin, ONLINE({ leadIn: true, leadInSide: 'inside', leadInLength: 6.35 }));
  eq(thinCuts.find((c) => c.leadIn).leadIn.role + ':' + thinCuts.find((c) => c.leadIn).leadIn.error, 'refused:room', 'a 4 mm strip, Inside 6.35 mm: refused, the far edge is in the way');
  eq(one(thin, ONLINE({ leadIn: true, leadInSide: 'inside', leadInLength: 6.35 })), one(thin, ONLINE()), 'refused: exported as without (closed)');
  ok(pathPoints(elementsOf(one(thin, ONLINE({ leadIn: true, leadInSide: 'inside', leadInLength: 1.9 })))[0].d).closed === false, 'the same strip, Inside 1.9 mm: fits');
  eq(cutsOf(st, ONLINE({ leadIn: true, leadInLength: 1 })).find((c) => c.leadIn).leadIn.error, 'short', 'a 1 mm leg under the 1.5875 mm bit radius: refused');
  eq(cutsOf(st, ONLINE({ leadIn: true, holdPart: 'tabs', tabCount: 3, tabWidth: 10 })).find((c) => c.leadIn).leadIn.error, 'tabs', 'with tabs: refused (each stroke has its own ends)');
  // a circle: the middle of its one segment, the leg along the radius
  const circ = polyState([], [['c', [50, 50], 30]]);
  const cp = pathPoints(elementsOf(one(circ, ONLINE({ leadIn: true })))[0].d);
  near(dist(cp.pts[0], { x: 50, y: 50 }), 30 + BIT, 1e-9, 'circle, Outside: the tip is r + leg from the centre');
  near(dist(cp.pts[1], { x: 50, y: 50 }), 30, 1e-9, 'circle: the junction is on the circle');
  ok(!cp.closed && cp.pts.slice(2).every((p) => p.c === 'A') && dist(cp.pts.at(-1), cp.pts[1]) < 1e-6, 'circle: the leg, then arcs back to the junction, no Z');
  // onion skin + lead-in: the leg at the skin's depth
  eq(elementsOf(one(st, ONLINE({ leadIn: true, holdPart: 'skin', holdThickness: 1 }))).map((e) => [e.depth, pathPoints(e.d).closed]), [['2.000 mm', false]], 'onion skin + lead-in: one open path at depth - skin');
  // an open line: nothing to add
  const ch = polyState([], [], [[[0, 0], [50, 0], [50, 30]]]);
  const chain = findOpenChains(ch, findLoops(ch))[0];
  const chainSvg = (rec) => exportOf(ch, [{ target: { kind: 'chain', id: chain.id }, rec }]);
  eq(chainSvg(ONLINE({ leadIn: true })), chainSvg(ONLINE()), 'an open line: the lead-in adds nothing (it has its ends)');
  // a profile with a hole: only the record's own outline gets the leg; the hole stays a closed loop
  const plate = polyState([RECT, ISLAND]);
  const pe = elementsOf(one(plate, ONLINE({ leadIn: true })));
  eq(pe.map((e) => pathPoints(e.d).closed), [true, false], 'a profile with a hole: the hole closed, the outline opened by the leg');
}

// ── 2. LEAD-IN on a programmed pocket with Loop on ──
{
  const POCKET = (more = {}) => ({ cutType: 'pocket', cutDepth: 6, cutOffset: 0, toolDia: 6, stepover: 40, finishAllowance: 0.5, rasterAngle: 0, ...more });
  const SHAPES = { rectangle: polyState([RECT]), island: polyState([RECT, ISLAND]), L: polyState([LSHAPE]), circle: polyState([], [['c', [50, 50], 30]]) };
  for (const [name, st] of Object.entries(SHAPES)) {
    const pocket = deriveProfileCuts({ kind: 'loop', id: outerOf(st).id }, { cutType: 'pocket' }, st, findLoops(st), polysOf(st)).find((c) => c.isCompound);
    const rings = pocketRings(pocket, st), outer = XY(rings.outer.slice(0, -1)), holes = rings.holes.map((h) => XY(h.slice(0, -1)));
    for (const pat of ['linked', 'raster', 'morphed']) {
      const tag = `${name} ${pat}`;
      const on = planClearing(rings, clearingSettings(POCKET({ clearing: pat, loop: true, leadIn: true })));
      const closedPlan = planClearing(rings, clearingSettings(POCKET({ clearing: pat, loop: true })));
      if (name === 'island' && pat === 'morphed') { eq(on.refused, 'morphed islands', `${tag}: still refused with its reason`); continue; }
      eq([on.leadIn, on.leadInRefused, on.clear.length], [true, null, closedPlan.clear.length], `${tag}: every loop gets its lead-in`);
      on.clear.forEach((c, i) => {
        const base = closedPlan.clear[i];
        eq([c.closed, c.points.length], [false, base.points.length + 1], `${tag} loop ${i + 1}: OPEN, one point more (the tip)`);
        eq(c.points.slice(1), base.points, `${tag} loop ${i + 1}: then the closed loop itself, from its start back to it`);
        const tip = c.points[0], J = c.points[1];
        eq([J, c.points.at(-1)], [c.leadIn.junction, c.leadIn.junction], `${tag} loop ${i + 1}: its two ends are the tip and the junction`);
        near(dist(tip, J), 6, 1e-9, `${tag} loop ${i + 1}: the leg is one bit diameter`);
        let worst = Infinity;
        for (let k = 0; k <= 20; k++) {
          const p = { x: J.x + ((tip.x - J.x) * k) / 20, y: J.y + ((tip.y - J.y) * k) / 20 };
          ok(inPoly(p, outer) && !holes.some((h) => inPoly(p, h)), `${tag} loop ${i + 1}: the leg stays inside the pocket, out of every island`);
          worst = Math.min(worst, distRing(p, outer), ...holes.map((h) => distRing(p, h)));
        }
        ok(worst >= 3 - 0.02, `${tag} loop ${i + 1}: the leg stays the bit radius from the wall and the islands (closest ${worst.toFixed(4)} mm): inside the cleared region`);
      });
      ok(on.leftover.area <= closedPlan.leftover.area + 1e-6, `${tag}: the leftover is not larger (${on.leftover.area} vs ${closedPlan.leftover.area})`);
      // the export: one open on-line path per loop
      const els = elementsOf(one(st, POCKET({ clearing: pat, loop: true, leadIn: true })));
      eq(els.map((e) => [e.cutType, pathPoints(e.d).closed]), on.clear.map(() => ['online', false]), `${tag}: the download: ${on.clear.length} open on-line path(s), no Z`);
      // Loop off ignores it
      eq(one(st, POCKET({ clearing: pat, leadIn: true })), one(st, POCKET({ clearing: pat })), `${tag}: Loop off: the lead-in is ignored (byte-identical)`);
    }
  }
  const st = SHAPES.rectangle;
  eq(one(st, POCKET({ leadIn: true, loop: true })), one(st, POCKET()), 'Freehand: the lead-in is ignored');
  const rings = pocketRings(deriveProfileCuts({ kind: 'loop', id: outerOf(st).id }, { cutType: 'pocket' }, st, findLoops(st), polysOf(st)).find((c) => c.isCompound), st);
  const tooLong = planClearing(rings, clearingSettings(POCKET({ clearing: 'linked', loop: true, leadIn: true, leadInLength: 80 })));
  eq([tooLong.leadIn, tooLong.leadInRefused, tooLong.clear.every((c) => c.closed)], [false, 'lead-in room', true], 'an 80 mm leg fits nowhere: refused, closed loops');
  const short = planClearing(rings, clearingSettings(POCKET({ clearing: 'linked', loop: true, leadIn: true, leadInLength: 2 })));
  eq([short.leadIn, short.leadInRefused], [false, 'lead-in short'], 'a 2 mm leg under the 3 mm bit radius: refused');
}

// ── 3. TABS on an On line outline ──
{
  const st = polyState([RECT]);
  const TABS = (more = {}) => ONLINE({ cutDepth: 18, holdPart: 'tabs', tabCount: 3, tabWidth: 10, ...more });
  for (const n of [3, 5, 'auto']) {
    const els = elementsOf(one(st, TABS({ tabCount: n })));
    const want = n === 'auto' ? 3 : n; // Auto: ceil(320 / 150) = 3
    eq(els.length, want, `${n} tabs: ${want} strokes`);
    const strokes = els.map((e) => pathPoints(e.d));
    ok(els.every((e) => e.cutType === 'online' && e.depth === '18.000 mm'), `${n}: every stroke an on-line cut at the full depth (the gaps are simply not cut)`);
    ok(strokes.every((s) => !s.closed && s.subpaths === 1), `${n}: every stroke OPEN, one each`);
    let total = 0;
    strokes.forEach((s, k) => {
      for (let i = 1; i < s.pts.length; i++) total += dist(s.pts[i - 1], s.pts[i]);
      const next = strokes[(k + 1) % strokes.length];
      near(dist(s.pts.at(-1), next.pts[0]), 10, 0.01, `${n}: gap ${k + 1} = the tab width (a tab lies on one straight edge)`);
    });
    near(total + want * 10, 320, 1e-6, `${n}: the strokes + the gaps = the perimeter`);
  }
  const preview = elementsOf(one(st, TABS(), { groupByCut: true, previewData: true }));
  eq(preview.map((e) => e.a['data-hold']), ['stroke 1/3', 'stroke 2/3', 'stroke 3/3'], 'the preview copy: data-hold="stroke k/N"');
  // the Review: the strokes at the full depth, the tab middles uncut
  const rec = TABS(), cuts = cutsOf(st, rec), fps = deriveCutFootprint(cuts, rec, st);
  eq(fps.map((f) => [f.kind, f.hold.role, f.hold.depth]), [['band', 'stroke', 18], ['band', 'stroke', 18], ['band', 'stroke', 18]], 'footprints: one band per stroke, at 18 mm');
  const strokes = elementsOf(one(st, rec)).map((e) => pathPoints(e.d));
  strokes.forEach((s, k) => {
    const next = strokes[(k + 1) % strokes.length], mid = { x: (s.pts.at(-1).x + next.pts[0].x) / 2, y: (s.pts.at(-1).y + next.pts[0].y) / 2 };
    ok(!fps.some((f) => f.rings.some((r) => inPoly(mid, r))), `tab ${k + 1}: its middle is not swept: it stands`);
  });
  // a circle: the gaps along the arc
  const circ = polyState([], [['c', [50, 50], 40]]);
  const cs = elementsOf(one(circ, TABS())).map((e) => pathPoints(e.d));
  eq(cs.length, 3, 'circle: 3 strokes');
  cs.forEach((s, k) => near(2 * 40 * Math.asin(dist(s.pts.at(-1), cs[(k + 1) % 3].pts[0]) / 80), 10, 0.01, `circle gap ${k + 1}: 10 mm along the arc`));
  // onion skin: the whole line at depth - skin; an open line too
  eq(elementsOf(one(st, ONLINE({ cutDepth: 18, holdPart: 'skin', holdThickness: 2 }))).map((e) => [e.depth, pathPoints(e.d).closed]), [['16.000 mm', true]], 'onion skin: the closed line at 16 mm');
  const ch = polyState([], [], [[[0, 0], [50, 0], [50, 30]]]);
  const chain = findOpenChains(ch, findLoops(ch))[0];
  const chainSvg = (r) => exportOf(ch, [{ target: { kind: 'chain', id: chain.id }, rec: r }]);
  eq(elementsOf(chainSvg(ONLINE({ cutDepth: 18, holdPart: 'skin', holdThickness: 2 }))).map((e) => e.depth), ['16.000 mm'], 'onion skin on an open line: 16 mm');
  const chainHold = deriveCuts({ kind: 'chain', id: chain.id }, ONLINE({ cutDepth: 18, holdPart: 'skin', holdThickness: 2 }), ch, findLoops(ch), {}, new Set())[0];
  eq(deriveCutFootprint([chainHold], ONLINE(), ch)[0].hold.depth, 16, 'the open line\'s skin depth rides on its footprint (the Review)');
  // refusals: exported as without
  const chainTabs = deriveCuts({ kind: 'chain', id: chain.id }, TABS(), ch, findLoops(ch), {}, new Set())[0];
  eq(chainTabs.hold.error, 'open chain', 'tabs on an open line: refused');
  eq(chainSvg(TABS()), chainSvg(ONLINE({ cutDepth: 18 })), 'refused: the open line exported as without');
  eq(cutsOf(st, TABS({ tabWidth: BIT })).find((c) => c.hold).hold.error, 'tab narrow', 'a tab no wider than the bit: refused (no wood would stay)');
  const small = polyState([[[0, 0], [12, 0], [12, 12], [0, 12]]]);
  eq(cutsOf(small, TABS()).find((c) => c.hold).hold.error, 'no room', 'a 12 mm square, 10 mm tabs: no room');
  eq(one(small, TABS()), one(small, ONLINE({ cutDepth: 18 })), 'no room: exported as without');
  // a profile's hole stays closed; only the record's own outline gets its tabs
  const plate = polyState([RECT, ISLAND]);
  eq(elementsOf(one(plate, TABS())).map((e) => pathPoints(e.d).closed), [true, false, false, false], 'a profile with a hole: the hole closed, the outline in 3 strokes');
  eq(one(st, ONLINE({ cutDepth: 18, holdPart: 'off', tabCount: 3, tabWidth: 10 })), one(st, ONLINE({ cutDepth: 18 })), 'Hold part Off on On line: byte-identical');
}

// ── 4. LOOP WORDING ──
{
  const root = new URL('..', import.meta.url);
  const hits = [];
  const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) { if (e.name !== 'vendor' && e.name !== 'node_modules') walk(p); } else if (/\.(js|html|css)$/.test(e.name)) fs.readFileSync(p, 'utf8').split('\n').forEach((l, i) => { if (/ends? where (it|they) starts?/i.test(l)) hits.push(`${p}:${i + 1}`); }); } };
  walk(path.join(root.pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'apps', 'shaper'));
  walk(path.join(root.pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'packages', 'core'));
  eq(hits, [], 'no text says a loop "ends where it starts" in apps/shaper or packages/core');
}

// ── 5. BYTE-IDENTICAL without the new options ──
{
  const base = JSON.parse(fs.readFileSync(new URL('./fixtures/leadin-775-before.json', import.meta.url), 'utf8'));
  const now = await leadinDigest();
  eq(Object.keys(now).sort(), Object.keys(base).sort(), 'the same drawings as the base digest');
  let n = 0;
  for (const [name, sets] of Object.entries(base)) for (const [set, facets] of Object.entries(sets)) { eq(now[name][set], facets, `${name} ${set}: download, preview copy, operations and 3D footprints identical to origin/main 5e79336`); n += Object.keys(facets).length; }
  console.log(`byte-identical: ${Object.keys(base).length} drawings, ${n} facets`);
}

// ── 6. the app ──
SettingsManager.set('DOC_UNIT', 'mm');
SettingsManager.set('LENGTH_PRECISION', null);
const drawInto = (app, src) => {
  const st = app.state;
  for (const k of [...st.joints.keys()]) st.joints.delete(k);
  st.shapes.length = 0; st.constraints.length = 0;
  for (const [k, v] of src.joints) st.joints.set(k, v);
  st.shapes.push(...src.shapes);
};
const harness = (app) => {
  const doc = app.document, q = (s) => doc.querySelector(s);
  const pressEl = (s) => { const e = typeof s === 'string' ? q(s) : s; assert(e, s + ' not found'); app.press(e); };
  const clickAt = (x, y, o) => { const pc = doc.getElementById('prepare-canvas'); const p = worldToScreen(pc, { x, y }); app.click(Math.round(p.x), Math.round(p.y), { target: pc, ...o }); };
  const pick = (id) => { pressEl('.cut-type-trigger'); pressEl(`.cut-type-opt[data-id="${id}"]`); };
  const clearing = (id) => { pressEl('.cut-clear-trigger'); pressEl(`.cut-clear-opt[data-clearing="${id}"]`); };
  const note = () => [...doc.querySelectorAll('.cut-note div')].map((d) => d.textContent);
  const typed = (cls, v) => { const i = q(cls); i.value = v; i.dispatchEvent(new app.window.Event('change')); };
  const shown = (row) => q(`.cut-row[data-row="${row}"]`).style.display !== 'none';
  const preset = (row, v) => pressEl(`.cut-row[data-row="${row}"] .cut-preset[data-value="${v}"]`);
  const presets = (row) => [...q(`.cut-row[data-row="${row}"]`).querySelectorAll('.cut-preset')].map((b) => b.textContent + (b.classList.contains('is-active') ? '*' : ''));
  const step = (row, d) => pressEl(`.cut-row[data-row="${row}"] .cut-step[data-d="${d}"]`);
  const toggleLoop = () => { const i = q('.cut-loop'); i.checked = !i.checked; i.dispatchEvent(new app.window.Event('change')); };
  const tg = () => doc.querySelector('#prepare-toolpath-group');
  const count = (sel) => tg().querySelectorAll(sel).length;
  return { q, pressEl, clickAt, pick, clearing, note, typed, shown, preset, presets, step, toggleLoop, count };
};
const keyAt = (st, x, y) => { const loops = findLoops(st), lp = polysOf(st); const l = loops.filter((l0) => inPoly({ x, y }, lp[l0.id])).sort((a, b) => Math.abs(area(lp[a.id])) - Math.abs(area(lp[b.id])))[0]; return keyOf('loop', l.id); };
const profile = await createProfile();
await createNamedDesign(profile, 'shaper', 'Lead-in 775');
let saved = null;
{
  CUT_PLAN.clear(); setOpOrder([]);
  const app = await open({ host: 'shaper', profile });
  try {
    const h = harness(app), st = app.state;
    h.pressEl('.sk-header-tab[data-tab="design"]');
    drawInto(app, polyState([RECT, [[120, 0], [220, 0], [220, 60], [120, 60]], [[0, 80], [100, 80], [100, 140], [0, 140]]], [], [[[130, 90], [200, 90], [200, 130]]]));
    st.saveState('draw');
    h.pressEl('.sk-header-tab[data-tab="prepare"]');
    // On line on the first rectangle
    h.clickAt(10, 10); h.pick('online'); h.typed('.cut-depth', '3');
    const kA = keyAt(st, 10, 10);
    ok(h.shown('leadIn') && !h.shown('leadInLength') && !h.shown('leadInSide'), 'On line outline: the Lead-in row, Off: no Length / Side rows');
    eq(h.presets('leadIn'), ['Off*', 'On'], 'Lead-in: Off | On, Off active');
    ok(h.shown('holdPart') && !h.shown('tabCount') && !h.shown('holdThickness'), 'On line: the Hold part row (Off)');
    eq(h.count('circle'), 0, 'a closed line: no dot (no start point on the Origin)');
    let n0 = st.history.length;
    h.preset('leadIn', 'true');
    eq([CUT_PLAN.get(kA).leadIn, CUT_PLAN.get(kA).leadInSide, CUT_PLAN.get(kA).leadInLength ?? null, st.history.length], [true, 'outside', null, n0 + 1], 'Lead-in On: ONE undo step; Outside; the length follows the bit (none stored)');
    ok(h.shown('leadInLength') && h.shown('leadInSide'), 'On: the Length and Side rows');
    eq([h.q('.cut-lead-length').value, h.presets('leadInSide')], ['3.175', ['Outside*', 'Inside']], 'Length = one bit diameter, Side Outside');
    eq([...h.q('.cut-row[data-row="leadInLength"] .cut-field-label').textContent, ''].join(''), 'Length', 'the Length label is the table\'s');
    eq(h.note(), ['On line: lead-in 3.175 mm outside, from the middle of the longest straight edge', TRADE_OFF], 'the note: the leg and the trade-off');
    eq([h.count('.sk-lead-leg'), h.count('.sk-lead-tip'), h.count('.sk-lead-end')], [1, 1, 1], 'Prepare: the leg, the tip dot (start) and the junction ring (the other end)');
    let els = elementsOf(shaperSvgOf(st, cutPlanEntries()));
    eq(els.map((e) => pathPoints(e.d).closed), [false], 'the download: ONE open path');
    const ops = planOperations(st, cutPlanEntries());
    ok(ops.some((op) => /lead-in outside/.test(op.label)), 'the operations row says lead-in: ' + ops.map((op) => op.label).join(' | '));
    eq(planLeadInNotes(st, CUT_PLAN), ['On line: lead-in 3.175 mm outside, from the middle of the longest straight edge', TRADE_OFF], 'the 3D Review info: the same note');
    n0 = st.history.length;
    h.step('leadInLength', 1);
    eq([CUT_PLAN.get(kA).leadInLength, st.history.length], [3.5, n0 + 1], 'Length +: 3.175 snaps up to the next 0.5 mm step, 3.5, ONE undo step');
    h.typed('.cut-lead-length', '6.35'); eq(CUT_PLAN.get(kA).leadInLength, 6.35, 'typed 6.35');
    h.typed('.cut-lead-length', '-1'); eq(CUT_PLAN.get(kA).leadInLength, 6.35, 'typed -1: refused');
    h.preset('leadInSide', 'inside'); eq(CUT_PLAN.get(kA).leadInSide, 'inside', 'Side Inside');
    const tip = pathPoints(elementsOf(shaperSvgOf(st, cutPlanEntries()))[0].d).pts[0];
    ok(inPoly(tip, XY(RECT)), 'Inside: the tip is inside the outline');
    h.typed('.cut-lead-length', '1');
    eq(h.note(), ['On line: lead-in refused: the leg 1 mm is shorter than the bit radius 1.587 mm; cut as a closed loop'], 'refused: the note says why');
    ok(h.q('.cut-note .cut-note-warn'), 'refused: in the warning colour');
    h.typed('.cut-lead-length', '6.35');
    app.undo(); eq(CUT_PLAN.get(kA).leadInLength, 1, 'undo: back one edit');
    app.redo(); eq(CUT_PLAN.get(kA).leadInLength, 6.35, 'redo');
    // Tabs on On line: no thickness row, the lead-in row goes, the note in the owner's words
    h.preset('holdPart', 'tabs');
    ok(h.shown('tabCount') && h.shown('tabWidth') && !h.shown('holdThickness'), 'On line Tabs: count and width, NO thickness (the gaps are not cut at all)');
    ok(!h.shown('leadIn') && !h.shown('leadInLength'), 'with Tabs: no Lead-in row (each stroke has its ends)');
    eq(h.q('.cut-row[data-row="tabWidth"] .sk-hint').textContent, 'How long each gap left uncut in the line is; the wood it keeps is this minus the bit diameter.', 'Tab width on On line: the gap\'s hint (the table\'s)');
    h.typed('.cut-tab-count', '3'); h.typed('.cut-tab-width', '10');
    eq(h.note(), ['Tabs: 3 gaps of 10 mm left uncut; cut them by hand afterwards', 'Each gap keeps 6.825 mm of wood with a 3.175 mm bit (the gap minus the bit)', 'On line: no lead-in with tabs: each stroke has its own ends'], 'the tabs note (the stored Lead-in On waits: no leg with tabs)');
    els = elementsOf(shaperSvgOf(st, cutPlanEntries()));
    eq(els.map((e) => [e.cutType, e.depth, pathPoints(e.d).closed]), Array(3).fill(['online', '3.000 mm', false]), 'the download: 3 open strokes at the full depth');
    eq([h.count('.sk-stroke'), h.count('.sk-tab-mark'), h.count('.sk-lead-tip')], [3, 3, 0], 'Prepare: the 3 strokes and the 3 tab marks, no lead-in');
    ok(planOperations(st, cutPlanEntries()).some((op) => /3 tabs \(gaps 10 mm left uncut\)/.test(op.label)), 'the operations row: 3 tabs');
    h.preset('holdPart', 'off');
    ok(h.shown('leadIn') && h.shown('leadInLength'), 'Tabs off: the Lead-in rows back');
    // the last values: the next outline turned On takes length 6.35, Inside
    h.clickAt(130, 10); h.pick('online'); h.typed('.cut-depth', '3');
    const kB = keyAt(st, 130, 10);
    h.preset('leadIn', 'true');
    eq([CUT_PLAN.get(kB).leadInLength, CUT_PLAN.get(kB).leadInSide], [6.35, 'inside'], 'the next record turned On takes the last length and side set');
    // an open line: no Lead-in row; Tabs refused with the reason
    h.clickAt(165, 90);
    const chainSel = [...CUT_PLAN.keys()];
    h.pick('online');
    const kC = [...CUT_PLAN.keys()].find((k) => k.startsWith('chain:'));
    ok(kC, 'the open line picked: ' + JSON.stringify(chainSel));
    ok(!h.shown('leadIn') && h.shown('holdPart'), 'an open line: no Lead-in row (it has its ends), the Hold part row');
    h.typed('.cut-depth', '3');
    h.preset('holdPart', 'tabs');
    eq(h.note(), ['On line: tabs refused: tabs need a closed outline: this is an open line; cut without them'], 'tabs on an open line: refused, the reason');
    h.preset('holdPart', 'off');
    // a programmed pocket with Loop on
    h.clickAt(10, 90); h.pick('pocket'); h.typed('.cut-depth', '6'); h.typed('.cut-bit', '6');
    const kP = keyAt(st, 10, 90);
    h.clearing('linked');
    ok(!h.shown('leadIn'), 'Spiral, Loop off: no Lead-in row');
    h.toggleLoop();
    ok(h.shown('leadIn') && !h.shown('leadInLength'), 'Loop on: the Lead-in row');
    eq(h.count('circle'), 0, 'Loop on, closed: no dot on the loop (no start point)');
    ok(/\+ wall: one closed loop, stepover/.test(h.note()[0]), 'the note: one closed loop (nothing about where it starts): ' + h.note()[0]);
    h.preset('leadIn', 'true');
    ok(h.shown('leadInLength') && !h.shown('leadInSide'), 'pocket Lead-in On: Length, no Side');
    eq(CUT_PLAN.get(kP).leadInLength, 6.35, 'the pocket takes the last length set too');
    const nt = h.note();
    ok(/\+ wall: one loop with a lead-in, stepover/.test(nt[0]) && nt.includes('Lead-in: a leg of 6.35 mm from inside the cleared area to the loop') && nt.includes(TRADE_OFF), 'the pocket note: ' + JSON.stringify(nt));
    eq([h.count('.sk-lead-tip'), h.count('.sk-lead-end')], [1, 1], 'Prepare: the pocket loop\'s tip and junction');
    const pocketEls = elementsOf(shaperSvgOf(st, [{ target: { kind: 'loop', id: kP.slice(5) }, rec: CUT_PLAN.get(kP) }]));
    eq(pocketEls.map((e) => [e.cutType, pathPoints(e.d).closed]), [['online', false]], 'the pocket download: ONE open on-line path');
    const pv = shaperSvgOf(st, cutPlanEntries(), { preview: true });
    ok(/data-clear="loop 1\/1" data-lead="in"/.test(pv), 'the preview copy: the pocket loop tagged with its lead-in');
    ok(planOperations(st, cutPlanEntries()).some((op) => /one loop with a lead-in/.test(op.label)), 'the operations row: one loop with a lead-in');
    saved = { plan: JSON.stringify([...CUT_PLAN.entries()]), svg: shaperSvgOf(st, cutPlanEntries()) };
    const d = await app.storedDoc();
    ok(d.hosts.shaper.cutPlan.some(([, r]) => r.leadIn === true && r.leadInLength === 6.35 && r.leadInSide === 'inside'), 'the autosave stores the lead-in fields');
    h.clickAt(300, 300);
  } finally { await app.close(); }
}
CUT_PLAN.clear();
{
  const app = await open({ host: 'shaper', profile });
  try {
    app.modes.showMode('prepare');
    eq(JSON.stringify([...CUT_PLAN.entries()]), saved.plan, 'after a reload the plan is equal');
    eq(shaperSvgOf(app.state, cutPlanEntries()), saved.svg, 'and the download is byte-identical');
  } finally { await app.close(); }
}
console.log(`leadin-775-node: ok (${checks} checks)`);
