// tests/sketch-layers-live.test.js — TASK 577: the REAL-POINTER twins of tests/sketch-layers-node.test.js, in a real browser:
// (1) Shaper at desktop width: a real mouse drag on a locked sketch's point and line moves nothing; the row's right-click menu (Lock) locks;
//     a real mouse drag of a sketch's NAME reorders (one undo step); "Show only this sketch" = the others' visible false; the right-click
//     menu on a selected line offers "Move to sketch" with a submenu (current sketch + locked ones greyed, "New sketch…") and runs it.
// (2) ALL FOUR hosts (SketchStudio, Shaper, Pen Plotter, Trace) show the same sketch tree controls.
// (3) Phone width (390 px, touch): the panel is a drawer that fits the screen (SketchStudio, Shaper, Trace), a finger HOLD then drag on a
//     name reorders, a quick swipe does not, a still hold opens the row menu.
// Screenshots (panel with a locked sketch, the row menu open, the Move-to submenu) go to EVIDENCE_DIR.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { launchBrowser } from './helpers/cdp-browser.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await (async () => {
  const cdp = await launchBrowser({ tag: '577', width: 1400, height: 800, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, once, evalJs, waitFor, waitForApp } = cdp;
  try {
    const mouse = async (type, x, y, buttons = 0, button) => send('Input.dispatchMouseEvent', { type, x, y, button: button || ((buttons || type === 'mouseReleased') ? 'left' : 'none'), buttons, clickCount: (buttons || type === 'mouseReleased') ? 1 : 0 });
    const center = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`);
    const clickEl = async (sel) => { const c = await center(sel); assert(c, sel + ' not found'); await mouse('mouseMoved', c.x, c.y); await mouse('mousePressed', c.x, c.y, 1); await mouse('mouseReleased', c.x, c.y); await sleep(250); };
    const rightClick = async (p) => {
      await mouse('mouseMoved', p.x, p.y); await sleep(150);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'right', buttons: 2, clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'right', buttons: 0, clickCount: 1 }); await sleep(400);
    };
    const dragReal = async (a, b, steps = 10) => { await mouse('mouseMoved', a.x, a.y); await sleep(60); await mouse('mousePressed', a.x, a.y, 1); await sleep(60); for (let i = 1; i <= steps; i++) { await mouse('mouseMoved', Math.round(a.x + (b.x - a.x) * i / steps), Math.round(a.y + (b.y - a.y) * i / steps), 1); await sleep(25); } await mouse('mouseReleased', b.x, b.y); await sleep(400); };
    const state = (js) => evalJs(`(() => { const st = window.__designController.state; ${js} })()`);
    const W2S = (x, y) => evalJs(`(() => { const s = document.getElementById('design-canvas'); const p = s.createSVGPoint(); p.x = ${x}; p.y = ${y}; const q = p.matrixTransform(s.getScreenCTM()); return { x: Math.round(q.x), y: Math.round(q.y) }; })()`);
    const md5s = [];
    const shot = async (name, clip) => {
      const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 2 } } : {}) });
      const buf = Buffer.from(r.data, 'base64');
      if (process.env.EVIDENCE_DIR) fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name), buf);
      const h = createHash('md5').update(buf).digest('hex'); md5s.push(name + '=' + h); return h;
    };
    const rectOf = (sel) => evalJs(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; })()`);
    const union = (...rs) => { const l = Math.max(0, Math.floor(Math.min(...rs.map((r) => r.left)) - 8)), t = Math.max(0, Math.floor(Math.min(...rs.map((r) => r.top)) - 8)); return { x: l, y: t, width: Math.ceil(Math.max(...rs.map((r) => r.right)) + 8 - l), height: Math.ceil(Math.max(...rs.map((r) => r.bottom)) + 8 - t) }; };
    const order = () => state(`return JSON.stringify(st.sketches.map(s => s.id));`).then(JSON.parse);
    const menuIds = () => evalJs('[...document.querySelectorAll(".sk-context-menu:not(.sk-context-sub) .sk-context-item")].map(r => r.dataset.id + "=" + r.textContent.replace("✓","").trim())');
    const head = (id) => `.sk-sketch-node[data-sketch-id="${id}"] .sk-sketch-head`;

    const loaded = once('Page.loadEventFired');
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/apps/shaper/index.html` });
    await Promise.race([loaded, sleep(8000)]); await waitFor(`!!document.querySelector('[data-mode="design"]')`, 'the Shaper to load');
    for (let i = 0; i < 5; i++) { await clickEl('[data-mode="design"]'); await sleep(300); if (await evalJs(`document.querySelector('.mode-btn.active').dataset.mode`) === 'design') break; }
    await waitForApp('design-canvas'); await waitFor(`!!window.__designController && document.getElementById('design-canvas').getBoundingClientRect().width > 0`, 'the Design tab to show');

    // three sketches, one line each, spread over the canvas
    const seed = `
      for (const k of [...st.joints.keys()]) if (k !== 'j_origin') st.joints.delete(k);
      st.shapes.length = 0; st.constraints.length = 0; st.selectedShapes.clear(); st.selectedJoints.clear();
      st.sketches.length = 0; st.sketches.push({ id: 'sketch-1', name: 'Outline', visible: true }, { id: 'sketch-2', name: 'Plate', visible: true }, { id: 'sketch-3', name: 'Holes', visible: true });
      const L = (sk, id, a, b, x1, y1, x2, y2) => { st.joints.set(a, { x: x1, y: y1, sketchId: sk }); st.joints.set(b, { x: x2, y: y2, sketchId: sk }); st.shapes.push({ id, type: 'line', joints: [a, b], sketchId: sk }); };
      L('sketch-1', 'LA', 'a1', 'a2', -40, -20, -10, -20);
      L('sketch-2', 'LB', 'b1', 'b2', -40, 10, -10, 10);
      L('sketch-3', 'LC', 'c1', 'c2', 10, 10, 40, 10);
      st.activeSketchId = 'sketch-3'; st.currentTool = 'select';
      return true;`;
    await state(seed);
    await sleep(800);

    // ---- (1) lock Plate through the row's REAL right-click menu, then a real drag on it moves nothing
    await rightClick(await center(head('sketch-2') + ' .sk-sketch-name'));
    assert.deepStrictEqual(await menuIds(), ['sk-lock=Lock', 'sk-only=Show only this sketch', 'sk-rename=Rename', 'sk-delete=Delete'], 'the row menu');
    await shot('577-row-menu.png', union(await rectOf('#design-panel-info .sk-tree-hdr'), await rectOf('.sk-context-menu')));
    await clickEl('.sk-context-menu .sk-context-item[data-id="sk-lock"]');
    assert.strictEqual(await state(`return st.sketches[1].locked === true;`), true, 'the menu locked Plate');
    assert.strictEqual(await evalJs(`!!document.querySelector('.sk-sketch-node[data-sketch-id="sketch-2"] .sk-sketch-lockbadge')`), true, 'the purple badge shows');
    const coords = (ids) => state(`return JSON.stringify(${JSON.stringify(ids)}.map(id => [st.joints.get(id).x, st.joints.get(id).y]));`);
    const before = await coords(['b1', 'b2', 'a1', 'c1']);
    const pb1 = await W2S(-40, 10);
    await dragReal(pb1, { x: pb1.x + 80, y: pb1.y + 60 });            // the locked point
    const pbm = await W2S(-25, 10);
    await dragReal(pbm, { x: pbm.x + 30, y: pbm.y - 70 });            // the locked line's body
    const afterLocked = await coords(['b1', 'b2', 'a1', 'c1']);
    assert.strictEqual(afterLocked, before, 'a real drag on the locked sketch moved nothing: ' + before + ' -> ' + afterLocked);
    assert.strictEqual(await state(`return st.selectedShapes.size + st.selectedJoints.size;`), 0, 'and selected nothing');
    const pa1 = await W2S(-40, -20);
    await dragReal(pa1, { x: pa1.x + 40, y: pa1.y + 30 });            // an unlocked sketch point still drags
    assert.notStrictEqual((await coords(['a1'])), JSON.stringify([JSON.parse(before)[2]]), 'the unlocked sketch point moved');
    // the radio of the locked sketch is disabled; a click on a name does not activate; a click on an empty radio does
    assert.strictEqual(await evalJs(`document.querySelector('.sk-sketch-node[data-sketch-id="sketch-2"] .sk-sketch-radio').disabled`), true, 'the locked radio is disabled');
    await clickEl(head('sketch-1') + ' .sk-sketch-name'); assert.strictEqual(await state(`return st.activeSketchId;`), 'sketch-3', 'a click on the name does not activate');
    await clickEl(head('sketch-1') + ' .sk-sketch-radio'); assert.strictEqual(await state(`return st.activeSketchId;`), 'sketch-1', 'a click on an empty radio activates');
    await shot('577-panel-locked.png', union(await rectOf('#design-panel-info .sk-tree-hdr'), await rectOf('.sk-sketch-node[data-sketch-id="sketch-3"]')));

    // ---- (2) a real mouse drag of the Holes NAME above Outline reorders (one undo step)
    await rightClick(await center(head('sketch-2') + ' .sk-sketch-name')); await clickEl('.sk-context-menu .sk-context-item[data-id="sk-lock"]'); // Unlock
    assert.deepStrictEqual(await order(), ['sketch-1', 'sketch-2', 'sketch-3']);
    const nameC = await center(head('sketch-3') + ' .sk-sketch-name');
    const top = await evalJs(`(() => { const r = document.querySelector('.sk-sketch-node[data-sketch-id="sketch-1"]').getBoundingClientRect(); return { y: Math.round(r.top + 3) }; })()`);
    const hist = await state(`return st.history.length;`);
    await dragReal(nameC, { x: nameC.x, y: top.y });
    assert.deepStrictEqual(await order(), ['sketch-3', 'sketch-1', 'sketch-2'], 'the real name drag put Holes first');
    assert.strictEqual(await state(`return st.history.length;`), hist + 1, 'one undo step for the reorder');
    assert.deepStrictEqual(await evalJs(`[...document.querySelectorAll('.sk-sketch-node')].map(n => n.dataset.sketchId)`), ['sketch-3', 'sketch-1', 'sketch-2'], 'the tree shows the new order');

    // ---- (3) Show only this sketch: the others' visible = false, nothing else; the eyes bring them back
    await rightClick(await center(head('sketch-1') + ' .sk-sketch-name')); await clickEl('.sk-context-menu .sk-context-item[data-id="sk-only"]');
    assert.deepStrictEqual(await state(`return st.sketches.map(s => s.id + ':' + s.visible);`), ['sketch-3:false', 'sketch-1:true', 'sketch-2:false'], 'only Outline is visible');
    assert.strictEqual(await evalJs(`/show all|only this/i.test(document.getElementById('design-panel-info').textContent)`), false, 'no banner, no show-all');
    await clickEl(head('sketch-3') + ' .sk-sketch-eye'); await clickEl(head('sketch-2') + ' .sk-sketch-eye');
    assert.deepStrictEqual(await state(`return st.sketches.map(s => s.visible);`), [true, true, true], 'plain eye toggles bring the sketches back');

    // ---- (4) right click on a selected line: Move to sketch submenu (own sketch + locked greyed, New sketch…)
    await rightClick(await center(head('sketch-1') + ' .sk-sketch-name')); await clickEl('.sk-context-menu .sk-context-item[data-id="sk-lock"]'); // lock Outline (it is active: hands activation on)
    await state(`st.selectedShapes.clear(); st.selectedJoints.clear(); st.currentTool = 'select'; return true;`);
    await rightClick(await W2S(25, 10)); // Holes' line LC
    const items = await menuIds();
    assert(items.some((s) => s.startsWith('geo-move=Move to sketch')), 'the menu has one Move to sketch row: ' + JSON.stringify(items));
    await clickEl('.sk-context-menu .sk-context-item[data-id="geo-move"]'); await sleep(200);
    const subs = await evalJs('[...document.querySelectorAll(".sk-context-sub .sk-context-item")].map(r => r.dataset.id + "|" + r.getAttribute("aria-disabled") + "|" + r.textContent.replace("✓","").trim())');
    assert.strictEqual(subs.join(','), 'geo-move-sketch-3|true|Holescurrent,geo-move-sketch-1|true|Outlinelocked,geo-move-sketch-2|null|Plate,geo-move-new|null|New sketch…', 'submenu: Holes (own) greyed as current, Outline greyed as locked, Plate, New sketch…: ' + JSON.stringify(subs));
    await shot('577-move-to-submenu.png', union(await rectOf('.sk-context-menu:not(.sk-context-sub)'), await rectOf('.sk-context-sub')));
    await clickEl('.sk-context-sub .sk-context-item[data-id="geo-move-sketch-2"]');
    assert.strictEqual(await state(`return st.shapes.find(s => s.id === 'LC').sketchId;`), 'sketch-2', 'the menu moved LC to Plate');
    // New sketch…
    await state(`st.selectedShapes.clear(); st.selectedJoints.clear(); return true;`);
    await rightClick(await W2S(25, 10)); await clickEl('.sk-context-menu .sk-context-item[data-id="geo-move"]');
    const n0 = await state(`return st.sketches.length;`);
    await clickEl('.sk-context-sub .sk-context-item[data-id="geo-move-new"]');
    assert.strictEqual(await state(`return st.sketches.length;`), n0 + 1, 'New sketch… made a sketch');
    assert.strictEqual(await state(`const sk = st.shapes.find(s => s.id === 'LC').sketchId; return sk === st.sketches[st.sketches.length - 1].id;`), true, 'and LC lives in it');

    // ---- (5) ALL FOUR hosts: the same tree controls (a fresh page each: one sketch, so one row)
    const counts = `(() => { const q = (s) => document.querySelectorAll(s).length; return JSON.stringify({ add: q('.sk-tree-add'), eye: q('.sk-sketch-eye'), icon: q('.sk-sketch-icon'), name: q('.sk-sketch-name'), radio: q('.sk-sketch-radio'), gone: q('.sk-sketch-grip, .sk-sketch-up, .sk-sketch-down, .sk-sketch-solo, .sk-sketch-lock, .sk-tree-move') }); })()`;
    const hosts = [
      { name: 'sketchstudio', url: '/apps/sketchstudio/index.html', ready: `!!document.querySelector('.sk-side .sk-sketch-node')` },
      { name: 'shaper', url: '/apps/shaper/index.html', enter: `document.querySelector('[data-mode="design"]').click()`, ready: `!!document.querySelector('#design-panel-info .sk-sketch-node')` },
      { name: 'penplotter', url: '/apps/penplotter/index.html', enter: `document.querySelector('.stage-btn[data-stage="design"]').click()`, ready: `!!document.querySelector('#design-panel-info .sk-sketch-node')` },
      { name: 'trace', url: '/apps/trace/index.html', enter: `document.querySelector('.tr-tab[data-tab="edit"]').click()`, ready: `!!document.querySelector('.sk-side .sk-sketch-node')` },
    ];
    const perHost = {};
    for (const h of hosts) {
      await cdp.navigate(`http://127.0.0.1:${port}${h.url}`, 8000);
      if (h.enter) { await sleep(800); await evalJs(h.enter); }
      await waitFor(h.ready, h.name + ' shows the sketch tree'); await sleep(400);
      perHost[h.name] = await evalJs(counts);
    }
    const want = JSON.stringify({ add: 1, eye: 1, icon: 1, name: 1, radio: 1, gone: 0 });
    for (const [k, v] of Object.entries(perHost)) assert.strictEqual(v, want, k + ' tree controls: ' + v);

    // ---- (6) phone width, touch: the panel is a drawer that fits (SketchStudio, Shaper, Trace), a held finger drags a name, a swipe does not, a still hold opens the menu
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i, radiusX: 1, radiusY: 1, force: 1 })) });
    const phone = {};
    for (const h of [hosts[0], hosts[1], hosts[3]]) {
      await cdp.navigate(`http://127.0.0.1:${port}${h.url}`, 8000);
      if (h.enter) { await sleep(800); await evalJs(h.enter); }
      await waitFor(h.ready, h.name + ' (phone) has the tree'); await sleep(300);
      const toggle = await center('.sk-drawer-toggle'); assert(toggle, h.name + ': the drawer button is on the phone screen');
      // every host (Shaper too, since task 581): the real button is inside the screen and a real touch tap opens the drawer
      assert(toggle.x > 0 && toggle.x < 390 && toggle.y > 0 && toggle.y < 844, h.name + ': the drawer button is inside the viewport: ' + JSON.stringify(toggle));
      await T('touchStart', [toggle]); await sleep(40); await T('touchEnd', []);
      await sleep(500);
      const fit = await evalJs(`(() => { const p = document.querySelector('.sk-drawer-panel'); const r = p.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width, vw: window.innerWidth, scrollW: document.documentElement.scrollWidth, open: p.classList.contains('sk-drawer-open') }; })()`);
      assert(fit.open && fit.left >= 0 && fit.right <= fit.vw + 0.5 && fit.scrollW <= fit.vw + 1, h.name + ': the drawer opens and fits the 390 px screen without page scroll: ' + JSON.stringify(fit));
      phone[h.name] = fit;
      if (h.name === 'shaper') {
        // three sketches: Holes' name held ~380 ms then dragged above Outline reorders; a quick swipe over the name does not
        await waitForApp('design-canvas');
        await state(seed); await sleep(600);
        const nameP = await center(head('sketch-3') + ' .sk-sketch-name'); const topP = await rectOf('.sk-sketch-node[data-sketch-id="sketch-1"]');
        await T('touchStart', [nameP]); await sleep(60); await T('touchMove', [{ x: nameP.x, y: nameP.y - 30 }]); await sleep(60); await T('touchMove', [{ x: nameP.x, y: topP.top + 3 }]); await sleep(60); await T('touchEnd', []); await sleep(400);
        assert.deepStrictEqual(await order(), ['sketch-1', 'sketch-2', 'sketch-3'], 'a quick swipe over a name does not reorder (it scrolls)');
        await T('touchStart', [nameP]); await sleep(380); await T('touchMove', [{ x: nameP.x, y: nameP.y - 20 }]); await sleep(60); await T('touchMove', [{ x: nameP.x, y: topP.top + 3 }]); await sleep(80); await T('touchEnd', []); await sleep(500);
        assert.deepStrictEqual(await order(), ['sketch-3', 'sketch-1', 'sketch-2'], 'a held finger drags the name: Holes above Outline');
        const nameQ = await center(head('sketch-2') + ' .sk-sketch-name');
        await T('touchStart', [nameQ]); await sleep(700);
        const ids = await menuIds(); await T('touchEnd', []); await sleep(250);
        assert.deepStrictEqual(ids, ['sk-lock=Lock', 'sk-only=Show only this sketch', 'sk-rename=Rename', 'sk-delete=Delete'], 'a still hold opens the row menu: ' + JSON.stringify(ids));
      }
    }
    console.log(`LIVE-OK locked-drag unchanged ${before}; row menu lock; name drag reorder; show only; move-to submenu + New sketch; four hosts equal ${want}; phone drawer fits ${JSON.stringify(phone)}; touch hold-drag + hold menu. md5 ${md5s.join(' ')}`);
  } finally { await cdp.close(); }
})();
