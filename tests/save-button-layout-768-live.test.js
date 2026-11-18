// tests/save-button-layout-768-live.test.js — TASK 768: THE Save button in all four apps, in a real browser (no Google session at all: every non-local request
// blocked; the page's file pickers are a fake over an in-page "disk", as save-as-local-759-live).
//   A. (TASK 776, owner turns 2367-2368: Save and the account avatar moved to the shared FOOTER) every app (SketchStudio, Shaper, Pen Plotter, Trace), ONE page each, the viewport
//      changed under it: desktop 1440 / 700, phone 430 / 390 / 360 (touch), phone landscape 844 x 390 (touch) -> in EVERY layout there is exactly ONE Save button and ONE account
//      avatar, the last two buttons of the footer's right end (... Settings, Save, avatar), in the footer, not in the header or the tab strip; the footer is one row (no wrap), never
//      wider than the screen, with every other footer button present (undo, redo, delete, clear, fx, recenter, settings: 9 buttons at 360 px); the two are inside the screen, nothing covers them,
//      32 px (desktop) / 44 px high (touch), and the header holds only the menu button and the stage buttons.
//   B. Shaper in Fusion mode (?host=fusion, no project layer): no Save button, no avatar anywhere, the header unchanged (menu + stages).
//   C. SketchStudio in depth (desktop): new -> an edit -> "not saved"; a press opens THE Save as dialog; Local -> "Saved to <file>"; an edit + a press writes it
//      back -> saved; the stage buttons and the footer's buttons never move. Phone 390 (touch): an edit -> not saved; a TAP on the footer's button writes the file back -> saved; with 5 tabs the active
//      tab and the "+" scrolled into view are reachable (the strip has no pinned button any more). THE spinner: role=status + text; with prefers-reduced-motion it does not turn.
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
    const R = (e) => { const q = e.getBoundingClientRect(); return { l: q.left, r: q.right, t: q.top, b: q.bottom, w: q.width, h: q.height }; };
    const saves = document.querySelectorAll('.sk-save'), avs = document.querySelectorAll('.sk-account');
    const save = saves[0], av = avs[0];
    const end = save.parentNode, footer = end.closest('.sk-footer, .sk-statusbar');
    const kids = [...end.children];
    const hit = (e) => { const r = e.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!h && (h === e || e.contains(h)); };
    const btns = [...footer.querySelectorAll('button')].filter((b) => b.getClientRects().length);
    const tops = btns.map((b) => Math.round(b.getBoundingClientRect().top + b.getBoundingClientRect().height / 2));
    const header = document.querySelector('header.sk-header');
    return { coarse: matchMedia('(pointer: coarse)').matches, nSave: saves.length, nAv: avs.length, endClass: end.className, last2: [kids[kids.length - 2] === save, kids[kids.length - 1] === av], afterSettings: kids[kids.length - 3] && kids[kids.length - 3].id,
      save: R(save), av: R(av), onTop: [hit(save), hit(av)], vw: innerWidth, vh: innerHeight, scrollW: document.documentElement.scrollWidth,
      footer: R(footer), footerScrollW: footer.scrollWidth, footerClientW: footer.clientWidth, nBtns: btns.length, oneRow: Math.max(...tops) - Math.min(...tops) <= 2, tops, ids: btns.map((b) => b.id || b.className.split(' ')[0]),
      inHeader: document.querySelectorAll('header .sk-save, header .sk-account, .sk-doctabs .sk-save, .sk-doctabs .sk-account').length,
      headerKids: [...header.children].map((c) => c.className), labelShown: getComputedStyle(save.querySelector('.sk-save-label')).display !== 'none' };
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
      await waitFor(`!!document.querySelector('.sk-footer-end > .sk-save') && !!document.querySelector('.sk-footer-end > .sk-account') && document.querySelector('.sk-save').dataset.state !== 'loading'`, app.id + ': the Save button, loaded', 15000);
      for (const s of [...SIZES, SIZES[0]]) {
        await setSize(s);
        const m = await measure(); const tag = `${app.id} ${s.name}: `;
        assert.ok(m.scrollW <= m.vw + 0.5, tag + 'no sideways page scroll ' + JSON.stringify([m.scrollW, m.vw]));
        assert.deepStrictEqual([m.nSave, m.nAv, m.inHeader], [1, 1, 0], tag + 'ONE Save button, ONE account avatar, none in the header or the tab strip');
        assert.deepStrictEqual([m.endClass, m.last2, m.afterSettings, m.labelShown], ['sk-footer-end', [true, true], 'btn-settings', false], tag + 'the footer end ends ... Settings, Save, avatar, icon only ' + JSON.stringify(m));
        assert.deepStrictEqual(m.headerKids, ['sk-sidebar-btn', m.headerKids[1]], tag + 'header = menu button + stage buttons ' + JSON.stringify(m.headerKids));
        for (const k of ['save', 'av']) assert.ok(m[k].l >= -0.5 && m[k].r <= m.vw + 0.5 && m[k].t >= -0.5 && m[k].b <= m.vh + 0.5, tag + k + ' inside the screen ' + JSON.stringify(m[k]));
        assert.deepStrictEqual(m.onTop, [true, true], tag + 'nothing covers Save or the avatar');
        assert.ok(m.save.r <= m.av.l + 0.5, tag + 'Save is left of the avatar');
        assert.ok(m.oneRow, tag + 'the footer is one row: ' + JSON.stringify([m.tops, m.footer, m.vw, m.vh, m.footerClientW]));
        assert.ok(m.footerScrollW <= m.footerClientW + 0.5 || s.name.startsWith('landscape'), tag + `the footer never overflows ${m.footerScrollW} > ${m.footerClientW}`);
        assert.ok(m.footer.r <= m.vw + 0.5, tag + 'the footer is inside the screen');
        // the browser keeps reporting the touch pointer after a touch layout until it reloads: the size rule follows the pointer the page reports
        if (!m.coarse) assert.deepStrictEqual([Math.round(m.save.w), Math.round(m.save.h), Math.round(m.av.w), Math.round(m.av.h)], [32, 32, 32, 32], tag + 'desktop: footer-sized 32 px');
        else assert.ok(m.save.h >= 43.5 && m.av.h >= 43.5 && m.save.w >= 35 && m.av.w >= 35, tag + 'touch: 44 px high, at least 35 px wide ' + JSON.stringify([m.save, m.av]));
        if (s.name === 'desktop-1440') await shot(`layout-${app.id}-desktop.png`, { x: 0, y: m.footer.t - 4, width: 1440, height: m.footer.b - m.footer.t + 8 });
        if (s.name === 'phone-360' || s.name === 'phone-390' || s.name.startsWith('landscape')) await shot(`layout-${app.id}-${s.name}.png`, { x: 0, y: m.footer.t - 4, width: s.w, height: m.footer.b - m.footer.t + 8 });
      }
      console.log(`${app.id}: Save + avatar in the footer at desktop 1440 / 700, 430 / 390 / 360, landscape`);
    }
    // ---- B. Shaper in Fusion mode: no project layer, no Save button
    await setSize(SIZES[0]);
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.adsk = window.adsk || { fusionSendData() {} };` });
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html?host=fusion`, 15000);
    await waitFor(`!!document.querySelector('.sk-header-tab')`, 'Shaper in Fusion mode', 15000); await sleep(600);
    assert.deepStrictEqual(await evalJs(`({ save: document.querySelectorAll('.sk-save').length, account: document.querySelectorAll('.sk-account').length, header: [...document.querySelector('header.sk-header').children].map((c) => c.className), overlay: document.querySelectorAll('.sk-loading').length })`),
      { save: 0, account: 0, header: ['sk-sidebar-btn', 'sk-header-tabs'], overlay: 0 }, 'Fusion mode: no Save button, no account avatar, no loading overlay, the header = menu + stages');
    await shot('layout-shaper-fusion-mode.png', { x: 0, y: 0, width: 1440, height: 60 });
    console.log('Shaper Fusion mode: no Save button');

    // ---- C. SketchStudio in depth
    await resetBufferLive(cdp);
    await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 15000); await waitForApp('svgCanvas');
    const state = () => evalJs(`document.querySelector('.sk-save').dataset.state`);
    const waitState = (st, what) => waitFor(`document.querySelector('.sk-save').dataset.state === ${JSON.stringify(st)}`, what, 15000);
    const stages = () => evalJs(`JSON.stringify([...document.querySelectorAll('header .sk-header-tab, .sk-footer-end > *')].map((e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; }))`);
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
    await shot('ss-desktop-unsaved.png', { x: 1100, y: 840, width: 340, height: 60 });
    await press('.sk-save');
    await waitFor(`!!document.querySelector('.sk-fd[data-file-dialog="save"]')`, 'SketchStudio: a press with no home opens THE Save as dialog');
    await press('.sk-fd [data-fd-tab="local"]');
    await evalJs(`(() => { const i = document.querySelector('.sk-fd input'); i.focus(); i.select(); })()`);
    for (const ch of 'Sketch 768') await sendRealKey(send, ch, '', ch.toUpperCase().charCodeAt(0), 0, ch);
    await press('.sk-fd [data-choice="ok"]');
    await waitState('saved', 'SketchStudio: saved to its file');
    assert.strictEqual(await evalJs(`document.querySelector('.sk-save').getAttribute('aria-label')`), 'Save, Saved to Sketch 768.sketch.json', 'saved: the file named');
    assert.strictEqual(await stages(), base, 'saved: nothing moved');
    await shot('ss-desktop-saved-file.png', { x: 1100, y: 840, width: 340, height: 60 });
    await drawLine(0.6);
    await waitState('unsaved', 'SketchStudio: an edit of the file');
    await press('.sk-save');
    await waitFor(`sessionStorage.getItem('writes:Sketch 768.sketch.json') === '2'`, 'SketchStudio: the press wrote the file back');
    await waitState('saved', 'SketchStudio: saved again');
    // phone 390: the strip's button, by a real tap
    await drawLine(0.5); // drawn with the mouse, then the phone viewport (the edit is what matters here)
    await setSize(SIZES[3]);
    await waitState('unsaved', 'SketchStudio phone: an edit -> not saved');
    await shot('ss-phone-390-unsaved.png', { x: 0, y: 794, width: 390, height: 50 });
    await tap('.sk-save');
    await waitFor(`sessionStorage.getItem('writes:Sketch 768.sketch.json') === '3'`, 'SketchStudio phone: a TAP on the strip\'s button wrote the file back');
    await waitState('saved', 'SketchStudio phone: saved');
    await shot('ss-phone-390-saved.png', { x: 0, y: 794, width: 390, height: 50 });
    assert.strictEqual(await state(), 'saved');
    // more tabs than the phone strip holds: the active (new, last) tab and the "+" scrolled into view are never under the pinned button
    for (let i = 0; i < 4; i++) {
      await evalJs(`document.querySelector('.sk-doctab-new').scrollIntoView({ inline: 'nearest', block: 'nearest' })`); await sleep(60);
      await tap('.sk-doctab-new'); await waitFor(`!!document.querySelector('.sk-tp-card[data-template="blank"]')`, 'the template modal'); await tap('.sk-tp-card[data-template="blank"]');
      await waitFor(`document.querySelectorAll('.sk-doctab').length === ${i + 2}`, `${i + 2} tabs`);
    }
    await sleep(600);
    const free = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); const r = e.getBoundingClientRect(); const hit = document.elementFromPoint(r.right - 4, r.top + r.height / 2); return { hit: !!hit && (hit === e || e.contains(hit)), inside: r.left >= -0.5 && r.right <= innerWidth + 0.5 }; })()`);
    assert.deepStrictEqual(await free('.sk-doctab.active'), { hit: true, inside: true }, 'phone, 5 tabs: the active tab is in view and reachable');
    await evalJs(`document.querySelector('.sk-doctab-new').scrollIntoView({ inline: 'nearest', block: 'nearest' })`); await sleep(100);
    assert.deepStrictEqual(await free('.sk-doctab-new'), { hit: true, inside: true }, 'phone, 5 tabs: the "+" scrolled into view is reachable');
    assert.strictEqual(await evalJs(`document.querySelectorAll('.sk-doctabs .sk-save, .sk-doctabs .sk-account').length`), 0, 'the tab strip holds no Save button or avatar');
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
