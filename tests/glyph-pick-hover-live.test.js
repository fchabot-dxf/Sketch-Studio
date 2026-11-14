// tests/glyph-pick-hover-live.test.js -- TASK 588 in the REAL SketchStudio (headless, REAL mouse and keys via CDP): THE glyph pick and its look.
// Owner, 2026-11-13: two clicks on a rectangle's vertical edge, 14.3 and 15.9 px from its V glyph, selected the glyph, never the line (the left
// click took any visible glyph within 24 px). Now left click, hover and right click share ONE rule (hover-manager glyphAt): a glyph is picked
// only when the pointer is ON the drawn icon (its box + 2 px; task 603), and HOVER = CLICK (hover-manager selectPick).
//  1. the outlined glyph (the icon box): the line 15 px from the glyph centre hovers BLUE and a click selects the LINE; a double
//     click there selects the rectangle's chain.
//  2. the glyph hovered: the glyph (a filled warm halo behind the icon) and the lines its constraint binds light in the glyph-hover colour (--sk-glyph-hover), no line in blue
//     (--sk-selection); a click selects the CONSTRAINT: the glyph and its lines in --sk-glyph-selected, no blue.
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
    const geo = (ct = 'vertical', cj0 = 'r2', lineId = 'rE2') => evalJs(`(() => { const ls = {}; const m = document.querySelector('#svgCanvas .shape-elem').getScreenCTM();
      const tok = (s) => ((s || '').match(/var\\((--sk-[a-z-]+)/) || [])[1] || null;
      for (const e of document.querySelectorAll('#svgCanvas line.shape-elem')) ls[e.dataset.shapeId] = tok(e.getAttribute('style'));
      const g = document.querySelector('#svgCanvas g.constraint-glyph[data-ctype="${ct}"][data-cj0="${cj0}"]');
      const t = g && (g.getAttribute('transform') || '').match(/translate\\(([-0-9.e]+),([-0-9.e]+)\\)/);
      // the halo: the filled circle(s) drawn right before the glyph, at its centre (the hover / selected halo)
      const halo = []; for (let e = g && g.previousElementSibling; e && e.tagName === 'circle'; e = e.previousElementSibling) halo.push(e.outerHTML);
      const glyphToks = g ? [...new Set((g.outerHTML + halo.join('')).match(/--sk-glyph-(hover|selected)/g) || [])] : [];
      const haloToks = [...new Set(halo.filter((h) => h.includes('fill:var(--sk-glyph')).join('').match(/--sk-glyph-(hover|selected)/g) || [])];
      const lineX = (() => { const e = document.querySelector('#svgCanvas line.shape-elem[data-shape-id="${lineId}"]'); return +e.getAttribute('x1'); })();
      const lineY = (() => { const e = document.querySelector('#svgCanvas line.shape-elem[data-shape-id="${lineId}"]'); return +e.getAttribute('y1'); })();
      return JSON.stringify({ ls, glyph: t ? [+t[1], +t[2]] : null, glyphToks, haloToks, lineX, lineY, m: [m.a, m.b, m.c, m.d, m.e, m.f] }); })()`).then(JSON.parse);
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
    // a point of the CANVAS itself (what the browser hit-tests there is #svgCanvas or inside it: not a panel floating over it, whose rows
    // hover their constraint too) and away from the drawing (the shapes' and glyphs' bounding box + 80 px)
    const away = async () => { const p = await evalJs(`(() => { const c = document.getElementById('svgCanvas'), r = c.getBoundingClientRect();
      const bs = [...c.querySelectorAll('.shape-elem, .constraint-glyph, .joint-handle')].map((e) => e.getBoundingClientRect());
      const g = { left: Math.min(...bs.map((b) => b.left)), right: Math.max(...bs.map((b) => b.right)), top: Math.min(...bs.map((b) => b.top)), bottom: Math.max(...bs.map((b) => b.bottom)) };
      for (let fy = 0.1; fy < 1; fy += 0.1) for (let fx = 0.1; fx < 1; fx += 0.1) {
        const x = Math.round(r.left + r.width * fx), y = Math.round(r.top + r.height * fy);
        if (x > g.left - 80 && x < g.right + 80 && y > g.top - 80 && y < g.bottom + 80) continue;
        const e = document.elementFromPoint(x, y); if (e && e.closest('#svgCanvas')) return { x, y };
      }
      return null; })()`);
      assert.ok(p, 'an empty point of the canvas, off the drawing and off any panel');
      await mouse('mouseMoved', p.x, p.y, 0); await sleep(250); };
    const clearSel = async (g) => { await away(g); await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(700); };
    const open = async (offset = 16, ct, cj0, lineId, symbol = 20) => {
      await navigate(url, 8000); await waitForApp('svgCanvas');
      await evalJs(`(async () => { localStorage.clear(); localStorage.setItem('sketch-studio-settings', JSON.stringify({ GRID_MAGNETISM: 0.001, GLYPH_OFFSET_PX: ${offset}, GLYPH_SYMBOL_SIZE_PX: ${symbol} })); const dbs = indexedDB.databases ? await indexedDB.databases() : []; await Promise.all(dbs.map(d => new Promise(r => { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = () => r(); }))); return true; })()`);
      await navigate(url, 8000); await waitForApp('svgCanvas');
      await evalJs(`import('/packages/ui/project-store.js').then(async (m) => { const s = m.getProjectStore(); const d = await s.newDesign('Task 588 glyph', { app: 'sketchstudio' }); await s.save(${JSON.stringify(DOC)}, { app: 'sketchstudio', id: d.id }); return d.id; })`);
      await navigate(url, 8000); await waitForApp('svgCanvas'); await sleep(600);
      await evalJs(`document.getElementById('tool-select').click()`); await sleep(150);
      const g = await geo(ct, cj0, lineId);
      assert.ok(g.glyph, 'the glyph is drawn');
      const G = toS(g, ...g.glyph), Lx = toS(g, g.lineX, g.glyph[1]).x;
      const h = Math.abs(G.x - Lx);
      // the point of the line rE2 at distance d px from the glyph centre (pointer events land on whole pixels: d is re-measured)
      const at = (d) => { const p = { x: Math.round(Lx), y: Math.round(G.y + Math.sqrt(Math.max(0, d * d - h * h))) }; p.d = Math.hypot(p.x - G.x, p.y - G.y); return p; };
      return { g, G: { x: Math.round(G.x), y: Math.round(G.y) }, h, at };
    };

    // ---- 1 / 2: the outlined glyph (the owner's case)
    {
      const { g, G, h, at } = await open(16, "vertical", "r2", "rE2");
      assert.ok(h < 15, 'the glyph sits close beside its line (' + h.toFixed(1) + ' px)');
      const p = at(15);
      out.push(`glyph ${h.toFixed(1)} px beside rE2, pointer ${p.d.toFixed(1)} px from its centre`);
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
    // ---- 3 (task 603): a glyph BESIDE its line, inside the old pick disc. At Glyph Icon Size 40 (also: the size setting scales the box) the old disc was 23 px; the H glyph of rE1 sits ~14 px off
    // its line; the pointer on the line right under the icon is beside the thin icon, so it is on the LINE (hover and click); on the icon it is the glyph (hover and click).
    {
      const { g, G } = await open(16, 'horizontal', 'r1', 'rE1', 40);
      const P = toS(g, g.glyph[0], g.lineY); P.x = Math.round(P.x); P.y = Math.round(P.y);
      const d = Math.hypot(P.x - G.x, P.y - G.y);
      out.push(`3. H glyph, pointer on its line ${d.toFixed(1)} px from the icon centre (inside the old 23 px circle of a 40 px glyph)`);
      assert.ok(d > 12 && d < 23, 'the line point is inside the old 23 px circle and off the thin icon (' + d + ')');
      await mouse('mouseMoved', P.x, P.y, 0); await sleep(300);
      let s = await geo('horizontal', 'r1', 'rE1');
      out.push(`   line point hovered: blue [${blueLines(s).join(' ')}], glyph tokens [${s.glyphToks.join(' ')}]`);
      assert.deepStrictEqual(blueLines(s), ['rE1'], 'hover beside the thin icon lights the LINE');
      assert.deepStrictEqual(s.glyphToks, [], 'not the glyph');
      await shot('603-hover-beside-icon.png', G);
      await mouse('mousePressed', P.x, P.y, 1, 1); await sleep(60); await mouse('mouseReleased', P.x, P.y, 0, 1); await sleep(200);
      await away(g); s = await geo('horizontal', 'r1', 'rE1');
      assert.deepStrictEqual(blueLines(s), ['rE1'], 'the click selects the LINE');
      assert.deepStrictEqual(s.glyphToks, [], 'not the glyph');
      await clearSel(g);
      await mouse('mouseMoved', G.x, G.y, 0); await sleep(300);
      s = await geo('horizontal', 'r1', 'rE1');
      out.push(`   icon hovered: glyph tokens [${s.glyphToks.join(' ')}], blue [${blueLines(s).join(' ')}]`);
      assert.deepStrictEqual(s.glyphToks, ['--sk-glyph-hover'], 'hover on the icon lights the glyph');
      assert.deepStrictEqual(blueLines(s), [], 'no blue line');
      await shot('603-hover-on-icon.png', G);
      await mouse('mousePressed', G.x, G.y, 1, 1); await sleep(60); await mouse('mouseReleased', G.x, G.y, 0, 1); await sleep(200);
      await away(g); s = await geo('horizontal', 'r1', 'rE1');
      assert.deepStrictEqual(s.glyphToks, ['--sk-glyph-selected'], 'the click on the icon selects the glyph');
    }
    console.log(out.join('\n'));
    console.log('screenshots ' + md5s.join(' '));
    console.log('glyph-pick-hover-live.test.js: ok');
  } catch (e) { console.log(out.join('\n')); throw e; } finally { await cdp.close(); }
})();
