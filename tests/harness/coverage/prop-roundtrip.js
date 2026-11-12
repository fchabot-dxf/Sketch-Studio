// TASK 514 -- SAVE / RELOAD / UNDO ROUND TRIP of a drawing: save the document into the project store (memory backend, the same createProjectStore the
// app uses), read it back, load it into a fresh sketch and compare; and rebuild the same document from the ops journal (packages/core/journal.js).
import * as L from '../audit/lib.js';
import { serializeDocument, deserializeDocument } from '#core/document.js';
import { createProjectStore, createMemoryAdapter } from '#ui/project-store.js';
import { buildJournal, replayJournal, documentHash } from '#core/journal.js';
import { buildDrawing, docOf, normDoc, panelDof } from './prop-lib.js';
import { docDiff } from './prop-random.js';

const LAZY = (k) => k === 'dimSign' || k === 'dimSignMode';   // finding N-F3, counted apart
// canonical JSON: keys sorted at every level (two documents with the same fields in another ORDER are the same document)
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x));
const lazyStripped = (doc) => canon(JSON.parse(JSON.stringify(doc, (k, v) => (LAZY(k) ? undefined : v))));

export async function roundTrip(mod) {
  const { S } = buildDrawing(mod, { journal: true });
  const out = { name: mod.NAME };
  const before = { nullity: L.nullity(S), panel: panelDof(S), pos: L.snapshot(S), doc: docOf(S), flags: S.state.constraints.map(c => L.isDriven(c)), count: S.state.constraints.length };
  const raw = JSON.parse(JSON.stringify(serializeDocument(S.state)));
  const journal = buildJournal(S.state.history, S.state, {});
  // --- project store, memory backend
  const store = createProjectStore({ adapter: createMemoryAdapter(), channel: null, legacySource: async () => null });
  const { id } = await store.save(raw, { app: 'sketchstudio' });
  const rec = await store.get(id);
  // --- load into a fresh sketch (the shared engine store is re-initialised: S is gone after this line)
  const S2 = L.newSketch();
  const res = deserializeDocument(rec.document, S2.state);
  const loaded = { ok: res.ok, pos: L.snapshot(S2), doc: docOf(S2), flags: S2.state.constraints.map(c => L.isDriven(c)), count: S2.state.constraints.length };
  S2.engine.solve(L.ITER);
  const after = { nullity: L.nullity(S2), panel: panelDof(S2), pos: L.snapshot(S2) };
  const dev = (a, b) => { let d = 0; for (const [k, p] of a) { const q = b.get(k); d = q ? Math.max(d, Math.hypot(p.x - q.x, p.y - q.y)) : Infinity; } return d; };
  const diff = docDiff(JSON.stringify(before.doc), JSON.stringify(loaded.doc));
  const lazyOnly = diff.keys.every(k => k === 'distance.dimSign' || k === 'distance.dimSignMode');
  Object.assign(out, {
    loadOk: loaded.ok === true, nullityBefore: before.nullity, nullityAfter: after.nullity, panelBefore: before.panel, panelAfter: after.panel,
    geometryDev: dev(before.pos, loaded.pos), geometryDevSolved: dev(before.pos, after.pos),
    constraints: [before.count, loaded.count], drivenFlagsSame: JSON.stringify(before.flags) === JSON.stringify(loaded.flags),
    docIdentical: canon(before.doc) === canon(loaded.doc), docIdenticalExceptDimSign: lazyStripped(before.doc) === lazyStripped(loaded.doc),
    differingKeys: diff.keys, dimSignOnly: diff.keys.length > 0 && lazyOnly,
  });
  // --- the journal: replay rebuilds the identical document
  const replayed = replayJournal(journal);
  out.journal = { steps: journal.steps.length, hashOk: documentHash(replayed) === journal.current.hash, identical: canon(normDoc(replayed)) === canon(before.doc), truncated: !!journal.truncated };
  return out;
}
