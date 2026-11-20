// Shaper Prepare — the cut-settings card (SP1f cut-TYPE; SP1g depth/offset/bit rows; U3a units).
// Pure view: it reflects the selected target's cut record (values stored in BASE mm) and emits picks/edits via
// callbacks. Cut params parse/format through #core/units.js per the document unit, and RE-LABEL when DOC_UNIT changes.
// Cut data + gating live in shaper.js; the live records live in prepare-view.js (CUT_PLAN).

import { cutTypeById, cutTypeHasParam, cutTypeHasField, CUTTER_SHAPES, OFFSET_PRESETS, VBIT_PRESETS, BIT_PRESETS, CLEARING_CHOICES } from './shaper.js'; // TASK 743: BIT_PRESETS is declared there now (an operation names its bit by it); TASK 745: the Clearing choices
import { POCKET_CLEARING, allowanceDefault } from '#core/pocket-clearing.js'; // TASK 745: the programmed pocket's defaults
import { CLEARING_REFUSED, CONTOUR_DEFAULTS } from './cut-plan.js'; // TASK 810: what a Contour starts with (its tab dots)
import { STEP_DEPTH, STEP_RESOLUTION, ROUGH_LAYOUT, ROUGH_BOUNDARY, CONTOUR_WALLS, CONTOUR_WALL_SIDES, boundaryOf, boundaryCalcOffset, hasLevels } from '#core/stepped-cut.js'; // TASK 810: Roughing's machining boundary; a Contour's walls
import { smoothingOf } from '#core/level-smooth.js'; // TASK 809: a Roughing / Contour's Smoothing (its default by operation)
import { HOLD_PART, holdDefaults, tabsHaveThickness } from '#core/hold-part.js'; // TASK 742: the Hold part choice and its defaults; TASK 775: an On line cut's tabs have no thickness
import { LEAD_IN } from '#core/lead-in.js'; // TASK 775: the Lead-in choice (Off | On) and its sides
import SettingsManager, { docUnit, lengthText, angleText, isPrecisionKey } from '#core/settings-manager.js';
import { attachStepper } from './number-stepper.js';
import { parse as parseUnit, unitNumber } from '#core/units.js';
import { bindHint, setOffReason } from './hint.js'; // TASK 805: a row's label and its tooltip (the cursor tooltip is installed once by main.js)
import { hintLabel, choiceId } from './param-hints.js'; // TASK 770: THE table of every row's label and hint

// Menu order per the Shaper mockup: path types first (on line / guide), then region (inside / pocket / outside).
// TASK 714: each STEPPED type right after its plain type; a stepped type is listed only when the target can take it (its record carries that slope).
const MENU_ORDER = ['online', 'guide', 'interior', 'pocket', 'roughing', 'contour', 'exterior', 'stock']; // TASK 472: Stock last (it is the board, not a cut); TASK 792: Roughing after Pocket (the stepped types are gone); TASK S2: Contour is a type of its own, after Roughing (greyed with its reason where a shape has no part)
// TASK 455: each cut type carries its own icon (CUT_TYPES.icon, 18x18 inner markup in currentColor); colours are CSS tokens.
const iconSvg = (t) => `<svg class="cut-ic" viewBox="0 0 18 18" aria-hidden="true">${(t && t.icon) || ''}</svg>`;

// TASK 715: the Step presets FOLLOW the document unit. VALUES are BASE mm; inches = imperial fractions, any metric unit = round mm.
const IN = 25.4;
const STEP_PRESETS = {
  in: [{ label: '1/32', value: IN / 32 }, { label: '1/16', value: IN / 16 }, { label: '1/8', value: IN / 8 }, { label: '1/4', value: IN / 4 }],
  mm: [{ label: '0.5', value: 0.5 }, { label: '1', value: 1 }, { label: '2', value: 2 }, { label: '3', value: 3 }],
};
const presetsFor = (table) => table[docUnit()] || table.mm;
// TASK 792: a Contour's FINE step presets (base mm values, the unit's own sizes as above)
const CONTOUR_STEP_PRESETS = {
  in: [{ label: '1/64', value: IN / 64 }, { label: '1/32', value: IN / 32 }, { label: '1/16', value: IN / 16 }, { label: '1/8', value: IN / 8 }],
  mm: [{ label: '0.1', value: 0.1 }, { label: '0.25', value: 0.25 }, { label: '0.5', value: 0.5 }, { label: '1', value: 1 }],
};
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
  minTerraceWidth: { step: { mm: 0.5, in: 1 / 32 }, min: 0 }, // TASK 792: Roughing's Min terrace width (0 = rough every band)
  smoothing:     { step: { mm: 0.01, in: 0.0005 }, min: 0 }, // TASK 809: Roughing / Contour's Smoothing tolerance (0 = off)
  boundaryOffset: { step: { mm: 0.25, in: 1 / 64 } }, // TASK 810: Roughing's boundary offset (signed: no min, as the cut offset)
  topDepth:      { step: { mm: 0.5, in: 1 / 32 }, min: 0 }, // TASK 810: the Heights (depths below the surface; 0 = the surface)
  floorAllowance: { step: { mm: 0.1, in: 0.005 }, min: 0 },
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
const HOLD_PRESETS = HOLD_PART.modes.map((m) => ({ hint: choiceId('holdPart', m.id), label: hintLabel(choiceId('holdPart', m.id)), value: m.id }));
const COUNT_PRESETS = [{ label: 'Auto', value: 'auto' }];
// TASK 775: the Lead-in choice (#core LEAD_IN.modes: Off | On -> the record's true | false) and the leg's side (Outside | Inside), as preset buttons (the ONE preset widget)
const LEAD_PRESETS = LEAD_IN.modes.map((m) => ({ hint: choiceId('leadIn', m.id), label: hintLabel(choiceId('leadIn', m.id)), value: m.id === 'on' }));
const SIDE_PRESETS = LEAD_IN.sides.map((m) => ({ hint: choiceId('leadInSide', m.id), label: hintLabel(choiceId('leadInSide', m.id)), value: m.id }));
const TOOLDIA_DEFAULT_MM = 3.175; // 1/8 in
// TASK 792 (owner turn 2604): Roughing's Layout row (#core ROUGH_LAYOUT), as preset buttons (the ONE preset widget)
const LAYOUT_PRESETS = ROUGH_LAYOUT.layouts.map((l) => ({ hint: choiceId('roughLayout', l.id), label: hintLabel(choiceId('roughLayout', l.id)), value: l.id }));
// TASK 810: Roughing's Boundary (#core ROUGH_BOUNDARY.kinds; the Stock greyed, with its reason as its tooltip, while the design has none) and Tool rule (ROUGH_BOUNDARY.tools)
const boundaryPresets = (hasStock) => ROUGH_BOUNDARY.kinds.map((k) => (k.id === 'stock' && !hasStock
  ? { hint: 'boundaryNoStock', label: hintLabel('boundaryNoStock'), value: k.id, disabled: true }
  : { hint: choiceId('boundary', k.id), label: hintLabel(choiceId('boundary', k.id)), value: k.id }));
const BOUNDARY_TOOL_PRESETS = ROUGH_BOUNDARY.tools.map((t) => ({ hint: choiceId('boundaryTool', t.id), label: hintLabel(choiceId('boundaryTool', t.id)), value: t.id }));
const WALLS_PRESETS = CONTOUR_WALLS.choices.map((w) => ({ hint: choiceId('walls', w.id), label: hintLabel(choiceId('walls', w.id)), value: w.id })); // TASK 810: a Contour's which walls
// TASK S2 (owner turn 2713): a Contour's own WALL SIDE (#core levelsCutAs `wallSide`), where its shape's model does not say it (a drawn shape)
const WALL_SIDE_PRESETS = CONTOUR_WALL_SIDES.map((w) => ({ hint: choiceId('wallSide', w.id), label: hintLabel(choiceId('wallSide', w.id)), value: w.id }));
// TASK 810 (owner turns 2657-2658): the ROUGHING and CONTOUR cards are organised in TABS, as Fusion CAM's operation dialogs: the ONE table of which row lives in which tab
// (a row is its data-row or data-param). Each tab is a FIXED panel: the rows area keeps the height of the tallest tab (applyTabs), so switching tabs moves nothing outside
// the card; a tab none of whose rows shows on this card is not offered. Every other cut type keeps its single card (no tab bar, every row in its place).
const CARD_TABS = [
  { id: 'tool', hint: 'tabTool', rows: ['toolDia', 'cutterShape'] },
  { id: 'geometry', hint: 'tabGeometry', rows: ['boundary', 'boundaryShape', 'boundaryTool', 'boundaryOffset', 'cutOffset', 'minTerraceWidth', 'walls', 'wallSide'] }, // TASK S2: a Contour's Wall side
  { id: 'heights', hint: 'tabHeights', rows: ['cutDepth', 'topDepth', 'floorAllowance'] }, // TASK S2 (owner turn 2740): 810's Bottom row is gone: the Depth is the one depth
  { id: 'passes', hint: 'tabPasses', rows: ['roughLayout', 'stepDepth', 'adaptiveSteps', 'stepDeviation', 'finishAllowance', 'smoothing'] }, // TASK S2: the Contour row is gone (Contour is an operation type)
];
const TAB_OF_ROW = new Map(CARD_TABS.flatMap((t) => t.rows.map((r) => [r, t.id])));
const tabbedType = (cutType) => Boolean(cutType && cutTypeById(cutType) && cutTypeById(cutType).levelsOp); // Roughing, Contour
// TASK 810: a row holds a CHANGED value when it differs from what the operation starts with (the declared defaults): its tab shows a dot. `rec` = the stored record,
// `op` = 'roughing' | 'contour', `c` = the card's state. A row not listed never marks its tab (the depth is the part's own, not a choice).
const near6 = (a, b) => Math.abs(Number(a) - Number(b)) < 1e-6;
const CHANGED = {
  toolDia: (rec, op) => !near6(Number(rec.toolDia) || 0, op === 'contour' ? CONTOUR_DEFAULTS.toolDia : TOOLDIA_DEFAULT_MM),
  cutterShape: (rec, op) => (rec.cutterShape || 'endmill') !== (op === 'contour' ? CONTOUR_DEFAULTS.cutterShape : 'endmill'),
  cutOffset: (rec) => (Number(rec.cutOffset) || 0) !== 0,
  minTerraceWidth: (rec) => Number(rec.minTerraceWidth) > 0,
  boundary: (rec) => boundaryOf(rec).kind !== ROUGH_BOUNDARY.defaultKind,
  boundaryTool: (rec) => boundaryOf(rec).tool !== ROUGH_BOUNDARY.defaultTool,
  boundaryOffset: (rec) => boundaryOf(rec).offset != null,
  walls: (rec, op, c) => Boolean(c.walls) && c.walls.value !== c.walls.defaultId,
  wallSide: (rec, op, c) => c.wallSideFree && rec.wallSide === 'outside', // TASK S2: Inside is what a Contour starts with; it applies only where the model does not say the side
  topDepth: (rec) => Number(rec.topDepth) > 0,
  floorAllowance: (rec) => Number(rec.floorAllowance) > 0,
  roughLayout: (rec) => rec.roughLayout === 'nested',
  stepDepth: (rec, op) => Number(rec.stepDepth) > 0 && !near6(rec.stepDepth, op === 'contour' ? CONTOUR_DEFAULTS.stepDepth : STEP_DEPTH.defaultMm),
  adaptiveSteps: (rec) => rec.adaptiveSteps === true,
  stepDeviation: (rec) => Number(rec.stepDeviation) > 0 && !near6(rec.stepDeviation, STEP_RESOLUTION.defaultMm),
  finishAllowance: (rec) => Number(rec.finishAllowance) > 0,
  smoothing: (rec, op) => rec.smoothing != null && smoothingOf(op, rec.smoothing) !== smoothingOf(op, undefined),
};

// a field's text: lengthText (the one length-format decider: Length precision, default 3, trailing zeros dropped unless TRAILING_ZEROS, or an inch fraction); the unit is beside it
const fieldText = (baseMM) => lengthText(baseMM, { show: 'field' });
const toDocNum = (baseMM) => unitNumber(baseMM, docUnit());  // BASE mm → doc-unit number
const isUnset = (v) => v === 'unset' || v == null;

// TASK 817: the Preview button's icon per state (16 px, currentColor): refresh (idle, stale), a turning arc (busy: CSS .cut-preview[data-state="busy"]), a check (fresh)
const PREVIEW_REFRESH = '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M13 8a5 5 0 1 1-1.6-3.7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M13.2 1.8v3.4H9.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const PREVIEW_ICONS = Object.freeze({
  idle: PREVIEW_REFRESH, stale: PREVIEW_REFRESH,
  busy: '<svg class="cut-spin" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-opacity="0.3" stroke-width="1.8"/><path d="M8 2.5a5.5 5.5 0 0 1 5.5 5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  fresh: '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
});
export function createCutPanel(hostEl, opts = {}) {
  if (!hostEl) return { update() {}, destroy() {} };
  const onPickType = opts.onPickType || (() => {});
  const onSetField = opts.onSetField || (() => {});
  const onSetFields = opts.onSetFields || ((o) => { for (const [k, v] of Object.entries(o)) onSetField(k, v); }); // TASK 463: several fields = ONE undo step
  // TASK S2: the open operation's card (prepare-stage.js): its shapes, Duplicate, OK, Cancel
  const onRemoveShape = opts.onRemoveShape || (() => {}); // (geometry key): the X of a shape row
  const onDuplicate = opts.onDuplicate || (() => {});
  const onOk = opts.onOk || (() => {});
  const onCancel = opts.onCancel || (() => {});
  const onPreview = opts.onPreview || (() => {}); // TASK 817: the open operation's Preview (its paths with the card's settings now, in the background)
  const onHoverShape = opts.onHoverShape || (() => {}); // (geometry key | null): a shape row under the pointer
  const onPickBoundary = opts.onPickBoundary || (() => {}); // TASK 810: Roughing's boundary "Pick" (then a click on a closed shape in Prepare); pressed again while picking: cancel
  hostEl.innerHTML = '';

  const card = document.createElement('div');
  card.className = 'cut-card';
  card.hidden = true;
  card.innerHTML = `
    <div class="cut-card-title">Cut</div>
    <div class="cut-op-headrow" hidden><div class="cut-op-head"></div><button type="button" class="cut-op-dup" data-hint="opDuplicate"></button></div>
    <div class="cut-field">
      <button type="button" class="cut-field-label" data-hint="cutType"></button>
      <div class="cut-type-dd">
        <button type="button" class="cut-type-trigger" aria-haspopup="listbox" aria-expanded="false">
          <span class="cut-ic-slot"></span><span class="cut-type-cur">Select type</span><svg class="cut-caret" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 5l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    </div>
    <div class="cut-tabs" role="tablist" hidden></div>
    <div class="cut-rows">
      <div class="cut-geo" hidden><!-- TASK S2: the open operation's shapes, first in the rows' scroll (a short card, e.g. under the STL card, keeps its rows reachable) -->
        <button type="button" class="cut-field-label" data-hint="opShapes"></button>
        <div class="cut-geo-list"></div>
      </div>
      <div class="cut-row" data-param="cutDepth">
        <button type="button" class="cut-field-label" data-hint="cutDepth"></button>
        <div class="cut-stepper cut-box">
          <div class="cut-mid"><input type="text" class="cut-num cut-depth" inputmode="decimal" placeholder="unset"><span class="cut-unit">mm</span></div>
        </div>
      </div>
      <div class="cut-row" data-row="topDepth">
        <button type="button" class="cut-field-label" data-hint="topDepth"></button>
        <div class="cut-inline cut-box">
          <input type="text" class="cut-num cut-top-depth" inputmode="decimal">
          <span class="cut-unit">mm</span>
        </div>
        <div class="cut-calc-bar"><span class="cut-calc-tag">surface</span><button type="button" class="cut-calc-reset" data-reset="topDepth" hidden>Reset to surface</button></div>
      </div>
      <div class="cut-row" data-row="floorAllowance">
        <button type="button" class="cut-field-label" data-hint="floorAllowance"></button>
        <div class="cut-inline cut-box">
          <input type="text" class="cut-num cut-floor-allowance" inputmode="decimal">
          <span class="cut-unit">mm</span>
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
      <div class="cut-row" data-row="roughLayout">
        <button type="button" class="cut-field-label" data-hint="roughLayout"></button>
        <div class="cut-presets cut-layout-modes"></div>
      </div>
      <div class="cut-row" data-row="boundary">
        <button type="button" class="cut-field-label" data-hint="boundary"></button>
        <div class="cut-presets cut-boundary-kinds"></div>
      </div>
      <div class="cut-row" data-row="boundaryShape">
        <button type="button" class="cut-field-label" data-hint="boundaryShape"></button>
        <div class="cut-calc-bar"><span class="cut-calc-tag cut-boundary-state"></span><button type="button" class="cut-calc-reset cut-boundary-pick" data-hint="boundaryPick" aria-pressed="false"></button></div>
      </div>
      <div class="cut-row" data-row="boundaryTool">
        <button type="button" class="cut-field-label" data-hint="boundaryTool"></button>
        <div class="cut-presets cut-boundary-tools"></div>
      </div>
      <div class="cut-row" data-row="boundaryOffset">
        <button type="button" class="cut-field-label" data-hint="boundaryOffset"></button>
        <div class="cut-inline cut-box">
          <input type="text" class="cut-num cut-boundary-offset" inputmode="decimal">
          <span class="cut-unit">mm</span>
        </div>
        <div class="cut-calc-bar"><span class="cut-calc-tag">calculated</span><button type="button" class="cut-calc-reset" data-reset="boundaryOffset" hidden>Reset to calculated</button></div>
      </div>
      <div class="cut-row" data-row="walls">
        <button type="button" class="cut-field-label" data-hint="walls"></button>
        <div class="cut-presets cut-walls"></div>
      </div>
      <div class="cut-row" data-row="wallSide">
        <button type="button" class="cut-field-label" data-hint="wallSide"></button>
        <div class="cut-presets cut-wall-side"></div>
      </div>
      <div class="cut-row" data-row="minTerraceWidth">
        <button type="button" class="cut-field-label" data-hint="minTerraceWidth"></button>
        <div class="cut-inline cut-box">
          <input type="text" class="cut-num cut-min-terrace" inputmode="decimal">
          <span class="cut-unit">mm</span>
        </div>
      </div>
      <div class="cut-row" data-row="smoothing">
        <button type="button" class="cut-field-label" data-hint="smoothing"></button>
        <div class="cut-inline cut-box">
          <input type="text" class="cut-num cut-smoothing" inputmode="decimal">
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
    <div class="cut-note"></div>
    <div class="cut-actions" hidden><button type="button" class="cut-preview" data-hint="opPreview"></button><button type="button" class="cut-cancel" data-hint="opCancel"></button><button type="button" class="cut-ok" data-hint="opOk"></button></div>
    <div class="cut-pop cut-type-menu" role="listbox" hidden></div>
    <div class="cut-pop cut-offset-pop" hidden></div>
    <div class="cut-pop cut-shape-pop" role="listbox" hidden></div>
    <div class="cut-pop cut-clear-pop" role="listbox" hidden></div>`;
  hostEl.appendChild(card);

  const $ = (sel) => card.querySelector(sel);
  const rowsEl = $('.cut-rows'); // TASK 742: a tall card scrolls its rows: a popover sits at its row as shown (offsetTop minus that scroll); TASK 810: the tabs' panel
  const trigger = $('.cut-type-trigger'), menu = $('.cut-type-menu'), offsetPop = $('.cut-offset-pop'), shapePop = $('.cut-shape-pop'), shapeTrigger = $('.cut-shape-trigger'), shapeIc = $('.cut-shape-ic'), shapeCur = $('.cut-shape-cur'), curLabel = $('.cut-type-cur'), curSw = $('.cut-ic-slot');
  const depthInput = $('.cut-depth'), stepInput = $('.cut-step-depth'), noteEl = $('.cut-note'), offsetInput = $('.cut-offset'), flipBtn = $('.cut-flip'), bitInput = $('.cut-bit'), presetsWrap = $('.cut-row[data-param="toolDia"] .cut-presets'), stepPresetsWrap = $('.cut-row[data-row="stepDepth"] .cut-presets');
  const adaptiveInput = $('.cut-adaptive'), deviationInput = $('.cut-step-deviation'), deviationPresetsWrap = $('.cut-row[data-row="stepDeviation"] .cut-presets'); // TASK 717
  const holdModesWrap = $('.cut-hold-modes'), countInput = $('.cut-tab-count'), countPresetsWrap = $('.cut-row[data-row="tabCount"] .cut-presets') /* the Auto button, inside the count box (a row of its own would push the card past a phone's screen) */, tabWidthInput = $('.cut-tab-width'), holdThicknessInput = $('.cut-hold-thickness'); // TASK 742
  const unitEls = card.querySelectorAll('.cut-unit'); // the unit suffix labels — re-labeled to the doc unit (TASK 745: % and \u00b0 are .cut-unit-fixed)
  const clearTrigger = $('.cut-clear-trigger'), clearPop = $('.cut-clear-pop'), clearIc = $('.cut-clear-ic'), clearCur = $('.cut-clear-cur'); // TASK 745
  const stepoverInput = $('.cut-stepover'), stepoverLen = $('.cut-stepover-len'), allowanceInput = $('.cut-finish-allowance'), loopInput = $('.cut-loop'), angleInput = $('.cut-raster-angle'), anglePresetsWrap = $('.cut-angle-presets');
  const layoutModesWrap = $('.cut-layout-modes'), minTerraceInput = $('.cut-min-terrace'); // TASK 792
  minTerraceInput.addEventListener('change', () => { const n = parseUnit(minTerraceInput.value, docUnit()); if (n != null && Number.isFinite(n) && n >= 0) onSetField('minTerraceWidth', n); else renderFields(); });
  const smoothingInput = $('.cut-smoothing'); // TASK 809
  smoothingInput.addEventListener('change', () => { const n = parseUnit(smoothingInput.value, docUnit()); if (n != null && Number.isFinite(n) && n >= 0) onSetField('smoothing', n); else renderFields(); });
  // TASK S2 (owner rulings turns 2710-2717): the OPEN operation's card: its header ("Pocket 2 · 3 shapes") with Duplicate, its Shapes (one row each with an X that takes
  // it out), its rows (810's tabs, 813's layout), the note area, OK / Cancel. With shapes selected and no operation open: the quick flow's type menu only (+ the note
  // area for a refusal's line).
  const headRow = $('.cut-op-headrow'), opHead = $('.cut-op-head'), dupBtn = $('.cut-op-dup'), geoEl = $('.cut-geo'), geoList = $('.cut-geo-list'), actionsEl = $('.cut-actions');
  dupBtn.addEventListener('click', () => onDuplicate());
  $('.cut-ok').addEventListener('click', () => onOk());
  $('.cut-cancel').addEventListener('click', () => onCancel());
  const previewBtn = $('.cut-preview');
  previewBtn.addEventListener('click', () => onPreview());
  geoList.addEventListener('pointerleave', () => onHoverShape(null));
  const leadModesWrap = $('.cut-lead-modes'), leadRadiusInput = $('.cut-lead-radius'), leadSweepInput = $('.cut-lead-sweep'), leadLengthInput = $('.cut-lead-length'), leadSidesWrap = $('.cut-lead-sides'), leadPosState = $('.cut-pos-state'); // TASK 775 / 778
  // TASK 810: Roughing's machining boundary rows: the Boundary and Tool choices, the picked shape (Pick), the Offset (empty / Reset = calculated)
  const boundaryKindsWrap = $('.cut-boundary-kinds'), boundaryToolsWrap = $('.cut-boundary-tools'), boundaryOffsetInput = $('.cut-boundary-offset'), boundaryState = $('.cut-boundary-state'), boundaryPickBtn = $('.cut-boundary-pick');
  boundaryKindsWrap.setAttribute('role', 'group'); boundaryToolsWrap.setAttribute('role', 'group');
  boundaryPickBtn.addEventListener('click', () => onPickBoundary());
  boundaryOffsetInput.addEventListener('change', () => {
    const raw = boundaryOffsetInput.value.trim();
    if (raw === '') { onSetField('boundaryOffset', null); return; }
    const n = parseUnit(raw, docUnit());
    if (n != null && Number.isFinite(n)) onSetField('boundaryOffset', n); else renderFields();
  });
  // TASK 810: the Heights rows: Top (empty / Reset = the surface), Bottom (empty / Reset = the part's depth), Floor allowance (>= 0)
  const topInput = $('.cut-top-depth'), floorInput = $('.cut-floor-allowance');
  topInput.addEventListener('change', () => {
    const raw = topInput.value.trim();
    if (raw === '') { onSetField('topDepth', null); return; }
    const n = parseUnit(raw, docUnit());
    if (n != null && Number.isFinite(n) && n >= 0) onSetField('topDepth', n > 0 ? n : null); else renderFields(); // 0 = the surface: the default
  });
  floorInput.addEventListener('change', () => { const n = parseUnit(floorInput.value, docUnit()); if (n != null && Number.isFinite(n) && n >= 0) onSetField('floorAllowance', n); else renderFields(); });
  const calcBars = Object.fromEntries(['leadInRadius', 'leadInSweep', 'leadInLength', 'leadInAt', 'boundaryOffset', 'topDepth'].map((f) => [f, {
    tag: card.querySelector(`.cut-row[data-row="${f}"] .cut-calc-tag`),
    reset: card.querySelector(`.cut-row[data-row="${f}"] .cut-calc-reset`),
  }]));
  for (const [f, b] of Object.entries(calcBars)) b.reset.addEventListener('click', () => onSetField(f, null));
  // TASK 810: the tab bar of a Roughing / Contour card (CARD_TABS): a tab = its name (the table's label; its hint the tooltip) and a dot when one of its rows holds a changed value
  const tabsEl = $('.cut-tabs');
  let activeTab = CARD_TABS[0].id; // the tab shown; kept while the page lives (another Roughing / Contour card opens on the same tab)
  const tabButtons = {};
  for (const t of CARD_TABS) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'cut-tab'; b.dataset.tab = t.id; b.setAttribute('role', 'tab'); b.id = `cut-tab-${t.id}`;
    b.innerHTML = `<span class="cut-tab-name" data-hint="${t.hint}"></span><span class="cut-tab-dot" hidden></span>`;
    b.addEventListener('click', () => { if (activeTab === t.id) return; activeTab = t.id; rowsEl.scrollTop = 0; applyTabs(); });
    tabsEl.appendChild(b);
    tabButtons[t.id] = { button: b, dot: b.querySelector('.cut-tab-dot') };
  }
  tabsEl.addEventListener('keydown', (e) => { // the arrow keys move along the offered tabs (the tablist pattern)
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const offered = CARD_TABS.filter((t) => !tabButtons[t.id].button.hidden).map((t) => t.id);
    const i = offered.indexOf(activeTab); if (i < 0) return;
    activeTab = offered[(i + (e.key === 'ArrowRight' ? 1 : offered.length - 1)) % offered.length];
    e.preventDefault(); applyTabs(); tabButtons[activeTab].button.focus();
  });
  // TASK 805: every row's label comes from the table (param-hints.js) and its hint shows as a tooltip at the cursor (hint.js; installed once by main.js): the card holds
  // the label only, no hint text. A row's label is its data-hint element; a choice (a menu row, a Hold part button ...) carries its own data-hint.
  holdModesWrap.setAttribute('role', 'group');
  leadModesWrap.setAttribute('role', 'group'); leadSidesWrap.setAttribute('role', 'group'); // TASK 775
  const hints = {};
  for (const t of card.querySelectorAll('[data-hint]')) hints[t.dataset.hint] = bindHint({ el: t });
  // TASK 817 (owner turns 2747-2748): the Preview button, in the action bar left of Cancel / OK: its icon (refresh; a spinner while its paths are generating; a check
  // while they show the card's settings) in a box of its own size, then its name, so the bar never moves when the icon changes
  previewBtn.innerHTML = '<span class="cut-preview-ic" aria-hidden="true"></span><span class="cut-preview-label"></span>';
  previewBtn.querySelector('.cut-preview-label').textContent = hintLabel('opPreview');
  hints.holdPart.trigger.id = 'cut-hold-label';
  holdModesWrap.setAttribute('aria-labelledby', 'cut-hold-label');
  hints.leadIn.trigger.id = 'cut-lead-label'; leadModesWrap.setAttribute('aria-labelledby', 'cut-lead-label'); // TASK 775
  hints.leadInSide.trigger.id = 'cut-lead-side-label'; leadSidesWrap.setAttribute('aria-labelledby', 'cut-lead-side-label');
  // TASK 805: a menu row = its icon and its name (the table's label); its hint is the tooltip (data-hint = the choice's entry)
  const optionBody = (opt, icon, param, id, nameClass = '') => {
    opt.innerHTML = `${icon}<span class="cut-opt-name ${nameClass}"></span>`;
    opt.querySelector('.cut-opt-name').textContent = hintLabel(choiceId(param, id));
    opt.dataset.hint = choiceId(param, id);
  };

  let current = { kind: null, cutType: null, cutDepth: 'unset', cutOffset: 0, toolDia: TOOLDIA_DEFAULT_MM, cutterShape: 'endmill', cutterAngle: 90, stepDepth: null, adaptiveSteps: false, stepDeviation: null, holdPart: 'off', tabCount: 'auto', tabWidth: null, holdThickness: null, hold: null, clearing: 'freehand', stepover: null, finishAllowance: null, loop: false, rasterAngle: null, clearingInfo: null, leadIn: false, leadInRadius: null, leadInSweep: null, leadInLength: null, leadInSide: 'outside', leadInAt: null, leadInInfo: null, boundaryCtx: { hasStock: false, picking: false }, record: null, note: [], mode: null };

  // TASK 455: popovers open to the LEFT of the card, aligned with the row that opened them (the card is their positioned parent)
  const pops = [menu, offsetPop, shapePop, clearPop];
  const syncOpenState = () => {
    trigger.setAttribute('aria-expanded', String(!menu.hidden)); trigger.classList.toggle('is-open', !menu.hidden);
    shapeTrigger.setAttribute('aria-expanded', String(!shapePop.hidden)); shapeTrigger.classList.toggle('is-open', !shapePop.hidden);
    clearTrigger.setAttribute('aria-expanded', String(!clearPop.hidden)); clearTrigger.classList.toggle('is-open', !clearPop.hidden);
  };
  const closePops = (except) => { for (const p of pops) if (p !== except) p.hidden = true; syncOpenState(); };
  const openPop = (pop, anchor) => { closePops(pop); const row = anchor.closest('.cut-row, .cut-field') || anchor; pop.style.top = (row.offsetTop - (rowsEl.contains(row) ? rowsEl.scrollTop : 0)) + 'px'; pop.hidden = false; keepOnScreen(pop); syncOpenState(); };
  // TASK 770 / 805: a menu taller than the room below its row (the cutter shape row is the last of the card) moves up to end where the card's panel ends (above the phone's
  // Operations bar), and scrolls when it is taller than the panel; one that fits stays at its row
  const keepOnScreen = (pop) => {
    const room = hostEl.getBoundingClientRect();
    pop.style.maxHeight = `${room.height}px`;
    const r = pop.getBoundingClientRect(), over = r.bottom - room.bottom;
    if (over > 0) pop.style.top = `${parseFloat(pop.style.top) - Math.min(over, r.top - room.top)}px`;
  };

  // ── cut-type dropdown (SP1f) ──
  const closeMenu = () => { menu.hidden = true; syncOpenState(); };
  // TASK S2 (owner ruling turn 2716): every type is listed and offered, never greyed; a pick the shapes cannot take is TOLD in the card's note area (prepare-stage.js:
  // cut-plan.js typeRefusal, the one rule)
  function buildMenu() {
    menu.innerHTML = '';
    for (const id of MENU_ORDER) {
      const t = cutTypeById(id); if (!t) continue;
      const opt = document.createElement('button');
      opt.type = 'button';
      opt.className = 'cut-type-opt' + (id === current.cutType ? ' is-current' : '');
      opt.setAttribute('role', 'option'); opt.dataset.id = id;
      optionBody(opt, iconSvg(t), 'cutType', id);
      opt.addEventListener('click', () => { closeMenu(); onPickType(id); });
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
      if (p.hint) b.dataset.hint = p.hint; // TASK 805: a choice with a hint of its own (Hold part modes, Lead-in, Side, Contour, Layout) shows it as a tooltip
      if (p.disabled) { b.classList.add('is-disabled'); b.setAttribute('aria-disabled', 'true'); wrap.appendChild(b); continue; } // TASK 810: greyed, its reason in its tooltip (not `disabled`: it keeps its tooltip)
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
    : field === 'finishAllowance' ? (current.finishAllowance != null && Number(current.finishAllowance) >= 0 ? Number(current.finishAllowance) : cutTypeHasField(current.cutType, 'clearing') ? allowanceDefault(docUnit()) : 0) // TASK 745; TASK 792: a Roughing without one has 0
    : field === 'minTerraceWidth' ? (Number(current.record && current.record.minTerraceWidth) > 0 ? Number(current.record.minTerraceWidth) : 0) // TASK 792
    : field === 'boundaryOffset' ? boundaryOffsetBase() // TASK 810: unset = the calculated offset
    : field === 'topDepth' ? (Number(current.record && current.record.topDepth) > 0 ? Number(current.record.topDepth) : 0) // TASK 810: unset = the surface
    : field === 'floorAllowance' ? (Number(current.record && current.record.floorAllowance) > 0 ? Number(current.record.floorAllowance) : 0)
    : field === 'smoothing' ? smoothingOf((cutTypeById(current.cutType) || {}).levelsOp, current.record ? current.record.smoothing : undefined) // TASK 809: unset = the operation's default
    : field === 'leadInRadius' ? (current.leadInRadius != null && Number(current.leadInRadius) > 0 ? Number(current.leadInRadius) : (current.leadInInfo && Number(current.leadInInfo.radius) > 0 ? Number(current.leadInInfo.radius) : Number(current.toolDia) || 0)) // TASK 778: null = calculated by derivation
    : field === 'leadInLength' ? (current.leadInLength != null && Number(current.leadInLength) >= 0 ? Number(current.leadInLength) : (current.leadInInfo && Number(current.leadInInfo.length) >= 0 ? Number(current.leadInInfo.length) : 0)) // TASK 778: null = calculated (0)
    : (Number(current.stepDeviation) > 0 ? Number(current.stepDeviation) : STEP_RESOLUTION.defaultMm);
  depthInput.addEventListener('change', () => { const v = depthInput.value.trim(), model = tabbedType(current.cutType) ? null : 'unset'; onSetField('cutDepth', v === '' ? model : (parseUnit(v, docUnit()) ?? model)); }); // TASK S2: a Roughing / Contour emptied = From model (null: cut-plan.js setOpFields)
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
      opt.setAttribute('role', 'option'); opt.dataset.clearing = c.id;
      optionBody(opt, iconSvg(c), 'clearing', c.id, 'cut-clear-name');
      if (why) { opt.setAttribute('aria-disabled', 'true'); setOffReason(opt, why); } // TASK 813: greyed; its reason is its tooltip (not `disabled`: it keeps the tooltip), no line under it
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
  stepperFor('minTerraceWidth', minTerraceInput, 'min terrace width', { box: minTerraceInput.closest('.cut-box') }); // TASK 792
  stepperFor('smoothing', smoothingInput, 'smoothing', { box: smoothingInput.closest('.cut-box') }); // TASK 809
  stepperFor('boundaryOffset', boundaryOffsetInput, 'boundary offset', { box: boundaryOffsetInput.closest('.cut-box') }); // TASK 810: from the calculated value while it is unset
  stepperFor('topDepth', topInput, 'top', { box: topInput.closest('.cut-box') }); // TASK 810: from the surface (0) while unset
  stepperFor('floorAllowance', floorInput, 'floor allowance', { box: floorInput.closest('.cut-box') });
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

  // TASK 813: a row's state on this card: false = the card has no such row (another operation / target); true = shown; a string = shown IN ITS PLACE but greyed and inert (it
  // does not apply to the current settings), the string its reason: the start of its label's tooltip. So changing a setting never moves the rows below it.
  const place = (name, state) => {
    const row = card.querySelector(`.cut-row[data-row="${name}"], .cut-row[data-param="${name}"]`), off = typeof state === 'string' ? state : null; // TASK S2: + the Depth row (data-param)
    row.style.display = state === false ? 'none' : '';
    row.classList.toggle('is-off', Boolean(off));
    if (off) { row.dataset.off = ''; row.setAttribute('aria-disabled', 'true'); } else { delete row.dataset.off; row.removeAttribute('aria-disabled'); }
    for (const part of row.children) {
      if (part.classList.contains('cut-field-label')) setOffReason(part, off);
      else if (part.classList.contains('cut-check')) { part.querySelector('input').disabled = Boolean(off); setOffReason(part.querySelector('[data-hint]'), off); }
      else part.toggleAttribute('inert', Boolean(off)); // the label stays live: it carries the tooltip
    }
  };
  const syncCalcBar = (f, isCalculated) => { calcBars[f].tag.hidden = !isCalculated; calcBars[f].reset.hidden = isCalculated; }; // a calculated value: its tag, else Reset to calculated
  const boundaryOffsetBase = () => { const b = boundaryOf(current.record); return b.offset != null ? b.offset : boundaryCalcOffset({ ...(current.record || {}), levelsOp: 'roughing' }); }; // TASK 810
  // TASK 810: show the active tab's rows of a Roughing / Contour card (the rows the card logic shows, CARD_TABS), the dots, and the panel's fixed height (the tallest tab's
  // rows, measured: every tab is laid out once, the rows area then keeps that height as its flex basis, shrinking and scrolling only where the panel is shorter). The card
  // note is under the rows on every card (TASK 813: an area of its own, fixed height). An untabbed card: every row as the card logic left it.
  const rowKey = (row) => row.dataset.row || row.dataset.param;
  function applyTabs() {
    const tabbed = tabbedType(current.cutType);
    const rows = [...rowsEl.children].filter((el) => el.classList.contains('cut-row'));
    rowsEl.style.flex = '';
    tabsEl.hidden = !tabbed;
    if (!tabbed) { for (const r of rows) delete r.dataset.offTab; return; }
    const op = cutTypeById(current.cutType).levelsOp, rec = current.record || {};
    const shown = rows.filter((r) => r.style.display !== 'none');
    const offered = CARD_TABS.filter((t) => shown.some((r) => TAB_OF_ROW.get(rowKey(r)) === t.id));
    const tab = offered.some((t) => t.id === activeTab) ? activeTab : (offered[0] || CARD_TABS[0]).id; // the stored tab when this card offers it
    for (const t of CARD_TABS) {
      const tb = tabButtons[t.id], on = t.id === tab;
      tb.button.hidden = !offered.includes(t);
      tb.dot.hidden = !shown.some((r) => TAB_OF_ROW.get(rowKey(r)) === t.id && CHANGED[rowKey(r)] && CHANGED[rowKey(r)](rec, op, current));
      tb.button.classList.toggle('is-active', on); tb.button.setAttribute('aria-selected', String(on)); tb.button.tabIndex = on ? 0 : -1;
      tb.button.setAttribute('aria-label', `${hintLabel(t.hint)}${tb.dot.hidden ? '' : ' (changed)'}`);
    }
    const showTab = (id) => { for (const r of rows) { if (TAB_OF_ROW.get(rowKey(r)) === id) delete r.dataset.offTab; else r.dataset.offTab = ''; } };
    let tallest = 0;
    for (const t of offered) { showTab(t.id); tallest = Math.max(tallest, rowsEl.scrollHeight); }
    showTab(tab);
    rowsEl.setAttribute('role', 'tabpanel'); rowsEl.setAttribute('aria-labelledby', `cut-tab-${tab}`);
    if (tallest > 0) rowsEl.style.flex = `0 1 ${tallest}px`;
  }

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
    const partLevels = Boolean(current.record && Array.isArray(current.record.levels) && current.record.levels.length); // TASK 792: a part with levels: Roughing steps every Step depth (adaptive stepping reads a slope's rings)
    const adaptive = declares('adaptiveSteps') && !partLevels && current.adaptiveSteps === true; // TASK 717: the Resolution row replaces the Step depth row
    place('adaptiveSteps', declares('adaptiveSteps') && !partLevels);
    // TASK 813: Step depth and Resolution both stay in place: the one Adaptive stepping does not use is greyed
    place('stepDepth', declares('stepDepth') ? !adaptive || 'Adaptive stepping sets the steps: set its Resolution instead.' : false);
    place('stepDeviation', declares('stepDeviation') ? adaptive || 'Turn Adaptive stepping on to set its Resolution.' : false);
    adaptiveInput.checked = adaptive;
    stepInput.value = fieldText(Number(current.stepDepth) > 0 ? Number(current.stepDepth) : STEP_DEPTH.defaultMm);
    const deviation = Number(current.stepDeviation) > 0 ? Number(current.stepDeviation) : STEP_RESOLUTION.defaultMm;
    deviationInput.value = lengthText(deviation, { show: 'field', fractions: false }); // 0.1 mm = 0.0039 in: a tolerance finer than 1/64, always decimals
    // TASK 742: Hold part, for a type that declares it (a plain Outside / Inside): the choice, then the Tabs rows (count, width, thickness) or the Onion skin row (thickness)
    const hold = declares('holdPart') ? (current.holdPart === 'tabs' || current.holdPart === 'skin' ? current.holdPart : 'off') : null;
    // TASK 813: the rows of a Hold part choice stay in place, greyed, while it does not use them
    const tabsOnly = hold === 'tabs' || 'Choose Tabs in Hold part to set this.';
    place('holdPart', Boolean(hold));
    place('tabCount', hold ? tabsOnly : false);
    place('tabWidth', hold ? tabsOnly : false);
    place('holdThickness', !hold ? false : (hold === 'tabs' && tabsHaveThickness(current.cutType)) || hold === 'skin' || (hold === 'tabs' ? 'On a line the tabs are uncut gaps: they have no thickness.' : 'Choose Tabs or Onion skin in Hold part to set this.')); // TASK 775: an On line cut's tabs are uncut gaps (no thickness)
    hints.tabWidth.refresh({ online: Boolean(hold) && !tabsHaveThickness(current.cutType) });
    hints.holdThickness.setId(hold === 'skin' ? 'skinThickness' : 'holdThickness'); // TASK 770: the row is the skin's thickness with Onion skin
    renderPresets(holdModesWrap, hold ? HOLD_PRESETS : [], 'holdPart', hold); // hidden rows keep no preset buttons
    renderPresets(countPresetsWrap, hold ? COUNT_PRESETS : [], 'tabCount', Number(current.tabCount) >= 1 ? Number(current.tabCount) : 'auto');
    countInput.value = Number(current.tabCount) >= 1 ? String(Math.floor(Number(current.tabCount))) : '';
    countInput.placeholder = current.hold && current.hold.requested >= 1 && !(Number(current.tabCount) >= 1) ? `Auto (${current.hold.requested})` : 'Auto';
    tabWidthInput.value = fieldText(fieldBase('tabWidth'));
    holdThicknessInput.value = fieldText(fieldBase('holdThickness'));
    // TASK 745: the Clearing choice of a type that declares it (the plain Pocket), then the rows of a computed pattern (Raster: + its angle)
    const clearing = declares('clearing') ? (CLEARING_CHOICES.some((c) => c.id === current.clearing) ? current.clearing : 'freehand') : null;
    const computed = Boolean(clearing) && clearing !== 'freehand';
    // TASK 813: Freehand has no passes: the rows of a computed pattern stay in place, greyed, while Freehand is chosen
    const patternOnly = computed || 'Freehand has no passes: choose Spiral or Raster in Clearing to set this.';
    place('clearing', Boolean(clearing));
    for (const row of ['stepover', 'loop']) place(row, clearing ? patternOnly : false);
    const roughing = declares('finishAllowance') && !declares('clearing'); // TASK 792: Roughing's allowance row (a Pocket shows it with a computed clearing)
    place('finishAllowance', roughing ? true : clearing ? patternOnly : false);
    const isContour = current.cutType === 'contour'; // TASK S2: a Contour operation (its card's fine step, its walls)
    hints.stepDepth.refresh({ contour: isContour });
    // TASK 792 (owner turn 2604): Roughing's Layout (Terraces | Nested), for a part with levels (a sloped region's Roughing is the stepped cut)
    const layoutRow = declares('roughLayout') && Boolean(current.record && Array.isArray(current.record.levels) && current.record.levels.length);
    place('roughLayout', layoutRow);
    renderPresets(layoutModesWrap, layoutRow ? LAYOUT_PRESETS : [], 'roughLayout', current.record && current.record.roughLayout === 'nested' ? 'nested' : 'terraces');
    place('minTerraceWidth', layoutRow ? !(current.record && current.record.roughLayout === 'nested') || 'Only the Terraces layout has bands to leave: choose Terraces in Layout to set this.' : false); // the Terraces layout's row
    minTerraceInput.value = fieldText(fieldBase('minTerraceWidth'));
    // TASK 810: Roughing's machining boundary (a part with levels, as the Layout): Boundary, the picked Shape (with Shape), Tool, Offset (calculated while unset)
    const b = boundaryOf(current.record), boundaryRows = declares('boundary') && layoutRow;
    for (const row of ['boundary', 'boundaryTool', 'boundaryOffset']) place(row, boundaryRows);
    place('boundaryShape', boundaryRows ? b.kind === 'shape' || 'Choose Shape in Boundary to pick a shape.' : false);
    renderPresets(boundaryKindsWrap, boundaryRows ? boundaryPresets(current.boundaryCtx.hasStock) : [], 'boundary', b.kind);
    renderPresets(boundaryToolsWrap, boundaryRows ? BOUNDARY_TOOL_PRESETS : [], 'boundaryTool', b.tool);
    boundaryState.textContent = current.boundaryCtx.picking ? 'click a closed shape' : b.shape ? 'picked' : 'none picked';
    hints.boundaryPick.setId(current.boundaryCtx.picking ? 'boundaryPickCancel' : 'boundaryPick');
    boundaryPickBtn.setAttribute('aria-pressed', String(Boolean(current.boundaryCtx.picking)));
    boundaryOffsetInput.value = fieldText(fieldBase('boundaryOffset'));
    syncCalcBar('boundaryOffset', b.offset == null);
    // TASK 810: the Heights of a Roughing / Contour (any part): Top, Bottom (empty = the surface / the part's depth, shown greyed), Floor allowance
    const heights = tabbedType(current.cutType), hr = current.record || {};
    for (const row of ['topDepth', 'floorAllowance']) place(row, heights);
    topInput.value = Number(hr.topDepth) > 0 ? fieldText(Number(hr.topDepth)) : ''; topInput.placeholder = fieldText(0);
    floorInput.value = fieldText(fieldBase('floorAllowance'));
    syncCalcBar('topDepth', !(Number(hr.topDepth) > 0));
    // TASK 810: a Contour's which walls, where its part's walls come from levels or slope rings (a drawn region's Contour is its one wall); the choice in effect shown
    const wallsRow = isContour && Boolean(current.walls && current.walls.shown);
    place('walls', wallsRow);
    renderPresets($('.cut-walls'), wallsRow ? WALLS_PRESETS : [], 'walls', wallsRow ? current.walls.value : null);
    // TASK S2 (owner turn 2713): a Contour's own Wall side, in its place on every Contour card; greyed where the model of its shapes says the side (a slope, levels)
    place('wallSide', isContour ? current.wallSideFree || 'Its shapes\u2019 model says which side: a slope or the STL\u2019s levels.' : false);
    renderPresets($('.cut-wall-side'), isContour ? WALL_SIDE_PRESETS : [], 'wallSide', current.record && current.record.wallSide === 'outside' ? 'outside' : 'inside');
    // TASK S2 (owner turn 2740): a Roughing's / Contour's Depth is its ONE depth, a live row: empty = From model (each shape to its own model depth), a value = the cut stops there
    if (heights) { depthInput.value = current.depthFromModel ? '' : fieldText(Number(current.cutDepth)); depthInput.placeholder = Number(current.partDepth) > 0 && current.depthFromModel ? `From model (${fieldText(Number(current.partDepth))})` : 'From model'; } else depthInput.placeholder = 'unset'; // From model: the model's depth beside it when it is known
    place('smoothing', declares('smoothing') && Boolean(current.levels)); // TASK 809: an operation on a part with levels (an STL)
    smoothingInput.value = lengthText(fieldBase('smoothing'), { show: 'field', fractions: false }); // 0.05 mm = 0.002 in: a tolerance, always decimals
    place('rasterAngle', clearing ? clearing === 'raster' || 'Only Raster has an angle: choose Raster in Clearing to set this.' : false);
    const choice = CLEARING_CHOICE(clearing || 'freehand');
    clearIc.innerHTML = iconSvg(choice); clearCur.textContent = hintLabel(choiceId('clearing', choice.id));
    const pct = Number(current.stepover) > 0 ? Number(current.stepover) : POCKET_CLEARING.stepoverPct.default;
    stepoverInput.value = String(Math.round(pct * 100) / 100);
    stepoverLen.textContent = clearing ? `= ${lengthText((pct / 100) * (Number(current.toolDia) || 0), { show: 'unit', fractions: false })}` : '';
    allowanceInput.value = fieldText(fieldBase('finishAllowance'));
    loopInput.checked = computed && current.loop === true;
    hints.finishAllowance.refresh({ loop: current.loop === true, roughing }); // TASK 766 / 770: who takes the finish allowance off depends on Loop (param-hints.js); TASK 792: on a Roughing, the Contour
    // TASK 775 / 778: the Lead-in row on an On line OUTLINE ONLY (a closed loop, not an open line; not with Tabs; pockets get a start mark, never lead-in).
    // On: Radius, Sweep, Length (each showing calculated tag or Reset to calculated), Side, Position (calculated | moved + Reset to calculated).
    // TASK 813: the row stays in place with a reason where this target cannot take it (an open line, Tabs); its rows stay in place, greyed, while Lead-in is Off
    const leadDecl = declares('leadIn');
    const leadWhy = !leadDecl ? null : current.kind === 'chain' ? 'A lead-in needs a closed line: this one is open.' : hold === 'tabs' ? 'Not with Tabs: the line is cut in pieces.' : null;
    const leadOn = leadDecl && !leadWhy && current.leadIn === true;
    place('leadIn', leadDecl ? leadWhy || true : false);
    for (const row of ['leadInRadius', 'leadInSweep', 'leadInLength', 'leadInSide', 'leadInAt']) place(row, declares(row) ? leadOn || leadWhy || 'Turn Lead-in On to set this.' : false);
    renderPresets(leadModesWrap, leadDecl ? LEAD_PRESETS : [], 'leadIn', current.leadIn === true);
    renderPresets(leadSidesWrap, declares('leadInSide') ? SIDE_PRESETS : [], 'leadInSide', current.leadInSide);
    leadRadiusInput.value = fieldText(fieldBase('leadInRadius'));
    const sweepVal = current.leadInSweep != null && Number.isFinite(Number(current.leadInSweep)) ? Number(current.leadInSweep) : (current.leadInInfo && Number.isFinite(Number(current.leadInInfo.sweep)) ? Number(current.leadInInfo.sweep) : LEAD_IN.sweep.defaultDeg);
    leadSweepInput.value = String(Math.round(sweepVal * 100) / 100);
    leadLengthInput.value = fieldText(fieldBase('leadInLength'));
    syncCalcBar('leadInRadius', current.leadInRadius == null);
    syncCalcBar('leadInSweep', current.leadInSweep == null);
    syncCalcBar('leadInLength', current.leadInLength == null);
    const posMoved = current.leadInAt != null;
    leadPosState.textContent = posMoved ? 'moved' : 'calculated';
    leadPosState.classList.toggle('is-moved', posMoved);
    calcBars.leadInAt.reset.hidden = !posMoved;
    const angle = Number.isFinite(Number(current.rasterAngle)) && current.rasterAngle !== null ? Number(current.rasterAngle) : POCKET_CLEARING.rasterAngle;
    angleInput.value = String(Math.round(angle * 100) / 100);
    renderPresets(anglePresetsWrap, clearing ? ANGLE_PRESETS : [], 'rasterAngle', angle);
    noteEl.innerHTML = '';
    for (const line of current.note) { // a line is text, or { text, warn, title }: `warn` (the part of text to flag) is shown in the warning colour
      const item = typeof line === 'string' ? { text: line } : line, d = document.createElement('div');
      if (item.warn && item.text.endsWith(item.warn)) {
        d.append(item.text.slice(0, item.text.length - item.warn.length));
        const w = document.createElement('span'); w.className = 'cut-note-warn'; w.textContent = item.warn; w.title = item.title || ''; d.appendChild(w);
      } else d.textContent = item.text;
      noteEl.appendChild(d);
    }
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
    renderPresets(stepPresetsWrap, declares('stepDepth') ? presetsFor(isContour ? CONTOUR_STEP_PRESETS : STEP_PRESETS) : [], 'stepDepth', Number(current.stepDepth) > 0 ? Number(current.stepDepth) : STEP_DEPTH.defaultMm);
    renderPresets(deviationPresetsWrap, declares('stepDeviation') ? RESOLUTION_PRESETS : [], 'stepDeviation', deviation);
    const shape = CUTTER_SHAPES.find((x) => x.id === current.cutterShape) || CUTTER_SHAPES[0];
    const shapeName = hintLabel(choiceId('cutterShape', shape.id));
    shapeIc.innerHTML = iconSvg(shape); shapeCur.textContent = shape.id === 'vbit' ? `${shapeName} ${angleText(Number(current.cutterAngle) || 90, { show: 'deg' })}` : shapeName;
    const u = docUnit();
    unitEls.forEach((el) => { el.textContent = u; });
    // TASK S2 (owner turn 2717): with shapes selected and no operation open the card is the type menu only: no rows, no tabs (set BEFORE applyTabs measures the tabs)
    const typeOnly = current.mode === 'shape';
    rowsEl.hidden = typeOnly;
    applyTabs(); // TASK 810: last, on the rows the card logic shows
    if (typeOnly) tabsEl.hidden = true;
  };
  // TASK S2: the header, the chips, the Geometry row and a Contour's part line of the card in hand (see above)
  function renderOpParts(model) {
    const op = model.mode === 'op';
    headRow.hidden = !op; opHead.textContent = op ? model.title : '';
    geoEl.hidden = !op; actionsEl.hidden = !op;
    // TASK 817: the Preview's state (prepare-stage.js): 'idle' (none), 'busy' (generating), 'fresh' (drawn: the card's settings now), 'stale' (drawn faded: changed since)
    const pv = op ? model.preview || 'idle' : 'idle';
    if (previewBtn.dataset.state !== pv) {
      previewBtn.dataset.state = pv;
      previewBtn.querySelector('.cut-preview-ic').innerHTML = PREVIEW_ICONS[pv];
      previewBtn.setAttribute('aria-busy', pv === 'busy' ? 'true' : 'false');
      previewBtn.setAttribute('aria-pressed', pv === 'fresh' ? 'true' : 'false');
    }
    geoList.replaceChildren(...((op && model.shapes) || []).map(({ key, label }) => { // one row per shape: its words and an X that takes it out of the operation
      const row = document.createElement('div'); row.className = 'cut-geo-shape'; row.dataset.key = key;
      const name = document.createElement('span'); name.className = 'cut-geo-name'; name.textContent = label;
      const x = document.createElement('button'); x.type = 'button'; x.className = 'cut-geo-x'; x.dataset.hint = 'opRemoveShape'; x.textContent = '\u2715'; x.setAttribute('aria-label', `Take ${label} out of this operation`);
      bindHint({ el: x, iconOnly: true });
      x.addEventListener('click', () => onRemoveShape(key));
      row.addEventListener('pointerenter', () => onHoverShape(key));
      row.append(name, x);
      return row;
    }));
  }

  // update(model | null): null → hide the card; else show + reflect the selected target's record (values in BASE mm).
  const update = (model) => {
    if (!model) { card.hidden = true; closeMenu(); current = { mode: null, kind: null, cutType: null, cutDepth: 'unset', cutOffset: 0, toolDia: TOOLDIA_DEFAULT_MM, cutterShape: 'endmill', cutterAngle: 90, stepDepth: null, adaptiveSteps: false, stepDeviation: null, holdPart: 'off', tabCount: 'auto', tabWidth: null, holdThickness: null, hold: null, clearing: 'freehand', stepover: null, finishAllowance: null, loop: false, rasterAngle: null, clearingInfo: null, leadIn: false, leadInRadius: null, leadInSweep: null, leadInLength: null, leadInSide: 'outside', leadInAt: null, leadInInfo: null, boundaryCtx: { hasStock: false, picking: false }, record: null, note: [] }; return; }
    const rec = model.record || {};
    current = { kind: model.kind, cutType: rec.cutType || null, cutDepth: rec.cutDepth, cutOffset: rec.cutOffset, toolDia: rec.toolDia, cutterShape: rec.cutterShape || 'endmill', cutterAngle: rec.cutterAngle || 90, stepDepth: rec.stepDepth, adaptiveSteps: rec.adaptiveSteps === true, stepDeviation: rec.stepDeviation, holdPart: rec.holdPart || 'off', tabCount: rec.tabCount ?? 'auto', tabWidth: rec.tabWidth, holdThickness: rec.holdThickness, hold: model.hold || null,
      clearing: rec.clearing || 'freehand', stepover: rec.stepover ?? null, finishAllowance: rec.finishAllowance ?? null, loop: rec.loop === true, rasterAngle: rec.rasterAngle ?? null, clearingInfo: model.clearing || null, // TASK 745
      leadIn: rec.leadIn === true, leadInRadius: rec.leadInRadius ?? null, leadInSweep: rec.leadInSweep ?? null, leadInLength: rec.leadInLength ?? null, leadInSide: rec.leadInSide === 'inside' ? 'inside' : 'outside', leadInAt: rec.leadInAt ?? null, leadInInfo: model.leadIn || null, // TASK 775 / 778
      mode: model.mode || null, // TASK S2: 'op' (an open operation) | 'shape' (shapes selected: the type menu only)
      wallSideFree: model.wallSideFree === true, // TASK S2: a Contour's Wall side applies (a shape whose model does not say it)
      depthFromModel: model.depthFromModel !== false, // TASK S2: a Roughing's / Contour's Depth from the model, or typed (the cut stops there)
      levels: model.levels === true || hasLevels(rec), // TASK 809: the operation cuts a part's levels (its Smoothing row; a Contour's are its part's: model.levels)
      boundaryCtx: { hasStock: Boolean(model.boundary && model.boundary.hasStock), picking: Boolean(model.boundary && model.boundary.picking) }, // TASK 810: does the design have a Stock; is a boundary Pick on
      partDepth: Number(model.partDepth) > 0 ? Number(model.partDepth) : null, // TASK 810: the part's depth (the Bottom's default; a Contour's is its part's)
      walls: model.walls || null, // TASK 810: a Contour's walls { shown, value (in effect), defaultId }
      record: rec, note: Array.isArray(model.note) ? model.note : [] };
    card.hidden = false;
    renderOpParts(model);
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
