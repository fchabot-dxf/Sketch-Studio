// tests/prepare-pick-732-live.test.js — TASK 732 in REAL Shaper (desktop 1400x900, real mouse): an INCH document, the "Box frame (front
// view)" template opened from the picker (length 23.5 in, width 5.6 in, thickness 0.625 in, 4 compartments, Horizontal layout: the owner's
// 34-shape design), then Prepare:
//   - a click inside the bottom board (under the 3rd divider) highlights ONLY the bottom board: one highlight path, one subpath, its bbox
//     the board's (the owner's bug: the dividers and the left end were highlighted with it);
//   - a click inside a divider highlights only that divider; Shift+click on the right end adds it (two faces, each one subpath);
//   - a click inside the top board highlights only it.
// Screenshots to .evidence/732/.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sendRealKey, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const EVID = path.join(process.cwd(), '.evidence', '732');
const T = 15.875, L = 596.9, H = 142.24, GAP = (L - 5 * T) / 4; // the frame in mm (the document is in inches)
const r3 = (v) => Math.round(v * 1000) / 1000 + 0;

await (async () => {
  const cdp = await launchBrowser({ tag: '732', width: 1400, height: 900 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate, waitForApp } = cdp;
  const pageErrors = [];
  cdp.ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') pageErrors.push(JSON.stringify(m.params.exceptionDetails));
  });
  const click = async (x, y, modifiers = 0) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0, modifiers }); await sleep(30);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, modifiers }); await sleep(30);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1, modifiers }); await sleep(260);
  };
  const press = async (sel) => {
    const pt = await evalJs(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => !x.hidden && x.getClientRects().length > 0); if (!e) return null; e.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    assert(pt, `missing clickable ${sel}`);
    await click(pt.x, pt.y);
  };
  const setField = async (param, val) => {
    await evalJs(`(() => { const i = document.querySelector('.sk-tp-field[data-param="${param}"] input'); i.scrollIntoView({ block: 'nearest' }); i.focus(); i.select(); })()`);
    await sendRealKey(send, 'Backspace', 'Backspace', 8);
    await send('Input.insertText', { text: String(val) });
    await sleep(450);
  };
  // a click at a WORLD point of the Prepare canvas (mm)
  const clickWorld = async (wx, wy, modifiers = 0) => {
    const p = await evalJs(`(() => { const s = document.getElementById('prepare-canvas'); const p = s.createSVGPoint(); p.x = ${wx}; p.y = ${wy}; const q = p.matrixTransform(s.getScreenCTM()); return { x: Math.round(q.x), y: Math.round(q.y) }; })()`);
    await click(p.x, p.y, modifiers);
  };
  // the selected highlight: one entry per path = [subpaths, bbox]
  const selected = async () => JSON.parse(await evalJs(`JSON.stringify([...document.querySelectorAll('#prepare-select-group path')].map((p) => { const b = p.getBBox(); return [(p.getAttribute('d').match(/M/g) || []).length, [b.x, b.y, b.x + b.width, b.y + b.height]]; }))`))
    .map(([n, b]) => [n, b.map(r3)]).sort((u, v) => u[1][0] - v[1][0]);
  const shot = async (name) => {
    // the frame, cropped with a margin, at 2x (legible)
    const box = await evalJs(`(() => { const s = document.getElementById('prepare-canvas'); const m = s.getScreenCTM(); const pt = (x, y) => { const p = s.createSVGPoint(); p.x = x; p.y = y; return p.matrixTransform(m); }; const a = pt(-10, ${-H - 10}), b = pt(${L + 10}, 10); return { x: Math.max(0, a.x), y: Math.max(0, a.y), width: b.x - a.x, height: b.y - a.y }; })()`);
    const s = await send('Page.captureScreenshot', { format: 'png', clip: { ...box, scale: 2 } });
    fs.writeFileSync(path.join(EVID, name), Buffer.from(s.data, 'base64'));
  };
  try {
    fs.mkdirSync(EVID, { recursive: true });
    await resetBufferLive(cdp);
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 10000);
    await waitForApp('design-canvas');
    // the document is set to inches (the setting the Units tab writes; not persisted)
    await evalJs(`(async () => { (await import('/packages/core/settings-manager.js')).default.set('DOC_UNIT', 'in', { persist: false }); })()`);
    await press('.sk-sidebar-btn, .sk-sidebar-chevron');
    await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'sidebar');
    await press('[data-action="templates"]');
    await waitFor(`!!document.querySelector('.sk-tp-card[data-template="box-frame"]')`, 'template cards');
    await press('.sk-tp-card[data-template="box-frame"]');
    await waitFor(`!!document.querySelector('.sk-tp-start[data-template="box-frame"]')`, 'box frame start view');
    for (const [k, v] of [['length', '23.5'], ['width', '5.6'], ['thickness', '0.625'], ['compartments', '4']]) await setField(k, v);
    await press('.sk-tp-field[data-param="layout"] .sk-tp-choice button:not([hidden])'); // expand the layout picker
    await press('.sk-tp-field[data-param="layout"] button[data-value="Horizontal"]');
    await sleep(600);
    assert.strictEqual(await evalJs(`document.querySelector('.sk-tp-err').textContent`), '', 'the values build');
    await press('.sk-tp-open');
    await sleep(500);
    if (await evalJs(`[...document.querySelectorAll('.sk-tp-backdrop [role="dialog"] button')].some((b) => /Don.t save/.test(b.textContent))`)) await press('.sk-tp-backdrop [role="dialog"] button:nth-of-type(2)');
    await waitFor(`window.__designController.state.shapes.length === 34`, 'the box frame drawn (34 shapes)');

    await press('.sk-header-tab[data-tab="prepare"]');
    await waitFor(`!!document.querySelector('#prepare-canvas .sk-edge') && !!document.getElementById('prepare-canvas').getScreenCTM()`, 'Prepare drawn');
    await sleep(400);

    const bottom = [0, -T, L, 0].map(r3), top = [0, -H, L, -H + T].map(r3);
    const vertical = (k) => [k * (GAP + T), -H + T, k * (GAP + T) + T, -T].map(r3); // k = 0 left end, 1..3 dividers, 4 right end

    // the owner's click: inside the bottom board, under the 3rd divider
    await clickWorld(3 * (GAP + T) + T / 2, -T / 2);
    assert.deepStrictEqual(await selected(), [[1, bottom]], 'a click in the bottom board selects ONLY the bottom board');
    await shot('after-bottom-click.png');

    // a divider (the 2nd)
    await clickWorld(2 * (GAP + T) + T / 2, -H / 2);
    assert.deepStrictEqual(await selected(), [[1, vertical(2)]], 'a click in a divider selects only that divider');
    await shot('after-divider-click.png');

    // Shift+click the right end: added, each face its own outline
    await clickWorld(4 * (GAP + T) + T / 2, -H / 2, 8);
    assert.deepStrictEqual(await selected(), [[1, vertical(2)], [1, vertical(4)]], 'Shift+click adds the right end');
    await shot('after-shift-right-end.png');

    // the top board
    await clickWorld(L / 2, -H + T / 2);
    assert.deepStrictEqual(await selected(), [[1, top]], 'a click in the top board selects only the top board');

    assert.strictEqual(pageErrors.length, 0, 'no uncaught page errors: ' + pageErrors.join('; '));
    console.log('prepare-pick-732-live: ok');
  } catch (e) {
    console.log('FAIL', e.stack);
    process.exitCode = 1;
  } finally {
    await cdp.close();
  }
})();
