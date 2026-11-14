// packages/ui/style-panel.js — the shared sketcher STYLE panel (S7c-2b).
// The shared panel BUILDS its own DOM from a control SPEC (a bare host has no #s-* markup) and
// owns its open/close. The 16 controls ARE the shared renderer knobs — they read/write the already-shared
// SettingsManager (#core/settings-manager.js), so the shared renderer reacts live. App-agnostic chrome; themed via
// --sk-* (light defaults → SketchStudio); self-contained <style>. Imports ONLY the settings store.

import SettingsManager from '#core/settings-manager.js';
import { UNITS } from '#core/units.js';
import {
  STYLE_TEMPLATES, CUSTOM_TEMPLATE_ID, USER_PRESETS_KEY, activeStyleTemplateId, applyStyleTemplate, userPresetsOf, listUserPresets,
  isUserPresetId, presetNameProblem, findUserPresetByName, saveUserPreset, renameUserPreset, deleteUserPreset,
} from './style-templates.js';

// The shared sketcher-rendering controls. Labels are the EXACT text from #settings-panel (index.html) — faithful
// for the S7c-2c swap. min/max/step carried from the retired settings-panel.js sliderSpecs. SHOW_GRID = checkbox; the rest =
// number + paired range slider. Declared control TYPES: 'checkbox' (boolean), 'select' (an `options: [{value,label}]`
// enum — generic, e.g. GRID_MODE; `numeric: true` stores the option as a number), and the default number+slider (needs
// min/max/step). Any control may declare `showWhen: { key, in: [values] }`: shown only while that setting's value (DOC_UNIT
// defaults to 'mm') is in the list; no showWhen = always shown.
const CONTROLS = [
  { tab: 'grid', key: 'SHOW_GRID',               label: 'Show Grid',            type: 'checkbox' },
  { tab: 'grid', key: 'GRID_MODE',               label: 'Grid Style',           type: 'select',
    options: [{ value: 'lines', label: 'Grid' }, { value: 'off', label: 'None' }, { value: 'points', label: 'Draft points' }] },
  { tab: 'grid', key: 'SNAP_MAGNETISM',          label: 'Snap Magnetism',       min: 2,   max: 40,  step: 1 },
  { tab: 'grid', key: 'AXIS_SNAP',               label: 'Snap to X / Y axis',   type: 'checkbox' },
  { tab: 'grid', key: 'GRID_MAGNETISM',          label: 'Grid Magnetism',       min: 2,   max: 40,  step: 1 },
  // The grid pair, per unit system (showWhen: shown only while DOC_UNIT is one of `in`): metric files = the mm-stored
  // GRID_MAJOR_STEP / GRID_SIZE; inch files = INCH_GRID_MAJOR (inches) + INCH_GRID_DIVISIONS (squares per heavy line).
  { tab: 'grid', key: 'GRID_MAJOR_STEP',         label: 'Heavy line every (mm)', min: 1,   max: 500, step: 1,   showWhen: { key: 'DOC_UNIT', in: ['mm', 'cm'] } },
  { tab: 'grid', key: 'GRID_SIZE',               label: 'Light line every (mm)', min: 0.5, max: 100, step: 0.5, showWhen: { key: 'DOC_UNIT', in: ['mm', 'cm'] } },
  { tab: 'grid', key: 'INCH_GRID_MAJOR',         label: 'Heavy line every (in)', min: 0.25, max: 24, step: 0.25, showWhen: { key: 'DOC_UNIT', in: ['in'] } },
  { tab: 'grid', key: 'INCH_GRID_DIVISIONS',     label: 'Squares per heavy line', type: 'select', numeric: true, showWhen: { key: 'DOC_UNIT', in: ['in'] },
    options: [10, 2, 4, 8, 16].map((n) => ({ value: n, label: String(n) })) },
  { tab: 'lines', key: 'LINE_STROKE',             label: 'Line Stroke',          min: 0.1, max: 5,   step: 0.1 },
  { tab: 'lines', key: 'JOINT_RADIUS',            label: 'Joint Radius',         min: 0.1, max: 12,  step: 0.1 },
  { tab: 'lines', key: 'JOINT_STROKE_MULT',       label: 'Joint Stroke Mult',    min: 0.1, max: 5,   step: 0.1 },
  { tab: 'lines', key: 'SELECTION_FEEDBACK_MULT', label: 'Selection Stroke Mult', min: 0.1, max: 6,  step: 0.1 },
  { tab: 'lines', key: 'HOVER_FEEDBACK_MULT',     label: 'Hover Stroke Mult',    min: 0.1, max: 6,   step: 0.1 },
  { tab: 'glyphs', key: 'GLYPH_SYMBOL_SIZE_PX',    label: 'Glyph Icon Size',      min: 8,   max: 48,  step: 1 },
  { tab: 'glyphs', key: 'GLYPH_INFERENCE_SIZE_PX', label: 'Glyph Inference Size', min: 8,   max: 64,  step: 1 },
  { tab: 'glyphs', key: 'GLYPH_OFFSET_PX',         label: 'Glyph Offset',         min: 0,   max: 200, step: 1 },
  { tab: 'glyphs', key: 'GLYPH_OUTLINE_PX',        label: 'Glyph Outline',        min: 0.2, max: 4,   step: 0.1 },
  { tab: 'lines', key: 'GLOW_WIDTH_PX',           label: 'Glow Width',           min: 0,   max: 80,  step: 1 },
  { tab: 'lines', key: 'DASH_LENGTH_PX',          label: 'Dash Length',          min: 1,   max: 40,  step: 1 },
  { tab: 'lines', key: 'DASH_GAP_PX',             label: 'Dash Gap',             min: 1,   max: 40,  step: 1 },
  { tab: 'lines', key: 'HOVER_COLOR',             label: 'Hover Colour',         type: 'select',
    options: [{ value: '#1e40af', label: 'Selection blue' }, { value: SettingsManager.getDefault('HOVER_COLOR'), label: 'Hover blue' }] },
  { tab: 'lines', key: 'PROFILE_FILL',            label: 'Closed Profile Fill',  type: 'select',
    options: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On (tint every closed loop)' }] },
  { tab: 'lines', key: 'LOCKED_LINE_COLOR',       label: 'Locked Line Colour',   type: 'select',
    options: [{ value: '', label: 'Same as constrained' }, { value: '#8DB84A', label: 'Fusion green' }] },
  { tab: 'glyphs', key: 'DIM_LABEL_BOX',          label: 'Dimension Label Box',  type: 'checkbox' },
  { tab: 'glyphs', key: 'LABEL_FONT_FAMILY',      label: 'Dimension Font',       type: 'select',
    options: [{ value: '', label: 'Inherited' }, { value: 'Segoe UI, Arial, Helvetica, sans-serif', label: 'Segoe UI / Arial (sans)' }] },
];

const TABS = [
  { id: 'lines', label: 'Lines & Joints' },
  { id: 'grid', label: 'Grid & Snap' },
  { id: 'glyphs', label: 'Glyphs' },
  { id: 'units', label: 'Units' },
];
const UNIT_LABELS = { mm: 'Millimetres', cm: 'Centimetres', in: 'Inches' };

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined' || !document.head) return;
  if (document.getElementById('sk-style-panel-styles')) { stylesInjected = true; return; }
  const s = document.createElement('style');
  s.id = 'sk-style-panel-styles';
  s.textContent = `
.sk-style-panel { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 10000;
  width: 320px; max-height: 82vh; overflow: auto; box-sizing: border-box; padding: 14px;
  background: var(--sk-style-bg, #fff); color: var(--sk-style-fg, #334155);
  border: 1px solid var(--sk-style-sep, #cbd5e1); border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,0.25);
  font: 12px system-ui, sans-serif; }
.sk-style-panel.sk-hidden { display: none; }
.sk-style-panel * { box-sizing: border-box; }
.sk-style-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.sk-style-title { color: var(--sk-selection, #3B82F6); font-size: 13px; font-weight: 600; text-transform: uppercase; }
.sk-style-close { background: none; border: 0; cursor: pointer; font-size: 18px; line-height: 1;
  color: var(--sk-style-muted, #64748b); }
.sk-style-body { display: flex; flex-direction: column; gap: 8px; }
.sk-style-row, .sk-style-tpl { display: flex; flex-direction: column; gap: 4px; }
.sk-style-tabs { display: flex; flex-wrap: wrap; gap: 4px; border-bottom: 1px solid var(--sk-style-sep, #cbd5e1); }
.sk-style-tab { padding: 4px 8px; border: 0; border-bottom: 2px solid transparent; background: none; color: inherit; cursor: pointer; font: inherit; }
.sk-style-tab.sk-active { color: var(--sk-selection, #3B82F6); border-bottom-color: var(--sk-selection, #3B82F6); }
.sk-style-tabpanel { display: flex; flex-direction: column; gap: 8px; }
.sk-style-tabpanel[hidden], .sk-style-row[hidden] { display: none; }
.sk-style-rowtop { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.sk-style-input { width: 80px; text-align: right; padding: 2px 4px; border-radius: 4px; background: transparent;
  color: inherit; border: 1px solid var(--sk-style-sep, #cbd5e1); }
.sk-style-input[type="checkbox"] { width: auto; }
.sk-style-slider { width: 100%; accent-color: var(--sk-selection, #3B82F6); cursor: pointer; }
.sk-style-presetbar { display: flex; flex-wrap: wrap; gap: 6px; }
.sk-style-presetbar [hidden] { display: none; }
.sk-style-ask { display: flex; flex-direction: column; gap: 6px; padding: 8px; border: 1px solid var(--sk-style-sep, #cbd5e1); border-radius: 6px; }
.sk-style-ask-input { width: 100%; text-align: left; }
.sk-style-ask-err { color: #b91c1c; }
.sk-style-ask-btns { display: flex; justify-content: flex-end; gap: 6px; }
.sk-style-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.sk-style-btn { padding: 4px 10px; border-radius: 6px; cursor: pointer; background: transparent; color: inherit;
  border: 1px solid var(--sk-style-sep, #cbd5e1); }
.sk-style-btn-primary { background: var(--sk-selection, #3B82F6); color: #fff; border-color: transparent; }
/* TASK 562: a finger: every control >= 44 px, text >= 14 px (a mouse keeps today's size). */
@media (pointer: coarse) {
  .sk-style-close { min-width: 44px; min-height: 44px; font-size: 22px; }
  .sk-style-tab, .sk-style-btn { min-height: 44px; font-size: 14px; padding: 4px 14px; }
  .sk-style-input { min-height: 44px; min-width: 44px; font-size: 14px; }
  .sk-style-slider { height: 44px; }
}
`;
  document.head.appendChild(s);
  stylesInjected = true;
}

/**
 * createStylePanel({ settings, onNotify, title }) → { el, open, close, toggle, render, destroy }
 *   settings: the SettingsManager-like store (get/set/getAll/subscribe→unsub/resetToDefaults). Defaults to the
 *     shared #core singleton; injectable so a smoke can pass a fresh manager.
 *   onNotify(msg, level): optional toast hook (no Tailwind dependency here); level is 'success' | 'info' | 'warning' | 'error'. A throw from it propagates.
 *   title: header text (default 'Style').
 *   hostId: names the host so each remembers its own last-open tab (localStorage).
 */
export function createStylePanel({ settings = SettingsManager, onNotify = null, title = 'Style', hostId = 'default' } = {}) {
  injectStyles();
  const controlEls = {}; // key -> { input, slider? }
  let isOpen = false, escHandler = null, outsideHandler = null;
  const notify = (m, level) => { if (typeof onNotify === 'function') onNotify(m, level); };

  const el = document.createElement('div'); el.className = 'sk-style-panel sk-hidden';

  // Header
  const head = document.createElement('div'); head.className = 'sk-style-head';
  const titleEl = document.createElement('div'); titleEl.className = 'sk-style-title'; titleEl.textContent = title;
  const closeX = document.createElement('button'); closeX.type = 'button'; closeX.className = 'sk-style-close'; closeX.textContent = '✕';
  closeX.addEventListener('click', () => close());
  head.append(titleEl, closeX);

  // Body (17 controls from the spec)
  const body = document.createElement('div'); body.className = 'sk-style-body';

  // Template select (shared by every host): picking one writes its settings live. Any later knob edit shows
  // "Custom" (the edits are kept).
  const tplRow = document.createElement('div'); tplRow.className = 'sk-style-tpl'; // not a knob row: the shell smoke counts .sk-style-row = 17 knobs
  const tplTop = document.createElement('div'); tplTop.className = 'sk-style-rowtop';
  const tplLab = document.createElement('span'); tplLab.className = 'sk-style-label'; tplLab.textContent = 'Template';
  const tplSelect = document.createElement('select'); tplSelect.className = 'sk-style-input'; tplSelect.dataset.key = 'STYLE_TEMPLATE';
  // The options: the built-ins, then the user's own presets in their own group, then Custom. Rebuilt when the stored presets change.
  let builtRaw;
  const optionsFor = (list) => list.map((t) => { const o = document.createElement('option'); o.value = t.id; o.textContent = t.name; return o; });
  function buildTplOptions() {
    const raw = settings.get(USER_PRESETS_KEY);
    if (raw === builtRaw && tplSelect.options.length) return;
    builtRaw = raw;
    const mine = userPresetsOf(raw);
    const group = (label, list) => { const g = document.createElement('optgroup'); g.label = label; g.append(...optionsFor(list)); return g; };
    tplSelect.replaceChildren(group('Built-in', STYLE_TEMPLATES));
    if (mine.length) tplSelect.appendChild(group('My presets', mine));
    tplSelect.append(...optionsFor([{ id: CUSTOM_TEMPLATE_ID, name: 'Custom' }]));
  }
  tplSelect.addEventListener('change', () => { if (tplSelect.value !== CUSTOM_TEMPLATE_ID) applyStyleTemplate(tplSelect.value, settings); });
  tplTop.append(tplLab, tplSelect); tplRow.appendChild(tplTop);

  // User presets: save the current look under a name, rename / delete the chosen one. Questions are asked INLINE under the picker
  // (no window.prompt / confirm: unsupported in some embedded webviews). One question at a time; a newer one cancels the older.
  const presetBar = document.createElement('div'); presetBar.className = 'sk-style-presetbar';
  const barBtn = (action, text) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'sk-style-btn'; b.dataset.action = action; b.textContent = text; presetBar.appendChild(b); return b; };
  const saveBtn = barBtn('save-preset', 'Save as preset…');
  const renameBtn = barBtn('rename-preset', 'Rename…');
  const deleteBtn = barBtn('delete-preset', 'Delete');
  tplRow.appendChild(presetBar);
  let askSettle = null;
  // ask({ label, value?, okLabel, validate? }) → Promise: with `value` (even '') a text field: resolves the trimmed text, or null on cancel;
  // without it a yes/no: true or null. validate(text) → an error message keeps the question open and shows the message.
  function ask({ label, value = null, okLabel, validate = null }) {
    if (askSettle) askSettle(null);
    return new Promise((resolve) => {
      const row = document.createElement('div'); row.className = 'sk-style-ask'; row.setAttribute('role', value === null ? 'alertdialog' : 'group');
      const lab = document.createElement('span'); lab.textContent = label; row.appendChild(lab);
      const settle = (v) => { if (askSettle !== settle) return; askSettle = null; row.remove(); resolve(v); };
      let inp = null, err = null;
      if (value !== null) {
        inp = document.createElement('input'); inp.type = 'text'; inp.className = 'sk-style-input sk-style-ask-input'; inp.value = value; inp.maxLength = 200; row.appendChild(inp);
        err = document.createElement('span'); err.className = 'sk-style-ask-err'; err.hidden = true; row.appendChild(err);
      }
      const commit = () => {
        if (!inp) { settle(true); return; }
        const text = inp.value.trim(), problem = validate ? validate(text) : null;
        if (problem) { err.textContent = problem; err.hidden = false; inp.focus(); return; }
        settle(text);
      };
      const btns = document.createElement('div'); btns.className = 'sk-style-ask-btns';
      const mk = (cls, text, onClick) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'sk-style-btn ' + cls; b.textContent = text; b.addEventListener('click', onClick); btns.appendChild(b); return b; };
      mk('cancel', 'Cancel', () => settle(null));
      mk('ok sk-style-btn-primary', okLabel, commit);
      if (inp) inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); settle(null); } // cancels the question, not the panel
      });
      row.appendChild(btns);
      askSettle = settle; tplRow.appendChild(row);
      if (inp) { inp.focus(); inp.select(); } else row.querySelector('.ok').focus();
    });
  }
  const chosenPreset = () => listUserPresets(settings).find((p) => p.id === tplSelect.value) || null;
  saveBtn.addEventListener('click', async () => {
    const name = await ask({ label: 'Save the current style as', value: '', okLabel: 'Save', validate: (n) => presetNameProblem(n, settings, { allowExisting: true }) });
    if (name === null) return;
    const clash = findUserPresetByName(name, settings);
    if (clash && !(await ask({ label: 'A preset named "' + clash.name + '" already exists. Overwrite it?', okLabel: 'Overwrite' }))) return;
    saveUserPreset(name, settings); notify('Saved style preset "' + name + '".', 'success');
  });
  renameBtn.addEventListener('click', async () => {
    const p = chosenPreset(); if (!p) return;
    const name = await ask({ label: 'Rename "' + p.name + '" to', value: p.name, okLabel: 'Rename', validate: (n) => presetNameProblem(n, settings, { exceptId: p.id }) });
    if (name !== null) renameUserPreset(p.id, name, settings);
  });
  deleteBtn.addEventListener('click', async () => {
    const p = chosenPreset(); if (!p) return;
    if (await ask({ label: 'Delete the preset "' + p.name + '"?', okLabel: 'Delete' })) { deleteUserPreset(p.id, settings); notify('Deleted style preset "' + p.name + '".', 'success'); }
  });
  body.appendChild(tplRow);

  // Tabs: the control->tab mapping is the declared `tab` of each CONTROLS entry; the Units tab holds the document unit.
  const tabBar = document.createElement('div'); tabBar.className = 'sk-style-tabs'; tabBar.setAttribute('role', 'tablist');
  const tabBtns = {}, tabPanels = {};
  for (const t of TABS) {
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'sk-style-tab'; btn.textContent = t.label;
    btn.id = 'sk-style-tab-' + t.id; btn.dataset.tab = t.id; btn.setAttribute('role', 'tab');
    btn.addEventListener('click', () => selectTab(t.id));
    btn.addEventListener('keydown', (e) => {
      const i = TABS.findIndex((x) => x.id === t.id);
      const n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : null;
      if (n === null) return;
      e.preventDefault(); const to = TABS[(n + TABS.length) % TABS.length].id; selectTab(to); tabBtns[to].focus();
    });
    const panel = document.createElement('div'); panel.className = 'sk-style-tabpanel'; panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', btn.id); panel.dataset.tab = t.id;
    tabBar.appendChild(btn); tabBtns[t.id] = btn; tabPanels[t.id] = panel;
  }
  body.appendChild(tabBar);
  for (const spec of CONTROLS) tabPanels[spec.tab].appendChild(buildControl(spec));
  for (const t of TABS) body.appendChild(tabPanels[t.id]);

  // ONE document-unit control for every host (writes DOC_UNIT; cut params, dimension edit etc. re-read it on change).
  const unitRow = document.createElement('div'); unitRow.className = 'sk-style-tpl';
  const unitTop = document.createElement('div'); unitTop.className = 'sk-style-rowtop';
  const unitLab = document.createElement('span'); unitLab.className = 'sk-style-label'; unitLab.textContent = 'Document Unit';
  const docUnitSelect = document.createElement('select'); docUnitSelect.className = 'sk-style-input'; docUnitSelect.dataset.key = 'DOC_UNIT';
  for (const u of UNITS) { const o = document.createElement('option'); o.value = u; o.textContent = UNIT_LABELS[u] || u; docUnitSelect.appendChild(o); }
  docUnitSelect.addEventListener('change', () => settings.set('DOC_UNIT', docUnitSelect.value, { persist: 'local' }));
  unitTop.append(unitLab, docUnitSelect); unitRow.appendChild(unitTop); tabPanels.units.appendChild(unitRow);

  const tabStoreKey = 'sketch-studio-style-tab:' + hostId;
  function selectTab(id) {
    if (!tabPanels[id]) id = TABS[0].id;
    for (const t of TABS) {
      const on = t.id === id;
      tabPanels[t.id].hidden = !on; tabBtns[t.id].setAttribute('aria-selected', on ? 'true' : 'false'); tabBtns[t.id].tabIndex = on ? 0 : -1;
      tabBtns[t.id].classList.toggle('sk-active', on);
    }
    try { localStorage.setItem(tabStoreKey, id); } catch (_) { /* storage unavailable: the tab just is not remembered */ }
  }
  let savedTab = null;
  try { savedTab = localStorage.getItem(tabStoreKey); } catch (_) { /* storage unavailable */ }
  selectTab(savedTab);

  // Footer (Reset + Close)
  const foot = document.createElement('div'); foot.className = 'sk-style-foot';
  const resetBtn = document.createElement('button'); resetBtn.type = 'button'; resetBtn.className = 'sk-style-btn'; resetBtn.textContent = 'Reset';
  // Reset restores the factory LOOK; the user's saved presets are their data, not look settings, so they are put back after it.
  resetBtn.addEventListener('click', () => { const mine = settings.get(USER_PRESETS_KEY); settings.resetToDefaults(); settings.set(USER_PRESETS_KEY, mine, { persist: 'local' }); populate(); notify('Reset to factory defaults.', 'success'); });
  const closeBtn = document.createElement('button'); closeBtn.type = 'button'; closeBtn.className = 'sk-style-btn'; closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', () => close());
  foot.append(resetBtn, closeBtn);

  el.append(head, body, foot);

  function buildControl(spec) {
    const row = document.createElement('div'); row.className = 'sk-style-row';
    row.dataset.row = spec.key;
    const top = document.createElement('div'); top.className = 'sk-style-rowtop';
    const lab = document.createElement('span'); lab.className = 'sk-style-label'; lab.textContent = spec.label;
    top.appendChild(lab);
    if (spec.type === 'checkbox') {
      const input = document.createElement('input'); input.type = 'checkbox'; input.className = 'sk-style-input'; input.dataset.key = spec.key;
      input.addEventListener('change', () => settings.set(spec.key, !!input.checked, { persist: 'local' }));
      top.appendChild(input); row.appendChild(top);
      controlEls[spec.key] = { input, row };
    } else if (spec.type === 'select') {
      const input = document.createElement('select'); input.className = 'sk-style-input'; input.dataset.key = spec.key;
      for (const o of spec.options) { const opt = document.createElement('option'); opt.value = o.value; opt.textContent = o.label; input.appendChild(opt); }
      input.addEventListener('change', () => settings.set(spec.key, spec.numeric ? Number(input.value) : input.value, { persist: 'local' }));
      top.appendChild(input); row.appendChild(top);
      controlEls[spec.key] = { input, row };
    } else {
      const input = document.createElement('input'); input.type = 'number'; input.className = 'sk-style-input'; input.dataset.key = spec.key;
      input.min = String(spec.min); input.max = String(spec.max); input.step = String(spec.step);
      const slider = document.createElement('input'); slider.type = 'range'; slider.className = 'sk-style-slider';
      slider.min = String(spec.min); slider.max = String(spec.max); slider.step = String(spec.step);
      const write = (v) => settings.set(spec.key, Number(v), { persist: 'local' });
      input.addEventListener('input', () => { slider.value = input.value; write(input.value); });
      input.addEventListener('change', () => { slider.value = input.value; write(input.value); });
      slider.addEventListener('input', () => { input.value = slider.value; write(slider.value); });
      top.appendChild(input); row.append(top, slider);
      controlEls[spec.key] = { input, slider, row };
    }
    return row;
  }

  function populate() {
    const all = settings.getAll();
    for (const spec of CONTROLS) {
      const c = controlEls[spec.key]; if (!c) continue;
      if (spec.showWhen) c.row.hidden = !spec.showWhen.in.includes(all[spec.showWhen.key] || 'mm');
      const v = all[spec.key];
      if (spec.type === 'checkbox') { c.input.checked = !!v; }
      else if (spec.type === 'select') { c.input.value = spec.options.some((o) => String(o.value) === String(v)) ? v : spec.options[0].value; }
      else { c.input.value = v; if (c.slider) c.slider.value = v; }
    }
    docUnitSelect.value = settings.get('DOC_UNIT') || 'mm';
    buildTplOptions();
    tplSelect.value = activeStyleTemplateId(all);
    const mine = isUserPresetId(tplSelect.value, settings);
    renameBtn.hidden = !mine; deleteBtn.hidden = !mine;
  }

  // Live re-populate on any external change. subscribe RETURNS its unsubscribe — keep it; call it in destroy().
  const unsub = settings.subscribe(() => { try { populate(); } catch (_) {} });

  function open() {
    if (isOpen) return;
    isOpen = true; el.classList.remove('sk-hidden'); populate();
    escHandler = (e) => { if (e.key === 'Escape') close(); };
    outsideHandler = (e) => { if (!e.composedPath().includes(el)) close(); }; // the path, not contains(): a clicked inline-question button is already removed by then
    document.addEventListener('keydown', escHandler);
    setTimeout(() => { if (isOpen) document.addEventListener('click', outsideHandler); }, 0); // defer so the opening click doesn't close it
  }
  function close() {
    if (!isOpen) return;
    isOpen = false; el.classList.add('sk-hidden');
    if (escHandler) { document.removeEventListener('keydown', escHandler); escHandler = null; }
    if (outsideHandler) { document.removeEventListener('click', outsideHandler); outsideHandler = null; }
  }
  function toggle() { isOpen ? close() : open(); }

  populate();
  return {
    el, open, close, toggle,
    render: (container) => { if (container) container.appendChild(el); return el; },
    destroy: () => { close(); try { unsub && unsub(); } catch (_) {} try { el.remove(); } catch (_) {} },
  };
}
