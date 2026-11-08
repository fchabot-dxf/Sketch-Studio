// packages/core/profile-model.js — Profile data model + validation + topology resilience + resolver.
// Supports COMBINE tool (compound profiles with holes) and the DERIVED face resolver (Fusion 360 profile picking).
// Additive in Slice 1: no CAM consumer switches yet.

import { findLoops } from './loop-finder.js';
import { loopPolygon, polyArea, polygonContains, pointInPolygon } from './loop-geometry.js';
import { loopToPathD } from './shaper-export.js';

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
 * Convert a single loop to an SVG path 'd' string (handles lines, arcs, and single-circle loops).
 */
function singleLoopToPathD(loop, state, shapeById) {
  if (!loop || !state || !state.joints) return '';
  if (Array.isArray(loop.edges) && loop.edges.length === 1) {
    const s = shapeById.get(loop.edges[0]);
    if (s && s.type === 'circle' && Array.isArray(s.joints) && s.joints.length >= 1) {
      const c = state.joints.get(s.joints[0]);
      const r = Number(s.radius) || 0;
      if (c && r > 0) {
        return `M ${c.x - r} ${c.y} A ${r} ${r} 0 1 0 ${c.x + r} ${c.y} A ${r} ${r} 0 1 0 ${c.x - r} ${c.y} Z`;
      }
    }
  }
  return loopToPathD(loop, state);
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
    invalid: false,
    invalidReason: null,
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
 * Find combined profile covering a loop (outer or inner).
 */
export function profileForLoop(loopId, state) {
  if (!state || !Array.isArray(state.profiles) || !loopId) return null;
  for (const p of state.profiles) {
    if (p.outer === loopId) return p;
    if (Array.isArray(p.inners) && p.inners.includes(loopId)) return p;
  }
  return null;
}

/**
 * Find combined profile containing a shape ID.
 */
export function profileForShape(shapeId, state) {
  if (!state || !Array.isArray(state.profiles) || !shapeId) return null;
  for (const p of state.profiles) {
    if (Array.isArray(p.outerShapes) && p.outerShapes.includes(shapeId)) return p;
    if (Array.isArray(p.innerShapes) && p.innerShapes.some(arr => arr.includes(shapeId))) return p;
  }
  return null;
}

/**
 * Re-resolve profile loops dynamically from shape membership.
 * Handles topology changes (fillets, chamfers, trims) and marks invalid if edges broken or containment lost.
 */
export function resolveProfiles(state, loops, loopPolys) {
  if (!state || !Array.isArray(state.profiles) || state.profiles.length === 0) return;
  const allLoops = loops || findLoops(state);
  let availableLoops = [...allLoops];

  for (const p of state.profiles) {
    const matchedOuter = matchLoop(p.outerShapes, availableLoops);
    if (!matchedOuter) {
      p.invalid = true;
      p.invalidReason = 'Outer boundary loop missing or open';
      continue;
    }

    availableLoops = availableLoops.filter(l => l.id !== matchedOuter.id);

    let holeMissing = false;
    const newInners = [];
    const newInnerShapes = [];
    const expectedHoleCount = Array.isArray(p.innerShapes) ? p.innerShapes.length : (Array.isArray(p.inners) ? p.inners.length : 0);

    if (expectedHoleCount > 0) {
      for (let i = 0; i < expectedHoleCount; i++) {
        const targetShapes = p.innerShapes?.[i] || [];
        const matchedInner = matchLoop(targetShapes, availableLoops);
        if (matchedInner) {
          newInners.push(matchedInner.id);
          newInnerShapes.push([...matchedInner.edges]);
          availableLoops = availableLoops.filter(l => l.id !== matchedInner.id);
        } else {
          holeMissing = true;
          break;
        }
      }
    }

    if (holeMissing || newInners.length !== expectedHoleCount) {
      p.invalid = true;
      p.invalidReason = 'Hole loop missing or open';
      continue;
    }

    // Geometry checks
    const outerPoly = getPoly(matchedOuter, loopPolys, state);
    let geomInvalid = false;
    for (let i = 0; i < newInners.length; i++) {
      const innLoop = allLoops.find(l => l.id === newInners[i]);
      const innPoly = innLoop ? getPoly(innLoop, loopPolys, state) : [];
      if (!polygonContains(outerPoly, innPoly)) {
        p.invalid = true;
        p.invalidReason = 'Hole is not strictly contained in outer boundary';
        geomInvalid = true;
        break;
      }
      for (let j = i + 1; j < newInners.length; j++) {
        const inn2Loop = allLoops.find(l => l.id === newInners[j]);
        const inn2Poly = inn2Loop ? getPoly(inn2Loop, loopPolys, state) : [];
        if (polygonContains(innPoly, inn2Poly) || polygonContains(inn2Poly, innPoly)) {
          p.invalid = true;
          p.invalidReason = 'Nested hole loops are not supported';
          geomInvalid = true;
          break;
        }
        if (polysCross(innPoly, inn2Poly)) {
          p.invalid = true;
          p.invalidReason = 'Hole loops intersect';
          geomInvalid = true;
          break;
        }
      }
      if (geomInvalid) break;
    }

    if (!geomInvalid) {
      p.outer = matchedOuter.id;
      p.outerShapes = [...matchedOuter.edges];
      p.inners = newInners;
      p.innerShapes = newInnerShapes;
      p.invalid = false;
      p.invalidReason = null;
    }
  }
}

/**
 * Generate compound SVG path 'd' for a profile (outer loop and all inner loops separated by space).
 */
export function profileToPathD(profile, state, loops) {
  if (!profile || !state || !state.joints) return '';
  const allLoops = loops || findLoops(state);
  const loopById = new Map(allLoops.map(l => [l.id, l]));
  const shapeById = new Map((state.shapes || []).map(s => [s.id, s]));

  let outerLoop = loopById.get(profile.outer);
  if (!outerLoop && Array.isArray(profile.outerShapes)) {
    outerLoop = matchLoop(profile.outerShapes, allLoops);
  }
  if (!outerLoop) return '';

  const outerD = singleLoopToPathD(outerLoop, state, shapeById);
  if (!outerD) return '';

  const innerDs = [];
  const inners = Array.isArray(profile.inners) ? profile.inners : [];
  for (let i = 0; i < inners.length; i++) {
    let hl = loopById.get(inners[i]);
    if (!hl && Array.isArray(profile.innerShapes?.[i])) {
      hl = matchLoop(profile.innerShapes[i], allLoops);
    }
    if (hl) {
      const hd = singleLoopToPathD(hl, state, shapeById);
      if (hd) innerDs.push(hd);
    }
  }

  return [outerD, ...innerDs].join(' ');
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
    invalid: false,
    invalidReason: null,
  };
}

/**
 * ONE Unified Resolver for a loop:
 * Combined profile wins if one covers loopId; otherwise returns the derived face.
 */
export function resolveProfileForLoop(loopId, state, loops, loopPolys) {
  const combined = profileForLoop(loopId, state);
  if (combined) {
    return combined;
  }
  return derivedProfileForLoop(loopId, loops, loopPolys, state);
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
