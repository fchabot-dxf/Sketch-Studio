// packages/ui/cursor-tooltip.js — TASK 805: ONE tooltip at the cursor, for any element that names a hint. Delegated: ONE set of listeners on the document finds the
// hovered element with `selector` and asks `resolve(el)` for its text, so rows that are rebuilt (menus, preset buttons) need no wiring of their own.
//
// IT IS AN OVERLAY (the owner's gripe, turn 2612: "the layout would change randomly"): the box is `position: fixed`, `pointer-events: none`, above everything,
// appended to <body> (or to the open <dialog> the target is in: a dialog is the browser's top layer); it never takes room in any layout, so nothing moves or
// resizes while it shows.
//   desktop  a mouse resting on a target for HOVER_DELAY_MS shows it near the pointer (offset so it never sits under it, kept on screen); it stays where it was
//            shown (it follows nothing) and goes on leave / press / Esc / scroll / when the target is removed.
//   touch    a press held for LONG_PRESS_MS shows it above the finger (a finger that moves, scrolls or lifts early cancels); it stays until the next press,
//            Esc or a scroll; the click that ends the long press is swallowed (a long press on a menu row must not pick it).
//   keyboard focus (after a key was pressed) shows it beside the focused control (below it, or above when there is no room); the control gets
//            aria-describedby the box while it shows.
export const HOVER_DELAY_MS = 400;
export const LONG_PRESS_MS = 450;
export const TOUCH_SLOP_PX = 10;
const CURSOR_OFFSET = { x: 14, y: 20 }; // the box's top-left from the pointer: right of it and below it
const FINGER_GAP_PX = 28; // a touch box ends this far above the finger (the finger and the hand cover what is below it)
const EDGE_PX = 8;

/** Where a box of width x height goes: near (x, y) offset by `offset`, kept inside the viewport; flipped to the other side of the point when it does not fit.
 *  `flipX: false` (TASK 817c: the finger's box, already centred over the finger) never flips sideways: it is only kept on screen. */
export function placeTooltip({ x, y, width, height, vw, vh, offset = CURSOR_OFFSET, edge = EDGE_PX, flipX = true }) {
  let left = x + offset.x;
  if (flipX && left + width > vw - edge) left = x - offset.x - width; // no room on the right: to the left of the pointer
  left = Math.max(edge, Math.min(vw - width - edge, left));
  let top = y + offset.y;
  if (top + height > vh - edge) top = y - offset.y - height; // no room below: above the pointer
  top = Math.max(edge, Math.min(vh - height - edge, top));
  return { left, top };
}

const STYLE_ID = 'sk-cursor-tooltip-styles';
const CSS = `
.sk-cursor-tip { position: fixed; left: 0; top: 0; z-index: 2147483000; max-width: min(280px, calc(100vw - 16px)); padding: 6px 9px; border-radius: 7px;
  background: var(--sk-tooltip-bg, #1e293b); color: var(--sk-tooltip-fg, #f8fafc); border: 1px solid rgba(148,163,184,0.28);
  box-shadow: 0 6px 20px rgba(0,0,0,0.28); font: 12px/1.35 system-ui, -apple-system, 'Segoe UI', sans-serif; text-transform: none; font-weight: 400;
  pointer-events: none; box-sizing: border-box; overflow-wrap: anywhere; margin: 0; }
.sk-cursor-tip[hidden] { display: none; }
`;

/**
 * Install the tooltip on a document.
 * @param {{ doc?: Document, selector: string, resolve: (el: Element) => (string|null|undefined), hoverDelayMs?: number, longPressMs?: number }} opts
 *   `resolve` returns the text for the matched element at THIS moment (a hint that depends on the card's state is evaluated when it opens), or a falsy value for none.
 * @returns {{ hide(): void, isShown(): boolean, box: () => (HTMLElement|null), destroy(): void }}
 */
export function installCursorTooltip({ doc = globalThis.document, selector, resolve, hoverDelayMs = HOVER_DELAY_MS, longPressMs = LONG_PRESS_MS }) {
  const win = doc.defaultView || globalThis;
  if (!doc.getElementById(STYLE_ID)) {
    const s = doc.createElement('style');
    s.id = STYLE_ID; s.textContent = CSS;
    doc.head.appendChild(s);
  }
  let box = null, current = null, timer = null, shownFor = null, describedEl = null;
  let pointer = { x: 0, y: 0 };
  let touch = null; // { id, x, y, el } while a touch press is waiting for its long-press
  let keyboard = false;
  let swallowClick = false;

  const ensureBox = (target) => {
    if (!box) {
      box = doc.createElement('div');
      box.className = 'sk-cursor-tip';
      box.id = 'sk-cursor-tip';
      box.setAttribute('role', 'tooltip');
      box.hidden = true;
    }
    const host = (target && target.closest && target.closest('dialog[open]')) || doc.body;
    if (box.parentNode !== host) host.appendChild(box);
    return box;
  };
  const clearTimer = () => { if (timer !== null) { win.clearTimeout(timer); timer = null; } };
  const hide = () => {
    clearTimer();
    touch = null;
    if (describedEl) { describedEl.removeAttribute('aria-describedby'); describedEl = null; }
    if (box) box.hidden = true;
    shownFor = null;
  };
  const targetOf = (node) => (node && node.closest ? node.closest(selector) : null);
  const viewport = () => ({ vw: win.innerWidth || 1280, vh: win.innerHeight || 800 });

  /** Show `el`'s text; `at` = the point to place near ('cursor' | 'finger' | 'control'). Returns false when there is no text. */
  const show = (el, at) => {
    clearTimer();
    if (!el.isConnected) return false;
    const text = resolve(el);
    if (!text) return false;
    const b = ensureBox(el);
    b.textContent = text;
    b.hidden = false;
    b.style.left = '0px'; b.style.top = '0px'; // measured at the corner: its width is its own (max-width) whatever the previous place
    const br = b.getBoundingClientRect();
    const { vw, vh } = viewport();
    let spot;
    if (at === 'control') {
      const r = el.getBoundingClientRect();
      spot = placeTooltip({ x: r.left, y: r.bottom, width: br.width, height: br.height, vw, vh, offset: { x: 0, y: 6 } });
      if (spot.top < r.bottom && r.top - br.height - 6 >= EDGE_PX) spot.top = r.top - br.height - 6; // flipped by placeTooltip's clamp: keep it off the control
    } else if (at === 'finger') {
      // centred over the finger, then kept on screen (TASK 817c: a sideways flip put a box near the right edge wholly left of finger - width/2, far from the finger)
      spot = placeTooltip({ x: pointer.x - br.width / 2, y: pointer.y - FINGER_GAP_PX - br.height, width: br.width, height: br.height, vw, vh, offset: { x: 0, y: 0 }, flipX: false });
    } else {
      spot = placeTooltip({ x: pointer.x, y: pointer.y, width: br.width, height: br.height, vw, vh });
    }
    b.style.left = `${Math.round(spot.left)}px`; b.style.top = `${Math.round(spot.top)}px`;
    shownFor = el;
    if (at === 'control') { el.setAttribute('aria-describedby', b.id); describedEl = el; }
    return true;
  };

  const onMove = (e) => {
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      if (touch && Math.hypot(e.clientX - touch.x, e.clientY - touch.y) > TOUCH_SLOP_PX) { clearTimer(); touch = null; }
      return;
    }
    pointer = { x: e.clientX, y: e.clientY };
    if (shownFor && !shownFor.isConnected) hide(); // its target was rebuilt away (a menu re-rendered)
    const el = targetOf(e.target);
    if (el === current) return; // still on the same target: a shown tooltip stays where it is, a waiting one keeps its timer
    hide(); current = el;
    if (el) timer = win.setTimeout(() => { timer = null; if (current === el) show(el, 'cursor'); }, hoverDelayMs);
  };
  const onLeaveDoc = (e) => { if (e.pointerType && e.pointerType !== 'mouse') return; current = null; hide(); }; // a touch pointer "leaves" every ancestor on release: the tooltip stays
  const onDown = (e) => {
    keyboard = false;
    hide(); // a press dismisses it; `current` stays, so it does not come back until the pointer enters another target
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      pointer = { x: e.clientX, y: e.clientY };
      const el = targetOf(e.target);
      if (!el) return;
      touch = { id: e.pointerId, x: e.clientX, y: e.clientY, el };
      timer = win.setTimeout(() => { timer = null; if (touch && show(el, 'finger')) { swallowClick = true; touch = null; } }, longPressMs);
    }
  };
  const onUp = (e) => { if (e.pointerType === 'touch' || e.pointerType === 'pen') { clearTimer(); touch = null; } };
  const onCancel = () => { clearTimer(); touch = null; };
  const onClick = (e) => { if (swallowClick) { swallowClick = false; e.preventDefault(); e.stopPropagation(); } };
  const onContextMenu = (e) => { if (touch || shownFor) { if (targetOf(e.target)) e.preventDefault(); } };
  const onKey = (e) => { keyboard = true; if (e.key === 'Escape') hide(); };
  const onFocusIn = (e) => { if (!keyboard) return; hide(); const el = targetOf(e.target); if (el) show(el, 'control'); };
  const onFocusOut = () => hide();
  const onScroll = () => hide();
  const onBlur = () => { current = null; hide(); };

  const ev = [
    ['pointermove', onMove], ['pointerdown', onDown], ['pointerup', onUp], ['pointercancel', onCancel], ['click', onClick], ['contextmenu', onContextMenu],
    ['keydown', onKey], ['focusin', onFocusIn], ['focusout', onFocusOut], ['scroll', onScroll],
  ];
  for (const [name, fn] of ev) doc.addEventListener(name, fn, true);
  doc.documentElement.addEventListener('pointerleave', onLeaveDoc);
  win.addEventListener('blur', onBlur);

  return {
    hide: () => { current = null; hide(); },
    isShown: () => box !== null && !box.hidden,
    box: () => box,
    destroy() {
      hide();
      for (const [name, fn] of ev) doc.removeEventListener(name, fn, true);
      doc.documentElement.removeEventListener('pointerleave', onLeaveDoc);
      win.removeEventListener('blur', onBlur);
      if (box && box.parentNode) box.parentNode.removeChild(box);
      box = null;
    },
  };
}
