// packages/ui/cloud/drive-writer.js — THROTTLED, RETRYING, SAFE writes of autosaved designs to Google Drive (TASK 506).
//
// The autosave loop ticks every 1.5 s; Drive must see at most ONE write per design per `intervalMs` (5 s), or its rate limits bite.
// This module owns that policy and nothing else (the project store gives it the actual `write`):
//   queue(id, payload)   remember the LATEST payload, keep it on this device FIRST (`keepLocal`: the safety net), then write it now if the
//                        interval since the last write has passed, else on a timer. Many ticks collapse into one write of the newest payload.
//   flush(id?)           write the pending payload(s) NOW, ignoring the interval and any retry delay (the tab went hidden / is closing, or an
//                        explicit action needs Drive current). Resolves when done; never throws (a failure is a status).
//   status(id)           { state: 'saved' | 'saving' | 'failed', at, reason } — the ONE source the sidebar status line reads.
// A failed write keeps the payload (and the local copy), records the reason, and retries with BACKOFF; the local copy is dropped
// (`dropLocal`) only after a write succeeded and nothing newer is waiting. Every clock and timer is injectable (tests).
export const DRIVE_WRITE_INTERVAL_MS = 5000;
export const DRIVE_RETRY_BACKOFF_MS = [5000, 10000, 20000, 40000, 60000];

export function createDriveWriter({
  write, keepLocal, dropLocal, describeError = (e) => (e && e.message) || String(e), onStatus = () => {}, onWritten = () => {},
  now = () => Date.now(), setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (t) => clearTimeout(t),
  intervalMs = DRIVE_WRITE_INTERVAL_MS, backoffMs = DRIVE_RETRY_BACKOFF_MS,
} = {}) {
  const entries = new Map();
  const ent = (id) => {
    let e = entries.get(id);
    if (!e) { e = { pending: null, running: null, nextAt: 0, failures: 0, timer: null, status: { state: 'saved', at: null, reason: null } }; entries.set(id, e); }
    return e;
  };
  const setStatus = (id, e, status) => {
    const same = e.status.state === status.state && e.status.at === status.at && e.status.reason === status.reason;
    e.status = status;
    if (!same) onStatus(id, { ...status });
  };

  function arm(id, e) {
    if (e.running || !e.pending) return;
    clearTimer(e.timer); e.timer = null;
    const wait = e.nextAt - now();
    if (wait <= 0) { attempt(id, e); return; }
    e.timer = setTimer(() => { e.timer = null; attempt(id, e); }, wait);
  }

  function attempt(id, e) {
    if (e.running || !e.pending) return e.running || Promise.resolve();
    clearTimer(e.timer); e.timer = null;
    const payload = e.pending; e.pending = null;
    setStatus(id, e, { state: 'saving', at: e.status.at, reason: null });
    e.running = (async () => {
      try {
        await write(id, payload);
        e.failures = 0; e.nextAt = now() + intervalMs;
        if (!e.pending) await dropLocal(id);
        setStatus(id, e, { state: e.pending ? 'saving' : 'saved', at: now(), reason: null });
        onWritten(id);
      } catch (err) {
        if (!e.pending) e.pending = payload; // a newer payload that arrived meanwhile supersedes it; otherwise this one is retried
        e.failures++; e.nextAt = now() + backoffMs[Math.min(e.failures, backoffMs.length) - 1];
        setStatus(id, e, { state: 'failed', at: e.status.at, reason: describeError(err) });
      } finally { e.running = null; }
      arm(id, e);
    })();
    return e.running;
  }

  return {
    /** Remember the newest payload, keep it on this device, schedule the Drive write. Rejects only when the LOCAL copy could not be kept. */
    async queue(id, payload) {
      const e = ent(id);
      e.pending = payload;
      if (e.status.state !== 'failed') setStatus(id, e, { state: 'saving', at: e.status.at, reason: null });
      await keepLocal(id, payload);
      arm(id, e);
    },
    /** Write now (all designs, or just `id`). */
    async flush(id) {
      const ids = id ? [id] : [...entries.keys()];
      for (const k of ids) {
        const e = entries.get(k); if (!e) continue;
        if (e.running) await e.running;
        if (e.pending) { e.nextAt = 0; await attempt(k, e); }
      }
    },
    /** A design was loaded / created: when it was last known saved on Drive (shown in the status line). */
    seed(id, at) { const e = ent(id); if (!e.pending && !e.running) e.status = { state: 'saved', at, reason: null }; },
    /** The design is gone (deleted): never write it again. */
    cancel(id) { const e = entries.get(id); if (!e) return; clearTimer(e.timer); entries.delete(id); },
    status(id) { const e = entries.get(id); return e ? { ...e.status } : { state: 'saved', at: null, reason: null }; },
    hasPending(id) { const e = entries.get(id); return !!(e && (e.pending || e.running)); },
  };
}
