// packages/ui/done-button.js — the green check-mark "Done" button of an open Line chain / Mirror step (tasks 562, 585, 642). A phone has no
// Enter / Esc / right click, and a mouse user may not know them, so while the tool's chain is open a round green button with a white check
// icon sits beside the tool's anchor point (flipped near a canvas edge; the canvas's bottom-right corner when the tool has no end point) and ends
// the chain exactly like Enter does (finishLineChain: the committed segments stay, the rubber band is dropped). It is shown for every pointer
// type, thumb-sized (52 px) after a finger and 40 px after a mouse / pen, and disappears by itself the moment the chain ends, by whatever
// route (a frame loop runs only while the button is shown, so no caller has to announce the end). Colour: the --sk-done token (sketcher.css).
//   createDoneButton({ svg, isChainOpen: () => bool, onDone: () => void, label?: () => string, anchor?: () => {x, y} | null, avoid?: () => DOMRect[] }) → { sync(touchInput), destroy() }
//   label: the button's aria-label (no tooltip) while it shows (the Mirror tool's steps use the same button); default the line chain's.
//   anchor (tasks 642, 646, 650, 653): the point the button sits beside, in client px: the Line tool's lineChainAnchor (the last committed joint, or
//   the end once typed length AND angle lock it, never the live rubber band), the Fillet's corner, the Offset's anchor. The button never chases the
//   cursor, and (task 653) never sits on its anchor or within a finger's reach (MIN_GAP, 44 px, centre to anchor) of it; null / omitted = the
//   canvas corner (the Mirror tool has no rubber band). avoid: the tools' boxes' and handles' rects, which the button covers only when every slot is
//   covered (then the least-covered one, see placeDone).
//   sync(touchInput): call after any pointer event; touchInput = the pointer that just acted was a finger (picks the size).

const STYLE_ID = 'sk-done-styles';
const CSS = `
.sk-done { position: fixed; z-index: 9000; width: 40px; height: 40px; padding: 0; border: 0; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: var(--sk-done); color: #fff; cursor: pointer;
  box-shadow: 0 0 0 3px #1f2937, 0 4px 14px rgba(0,0,0,0.3); -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
.sk-done.sk-done-touch { width: 52px; height: 52px; }
.sk-done svg { width: 72%; height: 72%; fill: none; stroke: currentColor; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
.sk-done[hidden] { display: none; }
.sk-done:disabled { opacity: 0.4; cursor: not-allowed; }
.sk-done:not(:disabled):active { transform: scale(0.96); }
`;
const CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const MARGIN = 16;
const OFFSET = 16;   // gap from the end point to the button's near corner: clear of the end point and the cursor crosshair
const EDGE = 4;
const MIN_GAP = 44;   // task 653: the button's centre is never nearer than this to its anchor (a finger's reach), so the tap that opened a box cannot also press it

// The button's top-left corner (client px) for an anchor, a button size, the canvas rect and the rects to keep clear. One rule for every tool.
// 1. The four diagonal slots beside the anchor (below-right first, as Fusion), then slots 2 and 3 buttons further out in 8 directions: the first one
//    that stays inside the canvas and off every obstacle. 2. When none is free (a phone corner near the canvas edge with the box and the handle in the
//    way), the LEAST-COVERED slot that is inside the canvas and at least MIN_GAP from the anchor: a slot that is partly covered stays reachable and
//    never turns the button into a click on the anchor the finger just tapped. 3. A canvas too small for any slot 44 px out takes the slot farthest from the anchor.
export function placeDone({ anchor, size, bounds: r, obstacles = [] }) {
  const clamp = (x, y) => [Math.max(r.left + EDGE, Math.min(x, r.right - EDGE - size)), Math.max(r.top + EDGE, Math.min(y, r.bottom - EDGE - size))];
  const covered = (x, y) => obstacles.reduce((a, o) => a + Math.max(0, Math.min(x + size, o.right) - Math.max(x, o.left)) * Math.max(0, Math.min(y + size, o.bottom) - Math.max(y, o.top)), 0);
  const inside = (x, y) => x >= r.left + EDGE && y >= r.top + EDGE && x + size <= r.right - EDGE && y + size <= r.bottom - EDGE;
  const gap = (x, y) => Math.hypot(x + size / 2 - anchor.x, y + size / 2 - anchor.y);
  const slots = [];
  for (const ring of [0, 1, 2]) {
    const d = OFFSET + ring * (size + OFFSET);
    const near = anchor.x + d, far = anchor.x - d - size, below = anchor.y + d, above = anchor.y - d - size;
    slots.push([near, below], [near, above], [far, below], [far, above]);
    if (ring) {
      const mx = anchor.x - size / 2, my = anchor.y - size / 2;
      slots.push([near, my], [far, my], [mx, below], [mx, above]);
    }
  }
  const free = slots.find(([x, y]) => inside(x, y) && covered(x, y) === 0 && gap(x, y) >= MIN_GAP);
  if (free) return free;
  const usable = slots.map(([x, y]) => clamp(x, y)).filter(([x, y]) => gap(x, y) >= MIN_GAP);
  if (!usable.length) return slots.map(([x, y]) => clamp(x, y)).reduce((a, b) => (gap(...b) > gap(...a) ? b : a));
  return usable.reduce((a, b) => (covered(...b) < covered(...a) ? b : a));
}

export function createDoneButton({ svg, isChainOpen, onDone, enabled = () => true, label = () => 'Finish the line chain', anchor = () => null, avoid = () => [] }) {
  if (!document.getElementById(STYLE_ID)) { const s = document.createElement('style'); s.id = STYLE_ID; s.textContent = CSS; document.head.appendChild(s); }
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'sk-done'; btn.hidden = true; btn.innerHTML = CHECK_SVG;
  btn.setAttribute('aria-label', 'Finish the line chain');
  document.body.appendChild(btn);

  let touchInput = false;
  let frame = null;
  // beside the anchor (below-right, flipped near a canvas edge) when the tool has one, else the canvas's bottom-right corner
  function place() {
    const r = svg.getBoundingClientRect();
    const end = anchor();
    if (!end) {
      btn.style.left = btn.style.top = '';
      btn.style.right = Math.max(MARGIN, window.innerWidth - r.right + MARGIN) + 'px';
      btn.style.bottom = Math.max(MARGIN, window.innerHeight - r.bottom + MARGIN) + 'px';
      return;
    }
    const [x, y] = placeDone({ anchor: end, size: btn.offsetWidth, bounds: r, obstacles: avoid() });
    btn.style.right = btn.style.bottom = '';
    btn.style.left = x + 'px';
    btn.style.top = y + 'px';
  }
  function refresh() {
    frame = null;
    const r = svg.getBoundingClientRect();
    const show = r.width > 0 && r.height > 0 && !!isChainOpen();
    btn.hidden = !show;
    btn.disabled = show ? !enabled() : false;
    if (show) { btn.setAttribute('aria-label', label()); btn.classList.toggle('sk-done-touch', touchInput); place(); frame = requestAnimationFrame(refresh); }
  }
  btn.addEventListener('click', (e) => { e.preventDefault(); if (btn.disabled) return; onDone(); refresh(); });
  return {
    sync(isTouch) { touchInput = !!isTouch; if (frame == null) refresh(); },
    destroy() { if (frame != null) cancelAnimationFrame(frame); btn.remove(); },
  };
}
