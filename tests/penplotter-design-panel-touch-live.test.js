// tests/penplotter-design-panel-touch-live.test.js — TASK 608 A: Pen Plotter's OWN Design panel (#design-panel: the collapse toggle, the Document button,
// the colour / number inputs, the checkboxes) is a finger target under a coarse pointer: every visible control >= 44 px at 390x844 (the panel is the
// slide-over drawer there: opened with its toggle) and at 780x360 (phone landscape), and the controls reach the screen by scrolling the panel.
// At desktop (a mouse) nothing changes: the exact sizes the panel had before (28 / 24 / 13 / 25 ...).
import assert from 'node:assert';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';

const cdp = await launchBrowser({ tag: '608a', width: 1400, height: 900 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, navigate } = cdp;
try {
  const sizes = () => evalJs(`(() => { const o = {}; for (const e of document.querySelectorAll('#design-panel button, #design-panel input')) {
    const r = e.getBoundingClientRect(); if (!r.width || !r.height) continue; o[e.id || e.className] = [Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10]; } return o; })()`);
  const enterDesign = async () => { await sleep(800); await evalJs(`document.querySelector('.sk-header-tab[data-tab="design"]').click()`); await sleep(800); };
  const phone = async (w, h, landscape) => {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true, screenOrientation: landscape ? { type: 'landscapePrimary', angle: 90 } : { type: 'portraitPrimary', angle: 0 } });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  };

  // desktop: unchanged sizes (a mouse)
  await navigate(`http://127.0.0.1:${port}/apps/penplotter/index.html`, 8000);
  await enterDesign();
  const desk = await sizes();
  const heights = Object.fromEntries(Object.entries(desk).map(([k, v]) => [k, Math.round(v[1])]));
  assert.deepStrictEqual(heights, { 'design-panel-toggle': 25, designDocBtn: 28, strokeColor: 24, strokeWidth: 22, fillColor: 24, fillNone: 13, shapeMix: 13 }, 'desktop heights are the old ones: ' + JSON.stringify(desk));
  assert.deepStrictEqual([desk.strokeColor[0], desk.fillNone[0]], [46, 13], 'desktop widths unchanged');

  for (const [w, h, landscape] of [[390, 844, false], [780, 360, true]]) {
    await phone(w, h, landscape);
    await navigate(`http://127.0.0.1:${port}/apps/penplotter/index.html`, 8000);
    await enterDesign();
    if (!landscape) { await evalJs(`document.querySelector('.sk-drawer-toggle[aria-label="Panel"]').click()`); await sleep(500); }
    const s = await sizes();
    assert(Object.keys(s).length >= 7, `${w}x${h}: the panel controls are found: ${JSON.stringify(s)}`);
    for (const [id, [cw, ch]] of Object.entries(s)) {
      assert(cw >= 43.5 && ch >= 43.5, `${w}x${h}: #${id} is a 44 px target (${cw} x ${ch})`);
    }
    // every control can be scrolled onto the screen and is then the element at its own centre
    const reach = await evalJs(`(() => { const bad = []; for (const e of document.querySelectorAll('#design-panel-actions button, #design-panel-actions input')) {
      e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!(hit === e || e.contains(hit)) || r.bottom > innerHeight + 0.5 || r.right > innerWidth + 0.5) bad.push(e.id); } return bad; })()`);
    assert.deepStrictEqual(reach, [], `${w}x${h}: every panel control scrolls into view and is not covered`);
    console.log(`  ${w}x${h}: ${Object.keys(s).length} controls, smallest ${Math.min(...Object.values(s).flat())} px`);
  }
  console.log('penplotter-design-panel-touch-live: ok');
} finally { await cdp.close(); }
