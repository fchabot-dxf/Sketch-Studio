// apps/shaper/src/disclosure.js — TASK 757: the FOLD of Prepare's Operations sheet (TASK 743 op-list.js), declared once and reused by the Export step's 3D info:
// a header BUTTON that shows / hides its body (aria-expanded on the button, data-open on the host, the body's hidden attribute), with the sheet's caret.
// The one layout rule: open by default on a wide screen, folded on a phone (PHONE_QUERY, the CSS phone breakpoint of apps/shaper/index.html).
export const PHONE_QUERY = '(max-width: 640px)';
export const CARET_SVG = '<svg class="ops-caret" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 5l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** Whether `win` is a phone-sized window (the fold's default: folded there). */
export const isPhone = (win) => !!(win.matchMedia && win.matchMedia(PHONE_QUERY).matches);

/**
 * mountDisclosure({ host, head, body, open, onToggle }) -> { setOpen(open), get open }
 *   host   the element that carries data-open="true" | "false" (the CSS turns the caret on it)
 *   head   the header button: a click folds / unfolds the body
 *   body   the element shown while open
 *   open   the first state (default: open unless a phone window)
 *   onToggle(open)  called after a click changed the state
 */
export function mountDisclosure({ host, head, body, open = !isPhone(host.ownerDocument.defaultView), onToggle = () => {} }) {
  let state = open;
  const setOpen = (v) => { state = !!v; host.dataset.open = String(state); head.setAttribute('aria-expanded', String(state)); body.hidden = !state; };
  setOpen(state);
  head.addEventListener('click', () => { setOpen(!state); onToggle(state); });
  return { setOpen, get open() { return state; } };
}
