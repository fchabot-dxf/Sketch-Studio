// tests/dimension-enter-once-live.test.js - TASK 593: in the real browser, the real Enter key in a dimension's edit box commits ONCE (the
// numeric-input-manager listener only; live-dimension-input.js no longer listens on #dimInput): the value changes, ONE undo step, no
// 'live-rect-commit' (retired with the line boxes, task 597), no page error. The node twin (all modes): tests/dimension-enter-once-node.test.js.
import assert from 'node:assert';
import { launchBrowser } from './helpers/cdp-browser.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await (async () => {
  const cdp = await launchBrowser({ tag: '593', width: 1400, height: 800, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, once, evalJs, ws, waitFor, waitForApp } = cdp;
  const errors = [];
  try {
    ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text)); });
    ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value || (a.description || '').slice(0, 300)).join(' ')); });
    const mouse = async (type, x, y, buttons = 0, clickCount = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: (buttons || type === 'mouseReleased') ? 'left' : 'none', buttons, clickCount });
    const clickEl = async (sel) => {
      const c = await evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`);
      assert(c, sel + ' not found');
      await mouse('mouseMoved', c.x, c.y); await mouse('mousePressed', c.x, c.y, 1, 1); await mouse('mouseReleased', c.x, c.y, 0, 1); await sleep(200);
    };
    const loaded = once('Page.loadEventFired');
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/apps/shaper/index.html` });
    await Promise.race([loaded, sleep(8000)]); await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'the Shaper to load');
    for (let i = 0; i < 5; i++) { await clickEl('.sk-header-tab[data-tab="design"]'); await sleep(300); if (await evalJs(`document.querySelector('.sk-header-tab.active').dataset.tab`) === 'design') break; }
    await waitForApp('design-canvas'); await waitFor(`!!window.__designController && document.getElementById('design-canvas').getBoundingClientRect().width > 0`, 'the Design tab to show');
    await evalJs(`(() => {
      const st = window.__designController.state;
      for (const k of [...st.joints.keys()]) if (k !== 'j_origin') st.joints.delete(k);
      st.shapes.length = 0; st.constraints.length = 0;
      st.joints.set('a', { x: -45, y: -20 }); st.joints.set('b', { x: -5, y: -20 });
      st.shapes.push({ id: 'L1', type: 'line', joints: ['a', 'b'] });
      st.constraints.push({ type: 'distance', name: 'd1', joints: ['a', 'b'], value: 40, glyphPos: { x: -25, y: -30 } });
      window.__commits = 0; window.addEventListener('live-rect-commit', () => { window.__commits++; });
      if (window.__designController.render) window.__designController.render();
    })()`);
    await sleep(300);
    const lab = await evalJs(`(() => { const e = document.querySelector('#design-canvas .dim-label[data-constraint-idx="0"]'); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()`);
    assert(lab, 'the dimension label is on screen');
    await mouse('mouseMoved', lab.x, lab.y);
    for (const n of [1, 2]) { await mouse('mousePressed', lab.x, lab.y, 1, n); await mouse('mouseReleased', lab.x, lab.y, 0, n); }
    await waitFor(`!document.getElementById('dimInput').classList.contains('hidden')`, 'the edit box');
    const hist = () => evalJs(`window.__designController.state.history.length`);
    const h0 = await hist();
    await evalJs("document.getElementById('dimInput').focus(); document.getElementById('dimInput').select()");
    await send('Input.insertText', { text: '55' });
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await sleep(500);
    const r = JSON.parse(await evalJs(`JSON.stringify({ v: window.__designController.state.constraints[0].value, n: window.__designController.state.constraints.length, commits: window.__commits, open: !document.getElementById('dimInput').classList.contains('hidden') })`));
    assert.strictEqual(r.v, 1397, 'the value changed to 55 (the Shaper reads the box in its inch unit: 1397 mm): ' + JSON.stringify(r));
    assert.strictEqual(r.n, 1, 'still one constraint');
    assert.strictEqual(r.commits, 0, 'no live-line / live-rect commit from the dimension box');
    assert.strictEqual(r.open, false, 'the box closed');
    assert.strictEqual(await hist(), h0 + 1, 'ONE undo step');
    assert.deepStrictEqual(errors, [], 'no page error');
    console.log('one Enter, one commit (real key): ok', JSON.stringify(r));
  } finally { try { await cdp.close(); } catch (_) {} }
})();
