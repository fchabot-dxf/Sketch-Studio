// tests/number-stepper-730-live.test.js — TASK 730: the − / + steppers in the real page, with real mouse clicks (desktop 1280 x 800) and real touch taps (phone 390 x 844):
//   the Prepare cut card (Depth, Offset with its flip kept, Bit diameter with its presets kept) and the Review card (Stock thickness) (TASK 741: the V-carve panel's steppers went with V-carve).
//   Each press changes its value by its step, clamps at its min, press-and-hold repeats, the targets are >= 44 px on the phone, nothing overflows at 390.
// Screenshots to EVIDENCE_DIR (or .evidence/730/): cut-card-desktop.png, review-stock-desktop.png, cut-card-phone.png, review-stock-phone.png.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const EVIDENCE_DIR = process.env.EVIDENCE_DIR || path.resolve('.evidence/730');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const cdp = await launchBrowser({ tag: '730-stepper', width: 1280, height: 800, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, navigate, close } = cdp;
try {
  const shot = async (name, sels = null) => {
    let clip = null;
    if (sels) clip = await evalJs(`(() => { const rs = ${JSON.stringify([].concat(sels))}.map((q) => document.querySelector(q).getBoundingClientRect());
      const x = Math.max(0, Math.min(...rs.map((r) => r.left)) - 8), y = Math.max(0, Math.min(...rs.map((r) => r.top)) - 8);
      return { x, y, width: Math.max(...rs.map((r) => r.right)) + 8 - x, height: Math.max(...rs.map((r) => r.bottom)) + 8 - y, scale: 1 }; })()`);
    const { data } = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
    fs.writeFileSync(path.join(EVIDENCE_DIR, name), Buffer.from(data, 'base64'));
    console.log('screenshot ' + path.join(EVIDENCE_DIR, name));
  };
  let phone = false;
  const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
  // press(x, y, holdMs): a mouse click (desktop) or a touch tap (phone); a hold keeps the button / finger down for holdMs
  const press = async (x, y, holdMs = 40) => {
    if (phone) { await T('touchStart', [{ x, y }]); await sleep(holdMs); await T('touchEnd', []); }
    else {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
      await sleep(holdMs);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    }
    await sleep(200);
  };
  const centre = async (sel) => {
    const p = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const hit = document.elementFromPoint(x, y);
      return { x, y, w: r.width, h: r.height, onTop: !!hit && (hit === e || e.contains(hit)) }; })()`);
    assert.ok(p && p.onTop, `${sel} is on screen and not covered: ${JSON.stringify(p)}`);
    return p;
  };
  const clickEl = async (sel, holdMs) => { const p = await centre(sel); await press(p.x, p.y, holdMs); return p; };
  const val = (sel) => evalJs(`document.querySelector(${JSON.stringify(sel)}).value`);
  const activeStage = () => evalJs(`(() => { const e = document.querySelector('.sk-sidebar-stage.active') || document.querySelector('.sk-header-tab.active'); return e ? e.dataset.tab : null; })()`);
  const openMode = async (mode) => {
    for (let i = 0; i < 5; i++) {
      if (await activeStage() === mode) return;
      if (phone) { // phones have no header bar: the stages are the drawer's first row (task 619)
        await clickEl('.sk-sidebar-handle');
        await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'the drawer opens'); await sleep(300);
        await clickEl(`.sk-sidebar-stage[data-tab="${mode}"]`);
      } else await clickEl(`.sk-header-tab[data-tab="${mode}"]`);
      await sleep(400);
    }
    assert.fail('could not open the ' + mode + ' stage');
  };
  const rec = () => evalJs(`import('/apps/shaper/src/cut-plan.js').then((m) => { const r = [...m.CUT_PLAN.values()][0]; return r ? { cutType: r.cutType, cutDepth: r.cutDepth, cutOffset: r.cutOffset, toolDia: r.toolDia } : null; })`);
  const near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-6, `${m}: ${a} vs ${b}`);

  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 8000);
  await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'shaper app ready');
  await openMode('design');
  await waitFor('!!(window.__designController && window.__designController.state)', 'design controller ready');
  await evalJs(`(() => {
    const st = window.__designController.state;
    for (const k of [...st.joints.keys()]) st.joints.delete(k);
    st.shapes.length = 0; st.constraints.length = 0;
    const poly = (p, pts) => { pts.forEach(([x, y], i) => st.joints.set(p + i, { x, y })); pts.forEach((_, i) => st.shapes.push({ id: p + 's' + i, type: 'line', joints: [p + i, p + ((i + 1) % pts.length)] })); };
    poly('A', [[-30, -20], [30, -20], [30, 20], [-30, 20]]);
  })()`);

  const setMm = () => evalJs(`import('/packages/core/settings-manager.js').then((m) => { m.default.set('DOC_UNIT', 'mm'); })`); // the steps are declared per unit; the live checks run in mm (inches: tests/number-stepper-730-node.test.js)
  await setMm();
  const clickWorld = async (x, y) => {
    const p = await evalJs(`(() => { const svg = document.getElementById('prepare-canvas'); const pt = svg.createSVGPoint(); pt.x = ${x}; pt.y = ${y};
      const s = pt.matrixTransform(svg.getScreenCTM()); return { x: Math.round(s.x), y: Math.round(s.y) }; })()`);
    await press(p.x, p.y);
  };

  // one phase: the cut card, the Review stock card
  const phase = async (label) => {
    const touchMin = phone ? 44 : 0;
    await openMode('prepare');
    await waitFor(`!!document.getElementById('prepare-canvas').getScreenCTM() && document.getElementById('prepare-canvas').children.length > 0`, 'prepare canvas ready');
    // nothing selected: no card (the card's display rule must not beat [hidden])
    assert.strictEqual(await evalJs(`getComputedStyle(document.querySelector('.cut-card')).display`), 'none', label + ': no selection -> no cut card');
    await shot(`prepare-nothing-selected-${label}.png`);
    await clickWorld(0, -20); // the rectangle's top edge
    await waitFor(`!document.querySelector('.cut-card').hidden`, 'the cut card shows for the selected loop');
    await clickEl('#prepare-panel .cut-type-trigger');
    await waitFor(`!document.querySelector('.cut-type-menu').hidden`, 'the type menu');
    await clickEl('.cut-type-opt[data-id="pocket"]');
    await waitFor(`document.querySelector('.cut-type-cur').textContent.toLowerCase().includes('pocket')`, 'Pocket picked');

    // a plain Pocket: none of the stepped rows (Adaptive stepping, Step depth, Resolution) shows
    assert.deepStrictEqual(await evalJs(`['adaptiveSteps', 'stepDepth', 'stepDeviation'].map((r) => getComputedStyle(document.querySelector('.cut-row[data-row="' + r + '"]')).display)`), ['none', 'none', 'none'], label + ': a plain Pocket has no stepped rows');
    // every stepper target on the card: size, and the card fits
    const sizes = await evalJs(`[...document.querySelectorAll('.cut-card .cut-step, .cut-card .cut-flip')].filter((b) => !b.closest('[data-off]')).map((b) => { const r = b.getBoundingClientRect(); return [b.className + ':' + (b.dataset.d || ''), Math.round(r.width), Math.round(r.height)]; }).filter((x) => x[1] > 0)`); // the hidden Step depth / Resolution rows have no box
    assert.strictEqual(sizes.length, 7, 'depth, offset, bit: six steppers + the flip'); console.log(label + ' card targets: ' + JSON.stringify(sizes));
    for (const [n, w, h] of sizes) assert.ok(w >= touchMin && h >= touchMin, `${label} ${n}: ${w} x ${h} (>= ${touchMin})`);
    const fit = await evalJs(`(() => { const c = document.querySelector('.cut-card').getBoundingClientRect(); const bx = [...document.querySelectorAll('.cut-card .cut-box')].map((b) => b.scrollWidth - b.clientWidth);
      return { left: c.left, right: c.right, vw: innerWidth, docScroll: document.documentElement.scrollWidth, boxOverflow: Math.max(...bx) }; })()`);
    console.log(label + ' card fit: ' + JSON.stringify(fit));
    assert.ok(fit.left >= 0 && fit.right <= fit.vw && fit.docScroll <= fit.vw && fit.boxOverflow <= 0, `${label}: the card stays within the viewport and its boxes do not overflow`);

    // depth: unset -> 0.5 -> 1 -> 0.5 -> 0 (clamp) -> 0
    assert.strictEqual(await val('.cut-depth'), '', label + ': depth starts unset');
    await clickEl('.cut-row[data-param="cutDepth"] .cut-step[data-d="1"]');
    near((await rec()).cutDepth, 0.5, label + ' depth + from unset'); assert.strictEqual(await val('.cut-depth'), '0.5');
    await clickEl('.cut-row[data-param="cutDepth"] .cut-step[data-d="1"]');
    near((await rec()).cutDepth, 1, label + ' depth + again');
    await clickEl('.cut-row[data-param="cutDepth"] .cut-step[data-d="-1"]'); await clickEl('.cut-row[data-param="cutDepth"] .cut-step[data-d="-1"]'); await clickEl('.cut-row[data-param="cutDepth"] .cut-step[data-d="-1"]');
    near((await rec()).cutDepth, 0, label + ' depth clamps at 0');
    // hold: the + button held ~1.2 s repeats
    const before = (await rec()).cutDepth;
    await clickEl('.cut-row[data-param="cutDepth"] .cut-step[data-d="1"]', 1200);
    const held = (await rec()).cutDepth;
    assert.ok(held >= before + 1.5, `${label}: holding + repeats (0 -> ${held})`);
    // offset: + 0.25, flip kept, - goes negative
    const flipBefore = await evalJs(`!!document.querySelector('.cut-flip')`);
    assert.ok(flipBefore, 'the flip button is kept');
    await clickEl('.cut-row[data-param="cutOffset"] .cut-step[data-d="1"]');
    near((await rec()).cutOffset, 0.25, label + ' offset +');
    await clickEl('.cut-row[data-param="cutOffset"] .cut-step[data-d="-1"]'); await clickEl('.cut-row[data-param="cutOffset"] .cut-step[data-d="-1"]');
    near((await rec()).cutOffset, -0.25, label + ' offset goes negative');
    await clickEl('.cut-flip');
    near((await rec()).cutOffset, 0.25, label + ' the flip still flips the sign');
    // bit: 3.175 -> 3.5; the preset row is kept
    await clickEl('.cut-row[data-param="toolDia"] .cut-step[data-d="1"]');
    near((await rec()).toolDia, 3.5, label + ' bit + (3.175 -> the next 0.5 multiple)');
    assert.strictEqual(await evalJs(`document.querySelectorAll('.cut-row[data-param="toolDia"] .cut-preset').length`), 4, 'the bit presets are kept');
    await shot(`cut-card-${label}.png`, '#prepare-panel .cut-card');

    // Review: the stock thickness
    await openMode('review');
    await waitFor(`/triangles/.test(document.getElementById('review-info').textContent)`, 'review built');
    const t0 = Number(await val('#review-stock-thickness'));
    const sizesR = await evalJs(`[...document.querySelectorAll('#review-stock .cut-step')].map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })`);
    console.log(label + ' stock targets: ' + JSON.stringify(sizesR));
    assert.strictEqual(sizesR.length, 2);
    for (const [w, h] of sizesR) assert.ok(w >= touchMin && h >= touchMin, `${label} stock target ${w} x ${h}`);
    await clickEl('#review-stock .cut-step[data-d="1"]');
    near(Number(await val('#review-stock-thickness')), Math.floor(t0 + 1e-9) + 1, label + ' stock + 1 mm lands on the next whole mm (from ' + t0 + ')');
    await clickEl('#review-stock .cut-step[data-d="-1"]'); await clickEl('#review-stock .cut-step[data-d="-1"]');
    near(Number(await val('#review-stock-thickness')), Math.floor(t0 + 1e-9) - 1, label + ' stock - 1 mm twice');
    await shot(`review-stock-${label}.png`, '#review-stock');
    const rfit = await evalJs(`(() => { const p = document.getElementById('review-side'); return { sw: p.scrollWidth, cw: p.clientWidth, docScroll: document.documentElement.scrollWidth, vw: innerWidth }; })()`);
    assert.ok(rfit.docScroll <= rfit.vw, label + ' review does not scroll the page sideways: ' + JSON.stringify(rfit));
  };

  await phase('desktop');

  // the phone: 390 x 844, real touch
  phone = true;
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await resetBufferLive(cdp); // the desktop phase's design must not carry into the phone phase (task 684)
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 8000);
  await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'shaper app ready (phone)');
  await openMode('design');
  await waitFor('!!(window.__designController && window.__designController.state)', 'design controller ready (phone)');
  await evalJs(`(() => {
    const st = window.__designController.state;
    for (const k of [...st.joints.keys()]) st.joints.delete(k);
    st.shapes.length = 0; st.constraints.length = 0;
    const poly = (p, pts) => { pts.forEach(([x, y], i) => st.joints.set(p + i, { x, y })); pts.forEach((_, i) => st.shapes.push({ id: p + 's' + i, type: 'line', joints: [p + i, p + ((i + 1) % pts.length)] })); };
    poly('A', [[-30, -20], [30, -20], [30, 20], [-30, 20]]);
  })()`);
  await evalJs(`import('/apps/shaper/src/cut-plan.js').then((m) => m.CUT_PLAN.clear())`);
  await setMm();
  await phase('phone');
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  console.log('number-stepper-730-live: ok');
} finally { await close(); }
