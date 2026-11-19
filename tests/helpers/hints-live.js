// tests/helpers/hints-live.js — TASK 770: the parameter hints in the real Shaper page (apps/shaper/src/hint.js, the texts apps/shaper/src/param-hints.js), one phase
// per page: the desktop app (mm, a mouse), the phone 390 (inches, touch) and Fusion mode (?host=fusion, mm, a mouse). Files: tests/param-hints-770-live.test.js
// (desktop + Fusion mode), tests/param-hints-770-phone-live.test.js (phone). The page tools are tests/helpers/pocket-live.js openPocketPage's.
//   - at rest every hint is closed (hidden, no height);
//   - a computer: hovering a row's label shows its hint under the field, leaving hides it; a keyboard Tab onto a label shows it, Esc closes it; a click pins it;
//     a touch screen: a tap on the label toggles it (open, then closed);
//   - one at a time: opening another closes the first; a press elsewhere closes it;
//   - open, it lies inside the card (the card's width unchanged, the line not wider than the card), is not covered (the point at its centre is the hint),
//     inside the card's visible rows (scrolled into view, never clipped);
//   - the field is described by it (aria-describedby = the line's id, aria-expanded on the label);
//   - the cut type, clearing and cutter shape menus show each row's hint as a second line, every row on screen and inside the menu's width;
//   - the Export step: the Stock thickness, Material and Export "i" buttons open their hints (the Export hint lists the three buttons, each described by its line).
import assert from 'node:assert';
import fs from 'node:fs';
import { sleep } from './cdp-browser.js';
import { setupPockets } from './pocket-live.js';

const fixture = (name) => fs.readFileSync(new URL(`../fixtures/sa7-slope/${name}.json`, import.meta.url), 'utf8');

export async function hintsPhase(t, { fusion = false } = {}) {
  const { phone, evalJs, waitFor, send, shot, clickEl, openMode, pickType, setUnit, clickWorld } = t;
  const D = fusion ? 'fusion' : phone ? 'phone' : 'desktop';
  if (fusion) {
    await setUnit('mm');
    await evalJs(`import('/apps/shaper/src/cut-plan.js').then((m) => m.CUT_PLAN.clear())`);
    await evalJs(`window.fusionJavaScriptHandler.handle('selection_data', ${JSON.stringify(fixture('02-drafted-pocket'))})`);
    await waitFor(`/Body1: 2 regions/.test(document.getElementById('prepare-notice').textContent)`, 'Fusion: the drafted pocket imported');
    await clickWorld(60, -40);
    await waitFor(`!document.querySelector('#prepare-panel .cut-card').hidden && document.querySelector('.cut-type-cur').textContent === 'Pocket'`, 'Fusion: the imported pocket\'s card');
  } else await setupPockets(t, D);
  const label = (row) => `#prepare-panel .cut-row[data-${row === 'cutDepth' || row === 'toolDia' || row === 'cutOffset' ? 'param' : 'row'}="${row}"] .sk-hint-trigger`;
  // the state of every hint of the page + the card's box + the row's hint box, as measured
  const state = (row) => evalJs(`(() => {
    const card = document.querySelector('#prepare-panel .cut-card'), rows = card.querySelector('.cut-rows'), c = card.getBoundingClientRect(), rv = rows.getBoundingClientRect();
    const open = [...document.querySelectorAll('.sk-hint')].filter((h) => !h.hidden).map((h) => h.dataset.hint);
    const out = { open, cardW: Math.round(c.width), cardLeft: Math.round(c.left), vw: innerWidth };
    ${row ? `const r = card.querySelector('.cut-row[data-param="${row}"], .cut-row[data-row="${row}"]'), h = r.querySelector('.sk-hint'), trig = r.querySelector('.sk-hint-trigger'), input = r.querySelector('input');
    out.text = h.textContent; out.expanded = trig.getAttribute('aria-expanded'); out.described = !!input && input.getAttribute('aria-describedby') === h.id && trig.getAttribute('aria-controls') === h.id;
    if (!h.hidden) {
      h.scrollIntoView({ block: 'nearest' });
      const b = h.getBoundingClientRect(), v = rows.getBoundingClientRect(), hit = document.elementFromPoint(Math.round(b.left + b.width / 2), Math.round(b.top + Math.min(b.height / 2, 8)));
      out.box = { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height) };
      out.inside = b.left >= c.left - 0.5 && b.right <= c.right + 0.5 && h.scrollWidth <= h.clientWidth + 1 && b.top >= v.top - 0.5 && b.bottom <= v.bottom + 0.5;
      out.onTop = !!hit && h.contains(hit); out.hit = hit && !h.contains(hit) ? hit.outerHTML.slice(0, 120) : null;
    }
    const tb = trig.getBoundingClientRect(); out.trigger = { w: Math.round(tb.width), h: Math.round(tb.height) };` : ''}
    return out; })()`);
  const mouse = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'none', buttons: 0, clickCount: 0 });
  const centreOf = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: Math.round(r.left + Math.min(r.width / 2, 30)), y: Math.round(r.top + r.height / 2) }; })()`);
  const key = async (k, code, vk, modifiers = 0) => { for (const type of ['rawKeyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk, modifiers }); await sleep(150); };

  const rest = await state(null);
  assert.deepStrictEqual(rest.open, [], D + ': at rest every hint is closed');
  const W = rest.cardW;
  const isOpen = async (row, how) => {
    const s = await state(row);
    console.log(`${D} ${row} ${how}: ${JSON.stringify(s)}`);
    assert.ok(s.open.length === 1 && s.expanded === 'true', `${D} ${row}: ${how}: its hint is open, alone: ${JSON.stringify(s.open)}`);
    assert.ok(s.inside && s.onTop && s.cardW === W && s.cardLeft + s.cardW <= s.vw, `${D} ${row}: ${how}: inside the card, not covered, the card's width unchanged: ${JSON.stringify(s)}`);
    assert.ok(s.described, `${D} ${row}: the field is described by the hint (aria-describedby), the label controls it`);
    return s;
  };
  const isClosed = async (row, how) => { const s = await state(row); assert.ok(s.open.length === 0 && s.expanded === 'false', `${D} ${row}: ${how}: closed: ${JSON.stringify(s.open)}`); return s; };

  if (!phone) {
    // hover shows, leaving hides
    const p = await centreOf(label('cutDepth'));
    await mouse('mouseMoved', p.x, p.y); await sleep(200);
    const s = await isOpen('cutDepth', 'hover');
    assert.strictEqual(s.text, 'How deep the cut goes from the surface. Leave it empty to set the depth on the Origin.', D + ': the Depth hint (the table\'s)');
    await shot(`${D}-hint-hover-depth.png`, ['#prepare-panel .cut-row[data-param="cutDepth"]'], 3);
    await mouse('mouseMoved', p.x - 260, p.y + 300); await sleep(200);
    await isClosed('cutDepth', 'the mouse left');
    // the keyboard: Tab from the cut type field onto the Depth label shows it, Esc closes it
    await evalJs(`document.querySelector('#prepare-panel .cut-type-trigger').focus()`);
    await key('Tab', 'Tab', 9);
    assert.ok(await evalJs(`document.activeElement === document.querySelector('${label('cutDepth')}')`), D + ': Tab lands on the Depth label');
    await isOpen('cutDepth', 'keyboard focus');
    await key('Escape', 'Escape', 27);
    await isClosed('cutDepth', 'Esc');
    await evalJs(`document.activeElement.blur()`);
  }
  // a click / a tap pins it; a second one closes it (a touch screen: the only way, no hover)
  await clickEl(label('toolDia'));
  const bit = await isOpen('toolDia', phone ? 'tap' : 'click');
  if (!phone) { await mouse('mouseMoved', 5, 400); await sleep(200); await isOpen('toolDia', 'pinned: the mouse left'); }
  await shot(`${D}-hint-open-bit.png`, ['#prepare-panel .cut-row[data-param="toolDia"]'], 3);
  await shot(`${D}-card-hint-open.png`, ['#prepare-panel .cut-card'], 2);
  await clickEl(label('toolDia'));
  await isClosed('toolDia', phone ? 'tapped again' : 'clicked again');
  // one at a time: opening the Offset hint closes the Bit diameter one; a press elsewhere closes
  await clickEl(label('toolDia'));
  await clickEl(label('cutOffset'));
  const off = await isOpen('cutOffset', 'another label');
  assert.deepStrictEqual(off.open, ['cutOffset'], D + ': one hint at a time');
  await clickEl('#prepare-panel .cut-row[data-param="cutDepth"] input');
  await isClosed('cutOffset', 'a press on another field');
  // a checkbox row: its "i" (the label still toggles the box); Spiral shows Finish allowance + Loop
  await t.pickClearing('linked');
  const loop0 = await evalJs(`document.querySelector('.cut-loop').checked`);
  await clickEl('#prepare-panel .cut-row[data-row="loop"] .sk-hint-i');
  const lp = await state('loop');
  assert.ok(lp.open[0] === 'loop' && /^Joins the clearing and the last wall pass into one closed path/.test(lp.text) && lp.inside && lp.onTop, D + ': the Loop "i" opens its hint inside the card: ' + JSON.stringify(lp));
  assert.strictEqual(await evalJs(`document.querySelector('.cut-loop').checked`), loop0, D + ': the "i" does not toggle the Loop box');
  await shot(`${D}-hint-loop.png`, ['#prepare-panel .cut-row[data-row="loop"]'], 3);
  await key('Escape', 'Escape', 27);
  await isClosed('loop', 'Esc');
  console.log(`${D} label target: ${JSON.stringify((await state('cutDepth')).trigger)}, the Loop "i": ${JSON.stringify(await evalJs(`(() => { const b = document.querySelector('.cut-row[data-row="loop"] .sk-hint-i').getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; })()`))}`);

  // the menus: each row's hint is its second line; every row on screen
  const menu = async (trigSel, popSel, optSel, name) => {
    await clickEl(trigSel);
    await waitFor(`!document.querySelector('${popSel}').hidden`, name + ' open');
    const m = await evalJs(`(() => { const p = document.querySelector('${popSel}'), pr = p.getBoundingClientRect(), card = document.querySelector('#prepare-panel .cut-card').getBoundingClientRect();
      const panel = document.getElementById('prepare-panel').getBoundingClientRect(), opts = [...p.querySelectorAll('${optSel}')];
      const hitOk = (o) => { o.scrollIntoView({ block: 'nearest' }); const b = o.getBoundingClientRect(), e = document.elementFromPoint(Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2)); return !!e && o.contains(e); };
      const uncovered = hitOk(opts[opts.length - 1]) && hitOk(opts[0]);
      return { pop: { left: Math.round(pr.left), right: Math.round(pr.right), top: Math.round(pr.top), bottom: Math.round(pr.bottom) }, panel: { top: Math.round(panel.top), bottom: Math.round(panel.bottom) }, uncovered, cardLeft: Math.round(card.left), vw: innerWidth, vh: innerHeight, scrolls: p.scrollHeight > p.clientHeight + 1,
        rows: [...p.querySelectorAll('${optSel}')].map((o) => { const h = o.querySelector('.sk-opt-hint'), n = o.querySelector('.cut-opt-name'), hb = h.getBoundingClientRect(), nb = n.getBoundingClientRect();
          return { id: h.dataset.hint, name: n.textContent, hint: h.textContent, below: hb.top >= nb.bottom - 1, smaller: parseFloat(getComputedStyle(h).fontSize) < parseFloat(getComputedStyle(n).fontSize), fits: hb.left >= pr.left && hb.right <= pr.right + 0.5 && h.scrollWidth <= h.clientWidth + 1 && hb.bottom <= o.getBoundingClientRect().bottom + 0.5, shown: hb.height > 0 }; }) }; })()`);
    console.log(`${D} ${name}: ${JSON.stringify(m)}`);
    assert.ok(m.rows.length >= 3 && m.rows.every((r) => r.hint.length > 10 && r.below && r.smaller && r.fits && r.shown), `${D} ${name}: every row has its hint as a second, smaller line inside the menu`);
    assert.ok(m.pop.left >= 0 && m.pop.right <= m.cardLeft && m.pop.top >= m.panel.top - 0.5 && m.pop.bottom <= m.panel.bottom + 0.5, `${D} ${name}: the menu is on screen, left of the card, within the card's panel (above the phone's Operations bar; it scrolls when taller: ${m.scrolls})`);
    assert.ok(m.uncovered, `${D} ${name}: nothing covers the menu (its first and last rows are hit where they are): ${JSON.stringify(m.uncovered)}`);
    return m;
  };
  const types = await menu('#prepare-panel .cut-type-trigger', '.cut-type-menu', '.cut-type-opt', 'cut type menu');
  if (fusion) assert.ok(types.rows.some((r) => r.id === 'cutType:roughing'), D + ': the drafted pocket offers Roughing (TASK 792: it replaced the Stepped pocket), with its hint');
  await shot(`${D}-menu-cut-type.png`, ['.cut-type-menu', '#prepare-panel .cut-card'], 2);
  await clickEl('#prepare-panel .cut-type-trigger');
  await menu('#prepare-panel .cut-clear-trigger', '.cut-clear-pop', '.cut-clear-opt', 'clearing menu');
  await shot(`${D}-menu-clearing.png`, ['.cut-clear-pop', '#prepare-panel .cut-card'], 2);
  await clickEl('#prepare-panel .cut-clear-trigger');
  await menu('#prepare-panel .cut-shape-trigger', '.cut-shape-pop', '.cut-type-opt', 'cutter shape menu');
  await shot(`${D}-menu-cutter-shape.png`, ['.cut-shape-pop'], 2);
  await clickEl('#prepare-panel .cut-shape-trigger');

  // the Export step's cards
  await openMode('review');
  for (const [sel, id] of [['#review-stock .sk-hint-i', 'stockThickness'], ['#review-look .sk-hint-i', 'material'], ['#simexport-panel .sk-hint-i', 'export']]) {
    await clickEl(sel);
    const r = await evalJs(`(() => { const t = document.querySelector('${sel}'), h = document.getElementById(t.getAttribute('aria-controls')); h.scrollIntoView({ block: 'nearest' }); const b = h.getBoundingClientRect(), side = document.getElementById('review-side').getBoundingClientRect();
      const hit = document.elementFromPoint(Math.round(b.left + b.width / 2), Math.round(b.top + 6));
      return { open: [...document.querySelectorAll('.sk-hint')].filter((x) => !x.hidden).map((x) => x.dataset.hint), lines: h.children.length, text: h.textContent, inside: b.left >= side.left && b.right <= side.right + 0.5, onTop: !!hit && h.contains(hit),
        described: ${id === 'export'} ? ['btn-generate-svg', 'btn-sync-shaper', 'link-shaper-hub'].every((x) => { const d = document.getElementById(document.getElementById(x).getAttribute('aria-describedby')); return !!d && h.contains(d); }) : document.querySelector('${id === 'material' ? '#review-look-select' : '#review-stock-thickness'}').getAttribute('aria-describedby') === h.id }; })()`);
    console.log(`${D} export card ${id}: ${JSON.stringify(r)}`);
    assert.ok(r.open.length === 1 && r.open[0] === id && r.inside && r.onTop && r.described, `${D} export card ${id}: its hint opens alone, inside the side card, described: ${JSON.stringify(r)}`);
    if (id === 'export') assert.strictEqual(r.lines, 4, D + ': the Export hint = its line + one per button');
    await shot(`${D}-export-hint-${id}.png`, [`#${id === 'export' ? 'simexport-panel' : id === 'material' ? 'review-look' : 'review-stock'}`], 2);
    await clickEl(sel);
  }
  assert.deepStrictEqual(await evalJs(`[...document.querySelectorAll('#review-side [data-label]')].map((e) => e.textContent)`), ['Generate Shaper SVG', 'Sync to ShaperHub', 'Open ShaperHub (My Files)'], D + ': the Export buttons\' labels (from the table)');
}
