// packages/ui/footer-slot.js — TASK 776: WHERE the document's own controls (THE Save button, save-button.js; THE account avatar, account-avatar.js) live: the
// right end of the shared app footer (app-footer.js), after Recenter and the Settings gear: [Recenter] [Settings] [Save] [Account]. Declared once here: the
// footer builds the slot with this class, the project layer (sidebar-projects.js) puts the two controls into it. A host without the project layer
// (Shaper in Fusion mode) never puts anything there.
export const FOOTER_END_CLASS = 'sk-footer-end';

/** The footer's right-end slot of this page, or null while the footer is not mounted yet. */
export function findFooterEnd(doc = globalThis.document) {
  return doc ? doc.querySelector('.' + FOOTER_END_CLASS) : null;
}
