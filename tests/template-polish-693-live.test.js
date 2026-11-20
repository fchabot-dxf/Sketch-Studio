// tests/template-polish-693-live.test.js -- TASK 693 in REAL Shaper (desktop 1400x900 mouse + phone 390x844 touch):
// 1. Box frame Horizontal layout: Corner joint labels/titles match glyphs and resulting geometry in both layouts,
//    while stored data-value keeps existing meaning.
// 2. Right-angle brace: impossible thickness sums (thickD=250, thickV=350, thickH=600) refuse in 680's error line
//    with Open disabled and keep last valid preview; restoring valid thickness re-enables Open.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sendRealKey, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const EVID = path.join(process.cwd(), '.evidence', '693');

await (async () => {
  const cdp = await launchBrowser({ tag: '693', width: 1400, height: 900 });
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
        await press('.sk-sidebar-btn, .sk-sidebar-chevron');
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
      await waitFor(`!!document.querySelector('.sk-sidebar-btn, .sk-sidebar-chevron')`, `[${kind}] Shaper loaded`);
      await waitForApp('design-canvas');
      // TASK 722: Shaper's document is inches; this test is about joints in mm values (the inch start view is template-units-722-live)
      await evalJs(`(async () => { (await import('/packages/core/settings-manager.js')).default.set('DOC_UNIT', 'mm', { persist: false }); })()`);

      // ---- 1. Box frame: Vertical -> Horizontal -> labels, glyphs, built sketch ----
      await openStart('box-frame');
      const vOpts = await pickerInfo('.sk-tp-field[data-param="joint"]');
      assert.deepStrictEqual(vOpts.filter((o) => !o.hidden).map((o) => [o.value, o.label]), [['V-Through', 'Vertical through']], `[${kind}] Vertical default label`);

      await press('.sk-tp-field[data-param="layout"] button:not([hidden])');
      await press('.sk-tp-field[data-param="layout"] button[data-value="Horizontal"]');
      await sleep(280);

      // Collapsed joint button reflects Horizontal layout before even expanding
      const hCollapsed = (await pickerInfo('.sk-tp-field[data-param="joint"]')).filter((o) => !o.hidden);
      assert.deepStrictEqual(hCollapsed.map((o) => [o.value, o.label, o.title, o.hLen, o.vLen]), [['V-Through', 'Horizontal through', 'Horizontal through', 32, 24]], `[${kind}] Horizontal collapsed button updated`);

      // Expand row joint picker and verify labels, titles & glyphs match
      await press('.sk-tp-field[data-param="joint"] button:not([hidden])');
      await sleep(160);
      const hExpanded = await pickerInfo('.sk-tp-field[data-param="joint"]');
      assert.deepStrictEqual(
        hExpanded.map((o) => [o.value, o.label, o.title, o.hLen, o.vLen]),
        [
          ['V-Through', 'Horizontal through', 'Horizontal through', 32, 24],
          ['H-Through', 'Vertical through', 'Vertical through', 24, 32],
          ['Miter', 'Mitered', 'Mitered', 32, 32],
        ],
        `[${kind}] Horizontal row labels/titles match glyphs`
      );
      await shot(`after-${kind}-box-horizontal-joint.png`, '.sk-tp-panel', 4);

      // Check corner 0 picker on preview too (after picking "Vertical through" / H-Through or before picking)
      const c0 = await pickerInfo('.sk-tp-corner[data-corner="0"]');
      assert.deepStrictEqual(c0.map((o) => [o.value, o.label, o.title]), [
        ['V-Through', 'Horizontal through', 'Horizontal through'],
        ['H-Through', 'Vertical through', 'Vertical through'],
        ['Miter', 'Mitered', 'Mitered'],
      ], `[${kind}] Horizontal corner 0 labels match`);

      // Pick "Vertical through" (stored H-Through) -> Open -> verify vertical 400 mm ends run full height
      await press('.sk-tp-field[data-param="joint"] button[data-value="H-Through"]');
      await sleep(250);
      if (!phone) {
        // Quick roundtrip check on desktop: switch Vertical then back Horizontal, keeping H-Through
        await press('.sk-tp-field[data-param="layout"] button:not([hidden])');
        await press('.sk-tp-field[data-param="layout"] button[data-value="Vertical"]');
        await sleep(220);
        const backV = (await pickerInfo('.sk-tp-field[data-param="joint"]')).filter((o) => !o.hidden);
        assert.deepStrictEqual(backV.map((o) => [o.value, o.label]), [['H-Through', 'Horizontal through']], '[desktop] switching back to Vertical restores Vertical-layout name');
        await press('.sk-tp-field[data-param="layout"] button:not([hidden])');
        await press('.sk-tp-field[data-param="layout"] button[data-value="Horizontal"]');
        await sleep(220);
      }
      await press('.sk-tp-open');
      await waitFor(`!document.querySelector('.sk-tp-panel')`, `[${kind}] box-frame opened`);
      await dontSave();

      const fullVEnds = await evalJs(`(() => {
        const s = window.__designController.state;
        return [...s.shapes.values()].filter((sh) => {
          if (sh.type !== 'line' || sh.isConstruction) return false;
          const [a, b] = sh.joints.map((id) => s.joints.get(id));
          return Math.abs(a.x - b.x) < 1e-3 && Math.abs(Math.abs(a.y - b.y) - 400) < 1e-3;
        }).length;
      })()`);
      assert.strictEqual(fullVEnds, 2, `[${kind}] Horizontal + "Vertical through" builds two full 400 mm vertical end lines`);

      // ---- 2. Right-angle brace: impossible thickness refused via error line & Open disabled ----
      await openStart('right-angle-brace');
      const setBraceField = async (param, val) => {
        await evalJs(`(() => { const i = document.querySelector('.sk-tp-field[data-param="${param}"] input'); i.scrollIntoView({block:'nearest'}); i.focus(); i.select(); })()`);
        await sendRealKey(send, 'Backspace', 'Backspace', 8);
        await send('Input.insertText', { text: String(val) });
        await sleep(320);
      };
      const braceErrState = () => evalJs(`({ err: document.querySelector('.sk-tp-err').textContent, disabled: document.querySelector('.sk-tp-open').disabled, texts: [...document.querySelectorAll('.sk-tp-start .sk-tp-prev svg text')].map((t) => t.textContent.trim()) })`);

      await setBraceField('thickD', 250);
      let stD = await braceErrState();
      assert.match(stD.err, / thickness is too big/, `[${kind}] thickD=250 shows refusal`);
      assert.strictEqual(stD.disabled, true, `[${kind}] thickD=250 disables Open`);
      assert.ok(stD.texts.includes('38'), `[${kind}] thickD=250 keeps last good preview`);
      await shot(`after-${kind}-brace-thickD-250-refused.png`, '.sk-tp-panel', 4);

      await setBraceField('thickD', 38);
      stD = await braceErrState();
      assert.strictEqual(stD.err, '', `[${kind}] valid thickD=38 clears error`);
      assert.strictEqual(stD.disabled, false, `[${kind}] valid thickD=38 re-enables Open`);

      if (!phone) {
        await setBraceField('thickV', 350);
        let stV = await braceErrState();
        assert.match(stV.err, / thickness is too big/, '[desktop] thickV=350 refused');
        assert.strictEqual(stV.disabled, true, '[desktop] thickV=350 disables Open');
        await setBraceField('thickV', 38);

        await setBraceField('thickH', 600);
        let stH = await braceErrState();
        assert.match(stH.err, / thickness is too big/, '[desktop] thickH=600 refused');
        assert.strictEqual(stH.disabled, true, '[desktop] thickH=600 disables Open');
        await setBraceField('thickH', 38);
      }

      await press('.sk-tp-open');
      await waitFor(`!document.querySelector('.sk-tp-panel')`, `[${kind}] brace opened after valid recovery`);
      await dontSave();
    }

    assert.strictEqual(pageErrors.length, 0, 'no uncaught page errors: ' + pageErrors.join('; '));
    console.log('template-polish-693-live: ok');
  } finally {
    await cdp.close();
  }
})();
