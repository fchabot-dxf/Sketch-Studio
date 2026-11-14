// tests/document-restore-gate.test.js — TASK 542: a stored design that is restored AFTER the user already started working must not
// throw their work away. The shared document buffer ignores pointer / keyboard input on the Design canvas until the initial restore has
// settled and marks the canvas data-doc-ready="1" when it has. Real Pen Plotter in headless Edge; the restore is held back by wrapping
// the shared store's loadCurrent in a copy of the app's own index.html served as a fixture (no app code is touched).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from './helpers/cdp-browser.js';
import { CREATE_NAMED_DESIGN } from './helpers/named-design.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAIN_TAG = '<script type="module" src="./src/main.js"></script>';
const html = fs.readFileSync(path.join(REPO_ROOT, 'apps/penplotter/index.html'), 'utf8');
assert(html.includes(MAIN_TAG), 'the Pen Plotter index.html must load ./src/main.js with the expected tag');
// Same page, but the store's first loadCurrent waits until the test calls window.releaseRestore().
const slowHtml = html.replace(MAIN_TAG, `<script type="module">
  import { getProjectStore } from '#ui/project-store.js';
  const store = getProjectStore();
  const real = store.loadCurrent.bind(store);
  let release; const gate = new Promise((r) => { release = r; });
  window.releaseRestore = () => release();
  store.loadCurrent = async (...a) => { await gate; return real(...a); };
  await import('./src/main.js');
</script>`);

await (async () => {
  const cdp = await launchBrowser({ tag: '542', width: 1200, height: 800, fixtures: { '/apps/penplotter/slow.html': slowHtml } });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;
  await installFakeDriveSession(cdp);
  const savedDoc = `(async () => { const { getProjectStore } = await import('/packages/ui/project-store.js'); const s = getProjectStore(); await s.flushDrive(); const c = await s.current(); if (!c) return null; const d = await s.get(c.id); return d ? d.document : null; })()`;
  const enterDesign = async () => {
    await waitFor(`[...document.querySelectorAll('.sk-header-tab')].some(x => /design/i.test(x.textContent)) && !!window.__sketch`, 'Pen Plotter to load');
    await evalJs(`[...document.querySelectorAll('.sk-header-tab')].find(x => /design/i.test(x.textContent)).click()`);
    await waitFor(`document.getElementById('design-canvas').getBoundingClientRect().width > 0`, 'the Design canvas to show');
  };

  try {
    // 1. Store a design (a 50 mm line with a distance dimension) through the real autosave.
    await navigate(`http://127.0.0.1:${port}/apps/penplotter/index.html`, 8000);
    await enterDesign();
    await waitFor(`document.getElementById('design-canvas').dataset.docReady === '1'`, 'the first page to finish its restore');
    await evalJs(CREATE_NAMED_DESIGN('penplotter', 'Gate test')); // TASK 558: only a NAMED design autosaves; the reload restores it
    await navigate(`http://127.0.0.1:${port}/apps/penplotter/index.html`, 8000);
    await enterDesign();
    await waitFor(`document.getElementById('design-canvas').dataset.docReady === '1'`, 'the named design to be restored');
    await evalJs(`(() => {
      const { state, engine } = window.__sketch.controller;
      state.joints.set('j_a', { x: -25, y: 0, fixed: true }); state.joints.set('j_b', { x: 25, y: 0, fixed: false });
      state.shapes.push({ id: 's_1', type: 'line', joints: ['j_a', 'j_b'] });
      state.constraints.push({ id: 'c_1', type: 'distance', joints: ['j_a', 'j_b'], value: 50, offset: -15, glyphPos: { x: 0, y: -15 } });
      engine.solve(500);
    })()`);
    await waitFor(`${savedDoc}.then((d) => !!d && d.geometry.shapes.length === 1 && d.geometry.constraints.length === 1)`, 'the autosave to store the design');

    // 2. Reload with the restore held back: the canvas must say it is not ready and swallow input.
    await navigate(`http://127.0.0.1:${port}/apps/penplotter/slow.html`, 8000);
    await enterDesign();
    assert.strictEqual(await evalJs(`document.getElementById('design-canvas').dataset.docReady`), '0', 'the canvas is not ready while the restore is held back');
    await evalJs(`(() => { window.__pointerSeen = 0; document.getElementById('design-canvas').addEventListener('pointerdown', () => { window.__pointerSeen++; }); })()`);
    const centre = await evalJs(`(() => { const r = document.getElementById('design-canvas').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    const click = async () => {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: centre.x, y: centre.y, button: 'left', buttons: 1, clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: centre.x, y: centre.y, button: 'left', buttons: 0, clickCount: 1 });
    };
    await click();
    assert.strictEqual(await evalJs(`window.__pointerSeen`), 0, 'a real press on the canvas is ignored before the restore has landed');
    assert.strictEqual(await evalJs(`window.__sketch.controller.state.shapes.length`), 0, 'the state is still the empty boot sketch (nothing restored yet)');

    // 3. Let the restore land: the stored design replaces the empty sketch, THEN input opens.
    await evalJs(`window.releaseRestore()`);
    await waitFor(`document.getElementById('design-canvas').dataset.docReady === '1'`, 'the canvas to become ready after the restore');
    assert.strictEqual(await evalJs(`window.__sketch.controller.state.constraints.length`), 1, 'the stored design is restored by the time the canvas is ready');
    await click();
    assert.strictEqual(await evalJs(`window.__pointerSeen`), 1, 'a real press reaches the canvas once it is ready');

    // 4. A dimension edit started now lands on the LIVE constraint (not on an object a restore is about to replace).
    await evalJs(`(async () => {
      const { showEditInput } = await import('#ui/numeric-input-manager.js');
      const { state } = window.__sketch.controller;
      showEditInput(document.getElementById('design-canvas'), state, state.constraints[0]);
    })()`);
    await waitFor(`document.activeElement && document.activeElement.id === 'dimInput'`, 'the dimension box to take focus');
    await evalJs(`(() => { const i = document.getElementById('dimInput'); i.value = '80'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
    await waitFor(`window.__sketch.controller.state.constraints[0].value === 80`, 'the live constraint to take the typed 80');
    console.log('document-restore-gate passed: input ignored until the restore landed, the edit then hit the live constraint ✅');
  } finally {
    await cdp.close();
  }
})();
