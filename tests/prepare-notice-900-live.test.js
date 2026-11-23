// tests/prepare-notice-900-live.test.js — TASK 900: in Fusion mode the red #prepare-notice (an add-in error) must never sit under the Operations card
// (#prepare-ops) or the cut card (#prepare-panel), at any width; long text wraps and is never clipped. Normal Shaper is measured too (reported, not asserted).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './helpers/cdp-browser.js';

const EVIDENCE_DIR = path.resolve('.evidence/900');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const TEXT = 'Outline: the rings of its sloped wall do not nest, so no single straight outline is the union of them';
const WIDTHS = [641, 700, 860, 1000, 1400, 480];
const SHOT_TAG = process.env.TASK900_SHOT_TAG || 'after';

const cdp = await launchBrowser({ tag: '900-notice', width: 1400, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, waitForApp, navigate, close } = cdp;

const MEASURE = `(() => {
  const r = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
  const vis = (el) => !!el && !el.hidden && el.getBoundingClientRect().width > 0 && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
  const n = document.getElementById('prepare-notice');
  const others = [];
  const ops = document.getElementById('prepare-ops');
  if (vis(ops)) others.push({ name: '#prepare-ops', rect: r(ops) });
  const panel = document.getElementById('prepare-panel');
  if (vis(panel)) others.push({ name: '#prepare-panel (the cut card column)', rect: r(panel) });
  return { vw: innerWidth, vh: innerHeight, notice: r(n), sw: n.scrollWidth, cw: n.clientWidth, sh: n.scrollHeight, ch: n.clientHeight, others };
})()`;
const hit = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

async function setSize(w) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 1, mobile: false });
  await waitFor(`innerWidth === ${w}`, 'viewport ' + w);
  await new Promise((r) => setTimeout(r, 150));
}
async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(EVIDENCE_DIR, name), Buffer.from(data, 'base64'));
}
const failures = [];
function check(label, m, expectOps) {
  const n = m.notice;
  if (expectOps && !m.others.some((o) => o.name === '#prepare-ops')) failures.push(`${label}: #prepare-ops not measured`);
  for (const o of m.others) if (hit(n, o.rect)) failures.push(`${label}: notice ${JSON.stringify(n)} overlaps ${o.name} ${JSON.stringify(o.rect)}`);
  if (m.sw > m.cw) failures.push(`${label}: notice clipped horizontally (scrollWidth ${m.sw} > clientWidth ${m.cw})`);
  if (m.sh > m.ch) failures.push(`${label}: notice clipped vertically (scrollHeight ${m.sh} > clientHeight ${m.ch})`);
  if (n.l < 0 || n.t < 0 || n.r > m.vw || n.b > m.vh) failures.push(`${label}: notice outside the viewport ${JSON.stringify(n)} in ${m.vw}x${m.vh}`);
}

try {
  const { identifier } = await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { window.adsk = { fusionSendData() {} }; })();` });
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html?host=fusion`);
  await waitForApp('design-canvas');
  await waitFor(`!!document.getElementById('btn-fusion-add-selection') && !!document.getElementById('prepare-ops')`, 'Fusion Prepare mounted');
  await evalJs(`window.fusionJavaScriptHandler.handle('error', JSON.stringify({ action: 'error', message: ${JSON.stringify(TEXT)} }))`);
  await waitFor(`!document.getElementById('prepare-notice').hidden`, 'notice shown');
  for (const w of WIDTHS) {
    await setSize(w);
    const m = await evalJs(MEASURE);
    console.log(`fusion ${w}: notice ${JSON.stringify(m.notice)} others ${JSON.stringify(m.others.map((o) => [o.name, Math.round(o.rect.l), Math.round(o.rect.r)]))}`);
    check(`fusion ${w}`, m, w > 640);
    if (w === 860 || w === 480) await shot(`notice-${SHOT_TAG}-${w}.png`);
  }
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier });

  // Normal Shaper: the same notice in Prepare, measured only (the task asks for numbers, not a change).
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`);
  await waitForApp('design-canvas');
  await evalJs(`document.querySelector('.sk-header-tab[data-tab="prepare"]').click()`);
  await waitFor(`!document.getElementById('view-prepare').hidden`, 'normal Prepare');
  await evalJs(`(() => { const n = document.getElementById('prepare-notice'); n.textContent = ${JSON.stringify(TEXT)}; n.classList.add('is-error'); n.hidden = false; })()`);
  for (const w of [1400, 860]) {
    await setSize(w);
    const m = await evalJs(MEASURE);
    console.log(`normal ${w}: notice ${JSON.stringify(m.notice)} others ${JSON.stringify(m.others.map((o) => [o.name, Math.round(o.rect.l), Math.round(o.rect.r)]))} overlaps=${m.others.filter((o) => hit(m.notice, o.rect)).map((o) => o.name)}`);
  }
  assert.deepStrictEqual(failures, [], '\n' + failures.join('\n'));
  console.log('prepare-notice-900-live: all passed');
} finally {
  await close();
}
