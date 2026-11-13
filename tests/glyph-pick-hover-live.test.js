// tests/glyph-pick-hover-live.test.js -- TASK 588 in the REAL SketchStudio (headless, REAL mouse and keys via CDP): THE glyph pick and its look.
// Owner, 2026-11-13: two clicks on a rectangle's vertical edge, 14.3 and 15.9 px from its V glyph, selected the glyph, never the line (the left
// click took any visible glyph within 24 px). Now left click, hover and right click share ONE rule (hover-manager glyphAt): a glyph is picked
// only when the pointer is ON the glyph as drawn (+ 3 px), and HOVER = CLICK (hover-manager selectPick).
//  1. fusion glyph style (the icon, 10 px radius): the line 15 px from the glyph centre hovers BLUE and a click selects the LINE; a double
//     click there selects the rectangle's chain.
//  2. the glyph hovered: the glyph (a filled warm halo behind the icon) and the lines its constraint binds light in the glyph-hover colour (--sk-glyph-hover), no line in blue
//     (--sk-selection); a click selects the CONSTRAINT: the glyph and its lines in --sk-glyph-selected, no blue.
//  3. badge glyph style (the 32 px disc): the line 21 px from the glyph centre (off the disc, in the old 24 px reach) selects the LINE.
// The V glyph sits close beside its line, as in the owner's drawing: GLYPH_OFFSET_PX 16 puts it about 14 px off the line (svg-renderer's fan).
// Screenshots (EVIDENCE_DIR, when set): the line hovered, the glyph hovered, the glyph selected.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';

const J = (x, y) => ({ x, y, fixed: false, sketchId: 'sketch-1' });
const DOC = { version: 3, hosts: {}, geometry: {
  joints: [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }], ['r1', J(10, 10)], ['r2', J(50, 10)], ['r3', J(50, 40)], ['r4', J(10, 40)]],
  shapes: [['rE1', 'r1', 'r2'], ['rE2', 'r2', 'r3'], ['rE3', 'r3', 'r4'], ['rE4', 'r4', 'r1']]
    .map(([id, a, b]) => ({ id, type: 'line', joints: [a, b], sketchId: 'sketch-1', isConstruction: false })),
  constraints: [{ type: 'horizontal', joints: ['r1', 'r2'] }, { type: 'vertical', joints: ['r2', 'r3'] }, { type: 'horizontal', joints: ['r3', 'r4'] }, { type: 'vertical', joints: ['r4', 'r1'] }],
  sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }], activeSketchId: 'sketch-1', groups: [], profiles: [], parameters: [], vcarves: [] } };
const EDGES = ['rE1', 'rE2', 'rE3', 'rE4'];
const BOUND = ['rE1', 'rE2', 'rE3']; // the lines with an end on r2 / r3, which the V constraint binds (geometry-labels constraintTargets)

await (async () => {
  const cdp = await launchBrowser({ tag: '588g' });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, navigate, waitForApp } = cdp;
  const md5s = [], out = [];
  try {
    const url = `http://127.0.0.1:${port}/apps/sketchstudio/index.html`;
    const mouse = (type, x, y, buttons, clickCount) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : (clickCount || 1) });
    // per line: its colour token (the var() its stroke uses); the V glyph's centre (world) and the tokens its markup uses; the canvas transform
    const geo = () => evalJs(`(() => { const ls = {}; const m = document.querySelector('#svgCanvas .shape-elem').getScreenCTM();
      const tok = (s) => ((s || '').match(/var\\((--sk-[a-z-]+)/) || [])[1] || null;
      for (const e of document.querySelectorAll('#svgCanvas line.shape-elem')) ls[e.dataset.shapeId] = tok(e.getAttribute('style'));
      const g = document.querySelector('#svgCanvas g.constraint-glyph[data-ctype="vertical"][data-cj0="r2"]');
      const t = g && (g.getAttribute('transform') || '').match(/translate\\(([-0-9.e]+),([-0-9.e]+)\\)/);
      // the halo: the filled circle(s) drawn right before the glyph, at its centre (the fusion style's hover / selected halo)
      const halo = []; for (let e = g && g.previousElementSibling; e && e.tagName === 'circle'; e = e.previousElementSibling) halo.push(e.outerHTML);
      const glyphToks = g ? [...new Set((g.outerHTML + halo.join('')).match(/--sk-glyph-(hover|selected)/g) || [])] : [];
      const haloToks = [...new Set(halo.filter((h) => h.includes('fill:var(--sk-glyph')).join('').match(/--sk-glyph-(hover|selected)/g) || [])];
      const lineX = (() => { const e = document.querySelector('#svgCanvas line.shape-elem[data-shape-id="rE2"]'); return +e.getAttribute('x1'); })();
      return JSON.stringify({ ls, glyph: t ? [+t[1], +t[2]] : null, glyphToks, haloToks, lineX, m: [m.a, m.b, m.c, m.d, m.e, m.f] }); })()`).then(JSON.parse);
    const toS = (g, x, y) => ({ x: g.m[0] * x + g.m[2] * y + g.m[4], y: g.m[1] * x + g.m[3] * y + g.m[5] });
    const blueLines = (g) => Object.keys(g.ls).filter((id) => g.ls[id] === '--sk-selection' || g.ls[id] === '--sk-hover').sort();
    const linesIn = (g, token) => Object.keys(g.ls).filter((id) => g.ls[id] === token).sort();
    // a 200 x 140 px crop around the glyph centre G, at 3x
    const shot = async (name, G) => {
      const clip = { x: G.x - 110, y: G.y - 70, width: 200, height: 140, scale: 3 };
      const r = await send('Page.captureScreenshot', { format: 'png', clip });
      const buf = Buffer.from(r.data, 'base64');
      if (process.env.EVIDENCE_DIR) fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name), buf);
      md5s.push(name + '=' + createHash('md5').update(buf).digest('hex'));
    };
    // empty canvas near its top-left corner (not over a panel: the Design panel's rows hover their constraint too)
    const away = async () => { const p = await evalJs(`(() => { const r = document.getElementById('svgCanvas').getBoundingClientRect(); return { x: Math.round(r.left + 60), y: Math.round(r.top + 60) }; })()`); await mouse('mouseMoved', p.x, p.y, 0); await sleep(250); };
    const clearSel = async (g) => { await away(g); await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(700); };
    const open = async (style) => {
      await navigate(url, 8000); await waitForApp('svgCanvas');
      await evalJs(`(async () => { localStorage.clear(); localStorage.setItem('sketch-studio-settings', JSON.stringify({ GRID_MAGNETISM: 0.001, GLYPH_OFFSET_PX: 16, GLYPH_STYLE: '${style}' })); const dbs = indexedDB.databases ? await indexedDB.databases() : []; await Promise.all(dbs.map(d => new Promise(r => { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = () => r(); }))); return true; })()`);
      await navigate(url, 8000); await waitForApp('svgCanvas');
      await evalJs(`import('/packages/ui/project-store.js').then(async (m) => { const s = m.getProjectStore(); const d = await s.newDesign('Task 588 glyph', { app: 'sketchstudio' }); await s.save(${JSON.stringify(DOC)}, { app: 'sketchstudio', id: d.id }); return d.id; })`);
      await navigate(url, 8000); await waitForApp('svgCanvas'); await sleep(600);
      await evalJs(`document.getElementById('tool-select').click()`); await sleep(150);
      const g = await geo();
      assert.ok(g.glyph, 'the V glyph of rE2 is drawn');
      const G = toS(g, ...g.glyph), Lx = toS(g, g.lineX, g.glyph[1]).x;
      const h = Math.abs(G.x - Lx);
      // the point of the line rE2 at distance d px from the glyph centre (pointer events land on whole pixels: d is re-measured)
      const at = (d) => { const p = { x: Math.round(Lx), y: Math.round(G.y + Math.sqrt(Math.max(0, d * d - h * h))) }; p.d = Math.hypot(p.x - G.x, p.y - G.y); return p; };
      return { g, G: { x: Math.round(G.x), y: Math.round(G.y) }, h, at };
    };

    // ---- 1 / 2: fusion style (the owner's case)
    {
      const { g, G, h, at } = await open('fusion');
      assert.ok(h < 15, 'the glyph sits close beside its line (' + h.toFixed(1) + ' px)');
      const p = at(15);
      out.push(`fusion: glyph ${h.toFixed(1)} px beside rE2, pointer ${p.d.toFixed(1)} px from its centre`);
      assert.ok(p.d > 13 && p.d < 17, 'the pointer is 14-16 px from the glyph centre, off the glyph (' + p.d + ')');
      await mouse('mouseMoved', p.x, p.y, 0); await sleep(300);
      let s = await geo();
      out.push(`1. line hovered beside the glyph: blue lines [${blueLines(s).join(' ')}], glyph tokens [${s.glyphToks.join(' ')}]`);
      assert.deepStrictEqual(blueLines(s), ['rE2'], 'hovering the line beside its glyph lights the LINE in blue');
      assert.deepStrictEqual(s.glyphToks, [], 'and not the glyph');
      await shot('588-hover-line.png', G);
      await mouse('mousePressed', p.x, p.y, 1, 1); await sleep(60); await mouse('mouseReleased', p.x, p.y, 0, 1); await sleep(200);
      await away(g); s = await geo();
      out.push(`   click there: selected (blue) [${blueLines(s).join(' ')}], glyph tokens [${s.glyphToks.join(' ')}]`);
      assert.deepStrictEqual(blueLines(s), ['rE2'], 'the click selects the LINE');
      assert.deepStrictEqual(s.glyphToks, [], 'not the glyph');
      // a double click there: the chain
      await clearSel(g);
      await mouse('mouseMoved', p.x, p.y, 0); await sleep(120);
      await mouse('mousePressed', p.x, p.y, 1, 1); await sleep(60); await mouse('mouseReleased', p.x, p.y, 0, 1); await sleep(90);
      await mouse('mousePressed', p.x, p.y, 1, 2); await sleep(60); await mouse('mouseReleased', p.x, p.y, 0, 2); await sleep(200);
      await away(g); s = await geo();
      out.push(`   double click there: selected [${blueLines(s).join(' ')}]`);
      assert.deepStrictEqual(blueLines(s), EDGES, 'a double click on the line beside its glyph selects the chain');
      // 2. the glyph hovered, then clicked
      await clearSel(g);
      await mouse('mouseMoved', G.x, G.y, 0); await sleep(300);
      s = await geo();
      out.push(`2. glyph hovered: glyph tokens [${s.glyphToks.join(' ')}], halo [${s.haloToks.join(' ')}], lines in glyph-hover [${linesIn(s, '--sk-glyph-hover').join(' ')}], blue [${blueLines(s).join(' ')}]`);
      assert.deepStrictEqual(s.glyphToks, ['--sk-glyph-hover'], 'the hovered glyph is lit in the glyph-hover colour');
      assert.deepStrictEqual(s.haloToks, ['--sk-glyph-hover'], 'behind it a filled glyph-hover halo (not only the outline tint)');
      assert.deepStrictEqual(linesIn(s, '--sk-glyph-hover'), BOUND, 'the lines its constraint binds glow in the glyph-hover colour');
      assert.deepStrictEqual(blueLines(s), [], 'no line is blue');
      await shot('588-hover-glyph.png', G);
      await mouse('mousePressed', G.x, G.y, 1, 1); await sleep(60); await mouse('mouseReleased', G.x, G.y, 0, 1); await sleep(200);
      await away(g); s = await geo();
      out.push(`   click on it: glyph tokens [${s.glyphToks.join(' ')}], halo [${s.haloToks.join(' ')}], lines in glyph-selected [${linesIn(s, '--sk-glyph-selected').join(' ')}], blue [${blueLines(s).join(' ')}]`);
      assert.deepStrictEqual(s.glyphToks, ['--sk-glyph-selected'], 'the click selects the constraint: its glyph shows selected');
      assert.deepStrictEqual(s.haloToks, ['--sk-glyph-selected'], 'behind it a filled glyph-selected halo');
      assert.deepStrictEqual(linesIn(s, '--sk-glyph-selected'), BOUND, 'its lines in the glyph-selected colour');
      assert.deepStrictEqual(blueLines(s), [], 'no blue on its lines');
      await shot('588-selected-glyph.png', G);
    }

    // ---- 3: badge style: 21 px from the glyph centre (off the 16 px disc + 3, inside the old 24 px reach)
    {
      const { g, at } = await open('badge');
      const p = at(21);
      assert.ok(p.d > 19.5 && p.d < 23.5, 'the pointer is off the badge, inside the old 24 px reach (' + p.d + ')');
      await mouse('mouseMoved', p.x, p.y, 0); await sleep(300);
      let s = await geo();
      const hoverBlue = blueLines(s), hoverGlyph = s.glyphToks;
      await mouse('mousePressed', p.x, p.y, 1, 1); await sleep(60); await mouse('mouseReleased', p.x, p.y, 0, 1); await sleep(200);
      await away(g); s = await geo();
      out.push(`3. badge style, ${p.d.toFixed(1)} px from the glyph: hover blue [${hoverBlue.join(' ')}] glyph [${hoverGlyph.join(' ')}]; click selects [${blueLines(s).join(' ')}] glyph [${s.glyphToks.join(' ')}]`);
      assert.deepStrictEqual(hoverBlue, ['rE2'], 'badge style: the hover lights the line');
      assert.deepStrictEqual(blueLines(s), ['rE2'], 'badge style: the click selects the LINE');
      assert.deepStrictEqual(s.glyphToks, [], 'not the glyph');
    }
    console.log(out.join('\n'));
    console.log('screenshots ' + md5s.join(' '));
    console.log('glyph-pick-hover-live.test.js: ok');
  } catch (e) { console.log(out.join('\n')); throw e; } finally { await cdp.close(); }
})();
