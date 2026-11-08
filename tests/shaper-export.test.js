import { exportShaperSVG, loopToPathD, polyToPathD } from '#core/shaper-export.js';
import { findLoops } from '#core/loop-finder.js';
import { loopPolygon, polyArea } from '#core/loop-geometry.js';
import { makeProfile } from '#core/profile-model.js';
import { deriveVcarveContours } from '#core/vcarve.js';
import { format, formatShaperParam } from '#core/units.js';

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
      '  <path d="M 0 0 L 100 0 L 100 50 L 0 50 Z" fill="#000000" shaper:cutType="outside" shaper:cutOffset="0mm"/>',
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
    const noOffset = (x) => x.replace(/ shaper:cutOffset="[^"]*"/g, ''); // the offset suffix follows docUnit ("0in" / "0mm"); the geometry must not
    eq(noOffset(inch), noOffset(mm), 'docUnit does not scale geometry (mm-canonical)');
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
      '  <circle cx="10" cy="20" r="25" fill="#7F7F7F" shaper:cutType="pocket" shaper:cutDepth="6.350 mm" shaper:cutOffset="0mm" shaper:toolDia="3.175 mm"/>',
      '</svg>',
    ].join('\n');
    eq(svg, want, 'circle loop → <circle> + attrs');
  }

  // 8. Open chain — exported as one <path d="..."> (TASK 432 replaces kind: 'edge' with kind: 'chain')
  {
    const state = { joints: new Map([['P', { x: 0, y: 0 }], ['Q', { x: 80, y: 0 }]]), constraints: [], shapes: [{ id: 'e1', type: 'line', joints: ['P', 'Q'] }] };
    const svg = exportShaperSVG({ state, entries: [{ target: { kind: 'chain', id: 'chain_e1' }, rec: { cutType: 'online', toolDia: 3.175 } }], encoding: ENC5, docUnit: 'mm' });
    assert(svg.includes('<path d="M 0 0 L 80 0" fill="none" stroke="#7F7F7F" shaper:cutType="online" shaper:cutOffset="0mm" shaper:toolDia="3.175 mm"/>'), 'open chain → <path> + online attrs');
  }

  // 9. Cut-param attrs — docUnit drives the SUFFIX (geometry stays mm); cutOffset 0 / cutDepth unset → omitted
  {
    const state = rectState();
    const loop = findLoops(state)[0];
    const entry = (rec) => [{ target: { kind: 'loop', id: loop.id }, rec }];
    const mm = exportShaperSVG({ state, entries: entry({ cutType: 'exterior', cutDepth: 6.35, cutOffset: 0, toolDia: 3.175 }), encoding: ENC5, docUnit: 'mm' });
    assert(mm.includes('shaper:cutDepth="6.350 mm"') && mm.includes('shaper:toolDia="3.175 mm"'), 'mm param suffixes (3 decimals + space + unit)');
    assert(mm.includes('shaper:cutOffset="0mm"'), 'cutOffset 0 is written as "0mm" (Studio: "0in"); mm form UNVERIFIED');
    const inch = exportShaperSVG({ state, entries: entry({ cutType: 'exterior', cutDepth: 6.35, cutOffset: 0.5, toolDia: 3.175 }), encoding: ENC5, docUnit: 'in' });
    assert(inch.includes('shaper:cutDepth="0.250 in"') && inch.includes('shaper:toolDia="0.125 in"'), 'inch param suffixes (3 decimals + space + unit)');
    assert(inch.includes('shaper:cutOffset="0.020 in"'), 'cutOffset emitted when ≠0');
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
    const chain = (id) => exportShaperSVG({ state: estate, entries: [{ target: { kind: 'chain', id: 'chain_e1' }, rec: { cutType: id } }], encoding: ENC5, docUnit: 'mm' });
    assert(chain('online').includes('fill="none" stroke="#7F7F7F" shaper:cutType="online"'), 'online → none+#7F7F7F');
    assert(chain('guide').includes('fill="#0068FF" stroke="#0068FF" shaper:cutType="guide"'), 'guide → #0068FF');
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
      '  <path d="M 0 0 L 100 0 L 100 50 L 0 50 Z" fill="#000000" shaper:cutType="outside" shaper:cutOffset="0mm"/>',
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
    assert(grouped.includes('<g fill="#000000" shaper:cutType="outside" shaper:cutOffset="0mm">'), 'group: <g> with hoisted attrs');
    assert((grouped.match(/<g /g) || []).length === 1 && grouped.includes('</g>'), 'group: exactly one <g>…</g>');
    assert((grouped.match(/<path d="[^"]*"\/>/g) || []).length === 2, 'group: 2 children with NO cut attrs (inherited)');
    assert(/<circle cx="50" cy="60" r="10" fill="#7F7F7F" shaper:cutType="pocket" shaper:cutOffset="0mm"\/>/.test(grouped), 'group: the unique pocket stays ungrouped (keeps its attrs)');

    const ungrouped = exportShaperSVG({ state, entries, encoding: ENC5, docUnit: 'mm' }); // default OFF
    assert(!ungrouped.includes('<g '), 'default: no grouping');
    assert((ungrouped.match(/<path d="[^"]*" fill="#000000" shaper:cutType="outside" shaper:cutOffset="0mm"\/>/g) || []).length === 2, 'default: each rect keeps its own attrs');
  }

  // 13. options OFF (default) → no datum polygon, no <g> (the j1/j2 cases above already pin the exact strings)
  {
    const state = rectState();
    const loop = findLoops(state)[0];
    const svg = exportShaperSVG({ state, entries: [{ target: { kind: 'loop', id: loop.id }, rec: { cutType: 'exterior' } }], encoding: ENC5, docUnit: 'mm' });
    assert(!svg.includes('<polygon') && !svg.includes('<g '), 'options default OFF → no datum / no group');
  }

  // ── TASK 432: PROFILE HOLES & ISLANDS (derived direct holes + Combine override; user groups have NO hole meaning) ──
  {
    const PK = [
      { id: 'pocket', cutType: 'pocket', fill: '#7F7F7F', stroke: 'none' },
      { id: 'interior', cutType: 'inside', fill: '#FFFFFF', stroke: '#000000' },
      { id: 'exterior', cutType: 'outside', fill: '#000000', stroke: 'none' },
    ];
    // outer 40×40 + second 20×20 loop (inside or beside), NO groups unless testing that groups are ignored
    const frameOrBesideState = (innerJoints, grouped = false) => {
      const J = new Map([['A', { x: 0, y: 0 }], ['B', { x: 40, y: 0 }], ['C', { x: 40, y: 40 }], ['D', { x: 0, y: 40 }], ...innerJoints]);
      const g = grouped ? 'group-1' : undefined;
      const Ln = (id, p, q) => ({ id, type: 'line', joints: [p, q], ...(g ? { userGroupId: g } : {}) });
      return {
        joints: J,
        constraints: [],
        groups: grouped ? [{ id: 'group-1', name: 'OrgGroup' }] : [],
        profiles: [],
        shapes: [
          Ln('OA', 'A', 'B'), Ln('OB', 'B', 'C'), Ln('OC', 'C', 'D'), Ln('OD', 'D', 'A'),
          Ln('IE', 'E', 'F'), Ln('IF', 'F', 'G'), Ln('IG', 'G', 'H'), Ln('IH', 'H', 'E'),
        ],
      };
    };
    const INNER_IN = [['E', { x: 10, y: 10 }], ['F', { x: 30, y: 10 }], ['G', { x: 30, y: 30 }], ['H', { x: 10, y: 30 }]];   // inside
    const INNER_OUT = [['E', { x: 50, y: 10 }], ['F', { x: 70, y: 10 }], ['G', { x: 70, y: 30 }], ['H', { x: 50, y: 30 }]]; // beside
    const byArea = (state) => {
      const sb = new Map(state.shapes.map((s) => [s.id, s]));
      const ls = findLoops(state).map((l) => ({ id: l.id, loop: l, a: polyArea(loopPolygon(l, state, sb)) })).sort((x, y) => y.a - x.a);
      return { outer: ls[0].id, inner: ls[ls.length - 1].id, outerLoop: ls[0].loop, innerLoop: ls[ls.length - 1].loop };
    };

    // a) Frame (outer + 1 hole) with NO group anywhere → ONE compound path, hole wound opposite, no fill-rule (outer + hole; hole has no cut of its own)
    {
      const state = frameOrBesideState(INNER_IN, false);
      const { outer } = byArea(state);
      const svg = exportShaperSVG({ state, entries: [{ target: { kind: 'loop', id: outer }, rec: { cutType: 'pocket' } }], encoding: PK, docUnit: 'mm' });
      assert((svg.match(/<path /g) || []).length === 1, 'frame (no group): ONE compound path');
      assert(!/fill-rule/.test(svg) && /shaper:cutType="pocket"/.test(svg), 'frame (no group): NO fill-rule (Studio parity; holes wound opposite) + pocket attrs');
      const d = (svg.match(/d="([^"]+)"/) || [])[1] || '';
      assert((d.match(/Z/g) || []).length === 2, 'frame (no group): outer + hole subpaths (2 × Z)');
    }

    // b) Side-by-side shapes (even when grouped) → NOT merged
    {
      const state = frameOrBesideState(INNER_OUT, true);
      const { outer } = byArea(state);
      const svg = exportShaperSVG({ state, entries: [{ target: { kind: 'loop', id: outer }, rec: { cutType: 'pocket' } }], encoding: PK, docUnit: 'mm' });
      assert(!/fill-rule="evenodd"/.test(svg), 'side-by-side (grouped) → no evenodd');
      assert(((svg.match(/d="([^"]+)"/) || [])[1].match(/Z/g) || []).length === 1, 'side-by-side → single subpath');
    }

    // c) Frame where outer has pocket AND hole ALSO has its own cut → outer exports as compound evenodd AND hole exports as its own path
    {
      const state = frameOrBesideState(INNER_IN, false);
      const { outer, inner } = byArea(state);
      const svg = exportShaperSVG({
        state,
        entries: [
          { target: { kind: 'loop', id: outer }, rec: { cutType: 'pocket', cutDepth: 5 } },
          { target: { kind: 'loop', id: inner }, rec: { cutType: 'interior', cutDepth: 12 } },
        ],
        encoding: PK,
        docUnit: 'mm',
      });
      const paths = [...svg.matchAll(/<path ([^>]+)\/>/g)].map((m) => m[1]);
      eq(paths.length, 2, 'outer pocket + hole own interior cut → BOTH exported');
      assert(!paths[0].includes('fill-rule') && paths[0].includes('shaper:cutType="pocket"') && (paths[0].match(/Z/g) || []).length === 2, 'outer keeps hole open (hole wound opposite, no fill-rule, 2 × Z)');
      assert(!paths[1].includes('fill-rule="evenodd"') && paths[1].includes('shaper:cutType="inside"') && paths[1].includes('shaper:cutDepth="12.000 mm"'), 'hole exported separately with its own cut params');
    }

    // d) 3-circle Bullseye (outer r=40, ring r=24, dot r=10) with NO group anywhere:
    //    - pocket on outer only → compound evenodd path (outer + ring, 2 × Z); dot NOT emitted
    //    - pocket on outer + own cut on dot → compound evenodd path for outer + separate <circle> for dot
    {
      const circBullState = () => ({
        joints: new Map([['C', { x: 0, y: 0 }]]),
        constraints: [],
        groups: [],
        profiles: [],
        shapes: [
          { id: 'cOuter', type: 'circle', joints: ['C'], radius: 40 },
          { id: 'cRing', type: 'circle', joints: ['C'], radius: 24 },
          { id: 'cDot', type: 'circle', joints: ['C'], radius: 10 },
        ],
      });
      const st = circBullState();
      const loops = findLoops(st);
      const lOuter = loops.find((l) => l.edges[0] === 'cOuter');
      const lRing = loops.find((l) => l.edges[0] === 'cRing');
      const lDot = loops.find((l) => l.edges[0] === 'cDot');

      const svgOuterOnly = exportShaperSVG({
        state: st,
        entries: [{ target: { kind: 'loop', id: lOuter.id }, rec: { cutType: 'pocket', cutDepth: 6 } }],
        encoding: PK,
        docUnit: 'mm',
      });
      assert((svgOuterOnly.match(/<path /g) || []).length === 1 && !svgOuterOnly.includes('<circle '), '3-circle bullseye outer only: 1 compound path, dot not emitted');
      assert(svgOuterOnly.includes('A 40 40') && svgOuterOnly.includes('A 24 24') && !svgOuterOnly.includes('A 10 10'), 'outer compound path includes outer(40) + ring(24), excludes dot(10)');

      const svgWithDot = exportShaperSVG({
        state: st,
        entries: [
          { target: { kind: 'loop', id: lOuter.id }, rec: { cutType: 'pocket', cutDepth: 6 } },
          { target: { kind: 'loop', id: lDot.id }, rec: { cutType: 'pocket', cutDepth: 3 } },
        ],
        encoding: PK,
        docUnit: 'mm',
      });
      assert((svgWithDot.match(/<path /g) || []).length === 1, 'outer ring emitted as 1 compound path');
      assert(svgWithDot.includes('<circle cx="0" cy="0" r="10" fill="#7F7F7F" shaper:cutType="pocket" shaper:cutDepth="3.000 mm" shaper:cutOffset="0mm"/>'), 'dot island emitted as its own <circle> with its own cutDepth');
      // Ring loop still unassigned → not emitted as its own cut
      assert(!svgWithDot.includes('r="24"'), 'unassigned ring loop only bounds outer pocket');
      assert(Boolean(lRing), 'ring loop exists');
    }

    // e) Combined profile (`profile:<id>`) overrides derived face and exports with ONE param set
    {
      const st = {
        joints: new Map([['C', { x: 0, y: 0 }]]),
        constraints: [],
        groups: [],
        profiles: [],
        shapes: [
          { id: 'cOuter', type: 'circle', joints: ['C'], radius: 40 },
          { id: 'cRing', type: 'circle', joints: ['C'], radius: 24 },
          { id: 'cDot', type: 'circle', joints: ['C'], radius: 10 },
        ],
      };
      const loops = findLoops(st);
      const lOuter = loops.find((l) => l.edges[0] === 'cOuter');
      const lDot = loops.find((l) => l.edges[0] === 'cDot');
      const prof = makeProfile(st, lOuter, [lDot]);
      const svgCombined = exportShaperSVG({
        state: st,
        entries: [{ target: { kind: 'profile', id: prof.id }, rec: { cutType: 'pocket', cutDepth: 8 } }],
        encoding: PK,
        docUnit: 'mm',
      });
      assert(!svgCombined.includes('fill-rule') && svgCombined.includes('A 40 40') && svgCombined.includes('A 10 10') && !svgCombined.includes('A 24 24'), 'combined profile (outer + dot) overrides derived ring hole');
    }
  }

  // ── VCARVE-4: V-carve cut-path export ──
  // 14. 40×40 square loop, 90° V-bit, dStep 5, maxDepth 15 → 3 online paths at depths 5mm, 10mm, 15mm
  {
    const sqState = () => ({
      joints: new Map([['A', { x: 0, y: 0 }], ['B', { x: 40, y: 0 }], ['C', { x: 40, y: 40 }], ['D', { x: 0, y: 40 }]]),
      constraints: [],
      shapes: [
        { id: 'AB', type: 'line', joints: ['A', 'B'] }, { id: 'BC', type: 'line', joints: ['B', 'C'] },
        { id: 'CD', type: 'line', joints: ['C', 'D'] }, { id: 'DA', type: 'line', joints: ['D', 'A'] },
      ],
    });
    const state = sqState();
    const loop = findLoops(state)[0];
    state.vcarves = [
      { id: 'vc1', region: 'loop:' + loop.id, vbit: { angle: 90 }, dStep: 5, maxDepth: 15 }
    ];
    const loopPolys = {
      [loop.id]: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }]
    };
    const svgMM = exportShaperSVG({ state, entries: [], encoding: ENC5, docUnit: 'mm', loopPolys });
    // 14. Exact-string oracle in mm
    // VCARVE-5a (Clipper canonical vertex order): Clipper begins outer insets at bottom-right (35,35), clockwise,
    // which describes the exact same physical cut as the old (5,5) CCW loop.
    const wantMM = [
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:shaper="http://www.shapertools.com/namespaces/shaper" width="40mm" height="40mm" viewBox="0 0 40 40">',
      '  <path d="M 35 35 L 5 35 L 5 5 L 35 5 Z" fill="none" stroke="#7F7F7F" shaper:cutType="online" shaper:cutDepth="5.000 mm" shaper:cutOffset="0mm"/>',
      '  <path d="M 30 30 L 10 30 L 10 10 L 30 10 Z" fill="none" stroke="#7F7F7F" shaper:cutType="online" shaper:cutDepth="10.000 mm" shaper:cutOffset="0mm"/>',
      '  <path d="M 25 25 L 15 25 L 15 15 L 25 15 Z" fill="none" stroke="#7F7F7F" shaper:cutType="online" shaper:cutDepth="15.000 mm" shaper:cutOffset="0mm"/>',
      '</svg>',
    ].join('\n');
    eq(svgMM, wantMM, 'vcarve export mm exact string');

    // 15. Exact-string oracle in inches
    // VCARVE-5a (Clipper canonical vertex order): same physical cut at Clipper's canonical start vertex.
    const svgIN = exportShaperSVG({ state, entries: [], encoding: ENC5, docUnit: 'in', loopPolys });
    const wantIN = [
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:shaper="http://www.shapertools.com/namespaces/shaper" width="40mm" height="40mm" viewBox="0 0 40 40">',
      '  <path d="M 35 35 L 5 35 L 5 5 L 35 5 Z" fill="none" stroke="#7F7F7F" shaper:cutType="online" shaper:cutDepth="0.197 in" shaper:cutOffset="0in"/>',
      '  <path d="M 30 30 L 10 30 L 10 10 L 30 10 Z" fill="none" stroke="#7F7F7F" shaper:cutType="online" shaper:cutDepth="0.394 in" shaper:cutOffset="0in"/>',
      '  <path d="M 25 25 L 15 25 L 15 15 L 25 15 Z" fill="none" stroke="#7F7F7F" shaper:cutType="online" shaper:cutDepth="0.591 in" shaper:cutOffset="0in"/>',
      '</svg>',
    ].join('\n');
    eq(svgIN, wantIN, 'vcarve export in exact string');

    // 16. Automatic exclusion: loop with vcarve record is excluded from standard cut assignment
    const svgExcl = exportShaperSVG({
      state,
      entries: [{ target: { kind: 'loop', id: loop.id }, rec: { cutType: 'exterior' } }],
      encoding: ENC5,
      docUnit: 'mm',
      loopPolys
    });
    assert(!svgExcl.includes('shaper:cutType="outside"'), 'loop in vcarves is excluded from standard cut assignment');
    assert((svgExcl.match(/shaper:cutType="online"/g) || []).length === 3, 'vcarve online cuts emitted instead');

    // 17. Preview-vs-export parity: same contour count and coordinates
    const previewContours = deriveVcarveContours(loopPolys[loop.id], state.vcarves[0]);
    const exportedPaths = [...svgMM.matchAll(/<path d="([^"]+)"[^>]*shaper:cutDepth="([^"]+)"/g)].map((m) => ({
      d: m[1],
      depth: m[2],
    }));
    eq(exportedPaths.length, previewContours.length, 'preview vs export contour count parity');
    for (let i = 0; i < previewContours.length; i++) {
      const wantD = polyToPathD(previewContours[i].polygon);
      eq(exportedPaths[i].d, wantD, `contour ${i} path d matches preview polygon`);
      eq(exportedPaths[i].depth, formatShaperParam(previewContours[i].depth, 'mm'), `contour ${i} depth matches preview`);
    }

    // 18. Parity on non-trivial triangle with 60° bit
    const triBoundary = [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 30, y: 50 }];
    const triState = {
      joints: new Map([['T1', { x: 0, y: 0 }], ['T2', { x: 60, y: 0 }], ['T3', { x: 30, y: 50 }]]),
      shapes: [
        { id: 't1', type: 'line', joints: ['T1', 'T2'] },
        { id: 't2', type: 'line', joints: ['T2', 'T3'] },
        { id: 't3', type: 'line', joints: ['T3', 'T1'] },
      ],
      constraints: [],
    };
    const triLoop = findLoops(triState)[0];
    const triRec = { id: 'vcTri', region: 'loop:' + triLoop.id, vbit: { angle: 60 }, dStep: 4, maxDepth: 12 };
    triState.vcarves = [triRec];
    const triLoopPolys = { [triLoop.id]: triBoundary };
    const triSVG = exportShaperSVG({ state: triState, entries: [], encoding: ENC5, docUnit: 'mm', loopPolys: triLoopPolys });
    const triPreview = deriveVcarveContours(triBoundary, triRec);
    const triExported = [...triSVG.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);
    eq(triExported.length, triPreview.length, 'tri preview vs export contour count parity');
    for (let i = 0; i < triPreview.length; i++) {
      eq(triExported[i], polyToPathD(triPreview[i].polygon), `tri contour ${i} path matches preview`);
    }
    // 19. Gating: zero vcarves (missing / [] / vcarve with no matching loop) → output BYTE-IDENTICAL to a no-vcarve state
    {
      const base = rectState();
      const bl = findLoops(base)[0];
      const entries = [{ target: { kind: 'loop', id: bl.id }, rec: { cutType: 'exterior', cutDepth: 6.35, toolDia: 3.175 } }];
      const none = exportShaperSVG({ state: base, entries, encoding: ENC5, docUnit: 'mm' });
      const emptyArr = exportShaperSVG({ state: { ...rectState(), vcarves: [] }, entries, encoding: ENC5, docUnit: 'mm', loopPolys: {} });
      const orphan = exportShaperSVG({ state: { ...rectState(), vcarves: [{ id: 'v', region: 'loop:loop_GONE', vbit: { angle: 90 }, dStep: 1, maxDepth: 5 }] }, entries, encoding: ENC5, docUnit: 'mm', loopPolys: {} });
      eq(emptyArr, none, 'vcarves: [] → byte-identical');
      eq(orphan, none, 'vcarve with no matching loop polygon → byte-identical');
    }

    // 20. VCARVE-5a: Dumbbell split loop export parity (17 split contours at depths 1..9mm)
    {
      const dbBoundary = [{x:0,y:0},{x:20,y:0},{x:20,y:8},{x:40,y:8},{x:40,y:0},{x:60,y:0},{x:60,y:20},{x:40,y:20},{x:40,y:12},{x:20,y:12},{x:20,y:20},{x:0,y:20}];
      const dbShapes = dbBoundary.map((_, i) => ({
        id: 'ds' + i,
        type: 'line',
        joints: ['D' + i, 'D' + ((i + 1) % dbBoundary.length)],
      }));
      const dbState = {
        joints: new Map(dbBoundary.map((p, i) => ['D' + i, { x: p.x, y: p.y }])),
        shapes: dbShapes,
        constraints: [],
      };
      const dbLoop = findLoops(dbState)[0];
      const dbRec = { id: 'vcDb', region: 'loop:' + dbLoop.id, vbit: { angle: 90 }, dStep: 1, maxDepth: 10 };
      dbState.vcarves = [dbRec];
      const dbLoopPolys = { [dbLoop.id]: dbBoundary };
      const dbSVG = exportShaperSVG({ state: dbState, entries: [], encoding: ENC5, docUnit: 'mm', loopPolys: dbLoopPolys });
      const dbPreview = deriveVcarveContours(dbBoundary, dbRec);
      eq(dbPreview.length, 17, 'dumbbell preview has 17 contours across split lobes');
      const dbExported = [...dbSVG.matchAll(/<path d="([^"]+)"[^>]*shaper:cutDepth="([^"]+)"/g)].map((m) => ({ d: m[1], depth: m[2] }));
      eq(dbExported.length, 17, 'dumbbell export emits all 17 split contours');
      for (let i = 0; i < dbPreview.length; i++) {
        eq(dbExported[i].d, polyToPathD(dbPreview[i].polygon), `db contour ${i} path matches preview`);
        eq(dbExported[i].depth, formatShaperParam(dbPreview[i].depth, 'mm'), `db contour ${i} depth matches preview`);
      }
    }

    // 21. Frame with hole (40×40 outer, 10×10 hole, NO group) preview vs export parity (14 contours),
    //     plus hole loop can ALSO carry its own independent cut if assigned.
    {
      const frameOuter = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }];
      const frameHole = [{ x: 15, y: 15 }, { x: 25, y: 15 }, { x: 25, y: 25 }, { x: 15, y: 25 }];
      const frameRec = { id: 'vcFrame', region: 'loop_outer', vbit: { angle: 90 }, dStep: 1, maxDepth: 10 };
      const frameState = {
        joints: new Map([
          ['FO0', { x: 0, y: 0 }], ['FO1', { x: 40, y: 0 }], ['FO2', { x: 40, y: 40 }], ['FO3', { x: 0, y: 40 }],
          ['FH0', { x: 15, y: 15 }], ['FH1', { x: 25, y: 15 }], ['FH2', { x: 25, y: 25 }], ['FH3', { x: 15, y: 25 }],
        ]),
        shapes: [
          { id: 'so1', type: 'line', joints: ['FO0', 'FO1'] },
          { id: 'so2', type: 'line', joints: ['FO1', 'FO2'] },
          { id: 'so3', type: 'line', joints: ['FO2', 'FO3'] },
          { id: 'so4', type: 'line', joints: ['FO3', 'FO0'] },
          { id: 'sh1', type: 'line', joints: ['FH0', 'FH1'] },
          { id: 'sh2', type: 'line', joints: ['FH1', 'FH2'] },
          { id: 'sh3', type: 'line', joints: ['FH2', 'FH3'] },
          { id: 'sh4', type: 'line', joints: ['FH3', 'FH0'] },
        ],
        groups: [],
        profiles: [],
        constraints: [],
        vcarves: [frameRec],
      };
      const outerLoops = findLoops(frameState);
      const outerLoop = outerLoops.find((l) => l.edges.includes('so1'));
      const holeLoop = outerLoops.find((l) => l.edges.includes('sh1'));
      frameRec.region = 'loop:' + outerLoop.id;
      const loopPolys = { [outerLoop.id]: frameOuter, [holeLoop.id]: frameHole };

      // a) V-carve on outer profile only (no cut on hole): emits 14 vcarve contours, hole not emitted separately
      const frameSVG = exportShaperSVG({
        state: frameState,
        entries: [],
        encoding: ENC5,
        docUnit: 'mm',
        loopPolys,
      });
      const framePreview = deriveVcarveContours(frameOuter, frameRec, { holes: [frameHole] });
      eq(framePreview.length, 14, 'frame preview has 14 contours');
      const frameExported = [...frameSVG.matchAll(/<path d="([^"]+)"[^>]*shaper:cutDepth="([^"]+)"/g)].map((m) => ({ d: m[1], depth: m[2] }));
      eq(frameExported.length, 14, 'frame export emits all 14 contours');
      eq((frameSVG.match(/<path /g) || []).length, 14, 'no extra path when hole has no cut assigned');
      for (let i = 0; i < framePreview.length; i++) {
        eq(frameExported[i].d, polyToPathD(framePreview[i].polygon), `frame contour ${i} path matches preview`);
        eq(frameExported[i].depth, formatShaperParam(framePreview[i].depth, 'mm'), `frame contour ${i} depth matches preview`);
      }

      // b) Hole ALSO assigned its own interior cut: hole bounds outer vcarve AND exports its own inside cut
      const frameSVGWithHoleCut = exportShaperSVG({
        state: frameState,
        entries: [{ target: { kind: 'loop', id: holeLoop.id }, rec: { cutType: 'interior' } }],
        encoding: ENC5,
        docUnit: 'mm',
        loopPolys,
      });
      eq((frameSVGWithHoleCut.match(/<path /g) || []).length, 15, '14 vcarve contours + 1 interior path for hole own cut');
      assert(frameSVGWithHoleCut.includes('shaper:cutType="inside"'), 'hole own interior cut is preserved');
    }

    // 22. TASK 432: Pocket bullseye exact-string oracle (NO group anywhere).
    //     Outer's derived profile has ONLY its direct hole (15..45); the depth-2 island dot (25..35) is NOT absorbed,
    //     and is exported only when assigned its own cut, as its own path.
    {
      const bullState = {
        joints: new Map([
          ['O0', { x: 0, y: 0 }], ['O1', { x: 60, y: 0 }], ['O2', { x: 60, y: 60 }], ['O3', { x: 0, y: 60 }],
          ['H0', { x: 15, y: 15 }], ['H1', { x: 45, y: 15 }], ['H2', { x: 45, y: 45 }], ['H3', { x: 15, y: 45 }],
          ['D0', { x: 25, y: 25 }], ['D1', { x: 35, y: 25 }], ['D2', { x: 35, y: 35 }], ['D3', { x: 25, y: 35 }],
        ]),
        shapes: [
          { id: 'so1', type: 'line', joints: ['O0', 'O1'] },
          { id: 'so2', type: 'line', joints: ['O1', 'O2'] },
          { id: 'so3', type: 'line', joints: ['O2', 'O3'] },
          { id: 'so4', type: 'line', joints: ['O3', 'O0'] },
          { id: 'sh1', type: 'line', joints: ['H0', 'H1'] },
          { id: 'sh2', type: 'line', joints: ['H1', 'H2'] },
          { id: 'sh3', type: 'line', joints: ['H2', 'H3'] },
          { id: 'sh4', type: 'line', joints: ['H3', 'H0'] },
          { id: 'sd1', type: 'line', joints: ['D0', 'D1'] },
          { id: 'sd2', type: 'line', joints: ['D1', 'D2'] },
          { id: 'sd3', type: 'line', joints: ['D2', 'D3'] },
          { id: 'sd4', type: 'line', joints: ['D3', 'D0'] },
        ],
        groups: [],
        profiles: [],
        constraints: [],
      };
      const outerPoly = [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 60 }, { x: 0, y: 60 }];
      const holePoly = [{ x: 15, y: 15 }, { x: 45, y: 15 }, { x: 45, y: 45 }, { x: 15, y: 45 }];
      const dotPoly = [{ x: 25, y: 25 }, { x: 35, y: 25 }, { x: 35, y: 35 }, { x: 25, y: 35 }];

      const loops = findLoops(bullState);
      const outerLoop = loops.find((l) => l.edges.includes('so1'));
      const holeLoop = loops.find((l) => l.edges.includes('sh1'));
      const dotLoop = loops.find((l) => l.edges.includes('sd1'));
      const loopPolys = {
        [outerLoop.id]: outerPoly,
        [holeLoop.id]: holePoly,
        [dotLoop.id]: dotPoly,
      };

      const gotOuterOnly = exportShaperSVG({
        state: bullState,
        entries: [{ target: { kind: 'loop', id: outerLoop.id }, rec: { cutType: 'pocket' } }],
        encoding: ENC5,
        docUnit: 'mm',
        loopPolys,
      });

      const wantOuterOnly = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:shaper="http://www.shapertools.com/namespaces/shaper" width="60mm" height="60mm" viewBox="0 0 60 60">\n' +
        '  <path d="M 0 0 L 60 0 L 60 60 L 0 60 Z M 15 15 L 15 45 L 45 45 L 45 15 Z" fill="#7F7F7F" shaper:cutType="pocket" shaper:cutOffset="0mm"/>\n' +
        '</svg>';

      eq(gotOuterOnly, wantOuterOnly, 'pocket bullseye outer-only export has direct hole only (island uncut)');

      // When the dot island ALSO has its own cut, it is exported as its own separate path
      const gotWithIslandCut = exportShaperSVG({
        state: bullState,
        entries: [
          { target: { kind: 'loop', id: outerLoop.id }, rec: { cutType: 'pocket', cutDepth: 6 } },
          { target: { kind: 'loop', id: dotLoop.id }, rec: { cutType: 'exterior', cutDepth: 12 } },
        ],
        encoding: ENC5,
        docUnit: 'mm',
        loopPolys,
      });

      const wantWithIslandCut = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:shaper="http://www.shapertools.com/namespaces/shaper" width="60mm" height="60mm" viewBox="0 0 60 60">\n' +
        '  <path d="M 0 0 L 60 0 L 60 60 L 0 60 Z M 15 15 L 15 45 L 45 45 L 45 15 Z" fill="#7F7F7F" shaper:cutType="pocket" shaper:cutDepth="6.000 mm" shaper:cutOffset="0mm"/>\n' +
        '  <path d="M 25 25 L 35 25 L 35 35 L 25 35 Z" fill="#000000" shaper:cutType="outside" shaper:cutDepth="12.000 mm" shaper:cutOffset="0mm"/>\n' +
        '</svg>';

      eq(gotWithIslandCut, wantWithIslandCut, 'pocket bullseye + island own cut exports compound outer + separate island path');
    }
  }

  // ── TASK 433b: Profile Cut Semantics on Profiles with Holes ──
  {
    const frameState = {
      joints: new Map([
        ['O0', { x: 0, y: 0 }], ['O1', { x: 60, y: 0 }], ['O2', { x: 60, y: 60 }], ['O3', { x: 0, y: 60 }],
        ['H0', { x: 20, y: 20 }], ['H1', { x: 40, y: 20 }], ['H2', { x: 40, y: 40 }], ['H3', { x: 20, y: 40 }],
      ]),
      shapes: [
        { id: 'so1', type: 'line', joints: ['O0', 'O1'] },
        { id: 'so2', type: 'line', joints: ['O1', 'O2'] },
        { id: 'so3', type: 'line', joints: ['O2', 'O3'] },
        { id: 'so4', type: 'line', joints: ['O3', 'O0'] },
        { id: 'sh1', type: 'line', joints: ['H0', 'H1'] },
        { id: 'sh2', type: 'line', joints: ['H1', 'H2'] },
        { id: 'sh3', type: 'line', joints: ['H2', 'H3'] },
        { id: 'sh4', type: 'line', joints: ['H3', 'H0'] },
      ],
      groups: [],
      profiles: [],
      constraints: [],
    };
    const outerPoly = [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 60 }, { x: 0, y: 60 }];
    const holePoly = [{ x: 20, y: 20 }, { x: 40, y: 20 }, { x: 40, y: 40 }, { x: 20, y: 40 }];
    const loops = findLoops(frameState);
    const outerLoop = loops.find((l) => l.edges.includes('so1'));
    const holeLoop = loops.find((l) => l.edges.includes('sh1'));
    const loopPolys = {
      [outerLoop.id]: outerPoly,
      [holeLoop.id]: holePoly,
    };

    // 23. Test 1: Exterior (Outside) cut on profile with hole → hole as inside first, outer as outside last
    {
      const svg = exportShaperSVG({
        state: frameState,
        entries: [{ target: { kind: 'loop', id: outerLoop.id }, rec: { cutType: 'exterior' } }],
        encoding: ENC5,
        docUnit: 'mm',
        loopPolys,
      });
      const want = [
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:shaper="http://www.shapertools.com/namespaces/shaper" width="60mm" height="60mm" viewBox="0 0 60 60">',
        '  <path d="M 20 20 L 40 20 L 40 40 L 20 40 Z" fill="#FFFFFF" stroke="#000000" shaper:cutType="inside" shaper:cutOffset="0mm"/>',
        '  <path d="M 0 0 L 60 0 L 60 60 L 0 60 Z" fill="#000000" shaper:cutType="outside" shaper:cutOffset="0mm"/>',
        '</svg>',
      ].join('\n');
      eq(svg, want, 'TASK 433b test 1: exterior cut on profile with hole');
    }

    // 24. Test 2: Interior (Inside) cut on profile with hole → duality: hole as outside first, outer as inside last
    {
      const svg = exportShaperSVG({
        state: frameState,
        entries: [{ target: { kind: 'loop', id: outerLoop.id }, rec: { cutType: 'interior' } }],
        encoding: ENC5,
        docUnit: 'mm',
        loopPolys,
      });
      const want = [
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:shaper="http://www.shapertools.com/namespaces/shaper" width="60mm" height="60mm" viewBox="0 0 60 60">',
        '  <path d="M 20 20 L 40 20 L 40 40 L 20 40 Z" fill="#000000" shaper:cutType="outside" shaper:cutOffset="0mm"/>',
        '  <path d="M 0 0 L 60 0 L 60 60 L 0 60 Z" fill="#FFFFFF" stroke="#000000" shaper:cutType="inside" shaper:cutOffset="0mm"/>',
        '</svg>',
      ].join('\n');
      eq(svg, want, 'TASK 433b test 2: interior cut on profile with hole');
    }

    // 25. Test 3: Pocket cut on profile with hole → compound evenodd path
    {
      const svg = exportShaperSVG({
        state: frameState,
        entries: [{ target: { kind: 'loop', id: outerLoop.id }, rec: { cutType: 'pocket' } }],
        encoding: ENC5,
        docUnit: 'mm',
        loopPolys,
      });
      const want = [
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:shaper="http://www.shapertools.com/namespaces/shaper" width="60mm" height="60mm" viewBox="0 0 60 60">',
        '  <path d="M 0 0 L 60 0 L 60 60 L 0 60 Z M 20 20 L 20 40 L 40 40 L 40 20 Z" fill="#7F7F7F" shaper:cutType="pocket" shaper:cutOffset="0mm"/>',
        '</svg>',
      ].join('\n');
      eq(svg, want, 'TASK 433b test 3: pocket cut on profile with hole');
    }

    // 26. Test 4: On line cut on profile with hole → separate paths, hole first, then outer
    {
      const svg = exportShaperSVG({
        state: frameState,
        entries: [{ target: { kind: 'loop', id: outerLoop.id }, rec: { cutType: 'online' } }],
        encoding: ENC5,
        docUnit: 'mm',
        loopPolys,
      });
      const want = [
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:shaper="http://www.shapertools.com/namespaces/shaper" width="60mm" height="60mm" viewBox="0 0 60 60">',
        '  <path d="M 20 20 L 40 20 L 40 40 L 20 40 Z" fill="none" stroke="#7F7F7F" shaper:cutType="online" shaper:cutOffset="0mm"/>',
        '  <path d="M 0 0 L 60 0 L 60 60 L 0 60 Z" fill="none" stroke="#7F7F7F" shaper:cutType="online" shaper:cutOffset="0mm"/>',
        '</svg>',
      ].join('\n');
      eq(svg, want, 'TASK 433b test 4: online cut on profile with hole');
    }

    // 27. Test 5: Guide on profile with hole → separate paths, hole first, then outer
    {
      const svg = exportShaperSVG({
        state: frameState,
        entries: [{ target: { kind: 'loop', id: outerLoop.id }, rec: { cutType: 'guide' } }],
        encoding: ENC5,
        docUnit: 'mm',
        loopPolys,
      });
      const want = [
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:shaper="http://www.shapertools.com/namespaces/shaper" width="60mm" height="60mm" viewBox="0 0 60 60">',
        '  <path d="M 20 20 L 40 20 L 40 40 L 20 40 Z" fill="#0068FF" stroke="#0068FF" shaper:cutType="guide" shaper:cutOffset="0mm"/>',
        '  <path d="M 0 0 L 60 0 L 60 60 L 0 60 Z" fill="#0068FF" stroke="#0068FF" shaper:cutType="guide" shaper:cutOffset="0mm"/>',
        '</svg>',
      ].join('\n');
      eq(svg, want, 'TASK 433b test 5: guide on profile with hole');
    }

    // 28. Test 6 (Q4 decision): Outer profile Outside + hole\'s own loop record On line → 3 paths emitted
    {
      const svg = exportShaperSVG({
        state: frameState,
        entries: [
          { target: { kind: 'loop', id: outerLoop.id }, rec: { cutType: 'exterior' } },
          { target: { kind: 'loop', id: holeLoop.id }, rec: { cutType: 'online' } },
        ],
        encoding: ENC5,
        docUnit: 'mm',
        loopPolys,
      });
      const want = [
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:shaper="http://www.shapertools.com/namespaces/shaper" width="60mm" height="60mm" viewBox="0 0 60 60">',
        '  <path d="M 20 20 L 40 20 L 40 40 L 20 40 Z" fill="#FFFFFF" stroke="#000000" shaper:cutType="inside" shaper:cutOffset="0mm"/>',
        '  <path d="M 0 0 L 60 0 L 60 60 L 0 60 Z" fill="#000000" shaper:cutType="outside" shaper:cutOffset="0mm"/>',
        '  <path d="M 20 20 L 40 20 L 40 40 L 20 40 Z" fill="none" stroke="#7F7F7F" shaper:cutType="online" shaper:cutOffset="0mm"/>',
        '</svg>',
      ].join('\n');
      eq(svg, want, 'TASK 433b test 6: Q4 outer outside + hole own online = 3 paths');
    }
  }

  console.log('shaper-export tests passed ✅');
})().catch((e) => { console.error('shaper-export tests failed ❌', e); process.exit(1); });
