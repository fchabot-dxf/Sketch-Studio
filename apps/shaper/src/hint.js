// apps/shaper/src/hint.js — TASK 770: THE hint widget of the Shaper app (the Prepare cut card, the Export step's side cards), declared once. The texts are the
// table's (param-hints.js); this module only shows them. No existing popover fitted: the card's popovers (.cut-pop) open to the LEFT of the card, where a
// phone has about 120 px; a hint must read on a phone and never be covered, so it is a LINE UNDER THE FIELD, inside the card (the card's rows scroll),
// the same element on every device:
//   - a computer: hovering the trigger (a mouse) or focusing it from the keyboard shows the hint; leaving / blurring hides it; a click pins it open;
//   - a phone / touch: TAPPING the trigger toggles it (no hover needed);
//   - ONE hint open at a time (in the whole page); Esc or a press anywhere else closes it;
//   - closed it is `hidden` (no height: the layout at rest is unchanged); open it wraps inside the card (never widens it).
// The trigger is a <button> (the cut card's row label itself, or a small "i" button beside a label that already does something: a checkbox's label, a
// field's <label>, a card title), with aria-expanded / aria-controls; every field it describes gets aria-describedby = the hint line. A `title` is not used:
// it does not work on touch. A hint never holds a length (the document may be inches or mm): the table's texts carry none.
import { hintLabel, hintText, PARAM_HINTS } from './param-hints.js';
import { matchesShortcut } from '#ui/shortcuts.js'; // Esc = the declared Cancel key

let openHint = null;     // the one open hint: { close(), contains(node) }
let keyboard = false;    // the last input was a key (a focus then comes from the keyboard: it shows the hint), not a pointer
let seq = 0;
const docsListening = new WeakSet();
function listen(doc) {
  if (docsListening.has(doc)) return;
  docsListening.add(doc);
  doc.addEventListener('keydown', (e) => { keyboard = true; if (openHint && matchesShortcut(e, 'edit.cancel')) openHint.close(); }, true);
  doc.addEventListener('pointerdown', (e) => { keyboard = false; if (openHint && !openHint.contains(e.target)) openHint.close(); }, true);
}

/**
 * mountHint({ id, trigger?, labelEl?, after, fields?, itemFields?, ctx? }) -> { el, trigger, setId(id, ctx?), refresh(ctx), close(), isOpen() }
 *   id         the table entry (param-hints.js)
 *   trigger    an existing <button> to use as the trigger (its text = the entry's label); omitted: a small "i" button is made and put right after `labelEl`
 *   labelEl    the element that shows the label text (default: the trigger)
 *   after      the element the hint line is inserted after (the row's field)
 *   fields     the elements the hint describes (aria-describedby)
 *   itemFields { [item id]: element }: an element described by ONE line of the hint (the entry's `items`: a Hold part mode button, an Export button)
 *   ctx        the context a hint depends on ({ loop }: Finish allowance)
 */
export function mountHint({ id, trigger = null, labelEl = null, after, fields = [], itemFields = {}, ctx = {} }) {
  const doc = after.ownerDocument;
  listen(doc);
  const n = ++seq;
  const own = !trigger;
  if (own) {
    trigger = doc.createElement('button');
    trigger.type = 'button';
    trigger.className = 'sk-hint-trigger sk-hint-i';
    labelEl.after(trigger);
  } else trigger.classList.add('sk-hint-trigger');
  const label = labelEl || trigger;
  const el = doc.createElement('div');
  el.className = 'sk-hint';
  el.id = `sk-hint-${n}`;
  el.setAttribute('role', 'note');
  el.hidden = true;
  after.after(el);
  trigger.setAttribute('aria-controls', el.id);
  trigger.setAttribute('aria-expanded', 'false');
  for (const f of fields) f.setAttribute('aria-describedby', el.id);

  let cur = id, pinned = false;
  const render = (c) => {
    label.textContent = hintLabel(cur);
    el.dataset.hint = cur; // which entry is shown (read by the consistency test, tests/param-hints-770-node.test.js)
    if (own) trigger.setAttribute('aria-label', `About ${hintLabel(cur)}`);
    el.replaceChildren();
    const main = doc.createElement('div');
    main.textContent = hintText(cur, c);
    el.appendChild(main);
    for (const item of PARAM_HINTS[cur].items || []) { // one line per item: "Label: hint"
      const line = doc.createElement('div');
      line.className = 'sk-hint-item';
      line.dataset.hint = item;
      line.id = `${el.id}-${item.replace(/[^a-z0-9-]/gi, '-')}`;
      const b = doc.createElement('b');
      b.textContent = hintLabel(item);
      line.append(b, ': ' + hintText(item, c));
      el.appendChild(line);
      const f = itemFields[item];
      if (f) f.setAttribute('aria-describedby', line.id);
    }
  };
  const show = (pin) => {
    if (openHint && openHint !== handle) openHint.close();
    pinned = pin;
    el.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    trigger.classList.add('is-open');
    openHint = handle;
  };
  const close = () => {
    el.hidden = true;
    pinned = false;
    trigger.setAttribute('aria-expanded', 'false');
    trigger.classList.remove('is-open');
    if (openHint === handle) openHint = null;
  };
  const handle = { close, contains: (node) => trigger.contains(node) || el.contains(node) };
  trigger.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse' && el.hidden) show(false); });
  trigger.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !pinned && !el.hidden) close(); });
  trigger.addEventListener('focus', () => { if (keyboard && el.hidden) show(false); });
  trigger.addEventListener('blur', () => { if (!pinned && !el.hidden) close(); });
  trigger.addEventListener('click', (e) => { e.preventDefault(); if (!el.hidden && pinned) close(); else show(true); });
  render(ctx);
  return {
    el, trigger,
    setId(next, c = ctx) { if (next !== cur) { cur = next; render(c); } },
    refresh(c) { ctx = c; render(c); },
    close, isOpen: () => !el.hidden,
  };
}

/** A menu row's second, smaller line: the choice's hint (cut types, clearing patterns, cutter shapes). */
export function optionHint(doc, id) {
  const s = doc.createElement('span');
  s.className = 'sk-opt-hint';
  s.dataset.hint = id;
  s.textContent = hintText(id);
  return s;
}
