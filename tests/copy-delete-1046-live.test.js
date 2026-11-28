// tests/copy-delete-1046-live.test.js — TASK 1046 (Fusion D-43, measured 2026-11-27): deleting ONE curve of a PATTERN COPY deletes that curve
// only; the pattern stays and its instance keeps its other copies. In the real SketchStudio page (headless Edge / Chrome via CDP): desktop
// 1280 x 800 with the real mouse and the Delete key (then Ctrl+Z: one undo step puts the curve back), phone 390 x 844 with a real finger and the
// footer red X. Each device: a rectangle (Rect tool), a Rectangular Pattern of it (the tool, the 4 sides tapped, Distance 1 typed, Enter), then a
// press on one side of the COPY and Delete. The node twin (D-38 / D-39 / D-43 / D-44 / D-63 / D-65, undo / redo / reload, the offset relation
// glyph): tests/copy-delete-1046-node.test.js. Evidence: .evidence/1046/live-<step>-<device>.png (local only).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';

const EVIDENCE_DIR = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), '.evidence', '1046');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const failures = [];
const check = (ok, msg) => { if (!ok) { failures.push(msg); console.log('  FAIL ' + msg); } else console.log('  ok ' + msg); };

async function run({ width, height, tag }) {
  const isPhone = width <= 640;
  const cdp = await launchBrowser({ tag: `1046-${tag}`, width, height });
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
  const toScreen = (w) => evalJs(`(() => { const svg = document.getElementById('svgCanvas'), pt = svg.createSVGPoint(); pt.x = ${w.x}; pt.y = ${w.y}; const g = svg.querySelector('g'); const p = pt.matrixTransform((g || svg).getScreenCTM()); return { x: Math.round(p.x), y: Math.round(p.y) }; })()`);
  const centreOf = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e || e.disabled) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  // a legible crop round the scene, at 2x
  const shot = async (name, box) => {
    await sleep(250);
    const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { x: Math.max(0, box.x0), y: Math.max(0, box.y0), width: box.x1 - box.x0, height: box.y1 - box.y0, scale: 2 } });
    const b = Buffer.from(data, 'base64'), file = path.join(EVIDENCE_DIR, `live-${name}-${tag}.png`);
    fs.writeFileSync(file, b);
    console.log(`  screenshot ${path.relative(process.cwd(), file)} md5 ${crypto.createHash('md5').update(b).digest('hex')}`);
  };
  const lines = (g) => g.shapes.filter((s) => s.type === 'line' && !String(s.id).startsWith('ref_') && !s.isConstruction);
  const pos = (g, id) => g.joints.find(([x]) => x === id)[1];
  const pattern = (g) => g.constraints.find((c) => /Pattern$/.test(c.type)) || null;

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
    const s = Math.round(Math.min(r.w, r.h) * 0.12);
    // the upper part of the canvas: the phone's pattern dialog covers its lower part
    const A = { x: Math.round(r.l + r.w * 0.3), y: Math.round(r.t + r.h * 0.3) }, B = { x: A.x + s, y: A.y - s };

    // 1. a rectangle, then a rectangular pattern of its 4 sides (the copy one rectangle-width plus a gap to the right)
    await pressRibbonTool(evalJs, tap, 'tool-rect');
    await tap(A); await tap(B); await esc(); await esc();
    let g = await readDoc();
    const src = lines(g);
    check(src.length === 4, `[${tag}] the rectangle is drawn (${src.length} lines)`);
    const xs = src.flatMap((l) => l.joints.map((j) => pos(g, j).x)), w = Math.max(...xs) - Math.min(...xs);
    await pressRibbonTool(evalJs, tap, 'tool-rectangularPattern');
    await sleep(200);
    for (const l of src) { const a = pos(g, l.joints[0]), b = pos(g, l.joints[1]); await tap(await toScreen({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })); }
    await sendRealKey(send, 'Enter', 'Enter', 13, 0, '\r'); await sleep(400); // the objects are done: the live pattern
    const field = '.sk-pattern-dialog [data-field="Distance 1"]';
    await tap(await centreOf(field));
    await evalJs(`(() => { const i = document.querySelector(${JSON.stringify(field)}); i.focus(); i.select(); })()`);
    for (const ch of String(+(2 * w).toFixed(4))) await send('Input.dispatchKeyEvent', { type: 'char', text: ch });
    await sleep(300);
    const ok = await evalJs(`(() => { const b = [...document.querySelectorAll('.sk-pattern-dialog button')].find((x) => x.textContent.trim() === 'OK'); if (!b) return null; b.scrollIntoView({ block: 'nearest' }); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    check(!!ok, `[${tag}] the dialog's OK button`);
    await tap(ok); await sleep(300); // OK
    check(await evalJs(`!document.querySelector('.sk-pattern-dialog')`), `[${tag}] OK closes the pattern dialog`);
    await esc(); await esc();
    g = await readDoc();
    const pat = pattern(g);
    check(!!pat && pat.instances.length === 1 && lines(g).length === 8, `[${tag}] the pattern is made: 1 copy instance, ${lines(g).length} lines`);
    if (!pat) return;
    const copyIds = pat.instances[0].shapes;
    const all = lines(g).flatMap((l) => l.joints.map((j) => pos(g, j)));
    const corners = await Promise.all([{ x: Math.min(...all.map((p) => p.x)), y: Math.min(...all.map((p) => p.y)) }, { x: Math.max(...all.map((p) => p.x)), y: Math.max(...all.map((p) => p.y)) }].map(toScreen));
    const box = { x0: Math.min(corners[0].x, corners[1].x) - 40, y0: Math.min(corners[0].y, corners[1].y) - 40, x1: Math.max(corners[0].x, corners[1].x) + 40, y1: Math.max(corners[0].y, corners[1].y) + 40 };
    await shot('before', box);

    // 2. a press on ONE side of the copy, then Delete (desktop: the key; phone: the footer red X)
    const victim = g.shapes.find((x) => x.id === copyIds[0]);
    const va = pos(g, victim.joints[0]), vb = pos(g, victim.joints[1]);
    await tap(await toScreen({ x: (va.x + vb.x) / 2, y: (va.y + vb.y) / 2 }));
    if (isPhone) {
      const b = await centreOf('#btn-delete-selection');
      check(!!b, `[${tag}] the footer red X is enabled with the copy side selected`);
      if (b) await tap(b);
    } else await sendRealKey(send, 'Delete', 'Delete', 46, 0, '');
    await sleep(300);
    const g2 = await readDoc();
    const pat2 = pattern(g2);
    check(lines(g2).length === 7 && !g2.shapes.some((x) => x.id === victim.id), `[${tag}] that copy side only goes (${lines(g2).length} lines)`);
    check(!!pat2 && pat2.instances.length === 1 && (pat2.suppressed || []).length === 0, `[${tag}] the pattern STAYS, its instance not suppressed`);
    check(!!pat2 && pat2.instances[0].shapes[0] === null && pat2.instances[0].shapes.slice(1).every((id) => g2.shapes.some((x) => x.id === id)), `[${tag}] the instance keeps its other 3 copies (the deleted one null)`);
    await esc();
    await shot('after-delete', box);

    // 3. desktop: Ctrl+Z, ONE undo step: the side is back, the pattern whole
    if (!isPhone) {
      await sendRealKey(send, 'z', 'KeyZ', 90, 2); await sleep(350);
      const g3 = await readDoc();
      check(lines(g3).length === 8 && pattern(g3) && pattern(g3).instances[0].shapes.every((id) => g3.shapes.some((x) => x.id === id)), `[${tag}] one Ctrl+Z puts the copy side back (${lines(g3).length} lines)`);
    }

    // 4. the offset RELATION glyph (Fusion's Offset constraint glyph, task 1048): a second rectangle below, offset outside by its quarter width;
    //    two glyphs (beside a source side and its copy), shown with nothing selected; a press on one + Delete removes the relation, the copies stay
    await esc(); await esc();
    const C0 = { x: A.x, y: A.y + 2 * s }, C1 = { x: A.x + s, y: A.y + s };
    await pressRibbonTool(evalJs, tap, 'tool-rect');
    await tap(C0); await tap(C1); await esc(); await esc();
    let g4 = await readDoc();
    const before = new Set(g.shapes.map((x) => x.id).concat(g2.shapes.map((x) => x.id)));
    const rect2 = lines(g4).filter((l) => !before.has(l.id) && !lines(g2).some((x) => x.id === l.id));
    const bottom = rect2.reduce((m, l) => (pos(g4, l.joints[0]).y + pos(g4, l.joints[1]).y > pos(g4, m.joints[0]).y + pos(g4, m.joints[1]).y ? l : m));
    const ba = pos(g4, bottom.joints[0]), bb = pos(g4, bottom.joints[1]);
    const bw = Math.abs(bb.x - ba.x);
    await pressRibbonTool(evalJs, tap, 'tool-offset');
    await tap(await toScreen({ x: (ba.x + bb.x) / 2, y: (ba.y + bb.y) / 2 }));
    await tap(await toScreen({ x: (ba.x + bb.x) / 2, y: ba.y + bw / 3 }));
    await evalJs(`(() => { const i = document.getElementById('offset-distance-input'); i.focus(); i.select(); })()`);
    for (const ch of String(+(bw / 4).toFixed(4))) await send('Input.dispatchKeyEvent', { type: 'char', text: ch });
    await sendRealKey(send, 'Enter', 'Enter', 13, 0, '\r'); await sleep(400);
    await esc(); await esc();
    g4 = await readDoc();
    const off = g4.constraints.find((c) => c.type === 'offset');
    check(!!off && off.shapes.length === 8, `[${tag}] the offset is made (${off && off.shapes.length / 2} pieces)`);
    const relGlyphs = () => evalJs(`[...document.querySelectorAll('#svgCanvas g.constraint-glyph[data-ctype="offsetRelation"]')].map((e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })`);
    const rg = await relGlyphs();
    check(rg.length === 2, `[${tag}] the relation shows TWO glyphs with nothing selected (${rg.length})`);
    const oc = await Promise.all([{ x: Math.min(ba.x, bb.x) - bw / 3, y: Math.min(ba.y, bb.y) - 1.4 * bw }, { x: Math.max(ba.x, bb.x) + bw / 3, y: Math.max(ba.y, bb.y) + bw / 2 }].map(toScreen));
    const obox = { x0: Math.min(oc[0].x, oc[1].x) - 30, y0: Math.min(oc[0].y, oc[1].y) - 30, x1: Math.max(oc[0].x, oc[1].x) + 30, y1: Math.max(oc[0].y, oc[1].y) + 30 };
    await shot('offset-glyphs', obox);
    if (rg.length === 2) {
      // a point ON the copy glyph's drawn icon (THE glyph pick's own test, #ui/fusion-glyphs.js glyphPickHit), then the press
      const on = await evalJs(`(async () => {
        const { glyphPickHit } = await import('/packages/ui/fusion-glyphs.js');
        const SM = (await import('/packages/core/settings-manager.js')).default, st = SM.getAll();
        const c = ${JSON.stringify(rg[1])};
        for (let r = 0; r <= 12; r++) for (let a = 0; a < 16; a++) { const dx = Math.round(r * Math.cos(a * Math.PI / 8)), dy = Math.round(r * Math.sin(a * Math.PI / 8));
          if (glyphPickHit('offsetRelation', dx, dy, Number(st.GLYPH_SYMBOL_SIZE_PX), Number(st.GLYPH_OUTLINE_PX), ${isPhone})) return { x: Math.round(c.x) + dx, y: Math.round(c.y) + dy }; }
        return null; })()`);
      check(!!on, `[${tag}] a point on the copy glyph's icon`);
      if (!isPhone) { await mouse('mouseMoved', on); await sleep(250); await shot('offset-glyph-hover', obox); }
      await tap(on);
      await shot('offset-glyph-selected', obox);
      if (isPhone) { const b = await centreOf('#btn-delete-selection'); check(!!b, `[${tag}] the footer red X is enabled with the relation glyph selected`); if (b) await tap(b); }
      else await sendRealKey(send, 'Delete', 'Delete', 46, 0, '');
      await sleep(300);
      const g5 = await readDoc();
      check(!g5.constraints.some((c) => c.type === 'offset') && off.shapes.every((id) => g5.shapes.some((x) => x.id === id)), `[${tag}] Delete on the relation glyph removes the relation; the 4 copies stay`);
      check((await relGlyphs()).length === 0, `[${tag}] no relation glyph left`);
      await esc();
      await shot('offset-relation-deleted', obox);
    }
  } finally {
    await close();
  }
}

await run({ width: 1280, height: 800, tag: 'desktop' });
await run({ width: 390, height: 844, tag: 'phone' });
assert.deepStrictEqual(failures, [], `${failures.length} check(s) failed`);
console.log('copy-delete-1046-live: PASS');
