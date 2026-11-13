// tests/context-menu-node.test.js — TASK 580 (node port of the LOGIC half of tests/context-menu-live.test.js, TASK 493), the Shaper Design tab through
// tests/helpers/node-app.js: the driven dot is gone; right click opens ONE shared context menu (dimension: Driving / Reference / Delete; geometry:
// Lock-Unlock / Delete): its items, checked state, actions (driving flag, label parentheses, delete is one undo step, lock fixes the joints), the
// keyboard (arrows + Enter), group selection, a joint, the line tool's right click, the ribbon Lock button. The right click is the kit's `rightClick`
// (right button, then the contextmenu event on the target, kit override 5). What stays in the browser (tests/context-menu-live.test.js): the screenshots
// of the menus (md5 evidence, no assert) and the real right button on the real page.
import assert from 'node:assert';
import { open } from './helpers/node-app.js';
import { labelEl } from './helpers/node-dom-read.js';

const app = await open({ host: 'shaper' });
try {
  const st = app.state, doc = app.document;
  const menu = () => { const m = doc.querySelector('.sk-context-menu'); if (!m) return null; return [...m.querySelectorAll('.sk-context-item')].map((r) => ({ id: r.dataset.id, label: r.textContent.replace('✓', '').trim(), checked: r.getAttribute('aria-checked'), disabled: r.getAttribute('aria-disabled') === 'true' })); };
  const chooseItem = (id) => { const el = doc.querySelector(`.sk-context-menu .sk-context-item[data-id="${id}"]`); assert(el, 'menu item ' + id); el.click(); app.frames(); };
  const labelPt = (idx) => { const g = st.constraints[idx].glyphPos; const p = app.toScreen(g.x, g.y); return { x: p.x, y: p.y }; };
  const labelText = (idx) => { const e = labelEl(app, idx); return e ? e.textContent.trim() : ''; };
  const rightClickLabel = (idx) => { const p = labelPt(idx); app.rightClick(p.x, p.y, { target: () => labelEl(app, idx) }); };
  const W2S = (x, y) => app.toScreen(x, y);
  const seed = () => {
    for (const k of [...st.joints.keys()]) if (k !== 'j_origin') st.joints.delete(k);
    st.shapes.length = 0; st.constraints.length = 0; st.selectedShapes.clear(); st.selectedJoints.clear(); st.selectedConstraints.clear();
    const J = (id, x, y) => st.joints.set(id, { x, y });
    J('a', -45, -20); J('b', -5, -20); J('c', -5, 10); J('d', 20, -20); J('e', 40, -20);
    st.shapes.push({ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['b', 'c'] }, { id: 'L3', type: 'line', joints: ['d', 'e'] });
    st.constraints.push({ type: 'distance', joints: ['a', 'b'], value: 40, glyphPos: { x: -25, y: -30 } });
    app.frames(2);
  };
  const driven = () => !!(st.constraints[0].isDriven || st.constraints[0].driven);
  const summary = () => ({ shapes: st.shapes.map((s) => s.id), sel: [...st.selectedShapes], selJ: [...st.selectedJoints], fixed: [...st.joints].filter(([k, j]) => j.fixed && k !== 'j_origin').map(([k]) => k).sort() });
  const noMenu = (msg) => assert.strictEqual(menu(), null, msg);

  seed();
  assert.strictEqual(doc.querySelectorAll('.dim-driven-toggle').length, 0, 'no dim-driven-toggle in the rendered markup');
  assert(app.svg.outerHTML.indexOf('dim-driven-toggle') < 0, 'no dim-driven-toggle in the svg');

  // --- dimension menu
  rightClickLabel(0);
  let m = menu();
  assert(m, 'right click on a dimension label opens the menu');
  assert.deepStrictEqual(m.map((r) => r.label), ['Driving dimension', 'Reference dimension', 'Delete dimension']);
  assert.strictEqual(m[0].checked, 'true'); assert.strictEqual(m[1].checked, 'false');
  app.esc(); noMenu('Escape closes the menu');
  const startText = labelText(0);
  assert(!/^\(/.test(startText), 'driving label is not parenthesised: ' + startText);

  rightClickLabel(0); chooseItem('dim-reference');
  assert(driven(), 'Reference makes it driven');
  assert(/^\(/.test(labelText(0)), 'the reference label is parenthesised: ' + labelText(0));
  noMenu('choosing an item closes the menu');
  rightClickLabel(0);
  m = menu(); assert.strictEqual(m[0].checked, 'false'); assert.strictEqual(m[1].checked, 'true');
  chooseItem('dim-driving');
  assert(!driven(), 'Driving restores it');
  assert(!/^\(/.test(labelText(0)), 'the driving label is restored');

  // keyboard: arrows + Enter picks Reference
  rightClickLabel(0); app.key('ArrowDown'); app.key('ArrowDown'); app.enter();
  assert(driven(), 'arrows + Enter choose an item');

  // --- empty canvas: nothing opens
  seed();
  { const p = W2S(0, 40); app.rightClick(p.x, p.y); } noMenu('right click on empty canvas opens nothing');

  // --- geometry: unselected line gets selected, Lock + Delete offered
  const L3 = W2S(30, -20);
  app.rightClick(L3.x, L3.y);
  m = menu(); assert(m, 'right click on a line opens the menu');
  assert.deepStrictEqual(m.map((r) => r.label), ['Lock', 'Delete']);
  assert.deepStrictEqual(summary().sel, ['L3'], 'the unselected line is selected first');
  chooseItem('geo-lock');
  assert.deepStrictEqual(summary().fixed, ['d', 'e'], 'Lock fixes the line joints');
  app.rightClick(L3.x, L3.y); m = menu(); assert.strictEqual(m[0].label, 'Unlock'); assert.strictEqual(m[0].checked, 'true');
  chooseItem('geo-lock'); assert.deepStrictEqual(summary().fixed, [], 'Unlock releases it');

  // Delete: one undo step
  app.rightClick(L3.x, L3.y); chooseItem('geo-delete');
  assert(!summary().shapes.includes('L3'), 'Delete removes the line');
  app.undo();
  assert(summary().shapes.includes('L3'), 'ONE Ctrl+Z restores the line');

  // group selection: right click on a selected member acts on the whole selection
  st.selectedShapes.clear(); st.selectedShapes.add('L1'); st.selectedShapes.add('L3');
  app.rightClick(L3.x, L3.y);
  assert.deepStrictEqual(summary().sel.sort(), ['L1', 'L3'], 'the selection is kept');
  chooseItem('geo-lock');
  assert.deepStrictEqual(summary().fixed, ['a', 'b', 'd', 'e'], 'Lock acts on the whole selection');

  // joint
  seed();
  { const p = W2S(-5, 10); app.rightClick(p.x, p.y); }
  m = menu(); assert(m, 'right click on a joint opens the menu');
  assert.deepStrictEqual(summary().selJ, ['c'], 'the joint is selected');
  chooseItem('geo-lock'); assert.deepStrictEqual(summary().fixed, ['c']);

  // --- line tool: right click still ends the segment
  seed();
  app.tool('line');
  { const a = W2S(0, 30), b = W2S(20, 30); app.click(a.x, a.y); app.move(b.x, b.y); assert(!!st.active, 'the line tool is mid-segment'); app.rightClick(b.x, b.y); }
  assert(!st.active, 'right click ends the segment');
  noMenu('the line tool right click opens no menu');

  // --- ribbon Lock button
  app.tool('select'); seed();
  st.selectedShapes.clear(); st.selectedJoints.clear(); st.selectedConstraints.clear();
  app.esc();
  { const p = W2S(0, 40); app.click(p.x, p.y); }
  const lock = doc.querySelector('#btn-lock');
  await app.waitFor(() => lock.disabled, 'the ribbon to sync after the click (its setTimeout(0))');
  assert(lock.disabled, 'Lock is disabled with nothing selected');
  app.click(L3.x, L3.y);
  await app.waitFor(() => !lock.disabled, 'the ribbon to sync after the click');
  assert(!lock.disabled, 'Lock is enabled with a selection');
  lock.click(); app.frames();
  assert.deepStrictEqual(summary().fixed, ['d', 'e'], 'the ribbon Lock fixes the joints');
  assert.strictEqual(lock.getAttribute('aria-pressed'), 'true');
  lock.click(); app.frames();
  assert.deepStrictEqual(summary().fixed, [], 'the ribbon Lock again unlocks');
  console.log('context-menu-node: ok');
} finally { await app.close(); }
