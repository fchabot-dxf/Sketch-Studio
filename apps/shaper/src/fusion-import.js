// apps/shaper/src/fusion-import.js — TASK 664: import Fusion `selection_data` payloads (SELECTION-BRIDGE.md §3.2 & §4 SS-3)
// into #core sketch geometry + Shaper Prepare cut plan + stock thickness in ONE undo step. Reuses #core/dxf-import's
// `buildShapesFromPrimitives` for joint merging, Y-up -> Y-down negation, real arcs (`arcShape`), and construction tagging.

import { addSketch, activateSketch, stampSketch } from '#core/sketch-model.js';
import { deserializeDocument } from '#core/document.js';
import { emptyDocument } from '#ui/project-store.js';
import { buildShapesFromPrimitives } from '#core/dxf-import.js';
import { findLoops, findOpenChains } from '#core/loop-finder.js';
import { loopPolygon } from '#core/loop-geometry.js';
import { makeProfile, directlyContainedLoops } from '#core/profile-model.js';
import { newShapeId } from '#core/shape-id.js';
import { fitToDrawing } from '#ui/input-handlers/pan-zoom.js';
import { CUT_PLAN, keyOf } from './cut-plan.js';
import { CUT_TYPES, STOCK_TYPE_ID, defaultCutRecord } from './shaper.js';
import { getStock, setStock } from './stock.js';
import { ringWalk } from '#core/stepped-cut.js';
import { setStlSource } from './stl-source.js'; // TASK 790: the replaced design's STL source goes with it (an STL import sets its own after)

const UNIT_SCALE_MM = { mm: 1, cm: 10, in: 25.4, inch: 25.4, inches: 25.4 };
const edgesKey = (ids) => [...new Set((ids || []).filter(Boolean))].sort().join('|');
const samePt = (a, b, tol) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;

/** Map Fusion `cutType` ('outside' | 'inside' | 'pocket' | 'online' | 'guide') from declared CUT_TYPES. */
export function mapFusionCutType(raw, warnings = null) {
  if (raw == null || raw === '') return null;
  const norm = String(raw).trim().toLowerCase();
  const match = CUT_TYPES.find((t) => t.id !== STOCK_TYPE_ID && (t.cutType === norm || t.id === norm));
  if (match) return match.id;
  if (warnings) warnings.push(`Unknown cutType "${raw}" left unset`);
  return null;
}

function segmentToPrimitive(seg, forceConstruction = false, warnings = null) {
  if (!seg || typeof seg !== 'object') return null;
  const con = Boolean(forceConstruction || seg.construction);
  const type = String(seg.type || '').toLowerCase();
  if (type === 'line') {
    const x1 = Number(seg.x1), y1 = Number(seg.y1), x2 = Number(seg.x2), y2 = Number(seg.y2);
    if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
    if (Math.hypot(x2 - x1, y2 - y1) <= 1e-9) return null;
    return { k: 'line', a: [x1, y1], b: [x2, y2], con };
  }
  if (type === 'circle') {
    const cx = Number(seg.cx), cy = Number(seg.cy), r = Number(seg.r);
    if (![cx, cy, r].every(Number.isFinite) || !(r > 0)) return null;
    return { k: 'circle', c: [cx, cy], r, con };
  }
  if (type === 'arc') {
    const cx = Number(seg.cx), cy = Number(seg.cy), r = Number(seg.r);
    const x1 = Number(seg.x1), y1 = Number(seg.y1), x2 = Number(seg.x2), y2 = Number(seg.y2);
    if (![cx, cy, r, x1, y1, x2, y2].every(Number.isFinite) || !(r > 0)) return null;
    return { k: 'arc', c: [cx, cy], r, s: [x1, y1], e: [x2, y2], ccw: Boolean(seg.ccw), con };
  }
  if (warnings && type) warnings.push(`Unsupported segment type "${seg.type}" skipped`);
  return null;
}

function primitivesMatch(p, q, tol) {
  if (p.k !== q.k) return false;
  if (p.k === 'circle') return samePt(p.c, q.c, tol) && Math.abs(p.r - q.r) <= tol;
  if (p.k === 'line') {
    return (samePt(p.a, q.a, tol) && samePt(p.b, q.b, tol)) || (samePt(p.a, q.b, tol) && samePt(p.b, q.a, tol));
  }
  if (p.k === 'arc') {
    if (!samePt(p.c, q.c, tol) || Math.abs(p.r - q.r) > tol) return false;
    return (samePt(p.s, q.s, tol) && samePt(p.e, q.e, tol) && p.ccw === q.ccw)
      || (samePt(p.s, q.e, tol) && samePt(p.e, q.s, tol) && p.ccw !== q.ccw);
  }
  return false;
}

function dedupTolerance(rawLists) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const ext = (x, y) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); };
  for (const prims of rawLists) {
    for (const q of prims) {
      if (q.k === 'line') { ext(q.a[0], q.a[1]); ext(q.b[0], q.b[1]); }
      else if (q.k === 'circle') { ext(q.c[0] - q.r, q.c[1] - q.r); ext(q.c[0] + q.r, q.c[1] + q.r); }
      else if (q.k === 'arc') { ext(q.s[0], q.s[1]); ext(q.e[0], q.e[1]); ext(q.c[0] - q.r, q.c[1] - q.r); ext(q.c[0] + q.r, q.c[1] + q.r); }
    }
  }
  if (!Number.isFinite(minX)) return 1e-5;
  const diag = Math.hypot(maxX - minX, maxY - minY);
  return Math.max(diag * 1e-6, 1e-5);
}

function buildCutRecord(item, warnings, slope = null) {
  const rec = defaultCutRecord();
  rec.cutType = mapFusionCutType(item && item.cutType, warnings);
  const depth = item && item.depthMm != null ? Number(item.depthMm) : null;
  rec.cutDepth = depth != null && Number.isFinite(depth) && depth > 0 ? depth : 'unset';
  if (slope) rec.slope = slope; // TASK 714: the wall's rings ride with the record (saved, undone, restored with it); the type stays the plain one
  return rec;
}

const SLOPE_KINDS = { pocket: 'pocket', inside: 'inside', outside: 'outside' };
/**
 * slopeFromRegion(reg, { scale, yUp }, warnings) — TASK 714: a region's `slope` (SA-7, SELECTION-BRIDGE.md rule 3a: rings top-down,
 * { zFromTopMm, segments }) -> the cut record's `slope` = { kind, label, rings: [{ z, segments }] } in WORLD coordinates, the SAME transform
 * the region's geometry gets (#core/dxf-import buildShapesFromPrimitives: x * scale, y * scale negated for a Y-up payload, an arc's direction
 * flipped with it; `ccw` then means the angle increases in world coordinates, the #core/stepped-cut.js convention). z stays mm (the field is
 * named in mm, like depthMm). kind = the region's cutType (pocket | inside | outside): the stepped type that may use it. null when the region
 * has no slope (or under 2 rings), or a ring does not close into one walk (a warning says so; the region imports without it).
 */
export function slopeFromRegion(reg, { scale = 1, yUp = true } = {}, warnings = null) {
  const raw = reg && Array.isArray(reg.slope) ? reg.slope : null;
  if (!raw || raw.length < 2) return null;
  const kind = SLOPE_KINDS[String(reg.cutType || '').trim().toLowerCase()];
  const label = (reg.label && String(reg.label)) || null;
  const name = label || 'A region';
  if (!kind) { if (warnings) warnings.push(`${name}: a slope on a region that is not a pocket, inside or outside cut is ignored`); return null; }
  const ys = yUp ? -1 : 1;
  const seg = (q) => {
    const t = String((q && q.type) || '').toLowerCase(), n = (k) => Number(q[k]) * scale, y = (k) => ys * Number(q[k]) * scale;
    if (t === 'line') return { type: 'line', x1: n('x1'), y1: y('y1'), x2: n('x2'), y2: y('y2') };
    if (t === 'arc') return { type: 'arc', cx: n('cx'), cy: y('cy'), r: n('r'), x1: n('x1'), y1: y('y1'), x2: n('x2'), y2: y('y2'), ccw: yUp ? !q.ccw : Boolean(q.ccw) };
    if (t === 'circle') return { type: 'circle', cx: n('cx'), cy: y('cy'), r: n('r') };
    return { type: t };
  };
  const rings = [];
  for (const r of raw) {
    const z = Number(r && r.zFromTopMm);
    const segments = (Array.isArray(r && r.segments) ? r.segments : []).map(seg);
    if (!Number.isFinite(z) || !ringWalk(segments)) {
      if (warnings) warnings.push(`${name}: slope could not be read (no closed ring at ${Number.isFinite(z) ? z : '?'} mm); imported without its slope`);
      return null;
    }
    rings.push({ z, segments });
  }
  return { kind, label, rings };
}

function matchLoopByGeometry(primIndices, primShapes, loops, candidateLoopIds) {
  const sids = [];
  for (const idx of primIndices) for (const sh of (primShapes[idx] || [])) if (!sh.isConstruction) sids.push(sh.id);
  const k = edgesKey(sids);
  if (!k) return null;
  for (const l of loops) {
    if (candidateLoopIds && !candidateLoopIds.has(l.id)) continue;
    if (edgesKey(l.edges) === k) return l;
  }
  return null;
}

function sameLoopIdSet(a, b) {
  if (a.length !== b.length) return false;
  const setA = new Set(a.map((l) => l.id));
  return b.every((l) => setA.has(l.id));
}

/** TASK 774 (owner turn 2356): the name the design (and so every export file: export-payload.js exportFileName) takes from a Fusion selection: the
 *  Fusion DOCUMENT's name (the add-in's selection_data `source.documentName`, Fusion's Document.name, e.g. "06-countersink v3"), without the
 *  " v<n>" version Fusion appends to it ("06-countersink"); the selection's own name (`source.name`, "Body1") when the payload carries no document
 *  name; "selection" when it carries neither. */
export function selectionDesignName(source) {
  const doc = source && typeof source.documentName === 'string' ? source.documentName.trim().replace(/\s+v\d+$/, '') : '';
  if (doc) return doc;
  return (source && source.name && String(source.name).trim()) || 'selection';
}

/**
 * Import one Fusion `selection_data` payload into the Shaper document in ONE undo step.
 * TASK 712 (owner ruling "Replace"): the selection REPLACES the palette's design: the whole previous document (every sketch, shape,
 * joint, constraint, profile, and every cut-plan record, so the cut settings set on it) goes, as when an empty document is opened
 * (`deserializeDocument(emptyDocument())`), and the selection lands alone in a new named active sketch. Undo gives the previous design
 * back with its cut plan (the snapshot is taken before the reset); redo the new one. To combine things the user selects them together
 * in the add-in's dialog: one payload. A payload with nothing importable changes nothing.
 * Deduplicates shared curves across outer regions and hole loops, populates `CUT_PLAN` and `stock.thickness`, fits the view, and
 * refreshes Prepare. Called by the Fusion palette (main.js, Fusion mode) and, TASK 790, by Open STL (stl-import.js: #core/stl-slice.js makes the same
 * payload from an STL); the normal Import SVG / DXF is #ui/sketch-import.js.
 */
export function importFusionSelection(payload, { controller, prepare = null, plan = CUT_PLAN, onImport = null } = {}) {
  let data = payload;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch (e) { return { ok: false, message: `Invalid selection_data JSON: ${e.message}` }; }
  }
  if (!data || typeof data !== 'object') return { ok: false, message: 'Invalid selection_data payload' };

  const st = controller && controller.state;
  if (!st || !st.joints || !Array.isArray(st.shapes)) {
    return { ok: false, message: 'Cannot import selection: sketch state is not ready' };
  }

  const regions = Array.isArray(data.regions) ? data.regions : [];
  const chains = Array.isArray(data.chains) ? data.chains : [];
  const sourceName = (data.source && data.source.name && String(data.source.name).trim()) || 'selection';
  const warnings = Array.isArray(data.warnings) ? data.warnings.filter(Boolean).map(String) : [];

  const yUp = !(data.coordSystem && String(data.coordSystem.yAxis).toLowerCase() === 'down');
  const scale = UNIT_SCALE_MM[String(data.units || 'mm').toLowerCase()] || 1;

  const rawLists = [];
  const collectSegs = (segs, forceCon = false) => {
    const out = [];
    for (const s of (Array.isArray(segs) ? segs : [])) {
      const q = segmentToPrimitive(s, forceCon, warnings);
      if (q) out.push(q);
    }
    rawLists.push(out);
    return out;
  };

  const regionRaw = regions.map((reg) => ({
    reg,
    outer: collectSegs(reg && reg.outer && reg.outer.segments, Boolean(reg && reg.construction)),
    holes: (Array.isArray(reg && reg.holes) ? reg.holes : []).map((h) =>
      collectSegs(h && h.segments, Boolean((reg && reg.construction) || (h && h.construction))),
    ),
  }));
  const chainRaw = chains.map((chain) => ({
    chain,
    segs: collectSegs(chain && chain.segments, Boolean(chain && chain.construction)),
  }));

  const tol = dedupTolerance(rawLists);
  const uniquePrims = [];
  const intern = (list) => list.map((q) => {
    for (let i = 0; i < uniquePrims.length; i++) {
      if (primitivesMatch(uniquePrims[i], q, tol)) {
        if (!q.con) uniquePrims[i].con = false; // cuttable curve wins if also referenced as non-construction
        return i;
      }
    }
    uniquePrims.push(q);
    return uniquePrims.length - 1;
  });

  const regionRefs = regionRaw.map((r) => ({
    reg: r.reg,
    outerIndices: intern(r.outer),
    holeIndicesList: r.holes.map((h) => intern(h)),
  }));
  const chainRefs = chainRaw.map((c) => ({
    chain: c.chain,
    indices: intern(c.segs),
  }));

  const counts = `${regions.length} regions, ${chains.length} chains`;
  if (uniquePrims.length === 0) {
    return {
      ok: true,
      sketch: null,
      imported: 0,
      joints: [],
      shapes: [],
      regionCount: regions.length,
      chainCount: chains.length,
      cutKeys: [],
      warnings,
      message: `Added ${sourceName}: ${counts}`, // nothing importable: the design is unchanged (wording as before TASK 712)
    };
  }

  // ONE undo step capturing pre-import sketch geometry + host cut plan snapshot.
  if (typeof st.saveState === 'function') st.saveState('import ' + sourceName, { host: true });

  // TASK 712: the selection replaces the design (see the doc comment): the empty document, and no cut-plan record.
  const replaced = st.shapes.length > 0 || plan.size > 0;
  deserializeDocument(emptyDocument(), st);
  plan.clear();
  setStlSource(null); // TASK 790: so is the STL it came from (an STL import, stl-import.js, sets the new one once this returns)

  const sketch = addSketch(st, sourceName);
  activateSketch(st, sketch.id);

  const built = buildShapesFromPrimitives(uniquePrims, {
    genJ: () => (typeof st.genJ === 'function' ? st.genJ() : 'j' + st.joints.size),
    idPrefix: newShapeId('fusion'),
    scale,
    yUp,
  });

  for (const j of built.joints) {
    const entry = { x: j.x, y: j.y };
    stampSketch(entry, st);
    st.joints.set(j.id, entry);
  }
  for (const s of built.shapes) {
    stampSketch(s, st);
    st.shapes.push(s);
  }

  const allLoops = findLoops(st);
  const newShapeIdSet = new Set(built.shapes.map((s) => s.id));
  const candidateLoops = allLoops.filter((l) => (l.edges || []).some((eid) => newShapeIdSet.has(eid)));
  const candidateLoopIds = new Set(candidateLoops.map((l) => l.id));

  const shapeById = new Map(st.shapes.map((s) => [s.id, s]));
  const loopPolys = Object.fromEntries(allLoops.map((l) => [l.id, loopPolygon(l, st, shapeById)]));

  const matchedRegions = regionRefs.map((r) => ({
    reg: r.reg,
    outerLoop: matchLoopByGeometry(r.outerIndices, built.primShapes, candidateLoops, candidateLoopIds),
    holeLoops: r.holeIndicesList
      .map((hi) => matchLoopByGeometry(hi, built.primShapes, candidateLoops, candidateLoopIds))
      .filter(Boolean),
  }));

  // If Fusion emitted a hole loop as its own standalone region (like a circle disk inside a rectangle in sketch mode),
  // keep the outer region as a derived `loop:<id>` rather than locking the hole inside `makeProfile`, so BOTH stay selectable in Prepare.
  const standaloneOuterIds = new Set(matchedRegions.map((m) => m.outerLoop && m.outerLoop.id).filter(Boolean));
  const cutKeys = [];

  for (const m of matchedRegions) {
    if (!m.outerLoop) {
      if (m.reg && m.reg.label) warnings.push(`Could not match closed loop for "${m.reg.label}"`);
      continue;
    }
    let key;
    const allHolesAlsoStandalone = m.holeLoops.length > 0 && m.holeLoops.every((hl) => standaloneOuterIds.has(hl.id));
    const derivedHoles = allHolesAlsoStandalone ? directlyContainedLoops(m.outerLoop, allLoops, loopPolys, st) : null;
    if (m.holeLoops.length > 0 && !(allHolesAlsoStandalone && sameLoopIdSet(m.holeLoops, derivedHoles))) {
      const prof = makeProfile(st, m.outerLoop, m.holeLoops, (m.reg && m.reg.label) || undefined);
      key = keyOf('profile', prof.id);
    } else {
      key = keyOf('loop', m.outerLoop.id);
    }
    plan.set(key, buildCutRecord(m.reg, warnings, slopeFromRegion(m.reg, { scale, yUp }, warnings)));
    cutKeys.push(key);
  }

  // Open non-construction chains become `chain:<id>` targets; construction segments stay `isConstruction: true` only
  // (#core/loop-finder.js excludes `isConstruction` from loops and chains, so they are never cuttable paths).
  const openChains = findOpenChains(st, allLoops);
  const newChains = openChains.filter((c) => (c.shapes || []).some((s) => newShapeIdSet.has(s.id)));
  for (const cr of chainRefs) {
    const sids = [];
    let hasSolid = false;
    for (const idx of cr.indices) {
      for (const sh of (built.primShapes[idx] || [])) {
        if (!sh.isConstruction) { hasSolid = true; sids.push(sh.id); }
      }
    }
    if (!hasSolid) continue;
    const sidSet = new Set(sids);
    const matchedChain = newChains.find((c) => (c.shapes || []).some((s) => sidSet.has(s.id)));
    if (!matchedChain) continue;
    const key = keyOf('chain', matchedChain.id);
    if (!plan.has(key)) {
      plan.set(key, buildCutRecord(cr.chain, warnings));
      cutKeys.push(key);
    }
  }

  // Update stock thickness when provided.
  const stockThickness = data.stock && data.stock.thicknessMm != null ? Number(data.stock.thicknessMm) : null;
  if (stockThickness != null && Number.isFinite(stockThickness) && stockThickness > 0) {
    setStock({ ...getStock(), thickness: stockThickness });
  }

  if (controller.svg) {
    fitToDrawing(controller.svg, Object.create(st, { shapes: { value: built.shapes } }));
  }
  if (prepare && typeof prepare.afterRestore === 'function') prepare.afterRestore();
  if (typeof onImport === 'function') onImport({ sketch, shapes: built.shapes, joints: built.joints, payload: data, warnings });

  return {
    ok: true,
    sketch,
    imported: built.shapes.length,
    joints: built.joints,
    shapes: built.shapes,
    regionCount: regions.length,
    chainCount: chains.length,
    cutKeys,
    warnings,
    name: selectionDesignName(data.source), // TASK 767: the design is now this selection: main.js names it so (the export file names follow); TASK 774: the Fusion DOCUMENT's name
    message: `${replaced ? 'Replaced with' : 'Added'} ${sourceName}: ${counts}`,
  };
}
