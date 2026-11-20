// packages/ui/app-registry.js — THE app registry (TASK 473): one declared list of the suite's apps — id, name, accent, icon SVG —
// feeding the sidebar's header button name, the browser tab TITLE and the tab FAVICON (TASK 696: each app is its own website; no app links to another). No title or icon is hard-coded per index.html
// any more (each index.html keeps a static <title> fallback equal to appTitle(id), for before JS runs).
// TASK 829: the registry is also THE source of each site's identity files and search / share tags (scripts/site-identity.cjs, run by build-site.cjs): the
// icon (-> favicon.svg, favicon.ico, apple-touch-icon.png, icon-192 / 512, the manifest, the share card), the tile colour (theme colour), the tagline
// (share card) and the description (meta description, Open Graph, JSON-LD, the About page). Nothing of it is copied by hand anywhere.
//
// The suite is "Sketch Studio"; the apps are Sketch (the parametric CAD), Shaper, Pen Plotter, Trace.
// Icons (TASK 829, approved by the owner): one family, a 64x64 rounded tile with the app's own drawing: Sketch = a blue rectangle with ring joints and a
// grey dimension on a light grid; Shaper = a hexagon Outside cut (mint band and edge, dashed bit-centre path, bit ring) on a dark grid; Pen Plotter = a
// three-colour wave and a dark pen on cream paper; Trace = purple traced mountains, a pink sun and square nodes. `icon` is a complete <svg> (64x64
// viewBox) usable inline or as a data URI (favicon). `tile` is the tile's colour (the manifest's theme colour; tests check it is the icon's own).

export const SUITE_NAME = 'Sketch Studio';

export const APPS = [
  { id: "sketchstudio", name: "Sketch", accent: "#4C9AFF", tile: "#FFFFFF",
    tagline: "Draw, dimension and constrain shapes. Export SVG and DXF.",
    description: "Sketch is a free parametric 2D CAD in your browser: draw, dimension and constrain shapes, then export clean SVG and DXF for laser, CNC and 3D printing.",
    icon: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64' width='64' height='64'><clipPath id='cx'><rect width='64' height='64' rx='14'/></clipPath><rect width='64' height='64' rx='14' fill='#FFFFFF'/><g clip-path='url(#cx)'><path d='M0 8 H64 M8 0 V64 M0 16 H64 M16 0 V64 M0 24 H64 M24 0 V64 M0 32 H64 M32 0 V64 M0 40 H64 M40 0 V64 M0 48 H64 M48 0 V64 M0 56 H64 M56 0 V64' stroke='#c9ced6' stroke-width='1.3'/><path d='M16 15 H48' stroke='#4b5563' stroke-width='2.6'/><path d='M16 10 V20 M48 10 V20' stroke='#4b5563' stroke-width='2.2'/><path d='M16 15 l4 -2.6 v5.2 Z M48 15 l-4 -2.6 v5.2 Z' fill='#4b5563'/><path d='M16 26 H48 V50 H16 Z' fill='none' stroke='#3b82f6' stroke-width='4' stroke-linejoin='round'/><circle cx='16' cy='26' r='4.2' fill='#fff' stroke='#111' stroke-width='2.4'/><circle cx='48' cy='26' r='4.2' fill='#fff' stroke='#111' stroke-width='2.4'/><circle cx='16' cy='50' r='4.2' fill='#fff' stroke='#111' stroke-width='2.4'/><circle cx='48' cy='50' r='4.2' fill='#fff' stroke='#111' stroke-width='2.4'/></g><rect x='0.5' y='0.5' width='63' height='63' rx='13.5' fill='none' stroke='#d6d9de'/></svg>" },
  { id: "shaper", name: "Shaper", accent: "#1BE09E", tile: "#3F4145",
    tagline: "Turn a sketch into cuts for the Shaper Origin.",
    description: "Shaper prepares cutting files for the Shaper Origin handheld router in your browser: pick inside, outside, pocket or V-carve cuts, then export. Free.",
    icon: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64' width='64' height='64'><clipPath id='cx'><rect width='64' height='64' rx='14'/></clipPath><rect width='64' height='64' rx='14' fill='#3F4145'/><g clip-path='url(#cx)'><path d='M0 8 H64 M8 0 V64 M0 16 H64 M16 0 V64 M0 24 H64 M24 0 V64 M0 32 H64 M32 0 V64 M0 40 H64 M40 0 V64 M0 48 H64 M48 0 V64 M0 56 H64 M56 0 V64' stroke='#4b4e54' stroke-width='1.3'/><path d='M32.00 15.90 L45.94 23.95 L45.94 40.05 L32.00 48.10 L18.06 40.05 L18.06 23.95 Z' fill='none' stroke='#1BE09E' stroke-opacity='.32' stroke-width='10' stroke-linejoin='round'/><path d='M32.00 18.70 L43.52 25.35 L43.52 38.65 L32.00 45.30 L20.48 38.65 L20.48 25.35 Z' fill='none' stroke='#1BE09E' stroke-width='2.6' stroke-linejoin='round'/><path d='M32.00 15.90 L45.94 23.95 L45.94 40.05 L32.00 48.10 L18.06 40.05 L18.06 23.95 Z' fill='none' stroke='#CBDAD6' stroke-width='2.2' stroke-dasharray='3.5 3.5' stroke-linejoin='round'/><circle cx='18.06' cy='40.05' r='7.6' fill='#3F4145' fill-opacity='.35' stroke='#fff' stroke-width='1.6'/><circle cx='18.06' cy='40.05' r='1.7' fill='#fff'/></g><rect x='0.5' y='0.5' width='63' height='63' rx='13.5' fill='none' stroke='#2e3036'/></svg>" },
  { id: "penplotter", name: "Pen Plotter", accent: "#FF8A4C", tile: "#F5EFE1",
    tagline: "Draw, set up the pens and paper, plot.",
    description: "Pen Plotter prepares drawings for pen plotters in your browser: draw or import art, set the paper and pens, then export plotter-ready files. Free.",
    icon: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64' width='64' height='64'><clipPath id='cx'><rect width='64' height='64' rx='14'/></clipPath><rect width='64' height='64' rx='14' fill='#F5EFE1'/><g clip-path='url(#cx)'><path d='M0 8 H64 M8 0 V64 M0 16 H64 M16 0 V64 M0 24 H64 M24 0 V64 M0 32 H64 M32 0 V64 M0 40 H64 M40 0 V64 M0 48 H64 M48 0 V64 M0 56 H64 M56 0 V64' stroke='#ddd2b8' stroke-width='1.3'/><path d='M9 46 C17 32 23 32 29 42 S41 52 49 36' pathLength='90' fill='none' stroke='#DC2626' stroke-width='4' stroke-dasharray='30 60' stroke-dashoffset='0'/><path d='M9 46 C17 32 23 32 29 42 S41 52 49 36' pathLength='90' fill='none' stroke='#EAB308' stroke-width='4' stroke-dasharray='30 60' stroke-dashoffset='-30'/><path d='M9 46 C17 32 23 32 29 42 S41 52 49 36' pathLength='90' fill='none' stroke='#2563EB' stroke-width='4' stroke-dasharray='30 60' stroke-dashoffset='-60'/><path d='M44 9 L55 20 L41 34 L32 37 L35 28 Z' fill='#1E293B'/><path d='M32 37 L35 28 L41 34 Z' fill='#2563EB'/></g><rect x='0.5' y='0.5' width='63' height='63' rx='13.5' fill='none' stroke='#d9cfb8'/></svg>" },
  { id: "trace", name: "Trace", accent: "#C084FC", tile: "#FFFFFF",
    tagline: "Turn a photo into SVG and DXF paths.",
    description: "Trace turns photos and images into clean SVG and DXF vector paths in your browser, scaled to real-world size, ready for laser cutters and CNC. Free.",
    icon: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64' width='64' height='64'><clipPath id='cx'><rect width='64' height='64' rx='14'/></clipPath><rect width='64' height='64' rx='14' fill='#FFFFFF'/><g clip-path='url(#cx)'><circle cx='44' cy='20' r='6' fill='none' stroke='#F472B6' stroke-width='3.5'/><path d='M8 48 L22 26 L31 37 L39 29 L56 48 Z' fill='none' stroke='#9333EA' stroke-width='3.5' stroke-linejoin='round'/><rect x='19.5' y='23.5' width='5' height='5' fill='#F472B6'/><rect x='28.5' y='34.5' width='5' height='5' fill='#F472B6'/><rect x='36.5' y='26.5' width='5' height='5' fill='#F472B6'/></g><rect x='0.5' y='0.5' width='63' height='63' rx='13.5' fill='none' stroke='#d6d9de'/></svg>" },
];

export const appById = (id) => APPS.find((a) => a.id === id) || null;

/** The tab title: "<App> · Sketch Studio", or "<design name> — <App>" once a design is open (the project store only supplies the name). */
export function appTitle(id, designName) {
  const app = appById(id);
  const n = app ? app.name : SUITE_NAME;
  return designName ? `${designName} — ${n}` : `${n} · ${SUITE_NAME}`;
}

/** The favicon as a data URI. */
export const appIconDataUri = (id) => { const a = appById(id); return a ? 'data:image/svg+xml,' + encodeURIComponent(a.icon) : ''; };

/** TASK 829: the id of the static intro (an <h1> + the description) the site build puts first in an app's built page for crawlers and link previews. */
export const SEO_INTRO_ID = 'sk-seo-intro';

/** Set the browser tab title + favicon from the registry. Call once at boot, again when the design name changes. A built site's page already links its
 *  favicon files statically (scripts/site-identity.cjs: the same drawing); only a page without them (the repo served as is) gets the data-URI link. The
 *  static intro is taken out here: the app has started and shows its own page. */
export function applyAppIdentity(id, { designName } = {}) {
  if (typeof document === 'undefined') return;
  document.title = appTitle(id, designName);
  const intro = document.getElementById(SEO_INTRO_ID);
  if (intro) intro.remove();
  if (document.querySelector('link[rel="icon"]')) return;
  const link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/svg+xml';
  link.href = appIconDataUri(id);
  document.head.appendChild(link);
}
