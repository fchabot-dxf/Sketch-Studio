// packages/ui/app-registry.js — THE app registry (TASK 473): one declared list of the suite's apps — id, name, accent, icon SVG, url —
// feeding the sidebar's GO TO entries, the browser tab TITLE and the tab FAVICON. No title or icon is hard-coded per index.html
// any more (each index.html keeps a static <title> fallback equal to appTitle(id), for before JS runs).
//
// The suite is "Sketch Studio"; the apps are Sketch (the parametric CAD), Shaper, Pen Plotter, Trace.
// Icons: four ORIGINAL simple glyphs (no brand marks), one family — same 2px round-capped stroke, an app accent on a dark
// rounded square, legible at 16px. `icon` is a complete <svg> (32x32 viewBox) usable inline (GO TO) or as a data URI (favicon).

export const SUITE_NAME = 'Sketch Studio';

const TILE = "<rect width='32' height='32' rx='7' fill='#1C1D20'/>";
const glyph = (accent, inner) =>
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32' width='32' height='32'>${TILE}<g fill='none' stroke='${accent}' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>${inner}</g></svg>`;

export const APPS = [
  { id: 'sketchstudio', name: 'Sketch', href: '../sketchstudio/', accent: '#4C9AFF', // a drafting compass
    icon: glyph('#4C9AFF', "<circle cx='16' cy='7' r='1.6'/><path d='M16 8.6 L9 25 M16 8.6 L23 25 M12.2 18.5 H19.8'/>") },
  { id: 'shaper', name: 'Shaper', href: '../shaper/', accent: '#1BE09E', // an end mill (shank, flutes, tip)
    icon: glyph('#1BE09E', "<path d='M12.5 5 H19.5 V14 H12.5 Z'/><path d='M12.5 14 L15 26 H17 L19.5 14'/><path d='M14.5 17.5 L17.5 21'/>") },
  { id: 'penplotter', name: 'Pen Plotter', href: '../penplotter/', accent: '#FF8A4C', // a pen nib
    icon: glyph('#FF8A4C', "<path d='M16 5 L23 16 L16 27 L9 16 Z'/><path d='M16 17 V27'/><circle cx='16' cy='14.5' r='1.5'/>") },
  { id: 'trace', name: 'Trace', href: '../trace/', accent: '#C084FC', // an image frame with a vector curve and nodes
    icon: glyph('#C084FC', "<rect x='6' y='7' width='20' height='18' rx='2.5'/><path d='M9.5 21 C13 10.5 19 10.5 22.5 21'/><rect x='8.4' y='19.9' width='2.2' height='2.2'/><rect x='21.4' y='19.9' width='2.2' height='2.2'/>") },
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

/** Set the browser tab title + favicon from the registry. Call once at boot, again when the design name changes. */
export function applyAppIdentity(id, { designName } = {}) {
  if (typeof document === 'undefined') return;
  document.title = appTitle(id, designName);
  let link = document.querySelector('link[rel="icon"]');
  if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
  link.type = 'image/svg+xml';
  link.href = appIconDataUri(id);
}
