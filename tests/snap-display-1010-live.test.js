// tests/snap-display-1010-live.test.js -- TASK 1010 in a real headless browser (Shaper page: it exposes the design state), desktop 1280x800
// and phone 390x844 (touch):
//   UX-27 / B-18b  an arc shows a midpoint snap (hover with the Line tool)               desktop + phone-sized canvas
//   B-18a          a corner dragged to a line midpoint sits exactly on it while dragged    desktop (mouse)
//   B-20c          a finger press 21 px from a point and 4 px from a line picks the point  phone (touch)
//   UX-20          the contradictory triangle is drawn in the error red                     desktop + phone
// Screenshots (zoomed) go to .evidence/1010/.
import assert from 'node:assert';
import { launchBrowser } from './helpers/cdp-browser.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';
import { docOf } from './fixtures/display-1010/doc-kit.js';
import { NO_NET, openSeeded, setView, w2s, mouseMove, mouseDrag, touchTap, shot } from './fixtures/display-1010/live-kit.js';

const SHAPER = { host: 'shaper', canvas: 'design-canvas', url: '/apps/shaper/index.html' };
const ST = (cdp, js) => cdp.evalJs(`(() => { const st = window.__designController.state; return ${js}; })()`);
const D = (a, b, value, name) => ({ type: 'distance', joints: [a, b], value, name });

async function run(tag, width, height, touch) {
  const cdp = await launchBrowser({ tag, width, height, args: NO_NET });
  if (!cdp) { console.log(`skipped ${tag}: no headless browser`); return; }
  const press = (p) => (touch ? touchTap(cdp, p.x, p.y) : mouseMove(cdp, p.x, p.y));
  try {
    await installFakeDriveSession(cdp);
    const tool = (name) => pressRibbonTool(cdp.evalJs, (p) => touchTap(cdp, p.x, p.y), `tool-${name}`);

    // ---- UX-27: hover an arc's sweep midpoint with the Line tool
    await openSeeded(cdp, docOf({ c: [0, 0, true], s: [20, 0, true], e: [0, 20, true] }, [{ id: 'A1', type: 'arc', subType: 'CENTER', joints: ['c', 's', 'e'] }]), SHAPER);
    await setView(cdp, SHAPER.canvas, 14, 14, 60);
    await tool('line');
    const mid = { x: 20 * Math.SQRT1_2, y: 20 * Math.SQRT1_2 };
    const sm = await w2s(cdp, SHAPER.canvas, mid.x, mid.y);
    await mouseMove(cdp, sm.x + 2, sm.y);
    const arcSnap = await ST(cdp, 'st.snapTarget ? { type: st.snapTarget.type, shape: st.snapTarget.shape && st.snapTarget.shape.id } : null');
    console.log(tag, 'UX-27 arc hover snap', JSON.stringify(arcSnap));
    assert.ok(arcSnap && arcSnap.type === 'midpoint' && arcSnap.shape === 'A1', `an arc's midpoint is snapped on hover: ${JSON.stringify(arcSnap)}`);
    await shot(cdp, `${tag}-ux27-arc-midpoint-snap.png`, { x: sm.x - 70, y: sm.y - 60, width: 140, height: 120 });

    // ---- UX-20: the contradictory triangle (sides 50 / 40 / 120)
    await openSeeded(cdp, docOf({ a: [0, 25, true], b: [50, 25], c: [50, 65] },
      [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['b', 'c'] }, { id: 'L3', type: 'line', joints: ['c', 'a'] }],
      [{ type: 'horizontal', joints: ['a', 'b'] }, D('a', 'b', 50, 'd1'), D('b', 'c', 40, 'd2'), D('c', 'a', 120, 'd3')]), SHAPER);
    await setView(cdp, SHAPER.canvas, 40, 30, 150);
    const cols = await cdp.evalJs(`['L1','L2','L3'].map((id) => document.querySelector('#design-canvas [data-shape-id="' + id + '"]').getAttribute('style'))`);
    console.log(tag, 'UX-20 strokes', JSON.stringify(cols));
    assert.ok(cols.every((c) => c.includes('--sk-error')), `all three sides in the error red: ${JSON.stringify(cols)}`);
    const box = await cdp.evalJs(`(() => { const r = [...document.querySelectorAll('#design-canvas [data-shape-id]')].map((e) => e.getBoundingClientRect()); return { l: Math.min(...r.map((x) => x.left)), t: Math.min(...r.map((x) => x.top)), r: Math.max(...r.map((x) => x.right)), b: Math.max(...r.map((x) => x.bottom)) }; })()`);
    await shot(cdp, `${tag}-ux20-conflict-triangle.png`, { x: box.l - 20, y: box.t - 20, width: box.r - box.l + 40, height: box.b - box.t + 40 }, 2);

    if (!touch) {
      // ---- B-18a: drag a corner (two coincident joints, a cluster) onto a line's midpoint
      await openSeeded(cdp, docOf({ a: [-10, 8, true], b: [10, 8, true], p: [-6, -6], q: [0, -6], q2: [0, -6], r: [6, -6] },
        [{ id: 'T', type: 'line', joints: ['a', 'b'] }, { id: 'L', type: 'line', joints: ['p', 'q'] }, { id: 'M', type: 'line', joints: ['q2', 'r'] }], [{ type: 'coincident', joints: ['q', 'q2'] }]), SHAPER);
      await setView(cdp, SHAPER.canvas, 0, 0, 40);
      const from = await w2s(cdp, SHAPER.canvas, 0, -6), to = await w2s(cdp, SHAPER.canvas, 0, 8);
      await mouseMove(cdp, from.x, from.y);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(from.x), y: Math.round(from.y), button: 'left', buttons: 1, clickCount: 1 });
      for (let k = 1; k <= 10; k++) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(from.x + (to.x + 4 - from.x) * k / 10), y: Math.round(from.y + (to.y - 4 - from.y) * k / 10), button: 'left', buttons: 1, clickCount: 0 });
      await new Promise((r) => setTimeout(r, 300));
      const during = await ST(cdp, '({ x: st.joints.get("q").x, y: st.joints.get("q").y, snap: st.activeSnap && st.activeSnap.type, drag: st.drag && st.drag.type })');
      console.log(tag, 'B-18a during drag', JSON.stringify(during));
      const dm = await w2s(cdp, SHAPER.canvas, 0, 8);
      await shot(cdp, `${tag}-b18a-drag-on-midpoint.png`, { x: dm.x - 70, y: dm.y - 60, width: 140, height: 120 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(to.x + 4), y: Math.round(to.y - 4), button: 'left', buttons: 0, clickCount: 1 });
      await new Promise((r) => setTimeout(r, 300));
      const after = await ST(cdp, '({ x: st.joints.get("q").x, y: st.joints.get("q").y, mids: st.constraints.filter((c) => c.type === "midpoint").length })');
      console.log(tag, 'B-18a after release', JSON.stringify(after));
      assert.ok(during.snap === 'midpoint' && Math.hypot(during.x, during.y - 8) < 1e-3, `while dragged the point sits exactly on the previewed midpoint (0, 8): ${JSON.stringify(during)}`);
      assert.ok(Math.hypot(after.x - during.x, after.y - during.y) < 1e-3 && after.mids === 1, `the drop uses that snap: ${JSON.stringify(after)}`);
    } else {
      // ---- B-20c: a finger press in the Line tool, 4 px from a line and 21 px from a free point: the point wins (priority radius 30 px, not 15)
      await openSeeded(cdp, docOf({ a: [-20, 0, true], b: [20, 0, true], p: [-5, 3.7] }, [{ id: 'T', type: 'line', joints: ['a', 'b'] }]), SHAPER);
      await setView(cdp, SHAPER.canvas, 0, 3, 60);
      const pp = await w2s(cdp, SHAPER.canvas, -5, 3.7), lp = await w2s(cdp, SHAPER.canvas, -5, 0);
      await tool('line');
      const finger = { x: pp.x, y: lp.y + (pp.y > lp.y ? 4 : -4) }; // 4 px off the line, on the point's side
      const toPoint = Math.hypot(finger.x - pp.x, finger.y - pp.y);
      console.log(tag, 'B-20c finger', JSON.stringify(finger), 'px to the point', toPoint.toFixed(1), 'px to the line 4');
      assert.ok(toPoint > 15 && toPoint < 30, `the scene is set up so the point is between 15 and 30 px away (${toPoint.toFixed(1)})`);
      await touchTap(cdp, finger.x, finger.y);
      const start = await ST(cdp, 'st.active && st.active.start');
      console.log(tag, 'B-20c the Line tool started at', JSON.stringify(start));
      assert.ok(start === 'p' || (start && start.id === 'p'), `the finger picked the point p (not the line): ${JSON.stringify(start)}`);
      await shot(cdp, `${tag}-b20c-touch-picks-point.png`, { x: pp.x - 100, y: pp.y - 80, width: 200, height: 160 });
    }
    console.log(`PASS ${tag}`);
  } finally { await cdp.close(); }
}

await run('1010s-desktop', 1280, 800, false);
await run('1010s-phone', 390, 844, true);
process.exit(0);
