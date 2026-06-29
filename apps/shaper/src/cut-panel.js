// Shaper Prepare — the cut-settings card (SP1f cut-TYPE; SP1g depth/offset/bit rows; U3a units).
// Pure view: it reflects the selected target's cut record (values stored in BASE mm) and emits picks/edits via
// callbacks. Cut params parse/format through #core/units.js per the document unit, and RE-LABEL when DOC_UNIT changes.
// Cut data + gating live in shaper.js; the live records live in prepare-view.js (CUT_PLAN).

import { availableTypes, cutTypeById } from './shaper.js';
import SettingsManager from '#core/settings-manager.js';
import { parse as parseUnit, format as formatUnit } from '#core/units.js';

// Menu order per the Shaper mockup: path types first (on line / guide), then region (inside / pocket / outside).
const MENU_ORDER = ['online', 'guide', 'interior', 'pocket', 'exterior'];
const swatch = (t) => { const c = (t.previewStroke && t.previewStroke !== 'none') ? t.previewStroke : t.previewFill; return (c && c !== 'none') ? c : 'var(--sk-muted, #9aa0a6)'; };

// DECLARED data: quick bit-diameter presets. VALUES are BASE mm (U3a); LABELS stay imperial bit sizes (× 25.4 mm/in).
const BIT_PRESETS = [
  { label: '.02', value: 0.508 },   // .02 in
  { label: '1/8', value: 3.175 },   // 1/8 in
  { label: '1/4', value: 6.35 },    // 1/4 in
  { label: '1/2', value: 12.7 },    // 1/2 in
];
const DEPTH_START = 0.1;   // first value (in the DOC unit) when stepping up/down from 'unset'
const DEPTH_STEP = 0.05;   // step increment, in the DOC unit
const TOOLDIA_DEFAULT_MM = 3.175; // 1/8 in

const getDocUnit = () => SettingsManager.get('DOC_UNIT') || 'mm';
const fmt = (baseMM) => formatUnit(baseMM, getDocUnit(), { decimals: 3 });               // BASE mm → doc-unit string (3 dp)
const toDocNum = (baseMM) => Number(formatUnit(baseMM, getDocUnit(), { decimals: 6 }));  // BASE mm → doc-unit number
const isUnset = (v) => v === 'unset' || v == null;

export function createCutPanel(hostEl, opts = {}) {
  if (!hostEl) return { update() {}, destroy() {} };
  const onPickType = opts.onPickType || (() => {});
  const onSetField = opts.onSetField || (() => {});
  hostEl.innerHTML = '';

  const card = document.createElement('div');
  card.className = 'cut-card';
  card.hidden = true;
  card.innerHTML = `
    <div class="cut-card-title">Cut</div>
    <div class="cut-field">
      <label class="cut-field-label">Cut type</label>
      <div class="cut-type-dd">
        <button type="button" class="cut-type-trigger" aria-haspopup="listbox" aria-expanded="false">
          <span class="cut-sw"></span><span class="cut-type-cur">Select type</span><span class="cut-caret">&#9662;</span>
        </button>
        <div class="cut-type-menu" role="listbox" hidden></div>
      </div>
    </div>
    <div class="cut-rows">
      <div class="cut-row">
        <label class="cut-field-label">Depth</label>
        <div class="cut-stepper">
          <button type="button" class="cut-step" data-d="-1" aria-label="Decrease depth">&#8722;</button>
          <input type="text" class="cut-num cut-depth" inputmode="decimal" placeholder="unset">
          <button type="button" class="cut-step" data-d="1" aria-label="Increase depth">+</button>
          <span class="cut-unit">mm</span>
        </div>
      </div>
      <div class="cut-row">
        <label class="cut-field-label">Offset</label>
        <div class="cut-inline">
          <button type="button" class="cut-flip" title="Flip offset direction" aria-pressed="false">&#8644;</button>
          <input type="text" class="cut-num cut-offset" inputmode="decimal">
          <span class="cut-unit">mm</span>
        </div>
      </div>
      <div class="cut-row">
        <label class="cut-field-label">Bit diameter</label>
        <div class="cut-inline">
          <input type="text" class="cut-num cut-bit" inputmode="decimal">
          <span class="cut-unit">mm</span>
        </div>
        <div class="cut-presets"></div>
      </div>
    </div>`;
  hostEl.appendChild(card);

  const $ = (sel) => card.querySelector(sel);
  const trigger = $('.cut-type-trigger'), menu = $('.cut-type-menu'), curLabel = $('.cut-type-cur'), curSw = $('.cut-sw');
  const depthInput = $('.cut-depth'), offsetInput = $('.cut-offset'), flipBtn = $('.cut-flip'), bitInput = $('.cut-bit'), presetsWrap = $('.cut-presets');
  const unitEls = card.querySelectorAll('.cut-unit'); // the unit suffix labels — re-labeled to the doc unit

  let current = { kind: null, cutType: null, cutDepth: 'unset', cutOffset: 0, toolDia: TOOLDIA_DEFAULT_MM };

  // ── cut-type dropdown (SP1f) ──
  const closeMenu = () => { menu.hidden = true; trigger.setAttribute('aria-expanded', 'false'); };
  function buildMenu() {
    const avail = new Set(availableTypes(current.kind).map((t) => t.id));
    menu.innerHTML = '';
    for (const id of MENU_ORDER) {
      const t = cutTypeById(id); if (!t) continue;
      const enabled = avail.has(id);
      const opt = document.createElement('button');
      opt.type = 'button';
      opt.className = 'cut-type-opt' + (id === current.cutType ? ' is-current' : '') + (enabled ? '' : ' is-disabled');
      opt.setAttribute('role', 'option'); opt.dataset.id = id; opt.disabled = !enabled;
      opt.innerHTML = `<span class="cut-sw" style="background:${swatch(t)}"></span><span>${t.menuLabel}</span>`;
      if (enabled) opt.addEventListener('click', () => { closeMenu(); onPickType(id); });
      menu.appendChild(opt);
    }
  }
  trigger.addEventListener('click', (e) => { e.stopPropagation(); const opening = menu.hidden; if (opening) buildMenu(); menu.hidden = !opening; trigger.setAttribute('aria-expanded', String(opening)); });
  const onDocClick = (e) => { if (!card.contains(e.target)) closeMenu(); };
  document.addEventListener('click', onDocClick);

  // ── param rows (SP1g + U3a units) — values stored/emitted in BASE mm ──
  for (const p of BIT_PRESETS) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'cut-preset'; b.dataset.value = String(p.value); b.textContent = p.label;
    b.addEventListener('click', () => onSetField('toolDia', p.value)); // base mm
    presetsWrap.appendChild(b);
  }
  card.querySelectorAll('.cut-step').forEach((btn) => btn.addEventListener('click', () => {
    const d = Number(btn.dataset.d);
    // step in the DOC unit, then store BASE mm (step from 'unset' → the start value)
    const curDoc = isUnset(current.cutDepth) ? null : toDocNum(Number(current.cutDepth));
    const nextDoc = curDoc == null ? DEPTH_START : Math.max(0, +(curDoc + d * DEPTH_STEP).toFixed(6));
    onSetField('cutDepth', parseUnit(String(nextDoc), getDocUnit())); // → base mm
  }));
  depthInput.addEventListener('change', () => { const v = depthInput.value.trim(); onSetField('cutDepth', v === '' ? 'unset' : (parseUnit(v, getDocUnit()) ?? 'unset')); });
  offsetInput.addEventListener('change', () => onSetField('cutOffset', parseUnit(offsetInput.value, getDocUnit()) ?? 0));
  flipBtn.addEventListener('click', () => onSetField('cutOffset', -(Number(current.cutOffset) || 0))); // sign flip (base mm)
  bitInput.addEventListener('change', () => { const n = parseUnit(bitInput.value, getDocUnit()); if (n != null) onSetField('toolDia', n); });

  // Re-format the displayed values (BASE mm → doc unit). Called on selection change AND on DOC_UNIT change (re-label).
  const renderFields = () => {
    depthInput.value = isUnset(current.cutDepth) ? '' : fmt(current.cutDepth);
    const off = Number(current.cutOffset) || 0;
    offsetInput.value = fmt(off);
    flipBtn.classList.toggle('is-on', off < 0);
    flipBtn.setAttribute('aria-pressed', String(off < 0));
    const dia = Number(current.toolDia) || 0;
    bitInput.value = fmt(dia);
    presetsWrap.querySelectorAll('.cut-preset').forEach((b) => b.classList.toggle('is-active', Math.abs(Number(b.dataset.value) - dia) < 1e-6));
    const u = getDocUnit();
    unitEls.forEach((el) => { el.textContent = u; });
  };

  // update(model | null): null → hide the card; else show + reflect the selected target's record (values in BASE mm).
  const update = (model) => {
    if (!model) { card.hidden = true; closeMenu(); current = { kind: null, cutType: null, cutDepth: 'unset', cutOffset: 0, toolDia: TOOLDIA_DEFAULT_MM }; return; }
    const rec = model.record || {};
    current = { kind: model.kind, cutType: rec.cutType || null, cutDepth: rec.cutDepth, cutOffset: rec.cutOffset, toolDia: rec.toolDia };
    card.hidden = false;
    const t = current.cutType ? cutTypeById(current.cutType) : null;
    curLabel.textContent = t ? t.menuLabel : 'Select type';
    curSw.style.background = t ? swatch(t) : 'transparent';
    if (!menu.hidden) buildMenu();
    renderFields();
  };

  // U3a: re-label the cut params live when the document unit changes (no toggle yet — verify by setting DOC_UNIT).
  const unsub = (typeof SettingsManager.subscribe === 'function')
    ? SettingsManager.subscribe((key) => { if (key === 'DOC_UNIT' && !card.hidden) renderFields(); })
    : () => {};

  return { update, destroy() { document.removeEventListener('click', onDocClick); try { unsub(); } catch (_) {} hostEl.innerHTML = ''; } };
}
