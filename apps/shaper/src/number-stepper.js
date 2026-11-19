// apps/shaper/src/number-stepper.js — the ONE − / + stepper of Shaper's numeric fields (TASK 730; generalised from the cut card's depth stepper).
// A host DECLARES per field a spec { step: { mm, in }, min, max } and the field's own read / commit; this file holds the only press / hold / snap code.
//   positive  (instead of min) no app minimum, only > 0: the − stops at the smallest positive multiple of the step (TASK 734); with a min (TASK 787) the min applies
//   step  the increment in the DOCUMENT unit, per unit family (cm steps as mm / 10); min / max in BASE mm (omit = unbounded)
//   a step lands on the next clean MULTIPLE of the step in the direction pressed (6.3 + 0.5 -> 6.5, 6.3 - 0.5 -> 6.0); a value already on a multiple moves by one step
//   from an unset field (read() === null) the first press lands on one step; a value at its min / max stays (nothing is committed, so no undo step)
//   press-and-hold: after HOLD_DELAY_MS the step repeats every HOLD_REPEAT_MS; each applied step is one commit (the host's own undo step)
// Typing is untouched: the buttons only call commit(docUnitNumber) with an exact computed value; an untouched field never writes back.
export const HOLD_DELAY_MS = 400;
export const HOLD_REPEAT_MS = 80;
const EPS = 1e-6;

/** The step of a spec in the document unit ('mm' | 'in' | 'cm' ...): the declared family value, a metric unit other than mm scales the mm step. */
export const stepIn = (spec, unit) => (unit === 'in' ? spec.step.in : unit === 'cm' ? spec.step.mm / 10 : spec.step.mm);

/** The value one press in direction `dir` (+1 / -1) gives: cur and the result in the document unit; null cur = unset. */
export function nextValue(cur, dir, step, min = -Infinity, max = Infinity) {
  let n;
  if (cur == null) n = step;
  else {
    const q = cur / step, r = Math.round(q);
    n = (Math.abs(q - r) < EPS ? r + dir : (dir > 0 ? Math.ceil(q) : Math.floor(q))) * step;
  }
  return Math.min(max, Math.max(min, +n.toFixed(6)));
}

/** attachStepper(input, spec, { unit, toDoc, read, commit }, { label, box, before }) -> { refresh, destroy }
 *  unit(): the document unit; toDoc(baseMm): base mm -> the document unit number; read(): the field's exact value in the document unit (null = unset);
 *  commit(docNumber): store it (the host converts to base mm). label: the buttons' accessible name ("depth" -> "Decrease depth"). The − button goes before `before` (default the input) in `box` (default the input's parent), the + at the box's end.
 *  refresh(): re-sync the buttons' disabled state with the input's; destroy(): remove the buttons. */
export function attachStepper(input, spec, { unit, toDoc, read, commit }, { label, box = input.parentNode, before = input } = {}) {
  const make = (d, label, text) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'cut-step'; b.dataset.d = String(d); b.setAttribute('aria-label', label); b.textContent = text;
    return b;
  };
  const minus = make(-1, 'Decrease ' + label, '−'), plus = make(1, 'Increase ' + label, '+');
  box.insertBefore(minus, before); box.appendChild(plus);

  const stepOnce = (dir) => {
    if (input.disabled) return;
    const cur = read();
    const step = stepIn(spec, unit());
    const rawMin = typeof spec.min === 'function' ? spec.min() : spec.min;
    // spec.positive with no min: the value only stays > 0: the smallest allowed value is the smallest positive multiple of the step, and a − at or below it stays.
    // TASK 787: a declared min (the Lead-in Radius: the bit radius) wins: the − clamps to it (it stopped at one step above it)
    if (spec.positive && rawMin == null && cur != null && dir < 0 && cur <= step + EPS) return;
    const rawMax = typeof spec.max === 'function' ? spec.max() : spec.max;
    const next = nextValue(cur, dir, step, rawMin != null ? toDoc(rawMin) : spec.positive ? step : -Infinity, rawMax == null ? Infinity : toDoc(rawMax));
    if (cur == null || Math.abs(next - cur) > EPS) commit(next);
  };

  let delay = null, repeat = null, swallowClick = false;
  const stop = () => { clearTimeout(delay); clearInterval(repeat); delay = repeat = null; };
  for (const b of [minus, plus]) {
    const dir = Number(b.dataset.d);
    b.addEventListener('pointerdown', (e) => {
      if (e.button != null && e.button !== 0) return;
      swallowClick = true; stepOnce(dir); stop();
      delay = setTimeout(() => { repeat = setInterval(() => stepOnce(dir), HOLD_REPEAT_MS); }, HOLD_DELAY_MS);
      for (const t of ['pointerup', 'pointercancel']) document.addEventListener(t, stop, { once: true });
    });
    b.addEventListener('keydown', () => { swallowClick = false; });   // Enter / Space: the click that follows is the press
    b.addEventListener('click', () => { if (swallowClick) { swallowClick = false; return; } stepOnce(dir); }); // a pointer press already stepped on pointerdown
    b.addEventListener('contextmenu', (e) => e.preventDefault());       // a touch long-press is a hold, not a menu
  }
  return { refresh() { minus.disabled = plus.disabled = input.disabled; }, destroy() { stop(); box.removeChild(minus); box.removeChild(plus); } };
}
