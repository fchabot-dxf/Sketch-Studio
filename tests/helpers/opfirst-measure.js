// tests/helpers/opfirst-measure.js — TASK S1 (docs/OPERATIONS-MODEL.md section 3, test plan): THE measurements of the operation-first migration corpus
// (tests/fixtures/opfirst/), one function for the frozen baseline (taken on origin/main before S1) and for the corpus test after it, so both measure alike.
//   loadCase(c, state?)  -> a plain sketch state holding the case's geometry (no solve: the stored joints are the solved positions) with the case's display settings set
//   measure({ state, entries, ops, reliefItems, selections }) -> { a, b, c, d, dContent, e, eNoId, f } md5s:
//     a         the downloaded SVG (export-payload.js shaperSvgOf), its page as before TASK 879 (tests/helpers/page-879.js pageBefore879: the baseline's page held every joint)
//     b         the Export step's 2D preview copy (shaperPreviewOf) without its data-op attributes (an operation's id is not part of what is drawn), its page as before TASK 879
//     c         the Paths view: the bit-centre travel of every written element (export-payload.js bitCentrePaths over shaperPreviewOf's `written`)
//     d         the 3D Review's input: planReliefItems' `sig` list, in order
//     dContent  the same items' content (cut type, depth, footprints, cutter shape) as key-sorted JSON (a sig hashes the record's own key order)
//     e         the Operations list (op-list.js inspect() items: headings and rows, with each row's data-id)
//     eNoId     the same items without the rows' data-id (an operation's id: derived from its settings before S1, stored after)
//     f         the selection list (selection-list.js getSelections)
import crypto from 'node:crypto';
import SettingsManager from '#core/settings-manager.js';
import { shaperSvgOf, shaperPreviewOf, bitCentrePaths } from '../../apps/shaper/src/export-payload.js';
import { createOpList } from '../../apps/shaper/src/op-list.js';
import { pageBefore879 } from './page-879.js';

export const md5 = (s) => crypto.createHash('md5').update(typeof s === 'string' ? s : JSON.stringify(s)).digest('hex');

/** Key-sorted JSON (objects by key, arrays in order; functions dropped). */
export function canonical(v) {
  return JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) && !(x instanceof Map) ? Object.fromEntries(Object.keys(x).sort().map((q) => [q, x[q]])) : x instanceof Map ? [...x] : typeof x === 'function' ? undefined : x));
}

export function loadCase(c) {
  for (const [k, v] of Object.entries(c.settings || {})) SettingsManager.set(k, v, { persist: false });
  const g = c.geometry || {};
  return {
    joints: new Map((g.joints || []).map(([id, j]) => [id, { ...j }])),
    shapes: (g.shapes || []).map((s) => ({ ...s, joints: [...(s.joints || [])] })),
    constraints: (g.constraints || []).map((x) => ({ ...x })),
    sketches: (g.sketches || []).map((s) => ({ ...s })),
    activeSketchId: g.activeSketchId,
    groups: (g.groups || []).map((x) => ({ ...x })),
    profiles: JSON.parse(JSON.stringify(g.profiles || [])),
    parameters: JSON.parse(JSON.stringify(g.parameters || [])),
  };
}

export function opListItems(ops) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  try {
    const list = createOpList(host, { getOps: () => ops, onMove() {}, onPick() {} });
    list.refresh();
    return list.inspect().items;
  } finally { host.remove(); }
}

export function measure({ state, entries, ops, reliefItems, selections }) {
  const a = shaperSvgOf(state, entries);
  const p = shaperPreviewOf(state, entries);
  const items = opListItems(ops);
  return {
    a: md5(pageBefore879(a, state)),
    b: md5(pageBefore879(p.svg.replace(/ data-op="[^"]*"/g, ''), state)),
    c: md5(bitCentrePaths(state, p.written)),
    d: md5(reliefItems.map((i) => i.sig)),
    dContent: md5(canonical(reliefItems.map((i) => ({ cutType: i.cutType, cutDepth: i.cutDepth, footprints: i.footprints, shape: i.shape })))),
    e: md5(items),
    eNoId: md5(items.map(({ id, ...rest }) => rest)),
    f: md5(selections),
  };
}
