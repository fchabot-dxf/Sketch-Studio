// tests/drawing-footer-landscape-783-live.test.js â€” TASK 783 C: SketchStudio's Drawing step on a phone in LANDSCAPE: the footer floats over the page there, and the
// drawing (and so Fit, and the dimension line under the shape) must end ABOVE its top, as on desktop / portrait where the footer sits under the drawing.
// Fake Google only (no sign-in needed), every non-local request blocked. Sizes: 844 x 390 and 780 x 360 landscape touch; 390 x 844 portrait touch and 1280 x 800 desktop as controls.
// Screenshots to EVIDENCE_DIR (default .evidence/783).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { blockRemote } from './helpers/block-remote.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const EVID = path.resolve(process.env.EVIDENCE_DIR || '.evidence/783');
fs.mkdirSync(EVID, { recursive: true });
const DOC = { version: 3, hosts: {}, geometry: {
  joints: [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }], ['a', { x: 0, y: 0, sketchId: 'sketch-1' }], ['b', { x: 60, y: 0, sketchId: 'sketch-1' }], ['c', { x: 60, y: -40, sketchId: 'sketch-1' }]],
  shapes: [{ id: 'L1', type: 'line', joints: ['a', 'b'], sketchId: 'sketch-1' }, { id: 'L2', type: 'line', joints: ['b', 'c'], sketchId: 'sketch-1' }],
  constraints: [{ type: 'coincident', joints: ['j_origin', 'a'] }, { type: 'distance', joints: ['a', 'b'], value: 60, offset: 8 }],
  sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }], activeSketchId: 'sketch-1', groups: [], profiles: [], parameters: [] } };
const SIZES = [
  { name: 'landscape-844x390', w: 844, h: 390, touch: true, floats: true },
  { name: 'landscape-780x360', w: 780, h: 360, touch: true, floats: true },
  { name: 'portrait-390x844', w: 390, h: 844, touch: true, floats: false },
  { name: 'desktop-1280x800', w: 1280, h: 800, touch: false, floats: false },
];

await (async () => {
  const cdp = await launchBrowser({ tag: '783c', width: 1280, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate, waitForApp } = cdp;
  try {
    await blockRemote(cdp);
    await installFakeDriveSession(cdp, { signedIn: true });
    await resetBufferLive(cdp);
    // the Tailwind CDN is blocked (no request leaves the machine): a local shim of the layout utilities index.html uses, so the page lays out as in production
    const TW = `.block{display:block}.flex{display:flex}.hidden{display:none}.flex-1{flex:1 1 0%}.flex-col{flex-direction:column}.flex-row{flex-direction:row}.gap-1{gap:.25rem}.gap-2{gap:.5rem}.h-screen{height:100vh}.items-center{align-items:center}.justify-between{justify-content:space-between}.justify-end{justify-content:flex-end}.min-w-0{min-width:0}.overflow-auto{overflow:auto}.overflow-hidden{overflow:hidden}.relative{position:relative}.shrink-0{flex-shrink:0}.w-full{width:100%}.z-40{z-index:40}.p-1{padding:.25rem}.px-4{padding-left:1rem;padding-right:1rem}.py-1\\.5{padding-top:.375rem;padding-bottom:.375rem}*,::before,::after{box-sizing:border-box}body{margin:0}`;
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.id = 'tw-shim'; s.textContent = ${JSON.stringify(TW)}; document.head.prepend(s); });` });    const url = `http://127.0.0.1:${port}/apps/sketchstudio/index.html`;
    await navigate(url, 15000); await waitForApp('svgCanvas');
    await evalJs(`import('/packages/ui/project-store.js').then(async (m) => { const s = m.getProjectStore(); const d = await s.newDesign('Footer 783', { app: 'sketchstudio' }); await s.save(${JSON.stringify(DOC)}, { app: 'sketchstudio', id: d.id }); return d.id; })`);
    for (const s of SIZES) {
      await send('Emulation.setDeviceMetricsOverride', { width: s.w, height: s.h, deviceScaleFactor: 2, mobile: s.touch, screenOrientation: s.w > s.h ? { type: 'landscapePrimary', angle: 90 } : { type: 'portraitPrimary', angle: 0 } });
      await send('Emulation.setTouchEmulationEnabled', { enabled: s.touch, maxTouchPoints: s.touch ? 5 : 0 });
      await navigate(url, 15000); await waitForApp('svgCanvas'); await sleep(600);
      await evalJs(`(() => { const t = [...document.querySelectorAll('.sk-header-tab')].find((x) => x.textContent.trim() === 'Drawing'); t.click(); return true; })()`);
      await waitFor(`!document.getElementById('drawing-view').hidden && !!document.querySelector('#drawing-view .sk-drawing-world *')`, s.name + ': the Drawing step shows the drawing', 8000);
      await sleep(500);
      const m = await evalJs(`(() => {
        const f = document.querySelector('footer.sk-statusbar'), fr = f.getBoundingClientRect(), v = document.getElementById('drawing-view').getBoundingClientRect();
        const w = document.querySelector('#drawing-view .sk-drawing-world').getBoundingClientRect(), dim = document.querySelector('#drawing-view .sk-drawing-world [data-ctype="distance"], #drawing-view .sk-drawing-world .dimension, #drawing-view .sk-drawing-world text');
        return { footerTop: fr.top, footerPos: getComputedStyle(f).position, drawingBottom: v.bottom, worldBottom: w.bottom, dimBottom: dim ? dim.getBoundingClientRect().bottom : null, vh: innerHeight };
      })()`);
      if (s.floats) assert.strictEqual(m.footerPos, 'fixed', s.name + ': the footer floats here');
      assert.ok(m.footerTop >= m.drawingBottom - 0.5, `${s.name}: the footer's top ${m.footerTop} >= the drawing's bottom ${m.drawingBottom} ` + JSON.stringify(m));
      assert.ok(m.footerTop >= m.worldBottom - 0.5, `${s.name}: the fitted drawing ends above the footer: footer top ${m.footerTop} >= drawing content bottom ${m.worldBottom}`);
      if (m.dimBottom !== null) assert.ok(m.footerTop >= m.dimBottom - 0.5, `${s.name}: the dimension line is clear of the footer ` + JSON.stringify(m));
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(EVID, `drawing-footer-${s.name}.png`), Buffer.from(shot.data, 'base64'));
      console.log(`${s.name}: footer top ${Math.round(m.footerTop)} >= drawing bottom ${Math.round(m.drawingBottom)}, content bottom ${Math.round(m.worldBottom)}`);
    }
    console.log('drawing-footer-landscape-783-live: ok');
  } finally {
    try { await cdp.close(); } catch (e) { console.error('close: ' + e.message); }
  }
})();
