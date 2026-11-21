// packages/ui/text-fonts.js — TASK 845: THE FONTS of the Design tab's TEXT, and THE rebuild of a text's letters when its text shape arrives
// without them (a document read, a paste, an undo to a step taken before its font had loaded).
//
// BUNDLED_FONTS: the fonts that ship with the apps (packages/ui/vendor/fonts, each with its licence file: see its README.txt). A font is
// downloaded and read only when a text first needs it (createFontLibrary().load): nothing loads with the app. Outline fonts (WOFF) are read
// by opentype.js (vendored: packages/ui/vendor/opentype, imported on first use), single-line fonts (SVG fonts) by #core/font-faces.js.
// A font the user loads (Load your own font...: .ttf / .otf / .woff) is kept FOR THIS SESSION only (in memory; a reload forgets it). A text
// stores the font's NAME and a bundled FALLBACK: opened where its font is not loaded, it is drawn in the fallback, with a plain note.

import { opentypeFace, svgFontFace } from '#core/font-faces.js';
import { isText, rebuildTextOutline, textOutlineOf } from '#core/text.js';

/** The bundled fonts: name (what a text stores), kind ('outline' | 'single'), url (the font file) and licence (its licence file), both in
 *  packages/ui/vendor/fonts (named one by one, so the site build's closure checks every file is there: scripts/site-closure.cjs). */
export const BUNDLED_FONTS = Object.freeze([
  { name: 'Inter', kind: 'outline', url: new URL('./vendor/fonts/inter/inter-latin-400-normal.woff', import.meta.url), licence: new URL('./vendor/fonts/inter/LICENSE', import.meta.url) },
  { name: 'Roboto', kind: 'outline', url: new URL('./vendor/fonts/roboto/roboto-latin-400-normal.woff', import.meta.url), licence: new URL('./vendor/fonts/roboto/LICENSE', import.meta.url) },
  { name: 'Roboto Slab', kind: 'outline', url: new URL('./vendor/fonts/roboto-slab/roboto-slab-latin-400-normal.woff', import.meta.url), licence: new URL('./vendor/fonts/roboto-slab/LICENSE', import.meta.url) },
  { name: 'Merriweather', kind: 'outline', url: new URL('./vendor/fonts/merriweather/merriweather-latin-400-normal.woff', import.meta.url), licence: new URL('./vendor/fonts/merriweather/LICENSE', import.meta.url) },
  { name: 'Oswald', kind: 'outline', url: new URL('./vendor/fonts/oswald/oswald-latin-400-normal.woff', import.meta.url), licence: new URL('./vendor/fonts/oswald/LICENSE', import.meta.url) },
  { name: 'Anton', kind: 'outline', url: new URL('./vendor/fonts/anton/anton-latin-400-normal.woff', import.meta.url), licence: new URL('./vendor/fonts/anton/LICENSE', import.meta.url) },
  { name: 'Bebas Neue', kind: 'outline', url: new URL('./vendor/fonts/bebas-neue/bebas-neue-latin-400-normal.woff', import.meta.url), licence: new URL('./vendor/fonts/bebas-neue/LICENSE', import.meta.url) },
  { name: 'Pacifico', kind: 'outline', url: new URL('./vendor/fonts/pacifico/pacifico-latin-400-normal.woff', import.meta.url), licence: new URL('./vendor/fonts/pacifico/LICENSE', import.meta.url) },
  { name: 'Hershey Simplex', kind: 'single', url: new URL('./vendor/fonts/hershey/HersheySans1.svg', import.meta.url), licence: new URL('./vendor/fonts/hershey/LICENSE', import.meta.url) },
  { name: 'Hershey Duplex', kind: 'single', url: new URL('./vendor/fonts/hershey/HersheySansMed.svg', import.meta.url), licence: new URL('./vendor/fonts/hershey/LICENSE', import.meta.url) },
  { name: 'Hershey Complex', kind: 'single', url: new URL('./vendor/fonts/hershey/HersheySerifMed.svg', import.meta.url), licence: new URL('./vendor/fonts/hershey/LICENSE', import.meta.url) },
  { name: 'Hershey Script', kind: 'single', url: new URL('./vendor/fonts/hershey/HersheyScript1.svg', import.meta.url), licence: new URL('./vendor/fonts/hershey/LICENSE', import.meta.url) },
  { name: 'Hershey Italic', kind: 'single', url: new URL('./vendor/fonts/hershey/HersheySerifMedItalic.svg', import.meta.url), licence: new URL('./vendor/fonts/hershey/LICENSE', import.meta.url) },
  { name: 'Relief SingleLine', kind: 'single', url: new URL('./vendor/fonts/relief/ReliefSingleLineSVG-Regular.svg', import.meta.url), licence: new URL('./vendor/fonts/relief/OFL.txt', import.meta.url) },
]);
/** The file types Load your own font... accepts (what opentype.js reads). */
export const USER_FONT_ACCEPT = '.ttf,.otf,.woff';

async function fetchBytes(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`could not download ${url.pathname || url}: HTTP ${r.status}`);
  return r.arrayBuffer();
}

/**
 * A font library. readBytes(url) -> Promise<ArrayBuffer> reads a bundled file (default: fetch); loadOpentype() -> Promise<module> imports
 * opentype.js (default: the vendored copy). Returns { face(name), load(name), has(name), list(), addFontFile(bytes, fileName), onChange(fn) }:
 *   face(name)   the face when it is loaded, else null (synchronous)
 *   load(name)   -> Promise<face | null>: a bundled font (downloaded once), a font loaded this session, null for a font this device does not have
 *   list()       [{ name, kind, user }]: the bundled fonts, then the fonts the user loaded this session
 *   addFontFile  reads a .ttf / .otf / .woff the user picked: -> Promise<face> named by the font's own family (+ style when not Regular)
 */
export function createFontLibrary({ readBytes = fetchBytes, loadOpentype = () => import('./vendor/opentype/opentype.module.js') } = {}) {
  const faces = new Map(), loading = new Map(), user = new Map(), listeners = new Set();
  const bundled = (name) => BUNDLED_FONTS.find((f) => f.name === name) || null;
  let opentype = null;
  const parser = async () => opentype || (opentype = (await loadOpentype()).default);
  const emit = () => { for (const fn of listeners) fn(); };
  function load(name) {
    if (faces.has(name)) return Promise.resolve(faces.get(name));
    if (loading.has(name)) return loading.get(name);
    const b = bundled(name);
    if (!b) return Promise.resolve(null);
    const p = (async () => {
      const bytes = await readBytes(b.url);
      const face = b.kind === 'single' ? svgFontFace(new TextDecoder().decode(bytes), { name, kind: 'single' }) : opentypeFace((await parser()).parse(bytes), { name, kind: 'outline' });
      faces.set(name, face);
      emit();
      return face;
    })();
    loading.set(name, p);
    const forget = () => loading.delete(name); // done or failed, the next load() starts afresh (a failure reaches every caller of load() through p)
    p.then(forget, forget);
    return p;
  }
  async function addFontFile(bytes, fileName = 'font') {
    const font = (await parser()).parse(bytes);
    const fam = font.names && font.names.fontFamily && (font.names.fontFamily.en || Object.values(font.names.fontFamily)[0]);
    const sub = font.names && font.names.fontSubfamily && (font.names.fontSubfamily.en || Object.values(font.names.fontSubfamily)[0]);
    let name = (fam || String(fileName).replace(/\.[^.]+$/, '')) + (sub && !/^regular$/i.test(sub) ? ' ' + sub : '');
    if (bundled(name)) name += ' (yours)'; // never shadows a bundled font of the same name
    const face = opentypeFace(font, { name, kind: 'outline' });
    faces.set(name, face);
    user.set(name, { name, kind: 'outline', user: true });
    emit();
    return face;
  }
  return {
    face: (name) => faces.get(name) || null,
    load,
    has: (name) => !!bundled(name) || faces.has(name),
    list: () => [...BUNDLED_FONTS.map((f) => ({ name: f.name, kind: f.kind, user: false })), ...user.values()],
    addFontFile,
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

/** THE font library of the page (every Design canvas of the page draws its texts with it). */
export const fontLibrary = createFontLibrary();

/**
 * The face a text is drawn in: its own font when loaded ({ face }); its own font still downloading ({ wait }); a font this device does not have
 * (a font loaded in another session): its bundled fallback ({ face | wait, fallback: true }).
 */
export function textFace(text, library = fontLibrary) {
  const own = library.face(text.font);
  if (own) return { face: own };
  if (library.has(text.font)) return { wait: library.load(text.font) };
  const fb = library.face(text.fallback);
  return fb ? { face: fb, fallback: true } : { wait: library.load(text.fallback), fallback: true };
}

/** The note a text drawn in its fallback shows (once per font per page). */
export const fallbackNote = (text) => `Text: the font "${text.font}" is not loaded on this device, so the text is shown in ${text.fallback}. Load the font (Text tool > Font > Load your own font...) to show it as designed; the design keeps "${text.font}".`;
const noted = new Set();

/**
 * THE rebuild of texts' letters (#core/text.js rebuildTextOutline) from their fonts: every text of `state` (onlyMissing: only those that have no
 * letters). Texts whose face is loaded are rebuilt at once; the others when their font has downloaded. notify(message, level): the fallback note.
 * -> Promise (settles when every waiting text is rebuilt).
 */
export function syncTextOutlines(state, { library = fontLibrary, notify = null, onlyMissing = false } = {}) {
  const waits = [];
  const build = (t, r) => {
    rebuildTextOutline(state, t, r.face);
    if (r.fallback && notify && !noted.has(t.font)) { noted.add(t.font); notify(fallbackNote(t), 'warning'); }
  };
  for (const t of (state.shapes || []).filter(isText)) {
    if (onlyMissing && (!String(t.text || '').trim() || textOutlineOf(state, t).length)) continue;
    const r = textFace(t, library);
    if (r.face) { build(t, r); continue; }
    waits.push(r.wait.then(() => {
      if (!state.shapes.includes(t)) return; // gone meanwhile (another document, an undo)
      const again = textFace(t, library);
      if (again.face) build(t, again);
    }));
  }
  return Promise.all(waits);
}

/** Keep `state`'s texts drawn: after every history change (an undo / redo to a step taken before a font had loaded), a text without letters is
 *  rebuilt (syncTextOutlines onlyMissing). Installed once per Design state (#ui/input-manager.js setupInput). -> the unsubscribe function. */
export function watchTextOutlines(state, opts = {}) {
  if (!state || typeof state.addHistoryListener !== 'function') return () => {};
  return state.addHistoryListener(() => { syncTextOutlines(state, { ...opts, onlyMissing: true }); });
}
