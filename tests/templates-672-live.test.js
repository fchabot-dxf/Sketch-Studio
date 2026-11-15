// tests/templates-672-live.test.js -- TASK 672 in the REAL Shaper page (Design tab), real mouse and real touch:
//   A. Shaper's template previews are drawn SOLID: the modal panel is no longer the class `.sk-tp` Shaper styles its toolpaths with (a dashed
//      stroke, since task 651): every preview stroke in the cards and in a start view has no dash.
//   B. desktop, mouse: each new template opened through its start modal (stair stringer, curved bench seat, right-angle brace with its three
//      corner pickers expanded and picked, polygon frame with its joint picker expanded and picked) and the box frame's corner joint picker
//      (Mitered): the drawing, its user parameters (screenshots of each start view, each expanded picker, each opened drawing).
//   C. phone 390 x 844, real touch: each new template's start view fits the screen with 44 px targets; a tap on Open opens it.
// EVIDENCE_DIR: the screenshots.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

await (async () => {
  const cdp = await launchBrowser({ tag: '672', width: 1400, height: 900 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate, waitForApp } = cdp;
  const rectOf = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return b.width ? { x: b.left, y: b.top, width: b.width, height: b.height } : null; })()`);
  const shot = async (name, sel, { pad = 0, scale = 1 } = {}) => {
    if (!process.env.EVIDENCE_DIR) return;
    const r = sel ? await rectOf(sel) : null;
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
  const params = () => S(`JSON.stringify(s.parameters.map((p) => [p.name, p.expression]))`).then(JSON.parse);
  const visibleChoices = (param) => evalJs(`[...document.querySelectorAll('.sk-tp-field[data-param="${param}"] .sk-tp-choice button')].filter((b) => !b.hidden).map((b) => [b.dataset.value, b.getAttribute('aria-label'), b.getAttribute('aria-pressed')])`);
  const choiceSel = (param, value) => `.sk-tp-field[data-param="${param}"] .sk-tp-choice button[data-value="${value}"]`;
  const openMenu = async () => {
    const c = await evalJs(`(() => { const e = [...document.querySelectorAll('.sk-sidebar-btn, .sk-sidebar-handle')].find((x) => x.getClientRects().length > 0); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    assert(c, 'menu trigger'); await pointer(c.x, c.y); await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'sidebar open');
  };
  const openCards = async () => { await openMenu(); await press('[data-action="templates"]'); await waitFor(`!!document.querySelector('.sk-tp-card')`, 'the template modal'); };
  const startOf = async (id) => {
    await openCards();
    await press(`.sk-tp-card[data-template="${id}"]`);
    await waitFor(`!!document.querySelector('.sk-tp-panel.sk-tp-small .sk-tp-start[data-template="${id}"]')`, id + ': the start view');
  };
  const dontSave = async () => { await sleep(300); const has = await evalJs(`[...document.querySelectorAll('.sk-sidebar-ask button')].some((b) => /Don.t save/.test(b.textContent))`); if (has) { await press('.sk-sidebar-ask button:nth-of-type(2)').catch(() => {}); } };
  const openIt = async (what) => { await press('.sk-tp-open'); await waitFor(`!document.querySelector('.sk-tp-panel')`, what + ': Open closes the modal'); await dontSave(); };
  const openShaper = async () => {
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 10000);
    await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"], .sk-sidebar-handle')`, 'Shaper to load');
    for (let i = 0; i < 5; i++) { const on = await evalJs(`(() => { const t = document.querySelector('.sk-header-tab.active'); return !t || t.dataset.tab === 'design'; })()`); if (on) break; await press('.sk-header-tab[data-tab="design"]'); }
    await waitFor(`!!window.__designController && !!document.getElementById('btn-parameters')`, 'the Shaper Design tab');
    await waitForApp('design-canvas');
  };
  // every stroke of the template previews in the modal: its computed dash (none = solid) and its fill
  const previewDashes = (scope) => evalJs(`(() => { const out = new Set(); for (const e of document.querySelectorAll(${JSON.stringify(scope)} + ' .sk-tp-prev svg > g:first-child > *')) { const cs = getComputedStyle(e); if (!e.hasAttribute('stroke-dasharray')) out.add(cs.strokeDasharray + '|' + cs.fill); } return [...out]; })()`);
  const canvasShot = async (name) => { await press('#btn-recenter-view'); await sleep(700); await shot(name, '#design-canvas'); };
  const slanted = () => S(`s.shapes.filter((x) => x.type === 'line' && !x.isConstruction).filter((x) => { const [a, b] = x.joints.map((id) => s.joints.get(id)); return Math.abs(a.x - b.x) > 1e-6 && Math.abs(a.y - b.y) > 1e-6; }).length`);
  try {
    // ================================================================== A. Shaper: the previews are solid
    await openShaper();
    await resetBufferLive(cdp);
    await openShaper();
    assert.strictEqual(await evalJs(`(() => { const r = [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules]; } catch (e) { return []; } }).find((r) => r.selectorText === '.sk-tp'); return !!r && /dash/.test(r.cssText); })()`), true, "Shaper's page styles its toolpath class .sk-tp with a dash (the cause)");
    await openCards();
    assert.strictEqual(await evalJs(`document.querySelectorAll('.sk-tp').length`), 0, 'the modal uses no element of the toolpath class .sk-tp');
    assert.strictEqual(await evalJs(`!!document.querySelector('.sk-tp-panel[role="dialog"]')`), true, 'the modal panel is .sk-tp-panel');
    const cardDash = await previewDashes('.sk-tp-card');
    assert.deepStrictEqual(cardDash, ['none|none'], 'Shaper: every solid preview stroke in the cards is solid, unfilled: ' + JSON.stringify(cardDash));
    for (const id of ['stair-stringer', 'curved-bench-seat', 'right-angle-brace', 'polygon-frame', 'box-frame']) {
      await evalJs(`document.querySelector('.sk-tp-card[data-template="${id}"]').scrollIntoView({ block: 'center' })`);
      await sleep(250); await shot(`shaper-card-${id}.png`, `.sk-tp-card[data-template="${id}"]`, { pad: 4, scale: 2 });
    }
    await press('.sk-tp-card[data-template="right-angle-brace"]');
    await waitFor(`!!document.querySelector('.sk-tp-start[data-template="right-angle-brace"]')`, 'the brace start view');
    assert.deepStrictEqual(await previewDashes('.sk-tp-start'), ['none|none'], 'Shaper: the start view preview is solid too');
    await shot('shaper-start-view-solid.png', '.sk-tp-start .sk-tp-prev', { pad: 2, scale: 2 });

    // ================================================================== B. desktop, mouse: the right-angle brace and its three corner pickers
    for (const [k, def, labels] of [['topJoint', 'V-Through', ['Vertical Through Joint', 'Diagonal Through Joint', 'Mitered Joint']], ['blJoint', 'V-Through', ['Vertical Through Joint', 'Horizontal Through Joint', 'Mitered Joint']], ['brJoint', 'H-Through', ['Horizontal Through Joint', 'Diagonal Through Joint', 'Mitered Joint']]]) {
      assert.deepStrictEqual((await visibleChoices(k)).map((x) => x[0]), [def], `brace ${k}: collapsed, the default`);
      await press(choiceSel(k, def));
      assert.deepStrictEqual((await visibleChoices(k)).map((x) => x[1]), labels, `brace ${k}: expanded by a click, frame-calc's options`);
      await sleep(200); await shot(`brace-${k}-expanded.png`, `.sk-tp-field[data-param="${k}"]`, { pad: 6, scale: 3 });
      await press(choiceSel(k, 'Miter'));
      assert.deepStrictEqual(await visibleChoices(k), [['Miter', 'Mitered Joint', 'true']], `brace ${k}: Mitered picked, collapsed`);
    }
    await sleep(300); await shot('start-view-brace-mitered.png', '.sk-tp-panel', { pad: 4 });
    await openIt('brace');
    assert.deepStrictEqual(await params(), [['width', '300 mm'], ['height', '600 mm'], ['thick_v', '38 mm'], ['thick_h', '38 mm'], ['thick_d', '38 mm']], 'brace: its user parameters');
    assert.strictEqual(await slanted(), 5, 'brace, all mitered: the two faces of the diagonal and the three miter seams (5 slanted lines)');
    await canvasShot('brace-mitered-canvas.png');

    // the polygon frame: 8 sides, its joint picker
    await startOf('polygon-frame');
    await evalJs(`(() => { const i = document.querySelector('.sk-tp-field[data-param="sides"] input'); i.focus(); i.select(); })()`);
    await send('Input.insertText', { text: '8' }); await sleep(300);
    assert.deepStrictEqual(await visibleChoices('joint'), [['Miter', 'Mitered Joint', 'true']], 'polygon: Mitered by default');
    await press(choiceSel('joint', 'Miter'));
    assert.deepStrictEqual((await visibleChoices('joint')).map((x) => x[1]), ['Clockwise Through', 'Counter-Clockwise Through', 'Mitered Joint'], 'polygon: expanded');
    await sleep(200); await shot('polygon-joint-expanded.png', '.sk-tp-field[data-param="joint"]', { pad: 6, scale: 3 });
    await press(choiceSel('joint', 'CW-Through'));
    await sleep(300); await shot('start-view-polygon-8-cw.png', '.sk-tp-panel', { pad: 4 });
    await openIt('polygon');
    assert.deepStrictEqual(await params(), [['side_length', '300 mm'], ['thickness', '38 mm']], 'polygon: its user parameters');
    assert.strictEqual(await S(`s.shapes.filter((x) => x.isConstruction).length`), 8, 'polygon: 8 sides (8 construction radii)');
    await canvasShot('polygon-8-cw-canvas.png');

    // the stair stringer
    await startOf('stair-stringer');
    await sleep(300); await shot('start-view-stringer.png', '.sk-tp-panel', { pad: 4 });
    await openIt('stringer');
    assert.deepStrictEqual(await params(), [['rise', '180 mm'], ['run', '250 mm'], ['board_width', '286 mm'], ['throat', '125 mm']], 'stringer: its user parameters');
    assert.strictEqual(await S(`s.shapes.filter((x) => !x.isConstruction).length`), 11, 'stringer: 4 risers, 4 treads, plumb cut, lower edge, level cut');
    await canvasShot('stringer-canvas.png');

    // the curved bench seat
    await startOf('curved-bench-seat');
    await sleep(300); await shot('start-view-bench.png', '.sk-tp-panel', { pad: 4 });
    await openIt('bench seat');
    assert.deepStrictEqual(await params(), [['outer_radius', '900 mm'], ['inner_radius', '450 mm'], ['sweep_angle', '60 deg'], ['gap', '10 mm']], 'bench: its user parameters');
    assert.strictEqual(await S(`s.shapes.filter((x) => x.type === 'arc').length`), 16, 'bench: 8 slats, 16 real arcs');
    await canvasShot('bench-canvas.png');

    // the box frame's corner joint: Mitered
    await startOf('box-frame');
    assert.deepStrictEqual(await visibleChoices('joint'), [['V-Through', 'Vertical through', 'true']], 'box: Vertical through by default');
    await press(choiceSel('joint', 'V-Through'));
    assert.deepStrictEqual((await visibleChoices('joint')).map((x) => x[1]), ['Vertical through', 'Horizontal through', 'Mitered'], 'box: expanded');
    await sleep(200); await shot('box-joint-expanded.png', '.sk-tp-field[data-param="joint"]', { pad: 6, scale: 3 });
    await press(choiceSel('joint', 'Miter'));
    await sleep(300); await shot('start-view-box-mitered.png', '.sk-tp-panel', { pad: 4 });
    await openIt('box frame');
    assert.strictEqual(await slanted(), 4, 'box Mitered: four 45 degree seams');
    await canvasShot('box-mitered-canvas.png');

    // ================================================================== C. phone 390 x 844, real touch
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    pointer = touch;
    await openShaper();
    for (const [id, n] of [['stair-stringer', 4], ['curved-bench-seat', 4], ['right-angle-brace', 5], ['polygon-frame', 2]]) {
      await startOf(id);
      const box = await rectOf('.sk-tp-panel');
      assert.ok(box.x >= 0 && box.x + box.width <= 390 && box.y >= 0 && box.y + box.height <= 844, `phone ${id}: the start view fits the screen ` + JSON.stringify(box));
      assert.strictEqual(await evalJs(`document.documentElement.scrollWidth <= 390`), true, `phone ${id}: no sideways scroll`);
      const fits = await evalJs(`[...document.querySelectorAll('.sk-tp-start input, .sk-tp-start button:not([hidden])')].every((e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= 390; })`);
      assert.strictEqual(fits, true, `phone ${id}: every box and button inside the screen`);
      const tgt = await evalJs(`[...document.querySelectorAll('.sk-tp-open, .sk-tp-cancel, .sk-tp-choice button:not([hidden])')].map((e) => Math.round(e.getBoundingClientRect().height))`);
      assert.ok(tgt.every((h) => h >= 44), `phone ${id}: Open, Cancel and the glyphs are 44 px tall ` + JSON.stringify(tgt));
      if (id === 'right-angle-brace') { await press(choiceSel('brJoint', 'H-Through')); assert.strictEqual((await visibleChoices('brJoint')).length, 3, 'phone: a tap expands the bottom-right picker'); await sleep(200); await shot('phone-brace-br-expanded.png', '.sk-tp-field[data-param="brJoint"]', { pad: 6, scale: 2 }); await press(choiceSel('brJoint', 'D-Through')); }
      await sleep(300); await shot(`phone-start-${id}.png`);
      await openIt('phone ' + id);
      await waitFor(`window.__designController.state.parameters.length === ${n}`, `phone ${id}: opened with its ${n} user parameters`);
      await sleep(300); await shot(`phone-${id}-canvas.png`);
    }
    console.log('templates-672-live: ok');
  } finally { await cdp.close(); }
})();
