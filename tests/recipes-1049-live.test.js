// tests/recipes-1049-live.test.js — TASK 1049 (live headless, real mouse and real touch via CDP, SketchStudio desktop 1280 x 800 and phone 390 x 844):
// the rectangle and slot RECIPES built like Fusion 360 (audit 1037 D-2, D-3, D-6). Each device draws, through the ribbon's variant rows:
//   a Center Rectangle   -> Horizontal on its first side + 1 Perpendicular + 2 Parallel (+ the centre on its 2 diagonals); glyphs H, perpendicular,
//                           parallel, no vertical
//   a 3-Point Rectangle  -> 1 Perpendicular + 2 Parallel (was 4 perpendiculars)
//   a slot, width clicked -> no width dimension (Fusion places none)
//   a slot, width TYPED 7 -> one driving width (diameter) dimension of 7, its label on the canvas
// The node twin (exact recipe mapping, DOF, the first edits, old files, undo): tests/recipes-1049-node.test.js. Screenshots: .evidence/1049/live-*.png
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const EVIDENCE_DIR = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), '.evidence', '1049');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const failures = [];
const check = (ok, msg) => { if (!ok) { failures.push(msg); console.log('  FAIL ' + msg); } else console.log('  ok ' + msg); };

async function run({ width, height, tag }) {
  const isPhone = width <= 640;
  const cdp = await launchBrowser({ tag: `1049-${tag}`, width, height });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
  const { port, send, evalJs, waitFor, waitForApp, navigate, close, flushAutosave } = cdp;
  const mouse = (type, p) => send('Input.dispatchMouseEvent', { type, x: Math.round(p.x), y: Math.round(p.y), button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: type === 'mouseMoved' ? 0 : 1 });
  const touch = (type, p) => send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(p.x), y: Math.round(p.y), id: 1, radiusX: 1, radiusY: 1, force: 1 }] });
  const move = async (p) => { if (!isPhone) { await mouse('mouseMoved', p); await sleep(60); } };
  const tap = async (p) => {
    if (isPhone) { await touch('touchStart', p); await sleep(60); await touch('touchEnd', p); }
    else { await mouse('mouseMoved', p); await sleep(50); await mouse('mousePressed', p); await sleep(40); await mouse('mouseReleased', p); }
    await sleep(250);
  };
  const esc = async () => { await sendRealKey(send, 'Escape', 'Escape', 27, 0, ''); await sleep(150); };
  const typeText = async (text) => { for (const ch of text) await sendRealKey(send, ch, /\d/.test(ch) ? 'Digit' + ch : ch, ch.charCodeAt(0), 0, ch); await sleep(120); };
  const readDoc = async () => {
    await flushAutosave();
    return evalJs(`import('/packages/ui/project-store.js').then(async (m) => { const buf = await m.getProjectStore().readBuffer(); const t = buf && buf.tabs ? (buf.tabs[buf.active || 0] || buf.tabs[0]) : null; return t && t.doc ? t.doc.geometry : null; })`);
  };
  const rectOf = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2) }; })()`);
  const shot = async (name, pts, pad = 50) => {
    await sleep(250);
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const x = Math.max(0, Math.min(...xs) - pad), y = Math.max(0, Math.min(...ys) - pad);
    const clip = { x, y, width: Math.min(width - x, Math.max(...xs) - Math.min(...xs) + 2 * pad), height: Math.min(height - y, Math.max(...ys) - Math.min(...ys) + 2 * pad), scale: isPhone ? 2 : 2.5 };
    const { data } = await send('Page.captureScreenshot', { format: 'png', clip });
    const file = path.join(EVIDENCE_DIR, `live-${name}-${tag}.png`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    console.log('  screenshot', path.relative(process.cwd(), file));
  };
  const glyphCount = () => evalJs(`(() => { const m = {}; for (const g of document.querySelectorAll('#svgCanvas g.constraint-glyph')) { if (g.closest('[data-preview]')) continue; const t = g.getAttribute('data-ctype'); m[t] = (m[t] || 0) + 1; } return m; })()`);
  /** the tool's button (or its row in its section's dropdown when the bar has no room), then the variant's row in its menu */
  const pickVariant = async (tool, variant) => {
    const hidden = await evalJs(`(() => { const b = document.getElementById('tool-${tool}'); return !b || b.hidden || b.getBoundingClientRect().width === 0; })()`);
    if (hidden) {
      const section = await evalJs(`document.getElementById('tool-${tool}').closest('.sk-ribbon-group').dataset.section`);
      const sec = await rectOf(`.sk-ribbon-group[data-section="${section}"] .sk-ribbon-group-label`);
      await tap({ x: sec.cx, y: sec.cy });
      await waitFor(`!!document.querySelector('.sk-ribbon-sect-menu.show')`, 'the section dropdown');
      const row = await rectOf(`.sk-ribbon-sect-menu.show .sk-ribbon-sect-item[data-id="tool-${tool}"]`);
      await tap({ x: row.cx, y: row.cy });
    } else {
      const b = await rectOf(`#tool-${tool}`);
      await tap({ x: b.cx, y: b.cy });
    }
    await waitFor(`!!document.querySelector('.sk-ribbon-menu.show [data-mode="${variant}"]')`, `the ${tool} variant menu`);
    const row = await rectOf(`.sk-ribbon-menu.show [data-mode="${variant}"]`);
    await tap({ x: row.cx, y: row.cy });
    await waitFor(`!document.querySelector('.sk-ribbon-menu.show')`, 'the variant menu closed');
  };
  const added = (before, after) => after.constraints.slice(before.constraints.length);
  const kinds = (cs) => cs.map((c) => c.type).sort().join(',');

  try {
    if (isPhone) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    }
    await resetBufferLive(cdp);
    await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 10000);
    await waitForApp('svgCanvas');
    await sleep(300);
    const r = await evalJs(`(() => { const r = document.getElementById('svgCanvas').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`);
    const at = (fx, fy) => ({ x: Math.round(r.l + r.w * fx), y: Math.round(r.t + r.h * fy) });   // off the axes (the origin is near the canvas centre)
    let g0 = (await readDoc()) || { constraints: [] };   // a fresh buffer has no document yet

    // 1. Center Rectangle
    await pickVariant('rect', 'rect-center');
    const cr = [at(0.22, 0.27), at(0.36, 0.36)];
    for (const p of cr) { await move(p); await tap(p); }
    await esc(); await esc();
    let g = await readDoc();
    const crC = added(g0, g);
    check(kinds(crC) === 'horizontal,parallel,parallel,perpendicular,pointOnLine,pointOnLine', `[${tag}] Center Rectangle: H + perpendicular + 2 parallel + the centre's 2 pointOnLine (${kinds(crC)}; was H, V, H, V)`);
    let gl = await glyphCount();
    check(gl.horizontal === 1 && !gl.vertical && gl.perpendicular >= 1 && gl.parallel >= 2, `[${tag}] Center Rectangle glyphs: ${JSON.stringify(gl)} (H, perpendicular, parallel; no vertical)`);
    await shot('rect-center', [{ x: 2 * cr[0].x - cr[1].x, y: 2 * cr[0].y - cr[1].y }, cr[1]]);

    // 2. 3-Point Rectangle
    g0 = g;
    await pickVariant('rect', 'rect-3pt');
    const tr = [at(0.6, 0.2), at(0.82, 0.26), at(0.79, 0.38)];
    for (const p of tr) { await move(p); await tap(p); }
    await esc(); await esc();
    g = await readDoc();
    const trC = added(g0, g);
    check(kinds(trC) === 'parallel,parallel,perpendicular', `[${tag}] 3-Point Rectangle: 1 perpendicular + 2 parallel (${kinds(trC)}; was 4 perpendicular)`);
    const gl2 = await glyphCount(), more = (k) => (gl2[k] || 0) - (gl[k] || 0);
    check(more('perpendicular') >= 1 && more('parallel') >= 2 && more('perpendicular') < 8, `[${tag}] 3-Point Rectangle glyphs added: perpendicular ${more('perpendicular')}, parallel ${more('parallel')} (was perpendicular 8)`);
    await shot('rect-3pt', [...tr, { x: tr[0].x + tr[2].x - tr[1].x, y: tr[0].y + tr[2].y - tr[1].y }]);

    // 3. a slot, the width clicked: no width dimension
    g0 = g;
    await pickVariant('slot', 'slot-c2c');
    const su = [at(0.15, 0.62), at(0.38, 0.62), at(0.38, 0.67)];
    for (const p of su) { await move(p); await tap(p); }
    await esc(); await esc();
    g = await readDoc();
    const suC = added(g0, g);
    check(suC.length > 0 && !suC.some((c) => c.type === 'distance'), `[${tag}] slot, width clicked: NO width dimension (${kinds(suC)})`);
    await shot('slot-clicked', [su[0], su[1], { x: su[0].x, y: 2 * su[0].y - su[2].y }, su[2]]);

    // 4. a slot, the width TYPED 7 (then Enter): its driving width dimension
    g0 = g;
    await pickVariant('slot', 'slot-c2c');
    const st = [at(0.6, 0.62), at(0.83, 0.62), at(0.83, 0.67)];
    await move(st[0]); await tap(st[0]); await move(st[1]); await tap(st[1]); await move(st[2]);
    const focused = await evalJs(`(() => { const a = document.activeElement; return a ? a.id : null; })()`);
    if (focused !== 'dimInput') { const box = await rectOf('#dimInput'); if (box) await tap({ x: box.cx, y: box.cy }); }
    await evalJs(`(() => { const i = document.getElementById('dimInput'); if (i) { i.focus(); i.select(); } return !!i; })()`);
    await typeText('7');
    await sendRealKey(send, 'Enter', 'Enter', 13, 0, '\r'); await sleep(300);
    await esc(); await esc();
    g = await readDoc();
    const stC = added(g0, g);
    const wd = stC.filter((c) => c.type === 'distance');
    check(wd.length === 1 && wd[0].isDiameter && !wd[0].isDriven && Math.abs(wd[0].value - 7) < 1e-9, `[${tag}] slot, width TYPED 7: ONE driving width dimension (${JSON.stringify(wd.map((c) => ({ v: c.value, dia: !!c.isDiameter, driven: !!c.isDriven })))})`);
    const label = await evalJs(`[...document.querySelectorAll('#svgCanvas text')].map((t) => t.textContent.trim()).filter((t) => /7/.test(t) && /Ø|⌀/.test(t))`);
    check(label.length >= 1, `[${tag}] its label is on the canvas (${JSON.stringify(label)})`);
    const lab = await evalJs(`(() => { const t = [...document.querySelectorAll('#svgCanvas text')].find((e) => /7/.test(e.textContent) && /Ø/.test(e.textContent)); if (!t) return null; const b = t.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    await shot('slot-typed', [st[0], st[1], { x: st[0].x, y: st[0].y - 40 }, { x: st[1].x, y: st[1].y + 40 }, ...(lab ? [lab] : [])], 40);
  } finally {
    await close();
  }
}

await run({ width: 1280, height: 800, tag: 'desktop' });
await run({ width: 390, height: 844, tag: 'phone' });
assert.deepStrictEqual(failures, [], `${failures.length} check(s) failed`);
console.log('recipes-1049-live: PASS');
