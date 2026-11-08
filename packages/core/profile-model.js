// packages/core/profile-model.js — Profile data model + validation + topology resilience + resolver.
// Supports COMBINE tool (compound profiles with holes) and the DERIVED face resolver (Fusion 360 profile picking).

import { findLoops, findOpenChains } from './loop-finder.js';
import { loopPolygon, polyArea, polygonContains, pointInPolygon, loopToPathD, sampleArc } from './loop-geometry.js';
import { offsetPolygon, openPolygon, sweptPath } from './polygon-offset.js';

const EPS = 1e-9;
const cross3 = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

function segsCross(p1, p2, p3, p4) {
  const d1 = cross3(p3, p4, p1), d2 = cross3(p3, p4, p2), d3 = cross3(p1, p2, p3), d4 = cross3(p1, p2, p4);
  return ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS));
}

function polysCross(polyA, polyB) {
  if (!polyA || !polyB || polyA.length < 3 || polyB.length < 3) return false;
  const n = polyA.length, m = polyB.length;
  for (let i = 0; i < n; i++) {
    const a1 = polyA[i], a2 = polyA[(i + 1) % n];
    for (let j = 0; j < m; j++) {
      const b1 = polyB[j], b2 = polyB[(j + 1) % m];
      if (segsCross(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

function getPoly(loop, loopPolys, state) {
  if (!loop) return [];
  if (loop.polygon && Array.isArray(loop.polygon) && loop.polygon.length) return loop.polygon;
  if (loopPolys) {
    const p = (loopPolys instanceof Map) ? loopPolys.get(loop.id) : loopPolys[loop.id];
    if (p && p.length) return p;
  }
  if (state && loop.edges) {
    const sb = new Map((state.shapes || []).map(s => [s.id, s]));
    return loopPolygon(loop, state, sb);
  }
  return [];
}

/**
 * Match target shapes to a loop in candidateLoops with the highest overlap.
 * Robust against fillets, chamfers, or trims that add or replace shapes in a loop.
 */
function matchLoop(targetShapeIds, candidateLoops) {
  if (!targetShapeIds || !targetShapeIds.length || !candidateLoops || !candidateLoops.length) return null;
  const targetSet = new Set(targetShapeIds);
  let bestLoop = null;
  let bestScore = 0;
  for (const loop of candidateLoops) {
    if (!Array.isArray(loop.edges) || loop.edges.length === 0) continue;
    let score = 0;
    for (const eid of loop.edges) {
      if (targetSet.has(eid)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestLoop = loop;
    }
  }
  const minRequired = targetShapeIds.length <= 2 ? targetShapeIds.length : Math.ceil(targetShapeIds.length * 0.5);
  if (bestScore >= minRequired && bestScore > 0) {
    return bestLoop;
  }
  return null;
}

/**
 * Deep clone an array of declared profile records.
 */
export function cloneProfiles(list) {
  if (!Array.isArray(list)) return [];
  return list.map((p) => ({
    id: p.id,
    name: p.name,
    outer: p.outer,
    inners: p.inners ? [...p.inners] : [],
    outerShapes: p.outerShapes ? [...p.outerShapes] : [],
    innerShapes: p.innerShapes ? p.innerShapes.map((arr) => [...arr]) : [],
  }));
}

/**
 * Mint next profile ID (e.g. 'profile-1', 'profile-2').
 */
export function mintProfileId(state) {
  let maxId = 0;
  for (const p of (state?.profiles || [])) {
    const num = parseInt(String(p.id).replace(/\D+/g, ''), 10);
    if (!isNaN(num) && num > maxId) maxId = num;
  }
  return `profile-${maxId + 1}`;
}

/**
 * Validate selection for COMBINE:
 * - >= 2 closed loops formed by selected shapes
 * - Outer loop by largest area
 * - All inner loops strictly contained within outer
 * - No hole-hole crossings, no nested holes (depth 1 holes only)
 */
export function validateCombine(selectedShapeIds, loops, loopPolys, state) {
  const selSet = new Set(selectedShapeIds || []);
  if (selSet.size === 0) {
    return { ok: false, reason: 'No shapes selected' };
  }
  const candidateLoops = (loops || []).filter(l => l.edges && l.edges.length > 0 && l.edges.every(e => selSet.has(e)));
  if (candidateLoops.length < 2) {
    return { ok: false, reason: 'Combine requires at least 2 closed loops' };
  }

  const withArea = candidateLoops.map(loop => {
    const poly = getPoly(loop, loopPolys, state);
    return { loop, poly, area: polyArea(poly) };
  });

  withArea.sort((a, b) => b.area - a.area);
  const outer = withArea[0];
  const inners = withArea.slice(1);

  if (outer.area <= 0) {
    return { ok: false, reason: 'Outer loop has zero area' };
  }

  for (let i = 0; i < inners.length; i++) {
    const inn = inners[i];
    if (!polygonContains(outer.poly, inn.poly)) {
      return { ok: false, reason: 'All inner loops must be strictly contained within the outer loop' };
    }
  }

  for (let i = 0; i < inners.length; i++) {
    for (let j = i + 1; j < inners.length; j++) {
      if (polygonContains(inners[i].poly, inners[j].poly) || polygonContains(inners[j].poly, inners[i].poly)) {
        return { ok: false, reason: 'Nested loops (holes inside holes) are not supported' };
      }
      if (polysCross(inners[i].poly, inners[j].poly)) {
        return { ok: false, reason: 'Hole loops cannot cross each other' };
      }
    }
  }

  return {
    ok: true,
    outerLoop: outer.loop,
    innerLoops: inners.map(x => x.loop),
  };
}

/**
 * Create a new combined profile and store it on state.profiles.
 * Stored record holds declared membership only (no transient view/invalid/path fields).
 */
export function makeProfile(state, outerLoop, innerLoops = [], name = null) {
  if (!state) return null;
  if (!Array.isArray(state.profiles)) state.profiles = [];

  const id = mintProfileId(state);
  const profileName = name || `Profile ${id.replace(/\D+/g, '')}`;
  const inners = Array.isArray(innerLoops) ? innerLoops : [];

  const prof = {
    id,
    name: profileName,
    outer: outerLoop.id,
    inners: inners.map(l => l.id),
    outerShapes: [...outerLoop.edges],
    innerShapes: inners.map(l => [...l.edges]),
  };
  state.profiles.push(prof);
  return prof;
}

/**
 * Uncombine (disband) a profile by ID.
 */
export function uncombineProfile(state, profileId) {
  if (!state || !Array.isArray(state.profiles)) return false;
  const idx = state.profiles.findIndex(p => p.id === profileId);
  if (idx === -1) return false;
  state.profiles.splice(idx, 1);
  return true;
}

/**
 * List all profiles on state.
 */
export function profilesOf(state) {
  return (state && Array.isArray(state.profiles)) ? state.profiles : [];
}

/**
 * Purely resolve all stored combined profiles against the current sketch geometry.
 * Writes NOTHING into state or state.profiles.
 *
 * Matches each stored profile to today's closed loops from its surviving member shapes
 * (survives fillets, breaks, and trims without rewriting the stored profile record).
 *
 * @param {object} state - Sketch state
 * @param {Array} [loops] - Optional precomputed loops from findLoops(state)
 * @param {object|Map} [loopPolys] - Optional precomputed loop polygons keyed by loop.id
 * @returns {Map<string, { d: string, invalid: boolean, reason: string|null, outerLoopId: string|null, innerLoopIds: string[] }>}
 */
export function resolveProfileViews(state, loops, loopPolys) {
  const views = new Map();
  if (!state || !Array.isArray(state.profiles) || state.profiles.length === 0) return views;

  const allLoops = loops || findLoops(state);
  let availableLoops = [...allLoops];
  const shapeById = new Map((state.shapes || []).map((s) => [s.id, s]));
  const polyCache = new Map();
  const polyOf = (loop) => {
    if (!loop) return [];
    if (loopPolys) {
      const p = (loopPolys instanceof Map) ? loopPolys.get(loop.id) : loopPolys[loop.id];
      if (p && p.length) return p;
    }
    if (polyCache.has(loop.id)) return polyCache.get(loop.id);
    const p = loop.edges ? loopPolygon(loop, state, shapeById) : [];
    polyCache.set(loop.id, p);
    return p;
  };

  for (const p of state.profiles) {
    if (!p || !p.id) continue;

    const matchedOuter = (Array.isArray(p.outerShapes) && p.outerShapes.length > 0)
      ? matchLoop(p.outerShapes, availableLoops)
      : (availableLoops.find((l) => l.id === p.outer) || null);
    if (matchedOuter) {
      availableLoops = availableLoops.filter((l) => l.id !== matchedOuter.id);
    }

    const expectedHoleCount = (Array.isArray(p.innerShapes) && p.innerShapes.length > 0)
      ? p.innerShapes.length
      : (Array.isArray(p.inners) ? p.inners.length : 0);

    let holeMissing = false;
    const matchedInners = [];
    for (let i = 0; i < expectedHoleCount; i++) {
      const targetShapes = p.innerShapes?.[i];
      const matchedInner = (Array.isArray(targetShapes) && targetShapes.length > 0)
        ? matchLoop(targetShapes, availableLoops)
        : (availableLoops.find((l) => l.id === p.inners?.[i]) || null);
      if (matchedInner) {
        matchedInners.push(matchedInner);
        availableLoops = availableLoops.filter((l) => l.id !== matchedInner.id);
      } else {
        holeMissing = true;
      }
    }

    const outerD = matchedOuter ? loopToPathD(matchedOuter, state) : '';
    const innerDs = [];
    for (const hl of matchedInners) {
      const hd = loopToPathD(hl, state);
      if (hd) innerDs.push(hd);
    }
    const dParts = [];
    if (outerD) dParts.push(outerD);
    dParts.push(...innerDs);
    const d = dParts.join(' ');

    const outerLoopId = matchedOuter ? matchedOuter.id : null;
    const innerLoopIds = matchedInners.map((l) => l.id);

    if (!matchedOuter) {
      views.set(p.id, { d, invalid: true, reason: 'Outer boundary loop missing or open', outerLoopId, innerLoopIds });
      continue;
    }

    if (holeMissing || matchedInners.length !== expectedHoleCount) {
      views.set(p.id, { d, invalid: true, reason: 'Hole loop missing or open', outerLoopId, innerLoopIds });
      continue;
    }

    // Geometry containment & non-crossing checks
    const outerPoly = polyOf(matchedOuter);
    let reason = null;
    for (let i = 0; i < matchedInners.length; i++) {
      const innPoly = polyOf(matchedInners[i]);
      if (!polygonContains(outerPoly, innPoly)) {
        reason = 'Hole is not strictly contained in outer boundary';
        break;
      }
      for (let j = i + 1; j < matchedInners.length; j++) {
        const inn2Poly = polyOf(matchedInners[j]);
        if (polygonContains(innPoly, inn2Poly) || polygonContains(inn2Poly, innPoly)) {
          reason = 'Nested hole loops are not supported';
          break;
        }
        if (polysCross(innPoly, inn2Poly)) {
          reason = 'Hole loops intersect';
          break;
        }
      }
      if (reason) break;
    }

    if (reason) {
      views.set(p.id, { d, invalid: true, reason, outerLoopId, innerLoopIds });
    } else {
      views.set(p.id, { d, invalid: false, reason: null, outerLoopId, innerLoopIds });
    }
  }

  return views;
}

/**
 * Find combined profile covering a loop (outer or inner), resolved against live geometry via resolveProfileViews.
 */
export function profileForLoop(loopId, state, loops, loopPolys) {
  if (!state || !Array.isArray(state.profiles) || !loopId || state.profiles.length === 0) return null;
  if (Array.isArray(loops) || (Array.isArray(state.shapes) && state.shapes.length > 0)) {
    const views = resolveProfileViews(state, loops, loopPolys);
    for (const p of state.profiles) {
      const v = views.get(p.id);
      if (v && (v.outerLoopId === loopId || v.innerLoopIds.includes(loopId))) return p;
    }
    return null;
  }
  for (const p of state.profiles) {
    if (p.outer === loopId) return p;
    if (Array.isArray(p.inners) && p.inners.includes(loopId)) return p;
  }
  return null;
}

/**
 * Find combined profile containing a shape ID (declared member shapes first, then live resolved loops).
 */
export function profileForShape(shapeId, state, loops, loopPolys) {
  if (!state || !Array.isArray(state.profiles) || !shapeId || state.profiles.length === 0) return null;
  for (const p of state.profiles) {
    if (Array.isArray(p.outerShapes) && p.outerShapes.includes(shapeId)) return p;
    if (Array.isArray(p.innerShapes) && p.innerShapes.some(arr => arr.includes(shapeId))) return p;
  }
  if (Array.isArray(loops) || (Array.isArray(state.shapes) && state.shapes.length > 0)) {
    const allLoops = loops || findLoops(state);
    const loopById = new Map(allLoops.map(l => [l.id, l]));
    const views = resolveProfileViews(state, allLoops, loopPolys);
    for (const p of state.profiles) {
      const v = views.get(p.id);
      if (!v) continue;
      if (v.outerLoopId && loopById.get(v.outerLoopId)?.edges?.includes(shapeId)) return p;
      for (const hid of v.innerLoopIds) {
        if (loopById.get(hid)?.edges?.includes(shapeId)) return p;
      }
    }
  }
  return null;
}

// ── Derived Profile / Face Resolver (AMENDMENT 4, FINAL) ───────────────────────
// In Shaper, picking inside a region picks its derived profile = outer loop minus directly-contained holes.
// Clicking inside a hole picks the hole/island loop's own profile.
// COMBINE / UNCOMBINE is the power tool that overrides the derived face.

/**
 * Find all directly-contained loops (depth-1 holes) inside a parent loop.
 * A loop H is directly contained if:
 * 1. parent strictly contains H
 * 2. There is NO intermediate loop M such that parent contains M and M contains H.
 */
export function directlyContainedLoops(parentLoop, allLoops, loopPolys, state) {
  const parentPoly = getPoly(parentLoop, loopPolys, state);
  if (!parentPoly || parentPoly.length < 3) return [];

  const contained = [];
  for (const l of (allLoops || [])) {
    if (l.id === parentLoop.id) continue;
    const lPoly = getPoly(l, loopPolys, state);
    if (polygonContains(parentPoly, lPoly)) {
      contained.push({ loop: l, poly: lPoly });
    }
  }

  if (contained.length <= 1) {
    return contained.map(c => c.loop);
  }

  const direct = [];
  for (let i = 0; i < contained.length; i++) {
    let isNested = false;
    for (let j = 0; j < contained.length; j++) {
      if (i === j) continue;
      if (polygonContains(contained[j].poly, contained[i].poly)) {
        isNested = true;
        break;
      }
    }
    if (!isNested) {
      direct.push(contained[i].loop);
    }
  }
  return direct;
}

/**
 * Derived face profile for a loop: outer loop minus its directly-contained holes.
 */
export function derivedProfileForLoop(loopId, loops, loopPolys, state) {
  const allLoops = loops || (state ? findLoops(state) : []);
  const loop = allLoops.find(l => l.id === loopId);
  if (!loop) return null;
  const directHoles = directlyContainedLoops(loop, allLoops, loopPolys, state);
  return {
    id: `derived-${loop.id}`,
    name: `Face ${loop.id}`,
    outer: loop.id,
    inners: directHoles.map(h => h.id),
    outerShapes: [...(loop.edges || [])],
    innerShapes: directHoles.map(h => [...(h.edges || [])]),
    isDerived: true,
  };
}

/**
 * ONE Unified Resolver for a loop:
 * Combined profile wins if one covers loopId (resolved via resolveProfileViews); otherwise returns the derived face.
 */
export function resolveProfileForLoop(loopId, state, loops, loopPolys) {
  const allLoops = loops || (state ? findLoops(state) : []);
  if (state && Array.isArray(state.profiles) && state.profiles.length > 0) {
    const views = resolveProfileViews(state, allLoops, loopPolys);
    for (const p of state.profiles) {
      const v = views.get(p.id);
      if (v && (v.outerLoopId === loopId || v.innerLoopIds.includes(loopId))) {
        return {
          id: p.id,
          name: p.name,
          outer: v.outerLoopId,
          inners: [...v.innerLoopIds],
          isDerived: false,
        };
      }
    }
  }
  return derivedProfileForLoop(loopId, allLoops, loopPolys, state);
}

/**
 * ONE Unified Resolver at a world point:
 * Finds the innermost containing loop (smallest area), then returns the combined or derived profile for it.
 */
export function resolveProfileAtPoint(point, state, loops, loopPolys) {
  if (!point || typeof point.x !== 'number' || typeof point.y !== 'number') return null;
  const allLoops = loops || (state ? findLoops(state) : []);
  const containing = [];
  for (const l of allLoops) {
    const poly = getPoly(l, loopPolys, state);
    if (poly.length >= 3 && pointInPolygon(poly, point)) {
      containing.push({ loop: l, poly, area: polyArea(poly) });
    }
  }
  if (!containing.length) return null;
  containing.sort((a, b) => a.area - b.area);
  const innermost = containing[0].loop;
  return resolveProfileForLoop(innermost.id, state, allLoops, loopPolys);
}

/**
 * ONE Unified Target-Key Resolver.
 * Takes a target key in the cut-plan form ('loop:<id>' | 'profile:<id>' | 'chain:<id>' or { kind, id })
 * and resolves it against the sketch loops/profiles/chains.
 * Returns { outer, inners, profileId, invalid, reason, isDerived, isCombined, chain, d } (or null if unrecognized).
 *
 * @param {string|object} target - Target key string ('loop:<id>', 'profile:<id>', 'chain:<id>') or { kind, id }
 * @param {object} state - Sketch state
 * @param {Array} [loops] - Optional precomputed loops
 * @param {object|Map} [loopPolys] - Optional precomputed loop polygons
 * @returns {object|null}
 */
export function resolveTargetKey(target, state, loops, loopPolys) {
  if (!target) return null;
  let kind = '', id = '';
  if (typeof target === 'string') {
    const idx = target.indexOf(':');
    if (idx === -1) return null;
    kind = target.slice(0, idx);
    id = target.slice(idx + 1);
  } else if (typeof target === 'object') {
    kind = target.kind;
    id = target.id;
  }
  if (!kind || !id) return null;

  const allLoops = loops || (state ? findLoops(state) : []);

  if (kind === 'profile') {
    const views = resolveProfileViews(state, allLoops, loopPolys);
    const v = views.get(id);
    if (!v) {
      return { outer: null, inners: [], profileId: id, invalid: true, reason: 'Profile not found', isCombined: true, isDerived: false, d: '' };
    }
    return {
      outer: v.outerLoopId,
      inners: v.innerLoopIds ? [...v.innerLoopIds] : [],
      profileId: id,
      invalid: Boolean(v.invalid),
      reason: v.reason || null,
      isCombined: true,
      isDerived: false,
      d: v.d || '',
    };
  }

  if (kind === 'loop') {
    const loop = allLoops.find((l) => l.id === id);
    if (!loop) {
      return { outer: null, inners: [], profileId: null, invalid: true, reason: 'Loop not found', isDerived: true, isCombined: false, d: '' };
    }
    // Combined profile wins if one covers this loop
    const prof = resolveProfileForLoop(id, state, allLoops, loopPolys);
    if (!prof || !prof.outer) {
      return { outer: null, inners: [], profileId: null, invalid: true, reason: 'Loop profile not found', isDerived: true, isCombined: false, d: '' };
    }
    if (!prof.isDerived) {
      const views = resolveProfileViews(state, allLoops, loopPolys);
      const v = views.get(prof.id);
      return {
        outer: v?.outerLoopId || prof.outer,
        inners: v?.innerLoopIds ? [...v.innerLoopIds] : [...prof.inners],
        profileId: prof.id,
        invalid: Boolean(v?.invalid),
        reason: v?.reason || null,
        isCombined: true,
        isDerived: false,
        d: v?.d || '',
      };
    }
    return {
      outer: prof.outer,
      inners: [...prof.inners],
      profileId: null,
      invalid: false,
      reason: null,
      isDerived: true,
      isCombined: false,
      d: '',
    };
  }

  if (kind === 'chain') {
    const chains = findOpenChains(state || {}, allLoops);
    const chain = chains.find((c) => c.id === id);
    if (!chain) {
      return { chain: null, id, invalid: true, reason: 'Chain not found', kind: 'chain' };
    }
    return { chain, id, invalid: false, reason: null, kind: 'chain' };
  }

  return null;
}

/**
 * List all closed profiles for a sketch:
 * Combined profiles first (resolved from state.profiles), then derived profiles for any uncovered loops.
 * Returns an array of profile descriptors suitable for UI dropdowns, sorting, and preview rendering.
 *
 * @param {object} state - Sketch state
 * @param {Array} [loops] - Optional precomputed loops
 * @param {object|Map} [loopPolys] - Optional precomputed loop polygons
 * @returns {Array<{ key: string, profileId: string|null, outerLoopId: string, holeIds: string[], boundary: Array<{x,y}>, holePolys: Array<Array<{x,y}>>, sortArea: number, netArea: number, isCombined: boolean, title: string }>}
 */
export function listSketchProfiles(state, loops, loopPolys) {
  const sb = new Map((state?.shapes || []).map((s) => [s.id, s]));
  const allLoops = loops || (state ? findLoops(state) : []);
  const polys = {};
  for (const l of allLoops) {
    if (loopPolys) {
      const p = (loopPolys instanceof Map) ? loopPolys.get(l.id) : loopPolys[l.id];
      if (p && p.length) { polys[l.id] = p; continue; }
    }
    polys[l.id] = l.edges ? loopPolygon(l, state, sb) : [];
  }
  const views = resolveProfileViews(state, allLoops, polys);

  const entries = [];
  const coveredLoops = new Set();

  for (const p of (state?.profiles || [])) {
    const v = views.get(p.id);
    if (!v || v.invalid || !v.outerLoopId) continue;
    const boundary = polys[v.outerLoopId] || [];
    if (boundary.length < 3) continue;
    const holePolys = (v.innerLoopIds || []).map((hid) => polys[hid]).filter((hp) => hp && hp.length >= 3);
    const outerArea = Math.abs(polyArea(boundary));
    const holeArea = holePolys.reduce((acc, hp) => acc + Math.abs(polyArea(hp)), 0);
    coveredLoops.add(v.outerLoopId);
    for (const hid of (v.innerLoopIds || [])) coveredLoops.add(hid);
    entries.push({
      key: 'profile:' + p.id,
      profileId: p.id,
      outerLoopId: v.outerLoopId,
      holeIds: [...(v.innerLoopIds || [])],
      boundary,
      holePolys,
      sortArea: outerArea,
      netArea: Math.max(0, outerArea - holeArea),
      isCombined: true,
      title: p.name || p.id,
    });
  }

  for (const l of allLoops) {
    if (coveredLoops.has(l.id)) continue;
    const boundary = polys[l.id] || [];
    if (boundary.length < 3) continue;
    const prof = resolveProfileForLoop(l.id, state, allLoops, polys);
    const holeIds = prof ? [...(prof.inners || [])] : [];
    const holePolys = holeIds.map((hid) => polys[hid]).filter((hp) => hp && hp.length >= 3);
    const outerArea = Math.abs(polyArea(boundary));
    const holeArea = holePolys.reduce((acc, hp) => acc + Math.abs(polyArea(hp)), 0);
    entries.push({
      key: 'loop:' + l.id,
      profileId: null,
      outerLoopId: l.id,
      holeIds,
      boundary,
      holePolys,
      sortArea: outerArea,
      netArea: Math.max(0, outerArea - holeArea),
      isCombined: false,
      title: null,
    });
  }

  entries.sort((a, b) => b.sortArea - a.sortArea);
  let derivedIdx = 1;
  for (const e of entries) {
    if (!e.isCombined) e.title = `Profile ${derivedIdx++}`;
  }

  return entries;
}

/**
 * ONE Unified Cut Derivation for Profiles and Targets.
 * Given a target (or key) and a cut record, resolves the cut operations to perform:
 * - POCKET: compound cut with outer loop and all directly-contained holes
 * - EXTERIOR (Outside): holes emitted FIRST as 'interior' (offsetSide: -1), outer emitted LAST as 'exterior' (offsetSide: +1)
 * - INTERIOR (Inside): holes emitted FIRST as 'exterior' (offsetSide: +1), outer emitted LAST as 'interior' (offsetSide: -1)
 * - ONLINE: holes emitted FIRST as 'online' (offsetSide: 0), outer emitted LAST as 'online' (offsetSide: 0)
 * - GUIDE: holes emitted FIRST as 'guide' (offsetSide: 0), outer emitted LAST as 'guide' (offsetSide: 0)
 * - CHAIN: open chain emitted with offsetSide: 0
 *
 * Sketches without holes emit only the outer cut (byte-identical to simple loops).
 *
 * @param {string|object} target - Target key string or { kind, id } or resolved spec
 * @param {object} rec - Cut record ({ cutType, cutDepth, cutOffset, toolDia })
 * @param {object} state - Sketch state
 * @param {Array} [loops] - Optional precomputed loops
 * @param {object|Map} [loopPolys] - Optional precomputed loop polygons
 * @returns {Array<object>} Array of cut descriptors
 */
export function deriveProfileCuts(target, rec, state, loops, loopPolys) {
  if (!target || !rec || !rec.cutType) return [];
  const allLoops = loops || (state ? findLoops(state) : []);
  const spec = (typeof target === 'object' && target !== null && 'outer' in target && 'inners' in target)
    ? target
    : resolveTargetKey(target, state, allLoops, loopPolys);

  if (!spec || spec.invalid) return [];

  if (spec.kind === 'chain') {
    return [{
      kind: 'chain',
      chain: spec.chain,
      cutType: rec.cutType,
      offsetSide: 0,
      rec: { ...rec },
      isHole: false,
      isCompound: false,
    }];
  }

  if (!spec.outer) return [];

  const outerLoop = allLoops.find((l) => l.id === spec.outer);
  if (!outerLoop) return [];

  const holeLoops = (spec.inners || [])
    .map((hid) => allLoops.find((l) => l.id === hid))
    .filter(Boolean);

  const outerPoly = getPoly(outerLoop, loopPolys, state);
  const holePolys = holeLoops.map((hl) => getPoly(hl, loopPolys, state));

  const ct = rec.cutType;
  const isOutside = ct === 'exterior' || ct === 'outside';
  const isInside = ct === 'interior' || ct === 'inside';

  if (ct === 'pocket') {
    return [{
      kind: 'profile',
      cutType: 'pocket',
      isCompound: true,
      isHole: false,
      outerLoop,
      holeLoops,
      outerPoly,
      holePolys,
      outerOffsetSide: -1,
      holeOffsetSide: 1,
      rec: { ...rec, cutType: 'pocket' },
      d: spec.d || '',
      profileId: spec.profileId,
    }];
  }

  const cuts = [];
  const holeCutType = isOutside
    ? (ct === 'outside' ? 'inside' : 'interior')
    : isInside
    ? (ct === 'inside' ? 'outside' : 'exterior')
    : ct;

  const outerCutType = ct;

  const holeOffsetSide = isOutside ? -1 : isInside ? 1 : 0;
  const outerOffsetSide = isOutside ? 1 : isInside ? -1 : 0;

  // Holes FIRST
  for (let i = 0; i < holeLoops.length; i++) {
    cuts.push({
      kind: 'loop',
      loop: holeLoops[i],
      loopId: holeLoops[i].id,
      polygon: holePolys[i],
      cutType: holeCutType,
      offsetSide: holeOffsetSide,
      isHole: true,
      isCompound: false,
      rec: { ...rec, cutType: holeCutType },
    });
  }

  // Outer LAST
  cuts.push({
    kind: 'loop',
    loop: outerLoop,
    loopId: outerLoop.id,
    polygon: outerPoly,
    cutType: outerCutType,
    offsetSide: outerOffsetSide,
    isHole: false,
    isCompound: false,
    rec: { ...rec, cutType: outerCutType },
  });

  return cuts;
}

/**
 * deriveCutFootprint(cuts, rec, state) — what a ROUND bit of radius r = toolDia/2 ACTUALLY removes for each cut that
 * deriveProfileCuts returned (the ONE derivation behind the Prepare preview; the exported SVG is unchanged — the Origin
 * computes its own offsets). Returns [{ kind, fillRule, rings, center, chain }]:
 *   rings    — polygons to draw in ONE path with `fillRule` (empty = nothing cut: bit too big, or no tool)
 *   center   — the bit-centre path (polygon) for the dashed centreline, or null (open chain: draw `chain` itself)
 * Per type (cutOffset `off` = the declared margin; r the bit radius):
 *   pocket          the morphological OPENING of the region (outer minus holes) by the bit: outer = openPolygon(outer, r,
 *                   off); each hole = closing of the hole grown by (r+off) (the bit cannot enter it) -> walls reached,
 *                   convex corners rounded by r. A hole whose footprint is not inside the opened outer is dropped.
 *   inside/outside  the swept band of the centre path (offset by r+off, ROUND joins): capsules, full width 2r.
 *   on line         closed loop: the loop swept by r; open chain: the polyline swept by r with round end caps.
 *   guide           not a cut -> no footprint (rings [], centre kept so the view stays dashed).
 * Uncut material (corners the bit cannot reach) is simply the area the footprint does not cover.
 */
export function deriveCutFootprint(cuts, rec, state) {
  const out = [];
  if (!Array.isArray(cuts) || !rec) return out;
  const r = (Number(rec.toolDia) || 0) / 2;
  const off = Number(rec.cutOffset) || 0;
  const isGuide = rec.cutType === 'guide';
  for (const cut of cuts) {
    if (cut.isCompound) {
      const opened = (r > 0) ? openPolygon(cut.outerPoly, r, off) : [];
      const rings = [];
      if (opened.length >= 3) {
        rings.push(opened);
        for (const hp of (cut.holePolys || [])) {
          const grown = offsetPolygon(hp, r + off, { join: 'round' });
          const closed = grown.length >= 3 ? offsetPolygon(grown, -r) : [];
          const ring = closed.length >= 3 ? closed : hp;
          if (polygonContains(opened, ring)) rings.push(ring);
        }
      }
      // TASK 449: the finish-pass centre paths (the line the bit centre follows): the wall inset by r+off and each island
      // grown by r+off (round joins) — the same erosion/dilation the footprint above is built from.
      const dist = r + off;
      const wall = r > 0 ? (dist === 0 ? cut.outerPoly : offsetPolygon(cut.outerPoly, -dist)) : [];
      const islandCenters = r > 0 ? (cut.holePolys || []).map((hp) => (dist === 0 ? hp : offsetPolygon(hp, dist, { join: 'round' }))).filter((pg) => pg.length >= 3) : [];
      out.push({ kind: 'pocket', cutType: 'pocket', fillRule: 'evenodd', rings, center: null, chain: null, wall: wall.length >= 3 ? wall : null, islandCenters });
    } else if (cut.kind === 'chain') {
      const rings = [];
      if (!isGuide && r > 0) {
        for (const sh of (cut.chain && cut.chain.shapes) || []) {
          let line = null;
          if (sh.type === 'line') line = (sh.joints || []).slice(0, 2).map((id) => state.joints.get(id));
          else if (sh.type === 'arc') line = sampleArc(sh, state, 24);
          if (line && line.length >= 2 && line.every(Boolean)) rings.push(...sweptPath(line, r));
        }
      }
      out.push({ kind: isGuide ? 'guide' : 'chain', cutType: isGuide ? 'guide' : 'online', fillRule: 'nonzero', rings, center: null, chain: cut.chain });
    } else if (cut.polygon && cut.polygon.length >= 3) {
      const side = cut.offsetSide || 0;
      const center = side === 0 ? cut.polygon : offsetPolygon(cut.polygon, side * (r + off), { join: 'round' });
      const rings = (!isGuide && r > 0 && center.length >= 3) ? sweptPath(center, r, { closed: true }) : [];
      out.push({ kind: isGuide ? 'guide' : 'band', cutType: isGuide ? 'guide' : String(cut.cutType || rec.cutType || ''), fillRule: 'nonzero', rings, center: center.length >= 3 ? center : null, chain: null });
    }
  }
  return out;
}

// ── TASK 449: TRAVEL DIRECTION — Shaper Origin always cuts CONVENTIONALLY (owner rule: no climb mode, no switch). ─────────
// First principles (screen = viewed from above, y DOWN in sketch/SVG coordinates; the rotation is stated as seen ON SCREEN):
//  * The Origin's cutter rotates CLOCKWISE viewed from above (support article "Climb cutting and conventional cutting").
//  * Conventional = at the point of contact the tooth moves in the SAME direction as the tool travels (the work, relative
//    to the cutter, moves the opposite way, so the tooth opposes the work's feed). Check with a CW-rotating tooth: at the
//    cutter's LEFT side (facing the travel direction, travel "up the screen") a clockwise tooth moves UP = along the
//    travel; at its right side it moves DOWN = against it (climb).
//  * The material the finish pass engages is the layer between the bit and the FINISHED WALL, i.e. on the wall side of the
//    bit. So conventional = the wall/material stays on the LEFT of the direction of travel.
//  * OUTSIDE cut (part inside the path, wall = the part's edge): part on the left -> COUNTER-clockwise around the part.
//    INSIDE cut (bit inside a hole, wall outside it): wall on the left -> CLOCKWISE.
//    POCKET finish pass: the outer wall is an inside cut (clockwise); an island is an outside cut (counter-clockwise).
//  * An Outside profile's holes are emitted by deriveProfileCuts as INSIDE cuts, so they come out clockwise; an Inside
//    profile's holes (islands) as outside cuts, counter-clockwise.
//  * On line (material both sides) and Guide (not a cut): no direction (owner questions).
// The exported SVG is NOT affected: the Origin picks the direction itself from the cut type; our winding is irrelevant.
const TRAVEL_BY_ROLE = { outside: 'ccw', inside: 'cw', wall: 'cw', island: 'ccw' };

// Order `poly` so it travels `direction` ('cw' | 'ccw') AS SEEN ON SCREEN. World y points down, so a positive shoelace
// area (x_j*y_i - x_i*y_j) is a CLOCKWISE loop on screen.
export function orientOnScreen(poly, direction) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  const isCw = a > 0;
  return ((direction === 'cw') === isCw) ? poly.slice() : poly.slice().reverse();
}

// Evenly spaced arrow marks {x, y, angle} (radians, direction of travel) along a CLOSED path — the static fallback for
// users who prefer reduced motion.
export function arrowsAlongClosed(path, count = 6) {
  const n = path.length, seg = [];
  let total = 0;
  for (let i = 0; i < n; i++) { const a = path[i], b = path[(i + 1) % n]; const l = Math.hypot(b.x - a.x, b.y - a.y); seg.push(l); total += l; }
  const out = [];
  if (!(total > 0)) return out;
  for (let k = 0; k < count; k++) {
    let s = ((k + 0.5) / count) * total, i = 0;
    while (i < n - 1 && s > seg[i]) { s -= seg[i]; i++; }
    const a = path[i], b = path[(i + 1) % n], t = seg[i] > 0 ? s / seg[i] : 0;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle: Math.atan2(b.y - a.y, b.x - a.x) });
  }
  return out;
}

/**
 * deriveCutTravel(footprints) — the conventional TRAVEL of every cut that has one, from deriveCutFootprint's output (so the
 * centre path is exactly the line the footprint/preview uses). Returns [{ role, direction, path, arrows }]:
 *   role 'outside'|'inside'  — a band cut's centre path;  'wall'|'island' — a pocket's finish pass;
 *   direction 'cw'|'ccw'     — as seen on screen;  path — the centre polygon ordered in that direction;  arrows — see above.
 * On line, Guide and chains return nothing (no direction).
 */
export function deriveCutTravel(footprints) {
  const out = [];
  const push = (role, poly) => {
    if (!poly || poly.length < 3) return;
    const direction = TRAVEL_BY_ROLE[role];
    const path = orientOnScreen(poly, direction);
    out.push({ role, direction, path, arrows: arrowsAlongClosed(path, 6) });
  };
  for (const fp of footprints || []) {
    if (fp.kind === 'pocket') {
      push('wall', fp.wall);
      for (const isl of fp.islandCenters || []) push('island', isl);
    } else if (fp.kind === 'band') {
      const t = fp.cutType;
      if (t === 'exterior' || t === 'outside') push('outside', fp.center);
      else if (t === 'interior' || t === 'inside') push('inside', fp.center);
    }
  }
  return out;
}
