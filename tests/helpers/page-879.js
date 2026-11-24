// tests/helpers/page-879.js — TASK 879: the frozen export baselines (the operation-first corpus tests/fixtures/opfirst/baseline.json, the 761 / 775 digests) were
// written when the page (the root <svg>'s width / height / viewBox, #core/shaper-export boundsOf) held EVERY JOINT of the sketch: the origin, an arc's or circle's
// centre, a construction line's ends, a fillet's virtual sharp corner. Since TASK 879 it holds THE DRAWING'S EXTENT (#core/geometry-bounds drawingExtent: each
// shape by what it draws), so a design with such a joint outside its drawing gets a smaller page (and a drawn Bezier not cut gets its whole curve). Nothing
// else in a file changed.
//   pageBefore879(svg, state) -> the same file with its page as the pre-879 rule wrote it: the box of every joint, every circle (centre ± r) and every element
//   written in the file by its true extent (#core/path-d pathBounds for a path, cx / cy / r for a circle, the points of the datum triangle). A test that compares
//   a file with a frozen baseline compares pageBefore879(file): every element byte-identical, and the page the old rule's (tests/board-extent-879-node checks the new one).
import { pathBounds } from '#core/path-d.js';
import { num } from '#core/loop-geometry.js';

export function pageBefore879(svg, state) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const ext = (x, y) => { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; };
  for (const j of state.joints.values()) if (j && Number.isFinite(j.x) && Number.isFinite(j.y)) ext(j.x, j.y);
  for (const s of state.shapes || []) {
    if (!s || s.type !== 'circle' || !Array.isArray(s.joints)) continue;
    const c = state.joints.get(s.joints[0]), r = Number(s.radius) || 0;
    if (c && r > 0) { ext(c.x - r, c.y - r); ext(c.x + r, c.y + r); }
  }
  const lines = svg.split('\n');
  for (const l of lines.slice(1, -1)) {
    const at = (k) => { const m = l.match(new RegExp(`\\s${k}="([^"]*)"`)); return m ? m[1] : null; };
    if (/^\s*<circle\s/.test(l)) { const cx = Number(at('cx')), cy = Number(at('cy')), r = Number(at('r')); ext(cx - r, cy - r); ext(cx + r, cy + r); }
    else if (at('d') != null) { const b = pathBounds(at('d')); if (b) { ext(b.minX, b.minY); ext(b.maxX, b.maxY); } }
    else if (at('points') != null) for (const p of at('points').trim().split(/\s+/)) { const [x, y] = p.split(',').map(Number); ext(x, y); }
    else throw new Error(`pageBefore879: an element with no geometry: ${l}`);
  }
  if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = 0; maxY = 0; }
  const w = maxX - minX, h = maxY - minY;
  const page = /width="([0-9.e+-]+)mm" height="([0-9.e+-]+)mm" viewBox="[^"]*"/;
  if (!page.test(lines[0])) throw new Error(`pageBefore879: not a page in mm: ${lines[0]}`);
  lines[0] = lines[0].replace(page, `width="${num(w)}mm" height="${num(h)}mm" viewBox="${num(minX)} ${num(minY)} ${num(w)} ${num(h)}"`);
  return lines.join('\n');
}
