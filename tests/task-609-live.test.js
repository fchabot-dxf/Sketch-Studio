// tests/task-609-live.test.js — TASK 609, in the REAL pages with the real pointer.
//   A. Shaper: entering the Vcarve tab in an Untitled creates NO vcarve record: no not-saved dot, closing asks nothing; setting a Vcarve value does: the dot, and closing asks THE question.
//   B. Trace: a tab put aside keeps its photo as the compressed file (re-decoded when shown); switching back restores the photo, its mask, its trace and its scale. Prints the
//      measured numbers: a 12 MP photo's decoded size (w x h x 4), its file size, the time to decode it again.
//   C. Trace: a design that has a drawing but no photo, switched to while the Trace tab shows, opens in Edit with the toast "This design has no photo: showing its drawing in Edit".
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, sendRealKey, sleep } from './helpers/cdp-browser.js';
import { importViaMenu } from './helpers/import-via-menu.js';

const SVG = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'svg', 'import-basic.svg');

await (async () => {
  const cdp = await launchBrowser({ tag: '609', width: 1400, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;
  try {
    const url = (h) => `http://127.0.0.1:${port}/apps/${h}/index.html`;
    const mouse = async (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons: buttons || 0, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const click = async (x, y) => { await mouse('mouseMoved', x, y); await sleep(30); await mouse('mousePressed', x, y, 1); await sleep(30); await mouse('mouseReleased', x, y, 0); await sleep(250); };
    const centre = async (sel, i = 0) => {
      const c = await evalJs(`(() => { const e = document.querySelectorAll('${sel}')[${i}]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
      assert(c, sel + ' #' + i + ' not found'); return c;
    };
    const clickEl = async (sel, i = 0) => { const c = await centre(sel, i); await click(c.x, c.y); };
    const names = () => evalJs(`[...document.querySelectorAll('.sk-doctab-name')].map((e) => e.textContent)`);
    const dots = () => evalJs(`document.querySelectorAll('.sk-doctab-dot').length`);
    const newTab = async (n) => { await clickEl('.sk-doctab-new'); await waitFor(`document.querySelectorAll('.sk-doctab-name').length === ${n}`, 'tab ' + n); await sleep(400); };

    // ---- A. Shaper -----------------------------------------------------------------------------------------------------------------------
    {
      await navigate(url('shaper'), 10000);
      await waitFor(`!!document.querySelector('.sk-doctab-name')`, 'the strip');
      const mode = (m) => evalJs(`document.querySelector('[data-mode="${m}"]').click()`);
      await mode('vcarve'); await sleep(700);
      assert.strictEqual(await evalJs(`document.getElementById('vcarve-maxdepth').disabled`), false, 'the Vcarve tab is mounted');
      await mode('design'); await sleep(2200); // past the buffer's 1.5 s poll
      assert.strictEqual(await dots(), 0, 'shaper: entering and leaving Vcarve in an Untitled leaves no not-saved dot');
      await newTab(2); await mode('vcarve'); await sleep(2200);
      assert.strictEqual(await dots(), 0, 'shaper: nor in a second Untitled, with the Vcarve tab still showing');
      await mode('design'); await sleep(300);
      await clickEl('.sk-doctab-x', 1); await sleep(600);
      assert(!/This design is not saved/.test(await evalJs('document.body.innerText')), 'shaper: closing the untouched Untitled asks nothing');
      assert.deepStrictEqual(await names(), ['Untitled'], 'shaper: and it closed');
      // set a Vcarve value: the dot, and closing asks
      await mode('vcarve'); await sleep(500);
      await evalJs(`(() => { const i = document.getElementById('vcarve-maxdepth'); i.value = '4 mm'; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await waitFor(`document.querySelectorAll('.sk-doctab-dot').length === 1`, 'shaper: setting a Vcarve value marks the Untitled');
      await newTab(2); await clickEl('.sk-doctab-main', 0); await sleep(500);
      await clickEl('.sk-doctab-x', 0);
      await waitFor(`/This design is not saved/.test(document.body.innerText)`, 'shaper: closing the Untitled with a Vcarve value asks THE question');
      await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(300);
      console.log('shaper: untouched Vcarve = no dot, no question; a Vcarve value = dot + question');
    }

    // ---- Trace ---------------------------------------------------------------------------------------------------------------------------
    await navigate(url('trace'), 10000);
    await waitFor(`!!document.querySelector('.sk-doctab-name')`, 'the Trace strip');
    const tab = (t) => evalJs(`document.querySelector('.tr-tab[data-tab="${t}"]').click()`);
    const loadPhoto = async (w, h, name) => { // a noisy light photo with a black block (a JPEG, so the file is much smaller than the decode)
      await evalJs(`(async () => { const w = ${w}, h = ${h}; const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
        x.fillStyle = '#e8e8e8'; x.fillRect(0, 0, w, h); for (let i = 0; i < 4000; i++) { x.fillStyle = 'rgb(' + (200 + Math.random() * 50) + ',' + (200 + Math.random() * 50) + ',' + (200 + Math.random() * 50) + ')'; x.fillRect(Math.random() * w, Math.random() * h, 40, 40); }
        x.fillStyle = '#000'; x.fillRect(w * 0.25, h * 0.25, w * 0.5, h * 0.5);
        const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9)); const dt = new DataTransfer(); dt.items.add(new File([blob], '${name}.jpg', { type: 'image/jpeg' }));
        const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await waitFor(`document.getElementById('original-canvas').width === ${w} && !!document.querySelector('#svg-output svg') && !document.getElementById('btn-send-to-edit').disabled`, `the ${name} photo was traced`, 30000);
    };
    const overlayAlpha = () => evalJs(`(() => { const c = document.getElementById('threshold-overlay'); return c.width ? c.getContext('2d').getImageData(c.width >> 1, c.height >> 1, 1, 1).data[3] : -1; })()`);
    const state = () => evalJs(`({ w: document.getElementById('original-canvas').width, traced: !!document.querySelector('#svg-output svg'), width: document.getElementById('global-width-val').value, alpha: (() => { const c = document.getElementById('threshold-overlay'); return c.width ? c.getContext('2d').getImageData(c.width >> 1, c.height >> 1, 1, 1).data[3] : -1; })() })`);

    // ---- B. photo, mask, scale come back from the compressed file ------------------------------------------------------------------------------
    await tab('trace'); await sleep(300);
    await loadPhoto(1600, 1200, 'big');
    await waitFor(`document.getElementById('threshold-overlay').width === 1600`, 'overlay sized');
    await sleep(500);
    const alphaBlack = await overlayAlpha();
    assert(alphaBlack > 0, 'the block shows as traced black in the threshold overlay before masking: ' + alphaBlack);
    await clickEl('.tr-mask-btn[data-tool="exclude"]');
    const c = await centre('#threshold-overlay');
    await mouse('mouseMoved', c.x - 30, c.y); await mouse('mousePressed', c.x - 30, c.y, 1); await mouse('mouseMoved', c.x, c.y, 1); await mouse('mouseMoved', c.x + 30, c.y, 1); await mouse('mouseReleased', c.x + 30, c.y, 0);
    await sleep(600);
    assert.strictEqual(await overlayAlpha(), 0, 'the exclude brush clears the block centre in the overlay');
    await evalJs(`(() => { const i = document.getElementById('global-width-val'); i.value = '120'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await sleep(900);
    await newTab(2);
    assert.strictEqual((await state()).w, 0, 'trace: the new tab shows no photo');
    await loadPhoto(800, 600, 'small');
    const tabCentre = await centre('.sk-doctab-main', 0);
    const t0 = Date.now();
    await mouse('mouseMoved', tabCentre.x, tabCentre.y); await mouse('mousePressed', tabCentre.x, tabCentre.y, 1); await mouse('mouseReleased', tabCentre.x, tabCentre.y, 0);
    await waitFor(`document.getElementById('original-canvas').width === 1600 && document.getElementById('threshold-overlay').width === 1600`, 'the first tab photo is decoded again', 30000);
    const ms = Date.now() - t0;
    await sleep(400);
    const back = await state();
    assert(back.w === 1600 && back.traced && back.width === '120', "trace: the first tab's photo, trace and scale are back: " + JSON.stringify(back));
    assert.strictEqual(back.alpha, 0, 'trace: and its mask (the excluded block centre) is back');
    await clickEl('.sk-doctab-main', 1);
    await waitFor(`document.getElementById('original-canvas').width === 800`, 'the second tab photo');
    assert.strictEqual((await state()).width, '', 'trace: the second tab has its own (empty) scale');
    console.log(`trace: photo + mask + trace + scale restored from the compressed file (1600 x 1200 re-decode shown within ${ms} ms)`);

    // measured: a 12 MP photo
    const m = await evalJs(`(async () => { const { decodeImageBlob } = await import('/apps/trace/src/upload.js'); const w = 4000, h = 3000; const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
      const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#345'); g.addColorStop(0.5, '#ba9'); g.addColorStop(1, '#234'); x.fillStyle = g; x.fillRect(0, 0, w, h);
      for (let i = 0; i < 60000; i++) { x.fillStyle = 'hsl(' + (Math.random() * 360) + ',30%,' + (30 + Math.random() * 40) + '%)'; x.fillRect(Math.random() * w, Math.random() * h, 6 + Math.random() * 30, 6 + Math.random() * 30); }
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92)); const t = performance.now(); const d = await decodeImageBlob(blob); d.canvas.getContext('2d').getImageData(0, 0, 1, 1); /* forces the pixels to exist */ const ms = performance.now() - t;
      return { w: d.width, h: d.height, fileBytes: blob.size, decodedBytes: d.canvas.width * d.canvas.height * 4, decodeMs: Math.round(ms) }; })()`);
    console.log('MEASURED 12 MP photo: ' + JSON.stringify(m));
    assert(m.w === 4000 && m.decodedBytes === 48_000_000 && m.fileBytes < m.decodedBytes / 4, 'a 12 MP photo decodes to 48 MB; its file is far smaller: ' + JSON.stringify(m));
    assert(m.decodeMs < 5000, 'a re-decode of a 12 MP photo takes under 5 s: ' + m.decodeMs);

    // ---- C. a drawing with no photo, switched to while in the Trace tab ------------------------------------------------------------------------
    await newTab(3);
    await importViaMenu(cdp, SVG);
    await waitFor(`document.querySelectorAll('#design-canvas .shape-elem').length === 10`, 'the import is drawn in Edit');
    await tab('trace'); await sleep(400);
    await newTab(4);
    await tab('trace'); await sleep(300);
    assert.strictEqual(await evalJs(`document.querySelector('.tr-tab.active').dataset.tab`), 'trace', 'in the Trace tab');
    await clickEl('.sk-doctab-main', 2);
    await waitFor(`document.querySelector('.tr-tab.active').dataset.tab === 'edit'`, 'the drawing-only design opens in Edit');
    await waitFor(`/This design has no photo: showing its drawing in Edit/.test(document.body.innerText)`, 'the toast');
    assert.strictEqual(await evalJs(`document.querySelectorAll('#design-canvas .shape-elem').length`), 10, "and shows the design's drawing");
    console.log('trace: a drawing-only design switched to from the Trace tab opens in Edit with the toast');
    console.log('task-609-live: ok');
  } finally { await cdp.close(); }
})();
