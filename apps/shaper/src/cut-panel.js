// Shaper Prepare — the cut-settings card (SP1f cut-TYPE; SP1g depth/offset/bit rows; U3a units).
// Pure view: it reflects the selected target's cut record (values stored in BASE mm) and emits picks/edits via
// callbacks. Cut params parse/format through #core/units.js per the document unit, and RE-LABEL when DOC_UNIT changes.
// Cut data + gating live in shaper.js; the live records live in prepare-view.js (CUT_PLAN).

import { availableTypes, cutTypeById, cutTypeHasParam, CUTTER_SHAPES, OFFSET_PRESETS, VBIT_PRESETS } from './shaper.js';
import SettingsManager from '#core/settings-manager.js';
import { parse as parseUnit, format as formatUnit } from '#core/units.js';

// Menu order per the Shaper mockup: path types first (on line / guide), then region (inside / pocket / outside).
const MENU_ORDER = ['online', 'guide', 'interior', 'pocket', 'exterior', 'stock']; // TASK 472: Stock last (it is the board, not a cut)
// TASK 455: each cut type carries its own icon (CUT_TYPES.icon, 18x18 inner markup in currentColor); colours are CSS tokens.
const iconSvg = (t) => `<svg class="cut-ic" viewBox="0 0 18 18" aria-hidden="true">${(t && t.icon) || ''}</svg>`;

// DECLARED data: quick bit-diameter presets. VALUES are BASE mm (U3a); LABELS stay imperial bit sizes (× 25.4 mm/in).
const BIT_PRESETS = [
  { label: '.02', value: 0.508 },   // .02 in
  { label: '⅛', value: 3.175 },   // 1/8 in
  { label: '¼', value: 6.35 },    // 1/4 in
  { label: '½', value: 12.7 },    // 1/2 in
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
  const onSetFields = opts.onSetFields || ((o) => { for (const [k, v] of Object.entries(o)) onSetField(k, v); }); // TASK 463: several fields = ONE undo step
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
          <span class="cut-ic-slot"></span><span class="cut-type-cur">Select type</span><svg class="cut-caret" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 5l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    </div>
    <div class="cut-rows">
      <div class="cut-row" data-param="cutDepth">
        <label class="cut-field-label">Depth</label>
        <div class="cut-stepper cut-box">
          <button type="button" class="cut-step" data-d="-1" aria-label="Decrease depth">&#8722;</button>
          <div class="cut-mid"><input type="text" class="cut-num cut-depth" inputmode="decimal" placeholder="unset"><span class="cut-unit">mm</span></div>
          <button type="button" class="cut-step" data-d="1" aria-label="Increase depth">+</button>
        </div>
      </div>
      <div class="cut-row" data-param="cutOffset">
        <label class="cut-field-label">Offset</label>
        <div class="cut-inline cut-box cut-offset-box">
          <button type="button" class="cut-flip" title="Flip offset direction" aria-label="Flip offset" aria-pressed="false"><svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true"><path d="M2 4h9l-2.5-2.5M12 8H3l2.5 2.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          <input type="text" class="cut-num cut-offset" inputmode="decimal">
          <span class="cut-unit">mm</span>
        </div>
      </div>
      <div class="cut-row" data-param="toolDia">
        <label class="cut-field-label">Bit diameter</label>
        <div class="cut-inline cut-box">
          <span class="cut-dia-prefix">D</span>
          <input type="text" class="cut-num cut-bit" inputmode="decimal">
          <span class="cut-unit">mm</span>
        </div>
        <div class="cut-presets"></div>
      </div>
      <div class="cut-row" data-row="cutterShape">
        <label class="cut-field-label">Cutter shape</label>
        <button type="button" class="cut-shape-trigger" aria-haspopup="listbox" aria-expanded="false">
          <span class="cut-shape-ic"></span><span class="cut-shape-cur">Flat</span><svg class="cut-caret" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 5l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    </div>
    <div class="cut-pop cut-type-menu" role="listbox" hidden></div>
    <div class="cut-pop cut-offset-pop" hidden></div>
    <div class="cut-pop cut-shape-pop" role="listbox" hidden></div>`;
  hostEl.appendChild(card);

  const $ = (sel) => card.querySelector(sel);
  const trigger = $('.cut-type-trigger'), menu = $('.cut-type-menu'), offsetPop = $('.cut-offset-pop'), shapePop = $('.cut-shape-pop'), shapeTrigger = $('.cut-shape-trigger'), shapeIc = $('.cut-shape-ic'), shapeCur = $('.cut-shape-cur'), curLabel = $('.cut-type-cur'), curSw = $('.cut-ic-slot');
  const depthInput = $('.cut-depth'), offsetInput = $('.cut-offset'), flipBtn = $('.cut-flip'), bitInput = $('.cut-bit'), presetsWrap = $('.cut-presets');
  const unitEls = card.querySelectorAll('.cut-unit'); // the unit suffix labels — re-labeled to the doc unit

  let current = { kind: null, cutType: null, cutDepth: 'unset', cutOffset: 0, toolDia: TOOLDIA_DEFAULT_MM, cutterShape: 'endmill', cutterAngle: 90 };

  // TASK 455: popovers open to the LEFT of the card, aligned with the row that opened them (the card is their positioned parent)
  const pops = [menu, offsetPop, shapePop];
  const syncOpenState = () => {
    trigger.setAttribute('aria-expanded', String(!menu.hidden)); trigger.classList.toggle('is-open', !menu.hidden);
    shapeTrigger.setAttribute('aria-expanded', String(!shapePop.hidden)); shapeTrigger.classList.toggle('is-open', !shapePop.hidden);
  };
  const closePops = (except) => { for (const p of pops) if (p !== except) p.hidden = true; syncOpenState(); };
  const openPop = (pop, anchor) => { closePops(pop); pop.style.top = (anchor.closest('.cut-row, .cut-field') || anchor).offsetTop + 'px'; pop.hidden = false; syncOpenState(); };

  // ── cut-type dropdown (SP1f) ──
  const closeMenu = () => { menu.hidden = true; syncOpenState(); };
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
      opt.innerHTML = `${iconSvg(t)}<span>${t.menuLabel}</span>`;
      if (enabled) opt.addEventListener('click', () => { closeMenu(); onPickType(id); });
      menu.appendChild(opt);
    }
  }
  trigger.addEventListener('click', (e) => { e.stopPropagation(); if (menu.hidden) { buildMenu(); openPop(menu, trigger); } else closeMenu(); });
  const onDocClick = (e) => { if (!e.composedPath().includes(card)) closePops(null); }; // composedPath: a clicked row may already be re-rendered away
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
  // offset presets popover (3x2): opens on focus (the value is selected so typing replaces it), closes on blur / pick
  const buildOffsetPop = () => {
    offsetPop.innerHTML = '<div class="cut-pop-title">presets</div><div class="cut-pop-grid"></div>';
    const grid = offsetPop.querySelector('.cut-pop-grid');
    for (const p of OFFSET_PRESETS) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'cut-preset'; b.dataset.mm = String(p.mm);
      b.textContent = getDocUnit() === 'in' ? p.label : fmt(p.mm); // mm/cm docs show the converted values (UNVERIFIED vs Studio)
      if (Math.abs(Math.abs(Number(current.cutOffset) || 0) - p.mm) < 1e-6) b.classList.add('is-active');
      b.addEventListener('click', () => { onSetField('cutOffset', p.mm); closePops(null); });
      grid.appendChild(b);
    }
  };
  offsetPop.addEventListener('mousedown', (e) => e.preventDefault()); // keep the field focused while picking
  offsetInput.addEventListener('focus', () => { buildOffsetPop(); openPop(offsetPop, offsetInput); offsetInput.select(); });
  offsetInput.addEventListener('blur', () => { offsetPop.hidden = true; syncOpenState(); });
  offsetInput.addEventListener('change', () => onSetField('cutOffset', parseUnit(offsetInput.value, getDocUnit()) ?? 0));
  flipBtn.addEventListener('click', () => onSetField('cutOffset', -(Number(current.cutOffset) || 0))); // sign flip (base mm)
  bitInput.addEventListener('change', () => { const n = parseUnit(bitInput.value, getDocUnit()); if (n != null) onSetField('toolDia', n); });

  // cutter shape popover: flat / ball nose / V-bit rows; the V-bit row carries its angle presets (the EXISTING VBIT_PRESETS)
  const buildShapePop = () => {
    shapePop.innerHTML = '';
    for (const sh of CUTTER_SHAPES) {
      const opt = document.createElement('button');
      opt.type = 'button'; opt.className = 'cut-type-opt' + (sh.id === current.cutterShape ? ' is-current' : ''); opt.dataset.shape = sh.id;
      opt.innerHTML = `${iconSvg(sh)}<span>${sh.label}</span>`;
      opt.addEventListener('click', () => { onSetField('cutterShape', sh.id); if (sh.id === 'vbit') { current.cutterShape = 'vbit'; buildShapePop(); } else closePops(null); }); // a V-bit pick stays open to show its angles
      shapePop.appendChild(opt);
      if (sh.id === 'vbit' && current.cutterShape === 'vbit') {
        const row = document.createElement('div'); row.className = 'cut-shape-angles';
        for (const v of VBIT_PRESETS) {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'cut-preset' + (current.cutterShape === 'vbit' && Number(current.cutterAngle) === v.angle ? ' is-active' : ''); b.dataset.angle = String(v.angle); b.textContent = v.angle + '\u00b0';
          b.addEventListener('click', () => { onSetFields({ cutterShape: 'vbit', cutterAngle: v.angle }); closePops(null); });
          row.appendChild(b);
        }
        shapePop.appendChild(row);
      }
    }
  };
  shapeTrigger.addEventListener('click', (e) => { e.stopPropagation(); if (shapePop.hidden) { buildShapePop(); openPop(shapePop, shapeTrigger); } else closePops(null); });

  // Re-format the displayed values (BASE mm → doc unit). Called on selection change AND on DOC_UNIT change (re-label).
  const renderFields = () => {
    depthInput.value = isUnset(current.cutDepth) ? '' : fmt(current.cutDepth);
    // TASK 450b: show only the rows of the params this cut type declares (Guide: none; On line: no Offset)
    card.querySelectorAll('.cut-row[data-param]').forEach((row) => { row.style.display = cutTypeHasParam(current.cutType, row.dataset.param) ? '' : 'none'; });
    // TASK 472: the cutter shape belongs with the bit: a type without a bit diameter (Stock) has no shape row; its depth row reads Thickness
    card.querySelector('.cut-row[data-row="cutterShape"]').style.display = cutTypeHasParam(current.cutType, 'toolDia') ? '' : 'none';
    const curType = current.cutType ? cutTypeById(current.cutType) : null;
    card.querySelector('.cut-row[data-param="cutDepth"] .cut-field-label').textContent = (curType && curType.depthLabel) || 'Depth';
    const off = Number(current.cutOffset) || 0;
    offsetInput.value = fmt(off);
    flipBtn.classList.toggle('is-on', off < 0);
    flipBtn.setAttribute('aria-pressed', String(off < 0));
    const dia = Number(current.toolDia) || 0;
    bitInput.value = fmt(dia);
    presetsWrap.querySelectorAll('.cut-preset').forEach((b) => b.classList.toggle('is-active', Math.abs(Number(b.dataset.value) - dia) < 1e-6));
    const shape = CUTTER_SHAPES.find((x) => x.id === current.cutterShape) || CUTTER_SHAPES[0];
    shapeIc.innerHTML = iconSvg(shape); shapeCur.textContent = shape.id === 'vbit' ? `${shape.label} ${Number(current.cutterAngle) || 90}\u00b0` : shape.label;
    const u = getDocUnit();
    unitEls.forEach((el) => { el.textContent = u; });
  };

  // update(model | null): null → hide the card; else show + reflect the selected target's record (values in BASE mm).
  const update = (model) => {
    if (!model) { card.hidden = true; closeMenu(); current = { kind: null, cutType: null, cutDepth: 'unset', cutOffset: 0, toolDia: TOOLDIA_DEFAULT_MM, cutterShape: 'endmill', cutterAngle: 90 }; return; }
    const rec = model.record || {};
    current = { kind: model.kind, cutType: rec.cutType || null, cutDepth: rec.cutDepth, cutOffset: rec.cutOffset, toolDia: rec.toolDia, cutterShape: rec.cutterShape || 'endmill', cutterAngle: rec.cutterAngle || 90 };
    card.hidden = false;
    const t = current.cutType ? cutTypeById(current.cutType) : null;
    curLabel.textContent = t ? t.menuLabel : 'Select type';
    curSw.innerHTML = t ? iconSvg(t) : '';
    if (!menu.hidden) buildMenu();
    if (!shapePop.hidden) buildShapePop();
    renderFields();
  };

  // U3a: re-label the cut params live when the document unit changes (the Style panel's Units tab sets DOC_UNIT).
  const unsub = (typeof SettingsManager.subscribe === 'function')
    ? SettingsManager.subscribe((key) => { if (key === 'DOC_UNIT' && !card.hidden) renderFields(); })
    : () => {};

  return { update, destroy() { document.removeEventListener('click', onDocClick); try { unsub(); } catch (_) {} hostEl.innerHTML = ''; } };
}
