// Shaper Prepare — the cut-settings card (SP1f: the cut-TYPE control only; depth/offset/bit-dia rows are SP1g).
// Pure view: it reflects the selected target's cut record and emits picks via onPickType — it owns no cut state.
// The cut data + gating live in shaper.js (CUT_TYPES / availableTypes); the live records live in prepare-view.js.

import { availableTypes, cutTypeById } from './shaper.js';

// Menu order per the Shaper mockup: path types first (on line / guide), then region (inside / pocket / outside).
const MENU_ORDER = ['online', 'guide', 'interior', 'pocket', 'exterior'];
// The swatch colour = the type's dark-canvas preview (stroke for paths, fill for regions).
const swatch = (t) => { const c = (t.previewStroke && t.previewStroke !== 'none') ? t.previewStroke : t.previewFill; return (c && c !== 'none') ? c : 'var(--sk-muted, #9aa0a6)'; };

export function createCutPanel(hostEl, opts = {}) {
  if (!hostEl) return { update() {}, destroy() {} };
  const onPickType = opts.onPickType || (() => {});
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
    <div class="cut-rows" aria-hidden="true"><!-- SP1g: depth / offset / bit-diameter rows land here --></div>`;
  hostEl.appendChild(card);

  const trigger = card.querySelector('.cut-type-trigger');
  const menu = card.querySelector('.cut-type-menu');
  const curLabel = card.querySelector('.cut-type-cur');
  const curSw = card.querySelector('.cut-sw');

  let current = { kind: null, cutType: null };

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
      opt.setAttribute('role', 'option');
      opt.dataset.id = id;
      opt.disabled = !enabled;
      opt.innerHTML = `<span class="cut-sw" style="background:${swatch(t)}"></span><span>${t.menuLabel}</span>`;
      if (enabled) opt.addEventListener('click', () => { closeMenu(); onPickType(id); });
      menu.appendChild(opt);
    }
  }

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const opening = menu.hidden;
    if (opening) buildMenu();
    menu.hidden = !opening;
    trigger.setAttribute('aria-expanded', String(opening));
  });
  const onDocClick = (e) => { if (!card.contains(e.target)) closeMenu(); };
  document.addEventListener('click', onDocClick);

  // update(model | null): null → hide the card; else show + reflect the selected target's record.
  const update = (model) => {
    if (!model) { card.hidden = true; closeMenu(); current = { kind: null, cutType: null }; return; }
    current = { kind: model.kind, cutType: (model.record && model.record.cutType) || null };
    card.hidden = false;
    const t = current.cutType ? cutTypeById(current.cutType) : null;
    curLabel.textContent = t ? t.menuLabel : 'Select type';
    curSw.style.background = t ? swatch(t) : 'transparent';
    if (!menu.hidden) buildMenu(); // keep an open menu's gating/highlight in sync
  };

  return { update, destroy() { document.removeEventListener('click', onDocClick); hostEl.innerHTML = ''; } };
}
