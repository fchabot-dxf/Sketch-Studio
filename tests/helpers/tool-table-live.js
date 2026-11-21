// tests/helpers/tool-table-live.js — TASK 842 / 852: MY BITS (the tool table, renamed in 852) in the real Shaper page (desktop 1280 x 800 mouse mm: tests/tool-table-842-live.test.js; phone 390 x 844
// touch inches: tests/tool-table-842-phone-live.test.js). One phase: a Pocket is made (the quick flow), its card's Bit menu opens the Tool table window ("Edit tool
// table..."), a bit is ADDED there (name, type, its own unit, a fraction, a cutting length), it is listed with its glyph and its size; picked in the operation's Bit row,
// the card names it, the Bit diameter / Cutter shape rows are greyed, the cutting-length note shows; OK: the Operations list's tool change names it. The table persists
// across a reload. TASK 852: Add bit asks the TYPE first (the templates), a name is suggested from the sizes; a BOWL bit is added from its template, picked in the Pocket,
// and the 3D preview shows the rounded floor edge. Screenshots to .evidence/842/ (the bowl's 3D to .evidence/852/).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { sleep } from './cdp-browser.js';
import { openPocketPage } from './pocket-live.js';

const SWIFTSHADER = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']; // the 3D view in headless

export async function toolTablePhase({ phone }) {
  const tag = phone ? '842-tooltable-phone' : '842-tooltable';
  const t = await openPocketPage({ tag, phone, evidenceDir: path.resolve('.evidence/842'), args: SWIFTSHADER });
  if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { evalJs, waitFor, clickElRaw, clickEl, clickWorld, shot, openMode, draw, pickType } = t;
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
    assert.deepStrictEqual(menu, ['1/16 in end mill', '1/8 in end mill', '1/4 in end mill', '3/8 in end mill', '1/2 in end mill'], 'the Bit menu: the first-use bits (the five inch end mills)');
    assert.strictEqual(await evalJs(`document.querySelector('.cut-bit-edit').textContent`), 'Edit my bits…', 'the Bit menu entry is "Edit my bits…"');
    await shot(`842-bit-menu${sfx}.png`, ['.cut-bit-pop', '#prepare-panel .cut-row[data-row="bit"]'], 2);
    await clickElRaw('.cut-bit-edit');
    await waitFor(`document.getElementById('tool-table-modal').open`, 'the My bits window opens');
    assert.strictEqual(await evalJs(`document.querySelector('#tool-table-modal .sync-modal-title').textContent`), 'My bits', 'the window is titled My bits');
    assert.strictEqual(await evalJs(`document.querySelectorAll('#tool-table-modal .tt-row').length`), 5, 'the window lists the 5 bits');
    await shot(`842-window-list${sfx}.png`, '#tool-table-modal .tt-card', phone ? 2 : 1.5);
    // TASK 852: Add bit asks the TYPE first: the templates, each with its glyph, its name and a one-line description
    const fieldsOf = () => evalJs(`[...document.querySelectorAll('#tool-table-modal .tt-sizes .sync-field')].map((f) => f.dataset.field)`);
    await clickElRaw('#tool-table-modal .tt-add');
    await waitFor(`!document.querySelector('#tool-table-modal .tt-templates').hidden`, 'Add bit: the template list');
    assert.ok(await evalJs(`document.querySelector('#tool-table-modal .tt-form').hidden && document.querySelector('#tool-table-modal .tt-list').hidden`), 'the template list replaces the list and the form');
    const tpl = await evalJs(`[...document.querySelectorAll('#tool-table-modal .tt-template')].map((b) => ({ id: b.dataset.type, name: b.querySelector('.tt-template-name').textContent, desc: b.querySelector('.tt-template-desc').textContent.length > 10, glyph: !!b.querySelector('svg.tt-glyph path') }))`);
    assert.deepStrictEqual(tpl.map((x) => [x.id, x.name]), [['endmill', 'end mill'], ['ballnose', 'ball nose'], ['bowl', 'Bowl bit (corner radius)'], ['vbit', 'V-bit'], ['taperball', 'tapered ball nose'], ['taperflat', 'tapered end mill']], 'the templates are the bit types');
    assert.ok(tpl.every((x) => x.desc && x.glyph), 'each with its glyph and its one-line description');
    await shot(`842-templates${sfx}.png`, '#tool-table-modal .tt-card', phone ? 2 : 1.5);
    await clickElRaw('#tool-table-modal .tt-template[data-type="taperball"]');
    await waitFor(`!document.querySelector('#tool-table-modal .tt-form').hidden`, 'the form of the picked template');
    assert.deepStrictEqual(await fieldsOf(), ['tipDiameter', 'taperAngle', 'shankDiameter'], 'a tapered ball nose: its tip, taper and shank');
    assert.ok(await evalJs(`document.querySelector('#tool-table-modal .tt-type-field').hidden`), 'the type was picked: no second type picker on a new bit');
    await clickElRaw('#tool-table-modal .tt-cancel');
    await waitFor(`!document.querySelector('#tool-table-modal .tt-list').hidden`, 'Cancel: back to the list');
    // ADD a bit: 1/8 upcut, end mill, in inches, 1/8, cutting length 1/2
    await clickElRaw('#tool-table-modal .tt-add');
    await waitFor(`!document.querySelector('#tool-table-modal .tt-templates').hidden`, 'the template list');
    await clickElRaw('#tool-table-modal .tt-template[data-type="endmill"]');
    await waitFor(`!document.querySelector('#tool-table-modal .tt-form').hidden`, 'the edit form');
    assert.deepStrictEqual(await fieldsOf(), ['diameter'], 'an end mill: only its diameter');
    await clickElRaw('#tool-table-modal .tt-unit-btn[data-unit="in"]');
    await setVal('#tt-diameter', '3/8');
    assert.strictEqual(await evalJs(`document.getElementById('tt-name').value`), '3/8 in end mill', 'the name is suggested from the size');
    await setVal('#tt-diameter', '1/8');
    assert.strictEqual(await evalJs(`document.getElementById('tt-name').value`), '1/8 in end mill', 'and follows the size until you type your own');
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
    assert.ok(await evalJs(`(() => { const b = document.getElementById('op-tool-table'), g = b && b.closest('.sk-ribbon-group'); return !!b && !b.hidden && g.dataset.section === 'tools' && 'fixed' in g.dataset; })()`), 'the Tool table button: in the fixed Tools section of the toolbar');
    assert.ok(await evalJs(`(() => { const gs = [...document.querySelectorAll('#prepare-ribbon .sk-ribbon-group')].map((g) => g.dataset.section); return gs.indexOf('tools') === gs.length - 1 && gs.indexOf('recalculate') === gs.length - 2; })()`), 'Tools is the last section of the toolbar, after Recalculate');
    await shot(`842-ribbon-tools${sfx}.png`, '#prepare-ribbon', 2);
    await clickElRaw('#op-tool-table');
    await waitFor(`document.getElementById('tool-table-modal').open && document.querySelectorAll('#tool-table-modal .tt-row').length === 6`, 'the toolbar opens My bits (6 bits)');
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
    // TASK 852: the BOWL bit, from its template; picked in the Pocket; the 3D preview shows the rounded floor edge
    if (phone && !await evalJs(`document.querySelector('#prepare-ops .ops-body').hidden`)) await clickElRaw('#prepare-ops .ops-head'); // the phone's list closes (it covers the card)
    await clickWorld(0, 35); // the operation of the clicked shape: open
    await waitFor(`!document.querySelector('.cut-actions').hidden`, 'the Pocket is open again');
    if (await evalJs(`!!document.querySelector('.cut-tab[data-tab="tool"]') && !document.querySelector('.cut-tabs').hidden`)) await clickElRaw('.cut-tab[data-tab="tool"]');
    await clickElRaw('#prepare-panel .cut-bit-trigger');
    await waitFor(`!document.querySelector('.cut-bit-pop').hidden`, 'the Bit menu');
    await clickElRaw('.cut-bit-edit');
    await waitFor(`document.getElementById('tool-table-modal').open`, 'My bits opens');
    await clickElRaw('#tool-table-modal .tt-add');
    await clickElRaw('#tool-table-modal .tt-template[data-type="bowl"]');
    await waitFor(`!document.querySelector('#tool-table-modal .tt-form').hidden`, 'the bowl form');
    assert.deepStrictEqual(await fieldsOf(), ['diameter', 'cornerRadius'], 'a bowl bit: its diameter and its corner radius');
    await clickElRaw('#tool-table-modal .tt-unit-btn[data-unit="in"]');
    await setVal('#tt-diameter', '1/2');
    await setVal('#tt-cornerRadius', '1/4');
    assert.ok(/ball nose/i.test(await evalJs(`document.querySelector('#tool-table-modal .tt-bit-note').textContent`)), 'a corner of half the diameter: the note says it is a ball nose');
    await setVal('#tt-cornerRadius', '3/8');
    await clickElRaw('#tool-table-modal .tt-save');
    assert.ok((await evalJs(`document.querySelector('#tool-table-modal .tt-refusals').textContent`)).includes('The corner radius can be at most half the diameter.'), 'more than half: the plain refusal line (never clamped)');
    await setVal('#tt-cornerRadius', '3/16');
    assert.strictEqual(await evalJs(`document.getElementById('tt-name').value`), '1/2 in bowl bit, 3/16 in corner', 'the suggested name');
    await shot(`842-bowl-form${sfx}.png`, '#tool-table-modal .tt-card', phone ? 2 : 1.5);
    await clickElRaw('#tool-table-modal .tt-save');
    await waitFor(`document.querySelector('#tool-table-modal .tt-form').hidden`, 'the bowl bit saved');
    await clickElRaw('#tool-table-modal .tt-close');
    await waitFor(`!document.getElementById('tool-table-modal').open`, 'the window closes');
    await clickElRaw('#prepare-panel .cut-bit-trigger');
    await waitFor(`!document.querySelector('.cut-bit-pop').hidden`, 'the Bit menu');
    const bowlId = await evalJs(`[...document.querySelectorAll('.cut-bit-opt')].find((o) => o.querySelector('.cut-opt-name').textContent === '1/2 in bowl bit, 3/16 in corner').dataset.bit`);
    await clickEl(`.cut-bit-opt[data-bit="${bowlId}"]`);
    await sleep(300);
    assert.strictEqual(await evalJs(`document.querySelector('.cut-bit-cur').textContent`), '1/2 in bowl bit, 3/16 in corner', 'the Pocket picked the bowl bit');
    await evalJs(`(() => { const i = document.querySelector('.cut-depth'); i.value = ${JSON.stringify(phone ? '0.3' : '8')}; i.dispatchEvent(new Event('change')); })()`); // blind: the floor and its rounded edge stay in the board
    await sleep(300);
    await clickElRaw('#prepare-panel .cut-ok');
    await sleep(600);
    const bowlRec = await evalJs(`import('/apps/shaper/src/operations-store.js').then((m) => { const r = m.storeOps().find((o) => o.type === 'pocket').settings; return [r.cutterShape, r.toolDia, Number(r.cornerRadius.toFixed(9))]; })`);
    assert.deepStrictEqual(bowlRec, ['bowl', 12.7, 4.7625], 'the operation holds the bowl: shape, diameter, corner radius');
    await openMode('review');
    await clickEl('#review-view-3d');
    await waitFor(`/triangles/.test(document.getElementById('review-info').textContent)`, 'the 3D board');
    await sleep(1200);
    // zoom the 3D view onto the pocket's floor edge (the wheel, at the pocket's near corner), so the rounded edge is legible
    const at = await evalJs(`(() => { const r = document.querySelector('#review-stage').getBoundingClientRect(); return { x: Math.round(r.left + r.width * 0.45), y: Math.round(r.top + r.height * 0.3) }; })()`);
    for (let i = 0; i < 22; i++) { await t.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: at.x, y: at.y, deltaX: 0, deltaY: -120 }); await sleep(80); }
    await sleep(800);
    console.log('3D board: ' + await evalJs(`document.getElementById('review-info').textContent`));
    await shot(`852-bowl-3d${sfx}.png`, phone ? null : '#review-stage', phone ? 1 : 1.5);
    const E852 = path.resolve('.evidence/852c'); fs.mkdirSync(E852, { recursive: true });
    fs.copyFileSync(path.resolve('.evidence/842', `852-bowl-3d${sfx}.png`), path.join(E852, `852-bowl-3d${sfx}.png`));
    for (let i = 0; i < 16; i++) { await t.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: at.x, y: at.y, deltaX: 0, deltaY: -120 }); await sleep(80); } // closer: the corner
    await sleep(800);
    await shot(`852-bowl-3d-close${sfx}.png`, phone ? null : '#review-stage', phone ? 1 : 1.5);
    fs.copyFileSync(path.resolve('.evidence/842', `852-bowl-3d-close${sfx}.png`), path.join(E852, `852-bowl-3d-close${sfx}.png`));
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
