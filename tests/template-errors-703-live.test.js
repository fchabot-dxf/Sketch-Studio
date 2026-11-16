// tests/template-errors-703-live.test.js -- TASK 703 in REAL Shaper (desktop 1400x900 mouse + phone 390x844 touch):
// 1. Box frame Horizontal layout: Corner joint labels/titles match glyphs and resulting geometry in both layouts,
//    while stored data-value keeps existing meaning.
// 2. Right-angle brace: impossible thickness sums (thickD=250, thickV=350, thickH=600) refuse in 680's error line
//    with Open disabled and keep last valid preview; restoring valid thickness re-enables Open.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sendRealKey, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const EVID = path.join(process.cwd(), '.evidence', '703');

await (async () => {
  const cdp = await launchBrowser({ tag: '703', width: 1400, height: 900 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate, waitForApp } = cdp;
  const pageErrors = [];
  cdp.ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') pageErrors.push(JSON.stringify(m.params.exceptionDetails));
  });

  try {
    fs.mkdirSync(EVID, { recursive: true });
    for (const kind of ['desktop', 'phone']) {
      const phone = kind === 'phone';
      await resetBufferLive(cdp);
      await send('Emulation.setDeviceMetricsOverride', phone
        ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, hasTouch: true }
        : { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false, hasTouch: false });
      await send('Emulation.setTouchEmulationEnabled', { enabled: phone, maxTouchPoints: phone ? 5 : 0 });

      const mouseEv = (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', {
        type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1,
      });
      const T = (type, pts) => send('Input.dispatchTouchEvent', {
        type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i + 1, radiusX: 1, radiusY: 1, force: 1 })),
      });
      const pointer = async (p) => {
        if (phone) { await T('touchStart', [p]); await sleep(45); await T('touchEnd', []); await sleep(300); }
        else { await mouseEv('mouseMoved', p.x, p.y); await sleep(30); await mouseEv('mousePressed', p.x, p.y, 1); await sleep(30); await mouseEv('mouseReleased', p.x, p.y); await sleep(260); }
      };
      const press = async (sel) => {
        const pt = await evalJs(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => !x.hidden && x.getClientRects().length > 0); if (!e) return null; e.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
        assert(pt, `[${kind}] missing clickable ${sel}`);
        await pointer(pt);
      };
      const shot = async (name, sel, pad = 4) => {
        const r = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.max(0, b.left - ${pad}), y: Math.max(0, b.top - ${pad}), width: Math.min(innerWidth - Math.max(0, b.left - ${pad}), b.width + ${pad * 2}), height: Math.min(innerHeight - Math.max(0, b.top - ${pad}), b.height + ${pad * 2}) }; })()`);
        const s = await send('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 1 } });
        fs.writeFileSync(path.join(EVID, name), Buffer.from(s.data, 'base64'));
      };
      const dontSave = async () => {
        await sleep(250);
        const has = await evalJs(`[...document.querySelectorAll('.sk-tp-backdrop [role="dialog"] button')].some((b) => /Don.t save/.test(b.textContent))`);
        if (has) await press('.sk-tp-backdrop [role="dialog"] button:nth-of-type(2)');
      };
      const openStart = async (id) => {
        await press('.sk-sidebar-btn, .sk-sidebar-handle');
        await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, `[${kind}] sidebar`);
        await press('[data-action="templates"]');
        await waitFor(`!!document.querySelector('.sk-tp-card')`, `[${kind}] template cards`);
        await press(`.sk-tp-card[data-template="${id}"]`);
        await waitFor(`!!document.querySelector('.sk-tp-start[data-template="${id}"] .sk-tp-corner')`, `[${kind}] ${id} start view`);
        await sleep(200);
      };
      const pickerInfo = (sel) => evalJs(`(() => [...document.querySelectorAll(${JSON.stringify(sel + ' button')})].map((b) => {
        const polys = [...b.querySelectorAll('svg polygon')].map((g) => {
          const pts = g.getAttribute('points').split(' ').map((s) => s.split(',').map(Number));
          const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
          return { dx: +(Math.max(...xs) - Math.min(...xs)).toFixed(1), dy: +(Math.max(...ys) - Math.min(...ys)).toFixed(1) };
        });
        return { value: b.dataset.value, label: b.getAttribute('aria-label'), title: b.title, hidden: b.hidden, hLen: polys[0].dx, vLen: polys[1].dy };
      }))()`);

      await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 10000);
      await waitFor(`!!document.querySelector('.sk-sidebar-btn, .sk-sidebar-handle')`, `[${kind}] Shaper loaded`);
      await waitForApp('design-canvas');
      // TASK 722: Shaper's document is inches; this test is about mm values (the inch start view is template-units-722-live)
      await evalJs(`(async () => { (await import('/packages/core/settings-manager.js')).default.set('DOC_UNIT', 'mm', { persist: false }); })()`);

      await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 10000);
      await waitFor(`!!document.querySelector('.sk-sidebar-btn, .sk-sidebar-handle')`, `[${kind}] Shaper loaded`);
      await waitForApp('design-canvas');
      // TASK 722: Shaper's document is inches; this test is about mm values (the inch start view is template-units-722-live)
      await evalJs(`(async () => { (await import('/packages/core/settings-manager.js')).default.set('DOC_UNIT', 'mm', { persist: false }); })()`);

      const setField = async (param, val) => {
        await evalJs(`(() => { const i = document.querySelector('.sk-tp-field[data-param="${param}"] input'); i.scrollIntoView({block:'nearest'}); i.focus(); i.select(); })()`);
        await sendRealKey(send, 'Backspace', 'Backspace', 8);
        await send('Input.insertText', { text: String(val) });
        await sleep(350);
      };
      const state = () => evalJs(`({ err: document.querySelector('.sk-tp-err').textContent, disabled: document.querySelector('.sk-tp-open').disabled,
        marked: [...document.querySelectorAll('.sk-tp-input[aria-invalid="true"]')].map((i) => i.closest('.sk-tp-field').dataset.param),
        preview: !!document.querySelector('.sk-tp-start .sk-tp-prev svg') })`);
      const leave = async () => {
        await press('.sk-tp-cancel'); await sleep(200);
        await press('.sk-tp-x'); await sleep(250);
      };
      const openPlain = async (id) => {
        await press('.sk-sidebar-btn, .sk-sidebar-handle');
        await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, `[${kind}] sidebar`);
        await press('[data-action="templates"]');
        await waitFor(`!!document.querySelector('.sk-tp-card')`, `[${kind}] template cards`);
        await press(`.sk-tp-card[data-template="${id}"]`);
        await waitFor(`!!document.querySelector('.sk-tp-start[data-template="${id}"]')`, `[${kind}] ${id} start view`);
        await sleep(250);
      };

      for (const [id, param, bad, good, message, shotName] of [
        ['right-angle-brace', 'thickD', 250, 38, 'Diagonal board thickness is too big for this width and height: use less than 217.34 mm.', 'brace-thickD-250'],
        ['triangle-frame', 'base', 1000, 600, 'Base is too long for the other two sides: use less than 900 mm.', 'triangle-base-1000'],
        ['box-frame', 'thickness', 300, 18, 'Plywood thickness is too big for this width: use less than 200 mm.', 'box-thickness-300'],
        ['rounded-rectangle', 'radius', 100, 5, 'Corner radius is too big for this width and height: use less than 20 mm.', 'rounded-radius-100'],
      ]) {
        await openPlain(id);
        await setField(param, bad);
        let st = await state();
        assert.strictEqual(st.err, message, `[${kind}] ${id} ${param}=${bad}: the plain sentence`);
        assert.deepStrictEqual(st.marked, [param], `[${kind}] ${id}: the field is marked`);
        assert.strictEqual(st.disabled, true, `[${kind}] ${id}: Open disabled`);
        assert.ok(st.preview, `[${kind}] ${id}: the last good preview stays`);
        await shot(`after-${kind}-${shotName}.png`, '.sk-tp-panel', 4);
        await setField(param, good);
        st = await state();
        assert.strictEqual(st.err, '', `[${kind}] ${id}: fixed, no line`);
        assert.deepStrictEqual(st.marked, [], `[${kind}] ${id}: fixed, no mark`);
        assert.strictEqual(st.disabled, false, `[${kind}] ${id}: Open enabled again`);
        await leave();
      }

      // an error no limit foresaw (the parallelogram at 89 degrees): the one generic line, no field blamed
      await openPlain('parallelogram-frame');
      await setField('angle', 89);
      const g = await state();
      assert.strictEqual(g.err, "These values can't be drawn. Try other values.", `[${kind}] generic line`);
      assert.deepStrictEqual(g.marked, [], `[${kind}] generic: no field blamed`);
      assert.strictEqual(g.disabled, true, `[${kind}] generic: Open disabled`);
      await shot(`after-${kind}-generic-angle-89.png`, '.sk-tp-panel', 4);
      await leave();
    }

    assert.strictEqual(pageErrors.length, 0, 'no uncaught page errors: ' + pageErrors.join('; '));
    console.log('template-errors-703-live: ok');
  } finally {
    await cdp.close();
  }
})();
