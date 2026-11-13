// tests/helpers/node-dom-read.js - TASK 576: what the browser tests read from the rendered canvas (the shape elements the shared renderer
// drew, the dimension labels), read from the same DOM in the node kit. The renderer writes WORLD coordinates into the elements; the browser
// tests mapped them to screen pixels through getScreenCTM(), here through the app's own world -> screen (#ui/coords.js, the svg's viewBox).
import { worldToScreen } from '#ui/coords.js';

export const px = (app, x, y) => { const p = worldToScreen(app.svg, { x, y }); return { x: p.x, y: p.y }; };
/** every drawn line as its two screen-space ends */
export const lines = (app) => [...app.svg.querySelectorAll('line.shape-elem')].map((e) => [px(app, +e.getAttribute('x1'), +e.getAttribute('y1')), px(app, +e.getAttribute('x2'), +e.getAttribute('y2'))]);
/** the dimension labels' text */
export const labels = (app) => [...app.svg.querySelectorAll('.dim-label')].map((e) => e.textContent.trim());
/** the label element of constraint `idx` (the renderer replaces the elements each frame: look it up at each use) */
export const labelEl = (app, idx) => app.svg.querySelector(`.dim-label[data-constraint-idx="${idx}"]`);
/** the screen point of a label (the world position the renderer stored on its constraint) */
export const labelPoint = (app, idx) => { const g = app.state.constraints[idx].glyphPos; const p = px(app, g.x, g.y); return { x: Math.round(p.x), y: Math.round(p.y) }; };
/** the screen point of the first label's centre that matches `pred(text)` (and its constraint index) */
export const findLabel = (app, pred) => {
  for (const g of app.svg.querySelectorAll('.dim-label')) {
    if (!pred(g.textContent.trim())) continue;
    const idx = +g.getAttribute('data-constraint-idx'); return { idx, ...labelPoint(app, idx) };
  }
  return null;
};
/** the dimension value box (#dimInput) is open: shown (not hidden) */
export const boxOpen = (app) => { const i = app.document.getElementById('dimInput'); return !!i && !i.classList.contains('hidden'); };
/** type into #dimInput as a user does (focus, select, set the text, an input event), then Enter */
export const typeValue = async (app, text) => {
  await app.waitFor(() => boxOpen(app), 'the dimension value input to open');
  const i = app.document.getElementById('dimInput');
  i.focus(); i.select(); i.value = text; i.dispatchEvent(new app.window.Event('input', { bubbles: true }));
  app.enter();
};
/** the screen point of a constraint glyph (<g class="constraint-glyph" transform="translate(x,y)">, world units: the renderer places it) */
export const glyphPoint = (app, el) => {
  const m = /translate\(\s*([-\d.e]+)[ ,]+([-\d.e]+)\s*\)/.exec(el.getAttribute('transform') || '');
  if (!m) throw new Error('glyphPoint: the glyph has no translate()');
  const p = px(app, +m[1], +m[2]); return { x: Math.round(p.x), y: Math.round(p.y) };
};
/** the centre of the label's box (<g class="dim-label"><rect/>, as a browser's getBoundingClientRect centre): screen px and the world point it was drawn at */
export const labelBoxCenter = (app, el = app.svg.querySelector('.dim-label')) => {
  const r = el.querySelector('rect'); const w = { x: +r.getAttribute('x') + +r.getAttribute('width') / 2, y: +r.getAttribute('y') + +r.getAttribute('height') / 2 };
  const p = px(app, w.x, w.y); return { idx: +el.getAttribute('data-constraint-idx'), x: Math.round(p.x), y: Math.round(p.y), world: w };
};
