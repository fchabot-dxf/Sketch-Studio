// tests/polish-757-phone-live.test.js — TASK 757: the promo-screenshot polish of the Shaper app on a PHONE, 390 x 844, real touch taps (the desktop is
// tests/polish-757-live.test.js; the tray both draw is tests/polish-757-tray.js).
//  6. an empty design in Export 3D: the empty-state message, no mesh
//  4. the tab count's longest text "Auto (99)" fits its field; every Settings select is as wide as its longest option, inside the panel
//  5. Export 3D: the info FOLDS to one summary line (the first line, the Operations sheet's caret), so it does not cover the part; a tap unfolds every line;
//     the page never scrolls sideways
// Screenshots to .evidence/757/live/.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { drawTray, selectWidths, PHONE } from './polish-757-tray.js';
import { clickOpenLive, stepLive } from './helpers/prepare-open-live.js'; // TASK S2: an operation is opened, changed, confirmed
import { REVIEW_BUILT } from './helpers/review-built.js'; // TASK 880: the 3D build is waited for through lastBuild (no build line on screen)

const EVIDENCE_DIR = process.env.EVIDENCE_DIR || path.resolve('.evidence/757/live');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const cdp = await launchBrowser({ tag: '757-phone', width: 1280, height: 800, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, navigate, close } = cdp;

try {
  const shot = async (name, sel = null) => {
    const clip = sel ? await evalJs(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.max(0, r.left - 4), y: Math.max(0, r.top - 4), width: Math.min(innerWidth, r.width + 8), height: r.height + 8, scale: 1 }; })()`) : null;
    const { data } = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
    fs.writeFileSync(path.join(EVIDENCE_DIR, name), Buffer.from(data, 'base64'));
    console.log('screenshot ' + path.join(EVIDENCE_DIR, name));
  };
  const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
  const press = async (x, y) => { await T('touchStart', [{ x, y }]); await sleep(40); await T('touchEnd', []); await sleep(250); };
  const clickElRaw = async (sel) => {
    const p = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const hit = document.elementFromPoint(x, y); return { x, y, onTop: !!hit && (hit === e || e.contains(hit)) }; })()`);
    assert.ok(p && p.onTop, `${sel} is on screen and not covered: ${JSON.stringify(p)}`);
    await press(p.x, p.y);
  };
  // TASK S2 (docs/OPERATIONS-MODEL.md 9.1): the steps of before S2 in today's terms (tests/helpers/prepare-open-live.js): a click on the canvas = OK on the open
  // operation, the click, and the clicked shape's operation opened (it is in one); a press / a typed field that changes the open operation = its own step
  const s2Steps = { get phone() { return false; }, evalJs, waitFor, clickEl: clickElRaw };
  const clickEl = (sel) => stepLive(s2Steps, () => clickElRaw(sel));
  const activeStage = () => evalJs(`(() => { const e = document.querySelector('.sk-sidebar-stage.active') || document.querySelector('.sk-header-tab.active'); return e ? e.dataset.tab : null; })()`);
  const openMode = async (mode) => {
    for (let i = 0; i < 5; i++) {
      if (await activeStage() === mode) break;
      if (!await evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`)) await clickEl('.sk-sidebar-chevron');
      await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'the drawer opens'); await sleep(300);
      await clickEl(`.sk-sidebar-stage[data-tab="${mode}"]`); await sleep(400);
    }
    assert.strictEqual(await activeStage(), mode, 'the ' + mode + ' stage');
    if (await evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`)) { await clickEl('.sk-sidebar-scrim'); await sleep(350); }
  };
  const toScreen = (x, y) => evalJs(`(() => { const s = document.getElementById('prepare-canvas'); const p = s.createSVGPoint(); p.x = ${x}; p.y = ${y}; const q = p.matrixTransform(s.getScreenCTM()); return { x: Math.round(q.x), y: Math.round(q.y) }; })()`);
  const setting = (k, v) => evalJs(`import('/packages/core/settings-manager.js').then((m) => { m.default.set(${JSON.stringify(k)}, ${JSON.stringify(v)}); })`);

  await send('Emulation.setDeviceMetricsOverride', { width: PHONE.width, height: PHONE.height, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await resetBufferLive(cdp);
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html?analytics=off`, 10000);
  await waitFor(`!!document.querySelector('.sk-sidebar-chevron')`, 'shaper app ready (phone)');
  await evalJs(`localStorage.setItem('shaper-review-view', '3d')`);
  await setting('DOC_UNIT', 'in'); await setting('INCH_DISPLAY', 'decimal');

  // ── 6. an empty design in Export 3D ──
  await openMode('review');
  await waitFor(`/No cuts assigned/.test(document.getElementById('review-info').textContent)`, 'the empty-state message (phone)', 30000);
  const empty = await evalJs(`import('/apps/shaper/src/main.js').then((m) => ({ info: document.getElementById('review-info').textContent, meshes: m.currentReviewView().inspect().meshes.length }))`);
  console.log('6 phone empty design 3D: ' + JSON.stringify(empty));
  assert.deepStrictEqual(empty, { info: 'No cuts assigned — assign cut types in Prepare first.', meshes: 0 }, '6: phone: the message, no mesh');
  await shot('phone-6-empty-export-3d.png');

  // ── the tray ──
  await openMode('design');
  await waitFor('!!(window.__designController && window.__designController.state)', 'design controller ready');
  console.log('plan: ' + JSON.stringify(await evalJs(`(${drawTray})()`)));

  // ── 4. the tab count field ──
  await openMode('prepare');
  await waitFor(`!!document.querySelector('#prepare-canvas .sk-edge') && !!document.getElementById('prepare-canvas').getScreenCTM()`, 'prepare view drawn');
  await evalJs(`window.__prepareView.setView({ x: 60, y: 20, w: 140 })`); await sleep(200); // zoomed so a finger's tap is clearly on the part (between the slot and the pocket)
  await clickOpenLive(s2Steps, async () => { const p = await toScreen(60, 20); await press(p.x, p.y); }); // TASK S2: the tap selects the part; its operation opened (list row, Edit)
  await waitFor(`!document.querySelector('.cut-row[data-row="tabCount"]').hidden && document.querySelector('.cut-row[data-row="tabCount"]').style.display !== 'none' && !('off' in document.querySelector('.cut-row[data-row="tabCount"]').dataset)`, 'the tab count row (phone)');
  const fit = await evalJs(`(() => { const i = document.querySelector('.cut-tab-count'), cs = getComputedStyle(i), c = document.createElement('canvas').getContext('2d');
    c.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily; const box = i.closest('.cut-box'), card = document.querySelector('#prepare-panel .cut-card').getBoundingClientRect();
    return { placeholder: i.placeholder, room: i.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), longest: c.measureText('Auto (99)').width, boxOverflow: box.scrollWidth - box.clientWidth, cardRight: card.right, vw: innerWidth }; })()`);
  console.log('4 phone tab count: ' + JSON.stringify(fit));
  assert.ok(fit.longest <= fit.room && fit.boxOverflow <= 0 && fit.cardRight <= fit.vw, `4: phone: "Auto (99)" fits the count field (${fit.room} px), the card inside the screen`);
  await evalJs(`document.querySelector('.cut-row[data-row="tabCount"]').scrollIntoView({ block: 'center' })`); await sleep(150);
  await shot('phone-4-tab-count.png', '#prepare-panel .cut-card');

  // ── 4. the Settings selects (a finger: 14 px text) ──
  await clickEl('#btn-settings');
  await waitFor(`!document.querySelector('.sk-style-panel').classList.contains('sk-hidden')`, 'the Settings panel (phone)');
  const sel = await evalJs(`(${selectWidths})()`);
  console.log('4 phone settings selects: ' + JSON.stringify(sel));
  assert.ok(sel.length >= 8, '4: phone: the Settings selects were measured');
  for (const s of sel) assert.ok(s.width >= s.needed - 0.5 && s.right <= s.panelRight + 0.5, `4: phone: the ${s.key} select shows its longest option, inside the panel: ${JSON.stringify(s)}`);
  await clickEl('#sk-style-tab-units');
  await shot('phone-4-settings-units.png', '.sk-style-panel');
  await clickEl('.sk-style-close');

  // ── 5. Export 3D: the info folds to one line ──
  await openMode('review');
  await waitFor(REVIEW_BUILT, 'the 3D part built (phone)', 60000);
  await sleep(300);
  const folded = await evalJs(`import('/apps/shaper/src/main.js').then((m) => { const info = document.getElementById('review-info'), head = info.querySelector('.review-info-head'), body = info.querySelector('.review-info-body');
    const r = info.getBoundingClientRect(), v = m.currentReviewView(), b = v.inspect().box, host = document.getElementById('review-canvas-host').getBoundingClientRect();
    const pts = [[b.minX, 0, b.minZ], [b.maxX, 0, b.minZ], [b.minX, 0, b.maxZ], [b.maxX, 0, b.maxZ], [b.minX, b.y, b.minZ], [b.maxX, b.y, b.minZ], [b.minX, b.y, b.maxZ], [b.maxX, b.y, b.maxZ]].map((p) => v.screenOf(p));
    const part = { left: host.left + Math.min(...pts.map((p) => p.x)), right: host.left + Math.max(...pts.map((p) => p.x)), top: host.top + Math.min(...pts.map((p) => p.y)), bottom: host.top + Math.max(...pts.map((p) => p.y)) };
    const ov = Math.max(0, Math.min(r.right, part.right) - Math.max(r.left, part.left)) * Math.max(0, Math.min(r.bottom, part.bottom) - Math.max(r.top, part.top));
    return { head: head ? head.textContent : null, expanded: head && head.getAttribute('aria-expanded'), bodyHidden: !!body && body.hidden, bodyLines: body ? body.children.length : 0, infoHeight: Math.round(r.height),
      headLines: head ? Math.round(head.querySelector('span').getBoundingClientRect().height / parseFloat(getComputedStyle(info).lineHeight)) : null,
      coversPart: Math.round(ov / Math.max(1, (Math.min(part.right, host.right) - Math.max(part.left, host.left)) * (Math.min(part.bottom, host.bottom) - Math.max(part.top, host.top))) * 1000) / 1000,
      side: document.documentElement.scrollWidth - innerWidth }; })`);
  console.log('5 phone 3D info folded: ' + JSON.stringify(folded));
  // TASK 880: the build's numbers are not a line any more: the first line is the first note (the Stock loop board)
  assert.ok(folded.head && /^Board: your Stock loop/.test(folded.head) && folded.expanded === 'false' && folded.bodyHidden && folded.bodyLines >= 1, '5: phone: the info is folded to its first line by default');
  assert.ok(folded.headLines === 1 && folded.infoHeight <= 60, `5: phone: ONE summary line (${folded.infoHeight} px)`);
  assert.ok(folded.coversPart <= 0.05, '5: phone: the folded info hides at most 5 % of the part on screen: ' + folded.coversPart);
  assert.ok(folded.side <= 0, '5: phone: no sideways scroll');
  await shot('phone-5-export-3d-folded.png');
  await clickEl('#review-info .review-info-head');
  const open = await evalJs(`(() => { const info = document.getElementById('review-info'), head = info.querySelector('.review-info-head'), body = info.querySelector('.review-info-body');
    return { expanded: head.getAttribute('aria-expanded'), bodyHidden: body.hidden, lines: [head.textContent, ...[...body.children].map((d) => d.textContent)] }; })()`);
  console.log('5 phone 3D info unfolded: ' + JSON.stringify(open));
  assert.ok(open.expanded === 'true' && !open.bodyHidden && open.lines.length === folded.bodyLines + 1 && open.lines.some((l) => /^Board: your Stock loop/.test(l)), '5: phone: a tap unfolds every line');
  await shot('phone-5-export-3d-unfolded.png');
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  console.log('polish-757-phone-live: ok');
} finally { await close(); }
