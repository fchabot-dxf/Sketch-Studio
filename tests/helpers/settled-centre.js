// tests/helpers/settled-centre.js — TASK 893: where to click an element that may still be moving. A toast slides in (0.3 s), the sidebar drawer
// slides open: a click aimed at a rect measured mid-slide misses on a loaded PC (a fixed sleep is a guess). settledCentre(cdp, selector, what)
// waits (cdp.waitFor, its deadline) until the element exists, is shown (a box, not visibility:hidden), lies inside the viewport, no animation or
// transition is running on it or on an ancestor, and its rect is the same across two animation frames; then resolves its centre { x, y }.
// `cdp` is the object launchBrowser returns.

export async function settledCentre(cdp, sel, what, timeoutMs = 20000) {
  const s = JSON.stringify(sel);
  await cdp.waitFor(`new Promise((done) => {
    const el = document.querySelector(${s});
    if (!el) return done(false);
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0) || getComputedStyle(el).visibility === 'hidden') return done(false);
    if (r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight) return done(false);
    if (document.getAnimations().some((a) => a.playState === 'running' && a.effect && a.effect.target && a.effect.target.contains(el))) return done(false);
    const box = () => { const b = el.getBoundingClientRect(); return [b.left, b.top, b.width, b.height].join(','); };
    const before = box();
    requestAnimationFrame(() => requestAnimationFrame(() => done(box() === before)));
  })`, `${what} (shown, inside the viewport, not moving)`, timeoutMs);
  return cdp.evalJs(`(() => { const r = document.querySelector(${s}).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
}
