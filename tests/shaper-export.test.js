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
  // The full 5-type encoding (mirrors the app CUT_TYPES export fields; #core stays injection-only).
  const ENC5 = [
    { id: 'exterior', cutType: 'outside', fill: '#000000', stroke: 'none' },
    { id: 'interior', cutType: 'inside', fill: '#FFFFFF', stroke: '#000000' },
    { id: 'pocket', cutType: 'pocket', fill: '#7F7F7F', stroke: 'none' },
    { id: 'online', cutType: 'online', fill: 'none', stroke: '#7F7F7F' },
    { id: 'guide', cutType: 'guide', fill: '#0068FF', stroke: '#0068FF' },
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

  // ── SP1j-2: arcs / circles / edges / cut-params / all 5 types ──

  // 6. ARC in a loop — direction-aware sweep. Hand-built loops traverse the SAME arc both ways → the sweep flag flips.
  {
    const arcState = {
      joints: new Map([['A', { x: 50, y: 0 }], ['B', { x: 0, y: 50 }], ['M', { x: 0, y: 0 }]]),
      constraints: [],
      shapes: [
        { id: 'arcAB', type: 'arc', subType: 'CENTER', joints: ['M', 'A', 'B'], largeArc: false, sweep: true, radius: 50 },
        { id: 'lineBA', type: 'line', joints: ['B', 'A'] },
      ],
    };
    eq(loopToPathD({ joints: ['A', 'B'], edges: ['arcAB', 'lineBA'] }, arcState), 'M 50 0 A 50 50 0 0 1 0 50 Z', 'arc loop forward → sweep 1');
    eq(loopToPathD({ joints: ['B', 'A'], edges: ['arcAB', 'lineBA'] }, arcState), 'M 0 50 A 50 50 0 0 0 50 0 Z', 'arc loop reverse → sweep 0 (flipped)');
  }

  // 7. CIRCLE loop → <circle> with the cut attrs; bbox = center ± r (not the bare center point)
  {
    const state = { joints: new Map([['Z', { x: 10, y: 20 }]]), constraints: [], shapes: [{ id: 'circ', type: 'circle', joints: ['Z'], radius: 25 }] };
    const loop = findLoops(state)[0];
    const svg = exportShaperSVG({ state, entries: [{ target: { kind: 'loop', id: loop.id }, rec: { cutType: 'pocket', cutDepth: 6.35, toolDia: 3.175 } }], encoding: ENC5, docUnit: 'mm' });
    const want = [
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:shaper="http://www.shapertools.com/namespaces/shaper" width="50mm" height="50mm" viewBox="-15 -5 50 50">',
      '  <circle cx="10" cy="20" r="25" fill="#7F7F7F" shaper:cutType="pocket" shaper:cutDepth="6.35mm" shaper:toolDia="3.175mm"/>',
      '</svg>',
    ].join('\n');
    eq(svg, want, 'circle loop → <circle> + attrs');
  }

  // 8. Open EDGE (online on a line) → <line> with the cut attrs (not a closed loop)
  {
    const state = { joints: new Map([['P', { x: 0, y: 0 }], ['Q', { x: 80, y: 0 }]]), constraints: [], shapes: [{ id: 'e1', type: 'line', joints: ['P', 'Q'] }] };
    const svg = exportShaperSVG({ state, entries: [{ target: { kind: 'edge', id: 'e1' }, rec: { cutType: 'online', toolDia: 3.175 } }], encoding: ENC5, docUnit: 'mm' });
    assert(svg.includes('<line x1="0" y1="0" x2="80" y2="0" fill="none" stroke="#7F7F7F" shaper:cutType="online" shaper:toolDia="3.175mm"/>'), 'open edge → <line> + online attrs');
  }

  // 9. Cut-param attrs — docUnit drives the SUFFIX (geometry stays mm); cutOffset 0 / cutDepth unset → omitted
  {
    const state = rectState();
    const loop = findLoops(state)[0];
    const entry = (rec) => [{ target: { kind: 'loop', id: loop.id }, rec }];
    const mm = exportShaperSVG({ state, entries: entry({ cutType: 'exterior', cutDepth: 6.35, cutOffset: 0, toolDia: 3.175 }), encoding: ENC5, docUnit: 'mm' });
    assert(mm.includes('shaper:cutDepth="6.35mm"') && mm.includes('shaper:toolDia="3.175mm"'), 'mm param suffixes');
    assert(!mm.includes('cutOffset'), 'cutOffset 0 omitted');
    const inch = exportShaperSVG({ state, entries: entry({ cutType: 'exterior', cutDepth: 6.35, cutOffset: 0.5, toolDia: 3.175 }), encoding: ENC5, docUnit: 'in' });
    assert(inch.includes('shaper:cutDepth="0.25in"') && inch.includes('shaper:toolDia="0.125in"'), 'inch param suffixes');
    assert(inch.includes('shaper:cutOffset="0.0197in"'), 'cutOffset emitted when ≠0');
    const unset = exportShaperSVG({ state, entries: entry({ cutType: 'exterior', cutDepth: 'unset', toolDia: 3.175 }), encoding: ENC5, docUnit: 'mm' });
    assert(!unset.includes('cutDepth'), "cutDepth='unset' omitted");
  }

  // 10. All 5 cut types → correct shaper:cutType + fill/stroke (region types on a loop, path types on an edge)
  {
    const lstate = rectState();
    const loop = findLoops(lstate)[0];
    const region = (id) => exportShaperSVG({ state: lstate, entries: [{ target: { kind: 'loop', id: loop.id }, rec: { cutType: id } }], encoding: ENC5, docUnit: 'mm' });
    assert(region('exterior').includes('fill="#000000" shaper:cutType="outside"'), 'exterior → outside #000');
    assert(region('interior').includes('fill="#FFFFFF" stroke="#000000" shaper:cutType="inside"'), 'interior → inside #fff+#000');
    assert(region('pocket').includes('fill="#7F7F7F" shaper:cutType="pocket"'), 'pocket → #7F7F7F');
    const estate = { joints: new Map([['P', { x: 0, y: 0 }], ['Q', { x: 80, y: 0 }]]), constraints: [], shapes: [{ id: 'e1', type: 'line', joints: ['P', 'Q'] }] };
    const edge = (id) => exportShaperSVG({ state: estate, entries: [{ target: { kind: 'edge', id: 'e1' }, rec: { cutType: id } }], encoding: ENC5, docUnit: 'mm' });
    assert(edge('online').includes('fill="none" stroke="#7F7F7F" shaper:cutType="online"'), 'online → none+#7F7F7F');
    assert(edge('guide').includes('fill="#0068FF" stroke="#0068FF" shaper:cutType="guide"'), 'guide → #0068FF');
  }

  console.log('shaper-export tests passed ✅');
})().catch((e) => { console.error('shaper-export tests failed ❌', e); process.exit(1); });
