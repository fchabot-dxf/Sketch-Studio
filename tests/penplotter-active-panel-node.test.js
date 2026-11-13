// tests/penplotter-active-panel-node.test.js — TASK 583 (node port of tests/penplotter-active-panel.test.js, TASK 454): the Active Toolpath panel follows
// state.activeToolpathId, by any path. An SVG is imported, the circle is selected on Design, then on Toolpath: + Outline / + Fill from the selection (the panel
// shows the NEW fill; editing Spacing changes THAT toolpath only), a row click, deleting the active toolpath, Esc, undo and redo. Through
// tests/helpers/node-app.js with the real stages. The import enters through the sidebar callback (sketch-stage.js importDrawing, what the File menu
// "Import SVG / DXF…" runs after its file chooser); the real chooser stays in sketch-import.test.js (B).
import assert from 'node:assert';
import { open } from './helpers/node-app.js';
import { importDrawing } from '../apps/penplotter/src/sketch-stage.js';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="80mm" viewBox="0 0 100 80">'
  + '<path d="M10 10 L40 10 L40 30 Z" stroke="#ff0000" fill="none"/>'
  + '<circle cx="70" cy="25" r="12" stroke="#0000ff" fill="#00ff00"/></svg>';

const app = await open({ host: 'penplotter' });
try {
  const doc = app.document;
  const q = (sel, root = doc) => root.querySelector(sel);
  const pressEl = (sel, root = doc) => { const e = q(sel, root); assert(e, sel + ' not found'); app.press(e); };
  const P = app.plotter;
  // What the Active Toolpath panel SHOWS vs the one source of truth.
  const view = () => {
    const sel = q('#activeLayerContent select');
    const labels = [...doc.querySelectorAll('#activeLayerContent .field label')].map((l) => l.textContent.trim().split(' ')[0]);
    const active = P.toolpaths.find((t) => t.id === P.activeToolpathId);
    return { activeId: P.activeToolpathId, activeName: active && active.name, activeType: active && active.type,
      shownId: sel && sel.value, options: sel ? sel.options.length : 0, count: P.toolpaths.length, labels,
      spacings: P.toolpaths.map((t) => t.fill.spacing), names: P.toolpaths.map((t) => t.name) };
  };
  const clickRow = (re, sub = '.tp-layer-name') => {
    const row = [...doc.querySelectorAll('#toolpathLayers .tp-layer-row')].find((r) => re.test(r.textContent));
    assert(row, 'row ' + re + ' not found'); app.press(q(sub, row));
  };

  const imp = importDrawing(SVG, 'active.svg'); assert(imp.ok, 'the SVG import: ' + imp.message);
  assert(app.state.shapes.length > 0, 'the SVG import adds shapes');
  // Design: a click on the circle edge selects it.
  pressEl('#tool-select');
  const pt = app.toScreen(82, 25);
  app.click(pt.x, pt.y);
  app.frames(2);
  assert(P.selectedShapeIds.size > 0, 'the click selects the circle');
  pressEl('.stage-btn[data-stage="toolpath"]');
  assert(q('#addOutlineTp'), 'the toolpath stage (+ Outline there)');

  // 1. + Fill from the selection -> the panel shows the NEW fill, and editing Spacing changes THAT toolpath only
  pressEl('#addOutlineTp');   // TASK 465: the first toolpath made from a selection replaces the empty starter one
  assert(P.toolpaths.length >= 1 && !P.toolpaths.some((t) => t.placeholder), '+ Outline replaces the starter toolpath');
  const v0 = view();
  pressEl('#addFillTp');
  assert(P.toolpaths.length === v0.count + 1 && P.toolpaths.some((t) => t.type === 'fill'), '+ Fill adds a fill toolpath');
  const v1 = view();
  console.log('+ Fill   : active', v1.activeName, '| panel shows', v1.shownId === v1.activeId ? 'the active one' : 'ANOTHER toolpath', '| labels', v1.labels.join(','));
  assert.strictEqual(v1.count, v0.count + 1, 'a fill toolpath was created from the selection');
  assert.strictEqual(v1.activeType, 'fill', 'the new fill is active');
  assert.strictEqual(v1.shownId, v1.activeId, 'the Active Toolpath panel follows the new active toolpath');
  assert(v1.labels.includes('Pattern'), 'the panel shows the fill pattern controls: ' + v1.labels);
  const spacing = [...doc.querySelectorAll('#activeLayerContent .field')].find((f) => f.textContent.includes('Spacing')).querySelector('input');
  app.press(spacing); spacing.focus(); app.key('a', { ctrl: true });
  app.type('3.5');
  app.key('Tab');
  assert(P.toolpaths.some((t) => t.fill.spacing === 3.5), 'the Spacing edit commits');
  const v2 = view();
  const activeIdx = v2.names.indexOf(v2.activeName);
  console.log('spacing  :', JSON.stringify(v0.spacings), '->', JSON.stringify(v2.spacings), '(active is #' + activeIdx + ')');
  assert.strictEqual(v2.spacings[activeIdx], 3.5, 'the new fill got spacing 3.5');
  v2.spacings.forEach((s, i) => { if (i !== activeIdx) assert.strictEqual(s, v1.spacings[i], 'toolpath #' + i + ' is untouched'); });
  assert.strictEqual(v2.shownId, v2.activeId, 'typing into the panel does not swap the shown toolpath');

  // 2. select another row -> the panel follows
  clickRow(/Outline/i);
  const v3 = view();
  console.log('row click: active', v3.activeName, '| panel shows', v3.shownId === v3.activeId ? 'the active one' : 'ANOTHER', '| labels', v3.labels.join(','));
  assert.strictEqual(v3.activeType, 'outline', 'the outline row is active');
  assert.strictEqual(v3.shownId, v3.activeId, 'the panel follows a row selection');
  assert(v3.labels.includes('Passes'), 'outline controls shown');

  // 3. delete the ACTIVE toolpath -> the panel shows the new active one
  const before3 = view();
  pressEl('.del', q('#toolpathLayers .tp-layer-row.active'));
  assert(P.toolpaths.length === before3.count - 1, 'the delete removes the active toolpath');
  const v4 = view();
  console.log('delete   : toolpaths', before3.count, '->', v4.count, '| active', v4.activeName, '| panel shows', v4.shownId === v4.activeId ? 'the active one' : 'ANOTHER', '| options', v4.options);
  assert.strictEqual(v4.count, before3.count - 1, 'the active toolpath was deleted');
  assert.strictEqual(v4.shownId, v4.activeId, 'the panel follows the new active toolpath after a delete');
  assert.strictEqual(v4.options, v4.count, 'the panel lists exactly the remaining toolpaths');

  // 4. undo / redo -> the panel matches the state
  pressEl('#addOutlineTp');
  assert(P.toolpaths.length === v4.count + 1, '+ Outline adds a toolpath');
  app.key('Escape');                    // leave target-editing (a bare + Outline with a selection-less click enters it)
  assert(P.activeToolpathId === null, 'Esc clears the active toolpath');
  const v5 = view();
  assert.strictEqual(v5.activeId, null, 'Esc with nothing in flight deselects and clears the active toolpath');
  assert.strictEqual(v5.shownId, '', 'no active toolpath: the panel shows "none" (it does not edit the first toolpath)');
  assert(v5.options === v5.count + 1, 'the dropdown has the blank entry plus every toolpath');
  clickRow(/outline/i);                          // pick a toolpath again so undo has an active one to follow
  const v5b = view();
  assert.strictEqual(v5b.shownId, v5b.activeId, 'a row click after "none" shows that toolpath');
  app.click(5, 5);                                   // a click off any input, so the history keys apply
  app.key('z', { ctrl: true });
  assert(P.toolpaths.length < v5.count, 'undo removes the toolpath');
  const v6 = view();
  console.log('undo     : toolpaths', v5.count, '->', v6.count, '| active', v6.activeName, '| panel shows', v6.shownId === v6.activeId ? 'the active one' : 'ANOTHER', '| options', v6.options);
  assert(v6.count < v5.count, 'undo removed the toolpath');
  assert.strictEqual(v6.shownId, v6.activeId, 'the panel matches the state after undo');
  assert.strictEqual(v6.options, v6.count, 'the panel lists exactly the toolpaths after undo');
  app.key('y', { ctrl: true });
  assert(P.toolpaths.length === v5.count, 'redo brings the toolpath back');
  const v7 = view();
  assert.strictEqual(v7.count, v5.count, 'redo brought it back');
  assert.strictEqual(v7.shownId, v7.activeId, 'the panel matches the state after redo');
  assert.strictEqual(v7.options, v7.count, 'the panel lists exactly the toolpaths after redo');
  console.log('penplotter-active-panel-node: ok');
} finally {
  await app.close();
}
