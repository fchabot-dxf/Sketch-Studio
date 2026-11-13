// packages/ui/long-press.js — the ONE touch-and-hold detector (task 562). A single finger held LONG_PRESS_MS without moving more
// than LONG_PRESS_SLOP px is the touch twin of a right click. iOS Safari fires no `contextmenu` on a hold, Android Chrome does, so
// the app owns the hold itself (same result on both) and input-manager.js ignores the browser's touch `contextmenu`.
// Pure timing + distance: no DOM, no state. The caller decides what a hold DOES (onFire) and when to swallow the press's moves.
//   const lp = createLongPress({ onFire(x, y, downEvent) });
//   lp.start(e)      a finger went down (arms the timer)      lp.move(e) → true while the press is still a hold candidate
//   lp.cancel()      disarm (finger up, second finger, hold taken elsewhere)      lp.pending / lp.fired / lp.pointerId

export const LONG_PRESS_MS = 500;
export const LONG_PRESS_SLOP = 8; // px a finger may drift and still be "holding still"

export function createLongPress({ onFire, delay = LONG_PRESS_MS, slop = LONG_PRESS_SLOP } = {}) {
  let timer = null;
  const lp = { pending: false, fired: false, pointerId: null, x: 0, y: 0, downEvent: null };
  function disarm() { if (timer) { clearTimeout(timer); timer = null; } lp.pending = false; }
  lp.start = (e) => {
    disarm();
    lp.fired = false; lp.pointerId = e.pointerId; lp.x = e.clientX; lp.y = e.clientY; lp.downEvent = e; lp.pending = true;
    timer = setTimeout(() => { timer = null; lp.pending = false; lp.fired = true; onFire(lp.x, lp.y, lp.downEvent); }, delay);
  };
  // true = still a hold candidate (the finger has not left the slop circle): the caller keeps the press from becoming a drag / pan yet.
  lp.move = (e) => {
    if (!lp.pending || e.pointerId !== lp.pointerId) return false;
    if (Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > slop) { disarm(); return false; }
    return true;
  };
  lp.cancel = () => { disarm(); lp.fired = false; lp.pointerId = null; lp.downEvent = null; };
  return lp;
}
