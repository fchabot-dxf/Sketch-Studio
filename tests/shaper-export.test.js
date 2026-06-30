import { exportShaperSVG, loopToPathD } from '#core/shaper-export.js';
import { findLoops } from '#core/loop-finder.js';

(async () => {
  const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };
  const eq = (got, want, m) => { if (got !== want) throw new Error(`${m || 'mismatch'}\n--- GOT ---\n${got}\n--- WANT ---\n${want}`); };

  // STUB encoding (the app injects its CUT_TYPES; #core never imports them).
  const ENC = [
    { id: 'exterior', cutType: 'outside', fill: '#000000', stroke: 'none' },
    { id: 'interior', cutType: 'inside', fill: '#FFFFFF', stroke: '#000000' },
  ];
  // 100×50 rectangle loop (4 line edges). findLoops walks it A→B→C→D.
  const rectState = () => ({
    joints: new Map([['A', { x: 0, y: 0 }], ['B', { x: 100, y: 0 }], ['C', { x: 100, y: 50 }], ['D', { x: 0, y: 50 }]]),
    constraints: [],
    shapes: [
      { id: 'AB', type: 'line', joints: ['A', 'B'] }, { id: 'BC', type: 'line', joints: ['B', 'C'] },
      { id: 'CD', type: 'line', joints: ['C', 'D'] }, { id: 'DA', type: 'line', joints: ['D', 'A'] },
    ],
  });

  // 1. rect loop + outside cut → the EXACT SVG string (xmlns:shaper header, closed path, cutType, fill, mm viewBox)
  {
    const state = rectState();
    const loop = findLoops(state)[0];
    const svg = exportShaperSVG({ state, entries: [{ target: { kind: 'loop', id: loop.id }, rec: { cutType: 'exterior' } }], encoding: ENC, docUnit: 'mm' });
    const want = [
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:shaper="http://www.shapertools.com/namespaces/shaper" width="100mm" height="50mm" viewBox="0 0 100 50">',
      '  <path d="M 0 0 L 100 0 L 100 50 L 0 50 Z" fill="#000000" shaper:cutType="outside"/>',
      '</svg>',
    ].join('\n');
    eq(svg, want, 'rect-loop outside: exact string');
  }

  // 2. loopToPathD directly → M..L..Z (lines only)
  {
    const state = rectState();
    eq(loopToPathD(findLoops(state)[0], state), 'M 0 0 L 100 0 L 100 50 L 0 50 Z', 'loopToPathD lines');
  }

  // 3. empty plan (empty state) → a valid empty SVG
  {
    const svg = exportShaperSVG({ state: { joints: new Map(), constraints: [], shapes: [] }, entries: [], encoding: ENC, docUnit: 'mm' });
    eq(svg, '<svg xmlns="http://www.w3.org/2000/svg" xmlns:shaper="http://www.shapertools.com/namespaces/shaper" width="0mm" height="0mm" viewBox="0 0 0 0">\n</svg>', 'empty plan → empty SVG');
  }

  // 4. mm-CANONICAL: the document unit does NOT scale the geometry/viewBox (coords stay world/base mm)
  {
    const state = rectState();
    const loop = findLoops(state)[0];
    const entries = [{ target: { kind: 'loop', id: loop.id }, rec: { cutType: 'exterior' } }];
    const mm = exportShaperSVG({ state, entries, encoding: ENC, docUnit: 'mm' });
    const inch = exportShaperSVG({ state, entries, encoding: ENC, docUnit: 'in' });
    eq(inch, mm, 'docUnit does not scale geometry (mm-canonical)');
    assert(mm.includes('viewBox="0 0 100 50"') && mm.includes('L 100 50 L'), 'coords unscaled mm');
  }

  // 5. orphaned target (no matching loop — design changed after assignment) → skipped, no path
  {
    const state = rectState();
    const svg = exportShaperSVG({ state, entries: [{ target: { kind: 'loop', id: 'loop_GONE' }, rec: { cutType: 'exterior' } }], encoding: ENC, docUnit: 'mm' });
    assert(!svg.includes('<path'), 'orphaned loop skipped');
    assert(svg.startsWith('<svg ') && svg.endsWith('</svg>'), 'still a valid SVG');
  }

  console.log('shaper-export tests passed ✅');
})().catch((e) => { console.error('shaper-export tests failed ❌', e); process.exit(1); });
