// packages/ui/diagnostic-log.js — the shared DIAGNOSTIC LOG OVERLAY (DIAG-OVERLAY).
//
// Half this bridge already existed: tests/harness/sketch.js's own header names the intent —
// "a user hits Copy/export in the app, and the exact failing sketch replays here." This module is
// the other half: a phone has no devtools, so every mobile-only bug this session (canvas vibration,
// address-bar sizing, touch select/drag, pinch-zoom) had to be reasoned from source rather than
// observed. This taps the EXISTING dbg.* stream (dozens of call sites already exist across
// input-manager/input-handlers/svg-renderer/core) plus window.onerror/unhandledrejection/
// console.error (raw exceptions never route through dbg), a short touch/pointer trace, and
// serializeDocument()'s output, into one Copy button whose blob a Node harness can actually replay.
//
// CAPTURE STARTS THE MOMENT THIS MODULE IS IMPORTED (a module-level side effect, not gated behind
// opening the overlay) — the whole point is catching "it just happened" bugs the user didn't know to
// prepare for. Console printing is UNCHANGED (still gated by #core/debug.js's own category/level
// switches); this only adds a second, always-on destination.
//
// NOT the same thing as apps/sketchstudio/debug-overlay.js (the spring/joint-label VISUAL overlay) —
// confirmed different before building this, per the dispatch's own explicit warning.

import { setDebugSink } from '#core/debug.js';
import { serializeDocument } from '#core/document.js';
import { buildJournal, DEFAULT_JOURNAL_MAX_BYTES } from '#core/journal.js'; // TASK 507: the ordered, replayable ops journal
import SettingsManager from '#core/settings-manager.js'; // TASK 591: the report header lists the settings that differ from their defaults
import { buildCompactReport } from '#ui/report-compact.js'; // TASK 591: the compact report ("Copy Report")
import { browserFileSeam } from '#ui/project-file.js'; // TASK 544: the app's shared file-save helper (the Download fallback)

const MAX_LOG_ENTRIES = 300;
const MAX_TOUCH_EVENTS = 300; // TASK 507: pointer + key + wheel events share this ring (was 60 pointer events)
const POINTERMOVE_THROTTLE_MS = 100; // pointermove fires far more often than pointerdown/up; without
// this a single drag gesture would evict every OTHER event from the trace before the buffer wraps.

// ── module-level capture state (installed once per page load, before any overlay is ever opened) ──
const logBuffer = [];
// TASK 544: every warn/error entry also goes in its own ring (same entry object), so the REPORT keeps it however far the busy 300-entry
// ring has since wrapped. The in-app log view still reads logBuffer only.
const MAX_ALERT_ENTRIES = 200;
const alertBuffer = [];
const touchBuffer = [];
let lastPointerMoveT = 0;
let lastWheelT = 0;
let captureInstalled = false;

function safeArg(a) {
  if (a instanceof Error) return { error: true, message: a.message, stack: a.stack };
  if (typeof Element !== 'undefined' && a instanceof Element) return `<${a.tagName.toLowerCase()}${a.id ? '#' + a.id : ''}>`;
  if (typeof a === 'function') return '[Function]';
  if (a && typeof a === 'object') { try { JSON.stringify(a); return a; } catch (_) { return String(a); } }
  return a;
}

// TASK 429: CONSECUTIVE identical entries (same kind, category, level and args) collapse into ONE entry that carries a
// structured repeat count — {t: first, tLast: last, count} — so a per-frame log can never flood the buffer and evict the
// errors/events around it. A different entry in between breaks the run. The count is DATA (the copied report stays pure
// JSON with a numeric "count"); the on-screen "×N" is display only (render()).
let lastKey = null; // identity of the newest entry, kept out of the entry so the report has no private fields
function pushLog(kind, category, level, args) {
  const safe = args.map(safeArg);
  const now = Date.now();
  const key = JSON.stringify([kind, category, level, safe]);
  const last = logBuffer[logBuffer.length - 1];
  if (last && key === lastKey) { last.count++; last.tLast = now; return; }
  lastKey = key;
  const entry = { t: now, tLast: now, count: 1, kind, category, level, args: safe };
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOG_ENTRIES) logBuffer.shift();
  if (level === 'warn' || level === 'error') { alertBuffer.push(entry); if (alertBuffer.length > MAX_ALERT_ENTRIES) alertBuffer.shift(); }
}

function pushTouch(e) {
  if (e.type === 'pointermove') {
    const now = Date.now();
    if (now - lastPointerMoveT < POINTERMOVE_THROTTLE_MS) return;
    lastPointerMoveT = now;
  }
  touchBuffer.push({
    t: Date.now(), type: e.type,
    x: Math.round(e.clientX), y: Math.round(e.clientY),
    pointerType: e.pointerType || 'unknown',
    target: e.target && (e.target.id || e.target.tagName || '?'),
  });
  if (touchBuffer.length > MAX_TOUCH_EVENTS) touchBuffer.shift();
}

// TASK 507: key presses, in order. The CONTENTS of text/number inputs are never recorded: a printable character typed into an
// input/textarea/select/contentEditable is stored as 'char'; named keys (Enter, Escape, Backspace, Delete, arrows, ...) and every key
// pressed on the canvas keep their name, with the ctrl/shift/alt flags.
function pushKey(e) {
  const tgt = e.target;
  const editable = !!(tgt && (tgt.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tgt.tagName || '')));
  const key = editable && e.key && e.key.length === 1 ? 'char' : e.key;
  touchBuffer.push({ t: Date.now(), type: 'keydown', key, ctrl: !!(e.ctrlKey || e.metaKey), shift: !!e.shiftKey, alt: !!e.altKey, inInput: editable });
  if (touchBuffer.length > MAX_TOUCH_EVENTS) touchBuffer.shift();
}
// wheel events, coarse: deltaY rounded to the nearest 50 and throttled like pointermove, so a scroll burst is a few entries.
function pushWheel(e) {
  const now = Date.now();
  if (now - lastWheelT < POINTERMOVE_THROTTLE_MS) return;
  lastWheelT = now;
  touchBuffer.push({ t: now, type: 'wheel', deltaY: Math.round(e.deltaY / 50) * 50, ctrl: !!(e.ctrlKey || e.metaKey), x: Math.round(e.clientX), y: Math.round(e.clientY) });
  if (touchBuffer.length > MAX_TOUCH_EVENTS) touchBuffer.shift();
}

function installCapture() {
  if (captureInstalled || typeof window === 'undefined') return;
  captureInstalled = true;

  setDebugSink(({ category, level, args }) => pushLog('dbg', category, level, args));

  window.addEventListener('error', (e) => {
    pushLog('error', 'window.onerror', 'error', [e.message, `${e.filename}:${e.lineno}:${e.colno}`, e.error && e.error.stack]);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    pushLog('error', 'unhandledrejection', 'error', [r && (r.message || String(r)), r && r.stack]);
  });
  try {
    const origError = console.error.bind(console);
    console.error = (...args) => { pushLog('console', 'console.error', 'error', args); origError(...args); };
  } catch (_) { /* console.error non-configurable in some environments — best-effort */ }

  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
    document.addEventListener(type, pushTouch, { capture: true, passive: true });
  }
  document.addEventListener('keydown', pushKey, { capture: true, passive: true });
  document.addEventListener('wheel', pushWheel, { capture: true, passive: true });
}
installCapture();

// ── the Copy blob ────────────────────────────────────────────────────────────────────────────────
function rectOf(sel) {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
}

// ── TASK 544: the REPORT is trimmed to what a human/agent needs; the in-app log view and the buffers are NOT.
// Kept whole: app/url/ua/viewport, document, journal, every warn/error entry however old. Trimmed: `log` to the last
// REPORT_LOG_KEEP meaningful entries, `touchTrace` to the last REPORT_TOUCH_KEEP events; consecutive noise / pointermove runs collapse
// into one summary; `trimmed` says what was dropped, so nothing is silently lost. "Save full report" skips all of this.
export const REPORT_LOG_KEEP = 50;
export const REPORT_TOUCH_KEEP = 30;
// The NOISE categories, as DATA: per-event / per-redraw dbg lines that say "something happened" but carry nothing a reader needs.
// An entry is noise when its category matches and its first argument starts with `message`. warn/error entries are never noise.
export const REPORT_NOISE = [
  { category: 'selection', message: '[selection-tools] pointerMove' },
  { category: 'selection', message: '[selection-tools] bestVisible check' },
  { category: 'renderer', message: 'constraints' },        // {total, visible} on every redraw
  { category: 'joints', message: '[input-manager] hit detection' },
  { category: 'solver', message: 'converged in' },          // one line per solve
  { category: 'snap', message: '[ug.snap]' },
  { category: 'snap', message: '[SNAP CHECK]' },
  { category: 'magnifier', message: 'focus' },
];
const isNoise = (e) => e.level !== 'warn' && e.level !== 'error' && REPORT_NOISE.some((n) => n.category === e.category && typeof e.args[0] === 'string' && e.args[0].startsWith(n.message));
const noiseKey = (e) => `[${e.category}] ${typeof e.args[0] === 'string' ? e.args[0] : ''}`.trim();
const bump = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };

export function trimLog(log) {
  const total = log.reduce((a, e) => a + (e.count || 1), 0);
  const meaningful = []; log.forEach((e, i) => { if (!isNoise(e)) meaningful.push(i); });
  const cutoff = meaningful.length > REPORT_LOG_KEEP ? meaningful[meaningful.length - REPORT_LOG_KEEP] : 0;
  const droppedOld = {}, noiseCollapsed = {};
  const out = []; let run = null;
  const flush = () => {
    if (!run) return;
    const parts = Object.entries(run.keys).map(([k, n]) => `${n} × ${k}`);
    out.push({ t: run.t, tLast: run.tLast, count: run.count, kind: 'noise-summary', category: 'noise', level: 'log', args: [parts.join(', ')] });
    run = null;
  };
  log.forEach((e, i) => {
    const n = e.count || 1;
    if (i < cutoff) { if (e.level === 'warn' || e.level === 'error') out.push(e); else bump(droppedOld, e.category, n); return; }
    if (isNoise(e)) {
      if (!run) run = { t: e.t, tLast: e.tLast, count: 0, keys: {} };
      run.count += n; run.tLast = e.tLast; bump(run.keys, noiseKey(e), n); bump(noiseCollapsed, e.category, n);
    } else { flush(); out.push(e); }
  });
  flush();
  return { log: out, trimmed: { total, keptEntries: out.length, droppedOld, noiseCollapsed } };
}

// consecutive pointermoves -> the first event (with count) and the last event of the run; then the last REPORT_TOUCH_KEEP items.
export function trimTouchTrace(trace) {
  const items = [];
  for (let i = 0; i < trace.length;) {
    const e = trace[i];
    if (e.type !== 'pointermove') { items.push(e); i++; continue; }
    let j = i; while (j + 1 < trace.length && trace[j + 1].type === 'pointermove') j++;
    items.push(j > i ? { ...e, count: j - i + 1 } : e);
    if (j > i) items.push({ ...trace[j], runEnd: true });
    i = j + 1;
  }
  const tail = items.slice(-REPORT_TOUCH_KEEP);
  const droppedOld = {};
  for (const e of items.slice(0, items.length - tail.length)) bump(droppedOld, e.type, e.count || 1);
  return { touchTrace: tail, trimmed: { total: trace.length, keptItems: tail.length, droppedOld, collapsedMoves: items.reduce((a, e) => a + (e.count ? e.count - 2 : 0), 0) } };
}

// the live log plus the warn/error entries the live ring has already dropped, oldest first
function reportLogEntries() {
  const live = new Set(logBuffer);
  return alertBuffer.filter((e) => !live.has(e)).concat(logBuffer);
}

// TASK 591: what only the live state knows (the compact report's header reads it): the active tool, what is selected (ids, at most 20
// each), the undo / redo depths and the undo labels. null for a host without a state.
const SESSION_MAX_IDS = 20;
const idOf = (x) => (x && typeof x === 'object' ? (x.id ?? x.type ?? null) : x);
const idsOf = (set) => (set instanceof Set ? [...set].slice(0, SESSION_MAX_IDS).map(idOf) : null);
function sessionOf(state) {
  if (!state) return null;
  const history = Array.isArray(state.history) ? state.history : [];
  return {
    tool: state.currentTool ?? null,
    selection: { joints: idsOf(state.selectedJoints), shapes: idsOf(state.selectedShapes), constraints: idsOf(state.selectedConstraints) },
    undoDepth: history.length, redoDepth: Array.isArray(state.redoStack) ? state.redoStack.length : 0,
    undoLabels: history.map((s) => s.label ?? null),
  };
}

// TASK 591: every user setting whose value differs from its default (display + behaviour: DOC_UNIT, SHOW_GRID, AXIS_SNAP,
// BACKGROUND, STYLE_TEMPLATE ...), { KEY: value }. Settings only; the manager holds no personal data.
export function changedSettings() {
  const defaults = SettingsManager.getDefaults(), out = {};
  for (const k of Object.keys(defaults)) { const v = SettingsManager.get(k); if (JSON.stringify(v) !== JSON.stringify(defaults[k])) out[k] = v; }
  return out;
}

export function buildReport({ appId, getState, journalMaxBytes = DEFAULT_JOURNAL_MAX_BYTES, full = false }) {
  const vv = window.visualViewport;
  let doc = null;
  let journal = null, journalError, session = null;
  try {
    const state = typeof getState === 'function' ? getState() : getState;
    session = sessionOf(state);
    if (state) doc = serializeDocument(state);
    // TASK 507: the ordered journal (base + one patch per undo step + the undone steps); null when the host has no state.
    if (state) {
      try { journal = buildJournal(state.history || [], state, { redoStack: state.redoStack || [], maxBytes: journalMaxBytes }); }
      catch (err) { journalError = String(err && err.stack || err); } // a report whose journal failed is still useful: say why
    }
  } catch (_) { /* best-effort — a report with no document is still useful */ }
  const tl = full ? null : trimLog(reportLogEntries()), tt = full ? null : trimTouchTrace(touchBuffer);
  return {
    app: appId, url: location.href, ua: navigator.userAgent, t: new Date().toISOString(),
    viewport: {
      innerWidth: window.innerWidth, innerHeight: window.innerHeight,
      visualViewport: vv ? { width: vv.width, height: vv.height, offsetLeft: vv.offsetLeft, offsetTop: vv.offsetTop, scale: vv.scale } : null,
      scrollX: window.scrollX, scrollY: window.scrollY,
      devicePixelRatio: window.devicePixelRatio,
      rects: { canvas: rectOf('svg[id$="-canvas"], #svgCanvas'), ribbon: rectOf('.sk-ribbon, #design-ribbon, #sketch-ribbon, #toolsRibbon'), header: rectOf('header') },
    },
    touchTrace: full ? touchBuffer.slice() : tt.touchTrace,
    log: full ? reportLogEntries() : tl.log,
    // The killer feature: whatever the app IS right now, in the exact shape tests/harness/sketch.js's
    // load() already accepts — a phone bug becomes an exactly-replayable Node scenario, not a description.
    document: doc,
    journal,
    session,
    settings: changedSettings(),
    ...(journalError ? { journalError } : {}),
    trimmed: full ? null : { log: tl.trimmed, touchTrace: tt.trimmed },
  };
}

// TASK 544: the text that goes on the clipboard / into the downloaded file: the WHOLE report as MINIFIED JSON (one line, so pasting
// it into a chat is one paste). JSON.parse of it deep-equals the report.
export function reportToText(report) { return JSON.stringify(report); }
// TASK 591: "Copy Report" copies THIS: the compact report built from the untrimmed full one (see packages/ui/report-compact.js).
// "Save full report" writes buildReport({ full: true }) untouched, so nothing is lost.
export function buildCompactReportFor(opts) { return buildCompactReport(buildReport({ ...opts, full: true })); }
export function formatBytes(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B'; }

// ── overlay UI (mirrors style-panel.js's open/close idiom for consistency) ─────────────────────────
let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined' || !document.head) return;
  if (document.getElementById('sk-diag-styles')) { stylesInjected = true; return; }
  const s = document.createElement('style');
  s.id = 'sk-diag-styles';
  s.textContent = `
.sk-diag-panel { position: fixed; inset: 0; z-index: 20000; display: flex; flex-direction: column;
  background: var(--sk-style-bg, #fff); color: var(--sk-style-fg, #1e293b); font: 12px system-ui, sans-serif; }
.sk-diag-panel.sk-hidden { display: none; }
.sk-diag-head { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--sk-style-sep, #e2e8f0); flex: 0 0 auto; }
.sk-diag-title { font-weight: 700; font-size: 13px; }
.sk-diag-spacer { flex: 1; }
.sk-diag-btn { padding: 5px 12px; border-radius: 6px; border: 1px solid var(--sk-style-sep, #cbd5e1); background: transparent; color: inherit; cursor: pointer; font: inherit; }
.sk-diag-btn-primary { background: #2563eb; color: #fff; border-color: transparent; font-weight: 600; }
.sk-diag-close { background: none; border: 0; cursor: pointer; font-size: 18px; line-height: 1; color: inherit; opacity: 0.7; }
.sk-diag-body { flex: 1 1 auto; overflow: auto; padding: 10px 14px; }
.sk-diag-entry { padding: 3px 0; border-bottom: 1px solid rgba(127,127,127,0.12); font-family: ui-monospace, monospace; font-size: 11px; white-space: pre-wrap; word-break: break-word; }
.sk-diag-entry.err { color: #dc2626; }
.sk-diag-empty { opacity: 0.55; font-style: italic; padding: 20px 0; text-align: center; }
.sk-diag-status { font-size: 11px; opacity: 0.75; min-width: 0; }
.sk-diag-head { flex-wrap: wrap; }
.sk-diag-btn.sk-hidden { display: none; }
.sk-diag-toggle { background: transparent; border: 1px solid currentColor; opacity: 0.7; border-radius: 6px; padding: 4px 10px; font: 12px system-ui, sans-serif; cursor: pointer; color: inherit; }
.sk-diag-toggle:hover { opacity: 1; }
@media (pointer: coarse) { .sk-diag-toggle { min-height: 44px; min-width: 44px; white-space: nowrap; } } /* TASK 581: a finger */
`;
  document.head.appendChild(s);
  stylesInjected = true;
}

/**
 * createDiagnosticLog({ appId, state }) → { toggleEl, open, close, toggle, destroy }
 *   appId: short id for the report (e.g. 'shaper').
 *   state: OPTIONAL — the live sketch state (or a `() => state` getter, for a host whose sketcher
 *     mounts lazily after the overlay itself is created), so the Copy blob includes
 *     serializeDocument(state). Omit entirely (or return a falsy value from the getter) and the
 *     report's document comes back null — everything else (log/errors/touch/viewport) still works.
 */
export function createDiagnosticLog({ appId, state } = {}) {
  injectStyles();

  const el = document.createElement('div'); el.className = 'sk-diag-panel sk-hidden';
  const head = document.createElement('div'); head.className = 'sk-diag-head';
  const title = document.createElement('span'); title.className = 'sk-diag-title'; title.textContent = 'Diagnostic Log';
  const status = document.createElement('span'); status.className = 'sk-diag-status';
  const spacer = document.createElement('span'); spacer.className = 'sk-diag-spacer';
  const clearBtn = document.createElement('button'); clearBtn.type = 'button'; clearBtn.className = 'sk-diag-btn'; clearBtn.textContent = 'Clear';
  const copyBtn = document.createElement('button'); copyBtn.type = 'button'; copyBtn.className = 'sk-diag-btn sk-diag-btn-primary'; copyBtn.textContent = 'Copy Report';
  const copyFullBtn = document.createElement('button'); copyFullBtn.type = 'button'; copyFullBtn.className = 'sk-diag-btn'; copyFullBtn.textContent = 'Save full report';
  const downloadBtn = document.createElement('button'); downloadBtn.type = 'button'; downloadBtn.className = 'sk-diag-btn sk-diag-download sk-hidden'; downloadBtn.textContent = 'Download report (.json)';
  const closeBtn = document.createElement('button'); closeBtn.type = 'button'; closeBtn.className = 'sk-diag-close'; closeBtn.textContent = '✕';
  head.append(title, status, spacer, clearBtn, copyFullBtn, copyBtn, downloadBtn, closeBtn);

  const body = document.createElement('div'); body.className = 'sk-diag-body';
  el.append(head, body);

  function render() {
    body.innerHTML = '';
    const all = logBuffer.slice().reverse();
    if (!all.length) { body.appendChild(Object.assign(document.createElement('div'), { className: 'sk-diag-empty', textContent: 'No log entries yet.' })); return; }
    for (const e of all) {
      const row = document.createElement('div');
      row.className = 'sk-diag-entry' + (e.level === 'error' ? ' err' : '');
      const time = new Date(e.t).toLocaleTimeString();
      const argsStr = e.args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
      const runLabel = e.count > 1 ? ` ×${e.count} (to ${new Date(e.tLast).toLocaleTimeString()})` : ''; // display only; the data is e.count
      row.textContent = `${time}${runLabel} [${e.kind}/${e.category}] ${argsStr}`;
      body.appendChild(row);
    }
    status.textContent = `${logBuffer.length} entries · ${touchBuffer.length} touch events`;
  }

  clearBtn.addEventListener('click', () => { logBuffer.length = 0; alertBuffer.length = 0; lastKey = null; touchBuffer.length = 0; render(); });

  // TASK 544: ONE click puts the whole report on the clipboard as minified JSON. The confirmation (size) and any failure go in the
  // panel's status line; on failure the "Download report (.json)" button appears (same text, through the shared file-save helper).
  let lastText = null, copiedTimer = null;
  async function copyReport() {
    const text = reportToText(buildCompactReportFor({ appId, getState: state }));
    lastText = text;
    const size = formatBytes(new TextEncoder().encode(text).length);
    let failure = null;
    if (!(navigator.clipboard && navigator.clipboard.writeText)) failure = 'the clipboard is not available here (insecure context?)';
    else {
      try { await navigator.clipboard.writeText(text); }
      catch (err) { failure = (err && err.message) || String(err); }
    }
    if (!failure) {
      downloadBtn.classList.add('sk-hidden');
      status.textContent = `Copied ${size} report`;
      copyBtn.textContent = 'Copied!'; clearTimeout(copiedTimer); copiedTimer = setTimeout(() => { copyBtn.textContent = 'Copy Report'; }, 1500);
      return;
    }
    clearTimeout(copiedTimer); copyBtn.textContent = 'Copy Report';
    status.textContent = `Copy failed (${failure}): download the ${size} report instead`;
    downloadBtn.classList.remove('sk-hidden');
  }
  // `full`: the untouched buildReport({ full: true }) as a file ("Save full report"); otherwise the last copied compact text (the fallback
  // after a rejected clipboard write).
  async function downloadReport(full) {
    const text = full ? reportToText(buildReport({ appId, getState: state, full: true })) : (lastText != null ? lastText : reportToText(buildCompactReportFor({ appId, getState: state })));
    const name = `sketch-studio-${full ? 'full-' : ''}report-${appId || 'app'}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    try {
      const r = await browserFileSeam.save(text, name);
      status.textContent = r ? `Saved ${r.name}` : 'Download cancelled';
    } catch (err) { status.textContent = `Download failed: ${(err && err.message) || err}`; }
  }
  downloadBtn.addEventListener('click', () => { downloadReport(false); });
  copyBtn.addEventListener('click', () => { copyReport(); });
  copyFullBtn.addEventListener('click', () => { downloadReport(true); });

  let isOpen = false, escHandler = null;
  function open() {
    if (isOpen) return;
    isOpen = true; el.classList.remove('sk-hidden'); render();
    escHandler = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', escHandler);
  }
  function close() {
    if (!isOpen) return;
    isOpen = false; el.classList.add('sk-hidden');
    if (escHandler) { document.removeEventListener('keydown', escHandler); escHandler = null; }
  }
  function toggle() { isOpen ? close() : open(); }
  closeBtn.addEventListener('click', () => close());

  const toggleEl = document.createElement('button');
  toggleEl.type = 'button'; toggleEl.className = 'sk-diag-toggle'; toggleEl.title = 'Diagnostic log';
  toggleEl.textContent = '🐞 Log';
  toggleEl.addEventListener('click', () => toggle());

  document.body.appendChild(el);

  return {
    toggleEl, open, close, toggle,
    destroy: () => { close(); try { toggleEl.remove(); } catch (_) {} try { el.remove(); } catch (_) {} },
  };
}
