// tests/vcarve-units-734-live.test.js — TASK 734: the Vcarve panel follows the DOCUMENT unit in the real page (desktop 1280 x 800 mouse, phone 390 x 844 touch).
//   An inch document shows Depth step / Max depth / the readout / the region list in inches, the steppers move by 1/64 and 1/32 in, typed inches are stored as mm,
//   switching to mm and back re-shows the fields. Screenshots to EVIDENCE_DIR (or .evidence/734/): vcarve-inch-desktop.png, vcarve-mm-desktop.png, vcarve-inch-phone.png, vcarve-mm-phone.png.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const EVIDENCE_DIR = process.env.EVIDENCE_DIR || path.resolve('.evidence/734');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const cdp = await launchBrowser({ tag: '734-vcarve-units', width: 1280, height: 800, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
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
    const p = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect();
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
  const near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-6, `${m}: ${a} vs ${b}`);
  const setUnit = (u) => evalJs(`import('/packages/core/settings-manager.js').then((m) => { m.default.set('DOC_UNIT', '${u}'); })`);
  const recV = () => evalJs(`JSON.stringify(window.__designController.state.vcarves[0] || null)`).then((s) => JSON.parse(s));
  const type = (sel, v) => evalJs(`(() => { const i = document.querySelector(${JSON.stringify(sel)}); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  const text = (sel) => evalJs(`document.querySelector(${JSON.stringify(sel)}).textContent`);
  const regionOpt = () => evalJs(`document.getElementById('vcarve-region').options[1].textContent`);
  const D = '#vcarve-dstep', M = '#vcarve-maxdepth';
  const dPlus = `${D} ~ .cut-step[data-d="1"]`, dMinus = `.vcarve-stepbox:has(${D}) .cut-step[data-d="-1"]`, mPlus = `${M} ~ .cut-step[data-d="1"]`;

  const phase = async (label) => {
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 8000);
    await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'shaper app ready');
    await openMode('design');
    await waitFor('!!(window.__designController && window.__designController.state)', 'design controller ready');
    await evalJs(`(() => {
      const st = window.__designController.state;
      for (const k of [...st.joints.keys()]) st.joints.delete(k);
      st.shapes.length = 0; st.constraints.length = 0; st.vcarves = [];
      const poly = (p, pts) => { pts.forEach(([x, y], i) => st.joints.set(p + i, { x, y })); pts.forEach((_, i) => st.shapes.push({ id: p + 's' + i, type: 'line', joints: [p + i, p + ((i + 1) % pts.length)] })); };
      poly('A', [[-30, -20], [30, -20], [30, 20], [-30, 20]]);
    })()`);
    await setUnit('in');
    await openMode('vcarve');
    await waitFor(`!document.querySelector('${D}').disabled`, 'the Vcarve controls are enabled');
    // pick the one profile from the region list
    await evalJs(`(() => { const s = document.getElementById('vcarve-region'); s.value = s.options[1].value; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await waitFor(`/contours/.test(document.getElementById('vcarve-readout').textContent)`, 'the region is picked');
    const regionText = await regionOpt();
    console.log(label + ' region option: ' + regionText);
    assert.ok(/ in²/.test(regionText) && !/ mm²/.test(regionText), label + ': the area is in in²: ' + regionText);
    assert.strictEqual(await val(D), '0.0197 in', label + ' depth step default 0.5 mm shown in inches');
    assert.strictEqual(await val(M), '0.2362 in', label + ' max depth default 6 mm shown in inches');
    const ro = await text('#vcarve-readout'); console.log(label + ' readout: ' + ro);
    assert.ok(/ in$/.test(ro) && !/ mm/.test(ro), label + ': the readout is in inches: ' + ro);

    // typed inches (with and without the suffix, and a mm override) are stored in mm
    await type(D, '0.125'); near((await recV()).dStep, 3.175, label + ' 0.125 -> 3.175 mm'); assert.strictEqual(await val(D), '0.125 in');
    await type(M, '0.25 in'); near((await recV()).maxDepth, 6.35, label + ' 0.25 in -> 6.35 mm');
    await type(D, '3 mm'); near((await recV()).dStep, 3, label + ' 3 mm -> 3'); assert.strictEqual(await val(D), '0.1181 in');
    await type(D, '0'); near((await recV()).dStep, 3, label + ' typed 0 refused'); assert.strictEqual(await val(D), '0.1181 in');
    await type(D, '0.125');
    // steppers: 1/64 and 1/32 in
    await clickEl(dPlus); near((await recV()).dStep, 25.4 * 9 / 64, label + ' depth step + 1/64 in');
    await clickEl(dMinus); near((await recV()).dStep, 25.4 * 8 / 64, label + ' depth step - 1/64 in');
    await clickEl(mPlus); near((await recV()).maxDepth, 25.4 * 9 / 32, label + ' max depth + 1/32 in (0.25 -> 0.28125)');
    await type(D, '0.015625'); await clickEl(dMinus); near((await recV()).dStep, 25.4 / 64, label + ' at 1/64: - stays (> 0)');
    await type(D, '0.125'); await type(M, '0.25');
    await waitFor(`/ in$/.test(document.getElementById('vcarve-readout').textContent)`, 'readout in inches');
    await shot(`vcarve-inch-${label}.png`, '#vcarve-panel');

    // switch to mm and back with the panel open
    await setUnit('mm');
    await waitFor(`document.querySelector('${D}').value === '3.175 mm'`, 'switched to mm: depth step 3.175 mm');
    assert.strictEqual(await val(M), '6.35 mm');
    assert.ok(/ mm$/.test(await text('#vcarve-readout')) && / mm²/.test(await regionOpt()), label + ' readout and region list follow to mm');
    await clickEl(dPlus); near((await recV()).dStep, 3.5, label + ' mm + 0.5 -> 3.5');
    await shot(`vcarve-mm-${label}.png`, '#vcarve-panel');
    await type(D, '3.175');
    await setUnit('in');
    await waitFor(`document.querySelector('${D}').value === '0.125 in'`, 'back to inches');
    near((await recV()).dStep, 3.175, label + ' the stored value never moved');
    const vfit = await evalJs(`(() => { const p = document.getElementById('vcarve-panel'); return { sw: p.scrollWidth, cw: p.clientWidth, docScroll: document.documentElement.scrollWidth, vw: innerWidth }; })()`);
    assert.ok(vfit.sw <= vfit.cw && vfit.docScroll <= vfit.vw, label + ' vcarve panel does not overflow: ' + JSON.stringify(vfit));
    await setUnit('mm');
  };

  await phase('desktop');
  phone = true;
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await resetBufferLive(cdp); // the desktop phase's design must not carry into the phone phase (task 684)
  await phase('phone');
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  console.log('vcarve-units-734-live: ok');
} finally { await close(); }
