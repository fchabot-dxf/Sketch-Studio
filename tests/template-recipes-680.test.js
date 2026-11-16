// tests/template-recipes-680.test.js -- TASK 680: templates are built with the APP'S OWN TOOLS (owner turn 1734).
//   1. the Dimension tool places horizontal / vertical dimensions like Fusion (#core/dim-label.js detectDimMode, advisor ruling): a level or plumb
//      pair is a horizontal / vertical dimension wherever its label is dropped; a near-axis pair (within ~5 degrees) is horizontal / vertical with
//      the label beside it; a clearly diagonal pair is aligned only with the label in its perpendicular band; past the ends: horizontal /
//      vertical by the pull
//   2. the box frame (built by its recipe, so with the Dimension tool's own dimensions) does not fold: length 1500 -> 600 through the parameter,
//      both layouts, V-Through and H-Through (the task 680 STOP case: the top end board sat at 600 / 618), and its level / plumb dimensions are
//      signed horizontal / vertical ones
//   3. the structure is the tools': the rounded rectangle = the Rect tool's lines and rules + 4 Fillet tool arcs, each with its OWN radius
//      dimension `radius` and no equal rule between arcs (owner turns 1735-1742); the dog-bone's reliefs each their own radius dimension; the slot
//      is the Slot tool's; the hexagon the Polygon tool's; every closed outline is the Line tool's (each corner = two joints and a coincident);
//      templates.js has no hand-rolled sketch builder left; the audit harness (tests/harness/audit/lib.js) draws with the same operations
//   4. the start view: a value set the tools cannot draw shows why, keeps the last good preview and disables Open (no uncaught error); a
//      keystroke never rebuilds the template (the preview is built once the values settle), the picker opens without building every card
import assert from 'node:assert';
import fs from 'node:fs';
import * as L from './harness/audit/lib.js';
import * as ops from '#core/tool-ops.js';
import { TEMPLATES, buildTemplate, templateById } from '#core/templates.js';
import { detectDimMode } from '#core/dim-label.js';
import { deserializeDocument } from '#core/document.js';
import { planChange } from '#core/parameters.js';
import { applyParameterChange } from '#core/dimension-seams.js';
import { open, createProfile } from './helpers/node-app.js';

const muted = (f) => { const l = console.log, w = console.warn, e = console.error, d = console.debug; console.log = console.warn = console.error = console.debug = () => {}; try { return f(); } finally { console.log = l; console.warn = w; console.error = e; console.debug = d; } };
let checks = 0;

// ---- 1. the Dimension tool's mode rule (world coordinates, Y down)
{
  const P = (x, y) => ({ x, y });
  const level = [P(0, 0), P(10, 0)], plumb = [P(0, 0), P(0, 10)], nearLevel = [P(0, 0), P(10, 0.5)], nearPlumb = [P(0, 0), P(0.5, 10)], diagonal = [P(0, 0), P(10, 6)];
  const cases = [
    // [pair, label point, mode, why]
    [level, P(5, -5), 'horizontal', 'level pair, label above'], [level, P(5, 5), 'horizontal', 'level pair, label below'],
    [level, P(20, 0), 'horizontal', 'level pair, label beside (past its end): never the zero vertical one'], [level, P(-10, 2), 'horizontal', 'level pair, label past its start'],
    [plumb, P(5, 5), 'vertical', 'plumb pair, label beside'], [plumb, P(0, 25), 'vertical', 'plumb pair, label past its end'], [plumb, P(-8, 3), 'vertical', 'plumb pair, label on the other side'],
    [nearLevel, P(5, -6), 'horizontal', 'near-level pair, label above'], [nearLevel, P(25, 1), 'vertical', 'near-level pair, label beside past its end'],
    [nearPlumb, P(6, 5), 'vertical', 'near-plumb pair, label beside'], [nearPlumb, P(1, 25), 'horizontal', 'near-plumb pair, label past its end along it'],
    [diagonal, P(5, -5), 'aligned', 'diagonal pair, label in its perpendicular band'], [diagonal, P(20, 0), 'vertical', 'diagonal pair, pulled sideways past its end'],
    [diagonal, P(20, 30), 'horizontal', 'diagonal pair, pulled along y past its end'],
  ];
  for (const [[a, b], w, mode, why] of cases) { assert.strictEqual(detectDimMode(a, b, w), mode, `detectDimMode: ${why}`); checks++; }
  // through the real placement (createConstraint + updateConstraintOffset): a level line's dimension is a signed horizontal one
  const st = ops.newSketchState();
  const [seg] = ops.polyline(st, [[0, 0], [40, 0]], false);
  const c = muted(() => ops.dimension(st, { joints: [seg.a, seg.b] }, { x: 20, y: -10 }, '40'));
  assert.strictEqual(c.dimMode, 'horizontal', 'the Dimension tool on a level line: a horizontal dimension');
  muted(() => st.engine.solve(200));
  assert.ok(c.dimSign === 1 || c.dimSign === -1, 'and the solver locked its sign (signed: the second point cannot cross the first)');
  checks += 2;
}

// ---- 2. the box frame does not fold (its dimensions are the Dimension tool's)
const openDoc = (t, params = {}) => {
  const S = L.newSketch();
  const res = muted(() => deserializeDocument(JSON.parse(JSON.stringify(buildTemplate(t, params))), S.state));
  assert.ok(res.ok, `${t.id}: loads`);
  muted(() => S.engine.solve(L.ITER));
  return S;
};
{
  const t = templateById('box-frame');
  for (const layout of ['Vertical', 'Horizontal']) for (const joint of ['V-Through', 'H-Through']) {
    const S = openDoc(t, { layout, joint }), m = `box frame ${layout} ${joint}`;
    const dims = S.state.constraints.filter((c) => c.type === 'distance' && c.joints && c.joints.length === 2);
    assert.strictEqual(dims.length, 14, `${m}: 14 dimensions`);
    for (const c of dims) assert.ok((c.dimMode === 'horizontal' || c.dimMode === 'vertical') && (c.dimSign === 1 || c.dimSign === -1), `${m}: ${c.name} (${c.expression}) is a signed horizontal / vertical dimension (${c.dimMode})`);
    const plan = planChange(S.state, { type: 'setParameter', name: 'length', text: '600 mm' });
    assert.ok(muted(() => applyParameterChange(S.state, plan, 'change parameter')).ok, `${m}: length 600 applied`);
    muted(() => S.engine.solve(L.ITER));
    const H = layout === 'Horizontal', R = (v) => Math.round(v * 1e3) / 1e3 || 0;
    const pts = [...S.state.joints.values()].map((j) => ({ along: R(H ? j.x : -j.y), side: R(H ? -j.y : j.x) }));
    const want = [0, 18, 116.4, 134.4, 232.8, 250.8, 349.2, 367.2, 465.6, 483.6, 582, 600]; // the boards' edges at 600 (5 compartments, 18 thick)
    const levels = [...new Set(pts.map((p) => p.along))].sort((a, b) => a - b);
    assert.deepStrictEqual(levels, want, `${m}: length 1500 -> 600: every point on a board edge, the top board 582 .. 600 (not 600 .. 618: no fold)`);
    assert.ok(Math.max(...pts.map((p) => p.along)) < 600 + 1e-6, `${m}: nothing above the top edge`);
    assert.strictEqual(L.nullity(S), 0, `${m}: 0 DOF after the edit`);
    checks += 4;
  }
}

// ---- 3. the structure is the tools'
const docOf = (id, p) => buildTemplate(templateById(id), p).geometry;
{
  const g = docOf('rounded-rectangle');
  const lines = g.shapes.filter((s) => s.type === 'line' && !s.isConstruction), arcs = g.shapes.filter((s) => s.type === 'arc');
  assert.strictEqual(lines.length, 4, 'rounded rectangle: 4 lines');
  assert.ok(lines.every((s) => /^rect_/.test(s.groupId) && s.groupId === lines[0].groupId), 'rounded rectangle: the 4 lines are ONE Rect tool rectangle (its group)');
  assert.strictEqual(g.constraints.filter((c) => c.type === 'horizontal' || c.type === 'vertical').length, 4, "rounded rectangle: the Rect tool's 4 horizontal / vertical rules");
  assert.strictEqual(arcs.length, 4, 'rounded rectangle: 4 arcs');
  assert.ok(arcs.every((a) => a.filletSharp), 'rounded rectangle: each arc is a Fillet tool fillet (its virtual sharp corner)');
  const radii = g.constraints.filter((c) => c.type === 'distance' && c.isRadius);
  assert.deepStrictEqual(radii.map((c) => c.expression), ['radius', 'radius', 'radius', 'radius'], 'rounded rectangle: 4 radius dimensions, each `radius`');
  assert.strictEqual(new Set(radii.map((c) => c.shape)).size, 4, 'rounded rectangle: one radius dimension per fillet');
  const arcIds = new Set(arcs.map((a) => a.id));
  assert.ok(!g.constraints.some((c) => c.type === 'equal' && c.shapes && c.shapes.every((s) => arcIds.has(s))), 'rounded rectangle: no equal rule between arcs');
  assert.strictEqual(g.constraints.filter((c) => c.type === 'tangent').length, 8, 'rounded rectangle: the fillets\' 8 tangents');
  checks += 9;
}
{
  const g = docOf('dog-bone-pocket');
  const radii = g.constraints.filter((c) => c.type === 'distance' && c.isRadius);
  assert.strictEqual(radii.length, 4, 'dog-bone: each relief its own radius dimension');
  assert.ok(radii.every((c) => c.expression === 'bit_diameter / 2'), 'dog-bone: each reads bit_diameter / 2');
  const arcIds = new Set(g.shapes.filter((s) => s.type === 'arc').map((s) => s.id));
  assert.ok(!g.constraints.some((c) => c.type === 'equal' && c.shapes && c.shapes.every((s) => arcIds.has(s))), 'dog-bone: no equal rule between arcs');
  checks += 3;
}
{
  const slot = docOf('slot');
  assert.ok(slot.shapes.length === 5 && slot.shapes.filter((s) => s.type === 'line').every((s) => /^s_slot_/.test(s.id)) && slot.shapes.filter((s) => s.type === 'arc').length === 2, 'slot: the Slot tool\'s two lines, two arcs and centre line');
  assert.ok(slot.constraints.some((c) => c.isRadius && c.isDiameter && c.expression === 'width'), "slot: the Slot tool's own width dimension, `width` typed in it");
  const hex = docOf('hexagon');
  assert.ok(hex.shapes.filter((s) => !s.isConstruction).every((s) => /^poly_/.test(s.groupId)), 'hexagon: the Polygon tool\'s polygon');
  checks += 3;
}
// every closed outline drawn with the Line tool: the ends of two consecutive segments are two joints tied by a coincident (never one shared joint)
for (const id of ['star', 'arrow', 'l-bracket', 't-slot', 'butterfly-key', 'stair-stringer']) {
  const g = docOf(id), solid = g.shapes.filter((s) => s.type === 'line' && !s.isConstruction);
  const uses = new Map();
  for (const s of solid) for (const j of s.joints) uses.set(j, (uses.get(j) || 0) + 1);
  assert.ok([...uses.values()].every((n) => n === 1), `${id}: every Line tool segment owns its two joints`);
  const coincident = g.constraints.filter((c) => c.type === 'coincident');
  assert.ok(coincident.length >= solid.length, `${id}: its corners are coincidents (${coincident.length} for ${solid.length} segments)`);
  checks += 2;
}
{
  const src = fs.readFileSync(new URL('../packages/core/templates.js', import.meta.url), 'utf8');
  assert.ok(!/function sketcher\b/.test(src), 'templates.js: no hand-rolled sketch builder');
  assert.ok(!/(shapes|constraints)\.push\(/.test(src), 'templates.js: no shape or constraint pushed by hand (only the tool operations make them)');
  const lib = fs.readFileSync(new URL('./harness/audit/lib.js', import.meta.url), 'utf8');
  assert.ok(/from '#core\/tool-ops\.js'/.test(lib) && !/makeRectFromTwoJoints|applyFillet|makePolygon|makeArc/.test(lib), "the audit harness draws with #core/tool-ops.js (one copy of the tools' operations)");
  for (const t of TEMPLATES) assert.ok(muted(() => buildTemplate(t)).geometry.shapes.length > 0, `${t.id}: built by its recipe`);
  checks += 3 + TEMPLATES.length;
}

// ---- 4. the start view (Shaper's Design tab, the shared sidebar, as tests/template-start-670-node.test.js)
const profile = await createProfile();
const app = await open({ host: 'shaper', profile, sidebar: true });
try {
  const doc = app.document;
  const q = (sel) => doc.querySelector(sel);
  const pressEl = (sel) => { const e = typeof sel === 'string' ? q(sel) : sel; assert(e, sel + ' not found'); app.press(e); };
  const settle = (ms = 120) => app.pause(ms);
  const openSidebar = async () => { pressEl('.sk-sidebar-btn'); await settle(); };
  // the picker opens without building every card first (each card's preview comes after, one per task)
  await openSidebar();
  const t0 = performance.now(); pressEl('[data-action="templates"]'); const openMs = performance.now() - t0;
  assert.ok(q('.sk-tp-panel'), 'the template modal is open');
  const drawn = () => [...doc.querySelectorAll('.sk-tp-card[data-template]:not([data-template="blank"])')].filter((c) => c.querySelector('.sk-tp-prev svg')).length;
  assert.ok(drawn() < TEMPLATES.length, `the modal shows before every card's preview is built (${drawn()} of ${TEMPLATES.length} at once)`);
  for (let i = 0; i < 200 && drawn() < TEMPLATES.length; i++) await settle(50);
  assert.strictEqual(drawn(), TEMPLATES.length, 'then every card gets its preview');
  console.log(`template-recipes-680: the picker opened in ${openMs.toFixed(1)} ms (happy-dom)`);
  checks += 3;

  // a value the tools cannot draw: the reason, the last good preview, Open disabled; then a good value: preview and Open back
  pressEl('.sk-tp-card[data-template="box-frame"]'); await settle();
  const before = q('.sk-tp-start .sk-tp-prev svg');
  assert.ok(before, 'box frame: its preview at the defaults');
  const count = q('.sk-tp-field[data-param="compartments"] input');
  count.focus(); count.value = ''; app.type('100'); await settle(400);
  assert.match(q('.sk-tp-err').textContent, /cannot be drawn with these values/, 'box frame, 100 compartments (boards thicker than the length): the reason is shown');
  assert.strictEqual(q('.sk-tp-start .sk-tp-prev svg'), before, 'the last good preview stays');
  assert.ok(q('.sk-tp-open').disabled, 'Open is disabled');
  app.key('Enter'); await settle(200);
  assert.ok(q('.sk-tp-start'), 'Enter does not open what cannot be drawn');
  count.focus(); count.value = ''; app.type('4'); await settle(400);
  assert.strictEqual(q('.sk-tp-err').textContent, '', 'a value set that draws: the reason goes');
  assert.ok(!q('.sk-tp-open').disabled, 'Open is enabled again');
  assert.notStrictEqual(q('.sk-tp-start .sk-tp-prev svg'), before, 'the preview shows the new values');
  checks += 7;
  pressEl('.sk-tp-cancel'); await settle();

  // a keystroke never rebuilds the template: typing 40 slats into the curved bench seat takes no build time; the preview follows once settled
  pressEl('.sk-tp-card[data-template="curved-bench-seat"]'); await settle();
  const slats = q('.sk-tp-field[data-param="slats"] input');
  slats.focus(); slats.value = '';
  const k0 = performance.now(); app.type('40'); const typeMs = performance.now() - k0;
  console.log(`template-recipes-680: typing "40" slats took ${typeMs.toFixed(1)} ms (2 keystrokes)`);
  assert.ok(typeMs < 200, `two keystrokes in the bench seat's slats box take under 100 ms each (${typeMs.toFixed(1)} ms)`);
  checks++;
  pressEl('.sk-tp-cancel'); await settle();
  app.key('Escape'); await settle();
  console.log(`template-recipes-680: ${checks} checks ok`);
} finally { await app.close(); }
