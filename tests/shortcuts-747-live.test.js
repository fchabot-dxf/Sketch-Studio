// tests/shortcuts-747-live.test.js: TASK 747 (live headless, REAL mouse / touch / keys): the user changes a keyboard shortcut in Settings > Shortcuts.
//  A. SketchStudio and Shaper, desktop 1280: draw a line, then in the Line row: a bare Shift waits, Ctrl+F is refused with its reason (still waiting),
//     Ctrl+Z is a conflict with Undo (the line is NOT undone: no shortcut fires while capturing) -> Cancel; Esc cancels a capture and keeps Settings
//     open; a click elsewhere cancels; K is a conflict with Construction (no tool switch, Construction not toggled) -> Swap: Line = K, Construction = L,
//     both rows marked changed with Reset, the Line button says "Line (K)", the Construction button "(L)"; then K draws a line and L is no longer Line;
//     a reload keeps K; x leaves Line with no key ("none", title "Line"), its Reset brings K's default back; Reset all (inline confirm) -> L again.
//  B. Pen Plotter and Trace: a key changed in SketchStudio is theirs too (one setting): "Line (K)", K picks Line, the row shows K changed.
//  C. phone 390 (touch): the tab lays out with 44 px targets and nothing overflows; a tap on a key button waits for a key; a tap elsewhere cancels.
// Screenshots: .evidence/747.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sendRealKey } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EVID = path.join(process.cwd(), '.evidence', '747');

await (async () => {
  const cdp = await launchBrowser({ tag: '747', width: 1280, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, once, evalJs, waitFor } = cdp;
  try {
    fs.mkdirSync(EVID, { recursive: true });
    const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const click = async (x, y) => { await mouse('mouseMoved', x, y, 0); await sleep(60); await mouse('mousePressed', x, y, 1); await sleep(40); await mouse('mouseReleased', x, y, 0); await sleep(250); };
    const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
    const tap = async (x, y) => { await T('touchStart', [{ x, y }]); await sleep(40); await T('touchEnd', []); await sleep(400); };
    const centerOf = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    const clickSel = async (sel) => { await evalJs(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({ block: 'nearest' })`); const c = await centerOf(sel); assert(c, sel + ' not found'); await click(c.x, c.y); };
    // a real key: Ctrl 2, Shift 8, Alt 1 (a letter with Ctrl / Alt types no text)
    const press = async (ch, { shift = false, ctrl = false, alt = false } = {}) => {
      const up = ch.toUpperCase();
      const mods = (alt ? 1 : 0) | (ctrl ? 2 : 0) | (shift ? 8 : 0);
      const k = shift ? up : ch;
      await sendRealKey(send, k, 'Key' + up, up.charCodeAt(0), mods, ctrl || alt ? '' : k);
      await sleep(250);
    };
    const esc = async () => { await sendRealKey(send, 'Escape', 'Escape', 27, 0); await sleep(250); };
    const shiftAlone = async () => { await sendRealKey(send, 'Shift', 'ShiftLeft', 16, 8); await sleep(200); };
    const shot = async (file, sel, maxH = null) => {
      const clip = await evalJs(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); const h = Math.min(innerHeight - Math.max(0, r.top - 8), r.height + 16, ${maxH || 99999}); return { x: Math.max(0, r.left - 8), y: Math.max(0, r.top - 8), width: Math.min(innerWidth, r.width + 16), height: h }; })()`);
      const r = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 2 } });
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
      await waitFor(`!!document.querySelector('${h.canvas}') && document.querySelector('${h.canvas}').getBoundingClientRect().width > 100 && !!document.getElementById('tool-line')`, name + ' canvas'); await sleep(300);
    };
    const panelOpen = () => evalJs(`(() => { const p = document.querySelector('.sk-style-panel'); return !!p && !p.classList.contains('sk-hidden'); })()`);
    const openShortcuts = async (pressSel = clickSel) => {
      if (!(await panelOpen())) await pressSel('#btn-settings');
      assert.strictEqual(await panelOpen(), true, 'Settings is open');
      await pressSel('#sk-style-tab-shortcuts');
      assert.strictEqual(await evalJs(`document.getElementById('sk-style-tab-shortcuts').getAttribute('aria-selected')`), 'true', 'the Shortcuts tab');
    };
    const closeSettings = async () => { if (await panelOpen()) await clickSel('.sk-style-close'); assert.strictEqual(await panelOpen(), false, 'Settings closed'); };
    const R = (id) => `.sk-shortcut-row[data-id="${id}"]`;
    const row = (id) => evalJs(`(() => { const r = document.querySelector('${R(id)}'); if (!r) return null; const vis = (e) => !!e && !e.hidden && e.getBoundingClientRect().height > 0;
      const m = r.querySelector('.sk-shortcut-msg');
      return { keys: [...r.querySelectorAll('.sk-shortcut-keys kbd')].map((k) => k.textContent), none: !!r.querySelector('.sk-shortcut-none'), changed: r.classList.contains('sk-shortcut-changed'),
        capturing: r.classList.contains('sk-shortcut-capturing'), msg: vis(m) ? m.textContent : '', reset: vis(r.querySelector('.sk-shortcut-reset')), clear: vis(r.querySelector('.sk-shortcut-clear')),
        swap: vis(r.querySelector('.sk-shortcut-swap')) }; })()`);
    const isActive = (tool) => evalJs(`(() => { const b = document.getElementById('tool-${tool}'); return !!b && b.classList.contains('active'); })()`);
    const activeTools = () => evalJs(`[...document.querySelectorAll('.sk-ribbon-btn.active')].map((b) => b.id)`);
    const construction = () => evalJs(`(() => { const b = document.getElementById('btn-construct-toggle'); return b ? { on: b.getAttribute('aria-pressed'), title: b.title } : null; })()`);
    const title = (id) => evalJs(`document.getElementById('${id}').title`);
    const stored = () => evalJs(`(() => { const s = JSON.parse(localStorage.getItem('sketch-studio-settings') || '{}'); return s.SHORTCUT_KEYS || null; })()`);
    const toSelect = async () => { for (let i = 0; i < 4 && !(await isActive('select')); i++) await esc(); assert.strictEqual(await isActive('select'), true, 'back to Select: ' + JSON.stringify(await activeTools())); };

    // start clean: no stored keys
    await open('sketchstudio');
    await evalJs(`localStorage.removeItem('sketch-studio-settings')`);

    // ── A. SketchStudio, then Shaper ──
    for (const name of ['sketchstudio', 'shaper']) {
      const h = HOSTS[name];
      await open(name);
      assert.strictEqual(await title('tool-line'), 'Line (L)', name + ': starts at the default');
      const shapes = () => evalJs(`document.querySelectorAll('${h.canvas} [data-shape-id]').length`);
      const cr = await evalJs(`(() => { const r = document.querySelector('${h.canvas}').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
      const drawLine = async (dy) => { await click(cr.x - 120, cr.y + dy); await click(cr.x + 120, cr.y + dy); await esc(); };
      // a line to undo
      await toSelect();
      await press('l'); assert.strictEqual(await isActive('line'), true, name + ': L = Line');
      const base = await shapes();
      await drawLine(-60); await toSelect();
      assert(await shapes() > base, name + ': a line was drawn');
      const drawn = await shapes();

      await openShortcuts();
      assert.deepStrictEqual(await row('tool.line'), { keys: ['L'], none: false, changed: false, capturing: false, msg: '', reset: false, clear: true, swap: false }, name + ': Line row at rest');
      assert.strictEqual(await evalJs(`document.querySelector('.sk-shortcuts-resetall').disabled`), true, name + ': nothing to reset yet');
      if (name === 'sketchstudio') await shot('normal-list.png', '.sk-style-panel', 560);
      // a fixed row: its keys, no button, and why (Esc is what cancels a capture)
      const fixed = await evalJs(`(() => { const r = document.querySelector('${R('edit.cancel')}'); return { button: !!r.querySelector('button.sk-shortcut-keys'), why: r.querySelector('.sk-shortcut-why').textContent, keys: [...r.querySelectorAll('kbd')].map((k) => k.textContent) }; })()`);
      assert.deepStrictEqual(fixed, { button: false, why: 'Fixed: Esc is the one Cancel everywhere (it also cancels a key change here)', keys: ['Esc'] }, name + ': the Cancel row is fixed, with its reason');
      if (name === 'sketchstudio') { await evalJs(`document.querySelector('${R('edit.cancel')}').scrollIntoView({ block: 'center' })`); await shot('fixed-row.png', '.sk-style-panel', 800); await evalJs(`document.querySelector('.sk-style-panel').scrollTop = 0`); }
      // a capture: bare Shift waits, a refused key says why and keeps waiting, Ctrl+Z is Undo's (and is NOT undone)
      await clickSel(R('tool.line') + ' .sk-shortcut-keys');
      let r = await row('tool.line');
      assert(r.capturing && /Press the new key for Line \(Esc cancels\)/.test(r.msg), name + ': waiting for a key ' + JSON.stringify(r));
      if (name === 'sketchstudio') await shot('capturing-row.png', '.sk-style-panel', 360);
      await shiftAlone();
      assert.strictEqual((await row('tool.line')).capturing, true, name + ': Shift alone: still waiting');
      await press('f', { ctrl: true });
      r = await row('tool.line');
      assert(r.capturing && r.msg.includes('Ctrl+F cannot be a shortcut: it finds in the page'), name + ': Ctrl+F refused with its reason ' + JSON.stringify(r));
      if (name === 'sketchstudio') await shot('refused-row.png', '.sk-style-panel', 360);
      await press('z', { ctrl: true });
      r = await row('tool.line');
      assert(!r.capturing && r.msg.startsWith('Ctrl+Z is used by Undo.') && r.swap, name + ': Ctrl+Z: a conflict with Undo ' + JSON.stringify(r));
      assert.strictEqual(await shapes(), drawn, name + ': the Ctrl+Z captured did NOT undo the line (no shortcut fires while capturing)');
      await clickSel(R('tool.line') + ' .sk-shortcut-cancel');
      assert.deepStrictEqual((await row('tool.line')).keys, ['L'], name + ': Cancel: unchanged');
      // Esc cancels a capture and keeps Settings open; a click elsewhere cancels
      await clickSel(R('tool.line') + ' .sk-shortcut-keys'); await esc();
      assert.strictEqual((await row('tool.line')).capturing, false, name + ': Esc cancels the capture');
      assert.strictEqual(await panelOpen(), true, name + ': ... and does not close Settings');
      await clickSel(R('tool.line') + ' .sk-shortcut-keys'); await clickSel('.sk-style-title');
      assert.strictEqual((await row('tool.line')).capturing, false, name + ': a click elsewhere cancels');
      // K: Construction's; the capture switches no tool and toggles nothing
      const cons0 = await construction();
      await clickSel(R('tool.line') + ' .sk-shortcut-keys'); await press('k');
      r = await row('tool.line');
      assert(r.msg.startsWith('K is used by Construction on / off.') && r.swap, name + ': K: a conflict with Construction, Swap offered ' + JSON.stringify(r));
      assert.deepStrictEqual(await construction(), cons0, name + ': the captured K did not toggle Construction');
      assert.strictEqual(await isActive('select'), true, name + ': and switched no tool');
      if (name === 'sketchstudio') await shot('conflict-row.png', '.sk-style-panel', 400);
      await clickSel(R('tool.line') + ' .sk-shortcut-swap');
      assert.deepStrictEqual(await row('tool.line'), { keys: ['K'], none: false, changed: true, capturing: false, msg: '', reset: true, clear: true, swap: false }, name + ': Line = K, marked, Reset shown');
      const consRow = await row('sketch.construction');
      assert(consRow.changed && consRow.reset && consRow.keys.join() === 'L', name + ': Construction took L ' + JSON.stringify(consRow));
      assert.strictEqual(await title('tool-line'), 'Line (K)', name + ': the Line button says (K) at once');
      assert.strictEqual((await construction()).title, 'Construction: OFF (L)', name + ': the Construction button says (L) at once');
      assert.deepStrictEqual(Object.keys((await stored()).keys).sort(), ['sketch.construction', 'tool.line'], name + ': ONE setting, only the changed ids');
      assert.strictEqual(await evalJs(`document.querySelector('.sk-shortcuts-resetall').disabled`), false);
      if (name === 'sketchstudio') await shot('changed-row.png', '.sk-style-panel', 400);
      await closeSettings();
      // K draws a line, L is no longer Line
      await toSelect();
      await press('l'); assert.strictEqual(await isActive('line'), false, name + ': L no longer picks Line');
      assert.strictEqual((await construction()).on, String(cons0.on !== 'true'), name + ': L toggles Construction now');
      await press('l'); assert.deepStrictEqual((await construction()).on, cons0.on, name + ': (toggled back)');
      await press('k'); assert.strictEqual(await isActive('line'), true, name + ': K picks Line');
      const b2 = await shapes(); await drawLine(60); await toSelect();
      assert(await shapes() > b2, name + ': K drew a line');
      // a reload keeps K
      await open(name);
      assert.strictEqual(await title('tool-line'), 'Line (K)', name + ': after a reload: still (K)');
      await toSelect(); await press('k'); assert.strictEqual(await isActive('line'), true, name + ': after a reload K picks Line');
      await toSelect();
      // x: no key; its Reset: the default back
      await openShortcuts();
      await clickSel(R('tool.line') + ' .sk-shortcut-clear');
      r = await row('tool.line');
      assert(r.none && r.keys.length === 0 && r.changed && !r.clear, name + ': x: "none" ' + JSON.stringify(r));
      assert.strictEqual(await title('tool-line'), 'Line', name + ': its tooltip shows no key');
      // its Reset: L, but Construction has L now: the same conflict question (Cancel keeps "none")
      await clickSel(R('tool.line') + ' .sk-shortcut-reset');
      r = await row('tool.line');
      assert(r.none && r.msg.startsWith('L is used by Construction on / off.') && r.swap, name + ': Reset: L is now Construction key ' + JSON.stringify(r));
      await clickSel(R('tool.line') + ' .sk-shortcut-cancel');
      assert.strictEqual((await row('tool.line')).none, true, name + ': Cancel: still none');
      // Reset all: an inline confirm, then every default
      await clickSel('.sk-shortcuts-resetall');
      assert.strictEqual(await evalJs(`!document.querySelector('.sk-shortcuts-confirm').hidden`), true, name + ': Reset all asks inline');
      if (name === 'sketchstudio') await shot('reset-confirm.png', '.sk-style-panel', 300);
      await clickSel('.sk-shortcuts-confirm-ok');
      assert.deepStrictEqual(await row('tool.line'), { keys: ['L'], none: false, changed: false, capturing: false, msg: '', reset: false, clear: true, swap: false }, name + ': Reset all: L, unmarked');
      assert.deepStrictEqual((await row('sketch.construction')).keys, ['K'], name + ': Construction K again');
      assert.deepStrictEqual(await stored(), { v: 1, keys: {} }, name + ': nothing stored');
      assert.strictEqual(await title('tool-line'), 'Line (L)', name + ': the tooltip (L) at once');
      if (name === 'sketchstudio') await shot('reset.png', '.sk-style-panel', 400);
      await closeSettings();
      await toSelect(); await press('l'); assert.strictEqual(await isActive('line'), true, name + ': L picks Line again');
      await toSelect();
      console.log(name, 'A ok: refused, conflict + Cancel, Esc / click-away cancel, Swap, K draws, reload, none, reset, Reset all');
    }

    // ── B. one setting for all four apps: changed in SketchStudio, seen in Pen Plotter and Trace ──
    await open('sketchstudio');
    await openShortcuts();
    await clickSel(R('tool.line') + ' .sk-shortcut-keys'); await press('k'); await clickSel(R('tool.line') + ' .sk-shortcut-swap');
    assert.deepStrictEqual((await row('tool.line')).keys, ['K'], 'SketchStudio: Line = K');
    for (const name of ['penplotter', 'trace']) {
      await open(name);
      assert.strictEqual(await title('tool-line'), 'Line (K)', name + ': "Line (K)"');
      await toSelect(); await press('k'); assert.strictEqual(await isActive('line'), true, name + ': K picks Line'); await toSelect();
      await openShortcuts();
      const r = await row('tool.line');
      assert(r.changed && r.keys.join() === 'K', name + ': the row shows K, changed ' + JSON.stringify(r));
      await closeSettings();
      console.log(name, 'B ok: the key changed in SketchStudio is theirs too');
    }
    await openShortcuts(); await clickSel('.sk-shortcuts-resetall'); await clickSel('.sk-shortcuts-confirm-ok');
    assert.deepStrictEqual(await stored(), { v: 1, keys: {} }, 'Reset all from Trace');
    await closeSettings();

    // ── C. phone 390, touch ──
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    const tapSel = async (sel) => { await evalJs(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({ block: 'nearest' })`); const c = await centerOf(sel); assert(c, sel + ' not found'); await tap(c.x, c.y); };
    for (const name of ['sketchstudio', 'shaper']) {
      await open(name);
      await openShortcuts(tapSel);
      const small = await evalJs(`[...document.querySelectorAll('.sk-shortcuts button')].filter((b) => !b.hidden && b.getBoundingClientRect().height > 0 && !b.closest('[hidden]'))
        .map((b) => { const r = b.getBoundingClientRect(); return { c: b.className, w: Math.round(r.width), h: Math.round(r.height) }; }).filter((x) => x.w < 44 || x.h < 44)`);
      assert.deepStrictEqual(small, [], `phone ${name}: every button in the tab is >= 44 x 44`);
      const nKeys = await evalJs(`document.querySelectorAll('.sk-shortcuts button.sk-shortcut-keys').length`);
      assert(nKeys > 20, `phone ${name}: the key buttons are there (${nKeys})`);
      const fit = await evalJs(`(() => { const p = document.querySelector('.sk-style-panel'), r = p.getBoundingClientRect();
        const rows = [...document.querySelectorAll('.sk-shortcut-row')].filter((x) => x.scrollWidth > x.clientWidth + 1).map((x) => x.dataset.id);
        return { left: r.left, right: r.right, vw: innerWidth, pageSW: document.documentElement.scrollWidth, pSW: p.scrollWidth, pCW: p.clientWidth, rows }; })()`);
      assert(fit.left >= -0.5 && fit.right <= fit.vw + 0.5 && fit.pageSW <= fit.vw + 0.5 && fit.pSW <= fit.pCW + 0.5 && !fit.rows.length, `phone ${name}: fits, nothing overflows ` + JSON.stringify(fit));
      await tapSel(R('tool.line') + ' .sk-shortcut-keys');
      assert.strictEqual((await row('tool.line')).capturing, true, `phone ${name}: a tap waits for a key (a keyboard)`);
      if (name === 'sketchstudio') await shot('phone-capturing.png', '.sk-style-panel', 700);
      await tapSel('.sk-shortcuts-filter');
      assert.strictEqual((await row('tool.line')).capturing, false, `phone ${name}: a tap elsewhere cancels`);
      if (name === 'sketchstudio') await shot('phone-list.png', '.sk-style-panel', 900);
      console.log(`phone ${name} C ok: ${nKeys} key buttons, all targets >= 44 px, fits`);
    }
    console.log('shortcuts-747-live: ok');
  } finally { await cdp.close(); }
})();
process.exit(0);
