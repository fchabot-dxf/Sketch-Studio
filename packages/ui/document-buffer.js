// packages/ui/document-buffer.js — the shared AUTOSAVE LOOP of an app and its open TABS (#ui/document-buffer-core.js, TASK 474 / 558) with the PAGE'S
// shared project store as its store when the host passes none (getProjectStore(): IndexedDB routed to Google Drive, project-store.js).
// TASK 881: the loop moved to document-buffer-core.js unchanged, where `store` is a passed value; this module keeps the import every website uses.
// A page without the project layer (Shaper's Fusion panel build) imports the core and passes its own store.

import { getProjectStore } from '#ui/project-store.js';
import { createDocumentBuffer as createBufferOn } from '#ui/document-buffer-core.js';

export { MAX_TABS, UNTITLED, OPENING_REASONS, SAME_TAB_REASONS, tabSig, mergeTabBuffers } from '#ui/document-buffer-core.js';

/** createDocumentBuffer(options): document-buffer-core.js createDocumentBuffer, on `options.store` or, when it is undefined, the page's shared store. */
export function createDocumentBuffer(options = {}) {
  return createBufferOn({ ...options, store: options.store === undefined ? getProjectStore() : options.store });
}
