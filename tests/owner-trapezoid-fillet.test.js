import { readFileSync } from 'node:fs';
import { createEngine } from '#core/constraint-solver.js';
import { createSketchState } from '#ui/sketch-state.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { deserializeDocument } from '#core/document.js';
import { commitDimensionEdit } from '#ui/dimension-seams.js';
import { seedFilletForRadius } from '#core/fillet.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

// TASK 486: the owner's real trapezoid (4 fillets R20, 431.8 height, 150 bottom width, top corners free to widen).
// (1) a distance between the two TOP sharp corners must be added as DRIVING (the sketch still has a DOF) and widen the top;
// (2) editing the 431.8 height must keep every fillet arc on its side of its corner (no flipped / reversed arcs).
const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/owner-trapezoid.document.json', import.meta.url), 'utf8'));

function load(withTopWidth) {
  const doc = fixture();
  const topWidth = doc.geometry.constraints.pop();
  if (withTopWidth) doc.geometry.constraints.push({ ...topWidth, isDriven: false, driven: false });
  const engine = createEngine(null); engine.init();
  const state = createSketchState(engine, { x: 0, y: 0, w: 800, h: 800 });
  state.saveState = () => {};
  const res = deserializeDocument(doc, state);
  assert(res.ok, 'fixture loads');
  return { engine, state, topWidth, doc };
}

(async () => {
  // ---- (1) driven/driving ----
  {
    const { engine, state, topWidth } = load(false);
    const s0 = engine.solve(500);
    assert(s0.converged, 'fixture converges');
    assert(s0.rankDeficient === true, 'global solver DOF > 0 before the top-width dimension is added');
    const dim = ConstraintManager.createConstraint(state, 'distance', { ...topWidth, isDriven: false, driven: false }, { source: 'dim' });
    assert(dim && dim.isDriven !== true && !dim.driven, 'top corner-to-corner dimension must be DRIVING, got isDriven=' + (dim && dim.isDriven) + ' ' + (dim && dim.drivenReason));
    const s1 = engine.solve(500);
    assert(s1.converged, 'solve with the new driving dimension converged');
    const a = state.joints.get(topWidth.joints[0]), b = state.joints.get(topWidth.joints[1]);
    assert(Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - 400) < 1e-3, 'top width solved to 400');
  }

  // ---- (2) flip on editing the 431.8 height, with the 400 top width driving ----
  {
    const { engine, state, doc } = load(true);
    assert(engine.solve(500).converged, 'full fixture converges');
    const arcs = state.shapes.filter(s => s.type === 'arc' && s.filletSharp);
    assert(arcs.length === 4, 'four fillet arcs');
    const P = id => state.joints.get(id);
    const snapshot = () => {
      const pts = [...state.joints.values()].filter(j => j.virtualSharp);
      const mx = pts.reduce((s, j) => s + j.x, 0) / pts.length, my = pts.reduce((s, j) => s + j.y, 0) / pts.length;
      return arcs.map(arc => {
        const [c, a, b] = arc.joints.map(P), V = P(arc.filletSharp);
        return {
          inside: Math.hypot(c.x - mx, c.y - my) < Math.hypot(V.x - mx, V.y - my),
          sweep: Math.sign((a.x - c.x) * (b.y - c.y) - (a.y - c.y) * (b.x - c.x))
        };
      });
    };
    // The saved document already has the bottom-right arc flipped (centre below the bottom line): re-seed every fillet at
    // its analytic position first so the test starts from the intended branch.
    for (const arc of arcs) assert(seedFilletForRadius(state, arc, 20).ok, 'seed fillet');
    assert(engine.solve(500).converged, 'solve after re-seeding converged');
    const before = snapshot();
    assert(before.every(s => s.inside), 'arcs start inside their corners ' + JSON.stringify(before));
    const height = state.constraints.find(c => c.type === 'distance' && c.shapes && !c.isRadius);
    assert(height && Math.abs(height.value - 431.8) < 1e-6, 'found the 431.8 height dimension');

    for (const v of [300, 431.8, 120, 431.8]) {
      const r = commitDimensionEdit(state, height, v);
      assert(!r.reverted, `edit to ${v} converged: ${r.clash}`);
      const now = snapshot();
      arcs.forEach((arc, i) => {
        assert(now[i].inside, `arc ${i} flipped outside its corner after edit to ${v}`);
        assert(now[i].sweep === before[i].sweep, `arc ${i} sweep sign reversed after edit to ${v}`);
      });
    }
  }

  console.log('owner-trapezoid fillet tests passed');
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
