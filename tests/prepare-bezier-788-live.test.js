// tests/prepare-bezier-788-live.test.js — TASK 788, Shaper's Prepare in a real browser: an OPEN bezier chain gets its hover highlight, its select highlight
// and (On-line) its dashed centreline, like a line / circle / arc chain does.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { blockRemote } from './helpers/block-remote.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const EVID = process.env.EVIDENCE_DIR ? path.resolve(process.env.EVIDENCE_DIR) : path.resolve('.evidence/788');
const PREFIX = process.env.SHOT_PREFIX || 'after';
fs.mkdirSync(EVID, { recursive: true });

const cdp = await launchBrowser({ tag: '788-bezier', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, navigate, waitForApp } = cdp;
const LOCAL = `http://127.0.0.1:${port}/`;
const net = await blockRemote(cdp);
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(EVID, `${PREFIX}-${name}`), Buffer.from(s.data, 'base64'));
};
const html = (id) => evalJs(`document.getElementById(${JSON.stringify(id)}).innerHTML`);

try {
  await navigate(`${LOCAL}apps/shaper/index.html`, 12000);
  await waitForApp('design-canvas');
  await resetBufferLive(cdp);
  await navigate(`${LOCAL}apps/shaper/index.html`, 12000);
  await waitForApp('design-canvas');
  await waitFor(`!!(window.__designController && window.__designController.state)`, 'design ready');
  await evalJs(`(async () => {
    const st = window.__designController.state;
    st.joints.set('bj0', { x: 0, y: 50 }); st.joints.set('bj1', { x: 100, y: 50 });
    st.shapes.push({ id: 'bs0', type: 'bezier', joints: ['bj0', 'bj1'], c1: [30, 0], c2: [70, 0] });
    st.saveState('draw');
    const lf = await import('/packages/core/loop-finder.js'); const cp = await import('/tests/helpers/plan-v2.js');
    cp.V2_PLAN.set('chain:' + lf.findOpenChains(st)[0].id, { cutType: 'guide', cutDepth: 'unset', cutOffset: 0, toolDia: 3.175 });
  })()`);
  await evalJs(`document.querySelector('.sk-header-tab[data-tab="prepare"]').click()`);
  await waitFor(`!document.getElementById('view-prepare').hidden && !!window.__prepareView`, 'Prepare mounted');
  await sleep(300);

  // hover: the mouse on the curve's middle (a point of the drawn bezier edge, in screen px)
  const pt = await evalJs(`(() => { const e = document.querySelector('#prepare-world-group path[data-shape-id="bs0"]'); const p = e.getPointAtLength(e.getTotalLength() / 2); const m = e.getScreenCTM(); return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y, button: 'none' });
  await sleep(250);
  const hover = await html('prepare-hover-group');
  console.log('hover: ' + hover.slice(0, 160));
  await shot('bezier-hover.png');
  assert.ok(/<path[^>]*sk-hl/.test(hover), '10: hovering an open bezier draws its highlight');

  // select, then On-line: the select highlight and the dashed centreline
  await evalJs(`(() => { const pv = window.__prepareView; pv.setSelection([{ kind: 'chain', id: 'chain_bs0' }]); })()`);
  await sleep(150);
  const sel = await html('prepare-select-group');
  assert.ok(/<path[^>]*sk-hl-select/.test(sel), '10: a selected open bezier draws its select highlight: ' + sel.slice(0, 120));
  // TASK S2 (docs/OPERATIONS-MODEL.md 9.1): the quick flow makes a NEW On line operation of the selection, OPEN; its Depth typed; OK. TASK S3: the quick flow is the
  // operations toolbar's On line button (the card's type menu only changes an open operation)
  await evalJs(`(() => { document.getElementById('op-type-online').click();
    const d = document.querySelector('#prepare-panel .cut-depth'); d.value = '5'; d.dispatchEvent(new Event('change', { bubbles: true })); document.querySelector('#prepare-panel .cut-ok').click(); })()`);
  await sleep(250);
  const tp = await html('prepare-toolpath-group');
  console.log('toolpath: ' + tp.slice(0, 200));
  await shot('bezier-selected-online.png');
  assert.ok(/<path[^>]*class="[^"]*sk-tp/.test(tp), '10: an On-line open bezier draws its centreline');
  console.log(`prepare-bezier-788-live: ok (${net.blocked().length} non-local requests blocked)`);
} finally {
  await cdp.close();
}
