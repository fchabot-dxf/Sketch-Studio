// tests/drag-undo-live.test.js -- TASK 545 (live headless, REAL pointer + key events), SketchStudio and the Shaper Design tab:
// draw two lines and a circle, then in the select tool drag a joint, a line body, a circle rim; after EACH drag the undo history grew by ONE
// step labelled by the drag kind (read from the Diagnostic Log report's journal), Ctrl+Z restores exactly the pre-drag joints and Ctrl+Y
// re-applies the drag. A click without movement adds no step.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';

const cdp = await launchBrowser({ tag: '545', width: 1600, height: 900 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, navigate } = cdp;
const EV = process.env.EVIDENCE_DIR;
const measured = {};
try {
  await send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
  const click = async (x, y) => { await mouse('mouseMoved', x, y, 0); await sleep(40); await mouse('mousePressed', x, y, 1); await sleep(40); await mouse('mouseReleased', x, y, 0); await sleep(250); };
  const centerOf = (sel) => evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  const clickEl = async (sel) => { const c = await centerOf(sel); assert(c, sel + ' not found'); await click(c.x, c.y); };
  const dragPath = async (from, to, steps = 10) => {
    await mouse('mouseMoved', from.x, from.y, 0); await sleep(40); await mouse('mousePressed', from.x, from.y, 1); await sleep(40);
    for (let i = 1; i <= steps; i++) { await mouse('mouseMoved', from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps, 1); await sleep(25); }
    await sleep(100); await mouse('mouseReleased', to.x, to.y, 0); await sleep(400);
  };
  const key = (k, code, vk, mods = 0) => sendRealKey(send, k, code, vk, mods);
  const takeReport = async () => {
    await evalJs(`document.querySelector('.sk-diag-toggle').click()`); await sleep(200);
    await clickEl('.sk-diag-btn-primary'); await sleep(500);
    const text = await evalJs(`navigator.clipboard.readText()`);
    await evalJs(`document.querySelector('.sk-diag-close').click()`); await sleep(100);
    return JSON.parse(text);
  };
  const joints = (r) => JSON.stringify(r.document.geometry.joints);
  // a circle-rim drag changes the RADIUS (a solver unknown, task 515), not a joint: the drag result is the joints AND the shapes
  const geom = (r) => joints(r) + JSON.stringify(r.document.geometry.shapes);
  const labelsOf = (r) => r.journal.steps.map((s) => s.label);

  for (const host of [
    { name: 'SketchStudio', url: '/apps/sketchstudio/index.html', canvas: 'svgCanvas', setup: async () => {} },
    { name: 'Shaper Design', url: '/apps/shaper/index.html', canvas: 'design-canvas', setup: async () => {
      await waitFor(`!!document.querySelector('[data-mode="design"]')`, 'shaper ready');
      for (let i = 0; i < 5; i++) { await clickEl('[data-mode="design"]'); await sleep(300); if (await evalJs(`document.querySelector('.mode-btn.active').dataset.mode`) === 'design') break; }
      await sleep(1500);
    } },
  ]) {
    await navigate(`http://127.0.0.1:${port}${host.url}`, 8000);
    await sleep(2500); await host.setup();
    const W2S = (x, y) => evalJs(`(() => { const s = document.getElementById('${host.canvas}'); const p = s.createSVGPoint(); p.x = ${x}; p.y = ${y}; const q = p.matrixTransform(s.getScreenCTM()); return { x: Math.round(q.x), y: Math.round(q.y) }; })()`);
    const cv = await centerOf('#' + host.canvas);
    const pre = new Set((await takeReport()).document.geometry.shapes.map((x) => x.id)); // the Shaper starts with a sample drawing
    // seed with the real tools: two lines (click, click, Escape), a circle (centre click, rim click)
    await clickEl('#tool-line');
    await click(cv.x - 250, cv.y - 150); await click(cv.x - 100, cv.y - 150); await key('Escape', 'Escape', 27); await sleep(200);
    await clickEl('#tool-line'); await click(cv.x - 250, cv.y + 50); await click(cv.x - 100, cv.y + 50); await key('Escape', 'Escape', 27); await sleep(200);
    await clickEl('#tool-circle');
    await click(cv.x + 150, cv.y); await click(cv.x + 220, cv.y); await key('Escape', 'Escape', 27);
    await clickEl('#tool-select'); await sleep(300);
    const r0 = await takeReport();
    const g0 = r0.document.geometry;
    const lines = g0.shapes.filter((s) => s.type === 'line' && !pre.has(s.id)), circ = g0.shapes.find((s) => s.type === 'circle' && !pre.has(s.id));
    assert.strictEqual(lines.length, 2, host.name + ': two lines drawn'); assert(circ, host.name + ': a circle drawn');
    const J = (id) => g0.joints.find((e) => e[0] === id)[1];
    const kinds = [
      ['joint', 'drag point', async () => { const p = await W2S(J(lines[0].joints[1]).x, J(lines[0].joints[1]).y); return [p, { x: p.x + 60, y: p.y - 50 }]; }],
      ['line body', 'drag line', async () => { const a = J(lines[1].joints[0]), b = J(lines[1].joints[1]); const p = await W2S((a.x + b.x) / 2, (a.y + b.y) / 2); return [p, { x: p.x + 40, y: p.y + 60 }]; }],
      ['circle rim', 'drag circle', async () => { const c = J(circ.joints[0]); const p = await W2S(c.x + circ.radius, c.y); return [p, { x: p.x + 50, y: p.y }]; }],
    ];
    let prev = r0;
    measured[host.name] = {};
    for (const [kind, label, plan] of kinds) {
      const [from, to] = await plan();
      await dragPath(from, to);
      const after = await takeReport();
      assert.notStrictEqual(geom(after), geom(prev), `${host.name} ${kind}: the drag moved something`);
      const result = { stepsBefore: labelsOf(prev).length, stepsAfterDrag: labelsOf(after).length, newLabels: labelsOf(after).slice(labelsOf(prev).length) };
      measured[host.name][kind] = result;
      assert.deepStrictEqual(result.newLabels, [label], `${host.name} ${kind}: ONE new undo step labelled "${label}": ${JSON.stringify(result)}`);
      await key('z', 'KeyZ', 90, 2); await sleep(300);
      const undone = await takeReport();
      result.stepsAfterUndo = labelsOf(undone).length;
      assert.strictEqual(geom(undone), geom(prev), `${host.name} ${kind}: Ctrl+Z restores exactly the pre-drag joints and shapes`);
      assert.strictEqual(labelsOf(undone).length, labelsOf(prev).length, `${host.name} ${kind}: the step is gone from the history`);
      await key('y', 'KeyY', 89, 2); await sleep(300);
      const redone = await takeReport();
      assert.strictEqual(geom(redone), geom(after), `${host.name} ${kind}: Ctrl+Y re-applies the drag`);
      prev = redone;
    }
    // a click on a joint without movement: no step
    const p = await W2S(J(lines[0].joints[0]).x, J(lines[0].joints[0]).y);
    await click(p.x, p.y);
    assert.strictEqual(labelsOf(await takeReport()).length, labelsOf(prev).length, host.name + ': a click without movement adds no step');
    if (EV) { const png = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(EV, `drag-undo-${host.name.replace(/\W/g, '')}.png`), Buffer.from(png.data, 'base64')); }
  }
  console.log('drag-undo-live.test.js: ok', JSON.stringify(measured));
  if (EV) fs.writeFileSync(path.join(EV, 'drag-undo-live.json'), JSON.stringify(measured, null, 1));
} finally {
  await cdp.close();
}
process.exit(0);
