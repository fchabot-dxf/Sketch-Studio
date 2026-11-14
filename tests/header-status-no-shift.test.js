// tests/header-status-no-shift.test.js -- TASKS 522 + 557, reworked by TASKS 602 + 605: NO app has an autosave status text in its header any more. The save state is the
// document tab's dot (document-tabs.js: unsaved / saving / failed) and the canvas's data-save-state (document-buffer.js); a failed save also shows in the menu's status
// line ("Not saved to Google Drive..."). So nothing in a header can move when the state changes, which is what the old text had to be measured for (a control that jumps
// sideways between the mouse move and the press makes the click land beside it).
//  - Pen Plotter, Shaper, Trace (TASK 605): no #save-status / #tr-status; the header's mode buttons keep their x / width / height when the tab strip is hidden and shown
//    (the strip is its own row below the header); the strip is the next sibling of the header.
//  - SketchStudio (TASK 602): the header's controls are the menu button, Design, Style and Debug; Design is the one mode button (Export is in the menu); the static
//    "X: 0 Y: 0" pointer readout (#coords-text) is gone.
import assert from 'node:assert';
import { launchBrowser } from './helpers/cdp-browser.js';

await (async () => {
  const cdp = await launchBrowser({ tag: '522s' });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { evalJs, waitFor, navigate, port } = cdp;
  const headerRects = () => evalJs(`[...document.querySelector('header').querySelectorAll('button, select, input')].map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; })`);
  try {
    for (const [app, tabs] of [['penplotter', '#mode-nav button'], ['shaper', '#mode-nav button'], ['trace', '.tr-tab']]) {
      await navigate(`http://127.0.0.1:${port}/apps/${app}/index.html`, 8000);
      await waitFor(`!!document.querySelector('.sk-doctabs') && document.querySelectorAll(${JSON.stringify(tabs)}).length > 1`, app + ' header + strip ready');
      assert.strictEqual(await evalJs(`document.getElementById('save-status') || document.getElementById('tr-status')`), null, app + ': no header status text (TASK 605: the tab dot shows the save state)');
      assert.strictEqual(await evalJs(`document.querySelector('.sk-doctabs').previousElementSibling === document.querySelector('header')`), true, app + ': the strip is the next sibling of the header');
      const withStrip = await headerRects();
      await evalJs(`document.querySelector('.sk-doctabs').hidden = true`); await new Promise((r) => setTimeout(r, 100));
      const without = await headerRects();
      await evalJs(`document.querySelector('.sk-doctabs').hidden = false`);
      assert.deepStrictEqual(withStrip, without, app + ': every header control keeps its x, y, width and height with or without the strip');
      console.log(app, 'no status text; header controls fixed:', withStrip.length, 'controls');
    }

    await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 10000);
    // the header is built synchronously by main.js (no autosave restore to wait for: SketchStudio has no status text, TASK 602)
    await waitFor(`document.querySelectorAll('header .sk-header-action, header .sk-header-style').length >= 2 && !!document.querySelector('header .sk-header-tab')`, 'sketchstudio header ready', 40000);
    assert.strictEqual(await evalJs(`document.getElementById('save-status')`), null, 'sketchstudio: no "Saved" text in the header (TASK 602)');
    assert.deepStrictEqual(await evalJs(`[...document.querySelectorAll('header .sk-header-tab')].map((t) => t.dataset.tab)`), ['design'], 'sketchstudio: Design is the one mode button (Export is in the menu, TASK 602)');
    assert.strictEqual(await evalJs(`document.getElementById('coords-text')`), null, 'sketchstudio: the dead "X: 0 Y: 0" readout is gone');
    assert.ok(!(await evalJs(`document.querySelector('footer').textContent`)).includes('X: 0'), 'sketchstudio: no "X: 0 Y: 0" text in the status bar');
    assert.ok(!(await evalJs(`!!document.getElementById('viewport-size')`)), 'sketchstudio: the VIEW readout is gone (TASK 618)');
    assert.ok(!(await evalJs(`document.querySelector('footer').textContent`)).includes('VIEW'), 'sketchstudio: no VIEW text in the footer (TASK 618)');
    console.log('sketchstudio: no status text, one mode button (Design); X/Y and VIEW readouts removed');
    console.log('header-status-no-shift: ok');
  } finally {
    await cdp.close();
  }
})();
