// tests/pocket-startmark-778-node.test.js — TASK 778: the programmed pocket's guide START MARK (circle + cross, on the clearing route, inside the pocket, off every
// island, a bit radius from the walls; Loop off = the route's start; written as ONE guide; the 3D Review's pocket-start mark) and no `pocketLeg` left anywhere.
// (Renamed from tests/leadin-arc-778-node.test.js in TASK 836: its lead-in sections 1-4 and 6-8 went with the lead-in, owner ruling 2026-11-20; the start mark
// is not a lead-in and stays exactly as it is.)
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { exportShaperSVG } from '#core/shaper-export.js';
import { findLoops } from '#core/loop-finder.js';
import { loopPolygon } from '#core/loop-geometry.js';
import { deriveProfileCuts } from '#core/profile-model.js';
import { buildRelief } from '#core/relief-model.js';
import { POCKET_CLEARING, planClearing, clearingSettings, pocketRings } from '#core/pocket-clearing.js';
import { keyOf, planReliefItems } from '../apps/shaper/src/cut-plan.js';
import { exportEncoding } from '../apps/shaper/src/shaper.js';
import { V2_PLAN } from './helpers/plan-v2.js'; // TASK S1: the test's v2 document of the plan, loaded through applyShaperDoc
import './helpers/node-app.js';

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

const RECT = [[0, 0], [100, 0], [100, 60], [0, 60]];
const ISLAND = [[40, 20], [60, 20], [60, 40], [40, 40]];
const DUMBBELL = [[0, 0], [40, 0], [40, 18], [60, 18], [60, 0], [100, 0], [100, 40], [60, 40], [60, 22], [40, 22], [40, 40], [0, 40]];
const POCKET = (more = {}) => ({ cutType: 'pocket', cutDepth: 6, cutOffset: 0, toolDia: 6, stepover: 40, finishAllowance: 0.5, rasterAngle: 0, ...more });

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

console.log(`pocket-startmark-778-node: ok (${checks} checks)`);
