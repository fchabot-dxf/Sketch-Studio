// tests/prepare-look.test.js — TASK 455: Prepare looks like Shaper Studio. ONE state model for every cut type (idle: only the svg line;
// hover / selected: band + boundary + dashed tool path + depth chip), colours only as --sk-prep-* tokens (no hex in the view / card /
// cut-type preview fields), the card look. Headless Edge, real mouse events.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CUT_TYPES } from '../apps/shaper/src/shaper.js';
import { launchBrowser, sendRealKey, sleep } from './helpers/cdp-browser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

await (async () => {
  const cdp = await launchBrowser({ tag: '455' });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { send, evalJs, waitFor, navigate, port } = cdp;

  try {
    const key = async (k, code, vk, modifiers = 0, text = '') => { await sendRealKey(send, k, code, vk, modifiers, text); await sleep(200); };
    const click = async (x, y) => {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 }); await sleep(30);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(30);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(150);
    };
    const clickEl = async (sel) => {
      const c = await evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`);
      assert(c, sel + ' not found');
      await click(c.x, c.y);
    };
    const stageTab = (name) => clickEl(`.sk-header-tab[data-tab="${name}"]`);

    // ── 1. tokens, not hex literals ──
    const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    const hexIn = (src) => (src.replace(/\/\/[^\n]*/g, '').match(/#[0-9A-Fa-f]{6}\b/g) || []);
    assert.deepStrictEqual(hexIn(read('apps/shaper/src/prepare-view.js')), [], 'no hex colours in prepare-view.js');
    assert.deepStrictEqual(hexIn(read('apps/shaper/src/cut-panel.js')), [], 'no hex colours in cut-panel.js');
    assert.ok(CUT_TYPES.every((t) => !('previewFill' in t) && !('previewStroke' in t) && typeof t.icon === 'string'), 'CUT_TYPES carry an icon, no preview hex fields');
    const html = read('apps/shaper/index.html');
    const tokens = { 'sk-prep-bg': '#3F4145', 'sk-prep-geo': '#DFE1E7', 'sk-prep-geo-selected': '#1BE09E', 'sk-prep-guide': '#2C9AFF', 'sk-prep-band-selected': '#34715F', 'sk-prep-band-hover': '#27282B', 'sk-prep-path': '#CBDAD6', 'sk-prep-mark': '#FDFDFE', 'sk-prep-chip-bg': '#0A0A0B', 'sk-prep-card-bg': '#0A0A0B', 'sk-prep-field-bg': '#2A2B2D' };
    for (const [name, hex] of Object.entries(tokens)) assert.ok(new RegExp('--' + name + ':\\s*' + hex, 'i').test(html), `token --${name} = ${hex} is declared once in index.html`);

    // ── 2. the state model in the real app (real mouse): idle / hover / selected / selected+hover, same for every type ──
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 8000);
    await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'shaper app ready');
    await clickEl('.sk-header-tab[data-tab="design"]');
    await waitFor('!!(window.__designController && window.__designController.state)', 'design controller ready');
    await evalJs(`(async () => {
      const { findLoops, findOpenChains } = await import('/packages/core/loop-finder.js');
      const { CUT_PLAN, keyOf } = await import('/apps/shaper/src/cut-plan.js');
      const st = window.__designController.state;
      for (const k of [...st.joints.keys()]) st.joints.delete(k);
      st.shapes.length = 0; st.constraints.length = 0; CUT_PLAN.clear();
      let n = 0; const J = (x, y) => { const id = 'j' + (++n); st.joints.set(id, { x, y }); return id; };
      const line = (a, b) => st.shapes.push({ id: 's' + (++n), type: 'line', joints: [a, b] });
      const rect = (x, y, w, h) => { const p = [J(x, y), J(x + w, y), J(x + w, y + h), J(x, y + h)]; for (let i = 0; i < 4; i++) line(p[i], p[(i + 1) % 4]); };
      rect(0, 0, 40, 40); rect(60, 0, 40, 40); rect(120, 0, 40, 40);   // outside, inside, pocket
      line(J(0, 60), J(40, 60));                                        // on line (chain)
      line(J(60, 60), J(100, 60));                                      // guide (chain)
      const loops = findLoops(st); const chains = findOpenChains(st, loops);
      const byX = (l) => st.joints.get(l.joints[0]).x;
      const L = loops.sort((a, b) => byX(a) - byX(b));
      const C = chains.sort((a, b) => st.joints.get(a.shapes[0].joints[0]).x - st.joints.get(b.shapes[0].joints[0]).x);
      const base = { cutDepth: 7.62, cutOffset: 0, toolDia: 6.35 };
      CUT_PLAN.set(keyOf('loop', L[0].id), { cutType: 'exterior', ...base });
      CUT_PLAN.set(keyOf('loop', L[1].id), { cutType: 'interior', ...base });
      CUT_PLAN.set(keyOf('loop', L[2].id), { cutType: 'pocket', ...base });
      CUT_PLAN.set(keyOf('chain', C[0].id), { cutType: 'online', ...base });
      CUT_PLAN.set(keyOf('chain', C[1].id), { cutType: 'guide', cutDepth: 'unset', cutOffset: 0, toolDia: 6.35 });
    })()`);
    await clickEl('.sk-header-tab[data-tab="prepare"]');
    await waitFor(`!!document.querySelector('#prepare-canvas .sk-edge') && !!document.getElementById('prepare-canvas').getScreenCTM()`, 'prepare view drawn');
    const world = (wx, wy) => evalJs(`(() => { const s = document.getElementById('prepare-canvas'); const p = s.createSVGPoint(); p.x = ${wx}; p.y = ${wy}; const q = p.matrixTransform(s.getScreenCTM()); return { x: Math.round(q.x), y: Math.round(q.y) }; })()`);
    const move = async (x, y) => { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' }); await sleep(200); };
    const snap = () => evalJs(`(() => {
      const q = (sel) => document.querySelectorAll('#prepare-canvas ' + sel).length;
      const cs = (sel) => { const e = document.querySelector('#prepare-canvas ' + sel); return e ? getComputedStyle(e) : null; };
      const band = cs('.sk-band'), hl = cs('.sk-hl'), chip = document.querySelector('#prepare-canvas .sk-chip-text');
      return { bands: q('.sk-band'), tp: q('.sk-tp') + q('.sk-travel'), chips: q('.sk-chip'), marks: q('.sk-pocket-marks'), hlSelect: q('.sk-hl-select'), hlHoverCut: q('.sk-hl-hover-cut'),
               bandFill: band && band.fill, hlStroke: hl && hl.stroke, hlWidth: hl && hl.strokeWidth, chipText: chip && chip.textContent.replace(/\\s+/g, ' ').trim(),
               edgeStroke: getComputedStyle(document.querySelector('#prepare-canvas .sk-edge')).stroke, edgeWidth: getComputedStyle(document.querySelector('#prepare-canvas .sk-edge')).strokeWidth,
               guideEdges: q('.sk-edge-guide'), bg: getComputedStyle(document.getElementById('prepare-canvas')).backgroundColor };
    })()`);
    // an empty spot inside the Prepare canvas, near its bottom-left corner (from its rect: the app footer, TASK 618, is below it)
    const away = await evalJs(`(() => { const r = document.getElementById('prepare-canvas').getBoundingClientRect(); return { x: Math.round(r.left + 10), y: Math.round(r.bottom - 20) }; })()`);
    // idle: ONLY the svg line (thin white), the guide the one blue exception
    await move(away.x, away.y);
    let sIdle = await snap();
    console.log('idle', JSON.stringify(sIdle));
    assert.deepStrictEqual([sIdle.bands, sIdle.tp, sIdle.chips, sIdle.marks, sIdle.hlSelect, sIdle.hlHoverCut], [0, 0, 0, 0, 0, 0], 'idle: no band, path, chip, marks or highlight');
    assert.strictEqual(sIdle.edgeStroke, 'rgb(223, 225, 231)'); assert.strictEqual(sIdle.edgeWidth, '1px'); assert.strictEqual(sIdle.bg, 'rgb(63, 65, 69)');
    assert.strictEqual(sIdle.guideEdges, 1, 'the idle guide line is the one blue exception');
    const targets = { outside: await world(20, 20), inside: await world(80, 20), pocket: await world(140, 20), online: await world(20, 60), guide: await world(80, 60) };
    for (const type of ['outside', 'inside', 'pocket', 'online']) {
      const pt = targets[type];
      // hover (unselected): dark band + bold white boundary + tool path + chip
      await move(pt.x, pt.y);
      const h = await snap();
      assert.ok(h.bands >= 1 && h.tp >= 1 && h.chips === 1 && h.hlHoverCut >= 1 && h.hlSelect === 0, `${type}: hover shows band + path + chip + bold white boundary`);
      assert.strictEqual(h.bandFill, 'rgb(39, 40, 43)', type + ': hovered band is #27282B');
      assert.match(h.chipText, /^↓ 0\.300 in$/, type + ': chip text');
      assert.strictEqual(h.marks, type === 'pocket' ? 1 : 0, type + ': pocket marks only on a pocket');
      // selected: teal band + bold mint boundary
      await click(pt.x, pt.y); await move(away.x, away.y);
      const s = await snap();
      assert.ok(s.bands >= 1 && s.tp >= 1 && s.chips === 1 && s.hlSelect >= 1, `${type}: selected shows band + path + chip + mint boundary`);
      assert.strictEqual(s.bandFill, 'rgb(52, 113, 95)', type + ': selected band is #34715F'); assert.strictEqual(s.hlStroke, 'rgb(27, 224, 158)', type + ': selected boundary is mint');
      // selected + hover: still selected, band slightly brighter
      await move(pt.x, pt.y);
      const sh = await snap();
      assert.ok(sh.hlSelect >= 1 && sh.bandFill !== s.bandFill, `${type}: selected+hover is selected with a brighter band`);
      await click(away.x, away.y);
      await waitFor(`document.querySelectorAll('#prepare-canvas .sk-band').length === 0`, type + ' deselected'); // deselect (click on empty space)
      const after = await snap();
      assert.deepStrictEqual([after.bands, after.chips, after.hlSelect], [0, 0, 0], type + ': back to idle after deselect');
    }
    // the dashes of an On Line are BLACK (on its mint line); the other types' dashes are the near-white token
    await click(targets.online.x, targets.online.y); await move(away.x, away.y);
    assert.strictEqual(await evalJs(`getComputedStyle(document.querySelector('#prepare-canvas .sk-tp-online')).stroke`), 'rgb(0, 0, 0)', 'on line: black dashes');
    await click(away.x, away.y); await click(targets.outside.x, targets.outside.y); await move(away.x, away.y);
    assert.strictEqual(await evalJs(`getComputedStyle(document.querySelector('#prepare-canvas .sk-travel')).stroke`), 'rgb(203, 218, 214)', 'outside: near-white tool path');
    // a Guide is a line only: hovering/selecting draws NO band, dashes or chip
    await click(away.x, away.y);
    await move(targets.guide.x, targets.guide.y);
    let g = await snap(); assert.deepStrictEqual([g.bands, g.tp, g.chips], [0, 0, 0], 'guide hover: line only');
    await click(targets.guide.x, targets.guide.y); await move(away.x, away.y);
    g = await snap(); assert.deepStrictEqual([g.bands, g.tp, g.chips], [0, 0, 0], 'guide selected: no band / dashes / chip'); assert.ok(g.hlSelect >= 1, 'guide selected: mint line');

    // ── 3. the cut card look + its type list ──
    await click(targets.outside.x, targets.outside.y);
    const card = await evalJs(`(() => { const c = getComputedStyle(document.querySelector('.cut-card')); const f = getComputedStyle(document.querySelector('.cut-box')); const l = document.querySelector('.cut-field-label');
      return { bg: c.backgroundColor, radius: c.borderRadius, field: f.backgroundColor, labelCase: getComputedStyle(l).textTransform, dPrefix: !!document.querySelector('.cut-dia-prefix'), presets: [...document.querySelectorAll('.cut-preset')].map((b) => b.textContent) }; })()`);
    assert.strictEqual(card.bg, 'rgb(10, 10, 11)'); assert.strictEqual(card.field, 'rgb(42, 43, 45)'); assert.strictEqual(card.labelCase, 'lowercase'); assert.ok(card.dPrefix);
    assert.deepStrictEqual(card.presets, ['.02', '⅛', '¼', '½']);
    const popOpen = (sel) => waitFor(`(() => { const e = document.querySelector('${sel}'); return !!e && !e.hidden && getComputedStyle(e).display !== 'none'; })()`, sel + ' open');
    const planHas = (cond) => waitFor(`import('/apps/shaper/src/cut-plan.js').then(({ CUT_PLAN }) => [...CUT_PLAN.values()].some((r) => r.cutType === 'exterior' && (${cond})))`, 'exterior cut record: ' + cond);
    await clickEl('.cut-type-trigger'); await popOpen('.cut-type-menu');
    const typeRows = await evalJs(`[...document.querySelectorAll('.cut-type-opt')].map((o) => ({ id: o.dataset.id, icon: !!o.querySelector('svg.cut-ic'), current: o.classList.contains('is-current'), disabled: o.classList.contains('is-disabled') }))`);
    assert.ok(typeRows.every((o) => o.icon), 'every type row has an icon');
    assert.deepStrictEqual(typeRows.filter((o) => o.current).map((o) => o.id), ['exterior'], 'the current type is highlighted');
    // ── 4. TASK 455 amendments: hover boundary, chip rides the path, popovers to the LEFT, offset presets, cutter shape ──
    const rectOf = (sel) => evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2 }; })()`);
    const planRec = (kind, idx) => evalJs(`(async () => { const { CUT_PLAN } = await import('/apps/shaper/src/cut-plan.js'); return JSON.stringify([...CUT_PLAN.entries()]); })()`).then((j) => JSON.parse(j));
    await click(away.x, away.y);
    // hover boundary: bold white #F6F7F9, 3px
    await move(targets.outside.x, targets.outside.y);
    assert.strictEqual(await evalJs(`getComputedStyle(document.querySelector('#prepare-canvas .sk-hl-hover-cut')).stroke`), 'rgb(246, 247, 249)', 'hover boundary is #F6F7F9');
    assert.strictEqual(await evalJs(`getComputedStyle(document.querySelector('#prepare-canvas .sk-hl-hover-cut')).strokeWidth`), '3px', 'hover boundary ~3px');
    // the depth chip rides the tool path nearest the cursor and FOLLOWS it
    const topPt = await world(20, 3), botPt = await world(20, 37);
    await move(topPt.x, topPt.y); const chipTop = await rectOf('#prepare-canvas .sk-chip-bg');
    await move(botPt.x, botPt.y); const chipBot = await rectOf('#prepare-canvas .sk-chip-bg');
    assert.ok(chipBot.cy - chipTop.cy > 60, `the chip follows the cursor along the path (y ${chipTop.cy} -> ${chipBot.cy})`);
    // selected, not hovered: the chip STAYS at its last spot
    await click(botPt.x, botPt.y); await move(away.x, away.y);
    const chipStay = await rectOf('#prepare-canvas .sk-chip-bg');
    assert.ok(Math.abs(chipStay.cy - chipBot.cy) < 2, 'selected but not hovered: the chip stays at its last spot');

    // the selected target is the outside rect: open the cut card popovers
    const cardR = await rectOf('.cut-card');
    await clickEl('.cut-type-trigger'); await popOpen('.cut-type-menu');
    const pm = await rectOf('.cut-type-menu');
    assert.ok(pm.right <= cardR.left, 'the cut-type popover opens to the LEFT of the card');
    assert.strictEqual(await evalJs(`getComputedStyle(document.querySelector('.cut-type-menu')).borderTopColor`), 'rgb(44, 101, 255)', 'blue popover border');
    // the chevron rotates with a 0.12s CSS transition: wait for the settled transform, never read it mid-transition
    await waitFor(`getComputedStyle(document.querySelector('.cut-type-trigger .cut-caret')).transform === 'matrix(-1, 0, 0, -1, 0, 0)'`, 'the chevron flips while open');
    assert.strictEqual(await evalJs(`getComputedStyle(document.querySelector('.cut-type-opt.is-current')).backgroundColor`), 'rgb(24, 46, 109)', 'the current type row is filled #182E6D');
    await clickEl('.cut-type-trigger'); await waitFor(`document.querySelector('.cut-type-menu').hidden === true`, 'cut-type menu closed');
    assert.strictEqual(await evalJs(`document.querySelector('.cut-type-menu').hidden`), true, 'clicking again closes it');

    // offset: focus selects the value and opens the 3x2 presets popover to the left
    await clickEl('.cut-offset'); await popOpen('.cut-offset-pop');
    const op = await rectOf('.cut-offset-pop');
    assert.ok(op && op.right <= cardR.left, 'offset presets open to the LEFT');
    const labels = await evalJs(`[...document.querySelectorAll('.cut-offset-pop .cut-preset')].map((b) => b.textContent)`);
    assert.deepStrictEqual(labels, ['.001', '.005', '.01', '1/32', '1/16', '1/8'], 'offset presets (inches)');
    assert.strictEqual(await evalJs(`(() => { const i = document.querySelector('.cut-offset'); return i.selectionStart === 0 && i.selectionEnd === i.value.length && i.value.length > 0; })()`), true, 'the offset value is selected on focus');
    assert.strictEqual(await evalJs(`getComputedStyle(document.querySelector('.cut-offset-pop')).display`) !== 'none', true);
    const eighth = await rectOf('.cut-offset-pop .cut-preset:nth-child(6)');
    await click(Math.round(eighth.cx), Math.round(eighth.cy));
    await planHas('Math.abs(r.cutOffset - 3.175) < 1e-9');
    let plan = await planRec();
    const outsideRec = plan.map(([, r]) => r).find((r) => r.cutType === 'exterior');
    assert.ok(Math.abs(outsideRec.cutOffset - 3.175) < 1e-9, 'picking 1/8 stores 3.175 mm as the offset');

    // bit diameter: the preset matching the value is filled
    assert.strictEqual(await evalJs(`getComputedStyle(document.querySelector('.cut-presets .cut-preset.is-active')).backgroundColor`), 'rgb(24, 46, 109)', 'the active bit preset is #182E6D');
    assert.strictEqual(await evalJs(`document.querySelector('.cut-presets .cut-preset.is-active').textContent`), '¼', '0.250 in -> the 1/4 preset');

    // cutter shape: the row sits below bit diameter; popover to the left with flat / ball / V-bit (+ the V-bit angle presets)
    const order = await evalJs(`[...document.querySelectorAll('.cut-rows .cut-row')].map((r) => r.dataset.param || r.dataset.row)`);
    assert.deepStrictEqual(order, ['cutDepth', 'cutOffset', 'toolDia', 'cutterShape'], 'cutter shape is directly below bit diameter');
    await clickEl('.cut-shape-trigger'); await popOpen('.cut-shape-pop');
    const sp = await rectOf('.cut-shape-pop');
    assert.ok(sp && sp.right <= cardR.left, 'cutter shape popover opens to the LEFT');
    assert.deepStrictEqual(await evalJs(`[...document.querySelectorAll('.cut-shape-pop .cut-type-opt')].map((o) => o.dataset.shape)`), ['endmill', 'ballnose', 'vbit']);
    assert.strictEqual(await evalJs(`document.querySelectorAll('.cut-shape-pop .cut-shape-angles').length`), 0, 'V-bit angles appear only when V-bit is chosen');
    await clickEl('.cut-shape-pop .cut-type-opt[    data-shape="ballnose"]');
        await planHas(`r.cutterShape === 'ballnose'`);
        plan = await planRec();
        assert.strictEqual(plan.map(([, r]) => r).find((r) => r.cutType === 'exterior').cutterShape, 'ballnose', 'cutterShape is stored on the cut record');
        await clickEl('.cut-shape-trigger'); await popOpen('.cut-shape-pop');
        await clickEl('.cut-shape-pop .cut-type-opt[data-shape="vbit"]'); await waitFor(`!!document.querySelector('.cut-shape-pop .cut-shape-angles')`, 'V-bit angles shown'); // stays open and now shows its angles
    assert.deepStrictEqual(await evalJs(`[...document.querySelectorAll('.cut-shape-pop .cut-shape-angles .cut-preset')].map((b) => b.textContent)`), ['90°', '60°', '45°', '30°', '20°'], 'the V-bit angles are the existing VBIT_PRESETS');
    await clickEl('.cut-shape-pop .cut-shape-angles .cut-preset[data-angle="60"]');
    await planHas('r.cutterAngle === 60');
    plan = await planRec();
    const rec = plan.map(([, r]) => r).find((r) => r.cutType === 'exterior');
    assert.deepStrictEqual([rec.cutterShape, rec.cutterAngle], ['vbit', 60], 'a V-bit angle comes from VBIT_PRESETS');
    assert.strictEqual(await evalJs(`document.querySelector('.cut-shape-cur').textContent`), 'V-bit 60°');

    // the cutter shape is NEVER exported: the Shaper SVG has no attribute for it (byte-identical export)
    {
      const { exportShaperSVG } = await import('#core/shaper-export.js');
      const { findLoops } = await import('#core/loop-finder.js');
      const st = { joints: new Map([['a', { x: 0, y: 0 }], ['b', { x: 40, y: 0 }], ['c', { x: 40, y: 20 }], ['d', { x: 0, y: 20 }]]), shapes: [['s1', 'a', 'b'], ['s2', 'b', 'c'], ['s3', 'c', 'd'], ['s4', 'd', 'a']].map(([id, p, q]) => ({ id, type: 'line', joints: [p, q] })), constraints: [] };
      const loop = findLoops(st)[0];
      const exp = (extra) => exportShaperSVG({ state: st, entries: [{ target: { kind: 'loop', id: loop.id }, rec: { cutType: 'exterior', cutDepth: 5, cutOffset: 0, toolDia: 3.175, ...extra } }], encoding: CUT_TYPES, docUnit: 'in' });
      assert.strictEqual(exp({ cutterShape: 'vbit', cutterAngle: 60 }), exp({}), 'cutterShape/cutterAngle never reach the export');
      assert.ok(!/cutter|vbit|ballnose/i.test(exp({ cutterShape: 'vbit', cutterAngle: 60 })));
    }
    console.log('prepare-look: ok');
  } finally {
    await cdp.close();
  }
})();
