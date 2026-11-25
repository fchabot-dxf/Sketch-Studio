// apps/shaper/src/shaperhub-target.js — TASK 884 (owner turns 3591-3597): "Keep ShaperHub up to date". After a design was sent to ShaperHub once, the Sync
// dialog's switch makes every Generate REPLACE that same file there, without opening the dialog. What is declared here, once:
//   the SETTING: a device setting, kept in this browser's localStorage like Shaper's other device settings (modes.js MODE_KEY 'shaper-mode', shaper-app.js
//     'shaper-review-view' / 'shaper-review-look'); ON by default (TASK 886, owner turn 3645: "Autoresend on by default"); a stored choice is kept;
//   the TARGETS: per TICKED-OPERATION SET of the design shown (advisor, task 884: the exported file holds the ticked operations only, task 798, while its name is
//     the design's; so a Generate with other ticks must never replace the file of another set), the file + folder of that set's LAST successful send: a record
//     { <set key>: { filename, remotePath } } (export-payload.js tickedSetKey: 'all' when every operation is ticked, else the ticked operations' ids); {} = never sent. Kept with
//     the design: the website's document (shaper-doc.js captureShaperDoc / applyShaperDoc, `hubTargets`) and the Fusion design's project (fusion-bridge.js
//     captureFusionProject / applyFusionProject, `hubTargets`), the same way in both; set by the dialog's sends (shaper-app.js sendToShaperHub, from the server's
//     answer: targetOfSend);
//   what a Generate does with it (autoSendDecision), what the switch shows (keepSwitchView), and the queue of ONE replace (createReplaceQueue).
// The replace itself is sent by shaper-app.js through its ONE request path (callShaperHub: mode 'replace' carries the login, shaper-cloud.js THE REPLACE RULE).
import { normalizeRemotePath } from '#core/shaper-cloud.js';
import { hintText } from './param-hints.js';

export const KEEP_HUB_KEY = 'shaper-keep-hub-up-to-date'; // '1' = on, '0' = off; no entry = on (the default, TASK 886)
/** Whether the switch is on, in `storage` (the page's localStorage). */
export const keepHubOn = (storage) => storage.getItem(KEEP_HUB_KEY) !== '0';
/** Turns the switch on / off in `storage`. */
export function setKeepHub(storage, on) {
  storage.setItem(KEEP_HUB_KEY, on ? '1' : '0');
}

/** A folder as the dialog names it: My Files, or My Files/<sub>/<folder>. */
export const folderPlace = (path) => (!path || path === '/' ? 'My Files' : `My Files${path.slice(0, -1)}`);

let targets = {}; // set key -> { filename, remotePath }

/** The design's targets ({ <set key>: { filename, remotePath } }, a copy; {} = never sent). */
export const getHubTargets = () => Object.fromEntries(Object.entries(targets).map(([k, t]) => [k, { ...t }]));
/** Replaces the design's targets (a stored record: plain JSON; an entry that is not a valid target is left out). */
export function setHubTargets(rec) {
  targets = {};
  if (rec && typeof rec === 'object' && !Array.isArray(rec)) for (const [k, t] of Object.entries(rec)) { const v = asHubTarget(t); if (v) targets[k] = v; }
  return getHubTargets();
}
/** The target of the set `key` ({ filename, remotePath }) or null. */
export const getHubTarget = (key) => (Object.hasOwn(targets, key) ? { ...targets[key] } : null);
/** Sets the target of the set `key` (anything that is not a valid target: none, that set's entry removed). Returns it. */
export function setHubTarget(key, t) {
  const v = asHubTarget(t);
  if (v) targets[key] = v; else delete targets[key];
  return v ? { ...v } : null;
}
// a valid target, in the server's folder form, or null (a stored value is read through here: a document holds plain JSON)
function asHubTarget(t) {
  if (!t || typeof t !== 'object' || typeof t.filename !== 'string' || !t.filename.trim()) return null;
  const raw = t.remotePath == null ? '/' : String(t.remotePath);
  if (raw.split(/[\\/]+/).includes('..') || /[\x00-\x1f]/.test(raw)) return null; // normalizeRemotePath's refusals, checked first (it throws on them)
  return { filename: t.filename, remotePath: normalizeRemotePath(raw) };
}

/** The target a send's answer makes (packages/core/shaper-cloud.js THE REQUEST CONTRACT): 'sent' / 'replaced' -> that file (Keep both: the NEW name the server
 *  answered) in the folder the server answered for (else `remotePath`, the folder asked); an 'exists' question or an error -> null (nothing was sent). */
export function targetOfSend(data, remotePath) {
  if (!data || data.error || (data.status !== 'sent' && data.status !== 'replaced')) return null;
  return asHubTarget({ filename: data.filename, remotePath: data.remotePath || remotePath || '/' });
}

/** What a Generate does: 'off' (the switch is off), 'no-target' (these ticked operations were never sent), 'no-login' (no sign-in this session), 'send' (replace the target). */
export function autoSendDecision({ on, target: t, signedIn }) {
  if (!on) return 'off';
  if (!t) return 'no-target';
  if (!signedIn) return 'no-login';
  return 'send';
}

/** The switch as the dialog shows it: { checked, disabled, hint }. It can be changed only while signed in (shaper-app.js signedIn: this session's sign-in, or TASK 886's login kept on this computer). */
export function keepSwitchView({ on, signedIn, target: t }) {
  return {
    checked: !!on,
    disabled: !signedIn,
    hint: hintText('keepHubUpToDate', { signedIn: !!signedIn, name: t ? t.filename : '', place: t ? folderPlace(t.remotePath) : '' }),
  };
}

/**
 * createReplaceQueue(run) — the replaces after a Generate, ONE at a time: push(key, job) runs `run(job)` at once when none runs; while one runs, the job WAITS, and a
 * later push for the same `key` (the same target file) takes its place: at most ONE waits per file, with the latest svg, and never two replaces run at once. Jobs
 * of different files wait in the order they first came. settled() = a promise of the queue being idle. `run` reports its own result (shaper-app.js: the Export
 * view's status line); a run that throws ends the queue's loop with that error (the promise push returns).
 */
export function createReplaceQueue(run) {
  const waiting = new Map(); // key -> the latest job for that file
  let loop = null;
  function push(key, job) {
    waiting.set(key, job);
    if (!loop) {
      loop = (async () => {
        try {
          while (waiting.size) {
            const [k, next] = waiting.entries().next().value;
            waiting.delete(k);
            await run(next);
          }
        } finally { loop = null; }
      })();
    }
    return loop;
  }
  return { push, busy: () => loop !== null, settled: () => loop || Promise.resolve() };
}
