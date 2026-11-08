// Shaper Origin cut-type encoding — the single source of truth.
//
// Shaper encodes the cut operation in an element's fill/stroke COLOR, and
// (optionally) in explicit shaper:* attributes. Shaper's own docs show the
// colors as swatches rather than hex; the hex values below are the de-facto
// community encoding used by Shaper Studio and the common converters.
// If a value is ever wrong for your Origin, fix it HERE — everything reads
// from this table.

import { parse as parseUnit } from '#core/units.js';

export const SHAPER_NS = 'http://www.shapertools.com/namespaces/shaper';

// Hex is UPPERCASE to round-trip byte-for-byte with Shaper's own exporter.
// Match is case-insensitive (see classify), so lowercase input still works.
//
// fill/stroke = the EXPORT encoding (black/white/gray/blue — never change these here; the SVG export reads them).
// SP1f adds three DECLARED-but-additive fields used only by Shaper's Prepare tab (they never touch export):
//   targetKind  — 'region' (acts on a closed area) | 'path' (acts on a single vector). Drives the gating rule:
//                 a LOOP target accepts all 5; an EDGE target accepts only the 'path' types (online/guide).
//   menuLabel   — the cut-menu label (matches Shaper's wording).
//   autoOffsetFraction — TASK 452: the Origin keeps a pocket's cutter this fraction of the cutter diameter BACK from the wall
//                 automatically ("Pocketing procedure": "Origin automatically adds a small offset when performing a pocket cut,
//                 allowing you finish up the edge with an Inside cut", "equal to 1/4th of the specified cutter diameter" since the
//                 Napa software). The user's own cutOffset ADDS to it. Declared ONCE here; effectiveCutRecord() turns it into
//                 rec.autoOffset (mm) for the preview. The Origin's own offset is never written to the export.
//   params      — TASK 450/450b/456: WHICH cut params the type has, ONE declaration (subset of SHAPER_FIELDS). Today every type has
//                 all three (cutDepth, cutOffset, toolDia): Shaper Studio shows and writes an offset on On Line too (owner's
//                 screenshot + a real Studio export with shaper:cutOffset="0in" on an On Line path), and a Guide keeps them (its
//                 type can be changed ON THE TOOL later and the params travel with the path). The declaration stays so a type
//                 that really lacks a param is a one-line change: the cut card shows only those rows, the export writes only
//                 those attributes, the preview ignores the rest (a value stored for a missing param is never migrated).
//   offsetMovesCut — TASK 456: `false` = a stored offset does NOT move the cut: Studio still draws an On Line band CENTRED on the
//                 line with an offset typed in (Shaper: "offsets are not an option" for On Line). The card still shows the field and
//                 the export still writes it (Studio parity); only the PREVIEW (effectiveCutRecord) ignores it.
//   icon        — TASK 455: the inline SVG inner markup (16x16, currentColor) shown in the cut card dropdown. The Prepare preview colours
//                 are CSS tokens in apps/shaper/index.html (--sk-prep-*), not hex fields on the record (the export fill/stroke stay).
export const CUT_TYPES = [
  { id: 'exterior', label: 'Exterior', cutType: 'outside', fill: '#000000', stroke: 'none',    desc: 'Cut out a positive shape (closed paths)',  targetKind: 'region', menuLabel: 'Outside', icon: "<rect x='1.5' y='1.5' width='15' height='15' fill='none' stroke='currentColor' stroke-width='1.3' stroke-dasharray='1.8 1.6'/><rect x='5' y='5' width='8' height='8' fill='none' stroke='currentColor' stroke-width='1.5'/><circle cx='16.5' cy='11' r='1.5' fill='currentColor'/>", params: ['cutDepth', 'cutOffset', 'toolDia'] },
  { id: 'interior', label: 'Interior', cutType: 'inside',  fill: '#FFFFFF', stroke: '#000000', desc: 'Cut a through-hole (closed paths)',         targetKind: 'region', menuLabel: 'Inside', icon: "<rect x='2' y='2' width='14' height='14' fill='none' stroke='currentColor' stroke-width='1.5'/><rect x='5.5' y='5.5' width='7' height='7' fill='none' stroke='currentColor' stroke-width='1.3' stroke-dasharray='1.6 1.4'/><circle cx='12.5' cy='9' r='1.4' fill='currentColor'/>", params: ['cutDepth', 'cutOffset', 'toolDia'] },
  { id: 'pocket',   label: 'Pocket',   cutType: 'pocket',  fill: '#7F7F7F', stroke: 'none',    desc: 'Remove material inside to a depth (closed paths)', targetKind: 'region', menuLabel: 'Pocket', icon: "<rect x='2' y='2' width='14' height='14' fill='none' stroke='currentColor' stroke-width='1.5'/><path d='M4.5 4.5l9 9M13.5 4.5l-9 9' fill='none' stroke='currentColor' stroke-width='1.2' stroke-dasharray='1.5 1.5'/>", params: ['cutDepth', 'cutOffset', 'toolDia'], autoOffsetFraction: 0.25 },
  { id: 'online',   label: 'On-line',  cutType: 'online',  fill: 'none',    stroke: '#7F7F7F', desc: 'Center the cut on the path',               targetKind: 'path',   menuLabel: 'On line', icon: "<rect x='2' y='2' width='14' height='14' fill='none' stroke='currentColor' stroke-width='1.4' stroke-dasharray='1.8 1.6'/><circle cx='16' cy='11' r='1.6' fill='currentColor'/>", params: ['cutDepth', 'cutOffset', 'toolDia'], offsetMovesCut: false },
  { id: 'guide',    label: 'Guide',    cutType: 'guide',   fill: '#0068FF', stroke: '#0068FF', desc: 'Reference mark, not cut',                  targetKind: 'path',   menuLabel: 'Guide', icon: "<path d='M8 2h8v8M2 8v8h8' fill='none' stroke='currentColor' stroke-width='1.6'/>", params: ['cutDepth', 'cutOffset', 'toolDia'] },
  // TASK 472: STOCK = the board itself, drawn as a closed profile in Design and marked here. NOT a cut: the Review extrudes it to its
  // thickness (the one depth row, relabelled). The EXPORT writes it as a GUIDE (owner: "ok guide then": Shaper's docs call a guide
  // "uncuttable", so the stock line can never be cut by accident): the guide's colour and cutType, its thickness in cutDepth, in
  // the same order and format as every other cut; `exportParams` = the attributes the exported element carries (a guide keeps all
  // three), `params` = the rows the Prepare card shows. Declared AFTER the guide so classify() (import) reads blue as a GUIDE:
  // re-importing gives a Guide the owner can re-mark Stock.
  { id: 'stock',    label: 'Stock',    cutType: 'guide',   fill: '#0068FF', stroke: '#0068FF', desc: 'The board: this closed profile, extruded to its thickness (shown in Review; exported as a guide)', targetKind: 'region', menuLabel: 'Stock', depthLabel: 'Thickness', icon: "<path d='M2 6l6-3.2L14 6 8 9.2z' fill='none' stroke='currentColor' stroke-width='1.5' stroke-linejoin='round'/><path d='M2 6v4l6 3.2L14 10V6' fill='none' stroke='currentColor' stroke-width='1.5' stroke-linejoin='round'/>", params: ['cutDepth'], exportParams: ['cutDepth', 'cutOffset', 'toolDia'] },
];

// TASK 472: the id of the Stock type, and the encoding the EXPORT gets: CUT_TYPES with each entry's `exportParams` (if any) as its
// `params`, so a Stock loop exports exactly like a Guide while its Prepare card shows only the thickness row.
export const STOCK_TYPE_ID = 'stock';
export const exportEncoding = () => CUT_TYPES.map((t) => (t.exportParams ? { ...t, params: t.exportParams } : t));


// VCARVE-3b: DECLARED V-bit presets — the INCLUDED angle (°). halfAngleTan = tan(angle/2) feeds #core/vcarve
// vcarveContours (depth = inset / halfAngleTan). 90° → 1 (depth = inset); 60° → tan30 ≈ 0.577 (cuts ~1.73× deeper).
export const VBIT_PRESETS = [{ angle: 90 }, { angle: 60 }, { angle: 45 }, { angle: 30 }, { angle: 20 }];
// VCARVE-4: the ONE implementation lives in #core/vcarve.js (shared by the preview + the export); re-exported here.
export { vbitHalfAngleTan } from '#core/vcarve.js';

// shaper:* attributes Shaper writes per element (besides cutType, which we
// derive from color). Order = inspector display order.
export const SHAPER_FIELDS = ['cutDepth', 'cutOffset', 'toolDia'];

// --- Prepare cut-plan helpers (SP1f) -------------------------------------
// The Prepare tab assigns a cut to a topological TARGET (a loop or an edge), not to an SVG element. These helpers
// declare the per-target cut RECORD shape + the type gating; the live assignments (keyed by targetKey) live in
// prepare-view.js so they persist across Prepare re-mounts.

export function cutTypeById(id) {
  return CUT_TYPES.find((t) => t.id === id) || null;
}

// TASK 450b: does this cut type have this param ('cutDepth' | 'cutOffset' | 'toolDia')? Declared on the CUT_TYPES record
// (`params`); an unknown / unset type = yes (nothing to hide before a type is chosen).
export function cutTypeHasParam(id, param) {
  const t = id ? cutTypeById(id) : null;
  return !(t && Array.isArray(t.params) && !t.params.includes(param));
}
// The record the PREVIEW should use: params the type does not have are ignored (never migrated or deleted from the plan).
export function effectiveCutRecord(rec) {
  if (!rec || !rec.cutType) return rec;
  const out = { ...rec };
  if (!cutTypeHasParam(rec.cutType, 'cutDepth')) out.cutDepth = 'unset';
  if (!cutTypeHasParam(rec.cutType, 'cutOffset')) out.cutOffset = 0;
  if (cutTypeById(rec.cutType) && cutTypeById(rec.cutType).offsetMovesCut === false) out.cutOffset = 0; // preview only: the cut stays centred
  if (!cutTypeHasParam(rec.cutType, 'toolDia')) out.toolDia = 0;
  const t = cutTypeById(rec.cutType);
  out.autoOffset = (t && t.autoOffsetFraction) ? (Number(out.toolDia) || 0) * t.autoOffsetFraction : 0; // TASK 452: the Origin's automatic pocket offset
  return out;
}

// A fresh per-target cut record. Numeric fields are in BASE mm (U3a; 1 world unit = 1 mm) — the cut panel
// displays/parses them through the document unit. toolDia default 3.175 mm = 1/8 in.
export function defaultCutRecord() {
  return { cutType: null, cutDepth: 'unset', cutOffset: 0, toolDia: 3.175, cutterShape: 'endmill', cutterAngle: 90 };
}

// TASK 455: the CUTTER SHAPE (a cut-record field, NEVER exported: the Shaper SVG has no attribute for it; the 3D Review of task
// 457 will read it): 'endmill' (flat, default) | 'ballnose' | 'vbit'. A V-bit's angle (`cutterAngle`) comes from the EXISTING
// VBIT_PRESETS above (vbitHalfAngleTan stays the one V-bit helper). `icon` = 16x16 inner markup in currentColor.
export const CUTTER_SHAPES = [
  { id: 'endmill', label: 'end mill', icon: "<path d='M6 1v12h6V1' fill='none' stroke='currentColor' stroke-width='1.5'/><path d='M5 13h8' fill='none' stroke='currentColor' stroke-width='1.8'/>" },
  { id: 'ballnose', label: 'ball nose', icon: "<path d='M6 1v10a3 3 0 0 0 6 0V1' fill='none' stroke='currentColor' stroke-width='1.5'/>" },
  { id: 'vbit', label: 'V-bit', icon: "<path d='M5 1v8l4 7 4-7V1' fill='none' stroke='currentColor' stroke-width='1.5' stroke-linejoin='round'/>" },
];
// TASK 455: the offset field's preset popover (3x2): .001 .005 .01 / 1/32 1/16 1/8 inch, in BASE mm. The mm values are the exact
// conversions of those inch presets — UNVERIFIED against Studio's own mm presets.
export const OFFSET_PRESETS = [
  { label: '.001', mm: 0.001 * 25.4 }, { label: '.005', mm: 0.005 * 25.4 }, { label: '.01', mm: 0.01 * 25.4 },
  { label: '1/32', mm: 25.4 / 32 }, { label: '1/16', mm: 25.4 / 16 }, { label: '1/8', mm: 25.4 / 8 },
];

// Gating: which cut types may be assigned to a target of this selection kind ('loop' | 'profile' | 'chain').
// A LOOP or PROFILE is both a closed region AND a closed path → all 5. A CHAIN is an open path → only the 'path' types.
export function availableTypes(selectedKind) {
  return CUT_TYPES.filter((t) => t.targetKind === 'path' || selectedKind === 'loop' || selectedKind === 'profile');
}

const NAMED = {
  black: '#000000', white: '#ffffff', gray: '#808080', grey: '#808080',
  blue: '#0000ff', red: '#ff0000', none: 'none', transparent: 'none',
};

// Normalize a CSS color to a lowercase #rrrggbb string (or 'none').
function norm(c) {
  if (c == null) return 'none';
  c = String(c).trim().toLowerCase();
  if (c === '') return 'none';
  if (NAMED[c]) return NAMED[c];
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(c);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return c;
}

function colorOf(el, attr) {
  return norm(el.getAttribute(attr));
}

// TASK 478: colours are matched with a TOLERANCE, declared ONCE here beside CUT_TYPES: the Fusion add-in writes
// fill="rgb(121,121,121)" / rgb(134,134,134) / rgb(106,106,106) for pockets (three different greys, one per depth), not Studio's exact
// #7F7F7F. A GREY (r, g, b within `grey.spread` of each other, level between `grey.min` and `grey.max`) matches a declared grey; black,
// white and the guide blue match within `channel` per channel. rgb(), #rgb, #rrggbb and the names all parse.
export const COLOR_TOLERANCE = { channel: 12, grey: { spread: 12, min: 40, max: 215 } };

// A CSS colour -> [r, g, b] (0-255), or null ('none', transparent, an unknown form).
function rgbOf(c) {
  if (c == null) return null;
  const t = String(c).trim().toLowerCase();
  if (t === '' || t === 'none' || t === 'transparent') return null;
  const m = /^rgba?\(\s*([\d.]+)(%?)\s*[, ]\s*([\d.]+)(%?)\s*[, ]\s*([\d.]+)(%?)/.exec(t);
  if (m) return [[m[1], m[2]], [m[3], m[4]], [m[5], m[6]]].map(([v, pct]) => Math.round(pct ? parseFloat(v) * 2.55 : parseFloat(v)));
  const hex = norm(t);
  const h = /^#([0-9a-f]{6})$/.exec(hex);
  return h ? [0, 2, 4].map((i) => parseInt(h[1].slice(i, i + 2), 16)) : null;
}
const isGrey = (rgb) => { const sp = Math.max(...rgb) - Math.min(...rgb), lv = (rgb[0] + rgb[1] + rgb[2]) / 3; return sp <= COLOR_TOLERANCE.grey.spread && lv >= COLOR_TOLERANCE.grey.min && lv <= COLOR_TOLERANCE.grey.max; };
// Does an element colour (`actual`) match a DECLARED encoding colour (`declared`)? 'none' only matches 'none'.
function colorMatches(declared, actual) {
  const d = rgbOf(declared), a = rgbOf(actual);
  if (!d || !a) return !d && !a;
  if (isGrey(d)) return isGrey(a);
  return d.every((v, i) => Math.abs(v - a[i]) <= COLOR_TOLERANCE.channel);
}

// Which cut type (if any) does this element's current fill/stroke encode?
export function classify(el) {
  const f = colorOf(el, 'fill');
  const s = colorOf(el, 'stroke');
  for (const t of CUT_TYPES) {
    if (colorMatches(t.fill, f) && colorMatches(t.stroke, s)) return t.id;
  }
  return null;
}

// Apply a cut type: set the encoding color(s) + the explicit shaper:cutType.
export function applyCutType(el, id) {
  const t = CUT_TYPES.find((x) => x.id === id);
  if (!t) return;
  el.setAttribute('fill', t.fill); // 'none' is a valid, explicit fill
  if (t.stroke === 'none') el.removeAttribute('stroke');
  else el.setAttribute('stroke', t.stroke);
  setShaperAttr(el, 'cutType', t.cutType);
}

// --- shaper:* namespaced attribute helpers -------------------------------

export function getShaperAttr(el, name) {
  if (!el) return null;
  if (el.getAttributeNS) {
    const nsVal = el.getAttributeNS(SHAPER_NS, name);
    if (nsVal != null) return nsVal;
  }
  if (el.getAttribute) {
    return el.getAttribute(`shaper:${name}`) || el.getAttribute(name);
  }
  return null;
}

export function setShaperAttr(el, name, value) {
  if (value == null || String(value).trim() === '') {
    el.removeAttributeNS(SHAPER_NS, name);
  } else {
    el.setAttributeNS(SHAPER_NS, `shaper:${name}`, String(value).trim());
  }
}

export function hasAnyShaperAttr(root) {
  for (const el of [root, ...root.querySelectorAll('*')]) {
    for (const a of el.attributes) {
      if (a.name === 'shaper' || a.name.startsWith('shaper:')) return true;
    }
  }
  return false;
}

const CUT_TYPE_ALIASES = {
  outside: 'exterior',
  exterior: 'exterior',
  inside: 'interior',
  interior: 'interior',
  pocket: 'pocket',
  online: 'online',
  'on-line': 'online',
  guide: 'guide',
};

// Extract a cut record from an incoming SVG element (e.g. from Fusion 360 Shaper utility).
// Numeric fields are parsed to BASE mm per docUnit; unstated toolDia defaults to 1/8" (3.175 mm).
export function extractCutRecord(el, docUnit = 'mm') {
  if (!el) return null;
  const rawType = getShaperAttr(el, 'cutType');
  let cutType = null;
  if (rawType) {
    const normalized = String(rawType).trim().toLowerCase();
    cutType = CUT_TYPE_ALIASES[normalized] || null;
  }
  if (!cutType) {
    cutType = classify(el);
  }

  const rawDepth = getShaperAttr(el, 'cutDepth');
  let cutDepth = 'unset';
  if (rawDepth != null && String(rawDepth).trim() !== '' && String(rawDepth).trim().toLowerCase() !== 'unset') {
    const parsed = parseUnit(rawDepth, docUnit);
    if (parsed != null && Number.isFinite(parsed)) cutDepth = parsed;
  }

  const rawOffset = getShaperAttr(el, 'cutOffset');
  let cutOffset = 0;
  if (rawOffset != null && String(rawOffset).trim() !== '') {
    const parsed = parseUnit(rawOffset, docUnit);
    if (parsed != null && Number.isFinite(parsed)) cutOffset = parsed;
  }

  const rawDia = getShaperAttr(el, 'toolDia');
  let toolDia = 3.175; // Shaper standard default 1/8" = 3.175 mm
  if (rawDia != null && String(rawDia).trim() !== '') {
    const parsed = parseUnit(rawDia, docUnit);
    if (parsed != null && Number.isFinite(parsed) && parsed > 0) toolDia = parsed;
  }

  if (!cutType && cutDepth === 'unset' && cutOffset === 0 && !rawDia) return null;
  return { cutType, cutDepth, cutOffset, toolDia };
}
