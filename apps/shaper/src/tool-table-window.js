// apps/shaper/src/tool-table-window.js — TASK 842 (TASK 852: "My bits"): the MY BITS window (Shaper's modal style: the Sync dialog's card, header and buttons, desktop and phone).
// A view over tool-table.js: the list of the user's bits (its type's glyph, its name, its size in its own unit with the other unit in brackets), Add / Edit /
// Duplicate / Delete (TASK 852: Add bit first asks the bit TYPE, a template list with each type's glyph and one-line description, then shows that type's form), and the edit form with ONLY the fields of the bit's type (CUTTER_SHAPES[].fields), its unit switch (mm | in, per bit), its cutting length
// and notes. Every change is validated by the ONE validation (validateBit: its plain refusal lines under the form) and saved at once for all the user's designs
// (saveBits: the settings store). A length is parsed only when its field is changed (an untouched field keeps its exact stored value: no drift on a re-save).
// Opened from the cut card's Bit menu ("Edit my bits...") and from Prepare's ribbon (TASK S3).
import { CUTTER_SHAPES } from './shaper.js';
import { loadBits, saveBits, validateBit, normalizeBit, newBitId, duplicateBit, bitSummary, suggestBitName, bitNote, bitLengthText, parseBitLength, typeFields, BIT_UNITS } from './tool-table.js';
import { hintLabel, hintText } from './param-hints.js';
import { bindHint } from './hint.js';
import { docUnit } from '#core/settings-manager.js';

const glyph = (type) => `<svg class="cut-ic tt-glyph" viewBox="0 0 18 18" aria-hidden="true">${(CUTTER_SHAPES.find((s) => s.id === type) || {}).icon || ''}</svg>`;
// the form's rows: each a bit field, its table entry (param-hints.js) and its kind (a length in the bit's unit, an angle in degrees, text)
const FIELD_ROWS = [
  { field: 'diameter', hint: 'ttDiameter', kind: 'length' },
  { field: 'cornerRadius', hint: 'ttCornerRadius', kind: 'length' },
  { field: 'angle', hint: 'ttAngle', kind: 'angle' },
  { field: 'tipDiameter', hint: 'ttTipDiameter', kind: 'length' },
  { field: 'taperAngle', hint: 'ttTaperAngle', kind: 'angle' },
  { field: 'shankDiameter', hint: 'ttShankDiameter', kind: 'length' },
];

/**
 * createToolTableWindow({ doc, settings, onChange }) -> { open(), close(), isOpen(), dialog, bits() }
 *   settings: the settings store (default: the page's SettingsManager, through tool-table.js); onChange(bits): told after every saved change.
 */
export function createToolTableWindow({ doc = document, settings, onChange = () => {} } = {}) {
  const load = () => (settings ? loadBits(settings) : loadBits());
  const save = (bits) => (settings ? saveBits(bits, settings) : saveBits(bits));
  const dlg = doc.createElement('dialog');
  dlg.className = 'sync-modal tt-modal'; dlg.id = 'tool-table-modal'; dlg.setAttribute('aria-labelledby', 'tt-title');
  dlg.innerHTML = `
    <div class="sync-modal-card tt-card">
      <div class="sync-modal-header">
        <h3 class="sync-modal-title" id="tt-title" data-hint="toolTable"></h3>
        <button type="button" class="sync-modal-close tt-close" title="Close" aria-label="Close">✕</button>
      </div>
      <p class="sync-modal-desc tt-desc"></p>
      <div class="tt-list" role="list"></div>
      <div class="tt-list-actions"><button type="button" class="sync-btn-secondary tt-add" data-hint="ttAdd"></button></div>
      <div class="tt-templates" hidden>
        <span class="tt-label" data-hint="ttPickType"></span>
        <div class="tt-template-list" role="list"></div>
        <div class="sync-actions"><button type="button" class="sync-btn-secondary tt-template-cancel" data-hint="ttCancel"></button></div>
      </div>
      <form class="tt-form" hidden novalidate>
        <div class="sync-field tt-type-field"><span class="tt-label" data-hint="ttType"></span><div class="tt-types" role="radiogroup"></div></div>
        <div class="sync-field"><span class="tt-label" data-hint="ttUnit"></span><div class="tt-units" role="radiogroup"></div></div>
        <div class="tt-sizes"></div>
        <div class="tt-bit-note" role="note"></div>
        <div class="sync-field"><label for="tt-name" data-hint="ttName"></label><input id="tt-name" class="tt-name" type="text" maxlength="60" autocomplete="off"></div>
        <div class="sync-field"><label for="tt-cutlength" data-hint="ttCutLength"></label><div class="tt-num"><input id="tt-cutlength" class="tt-cutlength" type="text" inputmode="decimal" autocomplete="off"><span class="tt-unit"></span></div></div>
        <div class="sync-field"><label for="tt-notes" data-hint="ttNotes"></label><textarea id="tt-notes" class="tt-notes" rows="2"></textarea></div>
        <div class="sync-status is-error tt-refusals" role="alert"></div>
        <div class="sync-actions"><button type="button" class="sync-btn-secondary tt-cancel" data-hint="ttCancel"></button><button type="submit" class="sync-btn-primary tt-save" data-hint="ttSave"></button></div>
      </form>
    </div>`;
  doc.body.appendChild(dlg);
  const $ = (sel) => dlg.querySelector(sel);
  for (const el of dlg.querySelectorAll('[data-hint]')) bindHint({ el });
  $('.tt-desc').textContent = 'Your bits, for all your designs. Add bit starts from a type (a template for a kind of bit). An operation keeps its own copy of the bit it uses: changing or deleting a bit here does not change a design.';
  const listEl = $('.tt-list'), formEl = $('.tt-form'), nameIn = $('.tt-name'), typesEl = $('.tt-types'), unitsEl = $('.tt-units'), sizesEl = $('.tt-sizes'), cutIn = $('.tt-cutlength'), notesIn = $('.tt-notes'), refusalsEl = $('.tt-refusals'), templatesEl = $('.tt-templates'), templateList = $('.tt-template-list'), noteEl = $('.tt-bit-note'), typeField = $('.tt-type-field');
  let bits = load();
  let draft = null; // the bit being edited (lengths in base mm), or null (the list)
  let isNew = false;
  let nameAuto = false; // a new bit's name follows its sizes (suggestBitName) until the user types his own

  // ── the list ──
  function renderList() {
    listEl.replaceChildren(...bits.map((b) => {
      const row = doc.createElement('div'); row.className = 'tt-row'; row.setAttribute('role', 'listitem'); row.dataset.bit = b.id;
      row.innerHTML = `${glyph(b.type)}<span class="tt-text"><span class="tt-row-name"></span><span class="tt-row-size"></span></span>
        <button type="button" class="sync-link-btn tt-edit">Edit</button><button type="button" class="sync-link-btn tt-dup">Duplicate</button><button type="button" class="sync-link-btn tt-del" aria-label="Delete">Delete</button>`;
      row.querySelector('.tt-row-name').textContent = b.name;
      row.querySelector('.tt-row-size').textContent = `${hintLabel(`cutterShape:${b.type}`)} · ${bitSummary(b)}`;
      row.querySelector('.tt-edit').addEventListener('click', () => edit(b, false));
      row.querySelector('.tt-dup').addEventListener('click', () => { const copy = duplicateBit(b, bits); commit([...bits.slice(0, bits.indexOf(b) + 1), copy, ...bits.slice(bits.indexOf(b) + 1)]); });
      row.querySelector('.tt-del').addEventListener('click', () => commit(bits.filter((x) => x !== b)));
      return row;
    }));
    if (!bits.length) { const p = doc.createElement('div'); p.className = 'sync-browser-empty'; p.textContent = 'No bits yet: Add bit.'; listEl.appendChild(p); }
  }
  function commit(next) {
    bits = save(next);
    renderList();
    onChange(bits);
  }

  // ── the edit form: only the fields of the draft's type ──
  function renderTypes() {
    typesEl.replaceChildren(...CUTTER_SHAPES.map((t) => {
      const b = doc.createElement('button'); b.type = 'button'; b.className = 'tt-type' + (draft.type === t.id ? ' is-active' : ''); b.dataset.type = t.id;
      b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(draft.type === t.id));
      b.innerHTML = `${glyph(t.id)}<span></span>`; b.querySelector('span').textContent = hintLabel(`cutterShape:${t.id}`); b.dataset.hint = `cutterShape:${t.id}`; // its hint: the type's (the table's cutter shape entry)
      b.addEventListener('click', () => { draft = { ...draft, type: t.id }; renderForm(); });
      return b;
    }));
    unitsEl.replaceChildren(...BIT_UNITS.map((u) => {
      const b = doc.createElement('button'); b.type = 'button'; b.className = 'tt-unit-btn' + (draft.unit === u ? ' is-active' : ''); b.dataset.unit = u; b.textContent = u;
      b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(draft.unit === u));
      b.addEventListener('click', () => { draft = { ...draft, unit: u }; renderForm(); sizesChanged(); }); // re-labels the same stored sizes in the other unit (never resizes the bit)
      return b;
    }));
  }
  // a size or the unit changed: the suggested name (while the name is not the user's own) and the plain note under the sizes
  function sizesChanged() {
    if (nameAuto) { draft = { ...draft, name: suggestBitName(draft) }; nameIn.value = draft.name; }
    noteEl.textContent = bitNote(draft) || '';
    refusalsEl.textContent = ''; // a refusal was about the sizes as they were
  }
  function renderForm() {
    renderTypes();
    typeField.hidden = isNew; // a new bit's type was picked from the templates; an existing bit's type can still be changed here
    const fields = typeFields(draft.type);
    sizesEl.replaceChildren(...FIELD_ROWS.filter((r) => fields.includes(r.field)).map((r) => {
      const wrap = doc.createElement('div'); wrap.className = 'sync-field'; wrap.dataset.field = r.field;
      const id = `tt-${r.field}`;
      wrap.innerHTML = `<label for="${id}" data-hint="${r.hint}"></label><div class="tt-num"><input id="${id}" type="text" inputmode="decimal" autocomplete="off"><span class="tt-unit"></span></div>`;
      bindHint({ el: wrap.querySelector('label') });
      const input = wrap.querySelector('input');
      input.value = r.kind === 'length' ? bitLengthText(draft[r.field], draft.unit) : draft[r.field] == null ? '' : String(draft[r.field]);
      wrap.querySelector('.tt-unit').textContent = r.kind === 'length' ? draft.unit : '°';
      input.addEventListener('change', () => { // parsed only when changed: an untouched size keeps its exact stored value
        const t = input.value.trim();
        draft = { ...draft, [r.field]: t === '' ? null : r.kind === 'length' ? parseBitLength(t, draft.unit) ?? NaN : Number(t.replace('°', '').trim()) };
        sizesChanged();
      });
      return wrap;
    }));
    cutIn.value = draft.cutLength == null ? '' : bitLengthText(draft.cutLength, draft.unit);
    cutIn.parentElement.querySelector('.tt-unit').textContent = draft.unit;
    refusalsEl.textContent = '';
    noteEl.textContent = bitNote(draft) || '';
  }
  function edit(bit, fresh) {
    isNew = fresh;
    draft = { ...normalizeBit(bit) };
    nameIn.value = draft.name; notesIn.value = draft.notes || '';
    nameAuto = fresh; templatesEl.hidden = true;
    formEl.hidden = false; listEl.hidden = true; $('.tt-list-actions').hidden = true;
    renderForm();
    (fresh ? sizesEl.querySelector('input') || nameIn : nameIn).focus();
  }
  // Add bit: the TYPES (CUTTER_SHAPES) are the templates: each with its glyph, its name and its one-line description (the param-hints table)
  function showTemplates() {
    listEl.hidden = true; $('.tt-list-actions').hidden = true; formEl.hidden = true; templatesEl.hidden = false;
    templateList.replaceChildren(...CUTTER_SHAPES.map((t) => {
      const b = doc.createElement('button'); b.type = 'button'; b.className = 'tt-template'; b.dataset.type = t.id; b.setAttribute('role', 'listitem');
      b.innerHTML = `${glyph(t.id)}<span class="tt-text"><span class="tt-template-name"></span><span class="tt-template-desc"></span></span>`;
      b.querySelector('.tt-template-name').textContent = hintLabel(`cutterShape:${t.id}`);
      b.querySelector('.tt-template-desc').textContent = hintText(`cutterShape:${t.id}`);
      b.addEventListener('click', () => edit({ id: newBitId(bits), name: '', type: t.id, unit: docUnit() === 'in' ? 'in' : 'mm' }, true));
      return b;
    }));
  }
  function closeForm() {
    draft = null; formEl.hidden = true; templatesEl.hidden = true; listEl.hidden = false; $('.tt-list-actions').hidden = false;
    renderList();
  }
  nameIn.addEventListener('input', () => { nameAuto = false; if (draft) draft = { ...draft, name: nameIn.value }; });
  notesIn.addEventListener('input', () => { if (draft) draft = { ...draft, notes: notesIn.value }; });
  $('.tt-template-cancel').addEventListener('click', () => closeForm());
  cutIn.addEventListener('change', () => { const t = cutIn.value.trim(); draft = { ...draft, cutLength: t === '' ? null : parseBitLength(t, draft.unit) ?? NaN }; });
  formEl.addEventListener('submit', (e) => {
    e.preventDefault();
    const bit = normalizeBit({ ...draft, name: nameIn.value, notes: notesIn.value });
    const others = bits.filter((b) => b.id !== bit.id);
    const why = validateBit(bit, others);
    if (why.length) { refusalsEl.replaceChildren(...why.map((line) => { const d = doc.createElement('div'); d.textContent = line; return d; })); return; }
    commit(isNew ? [...bits, bit] : bits.map((b) => (b.id === bit.id ? bit : b)));
    closeForm();
  });
  $('.tt-cancel').addEventListener('click', () => closeForm());
  $('.tt-add').addEventListener('click', () => showTemplates());
  $('.tt-close').addEventListener('click', () => api.close());
  dlg.addEventListener('close', () => { if (draft) closeForm(); });

  const api = {
    dialog: dlg,
    open() { bits = load(); closeForm(); if (!dlg.open) dlg.showModal(); },
    close() { if (dlg.open) dlg.close(); },
    isOpen: () => dlg.open,
    bits: () => bits.slice(),
  };
  return api;
}
