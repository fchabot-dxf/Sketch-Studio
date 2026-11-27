// tests/split-shared-point-1041-live.test.js — TASK 1041: SPLIT A SHARED POINT (Fusion's SharedPointCoincident, #core/shared-point.js) in a real
// browser, SketchStudio desktop 1280 x 800 (real mouse, the Delete key, Ctrl+Z) and phone 390 x 844 (real touch, the footer Delete).
// Each device: a Polygon (its first corner is ONE joint shared by 2 sides + the construction radius), then a Line from that corner (a SEPARATE
// joint glued on by a coincident: the mixed stack Fusion measured). Nothing selected: no glyph at the corner. A press on the corner (it picks one
// of the two stacked points) shows BOTH kinds side by side: the 2 shared-point glyphs (n - 1 of 3 curves) and the line's coincident (BUG-410:
// every glyph of the spot, whichever stacked point the press picked). A press on a shared-point glyph selects it; Delete splits the point (one new
// joint, the line stays glued); a drag of the corner then pulls the detached side apart; Undo twice puts the shared corner back. Then the point's
// menu (right click / touch and hold) "Delete Coincident" (Fusion, owner-checked) unjoins the whole spot in one step.
// The node twin (every shape kind, the attachment rule, ids, DOF, save + reload): tests/split-shared-point-1041-node.test.js.
// Evidence: .evidence/1041/live-<step>-<device>.png
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';

const EVIDENCE_DIR = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), '.evidence', '1041');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const failures = [];
const check = (ok, msg) => { if (!ok) { failures.push(msg); console.log('  FAIL ' + msg); } else console.log('  ok ' + msg); };

async function run({ width, height, tag }) {
  const isPhone = width <= 640;
  const cdp = await launchBrowser({ tag: `1041-${tag}`, width, height });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
  const { port, send, evalJs, waitForApp, navigate, close, flushAutosave } = cdp;
  const mouse = async (type, p) => send('Input.dispatchMouseEvent', { type, x: Math.round(p.x), y: Math.round(p.y), button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' || p.held ? 1 : 0, clickCount: type === 'mouseMoved' ? 0 : 1 });
  const touch = async (type, p) => send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(p.x), y: Math.round(p.y), id: 1, radiusX: 1, radiusY: 1, force: 1 }] });
  const tap = async (p) => {
    if (isPhone) { await touch('touchStart', p); await sleep(60); await touch('touchEnd', p); }
    else { await mouse('mouseMoved', p); await sleep(50); await mouse('mousePressed', p); await sleep(40); await mouse('mouseReleased', p); }
    await sleep(250);
  };
  const drag = async (a, b, steps = 12) => {
    if (isPhone) { await touch('touchStart', a); await sleep(40); for (let i = 1; i <= steps; i++) { await touch('touchMove', { x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps }); await sleep(30); } await touch('touchEnd', b); }
    else { await mouse('mouseMoved', a); await sleep(40); await mouse('mousePressed', a); for (let i = 1; i <= steps; i++) { await mouse('mouseMoved', { x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps, held: true }); await sleep(30); } await mouse('mouseReleased', b); }
    await sleep(300);
  };
  const esc = async () => { await sendRealKey(send, 'Escape', 'Escape', 27, 0, ''); await sleep(150); };
  const readDoc = async () => {
    await flushAutosave();
    return evalJs(`import('/packages/ui/project-store.js').then(async (m) => { const buf = await m.getProjectStore().readBuffer(); const t = buf && buf.tabs ? (buf.tabs[buf.active || 0] || buf.tabs[0]) : null; return t && t.doc ? t.doc.geometry : null; })`);
  };
  // a crop around the corner at 3x so the glyphs are legible
  const shot = async (name, p, half = 70) => {
    await sleep(250);
    const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { x: Math.max(0, p.x - half), y: Math.max(0, p.y - half), width: 2 * half, height: 2 * half, scale: 3 } });
    const file = path.join(EVIDENCE_DIR, `live-${name}-${tag}.png`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    console.log('  screenshot', path.relative(process.cwd(), file));
  };
  const glyphs = (ctype) => evalJs(`[...document.querySelectorAll('#svgCanvas g.constraint-glyph[data-ctype="${ctype}"]')].filter((g) => !g.closest('[data-preview]') && g.style.pointerEvents !== 'none').map((g) => { const r = g.getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, shape: g.getAttribute('data-cshape') }; })`);
  // a point ON a glyph's drawn icon: THE glyph pick's own test (#ui/fusion-glyphs.js glyphPickHit, with the page's glyph size settings) around the
  // glyph's drawn centre, as far as possible from the corner (a press within the point's reach picks the point first)
  const onIcon = (g, from) => evalJs(`(async () => {
    const { glyphPickHit } = await import('/packages/ui/fusion-glyphs.js');
    const SM = (await import('/packages/core/settings-manager.js')).default, st = SM.getAll();
    const el = [...document.querySelectorAll('#svgCanvas g.constraint-glyph[data-ctype="sharedPointCoincident"]')].find((e) => e.getAttribute('data-cshape') === ${JSON.stringify(g.shape)});
    if (!el) return null;
    const m = el.getAttribute('transform').replace('translate(', '').replace(')', '').split(','); // translate(x,y): the glyph's centre
    const svg = document.getElementById('svgCanvas'), pt = svg.createSVGPoint(); pt.x = +m[0]; pt.y = +m[1];
    const c = pt.matrixTransform(el.parentNode.getScreenCTM());
    let best = null;
    for (let dx = -14; dx <= 14; dx++) for (let dy = -14; dy <= 14; dy++) {
      if (!glyphPickHit('sharedPointCoincident', dx, dy, Number(st.GLYPH_SYMBOL_SIZE_PX), Number(st.GLYPH_OUTLINE_PX), ${isPhone})) continue;
      const x = Math.round(c.x + dx), y = Math.round(c.y + dy), d = Math.hypot(x - ${from.x}, y - ${from.y});
      if (!best || d > best.d) best = { x, y, d };
    } return best; })()`);
  // world -> screen through the canvas's own transform (its first group: the world)
  const toScreen = (w) => evalJs(`(() => { const svg = document.getElementById('svgCanvas'), pt = svg.createSVGPoint(); pt.x = ${w.x}; pt.y = ${w.y}; const g = svg.querySelector('g'); const p = pt.matrixTransform((g || svg).getScreenCTM()); return { x: Math.round(p.x), y: Math.round(p.y) }; })()`);
  const usedJoints = (g) => { const used = new Set(g.shapes.flatMap((s) => s.joints)); return g.joints.filter(([id]) => used.has(id)); };
  const curvesAt = (g, id) => g.shapes.filter((s) => s.joints.includes(id));

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
    const centre = at(0.4, 0.5), corner = { x: centre.x + Math.round(Math.min(r.w, r.h) * 0.25), y: centre.y };
    const lineEnd = { x: corner.x + Math.round(Math.min(r.w, r.h) * 0.12), y: corner.y - Math.round(Math.min(r.w, r.h) * 0.2) };
    const lineStart = { x: lineEnd.x + Math.round(Math.min(r.w, r.h) * 0.08), y: lineEnd.y + Math.round(Math.min(r.w, r.h) * 0.12) };

    // 1. a polygon (centre, corner), then a line from the corner (a separate joint glued on)
    await pressRibbonTool(evalJs, tap, 'tool-polygon');
    await tap(centre); await tap(corner); await esc(); await esc();
    let g = await readDoc();
    const cornerId = g.shapes.find((s) => !s.isConstruction).joints[0];
    check(curvesAt(g, cornerId).length === 3, `[${tag}] the polygon's first corner is ONE joint of 3 curves (2 sides + the radius): ${curvesAt(g, cornerId).length}`);
    // a free line, then the Coincident tool: the corner, then the line's start (the second pick gives way: the line's start moves onto the corner;
    // Fusion's mixed stack: a separate joint glued on the shared corner)
    await pressRibbonTool(evalJs, tap, 'tool-line');
    await tap(lineStart); await tap(lineEnd); await esc(); await esc();
    await pressRibbonTool(evalJs, tap, 'tool-coincident');
    await tap(corner); await tap(lineStart); await esc(); await esc();
    g = await readDoc();
    const glue = g.constraints.filter((c) => c.type === 'coincident' && c.joints.includes(cornerId));
    check(glue.length === 1 && curvesAt(g, cornerId).length === 3, `[${tag}] the line's start is its own joint, glued on the corner by a coincident (${glue.length}; the corner still has ${curvesAt(g, cornerId).length} curves)`);
    const cornerAt = g.joints.find(([id]) => id === cornerId)[1], cornerNow = await toScreen(cornerAt);
    check(Math.hypot(cornerNow.x - corner.x, cornerNow.y - corner.y) <= 3, `[${tag}] the corner stayed where it was drawn (screen ${JSON.stringify(cornerNow)} vs ${JSON.stringify(corner)})`);
    const jointsBefore = usedJoints(g).length;

    // 2. nothing selected: no glyph; a press on the corner: both kinds side by side
    check((await glyphs('sharedPointCoincident')).length === 0 && (await glyphs('coincident')).length === 0, `[${tag}] nothing selected: no glyph at the corner`);
    await tap(corner);
    const shared = await glyphs('sharedPointCoincident'), coinc = await glyphs('coincident');
    check(shared.length === 2, `[${tag}] the corner pressed: the 2 shared-point glyphs show (n - 1 of 3 curves): ${shared.length}`);
    check(coinc.length === 1, `[${tag}] ... and the line's coincident glyph beside them (BUG-410: whichever stacked point the press picked): ${coinc.length}`);
    await shot('glyphs-shown', corner);

    // 3. a press on a shared-point glyph (one of the polygon's sides), Delete (desktop: the key; phone: the footer Delete)
    const side = new Set(g.shapes.filter((s) => !s.isConstruction && s.type === 'line' && !s.id.startsWith('s_poly_radial') && curvesAt(g, cornerId).includes(s)).map((s) => s.id));
    const target = shared.find((x) => side.has(x.shape)) || shared[0];
    const p = await onIcon(target, corner);
    check(!!p, `[${tag}] the glyph of ${target.shape} is on screen (a point on its icon ${p && Math.round(p.d)} px from the corner)`);
    await tap(p);
    await shot('glyph-selected', corner);
    if (isPhone) {
      const b = await evalJs(`(() => { const b = document.getElementById('btn-delete-selection'); if (!b || b.disabled) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      check(!!b, `[${tag}] the footer Delete is enabled with the glyph selected`);
      if (b) await tap(b);
    } else await sendRealKey(send, 'Delete', 'Delete', 46, 0, '');
    await sleep(300);
    const g2 = await readDoc();
    check(usedJoints(g2).length === jointsBefore + 1, `[${tag}] Delete splits the point: ONE new joint (${jointsBefore} -> ${usedJoints(g2).length})`);
    const detached = g2.shapes.find((s) => s.id === target.shape);
    check(!!detached && !detached.joints.includes(cornerId), `[${tag}] ${target.shape} now ends at its own new point`);
    check(curvesAt(g2, cornerId).length === 2, `[${tag}] the two other curves keep sharing the corner (${curvesAt(g2, cornerId).length})`);
    check(g2.constraints.some((c) => c.type === 'coincident' && c.joints.includes(cornerId)), `[${tag}] the line stays glued to the corner (its coincident untouched)`);
    await esc();
    await shot('split', corner);

    // 4. a drag of the corner pulls the detached side apart
    await drag(corner, { x: corner.x + 45, y: corner.y + 35 });
    const g3 = await readDoc();
    const newId = detached.joints.find((j) => !g.joints.some(([id]) => id === j));
    const pos = (gg, id) => { const e = gg.joints.find(([x]) => x === id); return e ? e[1] : null; };
    const a = pos(g3, newId), c = pos(g3, cornerId);
    const [sa, sc] = await Promise.all([a, c].map((w) => toScreen(w)));
    const gap = Math.hypot(sa.x - sc.x, sa.y - sc.y);
    check(gap > 20, `[${tag}] the drag pulls the corner apart: the detached end and the shared corner are ${gap.toFixed(0)} px apart on screen`);
    await esc();
    await shot('pulled-apart', { x: corner.x + 20, y: corner.y + 15 }, 90);

    // 5. Undo twice (desktop: Ctrl+Z; phone: the footer Undo): the drag, then the split (ONE step each): the shared corner is back
    for (let i = 0; i < 2; i++) {
      if (isPhone) await tap(await evalJs(`(() => { const r = document.getElementById('btn-undo').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`));
      else await sendRealKey(send, 'z', 'KeyZ', 90, 2);
      await sleep(350);
    }
    const g4 = await readDoc();
    check(curvesAt(g4, cornerId).length === 3 && usedJoints(g4).length === jointsBefore, `[${tag}] Undo twice: the corner is shared by 3 curves again (${curvesAt(g4, cornerId).length}), joints ${usedJoints(g4).length}`);

    // 6. the point's menu (desktop: right click; phone: touch and hold): "Delete Coincident" (Fusion, owner-checked) unjoins the spot in ONE step:
    //    the 2 non-owner curves get their own points and the glued line's coincident goes
    if (isPhone) { await touch('touchStart', corner); await sleep(650); await touch('touchEnd', corner); await sleep(300); }
    else { await mouse('mouseMoved', corner); await sleep(60); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: corner.x, y: corner.y, button: 'right', buttons: 2, clickCount: 1 }); await sleep(40); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: corner.x, y: corner.y, button: 'right', buttons: 0, clickCount: 1 }); await sleep(300); }
    const item = await evalJs(`(() => { const e = document.querySelector('.sk-context-menu .sk-context-item[data-id="geo-delete-coincident"]'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: e.textContent.trim() }; })()`);
    check(!!item && /Delete Coincident/.test(item.text), `[${tag}] the corner's menu offers "Delete Coincident" (${item && item.text})`);
    if (item) {
      const m = await evalJs(`(() => { const r = document.querySelector('.sk-context-menu').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, h: Math.max(r.width, r.height) / 2 + 10 }; })()`);
      await shot('menu-delete-coincident', m, Math.round(Math.min(m.h, 150)));
      await tap(item);
      const g5 = await readDoc();
      check(usedJoints(g5).length === jointsBefore + 2 && curvesAt(g5, cornerId).length === 1, `[${tag}] Delete Coincident: +2 joints (${jointsBefore} -> ${usedJoints(g5).length}), the corner keeps only its owner curve (${curvesAt(g5, cornerId).length})`);
      check(!g5.constraints.some((c) => c.type === 'coincident' && c.joints.includes(cornerId)), `[${tag}] Delete Coincident: the glued line's coincident is gone too`);
      await shot('after-delete-coincident', corner);
    }
  } finally {
    await close();
  }
}

await run({ width: 1280, height: 800, tag: 'desktop' });
await run({ width: 390, height: 844, tag: 'phone' });
assert.deepStrictEqual(failures, [], `${failures.length} check(s) failed`);
console.log('split-shared-point-1041-live: PASS');
