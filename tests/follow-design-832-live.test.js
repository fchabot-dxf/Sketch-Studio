// tests/follow-design-832-live.test.js — TASK 832 (owner turns 2955-2965), in the real Shaper page (headless Edge): three identical 1 in squares (rect + two dimensions
// each), each in its own Pocket (0.125 / 0.25 / 0.375 in); in Design, the first square's corner DRAGGED onto the origin, then a corner of each other square dragged
// onto that corner (real mouse: the snap makes the coincident), so the three squares sit exactly on top of each other; back in Prepare, each Pocket still cuts its
// own square at its own depth: its row reads "1 region" (before task 832: "1 shape: nothing to cut", no path drawn) and its paths are drawn. The rules and the
// edit matrix are tests/follow-design-832-node.test.js. With EVIDENCE_DIR set, the screenshots go there.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';

await (async () => {
  const cdp = await launchBrowser({ tag: '832', width: 1400, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;
  try {
    const mouse = async (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: (buttons || type === 'mouseReleased') ? 'left' : 'none', buttons, clickCount: (buttons || type === 'mouseReleased') ? 1 : 0 });
    const clickEl = async (sel) => {
      const c = await evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`);
      assert(c, sel + ' not found');
      await mouse('mouseMoved', c.x, c.y); await mouse('mousePressed', c.x, c.y, 1); await mouse('mouseReleased', c.x, c.y); await sleep(200);
    };
    const openMode = async (mode) => {
      for (let i = 0; i < 5; i++) {
        await clickEl(`.sk-header-tab[data-tab="${mode}"]`); await sleep(300);
        if (await evalJs(`document.querySelector('.sk-header-tab.active').dataset.tab`) === mode) return;
      }
      assert.fail('could not open the ' + mode + ' tab');
    };
    const shot = async (name, clip) => {
      const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
      const buf = Buffer.from(r.data, 'base64');
      if (process.env.EVIDENCE_DIR) fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name), buf);
      return createHash('md5').update(buf).digest('hex');
    };
    // a joint's screen point on the Design canvas (the page's own coords)
    const screenOf = (jid) => evalJs(`import('/packages/ui/coords.js').then(({ worldToScreen }) => { const c = window.__designController, j = c.state.joints.get(${JSON.stringify(jid)}); const p = worldToScreen(c.svg, j); return { x: Math.round(p.x), y: Math.round(p.y) }; })`);
    const drag = async (from, to) => {
      const a = await screenOf(from), b = await screenOf(to);
      await mouse('mouseMoved', a.x, a.y); await sleep(80); await mouse('mousePressed', a.x, a.y, 1); await sleep(80);
      for (let k = 1; k <= 12; k++) { await mouse('mouseMoved', Math.round(a.x + (b.x - a.x) * k / 12), Math.round(a.y + (b.y - a.y) * k / 12), 1); await sleep(30); }
      await sleep(150); await mouse('mouseReleased', b.x, b.y); await sleep(400);
    };
    const rows = () => evalJs(`[...document.querySelectorAll('#prepare-ops .ops-row')].map((r) => r.textContent.replace(/\\s+/g, ' ').trim())`);

    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 8000);
    await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'shaper app ready');
    await openMode('design');
    await waitFor('!!(window.__designController && window.__designController.state)', 'design controller ready');
    // three 1 in squares drawn by the Rect tool's own operation, each dimensioned 1 x 1 (#core/tool-ops.js: what the tools do), apart
    const sq = await evalJs(`(async () => {
      const ops = await import('/packages/core/tool-ops.js'); const { buildNodeMap } = await import('/packages/core/loop-finder.js');
      const c = window.__designController, st = c.state;
      const J = (id) => st.shapes.find((s) => s.id === id).joints;
      const out = [];
      for (const x of [0, 50, 100]) {
        const r = ops.rect(st, x + 10, -40, x + 35.4, -14.6);
        ops.dimension(st, { joints: J(r.top) }, { x: x + 22, y: -50 }, '25.4'); ops.dimension(st, { joints: J(r.left) }, { x: x, y: -27 }, '25.4');
        c.engine.solve(500);
        const node = buildNodeMap(st);
        out.push({ lines: r.lines, corner: J(r.bottom).find((j) => J(r.left).some((k) => node(k) === node(j))) });
      }
      return out;
    })()`);
    await sleep(300);
    await openMode('prepare');
    await waitFor(`!!document.getElementById('prepare-canvas').getScreenCTM() && document.getElementById('prepare-canvas').children.length > 0`, 'prepare canvas ready');
    // the three Pockets (the store's writer, as the page's quick flow + the depth field make them: tests/opfirst-ui-s2-node.test.js drives those clicks)
    await evalJs(`(async () => {
      const cp = await import('/apps/shaper/src/cut-plan.js'); const { findLoops } = await import('/packages/core/loop-finder.js');
      const st = window.__designController.state, sq = ${JSON.stringify(sq)};
      sq.forEach((s, i) => { const l = findLoops(st).find((x) => x.edges.length === 4 && s.lines.every((e) => x.edges.includes(e)));
        const op = cp.newOperation('pocket', [cp.keyOf('loop', l.id)], st); cp.setOpFields(op, { cutDepth: [3.175, 6.35, 9.525][i] }, st); });
    })()`);
    await openMode('design'); await openMode('prepare');
    await waitFor(`document.querySelectorAll('#prepare-ops .ops-row').length >= 3`, 'three operations listed');
    const before = await rows();
    console.log('rows apart:', JSON.stringify(before));
    assert.strictEqual(before.filter((r) => /Pocket/.test(r) && /1 region/.test(r)).length, 3, 'apart: the three Pockets each cut one region');
    const shotApart = await shot('832-prepare-apart.png', { x: 0, y: 40, width: 1400, height: 700 });

    // Design: the first square's corner onto the origin, then each other square's corner onto it (real drags: the snap's coincident)
    await openMode('design');
    await evalJs(`import('/packages/ui/input-handlers/pan-zoom.js').then((m) => m.fitToDrawing(window.__designController.svg, window.__designController.state))`).catch(() => {});
    await sleep(300);
    await drag(sq[0].corner, 'j_origin');
    await drag(sq[1].corner, sq[0].corner);
    await drag(sq[2].corner, sq[0].corner);
    const snapped = await evalJs(`import('/packages/core/loop-finder.js').then(({ buildNodeMap }) => { const st = window.__designController.state, node = buildNodeMap(st); const at = (j) => { const p = st.joints.get(j); return [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100]; };
      const corners = ${JSON.stringify(sq.map((s) => s.corner))};
      return { corners: corners.map(at), nodes: corners.map((j) => node(j)), originNode: node('j_origin') }; })`);
    console.log('after the drags:', JSON.stringify(snapped));
    assert.deepStrictEqual(snapped.corners, [[0, 0], [0, 0], [0, 0]], 'the three corners are on the origin (stacked exactly)');
    assert.deepStrictEqual(snapped.nodes, [snapped.originNode, snapped.originNode, snapped.originNode], 'the snaps made the three corners and the origin ONE node (coincident)');
    const shotDesign = await shot('832-design-stacked.png', { x: 0, y: 40, width: 1400, height: 700 });

    await openMode('prepare');
    await waitFor(`document.querySelectorAll('#prepare-ops .ops-row').length >= 3`, 'three operations listed');
    const after = await rows();
    console.log('rows stacked:', JSON.stringify(after));
    const shotStacked = await shot('832-prepare-stacked.png', { x: 0, y: 40, width: 1400, height: 700 });
    assert.strictEqual(after.filter((r) => /nothing to cut/.test(r)).length, 0, 'stacked: no operation says nothing to cut');
    assert.strictEqual(after.filter((r) => /Pocket/.test(r) && /1 region/.test(r)).length, 3, 'stacked: the three Pockets each cut one region');
    const drawn = await evalJs(`import('/apps/shaper/src/operations.js').then((m) => m.describeOperations(window.__designController.state).filter((o) => o.cutType === 'pocket').map((o) => ({ depth: o.records.map((r) => r.rec.cutDepth), cuts: o.records.reduce((n, r) => n + r.cuts.length, 0) })))`);
    console.log('pockets now:', JSON.stringify(drawn));
    assert.deepStrictEqual(drawn.map((d) => d.depth), [[3.175], [6.35], [9.525]], 'each Pocket at its own depth');
    assert.ok(drawn.every((d) => d.cuts > 0), 'each Pocket derives its cuts');
    const row3 = await evalJs(`[...document.querySelectorAll('#prepare-ops .ops-row')][2].dataset.id`);
    await clickEl(`#prepare-ops .ops-row[data-id="${row3}"] .ops-pick`); await sleep(300); // the 0.375 in Pocket's row selected: its shape lit on the canvas
    await shot('832-prepare-stacked-row3.png', { x: 0, y: 40, width: 1400, height: 700 });
    assert.notStrictEqual(shotApart, shotStacked, 'two different captures');
    console.log(`follow-design-832-live: ok (apart ${shotApart}, design ${shotDesign}, stacked ${shotStacked})`);
  } finally {
    await cdp.close();
  }
})();
