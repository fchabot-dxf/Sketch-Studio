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
// DELETE (owner turn 2174): the bin calls onDelete(op) (the stage unassigns every region / path of the operation in ONE undo step).
import { mountDisclosure, CARET_SVG } from './disclosure.js'; // TASK 757: the fold (open on a wide screen, folded on a phone)
import { bindHint } from './hint.js';
const DRAG_START_PX = 4;    // a grip press (mouse / pen) that moves less than this is not a drag
export const HOLD_MS = 350; // a touch held this long without moving lifts the row
const SCROLL_SLOP_PX = 8;   // a touch that moves more than this before the hold is a scroll
const GRIP_SVG = '<svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true"><g fill="currentColor"><circle cx="3" cy="3" r="1.4"/><circle cx="7" cy="3" r="1.4"/><circle cx="3" cy="8" r="1.4"/><circle cx="7" cy="8" r="1.4"/><circle cx="3" cy="13" r="1.4"/><circle cx="7" cy="13" r="1.4"/></g></svg>';
const BIN = '\u{1F5D1}'; // the shared bin of the Parameters table's rows (packages/ui/parameter-table.js)

/**
 * createOpList(hostEl, { getOps, onMove, onPick, isPicked, onDelete }) -> { refresh(), inspect(), setOpen(open) }
 *   getOps()       the operations, in order (operations.js describeOperations)
 *   onMove(keys)   a reorder: the operation keys in their new order
 *   onPick(op)     a tap on an operation
 *   isPicked(op)   whether the operation's regions are the canvas selection (the row is marked)
 *   onDelete(op)   TASK 745: the operation's bin
 */
export function createOpList(hostEl, { getOps, onMove, onPick, isPicked = () => false, onDelete = () => {} }) {
  if (!hostEl) return { refresh() {}, inspect: () => null };
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
    if (e.target.closest && e.target.closest('.ops-del')) return; // the bin is a button of its own
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
    ops.forEach((op, i) => {
      const toolKey = op.tool ? op.tool.key : '';
      if (toolKey !== lastTool) {
        lastTool = toolKey;
        const h = doc.createElement('div'); h.className = 'ops-tool'; h.textContent = op.heading;
        out.push(h);
      }
      const row = doc.createElement('div'); row.className = 'ops-row'; row.dataset.key = op.key; row.dataset.id = op.id;
      if (isPicked(op)) row.classList.add('is-picked');
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
      const del = doc.createElement('button'); del.type = 'button'; del.className = 'ops-del'; del.textContent = BIN;
      del.title = `Delete operation ${i + 1}: unassign its ${op.regions}`; del.setAttribute('aria-label', del.title);
      del.addEventListener('click', () => onDelete(op));
      row.addEventListener('pointerdown', (e) => onDown(e, i, row));
      row.append(grip, pick, del);
      out.push(row);
    });
    body.replaceChildren(...out);
  }

  /** What the list shows: { open, items: [{ heading } | { id, text, sub, picked } | { empty }] } (tests). */
  const inspect = () => ({
    open: fold.open,
    items: [...body.children].map((el) => (el.classList.contains('ops-tool') ? { heading: el.textContent }
      : el.classList.contains('ops-row') ? { id: el.dataset.id, text: el.querySelector('.ops-name').textContent, sub: el.querySelector('.ops-sub').textContent, picked: el.classList.contains('is-picked') } : { empty: el.textContent })),
  });
  return { refresh, inspect, setOpen };
}
