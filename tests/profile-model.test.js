import { makeProfile, uncombineProfile, validateCombine, profileForLoop, profileForShape, profilesOf, resolveProfiles, resolveProfileForLoop, resolveProfileAtPoint, derivedProfileForLoop, directlyContainedLoops, cloneProfiles } from '#core/profile-model.js';
import { doCombine, doUncombine } from '#ui/profile-actions.js';
import { findLoops } from '#core/loop-finder.js';
import { loopPolygon, polyArea } from '#core/loop-geometry.js';
import { createEngine } from '#core/constraint-solver.js';
import { createSketchState } from '#ui/sketch-state.js';
import { serializeDocument, deserializeDocument } from '#core/document.js';
import { findCornerAtJoint, applyFillet } from '#core/fillet.js';

(async () => {
  const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };
  const polysFor = (state) => {
    const sb = new Map((state.shapes || []).map((s) => [s.id, s]));
    const loops = findLoops(state);
    return Object.fromEntries(loops.map((l) => [l.id, loopPolygon(l, state, sb)]));
  };

  const createFrameState = (outerSize = 40, holeSize = 10, holeOffset = 15) => {
    const joints = new Map([
      ['O0', { x: 0, y: 0 }], ['O1', { x: outerSize, y: 0 }], ['O2', { x: outerSize, y: outerSize }], ['O3', { x: 0, y: outerSize }],
      ['H0', { x: holeOffset, y: holeOffset }], ['H1', { x: holeOffset + holeSize, y: holeOffset }],
      ['H2', { x: holeOffset + holeSize, y: holeOffset + holeSize }], ['H3', { x: holeOffset, y: holeOffset + holeSize }],
    ]);
    const shapes = [
      { id: 'so1', type: 'line', joints: ['O0', 'O1'] },
      { id: 'so2', type: 'line', joints: ['O1', 'O2'] },
      { id: 'so3', type: 'line', joints: ['O2', 'O3'] },
      { id: 'so4', type: 'line', joints: ['O3', 'O0'] },
      { id: 'sh1', type: 'line', joints: ['H0', 'H1'] },
      { id: 'sh2', type: 'line', joints: ['H1', 'H2'] },
      { id: 'sh3', type: 'line', joints: ['H2', 'H3'] },
      { id: 'sh4', type: 'line', joints: ['H3', 'H0'] },
    ];
    const constraints = [
      { id: 'c1', type: 'coincident', joints: ['O0', 'O0'] },
    ];
    return { joints, shapes, constraints, profiles: [], groups: [] };
  };

  // 1. validateCombine cases
  {
    const state = createFrameState();
    const loops = findLoops(state);
    const loopPolys = polysFor(state);

    // a) < 2 loops selected -> invalid
    const resUnder2 = validateCombine(['so1', 'so2', 'so3', 'so4'], loops, loopPolys);
    assert(!resUnder2.ok, '< 2 loops must fail validation');

    // b) Valid frame -> ok
    const allShapes = state.shapes.map(s => s.id);
    const resValid = validateCombine(allShapes, loops, loopPolys);
    assert(resValid.ok, 'valid frame must pass validation');
    assert(resValid.outerLoop.edges.includes('so1'), 'outer loop recognized by area');
    assert(resValid.innerLoops.length === 1 && resValid.innerLoops[0].edges.includes('sh1'), 'inner hole loop recognized');

    // c) Hole strictly outside outer boundary -> invalid
    const outsideState = createFrameState(40, 10, 50); // hole at x=50..60 (outside 0..40)
    const outLoops = findLoops(outsideState);
    const outPolys = polysFor(outsideState);
    const resOut = validateCombine(outsideState.shapes.map(s => s.id), outLoops, outPolys);
    assert(!resOut.ok && resOut.reason.includes('contained'), 'outside hole must fail containment check');

    // d) Crossing: hole intersects outer boundary -> invalid
    const crossingState = createFrameState(40, 20, 30); // hole at 30..50 (crosses outer wall at 40)
    const crossLoops = findLoops(crossingState);
    const crossPolys = polysFor(crossingState);
    const resCross = validateCombine(crossingState.shapes.map(s => s.id), crossLoops, crossPolys);
    assert(!resCross.ok, 'crossing boundary must fail validation');

    // e) Nested: outer contains hole1, and hole1 contains hole2 (bullseye) -> invalid
    const bullState = {
      joints: new Map([
        ['O0', { x: 0, y: 0 }], ['O1', { x: 60, y: 0 }], ['O2', { x: 60, y: 60 }], ['O3', { x: 0, y: 60 }],
        ['H0', { x: 15, y: 15 }], ['H1', { x: 45, y: 15 }], ['H2', { x: 45, y: 45 }], ['H3', { x: 15, y: 45 }],
        ['D0', { x: 25, y: 25 }], ['D1', { x: 35, y: 25 }], ['D2', { x: 35, y: 35 }], ['D3', { x: 25, y: 35 }],
      ]),
      shapes: [
        { id: 'so1', type: 'line', joints: ['O0', 'O1'] }, { id: 'so2', type: 'line', joints: ['O1', 'O2'] },
        { id: 'so3', type: 'line', joints: ['O2', 'O3'] }, { id: 'so4', type: 'line', joints: ['O3', 'O0'] },
        { id: 'sh1', type: 'line', joints: ['H0', 'H1'] }, { id: 'sh2', type: 'line', joints: ['H1', 'H2'] },
        { id: 'sh3', type: 'line', joints: ['H2', 'H3'] }, { id: 'sh4', type: 'line', joints: ['H3', 'H0'] },
        { id: 'sd1', type: 'line', joints: ['D0', 'D1'] }, { id: 'sd2', type: 'line', joints: ['D1', 'D2'] },
        { id: 'sd3', type: 'line', joints: ['D2', 'D3'] }, { id: 'sd4', type: 'line', joints: ['D3', 'D0'] },
      ],
      constraints: [],
    };
    const bLoops = findLoops(bullState);
    const bPolys = polysFor(bullState);
    const resNested = validateCombine(bullState.shapes.map(s => s.id), bLoops, bPolys);
    assert(!resNested.ok && resNested.reason.includes('Nested'), 'nested hole inside hole must fail validation');
  }

  // 2. makeProfile & uncombineProfile & queries
  {
    const state = createFrameState();
    const loops = findLoops(state);
    const loopPolys = polysFor(state);
    const val = validateCombine(state.shapes.map(s => s.id), loops, loopPolys);
    assert(val.ok);

    const prof = makeProfile(state, val.outerLoop, val.innerLoops);
    assert(prof && prof.id === 'profile-1', 'mints profile-1');
    assert(prof.outer === val.outerLoop.id, 'stores outer loop id');
    assert(prof.inners.length === 1 && prof.inners[0] === val.innerLoops[0].id, 'stores inner loop id');
    assert(profilesOf(state).length === 1, 'profilesOf lists profile');

    assert(profileForLoop(val.outerLoop.id, state)?.id === 'profile-1', 'profileForLoop finds by outer');
    assert(profileForLoop(val.innerLoops[0].id, state)?.id === 'profile-1', 'profileForLoop finds by inner');
    assert(profileForShape('so1', state)?.id === 'profile-1', 'profileForShape finds by outer shape');
    assert(profileForShape('sh1', state)?.id === 'profile-1', 'profileForShape finds by inner shape');

    const uncombined = uncombineProfile(state, prof.id);
    assert(uncombined, 'uncombineProfile returns true');
    assert(profilesOf(state).length === 0, 'profilesOf is empty after uncombine');
  }

  // 3. Undo / Redo integration
  {
    const engine = createEngine(null);
    const state = createSketchState(engine, { x: 0, y: 0, w: 100, h: 100 });
    const f = createFrameState();
    for (const [k, v] of f.joints) state.joints.set(k, { ...v });
    state.shapes.push(...f.shapes.map(s => ({ ...s, joints: [...s.joints] })));

    state.saveState();
    const loops = findLoops(state);
    const loopPolys = polysFor(state);
    const val = validateCombine(state.shapes.map(s => s.id), loops, loopPolys);
    assert(val.ok);

    makeProfile(state, val.outerLoop, val.innerLoops);
    assert(state.profiles.length === 1, 'profile created');

    state.undo();
    assert(state.profiles.length === 0, 'undo removes profile');

    state.redo();
    assert(state.profiles.length === 1 && state.profiles[0].id === 'profile-1', 'redo restores profile');
  }

  // 4. Document serialization round-trip
  {
    const state = createFrameState();
    const loops = findLoops(state);
    const loopPolys = polysFor(state);
    const val = validateCombine(state.shapes.map(s => s.id), loops, loopPolys);
    makeProfile(state, val.outerLoop, val.innerLoops);

    const doc = serializeDocument(state);
    assert(Array.isArray(doc.geometry.profiles) && doc.geometry.profiles.length === 1, 'serialized doc has profiles');

    const newState = {
      joints: new Map(),
      shapes: [],
      constraints: [],
      sketches: [],
      groups: [],
      profiles: [],
      vcarves: [],
    };
    const res = deserializeDocument(doc, newState);
    assert(res.ok, 'deserializeDocument succeeds');
    assert(newState.profiles.length === 1, 'restores 1 profile');
    assert(newState.profiles[0].id === 'profile-1', 'restores profile-1');
    assert(newState.profiles[0].outerShapes.length === 4, 'restores outerShapes');
    assert(newState.profiles[0].innerShapes[0].length === 4, 'restores innerShapes');
  }

  // 5. TOPOLOGY EDIT: FILLET an outer corner -> profile still has its hole and updates outerShapes
  {
    const state = createFrameState();
    const loops = findLoops(state);
    const loopPolys = polysFor(state);
    const val = validateCombine(state.shapes.map(s => s.id), loops, loopPolys);
    const prof = makeProfile(state, val.outerLoop, val.innerLoops);

    // Fillet corner at O1 (x=40, y=0 between so1 and so2)
    const corner = findCornerAtJoint(state, 'O1');
    assert(corner && corner.cornerJointId === 'O1', 'finds valid corner at O1');
    const fRes = applyFillet(state, corner, 5);
    assert(fRes && fRes.arc, 'fillet applied successfully');

    // Re-resolve loops and profiles
    const newLoops = findLoops(state);
    const newPolys = polysFor(state);
    resolveProfiles(state, newLoops, newPolys);

    assert(!prof.invalid, 'profile is STILL VALID after outer corner fillet');
    assert(prof.inners.length === 1, 'profile still has its hole');
    assert(prof.outerShapes.length === 5, 'outerShapes updated to 5 shapes (4 lines + 1 fillet arc)');
    assert(prof.outer !== val.outerLoop.id, 'outer loop id updated to new topological id containing the arc');
  }

  // 6. TOPOLOGY EDIT: FILLET a hole corner -> profile still has outer and updates innerShapes
  {
    const state = createFrameState();
    const loops = findLoops(state);
    const loopPolys = polysFor(state);
    const val = validateCombine(state.shapes.map(s => s.id), loops, loopPolys);
    const prof = makeProfile(state, val.outerLoop, val.innerLoops);

    // Fillet hole corner at H1 (x=25, y=15 between sh1 and sh2)
    const corner = findCornerAtJoint(state, 'H1');
    assert(corner && corner.cornerJointId === 'H1', 'finds valid hole corner at H1');
    const fRes = applyFillet(state, corner, 2);
    assert(fRes && fRes.arc, 'fillet applied on hole corner');

    // Re-resolve
    const newLoops = findLoops(state);
    const newPolys = polysFor(state);
    resolveProfiles(state, newLoops, newPolys);

    assert(!prof.invalid, 'profile is STILL VALID after hole corner fillet');
    assert(prof.outerShapes.length === 4, 'outer shapes intact');
    assert(prof.innerShapes[0].length === 5, 'hole shapes updated to 5 shapes (4 lines + 1 fillet arc)');
  }

  // 7. TOPOLOGY EDIT: Delete hole edges -> profile is marked INVALID with reason
  {
    const state = createFrameState();
    const loops = findLoops(state);
    const loopPolys = polysFor(state);
    const val = validateCombine(state.shapes.map(s => s.id), loops, loopPolys);
    const prof = makeProfile(state, val.outerLoop, val.innerLoops);

    // Delete one edge of the hole (sh1)
    state.shapes = state.shapes.filter(s => s.id !== 'sh1');

    const newLoops = findLoops(state);
    const newPolys = polysFor(state);
    resolveProfiles(state, newLoops, newPolys);

    assert(prof.invalid === true, 'profile must be marked INVALID when hole is broken');
    assert(prof.invalidReason && prof.invalidReason.includes('Hole'), `invalidReason must explain hole issue, got: ${prof.invalidReason}`);
  }

  // 8. DERIVED FACE RESOLVER & COMBINE OVERRIDE (AMENDMENT 4, FINAL)
  {
    // a) Frame: outer has 1 hole, inner hole has 0 holes
    const frameState = createFrameState();
    const fLoops = findLoops(frameState);
    const fPolys = polysFor(frameState);
    const outerL = fLoops.find(l => l.edges.includes('so1'));
    const innerL = fLoops.find(l => l.edges.includes('sh1'));

    const outerFace = derivedProfileForLoop(outerL.id, fLoops, fPolys);
    assert(outerFace.isDerived, 'frame outer face is derived');
    assert(outerFace.outer === outerL.id, 'outerFace outer matches');
    assert(outerFace.inners.length === 1 && outerFace.inners[0] === innerL.id, 'frame outer derived face has hole');

    const innerFace = derivedProfileForLoop(innerL.id, fLoops, fPolys);
    assert(innerFace.isDerived, 'frame inner face is derived');
    assert(innerFace.outer === innerL.id, 'innerFace outer matches');
    assert(innerFace.inners.length === 0, 'frame hole derived face has 0 holes');

    // b) Bullseye: Outer (60x60), Middle (40x40), Center Island (20x20)
    const bullState = {
      joints: new Map([
        ['O0', { x: 0, y: 0 }], ['O1', { x: 60, y: 0 }], ['O2', { x: 60, y: 60 }], ['O3', { x: 0, y: 60 }],
        ['M0', { x: 10, y: 10 }], ['M1', { x: 50, y: 10 }], ['M2', { x: 50, y: 50 }], ['M3', { x: 10, y: 50 }],
        ['D0', { x: 20, y: 20 }], ['D1', { x: 40, y: 20 }], ['D2', { x: 40, y: 40 }], ['D3', { x: 20, y: 40 }],
      ]),
      shapes: [
        { id: 'so1', type: 'line', joints: ['O0', 'O1'] }, { id: 'so2', type: 'line', joints: ['O1', 'O2'] },
        { id: 'so3', type: 'line', joints: ['O2', 'O3'] }, { id: 'so4', type: 'line', joints: ['O3', 'O0'] },
        { id: 'sm1', type: 'line', joints: ['M0', 'M1'] }, { id: 'sm2', type: 'line', joints: ['M1', 'M2'] },
        { id: 'sm3', type: 'line', joints: ['M2', 'M3'] }, { id: 'sm4', type: 'line', joints: ['M3', 'M0'] },
        { id: 'sd1', type: 'line', joints: ['D0', 'D1'] }, { id: 'sd2', type: 'line', joints: ['D1', 'D2'] },
        { id: 'sd3', type: 'line', joints: ['D2', 'D3'] }, { id: 'sd4', type: 'line', joints: ['D3', 'D0'] },
      ],
      constraints: [],
    };
    const bLoops = findLoops(bullState);
    const bPolys = polysFor(bullState);
    const bOuter = bLoops.find(l => l.edges.includes('so1'));
    const bMiddle = bLoops.find(l => l.edges.includes('sm1'));
    const bDot = bLoops.find(l => l.edges.includes('sd1'));

    const bOuterFace = derivedProfileForLoop(bOuter.id, bLoops, bPolys);
    assert(bOuterFace.inners.length === 1 && bOuterFace.inners[0] === bMiddle.id, 'outer face has middle hole only (dot excluded!)');

    const bMiddleFace = derivedProfileForLoop(bMiddle.id, bLoops, bPolys);
    assert(bMiddleFace.inners.length === 1 && bMiddleFace.inners[0] === bDot.id, 'middle face has center dot hole');

    const bDotFace = derivedProfileForLoop(bDot.id, bLoops, bPolys);
    assert(bDotFace.inners.length === 0, 'center island dot is its own face with 0 holes');

    // c) Two separate shapes side by side (no containment -> no holes)
    const sideState = {
      joints: new Map([
        ['A0', { x: 0, y: 0 }], ['A1', { x: 20, y: 0 }], ['A2', { x: 20, y: 20 }], ['A3', { x: 0, y: 20 }],
        ['B0', { x: 40, y: 0 }], ['B1', { x: 60, y: 0 }], ['B2', { x: 60, y: 20 }], ['B3', { x: 40, y: 20 }],
      ]),
      shapes: [
        { id: 'sa1', type: 'line', joints: ['A0', 'A1'] }, { id: 'sa2', type: 'line', joints: ['A1', 'A2'] },
        { id: 'sa3', type: 'line', joints: ['A2', 'A3'] }, { id: 'sa4', type: 'line', joints: ['A3', 'A0'] },
        { id: 'sb1', type: 'line', joints: ['B0', 'B1'] }, { id: 'sb2', type: 'line', joints: ['B1', 'B2'] },
        { id: 'sb3', type: 'line', joints: ['B2', 'B3'] }, { id: 'sb4', type: 'line', joints: ['B3', 'B0'] },
      ],
      constraints: [],
    };
    const sLoops = findLoops(sideState);
    const sPolys = polysFor(sideState);
    const sA = sLoops.find(l => l.edges.includes('sa1'));
    const sB = sLoops.find(l => l.edges.includes('sb1'));

    const faceA = derivedProfileForLoop(sA.id, sLoops, sPolys);
    assert(faceA.inners.length === 0, 'shape A has 0 holes');
    const faceB = derivedProfileForLoop(sB.id, sLoops, sPolys);
    assert(faceB.inners.length === 0, 'shape B has 0 holes');

    // d) resolveProfileAtPoint (point picking in derived faces)
    // Point in outer ring of bullseye (x=5, y=5)
    const profAtOuter = resolveProfileAtPoint({ x: 5, y: 5 }, bullState, bLoops, bPolys);
    assert(profAtOuter.outer === bOuter.id && profAtOuter.inners[0] === bMiddle.id, 'point in outer ring resolves outer face');

    // Point in middle ring of bullseye (x=15, y=15)
    const profAtMiddle = resolveProfileAtPoint({ x: 15, y: 15 }, bullState, bLoops, bPolys);
    assert(profAtMiddle.outer === bMiddle.id && profAtMiddle.inners[0] === bDot.id, 'point in middle ring resolves middle face');

    // Point in center dot of bullseye (x=30, y=30)
    const profAtDot = resolveProfileAtPoint({ x: 30, y: 30 }, bullState, bLoops, bPolys);
    assert(profAtDot.outer === bDot.id && profAtDot.inners.length === 0, 'point in center dot resolves dot face');

    // Point outside everything (x=100, y=100)
    const profOutside = resolveProfileAtPoint({ x: 100, y: 100 }, bullState, bLoops, bPolys);
    assert(profOutside === null, 'point outside resolves null');

    // e) Combined profile overrides derived face
    const cFrameState = createFrameState();
    const cLoops = findLoops(cFrameState);
    const cPolys = polysFor(cFrameState);
    const cOuterL = cLoops.find(l => l.edges.includes('so1'));
    const cInnerL = cLoops.find(l => l.edges.includes('sh1'));
    const combinedProf = makeProfile(cFrameState, cOuterL, [cInnerL], 'Custom Combined');

    const resolvedOuter = resolveProfileForLoop(cOuterL.id, cFrameState, cLoops, cPolys);
    assert(resolvedOuter.id === combinedProf.id && !resolvedOuter.isDerived, 'combined profile overrides derived for outer');

    const resolvedInner = resolveProfileForLoop(cInnerL.id, cFrameState, cLoops, cPolys);
    assert(resolvedInner.id === combinedProf.id && !resolvedInner.isDerived, 'combined profile overrides derived for inner');

    const resolvedPoint = resolveProfileAtPoint({ x: 5, y: 5 }, cFrameState, cLoops, cPolys);
    assert(resolvedPoint.id === combinedProf.id && !resolvedPoint.isDerived, 'combined profile overrides derived for point pick');

    // f) Uncombine restores derived face
    uncombineProfile(cFrameState, combinedProf.id);
    const resolvedAfterUncombine = resolveProfileForLoop(cOuterL.id, cFrameState, cLoops, cPolys);
    assert(resolvedAfterUncombine.isDerived && resolvedAfterUncombine.inners.length === 1, 'uncombine restores derived face');
  }

  // 9. cloneProfiles deep copy verification
  {
    const orig = [
      {
        id: 'p1',
        name: 'Profile 1',
        outer: 'l1',
        inners: ['l2', 'l3'],
        outerShapes: ['s1', 's2'],
        innerShapes: [['s3', 's4'], ['s5', 's6']],
      },
    ];
    const cloned = cloneProfiles(orig);
    assert(cloned.length === 1, 'clones array');
    assert(cloned[0].id === 'p1', 'clones id');
    // Mutate clone
    cloned[0].inners.push('l4');
    cloned[0].outerShapes.push('s99');
    cloned[0].innerShapes[0].push('s99');
    assert(orig[0].inners.length === 2, 'orig inners not mutated');
    assert(orig[0].outerShapes.length === 2, 'orig outerShapes not mutated');
    assert(orig[0].innerShapes[0].length === 2, 'orig innerShapes not mutated');
  }

  // 10. doCombine and doUncombine UI action helpers
  {
    let lastToast = '';
    const notify = (msg) => { lastToast = msg; };

    const state = createFrameState();
    state.selectedShapes = new Set(['so1']); // only 1 shape
    const r1 = doCombine(state, notify);
    assert(r1 === null, 'doCombine fails on < 2 shapes');
    assert(lastToast.includes('Select shapes forming at least 2 closed loops'), 'toast explains failure');

    // Select all 8 shapes of the frame
    state.selectedShapes = new Set(state.shapes.map(s => s.id));
    const r2 = doCombine(state, notify);
    assert(r2 && r2.id === 'profile-1', 'doCombine creates profile');
    assert(state.profiles.length === 1, 'state has 1 profile');
    assert(lastToast.includes('Combined into Profile 1 (1 hole)'), 'toast announces success');

    // Select shape not in any profile to uncombine
    state.selectedShapes = new Set(['unrelated-shape']);
    const u1 = doUncombine(state, notify);
    assert(u1 === 0, 'uncombine returns 0 for unrelated shape');
    assert(lastToast.includes('No combined profile'), 'toast explains no profile');

    // Select shape in the profile to uncombine
    state.selectedShapes = new Set(['so1']);
    const u2 = doUncombine(state, notify);
    assert(u2 === 1, 'uncombine returns 1 profile removed');
    assert(state.profiles.length === 0, 'state has 0 profiles after uncombine');
    assert(lastToast.includes('Uncombined 1 profile'), 'toast announces uncombine count');
  }

  console.log('profile-model tests passed ✅');
})().catch((e) => {
  console.error('profile-model tests failed ❌', e);
  process.exit(1);
});
