// tests/close-path-760-node.test.js — TASK 760 (node): CLOSE PATH, the shared Design tab's command (#core/close-path.js, #ui/close-path-actions.js).
//  1. an open polyline is closed with ONE line (the chain's kind, sketch; coincident at both ends; nothing else added); the result is a loop findLoops returns;
//  2. near-coincident ends (gap <= CLOSE_PATH_COINCIDENT_MM): made coincident, no new curve, the end of the LAST curve moves, by <= the tolerance;
//  3. arc and bezier end curves (their end joints); a bezier chain is closed topologically (findLoops has no bezier edge: not a loop there);
//  4. a chain inside a user group (an import's): the line joins the chain's innermost group, the group (not entered) stays ONE rigid block whose shape the
//     solver keeps, state.constraints gains only the coincidents;
//  5. refused with the reason (never silent), no undo step: a branch (T junction), a closed outline, a circle, a single straight line;
//  6. several chains: each closed, ONE undo step; undo / redo;
//  7. the open-end markers' source (openChainEnds): every free end of every open chain of the active sketch, nothing of a hidden one;
//  8. the import detector (nearClosedChains) on the fixtures (an SVG with a 0.05 mm gap, one with a 5 mm gap, an open engraving line, a DXF): counts, the
//     largest gap, which chains are offered; then, in SketchStudio (tests/helpers/node-app.js): the import shows ONE notice with "Close them", nothing
//     closed until it is pressed, the press closes exactly the offered chains in ONE undo step of its own (after the import's);
//  9. the declarations: the ribbon button (Modify, right after Break), its key (Shift+C, Circle keeps C), TOOL_SHORTCUTS, the analytics feature;
// 10. exports of a document Close path was not used on are byte-identical (the import alone, with the offer shown and not taken).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newSketchState, polyline, arc, click, circle } from '#core/tool-ops.js';
import { planClosePaths, applyClosePath, openChainEnds, nearClosedChains, CLOSE_PATH_COINCIDENT_MM, NEAR_CLOSED_MM, NEAR_CLOSED_REL } from '#core/close-path.js';
import { findLoops, findConnectedChain } from '#core/loop-finder.js';
import { groupImported, rigidBlocks } from '#core/group-model.js';
import { addConstraint } from '#core/constraints.js';
import { CONSTRAINT_TYPES, TOOL_MODES } from '#core/constants.js';
import { importDxf } from '#core/dxf-import.js';
import { importSvgGeometry, computeImportScale } from '#core/svg-import.js';
import { addSketch, activateSketch, setSketchLocked } from '#core/sketch-model.js';
import { closePathOnShapes, offerToCloseImported } from '#ui/close-path-actions.js';
import { RIBBON_TOOLS } from '#ui/tool-ribbon.js';
import { shortcutById, matchShortcut, SHORTCUTS, shortcutConflicts } from '#ui/shortcuts.js';
import { TOOL_SHORTCUTS } from '#ui/input-manager.js';
import { FEATURES } from '#ui/analytics-events.js';
import { open } from './helpers/node-app.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = (...p) => fs.readFileSync(path.join(REPO_ROOT, 'tests', 'fixtures', ...p), 'utf8');
let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b}`); checks++; };
const notes = [];
const run = (state, ids) => closePathOnShapes(state, ids, (m, l) => notes.push({ m, l }));
const lastNote = () => notes[notes.length - 1];
const loopOf = (state, ids) => findLoops(state).find((l) => l.edges.length === ids.length && ids.every((id) => l.edges.includes(id)));
const coincidents = (state) => state.constraints.filter((c) => c.type === CONSTRAINT_TYPES.COINCIDENT).length;

// ── 1. an open polyline -> ONE line, a loop
{
  const st = newSketchState();
  const segs = polyline(st, [[0, 0], [30, 0], [30, 20], [0, 20]], false); // a U: three lines, free ends (0,0) and (0,20)
  const nShapes = st.shapes.length, nCons = st.constraints.length, hist = st.history.length;
  const res = run(st, [segs[1].id]);
  eq(res.closed.length, 1, '1: one chain closed');
  eq(st.shapes.length, nShapes + 1, '1: ONE line added');
  const line = st.shapes[st.shapes.length - 1];
  eq([line.type, line.isConstruction, line.sketchId], ['line', false, st.activeSketchId], '1: a normal line in the chain\'s sketch');
  eq(st.constraints.length, nCons + 2, '1: two constraints added');
  ok(st.constraints.slice(nCons).every((c) => c.type === CONSTRAINT_TYPES.COINCIDENT), '1: both are coincidents');
  const ends = [line.joints[0], line.joints[1]].map((j) => st.joints.get(j));
  eq(new Set(ends.map((p) => `${p.x},${p.y}`)), new Set(['0,0', '0,20']), '1: the line runs between the two free ends');
  ok(loopOf(st, [...segs.map((s) => s.id), line.id]), '1: findLoops returns the closed outline as a loop');
  eq(st.history.length, hist + 1, '1: ONE undo step');
  ok(/Closed 1 path \(a line added across 20 mm\)/.test(lastNote().m) && lastNote().l === 'success', '1: the notice says so: ' + lastNote().m);
}

// ── 2. near-coincident ends -> coincident, no line, the last curve's end moves by <= the tolerance
{
  const st = newSketchState();
  const gap = 0.004;
  const segs = polyline(st, [[0, 0], [30, 0], [30, 20], [0, 20], [0, gap]], false); // drawn back to 0.004 short of its start
  const moving = segs[3].b, staying = segs[0].a;
  const before = { ...st.joints.get(moving) };
  const nShapes = st.shapes.length, nCons = st.constraints.length;
  const [plan] = planClosePaths(st, [segs[0].id]);
  eq([plan.ok, plan.mode], [true, 'coincident'], '2: planned as coincident');
  const res = applyClosePath(st, plan);
  eq(st.shapes.length, nShapes, '2: no new curve');
  eq(st.constraints.length, nCons + 1, '2: one coincident');
  const after = st.joints.get(moving);
  eq([after.x, after.y], [st.joints.get(staying).x, st.joints.get(staying).y], '2: the END of the LAST curve moved onto the first end');
  const moved = Math.hypot(after.x - before.x, after.y - before.y);
  ok(moved <= CLOSE_PATH_COINCIDENT_MM && Math.abs(res.moved - moved) < 1e-12, `2: moved ${moved} <= ${CLOSE_PATH_COINCIDENT_MM} mm`);
  eq(st.joints.get(staying).x === 0 && st.joints.get(staying).y === 0, true, '2: the first end did not move');
  ok(loopOf(st, segs.map((s) => s.id)), '2: findLoops returns the loop');
  // a held (fixed) moving end: the other end moves instead
  const st2 = newSketchState();
  const s2 = polyline(st2, [[0, 0], [30, 0], [30, 20], [0, 20], [0, gap]], false);
  st2.joints.get(s2[3].b).fixed = true;
  const [p2] = planClosePaths(st2, [s2[0].id]);
  applyClosePath(st2, p2);
  eq([st2.joints.get(s2[3].b).y, st2.joints.get(s2[0].a).y], [gap, gap], '2: a fixed last end stays; the first end moves onto it');
  // just over the tolerance -> a line
  const st3 = newSketchState();
  const s3 = polyline(st3, [[0, 0], [30, 0], [30, 20], [0, 20], [0, CLOSE_PATH_COINCIDENT_MM * 1.5]], false);
  eq(planClosePaths(st3, [s3[0].id])[0].mode, 'line', '2: a gap above the tolerance gets a line');
}

// ── 3. arc and bezier ends
{
  const st = newSketchState();
  const [l1] = polyline(st, [[0, 0], [20, 0]], false);
  const c = click(st, 20, 10), a = click(st, 20, 0), b = click(st, 20, 20);
  const arcId = arc(st, c, a, b, { sweep: true });
  addConstraint(st, CONSTRAINT_TYPES.COINCIDENT, { joints: [l1.b, a] });
  ok(planClosePaths(st, [arcId])[0].ok, '3: a line + an arc END: plannable');
  const res = run(st, [arcId]);
  eq(res.closed.length, 1, '3: closed');
  const line = st.shapes[st.shapes.length - 1];
  const pts = line.joints.map((j) => st.joints.get(j));
  eq(new Set(pts.map((p) => `${p.x},${p.y}`)), new Set(['0,0', '20,20']), '3: the line joins the line\'s start and the ARC\'s end joint');
  ok(loopOf(st, [l1.id, arcId, line.id]), '3: line + arc + closing line: a loop');
  // a bezier as the end curve
  const sb = newSketchState();
  const [m1] = polyline(sb, [[0, 0], [20, 0]], false);
  const p3 = click(sb, 0, 15), p0 = click(sb, 20, 0);
  addConstraint(sb, CONSTRAINT_TYPES.COINCIDENT, { joints: [m1.b, p0] });
  sb.shapes.push({ id: 'bz', type: 'bezier', joints: [p0, p3], c1: [30, 5], c2: [10, 20] });
  eq(openChainEnds(sb).length, 2, '3: the bezier chain has 2 open ends');
  const rb = run(sb, ['bz']);
  eq(rb.closed.length, 1, '3: a chain ending in a BEZIER is closed');
  const lb = sb.shapes[sb.shapes.length - 1];
  eq(new Set(lb.joints.map((j) => { const p = sb.joints.get(j); return `${p.x},${p.y}`; })), new Set(['0,0', '0,15']), '3: joined at the bezier\'s last joint');
  eq(openChainEnds(sb).length, 0, '3: no open end left (closed topologically; findLoops has no bezier edge, so it is not a findLoops loop: documented)');
}

// ── 4. a chain inside a user group (an import's), the group a rigid block
{
  const st = newSketchState();
  const segs = polyline(st, [[0, 0], [30, 0], [30, 20], [0, 20]], false);
  const other = polyline(st, [[50, 0], [60, 0], [60, 10]], false); // a second piece: the file group wraps both
  const shapes = [...segs, ...other].map((s) => st.shapes.find((x) => x.id === s.id));
  const groups = groupImported(st, shapes, { fileName: 'file' });
  const chainGroup = shapes[0].userGroupId;
  ok(chainGroup && groups.some((g) => g.id === chainGroup && g.parentId), '4: the chain is in its own group inside the file group');
  const nCons = st.constraints.length;
  run(st, [segs[0].id]);
  const line = st.shapes[st.shapes.length - 1];
  eq(line.userGroupId, chainGroup, '4: the line joined the chain\'s INNERMOST group');
  eq(st.constraints.length - nCons, 2, '4: only the two coincidents added');
  const blocks = rigidBlocks(st);
  const block = blocks.find((b) => b.shapes.some((s) => s.id === segs[0].id));
  ok(block && block.shapes.some((s) => s.id === line.id), '4: the line is in the chain\'s rigid block');
  // the block stays rigid: a solve keeps every distance inside it
  const ids = [...new Set(block.shapes.flatMap((s) => s.joints))];
  const dists = () => ids.slice(1).map((j) => Math.hypot(st.joints.get(j).x - st.joints.get(ids[0]).x, st.joints.get(j).y - st.joints.get(ids[0]).y));
  const d0 = dists();
  st.model.solveConstraints(500);
  dists().forEach((d, i) => near(d, d0[i], 1e-6, '4: the block keeps its shape after a solve'));
  ok(loopOf(st, [...segs.map((s) => s.id), line.id]), '4: a loop');
}

// ── 5. refused with the reason, no undo step
{
  const cases = [];
  { const st = newSketchState(); const s = polyline(st, [[0, 0], [20, 0], [20, 20]], false); const [t] = polyline(st, [s[0].b, [10, -10]], false); cases.push([st, t.id, /branches \(3 curves meet at one point\)/, 'a T junction']); }
  { const st = newSketchState(); const s = polyline(st, [[0, 0], [20, 0], [20, 20], [0, 20]], true); cases.push([st, s[0].id, /already closed/, 'a closed outline']); }
  { const st = newSketchState(); const c = circle(st, 0, 0, 5); cases.push([st, c.id, /a circle is already closed/, 'a circle']); }
  { const st = newSketchState(); const [l] = polyline(st, [[0, 0], [20, 0]], false); cases.push([st, l.id, /single straight line/, 'a single line']); }
  { const st = newSketchState(); const s = polyline(st, [[0, 0], [10, 0], [20, 0]], false); cases.push([st, s[0].id, /would not enclose an area/, 'two collinear lines (the closing line on the path)']); }
  for (const [st, id, re, what] of cases) {
    const n = { s: st.shapes.length, c: st.constraints.length, h: st.history.length };
    const res = run(st, [id]);
    eq([res.closed.length, res.refused.length], [0, 1], `5: ${what}: refused`);
    eq({ s: st.shapes.length, c: st.constraints.length, h: st.history.length }, n, `5: ${what}: nothing changed, no undo step`);
    ok(re.test(lastNote().m) && lastNote().l === 'warning', `5: ${what}: the notice says why: ${lastNote().m}`);
  }
}

// ── 6. several chains, ONE undo step; undo / redo
{
  const st = newSketchState();
  const a = polyline(st, [[0, 0], [30, 0], [30, 20], [0, 20]], false);
  const b = polyline(st, [[50, 0], [80, 0], [80, 20], [50, 20], [50, 0.003]], false);
  const c = circle(st, 100, 0, 5);
  const hist = st.history.length, nShapes = st.shapes.length, nCons = st.constraints.length;
  const res = run(st, [a[0].id, a[2].id, b[1].id, c.id]); // two curves of A: A once
  eq([res.closed.length, res.refused.length], [2, 1], '6: both open chains closed, the circle refused');
  eq(st.history.length, hist + 1, '6: ONE undo step for both');
  ok(/Closed 2 paths \(1 line added, 1 pair of ends made coincident\) · Not closed|Closed 2 paths \(1 line added, 1 pair of ends made coincident\) · 1 path not closed: a circle is already closed/.test(lastNote().m), '6: ' + lastNote().m);
  eq(findLoops(st).length, 3, '6: three loops (two closed outlines + the circle)');
  st.undo();
  eq([st.shapes.length, st.constraints.length, findLoops(st).length], [nShapes, nCons, 1], '6: undo puts both back');
  eq(st.joints.get(b[3].b).y, 0.003, '6: undo puts the moved end back');
  st.redo();
  eq([st.shapes.length, st.constraints.length, findLoops(st).length], [nShapes + 1, nCons + 3, 3], '6: redo closes both again');
}

// ── 6b. TASK 760b, the group rule: a chain reached only through a group holding other curves (a whole imported file) is closed only when near-closed
{
  const build = (plateGap) => {
    const st = newSketchState();
    const plate = polyline(st, [[0, 0], [30, 0], [30, 20], [0, 20], [0, plateGap]], false);
    const z1 = polyline(st, [[0, 40], [10, 50], [20, 40], [30, 52]], false); // two engraving zigzags (gaps about 31 mm and 20 mm)
    const z2 = polyline(st, [[0, 60], [10, 70], [20, 60]], false);
    const shapes = [...plate, ...z1, ...z2].map((x) => st.shapes.find((y) => y.id === x.id));
    groupImported(st, shapes, { fileName: 'file' });
    return { st, plate, z1, z2, all: shapes.map((x) => x.id) };
  };
  // the whole file selected (a click on the art with nothing entered): only the near-closed plate closes, ONE undo step
  {
    const { st, plate, z1, z2, all } = build(0.08);
    for (const id of all) st.selectedShapes.add(id);
    const n = { s: st.shapes.length, h: st.history.length };
    const res = run(st, all);
    eq([res.closed.length, res.leftOpen.length, res.refused.length], [1, 2, 0], '6b: file group: the plate closed, the two engraving lines left open');
    eq([st.shapes.length, st.history.length], [n.s + 1, n.h + 1], '6b: one line, ONE undo step');
    ok(loopOf(st, [...plate.map((x) => x.id), st.shapes[st.shapes.length - 1].id]), '6b: the plate is a loop');
    eq(openChainEnds(st).length, 4, '6b: both zigzags keep their two free ends');
    eq(lastNote().m, 'Close path: Closed 1 outline · 2 open paths left open (click one with Close path to close it)', '6b: the notice says what was closed and left');
    void z1; void z2;
  }
  // the whole file, nothing near-closed: nothing changes, the notice says so
  {
    const { st, all } = build(5);
    for (const id of all) st.selectedShapes.add(id);
    const n = { s: st.shapes.length, h: st.history.length };
    const res = run(st, all);
    eq([res.closed.length, res.leftOpen.length, st.shapes.length, st.history.length], [0, 3, n.s, n.h], '6b: nothing near-closed: nothing changes, no undo step');
    eq(lastNote().m, 'Close path: Nothing near-closed in the selected group · 3 open paths left open (click one with Close path to close it)', '6b: the notice');
  }
  // a single chain picked directly (the tool's click, or its own group selected inside the entered file): closed with a line, its gap 30 mm
  {
    const { st, z1 } = build(5);
    const r1 = run(st, [z1[1].id]); // the Close path tool's click on one zigzag line
    eq([r1.closed.length, r1.closed[0] && r1.closed[0].mode], [1, 'line'], '6b: a click on one zigzag closes it with a line');
    const b = build(5);
    const zg = b.st.shapes.find((x) => x.id === b.z2[0].id).userGroupId;
    b.st.enteredGroupId = b.st.groups.find((g) => g.id === zg).parentId; // inside the file: the zigzag's own group is the unit
    const ids = b.z2.map((x) => x.id);
    for (const id of ids) b.st.selectedShapes.add(id);
    const r2 = run(b.st, ids);
    eq([r2.closed.length, r2.leftOpen.length], [1, 0], "6b: the zigzag's own group selected (inside the file): closed with a line");
  }
  // two far-gap chains selected individually (no group): both closed
  {
    const st = newSketchState();
    const a = polyline(st, [[0, 0], [10, 10], [20, 0]], false), b = polyline(st, [[40, 0], [50, 10], [60, 0]], false);
    const res = run(st, [a[0].id, b[0].id]);
    eq([res.closed.length, res.leftOpen.length], [2, 0], '6b: two far-gap chains picked individually: both closed');
  }
}

// ── 7. the markers' source: the active sketch's open ends only
{
  const st = newSketchState();
  polyline(st, [[0, 0], [30, 0], [30, 20]], false); // open: 2 ends
  polyline(st, [[50, 0], [70, 0], [70, 20], [50, 20]], true); // closed: none
  const s = polyline(st, [[0, 50], [20, 50], [20, 70]], false); polyline(st, [s[0].b, [20, 40]], false); // a T: 3 free ends
  eq(openChainEnds(st).length, 5, '7: every free end of every open chain (a branching chain\'s too)');
  const sk2 = addSketch(st, 'Other'); activateSketch(st, sk2.id);
  polyline(st, [[0, 100], [10, 100], [10, 110]], false);
  eq(openChainEnds(st).length, 2, '7: only the ACTIVE sketch');
}

// ── 8a. the import detector on the fixtures (the importers themselves, as the app runs them)
const importSvg = (st, text) => {
  // the shared importer's own descriptors are built from the DOM (sketch-import.js); here the fixture's elements are read by regex: path d / polyline points / circle
  const descs = [];
  const tag = (re, f) => { for (const m of text.matchAll(re)) descs.push(f(m)); };
  tag(/<path id="([^"]+)" d="([^"]+)"/g, (m) => ({ tag: 'path', d: m[2], elementId: m[1], descId: 'd' + descs.length }));
  tag(/<polyline id="([^"]+)" points="([^"]+)"/g, (m) => ({ tag: 'polyline', points: m[2], elementId: m[1], descId: 'd' + descs.length }));
  tag(/<circle id="([^"]+)" cx="([^"]+)" cy="([^"]+)" r="([^"]+)"/g, (m) => ({ tag: 'circle', cx: m[2], cy: m[3], r: m[4], descId: 'd' + descs.length }));
  const sc = computeImportScale({ width: '100mm', height: '100mm', viewBox: '0 0 100 100' });
  return importSvgGeometry(descs, { genJ: () => st.genJ(), scale: sc.scale, idPrefix: 'svg' });
};
const land = (st, parsed) => { for (const j of parsed.joints) st.joints.set(j.id, { x: j.x, y: j.y }); for (const s of parsed.shapes) st.shapes.push(s); return parsed.shapes; };
const detect = {};
for (const [name, read] of [
  ['gap005', (st) => land(st, importSvg(st, FIX('svg', 'close-path-760-gap005.svg')))],
  ['gap5', (st) => land(st, importSvg(st, FIX('svg', 'close-path-760-gap5.svg')))],
  ['engraving', (st) => land(st, importSvg(st, FIX('svg', 'close-path-760-engraving.svg')))],
  ['dxf', (st) => land(st, importDxf(FIX('dxf', 'close-path-760-gap.dxf'), { genJ: () => st.genJ(), idPrefix: 'dxf' }))],
]) {
  const st = newSketchState();
  const shapes = read(st);
  const d = nearClosedChains(st, shapes.map((s) => s.id));
  detect[name] = { offered: d.offered.length, leftOpen: d.leftOpen, largestGap: Math.round(d.largestGap * 1e6) / 1e6, offeredSizes: d.offered.map((o) => o.ids.length) };
}
eq(detect.gap005, { offered: 1, leftOpen: 0, largestGap: 0.05, offeredSizes: [4] }, '8: SVG 0.05 mm gap: the outline offered, the circle (closed) not counted');
eq(detect.gap5, { offered: 0, leftOpen: 1, largestGap: 0, offeredSizes: [] }, '8: SVG 5 mm gap: NOT offered (> ' + NEAR_CLOSED_MM + ' mm), counted as left open');
eq(detect.engraving, { offered: 1, leftOpen: 1, largestGap: 0.08, offeredSizes: [4] }, '8: the 0.08 mm plate offered, the engraving zigzag left open');
eq(detect.dxf, { offered: 1, leftOpen: 1, largestGap: 0.05, offeredSizes: [4] }, '8: DXF: the arc + 3 lines outline (0.05 mm, at the ARC\'s end) offered, the lone line left open');
// the relative rule: a 3 mm letter-sized outline with a 0.4 mm opening is not offered (0.4 > 2 % of its size), the same opening on a 40 mm outline is
{
  const small = newSketchState(); const s = polyline(small, [[0, 0], [3, 0], [3, 3], [0, 3], [0, 0.4]], false);
  const big = newSketchState(); const b = polyline(big, [[0, 0], [40, 0], [40, 40], [0, 40], [0, 0.4]], false);
  eq([nearClosedChains(small, s.map((x) => x.id)).offered.length, nearClosedChains(big, b.map((x) => x.id)).offered.length], [0, 1], `8: relative rule (${NEAR_CLOSED_REL * 100} % of the size)`);
}

// ── 8b / 10. in SketchStudio: the import -> ONE notice with "Close them" -> exactly the offered chains closed, its own undo step. 10: a document Close path was
// not used on exports byte-identically (the offer only reads; the tool switched on and off with nothing closed changes nothing)
{
  const app = await open({ host: 'sketchstudio', sidebar: true });
  try {
    const doc = app.document, st = app.state;
    const { buildSVG, buildDXF } = await import('#app/ui/export-manager.js');
    const before = { s: st.shapes.length, c: st.constraints.length };
    app.importFile(FIX('svg', 'close-path-760-engraving.svg'), 'close-path-760-engraving.svg');
    await app.waitFor(() => st.shapes.length > before.s, 'the import to land');
    const toasts = () => [...doc.querySelectorAll('#notification-container > div')];
    const offers = () => toasts().filter((t) => t.querySelector('.notif-action-btn'));
    eq(offers().length, 1, '8b: ONE notice with an action');
    const offer = offers()[0];
    eq(offer.querySelector('pre').textContent, '1 outline is almost closed (largest gap 0.08 mm) · 1 open path left open', '8b: the notice text');
    eq(offer.querySelector('.notif-action-btn').textContent, 'Close them', '8b: its action');
    eq(st.shapes.length - before.s, 8, "8b: the importer's 8 lines (4 engraving + 4 plate), nothing added");
    eq(findLoops(st).length, 0, '8b: nothing closed by the import itself');
    // 10. read-only offer + tool on / off: the exports are byte-identical
    // (positions to 1e-9: the render loop's solve of a frame may move a free point by 1e-15, with or without this task)
    const snap = () => JSON.stringify({ j: [...st.joints].map(([id, p]) => [id, Math.round(p.x * 1e9), Math.round(p.y * 1e9), !!p.fixed]), s: st.shapes, c: st.constraints, g: st.groups });
    const exportsOf = () => buildSVG(st) + '\n----\n' + buildDXF(st);
    const s0 = snap(), e0 = exportsOf();
    offerToCloseImported(st, st.shapes.filter((x) => x.id.startsWith('svg')), () => {});
    st.selectedShapes.clear();
    app.key('C', { shift: true }); await app.pause(30); // the Close path tool, nothing selected: nothing closed, its open ends marked
    eq(st.currentTool, TOOL_MODES.CLOSE_PATH, '10: Shift+C switched to Close path');
    ok(doc.querySelectorAll('.open-end-marker').length === 4, "10: the 4 open ends are marked (the plate's 2, the engraving's 2)");
    app.key('s'); await app.pause(30);
    eq(doc.querySelectorAll('.open-end-marker').length, 0, '10: no marker once the tool is off');
    eq(snap(), s0, '10: the state is unchanged (to 1e-9 mm)');
    eq(exportsOf(), e0, '10: the SVG and DXF exports are byte-identical');
    const imported = { s: st.shapes.length, c: st.constraints.length, h: st.history.length };
    app.press(offer.querySelector('.notif-action-btn'));
    eq(st.shapes.length, imported.s + 1, '8b: Close them added ONE line (gap 0.08 > ' + CLOSE_PATH_COINCIDENT_MM + ' mm)');
    eq(st.history.length, imported.h + 1, '8b: its own undo step');
    eq(findLoops(st).length, 1, '8b: the plate is a loop now');
    eq(openChainEnds(st).length, 2, '8b: the engraving line is still open (its two ends)');
    eq(st.selectedShapes.size, 5, '8b: the closed outline (its 4 lines + the new one) is selected');
    ok(!offer.isConnected || offer.style.opacity === '0', '8b: the offer is dismissed');
    app.undo(); await app.pause(50);
    eq([st.shapes.length, st.constraints.length, findLoops(st).length], [imported.s, imported.c, 0], '8b: ONE undo removes only the close (the import stays)');
    app.undo(); await app.pause(50);
    eq(st.shapes.length, before.s, '8b: the next undo removes the import');
  } finally { await app.close(); }
}

// ── 9. the declarations
{
  const ids = RIBBON_TOOLS.map((t) => t.tool || t.action);
  eq(ids.indexOf(TOOL_MODES.CLOSE_PATH), ids.indexOf(TOOL_MODES.BREAK) + 1, '9: the ribbon button is right after Break (Modify)');
  const btn = RIBBON_TOOLS.find((t) => t.tool === TOOL_MODES.CLOSE_PATH);
  eq([btn.shortcut, btn.ariaLabel, !!btn.iconSvg], ['tool.closePath', 'Close Path', true], '9: its key, name, icon');
  eq(TOOL_SHORTCUTS['tool.closePath'], TOOL_MODES.CLOSE_PATH, '9: the key opens the tool');
  const ev = (key, shift) => ({ key, shiftKey: !!shift, ctrlKey: false, metaKey: false, altKey: false });
  const letters = SHORTCUTS.filter((s) => s.scope === 'canvas').map((s) => s.id);
  eq([matchShortcut(ev('C', true), letters), matchShortcut(ev('c'), letters)], ['tool.closePath', 'tool.circle'], '9: Shift+C = Close path, C = Circle');
  eq(shortcutConflicts('tool.closePath', shortcutById('tool.closePath').keys[0]), [], '9: no conflict (the 747 rule)');
  ok(FEATURES.includes('close-path'), '9: the analytics feature');
}

console.log(`close-path-760-node: ok (${checks} checks)`);
