// apps/shaper/src/fusion-bridge.js — TASK 663: Fusion 360 mode detection and HTML palette message bridge
// (Sketch-Studio half of the Shaper Fusion add-in: SS-1 + SS-2).
//
// Design rules:
// - ONE mode-detection path: the URL query parameter `?host=fusion` (`isFusionMode()`). Never infer Fusion mode from
//   `window.adsk` alone; tests force Fusion mode with `?host=fusion`, while `window.adsk` only gates sending.
// - ONE global registered: `window.fusionJavaScriptHandler` is Fusion 360's palette API (`palette.sendInfoToHTML`) and
//   is the ONLY global installed on `window` by this module.
// - Declared action constants live once here; `D:/APPS/shaper-addin/bridge.py` holds the Python copy (both must change
//   together).

import { dbg } from '#core/debug.js';
import SettingsManager from '#core/settings-manager.js';
import { UNITS } from '#core/units.js';
import { getSelections, onSelectionsChange, selectionRowsOf } from './selection-list.js'; // TASK 795 / 795c: the selection list the Prepare bar shows

export const FUSION_HOST_PARAM = 'host';
export const FUSION_HOST_VALUE = 'fusion';
export const DEFAULT_ADSK_POLL_MS = 200;
export const DEFAULT_ADSK_WAIT_TIMEOUT_MS = 15000;

// Map Fusion 360 `unitsManager.defaultLengthUnits` values to supported app units (`UNITS = ['mm', 'cm', 'in']`).
export const FUSION_UNIT_MAP = Object.freeze({
  mm: 'mm',
  cm: 'cm',
  m: 'cm',
  in: 'in',
  ft: 'in',
});

/**
 * Map a Fusion length unit string (e.g. `'mm'`, `'cm'`, `'m'`, `'in'`, `'ft'`) to an app `DOC_UNIT`
 * from `#core/units.js`, or return `null` when missing/unrecognized.
 */
export function mapFusionLengthUnit(raw) {
  if (typeof raw !== 'string') return null;
  const mapped = FUSION_UNIT_MAP[raw.trim().toLowerCase()];
  return mapped && UNITS.includes(mapped) ? mapped : null;
}

// Message action names (declared once; D:/APPS/shaper-addin/bridge.py holds the matching Python copy — keep both in sync).
// SA-15 / TASK 795c contract: clear_selection { selectionId, group? } / restore_selection { selectionId }
// SA-13 / TASK 799 contract:
//   - toolpaths: { revision, frame: { units, yAxis, originMm, uAxis, vAxis, normal, topHeightMm }, paths: [{ op, cutType, color?, z, points: [[x, y], ...], closed }] }
//   - toolpaths_clear: {}
export const FUSION_ACTIONS = Object.freeze({
  PING: 'ping',
  PONG: 'pong',
  ERROR: 'error',
  ADD_SELECTION: 'add_selection',
  SELECTION_DATA: 'selection_data',
  HIGHLIGHT_SELECTION: 'highlight_selection', // TASK 795 (SA-12): { selectionId | null } brightens one selection's overlay in Fusion (null: all back to their cut-type colours)
  CLEAR_SELECTION: 'clear_selection', // TASK 795 (SA-12 / SA-15): { selectionId, group? } | { selectionId: 'all' }
  RESTORE_SELECTION: 'restore_selection', // TASK 795c (SA-15): { selectionId } restores the cleared token list on Undo
  TOOLPATHS: 'toolpaths', // TASK 799 (SA-13): live bit-centre toolpaths overlay in Fusion
  TOOLPATHS_CLEAR: 'toolpaths_clear', // TASK 799 (SA-13): clears the Fusion toolpaths overlay
});

// Declared 16 px icons per SA-15 summary.items kind (mirrors shaper-addin/resources/kinds/<kind>.png).
const SUMMARY_ITEM_ICONS = Object.freeze({
  body: '<rect x="2.5" y="4" width="9" height="9" rx="1" stroke="currentColor" stroke-width="1.3"/><path d="M4.5 4V2.5h9v9H12" stroke="currentColor" stroke-width="1.3"/>',
  face: '<rect x="2.5" y="2.5" width="11" height="11" rx="1" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="1.3"/>',
  'sloped-face': '<path d="M4.5 3h7l2 10h-11z" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="1.3"/>',
  sketch: '<rect x="2.5" y="2.5" width="11" height="11" rx="1" stroke="currentColor" stroke-width="1.3" stroke-dasharray="2.2 1.5"/>',
  profile: '<path d="M3 3h10v10H3z" fill="currentColor" fill-opacity="0.28" stroke="currentColor" stroke-width="1.3"/>',
  curve: '<path d="M2.5 12.5C5 4 11 12 13.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
});

const KNOWN_ACTIONS = new Set(Object.values(FUSION_ACTIONS));

/**
 * Return true iff the host query parameter enables Fusion mode (`?host=fusion`).
 * Accepts a `Location`-like object or a query/search string so tests can run without `window`.
 */
export function isFusionMode(locationOrSearch = typeof window !== 'undefined' ? window.location : '') {
  const search = typeof locationOrSearch === 'string'
    ? locationOrSearch
    : (locationOrSearch && typeof locationOrSearch.search === 'string' ? locationOrSearch.search : '');
  return new URLSearchParams(search).get(FUSION_HOST_PARAM) === FUSION_HOST_VALUE;
}

function parsePayload(rawData) {
  if (rawData == null || rawData === '') return { ok: true, data: {} };
  if (typeof rawData === 'object') {
    if (Array.isArray(rawData)) return { ok: false, error: 'Expected JSON object payload from Fusion, got array' };
    return { ok: true, data: rawData };
  }
  if (typeof rawData !== 'string') {
    return { ok: false, error: `Expected JSON string or object from Fusion, got ${typeof rawData}` };
  }
  const trimmed = rawData.trim();
  if (!trimmed) return { ok: true, data: {} };
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'Expected JSON object payload from Fusion' };
    }
    return { ok: true, data: parsed };
  } catch (err) {
    return { ok: false, error: `Malformed JSON from Fusion: ${err.message}` };
  }
}

/** The notice of an imported selection: its message, then its warnings in brackets (TASK 790: Open STL shows its slice the same way). */
export const selectionNotice = (message, warnings = []) => (warnings.length ? `${message} (${warnings.join('; ')})` : message);

/**
 * Create the Fusion palette message bridge.
 * Registers `globalTarget.fusionJavaScriptHandler = { handle }` when `globalTarget` is supplied.
 */
export function createFusionBridge({
  globalTarget = (typeof window !== 'undefined' ? window : null),
  onStatus = () => {},
  onNotice = () => {},
  onError = () => {},
  onSelectionData = () => {},
  onMessage = () => {},
} = {}) {
  let lastSelection = null;

  const reportError = (message, detail = null) => {
    const text = String(message || 'Unknown Fusion bridge error');
    dbg.error('fusion', text, detail);
    onError(text, detail);
    return text;
  };

  const canSend = () => Boolean(
    globalTarget && globalTarget.adsk && typeof globalTarget.adsk.fusionSendData === 'function',
  );

  function send(action, payload = {}) {
    if (!KNOWN_ACTIONS.has(action)) {
      reportError(`Unknown outbound Fusion action: ${String(action)}`);
      return { ok: false, reason: 'unknown action' };
    }
    if (!canSend()) {
      const reason = 'Fusion host bridge is unavailable (window.adsk missing)';
      reportError(reason);
      return { ok: false, reason };
    }
    const bodyObj = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? { ...payload, action }
      : { action };
    const body = JSON.stringify(bodyObj);
    try {
      const ret = globalTarget.adsk.fusionSendData(action, body);
      const promise = (ret && typeof ret.then === 'function')
        ? ret.then(undefined, (err) => {
          reportError(`Fusion send failed for ${action}: ${err && err.message ? err.message : String(err)}`);
        })
        : Promise.resolve();
      return { ok: true, action, body, promise };
    } catch (err) {
      reportError(`Fusion send failed for ${action}: ${err && err.message ? err.message : String(err)}`);
      return { ok: false, reason: err && err.message ? err.message : String(err), promise: Promise.resolve() };
    }
  }

  function handle(rawAction, rawData) {
    const parsed = parsePayload(rawData);
    const hintedAction = parsed.ok && parsed.data && typeof parsed.data.action === 'string' && parsed.data.action
      ? parsed.data.action
      : (rawAction || '');
    onMessage(hintedAction);
    if (!parsed.ok) {
      reportError(parsed.error, { rawAction, rawData });
      return 'OK';
    }
    const data = parsed.data;
    const bodyAction = typeof data.action === 'string' && data.action ? data.action : '';
    if (rawAction && bodyAction && rawAction !== bodyAction) {
      reportError(`Fusion action mismatch: ${rawAction} vs ${bodyAction}`, data);
      return 'OK';
    }
    const action = bodyAction || rawAction || '';
    if (!action) {
      reportError('Missing action in Fusion message', data);
      return 'OK';
    }

    if (action === FUSION_ACTIONS.PONG) {
      const docName = typeof data.documentName === 'string' ? data.documentName.trim() : '';
      const mappedUnit = mapFusionLengthUnit(data.lengthUnits);
      // Session-only override: follow the active Fusion document unit without touching persisted user preferences.
      if (mappedUnit) SettingsManager.set('DOC_UNIT', mappedUnit, { persist: false });
      const statusText = docName ? `Connected to Fusion: ${docName}` : 'Connected to Fusion';
      dbg.log('fusion', statusText, { fusionVersion: data.fusionVersion || '', lengthUnits: mappedUnit });
      onStatus(statusText, {
        connected: true,
        documentName: docName,
        fusionVersion: typeof data.fusionVersion === 'string' ? data.fusionVersion : '',
        lengthUnits: mappedUnit,
      });
      return 'OK';
    }

    if (action === FUSION_ACTIONS.ERROR) {
      const recAct = typeof data.receivedAction === 'string' ? data.receivedAction : '';
      if (recAct === FUSION_ACTIONS.TOOLPATHS || recAct === FUSION_ACTIONS.TOOLPATHS_CLEAR) {
        dbg.warn('fusion', `Older add-in ignored ${recAct}`, data);
        return 'OK';
      }
      const msg = (typeof data.message === 'string' && data.message)
        || (typeof data.error === 'string' && data.error)
        || 'Unknown Fusion error';
      reportError(msg, data);
      return 'OK';
    }

    if (action === FUSION_ACTIONS.SELECTION_DATA) {
      lastSelection = data;
      const regionCount = Array.isArray(data.regions) ? data.regions.length : 0;
      const chainCount = Array.isArray(data.chains) ? data.chains.length : 0;
      const srcName = (data.source && data.source.name && String(data.source.name).trim()) || 'selection';
      const res = onSelectionData(data);
      if (res && res.ok === false) {
        const errMsg = res.message || 'Could not import selection';
        dbg.warn('fusion', errMsg, { count: regionCount });
        onError(errMsg);
        return 'OK';
      }
      const warnings = (res && Array.isArray(res.warnings)) ? res.warnings
        : (Array.isArray(data.warnings) ? data.warnings.filter(Boolean).map(String) : []);
      const baseMsg = (res && res.message) || `Added ${srcName}: ${regionCount} regions, ${chainCount} chains`;
      const msg = selectionNotice(baseMsg, warnings);
      dbg.log('fusion', msg, { regions: regionCount, chains: chainCount, warnings });
      onNotice(msg, data);
      return 'OK';
    }

    reportError(`Unknown Fusion action: ${action}`, data);
    return 'OK';
  }

  // Fusion 360 requires `window.fusionJavaScriptHandler.handle(action, data)` for `palette.sendInfoToHTML`.
  if (globalTarget) {
    globalTarget.fusionJavaScriptHandler = { handle };
  }

  return {
    send,
    handle,
    canSend,
    bootPing: () => (canSend() ? send(FUSION_ACTIONS.PING, {}) : { ok: false, reason: 'window.adsk unavailable' }),
    getLastSelection: () => lastSelection,
    destroy: () => {
      if (globalTarget && globalTarget.fusionJavaScriptHandler && globalTarget.fusionJavaScriptHandler.handle === handle) {
        delete globalTarget.fusionJavaScriptHandler;
      }
    },
  };
}

/**
 * Mount the Fusion-mode toolbar in Prepare ("Add selection" button + connection status)
 * and wire bridge messages to visible Prepare UI feedback. Only called in Fusion mode.
 */
export function mountFusionPrepareBar({
  viewPrepareEl,
  noticeEl,
  onSelectionData = () => {},
  onRemoveSelection = () => {}, // TASK 795: (id) the row's X
  onClearSelections = () => {}, // TASK 795: Clear all
  onStatusChange = () => {}, // TASK 799: notified on pong / connection state changes
  globalTarget = (typeof window !== 'undefined' ? window : null),
  pollIntervalMs = DEFAULT_ADSK_POLL_MS,
  waitTimeoutMs = DEFAULT_ADSK_WAIT_TIMEOUT_MS,
}) {
  viewPrepareEl.classList.add('is-fusion');

  const bar = document.createElement('div');
  bar.id = 'shaper-fusion-bar';
  bar.className = 'shaper-fusion-bar';

  const addBtn = document.createElement('button');
  addBtn.id = 'btn-fusion-add-selection';
  addBtn.type = 'button';
  addBtn.className = 'shaper-fusion-btn';
  addBtn.textContent = 'Add selection';

  const statusEl = document.createElement('span');
  statusEl.id = 'shaper-fusion-status';
  statusEl.className = 'shaper-fusion-status';
  statusEl.setAttribute('role', 'status');
  statusEl.setAttribute('aria-live', 'polite');

  // TASK 799 (SA-13): loading wheel shown while live toolpaths are recomputed / debounced / sent / drawn in Fusion.
  const spinEl = document.createElement('span');
  spinEl.id = 'shaper-fusion-spin';
  spinEl.className = 'shaper-fusion-spin';
  spinEl.hidden = true;
  spinEl.setAttribute('role', 'status');
  spinEl.setAttribute('aria-label', 'Updating toolpaths in Fusion');
  spinEl.title = 'Updating toolpaths in Fusion…';

  // TASK 795: the SELECTION LIST: one row per selection in the design (its words, an X), Clear all from 2 on. A row hovered or focused is highlighted in Fusion.
  const listEl = document.createElement('div');
  listEl.id = 'shaper-fusion-selections';
  listEl.className = 'shaper-fusion-list';
  listEl.hidden = true;

  bar.append(addBtn, statusEl, spinEl, listEl);
  viewPrepareEl.insertBefore(bar, viewPrepareEl.firstChild);
  // TASK 795: the cards under the bar (the notice, the cut card, the operations list) sit below it whatever height the selection list gives it (index.html reads the variable)
  new document.defaultView.ResizeObserver(() => viewPrepareEl.style.setProperty('--sk-fusion-bar-h', `${bar.offsetHeight}px`)).observe(bar);

  const showNotice = (text, isError) => {
    if (!noticeEl) return;
    noticeEl.textContent = text;
    noticeEl.hidden = false;
    noticeEl.classList.toggle('is-error', Boolean(isError));
  };

  const fusionMode = isFusionMode(globalTarget && globalTarget.location);
  const useTargetTimers = globalTarget
    && typeof globalTarget.setInterval === 'function'
    && typeof globalTarget.clearInterval === 'function';
  const setInt = useTargetTimers ? globalTarget.setInterval.bind(globalTarget) : setInterval;
  const clearInt = useTargetTimers ? globalTarget.clearInterval.bind(globalTarget) : clearInterval;

  let waiting = false;
  let timedOut = false;
  let bootPingSent = false;
  let pollTimer = null;
  let deadlineAt = 0;
  let loadHandler = null;

  const stopWaiting = () => {
    waiting = false;
    if (pollTimer !== null) {
      clearInt(pollTimer);
      pollTimer = null;
    }
    if (loadHandler && globalTarget && typeof globalTarget.removeEventListener === 'function') {
      globalTarget.removeEventListener('load', loadHandler);
      loadHandler = null;
    }
  };

  let onIncomingAction = () => {};
  let highlighted = null; // the selection id last sent in highlight_selection (null: none)
  let pendingClear = null; // TASK 795c: { selectionId, group } awaiting re-sent selection_data from add-in

  const bridge = createFusionBridge({
    globalTarget,
    onStatus: (text, info) => {
      statusEl.textContent = text;
      statusEl.dataset.state = 'connected';
      onStatusChange(info);
    },
    onNotice: (text) => {
      showNotice(text, false);
    },
    onError: (text, detail) => {
      if (detail && detail.receivedAction === FUSION_ACTIONS.CLEAR_SELECTION) pendingClear = null;
      if (!bridge.canSend()) statusEl.dataset.state = (waiting && !timedOut) ? 'waiting' : 'unavailable';
      else if (statusEl.dataset.state !== 'connected') statusEl.dataset.state = 'error';
      showNotice(text, true);
    },
    onSelectionData: (data) => {
      const clearGroup = (pendingClear && data && data.selectionId === pendingClear.selectionId)
        ? pendingClear.group
        : null;
      pendingClear = null;
      return onSelectionData(data, { clearGroup });
    },
    onMessage: (action) => { onIncomingAction(action); },
  });

  // TASK 795 (SA-12) / TASK 795c (SA-15): only a selection the add-in sent (entry.fusion) has an overlay in Fusion.
  const sendHighlight = (id) => {
    if (highlighted === id) return;
    highlighted = id;
    if (bridge.canSend()) bridge.send(FUSION_ACTIONS.HIGHLIGHT_SELECTION, { selectionId: id });
  };
  const renderList = () => {
    const rows = getSelections().flatMap(selectionRowsOf);
    listEl.hidden = rows.length === 0;
    const frag = document.createDocumentFragment();
    for (const r of rows) {
      const row = document.createElement('div');
      row.className = 'shaper-fusion-sel';
      row.dataset.selectionId = r.id;
      if (r.group) row.dataset.group = r.group;
      if (r.kind) row.dataset.kind = r.kind;
      row.tabIndex = 0;
      const iconMarkup = r.kind && SUMMARY_ITEM_ICONS[r.kind];
      let iconEl = null;
      if (iconMarkup) {
        iconEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        iconEl.setAttribute('class', 'shaper-fusion-sel-icon');
        iconEl.setAttribute('viewBox', '0 0 16 16');
        iconEl.setAttribute('fill', 'none');
        iconEl.setAttribute('aria-hidden', 'true');
        iconEl.innerHTML = iconMarkup;
      }
      const text = document.createElement('span');
      text.className = 'shaper-fusion-sel-text';
      text.textContent = r.text;
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'shaper-fusion-sel-x';
      x.textContent = '✕';
      x.title = `Remove ${r.text}`;
      x.setAttribute('aria-label', `Remove ${r.text}`);
      x.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (r.fusion && r.group) pendingClear = { selectionId: r.id, group: r.group };
        onRemoveSelection(r.id, r.group);
      });
      if (iconEl) row.append(iconEl, text, x);
      else row.append(text, x);
      if (r.fusion) {
        row.addEventListener('mouseenter', () => sendHighlight(r.id));
        row.addEventListener('mouseleave', () => sendHighlight(null));
        row.addEventListener('focusin', () => sendHighlight(r.id));
        row.addEventListener('focusout', () => sendHighlight(null));
      }
      frag.append(row);
    }
    if (rows.length >= 2) {
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.id = 'btn-fusion-clear-selections';
      clear.className = 'shaper-fusion-clear';
      clear.textContent = 'Clear all';
      clear.addEventListener('click', () => onClearSelections());
      frag.append(clear);
    }
    listEl.replaceChildren(frag);
    if (highlighted && !rows.some((r) => r.id === highlighted)) sendHighlight(null); // the highlighted selection left the list: no mouseleave will come
  };
  const stopList = onSelectionsChange(({ removed, all, sync = true, restoreIds = null, redoClear = null }) => {
    if (bridge.canSend()) {
      if (Array.isArray(restoreIds) && restoreIds.length) {
        for (const sid of restoreIds) bridge.send(FUSION_ACTIONS.RESTORE_SELECTION, { selectionId: sid });
      } else if (redoClear) {
        bridge.send(FUSION_ACTIONS.CLEAR_SELECTION, redoClear);
      } else if (sync !== false) {
        const gone = removed.filter((e) => e.fusion);
        if (gone.length) {
          if (all) bridge.send(FUSION_ACTIONS.CLEAR_SELECTION, { selectionId: 'all' }); // Clear all
          else for (const e of gone) bridge.send(FUSION_ACTIONS.CLEAR_SELECTION, { selectionId: e.id }); // an X, an Undo / Redo of an add, a replace
        }
      }
    }
    renderList();
  });
  renderList();

  const syncAvailability = () => {
    const ready = bridge.canSend();
    addBtn.disabled = !ready;
    if (ready) {
      stopWaiting();
      timedOut = false;
      addBtn.title = 'Add the active Fusion 360 selection to Prepare';
      if (statusEl.dataset.state !== 'connected') {
        statusEl.textContent = 'Connecting to Fusion…';
        statusEl.dataset.state = 'connecting';
      }
      return true;
    }
    if (waiting && !timedOut) {
      addBtn.title = 'Waiting for Fusion 360 host bridge…';
      if (statusEl.dataset.state !== 'connected') {
        statusEl.textContent = 'Waiting for Fusion…';
        statusEl.dataset.state = 'waiting';
      }
      return false;
    }
    addBtn.title = 'Unavailable: open inside Fusion 360 (window.adsk missing) to add selection';
    if (statusEl.dataset.state !== 'connected') {
      statusEl.textContent = 'Fusion host unavailable (window.adsk missing) — open inside Fusion 360 to use Add selection';
      statusEl.dataset.state = 'unavailable';
    }
    return false;
  };

  const sendBootPingOnce = () => {
    if (!syncAvailability()) return { ok: false, reason: 'window.adsk unavailable' };
    if (bootPingSent) return { ok: true, alreadySent: true };
    const res = bridge.bootPing();
    if (res && res.ok) bootPingSent = true;
    return res;
  };

  const recheckHost = (sendPingIfReady = true) => {
    if (!syncAvailability()) return false;
    if (sendPingIfReady) sendBootPingOnce();
    return true;
  };

  onIncomingAction = (action) => {
    // Any Fusion message arriving through fusionJavaScriptHandler proves the host is live; re-check for adsk immediately.
    recheckHost(action !== FUSION_ACTIONS.PONG);
  };

  const startWaiting = () => {
    waiting = true;
    timedOut = false;
    deadlineAt = Date.now() + waitTimeoutMs;
    if (globalTarget && typeof globalTarget.addEventListener === 'function') {
      loadHandler = () => { recheckHost(true); };
      globalTarget.addEventListener('load', loadHandler, { once: true });
    }
    pollTimer = setInt(() => {
      if (recheckHost(true)) return;
      if (Date.now() >= deadlineAt) {
        timedOut = true;
        stopWaiting();
        syncAvailability();
      }
    }, pollIntervalMs);
  };

  addBtn.addEventListener('click', () => {
    if (!syncAvailability()) return;
    bridge.send(FUSION_ACTIONS.ADD_SELECTION, {});
  });

  if (fusionMode && !bridge.canSend()) {
    startWaiting();
  }
  syncAvailability();

  const setSyncing = (busy) => {
    const on = Boolean(busy);
    spinEl.hidden = !on;
    bar.dataset.syncing = on ? 'true' : 'false';
  };

  return {
    bar,
    addBtn,
    statusEl,
    spinEl,
    setSyncing,
    bridge,
    syncAvailability,
    bootPing: () => sendBootPingOnce(),
    listEl,
    destroy: () => {
      stopList();
      stopWaiting();
      bridge.destroy();
    },
  };
}
