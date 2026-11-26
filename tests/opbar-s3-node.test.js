// tests/opbar-s3-node.test.js — TASK S3 (owner turns 2944-2950; docs/OPERATIONS-MODEL.md 4.1-4.2) and its ADDITION (owner turns 3046-3047, "Fusion style"; section 11) on
// the Shaper node page (tests/helpers/node-app.js: the page's own Prepare stage, its operations toolbar, card and list), a drawn design of two squares A, B and an open line L:
//  1. THE TOOLBAR is Design's shared tool ribbon (#ui/tool-ribbon.js), Prepare's own instance: one button per operation type from THE declaration (CUT_TYPES, in its
//     order: its icon, its param-hints name and tooltip), then Recalculate in a fixed section of its own (the divider); no sketcher section, no Lock; Design's ribbon keeps its buttons;
//  2. a SHAPE CLICK shows NO card (its operations' rows are lit); a button with shapes selected = a NEW operation of that type holding them, OPEN (OK / Cancel); with
//     nothing selected = a NEW EMPTY operation, open (a shape click then puts the shape in); an impossible pick (a Pocket of an open line) creates NOTHING and the one plain
//     line says why (Prepare's notice: no card shows); some fit = the rest are left out (the card's line); an open operation is confirmed (OK) first and its shapes are
//     the new one's; the Stock keeps the one-Stock move (nothing selected: an empty Stock replaces it);
//  3. OUT OF DATE: a Design edit generates NOTHING (no paths job): the operations are out of date (the row's mark, its tooltip the table's), their last paths kept
//     (drawn faint); Recalculate with nothing selected = every one (jobs, marks gone); with a row selected = only it; an Undo back to generated inputs = up to date at once;
//     nothing to do = no job and no notice (TASK 878); OK of an edit generates that operation; a document read is not out of date;
//  4. the Export step's wait (export-payload.js whenGenerated): an out-of-date ticked operation = the line "n operations are out of date" with the Recalculate action;
//     the file only after it.
import assert from 'node:assert/strict';
import { open } from './helpers/node-app.js';
import { worldToScreen } from '#ui/coords.js';
import SettingsManager from '#core/settings-manager.js';
import { findLoops } from '#core/loop-finder.js';
import { keyOf } from '../apps/shaper/src/cut-plan.js';
import { storeOps } from '../apps/shaper/src/operations-store.js';
import { CUT_TYPES } from '../apps/shaper/src/shaper.js';
import { hintLabel, hintText, choiceId } from '../apps/shaper/src/param-hints.js';
import { setPathsPort, localPort, staleOf, resultOf } from '../apps/shaper/src/op-paths.js';
import { whenGenerated, exportWhenGenerated } from '../apps/shaper/src/export-payload.js';
import { captureShaperDoc, applyShaperDoc } from '../apps/shaper/src/shaper-doc.js';
import { RIBBON_TOOLS } from '#ui/tool-ribbon.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
SettingsManager.set('DOC_UNIT', 'mm', { persist: false });

// the paths port, counted: every 'paths' job the page sends (the in-process port: the same server as the worker, answering at once)
let jobs = 0;
{ const base = localPort(); setPathsPort({ ...base, post: (m) => { if (m.type === 'paths') jobs++; base.post(m); } }); }

function rect(st, n, x0, y0, x1, y1) {
  [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].forEach(([x, y], i) => st.joints.set(`${n}j${i}`, { x, y, sketchId: 'sketch-1' }));
  for (let i = 0; i < 4; i++) st.shapes.push({ id: `${n}s${i}`, type: 'line', joints: [`${n}j${i}`, `${n}j${(i + 1) % 4}`], sketchId: 'sketch-1' });
}

const app = await open({ host: 'shaper' });
try {
  const st = app.state, doc = app.document, q = (s) => doc.querySelector(s), qa = (s) => [...doc.querySelectorAll(s)];
  rect(st, 'A', 0, 0, 40, 40); rect(st, 'B', 60, 0, 100, 40);
  st.joints.set('Lj0', { x: 0, y: 70, sketchId: 'sketch-1' }); st.joints.set('Lj1', { x: 100, y: 70, sketchId: 'sketch-1' });
  st.shapes.push({ id: 'Ls0', type: 'line', joints: ['Lj0', 'Lj1'], sketchId: 'sketch-1' });
  const loops = findLoops(st);
  const K = Object.fromEntries(['A', 'B'].map((n) => [n, keyOf('loop', loops.find((l) => l.edges.includes(`${n}s0`)).id)]));
  app.modes.showMode('prepare');
  const pv = () => app.prepare.view();
  const AT = { A: [0, 20], B: [60, 20], L: [50, 70], none: [50, 120] };
  const clickAt = (n, o) => { const pc = doc.getElementById('prepare-canvas'); const p = worldToScreen(pc, { x: AT[n][0], y: AT[n][1] }); app.click(Math.round(p.x), Math.round(p.y), { target: pc, ...o }); };
  const pressEl = (s) => { const e = q(s); assert.ok(e, s + ' not found'); app.press(e); };
  const nameOf = (key) => Object.keys(K).find((n) => K[n] === key) || (key.startsWith('chain:') ? 'L' : key);
  const ops = () => storeOps().map((o) => `${o.type}:${o.geometry.map((r) => nameOf(r.key)).join(',')}`);
  const card = () => (q('.cut-card').hidden ? 'hidden' : 'open');
  const head = () => q('.cut-op-head').textContent;
  const notice = () => (q('#prepare-notice').hidden ? null : q('#prepare-notice').textContent);
  const items = () => app.prepare.opList.inspect().items.filter((i) => i.id);
  const marks = () => items().filter((i) => i.outOfDate).map((i) => i.id);
  const hist = () => st.history.length;
  const designEdit = (fn) => { app.modes.showMode('design'); st.saveState('edit'); fn(); app.engine.solve(500); app.modes.showMode('prepare'); };

  // ── 1. the toolbar: Design's ribbon, Prepare's own buttons
  const bar = q('#prepare-ribbon .sk-ribbon');
  ok(bar, '1: the toolbar is a tool ribbon (.sk-ribbon) in #prepare-ribbon');
  eq([...bar.querySelectorAll('.sk-ribbon-group')].map((g) => [g.dataset.section, [...g.querySelectorAll('.sk-ribbon-btn')].map((b) => b.id)]),
    [['operations', CUT_TYPES.map((t) => `op-type-${t.id}`)], ['recalculate', ['op-recalculate']], ['tools', ['op-tool-table']] /* TASK 842: then the Tools section (the Tool table) */],
    '1: one button per operation type in THE declaration\'s order (CUT_TYPES), then Recalculate in a section of its own (the divider)');
  eq(CUT_TYPES.map((t) => t.id), ['exterior', 'interior', 'pocket', 'online', 'guide', 'stock', 'roughing', 'contour'], '1: (the declaration\'s order: Outside, Inside, Pocket, On line, Guide, Stock, Roughing, Contour)');
  eq(CUT_TYPES.map((t) => q(`#op-type-${t.id} .sk-ribbon-lbl`).textContent), CUT_TYPES.map((t) => hintLabel(choiceId('cutType', t.id))), '1: each button\'s name is its type\'s param-hints label');
  const drawn = (svg) => [...svg.children].filter((c) => c.tagName.toLowerCase() !== 'defs').map((c) => `${c.tagName.toLowerCase()} ${c.getAttribute('d') || c.getAttribute('x') || c.getAttribute('cx')}`);
  const declared = (icon) => [...icon.matchAll(/<(\w+)[^>]*?\s(?:d|x|cx)='([^']*)'/g)].map((m) => `${m[1]} ${m[2]}`);
  ok(CUT_TYPES.every((t) => drawn(q(`#op-type-${t.id} svg.sk-ribbon-ic`)).join('|') === declared(t.icon).join('|')), '1: each button\'s icon is its type\'s own (CUT_TYPES.icon)');
  eq(q('#op-recalculate .sk-ribbon-lbl').textContent, 'Recalculate', '1: Recalculate');
  ok(!q('#prepare-ribbon .sk-ribbon-group[data-section="operations"]').hasAttribute('data-fixed') && q('#prepare-ribbon .sk-ribbon-group[data-section="recalculate"]').hasAttribute('data-fixed'),
    '1: the Operations section is a ribbon section as in Design (what does not fit is in its dropdown); Recalculate is fixed (always shown)');
  ok(!bar.querySelector('#btn-lock') && !bar.querySelector('[data-tool]'), '1: no sketcher tool, no Lock');
  const opsSec = q('#prepare-ribbon .sk-ribbon-group[data-section="operations"]'), recSec = q('#prepare-ribbon .sk-ribbon-group[data-section="recalculate"]');
  eq([opsSec.querySelector('button.sk-ribbon-group-label').textContent, recSec.querySelector('div.sk-ribbon-group-label').textContent], ['Operations', 'Recalculate'],
    '1: the sections named as Design\u2019s are (the Operations name is its dropdown button; Recalculate a plain name)');
  ok(qa('#prepare-ribbon .sk-ribbon-btn').every((b) => b.tagName === 'BUTTON' && b.type === 'button'), '1: native buttons (Tab focuses, Enter / Space press: the ribbon\'s keyboard)');
  eq([...q('#design-ribbon .sk-ribbon').querySelectorAll('.sk-ribbon-btn')].map((b) => b.id).filter((id) => RIBBON_TOOLS.some((t) => (t.id || (t.tool ? 'tool-' + t.tool : 'action-' + t.action)) === id)).length,
    RIBBON_TOOLS.length, '1: Design\'s ribbon keeps every built-in button');
  ok(!q('#design-ribbon .sk-ribbon').classList.contains('sk-ribbon-vertical'), '1: Design\'s ribbon is not vertical');

  // ── 1b. the Operations section's dropdown (TASK 647, as Design's sections): each type's "in the bar" box, the type (runs it), the hold-drag grip; Prepare's layout is
  // saved under its OWN app key (RIBBON_LAYOUT.apps['shaper-prepare'].operations), never Design's (apps.shaper); Recalculate is fixed (no dropdown)
  {
    const layout = () => JSON.parse(JSON.stringify(SettingsManager.get('RIBBON_LAYOUT') || null));
    const designBefore = JSON.stringify((layout() || { apps: {} }).apps.shaper || null);
    const shown = () => qa('#prepare-ribbon .sk-ribbon-group[data-section="operations"] .sk-ribbon-btn').filter((b) => !b.hidden).map((b) => b.id.replace('op-type-', ''));
    eq(shown(), CUT_TYPES.map((t) => t.id), '1b: by default every type is in the bar, in the declaration\'s order');
    ok(!q('#prepare-ribbon .sk-ribbon-group[data-section="recalculate"] button.sk-ribbon-group-label'), '1b: Recalculate is fixed: no dropdown (always in the bar)');
    const name = q('#prepare-ribbon .sk-ribbon-group[data-section="operations"] button.sk-ribbon-group-label');
    app.press(name);
    const menu = q('.sk-ribbon-sect-menu.show');
    eq([...menu.querySelectorAll('.sk-ribbon-sect-row')].map((r) => r.dataset.id), CUT_TYPES.map((t) => `op-type-${t.id}`), '1b: the dropdown lists every type (box, the type, grip)');
    const box = menu.querySelector('.sk-ribbon-sect-row[data-id="op-type-guide"] input[type="checkbox"]');
    box.checked = false; box.dispatchEvent(new app.window.Event('change', { bubbles: true }));
    eq(shown().includes('guide'), false, '1b: Guide unchecked: it leaves the bar');
    eq(layout().apps['shaper-prepare'].operations.off, ['op-type-guide'], '1b: saved under Prepare\'s own key: RIBBON_LAYOUT.apps["shaper-prepare"].operations');
    eq(JSON.stringify(layout().apps.shaper || null), designBefore, '1b: Design\'s layout (apps.shaper) untouched');
    // the hold-drag grip: Contour to the top
    const grip = menu.querySelector('.sk-ribbon-sect-row[data-id="op-type-contour"] .sk-ribbon-grip');
    grip.dispatchEvent(new app.window.PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'mouse', button: 0, clientX: 5, clientY: 5 }));
    await new Promise((r) => setTimeout(r, 380)); // (the hold: HOLD_MS)
    app.window.dispatchEvent(new app.window.PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'mouse', clientX: 5, clientY: -20 }));
    app.window.dispatchEvent(new app.window.PointerEvent('pointerup', { bubbles: true, pointerId: 7, pointerType: 'mouse', clientX: 5, clientY: -20 }));
    eq(shown()[0], 'contour', '1b: Contour dragged to the top of its list: first in the bar');
    eq(layout().apps['shaper-prepare'].operations.order[0], 'op-type-contour', '1b: the order saved under Prepare\'s key');
    eq(JSON.stringify(layout().apps.shaper || null), designBefore, '1b: Design\'s layout still untouched');
    // a type unchecked is still runnable from the dropdown
    clickAt('A');
    app.press(menu.querySelector('.sk-ribbon-sect-item[data-id="op-type-guide"]'));
    eq([card(), head()], ['open', 'Guide 1 · 1 shape'], '1b: Guide (not in the bar) run from the dropdown: a new Guide of A, open');
    pressEl('.cut-cancel');
    // Design's own layout change leaves Prepare's alone
    const prepBefore = JSON.stringify(layout().apps['shaper-prepare']);
    app.press(q('#design-ribbon .sk-ribbon-group[data-section="inspect"] button.sk-ribbon-group-label'));
    const dbox = q('.sk-ribbon-sect-menu.show .sk-ribbon-sect-row input[type="checkbox"]');
    dbox.checked = !dbox.checked; dbox.dispatchEvent(new app.window.Event('change', { bubbles: true }));
    eq(JSON.stringify(layout().apps['shaper-prepare']), prepBefore, '1b: a Design layout change leaves Prepare\'s untouched');
    dbox.checked = !dbox.checked; dbox.dispatchEvent(new app.window.Event('change', { bubbles: true }));
    // back to the declared layout (the rest of the test presses every type in the bar)
    app.press(name);
    app.press(q('.sk-ribbon-sect-menu.show .sk-ribbon-sect-reset'));
    eq(shown(), CUT_TYPES.map((t) => t.id), '1b: Reset: the declared layout again');
    app.document.body.dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    clickAt('none');
  }

  // ── 2. a shape click: NO card; the toolbar's buttons
  clickAt('A');
  eq(card(), 'hidden', '2: a click on A: NO card (owner: "dont understand why there a window with cut type when i select a path")');
  let h0 = hist();
  pressEl('#op-type-pocket');
  eq([card(), head(), ops()], ['open', 'Pocket 1 · 1 shape', ['pocket:A']], '2: Pocket with A selected: a NEW Pocket holding A, OPEN');
  pressEl('.cut-ok');
  eq(hist() - h0, 1, '2: OK = one undo step');
  clickAt('none');
  eq(card(), 'hidden', '2: nothing selected, nothing open: no card');
  // (advisor, seen on 9781ff8: the empty card also showed for a row tap and for several selected rows) a row tap, then another row with Ctrl: no card
  pressEl(`#prepare-ops .ops-row .ops-pick`);
  eq(card(), 'hidden', '2: a tap on a row of the list: no card (its shapes selected)');
  { const b = q('#prepare-ops .ops-row .ops-pick'); b.dispatchEvent(new app.window.MouseEvent('click', { bubbles: true, ctrlKey: true })); }
  eq(card(), 'hidden', '2: a Ctrl-click on a row: no card');
  clickAt('none');
  h0 = hist();
  pressEl('#op-type-interior');
  eq([card(), head(), ops()], ['open', 'Inside 2 · no shapes yet', ['pocket:A', 'interior:']], '2: Inside with nothing selected: a NEW EMPTY Inside, OPEN');
  clickAt('B');
  eq([head(), ops()[1]], ['Inside 2 · 1 shape', 'interior:B'], '2: a shape click puts B in');
  pressEl('.cut-cancel');
  eq([ops(), hist() - h0], [['pocket:A'], 0], '2: Cancel: nothing created, nothing in the undo stack');
  clickAt('L');
  const before = ops(); h0 = hist();
  pressEl('#op-type-pocket');
  eq([ops(), card(), notice(), hist() - h0], [before, 'hidden', 'This open line can’t be a Pocket: a pocket needs a closed shape', 0], '2: a Pocket of the open line: nothing created, the one plain line says why');
  clickAt('A'); clickAt('L', { shift: true });
  pressEl('#op-type-exterior');
  eq([head(), q('.cut-note div') && q('.cut-note div').textContent], ['Outside 2 · 1 shape', 'This open line can’t be an Outside: an outside needs a closed shape (left out)'], '2: A + L: an Outside of A; the line says L was left out');
  // an open operation, a button: OK on it first; its shapes are the new one's
  pressEl('#op-type-online');
  eq([head(), ops().sort()], ['On line 1 · 1 shape', ['exterior:A', 'online:A', 'pocket:A']], '2: a button while Outside is open: Outside confirmed, a NEW On line of its shape A, open');
  pressEl('.cut-ok');
  // the Stock: the one-Stock move
  clickAt('B'); pressEl('#op-type-stock'); pressEl('.cut-ok');
  eq(ops().filter((o) => o.startsWith('stock')), ['stock:B'], '2: Stock with B selected: B is the Stock');
  clickAt('none'); pressEl('#op-type-stock');
  eq([head(), ops().filter((o) => o.startsWith('stock'))], ['Stock · no shapes yet', ['stock:']], '2: Stock with nothing selected: an empty Stock replaces it (one Stock per document; TASK 898, owner turns 3710-3712: the Stock is unnumbered)');
  pressEl('.cut-cancel');
  eq(ops().filter((o) => o.startsWith('stock')), ['stock:B'], '2: Cancel: B is the Stock again');

  // ── 3. OUT OF DATE
  eq(marks(), [], '3: everything generated: no mark');
  const pocketId = storeOps().find((o) => o.type === 'pocket').id, outsideId = storeOps().find((o) => o.type === 'exterior').id;
  const itemA = `${pocketId}|${K.A}`, sigA = staleOf(itemA);
  ok(sigA && resultOf(sigA), '3: the Pocket of A has its paths');
  let j0 = jobs;
  designEdit(() => { st.joints.get('Aj1').x = 50; st.joints.get('Aj2').x = 50; });
  eq(jobs - j0, 0, '3: a Design edit (A widened): NO paths job');
  const out1 = marks().sort();
  ok(out1.includes(pocketId) && out1.includes(outsideId), '3: A\'s operations are OUT OF DATE (the row mark): ' + JSON.stringify(out1));
  eq(out1, storeOps().map((o) => o.id).sort(), '3: (every operation: a paths signature covers the whole sketch (TASK 817), so any Design edit is an input of each)');
  const mark = q(`#prepare-ops .ops-row[data-id="${pocketId}"] .ops-stale`);
  eq([mark && mark.dataset.hint, hintText('opOutOfDate')], ['opOutOfDate', 'Out of date: press Recalculate.'], '3: the mark\'s tooltip is the table\'s');
  eq([staleOf(itemA), Boolean(resultOf(sigA))], [sigA, true], '3: its last paths are kept (drawn faint)');
  clickAt('A'); ok(q('#prepare-canvas .sk-faint'), '3: (Prepare draws them faint: A selected)'); eq(card(), 'hidden', '3: (no card)'); clickAt('none');
  // Undo back: up to date at once
  app.modes.showMode('design'); st.undo(); app.engine.solve(500); app.modes.showMode('prepare');
  eq([marks(), jobs - j0], [[], 0], '3: Undo back to the generated inputs: up to date at once, no job');
  app.modes.showMode('design'); st.redo(); app.engine.solve(500); app.modes.showMode('prepare');
  eq(marks().sort(), out1, '3: Redo: out of date again');
  // Recalculate with a row selected: only it
  pressEl(`#prepare-ops .ops-row[data-id="${pocketId}"] .ops-pick`);
  j0 = jobs;
  pressEl('#op-recalculate');
  ok(jobs - j0 > 0 && !marks().includes(pocketId) && marks().includes(outsideId), '3: Recalculate with the Pocket\'s row selected: only the Pocket (jobs ' + (jobs - j0) + ')');
  // nothing selected: every one
  clickAt('none');
  pressEl('#op-recalculate');
  eq(marks(), [], '3: Recalculate with nothing selected: every out-of-date operation, the marks gone');
  j0 = jobs; const said0 = notice();
  pressEl('#op-recalculate');
  eq([notice(), jobs - j0], [said0, 0], '3: nothing to do: no job, and (TASK 878) no notice of its own (the line is as it was): no row shows an Out of date mark');
  // OK of an edit session generates that operation
  designEdit(() => { st.joints.get('Aj1').x = 55; st.joints.get('Aj2').x = 55; });
  ok(marks().includes(pocketId), '3: edited again: the Pocket out of date');
  app.prepare.edit(pocketId); pressEl('.cut-ok');
  ok(!marks().includes(pocketId) && marks().includes(outsideId), '3: OK of the Pocket\'s edit session generates it (the Outside stays out of date)');

  // ── 4. the Export step: the out-of-date line and its Recalculate; the file only after it
  const said = [];
  let done = false;
  const p = exportWhenGenerated(st, { say: (text, action) => said.push([text, action ? action.label : null, action]), recalculate: (ids) => app.prepare.recalculate(ids) }).then((r) => { done = r; });
  await new Promise((r) => setTimeout(r, 20));
  eq([said.map(([t, l]) => [t, l]), done], [[['3 operations are out of date', 'Recalculate']], false], '4: the Export waits: "3 operations are out of date" with the Recalculate action, no file');
  said[0][2].run();
  await p;
  ok(done && /<svg/.test(done.svg) && marks().length === 0, '4: Recalculate: the file is made after it');
  eq(await whenGenerated(st), 0, '4: (nothing to wait for now)');

  // a document read is not out of date
  const saved = captureShaperDoc();
  designEdit(() => { st.joints.get('Aj1').x = 60; st.joints.get('Aj2').x = 60; });
  ok(marks().length > 0, '4: (edited: out of date)');
  applyShaperDoc(saved, st); app.prepare.afterRestore();
  eq(marks(), [], '4: the document read again: generated as it is read, nothing out of date');
  console.log(`opbar-s3-node: ok (${checks} checks)`);
} finally { app.close(); }
