// apps/penplotter/src/paper-sizes.js — TASK 827: the paper standards of the Document dialog, DECLARED ONCE as data. Each standard is in its OWN unit (the numbers the
// standard is defined by: A4 is 210 × 297 mm, Letter is 8.5 × 11 in); the other unit is shown in parentheses. The paper keeps its own unit (state.docUnit): it is
// not tied to the shared Settings > Units. Portrait is the standard's own w <= h. Pure: no DOM, no state (settings.js and viewport.js use it).

export const MM_PER_IN = 25.4;
export const CUSTOM_ID = 'custom';

export const PAPER_SIZES = [
  { id: 'a6', label: 'A6', w: 105, h: 148, unit: 'mm' },
  { id: 'a5', label: 'A5', w: 148, h: 210, unit: 'mm' },
  { id: 'a4', label: 'A4', w: 210, h: 297, unit: 'mm' },
  { id: 'a3', label: 'A3', w: 297, h: 420, unit: 'mm' },
  { id: 'a2', label: 'A2', w: 420, h: 594, unit: 'mm' },
  { id: 'a1', label: 'A1', w: 594, h: 841, unit: 'mm' },
  { id: 'letter', label: 'Letter', w: 8.5, h: 11, unit: 'in' },
  { id: 'legal', label: 'Legal', w: 8.5, h: 14, unit: 'in' },
  { id: 'tabloid', label: 'Tabloid / Ledger', w: 11, h: 17, unit: 'in' },
  { id: 'archA', label: 'ARCH A', w: 9, h: 12, unit: 'in' },
  { id: 'archB', label: 'ARCH B', w: 12, h: 18, unit: 'in' },
  { id: 'archC', label: 'ARCH C', w: 18, h: 24, unit: 'in' },
];

/** Plain hints (shown in the one tooltip at the cursor) for the dialog's new rows. */
export const PAPER_HINTS = {
  paper: 'A standard paper size sets the Width, Height and Units to the standard\'s own numbers. Typing a Width or Height that is no standard shows Custom.',
  orientation: 'Portrait is the taller way, Landscape the wider way. Changing it swaps the Width and Height.',
};

/** The one formatter of a size pair: "210 × 297 mm" (the numbers as they are) or the converted "8.27 × 11.69 in" / "215.9 × 279.4 mm" (2 decimals in, 1 decimal mm). */
export function formatSize(w, h, unit, converted = false) {
  const dec = unit === 'in' ? 2 : 1;
  const f = (v) => (converted ? v.toFixed(dec) : String(Math.round(v * 1000) / 1000));
  return `${f(w)} × ${f(h)} ${unit}`;
}

const otherUnit = (unit) => (unit === 'mm' ? 'in' : 'mm');
const convert = (v, unit) => (unit === 'mm' ? v / MM_PER_IN : v * MM_PER_IN); // v in `unit` -> the other unit

/** A standard's own size with the conversion in parentheses: "A4 · 210 × 297 mm (8.27 × 11.69 in)". */
export function paperOptionLabel(p) {
  const o = otherUnit(p.unit);
  return `${p.label} · ${formatSize(p.w, p.h, p.unit)} (${formatSize(convert(p.w, p.unit), convert(p.h, p.unit), o, true)})`;
}

/** A standard's size in mm, 2 decimals (what state.doc holds): Letter is 215.9 × 279.4. */
export function paperMm(p) {
  const mm = (v) => Math.round((p.unit === 'in' ? v * MM_PER_IN : v) * 100) / 100;
  return { w: mm(p.w), h: mm(p.h) };
}

const TOL_MM = 0.05;
/** The standard whose size (either orientation) is the document's (mm), or null for a custom size. */
export function matchPaper(wMm, hMm) {
  for (const p of PAPER_SIZES) {
    const s = paperMm(p);
    if ((Math.abs(wMm - s.w) <= TOL_MM && Math.abs(hMm - s.h) <= TOL_MM) || (Math.abs(wMm - s.h) <= TOL_MM && Math.abs(hMm - s.w) <= TOL_MM)) return p;
  }
  return null;
}

/** 'landscape' when wider than tall, else 'portrait' (a square is portrait). */
export const orientationOf = (wMm, hMm) => (wMm > hMm ? 'landscape' : 'portrait');

/** The size (mm) of standard `p` in orientation 'portrait' | 'landscape'. */
export function paperSizeIn(p, orientation) {
  const s = paperMm(p);
  return orientation === 'landscape' ? { w: s.h, h: s.w } : { w: s.w, h: s.h };
}
