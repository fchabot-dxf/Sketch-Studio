// Shaper Prepare — the cut-settings card (SP1f: cut-TYPE control; SP1g: depth / offset / bit-diameter rows).
// Pure view: it reflects the selected target's cut record and emits picks/edits via callbacks — it owns no cut
// state. Cut data + gating live in shaper.js; the live records live in prepare-view.js (CUT_PLAN).

import { availableTypes, cutTypeById } from './shaper.js';

// Menu order per the Shaper mockup: path types first (on line / guide), then region (inside / pocket / outside).
const MENU_ORDER = ['online', 'guide', 'interior', 'pocket', 'exterior'];
const swatch = (t) => { const c = (t.previewStroke && t.previewStroke !== 'none') ? t.previewStroke : t.previewFill; return (c && c !== 'none') ? c : 'var(--sk-muted, #9aa0a6)'; };

// DECLARED data (not hard-coded buttons): the quick bit-diameter presets, in inches.
const BIT_PRESETS = [
  { label: '.02', value: 0.02 },
  { label: '1/8', value: 0.125 },
  { label: '1/4', value: 0.25 },
  { label: '1/2', value: 0.5 },
];
const DEPTH_START = 0.1;   // first value when stepping up/down from 'unset'
const DEPTH_STEP = 0.05;   // inches per step

const fmt = (n) => Number(n).toFixed(3);
const parseNum = (s) => { const n = parseFloat(String(s).trim()); return Number.isFinite(n) ? n : null; };
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
          <span class="cut-unit">in</span>
        </div>
      </div>
      <div class="cut-row">
        <label class="cut-field-label">Offset</label>
        <div class="cut-inline">
          <button type="button" class="cut-flip" title="Flip offset direction" aria-pressed="false">&#8644;</button>
          <input type="text" class="cut-num cut-offset" inputmode="decimal">
          <span class="cut-unit">in</span>
        </div>
      </div>
      <div class="cut-row">
        <label class="cut-field-label">Bit diameter</label>
        <div class="cut-inline">
          <input type="text" class="cut-num cut-bit" inputmode="decimal">
          <span class="cut-unit">in</span>
        </div>
        <div class="cut-presets"></div>
      </div>
    </div>`;
  hostEl.appendChild(card);

  const $ = (sel) => card.querySelector(sel);
  const trigger = $('.cut-type-trigger'), menu = $('.cut-type-menu'), curLabel = $('.cut-type-cur'), curSw = $('.cut-sw');
  const depthInput = $('.cut-depth'), offsetInput = $('.cut-offset'), flipBtn = $('.cut-flip'), bitInput = $('.cut-bit'), presetsWrap = $('.cut-presets');

  // current mirrors the selected record (so the steppers/flip can compute from it). FORWARD-COMPAT (SP1i): a later
  // multi-select 'mixed' model would set the inputs to a blank/"mixed" placeholder instead of a single value.
  let current = { kind: null, cutType: null, cutDepth: 'unset', cutOffset: 0, toolDia: 0.125 };

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

  // ── param rows (SP1g) ──
  for (const p of BIT_PRESETS) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'cut-preset'; b.dataset.value = String(p.value); b.textContent = p.label;
    b.addEventListener('click', () => onSetField('toolDia', p.value));
    presetsWrap.appendChild(b);
  }
  card.querySelectorAll('.cut-step').forEach((btn) => btn.addEventListener('click', () => {
    const d = Number(btn.dataset.d);
    const cur = isUnset(current.cutDepth) ? null : Number(current.cutDepth);
    const next = cur == null ? DEPTH_START : Math.max(0, +(cur + d * DEPTH_STEP).toFixed(4)); // step from 'unset' → start
    onSetField('cutDepth', next);
  }));
  depthInput.addEventListener('change', () => { const v = depthInput.value.trim(); onSetField('cutDepth', v === '' ? 'unset' : (parseNum(v) ?? 'unset')); });
  offsetInput.addEventListener('change', () => onSetField('cutOffset', parseNum(offsetInput.value) ?? 0));
  flipBtn.addEventListener('click', () => onSetField('cutOffset', -(Number(current.cutOffset) || 0)));
  bitInput.addEventListener('change', () => { const n = parseNum(bitInput.value); if (n != null) onSetField('toolDia', n); });

  // update(model | null): null → hide the card; else show + reflect the selected target's record.
  const update = (model) => {
    if (!model) { card.hidden = true; closeMenu(); current = { kind: null, cutType: null, cutDepth: 'unset', cutOffset: 0, toolDia: 0.125 }; return; }
    const rec = model.record || {};
    current = { kind: model.kind, cutType: rec.cutType || null, cutDepth: rec.cutDepth, cutOffset: rec.cutOffset, toolDia: rec.toolDia };
    card.hidden = false;
    // cut type
    const t = current.cutType ? cutTypeById(current.cutType) : null;
    curLabel.textContent = t ? t.menuLabel : 'Select type';
    curSw.style.background = t ? swatch(t) : 'transparent';
    if (!menu.hidden) buildMenu();
    // params
    depthInput.value = isUnset(current.cutDepth) ? '' : fmt(current.cutDepth);
    const off = Number(current.cutOffset) || 0;
    offsetInput.value = fmt(off);
    flipBtn.classList.toggle('is-on', off < 0);
    flipBtn.setAttribute('aria-pressed', String(off < 0));
    const dia = Number(current.toolDia) || 0;
    bitInput.value = fmt(dia);
    presetsWrap.querySelectorAll('.cut-preset').forEach((b) => b.classList.toggle('is-active', Number(b.dataset.value) === dia));
  };

  return { update, destroy() { document.removeEventListener('click', onDocClick); hostEl.innerHTML = ''; } };
}
