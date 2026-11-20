// tests/cam-export-786-live.test.js — TASK 786 (hunt 785 bug 1) in the real Shaper page (desktop 1280 x 800, no request leaves the machine):
//  1. a CIRCLE pocket around a RECT island: the Export step's 2D view (the file as the Origin reads it, painted by the browser under its DEFAULT
//     nonzero fill rule) shows the island NOT filled and the pocket filled (isPointInFill on the shown path), screenshot; the downloaded file
//     (Generate Shaper SVG), parsed by the browser: its pocket path has no fill-rule and the same fill test holds;
//  2. the other way round (a RECT pocket around a CIRCLE island): the same.
// Screenshots: .evidence/786/ (taken before the checks, so a run on origin/main records the bug).
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { blockRemote } from './helpers/block-remote.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const EVIDENCE_DIR = path.resolve('.evidence/786');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const cdp = await launchBrowser({ tag: '786-island-fill', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, waitForApp, navigate, close } = cdp;
const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-786-dl-'));
const results = [];

const click = async (sel) => {
  const p = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; })()`);
  assert.ok(p, 'on screen: ' + sel);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none' });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(150);
};
const shot = async (name, sel) => {
  const clip = await evalJs(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height, scale: 1.5 }; })()`);
  const { data } = await send('Page.captureScreenshot', { format: 'png', clip });
  fs.writeFileSync(path.join(EVIDENCE_DIR, name), Buffer.from(data, 'base64'));
  console.log('screenshot ' + path.join(EVIDENCE_DIR, name));
};

// the drawing (world mm) + ONE pocket record on the outer loop (the island is its derived hole), through the page's own modules
const draw = (outer, island) => evalJs(`(async () => {
  const st = window.__designController.state;
  for (const k of [...st.joints.keys()]) st.joints.delete(k);
  st.shapes.length = 0; st.constraints.length = 0; st.profiles.length = 0;
  const add = (spec, p) => {
    if (spec.circle) { st.joints.set(p + 'c', { x: spec.circle[0], y: spec.circle[1] }); st.shapes.push({ id: p + 's', type: 'circle', joints: [p + 'c'], radius: spec.circle[2] }); return; }
    const [x, y, w, h] = spec.rect;
    [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].forEach(([px, py], i) => st.joints.set(p + 'j' + i, { x: px, y: py }));
    for (let i = 0; i < 4; i++) st.shapes.push({ id: p + 'l' + i, type: 'line', joints: [p + 'j' + i, p + 'j' + ((i + 1) % 4)] });
  };
  add(${JSON.stringify(outer)}, 'o'); add(${JSON.stringify(island)}, 'i');
  st.saveState('786 drawing');
  const lf = await import('/packages/core/loop-finder.js');
  const cp = await import('/tests/helpers/plan-v2.js');
  cp.V2_PLAN.clear();
  const outerLoop = lf.findLoops(st).find((l) => l.edges.every((e) => e.startsWith('o')));
  cp.V2_PLAN.set('loop:' + outerLoop.id, { cutType: 'pocket', cutDepth: 6, cutOffset: 0, toolDia: 6.35 });
  return outerLoop.id;
})()`);

// fill test of the ONE pocket path shown in the 2D view, at world points
const fillIn2d = (pts) => evalJs(`import('/apps/shaper/src/export-preview.js').then((m) => {
  const svg = document.getElementById('review-2d-canvas');
  const it = m.previewItems(svg.querySelector('.rv2d-doc')).find((i) => i.cutType === 'pocket');
  if (!it) return { error: 'no pocket element' };
  const p = it.el, pt = svg.createSVGPoint();
  return { d: p.getAttribute('d'), fillRule: getComputedStyle(p).fillRule, fill: getComputedStyle(p).fill,
    filled: ${JSON.stringify(pts)}.map(([x, y]) => { pt.x = x; pt.y = y; return p.isPointInFill(pt); }) };
})`);

// the downloaded file: Generate Shaper SVG, then the browser parses it (default fill rule) and tests the pocket path
async function download() {
  for (const f of fs.readdirSync(dlDir)) fs.rmSync(path.join(dlDir, f));
  await evalJs(`document.getElementById('btn-generate-svg').click()`);
  let file = null;
  for (let i = 0; i < 100 && !file; i++) { const f = fs.readdirSync(dlDir).find((n) => n.endsWith('.svg')); if (f) file = path.join(dlDir, f); else await sleep(100); }
  assert.ok(file, 'the export downloaded');
  await sleep(200);
  return fs.readFileSync(file, 'utf8');
}
const fillInFile = (svg, pts) => evalJs(`(() => {
  const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:0;top:0;width:400px;height:400px;opacity:0';
  const root = document.importNode(new DOMParser().parseFromString(${JSON.stringify(svg)}, 'image/svg+xml').documentElement, true); // XML: the shaper: attributes keep their case
  host.appendChild(root); document.body.appendChild(host);
  const p = [...root.querySelectorAll('path')].find((e) => e.getAttribute('shaper:cutType') === 'pocket');
  const pt = root.createSVGPoint();
  const out = { fillRuleAttr: p.getAttribute('fill-rule'), filled: ${JSON.stringify(pts)}.map(([x, y]) => { pt.x = x; pt.y = y; return p.isPointInFill(pt); }) };
  host.remove(); return out;
})()`);

try {
  await blockRemote(cdp);
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`);
  await waitForApp('design-canvas');
  await resetBufferLive(cdp);
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`);
  await waitForApp('design-canvas');
  await waitFor(`!!(window.__designController && window.__designController.state)`, 'the design controller');
  await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('DOC_UNIT', 'mm'))`);

  const cases = [
    { name: 'circle-pocket-rect-island', outer: { circle: [50, 50, 50] }, island: { rect: [35, 35, 30, 30] }, island_pt: [50, 50], pocket_pt: [15, 50] },
    { name: 'rect-pocket-circle-island', outer: { rect: [0, 0, 100, 100] }, island: { circle: [50, 50, 22] }, island_pt: [50, 50], pocket_pt: [10, 10] },
  ];
  let first = true;
  for (const c of cases) {
    await draw(c.outer, c.island);
    if (first) {
      await click('.sk-header-tab[data-tab="review"]');
      await waitFor(`!document.getElementById('view-review').hidden`, 'the Export step');
      await click('#review-view-switch button[data-view="2d"]');
      first = false;
    } else { // leave and come back: the Export step rebuilds from the plan
      await click('.sk-header-tab[data-tab="prepare"]');
      await sleep(200);
      await click('.sk-header-tab[data-tab="review"]');
    }
    await waitFor(`!document.getElementById('review-2d').hidden && document.querySelectorAll('#review-2d-canvas .rv2d-doc path').length > 0`, 'the 2D view');
    await sleep(300);
    await shot(`${c.name}-2d.png`, '#review-2d-canvas');
    const shown = await fillIn2d([c.island_pt, c.pocket_pt]);
    const svg = await download();
    fs.writeFileSync(path.join(EVIDENCE_DIR, `${c.name}.svg`), svg);
    const file = await fillInFile(svg, [c.island_pt, c.pocket_pt]);
    console.log(`${c.name}: 2D view ${JSON.stringify(shown)}; downloaded file ${JSON.stringify(file)}`);
    results.push({ c, shown, file });
  }
  for (const { c, shown, file } of results) {
    assert.strictEqual(shown.fillRule, 'nonzero', `${c.name}: the 2D view paints the file under the default nonzero rule`);
    assert.deepStrictEqual(shown.filled, [false, true], `${c.name}: in the 2D view the island at ${c.island_pt} is NOT filled, the pocket at ${c.pocket_pt} is: ${shown.d}`);
    assert.strictEqual(file.fillRuleAttr, null, `${c.name}: the downloaded pocket path has no fill-rule (Shaper Studio writes none)`);
    assert.deepStrictEqual(file.filled, [false, true], `${c.name}: in the downloaded file the island is NOT filled, the pocket is`);
  }
  console.log('cam-export-786-live: ok');
} finally {
  await close();
  fs.rmSync(dlDir, { recursive: true, force: true });
}
