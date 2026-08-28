// packages/ui/document-buffer.js — the shared AUTOSAVE BUFFER (PERSIST-2).
// Persists the current document (packages/core/document.js's serializeDocument) into IndexedDB under
// ONE well-known key, polled/coalesced rather than written every frame. Because every Sketch-Studio app
// is same-origin, this key IS the cross-app carry: draw in one editor, switch to another via the shared
// app-switcher, the geometry (with constraints) is right there — no export/import round trip.
//
// DDCS Studio lessons this steals (already paid for there, not rediscovered — see web/data/fsHandles.js,
// web/ui/fileSaveState.js:164):
//   - Buffer != file. This is NOT a named save; slice 3 adds that as a separate, explicit artifact.
//   - NO beforeunload warning. The buffer survives reload, so a warning would cry wolf on every refresh
//     and teach people to click through real ones. A passive status callback is the only truth-teller.
//   - All storage is best-effort: a write/read failure just means "not saved this time," never a thrown
//     error the host has to handle.
//   - Opening a document REPLACES the whole state (see #core/document.js's deserializeDocument) — never
//     a blend of old + restored.
//
// This module is UI-layer (DOM/IndexedDB), not #core — #core stays pure/testable; a browser-only storage
// concern belongs beside the other #ui host-facing modules (style-panel.js, etc.), matching this repo's
// existing #core/#ui split.

import { serializeDocument, deserializeDocument } from '#core/document.js';

const DB_NAME = 'sketch-studio-documents';
const STORE = 'kv';
const KEY = 'current'; // ONE well-known key -- the whole point of the cross-app carry

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('indexedDB unavailable')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { try { req.result.createObjectStore(STORE); } catch (_) {} };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readBuffer() {
  try {
    const db = await openDB();
    return await new Promise((resolve) => {
      const g = db.transaction(STORE).objectStore(STORE).get(KEY);
      g.onsuccess = () => resolve(g.result || null);
      g.onerror = () => resolve(null);
    });
  } catch (_) { return null; } // best-effort: no buffer readable = boot with an empty sketch, same as today
}

async function writeBuffer(doc) {
  try {
    const db = await openDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(doc, KEY);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (_) { return false; } // best-effort (lesson 7): a failed write just means "try again next change"
}

/**
 * createDocumentBuffer({ state, hostName, getHostData, pollMs, onStatusChange })
 *   state: the live sketch state to persist/restore (same shape #core/document.js expects).
 *   hostName / getHostData: OPTIONAL — if given, getHostData() is called at save time and embedded
 *     under doc.hosts[hostName] (e.g. penplotter's per-shape pen colors). Omit for a host with no
 *     side-car data of its own; #core/document.js's hosts sidecar stays empty and untouched.
 *   pollMs: how often to check for changes (default 1500ms — matches the DDCS reference's own
 *     "live-ish poll, cheap" cadence). A fixed-interval "did anything change" check rather than a
 *     classic reset-on-every-keystroke debounce: coalesces rapid edits into one write either way, and
 *     avoids needing a hook at every one of this codebase's many scattered state-mutation call sites.
 *   onStatusChange(status): optional — 'saving' | 'saved' | 'error', for a passive dirty/saved
 *     indicator. Never a blocking prompt (lesson 2).
 *
 * Returns { restore, start, stop }.
 *   restore(): reads the buffer (if any) and applies it via deserializeDocument. Returns
 *     { restored: boolean, hosts } — restored:false means "nothing to restore" (best-effort: any read/
 *     parse failure also resolves this way, never throws).
 *   start()/stop(): begin/end the poll-and-save loop.
 */
export function createDocumentBuffer({ state, hostName, getHostData, pollMs = 1500, onStatusChange } = {}) {
  let lastSig = null;
  let intervalId = null;
  const notify = (s) => { try { onStatusChange && onStatusChange(s); } catch (_) {} };

  function currentDoc() {
    const hosts = (hostName && typeof getHostData === 'function') ? { [hostName]: getHostData() } : {};
    return serializeDocument(state, { hosts });
  }

  async function poll() {
    let sig;
    try { sig = JSON.stringify(currentDoc()); } catch (_) { return; } // a transient bad state -- skip this tick
    if (sig === lastSig) return;
    notify('saving');
    const ok = await writeBuffer(JSON.parse(sig));
    if (sig === lastSig) return; // a newer change landed while this write was in flight -- let the NEXT tick handle it
    lastSig = sig;
    notify(ok ? 'saved' : 'error');
  }

  async function restore() {
    const doc = await readBuffer();
    if (!doc) return { restored: false, hosts: {} };
    const result = deserializeDocument(doc, state);
    if (!result.ok) return { restored: false, hosts: {} }; // e.g. a newer-version document -- flagged, not half-read
    lastSig = JSON.stringify(currentDoc()); // the just-restored state IS the baseline -- don't immediately re-save it as "new"
    return { restored: true, hosts: result.hosts };
  }

  function start() { if (intervalId == null) intervalId = setInterval(poll, pollMs); }
  function stop() { if (intervalId != null) { clearInterval(intervalId); intervalId = null; } }

  return { restore, start, stop };
}
