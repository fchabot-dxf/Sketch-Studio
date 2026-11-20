// tests/keyhole-constraint-highlight-820-live.test.js -- TASK 820 in the REAL SketchStudio (headless, real mouse via CDP): a keyhole (a circle arc
// and two lines sharing the arc's end joints). Hovering / selecting the VERTICAL glyph of the right line lights ONLY that line, never the arc
// (geometry-labels constraintTargets: the shape holding ALL the constraint's joints). Screenshots to EVIDENCE_DIR (EVIDENCE_TAG prefixes the names).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const J = (x, y) => ({ x, y, fixed: false, sketchId: 'sketch-1' });
const DOC = { version: 3, hosts: {}, geometry: {
  joints: [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }], ['kc', J(30, 25)], ['kp', J(27, 34)], ['kq', J(33, 34)], ['kr', J(27, 50)], ['ks', J(33, 50)]],
  shapes: [
    { id: 'kArc', type: 'arc', subType: 'CENTER', joints: ['kc', 'kq', 'kp'], sweep: true, sketchId: 'sketch-1', isConstruction: false },
    { id: 'kLeft', type: 'line', joints: ['kp', 'kr'], sketchId: 'sketch-1', isConstruction: false },
    { id: 'kRight', type: 'line', joints: ['kq', 'ks'], sketchId: 'sketch-1', isConstruction: false },
    { id: 'kBottom', type: 'line', joints: ['kr', 'ks'], sketchId: 'sketch-1', isConstruction: false }],
  constraints: [{ type: 'vertical', joints: ['kq', 'ks'] }],
  sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }], activeSketchId: 'sketch-1', groups: [], profiles: [], parameters: [] } };

await (async () => {
  const cdp = await launchBrowser({ tag: '820k' });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, navigate, waitForApp } = cdp;
  await installFakeDriveSession(cdp);
  try {
    const url = `http://127.0.0.1:${port}/apps/sketchstudio/index.html`;
    const mouse = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'none', buttons: 0, clickCount: 0 });
    await navigate(url, 8000); await waitForApp('svgCanvas');
    await evalJs(`(async () => { localStorage.clear(); localStorage.setItem('sketch-studio-settings', JSON.stringify({ GRID_MAGNETISM: 0.001, GLYPH_OFFSET_PX: 16, GLYPH_SYMBOL_SIZE_PX: 20 })); const dbs = indexedDB.databases ? await indexedDB.databases() : []; await Promise.all(dbs.map(d => new Promise(r => { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = () => r(); }))); return true; })()`);
    await navigate(url, 8000); await waitForApp('svgCanvas');
    await evalJs(`import('/packages/ui/project-store.js').then(async (m) => { const s = m.getProjectStore(); const d = await s.newDesign('Task 820 keyhole', { app: 'sketchstudio' }); await s.save(${JSON.stringify(DOC)}, { app: 'sketchstudio', id: d.id }); return d.id; })`);
    await navigate(url, 8000); await waitForApp('svgCanvas'); await sleep(600);
    await evalJs(`document.getElementById('tool-select').click()`); await sleep(150);
    const geo = () => evalJs(`(() => { const ls = {}; const tok = (s) => ((s || '').match(/var\\((--sk-[a-z-]+)/) || [])[1] || null;
      for (const e of document.querySelectorAll('#svgCanvas .shape-elem')) ls[e.dataset.shapeId] = (ls[e.dataset.shapeId] || '') + (tok(e.getAttribute('style')) || '');
      const g = document.querySelector('#svgCanvas g.constraint-glyph[data-ctype="vertical"][data-cj0="kq"]'); const r = g && g.getBoundingClientRect();
      return JSON.stringify({ ls, glyph: r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null }); })()`).then(JSON.parse);
    const g0 = await geo();
    assert.ok(g0.glyph, 'the vertical glyph is drawn');
    assert.ok(g0.ls.kArc !== undefined && g0.ls.kRight !== undefined, 'the arc and the right line are drawn: ' + JSON.stringify(g0.ls));
    const G = { x: Math.round(g0.glyph.x), y: Math.round(g0.glyph.y) };
    await mouse('mouseMoved', G.x, G.y); await sleep(300);
    const s = await geo();
    const lit = Object.keys(s.ls).filter((id) => s.ls[id].includes('--sk-glyph-hover')).sort();
    console.log('glyph hovered: lit shapes [' + lit.join(' ') + '] tokens ' + JSON.stringify(s.ls));
    // the whole keyhole (all its shapes' boxes + the glyph) plus 30 px
    const bb = await evalJs(`(() => { const bs = [...document.querySelectorAll('#svgCanvas .shape-elem, #svgCanvas .constraint-glyph')].map((e) => e.getBoundingClientRect());
      const l = Math.min(...bs.map((b) => b.left)) - 30, t = Math.min(...bs.map((b) => b.top)) - 30; return JSON.stringify({ x: l, y: t, w: Math.max(...bs.map((b) => b.right)) + 30 - l, h: Math.max(...bs.map((b) => b.bottom)) + 30 - t }); })()`).then(JSON.parse);
    const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: bb.x, y: bb.y, width: bb.w, height: bb.h, scale: 1.5 } });
    const buf = Buffer.from(r.data, 'base64');
    const name = (process.env.EVIDENCE_TAG || 'after') + '-keyhole-hover.png';
    if (process.env.EVIDENCE_DIR) fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name), buf);
    console.log('screenshot ' + name + ' md5 ' + createHash('md5').update(buf).digest('hex'));
    assert.deepStrictEqual(lit, ['kRight'], 'hovering the vertical glyph of the right line lights only that line, not the arc');
    console.log('keyhole-constraint-highlight-820-live.test.js: ok');
  } finally { await cdp.close(); }
})();
