// tests/template-start-674-node.test.js -- TASK 674 (node half of tests/templates-674-live.test.js): the start views of the frame templates, through
// the shared sidebar of Shaper's Design tab (tests/helpers/node-app.js open({ sidebar: true })).
//   - each frame template (polygon / box frame, right-angle brace and corner, trapezoid, parallelogram, triangle) shows a joint glyph picker ON
//     EACH CORNER of its preview (as many as its corners, each bound to its corner's choice); frame-calc's JointPicker interaction there: the
//     corner's joint only, a press expands it, a pick selects and folds back, one corner open at a time; the glyph drawn for that corner
//   - a corner's pick sets only that corner (the per-corner list; Open = the template with that list); the "Corner joint" row then shows the
//     corners differ (no option pressed); a pick on the row sets EVERY corner again
//   - the polygon frame's sides change: the corner list follows (picked corners kept, new ones take the option last set for all)
//   - (owner: "joint type on the preview directly like in frame calc") a choice the preview's corners carry has NO form row: the brace's, the
//     triangle's and the right-angle corner's joints are picked on the preview only; the per-corner frames keep their one "Corner joint" row
//   - the trapezoid's shape picker (frame-calc's four variants); the left setback row only for Scalene, and a user parameter then
//   - a template without corners keeps the small start view (no corner pickers)
import assert from 'node:assert';
import { open, createProfile } from './helpers/node-app.js';
import { buildTemplate, templateById, templateCorners } from '#core/templates.js';

const profile = await createProfile();
const app = await open({ host: 'shaper', profile, sidebar: true });
try {
  const doc = app.document, st = app.state;
  const q = (sel) => doc.querySelector(sel);
  const qa = (sel) => [...doc.querySelectorAll(sel)];
  const pressEl = (sel) => { const e = typeof sel === 'string' ? q(sel) : sel; assert(e, sel + ' not found'); app.press(e); };
  const settle = (ms = 120) => app.pause(ms);
  const openModal = async () => { pressEl('.sk-sidebar-btn'); await settle(); pressEl('[data-action="templates"]'); await settle(); };
  const dontSave = async () => { const b = qa('.sk-tp-backdrop [role="dialog"] button').find((x) => /Don.t save/.test(x.textContent)); if (b) { app.press(b); await settle(400); } };
  const startOf = async (id) => { await openModal(); pressEl(`.sk-tp-card[data-template="${id}"]`); await settle(); assert(q(`.sk-tp-start[data-template="${id}"]`), `${id}: the start view`); };
  const corners = () => qa('.sk-tp-corners .sk-tp-corner');
  const cornerOf = (param, index) => corners().find((c) => c.dataset.param === param && (index == null || c.dataset.corner === String(index)));
  const shown = (el) => [...el.querySelectorAll('button')].filter((b) => !b.hidden);
  const shownValues = (el) => shown(el).map((b) => b.dataset.value);
  const pressed = (el) => [...el.querySelectorAll('button[aria-pressed="true"]')].map((b) => b.dataset.value);
  const row = (param) => q(`.sk-tp-field[data-param="${param}"] .sk-tp-choice`);
  const pickOn = async (el, value) => { app.press(shown(el)[0]); await settle(); app.press(shown(el).find((b) => b.dataset.value === value)); await settle(); };
  const typeInto = (input, text) => { input.focus(); input.value = ''; app.type(text); };
  const pts = (list) => list.map(([, j]) => [Math.round(j.x * 1e6) / 1e6 || 0, Math.round(j.y * 1e6) / 1e6 || 0]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const openIt = async () => { pressEl('.sk-tp-open'); await settle(400); await dontSave(); assert.strictEqual(q('.sk-tp-panel'), null, 'Open closed the modal'); };
  const sameAs = (t, params, m) => assert.deepStrictEqual(pts([...st.joints]), pts(buildTemplate(t, params).geometry.joints), m);
  const polys = (el) => [...el.querySelectorAll('svg polygon')].map((p) => p.getAttribute('points')).join(' | ');

  // ---- every frame template: a picker on each corner, bound to its corner's choice; the wide start view
  const frames = { 'right-angle-corner': ['joint'], 'right-angle-brace': ['topJoint', 'blJoint', 'brJoint'], 'polygon-frame': Array(6).fill('joint'), 'box-frame': Array(4).fill('joint'),
    'trapezoid-frame': Array(4).fill('joint'), 'parallelogram-frame': Array(4).fill('joint'), 'triangle-frame': ['jointA', 'jointB', 'jointC'] };
  for (const [id, params] of Object.entries(frames)) {
    const t = templateById(id);
    await startOf(id);
    assert.ok(q('.sk-tp-panel').classList.contains('sk-tp-wide'), `${id}: the wide start view`);
    assert.deepStrictEqual(corners().map((c) => c.dataset.param), params, `${id}: a picker on each corner, bound to its choice`);
    const list = templateCorners(t);
    corners().forEach((c, i) => {
      const spec = t.params[c.dataset.param];
      assert.deepStrictEqual(shownValues(c), [spec.default], `${id} corner ${i}: collapsed, its joint (the default) only`);
      assert.deepStrictEqual(pressed(c), [spec.default], `${id} corner ${i}: pressed`);
      assert.strictEqual(c.getAttribute('aria-label'), spec.perCorner ? `${spec.label}, corner ${list[i].index + 1}` : spec.label, `${id} corner ${i}: named`);
      assert.ok(c.querySelector('svg polygon'), `${id} corner ${i}: a glyph`);
    });
    const rows = qa('.sk-tp-field').map((r) => r.dataset.param);
    for (const k of new Set(params)) assert.strictEqual(rows.includes(k), !!t.params[k].perCorner, `${id}: ${k} ${t.params[k].perCorner ? 'keeps its one set-all row' : 'has no form row (picked on the preview only)'}`);
    pressEl('.sk-tp-cancel'); await settle(); pressEl('.sk-tp-x'); await settle();
  }
  await startOf('slot');
  assert.ok(!q('.sk-tp-panel').classList.contains('sk-tp-wide') && corners().length === 0 && !q('.sk-tp-stage'), 'slot: the small start view, no corner pickers');
  pressEl('.sk-tp-cancel'); await settle(); pressEl('.sk-tp-x'); await settle();

  // ---- the trapezoid: the shape picker, the per-corner pick, the row = set all
  const trap = templateById('trapezoid-frame');
  await startOf('trapezoid-frame');
  assert.strictEqual(q('.sk-tp-field[data-param="setbackLeft"]').hidden, true, 'isosceles: no setback row');
  app.press(shown(row('variant'))[0]); await settle();
  assert.deepStrictEqual(shown(row('variant')).map((b) => b.getAttribute('aria-label')), ['Isosceles', 'Right, left corner square', 'Right, right corner square', 'Scalene'], "the trapezoid's shapes (frame-calc's)");
  app.press(shown(row('variant')).find((b) => b.dataset.value === 'scalene')); await settle();
  assert.strictEqual(q('.sk-tp-field[data-param="setbackLeft"]').hidden, false, 'Scalene: the setback row shows');
  assert.strictEqual(q('.sk-tp-field[data-param="setbackLeft"] input').value, '100', 'the setback prefilled');
  // a corner's glyph: the polygon joint glyph for THAT corner (its interior angle, turned out of the drawing): the four differ
  assert.strictEqual(new Set(corners().map(polys)).size, 4, 'each corner its own glyph (its angle, its direction)');
  // one corner open at a time
  app.press(shown(cornerOf('joint', 0))[0]); await settle();
  assert.strictEqual(shown(cornerOf('joint', 0)).length, 3, 'corner 0 expanded: the three joints');
  app.press(shown(cornerOf('joint', 2))[0]); await settle();
  assert.deepStrictEqual([shown(cornerOf('joint', 0)).length, shown(cornerOf('joint', 2)).length], [1, 3], 'opening corner 2 folds corner 0');
  app.press(shown(cornerOf('joint', 2)).find((b) => b.dataset.value === 'CW-Through')); await settle();
  assert.deepStrictEqual(corners().map((c) => shownValues(c)[0]), ['Miter', 'Miter', 'CW-Through', 'Miter'], 'the pick set only corner 2, folded back');
  assert.ok(doc.activeElement && doc.activeElement.closest('.sk-tp-corner') === cornerOf('joint', 2), 'the focus stays on corner 2');
  assert.deepStrictEqual(pressed(row('joint')), [], 'the "Corner joint" row: the corners differ, none pressed');
  assert.strictEqual(row('joint').dataset.mixed, 'true', 'the row is marked mixed');
  await pickOn(cornerOf('joint', 0), 'CCW-Through');
  await openIt();
  sameAs(trap, { variant: 'scalene', joint: ['CCW-Through', 'Miter', 'CW-Through', 'Miter'] }, 'Open = the scalene trapezoid with the corners picked');
  assert.deepStrictEqual(st.parameters.map((p) => [p.name, p.expression]), [['bottom_width', '600 mm'], ['top_width', '300 mm'], ['height', '250 mm'], ['setback_left', '100 mm'], ['thickness', '38 mm']], 'scalene: the setback is a user parameter');
  // the row sets every corner again
  await startOf('trapezoid-frame');
  await pickOn(cornerOf('joint', 1), 'CW-Through');
  await pickOn(row('joint'), 'CCW-Through');
  assert.deepStrictEqual(corners().map((c) => shownValues(c)[0]), ['CCW-Through', 'CCW-Through', 'CCW-Through', 'CCW-Through'], 'the row overwrote every corner');
  assert.deepStrictEqual(pressed(row('joint')), ['CCW-Through'], 'the row: one joint for all again');
  await openIt();
  sameAs(trap, { joint: 'CCW-Through' }, 'Open = every corner Counter-Clockwise Through');

  // ---- the polygon frame: the sides change, the corner list follows
  const poly = templateById('polygon-frame');
  await startOf('polygon-frame');
  await pickOn(row('joint'), 'CW-Through');
  await pickOn(cornerOf('joint', 2), 'Miter');
  typeInto(q('.sk-tp-field[data-param="sides"] input'), '8'); await settle(400);
  assert.strictEqual(corners().length, 8, '8 sides: 8 corner pickers');
  assert.deepStrictEqual(corners().map((c) => shownValues(c)[0]), ['CW-Through', 'CW-Through', 'Miter', 'CW-Through', 'CW-Through', 'CW-Through', 'CW-Through', 'CW-Through'], 'corner 2 kept, the new corners take the joint set for all');
  typeInto(q('.sk-tp-field[data-param="sides"] input'), '5'); await settle(400);
  assert.strictEqual(corners().length, 5, '5 sides: 5 corner pickers');
  await openIt();
  sameAs(poly, { sides: 5, joint: ['CW-Through', 'CW-Through', 'Miter', 'CW-Through', 'CW-Through'] }, 'Open = 5 sides, corner 2 Mitered');

  // ---- the box frame: a corner's pick (its glyph is that corner's: oriented, mirrored by the layout)
  const box = templateById('box-frame');
  await startOf('box-frame');
  assert.strictEqual(new Set(corners().map(polys)).size, 4, 'box: each corner glyph drawn for its own corner');
  await pickOn(cornerOf('joint', 2), 'Miter');
  await pickOn(cornerOf('joint', 0), 'H-Through');
  await openIt();
  sameAs(box, { joint: ['H-Through', 'V-Through', 'Miter', 'V-Through'] }, 'box: Open = bottom-left Horizontal through, top-right Mitered');

  // ---- the brace and the triangle: each corner's joint picked on the preview (no form row)
  const brace = templateById('right-angle-brace');
  await startOf('right-angle-brace');
  assert.deepStrictEqual(qa('.sk-tp-field').map((r) => r.dataset.param), ['width', 'height', 'thickV', 'thickH', 'thickD'], 'brace: the form has the lengths only');
  await pickOn(cornerOf('topJoint'), 'Miter');
  await pickOn(cornerOf('brJoint'), 'D-Through');
  assert.deepStrictEqual([shownValues(cornerOf('topJoint')), shownValues(cornerOf('blJoint')), shownValues(cornerOf('brJoint'))], [['Miter'], ['V-Through'], ['D-Through']], 'brace: the two corners picked, the third unchanged');
  await openIt();
  sameAs(brace, { topJoint: 'Miter', brJoint: 'D-Through' }, 'brace: Open = the two picks');
  const tri = templateById('triangle-frame');
  await startOf('triangle-frame');
  await pickOn(cornerOf('jointA'), 'V-Through');
  await pickOn(cornerOf('jointC'), 'D-Through');
  assert.deepStrictEqual(qa('.sk-tp-field').map((r) => r.dataset.param), ['base', 'leftSide', 'rightSide', 'thickness'], 'triangle: no joint rows');
  assert.deepStrictEqual(corners().map((c) => shownValues(c)[0]), ['V-Through', 'Miter', 'D-Through'], 'triangle: the two corner picks');
  await openIt();
  sameAs(tri, { jointA: 'V-Through', jointC: 'D-Through' }, 'triangle: Open = the two picks');
  assert.deepStrictEqual(st.parameters.map((p) => p.name), ['base', 'left_side', 'right_side', 'thickness'], 'triangle: its user parameters');
  // three sides that make no triangle: the error line, Open disabled, the last good preview kept
  await startOf('triangle-frame');
  const before = q('.sk-tp-start .sk-tp-prev svg');
  typeInto(q('.sk-tp-field[data-param="base"] input'), '1000'); await settle(400);
  assert.match(q('.sk-tp-err').textContent, /Triangle frame cannot be drawn with these values \(these three sides make no triangle/, 'no triangle: the reason');
  assert.ok(q('.sk-tp-open').disabled && q('.sk-tp-start .sk-tp-prev svg') === before && corners().length === 3, 'Open disabled, the last good preview and its corners kept');
  pressEl('.sk-tp-cancel'); await settle(); pressEl('.sk-tp-x'); await settle();
  console.log('template-start-674-node: ok');
} finally { await app.close(); }
