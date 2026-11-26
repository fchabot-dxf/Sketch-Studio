// tests/dim-box-outside-press-723-live.test.js — TASK 723 (live headless, SketchStudio, REAL mouse on a 1280 x 800 desktop + REAL touch on a
// 390 x 844 phone, real keys). An open DIMENSION EDIT BOX closes on a press anywhere outside it (Fusion), and that press still does its own job:
//  1. a VALID CHANGED text + a press on another line: the value is applied (ONE undo step: one Ctrl+Z restores the old value and leaves d2 alone),
//     the box is gone, and the same press selected the line;
//  2. the UNCHANGED text + a press on empty canvas: the box is gone, nothing changed (no undo step: the next Ctrl+Z is still case 1's), the selection cleared;
//  3. an INVALID text + a press on a ribbon tool: the box is gone, nothing changed, no notice shown, the tool started;
//  4. a valid text + a double press on another dimension's label: applied, and THAT dimension's box is open (no extra press);
//  5. a valid text + a press-drag on another line: applied, and the line moved in the same press;
//  6. Esc still cancels, 7. Enter still applies (unchanged);
//  8. a valid text + a press on the footer's Parameters button: applied, and the Parameters window opened.
// Screenshot (local): .evidence/723/<EVID_TAG>-<kind>-1-press-line.png (the box, the d1 label and line B right after case 1's press)
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const EVID = path.resolve('.evidence/723');
const TAG = process.env.EVID_TAG || 'run';
fs.mkdirSync(EVID, { recursive: true });

const cdp = await launchBrowser({ tag: '723-dim-box', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, waitForApp, navigate, close } = cdp;

try {
  const mouseEv = (type, x, y, buttons = 0, clickCount = 1) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : clickCount });
  const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i + 1, radiusX: 1, radiusY: 1, force: 1 })) });
  const POINTERS = {
    mouse: {
      tap: async (p) => { await mouseEv('mouseMoved', p.x, p.y); await sleep(60); await mouseEv('mousePressed', p.x, p.y, 1); await sleep(40); await mouseEv('mouseReleased', p.x, p.y); await sleep(250); },
      twice: async (p) => { await mouseEv('mouseMoved', p.x, p.y); await sleep(60); for (const n of [1, 2]) { await mouseEv('mousePressed', p.x, p.y, 1, n); await sleep(30); await mouseEv('mouseReleased', p.x, p.y, 0, n); await sleep(60); } await sleep(400); },
      drag: async (a, b) => {
        await mouseEv('mouseMoved', a.x, a.y); await sleep(60); await mouseEv('mousePressed', a.x, a.y, 1);
        for (let i = 1; i <= 8; i++) { await mouseEv('mouseMoved', a.x + (b.x - a.x) * i / 8, a.y + (b.y - a.y) * i / 8, 1); await sleep(30); }
        await mouseEv('mouseReleased', b.x, b.y); await sleep(300);
      },
      away: (p) => mouseEv('mouseMoved', p.x, p.y),
    },
    touch: {
      tap: async (p) => { await T('touchStart', [p]); await sleep(50); await T('touchEnd', []); await sleep(350); },
      twice: async (p) => { await T('touchStart', [p]); await sleep(40); await T('touchEnd', []); await sleep(90); await T('touchStart', [p]); await sleep(40); await T('touchEnd', []); await sleep(500); },
      drag: async (a, b) => {
        await T('touchStart', [a]); await sleep(60);
        for (let i = 1; i <= 8; i++) { await T('touchMove', [{ x: a.x + (b.x - a.x) * i / 8, y: a.y + (b.y - a.y) * i / 8 }]); await sleep(30); }
        await T('touchEnd', []); await sleep(350);
      },
      away: async () => {},
    },
  };
  const key = async (k, code, vk, mods = 0, text = '') => { await sendRealKey(send, k, code, vk, mods, text); await sleep(200); };
  const typeText = async (text) => {
    for (const ch of text) {
      const [code, vk] = /[a-z]/i.test(ch) ? ['Key' + ch.toUpperCase(), ch.toUpperCase().charCodeAt(0)] : /\d/.test(ch) ? ['Digit' + ch, ch.charCodeAt(0)] : ['Period', 190];
      await sendRealKey(send, ch, code, vk, 0, ch); await sleep(20);
    }
    await sleep(200);
  };
  const box = () => evalJs(`(() => { const i = document.getElementById('dimInput'); if (!i) return null; const r = i.getBoundingClientRect();
    return { open: !i.classList.contains('hidden'), value: i.value, invalid: i.getAttribute('aria-invalid'), rect: { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }, focused: document.activeElement === i }; })()`);
  const labelOf = (idx) => evalJs(`(() => { const e = document.querySelector('#svgCanvas .dim-label[data-constraint-idx="${idx}"]'); if (!e) return null; const r = e.getBoundingClientRect();
    return { text: e.textContent.trim(), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  const num = (t) => { const m = /-?\d+(\.\d+)?/.exec(t || ''); return m ? +m[0] : NaN; };
  const val = async (idx) => { const l = await labelOf(idx); return l ? num(l.text) : 'label hidden (its box is open)'; };
  const labelIdxs = () => evalJs(`JSON.stringify([...document.querySelectorAll('#svgCanvas .dim-label')].map(e => e.dataset.constraintIdx))`).then(JSON.parse);
  const lines = () => evalJs(`(() => { const out = {}; for (const e of document.querySelectorAll('#svgCanvas line.shape-elem')) { const m = e.getScreenCTM();
    const p = (x, y) => { const q = new DOMPoint(x, y).matrixTransform(m); return { x: Math.round(q.x), y: Math.round(q.y) }; };
    const st = (e.getAttribute('style') || '').toLowerCase();
    out[e.dataset.shapeId] = { a: p(+e.getAttribute('x1'), +e.getAttribute('y1')), b: p(+e.getAttribute('x2'), +e.getAttribute('y2')), blue: st.includes('--sk-selection') || st.includes('#017afd') }; }
    return JSON.stringify(out); })()`).then(JSON.parse);
  const toasts = () => evalJs(`(() => { const c = document.getElementById('notification-container'); return c ? c.children.length : 0; })()`);
  const activeTool = () => evalJs(`(() => { const b = document.querySelector('[id^="tool-"].active'); return b ? b.id : null; })()`);
  const failed = [];
  const runPhase = async (kind) => {
    const P = POINTERS[kind];
    const phone = kind === 'touch';
    const check = (cond, msg) => { if (!cond) { failed.push(`[${kind}] ${msg}`); console.log(`FAIL [${kind}] ${msg}`); } };
    await resetBufferLive(cdp);
    if (phone) {
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    }
    await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 8000);
    await waitForApp('svgCanvas');
    await waitFor(`!!document.getElementById('tool-dim') && !!document.getElementById('tool-line')`, 'the ribbon');
    await sleep(800);
    const cr = await evalJs(`(() => { const r = document.querySelector('#svgCanvas').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`);
    const F = (fx, fy) => ({ x: Math.round(cr.l + cr.w * fx), y: Math.round(cr.t + cr.h * fy) });
    const tool = (id) => pressRibbonTool(evalJs, P.tap, id);
    // a point on a line: 0.85 along it keeps the presses clear of any open box (the box placement itself: tests/dim-box-place-723-live.test.js)
    const along = (l, t) => ({ x: Math.round(l.a.x + (l.b.x - l.a.x) * t), y: Math.round(l.a.y + (l.b.y - l.a.y) * t) });
    const mid = (l) => ({ x: Math.round((l.a.x + l.b.x) / 2), y: Math.round((l.a.y + l.b.y) / 2) });
    const openBox = async (idx) => {
      if ((await box()).open) { await evalJs(`document.getElementById('dimInput').focus()`); await key('Escape', 'Escape', 27); } // a box a failed outside press left open (before the fix) would hide the label
      const lab = await labelOf(idx);
      assert(lab, `[${kind}] label ${idx} on screen`);
      await P.twice(lab);
      await waitFor(`(() => { const i = document.getElementById('dimInput'); return !!i && !i.classList.contains('hidden'); })()`, `[${kind}] the box on label ${idx}`, 8000);
      await evalJs(`(() => { const i = document.getElementById('dimInput'); i.focus(); i.select(); })()`); // a finger tap does not raise the phone keyboard here; select the prefill as Ctrl+A would
      await sleep(100);
    };

    // two horizontal lines, each given its length dimension with the Dim tool (press the line, press where the label goes, Enter keeps the length)
    const A = [F(0.20, 0.30), F(0.60, 0.30)], B = [F(0.25, 0.80), F(0.65, 0.80)]; // clear of the axes (a finger snaps to them from farther)
    for (const [a, b] of [A, B]) { await tool('tool-line'); await P.tap(a); await P.tap(b); await key('Escape', 'Escape', 27); }
    await tool('tool-select');
    const ids0 = Object.keys(await lines());
    assert.strictEqual(ids0.length, 2, `[${kind}] two lines drawn: ${JSON.stringify(ids0)}`);
    // the view may reframe after a draw: every press below is computed from the lines as they are on screen now
    const ls0 = await lines();
    const [idA, idB] = ids0.slice().sort((p, q) => mid(ls0[p]).y - mid(ls0[q]).y);
    const dims = [];
    for (const [id, dy] of [[idA, -60], [idB, 60]]) {
      const before = await labelIdxs();
      // the line selected, D (task 589: the Dim tool with the line as its first pick), then a press where the label goes
      await tool('tool-select');
      const l = (await lines())[id];
      await P.tap(along(l, 0.3)); // off the midpoint (a press there picks the midpoint point)
      await key('d', 'KeyD', 68);
      const at = { x: along(l, 0.12).x, y: mid(l).y + dy }; // off the y axis (a press on it while placing a length makes an angle with it)
      await P.away(at); await sleep(150);
      await P.tap(at);
      await waitFor(`(() => { const i = document.getElementById('dimInput'); return !!i && !i.classList.contains('hidden'); })()`, `[${kind}] the new dimension's box`, 8000);
      await key('Enter', 'Enter', 13, 0, '\r'); await sleep(300);
      const added = (await labelIdxs()).filter((i) => !before.includes(i));
      assert.strictEqual(added.length, 1, `[${kind}] one dimension label added: ${JSON.stringify(added)}`);
      dims.push(added[0]);
    }
    await tool('tool-select');
    const [d1, d2] = dims;
    const v1Start = await val(d1), v2Start = await val(d2);
    console.log(`[${kind}] setup: line A ${idA}, line B ${idB}, d1 = label ${d1} ${v1Start}, d2 = label ${d2} ${v2Start}`);
    const lsE = await lines();
    const empty = { x: Math.round(lsE[idA].a.x + (lsE[idA].b.x - lsE[idA].a.x) * 0.15), y: Math.round((mid(lsE[idA]).y + mid(lsE[idB]).y) / 2) }; // between the lines, off the axes and glyphs

    // 1. a valid changed value (lengths stay near 8 mm so every label stays on screen) + ONE press on line B
    await openBox(d1);
    await typeText('9');
    const typed1 = await box();
    await P.tap(along((await lines())[idB], 0.72)); // 0.72 along: more than 30 px from the line end and from its midpoint at the phone size (task 1010 B-20c: a touch press within 30 px of a point picks the point)
    const after1 = await box();
    await P.away(empty); await sleep(250);
    const ls1 = await lines();
    const v1 = await val(d1);
    console.log(`[${kind}] 1. typed ${JSON.stringify(typed1)} -> press on line B -> box ${JSON.stringify(after1)}, d1 label ${v1}, line B selected ${ls1[idB].blue}`);
    { // the region from the box (where it was open) to line B: the box, the d1 label and the pressed line in one picture
      const vw = await evalJs('window.innerWidth');
      const top = Math.max(0, Math.min(typed1.rect.t, ls1[idA].a.y) - 50), bot = Math.max(ls1[idB].a.y, ls1[idB].b.y, typed1.rect.t + typed1.rect.h) + 40;
      const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: top, width: vw, height: bot - top, scale: phone ? 2 : 1 } });
      fs.writeFileSync(path.join(EVID, `${TAG}-${kind}-1-press-line.png`), Buffer.from(r.data, 'base64'));
    }
    check(after1.open === false, `1. the press on line B closed the box (box ${JSON.stringify(after1)})`);
    check(v1 === 9, `1. the typed 9 was applied (d1 label ${v1})`);
    check(ls1[idB].blue === true, '1. the same press selected line B');

    // 2. the unchanged text + a press on empty canvas: nothing changes, no undo step; the press clears the selection
    await openBox(d1);
    const typed2 = await box();
    const toasts2 = await toasts();
    await P.tap(empty);
    const after2 = await box();
    const ls2 = await lines();
    console.log(`[${kind}] 2. unchanged ${JSON.stringify(typed2.value)} -> press on empty canvas -> box ${JSON.stringify(after2)}, d1 ${await val(d1)}, line B selected ${ls2[idB].blue}`);
    check(after2.open === false, `2. the press on empty canvas closed the box (box ${JSON.stringify(after2)})`);
    check(await val(d1) === v1, '2. the unchanged value stays');
    check(ls2[idB].blue === false, '2. the same press cleared the selection');
    check(await toasts() === toasts2, '2. no notice');
    // ONE Ctrl+Z: back to the start value (case 2 took no step, case 1 took exactly one: d2 is untouched); redo brings 9 back
    if (after2.open) { await evalJs(`document.getElementById('dimInput').focus()`); await key('Escape', 'Escape', 27); } // a box left open (before the fix): its own Esc
    await key('z', 'KeyZ', 90, 2);
    const u1 = await val(d1), u2 = await val(d2);
    console.log(`[${kind}] 2. one Ctrl+Z: d1 ${u1}, d2 ${u2}`);
    check(u1 === v1Start && u2 === v2Start, `2. one Ctrl+Z restores d1 ${v1Start} and leaves d2 ${v2Start} (d1 ${u1}, d2 ${u2})`);
    await key('y', 'KeyY', 89, 2);
    check(await val(d1) === 9, '2. redo brings 9 back');

    // 3. an invalid text + a press on a ribbon tool: nothing changes, no notice, the tool starts
    const v3Before = await val(d1);
    await openBox(d1);
    await typeText('zz');
    const typed3 = await box();
    const toasts3 = await toasts();
    await tool('tool-line');
    const after3 = await box();
    const t3 = await activeTool();
    const v3 = await val(d1);
    console.log(`[${kind}] 3. invalid ${JSON.stringify(typed3)} -> press on the Line tool -> box ${JSON.stringify(after3)}, d1 ${v3}, active tool ${t3}, notices ${toasts3} -> ${await toasts()}`);
    check(typed3.invalid === 'true', '3. "zz" is refused in the box (aria-invalid)');
    check(after3.open === false, `3. the press on the ribbon closed the box (box ${JSON.stringify(after3)})`);
    check(v3 === v3Before, `3. the invalid text changed nothing (d1 ${v3Before} -> ${v3})`);
    check(t3 === 'tool-line', `3. the same press started the Line tool (active ${t3})`);
    check(await toasts() === toasts3, '3. no notice for the discarded text');
    if (after3.open) { await evalJs(`document.getElementById('dimInput').focus()`); await key('Escape', 'Escape', 27); }
    await key('Escape', 'Escape', 27);
    await tool('tool-select');

    // 4. TASK 866: pressing d2's label while d1's box is open inserts d2 at the caret and keeps d1's box open (no commit / no switch); Esc closes
    await openBox(d1);
    await typeText('10');
    await P.tap(await labelOf(d2));
    const after4 = await box();
    const v4 = await val(d1);
    console.log(`[${kind}] 4. 10 -> press d2's label -> box ${JSON.stringify(after4)}, d1 ${v4}`);
    check(after4.open === true && after4.value === '10d2' && after4.focused === true, `4. pressing d2's label inserted d2 and kept d1 open (box ${JSON.stringify(after4)})`);
    check(v4 === 'label hidden (its box is open)', `4. d1 stayed open without committing (d1 ${v4})`);
    await evalJs(`document.getElementById('dimInput').focus()`); await key('Escape', 'Escape', 27);
    check((await box()).open === false, '4. Esc closes d1\'s box');

    // 5. a valid text + a press-drag on line B: d1 applied, line B moved in the same press
    await openBox(d1);
    await typeText('11');
    const lb = (await lines())[idB];
    const from = along(lb, 0.72), to = { x: from.x, y: from.y + 40 };
    await P.drag(from, to);
    await P.away(empty); await sleep(200);
    const after5 = await box();
    const lb5 = (await lines())[idB];
    const v5 = await val(d1);
    console.log(`[${kind}] 5. 11 -> drag line B 40 px down -> box ${JSON.stringify(after5)}, d1 ${v5}, line B y ${mid(lb).y} -> ${mid(lb5).y}`);
    check(after5.open === false, '5. the drag closed the box');
    check(v5 === 11, `5. d1 took 11 (d1 ${v5})`);
    check(mid(lb5).y - mid(lb).y > 20, `5. the same press dragged line B (y ${mid(lb).y} -> ${mid(lb5).y})`);

    // 6. Esc still cancels; 7. Enter still applies
    const v6 = await val(d1);
    await openBox(d1);
    await typeText('12');
    await key('Escape', 'Escape', 27);
    const after6 = await box();
    check(after6.open === false && await val(d1) === v6, `6. Esc closes and changes nothing (box ${after6.open}, d1 ${await val(d1)})`);
    await openBox(d1);
    await typeText('7');
    await key('Enter', 'Enter', 13, 0, '\r'); await sleep(300);
    const after7 = await box();
    check(after7.open === false && await val(d1) === 7, `7. Enter applies (box ${after7.open}, d1 ${await val(d1)})`);

    // 8. a valid text + a press on the footer's Parameters button: applied, the window opened
    await openBox(d1);
    await typeText('8.5');
    const pb = await evalJs(`(() => { const b = document.getElementById('btn-parameters'); const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    await P.tap(pb);
    const after8 = await box();
    const win8 = await evalJs(`(() => { const e = document.querySelector('.sk-pwin'); return !!e && !e.hidden && e.getBoundingClientRect().width > 0; })()`);
    console.log(`[${kind}] 8. 8.5 -> press on the footer's Parameters button -> box ${JSON.stringify(after8)}, d1 ${await val(d1)}, window ${win8}`);
    check(after8.open === false, '8. the footer press closed the box');
    check(await val(d1) === 8.5, '8. d1 took 8.5');
    check(win8 === true, '8. the same press opened the Parameters window');
    if (after8.open) { await evalJs(`document.getElementById('dimInput').focus()`); await key('Escape', 'Escape', 27); }
    await key('Escape', 'Escape', 27);
  };

  for (const kind of (process.env.PHASES || 'mouse,touch').split(',')) {
    try { await runPhase(kind); } catch (e) { failed.push(`[${kind}] stopped: ${e.message}`); console.log(`FAIL [${kind}] stopped: ${e.message}`); }
  }
  assert.deepStrictEqual(failed, [], `${failed.length} check(s) failed`);
  console.log('dim-box-outside-press-723-live: ALL CHECKS PASSED');
} finally {
  await close();
}
