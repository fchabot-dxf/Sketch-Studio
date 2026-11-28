// tests/snap-fix-870-node.test.js — TASK 870: the Circle rim, the Polygon vertex and the 3-point arc Slot's arc point keep the click's locked snap
// (audit 869 causes C, D, E). Every click is 4 px OFF its target (inside the snap magnet), as a hand never hits the pixel.
import assert from 'node:assert';
import { open, createProfile } from './helpers/node-app.js';
import { SLOT_MODES } from '#core/constants.js';
import { projectPointOnSegment } from '#core/geometry.js';

const norm = (t) => String(t).replace(/[-_]/g, '').toLowerCase();
const OFF = 4;   // px
let app = null;
let failed = null;

// a clean sketch with one horizontal line (200,120) - (400,120)
async function fresh() {
  if (app) await app.close();
  app = await open({ host: 'sketchstudio', profile: await createProfile() });
  const S = (x, y) => app.toScreen(x, y);
  app.tool('line');
  const a = S(200, 120), b = S(400, 120);
  app.click(a.x, a.y); app.click(b.x, b.y); app.esc();
  const line = app.state.shapes.find((s) => s.type === 'line');
  assert.ok(line, 'setup: line made');
  return { S, line };
}
const click = (p, dx = 0, dy = OFF) => app.click(p.x + dx, p.y + dy);

try {
  // C1. circle rim 4 px off a line's END POINT: the rim passes exactly through it, and the point is held ON the circle
  {
    const { S, line } = await fresh();
    const endJ = app.state.joints.get(line.joints[1]);
    app.tool('circle');
    click(S(300, 220), 0, 0);                         // centre in free space
    click(S(400, 120), 0, OFF);                       // rim near the end point
    const circ = app.state.shapes.find((s) => s.type === 'circle');
    assert.ok(circ, 'circle made');
    const c = app.state.joints.get(circ.joints[0]);
    assert.ok(Math.abs(Math.hypot(endJ.x - c.x, endJ.y - c.y) - circ.radius) < 1e-6, `circle rim lands on the end point (r=${circ.radius}, d=${Math.hypot(endJ.x - c.x, endJ.y - c.y)})`);
    const pol = app.state.constraints.filter((k) => norm(k.type) === 'pointonline' && k.joint === line.joints[1] && k.shape === circ.id);
    assert.strictEqual(pol.length, 1, `the end point is held on the circle (${JSON.stringify(app.state.constraints.map((k) => k.type))})`);
  }

  // C2. circle rim 4 px off a LINE mid-span: the radius lands exactly on the line, no constraint for the rim
  {
    const { S } = await fresh();
    app.tool('circle');
    click(S(300, 220), 0, 0);
    const before = app.state.constraints.length;
    click(S(260, 120), 0, OFF);
    const circ = app.state.shapes.find((s) => s.type === 'circle');
    const c = app.state.joints.get(circ.joints[0]);
    const want = Math.hypot(260 - c.x, 120 - c.y);   // the radius to the snap on the line below the click (the click is 4 px, about 0.05, off it)
    assert.ok(Math.abs(circ.radius - want) < 0.01, `the radius lands on the line (r=${circ.radius}, want ${want})`);
    assert.strictEqual(app.state.constraints.length, before, 'a rim on a line adds no constraint');
  }

  // D. polygon vertex 4 px off a line mid-span: the vertex is ON the line and held by a point-on-line
  {
    const { S, line } = await fresh();
    app.tool('polygon');
    click(S(300, 220), 0, 0);
    click(S(260, 120), 0, OFF);
    const lines = app.state.shapes.filter((s) => s.type === 'line' && s.id !== line.id && !s.isConstruction);
    assert.ok(lines.length >= 3, 'polygon made');
    const vId = lines[0].joints[0];
    const v = app.state.joints.get(vId);
    const a = app.state.joints.get(line.joints[0]), b = app.state.joints.get(line.joints[1]);
    const q = projectPointOnSegment(v, a, b);
    assert.ok(Math.hypot(v.x - q.x, v.y - q.y) < 1e-3, `vertex on the line (off by ${Math.hypot(v.x - q.x, v.y - q.y)})`);
    const pol = app.state.constraints.filter((k) => norm(k.type) === 'pointonline' && k.shape === line.id && [vId, ...lines.flatMap((s) => s.joints)].includes(k.joint));
    assert.strictEqual(pol.length, 1, `the vertex has a point-on-line (${JSON.stringify(app.state.constraints.map((k) => k.type))})`);
  }

  // D2. polygon vertex 4 px off a line's end point: TASK 1045 (Fusion measured 2026-11-27: a drawing tool's new point on an existing curve END point
  // shares it): the vertex IS that end point, no coincident
  {
    const { S, line } = await fresh();
    app.tool('polygon');
    click(S(300, 220), 0, 0);
    click(S(400, 120), 0, OFF);
    const coin = app.state.constraints.filter((k) => norm(k.type) === 'coincident' && (k.joints || []).includes(line.joints[1]));
    const sides = app.state.shapes.filter((s) => s.type === 'line' && s.id !== line.id && !s.isConstruction);
    assert.strictEqual(coin.length, 0, 'no coincident with the end point');
    assert.ok(sides.filter((s) => s.joints.includes(line.joints[1])).length === 2, 'the vertex IS the end point (two polygon sides use it)');
  }

  // E. 3-point arc slot: the arc point 4 px off an existing point is that point (point-on-arc)
  {
    const { S, line } = await fresh();
    app.state.slotMode = SLOT_MODES.THREE_POINT_ARC;
    app.tool('slot');
    click(S(200, 260), 0, 0);
    click(S(400, 260), 0, 0);
    click(S(400, 120), 0, OFF);        // arc point: near the line's end point (above both picks: a real arc)
    click(S(300, 60), 0, 0);           // width
    const arcs = app.state.shapes.filter((s) => s.type === 'arc');
    assert.ok(arcs.length >= 1, 'slot made');
    const pol = app.state.constraints.filter((k) => norm(k.type) === 'pointonline' && k.joint === line.joints[1] && arcs.some((a) => a.id === k.shape));
    assert.strictEqual(pol.length, 1, `the arc point is held on the arc (${JSON.stringify(app.state.constraints.map((k) => k.type))})`);
  }

  console.log('snap-fix-870-node: ok');
} catch (e) {
  failed = e;
} finally {
  if (app) await app.close();
}
if (failed) { console.error(failed); process.exit(1); }
