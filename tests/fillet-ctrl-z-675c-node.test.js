// tests/fillet-ctrl-z-675c-node.test.js — TASK 675 C unit/node tests:
// Ctrl/Cmd+Z inside numeric boxes (#fillet-radius-input, #offset-distance-input, and shared #ui/numeric-input-manager.js boxes)
// puts back the opening default value in ONE step, never undoes document history while open, updates preview, and a second Ctrl/Cmd+Z
// at default does nothing (except an untouched creation box where Task 551/597 still ends the draw).
import assert from 'node:assert';
import { open } from './helpers/node-app.js';
import { handleBoxUndoKey } from '#ui/numeric-input-manager.js';

// ---- Part 1: Direct unit test on handleBoxUndoKey (Ctrl+Z, Cmd+Z, shift+Z ignored, second Ctrl+Z no-op)
{
  const makeEv = (overrides = {}) => {
    let prevented = false, stopped = false;
    return {
      key: 'z', ctrlKey: true, metaKey: false, shiftKey: false,
      preventDefault() { prevented = true; },
      stopPropagation() { stopped = true; },
      get prevented() { return prevented; },
      get stopped() { return stopped; },
      ...overrides,
    };
  };

  let selected = 0, resets = 0, atDef = 0;
  const el = { value: '12', select() { selected++; } };

  // Ctrl+Shift+Z (redo) is NOT handled as undo
  const redoEv = makeEv({ shiftKey: true });
  assert.strictEqual(handleBoxUndoKey(redoEv, el, '5.0', () => resets++), false);
  assert.strictEqual(el.value, '12');

  // Ctrl+Z when dirty restores default in one step & selects
  const undo1 = makeEv({ ctrlKey: true });
  assert.strictEqual(handleBoxUndoKey(undo1, el, '5.0', () => resets++), true);
  assert.strictEqual(el.value, '5.0');
  assert.strictEqual(selected, 1);
  assert.strictEqual(resets, 1);
  assert.strictEqual(undo1.prevented, true);
  assert.strictEqual(undo1.stopped, true);

  // Second Ctrl+Z when already at default does nothing
  const undo2 = makeEv({ ctrlKey: true });
  assert.strictEqual(handleBoxUndoKey(undo2, el, '5.0', () => resets++), true);
  assert.strictEqual(el.value, '5.0');
  assert.strictEqual(resets, 1);
  assert.strictEqual(undo2.prevented, true);
  assert.strictEqual(undo2.stopped, true);

  // Cmd+Z (Mac metaKey) works identically
  el.value = '33';
  const cmdUndo = makeEv({ ctrlKey: false, metaKey: true });
  assert.strictEqual(handleBoxUndoKey(cmdUndo, el, '5.0', () => resets++, { onAtDefault: () => atDef++ }), true);
  assert.strictEqual(el.value, '5.0');
  assert.strictEqual(resets, 2);
  assert.strictEqual(atDef, 0);

  // When already at default and optional onAtDefault provided, runs onAtDefault
  const cmdAtDef = makeEv({ ctrlKey: false, metaKey: true });
  assert.strictEqual(handleBoxUndoKey(cmdAtDef, el, '5.0', () => resets++, { onAtDefault: () => atDef++ }), true);
  assert.strictEqual(atDef, 1);
}

// ---- Part 2: Integration in SketchStudio page (shared numeric-input-manager boxes + fillet + offset)
const app = await open({ host: 'sketchstudio' });
let failed = null;
try {
  const st = app.state, doc = app.document;
  const O = app.toScreen(0, 0);
  const P = (dx, dy) => ({ x: O.x + 250 + dx, y: O.y + 120 + dy });
  const dispatchCtrlZ = (el, { meta = false } = {}) => {
    const ev = new doc.defaultView.KeyboardEvent('keydown', {
      key: 'z', code: 'KeyZ', ctrlKey: !meta, metaKey: meta, shiftKey: false, bubbles: true, cancelable: true,
    });
    el.dispatchEvent(ev);
    return ev;
  };
  const setBoxText = (el, text) => {
    el.value = text;
    el.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
  };

  // Build an L-corner and undo baseline
  app.tool('line');
  app.click(P(-80, 0).x, P(-80, 0).y);
  app.click(P(0, 0).x, P(0, 0).y);
  app.click(P(0, -80).x, P(0, -80).y);
  app.esc();
  const histCorner = st.history.length;

  // --- Fillet box: type "12", preview radius = 12, ONE Ctrl+Z -> "5.0" & preview radius = 5, 2nd Ctrl+Z -> no-op, Enter -> +1 history step, canvas Ctrl+Z -> corner sharp again
  app.tool('fillet');
  app.click(P(0, 0).x, P(0, 0).y);
  const fBox = doc.getElementById('fillet-radius-input');
  assert(fBox, '#fillet-radius-input opens on corner');
  assert.strictEqual(fBox.value, '5', 'fillet default is 5');
  setBoxText(fBox, '12');
  assert.strictEqual(st.history.length, histCorner, 'typing in fillet box adds 0 history steps');
  assert(doc.querySelector('#fillet-tool-overlay text')?.textContent.includes('12'), 'preview tracks 12');

  dispatchCtrlZ(fBox);
  assert.strictEqual(fBox.value, '5', 'ONE Ctrl+Z restores 5 (not "1")');
  assert.strictEqual(doc.getElementById('fillet-radius-input'), fBox, 'box stays open');
  assert.strictEqual(st.history.length, histCorner, 'history untouched while box open');
  assert(doc.querySelector('#fillet-tool-overlay text')?.textContent.includes('R 5'), 'preview tracks restored R 5');

  dispatchCtrlZ(fBox); // second Ctrl+Z at default
  assert.strictEqual(fBox.value, '5', 'second Ctrl+Z at default is a no-op');
  assert.strictEqual(doc.getElementById('fillet-radius-input'), fBox, 'box still open after second Ctrl+Z');
  assert.strictEqual(st.history.length, histCorner, 'document not undone by second Ctrl+Z');

  // Invalid text -> one Cmd+Z restores 5 & clears aria-invalid
  setBoxText(fBox, 'abc');
  assert.strictEqual(fBox.getAttribute('aria-invalid'), 'true');
  dispatchCtrlZ(fBox, { meta: true });
  assert.strictEqual(fBox.value, '5');
  assert.strictEqual(fBox.getAttribute('aria-invalid'), 'false');

  // Confirm with Enter -> +1 history step; then ONE canvas Ctrl+Z removes arc, tangents, radius dim
  fBox.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
  assert.strictEqual(doc.getElementById('fillet-radius-input'), null, 'Enter closes fillet box');
  assert.strictEqual(st.shapes.filter((s) => s.type === 'arc').length, 1, 'fillet arc created');
  assert.strictEqual(st.constraints.filter((c) => c.isRadius).length, 1, 'radius dim created');
  assert.strictEqual(st.constraints.filter((c) => c.type === 'tangent').length, 2, '2 tangent constraints created');
  assert.strictEqual(st.history.length, histCorner + 1, 'fillet commit adds exactly 1 history step');

  app.undo();
  assert.strictEqual(st.shapes.filter((s) => s.type === 'arc').length, 0, 'one canvas Ctrl+Z removes arc');
  assert.strictEqual(st.constraints.filter((c) => c.isRadius).length, 0, 'one canvas Ctrl+Z removes radius dim');
  assert.strictEqual(st.constraints.filter((c) => c.type === 'tangent').length, 0, 'one canvas Ctrl+Z removes tangents');
  assert.strictEqual(st.shapes.filter((s) => s.type === 'line').length, 2, 'two corner lines intact and corner sharp');

  // --- Shared creation boxes (Line L, Rect W, Circle D, Polygon N): typing then Ctrl+Z reverts to opening default in one step & keeps box open
  app.tool('line');
  app.click(P(20, 20).x, P(20, 20).y);
  const dualW = doc.querySelector('#dualInput input');
  assert(dualW, 'line box opens');
  const openLineDef = dualW.value;
  setBoxText(dualW, '77');
  assert.strictEqual(st.shapes.filter((s) => s.type === 'line').length, 2);
  dispatchCtrlZ(dualW);
  assert.strictEqual(dualW.value, openLineDef, 'Line box Ctrl+Z restores default in 1 step');
  assert.strictEqual(st.currentTool, 'line', 'Line tool stays active after reverting typed box');
  dispatchCtrlZ(dualW); // second Ctrl+Z right after reverting typed box does nothing
  assert.strictEqual(st.currentTool, 'line', 'second Ctrl+Z right after revert keeps box open');
  app.esc();

  // Rect box
  app.tool('rect');
  app.click(P(30, 30).x, P(30, 30).y);
  const rectW = doc.querySelector('#dualInput input');
  const openRectDef = rectW.value;
  setBoxText(rectW, '45');
  dispatchCtrlZ(rectW);
  assert.strictEqual(rectW.value, openRectDef, 'Rect W Ctrl+Z restores default in 1 step');
  assert.strictEqual(st.currentTool, 'rect', 'Rect tool stays active');
  app.esc();

  // Polygon sides N box (remembers 6)
  app.tool('polygon');
  app.click(P(40, 40).x, P(40, 40).y);
  const polyInputs = [...doc.querySelectorAll('#dualInput input')];
  polyInputs[1].focus();
  setBoxText(polyInputs[1], '10');
  assert.strictEqual(st.active.preview.sides, 10);
  dispatchCtrlZ(polyInputs[1]);
  assert.strictEqual(polyInputs[1].value, '6', 'Polygon N Ctrl+Z restores remembered 6 in 1 step');
  assert.strictEqual(st.active.preview.sides, 6, 'Polygon preview returns to 6 sides');
  app.esc();

  // Offset box (#offset-distance-input)
  app.tool('offset');
  app.click(P(-40, 0).x, P(0, 0).y); // pick horizontal line
  const oBox = doc.getElementById('offset-distance-input');
  assert(oBox, '#offset-distance-input opens on curve pick');
  const openOffDef = oBox.value;
  setBoxText(oBox, '25');
  dispatchCtrlZ(oBox);
  assert.strictEqual(oBox.value, openOffDef, 'Offset box Ctrl+Z restores default in 1 step');
  assert.strictEqual(doc.getElementById('offset-distance-input'), oBox, 'Offset box stays open');
  dispatchCtrlZ(oBox);
  assert.strictEqual(oBox.value, openOffDef, 'Offset second Ctrl+Z is a no-op');
  app.esc();

  console.log('fillet-ctrl-z-675c-node: ok');
} catch (e) { failed = e; } finally { await app.close(); }
if (failed) { console.error(failed.stack || failed.message || failed); process.exitCode = 1; }
