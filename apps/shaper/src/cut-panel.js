// Shaper Prepare — the cut-settings card (SP1f cut-TYPE; SP1g depth/offset/bit rows; U3a units).
// Pure view: it reflects the selected target's cut record (values stored in BASE mm) and emits picks/edits via
// callbacks. Cut params parse/format through #core/units.js per the document unit, and RE-LABEL when DOC_UNIT changes.
// Cut data + gating live in shaper.js; the live records live in prepare-view.js (CUT_PLAN).

import { availableTypes, cutTypeById, cutTypeHasParam, CUTTER_SHAPES, OFFSET_PRESETS, VBIT_PRESETS, BIT_PRESETS, CLEARING_CHOICES } from './shaper.js'; // TASK 743: BIT_PRESETS is declared there now (an operation names its bit by it); TASK 745: the Clearing choices
import { POCKET_CLEARING, allowanceDefault } from '#core/pocket-clearing.js'; // TASK 745: the programmed pocket's defaults
import { CLEARING_REFUSED } from './cut-plan.js';
import { STEP_DEPTH, STEP_RESOLUTION } from '#core/stepped-cut.js';
import { HOLD_PART, holdDefaults, tabsHaveThickness } from '#core/hold-part.js'; // TASK 742: the Hold part choice and its defaults; TASK 775: an On line cut's tabs have no thickness
import { LEAD_IN } from '#core/lead-in.js'; // TASK 775: the Lead-in choice (Off | On) and its sides
import SettingsManager, { docUnit, lengthText, angleText, isPrecisionKey } from '#core/settings-manager.js';
import { attachStepper } from './number-stepper.js';
import { parse as parseUnit, unitNumber } from '#core/units.js';
import { mountHint, optionHint } from './hint.js'; // TASK 770: the one hint widget
import { hintLabel, choiceId } from './param-hints.js'; // TASK 770: THE table of every row's label and hint

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
  // TASK 745: the programmed pocket: the stepover is a percentage of the bit (its unit family ignored), the allowance a length that may be 0, the raster angle
  // degrees (0 to 180: a pass has no direction). TASK 750: no step-downs here (the Origin's Pass Depth / AutoPass)
  stepover:      { step: { mm: 5, in: 5 }, min: POCKET_CLEARING.stepoverPct.min, max: POCKET_CLEARING.stepoverPct.max },
  finishAllowance: { step: { mm: 0.1, in: 0.005 }, min: 0 },
  rasterAngle:   { step: { mm: 15, in: 15 }, min: 0, max: 180 },
  // TASK 775 / 778: the tangential arc lead-in: radius (min = bit radius), sweep (15-180 deg, step 15), optional straight length (min 0)
  leadInRadius:  { step: { mm: 0.5, in: 1 / 32 }, positive: true },
  leadInSweep:   { step: { mm: LEAD_IN.sweep.stepDeg, in: LEAD_IN.sweep.stepDeg }, min: LEAD_IN.sweep.minDeg, max: LEAD_IN.sweep.maxDeg },
  leadInLength:  { step: { mm: 0.5, in: 1 / 32 }, min: 0 },
};
// TASK 745: the Raster angle presets (degrees)
const ANGLE_PRESETS = [{ label: '0\u00b0', value: 0 }, { label: '45\u00b0', value: 45 }, { label: '90\u00b0', value: 90 }];
const CLEARING_CHOICE = (id) => CLEARING_CHOICES.find((c) => c.id === id) || CLEARING_CHOICES[0];
// TASK 742: the Hold part choice (#core HOLD_PART.modes: Off | Tabs | Onion skin) and the count's Auto, as preset buttons (the ONE preset widget)
const HOLD_PRESETS = HOLD_PART.modes.map((m) => ({ label: hintLabel(choiceId('holdPart', m.id)), value: m.id }));
const COUNT_PRESETS = [{ label: 'Auto', value: 'auto' }];
// TASK 775: the Lead-in choice (#core LEAD_IN.modes: Off | On -> the record's true | false) and the leg's side (Outside | Inside), as preset buttons (the ONE preset widget)
const LEAD_PRESETS = LEAD_IN.modes.map((m) => ({ label: hintLabel(choiceId('leadIn', m.id)), value: m.id === 'on' }));
const SIDE_PRESETS = LEAD_IN.sides.map((m) => ({ label: hintLabel(choiceId('leadInSide', m.id)), value: m.id }));
const TOOLDIA_DEFAULT_MM = 3.175; // 1/8 in

// a field's text: lengthText (the one length-format decider: Length precision, default 3, trailing zeros dropped unless TRAILING_ZEROS, or an inch fraction); the unit is beside it
const fieldText = (baseMM) => lengthText(baseMM, { show: 'field' });
const toDocNum = (baseMM) => unitNumber(baseMM, docUnit());  // BASE mm → doc-unit number
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
      <button type="button" class="cut-field-label" data-hint="cutType"></button>
      <div class="cut-type-dd">
        <button type="button" class="cut-type-trigger" aria-haspopup="listbox" aria-expanded="false">
          <span class="cut-ic-slot"></span><span class="cut-type-cur">Select type</span><svg class="cut-caret" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 5l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    </div>
    <div class="cut-rows">
      <div class="cut-row" data-param="cutDepth">
        <button type="button" class="cut-field-label" data-hint="cutDepth"></button>
        <div class="cut-stepper cut-box">
          <div class="cut-mid"><input type="text" class="cut-num cut-depth" inputmode="decimal" placeholder="unset"><span class="cut-unit">mm</span></div>
        </div>
      </div>
      <div class="cut-row" data-row="clearing">
        <button type="button" class="cut-field-label" data-hint="clearing"></button>
        <button type="button" class="cut-clear-trigger" aria-haspopup="listbox" aria-expanded="false">
          <span class="cut-clear-ic"></span><span class="cut-clear-cur"></span><svg class="cut-caret" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 5l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
      <div class="cut-row" data-row="stepover">
        <button type="button" class="cut-field-label" data-hint="stepover"></button>
        <div class="cut-inline cut-box">
          <input type="text" class="cut-num cut-stepover" inputmode="decimal">
          <span class="cut-unit-fixed">%</span>
        </div>
        <div class="cut-hint cut-stepover-len"></div>
      </div>
      <div class="cut-row" data-row="finishAllowance">
        <button type="button" class="cut-field-label" data-hint="finishAllowance"></button>
        <div class="cut-inline cut-box">
          <input type="text" class="cut-num cut-finish-allowance" inputmode="decimal">
          <span class="cut-unit">mm</span>
        </div>
      </div>
      <div class="cut-row" data-row="loop">
        <label class="cut-check"><input type="checkbox" class="cut-loop"><span data-hint="loop"></span></label>
      </div>
      <div class="cut-row" data-row="leadIn">
        <button type="button" class="cut-field-label" data-hint="leadIn"></button>
        <div class="cut-presets cut-lead-modes"></div>
      </div>
      <div class="cut-row" data-row="leadInRadius">
        <button type="button" class="cut-field-label" data-hint="leadInRadius"></button>
        <div class="cut-inline cut-box">
          <input type="text" class="cut-num cut-lead-radius" inputmode="decimal">
          <span class="cut-unit">mm</span>
        </div>
        <div class="cut-calc-bar"><span class="cut-calc-tag">calculated</span><button type="button" class="cut-calc-reset" data-reset="leadInRadius" hidden>Reset to calculated</button></div>
      </div>
      <div class="cut-row" data-row="leadInSweep">
        <button type="button" class="cut-field-label" data-hint="leadInSweep"></button>
        <div class="cut-inline cut-box">
          <input type="text" class="cut-num cut-lead-sweep" inputmode="decimal">
          <span class="cut-unit-fixed">\u00b0</span>
        </div>
        <div class="cut-calc-bar"><span class="cut-calc-tag">calculated</span><button type="button" class="cut-calc-reset" data-reset="leadInSweep" hidden>Reset to calculated</button></div>
      </div>
      <div class="cut-row" data-row="leadInLength">
        <button type="button" class="cut-field-label" data-hint="leadInLength"></button>
        <div class="cut-inline cut-box">
          <input type="text" class="cut-num cut-lead-length" inputmode="decimal">
          <span class="cut-unit">mm</span>
        </div>
        <div class="cut-calc-bar"><span class="cut-calc-tag">calculated</span><button type="button" class="cut-calc-reset" data-reset="leadInLength" hidden>Reset to calculated</button></div>
      </div>
      <div class="cut-row" data-row="leadInSide">
        <button type="button" class="cut-field-label" data-hint="leadInSide"></button>
        <div class="cut-presets cut-lead-sides"></div>
      </div>
      <div class="cut-row" data-row="leadInAt">
        <button type="button" class="cut-field-label" data-hint="leadInAt"></button>
        <div class="cut-calc-bar cut-pos-bar"><span class="cut-calc-tag cut-pos-state">calculated</span><button type="button" class="cut-calc-reset" data-reset="leadInAt" hidden>Reset to calculated</button></div>
      </div>
      <div class="cut-row" data-row="rasterAngle">
        <button type="button" class="cut-field-label" data-hint="rasterAngle"></button>
        <div class="cut-inline cut-box">
          <input type="text" class="cut-num cut-raster-angle" inputmode="decimal">
          <span class="cut-unit-fixed">\u00b0</span>
        </div>
        <div class="cut-presets cut-angle-presets"></div>
      </div>
      <div class="cut-row" data-row="adaptiveSteps">
        <label class="cut-check"><input type="checkbox" class="cut-adaptive"><span data-hint="adaptiveSteps"></span></label>
      </div>
      <div class="cut-row" data-row="stepDepth">
        <button type="button" class="cut-field-label" data-hint="stepDepth"></button>
        <div class="cut-inline cut-box">
          <input type="text" class="cut-num cut-step-depth" inputmode="decimal">
          <span class="cut-unit">mm</span>
        </div>
        <div class="cut-presets"></div>
      </div>
      <div class="cut-row" data-row="stepDeviation">
        <button type="button" class="cut-field-label" data-hint="stepDeviation"></button>
        <div class="cut-inline cut-box">
          <input type="text" class="cut-num cut-step-deviation" inputmode="decimal">
          <span class="cut-unit">mm</span>
        </div>
        <div class="cut-presets"></div>
      </div>
      <div class="cut-row" data-row="holdPart">
        <button type="button" class="cut-field-label" data-hint="holdPart"></button>
        <div class="cut-presets cut-hold-modes"></div>
      </div>
      <div class="cut-row" data-row="tabCount">
        <button type="button" class="cut-field-label" data-hint="tabCount"></button>
        <div class="cut-inline cut-box cut-count-box">
          <input type="text" class="cut-num cut-tab-count" inputmode="numeric" placeholder="Auto">
          <span class="cut-presets cut-in-box"></span>
        </div>
      </div>
      <div class="cut-row" data-row="tabWidth">
        <button type="button" class="cut-field-label" data-hint="tabWidth"></button>
        <div class="cut-inline cut-box">
          <input type="text" class="cut-num cut-tab-width" inputmode="decimal">
          <span class="cut-unit">mm</span>
        </div>
      </div>
      <div class="cut-row" data-row="holdThickness">
        <button type="button" class="cut-field-label" data-hint="holdThickness"></button>
        <div class="cut-inline cut-box">
          <input type="text" class="cut-num cut-hold-thickness" inputmode="decimal">
          <span class="cut-unit">mm</span>
        </div>
      </div>
      <div class="cut-note" hidden></div>
      <div class="cut-row" data-param="cutOffset">
        <button type="button" class="cut-field-label" data-hint="cutOffset"></button>
        <div class="cut-inline cut-box cut-offset-box">
          <button type="button" class="cut-flip" title="Flip offset direction" aria-label="Flip offset" aria-pressed="false"><svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true"><path d="M2 4h9l-2.5-2.5M12 8H3l2.5 2.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          <input type="text" class="cut-num cut-offset" inputmode="decimal">
          <span class="cut-unit">mm</span>
        </div>
      </div>
      <div class="cut-row" data-param="toolDia">
        <button type="button" class="cut-field-label" data-hint="toolDia"></button>
        <div class="cut-inline cut-box">
          <span class="cut-dia-prefix">D</span>
          <input type="text" class="cut-num cut-bit" inputmode="decimal">
          <span class="cut-unit">mm</span>
        </div>
        <div class="cut-presets"></div>
      </div>
      <div class="cut-row" data-row="cutterShape">
        <button type="button" class="cut-field-label" data-hint="cutterShape"></button>
        <button type="button" class="cut-shape-trigger" aria-haspopup="listbox" aria-expanded="false">
          <span class="cut-shape-ic"></span><span class="cut-shape-cur"></span><svg class="cut-caret" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 5l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    </div>
    <div class="cut-pop cut-type-menu" role="listbox" hidden></div>
    <div class="cut-pop cut-offset-pop" hidden></div>
    <div class="cut-pop cut-shape-pop" role="listbox" hidden></div>
    <div class="cut-pop cut-clear-pop" role="listbox" hidden></div>`;
  hostEl.appendChild(card);

  const $ = (sel) => card.querySelector(sel);
  const trigger = $('.cut-type-trigger'), menu = $('.cut-type-menu'), offsetPop = $('.cut-offset-pop'), shapePop = $('.cut-shape-pop'), shapeTrigger = $('.cut-shape-trigger'), shapeIc = $('.cut-shape-ic'), shapeCur = $('.cut-shape-cur'), curLabel = $('.cut-type-cur'), curSw = $('.cut-ic-slot');
  const depthInput = $('.cut-depth'), stepInput = $('.cut-step-depth'), noteEl = $('.cut-note'), offsetInput = $('.cut-offset'), flipBtn = $('.cut-flip'), bitInput = $('.cut-bit'), presetsWrap = $('.cut-row[data-param="toolDia"] .cut-presets'), stepPresetsWrap = $('.cut-row[data-row="stepDepth"] .cut-presets');
  const adaptiveInput = $('.cut-adaptive'), deviationInput = $('.cut-step-deviation'), deviationPresetsWrap = $('.cut-row[data-row="stepDeviation"] .cut-presets'); // TASK 717
  const holdModesWrap = $('.cut-hold-modes'), countInput = $('.cut-tab-count'), countPresetsWrap = $('.cut-row[data-row="tabCount"] .cut-presets') /* the Auto button, inside the count box (a row of its own would push the card past a phone's screen) */, tabWidthInput = $('.cut-tab-width'), holdThicknessInput = $('.cut-hold-thickness'); // TASK 742
  const unitEls = card.querySelectorAll('.cut-unit'); // the unit suffix labels — re-labeled to the doc unit (TASK 745: % and \u00b0 are .cut-unit-fixed)
  const clearTrigger = $('.cut-clear-trigger'), clearPop = $('.cut-clear-pop'), clearIc = $('.cut-clear-ic'), clearCur = $('.cut-clear-cur'); // TASK 745
  const stepoverInput = $('.cut-stepover'), stepoverLen = $('.cut-stepover-len'), allowanceInput = $('.cut-finish-allowance'), loopInput = $('.cut-loop'), angleInput = $('.cut-raster-angle'), anglePresetsWrap = $('.cut-angle-presets');
  const leadModesWrap = $('.cut-lead-modes'), leadRadiusInput = $('.cut-lead-radius'), leadSweepInput = $('.cut-lead-sweep'), leadLengthInput = $('.cut-lead-length'), leadSidesWrap = $('.cut-lead-sides'), leadPosState = $('.cut-pos-state'); // TASK 775 / 778
  const calcBars = Object.fromEntries(['leadInRadius', 'leadInSweep', 'leadInLength', 'leadInAt'].map((f) => [f, {
    tag: card.querySelector(`.cut-row[data-row="${f}"] .cut-calc-tag`),
    reset: card.querySelector(`.cut-row[data-row="${f}"] .cut-calc-reset`),
  }]));
  for (const [f, b] of Object.entries(calcBars)) b.reset.addEventListener('click', () => onSetField(f, null));
  // TASK 770: every row's label and hint (hint.js; the texts: param-hints.js). A row's label is its trigger; a checkbox row (its label toggles the box) gets a
  // small "i" beside its text. The hint line goes under the row's field; the row's inputs / dropdown / Hold part choice are described by it (aria-describedby).
  holdModesWrap.setAttribute('role', 'group');
  leadModesWrap.setAttribute('role', 'group'); leadSidesWrap.setAttribute('role', 'group'); // TASK 775
  const hints = {};
  for (const t of card.querySelectorAll('[data-hint]')) {
    const row = t.closest('.cut-row, .cut-field'), check = t.closest('.cut-check');
    hints[t.dataset.hint] = mountHint({ id: t.dataset.hint, trigger: check ? null : t, labelEl: check ? t : null, after: row.lastElementChild,
      fields: [...row.querySelectorAll('input, .cut-type-trigger, .cut-clear-trigger, .cut-shape-trigger, .cut-hold-modes, .cut-lead-modes, .cut-lead-sides')] });
  }
  hints.holdPart.trigger.id = 'cut-hold-label';
  holdModesWrap.setAttribute('aria-labelledby', 'cut-hold-label');
  hints.leadIn.trigger.id = 'cut-lead-label'; leadModesWrap.setAttribute('aria-labelledby', 'cut-lead-label'); // TASK 775
  hints.leadInSide.trigger.id = 'cut-lead-side-label'; leadSidesWrap.setAttribute('aria-labelledby', 'cut-lead-side-label');
  // TASK 770: a menu row = its icon, its name and (a second, smaller line) its hint; the name and the hint from the table
  const optionBody = (opt, icon, param, id, nameClass = '') => {
    opt.innerHTML = `${icon}<span class="cut-opt-text"><span class="cut-opt-name ${nameClass}"></span></span>`;
    opt.querySelector('.cut-opt-name').textContent = hintLabel(choiceId(param, id));
    opt.querySelector('.cut-opt-text').appendChild(optionHint(card.ownerDocument, choiceId(param, id)));
  };

  let current = { kind: null, cutType: null, cutDepth: 'unset', cutOffset: 0, toolDia: TOOLDIA_DEFAULT_MM, cutterShape: 'endmill', cutterAngle: 90, stepDepth: null, adaptiveSteps: false, stepDeviation: null, holdPart: 'off', tabCount: 'auto', tabWidth: null, holdThickness: null, hold: null, clearing: 'freehand', stepover: null, finishAllowance: null, loop: false, rasterAngle: null, clearingInfo: null, leadIn: false, leadInRadius: null, leadInSweep: null, leadInLength: null, leadInSide: 'outside', leadInAt: null, leadInInfo: null, record: null, note: [] };

  // TASK 455: popovers open to the LEFT of the card, aligned with the row that opened them (the card is their positioned parent)
  const pops = [menu, offsetPop, shapePop, clearPop];
  const syncOpenState = () => {
    trigger.setAttribute('aria-expanded', String(!menu.hidden)); trigger.classList.toggle('is-open', !menu.hidden);
    shapeTrigger.setAttribute('aria-expanded', String(!shapePop.hidden)); shapeTrigger.classList.toggle('is-open', !shapePop.hidden);
    clearTrigger.setAttribute('aria-expanded', String(!clearPop.hidden)); clearTrigger.classList.toggle('is-open', !clearPop.hidden);
  };
  const closePops = (except) => { for (const p of pops) if (p !== except) p.hidden = true; syncOpenState(); };
  const rowsEl = card.querySelector('.cut-rows'); // TASK 742: a tall card scrolls its rows: a popover sits at its row as shown (offsetTop minus that scroll)
  const openPop = (pop, anchor) => { closePops(pop); const row = anchor.closest('.cut-row, .cut-field') || anchor; pop.style.top = (row.offsetTop - (rowsEl.contains(row) ? rowsEl.scrollTop : 0)) + 'px'; pop.hidden = false; keepOnScreen(pop); syncOpenState(); };
  // TASK 770: a menu taller than the room below its row (its rows carry their hint lines) moves up to end where the card's panel ends (above the phone's
  // Operations bar), and scrolls when it is taller than the panel; one that fits stays at its row
  const keepOnScreen = (pop) => {
    const room = hostEl.getBoundingClientRect();
    pop.style.maxHeight = `${room.height}px`;
    const r = pop.getBoundingClientRect(), over = r.bottom - room.bottom;
    if (over > 0) pop.style.top = `${parseFloat(pop.style.top) - Math.min(over, r.top - room.top)}px`;
  };

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
      optionBody(opt, iconSvg(t), 'cutType', id);
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
    : field === 'finishAllowance' ? (current.finishAllowance != null && Number(current.finishAllowance) >= 0 ? Number(current.finishAllowance) : allowanceDefault(docUnit())) // TASK 745
    : field === 'leadInRadius' ? (current.leadInRadius != null && Number(current.leadInRadius) > 0 ? Number(current.leadInRadius) : (current.leadInInfo && Number(current.leadInInfo.radius) > 0 ? Number(current.leadInInfo.radius) : Number(current.toolDia) || 0)) // TASK 778: null = calculated by derivation
    : field === 'leadInLength' ? (current.leadInLength != null && Number(current.leadInLength) >= 0 ? Number(current.leadInLength) : (current.leadInInfo && Number(current.leadInInfo.length) >= 0 ? Number(current.leadInInfo.length) : 0)) // TASK 778: null = calculated (0)
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
      b.textContent = docUnit() === 'in' ? p.label : fieldText(p.mm); // mm/cm docs show the converted values (UNVERIFIED vs Studio)
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
      optionBody(opt, iconSvg(sh), 'cutterShape', sh.id);
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

  // TASK 745: the Clearing dropdown (the card's own popover widget, as the cut type / cutter shape): Freehand | Spiral (TASK 749) | Raster | Morphed spiral, each
  // with its pattern's icon; a choice the target cannot take (the Morphed spiral on a pocket with islands / a neck) stays listed, greyed, with its reason under it
  const buildClearPop = () => {
    clearPop.innerHTML = '';
    for (const c of CLEARING_CHOICES) {
      const why = c.id === 'morphed' && current.clearingInfo && current.clearingInfo.morphed ? (CLEARING_REFUSED[current.clearingInfo.morphed] || current.clearingInfo.morphed) : null;
      const opt = document.createElement('button');
      opt.type = 'button'; opt.className = 'cut-type-opt cut-clear-opt' + (c.id === current.clearing ? ' is-current' : '') + (why ? ' is-disabled' : '');
      opt.setAttribute('role', 'option'); opt.dataset.clearing = c.id; opt.disabled = Boolean(why);
      optionBody(opt, iconSvg(c), 'clearing', c.id, 'cut-clear-name');
      if (why) { opt.title = why; const r = document.createElement('span'); r.className = 'cut-clear-why'; r.textContent = why; opt.appendChild(r); }
      else opt.addEventListener('click', () => { closePops(null); onSetField('clearing', c.id); });
      clearPop.appendChild(opt);
    }
  };
  clearTrigger.addEventListener('click', (e) => { e.stopPropagation(); if (clearPop.hidden) { buildClearPop(); openPop(clearPop, clearTrigger); } else closePops(null); });
  // the rows of a computed pattern: the stepover (%; its length in the doc unit beside it), the finish allowance (>= 0), the Loop toggle (TASK 750), the raster angle
  stepoverInput.addEventListener('change', () => { const n = Number(stepoverInput.value.trim().replace('%', '')); if (Number.isFinite(n) && n >= POCKET_CLEARING.stepoverPct.min && n <= POCKET_CLEARING.stepoverPct.max) onSetField('stepover', n); else renderFields(); });
  allowanceInput.addEventListener('change', () => { const n = parseUnit(allowanceInput.value, docUnit()); if (n != null && Number.isFinite(n) && n >= 0) onSetField('finishAllowance', n); else renderFields(); });
  loopInput.addEventListener('change', () => onSetField('loop', loopInput.checked)); // TASK 750: the card's toggle widget (as Adaptive stepping)
  angleInput.addEventListener('change', () => { const n = Number(angleInput.value.trim().replace('\u00b0', '')); if (Number.isFinite(n)) onSetField('rasterAngle', ((n % 180) + 180) % 180); else renderFields(); });
  const unitless = (field, input, label) => attachStepper(input, STEPPERS[field], { unit: () => 'mm', toDoc: (n) => n, read: () => (Number.isFinite(Number(current[field])) && current[field] !== null ? Number(current[field]) : field === 'stepover' ? POCKET_CLEARING.stepoverPct.default : POCKET_CLEARING.rasterAngle), commit: (n) => onSetField(field, n) }, { label, box: input.closest('.cut-box') });
  unitless('stepover', stepoverInput, 'stepover');
  unitless('rasterAngle', angleInput, 'raster angle');
  stepperFor('finishAllowance', allowanceInput, 'finish allowance', { box: allowanceInput.closest('.cut-box') });
  // TASK 778: the tangential arc lead-in fields: Radius (doc unit, min bit radius on stepper, empty resets to calculated), Sweep (15-180 deg, step 15), Length (>= 0, straight part before arc)
  leadRadiusInput.addEventListener('change', () => {
    const raw = leadRadiusInput.value.trim();
    if (raw === '') { onSetField('leadInRadius', null); return; }
    const n = parseUnit(raw, docUnit());
    if (n != null && Number.isFinite(n) && n > 0) onSetField('leadInRadius', n); else renderFields();
  });
  attachStepper(leadRadiusInput, { ...STEPPERS.leadInRadius, min: () => (Number(current.toolDia) > 0 ? Number(current.toolDia) / 2 : null) }, {
    unit: docUnit, toDoc: toDocNum,
    read: () => toDocNum(fieldBase('leadInRadius')),
    commit: (docNum) => onSetField('leadInRadius', parseUnit(String(docNum), docUnit())),
  }, { label: 'lead-in radius', box: leadRadiusInput.closest('.cut-box') });
  leadSweepInput.addEventListener('change', () => {
    const raw = leadSweepInput.value.trim().replace('\u00b0', '');
    if (raw === '') { onSetField('leadInSweep', null); return; }
    const n = Number(raw);
    if (Number.isFinite(n) && n >= LEAD_IN.sweep.minDeg && n <= LEAD_IN.sweep.maxDeg) onSetField('leadInSweep', n); else renderFields();
  });
  attachStepper(leadSweepInput, STEPPERS.leadInSweep, {
    unit: () => 'mm', toDoc: (n) => n,
    read: () => (current.leadInSweep != null && Number.isFinite(Number(current.leadInSweep)) ? Number(current.leadInSweep) : (current.leadInInfo && Number.isFinite(Number(current.leadInInfo.sweep)) ? Number(current.leadInInfo.sweep) : LEAD_IN.sweep.defaultDeg)),
    commit: (n) => onSetField('leadInSweep', n),
  }, { label: 'lead-in sweep', box: leadSweepInput.closest('.cut-box') });
  leadLengthInput.addEventListener('change', () => {
    const raw = leadLengthInput.value.trim();
    if (raw === '') { onSetField('leadInLength', null); return; }
    const n = parseUnit(raw, docUnit());
    if (n != null && Number.isFinite(n) && n >= 0) onSetField('leadInLength', n); else renderFields();
  });
  stepperFor('leadInLength', leadLengthInput, 'lead-in length', { box: leadLengthInput.closest('.cut-box') });

  // Re-format the displayed values (BASE mm → doc unit). Called on selection change AND on DOC_UNIT change (re-label).
  const renderFields = () => {
    depthInput.value = isUnset(current.cutDepth) ? '' : fieldText(current.cutDepth);
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
    stepInput.value = fieldText(Number(current.stepDepth) > 0 ? Number(current.stepDepth) : STEP_DEPTH.defaultMm);
    const deviation = Number(current.stepDeviation) > 0 ? Number(current.stepDeviation) : STEP_RESOLUTION.defaultMm;
    deviationInput.value = lengthText(deviation, { show: 'field', fractions: false }); // 0.1 mm = 0.0039 in: a tolerance finer than 1/64, always decimals
    // TASK 742: Hold part, for a type that declares it (a plain Outside / Inside): the choice, then the Tabs rows (count, width, thickness) or the Onion skin row (thickness)
    const hold = declares('holdPart') ? (current.holdPart === 'tabs' || current.holdPart === 'skin' ? current.holdPart : 'off') : null;
    card.querySelector('.cut-row[data-row="holdPart"]').style.display = hold ? '' : 'none';
    card.querySelector('.cut-row[data-row="tabCount"]').style.display = hold === 'tabs' ? '' : 'none';
    card.querySelector('.cut-row[data-row="tabWidth"]').style.display = hold === 'tabs' ? '' : 'none';
    card.querySelector('.cut-row[data-row="holdThickness"]').style.display = (hold === 'tabs' && tabsHaveThickness(current.cutType)) || hold === 'skin' ? '' : 'none'; // TASK 775: an On line cut's tabs are uncut gaps (no thickness)
    hints.tabWidth.refresh({ online: Boolean(hold) && !tabsHaveThickness(current.cutType) });
    hints.holdThickness.setId(hold === 'skin' ? 'skinThickness' : 'holdThickness'); // TASK 770: the row is the skin's thickness with Onion skin
    renderPresets(holdModesWrap, hold ? HOLD_PRESETS : [], 'holdPart', hold); // hidden rows keep no preset buttons
    renderPresets(countPresetsWrap, hold === 'tabs' ? COUNT_PRESETS : [], 'tabCount', Number(current.tabCount) >= 1 ? Number(current.tabCount) : 'auto');
    countInput.value = Number(current.tabCount) >= 1 ? String(Math.floor(Number(current.tabCount))) : '';
    countInput.placeholder = current.hold && current.hold.requested >= 1 && !(Number(current.tabCount) >= 1) ? `Auto (${current.hold.requested})` : 'Auto';
    tabWidthInput.value = fieldText(fieldBase('tabWidth'));
    holdThicknessInput.value = fieldText(fieldBase('holdThickness'));
    // TASK 745: the Clearing choice of a type that declares it (the plain Pocket), then the rows of a computed pattern (Raster: + its angle)
    const clearing = declares('clearing') ? (CLEARING_CHOICES.some((c) => c.id === current.clearing) ? current.clearing : 'freehand') : null;
    const computed = Boolean(clearing) && clearing !== 'freehand';
    card.querySelector('.cut-row[data-row="clearing"]').style.display = clearing ? '' : 'none';
    for (const row of ['stepover', 'finishAllowance', 'loop']) card.querySelector(`.cut-row[data-row="${row}"]`).style.display = computed ? '' : 'none';
    card.querySelector('.cut-row[data-row="rasterAngle"]').style.display = clearing === 'raster' ? '' : 'none';
    const choice = CLEARING_CHOICE(clearing || 'freehand');
    clearIc.innerHTML = iconSvg(choice); clearCur.textContent = hintLabel(choiceId('clearing', choice.id));
    const pct = Number(current.stepover) > 0 ? Number(current.stepover) : POCKET_CLEARING.stepoverPct.default;
    stepoverInput.value = String(Math.round(pct * 100) / 100);
    stepoverLen.textContent = computed ? `= ${lengthText((pct / 100) * (Number(current.toolDia) || 0), { show: 'unit', fractions: false })}` : '';
    allowanceInput.value = fieldText(fieldBase('finishAllowance'));
    loopInput.checked = computed && current.loop === true;
    hints.finishAllowance.refresh({ loop: current.loop === true }); // TASK 766 / 770: who takes the finish allowance off depends on Loop (param-hints.js)
    // TASK 775 / 778: the Lead-in row on an On line OUTLINE ONLY (a closed loop, not an open line; not with Tabs; pockets get a start mark, never lead-in).
    // On: Radius, Sweep, Length (each showing calculated tag or Reset to calculated), Side, Position (calculated | moved + Reset to calculated).
    const leadRow = declares('leadIn') && current.kind !== 'chain' && hold !== 'tabs';
    const leadOn = leadRow && current.leadIn === true;
    card.querySelector('.cut-row[data-row="leadIn"]').style.display = leadRow ? '' : 'none';
    for (const row of ['leadInRadius', 'leadInSweep', 'leadInLength', 'leadInSide', 'leadInAt']) {
      card.querySelector(`.cut-row[data-row="${row}"]`).style.display = leadOn && declares(row) ? '' : 'none';
    }
    renderPresets(leadModesWrap, leadRow ? LEAD_PRESETS : [], 'leadIn', current.leadIn === true);
    renderPresets(leadSidesWrap, leadOn && declares('leadInSide') ? SIDE_PRESETS : [], 'leadInSide', current.leadInSide);
    leadRadiusInput.value = fieldText(fieldBase('leadInRadius'));
    const sweepVal = current.leadInSweep != null && Number.isFinite(Number(current.leadInSweep)) ? Number(current.leadInSweep) : (current.leadInInfo && Number.isFinite(Number(current.leadInInfo.sweep)) ? Number(current.leadInInfo.sweep) : LEAD_IN.sweep.defaultDeg);
    leadSweepInput.value = String(Math.round(sweepVal * 100) / 100);
    leadLengthInput.value = fieldText(fieldBase('leadInLength'));
    const syncCalc = (f, isCalculated) => { calcBars[f].tag.hidden = !isCalculated; calcBars[f].reset.hidden = isCalculated; };
    syncCalc('leadInRadius', current.leadInRadius == null);
    syncCalc('leadInSweep', current.leadInSweep == null);
    syncCalc('leadInLength', current.leadInLength == null);
    const posMoved = current.leadInAt != null;
    leadPosState.textContent = posMoved ? 'moved' : 'calculated';
    leadPosState.classList.toggle('is-moved', posMoved);
    calcBars.leadInAt.reset.hidden = !posMoved;
    const angle = Number.isFinite(Number(current.rasterAngle)) && current.rasterAngle !== null ? Number(current.rasterAngle) : POCKET_CLEARING.rasterAngle;
    angleInput.value = String(Math.round(angle * 100) / 100);
    renderPresets(anglePresetsWrap, clearing === 'raster' ? ANGLE_PRESETS : [], 'rasterAngle', angle);
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
    hints.cutDepth.setId((curType && curType.depthParam) || 'cutDepth'); // TASK 472 / 770: a Stock's depth row is its Thickness (its own table entry)
    const off = Number(current.cutOffset) || 0;
    offsetInput.value = fieldText(off);
    flipBtn.classList.toggle('is-on', off < 0);
    flipBtn.setAttribute('aria-pressed', String(off < 0));
    const dia = Number(current.toolDia) || 0;
    bitInput.value = fieldText(dia);
    renderPresets(presetsWrap, BIT_PRESETS, 'toolDia', dia);
    // hidden rows keep no preset buttons
    renderPresets(stepPresetsWrap, declares('stepDepth') && !adaptive ? presetsFor(STEP_PRESETS) : [], 'stepDepth', Number(current.stepDepth) > 0 ? Number(current.stepDepth) : STEP_DEPTH.defaultMm);
    renderPresets(deviationPresetsWrap, adaptive ? RESOLUTION_PRESETS : [], 'stepDeviation', deviation);
    const shape = CUTTER_SHAPES.find((x) => x.id === current.cutterShape) || CUTTER_SHAPES[0];
    const shapeName = hintLabel(choiceId('cutterShape', shape.id));
    shapeIc.innerHTML = iconSvg(shape); shapeCur.textContent = shape.id === 'vbit' ? `${shapeName} ${angleText(Number(current.cutterAngle) || 90, { show: 'deg' })}` : shapeName;
    const u = docUnit();
    unitEls.forEach((el) => { el.textContent = u; });
  };

  // update(model | null): null → hide the card; else show + reflect the selected target's record (values in BASE mm).
  const update = (model) => {
    if (!model) { card.hidden = true; closeMenu(); for (const h of Object.values(hints)) h.close(); current = { kind: null, cutType: null, cutDepth: 'unset', cutOffset: 0, toolDia: TOOLDIA_DEFAULT_MM, cutterShape: 'endmill', cutterAngle: 90, stepDepth: null, adaptiveSteps: false, stepDeviation: null, holdPart: 'off', tabCount: 'auto', tabWidth: null, holdThickness: null, hold: null, clearing: 'freehand', stepover: null, finishAllowance: null, loop: false, rasterAngle: null, clearingInfo: null, leadIn: false, leadInRadius: null, leadInSweep: null, leadInLength: null, leadInSide: 'outside', leadInAt: null, leadInInfo: null, record: null, note: [] }; return; }
    const rec = model.record || {};
    current = { kind: model.kind, cutType: rec.cutType || null, cutDepth: rec.cutDepth, cutOffset: rec.cutOffset, toolDia: rec.toolDia, cutterShape: rec.cutterShape || 'endmill', cutterAngle: rec.cutterAngle || 90, stepDepth: rec.stepDepth, adaptiveSteps: rec.adaptiveSteps === true, stepDeviation: rec.stepDeviation, holdPart: rec.holdPart || 'off', tabCount: rec.tabCount ?? 'auto', tabWidth: rec.tabWidth, holdThickness: rec.holdThickness, hold: model.hold || null,
      clearing: rec.clearing || 'freehand', stepover: rec.stepover ?? null, finishAllowance: rec.finishAllowance ?? null, loop: rec.loop === true, rasterAngle: rec.rasterAngle ?? null, clearingInfo: model.clearing || null, // TASK 745
      leadIn: rec.leadIn === true, leadInRadius: rec.leadInRadius ?? null, leadInSweep: rec.leadInSweep ?? null, leadInLength: rec.leadInLength ?? null, leadInSide: rec.leadInSide === 'inside' ? 'inside' : 'outside', leadInAt: rec.leadInAt ?? null, leadInInfo: model.leadIn || null, // TASK 775 / 778
      record: rec, note: Array.isArray(model.note) ? model.note : [] };
    card.hidden = false;
    const t = current.cutType ? cutTypeById(current.cutType) : null;
    curLabel.textContent = t ? hintLabel(choiceId('cutType', t.id)) : 'Select type';
    curSw.innerHTML = t ? iconSvg(t) : '';
    if (!menu.hidden) buildMenu();
    if (!shapePop.hidden) buildShapePop();
    if (!clearPop.hidden) buildClearPop();
    renderFields();
  };

  // U3a / TASK 770: re-label the cut params live when the document unit or display precision / trailing zeros changes.
  const unsub = (typeof SettingsManager.subscribe === 'function')
    ? SettingsManager.subscribe((key) => { if ((key === null || key === 'DOC_UNIT' || isPrecisionKey(key)) && !card.hidden) renderFields(); })
    : () => {};

  return { update, destroy() { document.removeEventListener('click', onDocClick); try { unsub(); } catch (_) {} hostEl.innerHTML = ''; } };
}
