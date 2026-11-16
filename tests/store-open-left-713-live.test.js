// tests/store-open-left-713-live.test.js -- TASK 713: a page LEFT while the project store's IndexedDB open is still pending (a fresh profile:
// the database is being created) must not block every later page of the origin. Chromium parks a left page frozen in the back/forward
// cache; a parked page whose open is pending never answers the upgrade, and it is not evicted, so every later open of the database waits
// forever (the merge-gate flakes "timed out waiting for the reset page ..." / "... to finish restoring its stored design (data-doc-ready)").
// Deterministic, no race: a second tab (hold.html) holds the database's creation open, so page A's open through the REAL store module
// (project-store.js createIdbAdapter) is provably still pending when A is left for page B; then the hold is released (its creation aborted)
// and B, also through the real store, must open and use the database.
import assert from 'node:assert';
import { launchBrowser } from './helpers/cdp-browser.js';

const MAP = '<script type="importmap">{"imports":{"#core/":"/packages/core/","#ui/":"/packages/ui/"}}</script>';
const FIXTURES = {
  '/blank713.html': '<!doctype html><title>blank</title>',
  // the HOLD: creates the database itself and keeps that versionchange transaction busy until told to abort it (nothing of it is kept)
  '/hold713.html': `<!doctype html><title>hold</title><script>
    const r = indexedDB.open('sketch-studio-projects', 1);
    r.onupgradeneeded = () => {
      const tx = r.transaction; const s = r.result.createObjectStore('hold713');
      const spin = () => { const g = s.get('x'); g.onsuccess = spin; g.onerror = (e) => e.preventDefault(); };
      spin();
      localStorage.setItem('hold713', 'holding');
      const t = setInterval(() => { if (localStorage.getItem('release713')) { clearInterval(t); tx.abort(); localStorage.setItem('hold713', 'released'); } }, 50);
    };
    r.onerror = (e) => e.preventDefault();
  </script>`,
  // page A: the real store's open, still pending (the hold is ahead of it) when A is left
  '/a713.html': `<!doctype html><title>a</title>${MAP}<script type="module">
    import { createIdbAdapter } from '#ui/project-store.js';
    createIdbAdapter().getMeta('probe713').then(() => { document.title = 'a-opened'; }, (e) => { document.title = 'a-error ' + e.message; });
    document.title = 'a-opening';
  </script>`,
  // page B: the real store writes and reads the database
  '/b713.html': `<!doctype html><title>b-wait</title>${MAP}<script type="module">
    import { createIdbAdapter } from '#ui/project-store.js';
    const t0 = performance.now(); const a = createIdbAdapter();
    a.setMeta('probe713', 'b').then(() => a.getMeta('probe713')).then((v) => { document.title = 'b-done ' + v + ' in ' + Math.round(performance.now() - t0) + ' ms'; }, (e) => { document.title = 'b-error ' + e.message; });
  </script>`,
};

const cdp = await launchBrowser({ tag: '713store', fixtures: FIXTURES });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, navigate, waitFor, evalJs } = cdp;
const u = (p) => `http://127.0.0.1:${port}${p}`;
let holdId = null;
try {
  await navigate(u('/blank713.html'), 8000);
  ({ targetId: holdId } = await send('Target.createTarget', { url: u('/hold713.html') }));
  await waitFor(`localStorage.getItem('hold713') === 'holding'`, 'the second tab to hold the database creation open');

  await navigate(u('/a713.html'), 8000);
  await waitFor(`document.title !== 'a'`, 'page A to start the store open');
  assert.strictEqual(await evalJs('document.title'), 'a-opening', 'A: the store open is pending behind the hold');

  await navigate(u('/b713.html'), 8000); // A is left with its open pending
  assert.strictEqual(new URL(await evalJs('location.href')).pathname, '/b713.html', 'B is the page now shown');
  await evalJs(`localStorage.setItem('release713', '1')`);
  await waitFor(`localStorage.getItem('hold713') === 'released'`, 'the hold to abort its creation');

  const title = await waitFor(`document.title !== 'b-wait' && document.title`, 'page B to open the store (A, left with its open pending, must not hold the database)', 10000);
  console.log('B:', title);
  assert.match(title, /^b-done b in \d+ ms$/, 'B opened, wrote and read the database');
  console.log('store-open-left-713-live: ok');
} finally {
  if (holdId) await send('Target.closeTarget', { targetId: holdId });
  await cdp.close();
}
