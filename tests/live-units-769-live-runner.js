// tests/live-units-769-live-runner.js -- TASK 769, shared by live-units-769-studio-live.test.js (PART=studio) and live-units-769-shaper-live.test.js (PART=shaper) (live headless, REAL mouse + REAL keys, REAL phone touch 390): the values shown and typed WHILE DRAWING follow
// the document unit (owner turn 2315: an INCH Shaper document showed "317.5 x 167.6" on a 12.5 x 6.6 in rectangle; a bare "2" typed drew 2 mm).
//  INCH documents (SketchStudio and Shaper, desktop): the Rectangle's on-canvas labels and its W x H box read the preview's size in inches (Decimal: 1 decimal at
//  Auto; Fractional: the nearest 1/16 with its inch mark), like a committed dimension label; typed "2" Tab "1" = 2 x 1 in (50.8 x 25.4 mm); "50mm" Tab "1 1/2" =
//  50 x 38.1 mm; the Line's length box and a bare 2 (50.8 mm); the Circle's diameter box and "1 1/2" (r 19.05 mm); the Arc's radius (a bare 2) and sweep (90 deg);
//  the Polygon's size (a bare 2); the Slot's span (a bare 2) and width ("1/2" = 12.7 mm). A unit change in Settings while the box is open re-shows it.
//  MM document: the same texts as before this task (the preview size, 1 decimal), a bare 2 = 2 mm.
//  Phone 390 (Shaper, touch): the docked box reads inches, a bare 2 = 50.8 mm.
//  PART studio: SketchStudio inch (every family) + the unit change. PART shaper: Shaper inch (rect, line), the mm scene (SketchStudio), the phone.
// Screenshots (zoomed on the box): .evidence/769/.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';
import { formatFraction } from '#core/units.js';

const PART = process.env.LIVE_UNITS_PART === 'shaper' ? 'shaper' : 'studio';
const EVID = process.env.EVIDENCE_DIR || path.join(process.cwd(), '.evidence', '769');
const IN = 25.4;
const HOSTS = {
  sketchstudio: { url: '/apps/sketchstudio/index.html', canvas: 'svgCanvas' },
  shaper: { url: '/apps/shaper/index.html', canvas: 'design-canvas', design: true },
};
// what the committed labels show (independent of the app code): inch Decimal at Auto = 1 decimal; Fractional = the nearest 1/16 + "; mm = 1 decimal
const text = (mm, unit, disp) => unit === 'mm' ? mm.toFixed(1) : disp === 'fractional' ? formatFraction(mm / IN, 16) + '"' : (mm / IN).toFixed(1);

const cdp = await launchBrowser({ tag: '769-live-' + PART, width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, waitForApp, navigate } = cdp;
const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); };
const T0 = Date.now(), lap = (what) => console.log(`${what}: ${((Date.now() - T0) / 1000).toFixed(1)} s`);
try {
  fs.mkdirSync(EVID, { recursive: true });
  let H, phone = false;
  const mouse = (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
  const touch = async (p) => {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Math.round(p.x), y: Math.round(p.y), id: 1, radiusX: 1, radiusY: 1, force: 1 }] }); await sleep(60);
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(260);
  };
  const move = async (p) => { await mouse('mouseMoved', p.x, p.y); await sleep(30); await mouse('mouseMoved', p.x + 1, p.y + 1); await sleep(50); };
  const click = async (p) => { if (phone) return touch(p); await mouse('mouseMoved', p.x, p.y); await sleep(30); await mouse('mousePressed', p.x, p.y, 1); await sleep(20); await mouse('mouseReleased', p.x, p.y); await sleep(100); };
  const key = async (k, code, vk, mods = 0) => { await sendRealKey(send, k, code, vk, mods); await sleep(80); };
  const type = async (t) => { await send('Input.insertText', { text: t }); await sleep(80); };
  const enter = () => key('Enter', 'Enter', 13);
  const esc = () => key('Escape', 'Escape', 27);
  const undo = async () => { await evalJs(`document.querySelector('#${H.canvas}').focus && document.activeElement && document.activeElement.blur()`); await key('z', 'KeyZ', 90, 2); };
  const C = (fx, fy) => evalJs(`(() => { const r = document.getElementById('${H.canvas}').getBoundingClientRect(); return { x: r.left + r.width * ${fx}, y: r.top + r.height * ${fy} }; })()`);
  const SM = `import('/packages/core/settings-manager.js')`;
  const setUnits = (o) => evalJs(`${SM}.then((m) => { for (const [k, v] of Object.entries(${JSON.stringify(o)})) m.default.set(k, v); })`);
  // the page as the user sees it: the preview's live labels (bold blue), the visible value box(es), the preview geometry (world mm, from the drawn SVG)
  const read = () => evalJs(`(() => {
    const svg = document.getElementById('${H.canvas}');
    const blue = [...svg.querySelectorAll('text, rect, line, circle')].filter((e) => /2563eb/i.test(e.getAttribute('style') || '') && !e.closest('.dim-label'));
    const n = (e, a) => Number(e.getAttribute(a));
    const rect = blue.find((e) => e.tagName === 'rect'), line = blue.find((e) => e.tagName === 'line'), circle = blue.find((e) => e.tagName === 'circle' && n(e, 'r') > 1);
    const vis = (e) => e.getClientRects().length && getComputedStyle(e).display !== 'none';
    return {
      labels: blue.filter((e) => e.tagName === 'text').map((e) => e.textContent),
      box: [...document.querySelectorAll('.sk-live-box input, input.sk-live-box')].filter(vis).map((i) => i.value),
      rect: rect ? { w: n(rect, 'width'), h: n(rect, 'height') } : null,
      line: line ? Math.hypot(n(line, 'x2') - n(line, 'x1'), n(line, 'y2') - n(line, 'y1')) : null,
      circle: circle ? n(circle, 'r') : null,
    };
  })()`);
  const shapes = () => evalJs(`[...document.querySelectorAll('#${H.canvas} .shape-elem')].filter((e) => !e.hasAttribute('stroke-dasharray')).map((e) => {
    const n = (a) => Number(e.getAttribute(a));
    if (e.tagName === 'line') return { k: 'line', len: Math.hypot(n('x2') - n('x1'), n('y2') - n('y1')) };
    if (e.tagName === 'circle') return { k: 'circle', r: n('r') };
    const m = (e.getAttribute('d') || '').match(/A\\s*([-\\d.e]+)/); return { k: 'arc', r: m ? Number(m[1]) : NaN };
  })`);
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  const shot = async (name) => {
    // the box and the preview's live labels (the bold blue texts) together, zoomed x2
    const clip = await evalJs(`(() => { const e = [...document.querySelectorAll('.sk-live-box')].find((x) => x.getClientRects().length && getComputedStyle(x).display !== 'none'); if (!e) return null;
      const rs = [e, ...[...document.querySelectorAll('#${H.canvas} text')].filter((t) => /2563eb/i.test(t.getAttribute('style') || ''))].map((x) => x.getBoundingClientRect());
      const l = Math.max(0, Math.min(...rs.map((r) => r.left)) - 30), t = Math.max(0, Math.min(...rs.map((r) => r.top)) - 30);
      const w = Math.min(innerWidth - l, Math.max(...rs.map((r) => r.right)) + 30 - l), h = Math.min(innerHeight - t, Math.max(...rs.map((r) => r.bottom)) + 30 - t);
      return { x: l, y: t, width: w, height: h, scale: 2 }; })()`);
    if (!clip) { failures.push(`${name}: no box to photograph`); return; }
    const r = await send('Page.captureScreenshot', { format: 'png', clip });
    fs.writeFileSync(path.join(EVID, name), Buffer.from(r.data, 'base64'));
  };
  const open = async (hostName) => {
    H = HOSTS[hostName];
    await resetBufferLive(cdp);
    await navigate(`http://127.0.0.1:${port}${H.url}`, 8000);
    await waitForApp(H.canvas);
    if (H.design) { // Shaper: its Design stage (the header tab on a desktop; on a phone, no header bar: the drawer's stage row, task 619)
      for (let i = 0; i < 5 && !(await evalJs(`!!document.querySelector('.sk-sidebar-stage.active[data-tab="design"], .sk-header-tab.active[data-tab="design"]')`)); i++) {
        if (phone) {
          await click(await evalJs(`(() => { const r = document.querySelector('.sk-sidebar-handle').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`));
          await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'the drawer'); await sleep(300);
          await click(await evalJs(`(() => { const r = document.querySelector('.sk-sidebar-stage[data-tab="design"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`));
        } else await evalJs(`document.querySelector('.sk-header-tab[data-tab="design"]').click()`);
        await sleep(400);
      }
    }
    await waitFor(`!!document.querySelector('.sk-ribbon .sk-ribbon-btn') && document.getElementById('${H.canvas}').getBoundingClientRect().width > 0`, `${hostName}: the ribbon and the canvas`);
  };
  const tool = (id) => pressRibbonTool(evalJs, click, id);
  // draw `tool`'s first click at a, hover b; returns what the page shows
  const begin = async (id, a, b) => { await tool(id); await sleep(60); await click(await C(...a)); await move(await C(...b)); return read(); };
  // type each text (Tab between them), Enter; the new shapes, then Undo them away (the next draw starts on a clean canvas)
  const typed = async (texts, after = null) => {
    const n0 = (await shapes()).length;
    for (let i = 0; i < texts.length; i++) { if (i) await key('Tab', 'Tab', 9); await type(texts[i]); }
    await enter();
    if (after) await after();
    await sleep(100);
    const made = (await shapes()).slice(n0);
    await esc(); await esc();
    return made;
  };
  const clean = async () => { for (let i = 0; i < 6 && (await shapes()).length; i++) await undo(); };

  // ---- INCH documents, desktop: SketchStudio (all the tool families) and Shaper (the rectangle of the owner's screenshot + the line) ----
  for (const hostName of PART === 'studio' ? ['sketchstudio'] : ['shaper']) {
    await open(hostName);
    for (const disp of ['decimal', 'fractional']) {
      const tag = `[${hostName} in ${disp}]`;
      await setUnits({ DOC_UNIT: 'in', INCH_DISPLAY: disp, LENGTH_FRACTION: 16, LENGTH_PRECISION: null, ANGLE_PRECISION: null });
      // Rectangle 2-point
      let v = await begin('tool-rect', [0.3, 0.3], [0.62, 0.55]);
      check(v.rect && v.rect.w > 1, `${tag} rect: the preview is drawn ${JSON.stringify(v)}`);
      const want = [text(v.rect.w, 'in', disp), text(v.rect.h, 'in', disp)];
      check(JSON.stringify(v.labels) === JSON.stringify(want), `${tag} rect labels ${JSON.stringify(v.labels)} != ${JSON.stringify(want)}`);
      check(JSON.stringify(v.box) === JSON.stringify(want), `${tag} rect box ${JSON.stringify(v.box)} != ${JSON.stringify(want)}`);
      console.log(`${tag} rect preview ${v.rect.w.toFixed(3)} x ${v.rect.h.toFixed(3)} mm: labels ${JSON.stringify(v.labels)} box ${JSON.stringify(v.box)}`);
      if (hostName === 'shaper') await shot(`after-rect-box-in-${disp}.png`);
      let made = await typed(['2', '1']);
      const lens = made.map((s) => s.len).sort((p, q) => q - p);
      check(made.length === 4 && near(lens[0], 2 * IN) && near(lens[3], IN), `${tag} rect typed 2 Tab 1 = 50.8 x 25.4 mm: ${JSON.stringify(lens)}`);
      await clean();
      if (disp === 'decimal') {
        await begin('tool-rect', [0.3, 0.3], [0.62, 0.55]);
        made = await typed(['50mm', '1 1/2']);
        const l2 = made.map((s) => s.len).sort((p, q) => q - p);
        check(made.length === 4 && near(l2[0], 50) && near(l2[3], 1.5 * IN), `${tag} rect typed 50mm Tab 1 1/2 = 50 x 38.1 mm: ${JSON.stringify(l2)}`);
        await clean();
      }
      if (disp === 'fractional') continue; // Fractional: the rectangle shows it (the same box text for every field; the node test runs each tool in Fractional)
      // Line
      v = await begin('tool-line', [0.3, 0.5], [0.6, 0.4]);
      check(v.box[0] === text(v.line, 'in', disp), `${tag} line box ${JSON.stringify(v.box)} (preview ${v.line} mm)`);
      made = await typed(['2']);
      check(made.length === 1 && near(made[0].len, 2 * IN), `${tag} line typed 2 = 50.8 mm: ${JSON.stringify(made)}`);
      await clean();
      if (hostName === 'shaper') continue; // the other families are the same shared boxes (the node test runs each in mm / cm / in, Decimal and Fractional)
      // Circle: the diameter
      v = await begin('tool-circle', [0.45, 0.5], [0.6, 0.5]);
      check(v.box[0] === text(2 * v.circle, 'in', disp), `${tag} circle box ${JSON.stringify(v.box)} (preview r ${v.circle} mm)`);
      made = await typed(['1 1/2']);
      check(made.length === 1 && near(made[0].r, 0.75 * IN), `${tag} circle typed 1 1/2 = diameter 38.1 mm: ${JSON.stringify(made)}`);
      await clean();
      // Arc: the radius (a bare 2), then the sweep (90 deg)
      await begin('tool-arc', [0.45, 0.5], [0.6, 0.5]);
      made = await typed(['2'], async () => { await move(await C(0.45, 0.3)); await type('90'); await enter(); });
      check(made.length === 1 && near(made[0].r, 2 * IN), `${tag} arc typed 2 then 90 = radius 50.8 mm: ${JSON.stringify(made)}`);
      await clean();
      // Polygon: the size (a bare 2)
      await begin('tool-polygon', [0.45, 0.5], [0.6, 0.5]);
      made = await typed(['2']);
      check(made.length === 6 && made.every((s) => near(s.len, 2 * IN)), `${tag} polygon typed 2 = hexagon of radius (and side) 50.8 mm: ${JSON.stringify(made)}`);
      await clean();
      // Slot (centre to centre): the span (a bare 2), then the width ("1/2")
      await begin('tool-slot', [0.3, 0.5], [0.55, 0.5]);
      made = await typed(['2'], async () => { await move(await C(0.45, 0.42)); await evalJs(`document.activeElement && document.activeElement.select && document.activeElement.select()`); await type('1/2'); await enter(); });
      const arcs = made.filter((s) => s.k === 'arc'), straight = made.filter((s) => s.k === 'line');
      check(straight.length === 2 && straight.every((s) => near(s.len, 2 * IN)) && arcs.length === 2 && arcs.every((s) => near(s.r, 0.25 * IN)), `${tag} slot typed 2 then 1/2 = span 50.8, width 12.7 mm: ${JSON.stringify(made)}`);
      await clean();
    }
    // a unit change in Settings while the box is open (the real Settings panel)
    if (hostName === 'sketchstudio') {
      await setUnits({ DOC_UNIT: 'in', INCH_DISPLAY: 'decimal' });
      const v = await begin('tool-rect', [0.3, 0.3], [0.62, 0.55]);
      await type('2');
      check(v.box.length === 2, '[unit change] the box is open');
      const pos = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      await click(await pos('#btn-settings'));
      await waitFor(`!document.querySelector('.sk-style-panel').classList.contains('sk-hidden')`, 'the Settings panel');
      await click(await pos('.sk-style-panel .sk-style-tab[data-tab="units"]'));
      await evalJs(`(() => { const s = document.querySelector('.sk-style-panel [data-key="DOC_UNIT"]'); s.value = 'mm'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await sleep(300);
      await click(await pos('.sk-style-panel .sk-style-foot .sk-style-btn:last-child'));
      const after = await read();
      check(JSON.stringify(after.box) === JSON.stringify(['50.8', after.rect.h.toFixed(1)]), `[unit change] in -> mm with the box open: the typed 2 in reads 50.8, the live height in mm: ${JSON.stringify(after)}`);
      check(JSON.stringify(after.labels) === JSON.stringify(['50.8', after.rect.h.toFixed(1)]), `[unit change] the labels follow: ${JSON.stringify(after.labels)}`);
      await esc(); await esc();
    }
  }

  lap('inch scenes');
  // ---- MM document (SketchStudio): the texts every live value showed before this task, a bare 2 = 2 mm ----
  if (PART === 'shaper') {
    await open('sketchstudio');
    await setUnits({ DOC_UNIT: 'mm', INCH_DISPLAY: 'decimal', LENGTH_PRECISION: null, ANGLE_PRECISION: null });
    let v = await begin('tool-rect', [0.3, 0.3], [0.62, 0.55]);
    const want = [v.rect.w.toFixed(1), v.rect.h.toFixed(1)];
    check(JSON.stringify(v.labels) === JSON.stringify(want) && JSON.stringify(v.box) === JSON.stringify(want), `[mm] rect labels ${JSON.stringify(v.labels)} box ${JSON.stringify(v.box)} != ${JSON.stringify(want)}`);
    console.log(`[mm] rect preview ${v.rect.w.toFixed(3)} x ${v.rect.h.toFixed(3)} mm: labels ${JSON.stringify(v.labels)} box ${JSON.stringify(v.box)}`);
    H = HOSTS.sketchstudio; await shot('after-rect-box-mm.png');
    let made = await typed(['2', '1']);
    const lens = made.map((s) => s.len).sort((p, q) => q - p);
    check(made.length === 4 && near(lens[0], 2) && near(lens[3], 1), `[mm] rect typed 2 Tab 1 = 2 x 1 mm: ${JSON.stringify(lens)}`);
    await clean();
    v = await begin('tool-line', [0.3, 0.5], [0.6, 0.4]);
    check(v.box[0] === v.line.toFixed(1), `[mm] line box ${JSON.stringify(v.box)} (preview ${v.line})`);
    made = await typed(['2']);
    check(made.length === 1 && near(made[0].len, 2), `[mm] line typed 2 = 2 mm: ${JSON.stringify(made)}`);
    await esc(); await esc();
  }

  lap('mm scene');
  // ---- phone 390 (Shaper, touch): the docked box reads inches, a bare 2 = 50.8 mm ----
  if (PART === 'shaper') {
    phone = true;
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await open('shaper');
    await setUnits({ DOC_UNIT: 'in', INCH_DISPLAY: 'decimal', LENGTH_PRECISION: null });
    await tool('tool-line'); await sleep(150);
    await click(await C(0.2, 0.6));
    const v = await read();
    check(v.box.length === 2 && v.box[0] === '0.0', `[phone] the docked line box reads inches (0.0 before any move): ${JSON.stringify(v.box)}`);
    const boxAt = await evalJs(`(() => { const i = [...document.querySelectorAll('.sk-live-box input')].find((x) => x.getClientRects().length); const r = i.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await touch(boxAt);
    await evalJs(`document.activeElement && document.activeElement.select && document.activeElement.select()`);
    await type('2');
    await shot('after-line-box-phone-in.png');
    const n0 = (await shapes()).length;
    await enter(); await sleep(200);
    const made = (await shapes()).slice(n0);
    check(made.length === 1 && near(made[0].len, 2 * IN), `[phone] line typed 2 = 50.8 mm: ${JSON.stringify(made)}`);
    await esc(); await esc();
  }
  assert.strictEqual(failures.length, 0, '\n' + failures.join('\n'));
  console.log(`live units 769 (${PART}): ok`);
} finally { await cdp.close(); }
