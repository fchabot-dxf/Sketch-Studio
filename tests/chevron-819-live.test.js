// tests/chevron-819-live.test.js: TASK 819 (live headless, real touch). PART 1: the sidebar drawer's door is a CHEVRON, the first child of the document tab strip, left of the first
// tab (phone portrait 390x844 and landscape 844x390, SketchStudio / Shaper / Pen Plotter / Trace); no `.sk-sidebar-handle` is left; a tap opens the drawer, the tab strip does not
// shift (0 px), aria-expanded / labels follow, the backdrop closes it and the chevron is the focus again (TASK 783); at 1280 desktop the chevron is not shown.
// PART 2: the footer button group is tucked in the lower-left corner: landscape 844x390 = its first button 8 px from the left edge and the group 8 px above the bottom in every stage
// where no tool rail shows (beside the rail where one shows); portrait = the docked bar at the lower-left (left edge, bottom edge). 44 px high targets. Screenshots: .evidence/819.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { FOOTER_PHONE_MIN_W } from '../packages/ui/footer-slot.js';

const EVID = path.join(process.cwd(), '.evidence', '819');
const HOSTS = [
  { name: 'sketchstudio', url: '/apps/sketchstudio/index.html', stages: [['design', true], ['drawing', false]] },
  { name: 'shaper', url: '/apps/shaper/index.html', stages: [['design', true], ['prepare', false], ['review', false]] },
  { name: 'penplotter', url: '/apps/penplotter/index.html', stages: [['design', true], ['toolpath', false], ['export', false]] },
  { name: 'trace', url: '/apps/trace/index.html', stages: [['trace', false], ['edit', true], ['export', false]] },
];
const cdp = await launchBrowser({ tag: '819', width: 844, height: 390 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, navigate, close } = cdp;
try {
  fs.mkdirSync(EVID, { recursive: true });
  const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
  const tap = async (p) => { await T('touchStart', [p]); await sleep(40); await T('touchEnd', []); await sleep(400); };
  const rect = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; })()`);
  const open = () => evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`);

  // desktop: no chevron, no handle
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  for (const h of HOSTS) {
    await navigate(`http://127.0.0.1:${port}${h.url}`, 8000); await sleep(1000);
    assert.strictEqual(await evalJs(`document.querySelector('.sk-sidebar-handle')`), null, `${h.name} desktop: no drawer handle element`);
    assert.strictEqual(await evalJs(`getComputedStyle(document.querySelector('.sk-sidebar-chevron')).display`), 'none', `${h.name} desktop: the chevron is not shown`);
  }

  for (const [w, hgt] of [[390, 844], [844, 390]]) {
    const land = w > hgt;
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: hgt, deviceScaleFactor: 2, mobile: true, screenOrientation: land ? { type: 'landscapePrimary', angle: 90 } : { type: 'portraitPrimary', angle: 0 } });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    for (const h of HOSTS) {
      const tag = `${h.name} ${w}x${hgt}: `;
      await navigate(`http://127.0.0.1:${port}${h.url}`, 8000);
      await waitFor(`!!document.querySelector('.sk-doctab') && !!document.querySelector('.sk-sidebar-chevron') && !!document.querySelector('.sk-header-tab[data-tab="${h.stages[0][0]}"]')`, tag + 'strip and chevron');
      await evalJs(`document.querySelector('.sk-header-tab[data-tab="${h.stages[0][0]}"]').click()`); await sleep(700); // the stage is remembered between loads: start from the first
      // PART 1
      assert.strictEqual(await evalJs(`document.querySelector('.sk-sidebar-handle')`), null, tag + 'no drawer handle element');
      const chev = await rect('.sk-sidebar-chevron'), tab = await rect('.sk-doctab'), strip = await rect('.sk-doctabs');
      assert(chev && chev.w >= 44 && chev.h >= 30, tag + `chevron 44 px wide, the strip's row high: ${JSON.stringify(chev)}`);
      assert(chev.r <= tab.l + 0.5, tag + `the chevron is left of the first tab: ${JSON.stringify([chev, tab])}`);
      assert(chev.t >= strip.t - 0.5 && chev.b <= strip.b + 0.5, tag + 'the chevron is inside the strip');
      assert.strictEqual(await evalJs(`document.querySelector('.sk-doctabs').firstElementChild.classList.contains('sk-sidebar-chevron')`), true, tag + 'first child of the strip');
      assert.strictEqual(await evalJs(`document.querySelector('.sk-sidebar-chevron').getAttribute('aria-expanded')`), 'false');
      await tap({ x: chev.l + chev.w / 2, y: chev.t + chev.h / 2 });
      assert.strictEqual(await open(), true, tag + 'a tap on the chevron opens the drawer');
      assert.strictEqual(await evalJs(`document.querySelector('.sk-sidebar-chevron').getAttribute('aria-expanded') + '|' + document.querySelector('.sk-sidebar-chevron').getAttribute('aria-label')`), 'true|Close menu');
      const tab2 = await rect('.sk-doctab'), strip2 = await rect('.sk-doctabs'), chev2 = await rect('.sk-sidebar-chevron');
      assert(tab2.l === tab.l && tab2.t === tab.t && strip2.t === strip.t && strip2.h === strip.h && chev2.l === chev.l, tag + 'the tab strip does not shift when the drawer opens (0 px)');
      if (h.name === 'shaper' && land) await send('Page.captureScreenshot', { format: 'png' }).then((r) => fs.writeFileSync(path.join(EVID, `drawer-open-${h.name}-${w}x${hgt}.png`), Buffer.from(r.data, 'base64')));
      await evalJs(`document.querySelector('.sk-sidebar-chevron').click()`); await sleep(300);
      assert.strictEqual(await open(), false, tag + 'the chevron closes the drawer');
      assert.strictEqual(await evalJs(`document.activeElement === document.querySelector('.sk-sidebar-chevron') && document.querySelector('.sk-sidebar-chevron').getAttribute('aria-label')`), 'Open menu', tag + 'closed: the chevron has the focus (TASK 783) and says Open menu');
      await tap({ x: chev.l + chev.w / 2, y: chev.t + chev.h / 2 }); assert.strictEqual(await open(), true, tag + 'reopens');
      await tap({ x: w - 10, y: hgt / 2 }); // the backdrop
      assert.strictEqual(await open(), false, tag + 'a tap on the backdrop closes it');

      // PART 2: the footer group, stage by stage
      for (const [stage, rail] of h.stages) {
        await evalJs(`document.querySelector('.sk-header-tab[data-tab="${stage}"]').click()`); await sleep(900);
        const st = `${tag}${stage}: `;
        const f = await evalJs(`(() => { const f = document.querySelector('.sk-footer, .sk-statusbar'); const bs = [...f.querySelectorAll('button')].filter((b) => b.getClientRects().length && getComputedStyle(b).visibility !== 'hidden').map((b) => { const r = b.getBoundingClientRect(); return { l: r.left, b: r.bottom, w: r.width, h: r.height }; }); return { n: bs.length, l: Math.min(...bs.map((b) => b.l)), b: Math.max(...bs.map((b) => b.b)), minH: Math.min(...bs.map((b) => b.h)), minW: Math.min(...bs.map((b) => b.w)) }; })()`);
        assert(f.n >= 3, st + 'footer buttons shown: ' + f.n);
        assert(f.minH >= 43.5 && f.minW >= FOOTER_PHONE_MIN_W - 0.5, st + `44 px targets: ${JSON.stringify(f)}`);
        if (!land) assert(f.b >= hgt - 1 && (f.l <= 4 || f.n < 5), st + `portrait: the docked bar at the bottom, its buttons from the left edge (SketchStudio's Drawing shows only Save / Settings / account, at the bar's right end, as before): ${JSON.stringify(f)}`);
        else if (!rail) assert(f.l >= 7.5 && f.l <= 16 && Math.abs(hgt - f.b - 8) <= 0.5, st + `landscape, no rail: tucked in the lower-left corner (8 px in, 8 px up): ${JSON.stringify(f)}`);
        else {
          const rl = await rect('.sk-ribbon');
          const edge = await evalJs(`parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sk-canvas-edge')) || 0`);
          assert(f.l >= rl.r && Math.abs(hgt - f.b - edge - 8) <= 0.5, st + `landscape, with the rail: right of it: ${JSON.stringify([f, rl])}`);
        }
        const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(EVID, `after-${h.name}-${w}x${hgt}-${stage}.png`), Buffer.from(s.data, 'base64'));
      }
    }
  }
  console.log('LIVE-OK chevron-819: chevron left of the first tab in four apps, 390 and 844x390; no handle; footer tucked lower-left');
} finally { await close(); }
