// packages/ui/ribbon-layout.js — TASK 647: the user's tool-ribbon layout (which tools are in the bar, and their order), per app and per section.
// ONE setting, RIBBON_LAYOUT (SettingsManager, local, per user): { v: 1, apps: { <appId>: { <section key>: { order: [tool id...], off: [tool id...] } } } }.
//   order: the section's tools in the user's order; off: the tools that are in the section's dropdown only (unchecked "in the bar").
// A section with no saved entry has its DECLARED defaults: the declared order, the first `defaultInBar` tools in the bar (all when not declared).
// The saved entry is read against the section's current declared ids: an id no longer declared is dropped, a newly declared id is appended in
// declared order (in the bar unless its declared position is past defaultInBar). Pure functions: tool-ribbon.js reads and writes the setting.

import SettingsManager from '#core/settings-manager.js';
import { dbg } from '#core/debug.js';

export const RIBBON_LAYOUT_KEY = 'RIBBON_LAYOUT';
export const RIBBON_LAYOUT_VERSION = 1;

/** The declared defaults of a section: { order, off } (off = a Set). */
export function defaultSection(ids, defaultInBar = ids.length) {
  return { order: [...ids], off: new Set(ids.slice(defaultInBar)) };
}

/** A saved section entry read against the declared ids (see the header). saved may be null / undefined (= the defaults). */
export function resolveSection(saved, ids, defaultInBar = ids.length) {
  if (!saved || !Array.isArray(saved.order)) return defaultSection(ids, defaultInBar);
  const known = new Set(ids);
  const order = saved.order.filter((id, i, a) => known.has(id) && a.indexOf(id) === i);
  const added = ids.filter((id) => !order.includes(id));
  order.push(...added);
  const off = new Set((Array.isArray(saved.off) ? saved.off : []).filter((id) => known.has(id)));
  added.forEach((id) => { if (ids.indexOf(id) >= defaultInBar) off.add(id); });
  return { order, off };
}

let warnedRaw;
/** The saved sections of one app ({ <section key>: entry }) inside a raw RIBBON_LAYOUT value; {} when there is none or the shape is unknown. */
export function appSections(raw, appId) {
  if (raw == null) return {};
  if (typeof raw !== 'object' || raw.v !== RIBBON_LAYOUT_VERSION || typeof raw.apps !== 'object' || raw.apps === null) {
    if (warnedRaw !== raw) { warnedRaw = raw; dbg.warn('ribbon-layout', '[ribbon-layout] RIBBON_LAYOUT has an unknown shape; the declared ribbon layout is used', raw); }
    return {};
  }
  const app = raw.apps[appId];
  return app && typeof app === 'object' ? app : {};
}

/** A NEW raw RIBBON_LAYOUT value with one section's entry replaced (entry null = removed: the section is back to its declared defaults). */
export function withSection(raw, appId, key, entry) {
  const apps = { ...((raw && raw.v === RIBBON_LAYOUT_VERSION && raw.apps) || {}) };
  const app = { ...(apps[appId] || {}) };
  if (entry) app[key] = { order: [...entry.order], off: [...entry.off] };
  else delete app[key];
  apps[appId] = app;
  return { v: RIBBON_LAYOUT_VERSION, apps };
}

/** The stored layout of one app's section, resolved against its declared ids. */
export function loadSection(appId, key, ids, defaultInBar) {
  return resolveSection(appSections(SettingsManager.get(RIBBON_LAYOUT_KEY), appId)[key], ids, defaultInBar);
}

/** Stores one app's section (entry null = back to the declared defaults). */
export function saveSection(appId, key, entry) {
  SettingsManager.set(RIBBON_LAYOUT_KEY, withSection(SettingsManager.get(RIBBON_LAYOUT_KEY), appId, key, entry));
}

/** TASK 773b: fn() whenever the stored layout may have changed (an edit here, a reset, or another device's layout arriving from Google Drive); returns the
 *  unsubscribe. tool-ribbon.js re-reads its sections then, so a layout synced from another device shows without a reload. */
export function onRibbonLayoutChange(fn) {
  return SettingsManager.subscribe((key) => { if (key === null || key === RIBBON_LAYOUT_KEY) fn(); });
}

/** Two resolved sections ({ order, off: Set }) are the same layout. */
export const sameSection = (a, b) => a.order.join('\n') === b.order.join('\n') && a.off.size === b.off.size && [...a.off].every((id) => b.off.has(id));
