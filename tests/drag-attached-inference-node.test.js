// tests/drag-attached-inference-node.test.js -- TASK 598 (node, through tests/helpers/node-app.js, the app's own pointer listeners): while the free end
// of a line is dragged (a single-point drag), the inferences offered and added at release are the ones Fusion offers and adds.
// Fusion, measured with the REAL mouse (docs/FUSION-COMPARISON.md "Dragging: the attached-line inferences of a line end (task 598)", local evidence
// .evidence/598/fusion-summary.txt): a dragged line end turned horizontal / vertical shows the Horizontal / Vertical glyph and the release adds it;
// dragged onto another line's midpoint it shows the Midpoint glyph and adds a midpoint; dragged onto a point / a line / a circle it snaps and adds a
// coincident. It shows and adds NOTHING when the line is turned parallel or perpendicular to another line, perpendicular to the line it shares its
// corner with, to the length of another line, or tangent to the arc it shares its other end with (each reached within 0.003 - 0.15 deg / 0.13 mm).
// Ours before (packages/core/inference-engine.js findInference, the attached-line tests of a joint drag): a PARALLEL / PERPENDICULAR to any other line
// within 3 deg (ANGLE_SNAP_DEG), the end pinned on it, and the release added it.
// Each row = one Fusion row (two directions each; Fusion cm -> ours mm, x 10): a stored design, one press on the line's free end, 30 pointer moves to
// the target, release. Checked: the inference shown on any event (state.inference, what the renderer draws) and the constraints the release added.
// The coincident rows are SNAPS (input-manager updateSnapTarget, task 582), a separate mechanism: recorded here and compared with Fusion, not changed.
// Control: the LINE tool (drawing) keeps every inference it had: horizontal, vertical, parallel, perpendicular, tangent.
// The view: 130 mm across, no grid magnet (GRID_MAGNETISM 0.001, as tests/drag-inference-scan-node.test.js).
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import SettingsManager from '#core/settings-manager.js';

SettingsManager.set('GRID_MAGNETISM', 0.001, { persist: 'none' });
const quiet = (fn) => async (...a) => { const log = console.log; console.log = () => {}; try { return await fn(...a); } finally { console.log = log; } };
const pos = (st, id) => { const j = st.joints.get(id); return { x: j.x, y: j.y }; };

const O = { x: 40, y: 30 }; // every scene sits around O, away from the X / Y axes (their snap would hide the inference); the view is centred on O
const at = (dx, dy) => ({ x: O.x + dx, y: O.y + dy });
function design(joints, shapes, constraints = []) {
  return { version: 3, hosts: {}, geometry: {
    joints: [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }], ...Object.entries(joints).map(([id, [x, y]]) => [id, { x: O.x + x, y: O.y + y, fixed: false, sketchId: 'sketch-1' }])],
    shapes: shapes.map((s) => ({ sketchId: 'sketch-1', isConstruction: false, ...s })), constraints,
    sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }], activeSketchId: 'sketch-1', groups: [], profiles: [], parameters: [], vcarves: [] } };
}
const line = (id, a, b) => ({ id, type: 'line', joints: [a, b] });
async function openDesign(doc) {
  const profile = await createProfile();
  const id = await createNamedDesign(profile, 'sketchstudio', 'Task 598');
  { const store = profile.createProjectStore({ adapter: profile.adapter, legacySource: async () => null, channel: null }); await store.save(doc, { app: 'sketchstudio', id }); }
  const app = await open({ host: 'sketchstudio', profile });
  const st = app.state; app.tool('select');
  const r = app.svg.getBoundingClientRect();
  Object.assign(st.view, { x: O.x, y: O.y, w: 130 }); st.view.h = st.view.w / (r.width / r.height);
  app.svg.setAttribute('viewBox', `${st.view.x - st.view.w / 2} ${st.view.y - st.view.h / 2} ${st.view.w} ${st.view.h}`); app.frames();
  return app;
}
const linePath = (from, to, n = 30) => Array.from({ length: n }, (_, k) => ({ x: from.x + (to.x - from.x) * (k + 1) / n, y: from.y + (to.y - from.y) * (k + 1) / n }));

// press on joint `id`, 30 pointer moves to `to` (local mm), release there
const dragTo = quiet(async (app, id, to) => {
  const st = app.state, a = app.toScreen(pos(st, id).x, pos(st, id).y), n0 = st.constraints.length;
  app.move(a.x, a.y); app.down(a.x, a.y);
  assert.ok(st.drag && st.drag.id === id && st.drag.type === 'joint', 'the press on ' + id + ' starts its single-joint drag');
  const shown = new Map(), snaps = new Map();
  let last = a;
  for (const w of linePath(pos(st, id), at(to[0], to[1]))) {
    const s = app.toScreen(w.x, w.y); app.move(s.x, s.y, { buttons: 1 }); last = s;
    if (st.inference) { const k = st.inference.type + ':' + (st.inference.targetId || ''); shown.set(k, (shown.get(k) || 0) + 1); }
    if (st.activeSnap) { const k = st.activeSnap.type + ':' + (st.activeSnap.targetId || st.activeSnap.id || (st.activeSnap.shape && st.activeSnap.shape.id) || ''); snaps.set(k, (snaps.get(k) || 0) + 1); }
  }
  const lastInf = st.inference ? st.inference.type : null;
  app.up(last.x, last.y);
  assert.ok(!st.drag, 'the drag ended');
  return { shown, snaps, lastInf, added: st.constraints.slice(n0).map((c) => c.type) };
});
const fmt = (m) => [...m].map(([k, n]) => `${n} x ${k}`).join(', ') || 'none';

// The rows (Fusion cm x 10 = mm, relative to O). `inf`: the inference Fusion showed (null: none on any event). `adds`: the constraint types its release
// added. `snap`: a coincident row (Fusion snapped and added a coincident).
const u = [3 / Math.sqrt(10), 1 / Math.sqrt(10)];
const S = [20 * Math.cos(Math.PI / 6), 20 * Math.sin(Math.PI / 6)]; // the arc's start (30 deg on r 20)
const tanEnd = (deg) => [S[0] + 30 * Math.cos(deg * Math.PI / 180), S[1] + 30 * Math.sin(deg * Math.PI / 180)];
const C45 = [20 + 15 * Math.SQRT1_2, -10 + 15 * Math.SQRT1_2];
const free = (b, more = {}, shapes = []) => design({ a: [0, 0], b, ...more }, [line('L', 'a', 'b'), ...shapes]);
const ROWS = [
  ['H-a turned horizontal, from above', free([30, 10]), [30, 0], { inf: 'horizontal', adds: ['horizontal'] }],
  ['H-b turned horizontal, from below', free([30, -10]), [30, 0], { inf: 'horizontal', adds: ['horizontal'] }],
  ['V-a turned vertical, from the right', free([10, 30]), [0, 30], { inf: 'vertical', adds: ['vertical'] }],
  ['V-b turned vertical, from the left', free([-10, 30]), [0, 30], { inf: 'vertical', adds: ['vertical'] }],
  ['PAR-a turned parallel to another line M, from below', free([30, 10], { m0: [10, 35], m1: [40, 55] }, [line('M', 'm0', 'm1')]), [30, 20], { inf: null, adds: [] }],
  ['PAR-b turned parallel to M, from above', free([25, 25], { m0: [10, 35], m1: [40, 55] }, [line('M', 'm0', 'm1')]), [30, 20], { inf: null, adds: [] }],
  ['PERP-a turned perpendicular to an unconnected line N, from the right', free([-10, 33], { n0: [10, 35], n1: [40, 55] }, [line('N', 'n0', 'n1')]), [-20, 30], { inf: null, adds: [] }],
  ['PERP-b turned perpendicular to N, from the left', free([-30, 20], { n0: [10, 35], n1: [40, 55] }, [line('N', 'n0', 'n1')]), [-20, 30], { inf: null, adds: [] }],
  ['PERPC-a turned perpendicular to K, the line it shares its corner with, from the right', free([-10, 33], { k1: [30, 20] }, [line('K', 'a', 'k1')]), [-20, 30], { inf: null, adds: [] }],
  ['PERPC-b turned perpendicular to K, from the left', free([-30, 20], { k1: [30, 20] }, [line('K', 'a', 'k1')]), [-20, 30], { inf: null, adds: [] }],
  ['EQ-a lengthened to the length of E', free([24 * u[0], 24 * u[1]], { e0: [0, 25], e1: [30, 25] }, [line('E', 'e0', 'e1')]), [30 * u[0], 30 * u[1]], { inf: null, adds: [] }],
  ['EQ-b shortened to the length of E', free([36 * u[0], 36 * u[1]], { e0: [0, 25], e1: [30, 25] }, [line('E', 'e0', 'e1')]), [30 * u[0], 30 * u[1]], { inf: null, adds: [] }],
  ...[[-45, 'TAN-a'], [-75, 'TAN-b']].map(([d, n]) => [`${n} turned tangent to the arc it shares its other end with, from ${d} deg`,
    design({ ac: [0, 0], s: S, ae: [20 * Math.cos(2 * Math.PI / 3), 20 * Math.sin(2 * Math.PI / 3)], b: tanEnd(d) },
      [{ id: 'A', type: 'arc', subType: 'CENTER', joints: ['ac', 's', 'ae'], largeArc: false, sweep: true }, line('L', 's', 'b')], [{ type: 'equal', joints: ['ac', 's', 'ac', 'ae'] }]),
    tanEnd(-60), { inf: null, adds: [] }]),
  ['MID-a onto the midpoint of line R, from above', design({ a: [-5, 20], b: [20, 12], r0: [0, 0], r1: [40, 0] }, [line('L', 'a', 'b'), line('R', 'r0', 'r1')]), [20, 0], { inf: 'midpoint', adds: ['midpoint'] }],
  ['MID-b onto the midpoint of R, from the upper right', design({ a: [-5, 20], b: [32, 8], r0: [0, 0], r1: [40, 0] }, [line('L', 'a', 'b'), line('R', 'r0', 'r1')]), [20, 0], { inf: 'midpoint', adds: ['midpoint'] }],
  ['CPT-a onto a lone point Q, from above', design({ a: [-5, 20], b: [20, 12], q: [20, 0] }, [line('L', 'a', 'b')]), [20, 0], { snap: true, adds: ['coincident'] }],
  ['CPT-b onto Q, from the upper right', design({ a: [-5, 20], b: [32, 6], q: [20, 0] }, [line('L', 'a', 'b')]), [20, 0], { snap: true, adds: ['coincident'] }],
  ['CLINE-a onto line R 8 mm from its midpoint, from above', design({ a: [-5, 20], b: [12, 10], r0: [0, 0], r1: [40, 0] }, [line('L', 'a', 'b'), line('R', 'r0', 'r1')]), [12, 0], { snap: true, adds: ['pointOnLine'] }],
  ['CLINE-b onto R, from the upper right', design({ a: [-5, 20], b: [22, 8], r0: [0, 0], r1: [40, 0] }, [line('L', 'a', 'b'), line('R', 'r0', 'r1')]), [12, 0], { snap: true, adds: ['pointOnLine'] }],
  ['CCIRC-a onto circle C, from outside', design({ a: [-5, 20], b: [38, 8], cc: [20, -10] }, [line('L', 'a', 'b'), { id: 'C', type: 'circle', joints: ['cc'], radius: 15 }]), C45, { snap: true, adds: ['pointOnLine'] }],
  ['CCIRC-b onto C, from inside', design({ a: [-5, 20], b: [24, -6], cc: [20, -10] }, [line('L', 'a', 'b'), { id: 'C', type: 'circle', joints: ['cc'], radius: 15 }]), C45, { snap: true, adds: ['pointOnLine'] }],
];

const failures = [], divergences = [];
for (const [label, doc, to, want] of ROWS) {
  const app = await openDesign(doc);
  try {
    const r = await dragTo(app, 'b', to);
    console.log(`${label}: inference shown ${fmt(r.shown)}; snap ${fmt(r.snaps)}; on the last event ${r.lastInf}; added at release ${JSON.stringify(r.added)}`);
    const shownTypes = new Set([...r.shown.keys()].map((k) => k.split(':')[0]));
    const bad = [];
    if (want.snap) { // a SNAP row: compared with Fusion, a difference is reported (not this task's mechanism)
      if (JSON.stringify(r.added) !== JSON.stringify(want.adds)) divergences.push(`${label}: Fusion adds ${JSON.stringify(want.adds)}, ours ${JSON.stringify(r.added)}`);
      continue;
    }
    if (want.inf === null && shownTypes.size) bad.push(`offers ${[...shownTypes].join(', ')} (Fusion: nothing)`);
    if (want.inf && r.lastInf !== want.inf) bad.push(`shows ${r.lastInf} at the target (Fusion: ${want.inf})`);
    if (want.inf && [...shownTypes].some((t) => t !== want.inf)) bad.push(`also offers ${[...shownTypes].filter((t) => t !== want.inf).join(', ')} on the way (Fusion: ${want.inf} only)`);
    if (JSON.stringify(r.added) !== JSON.stringify(want.adds)) bad.push(`the release adds ${JSON.stringify(r.added)} (Fusion: ${JSON.stringify(want.adds)})`);
    if (bad.length) { failures.push(label); console.log(`  FAIL ${label}: ${bad.join('; ')}`); }
  } finally { await app.close(); }
}
for (const d of divergences) console.log('  SNAP DIVERGENCE (reported, not changed) ' + d);

// ---- control: the LINE tool (drawing) keeps every inference: H, V, tangent, parallel, perpendicular
{
  const app = await openDesign(design({ cc: [0, 0], m0: [-40, 15], m1: [-10, 25], n0: [-40, -25], n1: [-30, -5] },
    [{ id: 'C', type: 'circle', joints: ['cc'], radius: 20 }, line('M', 'm0', 'm1'), line('N', 'n0', 'n1')]));
  try {
    const st = app.state;
    const shownFrom = quiet(async (from, to) => { // the line tool: click at `from`, hover toward `to`: the inference shown at the last hover
      app.tool('line');
      const a = app.toScreen(from.x, from.y); app.click(a.x, a.y);
      let inf = null;
      for (const w of linePath(from, to, 10)) { const s = app.toScreen(w.x, w.y); app.move(s.x, s.y); inf = st.inference ? { type: st.inference.type, target: st.inference.targetId || null } : null; }
      app.esc();
      return inf;
    });
    const q = 20 / Math.SQRT2;
    const got = {
      horizontal: await shownFrom(at(25, 40), at(45, 40.3)),
      vertical: await shownFrom(at(50, -30), at(50.3, -10)),
      tangent: await shownFrom(at(q, q), at(q - 14, q + 14.3)), // from C at 45 deg, along its tangent (0.6 deg off)
      parallel: await shownFrom(at(-25, 15), at(-10, 20.2)), // 4.7 mm beside M (direction (3, 1)), 0.6 deg off
      perpendicular: await shownFrom(at(-30, -5), at(-50, 5.3)), // from N's end (N direction (1, 2)), at right angles to N
    };
    console.log('control, line tool while drawing: ' + JSON.stringify(got));
    assert.deepStrictEqual(got, { horizontal: { type: 'horizontal', target: null }, vertical: { type: 'vertical', target: null }, tangent: { type: 'tangent', target: 'C' },
      parallel: { type: 'parallel', target: 'M' }, perpendicular: { type: 'perpendicular', target: 'N' } }, 'the line tool keeps its drawing inferences');
  } finally { await app.close(); }
}

assert.strictEqual(failures.length, 0, failures.length + ' row(s) differ from Fusion: ' + failures.join(' | '));
console.log(`drag-attached-inference-node: ok (${ROWS.length} rows; snap divergences reported: ${divergences.length})`);
