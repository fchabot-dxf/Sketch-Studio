// packages/ui/new-document.js — TASK 473: "New" = start a fresh document. TEMPORARY: until the project store of task 474
// provides store.newProject(), this clears the shared autosave slot (the cross-app carry document in the same IndexedDB
// the document buffer uses) and reloads, so every host (geometry + its sidecar) starts from its defaults through its normal
// restore path. When 474 lands, replace this body with newProject() — it is the ONLY caller.
const DB_NAME = 'sketch-studio-documents'; // must match packages/ui/document-buffer.js
const STORE = 'kv';
const KEY = 'current';

export async function startNewDocument() {
  try {
    await new Promise((resolve) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { try { req.result.createObjectStore(STORE); } catch (_) {} };
      req.onerror = () => resolve(false);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(KEY);
        tx.oncomplete = () => { db.close(); resolve(true); };
        tx.onerror = () => { db.close(); resolve(false); };
      };
    });
  } catch (_) { /* best-effort: a failed clear just reloads the same document */ }
  location.reload();
}
