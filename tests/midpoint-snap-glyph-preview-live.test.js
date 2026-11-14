// tests/midpoint-snap-glyph-preview-live.test.js -- TASK 631 in the REAL SketchStudio (headless, REAL mouse via CDP Input.dispatchMouseEvent):
// the line tool's end and a select-tool drag of a free line end hover a line's MIDPOINT: the midpoint glyph is drawn as a preview (opacity 0.8)
// at the snap; moving away removes it; release adds the MIDPOINT constraint. A cropped screenshot of the preview goes to
// test-results/midpoint-snap-glyph-preview-<tool>.png. (The same cases without a browser: midpoint-snap-glyph-preview-node.test.js.)
import assert from 'node:assert';
import fs from 'node:fs';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';

await (async () => {
  const cdp = await launchBrowser({ tag: '631live' });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;
  try {
    const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const click = async (x, y) => { await mouse('mouseMoved', x, y, 0); await sleep(40); await mouse('mousePressed', x, y, 1); await sleep(40); await mouse('mouseReleased', x, y, 0); await sleep(200); };
    const esc = async () => { await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(150); };
    const tool = (t) => evalJs(`document.getElementById('tool-${t}').click()`).then(() => sleep(150));
    const previews = () => evalJs(`JSON.stringify([...document.querySelectorAll('#svgCanvas g.constraint-glyph')].filter(g => /opacity:\\s*0\\.8/.test(g.getAttribute('style') || '')).map(g => { const r = g.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }))`).then(JSON.parse);
    const midpoints = () => evalJs(`document.querySelectorAll('#svgCanvas g.constraint-glyph[data-ctype=\"midpoint\"]').length`);
    const shot = async (name, at) => {
      const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { x: at.x - 90, y: at.y - 80, width: 180, height: 160, scale: 3 } });
      fs.mkdirSync('test-results', { recursive: true });
      fs.writeFileSync(`test-results/midpoint-snap-glyph-preview-${name}.png`, Buffer.from(data, 'base64'));
    };

    const url = `http://127.0.0.1:${port}/apps/sketchstudio/index.html`;
    await navigate(url, 8000);
    await evalJs(`(async () => { localStorage.clear(); const dbs = indexedDB.databases ? await indexedDB.databases() : []; await Promise.all(dbs.map(d => new Promise(r => { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = () => r(); }))); localStorage.setItem('sketch-studio-settings', JSON.stringify({ AXIS_SNAP: false, GRID_MAGNETISM: 0.001 })); return true; })()`);
    await navigate(url, 8000);
    await waitFor(`(() => { const c = document.querySelector('#svgCanvas'); return !!c && c.getBoundingClientRect().width > 0 && c.dataset.docReady === '1' && !!document.getElementById('tool-select'); })()`, 'SketchStudio ready');
    await sleep(600);
    const c = await evalJs(`(() => { const r = document.querySelector('#svgCanvas').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    const mid = { x: c.x, y: c.y - 200 };

    await tool('line'); await click(c.x - 120, c.y - 200); await click(c.x + 120, c.y - 200); await esc();
    assert.equal((await previews()).length, 0, 'no preview without a snap');

    // line tool
    await tool('line'); await click(c.x - 60, c.y - 60);
    await mouse('mouseMoved', mid.x + 40, mid.y + 40, 0); await sleep(60); await mouse('mouseMoved', mid.x + 1, mid.y + 1, 0); await sleep(250);
    let p = await previews();
    assert.equal(p.length, 1, 'line tool: one midpoint glyph preview at the snap');
    assert.ok(Math.hypot(p[0].x - mid.x, p[0].y - mid.y) < 50, `line tool: the glyph sits at the snap (${p[0].x.toFixed(0)},${p[0].y.toFixed(0)} vs ${mid.x},${mid.y})`);
    await shot('line-tool', mid);
    await mouse('mouseMoved', mid.x + 120, mid.y + 120, 0); await sleep(250);
    assert.equal((await previews()).length, 0, 'line tool: moving away removes the preview');
    await esc(); await esc();

    // drag a free line end
    await tool('line'); await click(c.x - 100, c.y + 100); await click(c.x + 100, c.y + 100); await esc();
    await tool('select');
    const end = { x: c.x + 100, y: c.y + 100 };
    const walk = async (from, to, n = 10) => { for (let i = 1; i <= n; i++) { await mouse('mouseMoved', from.x + (to.x - from.x) * i / n, from.y + (to.y - from.y) * i / n, 1); await sleep(16); } };
    await mouse('mouseMoved', end.x, end.y, 0); await sleep(40); await mouse('mousePressed', end.x, end.y, 1); await sleep(60);
    const near = { x: mid.x + 2, y: mid.y + 3 };
    await walk(end, { x: mid.x + 30, y: mid.y + 50 }); await walk({ x: mid.x + 30, y: mid.y + 50 }, near, 6); await sleep(250);
    p = await previews();
    assert.equal(p.length, 1, 'drag: one midpoint glyph preview while the end sits on the midpoint');
    assert.ok(Math.hypot(p[0].x - mid.x, p[0].y - mid.y) < 50, 'drag: the glyph sits at the snap');
    await shot('drag', mid);
    await walk(near, { x: mid.x + 150, y: mid.y + 150 }); await sleep(250);
    assert.equal((await previews()).length, 0, 'drag: moving away removes the preview');
    await walk({ x: mid.x + 150, y: mid.y + 150 }, near); await sleep(250);
    assert.equal((await previews()).length, 1, 'drag: back on the midpoint, the preview returns');
    await mouse('mouseReleased', near.x, near.y, 0); await sleep(300);
    assert.equal((await previews()).length, 0, 'released: no preview glyph left');
    assert.equal(await midpoints(), 1, 'release adds the MIDPOINT constraint (a real midpoint glyph)');
    console.log('midpoint-snap-glyph-preview-live.test.js: ok');
  } finally { await cdp.close(); }
})();
