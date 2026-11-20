// tests/online-tabs-775-node.test.js — TASK 775 (verified on the owner's Origin 2026-11-17): TABS on On line cuts, honest LOOP wording. (Renamed from
// tests/leadin-775-node.test.js in TASK 836: its lead-in sections 1, 2 and the lead-in part of 6 went with the lead-in, owner ruling 2026-11-20; the rest kept.)
//  3. TABS on an On line outline (#core/hold-part, 742's rows): separate OPEN strokes, stroke count = tab count, each gap exactly the tab width (0.01 mm), at
//     the full depth; the Review leaves the tabs standing; onion skin = the whole line at depth - skin (an open line too); refused (as without) on an open
//     line, a tab not wider than the bit, no room; a profile's hole loops stay closed.
//  4. LOOP WORDING: no "ends where it starts" left in apps/shaper or packages/core; Prepare draws no dot on a closed loop.
//  5. BYTE-IDENTICAL without the new options: tests/fixtures/leadin-775-before.json (written by origin/main 5e79336's own code, tests/helpers/leadin-775-digest.js;
//     TASK 786: the download / preview facets re-written by the 786 exporter, every change explained in WORK-LOG TURN 786: the page grown to hold every written
//     element, the start mark stroke-only, a mixed-kind hole wound opposite; operations and 3D footprints unchanged).
//  6. The app (node kit): the cut card rows (On line's Hold part with no Tab thickness, no Lead-in row), ONE undo step each, the notes, the operations row,
//     an open line, a programmed pocket's start mark, save + reload.
import assert from 'node:assert';
import { hintFor } from '../apps/shaper/src/hint.js'; // TASK 805: the tooltip's text (hints are no longer laid out in the card)
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
import { planEntries, keyOf } from '../apps/shaper/src/cut-plan.js';
import { exportEncoding } from '../apps/shaper/src/shaper.js';
import { shaperSvgOf } from '../apps/shaper/src/export-payload.js';
import { describeOperations } from '../apps/shaper/src/operations.js';
import { V2_PLAN, storedRecords } from './helpers/plan-v2.js'; // TASK S1: the test's v2 document of the plan, loaded through applyShaperDoc
import { clickOpen, editStep } from './helpers/prepare-open.js'; // TASK S2: an operation is opened to edit it

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b} (tol ${tol})`); checks++; };
const BIT = 3.175, R = BIT / 2;

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
const exportOf = (st, entries, options = {}) => exportShaperSVG({ state: st, entries, encoding: exportEncoding(), docUnit: 'mm', options, loopPolys: polysOf(st) });
const one = (st, rec, options) => exportOf(st, [{ target: { kind: 'loop', id: outerOf(st).id }, rec }], options);
const cutsOf = (st, rec) => deriveCuts({ kind: 'loop', id: outerOf(st).id }, rec, st, findLoops(st), polysOf(st), new Set());
const ONLINE = (more = {}) => ({ cutType: 'online', cutDepth: 3, cutOffset: 0, toolDia: BIT, ...more });
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
  const preview = elementsOf(one(st, TABS(), { previewData: true }));
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
  // TASK 804: the base's spiralLoop / morphedLoop facets are no longer computed (the gradual Loop changed them on purpose; tests/pocket-nocross-804-node)
  let n = 0;
  // TASK 804: the Spiral's and the Morphed spiral's Loop are now the gradual double spiral (zero crossings; the old interleave replaced): changed on
  // purpose, checked in tests/pocket-nocross-804-node.test.js
  const changed804 = new Set(['spiralLoop', 'morphedLoop']);
  // TASK 804b: Raster + Loop is the zero-crossing loop now (the wall ring whole, no clean-up ring): its download, preview and 3D footprints changed on
  // purpose (checked in tests/pocket-nocross-804-node.test.js); its Operations list did not
  const changed804b = new Set(['rasterLoop']);
  let guideWordsDiffer = false; // (the digest of a set without that Guide's row stays the same)
  const GUIDE_DEPTH_WORDS_825 = new Set(['dxf/close-path-760-gap.dxf', 'dxf/fusion-sketch4.dxf', 'dxf/part-mm.dxf', 'pattern-params-694-old.document.json', 'pre-577-two-sketches.document.json']); // TASK 825 (V4): a Guide with a depth lists it in its row
  // TASK 822: report/midpoint-move.json's 3077.8 mm Outside outline: its tabs were REFUSED (a tab of the even spread landed where its gap strip did not fit) and
  // are PLACED now (kept off the narrow stretches, tests/hold-part-822-node.test.js): its download, preview, Operations row and 3D changed on purpose
  const changed822 = (name, set) => name === 'report/midpoint-move.json' && set === 'tabs';
  for (const [name, sets] of Object.entries(base)) for (const [set, facets] of Object.entries(sets)) {
    if (changed804.has(set)) continue;
    if (changed822(name, set)) { ok(now[name][set].download !== facets.download, `${name} ${set}: its refused tabs are placed now (TASK 822)`); n++; continue; }
    if (changed804b.has(set)) { eq(now[name][set].ops, facets.ops, `${name} ${set}: the operations identical to origin/main 5e79336`); n++; continue; }
    if (GUIDE_DEPTH_WORDS_825.has(name)) { const { ops: o1, ...r1 } = now[name][set], { ops: o2, ...r2 } = facets; eq(r1, r2, `${name} ${set}: download, preview copy and 3D footprints identical to origin/main 5e79336`); guideWordsDiffer ||= o1 !== o2; n += 4; continue; }
    eq(now[name][set], facets, `${name} ${set}: download, preview copy, operations and 3D footprints identical to origin/main 5e79336 (TASK 786: the downloads to the 786 exporter)`); n += Object.keys(facets).length;
  }
  assert.ok(guideWordsDiffer, "TASK 825 V4: the document with a Guide that has a depth lists it in its row");
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
  const preset = (row, v) => pressEl(`.cut-row[data-row="${row}"] .cut-preset[data-value="${v}"]`);
  const presets = (row) => [...q(`.cut-row[data-row="${row}"]`).querySelectorAll('.cut-preset')].map((b) => b.textContent + (b.classList.contains('is-active') ? '*' : ''));
  const step = (row, d) => pressEl(`.cut-row[data-row="${row}"] .cut-step[data-d="${d}"]`);
  const toggleLoop = () => editStep(app, () => { const i = q('.cut-loop'); i.checked = !i.checked; i.dispatchEvent(new app.window.Event('change')); }); // TASK S2: a change of the open operation = its own step (tests/helpers/prepare-open.js)
  const tg = () => doc.querySelector('#prepare-toolpath-group');
  const count = (sel) => tg().querySelectorAll(sel).length;
  return { q, pressEl, clickAt, pick, clearing, note, typed, shown, preset, presets, step, toggleLoop, count };
};
const keyAt = (st, x, y) => { const loops = findLoops(st), lp = polysOf(st); const l = loops.filter((l0) => inPoly({ x, y }, lp[l0.id])).sort((a, b) => Math.abs(area(lp[a.id])) - Math.abs(area(lp[b.id])))[0]; return keyOf('loop', l.id); };
const profile = await createProfile();
await createNamedDesign(profile, 'shaper', 'Tabs 775');
let saved = null;
{
  V2_PLAN.clear(); V2_PLAN.setOrder([]);
  const app = await open({ host: 'shaper', profile });
  try {
    const h = harness(app), st = app.state;
    h.pressEl('.sk-header-tab[data-tab="design"]');
    drawInto(app, polyState([RECT, [[120, 0], [220, 0], [220, 60], [120, 60]], [[0, 80], [100, 80], [100, 140], [0, 140]]], [], [[[130, 90], [200, 90], [200, 130]]]));
    st.saveState('draw');
    h.pressEl('.sk-header-tab[data-tab="prepare"]');
    // On line on the first rectangle: the Hold part row, no Lead-in row (TASK 836)
    h.clickAt(10, 10); h.pick('online'); h.typed('.cut-depth', '3');
    const kA = keyAt(st, 10, 10);
    ok(!h.q('.cut-row[data-row="leadIn"]') && !h.q('.cut-lead-radius'), 'On line outline: no Lead-in row in the card (TASK 836)');
    ok(h.shown('holdPart') && !h.shown('tabCount') && !h.shown('holdThickness'), 'On line: the Hold part row (Off)');
    eq(h.count('circle'), 0, 'a closed line: no dot (no start point on the Origin)');
    let els = elementsOf(shaperSvgOf(st, planEntries()));
    eq(els.map((e) => pathPoints(e.d).closed), [true], 'the download: ONE closed path');
    // Tabs on On line: no thickness row, the note in the owner's words
    let n0 = st.history.length;
    h.preset('holdPart', 'tabs');
    eq(st.history.length, n0 + 1, 'Tabs: ONE undo step');
    ok(h.shown('tabCount') && h.shown('tabWidth') && !h.shown('holdThickness'), 'On line Tabs: count and width, NO thickness (the gaps are not cut at all)');
    eq(hintFor(h.q('.cut-row[data-row="tabWidth"] [data-hint]')), 'How long each gap left uncut in the line is; the wood it keeps is this minus the bit diameter.', 'Tab width on On line: the gap\'s hint (the table\'s)');
    h.typed('.cut-tab-count', '3'); h.typed('.cut-tab-width', '10');
    eq(h.note(), ['Tabs: 3 gaps of 10 mm left uncut; cut them by hand afterwards', 'Each gap keeps 6.825 mm of wood with a 3.175 mm bit (the gap minus the bit)'], 'the tabs note');
    els = elementsOf(shaperSvgOf(st, planEntries()));
    eq(els.map((e) => [e.cutType, e.depth, pathPoints(e.d).closed]), Array(3).fill(['online', '3.000 mm', false]), 'the download: 3 open strokes at the full depth');
    eq([h.count('.sk-stroke'), h.count('.sk-tab-mark')], [3, 3], 'Prepare: the 3 strokes and the 3 tab marks');
    ok(describeOperations(st, planEntries()).some((op) => /3 tabs \(gaps 10 mm left uncut\)/.test(op.label)), 'the operations row: 3 tabs');
    n0 = st.history.length;
    h.typed('.cut-tab-width', '12');
    app.undo(); eq([V2_PLAN.get(kA).tabWidth, st.history.length], [10, n0], 'undo: back one edit');
    app.redo(); eq(V2_PLAN.get(kA).tabWidth, 12, 'redo');
    h.preset('holdPart', 'off');
    // an open line: Tabs refused with the reason
    h.clickAt(165, 90);
    const chainSel = [...V2_PLAN.keys()];
    h.pick('online');
    const kC = [...V2_PLAN.keys()].find((k) => k.startsWith('chain:'));
    ok(kC, 'the open line picked: ' + JSON.stringify(chainSel));
    ok(h.shown('holdPart'), 'an open line: the Hold part row');
    h.typed('.cut-depth', '3');
    h.preset('holdPart', 'tabs');
    eq(h.note(), ['On line: tabs refused: tabs need a closed outline: this is an open line; cut without them'], 'tabs on an open line: refused, the reason');
    h.preset('holdPart', 'off');
    // a programmed pocket with Loop on: a start mark target (TASK 778)
    h.clickAt(10, 90); h.pick('pocket'); h.typed('.cut-depth', '6'); h.typed('.cut-bit', '6');
    const kP = keyAt(st, 10, 90);
    h.clearing('linked');
    h.toggleLoop();
    eq(h.count('circle'), 0, 'Loop on, closed: no dot on the loop');
    eq(h.count('.sk-pocket-start'), 1, 'Prepare: 1 pocket start mark target');
    ok(/\+ wall: one closed loop, stepover/.test(h.note().filter((l) => !/^Leftover: |^Sharp inside corners|of it missed between passes/.test(l))[0]), 'the note (TASK 825: the warnings come first): one closed loop (nothing about where it starts): ' + h.note().filter((l) => !/^Leftover: |^Sharp inside corners|of it missed between passes/.test(l))[0]);
    const pocketEls = elementsOf(shaperSvgOf(st, [{ target: { kind: 'loop', id: kP.slice(5) }, rec: V2_PLAN.get(kP) }]));
    eq(pocketEls.map((e) => [e.cutType, /Z$/.test(e.d)]), [['online', true], ['guide', false]], 'the pocket download: ONE closed on-line path + 1 guide start mark');
    saved = { plan: JSON.stringify([...V2_PLAN.entries()]), svg: shaperSvgOf(st, planEntries()) };
    const d = await app.storedDoc();
    ok(storedRecords(d.hosts.shaper).some(([, r]) => r.cutType === 'online' && r.holdPart === 'off' && r.tabWidth === 12), 'the autosave stores the On line record');
    h.clickAt(300, 300);
  } finally { await app.close(); }
}
V2_PLAN.clear();
{
  const app = await open({ host: 'shaper', profile });
  try {
    app.modes.showMode('prepare');
    eq(JSON.stringify([...V2_PLAN.entries()]), saved.plan, 'after a reload the plan is equal');
    eq(shaperSvgOf(app.state, planEntries()), saved.svg, 'and the download is byte-identical');
  } finally { await app.close(); }
}
console.log(`online-tabs-775-node: ok (${checks} checks)`);
