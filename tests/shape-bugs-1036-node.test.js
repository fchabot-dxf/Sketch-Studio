// tests/shape-bugs-1036-node.test.js — TASK 1036: the bugs the shape-model audit 1035 found (docs/SHAPE-MODEL-PLAN-1035.md appendix N-1..N-7), one section each.
//   N-1 (BUG-370) the arc PREVIEW draws exactly the arc the commit makes, also when the sweep crosses 180 deg (Center Point Arc, 3-Point Arc, the arc slots)
//   N-3 (BUG-371) SVG export "Invert Y axis": ONE Y-flip for every written part (open line, closed loop, arc, circle, bezier; arcApprox too); the DXF untouched
//   N-4 (BUG-372) the design thumbnail draws what the export draws (no construction) plus the text's letters; a non-text design does not wait on a font
//   N-5 (BUG-373) Shaper's Fusion / STL import lands through the shared import landing: its arcs get the structural equal (BUG-046)
//   N-7 (BUG-375) Break / Trim of a fillet arc: a piece that touches no leg of the fillet drops the virtual sharp claim (a pasted copy has no stray corner cross)
// Node kit (tests/helpers/node-app.js): the real pages, real pointer / key events; the export, thumbnail, import and split are the app's own functions.
import assert from 'node:assert';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { open } from './helpers/node-app.js';
import { ARC_MODES, SLOT_MODES, CONSTRAINT_TYPES } from '#core/constants.js';
import { calculateArcPath, arcSweepInfo } from '#core/geometry.js';
import { buildSVG, buildDXF } from '#app/ui/export-manager.js';
import { designThumbnailSvg } from '#ui/design-thumbnail.js';
import { createFontLibrary } from '#ui/text-fonts.js';
import { importFusionSelection } from '../apps/shaper/src/fusion-import.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { previewDimensionInput } from '#core/parameters.js';
import { applyParameterChange, refusalReason } from '#core/dimension-seams.js';
import { newSketchState, rect, fillet } from '#core/tool-ops.js';
import { breakShape } from '#core/break.js';
import { trimShape } from '#core/trim.js';
import { removeGeometry } from '#core/delete-manager.js';
import { isShapeLocked } from '#core/lock-state.js';
import { selectionToEnvelope, pasteDocument } from '#ui/clipboard.js';

const failures = [];
let passed = 0;
async function run(name, fn) {
  try { await fn(); passed++; console.log(`  ok: ${name}`); }
  catch (e) { failures.push(`${name}: ${String(e.message).split('\n')[0]}`); console.log(`  FAIL: ${name}: ${String(e.message).split('\n')[0]}`); }
}
const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

// ───────────────────────────── N-1: the arc preview ─────────────────────────────
async function openFresh() {
  const app = await open({ host: 'sketchstudio' });
  const r = app.svg.getBoundingClientRect();
  Object.assign(app.state.view, { x: 0, y: 0, w: 200 });
  app.state.view.h = app.state.view.w / (r.width / r.height);
  app.svg.setAttribute('viewBox', `${app.state.view.x - app.state.view.w / 2} ${app.state.view.y - app.state.view.h / 2} ${app.state.view.w} ${app.state.view.h}`);
  app.frames(2);
  return app;
}
const moveW = (app, x, y) => { const p = app.toScreen(x, y); app.move(p.x, p.y); };
const clickW = (app, x, y) => { const p = app.toScreen(x, y); app.move(p.x, p.y); app.click(p.x, p.y); };
const C0 = { x: 0.3, y: 0.7 }, R = 30;   // a centre off the grid and the origin, so nothing snaps
const at = (deg, c = C0, r = R) => [c.x + r * Math.cos(deg * Math.PI / 180), c.y + r * Math.sin(deg * Math.PI / 180)];
/** "M sx sy A rx ry 0 large sweep ex ey" (commas or spaces) -> { large, sweep, ex, ey } */
const arcFlags = (d) => {
  const m = /A\s*([-\d.e+]+)[ ,]+([-\d.e+]+)\s+0\s+([01])[ ,]+([01])\s+([-\d.e+]+)[ ,]+([-\d.e+]+)/.exec(d || '');
  return m ? { large: Number(m[3]), sweep: Number(m[4]), ex: Number(m[5]), ey: Number(m[6]) } : null;
};
/** the dashed preview arcs the renderer drew this frame */
const previewArcPaths = (app) => [...app.svg.querySelectorAll('path')].filter((e) => e.getAttribute('stroke-dasharray') && / A /.test(e.getAttribute('d') || '')).map((e) => e.getAttribute('d'));
/** the committed arc as the renderer draws it (calculateArcPath with its stored sweep) */
const committedFlags = (app, arc) => {
  const [c, s, e] = arc.joints.map((id) => app.state.joints.get(id));
  return { ...arcFlags(calculateArcPath(c, s, e, 'CENTER', { sweep: arc.sweep })), spanDeg: arcSweepInfo(c, s, e, { sweep: arc.sweep }).span * 180 / Math.PI };
};
function pickVariant(app, tool, mode) {
  app.tool(tool);
  const item = app.document.querySelector(`.sk-ribbon-menu-item[data-mode="${mode}"]`);
  assert(item, `the ${tool} variant menu has a ${mode} row`);
  item.click(); app.frames(1);
}

await run('N-1a Center Point Arc, the sweep crossing 180 deg either way (and a 270 deg sweep): the preview has the commit\'s large / sweep flags and end', async () => {
  for (const [from, to, label] of [[170, 190, '+20 across 180'], [190, 170, '-20 across 180'], [100, 370, '+270 across 180'], [-100, -280, '-180 .. across']]) {
    const app = await openFresh();
    try {
      pickVariant(app, 'arc', ARC_MODES.CENTER_START_END);
      clickW(app, C0.x, C0.y);
      clickW(app, ...at(from));
      const step = to > from ? 1 : -1;
      for (let d = from + step; d !== to + step; d += step) moveW(app, ...at(d));
      const paths = previewArcPaths(app);
      assert.strictEqual(paths.length, 1, `${label}: one dashed preview arc (${paths.length})`);
      const pv = arcFlags(paths[0]);
      clickW(app, ...at(to));
      const arc = app.state.shapes.find((s) => s.type === 'arc');
      assert(arc, `${label}: an arc is committed`);
      const cm = committedFlags(app, arc);
      assert.deepStrictEqual([pv.large, pv.sweep], [cm.large, cm.sweep], `${label}: preview flags large,sweep = ${pv.large},${pv.sweep}; the committed ${cm.spanDeg.toFixed(1)} deg arc draws ${cm.large},${cm.sweep}`);
      near(Math.hypot(pv.ex - cm.ex, pv.ey - cm.ey), 0, 0.05, `${label}: the preview ends where the arc ends`);
    } finally { await app.close(); }
  }
});

await run('N-1b 3-Point Arc whose arc crosses 180 deg (start 170, end 190, through 180; and the other side): the preview is the committed arc', async () => {
  for (const [s, e, p, label] of [[170, 190, 180, 'the short way through 180'], [170, 190, 0, 'the long way through 0'], [190, 170, 175, 'reversed ends']]) {
    const app = await openFresh();
    try {
      pickVariant(app, 'arc', ARC_MODES.THREE_POINT);
      clickW(app, ...at(s)); moveW(app, ...at(e)); clickW(app, ...at(e));
      moveW(app, ...at(p + 3)); moveW(app, ...at(p));
      const paths = previewArcPaths(app);
      assert.strictEqual(paths.length, 1, `${label}: one dashed preview arc (${paths.length})`);
      const pv = arcFlags(paths[0]);
      clickW(app, ...at(p));
      const arc = app.state.shapes.find((sh) => sh.type === 'arc');
      assert(arc, `${label}: an arc is committed`);
      const cm = committedFlags(app, arc);
      assert.deepStrictEqual([pv.large, pv.sweep], [cm.large, cm.sweep], `${label}: preview ${pv.large},${pv.sweep} vs the committed ${cm.spanDeg.toFixed(1)} deg arc ${cm.large},${cm.sweep}`);
    } finally { await app.close(); }
  }
});

await run('N-1c the arc slots\' previews (Center Point Arc slot, 3-Point Arc slot) crossing 180 deg: the centre arc drawn = the committed slot\'s arcs', async () => {
  for (const [mode, label] of [[SLOT_MODES.CENTER_POINT_ARC, 'Center Point Arc slot'], [SLOT_MODES.THREE_POINT_ARC, '3-Point Arc slot']]) {
    const app = await openFresh();
    try {
      pickVariant(app, 'slot', mode);
      let cursor;
      if (mode === SLOT_MODES.CENTER_POINT_ARC) {
        clickW(app, C0.x, C0.y); clickW(app, ...at(170));
        for (let d = 171; d <= 190; d++) moveW(app, ...at(d));
        cursor = at(190);
      } else {
        clickW(app, ...at(170)); moveW(app, ...at(190)); clickW(app, ...at(190));
        moveW(app, ...at(183)); moveW(app, ...at(180));
        cursor = at(180);
      }
      const paths = previewArcPaths(app);
      assert(paths.length >= 1, `${label}: a dashed preview arc (${paths.length})`);
      const pv = arcFlags(paths[0]);
      clickW(app, ...cursor);
      const w = at(mode === SLOT_MODES.CENTER_POINT_ARC ? 190 : 180, C0, R + 4);
      moveW(app, ...w); clickW(app, ...w);
      const slotArcs = app.state.shapes.filter((s) => s.type === 'arc');
      assert(slotArcs.length >= 2, `${label}: a slot is committed (${slotArcs.length} arcs)`);
      const byCentre = new Map();   // the slot's centre arc and side arcs share one centre joint (the end caps each have their own)
      for (const a of slotArcs) byCentre.set(a.joints[0], [...(byCentre.get(a.joints[0]) || []), a]);
      const ring = [...byCentre.values()].find((g) => g.length >= 2);
      assert(ring, `${label}: the slot's side arcs are round one centre`);
      const sides = ring.map((a) => committedFlags(app, a));
      for (const cm of sides) assert.deepStrictEqual([pv.large, pv.sweep], [cm.large, cm.sweep], `${label}: preview ${pv.large},${pv.sweep} vs a committed side arc (${cm.spanDeg.toFixed(1)} deg) ${cm.large},${cm.sweep}`);
    } finally { await app.close(); }
  }
});

// ───────────────────────────── N-3: SVG export Invert Y ─────────────────────────────
function exportFixture() {
  const joints = new Map();
  const J = (id, x, y) => joints.set(id, { x, y });
  J('a', 0, 0); J('b', 10, 0); J('c', 10, 5); J('d', 0, 5);   // a closed loop (written as one <polygon>)
  J('e', 20, 2); J('f', 30, 2);                                 // an open line
  J('ac', 50, 10); J('as', 60, 10); J('ae', 50, 20);            // an arc, centre (50,10), increasing angle 0 -> 90
  J('bc', 50, 40); J('bs', 60, 40); J('be', 40, 40);            // an arc the other way, 0 -> 180 decreasing (sweep false)
  J('cc', 80, 10);                                              // a circle
  J('b0', 100, 0); J('b3', 120, 0);                             // a bezier
  const shapes = [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'a'], ['e', 'f']].map(([p, q], i) => ({ id: 's' + i, type: 'line', joints: [p, q] }));
  shapes.push({ id: 'arc1', type: 'arc', joints: ['ac', 'as', 'ae'], sweep: true });
  shapes.push({ id: 'arc2', type: 'arc', joints: ['bc', 'bs', 'be'], sweep: false });
  shapes.push({ id: 'circ', type: 'circle', joints: ['cc'], radius: 4 });
  shapes.push({ id: 'bz', type: 'bezier', joints: ['b0', 'b3'], c1: [105, 8], c2: [115, 8] });
  return { joints, shapes, constraints: [] };
}
/** every element the SVG writes, as { tag, pts: [[x, y]...], flags } (polygon / polyline points, line ends, circle centre, path points + arc flags) */
function parts(svg) {
  const out = [];
  for (const m of svg.matchAll(/<(polygon|polyline|line|circle|path) ([^>]*)\/>/g)) {
    const [, tag, attrs] = m;
    const a = (n) => { const r = new RegExp(`\\b${n}="([^"]*)"`).exec(attrs); return r ? r[1] : null; };
    if (tag === 'polygon' || tag === 'polyline') out.push({ tag, pts: a('points').trim().split(/\s+/).map((p) => p.split(',').map(Number)) });
    else if (tag === 'line') out.push({ tag, pts: [[+a('x1'), +a('y1')], [+a('x2'), +a('y2')]] });
    else if (tag === 'circle') out.push({ tag, pts: [[+a('cx'), +a('cy')]], r: +a('r') });
    else {
      const d = a('d'), f = arcFlags(d);
      const nums = d.replace(/A\s*[-\d.e+]+\s+[-\d.e+]+\s+0\s+[01]\s+[01]/, 'A').match(/[-\d.e+]+/g).map(Number);
      const pts = []; for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
      out.push({ tag, pts, flags: f ? [f.large, f.sweep] : null });
    }
  }
  return out;
}
await run('N-3 SVG "Invert Y axis": every part (closed loop, open line, both arc directions, circle, bezier; also with arcApprox) is the plain export mirrored in Y', async () => {
  const state = exportFixture();
  for (const arcApprox of [false, true]) {
    const off = parts(buildSVG(state, { precision: 4, arcApprox, arcSeg: 8 })), on = parts(buildSVG(state, { precision: 4, invertY: true, arcApprox, arcSeg: 8 }));
    assert.strictEqual(on.length, off.length, `arcApprox ${arcApprox}: the same parts`);
    assert.deepStrictEqual(off.map((p) => p.tag), on.map((p) => p.tag), `arcApprox ${arcApprox}: the same elements in the same order`);
    off.forEach((p, i) => {
      const q = on[i];
      const what = `arcApprox ${arcApprox}, ${p.tag} #${i}`;
      assert.strictEqual(q.pts.length, p.pts.length, `${what}: the same points`);
      p.pts.forEach(([x, y], k) => { near(q.pts[k][0], x, 1e-3, `${what} point ${k} x`); near(q.pts[k][1], -y, 1e-3, `${what} point ${k} y is mirrored (${y} -> ${q.pts[k][1]})`); });
      if (p.flags) assert.deepStrictEqual(q.flags, [p.flags[0], 1 - p.flags[1]], `${what}: the mirrored arc keeps its size flag and turns the other way (${p.flags} -> ${q.flags})`);
    });
  }
  assert.strictEqual(buildDXF(state, { precision: 6, invertY: true }), buildDXF(state, { precision: 6 }), 'the DXF (always Y-up, task 1027) is the same with the box on and off');
});

// ───────────────────────────── N-4: the design thumbnail ─────────────────────────────
const readBytes = async (u) => { const b = fs.readFileSync(fileURLToPath(u)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const doc = (shapes, joints) => ({ version: 3, geometry: { joints, shapes, constraints: [] }, hosts: {} });
const TEXT = { id: 't1', type: 'text', joints: ['ja'], text: 'HI', font: 'Inter', fontKind: 'outline', fallback: 'Inter', size: 20, letterSpacing: 0, lineSpacing: 1, align: 'left', rotation: 0, userGroupId: 'g1' };
const segCount = (svg) => ((/ d="([^"]*)"/.exec(svg || '') || [])[1] || '').split('M').length - 1;
await run('N-4a a text-only design has a thumbnail: its letters', async () => {
  const lib = createFontLibrary({ readBytes });
  const svg = await designThumbnailSvg(doc([TEXT], [['ja', { x: 0, y: 0 }]]), { library: lib });
  assert(svg && segCount(svg) >= 2, `the thumbnail draws the letters of "HI" (${svg ? segCount(svg) + ' strokes' : 'null'})`);
});
await run('N-4b a mixed design\'s thumbnail has the letters too; construction geometry is not drawn (the export leaves it out)', async () => {
  const lib = createFontLibrary({ readBytes });
  const line = { id: 'l1', type: 'line', joints: ['p', 'q'] };
  const cons = { id: 'k1', type: 'circle', joints: ['p'], radius: 500, isConstruction: true };
  const J = [['ja', { x: 0, y: 0 }], ['p', { x: 0, y: 30 }], ['q', { x: 60, y: 30 }]];
  const lineOnly = await designThumbnailSvg(doc([line], J), { library: lib });
  const mixed = await designThumbnailSvg(doc([line, TEXT], J), { library: lib });
  assert(segCount(mixed) > segCount(lineOnly), `the letters are drawn beside the line (${segCount(mixed)} vs ${segCount(lineOnly)} strokes)`);
  const withCons = await designThumbnailSvg(doc([line, cons], J), { library: lib });
  assert.strictEqual(withCons, lineOnly, 'a construction circle changes nothing in the thumbnail');
  assert.strictEqual(await designThumbnailSvg(doc([cons], [['p', { x: 0, y: 0 }]]), { library: lib }), null, 'a construction-only design has no thumbnail (nothing is exported)');
});
await run('N-4c a design without text never waits on a font (a font that never arrives does not hold its thumbnail)', async () => {
  const never = createFontLibrary({ readBytes: () => new Promise(() => {}) });
  const line = { id: 'l1', type: 'line', joints: ['p', 'q'] };
  const res = await Promise.race([designThumbnailSvg(doc([line], [['p', { x: 0, y: 0 }], ['q', { x: 10, y: 0 }]]), { library: never }), new Promise((r) => setTimeout(() => r('TIMEOUT'), 500))]);
  assert(typeof res === 'string' && res.startsWith('<svg'), `the line design's thumbnail is there at once (${String(res).slice(0, 20)})`);
});

// ───────────────────────────── N-5: Shaper's Fusion import arcs ─────────────────────────────
await run('N-5 Shaper Fusion import: the imported arc has the structural equal, and a radius edit moves both its ends (BUG-046)', async () => {
  const msg = {
    action: 'selection_data', version: 1, units: 'mm', coordSystem: { yAxis: 'up', frame: 'plane-2d' }, source: { kind: 'sketch', name: 'ArcSk' }, stock: { thicknessMm: null },
    regions: [], warnings: [],
    chains: [{ id: 'chain_0', label: 'Chain 1', cutType: null, depthMm: null, closed: false, segments: [{ type: 'arc', cx: 0, cy: 0, r: 30, x1: 30, y1: 0, x2: 0, y2: 30, ccw: true }] }],
  };
  const app = await open({ host: 'shaper' });
  try {
    app.modes.showMode('prepare');
    const res = importFusionSelection(msg, { controller: app.controller, prepare: app.prepare });
    assert(res.ok, 'the import succeeds');
    const st = app.state;
    const arc = st.shapes.find((s) => s.type === 'arc');
    assert(arc, 'an arc is imported');
    assert(arc.sketchId === res.sketch.id && arc.joints.every((id) => st.joints.get(id).sketchId === res.sketch.id), 'the arc and its joints are in the import\'s sketch (stamped by the state as before)');
    const eqs = st.constraints.filter((c) => c.type === CONSTRAINT_TYPES.EQUAL && c.joints && c.joints.length === 4 && c.joints[0] === arc.joints[0] && c.joints[2] === arc.joints[0]);
    assert.strictEqual(eqs.length, 1, `the arc carries ONE structural equal |centre - start| = |centre - end| (${eqs.length})`);
    const radii = () => { const [c, s, e] = arc.joints.map((id) => st.joints.get(id)); return [Math.hypot(s.x - c.x, s.y - c.y), Math.hypot(e.x - c.x, e.y - c.y)]; };
    const before = st.constraints.length;
    st.saveState('dimension');
    ConstraintManager.createConstraint(st, CONSTRAINT_TYPES.DISTANCE, { shape: arc.id, isRadius: true, value: 30 }, { source: 'toolbar' });
    const dim = st.constraints.slice(before).find((c) => c.type === CONSTRAINT_TYPES.DISTANCE && c.isRadius);
    const pv = previewDimensionInput(st, dim, '40', { unit: 'mm' });
    assert(pv.ok, `the radius box takes 40 (${pv.hint})`);
    const r = applyParameterChange(st, pv.plan, 'edit');
    assert(r.ok, `the edit applies (${r.ok ? '' : refusalReason(r)})`);
    const [rs, re] = radii();
    near(rs, 40, 1e-3, 'the start is on the new circle'); near(re, 40, 1e-3, 'the end is on the new circle');
  } finally { await app.close(); }
});

// ───────────────────────────── N-7: the fillet arc's virtual sharp after a split ─────────────────────────────
const claimants = (st, V) => st.shapes.filter((s) => s.type === 'arc' && s.filletSharp === V).map((s) => s.id);
const vCount = (st) => [...st.joints.values()].filter((j) => j && j.virtualSharp).length;
function filleted() {
  const st = newSketchState();
  const r = rect(st, 0, 0, 100, 60);
  const f = fillet(st, r.top, r.right, 20);
  return { st, r, f };
}
function pasteOf(st, ids) {
  st.selectedShapes = new Set(ids);
  const env = selectionToEnvelope(st);
  const before = vCount(st);
  pasteDocument(st, env.document);
  return vCount(st) - before;
}
await run('N-7a Break of a whole fillet arc: both pieces still touch a leg, so both keep the corner (the lock rule of each leg still reads it)', async () => {
  const { st, r, f } = filleted();
  const res = breakShape(st, f.arc, 0.5);
  assert(res, 'the arc breaks');
  assert.deepStrictEqual(claimants(st, f.V).sort(), [f.arc, res.newShapeId].sort(), 'both pieces keep the corner: each is tangent to a leg V lies on');
  st.joints.get(f.V).fixed = true;
  for (const leg of [r.top, r.right]) { const s = st.shapes.find((x) => x.id === leg); for (const j of s.joints) if (!st.shapes.some((a) => a.type === 'arc' && a.joints.includes(j))) st.joints.get(j).fixed = true; }
  for (const leg of [r.top, r.right]) assert(isShapeLocked(st, st.shapes.find((x) => x.id === leg)), `leg ${leg} still reads locked through its piece (UX-26)`);
});
await run('N-7b a leg deleted, then Break: the piece that touches no leg drops the corner; a pasted copy of it brings no stray corner cross', async () => {
  const { st, r, f } = filleted();
  removeGeometry(st, [r.right]);
  const res = breakShape(st, f.arc, 0.5);
  assert(res, 'the arc breaks');
  assert.deepStrictEqual(claimants(st, f.V), [f.arc], `only the piece on the remaining leg claims the corner (${claimants(st, f.V)})`);
  assert.strictEqual(pasteOf(st, [res.newShapeId]), 0, 'copy + paste of the legless piece adds no virtual sharp corner');
  assert.strictEqual(pasteOf(st, [f.arc]), 1, 'copy + paste of the piece on the leg still brings its corner (as a fillet arc copied alone does)');
});
await run('N-7c a leg deleted, then Trim of the middle of the fillet arc (two cutters): the legless piece drops the corner', async () => {
  const { st, r, f } = filleted();
  removeGeometry(st, [r.right]);
  const arc = st.shapes.find((s) => s.id === f.arc);
  const c = st.joints.get(arc.joints[0]);
  const cutter = (deg) => { const a = deg * Math.PI / 180; const j1 = st.genJ(), j2 = st.genJ(); st.joints.set(j1, { x: c.x, y: c.y }); st.joints.set(j2, { x: c.x + 40 * Math.cos(a), y: c.y + 40 * Math.sin(a) }); st.shapes.push({ id: 'cut' + deg, type: 'line', joints: [j1, j2] }); };
  const [s0] = [st.joints.get(arc.joints[1])];
  const a0 = Math.atan2(s0.y - c.y, s0.x - c.x) * 180 / Math.PI;
  const dir = arcSweepInfo(c, s0, st.joints.get(arc.joints[2]), { sweep: arc.sweep }).dir;
  cutter(a0 + dir * 30); cutter(a0 + dir * 60);
  const mid = (a0 + dir * 45) * Math.PI / 180;
  const res = trimShape(st, f.arc, { x: c.x + 20 * Math.cos(mid), y: c.y + 20 * Math.sin(mid) });
  assert(res && res.added && res.added.length === 2, `the middle is trimmed out: two pieces (${JSON.stringify(res && res.added)})`);
  assert.deepStrictEqual(claimants(st, f.V), [f.arc], `only the piece on the remaining leg claims the corner (${claimants(st, f.V)})`);
});

console.log(`\nshape-bugs-1036-node: ${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log('  - ' + f); process.exit(1); }
process.exit(0);
