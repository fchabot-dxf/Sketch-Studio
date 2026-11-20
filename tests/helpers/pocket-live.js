// tests/helpers/pocket-live.js — TASK 750b: the programmed pocket's live checks (TASKS 745 / 749 / 750) in the real Shaper page, shared by the split live
// test files (each one a fresh headless browser + server, so each runs well under scripts/gate.cjs's per-file limit):
//   tests/pocket-clearing-745-live.test.js              desktop 1280 x 800, mouse, mm: cardPhase
//   tests/pocket-clearing-745-lists-live.test.js        desktop: listsPhase
//   tests/pocket-clearing-745-export-live.test.js       desktop: exportPhase
//   tests/pocket-clearing-745-phone-live.test.js        phone 390 x 844, touch, inches: cardPhase
//   tests/pocket-clearing-745-phone-lists-live.test.js  phone: listsPhase
//   tests/pocket-clearing-745-phone-export-live.test.js phone: exportPhase
//   tests/pocket-loop-750-live.test.js                  desktop: loopPhase (the three patterns, then Loop off)
//   tests/pocket-loop-750-phone-live.test.js            phone: loopPhase (Spiral, Raster)
//   tests/pocket-loop-750-phone-b-live.test.js          phone: loopPhase (Morphed spiral, then Loop off)
//   tests/pocket-loop-750-fusion-live.test.js     Fusion mode (?host=fusion, window.adsk stubbed, the SA-7 drafted-pocket payload): fusionPhase
// openPocketPage() = the browser, the page, the download folder and the page tools; setupPockets() = the drawing and the rectangle pocket every phase starts from.
// Screenshots to .evidence/745/ (EVIDENCE_DIR overrides).
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser, sleep } from './cdp-browser.js';
import { probe, tipProblems } from './tooltip-live.js';
import { clickOpenLive, stepLive } from './prepare-open-live.js'; // TASK S2: an operation is opened, changed, confirmed

const fixture = (name) => fs.readFileSync(new URL(`../fixtures/sa7-slope/${name}.json`, import.meta.url), 'utf8');

/** A fresh browser on the Shaper page: desktop (mm), phone 390 (touch, inches) or Fusion mode (mm). null when no headless browser is installed.
 *  Returns the page tools; close() closes the browser and its server and removes the download folder. */
export async function openPocketPage({ tag, phone = false, fusion = false, evidenceDir = null, args = undefined }) { // TASK 775: evidenceDir / args (the 3D view's swiftshader) for tests/helpers/leadin-live.js
  const EVIDENCE_DIR = evidenceDir || process.env.EVIDENCE_DIR || path.resolve('.evidence/745');
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const cdp = await launchBrowser({ tag, width: 1280, height: 800, ...(args ? { args } : {}) });
  if (!cdp) return null;
  const { port, send, evalJs, waitFor, waitForApp, navigate } = cdp;
  const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), `sk-${tag}-dl-`));
  const close = async () => { await cdp.close(); fs.rmSync(dlDir, { recursive: true, force: true }); };
  try {
    await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
    const shot = async (name, sels = null, scale = 1, margin = 6) => {
      let clip = null;
      if (sels) clip = await evalJs(`(() => { const rs = ${JSON.stringify([].concat(sels))}.map((q) => document.querySelector(q).getBoundingClientRect());
        const x = Math.max(0, Math.min(...rs.map((r) => r.left)) - ${margin}), y = Math.max(0, Math.min(...rs.map((r) => r.top)) - ${margin});
        return { x, y, width: Math.min(innerWidth, Math.max(...rs.map((r) => r.right)) + ${margin}) - x, height: Math.min(innerHeight, Math.max(...rs.map((r) => r.bottom)) + ${margin}) - y, scale: ${scale} }; })()`);
      const { data } = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
      fs.writeFileSync(path.join(EVIDENCE_DIR, name), Buffer.from(data, 'base64'));
      console.log('screenshot ' + path.join(EVIDENCE_DIR, name));
    };
    // a screenshot of the world box (x0, y0)-(x1, y1) on the Prepare canvas, at `scale`
    const shotWorld = async (name, b, scale = 2) => {
      // zoom the Prepare view onto the box (legible), shoot, then put the view back. The phone: the card covers the right of the canvas and the drawer handle
      // its left edge: the box fills the free strip between them (upper part of the canvas). The desktop: the box about 600 px wide between the list and the card.
      const before = await evalJs(`(() => { const v = window.__prepareView, svg = document.getElementById('prepare-canvas'), c = svg.getBoundingClientRect(), card = document.querySelector('#prepare-panel').getBoundingClientRect();
        const old = { x: v.view.x, y: v.view.y, w: v.view.w }, bw = ${b[2] - b[0]}, bh = ${b[3] - b[1]};
        if (${phone}) {
          const left = 52, right = card.left - 8, k = Math.min((right - left) / bw, (c.height * 0.4) / bh), w = c.width / k;
          v.setView({ x: ${b[0]} - (left - c.left) / k + w / 2, y: ${(b[1] + b[3]) / 2} + (c.height / 2 - c.height * 0.3) / k, w });
        } else {
          const ops = document.getElementById('prepare-ops').getBoundingClientRect(), note = document.getElementById('prepare-notice');
          const L = ops.right + 12, R = card.left - 12, top = note && !note.hidden ? note.getBoundingClientRect().bottom + 12 : c.top + 12, bottom = c.bottom - 40;
          const k = Math.min(600, R - L) / bw, k2 = Math.min(k, (bottom - top) / bh), w = c.width / k2;
          v.setView({ x: ${(b[0] + b[2]) / 2} - ((L + R) / 2 - (c.left + c.width / 2)) / k2, y: ${(b[1] + b[3]) / 2} - ((top + bottom) / 2 - (c.top + c.height / 2)) / k2, w });
        }
        return old; })()`);
      await sleep(250);
      const clip = await evalJs(`(() => { const svg = document.getElementById('prepare-canvas'), m = svg.getScreenCTM(); const p = (x, y) => { const q = svg.createSVGPoint(); q.x = x; q.y = y; return q.matrixTransform(m); };
        const a = p(${b[0]}, ${b[1]}), c = p(${b[2]}, ${b[3]}); const x = Math.max(0, Math.min(a.x, c.x) - 12), y = Math.max(0, Math.min(a.y, c.y) - 12);
        return { x, y, width: Math.min(innerWidth, Math.max(a.x, c.x) + 12) - x, height: Math.min(innerHeight, Math.max(a.y, c.y) + 12) - y, scale: ${scale} }; })()`);
      const { data } = await send('Page.captureScreenshot', { format: 'png', clip });
      fs.writeFileSync(path.join(EVIDENCE_DIR, name), Buffer.from(data, 'base64'));
      console.log('screenshot ' + path.join(EVIDENCE_DIR, name));
      if (phone) { const full = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(EVIDENCE_DIR, name.replace('.png', '-screen.png')), Buffer.from(full.data, 'base64')); } // the whole phone screen, as zoomed
      await evalJs(`window.__prepareView.setView(${JSON.stringify(before)})`);
    };
    const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
    const mouse = (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const press = async (x, y) => {
      if (phone) { await T('touchStart', [{ x, y }]); await sleep(40); await T('touchEnd', []); }
      else { await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y, 1); await sleep(40); await mouse('mouseReleased', x, y); }
      await sleep(250);
    };
    const boxOf = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const hit = document.elementFromPoint(x, y);
      return { x, y, w: Math.round(r.width), h: Math.round(r.height), onTop: !!hit && (hit === e || e.contains(hit)), hit: hit ? hit.outerHTML.slice(0, 160) + " in " + (hit.parentElement ? hit.parentElement.outerHTML.slice(0, 120) : "") : null }; })()`);
    const clickElRaw = async (sel) => {
      const p = await boxOf(sel);
      assert.ok(p && p.onTop, `${sel} is on screen and not covered: ${JSON.stringify(p)}`);
      await press(p.x, p.y);
      return p;
    };
    const clickWorldRaw = async (x, y) => {
      const p = await evalJs(`(() => { const svg = document.getElementById('prepare-canvas'); const pt = svg.createSVGPoint(); pt.x = ${x}; pt.y = ${y};
        const s = pt.matrixTransform(svg.getScreenCTM()); return { x: Math.round(s.x), y: Math.round(s.y) }; })()`);
      await press(p.x, p.y);
    };
    // TASK S2 (docs/OPERATIONS-MODEL.md 9.1): the steps of before S2 in today's terms (tests/helpers/prepare-open-live.js): a click on the canvas = OK on the open
    // operation, the click, and the clicked shape's operation opened (it is in one); a press / a typed field that changes the open operation = its own step (OK, opened again)
    const raw = { phone, evalJs, waitFor, clickEl: clickElRaw };
    const clickEl = (sel) => stepLive(raw, () => clickElRaw(sel));
    const clickWorld = (x, y) => clickOpenLive(raw, () => clickWorldRaw(x, y));
    const activeStage = () => evalJs(`(() => { const e = document.querySelector('.sk-sidebar-stage.active') || document.querySelector('.sk-header-tab.active'); return e ? e.dataset.tab : null; })()`);
    const openMode = async (mode) => {
      for (let i = 0; i < 5; i++) {
        if (await activeStage() === mode) return;
        if (phone) {
          if (!await evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`)) await clickEl('.sk-sidebar-handle');
          await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'the drawer opens'); await sleep(300);
          await clickEl(`.sk-sidebar-stage[data-tab="${mode}"]`);
        } else await clickEl(`.sk-header-tab[data-tab="${mode}"]`);
        await sleep(400);
      }
      assert.fail('could not open the ' + mode + ' stage');
    };
    const setUnit = (u) => evalJs(`import('/packages/core/settings-manager.js').then((m) => { m.default.set('DOC_UNIT', '${u}'); })`);
    const draw = () => evalJs(`(() => {
      const st = window.__designController.state;
      for (const k of [...st.joints.keys()]) st.joints.delete(k);
      st.shapes.length = 0; st.constraints.length = 0;
      const poly = (name, pts) => { pts.forEach(([x, y], i) => st.joints.set(name + 'j' + i, { x, y })); pts.forEach((_, i) => st.shapes.push({ id: name + 's' + i, type: 'line', joints: [name + 'j' + i, name + 'j' + ((i + 1) % pts.length)] })); };
      poly('A', [[0, 0], [120, 0], [120, 70], [0, 70]]);
      poly('L', [[140, 0], [240, 0], [240, 40], [180, 40], [180, 100], [140, 100]]);
      poly('I', [[0, 90], [120, 90], [120, 150], [0, 150]]);
      poly('Ii', [[50, 110], [70, 110], [70, 130], [50, 130]]);
      st.saveState('draw');
      return st.shapes.length; })()`);
    const card = () => evalJs(`({ type: document.querySelector('.cut-type-cur').textContent, clearing: document.querySelector('.cut-clear-cur').textContent,
      rows: [...document.querySelectorAll('.cut-row[data-row="stepover"], .cut-row[data-row="finishAllowance"], .cut-row[data-row="loop"], .cut-row[data-row="rasterAngle"]')].filter((r) => getComputedStyle(r).display !== 'none' && !('off' in r.dataset)).map((r) => r.dataset.row),
      loop: document.querySelector('.cut-loop').checked,
      stepover: document.querySelector('.cut-stepover').value, len: document.querySelector('.cut-stepover-len').textContent, note: [...document.querySelectorAll('.cut-note div')].map((d) => d.textContent) })`);
    const look = () => evalJs(`({ paths: document.querySelectorAll('#prepare-toolpath-group .sk-clear-path').length, cleanup: document.querySelectorAll('#prepare-toolpath-group .sk-clear-cleanup').length,
      leftover: document.querySelectorAll('#prepare-cut-group .sk-leftover').length, band: document.querySelectorAll('#prepare-cut-group .sk-band').length,
      d: [...document.querySelectorAll('#prepare-toolpath-group .sk-clear-path')].map((p) => p.getAttribute('d').length).reduce((a, b) => a + b, 0) })`);
    const pickType = async (id) => { await clickEl('#prepare-panel .cut-type-trigger'); await waitFor(`!document.querySelector('.cut-type-menu').hidden`, 'the type menu'); await clickEl(`.cut-type-opt[data-id="${id}"]`); };
    const typeFieldRaw = async (cls, v) => { await evalJs(`(() => { const i = document.querySelector('${cls}'); i.value = '${v}'; i.dispatchEvent(new Event('change')); })()`); await sleep(200); };
    const typeField = (cls, v) => stepLive(raw, () => typeFieldRaw(cls, v)); // TASK S2: its own step
    const openClearing = async () => { await clickEl('#prepare-panel .cut-clear-trigger'); await waitFor(`!document.querySelector('.cut-clear-pop').hidden`, 'the Clearing popover'); };
    const pickClearing = async (id) => { await openClearing(); await clickEl(`.cut-clear-opt[data-clearing="${id}"]`); await waitFor(`document.querySelector('.cut-clear-pop').hidden`, 'the popover closes'); await sleep(300); };
    const rec = (x, y) => evalJs(`Promise.all([import('/packages/core/loop-finder.js'), import('/packages/core/loop-geometry.js'), import('/tests/helpers/plan-v2.js')]).then(([L, G, C]) => {
      const st = window.__designController.state, by = new Map(st.shapes.map((s) => [s.id, s]));
      const l = L.findLoops(st).map((l) => ({ l, p: G.loopPolygon(l, st, by) })).filter((o) => G.pointInPolygon(o.p, { x: ${x}, y: ${y} })).sort((a, b) => Math.abs(G.polyArea(a.p)) - Math.abs(G.polyArea(b.p)))[0];
      const r = C.V2_PLAN.get('loop:' + l.l.id); return r ? { cutType: r.cutType, clearing: r.clearing ?? null, stepover: r.stepover ?? null, finishAllowance: r.finishAllowance ?? null, rasterAngle: r.rasterAngle ?? null, loop: r.loop ?? null, toolDia: r.toolDia } : null; })`);
    const download = async () => {
      await openMode('review');
      for (const f of fs.readdirSync(dlDir)) fs.rmSync(path.join(dlDir, f));
      await clickEl('#btn-generate-svg');
      let file = null;
      for (let i = 0; i < 100 && !file; i++) { const f = fs.readdirSync(dlDir).find((n) => n.endsWith('.svg')); if (f) file = path.join(dlDir, f); else await sleep(100); }
      assert.ok(file, 'the export downloaded');
      return fs.readFileSync(file, 'utf8');
    };
    // the file's drawn elements: tag + geometry + resolved cut attributes (a <g> hoists the shared ones)
    const fileElements = (svg) => {
      const attrs = (s) => Object.fromEntries([...s.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
      const out = []; let group = null;
      for (const line of svg.split('\n').map((l) => l.trim())) {
        if (line.startsWith('<g')) { group = attrs(line); continue; }
        if (line.startsWith('</g')) { group = null; continue; }
        const m = /^<(path|circle|polygon)\s(.*)\/>$/.exec(line);
        if (!m || /fill="#FF0000"/.test(line)) continue;
        const a = { ...(group || {}), ...attrs(m[2]) };
        out.push([m[1], a.d || `${a.cx},${a.cy},${a.r}`, a['shaper:cutType'], a['shaper:cutDepth'], a['shaper:toolDia']]);
      }
      return out;
    };
    // Export 2D: the list rows, an element's label, and the mounted elements (file order: data-* dropped) to compare with the download
    const export2d = async (label) => {
      await openMode('review');
      if (await evalJs(`document.getElementById('review-view-2d').getAttribute('aria-pressed')`) !== 'true') await clickEl('#review-view-2d');
      await waitFor(`document.querySelectorAll('#review-cuts-list .rv2d-op').length > 0`, label + ': the 2D list');
      await evalJs(`document.getElementById('review-side').scrollTop = 0`);
      await sleep(300);
      return evalJs(`(() => {
        const rows = [...document.querySelectorAll('#review-cuts-list > *')].filter((e) => e.matches('.rv2d-op, .rv2d-row')).map((e) => (e.matches('.rv2d-op') ? '# ' : '') + e.firstChild.textContent.trim() + (e.matches('.rv2d-row') ? ' (' + e.lastChild.textContent + ')' : ''));
        const els = [...document.querySelectorAll('#review-2d-canvas .rv2d-doc *')].filter((e) => ['path', 'circle', 'polygon'].includes(e.localName) && e.getAttribute('fill') !== '#FF0000');
        const cut = (e, n) => { for (let x = e; x && x.nodeType === 1; x = x.parentNode) { const v = x.getAttribute('shaper:' + n); if (v) return v; } return null; };
        const ord = els.map((e) => ({ e, i: Number(e.dataset.fileIndex) }));
        return { rows, count: els.length, clears: els.map((e) => e.getAttribute('data-clear')).filter(Boolean) };
      })()`);
    };
    const preview2dElements = () => evalJs(`import('/apps/shaper/src/export-payload.js').then((m) => import('/tests/helpers/plan-v2.js').then((C) => m.shaperPreviewOf(window.__designController.state, C.planEntries()).svg))`);

    // ── A / B: the standalone app ──
    const setLoop = async (on) => { if (await evalJs(`document.querySelector('.cut-loop').checked`) !== on) { await clickEl('#prepare-panel .cut-row[data-row="loop"] .cut-check'); await sleep(300); } };
    const markers = () => evalJs(`document.querySelectorAll('#prepare-toolpath-group .sk-lead-tip, #prepare-toolpath-group .sk-lead-end').length`); // TASK 775: a closed loop has no start point: no dot
    if (phone) {
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    }
    if (fusion) {
      await send('Page.addScriptToEvaluateOnNewDocument', { source: `if (new URLSearchParams(location.search).get('host') === 'fusion') window.adsk = { fusionSendData() { return '{}'; } };` });
      await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html?host=fusion`);
      await waitForApp('design-canvas');
      await waitFor(`!!window.fusionJavaScriptHandler && !!document.getElementById('btn-fusion-add-selection') && !document.getElementById('view-prepare').hidden`, 'the Fusion Prepare bar');
    } else {
      await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 8000);
      if (phone) await waitFor(`!!document.querySelector('.sk-sidebar-handle')`, 'shaper app ready (phone)');
      else await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'shaper app ready');
      await setUnit(phone ? 'in' : 'mm');
    }
    return { phone, EVIDENCE_DIR, send, evalJs, waitFor, close, shot, shotWorld, press, clickEl, clickElRaw, clickWorld, clickWorldRaw, openMode, setUnit, draw, card, look, pickType, typeField,
      openClearing, pickClearing, rec, download, fileElements, export2d, preview2dElements, setLoop, markers, dlDir };
  } catch (e) { await close(); throw e; }
}

/** The drawing (a 120 x 70 rectangle, an L, a pocket with an island) and the rectangle as a Pocket (depth, bit 6 mm / 1/4 in): Freehand, no clearing rows,
 *  no Depth per pass row. */
export async function setupPockets(t, label) {
  const { phone, evalJs, waitFor, openMode, draw, clickEl, clickWorld, pickType, typeField, card } = t;
    const D = phone ? 'phone' : 'desktop';
    const inch = await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.docUnit() === 'in')`);
    const bitWords = inch ? '0.25 in' : '6 mm';
    await openMode('design');
    await waitFor('!!(window.__designController && window.__designController.state)', 'design controller ready');
    await evalJs(`import('/tests/helpers/plan-v2.js').then((m) => m.V2_PLAN.clear())`);
    assert.strictEqual(await draw(), 18, label + ': drawn');
    await openMode('prepare');
    if (phone && !await evalJs(`document.querySelector('#prepare-ops .ops-body').hidden`)) await clickEl('#prepare-ops .ops-head'); // the folded bar keeps the card free
    // the rectangle pocket: Pocket, depth, bit 6 mm (1/4 in on the phone)
    const pickRect = async () => { await clickWorld(60, 10); await waitFor(`!document.querySelector('#prepare-panel .cut-card').hidden`, label + ': the card'); };
    await pickRect();
    await pickType('pocket');
    await typeField('.cut-depth', inch ? '0.25' : '6');
    await typeField('.cut-bit', inch ? '0.25' : '6');
    const c0 = await card();
    assert.deepStrictEqual([c0.type, c0.clearing, c0.rows, c0.note], ['Pocket', 'Freehand', [], []], label + ': Pocket, Clearing Freehand, no clearing rows, no note');
    assert.strictEqual(await evalJs(`!!document.querySelector('.cut-pass-depth, .cut-row[data-row="passDepth"]')`), false, label + ': no Depth per pass row (TASK 750)');
  return { D, inch, bitWords, pickRect };
}

/** TASKS 745 / 749 / 750, the card: the dropdown (4 choices, no Loop entry), Spiral with Loop off (its rows, the note, one open line), the stepover + (the
 *  line redraws), the Raster row. */
export async function cardPhase(t, label) {
  const { phone, evalJs, shot, clickEl, card, look, rec, openClearing, pickClearing, markers } = t;
  const { D, inch } = await setupPockets(t, label);
      await openClearing();
    const opts = await evalJs(`[...document.querySelectorAll('.cut-clear-opt')].map((o) => [o.dataset.clearing, o.querySelector('.cut-clear-name').textContent, !!o.querySelector('svg.cut-ic path, svg.cut-ic rect'), o.disabled])`);
    assert.deepStrictEqual(opts, [['freehand', 'Freehand', true, false], ['linked', 'Spiral', true, false], ['raster', 'Raster', true, false], ['morphed', 'Morphed spiral', true, false]], label + ': the 4 choices (no Loop entry), each with its pattern icon');
    const pop = await evalJs(`(() => { const p = document.querySelector('.cut-clear-pop').getBoundingClientRect(); return { left: Math.round(p.left), right: Math.round(p.right), w: Math.round(p.width), optH: Math.round(document.querySelector('.cut-clear-opt').getBoundingClientRect().height) }; })()`);
    assert.ok(pop.left >= 0 && pop.right <= (phone ? 390 : 1280), label + ': the popover is on screen');
    if (phone) assert.ok(pop.optH >= 40, label + ': its choices are 40 px touch rows');
    await shot(`${D}-card-clearing-menu.png`, ['#prepare-panel .cut-card', '.cut-clear-pop'], 2);
    await clickEl('#prepare-panel .cut-clear-trigger'); // close
    // Spiral, Loop off: open lines + the Origin's inside cut
    await pickClearing('linked');
    const r1 = await rec(60, 10);
    assert.deepStrictEqual([r1.cutType, r1.clearing, r1.stepover, r1.finishAllowance, r1.rasterAngle, r1.loop], ['pocket', 'linked', 40, inch ? 0.508 : 0.5, 0, false], label + ': Spiral with the defaults, Loop off');
    const c1 = await card();
    console.log(label + ' spiral card: ' + JSON.stringify(c1));
    assert.deepStrictEqual([c1.rows, c1.loop], [['stepover', 'finishAllowance', 'loop'], false], label + ': Stepover, Finish allowance, Loop (off)');
    // TASK 766: the row is Finish allowance; TASK 805: its hint is a tooltip at the cursor (a hover, a long press on a phone), never text in the card: the card's rows do not move
    const finSel = '.cut-row[data-row="finishAllowance"] .cut-field-label';
    const tpFin = probe(t); await tpFin.reveal(finSel); const finBefore = await tpFin.snap(), finPt = await tpFin.show(finSel), finTip = await tpFin.tip(), finDuring = await tpFin.snap();
    console.log(label + ' finish allowance: ' + JSON.stringify(finTip));
    assert.deepStrictEqual(tipProblems(finTip, finPt, 'Left on the walls by the clearing passes; the Origin’s inside cut takes it off for a clean edge. 0 = none.', { phone }), [], label + ': the Finish allowance tooltip (Loop off)');
    assert.deepStrictEqual(tpFin.movedBoxes(finBefore, finDuring), [], label + ': TASK 805: the tooltip moves nothing in the card');
    assert.strictEqual(await evalJs(`document.querySelector('${finSel}').textContent`), 'Finish allowance', label + ': the Finish allowance label');
    await tpFin.leave();
    assert.ok(new RegExp(`^Pocket: spiral, \\d+ turns in 1 line \\+ wall, stepover ${inch ? '0\\.1 in' : '2\\.4 mm'}, [\\d.]+ ${inch ? 'ft' : 'm'} of path, about \\d+ min at ${inch ? '39 in' : '1000 mm'}/min$`).test(c1.note[0]), label + ': the note ' + c1.note[0]);
    assert.ok(c1.note.includes('Depth passes: set Pass Depth or AutoPass on the Origin'), label + ': the note: the depth passes are the Origin\'s');
    const l1 = await look();
    assert.ok(l1.paths === 1 && l1.leftover === 1 && l1.band >= 1 && await markers() === 0, label + ': ONE open line drawn, the cleared area, the leftover corners, no loop marker');
    // the stepover + : the line redraws, the note follows
    const lA = await look();
    await clickEl('.cut-row[data-row="stepover"] .cut-step[data-d="1"]');
    await sleep(300);
    const c2 = await card(), l2 = await look();
    assert.strictEqual(c2.stepover, '45', label + ': stepover + -> 45 %');
    assert.ok(l2.paths === 1 && l2.d < lA.d && c2.note[0] !== c1.note[0], label + `: the line redraws with fewer turns (${lA.d} -> ${l2.d} chars), the note follows: ${c2.note[0]}`);
    await clickEl('#prepare-panel .cut-row[data-param="toolDia"] .cut-preset[data-value="6.35"]');
    await sleep(300);
    // Raster: its angle row
    await pickClearing('raster');
    const c4 = await card();
    assert.deepStrictEqual(c4.rows, ['stepover', 'finishAllowance', 'loop', 'rasterAngle'], label + ': Raster: + the Raster angle row');
    await pickClearing('linked');
}

/** The three pockets as the lists and the export check them: the rectangle as cardPhase leaves it (Spiral, Loop off, stepover 45 %, the 1/4 in bit), the L
 *  (Spiral, Loop on), the island pocket (Morphed spiral greyed with its reason, Spiral with the remembered Loop); `shots`: their screenshots. */
async function threePockets(t, label, shots) {
  const { evalJs, shotWorld, clickEl, clickWorld, pickType, typeField, card, look, openClearing, pickClearing, setLoop, markers } = t;
  const { D, inch } = await setupPockets(t, label);
    await pickClearing('linked');
    await clickEl('.cut-row[data-row="stepover"] .cut-step[data-d="1"]');
    await sleep(300);
    assert.strictEqual((await card()).stepover, '45', label + ': the rectangle: stepover 45 % (as cardPhase leaves it)');
    await clickEl('#prepare-panel .cut-row[data-param="toolDia"] .cut-preset[data-value="6.35"]');
    await sleep(300);
    // the L pocket: Spiral, Loop on (one closed line); the island pocket: the Morphed spiral greyed with its reason, Spiral, Loop on (several loops)
    const quarter = () => clickEl('#prepare-panel .cut-row[data-param="toolDia"] .cut-preset[data-value="6.35"]'); // the 1/4 in preset (as the rectangle's now)
    await clickWorld(150, 90);
    await pickType('pocket'); await typeField('.cut-depth', inch ? '0.25' : '6'); await quarter();
    await pickClearing('linked');
    await setLoop(true);
    const cL = await card();
    assert.ok(/^Pocket: spiral, \d+ turns \+ wall: one closed loop,/.test(cL.note[0]) && (await look()).paths === 1 && await markers() === 0, label + ': the L: ONE closed loop, no dot (TASK 775: no start point): ' + cL.note[0]);
    if (shots) await shotWorld(`${D}-loop-spiral-L.png`, [140, 0, 240, 100]);
    await clickWorld(10, 100);
    await pickType('pocket'); await typeField('.cut-depth', inch ? '0.25' : '6'); await quarter();
    await openClearing();
    const sp = await evalJs(`(() => { const o = document.querySelector('.cut-clear-opt[data-clearing="morphed"]'), l = document.querySelector('.cut-clear-opt[data-clearing="linked"]'); return [o.getAttribute('aria-disabled'), o.classList.contains('is-disabled'), o.querySelector('.cut-clear-why'), l.getAttribute('aria-disabled')]; })()`); // TASK 813: greyed with aria-disabled, its reason is its tooltip (no line)
    assert.deepStrictEqual(sp, ['true', true, null, null], label + ': the island pocket: Morphed spiral greyed with its reason, Spiral never disabled');
    await clickEl('.cut-clear-opt[data-clearing="linked"]');
    await sleep(300);
    const cI = await card();
    console.log(label + ' island note: ' + JSON.stringify(cI.note));
    assert.strictEqual(cI.loop, true, label + ': the island pocket starts with the last Loop set (on)');
    const islandLoops = Number((/\+ wall: (\d+) closed loops \(the pocket has islands\),/.exec(cI.note[0]) || [])[1]);
    assert.ok(islandLoops > 1 && await markers() === 0, label + ': the island pocket: several closed loops, no dot on any (TASK 775), the note says why: ' + cI.note[0]);
    if (shots) await shotWorld(`${D}-loop-island-spiral.png`, [0, 90, 120, 150]);
  return { D, inch, islandLoops };
}

/** TASKS 745 / 749 / 750, the operations list of the three pockets (threePockets, with their screenshots). */
export async function listsPhase(t, label) {
  const { phone, evalJs, shot, clickEl } = t;
  const { D, islandLoops } = await threePockets(t, label, true);
    // the operations list
    if (phone) await clickEl('#prepare-ops .ops-head');
    const ops = await evalJs(`[...document.querySelectorAll('#prepare-ops .ops-row')].map((r) => r.querySelector('.ops-name').textContent + ' | ' + r.querySelector('.ops-sub').textContent)`);
    console.log(label + ' ops: ' + JSON.stringify(ops));
    // TASK S2 (docs/OPERATIONS-MODEL.md 9.1): the quick flow makes a NEW operation each time: the rectangle, the L and the island are three operations (before S2 the
    // L and the island, the same settings, shared one)
    assert.strictEqual(ops.length, 3, label + ': 3 operations: the rectangle (Loop off), the L and the island (Loop on)');
    assert.ok(ops.some((t) => /^Pocket \(spiral\) · .* \| 1 region · spiral, \d+ turns in 1 line \+ wall$/.test(t)), label + ': the rectangle row');
    assert.ok(ops.some((t) => /^Pocket \(spiral\) · .* \| 1 region · spiral, \d+ turns \+ wall: one closed loop$/.test(t)), label + ': the L row');
    assert.ok(ops.some((t) => new RegExp(`^Pocket \\(spiral\\) · .* \\| 1 region · spiral, \\d+ turns \\+ wall: ${islandLoops} closed loops \\(the pocket has islands\\)$`).test(t)), label + ': the island row');
    await shot(`${D}-ops-list.png`, '#prepare-ops', 2);
    if (phone) await clickEl('#prepare-ops .ops-head');
}

/** TASKS 745 / 749 / 750, the export of the three pockets (threePockets): Export 2D == the download element by element, Export 3D. */
export async function exportPhase(t, label) {
  const { phone, evalJs, waitFor, openMode, shot, clickEl, export2d, preview2dElements, download, fileElements, EVIDENCE_DIR } = t;
  const { D, islandLoops } = await threePockets(t, label, false);
    // Export 2D == the download, element by element
    const e2 = await export2d(label);
    console.log(label + ' 2D rows: ' + JSON.stringify(e2.rows));
    assert.ok(e2.rows.some((t) => /· spiral lines \(1\)$/.test(t)) && e2.rows.some((t) => /· wall \(1\)$/.test(t)) && e2.rows.reduce((n, t) => n + Number((/· closed loops \((\d+)\)$/.exec(t) || [0, 0])[1]), 0) === 1 + islandLoops /* TASK S2: the quick flow makes a NEW operation per pocket: their closed loops on two rows */ && e2.rows.some((t) => /· start mark/.test(t)) && !e2.rows.some((t) => /· islands \(/.test(t)), label + ': 2D lists the spiral line, its wall, the closed loops, and the start marks');
    await clickEl('#review-cuts-list .rv2d-row');
    const lab = await evalJs(`document.getElementById('review-2d-info').textContent`);
    console.log(label + ' 2D label: ' + lab);
    await shot(`${D}-export-2d.png`, phone ? null : ['#review-stage', '#review-side']);
    const pv = await preview2dElements();
    const file = await download();
    fs.writeFileSync(path.join(EVIDENCE_DIR, `${D}-download.svg`), file);
    assert.deepStrictEqual(fileElements(pv), fileElements(file), label + ': Export 2D shows the downloaded file, element by element (geometry + cut attributes)');
    assert.strictEqual(e2.count, fileElements(file).length, label + ': every element of the file is on the 2D canvas');
    assert.ok(!/data-/.test(file), label + ': no data-* in the download');
    const kinds = fileElements(file).map((e) => [e[2], /Z$/.test(e[1])]);
    assert.deepStrictEqual(kinds.filter((k) => k[0] !== 'online' || !k[1]), [['online', false], ['inside', true], ['guide', false], ['guide', false], ['guide', false]], label + ': the download: the rectangle\'s open line + its inside cut + 3 guide start marks; no outside / pocket element');
    assert.strictEqual(kinds.filter((k) => k[0] === 'online' && k[1]).length, 1 + islandLoops, label + `: and ${1 + islandLoops} closed on-line loops (the L, the island pocket)`);
    // Export 3D: built, the cleared pockets
    if (await evalJs(`document.getElementById('review-view-3d').getAttribute('aria-pressed')`) !== 'true') await clickEl('#review-view-3d');
    await waitFor(`/triangles/.test(document.getElementById('review-info').textContent)`, label + ': the Review built');
    await sleep(800);
    // the info's lines (TASK 757: on a phone the first line is the fold's header button and the others its body)
    const info = await evalJs(`[...document.querySelectorAll('#review-info > div:not(.review-info-body), #review-info .review-info-head > span, #review-info .review-info-body > div')].map((d) => d.textContent)`);
    console.log(label + ' 3D info: ' + JSON.stringify(info));
    assert.ok(info.some((t) => /^Pocket: spiral, \d+ turns in 1 line \+ wall,/.test(t)) && info.some((t) => /^Pocket: spiral, \d+ turns \+ wall: one closed loop/.test(t)) && info.some((t) => /closed loops \(the pocket has islands\)/.test(t)), label + ': the 3D info says the clearing');
    await shot(`${D}-export-3d.png`, '#review-canvas-host');
    await openMode('prepare');
}

/** TASK 750: Loop ON on the rectangle for `patterns` (Spiral, Raster, Morphed spiral: one closed line + its marker, the note, the download = ONE closed on-line
 *  path, no inside element), then (`off`) Spiral with Loop off again (the open line + the inside cut). */
export async function loopPhase(t, label, { patterns = ['linked', 'raster', 'morphed'], off = true } = {}) {
  const { openMode, shot, shotWorld, card, look, rec, pickClearing, setLoop, markers, download, fileElements, EVIDENCE_DIR } = t;
  const { D, inch, bitWords, pickRect } = await setupPockets(t, label);
    // Loop ON for each pattern on the rectangle: one closed line, the note, the download = ONE closed on-line path, no inside cut
    const loopRuns = {};
    for (const pat of patterns) {
      await pickClearing(pat);
      await setLoop(true);
      assert.strictEqual((await rec(60, 10)).loop, true, label + ` ${pat}: Loop on stored`);
      const c = await card();
      assert.ok(c.loop === true && /\+ wall: one closed loop, stepover/.test(c.note[0]) && c.note.includes(`Wall cut in the same line: exact for a ${bitWords} bit only`), label + ` ${pat}: the note ${JSON.stringify(c.note)}`);
      const l = await look();
      assert.ok(l.paths === 1 && await markers() === 0, label + ` ${pat}: ONE closed line drawn, no dot (TASK 775: a closed loop has no start point)`);
      if (pat === 'linked') await shot(`${D}-card-loop.png`, '#prepare-panel .cut-card', 2);
      await shotWorld(`${D}-loop-${pat}.png`, [0, 0, 120, 70]);
      const file = await download();
      fs.writeFileSync(path.join(EVIDENCE_DIR, `${D}-loop-${pat}-download.svg`), file);
      const els = fileElements(file);
      loopRuns[pat] = els.map((e) => [e[2], e[3], /Z$/.test(e[1]) ? 'closed' : 'open']);
      assert.deepStrictEqual(loopRuns[pat], [['online', inch ? '0.250 in' : '6.000 mm', 'closed'], ['guide', undefined, 'open']], label + ` ${pat}: the download: ONE closed on-line path + 1 guide start mark (once: the Origin's AutoPass steps down), no inside element`);
      const n = els[0][1].replace(/[MLZ]/g, ' ').trim().split(/\s+/);
      assert.ok(n[0] === n[n.length - 2] && n[1] === n[n.length - 1], label + ` ${pat}: the path is closed (first point == last point)`);
      await openMode('prepare'); await pickRect();
    }
    console.log(label + ' loop downloads: ' + JSON.stringify(loopRuns));
    if (!off) return;
    // back to Spiral with Loop off: the open line + the inside cut + 1 guide start mark
    await pickClearing('linked');
    await setLoop(false);
    const fileOff = fileElements(await download());
    assert.deepStrictEqual(fileOff.map((e) => [e[2], /Z$/.test(e[1])]), [['online', false], ['inside', true], ['guide', false]], label + ': Loop off: the open line + the Origin\'s inside cut + 1 guide start mark');
    await openMode('prepare'); await pickRect();
    await shotWorld(`${D}-loop-off-spiral.png`, [0, 0, 120, 70]);
}

/** TASK 750: Fusion mode: the imported drafted pocket with Loop on for Spiral, Raster and Morphed spiral: each one closed on-line path in the export, no inside
 *  element (the body's other region keeps its own cut). */
export async function fusionPhase(t) {
  const { evalJs, waitFor, setUnit, clickWorld, pickClearing, setLoop, card, look, shotWorld, shot, fileElements } = t;
  await setUnit('mm');
  await evalJs(`import('/tests/helpers/plan-v2.js').then((m) => m.V2_PLAN.clear())`);
  await evalJs(`window.fusionJavaScriptHandler.handle('selection_data', ${JSON.stringify(fixture('02-drafted-pocket'))})`);
  await waitFor(`/Body1: 2 regions/.test(document.getElementById('prepare-notice').textContent)`, 'Fusion: the drafted pocket imported');
  await clickWorld(60, -40);
  await waitFor(`!document.querySelector('#prepare-panel .cut-card').hidden && document.querySelector('.cut-type-cur').textContent === 'Pocket'`, 'Fusion: the imported pocket\'s card');
  const fusion = {};
  for (const id of ['linked', 'raster', 'morphed']) {
    await pickClearing(id);
    await setLoop(true);
    const c = await card();
    assert.ok(new RegExp(`^Pocket: ${id === 'linked' ? 'spiral, \\d+ turns' : id === 'raster' ? 'raster 0°: \\d+ passes \\+ 1 ring' : 'morphed spiral: \\d+ turns'} \\+ wall: one closed loop,`).test(c.note[0]), `Fusion ${id}: the note ${c.note[0]}`);
    const l = await look();
    assert.ok(l.paths >= 1, `Fusion ${id}: drawn`);
    const b = await evalJs(`(() => { const r = [...document.querySelectorAll('#prepare-toolpath-group .sk-clear-path')].map((p) => p.getBBox()); return [Math.min(...r.map((q) => q.x)) - 8, Math.min(...r.map((q) => q.y)) - 8, Math.max(...r.map((q) => q.x + q.width)) + 8, Math.max(...r.map((q) => q.y + q.height)) + 8]; })()`);
    await shotWorld(`fusion-loop-${id}.png`, b);
    const svg = await evalJs(`import('/apps/shaper/src/export-payload.js').then((m) => import('/tests/helpers/plan-v2.js').then((C) => m.shaperSvgOf(window.__designController.state, C.planEntries())))`);
    const els = fileElements(svg).map((e) => e[2]);
    fusion[id] = els.reduce((o, k) => ({ ...o, [k]: (o[k] || 0) + 1 }), {});
    assert.ok(els.filter((k) => k === 'online').length === 1 && els.filter((k) => k === 'guide').length === 1 && !els.includes('inside') && !els.includes('pocket') && fileElements(svg).filter((e) => e[2] === 'online').every((e) => /Z$/.test(e[1])), `Fusion ${id}: the pocket is ONE closed on-line path + 1 guide start mark (the body's other region keeps its own cut): ${JSON.stringify(fusion[id])}`);
    await clickWorld(60, -40);
  }
  console.log('Fusion exports: ' + JSON.stringify(fusion));
  await shot('fusion-card.png', '#prepare-panel .cut-card', 2);
}
