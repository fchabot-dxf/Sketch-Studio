// tests/templates-ui-node.test.js -- TASK 651 (node half of tests/templates-live.test.js): the template modal through the shared sidebar of Shaper's Design tab
// (tests/helpers/node-app.js open({ sidebar: true })). Templates... lists every template of the bank with a drawn SVG preview and no Blank card; a card opens
// the detail view; "Open as new design" makes the unsaved design named after the template holding its shapes; New design offers Blank first and Blank makes the
// empty design; Esc and the X make no new design; Undo leaves the starting drawing; the preview is generated from the template's own document (not an image).
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

  // Templates...: every template, no Blank card, the first card focused; Esc closes with nothing changed
  await openSb(); pressEl('[data-action="templates"]'); await settle();
  assert.deepStrictEqual(qa('.sk-tp-card').map((c) => c.dataset.template), TEMPLATES.map((t) => t.id), 'every template is a card; no Blank card in Templates...');
  assert(qa('.sk-tp-card').every((c) => c.querySelectorAll('svg *').length > 3 && c.querySelector('.sk-tp-name').textContent && c.querySelector('.sk-tp-desc').textContent), 'every card: a drawn preview, a name, a description');
  app.key('Escape'); await settle();
  assert.strictEqual(q('.sk-tp'), null, 'Esc closes the modal');
  assert.strictEqual(st.shapes.length, 0, 'Esc: nothing was created');

  // a card -> the detail view -> Open as new design
  await openSb(); pressEl('[data-action="templates"]'); await settle();
  pressEl('.sk-tp-card[data-template="hexagon"]'); await settle();
  assert(q('.sk-tp-detail'), 'the detail view');
  assert.strictEqual(qa('.sk-tp-detail [data-action="open-template"]').length, 1, 'one primary button');
  pressEl('[data-action="open-template"]'); await settle(400);
  assert.strictEqual(q('.sk-tp'), null, 'the modal closed');
  assert.strictEqual(st.shapes.length, buildTemplate(TEMPLATES.find((t) => t.id === 'hexagon')).geometry.shapes.length, 'the hexagon is the new design');
  await openSb();
  assert.strictEqual(q('.sk-sidebar-doc').textContent, 'Hexagon', 'the new design is named after the template');
  app.undo(); await settle();
  assert.strictEqual(st.shapes.length, 12, 'Undo on a fresh template design leaves it (the drawing is its starting document)');

  // New design: Blank first and focused; the X = no new design; Blank = the empty design
  pressEl('[data-action="new-design"]'); await settle();
  assert.deepStrictEqual(qa('.sk-tp-card').map((c) => c.dataset.template), ['blank', ...TEMPLATES.map((t) => t.id)], 'New design: Blank first, then the templates');
  pressEl('.sk-tp-x'); await settle();
  assert.strictEqual(st.shapes.length, 12, 'the X: no new design');
  await openSb(); pressEl('[data-action="new-design"]'); await settle();
  pressEl('.sk-tp-card[data-template="blank"]'); await settle(400);
  // the template design is an unsaved design with content: replacing it asks THE question (Save... / Don't save / Cancel) like any unsaved Untitled
  const dont = qa('.sk-sidebar-ask button').find((b) => /Don.t save/.test(b.textContent));
  assert(dont, "the unsaved template design asks Save... / Don't save / Cancel before it is replaced");
  app.press(dont); await settle(400);
  assert.strictEqual(st.shapes.length, 0, 'Blank: the empty design');
  console.log('templates-ui-node: ok');
} finally { await app.close(); }
