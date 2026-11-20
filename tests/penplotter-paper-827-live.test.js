// tests/penplotter-paper-827-live.test.js — TASK 827 (live headless): the Document dialog's Paper + Orientation at desktop 1280x800 and phone 390x844: pick A4, Letter,
// swap the orientation, type a custom size, reopen the dialog; the #docInfo readout names the standard; the hints show; every control is a 44 px target on the phone.
// Screenshots (zoomed on the dialog) -> .evidence/827.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
const EVID = path.join(process.cwd(), '.evidence', '827');

for (const [tag, w, h, phone] of [['desktop', 1280, 800, false], ['phone390', 390, 844, true]]) {
  const cdp = await launchBrowser({ tag: '827' + tag, width: w, height: h });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
  const { port, send, evalJs, waitFor, once } = cdp;
  try {
    fs.mkdirSync(EVID, { recursive: true });
    if (phone) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    }
    await resetBufferLive(cdp);
    const loaded = once('Page.loadEventFired');
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/apps/penplotter/index.html` });
    await Promise.race([loaded, sleep(8000)]);
    await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="toolpath"]')`, 'Pen Plotter ready'); await sleep(600);

    const centre = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    const click = async (sel) => {
      const c = await centre(sel); assert(c, sel + ' not found');
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y, button: 'none', buttons: 0 });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', buttons: 1, clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(300);
    };
    const tab = (t) => evalJs(`document.querySelector('.sk-header-tab[data-tab="${t}"]').click()`); // the phone folds the tabs into a menu: the tab's own click
    const choose = (sel, v) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    const shown = () => evalJs(`({ paper: docPaper.value, orient: docOrient.value, unit: docUnit.value, w: +docW.value, h: +docH.value, open: getComputedStyle(docModal).display !== 'none' })`);
    const shot = async (file) => {
      const r = await evalJs(`(() => { const b = document.querySelector('#docModal .wiz-box').getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height, scale: 1 }; })()`);
      const s = await send('Page.captureScreenshot', { format: 'png', clip: r });
      fs.writeFileSync(path.join(EVID, `${tag}-${file}.png`), Buffer.from(s.data, 'base64'));
    };
    const openDialog = async () => {
      await tab('design'); await sleep(600);
      const reachable = () => evalJs(`(() => { const r = designDocBtn.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return r.width > 0 && !!e && (e === designDocBtn || designDocBtn.contains(e)); })()`);
      for (let i = 0; phone && i < 2 && !(await reachable()); i++) { await click('.sk-drawer-toggle[aria-label="Panel"]'); await sleep(500); }
      await click('#designDocBtn');
      assert((await shown()).open, 'the Document dialog opens');
    };
    const readout = async () => { assert(await evalJs(`(() => { const r = docDone.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === docDone; })()`), 'Done is the element on top at its centre (not under the drawer)'); await click('#docDone'); await tab('toolpath'); await sleep(500); return evalJs(`docInfo.textContent`); };
    const hover = async (sel) => {
      const c = await centre(sel);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 3, y: 3, button: 'none', buttons: 0 }); await sleep(200);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x - 2, y: c.y, button: 'none', buttons: 0 });
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y, button: 'none', buttons: 0 }); await sleep(800);
      return evalJs(`(document.querySelector('.sk-cursor-tip') || {}).textContent || null`);
    };

    await openDialog();
    assert.deepStrictEqual(await shown(), { paper: 'custom', orient: 'portrait', unit: 'mm', w: 200, h: 200, open: true });
    await shot('1-default-custom');
    if (phone) {
      const sizes = await evalJs(`Object.fromEntries(['#docPaper', '#docOrient', '#docUnit', '#docW', '#docH', '#docDone', '#docCancel', '#docModalClose'].map((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [s, [Math.round(r.width), Math.round(r.height)]]; }))`);
      for (const [s, [sw, sh]] of Object.entries(sizes)) assert(sw >= 43.5 && sh >= 43.5, `${s} is a 44 px target on the phone: ${sw} x ${sh}`);
      const box = await evalJs(`(() => { const r = document.querySelector('#docModal .wiz-box').getBoundingClientRect(); return [r.left, r.right, innerWidth]; })()`);
      assert(box[0] >= 0 && box[1] <= box[2], 'the dialog fits the phone width: ' + box);
    } else {
      const tip = await hover('#docModal label[data-hint="paper"]');
      assert(tip && /standard paper size/i.test(tip), 'the Paper hint shows: ' + tip);
      await shot('1b-paper-hint');
      const tip2 = await hover('#docModal label[data-hint="orientation"]');
      assert(tip2 && /swaps the Width and Height/i.test(tip2), 'the Orientation hint shows: ' + tip2);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 3, y: 3, button: 'none', buttons: 0 }); await sleep(200);
    }

    await choose('#docPaper', 'a4');
    assert.deepStrictEqual(await shown(), { paper: 'a4', orient: 'portrait', unit: 'mm', w: 210, h: 297, open: true });
    await shot('2-a4');
    await choose('#docPaper', 'letter');
    assert.deepStrictEqual(await shown(), { paper: 'letter', orient: 'portrait', unit: 'in', w: 8.5, h: 11, open: true });
    await shot('3-letter');
    await choose('#docOrient', 'landscape');
    assert.deepStrictEqual(await shown(), { paper: 'letter', orient: 'landscape', unit: 'in', w: 11, h: 8.5, open: true });
    await shot('4-letter-landscape');
    const ro = await readout();
    assert(/^Letter · 11\.00 × 8\.50 in/.test(ro), 'the readout names the standard: ' + ro);
    console.log(tag, 'readout:', ro);

    await openDialog();
    assert.deepStrictEqual(await shown(), { paper: 'letter', orient: 'landscape', unit: 'in', w: 11, h: 8.5, open: true }, 'reopened: the standard (landscape) is shown');
    // a custom size: type a Width (real keys into the box)
    await click('#docW'); await evalJs(`docW.select()`);
    await send('Input.insertText', { text: '12.5' });
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }); await sleep(300);
    const cu = await shown();
    assert.strictEqual(cu.paper, 'custom', 'a typed size that is no standard shows Custom: ' + JSON.stringify(cu));
    await shot('5-custom');
    const ro2 = await readout();
    assert(/^12\.50 × 8\.50 in/.test(ro2), 'a custom size has no name in the readout: ' + ro2);
    await openDialog();
    assert.strictEqual((await shown()).paper, 'custom', 'reopened: Custom');
    await choose('#docPaper', 'a4'); await shot('6-reopen-then-a4');
    await click('#docDone');
    console.log(tag, 'ok');
  } finally { await cdp.close(); }
}
console.log('penplotter-paper-827-live: ok');
