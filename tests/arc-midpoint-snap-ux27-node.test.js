// tests/arc-midpoint-snap-ux27-node.test.js -- UX-27 = B-18b (TASK 1010, BUG-137): an arc offers a MIDPOINT snap (the midpoint of its drawn
// sweep) on the same path as a line's midpoint, and a point snapped to it gets the arc form of the Midpoint constraint { joint, shape }.
import assert from 'node:assert';
import { open, createProfile } from './helpers/node-app.js';
import { makeArc } from '#core/shapes.js';
import { arcSweepMidpoint } from '#core/geometry.js';
import { findSnap } from '#ui/snap-detection.js';
import { applySnapConstraint, previewSnapConstraint } from '#core/snap-constraints.js';
import { worldToScreen } from '#ui/coords.js';

const app = await open({ host: 'sketchstudio', profile: await createProfile() });
try {
  const s = app.state;
  const c = s.genJ(), a = s.genJ(), b = s.genJ(), p = s.genJ();
  s.joints.set(c, { x: 6, y: -2 }); s.joints.set(a, { x: 9, y: -2 }); s.joints.set(b, { x: 6, y: 1 }); s.joints.set(p, { x: 20, y: 20 });
  const built = makeArc(s.joints, c, a, b, 'CENTER', false);
  s.shapes.push(built.shapes[0]);
  const arc = s.shapes[s.shapes.length - 1];
  app.frames(2);
  const mid = arcSweepMidpoint(s.joints.get(c), s.joints.get(a), s.joints.get(b), { sweep: arc.sweep });
  const near = app.toScreen(mid.x, mid.y);
  const snap = findSnap(s.joints, s.shapes, app.svg, { x: near.x + 2, y: near.y }, []);
  console.log('arc hover snap:', JSON.stringify(snap && { type: snap.type, x: +snap.x.toFixed(3), y: +snap.y.toFixed(3), shape: snap.shape && snap.shape.id }), 'expected mid', mid.x.toFixed(3), mid.y.toFixed(3));
  assert.ok(snap && snap.type === 'midpoint', `an arc's sweep midpoint is a midpoint snap, got ${snap && snap.type}`);
  assert.ok(Math.abs(snap.x - mid.x) < 1e-6 && Math.abs(snap.y - mid.y) < 1e-6, 'the snap point is the arc sweep midpoint');
  assert.strictEqual(snap.shape.id, arc.id, 'on that arc');
  // away from the midpoint the arc is still a plain shape snap
  const farOnArc = arc && app.toScreen(9, -2);
  const other = findSnap(s.joints, s.shapes, app.svg, { x: farOnArc.x, y: farOnArc.y + 6 }, [c, a, b]);
  assert.ok(!other || other.type !== 'midpoint', 'near an arc end it is not the midpoint');
  // the constraint a point snapped to it gets: the arc form { joint, shape }
  const prev = previewSnapConstraint(snap, p);
  assert.ok(prev && prev.type === 'midpoint' && prev.joint === p && prev.shape === arc.id, `preview is the arc midpoint form: ${JSON.stringify(prev)}`);
  assert.strictEqual(applySnapConstraint(s, p, snap, {}), true, 'the snap applies');
  const made = s.constraints.find((k) => k.type === 'midpoint');
  assert.ok(made && made.joint === p && made.shape === arc.id && !made.joints, `a Midpoint constraint { joint, shape }: ${JSON.stringify(made)}`);
  const pj = s.joints.get(p);
  assert.ok(Math.hypot(pj.x - mid.x, pj.y - mid.y) < 1e-3, `the point lands on the arc midpoint: (${pj.x}, ${pj.y})`);
  console.log('PASS arc-midpoint-snap-ux27-node');
} finally { await app.close(); }
