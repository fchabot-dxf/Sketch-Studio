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
export const CUT_TYPES = [
  { id: 'exterior', label: 'Exterior', cutType: 'outside', fill: '#000000', stroke: 'none',    desc: 'Cut out a positive shape (closed paths)' },
  { id: 'interior', label: 'Interior', cutType: 'inside',  fill: '#FFFFFF', stroke: '#000000', desc: 'Cut a through-hole (closed paths)' },
  { id: 'pocket',   label: 'Pocket',   cutType: 'pocket',  fill: '#7F7F7F', stroke: 'none',    desc: 'Remove material inside to a depth (closed paths)' },
  { id: 'online',   label: 'On-line',  cutType: 'online',  fill: 'none',    stroke: '#7F7F7F', desc: 'Center the cut on the path' },
  { id: 'guide',    label: 'Guide',    cutType: 'guide',   fill: '#0068FF', stroke: '#0068FF', desc: 'Reference mark, not cut' },
];

// shaper:* attributes Shaper writes per element (besides cutType, which we
// derive from color). Order = inspector display order.
export const SHAPER_FIELDS = ['cutDepth', 'cutOffset', 'toolDia'];

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
