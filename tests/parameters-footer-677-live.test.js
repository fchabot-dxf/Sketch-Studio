// TASK 677 ADDITION 2 (owner, turn 1730: "param table should be beside the clear all button, or somewhere always visible"): the Parameters button is
// in the shared FOOTER (packages/ui/app-footer.js), right after Delete / Clear sketch, in every host with the Parameters window; Trace opts out (O14).
// Real headless browser, each of SketchStudio / Shaper (Design) / Pen Plotter (Design) on desktop (mouse, 1400 x 860), phone portrait (touch,
// 390 x 844) and phone landscape (touch, 844 x 390):
//   - visible without opening any menu: on screen, in the footer, nothing covers it, right after Clear sketch; 32 px with a mouse, 44 px with a finger;
//   - a real click / tap opens the window (aria-expanded="true", aria-haspopup="dialog"), a second one closes it (aria-expanded="false");
//   - the ribbon has no Parameters button and no Inspect dropdown row for it (it lives in ONE place).
// Trace: no Parameters button in its footer or ribbon. EVIDENCE_DIR (optional): cropped footer screenshots.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';

await (async () => {
  const cdp = await launchBrowser({ tag: '677f', width: 1400, height: 860 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;
  const mouseEv = (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
  const mouse = async (p) => { await mouseEv('mouseMoved', p.x, p.y); await sleep(30); await mouseEv('mousePressed', p.x, p.y, 1); await sleep(30); await mouseEv('mouseReleased', p.x, p.y); await sleep(300); };
  const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
  const touch = async (p) => { await T('touchStart', [p]); await sleep(40); await T('touchEnd', []); await sleep(350); };
  const B = `document.getElementById('btn-parameters')`;
  const info = () => evalJs(`(() => { const b = ${B}; if (!b) return null; const r = b.getBoundingClientRect(); const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
    const h = document.elementFromPoint(x, y); const prev = b.previousElementSibling;
    return { x, y, w: Math.round(r.width), h: Math.round(r.height), inView: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, free: !!h && (h === b || b.contains(h)),
      footer: !!b.closest('.sk-footer, .sk-statusbar'), after: prev ? prev.id : null, prevSize: prev ? [Math.round(prev.getBoundingClientRect().width), Math.round(prev.getBoundingClientRect().height)] : null, expanded: b.getAttribute('aria-expanded'), popup: b.getAttribute('aria-haspopup'), label: b.getAttribute('aria-label') }; })()`);
  const winOpen = () => evalJs(`(() => { const e = document.querySelector('.sk-pwin'); return !!e && !e.hidden && e.getBoundingClientRect().width > 0; })()`);
  const shotFooter = async (name) => {
    if (!process.env.EVIDENCE_DIR) return;
    const r = await evalJs(`(() => { const b = ${B}; const f = b.closest('.sk-footer, .sk-statusbar'); const fr = f.getBoundingClientRect(); const s = b.closest('.sk-footer-start') || f; const sr = s.getBoundingClientRect();
      const top = Math.min(fr.top, sr.top) - 6, bottom = Math.max(fr.bottom, sr.bottom) + 6; return { x: Math.max(0, sr.left - 8), y: Math.max(0, top), width: Math.min(innerWidth, sr.right + 16) - Math.max(0, sr.left - 8), height: Math.min(innerHeight, bottom) - Math.max(0, top) }; })()`);
    const s = await send('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 3 } });
    fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name), Buffer.from(s.data, 'base64'));
  };
  const showDesign = async (app) => {
    if (app === 'sketchstudio') { await waitFor(`!!document.getElementById('svgCanvas') && !!${B}`, 'SketchStudio'); return; }
    await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, app + ' tabs');
    for (let i = 0; i < 6; i++) {
      if (await evalJs(`(() => { const t = document.querySelector('.sk-header-tab.active'); return !!t && t.dataset.tab === 'design'; })()`)) break;
      await evalJs(`document.querySelector('.sk-header-tab[data-tab="design"]').click()`); await sleep(400); // navigation only (in phone landscape the header is hidden)
    }
    await waitFor(`!!${B} && ${B}.getClientRects().length > 0`, app + ': the Design surface with its footer button');
  };
  const FORMS = [
    { tag: 'desktop', w: 1400, h: 860, touch: false, size: 32 },
    { tag: 'phone-portrait', w: 390, h: 844, touch: true, size: 44 },
    { tag: 'phone-landscape', w: 844, h: 390, touch: true, size: 44 },
  ];
  try {
    for (const form of FORMS) {
      await send('Emulation.setDeviceMetricsOverride', { width: form.w, height: form.h, deviceScaleFactor: 1, mobile: form.touch, ...(form.touch ? { screenOrientation: form.w > form.h ? { type: 'landscapePrimary', angle: 90 } : { type: 'portraitPrimary', angle: 0 } } : {}) });
      await send('Emulation.setTouchEmulationEnabled', { enabled: form.touch, maxTouchPoints: form.touch ? 5 : 1 });
      const press = form.touch ? touch : mouse;
      for (const app of ['sketchstudio', 'shaper', 'penplotter']) {
        const t = `${app} ${form.tag}`;
        await navigate(`http://127.0.0.1:${port}/apps/${app}/index.html`, 10000);
        await evalJs(`localStorage.removeItem('sk-parameters')`);
        await showDesign(app);
        await sleep(500);
        const b = await info();
        assert.ok(b && b.footer && b.inView && b.free, `${t}: the Parameters button is in the footer, on screen and uncovered, no menu opened: ${JSON.stringify(b)}`);
        assert.strictEqual(b.after, 'btn-clear-sketch', `${t}: right after Clear sketch`);
        assert.ok(b.h === form.size && b.w >= (form.touch ? 35 : form.size) && b.w === b.prevSize[0] && b.h === b.prevSize[1], `${t}: ${form.size} px tall, the size of its neighbour Clear sketch (${b.w} x ${b.h} vs ${b.prevSize})`);
        assert.deepStrictEqual([b.label, b.popup, b.expanded], ['Parameters', 'dialog', 'false'], `${t}: aria-label, aria-haspopup, aria-expanded`);
        // the ribbon has no Parameters button, nor an Inspect dropdown row for it
        assert.strictEqual(await evalJs(`!document.querySelector('.sk-ribbon #btn-parameters, .sk-ribbon-sect-menu [data-id="btn-parameters"]')`), true, `${t}: not in the ribbon / Inspect`);
        await press(b);
        assert.strictEqual(await winOpen(), true, `${t}: a real ${form.touch ? 'tap' : 'click'} opens the window`);
        assert.strictEqual((await info()).expanded, 'true', `${t}: aria-expanded="true" while open`);
        const again = await info();
        assert.ok(again.free, `${t}: the open window leaves the button uncovered: ${JSON.stringify(again)}`);
        if (app === 'sketchstudio') await shotFooter(`footer-${form.tag}-open.png`);
        await press(again);
        assert.strictEqual(await winOpen(), false, `${t}: a second ${form.touch ? 'tap' : 'click'} closes it`);
        assert.strictEqual((await info()).expanded, 'false', `${t}: aria-expanded="false" again`);
        if (app === 'sketchstudio') await shotFooter(`footer-${form.tag}.png`);
      }
      // Trace: no Parameters button anywhere (declared opt-out on its footer, O14)
      await navigate(`http://127.0.0.1:${port}/apps/trace/index.html`, 10000);
      await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="edit"]')`, 'Trace');
      await evalJs(`document.querySelector('.sk-header-tab[data-tab="edit"]').click()`);
      await waitFor(`!!document.querySelector('#design-ribbon .sk-ribbon #tool-line')`, 'the Trace Edit ribbon');
      await sleep(400);
      assert.strictEqual(await evalJs(`!${B} && !document.querySelector('.sk-pwin')`), true, `trace ${form.tag}: no Parameters button, no window`);
      assert.strictEqual(await evalJs(`!!document.getElementById('btn-clear-sketch')`), true, `trace ${form.tag}: its footer is there (Clear sketch)`);
    }
    console.log('parameters-footer-677-live: ok');
  } finally { await cdp.close(); }
})();
process.exit(0);
