// tests/reference-lines-glyph-node.test.js — TASK 580 (node port of tests/reference-lines-glyph-live-{a,b,c}.test.js = reference-lines-glyph-live-runner.js,
// TASK 539), SketchStudio through tests/helpers/node-app.js: a constraint on an axis shows its usual glyph next to the real line, and nothing but the
// glyph is drawn for it. Every scenario starts on a fresh named design (a fresh page): draw, constrain against an axis, then
//   exactly one glyph (on the real line, none on the axis; a point-on-line glyph is hidden by design until its joint is selected, so no glyph is
//   asserted for 'point on'), the axis is not left lit, and the STORED design has a constraint against ref_axis.
// The dimension tool: the second pick may be an axis (point-line distance j_ref_x / j_ref_y); a FIRST pick near an axis picks nothing.
// The screenshots of the glyphs (evidence, no assert) are not taken.
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { boxOpen } from './helpers/node-dom-read.js';

const fresh = async () => { const profile = await createProfile(); await createNamedDesign(profile, 'sketchstudio'); const app = await open({ host: 'sketchstudio', profile }); return { app, o: app.toScreen(0, 0) }; };
const stored = async (app) => { const d = (await app.storedDoc()).geometry; return { shapes: d.shapes, constraints: d.constraints, joints: d.joints }; };
const lit = (app, axis) => app.document.querySelectorAll(`[data-ref-axis${axis ? `="${axis}"` : ''}]`).length;
const glyphs = (app) => app.document.querySelectorAll('.constraint-glyph').length;
const drawLine = (app, o) => { app.tool('line'); app.click(o.x + 200, o.y - 150); app.click(o.x + 380, o.y - 60); app.esc(); };
const scenarios = {
  'parallel X': (app, o) => { drawLine(app, o); app.tool('parallel'); app.click(o.x + 290, o.y - 105); app.click(o.x + 250, o.y + 3); },
  'parallel Y': (app, o) => { drawLine(app, o); app.tool('parallel'); app.click(o.x + 290, o.y - 105); app.click(o.x + 3, o.y - 300); },
  'perpendicular X': (app, o) => { drawLine(app, o); app.tool('perp'); app.click(o.x + 290, o.y - 105); app.click(o.x + 250, o.y + 3); },
  'perpendicular Y': (app, o) => { drawLine(app, o); app.tool('perp'); app.click(o.x + 290, o.y - 105); app.click(o.x + 3, o.y - 300); },
  'collinear X': (app, o) => { drawLine(app, o); app.tool('collinear'); app.click(o.x + 290, o.y - 105); app.click(o.x + 250, o.y + 3); },
  'collinear Y': (app, o) => { drawLine(app, o); app.tool('collinear'); app.click(o.x + 290, o.y - 105); app.click(o.x + 3, o.y - 300); },
  'point on X': (app, o) => { drawLine(app, o); app.tool('coincident'); app.click(o.x + 200, o.y - 150); app.click(o.x + 250, o.y + 3); },
  'point on Y': (app, o) => { drawLine(app, o); app.tool('coincident'); app.click(o.x + 380, o.y - 60); app.click(o.x + 3, o.y - 300); },
  'tangent X': (app, o) => { app.tool('circle'); app.click(o.x + 300, o.y - 100); app.click(o.x + 350, o.y - 100); app.esc(); app.tool('tangent'); app.click(o.x + 300, o.y - 150); app.click(o.x + 250, o.y + 3); },
  'tangent Y': (app, o) => { app.tool('circle'); app.click(o.x + 300, o.y - 100); app.click(o.x + 350, o.y - 100); app.esc(); app.tool('tangent'); app.click(o.x + 300, o.y - 150); app.click(o.x + 3, o.y - 300); },
};
for (const [name, run] of Object.entries(scenarios)) {
  const { app, o } = await fresh();
  try {
    run(app, o);
    app.tool('select'); app.move(o.x + 700, o.y + 300);
    const g = glyphs(app);
    if (!name.startsWith('point on')) assert(g === 1, name + ': exactly one glyph (on the real line, none on the axis); got ' + g);
    assert(lit(app) === 0, name + ': the axis is not left lit');
    const d = await stored(app);
    assert(d.constraints.some((c) => JSON.stringify(c).includes('ref_axis')), name + ': stored against an axis: ' + JSON.stringify(d.constraints));
    console.log(name.padEnd(18), 'glyphs', g, 'constraints', d.constraints.map((c) => c.type).join(','));
  } finally { await app.close(); }
}
const dimScenarios = {
  'dimension point-X': { run: (app, o) => { drawLine(app, o); app.tool('dim'); app.click(o.x + 200, o.y - 150); app.click(o.x + 250, o.y + 3); }, want: (c) => c.type === 'distance' && (c.joints || []).includes('j_ref_x') },
  'dimension point-Y': { run: (app, o) => { drawLine(app, o); app.tool('dim'); app.click(o.x + 380, o.y - 60); app.click(o.x + 3, o.y - 300); }, want: (c) => c.type === 'distance' && (c.joints || []).includes('j_ref_y') },
};
for (const [name, sc] of Object.entries(dimScenarios)) {
  const { app, o } = await fresh();
  try {
    sc.run(app, o);
    app.click(o.x + 330, o.y - 30); // drop the label, accept the value
    await app.waitFor(() => boxOpen(app) && app.document.activeElement && app.document.activeElement.id === 'dimInput', 'the dimension value input to open and take the focus (its requestAnimationFrame)'); app.enter();
    const label = app.document.querySelectorAll('.dim-label').length;
    assert(label >= 1, name + ': the dimension label is drawn; got ' + label);
    app.esc(); app.tool('select');
    const d = await stored(app);
    assert(d.constraints.some(sc.want), name + ': stored: ' + JSON.stringify(d.constraints));
    assert(d.shapes.length === 1, name + ': the axis is not a shape');
    console.log(name.padEnd(20), 'labels', label, d.constraints.map((c) => c.type).join(','));
  } finally { await app.close(); }
}
{ // a FIRST dimension click on an axis picks nothing (no axis dimension is started)
  const { app, o } = await fresh();
  try {
    drawLine(app, o); app.tool('dim'); app.click(o.x + 250, o.y + 3);
    assert(lit(app) === 0, 'dimension: the first click near an axis does not light or pick it');
    app.esc(); app.tool('select');
    const d = await stored(app);
    assert(!d.constraints.some((c) => JSON.stringify(c).includes('ref_')), 'no axis dimension from a first click');
  } finally { await app.close(); }
}
console.log('reference-lines-glyph-node: ok');
