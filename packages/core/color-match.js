// packages/core/color-match.js — UNIFY-4c: pure color helpers for the DIGITAL -> PHYSICAL pen mapping. A source
// (digital) color maps to the NEAREST owned (physical) pen by RGB distance. Pure, no DOM, app-agnostic (the pen
// PALETTE stays a plotter concept; this is just the color math). Additive #core.

// Parse '#rgb' / '#rrggbb' (with or without '#') -> { r, g, b } (0..255), or null if unparseable.
export function parseHex(hex) {
  if (typeof hex !== 'string') return null;
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return null;
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

// Squared Euclidean RGB distance (monotonic in the true distance — fine for nearest-match, avoids the sqrt).
export function colorDistanceSq(a, b) {
  const dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
  return dr * dr + dg * dg + db * db;
}

// Index of the palette color (array of hex strings) NEAREST to `hex`, or -1 if none parseable / empty.
export function nearestColorIndex(hex, palette) {
  const c = parseHex(hex);
  if (!c || !Array.isArray(palette) || !palette.length) return -1;
  let best = -1, bestD = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = parseHex(palette[i]);
    if (!p) continue;
    const d = colorDistanceSq(c, p);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}
