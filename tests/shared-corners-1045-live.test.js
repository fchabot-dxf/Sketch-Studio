// tests/shared-corners-1045-live.test.js — TASK 1045: SHARED CORNERS in a real browser, SketchStudio desktop 1280 x 800 (real mouse, the Delete key) and
// phone 390 x 844 (real touch, the footer Delete). Fusion, MEASURED by the advisor 2026-11-27: every drawing tool joins meeting ends with ONE shared
// point (rectangles: all 3; Line tool chains). Each device: a 2-point Rectangle (2 taps) and a Line chain (3 taps, Esc): the rectangle is 4 joints, the
// chain 3, no coincident anywhere; nothing selected: no glyph; a tap on a rectangle corner shows its ONE shared-point glyph (task 1041); desktop: a
// click on the glyph selects it and Delete splits the corner (one new joint, the corner keeps its other side); phone: the corner's menu (touch and
// hold) "Delete Coincident" splits it; the chain's middle point offers "Delete Coincident" in its menu (right click / touch and hold), which splits it.
// The node twin (every rectangle variant, the Line tool's ends, the other tools, close path, old files, undo): tests/shared-corners-1045-node.test.js.
// Evidence: .evidence/1045/live-<step>-<device>.png
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';

const EVIDENCE_DIR = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), '.evidence', '1045');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const failures = [];
const check = (ok, msg) => { if (!ok) { failures.push(msg); console.log('  FAIL ' + msg); } else console.log('  ok ' + msg); };

async function run({ width, height, tag }) {
  const isPhone = width <= 640;
  const cdp = await launchBrowser({ tag: `1045-${tag}`, width, height });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
  const { port, send, evalJs, waitForApp, navigate, close, flushAutosave } = cdp;
  const mouse = async (type, p) => send('Input.dispatchMouseEvent', { type, x: Math.round(p.x), y: Math.round(p.y), button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: type === 'mouseMoved' ? 0 : 1 });
  const touch = async (type, p) => send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(p.x), y: Math.round(p.y), id: 1, radiusX: 1, radiusY: 1, force: 1 }] });
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
  const shot = async (name, p, half = 80) => {
    await sleep(250);
    const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { x: Math.max(0, p.x - half), y: Math.max(0, p.y - half), width: 2 * half, height: 2 * half, scale: 3 } });
    const file = path.join(EVIDENCE_DIR, `live-${name}-${tag}.png`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    console.log('  screenshot', path.relative(process.cwd(), file));
  };
  const glyphs = (ctype) => evalJs(`[...document.querySelectorAll('#svgCanvas g.constraint-glyph[data-ctype="${ctype}"]')].filter((g) => !g.closest('[data-preview]') && g.style.pointerEvents !== 'none').map((g) => ({ shape: g.getAttribute('data-cshape') }))`);
  // a point ON the shared-point glyph's drawn icon (#ui/fusion-glyphs.js glyphPickHit), the nearest to its centre that is 30 px or more from the corner
  // (a press within the point's reach picks the point)
  const onIcon = (shapeId, from) => evalJs(`(async () => {
    const { glyphPickHit } = await import('/packages/ui/fusion-glyphs.js');
    const SM = (await import('/packages/core/settings-manager.js')).default, st = SM.getAll();
    const el = [...document.querySelectorAll('#svgCanvas g.constraint-glyph[data-ctype="sharedPointCoincident"]')].find((e) => e.getAttribute('data-cshape') === ${JSON.stringify(shapeId)});
    if (!el) return null;
    const m = el.getAttribute('transform').replace('translate(', '').replace(')', '').split(',');
    const svg = document.getElementById('svgCanvas'), pt = svg.createSVGPoint(); pt.x = +m[0]; pt.y = +m[1];
    const c = pt.matrixTransform(el.parentNode.getScreenCTM());
    let best = null;
    for (let dx = -14; dx <= 14; dx++) for (let dy = -14; dy <= 14; dy++) {
      if (!glyphPickHit('sharedPointCoincident', dx, dy, Number(st.GLYPH_SYMBOL_SIZE_PX), Number(st.GLYPH_OUTLINE_PX), ${isPhone})) continue;
      const x = Math.round(c.x + dx), y = Math.round(c.y + dy), d = Math.hypot(x - ${from.x}, y - ${from.y}), k = Math.hypot(dx, dy);
      if (d >= 30 && (!best || k < best.k)) best = { x, y, d, k };
    } return best; })()`);
  const toScreen = (w) => evalJs(`(() => { const svg = document.getElementById('svgCanvas'), pt = svg.createSVGPoint(); pt.x = ${w.x}; pt.y = ${w.y}; const g = svg.querySelector('g'); const p = pt.matrixTransform((g || svg).getScreenCTM()); return { x: Math.round(p.x), y: Math.round(p.y) }; })()`);
  // the point's menu: desktop right click, phone touch and hold
  const menuOn = async (q) => {
    if (isPhone) { await touch('touchStart', q); await sleep(650); await touch('touchEnd', q); await sleep(300); }
    else { await mouse('mouseMoved', q); await sleep(60); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: q.x, y: q.y, button: 'right', buttons: 2, clickCount: 1 }); await sleep(40); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: q.x, y: q.y, button: 'right', buttons: 0, clickCount: 1 }); await sleep(300); }
  };
  const deleteCoincidentItem = () => evalJs(`(() => { const e = document.querySelector('.sk-context-menu .sk-context-item[data-id="geo-delete-coincident"]'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: e.textContent.trim() }; })()`);
  const used = (g) => new Set(g.shapes.flatMap((s) => s.joints));
  const curvesAt = (g, id) => g.shapes.filter((s) => s.joints.includes(id));
  const posOf = (g, id) => g.joints.find(([x]) => x === id)[1];

  try {
    await installFakeDriveSession(cdp);
    if (isPhone) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    }
    await resetBufferLive(cdp);
    await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 10000);
    await waitForApp('svgCanvas');
    await sleep(300);
    const r = await evalJs(`(() => { const r = document.getElementById('svgCanvas').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`);
    const at = (fx, fy) => ({ x: Math.round(r.l + r.w * fx), y: Math.round(r.t + r.h * fy) });

    // 1. a 2-point rectangle and a Line chain
    await pressRibbonTool(evalJs, tap, 'tool-rect');
    await tap(at(0.1, 0.5)); await tap(at(0.3, 0.65)); await esc(); await esc();   // off the axes (the origin is near the canvas centre)
    await pressRibbonTool(evalJs, tap, 'tool-line');
    await tap(at(0.6, 0.6)); await tap(at(0.8, 0.6)); await tap(at(0.75, 0.75)); await esc(); await esc();
    let g = await readDoc();
    const rect = g.shapes.filter((s) => s.groupId && s.groupId.startsWith('rect_'));
    const chain = g.shapes.filter((s) => s.type === 'line' && !(s.groupId && s.groupId.startsWith('rect_')));
    const rectJoints = new Set(rect.flatMap((s) => s.joints)), chainJoints = new Set(chain.flatMap((s) => s.joints));
    check(rect.length === 4 && rectJoints.size === 4, `[${tag}] the rectangle: 4 sides on 4 SHARED corner joints (${rect.length} sides, ${rectJoints.size} joints)`);
    check(chain.length === 2 && chainJoints.size === 3 && chain[0].joints[1] === chain[1].joints[0], `[${tag}] the chain: 2 segments sharing their middle point (${chainJoints.size} joints)`);
    check(!g.constraints.some((c) => c.type === 'coincident'), `[${tag}] no coincident constraint anywhere (${g.constraints.map((c) => c.type).join(',')})`);
    check((await glyphs('sharedPointCoincident')).length === 0, `[${tag}] nothing selected: no shared-point glyph`);
    const cornerId = rect[0].joints[1], corner = await toScreen(posOf(g, cornerId));
    await shot('rect-drawn', corner);

    // 2. a tap on the corner: ONE shared-point glyph. Desktop: a click on the glyph selects it and the Delete key splits the corner. Phone: the corner's
    //    menu (touch and hold) "Delete Coincident" splits it (a tap on the glyph beside the just-tapped corner picks the corner again on the phone:
    //    reported in the task 1045 REPORT, not this task's)
    await tap(corner);   // Esc twice above left the drawing tool: the Select tool picks
    const shown = await glyphs('sharedPointCoincident');
    check(shown.length === 1, `[${tag}] the corner tapped: its ONE shared-point glyph shows (${shown.length})`);
    await shot('corner-glyph', corner);
    const before = used(g).size;
    if (!isPhone) {
      const p = shown.length ? await onIcon(shown[0].shape, corner) : null;
      check(!!p, `[${tag}] the glyph is on screen (a point on its icon ${p && Math.round(p.d)} px from the corner)`);
      if (p) { await tap(p); await shot('glyph-selected', corner); await sendRealKey(send, 'Delete', 'Delete', 46, 0, ''); await sleep(300); }
    } else {
      await esc();
      await menuOn(corner);
      const item = await deleteCoincidentItem();
      check(!!item && /Delete Coincident/.test(item.text), `[${tag}] the corner's menu offers "Delete Coincident" (${item && item.text})`);
      if (item) await tap(item);
    }
    g = await readDoc();
    check(used(g).size === before + 1 && curvesAt(g, cornerId).length === 1, `[${tag}] the corner is SPLIT: one new joint (${before} -> ${used(g).size}), the corner keeps one side (${curvesAt(g, cornerId).length})`);
    await esc();
    await shot('corner-split', corner);

    // 3. the chain's middle point: its menu's "Delete Coincident" splits it
    const midId = chain[0].joints[1], mid = await toScreen(posOf(g, midId));
    await menuOn(mid);
    const item = await deleteCoincidentItem();
    check(!!item && /Delete Coincident/.test(item.text), `[${tag}] the chain point's menu offers "Delete Coincident" (${item && item.text})`);
    if (item) {
      const n = used(g).size;
      await tap(item);
      const g2 = await readDoc();
      check(used(g2).size === n + 1 && curvesAt(g2, midId).length === 1, `[${tag}] Delete Coincident splits the chain point (${n} -> ${used(g2).size} joints)`);
      await esc();
      await shot('chain-split', mid);
    }
  } finally {
    await close();
  }
}

await run({ width: 1280, height: 800, tag: 'desktop' });
await run({ width: 390, height: 844, tag: 'phone' });
assert.deepStrictEqual(failures, [], `${failures.length} check(s) failed`);
console.log('shared-corners-1045-live: PASS');
