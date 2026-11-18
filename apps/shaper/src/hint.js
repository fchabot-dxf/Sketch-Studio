// apps/shaper/src/hint.js — TASK 770 / 772: Shaper wrapper around the shared #ui/hint.js widget, reading labels & hints from param-hints.js.
import { hintLabel, hintText, PARAM_HINTS } from './param-hints.js';
import { mountHint as mountSharedHint } from '#ui/hint.js';

export function mountHint({ id, trigger = null, labelEl = null, after, fields = [], itemFields = {}, ctx = {}, iconOnly = false }) {
  return mountSharedHint({
    id, trigger, labelEl, after, fields, itemFields, ctx, iconOnly,
    getEntry: (entryId, c) => ({
      label: hintLabel(entryId),
      text: hintText(entryId, c),
      items: (PARAM_HINTS[entryId].items || []).map((itemId) => ({
        id: itemId,
        label: hintLabel(itemId),
        text: hintText(itemId, c),
      })),
    }),
  });
}

/** A menu row's second, smaller line: the choice's hint (cut types, clearing patterns, cutter shapes). */
export function optionHint(doc, id) {
  const s = doc.createElement('span');
  s.className = 'sk-opt-hint';
  s.dataset.hint = id;
  s.textContent = hintText(id);
  return s;
}
