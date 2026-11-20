// tests/templates-674-live.test.js -- TASK 674 in the REAL Shaper page (Design tab), real mouse and real touch:
//   A. desktop 1400 x 900, mouse: every frame template's start view (trapezoid, parallelogram, triangle, polygon frame, box frame, right-angle
//      brace, right-angle corner): a joint glyph picker on each corner of the preview, every one a >= 44 px target, none overlapping another
//      or crossing a line of the drawing, all inside the preview and the screen; the modal on screen with no sideways scroll, Open / Cancel in
//      view. The trapezoid's corner 1 expanded and picked with the mouse (only that corner changes, the row then shows the corners differ),
//      the row sets all again, a corner picked, Open: the drawing = the template with that per-corner list. The parallelogram and the
//      triangle opened from the picker.
//   B. phone 390 x 844, real touch: the same layout checks for every frame template (the preview spans the panel, the form scrolls under it,
//      Open / Cancel stay in view); a corner of the polygon frame tapped open and picked; Open by a tap opens it with that list.
//   Both: the polygon frame at 12 sides (its largest count): 12 corner pickers, the same layout checks.
// EVIDENCE_DIR: cropped screenshots.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

await (async () => {
  const cdp = await launchBrowser({ tag: '674', width: 1400, height: 900 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate, waitForApp } = cdp;
  const rectOf = (sel, i = 0) => evalJs(`(() => { const e = document.querySelectorAll(${JSON.stringify(sel)})[${i}]; if (!e) return null; const b = e.getBoundingClientRect(); return b.width ? { x: b.left, y: b.top, width: b.width, height: b.height } : null; })()`);
  const shot = async (name, sel, { pad = 0, scale = 1, i = 0 } = {}) => {
    if (!process.env.EVIDENCE_DIR) return;
    const r = sel ? await rectOf(sel, i) : null;
    const clip = r ? { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: r.width + 2 * pad, height: r.height + 2 * pad, scale } : undefined;
    const s = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
    fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name), Buffer.from(s.data, 'base64'));
  };
  const center = async (sel, i = 0) => {
    const c = await evalJs(`(() => { const e = document.querySelectorAll(${JSON.stringify(sel)})[${i}]; if (!e) return null; const r = e.getBoundingClientRect(); return r.width ? { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) } : null; })()`);
    assert(c, sel + ' #' + i + ' not on screen'); return c;
  };
  const mouseEv = (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
  const mouse = async (x, y) => { await mouseEv('mouseMoved', x, y); await sleep(30); await mouseEv('mousePressed', x, y, 1); await sleep(30); await mouseEv('mouseReleased', x, y); await sleep(300); };
  const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
  const touch = async (x, y) => { await T('touchStart', [{ x, y }]); await sleep(40); await T('touchEnd', []); await sleep(350); };
  let pointer = mouse;
  const press = async (sel, i = 0) => { await evalJs(`document.querySelectorAll(${JSON.stringify(sel)})[${i}].scrollIntoView({ block: 'nearest', inline: 'nearest' })`); await sleep(80); const c = await center(sel, i); await pointer(c.x, c.y); };
  const S = (expr) => evalJs(`(() => { const s = window.__designController.state; return (${expr}); })()`);
  const openMenu = async () => {
    const c = await evalJs(`(() => { const e = [...document.querySelectorAll('.sk-sidebar-btn, .sk-sidebar-chevron')].find((x) => x.getClientRects().length > 0); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    assert(c, 'menu trigger'); await pointer(c.x, c.y); await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'sidebar open');
  };
  const openCards = async () => { await openMenu(); await press('[data-action="templates"]'); await waitFor(`!!document.querySelector('.sk-tp-card')`, 'the template modal'); };
  const startOf = async (id) => {
    await openCards();
    await press(`.sk-tp-card[data-template="${id}"]`);
    await waitFor(`!!document.querySelector('.sk-tp-panel.sk-tp-wide .sk-tp-start[data-template="${id}"] .sk-tp-corner')`, id + ': the wide start view with its corner pickers');
    await sleep(250);
  };
  const cancelAll = async () => { await press('.sk-tp-cancel'); await waitFor(`!!document.querySelector('.sk-tp-card')`, 'back to the cards'); await press('.sk-tp-x'); await waitFor(`!document.querySelector('.sk-tp-panel')`, 'the modal closed'); };
  const dontSave = async () => { await sleep(300); const has = await evalJs(`[...document.querySelectorAll('.sk-tp-backdrop [role="dialog"] button')].some((b) => /Don.t save/.test(b.textContent))`); if (has) { await press('.sk-tp-backdrop [role="dialog"] button:nth-of-type(2)').catch(() => {}); } };
  const openIt = async (what) => { await press('.sk-tp-open'); await waitFor(`!document.querySelector('.sk-tp-panel')`, what + ': Open closes the modal'); await dontSave(); };
  const openShaper = async () => {
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 10000);
    await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"], .sk-sidebar-chevron')`, 'Shaper to load');
    for (let i = 0; i < 5; i++) { const on = await evalJs(`(() => { const t = document.querySelector('.sk-header-tab.active'); return !t || t.dataset.tab === 'design'; })()`); if (on) break; await press('.sk-header-tab[data-tab="design"]'); }
    await waitFor(`!!window.__designController && !!document.getElementById('btn-parameters')`, 'the Shaper Design tab');
    await waitForApp('design-canvas');
    // TASK 722: Shaper's document is inches; this test is about joints in mm values (the inch start view is template-units-722-live)
    await evalJs(`(async () => { (await import('/packages/core/settings-manager.js')).default.set('DOC_UNIT', 'mm', { persist: false }); })()`);
  };
  // the corner pickers' layout, measured on screen: their buttons, their boxes against each other, against the drawing's solid lines (the preview's
  // own <line> elements through getScreenCTM) and against the preview and the screen; the modal, Open and Cancel on screen; no sideways scroll
  const layout = () => evalJs(`(() => {
    const W = innerWidth, H = innerHeight;
    const stage = document.querySelector('.sk-tp-stage').getBoundingClientRect();
    const boxes = [...document.querySelectorAll('.sk-tp-corners .sk-tp-corner')].map((e) => e.getBoundingClientRect());
    const buttons = [...document.querySelectorAll('.sk-tp-corners .sk-tp-corner button:not([hidden])')].map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
    const svg = document.querySelector('.sk-tp-stage .sk-tp-prev svg'), m = svg.getScreenCTM();
    const pt = (x, y) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f });
    const lines = [...svg.querySelectorAll(':scope > g:first-child > line')].filter((l) => !l.hasAttribute('stroke-dasharray'))
      .map((l) => [pt(+l.getAttribute('x1'), +l.getAttribute('y1')), pt(+l.getAttribute('x2'), +l.getAttribute('y2'))]);
    const hits = (p, q, b) => { let t0 = 0, t1 = 1; const dx = q.x - p.x, dy = q.y - p.y;
      for (const [n, d] of [[p.x - b.left, -dx], [b.right - p.x, dx], [p.y - b.top, -dy], [b.bottom - p.y, dy]]) { if (d === 0) { if (n < 0) return false; continue; } const t = n / d; if (d < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t); if (t0 > t1) return false; } return true; };
    const overlaps = []; boxes.forEach((a, i) => boxes.forEach((b, j) => { if (j > i && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) overlaps.push([i, j]); }));
    const crossing = []; boxes.forEach((b, i) => { if (lines.some(([p, q]) => hits(p, q, b))) crossing.push(i); });
    const inside = (r, o) => r.left >= o.left - 0.5 && r.right <= o.right + 0.5 && r.top >= o.top - 0.5 && r.bottom <= o.bottom + 0.5;
    const screen = { left: 0, top: 0, right: W, bottom: H };
    const panel = document.querySelector('.sk-tp-panel').getBoundingClientRect();
    const btn = (sel) => document.querySelector(sel).getBoundingClientRect();
    return { n: boxes.length, lines: lines.length, buttons, overlaps, crossing, outOfStage: boxes.map((b, i) => (inside(b, stage) ? -1 : i)).filter((i) => i >= 0),
      offScreen: boxes.map((b, i) => (inside(b, screen) ? -1 : i)).filter((i) => i >= 0), panelOn: inside(panel, screen), openOn: inside(btn('.sk-tp-open'), screen), cancelOn: inside(btn('.sk-tp-cancel'), screen),
      sideways: document.documentElement.scrollWidth > W, stage: [Math.round(stage.width), Math.round(stage.height)], panel: [Math.round(panel.width), Math.round(panel.height)] };
  })()`);
  const checkLayout = async (id, n, where) => {
    const L = await layout(), m = `${where} ${id}`;
    assert.strictEqual(L.n, n, `${m}: ${n} corner pickers`);
    assert.ok(L.lines > 0, `${m}: the drawing's lines measured`);
    assert.ok(L.buttons.length === n && L.buttons.every(([w, h]) => w >= 44 && h >= 44), `${m}: every corner glyph a >= 44 px target ${JSON.stringify(L.buttons)}`);
    assert.deepStrictEqual(L.overlaps, [], `${m}: no two corner pickers overlap`);
    assert.deepStrictEqual(L.crossing, [], `${m}: no corner picker crosses a line of the drawing`);
    assert.deepStrictEqual(L.outOfStage, [], `${m}: every corner picker inside the preview`);
    assert.deepStrictEqual(L.offScreen, [], `${m}: every corner picker on screen`);
    assert.ok(L.panelOn && !L.sideways, `${m}: the modal on screen, no sideways scroll ${JSON.stringify(L.panel)}`);
    assert.ok(L.openOn && L.cancelOn, `${m}: Open and Cancel in view`);
    return L;
  };
  const cornerSel = (param, index) => `.sk-tp-corners .sk-tp-corner[data-param="${param}"]${index == null ? '' : `[data-corner="${index}"]`}`;
  const shownIn = (sel) => evalJs(`[...document.querySelectorAll(${JSON.stringify(sel + ' button')})].filter((b) => !b.hidden).map((b) => b.dataset.value)`);
  const cornerValues = () => evalJs(`[...document.querySelectorAll('.sk-tp-corners .sk-tp-corner')].map((c) => [...c.querySelectorAll('button')].find((b) => !b.hidden).dataset.value)`);
  // the opened drawing = the template built in the page with those params (#core/templates.js: the same module the picker uses), point by point
  const sameAsTemplate = async (id, params, m) => {
    const ok = await evalJs(`import('/packages/core/templates.js').then(({ buildTemplate, templateById }) => {
      const R = (v) => Math.round(v * 1e4) / 1e4 || 0, key = (list) => list.map((j) => R(j.x) + ',' + R(j.y)).sort().join(';');
      const want = buildTemplate(templateById(${JSON.stringify(id)}), ${JSON.stringify(params)}).geometry.joints.map(([, j]) => j);
      return key([...window.__designController.state.joints.values()]) === key(want);
    })`);
    assert.strictEqual(ok, true, m);
  };
  // the polygon frame at its largest count: 12 corner pickers round the drawing (the sides typed in its box)
  const twelveSides = async (where) => {
    await startOf('polygon-frame');
    await press('.sk-tp-field[data-param="sides"] input');
    await evalJs(`document.querySelector('.sk-tp-field[data-param="sides"] input').select()`);
    await send('Input.insertText', { text: '12' });
    await waitFor(`document.querySelectorAll('.sk-tp-corners .sk-tp-corner').length === 12`, where + ': 12 corner pickers');
    await sleep(300);
    await checkLayout('polygon-frame 12 sides', 12, where);
    await shot(`${where}-start-polygon-frame-12.png`, '.sk-tp-stage', { pad: 2 });
    await cancelAll();
  };
  const FRAMES = [['trapezoid-frame', 4], ['parallelogram-frame', 4], ['triangle-frame', 3], ['polygon-frame', 6], ['box-frame', 4], ['right-angle-brace', 3], ['right-angle-corner', 1]];
  try {
    // ================================================================== A. desktop, mouse
    await openShaper();
    await resetBufferLive(cdp);
    await openShaper();
    for (const [id, n] of FRAMES) {
      await startOf(id);
      const L = await checkLayout(id, n, 'desktop');
      if (id === 'trapezoid-frame') console.log(`desktop: panel ${L.panel}, preview ${L.stage}`);
      await shot(`desktop-start-${id}.png`, '.sk-tp-panel', { pad: 2 });
      await cancelAll();
    }
    await twelveSides('desktop');
    // the trapezoid: corner 1 (top-left) expanded and picked with the mouse; the row; Open
    await startOf('trapezoid-frame');
    await press(`${cornerSel('joint', 1)} button:not([hidden])`);
    assert.deepStrictEqual(await shownIn(cornerSel('joint', 1)), ['CW-Through', 'CCW-Through', 'Miter'], 'mouse: corner 1 expanded, the three joints');
    const L1 = await layout();
    assert.ok(L1.outOfStage.length === 0 && L1.offScreen.length === 0, 'the expanded corner picker stays inside the preview');
    await sleep(200); await shot('desktop-trapezoid-corner1-expanded.png', '.sk-tp-stage', { pad: 2 });
    await press(`${cornerSel('joint', 1)} button[data-value="CW-Through"]`);
    assert.deepStrictEqual(await cornerValues(), ['Miter', 'CW-Through', 'Miter', 'Miter'], 'mouse: only corner 1 changed, folded back');
    assert.strictEqual(await evalJs(`document.querySelector('.sk-tp-field[data-param="joint"] .sk-tp-choice').dataset.mixed`), 'true', 'the Corner joint row shows the corners differ');
    await checkLayout('trapezoid-frame', 4, 'desktop after a pick');
    await sleep(200); await shot('desktop-trapezoid-corner1-picked.png', '.sk-tp-stage', { pad: 2 });
    await press('.sk-tp-field[data-param="joint"] .sk-tp-choice button:not([hidden])');
    await press('.sk-tp-field[data-param="joint"] .sk-tp-choice button[data-value="CCW-Through"]');
    assert.deepStrictEqual(await cornerValues(), ['CCW-Through', 'CCW-Through', 'CCW-Through', 'CCW-Through'], 'mouse: the row set every corner');
    await press(`${cornerSel('joint', 3)} button:not([hidden])`);
    await press(`${cornerSel('joint', 3)} button[data-value="Miter"]`);
    await sleep(200); await shot('desktop-trapezoid-row-then-corner3.png', '.sk-tp-stage', { pad: 2 });
    await openIt('trapezoid');
    await sameAsTemplate('trapezoid-frame', { joint: ['CCW-Through', 'CCW-Through', 'CCW-Through', 'Miter'] }, 'desktop: the trapezoid opened with the corners picked');
    assert.deepStrictEqual(await S(`s.parameters.map((p) => p.name)`), ['bottom_width', 'top_width', 'height', 'thickness'], 'the trapezoid: its user parameters');
    await press('#btn-recenter-view'); await sleep(700); await shot('desktop-trapezoid-canvas.png', '#design-canvas');
    // the parallelogram and the triangle from the picker, a corner each
    await startOf('parallelogram-frame');
    await press(`${cornerSel('joint', 0)} button:not([hidden])`); await press(`${cornerSel('joint', 0)} button[data-value="CW-Through"]`);
    await openIt('parallelogram');
    await sameAsTemplate('parallelogram-frame', { joint: ['CW-Through', 'Miter', 'Miter', 'Miter'] }, 'desktop: the parallelogram opened with corner 0 picked');
    await press('#btn-recenter-view'); await sleep(700); await shot('desktop-parallelogram-canvas.png', '#design-canvas');
    await startOf('triangle-frame');
    await press(`${cornerSel('jointC')} button:not([hidden])`); await press(`${cornerSel('jointC')} button[data-value="V-Through"]`);
    assert.deepStrictEqual(await shownIn(cornerSel('jointC')), ['V-Through'], 'the top corner picked, folded back');
    assert.deepStrictEqual(await evalJs(`[...document.querySelectorAll('.sk-tp-field')].map((r) => r.dataset.param)`), ['base', 'leftSide', 'rightSide', 'thickness'], 'the triangle: no joint rows (picked on the preview only)');
    await openIt('triangle');
    await sameAsTemplate('triangle-frame', { jointC: 'V-Through' }, 'desktop: the triangle opened with its top corner picked');
    await press('#btn-recenter-view'); await sleep(700); await shot('desktop-triangle-canvas.png', '#design-canvas');

    // ================================================================== B. phone 390 x 844, real touch
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    pointer = touch;
    await resetBufferLive(cdp);
    await openShaper();
    for (const [id, n] of FRAMES) {
      await startOf(id);
      const L = await checkLayout(id, n, 'phone');
      // (owner: "joint type on the preview directly like in frame calc") a joint the corners carry has no form row; a per-corner one keeps "Corner joint"
      const jointRows = await evalJs(`[...document.querySelectorAll('.sk-tp-field')].map((r) => r.dataset.param).filter((k) => /joint/i.test(k))`);
      assert.deepStrictEqual(jointRows, ['right-angle-brace', 'right-angle-corner', 'triangle-frame'].includes(id) ? [] : ['joint'], `phone ${id}: joint rows ${JSON.stringify(jointRows)}`);
      assert.ok(L.stage[0] >= 330, `phone ${id}: the preview spans the panel (${L.stage})`);
      await shot(`phone-start-${id}.png`);
      await cancelAll();
    }
    await twelveSides('phone');
    await startOf('polygon-frame');
    await press(`${cornerSel('joint', 2)} button:not([hidden])`);
    assert.deepStrictEqual(await shownIn(cornerSel('joint', 2)), ['CW-Through', 'CCW-Through', 'Miter'], 'touch: corner 2 expanded');
    const L2 = await layout();
    assert.ok(L2.outOfStage.length === 0 && L2.offScreen.length === 0 && !L2.sideways, 'phone: the expanded corner picker stays inside the preview, no sideways scroll');
    await sleep(200); await shot('phone-polygon-corner2-expanded.png', '.sk-tp-stage', { pad: 2 });
    await press(`${cornerSel('joint', 2)} button[data-value="CCW-Through"]`);
    assert.deepStrictEqual(await cornerValues(), ['Miter', 'Miter', 'CCW-Through', 'Miter', 'Miter', 'Miter'], 'touch: only corner 2 changed');
    await checkLayout('polygon-frame', 6, 'phone after a pick');
    await sleep(200); await shot('phone-polygon-corner2-picked.png', '.sk-tp-stage', { pad: 2 });
    await openIt('phone polygon');
    await sameAsTemplate('polygon-frame', { joint: ['Miter', 'Miter', 'CCW-Through', 'Miter', 'Miter', 'Miter'] }, 'phone: the polygon frame opened with corner 2 picked');
    await sleep(300); await shot('phone-polygon-canvas.png');
    console.log('templates-674-live: ok');
  } finally { await cdp.close(); }
})();
