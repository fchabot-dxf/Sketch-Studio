// tests/template-start-670-node.test.js -- TASK 670 (node half of tests/template-start-670-live.test.js): the template START view in the template modal,
// through the shared sidebar of Shaper's Design tab (tests/helpers/node-app.js open({ sidebar: true })).
//   - every template: a press on its card shows ONE start view built from its declared params (a row per param: label + value box prefilled
//     with the default + unit; a count a whole-number spinner; a choice a glyph picker); Open right away = the template at its defaults
//   - the glyph picker (frame-calc's CornerJointPicker interaction): collapsed = only the active option; a press expands it to all; a pick
//     selects and collapses; each option named (aria-label); the corner joint's three and the box frame's two layouts
//   - values typed here build the drawing and become its user parameters; a refused value (#core/templates.js paramRefusal) keeps the view
//     open with the reason and the box marked; Enter in a value box opens
import assert from 'node:assert';
import { open, createProfile } from './helpers/node-app.js';
import { TEMPLATES, buildTemplate, paramKind, paramUnit, templateById, templateCorners } from '#core/templates.js';
import { buildParameterRows } from '#ui/parameter-table.js';

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
  const visibleChoices = (param) => qa(`.sk-tp-field[data-param="${param}"] .sk-tp-choice button`).filter((b) => !b.hidden);
  const typeInto = (input, text) => { input.focus(); input.value = ''; app.type(text); };

  // ---- every template: one start view from its declared params; Open right away = its defaults
  for (const t of TEMPLATES) {
    await startOf(t.id);
    const rows = qa('.sk-tp-field');
    // TASK 674: a choice the preview's corners carry (not a per-corner one) is picked on the preview only: no row
    const onPreview = new Set(templateCorners(t).filter((c) => !t.params[c.param].perCorner).map((c) => c.param));
    assert.deepStrictEqual(rows.map((r) => r.dataset.param), Object.keys(t.params).filter((k) => !onPreview.has(k)), `${t.id}: a row per param, in order (none for a joint on the preview)`);
    for (const [k, spec] of Object.entries(t.params)) {
      if (onPreview.has(k)) { assert.ok(q(`.sk-tp-corners .sk-tp-corner[data-param="${k}"]`), `${t.id}: ${k} picked on the preview`); continue; }
      const row = q(`.sk-tp-field[data-param="${k}"]`);
      assert.ok(row.textContent.includes(spec.label), `${t.id}: ${k} shows its label`);
      if (paramKind(spec) === 'choice') {
        const bs = visibleChoices(k);
        assert.strictEqual(bs.length, 1, `${t.id}: ${k} collapsed shows only the active option`);
        assert.strictEqual(bs[0].dataset.value, spec.default, `${t.id}: ${k} shows its default`);
        assert.ok(bs[0].querySelector('svg polygon'), `${t.id}: ${k} is drawn as a glyph`);
        continue;
      }
      const input = row.querySelector('input');
      assert.ok(input && input.type === (paramKind(spec) === 'count' ? 'number' : 'text') && input.value === String(spec.default), `${t.id}: ${k} prefilled with ${spec.default}`);
      assert.strictEqual(row.querySelector('label').htmlFor, input.id, `${t.id}: ${k}'s label names its box`);
      assert.strictEqual(row.querySelector('.sk-tp-unit').textContent, paramUnit(spec), `${t.id}: ${k} unit`);
      if (paramKind(spec) === 'count') assert.ok(input.step === '1' && input.min === String(spec.min) && input.max === String(spec.max), `${t.id}: ${k} a whole-number spinner ${spec.min}..${spec.max}`);
    }
    assert.ok(q('.sk-tp-start .sk-tp-prev svg'), `${t.id}: a preview`);
    pressEl('.sk-tp-open'); await settle(400);
    await dontSave();
    assert.strictEqual(q('.sk-tp-panel'), null, `${t.id}: Open closed the modal`);
    const want = buildTemplate(t).geometry;
    assert.strictEqual(st.shapes.length, want.shapes.length, `${t.id}: Open right away = the template at its defaults`);
    assert.deepStrictEqual(st.parameters.map((p) => p.name), want.parameters.map((p) => p.name), `${t.id}: its user parameters`);
  }

  // ---- the corner joint glyph picker (TASK 674: on the preview, the corner's own picker)
  const cornerChoices = (param) => qa(`.sk-tp-corners .sk-tp-corner[data-param="${param}"] button`).filter((b) => !b.hidden);
  await startOf('right-angle-corner');
  let bs = cornerChoices('joint');
  assert.deepStrictEqual(bs.map((b) => [b.dataset.value, b.getAttribute('aria-label'), b.getAttribute('aria-pressed')]), [['H-Through', 'Horizontal through', 'true']], 'collapsed: the active joint only');
  pressEl(bs[0]); await settle();
  bs = cornerChoices('joint');
  assert.deepStrictEqual(bs.map((b) => b.getAttribute('aria-label')), ['Vertical through', 'Horizontal through', 'Mitered'], 'a press expands it to the 3 joints, each named');
  assert.ok(bs.every((b) => b.querySelectorAll('svg polygon').length === 2), 'each joint glyph: two board polygons');
  assert.ok(bs.find((b) => b.dataset.value === 'H-Through').querySelector('svg.sk-tp-glyph-active'), 'the active one is coloured active');
  pressEl(bs.find((b) => b.dataset.value === 'Miter')); await settle();
  bs = cornerChoices('joint');
  assert.deepStrictEqual(bs.map((b) => [b.dataset.value, b.getAttribute('aria-pressed')]), [['Miter', 'true']], 'a pick selects it and collapses');
  assert.ok(q('.sk-tp-panel'), 'picking a joint does not close the modal');
  pressEl('.sk-tp-open'); await settle(400); await dontSave();
  assert.strictEqual(st.shapes.filter((s) => s.type === 'line').length, 7, 'Mitered: 7 lines (the diagonal seam shared)');
  assert.ok(st.shapes.some((s) => { const [a, b] = s.joints.map((id) => st.joints.get(id)); return Math.abs(a.x - b.x) > 1 && Math.abs(a.y - b.y) > 1; }), 'Mitered: the diagonal seam');

  // ---- box frame: the layout picker, typed values, a refused value, Enter
  await startOf('box-frame');
  bs = visibleChoices('layout');
  assert.deepStrictEqual(bs.map((b) => b.getAttribute('aria-label')), ['Vertical layout'], 'layout: Vertical by default');
  pressEl(bs[0]); await settle();
  assert.deepStrictEqual(visibleChoices('layout').map((b) => b.getAttribute('aria-label')), ['Vertical layout', 'Horizontal layout'], 'layout expanded: both, named');
  pressEl(visibleChoices('layout')[1]); await settle();
  assert.deepStrictEqual(visibleChoices('layout').map((b) => b.dataset.value), ['Horizontal'], 'Horizontal picked');
  typeInto(q('.sk-tp-field[data-param="compartments"] input'), '3');
  typeInto(q('.sk-tp-field[data-param="thickness"] input'), '12');
  typeInto(q('.sk-tp-field[data-param="width"] input'), '0');
  pressEl('.sk-tp-open'); await settle();
  assert.ok(q('.sk-tp-start'), 'a refused value: the start view stays');
  assert.strictEqual(q('.sk-tp-err').textContent, 'Width must be a number more than 0', 'the reason is shown');
  assert.strictEqual(q('.sk-tp-field[data-param="width"] input').getAttribute('aria-invalid'), 'true', 'the box is marked');
  assert.strictEqual(doc.activeElement, q('.sk-tp-field[data-param="width"] input'), 'the focus goes to it');
  typeInto(q('.sk-tp-field[data-param="width"] input'), '500');
  assert.strictEqual(q('.sk-tp-err').textContent, '', 'typing clears the reason');
  app.key('Enter'); await settle(400); await dontSave();
  assert.strictEqual(q('.sk-tp-panel'), null, 'Enter in a value box opens');
  assert.deepStrictEqual(st.parameters.map((p) => [p.name, p.expression]), [['length', '1500 mm'], ['width', '500 mm'], ['thickness', '12 mm']], 'the typed lengths are the user parameters');
  const want = buildTemplate(templateById('box-frame'), { compartments: 3, thickness: 12, width: 500, layout: 'Horizontal' }).geometry;
  // TASK 680: a recipe mints new joint ids on every build, so the drawing is compared point by point (every joint, sorted)
  const pts = (list) => list.map(([, j]) => [Math.round(j.x * 1e6) / 1e6 || 0, Math.round(j.y * 1e6) / 1e6 || 0]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  assert.deepStrictEqual(pts([...st.joints]), pts(want.joints), 'the drawing is the box frame built with the typed values, Horizontal, 3 compartments');
  const rows = buildParameterRows(st, { unit: 'mm' });
  assert.deepStrictEqual(rows.user.map((r) => [r.name, r.value, r.unit, r.comment]), [['length', '1500', 'mm', 'Overall length'], ['width', '500', 'mm', 'Width'], ['thickness', '12', 'mm', 'Plywood thickness']], 'the Parameters table rows');
  console.log('template-start-670-node: ok');
} finally { await app.close(); }
