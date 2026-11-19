// tests/pocket-clearing-749-node.test.js — TASK 749: the Shaper pocket's SPIRAL (#core/pocket-clearing.js 'linked'): 745's concentric rings traversed inside
// out as ONE open on-line path per chain of rings, a straight LINK from the end of each ring to the nearest point of the next ring out. (749's "wall in the
// same line" became TASK 750's Loop: tests/pocket-clearing-750-node.test.js; Loop off here.)
//  1. rectangle, L, circle, island pocket, dumbbell (bit 6 mm, stepover 40 %, allowance 0.5 mm): the lines (1 / 1 / 1 / 3 / 2: one per chain);
//     every ring of an independent computation (the region offset by r + a + k s with #core/plot/clip.js) is ONE full loop of one line, each once; inside
//     out; every LINK lies inside the region of its outer ring (so inside the inset region: never across the wall or an island) and is one stepover long
//     within the stated bound (s - 0.02 <= |link| <= s + 0.02 mm); the swept area == the separate rings' swept area (+ the finish pass); the leftover ==
//     origin/main's Concentric leftover on the same fixture (tests/fixtures/pocket-clearing-749-main.json); the coverage on a 0.5 mm grid.
//  2. (moved to pocket-clearing-750-node: the Loop.) The export: the lines once at the full depth, then the wall / island cuts as 745.
//  3. Freehand / Raster / Morphed spiral downloads byte-identical to origin/main's (md5 of 120 downloads in the fixture, from main's own exporter); TASK 750:
//     a record that still says passDepth 2.5 exports as main's one-pass download (no depth per pass: the clearing once, at the full depth).
//  4. an old document ('concentric' / 'spiral' and the stored operation order) opens as 'linked' / 'morphed' (apps/shaper/src/shaper-doc.js, the one read),
//     its operation order kept, its export == the same document authored with the new values.
import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { exportShaperSVG } from '#core/shaper-export.js';
import { findLoops } from '#core/loop-finder.js';
import { loopPolygon } from '#core/loop-geometry.js';
import { deserializeDocument } from '#core/document.js';
import { createSketchState as sketchState } from '#core/sketch-state.js';
import { createEngine } from '#core/constraint-solver.js';
import { deriveProfileCuts } from '#core/profile-model.js';
import { planClearing, clearingSettings, pocketRings, POCKET_CLEARING } from '#core/pocket-clearing.js';
import { offsetRegions, regionsFromRings, sweepPaths, diffRegions, regionsArea } from '#core/plot/clip.js';
import { CUT_PLAN, cutPlanEntries, keyOf } from '../apps/shaper/src/cut-plan.js';
import { exportEncoding } from '../apps/shaper/src/shaper.js';
import { shaperSvgOf } from '../apps/shaper/src/export-payload.js';
import { opOrder, setOpOrder, opKeyOf } from '../apps/shaper/src/operations.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b} (tol ${tol})`); checks++; };
const MAIN = JSON.parse(fs.readFileSync(new URL('./fixtures/pocket-clearing-749-main.json', import.meta.url), 'utf8'));
const BIT = 6, R = BIT / 2, ALLOW = 0.5, S = 0.4 * BIT, D0 = R + ALLOW, LINK_TOL = 0.02;

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
const LINES = { rectangle: 1, L: 1, circle: 1, island: 3, dumbbell: 2 };
function area(pts) { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j].x * pts[i].y - pts[i].x * pts[j].y; return a / 2; }
const polysOf = (st) => { const by = new Map(st.shapes.map((s) => [s.id, s])); const lp = {}; for (const l of findLoops(st)) lp[l.id] = loopPolygon(l, st, by); return lp; };
const outerLoopOf = (st) => { const loops = findLoops(st), lp = polysOf(st); return loops.reduce((a, l) => (Math.abs(area(lp[l.id])) > Math.abs(area(lp[a.id])) ? l : a), loops[0]); };
const POCKET = (more = {}) => ({ cutType: 'pocket', cutDepth: 6, cutOffset: 0, toolDia: BIT, cutterShape: 'endmill', stepover: 40, finishAllowance: ALLOW, rasterAngle: 0, ...more });
const exportOf = (st, rec, options = { groupByCut: true }) => exportShaperSVG({ state: st, entries: [{ target: { kind: 'loop', id: outerLoopOf(st).id }, rec }], encoding: exportEncoding(), docUnit: 'mm', options, loopPolys: polysOf(st) });
const plan = (reg, more) => planClearing(reg.rings, clearingSettings(POCKET({ clearing: 'linked', ...more })));
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
const perimeter = (pts, closed) => { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); if (closed) L += Math.hypot(pts[0].x - pts.at(-1).x, pts[0].y - pts.at(-1).y); return L; };
const spansOf = (pl) => pl.clear.flatMap((c, li) => c.rings.map((g) => ({ ...g, line: li, pts: c.points.slice(g.start, g.end + 1) })));
const linksOf = (pl) => pl.clear.flatMap((c) => c.links.map((f, j) => ({ a: c.points[f], b: c.points[f + 1], outer: c.rings[j + 1] })));
// independent rings: the region (as #core/pocket-clearing reads it) offset inward by r + a + k s, straight from the region, until nothing is left
function ringsOf(reg, d0) {
  const Rg = regionsFromRings([reg.rings.outer, ...reg.rings.holes], 'evenodd'), out = [];
  for (let k = 0; ; k++) { const E = offsetRegions(Rg, -(d0 + k * S), POCKET_CLEARING.chordTolMm); if (!E.length) break; out.push(E.flatMap((g) => [g.outer, ...g.holes]).map(toXY)); }
  return { Rg, out };
}
const elementsOf = (svg) => {
  const attrs = (s) => Object.fromEntries([...s.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  const out = []; let group = null;
  for (const line of svg.split('\n').map((l) => l.trim())) {
    if (line.startsWith('<g')) { group = attrs(line); continue; }
    if (line.startsWith('</g')) { group = null; continue; }
    const m = /^<(path|circle|polygon)\s(.*)\/>$/.exec(line);
    if (!m) continue;
    const a = { ...(group || {}), ...attrs(m[2]) };
    out.push({ cutType: a['shaper:cutType'], depth: a['shaper:cutDepth'], tool: a['shaper:toolDia'], offset: a['shaper:cutOffset'], d: a.d || null });
  }
  return out;
};
const dPts = (d) => d.replace(/[MLZ]/g, ' ').trim().split(/\s+/).map(Number);
const ptsD = (pts) => pts.flatMap((p) => [Math.round(p.x * 1e4) / 1e4, Math.round(p.y * 1e4) / 1e4]);

// ── 1. the Spiral (Loop off) ──
const measured = {};
for (const [name, mk] of Object.entries(SHAPES)) {
  const st = mk(), reg = regionOf(st), pl = plan(reg, {});
  eq([pl.refused, pl.lines, pl.clear.length], [null, LINES[name], LINES[name]], `${name}: ${LINES[name]} line(s): one per chain of rings`);
  eq(pl.linesWhy, LINES[name] === 1 ? null : name === 'island' ? 'islands' : 'splits', `${name}: why several lines`);
  ok(pl.clear.every((c) => c.role === 'linked' && !c.closed), `${name}: every line is an open path`);
  ok(pl.clear.every((c) => c.rings.every((g, i) => i === 0 || g.level === c.rings[i - 1].level - 1)), `${name}: each line runs inside out, one ring per level`);
  // every independent ring is ONE full loop of one line, each once
  const { Rg, out: rings } = ringsOf(reg, D0), spans = spansOf(pl);
  eq(spans.length, rings.flat().length, `${name}: as many loops in the lines (${spans.length}) as rings (${rings.flat().length})`);
  const used = new Set();
  for (const g of spans) {
    ok(g.pts[0] === g.pts.at(-1), `${name}: the ring at level ${g.level} is a full loop (back to where it began)`);
    const set = new Set(g.pts.map((p) => `${p.x},${p.y}`));
    const hit = rings[g.level].findIndex((ring, i) => !used.has(`${g.level}/${i}`) && ring.every((p) => set.has(`${p.x},${p.y}`)) && Math.abs(perimeter(ring, true) - perimeter(g.pts, false)) < 1e-6);
    ok(hit >= 0, `${name}: the loop at level ${g.level} of line ${g.line + 1} = an independent ring of that level, vertex for vertex, same length`);
    used.add(`${g.level}/${hit}`);
  }
  // the links
  const links = linksOf(pl);
  eq(links.length, spans.length - pl.lines, `${name}: one link between consecutive rings of a line`);
  let lo = Infinity, hi = 0, worstIn = Infinity;
  for (const l of links) {
    const L = Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y); lo = Math.min(lo, L); hi = Math.max(hi, L);
    for (let t = 0; t <= 1; t += 0.05) {
      const p = { x: l.a.x + (l.b.x - l.a.x) * t, y: l.a.y + (l.b.y - l.a.y) * t };
      ok(reg.inside(p), `${name}: a link point is inside the pocket region`);
      worstIn = Math.min(worstIn, reg.dist(p) - (D0 + l.outer.level * S));
    }
  }
  if (links.length) {
    ok(lo >= S - LINK_TOL && hi <= S + LINK_TOL, `${name}: every link is one stepover long within ${LINK_TOL} mm (${lo.toFixed(4)} .. ${hi.toFixed(4)}, s = ${S})`);
    ok(worstIn >= -LINK_TOL, `${name}: every link lies inside the region of its outer ring, so inside the inset region (worst ${worstIn.toFixed(4)} mm)`);
  }
  // the swept area == the separate rings' swept area (+ the finish pass); the leftover == main's Concentric
  const finish = [...pl.wall, ...pl.islands.flat()].map((pts) => ({ points: pts.map((p) => [p.x, p.y]), closed: true }));
  const sepSwept = sweepPaths([...rings.flat().map((pts) => ({ points: pts.map((p) => [p.x, p.y]), closed: true })), ...finish], R, POCKET_CLEARING.chordTolMm);
  const dA = regionsArea(diffRegions(pl.swept, sepSwept)) + regionsArea(diffRegions(sepSwept, pl.swept));
  ok(dA < 0.05, `${name}: the swept area == the separate rings' swept area (symmetric difference ${dA.toFixed(4)} mm²)`);
  const m = MAIN.concentric[name];
  eq([pl.levels, pl.loops], [m.levels, m.loops], `${name}: the same rings as main's Concentric (${m.levels} levels, ${m.loops} loops)`);
  near(pl.leftover.area, m.area, 0.01, `${name}: the leftover == main's Concentric leftover`);
  near(pl.leftover.unreachable, m.unreachable, 0.01, `${name}: the unreachable part == main's`);
  near(pl.leftover.missed, m.missed, 0.01, `${name}: the missed part == main's`);
  // the coverage: every 0.5 mm grid point of the region within r of a path, or in the reported leftover
  let missed = 0;
  const paths = [...pl.clear.map((c) => ({ pts: c.points, closed: false })), ...pl.wall.map((pts) => ({ pts, closed: true })), ...pl.islands.flat().map((pts) => ({ pts, closed: true }))];
  const xs = reg.outer.map((p) => p.x), ys = reg.outer.map((p) => p.y);
  const inLeft = (p) => pl.leftover.regions.some((g) => inPoly(p, toXY([...g.outer, g.outer[0]])) && !g.holes.some((h) => inPoly(p, toXY([...h, h[0]]))));
  for (let x = Math.min(...xs) + 0.25; x < Math.max(...xs); x += 1) for (let y = Math.min(...ys) + 0.25; y < Math.max(...ys); y += 1) {
    const p = { x, y };
    if (!reg.inside(p) || inLeft(p)) continue;
    if (!paths.some((q) => distPolyline(p, q.pts, q.closed) <= R + 0.03)) missed++;
  }
  eq(missed, 0, `${name}: the swept area covers the region minus the reported leftover (1 mm grid)`);
  measured[name] = { lines: pl.lines, links: links.length, linkMin: +lo.toFixed(4), linkMax: +hi.toFixed(4), leftover: +pl.leftover.area.toFixed(4) };
  void Rg;
}
console.log('spiral: ' + JSON.stringify(measured));

// ── 3. Freehand / Raster / Morphed spiral: byte-identical to origin/main (TASK 778: programmed pockets add ONLY their 1 guide start-mark element) ──
{
  const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
  const stripStartMark = (svg) => {
    const lines = svg.split('\n');
    const kept = [], removed = [];
    for (const l of lines) {
      if (/^  <path d="M [^"]+ A [^"]+ A [^"]+ M [^"]+ L [^"]+ M [^"]+ L [^"]+"[^>]*shaper:cutType="guide"[^>]*\/>$/.test(l)) removed.push(l);
      else kept.push(l);
    }
    return { svg: kept.join('\n'), removed };
  };
  let n = 0, exact = 0, withMark = 0;
  for (const [key, want] of Object.entries(MAIN.exports)) {
    const [name, pat, more, okey] = key.split('|');
    const m = JSON.parse(more);
    const svg = exportOf(SHAPES[name](), POCKET({ clearing: pat, ...m }), okey === 'grouped' ? { groupByCut: true } : {});
    const targetMd5 = m.passDepth > 0 ? MAIN.exports[[name, pat, JSON.stringify({ ...m, passDepth: null }), okey].join('|')] : want;
    const isProgrammed = pat !== 'freehand' && !(pat === 'morphed' && (name === 'island' || name === 'dumbbell'));
    if (!isProgrammed) {
      eq(md5(svg), targetMd5, `${key}: byte-identical to origin/main (no start mark)`);
      exact++;
    } else {
      const stripped = stripStartMark(svg);
      eq(stripped.removed.length, 1, `${key}: ONLY 1 guide start-mark element added`);
      eq(md5(stripped.svg), targetMd5, `${key}: removing ONLY the guide start mark is byte-identical to origin/main`);
      withMark++;
    }
    n++;
  }
  console.log(`byte-identical to origin/main ${MAIN.from}: ${n} downloads (${exact} exact, ${withMark} with ONLY 1 guide start-mark element added)`);
}

// ── 4. an old document opens with today's values ──
{
  const createSketchState = () => { const e = createEngine(null); e.init(); return sketchState(e, { x: 0, y: 0, w: 100, h: 100 }); };
  const joints = [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }]], shapes = [];
  const poly = (p, pts) => { pts.forEach(([x, y], i) => joints.push([p + i, { x, y, sketchId: 'sketch-1' }])); pts.forEach((_, i) => shapes.push({ id: p + 's' + i, type: 'line', joints: [p + i, p + ((i + 1) % pts.length)], sketchId: 'sketch-1' })); };
  poly('A', RECT); poly('L', LSHAPE.map(([x, y]) => [x + 120, y])); poly('B', [[240, 0], [300, 0], [300, 40], [240, 40]]);
  const scratch = createSketchState();
  deserializeDocument({ version: 3, geometry: { joints, shapes, constraints: [] } }, scratch);
  const loopOf = (prefix) => findLoops(scratch).find((l) => l.edges.includes(prefix + 's0')).id;
  const recs = { A: POCKET({ clearing: 'linked' }), L: POCKET({ clearing: 'morphed' }), B: POCKET({ clearing: 'linked', toolDia: 3.175 }) };
  const keysNew = Object.values(recs).map(opKeyOf).reverse(); // a stored order the user set (not the default)
  const doc = (recOf, keys) => JSON.parse(JSON.stringify({
    version: 3,
    geometry: { joints, shapes, constraints: [], sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }], activeSketchId: 'sketch-1', groups: [], profiles: [], parameters: [] },
    hosts: { shaper: { version: 1, cutPlan: Object.entries(recs).map(([p, r]) => [keyOf('loop', loopOf(p)), recOf(r)]), stock: { thickness: 19.05, width: null, height: null, margin: 12.7 }, opOrder: keys } },
  }));
  const OLD = { linked: 'concentric', morphed: 'spiral' };
  const docNew = doc((r) => r, keysNew);
  const docOld = doc((r) => ({ ...r, clearing: OLD[r.clearing] }), keysNew.map((k) => k.replace(/"pattern":"(linked|morphed)"/, (m, v) => `"pattern":"${OLD[v]}"`)));
  ok(JSON.stringify(docOld).includes('"clearing":"concentric"') && JSON.stringify(docOld).includes('"clearing":"spiral"') && JSON.stringify(docOld.hosts.shaper.opOrder).includes('\\"pattern\\":\\"concentric\\"'), 'the old document says concentric / spiral (records and the stored order)');
  const openDoc = async (d, name) => { const profile = await createProfile(); await createNamedDesign(profile, 'shaper', name, d); return open({ host: 'shaper', profile }); };
  const seen = {};
  for (const [label, d] of [['new', docNew], ['old', docOld]]) {
    CUT_PLAN.clear(); setOpOrder([]);
    const app = await openDoc(d, 'Pocket ' + label);
    try {
      seen[label] = { clearing: Object.fromEntries(Object.keys(recs).map((p) => [p, CUT_PLAN.get(keyOf('loop', loopOf(p))).clearing])), order: opOrder(), svg: shaperSvgOf(app.state, cutPlanEntries()) };
    } finally { await app.close(); }
  }
  eq(seen.old.clearing, { A: 'linked', L: 'morphed', B: 'linked' }, 'the old document opens with concentric -> linked (Spiral), spiral -> morphed (Morphed spiral)');
  eq(seen.old.order, keysNew, 'its stored operation order is mapped the same way (the user\'s order is kept)');
  eq(seen.old.svg, seen.new.svg, 'its export == the same document authored with the new values (byte for byte)');
  ok(elementsOf(seen.new.svg).filter((e) => e.cutType === 'inside').length === 3, 'that export: each pocket\'s wall is an inside cut (Loop off)');
  CUT_PLAN.clear(); setOpOrder([]);
}
console.log(`pocket-clearing-749-node.test.js: ok (${checks} checks)`);
