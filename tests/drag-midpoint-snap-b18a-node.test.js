// tests/drag-midpoint-snap-b18a-node.test.js -- B-18a (TASK 1010, BUG-138): a rectangle corner dragged to a line's midpoint is pulled to
// EXACTLY the previewed midpoint while it is dragged (the drop uses the previewed snap): no jump on release.
import assert from 'node:assert';
import { open, createProfile } from './helpers/node-app.js';
import * as ops from '#core/tool-ops.js';

const app = await open({ host: 'sketchstudio', profile: await createProfile() });
try {
  const s = app.state;
  const a = s.genJ(), b = s.genJ();
  s.joints.set(a, { x: -5, y: 4, fixed: false }); s.joints.set(b, { x: 5, y: 4, fixed: false });
  s.shapes.push({ id: 'target', type: 'line', joints: [a, b] }); // midpoint (0, 4)
  ops.rect(s, -4, -4, 0, 0);                                      // its bottom-right corner is at (0, 0)
  app.frames(2);
  const from = app.toScreen(0, 0), mid = app.toScreen(0, 4);
  const near = { x: mid.x + 4, y: mid.y - 4 };
  app.move(from.x, from.y);
  app.down(from.x, from.y);
  for (let i = 1; i <= 8; i++) app.move(from.x + (near.x - from.x) * i / 8, from.y + (near.y - from.y) * i / 8, { buttons: 1 });
  const id = s.drag.id;
  const during = { ...s.joints.get(id) };
  const snap = s.activeSnap ? { type: s.activeSnap.type, isLocked: s.activeSnap.isLocked } : null;
  app.up(near.x, near.y);
  const after = { ...s.joints.get(id) };
  const jump = Math.hypot(after.x - during.x, after.y - during.y);
  console.log('previewed snap', JSON.stringify(snap), 'during', during.x.toFixed(4), during.y.toFixed(4), 'after release', after.x.toFixed(4), after.y.toFixed(4), 'jump', jump.toFixed(4));
  assert.ok(snap && snap.type === 'midpoint', 'the midpoint snap is previewed while dragging');
  assert.ok(Math.hypot(during.x - 0, during.y - 4) < 1e-3, `while dragged the corner sits on the previewed midpoint (0, 4): (${during.x}, ${during.y})`);
  assert.ok(jump < 1e-3, `no jump on release (${jump})`);
  assert.strictEqual(s.constraints.filter((c) => c.type === 'midpoint').length, 1, 'the release adds the Midpoint constraint');
  console.log('PASS drag-midpoint-snap-b18a-node');
} finally { await app.close(); }
