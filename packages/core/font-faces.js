// packages/core/font-faces.js — TASK 845: THE FONT FACE the Design tab's TEXT is laid out with, declared ONCE, and the two readers that make one.
// PURE (no DOM, no fetch): a face is made from a font the caller already has (the UI loads the files: #ui/text-fonts.js).
//
// A FACE:
//   name        the font's name as the document stores it ('Inter', 'Hershey Simplex', a loaded font's family name)
//   kind        'outline' (closed glyph outlines: regions with holes) | 'single' (single-line strokes: open paths)
//   unitsPerEm, ascender, descender   font units (y UP, the baseline at 0)
//   capHeight   THE height a text's SIZE is: the top of the font's 'H' (the font's declared cap height when it has no 'H'), font units
//   glyphFor(ch) -> { key, advance, contours } | null   one character (a code point): its advance and its contours, font units, y up:
//               contours = [{ closed, start: {x, y}, segs: [{ k: 'L', to } | { k: 'C', c1, c2, to }] }] (a quadratic is raised to its exact cubic)
//               null: the font has no glyph for it (the layout skips it, advancing by the font's missing-glyph width)
//   missingAdvance  that width (font units)
//   kern(keyA, keyB) -> font units added between two glyphs (negative = closer)
//
// The two readers:
//   opentypeFace(font, { name?, kind? })   a font parsed by opentype.js (vendored: #ui/vendor/opentype): TrueType / CFF outlines (.ttf .otf .woff)
//   svgFontFace(svgText, { name, kind })    an SVG 1.1 font (<font>, <font-face>, <glyph d>, <hkern>): the single-line fonts (Hershey, Relief SingleLine)
//                                            draw with open sub-paths (no Z): their strokes stay open.

const CMD = /[MmLlHhVvCcSsQqTtZzAa]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

/** SVG path data -> contours (the face form above), EXACT: lines and cubics kept as they are, a quadratic raised to its cubic, S / T reflected.
 *  Absolute and relative commands. An elliptical arc (A) is not a font outline: it throws (never drawn wrong). */
export function svgPathContours(d) {
  const t = String(d || '').match(CMD) || [];
  const out = [];
  let i = 0, cmd = '', cur = null, x = 0, y = 0, sx = 0, sy = 0, pc = null, pq = null; // pc / pq: the last cubic / quadratic control (for S / T)
  const n = () => { const v = Number(t[i++]); if (!Number.isFinite(v)) throw new Error(`svgPathContours: a number expected after ${cmd} in "${d}"`); return v; };
  const begin = (px, py) => { cur = { closed: false, start: { x: px, y: py }, segs: [] }; out.push(cur); };
  const line = (px, py) => { if (!cur) begin(x, y); cur.segs.push({ k: 'L', to: { x: px, y: py } }); x = px; y = py; };
  const cubic = (c1, c2, to) => { if (!cur) begin(x, y); cur.segs.push({ k: 'C', c1, c2, to }); x = to.x; y = to.y; };
  const quad = (q, to) => cubic({ x: x + (2 / 3) * (q.x - x), y: y + (2 / 3) * (q.y - y) }, { x: to.x + (2 / 3) * (q.x - to.x), y: to.y + (2 / 3) * (q.y - to.y) }, to);
  while (i < t.length) {
    if (/[A-Za-z]/.test(t[i])) cmd = t[i++];
    else if (!cmd) throw new Error(`svgPathContours: a number before any command in "${d}"`);
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    if (C === 'Z') { if (cur) { cur.closed = true; x = sx; y = sy; cur = null; } pc = pq = null; continue; }
    if (C === 'M') { x = n() + ox; y = n() + oy; sx = x; sy = y; begin(x, y); cmd = rel ? 'l' : 'L'; pc = pq = null; continue; }
    if (C === 'L') { line(n() + ox, n() + oy); pc = pq = null; continue; }
    if (C === 'H') { line(n() + ox, y); pc = pq = null; continue; }
    if (C === 'V') { line(x, n() + oy); pc = pq = null; continue; }
    if (C === 'C') { const c1 = { x: n() + ox, y: n() + oy }, c2 = { x: n() + ox, y: n() + oy }, to = { x: n() + ox, y: n() + oy }; cubic(c1, c2, to); pc = c2; pq = null; continue; }
    if (C === 'S') { const c1 = pc ? { x: 2 * x - pc.x, y: 2 * y - pc.y } : { x, y }; const c2 = { x: n() + ox, y: n() + oy }, to = { x: n() + ox, y: n() + oy }; cubic(c1, c2, to); pc = c2; pq = null; continue; }
    if (C === 'Q') { const q = { x: n() + ox, y: n() + oy }, to = { x: n() + ox, y: n() + oy }; quad(q, to); pq = q; pc = null; continue; }
    if (C === 'T') { const q = pq ? { x: 2 * x - pq.x, y: 2 * y - pq.y } : { x, y }; const to = { x: n() + ox, y: n() + oy }; quad(q, to); pq = q; pc = null; continue; }
    throw new Error(`svgPathContours: command ${cmd} is not a font outline command ("${d}")`);
  }
  return out.filter((c) => c.segs.length);
}

// opentype.js path commands (font units, y up: glyph.path) -> contours (the face form)
function commandContours(commands) {
  const out = [];
  let cur = null, x = 0, y = 0;
  for (const c of commands || []) {
    if (c.type === 'M') { cur = { closed: false, start: { x: c.x, y: c.y }, segs: [] }; out.push(cur); x = c.x; y = c.y; continue; }
    if (!cur) continue;
    if (c.type === 'Z') { cur.closed = true; cur = null; continue; }
    if (c.type === 'L') cur.segs.push({ k: 'L', to: { x: c.x, y: c.y } });
    else if (c.type === 'C') cur.segs.push({ k: 'C', c1: { x: c.x1, y: c.y1 }, c2: { x: c.x2, y: c.y2 }, to: { x: c.x, y: c.y } });
    else if (c.type === 'Q') cur.segs.push({ k: 'C', c1: { x: x + (2 / 3) * (c.x1 - x), y: y + (2 / 3) * (c.y1 - y) }, c2: { x: c.x + (2 / 3) * (c.x1 - c.x), y: c.y + (2 / 3) * (c.y1 - c.y) }, to: { x: c.x, y: c.y } });
    x = c.x; y = c.y;
  }
  return out.filter((c) => c.segs.length);
}

// the highest y any contour reaches (on-curve points and control points: a glyph's control points stay inside its outline's hull)
function topOf(contours) {
  let top = -Infinity;
  for (const c of contours) { top = Math.max(top, c.start.y); for (const s of c.segs) { top = Math.max(top, s.to.y); if (s.c1) top = Math.max(top, s.c1.y, s.c2.y); } }
  return top;
}

/** A face of a font parsed by opentype.js. name: the document's name for it (default: the font's family name). kind: 'outline' (default). */
export function opentypeFace(font, { name, kind = 'outline' } = {}) {
  const cache = new Map();
  const glyphFor = (ch) => {
    if (cache.has(ch)) return cache.get(ch);
    const g = font.charToGlyph(ch);
    const out = g && g.index !== 0 ? { key: g, advance: g.advanceWidth || 0, contours: commandContours(g.path && g.path.commands) } : null;
    cache.set(ch, out);
    return out;
  };
  const H = glyphFor('H');
  const declaredCap = font.tables && font.tables.os2 && font.tables.os2.sCapHeight;
  const notdef = font.glyphs && font.glyphs.get ? font.glyphs.get(0) : null;
  return {
    name: name || (font.names && font.names.fontFamily && (font.names.fontFamily.en || Object.values(font.names.fontFamily)[0])) || 'Font',
    kind,
    unitsPerEm: font.unitsPerEm,
    ascender: font.ascender,
    descender: font.descender,
    capHeight: H && H.contours.length ? topOf(H.contours) : (declaredCap > 0 ? declaredCap : font.ascender),
    missingAdvance: (notdef && notdef.advanceWidth) || font.unitsPerEm / 2,
    glyphFor,
    kern: (a, b) => font.getKerningValue(a, b) || 0,
  };
}

// one SVG element's attributes (name -> raw value)
const attrsOf = (s) => { const a = {}; for (const m of s.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) a[m[1]] = m[2]; return a; };
// XML character references and the five named entities
const decode = (s) => String(s).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** A face of an SVG 1.1 font (the text of the .svg file). name / kind: as the bundled font list declares them. */
export function svgFontFace(svgText, { name, kind = 'single' } = {}) {
  const src = String(svgText || '');
  const font = attrsOf((src.match(/<font\s[^>]*>/) || [''])[0]); // <font ...>, never <font-face ...>
  const face = attrsOf((src.match(/<font-face\b[^>]*>/) || [''])[0]);
  const missing = attrsOf((src.match(/<missing-glyph\b[^>]*>/) || [''])[0]);
  const defAdv = Number(font['horiz-adv-x']) || 0;
  const byChar = new Map(), byName = new Map();
  for (const m of src.matchAll(/<glyph\b([^>]*)>/g)) {
    const a = attrsOf(m[1]);
    if (a.unicode == null) continue;
    const ch = decode(a.unicode);
    if ([...ch].length !== 1 || byChar.has(ch)) continue; // a ligature (several characters) is not laid out here; the first glyph of a character wins (SVG)
    const g = { key: a['glyph-name'] || ch, advance: a['horiz-adv-x'] != null ? Number(a['horiz-adv-x']) : defAdv, d: a.d || '', contours: null };
    byChar.set(ch, g);
    if (a['glyph-name']) byName.set(a['glyph-name'], g);
  }
  // <hkern u1 / g1, u2 / g2, k>: the pairs (comma lists of characters / glyph names); k is SUBTRACTED from the advance (SVG 1.1 20.7)
  const kerns = new Map();
  const names = (u, g) => [...(u ? u.split(',').map((x) => decode(x.trim())).filter(Boolean).map((c) => byChar.get(c) && byChar.get(c).key).filter(Boolean) : []),
    ...(g ? g.split(',').map((x) => x.trim()).filter((x) => byName.has(x)) : [])];
  for (const m of src.matchAll(/<hkern\b([^>]*)>/g)) {
    const a = attrsOf(m[1]), k = Number(a.k);
    if (!Number.isFinite(k)) continue;
    for (const l of names(a.u1, a.g1)) for (const r of names(a.u2, a.g2)) { const key = l + '\u0000' + r; if (!kerns.has(key)) kerns.set(key, -k); }
  }
  const glyphFor = (ch) => {
    const g = byChar.get(ch);
    if (!g) return null;
    if (!g.contours) g.contours = svgPathContours(g.d);
    return g;
  };
  const H = glyphFor('H');
  const ascender = Number(face.ascent) || 800, descender = Number(face.descent) || -200;
  return {
    name: name || face['font-family'] || 'Font',
    kind,
    unitsPerEm: Number(face['units-per-em']) || 1000,
    ascender,
    descender,
    capHeight: H && H.contours.length ? topOf(H.contours) : (Number(face['cap-height']) || ascender),
    missingAdvance: Number(missing['horiz-adv-x']) || defAdv,
    glyphFor,
    kern: (a, b) => kerns.get(a + '\u0000' + b) || 0,
  };
}
