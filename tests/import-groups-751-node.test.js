// tests/import-groups-751-node.test.js — TASK 751 (node, through tests/helpers/node-app.js): imported outlines are user groups, nested.
//  1. the NESTED group model (#core/group-model.js): parentId, selectUnit (the outermost group below the entered level), a group of groups,
//     ungroup dissolves ONE level, an old flat document loads unchanged (and selects as a one-level nest);
//  2. Shaper's import (SVG and DXF) groups in the app: each profile (outline + holes) / open chain a group, named after its element; an
//     island inside a hole its own group; the whole file ONE group around them; a single-profile file just that group; import + groups =
//     ONE undo step; ungroup returns loose geometry; TASK 756: SketchStudio's import lands with the same groups (every app has user groups);
//  3. exports are BYTE-IDENTICAL with and without the groups: Shaper's file and its 2D preview copy (no <g> gained), SketchStudio's SVG / DXF;
//  4. the Select tool, real pointer events: a click on a letter selects the whole FILE group, a drag moves every joint by the same vector
//     (lengths unchanged); a double click enters (the letter, outline + hole); again (its curves); a click on empty canvas / Esc steps out;
//     a box selects whole groups; a hand-made group of a rectangle + a circle behaves the same; a drawing without groups selects as before;
//     a DXF spline (bezier) moves rigidly with its group (its control points follow); arcs and circles keep their radius;
//  5. a double TAP (pointerType touch) 10 px apart within 500 ms is a double click (TASK 751: DOUBLE_TAP_SLOP_PX); with a mouse it stays two.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import SettingsManager from '#core/settings-manager.js';
import { makeGroup, ungroup, selectUnit, shapesInGroup, childGroups, enterGroup, stepOutOfGroup, groupChain, importedPieces } from '#core/group-model.js';
import { findConnectedChain } from '#core/loop-finder.js';
import { planEntries } from '../apps/shaper/src/cut-plan.js';
import { shaperSvgOf, shaperPreviewOf } from '../apps/shaper/src/export-payload.js';
import { buildSVG, buildDXF } from '../apps/sketchstudio/ui/export-manager.js';

SettingsManager.set('GRID_MAGNETISM', 0.001, { persist: 'none' });
const HERE = path.dirname(fileURLToPath(import.meta.url));
const quiet = (fn) => async (...a) => { const log = console.log; console.log = () => {}; try { return await fn(...a); } finally { console.log = log; } };
let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const measured = {};
const PAIR_GAP_MS = 600;

// ---- 1. the nested model
{
  const S = (id) => ({ id, type: 'line', joints: [id + 'a', id + 'b'] });
  const st = { shapes: ['a1', 'a2', 'b1', 'b2', 'c1'].map(S), groups: [], activeSketchId: 'sketch-1' };
  const A = makeGroup(st, ['a1', 'a2'], 'A'), B = makeGroup(st, ['b1', 'b2'], 'B');
  const F = makeGroup(st, ['a1', 'a2', 'b1', 'b2', 'c1'], 'File');
  eq([A.parentId, B.parentId, F.parentId], [F.id, F.id, undefined], 'a selection of whole groups nests them (parentId), the new group at the top');
  eq(st.shapes.map((s) => s.userGroupId), [A.id, A.id, B.id, B.id, F.id], 'a shape keeps its INNERMOST group; the loose shape joins the new group');
  eq(shapesInGroup(st, F.id).sort(), ['a1', 'a2', 'b1', 'b2', 'c1'], 'shapesInGroup: the group and its child groups');
  eq(childGroups(st, F.id), [A.id, B.id], 'childGroups');
  eq(groupChain(st, st.shapes[0]), [A.id, F.id], 'the chain: innermost to outermost');
  eq(selectUnit(st, 'a1'), F.id, 'nothing entered: the outermost group');
  enterGroup(st, F.id);
  eq([selectUnit(st, 'a1'), selectUnit(st, 'c1')], [A.id, null], 'inside the file: the child group, or the curve itself');
  enterGroup(st, A.id);
  eq(selectUnit(st, 'a1'), null, 'inside the letter: its curves');
  eq(selectUnit(st, 'b1'), F.id, 'outside the entered group: its outermost group');
  ok(stepOutOfGroup(st) && st.enteredGroupId === F.id, 'step out one level');
  ok(stepOutOfGroup(st) && st.enteredGroupId === null && !stepOutOfGroup(st), 'step out to the top; nothing more to step out of');
  const C = makeGroup(st, ['a1', 'a2'], 'Cgroup');
  eq([C.parentId, A.parentId], [F.id, C.id], 'grouping a whole child group inside its parent: made inside that parent');
  ungroup(st, C.id);
  eq(A.parentId, F.id, 'ungroup dissolves ONE level: the child moves up to the parent');
  enterGroup(st, F.id); ungroup(st, F.id);
  eq([A.parentId, B.parentId, st.shapes[4].userGroupId, st.enteredGroupId], [undefined, undefined, undefined, null], 'ungrouping the outer group: children top-level, its own member loose; the entered group gone');
  eq(st.groups.map((g) => g.id), [A.id, B.id], 'the two letters remain');
  measured.model = 'ok';
}

// ---- 2. import groups (Shaper)
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="60mm" viewBox="0 0 200 60">
  <path id="O" fill="#000000" d="M10 10 H30 V50 H10 Z M15 15 H25 V45 H15 Z"/>
  <path id="A" fill="#000000" d="M40 50 L50 10 L60 50 Z M47 40 L50 28 L53 40 Z"/>
  <path id="B" fill="#000000" d="M70 10 H90 V50 H70 Z M75 15 H85 V27 H75 Z M75 33 H85 V45 H75 Z"/>
  <path id="T" fill="#000000" d="M100 10 H140 V50 H100 Z M105 15 H135 V45 H105 Z"/>
  <rect id="isl" fill="#7F7F7F" x="112" y="22" width="16" height="16"/>
  <polyline id="tail" points="150,10 160,20 170,10" fill="none" stroke="#7F7F7F"/>
  <polygon fill="#000000" points="175,40 185,40 180,50"/>
  <circle id="dot" fill="#FFFFFF" stroke="#000000" cx="190" cy="15" r="2"/>
</svg>`;
const groupsByName = (st) => Object.fromEntries(st.groups.map((g) => [g.name, g]));
const strip = (st) => Object.create(st, { shapes: { value: st.shapes.map(({ userGroupId, ...s }) => s) }, groups: { value: [] } });

const shaper = await quiet(open)({ host: 'shaper', profile: await createProfile() });
let letterEdge;
try {
  const st = shaper.state;
  const sk0 = st.sketches.length, g0 = st.groups.length;
  await quiet(shaper.importFile)(SVG, 'letters.svg');
  const imported = st.shapes.filter((s) => s.sketchId === st.activeSketchId);
  const G = groupsByName(st);
  const file = G.letters;
  ok(file && !file.parentId, 'the whole file is ONE top-level group named after the file');
  eq(childGroups(st, file.id).map((id) => st.groups.find((g) => g.id === id).name), ['O', 'A', 'B', 'T', 'isl', 'tail', 'Outline 6'], 'each profile / chain is a child group, named after its element (no id: "Outline N")');
  const n = (name) => shapesInGroup(st, G[name].id).length;
  eq([n('O'), n('A'), n('B'), n('T'), n('isl'), n('tail'), n('Outline 6')], [8, 6, 12, 8, 4, 2, 3], 'O / A / B: outline + holes; T: outline + hole; the island its own group; the open chain; the no-id triangle');
  const dot = imported.find((s) => s.type === 'circle');
  eq(dot.userGroupId, file.id, 'a one-shape profile (the dot) is a direct member of the file group (no group of one)');
  eq(shapesInGroup(st, file.id).length, imported.length, 'every imported shape is in the file group');
  measured.svgGroups = st.groups.map((g) => `${g.name}${g.parentId ? '<' + st.groups.find((p) => p.id === g.parentId).name : ''}:${shapesInGroup(st, g.id).length}`);

  // exports: byte-identical with vs without groups (Shaper's file + its preview copy, every cut the import kept)
  const entries = planEntries();
  ok(entries.length >= 8, 'the import kept the cut of every element (the export has content): ' + entries.length);
  const withG = shaperSvgOf(st, entries), withoutG = shaperSvgOf(strip(st), entries);
  eq(withG, withoutG, 'Shaper export: byte-identical with and without the groups');
  eq((withG.match(/<g[\s>]/g) || []).length, (withoutG.match(/<g[\s>]/g) || []).length, 'Shaper export: no <g> gained');
  eq(shaperPreviewOf(st, entries).svg, shaperPreviewOf(strip(st), entries).svg, 'Shaper 2D preview copy: byte-identical');
  eq(buildSVG(st), buildSVG(strip(st)), 'SketchStudio SVG exporter on the grouped drawing: byte-identical');
  eq(buildDXF(st), buildDXF(strip(st)), 'SketchStudio DXF exporter on the grouped drawing: byte-identical');
  measured.export = { entries: entries.length, bytes: withG.length, g: (withG.match(/<g[\s>]/g) || []).length };

  // ONE undo step: the import and its groups go together; redo brings both back
  shaper.undo();
  eq([st.sketches.length, st.groups.length, st.shapes.filter((s) => imported.some((x) => x.id === s.id)).length], [sk0, g0, 0], 'one Ctrl+Z removes the import and its groups');
  shaper.redo();
  eq([st.groups.length, shapesInGroup(st, groupsByName(st).letters.id).length], [8, imported.length], 'Ctrl+Y brings both back');

  // ungroup: the file level, then a letter: loose geometry, no constraint added
  const nCons = st.constraints.length;
  ungroup(st, groupsByName(st).letters.id);
  eq(groupsByName(st).O.parentId, undefined, 'ungrouping the file: the letters become top-level groups');
  ungroup(st, groupsByName(st).O.id);
  eq(imported.filter((s) => s.id.startsWith(imported[0].id.replace(/_s\d+$/, '')) && st.shapes.find((x) => x.id === s.id).userGroupId === undefined).length >= 8, true, 'ungrouping O: its 8 lines are loose');
  eq(st.constraints.length, nCons, 'grouping / ungrouping adds no constraint');
  shaper.undo(); // (a direct model call: the undo here goes back past the import's redo; the page path is the live test's Ctrl+Shift+G)
} finally { await shaper.close(); }

// DXF: a plate with a hole (Fusion's part-mm.dxf) and a SketchStudio import (no groups)
{
  const dxf = fs.readFileSync(path.join(HERE, 'fixtures', 'dxf', 'part-mm.dxf'), 'utf8');
  const app = await quiet(open)({ host: 'shaper', profile: await createProfile() });
  try {
    const st = app.state;
    await quiet(app.importFile)(dxf, 'part-mm.dxf');
    const imported = st.shapes.filter((s) => s.sketchId === st.activeSketchId);
    const pieces = importedPieces(st, imported);
    measured.dxf = { shapes: imported.length, pieces: pieces.map((p) => p.shapeIds.length), groups: st.groups.map((g) => `${g.name}${g.parentId ? '<' + g.parentId : ''}:${shapesInGroup(st, g.id).length}`) };
    ok(st.groups.length >= 1, 'the DXF import is grouped');
    const top = st.groups.filter((g) => !g.parentId);
    eq(top.length, 1, 'one top-level group for the file');
    eq(shapesInGroup(st, top[0].id).length, imported.length, 'every imported DXF shape is inside it');
    // TASK 751: a group drag moves the DXF spline (a bezier: its control points are shape data) with the rest: every sampled point of the
    // curve, the circle's radius and the arc's centre / radius move rigidly (a click on a plate edge selects the file group, then a drag)
    app.tool('select');
    const bz = st.shapes.find((s) => s.type === 'bezier'), arc = st.shapes.find((s) => s.type === 'arc'), circ = st.shapes.find((s) => s.type === 'circle');
    const P = (id) => st.joints.get(id);
    const curve = () => { const p0 = P(bz.joints[0]), p3 = P(bz.joints[1]); const pts = []; for (let k = 0; k <= 8; k++) { const t = k / 8, u = 1 - t; pts.push({ x: u * u * u * p0.x + 3 * u * u * t * bz.c1[0] + 3 * u * t * t * bz.c2[0] + t * t * t * p3.x, y: u * u * u * p0.y + 3 * u * u * t * bz.c1[1] + 3 * u * t * t * bz.c2[1] + t * t * t * p3.y }); } return pts; };
    const arcGeo = () => ({ c: { ...P(arc.joints[0]) }, r: Math.hypot(P(arc.joints[1]).x - P(arc.joints[0]).x, P(arc.joints[1]).y - P(arc.joints[0]).y) });
    const c0 = curve(), a0 = arcGeo(), r0 = circ.radius, cc0 = { ...P(circ.joints[0]) };
    const L = st.shapes.find((s) => s.type === 'line'); const la = P(L.joints[0]), lb = P(L.joints[1]);
    const p = app.toScreen((la.x + lb.x) / 2, (la.y + lb.y) / 2);
    await app.pause(PAIR_GAP_MS); await quiet(async () => app.drag(p, { x: p.x + 80, y: p.y + 40 }, 10))();
    const c1 = curve(), a1 = arcGeo(), cc1 = P(circ.joints[0]);
    const v = { x: cc1.x - cc0.x, y: cc1.y - cc0.y };
    const curveErr = Math.max(...c1.map((q, k) => Math.hypot(q.x - c0[k].x - v.x, q.y - c0[k].y - v.y)));
    measured.dxfDrag = { v, curveErr, arcR: [a0.r, a1.r], arcCentreErr: Math.hypot(a1.c.x - a0.c.x - v.x, a1.c.y - a0.c.y - v.y), circleR: [r0, circ.radius] };
    ok(Math.hypot(v.x, v.y) > 3, 'the file moved');
    ok(curveErr < 1e-6, 'every sampled point of the spline (bezier) moved by the same vector: ' + curveErr);
    ok(Math.abs(a1.r - a0.r) < 1e-9 && measured.dxfDrag.arcCentreErr < 1e-6 && circ.radius === r0, 'the arc (centre, radius) and the circle radius moved rigidly / unchanged');
  } finally { await app.close(); }
  const studio = await quiet(open)({ host: 'sketchstudio', profile: await createProfile() });
  try {
    await quiet(studio.importFile)(SVG, 'letters.svg');
    eq(studio.state.groups.map((g) => `${g.name}${g.parentId ? '<' + studio.state.groups.find((p) => p.id === g.parentId).name : ''}:${shapesInGroup(studio.state, g.id).length}`), measured.svgGroups,
      'TASK 756: the SketchStudio import lands with the same groups as the Shaper import (user groups are part of the shared Design tab)');
  } finally { await studio.close(); }
}

// ---- 4. the Select tool on groups (Shaper), real pointer events
const lineMid = (app, id, t = 0.5) => { const st = app.state, s = st.shapes.find((x) => x.id === id), a = st.joints.get(s.joints[0]), b = st.joints.get(s.joints[1]); return app.toScreen(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t); };
const sel = (st) => [...st.selectedShapes].sort();
const len = (st, s) => { const a = st.joints.get(s.joints[0]), b = st.joints.get(s.joints[1]); return Math.hypot(b.x - a.x, b.y - a.y); };
{
  const app = await quiet(open)({ host: 'shaper', profile: await createProfile() });
  try {
    const st = app.state;
    await quiet(app.importFile)(SVG, 'letters.svg');
    app.tool('select');
    const G = groupsByName(st);
    const fileIds = shapesInGroup(st, G.letters.id).sort(), oIds = shapesInGroup(st, G.O.id).sort();
    const oEdge = shapesInGroup(st, G.O.id).find((id) => st.shapes.find((s) => s.id === id).type === 'line'); // O's outer left edge (first line)
    const outline = findConnectedChain(st, oEdge).sort();
    eq(outline.length, 4, 'the outline of O is 4 lines (its hole the other 4)');
    // a click on a letter: the whole FILE group
    await app.pause(PAIR_GAP_MS); let p = lineMid(app, oEdge); app.click(p.x, p.y);
    eq(sel(st), fileIds, 'a click on a letter selects the whole file group');
    // a drag: every imported joint moves by the same vector, lengths unchanged
    const joints0 = new Map([...st.joints].map(([id, j]) => [id, { x: j.x, y: j.y }]));
    const lens0 = new Map(st.shapes.filter((s) => s.type === 'line').map((s) => [s.id, len(st, s)]));
    await app.pause(PAIR_GAP_MS);
    await quiet(async () => app.drag(p, { x: p.x + 60, y: p.y + 30 }, 12))();
    const moved = st.shapes.filter((s) => fileIds.includes(s.id)).flatMap((s) => s.joints).map((id) => ({ dx: st.joints.get(id).x - joints0.get(id).x, dy: st.joints.get(id).y - joints0.get(id).y }));
    const v = moved[0];
    const spread = Math.max(...moved.map((m) => Math.hypot(m.dx - v.dx, m.dy - v.dy)));
    const lenErr = Math.max(...st.shapes.filter((s) => s.type === 'line').map((s) => Math.abs(len(st, s) - lens0.get(s.id))));
    measured.fileDrag = { v, spread, lenErr };
    ok(Math.hypot(v.dx, v.dy) > 3 && spread < 1e-6 && lenErr < 1e-6, 'the drag moved every joint of the file by the same vector, every length unchanged ' + JSON.stringify(measured.fileDrag));
    // a double click: enters the file, selects the letter (outline + hole)
    await app.pause(PAIR_GAP_MS); p = lineMid(app, oEdge); app.dblclick(p.x, p.y);
    eq([st.enteredGroupId, sel(st)], [G.letters.id, oIds], 'a double click enters the file: the letter (outline + hole) is selected');
    // a click on another letter (inside the file): that letter
    const aEdge = shapesInGroup(st, G.A.id)[0];
    await app.pause(PAIR_GAP_MS); p = lineMid(app, aEdge); app.click(p.x, p.y);
    eq(sel(st), shapesInGroup(st, G.A.id).sort(), 'inside the file, a click selects one letter');
    // a drag of the letter moves only it
    const before = new Map([...st.joints].map(([id, j]) => [id, { x: j.x, y: j.y }]));
    await app.pause(PAIR_GAP_MS);
    await quiet(async () => app.drag(p, { x: p.x - 40, y: p.y }, 10))();
    const movedIds = [...st.joints.keys()].filter((id) => before.has(id) && (st.joints.get(id).x !== before.get(id).x || st.joints.get(id).y !== before.get(id).y));
    const aJoints = new Set(shapesInGroup(st, G.A.id).flatMap((id) => st.shapes.find((s) => s.id === id).joints));
    eq(movedIds.filter((id) => !aJoints.has(id)), [], 'dragging the letter moved only its joints');
    ok(movedIds.length === aJoints.size, 'every joint of the letter moved');
    // a double click on O enters it: its curves
    await app.pause(PAIR_GAP_MS); p = lineMid(app, oEdge); app.dblclick(p.x, p.y);
    eq([st.enteredGroupId, sel(st)], [G.O.id, [oEdge]], 'a double click on the letter enters it: the curve is selected');
    await app.pause(PAIR_GAP_MS); app.click(p.x, p.y);
    eq(sel(st), [oEdge], 'inside the letter a click selects one curve');
    await app.pause(PAIR_GAP_MS); app.dblclick(p.x, p.y);
    eq(sel(st), outline, 'at the innermost level a double click is TASK 588\'s chain select (the outline, not the hole)');
    // a click on empty canvas steps out one level; Esc one more
    await app.pause(PAIR_GAP_MS); const empty = app.toScreen(-30, -30); app.click(empty.x, empty.y);
    eq(st.enteredGroupId, G.letters.id, 'a click on empty canvas steps out one level');
    app.esc();
    eq(st.enteredGroupId, null, 'Esc steps out one more level');
    app.esc();
    eq([st.enteredGroupId, sel(st)], [null, []], 'Esc with nothing entered: as today (clears the selection)');
    // a box: whole groups at the current level (a window box over the O only takes nothing at the top level: the file is bigger)
    enterGroup(st, G.letters.id);
    const oPts = shapesInGroup(st, G.O.id).flatMap((id) => st.shapes.find((s) => s.id === id).joints).map((id) => st.joints.get(id));
    const bx = (f, k) => f(...oPts.map((q) => q[k]));
    const b0 = app.toScreen(bx(Math.min, 'x') - 3, bx(Math.min, 'y') - 3), b1 = app.toScreen(bx(Math.max, 'x') + 3, bx(Math.max, 'y') + 3);
    await app.pause(PAIR_GAP_MS); await quiet(async () => app.drag({ x: Math.min(b0.x, b1.x), y: Math.min(b0.y, b1.y) }, { x: Math.max(b0.x, b1.x), y: Math.max(b0.y, b1.y) }, 6))();
    measured.boxInFile = sel(st);
    ok(shapesInGroup(st, G.O.id).every((id) => st.selectedShapes.has(id)) && sel(st).length === oIds.length, 'inside the file a window box around O selects the whole O');
    measured.select = 'ok';
  } finally { await app.close(); }
}

// a HAND-MADE group (a rectangle + a circle, grouped with the model's makeGroup as Ctrl+G does) behaves the same; a loose line does not
{
  const J = (x, y) => ({ x, y, fixed: false, sketchId: 'sketch-1' });
  const doc = { version: 3, hosts: {}, geometry: {
    joints: [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }], ['r1', J(0, 0)], ['r2', J(40, 0)], ['r3', J(40, 30)], ['r4', J(0, 30)], ['c', J(70, 15)], ['l1', J(0, 50)], ['l2', J(40, 50)]],
    shapes: [['E1', 'r1', 'r2'], ['E2', 'r2', 'r3'], ['E3', 'r3', 'r4'], ['E4', 'r4', 'r1'], ['L', 'l1', 'l2']].map(([id, a, b]) => ({ id, type: 'line', joints: [a, b], sketchId: 'sketch-1', isConstruction: false }))
      .concat([{ id: 'C', type: 'circle', joints: ['c'], radius: 10, sketchId: 'sketch-1', isConstruction: false }]).map((s) => (s.id === 'L' ? s : { ...s, userGroupId: 'group-1' })),
    constraints: [], sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }], activeSketchId: 'sketch-1',
    groups: [{ id: 'group-1', name: 'Group 1', sketchId: 'sketch-1' }], profiles: [], parameters: [] } }; // an OLD flat document (no parentId)
  const profile = await createProfile();
  await createNamedDesign(profile, 'shaper', 'Task 751 hand-made', doc);
  const app = await quiet(open)({ host: 'shaper', profile });
  try {
    const st = app.state; app.tool('select');
    eq(st.groups, [{ id: 'group-1', name: 'Group 1', sketchId: 'sketch-1' }], 'an old flat document loads unchanged');
    const r = app.svg.getBoundingClientRect();
    Object.assign(st.view, { x: 35, y: 25, w: 130 }); st.view.h = st.view.w / (r.width / r.height);
    app.svg.setAttribute('viewBox', `${st.view.x - st.view.w / 2} ${st.view.y - st.view.h / 2} ${st.view.w} ${st.view.h}`); app.frames();
    await app.pause(PAIR_GAP_MS); let p = lineMid(app, 'E1'); app.click(p.x, p.y);
    eq(sel(st), ['C', 'E1', 'E2', 'E3', 'E4'], 'a click on the rectangle selects the whole hand-made group (rectangle + circle)');
    await app.pause(PAIR_GAP_MS); app.dblclick(p.x, p.y);
    eq([st.enteredGroupId, sel(st)], ['group-1', ['E1']], 'a double click enters it: the edge');
    await app.pause(PAIR_GAP_MS); p = lineMid(app, 'L'); app.click(p.x, p.y);
    eq([st.enteredGroupId, sel(st)], [null, ['L']], 'a click on the loose line (outside the entered group) leaves the group and selects the line alone, as today');
    await app.pause(PAIR_GAP_MS); app.dblclick(p.x, p.y);
    eq(sel(st), ['L'], 'a double click on an ungrouped line: its chain (TASK 588), unchanged');
  } finally { await app.close(); }
}

// ---- 5. a double TAP: two touch presses 10 px apart within 500 ms pair; two mouse presses 10 px apart do not
{
  const J = (x, y) => ({ x, y, fixed: false, sketchId: 'sketch-1' });
  const doc = { version: 3, hosts: {}, geometry: {
    joints: [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }], ['r1', J(0, 0)], ['r2', J(60, 0)], ['r3', J(60, 30)], ['r4', J(0, 30)]],
    shapes: [['E1', 'r1', 'r2'], ['E2', 'r2', 'r3'], ['E3', 'r3', 'r4'], ['E4', 'r4', 'r1']].map(([id, a, b]) => ({ id, type: 'line', joints: [a, b], sketchId: 'sketch-1', isConstruction: false })),
    constraints: [], sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }], activeSketchId: 'sketch-1', groups: [], profiles: [], parameters: [] } };
  const profile = await createProfile();
  await createNamedDesign(profile, 'sketchstudio', 'Task 751 tap', doc);
  const app = await quiet(open)({ host: 'sketchstudio', profile });
  try {
    const st = app.state; app.tool('select');
    const a = lineMid(app, 'E1', 0.3), b = { x: a.x + 6, y: a.y }; // 6 px apart along the edge (both on it)
    const c = lineMid(app, 'E1', 0.3 + 10 / Math.max(1, Math.abs(lineMid(app, 'E1', 1).x - lineMid(app, 'E1', 0).x))); // 10 px along
    const tap = { pointerType: 'touch' };
    await app.pause(PAIR_GAP_MS); app.click(a.x, a.y, tap); app.click(c.x, c.y, tap);
    measured.tap10 = { a, c, sel: sel(st) };
    eq(sel(st), ['E1', 'E2', 'E3', 'E4'], 'two taps 10 px apart are a double tap: the chain');
    await app.pause(PAIR_GAP_MS); app.click(a.x, a.y); app.click(c.x, c.y);
    eq(sel(st), ['E1'], 'two mouse clicks 10 px apart stay two clicks (DOUBLE_CLICK_SLOP_PX 5 unchanged)');
    await app.pause(PAIR_GAP_MS); app.click(a.x, a.y, tap); await app.pause(PAIR_GAP_MS); app.click(b.x, b.y, tap);
    eq(sel(st), ['E1'], 'a slow second tap stays a tap');
  } finally { await app.close(); }
}

console.log('import-groups-751-node: ok (' + checks + ' checks) ' + JSON.stringify(measured));
