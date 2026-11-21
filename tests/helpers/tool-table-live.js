// tests/helpers/tool-table-live.js — TASK 842: the TOOL TABLE in the real Shaper page (desktop 1280 x 800 mouse mm: tests/tool-table-842-live.test.js; phone 390 x 844
// touch inches: tests/tool-table-842-phone-live.test.js). One phase: a Pocket is made (the quick flow), its card's Bit menu opens the Tool table window ("Edit tool
// table..."), a bit is ADDED there (name, type, its own unit, a fraction, a cutting length), it is listed with its glyph and its size; picked in the operation's Bit row,
// the card names it, the Bit diameter / Cutter shape rows are greyed, the cutting-length note shows; OK: the Operations list's tool change names it. The table persists
// across a reload. Screenshots to .evidence/842/.
import assert from 'node:assert';
import path from 'node:path';
import { sleep } from './cdp-browser.js';
import { openPocketPage } from './pocket-live.js';

export async function toolTablePhase({ phone }) {
  const tag = phone ? '842-tooltable-phone' : '842-tooltable';
  const t = await openPocketPage({ tag, phone, evidenceDir: path.resolve('.evidence/842') });
  if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { evalJs, waitFor, clickElRaw, clickEl, shot, openMode, draw, pickType } = t;
  const sfx = phone ? '-phone' : '';
  const setVal = (sel, v, ev = 'change') => evalJs(`(() => { const i = document.querySelector(${JSON.stringify(sel)}); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('input')); i.dispatchEvent(new Event(${JSON.stringify(ev)})); })()`);
  try {
    await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('SHAPER_TOOL_TABLE', null, { persist: 'local' }))`); // first use: the defaults
    await draw();
    await openMode('prepare');
    await sleep(500);
    await t.clickWorldRaw(0, 35); // the rectangle A's left edge: selected (the quick flow's type menu)
    await pickType('pocket');
    await waitFor(`!document.querySelector('.cut-actions').hidden`, 'the new Pocket is open');
    await evalJs(`(() => { const i = document.querySelector('.cut-depth'); i.value = ${JSON.stringify(phone ? '1' : '20')}; i.dispatchEvent(new Event('change')); })()`);
    await sleep(300);
    if (await evalJs(`!!document.querySelector('.cut-tab[data-tab="tool"]') && !document.querySelector('.cut-tabs').hidden`)) await clickElRaw('.cut-tab[data-tab="tool"]');
    assert.strictEqual(await evalJs(`document.querySelector('.cut-bit-cur').textContent`), 'Custom', 'a new operation: Custom');
    // the Bit menu -> Edit tool table...
    await clickElRaw('#prepare-panel .cut-bit-trigger');
    await waitFor(`!document.querySelector('.cut-bit-pop').hidden`, 'the Bit menu');
    const menu = await evalJs(`[...document.querySelectorAll('.cut-bit-opt .cut-opt-name')].map((e) => e.textContent)`);
    assert.deepStrictEqual(menu, ['1/8 in end mill', '1/4 in end mill', '3 mm end mill', '6 mm end mill', '1/8 in ball nose', '60° V-bit', '90° V-bit', '1 mm 3.5° tapered ball nose'], 'the Bit menu: the first-use bits');
    await shot(`842-bit-menu${sfx}.png`, ['.cut-bit-pop', '#prepare-panel .cut-row[data-row="bit"]'], 2);
    await clickElRaw('.cut-bit-edit');
    await waitFor(`document.getElementById('tool-table-modal').open`, 'the Tool table window opens');
    assert.strictEqual(await evalJs(`document.querySelectorAll('#tool-table-modal .tt-row').length`), 8, 'the window lists the 8 bits');
    await shot(`842-window-list${sfx}.png`, '#tool-table-modal .tt-card', phone ? 2 : 1.5);
    // ADD a bit: 1/8 upcut, end mill, in inches, 1/8, cutting length 1/2
    await clickElRaw('#tool-table-modal .tt-add');
    await waitFor(`!document.querySelector('#tool-table-modal .tt-form').hidden`, 'the edit form');
    assert.deepStrictEqual(await evalJs(`[...document.querySelectorAll('#tool-table-modal .tt-sizes .sync-field')].map((f) => f.dataset.field)`), ['diameter'], 'an end mill: only its diameter');
    await clickElRaw('#tool-table-modal .tt-type[data-type="taperball"]');
    assert.deepStrictEqual(await evalJs(`[...document.querySelectorAll('#tool-table-modal .tt-sizes .sync-field')].map((f) => f.dataset.field)`), ['tipDiameter', 'taperAngle', 'shankDiameter'], 'a tapered ball nose: its tip, taper and shank');
    await clickElRaw('#tool-table-modal .tt-type[data-type="endmill"]');
    await clickElRaw('#tool-table-modal .tt-unit-btn[data-unit="in"]');
    await setVal('#tt-name', '1/8 upcut', 'input');
    await setVal('#tt-diameter', '1/8');
    await setVal('#tt-cutlength', '1/2');
    await shot(`842-window-form${sfx}.png`, '#tool-table-modal .tt-card', phone ? 2 : 1.5);
    await clickElRaw('#tool-table-modal .tt-save');
    await waitFor(`document.querySelector('#tool-table-modal .tt-form').hidden`, 'saved: back to the list');
    const added = await evalJs(`(() => { const r = [...document.querySelectorAll('#tool-table-modal .tt-row')].find((x) => x.querySelector('.tt-row-name').textContent === '1/8 upcut'); return r ? { id: r.dataset.bit, size: r.querySelector('.tt-row-size').textContent, glyph: !!r.querySelector('svg.tt-glyph path') } : null; })()`);
    assert.ok(added, 'the new bit is listed');
    assert.strictEqual(added.size, 'end mill · 1/8 in (3.175 mm)', 'with its type and size in its own unit (the other in brackets)');
    assert.ok(added.glyph, 'with its type glyph');
    await shot(`842-window-added${sfx}.png`, '#tool-table-modal .tt-card', phone ? 2 : 1.5);
    await clickElRaw('#tool-table-modal .tt-close');
    await waitFor(`!document.getElementById('tool-table-modal').open`, 'the window closes');
    // TASK 842 + S3: the toolbar's TOOLS section (fixed, last, after Recalculate) opens the same window
    assert.ok(await evalJs(`(() => { const b = document.getElementById('op-tool-table'), g = b && b.closest('.sk-ribbon-group'); return !!b && !b.hidden && g.dataset.section === 'tools' && 'fixed' in g.dataset; })()`), 'the Tool table button: in the toolbar's fixed Tools section');
    assert.ok(await evalJs(`(() => { const gs = [...document.querySelectorAll('#prepare-ribbon .sk-ribbon-group')].map((g) => g.dataset.section); return gs.indexOf('tools') === gs.length - 1 && gs.indexOf('recalculate') === gs.length - 2; })()`), 'Tools is the toolbar's last section, after Recalculate');
    await shot(`842-ribbon-tools${sfx}.png`, '#prepare-ribbon', 2);
    await clickElRaw('#op-tool-table');
    await waitFor(`document.getElementById('tool-table-modal').open && document.querySelectorAll('#tool-table-modal .tt-row').length === 9`, 'the toolbar opens the Tool table (9 bits)');
    await clickElRaw('#tool-table-modal .tt-close');
    await waitFor(`!document.getElementById('tool-table-modal').open`, 'the window closes again');
    // PICK it in the operation
    await clickElRaw('#prepare-panel .cut-bit-trigger');
    await waitFor(`!document.querySelector('.cut-bit-pop').hidden`, 'the Bit menu');
    await clickEl(`.cut-bit-opt[data-bit="${added.id}"]`);
    await sleep(400);
    const cardNow = await evalJs(`({ bit: document.querySelector('.cut-bit-cur').textContent, dia: 'off' in document.querySelector('.cut-row[data-param="toolDia"]').dataset, shape: 'off' in document.querySelector('.cut-row[data-row="cutterShape"]').dataset, note: [...document.querySelectorAll('.cut-note div')].map((d) => d.textContent) })`);
    assert.strictEqual(cardNow.bit, '1/8 upcut', 'the card names the picked bit');
    assert.ok(cardNow.dia && cardNow.shape, 'Bit diameter and Cutter shape greyed in place');
    const want = phone ? 'This cut goes 1 in deep, deeper than the 0.5 in cutting length of 1/8 upcut.' : 'This cut goes 20 mm deep, deeper than the 12.7 mm cutting length of 1/8 upcut.';
    assert.ok(cardNow.note.includes(want), 'the cutting-length note: ' + JSON.stringify(cardNow.note));
    await evalJs(`document.querySelector('#prepare-panel .cut-rows').scrollTop = 1e6`); await sleep(200); // the Bit, Bit diameter and Cutter shape rows are the card's last rows
    await shot(`842-card-picked${sfx}.png`, phone ? '#prepare-panel' : ['#prepare-panel .cut-row[data-row="bit"]', '#prepare-panel .cut-row[data-row="cutterShape"]', '#prepare-panel .cut-note'], 2);
    await clickElRaw('#prepare-panel .cut-ok');
    await sleep(600);
    if (phone && await evalJs(`document.querySelector('#prepare-ops .ops-body').hidden`)) await clickElRaw('#prepare-ops .ops-head');
    await waitFor(`[...document.querySelectorAll('#prepare-ops .ops-tool-text')].some((e) => e.textContent === 'Change to 1/8 upcut')`, 'the Operations list names the bit in its tool change');
    await shot(`842-ops-list${sfx}.png`, '#prepare-ops', 2);
    // the table persists across a reload
    const stored = await evalJs(`import('/apps/shaper/src/tool-table.js').then((m) => m.loadBits().map((b) => b.name + '|' + b.unit + '|' + (b.diameter ?? '') + '|' + (b.cutLength ?? '')))`);
    assert.ok(stored.includes('1/8 upcut|in|3.175|12.7'), 'stored exactly: ' + JSON.stringify(stored));
    await evalJs(`location.reload()`);
    await sleep(2500);
    await waitFor(`!!document.querySelector('#tool-table-modal')`, 'reloaded');
    const after = await evalJs(`import('/apps/shaper/src/tool-table.js').then((m) => m.loadBits().map((b) => b.name + '|' + b.unit + '|' + (b.diameter ?? '') + '|' + (b.cutLength ?? '')))`);
    assert.deepStrictEqual(after, stored, 'the table after a reload: the same bits');
    console.log(`tool-table-842${phone ? '-phone' : ''}-live: ok`);
  } finally {
    await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('SHAPER_TOOL_TABLE', null, { persist: 'local' }))`).catch((e) => console.warn('reset the table:', e.message));
    await t.close();
  }
}
