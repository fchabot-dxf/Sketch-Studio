// scripts/site-identity.cjs — TASK 829 (owner turns 2832-2905): what a site says about itself to browsers, phones, crawlers and link previews.
// ONE declaration per app, in packages/ui/app-registry.js (APPS[]: name, tile colour, tagline, description, the approved icon SVG); the site's address is
// SITE_HOST of build-site.cjs. This file only GENERATES from them (nothing here is a copy of a string or a drawing):
//   favicon.svg                the registry's icon, byte for byte
//   favicon.ico                16, 32 and 48 px (PNG entries) rendered from that SVG
//   apple-touch-icon.png       180 px, on the tile colour (iOS rounds / masks it itself)
//   icon-192.png icon-512.png  rendered from that SVG (the manifest's icons)
//   manifest.webmanifest       name, short_name, icons, theme_color and background_color = the tile colour
//   og-image.png               the 1200 x 630 share card: the icon, the app name, the tagline, stacked in the centred 630 square
//   robots.txt, sitemap.xml    allow all + Sitemap line; the site's pages
// and the page's <head> block + the intro (an <h1> and the description) that identityHead / identityIntro put into the BUILT index.html:
//   <meta name="description">, Open Graph (title, description, image, url, type=website, site_name), twitter:card=summary_large_image, <link rel="canonical">,
//   the JSON-LD SoftwareApplication, the favicon / apple-touch / manifest links and theme-color.
// They are injected into the built page, not written in apps/<app>/index.html: the repo page is also served as is (development, tests) where these files
// do not exist, and every reference of a page must resolve (scripts/site-closure.cjs). The JS favicon setter (applyAppIdentity) leaves a page that
// already has a favicon link alone, so a built page's tab shows favicon.svg and the repo page's the same drawing as a data URI.
// The raster steps use @resvg/resvg-js (a devDependency: the build is run on a machine with `npm install`); the share card's text uses the system's
// Segoe UI / Arial / DejaVu Sans, whichever the machine has first.
'use strict';
const fs = require('fs');
const path = require('path');
const { APPS: REGISTRY, SUITE_NAME, SEO_INTRO_ID, appTitle } = require('../packages/ui/app-registry.js');

const ICON_SIZES = [192, 512];
const ICO_SIZES = [16, 32, 48];
const APPLE_SIZE = 180;
const OG = { width: 1200, height: 630, bg: '#1F2023', alt: (name) => `${name}, part of ${SUITE_NAME}` };
// the files of an identity the built page LINKS (the closure of the built page reaches these; checkRootLayout does not count them as repo-page references)
const LINKED = ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png', 'manifest.webmanifest'];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const registryApp = (id) => {
  const a = REGISTRY.find((x) => x.id === id);
  if (!a) throw new Error(`site-identity: no app "${id}" in packages/ui/app-registry.js`);
  for (const k of ['name', 'tile', 'tagline', 'seoTitle', 'description', 'icon']) if (typeof a[k] !== 'string' || !a[k]) throw new Error(`site-identity: ${id} has no ${k} in the registry`);
  if (a.description.length > 155) throw new Error(`site-identity: the ${id} description is ${a.description.length} characters (155 at most)`);
  return a;
};

function resvg() {
  try { return require('@resvg/resvg-js').Resvg; }
  catch (e) { throw new Error(`site-identity: @resvg/resvg-js is needed to draw the icon files (run npm install): ${e.message}`); }
}
// resvg ignores pathLength (a browser scales stroke-dasharray / -dashoffset by pathLength / the real length): the pen plotter icon's three-colour wave is one
// path drawn three times with such dashes. For the raster files only, each dashed path's dash values are scaled to its real length (M, L, C, S, absolute: the
// commands the icons use; any other command throws), so the PNGs show what a browser shows from the SVG. favicon.svg itself is the registry's text, untouched.
function pathLengthOf(d) {
  const t = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
  let i = 0, cmd = '', x = 0, y = 0, c2 = null, len = 0;
  const num = () => parseFloat(t[i++]);
  while (i < t.length) {
    if (/[A-Za-z]/.test(t[i])) cmd = t[i++];
    if (cmd === 'M' || cmd === 'L') { const nx = num(), ny = num(); if (cmd === 'L') len += Math.hypot(nx - x, ny - y); x = nx; y = ny; c2 = null; }
    else if (cmd === 'C' || cmd === 'S') {
      const c1 = cmd === 'S' ? (c2 ? [2 * x - c2[0], 2 * y - c2[1]] : [x, y]) : [num(), num()];
      const q = [num(), num()], e = [num(), num()];
      let px = x, py = y;
      for (let k = 1; k <= 200; k++) {
        const u = k / 200, v = 1 - u;
        const bx = v * v * v * x + 3 * v * v * u * c1[0] + 3 * v * u * u * q[0] + u * u * u * e[0];
        const by = v * v * v * y + 3 * v * v * u * c1[1] + 3 * v * u * u * q[1] + u * u * u * e[1];
        len += Math.hypot(bx - px, by - py); px = bx; py = by;
      }
      x = e[0]; y = e[1]; c2 = q;
    } else throw new Error(`site-identity: the path command "${cmd}" in a dashed icon path is not handled by pathLengthOf`);
  }
  return len;
}
const resolvePathLength = (svg) => svg.replace(/<path\b[^>]*\spathLength='([\d.]+)'[^>]*>/g, (tag, pl) => {
  const k = pathLengthOf(tag.match(/\sd='([^']*)'/)[1]) / parseFloat(pl);
  return tag.replace(/(stroke-dasharray|stroke-dashoffset)='([^']*)'/g, (m, name, v) => `${name}='${v.trim().split(/[\s,]+/).map((n) => +(parseFloat(n) * k).toFixed(3)).join(' ')}'`);
});
const png = (svg, width, opts = {}) => new (resvg())(resolvePathLength(svg), { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: true, defaultFontFamily: 'Segoe UI' }, ...opts }).render().asPng();

// an .ico of PNG entries (Windows Vista+ and every browser read them): header, one 16-byte directory entry each, then the images
function ico(pngs) { // pngs: [{ size, data }]
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach((p, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(p.size, e); head.writeUInt8(p.size, e + 1); head.writeUInt8(0, e + 2); head.writeUInt8(0, e + 3);
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6); head.writeUInt32LE(p.data.length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += p.data.length;
  });
  return Buffer.concat([head, ...pngs.map((p) => p.data)]);
}

function wrap(text, max) {
  const lines = [];
  let cur = '';
  for (const w of text.split(' ')) { if (cur && (cur + ' ' + w).length > max) { lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w; }
  if (cur) lines.push(cur);
  return lines;
}
// the share card: TASK 837 (owner turns 3048-3049): a phone feed (Facebook) crops the 1200 x 630 card to a centred SQUARE, so everything that means something
// (the icon, the app name, the tagline, the site line) is stacked and centred inside the centred 630 x 630 square (x 285..915) with OG.margin to spare;
// the sides of the card are the same dark background (OG.bg), empty by design. One function draws every app's card.
const OG_SQUARE = { x0: (OG.width - OG.height) / 2, x1: (OG.width + OG.height) / 2, margin: 24 };
const OG_ICON = 144, OG_NAME = 72, OG_TAG = 30, OG_TAG_LINE = 40, OG_SITE = 22;
function ogContentSvg(app, host) {
  const cx = OG.width / 2;
  const inner = app.icon.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  const room = OG_SQUARE.x1 - OG_SQUARE.x0 - 2 * OG_SQUARE.margin; // 582 px of text width
  const lines = wrap(app.tagline, Math.floor(room / (OG_TAG * 0.52))); // a Segoe UI / Arial average glyph is under 0.52 em
  if (lines.length > 2) throw new Error(`site-identity: the ${app.id} tagline needs ${lines.length} lines on the share card (2 at most)`);
  const gap = 36, nameH = OG_NAME, tagH = lines.length * OG_TAG_LINE;
  const total = OG_ICON + gap + nameH + gap / 2 + tagH + gap + OG_SITE;
  let y = (OG.height - total) / 2;
  const iconY = y; y += OG_ICON + gap + nameH * 0.8; // text baselines: cap height ~ 0.8 em
  const nameY = y; y += nameH * 0.2 + gap / 2 + OG_TAG;
  const tagY = y; y += tagH - OG_TAG_LINE + gap + OG_SITE;
  const t = (yy, size, fill, text, w) => `<text x='${cx}' y='${yy.toFixed(1)}' text-anchor='middle' font-size='${size}'${w ? ` font-weight='${w}'` : ''} fill='${fill}'>${esc(text)}</text>`;
  return `<g transform='translate(${cx - OG_ICON / 2} ${iconY.toFixed(1)}) scale(${OG_ICON / 64})'>${inner}</g>`
    + t(nameY, OG_NAME, '#FFFFFF', app.name, 700)
    + lines.map((l, i) => t(tagY + i * OG_TAG_LINE, OG_TAG, '#C9CDD3', l)).join('')
    + t(tagY + (lines.length - 1) * OG_TAG_LINE + gap + OG_SITE, OG_SITE, '#8B9099', `${SUITE_NAME} · ${host}`);
}
// withBackground false: the content alone on a transparent card (the node test measures its bounding box from that)
function ogCardSvg(app, host, withBackground = true) {
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${OG.width}' height='${OG.height}' viewBox='0 0 ${OG.width} ${OG.height}' font-family='Segoe UI, Arial, DejaVu Sans, sans-serif'>`
    + (withBackground ? `<rect width='${OG.width}' height='${OG.height}' fill='${OG.bg}'/>` : '') + ogContentSvg(app, host) + `</svg>`;
}

const manifestOf = (app) => ({
  name: appTitle(app.id), short_name: app.name, description: app.description, start_url: '/', scope: '/', display: 'standalone',
  theme_color: app.tile, background_color: app.tile,
  icons: [...ICON_SIZES.map((s) => ({ src: `icon-${s}.png`, sizes: `${s}x${s}`, type: 'image/png', purpose: 'any' })), { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
});

const robotsOf = (host) => `User-agent: *\nAllow: /\n\nSitemap: https://${host}/sitemap.xml\n`;
const SITE_PAGES = ['/', '/about', '/privacy']; // the root page, the About page and the privacy page (Pages serves about.html at /about, privacy.html at /privacy)
const sitemapOf = (host) => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${SITE_PAGES.map((p) => `  <url><loc>https://${host}${p}</loc></url>`).join('\n')}\n</urlset>\n`;

// ---- what goes into the built page ----
function jsonLd(app, host) {
  return {
    '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: appTitle(app.id), description: app.description,
    applicationCategory: 'DesignApplication', operatingSystem: 'Web browser', offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    url: `https://${host}/`, image: `https://${host}/og-image.png`,
  };
}
function identityHead(app, host) {
  const url = `https://${host}/`, image = `https://${host}/og-image.png`, title = esc(app.seoTitle), desc = esc(app.description);
  return [
    `<meta name="description" content="${desc}">`,
    `<link rel="canonical" href="${url}">`,
    `<meta name="theme-color" content="${app.tile}">`,
    `<link rel="icon" href="favicon.svg" type="image/svg+xml">`,
    `<link rel="icon" href="favicon.ico" sizes="16x16 32x32 48x48">`,
    `<link rel="apple-touch-icon" href="apple-touch-icon.png">`,
    `<link rel="manifest" href="manifest.webmanifest">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${esc(SUITE_NAME)}">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${desc}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${image}">`,
    `<meta property="og:image:width" content="${OG.width}">`,
    `<meta property="og:image:height" content="${OG.height}">`,
    `<meta property="og:image:alt" content="${esc(OG.alt(app.name))}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${desc}">`,
    `<meta name="twitter:image" content="${image}">`,
    `<script type="application/ld+json">${JSON.stringify(jsonLd(app, host)).replace(/</g, '\\u003c')}</script>`,
  ].map((l) => '  ' + l).join('\n');
}
// A small <h1> + the description, the first thing in <body>. It is OUT OF FLOW (position: fixed), so it moves nothing; the app removes it as it starts
// (applyAppIdentity in app-registry.js, called at each app's boot). A crawler or a reader without JavaScript sees it.
function identityIntro(app) {
  return `<div id="${SEO_INTRO_ID}" style="position:fixed;left:0;top:0;right:0;padding:16px 20px;font:14px/1.45 system-ui,Segoe UI,Arial,sans-serif;color:#8B9099;pointer-events:none"><h1 style="margin:0 0 6px;font-size:20px;font-weight:700">${esc(app.seoTitle)}</h1><p style="margin:0">${esc(app.description)}</p></div>`;
}
function injectIdentity(html, app, host) {
  if (/<meta\s+name=["']description["']/i.test(html)) throw new Error(`site-identity: the ${app.id} page already has a meta description (it comes from the registry only)`);
  if (!/<\/title>/i.test(html) || !/<body[^>]*>/i.test(html)) throw new Error(`site-identity: the ${app.id} page has no </title> or <body> to put the identity after`);
  return html.replace(/<title>[^<]*<\/title>/i, () => `<title>${esc(app.seoTitle)}</title>\n${identityHead(app, host)}`).replace(/<body[^>]*>/i, (m) => `${m}\n${identityIntro(app)}`);
}

// write the site's identity files into <out> and put the head + intro into its built index.html; -> the files written (site paths)
function writeIdentity(appId, out, host) {
  const app = registryApp(appId);
  const put = (rel, data) => {
    if (fs.existsSync(path.join(out, rel))) throw new Error(`site-identity: ${rel} is generated from the registry, but the ${appId} app folder already has one`);
    fs.writeFileSync(path.join(out, rel), data);
    return rel;
  };
  const files = [];
  files.push(put('favicon.svg', app.icon));
  files.push(put('favicon.ico', ico(ICO_SIZES.map((size) => ({ size, data: png(app.icon, size) })))));
  files.push(put('apple-touch-icon.png', png(app.icon, APPLE_SIZE, { background: app.tile })));
  for (const s of ICON_SIZES) files.push(put(`icon-${s}.png`, png(app.icon, s)));
  files.push(put('manifest.webmanifest', JSON.stringify(manifestOf(app), null, 2) + '\n'));
  files.push(put('og-image.png', png(ogCardSvg(app, host), OG.width)));
  files.push(put('robots.txt', robotsOf(host)));
  files.push(put('sitemap.xml', sitemapOf(host)));
  const page = path.join(out, 'index.html');
  fs.writeFileSync(page, injectIdentity(fs.readFileSync(page, 'utf8'), app, host));
  return files;
}

module.exports = { resolvePathLength, pathLengthOf, writeIdentity, injectIdentity, identityHead, identityIntro, jsonLd, manifestOf, robotsOf, sitemapOf, ogCardSvg, OG_SQUARE, ico, registryApp, LINKED, OG, ICON_SIZES, ICO_SIZES, APPLE_SIZE, SITE_PAGES };
