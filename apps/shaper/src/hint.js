// apps/shaper/src/hint.js — TASK 805: Shaper's hints are a TOOLTIP AT THE CURSOR (#ui/cursor-tooltip.js), never text laid out in the UI. An element that carries a hint has
// data-hint="<id>" (the id of an entry of param-hints.js: THE table of labels and hints); this file puts its label in it (bindHint) and answers the tooltip's question
// "what is this element's hint now?" (hintFor: the table's text in the context the card last gave that element, evaluated when the tooltip opens).
// A hint is never a result: the cut card's note lines (the pocket's turns, the warnings, the leftover line) stay laid out as they are.
import { hintLabel, hintText } from './param-hints.js';
import { installCursorTooltip } from '#ui/cursor-tooltip.js';

const offReasons = new WeakMap(); // element -> why its row does not apply now (TASK 813); set by setOffReason
const contexts = new WeakMap(); // element -> the context its hint function reads ({ loop, roughing, online, contour ... }); set by refresh()

/**
 * Bind an element to a table entry: its text is the entry's label (unless `iconOnly`: its text is its own, e.g. the Operations title) and it shows the entry's hint
 * in the tooltip. Returns a handle the cut card keeps: setId (the row is another entry now), refresh (the context changed), trigger (the element).
 */
export function bindHint({ el, id = el.dataset.hint, ctx = {}, iconOnly = false }) {
  contexts.set(el, ctx);
  const set = (next) => {
    el.dataset.hint = next;
    if (!iconOnly) el.textContent = hintLabel(next);
  };
  set(id);
  return {
    trigger: el,
    setId(next) { if (next !== el.dataset.hint) set(next); },
    refresh(c) { contexts.set(el, c); },
  };
}

/** TASK 813: a row that does not apply now stays in its place, greyed: its label's tooltip starts with the reason (null = the row applies). */
export function setOffReason(el, reason) {
  if (reason) offReasons.set(el, reason); else offReasons.delete(el);
}

/** The hint text of an element that has data-hint, in its context now (after the reason, while its row is greyed). */
export function hintFor(el) {
  const text = hintText(el.dataset.hint, contexts.get(el) || {}), why = offReasons.get(el);
  return why ? `${why}${/[.!?]$/.test(why) ? '' : '.'} ${text}` : text;
}

/** The Review toolbar's buttons have their own element-anchored tooltip (#ui mountTooltip with a title and the text): they are not this one's. */
const OWN_TOOLTIP = '#review-toolbar';

/** Install the one tooltip of the page: every element with data-hint. */
export function installHintTooltip(doc = document) {
  return installCursorTooltip({
    doc,
    selector: '[data-hint]',
    resolve: (el) => (el.closest(OWN_TOOLTIP) ? null : hintFor(el)),
  });
}
