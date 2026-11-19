// packages/core/shaper-export.js — pure serializer of a Prepare cut plan → a raw machine-ready Shaper Origin SVG
// STRING. PURE (no DOM). ADDITIVE — nothing imports it yet (SketchStudio byte-identical); reused by joints.
//
// SP1j-1: HEADER + LINE-only loops. SP1j-2 (this slice): FULL geometry + the cut-param attrs —
//   • ARCS in a loop → an `A r r 0 largeArc sweep x y` segment, DIRECTION-AWARE (the loop may walk the arc start→end
//     or end→start; the sweep flag FLIPS on reverse traversal — derived from the arc's stored [center,start,end] +
//     largeArc/sweep, NOT a chord guess). The closing edge is emitted explicitly only when it's an arc (a line is
//     left to Z, so a pure-line loop is byte-identical to SP1j-1).
//   • CIRCLE loop → `<circle cx cy r>`. Open CHAIN ('chain' kind) → its true geometry `<path d="M …">`.
//   • Cut-param attrs (attribute-first): shaper:cutDepth / cutOffset / toolDia, unit-suffixed via
//     units.format(baseMM, docUnit, {unit:true}) → docUnit drives the PARAM suffixes; the geometry stays mm-canonical
//     (viewBox + coords = world/base mm, UNSCALED). cutDepth='unset' / cutOffset 0 / no toolDia → omitted.
// All 5 cut types come from the INJECTED encoding (so #core never imports the app's CUT_TYPES). Without the
// xmlns:shaper declaration the on-tool Origin ignores every custom attr.

import { findLoops, findOpenChains } from './loop-finder.js';
import { formatShaperParam } from './units.js';
import { loopPolygon, loopToPathD, compoundPathD, polyToPathD, chainToPathD } from './loop-geometry.js';
import { resolveProfileViews, resolveProfileForLoop, ownedLoopIds } from './profile-model.js';
import { deriveCuts } from './stepped-cut.js'; // TASK 714: deriveProfileCuts + a stepped cut's terraces
import { pathBounds } from './path-d.js'; // TASK 786: the true extent of a written path (arcs / cubics by their extremes)
export { loopToPathD, polyToPathD };

const SVG_NS = 'http://www.w3.org/2000/svg';
const SHAPER_NS = 'http://www.shapertools.com/namespaces/shaper';

// number → compact string (≤ 4 dp, trailing zeros trimmed, no "-0"). World units = base mm.
function num(n) {
  let r = Math.round(Number(n) * 1e4) / 1e4;
  if (Object.is(r, -0)) r = 0;
  return String(r);
}

// Fallback SVG sweep flag (when an arc shape doesn't carry one): the sign of the signed angle start→end about center.
function angleSweep(center, start, end) {
  let d = Math.atan2(end.y - center.y, end.x - center.x) - Math.atan2(start.y - center.y, start.x - center.x);
  while (d <= -Math.PI) d += 2 * Math.PI;
  while (d > Math.PI) d -= 2 * Math.PI;
  return d > 0 ? 1 : 0;
}

// One arc SEGMENT (no leading M) from fromPos to toPos, DIRECTION-AWARE. The stored sweep is for the arc's
// start→end; if the loop traverses it end→start the flag flips. r/largeArc are direction-invariant.
function arcSeg(shape, fromPos, toPos, state) {
  const center = state.joints.get(shape.joints[0]);
  const start = state.joints.get(shape.joints[1]);
  const end = state.joints.get(shape.joints[2]);
  if (!center || !start || !end) return `L ${num(toPos.x)} ${num(toPos.y)}`; // degenerate → straight fallback
  const r = Math.hypot(start.x - center.x, start.y - center.y);
  const stored = (typeof shape.sweep === 'boolean') ? (shape.sweep ? 1 : 0) : angleSweep(center, start, end);
  const forward = Math.hypot(fromPos.x - start.x, fromPos.y - start.y) <= Math.hypot(fromPos.x - end.x, fromPos.y - end.y);
  const sweep = forward ? stored : (stored ? 0 : 1);
  const largeArc = shape.largeArc ? 1 : 0;
  return `A ${num(r)} ${num(r)} 0 ${largeArc} ${sweep} ${num(toPos.x)} ${num(toPos.y)}`;
}



// Bounding box of the page: the drawing (joint positions + circle extents (center ± r)), the datum triangle at the origin when there is one,
// and TASK 786 EVERY WRITTEN ELEMENT by the geometry it draws (elementBox): a cut's derived geometry outside the drawing (tabs' gap strips,
// a pocket's start mark, a stepped cut's larger rings, a lead-in arc and its tip) and arc / cubic bulges by their true extremes (#core/path-d).
// The drawing's own extent is kept so a file whose elements already lay inside it keeps its viewBox. Empty → 0,0,0,0.
function boundsOf(state, datumExtent, written = []) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const ext = (x, y) => { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; };
  if (state && state.joints && typeof state.joints.values === 'function') {
    for (const j of state.joints.values()) if (j && Number.isFinite(j.x) && Number.isFinite(j.y)) ext(j.x, j.y);
  }
  for (const s of ((state && state.shapes) || [])) {
    if (s && s.type === 'circle' && Array.isArray(s.joints)) {
      const c = state.joints.get(s.joints[0]); const r = Number(s.radius) || 0;
      if (c && r > 0) { ext(c.x - r, c.y - r); ext(c.x + r, c.y + r); }
    }
  }
  if (datumExtent) { ext(0, 0); ext(datumExtent.legX, datumExtent.legY); } // the registration anchor must fit the viewBox
  for (const it of written) { const b = elementBox(it); if (b) { ext(b.minX, b.minY); ext(b.maxX, b.maxY); } }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, w: 0, h: 0 };
  return { minX, minY, w: maxX - minX, h: maxY - minY };
}
// TASK 786: the box of one written element ({ tag, a }: the attributes exactly as written): a <circle> by cx / cy / r, a <path> by its "d".
function elementBox({ tag, a }) {
  const attr = (k) => { const m = a.match(new RegExp(`(?:^|\\s)${k}="([^"]*)"`)); return m ? m[1] : null; };
  if (tag === 'circle') { const cx = Number(attr('cx')), cy = Number(attr('cy')), r = Number(attr('r')); return { minX: cx - r, minY: cy - r, maxX: cx + r, maxY: cy + r }; }
  if (tag === 'path') return pathBounds(attr('d'));
  throw new Error(`shaper-export: no box for a written <${tag}>`);
}

// fill (always) + stroke (omit when 'none'), from the injected encoding.
function colorAttrs(enc) {
  let s = ` fill="${enc.fill}"`;
  if (enc.stroke && enc.stroke !== 'none') s += ` stroke="${enc.stroke}"`;
  return s;
}
// TASK 786: a MARK (a derived cut of kind 'mark': a programmed pocket's start mark, #core/pocket-clearing, a circle + cross) is a guide drawn as
// its OUTLINE: written with its type's encoding (the guide's cutType, blue stroke and params, as the Stock guide of TASK 774) but fill="none"
// (as Prepare and Export 2D show it; a filled circle hid the target and a fill has no meaning on the cross's open strokes), and IN PLACE: right
// after its pocket's elements, never hoisted into a <g> (groupByCut) that a first element of the same attrs (another pocket's mark) placed
// earlier in the file, behind a later pocket's white wall.
const isMark = (cut) => cut.kind === 'mark';
// attribute-first shaper:* in Shaper Studio's order — cutType, cutDepth (only when set), cutOffset (ALWAYS: "0in" when zero),
// toolDia (ALWAYS) — written through the ONE formatter (units.js formatShaperParam: "0.100 in" / "-2.000 in" / "0.125 in";
// TASK 456, from four real Studio exports), and ONLY the params the INJECTED encoding declares in `params` (an encoding
// without `params`, i.e. the stub encodings in tests, writes all).
function shaperAttrs(rec, enc, docUnit) {
  let s = ` shaper:cutType="${enc.cutType}"`;
  const has = (k) => !Array.isArray(enc.params) || enc.params.includes(k);
  const dep = Number(rec.cutDepth);
  if (has('cutDepth') && rec.cutDepth != null && rec.cutDepth !== 'unset' && Number.isFinite(dep)) s += ` shaper:cutDepth="${formatShaperParam(dep, docUnit)}"`;
  if (has('cutOffset')) s += ` shaper:cutOffset="${formatShaperParam(Number.isFinite(Number(rec.cutOffset)) ? Number(rec.cutOffset) : 0, docUnit, { zeroBare: true })}"`;
  const tool = Number(rec.toolDia);
  if (has('toolDia') && rec.toolDia != null && Number.isFinite(tool)) s += ` shaper:toolDia="${formatShaperParam(tool, docUnit)}"`;
  return s;
}

// Element builders return the GEOMETRY only ({ tag, a }) so the cut attrs can be carried per-element OR hoisted to a
// <g> (options.groupByCut). circle = a single-circle loop or a circle edge.
function circleGeom(s, state) {
  const c = state.joints.get(s.joints[0]); const r = Number(s.radius) || 0;
  return (c && r > 0) ? { tag: 'circle', a: `cx="${num(c.x)}" cy="${num(c.y)}" r="${num(r)}"` } : null;
}
function loopGeom(loop, state, shapeById) {
  if (Array.isArray(loop.edges) && loop.edges.length === 1) {
    const s = shapeById.get(loop.edges[0]);
    if (s && s.type === 'circle') return circleGeom(s, state);
  }
  const d = loopToPathD(loop, state);
  return d ? { tag: 'path', a: `d="${d}"` } : null;
}

// SP1j-3a: the red DATUM registration triangle — a right triangle at the 0,0 origin, legs on X/Y, fill #FF0000, no
// stroke. The Origin snaps (0,0) to the 90° vertex (short leg = X, long leg = Y). Spec example = 20×10 mm (the default).
function datumDims(datum) {
  const o = (datum && typeof datum === 'object') ? datum : {};
  return { legX: Number(o.legX) > 0 ? Number(o.legX) : 20, legY: Number(o.legY) > 0 ? Number(o.legY) : 10 };
}
function datumPolygon(datum) {
  const { legX, legY } = datumDims(datum);
  return `<polygon points="0,0 ${num(legX)},0 0,${num(legY)}" fill="#FF0000" stroke="none"/>`;
}

// exportShaperSVG({ state, entries, encoding, docUnit, options, loopPolys }) → an SVG string.
//   state    — { joints: Map(id→{x,y}), shapes, constraints, profiles? } (loops re-derived via findLoops)
//   entries  — [{ target:{kind,id}, rec:{cutType, cutDepth, cutOffset, toolDia} }] (the Prepare cut plan: loop / profile / chain)
//   encoding — [{ id, cutType, fill, stroke, exportFirst? }, …] INJECTED       (cutType id → the Shaper machine encoding)
//              TASK 774 (owner turn 2356): a type that declares `exportFirst: true` (Shaper's Stock: the whole board, a filled guide) is written
//              FIRST, before every other cut (after the datum when there is one), so anything that paints the file in order (the Origin's screen,
//              ShaperHub thumbnails) draws it BEHIND the cuts. Only the order moves: every element keeps its bytes, the others their relative order.
//   docUnit  — 'mm' | 'cm' | 'in' — suffixes the cut PARAMS; the geometry stays mm-canonical.
//   options  — { datum?, groupByCut? } — DECLARED unsurfaced features, DEFAULT OFF (so callers/oracles are unchanged):
//                datum: true | {legX,legY}  → emit the red registration triangle FIRST.
//                groupByCut: true           → wrap elements sharing IDENTICAL cut attrs in one <g> (attrs hoisted off
//                                             the children, which inherit); unique-attr elements stay ungrouped.
//                previewData: true          → TASK 718: the PREVIEW copy (Shaper's Export step, 2D view) — each element of a stepped cut
//                                             carries data-step="k/N" (its terrace, from deriveCuts: what the file alone cannot say, since
//                                             two cuts' steps at the same depth are written alike). Never in the downloaded file: with it
//                                             off (the default) the string is byte-identical; the attribute is on the element only, so the
//                                             <g> grouping is the same either way. TASK 742: a held cut's element carries data-hold
//                                             ("pass" | "skin" | "gap k/N", holdData) the same way. TASK 743: an entry may carry `op` (the id of
//                                             the app's OPERATION it belongs to, a display grouping); its elements carry data-op="<id>" the
//                                             same way (the Export step's operations list finds them by it). The file never changes.
//                                             TASK 745: a programmed pocket's element carries data-clear (clearData) the same way.
// TASK 742: the PREVIEW copy's data-hold of a held cut (#core/hold-part): "pass" (tabs' pass 1) | "skin" (an onion skin) | "gap k/N" (a gap strip);
// a refused hold or none: nothing. Never in the downloaded file (previewData only).
function holdData(hold) {
  if (!hold) return '';
  if (hold.role === 'pass') return ` data-hold="${hold.mode === 'skin' ? 'skin' : 'pass'}"`;
  if (hold.role === 'strip') return ` data-hold="gap ${hold.index + 1}/${hold.count}"`;
  if (hold.role === 'stroke') return ` data-hold="stroke ${hold.index + 1}/${hold.count}"`; // TASK 775: an On line cut's tabs: its open strokes
  return '';
}
// TASK 778: the PREVIEW copy's data-lead of a cut written with a lead-in arc (#core/lead-in): "in". Never in the downloaded file.
const leadData = (leadIn) => (leadIn && leadIn.role === 'arc' ? ' data-lead="in"' : '');
// TASK 745: the PREVIEW copy's data-clear of a programmed pocket's cut (#core/pocket-clearing): "linked k/N" (TASK 749: Spiral line k of N) | "raster k/N" | "cleanup k/N" | "morphed" | "loop k/N" (TASK 750) |
// "wall" | "island k/N" | "start" (TASK 778: the pocket start mark guide); a refused clearing or none: nothing. Never in the downloaded file.
function clearData(cl) {
  if (!cl || cl.role === 'refused') return '';
  const what = cl.role === 'wall' || cl.role === 'morphed' || cl.role === 'start' ? cl.role : `${cl.role} ${cl.index}/${cl.count}`;
  return ` data-clear="${what}"`;
}

export function exportShaperSVG({ state, entries, encoding, docUnit, options = {}, loopPolys } = {}) {
  const ents = Array.isArray(entries) ? entries : [];
  const enc = Array.isArray(encoding) ? encoding : [];
  const encOf = (id) => enc.find((t) => t && t.id === id) || null;
  const shapeById = new Map(((state && state.shapes) || []).map((s) => [s.id, s]));
  const loops = findLoops(state || {});
  const loopById = new Map(loops.map((l) => [l.id, l]));
  const chains = findOpenChains(state || {}, loops);
  const chainById = new Map(chains.map((c) => [c.id, c]));
  const hasProfiles = Array.isArray(state?.profiles) && state.profiles.length > 0;

  let polyMap = null;
  const ensurePolys = () => {
    if (polyMap) return polyMap;
    polyMap = {};
    if (loopPolys && typeof loopPolys === 'object') {
      if (loopPolys instanceof Map) {
        for (const [k, v] of loopPolys.entries()) polyMap[k] = v;
      } else {
        Object.assign(polyMap, loopPolys);
      }
    }
    for (const l of loops) {
      if (!polyMap[l.id] || !polyMap[l.id].length) {
        polyMap[l.id] = loopPolygon(l, state || {}, shapeById);
      }
    }
    return polyMap;
  };
  const profileViews = hasProfiles ? resolveProfileViews(state, loops, ensurePolys()) : null;

  const compoundOrLoopGeom = (outerLoop, holeIds) => {
    if (!outerLoop) return null;
    if (Array.isArray(holeIds) && holeIds.length > 0) {
      const d = compoundPathD(outerLoop, holeIds.map((hid) => loopById.get(hid)).filter(Boolean), state); // holes wound opposite: no fill-rule needed
      return d ? { tag: 'path', a: `d="${d}"` } : null;
    }
    return loopGeom(outerLoop, state, shapeById);
  };

  // resolve each entry → { common (cut attrs), tag, a (geometry attrs) }
  const items = [];
  const firstItems = []; // TASK 774: the elements of the exportFirst types (the Stock)
  const owned = ownedLoopIds(ents, state, loops, ensurePolys()); // TASK 711: a hole with its own entry is cut by that entry only
  for (const e of ents) {
    if (!e || !e.target || !e.rec || !e.rec.cutType) continue;
    // TASK 714: a STEPPED type's encoding declares `terraceAs` (the plain type each terrace is cut as): deriveCuts then returns one
    // plain cut per terrace, each written with ITS type's encoding at its own depth, and its own outline (`geom`). The Origin sees plain cuts.
    const typeEnc = encOf(e.rec.cutType);
    const rec = typeEnc && typeEnc.terraceAs ? { ...e.rec, terraceAs: typeEnc.terraceAs } : e.rec;
    const cuts = deriveCuts(e.target, rec, state, loops, ensurePolys(), owned);
    for (const cut of cuts) {
      const c = encOf(cut.rec.cutType);
      if (!c) continue;
      let geom = null;
      if (cut.geom) {
        geom = cut.geom;
      } else if (cut.isCompound) {
        if (cut.d) {
          geom = { tag: 'path', a: `d="${cut.d}"` };
        } else if (cut.holeLoops && cut.holeLoops.length > 0) {
          geom = compoundOrLoopGeom(cut.outerLoop, cut.holeLoops.map((h) => h.id));
        } else {
          geom = loopGeom(cut.outerLoop, state, shapeById);
        }
      } else if (cut.kind === 'chain') {
        const d = chainToPathD(cut.chain, state);
        if (d) geom = { tag: 'path', a: `d="${d}"` };
      } else if (cut.loop) {
        geom = loopGeom(cut.loop, state, shapeById);
      }
      const data = (options.previewData && cut.terrace ? ` data-step="${cut.terrace.index + 1}/${cut.terrace.count}"` : (options.previewData ? holdData(cut.hold) + clearData(cut.clearing) + leadData(cut.leadIn) : ''))
        + (options.previewData && typeof e.op === 'string' ? ` data-op="${e.op.replace(/[&<>"]/g, '')}"` : ''); // TASK 743
      const paint = isMark(cut) ? colorAttrs({ ...c, fill: 'none' }) : colorAttrs(c); // TASK 786: a mark is stroke-only
      if (geom) (c.exportFirst ? firstItems : items).push({ common: paint + shaperAttrs(cut.rec, c, docUnit), tag: geom.tag, a: geom.a + data, inPlace: isMark(cut) });
    }
  }
  items.unshift(...firstItems); // TASK 774: the exportFirst types (the Stock) before every cut, each list in plan order

  const body = [];
  if (options.datum) body.push('  ' + datumPolygon(options.datum));

  if (options.groupByCut) {
    // each group is written where its first element was (deterministic); TASK 786: an in-place element (a mark) is written alone, where it is
    const groups = new Map(), slots = []; // common → items; slots = the file order of the groups and the in-place elements
    for (const it of items) {
      if (it.inPlace) { slots.push({ common: it.common, group: [it] }); continue; }
      if (!groups.has(it.common)) { groups.set(it.common, []); slots.push({ common: it.common, group: groups.get(it.common) }); }
      groups.get(it.common).push(it);
    }
    for (const { common, group } of slots) {
      if (group.length >= 2) { // hoist the shared cut attrs to a <g>; the children inherit (drop their attrs)
        body.push(`  <g${common}>`);
        for (const it of group) body.push(`    <${it.tag} ${it.a}/>`);
        body.push('  </g>');
      } else {
        body.push(`  <${group[0].tag} ${group[0].a}${common}/>`);
      }
    }
  } else {
    for (const it of items) body.push(`  <${it.tag} ${it.a}${it.common}/>`);
  }

  const b = boundsOf(state, options.datum ? datumDims(options.datum) : null, items); // TASK 786: every written element (items holds the Stock too)
  const header = `<svg xmlns="${SVG_NS}" xmlns:shaper="${SHAPER_NS}" width="${num(b.w)}mm" height="${num(b.h)}mm" viewBox="${num(b.minX)} ${num(b.minY)} ${num(b.w)} ${num(b.h)}">`;
  return [header, ...body, '</svg>'].join('\n');
}
