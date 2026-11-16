// tests/template-units-722-live.test.js -- TASK 722 in REAL Shaper and SketchStudio (desktop 1400x900 mouse + phone 390x844 touch): the document is set to
// INCHES, then
//   - the picker's card preview of the right-angle brace labels its dimensions in inches (23.625, not 600)
//   - its start view shows the fields in inches (11.8125 / 23.625 / 1.5 with the unit "in") and accepts typed text: 1/8 in, 3" (and 38mm)
//   - a refused value says the limit in inches
//   - Shaper: Open -> the Parameters table has the parameters in inches ("3 in", "0.125 in")
// Screenshots to .evidence/722/.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sendRealKey, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const EVID = path.join(process.cwd(), '.evidence', '722');

await (async () => {
  const cdp = await launchBrowser({ tag: '722', width: 1400, height: 900 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate, waitForApp } = cdp;
  const pageErrors = [];
  cdp.ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') pageErrors.push(JSON.stringify(m.params.exceptionDetails));
  });
  try {
    fs.mkdirSync(EVID, { recursive: true });
    for (const host of ['shaper', 'sketchstudio']) for (const kind of ['desktop', 'phone']) {
      const phone = kind === 'phone', tag = `${host}-${kind}`;
      await resetBufferLive(cdp);
      await send('Emulation.setDeviceMetricsOverride', phone
        ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, hasTouch: true }
        : { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false, hasTouch: false });
      await send('Emulation.setTouchEmulationEnabled', { enabled: phone, maxTouchPoints: phone ? 5 : 0 });
      const mouseEv = (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
      const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i + 1, radiusX: 1, radiusY: 1, force: 1 })) });
      const pointer = async (p) => {
        if (phone) { await T('touchStart', [p]); await sleep(45); await T('touchEnd', []); await sleep(300); }
        else { await mouseEv('mouseMoved', p.x, p.y); await sleep(30); await mouseEv('mousePressed', p.x, p.y, 1); await sleep(30); await mouseEv('mouseReleased', p.x, p.y); await sleep(260); }
      };
      const press = async (sel) => {
        const pt = await evalJs(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => !x.hidden && x.getClientRects().length > 0); if (!e) return null; e.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
        assert(pt, `[${tag}] missing clickable ${sel}`);
        await pointer(pt);
      };
      const shot = async (name, sel, pad = 4) => {
        await evalJs(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({ block: 'nearest' })`); await sleep(150);
        const r = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.max(0, b.left - ${pad}), y: Math.max(0, b.top - ${pad}), width: Math.min(innerWidth - Math.max(0, b.left - ${pad}), b.width + ${2 * pad}), height: Math.min(innerHeight - Math.max(0, b.top - ${pad}), b.height + ${2 * pad}) }; })()`);
        const s = await send('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 1 } });
        fs.writeFileSync(path.join(EVID, `${tag}-${name}`), Buffer.from(s.data, 'base64'));
      };
      const setField = async (param, val) => {
        await evalJs(`(() => { const i = document.querySelector('.sk-tp-field[data-param="${param}"] input'); i.scrollIntoView({ block: 'nearest' }); i.focus(); i.select(); })()`);
        await sendRealKey(send, 'Backspace', 'Backspace', 8);
        await send('Input.insertText', { text: String(val) });
        await sleep(450);
      };
      const field = (param) => evalJs(`(() => { const r = document.querySelector('.sk-tp-field[data-param="${param}"]'); return [r.querySelector('input').value, r.querySelector('.sk-tp-unit').textContent]; })()`);
      const err = () => evalJs(`document.querySelector('.sk-tp-err').textContent`);

      await navigate(`http://127.0.0.1:${port}/apps/${host}/index.html`, 10000);
      await waitFor(`!!document.querySelector('.sk-sidebar-btn, .sk-sidebar-handle')`, `[${tag}] loaded`);
      await waitForApp(host === 'shaper' ? 'design-canvas' : 'svgCanvas');
      // the document is set to inches (the setting the Units tab writes; not persisted)
      await evalJs(`(async () => { (await import('/packages/core/settings-manager.js')).default.set('DOC_UNIT', 'in', { persist: false }); })()`);
      assert.strictEqual(await evalJs(`(async () => (await import('/packages/core/settings-manager.js')).docUnit())()`), 'in', `[${tag}] document unit is inches`);

            await press('.sk-sidebar-btn, .sk-sidebar-handle');
      await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, `[${tag}] sidebar`);
            await press('[data-action="templates"]');
      await waitFor(`!!document.querySelector('.sk-tp-card')`, `[${tag}] cards`);
      await waitFor(`document.querySelector('.sk-tp-grid').dataset.previews === 'ready'`, `[${tag}] previews`, 30000);
      const labels = await evalJs(`[...document.querySelectorAll('.sk-tp-card[data-template="right-angle-brace"] svg text')].map((t) => t.textContent)`);
      assert.ok(labels.includes('23.625') && labels.includes('11.8125') && labels.includes('1.5'), `[${tag}] card labels in inches: ${JSON.stringify(labels)}`);
      assert.ok(!labels.includes('600') && !labels.includes('300'), `[${tag}] no mm labels: ${JSON.stringify(labels)}`);
      await shot('card-inches.png', '.sk-tp-card[data-template="right-angle-brace"]');

      await press('.sk-tp-card[data-template="right-angle-brace"]');
      await waitFor(`!!document.querySelector('.sk-tp-start[data-template="right-angle-brace"] .sk-tp-corner')`, `[${tag}] start view`);
      await sleep(250);
      assert.deepStrictEqual(await field('width'), ['11.8125', 'in'], `[${tag}] width`);
      assert.deepStrictEqual(await field('height'), ['23.625', 'in'], `[${tag}] height`);
      assert.deepStrictEqual(await field('thickV'), ['1.5', 'in'], `[${tag}] thickV`);
      await shot('start-inches.png', '.sk-tp-panel');
      // a refused value says the limit in inches
      await setField('thickD', 20);
      const msg = await err();
      assert.match(msg, /^Diagonal board thickness is too big for this width and height: use less than [\d.]+ in\.$/, `[${tag}] the refusal speaks inches: ${msg}`);
      await shot('refusal-inches.png', '.sk-tp-panel');
      await setField('thickD', '1/2 in');
      assert.strictEqual(await err(), '', `[${tag}] "1/2 in" accepted`);
      // typed text: 3" and 1/8 in and 38mm
      await setField('thickV', '3"');
      await setField('thickH', '1/8 in');
      await setField('width', '381mm');
      assert.strictEqual(await err(), '', `[${tag}] typed units accepted: ${await err()}`);
      assert.strictEqual(await evalJs(`document.querySelector('.sk-tp-open').disabled`), false, `[${tag}] Open enabled`);
      await shot('typed-inches.png', '.sk-tp-panel');
      await press('.sk-tp-open');
      await waitFor(`!document.querySelector('.sk-tp-panel')`, `[${tag}] Open closes the modal`);
      await sleep(300);
      const has = await evalJs(`[...document.querySelectorAll('.sk-tp-backdrop [role="dialog"] button')].some((b) => /Don.t save/.test(b.textContent))`);
      if (has) await press('.sk-tp-backdrop [role="dialog"] button:nth-of-type(2)');
      if (host === 'shaper') {
        await waitFor(`window.__designController.state.shapes.length > 3`, `[${tag}] drawn`);
        const rows = await evalJs(`JSON.stringify(window.__designController.state.parameters.map((p) => [p.name, p.unit, p.expression]))`).then(JSON.parse);
        assert.deepStrictEqual(rows, [['width', 'in', '15 in'], ['height', 'in', '23.625 in'], ['thick_v', 'in', '3 in'], ['thick_h', 'in', '0.125 in'], ['thick_d', 'in', '0.5 in']], `[${tag}] the user parameters`);
        await press('#btn-parameters');
        await waitFor(`document.querySelectorAll('.sk-pwin tr.pt-user').length === 5`, `[${tag}] Parameters window`);
        await sleep(300);
        await shot('parameters-inches.png', '.sk-pwin');
      } else {
        await waitFor(`document.querySelectorAll('#svgCanvas line, #svgCanvas path').length > 3`, `[${tag}] drawn`);
      }
    }
    assert.strictEqual(pageErrors.length, 0, 'no uncaught page errors: ' + pageErrors.join('; '));
    console.log('template-units-722-live: ok');
  } catch (e) {
    console.log('FAIL', e.stack);
    process.exitCode = 1;
  } finally {
    await cdp.close();
  }
})();
