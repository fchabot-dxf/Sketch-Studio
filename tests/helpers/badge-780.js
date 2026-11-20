// tests/helpers/badge-780.js — TASK 780: the depth badge keeps clear of the pocket start mark (shared by the desktop and phone tests).
// Seeds an Outside cut, a Spiral + Loop pocket and a Raster pocket, selects each, and measures the badge (.sk-chip-bg) against the
// start mark (.sk-pocket-start) with getBoundingClientRect at 1x, after zooming in and after zooming out.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { sleep } from './cdp-browser.js';

// expectOutsideAt: the Outside cut's badge position (world units) measured on origin/main BEFORE the change; it must not move.
export async function runBadge780(cdp, { phone, shotPrefix, expectOutsideAt }) {
  const { send, evalJs, waitFor } = cdp;
  const evidence = path.resolve('.evidence/780');
  fs.mkdirSync(evidence, { recursive: true });
  const shot = async (name, sel) => {
    const clip = await evalJs(`(() => { const r = document.querySelector('${sel}').getBoundingClientRect(); const pad = 40; return { x: Math.max(0, r.left - pad), y: Math.max(0, r.top - pad), width: r.width + 2 * pad, height: r.height + 2 * pad, scale: 3 }; })()`);
    const { data } = await send('Page.captureScreenshot', { format: 'png', clip });
    const file = path.join(evidence, shotPrefix + name);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    console.log('screenshot ' + file);
  };
  const press = async (x, y) => {
    if (phone) {
      const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
      await T('touchStart', [{ x, y }]); await sleep(35); await T('touchEnd', []); await sleep(250);
      return;
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(35);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(200);
  };
  const toScreen = (x, y) => evalJs(`(() => { const s = document.getElementById('prepare-canvas'); const p = s.createSVGPoint(); p.x = ${x}; p.y = ${y}; const q = p.matrixTransform(s.getScreenCTM()); return { x: Math.round(q.x), y: Math.round(q.y) }; })()`);
  const pressWorld = async (x, y) => { const p = await toScreen(x, y); await press(p.x, p.y); };

  await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('DOC_UNIT', 'in'))`);
  await evalJs(`(async () => {
    const { findLoops } = await import('/packages/core/loop-finder.js');
    const { V2_PLAN, keyOf } = await import('/tests/helpers/plan-v2.js');
    const st = window.__designController.state;
    for (const k of [...st.joints.keys()]) if (k !== 'j_origin') st.joints.delete(k);
    st.shapes.length = 0; st.constraints.length = 0; V2_PLAN.clear();
    let n = 0;
    const J = (x, y) => { const id = 'bj' + (++n); st.joints.set(id, { x, y }); return id; };
    const line = (a, b) => { const id = 'bs' + (++n); st.shapes.push({ id, type: 'line', joints: [a, b] }); return id; };
    const rect = (x, y, w, h) => { const p = [J(x, y), J(x + w, y), J(x + w, y + h), J(x, y + h)]; return [0, 1, 2, 3].map((i) => line(p[i], p[(i + 1) % 4]))[0]; };
    const eOut = rect(0, 0, 50, 40), eSpir = rect(70, 0, 60, 45), eRast = rect(150, 0, 60, 45);
    st.saveState('seed780');
    const loops = findLoops(st);
    const kOf = (edge) => keyOf('loop', loops.find((l) => l.edges.includes(edge)).id);
    const base = { cutDepth: 3.175, cutOffset: 0, toolDia: 3.175, cutterShape: 'endmill', cutterAngle: 90 };
    V2_PLAN.set(kOf(eOut), { ...base, cutType: 'exterior' });
    V2_PLAN.set(kOf(eSpir), { ...base, cutType: 'pocket', clearing: 'linked', stepover: 50, finishAllowance: 0.5, loop: true });
    V2_PLAN.set(kOf(eRast), { ...base, cutType: 'pocket', clearing: 'raster', stepover: 50, finishAllowance: 0.5, rasterAngle: 0, loop: false });
  })()`);
  if (phone) {
    await evalJs(`document.querySelector('.sk-sidebar-handle').click()`); await sleep(250);
    await evalJs(`document.querySelector('.sk-sidebar-stage[data-tab="prepare"]').click()`); await sleep(350);
    if (await evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`)) { await evalJs(`document.querySelector('.sk-sidebar-scrim').click()`); await sleep(250); }
  } else await evalJs(`document.querySelector('.sk-header-tab[data-tab="prepare"]').click()`);
  await waitFor(`!!document.querySelector('#prepare-canvas .sk-edge') && !!document.getElementById('prepare-canvas').getScreenCTM()`, 'prepare ready');

  const rects = () => evalJs(`(() => {
    const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
    const chips = document.querySelectorAll('#prepare-canvas .sk-chip-bg');
    return { chips: chips.length, chip: r(chips[0]), marks: document.querySelectorAll('#prepare-canvas .sk-pocket-start').length, mark: r(document.querySelector('#prepare-canvas .sk-pocket-start')),
      chipAt: chips[0] ? chips[0].parentNode.getAttribute('transform') : null };
  })()`);
  const intersects = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
  // On the phone the cut card covers the right of the canvas: centre the world point in the free strip to its left (the card's left edge / 2).
  const at = async (cx, cy, w) => {
    await evalJs(`(() => { const c = document.getElementById('prepare-canvas').getBoundingClientRect(), card = document.querySelector('#prepare-panel .cut-card');
      const open = ${phone} && card && !card.hidden, strip = open ? card.getBoundingClientRect().left / 2 : c.left + c.width / 2, k = c.width / ${w};
      window.__prepareView.setView({ x: ${cx} + (c.left + c.width / 2 - strip) / k, y: ${cy}, w: ${w} }); })()`);
    await sleep(250);
  };

  // Outside cut (no start mark): its badge sits at the stable default anchor.
  await at(25, 20, 120); await pressWorld(25, 10);
  const out = await rects();
  assert.strictEqual(out.chips, 1, 'Outside: one badge'); assert.strictEqual(out.marks, 0, 'Outside: no start mark');
  await shot('outside-badge.png', '#prepare-canvas .sk-chip');
  const outAt = out.chipAt;
  assert.strictEqual(outAt.replace(/ scale\(.*/, ''), expectOutsideAt, 'Outside badge keeps its position');

  for (const [name, cx, cy] of [['spiral-loop', 100, 22.5], ['raster', 180, 22.5]]) {
    for (const [label, w] of [['1x', 120], ['zoomed-in', 14], ['zoomed-out', 600]]) {
      await at(cx, cy, w); await pressWorld(cx, cy);
      const m = await rects();
      assert.strictEqual(m.chips, 1, `${name} ${label}: one badge`);
      assert.strictEqual(m.marks, 1, `${name} ${label}: one start mark`);
      if (label !== 'zoomed-out') await shot(`${name}-${label}.png`, '#prepare-canvas .sk-pocket-start');
      assert.ok(!intersects(m.chip, m.mark), `${name} ${label}: badge ${JSON.stringify(m.chip)} clear of start mark ${JSON.stringify(m.mark)}`);
    }
  }
  // Back on the Outside cut: its badge did not move.
  await at(25, 20, 120); await pressWorld(25, 10);
  assert.strictEqual((await rects()).chipAt, outAt, 'Outside badge unchanged after the pocket selections');
  return { outAt };
}
