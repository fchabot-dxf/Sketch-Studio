// packages/ui/loading-overlay.js — TASK 768: the LOADING overlay over the work area (everything below the document tab strip: ribbon, canvas, panels), shown
// while a design is being opened or re-loaded (document-activity.js loading) for LONGER than LOADING_OVERLAY_DELAY_MS (a fast load shows only the tab /
// header spinner: no flash). Light and NON-BLOCKING: a translucent veil with a card "Loading <name>…" and THE spinner (spinner.js); it takes no pointer
// events (pointer-events: none), so nothing under it is blocked. It sits ABOVE the modals (the Open dialog and the Projects modal stay up until the design they
// opened shows, so the load would otherwise be hidden under them; z-index 9800 > their 9600 / 9700, below the toasts' 10001): their buttons stay usable through it. It goes away as soon as the load settles (shown, failed or cancelled: the activity's
// load() always ends), and with it its timer.
//
// mountLoadingOverlay({ activity, below, delayMs, doc }) -> { el, destroy }   below(): the element the overlay starts under (the tab strip)
import { createSpinner } from './spinner.js';
import { LOADING_OVERLAY_DELAY_MS } from './document-activity.js';

let stylesInjected = false;
function injectStyles(doc) {
  if (stylesInjected || !doc || !doc.head) return;
  if (doc.getElementById('sk-loading-styles')) { stylesInjected = true; return; }
  const s = doc.createElement('style'); s.id = 'sk-loading-styles';
  s.textContent = `
.sk-loading { position: fixed; left: 0; right: 0; bottom: 0; z-index: 9800; display: flex; align-items: center; justify-content: center; pointer-events: none;
  background: color-mix(in srgb, var(--sk-header-bg, #ffffff) 40%, transparent); }
.sk-loading[hidden] { display: none; }
.sk-loading-card { display: inline-flex; align-items: center; gap: 10px; max-width: calc(100vw - 32px); padding: 10px 16px; border-radius: 10px; box-sizing: border-box;
  background: var(--sk-header-bg, #ffffff); color: var(--sk-header-fg, #334155); border: 1px solid var(--sk-header-sep, #cbd5e1); box-shadow: 0 4px 18px rgba(0,0,0,0.18);
  font: 600 13px/1.3 system-ui, -apple-system, 'Segoe UI', sans-serif; --sk-spinner-size: 18px; }
.sk-loading-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;
  doc.head.appendChild(s);
  stylesInjected = true;
}

export function mountLoadingOverlay({ activity, below, delayMs = LOADING_OVERLAY_DELAY_MS, doc = globalThis.document }) {
  injectStyles(doc);
  const el = doc.createElement('div'); el.className = 'sk-loading'; el.hidden = true;
  const card = doc.createElement('div'); card.className = 'sk-loading-card';
  const text = doc.createElement('span'); text.className = 'sk-loading-text'; text.setAttribute('aria-hidden', 'true');
  card.appendChild(text); el.appendChild(card);
  doc.body.appendChild(el);
  let timer = null;
  let shownFor = null; // the load ({ name, since }) the timer / the overlay belongs to

  function show(load) {
    const label = load.name ? `Loading ${load.name}…` : 'Loading the design…';
    const anchor = below();
    el.style.top = (anchor && anchor.isConnected ? Math.max(0, anchor.getBoundingClientRect().bottom) : 0) + 'px';
    text.textContent = label;
    const old = card.querySelector('.sk-spinner'); if (old) old.remove();
    card.insertBefore(createSpinner({ label, doc }), text);
    el.hidden = false;
  }
  function hide() { clearTimeout(timer); timer = null; shownFor = null; el.hidden = true; const sp = card.querySelector('.sk-spinner'); if (sp) sp.remove(); }
  function update() {
    const load = activity.loading();
    if (!load) { hide(); return; }
    if (shownFor && shownFor.since === load.since && shownFor.name === load.name) return; // the same load: its timer runs / it shows
    hide();
    shownFor = load;
    timer = setTimeout(() => { timer = null; const now = activity.loading(); if (now && now.since === load.since) show(now); }, Math.max(0, delayMs - (Date.now() - load.since)));
  }
  const off = activity.subscribe(update);
  update();
  return { el, destroy() { off(); hide(); el.remove(); } };
}
