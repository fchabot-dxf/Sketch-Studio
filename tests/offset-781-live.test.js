// tests/offset-781-live.test.js -- TASK 781 (live headless, REAL mouse + keys via CDP, SketchStudio desktop 1280 x 800).
// Draw a rectangle (Rect), Fillet its 4 corners R 5 (every join of the outline is now TANGENT), Offset it 3 OUTSIDE. Select, double click the
// offset dimension, type 5, Enter: the copy moves to 5 from its source on every side (before task 781 no solver row of an all-tangent chain read
// the distance, so the copy stayed at 3 while the dimension said 5). Undo -> 3, Redo -> 5. Everything is read from what the page draws (the
// lines' world ends, the dimension labels). Screenshots: .evidence/781 (before / after the edit).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const EVID = path.join(process.cwd(), '.evidence', '781');
const SEL = '#svgCanvas';

await (async () => {
  const cdp = await launchBrowser({ tag: '781', width: 1280, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;
  try {
    fs.mkdirSync(EVID, { recursive: true });
    const mouse = (type, x, y, buttons, clickCount = 1) => send('Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : clickCount });
    const tap = async (p) => { await mouse('mouseMoved', p.x, p.y, 0); await sleep(60); await mouse('mousePressed', p.x, p.y, 1); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0); await sleep(250); };
    const hover = async (p) => { await mouse('mouseMoved', p.x, p.y, 0); await sleep(150); };
    const double = async (p) => { await mouse('mouseMoved', p.x, p.y, 0); await sleep(60); await mouse('mousePressed', p.x, p.y, 1, 1); await sleep(30); await mouse('mouseReleased', p.x, p.y, 0, 1); await sleep(60); await mouse('mousePressed', p.x, p.y, 1, 2); await sleep(30); await mouse('mouseReleased', p.x, p.y, 0, 2); await sleep(400); };
    const key = async (k, code, vk) => { await sendRealKey(send, k, code, vk); await sleep(250); };
    const typeIn = async (id, text) => { await evalJs(`(() => { const i = document.getElementById('${id}'); i.focus(); i.select(); })()`); for (const ch of text) await send('Input.dispatchKeyEvent', { type: 'char', text: ch }); await sleep(200); };
    const boxOpen = (id) => waitFor(`(() => { const i = document.getElementById('${id}'); return !!i && !i.classList.contains('hidden') && i.getBoundingClientRect().width > 0; })()`, `the box #${id}`);
    const tool = (id) => pressRibbonTool(evalJs, tap, id).then(() => sleep(200));
    const centerOf = (sel) => evalJs(`(() => { const r = document.querySelector('${sel}').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    // the drawn lines (world ends, from the page's own elements) and the number of drawn arcs
    const lines = () => evalJs(`JSON.stringify([...document.querySelectorAll('${SEL} line.shape-elem[data-shape-id]')].map((e) => ({ id: e.dataset.shapeId, a: { x: +e.getAttribute('x1'), y: +e.getAttribute('y1') }, b: { x: +e.getAttribute('x2'), y: +e.getAttribute('y2') } })))`).then(JSON.parse);
    const arcCount = () => evalJs(`document.querySelectorAll('${SEL} path.shape-elem[data-shape-id]').length`);
    const toScreen = (w) => evalJs(`(() => { const m = document.querySelector('${SEL} .shape-elem').getScreenCTM(); const q = new DOMPoint(${w.x}, ${w.y}).matrixTransform(m); return { x: q.x, y: q.y }; })()`);
    const labels = () => evalJs(`JSON.stringify([...document.querySelectorAll('${SEL} .dim-label[data-constraint-idx]')].map((e) => ({ idx: +e.dataset.constraintIdx, text: e.textContent.trim() })))`).then(JSON.parse);
    const shot = async (file, clip) => { const r = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 2 } }); assert(r && r.data, `screenshot ${file}`); fs.writeFileSync(path.join(EVID, file), Buffer.from(r.data, 'base64')); console.log('screenshot ' + path.join(EVID, file)); };

    await resetBufferLive(cdp);
    const url = `http://127.0.0.1:${port}/apps/sketchstudio/index.html`;
    await navigate(url, 8000);
    await evalJs(`(async () => { localStorage.clear(); const dbs = indexedDB.databases ? await indexedDB.databases() : []; await Promise.all(dbs.map(d => new Promise(r => { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = () => r(); }))); localStorage.setItem('sketch-studio-settings', JSON.stringify({ AXIS_SNAP: false, GRID_MAGNETISM: 0.001, DOC_UNIT: 'mm' })); return true; })()`);
    await navigate(url, 8000);
    await waitFor(`(() => { const c = document.querySelector('${SEL}'); return !!c && c.getBoundingClientRect().width > 0 && c.dataset.docReady === '1' && !!document.getElementById('tool-select'); })()`, 'sketchstudio ready');
    await sleep(600);

    // ---- the rectangle (Rect, two corners) about the canvas middle
    const cr = await evalJs(`(() => { const r = document.querySelector('${SEL}').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`);
    // the view opens zoomed in (tens of px per mm): the mouse wheel zooms out until a 60 x 40 mm rectangle fits (px per mm from the origin's own
    // drawn transform, world space)
    const pxPerMm = () => evalJs(`(() => { const m = document.querySelector('${SEL} .joint-handle[data-joint-id="j_origin"]').getScreenCTM(); return Math.hypot(m.a, m.b); })()`);
    const M = { x: cr.l + cr.w * 0.5, y: cr.t + cr.h * 0.55 };
    for (let i = 0; i < 40 && (await pxPerMm()) > 6; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.round(M.x), y: Math.round(M.y), deltaX: 0, deltaY: 120 }); await sleep(80); }
    const k = await pxPerMm();
    assert(k <= 6 && k > 1, `zoomed out to ${k} px per mm`);
    const hw = 30 * k, hh = 20 * k;
    await tool('tool-rect');
    if (await evalJs(`!!document.querySelector('.sk-ribbon-menu.show [data-mode="rect-2pt"]')`)) await tap(await centerOf('.sk-ribbon-menu.show [data-mode="rect-2pt"]'));
    await tap({ x: M.x - hw, y: M.y - hh }); await tap({ x: M.x + hw, y: M.y + hh });
    await key('Escape', 'Escape', 27);
    const rect = await lines();
    assert.strictEqual(rect.length, 4, `the rectangle has 4 sides: ${JSON.stringify(rect)}`);
    const corners = [...new Map(rect.flatMap((l) => [l.a, l.b]).map((p) => [`${p.x.toFixed(6)},${p.y.toFixed(6)}`, p])).values()];
    assert.strictEqual(corners.length, 4, `4 corners: ${JSON.stringify(corners)}`);

    // ---- Fillet the 4 corners, R 5 (the box stays open while corners are picked)
    await tool('tool-fillet');
    for (const [k, p] of corners.entries()) { await tap(await toScreen(p)); if (k === 0) await boxOpen('fillet-radius-input'); }
    await typeIn('fillet-radius-input', '5');
    await key('Enter', 'Enter', 13);
    await key('Escape', 'Escape', 27);
    await waitFor(`document.querySelectorAll('${SEL} path.shape-elem[data-shape-id]').length === 4`, 'the 4 fillet arcs');
    const sources = await lines();
    assert.strictEqual(sources.length, 4, 'still 4 (trimmed) sides');
    const sourceIds = new Set(sources.map((l) => l.id));

    // ---- Offset 3 OUTSIDE: a pick on the top side, the cursor above it
    const top = sources.reduce((p, q) => (Math.min(q.a.y, q.b.y) < Math.min(p.a.y, p.b.y) && Math.abs(q.a.y - q.b.y) < 1e-6 ? q : p), sources.find((l) => Math.abs(l.a.y - l.b.y) < 1e-6));
    const midTop = { x: (top.a.x + top.b.x) / 2, y: (top.a.y + top.b.y) / 2 };
    const centreW = (() => { const xs = sources.flatMap((l) => [l.a.x, l.b.x]), ys = sources.flatMap((l) => [l.a.y, l.b.y]); return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }; })();
    const outward = Math.sign(midTop.y - centreW.y);
    await tool('tool-offset');
    await tap(await toScreen({ x: midTop.x - 10, y: midTop.y }));
    await boxOpen('offset-distance-input');
    await hover(await toScreen({ x: midTop.x - 8, y: midTop.y + outward * 8 }));
    await typeIn('offset-distance-input', '3');
    await key('Enter', 'Enter', 13);
    await key('Escape', 'Escape', 27);
    assert.strictEqual(await arcCount(), 8, 'the copy has its 4 arcs');

    // THE gap of every copy line from the source line parallel to it (perpendicular distance of both copy ends)
    const gaps = async () => {
      const ls = await lines(), src = ls.filter((l) => sourceIds.has(l.id)), copy = ls.filter((l) => !sourceIds.has(l.id));
      assert.strictEqual(copy.length, 4, `the copy has 4 lines: ${JSON.stringify(copy)}`);
      return copy.flatMap((c) => {
        const cu = { x: c.b.x - c.a.x, y: c.b.y - c.a.y };
        const s = src.find((l) => Math.abs((l.b.x - l.a.x) * cu.y - (l.b.y - l.a.y) * cu.x) < 1e-6 * Math.hypot(cu.x, cu.y) * Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y) && (src.filter((m) => m !== l).every((m) => dist(c.a, m) >= dist(c.a, l))));
        return [dist(c.a, s), dist(c.b, s)];
      });
    };
    const dist = (q, l) => { const ux = l.b.x - l.a.x, uy = l.b.y - l.a.y; return Math.abs(((q.x - l.a.x) * uy - (q.y - l.a.y) * ux) / Math.hypot(ux, uy)); };
    const allAt = (g, d) => g.every((v) => Math.abs(v - d) < 1e-4);
    const g3 = await gaps();
    assert(allAt(g3, 3), `the copy is 3 from its source on every side: ${g3.map((v) => v.toFixed(5)).join(' ')}`);
    const offsetLabel = async () => { const ls = await labels(); return ls.reduce((p, q) => (q.idx > p.idx ? q : p), ls[0]); };
    const l3 = await offsetLabel();
    assert(/^3(\.0+)?\s*(mm)?$/.test(l3.text), `the offset dimension reads 3: ${JSON.stringify(l3)}`);
    console.log(`made: rounded rectangle R 5, offset 3 outside, gaps ${g3.map((v) => v.toFixed(4)).join(' ')}, label "${l3.text}"`);
    const box = async () => {
      const ls = await lines(), xs = ls.flatMap((l) => [l.a.x, l.b.x]), ys = ls.flatMap((l) => [l.a.y, l.b.y]);
      const p0 = await toScreen({ x: Math.min(...xs), y: Math.min(...ys) }), p1 = await toScreen({ x: Math.max(...xs), y: Math.max(...ys) });
      return { x: Math.max(0, Math.min(p0.x, p1.x) - 60), y: Math.max(0, Math.min(p0.y, p1.y) - 60), width: Math.abs(p1.x - p0.x) + 120, height: Math.abs(p1.y - p0.y) + 120 };
    };
    await tool('tool-select');
    await shot('1-before-edit-offset-3.png', await box());

    // ---- double click the offset dimension, 5, Enter: the copy moves to 5 on every side
    await sleep(600);
    await double(await centerOf(`${SEL} .dim-label[data-constraint-idx="${l3.idx}"]`));
    await boxOpen('dimInput');
    await typeIn('dimInput', '5');
    await key('Enter', 'Enter', 13);
    await sleep(400);
    const g5 = await gaps();
    const l5 = await offsetLabel();
    await shot('2-after-edit-offset-5.png', await box());
    assert(/^5(\.0+)?\s*(mm)?$/.test(l5.text), `the offset dimension reads 5: ${JSON.stringify(l5)}`);
    assert(allAt(g5, 5), `after 5: the copy is 5 from its source on every side: ${g5.map((v) => v.toFixed(5)).join(' ')}`);
    console.log(`edited 3 -> 5: gaps ${g5.map((v) => v.toFixed(4)).join(' ')}, label "${l5.text}"`);

    // ---- Undo -> 3, Redo -> 5 (the footer buttons)
    await tap(await centerOf('#btn-undo')); await sleep(300);
    const gu = await gaps();
    assert(allAt(gu, 3), `Undo: the copy is 3 from its source again: ${gu.map((v) => v.toFixed(5)).join(' ')}`);
    await tap(await centerOf('#btn-redo')); await sleep(300);
    const gr = await gaps();
    assert(allAt(gr, 5), `Redo: the copy is 5 from its source: ${gr.map((v) => v.toFixed(5)).join(' ')}`);
    console.log('undo -> 3, redo -> 5');
    console.log('offset-781-live.test.js: ok');
  } finally { await cdp.close(); }
})();
