// tests/shared-header-live.test.js — TASK 619: unified shared app header & peeking mobile sidebar drawer across all 4 hosts.
// Verifies in headless Edge (real mouse clicks + real touch taps/drags, zero skipped/mocked paths):
//   a. Desktop 1440x900 (all 4 apps): header = ☰ + stage buttons only, height 44 px, identical layout/order/spacing, own colors, sideways scroll when tight;
//   b. ☰ menu entries work by real click in all 4 apps (Style closes menu first, Settings, Log, Debug, Tune solver, Export…, Shaper Explore Open SVG/Export on Explore only, Explore Recenter = fit, Pen Plotter Panel in .sk-canvas-corner < 768 px Design);
//   c & d. Phone portrait (390x844, 360x780) & short landscape (844x390, 780x360): NO header bar, .sk-doctabs at top === 0, peeking left .sk-sidebar-handle (tap to open, backdrop tap to close, drag right to open, drag left to close), stage buttons at top of sidebar switch stages.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX_SVG = path.join(ROOT, 'tests', 'fixtures', 'svg', 'import-basic.svg');

const APPS = [
  { id: 'sketchstudio', name: 'SketchStudio', url: '/apps/sketchstudio/index.html', stages: ['Design'], dark: false, nextStage: 'Design', ready: `!!document.getElementById('svgCanvas') && !!document.querySelector('.sk-header')` },
  { id: 'shaper',       name: 'Shaper',       url: '/apps/shaper/index.html',       stages: ['Explore', 'Design', 'Vcarve', 'Prepare', 'Review'], dark: true, nextStage: 'design', ready: `!!document.querySelector('.sk-header-tab[data-tab="design"]')` },
  { id: 'penplotter',   name: 'Pen Plotter',  url: '/apps/penplotter/index.html',   stages: ['Design', 'Toolpath', 'Export'], dark: false, nextStage: 'toolpath', ready: `!!window.__sketch && !!document.querySelector('.sk-header-tab[data-tab="design"]')` },
  { id: 'trace',        name: 'Trace',        url: '/apps/trace/index.html',        stages: ['Trace', 'Edit', 'Export'], dark: true, nextStage: 'edit', ready: `!!document.querySelector('.sk-header-tab[data-tab="edit"]')` },
];

const cdp = await launchBrowser({ tag: '619', width: 1440, height: 900 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }

const { port, send, evalJs, waitFor, navigate } = cdp;
const errors = [];
cdp.ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value || a.description || '').join(' '));
});

const lum = (css) => {
  const m = css.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  return m ? (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255 : 1;
};

const clickPt = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(220);
};
const clickSel = async (sel) => {
  const pt = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: r.width, h: r.height }; })()`);
  assert(pt && pt.w > 0 && pt.h > 0, `${sel} is visible to click`);
  await clickPt(pt.x, pt.y);
};

const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: Math.round(p.x), y: Math.round(p.y), id: i, radiusX: 2, radiusY: 2, force: 1 })) });
const tapPt = async (x, y) => { await T('touchStart', [{ x, y }]); await sleep(40); await T('touchEnd', []); await sleep(280); };
const tapSel = async (sel) => {
  const pt = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: r.width, h: r.height }; })()`);
  assert(pt && pt.w > 0 && pt.h > 0, `${sel} is visible to tap`);
  await tapPt(pt.x, pt.y);
};
const dragTouch = async (x0, y0, x1, y1, steps = 10) => {
  await T('touchStart', [{ x: x0, y: y0 }]);
  await sleep(20);
  for (let i = 1; i <= steps; i++) {
    await T('touchMove', [{ x: x0 + (x1 - x0) * (i / steps), y: y0 + (y1 - y0) * (i / steps) }]);
    await sleep(16);
  }
  await T('touchEnd', []);
  await sleep(320);
};

const setViewport = async (w, h, touch) => {
  await send('Emulation.setDeviceMetricsOverride', {
    width: w, height: h, deviceScaleFactor: 1, mobile: touch,
    screenOrientation: w > h ? { type: 'landscapePrimary', angle: 90 } : { type: 'portraitPrimary', angle: 0 },
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: touch ? 5 : 0 });
  await send('Emulation.setEmitTouchEventsForMouse', { enabled: false });
};

try {
  // ═══ A. Desktop 1440x900: same header layout, order, height, spacing across all 4 hosts ═══
  await setViewport(1440, 900, false);
  const desktopHeaders = {};
  for (const app of APPS) {
    await navigate(`http://127.0.0.1:${port}${app.url}`, 15000);
    await waitFor(app.ready, `${app.name} desktop ready`, 15000);
    await sleep(300);
    const info = await evalJs(`(() => {
      const h = document.querySelector('header.sk-header');
      if (!h) return null;
      const hr = h.getBoundingClientRect();
      const children = [...h.children].map((c) => c.className);
      const btn = h.querySelector('.sk-sidebar-btn');
      const br = btn?.getBoundingClientRect();
      const tabsWrap = h.querySelector('.sk-header-tabs');
      const tabs = [...h.querySelectorAll('.sk-header-tab')].map((t) => {
        const r = t.getBoundingClientRect();
        return { label: t.textContent.trim(), tab: t.dataset.tab, h: Math.round(r.height), top: Math.round(r.top), left: Math.round(r.left) };
      });
      const cs = getComputedStyle(h);
      return {
        h: Math.round(hr.height), top: Math.round(hr.top), bg: cs.backgroundColor, overflowX: cs.overflowX,
        children, btnH: br ? Math.round(br.height) : 0, btnLeft: br ? Math.round(br.left) : -1,
        btnRight: br ? Math.round(br.right) : -1, gapAfterBtn: tabs[0] && br ? Math.round(tabs[0].left - br.right) : 0,
        tabs, extraHeaderItems: h.querySelectorAll('.sk-header-style, .sk-header-action, #btn-undo, #btn-redo, #open, #fit, #export, #btn-settings').length,
      };
    })()`);
    desktopHeaders[app.id] = info;
    assert(info, `${app.name} has header.sk-header`);
    assert.strictEqual(info.top, 0, `${app.name}: header at top === 0`);
    assert.strictEqual(info.h, 44, `${app.name}: uniform 44 px header height`);
    assert.strictEqual(info.overflowX, 'auto', `${app.name}: header supports sideways scroll`);
    assert.deepStrictEqual(info.children, ['sk-sidebar-btn', 'sk-header-tabs'], `${app.name}: header contains ONLY ☰ + stages wrapper`);
    assert.strictEqual(info.extraHeaderItems, 0, `${app.name}: no legacy actions/undo/export in header`);
    assert.strictEqual(info.btnH, 30, `${app.name}: ☰ button height 30 px`);
    assert.deepStrictEqual(info.tabs.map((t) => t.label), app.stages, `${app.name}: exact stage labels`);
    for (const t of info.tabs) assert.strictEqual(t.h, 30, `${app.name} tab ${t.label}: uniform 30 px height`);
    const isDark = lum(info.bg) < 0.35;
    assert.strictEqual(isDark, app.dark, `${app.name}: theme darkness preserved (bg=${info.bg})`);
  }
  // Identical left margin & spacing from ☰ button across all 4 hosts
  for (const app of APPS) {
    assert.strictEqual(desktopHeaders[app.id].btnLeft, desktopHeaders.sketchstudio.btnLeft, `${app.name}: same left margin as SketchStudio`);
    assert.strictEqual(desktopHeaders[app.id].gapAfterBtn, desktopHeaders.sketchstudio.gapAfterBtn, `${app.name}: same gap after ☰ as SketchStudio`);
  }
  // Narrow desktop (>= 641 px) stays single-row overflow-x:auto and scrolls sideways when constrained
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 15000);
  await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'Shaper ready for sideways scroll');
  await setViewport(650, 900, false);
  await sleep(150);
  const minDesk = await evalJs(`(() => {
    const h = document.querySelector('header.sk-header');
    const vis = getComputedStyle(h).display !== 'none';
    const overflowX = getComputedStyle(h).overflowX;
    const wrap = getComputedStyle(h.querySelector('.sk-header-tabs')).flexWrap;
    const hPx = Math.round(h.getBoundingClientRect().height);
    h.style.maxWidth = '240px';
    const sw = h.scrollWidth, cw = h.clientWidth;
    h.scrollLeft = 80;
    const sl = h.scrollLeft;
    h.style.maxWidth = '';
    return { vis, overflowX, wrap, h: hPx, sw, cw, sl };
  })()`);
  assert.strictEqual(minDesk.vis, true, '650 px desktop keeps header visible');
  assert.strictEqual(minDesk.h, 44, `650 px desktop keeps single 44 px header row: ${JSON.stringify(minDesk)}`);
  assert.strictEqual(minDesk.overflowX, 'auto', 'desktop header has overflow-x: auto');
  assert.strictEqual(minDesk.wrap, 'nowrap', 'header tabs never wrap into two rows');
  assert(minDesk.sw > minDesk.cw && minDesk.sl > 0, `desktop header scrolls sideways when overflowing: ${JSON.stringify(minDesk)}`);

  // ═══ B. ☰ menu entries & host actions by REAL click across all 4 apps ═══
  await setViewport(1440, 900, false);

  // b1. SketchStudio: Style (closes sidebar first), Log, Debug, Tune solver, Export… + footer check (no Log/Tune/MAG LENS)
  await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 15000);
  await waitFor(`!!document.getElementById('svgCanvas') && !!document.getElementById('btn-construct-toggle')`, 'SketchStudio ready');
  const ssFooter = await evalJs(`({ diag: !!document.getElementById('status-diag-slot'), tune: !!document.getElementById('btn-tuning-toggle'), mag: !!document.getElementById('btn-mag-toggle'), undo: !!document.getElementById('btn-undo'), redo: !!document.getElementById('btn-redo'), consFooter: !!document.querySelector('footer #btn-construct-toggle'), consCorner: !!document.querySelector('.sk-canvas-corner #btn-construct-toggle'), rec: !!document.getElementById('btn-recenter-view') })`);
  assert.deepStrictEqual(ssFooter, { diag: false, tune: false, mag: false, undo: true, redo: true, consFooter: false, consCorner: true, rec: true }, 'SketchStudio footer = Undo/Redo/Delete/Clear left + Recenter right; Construction in .sk-canvas-corner');

  await clickSel('.sk-sidebar-btn');
  await waitFor(`document.querySelector('.sk-sidebar')?.classList.contains('open')`, 'SketchStudio sidebar opened');
  await clickSel('.sk-sidebar-item[data-action="style"]');
  await waitFor(`!document.querySelector('.sk-style-panel').classList.contains('sk-hidden')`, 'Style panel opened');
  assert.strictEqual(await evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`), false, 'opening Style closes ☰ menu first so panel is never hidden');
  await evalJs(`document.querySelector('.sk-style-panel').classList.add('sk-hidden')`);

  await clickSel('.sk-sidebar-btn');
  await clickSel('.sk-sidebar-item[data-action="log"]');
  await waitFor(`!document.querySelector('.sk-diag-panel').classList.contains('sk-hidden')`, 'SketchStudio Log opened from ☰ menu');
  await clickSel('.sk-diag-close');

  await clickSel('.sk-sidebar-btn');
  await clickSel('.sk-sidebar-item[data-action="debug"]');
  await waitFor(`getComputedStyle(document.getElementById('debug-panel')).display !== 'none'`, 'SketchStudio Debug opened from ☰ menu');
  await clickSel('#debug-close-btn');

  await clickSel('.sk-sidebar-btn');
  await clickSel('.sk-sidebar-item[data-action="tune"]');
  await waitFor(`getComputedStyle(document.getElementById('tuning-wizard-panel')).display !== 'none'`, 'SketchStudio Tune solver opened from ☰ menu');
  await clickSel('#tuning-close-btn');

  await clickSel('.sk-sidebar-btn');
  await clickSel('.sk-sidebar-item[data-action="export"]');
  await waitFor(`!document.getElementById('export-panel').classList.contains('hidden')`, 'SketchStudio Export view opened from ☰ menu');

  // b2. Shaper: Explore has Open SVG / Export in menu (all sizes); off Explore they hide; Settings & Log work; Explore Recenter = fit
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 15000);
  await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'Shaper ready');
  const exploreSvg = fs.readFileSync(FIX_SVG, 'utf8');
  await evalJs(`(() => { const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(exploreSvg)}], 'test.svg', { type: 'image/svg+xml' })); const f = document.getElementById('file'); f.files = dt.files; f.dispatchEvent(new Event('change')); })()`);
  await waitFor(`!!document.querySelector('#canvas .stage svg')`, 'Explore loaded SVG');
  const fitT = await evalJs(`document.querySelector('#canvas .stage').style.transform`);
  await evalJs(`document.querySelector('#canvas .stage').style.transform = 'translate(220px, 140px) scale(2.5)'`);
  await clickSel('#btn-recenter-view');
  await sleep(100);
  assert.strictEqual(await evalJs(`document.querySelector('#canvas .stage').style.transform`), fitT, 'Shaper Explore footer Recenter runs fit()');

  await clickSel('.sk-sidebar-btn');
  await waitFor(`document.querySelector('.sk-sidebar')?.classList.contains('open')`, 'Shaper sidebar opened');
  const expItems = await evalJs(`({ open: !!document.querySelector('[data-action="explore-open"]'), exp: !!document.querySelector('[data-action="explore-export"]'), settings: !!document.querySelector('[data-action="settings"]'), log: !!document.querySelector('[data-action="log"]') })`);
  assert.deepStrictEqual(expItems, { open: true, exp: true, settings: true, log: true }, 'Shaper Explore shows Open SVG, Export, Settings, Log in ☰ menu on desktop');
  await clickSel('.sk-sidebar-item[data-action="settings"]');
  await waitFor(`!document.querySelector('.sk-style-panel')?.classList.contains('sk-hidden')`, 'Shaper Settings (.sk-style-panel) opened from ☰ menu');
  assert.strictEqual(await evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`), false, 'opening Settings closes ☰ menu first so panel is never hidden');
  await evalJs(`document.querySelector('.sk-style-panel').classList.add('sk-hidden')`);

  await clickSel('.sk-sidebar-btn');
  await clickSel('.sk-sidebar-item[data-action="log"]');
  await waitFor(`!document.querySelector('.sk-diag-panel').classList.contains('sk-hidden')`, 'Shaper Log opened from ☰ menu');
  await clickSel('.sk-diag-close');

  await clickSel('.sk-header-tab[data-tab="design"]');
  await waitFor(`document.getElementById('design-canvas').getBoundingClientRect().width > 0`, 'Shaper Design opened');
  await clickSel('.sk-sidebar-btn');
  const desItems = await evalJs(`({ open: !!document.querySelector('[data-action="explore-open"]'), exp: !!document.querySelector('[data-action="explore-export"]') })`);
  assert.deepStrictEqual(desItems, { open: false, exp: false }, 'Shaper Design hides Explore-only menu entries');
  await clickPt(900, 450);

  // b3. Pen Plotter: Download + Log in menu; narrow (< 768px) Design Panel icon in .sk-canvas-corner beside Sketches
  await navigate(`http://127.0.0.1:${port}/apps/penplotter/index.html`, 15000);
  await waitFor(`!!window.__sketch && !!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'Pen Plotter ready');
  await clickSel('.sk-sidebar-btn');
  await clickSel('.sk-sidebar-item[data-action="log"]');
  await waitFor(`!document.querySelector('.sk-diag-panel').classList.contains('sk-hidden')`, 'Pen Plotter Log opened from ☰ menu');
  await clickSel('.sk-diag-close');
  await clickSel('.sk-header-tab[data-tab="design"]');
  await waitFor(`!!document.querySelector('#design-canvas-wrap .sk-canvas-corner')`, 'Pen Plotter Design stage mounted');

  await setViewport(600, 800, false);
  await sleep(200);
  const corner = await evalJs(`(() => {
    const p = document.querySelector('#design-canvas-wrap .sk-canvas-corner .sk-drawer-toggle-icon[aria-label="Panel"]');
    const l = document.querySelector('#design-canvas-wrap .sk-canvas-corner .sk-browser-corner-btn[aria-label="Sketches"]');
    if (!p || !l) return null;
    const pr = p.getBoundingClientRect(), lr = l.getBoundingClientRect();
    return { pVis: getComputedStyle(p).display !== 'none', lVis: getComputedStyle(l).display !== 'none', gap: Math.round(pr.left - lr.right) };
  })()`);
  assert(corner && corner.pVis && corner.lVis, `Pen Plotter Design < 768 px shows Panel beside Sketches in .sk-canvas-corner: ${JSON.stringify(corner)}`);
  await clickSel('#design-canvas-wrap .sk-canvas-corner .sk-drawer-toggle-icon[aria-label="Panel"]');
  await waitFor(`document.querySelector('#stage-design .sk-drawer-open') !== null`, 'Pen Plotter Panel icon opens drawer');

  // b4. Trace: Download SVG, Download DXF, Log in menu
  await setViewport(1440, 900, false);
  await navigate(`http://127.0.0.1:${port}/apps/trace/index.html`, 15000);
  await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="edit"]')`, 'Trace ready');
  await clickSel('.sk-sidebar-btn');
  assert.deepStrictEqual(
    await evalJs(`['download-svg', 'download-dxf', 'log'].every((a) => !!document.querySelector('.sk-sidebar-item[data-action="' + a + '"]'))`),
    true,
    'Trace ☰ menu lists Download SVG, Download DXF, and Log',
  );
  await clickSel('.sk-sidebar-item[data-action="log"]');
  await waitFor(`!document.querySelector('.sk-diag-panel').classList.contains('sk-hidden')`, 'Trace Log opened from ☰ menu');
  await clickSel('.sk-diag-close');

  // ═══ C & D. Phone portrait (390x844, 360x780) & short landscape (844x390, 780x360, touch) across all 4 apps ═══
  const PHONE_SIZES = [
    { name: 'portrait-390x844',  w: 390, h: 844 },
    { name: 'portrait-360x780',  w: 360, h: 780 },
    { name: 'landscape-844x390', w: 844, h: 390 },
    { name: 'landscape-780x360', w: 780, h: 360 },
  ];
  for (const vp of PHONE_SIZES) {
    await setViewport(vp.w, vp.h, true);
    for (const app of APPS) {
      await navigate(`http://127.0.0.1:${port}${app.url}`, 15000);
      await waitFor(`!!document.querySelector('.sk-sidebar-handle') && !!document.querySelector('.sk-doctabs')`, `${app.name} ${vp.name} ready`, 15000);
      await sleep(250);
      const st = await evalJs(`(() => {
        const hdr = document.querySelector('header.sk-header');
        const hcs = getComputedStyle(hdr);
        const tabs = document.querySelector('.sk-doctabs').getBoundingClientRect();
        const hdl = document.querySelector('.sk-sidebar-handle');
        const hr = hdl.getBoundingClientRect();
        const hit = document.elementFromPoint(hr.left + hr.width / 2, hr.top + hr.height / 2);
        return {
          hdrDisp: hcs.display, hdrVar: getComputedStyle(document.documentElement).getPropertyValue('--sk-header-h').trim(),
          tabsTop: Math.round(tabs.top),
          hdlLeft: Math.round(hr.left), hdlW: Math.round(hr.width), hdlH: Math.round(hr.height),
          hdlFree: !!hit && (hit === hdl || hdl.contains(hit)),
        };
      })()`);
      assert.strictEqual(st.hdrDisp, 'none', `${app.name} ${vp.name}: header bar hidden`);
      assert.strictEqual(st.hdrVar, '0px', `${app.name} ${vp.name}: --sk-header-h === 0px`);
      assert.strictEqual(st.tabsTop, 0, `${app.name} ${vp.name}: .sk-doctabs is top row (top=0)`);
      assert(st.hdlLeft <= 1 && st.hdlW >= 14 && st.hdlH >= 44 && st.hdlFree, `${app.name} ${vp.name}: peeking handle valid & unobstructed: ${JSON.stringify(st)}`);

      // Tap handle -> sidebar opens; stage buttons are at the top of the sidebar (>= 44 px tall)
      await tapSel('.sk-sidebar-handle');
      await waitFor(`document.querySelector('.sk-sidebar')?.classList.contains('open')`, `${app.name} ${vp.name}: tap handle opens sidebar`);
      const stages = await evalJs(`[...document.querySelectorAll('.sk-sidebar-stage')].map((b) => { const r = b.getBoundingClientRect(); return { label: b.textContent.trim(), tab: b.dataset.tab, h: Math.round(r.height), top: Math.round(r.top) }; })`);
      assert.deepStrictEqual(stages.map((s) => s.label), app.stages, `${app.name} ${vp.name}: sidebar has all stage buttons`);
      assert(stages[0].h >= 44 && stages[0].top >= 0 && stages[0].top < 30, `${app.name} ${vp.name}: sidebar stage buttons sit at top >= 44 px (${JSON.stringify(stages[0])})`);

      // Tap outside on backdrop closes sidebar
      await tapPt(vp.w - 20, Math.round(vp.h / 2));
      await waitFor(`!document.querySelector('.sk-sidebar')?.classList.contains('open')`, `${app.name} ${vp.name}: tap backdrop closes sidebar`);

      // Real touch drag right from peeking handle opens sidebar; drag handle back left closes sidebar
      const hy = await evalJs(`(() => { const r = document.querySelector('.sk-sidebar-handle').getBoundingClientRect(); return Math.round(r.top + r.height / 2); })()`);
      await dragTouch(8, hy, 190, hy);
      assert.strictEqual(await evalJs(`document.querySelector('.sk-sidebar')?.classList.contains('open')`), true, `${app.name} ${vp.name}: drag right opens sidebar`);
      const hOpen = await evalJs(`(() => { const r = document.querySelector('.sk-sidebar-handle').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
      await dragTouch(hOpen.x, hOpen.y, 20, hOpen.y);
      assert.strictEqual(await evalJs(`document.querySelector('.sk-sidebar')?.classList.contains('open')`), false, `${app.name} ${vp.name}: drag left closes sidebar`);

      // Re-open via handle and switch stage on multi-stage apps
      if (app.id !== 'sketchstudio') {
        await tapSel('.sk-sidebar-handle');
        await waitFor(`document.querySelector('.sk-sidebar')?.classList.contains('open')`, `${app.name} ${vp.name}: re-open sidebar`);
        await tapSel(`.sk-sidebar-stage[data-tab="${app.nextStage}"]`);
        await waitFor(`!document.querySelector('.sk-sidebar')?.classList.contains('open')`, `${app.name} ${vp.name}: tapping stage closes sidebar`);
        assert.strictEqual(await evalJs(`document.querySelector('.sk-sidebar-stage[data-tab="${app.nextStage}"]')?.classList.contains('active')`), true, `${app.name} ${vp.name}: switched to ${app.nextStage}`);
      }
    }
  }

  assert.deepStrictEqual(errors, [], 'no uncaught page/console errors: ' + JSON.stringify(errors));
  console.log('shared-header-live: ok (all 4 apps x desktop + 4 phone viewports verified)');
} finally {
  await cdp.close();
}
process.exit(0);
