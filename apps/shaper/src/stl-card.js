// apps/shaper/src/stl-card.js — TASK 790: the STL CARD of Prepare (a view, like stock-card.js): while the design came from an STL (stl-source.js) it
// shows the file name, the Up side, the Units and the size the part was sliced at; a press on another Up side or unit calls onChange({ up } | { unit })
// (stl-import.js slices it again and REPLACES that part, one undo step; TASK 841: the card's source is the relief selected in Prepare, stl-source.js getStlSource).
// No STL source: the card is hidden. It follows the source (stl-source.js). It sits above the cut card in Prepare's
// right column (#prepare-panel) and folds like the Operations sheet (disclosure.js: open on a wide screen, folded on a phone). Built from the cut
// card's own parts: its row labels (.cut-field-label, in .stl-row rows laid out as its .cut-row), its preset buttons (.cut-presets / .cut-preset), the one hint binding (hint.js bindHint: its hints are the cursor tooltip)
// with the labels and hints of THE table (param-hints.js).
import { STL_UP_SIDES, STL_UNITS } from '#core/stl-slice.js';
import SettingsManager, { lengthText, isPrecisionKey } from '#core/settings-manager.js';
import { getStlSource, onStlSourceChange } from './stl-source.js';
import { bindHint } from './hint.js';
import { hintLabel } from './param-hints.js';
import { mountDisclosure, CARET_SVG } from './disclosure.js';

const UP_LABEL = (id) => id.replace('-', '−'); // the sign as a real minus

/** mountStlCard(hostEl, { onChange, onOrient }) -> { refresh(), el }. The card is put FIRST in hostEl. */
export function mountStlCard(hostEl, { onChange = () => {}, onOrient = () => {} } = {}) {
  if (!hostEl) return { refresh() {}, el: null };
  const doc = hostEl.ownerDocument;
  const card = doc.createElement('div');
  card.className = 'stl-card';
  card.hidden = true;
  card.innerHTML = `
    <div class="stl-head-row"><button type="button" class="stl-head"><span class="stl-title"></span><span class="stl-name"></span>${CARET_SVG}</button></div>
    <div class="stl-body">
      <div class="stl-row" data-row="stlUp"><button type="button" class="cut-field-label" data-hint="stlUp"></button><div class="cut-presets stl-ups" role="group"></div></div>
      <div class="stl-row" data-row="stlOrient"><button type="button" class="stl-orient" data-hint="stlOrient"></button></div>
      <div class="stl-row" data-row="stlUnits"><button type="button" class="cut-field-label" data-hint="stlUnits"></button><div class="cut-presets stl-units" role="group"></div></div>
      <div class="stl-row" data-row="stlSize"><button type="button" class="cut-field-label" data-hint="stlSize"></button><div class="stl-size"></div></div>
    </div>`;
  hostEl.prepend(card);
  const head = card.querySelector('.stl-head'), body = card.querySelector('.stl-body');
  card.querySelector('.stl-title').textContent = hintLabel('stlCard');
  bindHint({ el: head, id: 'stlCard', iconOnly: true }); // TASK 805: its hint is a tooltip at the cursor (hint.js)
  mountDisclosure({ host: card, head, body });
  const orientBtn = card.querySelector('.stl-orient');
  orientBtn.addEventListener('click', () => onOrient());
  const ups = card.querySelector('.stl-ups'), units = card.querySelector('.stl-units'), size = card.querySelector('.stl-size');
  for (const t of card.querySelectorAll('.stl-body [data-hint]')) {
    const row = t.closest('.stl-row');
    bindHint({ el: t });
    if (t === orientBtn) continue; // a button of its own, not a row label
    t.id = `stl-${t.dataset.hint}-label`;
    const group = row.querySelector('.cut-presets');
    if (group) group.setAttribute('aria-labelledby', t.id);
  }
  // ONE preset row per choice list: a button per choice, the current one active; a press on another one calls onChange
  const presets = (wrap, list, field, current) => {
    wrap.replaceChildren(...list.map((c) => {
      const b = doc.createElement('button');
      b.type = 'button'; b.className = 'cut-preset' + (c.id === current ? ' is-active' : ''); b.dataset.value = c.id; b.textContent = c.label;
      b.setAttribute('aria-pressed', String(c.id === current));
      b.addEventListener('click', () => { if (c.id !== current) onChange({ [field]: c.id }); });
      return b;
    }));
  };
  let off = () => {};
  const refresh = () => {
    if (!card.isConnected) { off(); return; } // a card whose page is gone (a closed window) stops following the source
    const s = getStlSource();
    card.hidden = !s;
    if (!s) return;
    card.querySelector('.stl-name').textContent = s.name;
    card.querySelector('.stl-name').title = s.name;
    presets(ups, STL_UP_SIDES.map((id) => ({ id, label: UP_LABEL(id) })), 'up', s.up);
    presets(units, STL_UNITS.map((u) => ({ id: u.id, label: u.label })), 'unit', s.unit);
    size.textContent = `${lengthText(s.sizeMm.x)} × ${lengthText(s.sizeMm.y)} × ${lengthText(s.sizeMm.z, { show: 'unit' })}`; // the one length formatter (an inch fraction carries its mark)
  };
  // the size follows the document unit and the display precision (the one length formatter), like the cut card's notes
  SettingsManager.subscribe((key) => { if (key === null || key === 'DOC_UNIT' || isPrecisionKey(key)) refresh(); });
  off = onStlSourceChange(refresh); // the card follows its source wherever it changes (an import, undo / redo, a document opened, a design replaced)
  refresh();
  return { refresh, el: card };
}
