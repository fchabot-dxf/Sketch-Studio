// tests/templates-ui-node.test.js -- TASK 651 / 668 (node half of tests/templates-live.test.js): the template modal through the shared sidebar of Shaper's Design tab
// (tests/helpers/node-app.js open({ sidebar: true })). Templates... and New design open the SAME modal (Blank first, then every template of the bank
// with a drawn SVG preview); a press on a template card shows its start view (TASK 670) whose Open makes the unsaved design named after the template
// holding its shapes and its user parameters; Blank makes the empty design; Esc and the X make no new design; Undo leaves the starting drawing; the preview is generated from the template's own document.
import assert from 'node:assert';
import { open, createProfile } from './helpers/node-app.js';
import { TEMPLATES, buildTemplate } from '#core/templates.js';
import { renderTemplatePreview } from '#ui/template-picker.js';

const profile = await createProfile();
const app = await open({ host: 'shaper', profile, sidebar: true });
try {
  const doc = app.document, st = app.state;
  const q = (sel) => doc.querySelector(sel);
  const qa = (sel) => [...doc.querySelectorAll(sel)];
  const pressEl = (sel) => { const e = q(sel); assert(e, sel + ' not found'); app.press(e); };
  const settle = (ms = 120) => app.pause(ms);
  const openSb = async () => { pressEl('.sk-sidebar-btn'); await settle(); };

  // the preview is SVG built from the document: every template gives a non-empty drawing with its dimension values as text
  for (const t of TEMPLATES) {
    const d = buildTemplate(t);
    const svg = renderTemplatePreview(d);
    assert(svg.querySelectorAll('line, path, circle').length >= 3, `${t.id}: the preview draws geometry`);
    assert.strictEqual(svg.querySelectorAll('text').length, t.dimensions, `${t.id}: the preview shows each of its ${t.dimensions} dimensions`);
  }

  const expectedOrder = ['blank', ...TEMPLATES.map((t) => t.id)];

  // Templates...: Blank first, then every template; Esc closes with nothing changed
  await openSb(); pressEl('[data-action="templates"]'); await settle();
  assert.deepStrictEqual(qa('.sk-tp-card').map((c) => c.dataset.template), expectedOrder, 'Templates...: Blank first, then every template');
  // TASK 680: the cards' previews are built after the modal shows (a recipe takes real time), one card per task: wait until every card has one
  const drawn = () => qa('.sk-tp-card[data-template]:not([data-template="blank"])').every((c) => c.querySelectorAll('svg *').length > 3);
  for (let i = 0; i < 200 && !drawn(); i++) await settle(50);
  assert(qa('.sk-tp-card[data-template]:not([data-template="blank"])').every((c) => c.querySelectorAll('svg *').length > 3 && c.querySelector('.sk-tp-name').textContent && c.querySelector('.sk-tp-desc').textContent), 'every card: a drawn preview, a name, a description');
  app.key('Escape'); await settle();
  assert.strictEqual(q('.sk-tp-panel'), null, 'Esc closes the modal');
  assert.strictEqual(st.shapes.length, 0, 'Esc: nothing was created');

  // TASK 670: a press on a card opens its START view (its params, Open + Cancel); Cancel / Esc go back to the cards; Open opens the defaults
  await openSb(); pressEl('[data-action="templates"]'); await settle();
  pressEl('.sk-tp-card[data-template="hexagon"]'); await settle();
  assert(q('.sk-tp-panel.sk-tp-small .sk-tp-start[data-template="hexagon"]'), 'a card opens the small start view of its template');
  assert.strictEqual(q('.sk-tp-field[data-param="acrossFlats"] input').value, '20', 'the param prefilled with its default');
  assert.strictEqual(doc.activeElement, q('.sk-tp-open'), 'Open has the focus');
  pressEl('.sk-tp-cancel'); await settle();
  assert(q('.sk-tp-card[data-template="hexagon"]') && !q('.sk-tp-start') && q('.sk-tp-panel'), 'Cancel: back to the cards, the modal stays');
  assert.strictEqual(doc.activeElement, q('.sk-tp-card[data-template="hexagon"]'), 'Cancel: the focus is back on the card');
  pressEl('.sk-tp-card[data-template="hexagon"]'); await settle();
  app.key('Escape'); await settle();
  assert(q('.sk-tp-card[data-template="hexagon"]') && !q('.sk-tp-start'), 'Esc in the start view: back to the cards');
  pressEl('.sk-tp-card[data-template="hexagon"]'); await settle();
  pressEl('.sk-tp-open'); await settle(400);
  assert.strictEqual(q('.sk-tp-panel'), null, 'Open closed the modal');
  assert.deepStrictEqual(st.parameters.map((p) => [p.name, p.expression, p.unit, p.comment]), [['across_flats', '20 mm', 'mm', 'Across flats']], 'the template opened with its user parameter');
  assert.strictEqual(st.shapes.length, buildTemplate(TEMPLATES.find((t) => t.id === 'hexagon')).geometry.shapes.length, 'the hexagon is the new design');
  await openSb();
  assert.strictEqual(q('.sk-sidebar-doc').textContent, 'Hexagon', 'the new design is named after the template');
  app.undo(); await settle();
  assert.strictEqual(st.shapes.length, 12, 'Undo on a fresh template design leaves it (the drawing is its starting document)');

  // New design: same modal (Blank first); the X = no new design; Blank = the empty design
  pressEl('[data-action="new-design"]'); await settle();
  assert.deepStrictEqual(qa('.sk-tp-card').map((c) => c.dataset.template), expectedOrder, 'New design: Blank first, then the templates');
  pressEl('.sk-tp-x'); await settle();
  assert.strictEqual(st.shapes.length, 12, 'the X: no new design');
  await openSb(); pressEl('[data-action="new-design"]'); await settle();
  pressEl('.sk-tp-card[data-template="blank"]'); await settle(400);
  // the template design is an unsaved design with content: replacing it asks THE question (Save... / Don't save / Cancel) like any unsaved Untitled
  const dont = qa('.sk-tp-backdrop [role="dialog"] button').find((b) => /Don.t save/.test(b.textContent));
  assert(dont, "the unsaved template design asks Save... / Don't save / Cancel before it is replaced");
  app.press(dont); await settle(400);
  assert.strictEqual(st.shapes.length, 0, 'Blank: the empty design');
  console.log('templates-ui-node: ok');
} finally { await app.close(); }
