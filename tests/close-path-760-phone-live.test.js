// tests/close-path-760-phone-live.test.js — TASK 760: Close path on a PHONE (SketchStudio, 390 x 844, touch; tests/helpers/close-path-live.js). The fixture (a 30 x 20 mm
// plate 0.08 mm short of closed + an open engraving zigzag) is dropped on the canvas:
//  1. the import's offer notice: its "Close them" button is a finger target (>= 44 px tall); a tap on it closes the plate (one line); Ctrl+Z puts it back;
//  2. the ribbon (Modify's dropdown, by taps): Close path marks the 4 open ends; a tap on the plate's edge closes it; Ctrl+Z;
//  3. touch and hold: the plate selected (a double tap enters the file group), the hold menu offers "Close path" (row >= 44 px) and a tap on it closes the plate.
// Screenshots: .evidence/760/phone-*.png
import assert from 'node:assert';
import { openClosePathPage, HOSTS, IMPORTED, OFFER_TEXT } from './helpers/close-path-live.js';
import { sleep } from './helpers/cdp-browser.js';

const t = await openClosePathPage(HOSTS.sketchstudio, { phone: true });
if (!t) console.log('skipped: no headless Edge/Chrome binary installed');
else {
  const out = {};
  try {
    const base = await t.open();
    const o = await t.offer();
    assert.deepStrictEqual(o && [o.text, o.label], [OFFER_TEXT, 'Close them'], '1: the offer notice');
    out.btnH = Math.round(o.btn.h);
    assert.ok(out.btnH >= 44, '1: Close them is >= 44 px tall on a phone: ' + out.btnH);
    await t.shot('phone-offer-notice.png', o.clip);
    await t.tap(o.btn);
    assert.strictEqual(await t.shapeCount(), base + IMPORTED + 1, '1: a tap on Close them closed the plate');
    await t.keys.undo();
    assert.strictEqual(await t.shapeCount(), base + IMPORTED, '1: Ctrl+Z');
    // 2. the ribbon by taps
    await t.ribbon('tool-closePath');
    assert.ok(await t.toolActive(), '2: Close path from the ribbon');
    out.markers = await t.markers();
    assert.strictEqual(out.markers, 4, '2: the 4 open ends marked');
    await sleep(300);
    await t.shot('phone-open-end-markers.png', { x: 0, y: 0, width: 390, height: 844, scale: 1 });
    await t.tap(await t.toScreen(25, 10));
    out.toolClose = { shapes: await t.shapeCount(), markers: await t.markers() };
    assert.deepStrictEqual(out.toolClose, { shapes: base + IMPORTED + 1, markers: 2 }, '2: a tap on the plate closed it');
    await t.keys.undo();
    assert.strictEqual(await t.shapeCount(), base + IMPORTED, '2: Ctrl+Z');
    // 3. touch and hold
    await t.ribbon('tool-select');
    const edge = await t.toScreen(25, 10);
    await t.dblclick(edge); // a double tap enters the file group: the plate selected
    await t.menuAt(edge);
    out.menu = await t.menuIds();
    const row = await t.menuRow('geo-close-path');
    assert.ok(row && row.h >= 44, '3: the hold menu offers Close path, a 44 px row: ' + JSON.stringify({ menu: out.menu, row }));
    await t.shot('phone-hold-menu.png', await t.evalJs(`(() => { const r = document.querySelector('.sk-context-menu').getBoundingClientRect(); return { x: Math.max(0, r.left - 10), y: Math.max(0, r.top - 10), width: Math.min(390, r.width + 20), height: r.height + 20 }; })()`));
    await t.tap(row);
    assert.strictEqual(await t.shapeCount(), base + IMPORTED + 1, '3: Close path (hold menu) closed the plate');
    console.log(`close-path-760-phone-live: ALL CHECKS PASSED ${JSON.stringify(out)}`);
  } finally { await t.close(); }
}
