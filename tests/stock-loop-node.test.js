// tests/stock-loop-node.test.js — TASK 583 (the node half of tests/stock-loop-live.test.js, TASK 472): Stock as a cut type, the logic of it in the app with Shaper's
// declared Prepare stage (tests/helpers/node-app.js): pick Stock on a closed loop in Prepare (a click on the loop, the cut type menu), the menu lists Stock beside the
// others with its icon, the role MOVES (with a notice) when a second loop is marked, exactly one Stock, Ctrl+Z gives the role back, the card for a Stock has ONE row
// (Thickness) and a thickness typed as 0.5in is stored in mm. What stays in the browser (tests/stock-loop-live.test.js): the Stock edge's drawn look (CSS) and the
// Review's 3D board (WebGL) with its thickness card.
import assert from 'node:assert';
import { open } from './helpers/node-app.js';
import { worldToScreen } from '#ui/coords.js';
import { stockKeyOf } from '../apps/shaper/src/cut-plan.js';
import { V2_PLAN } from './helpers/plan-v2.js'; // TASK S1: the test's v2 document of the plan, loaded through applyShaperDoc
import { clickOpen, editStep } from './helpers/prepare-open.js'; // TASK S2: an operation is opened to edit it

const app = await open({ host: 'shaper' });
try {
  const doc = app.document;
  const q = (sel) => doc.querySelector(sel);
  const pressElRaw = (sel) => { const e = q(sel); assert(e, sel + ' not found'); app.press(e); };
  const pressEl = (sel) => editStep(app, () => pressElRaw(sel)); // TASK S2: a change of the open operation = its own step (tests/helpers/prepare-open.js)
  pressEl('.sk-header-tab[data-tab="design"]');
  // seed: A = an L-shaped outline (the board), B = a 20x20 loop drawn INSIDE it (a part, NOT a hole), C = a separate rectangle
  const st = app.state;
  for (const k of [...st.joints.keys()]) st.joints.delete(k);
  st.shapes.length = 0; st.constraints.length = 0; V2_PLAN.clear();
  const poly = (p, pts) => { pts.forEach(([x, y], i) => st.joints.set(p + i, { x, y })); pts.forEach((_, i) => st.shapes.push({ id: p + 's' + i, type: 'line', joints: [p + i, p + ((i + 1) % pts.length)] })); };
  poly('A', [[0, 0], [120, 0], [120, 60], [60, 60], [60, 120], [0, 120]]);
  poly('B', [[10, 10], [30, 10], [30, 30], [10, 30]]);
  poly('C', [[160, 0], [200, 0], [200, 40], [160, 40]]);
  pressEl('.sk-header-tab[data-tab="prepare"]');
  const pc = doc.getElementById('prepare-canvas');
  assert(pc.children.length > 0, 'prepare canvas ready');
  const clickRaw = (x, y) => { const p = worldToScreen(pc, { x, y }); app.click(Math.round(p.x), Math.round(p.y), { target: pc }); };
  const clickAt = (x, y) => clickOpen(app, () => clickRaw(x, y)); // TASK S2: OK the open operation, click, open the clicked shape's operation (tests/helpers/prepare-open.js)
  const pickType = (tid) => { if (app.prepare.openId()) { pressEl('.cut-type-trigger'); assert(q(`.cut-type-opt[data-id="${tid}"]`), 'cut type menu open'); pressEl(`.cut-type-opt[data-id="${tid}"]`); } else pressEl(`#op-type-${tid}`); }; // TASK S3: no operation open = the operations toolbar
  const stockKey = () => stockKeyOf(V2_PLAN);
  const notice = () => { const e = doc.getElementById('prepare-notice'); return e && !e.hidden ? e.textContent : ''; };

  // the operations toolbar (TASK S3; before it, the selection card's type menu): Stock beside the others, with its icon
  clickAt(100, 30);                      // inside A, outside B: selects the L loop
  const opts = [...doc.querySelectorAll('#prepare-ribbon .sk-ribbon-group[data-section="operations"] .sk-ribbon-btn')].map((o) => o.id.replace('op-type-', '') + (o.disabled ? ':off' : '') + (o.querySelector('svg') ? ':icon' : ''));
  console.log('toolbar:', JSON.stringify(opts));
  assert.deepStrictEqual(opts, ['exterior:icon', 'interior:icon', 'pocket:icon', 'online:icon', 'guide:icon', 'stock:icon', 'roughing:icon', 'contour:icon'], 'Stock sits beside the other types with its icon (TASK S3: the toolbar, in the order of the CUT_TYPES declaration; none greyed)');
  pressEl('#op-type-stock');
  assert(!!stockKey(), 'the L loop becomes the Stock');
  const keyA = stockKey();
  assert.ok(keyA && keyA.startsWith('loop:'), 'the L loop is now the Stock: ' + keyA);
  assert.strictEqual(notice(), '', 'TASK 878: the Stock shows on the drawing: no notice');
  // the card for a Stock: ONE field (Thickness), no offset / bit / shape rows
  const rows = [...doc.querySelectorAll('.cut-rows > .cut-row')].filter((r) => doc.defaultView.getComputedStyle(r).display !== 'none').map((r) => (r.dataset.param || r.dataset.row) + ':' + r.querySelector('.cut-field-label').textContent);
  console.log('stock card rows:', JSON.stringify(rows));
  assert.deepStrictEqual(rows, ['cutDepth:Thickness'], 'the card shows only the Thickness row');
  const depth = q('.cut-depth'); depth.value = '0.5in'; depth.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
  assert(V2_PLAN.get(stockKeyOf(V2_PLAN)).cutDepth === 12.7, 'thickness stored');
  assert.strictEqual(V2_PLAN.get(stockKeyOf(V2_PLAN)).cutDepth, 12.7, 'thickness typed as 0.5in is stored in mm');

  // idle: deselect (click empty canvas): the Stock loop keeps its distinct look (its edge class and its STOCK label exist; the colours are CSS: the browser file)
  clickAt(230, 90);
  assert.ok(!!q('#prepare-canvas .sk-edge-stock'), 'the unselected Stock loop has its edge class');
  assert.ok(!!q('#prepare-canvas .sk-stock-label'), 'and carries its STOCK label');

  // a SECOND Stock moves the role (one per document: the Stock type's hint says so; TASK 878: no notice); Ctrl+Z undoes the move
  clickAt(180, 20);                      // the rectangle C
  pickType('stock');
  assert.strictEqual(notice(), '', 'TASK 878: no Stock moved notice');
  const keyC = stockKey();
  assert.notStrictEqual(keyC, keyA, 'the role moved to the second loop');
  assert.strictEqual([...V2_PLAN.values()].filter((r) => r.cutType === 'stock').length, 1, 'exactly one Stock');
  app.key('z', { ctrl: true });
  assert.strictEqual(stockKey(), keyA, 'Ctrl+Z gives the Stock role back to the L loop');
  console.log('stock-loop-node: ok');
} finally {
  await app.close();
}
