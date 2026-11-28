// tests/polygon-1050-live.test.js — TASK 1050 (live headless, real mouse and real touch via CDP, SketchStudio desktop 1280 x 800 and phone 390 x 844):
// the POLYGON built like Fusion 360: each device draws a hexagon with the Polygon tool (centre, then a corner) and the stored document holds
// 6 lines, no construction line and ONE polygon constraint; the canvas shows ONE polygon glyph (no equal glyph); a tap on that glyph selects it
// and Delete (desktop: the Delete key; phone: the footer's red X) removes the constraint as a whole: the 6 lines stay, no glyph is left.
// The node twin (the recipe, DOF 4, no redundant row, drags, typed sizes, old files, undo): tests/polygon-1050-node.test.js.
// Screenshots: .evidence/1050/live-*.png
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const EVIDENCE_DIR = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), '.evidence', '1050');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const failures = [];
const check = (ok, msg) => { if (!ok) { failures.push(msg); console.log('  FAIL ' + msg); } else console.log('  ok ' + msg); };

async function run({ width, height, tag }) {
  const isPhone = width <= 640;
  const cdp = await launchBrowser({ tag: `1050-${tag}`, width, height });
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
  /** a tool's ribbon button (or its row in its section's dropdown when the bar has no room for it) */
  const pickTool = async (tool) => {
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
    await waitFor(`document.getElementById('tool-${tool}').classList.contains('active')`, `the ${tool} tool active`);
  };

  try {
    if (isPhone) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    }
    await resetBufferLive(cdp);
    await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 10000);
    await waitForApp('svgCanvas');
    await sleep(300);
    await evalJs(`(() => { try { localStorage.setItem('sk-polygon-sides', '6'); } catch (_) {} return true; })()`); // the remembered side count: a hexagon
    const r = await evalJs(`(() => { const r = document.getElementById('svgCanvas').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`);
    const at = (fx, fy) => ({ x: Math.round(r.l + r.w * fx), y: Math.round(r.t + r.h * fy) });   // off the axes (the origin is near the canvas centre)

    // 1. a hexagon with the Polygon tool: the centre, then a corner
    await pickTool('polygon');
    const c = at(0.3, 0.3), v = at(isPhone ? 0.48 : 0.4, 0.3);
    await move(c); await tap(c); await move(v); await tap(v);
    await esc(); await esc();
    const g = await readDoc();
    const polys = g.constraints.filter((k) => k.type === 'polygon');
    check(g.constraints.length === 1 && polys.length === 1, `[${tag}] ONE constraint, the polygon (Fusion: Polygon()): ${JSON.stringify(g.constraints.map((k) => k.type))}`);
    check(g.shapes.length === 6 && g.shapes.every((s) => s.type === 'line' && !s.isConstruction), `[${tag}] 6 lines, no construction line (was 6 dashed radii): ${g.shapes.length} shapes`);
    check(polys[0] && polys[0].joints.length === 7 && polys[0].shapes.length === 6, `[${tag}] the polygon constraint names the centre, the 6 corners and the 6 sides`);
    const gl = await glyphCount();
    check(gl.polygon === 1 && Object.keys(gl).length === 1, `[${tag}] ONE polygon glyph on the canvas, no equal glyph (${JSON.stringify(gl)}; was equal 20)`);
    const R = Math.hypot(v.x - c.x, v.y - c.y);
    const box = [{ x: c.x - R, y: c.y - R }, { x: c.x + R, y: c.y + R }];
    await shot('polygon', box, 30);
    const gr = await rectOf('#svgCanvas g.constraint-glyph[data-ctype="polygon"]');
    await shot('polygon-glyph', [{ x: gr.x, y: gr.y }, { x: gr.x + gr.w, y: gr.y + gr.h }, c], 24);

    // 2. a tap on the glyph selects it; Delete removes the polygon constraint as a whole (the lines stay)
    await pickTool('select');
    await tap({ x: gr.cx, y: gr.cy });
    const outline = await evalJs(`(() => { const e = document.querySelector('#svgCanvas g.constraint-glyph[data-ctype="polygon"] .fusion-glyph'); return e ? e.getAttribute('style') : null; })()`);
    console.log('  the glyph after the tap:', outline);
    await shot('polygon-glyph-selected', [{ x: gr.x, y: gr.y }, { x: gr.x + gr.w, y: gr.y + gr.h }, c], 24);
    if (isPhone) {
      const del = await rectOf('#btn-delete-selection');
      check(!!del && del.w > 0, `[${tag}] the footer Delete is there`);
      await tap({ x: del.cx, y: del.cy });
    } else {
      await sendRealKey(send, 'Delete', 'Delete', 46, 0, ''); await sleep(300);
    }
    const g2 = await readDoc();
    check(!g2.constraints.some((k) => k.type === 'polygon') && g2.constraints.length === 0, `[${tag}] Delete on the glyph removes the polygon constraint (${JSON.stringify(g2.constraints.map((k) => k.type))})`);
    check(g2.shapes.length === 6, `[${tag}] the 6 lines stay (${g2.shapes.length})`);
    const gl2 = await glyphCount();
    check(Object.keys(gl2).length === 0, `[${tag}] no glyph left (${JSON.stringify(gl2)})`);
    await shot('polygon-glyph-deleted', box, 30);
  } finally {
    await close();
  }
}

await run({ width: 1280, height: 800, tag: 'desktop' });
await run({ width: 390, height: 844, tag: 'phone' });
assert.deepStrictEqual(failures, [], `${failures.length} check(s) failed`);
console.log('polygon-1050-live: PASS');
