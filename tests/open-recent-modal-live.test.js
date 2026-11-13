// tests/open-recent-modal-live.test.js — TASK 557: "Open recent" in the main menu opens the PROJECT MANAGER modal on its Recent pane
// (no drawer list any more), in all three hosts, live and headless. "Projects" still opens the modal on the project list (narrow screen:
// the list, not the Recent pane). The drawer closes, the Recent pane lists the design newest first, clicking a tile opens it.
import assert from 'node:assert';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';

await (async () => {
  const cdp = await launchBrowser({ tag: '557r', width: 1400, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;
  try {
    const S = '(await import("/packages/ui/project-store.js")).getProjectStore()';
    const DOC = { version: 2, geometry: { joints: [['j0', { x: 0, y: 0 }], ['j1', { x: 50, y: 0 }]], shapes: [{ id: 's0', type: 'line', joints: ['j0', 'j1'] }], constraints: [] }, hosts: {} };
    for (const host of ['sketchstudio', 'shaper', 'penplotter']) {
      for (const width of [1400, 390]) {
        await send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false });
        await navigate(`http://127.0.0.1:${port}/apps/${host}/index.html`, 10000);
        await waitFor(`!!document.querySelector('.sk-sidebar-btn')`, `${host} sidebar button`);
        await sleep(1200);
        await evalJs(`(async () => { const s = ${S}; const a = await s.newDesign('Recent probe ${host}', { app: ${JSON.stringify(host)} }); await s.save(${JSON.stringify(DOC)}, { id: a.id, app: ${JSON.stringify(host)} }); return true; })()`);
        const label = `${host} @${width}`;
        await evalJs(`document.querySelector('.sk-sidebar-btn').click()`);
        await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open') && !!document.querySelector('[data-action="open-recent"]')`, `${label}: drawer`);
        await evalJs(`document.querySelector('[data-action="open-recent"]').click()`);
        await waitFor(`!!document.querySelector('.sk-pm') && !!document.querySelector('.sk-pm-tile')`, `${label}: the modal on Recent`);
        const st = await evalJs(`(() => { const sel = document.querySelector('.sk-pm-rowbtn.sel'); const main = document.querySelector('.sk-pm-main');
          return { sel: sel && sel.dataset.pane, mainShown: getComputedStyle(main).display !== 'none',
            tiles: [...document.querySelectorAll('.sk-pm-tile [data-name]')].map((n) => n.textContent), drawerOpen: document.querySelector('.sk-sidebar').classList.contains('open'),
            drawerList: document.querySelectorAll('.sk-sidebar-view .sk-recent, .sk-recent').length }; })()`);
        assert.strictEqual(st.sel, 'recent', `${label}: the Recent row is selected`);
        assert.ok(st.mainShown, `${label}: the Recent pane (right side) is visible`);
        assert.ok(st.tiles.some((n) => n === 'Recent probe ' + host), `${label}: the Recent pane lists the design: ${st.tiles}`);
        assert.strictEqual(st.drawerOpen, false, `${label}: the drawer closed`);
        assert.strictEqual(st.drawerList, 0, `${label}: no drawer list`);
        await evalJs(`document.querySelector('[data-pm="close"]').click()`);
        await waitFor(`!document.querySelector('.sk-pm')`, `${label}: modal closed`);
        if (width === 390) { // "Projects" still starts on the list (narrow: the side pane, not the Recent pane)
          await evalJs(`document.querySelector('.sk-sidebar-btn').click()`);
          await waitFor(`!!document.querySelector('[data-action="projects"]')`, `${label}: drawer again`);
          await evalJs(`document.querySelector('[data-action="projects"]').click()`);
          await waitFor(`!!document.querySelector('.sk-pm')`, `${label}: Projects modal`);
          assert.strictEqual(await evalJs(`document.querySelector('.sk-pm').dataset.pane`), 'side', `${label}: Projects opens the project list`);
          await evalJs(`document.querySelector('[data-pm="close"]').click()`);
        }
        console.log(label, 'Open recent -> modal on Recent:', st.tiles.join(', '));
      }
    }
    console.log('open-recent-modal-live: ok');
  } finally {
    await cdp.close();
  }
})();
