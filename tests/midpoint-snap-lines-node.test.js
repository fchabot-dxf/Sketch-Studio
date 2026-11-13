// TASK 590: no "midpoint between two lines" snap. Through tests/helpers/node-app.js (the real input path).
// A point near the halfway point between two UNRELATED lines' midpoints is offered no midpoint snap and gets no MIDPOINT constraint;
// a line's OWN midpoint still snaps and adds MIDPOINT {joints:[a, b, mid]} on that line's own endpoints.
import assert from 'node:assert';
import { open, createProfile } from './helpers/node-app.js';

let app = null, failed = null;
try {
  app = await open({ host: 'sketchstudio', profile: await createProfile() });
  const S = (x, y) => app.toScreen(x, y);
  const line = (a, b) => { app.tool('line'); const p = S(a[0], a[1]), q = S(b[0], b[1]); app.click(p.x, p.y); app.click(q.x, q.y); app.esc(); };
  const midpoints = () => app.state.constraints.filter((c) => c.type === 'midpoint');

  // two separate, unconnected lines; the halfway point between their midpoints is (130, 200)
  line([100, 100], [160, 100]);
  line([100, 300], [160, 300]);
  assert.strictEqual(app.state.shapes.filter((s) => s.type === 'line').length, 2, 'two lines drawn');

  // hover with the line tool at the halfway point: no midpoint snap of any kind
  app.tool('line');
  const h = S(130, 200);
  app.move(h.x, h.y);
  assert.ok(!(app.state.snapTarget && app.state.snapTarget.type === 'midpoint'), 'hover at the halfway point: no midpoint snap, got ' + JSON.stringify(app.state.snapTarget && app.state.snapTarget.type));

  // draw a third line ending there: no MIDPOINT constraint
  const s0 = S(400, 200);
  app.click(s0.x, s0.y); app.click(h.x, h.y); app.esc();
  assert.strictEqual(midpoints().length, 0, 'drawn to the halfway point: no MIDPOINT, got ' + JSON.stringify(midpoints()));

  // dragging an existing point to the halfway point: no MIDPOINT either
  app.tool('select');
  app.drag(S(400, 200), { x: h.x + 2, y: h.y + 1 }, 8); app.esc();
  assert.strictEqual(midpoints().length, 0, 'dragged to the halfway point: no MIDPOINT, got ' + JSON.stringify(midpoints()));

  // a line's own midpoint still snaps: MIDPOINT {a, b, dragged} on that line's own endpoints
  const l1 = app.state.shapes.find((s) => s.type === 'line');
  const m = S(130, 100);
  app.tool('line');
  const t0 = S(400, 20);
  app.click(t0.x, t0.y); app.click(m.x, m.y); app.esc();
  const mids = midpoints();
  assert.strictEqual(mids.length, 1, 'a line\'s own midpoint adds one MIDPOINT, got ' + JSON.stringify(mids));
  assert.deepStrictEqual(mids[0].joints.slice(0, 2), l1.joints.slice(0, 2), 'anchors are the line\'s own endpoints');
  assert.ok(!l1.joints.includes(mids[0].joints[2]), 'the third joint is the new point');
  console.log('midpoint-snap-lines: ok');
} catch (e) { failed = e; }
if (app) await app.close();
if (failed) { console.error(failed); process.exit(1); }
