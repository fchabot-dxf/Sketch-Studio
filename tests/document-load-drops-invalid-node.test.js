// tests/document-load-drops-invalid-node.test.js - TASK 589 item D (owner report 2026-11-13, report-drag-frozen.json). The owner's saved drawing
// holds a temporary test constraint a crash left behind ({type:'distance', joints:[null, 'j24_...'], __temp:true}, task 589 item C); with it
// loaded, nothing could be dragged. Loading a document (packages/core/document.js deserializeDocument, the one load path) drops every constraint
// that names a missing / unknown joint or is `__temp`, with a logged warning naming it. SketchStudio through tests/helpers/node-app.js, the
// owner's document (tests/fixtures/dimension/owner-drag-frozen-589.document.json) stored as the current design and restored by the app.
//  1. the bad constraint is not loaded, every other one is; the warning names it (the Diagnostic Log, as the owner's Copy Report shows it)
//  2. a drag moves geometry
import assert from 'node:assert';
import fs from 'node:fs';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';

const OWNER = JSON.parse(fs.readFileSync(new URL('./fixtures/dimension/owner-drag-frozen-589.document.json', import.meta.url), 'utf8'));
const stored = OWNER.geometry.constraints;
const bad = stored.filter((c) => c.__temp);
assert.strictEqual(bad.length, 1, 'the fixture holds the one temporary constraint: ' + JSON.stringify(bad));
assert.deepStrictEqual(bad[0].joints, [null, 'j24_1794606712736'], 'with a missing first joint, as the owner saved it');

const profile = await createProfile();
await createNamedDesign(profile, 'sketchstudio', 'owner-589-frozen', OWNER);
const app = await open({ host: 'sketchstudio', profile });
let failed = null;
try {
  const st = app.state;
  // 1. dropped, logged by name; the others loaded
  assert.deepStrictEqual(st.constraints.filter((c) => c.__temp || (c.joints || []).some((j) => j == null || !st.joints.has(j))), [], '1: no constraint with a missing joint is loaded');
  assert.strictEqual(st.constraints.length, stored.length - 1, `1: every other constraint is loaded (${stored.length} stored, ${st.constraints.length} loaded)`);
  const warnings = app.report().log.filter((l) => l.level === 'warn' && JSON.stringify(l.args).includes('dropped constraint'));
  assert.strictEqual(warnings.length, 1, '1: one warning: ' + JSON.stringify(warnings));
  assert(JSON.stringify(warnings[0].args).includes('j24_1794606712736') && JSON.stringify(warnings[0].args).includes('__temp'), '1: it names the constraint: ' + JSON.stringify(warnings[0].args));
  console.log('1. dropped and named:', JSON.stringify(warnings[0].args).slice(0, 160));

  // 2. a drag moves geometry (the owner's bottom-left point of the top rectangle)
  app.tool('select'); app.esc();
  const id = 'j48_1794606832787';
  const before = { ...st.joints.get(id) }; const s = app.toScreen(before.x, before.y);
  app.drag(s, { x: s.x + 40, y: s.y - 30 }, 8);
  const after = st.joints.get(id);
  assert(Math.hypot(after.x - before.x, after.y - before.y) > 1e-3, '2: the dragged point moved: ' + JSON.stringify([before, after]));
  console.log('2. a drag moves geometry: ok');

  // 3. an UNKNOWN joint id is dropped too (and a reserved axis end is a known joint); the load path itself, on the same page state
  const { deserializeDocument } = await import('#core/document.js');
  const r = deserializeDocument({ version: 3, geometry: { joints: [['ja', { x: 0, y: 0 }], ['jb', { x: 10, y: 0 }]], shapes: [], constraints: [
    { type: 'distance', joints: ['ja', 'jb'], value: 10 },
    { type: 'distance', joints: ['ja', 'j_gone'], value: 5 },
    { type: 'horizontal', joints: ['ja', 'jb'] },
  ] } }, st);
  assert(r.ok, '3: loaded');
  assert.deepStrictEqual(st.constraints.map((c) => c.type + ':' + c.joints.join(',')), ['distance:ja,jb', 'horizontal:ja,jb'], '3: only the constraint naming j_gone is dropped');
  const w3 = app.report().log.filter((l) => l.level === 'warn' && JSON.stringify(l.args).includes('unknown joint j_gone'));
  assert.strictEqual(w3.length, 1, '3: its warning names the unknown joint');
  console.log('3. unknown joint id dropped: ok');
} catch (e) { failed = e; } finally { await app.close(); }
if (failed) { console.error(failed.stack || failed.message || failed); process.exitCode = 1; }
