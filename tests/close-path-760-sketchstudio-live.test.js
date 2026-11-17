// tests/close-path-760-sketchstudio-live.test.js — TASK 760: Close path in SketchStudio, in depth (desktop 1280 x 800, real mouse, wheel and keys;
// tests/helpers/close-path-live.js). The fixture (a 30 x 20 mm plate 0.08 mm short of closed + an open engraving zigzag) is dropped on the canvas:
//  1. the import's ONE notice with "Close them"; nothing closed by the import; zoomed on the gap (wheel at the plate's corner), the gap before, Close them,
//     the gap after (the closing line + its point); Ctrl+Z puts it back open (the import stays);
//  2. the ribbon: the Modify dropdown lists Close path right after Break; running it marks the 4 open ends (screenshot); a click on the plate's edge
//     closes the plate (one line more, 2 ends left marked); Ctrl+Z;
//  2b. (TASK 760b) a click on the art selects the whole file group; Shift+C on it closes only the near-closed plate, the zigzag keeps its 2 open ends;
//  3. Shift+C switches to the tool (S back to Select); C is still Circle;
//  4. the right-click menu: the plate selected (a double click enters the file group), "Close path" is offered and closes it; on the closed plate it is
//     not offered.
// Screenshots: .evidence/760/sketchstudio-*.png
import assert from 'node:assert';
import { openClosePathPage, HOSTS, IMPORTED, OFFER_TEXT } from './helpers/close-path-live.js';
import { sleep } from './helpers/cdp-browser.js';

const t = await openClosePathPage(HOSTS.sketchstudio);
if (!t) console.log('skipped: no headless Edge/Chrome binary installed');
else {
  const out = {};
  try {
    const base = await t.open();
    const o = await t.offer();
    assert.deepStrictEqual(o && [o.text, o.label], [OFFER_TEXT, 'Close them'], '1: the offer notice');
    await t.shot('sketchstudio-offer-notice.png', o.clip);
    // 1. zoom on the gap: the plate's start corner (10, 10), its end 0.08 mm below it. The corner is panned to the canvas centre first (a middle-button
    // drag), then the wheel zooms in there; afterwards the footer's Recenter puts the whole drawing back in view.
    const c0 = await t.toScreen(10, 10.04);
    const mid = await t.evalJs(`(() => { const r = document.querySelector('#svgCanvas').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await t.panDrag(c0, mid);
    const corner = await t.toScreen(10, 10.04);
    let zooms = 0;
    while (zooms < 12 && (await t.pxPerMm()) * 0.08 < 40) { await t.wheel(corner, -400, 2); zooms++; }
    out.gapPx = Math.round((await t.pxPerMm()) * 0.08);
    assert.ok(out.gapPx >= 40, '1: zoomed in so the 0.08 mm gap is >= 40 px: ' + out.gapPx);
    const gapClip = await t.worldClip(10 - 0.2, 10 - 0.15, 10 + 0.2, 10.08 + 0.15, 0);
    await t.shot('sketchstudio-gap-before.png', gapClip);
    const o2 = await t.offer();
    assert.ok(o2, '1: the offer is still shown');
    await t.click(o2.btn);
    out.closed = await t.shapeCount();
    assert.strictEqual(out.closed, base + IMPORTED + 1, '1: Close them: one closing line');
    await sleep(300);
    await t.shot('sketchstudio-gap-after-selected.png', gapClip); // the closed outline is selected (what was closed is seen)
    await t.keys.undo();
    assert.strictEqual(await t.shapeCount(), base + IMPORTED, '1: Ctrl+Z: open again, the import kept');
    await t.click(await t.evalJs(`(() => { const r = document.getElementById('btn-recenter-view').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`)); // Recenter
    // 2. the ribbon
    await t.evalJs(`document.querySelector('.sk-ribbon-group[data-section="modify"] .sk-ribbon-group-label').click()`); await sleep(250);
    out.dropdown = await t.evalJs(`[...document.querySelectorAll('.sk-ribbon-sect-menu.show .sk-ribbon-sect-item')].map((r) => r.dataset.id + ':' + r.textContent.trim())`);
    await t.keys.esc();
    assert.strictEqual(out.dropdown[out.dropdown.indexOf('tool-break:Break') + 1], 'tool-closePath:Close', '2: the Modify dropdown: Close right after Break: ' + out.dropdown);
    out.title = await t.evalJs(`document.getElementById('tool-closePath').title`);
    assert.strictEqual(out.title, 'Close path: join the two free ends of an open outline (Shift+C)', '2: the tooltip names the key');
    await t.ribbon('tool-closePath');
    assert.ok(await t.toolActive(), '2: the ribbon switched to Close path');
    out.markers = await t.markers();
    assert.strictEqual(out.markers, 4, '2: the 4 open ends marked');
    await t.shot('sketchstudio-open-end-markers.png', await t.worldClip(5, 5, 55, 85, 20));
    await t.click(await t.toScreen(25, 10)); // the plate's top edge
    out.toolClose = { shapes: await t.shapeCount(), markers: await t.markers() };
    assert.deepStrictEqual(out.toolClose, { shapes: base + IMPORTED + 1, markers: 2 }, '2: a click on the plate closes it: one line, 2 ends left');
    await t.keys.undo();
    assert.strictEqual(await t.markers(), 4, '2: Ctrl+Z: 4 open ends again');
    // 2b. TASK 760b: a click on the art with nothing entered selects the WHOLE file group; Close path (Shift+C) on that selection closes only the
    // near-closed plate: the engraving zigzag keeps its two free ends (it may be open on purpose)
    await t.keys.select();
    await t.click(await t.toScreen(25, 10));
    await t.keys.closePath();
    out.fileGroup = { shapes: await t.shapeCount(), markers: await t.markers() };
    assert.deepStrictEqual(out.fileGroup, { shapes: base + IMPORTED + 1, markers: 2 }, "2b: the whole file selected: only the plate closed, the zigzag's 2 ends still open");
    out.fileGroupNote = await t.evalJs(`[...document.querySelectorAll('#notification-container pre')].map((p) => p.textContent).filter((x) => x.startsWith('Close path:')).pop()`);
    assert.strictEqual(out.fileGroupNote, 'Close path: Closed 1 outline · 1 open path left open (click one with Close path to close it)', '2b: the notice');
    await t.keys.undo();
    assert.strictEqual(await t.shapeCount(), base + IMPORTED, '2b: Ctrl+Z');
    // 3. the keys
    await t.keys.select();
    assert.ok(!(await t.toolActive()) && (await t.markers()) === 0, '3: S: Select, no marker');
    await t.keys.closePath();
    assert.ok(await t.toolActive(), '3: Shift+C: Close path');
    await t.keys.select();
    // 4. the right-click menu: enter the file group (the plate's group selected), the menu on the plate
    const edge = await t.toScreen(25, 10);
    await t.dblclick(edge);
    await t.menuAt(edge);
    out.menu = await t.menuIds();
    assert.ok(out.menu.includes('geo-close-path'), '4: the plate selected: the menu offers Close path: ' + out.menu);
    assert.strictEqual(out.menu[out.menu.indexOf('geo-delete') + 1], 'geo-close-path', '4: right after Delete');
    await t.shot('sketchstudio-context-menu.png', await t.evalJs(`(() => { const r = document.querySelector('.sk-context-menu').getBoundingClientRect(); return { x: r.left - 10, y: r.top - 10, width: r.width + 20, height: r.height + 20 }; })()`));
    await t.click(await t.menuRow('geo-close-path'));
    assert.strictEqual(await t.shapeCount(), base + IMPORTED + 1, '4: Close path (menu) closed the plate');
    await t.menuAt(edge);
    out.menuClosed = await t.menuIds();
    assert.ok(!out.menuClosed.includes('geo-close-path'), '4: on the closed plate the menu has no Close path: ' + out.menuClosed);
    await t.keys.esc(); await t.keys.esc();
    console.log(`close-path-760-sketchstudio-live: ALL CHECKS PASSED ${JSON.stringify(out)}`);
  } finally { await t.close(); }
}
