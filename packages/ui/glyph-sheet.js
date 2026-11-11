// packages/ui/glyph-sheet.js — loads the owner's constraint-glyph sheet (assets/constraint-glyphs.svg), the single source of
// the Fusion-style constraint glyphs. Only the groups whose id starts with `glyph-` are read (the `guides` / `labels`
// groups are ignored). Paths and <rect>s are kept as path data; the file's own style and transforms are never read.
//
// getGlyph(name) -> { paths: [d...], bbox: {x0,y0,x1,y1,w,h}, centre: {x,y} } | null (not loaded yet, or no such glyph).
// loadGlyphSheet() fetches once; onGlyphSheetReady(fn) runs fn when the sheet has arrived (at once if it already has).
import { dbg } from '#core/debug.js';

export const GLYPH_SHEET_URL = '/assets/constraint-glyphs.svg';
const GLYPH_PREFIX = 'glyph-';

let glyphs = null;          // Map<string, glyph> once loaded
let loading = null;         // the single in-flight / finished load promise
const readyHooks = [];

const rectToPath = (r) => {
  const x = +r.getAttribute('x') || 0, y = +r.getAttribute('y') || 0, w = +r.getAttribute('width'), h = +r.getAttribute('height');
  return `M${x},${y}L${x + w},${y}L${x + w},${y + h}L${x},${y + h}Z`;
};

// Bbox of the absolute M/L/C/Z coordinates of a path (control points included).
function pathBounds(d, b) {
  if (/[^MLCZ\d.,\s-]/.test(d)) throw new Error(`unsupported path command in "${d.slice(0, 40)}"`);
  const n = d.replace(/[MLCZ]/g, ' ').match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
  for (let i = 0; i + 1 < n.length; i += 2) {
    const x = +n[i], y = +n[i + 1];
    b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y);
  }
}

function collectShapes(el, out) {
  for (const k of Array.from(el.children || [])) {
    const tag = (k.tagName || '').toLowerCase();
    if (tag === 'path') out.push(k.getAttribute('d'));
    else if (tag === 'rect') out.push(rectToPath(k));
    else collectShapes(k, out);
  }
}

// Parse the sheet text into a Map name -> glyph. `parser` is a DOMParser (injectable for hosts without one).
export function parseGlyphSheet(text, parser = new DOMParser()) {
  const doc = parser.parseFromString(text, 'image/svg+xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('glyph sheet is not valid SVG');
  const table = new Map();
  for (const g of Array.from(doc.documentElement.children)) {
    const id = g.getAttribute('id') || '';
    if (!id.startsWith(GLYPH_PREFIX)) continue;
    const paths = [];
    collectShapes(g, paths);
    const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const d of paths) pathBounds(d, b);
    const w = b.x1 - b.x0, h = b.y1 - b.y0;
    if (!paths.length || ![w, h].every(Number.isFinite)) throw new Error(`${id} has no usable shapes`);
    table.set(id, { paths, bbox: { ...b, w, h }, centre: { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 } });
  }
  return table;
}

export const getGlyph = (name) => (glyphs && glyphs.get(name)) || null;
export const isGlyphSheetReady = () => !!glyphs;

export function onGlyphSheetReady(fn) {
  if (glyphs) fn(); else readyHooks.push(fn);
}

// Fetch + parse once. A failed fetch/parse is reported once through dbg.warn and leaves every glyph missing.
// `expected` = the glyph names the renderer needs; a missing one is reported once as well.
export function loadGlyphSheet({ url = GLYPH_SHEET_URL, fetchFn = (typeof fetch === 'function' ? fetch : null), parser, expected = [] } = {}) {
  if (loading) return loading;
  loading = (async () => {
    try {
      if (!fetchFn) throw new Error('fetch is not available');
      const res = await fetchFn(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      glyphs = parseGlyphSheet(await res.text(), parser);
    } catch (err) {
      dbg.warn('glyphs', `constraint glyph sheet not loaded (${url}): ${err && err.message}`);
      return null;
    }
    const missing = expected.filter((n) => !glyphs.has(n));
    if (missing.length) dbg.warn('glyphs', `constraint glyph sheet is missing: ${missing.join(', ')}`);
    for (const fn of readyHooks.splice(0)) fn();
    return glyphs;
  })();
  return loading;
}
