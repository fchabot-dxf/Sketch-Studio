// apps/penplotter/src/paper-grid.js — the document PAPER rectangle (0,0)-(doc.w,doc.h) + a 10mm grid, as SVG markup.
// SHARED (DESIGN-PAPER-BOUNDS): both the plotter canvas (render-art.js) and the Design canvas (sketch-stage.js, a
// backmost svg beneath #pen-underlay) draw the paper from THIS one helper, so the document bounds look identical on
// every tab. World/mm coords (the same space the geometry + toolpath overlay use); non-scaling strokes so the paper
// outline + grid stay crisp at any zoom.
export function paperGridMarkup(doc) {
  const w = Math.max(0, +(doc && doc.w) || 0), h = Math.max(0, +(doc && doc.h) || 0);
  let s = `<rect x="0" y="0" width="${w}" height="${h}" style="fill:var(--canvas-bg)" stroke="#c8bfa8" stroke-width="1" vector-effect="non-scaling-stroke" pointer-events="none"/>`;
  s += `<g stroke="#e6ddc8" stroke-width="0.1" vector-effect="non-scaling-stroke" pointer-events="none">`;
  for (let x = 0; x <= w; x += 10) s += `<line x1="${x}" y1="0" x2="${x}" y2="${h}"/>`;
  for (let y = 0; y <= h; y += 10) s += `<line x1="0" y1="${y}" x2="${w}" y2="${y}"/>`;
  s += `</g>`;
  return s;
}
