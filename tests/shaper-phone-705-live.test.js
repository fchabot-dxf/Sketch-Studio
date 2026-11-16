// tests/shaper-phone-705-live.test.js — TASK 705: Shaper on a PHONE (real touch, mobile viewport) at 390 x 844 and 412 x 900 portrait and 844 x 390
// landscape, opened fresh (no stored stage, one empty Untitled tab):
//  - the stage switch is reachable from the first screen: the peeking drawer handle (TASK 619: phones have no header bar, the stages are the drawer's
//    first row) is on screen; a real tap opens the drawer and every stage button is inside the screen and 44 px; a tap on one shows that stage;
//  - EVERY stage fits: its main canvas is at least 60 % of the viewport width (and 40 % of its height), the page and the body do not scroll sideways,
//    and every side panel of the stage is inside the screen and at least 160 px wide (no squeezed or cut-off column);
//  - a template opened from the picker ("+" on the tab strip, a tap on its card, Open) while Prepare shows is SHOWN: Shaper goes to Design and the
//    drawing lies inside the Design canvas. (TASK 706: Explore, a separate SVG viewer and 705's starting stage, is gone; a fresh Shaper opens on Design,
//    and an opened design is shown in Design from ANY stage: 705's checks "opened from Explore" became "opened from Prepare" / "from Review".)
// Desktop 1280 x 800, real mouse: the same rule (a template opened from Review shows in Design); a tab switch from Prepare stays in Prepare.
// EVIDENCE_DIR set: a screenshot of every stage at every size.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const SIZES = [
  { w: 390, h: 844, orientation: { type: 'portraitPrimary', angle: 0 } },
  { w: 412, h: 900, orientation: { type: 'portraitPrimary', angle: 0 } },
  { w: 844, h: 390, orientation: { type: 'landscapePrimary', angle: 90 } },
];
// each stage's main canvas and the side panels it shows beside / under it
const STAGES = [
  { id: 'design', canvas: '#design-canvas', panels: [] },
  { id: 'vcarve', canvas: '#vcarve-canvas', panels: ['#vcarve-panel'] },
  { id: 'prepare', canvas: '#prepare-canvas', panels: [] },
  { id: 'review', canvas: '#review-stage', panels: ['#review-side'] },
];

await (async () => {
  const cdp = await launchBrowser({ tag: '705', width: 1280, height: 800, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate, waitForApp } = cdp;
  const url = `http://127.0.0.1:${port}/apps/shaper/index.html`;
  const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
  const touch = async (x, y) => { await T('touchStart', [{ x, y }]); await sleep(40); await T('touchEnd', []); await sleep(400); };
  const mouse = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 }); await sleep(30);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(30);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(400);
  };
  let pointer = touch;
  const rectOf = (sel) => evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height), shown: r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' }; })()`);
  // presses the element's centre and asserts the element (or a child) is what is under it: a real user can reach it
  const press = async (sel, what) => {
    const p = await evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const h = document.elementFromPoint(x, y); return { x, y, hit: !!h && (h === e || e.contains(h)) }; })()`);
    assert(p, what + ': ' + sel + ' not found');
    assert(p.hit, what + ': ' + sel + ' is covered at its centre ' + JSON.stringify(p));
    await pointer(p.x, p.y);
  };
  const shot = async (name) => {
    if (!process.env.EVIDENCE_DIR) return;
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name), Buffer.from(s.data, 'base64'));
  };
  const activeStage = () => evalJs(`(() => { const e = document.querySelector('.sk-sidebar-stage.active') || document.querySelector('.sk-header-tab.active'); return e ? e.dataset.tab : null; })()`);
  const scroll = () => evalJs(`({ doc: document.documentElement.scrollWidth, body: document.body.scrollWidth, vw: innerWidth })`);
  // fresh: the shared tab buffer emptied and no stored stage (the reset page is on the same origin)
  const fresh = async () => {
    await resetBufferLive(cdp);
    await evalJs(`localStorage.removeItem('shaper-mode')`);
    await navigate(url, 10000);
    await waitForApp('design-canvas');
    await waitFor(`document.querySelectorAll('.sk-doctab-name').length === 1`, 'one Untitled tab');
    await sleep(500);
  };
  // the template picker from the strip's "+" -> the card -> Open
  const openTemplate = async (id, tag) => {
    const before = await evalJs(`document.querySelectorAll('.sk-doctab-name').length`);
    await press('.sk-doctab-new', tag + 'the + tab button');
    await waitFor(`!!document.querySelector('.sk-tp-grid[data-previews="ready"]')`, tag + 'the template picker');
    await evalJs(`document.querySelector('.sk-tp-card[data-template="${id}"]').scrollIntoView({ block: 'nearest' })`); await sleep(150);
    await press(`.sk-tp-card[data-template="${id}"]`, tag + 'the template card');
    await waitFor(`!!document.querySelector('.sk-tp-start[data-template="${id}"]')`, tag + 'its start view');
    await press('.sk-tp-open', tag + 'Open');
    await waitFor(`document.querySelectorAll('.sk-doctab-name').length === ${before + 1}`, tag + 'the template opened in a new tab');
    await sleep(800);
  };
  // the drawing's shapes that lie inside the Design canvas on screen
  const shapesInCanvas = () => evalJs(`(() => { const c = document.getElementById('design-canvas').getBoundingClientRect();
    return [...document.querySelectorAll('#design-canvas .shape-elem')].filter((e) => { const r = e.getBoundingClientRect(); return (r.width > 0 || r.height > 0) && r.left >= c.left - 1 && r.right <= c.right + 1 && r.top >= c.top - 1 && r.bottom <= c.bottom + 1; }).length; })()`);

  try {
    for (const size of SIZES) {
      const tag = `@${size.w}x${size.h}: `;
      await send('Emulation.setDeviceMetricsOverride', { width: size.w, height: size.h, deviceScaleFactor: 2, mobile: true, screenOrientation: size.orientation });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      pointer = touch;
      await fresh();
      // the first screen, as the owner sees it
      const first = { stage: await activeStage(), header: await evalJs(`getComputedStyle(document.querySelector('header.sk-header')).display`), handle: await rectOf('.sk-sidebar-handle'),
        canvas: await rectOf('#design-canvas'), scroll: await scroll() };
      console.log(tag + 'first screen ' + JSON.stringify(first));
      assert.strictEqual(first.stage, 'design', tag + 'a fresh Shaper opens on Design (TASK 706: was Explore)');
      assert(first.canvas && first.canvas.shown, tag + 'the Design canvas is on the first screen');
      assert(first.handle && first.handle.shown && first.handle.left <= 1 && first.handle.h >= 44 && first.handle.top >= 0 && first.handle.bottom <= size.h, tag + 'the drawer handle (the way to the stages) is on the first screen: ' + JSON.stringify(first.handle));

      for (const st of STAGES) {
        // the stage switch: a real tap on the handle opens the drawer; its stage buttons are on screen and 44 px; a tap shows the stage
        await press('.sk-sidebar-handle', tag + 'the drawer handle');
        await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, tag + 'the drawer opens');
        await sleep(300);
        const btns = await evalJs(`[...document.querySelectorAll('.sk-sidebar-stage')].map((b) => { const r = b.getBoundingClientRect(); return { id: b.dataset.tab, left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height }; })`);
        assert.deepStrictEqual(btns.map((b) => b.id), STAGES.map((s) => s.id), tag + 'the drawer lists every stage');
        for (const b of btns) assert(b.left >= 0 && b.right <= size.w && b.top >= 0 && b.bottom <= size.h && b.h >= 44 && b.w >= 44, tag + 'stage button on screen and 44 px: ' + JSON.stringify(b));
        await press(`.sk-sidebar-stage[data-tab="${st.id}"]`, tag + st.id + ' stage button');
        await waitFor(`!document.querySelector('.sk-sidebar').classList.contains('open')`, tag + 'the drawer closes');
        assert.strictEqual(await activeStage(), st.id, tag + 'the tapped stage is active');
        await sleep(st.id === 'review' ? 1500 : 500);
        const cv = await rectOf(st.canvas);
        const sc = await scroll();
        const panels = [];
        for (const p of st.panels) panels.push({ sel: p, ...(await rectOf(p)) });
        console.log(tag + st.id + ' ' + JSON.stringify({ canvas: cv, scroll: sc, panels }));
        await shot(`after-${size.w}x${size.h}-${st.id}.png`);
        assert(cv && cv.shown, tag + st.id + ': its canvas shows');
        assert(cv.w >= 0.6 * size.w, tag + st.id + `: the canvas is ${Math.round(100 * cv.w / size.w)} % of the width (>= 60 %): ` + JSON.stringify(cv));
        assert(cv.h >= 0.4 * size.h, tag + st.id + `: the canvas is ${Math.round(100 * cv.h / size.h)} % of the height (>= 40 %): ` + JSON.stringify(cv));
        assert(cv.left >= 0 && cv.right <= size.w, tag + st.id + ': the canvas is inside the screen: ' + JSON.stringify(cv));
        assert(sc.doc <= size.w && sc.body <= size.w, tag + st.id + ': no sideways overflow (page / body scrollWidth <= innerWidth): ' + JSON.stringify(sc));
        for (const p of panels) {
          if (!p.shown) continue;
          assert(p.left >= 0 && p.right <= size.w && p.bottom <= size.h, tag + st.id + ': ' + p.sel + ' is inside the screen: ' + JSON.stringify(p));
          assert(p.w >= 160, tag + st.id + ': ' + p.sel + ' is at least 160 px wide: ' + JSON.stringify(p));
        }
      }

      // a template opened from Prepare shows (in Design)
      await press('.sk-sidebar-handle', tag + 'the drawer handle'); await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, tag + 'the drawer opens'); await sleep(300);
      await press('.sk-sidebar-stage[data-tab="prepare"]', tag + 'Prepare'); await sleep(400);
      assert.strictEqual(await activeStage(), 'prepare', tag + 'on Prepare');
      await openTemplate('rounded-rectangle', tag);
      const stageAfter = await activeStage();
      const nIn = await shapesInCanvas();
      console.log(tag + 'template opened from Prepare ' + JSON.stringify({ stage: stageAfter, designHidden: await evalJs(`document.getElementById('design-view').hidden`), shapesInCanvas: nIn }));
      await shot(`after-${size.w}x${size.h}-template.png`);
      assert.strictEqual(stageAfter, 'design', tag + 'a template opened from Prepare shows in Design (TASK 706)');
      assert.strictEqual(await evalJs(`document.getElementById('design-view').hidden`), false, tag + 'the Design view shows');
      assert(nIn >= 8, tag + 'the rounded rectangle (4 lines + 4 arcs) lies inside the Design canvas: ' + nIn);
    }

    // ---- desktop, real mouse: the same rule ----
    await send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    pointer = mouse;
    await fresh();
    const dt = '@1280x800: ';
    assert.strictEqual(await activeStage(), 'design', dt + 'a fresh Shaper opens on Design (TASK 706: was Explore)');
    assert.strictEqual((await rectOf('.sk-header-tab[data-tab="design"]')).shown, true, dt + 'the header stage tabs show');
    await press('.sk-header-tab[data-tab="review"]', dt + 'the Review tab'); await sleep(800);
    await openTemplate('rounded-rectangle', dt);
    assert.strictEqual(await activeStage(), 'design', dt + 'a template opened from Review shows in Design (TASK 706)');
    assert((await shapesInCanvas()) >= 8, dt + 'the rounded rectangle lies inside the Design canvas');
    // a tab switch is not an open: on Prepare, switching tabs stays in Prepare
    await press('.sk-header-tab[data-tab="prepare"]', dt + 'the Prepare tab');
    await press('.sk-doctab:not(.active) .sk-doctab-name', dt + 'the Untitled tab');
    await sleep(400);
    assert.strictEqual(await activeStage(), 'prepare', dt + 'a tab switch keeps the stage');
    console.log('shaper-phone-705: all checks pass');
  } finally {
    await cdp.close();
  }
})();
