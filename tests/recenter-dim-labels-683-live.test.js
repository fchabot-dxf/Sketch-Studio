// tests/recenter-dim-labels-683-live.test.js — TASK 683B: Recenter (and open/fitToDrawing) frames every .dim-label rect inside #design-canvas
// for rounded-rectangle and box-frame templates on both desktop mouse (1280x800) and phone touch (390x844).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

await (async () => {
  const cdp = await launchBrowser({ tag: '683', width: 1280, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate, waitForApp } = cdp;

  const shot = async (name) => {
    if (!process.env.EVIDENCE_DIR) return;
    fs.mkdirSync(process.env.EVIDENCE_DIR, { recursive: true });
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name), Buffer.from(s.data, 'base64'));
  };
  const center = async (sel, i = 0) => {
    const c = await evalJs(`(() => { const e = document.querySelectorAll(${JSON.stringify(sel)})[${i}]; if (!e) return null; const r = e.getBoundingClientRect(); return r.width ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null; })()`);
    assert(c, sel + ' #' + i + ' not on screen');
    return c;
  };
  const mouseEv = (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
  const mouse = async (x, y) => { await mouseEv('mouseMoved', x, y); await sleep(30); await mouseEv('mousePressed', x, y, 1); await sleep(30); await mouseEv('mouseReleased', x, y); await sleep(250); };
  const touchEv = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
  const touch = async (x, y) => { await touchEv('touchStart', [{ x, y }]); await sleep(40); await touchEv('touchEnd', []); await sleep(300); };
  let pointer = mouse;
  const press = async (sel, i = 0) => {
    await evalJs(`document.querySelectorAll(${JSON.stringify(sel)})[${i}].scrollIntoView({ block: 'nearest', inline: 'nearest' })`);
    await sleep(60);
    const c = await center(sel, i);
    await pointer(c.x, c.y);
  };
  const openMenu = async () => {
    const c = await evalJs(`(() => { const e = [...document.querySelectorAll('.sk-sidebar-btn, .sk-sidebar-chevron')].find((x) => x.getClientRects().length > 0); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    assert(c, 'menu trigger');
    await pointer(c.x, c.y);
    await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'sidebar open');
  };
  const dontSave = async () => {
    await sleep(250);
    const has = await evalJs(`[...document.querySelectorAll('.sk-tp-backdrop [role="dialog"] button')].some((b) => /Don.t save/.test(b.textContent))`);
    if (has) await press('.sk-tp-backdrop [role="dialog"] button:nth-of-type(2)').catch(() => {});
  };
  const openTemplate = async (id, minDimLabels) => {
    await openMenu();
    await press('[data-action="templates"]');
    await waitFor(`!!document.querySelector('.sk-tp-card')`, 'template modal');
    await press(`.sk-tp-card[data-template="${id}"]`);
    await waitFor(`!!document.querySelector('.sk-tp-panel.sk-tp-small .sk-tp-start[data-template="${id}"]')`, `${id} start view`);
    await press('.sk-tp-open');
    await waitFor(`!document.querySelector('.sk-tp-panel')`, `${id} modal closed`);
    await dontSave();
    await waitFor(`document.querySelectorAll('#design-canvas .dim-label').length >= ${minDimLabels}`, `${id} dimension labels drawn`);
  };
  const openShaper = async () => {
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 10000);
    await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"], .sk-sidebar-chevron')`, 'Shaper to load');
    for (let i = 0; i < 5; i++) {
      const on = await evalJs(`(() => { const t = document.querySelector('.sk-header-tab.active'); return !t || t.dataset.tab === 'design'; })()`);
      if (on) break;
      await press('.sk-header-tab[data-tab="design"]');
    }
    await waitFor(`!!window.__designController && !!document.getElementById('btn-recenter-view')`, 'Shaper Design tab ready');
    await waitForApp('design-canvas');
  };
  const inspectLabels = () => evalJs(`(() => {
    const c = document.getElementById('design-canvas').getBoundingClientRect();
    const s = window.__designController.state;
    const labels = [...document.querySelectorAll('#design-canvas .dim-label')].map((el) => {
      const idx = parseInt(el.dataset.constraintIdx, 10);
      const con = s.constraints[idx] || {};
      const r = el.getBoundingClientRect();
      return {
        idx,
        name: con.name || null,
        expr: con.expression || null,
        text: (el.textContent || '').trim(),
        left: +r.left.toFixed(1), right: +r.right.toFixed(1),
        top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1),
        width: +r.width.toFixed(1), height: +r.height.toFixed(1),
        inside: r.width > 0 && r.left >= c.left && r.right <= c.right && r.top >= c.top && r.bottom <= c.bottom,
      };
    });
    return {
      canvas: { left: +c.left.toFixed(1), right: +c.right.toFixed(1), top: +c.top.toFixed(1), bottom: +c.bottom.toFixed(1), width: +c.width.toFixed(1), height: +c.height.toFixed(1) },
      outside: labels.filter((l) => !l.inside),
      total: labels.length,
    };
  })()`);

  const checkTemplate = async (mode, id, minDimLabels) => {
    await openTemplate(id, minDimLabels);
    // Zoom in/pan slightly so Recenter actively performs a fresh fit too, then click Recenter.
    const mid = await center('#design-canvas');
    if (pointer === mouse) {
      await mouseEv('mouseMoved', mid.x, mid.y);
      await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: mid.x, y: mid.y, deltaX: 0, deltaY: -240 });
      await sleep(150);
    }
    await press('#btn-recenter-view');
    await waitFor(`document.querySelectorAll('#design-canvas .dim-label').length >= ${minDimLabels}`, `${id} labels after recenter`);
    await sleep(200);
    const res = await inspectLabels();
    await shot(`${mode}-${id}.png`);
    assert.ok(res.total >= minDimLabels, `${mode} ${id}: expected >= ${minDimLabels} labels, got ${res.total}`);
    assert.deepStrictEqual(res.outside, [], `${mode} ${id}: every .dim-label rect must be inside canvas ${JSON.stringify(res.canvas)}, off-canvas: ${JSON.stringify(res.outside)}`);
    console.log(`${mode} ${id}: all ${res.total} .dim-label rects inside canvas ✅`);
  };

  try {
    // 1. Desktop (mouse)
    await openShaper();
    await resetBufferLive(cdp);
    await openShaper();
    await checkTemplate('desktop', 'rounded-rectangle', 3);
    await checkTemplate('desktop', 'box-frame', 14);

    // 2. Phone 390x844 (real touch)
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    pointer = touch;
    await openShaper();
    await checkTemplate('phone', 'rounded-rectangle', 3);
    await checkTemplate('phone', 'box-frame', 14);

    console.log('recenter-dim-labels-683-live: ok');
  } finally {
    await cdp.close();
  }
})();
