// tests/door-hardware-843-node.test.js -- TASK 843 (owner turns 3083-3084: "Template for locksmiths"): the DOOR HARDWARE templates
// (packages/core/templates.js), cut directly on the door or the frame with the Origin.
//   1. the bank: six templates in ONE group "Door hardware", kept together at the end of the bank; the picker shows the group on their cards only
//   2. every template, each corner choice: builds in a mm, inch and cm document, loads, solves with 0 conflicts, fully dimensioned (nullity 0),
//      its declared number of driving dimensions, every dimension a formula of its user parameters
//   3. the presets: each standard number (the inch size, its mm exact); the defaults are the presets' first (or declared) size; an inch document
//      opens with the exact inch sizes
//   4. the drawing at the defaults: every bore, recess and guide where the standard puts it (read from the SOLVED sketch, user Y up)
//   5. the declared cuts (the document's hosts.template.cuts): each one's type, depth and shapes; a depth changes the cut, not the drawing;
//      an inch document gives the same cuts in mm
//   6. Shaper (the node kit: Shaper's own Design canvas, its own restore path): a template document without a Shaper part opens with its
//      operations ready: the loops Shaper sees (each bore / recess a closed loop, each guide an open chain), bores Inside / Pocket, recesses Pocket
//      at the declared depth, guides Guide; a design that has its own Shaper part is NOT given the template's cuts again
//   7. the start view (Shaper's sidebar Templates...): the group label on the cards; a preset chip sets its field to the size exactly (mm document:
//      69.85, the chip says "69.9 (2-3/4")"), Open builds the template at that size and Shaper has its operations ready
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import { TEMPLATES, buildTemplate, templateById, defaultParams, paramName, isLiveParam, inches, presetText, presetTitle, toMm } from '#core/templates.js';
import { deserializeDocument } from '#core/document.js';
import { isDimension, isReferenceDimension } from '#core/parameters.js';
import { parseInput, dependencies } from '#core/expression.js';
import { findLoops, findOpenChains } from '#core/loop-finder.js';
import { arcSweepInfo, angleInArcSweep } from '#core/geometry.js';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { storeOps } from '../apps/shaper/src/operations-store.js';
import { parseKey } from '../apps/shaper/src/cut-plan.js';

const muted = (f) => { const l = console.log, w = console.warn, e = console.error, d = console.debug; console.log = console.warn = console.error = console.debug = () => {}; try { return f(); } finally { console.log = l; console.warn = w; console.error = e; console.debug = d; } };
let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const near = (a, b, m, tol = 1e-6) => { assert.ok(Math.abs(a - b) < tol, `${m}: ${a} vs ${b}`); checks++; };
const IN = 25.4, R = (v) => Math.round(v * 1e6) / 1e6 + 0;
const DOOR_IDS = ['lockset-face-bore', 'latch-edge-prep', 'strike-mortise', 'deadbolt-bores', 'hinge-mortise', 'mortise-lock-pocket'];

// ---- 1. the bank
const door = TEMPLATES.filter((t) => t.group === 'Door hardware');
eq(door.map((t) => t.id), DOOR_IDS, '1. the six door-hardware templates, in one group');
eq(TEMPLATES.slice(-6).map((t) => t.id), DOOR_IDS, '1. kept together (the last six of the bank)');
ok(TEMPLATES.filter((t) => t.group && t.group !== 'Door hardware').length === 0, '1. no other group');

// ---- 2. every template, every corner choice, three document units
const solved = (doc) => {
  const S = L.newSketch();
  const res = muted(() => deserializeDocument(JSON.parse(JSON.stringify(doc)), S.state));
  assert.ok(res.ok, res.reason);
  const r = muted(() => S.engine.solve(L.ITER));
  eq(r.conflicts || [], [], 'solves with 0 conflicts');
  return S;
};
const variantsOf = (t) => (t.params.corners ? t.params.corners.options.map((o) => ({ corners: o.value })) : [{}]);
for (const t of door) for (const extra of variantsOf(t)) for (const unit of ['mm', 'in', 'cm']) {
  const m = `2. ${t.id} ${JSON.stringify(extra)} ${unit}`;
  const doc = muted(() => buildTemplate(t, extra, unit));
  const S = solved(doc);
  eq(L.nullity(S), 0, `${m}: fully dimensioned (nullity 0)`);
  const dims = S.state.constraints.filter((c) => isDimension(c) && !isReferenceDimension(c));
  const round = extra.corners === 'round' ? { 'strike-mortise': 4, 'hinge-mortise': 2 }[t.id] || 0 : 0; // each fillet has its own radius dimension
  eq(dims.length, t.dimensions + round, `${m}: ${t.dimensions + round} driving dimensions`);
  const names = new Set(S.state.parameters.map((p) => p.name));
  for (const c of dims) ok(dependencies(parseInput(c.expression, { allowAssign: false })).every((d) => names.has(d)), `${m}: ${c.name} = ${c.expression} reads only user parameters`);
  const live = Object.entries(t.params).filter(([, spec]) => isLiveParam(spec, { ...defaultParams(t, unit), ...extra })).map(([k]) => paramName(k));
  eq(S.state.parameters.map((p) => p.name), live, `${m}: its lengths are its user parameters (the depths are not)`);
}

// ---- 3. the presets: every standard number
const presets = (t, k) => t.params[k].presets.map((p) => [p.text, p.mm]);
const sizes = (...texts) => texts.map((s) => [s, R(eval(s.replace('-', '+')) * IN)]); // '2-3/8' = 2 + 3/8 in
const STANDARDS = {
  'lockset-face-bore': { backset: sizes('2-3/8', '2-3/4'), doorThickness: sizes('1-3/8', '1-3/4') },
  'latch-edge-prep': { doorThickness: sizes('1-3/8', '1-3/4'), edgeBore: sizes('1', '7/8'), faceplateWidth: sizes('1', '1-1/8'), backset: sizes('2-3/8', '2-3/4') },
  'strike-mortise': { strikeHeight: sizes('2-3/4', '4-7/8'), cornerRadius: sizes('1/4', '1/2'), doorThickness: sizes('1-3/8', '1-3/4'), holeDepth: sizes('5/8', '1-1/8') },
  'deadbolt-bores': { backset: sizes('2-3/8', '2-3/4'), doorThickness: sizes('1-3/8', '1-3/4'), faceplateWidth: sizes('1', '1-1/8') },
  'hinge-mortise': { hingeHeight: sizes('3', '3-1/2', '4', '4-1/2'), doorThickness: sizes('1-3/8', '1-3/4'), cornerRadius: sizes('1/4', '5/8') },
  'mortise-lock-pocket': { doorThickness: sizes('1-3/4', '2-1/4') },
};
for (const t of door) {
  const withPresets = Object.keys(t.params).filter((k) => t.params[k].presets);
  eq(withPresets, Object.keys(STANDARDS[t.id]), `3. ${t.id}: the params with standard sizes`);
  for (const [k, want] of Object.entries(STANDARDS[t.id])) eq(presets(t, k), want, `3. ${t.id}.${k}: the standard sizes ${want.map((w) => w[0]).join(' / ')} in`);
}
eq(sizes('2-3/8', '2-3/4', '2-1/8', '7/8', '4-7/8').map((s) => s[1]), [60.325, 69.85, 53.975, 22.225, 123.825], '3. the mm of the standard sizes (1 in = 25.4 mm)');
eq([inches('2-3/8'), inches('7/8'), inches('4'), inches('4-1/2', 'note')], [{ text: '2-3/8', mm: 60.325 }, { text: '7/8', mm: 22.225 }, { text: '4', mm: 101.6 }, { text: '4-1/2', mm: 114.3, note: 'note' }], '3. inches()');
assert.throws(() => inches('2.375'), /not a size in inches/); checks++;
const DEFAULTS_IN = { // the standard each template opens with (an inch document: exact)
  'lockset-face-bore': { backset: 2.375, faceBore: 2.125, doorThickness: 1.375 },
  'latch-edge-prep': { doorThickness: 1.75, edgeBore: 1, faceplateWidth: 1, faceplateHeight: 2.25, corners: 'square', plateThickness: 0.125, backset: 2.375 },
  'strike-mortise': { strikeWidth: 1.25, strikeHeight: 2.75, holeWidth: 0.75, holeHeight: 1.25, corners: 'square', cornerRadius: 0.25, doorThickness: 1.75, strikeThickness: 0.0625, holeDepth: 0.625 },
  'deadbolt-bores': { backset: 2.375, faceBore: 2.125, edgeBore: 1, doorThickness: 1.75, faceplateWidth: 1, faceplateHeight: 2.25, corners: 'square', plateThickness: 0.125 },
  'hinge-mortise': { hingeHeight: 3.5, doorThickness: 1.375, setback: 0.25, corners: 'square', cornerRadius: 0.25, screwInset: 0.5, screwHole: 0.125, leafThickness: 0.125 },
  'mortise-lock-pocket': { doorThickness: 1.75, faceplateWidth: 1.25, faceplateHeight: 8, pocketWidth: 1, pocketHeight: 6, frontThickness: 0.125, pocketDepth: 4 },
};
for (const t of door) {
  eq(defaultParams(t, 'in'), DEFAULTS_IN[t.id], `3. ${t.id}: an inch document opens with the exact standard sizes`);
  eq(toMm(t, defaultParams(t, 'in'), 'in'), defaultParams(t), `3. ${t.id}: the mm defaults are those sizes exactly`);
  for (const [k, spec] of Object.entries(t.params)) if (spec.presets) ok(spec.presets.some((p) => p.mm === spec.default), `3. ${t.id}.${k}: the default is one of its standard sizes`);
}
eq([presetText(inches('2-3/4'), 'in'), presetText(inches('2-3/4'), 'mm'), presetText(inches('2-3/4'), 'cm'), presetTitle(inches('2-3/4', 'commercial'))],
  ['2-3/4"', '69.9 (2-3/4")', '6.99 (2-3/4")', '2-3/4 in = 69.9 mm, commercial'], '3. a chip: the inch size in an inch document, the metric equivalent in a mm / cm document');

// ---- 4. the drawing at the defaults (user coordinates, Y up), and the declared cuts
const user = (S, j) => { const p = S.state.joints.get(j); return { x: R(p.x), y: R(-p.y) }; };
const shapeOf = (S, id) => S.state.shapes.find((s) => s.id === id);
// the box (user coordinates) of some shapes: lines by their ends, circles by centre +- radius, arcs by their ends and the extreme points in their sweep
const boxOf = (S, ids) => {
  const xs = [], ys = [];
  for (const id of ids) {
    const s = shapeOf(S, id), P = s.joints.map((j) => user(S, j));
    if (s.type === 'circle') { xs.push(P[0].x - s.radius, P[0].x + s.radius); ys.push(P[0].y - s.radius, P[0].y + s.radius); continue; }
    for (const p of (s.type === 'arc' ? P.slice(1) : P)) { xs.push(p.x); ys.push(p.y); }
    if (s.type === 'arc') { // its extreme points in its sweep (world coordinates: the sweep is stored there)
      const W = s.joints.map((j) => S.state.joints.get(j)), r = Math.hypot(W[1].x - W[0].x, W[1].y - W[0].y), info = arcSweepInfo(W[0], W[1], W[2], { sweep: s.sweep });
      for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) if (angleInArcSweep(info, a)) { xs.push(R(W[0].x + r * Math.cos(a))); ys.push(R(-(W[0].y + r * Math.sin(a)))); }
    }
  }
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(R);
};
const circleOf = (S, id) => { const s = shapeOf(S, id), c = user(S, s.joints[0]); return [c.x, c.y, R(s.radius)]; };
const cutsOf = (doc) => doc.hosts.template.cuts;
const half = (inch) => R(inch * IN / 2);
{
  const expect = { // [cutType, cutDepth (mm), what: 'circle' [x, y, r] | 'box' [x0, y0, x1, y1] | 'chains' n]
    'lockset-face-bore': [['inside', 1.375 * IN, 'circle', [-2.375 * IN, 0, half(2.125)]], ['guide', undefined, 'box', [0, -2.125 * IN, 0, 2.125 * IN]]],
    'latch-edge-prep': [['pocket', 2.375 * IN, 'circle', [0, 0, half(1)]], ['pocket', 0.125 * IN, 'box', [-half(1), -half(2.25), half(1), half(2.25)]], ['guide', undefined, 'box', [-half(1.75), -2.25 * IN, half(1.75), 2.25 * IN]]],
    'strike-mortise': [['pocket', IN / 16, 'box', [-half(1.25), -half(2.75), half(1.25), half(2.75)]], ['pocket', 0.625 * IN, 'box', [-half(0.75), -half(1.25), half(0.75), half(1.25)]], ['guide', undefined, 'box', [-half(1.75), -2.75 * IN, -half(1.75), 2.75 * IN]]],
    'deadbolt-bores': [['pocket', 2.375 * IN, 'circle', [half(1.75), 0, half(1)]], ['pocket', 0.125 * IN, 'box', [half(1.75) - half(1), -half(2.25), half(1.75) + half(1), half(2.25)]], ['inside', 1.75 * IN, 'circle', [-2.375 * IN, 0, half(2.125)]], ['guide', undefined, 'box', [0, -2.125 * IN, 1.75 * IN, 2.125 * IN]]],
    'hinge-mortise': [['pocket', 0.125 * IN, 'box', [0, -half(3.5), 1.125 * IN, half(3.5)]], ['guide', undefined, 'box', [half(1.125) - half(0.125), -3.5 * IN, 1.375 * IN, 3.5 * IN]]],
    'mortise-lock-pocket': [['pocket', 0.125 * IN, 'box', [-half(1.25), -half(8), half(1.25), half(8)]], ['pocket', 4 * IN, 'box', [-half(1), -half(6), half(1), half(6)]], ['guide', undefined, 'box', [-half(1.75), -8 * IN, half(1.75), 8 * IN]]],
  };
  for (const t of door) {
    const doc = muted(() => buildTemplate(t)), S = solved(doc), cuts = cutsOf(doc);
    eq(cuts.map((c) => [c.cutType, c.cutDepth]), expect[t.id].map(([type, depth]) => [type, depth === undefined ? undefined : R(depth)]), `4. ${t.id}: the declared cuts (type, depth in mm)`);
    cuts.forEach((c, i) => {
      const [, , what, want] = expect[t.id][i];
      if (what === 'circle') eq(circleOf(S, c.shapes[0]), want.map(R), `4. ${t.id}: cut ${i} (${c.cutType}) is the bore at ${want}`);
      else eq(boxOf(S, c.shapes), want.map(R), `4. ${t.id}: cut ${i} (${c.cutType}) spans ${want}`);
      ok(c.shapes.every((id) => !shapeOf(S, id).isConstruction), `4. ${t.id}: cut ${i} names solid shapes only`);
    });
    const named = new Set(cuts.flatMap((c) => c.shapes));
    eq(S.state.shapes.filter((s) => !s.isConstruction && !named.has(s.id)).map((s) => s.id), [], `4. ${t.id}: every solid shape has its declared cut`);
    // an inch document: the same cuts in mm (the depths read the inch defaults, exact)
    eq(cutsOf(muted(() => buildTemplate(t, {}, 'in'))).map((c) => [c.cutType, c.cutDepth]), cuts.map((c) => [c.cutType, c.cutDepth]), `4. ${t.id}: an inch document declares the same cuts`);
    // a depth changes its cut and not the drawing
    for (const [k, spec] of Object.entries(t.params).filter(([, s]) => s.depth)) {
      const other = muted(() => buildTemplate(t, { [k]: spec.default * 2 }));
      ok(JSON.stringify(cutsOf(other).map((c) => c.cutDepth)) !== JSON.stringify(cuts.map((c) => c.cutDepth)), `4. ${t.id}: ${k} changes a cut's depth`);
      eq(other.geometry.joints.map(([, j]) => [R(j.x), R(j.y)]), doc.geometry.joints.map(([, j]) => [R(j.x), R(j.y)]), `4. ${t.id}: ${k} does not change the drawing`);
    }
  }
  // the round corners: the latch / deadbolt faceplate's full 1/2 in radius ends (the Slot tool), the strike's and the hinge's fillets
  const arcs = (S) => S.state.shapes.filter((s) => s.type === 'arc').map((s) => { const c = user(S, s.joints[0]), a = user(S, s.joints[1]); return R(Math.hypot(a.x - c.x, a.y - c.y)); });
  eq(arcs(solved(buildTemplate(templateById('latch-edge-prep'), { corners: 'round' }))), [half(1), half(1)], '4. latch faceplate, round: two 1/2 in radius ends');
  eq(arcs(solved(buildTemplate(templateById('strike-mortise'), { corners: 'round' }))), Array(4).fill(R(IN / 4)), '4. strike, round: four 1/4 in corners');
  eq(arcs(solved(buildTemplate(templateById('hinge-mortise'), { corners: 'round', cornerRadius: 0.625 * IN }))), Array(2).fill(R(0.625 * IN)), '4. hinge, round 5/8 in: the two corners of the leaf\'s free edge');
  const roundLatch = buildTemplate(templateById('latch-edge-prep'), { corners: 'round' });
  eq(boxOf(solved(roundLatch), cutsOf(roundLatch)[1].shapes), [-half(1), -half(2.25), half(1), half(2.25)].map(R), '4. latch faceplate, round: still 1 x 2-1/4 in (the arcs\' ends: the box of its straight sides)');
  // the loops Shaper sees (#core/loop-finder.js, the one Prepare reads): each bore / recess one closed loop of exactly its shapes, each guide an open chain
  for (const t of door) for (const extra of variantsOf(t)) {
    const doc = muted(() => buildTemplate(t, extra)), g = doc.geometry, st = { joints: new Map(g.joints), shapes: g.shapes, constraints: g.constraints };
    const loops = findLoops(st), chains = findOpenChains(st, loops);
    for (const c of cutsOf(doc)) {
      const set = new Set(c.shapes);
      const alone = (id) => (g.shapes.find((s) => s.id === id).type === 'line' ? chains.some((ch) => ch.edges.length === 1 && ch.edges[0] === id) : loops.some((l) => l.edges.length === 1 && l.edges[0] === id));
      if (c.cutType === 'guide') ok(c.shapes.every(alone), `4. ${t.id} ${JSON.stringify(extra)}: each guide is a chain (a line) or a loop (a screw mark) of its own`);
      else ok(loops.some((l) => l.edges.length === set.size && l.edges.every((e) => set.has(e))), `4. ${t.id} ${JSON.stringify(extra)}: the ${c.cutType} cut is a closed loop of exactly its shapes`);
    }
  }
}

// ---- 6. Shaper: a template document opens with its operations ready
const TYPE = { inside: 'interior', pocket: 'pocket', guide: 'guide' };
const opsNow = () => storeOps().map((op) => ({ type: op.type, depth: op.settings.cutDepth, kinds: op.geometry.map((r) => parseKey(r.key).kind).sort() }));
const wantOps = (doc) => { // the declared cuts as Shaper groups them: one operation per type + depth, its shapes' loops / chains
  const out = new Map();
  for (const c of cutsOf(doc)) {
    const key = `${c.cutType}|${c.cutDepth}`, kind = (id) => (doc.geometry.shapes.find((s) => s.id === id).type === 'line' ? 'chain' : 'loop');
    if (!out.has(key)) out.set(key, { type: TYPE[c.cutType], depth: c.cutDepth === undefined ? 'unset' : c.cutDepth, kinds: [] });
    out.get(key).kinds.push(...(c.cutType === 'guide' ? c.shapes.map(kind) : ['loop'])); // a guide: each line its chain, each mark its loop; a cut: its one loop
  }
  return [...out.values()].map((o) => ({ ...o, kinds: o.kinds.sort() }));
};
const sortOps = (list) => [...list].sort((a, b) => `${a.type}|${a.depth}`.localeCompare(`${b.type}|${b.depth}`));
for (const t of door) {
  const doc = muted(() => buildTemplate(t));
  const profile = await createProfile();
  await createNamedDesign(profile, 'shaper', t.name, doc);
  const app = await open({ host: 'shaper', profile });
  try {
    eq(sortOps(opsNow()), sortOps(wantOps(doc)), `6. ${t.id}: Shaper opens it with its operations ready (bores Inside / Pocket, recesses Pocket at their depth, guides Guide)`);
  } finally { await app.close(); }
}
{ // a design that has its own Shaper part keeps it: the template's cuts are not given again
  const t = templateById('strike-mortise'), doc = muted(() => buildTemplate(t));
  const own = { ...doc, hosts: { ...doc.hosts, shaper: { version: 4, operations: [], regions: {}, nextSeq: 1, listOrder: 'default', stock: { thickness: 19.05, width: 0, height: 0, margin: 12.7 } } } };
  const profile = await createProfile();
  await createNamedDesign(profile, 'shaper', 'Own plan', own);
  const app = await open({ host: 'shaper', profile });
  try { eq(opsNow(), [], '6. a design with its own Shaper part: its (empty) plan, not the template\'s cuts'); } finally { await app.close(); }
}
{ // a template document opened in Sketch Studio: no Shaper (nothing reads the cuts), the drawing and its parameters as declared
  const t = templateById('latch-edge-prep'), doc = muted(() => buildTemplate(t));
  const profile = await createProfile();
  await createNamedDesign(profile, 'sketchstudio', t.name, doc);
  const app = await open({ host: 'sketchstudio', profile });
  try {
    eq(app.state.shapes.length, doc.geometry.shapes.length, '6. Sketch Studio: the drawing');
    eq(app.state.parameters.map((p) => p.name), doc.geometry.parameters.map((p) => p.name), '6. Sketch Studio: its user parameters');
  } finally { await app.close(); }
}

// ---- 7. the start view in Shaper (the sidebar's Templates...): the group on the cards, a preset chip, Open
{
  const profile = await createProfile();
  const app = await open({ host: 'shaper', profile, sidebar: true });
  try {
    const doc = app.document, st = app.state;
    const q = (sel) => doc.querySelector(sel), qa = (sel) => [...doc.querySelectorAll(sel)];
    const pressEl = (sel) => { const e = typeof sel === 'string' ? q(sel) : sel; assert(e, sel + ' not found'); app.press(e); };
    const settle = (ms = 120) => app.pause(ms);
    pressEl('.sk-sidebar-btn'); await settle(); pressEl('[data-action="templates"]'); await settle();
    eq(qa('.sk-tp-card[data-group]').map((c) => [c.dataset.template, c.dataset.group, c.querySelector('.sk-tp-group').textContent]), DOOR_IDS.map((id) => [id, 'Door hardware', 'Door hardware']), '7. the picker lists the group: its six cards say "Door hardware"');
    ok(qa('.sk-tp-card:not([data-group]) .sk-tp-group').length === 0, '7. no other card has a group label');
    pressEl('.sk-tp-card[data-template="latch-edge-prep"]'); await settle();
    const chips = (k) => qa(`.sk-tp-field[data-param="${k}"] .sk-tp-preset`);
    eq(chips('backset').map((b) => [b.textContent, b.title, b.getAttribute('aria-pressed')]), [['60.3 (2-3/8")', '2-3/8 in = 60.3 mm, residential', 'true'], ['69.9 (2-3/4")', '2-3/4 in = 69.9 mm, commercial', 'false']], '7. a mm document: the backset chips show the metric equivalents, the default pressed');
    eq(qa('.sk-tp-field[data-param="faceplateHeight"] .sk-tp-preset').length, 0, '7. a single standard size: no chips');
    pressEl(chips('backset')[1]); await settle();
    pressEl(chips('edgeBore')[1]); await settle();
    eq([chips('backset').map((b) => b.getAttribute('aria-pressed')), q('.sk-tp-field[data-param="edgeBore"] input').value], [['false', 'true'], '22.225'], '7. a chip press sets its field (7/8 in = 22.225 mm)');
    pressEl('.sk-tp-open'); await settle(400);
    eq(q('.sk-tp-panel'), null, '7. Open closed the modal');
    eq(st.parameters.find((p) => p.name === 'edge_bore').expression, '22.225 mm', '7. the edge bore is 7/8 in exactly (a user parameter)');
    const bore = st.shapes.find((s) => s.type === 'circle');
    near(bore.radius, 22.225 / 2, '7. the drawn edge bore');
    eq(sortOps(opsNow()), sortOps([{ type: 'pocket', depth: 69.85, kinds: ['loop'] }, { type: 'pocket', depth: 3.175, kinds: ['loop'] }, { type: 'guide', depth: 'unset', kinds: ['chain', 'chain'] }]),
      '7. Shaper has the operations ready: the edge bore Pocket 2-3/4 in deep (the backset chip), the faceplate Pocket 1/8 in, the faces Guide');
  } finally { await app.close(); }
}
console.log(`door-hardware-843-node: ${door.length} templates, ${checks} checks ok`);
