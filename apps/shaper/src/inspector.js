// Inspector: assign Shaper cut type (encoding color), set cut depth / tool
// diameter, and edit arbitrary attributes on the selected element.

import { store, subscribe, emit } from './store.js';
import { CUT_TYPES, SHAPER_FIELDS, classify, applyCutType, getShaperAttr, setShaperAttr } from './shaper.js';

const FIELD_HINTS = {
  cutDepth: 'e.g. 0.787 in or 6.35mm',
  cutOffset: 'e.g. 0.125 in',
  toolDia: 'e.g. 0.125in',
};

let root;

export function init(container) {
  root = container;
  subscribe(render);
}

function render(s) {
  root.innerHTML = '';
  const el = s.selected;
  if (!el) {
    root.innerHTML = '<div class="empty small">Select an element</div>';
    return;
  }
  root.append(headerSection(el), cutTypeSection(el), shaperSection(el), attrSection(el));
}

function section(title) {
  const s = document.createElement('section');
  s.className = 'insp-section';
  const h = document.createElement('h3');
  h.textContent = title;
  s.append(h);
  return s;
}

function headerSection(el) {
  const s = section('Element');
  const tag = document.createElement('div');
  tag.className = 'tag-pill';
  tag.textContent = `<${el.tagName}>`;
  s.append(tag, labeledInput('id', el.getAttribute('id') || '', (v) => {
    if (v) el.setAttribute('id', v); else el.removeAttribute('id');
    emit();
  }));
  return s;
}

function cutTypeSection(el) {
  const s = section('Cut type');
  const active = classify(el);
  const grid = document.createElement('div');
  grid.className = 'cut-grid';
  for (const t of CUT_TYPES) {
    const btn = document.createElement('button');
    btn.className = 'cut-btn' + (t.id === active ? ' active' : '');
    btn.title = t.desc;
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = t.fill === 'none' ? '#fff' : t.fill;
    sw.style.borderColor = t.stroke === 'none' ? '#999' : t.stroke;
    sw.style.borderWidth = t.stroke === 'none' ? '1px' : '3px';
    btn.append(sw, document.createTextNode(t.label));
    btn.addEventListener('click', () => {
      applyCutType(el, t.id);
      emit();
    });
    grid.append(btn);
  }
  s.append(grid);
  if (!active) {
    const note = document.createElement('p');
    note.className = 'note';
    note.textContent = 'No Shaper cut type detected from current colors.';
    s.append(note);
  }
  return s;
}

function shaperSection(el) {
  const s = section('Shaper attributes');
  for (const name of SHAPER_FIELDS) {
    s.append(labeledInput(name, getShaperAttr(el, name) || '', (v) => {
      setShaperAttr(el, name, v);
      emit();
    }, FIELD_HINTS[name] || ''));
  }
  return s;
}

function attrSection(el) {
  const s = section('Attributes');
  const list = document.createElement('div');
  list.className = 'attr-list';
  for (const a of [...el.attributes]) {
    if (a.name === 'xmlns' || a.name.startsWith('xmlns:')) continue;
    if (a.name.startsWith('shaper:')) continue; // edited via the Shaper section above
    list.append(labeledInput(a.name, a.value, (v) => {
      el.setAttribute(a.name, v);
      emit();
    }));
  }
  s.append(list);
  return s;
}

function labeledInput(label, value, onChange, placeholder = '') {
  const row = document.createElement('label');
  row.className = 'field';
  const span = document.createElement('span');
  span.className = 'field-label';
  span.textContent = label;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.placeholder = placeholder;
  input.addEventListener('change', () => onChange(input.value));
  row.append(span, input);
  return row;
}
