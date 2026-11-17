// tests/bezier-loops-761-phone-live.test.js — TASK 761: the Bezier tool's closed outline is a region on the PHONE (Shaper, 390 x 844, touch; the page
// tools of tests/helpers/pocket-live.js):
//  1. Design: the ribbon's Bezier tool by taps: a tap (corner), a tap (corner), a one-finger DRAG (a smooth anchor), a tap back on the first anchor, the
//     tool ended by Select; TASK 762: that tap on the first anchor closed the outline (the two ends coincident); the page's findLoops: ONE loop of 3 beziers;
//  2. Prepare (from the drawer): a tap inside picks the region; Inside / Outside / Pocket are offered; Outside is taken (screenshots: the phone screen, and zoomed on the curve).
import assert from 'node:assert';
import path from 'node:path';
import { sleep } from './helpers/cdp-browser.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';

process.env.EVIDENCE_DIR = path.resolve('.evidence/761');
const { openPocketPage } = await import('./helpers/pocket-live.js');
const t = await openPocketPage({ tag: '761-phone', phone: true });
if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { send, evalJs, waitFor, openMode, clickWorld, clickEl, shot, shotWorld } = t;
const ST = 'window.__designController.state';
const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: Math.round(p.x), y: Math.round(p.y), id: i + 1, radiusX: 1, radiusY: 1, force: 1 })) });
const tap = async (p) => { await T('touchStart', [p]); await sleep(70); await T('touchEnd', []); await sleep(450); };
const swipe = async (a, b, steps = 8) => { await T('touchStart', [a]); await sleep(60); for (let i = 1; i <= steps; i++) { await T('touchMove', [{ x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps }]); await sleep(30); } await T('touchEnd', []); await sleep(450); };
const out = {};
try {
  await openMode('design');
  await waitFor(`document.getElementById('design-canvas').getBoundingClientRect().width > 0 && !!window.__designController`, 'Design shown');
  await evalJs(`(() => { const st = ${ST}; for (const k of [...st.joints.keys()]) if (k !== 'j_origin') st.joints.delete(k); st.shapes.length = 0; st.constraints.length = 0; st.saveState('clear'); })()`);
  const c = await evalJs(`(() => { const r = document.getElementById('design-canvas').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  const A = { x: c.x - 110, y: c.y + 80 }, B = { x: c.x + 110, y: c.y + 80 }, C = { x: c.x, y: c.y - 90 };
  await pressRibbonTool(evalJs, tap, 'tool-bezier');
  await tap(A);
  await tap(B);
  await swipe(C, { x: C.x - 90, y: C.y });
  await tap(A);
  await pressRibbonTool(evalJs, tap, 'tool-select');
  out.drawn = await evalJs(`${ST}.shapes.map((s) => s.type)`);
  assert.deepStrictEqual(out.drawn, ['bezier', 'bezier', 'bezier'], '1: three beziers drawn by touch');
  out.added = await evalJs(`${ST}.constraints.map((k) => k.type)`);
  assert.deepStrictEqual(out.added, ['coincident'], '1: the tap back on the first anchor closed the outline (TASK 762): the two ends coincident');
  const L = await evalJs(`Promise.all([import('/packages/core/loop-finder.js'), import('/packages/core/loop-geometry.js')]).then(([F, G]) => { const st = ${ST}, by = new Map(st.shapes.map((s) => [s.id, s]));
    return F.findLoops(st).map((l) => { const p = G.loopPolygon(l, st, by); const cx = p.reduce((s, q) => s + q.x, 0) / p.length, cy = p.reduce((s, q) => s + q.y, 0) / p.length; return { kinds: l.edges.map((e) => by.get(e).type), inner: G.pointInPolygon(p, { x: cx, y: cy }) ? { x: cx, y: cy } : null, box: p.reduce((b, q) => [Math.min(b[0], q.x), Math.min(b[1], q.y), Math.max(b[2], q.x), Math.max(b[3], q.y)], [Infinity, Infinity, -Infinity, -Infinity]) }; }); })`);
  out.loops = L.map((l) => l.kinds);
  assert.deepStrictEqual(out.loops, [['bezier', 'bezier', 'bezier']], '1: ONE loop of the three beziers');
  await openMode('prepare');
  await waitFor(`document.querySelectorAll('#prepare-world-group path[data-shape-id]').length === 3`, '2: Prepare draws the bezier edges');
  await clickWorld(L[0].inner.x, L[0].inner.y);
  await waitFor(`!document.querySelector('.cut-card').hidden`, '2: a tap inside picks the region');
  await clickEl('#prepare-panel .cut-type-trigger');
  await waitFor(`!document.querySelector('.cut-type-menu').hidden`, 'the type menu');
  out.menu = await evalJs(`Object.fromEntries([...document.querySelectorAll('.cut-type-menu .cut-type-opt')].map((o) => [o.dataset.id, !o.disabled]))`);
  assert.deepStrictEqual([out.menu.interior, out.menu.exterior, out.menu.pocket], [true, true, true], '2: Inside / Outside / Pocket offered on the phone');
  await clickEl('.cut-type-opt[data-id="exterior"]');
  await waitFor(`document.querySelector('.cut-type-cur').textContent === 'Outside'`, '2: Outside taken');
  await sleep(300);
  await shot('phone-prepare-bezier-outside.png');
  const b = L[0].box;
  await shotWorld('phone-prepare-bezier-outside-zoom.png', [b[0] - 3, b[1] - 3, b[2] + 3, b[3] + 3], 2);
  console.log(`bezier-loops-761-phone-live: ALL CHECKS PASSED ${JSON.stringify(out)}`);
} finally { await t.close(); }
