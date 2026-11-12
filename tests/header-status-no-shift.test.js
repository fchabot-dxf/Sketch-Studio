// tests/header-status-no-shift.test.js -- TASK 522: the autosave status text ("", "Saving…", "Saved") must never move the stage tabs
// (a tab that jumps sideways between the mouse move and the press makes the click land beside it). Pen Plotter and Shaper each own an
// #save-status before #mode-nav; the left edge of EVERY tab must be identical for all three texts. (The text is set on the element the
// app's onStatusChange closure writes: that closure is not exported.)
import assert from 'node:assert';
import { launchBrowser } from './helpers/cdp-browser.js';

await (async () => {
  const cdp = await launchBrowser({ tag: '522s' });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { evalJs, waitFor, navigate, port } = cdp;
  try {
    for (const app of ['penplotter', 'shaper']) {
      await navigate(`http://127.0.0.1:${port}/apps/${app}/index.html`, 8000);
      await waitFor(`!!document.querySelector('#save-status') && document.querySelectorAll('#mode-nav button').length > 1`, app + ' header ready');
      const lefts = await evalJs(`(() => { const s = document.getElementById('save-status'); const o = {};
        for (const t of ['', 'Saving…', 'Saved']) { s.textContent = t; o[t || 'empty'] = [...document.querySelectorAll('#mode-nav button')].map((b) => b.getBoundingClientRect().left); } return o; })()`);
      assert.deepStrictEqual(lefts['Saving…'], lefts.empty, `${app}: "Saving…" moves the tabs`);
      assert.deepStrictEqual(lefts.Saved, lefts.empty, `${app}: "Saved" moves the tabs`);
      console.log(app, 'tab lefts identical for all status texts:', lefts.empty.map(Math.round).join(','));
    }
    console.log('header-status-no-shift: ok');
  } finally {
    await cdp.close();
  }
})();
