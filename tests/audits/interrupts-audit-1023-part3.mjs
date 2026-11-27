// tests/audits/interrupts-audit-1023-part3.mjs: TASK 1023 (AUDIT ONLY). Wheel zoom, middle-drag pan, panel clicks, window blur/focus, every tool x stage (and mid-drag).
import { startHost, FIX } from './interrupts-audit-1023-kit.js';
import { runMatrix } from './interrupts-audit-1023-matrix.js';
import { sleep } from '../helpers/cdp-browser.js';

const h = await startHost({ host: 'shaper', tag: '1023-p3' });
try {
  await h.setBrowserCollapsed(false);   // the Sketches browser visible: a panel to click
  await h.cdp.evalJs(`window.__blurN = 0; window.__focusN = 0; window.addEventListener('blur', () => window.__blurN++); window.addEventListener('focus', () => window.__focusN++);`);
  const cell = await h.w2s(FIX.EMPTY.x, FIX.EMPTY.y);
  const ctr = { x: cell.x, y: cell.y };
  console.log('\n=== wheel zoom ===');
  await runMatrix(h, 'WHL', 'wheel-zoom', async (hh, ctx) => {
    await hh.wheelAt(ctr.x, ctr.y, -240, 120);
    await hh.wheelAt(ctr.x, ctr.y, 120, 120);
  }, { view: false, complete: true });
  console.log('\n=== wheel zoom (view change check) ===');
  await runMatrix(h, 'WHV', 'wheel-zoom-view', async (hh) => { await hh.wheelAt(ctr.x, ctr.y, -240, 120); }, { view: true, skip: (s, st) => st !== 'after1st' && st !== 'before1st' });
  console.log('\n=== middle-drag pan ===');
  await runMatrix(h, 'PAN', 'middle-pan', async (hh) => { await hh.middlePan(ctr.x, ctr.y, 60, 30, { settle: 120 }); }, { view: true, complete: true, skip: (s, st) => st === 'midDrag' || st === 'transformDrag' });
  console.log('\n=== click Sketches browser panel header, back to canvas hover ===');
  await runMatrix(h, 'PNB', 'panel-sketches-browser', async (hh) => {
    await hh.clickScreen(120, 175, { settle: 120 });
    await hh.moveW(FIX.DRAW_P2.x, FIX.DRAW_P2.y);
  }, { complete: true, skip: (s, st) => st === 'midDrag' || st === 'transformDrag' });
  console.log('\n=== click footer blank space ===');
  await runMatrix(h, 'PNF', 'panel-footer', async (hh) => {
    await hh.clickScreen(640, 780, { settle: 120 });
    await hh.moveW(FIX.DRAW_P2.x, FIX.DRAW_P2.y);
  }, { complete: true, skip: (s, st) => st === 'midDrag' || st === 'transformDrag' });
  console.log('\n=== Parameters window: open (footer fx), click its header, close ===');
  await runMatrix(h, 'PNP', 'panel-parameters', async (hh) => {
    await hh.clickScreen(174, 780, { settle: 160 });      // #btn-parameters
    const open = await hh.inspect();
    const hd = await hh.cdp.evalJs(`(() => { const e = document.querySelector('.sk-pwin .sk-dock-title, .sk-pwin .sk-dock-head, .sk-pwin'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + Math.min(40, r.width / 2), y: r.top + 12 }; })()`);
    if (hd) await hh.clickScreen(hd.x, hd.y, { settle: 120 });
    const mid = await hh.inspect();
    await hh.clickScreen(174, 780, { settle: 160 });      // close again
    await hh.moveW(FIX.DRAW_P2.x, FIX.DRAW_P2.y);
    return `|| pwinOpen=${open.pwinOpen} tool@open=${open.tool} active@open=${open.hasActive} boxes@open=[${open.openBoxes.join(',')}] focus@open=${mid.focus}`;
  }, { complete: true, skip: (s, st) => st === 'midDrag' || st === 'transformDrag' });
  console.log('\n=== sidebar (burger) open and close by backdrop ===');
  await runMatrix(h, 'PNS', 'panel-sidebar', async (hh) => {
    await hh.clickScreen(54, 21, { settle: 200 });
    const open = await hh.inspect();
    await hh.clickScreen(900, 400, { settle: 160 });      // outside click closes it
    await hh.moveW(FIX.DRAW_P2.x, FIX.DRAW_P2.y);
    return `|| tool@open=${open.tool} active@open=${open.hasActive} boxes@open=[${open.openBoxes.join(',')}]`;
  }, { complete: true, skip: (s, st) => st === 'midDrag' || st === 'transformDrag' });
  console.log('\n=== window blur / focus ===');
  const probe = await h.cdp.evalJs(`({ b: window.__blurN, f: window.__focusN })`);
  console.log('blur counters before:', JSON.stringify(probe));
  await runMatrix(h, 'BLR', 'blur-focus', async (hh) => {
    let real = false;
    try {
      const t = await hh.cdp.send('Target.createTarget', { url: 'about:blank', background: false });
      await sleep(250);
      await hh.cdp.send('Target.activateTarget', { targetId: (await hh.cdp.send('Target.getTargetInfo', {})).targetInfo.targetId });
      await sleep(250);
      real = true;
    } catch (_) { /* fall through */ }
    const c = await hh.cdp.evalJs(`({ b: window.__blurN, f: window.__focusN, vis: document.visibilityState })`);
    if (!c.b) {
      // headless gives no real window blur: dispatch the page-level events (SYNTHETIC)
      await hh.cdp.evalJs(`window.dispatchEvent(new Event('blur')); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus'));`);
      await sleep(120);
      return `|| synthetic blur+focus (real targets: ${real}, counters ${JSON.stringify(c)})`;
    }
    return `|| REAL blur ${JSON.stringify(c)}`;
  }, { complete: true, skip: (s, st) => st === 'midDrag' || st === 'transformDrag' });
} finally { await h.close(); }
