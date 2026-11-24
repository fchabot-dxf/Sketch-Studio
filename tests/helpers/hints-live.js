// tests/helpers/hints-live.js — TASK 805 (replaces task 770's laid-out hints): the parameter hints are a TOOLTIP AT THE CURSOR in the real Shaper page
// (packages/ui/cursor-tooltip.js through apps/shaper/src/hint.js; the texts: apps/shaper/src/param-hints.js), one phase per page: the desktop app (mm, a real mouse),
// the phone 390 (inches, real touch) and Fusion mode (?host=fusion, mm, a mouse). Files: tests/param-hints-770-live.test.js (desktop), -fusion-live (Fusion mode),
// -phone-live (phone). The page tools are tests/helpers/pocket-live.js openPocketPage's; the tooltip tools tests/helpers/tooltip-live.js.
//   - at rest no tooltip, and no hint text or (i) is laid out in the card, the Operations list, the STL card or the Export cards;
//   - desktop: a mouse resting on a label / a menu choice shows its hint NEAR THE POINTER (not under it, on screen, a fixed pointer-events-none overlay) after the delay, gone on
//     leave, on a press, on Esc; a keyboard Tab onto a label shows it beside the control (aria-describedby); phone: a long press shows it above the finger, a tap elsewhere
//     hides it, the long press on a menu row does not pick it;
//   - THE OWNER'S GRIPE: the bounding box of every card row, menu option, Operations row and Export card is IDENTICAL (0 px) before and while a tooltip shows;
//   - the menus are compact: every choice is ONE line (its name), the menu's height is the same with and without a tooltip;
//   - a hint that depends on the card (Finish allowance follows Loop) is evaluated when the tooltip opens;
//   - the Export step: Stock thickness, Material, Export and its three buttons show their hints the same way.
import assert from 'node:assert';
import fs from 'node:fs';
import { sleep } from './cdp-browser.js';
import { fileSourceTypesAndRemount } from './file-fusion-types-live.js'; // TASK 882
import { setupPockets } from './pocket-live.js';
import { probe, tipProblems } from './tooltip-live.js';

const fixture = (name) => fs.readFileSync(new URL(`../fixtures/sa7-slope/${name}.json`, import.meta.url), 'utf8');
const HINT = {
  cutDepth: 'One flat depth for every shape. From model: each shape’s own model depth (the deepest point of a sloped shape).', // TASK S2 (owner turn 2740): a flat type's Depth
  finishOff: 'Left on the walls by the clearing passes; the Origin’s inside cut takes it off for a clean edge. 0 = none.',
  finishOn: 'Left on the walls by the clearing passes; the loop’s turn along the wall takes it off for a clean edge. 0 = none.',
};

// TASK 831: part = 'all' (default: desktop and Fusion run it whole) or one of 'depth' | 'rows' | 'menus' | 'menus2' | 'export' (the phone runs the five in five files, each under the gate's time limit); every part sets the page up itself
export async function hintsPhase(t, { fusion = false, part = 'all' } = {}) {
  const on = (p) => part === 'all' || part === p;
  const { phone, evalJs, waitFor, send, shot, clickEl, openMode, setUnit, clickWorld } = t;
  const D = fusion ? 'fusion' : phone ? 'phone' : 'desktop';
  if (fusion) {
    await setUnit('mm');
    await evalJs(`import('/tests/helpers/plan-v2.js').then((m) => m.V2_PLAN.clear())`);
    await evalJs(`window.fusionJavaScriptHandler.handle('selection_data', ${JSON.stringify(fixture('02-drafted-pocket'))})`);
    await waitFor(`/Body1: 2 regions/.test(document.getElementById('prepare-notice').textContent)`, 'Fusion: the drafted pocket imported');
    await fileSourceTypesAndRemount({ evalJs, waitFor }); // TASK 882: the import makes no operation: file the types Fusion hinted (what the old import did)
    await clickWorld(60, -40);
    await waitFor(`!document.querySelector('#prepare-panel .cut-card').hidden && document.querySelector('.cut-type-cur').textContent === 'Pocket'`, 'Fusion: the imported pocket\'s card');
  } else await setupPockets(t, D);
  const tp = probe(t);
  const label = (row) => `#prepare-panel .cut-row[data-${row === 'cutDepth' || row === 'toolDia' || row === 'cutOffset' ? 'param' : 'row'}="${row}"] [data-hint]`;
  const hintOf = (id) => evalJs(`import('/apps/shaper/src/param-hints.js').then((m) => m.hintText(${JSON.stringify(id)}))`);
  const key = async (k, code, vk) => { for (const type of ['rawKeyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk }); await sleep(150); };

  // nothing laid out, nothing showing
  const noLaidOut = async (where) => assert.strictEqual(await evalJs(`document.querySelectorAll('.sk-hint, .sk-hint-trigger, .sk-hint-i, .sk-opt-hint').length - document.querySelectorAll('.sk-style-panel .sk-hint, .sk-style-panel .sk-hint-trigger, .sk-style-panel .sk-hint-i').length`), 0, `${D}: ${where}: no hint text or (i) is laid out in Prepare or Export (the shared Settings panel's own rows, #ui style-panel.js, are not these)`);
  // ONE check for every element: show its tooltip, the layout is unchanged (0 px), the text and place are right, then leave
  const checkTip = async (sel, text, how, { shotName = null, shotSels = null } = {}) => {
    await tp.reveal(sel);
    const before = await tp.snap();
    const p = await tp.show(sel);
    const tip = await tp.tip();
    const during = await tp.snap();
    console.log(`${D} ${how} ${sel}: ${JSON.stringify(tip)} at ${JSON.stringify(p)}`);
    assert.deepStrictEqual(tipProblems(tip, p, text, { phone }), [], `${D} ${how}: ${sel}: the tooltip is right`);
    assert.deepStrictEqual(tp.movedBoxes(before, during), [], `${D} ${how}: ${sel}: THE LAYOUT DID NOT MOVE (0 px: every row, option, list row and card box identical before and while the tooltip shows; ${Object.keys(during).length} boxes)`);
    if (shotName) await shot(shotName, [...(shotSels || [sel]), '#sk-cursor-tip'], 2); // the crop holds the tooltip too (it is outside the card)
    if (!phone) {
      await tp.leave();
      assert.strictEqual(await tp.tip(), null, `${D} ${how}: ${sel}: gone when the mouse leaves`);
      assert.deepStrictEqual(tp.movedBoxes(before, await tp.snap()), [], `${D} ${how}: ${sel}: and the layout is as before`);
    } else await tp.leave();
    return tip;
  };

  if (on('depth')) {
  await noLaidOut('at rest');
  assert.strictEqual(await tp.tip(), null, D + ': at rest no tooltip');
  await tp.leave();
  const depthText = await hintOf('cutDepth');
  assert.strictEqual(depthText, HINT.cutDepth, D + ': the Depth hint is the table\'s');
  const pre = await tp.snap();
  const depthTip = await checkTip(label('cutDepth'), depthText, phone ? 'long press' : 'hover', { shotName: `${D}-tooltip-depth.png`, shotSels: ['#prepare-panel .cut-card'] });
  assert.ok(depthTip.parent === 'BODY', D + ': the tooltip lives in <body>, outside every card');
  assert.deepStrictEqual(tp.movedBoxes(pre, await tp.snap()), [], D + ': the layout is as at the start');

  if (phone) {
    // the finger lifts: the tooltip stays; the next tap anywhere hides it; a short tap never shows one
    await tp.show(label('cutDepth'));
    await tp.release();
    assert.ok(await tp.tip(), D + ': it stays after the finger lifts');
    await tp.tapAway();
    assert.strictEqual(await tp.tip(), null, D + ': the next tap hides it');
  } else {
    // Esc dismisses it, a keyboard Tab shows it beside the control, a click dismisses it
    await tp.show(label('cutDepth'));
    assert.ok(await tp.tip(), D + ': shown');
    await key('Escape', 'Escape', 27);
    assert.strictEqual(await tp.tip(), null, D + ': Esc hides it');
    await tp.leave();
    // TASK S2: the open operation's shape list (its X buttons) comes before the Depth row: the Tab starts from the last of them
    await evalJs(`(document.querySelectorAll('#prepare-panel .cut-geo-x').length ? [...document.querySelectorAll('#prepare-panel .cut-geo-x')].pop() : document.querySelector('#prepare-panel .cut-type-trigger')).focus()`);
    await key('Tab', 'Tab', 9);
    assert.ok(await evalJs(`document.activeElement === document.querySelector('${label('cutDepth')}')`), D + ': Tab lands on the Depth label');
    const kb = await tp.tip();
    assert.ok(kb && kb.text === depthText, D + ': keyboard focus shows the hint: ' + JSON.stringify(kb));
    assert.ok(await evalJs(`document.querySelector('${label('cutDepth')}').getAttribute('aria-describedby') === 'sk-cursor-tip'`), D + ': the focused label is described by the tooltip (aria-describedby)');
    const lb = await evalJs(`(() => { const r = document.querySelector('${label('cutDepth')}').getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) }; })()`);
    assert.ok(kb.top >= lb.bottom || kb.bottom <= lb.top || kb.left >= lb.right || kb.right <= lb.left, D + ': beside the focused control, not over it');
    await key('Escape', 'Escape', 27);
    await evalJs(`document.activeElement.blur()`);
    await tp.show(label('cutDepth'));
    await clickEl(label('cutDepth'));
    assert.strictEqual(await tp.tip(), null, D + ': a click hides it');
    await tp.leave();
  }

  }

  if (on('rows')) {
  // the rows of the cut card: every label of a Spiral pocket (the Finish allowance hint follows Loop: evaluated when the tooltip opens)
  await t.pickClearing('linked');
  await noLaidOut('Spiral card');
  const rowIds = await evalJs(`[...document.querySelectorAll('#prepare-panel .cut-card [data-hint]')].filter((e) => e.getBoundingClientRect().height > 0).map((e) => e.dataset.hint)`);
  console.log(`${D} labels shown: ${rowIds.join(', ')}`);
  assert.ok(rowIds.length >= 6, D + ': the card shows its labels');
  for (const id of rowIds) if (id !== 'finishAllowance') await checkTip(`#prepare-panel .cut-card [data-hint="${id}"]`, (id === 'rasterAngle' ? 'Only Raster has an angle: choose Raster in Clearing to set this. ' : '') + await hintOf(id), 'label'); // TASK 813: Spiral: the Raster angle row stays, greyed: its tooltip starts with the reason
  assert.strictEqual(await evalJs(`document.querySelector('.cut-loop').checked`), false, D + ': Loop starts off');
  await checkTip(label('finishAllowance'), HINT.finishOff, 'Finish allowance, Loop off');
  await t.setLoop(true);
  await checkTip(label('finishAllowance'), HINT.finishOff, 'Finish allowance, Loop on (TASK 850: native finish cut on the wall)', { shotName: `${D}-tooltip-finish-loop-on.png`, shotSels: ['#prepare-panel .cut-card'] });
  await t.setLoop(false);
  }

  if (on('menus') || on('menus2')) {
  if (part === 'menus' || part === 'menus2') await t.pickClearing('linked'); // the state the rows part leaves
  // the menus: compact (one line per choice), the choice's name only, a tooltip per choice, the layout unmoved
  const menu = async (trigSel, popSel, optSel, name, param) => {
    await clickEl(trigSel);
    await waitFor(`!document.querySelector('${popSel}').hidden`, name + ' open');
    const m = await evalJs(`(() => { const p = document.querySelector('${popSel}'), pr = p.getBoundingClientRect(), opts = [...p.querySelectorAll('${optSel}')];
      return { h: Math.round(pr.height * 100) / 100, w: Math.round(pr.width), scrolls: p.scrollHeight > p.clientHeight + 1, rows: opts.map((o) => { const b = o.getBoundingClientRect(); return { id: o.dataset.hint, text: o.textContent.trim(), h: Math.round(b.height * 100) / 100, name: (o.querySelector('.cut-opt-name') || {}).textContent }; }) }; })()`);
    console.log(`${D} ${name}: ${JSON.stringify(m)}`);
    assert.ok(m.rows.length >= 3 && m.rows.every((r) => r.id && r.id.startsWith(param + ':') && r.text.startsWith(r.name)), `${D} ${name}: every choice shows its NAME (no second line), each carries its entry`);
    assert.ok(m.rows.every((r) => r.h <= (phone ? 41 : 36)), `${D} ${name}: every row is one compact line (<= ${phone ? 40 : 34} px): ${JSON.stringify(m.rows.map((r) => r.h))}`);
    assert.ok(!m.scrolls, `${D} ${name}: the menu does not scroll (compact)`);
    for (const r of m.rows) {
      const tip = await checkTip(`${popSel} ${optSel}[data-hint="${r.id}"]`, await hintOf(r.id), 'menu choice');
      assert.ok(tip, `${D} ${name}: ${r.id}: its tooltip`);
    }
    const after = await evalJs(`Math.round(document.querySelector('${popSel}').getBoundingClientRect().height * 100) / 100`);
    assert.strictEqual(after, m.h, `${D} ${name}: the menu's height is the same after all the tooltips (${m.h} px)`);
    await shot(`${D}-menu-${param}.png`, [popSel, '#prepare-panel .cut-card'], 2);
    return m;
  };
  let types;
  if (on('menus')) {
  types = await menu('#prepare-panel .cut-type-trigger', '.cut-type-menu', '.cut-type-opt', 'cut type menu', 'cutType');
  if (fusion) assert.ok(types.rows.some((r) => r.id === 'cutType:roughing'), D + ': the drafted pocket offers Roughing');
  // a long press on a menu row shows its tooltip and does not pick it (the menu stays open, the cut type is unchanged)
  if (phone) {
    const cur = await evalJs(`document.querySelector('.cut-type-cur').textContent`);
    const last = types.rows[types.rows.length - 1].id;
    await tp.show(`.cut-type-menu .cut-type-opt[data-hint="${last}"]`);
    assert.ok(await tp.tip(), D + ': long press on a menu row shows its tooltip');
    await tp.leave();
    assert.strictEqual(await evalJs(`document.querySelector('.cut-type-cur').textContent`), cur, D + ': the long press did not pick the row (the cut type is unchanged)');
  }
  await clickEl('#prepare-panel .cut-type-trigger');
  }
  if (on('menus2')) {
  await menu('#prepare-panel .cut-clear-trigger', '.cut-clear-pop', '.cut-clear-opt', 'clearing menu', 'clearing');
  await clickEl('#prepare-panel .cut-clear-trigger');
  await menu('#prepare-panel .cut-shape-trigger', '.cut-shape-pop', '.cut-type-opt', 'cutter shape menu', 'cutterShape');
  await clickEl('#prepare-panel .cut-shape-trigger');
  if (part !== 'menus') await noLaidOut('after the menus');
  }
  }

  if (on('export')) {
  // the Operations list (its title), a Hold part choice button
  await checkTip('#prepare-ops .ops-head', await hintOf('operations'), 'Operations list');
  if (!fusion) {
    await t.pickType('exterior');
    await waitFor(`!!document.querySelector('#prepare-panel .cut-row[data-row="holdPart"] [data-hint="holdPart:tabs"]')`, 'the Hold part choices');
    await checkTip('#prepare-panel .cut-row[data-row="holdPart"] [data-hint="holdPart:tabs"]', await hintOf('holdPart:tabs'), 'Hold part choice button');
  }

  // the Export step's cards
  await openMode('review');
  await noLaidOut('the Export step');
  for (const [sel, id] of [['#review-stock [data-hint="stockThickness"]', 'stockThickness'], ['#review-look [data-hint="material"]', 'material'], ['#simexport-panel [data-hint="export"]', 'export'],
    ['#btn-generate-svg', 'generateSvg'], ['#btn-sync-shaper', 'syncShaperHub'], ['#link-shaper-hub', 'openShaperHub']]) {
    await checkTip(sel, await hintOf(id), 'Export card', { shotName: `${D}-tooltip-export-${id}.png`, shotSels: ['#review-side'] });
  }
  assert.deepStrictEqual(await evalJs(`[...document.querySelectorAll('#review-side [data-label]')].map((e) => e.textContent)`), ['Generate Shaper SVG', 'Sync to ShaperHub', 'Open ShaperHub (My Files)'], D + ': the Export buttons\' labels (from the table)');
  assert.strictEqual(await evalJs(`document.getElementById('link-shaper-hub').hasAttribute('title')`), false, D + ': no native title duplicates the tooltip');
  await noLaidOut('end');
  }
}
