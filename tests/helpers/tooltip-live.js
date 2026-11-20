// tests/helpers/tooltip-live.js — TASK 805: the cursor tooltip in a real page (apps/shaper/src/hint.js installHintTooltip, packages/ui/cursor-tooltip.js).
//   probe(t) -> { show(sel), leave(), tip(), snap(), movedBoxes(a, b) }
//     show(sel)  desktop: a real mouse move onto the element and the hover delay; phone: a real touch press held past the long-press (the finger stays down)
//     leave()    desktop: the mouse moves far away; phone: the finger lifts and a tap on empty canvas
//     tip()      null when no tooltip shows, else its text, box, computed position / pointer-events and the viewport
//     snap()     the bounding box (rounded to 0.01 px) of every card row, menu option, Operations row and Export card in the page: the layout
//     movedBoxes the entries of two snaps that differ (the owner's gripe: the layout must never move while a tooltip shows: expected [])
import { sleep } from './cdp-browser.js';

export const HOVER_WAIT_MS = 700; // the declared 400 ms hover delay and 450 ms long press, with room
const SNAP_SELECTORS = [
  '#prepare-panel', '#prepare-panel .cut-card', '#prepare-panel .cut-rows', '#prepare-panel .cut-row', '#prepare-panel .cut-field', '#prepare-panel .cut-field-label', '#prepare-panel .cut-box', '#prepare-panel .cut-note',
  '#prepare-panel .cut-pop:not([hidden])', '#prepare-panel .cut-pop:not([hidden]) .cut-type-opt', '#prepare-panel .cut-pop:not([hidden]) .cut-pop-grid > *',
  '#prepare-ops', '#prepare-ops .ops-head', '#prepare-ops .ops-body', '#prepare-ops .ops-row', '.stl-card', '.stl-row',
  '#review-side', '#review-side .review-stock', '#review-side label', '#review-side .simexport-title', '#review-side .simexport-btn', '#review-side .simexport-hub-btn', '#prepare-dir-legend',
];

export function probe(t) {
  const { phone, evalJs, send } = t;
  const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
  const centre = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect();
    const x = Math.round(r.left + Math.min(r.width / 2, 40)), y = Math.round(r.top + r.height / 2), hit = document.elementFromPoint(x, y); return { x, y, onTop: !!hit && (hit === e || e.contains(hit)), hit: hit ? hit.outerHTML.slice(0, 140) : null, r: [r.left, r.top, r.right, r.bottom].map(Math.round) }; })()`);
  let down = null;
  const api = {
    async reveal(sel) { await evalJs(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({ block: 'nearest' })`); await sleep(150); }, // the scroll (and its event, which hides a tooltip) is over before the pointer arrives
    async show(sel) {
      await api.reveal(sel);
      const p = await centre(sel);
      if (!p || !p.onTop) throw new Error(`${sel} is not on screen and uncovered: ${JSON.stringify(p)}`);
      if (phone) { await T('touchStart', [p]); down = p; }
      else { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x - 2, y: p.y - 2, button: 'none', buttons: 0 }); await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none', buttons: 0 }); }
      await sleep(HOVER_WAIT_MS);
      return p;
    },
    async release() { if (phone && down) { await T('touchEnd', []); down = null; await sleep(60); } }, // the finger lifts: a long-pressed tooltip stays (until the next tap / Esc)
    async tapAway() { await api.release(); await T('touchStart', [{ x: 386, y: 4 }]); await sleep(40); await T('touchEnd', []); await sleep(120); }, // phone: the next tap anywhere on empty canvas (TASK 819: not the left corner (4, 4): the drawer chevron is next to it)
    async leave() { // desktop: the mouse moves away; phone: the finger lifts and Esc (a tap would close an open menu)
      if (phone) { await api.release(); if (await api.tip()) { await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); } } // TASK S2: Esc only while a tooltip shows (an Esc with none would Cancel the open operation)
      else await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 3, y: 3, button: 'none', buttons: 0 });
      await sleep(120);
    },
    tip: () => evalJs(`(() => { const b = document.getElementById('sk-cursor-tip'); if (!b || b.hidden) return null; const r = b.getBoundingClientRect(), cs = getComputedStyle(b);
      return { text: b.textContent, left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height), position: cs.position, pointerEvents: cs.pointerEvents,
        parent: b.parentNode.tagName, vw: innerWidth, vh: innerHeight }; })()`),
    snap: () => evalJs(`(() => { const out = {}; const r2 = (n) => Math.round(n * 100) / 100;
      for (const sel of ${JSON.stringify(SNAP_SELECTORS)}) [...document.querySelectorAll(sel)].forEach((e, i) => { const b = e.getBoundingClientRect(), sc = e.parentElement && e.parentElement.closest('.cut-rows'); out[sel + '#' + i] = [r2(b.left), r2(b.top + (sc && (b.width || b.height) ? sc.scrollTop : 0)), r2(b.width), r2(b.height)].join(','); }); // TASK 813: a row's box is where it sits in the card's rows (the rows scroll on a short screen: scrolling is not a move)
      return out; })()`),
    movedBoxes(a, b) {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      return [...keys].filter((k) => a[k] !== b[k]).map((k) => `${k}: ${a[k]} -> ${b[k]}`);
    },
  };
  return api;
}

/** Checks a shown tooltip against the pointer / finger point it was asked at: text, near it, never under it, on screen, an overlay. */
export function tipProblems(tip, p, text, { phone = false } = {}) {
  const bad = [];
  if (!tip) return ['no tooltip shows'];
  if (tip.text !== text) bad.push(`text ${JSON.stringify(tip.text)} != ${JSON.stringify(text)}`);
  if (tip.position !== 'fixed' || tip.pointerEvents !== 'none') bad.push(`not a fixed pointer-events-none overlay: ${tip.position} / ${tip.pointerEvents}`);
  if (tip.left < 0 || tip.top < 0 || tip.right > tip.vw || tip.bottom > tip.vh) bad.push(`off screen: ${JSON.stringify(tip)}`);
  if (p.x >= tip.left && p.x <= tip.right && p.y >= tip.top && p.y <= tip.bottom) bad.push(`under the pointer ${p.x},${p.y}: ${JSON.stringify(tip)}`);
  const dx = Math.max(tip.left - p.x, 0, p.x - tip.right), dy = Math.max(tip.top - p.y, 0, p.y - tip.bottom);
  if (Math.hypot(dx, dy) > (phone ? 90 : 60)) bad.push(`not near the ${phone ? 'finger' : 'pointer'} ${p.x},${p.y}: ${JSON.stringify(tip)}`);
  return bad;
}
