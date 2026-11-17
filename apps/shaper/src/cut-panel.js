// Shaper Prepare — the cut-settings card (SP1f cut-TYPE; SP1g depth/offset/bit rows; U3a units).
// Pure view: it reflects the selected target's cut record (values stored in BASE mm) and emits picks/edits via
// callbacks. Cut params parse/format through #core/units.js per the document unit, and RE-LABEL when DOC_UNIT changes.
// Cut data + gating live in shaper.js; the live records live in prepare-view.js (CUT_PLAN).

import { availableTypes, cutTypeById, cutTypeHasParam, CUTTER_SHAPES, OFFSET_PRESETS, VBIT_PRESETS, BIT_PRESETS } from './shaper.js'; // TASK 743: BIT_PRESETS is declared there now (an operation names its bit by it)
import { STEP_DEPTH, STEP_RESOLUTION } from '#core/stepped-cut.js';
import { HOLD_PART, holdDefaults } from '#core/hold-part.js'; // TASK 742: the Hold part choice and its defaults
import SettingsManager, { docUnit, lengthDecimals } from '#core/settings-manager.js';
import { attachStepper } from './number-stepper.js';
import { parse as parseUnit, format as formatUnit } from '#core/units.js';

// Menu order per the Shaper mockup: path types first (on line / guide), then region (inside / pocket / outside).
// TASK 714: each STEPPED type right after its plain type; a stepped type is listed only when the target can take it (its record carries that slope).
const MENU_ORDER = ['online', 'guide', 'interior', 'stepped-inside', 'pocket', 'stepped-pocket', 'exterior', 'stepped-outside', 'stock']; // TASK 472: Stock last (it is the board, not a cut)
// TASK 455: each cut type carries its own icon (CUT_TYPES.icon, 18x18 inner markup in currentColor); colours are CSS tokens.
const iconSvg = (t) => `<svg class="cut-ic" viewBox="0 0 18 18" aria-hidden="true">${(t && t.icon) || ''}</svg>`;

// TASK 715: the Step presets FOLLOW the document unit. VALUES are BASE mm; inches = imperial fractions, any metric unit = round mm.
const IN = 25.4;
const STEP_PRESETS = {
  in: [{ label: '1/32', value: IN / 32 }, { label: '1/16', value: IN / 16 }, { label: '1/8', value: IN / 8 }, { label: '1/4', value: IN / 4 }],
  mm: [{ label: '0.5', value: 0.5 }, { label: '1', value: 1 }, { label: '2', value: 2 }, { label: '3', value: 3 }],
};
const presetsFor = (table) => table[docUnit()] || table.mm;
// TASK 717: the Resolution presets of adaptive stepping (the named maximum deviations, #core STEP_RESOLUTION; values base mm). A typed value = Custom.
const RESOLUTION_PRESETS = STEP_RESOLUTION.levels.map((l) => ({ label: l.label, value: l.mm }));
// TASK 730: each stepped field DECLARES its − / + step (in the DOCUMENT unit, per family; number-stepper.js holds the one press / hold / snap code) and min (BASE mm).
// min: the depth may reach 0 (as typing allows); a bit / step / resolution is a size (positive: any value above 0, never 0); the offset has no min (negative = the other side, as today).
const STEPPERS = {
  cutDepth:      { step: { mm: 0.5, in: 1 / 32 }, min: 0 },
  cutOffset:     { step: { mm: 0.25, in: 1 / 64 } },
  toolDia:       { step: { mm: 0.5, in: 1 / 32 }, positive: true },
  stepDepth:     { step: { mm: 0.5, in: 1 / 32 }, positive: true },
  stepDeviation: { step: { mm: 0.05, in: 0.002 }, positive: true },
  // TASK 742: Hold part: a tab's width / a tab's or skin's thickness are sizes (positive); the count is a plain number (its unit family ignored: 1 in both)
  tabWidth:      { step: { mm: 1, in: 1 / 16 }, positive: true },
  holdThickness: { step: { mm: 0.5, in: 1 / 64 }, positive: true },
  tabCount:      { step: { mm: 1, in: 1 }, positive: true },
};
// TASK 742: the Hold part choice (#core HOLD_PART.modes: Off | Tabs | Onion skin) and the count's Auto, as preset buttons (the ONE preset widget)
const HOLD_PRESETS = HOLD_PART.modes.map((m) => ({ label: m.label, value: m.id }));
const COUNT_PRESETS = [{ label: 'Auto', value: 'auto' }];
const TOOLDIA_DEFAULT_MM = 3.175; // 1/8 in

const fmt = (baseMM) => formatUnit(baseMM, docUnit(), { decimals: lengthDecimals(3) });   // BASE mm → doc-unit string (3 dp unless the Length precision setting says otherwise)
const toDocNum = (baseMM) => Number(formatUnit(baseMM, docUnit(), { decimals: 6 }));  // BASE mm → doc-unit number
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
          <div class="cut-mid"><input type="text" class="cut-num cut-depth" inputmode="decimal" placeholder="unset"><span class="cut-unit">mm</span></div>
        </div>
      </div>
      <div class="cut-row" data-row="adaptiveSteps">
        <label class="cut-check"><input type="checkbox" class="cut-adaptive"><span>Adaptive stepping</span></label>
      </div>
      <div class="cut-row" data-row="stepDepth">
        <label class="cut-field-label">Step depth</label>
        <div class="cut-inline cut-box">
          <input type="text" class="cut-num cut-step-depth" inputmode="decimal">
          <span class="cut-unit">mm</span>
        </div>
        <div class="cut-presets"></div>
      </div>
      <div class="cut-row" data-row="stepDeviation">
        <label class="cut-field-label">Resolution</label>
        <div class="cut-inline cut-box">
          <input type="text" class="cut-num cut-step-deviation" inputmode="decimal">
          <span class="cut-unit">mm</span>
        </div>
        <div class="cut-presets"></div>
      </div>
      <div class="cut-row" data-row="holdPart">
        <label class="cut-field-label">Hold part</label>
        <div class="cut-presets cut-hold-modes"></div>
      </div>
      <div class="cut-row" data-row="tabCount">
        <label class="cut-field-label">Tab count</label>
        <div class="cut-inline cut-box">
          <input type="text" class="cut-num cut-tab-count" inputmode="numeric" placeholder="Auto">
          <span class="cut-presets cut-in-box"></span>
        </div>
      </div>
      <div class="cut-row" data-row="tabWidth">
        <label class="cut-field-label">Tab width</label>
        <div class="cut-inline cut-box">
          <input type="text" class="cut-num cut-tab-width" inputmode="decimal">
          <span class="cut-unit">mm</span>
        </div>
      </div>
      <div class="cut-row" data-row="holdThickness">
        <label class="cut-field-label">Tab thickness</label>
        <div class="cut-inline cut-box">
          <input type="text" class="cut-num cut-hold-thickness" inputmode="decimal">
          <span class="cut-unit">mm</span>
        </div>
      </div>
      <div class="cut-note" hidden></div>
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
  const depthInput = $('.cut-depth'), stepInput = $('.cut-step-depth'), noteEl = $('.cut-note'), offsetInput = $('.cut-offset'), flipBtn = $('.cut-flip'), bitInput = $('.cut-bit'), presetsWrap = $('.cut-row[data-param="toolDia"] .cut-presets'), stepPresetsWrap = $('.cut-row[data-row="stepDepth"] .cut-presets');
  const adaptiveInput = $('.cut-adaptive'), deviationInput = $('.cut-step-deviation'), deviationPresetsWrap = $('.cut-row[data-row="stepDeviation"] .cut-presets'); // TASK 717
  const holdModesWrap = $('.cut-hold-modes'), countInput = $('.cut-tab-count'), countPresetsWrap = $('.cut-row[data-row="tabCount"] .cut-presets') /* the Auto button, inside the count box (a row of its own would push the card past a phone's screen) */, tabWidthInput = $('.cut-tab-width'), holdThicknessInput = $('.cut-hold-thickness'); // TASK 742
  const unitEls = card.querySelectorAll('.cut-unit'); // the unit suffix labels — re-labeled to the doc unit

  let current = { kind: null, cutType: null, cutDepth: 'unset', cutOffset: 0, toolDia: TOOLDIA_DEFAULT_MM, cutterShape: 'endmill', cutterAngle: 90, stepDepth: null, adaptiveSteps: false, stepDeviation: null, holdPart: 'off', tabCount: 'auto', tabWidth: null, holdThickness: null, hold: null, record: null, note: [] };

  // TASK 455: popovers open to the LEFT of the card, aligned with the row that opened them (the card is their positioned parent)
  const pops = [menu, offsetPop, shapePop];
  const syncOpenState = () => {
    trigger.setAttribute('aria-expanded', String(!menu.hidden)); trigger.classList.toggle('is-open', !menu.hidden);
    shapeTrigger.setAttribute('aria-expanded', String(!shapePop.hidden)); shapeTrigger.classList.toggle('is-open', !shapePop.hidden);
  };
  const closePops = (except) => { for (const p of pops) if (p !== except) p.hidden = true; syncOpenState(); };
  const rowsEl = card.querySelector('.cut-rows'); // TASK 742: a tall card scrolls its rows: a popover sits at its row as shown (offsetTop minus that scroll)
  const openPop = (pop, anchor) => { closePops(pop); const row = anchor.closest('.cut-row, .cut-field') || anchor; pop.style.top = (row.offsetTop - (rowsEl.contains(row) ? rowsEl.scrollTop : 0)) + 'px'; pop.hidden = false; syncOpenState(); };

  // ── cut-type dropdown (SP1f) ──
  const closeMenu = () => { menu.hidden = true; syncOpenState(); };
  function buildMenu() {
    const avail = new Set(availableTypes(current.kind, current.record).map((t) => t.id));
    menu.innerHTML = '';
    for (const id of MENU_ORDER) {
      const t = cutTypeById(id); if (!t) continue;
      const enabled = avail.has(id);
      if (t.slopeKind && !enabled) continue; // TASK 714: a stepped type is offered only on a target with that slope (not shown greyed elsewhere)
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
  // ONE preset widget for the bit and the step rows: a button per preset (value in BASE mm), the one equal to the field's value is_active
  const renderPresets = (wrap, presets, field, value) => {
    wrap.innerHTML = '';
    for (const p of presets) {
      const b = document.createElement('button');
      const same = typeof p.value === 'number' ? Math.abs(p.value - value) < 1e-6 : p.value === value; // TASK 742: a choice preset (a string value) is active when equal
      b.type = 'button'; b.className = 'cut-preset' + (same ? ' is-active' : ''); b.dataset.value = String(p.value); b.textContent = p.label;
      b.addEventListener('click', () => onSetField(field, p.value)); // base mm
      wrap.appendChild(b);
    }
  };
  // ONE stepper widget (number-stepper.js) for every stepped field: it reads the record's exact value (never the rounded text) and commits a doc-unit number -> base mm
  const stepperFor = (field, input, label, opts) => attachStepper(input, STEPPERS[field], {
    unit: docUnit, toDoc: toDocNum,
    read: () => (field === 'cutDepth' ? (isUnset(current.cutDepth) ? null : toDocNum(Number(current.cutDepth))) : toDocNum(fieldBase(field))),
    commit: (docNum) => onSetField(field, parseUnit(String(docNum), docUnit())), // -> base mm
  }, { label, ...opts });
  const fieldBase = (field) => field === 'cutOffset' ? Number(current.cutOffset) || 0
    : field === 'toolDia' ? Number(current.toolDia) || 0
    : field === 'stepDepth' ? (Number(current.stepDepth) > 0 ? Number(current.stepDepth) : STEP_DEPTH.defaultMm)
    : field === 'tabWidth' ? (Number(current.tabWidth) > 0 ? Number(current.tabWidth) : holdDefaults(docUnit()).tabWidth)
    : field === 'holdThickness' ? (Number(current.holdThickness) > 0 ? Number(current.holdThickness) : holdDefaults(docUnit()).thickness)
    : (Number(current.stepDeviation) > 0 ? Number(current.stepDeviation) : STEP_RESOLUTION.defaultMm);
  depthInput.addEventListener('change', () => { const v = depthInput.value.trim(); onSetField('cutDepth', v === '' ? 'unset' : (parseUnit(v, docUnit()) ?? 'unset')); });
  // TASK 714: the STEP DEPTH of a stepped cut (doc unit in, base mm stored)
  stepInput.addEventListener('change', () => { const n = parseUnit(stepInput.value, docUnit()); if (n != null && Number.isFinite(n) && n > 0) onSetField('stepDepth', n); else renderFields(); });
  // TASK 717: ADAPTIVE stepping (per record) and its RESOLUTION (the maximum deviation: doc unit in, base mm stored)
  adaptiveInput.addEventListener('change', () => onSetField('adaptiveSteps', adaptiveInput.checked));
  deviationInput.addEventListener('change', () => { const n = parseUnit(deviationInput.value, docUnit()); if (n != null && Number.isFinite(n) && n > 0) onSetField('stepDeviation', n); else renderFields(); });
  // offset presets popover (3x2): opens on focus (the value is selected so typing replaces it), closes on blur / pick
  const buildOffsetPop = () => {
    offsetPop.innerHTML = '<div class="cut-pop-title">presets</div><div class="cut-pop-grid"></div>';
    const grid = offsetPop.querySelector('.cut-pop-grid');
    for (const p of OFFSET_PRESETS) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'cut-preset'; b.dataset.mm = String(p.mm);
      b.textContent = docUnit() === 'in' ? p.label : fmt(p.mm); // mm/cm docs show the converted values (UNVERIFIED vs Studio)
      if (Math.abs(Math.abs(Number(current.cutOffset) || 0) - p.mm) < 1e-6) b.classList.add('is-active');
      b.addEventListener('click', () => { onSetField('cutOffset', p.mm); closePops(null); });
      grid.appendChild(b);
    }
  };
  offsetPop.addEventListener('mousedown', (e) => e.preventDefault()); // keep the field focused while picking
  offsetInput.addEventListener('focus', () => { buildOffsetPop(); openPop(offsetPop, offsetInput); offsetInput.select(); });
  offsetInput.addEventListener('blur', () => { offsetPop.hidden = true; syncOpenState(); });
  offsetInput.addEventListener('change', () => onSetField('cutOffset', parseUnit(offsetInput.value, docUnit()) ?? 0));
  flipBtn.addEventListener('click', () => onSetField('cutOffset', -(Number(current.cutOffset) || 0))); // sign flip (base mm)
  bitInput.addEventListener('change', () => { const n = parseUnit(bitInput.value, docUnit()); if (n != null && Number.isFinite(n) && n > 0) onSetField('toolDia', n); else renderFields(); });
  // TASK 742: Hold part sizes (doc unit in, base mm stored; > 0 only, as the other sizes) and the tab count (Auto when empty / "auto", else a whole number >= 1)
  tabWidthInput.addEventListener('change', () => { const n = parseUnit(tabWidthInput.value, docUnit()); if (n != null && Number.isFinite(n) && n > 0) onSetField('tabWidth', n); else renderFields(); });
  holdThicknessInput.addEventListener('change', () => { const n = parseUnit(holdThicknessInput.value, docUnit()); if (n != null && Number.isFinite(n) && n > 0) onSetField('holdThickness', n); else renderFields(); });
  countInput.addEventListener('change', () => {
    const v = countInput.value.trim().toLowerCase(), n = Number(v);
    if (v === '' || v === 'auto') onSetField('tabCount', 'auto');
    else if (Number.isInteger(n) && n >= 1) onSetField('tabCount', n);
    else renderFields();
  });

  stepperFor('cutDepth', depthInput, 'depth', { box: depthInput.closest('.cut-box'), before: depthInput.closest('.cut-mid') });
  stepperFor('stepDepth', stepInput, 'step depth', { box: stepInput.closest('.cut-box') });
  stepperFor('stepDeviation', deviationInput, 'resolution', { box: deviationInput.closest('.cut-box') });
  stepperFor('cutOffset', offsetInput, 'offset', { box: offsetInput.closest('.cut-box') });
  stepperFor('toolDia', bitInput, 'bit diameter', { box: bitInput.closest('.cut-box'), before: bitInput.closest('.cut-box').querySelector('.cut-dia-prefix') });
  stepperFor('tabWidth', tabWidthInput, 'tab width', { box: tabWidthInput.closest('.cut-box') });
  stepperFor('holdThickness', holdThicknessInput, 'thickness', { box: holdThicknessInput.closest('.cut-box') });
  // the count is a number, not a length: the same stepper with no unit conversion; from Auto it steps from the count Auto gave (the derivation's, model.hold)
  attachStepper(countInput, STEPPERS.tabCount, {
    unit: () => 'mm', toDoc: (n) => n,
    read: () => (Number(current.tabCount) >= 1 ? Number(current.tabCount) : current.hold && current.hold.requested >= 1 ? current.hold.requested : null),
    commit: (n) => onSetField('tabCount', Math.max(1, Math.round(n))),
  }, { label: 'tab count', box: countInput.closest('.cut-box') });

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
    // TASK 714: the step row only for a type that DECLARES it (a stepped type), and the stepped cut's note (its steps, an undercut)
    const curDecl = current.cutType ? cutTypeById(current.cutType) : null;
    const declares = (p) => Boolean(curDecl && (curDecl.params || []).includes(p));
    const adaptive = declares('adaptiveSteps') && current.adaptiveSteps === true; // TASK 717: the Resolution row replaces the Step depth row
    card.querySelector('.cut-row[data-row="adaptiveSteps"]').style.display = declares('adaptiveSteps') ? '' : 'none';
    card.querySelector('.cut-row[data-row="stepDepth"]').style.display = declares('stepDepth') && !adaptive ? '' : 'none';
    card.querySelector('.cut-row[data-row="stepDeviation"]').style.display = declares('stepDeviation') && adaptive ? '' : 'none';
    adaptiveInput.checked = adaptive;
    stepInput.value = fmt(Number(current.stepDepth) > 0 ? Number(current.stepDepth) : STEP_DEPTH.defaultMm);
    const deviation = Number(current.stepDeviation) > 0 ? Number(current.stepDeviation) : STEP_RESOLUTION.defaultMm;
    deviationInput.value = formatUnit(deviation, docUnit(), { decimals: lengthDecimals(docUnit() === 'in' ? 4 : 3) }); // 0.1 mm = 0.0039 in
    // TASK 742: Hold part, for a type that declares it (a plain Outside / Inside): the choice, then the Tabs rows (count, width, thickness) or the Onion skin row (thickness)
    const hold = declares('holdPart') ? (current.holdPart === 'tabs' || current.holdPart === 'skin' ? current.holdPart : 'off') : null;
    card.querySelector('.cut-row[data-row="holdPart"]').style.display = hold ? '' : 'none';
    card.querySelector('.cut-row[data-row="tabCount"]').style.display = hold === 'tabs' ? '' : 'none';
    card.querySelector('.cut-row[data-row="tabWidth"]').style.display = hold === 'tabs' ? '' : 'none';
    card.querySelector('.cut-row[data-row="holdThickness"]').style.display = hold === 'tabs' || hold === 'skin' ? '' : 'none';
    card.querySelector('.cut-row[data-row="holdThickness"] .cut-field-label').textContent = hold === 'skin' ? 'Skin thickness' : 'Tab thickness';
    renderPresets(holdModesWrap, hold ? HOLD_PRESETS : [], 'holdPart', hold); // hidden rows keep no preset buttons
    renderPresets(countPresetsWrap, hold === 'tabs' ? COUNT_PRESETS : [], 'tabCount', Number(current.tabCount) >= 1 ? Number(current.tabCount) : 'auto');
    countInput.value = Number(current.tabCount) >= 1 ? String(Math.floor(Number(current.tabCount))) : '';
    countInput.placeholder = current.hold && current.hold.requested >= 1 && !(Number(current.tabCount) >= 1) ? `Auto (${current.hold.requested})` : 'Auto';
    tabWidthInput.value = fmt(fieldBase('tabWidth'));
    holdThicknessInput.value = fmt(fieldBase('holdThickness'));
    noteEl.innerHTML = '';
    for (const line of current.note) { // a line is text, or { text, warn, title }: `warn` (the part of text to flag) is shown in the warning colour
      const item = typeof line === 'string' ? { text: line } : line, d = document.createElement('div');
      if (item.warn && item.text.endsWith(item.warn)) {
        d.append(item.text.slice(0, item.text.length - item.warn.length));
        const w = document.createElement('span'); w.className = 'cut-note-warn'; w.textContent = item.warn; w.title = item.title || ''; d.appendChild(w);
      } else d.textContent = item.text;
      noteEl.appendChild(d);
    }
    noteEl.hidden = !current.note.length;
    const curType = current.cutType ? cutTypeById(current.cutType) : null;
    card.querySelector('.cut-row[data-param="cutDepth"] .cut-field-label').textContent = (curType && curType.depthLabel) || 'Depth';
    const off = Number(current.cutOffset) || 0;
    offsetInput.value = fmt(off);
    flipBtn.classList.toggle('is-on', off < 0);
    flipBtn.setAttribute('aria-pressed', String(off < 0));
    const dia = Number(current.toolDia) || 0;
    bitInput.value = fmt(dia);
    renderPresets(presetsWrap, BIT_PRESETS, 'toolDia', dia);
    // hidden rows keep no preset buttons
    renderPresets(stepPresetsWrap, declares('stepDepth') && !adaptive ? presetsFor(STEP_PRESETS) : [], 'stepDepth', Number(current.stepDepth) > 0 ? Number(current.stepDepth) : STEP_DEPTH.defaultMm);
    renderPresets(deviationPresetsWrap, adaptive ? RESOLUTION_PRESETS : [], 'stepDeviation', deviation);
    const shape = CUTTER_SHAPES.find((x) => x.id === current.cutterShape) || CUTTER_SHAPES[0];
    shapeIc.innerHTML = iconSvg(shape); shapeCur.textContent = shape.id === 'vbit' ? `${shape.label} ${Number(current.cutterAngle) || 90}\u00b0` : shape.label;
    const u = docUnit();
    unitEls.forEach((el) => { el.textContent = u; });
  };

  // update(model | null): null → hide the card; else show + reflect the selected target's record (values in BASE mm).
  const update = (model) => {
    if (!model) { card.hidden = true; closeMenu(); current = { kind: null, cutType: null, cutDepth: 'unset', cutOffset: 0, toolDia: TOOLDIA_DEFAULT_MM, cutterShape: 'endmill', cutterAngle: 90, stepDepth: null, adaptiveSteps: false, stepDeviation: null, holdPart: 'off', tabCount: 'auto', tabWidth: null, holdThickness: null, hold: null, record: null, note: [] }; return; }
    const rec = model.record || {};
    current = { kind: model.kind, cutType: rec.cutType || null, cutDepth: rec.cutDepth, cutOffset: rec.cutOffset, toolDia: rec.toolDia, cutterShape: rec.cutterShape || 'endmill', cutterAngle: rec.cutterAngle || 90, stepDepth: rec.stepDepth, adaptiveSteps: rec.adaptiveSteps === true, stepDeviation: rec.stepDeviation, holdPart: rec.holdPart || 'off', tabCount: rec.tabCount ?? 'auto', tabWidth: rec.tabWidth, holdThickness: rec.holdThickness, hold: model.hold || null, record: rec, note: Array.isArray(model.note) ? model.note : [] };
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
