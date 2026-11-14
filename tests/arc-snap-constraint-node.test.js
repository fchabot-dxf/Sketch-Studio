// TASK 632: every click of the Arc tool (centre, start, end) snaps and adds the constraint the Line tool adds for the same target:
// on a point COINCIDENT, on a line POINT-ON-LINE, on a line's midpoint MIDPOINT; one constraint, one undo step. Node kit (the real input path).
// With ARC_SNAP_TABLE=1 it prints the measurement table (arc clicks vs the Line tool's first / second clicks).
import assert from 'node:assert';
import { open, createProfile } from './helpers/node-app.js';

const TARGETS = { point: [303, 207], line: [333, 207], midpoint: [353, 207] };   // on the line (300,200)-(400,200)
const EXPECT = { point: 'coincident', line: 'pointOnLine', midpoint: 'midpoint' };
const R = 100;
let app = null, failed = null;
const rows = [];

async function fresh() {
  if (app) await app.close();
  app = await open({ host: 'sketchstudio', profile: await createProfile() });
  const S = (x, y) => app.toScreen(x, y);
  app.tool('line');
  const a = S(303, 207), b = S(403, 207);
  app.click(a.x, a.y); app.click(b.x, b.y); app.esc();
  return S;
}
const kinds = () => app.state.constraints.map((c) => c.type);
const norm = (t) => String(t).replace(/[-_]/g, '').toLowerCase();
const wantType = (kind) => norm(EXPECT[kind]);
const snapOf = (id) => id && app.state.joints.get(id);

for (const kind of Object.keys(TARGETS)) {
  const T = TARGETS[kind];
  // Line tool reference: first click and second click on the target
  for (const click of ['first', 'second']) {
    const S = await fresh();
    const before = app.state.constraints.length;
    app.tool('line');
    const far = S(T[0], T[1] + 150);
    const t = S(T[0], T[1]);
    if (click === 'first') { app.click(t.x, t.y); app.click(far.x + 40, far.y); }
    else { app.click(far.x + 40, far.y); app.click(t.x, t.y); }
    app.esc();
    const added = app.state.constraints.slice(before).map((c) => c.type);
    rows.push({ tool: 'line', click, kind, added });
  }
  // Arc: each of the three clicks on the target
  for (const click of ['centre', 'start', 'end']) {
    const S = await fresh();
    const before = app.state.constraints.length;
    const nShapes = app.state.shapes.length;
    app.tool('arc');
    let c, s, e;
    if (click === 'centre') { c = T; s = [T[0] + R, T[1] + 1]; e = [T[0] + 1, T[1] + R]; }
    else { c = [T[0], T[1] + R]; }
    if (click === 'start') { s = T; e = [c[0] + R, c[1]]; }
    if (click === 'end') { s = [c[0] + R, c[1]]; e = T; }
    // (the start of a centre-snapped arc is placed away from the line: it must not be the snapped click)
    const P = (p) => S(p[0], p[1]);
    app.click(P(c).x, P(c).y);
    app.click(P(s).x, P(s).y);
    app.click(P(e).x, P(e).y);
    app.esc();
    const arc = app.state.shapes.find((x) => x.type === 'arc');
    const added = app.state.constraints.slice(before).map((x) => x.type);
    const joint = arc && arc.joints[click === 'centre' ? 0 : click === 'start' ? 1 : 2];
    const j = snapOf(joint);
    const onTarget = !!j && Math.hypot(j.x - T[0], j.y - T[1]) < 0.5;
    const cons = app.state.constraints.slice(before);
    rows.push({ tool: 'arc', click, kind, added, onTarget, made: !!arc, cons, arc, S });
  }
}

if (process.env.ARC_SNAP_TABLE) {
  for (const r of rows) console.log(r.tool.padEnd(5), r.click.padEnd(7), r.kind.padEnd(9), 'snapped:', String(r.onTarget).padEnd(5), 'added:', JSON.stringify(r.added));
}

try {
  for (const r of rows) {
    const label = `${r.tool} ${r.click} on ${r.kind}`;
    const want = wantType(r.kind);
    if (r.tool === 'line') {   // reference: the Line tool's first click on a point reuses that joint (no constraint); the drawn segment is vertical here
      const snapAdded = r.added.filter((t) => norm(t) !== 'vertical');
      assert.deepStrictEqual(snapAdded.map(norm), r.kind === 'point' && r.click === 'first' ? [] : [want], label + ': line reference, got ' + JSON.stringify(r.added));
      continue;
    }
    assert.ok(r.made, label + ': arc made');
    assert.ok(r.onTarget, label + ': the click snaps to the target');
    // the arc's own constraints (arc radius equalities etc.) are not snap constraints: look at the ones that reference the target
    const snapCons = r.cons.filter((c) => norm(c.type) === want);
    assert.strictEqual(snapCons.length, 1, label + ': one ' + want + ' constraint, got ' + JSON.stringify(r.added));
  }

  // the targets are ANOTHER ARC's points: the Arc tool must draw on them (it used to start a joint drag of that arc instead)
  for (const [pname, pidx, P0] of [['centre', 0, [300, 200]], ['start', 1, [360, 200]], ['end', 2, [300, 260]]]) {
    for (const click of ['centre', 'start', 'end']) {
      const S2 = await fresh();
      app.tool('arc');
      const q = (p) => S2(p[0], p[1]);
      app.click(q([300, 200]).x, q([300, 200]).y); app.click(q([360, 200]).x, q([360, 200]).y); app.click(q([300, 260]).x, q([300, 260]).y); app.esc();
      const first = app.state.shapes.find((x) => x.type === 'arc');
      const target = first.joints[pidx];
      const before = app.state.constraints.length, nShapes = app.state.shapes.length;
      app.tool('arc');
      let c = [P0[0] - 250, P0[1] + 250], s, e;
      if (click === 'centre') { c = P0; s = [P0[0] + 90, P0[1] + 150]; e = [P0[0] - 150, P0[1] + 120]; }
      else if (click === 'start') { s = P0; e = [c[0] + 100, c[1] - 1]; }
      else { s = [c[0] + 100, c[1]]; e = P0; }
      app.click(q(c).x, q(c).y); app.click(q(s).x, q(s).y); app.click(q(e).x, q(e).y); app.esc();
      const label = `arc ${click} on another arc's ${pname}`;
      assert.strictEqual(app.state.shapes.length, nShapes + 1, label + ': an arc is drawn');
      const arc = app.state.shapes.filter((x) => x.type === 'arc').pop();
      const mine = arc.joints[click === 'centre' ? 0 : click === 'start' ? 1 : 2];
      const co = app.state.constraints.slice(before).filter((x) => norm(x.type) === 'coincident' && x.joints.includes(mine) && x.joints.includes(target));
      assert.strictEqual(co.length, 1, label + ': one COINCIDENT with that point, got ' + JSON.stringify(app.state.constraints.slice(before).map((x) => x.type)));
    }
  }

  // undo removes the arc and its constraints in one step
  const S = await fresh();
  const base = app.state.constraints.length, baseShapes = app.state.shapes.length;
  app.tool('arc');
  const T = TARGETS.point;
  const P = (p) => S(p[0], p[1]);
  const c = [T[0], T[1] + R];
  app.click(P(c).x, P(c).y); app.click(P(T).x, P(T).y); app.click(P([c[0] + R, c[1]]).x, P([c[0] + R, c[1]]).y); app.esc();
  assert.ok(app.state.constraints.length > base, 'arc with a snap start added constraints');
  app.undo();
  assert.strictEqual(app.state.shapes.length, baseShapes, 'undo removes the arc');
  assert.strictEqual(app.state.constraints.length, base, 'undo removes the arc\'s constraints too, got ' + JSON.stringify(kinds()));
  console.log('arc-snap-constraint: ok');
} catch (e) { failed = e; }
if (app) await app.close();
if (failed) { console.error(failed); process.exit(1); }

