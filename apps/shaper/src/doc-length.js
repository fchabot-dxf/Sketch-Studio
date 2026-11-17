// apps/shaper/src/doc-length.js — TASK 734: a length / an area of the Vcarve panel SHOWN in the DOCUMENT unit (base mm in, text out).
// Same deciders as the cut card: the unit comes from docUnit(), the decimals from lengthDecimals(auto) (the Length precision setting, else `auto`),
// and the text is typed back through #core/units.js parse. With the setting on Auto the trailing zeros are trimmed ("0.5 mm", as the panel always read);
// with a precision picked the text keeps exactly that many decimals.
import { docUnit, lengthDecimals } from '#core/settings-manager.js';
import { format as formatUnit, basePer } from '#core/units.js';

const AUTO_DECIMALS = { mm: 3, cm: 4, in: 4 };   // the usual decimals while the Length precision setting is Auto
const AUTO_AREA_DECIMALS = { mm: 0, cm: 2, in: 2 };

/** A length (base mm) as doc-unit text with its unit: "0.5 mm", "0.0156 in". */
export function lengthText(mm, unit = docUnit()) {
  const set = lengthDecimals(null);
  const body = formatUnit(mm, unit, { decimals: set ?? AUTO_DECIMALS[unit] ?? 3 });
  return `${set === null ? String(Number(body)) : body} ${unit}`;
}

/** An area (base mm²) as doc-unit² text: "1600 mm²", "2.48 in²". */
export function areaText(mm2, unit = docUnit()) {
  const f = basePer(unit);
  return `${(mm2 / (f * f)).toFixed(lengthDecimals(AUTO_AREA_DECIMALS[unit] ?? 0))} ${unit}²`;
}

/** A length (base mm) as a plain doc-unit NUMBER (6 dp: exact enough for a stepper to step from). */
export const lengthNumber = (mm, unit = docUnit()) => Number(formatUnit(mm, unit, { decimals: 6 }));
