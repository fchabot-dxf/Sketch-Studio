// tests/cut-offset-types.test.js — TASK 450 + 450b + 456 (cut params per type; On Line shows/writes an offset but the preview ignores it): On line and Guide take NO offset (Shaper: offsets are not an option for On Line;
// Guide is uncuttable). Declared on CUT_TYPES (offset:false); read by the cut card, the export and the preview. Not migrated.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { exportShaperSVG } from '#core/shaper-export.js';
import { CUT_TYPES, cutTypeHasParam, effectiveCutRecord } from '../apps/shaper/src/shaper.js';
import { launchBrowser, sendRealKey, sleep } from './helpers/cdp-browser.js';

await (async () => {
  const cdp = await launchBrowser({ tag: '450' });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;

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
    const stageTab = (name) => clickEl(`.stage-btn[data-stage="${name}"]`);
    // ── declaration + export + preview (pure) ──
    const ALL3 = ['cutDepth', 'cutOffset', 'toolDia'];
    const decl = Object.fromEntries(CUT_TYPES.map((t) => [t.id, t.params]));
    assert.deepStrictEqual(decl, { exterior: ALL3, interior: ALL3, pocket: ALL3, online: ALL3, guide: ALL3, stock: ['cutDepth'] }, 'ONE params declaration per cut type (TASK 472: Stock has only the thickness row)');
    assert.ok(cutTypeHasParam('exterior', 'cutOffset') && cutTypeHasParam('online', 'cutOffset') && cutTypeHasParam('online', 'toolDia') && cutTypeHasParam('guide', 'cutDepth') && cutTypeHasParam('guide', 'cutOffset') && cutTypeHasParam('guide', 'toolDia'), 'guide keeps all three (Studio allows it)');
    assert.ok(cutTypeHasParam(null, 'cutOffset'), 'no type chosen yet: nothing hidden');
    assert.deepStrictEqual(effectiveCutRecord({ cutType: 'guide', cutDepth: 5, cutOffset: 2, toolDia: 6 }), { cutType: 'guide', cutDepth: 5, cutOffset: 2, toolDia: 6, autoOffset: 0 }, 'a guide keeps its params (and has no automatic offset)');
    assert.strictEqual(effectiveCutRecord({ cutType: 'online', cutOffset: 2, cutDepth: 5, toolDia: 6 }).cutOffset, 0, 'on line: the PREVIEW ignores the offset (offsetMovesCut:false, Studio keeps the band centred)');
    assert.strictEqual(CUT_TYPES.find((t) => t.id === 'online').offsetMovesCut, false);
    assert.deepStrictEqual(CUT_TYPES.filter((t) => t.offsetMovesCut === false).map((t) => t.id), ['online']);
    assert.strictEqual(effectiveCutRecord({ cutType: 'online', cutOffset: 2, cutDepth: 5, toolDia: 6 }).toolDia, 6, 'on line keeps the bit');
    assert.strictEqual(effectiveCutRecord({ cutType: 'exterior', cutOffset: 2, cutDepth: 5, toolDia: 6 }).cutOffset, 2, 'outside keeps its offset');
    {
      const state = { joints: new Map([['a', { x: 0, y: 0 }], ['b', { x: 40, y: 0 }], ['c', { x: 40, y: 20 }], ['d', { x: 0, y: 20 }]]),
        shapes: [['s1', 'a', 'b'], ['s2', 'b', 'c'], ['s3', 'c', 'd'], ['s4', 'd', 'a']].map(([id, p, q]) => ({ id, type: 'line', joints: [p, q] })), constraints: [] };
      const { findLoops } = await import('#core/loop-finder.js');
      const loop = findLoops(state)[0];
      const exp = (cutType, extra = {}) => exportShaperSVG({ state, entries: [{ target: { kind: 'loop', id: loop.id }, rec: { cutType, cutDepth: 5, cutOffset: 1.5, toolDia: 3.175, ...extra } }], encoding: CUT_TYPES, docUnit: 'mm' });
      const attrs = (svg) => ['cutDepth', 'cutOffset', 'toolDia'].filter((k) => svg.includes('shaper:' + k));
      assert.deepStrictEqual(attrs(exp('guide')), ['cutDepth', 'cutOffset', 'toolDia'], 'Guide keeps and exports all three (the type may be changed on the tool later)');
      assert.deepStrictEqual(attrs(exp('online')), ['cutDepth', 'cutOffset', 'toolDia'], 'On line: all three (Studio shows and writes an offset on On Line)');
      assert.ok(exp('online').includes('shaper:cutOffset="1.500 mm"'), 'On line writes its offset');
      for (const t of ['exterior', 'interior', 'pocket']) assert.deepStrictEqual(attrs(exp(t)), ['cutDepth', 'cutOffset', 'toolDia'], t + ' writes all three');
    }

    // ── the cut card in the real app (real clicks): Offset row hidden for On line / Guide, shown for Outside / Inside / Pocket ──
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 8000);
    await waitFor(`!!document.querySelector('[data-mode="design"]')`, 'shaper app ready');
    await clickEl('[data-mode="design"]');
    await waitFor('!!(window.__designController && window.__designController.state)', 'design controller ready');
    await evalJs(`(() => {
      const st = window.__designController.state;
      for (const k of [...st.joints.keys()]) st.joints.delete(k);
      st.shapes.length = 0; st.constraints.length = 0;
      const J = (id, x, y) => st.joints.set(id, { x, y });
      J('a', 0, 0); J('b', 60, 0); J('c', 60, 40); J('d', 0, 40);
      [['s1','a','b'],['s2','b','c'],['s3','c','d'],['s4','d','a']].forEach(([id, p, q]) => st.shapes.push({ id, type: 'line', joints: [p, q] }));
    })()`);
    await clickEl('[data-mode="prepare"]');
    await waitFor(`(() => { const s = document.getElementById('prepare-canvas'); return !!s && s.getClientRects().length > 0 && !!s.getScreenCTM(); })()`, 'prepare canvas visible');
    const inside = await evalJs(`(() => { const s = document.getElementById('prepare-canvas'); const p = s.createSVGPoint(); p.x = 30; p.y = 20; const q = p.matrixTransform(s.getScreenCTM()); return { x: Math.round(q.x), y: Math.round(q.y) }; })()`);
    await click(inside.x, inside.y); // select the loop
    const rowsShown = () => evalJs(`[...document.querySelectorAll('.cut-row[data-param]')].filter((r) => getComputedStyle(r).display !== 'none').map((r) => r.dataset.param)`);
    const shown = {};
    for (const [typeId, label] of [['online', 'On line'], ['guide', 'Guide'], ['interior', 'Inside'], ['pocket', 'Pocket'], ['exterior', 'Outside']]) {
      await clickEl('.cut-type-trigger');
      await waitFor(`!document.querySelector('.cut-type-menu').hidden`, 'cut type menu open');
      await clickEl(`.cut-type-opt[data-id="${typeId}"]`);
      await waitFor(`document.querySelector('.cut-type-menu').hidden`, 'cut type menu closed');
      shown[typeId] = await rowsShown();
      console.log(`${label}: rows ${JSON.stringify(shown[typeId])}`);
      if (process.env.EVIDENCE_DIR) { const sh = await send('Page.captureScreenshot', { format: 'png', clip: { x: 1200, y: 50, width: 300, height: 380, scale: 1.5 } }); fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, `card-${typeId}.png`), Buffer.from(sh.data, 'base64')); }
    }
    assert.deepStrictEqual(shown, { online: ALL3, guide: ALL3, interior: ALL3, pocket: ALL3, exterior: ALL3 }, 'card rows follow the params declaration (Guide shows all three)');
    console.log('cut-offset-types: ok');
  } finally {
    await cdp.close();
  }
})();
