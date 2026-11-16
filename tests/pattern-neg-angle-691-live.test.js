// tests/pattern-neg-angle-691-live.test.js — TASK 691: live CDP test (mouse 1600x900 + touch 390x844) for negative circular pattern angle.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './helpers/cdp-browser.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EVID = path.resolve('.evidence/691');
const STATE = 'window.__sketch.controller.state';
const WANT_MSG = 'the total angle must be between -360 and 360 degrees, not 0';

const cdp = await launchBrowser({ tag: '691-pattern-neg', width: 1600, height: 900 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }

const { port, send, evalJs, waitFor, waitForApp, navigate, close } = cdp;
fs.mkdirSync(EVID, { recursive: true });

try {
  const shot = async (file, clip) => {
    const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
    fs.writeFileSync(path.join(EVID, file), Buffer.from(r.data, 'base64'));
  };
  const key = async (k, code, vk, modifiers = 0) => {
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers });
    await sleep(250);
  };
  const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', {
    type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1,
  });
  const T = (type, pts) => send('Input.dispatchTouchEvent', {
    type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i + 1, radiusX: 1, radiusY: 1, force: 1 })),
  });
  const pointers = {
    mouse: {
      tap: async (p) => { await mouse('mouseMoved', p.x, p.y, 0); await sleep(60); await mouse('mousePressed', p.x, p.y, 1); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0); await sleep(250); },
      double: async (p) => { await mouse('mouseMoved', p.x, p.y, 0); await sleep(60); for (let i = 0; i < 2; i++) { await mouse('mousePressed', p.x, p.y, 1); await sleep(30); await mouse('mouseReleased', p.x, p.y, 0); await sleep(60); } await sleep(300); },
    },
    touch: {
      tap: async (p) => { await T('touchStart', [p]); await sleep(60); await T('touchEnd', []); await sleep(300); },
      double: async (p) => { for (let i = 0; i < 2; i++) { await T('touchStart', [p]); await sleep(40); await T('touchEnd', []); await sleep(80); } await sleep(300); },
    },
  };

  const lines = () => evalJs(`JSON.stringify(${STATE}.shapes.filter((s) => s.type === 'line').map((s) => ({ id: s.id, a: ${STATE}.joints.get(s.joints[0]), b: ${STATE}.joints.get(s.joints[1]) })))`).then(JSON.parse);
  const pats = () => evalJs(`JSON.stringify(${STATE}.constraints.filter((c) => /Pattern$/.test(c.type)).map((c, idx) => ({ type: c.type, quantity: c.quantity, angle: c.angle, n: c.instances.length, idx: ${STATE}.constraints.indexOf(c) })))`).then(JSON.parse);
  const centre = async (sel) => {
    await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e && e.scrollIntoView) e.scrollIntoView({ block: 'nearest' }); })()`);
    return evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  };
  const field = (name) => `.sk-pattern-dialog [data-field="${name}"]`;
  const typeField = async (P, name, text) => {
    const sel = field(name);
    await P.tap(await centre(sel));
    await evalJs(`(() => { const i = document.querySelector(${JSON.stringify(sel)}); i.focus(); i.select(); })()`);
    for (const ch of text) await send('Input.dispatchKeyEvent', { type: 'char', text: ch });
    await sleep(250);
  };
  const toScreen = (x, y) => evalJs(`(() => { const svg = document.querySelector('#design-canvas'); const pt = svg.createSVGPoint(); pt.x = ${x}; pt.y = ${y}; const q = pt.matrixTransform(svg.getScreenCTM()); return { x: q.x, y: q.y }; })()`);
  const angleOf = (l, c) => (Math.atan2(-((l.a.y + l.b.y) / 2 - c.y), (l.a.x + l.b.x) / 2 - c.x) * 180 / Math.PI + 360) % 360;
  const checkClockAngles = (ls, CW, expectedDegs, msg) => {
    const got = ls.map((l) => angleOf(l, CW));
    for (const want of expectedDegs) {
      const wNorm = ((want % 360) + 360) % 360;
      assert(got.some((g) => Math.abs(((g - wNorm + 540) % 360) - 180) < 1e-4), `${msg}: missing angle ${want} deg in [${got.map((x) => x.toFixed(2))}]`);
    }
  };

  const openHost = async (phone) => {
    if (phone) {
      await resetBufferLive(cdp);
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    }
    await navigate(`http://127.0.0.1:${port}/apps/penplotter/index.html`, 8000);
    await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'design stage tab');
    await evalJs(`document.querySelector('.sk-header-tab[data-tab="design"]').click()`);
    await waitForApp('design-canvas');
    await waitFor(`document.querySelector('#design-canvas').getBoundingClientRect().width > 0 && !!${STATE}`, 'design canvas ready');
    await sleep(400);
  };

  const run = async (kind) => {
    const phone = kind === 'touch';
    const P = pointers[kind];
    const vh = phone ? 844 : 900;
    await openHost(phone);
    const cr = await evalJs(`(() => { const r = document.querySelector('#design-canvas').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`);
    const R1 = Math.min(cr.w, cr.h) * 0.22;
    const O = { x: Math.round(cr.l + cr.w * 0.45), y: Math.round(cr.t + cr.h * 0.30) };

    // Draw line rightward from O (0 deg)
    await evalJs(`document.querySelector('#tool-line').click()`); await sleep(200);
    await P.tap(O);
    await P.tap({ x: O.x + R1, y: O.y });
    await key('Escape', 'Escape', 27);
    const src = await lines();
    assert.strictEqual(src.length, 1, `[${kind}] 1 source line drawn`);
    const CW = src[0].a;
    const baseDeg = angleOf(src[0], CW);
    const cwScreen = await toScreen(CW.x, CW.y);
    const midScreen = await toScreen((src[0].a.x + src[0].b.x) / 2, (src[0].a.y + src[0].b.y) / 2);
    const h0 = await evalJs(`${STATE}.history.length`);
    const clip = {
      x: Math.max(0, Math.round(cwScreen.x - R1 - 40)),
      y: Math.max(0, Math.round(cwScreen.y - R1 - 40)),
      width: Math.min(Math.round(R1 * 2 + 100), Math.round(cr.w)),
      height: Math.min(Math.round(R1 * 2 + 120), vh),
    };

    // Start Circular Pattern, pick line, check -> centre -> CW
    await evalJs(`${STATE}.selectedShapes.clear(); ${STATE}.selectedJoints.clear()`);
    await pressRibbonTool(evalJs, P.tap, 'tool-circularPattern');
    await waitFor(`!!document.querySelector('.sk-pattern-dialog:not([hidden])')`, `[${kind}] dialog opens`);
    await P.tap(midScreen);
    const chk = await centre('.sk-done:not([hidden])');
    assert(chk, `[${kind}] done check shows`);
    await P.tap(chk);
    await waitFor(`${STATE}.pattern && ${STATE}.pattern.step === 'centre'`, `[${kind}] centre step`);
    await P.tap(cwScreen);
    await waitFor(`${STATE}.constraints.some((c) => c.type === 'circularPattern')`, `[${kind}] live pattern created`);

    // Distribution -> Angle, enter -90
    await evalJs(`(() => { const s = document.querySelector(${JSON.stringify(field('Distribution'))}); s.value = 'angle'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await waitFor(`!document.querySelector(${JSON.stringify(field('Angle'))}).closest('.sk-pat-row').hidden`, `[${kind}] Angle row visible`);
    await typeField(P, 'Angle', '-90');

    let p = (await pats())[0];
    assert.strictEqual(p.angle, -90, `[${kind}] angle=-90 accepted while placing`);
    checkClockAngles(await lines(), CW, [baseDeg, baseDeg - 45, baseDeg - 90], `[${kind}] -90 clockwise`);
    const lbl90 = await evalJs(`document.querySelector('.dim-label[data-constraint-idx="' + ${p.idx} + '"] text').textContent`);
    assert(lbl90.includes('-90'), `[${kind}] label shows signed -90 (${lbl90})`);

    // Refusal check: 0 refused with new message (clear toast afterwards so bottom sheet OK button isn't covered on 390x844)
    await typeField(P, 'Angle', '0');
    assert.strictEqual(await evalJs(`document.querySelector(${JSON.stringify(field('Angle'))}).getAttribute('aria-invalid')`), 'true', `[${kind}] 0 marked invalid`);
    await key('Enter', 'Enter', 13);
    const toastTxt = await evalJs(`(document.getElementById('notification-container') || { textContent: '' }).textContent`);
    assert(toastTxt.includes(WANT_MSG), `[${kind}] 0 Enter toast shows new message (${toastTxt})`);
    await evalJs(`const c = document.getElementById('notification-container'); if (c) c.innerHTML = '';`);

    // Restore -90 and commit OK
    await typeField(P, 'Angle', '-90');
    await P.tap(await centre('.sk-pattern-dialog .sk-pat-ok'));
    await waitFor(`!document.querySelector('.sk-pattern-dialog:not([hidden])')`, `[${kind}] dialog closes on OK`);
    assert.strictEqual(await evalJs(`${STATE}.history.length`), h0 + 1, `[${kind}] ONE undo step`);
    await shot(`${kind}-1-neg90.png`, clip);

    // Double-click / double-tap pattern label -> edit Angle to -120 -> follows clockwise
    const labPt = await centre(`.dim-label[data-constraint-idx="${p.idx}"]`);
    await sleep(550);
    await P.double(labPt);
    await waitFor(`!!document.querySelector('.sk-pattern-dialog:not([hidden])')`, `[${kind}] double-tap label reopens dialog`);
    assert.strictEqual(await evalJs(`document.querySelector(${JSON.stringify(field('Angle'))}).closest('.sk-pat-row').hidden`), false, `[${kind}] reopened dialog shows Angle row for -90`);
    await typeField(P, 'Angle', '-120');
    await key('Enter', 'Enter', 13);
    await waitFor(`!document.querySelector('.sk-pattern-dialog:not([hidden])')`, `[${kind}] Enter closes edited dialog`);

    p = (await pats())[0];
    assert.strictEqual(p.angle, -120, `[${kind}] label edit applied -120`);
    checkClockAngles(await lines(), CW, [baseDeg, baseDeg - 60, baseDeg - 120], `[${kind}] -120 clockwise`);
    const lbl120 = await evalJs(`document.querySelector('.dim-label[data-constraint-idx="' + ${p.idx} + '"] text').textContent`);
    assert(lbl120.includes('-120'), `[${kind}] label shows signed -120 (${lbl120})`);
    await shot(`${kind}-2-neg120.png`, clip);

    // Undo steps back to -90 (Ctrl+Z on mouse, footer Undo tap on phone touch)
    if (phone) await P.tap(await centre('#btn-undo'));
    else await key('z', 'KeyZ', 90, 2); // Ctrl+Z
    await waitFor(`${STATE}.constraints.find((c) => c.type === 'circularPattern')?.angle === -90`, `[${kind}] Undo restores -90`);
    checkClockAngles(await lines(), CW, [baseDeg, baseDeg - 45, baseDeg - 90], `[${kind}] Ctrl+Z back to -90 clockwise`);
    console.log(`[${kind}] pattern-neg-angle-691-live ok`);
  };

  await run('mouse');
  await run('touch');
  console.log('pattern-neg-angle-691-live: ALL CHECKS PASSED');
} finally {
  await close();
}
