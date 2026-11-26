// tests/audits/solver-ux-audit-1000-dimensions.mjs -- TASK 1000 (AUDIT, outside the gate; run: node tests/audits/solver-ux-audit-1000-dimensions.mjs)
// DIMENSIONS: a value that cannot solve (negative, zero, too large, a formula naming itself, not a number), what the user sees, whether the
// sketch is left changed, undo after a refused edit, reference dimensions, angle dimensions across 180. Real SketchStudio in Node (the kit).
import { design, openDesign, closeAll, J, dist, snapshot, movedText, residualText, statusText, editDim, editText, dim, row, f, pt, quiet, toasts, clearToasts, theApp } from './solver-ux-audit-1000-kit.js';
import { toggleDriving } from '#core/dimension-seams.js';
import SettingsManager from '#core/settings-manager.js';

const D = (a, b, value, name, extra = {}) => ({ type: 'distance', joints: [a, b], value, name, ...extra });
const H = (a, b) => ({ type: 'horizontal', joints: [a, b] });
const V = (a, b) => ({ type: 'vertical', joints: [a, b] });

// a rectangle 80 x 40, corner a fixed, W = d1, H = d2 (fully constrained)
const RECT = (extra = []) => design(
  { a: [0, 0, true], b: [80, 0], c: [80, 40], d: [0, 40] },
  [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['b', 'c'] }, { id: 'L3', type: 'line', joints: ['c', 'd'] }, { id: 'L4', type: 'line', joints: ['d', 'a'] }],
  [H('a', 'b'), V('b', 'c'), H('c', 'd'), V('d', 'a'), D('a', 'b', 80, 'd1'), D('b', 'c', 40, 'd2'), ...extra]);

async function tryEdit(id, name, text, note = '') {
  const app = theApp(); const before = snapshot(); const v0 = dim(name) && dim(name).value; const e0 = dim(name) && dim(name).expression; const h0 = app.state.history.length;
  const drv0 = dim(name) && !!(dim(name).isDriven || dim(name).driven);
  const r = await editDim(name, text);
  const c = dim(name);
  row(id, `${note}type "${text}" into ${name} (was ${f(v0)}${e0 ? ' = ' + e0 : ''}${drv0 ? ', REFERENCE' : ''}): ${editText(r)}; now value ${c ? f(c.value) : 'GONE'}${c && c.expression ? ' expr "' + c.expression + '"' : ''}${c && (c.isDriven || c.driven) ? ' REFERENCE' : ' driving'}; ${movedText(before)}; ${residualText()}; history ${h0} -> ${app.state.history.length}`);
  return r;
}

await (async () => {
  // ---- D1: the rectangle's width
  let app = await openDesign(RECT(), { centre: { x: 40, y: 20 }, w: 200 });
  row('D1.0', `rect loaded: ${statusText()}; ${residualText()}; labels ${[...app.svg.querySelectorAll('.dim-label')].map((e) => e.textContent.trim()).join(' | ')}`);
  await tryEdit('D1.1', 'd1', '-5');
  await tryEdit('D1.2', 'd1', '0');
  await tryEdit('D1.3', 'd1', 'abc');
  await tryEdit('D1.4', 'd1', 'd1 * 2');
  await tryEdit('D1.5', 'd1', 'd2 * 2');
  await tryEdit('D1.6', 'd2', 'd1 / 2', 'cycle d1 = d2*2, d2 = d1/2: ');
  await tryEdit('D1.7', 'd1', '1e9');
  await tryEdit('D1.8', 'd1', '1000000');
  { const s0 = snapshot(); await quiet(async () => app.undo()); row('D1.9', `Ctrl+Z after the edits above: d1 = ${f(dim('d1').value)}${dim('d1').expression ? ' expr ' + dim('d1').expression : ''}; ${movedText(s0)}; b ${pt(J('b'))}`); }
  await tryEdit('D1.10', 'd1', '0.0001');
  await tryEdit('D1.11', 'd1', '=80');
  await tryEdit('D1.12', 'd1', '80 +');
  await tryEdit('D1.13', 'd1', '80in');

  // ---- D2: a triangle a(fixed) b c, sides d1 = 30 (H), d2 = 40, d3 = 50: a value that breaks the triangle inequality
  app = await openDesign(design({ a: [0, 0, true], b: [30, 0], c: [30, 40] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['b', 'c'] }, { id: 'L3', type: 'line', joints: ['c', 'a'] }],
    [H('a', 'b'), D('a', 'b', 30, 'd1'), D('b', 'c', 40, 'd2'), D('c', 'a', 50, 'd3')]), { centre: { x: 15, y: 20 }, w: 160 });
  row('D2.0', `triangle loaded: ${statusText()}; ${residualText()}`);
  await tryEdit('D2.1', 'd3', '100', 'impossible (30 + 40 < 100): ');
  await tryEdit('D2.2', 'd3', '70', 'degenerate (30 + 40 = 70, flat): ');
  row('D2.2b', `after 70: a ${pt(J('a'))} b ${pt(J('b'))} c ${pt(J('c'))}`);
  await tryEdit('D2.3', 'd3', '69.9', 'nearly flat: ');
  row('D2.3b', `after 69.9: c ${pt(J('c'))} (was above the base: y > 0 expected) ${statusText()}`);
  await tryEdit('D2.4', 'd3', '50', 'back to 50: ');
  row('D2.4b', `after back to 50: c ${pt(J('c'))} (started at (30, 40))`);
  await tryEdit('D2.5', 'd3', '10', 'the other limit (40 - 30 = 10, flat): ');
  row('D2.5b', `after 10: c ${pt(J('c'))}`);
  await tryEdit('D2.6', 'd3', '5', 'below the limit: ');

  // ---- D3: a REFERENCE dimension typed with a value
  // line a(fixed)-b free, d1 = 60 driving, plus the rectangle's diagonal as a reference in D3b
  app = await openDesign(RECT([D('a', 'c', Math.hypot(80, 40), 'd3', { isDriven: true, driven: true })]), { centre: { x: 40, y: 20 }, w: 200 });
  row('D3.0', `rect + reference diagonal d3 loaded: d3 ${f(dim('d3').value)} ${dim('d3').isDriven ? 'REFERENCE' : 'driving'}; ${statusText()}`);
  await tryEdit('D3.1', 'd3', '100', 'a reference the sketch determines: ');
  // a reference that is NOT determined: a free line with a reference length
  app = await openDesign(design({ a: [0, 0, true], b: [60, 10] }, [{ id: 'L1', type: 'line', joints: ['a', 'b'] }], [D('a', 'b', Math.hypot(60, 10), 'd1', { isDriven: true, driven: true })]), { centre: { x: 30, y: 5 }, w: 160 });
  await tryEdit('D3.2', 'd1', '90', 'a reference on a free line, valid value: ');
  app = await openDesign(design({ a: [0, 0, true], b: [60, 10] }, [{ id: 'L1', type: 'line', joints: ['a', 'b'] }], [D('a', 'b', Math.hypot(60, 10), 'd1', { isDriven: true, driven: true })]), { centre: { x: 30, y: 5 }, w: 160 });
  await tryEdit('D3.3', 'd1', '-4', 'a reference on a free line, refused value: ');
  row('D3.3b', `after the refused value the dimension is ${dim('d1').isDriven || dim('d1').driven ? 'still a REFERENCE' : 'now DRIVING'} at ${f(dim('d1').value)} (line length ${f(dist(J('a'), J('b')))})`);

  // ---- D4: an angle dimension across 180. L1 a(fixed) -> b(fixed) along +x, L2 a -> c at 60 degrees, length 50 (d1), angle d2
  const ANG = () => design({ a: [0, 0, true], b: [60, 0, true], c: [25, 43.30127] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['a', 'c'] }],
    [D('a', 'c', 50, 'd1'), { type: 'angle', shapes: ['L1', 'L2'], joints: ['b', 'a', 'c'], value: 60, name: 'd2' }]);
  app = await openDesign(ANG(), { centre: { x: 10, y: 10 }, w: 200 });
  const ang = () => { const c = J('c'); let a = Math.atan2(c.y, c.x) * 180 / Math.PI; return a; };
  row('D4.0', `angle scene loaded: c ${pt(J('c'))} atan2 ${f(ang(), 2)} deg (screen y grows down); d2 ${f(dim('d2').value)} sector ${JSON.stringify(dim('d2').sector)}; ${statusText()}; ${residualText()}`);
  for (const v of ['120', '170', '180', '190', '270', '359', '360', '361', '0', '-30', '60']) {
    await tryEdit('D4.' + v, 'd2', v);
    row('D4.' + v + 'b', `c ${pt(J('c'))} atan2 ${f(ang(), 2)} deg, |ac| ${f(dist(J('a'), J('c')))}; label ${[...theApp().svg.querySelectorAll('.dim-label')].map((e) => e.textContent.trim()).join(' | ')}`);
  }
  // one jump 60 -> 300 and back
  await tryEdit('D4.j1', 'd2', '300'); row('D4.j1b', `c ${pt(J('c'))} atan2 ${f(ang(), 2)}`);
  await tryEdit('D4.j2', 'd2', '60'); row('D4.j2b', `c ${pt(J('c'))} atan2 ${f(ang(), 2)} (started at (25, 43.301))`);

  // ---- D5: driving vs reference toggle through the dimension's context menu is covered by tests; here: a dimension on a line between two FIXED points
  app = await openDesign(design({ a: [0, 0, true], b: [50, 0, true] }, [{ id: 'L1', type: 'line', joints: ['a', 'b'] }], [D('a', 'b', 50, 'd1')]), { centre: { x: 25, y: 0 }, w: 160 });
  row('D5.0', `a driving dimension between two fixed points loaded as: ${dim('d1').isDriven || dim('d1').driven ? 'REFERENCE' : 'driving'} ${f(dim('d1').value)}`);
  await tryEdit('D5.1', 'd1', '70', 'both ends fixed: ');

  // ---- D6: a radius: circle centre fixed, radius 20 (d1); arc
  app = await openDesign(design({ c: [0, 0, true] }, [{ id: 'C1', type: 'circle', joints: ['c'], radius: 20 }], [{ type: 'distance', shape: 'C1', value: 20, isRadius: true, name: 'd1' }]), { centre: { x: 0, y: 0 }, w: 160 });
  await tryEdit('D6.1', 'd1', '-20');
  await tryEdit('D6.2', 'd1', '1e7');
  row('D6.2b', `circle radius now ${f(theApp().state.shapes.find((s) => s.id === 'C1').radius)}`);

  // ---- D7: realistic rectangle shrink (>99%: 500x40 -> 4 mm width): false collapse refusal on opposite edge L3!
  app = await openDesign(design(
    { a: [0, 0, true], b: [500, 0], c: [500, 40], d: [0, 40] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['b', 'c'] }, { id: 'L3', type: 'line', joints: ['c', 'd'] }, { id: 'L4', type: 'line', joints: ['d', 'a'] }],
    [H('a', 'b'), V('b', 'c'), H('c', 'd'), V('d', 'a'), D('a', 'b', 500, 'd1'), D('b', 'c', 40, 'd2')]), { centre: { x: 250, y: 20 }, w: 700 });
  await tryEdit('D7.1', 'd1', '4', '500x40 rect shrunk to 4 mm (<1%): ');
  await tryEdit('D7.2', 'd1', '5', '500x40 rect shrunk to 5 mm (=1%): ');

  // ---- D8: inch document unit refusal toast (raw base mm shown instead of user's inch text)
  app = await openDesign(design({ a: [0, 0, true], b: [30, 0], c: [30, 40] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['b', 'c'] }, { id: 'L3', type: 'line', joints: ['c', 'a'] }],
    [H('a', 'b'), D('a', 'b', 30, 'd1'), D('b', 'c', 40, 'd2'), D('c', 'a', 50, 'd3')]), { centre: { x: 15, y: 20 }, w: 160 });
  SettingsManager.set('DOC_UNIT', 'in', { persist: 'none' });
  await tryEdit('D8.1', 'd3', '100', 'DOC_UNIT=in, type "100" (inches): ');
  await tryEdit('D8.2', 'd3', '-2', 'DOC_UNIT=in, type "-2" (inches): ');
  SettingsManager.set('DOC_UNIT', 'mm', { persist: 'none' });

  // ---- D9: toggleDriving on reference H/V dim on a diagonal line + undoability of toggleDriving
  app = await openDesign(design(
    { a: [0, 0, true], b: [30, 40] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }],
    [D('a', 'b', 30, 'd1', { dimMode: 'horizontal', isDriven: true, driven: true })]), { centre: { x: 15, y: 20 }, w: 160 });
  {
    const before = snapshot(); const c = dim('d1'); const h0 = app.state.history.length;
    const res = toggleDriving(app.state, c);
    row('D9.1', `toggleDriving ref H-dim on diagonal (30,40): res=${JSON.stringify(res)}; d1.value=${f(c.value)} (expected 30, hyp=50); b=${pt(J('b'))}; ${movedText(before)}; ${residualText()}; history ${h0} -> ${app.state.history.length}`);
  }
  app = await openDesign(design(
    { a: [0, 0, true], b: [30, 40] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }],
    [D('a', 'b', 40, 'd1', { dimMode: 'vertical', isDriven: true, driven: true })]), { centre: { x: 15, y: 20 }, w: 160 });
  {
    const before = snapshot(); const c = dim('d1'); const h0 = app.state.history.length;
    const res = toggleDriving(app.state, c);
    row('D9.2', `toggleDriving ref V-dim on diagonal (30,40): res=${JSON.stringify(res)}; d1.value=${f(c.value)} (expected 40, hyp=50); b=${pt(J('b'))}; ${movedText(before)}; ${residualText()}; history ${h0} -> ${app.state.history.length}`);
  }
  // D9.3: toggleDriving on a driving dim with an expression via real context-menu path, then Ctrl+Z
  app = await openDesign(RECT(), { centre: { x: 40, y: 20 }, w: 200 });
  await tryEdit('D9.3a', 'd1', 'd2 * 2', 'give d1 formula first: ');
  {
    const c = dim('d1'); const idx = app.state.constraints.indexOf(c); const p = app.toScreen(c.glyphPos.x, c.glyphPos.y);
    const h0 = app.state.history.length;
    await quiet(async () => {
      app.svg.dispatchEvent(new app.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, button: 2 }));
      await app.pause(30);
      const item = [...app.document.querySelectorAll('.sk-ctx-item, [role="menuitem"]')].find((el) => /Reference dimension/i.test(el.textContent));
      if (item) item.click();
    });
    const afterToggle = { isDriven: !!(c.isDriven || c.driven), expr: c.expression || null, hist: app.state.history.length };
    await quiet(async () => app.undo());
    const afterUndo = { isDriven: !!(dim('d1').isDriven || dim('d1').driven), expr: dim('d1').expression || null, hist: app.state.history.length };
    row('D9.3b', `context-menu Driving->Reference then Undo: h0=${h0}, afterToggle=${JSON.stringify(afterToggle)}, afterUndo=${JSON.stringify(afterUndo)}`);
  }

  // ---- D10: D key preselection on 2 joints that ALREADY have an H dim (cannot add V dim!)
  app = await openDesign(design(
    { a: [0, 0, true], b: [30, 40] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }],
    [D('a', 'b', 30, 'd1', { dimMode: 'horizontal' })]), { centre: { x: 15, y: 20 }, w: 160 });
  {
    clearToasts();
    app.state.selectedJoints.add('a'); app.state.selectedJoints.add('b');
    await quiet(async () => app.key('d'));
    row('D10.1', `preselect 2 joints with existing H-dim, press D: tool=${app.state.currentTool}, constraints=${app.state.constraints.length}, toasts=${JSON.stringify(toasts())}`);
  }
  await closeAll();
})();
console.log('solver-ux-audit-1000-dimensions.mjs: printed (exit 0 whatever the rows say)');
