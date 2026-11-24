// tests/bezier-loops-761-shaper-live.test.js — TASK 761: an outline drawn with the BEZIER tool is a real region in Shaper (desktop 1280 x 800, real mouse
// and keys; the page tools of tests/helpers/pocket-live.js):
//  1. DESIGN: the Bezier tool draws three curves (a corner, a smooth anchor dragged, back on the first anchor); TASK 762: the click on the first anchor
//     closes the outline (its two ends made coincident by the tool, as the Line tool does: the gap is 0) and ends the path; the page's own findLoops
//     returns ONE loop of the three beziers (screenshot);
//  2. PREPARE: a click inside picks the region; the type menu (TASK S3: the operations toolbar) offers Inside, Outside and Pocket; Pocket with the Spiral clearing (Loop on): its tool paths are
//     drawn, every point of them inside the curved region, some in the curve's bulge (screenshot, zoomed on the curve);
//  3. EXPORT (Loop off: the finish is the inside cut on the wall): the downloaded Shaper SVG writes the outline with a cubic `C` per bezier, the control points the shapes';
//     Export 3D builds; the pocket's footprint follows the curve (its ring has many vertices, not three chords) (screenshot).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { sleep, sendRealKey } from './helpers/cdp-browser.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';
import { REVIEW_BUILT } from './helpers/review-built.js'; // TASK 880: the 3D build is waited for through lastBuild (no build line on screen)

process.env.EVIDENCE_DIR = path.resolve('.evidence/761');
const { openPocketPage } = await import('./helpers/pocket-live.js');
const t = await openPocketPage({ tag: '761-shaper' });
if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { send, evalJs, waitFor, openMode, clickWorld, clickEl, pickType, pickClearing, setLoop, typeField, look, download, shot, shotWorld, EVIDENCE_DIR } = t;
const out = {};
const mouse = (type, p, buttons = 0, mods = 0) => send('Input.dispatchMouseEvent', { type, x: Math.round(p.x), y: Math.round(p.y), modifiers: mods, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
const click = async (p) => { await mouse('mouseMoved', p); await sleep(40); await mouse('mousePressed', p, 1); await sleep(40); await mouse('mouseReleased', p); await sleep(400); };
const drag = async (a, b, steps = 8) => { await mouse('mouseMoved', a); await sleep(40); await mouse('mousePressed', a, 1); await sleep(40); for (let i = 1; i <= steps; i++) { await mouse('mouseMoved', { x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps }, 1); await sleep(25); } await mouse('mouseReleased', b); await sleep(400); };
const key = (k, code, vk, mods = 0, text = '') => sendRealKey(send, k, code, vk, mods, text).then(() => sleep(350));
const ST = 'window.__designController.state';
const loopsInPage = () => evalJs(`Promise.all([import('/packages/core/loop-finder.js'), import('/packages/core/loop-geometry.js')]).then(([L, G]) => { const st = ${ST}, by = new Map(st.shapes.map((s) => [s.id, s]));
  return L.findLoops(st).map((l) => { const p = G.loopPolygon(l, st, by); const box = p.reduce((b, q) => [Math.min(b[0], q.x), Math.min(b[1], q.y), Math.max(b[2], q.x), Math.max(b[3], q.y)], [Infinity, Infinity, -Infinity, -Infinity]);
    return { id: l.id, kinds: l.edges.map((e) => by.get(e).type), poly: p, box }; }); })`);

try {
  // ── 1. Design: three beziers with the Bezier tool, closed on its first anchor ──
  await openMode('design');
  await waitFor(`document.getElementById('design-canvas').getBoundingClientRect().width > 0 && !!window.__designController`, 'Design shown');
  await evalJs(`(() => { const st = ${ST}; for (const k of [...st.joints.keys()]) if (k !== 'j_origin') st.joints.delete(k); st.shapes.length = 0; st.constraints.length = 0; st.saveState('clear'); })()`);
  const c = await evalJs(`(() => { const r = document.getElementById('design-canvas').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  const A = { x: c.x - 160, y: c.y + 90 }, B = { x: c.x + 160, y: c.y + 90 }, C = { x: c.x + 40, y: c.y - 110 }; // TASK 872: off the Y axis (an anchor on it now gets its point-on-line)
  // TASK 805 regression check: the cursor tooltip is installed in this page; the pointer resting on the canvas past its delay shows none and the drawing below is untouched
  await mouse('mouseMoved', c); await sleep(700);
  assert.strictEqual(await evalJs(`!!document.querySelector('#sk-cursor-tip:not([hidden])')`), false, '1: no tooltip over the drawing canvas');
  await pressRibbonTool(evalJs, click, 'tool-bezier');
  await click(A);                                   // a corner anchor
  await click(B);                                   // a corner: A -> B is a straight cubic
  await drag(C, { x: C.x - 130, y: C.y });          // a SMOOTH anchor: its handles horizontal
  await click(A);                                   // back on the first anchor: TASK 762, the tool closes the outline there and ends the path
  out.drawn = await evalJs(`${ST}.shapes.map((s) => s.type)`);
  assert.deepStrictEqual(out.drawn, ['bezier', 'bezier', 'bezier'], '1: the Bezier tool drew three beziers');
  out.ended = await evalJs(`!${ST}.active`);
  assert.ok(out.ended, '1: the closing click ended the path');
  await key('s', 'KeyS', 83, 0, 's');
  out.added = await evalJs(`${ST}.constraints.map((k) => k.type)`);
  assert.deepStrictEqual(out.added, ['coincident'], '1: the closing click made the two ends coincident (gap 0), no line');
  const loops = await loopsInPage();
  out.loops = loops.map((l) => l.kinds);
  assert.deepStrictEqual(out.loops, [['bezier', 'bezier', 'bezier']], '1: the page\'s findLoops returns ONE loop of the three beziers');
  const L = loops[0];
  const designClip = await evalJs(`(() => { const svg = document.getElementById('design-canvas'), m = svg.getScreenCTM(); const p = (x, y) => { const q = svg.createSVGPoint(); q.x = x; q.y = y; return q.matrixTransform(m); };
    const a = p(${L.box[0]}, ${L.box[1]}), b = p(${L.box[2]}, ${L.box[3]}); const x = Math.min(a.x, b.x) - 30, y = Math.min(a.y, b.y) - 30; return { x, y, width: Math.abs(b.x - a.x) + 60, height: Math.abs(b.y - a.y) + 60, scale: 2 }; })()`);
  const d1 = await send('Page.captureScreenshot', { format: 'png', clip: designClip });
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'shaper-design-bezier-outline.png'), Buffer.from(d1.data, 'base64'));
  console.log('screenshot ' + path.join(EVIDENCE_DIR, 'shaper-design-bezier-outline.png'));

  // ── 2. Prepare: the region, Pocket with the Spiral clearing ──
  await openMode('prepare');
  await waitFor(`!!document.getElementById('prepare-canvas').getScreenCTM() && document.querySelectorAll('#prepare-world-group path[data-shape-id]').length === 3`, 'Prepare draws the three bezier edges');
  const inner = await evalJs(`import('/packages/core/loop-geometry.js').then((G) => { const p = ${JSON.stringify(L.poly)}; const cx = p.reduce((s, q) => s + q.x, 0) / p.length, cy = p.reduce((s, q) => s + q.y, 0) / p.length; return G.pointInPolygon(p, { x: cx, y: cy }) ? { x: cx, y: cy } : null; })`);
  assert.ok(inner, '2: an inner point of the region');
  await clickWorld(inner.x, inner.y);
  await waitFor(`window.__prepareView.selectedTargets().length === 1`, '2: a click inside picks the region'); // TASK S3: a click shows no card; the toolbar makes the operation
  out.menu = await evalJs(`Object.fromEntries([...document.querySelectorAll('#prepare-ribbon [id^="op-type-"]')].map((o) => [o.id.slice(8), !o.disabled && !o.hidden]))`);
  assert.deepStrictEqual([out.menu.interior, out.menu.exterior, out.menu.pocket], [true, true, true], '2: Inside, Outside and Pocket are offered (the toolbar): ' + JSON.stringify(out.menu));
  await shot('shaper-prepare-type-menu.png', ['#prepare-ribbon'], 2);
  await clickEl('#op-type-pocket');
  await waitFor(`document.querySelector('.cut-type-cur').textContent === 'Pocket'`, 'Pocket picked');
  await typeField('.cut-depth', '6');
  await pickClearing('linked');
  await setLoop(true);
  out.look = await look();
  assert.ok(out.look.paths >= 1, '2: the Spiral clearing is drawn: ' + JSON.stringify(out.look));
  const pts = await evalJs(`[...document.querySelectorAll('#prepare-toolpath-group .sk-clear-path')].flatMap((p) => { const n = (p.getAttribute('d').match(/-?[\\d.]+(?:e-?\\d+)?/g) || []).map(Number); const o = []; for (let i = 0; i + 1 < n.length; i += 2) o.push({ x: n[i], y: n[i + 1] }); return o; })`);
  out.inside = await evalJs(`import('/packages/core/loop-geometry.js').then((G) => { const p = ${JSON.stringify(L.poly)}, q = ${JSON.stringify(pts)}; return [q.length, q.filter((x) => G.pointInPolygon(p, x)).length]; })`);
  assert.ok(out.inside[0] > 10 && out.inside[1] === out.inside[0], '2: every clearing path point is inside the curved region: ' + JSON.stringify(out.inside));
  await shotWorld('shaper-prepare-spiral-pocket.png', [L.box[0], L.box[1], L.box[2], L.box[3]], 2);

  // ── 3. Export: the cubic in the file; Export 3D follows the curve ──
  await setLoop(false); // Spiral, Loop off: open lines + the finish on the wall, the Origin's inside cut on the outline itself (with Loop on the finish is in the loops)
  const file = await download();
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'shaper-bezier-pocket-download.svg'), file);
  const ds = [...file.matchAll(/ d="([^"]*)"/g)].map((m) => m[1]);
  out.cubicPaths = ds.filter((d) => (d.match(/C /g) || []).length === 3).length;
  assert.ok(out.cubicPaths >= 1, '3: the download writes the outline with three cubic C segments (the beziers), not a polyline');
  const curves = await evalJs(`${ST}.shapes.map((s) => [s.c1, s.c2])`);
  const wall = ds.find((d) => (d.match(/C /g) || []).length === 3);
  const C3 = [...wall.matchAll(/C ([-\d. ]+)/g)].map((m) => m[1].trim().split(/\s+/).map(Number));
  const close = (a, b) => Math.abs(a - b) <= 1e-4 + 1e-9; // the file writes 4 decimals (#core num)
  out.controlsMatch = C3.every((v) => curves.some(([c1, c2]) => (close(v[0], c1[0]) && close(v[1], c1[1]) && close(v[2], c2[0]) && close(v[3], c2[1])) || (close(v[0], c2[0]) && close(v[1], c2[1]) && close(v[2], c1[0]) && close(v[3], c1[1]))));
  assert.ok(out.controlsMatch, '3: each C carries a bezier\'s control points (to the file\'s 4 decimals)');
  await openMode('review');
  if (await evalJs(`document.getElementById('review-view-3d').getAttribute('aria-pressed')`) !== 'true') await clickEl('#review-view-3d');
  await waitFor(REVIEW_BUILT, '3: Export 3D built', 20000);
  out.relief = await evalJs(`import('/apps/shaper/src/cut-plan.js').then((m) => m.planReliefItems(${ST}).map((i) => [i.cutType, Math.max(...i.footprints.flatMap((f) => (f.rings || []).map((r) => r.length)))]))`);
  assert.ok(out.relief.some(([, n]) => n >= 30), '3: the 3D model\'s footprints follow the curve (a ring of many vertices): ' + JSON.stringify(out.relief));
  await shot('shaper-export-3d-bezier-pocket.png', '#review-canvas-host');
  console.log(`bezier-loops-761-shaper-live: ALL CHECKS PASSED ${JSON.stringify(out)}`);
} finally { await t.close(); }
