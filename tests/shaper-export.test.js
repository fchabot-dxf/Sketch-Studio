import { exportShaperSVG, loopToPathD } from '#core/shaper-export.js';
import { findLoops } from '#core/loop-finder.js';
import { loopPolygon, polyArea } from '#core/loop-geometry.js'; // SKETCH-4e: island fixtures

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

  // ── SP1j-3a: datum triangle + <g> group inheritance (DECLARED options, default OFF) ──

  // 11. options.datum → the red registration triangle at 0,0, emitted FIRST (mm-canonical, default 20×10)
  {
    const state = rectState();
    const loop = findLoops(state)[0];
    const svg = exportShaperSVG({ state, entries: [{ target: { kind: 'loop', id: loop.id }, rec: { cutType: 'exterior' } }], encoding: ENC5, docUnit: 'mm', options: { datum: true } });
    const want = [
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:shaper="http://www.shapertools.com/namespaces/shaper" width="100mm" height="50mm" viewBox="0 0 100 50">',
      '  <polygon points="0,0 20,0 0,10" fill="#FF0000" stroke="none"/>',
      '  <path d="M 0 0 L 100 0 L 100 50 L 0 50 Z" fill="#000000" shaper:cutType="outside"/>',
      '</svg>',
    ].join('\n');
    eq(svg, want, 'options.datum → red triangle first');
  }

  // 12. options.groupByCut → two same-attr cuts in ONE <g> (attrs hoisted off the children); a unique cut ungrouped
  {
    const state = {
      joints: new Map([
        ['A', { x: 0, y: 0 }], ['B', { x: 40, y: 0 }], ['C', { x: 40, y: 30 }], ['D', { x: 0, y: 30 }],
        ['E', { x: 60, y: 0 }], ['F', { x: 100, y: 0 }], ['G', { x: 100, y: 30 }], ['H', { x: 60, y: 30 }],
        ['Z', { x: 50, y: 60 }],
      ]),
      constraints: [],
      shapes: [
        { id: 'AB', type: 'line', joints: ['A', 'B'] }, { id: 'BC', type: 'line', joints: ['B', 'C'] }, { id: 'CD', type: 'line', joints: ['C', 'D'] }, { id: 'DA', type: 'line', joints: ['D', 'A'] },
        { id: 'EF', type: 'line', joints: ['E', 'F'] }, { id: 'FG', type: 'line', joints: ['F', 'G'] }, { id: 'GH', type: 'line', joints: ['G', 'H'] }, { id: 'HE', type: 'line', joints: ['H', 'E'] },
        { id: 'circ', type: 'circle', joints: ['Z'], radius: 10 },
      ],
    };
    const loops = findLoops(state);
    const rects = loops.filter((l) => l.edges.length === 4);
    const circle = loops.find((l) => l.edges.length === 1);
    const entries = [
      { target: { kind: 'loop', id: rects[0].id }, rec: { cutType: 'exterior' } },
      { target: { kind: 'loop', id: rects[1].id }, rec: { cutType: 'exterior' } },
      { target: { kind: 'loop', id: circle.id }, rec: { cutType: 'pocket' } },
    ];
    const grouped = exportShaperSVG({ state, entries, encoding: ENC5, docUnit: 'mm', options: { groupByCut: true } });
    assert(grouped.includes('<g fill="#000000" shaper:cutType="outside">'), 'group: <g> with hoisted attrs');
    assert((grouped.match(/<g /g) || []).length === 1 && grouped.includes('</g>'), 'group: exactly one <g>…</g>');
    assert((grouped.match(/<path d="[^"]*"\/>/g) || []).length === 2, 'group: 2 children with NO cut attrs (inherited)');
    assert(/<circle cx="50" cy="60" r="10" fill="#7F7F7F" shaper:cutType="pocket"\/>/.test(grouped), 'group: the unique pocket stays ungrouped (keeps its attrs)');

    const ungrouped = exportShaperSVG({ state, entries, encoding: ENC5, docUnit: 'mm' }); // default OFF
    assert(!ungrouped.includes('<g '), 'default: no grouping');
    assert((ungrouped.match(/<path d="[^"]*" fill="#000000" shaper:cutType="outside"\/>/g) || []).length === 2, 'default: each rect keeps its own attrs');
  }

  // 13. options OFF (default) → no datum polygon, no <g> (the j1/j2 cases above already pin the exact strings)
  {
    const state = rectState();
    const loop = findLoops(state)[0];
    const svg = exportShaperSVG({ state, entries: [{ target: { kind: 'loop', id: loop.id }, rec: { cutType: 'exterior' } }], encoding: ENC5, docUnit: 'mm' });
    assert(!svg.includes('<polygon') && !svg.includes('<g '), 'options default OFF → no datum / no group');
  }

  // ── SKETCH-4e: ISLANDS — an explicit GROUP of nested loops → a compound fill-rule="evenodd" path ──
  {
    const PK = [{ id: 'pocket', cutType: 'pocket', fill: '#7F7F7F', stroke: 'none' }, { id: 'interior', cutType: 'inside', fill: '#FFFFFF', stroke: '#000000' }];
    // outer 40×40 + inner 20×20, all 8 lines in 'group-1' (override per case)
    const islandState = (innerJoints, grouped) => {
      const J = new Map([['A', { x: 0, y: 0 }], ['B', { x: 40, y: 0 }], ['C', { x: 40, y: 40 }], ['D', { x: 0, y: 40 }], ...innerJoints]);
      const g = grouped ? 'group-1' : undefined;
      const Ln = (id, p, q) => ({ id, type: 'line', joints: [p, q], userGroupId: g });
      return { joints: J, constraints: [], shapes: [
        Ln('OA', 'A', 'B'), Ln('OB', 'B', 'C'), Ln('OC', 'C', 'D'), Ln('OD', 'D', 'A'),
        Ln('IE', 'E', 'F'), Ln('IF', 'F', 'G'), Ln('IG', 'G', 'H'), Ln('IH', 'H', 'E'),
      ] };
    };
    const INNER_IN = [['E', { x: 10, y: 10 }], ['F', { x: 30, y: 10 }], ['G', { x: 30, y: 30 }], ['H', { x: 10, y: 30 }]];   // inside
    const INNER_OUT = [['E', { x: 50, y: 10 }], ['F', { x: 70, y: 10 }], ['G', { x: 70, y: 30 }], ['H', { x: 50, y: 30 }]]; // beside
    const polysFor = (state) => { const sb = new Map(state.shapes.map((s) => [s.id, s])); const o = {}; for (const l of findLoops(state)) o[l.id] = loopPolygon(l, state, sb); return o; };
    const byArea = (state) => { const sb = new Map(state.shapes.map((s) => [s.id, s])); const ls = findLoops(state).map((l) => ({ id: l.id, a: polyArea(loopPolygon(l, state, sb)) })).sort((x, y) => y.a - x.a); return { outer: ls[0].id, inner: ls[ls.length - 1].id }; };

    // grouped + nested + islands ON → ONE evenodd compound (outer + hole; inner absorbed)
    {
      const state = islandState(INNER_IN, true); const { outer } = byArea(state);
      const svg = exportShaperSVG({ state, entries: [{ target: { kind: 'loop', id: outer }, rec: { cutType: 'pocket' } }], encoding: PK, docUnit: 'mm', options: { islands: true }, loopPolys: polysFor(state) });
      assert((svg.match(/<path /g) || []).length === 1, 'island: ONE compound path');
      assert(/fill-rule="evenodd"/.test(svg) && /shaper:cutType="pocket"/.test(svg), 'island: evenodd + pocket attrs');
      const d = (svg.match(/d="([^"]+)"/) || [])[1] || '';
      assert((d.match(/Z/g) || []).length === 2, 'island: outer + hole subpaths (2 × Z)');
    }
    // islands OFF (default) → plain pocket, no evenodd, one subpath
    {
      const state = islandState(INNER_IN, true); const { outer } = byArea(state);
      const svg = exportShaperSVG({ state, entries: [{ target: { kind: 'loop', id: outer }, rec: { cutType: 'pocket' } }], encoding: PK, docUnit: 'mm', loopPolys: polysFor(state) });
      assert(!/fill-rule="evenodd"/.test(svg) && ((svg.match(/d="([^"]+)"/) || [])[1].match(/Z/g) || []).length === 1, 'islands OFF → plain pocket');
    }
    // NESTED but NOT grouped → not merged (the inner is unassigned → not emitted either)
    {
      const state = islandState(INNER_IN, false); const { outer } = byArea(state);
      const svg = exportShaperSVG({ state, entries: [{ target: { kind: 'loop', id: outer }, rec: { cutType: 'pocket' } }], encoding: PK, docUnit: 'mm', options: { islands: true }, loopPolys: polysFor(state) });
      assert(!/fill-rule="evenodd"/.test(svg), 'nested but NOT grouped → no merge');
    }
    // GROUPED but NOT nested (beside) → not merged
    {
      const state = islandState(INNER_OUT, true); const { outer } = byArea(state);
      const svg = exportShaperSVG({ state, entries: [{ target: { kind: 'loop', id: outer }, rec: { cutType: 'pocket' } }], encoding: PK, docUnit: 'mm', options: { islands: true }, loopPolys: polysFor(state) });
      assert(!/fill-rule="evenodd"/.test(svg), 'grouped but NOT nested → no merge');
    }
    // inner ASSIGNED its own cut + NOT grouped → both emitted separately (no merge)
    {
      const state = islandState(INNER_IN, false); const { outer, inner } = byArea(state);
      const svg = exportShaperSVG({ state, entries: [{ target: { kind: 'loop', id: outer }, rec: { cutType: 'pocket' } }, { target: { kind: 'loop', id: inner }, rec: { cutType: 'interior' } }], encoding: PK, docUnit: 'mm', options: { islands: true }, loopPolys: polysFor(state) });
      assert((svg.match(/<path /g) || []).length === 2 && !/fill-rule="evenodd"/.test(svg), 'inner assigned + ungrouped → both emitted, no merge');
    }
  }

  console.log('shaper-export tests passed ✅');
})().catch((e) => { console.error('shaper-export tests failed ❌', e); process.exit(1); });
