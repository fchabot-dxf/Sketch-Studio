// TASK 837: the share card survives a centred SQUARE crop (a phone feed crops 1200 x 630 to 630 x 630). For every app's card the drawn content's bounding box
// lies inside the centred square with a 24 px margin; the tagline takes at most 2 lines; the card is still 1200 x 630 and the og meta tags are unchanged.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { ogCardSvg, OG_SQUARE, OG, identityHead } = require('../scripts/site-identity.cjs');
const { APPS } = require('../packages/ui/app-registry.js');
const { Resvg } = require('@resvg/resvg-js');

const HOST = 'sketch-studio.example';
const render = (svg) => new Resvg(svg, { font: { loadSystemFonts: true, defaultFontFamily: 'Segoe UI' } }).render();
// the bounding box of every drawn (alpha > 0) pixel of the content drawn without its background
function bbox(svg) {
  const r = render(svg), px = r.pixels, w = r.width, h = r.height;
  let x0 = w, x1 = -1, y0 = h, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3] > 0) { x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1); }
  return { x0, x1, y0, y1, w, h };
}
assert.deepStrictEqual([OG_SQUARE.x0, OG_SQUARE.x1, OG_SQUARE.margin], [285, 915, 24]);
const evidence = process.env.OG_EVIDENCE_DIR;
for (const app of APPS) {
  const content = ogCardSvg(app, HOST, false);
  const b = bbox(content);
  assert.deepStrictEqual([b.w, b.h], [1200, 630], `${app.id}: 1200 x 630`);
  assert.ok(b.x0 >= OG_SQUARE.x0 + OG_SQUARE.margin && b.x1 <= OG_SQUARE.x1 - OG_SQUARE.margin, `${app.id}: content x ${b.x0}..${b.x1} inside ${OG_SQUARE.x0 + OG_SQUARE.margin}..${OG_SQUARE.x1 - OG_SQUARE.margin}`);
  assert.ok(b.y0 >= OG_SQUARE.margin && b.y1 <= OG.height - OG_SQUARE.margin, `${app.id}: content y ${b.y0}..${b.y1} inside the card with a margin`);
  const centre = (b.x0 + b.x1) / 2;
  assert.ok(Math.abs(centre - 600) <= 2, `${app.id}: content centred (${centre})`);
  const texts = [...content.matchAll(/<text /g)].length;
  assert.ok(texts >= 3 && texts <= 5, `${app.id}: name + 1-2 tagline lines + site line (${texts} texts)`);
  const full = ogCardSvg(app, HOST);
  assert.ok(full.includes(`<rect width='1200' height='630' fill='${OG.bg}'/>`), `${app.id}: the background fills the whole card`);
  const head = identityHead(app, HOST);
  for (const m of ['og:image" content="https://' + HOST + '/og-image.png"', 'og:image:width" content="1200"', 'og:image:height" content="630"', 'twitter:card" content="summary_large_image"', 'twitter:image" content="https://' + HOST + '/og-image.png"']) assert.ok(head.includes(m), `${app.id}: meta ${m}`);
  console.log(`${app.id}: content x ${b.x0}..${b.x1}, y ${b.y0}..${b.y1}`);
  if (evidence) {
    fs.mkdirSync(evidence, { recursive: true });
    fs.writeFileSync(path.join(evidence, `${app.id}-og-image.png`), render(full).asPng());
    const crop = full.replace("viewBox='0 0 1200 630'", `viewBox='${OG_SQUARE.x0} 0 630 630'`).replace("width='1200'", "width='630'");
    fs.writeFileSync(path.join(evidence, `${app.id}-og-square-crop.png`), render(crop).asPng());
  }
}
console.log(`OG-CARD-837 OK (${APPS.length} apps)`);
