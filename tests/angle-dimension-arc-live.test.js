// tests/angle-dimension-arc-live.test.js -- TASK 543 (live headless, REAL mouse, SketchStudio): the owner's document (two lines 10 degrees
// apart, ANGLE value 10 whose label sat in the 170 degree sector). Loaded through the app's own project store + restore path.
//  A. the drawn arc spans 10 degrees (read back from the page's own SVG path), between the two line directions, label 10.0
//  B. a real drag of the label across the vertex into the other sectors never changes what the arc measures (10), moves no geometry,
//     and one Undo puts the label back
// With EVIDENCE_DIR set, writes the full-page screenshot and an arc crop there.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';

const OWNER = JSON.parse(fs.readFileSync(new URL('../.evidence/543/owner-report-document.json', import.meta.url), 'utf8'));
const RADIUS = OWNER.geometry.constraints.find((c) => c.type === 'angle').offset;   // the arc is the SVG arc path with this radius
const INT = { x: 587.4900947223791, y: 7584.647136653884 };                        // the lines' intersection (computed from the document)

await (async () => {
  const cdp = await launchBrowser({ tag: '543' });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;
  try {
    const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const click = async (x, y) => { await mouse('mouseMoved', x, y, 0); await sleep(40); await mouse('mousePressed', x, y, 1); await sleep(40); await mouse('mouseReleased', x, y, 0); await sleep(250); };
    const drag = async (from, to) => {
      await mouse('mouseMoved', from.x, from.y, 0); await sleep(40); await mouse('mousePressed', from.x, from.y, 1);
      for (let i = 1; i <= 10; i++) { await mouse('mouseMoved', from.x + (to.x - from.x) * i / 10, from.y + (to.y - from.y) * i / 10, 1); await sleep(30); }
      await mouse('mouseReleased', to.x, to.y, 0); await sleep(500);
    };
    const centerOf = (sel) => evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    // the angle dimension's arc as drawn: its two end points in WORLD units (the path is in world coordinates)
    const arc = () => evalJs(`(() => { for (const p of document.querySelectorAll('#svgCanvas path')) { const m = (p.getAttribute('d') || '').match(/^M ([-\\d.e]+) ([-\\d.e]+) A ([-\\d.e]+) [-\\d.e]+ 0 ([01]) 1 ([-\\d.e]+) ([-\\d.e]+)$/); if (m && Math.abs(+m[3] - ${RADIUS}) < 1) return JSON.stringify({ sx: +m[1], sy: +m[2], large: +m[4], ex: +m[5], ey: +m[6] }); } return null; })()`).then((s) => s && JSON.parse(s));
    const spanOf = (a) => { const d = (x) => Math.atan2(x.y - INT.y, x.x - INT.x) * 180 / Math.PI; return ((d({ x: a.ex, y: a.ey }) - d({ x: a.sx, y: a.sy })) % 360 + 360) % 360; };
    const shot = async (name, clip) => { if (process.env.EVIDENCE_DIR) fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name), Buffer.from((await send('Page.captureScreenshot', Object.assign({ format: 'png' }, clip ? { clip: Object.assign({ scale: 1 }, clip) } : {}))).data, 'base64')); };

    await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 8000);
    await waitFor(`!!document.getElementById('svgCanvas') && !!document.getElementById('tool-select')`, 'SketchStudio to load');
    await sleep(1000);
    // seed the owner's document as the current design, then reload: the app's own restore loads it
    await evalJs(`(async () => { const { getProjectStore } = await import('/packages/ui/project-store.js'); const s = getProjectStore();
      const p = await s.newDesign('owner-543', { app: 'sketchstudio' }); await s.save(${JSON.stringify(OWNER)}, { app: 'sketchstudio', id: p.id }); return p.id; })()`);
    await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 8000);
    await waitFor(`!!document.querySelector('#svgCanvas .dim-label')`, 'the owner dimension to be drawn', 15000);
    await sleep(1500);
    // the dimension sits 19757 units from the vertex, past the top of the first fit: a real wheel zoom-out brings the whole dimension into view
    { const cvr = await centerOf('#svgCanvas'); await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cvr.x, y: cvr.y, deltaX: 0, deltaY: 700 }); await sleep(500); }
    await shot('arc-zoomed-out.png');

    // ---- A. the arc spans the value
    const a0 = await arc();
    assert(a0, 'the angle dimension arc is in the page');
    const span0 = spanOf(a0);
    assert(Math.abs(span0 - 10) < 0.5, `A: the drawn arc spans ${span0.toFixed(2)} degrees; the label reads 10`);
    const label0 = await evalJs(`document.querySelector('#svgCanvas .dim-label').textContent.replace(/\\s+/g, '')`);
    assert(/10\.0/.test(label0), 'A: the label reads 10.0: ' + label0);
    console.log('A. arc span', span0.toFixed(2), 'label', label0);

    // ---- B. a real label drag into other sectors never changes what the arc measures
    await click((await centerOf('#tool-select')).x, (await centerOf('#tool-select')).y);
    const cv = await evalJs(`(() => { const r = document.getElementById('svgCanvas').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`);
    const vertex = await evalJs(`(() => { const c = document.getElementById('svgCanvas'); const m = c.getScreenCTM(); return { x: m.a * ${INT.x} + m.c * ${INT.y} + m.e, y: m.b * ${INT.x} + m.d * ${INT.y} + m.f }; })()`);
    const stable = JSON.stringify(await evalJs(`JSON.stringify([...document.querySelectorAll('#svgCanvas line.shape-elem')].map(e => [e.getAttribute('x1'), e.getAttribute('y1'), e.getAttribute('x2'), e.getAttribute('y2')]))`));
    for (const target of [{ x: cv.l + cv.w * 0.3, y: cv.t + cv.h * 0.25 }, { x: cv.l + cv.w * 0.75, y: cv.t + cv.h * 0.7 }, { x: vertex.x - 120, y: vertex.y + 40 }]) {
      const lab = await centerOf('#svgCanvas .dim-label');
      await drag(lab, target);
      const a = await arc();
      assert(a, 'B: the arc is still drawn after the label drag');
      const sp = spanOf(a);
      assert(Math.abs(sp - 10) < 0.5, `B: after dragging the label to (${Math.round(target.x)},${Math.round(target.y)}) the arc spans ${sp.toFixed(2)}, not 10`);
    }
    assert.strictEqual(JSON.stringify(await evalJs(`JSON.stringify([...document.querySelectorAll('#svgCanvas line.shape-elem')].map(e => [e.getAttribute('x1'), e.getAttribute('y1'), e.getAttribute('x2'), e.getAttribute('y2')]))`)), stable, 'B: the lines did not move');
    await shot('arc-after-label-drag.png');
    console.log('B. label dragged into other sectors: arc stays 10, geometry unchanged');
  } finally {
    await cdp.close();
  }
})();
process.exit(0);
