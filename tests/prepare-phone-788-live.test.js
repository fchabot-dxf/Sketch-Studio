// tests/prepare-phone-788-live.test.js — TASK 788, Shaper's Prepare on a 390 x 844 phone: the cut card's offset popover is fully on screen (it takes the
// SAME phone clamp as the type / shape / clearing popovers) and the travel-direction legend does not overlap the cut card. Bounding boxes, not pixels.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { blockRemote } from './helpers/block-remote.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const EVID = process.env.EVIDENCE_DIR ? path.resolve(process.env.EVIDENCE_DIR) : path.resolve('.evidence/788');
const PREFIX = process.env.SHOT_PREFIX || 'after';
fs.mkdirSync(EVID, { recursive: true });

const cdp = await launchBrowser({ tag: '788-phone', width: 390, height: 844, mobile: true });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, navigate, waitForApp } = cdp;
const LOCAL = `http://127.0.0.1:${port}/`;
const net = await blockRemote(cdp);

const touchTap = async (x, y) => {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 0, radiusX: 1, radiusY: 1, force: 1 }] });
  await sleep(40);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(200);
};
const clickEl = async (sel) => {
  const p = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return r.width && r.height ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null; })()`);
  assert(p, `${sel} not clickable`);
  await touchTap(p.x, p.y);
};
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(EVID, `${PREFIX}-${name}`), Buffer.from(s.data, 'base64'));
};
const box = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e || e.hidden) return null; const b = e.getBoundingClientRect(); return { left: Math.round(b.left), top: Math.round(b.top), right: Math.round(b.right), bottom: Math.round(b.bottom) }; })()`);
const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

try {
  await navigate(`${LOCAL}apps/shaper/index.html`, 12000);
  await waitForApp('design-canvas');
  await resetBufferLive(cdp);
  await navigate(`${LOCAL}apps/shaper/index.html`, 12000);
  await waitForApp('design-canvas');
  await waitFor(`!!(window.__designController && window.__designController.state)`, 'design ready');
  await evalJs(`(async () => {
    const st = window.__designController.state;
    [[0,0],[100,0],[100,60],[0,60]].forEach(([x,y],i) => st.joints.set('aj'+i, {x,y}));
    for (let i=0;i<4;i++) st.shapes.push({ id:'as'+i, type:'line', joints:['aj'+i, 'aj'+((i+1)%4)] });
    st.saveState('phone-draw');
    const lf = await import('/packages/core/loop-finder.js'); const cp = await import('/apps/shaper/src/cut-plan.js');
    cp.CUT_PLAN.set('loop:' + lf.findLoops(st)[0].id, { cutType: 'pocket', cutDepth: 5, cutOffset: 0, toolDia: 6.35 });
  })()`);
  await clickEl('.sk-sidebar-handle');
  await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'sidebar open');
  await sleep(250);
  await clickEl('.sk-sidebar-stage[data-tab="prepare"]');
  await waitFor(`!document.getElementById('view-prepare').hidden && !!window.__prepareView`, 'prepare ready');
  await evalJs(`(() => { const pv = window.__prepareView; pv.setSelection([{ kind: 'loop', id: pv.loops[0].id }]); })()`);
  await waitFor(`!document.querySelector('#prepare-panel .cut-card').hidden && !document.getElementById('prepare-dir-legend').hidden`, 'card and legend visible');
  await sleep(300);

  // (a) the offset popover is fully on screen, and left of the card
  const card0 = await box('#prepare-panel .cut-card');
  await evalJs(`(() => { const el = document.querySelector('.cut-offset'); el.scrollIntoView({ block: 'center' }); el.focus(); })()`);
  await sleep(200);
  const pop = await box('.cut-offset-pop');
  console.log('offset pop ' + JSON.stringify(pop));
  await shot('offset-pop.png');
  assert.ok(pop, '9a: the offset popover opens');
  assert.ok(pop.left >= 0 && pop.right <= 390 && pop.top >= 0 && pop.bottom <= 844, '9a: the offset popover is fully on screen: ' + JSON.stringify(pop));
  assert.ok(pop.right <= card0.left, '9a: and left of the cut card, not over it');

  // (b) the legend (its box and every child's box) does not overlap the cut card: a tall card (On-line with a Lead-in) reaches down to it
  await evalJs(`document.querySelector('.cut-offset').blur()`);
  await clickEl('.cut-type-trigger');
  await clickEl('.cut-type-opt[data-id="online"]');
  await clickEl('.cut-row[data-row="leadIn"] .cut-preset[data-value="true"]');
  await sleep(300);
  const card = await box('#prepare-panel .cut-card');
  const legend = await box('#prepare-dir-legend');
  const kids = await evalJs(`[...document.querySelectorAll('#prepare-dir-legend *')].map((e) => { const b = e.getBoundingClientRect(); return { left: Math.round(b.left), top: Math.round(b.top), right: Math.round(b.right), bottom: Math.round(b.bottom), w: b.width }; }).filter((b) => b.w > 0)`);
  console.log('card ' + JSON.stringify(card) + ' legend ' + JSON.stringify(legend) + ' children ' + kids.length);
  await shot('legend-and-card.png');
  assert.ok(legend && !overlap(legend, card), '9b: the legend box does not overlap the cut card');
  for (const k of kids) assert.ok(!overlap(k, card), '9b: a legend part does not overlap the cut card: ' + JSON.stringify(k));
  console.log(`prepare-phone-788-live: ok (${net.blocked().length} non-local requests blocked)`);
} finally {
  await cdp.close();
}

