// tests/helpers/opfirst-corpus.js — TASK S1: THE migration corpus run (docs/OPERATIONS-MODEL.md section 3), split in parts so each test file stays within the gate's
// per-file time (tests/opfirst-corpus-<n>-node.test.js: part n of the cases, every parts-th one).
// The operation-first MIGRATION CORPUS (TASK S1, docs/OPERATIONS-MODEL.md section 3, test plan). Every case of
// tests/fixtures/opfirst/ (a version 2 Shaper sidecar + its geometry, frozen from origin/main c5d4bb1 before S1: the node tests' designs with a plan, the named
// fixtures, the generated matrix) is loaded through applyShaperDoc (the one read of a stored document: the v2 -> v3 migration) and measured with the SAME
// measurements as its baseline (tests/helpers/opfirst-measure.js):
//   (a) the download, (b) the 2D preview minus data-op, (c) the Paths view, (dContent) the 3D Review's items, (eNoId) the Operations list rows, (f) the selection list
//   are EQUAL to the baseline for every case. Not asserted (advisor settlement, task S1): (d) the items' sig (it hashes a record's key ORDER: a record rebuilt from
//   its operation has the same fields in another order) and (e) the rows WITH their data-id (an operation's id was derived from its settings, it is stored now:
//   op-1 ... op-n).
//   EXPECTED (e)/(eNoId) DIFFERENCES, by name (advisor ruling 1, task S1): a design whose Guides hold different Depth / Offset / Bit lists one Guide operation per
//   value set (a Guide declares those settings now: they are written to the file per element); its file (a, b, c) stays the same.
// Then, per case: the migration report has 0 splits; the version 3 document saved, reloaded = the same version 3 JSON and the same measurements; an undo snapshot
// taken right after loading gives the same document back (Undo right after loading is a no-op); the version guard of task 812 keeps an app of version 2 (or 3) from
// writing over a version 3 sidecar.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import './node-app.js';
import { loadCase, measure, md5 } from './opfirst-measure.js';
import { shaperSvgOf } from '../../apps/shaper/src/export-payload.js';
import { pageBefore879 } from './page-879.js';
import { planEntries, planReliefItems } from '../../apps/shaper/src/cut-plan.js';
import { describeOperations } from '../../apps/shaper/src/operations.js';
import { applyShaperDoc, captureShaperDoc, capturePrepare, applyPrepare, DOC_VERSION } from '../../apps/shaper/src/shaper-doc.js';
import { getSelections } from '../../apps/shaper/src/selection-list.js';
import { createDocumentBuffer } from '#ui/document-buffer.js';
import { createProfile, createNamedDesign } from './node-app.js';
import { serializeDocument } from '#core/document.js';

const DIR = new URL('../fixtures/opfirst/', import.meta.url);
const cases = JSON.parse(fs.readFileSync(new URL('cases.json', DIR), 'utf8'));
const pool = JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL('pool.json.gz', DIR))));
const baseline = JSON.parse(fs.readFileSync(new URL('baseline.json', DIR), 'utf8')).cases;
const expand = (c) => {
  const sidecar = JSON.parse(JSON.stringify(c.sidecar));
  for (const e of sidecar.cutPlan || []) if (e && e[1] && e[1].levels && e[1].levels.$levels) e[1].levels = pool.levels[e[1].levels.$levels];
  if (sidecar.stl && sidecar.stl.$stl) sidecar.stl = pool.stl[sidecar.stl.$stl];
  return { geometry: pool.geometry[c.geometry], sidecar, settings: c.settings };
};
// advisor ruling 1: the cases whose Guides hold different Depth / Offset / Bit (one Guide operation per value set now)
const GUIDE_ROWS = new Set(['matrix__guide-mixed-params']);
// TASK S2: every operation is listed (an operation is opened from its row): the cases with a Roughing that cuts nothing (refused: no Stock / no boundary shape) list
// that row too, "1 shape: nothing to cut" (before S2 it was not listed); their files, previews, Paths and 3D are unchanged
const CUT_NOTHING_ROWS = new Set(['boundary-810-node__0045__7c1e6253', 'boundary-810-node__0049__85e437cf', 'boundary-810-node__0050__6ae4dfb1', 'boundary-810-node__0058__f88413f7']);
// TASK 825 (V4): a Guide's row shows the depth that makes it its own operation (a Guide with no depth keeps "Guide"): the cases with such a Guide list it so now
// (their files, previews, Paths and 3D are unchanged)
const GUIDE_DEPTH_WORDS = new Set([
  'boundary-810-node__0038__be74bb42', 'boundary-810-node__0041__f1b10001', 'boundary-810-node__0044__e6dcd7c9',
  'boundary-810-node__0047__cfa8c730', 'export-own-hole-711-node__0004__d039839a', 'leadin-775-node__0088__9c799ee7',
  'boundary-810-node__0039__104b1105', 'boundary-810-node__0042__52c8659d', 'boundary-810-node__0048__61469c1f',
  'boundary-810-node__0051__18b249f0', 'boundary-810-node__0037__4dd1cefa', 'boundary-810-node__0040__6a83caf4',
  'boundary-810-node__0043__6cce202e', 'boundary-810-node__0046__099653c8', 'leadin-775-node__0012__2fe3fbe6',
  'leadin-775-node__0018__6738e5e1', 'leadin-775-node__0084__4fa2df27', 'leadin-775-node__0096__f564d9ec',
]);
// TASK 822: tabs are kept off the stretches where a gap strip does not fit (#core/hold-part tabLayout `fit`) instead of refusing the whole hold: the cases whose
// Outside tabs were REFUSED ('strip': a tab of the even spread landed where its strip did not fit) and are now PLACED (the drawing tests/fixtures/report/
// midpoint-move.json, its 3077.8 mm outline: 21 tabs). Their file, preview, Paths, 3D and Operations row change on purpose; every other case is unchanged
export const TABS_PLACED_822 = new Set(['bezier-loops-761-node__0028__64ea064e', 'leadin-775-node__0071__64ea064e']);
// TASK 836 (owner ruling 2026-11-20: lead-ins removed from the app): REBASED BY NAME: the 42 cases whose stored sidecar holds an On line record with a lead-in on
// (exactly those: checked below). Their lead-in fields are dropped on load (apps/shaper/src/shaper-doc.js dropLeadIn), so the On line outline is cut as the plain
// closed loop: their download, preview, Paths view, 3D items and Operations row change on purpose (3 of them, whose lead-in was refused and so already cut closed:
// only their 3D items' lead-in data and their Operations row's "refused" words); the selection list (f) is unchanged. Every other case stays byte-identical.
export const LEAD_IN_REMOVED_836 = new Set([
  'cam-paths-787-node__0012__4cee22ef', 'cam-paths-787-node__0013__901ccb52', 'cam-paths-787-node__0014__88ba5db9', 'cam-paths-787-node__0015__e0016b8e',
  'cam-paths-787-node__0016__3e27a71b', 'cam-paths-787-node__0017__fe991460', 'cam-paths-787-node__0018__951f046e', 'leadin-775-node__0173__826b35f3',
  'leadin-775-node__0174__123b3f43', 'leadin-775-node__0175__071f7735', 'leadin-775-node__0176__ea330ef5', 'leadin-775-node__0177__bc97e118',
  'leadin-775-node__0178__af0bd3af', 'leadin-775-node__0179__87e5ec12', 'leadin-775-node__0180__8110408c', 'leadin-775-node__0181__ed5cb347',
  'leadin-775-node__0182__1b5d1c48', 'leadin-775-node__0183__4e89eda0', 'leadin-775-node__0184__6ae17093', 'leadin-775-node__0185__2cc6bdd6',
  'leadin-775-node__0186__47756612', 'leadin-775-node__0187__de97a007', 'leadin-775-node__0188__31f22120', 'leadin-775-node__0189__5a007c19',
  'leadin-775-node__0190__f1f21724', 'leadin-775-node__0191__c32af6bb', 'leadin-775-node__0192__7e2d8dd7', 'leadin-775-node__0194__b28b7a68',
  'leadin-arc-778-node__0004__46e895be', 'leadin-arc-778-node__0005__ba754e06', 'leadin-arc-778-node__0006__53266743', 'leadin-arc-778-node__0007__d894bb5d',
  'leadin-arc-778-node__0008__3a102117', 'leadin-arc-778-node__0009__96fea1d0', 'leadin-arc-778-node__0010__3968586a', 'leadin-arc-778-node__0011__97025162',
  'leadin-arc-778-node__0012__936ea33c', 'leadin-arc-778-node__0013__e81cf77a', 'matrix__old-values', 'matrix__online-leadin-calc',
  'matrix__online-leadin-custom', 'matrix__online-leadin-dragged',
]);
const onlineLeadIn = (sidecar) => (sidecar.cutPlan || []).filter((e) => Array.isArray(e) && e[1] && e[1].cutType === 'online' && e[1].leadIn === true);
const ASSERTED = ['a', 'b', 'c', 'dContent', 'eNoId', 'f'];

export async function runCorpus(part, parts) {
  let checks = 0;
  const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
  const measureNow = (state) => { const entries = planEntries(); return measure({ state, entries, ops: describeOperations(state, entries), reliefItems: planReliefItems(state), selections: getSelections() }); };
  const report = { cases: 0, records: 0, unassigned: 0, operations: 0, splits: 0, hiddenLost: 0, model: 0, guideCases: [], hiddenCases: 0, contours: 0, contourSplits: 0, contourNoPart: 0 };
  const differ = [];

  assert.equal(DOC_VERSION, 4, 'the Shaper sidecar is version 4 (TASK S2: a Contour carries its own Depth, Walls and Wall side)');
  for (const c of cases.filter((x, n) => n % parts === part)) {
    const x = expand(c);
    const state = loadCase(x);
    const r = applyShaperDoc(x.sidecar, state);
    const m = r && r.migration;
    ok(m && m.splits === 0, `${c.name}: the migration splits no operation (${m && m.splits})`);
    for (const k of ['records', 'unassigned', 'operations', 'splits', 'hiddenLost', 'model']) report[k] += m[k];
    if (m.hiddenLost) report.hiddenCases++;
    if (m.guideOps > 1) report.guideCases.push(c.name);
    // TASK S2: then version 3 -> 4: each Contour gets its own values (what S1 read live from its part); no Contour is split, none loses a shape
    ok(m.contours && m.contours.splits === 0 && m.contours.noPart === 0, `${c.name}: the Contours' own values: no split, no shape without a part (${JSON.stringify(m.contours)})`);
    report.contours += m.contours.contours; report.contourSplits += m.contours.splits; report.contourNoPart += m.contours.noPart;
    ok(m.heights && m.heights.splits === 0, `${c.name}: a Roughing's / Contour's Depth = its Bottom: no split (${JSON.stringify(m.heights)})`); report.heightsMerged = (report.heightsMerged || 0) + m.heights.merged;
    const now = measureNow(state), base = baseline[c.name];
    ok(LEAD_IN_REMOVED_836.has(c.name) === (onlineLeadIn(x.sidecar).length > 0), `${c.name}: in the TASK 836 list exactly when its sidecar has an On line lead-in`);
    if (LEAD_IN_REMOVED_836.has(c.name)) { // TASK 836: why it changes, and what it is now
      ok(!/"leadIn/.test(JSON.stringify(captureShaperDoc())), `${c.name}: its lead-in fields are dropped on load (TASK 836)`);
      ok(describeOperations(state, planEntries()).every((o) => !/lead-in/.test(o.rowText)), `${c.name}: no Operations row speaks of a lead-in (TASK 836)`);
      ok(planReliefItems(state).every((i) => i.footprints.every((fp) => !('leadIn' in fp))), `${c.name}: no 3D item carries a lead-in (TASK 836)`);
      ok(['a', 'b', 'c', 'dContent', 'eNoId'].some((k) => now[k] !== base[k]) && now.f === base.f, `${c.name}: changed on purpose (TASK 836), its selection list unchanged`);
      for (const [key, r] of onlineLeadIn(x.sidecar)) { // the On line outline that had the lead-in: written as the plain closed loop (with Tabs: its open strokes, as before)
        const mine = planEntries().filter((e) => e.planKey === key);
        if (!mine.length || r.holdPart === 'tabs') continue;
        const els = [...shaperSvgOf(state, mine).matchAll(/<path d="([^"]*)"[^>]*shaper:cutType="online"/g)].map((m) => m[1]);
        ok(els.length > 0 && els.every((d) => /Z$/.test(d)), `${c.name} ${key}: its On line outline is written CLOSED, the plain loop (TASK 836): ${els.map((d) => d.slice(-12)).join(' | ')}`);
        report.closedChecked = (report.closedChecked || 0) + 1;
      }
      report.leadInRemoved = (report.leadInRemoved || 0) + 1;
    }
    if (!LEAD_IN_REMOVED_836.has(c.name)) for (const k of ASSERTED) {
      if (k === 'eNoId' && GUIDE_ROWS.has(c.name)) { ok(now[k] !== base[k], `${c.name}: Guides with different values list one operation each (advisor ruling 1)`); continue; }
      if (k === 'eNoId' && GUIDE_DEPTH_WORDS.has(c.name)) { ok(now[k] !== base[k] && describeOperations(state, planEntries()).some((o) => /^Guide · /.test(o.rowText)), `${c.name}: its Guide's row shows its depth (TASK 825 V4)`); continue; }
      if (TABS_PLACED_822.has(c.name) && k !== 'f') { ok(now[k] !== base[k] && planReliefItems(state).some((i) => i.footprints.some((fp) => fp.hold && fp.hold.role === 'pass' && fp.hold.narrow === true && fp.hold.count === 21)), `${c.name}.${k}: its refused tabs are placed now: 21 tabs kept off the stretches too narrow for a gap strip (TASK 822)`); continue; }
      if (k === 'eNoId' && CUT_NOTHING_ROWS.has(c.name)) { ok(now[k] !== base[k] && describeOperations(state, planEntries()).some((o) => /: nothing to cut$/.test(o.regions)), `${c.name}: its Roughing that cuts nothing is listed (TASK S2)`); continue; }
      if (now[k] !== base[k]) differ.push(`${c.name}.${k}`);
      checks++;
    }
    // the version 4 document (TASK S2; `v3` below = the current version's document): saved, reloaded = the same JSON and the same measurements
    const v3 = JSON.parse(JSON.stringify(captureShaperDoc()));
    ok(v3.version === 4 && Array.isArray(v3.operations) && !('cutPlan' in v3) && !('opOrder' in v3), `${c.name}: saved as version 4`);
    if (v3.operations.some((o) => o.type === 'contour') && !m.heights.merged) { // (a merged Bottom cannot be told back from the version 4 document) // TASK S2: the same document stored as version 3 (its Contours as S1 stored them: depth 'unset', no wall side; the walls in effect kept) reads back to the same version 4 document
      const asV3 = { ...JSON.parse(JSON.stringify(v3)), version: 3, operations: v3.operations.map((o) => (o.type === 'contour' ? { ...o, settings: { ...Object.fromEntries(Object.entries(o.settings).filter(([k]) => k !== 'wallSide')), cutDepth: 'unset' } } : o)) };
      const state3 = loadCase({ ...x, geometry: serializeDocument(state).geometry });
      applyShaperDoc(asV3, state3);
      assert.deepEqual(JSON.parse(JSON.stringify(captureShaperDoc())).operations.map((o) => [o.type, o.settings.cutDepth, o.settings.walls, o.settings.wallSide]), v3.operations.map((o) => [o.type, o.settings.cutDepth, o.settings.walls, o.settings.wallSide]), `${c.name}: a version 3 document's Contours read back with the same own values`); checks++;
      if (md5(pageBefore879(shaperSvgOf(state3, planEntries()), state3)) !== now.a) differ.push(`${c.name}.a (v3 -> v4)`);
    }
    const state2 = loadCase({ ...x, geometry: serializeDocument(state).geometry }); // the saved document: its geometry as the load left it (a version 1 document's kept holes are combined profiles now)
    applyShaperDoc(JSON.parse(JSON.stringify(v3)), state2);
    assert.deepEqual(JSON.parse(JSON.stringify(captureShaperDoc())), v3, `${c.name}: version 3 saved -> reloaded = the same version 3 JSON`); checks++;
    const againA = md5(pageBefore879(shaperSvgOf(state2, planEntries()), state2)); // TASK 879: `a` is measured with the page as before 879 // the reloaded version 3 document's download (its JSON is equal above: the rest derives alike)
    if (againA !== now.a) differ.push(`${c.name}.a (v3 reload)`);
    // an undo snapshot right after loading gives the same document back
    const snap = capturePrepare();
    applyPrepare(JSON.parse(JSON.stringify(snap)));
    assert.deepEqual(JSON.parse(JSON.stringify(captureShaperDoc())), v3, `${c.name}: undo right after loading is a no-op`); checks++;
    report.cases++;
  }
  if (differ.length) { const by = {}; for (const d of differ) { const k = d.replace(/^.*.(w+)( (v3 reload))?$/, '$1$2'); (by[k] = by[k] || []).push(d); } for (const [k, v] of Object.entries(by)) console.log(`DIFFER ${k}: ${v.length}: ${v.slice(0, 6).join(', ')}`); }
  assert.deepEqual(differ, [], `measurements that differ from the baseline: ${differ.slice(0, 20).join(', ')}`);
  if (report.leadInRemoved) { assert.ok(report.closedChecked > 0, 'TASK 836: the On line outlines of the rebased cases were checked closed'); console.log(`TASK 836: ${report.leadInRemoved} lead-in cases rebased by name, ${report.closedChecked} On line outlines checked closed`); }
  assert.deepEqual(report.guideCases, cases.filter((x, n) => n % parts === part && GUIDE_ROWS.has(x.name)).map((x) => x.name), 'the cases with more than one Guide operation are exactly the declared ones');

  if (part === 0) for (const appVersion of [2, 3]) { // the version guard (task 812): an app of version 2 (S0) or 3 (S1) opens a migrated version 4 document (the kitchen sink) but never writes over it
  {
    const c = cases.find((x) => x.name === 'matrix__kitchen-sink-reordered');
    const x = expand(c), state = loadCase(x);
    applyShaperDoc(x.sidecar, state);
    const v3 = JSON.parse(JSON.stringify(captureShaperDoc()));
    const profile = await createProfile();
    const raw = profile.createProjectStore({ adapter: profile.adapter, legacySource: async () => null, channel: null });
    const id = await createNamedDesign(profile, 'shaper', 'Made by S1', serializeDocument(state, { hosts: { shaper: v3 } }));
    await raw.open(id);
    const before = JSON.stringify((await raw.get(id)).document);
    const writes = [];
    const store = new Proxy(raw, { get(t, k) { const v = t[k]; return ['save', 'overwrite', 'saveAs', 'newDesign'].includes(k) && typeof v === 'function' ? (...a) => { writes.push(k); return v.apply(t, a); } : v; } });
    let edits = 0;
    const restores = [];
    const buf = createDocumentBuffer({ state: { joints: new Map(), shapes: [], constraints: [] }, app: 'shaper', hostName: 'shaper', hostVersion: appVersion, getHostData: () => ({ version: appVersion, cutPlan: [], edits }), store, pollMs: 40, onRestored: (r) => restores.push(r) });
    await buf.restore();
    ok(restores.length === 1 && restores[0].newer === true, `the version ${appVersion} app opens the version 4 document as made by a newer version`);
    buf.start(); edits = 1; await new Promise((r) => setTimeout(r, 300)); edits = 2; await buf.flush();
    buf.stop();
    ok(writes.length === 0, `the version ${appVersion} app wrote nothing over it (${writes.join(', ')})`);
    ok(JSON.stringify((await raw.get(id)).document) === before, 'the stored version 4 document is byte for byte what it was');
  }
  }

  console.log(`opfirst corpus part ${part + 1}/${parts}: ${report.cases} cases, migration report: ${JSON.stringify(report)}`);
  return { checks, report };

}
