// tests/group-blocks-752-live.test.js — TASK 752 in the REAL Shaper (headless, REAL mouse / touch via CDP): a user group that is not entered is
// ONE rigid block the solver only translates.
//  A. desktop 1280 x 800: a word (O, B with two holes) DROPPED on the page lands grouped (the file group, a group per letter). A Line drawn onto
//     the top corner of B (the Line tool snaps to it) and then dragged by its middle: B keeps its shape (every joint by the same vector, every
//     inside distance unchanged to 1e-9): the file moves whole, or the line gives (751's fact 1 showed the corner pulled alone). Then a double
//     click enters the file, a second one enters B, a drag of one of its curves RESHAPES it (inside the entered group the curves are free),
//     Esc twice leaves, and the line dragged again moves the NEW shape whole (nothing stored: the shape at each solve is the block's).
//  B. phone 390 x 844, real touch: the same word dropped; a Line tapped onto B's corner; the line dragged with a finger: B keeps its shape.
// Screenshots (.evidence/752, local): A before / after the line drag, the reshaped letter, after the second drag; B phone before / after.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';

const EVID = path.resolve('.evidence/752');
fs.mkdirSync(EVID, { recursive: true });
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="120mm" height="60mm" viewBox="0 0 120 60">
  <path id="O" fill="#000000" d="M10 10 H30 V50 H10 Z M15 15 H25 V45 H15 Z"/>
  <path id="B" fill="#000000" d="M50 10 H70 V50 H50 Z M55 15 H65 V27 H55 Z M55 33 H65 V45 H55 Z"/>
</svg>`;

const t0 = Date.now();
const cdp = await launchBrowser({ tag: '752', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, navigate, waitForApp } = cdp;
const results = {}, md5s = [];
const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: Math.round(p.x), y: Math.round(p.y), id: i + 1, radiusX: 1, radiusY: 1, force: 1 })) });
const tap = async (p, hold = 70) => { await T('touchStart', [p]); await sleep(hold); await T('touchEnd', []); await sleep(450); };
const touchDrag = async (a, b, steps = 14) => { await T('touchStart', [a]); await sleep(60); for (let i = 1; i <= steps; i++) { await T('touchMove', [{ x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps }]); await sleep(25); } await sleep(80); await T('touchEnd', []); await sleep(400); };
const mouse = (type, x, y, buttons, clickCount = 1) => send('Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : clickCount });
const click = async (p) => { await mouse('mouseMoved', p.x, p.y, 0); await sleep(60); await mouse('mousePressed', p.x, p.y, 1); await sleep(50); await mouse('mouseReleased', p.x, p.y, 0); await sleep(650); };
const dblclick = async (p) => { await mouse('mouseMoved', p.x, p.y, 0); await sleep(60); await mouse('mousePressed', p.x, p.y, 1, 1); await sleep(50); await mouse('mouseReleased', p.x, p.y, 0, 1); await sleep(90); await mouse('mousePressed', p.x, p.y, 1, 2); await sleep(50); await mouse('mouseReleased', p.x, p.y, 0, 2); await sleep(650); };
const mouseDrag = async (a, b, steps = 16) => { await mouse('mouseMoved', a.x, a.y, 0); await sleep(60); await mouse('mousePressed', a.x, a.y, 1); await sleep(60); for (let i = 1; i <= steps; i++) { await mouse('mouseMoved', a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps, 1); await sleep(25); } await sleep(100); await mouse('mouseReleased', b.x, b.y, 0); await sleep(500); };
const shot = async (name, clip) => {
  const r = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 2 } });
  const buf = Buffer.from(r.data, 'base64');
  fs.writeFileSync(path.join(EVID, name), buf);
  md5s.push(name + '=' + createHash('md5').update(buf).digest('hex'));
};
const ST = `window.__designController.state`;
const toS = (x, y) => evalJs(`(() => { const m = document.querySelector('#design-canvas .shape-elem').getScreenCTM(); const p = new DOMPoint(${x}, ${y}).matrixTransform(m); return { x: p.x, y: p.y }; })()`);
const groupJoints = (name) => evalJs(`import('/packages/core/group-model.js').then((m) => { const st = ${ST}; const g = st.groups.find((x) => x.name === ${JSON.stringify(name)}); const ids = m.shapesInGroup(st, g.id); const out = {}; for (const s of st.shapes) if (ids.includes(s.id)) for (const j of s.joints) { const p = st.joints.get(j); out[j] = [p.x, p.y]; } return out; })`);
// rigid: every joint by the same vector (spread), every pairwise distance unchanged (dist)
const rigidity = (a, b) => {
  const ks = Object.keys(a), v = [b[ks[0]][0] - a[ks[0]][0], b[ks[0]][1] - a[ks[0]][1]];
  const spread = Math.max(...ks.map((k) => Math.hypot(b[k][0] - a[k][0] - v[0], b[k][1] - a[k][1] - v[1])));
  let dist = 0;
  for (let i = 0; i < ks.length; i++) for (let k = i + 1; k < ks.length; k++) { const p = ks[i], q = ks[k]; dist = Math.max(dist, Math.abs(Math.hypot(b[p][0] - b[q][0], b[p][1] - b[q][1]) - Math.hypot(a[p][0] - a[q][0], a[p][1] - a[q][1]))); }
  return { v, moved: Math.hypot(...v), spread, dist, joints: ks.length };
};
const lineEnds = (id) => evalJs(`(() => { const st = ${ST}; const L = st.shapes.find((s) => s.id === ${JSON.stringify(id)}); return L.joints.map((j) => [st.joints.get(j).x, st.joints.get(j).y]); })()`);
const lineMid = async (id) => { const e = await lineEnds(id); return toS((e[0][0] + e[1][0]) / 2, (e[0][1] + e[1][1]) / 2); };
// the word's box on screen (and the line's), for the screenshots
const wordClip = () => evalJs(`(() => { const st = ${ST}; const m = document.querySelector('#design-canvas .shape-elem').getScreenCTM(); const xs = [], ys = [];
  for (const s of st.shapes) for (const j of s.joints) { const q = new DOMPoint(st.joints.get(j).x, st.joints.get(j).y).matrixTransform(m); xs.push(q.x); ys.push(q.y); }
  const x = Math.max(0, Math.min(...xs) - 20), y = Math.max(0, Math.min(...ys) - 20); return { x, y, width: Math.min(innerWidth, Math.max(...xs) + 20) - x, height: Math.min(innerHeight, Math.max(...ys) + 20) - y }; })()`);
// where the outside line starts: in the gap between O and B (world x 40), level with B's middle; the line runs from there to B's corner (the
// length / angle boxes the Line tool opens at its first click stay clear of the corner)
const lineStart = (corner) => toS(corner.x - 10, corner.midY);
// the clip grown by `pad` css px on every side, inside the viewport
const padClip = (c, pad) => evalJs(`(() => { const x = Math.max(0, ${c.x - pad}), y = Math.max(0, ${c.y - pad}); return { x, y, width: Math.min(innerWidth, ${c.x + c.width + pad}) - x, height: Math.min(innerHeight, ${c.y + c.height + pad}) - y }; })()`);
const drop = () => evalJs(`(() => { const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(SVG)}], 'word.svg', { type: 'image/svg+xml' })); document.body.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true })); document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); })()`);
// B's top-left corner (world) and the drawn line that ends on it
const bCorner = () => evalJs(`import('/packages/core/group-model.js').then((m) => { const st = ${ST}; const g = st.groups.find((x) => x.name === 'B'); const ids = m.shapesInGroup(st, g.id); const js = [...new Set(st.shapes.filter((s) => ids.includes(s.id)).flatMap((s) => s.joints))].map((id) => ({ id, x: st.joints.get(id).x, y: st.joints.get(id).y })); const ys = js.map((j) => j.y); return { ...js.sort((a, b) => (a.y - b.y) || (a.x - b.x))[0], midY: (Math.min(...ys) + Math.max(...ys)) / 2 }; })`);
const drawnLine = (cornerId) => evalJs(`(() => { const st = ${ST}; const L = st.shapes[st.shapes.length - 1]; const end = L.joints.find((j) => j === ${JSON.stringify(cornerId)} || st.constraints.some((c) => c.type === 'coincident' && c.joints.includes(j) && c.joints.includes(${JSON.stringify(cornerId)}))); return { id: L.id, type: L.type, grouped: !!L.userGroupId, end: end || null }; })()`);

try {
  await installFakeDriveSession(cdp);

  // ── A. desktop ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    await resetBufferLive(cdp);
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 10000); await waitForApp('design-canvas'); await sleep(600);
    await drop();
    await waitFor(`${ST}.groups.length === 3`, 'the import and its 3 groups (word, O, B)'); await sleep(600);
    const corner = await bCorner();
    const cs = await toS(corner.x, corner.y);
    await pressRibbonTool(evalJs, click, 'tool-line'); await sleep(250);
    await click(await lineStart(corner)); await mouse('mouseMoved', cs.x + 1, cs.y + 1, 0); await sleep(250); await click(cs);
    await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(250);
    const L = await drawnLine(corner.id);
    assert.ok(L.type === 'line' && !L.grouped && L.end, 'A. the Line tool drew a line ending on B\'s corner: ' + JSON.stringify(L));
    await evalJs(`document.getElementById('tool-select').click()`); await sleep(200);
    await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(200);
    const clip = await padClip(await wordClip(), 90);
    await shot('A1-desktop-line-on-B-corner-before-drag.png', clip);
    const b0 = await groupJoints('B'), w0 = await groupJoints('word'), l0 = await lineEnds(L.id);
    const m0 = await lineMid(L.id);
    await mouseDrag(m0, { x: m0.x + 60, y: m0.y + 30 });
    const b1 = await groupJoints('B'), w1 = await groupJoints('word'), l1 = await lineEnds(L.id);
    const rB = rigidity(b0, b1), rW = rigidity(w0, w1);
    const lineMoved = Math.max(...l1.map((p, i) => Math.hypot(p[0] - l0[i][0], p[1] - l0[i][1])));
    results.A1 = { B: rB, word: { moved: rW.moved, spread: rW.spread }, lineMoved };
    console.log('A. line dragged (the file not entered): ' + JSON.stringify(results.A1));
    assert.ok(rB.spread < 1e-9 && rB.dist < 1e-9 && rW.spread < 1e-9, 'A. B keeps its shape; the whole file moves as one block (or not at all)');
    assert.ok(rB.moved > 1 || lineMoved > 1, 'A. the drag moved the file or the line');
    await shot('A2-desktop-after-line-drag-B-whole.png', clip);

    // enter the file, then B; drag one curve of B: it is reshaped (inside the entered group the curves are free)
    const bEdge = await evalJs(`import('/packages/core/group-model.js').then((m) => { const st = ${ST}; const g = st.groups.find((x) => x.name === 'B'); const ids = m.shapesInGroup(st, g.id); const c = ${JSON.stringify(corner.id)}; const s = st.shapes.find((x) => ids.includes(x.id) && x.joints.includes(c) && Math.abs(st.joints.get(x.joints[0]).x - st.joints.get(x.joints[1]).x) < 1e-9); return s.id; })`); // B's left edge (vertical, through the corner)
    let p = await lineMid(bEdge);
    await dblclick(p);
    await sleep(600); p = await lineMid(bEdge); await dblclick(p);
    const entered = await evalJs(`(${ST}.groups.find((g) => g.id === ${ST}.enteredGroupId) || {}).name || null`);
    assert.strictEqual(entered, 'B', 'A. two double clicks entered the file, then B');
    await sleep(600);
    const e0 = await groupJoints('B');
    p = await lineMid(bEdge);
    await mouseDrag(p, { x: p.x - 45, y: p.y });
    const e1 = await groupJoints('B');
    const rIn = rigidity(e0, e1);
    results.A2 = { reshape: rIn };
    console.log('A. inside the entered B, its left edge dragged: ' + JSON.stringify(rIn));
    assert.ok(rIn.dist > 1, 'A. inside the entered group the letter is reshaped (its curves are free)');
    await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(250); await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(250);
    assert.strictEqual(await evalJs(`${ST}.enteredGroupId`), null, 'A. Esc twice left the groups');
    await shot('A3-desktop-B-reshaped-inside-then-left.png', clip);
    // the line dragged again: the NEW shape moves whole
    const n0 = await groupJoints('B');
    const m1 = await lineMid(L.id);
    await mouseDrag(m1, { x: m1.x - 50, y: m1.y + 40 });
    const n1 = await groupJoints('B');
    const rN = rigidity(n0, n1);
    results.A3 = { newShape: rN };
    console.log('A. the line dragged again: ' + JSON.stringify(results.A3));
    assert.ok(rN.spread < 1e-9 && rN.dist < 1e-9, 'A. the reshaped B keeps its NEW shape when the line is dragged again');
    await shot('A4-desktop-after-second-drag-new-shape-whole.png', clip);
  }

  // ── B. phone 390, touch ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    await resetBufferLive(cdp);
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 10000); await waitForApp('design-canvas'); await sleep(600);
    await drop();
    await waitFor(`${ST}.groups.length === 3`, 'B. the import and its 3 groups'); await sleep(900);
    const corner = await bCorner();
    const cs = await toS(corner.x, corner.y);
    await pressRibbonTool(evalJs, tap, 'tool-line'); await sleep(250);
    await tap(await lineStart(corner)); await tap(cs);
    await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(250);
    const L = await drawnLine(corner.id);
    assert.ok(L.type === 'line' && !L.grouped && L.end, 'B. a Line tapped onto B\'s corner: ' + JSON.stringify(L));
    await pressRibbonTool(evalJs, tap, 'tool-select'); await sleep(250);
    const clip = await padClip(await wordClip(), 70);
    await shot('B1-phone-line-on-B-corner-before-drag.png', clip);
    const b0 = await groupJoints('B'), l0 = await lineEnds(L.id);
    const m0 = await lineMid(L.id);
    await sleep(500);
    await touchDrag(m0, { x: m0.x + 40, y: m0.y + 50 });
    const b1 = await groupJoints('B'), l1 = await lineEnds(L.id);
    const rB = rigidity(b0, b1);
    const lineMoved = Math.max(...l1.map((p, i) => Math.hypot(p[0] - l0[i][0], p[1] - l0[i][1])));
    results.B = { B: rB, lineMoved };
    console.log('B. phone: the line dragged with a finger: ' + JSON.stringify(results.B));
    assert.ok(rB.spread < 1e-9 && rB.dist < 1e-9, 'B. phone: B keeps its shape');
    assert.ok(rB.moved > 1 || lineMoved > 1, 'B. phone: the drag moved the file or the line');
    await shot('B2-phone-after-line-drag-B-whole.png', clip);
  }
  console.log('group-blocks-752-live: ALL CHECKS PASSED ' + JSON.stringify(results));
  console.log('screenshots: ' + md5s.join(' '));
  console.log('elapsed ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
} finally {
  await cdp.close();
}
