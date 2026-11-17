// apps/shaper/src/op-list.js — TASK 743: Prepare's OPERATIONS list (operations.js: a display grouping of the cut plan, the user's job plan; the exported SVG never changes).
// A pure view of the operations it is given (getOps(): planOperations, in order), grouped under tool headings ("Change to ¼″ end mill": one heading per run
// of operations with the same bit). Per row: a drag grip, the number, the operation (type · depth(s) in the doc unit, its regions and steps / tabs), and
// ↑ / ↓ buttons. A drag on the grip (mouse, pen or a finger) or ↑ / ↓ reorders: onMove(keys) gets the whole new order. A tap on the operation selects its
// regions on the canvas (onPick(op)). The header folds the list (open by default on a wide screen, folded on a phone: the one layout rule below).
const PHONE_QUERY = '(max-width: 640px)';
const DRAG_START_PX = 4; // a grip press that moves less than this is not a drag
const arrow = (d) => `<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ARROW_UP = arrow('M7 12V2M3 6l4-4 4 4'), ARROW_DOWN = arrow('M7 2v10M3 8l4 4 4-4');

/**
 * createOpList(hostEl, { getOps, onMove, onPick, isPicked }) -> { refresh(), inspect() }
 *   getOps()       the operations, in order (planOperations)
 *   onMove(keys)   a reorder: the operation keys in their new order
 *   onPick(op)     a tap on an operation
 *   isPicked(op)   whether the operation's regions are the canvas selection (the row is marked)
 */
export function createOpList(hostEl, { getOps, onMove, onPick, isPicked = () => false }) {
  if (!hostEl) return { refresh() {}, inspect: () => null };
  const doc = hostEl.ownerDocument;
  const win = doc.defaultView;
  hostEl.classList.add('ops-panel');
  hostEl.innerHTML = '';
  const head = doc.createElement('button');
  head.type = 'button'; head.className = 'ops-head';
  head.innerHTML = '<span class="ops-title">Operations</span><span class="ops-count"></span><svg class="ops-caret" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 5l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const body = doc.createElement('div');
  body.className = 'ops-body';
  hostEl.append(head, body);
  let open = !(win.matchMedia && win.matchMedia(PHONE_QUERY).matches);
  const setOpen = (v) => { open = v; hostEl.dataset.open = String(open); head.setAttribute('aria-expanded', String(open)); body.hidden = !open; };
  setOpen(open);
  head.addEventListener('click', () => setOpen(!open));

  let ops = [];
  const keys = () => ops.map((op) => op.key);
  const move = (from, to) => {
    if (to < 0 || to >= ops.length || to === from) return;
    const k = keys();
    const [m] = k.splice(from, 1);
    k.splice(to, 0, m);
    onMove(k);
  };

  // drag on a grip: the row under the pointer is where it goes (above its middle: before it); the gap shows while dragging
  let drag = null;
  const rowEls = () => [...body.querySelectorAll('.ops-row')];
  const dropIndex = (y) => {
    const rows = rowEls();
    let at = rows.length;
    for (let i = 0; i < rows.length; i++) { const r = rows[i].getBoundingClientRect(); if (y < r.top + r.height / 2) { at = i; break; } }
    return at; // the index the dragged row goes BEFORE (rows.length = at the end)
  };
  const showDrop = (at) => rowEls().forEach((r, i) => { r.classList.toggle('ops-drop-before', i === at && at !== drag.from && at !== drag.from + 1); r.classList.toggle('ops-drop-after', at === rowEls().length && i === at - 1 && at !== drag.from + 1); });
  function onGripDown(e, i) {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture && e.currentTarget.setPointerCapture(e.pointerId);
    drag = { from: i, y0: e.clientY, moved: false, pointerId: e.pointerId };
  }
  function onGripMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.moved && Math.abs(e.clientY - drag.y0) < DRAG_START_PX) return;
    drag.moved = true;
    rowEls()[drag.from].classList.add('ops-dragging');
    showDrop(dropIndex(e.clientY));
  }
  function onGripUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = drag; drag = null;
    for (const r of rowEls()) r.classList.remove('ops-dragging', 'ops-drop-before', 'ops-drop-after');
    if (!d.moved || e.type !== 'pointerup') return;
    const at = dropIndex(e.clientY);
    move(d.from, at > d.from ? at - 1 : at);
  }

  function refresh() {
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
      const grip = doc.createElement('span'); grip.className = 'ops-grip'; grip.title = 'Drag to reorder'; grip.setAttribute('aria-hidden', 'true');
      grip.innerHTML = '<svg width="10" height="16" viewBox="0 0 10 16"><g fill="currentColor"><circle cx="3" cy="3" r="1.4"/><circle cx="7" cy="3" r="1.4"/><circle cx="3" cy="8" r="1.4"/><circle cx="7" cy="8" r="1.4"/><circle cx="3" cy="13" r="1.4"/><circle cx="7" cy="13" r="1.4"/></g></svg>';
      grip.addEventListener('pointerdown', (e) => onGripDown(e, i));
      grip.addEventListener('pointermove', onGripMove);
      grip.addEventListener('pointerup', onGripUp);
      grip.addEventListener('pointercancel', onGripUp);
      const pick = doc.createElement('button'); pick.type = 'button'; pick.className = 'ops-pick'; pick.title = `${i + 1}. ${op.label}`;
      const num = doc.createElement('span'); num.className = 'ops-num'; num.textContent = String(i + 1);
      const text = doc.createElement('span'); text.className = 'ops-text';
      const name = doc.createElement('span'); name.className = 'ops-name'; name.textContent = op.rowText;
      const sub = doc.createElement('span'); sub.className = 'ops-sub'; sub.textContent = [op.regions, op.detail].filter(Boolean).join(' · ');
      text.append(name, sub);
      pick.append(num, text);
      pick.addEventListener('click', () => onPick(op));
      const up = doc.createElement('button'); up.type = 'button'; up.className = 'ops-move ops-up'; up.innerHTML = ARROW_UP; up.title = 'Move up'; up.setAttribute('aria-label', 'Move up'); up.disabled = i === 0;
      const down = doc.createElement('button'); down.type = 'button'; down.className = 'ops-move ops-down'; down.innerHTML = ARROW_DOWN; down.title = 'Move down'; down.setAttribute('aria-label', 'Move down'); down.disabled = i === ops.length - 1;
      up.addEventListener('click', () => move(i, i - 1));
      down.addEventListener('click', () => move(i, i + 1));
      row.append(grip, pick, up, down);
      out.push(row);
    });
    body.replaceChildren(...out);
  }

  /** What the list shows: { open, headings, rows: [{ key, id, text, sub, picked }] } (tests). */
  const inspect = () => ({
    open,
    items: [...body.children].map((el) => (el.classList.contains('ops-tool') ? { heading: el.textContent }
      : el.classList.contains('ops-row') ? { id: el.dataset.id, text: el.querySelector('.ops-name').textContent, sub: el.querySelector('.ops-sub').textContent, picked: el.classList.contains('is-picked') } : { empty: el.textContent })),
  });
  return { refresh, inspect, setOpen };
}
