// packages/ui/project-store.js — PROJECTS (folders) and DESIGNS (documents) on top of the document format (TASK 474): THE PAGE'S SHARED STORE.
// TASK 881: the store's engine (createProjectStore, its adapters, the open-tabs buffer and the model notes) is #ui/project-store-core.js, moved there
// unchanged; every name of it is re-exported here, so the importers of this module are unchanged. This module adds getProjectStore(): the one store
// of the page, on IndexedDB and routed to Google Drive (router-adapter.js, drive-adapter.js, google-account.js). A page that keeps its designs in
// memory (the Fusion panel build) imports the engine alone.

import { createProjectStore, createIdbAdapter } from '#ui/project-store-core.js';
import { createRouterAdapter } from '#ui/cloud/router-adapter.js';
import { createDriveAdapter } from '#ui/cloud/drive-adapter.js';
import { getGoogleAccount } from '#ui/cloud/google-account.js';

export {
  DEFAULT_PROJECT_ID,
  DEFAULT_PROJECT_NAME,
  LEGACY_DESIGN_ID,
  emptyDocument,
  createMemoryAdapter,
  createIdbAdapter,
  readLegacySlot,
  LEGACY_BUFFER_APPS,
  mergeLegacyBuffers,
  createProjectStore,
  contentPrint,
} from '#ui/project-store-core.js';

let shared = null;
/** The one shared store of this page (IndexedDB adapter). */
export function getProjectStore() {
  if (shared) return shared;
  const local = createIdbAdapter();
  let remote = null; // built on first use: a page that never touches Drive never constructs it
  const account = getGoogleAccount();
  const router = createRouterAdapter({ local, signedIn: () => account.state().signedIn, subscribeSignIn: (fn) => account.subscribe(fn), getRemote: () => remote || (remote = createDriveAdapter({ account, meta: local })) });
  return (shared = createProjectStore({ adapter: router }));
}
