// tests/hold-part-742-node.test.js — TASK 742: HOLD PART (Off | Tabs | Onion skin) on Shaper's plain Outside / Inside cuts (#core/hold-part.js, through THE
// cut derivation #core/stepped-cut deriveCuts: the export, the Prepare look and the 3D Review read the same cuts).
//  1. the declared rules: Auto count (one tab per 150 mm, at least 3), placement on a rectangle, an L-shape (a concave corner), a circle (one closed arc:
//     tabs allowed anywhere on it), an Outside plate with an inside hole (the hole's automatic cut is untouched) and an Inside cut on that hole.
//  2. the exported SVG: exactly 1 closed pass at depth - thickness + N closed gap strips (Inside cuts) at the full depth, N = the tab count; each strip's
//     part-side edge IS the outline over its span (lines on it, arcs with its centre and radius, within 0.01 mm), its other edge at the strip width
//     (bit diameter + 1 mm) from the outline; every exported path is closed; tabs off / a type that cannot hold = byte-identical to before; onion skin = one
//     pass at depth - skin, no strips; a refused hold (thickness >= depth, no depth, no room) = the plain cut; the preview copy's data-hold.
//  3. the app: the real cut card (Hold part choice, rows, defaults 10 mm / 2 mm and 3/8 in / 1/16 in, the stepper, the count's Auto, the note), ONE undo
//     step per edit, the last values remembered, the 3D Review's items at their own depths, save + reload keep the record and the export byte-identical.
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { worldToScreen } from '#ui/coords.js';
import SettingsManager from '#core/settings-manager.js';
import { exportShaperSVG } from '#core/shaper-export.js';
import { findLoops } from '#core/loop-finder.js';
import { loopPolygon } from '#core/loop-geometry.js';
import { deriveCuts } from '#core/stepped-cut.js';
import { deriveCutFootprint } from '#core/profile-model.js';
import { HOLD_PART, autoTabCount, loopWalk, tabLayout, walkAt } from '#core/hold-part.js';
import { planEntries, planReliefItems, keyOf, holdNoteItems, holdSummary, loopsWithPolygons } from '../apps/shaper/src/cut-plan.js';
import { exportEncoding } from '../apps/shaper/src/shaper.js';
import { V2_PLAN, storedRecords } from './helpers/plan-v2.js'; // TASK S1: the test's v2 document of the plan, loaded through applyShaperDoc

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b} (tol ${tol})`); checks++; };
const BIT = 3.175, W = BIT + HOLD_PART.stripExtraMm, R = BIT / 2;

// drawn parts (lines / circles: exact in Node)
function polyState(pts, more = {}) {
  const joints = new Map(pts.map((p, i) => ['j' + i, { x: p[0], y: p[1] }]));
  const shapes = pts.map((p, i) => ({ id: 's' + i, type: 'line', joints: ['j' + i, 'j' + ((i + 1) % pts.length)] }));
  for (const [id, c, r] of more.circles || []) { joints.set(id + 'o', { x: c[0], y: c[1] }); shapes.push({ id, type: 'circle', joints: [id + 'o'], radius: r }); }
  return { joints, shapes, constraints: [], groups: [], profiles: [] };
}
const RECT = [[0, 0], [200, 0], [200, 100], [0, 100]];
const LSHAPE = [[0, 0], [200, 0], [200, 60], [80, 60], [80, 150], [0, 150]];
const circleState = () => ({ joints: new Map([['o', { x: 50, y: 50 }]]), shapes: [{ id: 'c', type: 'circle', joints: ['o'], radius: 40 }], constraints: [], groups: [], profiles: [] });
const loopOf = (st, edge) => findLoops(st).find((l) => l.edges.includes(edge));
const polysOf = (st) => { const by = new Map(st.shapes.map((s) => [s.id, s])); const lp = {}; for (const l of findLoops(st)) lp[l.id] = loopPolygon(l, st, by); return lp; };
const exportOf = (st, entries, options = {}) => exportShaperSVG({ state: st, entries, encoding: exportEncoding(), docUnit: 'mm', options, loopPolys: polysOf(st) });
const TABS = { cutType: 'exterior', cutDepth: 18, cutOffset: 0, toolDia: BIT, holdPart: 'tabs', tabCount: 'auto', tabWidth: 10, holdThickness: 2 };
const cutsOf = (st, edge, rec) => { const loops = findLoops(st); return deriveCuts({ kind: 'loop', id: loopOf(st, edge).id }, rec, st, loops, polysOf(st), new Set()); };

// the export's elements (a <g> hoists the shared attributes; its children inherit them)
function elementsOf(svg) {
  const attrs = (s) => Object.fromEntries([...s.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  const out = []; let group = null;
  for (const line of svg.split('\n').map((l) => l.trim())) {
    if (line.startsWith('<g')) throw new Error('TASK 802: the export has a <g>, every element must carry its own cut attributes: ' + line);
    if (line.startsWith('</g')) { group = null; continue; }
    const m = /^<(path|circle|polygon)\s(.*)\/>$/.exec(line);
    if (!m) continue;
    const a = { ...(group || {}), ...attrs(m[2]) };
    out.push({ tag: m[1], cutType: a['shaper:cutType'], depth: a['shaper:cutDepth'], d: a.d || null, a, hold: a['data-hold'] || null });
  }
  return out;
}
// a path "d" -> its commands [{ c: 'M'|'L'|'A'|'Z', p: {x,y}, r?, large?, sweep? }]
function commandsOf(d) {
  const tok = d.match(/[MLAZ]|-?\d*\.?\d+(?:e-?\d+)?/g);
  const out = []; let i = 0;
  while (i < tok.length) {
    const c = tok[i++];
    if (c === 'Z') { out.push({ c }); continue; }
    if (c === 'A') { const [rx, , , large, sweep, x, y] = tok.slice(i, i + 7).map(Number); i += 7; out.push({ c, r: rx, large, sweep, p: { x, y } }); continue; }
    out.push({ c, p: { x: Number(tok[i]), y: Number(tok[i + 1]) } }); i += 2;
  }
  return out;
}
// the SVG arc's centre (endpoint parameterisation, rx = ry, no rotation)
function arcCentre(p0, p1, r, large, sweep) {
  const mx = (p0.x - p1.x) / 2, my = (p0.y - p1.y) / 2, d2 = mx * mx + my * my;
  const k = Math.sqrt(Math.max(0, (r * r - d2) / d2)) * (large === sweep ? -1 : 1);
  return { x: (p0.x + p1.x) / 2 + k * my, y: (p0.y + p1.y) / 2 - k * mx };
}
const distSeg = (p, a, b) => { const vx = b.x - a.x, vy = b.y - a.y, L = vx * vx + vy * vy; const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / L)) : 0; return Math.hypot(p.x - a.x - t * vx, p.y - a.y - t * vy); };
const distPoly = (p, poly) => Math.min(...poly.map((a, i) => distSeg(p, a, poly[(i + 1) % poly.length])));

// a strip "d" against its outline: the commands from M up to the first point off the outline are its PART-SIDE edge (on the outline within 0.01 mm:
// lines by distance, arcs by centre + radius), the rest its other edge; returns { side: [points], away: [points] }
function stripParts(d, onOutline, arcOk) {
  const cmds = commandsOf(d);
  ok(cmds[0].c === 'M' && cmds[cmds.length - 1].c === 'Z', 'a strip path is CLOSED (M ... Z): ' + d.slice(0, 60));
  const side = [cmds[0].p]; let k = 1;
  for (; k < cmds.length && cmds[k].c !== 'Z'; k++) {
    const c = cmds[k];
    if (!onOutline(c.p)) break;
    if (c.c === 'A') ok(arcOk(side[side.length - 1], c), 'the strip\'s part-side arc is the outline\'s arc (centre + radius)');
    side.push(c.p);
  }
  const away = cmds.slice(k).filter((c) => c.c !== 'Z').map((c) => c.p);
  return { side, away };
}

// ── 1. the declared rules ──
eq([HOLD_PART.autoPerMm, HOLD_PART.autoMin, HOLD_PART.stripExtraMm], [150, 3, 1], 'declared: one tab per 150 mm, at least 3; strip = bit + 1 mm');
eq([autoTabCount(100), autoTabCount(450), autoTabCount(451), autoTabCount(600), autoTabCount(700)], [3, 3, 4, 4, 5], 'Auto count: ceil(perimeter / 150), at least 3');
{
  const st = polyState(RECT), w = loopWalk(loopOf(st, 's0'), st);
  eq(w.length, 600, 'rectangle perimeter 600 mm');
  const L = tabLayout(w, { count: autoTabCount(w.length), width: 10, bitRadius: R, gap: W, side: 1 });
  eq(L.tabs.map((t) => walkAt(w, t.s).point).map((p) => [Math.round(p.x * 1e6) / 1e6, Math.round(p.y * 1e6) / 1e6]), [[100, 0], [200, 50], [100, 100], [0, 50]],
    'rectangle: 4 tabs, evenly spread by perimeter from the middle of the longest side: the middle of each side');
  // a narrow rectangle: a side shorter than width + bit diameter takes no tab
  const st2 = polyState([[0, 0], [300, 0], [300, 12], [0, 12]]), w2 = loopWalk(loopOf(st2, 's0'), st2);
  const L2 = tabLayout(w2, { count: 4, width: 10, bitRadius: R, gap: W, side: 1 });
  ok(L2.tabs.every((t) => { const p = walkAt(w2, t.s).point; return Math.abs(p.y) < 1e-9 || Math.abs(p.y - 12) < 1e-9; }), 'the 12 mm ends (< 10 + 3.175 + clearance) take no tab: all tabs on the long sides');
  eq(L2.tabs.length, 4, '4 tabs on a 300 x 12 bar');
  // tabs too many for the gaps: lowered until each gap is at least the strip width
  const L3 = tabLayout(w, { count: 60, width: 10, bitRadius: R, gap: W, side: 1 });
  ok(L3.tabs.length < 60 && L3.tabs.length > 0, 'count 60 on a 600 mm outline: lowered to what the gaps allow (' + L3.tabs.length + ')');
  for (let i = 0; i < L3.tabs.length; i++) { const a = L3.tabs[i], b = L3.tabs[(i + 1) % L3.tabs.length]; ok(((b.s0 - a.s1) % 600 + 600) % 600 >= W - 1e-6, 'each gap >= the strip width'); }
}
{
  // the L: the tab next to the concave corner (80, 60) keeps width / 2 + strip width from it; the others width / 2 + bit radius from their ends
  const st = polyState(LSHAPE), w = loopWalk(loopOf(st, 's0'), st);
  eq(w.length, 700, 'L perimeter 700 mm');
  const L = tabLayout(w, { count: autoTabCount(w.length), width: 10, bitRadius: R, gap: W, side: 1 });
  eq(L.tabs.length, 5, 'L: 5 tabs (700 / 150 rounded up)');
  const pts = L.tabs.map((t) => walkAt(w, t.s).point);
  const onTop = pts.find((p) => Math.abs(p.y - 60) < 1e-9);
  ok(onTop, 'a tab on the inner edge y = 60');
  near(onTop.x, 80 + 5 + W, 1e-6, 'it is moved toward its ideal spot but stays width / 2 + strip width from the concave corner (80, 60)');
  // an Inside cut on the same L: the corner (80, 60) is convex seen from the hole's waste, the outer corners concave
  const Li = tabLayout(w, { count: 5, width: 10, bitRadius: R, gap: W, side: -1 });
  const top = Li.tabs.map((t) => walkAt(w, t.s).point).find((p) => Math.abs(p.y - 60) < 1e-9);
  ok(top && Math.abs(top.x - (80 + 5 + R)) < 1e-6, 'inside: the same tab only width / 2 + bit radius from (80, 60) (a convex corner from the waste): ' + JSON.stringify(top));
}
{
  // DECIDED: an arc / a circle takes tabs too (one rule for every segment of the outline); a circle has no ends, so they are evenly spread round it
  const st = circleState(), w = loopWalk(loopOf(st, 'c'), st);
  near(w.length, 80 * Math.PI, 1e-9, 'circle perimeter');
  const L = tabLayout(w, { count: autoTabCount(w.length), width: 10, bitRadius: R, gap: W, side: 1 });
  eq(L.tabs.length, 3, 'circle r 40: 3 tabs (the minimum)');
  const ang = L.tabs.map((t) => { const p = walkAt(w, t.s).point; return Math.atan2(p.y - 50, p.x - 50); });
  for (let i = 0; i < 3; i++) near(((ang[(i + 1) % 3] - ang[i]) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI), (2 * Math.PI) / 3, 1e-9, 'evenly spread: 120 degrees apart');
}

// ── 2. the export ──
function checkTabsExport(name, st, edge, rec, outline, { arcCentreAt = null, arcR = null, outsideStrips = true } = {}) {
  const loop = loopOf(st, edge), W = rec.toolDia + HOLD_PART.stripExtraMm; // the strip width of THIS record's bit
  const entries = [{ target: { kind: 'loop', id: loop.id }, rec }];
  const svg = exportOf(st, entries);
  const els = elementsOf(svg);
  const cuts = cutsOf(st, edge, rec);
  const pass = cuts.find((c) => c.hold && c.hold.role === 'pass');
  ok(pass, name + ': a pass');
  const n = pass.hold.count;
  const passType = rec.cutType === 'exterior' ? 'outside' : 'inside';
  const passes = els.filter((e) => e.depth === '16.000 mm');
  const strips = els.filter((e) => e.depth === '18.000 mm' && e.cutType === 'inside' && e.d && commandsOf(e.d).length > 2 && !(e.a.cx));
  eq(passes.map((e) => e.cutType), [passType], `${name}: exactly ONE pass, the ${passType} cut at depth - thickness (16 mm)`);
  eq(strips.length, n, `${name}: ${n} gap strips (Inside cuts at the full 18 mm) = the tab count`);
  ok(n >= 3, `${name}: ${n} tabs`);
  for (const e of els) {
    if (e.tag === 'circle') continue; // a <circle> is closed by itself
    ok(/Z$/.test(e.d.trim()), `${name}: every exported path is CLOSED: ${e.d.slice(0, 40)}...`);
  }
  // the pass is the plain cut's element (same geometry), only its depth differs
  const plainEls = elementsOf(exportOf(st, [{ target: { kind: 'loop', id: loop.id }, rec: { ...rec, holdPart: 'off' } }]));
  const plainOuter = plainEls.find((e) => e.cutType === passType && e.depth === '18.000 mm' && (e.d === passes[0].d && e.a.cx === passes[0].a.cx));
  ok(plainOuter, `${name}: the pass is the same element as the plain cut (no offset applied), at 16 mm instead of 18`);
  // each strip: its part-side edge IS the outline over its span, its other edge at the strip width (bit + 1 mm) from the outline
  const onOutline = (p) => distPoly(p, outline) <= 0.01;
  const arcOk = (from, c) => { if (!arcCentreAt) return false; const ce = arcCentre(from, c.p, c.r, c.large, c.sweep); return Math.hypot(ce.x - arcCentreAt.x, ce.y - arcCentreAt.y) <= 0.01 && Math.abs(c.r - arcR) <= 0.01; };
  const tabEnds = cuts.find((c) => c.hold && c.hold.role === 'pass').hold.marks.map((m) => commandsOf(m)).map((cm) => [cm[0].p, cm[cm.length - 1].p]);
  strips.forEach((e, i) => {
    const { side, away } = stripParts(e.d, onOutline, arcOk);
    ok(side.length >= 2, `${name} strip ${i + 1}: its part-side edge has ${side.length} points on the outline`);
    const starts = tabEnds.some(([, b]) => Math.hypot(b.x - side[0].x, b.y - side[0].y) < 1e-3), ends = tabEnds.some(([a]) => Math.hypot(a.x - side[side.length - 1].x, a.y - side[side.length - 1].y) < 1e-3);
    ok(starts && ends, `${name} strip ${i + 1}: its part-side edge runs from one tab's end to the next tab's start`);
    const far = away.map((p) => distPoly(p, outline));
    ok(far.every((dd) => Math.abs(dd - W) <= 0.01), `${name} strip ${i + 1}: every point of its other edge is the strip width ${W} mm from the outline (min ${Math.min(...far).toFixed(4)}, max ${Math.max(...far).toFixed(4)})`);
    const inPart = (p) => { let c = false; for (let a = 0, b = outline.length - 1; a < outline.length; b = a++) { const A = outline[a], B = outline[b]; if ((A.y > p.y) !== (B.y > p.y) && p.x < ((B.x - A.x) * (p.y - A.y)) / (B.y - A.y) + A.x) c = !c; } return c; };
    ok(away.every((p) => inPart(p) === !outsideStrips), `${name} strip ${i + 1}: on the waste side (${outsideStrips ? 'outside' : 'inside'} the outline)`);
  });
  // Review / Prepare: every strip has a footprint (the bit-centre path swept), at the full depth
  const fps = deriveCutFootprint(cuts, rec, st);
  ok(fps.filter((f) => f.hold && f.hold.role === 'strip').every((f) => f.rings.length > 0 && f.hold.depth === 18), `${name}: every strip has a footprint at 18 mm`);
  ok(fps.find((f) => f.hold && f.hold.role === 'pass').hold.depth === 16, `${name}: the pass footprint at 16 mm`);
  console.log(`${name}: ${n} tabs, 1 pass + ${strips.length} strips; first strip d = ${strips[0].d.slice(0, 120)}...`);
  return { svg, els, cuts, n };
}
const rectPoly = RECT.map(([x, y]) => ({ x, y })), lPoly = LSHAPE.map(([x, y]) => ({ x, y }));
const circlePoly = Array.from({ length: 3600 }, (_, k) => ({ x: 50 + 40 * Math.cos((k * 2 * Math.PI) / 3600), y: 50 + 40 * Math.sin((k * 2 * Math.PI) / 3600) }));
checkTabsExport('rectangle outside', polyState(RECT), 's0', TABS, rectPoly);
checkTabsExport('rectangle inside', polyState(RECT), 's0', { ...TABS, cutType: 'interior' }, rectPoly, { outsideStrips: false });
checkTabsExport('L outside', polyState(LSHAPE), 's0', TABS, lPoly);
checkTabsExport('L inside', polyState(LSHAPE), 's0', { ...TABS, cutType: 'interior' }, lPoly, { outsideStrips: false });
checkTabsExport('circle outside', circleState(), 'c', TABS, circlePoly, { arcCentreAt: { x: 50, y: 50 }, arcR: 40 });
checkTabsExport('circle inside', circleState(), 'c', { ...TABS, cutType: 'interior' }, circlePoly, { arcCentreAt: { x: 50, y: 50 }, arcR: 40, outsideStrips: false });
{
  // the strip WIDTH is the only number taken from the bit: a 6.35 mm bit -> 7.35 mm strips, the part-side edge still the outline
  const r = checkTabsExport('rectangle outside, 1/4 in bit', polyState(RECT), 's0', { ...TABS, toolDia: 6.35 }, rectPoly);
  const wide = r.els.filter((e) => e.depth === '18.000 mm');
  ok(wide.every((e) => commandsOf(e.d).filter((c) => c.c !== 'Z').some((c) => Math.abs(distPoly(c.p, rectPoly) - 7.35) <= 0.01)), 'a 1/4 in bit: the strips are 7.35 mm wide');
}
{
  // the record's offset is written as the cuts' attribute (the Origin applies it), never applied to the pass here. TASK 787: the Origin offsets each
  // gap strip all round, its end caps too, so the strips are laid out round tabs of the tab width - 2 x the offset (the tab cut stays the tab width:
  // tests/cam-paths-787-node.test.js measures it): at 0.3 mm each strip's ends move 0.3 mm in along the outline, nothing else changes
  const st = polyState(LSHAPE), t = { kind: 'loop', id: loopOf(st, 's0').id };
  const a = elementsOf(exportOf(st, [{ target: t, rec: TABS }])), b = elementsOf(exportOf(st, [{ target: t, rec: { ...TABS, cutOffset: 0.3 } }]));
  eq([b.length, b[0].d], [a.length, a[0].d], 'offset 0.3 mm: the pass identical to offset 0 (no offset computed on it), as many strips');
  eq(b[1].d.split(' ').slice(0, 3), ['M', '104.7', '0'], 'offset 0.3 mm: the first strip begins at 104.7, 0.3 mm into the 10 mm tab centred at 100, so the Origin, offsetting by +0.3 mm, ends its cut at 105');
  ok(b.every((e) => e.a['shaper:cutOffset'] === '0.300 mm'), 'and every element carries shaper:cutOffset 0.300 mm');
  ok(cutsOf(st, 's0', { ...TABS, cutOffset: 0.6 }).find((c) => c.hold).hold.error === 'strip', 'an offset over 0.5 mm leaves no room for the bit in a strip (bit + 1 mm wide): refused');
}
{
  // a plate with an inside hole: Tabs on the plate's outline only; the hole's automatic Inside cut stays one full-depth cut with no strips
  const st = polyState(RECT, { circles: [['h', [100, 50], 15]] });
  const loop = loopOf(st, 's0');
  const els = elementsOf(exportOf(st, [{ target: { kind: 'loop', id: loop.id }, rec: TABS }]));
  const holeEl = els.filter((e) => e.tag === 'circle');
  eq(holeEl.map((e) => [e.cutType, e.depth, e.a.cx, e.a.cy, e.a.r]), [['inside', '18.000 mm', '100', '50', '15']], 'the plate\'s hole: its automatic Inside cut, full depth, unchanged');
  eq(els.filter((e) => e.depth === '16.000 mm').map((e) => e.cutType), ['outside'], 'the plate: one pass at 16 mm');
  eq(els.filter((e) => e.tag === 'path' && e.depth === '18.000 mm' && e.cutType === 'inside').length, 4, 'the plate: 4 gap strips');
  // an Inside cut on the hole itself, with tabs: the slug is held; strips inward
  const hole = loopOf(st, 'h');
  const els2 = elementsOf(exportOf(st, [{ target: { kind: 'loop', id: hole.id }, rec: { ...TABS, cutType: 'interior' } }]));
  eq(els2.filter((e) => e.depth === '16.000 mm').map((e) => [e.tag, e.cutType]), [['circle', 'inside']], 'the hole: its own Inside cut as the pass at 16 mm (the same <circle>)');
  const holeCircle = Array.from({ length: 3600 }, (_, k) => ({ x: 100 + 15 * Math.cos((k * 2 * Math.PI) / 3600), y: 50 + 15 * Math.sin((k * 2 * Math.PI) / 3600) }));
  checkTabsExport('hole inside', st, 'h', { ...TABS, cutType: 'interior' }, holeCircle, { arcCentreAt: { x: 100, y: 50 }, arcR: 15, outsideStrips: false });
}
{
  // tabs OFF = byte-identical to before; a type that cannot hold ignores the fields
  const st = polyState(RECT, { circles: [['h', [100, 50], 15]] }), loop = loopOf(st, 's0'), t = { kind: 'loop', id: loop.id };
  const before = exportOf(st, [{ target: t, rec: { cutType: 'exterior', cutDepth: 18, cutOffset: 0, toolDia: BIT } }]);
  eq(exportOf(st, [{ target: t, rec: { ...TABS, holdPart: 'off' } }]), before, 'Hold part Off (with its fields set): byte-identical to a record without them');
  for (const ct of ['pocket', 'guide']) { // TASK 775: On line takes the Hold part now (its tabs are gaps in the line: tests/leadin-tabs-775-node)
    eq(exportOf(st, [{ target: t, rec: { ...TABS, cutType: ct } }]), exportOf(st, [{ target: t, rec: { cutType: ct, cutDepth: 18, cutOffset: 0, toolDia: BIT } }]), `${ct}: the Hold part fields are ignored (byte-identical)`);
  }
  // onion skin: one pass at depth - skin, no strips, the same element
  const skin = elementsOf(exportOf(st, [{ target: t, rec: { ...TABS, holdPart: 'skin' } }]));
  eq(skin.map((e) => [e.cutType, e.depth]), [['inside', '18.000 mm'], ['outside', '16.000 mm']], 'onion skin: the hole as before + ONE outside pass at 16 mm, no strips');
  eq(skin[1].d, elementsOf(before).find((e) => e.cutType === 'outside').d, 'onion skin: the same outline element');
  // refused: the plain cut, the summary says why
  for (const [rec, error] of [[{ ...TABS, holdThickness: 18 }, 'thickness'], [{ ...TABS, holdThickness: 25 }, 'thickness'], [{ ...TABS, cutDepth: 'unset' }, 'no cut depth'], [{ ...TABS, holdPart: 'skin', holdThickness: 18 }, 'thickness']]) {
    const plain = exportOf(st, [{ target: t, rec: { ...rec, holdPart: 'off' } }]);
    eq(exportOf(st, [{ target: t, rec }]), plain, `refused (${error}): exported as without Hold part`);
    eq(cutsOf(st, 's0', rec).find((c) => c.hold).hold.error, error, `refused: ${error}`);
  }
  const small = polyState([[0, 0], [12, 0], [12, 12], [0, 12]]);
  eq(cutsOf(small, 's0', TABS).find((c) => c.hold).hold.error, 'no room', 'a 12 mm square: no side long enough for a 10 mm tab: refused');
  // the PREVIEW copy marks the pass and the gaps; the downloaded file never
  const prev = elementsOf(exportOf(st, [{ target: t, rec: TABS }], { previewData: true }));
  eq(prev.map((e) => e.hold), [null, 'pass', 'gap 1/4', 'gap 2/4', 'gap 3/4', 'gap 4/4'], 'preview copy: data-hold on the pass and each gap (TASK 802: flat, in derivation order: the hole, the pass, then the gaps)');
  ok(!/data-/.test(exportOf(st, [{ target: t, rec: TABS }])), 'the downloaded file has no data-* attribute');
  eq(elementsOf(exportOf(st, [{ target: t, rec: { ...TABS, holdPart: 'skin' } }], { previewData: true })).map((e) => e.hold), [null, 'skin'], 'preview copy: data-hold="skin"');
}

{
  // inches: the declared defaults and the note (pure, before any app page: the app's remembered values are module state shared by every open of this
  // process, so the live test checks the app's inch defaults on a fresh page)
  const { holdDefaults } = await import('#core/hold-part.js');
  eq([holdDefaults('in').tabWidth, holdDefaults('in').thickness, holdDefaults('mm').tabWidth, holdDefaults('mm').thickness], [25.4 * 3 / 8, 25.4 / 16, 10, 2], 'declared defaults: 3/8 in and 1/16 in, 10 mm and 2 mm');
  const st = polyState(RECT), loop = loopOf(st, 's0');
  SettingsManager.set('DOC_UNIT', 'in');
  const rec = { ...TABS, tabWidth: 25.4 * 3 / 8, holdThickness: 25.4 / 16, cutDepth: 19.05 };
  const { loops, loopPolys } = loopsWithPolygons(st);
  eq(holdNoteItems(rec, holdSummary(keyOf('loop', loop.id), rec, st, loops, loopPolys, new Set())).map((i) => i.text)[0],
    'Outside: 4 tabs, 0.375 in wide, 0.063 in thick: 1 pass at 0.688 in + 4 gaps at 0.75 in', 'the note in inches (3/8 in tabs, 1/16 in thick, 3/4 in deep)');
  SettingsManager.set('DOC_UNIT', 'mm');
}
// ── 3. the app ──
SettingsManager.set('DOC_UNIT', 'mm');
SettingsManager.set('LENGTH_PRECISION', null);
const drawInto = (app, pts, more) => {
  const st = app.state, src = polyState(pts, more);
  for (const k of [...st.joints.keys()]) st.joints.delete(k);
  st.shapes.length = 0; st.constraints.length = 0;
  for (const [k, v] of src.joints) st.joints.set(k, v);
  st.shapes.push(...src.shapes);
};
const harness = (app) => {
  const doc = app.document, q = (s) => doc.querySelector(s);
  const pressEl = (s) => { const e = q(s); assert(e, s + ' not found'); app.press(e); };
  const clickAt = (x, y, o) => { const pc = doc.getElementById('prepare-canvas'); const p = worldToScreen(pc, { x, y }); app.click(Math.round(p.x), Math.round(p.y), { target: pc, ...o }); };
  const pick = (id) => { pressEl('.cut-type-trigger'); pressEl(`.cut-type-opt[data-id="${id}"]`); };
  const note = () => [...doc.querySelectorAll('.cut-note div')].map((d) => d.textContent);
  const typed = (cls, v) => { const i = q(cls); i.value = v; i.dispatchEvent(new app.window.Event('change')); };
  const shown = (row) => { const r = q(`.cut-row[data-row="${row}"]`); return r.style.display !== 'none' && !('off' in r.dataset); }; // TASK 813: a row that does not apply stays in place, greyed (data-off): not shown as an applicable row
  const hold = (id) => pressEl(`.cut-row[data-row="holdPart"] .cut-preset[data-value="${id}"]`);
  const step = (row, d) => pressEl(`.cut-row[data-row="${row}"] .cut-step[data-d="${d}"]`);
  return { q, pressEl, clickAt, pick, note, typed, shown, hold, step };
};
const recOf = (app, edge) => V2_PLAN.get(keyOf('loop', loopOf(app.state, edge).id));
{
  V2_PLAN.clear();
  const app = await open({ host: 'shaper' });
  try {
    const h = harness(app), st = app.state;
    h.pressEl('.sk-header-tab[data-tab="design"]');
    drawInto(app, RECT, { circles: [['h', [100, 50], 15]] });
    h.pressEl('.sk-header-tab[data-tab="prepare"]');
    h.clickAt(20, 20);
    h.pick('exterior');
    h.typed('.cut-depth', '18');
    ok(h.shown('holdPart') && !h.shown('tabCount') && !h.shown('tabWidth') && !h.shown('holdThickness'), 'Outside: the Hold part row, Off: no other hold row');
    eq([...h.q('.cut-row[data-row="holdPart"]').querySelectorAll('.cut-preset')].map((b) => b.textContent + (b.classList.contains('is-active') ? '*' : '')), ['Off*', 'Tabs', 'Onion skin'], 'Off | Tabs | Onion skin, Off active');
    eq(h.note(), [], 'Off: no note');
    const svgOff = exportOf(st, planEntries());
    let n0 = st.history.length;
    h.hold('tabs');
    eq(st.history.length, n0 + 1, 'Tabs: ONE undo step');
    const r = recOf(app, 's0');
    eq([r.holdPart, r.tabCount, r.tabWidth, r.holdThickness], ['tabs', 'auto', 10, 2], 'Tabs on: count Auto, width 10 mm, thickness 2 mm (the mm defaults)');
    ok(h.shown('tabCount') && h.shown('tabWidth') && h.shown('holdThickness'), 'Tabs: count, width and thickness rows');
    eq(h.q('.cut-row[data-row="holdThickness"] .cut-field-label').textContent, 'Tab thickness', 'the thickness row reads Tab thickness');
    eq([h.q('.cut-tab-count').value, h.q('.cut-tab-count').placeholder, h.q('.cut-tab-width').value, h.q('.cut-hold-thickness').value], ['', 'Auto (4)', '10', '2'], 'the fields: count empty with Auto (4), 10, 2');
    eq(h.note(), ['Outside: 4 tabs, 10 mm wide, 2 mm thick: 1 pass at 16 mm + 4 gaps at 18 mm', 'Gaps: cut the side against the part; the return leg is optional'], 'the card note');
    const els = elementsOf(exportOf(st, planEntries()));
    eq(els.map((e) => [e.cutType, e.depth]), [['inside', '18.000 mm'], ['outside', '16.000 mm'], ...Array(4).fill(['inside', '18.000 mm'])], 'the export (TASK 802, flat, derivation order): the hole, the pass, then the 4 strips');
    // the Review: the pass at 16, each strip at 18, the hole at 18
    const items = planReliefItems(st);
    eq(items.map((i) => [i.cutType, i.cutDepth]).sort(), [['exterior', 16], ['interior', 18], ['interior', 18], ['interior', 18], ['interior', 18], ['interior', 18]], 'Review: the pass at 16 mm, the 4 strips and the hole at 18 mm');
    // the count: + from Auto steps from 4; typed; Auto back
    n0 = st.history.length;
    h.step('tabCount', 1);
    eq([recOf(app, 's0').tabCount, st.history.length], [5, n0 + 1], 'count + from Auto (4) -> 5, ONE undo step');
    eq(h.note()[0], 'Outside: 5 tabs, 10 mm wide, 2 mm thick: 1 pass at 16 mm + 5 gaps at 18 mm', 'note: 5 tabs');
    eq(elementsOf(exportOf(st, planEntries())).filter((e) => e.tag === 'path' && e.cutType === 'inside').length, 5, 'export: 5 strips');
    h.typed('.cut-tab-count', '3'); eq(recOf(app, 's0').tabCount, 3, 'typed 3');
    h.typed('.cut-tab-count', 'x'); eq(recOf(app, 's0').tabCount, 3, 'typed text: refused, stays 3');
    h.typed('.cut-tab-count', '0'); eq(recOf(app, 's0').tabCount, 3, 'typed 0: refused');
    h.pressEl('.cut-row[data-row="tabCount"] .cut-preset[data-value="auto"]'); eq(recOf(app, 's0').tabCount, 'auto', 'the Auto button');
    // width / thickness: the stepper (positive), typed values in the doc unit
    h.step('tabWidth', 1); eq(recOf(app, 's0').tabWidth, 11, 'tab width + 1 mm -> 11');
    h.step('holdThickness', -1); eq(recOf(app, 's0').holdThickness, 1.5, 'thickness - 0.5 mm -> 1.5');
    h.typed('.cut-hold-thickness', '0.3'); h.step('holdThickness', -1); eq(recOf(app, 's0').holdThickness, 0.3, 'thickness 0.3 - 0.5 would be 0: a size stays (positive)');
    h.typed('.cut-hold-thickness', '-1'); eq(recOf(app, 's0').holdThickness, 0.3, 'typed -1: refused');
    h.typed('.cut-hold-thickness', '3'); h.typed('.cut-tab-width', '8');
    eq(h.note()[0], 'Outside: 4 tabs, 8 mm wide, 3 mm thick: 1 pass at 15 mm + 4 gaps at 18 mm', 'note follows width 8 / thickness 3');
    // thickness >= depth: refused, warning
    h.typed('.cut-hold-thickness', '18');
    eq(h.note(), ['Outside: tabs refused: tab thickness 18 mm is not less than the cut depth 18 mm: nothing to hold; cut without them'], 'refused note');
    ok(h.q('.cut-note .cut-note-warn'), 'the refused note is in the warning colour');
    eq(exportOf(st, planEntries()), svgOff, 'refused: the export is the plain cut (byte-identical to Off)');
    h.typed('.cut-hold-thickness', '3');
    // onion skin
    h.hold('skin');
    ok(!h.shown('tabCount') && !h.shown('tabWidth') && h.shown('holdThickness'), 'Onion skin: only the thickness row');
    eq(h.q('.cut-row[data-row="holdThickness"] .cut-field-label').textContent, 'Skin thickness', 'it reads Skin thickness');
    eq(h.note(), ['Outside: onion skin 3 mm: 1 pass at 15 mm'], 'onion skin note');
    eq(elementsOf(exportOf(st, planEntries())).map((e) => [e.cutType, e.depth]), [['inside', '18.000 mm'], ['outside', '15.000 mm']], 'onion skin export');
    // undo walks back one edit at a time; Off is byte-identical to before
    app.undo(); eq(recOf(app, 's0').holdPart, 'tabs', 'undo: back to Tabs');
    app.redo(); eq(recOf(app, 's0').holdPart, 'skin', 'redo: Onion skin');
    h.hold('off');
    eq(exportOf(st, planEntries()), svgOff, 'Off again: byte-identical to before Tabs');
    eq(h.note(), [], 'Off: no note');
    // the last values are the next record's defaults (width 8, thickness 3, count Auto); an Inside on the hole
    h.clickAt(100, 50);
    h.pick('interior');
    h.typed('.cut-depth', '18');
    h.hold('tabs');
    const rh = V2_PLAN.get(keyOf('loop', loopOf(st, 'h').id));
    eq([rh.tabCount, rh.tabWidth, rh.holdThickness], ['auto', 8, 3], 'the next record turned to Tabs takes the last values set (Auto, 8 mm, 3 mm)');
    eq(h.note()[0], 'Inside: 3 tabs, 8 mm wide, 3 mm thick: 1 pass at 15 mm + 3 gaps at 18 mm', 'the hole: 3 tabs');
    // a type that cannot hold: no Hold part row
    h.pick('pocket');
    ok(!h.shown('holdPart') && !h.shown('tabCount') && !h.shown('holdThickness'), 'Pocket: no Hold part rows');
    eq(h.note(), [], 'Pocket: no hold note');
    h.clickAt(300, 300); // nothing selected: the card hides (so no later unit change re-renders this page's card after it is closed)
    ok(h.q('.cut-card').hidden, 'nothing selected: no card');
  } finally { await app.close(); }
}
{
  // save + reload keep the held record and the export byte-identical
  V2_PLAN.clear();
  const profile = await createProfile();
  await createNamedDesign(profile, 'shaper', 'Tabs 742');
  let planBefore, svgBefore;
  {
    const app = await open({ host: 'shaper', profile });
    try {
      const h = harness(app);
      h.pressEl('.sk-header-tab[data-tab="design"]');
      drawInto(app, LSHAPE);
      app.state.saveState('draw L');
      h.pressEl('.sk-header-tab[data-tab="prepare"]');
      h.clickAt(20, 20);
      h.pick('exterior');
      h.typed('.cut-depth', '12');
      h.hold('tabs');
      h.typed('.cut-tab-count', '6');
      planBefore = JSON.stringify([...V2_PLAN.entries()]);
      svgBefore = exportOf(app.state, planEntries());
      ok(elementsOf(svgBefore).filter((e) => e.depth === '12.000 mm').length >= 3, 'L with 6 tabs asked: strips at 12 mm');
      const d = await app.storedDoc();
      ok(storedRecords(d.hosts.shaper).some(([, r]) => r.holdPart === 'tabs' && r.tabCount === 6 && r.tabWidth > 0 && r.holdThickness > 0), 'the autosave stores the held record');
    } finally { await app.close(); }
  }
  V2_PLAN.clear();
  {
    const app = await open({ host: 'shaper', profile });
    try {
      app.modes.showMode('prepare');
      eq(JSON.stringify([...V2_PLAN.entries()]), planBefore, 'after a reload the plan is equal');
      eq(exportOf(app.state, planEntries()), svgBefore, 'and the export is byte-identical');
    } finally { await app.close(); }
  }
}
console.log(`hold-part-742-node: ok (${checks} checks)`);
