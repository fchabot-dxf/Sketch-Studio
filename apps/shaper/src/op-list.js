// apps/shaper/src/op-list.js — TASK 743: Prepare's OPERATIONS list (operations.js: a display grouping of the cut plan, the user's job plan; the exported SVG never changes).
// A pure view of the operations it is given (getOps(): planOperations, in order), grouped under tool headings ("Change to ¼″ end mill": one heading per run
// of operations with the same bit). Per row: a drag grip, the number, the operation (type · depth(s) in the doc unit, its regions and steps / tabs), and
// TASK 745 a delete bin. A tap on the operation selects its regions on the canvas (onPick(op)). The header folds the list (open by default on a wide screen,
// folded on a phone: the one layout rule below).
// REORDER (TASK 745, owner turns 2171-2173: no arrow buttons; "on phone it's hold and drag so no conflict with scroll"): onMove(keys) gets the whole new order.
//  * Mouse / pen: a drag on the GRIP starts at once (pointer capture on the grip).
//  * Touch: PRESS-AND-HOLD anywhere on the row (not the bin) for HOLD_MS, then drag: a touch that moves more than SCROLL_SLOP_PX before the hold is a normal
//    scroll of the list (native scrolling: nothing on the list has touch-action none); after the hold the row LIFTS (.ops-lifted, a light haptic through
//    navigator.vibrate where the browser has it) and follows the finger (the touchmoves are then cancelled so the list does not scroll); release drops it. A
//    hold released without a move reorders nothing, and it never also fires the row's tap (the click that follows is swallowed).
//  * Keyboard: the grip is focusable; ArrowUp / ArrowDown on it move the row (the grip keeps the focus).
// DELETE (owner turn 2174): the bin calls onDelete(op) (TASK S2: the stage deletes the operation, ONE undo step; its shapes stay in their other operations).
// TASK S2 (owner turns 2716-2719): a tap on a row SELECTS it (onPick: the stage selects its shapes; nothing opens); the SELECTED row (isSelected: the one tapped)
// alone shows its actions, inside the row beside its text: Edit (onEdit: opens the operation), Duplicate (onDuplicate: its copy, opened) and the X (onDelete); a
// double-click on a row opens it too. The rows of the operations the selected shapes are in are highlighted (isPicked: the selected row style); reveal() scrolls the
// first of them into view while the list is open (never opening anything). A row's text is one line each (its full words are its tooltip), so the actions
// appearing never change its height.
// TICKS (TASK 798, owner turns 2515-2537): every row has a checkbox (op.on: ticked = shown in Prepare, the 3D Review, Paths / 2D and in the exported SVG; unticked =
// left out, its settings kept: the row stays, dimmed, and its tap still opens its card). Each tool heading has one too: ticked when all its operations are,
// mixed (indeterminate) when some, empty when none; a tap ticks them all, or unticks them all when all were ticked. onTick(ids, on) gets the operation ids. The
// Stock's box is ticked and disabled (op.tickable false: the board is in every file, the guide each export is placed by).
// ONE tap of a box never starts a drag or picks the row (the box is its own control, like the bin).
import { mountDisclosure, CARET_SVG } from './disclosure.js'; // TASK 757: the fold (open on a wide screen, folded on a phone)
import { bindHint } from './hint.js';
const DRAG_START_PX = 4;    // a grip press (mouse / pen) that moves less than this is not a drag
export const HOLD_MS = 350; // a touch held this long without moving lifts the row
const SCROLL_SLOP_PX = 8;   // a touch that moves more than this before the hold is a scroll
const GRIP_SVG = '<svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true"><g fill="currentColor"><circle cx="3" cy="3" r="1.4"/><circle cx="7" cy="3" r="1.4"/><circle cx="3" cy="8" r="1.4"/><circle cx="7" cy="8" r="1.4"/><circle cx="3" cy="13" r="1.4"/><circle cx="7" cy="13" r="1.4"/></g></svg>';
const ACTIONS = [ // TASK S2: the selected row's actions, in this order (their label = aria-label and tooltip)
  { cls: 'ops-edit', glyph: '\u270E', words: (n) => `Edit operation ${n}`, call: 'onEdit' },
  { cls: 'ops-dup', glyph: '\u29C9', words: (n) => `Duplicate operation ${n}`, call: 'onDuplicate' },
  { cls: 'ops-del', glyph: '\u2715', words: (n) => `Delete operation ${n} (its shapes stay in their other operations)`, call: 'onDelete' },
];

/**
 * createOpList(hostEl, { getOps, onMove, onPick, isPicked, isSelected, isOpen, onEdit, onDuplicate, onDelete, onTick }) -> { refresh(), reveal(), inspect(), inspectActions(), inspectTicks(), setOpen(open) }
 *   getOps()       the operations, in order (operations.js describeOperations)
 *   onMove(keys)   a reorder: the operation keys in their new order
 *   onPick(op)     a tap on an operation (TASK S2: it selects it)
 *   isPicked(op)   TASK S2: whether one of its shapes is selected (the row is highlighted)
 *   isSelected(op) TASK S2: whether it is the selected row (its actions show)
 *   isOpen(op)     TASK S2: whether it is the operation open in the card
 *   onEdit(op) / onDuplicate(op) / onDelete(op)   TASK S2: the selected row's actions (TASK 745: the delete)
 *   onTick(ids, on) TASK 798: a row's or a heading's checkbox (the operation ids, ticked or not)
 */
export function createOpList(hostEl, { getOps, onMove, onPick, isPicked = () => false, isSelected = () => false, isOpen = () => false, onEdit = () => {}, onDuplicate = () => {}, onDelete = () => {}, onTick = () => {} }) {
  if (!hostEl) return { refresh() {}, reveal() {}, inspect: () => null, inspectActions: () => null, inspectTicks: () => null };
  const calls = { onEdit, onDuplicate, onDelete };
  const doc = hostEl.ownerDocument;
  const win = doc.defaultView;
  hostEl.classList.add('ops-panel');
  hostEl.innerHTML = '';
  const headerRow = doc.createElement('div');
  headerRow.className = 'ops-header';
  const head = doc.createElement('button');
  head.type = 'button'; head.className = 'ops-head';
  head.innerHTML = '<span class="ops-title">Operations</span><span class="ops-count"></span>' + CARET_SVG;
  headerRow.append(head);
  const body = doc.createElement('div');
  body.className = 'ops-body';
  hostEl.append(headerRow, body);
  bindHint({ el: head, id: 'operations', iconOnly: true }); // TASK 805: its hint is a tooltip at the cursor (hint.js)
  const fold = mountDisclosure({ host: hostEl, head, body }); // TASK 757: the fold, declared once (disclosure.js), reused by the Export step's 3D info
  const setOpen = (v) => fold.setOpen(v);

  let ops = [];
  const keys = () => ops.map((op) => op.key);
  const move = (from, to) => {
    if (to < 0 || to >= ops.length || to === from) return false;
    const k = keys();
    const [m] = k.splice(from, 1);
    k.splice(to, 0, m);
    onMove(k);
    return true;
  };

  // a drag: the row under the pointer is where it goes (above its middle: before it); the gap shows while dragging
  let drag = null;           // { from, y0, x0, pointerId, touch, lifted, moved, timer, row }
  let swallowClick = false;  // a lifted touch's release must not also tap the row
  const rowEls = () => [...body.querySelectorAll('.ops-row')];
  const dropIndex = (y) => {
    const rows = rowEls();
    let at = rows.length;
    for (let i = 0; i < rows.length; i++) { const r = rows[i].getBoundingClientRect(); if (y < r.top + r.height / 2) { at = i; break; } }
    return at; // the index the dragged row goes BEFORE (rows.length = at the end)
  };
  const showDrop = (at) => rowEls().forEach((r, i) => { r.classList.toggle('ops-drop-before', i === at && at !== drag.from && at !== drag.from + 1); r.classList.toggle('ops-drop-after', at === rowEls().length && i === at - 1 && at !== drag.from + 1); });
  const clearMarks = () => { for (const r of rowEls()) r.classList.remove('ops-dragging', 'ops-lifted', 'ops-drop-before', 'ops-drop-after'); };
  const endDrag = () => { if (drag && drag.timer) clearTimeout(drag.timer); drag = null; clearMarks(); };

  function onDown(e, i, row) {
    if (drag || (e.button != null && e.button !== 0)) return;
    if (e.target.closest && e.target.closest('.ops-act, .ops-tick')) return; // the actions (TASK S2) and (TASK 798) the checkbox are controls of their own
    const touch = e.pointerType === 'touch';
    if (!touch) {
      if (!(e.target.closest && e.target.closest('.ops-grip'))) return; // a mouse / pen drags by the grip only (a click on the row picks it)
      e.preventDefault();
      const grip = row.querySelector('.ops-grip');
      if (grip.setPointerCapture) grip.setPointerCapture(e.pointerId);
      drag = { from: i, y0: e.clientY, x0: e.clientX, pointerId: e.pointerId, touch: false, lifted: true, moved: false, row };
      return;
    }
    drag = { from: i, y0: e.clientY, x0: e.clientX, pointerId: e.pointerId, touch: true, lifted: false, moved: false, row, timer: null };
    drag.timer = setTimeout(() => {
      if (!drag || drag.pointerId !== e.pointerId) return;
      drag.lifted = true; drag.timer = null;
      row.classList.add('ops-lifted');
      if (win.navigator && typeof win.navigator.vibrate === 'function') win.navigator.vibrate(12); // a light haptic where the browser has one
    }, HOLD_MS);
  }
  function onMoveEv(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.lifted) { // a touch before the hold: moving is a scroll
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > SCROLL_SLOP_PX) endDrag();
      return;
    }
    if (!drag.moved && Math.abs(e.clientY - drag.y0) < DRAG_START_PX) return;
    drag.moved = true;
    drag.row.classList.add('ops-dragging');
    showDrop(dropIndex(e.clientY));
  }
  function onUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = drag;
    endDrag();
    if (d.touch && d.lifted) { swallowClick = true; setTimeout(() => { swallowClick = false; }, 600); }
    if (!d.lifted || !d.moved || e.type !== 'pointerup') return;
    const at = dropIndex(e.clientY);
    move(d.from, at > d.from ? at - 1 : at);
  }
  // after the hold the finger drags the row, not the list: its touchmoves are cancelled (non-passive), so the browser does not take the gesture for a scroll
  body.addEventListener('touchmove', (e) => { if (drag && drag.touch && drag.lifted && e.cancelable) e.preventDefault(); }, { passive: false });
  body.addEventListener('contextmenu', (e) => { if (drag && drag.touch) e.preventDefault(); }); // a held touch is a lift, not a menu
  hostEl.addEventListener('click', (e) => { if (swallowClick) { swallowClick = false; e.stopPropagation(); e.preventDefault(); } }, true);
  win.addEventListener('pointermove', onMoveEv);
  win.addEventListener('pointerup', onUp);
  win.addEventListener('pointercancel', onUp);

  const focusGrip = (key) => { const r = rowEls().find((el) => el.dataset.key === key); if (r) r.querySelector('.ops-grip').focus(); };

  // TASK 798: one checkbox (a native box in a 44 px touch target on a phone; title + aria-label = what a tap does)
  function tickBox(checked, mixed, disabled, title) {
    const wrap = doc.createElement('label'); wrap.className = 'ops-tick'; wrap.title = title;
    const input = doc.createElement('input'); input.type = 'checkbox';
    input.checked = checked; input.indeterminate = mixed; input.disabled = disabled;
    input.setAttribute('aria-label', title);
    wrap.append(input);
    return wrap;
  }

  function refresh() {
    endDrag();
    ops = getOps();
    head.querySelector('.ops-count').textContent = String(ops.length);
    const out = [];
    if (!ops.length) {
      const p = doc.createElement('p'); p.className = 'ops-empty';
      p.textContent = 'No operations yet: pick a region and give it a cut type.';
      out.push(p);
    }
    let lastTool;
    const toolKeyOf = (op) => (op.tool ? op.tool.key : '');
    ops.forEach((op, i) => {
      const toolKey = toolKeyOf(op);
      if (toolKey !== lastTool) {
        lastTool = toolKey;
        // TASK 798: the heading's checkbox ticks / unticks this run of operations (the ones with this bit, up to the next heading)
        let end = i; while (end + 1 < ops.length && toolKeyOf(ops[end + 1]) === toolKey) end++;
        const all = ops.slice(i, end + 1), run = all.filter((o) => o.tickable !== false);
        const nOn = run.filter((o) => o.on !== false).length;
        const allOn = all.filter((o) => o.on !== false).length; // TASK 825 (V8): the heading's box shows EVERY row under it (the Stock is always on: untick the Guides beside it and the heading is mixed, not empty); a tap still acts on the tickable ones
        const h = doc.createElement('div'); h.className = 'ops-tool';
        const box = tickBox(allOn === all.length, allOn > 0 && allOn < all.length, !run.length,
          !run.length ? 'Always exported' : nOn === run.length ? `Untick all ${run.length}: leave them out of the views and the file` : `Tick all ${run.length}: show and export them`);
        box.dataset.group = op.heading;
        box.querySelector('input').addEventListener('change', () => onTick(run.map((o) => o.id), nOn !== run.length));
        const label = doc.createElement('span'); label.className = 'ops-tool-text'; label.textContent = op.heading;
        h.append(box, label);
        out.push(h);
      }
      const row = doc.createElement('div'); row.className = 'ops-row'; row.dataset.key = op.key; row.dataset.id = op.id;
      if (isPicked(op)) row.classList.add('is-picked');
      if (isOpen(op)) row.classList.add('is-open'); // TASK S2: the operation open in the card
      if (op.on === false) row.classList.add('is-off'); // TASK 798: unticked (dimmed: left out of the views and the file)
      const grip = doc.createElement('span'); grip.className = 'ops-grip'; grip.tabIndex = 0; grip.setAttribute('role', 'button');
      grip.title = 'Drag to reorder (or Arrow Up / Down)'; grip.setAttribute('aria-label', `Reorder operation ${i + 1}: Arrow Up / Arrow Down`);
      grip.innerHTML = GRIP_SVG;
      grip.addEventListener('keydown', (e) => {
        const to = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : null;
        if (to === null) return;
        e.preventDefault();
        if (move(i, to)) focusGrip(op.key);
      });
      const pick = doc.createElement('button'); pick.type = 'button'; pick.className = 'ops-pick'; pick.title = `${i + 1}. ${op.label}`;
      const num = doc.createElement('span'); num.className = 'ops-num'; num.textContent = String(i + 1);
      const text = doc.createElement('span'); text.className = 'ops-text';
      const name = doc.createElement('span'); name.className = 'ops-name'; name.textContent = op.rowText;
      const sub = doc.createElement('span'); sub.className = 'ops-sub'; sub.textContent = [op.regions, op.detail].filter(Boolean).join(' · ');
      text.append(name, sub);
      pick.append(num, text);
      pick.addEventListener('click', () => onPick(op));
      pick.addEventListener('dblclick', () => onEdit(op)); // TASK S2: a double-click opens it too
      // TASK S2: the selected row alone shows its actions, beside its text
      const acts = isSelected(op) ? ACTIONS.map((a) => {
        const b = doc.createElement('button'); b.type = 'button'; b.className = `ops-act ${a.cls}`; b.textContent = a.glyph;
        b.title = a.words(i + 1); b.setAttribute('aria-label', b.title);
        b.addEventListener('click', () => calls[a.call](op));
        return b;
      }) : [];
      row.addEventListener('pointerdown', (e) => onDown(e, i, row));
      const tick = tickBox(op.on !== false, false, op.tickable === false,
        op.tickable === false ? 'The Stock is always exported: every file is placed by it' : op.on === false ? `Tick operation ${i + 1}: show and export it` : `Untick operation ${i + 1}: leave it out of the views and the file`);
      tick.querySelector('input').addEventListener('change', (e) => onTick([op.id], e.target.checked));
      row.append(grip, tick, pick, ...acts);
      out.push(row);
    });
    body.replaceChildren(...out);
  }

  /** TASK S2 (owner turn 2718): the first highlighted row in view, while the list is open (a folded list, e.g. the phone's closed sheet: nothing). */
  function reveal() {
    if (!fold.open) return;
    const row = body.querySelector('.ops-row.is-picked');
    if (!row) return;
    const r = row.getBoundingClientRect(), b = body.getBoundingClientRect();
    if (r.top < b.top || r.bottom > b.bottom) row.scrollIntoView({ block: 'nearest' });
  }
  /** What the list shows: { open, items: [{ heading } | { id, text, sub, picked } | { empty }] } (tests). */
  const inspect = () => ({
    open: fold.open,
    items: [...body.children].map((el) => (el.classList.contains('ops-tool') ? { heading: el.textContent }
      : el.classList.contains('ops-row') ? { id: el.dataset.id, text: el.querySelector('.ops-name').textContent, sub: el.querySelector('.ops-sub').textContent, picked: el.classList.contains('is-picked') } : { empty: el.textContent })),
  });
  /** TASK S2: each row's actions (the selected row's Edit, Duplicate, X): [{ id, actions: ['ops-edit', ...] }] (tests). */
  const inspectActions = () => [...body.querySelectorAll('.ops-row')].map((el) => ({ id: el.dataset.id, actions: [...el.querySelectorAll('.ops-act')].map((b) => b.classList[1]) }));
  /** TASK 798: the checkboxes: { rows: [{ id, on, disabled }], groups: [{ heading, state: 'all' | 'some' | 'none', disabled }] } (tests). */
  const inspectTicks = () => ({
    rows: [...body.querySelectorAll('.ops-row')].map((el) => { const b = el.querySelector('.ops-tick input'); return { id: el.dataset.id, on: b.checked, disabled: b.disabled, off: el.classList.contains('is-off') }; }),
    groups: [...body.querySelectorAll('.ops-tool')].map((el) => { const b = el.querySelector('.ops-tick input'); return { heading: el.textContent, state: b.indeterminate ? 'some' : b.checked ? 'all' : 'none', disabled: b.disabled }; }),
  });
  return { refresh, reveal, inspect, inspectActions, inspectTicks, setOpen };
}
