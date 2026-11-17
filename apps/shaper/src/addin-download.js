// apps/shaper/src/addin-download.js — TASK 733 (owner turn 2066: "in the shaper sidebar add a addin download"): the Shaper sidebar's
// "Fusion add-in" entry and the drawer view it opens (the shared sidebar's own `registerView` / `showView` pattern, #ui/app-sidebar.js):
// a "Download (.zip)" link, the add-in's version and the install steps.
//
// The zip is NOT in this repo (the add-in's repo is private; this one is public): shaper-addin's `make_release.py` writes shaper-addin.zip +
// shaper-addin.json, and `node scripts/build-site.cjs shaper --addin <that folder>` copies both into the SITE at apps/shaper/downloads/
// (build-site.cjs ADDIN_DOWNLOAD). The view reads the json; one code path: no json served = "not available in this build".
// The json is an OPTIONAL site file, so its URL is written relative to the page without a leading './' (scripts/site-closure.cjs requires every
// './x.json' literal to exist; this one exists only in a site built with --addin).
// In Fusion mode (?host=fusion: the add-in's own palette) the user already has the add-in: the entry is hidden.

import { SIDEBAR_ICONS } from '#ui/app-sidebar.js';

export const ADDIN_ACTION_ID = 'fusion-addin';
export const ADDIN_VIEW_ID = 'fusion-addin';
// = build-site.cjs ADDIN_DOWNLOAD.dir (apps/shaper/) + ADDIN_DOWNLOAD.json, resolved against the page /apps/shaper/ (the node test checks they agree)
export const ADDIN_RELEASE_JSON = 'downloads/shaper-addin.json';
export const ADDIN_UNAVAILABLE = 'The add-in download is not available in this build.';

// The install steps (Fusion's own menu names, as Fusion writes them).
export const ADDIN_INSTALL_STEPS = [
  'Unzip shaper-addin.zip.',
  'In Fusion: UTILITIES tab > ADD-INS > Scripts and Add-Ins.',
  'Add-Ins tab: the green + next to My Add-Ins.',
  'Pick the unzipped shaper-addin folder, then Run (tick Run on Startup to keep it).',
  'The Shaper button is in the UTILITIES tab.',
];

/** The declared sidebar item (a host action of #ui/app-sidebar.js). `fusion`: Fusion mode hides it; `open`: shows the view. */
export function fusionAddinAction({ fusion, open }) {
  return {
    id: ADDIN_ACTION_ID,
    label: 'Fusion add-in',
    icon: SIDEBAR_ICONS.addin,
    tooltip: 'Download the Fusion 360 add-in that opens this app in a Fusion palette',
    keepOpen: true,
    visible: () => !fusion,
    onClick: open,
  };
}

/**
 * Read the release json next to the page. -> { available: false } when the site has none, else { available: true, version, bytes, zipUrl }.
 * A site without the file answers 404 (a static server) or, on Cloudflare Pages with no 404.html, the app's HTML page (its single-page
 * fallback): both mean "not in this build". Any other failure throws (the view shows it).
 */
export async function loadAddinRelease({ fetchImpl = (u, o) => fetch(u, o), base = document.baseURI } = {}) {
  const url = new URL(ADDIN_RELEASE_JSON, base);
  const res = await fetchImpl(url.href, { cache: 'no-cache' });
  const type = (res.headers.get('content-type') || '').toLowerCase();
  if (res.status === 404 || (res.ok && !type.includes('json'))) return { available: false };
  if (!res.ok) throw new Error(`The add-in release could not be read (HTTP ${res.status}).`);
  const info = await res.json();
  if (!info || typeof info.version !== 'string' || typeof info.zip !== 'string') throw new Error('The add-in release file has no version or zip.');
  return { available: true, version: info.version, bytes: info.bytes, zipUrl: new URL(info.zip, url).href };
}

const kb = (bytes) => (Number.isFinite(bytes) ? ` · ${Math.max(1, Math.round(bytes / 1024))} KB` : '');

/** The drawer view: { title, render(container) } for sidebar.registerView(ADDIN_VIEW_ID, ...). */
export function fusionAddinView({ load = loadAddinRelease } = {}) {
  return {
    title: 'Fusion add-in',
    render(container) {
      const doc = container.ownerDocument;
      const el = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
      container.dataset.addin = 'view';
      container.appendChild(el('p', 'sk-note', 'The Fusion 360 add-in opens this Shaper app in a Fusion palette: select a body or sketch in Fusion and add it to the cut plan.'));
      const release = el('div'); release.dataset.addin = 'release';
      release.appendChild(el('p', 'sk-note', 'Reading the add-in release…'));
      container.appendChild(release);
      container.appendChild(el('p', 'sk-note', 'Install:'));
      const steps = el('ul', 'sk-check-steps'); steps.dataset.addin = 'steps';
      ADDIN_INSTALL_STEPS.forEach((text, i) => {
        const li = el('li');
        li.append(el('span', 'mark', `${i + 1}.`), el('span', 'txt', text));
        steps.appendChild(li);
      });
      container.appendChild(steps);

      const show = (nodes) => { release.replaceChildren(...nodes); };
      Promise.resolve().then(() => load()).then((r) => {
        if (!r.available) {
          const m = el('div', 'sk-sidebar-msg info', ADDIN_UNAVAILABLE); m.dataset.addin = 'unavailable'; m.setAttribute('role', 'status');
          show([m]);
          return;
        }
        const a = el('a', 'sk-sidebar-item'); a.dataset.addin = 'download'; a.href = r.zipUrl; a.setAttribute('download', 'shaper-addin.zip');
        a.innerHTML = `<span class="sk-sidebar-ic" aria-hidden="true">${SIDEBAR_ICONS.download}</span><span>Download (.zip)</span>`;
        const v = el('p', 'sk-note', `Version ${r.version}${kb(r.bytes)}`); v.dataset.addin = 'version';
        show([a, v]);
      }, (err) => {
        const m = el('div', 'sk-sidebar-msg error', (err && err.message) || String(err)); m.dataset.addin = 'error'; m.setAttribute('role', 'alert');
        show([m]);
      });
    },
  };
}
