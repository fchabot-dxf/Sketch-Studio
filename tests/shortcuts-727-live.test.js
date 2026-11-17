// tests/shortcuts-727-live.test.js: TASK 727 (live headless, REAL mouse / touch / keys), all four apps, desktop 1280 and phone 390.
//  A. Settings (the footer gear) > Shortcuts: the app's shortcuts from THE declaration (shortcuts.js), grouped; e.g. Ctrl+Z Undo, L Line, R Rectangle,
//     D Dimension, Ctrl+G Group (TASK 756: every app); the filter box narrows the list; nothing scrolls sideways at 390 px.
//  B. SketchStudio with the dev-only Solver Tuning panel loaded (it loads on 127.0.0.1): T switches to Perpendicular ONLY (ruling 1: the panel gave
//     its T up); the drawer's "Tune solver" item has its gear icon and opens the panel; Esc (the one Cancel) closes it. Shaper's Settings item has the icon.
//  C. Delete on a focused document tab is the tab's (its close question) and the selected line SURVIVES; Delete on the canvas still deletes it.
// Screenshots: .evidence/727.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sendRealKey } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EVID = path.join(process.cwd(), '.evidence', '727');

await (async () => {
  const cdp = await launchBrowser({ tag: '727', width: 1280, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, once, evalJs, waitFor } = cdp;
  try {
    fs.mkdirSync(EVID, { recursive: true });
    const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const click = async (x, y) => { await mouse('mouseMoved', x, y, 0); await sleep(60); await mouse('mousePressed', x, y, 1); await sleep(40); await mouse('mouseReleased', x, y, 0); await sleep(250); };
    const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
    const tap = async (x, y) => { await T('touchStart', [{ x, y }]); await sleep(40); await T('touchEnd', []); await sleep(400); };
    const centerOf = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    const key = async (k, code, vk, text = '') => { await sendRealKey(send, k, code, vk, 0, text); await sleep(250); };
    const shot = async (file, sel) => {
      const clip = sel ? await evalJs(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.max(0, r.left - 8), y: Math.max(0, r.top - 8), width: Math.min(innerWidth, r.width + 16), height: Math.min(innerHeight, r.height + 16) }; })()`) : null;
      const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 2 } } : {}) });
      fs.writeFileSync(path.join(EVID, file), Buffer.from(r.data, 'base64'));
    };
    let lastApp = null; // TASK 684: the open tabs are ONE list for all apps
    const goto = async (url, readyExpr) => { const app = url.split('/')[2]; if (lastApp && lastApp !== app) await resetBufferLive(cdp); lastApp = app; const loaded = once('Page.loadEventFired'); await send('Page.navigate', { url: `http://127.0.0.1:${port}${url}` }); await Promise.race([loaded, sleep(8000)]); await waitFor(readyExpr, url + ' ready'); await sleep(600); };
    const HOSTS = {
      sketchstudio: { url: '/apps/sketchstudio/index.html', enter: null, ready: `!!document.querySelector('#svgCanvas')`, canvas: '#svgCanvas' },
      shaper:       { url: '/apps/shaper/index.html', enter: '.sk-header-tab[data-tab="design"]', ready: `!!document.querySelector('.sk-header-tab[data-tab="design"]')`, canvas: '#design-canvas' },
      penplotter:   { url: '/apps/penplotter/index.html', enter: '.sk-header-tab[data-tab="design"]', ready: `!!document.querySelector('.sk-header-tab[data-tab="design"]')`, canvas: '#design-canvas' },
      trace:        { url: '/apps/trace/index.html', enter: '.sk-header-tab[data-tab="edit"]', ready: `!!document.querySelector('.sk-header-tab[data-tab="edit"]')`, canvas: '#design-canvas' },
    };
    const open = async (name) => {
      const h = HOSTS[name]; await goto(h.url, h.ready);
      if (h.enter) { await evalJs(`document.querySelector(${JSON.stringify(h.enter)}).click()`); await sleep(800); }
      await waitFor(`!!document.querySelector('${h.canvas}') && document.querySelector('${h.canvas}').getBoundingClientRect().width > 100`, name + ' canvas'); await sleep(300);
    };
    const panelOpen = () => evalJs(`(() => { const p = document.querySelector('.sk-style-panel'); return !!p && !p.classList.contains('sk-hidden'); })()`);
    const row = (id) => evalJs(`(() => { const r = document.querySelector('.sk-shortcut-row[data-id="${id}"]'); if (!r) return null; return { keys: [...r.querySelectorAll('kbd')].map((k) => k.textContent), label: r.querySelector('.sk-shortcut-label').textContent, shown: !r.hidden && r.getBoundingClientRect().height > 0 }; })()`);
    const activeTool = () => evalJs(`(() => { const a = document.querySelector('.sk-ribbon [aria-pressed="true"], .sk-ribbon .active'); return a ? a.id : null; })()`);
    const visibleRows = () => evalJs(`[...document.querySelectorAll('.sk-shortcut-row')].filter((r) => !r.hidden && r.getBoundingClientRect().height > 0).map((r) => r.dataset.id)`);

    // ── A. Settings > Shortcuts, every app, desktop then phone ──
    const runA = async (tag, press) => {
      for (const name of Object.keys(HOSTS)) {
        await open(name);
        await press('#btn-settings'); assert.strictEqual(await panelOpen(), true, `${tag} ${name}: the gear opens Settings`);
        await press('#sk-style-tab-shortcuts');
        assert.strictEqual(await evalJs(`document.getElementById('sk-style-tab-shortcuts').getAttribute('aria-selected')`), 'true', `${tag} ${name}: the Shortcuts tab is selected`);
        const heads = await evalJs(`[...document.querySelectorAll('.sk-shortcuts-head')].filter((h) => h.getBoundingClientRect().height > 0).map((h) => h.textContent)`);
        assert.deepStrictEqual(heads.slice(0, 3), ['Tools', 'Constrain', 'Edit'], `${tag} ${name}: grouped under short headings ` + JSON.stringify(heads));
        assert.deepStrictEqual(await row('edit.undo'), { keys: ['Ctrl', 'Z'], label: 'Undo', shown: true }, `${tag} ${name}: Ctrl+Z Undo`);
        assert.deepStrictEqual(await row('tool.line'), { keys: ['L'], label: 'Line', shown: true }, `${tag} ${name}: L Line`);
        assert.deepStrictEqual(await row('tool.rect'), { keys: ['R'], label: 'Rectangle', shown: true }, `${tag} ${name}: R Rectangle`);
        assert.deepStrictEqual(await row('tool.dimension'), { keys: ['D'], label: 'Dimension', shown: true }, `${tag} ${name}: D Dimension`);
        assert.deepStrictEqual(await row('tool.perpendicular'), { keys: ['T'], label: 'Perpendicular', shown: true }, `${tag} ${name}: T Perpendicular`);
        const group = await row('sketch.group');
        assert.deepStrictEqual(group, { keys: ['Ctrl', 'G'], label: 'Group', shown: true }, `${name}: Ctrl+G Group (TASK 756: user groups in every app)`);
        assert.strictEqual(await row('plotter.art.line'), null, `${name}: the removed art-tool keys have no row`);
        const fit = await evalJs(`(() => { const p = document.querySelector('.sk-style-panel'), r = p.getBoundingClientRect(); return { left: r.left, right: r.right, vw: innerWidth, pageSW: document.documentElement.scrollWidth, pSW: p.scrollWidth, pCW: p.clientWidth }; })()`);
        assert(fit.left >= -0.5 && fit.right <= fit.vw + 0.5 && fit.pageSW <= fit.vw + 0.5 && fit.pSW <= fit.pCW + 0.5, `${tag} ${name}: fits, no sideways scroll ` + JSON.stringify(fit));
        const all = await visibleRows();
        await shot(`${tag}-${name}-shortcuts.png`, '.sk-style-panel');
        // the filter narrows the list (real typing into the box)
        await press('.sk-shortcuts-filter');
        assert.strictEqual(await evalJs(`document.activeElement && document.activeElement.className`), 'sk-shortcuts-filter', `${tag} ${name}: the filter has the focus`);
        const toolBefore = await activeTool();
        await send('Input.insertText', { text: 'line' }); await sleep(250);
        const narrowed = await visibleRows();
        assert(narrowed.includes('tool.line') && !narrowed.includes('edit.undo') && narrowed.length < all.length, `${tag} ${name}: "line" narrows the list ` + JSON.stringify(narrowed));
        assert.strictEqual(await activeTool(), toolBefore, `${tag} ${name}: typing "line" in the filter is not the L key (the tool did not change)`);
        await shot(`${tag}-${name}-filtered.png`, '.sk-style-panel');
        await evalJs(`(() => { const f = document.querySelector('.sk-shortcuts-filter'); f.select(); })()`);
        await send('Input.insertText', { text: 'zzzz' }); await sleep(200);
        assert.deepStrictEqual(await visibleRows(), [], `${tag} ${name}: nothing matches "zzzz"`);
        assert.strictEqual(await evalJs(`!document.querySelector('.sk-shortcuts-empty').hidden`), true, 'the "No shortcut matches." line shows');
        await evalJs(`(() => { const f = document.querySelector('.sk-shortcuts-filter'); f.select(); })()`);
        await key('Backspace', 'Backspace', 8); // clears the box (a text field keeps its Backspace: the canvas Delete never sees it)
        assert.strictEqual((await visibleRows()).length, all.length, `${tag} ${name}: an empty filter shows them all again`);
        await press('#btn-settings'); assert.strictEqual(await panelOpen(), false, `${tag} ${name}: the gear closes it`);
        console.log(tag, name, 'A ok', all.length, 'rows,', narrowed.length, 'for "line"');
      }
    };
    await runA('desktop', async (sel) => { const c = await centerOf(sel); assert(c, sel + ' not found'); await click(c.x, c.y); });

    // ── B. SketchStudio: T is only Perpendicular, even with the tuning panel loaded ──
    await open('sketchstudio');
    await waitFor(`!!document.getElementById('tuning-wizard-panel')`, 'the dev-only Solver Tuning panel is loaded (127.0.0.1)');
    const state = () => evalJs(`(() => { const p = document.getElementById('tuning-wizard-panel'); const a = document.querySelector('.sk-ribbon [aria-pressed="true"], .sk-ribbon .active'); return { tuning: getComputedStyle(p).display, tool: a ? a.id : null }; })()`);
    assert.deepStrictEqual(await state(), { tuning: 'none', tool: 'tool-select' }, 'start: Select, no tuning panel');
    await key('t', 'KeyT', 84, 't');
    assert.deepStrictEqual(await state(), { tuning: 'none', tool: 'tool-perp' }, 'T: Perpendicular only (the tuning panel stays shut)');
    await key('Escape', 'Escape', 27);
    assert.deepStrictEqual(await state(), { tuning: 'none', tool: 'tool-select' }, 'Esc: back to Select');
    await evalJs(`document.querySelector('.sk-sidebar-btn').click()`); await sleep(300);
    const tuneIcon = await evalJs(`(() => { const i = document.querySelector('.sk-sidebar-item[data-action="tune"]'); return i ? { svg: !!i.querySelector('svg circle'), text: i.textContent.trim() } : null; })()`);
    assert.deepStrictEqual(tuneIcon, { svg: true, text: 'Tune solver' }, 'the drawer\'s Tune solver item has its gear icon');
    await shot('desktop-sketchstudio-drawer-tune.png', '.sk-sidebar');
    await evalJs(`document.querySelector('.sk-sidebar-item[data-action="tune"]').click()`); await sleep(400);
    assert.strictEqual((await state()).tuning, 'block', 'Tune solver opens the panel');
    await key('Escape', 'Escape', 27);
    assert.strictEqual((await state()).tuning, 'none', 'Esc (the one Cancel) closes it');
    console.log('B ok: T = Perpendicular only; Tune solver item has its icon');

    // ── C. Delete on a focused document tab: the tab's, the selected line survives ──
    const lines = () => evalJs(`document.querySelectorAll('#svgCanvas [data-shape-id]').length`);
    const base = await lines();
    await evalJs(`document.getElementById('tool-line').click()`); await sleep(200);
    await click(450, 400); await click(750, 400); await key('Escape', 'Escape', 27);
    await evalJs(`document.getElementById('tool-select').click()`); await sleep(200);
    assert.strictEqual(await lines(), base + 1, 'a line was drawn');
    await click(600, 400);
    const selected = () => evalJs(`!document.getElementById('btn-delete-selection').disabled`); // the footer's Delete is live only with a selection
    await waitFor(`!document.getElementById('btn-delete-selection').disabled`, 'the line is selected');
    await evalJs(`document.querySelector('.sk-doctab-main').focus()`); await sleep(200); // a keyboard user Tabs onto the tab (a mouse press does not keep the focus there)
    assert.strictEqual(await evalJs(`document.activeElement.className`), 'sk-doctab-main', 'the document tab has the focus');
    await key('Delete', 'Delete', 46); await sleep(500);
    assert.strictEqual(await lines(), base + 1, 'Delete on the focused tab did NOT delete the selected line');
    assert.strictEqual(await selected(), true, 'and the line is still selected');
    await waitFor(`!!document.querySelector('.sk-tp-backdrop [role="dialog"]')`, 'the tab\'s own Delete: its close question');
    await shot('desktop-doctab-delete-close-question.png');
    await key('Escape', 'Escape', 27); // Cancel: the tab stays
    await waitFor(`!document.querySelector('.sk-tp-backdrop')`, 'the question is gone');
    await click(600, 400); // the line, selected again, on the canvas
    await key('Delete', 'Delete', 46);
    assert.strictEqual(await lines(), base, 'Delete on the canvas still deletes the selected line');
    console.log('C ok: Delete on a focused tab keeps the selection; on the canvas it deletes');

    // ── A on a phone, 390 px, touch ──
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await runA('phone390', async (sel) => { const c = await centerOf(sel); assert(c, sel + ' not found'); await tap(c.x, c.y); });

    // ── Shaper's drawer Settings item has the gear icon too ──
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await open('shaper');
    await evalJs(`document.querySelector('.sk-sidebar-btn').click()`); await sleep(300);
    assert.strictEqual(await evalJs(`!!document.querySelector('.sk-sidebar-item[data-action="settings"] svg circle')`), true, 'Shaper\'s Settings drawer item has its gear icon');
    await shot('desktop-shaper-drawer-settings.png', '.sk-sidebar');
    console.log('shortcuts-727-live: ok');
  } finally { await cdp.close(); }
})();
process.exit(0);
