// tests/interrupts-fix-1030-live.test.js — TASK 1030: the tool-interruption fixes a browser alone shows (Shaper's Design canvas, real CDP mouse / key /
// touch events; audit rows docs/INTERRUPTS-AUDIT-1023.md):
//   desktop 1280x800:
//     I-17 a RIGHT-click on empty canvas places / completes nothing (Rect after its first corner: no rectangle, the corner kept; Line: the chain
//          ends with no segment)
//     I-19 a value box keeps the keyboard across a middle-button pan and a click on the footer bar; a click into the Parameters window keeps the
//          focus there and the next canvas press gives it back (Enter then finishes the draw)
//     I-22 typing in the 3-point rectangle's box does not scroll the page (fixed by task 1028: guard)
//     I-09 a typed transform-box value, another tool picked: the box is gone
//   phone 390x844:
//     I-21 the first finger of a two-finger pinch / pan acts as no press (a half-made rectangle is not completed, no line is started); a tap still works
// Evidence: .evidence/1030/<name>-<tag>.png
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';

const EVIDENCE_DIR = path.resolve('.evidence/1030');
const failures = [];
const check = (ok, msg) => { if (!ok) { failures.push(msg); console.log('  FAIL ' + msg); } else console.log('  ok ' + msg); };
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const ST = 'window.__designController.state';

async function run({ width, height, tag }) {
  const label = `${width}x${height}`;
  const isPhone = width <= 640;
  const cdp = await launchBrowser({ tag: `1030-${tag}`, width, height,
    args: ['--host-resolver-rules=MAP *googleapis.com ~NOTFOUND, MAP *google.com ~NOTFOUND, MAP *gstatic.com ~NOTFOUND, MAP *shapertools.com ~NOTFOUND'] });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
  const { port, send, evalJs, waitFor, waitForApp, navigate, close } = cdp;
  const mouse = (type, p, button = 'left', buttons) => send('Input.dispatchMouseEvent', { type, x: Math.round(p.x), y: Math.round(p.y), button: type === 'mouseMoved' && buttons === undefined ? 'none' : button,
    buttons: buttons !== undefined ? buttons : type === 'mousePressed' ? ({ left: 1, right: 2, middle: 4 })[button] : 0, clickCount: type === 'mouseMoved' ? 0 : 1 });
  const touches = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y), id: p.id, radiusX: 1, radiusY: 1, force: 1 })) });
  const tap = async (p) => {
    if (isPhone) { await touches('touchStart', [{ ...p, id: 1 }]); await sleep(60); await touches('touchEnd', []); }
    else { await mouse('mouseMoved', p); await sleep(40); await mouse('mousePressed', p); await sleep(40); await mouse('mouseReleased', p); }
    await sleep(200);
  };
  const rightClick = async (p) => { await mouse('mouseMoved', p); await sleep(40); await mouse('mousePressed', p, 'right'); await sleep(40); await mouse('mouseReleased', p, 'right'); await sleep(250); };
  const middlePan = async (p, dx, dy) => {
    await mouse('mouseMoved', p); await sleep(30);
    await mouse('mousePressed', p, 'middle'); await sleep(30);
    await mouse('mouseMoved', { x: p.x + dx, y: p.y + dy }, 'middle', 4); await sleep(30);
    await mouse('mouseReleased', { x: p.x + dx, y: p.y + dy }, 'middle'); await sleep(250);
  };
  const move = async (p) => { if (!isPhone) { await mouse('mouseMoved', p); await sleep(120); } };
  const w2s = (wx, wy) => evalJs(`(() => { const svg = document.getElementById('design-canvas'); const pt = svg.createSVGPoint(); pt.x = ${wx}; pt.y = ${wy}; const p = pt.matrixTransform(svg.getScreenCTM()); return { x: p.x, y: p.y }; })()`);
  const shot = async (name) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(EVIDENCE_DIR, `${name}-${tag}.png`), Buffer.from(data, 'base64'));
  };
  const snap = () => evalJs(`(() => { const st = ${ST}; const a = document.activeElement;
    return { tool: st.currentTool, active: !!st.active, shapes: st.shapes.length, lines: st.shapes.filter((s) => s.type === 'line').length, joints: st.joints.size,
      U: st.history.length, R: st.redoStack.length, focus: a ? (a.id || (a.tagName + (a.parentElement && a.parentElement.id ? '<' + a.parentElement.id : ''))) : null,
      scroll: { x: Math.round(document.scrollingElement.scrollLeft), y: Math.round(document.scrollingElement.scrollTop) }, tbox: !!document.getElementById('tbox-input') }; })()`);
  const esc = async () => { await sendRealKey(send, 'Escape', 'Escape', 27, 0, ''); await sleep(150); };
  const tool = async (id) => { await pressRibbonTool(evalJs, tap, id); await sleep(120); };
  const fresh = async () => {
    await esc(); await esc();
    await evalJs(`(async () => { const st = ${ST}; const m = await import('/packages/ui/input-manager.js'); m.switchToTool(st, 'select'); st.clearDocument();
      st.rectMode = 'rect-2pt'; st.view.x = 0; st.view.y = 0; st.view.w = 180; const { updateViewBox } = await import('/packages/ui/input-handlers/pan-zoom.js');
      updateViewBox(document.getElementById('design-canvas'), st.view); })()`);
    await sleep(200);
  };

  try {
    await installFakeDriveSession(cdp);
    if (isPhone) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await send('Emulation.setEmitTouchEventsForMouse', { enabled: false });
    }
    await resetBufferLive(cdp);
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 15000);
    await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'shaper design tab', 12000);
    await evalJs(`document.querySelector('.sk-header-tab[data-tab="design"]').click()`);
    await waitForApp('design-canvas');
    await waitFor(`!!(${ST}) && document.getElementById('design-canvas').getBoundingClientRect().width > 0`, 'design controller', 12000);
    await sleep(400);
    if (!isPhone) await evalJs(`(() => { const b = document.querySelector('.sk-browser'); const t = document.querySelector('.sk-browser-toggle'); if (b && t && !b.classList.contains('collapsed')) t.click(); })()`);

    if (!isPhone) {
      // ── I-17: right-click in Rect after the first corner, and in Line ──
      await fresh();
      await tool('tool-rect');
      await tap(await w2s(50, -10)); await move(await w2s(70, 10));
      await rightClick(await w2s(75, -30));
      let s = await snap();
      await shot('I17-rect-rightclick');
      check(s.shapes === 0, `[${label}] I-17 rect: a right-click completes no rectangle (shapes ${s.shapes})`);
      check(s.active && s.tool === 'rect', `[${label}] I-17 rect: the first corner is kept (active ${s.active}, tool ${s.tool})`);
      await fresh();
      await tool('tool-line');
      await rightClick(await w2s(40, 20));
      s = await snap();
      check(!s.active && s.joints === 1, `[${label}] I-17 line: a right-click before the first pick starts nothing (active ${s.active}, joints ${s.joints})`);
      await tap(await w2s(-20, 10)); await move(await w2s(20, 20));
      await rightClick(await w2s(20, 20));
      s = await snap();
      check(s.lines === 0 && !s.active, `[${label}] I-17 line: an untyped right-click ends the chain with no segment (lines ${s.lines}, active ${s.active})`);

      // ── I-19: the box keeps the keyboard across a middle pan, a footer click; a Parameters window click keeps it there, the canvas gives it back ──
      await fresh();
      await tool('tool-line');
      await tap(await w2s(-30, 0)); await move(await w2s(10, 10));
      await waitFor(`!!document.querySelector('#dualInput input') && document.activeElement && document.activeElement.parentElement && document.activeElement.parentElement.id === 'dualInput'`, 'the line box has the focus');
      await send('Input.insertText', { text: '25' }); await sleep(80);
      await middlePan(await w2s(40, -30), 40, 20);
      s = await snap();
      check(s.focus === 'INPUT<dualInput', `[${label}] I-19 middle pan: the box keeps the focus (${s.focus})`);
      await mouse('mouseMoved', { x: 640, y: 785 }); await sleep(30); await mouse('mousePressed', { x: 640, y: 785 }); await sleep(30); await mouse('mouseReleased', { x: 640, y: 785 }); await sleep(200);
      s = await snap();
      check(s.focus === 'INPUT<dualInput', `[${label}] I-19 footer click: the box gets the focus back (${s.focus})`);
      await evalJs(`document.getElementById('btn-parameters').click()`); await sleep(300);
      const title = await evalJs(`(() => { const e = document.querySelector('.sk-pwin'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + Math.min(40, r.width / 2), y: r.top + 12 }; })()`);
      check(!!title, `[${label}] I-19 the Parameters window opened`);
      if (title) { await mouse('mouseMoved', title); await sleep(30); await mouse('mousePressed', title); await sleep(30); await mouse('mouseReleased', title); await sleep(200); }
      s = await snap();
      check(s.focus !== 'INPUT<dualInput', `[${label}] I-19 a click into the Parameters window keeps the focus there (${s.focus})`);
      await shot('I19-params-click');
      // a canvas spot the Parameters window does not cover
      const free = await evalJs(`(() => { const svg = document.getElementById('design-canvas'); const r = svg.getBoundingClientRect();
        for (let y = r.bottom - 60; y > r.top + 40; y -= 40) for (let x = r.right - 60; x > r.left + 40; x -= 40) { const t = document.elementFromPoint(x, y); if (t && svg.contains(t)) return { x, y }; }
        return null; })()`);
      check(!!free, `[${label}] I-19 a free canvas spot beside the Parameters window`);
      if (free) await middlePan(free, -30, -15);
      s = await snap();
      check(s.focus === 'INPUT<dualInput', `[${label}] I-19 back on the canvas: the box has the focus again (${s.focus})`);
      await sendRealKey(send, 'Enter', 'Enter', 13, 0, '\r'); await sleep(300);
      s = await snap();
      check(s.lines === 1, `[${label}] I-19 Enter after it all places the typed line (lines ${s.lines})`);
      await evalJs(`(() => { const e = document.querySelector('.sk-pwin'); if (e && getComputedStyle(e).display !== 'none') document.getElementById('btn-parameters').click(); })()`);

      // ── I-22 (fixed by task 1028): typing in the 3-point rectangle's box does not scroll the page ──
      await fresh();
      await evalJs(`${ST}.rectMode = 'rect-3pt'`);
      await tool('tool-rect');
      await tap(await w2s(50, -10)); await move(await w2s(70, 6));
      await send('Input.insertText', { text: '2' }); await sleep(150);
      s = await snap();
      await shot('I22-rect3-typed');
      check(s.scroll.x === 0 && s.scroll.y === 0, `[${label}] I-22 the page is not scrolled (${JSON.stringify(s.scroll)})`);

      // ── I-09: the transform box's typed value goes when another tool is picked ──
      await fresh();
      await evalJs(`(() => { const st = ${ST}; const j = (id, x, y) => st.joints.set(id, { x, y, fixed: false, sketchId: st.activeSketchId });
        j('g1', -42, 26); j('g2', -22, 26); j('g3', -22, 38); st.groups = [{ id: 'grp_1', name: 'Group 1', sketchId: st.activeSketchId }];
        st.shapes.push({ id: 'G1a', type: 'line', joints: ['g1', 'g2'], sketchId: st.activeSketchId, userGroupId: 'grp_1' });
        st.shapes.push({ id: 'G1b', type: 'line', joints: ['g2', 'g3'], sketchId: st.activeSketchId, userGroupId: 'grp_1' }); })()`);
      await sleep(150);
      await tap(await w2s(-32, 26));
      const rot = await evalJs(`(async () => { const st = ${ST}; const svg = document.getElementById('design-canvas'); const tm = await import('/packages/core/transform.js');
        const tb = await import('/packages/ui/transform-box.js'); const { worldToScreen, getZoomFactor } = await import('/packages/ui/coords.js');
        return worldToScreen(svg, tb.boxLayout(tm.groupBox(st, 'grp_1'), getZoomFactor(svg), false).rotate); })()`);
      await tap(rot);
      await sleep(150);
      await send('Input.insertText', { text: '30' }); await sleep(100);
      const before = await snap();
      check(before.tbox, `[${label}] I-09 the transform box is open`);
      await tool('tool-circle');
      s = await snap();
      await shot('I09-tbox-after-switch');
      check(s.tool === 'circle' && !s.tbox, `[${label}] I-09 the Circle tool and no transform box left (tool ${s.tool}, tbox ${s.tbox})`);
    } else {
      // ── I-21: two fingers never act as a press of the first ──
      await fresh();
      await tool('tool-rect');
      await tap(await w2s(-20, -20));
      let s = await snap();
      check(s.active && s.shapes === 0, `[${label}] I-21 the first corner is placed by a tap (active ${s.active})`);
      const a = await w2s(20, 20), b = await w2s(40, 30);
      await touches('touchStart', [{ ...a, id: 1 }]); await sleep(40);   // the second finger lands 40 ms after the first (a real pinch: 10 - 100 ms)
      await touches('touchStart', [{ ...a, id: 1 }, { ...b, id: 2 }]); await sleep(40);
      await touches('touchMove', [{ x: a.x - 20, y: a.y - 20, id: 1 }, { x: b.x + 20, y: b.y + 20, id: 2 }]); await sleep(40);
      await touches('touchEnd', []); await sleep(250);
      s = await snap();
      await shot('I21-rect-pinch');
      check(s.shapes === 0, `[${label}] I-21 rect: the pinch completes no rectangle (shapes ${s.shapes})`);
      check(s.active, `[${label}] I-21 rect: the first corner is kept`);
      await tap(await w2s(20, 10));
      s = await snap();
      check(s.shapes === 4, `[${label}] I-21 rect: the next tap completes it (shapes ${s.shapes})`);
      await fresh();
      await tool('tool-line');
      const c = await w2s(10, 10), d = await w2s(30, 10);
      await touches('touchStart', [{ ...c, id: 1 }, { ...d, id: 2 }]); await sleep(40);   // both fingers in one event (the audit's probe)
      await touches('touchMove', [{ x: c.x + 15, y: c.y + 15, id: 1 }, { x: d.x + 15, y: d.y + 15, id: 2 }]); await sleep(40);
      await touches('touchEnd', []); await sleep(250);
      s = await snap();
      check(!s.active && s.joints === 1, `[${label}] I-21 line: a two-finger pan starts no line (active ${s.active}, joints ${s.joints})`);
    }
    console.log(`[${label}] done`);
  } finally {
    await close();
  }
}

await run({ width: 1280, height: 800, tag: 'desktop' });
await run({ width: 390, height: 844, tag: 'phone' });
assert.deepStrictEqual(failures, [], `${failures.length} check(s) failed`);
console.log('interrupts-fix-1030-live: PASS');
