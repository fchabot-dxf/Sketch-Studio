// tests/pocket-clearing-750-node.test.js — TASK 750: the programmed pocket's LOOP toggle (record field `loop`, any programmed pattern: Spiral, Raster, Morphed
// spiral) and NO depth per pass (#core/pocket-clearing.js, the one derivation; apps/shaper/src/shaper-doc.js, the one place a stored document is normalised).
//  1. rectangle, L, circle, island pocket, dumbbell (bit 6 mm, stepover 40 %, allowance 0.5 mm) x Spiral / Raster / Morphed spiral, Loop ON:
//     closed paths (first point == last point), one per chain (Spiral 1 / 1 / 1 / 3 / 2, Raster 1 / 1 / 1 / 1 / 2, Morphed 1 where it is possible; still refused
//     with its reason on the island pocket and the dumbbell); the LAST turn of every loop is a finish turn, every point of it exactly the bit radius from
//     the wall / island (0.01 mm); every turn / pass / clean-up ring of the Loop-OFF derivation is in a loop (vertex for vertex); the legs (links, steps,
//     returns) inside the region the bit may sweep (R inset by r, 0.02 mm); the Spiral's crossings only at its anchors (each on a ring) and counted;
//     the leftover == Loop OFF's (coverage identical: the finish turns sweep what the separate inside cut swept); allowance 0: no turn written twice.
//  2. the export: Loop ON = closed on-line paths only (d ends with Z, its first point == its last), one per loop, at the full depth, no inside / outside
//     element; Loop OFF = byte-identical to before (Spiral: 749's head, tests/fixtures/pocket-clearing-750-before.json; Raster / Morphed / Freehand: main,
//     pocket-clearing-749-node); no programmed export has two equal paths (no stacked copies).
//  3. the app: the Loop row (the card's checkbox) for Spiral, Raster and Morphed spiral, not Freehand; ONE undo step; the note; the last value remembered;
//     save + reload; no Depth per pass row; an old document whose records / operation order say passDepth opens without it and exports as the same
//     document without it (one copy at the full depth), its operation order kept.
import assert from 'node:assert';
import { hintFor } from '../apps/shaper/src/hint.js'; // TASK 805: the tooltip's text (hints are no longer laid out in the card)
import crypto from 'node:crypto';
import fs from 'node:fs';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { worldToScreen } from '#ui/coords.js';
import SettingsManager from '#core/settings-manager.js';
import { exportShaperSVG } from '#core/shaper-export.js';
import { findLoops } from '#core/loop-finder.js';
import { loopPolygon } from '#core/loop-geometry.js';
import { deserializeDocument } from '#core/document.js';
import { createSketchState as sketchState } from '#core/sketch-state.js';
import { createEngine } from '#core/constraint-solver.js';
import { deriveProfileCuts } from '#core/profile-model.js';
import { planClearing, clearingSettings, pocketRings } from '#core/pocket-clearing.js';
import { planEntries, keyOf } from '../apps/shaper/src/cut-plan.js';
import { exportEncoding } from '../apps/shaper/src/shaper.js';
import { shaperSvgOf } from '../apps/shaper/src/export-payload.js';
import { opKeyOf } from '../apps/shaper/src/operations.js';
import { V2_PLAN, storedRecords, storedOpKeys } from './helpers/plan-v2.js'; // TASK S1: the test's v2 document of the plan, loaded through applyShaperDoc
import { clickOpen, editStep } from './helpers/prepare-open.js'; // TASK S2: an operation is opened to edit it
import { passCoverage } from './helpers/raster-passes-835.js'; // TASK 835: how a Raster loop cuts the passes

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b} (tol ${tol})`); checks++; };
const BEFORE = JSON.parse(fs.readFileSync(new URL('./fixtures/pocket-clearing-750-before.json', import.meta.url), 'utf8'));
const BIT = 6, R = BIT / 2, ALLOW = 0.5, S = 0.4 * BIT, D0 = R + ALLOW;

function polyState(loops, circles = []) {
  const joints = new Map(), shapes = [];
  loops.forEach((pts, li) => pts.forEach((p, i) => {
    joints.set(`j${li}_${i}`, { x: p[0], y: p[1] });
    shapes.push({ id: `s${li}_${i}`, type: 'line', joints: [`j${li}_${i}`, `j${li}_${(i + 1) % pts.length}`] });
  }));
  for (const [id, c, r] of circles) { joints.set(id + 'o', { x: c[0], y: c[1] }); shapes.push({ id, type: 'circle', joints: [id + 'o'], radius: r }); }
  return { joints, shapes, constraints: [], groups: [], profiles: [] };
}
const RECT = [[0, 0], [100, 0], [100, 60], [0, 60]];
const LSHAPE = [[0, 0], [100, 0], [100, 40], [40, 40], [40, 100], [0, 100]];
const ISLAND = [[40, 20], [60, 20], [60, 40], [40, 40]];
const DUMBBELL = [[0, 0], [40, 0], [40, 18], [60, 18], [60, 0], [100, 0], [100, 40], [60, 40], [60, 22], [40, 22], [40, 40], [0, 40]];
const SHAPES = { rectangle: () => polyState([RECT]), L: () => polyState([LSHAPE]), circle: () => polyState([], [['c', [50, 50], 30]]), island: () => polyState([RECT, ISLAND]), dumbbell: () => polyState([DUMBBELL]) };
const LOOPS = { linked: { rectangle: 1, L: 1, circle: 1, island: 3, dumbbell: 2 }, raster: { rectangle: 1, L: 1, circle: 1, island: 1, dumbbell: 2 }, morphed: { rectangle: 1, L: 1, circle: 1 } };
function area(pts) { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j].x * pts[i].y - pts[i].x * pts[j].y; return a / 2; }
const polysOf = (st) => { const by = new Map(st.shapes.map((s) => [s.id, s])); const lp = {}; for (const l of findLoops(st)) lp[l.id] = loopPolygon(l, st, by); return lp; };
const outerLoopOf = (st) => { const loops = findLoops(st), lp = polysOf(st); return loops.reduce((a, l) => (Math.abs(area(lp[l.id])) > Math.abs(area(lp[a.id])) ? l : a), loops[0]); };
const POCKET = (more = {}) => ({ cutType: 'pocket', cutDepth: 6, cutOffset: 0, toolDia: BIT, cutterShape: 'endmill', stepover: 40, finishAllowance: ALLOW, rasterAngle: 0, ...more });
const exportOf = (st, rec, options = {}) => exportShaperSVG({ state: st, entries: [{ target: { kind: 'loop', id: outerLoopOf(st).id }, rec }], encoding: exportEncoding(), docUnit: 'mm', options, loopPolys: polysOf(st) });
const distSeg = (p, a, b) => { const vx = b.x - a.x, vy = b.y - a.y, L = vx * vx + vy * vy; const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / L)) : 0; return Math.hypot(p.x - a.x - t * vx, p.y - a.y - t * vy); };
const distPolyline = (p, pts, closed) => { let m = Infinity; const n = closed ? pts.length : pts.length - 1; for (let i = 0; i < n; i++) m = Math.min(m, distSeg(p, pts[i], pts[(i + 1) % pts.length])); return m; };
const inPoly = (p, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c; } return c; };
const toXY = (ring) => ring.slice(0, -1).map(([x, y]) => ({ x, y }));
function regionOf(st) {
  const pocket = deriveProfileCuts({ kind: 'loop', id: outerLoopOf(st).id }, { cutType: 'pocket' }, st, findLoops(st), polysOf(st)).find((c) => c.isCompound);
  const rings = pocketRings(pocket, st);
  const outer = toXY(rings.outer), holes = rings.holes.map(toXY);
  return { rings, outer, holes, inside: (p) => inPoly(p, outer) && !holes.some((h) => inPoly(p, h)), dist: (p) => Math.min(distPolyline(p, outer, true), ...holes.map((h) => distPolyline(p, h, true))) };
}
const plan = (reg, pattern, more = {}) => planClearing(reg.rings, clearingSettings(POCKET({ clearing: pattern, ...more })));
const elementsOf = (svg) => {
  const attrs = (s) => Object.fromEntries([...s.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  const out = []; let group = null;
  for (const line of svg.split('\n').map((l) => l.trim())) {
    if (line.startsWith('<g')) throw new Error('TASK 802: the export has a <g>, every element must carry its own cut attributes: ' + line);
    if (line.startsWith('</g')) { group = null; continue; }
    const m = /^<(path|circle|polygon)\s(.*)\/>$/.exec(line);
    if (!m) continue;
    const a = { ...(group || {}), ...attrs(m[2]) };
    out.push({ cutType: a['shaper:cutType'], depth: a['shaper:cutDepth'], tool: a['shaper:toolDia'], d: a.d || null });
  }
  return out;
};
const key = (p) => `${p.x},${p.y}`;
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

// ── 1 + 2. Loop ON / OFF on the five fixtures x three patterns ──
const measured = {};
for (const [name, mk] of Object.entries(SHAPES)) {
  const st = mk(), reg = regionOf(st);
  for (const pattern of ['linked', 'raster', 'morphed']) {
    const off = plan(reg, pattern), on = plan(reg, pattern, { loop: true }), tag = `${name} ${pattern}`;
    if (pattern === 'morphed' && name === 'dumbbell') continue; // TASK 804: morphed per area, its Loop checked in tests/pocket-nocross-804-node.test.js
    if (pattern === 'morphed' && name === 'island') {
      eq([on.refused, off.refused], [off.refused, 'morphed islands'], `${tag}: still refused with its reason, Loop or not`);
      eq(elementsOf(exportOf(st, POCKET({ clearing: pattern, loop: true }))).map((e) => e.cutType), ['pocket'], `${tag}: cut Freehand (the note says why)`);
      continue;
    }
    // TASK 804: the Spiral's and the Morphed spiral's Loop are the GRADUAL double spiral (zero crossings, the old interleave replaced): checked in
    // tests/pocket-nocross-804-node.test.js; Raster keeps 750's checks here
    if (pattern !== 'raster') continue;
    eq([on.refused, on.loopRefused, on.loop, off.loop], [null, null, true, false], `${tag}: Loop on is programmed`);
    eq(on.loopCount, LOOPS[pattern][name], `${tag}: ${LOOPS[pattern][name]} closed loop(s), one per chain`);
    ok(on.clear.every((c) => c.role === 'loop' && c.closed && key(c.points[0]) === key(c.points.at(-1))), `${tag}: every loop is closed (first point == last point)`);
    // the last turn of every loop is a finish turn exactly r from the wall / island
    let worstF = 0;
    const noFinish = [];
    for (const c of on.clear) {
      const last = c.turns.at(-1);
      // TASK 835: a Raster loop's wall ring is a balloon from its last point on the area's edge; after it only the closing stretch back to the seam (passes
      // of one line and a corridor side: what any closed path walks back over already cut ground)
      if (pattern === 'raster' && c.turns.some((t) => t.kind === 'finish')) {
        const after = c.turns.slice(c.turns.findLastIndex((t) => t.kind === 'finish') + 1);
        ok(after.length <= 2 && after.every((t) => t.kind === 'pass'), `${tag}: after loop ${c.index}'s last ring only the closing stretch (${JSON.stringify(after)})`);
      } else if (c.turns.some((t) => t.kind === 'finish')) eq(last.kind, 'finish', `${tag}: the last turn of loop ${c.index} is its finish turn`);
      else noFinish.push(`${tag} loop ${c.index}`); // a chain that ends deeper (749's rule): it never reaches a wall, its own outermost ring is its last turn
      for (const t of c.turns.filter((u) => u.kind === 'finish')) for (const p of c.points.slice(t.start, t.end + 1)) worstF = Math.max(worstF, Math.abs(reg.dist(p) - R));
      // after the last turn only the closing leg
      ok(c.points.length - 1 - last.end >= 0, `${tag}: the loop closes after its finish turn`);
    }
    eq(noFinish.length, name === 'island' && pattern === 'linked' ? 1 : 0, `${tag}: every loop ends with a finish turn but the chain that ends deeper (${JSON.stringify(noFinish)})`);
    ok(worstF <= 0.01, `${tag}: every finish turn is the region inset by exactly the bit radius (worst ${worstF.toFixed(5)} mm)`);
    // every turn / pass of the Loop-OFF derivation is in a loop, vertex for vertex (TASK 804b: Raster's Loop has no clean-up ring: the wall ring's sweep
    // covers it, the leftover below is Loop off's)
    // TASK 835: a Raster loop runs along every pass ONCE, from the area's edge to the area's edge, but for the gaps where a corridor leaves it (each at most
    // half a stepover: the bit sweeps it)
    if (pattern === 'raster') {
      const bad = (x) => !(x.twice <= 0.01 && x.uncut.every(([u, v]) => v - u <= S / 2 + 0.01 || v <= BIT + S + 0.01 || u >= x.length - BIT - S - 0.01)); // TASK 835b: or within the wall band of an end (a flush corridor)
      const cov = passCoverage(on.clear, off.clear.filter((c) => c.role === 'raster').map((c) => c.points));
      ok(!cov.some(bad), `${tag}: every pass cut once, edge to edge, but for its corridor gaps (${JSON.stringify(cov.find(bad))})`);
    } else {
      const all = new Set(on.clear.flatMap((c) => c.points.map(key)));
      const offPaths = off.clear.filter((c) => c.role !== 'cleanup').map((c) => c.points);
      const missing = offPaths.reduce((n, pts) => n + pts.filter((p) => !all.has(key(p))).length, 0);
      eq(missing, 0, `${tag}: every vertex of the Loop-OFF clearing (${offPaths.length} paths) is in the loops`);
    }
    // the finish turns: the wall's and each island's turns at r (the same centre lines the separate inside / outside cuts follow)
    const finTurns = on.clear.reduce((n, c) => n + c.turns.filter((t) => t.kind === 'finish').length, 0);
    ok(finTurns >= 1 + reg.holes.length, `${tag}: ${finTurns} finish turn(s): the wall's and each island's`);
    // the legs inside the region the bit may sweep (R inset by r)
    let worstLeg = Infinity, legLen = 0;
    for (const c of on.clear) {
      const inTurn = new Array(c.points.length - 1).fill(false);
      for (const t of c.turns) for (let i = t.start; i < t.end; i++) inTurn[i] = true;
      for (let i = 0; i + 1 < c.points.length; i++) {
        if (inTurn[i]) continue;
        const a = c.points[i], b = c.points[i + 1];
        legLen += Math.hypot(b.x - a.x, b.y - a.y);
        for (let t = 0; t <= 1; t += 0.05) { const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; ok(reg.inside(p), `${tag}: a leg point is inside the pocket`); worstLeg = Math.min(worstLeg, reg.dist(p) - R); }
      }
    }
    ok(worstLeg >= -0.02, `${tag}: every link / step / return leg lies inside R inset by r (worst ${worstLeg.toFixed(4)} mm)`);
    near(legLen, on.loopExtra, 0.01, `${tag}: loopExtra = the legs' length`);
    // the Spiral's crossings: only at its anchors (each on a ring: r + a + k s from the edge), one per ring a step passes
    if (pattern === 'linked') {
      let anchorsOnRings = 0, worstA = 0;
      for (const c of on.clear) {
        for (let k = 1; k < c.turns.length; k++) {
          const via = c.points.slice(c.turns[k - 1].end + 1, c.turns[k].start); // the anchors a step runs through
          for (const p of via) { const d = reg.dist(p) - D0; const lvl = Math.round(d / S); worstA = Math.max(worstA, Math.abs(d - lvl * S)); anchorsOnRings++; }
        }
      }
      eq(anchorsOnRings, on.loopCrossings, `${tag}: the crossings are the anchors the steps run through (${on.loopCrossings})`);
      ok(worstA <= 0.02, `${tag}: each crossing is on a ring (worst ${worstA.toFixed(4)} mm)`);
      // in on every second ring, out on the ones between: the turns' levels of a loop
      const lv = (c, t) => Math.round((reg.dist(c.points[t.start]) - D0) / S);
      const seq = on.clear.map((c) => c.turns.map((t) => (t.kind === 'finish' ? -1 : lv(c, t))));
      ok(seq.every((q) => q.every((v, i) => i === 0 || Math.abs(v - q[i - 1]) <= 2)), `${tag}: every step is one or two rings (levels ${JSON.stringify(seq[0])})`);
    }
    // coverage: the leftover == Loop OFF's (the finish turns sweep what the separate inside / outside cuts swept)
    near(on.leftover.area, off.leftover.area, 0.01, `${tag}: the leftover == Loop OFF's (${off.leftover.area.toFixed(3)} mm²)`);
    near(on.leftover.missed, off.leftover.missed, 0.01, `${tag}: nothing more missed`);
    // allowance 0: no turn written twice
    {
      const on0 = plan(reg, pattern, { loop: true, finishAllowance: 0 }), off0 = plan(reg, pattern, { finishAllowance: 0 });
      // TASK 804: with no allowance the L's innermost ring is a sliver whose morphed turn crossed itself at its tip (0.008 mm): refused, never cut crossing
      if (off0.refused === 'morphed area') { eq([on0.refused, name, pattern], ['morphed area', 'L', 'morphed'], `${tag}: allowance 0: refused (its turns would cross)`); }
      else {
      const ringsOn0 = on0.clear.reduce((n, c) => n + c.turns.filter((t) => t.kind !== 'pass').length, 0);
      const ringsOff0 = pattern === 'linked' ? off0.loops : pattern === 'raster' ? off0.cleanup : 1;
      eq(ringsOn0, ringsOff0, `${tag}: allowance 0: ${ringsOff0} turn(s), none written twice (the last ring IS the finish turn)`);
      }
    }
    // the export: closed on-line paths (one per loop, at the full depth) + 1 guide start mark (TASK 778)
    const els = elementsOf(exportOf(st, POCKET({ clearing: pattern, loop: true })));
    const loopsOut = els.filter((e) => e.cutType !== 'guide');
    eq(els.map((e) => e.cutType), [...Array(on.loopCount).fill('online'), 'guide'], `${tag}: the download: ${on.loopCount} on-line path(s) + 1 guide start mark, no inside / outside element`);
    ok(loopsOut.every((e) => /Z$/.test(e.d) && e.depth === '6.000 mm' && e.tool === '6.000 mm'), `${tag}: each closed (Z), at the full depth, the card's bit`);
    ok(loopsOut.every((e) => { const n = e.d.replace(/[MLZ]/g, ' ').trim().split(/\s+/); return n[0] === n[n.length - 2] && n[1] === n[n.length - 1]; }), `${tag}: each path's first point == its last`);
    eq(new Set(els.map((e) => e.d)).size, els.length, `${tag}: no stacked copies`);
    const offEls = elementsOf(exportOf(st, POCKET({ clearing: pattern })));
    eq(new Set(offEls.map((e) => e.d)).size, offEls.length, `${tag}: Loop off: no stacked copies either`);
    measured[`${name} ${pattern}`] = { loops: on.loopCount, crossings: on.loopCrossings, extraMm: +on.loopExtra.toFixed(1), leftover: +on.leftover.area.toFixed(3) };
  }
}
console.log('loop: ' + JSON.stringify(measured));
{ // Loop OFF: the Spiral adds ONLY 1 guide start-mark element vs 749's head (everything else byte-identical)
  const stripStartMark = (svg) => {
    const kept = [], removed = [];
    for (const l of svg.split('\n')) {
      if (/^  <path d="M [^"]+ A [^"]+ A [^"]+ M [^"]+ L [^"]+ M [^"]+ L [^"]+"[^>]*shaper:cutType="guide"[^>]*\/>$/.test(l)) removed.push(l);
      else kept.push(l);
    }
    return { svg: kept.join('\n'), removed };
  };
  let n = 0;
  for (const [k, want] of Object.entries(BEFORE.exports)) {
    const [name, , more, okey] = k.split('|');
    if (okey === 'grouped') continue; // TASK 802: there is no grouped download any more; its flat twin key is the check
    const svg = exportOf(SHAPES[name](), POCKET({ clearing: 'linked', ...JSON.parse(more) }), {});
    const stripped = stripStartMark(svg);
    eq(stripped.removed.length, 1, `${k}: ONLY 1 guide start-mark element added`);
    eq(md5(stripped.svg), want, `${k}: removing ONLY the guide start mark is byte-identical to before`);
    n++;
  }
  console.log(`Spiral Loop off byte-identical to ${BEFORE.from} (except +1 guide start mark): ${n} downloads`);
}

// ── 3. the app ──
SettingsManager.set('DOC_UNIT', 'mm');
SettingsManager.set('LENGTH_PRECISION', null);
const drawInto = (app, st0) => {
  const st = app.state;
  for (const k of [...st.joints.keys()]) st.joints.delete(k);
  st.shapes.length = 0; st.constraints.length = 0;
  for (const [k, v] of st0.joints) st.joints.set(k, v);
  st.shapes.push(...st0.shapes);
};
const harness = (app) => {
  const doc = app.document, q = (s) => doc.querySelector(s);
  const pressElRaw = (s) => { const e = typeof s === 'string' ? q(s) : s; assert(e, s + ' not found'); app.press(e); };
  const pressEl = (s) => editStep(app, () => pressElRaw(s)); // TASK S2: a change of the open operation = its own step (tests/helpers/prepare-open.js)
  const clickRaw = (x, y, o) => { const pc = doc.getElementById('prepare-canvas'); const p = worldToScreen(pc, { x, y }); app.click(Math.round(p.x), Math.round(p.y), { target: pc, ...o }); };
  const clickAt = (x, y, o) => clickOpen(app, () => clickRaw(x, y, o)); // TASK S2: OK the open operation, click, open the clicked shape's operation (tests/helpers/prepare-open.js)
  const pick = (id) => { pressEl('.cut-type-trigger'); pressEl(`.cut-type-opt[data-id="${id}"]`); };
  const clearing = (id) => { pressEl('.cut-clear-trigger'); pressEl(`.cut-clear-opt[data-clearing="${id}"]`); };
  const note = () => [...doc.querySelectorAll('.cut-note div')].map((d) => d.textContent);
  const typedRaw = (cls, v) => { const i = q(cls); i.value = v; i.dispatchEvent(new app.window.Event('change')); };
  const typed = (cls, v) => editStep(app, () => typedRaw(cls, v)); // TASK S2: a change of the open operation = its own step (tests/helpers/prepare-open.js)
  const shown = (row) => { const r = q(`.cut-row[data-row="${row}"]`); return r.style.display !== 'none' && !('off' in r.dataset); }; // TASK 813: a row that does not apply stays in place, greyed (data-off): not shown as an applicable row
  const toggleLoop = () => editStep(app, () => { const i = q('.cut-loop'); i.checked = !i.checked; i.dispatchEvent(new app.window.Event('change')); }); // TASK S2: a change of the open operation = its own step (tests/helpers/prepare-open.js)
  return { q, pressEl, clickAt, pick, clearing, note, typed, shown, toggleLoop };
};
const keyAt = (st, x, y) => { const loops = findLoops(st), lp = polysOf(st); const l = loops.filter((x0) => inPoly({ x, y }, lp[x0.id])).sort((a, b) => Math.abs(area(lp[a.id])) - Math.abs(area(lp[b.id])))[0]; return keyOf('loop', l.id); };
const profile = await createProfile();
await createNamedDesign(profile, 'shaper', 'Loop 750');
let saved = null;
{
  V2_PLAN.clear(); V2_PLAN.setOrder([]);
  const app = await open({ host: 'shaper', profile });
  try {
    const h = harness(app), st = app.state;
    h.pressEl('.sk-header-tab[data-tab="design"]');
    drawInto(app, polyState([RECT, [[120, 0], [220, 0], [220, 60], [120, 60]]]));
    st.saveState('draw');
    h.pressEl('.sk-header-tab[data-tab="prepare"]');
    h.clickAt(10, 10); h.pick('pocket'); h.typed('.cut-depth', '6'); h.typed('.cut-bit', '6');
    ok(!h.shown('loop') && !h.q('.cut-pass-depth') && !h.q('.cut-row[data-row="passDepth"]'), 'Freehand: no Loop row; no Depth per pass row at all');
    const kA = keyAt(st, 10, 10);
    for (const pat of ['linked', 'raster', 'morphed']) {
      h.clearing(pat);
      ok(h.shown('loop') && h.q('.cut-loop').checked === false, `${pat}: the Loop row (the card's checkbox), off`);
      eq(V2_PLAN.get(kA).loop, false, `${pat}: Loop off by default (stored)`);
      const n0 = st.history.length;
      h.toggleLoop();
      eq([V2_PLAN.get(kA).loop, st.history.length], [true, n0 + 1], `${pat}: Loop on, ONE undo step`);
      eq(hintFor(h.q('.cut-row[data-row="finishAllowance"] [data-hint]')), 'Left on the walls by the clearing passes; the loop’s turn along the wall takes it off for a clean edge. 0 = none.', `${pat}: TASK 766 / 770: Loop on: the hint names the loop's turn along the wall (the row's hint, param-hints.js)`);
      const nt = h.note(), nf = h.note().filter((l) => !/^Leftover: |^Sharp inside corners|of it missed between passes/.test(l)); // TASK 825: the warning lines (the leftover) come first
      ok(/\+ wall: one closed loop, stepover 2\.4 mm/.test(nf[0]), `${pat}: the note: ${nf[0]}`); // TASK 775: a closed loop has no start point (no "ends where it starts")
      ok(nt.includes('Wall cut in the same line: exact for a 6 mm bit only') && nt.includes('Depth passes: set Pass Depth or AutoPass on the Origin'), `${pat}: the note: exact for the card's bit only; the depth passes on the Origin`);
      eq(elementsOf(shaperSvgOf(st, planEntries())).map((e) => [e.cutType, /Z$/.test(e.d)]), [['online', true], ['guide', false]], `${pat}: the download: ONE closed on-line path + 1 guide start mark, no inside cut`);
      eq(app.document.querySelectorAll('#prepare-toolpath-group .sk-lead-tip, #prepare-toolpath-group .sk-lead-end, #prepare-toolpath-group circle').length, 0, `${pat}: TASK 775: no dot on a closed loop (it has no start point on the Origin)`);
      eq(app.document.querySelectorAll('#prepare-toolpath-group .sk-pocket-start').length, 1, `${pat}: TASK 778: 1 pocket start mark target in Prepare`);
      app.undo();
      eq([V2_PLAN.get(kA).loop, h.q('.cut-loop').checked], [false, false], `${pat}: undo: Loop off again`);
      const offEls = elementsOf(shaperSvgOf(st, planEntries()));
      ok(offEls.length >= 3 && offEls.at(-1).cutType === 'guide' && offEls.at(-2).cutType === 'inside' && offEls.slice(0, -2).every((e) => e.cutType === 'online'), `${pat}: Loop off: on-line paths + the inside cut + 1 guide start mark`);
      app.redo();
      eq(V2_PLAN.get(kA).loop, true, `${pat}: redo: Loop on`);
      h.toggleLoop();
      eq(V2_PLAN.get(kA).loop, false, `${pat}: Loop off again (the next pattern starts from the record's own value)`);
    }
    h.toggleLoop(); // the Morphed spiral with Loop on: the last value set
    // the last value remembered: the next pocket set to a programmed clearing starts with Loop on
    h.clickAt(130, 10); h.pick('pocket'); h.typed('.cut-depth', '6'); h.typed('.cut-bit', '6');
    h.clearing('linked');
    eq([V2_PLAN.get(keyAt(st, 130, 10)).loop, h.q('.cut-loop').checked], [true, true], 'the last Loop set (on) is the next pocket\'s');
    const ops = [...app.document.querySelectorAll('#prepare-ops .ops-row')].map((r) => `${r.querySelector('.ops-name').textContent} | ${r.querySelector('.ops-sub').textContent}`);
    console.log('ops: ' + JSON.stringify(ops));
    ok(ops.some((t) => /^Pocket \(morphed spiral\) · 6 mm \| 1 region · morphed spiral: \d+ turns \+ wall: one closed loop$/.test(t)) && ops.some((t) => /^Pocket \(spiral\) · 6 mm \| 1 region · spiral, \d+ turns \+ wall: one closed loop$/.test(t)), 'the operations list says the loop');
    saved = { plan: JSON.stringify([...V2_PLAN]), svg: shaperSvgOf(st, planEntries()) };
    const d = await app.storedDoc();
    ok(JSON.stringify(storedRecords(d.hosts.shaper)).includes('"loop":true') && !JSON.stringify(d.hosts.shaper).includes('passDepth'), 'the autosave stores loop, and no passDepth');
  } finally { await app.close(); }
}
V2_PLAN.clear(); V2_PLAN.setOrder([]);
{
  const app = await open({ host: 'shaper', profile });
  try {
    eq(JSON.stringify([...V2_PLAN]), saved.plan, 'after a reload the records are back (Loop on)');
    eq(shaperSvgOf(app.state, planEntries()), saved.svg, 'and the download is byte-identical');
  } finally { await app.close(); }
}
// an old document with passDepth (records and the stored operation order): opens without it, exports as the same document without it
{
  const createSketchState = () => { const e = createEngine(null); e.init(); return sketchState(e, { x: 0, y: 0, w: 100, h: 100 }); };
  const joints = [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }]], shapes = [];
  const poly = (p, pts) => { pts.forEach(([x, y], i) => joints.push([p + i, { x, y, sketchId: 'sketch-1' }])); pts.forEach((_, i) => shapes.push({ id: p + 's' + i, type: 'line', joints: [p + i, p + ((i + 1) % pts.length)], sketchId: 'sketch-1' })); };
  poly('A', RECT); poly('B', LSHAPE.map(([x, y]) => [x + 120, y])); poly('C', [[240, 0], [300, 0], [300, 40], [240, 40]]);
  const scratch = createSketchState();
  deserializeDocument({ version: 3, geometry: { joints, shapes, constraints: [] } }, scratch);
  const loopOf = (prefix) => findLoops(scratch).find((l) => l.edges.includes(prefix + 's0')).id;
  const recs = { A: POCKET({ clearing: 'linked' }), B: POCKET({ clearing: 'raster' }), C: POCKET({ clearing: 'morphed', toolDia: 3.175 }) };
  const keysNow = Object.values(recs).map(opKeyOf).reverse();
  const oldKey = (k) => k.replace(/("allowance":[\d.]+)/, '$1,"passDepth":2'); // 745 wrote passDepth after the allowance
  ok(keysNow.every((k) => oldKey(k) !== k), 'the old keys carry passDepth');
  const doc = (withPass) => JSON.parse(JSON.stringify({
    version: 3,
    geometry: { joints, shapes, constraints: [], sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }], activeSketchId: 'sketch-1', groups: [], profiles: [], parameters: [] },
    hosts: { shaper: { version: 1, cutPlan: Object.entries(recs).map(([p, r]) => [keyOf('loop', loopOf(p)), withPass ? { ...r, passDepth: 2 } : r]), stock: { thickness: 19.05, width: null, height: null, margin: 12.7 }, opOrder: withPass ? keysNow.map(oldKey) : keysNow } },
  }));
  const seen = {};
  for (const [label, withPass] of [['without', false], ['old', true]]) {
    V2_PLAN.clear(); V2_PLAN.setOrder([]);
    const pf = await createProfile(); await createNamedDesign(pf, 'shaper', 'Pass ' + label, doc(withPass));
    const app = await open({ host: 'shaper', profile: pf });
    try { seen[label] = { has: [...V2_PLAN.values()].some((r) => 'passDepth' in r), order: storedOpKeys(), svg: shaperSvgOf(app.state, planEntries()) }; } finally { await app.close(); }
  }
  eq(seen.old.has, false, 'an old document\'s passDepth is dropped on read');
  eq(seen.old.order, keysNow, 'its stored operation order is kept (passDepth dropped from the keys)');
  eq(seen.old.svg, seen.without.svg, 'its export == the same document without passDepth (byte for byte): one copy at the full depth');
  const els = elementsOf(seen.old.svg);
  eq(new Set(els.map((e) => e.d)).size, els.length, 'no stacked duplicate paths');
  eq([...new Set(els.filter((e) => e.cutType !== 'guide').map((e) => e.depth))], ['6.000 mm'], 'every cut at the full depth (start marks are guides)');
  V2_PLAN.clear(); V2_PLAN.setOrder([]);
}
console.log(`pocket-clearing-750-node.test.js: ok (${checks} checks)`);
