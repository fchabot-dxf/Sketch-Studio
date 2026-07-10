// Shaper Origin cut-type encoding — the single source of truth.
//
// Shaper encodes the cut operation in an element's fill/stroke COLOR, and
// (optionally) in explicit shaper:* attributes. Shaper's own docs show the
// colors as swatches rather than hex; the hex values below are the de-facto
// community encoding used by Shaper Studio and the common converters.
// If a value is ever wrong for your Origin, fix it HERE — everything reads
// from this table.

export const SHAPER_NS = 'http://www.shapertools.com/namespaces/shaper';

// Hex is UPPERCASE to round-trip byte-for-byte with Shaper's own exporter.
// Match is case-insensitive (see classify), so lowercase input still works.
//
// fill/stroke = the EXPORT encoding (black/white/gray/blue — never change these here; the SVG export reads them).
// SP1f adds three DECLARED-but-additive fields used only by Shaper's Prepare tab (they never touch export):
//   targetKind  — 'region' (acts on a closed area) | 'path' (acts on a single vector). Drives the gating rule:
//                 a LOOP target accepts all 5; an EDGE target accepts only the 'path' types (online/guide).
//   menuLabel   — the cut-menu label (matches Shaper's wording).
//   previewFill / previewStroke — a DARK-canvas-legible palette (green family) for the Prepare cut-plan preview;
//                 the export colors (e.g. exterior=#000) are invisible/illegible on the dark Prepare canvas.
export const CUT_TYPES = [
  { id: 'exterior', label: 'Exterior', cutType: 'outside', fill: '#000000', stroke: 'none',    desc: 'Cut out a positive shape (closed paths)',  targetKind: 'region', menuLabel: 'Outside', previewFill: '#22c55e', previewStroke: '#16a34a' },
  { id: 'interior', label: 'Interior', cutType: 'inside',  fill: '#FFFFFF', stroke: '#000000', desc: 'Cut a through-hole (closed paths)',         targetKind: 'region', menuLabel: 'Inside',  previewFill: '#86efac', previewStroke: '#22c55e' },
  { id: 'pocket',   label: 'Pocket',   cutType: 'pocket',  fill: '#7F7F7F', stroke: 'none',    desc: 'Remove material inside to a depth (closed paths)', targetKind: 'region', menuLabel: 'Pocket', previewFill: '#15803d', previewStroke: '#4ade80' },
  { id: 'online',   label: 'On-line',  cutType: 'online',  fill: 'none',    stroke: '#7F7F7F', desc: 'Center the cut on the path',               targetKind: 'path',   menuLabel: 'On line', previewFill: 'none',    previewStroke: '#34d399' },
  { id: 'guide',    label: 'Guide',    cutType: 'guide',   fill: '#0068FF', stroke: '#0068FF', desc: 'Reference mark, not cut',                  targetKind: 'path',   menuLabel: 'Guide',   previewFill: 'none',    previewStroke: '#a3e635' },
];

// VCARVE-3b: DECLARED V-bit presets — the INCLUDED angle (°). halfAngleTan = tan(angle/2) feeds #core/vcarve
// vcarveContours (depth = inset / halfAngleTan). 90° → 1 (depth = inset); 60° → tan30 ≈ 0.577 (cuts ~1.73× deeper).
export const VBIT_PRESETS = [{ angle: 90 }, { angle: 60 }, { angle: 45 }, { angle: 30 }, { angle: 20 }];
export function vbitHalfAngleTan(angle) { return Math.tan(((Number(angle) || 90) / 2) * Math.PI / 180); }

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

// A fresh per-target cut record. Numeric fields are in BASE mm (U3a; 1 world unit = 1 mm) — the cut panel
// displays/parses them through the document unit. toolDia default 3.175 mm = 1/8 in.
export function defaultCutRecord() {
  return { cutType: null, cutDepth: 'unset', cutOffset: 0, toolDia: 3.175 };
}

// Gating: which cut types may be assigned to a target of this selection kind ('loop' | 'edge').
// A LOOP is both a closed region AND a closed path → all 5. An EDGE is a single vector → only the 'path' types.
export function availableTypes(selectedKind) {
  return CUT_TYPES.filter((t) => t.targetKind === 'path' || selectedKind === 'loop');
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

// Which cut type (if any) does this element's current fill/stroke encode?
export function classify(el) {
  const f = colorOf(el, 'fill');
  const s = colorOf(el, 'stroke');
  for (const t of CUT_TYPES) {
    if (norm(t.fill) === f && norm(t.stroke) === s) return t.id;
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
  return el.getAttributeNS(SHAPER_NS, name);
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
