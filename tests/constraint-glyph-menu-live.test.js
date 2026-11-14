// tests/constraint-glyph-menu-live.test.js -- TASK 571 / 601 (was constraint-undo-glyph-live) live (SketchStudio, headless browser, REAL pointer events and keys).
// BUG 1 (one undo step per constraint) moved to tests/constraint-undo-steps-node.test.js (TASK 601); this file keeps BUG 2, which needs real pixels and a real touch:
// BUG 2: right-click on a constraint glyph that sits over geometry opens the CONSTRAINT menu (Delete constraint); right-click on the line
//        away from the glyph opens the line's menu (Lock / Delete).
import assert from 'node:assert';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';

const h = await launchBrowser({ tag: '571', width: 1600, height: 1000 });
if (!h) { console.log('skipped: no headless Edge/Chrome binary installed'); } else {
  let failed = null;
  try {
    const { send, evalJs, navigate, port } = h;
    const url = `http://127.0.0.1:${port}/apps/sketchstudio/index.html`;
    const canvas = 'svgCanvas';
    const mouse = (type, x, y, buttons = 0, button = null) => send('Input.dispatchMouseEvent', { type, x, y, button: button || ((buttons || type === 'mouseReleased') ? 'left' : 'none'), buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const move = async (x, y) => { await mouse('mouseMoved', x, y); await sleep(60); };
    const click = async (p) => { await move(p.x, p.y); await mouse('mousePressed', p.x, p.y, 1); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0); await sleep(180); };
    const rightClick = async (p) => { await move(p.x, p.y); await mouse('mousePressed', p.x, p.y, 2, 'right'); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0, 'right'); await sleep(250); };
    const key = async (k, code, vk, mod = 0) => { await sendRealKey(send, k, code, vk, mod); await sleep(250); };
    const esc = () => key('Escape', 'Escape', 27);
    const tool = async (name) => { await evalJs(`document.getElementById('tool-${name}').click()`); await sleep(200); };
    const menuIds = () => evalJs(`[...document.querySelectorAll('.sk-context-menu .sk-context-item')].map(e => e.dataset.id)`);

    await navigate(url); await sleep(2500);
    const o = await evalJs(`(() => { const s = document.getElementById('${canvas}'); const p = s.createSVGPoint(); p.x = 0; p.y = 0; const q = p.matrixTransform(s.getScreenCTM()); return { x: Math.round(q.x), y: Math.round(q.y) }; })()`);
    const at = (dx, dy) => ({ x: o.x + dx, y: o.y + dy });
    const along = (a, b, t) => ({ x: Math.round(a.x + (b.x - a.x) * t), y: Math.round(a.y + (b.y - a.y) * t) });
    const line = async (a, b) => { await tool('line'); await click(a); await click(b); await esc(); };

    // ---- drawing: two short lines either side of the Y axis (Symmetric, below), all >= 60 px from the axes
    const P1 = at(100, 170), P2 = at(190, 205), Q1 = at(-210, 120), Q2 = at(-130, 170);
    await line(P1, P2); await line(Q1, Q2);

    // ---- BUG 2: the Symmetric tool (two points about the Y axis) draws a glyph beside each point; the one by P1 lies ON its own line P1-P2
    await tool('symmetric'); await click(P1); await click(Q1); await click(at(3, 60)); await esc(); await tool('select');
    await move(at(700, -430).x, at(700, -430).y); await sleep(300);
    const gs = await evalJs(`[...document.querySelectorAll('#${canvas} .constraint-glyph[data-ctype="symmetric"]')].map(e => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })`);
    assert.strictEqual(gs.length, 2, 'two symmetric glyphs');
    const segDist = (p, a, b) => { const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / ((b.x - a.x) ** 2 + (b.y - a.y) ** 2))); return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y))); };
    const g = gs.slice().sort((u, v) => segDist(u, P1, P2) - segDist(v, P1, P2))[0];
    console.log(`glyph at ${g.x},${g.y}; ${segDist(g, P1, P2).toFixed(1)} px from its line P1-P2`);
    assert.ok(segDist(g, P1, P2) < 20, 'a symmetric glyph sits within the line pick reach (20 px) of its line P1-P2: geometry under it');
    await rightClick(g);
    assert.deepStrictEqual(await menuIds(), ['con-delete'], 'right-click on the glyph over its line: the constraint menu (Delete constraint)');
    await esc();
    assert.deepStrictEqual(await menuIds(), [], 'Escape closes it');
    await rightClick(along(P1, P2, Math.hypot(g.x - P1.x, g.y - P1.y) < Math.hypot(g.x - P2.x, g.y - P2.y) ? 0.9 : 0.1));
    assert.deepStrictEqual(await menuIds(), ['geo-lock', 'geo-delete'], 'right-click on the line away from the glyph: the line menu');
    await esc();
    // a pointer NEAR the glyph but not on the glyph (a point of the line 24 px from the glyph centre; the glyph is 10 px + 3 px margin) keeps the line menu
    const ux = (P2.x - P1.x) / Math.hypot(P2.x - P1.x, P2.y - P1.y), uy = (P2.y - P1.y) / Math.hypot(P2.x - P1.x, P2.y - P1.y);
    const t0 = (g.x - P1.x) * ux + (g.y - P1.y) * uy, dLine = segDist(g, P1, P2), dt = Math.sqrt(24 * 24 - dLine * dLine);
    const nearPt = [t0 + dt, t0 - dt].map((t) => ({ x: Math.round(P1.x + ux * t), y: Math.round(P1.y + uy * t) })).find((q) => segDist(q, P1, P2) < 1 && Math.hypot(q.x - g.x, q.y - g.y) > 22);
    assert.ok(nearPt, 'a point of the line 24 px from the glyph');
    await rightClick(nearPt);
    assert.deepStrictEqual(await menuIds(), ['geo-lock', 'geo-delete'], `mouse: right-click on the line ${Math.hypot(nearPt.x - g.x, nearPt.y - g.y).toFixed(1)} px from the glyph centre opens the line menu`);
    await esc();
    // the same by touch and hold (the finger on the glyph: its menu; the finger on the line beside it: the line's)
    // TASK 587: a coarse pointer makes the document-tab strip taller (a finger), so the canvas moves: read the glyph again and move the points by how far it moved
    const glyphNow = () => evalJs(`(() => { const e = [...document.querySelectorAll('#${canvas} .constraint-glyph[data-ctype="symmetric"]')].map((e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; }); return e; })()`);
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 }); await sleep(300);
    const g1 = (await glyphNow()).sort((u, v) => Math.hypot(u.x - g.x, u.y - g.y) - Math.hypot(v.x - g.x, v.y - g.y))[0];
    const dx = g1.x - g.x, dy = g1.y - g.y; console.log('touch layout shift', dx, dy);
    const hold = async (p) => { await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y, id: 1 }] }); await sleep(800); const ids = await menuIds(); await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(300); return ids; };
    assert.deepStrictEqual(await hold({ x: g.x + dx, y: g.y + dy }), ['con-delete'], 'touch hold on the glyph: the constraint menu');
    await esc();
    assert.deepStrictEqual(await hold({ x: nearPt.x + dx, y: nearPt.y + dy }), ['geo-lock', 'geo-delete'], 'touch hold on the line beside the glyph: the line menu');
    await esc();
    console.log('LIVE glyph over geometry: right-click picks the glyph, the line away from it keeps the line menu');
    console.log('constraint-glyph-menu-live: ok');
  } catch (e) { failed = e; } finally {
    await h.close();
  }
  if (failed) { console.error(failed.stack || failed.message || failed); process.exitCode = 1; }
}
