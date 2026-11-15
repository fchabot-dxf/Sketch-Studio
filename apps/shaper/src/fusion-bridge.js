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

export const FUSION_HOST_PARAM = 'host';
export const FUSION_HOST_VALUE = 'fusion';

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
export const FUSION_ACTIONS = Object.freeze({
  PING: 'ping',
  PONG: 'pong',
  ERROR: 'error',
  ADD_SELECTION: 'add_selection',
  SELECTION_DATA: 'selection_data',
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
      if (ret && typeof ret.then === 'function') {
        ret.then(undefined, (err) => {
          reportError(`Fusion send failed for ${action}: ${err && err.message ? err.message : String(err)}`);
        });
      }
      return { ok: true, action, body };
    } catch (err) {
      reportError(`Fusion send failed for ${action}: ${err && err.message ? err.message : String(err)}`);
      return { ok: false, reason: err && err.message ? err.message : String(err) };
    }
  }

  function handle(rawAction, rawData) {
    const parsed = parsePayload(rawData);
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
      const msg = warnings.length ? `${baseMsg} (${warnings.join('; ')})` : baseMsg;
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
export function mountFusionPrepareBar({ viewPrepareEl, noticeEl, onSelectionData = () => {}, globalTarget = (typeof window !== 'undefined' ? window : null) }) {
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

  bar.append(addBtn, statusEl);
  viewPrepareEl.insertBefore(bar, viewPrepareEl.firstChild);

  const showNotice = (text, isError) => {
    if (!noticeEl) return;
    noticeEl.textContent = text;
    noticeEl.hidden = false;
    noticeEl.classList.toggle('is-error', Boolean(isError));
  };

  const bridge = createFusionBridge({
    globalTarget,
    onStatus: (text) => {
      statusEl.textContent = text;
      statusEl.dataset.state = 'connected';
    },
    onNotice: (text) => {
      showNotice(text, false);
    },
    onError: (text) => {
      if (!bridge.canSend()) statusEl.dataset.state = 'unavailable';
      else statusEl.dataset.state = 'error';
      showNotice(text, true);
    },
    onSelectionData,
  });

  const syncAvailability = () => {
    const ready = bridge.canSend();
    addBtn.disabled = !ready;
    if (!ready) {
      addBtn.title = 'Unavailable: open inside Fusion 360 (window.adsk missing) to add selection';
      statusEl.textContent = 'Fusion host unavailable (window.adsk missing) — open inside Fusion 360 to use Add selection';
      statusEl.dataset.state = 'unavailable';
    } else {
      addBtn.title = 'Add the active Fusion 360 selection to Prepare';
      if (statusEl.dataset.state !== 'connected') {
        statusEl.textContent = 'Connecting to Fusion…';
        statusEl.dataset.state = 'connecting';
      }
    }
    return ready;
  };

  addBtn.addEventListener('click', () => {
    if (!syncAvailability()) return;
    bridge.send(FUSION_ACTIONS.ADD_SELECTION, {});
  });

  syncAvailability();

  return {
    bar,
    addBtn,
    statusEl,
    bridge,
    syncAvailability,
    bootPing: () => (syncAvailability() ? bridge.bootPing() : { ok: false, reason: 'window.adsk unavailable' }),
  };
}
