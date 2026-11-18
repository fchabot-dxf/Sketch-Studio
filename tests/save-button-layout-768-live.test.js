// tests/save-button-layout-768-live.test.js — TASK 768: THE Save button in all four apps, in a real browser (no Google session at all: every non-local request
// blocked; the page's file pickers are a fake over an in-page "disk", as save-as-local-759-live).
//   A. every app (SketchStudio, Shaper, Pen Plotter, Trace), ONE page each, the viewport changed under it: desktop 1440 / 700 -> the button is the LAST child of the
//      header, right of the stage buttons (no overlap, header still one 44 px row); 430 / 390 / 360 phone portrait and 844 x 390 phone landscape (touch) -> the
//      header is hidden and the SAME button is at the right end of the document tab strip, icon only, 44 px wide and the strip's height, inside the screen,
//      on top at its centre (nothing covers it), not over the "+" or a tab, no sideways page scroll; back to desktop -> back in the header.
//   B. Shaper in Fusion mode (?host=fusion, no project layer): no Save button anywhere, the header unchanged (menu + stages).
//   C. SketchStudio in depth (desktop): new -> an edit -> "not saved"; a press opens THE Save as dialog; Local -> "Saved to <file>"; an edit + a press writes it
//      back -> saved; the stage buttons never move. Phone 390 (touch): an edit (made with the mouse, then the viewport set) -> not saved; a TAP on the strip's button writes the file back -> saved; with 5 tabs the active
//      tab and the "+" scrolled into view stay clear of the pinned button. THE spinner: role=status + text; with prefers-reduced-motion it does not turn.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sendRealKey, sleep } from './helpers/cdp-browser.js';
import { blockRemote } from './helpers/block-remote.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const EVID = path.resolve(process.env.EVIDENCE_DIR || '.evidence/768');
fs.mkdirSync(EVID, { recursive: true });
const FAKE_PICKER = `(() => {
  const disk = { get: (n) => sessionStorage.getItem('disk:' + n), set: (n, t) => sessionStorage.setItem('disk:' + n, t) };
  const count = (k) => sessionStorage.setItem(k, String(Number(sessionStorage.getItem(k) || 0) + 1));
  const handle = (name) => ({ kind: 'file', name, async queryPermission() { return 'granted'; }, async requestPermission() { return 'granted'; },
    async createWritable() { let buf = ''; return { async write(t) { buf += t; }, async close() { disk.set(name, buf); count('writes:' + name); } }; },
    async getFile() { return new File([disk.get(name)], name); } });
  window.showSaveFilePicker = async ({ suggestedName }) => handle(suggestedName);
})();`;
const APPS = [
  { id: 'sketchstudio', url: '/apps/sketchstudio/index.html', canvas: 'svgCanvas' },
  { id: 'shaper', url: '/apps/shaper/index.html', canvas: 'design-canvas' },
  { id: 'penplotter', url: '/apps/penplotter/index.html', ready: `!!document.querySelector('.sk-doctab')` },
  { id: 'trace', url: '/apps/trace/index.html', ready: `!!document.querySelector('.sk-doctab')` },
];
const SIZES = [
  { name: 'desktop-1440', w: 1440, h: 900, touch: false, phone: false },
  { name: 'desktop-700', w: 700, h: 900, touch: false, phone: false },
  { name: 'phone-430', w: 430, h: 932, touch: true, phone: true },
  { name: 'phone-390', w: 390, h: 844, touch: true, phone: true },
  { name: 'phone-360', w: 360, h: 780, touch: true, phone: true },
  { name: 'landscape-844x390', w: 844, h: 390, touch: true, phone: true },
];

await (async () => {
  const cdp = await launchBrowser({ tag: '768l', width: 1440, height: 900 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate, waitForApp } = cdp;
  const t0 = Date.now();
  const setSize = async (s) => {
    await send('Emulation.setDeviceMetricsOverride', { width: s.w, height: s.h, deviceScaleFactor: 2, mobile: s.touch, screenOrientation: s.w > s.h ? { type: 'landscapePrimary', angle: 90 } : { type: 'portraitPrimary', angle: 0 } });
    await send('Emulation.setTouchEmulationEnabled', { enabled: s.touch, maxTouchPoints: s.touch ? 5 : 0 });
    await sleep(150);
  };
  const shot = async (name, clip) => { const s = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 2 } }); fs.writeFileSync(path.join(EVID, name), Buffer.from(s.data, 'base64')); };
  const measure = () => evalJs(`(() => {
    const b = document.querySelector('.sk-save'); const r = b.getBoundingClientRect(); const R = (e) => { const q = e.getBoundingClientRect(); return { l: q.left, r: q.right, t: q.top, b: q.bottom }; };
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const header = document.querySelector('header.sk-header');
    const others = [...document.querySelectorAll('.sk-header-tab, .sk-sidebar-btn, .sk-doctab, .sk-doctab-new')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => ({ c: e.className.split(' ')[0], ...R(e) }));
    const tabH = document.querySelector('.sk-doctab') ? document.querySelector('.sk-doctab').getBoundingClientRect().height : null;
    const strip = document.querySelector('.sk-doctabs').getBoundingClientRect();
    return { parent: b.parentNode.className, stripR: strip.right, last: b.parentNode.lastElementChild === b, afterMenuBeforeTabs: !!(b.previousElementSibling?.classList.contains('sk-sidebar-btn') && b.nextElementSibling?.classList.contains('sk-header-tabs')), ...R(b), w: r.width, h: r.height, tabH,
      labelShown: getComputedStyle(b.querySelector('.sk-save-label')).display !== 'none', onTop: !!hit && (hit === b || b.contains(hit)),
      headerShown: getComputedStyle(header).display !== 'none', headerH: header.getBoundingClientRect().height, vw: innerWidth, scrollW: document.documentElement.scrollWidth,
      overlaps: others.filter((o) => o.l < r.right - 0.5 && o.r > r.left + 0.5 && o.t < r.bottom - 0.5 && o.b > r.top + 0.5).map((o) => o.c) };
  })()`);
  try {
    await blockRemote(cdp);
    await send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_PICKER });
    await send('Page.setDownloadBehavior', { behavior: 'deny' });
    await resetBufferLive(cdp);
    // ---- A. every app, every width, one page each
    for (const app of APPS) {
      await setSize(SIZES[0]);
      await navigate(`http://127.0.0.1:${port}${app.url}`, 15000);
      if (app.canvas) await waitForApp(app.canvas); else await waitFor(app.ready, app.id + ' ready', 15000);
      await waitFor(`!!document.querySelector('.sk-save') && document.querySelector('.sk-save').dataset.state !== 'loading'`, app.id + ': the Save button, loaded', 15000);
      for (const s of [...SIZES, SIZES[0]]) {
        await setSize(s);
        const m = await measure(); const tag = `${app.id} ${s.name}: `;
        assert.ok(m.scrollW <= m.vw + 0.5, tag + 'no sideways page scroll ' + JSON.stringify([m.scrollW, m.vw]));
        assert.ok(m.l >= -0.5 && m.r <= m.vw + 0.5, tag + 'inside the screen ' + JSON.stringify(m));
        assert.ok(m.onTop, tag + 'nothing covers the button');
        assert.deepStrictEqual(m.overlaps, [], tag + 'overlaps no stage button, menu button, tab or "+"');
        if (!s.phone) {
          assert.deepStrictEqual([m.parent, m.afterMenuBeforeTabs, m.headerShown, Math.round(m.headerH), Math.round(m.w), Math.round(m.h), m.labelShown], ['sk-header', true, true, 44, 30, 30, false], tag + 'after menu button and before stage tabs, icon-only 30x30 on 44 px header row');
          const menuR = await evalJs(`document.querySelector('.sk-sidebar-btn').getBoundingClientRect().right`);
          const firstStage = await evalJs(`Math.min(...[...document.querySelectorAll('.sk-header-tab')].map((e) => e.getBoundingClientRect().left))`);
          assert.ok(m.l >= menuR + 9 && m.r <= firstStage - 9, tag + `between menu button (${menuR}) and stage tabs (${firstStage}): ${JSON.stringify(m)}`);
        } else {
          assert.deepStrictEqual([m.parent, m.last, m.headerShown, Math.round(m.w), Math.round(m.h) === Math.round(m.tabH), m.labelShown], ['sk-doctabs', true, false, 44, true, false], tag + 'header hidden: the strip\'s last item, icon only, 44 px wide, the tabs\' height ' + JSON.stringify(m));
          assert.ok(m.r >= m.stripR - 9, tag + "at the right end of the strip " + JSON.stringify(m));
        }
        if (s.name === 'desktop-1440') await shot(`layout-${app.id}-desktop.png`, { x: 0, y: 0, width: 1440, height: 80 });
        if (s.name === 'phone-360' || s.name === 'phone-390') await shot(`layout-${app.id}-${s.name}.png`, { x: 0, y: 0, width: s.w, height: 70 });
      }
      console.log(`${app.id}: header at desktop 1440 / 700, tab strip at 430 / 390 / 360 / landscape, back in the header`);
    }
    // ---- B. Shaper in Fusion mode: no project layer, no Save button
    await setSize(SIZES[0]);
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.adsk = window.adsk || { fusionSendData() {} };` });
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html?host=fusion`, 15000);
    await waitFor(`!!document.querySelector('.sk-header-tab')`, 'Shaper in Fusion mode', 15000); await sleep(600);
    assert.deepStrictEqual(await evalJs(`({ save: document.querySelectorAll('.sk-save').length, header: [...document.querySelector('header.sk-header').children].map((c) => c.className), overlay: document.querySelectorAll('.sk-loading').length })`),
      { save: 0, header: ['sk-sidebar-btn', 'sk-header-tabs'], overlay: 0 }, 'Fusion mode: no Save button, no loading overlay, the header = menu + stages');
    await shot('layout-shaper-fusion-mode.png', { x: 0, y: 0, width: 1440, height: 60 });
    console.log('Shaper Fusion mode: no Save button');

    // ---- C. SketchStudio in depth
    await resetBufferLive(cdp);
    await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 15000); await waitForApp('svgCanvas');
    const state = () => evalJs(`document.querySelector('.sk-save').dataset.state`);
    const waitState = (st, what) => waitFor(`document.querySelector('.sk-save').dataset.state === ${JSON.stringify(st)}`, what, 15000);
    const stages = () => evalJs(`JSON.stringify([...document.querySelectorAll('header .sk-header-tab, header .sk-save')].map((e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; }))`);
    const click = async (x, y) => {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 }); await sleep(20);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(20);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(80);
    };
    const centre = (sel) => evalJs(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    const press = async (sel) => { const c = await centre(sel); await click(c.x, c.y); };
    const tap = async (sel) => { const c = await centre(sel); const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts }); await T('touchStart', [{ x: c.x, y: c.y, id: 0, radiusX: 2, radiusY: 2, force: 1 }]); await sleep(40); await T('touchEnd', []); await sleep(200); };
    const drawLine = async (fy) => {
      await evalJs(`document.getElementById('tool-line').click()`); await sleep(80);
      const r = await evalJs(`(() => { const b = document.getElementById('svgCanvas').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()`);
      await click(Math.round(r.x + r.w * 0.3), Math.round(r.y + r.h * fy)); await click(Math.round(r.x + r.w * 0.6), Math.round(r.y + r.h * (fy + 0.1)));
      await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(80);
    };
    await waitState('new', 'SketchStudio: a fresh Untitled');
    const base = await stages();
    await drawLine(0.4);
    await waitState('unsaved', 'SketchStudio: an edit -> not saved');
    assert.strictEqual(await stages(), base, 'not saved: nothing moved');
    await shot('ss-desktop-unsaved.png', { x: 0, y: 0, width: 380, height: 80 });
    await press('.sk-save');
    await waitFor(`!!document.querySelector('.sk-fd[data-file-dialog="save"]')`, 'SketchStudio: a press with no home opens THE Save as dialog');
    await press('.sk-fd [data-fd-tab="local"]');
    await evalJs(`(() => { const i = document.querySelector('.sk-fd input'); i.focus(); i.select(); })()`);
    for (const ch of 'Sketch 768') await sendRealKey(send, ch, '', ch.toUpperCase().charCodeAt(0), 0, ch);
    await press('.sk-fd [data-choice="ok"]');
    await waitState('saved', 'SketchStudio: saved to its file');
    assert.strictEqual(await evalJs(`document.querySelector('.sk-save').getAttribute('aria-label')`), 'Save, Saved to Sketch 768.sketch.json', 'saved: the file named');
    assert.strictEqual(await stages(), base, 'saved: nothing moved');
    await shot('ss-desktop-saved-file.png', { x: 0, y: 0, width: 380, height: 80 });
    await drawLine(0.6);
    await waitState('unsaved', 'SketchStudio: an edit of the file');
    await press('.sk-save');
    await waitFor(`sessionStorage.getItem('writes:Sketch 768.sketch.json') === '2'`, 'SketchStudio: the press wrote the file back');
    await waitState('saved', 'SketchStudio: saved again');
    // phone 390: the strip's button, by a real tap
    await drawLine(0.5); // drawn with the mouse, then the phone viewport (the edit is what matters here)
    await setSize(SIZES[3]);
    await waitState('unsaved', 'SketchStudio phone: an edit -> not saved');
    await shot('ss-phone-390-unsaved.png', { x: 0, y: 0, width: 390, height: 70 });
    await tap('.sk-save');
    await waitFor(`sessionStorage.getItem('writes:Sketch 768.sketch.json') === '3'`, 'SketchStudio phone: a TAP on the strip\'s button wrote the file back');
    await waitState('saved', 'SketchStudio phone: saved');
    await shot('ss-phone-390-saved.png', { x: 0, y: 0, width: 390, height: 70 });
    assert.strictEqual(await state(), 'saved');
    // more tabs than the phone strip holds: the active (new, last) tab and the "+" scrolled into view are never under the pinned button
    for (let i = 0; i < 4; i++) {
      await evalJs(`document.querySelector('.sk-doctab-new').scrollIntoView({ inline: 'nearest', block: 'nearest' })`); await sleep(60);
      await tap('.sk-doctab-new'); await waitFor(`!!document.querySelector('.sk-tp-card[data-template="blank"]')`, 'the template modal'); await tap('.sk-tp-card[data-template="blank"]');
      await waitFor(`document.querySelectorAll('.sk-doctab').length === ${i + 2}`, `${i + 2} tabs`);
    }
    await sleep(600);
    const free = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); const r = e.getBoundingClientRect(); const s = document.querySelector('.sk-save').getBoundingClientRect(); const hit = document.elementFromPoint(r.right - 4, r.top + r.height / 2); return { clear: r.right <= s.left + 0.5, hit: !!hit && (hit === e || e.contains(hit)) }; })()`);
    assert.deepStrictEqual(await free('.sk-doctab.active'), { clear: true, hit: true }, 'phone, 5 tabs: the active tab is in view, clear of the Save button');
    await evalJs(`document.querySelector('.sk-doctab-new').scrollIntoView({ inline: 'nearest', block: 'nearest' })`); await sleep(100);
    assert.deepStrictEqual(await free('.sk-doctab-new'), { clear: true, hit: true }, 'phone, 5 tabs: the "+" scrolled into view is clear of the Save button');
    await shot('ss-phone-390-five-tabs.png', { x: 0, y: 0, width: 390, height: 70 });
    assert.strictEqual(await evalJs(`document.querySelectorAll('.sk-spinner').length`), 0, 'no spinner left');
    // THE spinner (spinner.js): turns; with prefers-reduced-motion it does not (a still, dotted ring), its text alternative unchanged
    const spin = () => evalJs(`import('/packages/ui/spinner.js').then((m) => { const e = m.createSpinner({ label: 'Saving…' }); document.body.appendChild(e); const c = getComputedStyle(e.querySelector('.sk-spinner-ring')); const out = { role: e.getAttribute('role'), text: e.textContent, anim: c.animationName, style: c.borderTopStyle }; e.remove(); return out; })`);
    assert.deepStrictEqual(await spin(), { role: 'status', text: 'Saving…', anim: 'sk-spinner-turn', style: 'solid' }, 'the spinner turns, role=status with its text');
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    assert.deepStrictEqual(await spin(), { role: 'status', text: 'Saving…', anim: 'none', style: 'dotted' }, 'reduced motion: a still, dotted ring, same text');
    await send('Emulation.setEmulatedMedia', { features: [] });
    console.log(`save-button-layout-768-live: ok (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } finally {
    await cdp.close();
  }
})();
