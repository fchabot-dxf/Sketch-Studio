// tests/door-hardware-843-live.test.js — TASK 843: two DOOR HARDWARE templates opened in the real Shaper page, from the New design picker, and
// Prepare shows their operations READY (the template's declared cuts, #core/templates.js d.cut -> apps/shaper/src/cut-import.js applyTemplateCuts):
//  * desktop 1280 x 800, real mouse, an inch document: the picker shows the "Door hardware" group on the door cards; the Strike plate mortise's start
//    view has the standard-size chips (2-3/4" / 4-7/8"), the latch hole depth chip 1-1/8" (a deadbolt's) is pressed, Open: Prepare lists Pocket 1/16 in
//    (the strike), Pocket 1-1/8 in (the hole) and the Guide (the door stop), ticked, nothing to assign by hand;
//  * phone 390 x 844, real touch, a mm document: the Deadbolt (face + edge): the chips show the metric equivalents (60.3 (2-3/8")), the 2-3/4 in
//    backset chip is pressed, Open: Prepare lists Inside 44.45 mm (the face bore, through a 1-3/4 in door), Pocket 69.85 mm (the edge bore, to the
//    backset), Pocket 3.175 mm (the faceplate) and the Guide (the edge and the other face); no sideways scroll.
// Screenshots to .evidence/843/ (EVIDENCE_DIR).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const EVIDENCE_DIR = process.env.EVIDENCE_DIR || path.resolve('.evidence/843');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const cdp = await launchBrowser({ tag: '843-door', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, navigate, close } = cdp;

try {
  const shot = async (name, sels = null, scale = 1) => {
    let clip = null;
    if (sels) clip = await evalJs(`(() => { const rs = ${JSON.stringify([].concat(sels))}.map((q) => document.querySelector(q).getBoundingClientRect());
      const x = Math.max(0, Math.min(...rs.map((r) => r.left)) - 4), y = Math.max(0, Math.min(...rs.map((r) => r.top)) - 4);
      return { x, y, width: Math.min(innerWidth, Math.max(...rs.map((r) => r.right)) + 4) - x, height: Math.min(innerHeight, Math.max(...rs.map((r) => r.bottom)) + 4) - y, scale: ${scale} }; })()`);
    const { data } = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
    fs.writeFileSync(path.join(EVIDENCE_DIR, name), Buffer.from(data, 'base64'));
    console.log('screenshot ' + path.join(EVIDENCE_DIR, name));
  };
  let phone = false;
  const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
  const mouse = (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
  const press = async (x, y) => {
    if (phone) { await T('touchStart', [{ x, y }]); await sleep(40); await T('touchEnd', []); }
    else { await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y, 1); await sleep(40); await mouse('mouseReleased', x, y); }
    await sleep(300);
  };
  const boxOf = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const hit = document.elementFromPoint(x, y);
    return { x, y, w: Math.round(r.width), h: Math.round(r.height), onTop: !!hit && (hit === e || e.contains(hit)) }; })()`);
  const clickEl = async (sel) => {
    const p = await boxOf(sel);
    assert.ok(p && p.onTop, `${sel} is on screen and not covered: ${JSON.stringify(p)}`);
    await press(p.x, p.y);
    return p;
  };
  const activeStage = () => evalJs(`(() => { const e = document.querySelector('.sk-sidebar-stage.active') || document.querySelector('.sk-header-tab.active'); return e ? e.dataset.tab : null; })()`);
  const openDrawer = async () => {
    if (!await evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`)) await clickEl(phone ? '.sk-sidebar-chevron' : '.sk-sidebar-btn');
    await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'the menu opens'); await sleep(300);
  };
  const openMode = async (mode) => {
    for (let i = 0; i < 5; i++) {
      if (await activeStage() === mode) return;
      if (phone) { await openDrawer(); await clickEl(`.sk-sidebar-stage[data-tab="${mode}"]`); } else await clickEl(`.sk-header-tab[data-tab="${mode}"]`);
      await sleep(400);
    }
    assert.fail('could not open the ' + mode + ' stage');
  };
  const setUnit = (u) => evalJs(`import('/packages/core/settings-manager.js').then((m) => { m.default.set('DOC_UNIT', '${u}'); })`);
  const list = () => evalJs(`[...document.querySelectorAll('#prepare-ops .ops-row')].map((e) => ({ name: e.querySelector('.ops-name').textContent, sub: e.querySelector('.ops-sub').textContent, on: e.querySelector('.ops-tick input').checked }))`);
  const stored = () => evalJs(`import('/apps/shaper/src/operations-store.js').then((m) => m.storeOps().map((o) => [o.type, o.settings.cutDepth, o.geometry.length]).sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1])))`);
  const chips = (k) => evalJs(`[...document.querySelectorAll('.sk-tp-field[data-param="${k}"] .sk-tp-preset')].map((b) => [b.textContent, b.getAttribute('aria-pressed')])`);

  // start a template from the menu's Templates...: its card (the group label checked), its start view, `presses` = chips [param, index] pressed, Open
  const start = async (id, name, presses, D) => {
    await openMode('design');
    await openDrawer();
    await clickEl('[data-action="templates"]');
    await waitFor(`!!document.querySelector('.sk-tp-grid[data-previews="ready"]')`, 'every card preview drawn');
    const group = await evalJs(`[...document.querySelectorAll('.sk-tp-card[data-group]')].map((c) => [c.dataset.template, c.querySelector('.sk-tp-group').textContent])`);
    console.log(D + ' group cards: ' + JSON.stringify(group));
    assert.deepStrictEqual(group.map((g) => g[1]), Array(6).fill('Door hardware'), D + ': the six door cards say "Door hardware"');
    await evalJs(`document.querySelector('.sk-tp-card[data-template="${id}"]').scrollIntoView({ block: 'center' })`); await sleep(200);
    await shot(`${D}-card-${id}.png`, `.sk-tp-item[data-template="${id}"]`, 2);
    await clickEl(`.sk-tp-card[data-template="${id}"]`);
    await waitFor(`!!document.querySelector('.sk-tp-start[data-template="${id}"]')`, `${id}: its start view`);
    for (const [k, i] of presses) await clickEl(`.sk-tp-field[data-param="${k}"] .sk-tp-preset[data-preset="${i}"]`);
    await sleep(500); // the preview is rebuilt once the values settle
    await evalJs(`document.querySelector('.sk-tp-start').scrollTop = 0`);
    await shot(`${D}-start-${id}.png`, '.sk-tp-panel', phone ? 1 : 2);
    const side = await evalJs(`({ doc: document.documentElement.scrollWidth, vw: innerWidth, panel: Math.round(document.querySelector('.sk-tp-panel').getBoundingClientRect().right) })`);
    assert.ok(side.doc <= side.vw && side.panel <= side.vw, `${D}: the start view fits, no sideways scroll ${JSON.stringify(side)}`);
    await clickEl('.sk-tp-open');
    await waitFor(`!document.querySelector('.sk-tp-panel') && !!document.querySelector('.sk-doctab.active') && document.querySelector('.sk-doctab.active .sk-doctab-name').textContent === ${JSON.stringify(name)}`, `${id}: opened as "${name}"`);
    await openMode('prepare');
    await waitFor(`document.querySelectorAll('#prepare-ops .ops-row').length > 0`, `${id}: Prepare lists operations`);
    if (phone && await evalJs(`document.querySelector('#prepare-ops .ops-body').hidden`)) await clickEl('#prepare-ops .ops-head');
    await sleep(600);
  };

  // ---- desktop, mouse, inches: the strike plate mortise, the deadbolt's 1-1/8 in hole depth chip pressed
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 8000);
  await resetBufferLive(cdp);
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 8000);
  await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'shaper app ready');
  await setUnit('in');
  {
    const D = 'desktop';
    await openMode('design'); await openDrawer(); await clickEl('[data-action="templates"]');
    await waitFor(`!!document.querySelector('.sk-tp-grid[data-previews="ready"]')`, 'every card preview drawn');
    await clickEl('.sk-tp-card[data-template="strike-mortise"]');
    await waitFor(`!!document.querySelector('.sk-tp-start[data-template="strike-mortise"]')`, 'strike: its start view');
    const before = { strikeHeight: await chips('strikeHeight'), holeDepth: await chips('holeDepth'), doorThickness: await chips('doorThickness') };
    console.log(D + ' strike chips: ' + JSON.stringify(before));
    assert.deepStrictEqual(before, { strikeHeight: [['2-3/4"', 'true'], ['4-7/8"', 'false']], holeDepth: [['5/8"', 'true'], ['1-1/8"', 'false']], doorThickness: [['1-3/8"', 'false'], ['1-3/4"', 'true']] }, D + ': an inch document: the standard sizes in inches, the defaults pressed');
    await clickEl('.sk-tp-cancel'); await sleep(300);
    await clickEl('.sk-tp-x'); await sleep(300);
    await start('strike-mortise', 'Strike plate mortise', [['holeDepth', 1]], D);
    const l = await list(), s = await stored();
    console.log(D + ' Prepare: ' + JSON.stringify(l) + ' stored: ' + JSON.stringify(s));
    assert.deepStrictEqual(s, [['guide', 'unset', 1], ['pocket', 1.5875, 1], ['pocket', 28.575, 1]], D + ': the operations ready: the stop Guide, the strike Pocket 1/16 in, the hole Pocket 1-1/8 in (the chip)');
    assert.strictEqual(l.length, 3, D + ': three rows in the Operations list');
    assert.ok(l.every((r) => r.on), D + ': every operation ticked');
    for (const want of [/^Pocket · 0\.063 in$/, /^Pocket · 1\.125 in$/, /^Guide/]) assert.ok(l.some((r) => want.test(r.name)), `${D}: a row ${want} (${JSON.stringify(l.map((r) => r.name))})`);
    await shot(`${D}-prepare-strike.png`);
    await shot(`${D}-prepare-strike-ops.png`, '#prepare-ops', 2);
  }

  // ---- phone 390 x 844, real touch, mm: the deadbolt, the 2-3/4 in backset chip pressed
  phone = true;
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await resetBufferLive(cdp);
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 8000);
  await waitFor(`!!document.querySelector('.sk-sidebar-chevron')`, 'shaper app ready (phone)');
  await setUnit('mm');
  {
    const D = 'phone';
    await openMode('design'); await openDrawer(); await clickEl('[data-action="templates"]');
    await waitFor(`!!document.querySelector('.sk-tp-grid[data-previews="ready"]')`, 'every card preview drawn');
    await clickEl('.sk-tp-card[data-template="deadbolt-bores"]');
    await waitFor(`!!document.querySelector('.sk-tp-start[data-template="deadbolt-bores"]')`, 'deadbolt: its start view');
    const backset = await chips('backset');
    console.log(D + ' backset chips: ' + JSON.stringify(backset));
    assert.deepStrictEqual(backset, [['60.3 (2-3/8")', 'true'], ['69.9 (2-3/4")', 'false']], D + ': a mm document: the metric equivalents, the default pressed');
    const sizes = await evalJs(`[...document.querySelectorAll('.sk-tp-preset')].map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })`);
    assert.ok(sizes.every(([w, h]) => w >= 44 && h >= 44), `${D}: every chip is a 44 px target (${JSON.stringify(sizes)})`);
    await clickEl('.sk-tp-cancel'); await sleep(300);
    await clickEl('.sk-tp-x'); await sleep(300);
    await start('deadbolt-bores', 'Deadbolt (face + edge)', [['backset', 1]], D);
    const l = await list(), s = await stored();
    console.log(D + ' Prepare: ' + JSON.stringify(l) + ' stored: ' + JSON.stringify(s));
    assert.deepStrictEqual(s, [['guide', 'unset', 2], ['interior', 44.45, 1], ['pocket', 3.175, 1], ['pocket', 69.85, 1]], D + ': the operations ready: the Guides, the face bore Inside through the door, the faceplate Pocket 1/8 in, the edge bore Pocket to the 2-3/4 in backset');
    assert.strictEqual(l.length, 4, D + ': four rows');
    assert.ok(l.every((r) => r.on), D + ': every operation ticked');
    for (const want of [/^Inside · 44\.45 mm$/, /^Pocket · 69\.85 mm$/, /^Pocket · 3\.175 mm$/, /^Guide/]) assert.ok(l.some((r) => want.test(r.name)), `${D}: a row ${want} (${JSON.stringify(l.map((r) => r.name))})`);
    await shot(`${D}-prepare-deadbolt.png`);
    await shot(`${D}-prepare-deadbolt-ops.png`, '#prepare-ops', 2);
    const side = await evalJs(`({ doc: document.documentElement.scrollWidth, vw: innerWidth })`);
    assert.ok(side.doc <= side.vw, `${D}: no sideways scroll ${JSON.stringify(side)}`);
  }
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  console.log('door-hardware-843-live: ok');
} finally { await close(); }
