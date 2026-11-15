// TASK 677 ADDITION (owner ruling, Fusion measured): `name = value` typed into a dimension box NAMES that dimension. The REAL Shaper page (Design tab),
// real mouse at 1400 x 860 and real touch on a 390 x 844 phone, real keys: three dimensions d1, d2, d3; `thickness = 18` typed into d1's box,
// `thickness` into d2's and d3's; then 12 into thickness's box: all three are 12; thickness shows a PLAIN value with the hover tag
// "thickness : <value> <unit>" (an SVG <title>, the browser's own tooltip); d2 and d3 show "fx: ..."; no user parameter exists; ONE undo restores 18.
// EVIDENCE_DIR (optional): cropped screenshots of the labels.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sendRealKey, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

await (async () => {
  const cdp = await launchBrowser({ tag: '677n', width: 1400, height: 860 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate, waitForApp } = cdp;
  const mouseEv = (type, x, y, buttons = 0, clickCount = 1) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : clickCount });
  const mouse = async (x, y) => { await mouseEv('mouseMoved', x, y); await sleep(30); await mouseEv('mousePressed', x, y, 1); await sleep(30); await mouseEv('mouseReleased', x, y); await sleep(250); };
  const dblclick = async (x, y) => { await mouseEv('mouseMoved', x, y); await sleep(60); for (const n of [1, 2]) { await mouseEv('mousePressed', x, y, 1, n); await sleep(30); await mouseEv('mouseReleased', x, y, 0, n); await sleep(60); } await sleep(400); };
  const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
  const touch = async (x, y) => { await T('touchStart', [{ x, y }]); await sleep(40); await T('touchEnd', []); await sleep(350); };
  const doubleTap = async (x, y) => { await T('touchStart', [{ x, y }]); await sleep(40); await T('touchEnd', []); await sleep(90); await T('touchStart', [{ x, y }]); await sleep(40); await T('touchEnd', []); await sleep(500); };
  let pointer = mouse, twice = dblclick;
  const key = (k, code, vk, mods = 0, text = '') => sendRealKey(send, k, code, vk, mods, text);
  const SIGN = { ' ': ['Space', 32], '=': ['Equal', 187] };
  const type = async (text) => {
    for (const ch of text) {
      const [code, vk] = /[a-z]/i.test(ch) ? ['Key' + ch.toUpperCase(), ch.toUpperCase().charCodeAt(0)] : /\d/.test(ch) ? ['Digit' + ch, ch.charCodeAt(0)] : SIGN[ch];
      await key(ch, code, vk, 0, ch); await sleep(15);
    }
    await sleep(150);
  };
  const center = async (sel) => {
    const c = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return r.width ? { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) } : null; })()`);
    assert(c, sel + ' not on screen'); return c;
  };
  const press = async (sel) => { const c = await center(sel); await pointer(c.x, c.y); };
  const S = (expr) => evalJs(`(() => { const s = window.__designController.state; return (${expr}); })()`);
  const idx = (name) => S(`s.constraints.findIndex((c) => c.name === ${JSON.stringify(name)})`);
  const labelSel = async (name) => `#design-canvas .dim-label[data-constraint-idx="${await idx(name)}"]`;
  const label = async (name) => evalJs(`(() => { const g = document.querySelector(${JSON.stringify(await labelSel(name))}); return g ? { text: g.querySelector('text').textContent.trim(), tag: g.querySelector('title') ? g.querySelector('title').textContent : null } : null; })()`);
  const dims = () => S(`JSON.stringify(s.constraints.filter((c) => c.type === 'distance').map((c) => [c.name, c.expression || null, Math.round(c.value * 1e6) / 1e6]))`).then(JSON.parse);
  const history = () => S('s.history.length');
  const shot = async (name) => {
    if (!process.env.EVIDENCE_DIR) return;
    const r = await evalJs(`(() => { const gs = [...document.querySelectorAll('#design-canvas .dim-label')]; const b = gs.map((g) => g.getBoundingClientRect()); const l = Math.min(...b.map((x) => x.left)), t = Math.min(...b.map((x) => x.top)), rr = Math.max(...b.map((x) => x.right)), bb = Math.max(...b.map((x) => x.bottom)); return { x: Math.max(0, l - 120), y: Math.max(0, t - 40), width: rr - l + 240, height: bb - t + 80 }; })()`);
    const s = await send('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 2 } });
    fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name), Buffer.from(s.data, 'base64'));
  };
  // open a dimension's box with a real double click / double tap on its label, type, Enter
  const typeInto = async (name, text) => {
    const sel = await labelSel(name);
    const c = await center(sel);
    const hit = await evalJs(`(() => { const e = document.elementFromPoint(${c.x}, ${c.y}); return e === null ? null : (e.closest(${JSON.stringify(sel)}) ? 'label' : e.outerHTML.slice(0, 100)); })()`);
    assert.strictEqual(hit, 'label', `${name}: its label is under the pointer (not covered)`);
    await twice(c.x, c.y);
    await waitFor(`(() => { const i = document.getElementById('dimInput'); return !!i && !i.classList.contains('hidden'); })()`, `the box on ${name}`, 8000);
    await key('a', 'KeyA', 65, 2); // select what the box was prefilled with
    await type(text);
    const hint = await evalJs(`(() => { const h = document.getElementById('dimHint'); return h && !h.classList.contains('hidden') ? h.textContent : null; })()`);
    await key('Enter', 'Enter', 13, 0, '\r'); await sleep(600);
    return hint;
  };
  const openShaper = async () => {
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 10000);
    await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"], .sk-sidebar-handle')`, 'Shaper to load');
    for (let i = 0; i < 5; i++) { const on = await evalJs(`(() => { const t = document.querySelector('.sk-header-tab.active'); return !t || t.dataset.tab === 'design'; })()`); if (on) break; await press('.sk-header-tab[data-tab="design"]'); }
    await waitFor(`!!window.__designController`, 'the Shaper Design tab');
    await waitForApp('design-canvas');
  };
  // three horizontal 20 mm lines below the origin (the recentred view shows them), each fixed at its left end, each with a horizontal distance dimension d1 / d2 / d3
  const seed = () => evalJs(`(() => {
    const st = window.__designController.state;
    st.clearDocument();
    [4, 12, 20].forEach((y, i) => {
      const a = 'a' + i, b = 'b' + i;
      st.joints.set(a, { x: -10, y, fixed: true }); st.joints.set(b, { x: 10, y });
      st.shapes.push({ id: 'L' + i, type: 'line', joints: [a, b] });
      st.constraints.push({ type: 'distance', joints: [a, b], value: 20, name: 'd' + (i + 1), dimMode: 'horizontal', offset: 3, isDriven: false, driven: false });
    });
    st.saveState('seeded');
    return st.constraints.length;
  })()`);

  const scenario = async (tag) => {
    await seed();
    await press('#btn-recenter-view'); await sleep(600);
    // the recentred view fits the LINES; a real wheel zooms out so every label (beside its line) is on screen too
    const cv = await center('#design-canvas');
    for (let i = 0; i < 3; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cv.x, y: cv.y, deltaX: 0, deltaY: 200 }); await sleep(120); }
    await sleep(400);
    await press('#tool-select');
    // 1. `thickness = 18` names d1
    const hint = await typeInto('d1', 'thickness = 18 mm'); // explicit units: Shaper's document unit may be inches
    assert.ok(/^names it thickness = /.test(hint), `${tag}: the hint before Enter: ${hint}`);
    assert.deepStrictEqual(await S('s.parameters.length'), 0, `${tag}: no user parameter`);
    assert.deepStrictEqual((await dims())[0], ['thickness', null, 18], `${tag}: d1 is now thickness = 18`);
    // 2. d2 and d3 typed `thickness`
    await typeInto('d2', 'thickness');
    await typeInto('d3', 'thickness');
    assert.deepStrictEqual(await dims(), [['thickness', null, 18], ['d2', 'thickness', 18], ['d3', 'thickness', 18]], `${tag}: d2 and d3 follow thickness`);
    // 3. 12 into thickness: all three are 12, in ONE undo step
    const h0 = await history();
    await typeInto('thickness', '12 mm');
    assert.deepStrictEqual(await dims(), [['thickness', null, 12], ['d2', 'thickness', 12], ['d3', 'thickness', 12]], `${tag}: 12 typed into thickness: all three are 12`);
    assert.strictEqual(await history(), h0 + 1, `${tag}: ONE undo step`);
    const lens = await S(`JSON.stringify(s.shapes.map((sh) => Math.round((s.joints.get(sh.joints[1]).x - s.joints.get(sh.joints[0]).x) * 1e4) / 1e4))`).then(JSON.parse);
    assert.deepStrictEqual(lens, [12, 12, 12], `${tag}: the three lines are 12 long`);
    const t = await label('thickness'), f2 = await label('d2'), f3 = await label('d3');
    assert.ok(!/^fx/.test(t.text) && f2.text === 'fx: ' + t.text && f3.text === 'fx: ' + t.text, `${tag}: thickness shows a plain value, d2 / d3 show fx: ${JSON.stringify([t, f2, f3])}`);
    const u = t.text === '12.0' ? 'mm' : 'in'; // Shaper's document unit (12 mm reads 0.5 in)
    assert.strictEqual(t.tag, `thickness : ${t.text} ${u}`, `${tag}: the hover tag of the named dimension`);
    assert.strictEqual(f2.tag, null, `${tag}: an automatic name has no tag`);
    await sleep(200); await shot(`naming-${tag}-thickness-12.png`);
    // 4. undo: one step restores 18 everywhere
    await key('Escape', 'Escape', 27);
    await key('z', 'KeyZ', 90, 2); await sleep(600);
    assert.deepStrictEqual(await dims(), [['thickness', null, 18], ['d2', 'thickness', 18], ['d3', 'thickness', 18]], `${tag}: ONE Ctrl+Z restores 18`);
  };

  try {
    // ================================================================== desktop, mouse
    await openShaper();
    await resetBufferLive(cdp);
    await openShaper();
    await scenario('desktop');
    // the hover tag shows on a real mouse hover: the pointer over the label is over the <g> that holds the <title>
    const lp = await center(await labelSel('thickness'));
    await mouseEv('mouseMoved', lp.x, lp.y); await sleep(300);
    assert.strictEqual(await evalJs(`(() => { const e = document.elementFromPoint(${lp.x}, ${lp.y}); const g = e && e.closest('.dim-label'); return g && g.querySelector('title') ? g.querySelector('title').textContent.split(' : ')[0] : null; })()`), 'thickness', 'the hovered label carries the tag');

    // ================================================================== phone 390 x 844, real touch
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    pointer = touch; twice = doubleTap;
    await openShaper();
    await scenario('phone');
    console.log('dimension-naming-677-live: ok');
  } finally { await cdp.close(); }
})();
process.exit(0);
