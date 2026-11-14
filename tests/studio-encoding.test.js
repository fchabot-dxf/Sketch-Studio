// tests/studio-encoding.test.js — TASK 456, trimmed in TASK 583: what only a BROWSER can check of the Shaper export encoding. The two exported compound paths (a
// framed square with a hole, a ring) are filled by the browser under its DEFAULT fill rule (no fill-rule attribute): the hole must stay EMPTY. The encoding
// itself (attribute run, winding, no fill-rule, On Line footprint) is tests/studio-encoding-node.test.js.
import assert from 'node:assert';
import { exportShaperSVG } from '#core/shaper-export.js';
import { CUT_TYPES } from '../apps/shaper/src/shaper.js';
import { findLoops } from '#core/loop-finder.js';
import { launchBrowser } from './helpers/cdp-browser.js';

await (async () => {
  const cdp = await launchBrowser({ tag: '456' });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, evalJs, waitFor, navigate } = cdp;

  try {
    const sq = (x, y, w, h, p) => ({ pts: { [p + 'a']: [x, y], [p + 'b']: [x + w, y], [p + 'c']: [x + w, y + h], [p + 'd']: [x, y + h] }, shapes: [[p + '1', p + 'a', p + 'b'], [p + '2', p + 'b', p + 'c'], [p + '3', p + 'c', p + 'd'], [p + '4', p + 'd', p + 'a']] });
    const mkState = (parts) => {
      const joints = new Map(), shapes = [];
      for (const part of parts) { for (const [id, [x, y]] of Object.entries(part.pts)) joints.set(id, { x, y }); for (const [id, a, b] of part.shapes) shapes.push({ id, type: 'line', joints: [a, b] }); }
      return { joints, shapes, constraints: [] };
    };
    const pathOf = (state, loop) => exportShaperSVG({ state, entries: [{ target: { kind: 'loop', id: loop.id }, rec: { cutType: 'pocket', cutDepth: 6, cutOffset: 0, toolDia: 3.175 } }], encoding: CUT_TYPES, docUnit: 'mm' }).match(/d="([^"]+)"/)[1];
    let frameD, ringD;
    {
      const state = mkState([sq(0, 0, 60, 60, 'o'), sq(20, 20, 20, 20, 'h')]);
      const outer = findLoops(state).sort((a, b) => b.joints.length - a.joints.length || 0).find((l) => l.joints.some((j) => j.startsWith('o')));
      frameD = pathOf(state, outer);
    }
    {
      const state = { joints: new Map([['c', { x: 0, y: 0 }], ['p1', { x: 30, y: 0 }], ['p2', { x: 10, y: 0 }]]), shapes: [{ id: 'big', type: 'circle', joints: ['c', 'p1'], radius: 30 }, { id: 'small', type: 'circle', joints: ['c', 'p2'], radius: 10 }], constraints: [] };
      const outer = findLoops(state).find((l) => l.edges[0] === 'big');
      ringD = pathOf(state, outer);
    }

    // ── render check in the real browser: with the DEFAULT fill rule the hole stays EMPTY ──
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 8000);
    await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'shaper app ready');
    const r = await evalJs(`(() => {
      const mk = (d) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '-40 -40 120 120'); const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); s.appendChild(p); document.body.appendChild(s); return { s, p }; };
      const pt = (s, x, y) => { const q = s.createSVGPoint(); q.x = x; q.y = y; return q; };
      const frame = mk(${JSON.stringify(frameD)}); const ring = mk(${JSON.stringify(ringD)});
      return { frameWall: frame.p.isPointInFill(pt(frame.s, 5, 5)), frameHole: frame.p.isPointInFill(pt(frame.s, 30, 30)),
               ringBand: ring.p.isPointInFill(pt(ring.s, 20, 0)), ringHole: ring.p.isPointInFill(pt(ring.s, 0, 0)) };
    })()`);
    console.log('render check (default fill rule):', JSON.stringify(r));
    assert.deepStrictEqual(r, { frameWall: true, frameHole: false, ringBand: true, ringHole: false }, 'the hole stays EMPTY under the default (nonzero) fill rule');
    console.log('studio-encoding: ok');
  } finally {
    await cdp.close();
  }
})();
