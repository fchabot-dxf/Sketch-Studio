// packages/ui/spinner.js — TASK 768: THE spinner, one component and one stylesheet for every "working" indicator of the shared chrome: the header's
// Save button while a save runs or a design loads (save-button.js), the loading tab of the document tab strip (document-tabs.js) and the loading
// overlay over the work area (loading-overlay.js). (Trace has its own host-only .tr-spinner for its photo trace, apps/trace/styles/main.css: not
// part of the shared chrome, left as it is.)
//
// createSpinner({ label, doc }) -> <span class="sk-spinner" role="status"> holding the ring (decorative) and `label` as its text alternative (visually
// hidden). The ring is drawn in currentColor at --sk-spinner-size (default 14 px), so it takes the colour and size of whatever holds it.
// Reduced motion (prefers-reduced-motion: reduce): the ring does not turn; it is drawn dotted (a still "working" mark), the text alternative is unchanged.

let stylesInjected = false;
function injectStyles(doc) {
  if (stylesInjected || !doc || !doc.head) return;
  if (doc.getElementById('sk-spinner-styles')) { stylesInjected = true; return; }
  const s = doc.createElement('style'); s.id = 'sk-spinner-styles';
  s.textContent = `
.sk-spinner { display: inline-flex; flex: 0 0 auto; width: var(--sk-spinner-size, 14px); height: var(--sk-spinner-size, 14px); position: relative; vertical-align: middle; }
.sk-spinner-ring { width: 100%; height: 100%; box-sizing: border-box; border-radius: 50%; border: 2px solid currentColor; border-right-color: transparent; border-bottom-color: transparent;
  opacity: 0.85; animation: sk-spinner-turn 0.8s linear infinite; }
.sk-spinner-text { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
@keyframes sk-spinner-turn { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .sk-spinner-ring { animation: none; border-style: dotted; border-right-color: currentColor; border-bottom-color: currentColor; } }
`;
  doc.head.appendChild(s);
  stylesInjected = true;
}

/** The one spinner element. `label` is what a screen reader hears ("Saving…", "Loading Panel…"). */
export function createSpinner({ label = 'Working…', doc = globalThis.document } = {}) {
  injectStyles(doc);
  const el = doc.createElement('span');
  el.className = 'sk-spinner';
  el.setAttribute('role', 'status');
  const ring = doc.createElement('span'); ring.className = 'sk-spinner-ring'; ring.setAttribute('aria-hidden', 'true');
  const text = doc.createElement('span'); text.className = 'sk-spinner-text'; text.textContent = label;
  el.append(ring, text);
  return el;
}
