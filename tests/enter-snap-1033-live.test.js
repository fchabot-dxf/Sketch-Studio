// tests/enter-snap-1033-live.test.js — TASK 1033 (X-01), live headless, REAL mouse / keys / touch via CDP, Pen Plotter = the shared Design tab.
//   desktop 1280x800: each draw tool's step on line L2 (or point jp), by a CLICK and by ENTER in the value box at the same point (nothing typed):
//     the identical constraint list, the snap's point-on-line included (Enter used to drop it).
//   phone 390x844 (a guard, advisor ruling): (a) a tap, then a finger drag whose last point is on L2, lifted: the same constraints as the desktop
//     click (the touch commit path is the click's); (b) the Done check of a Slot (the one Done that steps at the preview point: the width step,
//     which takes no snap by click either) gives the constraints a width tap gives.
// The node twin with every tool variant and the typed cases: tests/enter-snap-1033-node.test.js. Evidence: .evidence/1033/live-*.png
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const EVID = path.resolve('.evidence/1033');
fs.mkdirSync(EVID, { recursive: true });
const STATE = 'window.__sketch.controller.state';
const failures = [];
const check = (ok, msg) => { if (!ok) { failures.push(msg); console.log('  FAIL ' + msg); } else console.log('  ok ' + msg); };

// The cases, in sketch units (u): L2 = the line x = 40, y -30..30 between fixed points jc / jd; jp = a lone fixed point (-30, 25).
const ON_L2 = [40, 10];
const CASES = [
  { name: 'Line end on L2', tool: 'line', steps: [[10, -10], { test: ON_L2 }] },
  { name: 'Rect 2-point corner on L2', tool: 'rect', mode: `rectMode = 'rect-2pt'`, steps: [[10, -10], { test: ON_L2 }] },
  { name: 'Circle rim on jp', tool: 'circle', steps: [[-30, 5], { test: [-30, 25] }] },
  { name: 'Polygon corner on L2', tool: 'polygon', steps: [[10, 3], { test: ON_L2 }] },
  { name: 'Arc (centre) end on L2', tool: 'arc', mode: `arcMode = 'arc-cse'`, steps: [[10, 5], [10, -25], { via: [25, -20] }, { via: [35, -10] }, { test: [40, 5] }] },
  { name: 'Slot span end on L2', tool: 'slot', mode: `slotMode = 'slot-c2c'`, steps: [[10, 7], { test: [40, 7] }, [25, 12]] },
];

async function phase({ width, height, tag }) {
  const isPhone = width <= 640;
  const cdp = await launchBrowser({ tag: `1033-${tag}`, width, height });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
  const { port, send, evalJs, waitFor, waitForApp, navigate, close } = cdp;
  const mouse = (type, p, buttons = 0) => send('Input.dispatchMouseEvent', { type, x: Math.round(p.x), y: Math.round(p.y), button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
  const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: Math.round(p.x), y: Math.round(p.y), id: i + 1, radiusX: 1, radiusY: 1, force: 1 })) });
  const click = async (p) => { await mouse('mouseMoved', p); await sleep(50); await mouse('mousePressed', p, 1); await sleep(40); await mouse('mouseReleased', p); await sleep(180); };
  const move = async (p) => { await mouse('mouseMoved', p); await sleep(80); };
  const tap = async (p) => { await T('touchStart', [p]); await sleep(50); await T('touchEnd', []); await sleep(220); };
  const fingerDrag = async (from, to) => {
    await T('touchStart', [from]); await sleep(40);
    for (let i = 1; i <= 6; i++) { await T('touchMove', [{ x: from.x + (to.x - from.x) * i / 6, y: from.y + (to.y - from.y) * i / 6 }]); await sleep(30); }
    await T('touchEnd', []); await sleep(240);
  };
  const shot = async (name) => { const { data } = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(EVID, `live-${name}-${tag}.png`), Buffer.from(data, 'base64')); };
  const results = {};
  try {
    if (isPhone) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    }
    await resetBufferLive(cdp);   // the four apps share one list of open tabs (task 684)
    await navigate(`http://127.0.0.1:${port}/apps/penplotter/index.html`, 10000);
    await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'the stage button');
    await evalJs(`document.querySelector('.sk-header-tab[data-tab="design"]').click()`);
    await waitForApp('design-canvas');
    await waitFor(`!!window.__sketch && !!window.__sketch.controller && document.getElementById('design-canvas').getBoundingClientRect().width > 0`, 'the design canvas');
    await sleep(300);
    // the sketch units, laid over the canvas's current view: centre = the view's centre, 1 u = 1/120 of the view's width
    const view = await evalJs(`(() => { const vb = document.getElementById('design-canvas').viewBox.baseVal; return { cx: vb.x + vb.width * 0.55, cy: vb.y + vb.height * 0.5, k: vb.width / 120 }; })()`);
    const world = (u) => ({ x: view.cx + u[0] * view.k, y: view.cy + u[1] * view.k });
    const S = (u) => { const w = world(u); return evalJs(`(() => { const s = document.getElementById('design-canvas'), vb = s.viewBox.baseVal, r = s.getBoundingClientRect(); return { x: r.left + (${w.x} - vb.x) / vb.width * r.width, y: r.top + (${w.y} - vb.y) / vb.height * r.height }; })()`); };
    const setupDoc = () => {
      const [c, d, p] = [world([40, -30]), world([40, 30]), world([-30, 25])];
      return evalJs(`(() => { const st = ${STATE}; st.clearDocument();
        st.joints.set('jc', { x: ${c.x}, y: ${c.y}, fixed: true, sketchId: st.activeSketchId }); st.joints.set('jd', { x: ${d.x}, y: ${d.y}, fixed: true, sketchId: st.activeSketchId });
        st.joints.set('jp', { x: ${p.x}, y: ${p.y}, fixed: true, sketchId: st.activeSketchId });
        st.shapes.push({ id: 'L2', type: 'line', joints: ['jc', 'jd'], sketchId: st.activeSketchId }); st.triggerDraw && st.triggerDraw(); return st.constraints.length; })()`);
    };
    // the new constraints as `type@existing ids it binds` (L2 / jc / jd / jp / the origin), sorted
    const newConstraints = (n0) => evalJs(`(() => { const EX = new Set(['j_origin', 'jc', 'jd', 'jp', 'L2']); const out = [];
      for (const c of ${STATE}.constraints.slice(${n0})) { const b = []; const walk = (v) => { if (typeof v === 'string') { if (EX.has(v)) b.push(v); } else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
        for (const [k, v] of Object.entries(c)) if (k !== 'id' && k !== 'type') walk(v); out.push(c.type + (b.length ? '@' + b.sort().join('+') : '')); }
      return out.sort(); })()`);
    const shapesCount = () => evalJs(`${STATE}.shapes.length`);
    const escape = async () => { await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(120); await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(150); };
    const pickTool = async (c) => {
      await evalJs(`document.getElementById('tool-${c.tool}').click()`); await sleep(150);
      if (c.mode) await evalJs(`${STATE}.${c.mode}`);
      await evalJs(`${STATE}.currentTool`).then((t) => assert.strictEqual(t, c.tool, `the ${c.tool} tool is on`));
    };

    if (!isPhone) {
      for (const c of CASES) {
        for (const how of ['click', 'enter']) {
          const n0 = await setupDoc(); await sleep(150);
          await pickTool(c);
          const s0 = await shapesCount();
          let shown = null;
          for (const s of c.steps) {
            if (Array.isArray(s)) await click(await S(s));
            else if (s.via) await move(await S(s.via));
            else {
              const b = await S(s.test); await move({ x: b.x + 3, y: b.y + 3 }); await move(b);
              shown = await evalJs(`${STATE}.snapTarget ? ${STATE}.snapTarget.type : 'none'`);
              if (how === 'click') await click(b);
              else {
                const box = await evalJs(`(() => { const a = document.activeElement; return !!a && a.matches('.dim-input, .sk-dual-input input'); })()`);
                check(box, `[${tag}] ${c.name}: the value box has the keyboard for Enter`);
                await sendRealKey(send, 'Enter', 'Enter', 13, 0, '\r'); await sleep(250);
              }
            }
          }
          const r = { shapes: (await shapesCount()) - s0, constraints: await newConstraints(n0), shown };
          if (c === CASES[0] || c === CASES[1]) await shot(`${c.tool}-${how}`);
          results[`${c.name}|${how}`] = r;
          await escape();
        }
        const a = results[`${c.name}|click`], b = results[`${c.name}|enter`];
        console.log(`  ${c.name}: click ${JSON.stringify(a)}  enter ${JSON.stringify(b)}`);
        check(a.shown !== 'none' && a.shown === b.shown, `[${tag}] ${c.name}: the snap shows at the point (click ${a.shown}, enter ${b.shown})`);
        check(a.shapes > 0 && a.shapes === b.shapes, `[${tag}] ${c.name}: the same shapes (${a.shapes} / ${b.shapes})`);
        check(a.constraints.some((t) => /^pointOnLine@(L2|jp)$/.test(t)), `[${tag}] ${c.name}: the click binds the snapped geometry`);
        check(JSON.stringify(a.constraints) === JSON.stringify(b.constraints), `[${tag}] ${c.name}: Enter gives the click's constraints`);
      }
    } else {
      // (a) a tap, then a finger drag ending on L2, lifted: the touch commit path
      for (const c of CASES.filter((x) => x.tool === 'line' || x.tool === 'rect')) {
        const n0 = await setupDoc(); await sleep(150);
        await pickTool(c);
        const s0 = await shapesCount();
        await tap(await S(c.steps[0]));
        const from = await S([-5, -25]), to = await S(c.steps[1].test);   // up-left of the first tap: clear of the value box beside it
        await fingerDrag(from, to);
        const r = { shapes: (await shapesCount()) - s0, constraints: await newConstraints(n0) };
        await shot(`${c.tool}-finger`);
        results[`${c.name}|finger`] = r;
        console.log(`  ${c.name}: finger ${JSON.stringify(r)}`);
        await escape();
      }
      // (b) Slot: tap the first centre, finger drag onto L2 for the span end, then the width step by a TAP, and again by the Done check
      const c = CASES.find((x) => x.tool === 'slot');
      for (const how of ['tap', 'done']) {
        const n1 = await setupDoc(); await sleep(150);
        await pickTool(c);
        const s0 = await shapesCount();
        await tap(await S(c.steps[0]));
        await fingerDrag(await S([25, -15]), await S(c.steps[1].test));
        if (how === 'tap') await tap(await S(c.steps[2]));
        else {
          const done = await waitFor(`(() => { const b = document.querySelector('.sk-done'); return !!b && !b.hidden && b.getClientRects().length > 0; })()`, 'the Done check shows at the slot width step').then(() => true, () => false);
          check(done, `[${tag}] Slot: the Done check shows at the width step`);
          if (done) {
            const at = await evalJs(`(() => { const r = document.querySelector('.sk-done').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
            await shot('slot-done-before');
            await tap(at);
          }
        }
        const r = { shapes: (await shapesCount()) - s0, constraints: await newConstraints(n1) };
        await shot(`slot-${how}`);
        results[`Slot span end on L2|${how}`] = r;
        console.log(`  Slot: ${how} ${JSON.stringify(r)}`);
        await escape();
      }
    }
  } finally { await close(); }
  return results;
}

const desktop = await phase({ width: 1280, height: 800, tag: 'desktop' });
const phone = await phase({ width: 390, height: 844, tag: 'phone' });
for (const name of ['Line end on L2', 'Rect 2-point corner on L2']) {
  const a = desktop[`${name}|click`], f = phone[`${name}|finger`];
  check(!!f && f.shapes === a.shapes, `[phone] ${name}: the finger drag-lift places the click's shapes (${f && f.shapes} / ${a.shapes})`);
  check(!!f && JSON.stringify(f.constraints) === JSON.stringify(a.constraints), `[phone] ${name}: the finger drag-lift gives the desktop click's constraints (${f && f.constraints})`);
}
{
  const t = phone['Slot span end on L2|tap'], d = phone['Slot span end on L2|done'];
  check(!!t && t.shapes > 0 && t.constraints.includes('pointOnLine@L2'), `[phone] Slot: the finger drag-lift onto L2 kept the span-end snap (${t && t.constraints})`);
  check(!!d && !!t && d.shapes === t.shapes, `[phone] Slot: Done places the width tap's shapes (${d && d.shapes} / ${t && t.shapes})`);
  check(!!d && !!t && JSON.stringify(d.constraints) === JSON.stringify(t.constraints), `[phone] Slot: Done gives the width tap's constraints (${d && d.constraints})`);
}
assert.deepStrictEqual(failures, [], `${failures.length} check(s) failed`);
console.log('enter-snap-1033-live: PASS');
process.exit(0);
