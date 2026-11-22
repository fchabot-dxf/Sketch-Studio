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
import { deserializeDocument } from '#core/document.js';
import { DEFAULT_STOCK } from '#core/relief-model.js';
import SettingsManager from '#core/settings-manager.js';
import { UNITS } from '#core/units.js';
import { emptyDocument } from '#ui/project-store.js';
import { getSelections, setSelections, onSelectionsChange, selectionRowsOf } from './selection-list.js'; // TASK 795 / 795c: the selection list the Prepare bar shows
import { storeOps, regionOf, captureStore, applyStore, renameGeometry } from './operations-store.js';
import { partKeyOf } from './cut-plan.js';
import { STOCK_TYPE_ID } from './shaper.js';
import { getStock, setStock } from './stock.js';
import { loadBits, saveBits } from './tool-table.js';
import { forget as forgetPaths } from './op-paths.js';
import { hintText } from './param-hints.js';

export const FUSION_HOST_PARAM = 'host';
export const FUSION_HOST_VALUE = 'fusion';
export const DEFAULT_ADSK_POLL_MS = 200;
export const DEFAULT_ADSK_WAIT_TIMEOUT_MS = 15000;
export const PROJECT_SAVE_DEBOUNCE_MS = 2000; // TASK 855 / SA-19: debounced write to Fusion Design attribute
export const LEGACY_FUSION_OFFERED_KEY = 'shaper-fusion-legacy-offered'; // TASK 855: one-time offer of pre-855 browser work
// TASK 855c: the add-in that stores the project IN the Fusion design (SA-19) opens the palette with `&project=design`. Known at the first paint, so the
// palette picks its workspace storage once, before anything is restored: that add-in -> per design (no browser storage); an older add-in (no parameter)
// -> today's browser storage and tabs, unchanged.
export const FUSION_PROJECT_PARAM = 'project';
export const FUSION_PROJECT_PER_DESIGN = 'design';

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
  SELECTION_DATA: 'selection_data', // TASK 855b (SA-19): carries the docToken of the design it was extracted from; applied only while that design is the current design_context
  HIGHLIGHT_SELECTION: 'highlight_selection', // TASK 795 (SA-12): { selectionId | null } brightens one selection's overlay in Fusion (null: all back to their cut-type colours)
  CLEAR_SELECTION: 'clear_selection', // TASK 795 (SA-12 / SA-15): { selectionId, group? } | { selectionId: 'all' }
  RESTORE_SELECTION: 'restore_selection', // TASK 795c (SA-15): { selectionId, tokens? } restores the cleared token list on Undo/Redo
  SELECT_FOR_OPERATION: 'select_for_operation', // TASK 806 (SA-16): { opKey, label, tokens, keepTokens }
  DESIGN_CONTEXT: 'design_context', // TASK 855 (SA-19): { docToken, designKey, docName, lengthUnits?, hasSelection, project }
  REQUEST_SELECTION: 'request_selection', // TASK 855 (SA-19): { docToken? } re-requests remembered selection on open/switch
  SAVE_PROJECT: 'save_project', // TASK 855 (SA-19): { docToken, designKey, project } saves workspace in Design attribute
  PROJECT_SAVED: 'project_saved', // TASK 855 (SA-19): { docToken, designKey } confirms minted/saved designKey
  TOOLPATHS: 'toolpaths', // TASK 799 (SA-13): live bit-centre toolpaths overlay in Fusion
  TOOLPATHS_CLEAR: 'toolpaths_clear', // TASK 799 (SA-13): clears the Fusion toolpaths overlay
});

/**
 * Capture the Shaper palette's Fusion-mode project for `shaper-addin/project` attribute (TASK 855 / SA-19).
 * Excludes imported geometry (`joints`, `shapes`, `profiles`), heavy `slope`/`levels` arrays, `payloadSig`, and undo history.
 */
export function captureFusionProject({ reviewLook = null, reviewViewMode = null } = {}) {
  const { operations, regions, nextSeq, listOrder } = captureStore();
  const slimRegions = {};
  for (const [k, reg] of Object.entries(regions || {})) {
    if (!reg || typeof reg !== 'object') continue;
    const entry = {};
    if (reg.source && typeof reg.source === 'object') entry.source = { ...reg.source };
    if (Array.isArray(reg.sources) && reg.sources.length) entry.sources = [...reg.sources];
    if (Object.keys(entry).length) slimRegions[k] = entry;
  }
  const selections = getSelections().map((e) => ({
    id: e.id,
    fusion: e.fusion === true,
    kind: e.kind || '',
    name: e.name || '',
    text: e.text || '',
    cutKeys: Array.isArray(e.cutKeys) ? [...e.cutKeys] : [],
    base: e.base ? { ...e.base } : {},
    sigs: e.sigs ? { ...e.sigs } : {},
    thicknessMm: e.thicknessMm ?? null,
    regionCount: e.regionCount ?? 0,
    ...(Array.isArray(e.items) && e.items.length ? { items: e.items } : {}),
  }));
  return {
    version: 1,
    operations,
    nextSeq,
    listOrder,
    regions: slimRegions,
    stock: getStock(),
    prepareSettings: {
      docUnit: SettingsManager.get('DOC_UNIT'),
      toolTable: loadBits(),
      ...(reviewLook ? { reviewLook } : {}),
      ...(reviewViewMode ? { reviewViewMode } : {}),
    },
    selections,
  };
}

/**
 * Replace the palette's live workspace with `project` (or an empty workspace when `project` is null).
 * Clears undo/redo history; when `hasSelection` is true, `selections` metadata (`cutKeys`, `base`, `sigs`)
 * stays ready for `importFusionSelection`'s 795c canonical `regionSig` remapping when `selection_data` arrives.
 */
export function applyFusionProject(project, { controller = null, prepare = null, hasSelection = false, onRestoreLook = null } = {}) {
  const st = controller && controller.state;
  if (st) {
    deserializeDocument(emptyDocument(), st);
    if (Array.isArray(st.history)) st.history.length = 0;
    if (Array.isArray(st.redoStack)) st.redoStack.length = 0;
  }
  forgetPaths();
  if (!project || typeof project !== 'object') {
    applyStore(null);
    setSelections([], { sync: false });
    setStock({ ...DEFAULT_STOCK });
  } else {
    setStock(project.stock && typeof project.stock === 'object' ? { ...DEFAULT_STOCK, ...project.stock } : { ...DEFAULT_STOCK });
    const ps = project.prepareSettings && typeof project.prepareSettings === 'object' ? project.prepareSettings : {};
    if (typeof ps.docUnit === 'string' && UNITS.includes(ps.docUnit)) {
      SettingsManager.set('DOC_UNIT', ps.docUnit, { persist: false });
    }
    if (Array.isArray(ps.toolTable)) saveBits(ps.toolTable);
    if (typeof onRestoreLook === 'function' && (ps.reviewLook || ps.reviewViewMode)) onRestoreLook(ps);
    applyStore(project);
    setSelections(Array.isArray(project.selections) ? project.selections : [], { sync: false });
    if (!hasSelection) {
      const staleKeys = new Set(storeOps().flatMap((o) => o.geometry.map((r) => r.key)));
      if (staleKeys.size) renameGeometry(new Map(), staleKeys, { keepEmpty: true });
    }
  }
  if (!hasSelection && prepare && typeof prepare.afterRestore === 'function') prepare.afterRestore();
  if (st && typeof st._notifyHistory === 'function') st._notifyHistory();
}

export function isStlOperation(op) {
  if (!op || !Array.isArray(op.shapes) || op.shapes.length === 0) return false;
  const stlKeys = new Set(getSelections().filter((e) => e.kind === 'stl').flatMap((e) => e.cutKeys.map(partKeyOf)));
  if (!stlKeys.size) return false;
  return op.shapes.every((k) => stlKeys.has(partKeyOf(k)));
}

export function buildSelectForOperationPayload(op) {
  if (!op || !op.id) return null;
  const tokens = [], seenTok = new Set();
  for (const k of (Array.isArray(op.shapes) ? op.shapes : [])) {
    const reg = regionOf(partKeyOf(k));
    const srcs = reg && Array.isArray(reg.sources) ? reg.sources : [];
    for (const t of srcs) {
      if (typeof t === 'string' && t && !seenTok.has(t)) { seenTok.add(t); tokens.push(t); }
    }
  }
  const keepTokens = [], seenKeep = new Set();
  for (const other of storeOps()) {
    if (other.id === op.id || other.type === STOCK_TYPE_ID) continue;
    for (const ref of (other.geometry || [])) {
      const reg = regionOf(partKeyOf(ref.key));
      const srcs = reg && Array.isArray(reg.sources) ? reg.sources : [];
      for (const t of srcs) {
        if (typeof t === 'string' && t && !seenKeep.has(t)) { seenKeep.add(t); keepTokens.push(t); }
      }
    }
  }
  return {
    opKey: op.id,
    label: op.label || op.rowText || op.id,
    tokens,
    keepTokens,
  };
}

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

/** TASK 855c: true iff the palette was opened by an add-in that keeps the project in the Fusion design (`?host=fusion&project=design`). */
export function isPerDesignProject(locationOrSearch = typeof window !== 'undefined' ? window.location : '') {
  const search = typeof locationOrSearch === 'string'
    ? locationOrSearch
    : (locationOrSearch && typeof locationOrSearch.search === 'string' ? locationOrSearch.search : '');
  return isFusionMode(search) && new URLSearchParams(search).get(FUSION_PROJECT_PARAM) === FUSION_PROJECT_PER_DESIGN;
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
  onDesignContext = () => {},
  onProjectSaved = () => {},
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
        projectBridge: Boolean(data.projectBridge),
      });
      return 'OK';
    }

    if (action === FUSION_ACTIONS.DESIGN_CONTEXT) {
      onDesignContext(data);
      return 'OK';
    }

    if (action === FUSION_ACTIONS.PROJECT_SAVED) {
      onProjectSaved(data);
      return 'OK';
    }

    if (action === FUSION_ACTIONS.ERROR) {
      const recAct = typeof data.receivedAction === 'string' ? data.receivedAction : '';
      if (recAct === FUSION_ACTIONS.TOOLPATHS || recAct === FUSION_ACTIONS.TOOLPATHS_CLEAR || recAct === FUSION_ACTIONS.SAVE_PROJECT || recAct === FUSION_ACTIONS.REQUEST_SELECTION) {
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
      if (res && res.ignored) return 'OK'; // TASK 855b: a selection of another design (mountFusionPrepareBar)
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
  onDesignContextChange = () => {}, // TASK 855: notified after design_context workspace swap
  getController = null,
  prepare = null,
  captureLook = null,
  onRestoreLook = null,
  saveDebounceMs = PROJECT_SAVE_DEBOUNCE_MS,
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
  const clearNotice = () => {
    if (!noticeEl) return;
    noticeEl.textContent = '';
    noticeEl.hidden = true;
    noticeEl.classList.remove('is-error');
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
  let projectBridgeActive = false;
  let currentDocToken = null;
  let currentDesignKey = null;
  let lastSavedProjectSig = '';
  let saveTimer = null;
  let switchingContext = false;
  let pendingInitialSelection = false;

  const projectNow = () => captureFusionProject(typeof captureLook === 'function' ? captureLook() : {});
  const clearSaveTimer = () => {
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
  };
  const flushProjectSave = () => {
    clearSaveTimer();
    if (!projectBridgeActive || !currentDocToken || switchingContext || pendingInitialSelection || !bridge.canSend()) return false;
    const proj = projectNow();
    const sig = JSON.stringify(proj);
    if (sig === lastSavedProjectSig) return false;
    lastSavedProjectSig = sig;
    bridge.send(FUSION_ACTIONS.SAVE_PROJECT, {
      docToken: currentDocToken,
      designKey: currentDesignKey,
      project: proj,
    });
    return true;
  };
  const notifyProjectChanged = () => {
    if (!projectBridgeActive || !currentDocToken || switchingContext || pendingInitialSelection) return;
    const sig = JSON.stringify(projectNow());
    if (sig === lastSavedProjectSig) {
      clearSaveTimer();
      return;
    }
    clearSaveTimer();
    saveTimer = setTimeout(() => { flushProjectSave(); }, saveDebounceMs);
  };

  const bridge = createFusionBridge({
    globalTarget,
    onStatus: (text, info) => {
      statusEl.textContent = text;
      statusEl.dataset.state = 'connected';
      if (info && info.projectBridge) projectBridgeActive = true;
      onStatusChange(info);
    },
    onNotice: (text) => {
      showNotice(text, false);
    },
    onError: (text, detail) => {
      if (detail && detail.receivedAction === FUSION_ACTIONS.CLEAR_SELECTION) pendingClear = null;
      if (!bridge.canSend()) statusEl.dataset.state = (waiting && !timedOut) ? 'waiting' : 'unavailable';
      else if (statusEl.dataset.state !== 'connected') statusEl.dataset.state = 'error';
      const display = (detail && detail.receivedAction === FUSION_ACTIONS.SELECT_FOR_OPERATION && detail.code === 'wrong_design')
        ? hintText('fusionSwitchDesign', { doc: detail.docName })
        : text;
      showNotice(display, true);
    },
    onSelectionData: (data) => {
      // TASK 855b: a selection names the design it was extracted from (docToken). One of ANOTHER design (it arrived after a
      // switch, e.g. Fusion executed design A's still-open Add to Shaper dialog when a new document pre-empted it) is not
      // this workspace's: never imported here, so never saved into this design. No docToken (an older add-in): applied.
      if (projectBridgeActive && data && typeof data.docToken === 'string' && data.docToken !== currentDocToken) {
        dbg.warn('fusion', 'selection_data of another design ignored', { docToken: data.docToken, current: currentDocToken, selectionId: data.selectionId });
        return { ignored: true };
      }
      const wasInitial = pendingInitialSelection && !(data && data.assign);
      pendingInitialSelection = false;
      const clearGroup = (pendingClear && data && data.selectionId === pendingClear.selectionId)
        ? pendingClear.group
        : null;
      pendingClear = null;
      const res = onSelectionData(data, { clearGroup });
      if (wasInitial) {
        lastSavedProjectSig = JSON.stringify(projectNow());
      } else {
        notifyProjectChanged();
      }
      return res;
    },
    onDesignContext: (data) => {
      if (saveTimer !== null && currentDocToken && data && data.docToken !== currentDocToken) {
        flushProjectSave();
      }
      clearSaveTimer();
      projectBridgeActive = true;
      switchingContext = true;
      currentDocToken = data && typeof data.docToken === 'string' && data.docToken ? data.docToken : null;
      currentDesignKey = data && typeof data.designKey === 'string' && data.designKey ? data.designKey : null;
      const docName = data && typeof data.docName === 'string' ? data.docName.trim() : '';
      const mappedUnit = mapFusionLengthUnit(data && data.lengthUnits);
      if (mappedUnit) SettingsManager.set('DOC_UNIT', mappedUnit, { persist: false });
      const hasSel = Boolean(data && data.hasSelection);
      pendingInitialSelection = hasSel;
      applyFusionProject(data && data.project ? data.project : null, {
        controller: typeof getController === 'function' ? getController() : null,
        prepare,
        hasSelection: hasSel,
        onRestoreLook,
      });
      lastSavedProjectSig = JSON.stringify(projectNow());
      switchingContext = false;
      statusEl.textContent = docName ? `Connected to Fusion: ${docName}` : 'Connected to Fusion';
      statusEl.dataset.state = 'connected';
      renderList();
      clearNotice();
      onDesignContextChange(data);
      if (hasSel && bridge.canSend()) {
        bridge.send(FUSION_ACTIONS.REQUEST_SELECTION, currentDocToken ? { docToken: currentDocToken } : {});
      }
    },
    onProjectSaved: (data) => {
      if (data && typeof data.designKey === 'string' && data.designKey) {
        if (!data.docToken || data.docToken === currentDocToken) {
          currentDesignKey = data.designKey;
        }
      }
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
  const stopList = onSelectionsChange(({ removed, all, sync = true, restoreIds = null, redoClear = null, redoPayloads = null }) => {
    if (bridge.canSend()) {
      if (Array.isArray(restoreIds) && restoreIds.length) {
        for (const sid of restoreIds) bridge.send(FUSION_ACTIONS.RESTORE_SELECTION, { selectionId: sid });
      } else if (Array.isArray(redoPayloads) && redoPayloads.length) {
        for (const p of redoPayloads) bridge.send(p.action, p.payload);
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
    notifyProjectChanged();
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

  const canSelectForOperation = (op) => Boolean(op && op.tickable !== false && !isStlOperation(op));
  const selectForOperation = (op) => {
    if (!canSelectForOperation(op) || !syncAvailability()) return { ok: false, reason: 'unavailable' };
    const payload = buildSelectForOperationPayload(op);
    if (!payload) return { ok: false, reason: 'invalid operation' };
    if (currentDocToken) payload.docToken = currentDocToken;
    return bridge.send(FUSION_ACTIONS.SELECT_FOR_OPERATION, payload);
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
    canSelectForOperation,
    selectForOperation,
    notifyProjectChanged,
    flushProjectSave,
    isProjectBridgeActive: () => projectBridgeActive,
    listEl,
    destroy: () => {
      clearSaveTimer();
      stopList();
      stopWaiting();
      bridge.destroy();
    },
  };
}
