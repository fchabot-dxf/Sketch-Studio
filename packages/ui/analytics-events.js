// packages/ui/analytics-events.js — TASK 738: THE declared vocabulary of the anonymous usage analytics, ONE copy shared by the client
// (#ui/analytics.js, which sends) and the Worker (analytics/src/index.js, which refuses anything else). No import, no DOM: the Worker bundles it.
//
// An event is { event, name, id, app, version, host, dev } (analytics.js builds it; the Worker validates it field by field):
//   event   one of EVENTS
//   name    '' for a visit; for a feature, one of FEATURES (below)
//   id      the anonymous random id of this browser (ANON_ID: 32 hex characters, made on this device, NOT a person)
//   app     an app id of #ui/app-registry.js (sketchstudio | shaper | penplotter | trace)
//   version the site's build stamp (analytics.js BUILD: 'source' in the repo, the build time in a built site)
//   host    one of HOSTS: where the app runs (Shaper's Fusion 360 palette is 'fusion')
//   dev     1 = the owner's own device (?dev=1 once on that device), else 0
// Nothing else is ever sent: no file name, no design content, no typed number, no account data.

export const EVENTS = Object.freeze(['visit', 'feature']);
export const HOSTS = Object.freeze(['web', 'fusion']);

// THE feature names. A name ending in ':' is a FAMILY: the sender appends a DECLARED id to it (a stage id of the app's stage list, a template id of
// #core/templates.js TEMPLATES, or 'blank'), never text a person typed. Every entry has its call site(s) in the code, and every track() call names one
// of these (tests/analytics-client.test.js checks both directions).
export const FEATURES = Object.freeze([
  'stage:',            // a stage tab picked in the shared header / menu (#ui/app-chrome.js): stage:design, stage:prepare, stage:review ...
  'template:',         // a new design started from the template modal (#ui/project-actions.js): template:blank, template:slot ...
  'export:svg',        // an SVG downloaded (SketchStudio, Trace)
  'export:dxf',        // a DXF downloaded (SketchStudio, Trace)
  'export:copy-svg',   // the SVG copied to the clipboard (Trace)
  'export:shaper',     // the Shaper Origin SVG downloaded (Shaper)
  'export:shaperhub',  // the Shaper SVG uploaded to ShaperHub (Shaper)
  'export:gcode',      // the G-code zip downloaded (Pen Plotter)
  'import:svg',        // an SVG imported into a Design canvas (#ui/sketch-import.js, every app)
  'import:dxf',        // a DXF imported into a Design canvas (#ui/sketch-import.js, every app)
  'import:fusion',     // a Fusion 360 selection received in the palette (Shaper)
  'import:image',      // a photo loaded to trace (Trace)
  'drive:save',        // a design saved under a name (#ui/document-buffer.js saveAs: saving goes to Google Drive)
  'drive:open',        // a stored design opened (#ui/project-actions.js openDesign)
  'print',             // the Print button of SketchStudio's Drawing step (apps/sketchstudio/drawing-view.js)
  'settings',          // the settings / style panel opened (#ui/style-panel.js)
  'close-path',        // TASK 760: open paths closed by Close path (the tool, its menu entry or an import's "Close them": #ui/close-path-actions.js)
  'shortcut-changed',  // TASK 747: a keyboard shortcut given another key, swapped or left with none in Settings > Shortcuts (#ui/shortcuts-list.js); never which key
]);

// the id appended to a family: a declared id's shape (lower-case words joined by '-'), never free text
export const FAMILY_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// the anonymous id's shape (analytics.js makes it from crypto.getRandomValues)
export const ANON_ID = /^[0-9a-f]{32}$/;
// the build stamp's shape ('source', or the build time, e.g. 2026-11-16T14:05Z)
export const BUILD_STAMP = /^[0-9A-Za-z:.-]{1,32}$/;

/** True when `name` is a declared feature: one of FEATURES, or a family followed by a declared id's shape. */
export function isFeatureName(name) {
  if (typeof name !== 'string' || name.length > 64) return false;
  if (FEATURES.includes(name) && !name.endsWith(':')) return true;
  const i = name.indexOf(':');
  return i > 0 && FEATURES.includes(name.slice(0, i + 1)) && FAMILY_ID.test(name.slice(i + 1));
}

// A LOCAL host name: localhost, a loopback / private-network / link-local address, a single-label name, or a .local name. The client never sends from a
// page served on one (that is a developer's machine, a test run or the gate's headless browsers: analytics.js isPublicPage), and the Worker files an
// Origin with one under the site class 'local' (analytics/src/index.js originClass). The host itself is never stored.
export const LOCAL_HOST = /^(localhost|.+\.localhost|127\.\d+\.\d+\.\d+|\[::1\]|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|[^.]+|.+\.local)$/;
