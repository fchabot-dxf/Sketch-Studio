// tests/stock-loop-live.test.js — TASK 472, trimmed in TASK 583: what only a BROWSER can check of Stock as a cut type (headless Edge, software WebGL): the
// Stock loop's drawn look in Prepare (warm tan, dashed: CSS) and the Review showing the board as that irregular profile in 3D. Picking Stock with real clicks, the
// role moving with its notice, exactly one Stock and Ctrl+Z are tests/stock-loop-node.test.js. The Stock is set here directly in the cut plan (setup).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';

await (async () => {
  const cdp = await launchBrowser({
    tag: '472', width: 1400, height: 800,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;
  try {
    const mouse = async (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: (buttons || type === 'mouseReleased') ? 'left' : 'none', buttons, clickCount: (buttons || type === 'mouseReleased') ? 1 : 0 });
    const clickEl = async (sel) => {
      const c = await evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`);
      assert(c, sel + ' not found');
      await mouse('mouseMoved', c.x, c.y); await mouse('mousePressed', c.x, c.y, 1); await mouse('mouseReleased', c.x, c.y); await sleep(200);
    };
    const openMode = async (mode) => { // real click; retry because the nav shifts while the page's late widgets mount
      for (let i = 0; i < 5; i++) {
        await clickEl(`.sk-header-tab[data-tab="${mode}"]`); await sleep(300);
        if (await evalJs(`document.querySelector('.sk-header-tab.active').dataset.tab`) === mode) return;
      }
      assert.fail('could not open the ' + mode + ' tab');
    };
    const shot = async (name) => {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      const buf = Buffer.from(r.data, 'base64');
      if (process.env.EVIDENCE_DIR) fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name), buf);
      return { md5: createHash('md5').update(buf).digest('hex'), bytes: buf.length };
    };

    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 8000);
    await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'shaper app ready');
    await openMode('design');
    await waitFor('!!(window.__designController && window.__designController.state)', 'design controller ready');
    // seed: A = an L-shaped outline (the board), B = a 20x20 loop drawn INSIDE it (a part, NOT a hole), C = a separate rectangle
    await evalJs(`(() => {
      const st = window.__designController.state;
      for (const k of [...st.joints.keys()]) st.joints.delete(k);
      st.shapes.length = 0; st.constraints.length = 0;
      const poly = (p, pts) => { pts.forEach(([x, y], i) => st.joints.set(p + i, { x, y })); pts.forEach((_, i) => st.shapes.push({ id: p + 's' + i, type: 'line', joints: [p + i, p + ((i + 1) % pts.length)] })); };
      poly('A', [[0, 0], [120, 0], [120, 60], [60, 60], [60, 120], [0, 120]]);
      poly('B', [[10, 10], [30, 10], [30, 30], [10, 30]]);
      poly('C', [[160, 0], [200, 0], [200, 40], [160, 40]]);
    })()`);
    await openMode('prepare');
    await waitFor(`!!document.getElementById('prepare-canvas').getScreenCTM() && document.getElementById('prepare-canvas').children.length > 0`, 'prepare canvas ready');
    // setup: the L loop is the Stock (what picking Stock on it in Prepare stores: tests/stock-loop-node.test.js), 0.5 in thick
    await evalJs(`(async () => { const plan = await import('/apps/shaper/src/cut-plan.js'); const { findLoops } = await import('#core/loop-finder.js'); const { loopPolygon } = await import('#core/loop-geometry.js');
      const st = window.__designController.state; const sb = new Map(st.shapes.map((x) => [x.id, x]));
      const a = findLoops(st).map((l) => ({ ...l, polygon: loopPolygon(l, st, sb) })).find((l) => Math.max(...l.polygon.map((p) => p.x)) === 120);
      plan.CUT_PLAN.set(plan.keyOf('loop', a.id), { cutType: 'stock', cutDepth: 12.7, cutOffset: 0, toolDia: 3.175, cutterShape: 'endmill', cutterAngle: 90 });
      window.__prepareView.refreshLook(); })()`);
    // the Stock loop keeps its distinct look when not selected: warm tan dashed edge + label
    await waitFor(`(() => { const e = document.querySelector('#prepare-canvas .sk-edge-stock'); return !!e && /227, 184, 115/.test(getComputedStyle(e).stroke); })()`, 'the unselected Stock edge is drawn');
    const idleEdge = await evalJs(`(() => { const e = document.querySelector('#prepare-canvas .sk-edge-stock'); if (!e) return null; const cs = getComputedStyle(e); return { stroke: cs.stroke, dash: cs.strokeDasharray }; })()`);
    console.log('idle stock edge:', JSON.stringify(idleEdge));
    assert.ok(idleEdge && /227, 184, 115/.test(idleEdge.stroke) && idleEdge.dash !== 'none', 'the unselected Stock loop is drawn warm tan and dashed');
    assert.ok(await evalJs(`!!document.querySelector('#prepare-canvas .sk-stock-label')`), 'and carries its STOCK label');
    if (process.env.EVIDENCE_DIR) { const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 44, width: 1400, height: 750, scale: 1 } }); fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, 'prepare-stock-idle.png'), Buffer.from(r.data, 'base64')); }

    // a pocket part inside the board (B), then the Review: the board IS the L profile
    await evalJs(`(async () => { const plan = await import('/apps/shaper/src/cut-plan.js'); const { findLoops } = await import('#core/loop-finder.js'); const { loopPolygon } = await import('#core/loop-geometry.js');
      const st = window.__designController.state; const sb = new Map(st.shapes.map((x) => [x.id, x]));
      const b = findLoops(st).map((l) => ({ ...l, polygon: loopPolygon(l, st, sb) })).find((l) => Math.min(...l.polygon.map((p) => p.x)) === 10);
      plan.CUT_PLAN.set(plan.keyOf('loop', b.id), { cutType: 'pocket', cutDepth: 5, cutOffset: 0, toolDia: 3.175, cutterShape: 'endmill', cutterAngle: 90 }); })()`);
    await openMode('review');
    await waitFor(`/triangles/.test(document.getElementById('review-info').textContent)`, 'review built');
    const infoText = await evalJs(`document.getElementById('review-info').textContent`);
    console.log('review info:', infoText);
    assert.match(infoText, /Board: your Stock loop/, 'the Review builds the board from the Stock loop');
    assert.strictEqual(await evalJs(`document.getElementById('review-stock-thickness').disabled`), true, 'the thickness is set on the loop, not here');
    assert.strictEqual(await evalJs(`document.getElementById('review-stock-thickness').value`), '0.500');
    assert.match(await evalJs(`document.getElementById('review-stock-note').textContent`), /Stock loop/);
    await clickEl('#review-top'); await sleep(400);
    const topShot = await shot('review-stock-top.png');
    await clickEl('#review-reset'); await sleep(400);
    const c = await evalJs(`(() => { const r = document.querySelector('#review-canvas-host canvas').getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`);
    await mouse('mouseMoved', c.x, c.y); await mouse('mousePressed', c.x, c.y, 1);
    for (let k = 1; k <= 10; k++) { await mouse('mouseMoved', c.x - k * 8, c.y + k * 5, 1); await sleep(30); }
    await mouse('mouseReleased', c.x - 80, c.y + 50); await sleep(500);
    const orbitShot = await shot('review-stock-orbit.png');
    assert.notStrictEqual(topShot.md5, orbitShot.md5, 'the orbit differs from the top view');
    console.log(`stock-loop-live: ok (top ${topShot.md5}, orbit ${orbitShot.md5})`);
  } finally {
    await cdp.close();
  }
})();
