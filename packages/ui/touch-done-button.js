// packages/ui/touch-done-button.js — the "Done" button of a Line chain drawn by touch (task 562). A phone has no Enter / Esc / right
// click, so while a chain is open and the last input was a finger, a thumb-sized button sits in the canvas's bottom-right corner (clear
// of the drawing area's centre) and ends the chain exactly like Enter does (finishLineChain: the committed segments stay, the rubber
// band is dropped). It is hidden for a mouse and disappears by itself the moment the chain ends, by whatever route (a frame loop
// runs only while the button is shown, so no caller has to announce the end).
//   createTouchDoneButton({ svg, isChainOpen: () => bool, onDone: () => void }) → { sync(touchInput), destroy() }
//   sync(touchInput): call after any pointer event; touchInput = the pointer that just acted was a finger.

const STYLE_ID = 'sk-touch-done-styles';
const CSS = `
.sk-touch-done { position: fixed; z-index: 9000; min-width: 96px; height: 52px; padding: 0 22px; border: 0; border-radius: 26px;
  background: var(--sk-selection, #3B82F6); color: #fff; font: 700 16px system-ui, sans-serif; cursor: pointer;
  box-shadow: 0 4px 14px rgba(0,0,0,0.3); -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
.sk-touch-done[hidden] { display: none; }
.sk-touch-done:active { transform: scale(0.96); }
`;
const MARGIN = 16;

export function createTouchDoneButton({ svg, isChainOpen, onDone }) {
  if (!document.getElementById(STYLE_ID)) { const s = document.createElement('style'); s.id = STYLE_ID; s.textContent = CSS; document.head.appendChild(s); }
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'sk-touch-done'; btn.hidden = true; btn.textContent = 'Done';
  btn.setAttribute('aria-label', 'Finish the line chain'); btn.title = 'Finish the line chain';
  document.body.appendChild(btn);

  let touchInput = false;
  let frame = null;
  function place() {
    const r = svg.getBoundingClientRect();
    btn.style.right = Math.max(MARGIN, window.innerWidth - r.right + MARGIN) + 'px';
    btn.style.bottom = Math.max(MARGIN, window.innerHeight - r.bottom + MARGIN) + 'px';
  }
  function refresh() {
    frame = null;
    const r = svg.getBoundingClientRect();
    const show = touchInput && r.width > 0 && r.height > 0 && !!isChainOpen();
    btn.hidden = !show;
    if (show) { place(); frame = requestAnimationFrame(refresh); }
  }
  btn.addEventListener('click', (e) => { e.preventDefault(); onDone(); refresh(); });
  return {
    sync(isTouch) { touchInput = !!isTouch; if (frame == null) refresh(); },
    destroy() { if (frame != null) cancelAnimationFrame(frame); btn.remove(); },
  };
}
