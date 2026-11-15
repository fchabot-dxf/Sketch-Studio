// packages/ui/done-button.js — the green check-mark "Done" button of an open Line chain / Mirror step (tasks 562, 585, 642). A phone has no
// Enter / Esc / right click, and a mouse user may not know them, so while the tool's chain is open a round green button with a white check
// icon sits beside the chain's anchor point (flipped near a canvas edge; the canvas's bottom-right corner when the tool has no end point) and ends
// the chain exactly like Enter does (finishLineChain: the committed segments stay, the rubber band is dropped). It is shown for every pointer
// type, thumb-sized (52 px) after a finger and 40 px after a mouse / pen, and disappears by itself the moment the chain ends, by whatever
// route (a frame loop runs only while the button is shown, so no caller has to announce the end). Colour: the --sk-done token (sketcher.css).
//   createDoneButton({ svg, isChainOpen: () => bool, onDone: () => void, label?: () => string, anchor?: () => {x, y} | null, avoid?: () => DOMRect[] }) → { sync(touchInput), destroy() }
//   label: the button's aria-label (no tooltip) while it shows (the Mirror tool's steps use the same button); default the line chain's.
//   anchor (task 642): the line tool's lineChainAnchor in client px: the last committed joint, or the end once typed length AND angle lock it
//   (Fusion puts its check beside the chain; the button never chases the cursor); null / omitted = the
//   canvas corner (the Mirror tool has no rubber band). avoid: the numeric length / angle boxes' rects, which the button never covers.
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
.sk-done:active { transform: scale(0.96); }
`;
const CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const MARGIN = 16;
const OFFSET = 16;   // gap from the end point to the button's near corner: clear of the end point and the cursor crosshair
const EDGE = 4;

export function createDoneButton({ svg, isChainOpen, onDone, label = () => 'Finish the line chain', anchor = () => null, avoid = () => [] }) {
  if (!document.getElementById(STYLE_ID)) { const s = document.createElement('style'); s.id = STYLE_ID; s.textContent = CSS; document.head.appendChild(s); }
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'sk-done'; btn.hidden = true; btn.innerHTML = CHECK_SVG;
  btn.setAttribute('aria-label', 'Finish the line chain');
  document.body.appendChild(btn);

  let touchInput = false;
  let frame = null;
  // beside the live end point (below-right, flipped near a canvas edge) when the tool has one, else the canvas's bottom-right corner
  function place() {
    const r = svg.getBoundingClientRect();
    const end = anchor();
    if (!end) {
      btn.style.left = btn.style.top = '';
      btn.style.right = Math.max(MARGIN, window.innerWidth - r.right + MARGIN) + 'px';
      btn.style.bottom = Math.max(MARGIN, window.innerHeight - r.bottom + MARGIN) + 'px';
      return;
    }
    const size = btn.offsetWidth;
    const obstacles = avoid();
    const fits = (x, y) => x >= r.left + EDGE && y >= r.top + EDGE && x + size <= r.right - EDGE && y + size <= r.bottom - EDGE
      && !obstacles.some((o) => x < o.right && x + size > o.left && y < o.bottom && y + size > o.top);
    // below-right first (Fusion), then the other three sides of the end point, taking the first that stays in the canvas and off the boxes
    const near = end.x + OFFSET, far = end.x - OFFSET - size, below = end.y + OFFSET, above = end.y - OFFSET - size;
    const [x, y] = [[near, below], [near, above], [far, below], [far, above]].find(([cx, cy]) => fits(cx, cy)) || [near, below];
    btn.style.right = btn.style.bottom = '';
    btn.style.left = Math.max(r.left + EDGE, Math.min(x, r.right - EDGE - size)) + 'px';
    btn.style.top = Math.max(r.top + EDGE, Math.min(y, r.bottom - EDGE - size)) + 'px';
  }
  function refresh() {
    frame = null;
    const r = svg.getBoundingClientRect();
    const show = r.width > 0 && r.height > 0 && !!isChainOpen();
    btn.hidden = !show;
    if (show) { btn.setAttribute('aria-label', label()); btn.classList.toggle('sk-done-touch', touchInput); place(); frame = requestAnimationFrame(refresh); }
  }
  btn.addEventListener('click', (e) => { e.preventDefault(); onDone(); refresh(); });
  return {
    sync(isTouch) { touchInput = !!isTouch; if (frame == null) refresh(); },
    destroy() { if (frame != null) cancelAnimationFrame(frame); btn.remove(); },
  };
}
