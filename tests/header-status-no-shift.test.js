// tests/header-status-no-shift.test.js -- TASKS 522 + 557: the autosave status text ("", "Saving…", "Saved") must never move anything beside it
// (a control that jumps sideways between the mouse move and the press makes the click land beside it).
//  - Pen Plotter and Shaper own an #save-status before #mode-nav: the left edge of EVERY tab is identical for all three texts, and the
//    "Saving…" text (the widest) ends left of the first tab by >= 4 px (a clean gap, not text touching the tab).
//  - SketchStudio's #save-status is the LAST child of its shared header, after the right-hand actions: those buttons (Debug, Style) keep
//    their position for all three texts, and "Saving…" fits inside the reserved box.
//  - SketchStudio's static "X: 0 Y: 0" pointer readout (#coords-text, nothing ever updated it) is gone.
// (The text is set on the element the app's onStatusChange closure writes: that closure is not exported.)
import assert from 'node:assert';
import { launchBrowser } from './helpers/cdp-browser.js';

const TEXTS = ['', 'Saving…', 'Saved'];
const MIN_GAP_PX = 4;

await (async () => {
  const cdp = await launchBrowser({ tag: '522s' });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { evalJs, waitFor, navigate, port } = cdp;
  // for each text: the left edges of the `sel` elements, the status text's right edge, the next element's left edge, and the box's fit
  const measure = (sel) => evalJs(`(() => { const s = document.getElementById('save-status'); const o = {};
    for (const t of ${JSON.stringify(TEXTS)}) { s.textContent = t; const r = document.createRange(); r.selectNodeContents(s);
      o[t || 'empty'] = { lefts: [...document.querySelectorAll(${JSON.stringify(sel)})].map((b) => b.getBoundingClientRect().left),
        textRight: t ? r.getBoundingClientRect().right : null, boxRight: s.getBoundingClientRect().right,
        nextLeft: s.nextElementSibling ? s.nextElementSibling.getBoundingClientRect().left : null }; } return o; })()`);
  try {
    for (const app of ['penplotter', 'shaper']) {
      await navigate(`http://127.0.0.1:${port}/apps/${app}/index.html`, 8000);
      await waitFor(`!!document.querySelector('#save-status') && document.querySelectorAll('#mode-nav button').length > 1`, app + ' header ready');
      const m = await measure('#mode-nav button');
      assert.deepStrictEqual(m['Saving…'].lefts, m.empty.lefts, `${app}: "Saving…" moves the tabs`);
      assert.deepStrictEqual(m.Saved.lefts, m.empty.lefts, `${app}: "Saved" moves the tabs`);
      const gap = m['Saving…'].nextLeft - m['Saving…'].textRight;
      assert.ok(gap >= MIN_GAP_PX, `${app}: "Saving…" ends ${gap.toFixed(1)} px before the first tab (need >= ${MIN_GAP_PX})`);
      console.log(app, 'tab lefts identical for all status texts:', m.empty.lefts.map(Math.round).join(','), '; gap after "Saving…":', gap.toFixed(1), 'px');
    }

    await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 10000);
    await waitFor(`!!document.querySelector('#save-status') && document.querySelectorAll('.sk-header-action, .sk-header-style').length >= 2`, 'sketchstudio header ready');
    const m = await measure('.sk-header-action, .sk-header-style, .sk-header-tab');
    assert.ok(m.empty.lefts.length >= 4, 'sketchstudio: tabs + right-hand buttons found: ' + m.empty.lefts.length);
    assert.deepStrictEqual(m['Saving…'].lefts, m.empty.lefts, 'sketchstudio: "Saving…" moves the header buttons');
    assert.deepStrictEqual(m.Saved.lefts, m.empty.lefts, 'sketchstudio: "Saved" moves the header buttons');
    assert.deepStrictEqual(m['Saving…'].boxRight, m.empty.boxRight, 'sketchstudio: the status box is the same width for every text');
    assert.ok(m['Saving…'].textRight <= m['Saving…'].boxRight + 0.01, `sketchstudio: "Saving…" overflows its box (${m['Saving…'].textRight} > ${m['Saving…'].boxRight})`);
    assert.strictEqual(await evalJs(`document.getElementById('coords-text')`), null, 'sketchstudio: the dead "X: 0 Y: 0" readout is gone');
    assert.ok(!(await evalJs(`document.querySelector('footer').textContent`)).includes('X: 0'), 'sketchstudio: no "X: 0 Y: 0" text in the status bar');
    assert.ok(await evalJs(`!!document.getElementById('viewport-size')`), 'sketchstudio: the live VIEW readout is untouched');
    console.log('sketchstudio header buttons identical for all status texts:', m.empty.lefts.map(Math.round).join(','), '; readout removed');
    console.log('header-status-no-shift: ok');
  } finally {
    await cdp.close();
  }
})();
