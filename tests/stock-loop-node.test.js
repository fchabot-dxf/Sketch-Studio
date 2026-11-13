// tests/stock-loop-node.test.js — TASK 583 (the node half of tests/stock-loop-live.test.js, TASK 472): Stock as a cut type, the logic of it in the app with Shaper's
// declared Prepare stage (tests/helpers/node-app.js): pick Stock on a closed loop in Prepare (a click on the loop, the cut type menu), the menu lists Stock beside the
// others with its icon, the role MOVES (with a notice) when a second loop is marked, exactly one Stock, Ctrl+Z gives the role back, the card for a Stock has ONE row
// (Thickness) and a thickness typed as 0.5in is stored in mm. What stays in the browser (tests/stock-loop-live.test.js): the Stock edge's drawn look (CSS) and the
// Review's 3D board (WebGL) with its thickness card.
import assert from 'node:assert';
import { open } from './helpers/node-app.js';
import { worldToScreen } from '#ui/coords.js';
import { CUT_PLAN, stockKeyOf } from '../apps/shaper/src/cut-plan.js';

const app = await open({ host: 'shaper' });
try {
  const doc = app.document;
  const q = (sel) => doc.querySelector(sel);
  const pressEl = (sel) => { const e = q(sel); assert(e, sel + ' not found'); app.press(e); };
  pressEl('[data-mode="design"]');
  // seed: A = an L-shaped outline (the board), B = a 20x20 loop drawn INSIDE it (a part, NOT a hole), C = a separate rectangle
  const st = app.state;
  for (const k of [...st.joints.keys()]) st.joints.delete(k);
  st.shapes.length = 0; st.constraints.length = 0; CUT_PLAN.clear();
  const poly = (p, pts) => { pts.forEach(([x, y], i) => st.joints.set(p + i, { x, y })); pts.forEach((_, i) => st.shapes.push({ id: p + 's' + i, type: 'line', joints: [p + i, p + ((i + 1) % pts.length)] })); };
  poly('A', [[0, 0], [120, 0], [120, 60], [60, 60], [60, 120], [0, 120]]);
  poly('B', [[10, 10], [30, 10], [30, 30], [10, 30]]);
  poly('C', [[160, 0], [200, 0], [200, 40], [160, 40]]);
  pressEl('[data-mode="prepare"]');
  const pc = doc.getElementById('prepare-canvas');
  assert(pc.children.length > 0, 'prepare canvas ready');
  const clickAt = (x, y) => { const p = worldToScreen(pc, { x, y }); app.click(Math.round(p.x), Math.round(p.y), { target: pc }); };
  const pickType = (tid) => { pressEl('.cut-type-trigger'); assert(q(`.cut-type-opt[data-id="${tid}"]`), 'cut type menu open'); pressEl(`.cut-type-opt[data-id="${tid}"]`); };
  const stockKey = () => stockKeyOf(CUT_PLAN);
  const notice = () => { const e = doc.getElementById('prepare-notice'); return e && !e.hidden ? e.textContent : ''; };

  // the menu: Stock beside the others, with its icon
  clickAt(100, 30);                      // inside A, outside B: selects the L loop
  pressEl('.cut-type-trigger');
  assert(doc.querySelectorAll('.cut-type-opt').length > 0, 'cut type menu open');
  const opts = [...doc.querySelectorAll('.cut-type-opt')].map((o) => o.dataset.id + (o.disabled ? ':off' : '') + (o.querySelector('svg') ? ':icon' : ''));
  console.log('menu:', JSON.stringify(opts));
  assert.deepStrictEqual(opts, ['online:icon', 'guide:icon', 'interior:icon', 'pocket:icon', 'exterior:icon', 'stock:icon'], 'Stock sits beside the other types with its icon');
  pressEl('.cut-type-opt[data-id="stock"]');
  assert(!!stockKey(), 'the L loop becomes the Stock');
  const keyA = stockKey();
  assert.ok(keyA && keyA.startsWith('loop:'), 'the L loop is now the Stock: ' + keyA);
  assert.match(notice(), /now the Stock/);
  // the card for a Stock: ONE field (Thickness), no offset / bit / shape rows
  const rows = [...doc.querySelectorAll('.cut-rows > .cut-row')].filter((r) => doc.defaultView.getComputedStyle(r).display !== 'none').map((r) => (r.dataset.param || r.dataset.row) + ':' + r.querySelector('.cut-field-label').textContent);
  console.log('stock card rows:', JSON.stringify(rows));
  assert.deepStrictEqual(rows, ['cutDepth:Thickness'], 'the card shows only the Thickness row');
  const depth = q('.cut-depth'); depth.value = '0.5in'; depth.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
  assert(CUT_PLAN.get(stockKeyOf(CUT_PLAN)).cutDepth === 12.7, 'thickness stored');
  assert.strictEqual(CUT_PLAN.get(stockKeyOf(CUT_PLAN)).cutDepth, 12.7, 'thickness typed as 0.5in is stored in mm');

  // idle: deselect (click empty canvas): the Stock loop keeps its distinct look (its edge class and its STOCK label exist; the colours are CSS: the browser file)
  clickAt(230, 90);
  assert.ok(!!q('#prepare-canvas .sk-edge-stock'), 'the unselected Stock loop has its edge class');
  assert.ok(!!q('#prepare-canvas .sk-stock-label'), 'and carries its STOCK label');

  // a SECOND Stock moves the role (one per document) and says so; Ctrl+Z undoes the move
  clickAt(180, 20);                      // the rectangle C
  pickType('stock');
  assert(/Stock moved to this loop/.test(notice()), 'the Stock moved notice');
  const keyC = stockKey();
  assert.notStrictEqual(keyC, keyA, 'the role moved to the second loop');
  assert.match(notice(), /Stock moved to this loop/);
  assert.strictEqual([...CUT_PLAN.values()].filter((r) => r.cutType === 'stock').length, 1, 'exactly one Stock');
  app.key('z', { ctrl: true });
  assert.strictEqual(stockKey(), keyA, 'Ctrl+Z gives the Stock role back to the L loop');
  console.log('stock-loop-node: ok');
} finally {
  await app.close();
}
