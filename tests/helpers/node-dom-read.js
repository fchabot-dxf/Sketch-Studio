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
