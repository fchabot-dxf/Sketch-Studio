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

const MAX_LOG_ENTRIES = 300;
const MAX_TOUCH_EVENTS = 300; // TASK 507: pointer + key + wheel events share this ring (was 60 pointer events)
const POINTERMOVE_THROTTLE_MS = 100; // pointermove fires far more often than pointerdown/up; without
// this a single drag gesture would evict every OTHER event from the trace before the buffer wraps.

// ── module-level capture state (installed once per page load, before any overlay is ever opened) ──
const logBuffer = [];
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
  logBuffer.push({ t: now, tLast: now, count: 1, kind, category, level, args: safe });
  if (logBuffer.length > MAX_LOG_ENTRIES) logBuffer.shift();
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

export function buildReport({ appId, getState, journalMaxBytes = DEFAULT_JOURNAL_MAX_BYTES }) {
  const vv = window.visualViewport;
  let doc = null;
  let journal = null, journalError;
  try {
    const state = typeof getState === 'function' ? getState() : getState;
    if (state) doc = serializeDocument(state);
    // TASK 507: the ordered journal (base + one patch per undo step + the undone steps); null when the host has no state.
    if (state) {
      try { journal = buildJournal(state.history || [], state, { redoStack: state.redoStack || [], maxBytes: journalMaxBytes }); }
      catch (err) { journalError = String(err && err.stack || err); } // a report whose journal failed is still useful: say why
    }
  } catch (_) { /* best-effort — a report with no document is still useful */ }
  return {
    app: appId, url: location.href, ua: navigator.userAgent, t: new Date().toISOString(),
    viewport: {
      innerWidth: window.innerWidth, innerHeight: window.innerHeight,
      visualViewport: vv ? { width: vv.width, height: vv.height, offsetLeft: vv.offsetLeft, offsetTop: vv.offsetTop, scale: vv.scale } : null,
      scrollX: window.scrollX, scrollY: window.scrollY,
      devicePixelRatio: window.devicePixelRatio,
      rects: { canvas: rectOf('svg[id$="-canvas"], #svgCanvas'), ribbon: rectOf('.sk-ribbon, #design-ribbon, #sketch-ribbon, #toolsRibbon'), header: rectOf('header') },
    },
    touchTrace: touchBuffer.slice(),
    log: logBuffer.slice(),
    // The killer feature: whatever the app IS right now, in the exact shape tests/harness/sketch.js's
    // load() already accepts — a phone bug becomes an exactly-replayable Node scenario, not a description.
    document: doc,
    journal,
    ...(journalError ? { journalError } : {}),
  };
}

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
.sk-diag-status { font-size: 11px; opacity: 0.75; }
.sk-diag-fallback { width: 100%; height: 120px; margin-top: 8px; font-family: ui-monospace, monospace; font-size: 10px; }
.sk-diag-toggle { background: transparent; border: 1px solid currentColor; opacity: 0.7; border-radius: 6px; padding: 4px 10px; font: 12px system-ui, sans-serif; cursor: pointer; color: inherit; }
.sk-diag-toggle:hover { opacity: 1; }
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
  const closeBtn = document.createElement('button'); closeBtn.type = 'button'; closeBtn.className = 'sk-diag-close'; closeBtn.textContent = '✕';
  head.append(title, status, spacer, clearBtn, copyBtn, closeBtn);

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

  clearBtn.addEventListener('click', () => { logBuffer.length = 0; lastKey = null; touchBuffer.length = 0; render(); });

  async function copyReport() {
    const report = buildReport({ appId, getState: state });
    const text = JSON.stringify(report, null, 1);
    let ok = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); ok = true; }
    } catch (_) { /* fall through to the textarea fallback below */ }
    if (ok) { copyBtn.textContent = 'Copied!'; setTimeout(() => { copyBtn.textContent = 'Copy Report'; }, 1500); return; }
    // Fallback: a selectable textarea (clipboard can be blocked, e.g. no user-gesture context, or an
    // insecure origin) — the user can still select-all/copy manually.
    let ta = body.querySelector('.sk-diag-fallback');
    if (!ta) { ta = document.createElement('textarea'); ta.className = 'sk-diag-fallback'; ta.readOnly = true; body.prepend(ta); }
    ta.value = text;
    ta.focus(); ta.select();
    copyBtn.textContent = 'Select & copy below';
  }
  copyBtn.addEventListener('click', () => { copyReport(); });

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
