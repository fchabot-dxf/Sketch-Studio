// tests/boundary-810-node.test.js — TASK 810 (owner turn 2656): Roughing's MACHINING BOUNDARY is the user's choice (#core/stepped-cut.js ROUGH_BOUNDARY, its TASK 810
// header), and the Roughing / Contour cards are TABBED (apps/shaper/src/cut-panel.js CARD_TABS). Every outline and mesh is BUILT IN THE TEST.
//  1. THE DECLARATION: the tool rule's growth (Inside 0.25, On 0.75, Outside 1.25 bits), the calculated offset (0.75 bit + the allowance), and the defaults' growth
//     = TASK 792's (allowance + 2 bits) to the last bit (Object.is).
//  2. MEASURED: each boundary (Silhouette, Bounding box) x tool (Inside, On, Outside) x offset (calculated, 0, +5, -5) roughs a measured area: the work area W is the
//     boundary grown by offset + tool bits (area of a rectangle grown with round corners, or shrunk with sharp ones), the cut = W minus the part's material; the bit
//     centre's area (W shrunk by the bit radius + the Origin's keep-back) is the boundary moved by offset + (-r, 0, +r).
//  3. REFUSED: a boundary that leaves no room for the bit (Inside a 4 mm square with a 6.35 mm bit) roughs nothing: error 'no-room'.
//  4. BYTE-IDENTICAL: the default export of three test reliefs (a dome, a 10-degree drafted pocket, a block with a pocket and a hole) in six configurations (terraces 1/8,
//     terraces 1/4, nested, min terrace width, + Contour, nested + Contour) is the export of commit 81226b7 (before this task): its sha256.
//  5. THE APP (tests/helpers/node-app.js, the real card): a Fusion-style payload (a part with levels, a big rectangle, a smaller one): the Roughing card's tabs (Tool,
//     Geometry, Heights, Passes; Geometry holds the boundary rows), the Stock greyed until a Stock exists, Bounding box / Stock / Shape each change the export,
//     Pick + a click on the smaller rectangle = ONE undo step (the selection unchanged), the shape FOLLOWS an edit of it, a picked key follows a key rename
//     (renamePlanKeys), the tab dot, a typed Offset (Reset = calculated), the refusal note, operation keys (defaults = the key before 810), save + reload.
import assert from 'node:assert';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { open } from './helpers/node-app.js';
import * as M from './helpers/stl-mesh.js';
import { worldToScreen } from '#ui/coords.js';
import SettingsManager from '#core/settings-manager.js';
import { ROUGH_BOUNDARY, BOUNDARY_CALC_OFFSET_BITS, boundaryToolBits, roughingWorkGrow, boundaryCalcOffset, levelsRoughingFor, levelsBand, wallsDefault, LEVELS } from '#core/stepped-cut.js';
import { regionsFromRings, offsetRegions, regionsArea } from '#core/plot/clip.js';
import { CUT_PLAN, cutPlanEntries, setContour, contourKeyOf, renamePlanKeys } from '../apps/shaper/src/cut-plan.js';
import { importFusionSelection } from '../apps/shaper/src/fusion-import.js';
import { captureShaperDoc, applyShaperDoc } from '../apps/shaper/src/shaper-doc.js';
import { shaperSvgOf } from '../apps/shaper/src/export-payload.js';
import { opKeyOf } from '../apps/shaper/src/operations.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b} (tol ${tol})`); checks++; };
SettingsManager.set('DOC_UNIT', 'mm');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 24);

// ── 1. the declaration ──
eq(ROUGH_BOUNDARY.kinds.map((k) => k.id), ['silhouette', 'box', 'stock', 'shape'], 'the boundaries');
eq(ROUGH_BOUNDARY.tools.map((t) => [t.id, boundaryToolBits(t.id)]), [['inside', 0.25], ['on', 0.75], ['outside', 1.25]], 'the tool rule: the work area grows by (centre radii)/2 + 1/2 + 1/4 bits');
eq(BOUNDARY_CALC_OFFSET_BITS, 0.75, 'the calculated offset: 2 - 1.25 = 0.75 bit (+ the allowance)');
eq(BOUNDARY_CALC_OFFSET_BITS + boundaryToolBits('outside'), LEVELS.workMarginBits, 'calculated + Outside = TASK 792\'s 2-bit margin, exactly');
for (const [dia, a] of [[3.175, 0], [6.35, 0.5], [12.7, 0.3], [0.508, 0.05], [5.123456789, 0.987654321]]) {
  const rec = { levelsOp: 'roughing', toolDia: dia, finishAllowance: a };
  ok(Object.is(roughingWorkGrow(rec), a + LEVELS.workMarginBits * dia), `the defaults grow by allowance + 2 bits to the last bit (bit ${dia}, allowance ${a})`);
}
eq(boundaryCalcOffset({ levelsOp: 'roughing', toolDia: 6.35, finishAllowance: 0.5 }), 0.5 + 0.75 * 6.35, 'the calculated offset shown on the card');

// ── 2. measured: boundary x tool x offset ──
const ring = (pts) => [...pts.map((p) => [p.x, p.y]), [pts[0].x, pts[0].y]];
const boss = [30, 15, 50, 15, 50, 35, 30, 35]; // the part's material: a 20 x 20 boss at every level (one run, at the depth)
const levels = [{ z: 2, loops: [boss] }, { z: 4, loops: [boss] }];
const rectPoly = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const circlePoly = (cx, cy, R, n = 96) => Array.from({ length: n }, (_, i) => ({ x: cx + R * Math.cos((2 * Math.PI * i) / n), y: cy + R * Math.sin((2 * Math.PI * i) / n) }));
const grownRect = (w, h, g) => (g >= 0 ? (w + 2 * g) * (h + 2 * g) - (4 - Math.PI) * g * g : (w + 2 * g) * (h + 2 * g)); // a rectangle grown (round corners) / shrunk (sharp)
const dia = 6.35, r = dia / 2, m = LEVELS.pocketKeepBackBits * dia;
const CASES = [];
for (const kind of ['silhouette', 'box']) for (const tool of ['inside', 'on', 'outside']) for (const offset of [null, 0, 5, -5]) CASES.push({ kind, tool, offset });
for (const c of CASES) {
  const partOuter = c.kind === 'silhouette' ? rectPoly(0, 0, 80, 50) : circlePoly(40, 25, 30); // Bounding box: of a round part (a 60 x 60 square)
  const [w, h] = c.kind === 'silhouette' ? [80, 50] : [60, 60];
  const rec = { levelsOp: 'roughing', levels, cutDepth: 4, stepDepth: 1, toolDia: dia, roughLayout: 'nested', boundary: c.kind, boundaryTool: c.tool, ...(c.offset != null ? { boundaryOffset: c.offset } : {}) };
  const off = c.offset != null ? c.offset : 0.75 * dia;
  const g = off + boundaryToolBits(c.tool) * dia;
  const R = levelsRoughingFor(rec, partOuter, null, [], {});
  const name = `${c.kind} / ${c.tool} / offset ${c.offset == null ? 'calculated' : c.offset}`;
  eq(R.error, null, `${name}: roughs`);
  const cut = R.paths.reduce((s, p) => s + regionsArea(p.regions), 0);
  near(cut, grownRect(w, h, g) - 400, 0.5, `${name}: the cut area = the boundary grown by ${g.toFixed(4)} mm minus the 20 x 20 boss`);
  // the bit centre's reach: W shrunk by r + m = the boundary moved by offset + (inside -r | on 0 | outside +r)
  const t = { inside: -r, on: 0, outside: r }[c.tool];
  const box = c.kind === 'silhouette' ? rectPoly(0, 0, 80, 50) : rectPoly(10, -5, 70, 55);
  const W = offsetRegions(regionsFromRings([ring(box)], 'nonzero'), g);
  near(regionsArea(offsetRegions(W, -(r + m))), grownRect(w, h, off + t), 0.6, `${name}: the bit centre reaches the boundary moved by ${(off + t).toFixed(4)} mm`);
}

// ── 3. refused: no room for the bit ──
{
  const R = levelsRoughingFor({ levelsOp: 'roughing', levels, cutDepth: 4, toolDia: dia, boundary: 'box', boundaryTool: 'inside', boundaryOffset: 0 }, rectPoly(38, 23, 42, 27), null, [], {});
  eq([R.error, R.paths.length], ['no-room', 0], 'Inside a 4 mm square with a 6.35 mm bit: no room, nothing roughed');
  const R2 = levelsRoughingFor({ levelsOp: 'roughing', levels, cutDepth: 4, toolDia: dia, boundary: 'shape' }, rectPoly(0, 0, 80, 50), null, [], {});
  eq(R2.error, 'no-shape', 'Shape with nothing picked: refused with its reason');
  const R3 = levelsRoughingFor({ levelsOp: 'roughing', levels, cutDepth: 4, toolDia: dia, boundary: 'stock' }, rectPoly(0, 0, 80, 50), null, [], {});
  eq(R3.error, 'no-stock', 'Stock with no Stock: refused with its reason');
}

// ── 4. byte-identical defaults (golden: commit 81226b7, .evidence/810/baseline.mjs) ──
const GOLDEN = {
  'dome/terraces': 'fa933635e6708404ddf561ac 75514', 'dome/terraces14': '783b3be86c1ef1089cf94750 88010', 'dome/nested': 'bc0e21d9ee8bc0524a48a02f 68724',
  'dome/minw': '78cfd387a1c232c1752fda1b 5848', 'dome/contour': 'a5565c721865ca20b160705f 485177', 'dome/contourNested': '35f77408022af209a1245758 255167',
  'drafted/terraces': '9b7bbc2262a1eac6386c96ed 3562', 'drafted/terraces14': 'b7f1d573b3ea9f5bf2a35f62 3544', 'drafted/nested': '83f0414fe2bd4dc4eded8619 2510',
  'drafted/minw': '597add13391147e5c71b825a 1087', 'drafted/contour': '103c573a3acac6b8d55b89a5 7212', 'drafted/contourNested': '65dca83ce04de7750720c4aa 5979',
  'block/terraces': '80bb39cbe108a16fbc6b57b4 1693', 'block/terraces14': '8778016f5c306191e108c504 1978', 'block/nested': 'bf38cae6a885d6929bdfb653 1384',
  'block/minw': '8778016f5c306191e108c504 1978', 'block/contour': '0887354c513e832597faa83c 3737', 'block/contourNested': '2dbdce06c771c6a1ba82271f 3206',
};
const CONFIGS = {
  terraces: () => {},
  terraces14: (rec) => { rec.toolDia = 6.35; },
  nested: (rec) => { rec.toolDia = 6.35; rec.roughLayout = 'nested'; },
  minw: (rec) => { rec.toolDia = 6.35; rec.minTerraceWidth = 2; },
  contour: (rec, key) => { rec.toolDia = 6.35; setContour(key, true); rec.finishAllowance = 0.5; CUT_PLAN.get(contourKeyOf(key)).smoothing = 0.02; }, // 0.02 = the Contour's default at 81226b7 (owner turn 2688 made it 0.05)
  contourNested: (rec, key) => { rec.toolDia = 6.35; rec.roughLayout = 'nested'; setContour(key, true); rec.finishAllowance = 0.5; CUT_PLAN.get(contourKeyOf(key)).stepDepth = 0.5; CUT_PLAN.get(contourKeyOf(key)).smoothing = 0.02; },
};
{
  CUT_PLAN.clear();
  const app = await open({ host: 'shaper' });
  try {
    for (const [name, tris] of [['dome', M.dome(30)], ['drafted', M.draftedPocket(10)], ['block', M.blockPocketHole()]]) {
      const bytes = M.binaryStl(tris);
      for (const [cfg, apply] of Object.entries(CONFIGS)) {
        CUT_PLAN.clear();
        const res = app.stl.openFile(bytes, `${name}.stl`);
        ok(res.ok, `${name}: opened`);
        const [key, rec] = [...CUT_PLAN.entries()].find(([, x]) => x.levels);
        apply(rec, key);
        const svg = shaperSvgOf(app.state, cutPlanEntries());
        eq(`${sha(svg)} ${svg.length}`, GOLDEN[`${name}/${cfg}`], `${name} / ${cfg}: the default export is byte for byte the one before task 810`);
      }
    }
  } finally { await app.close(); }
}

// ── 5. the app ──
const line = (x1, y1, x2, y2) => ({ type: 'line', x1, y1, x2, y2 });
const sq = (x0, y0, x1, y1) => ({ closed: true, segments: [line(x0, y0, x1, y0), line(x1, y0, x1, y1), line(x1, y1, x0, y1), line(x0, y1, x0, y0)] });
const payload = () => ({
  action: 'selection_data', version: 1, units: 'mm', coordSystem: { yAxis: 'up', frame: 'plane-2d' }, source: { name: 'Body1', documentName: 'boundary' }, stock: { thicknessMm: 4 },
  regions: [
    { id: 'reg_0', label: 'Part', cutType: 'outside', depthMm: 4, through: false, outer: sq(0, 0, 80, 50), holes: [], levels: [{ zFromTopMm: 2, loops: [sq(30, 15, 50, 35)] }, { zFromTopMm: 4, loops: [sq(30, 15, 50, 35)] }] },
    { id: 'reg_1', label: 'Board', cutType: 'guide', depthMm: 4, through: false, outer: sq(-30, -30, 110, 80), holes: [] },
    { id: 'reg_2', label: 'Window', cutType: 'guide', depthMm: 4, through: false, outer: sq(20, 5, 60, 45), holes: [] },
  ],
  chains: [], warnings: [],
});
{
  CUT_PLAN.clear();
  const app = await open({ host: 'shaper' });
  try {
    app.modes.showMode('prepare');
    const st = app.state, doc = app.document, q = (s) => doc.querySelector(s);
    const pressEl = (s) => { const e = q(s); assert(e, s + ' not found'); app.press(e); };
    const pc = doc.getElementById('prepare-canvas');
    const clickAt = (x, y) => { const p = worldToScreen(pc, { x, y }); app.click(Math.round(p.x), Math.round(p.y), { target: pc }); };
    const rows = () => [...doc.querySelectorAll('.cut-rows .cut-row')].filter((x) => x.style.display !== 'none' && !('off' in x.dataset) && !('offTab' in x.dataset)).map((x) => x.dataset.row || x.dataset.param);
    const tabs = () => [...doc.querySelectorAll('.cut-tab')].filter((b) => !b.hidden).map((b) => b.dataset.tab + (b.classList.contains('is-active') ? '*' : '') + (b.querySelector('.cut-tab-dot').hidden ? '' : '.'));
    const note = () => [...doc.querySelectorAll('.cut-note div')].map((d) => d.textContent);
    const setField = (sel, text) => { const inp = q(sel); inp.value = text; inp.dispatchEvent(new app.window.Event('change')); };
    const exportOf = () => shaperSvgOf(st, cutPlanEntries());
    const pockets = () => [...exportOf().matchAll(/<path [^>]*shaper:cutType="pocket"[^>]*\/>/g)].map((x) => x[0]);

    const res = importFusionSelection(payload(), { controller: app.controller, prepare: app.prepare });
    ok(res.ok !== false, 'the payload imported');
    const [pk, prec] = [...CUT_PLAN.entries()].find(([, x]) => x.levels);
    prec.cutType = 'roughing'; prec.stepDepth = 1; prec.toolDia = 6.35; prec.roughLayout = 'nested'; prec.smoothing = 0; // Smoothing off: the pockets are the exact polygons (their coordinates read below)
    const keyBefore = opKeyOf(prec);
    clickAt(5, -5); // the part, outside the window and the boss
    eq(q('.cut-type-cur').textContent, 'Roughing', 'the part\'s Roughing card');
    eq(tabs(), ['tool*.', 'geometry', 'heights', 'passes.'], 'its tabs: Tool (shown; a dot: the 1/4 in bit is not the default 1/8), Geometry, Heights, Passes (a dot: Nested, Smoothing 0)');
    eq(rows(), ['toolDia', 'cutterShape'], 'the Tool tab: the bit and its shape');
    pressEl('.cut-tab[data-tab="geometry"]');
    eq(rows(), ['boundary', 'boundaryTool', 'boundaryOffset', 'cutOffset'], 'the Geometry tab: Boundary, Tool, Boundary offset, Offset (Nested: no Min terrace width)');
    eq([...doc.querySelectorAll('.cut-boundary-kinds .cut-preset')].map((b) => b.textContent + (b.classList.contains('is-active') ? '*' : '') + (b.getAttribute('aria-disabled') ? ':off' : '')),
      ['Silhouette*', 'Bounding box', 'Stock:off', 'Shape'], 'Boundary: Silhouette (the default); the Stock greyed (the design has none)');
    eq(q('.cut-boundary-kinds .cut-preset[data-value="stock"]').dataset.hint, 'boundaryNoStock', 'the greyed Stock: its tooltip says why');
    eq([...doc.querySelectorAll('.cut-boundary-tools .cut-preset')].map((b) => b.textContent + (b.classList.contains('is-active') ? '*' : '')), ['Inside', 'On', 'Outside*'], 'Tool: Outside (the default)');
    eq([q('.cut-boundary-offset').value, q('.cut-row[data-row="boundaryOffset"] .cut-calc-tag').hidden], ['4.763', false], 'Boundary offset: calculated, 0.75 bit (allowance 0)');
    const area0 = pockets().join('\n');
    // Bounding box of a rectangular part = its silhouette: the same export; Inside changes it
    const n0 = st.history.length;
    pressEl('.cut-boundary-tools .cut-preset[data-value="inside"]');
    eq([CUT_PLAN.get(pk).boundaryTool, st.history.length], ['inside', n0 + 1], 'Inside: stored, ONE undo step');
    ok(pockets().join('\n') !== area0, 'Inside: a different export (the band round the part is gone)');
    eq(tabs(), ['tool.', 'geometry*.', 'heights', 'passes.'], 'the Geometry tab shows its dot');
    ok(opKeyOf(CUT_PLAN.get(pk)) !== keyBefore, 'a boundary off its default is part of the operation key');
    st.undo();
    eq([CUT_PLAN.get(pk).boundaryTool, opKeyOf(CUT_PLAN.get(pk)), pockets().join('\n')], [undefined, keyBefore, area0], 'undo: the default again, the key of before, the same export');
    // a typed offset, then Reset to calculated
    setField('.cut-boundary-offset', '-2');
    eq([CUT_PLAN.get(pk).boundaryOffset, q('.cut-row[data-row="boundaryOffset"] .cut-calc-tag').hidden, q('.cut-row[data-row="boundaryOffset"] .cut-calc-reset').hidden], [-2, true, false], 'Offset -2 typed: stored, Reset to calculated offered');
    pressEl('.cut-row[data-row="boundaryOffset"] .cut-calc-reset');
    eq(CUT_PLAN.get(pk).boundaryOffset, null, 'Reset to calculated: null (calculated)');
    eq(pockets().join('\n'), area0, 'calculated again: the default export');
    delete CUT_PLAN.get(pk).boundaryOffset;

    // the Stock: offered once the board is the Stock; its outline is the boundary
    const keys = [...CUT_PLAN.keys()].filter((k) => k !== pk && CUT_PLAN.get(k).cutType === 'guide');
    eq(keys.length, 2, 'the board and the window regions');
    const [boardKey, windowKey] = keys; // payload order
    CUT_PLAN.get(boardKey).cutType = 'stock';
    clickAt(5, -5);
    pressEl('.cut-tab[data-tab="geometry"]');
    eq(q('.cut-boundary-kinds .cut-preset[data-value="stock"]').getAttribute('aria-disabled'), null, 'a Stock exists: the Stock choice is offered');
    pressEl('.cut-boundary-kinds .cut-preset[data-value="stock"]');
    eq(CUT_PLAN.get(pk).boundary, 'stock', 'Boundary: Stock');
    const stockPockets = pockets();
    ok(stockPockets.length > 0 && stockPockets.join('\n') !== area0, 'the Stock\'s outline is the boundary: a different export');
    ok(stockPockets.some((p) => /[ML] -42\.7 /.test(p)), 'the pocket reaches the board grown by 0.75 + 1.25 bits (x -30 - 12.7 = -42.7)');
    // Shape: Pick, then a click on the window (the selection stays the part)
    pressEl('.cut-boundary-kinds .cut-preset[data-value="shape"]');
    eq(rows(), ['boundary', 'boundaryShape', 'boundaryTool', 'boundaryOffset', 'cutOffset'], 'Shape: its Boundary shape row (Pick)');
    eq(q('.cut-boundary-state').textContent, 'none picked', 'nothing picked yet');
    ok(note().some((t) => t === 'Roughing: nothing to cut: no boundary shape yet: press Pick, then click a closed shape'), 'the note says why nothing is cut: ' + JSON.stringify(note()));
    eq(pockets().length, 0, 'nothing exported for it');
    const n1 = st.history.length;
    pressEl('.cut-boundary-pick');
    eq([q('.cut-boundary-state').textContent, q('.cut-boundary-pick').textContent, pc.classList.contains('is-picking')], ['click a closed shape', 'Cancel pick', true], 'picking: the state, Cancel pick, the crosshair');
    clickAt(22, -25); // inside the window, outside the boss
    eq(CUT_PLAN.get(pk).boundaryShape, windowKey, 'the window is the boundary shape');
    eq(st.history.length, n1 + 1, 'the pick: ONE undo step');
    eq([q('.cut-type-cur').textContent, pc.classList.contains('is-picking'), q('.cut-boundary-state').textContent], ['Roughing', false, 'picked'], 'the selection is still the part; picking ended');
    const winPockets = pockets();
    ok(winPockets.length > 0, 'the window roughs');
    // the window 40 x 40 grown by 0.75 + 1.25 bits: its pocket's x reaches 20 - 12.7 = 7.3
    ok(winPockets.some((p) => /[ML] 7\.3 /.test(p)), 'the pocket reaches the window grown by 2 bits (x 7.3)');
    // the shape FOLLOWS an edit: move the window's left edge 5 mm left
    const xs = [...st.joints.values()].filter((j) => Math.abs(j.x - 20) < 1e-6);
    ok(xs.length >= 2, 'the window\'s left joints');
    for (const j of xs) j.x = 15;
    ok(pockets().some((p) => /[ML] 2\.3 /.test(p)), 'moved: the pocket follows (x 2.3)');
    for (const j of xs) j.x = 20;
    // a cancelled pick changes nothing
    const before = JSON.stringify([...CUT_PLAN]);
    pressEl('.cut-boundary-pick');
    clickAt(200, -200); // empty space
    eq([JSON.stringify([...CUT_PLAN]), pc.classList.contains('is-picking')], [before, false], 'a click on nothing cancels the pick: nothing changes');
    pressEl('.cut-boundary-pick'); pressEl('.cut-boundary-pick');
    eq(pc.classList.contains('is-picking'), false, 'Pick pressed again: cancelled');
    // a key rename moves the reference with it
    const plan = new Map([['loop:a', { cutType: 'guide' }], ['loop:b', { cutType: 'roughing', boundary: 'shape', boundaryShape: 'loop:a' }]]);
    renamePlanKeys(new Map([['loop:a', 'profile:p1']]), new Set(), plan);
    eq([[...plan.keys()], plan.get('loop:b').boundaryShape], [['profile:p1', 'loop:b'], 'profile:p1'], 'renamePlanKeys: the record and the boundary shape that names it');
    // Inside a shape smaller than the bit: the refusal note
    CUT_PLAN.get(pk).boundaryTool = 'inside'; CUT_PLAN.get(pk).boundaryOffset = -18;
    clickAt(5, -5);
    ok(note().includes('Roughing: nothing to cut: the boundary leaves no room for the bit'), 'Inside the window shrunk by 18 mm: no room for the bit: ' + JSON.stringify(note()));
    delete CUT_PLAN.get(pk).boundaryTool; delete CUT_PLAN.get(pk).boundaryOffset;
    // save + reload
    const saved = captureShaperDoc();
    const svgBefore = exportOf();
    applyShaperDoc(JSON.parse(JSON.stringify(saved)), st);
    eq([CUT_PLAN.get(pk).boundary, CUT_PLAN.get(pk).boundaryShape], ['shape', windowKey], 'reloaded: the boundary and its shape');
    eq(exportOf(), svgBefore, 'reloaded: the same export');
    // the Contour is not affected by the boundary
    setContour(pk, true);
    const contourOnly = () => exportOf().split('\n').filter((l) => /cutType="(outside|inside)"/.test(l)).join('\n');
    const c1 = contourOnly();
    CUT_PLAN.get(pk).boundary = 'box';
    eq(contourOnly(), c1, 'the Contour follows the material walls: the same whatever the boundary');
  } finally { await app.close(); }
}

// ── 6. HEIGHTS (Roughing and Contour): Top, Bottom, Floor allowance cut a band of depths ──
eq(levelsBand({}, 7), { top: 0, depth: 7, empty: false }, 'no height set: the depth as it was');
eq(levelsBand({}, 'unset'), { top: 0, depth: 'unset', empty: false }, 'no height set: even an unset depth is passed as it was');
eq(levelsBand({ topDepth: 2, bottomDepth: 5, floorAllowance: 0.5 }, 7), { top: 2, depth: 4.5, empty: false }, 'Top 2, Bottom 5, floor 0.5: levels made down to 4.5, those at or above 2 dropped');
eq(levelsBand({ bottomDepth: 9 }, 7).depth, 7, 'a Bottom below the part: the depth of the part');
eq(levelsBand({ floorAllowance: 1 }, undefined, ).depth, undefined, 'no depth known (a drawn region with its depth unset): nothing to limit');
eq(levelsBand({ floorAllowance: 1, levels: [{ z: 2, loops: [] }, { z: 6, loops: [] }] }, undefined).depth, 5, 'no depth set on a part with levels: its model depth (the deepest level) less the floor allowance');
eq(levelsBand({ topDepth: 5, bottomDepth: 5 }, 7).empty, true, 'Top = Bottom: an empty band');
{
  CUT_PLAN.clear();
  const app = await open({ host: 'shaper' });
  try {
    app.modes.showMode('prepare');
    const st = app.state, doc = app.document, q = (s2) => doc.querySelector(s2);
    const pressEl = (s2) => { const e = q(s2); assert(e, s2 + ' not found'); app.press(e); };
    const pc = doc.getElementById('prepare-canvas');
    const clickAt = (x, y) => { const p = worldToScreen(pc, { x, y }); app.click(Math.round(p.x), Math.round(p.y), { target: pc }); };
    const rows = () => [...doc.querySelectorAll('.cut-rows .cut-row')].filter((x) => x.style.display !== 'none' && !('off' in x.dataset) && !('offTab' in x.dataset)).map((x) => x.dataset.row || x.dataset.param);
    const note = () => [...doc.querySelectorAll('.cut-note div')].map((d) => d.textContent);
    const setField = (sel, text) => { const inp = q(sel); inp.value = text; inp.dispatchEvent(new app.window.Event('change')); };
    const els = (type) => [...shaperSvgOf(st, cutPlanEntries()).matchAll(/<path [^>]*\/>/g)].map((x) => x[0]).filter((x) => new RegExp(`shaper:cutType="(${type})"`).test(x));
    const depthOf = (e) => Number(/shaper:cutDepth="([\d.]+) mm"/.exec(e)[1]);
    const res = app.stl.openFile(M.binaryStl(M.dome(30)), 'dome.stl');
    ok(res.ok, 'the dome');
    const [key, rec] = [...CUT_PLAN.entries()].find(([, x]) => x.levels);
    rec.toolDia = 6.35;
    const D = Number(rec.cutDepth);
    const all = els('pocket');
    clickAt(30, -30);
    pressEl('.cut-tab[data-tab="heights"]');
    eq(rows(), ['cutDepth', 'topDepth', 'bottomDepth', 'floorAllowance'], 'the Heights tab: Depth, Top, Bottom, Floor allowance');
    eq([q('.cut-top-depth').value, q('.cut-top-depth').placeholder, q('.cut-bottom-depth').value, q('.cut-bottom-depth').placeholder, q('.cut-floor-allowance').value], ['', '0', '', String(+D.toFixed(3)), '0'], 'the defaults: the surface, the depth of the part (greyed), no floor allowance');
    const keyBefore = opKeyOf(rec);
    const n0 = st.history.length;
    setField('.cut-top-depth', '3');
    eq([CUT_PLAN.get(key).topDepth, st.history.length], [3, n0 + 1], 'Top 3: stored, ONE undo step');
    const top3 = els('pocket');
    eq(top3, all.filter((e) => depthOf(e) > 3), 'Top 3: exactly the paths deeper than 3 mm (the others not cut)');
    ok(top3.length < all.length && top3.length > 0, `fewer paths (${top3.length} of ${all.length})`);
    ok(opKeyOf(CUT_PLAN.get(key)) !== keyBefore, 'a Top is part of the operation key');
    ok([...doc.querySelectorAll('.cut-tab')].find((b) => b.dataset.tab === 'heights').querySelector('.cut-tab-dot').hidden === false, 'the Heights tab shows its dot');
    pressEl('.cut-row[data-row="topDepth"] .cut-calc-reset');
    eq([CUT_PLAN.get(key).topDepth, els('pocket'), opKeyOf(CUT_PLAN.get(key))], [null, all, keyBefore], 'Reset to surface: every path again, the key of before');
    setField('.cut-bottom-depth', '5');
    const b5 = els('pocket').map(depthOf);
    ok(Math.max(...b5) === 5 && b5.every((d) => d <= 5), 'Bottom 5: no path deeper, the last level at 5: ' + [...new Set(b5)].join(','));
    setField('.cut-floor-allowance', '0.5');
    const f = els('pocket').map(depthOf);
    ok(Math.max(...f) === 4.5, 'Bottom 5 + floor allowance 0.5: the deepest level at 4.5');
    setField('.cut-top-depth', '6');
    eq(els('pocket').length, 0, 'Top 6 under a 4.5 bottom: nothing cut');
    ok(note().includes('Roughing: nothing to cut: no level between the Top and the Bottom (less the floor allowance)'), 'the note says why: ' + JSON.stringify(note()));
    setField('.cut-top-depth', ''); setField('.cut-bottom-depth', ''); setField('.cut-floor-allowance', '0');
    eq(els('pocket'), all, 'all cleared: the default export');
    // the Contour: its own Heights (Bottom = its part's depth)
    setContour(key, true);
    const call = els('outside|inside'), rough = els('pocket'); // (the Contour sets the Roughing's wall allowance: its paths are those of that allowance)
    const crec = CUT_PLAN.get(contourKeyOf(key));
    crec.topDepth = 2; crec.floorAllowance = 1;
    const c2 = els('outside|inside').map(depthOf);
    ok(c2.length > 0 && c2.every((d) => d > 2 && d <= D - 1 + 1e-9) && Math.abs(Math.max(...c2) - (D - 1)) < 1e-6, `the Contour's band: deeper than 2, the last level at the part's depth less 1 (${D - 1})`);
    ok(c2.length < call.length, 'fewer contour passes');
    eq(els('pocket'), rough, 'the Roughing is not affected by the heights of the Contour');
    const saved = captureShaperDoc();
    eq([new Map(saved.cutPlan).get(contourKeyOf(key)).topDepth, new Map(saved.cutPlan).get(contourKeyOf(key)).floorAllowance], [2, 1], 'saved with the design');
  } finally { await app.close(); }
}

// ── 7. a Contour's WHICH WALLS: All | Sloped only (Sloped only = TASK 792's skip of the shape's own wall, the default next to a plain Outside / Inside cut) ──
eq([wallsDefault({ slope: {}, baseType: 'exterior' }), wallsDefault({ slope: {}, baseType: 'interior' }), wallsDefault({ slope: {}, baseType: 'pocket' }), wallsDefault({ slope: {}, baseType: 'roughing' }), wallsDefault({ baseType: 'exterior', levels: [{ z: 1, loops: [] }] }), wallsDefault({ slope: {}, baseType: 'exterior', levels: [{ z: 1, loops: [] }] })],
  ['sloped', 'sloped', 'all', 'all', 'all', 'all'], 'the default = the choice of before: Sloped only next to a plain Outside / Inside cut on slope rings, All otherwise');
{
  CUT_PLAN.clear();
  const app = await open({ host: 'shaper' });
  try {
    app.modes.showMode('prepare');
    const st = app.state, doc = app.document, q = (s2) => doc.querySelector(s2);
    const pressEl = (s2) => { const e = q(s2); assert(e, s2 + ' not found'); app.press(e); };
    const rows = () => [...doc.querySelectorAll('.cut-rows .cut-row')].filter((x) => x.style.display !== 'none' && !('off' in x.dataset) && !('offTab' in x.dataset)).map((x) => x.dataset.row || x.dataset.param);
    const contourEls = () => [...shaperSvgOf(st, cutPlanEntries()).matchAll(/<path [^>]*\/>|<circle [^>]*\/>/g)].map((x) => x[0]).filter((x) => /shaper:toolDia="3\.175 mm"/.test(x) && /shaper:cutType="(outside|inside)"/.test(x));
    const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/sa7-slope/01-chamfer-outline.json', import.meta.url), 'utf8'));
    importFusionSelection(fx, { controller: app.controller, prepare: app.prepare });
    const [key, rec] = [...CUT_PLAN.entries()].find(([, x]) => x.slope);
    eq(rec.cutType, 'exterior', 'the chamfered outline: a plain Outside cut with its slope rings');
    rec.toolDia = 6.35;
    setContour(key, true);
    const ck = contourKeyOf(key), crec = CUT_PLAN.get(ck);
    const byDefault = contourEls(), keyDefault = opKeyOf(cutPlanEntries().find((e) => e.key === ck).rec);
    ok(byDefault.length > 0, `the Contour of the chamfer: ${byDefault.length} passes (Sloped only by default)`);
    app.prepare.view().setSelection([{ kind: 'contour', id: key }]);
    eq(q('.cut-type-cur').textContent, 'Contour', 'the Contour card');
    pressEl('.cut-tab[data-tab="geometry"]');
    eq(rows(), ['walls'], 'its Geometry tab: Walls');
    eq([...doc.querySelectorAll('.cut-walls .cut-preset')].map((b) => b.textContent + (b.classList.contains('is-active') ? '*' : '')), ['All', 'Sloped only*'], 'Walls: Sloped only (the choice of before, next to an Outside cut)');
    const n0 = st.history.length;
    pressEl('.cut-walls .cut-preset[data-value="all"]');
    eq([CUT_PLAN.get(ck).walls, st.history.length], ['all', n0 + 1], 'All: stored, ONE undo step');
    const all = contourEls();
    ok(all.length > byDefault.length, `All: the own wall too (${all.length} passes, ${all.length - byDefault.length} more)`);
    for (const e of byDefault) ok(all.includes(e), 'All keeps every Sloped only pass');
    ok(opKeyOf(cutPlanEntries().find((e) => e.key === ck).rec) !== keyDefault, 'All (off the default here) is part of the operation key');
    ok(!doc.querySelector('.cut-tab[data-tab="geometry"] .cut-tab-dot').hidden, 'the Geometry tab shows its dot');
    pressEl('.cut-walls .cut-preset[data-value="sloped"]');
    eq([CUT_PLAN.get(ck).walls, contourEls(), opKeyOf(cutPlanEntries().find((e) => e.key === ck).rec)], ['sloped', byDefault, keyDefault], 'Sloped only picked: exactly the default passes, the default key');
    ok(doc.querySelector('.cut-tab[data-tab="geometry"] .cut-tab-dot').hidden, 'no dot: the default');
    // the same Contour on a Pocket part: All by default (TASK 792 never skipped there); Sloped only skips the pocket's own outline if a level has it
    rec.cutType = 'pocket';
    delete CUT_PLAN.get(ck).walls;
    const pocketDefault = contourEls();
    app.prepare.view().setSelection([{ kind: 'contour', id: key }]);
    pressEl('.cut-tab[data-tab="geometry"]');
    eq([...doc.querySelectorAll('.cut-walls .cut-preset')].map((b) => b.textContent + (b.classList.contains('is-active') ? '*' : '')), ['All*', 'Sloped only'], 'on a Pocket part: All (as before)');
    ok(pocketDefault.length > 0, 'the Contour of the Pocket part cuts');
  } finally { await app.close(); }
}

console.log(`boundary-810-node: ok (${checks} checks)`);
