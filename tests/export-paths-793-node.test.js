// tests/export-paths-793-node.test.js — TASK 793: the Export step's third view, "Paths". Pure (the mounted view is checked in export-paths-793-live.test.js).
//  1. the Paths view's path list == the exported file's elements: for each drawing (a pocket with an island, an outside with tabs + a hole, an On line with a
//     lead-in, programmed pockets (Spiral and Raster, Loop on and off), a Guide, a stepped pocket) the exporter's `written` list (export-payload.js
//     shaperPreviewOf, the list the page hands the view) has one { cut, entry } per element of the file, in the file's order: same count, same cut type,
//     and the view's elements (export-preview.js previewItems on the parsed preview copy) carry the file's own d strings (the downloaded file read line by line).
//  2. the bit-centre paths (export-payload.js bitCentrePaths): present for every outside / inside / pocket-wall / island element, none for a plain On line
//     or a guide, and each one lies at the bit radius (+ the cut offset for an outside / inside) from the written path, measured to 0.01 mm. They are
//     the same polylines Prepare's derivation gives (deriveKeyFootprints -> deriveCutTravel).
//  3. the direction-bearing travel: a programmed pocket's clearing lines, a lead-in leg, the On-line loop and tab strokes are travel paths whose written
//     path IS the bit's (no second line: the view marks them only, export-preview.js BIT_ONLY_ROLES).
import assert from 'node:assert';
import fs from 'node:fs';
import { open } from './helpers/node-app.js';
import SettingsManager from '#core/settings-manager.js';
import { exportShaperSVG } from '#core/shaper-export.js';
import { findLoops } from '#core/loop-finder.js';
import { loopPolygon } from '#core/loop-geometry.js';
import { deriveCutTravel } from '#core/profile-model.js';
import { CUT_PLAN, cutPlanEntries, loopsWithPolygons, planOwnedLoops, deriveKeyFootprints } from '../apps/shaper/src/cut-plan.js';
import { importFusionSelection } from '../apps/shaper/src/fusion-import.js';
import { exportEncoding } from '../apps/shaper/src/shaper.js';
import { shaperPreviewOf, bitCentrePaths } from '../apps/shaper/src/export-payload.js';
import { parseShaperSvg, previewItems } from '../apps/shaper/src/export-preview.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const BIT = 6, R = BIT / 2;

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
const ISLAND = [[40, 20], [60, 20], [60, 40], [40, 40]];
const area = (p) => { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j].x * p[i].y - p[i].x * p[j].y; return a / 2; };
const polysOf = (st) => { const by = new Map(st.shapes.map((s) => [s.id, s])); const lp = {}; for (const l of findLoops(st)) lp[l.id] = loopPolygon(l, st, by); return lp; };
const loopsBySize = (st) => { const lp = polysOf(st); return findLoops(st).sort((a, b) => Math.abs(area(lp[b.id])) - Math.abs(area(lp[a.id]))); };
const tgt = (l) => ({ kind: 'loop', id: l.id });
const POCKET = (more = {}) => ({ cutType: 'pocket', cutDepth: 6, cutOffset: 0, toolDia: BIT, cutterShape: 'endmill', stepover: 40, finishAllowance: 0.5, rasterAngle: 0, ...more });
const OUTSIDE = (more = {}) => ({ cutType: 'exterior', cutDepth: 18, cutOffset: 0, toolDia: BIT, ...more });
const INSIDE = (more = {}) => ({ cutType: 'interior', cutDepth: 18, cutOffset: 0, toolDia: BIT, ...more });
const ONLINE = (more = {}) => ({ cutType: 'online', cutDepth: 3, cutOffset: 0, toolDia: BIT, ...more });
const GUIDE = { cutType: 'guide', cutDepth: 0, cutOffset: 0, toolDia: BIT };

// the file's elements read line by line (a <g> hoists the shared attributes): the downloaded string's own elements
function fileElements(svg) {
  const attrs = (s) => Object.fromEntries([...s.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  const out = []; let group = null;
  for (const line of svg.split('\n').map((l) => l.trim())) {
    if (line.startsWith('<g')) { group = attrs(line); continue; }
    if (line.startsWith('</g')) { group = null; continue; }
    const m = /^<(path|circle|polygon)\s(.*)\/>$/.exec(line);
    if (!m) continue;
    const a = { ...(group || {}), ...attrs(m[2]) };
    out.push({ tag: m[1], cutType: a['shaper:cutType'], d: a.d || null, cx: a.cx || null });
  }
  return out;
}
const encType = (id) => exportEncoding().find((t) => t.id === id).cutType;

SettingsManager.set('DOC_UNIT', 'mm');
const app = await open({ host: 'shaper' });
try {
  const exportOf = (st, entries) => {
    const lp = polysOf(st);
    const written = [];
    const svg = exportShaperSVG({ state: st, entries, encoding: exportEncoding(), docUnit: 'mm', options: { groupByCut: true, previewData: true, written }, loopPolys: lp });
    return { svg, written };
  };
  // THE check 1 for one drawing: the view's list == the file's elements
  const listIsFile = (name, st, entries) => {
    const { svg, written } = exportOf(st, entries);
    const items = previewItems(parseShaperSvg(svg, app.document));
    const download = fileElements(svg.replace(/ data-[a-z]+="[^"]*"/g, ''));
    ok(items.length > 0, `${name}: the file has elements`);
    eq(written.length, items.length, `${name}: one written entry per element of the file`);
    eq(items.map((it) => it.cutType), written.map((w) => encType(w.cut.rec.cutType)), `${name}: the cut types, in the file's order`);
    eq(items.map((it) => ({ tag: it.tag, cutType: it.cutType, d: it.el.getAttribute('d'), cx: it.el.getAttribute('cx') })), download, `${name}: the view's elements == the downloaded file's (tag, cut type, d)`);
    return { svg, written, items };
  };
  const bitPathsOf = (st, written) => bitCentrePaths(st, written);
  const distToPolyline = (p, pts, closed) => {
    let best = Infinity;
    const n = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], vx = b.x - a.x, vy = b.y - a.y, L = vx * vx + vy * vy;
      const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / L)) : 0;
      best = Math.min(best, Math.hypot(p.x - a.x - t * vx, p.y - a.y - t * vy));
    }
    return best;
  };
  const maxDev = (pathPts, ref, want) => Math.max(...pathPts.map((p) => Math.abs(distToPolyline(p, ref, true) - want)));
  const toXY = (poly) => poly.map((p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : p));

  // ── a pocket with an island (Freehand): wall + island bit-centre paths at the bit radius ──
  {
    const st = polyState([RECT, ISLAND]);
    const [outer, island] = loopsBySize(st);
    const { written } = listIsFile('pocket + island', st, [{ target: tgt(outer), rec: POCKET({ clearing: 'freehand' }) }]);
    const bits = bitPathsOf(st, written);
    eq(bits.length, 1, 'pocket + island: one element has travel');
    eq(bits[0].travel.map((t) => t.role).sort(), ['island', 'wall'], 'pocket + island: a wall and an island bit-centre path');
    const wall = bits[0].travel.find((t) => t.role === 'wall'), isl = bits[0].travel.find((t) => t.role === 'island');
    ok(maxDev(wall.path, toXY(RECT), R) <= 0.01, `pocket wall: the bit centre is ${R} mm in from the pocket outline (0.01)`);
    ok(maxDev(isl.path, toXY(ISLAND), R) <= 0.01, `pocket island: the bit centre is ${R} mm out from the island (0.01)`);
    void island;
  }

  // ── an outside and its hole as an inside cut, offset 1.5 ──
  {
    const st = polyState([RECT, ISLAND]);
    const [outer, hole] = loopsBySize(st);
    const { written } = listIsFile('outside + hole', st, [{ target: tgt(outer), rec: OUTSIDE({ cutOffset: 1.5 }) }, { target: tgt(hole), rec: INSIDE({ cutOffset: 1.5 }) }]);
    const bits = bitPathsOf(st, written);
    ok(bits.length >= 1, 'outside + hole: bit-centre paths present');
    const roles = bits.flatMap((b) => b.travel.map((t) => t.role));
    ok(roles.includes('outside') && roles.includes('inside'), `outside + hole: an outside and an inside bit-centre path (${roles})`);
    for (const { travel } of bits) for (const t of travel) {
      if (t.role === 'outside') ok(maxDev(t.path, toXY(RECT), R + 1.5) <= 0.01, `outside: the bit centre is ${R + 1.5} mm out (radius + offset) (0.01)`);
      if (t.role === 'inside') ok(maxDev(t.path, toXY(ISLAND), R + 1.5) <= 0.01, `inside: the bit centre is ${R + 1.5} mm in (radius + offset) (0.01)`);
    }
  }

  // ── an outside with TABS (no offset): the pass has its bit-centre path; the gap strips none ──
  {
    const st = polyState([[[0, 0], [200, 0], [200, 100], [0, 100]]]);
    const [outer] = loopsBySize(st);
    const { written } = listIsFile('outside + tabs', st, [{ target: tgt(outer), rec: OUTSIDE({ holdPart: 'tabs', tabCount: 4, tabWidth: 10, holdThickness: 2 }) }]);
    const roles = written.map((w) => w.cut.hold && w.cut.hold.role);
    ok(roles.includes('pass') && roles.includes('strip'), `outside + tabs: a pass and its gap strips are written (${roles})`);
    const bits = bitPathsOf(st, written);
    const withBits = new Set(bits.map((b) => b.index));
    ok(written.every((w, i) => (w.cut.hold.role === 'pass') === withBits.has(i)), 'outside + tabs: the pass has a bit-centre path, a gap strip has none');
  }

  // ── an On line with a lead-in arc, and a plain one ──
  {
    const st = polyState([RECT]);
    const [outer] = loopsBySize(st);
    const lead = listIsFile('on line + lead-in', st, [{ target: tgt(outer), rec: ONLINE({ leadIn: true, leadInSide: 'outside' }) }]);
    const roles = bitPathsOf(st, lead.written).flatMap((b) => b.travel.map((t) => t.role));
    eq(roles, ['leadin', 'online'], 'on line + lead-in: the lead-in leg and the loop are travel paths (their own bit path)');
    const plain = listIsFile('on line', st, [{ target: tgt(outer), rec: ONLINE() }]);
    eq(bitPathsOf(st, plain.written), [], 'a plain On line: no travel is determined, no bit-centre path');
    const guide = listIsFile('guide', st, [{ target: tgt(outer), rec: GUIDE }]);
    eq(bitPathsOf(st, guide.written), [], 'a guide: no bit-centre path');
  }

  // ── programmed pockets: Spiral and Raster, Loop on and off ──
  for (const clearing of ['linked', 'raster']) for (const loop of [false, true]) {
    const st = polyState([RECT]);
    const [outer] = loopsBySize(st);
    const name = `programmed ${clearing}${loop ? ' + Loop' : ''}`;
    const { written, items } = listIsFile(name, st, [{ target: tgt(outer), rec: POCKET({ clearing, loop }) }]);
    const bits = bitPathsOf(st, written);
    ok(bits.length > 0, `${name}: travel present`);
    const roles = new Set(bits.flatMap((b) => b.travel.map((t) => t.role)));
    ok(roles.has(clearing === 'linked' ? 'linked' : 'raster') || roles.has('loop'), `${name}: the clearing lines carry their direction (${[...roles]})`);
    ok(roles.has('wall') === !loop, `${name}: the wall has its bit-centre path unless the Loop is on (its closed loop IS the wall pass) (${[...roles]})`);
    ok(items.some((it) => it.cutType === 'pocket' || it.cutType === 'online' || it.cutType === 'inside'), `${name}: the file's own elements`);
  }

  // ── the Prepare derivation == the view's: same polylines (one composition) ──
  {
    const st = polyState([RECT, ISLAND]);
    const [outer] = loopsBySize(st);
    const entry = { target: tgt(outer), rec: OUTSIDE({ cutOffset: 0.8 }) };
    const { written } = exportOf(st, [entry]);
    const view = bitPathsOf(st, written).flatMap((b) => b.travel);
    const { loops, loopPolys } = loopsWithPolygons(st);
    const d = deriveKeyFootprints(`loop:${outer.id}`, entry.rec, st, loops, loopPolys, planOwnedLoops(st, loops, loopPolys, new Map()));
    const prep = deriveCutTravel(d.footprints);
    eq(view.map((t) => t.path), prep.map((t) => t.path), 'the Paths view\'s bit-centre polylines == Prepare\'s derivation (deriveKeyFootprints -> deriveCutTravel), point for point');
  }

  // ── a stepped pocket (the SA-7 R3 floor fillet): one bit-centre set per terrace ──
  CUT_PLAN.clear();
  importFusionSelection(fs.readFileSync(new URL('./fixtures/sa7-slope/03-pocket-floor-fillet.json', import.meta.url), 'utf8'), { controller: app.controller, prepare: app.prepare });
  {
    const [pk, rec] = [...CUT_PLAN.entries()].find(([, r]) => r.cutType === 'pocket');
    CUT_PLAN.set(pk, { ...rec, cutType: 'stepped-pocket', stepDepth: 1, adaptiveSteps: true, stepDeviation: 0.5 });
    const p = shaperPreviewOf(app.state, cutPlanEntries());
    const items = previewItems(parseShaperSvg(p.svg, app.document));
    eq(p.written.length, items.length, 'stepped pocket: one written entry per element');
    eq(items.map((it) => it.cutType), p.written.map((w) => encType(w.cut.rec.cutType)), 'stepped pocket: the cut types, in the file\'s order');
    const bits = bitCentrePaths(app.state, p.written);
    eq(bits.filter((b) => b.travel.some((t) => t.role === 'wall')).length, 4, 'stepped pocket: a wall bit-centre path for each of the 4 terraces');
  }
} finally {
  CUT_PLAN.clear();
  app.close();
}
console.log(`export-paths-793-node.test.js: ok (${checks} checks)`);
