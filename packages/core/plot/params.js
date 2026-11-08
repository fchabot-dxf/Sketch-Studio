// #core/plot/params.js — the ONE validate helper for declared numeric fields (TASK 453).
// A field is declared ONCE as { key, type:'number', default, min?, max?, integer? } (the fills/outlines registries and the
// machine settings already carry this shape). Everything that accepts a value for such a field — the UI on commit, a
// pipeline consumer, a loaded document — runs it through coerceParam, so there is one rule for "what is kept".

/** The value kept for `raw` under `def`.
 *  - empty / null / non-numeric / non-finite  -> `fallback` (default: the declared default; a UI passes the PREVIOUS value,
 *    which means "reject and keep what was there"),
 *  - `integer` rounds, `min` / `max` clamp (a fallback is clamped too, so a bad previous value can't survive). */
export function coerceParam(def, raw, fallback = def.default) {
  let v = (raw === undefined || raw === null || raw === "" || typeof raw === "boolean") ? NaN : +raw;
  if (!Number.isFinite(v)) v = +fallback;
  if (!Number.isFinite(v)) v = +def.default;
  if (def.integer) v = Math.round(v);
  if (def.min !== undefined) v = Math.max(def.min, v);
  if (def.max !== undefined) v = Math.min(def.max, v);
  return v;
}

/** { key: kept value } for every declared param, read from `values` (missing -> default). */
export function resolveParams(defs, values) {
  const out = {};
  for (const d of defs) out[d.key] = coerceParam(d, values ? values[d.key] : undefined);
  return out;
}

/** A copy of `values` whose declared keys are coerced (undeclared keys pass through; a missing key stays missing). */
export function sanitizeParams(defs, values) {
  const out = { ...(values || {}) };
  for (const d of defs) if (d.key in out) out[d.key] = coerceParam(d, out[d.key]);
  return out;
}
