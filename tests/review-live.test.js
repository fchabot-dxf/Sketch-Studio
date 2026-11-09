// tests/review-live.test.js — TASK 459: the Review tab in the REAL app (headless Edge, software WebGL): a real tab click builds the
// 3D workpiece from the cut plan, a real mouse drag orbits it, Reset/Top change the view.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';

await (async () => {
  const cdp = await launchBrowser({
    tag: '459', width: 1400, height: 800,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], // software WebGL for the headless run
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
        await clickEl(`[data-mode="${mode}"]`); await sleep(300);
        if (await evalJs(`document.querySelector('.mode-btn.active').dataset.mode`) === mode) return;
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
    await waitFor(`!!document.querySelector('[data-mode="design"]')`, 'shaper app ready');
    await openMode('design');
    await waitFor('!!(window.__designController && window.__designController.state)', 'design controller ready');
    // seed: A = 40x40 square (Inside, depth unset -> through), B = 50x60 pocket 8 deep with a 20x20 ISLAND
    await evalJs(`(() => {
      const st = window.__designController.state;
      for (const k of [...st.joints.keys()]) st.joints.delete(k);
      st.shapes.length = 0; st.constraints.length = 0;
      const rect = (p, x, y, w, h) => { const n = [p+'a', p+'b', p+'c', p+'d']; [[0,0],[w,0],[w,h],[0,h]].forEach(([dx,dy], i) => st.joints.set(n[i], { x: x+dx, y: y+dy })); [0,1,2,3].forEach((i) => st.shapes.push({ id: p+'s'+i, type: 'line', joints: [n[i], n[(i+1)%4]] })); };
      rect('A', 0, 0, 40, 40); rect('B', 70, 0, 50, 60); rect('I', 85, 20, 20, 20);
    })()`);
    await openMode('prepare');
    await waitFor(`document.querySelectorAll('#prepare-canvas .sk-edge').length >= 12`, 'Prepare shows the seeded geometry');
    await evalJs(`(async () => {
      const plan = await import('/apps/shaper/src/cut-plan.js');
      const { findLoops } = await import('#core/loop-finder.js');
      const { loopPolygon } = await import('#core/loop-geometry.js');
      const stt = window.__designController.state;
      const loops = findLoops(stt).map((l) => ({ ...l, polygon: loopPolygon(l, stt, new Map(stt.shapes.map((sh) => [sh.id, sh]))) }));
      const minX = (l) => Math.min(...l.polygon.map((p) => p.x));
      const A = loops.find((l) => Math.abs(minX(l) - 0) < 1e-6), B = loops.find((l) => Math.abs(minX(l) - 70) < 1e-6);
      plan.CUT_PLAN.set(plan.keyOf('loop', A.id), { cutType: 'interior', cutDepth: 'unset', cutOffset: 0, toolDia: 3.175 });
      plan.CUT_PLAN.set(plan.keyOf('loop', B.id), { cutType: 'pocket', cutDepth: 8, cutOffset: 0, toolDia: 6.35 });
    })()`);
    await openMode('review');
    await waitFor(`/triangles/.test(document.getElementById('review-info').textContent)`, 'the Review model info', 10000);
    const infoText = await evalJs(`document.getElementById('review-info').textContent`);
    console.log('review info:', infoText);
    assert.match(infoText, /\d+ triangles/, 'the Review built a model: ' + infoText);
    const tri = Number(/(\d+) triangles/.exec(infoText)[1]), ms = Number(/built in (\d+) ms/.exec(infoText)[1]);
    assert.ok(tri > 100 && tri < 100000, 'triangle count within budget: ' + tri);
    assert.ok(/depth unset shown cut through/.test(infoText), 'the unset Inside is flagged: ' + infoText);

    await clickEl('#review-reset'); await sleep(400); // lets the 3D view render before the screenshot (no DOM state to wait on)
    const resetShot = await shot('review-reset.png');
    const c = await evalJs(`(() => { const r = document.querySelector('#review-canvas-host canvas').getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`);
    await mouse('mouseMoved', c.x, c.y); await mouse('mousePressed', c.x, c.y, 1); // a real left-button drag = orbit
    for (let k = 1; k <= 12; k++) { await mouse('mouseMoved', c.x - k * 14, c.y - k * 5, 1); await sleep(30); }
    await mouse('mouseReleased', c.x - 168, c.y - 60); await sleep(500); // render settle before the screenshot
    const orbitShot = await shot('review-orbit.png');
    await clickEl('#review-top'); await sleep(400); // render settle before the screenshot
    const topShot = await shot('review-top.png');
    console.log(`review top ${topShot.md5} (${topShot.bytes} B) orbit ${orbitShot.md5} (${orbitShot.bytes} B) reset ${resetShot.md5}`);
    assert.notStrictEqual(resetShot.md5, orbitShot.md5, 'orbiting changed the picture');
    assert.notStrictEqual(orbitShot.md5, topShot.md5, 'Top changed the picture');

    // TASK 497: the Wood toggle on the real board (a second view mounted by the test, with a long-X stock): flat first, then map on / off
    const wood = await evalJs(`(async () => {
      const { mountReviewView } = await import('/apps/shaper/src/review-view.js');
      const host = document.createElement('div'); host.style.cssText = 'width:300px;height:200px;position:fixed;left:0;top:0'; document.body.appendChild(host);
      const v = await mountReviewView({ host, info: document.createElement('div'), getInputs: () => ({ stock: { thickness: 18, width: 500, height: 200 }, bounds: { minX: 0, maxX: 100, minY: 0, maxY: 50 }, items: [] }) });
      v.refresh('wood');
      const first = v.inspect();
      for (let i = 0; i < 100 && !(v.inspect().mapLoaded && v.inspect().edgeLoaded); i++) await new Promise((r) => setTimeout(r, 100));
      const on = v.inspect(); v.setWood(false); const off = v.inspect(); v.setWood(true); const back = v.inspect();
      v.destroy(); host.remove();
      return { first, on, off, back };
    })()`);
    assert.strictEqual(wood.on.mapLoaded, true, 'the texture loads');
    assert.strictEqual(wood.on.mapOn, true, 'Wood on: the face map is set');
    assert.strictEqual(wood.off.mapOn, false, 'Wood off: flat colour');
    assert.strictEqual(wood.back.mapOn, true, 'Wood back on');
    assert.strictEqual(wood.on.edgeMapOn, true, 'Wood on: the edge ply texture is set');
    assert.strictEqual(wood.off.edgeMapOn, false, 'Wood off: the edge is flat too');
    assert.strictEqual(wood.on.edgeLoaded, true, 'the edge texture loads');
    assert.ok(Math.abs(wood.on.top.v - wood.on.top.x / 400) < 1e-4 && Math.abs(wood.on.top.u - wood.on.top.z / 400) < 1e-4, 'top uv = x/TILE, z/TILE (swapped for a long-X board): ' + JSON.stringify(wood.on.top));

    await evalJs(`localStorage.setItem('shaper-mode', 'simexport')`); // the stored tab name migrates
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 8000);
    await waitFor(`!!document.querySelector('.mode-btn.active') && !!document.getElementById('review-info')`, 'shaper app ready after the reload');
    assert.strictEqual(await evalJs(`document.querySelector('.mode-btn.active').dataset.mode`), 'review', "a stored 'simexport' opens Review");
    console.log(`review-live: ok (${tri} triangles, ${ms} ms)`);
  } finally {
    await cdp.close();
  }
})();
