// tests/mirror-live-sketchstudio.test.js - TASK 585 live (SketchStudio, headless browser, REAL pointer events and keys): the MIRROR tool.
// Draw a two-line chain and a circle left of the Y axis; with the Select tool click line 1, Shift+click line 2 and the circle (the pre-selection);
// the ribbon's Mirror (Create group) starts at the mirror-LINE step; click the Y axis (it lights up); Enter -> the mirrored copies right of the axis,
// linked by 4 symmetric constraints about the Y axis (2 + the corner's 1 point links, 1 circle link) and nothing else; Ctrl+Z removes the whole mirror
// in ONE step, Ctrl+Y brings back the identical document. EVIDENCE_DIR (optional): cropped screenshots of the ribbon's Create group and of the canvas
// before / after.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';
import { CREATE_NAMED_DESIGN } from './helpers/named-design.js';

const h = await launchBrowser({ tag: '585', width: 1600, height: 900 });
if (!h) { console.log('skipped: no headless Edge/Chrome binary installed'); } else {
  let failed = null;
  try {
    const { send, evalJs, navigate, port } = h;
    const url = `http://127.0.0.1:${port}/apps/sketchstudio/index.html`;
    const canvas = 'svgCanvas';
    const EVID = process.env.EVIDENCE_DIR || '';
    const shot = async (name, clip) => { const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h, scale: 2 } }); if (EVID) { fs.mkdirSync(EVID, { recursive: true }); fs.writeFileSync(path.join(EVID, name), Buffer.from(r.data, 'base64')); } };
    const mouse = (type, x, y, buttons = 0, modifiers = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: (buttons || type === 'mouseReleased') ? 'left' : 'none', buttons, clickCount: type === 'mouseMoved' ? 0 : 1, modifiers });
    const move = async (x, y) => { await mouse('mouseMoved', x, y); await sleep(60); };
    const click = async (p, shift = false) => { const m = shift ? 8 : 0; await move(p.x, p.y); await mouse('mousePressed', p.x, p.y, 1, m); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0, m); await sleep(180); };
    const key = async (k, code, vk, mod = 0, text = '') => { await sendRealKey(send, k, code, vk, mod, text); await sleep(250); };
    const esc = () => key('Escape', 'Escape', 27);
    const enter = () => key('Enter', 'Enter', 13, 0, '\r');
    const undo = () => key('z', 'KeyZ', 90, 2);
    const redo = () => key('y', 'KeyY', 89, 2);
    const tool = async (name) => { await evalJs(`document.getElementById('tool-${name}').click()`); await sleep(200); };
    const storedDoc = () => evalJs(`new Promise((res) => {
      const open = indexedDB.open('sketch-studio-projects', 1); open.onerror = () => res(null);
      open.onsuccess = () => { const db = open.result; const m = db.transaction('meta').objectStore('meta').get('currentDesign');
        m.onsuccess = () => { if (!m.result) { res(null); return; } const g = db.transaction('designs').objectStore('designs').get(m.result); g.onsuccess = () => { const d = g.result && g.result.document; res(d ? JSON.stringify({ shapes: d.geometry.shapes, constraints: d.geometry.constraints, joints: d.geometry.joints }) : null); }; }; };
    })`).then((s) => s && JSON.parse(s));
    const waitSaved = async () => { await sleep(300); for (let i = 0; i < 40; i++) { if (await evalJs(`document.querySelector('[data-doc-ready]').dataset.saveState === 'saved'`)) { await sleep(200); return; } await sleep(200); } };
    const readDoc = async () => { await sleep(1800); await waitSaved(); return storedDoc(); };
    const J = (d) => Object.fromEntries(d.joints.map((e) => (Array.isArray(e) ? e : [e.id, e])));
    const cleanCons = (d) => JSON.stringify(d.constraints.map(({ glyphPos, __pos, __visible, ...r }) => Object.fromEntries(Object.keys(r).sort().map((k) => [k, r[k]]))));
    const geom = (d) => JSON.stringify(d.shapes.map((s) => s.id)) + cleanCons(d) + JSON.stringify(d.joints.map((e) => (Array.isArray(e) ? [e[0], +e[1].x.toFixed(6), +e[1].y.toFixed(6)] : [e.id, +e.x.toFixed(6), +e.y.toFixed(6)])).sort());

    await navigate(url); await sleep(2500);
    await evalJs(`new Promise((res) => { const r = indexedDB.deleteDatabase('sketch-studio-projects'); r.onsuccess = r.onerror = r.onblocked = () => res(1); setTimeout(() => res(1), 1500); })`);
    await navigate(url); await sleep(2500);
    await evalJs(CREATE_NAMED_DESIGN('sketchstudio')); // only a NAMED design autosaves (the test reads the autosave)
    await navigate(url); await sleep(2500);
    const o = await evalJs(`(() => { const s = document.getElementById('${canvas}'); const p = s.createSVGPoint(); p.x = 0; p.y = 0; const q = p.matrixTransform(s.getScreenCTM()); return { x: Math.round(q.x), y: Math.round(q.y) }; })()`);
    const at = (dx, dy) => ({ x: o.x + dx, y: o.y + dy });
    const along = (a, b, t) => ({ x: Math.round(a.x + (b.x - a.x) * t), y: Math.round(a.y + (b.y - a.y) * t) });

    // ---- the ribbon: Mirror in the Create group
    const grp = await evalJs(`(() => { const b = document.getElementById('tool-mirror'); if (!b) return null; const g = b.closest('.sk-ribbon-group'); const r = g.getBoundingClientRect();
      return { label: g.querySelector('.sk-ribbon-group-label').textContent, x: Math.floor(r.x), y: Math.floor(r.y), w: Math.ceil(r.width), h: Math.ceil(r.height), text: b.textContent.trim() }; })()`);
    assert.ok(grp && grp.label === 'Create' && grp.text === 'Mirror', 'the ribbon has a Mirror button in the Create group: ' + JSON.stringify(grp));
    await shot('ribbon-create-mirror.png', { x: grp.x - 4, y: grp.y - 4, w: grp.w + 8, h: grp.h + 8 });

    // ---- the drawing (left of the Y axis, >= 60 px from both axes): a chain A1 - A2 - B2 (two lines, the corner joined) and a circle
    const A1 = at(-80, -260), A2 = at(-330, -260), B2 = at(-330, -80), C = at(-190, -150), R = 40;
    await tool('line'); await click(A1); await click(A2); await click(B2); await esc();
    await tool('circle'); await click(C); await click({ x: C.x + R, y: C.y }); await esc();
    await tool('select');
    const d0 = await readDoc();
    assert.strictEqual(d0.shapes.length, 3, 'drawn: two lines and a circle: ' + d0.shapes.map((s) => s.type).join(','));

    // ---- the pre-selection (real clicks, Shift adds), the ribbon's Mirror, the Y axis, Enter
    await click(along(A1, A2, 0.5)); await click(along(A2, B2, 0.5), true); await click({ x: C.x - R, y: C.y }, true);
    assert.strictEqual(await evalJs(`(() => { const b = document.getElementById('tool-mirror'); return b ? 1 : 0; })()`), 1);
    await tool('mirror');
    await move(at(0, 120).x, at(0, 120).y); await sleep(200);
    assert.ok(await evalJs(`document.querySelectorAll('[data-ref-axis="ref_axis_y"]').length`) > 0, 'the LINE step: the Y axis lights up under the pointer');
    await click(at(0, 120));
    await move(at(300, 200).x, at(300, 200).y); await sleep(200);
    assert.ok(await evalJs(`document.querySelectorAll('[data-ref-axis="ref_axis_y"]').length`) > 0, 'the picked Y axis stays lit (pointer away)');
    const cv = await evalJs(`(() => { const r = document.getElementById('${canvas}').getBoundingClientRect(); return { x: Math.floor(r.x), y: Math.floor(r.y), w: Math.floor(r.width), h: Math.floor(r.height) }; })()`);
    const view = { x: o.x - 420, y: o.y - 330, w: 840, h: 400 };
    const clip = { x: Math.max(cv.x, view.x), y: Math.max(cv.y, view.y), w: view.w, h: view.h };
    await shot('sketchstudio-mirror-before.png', clip);
    const before = await readDoc();
    assert.strictEqual(before.shapes.length, 3, 'nothing is made before Enter');
    await enter();
    const after = await readDoc();
    assert.strictEqual(after.shapes.length, 6, 'Enter: three copies: ' + after.shapes.map((s) => s.type).join(','));
    assert.strictEqual(await evalJs(`document.querySelector('.sk-ribbon-btn.active') && document.querySelector('.sk-ribbon-btn.active').id`), 'tool-select', 'the tool ends: Select is active');
    await shot('sketchstudio-mirror-after.png', clip);

    // ---- the copies: mirror images about the Y axis (x -> -x), the corner shared, linked only by symmetric constraints
    const j = J(after), [oA, oB, oK] = after.shapes.slice(0, 3), [cA, cB, cK] = after.shapes.slice(3);
    const mir = (id) => ({ x: -j[id].x, y: j[id].y });
    const near = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-6;
    assert.ok(cA.type === 'line' && near(j[cA.joints[0]], mir(oA.joints[0])) && near(j[cA.joints[1]], mir(oA.joints[1])), 'line 1 mirrored');
    assert.ok(cB.type === 'line' && near(j[cB.joints[1]], mir(oB.joints[1])), 'line 2 mirrored');
    assert.ok(cA.joints[1] === cB.joints[0], 'the copy\'s corner is one shared point');
    assert.ok(cK.type === 'circle' && near(j[cK.joints[0]], mir(oK.joints[0])) && Math.abs(cK.radius - oK.radius) < 1e-9, 'the circle mirrored, same radius');
    const added = after.constraints.slice(before.constraints.length);
    assert.ok(added.length === 4 && added.every((c) => c.type === 'symmetric' && c.line === 'ref_axis_y'), '4 new constraints, all symmetric about the Y axis: ' + JSON.stringify(added));
    console.log(`LIVE mirror: 3 copies, ${added.length} symmetric links about the Y axis`);

    // ---- ONE undo step; redo identical
    await undo();
    const un = await readDoc();
    assert.strictEqual(geom(un), geom(before), 'Ctrl+Z: the whole mirror is undone in ONE step (the document as before)');
    await redo();
    const re = await readDoc();
    assert.strictEqual(geom(re), geom(after), 'Ctrl+Y: the identical mirrored document');
    console.log('mirror-live-sketchstudio: ok');
  } catch (e) { failed = e; } finally {
    await h.close();
  }
  if (failed) { console.error(failed.stack || failed.message || failed); process.exitCode = 1; }
}
