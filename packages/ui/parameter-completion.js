// packages/ui/parameter-completion.js — TASK 595: THE parameter-name completion for a text input that takes a parameter expression.
//   The content is #core/parameters.js completionsFor (pure); this is the one view + key handling over it, so every input that takes an
//   expression (the dimension box today; a Parameters-window expression field when slice 5 adds one) calls this and nothing else.
//   While the caret is on a word that prefixes parameter / dimension / function names, the list shows the matches (best first) with the top
//   one highlighted. Up / Down move the highlight; Tab inserts the highlighted name (the list is open only when something matches, so with no
//   match Tab is not used here); Enter inserts it only after Up / Down moved (a plain Enter still commits); Esc closes the list (a second Esc
//   is the input's own). After an insert the list stays closed until the next keystroke.
//   createParameterCompletion({ input, list, context, onInsert }) -> { update, close, isOpen, handleKey, pressRow }
//     input    the text input; list  the <ul> the rows are drawn in (the .dim-complete styles);
//     context  () => null | { state, unit, exclude }   what to complete against (null: nothing, the list closes);
//     onInsert called after an insert (the host refreshes its hint / placement); onChange called after the list opens, moves or closes.
import { completionsFor } from '#core/parameters.js';

export function createParameterCompletion({ input, list, context, onInsert = () => {}, onChange = () => {} }) {
  let open = null; // { from, to, prefix, items, index, moved } while the list is open

  function close() {
    open = null;
    list.replaceChildren();
    list.classList.add('hidden');
    input.removeAttribute('aria-activedescendant');
  }

  function render() {
    list.replaceChildren();
    open.items.forEach((it, i) => {
      const li = document.createElement('li');
      li.id = `${list.id}-${i}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', i === open.index ? 'true' : 'false');
      li.dataset.index = String(i);
      const name = document.createElement('span');
      name.className = 'dc-name';
      name.textContent = it.kind === 'function' ? it.detail : it.name;
      const val = document.createElement('span');
      val.className = 'dc-val';
      val.textContent = [it.value, it.unit].filter(Boolean).join(' ');
      li.append(name, val);
      list.appendChild(li);
    });
    input.setAttribute('aria-activedescendant', `${list.id}-${open.index}`);
    list.classList.remove('hidden');
  }

  // the list for the word under the caret (called after every edit); closes when nothing matches or there is nothing to complete against
  function update() {
    const ctx = context();
    const found = ctx ? completionsFor(ctx.state, input.value, input.selectionStart, { unit: ctx.unit, exclude: ctx.exclude }) : null;
    if (found) { open = { ...found, index: 0, moved: false }; render(); } else close();
    onChange();
  }

  function insert(i) {
    if (!open || !open.items[i]) return;
    const v = input.value;
    input.value = v.slice(0, open.from) + open.items[i].insert + v.slice(open.to);
    const caret = open.from + open.items[i].insert.length;
    input.setSelectionRange(caret, caret);
    input.focus();
    close(); // closed until the next keystroke, so Enter then commits
    onInsert();
  }

  // true when the key was used (the caller stops it there)
  function handleKey(e) {
    if (!open) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = open.items.length;
      open.index = e.key === 'ArrowDown' ? (open.index + 1) % n : (open.index + n - 1) % n;
      open.moved = true;
      render();
      onChange();
      return true;
    }
    if (e.key === 'Tab' || (e.key === 'Enter' && open.moved)) {
      e.preventDefault();
      insert(open.index);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      onChange();
      return true;
    }
    return false;
  }

  // a mouse press (or a touch tap) on a row inserts it; mousedown, not click, so the input keeps the focus
  function pressRow(e) {
    e.preventDefault();
    const li = e.target && typeof e.target.closest === 'function' ? e.target.closest('li') : null;
    if (li && open) insert(Number(li.dataset.index));
  }
  list.addEventListener('mousedown', pressRow);

  return { update, close, isOpen: () => !!open, handleKey, pressRow };
}
