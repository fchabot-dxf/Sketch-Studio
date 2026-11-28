// tests/rect-snap-constraint-867-node.test.js — TASK 867: Rectangle corners/center placed on existing geometry
// (line mid-span, endpoint, midpoint, arc, circle) snap and get the same constraint the Line tool creates.
import assert from 'node:assert';
import { open, createProfile } from './helpers/node-app.js';
import { RECT_MODES, CONSTRAINT_TYPES } from '#core/constants.js';
import { projectPointOnSegment } from '#core/geometry.js';

const DIST_TOL = 1e-3;
let app = null;
let failed = null;

const norm = (t) => String(t).replace(/[-_]/g, '').toLowerCase();

async function freshWithLine() {
  if (app) await app.close();
  app = await open({ host: 'sketchstudio', profile: await createProfile() });
  const S = (x, y) => app.toScreen(x, y);
  app.tool('line');
  const p1 = S(200, 120), p2 = S(400, 120);
  app.click(p1.x, p1.y);
  app.click(p2.x, p2.y);
  app.esc();
  const baseLine = app.state.shapes.find((s) => s.type === 'line');
  assert.ok(baseLine, 'setup: base line created');
  return { S, baseLine };
}

function pointDistToLine(st, jid, lineShape) {
  const p = st.joints.get(jid);
  const a = st.joints.get(lineShape.joints[0]);
  const b = st.joints.get(lineShape.joints[1]);
  const q = projectPointOnSegment(p, a, b);
  return Math.hypot(p.x - q.x, p.y - q.y);
}

try {
  // 1. Line tool baseline: start point mid-span on baseLine creates pointOnLine
  {
    const { S, baseLine } = await freshWithLine();
    const before = app.state.constraints.length;
    app.tool('line');
    const a = S(260, 120), b = S(260, 220);
    app.click(a.x, a.y);
    app.click(b.x, b.y);
    app.esc();
    const added = app.state.constraints.slice(before);
    const pol = added.filter((c) => norm(c.type) === 'pointonline' && c.shape === baseLine.id);
    assert.strictEqual(pol.length, 1, 'line baseline: start mid-span creates 1 pointOnLine');
  }

  // 2. 2-point rect: first corner on line mid-span -> second corner in free space
  {
    const { S, baseLine } = await freshWithLine();
    const beforeCons = app.state.constraints.length;
    app.tool('rect');
    app.state.rectMode = RECT_MODES.TWO_POINT;
    const c1 = S(260, 120); // mid-span (not endpoint 200 or 400, not midpoint 300)
    const c2 = S(340, 200);
    app.move(c1.x, c1.y);
    const hoverSnap = app.state.snapTarget;
    assert.ok(hoverSnap && hoverSnap.type === 'shape' && hoverSnap.targetId === baseLine.id, '2pt rect: first corner snap indicator sees shape snap');
    app.click(c1.x, c1.y);
    app.click(c2.x, c2.y);

    const rectLines = app.state.shapes.filter((s) => s.type === 'line' && s.groupId && s.groupId.startsWith('rect_'));
    assert.strictEqual(rectLines.length, 4, '2pt rect: 4 sides created');
    const firstCornerId = rectLines[0].joints[0]; // makeRectFromTwoJoints reuses j1Id as shapes[0].joints[0]
    assert.ok(pointDistToLine(app.state, firstCornerId, baseLine) < DIST_TOL, '2pt rect: first corner lies on line');
    const added = app.state.constraints.slice(beforeCons);
    const pol = added.filter((c) => norm(c.type) === 'pointonline' && c.joint === firstCornerId && c.shape === baseLine.id);
    assert.strictEqual(pol.length, 1, `2pt rect: first corner must have 1 pointOnLine on line (got ${JSON.stringify(added)})`);

    // Drag the base line vertically -> first corner follows
    const prevY = app.state.joints.get(firstCornerId).y;
    const from = S(370, 120), to = S(370, 150);
    app.tool('select');
    app.drag(from, to);
    const nextY = app.state.joints.get(firstCornerId).y;
    assert.ok(Math.abs(nextY - prevY) > 5, `2pt rect: dragging line moves snapped first corner (${prevY} -> ${nextY})`);
    assert.ok(pointDistToLine(app.state, firstCornerId, baseLine) < DIST_TOL, '2pt rect: first corner stays on line after drag');
  }

  // 3. 2-point rect: Enter after typing W x H still applies first corner snap constraint
  {
    const { S, baseLine } = await freshWithLine();
    const beforeCons = app.state.constraints.length;
    app.tool('rect');
    app.state.rectMode = RECT_MODES.TWO_POINT;
    const c1 = S(260, 120), c2 = S(320, 180);
    app.click(c1.x, c1.y);
    app.move(c2.x, c2.y);
    app.type('40');
    app.key('Tab');
    app.type('25');
    app.enter();
    const rectLines = app.state.shapes.filter((s) => s.type === 'line' && s.groupId && s.groupId.startsWith('rect_'));
    assert.strictEqual(rectLines.length, 4, '2pt rect Enter: 4 sides created');
    const firstCornerId = rectLines[0].joints[0];
    const pol = app.state.constraints.slice(beforeCons).filter((c) => norm(c.type) === 'pointonline' && c.joint === firstCornerId && c.shape === baseLine.id);
    assert.strictEqual(pol.length, 1, '2pt rect Enter: first corner keeps pointOnLine constraint');
  }

  // 4. 2-point rect: first corner on endpoint -> SHARED (TASK 1045, Fusion measured 2026-11-27: the corner IS the line's end, 1 point used by 3
  // curves, no constraint); on midpoint -> midpoint
  for (const [label, pt, expectType] of [
    ['endpoint', [200, 120], 'shared'],
    ['midpoint', [300, 120], 'midpoint'],
  ]) {
    const { S, baseLine } = await freshWithLine();
    const beforeCons = app.state.constraints.length;
    app.tool('rect');
    app.state.rectMode = RECT_MODES.TWO_POINT;
    const p = S(pt[0], pt[1]), c2 = S(360, 210);
    app.click(p.x, p.y);
    app.click(c2.x, c2.y);
    const rectLines = app.state.shapes.filter((s) => s.type === 'line' && s.groupId && s.groupId.startsWith('rect_'));
    const firstCornerId = rectLines[0].joints[0];
    const added = app.state.constraints.slice(beforeCons);
    if (expectType === 'shared') {
      assert.ok(firstCornerId === baseLine.joints[0] && app.state.shapes.filter((s) => s.joints.includes(firstCornerId)).length === 3 && !added.some((c) => norm(c.type) === 'coincident'),
        `2pt rect first corner on ${label}: the corner IS the end point (used by 3 curves, no coincident), got ${JSON.stringify(added.map((c) => c.type))}`);
      continue;
    }
    const matched = added.filter((c) => {
      if (norm(c.type) !== expectType) return false;
      if (expectType === 'coincident') return c.joints && c.joints.includes(firstCornerId) && c.joints.includes(baseLine.joints[0]);
      return c.joints && c.joints[2] === firstCornerId;
    });
    assert.strictEqual(matched.length, 1, `2pt rect first corner on ${label}: expected ${expectType}, got ${JSON.stringify(added)}`);
  }

  // 5. Center rect: center on line mid-span AND opposite corner on another line mid-span
  {
    const { S, baseLine } = await freshWithLine();
    app.tool('line');
    const l2a = S(200, 220), l2b = S(400, 220);
    app.click(l2a.x, l2a.y); app.click(l2b.x, l2b.y); app.esc();
    const secondLine = app.state.shapes.filter((s) => s.type === 'line')[1];

    const beforeCons = app.state.constraints.length;
    app.tool('rect');
    app.state.rectMode = RECT_MODES.CENTER;
    const ctr = S(260, 120);
    const cor = S(340, 220);
    app.click(ctr.x, ctr.y);
    app.click(cor.x, cor.y);

    const added = app.state.constraints.slice(beforeCons);
    const pol1 = added.filter((c) => norm(c.type) === 'pointonline' && c.shape === baseLine.id);
    const pol2 = added.filter((c) => norm(c.type) === 'pointonline' && c.shape === secondLine.id);
    assert.strictEqual(pol1.length, 1, `center rect: center snapped on baseLine gets 1 pointOnLine (got ${JSON.stringify(added)})`);
    assert.strictEqual(pol2.length, 1, `center rect: corner snapped on secondLine gets 1 pointOnLine (got ${JSON.stringify(added)})`);
  }

  // 6. 3-point rect: first, second, and third corner snaps on lines
  {
    const { S, baseLine } = await freshWithLine();
    const beforeCons = app.state.constraints.length;
    app.tool('rect');
    app.state.rectMode = RECT_MODES.THREE_POINT;
    const p1 = S(240, 120), p2 = S(360, 120), p3 = S(360, 200);
    app.click(p1.x, p1.y);
    app.click(p2.x, p2.y);
    app.click(p3.x, p3.y);
    const added = app.state.constraints.slice(beforeCons);
    const pols = added.filter((c) => norm(c.type) === 'pointonline' && c.shape === baseLine.id);
    assert.strictEqual(pols.length, 2, `3pt rect: both corner 1 and corner 2 on baseLine get pointOnLine (got ${JSON.stringify(added)})`);
  }

  // 7. 2-point rect first corner on circle & arc rim -> same pointOnLine as Line tool
  {
    const { S } = await freshWithLine();
    // Circle at (300, 260) radius 50 -> rim at (350, 260)
    app.tool('circle');
    app.click(S(300, 260).x, S(300, 260).y);
    app.click(S(350, 260).x, S(350, 260).y);
    app.esc();
    const circ = app.state.shapes.find((s) => s.type === 'circle');
    const before = app.state.constraints.length;
    app.tool('rect');
    app.state.rectMode = RECT_MODES.TWO_POINT;
    app.click(S(300, 210).x, S(300, 210).y); // top of circle rim (not joint (350, 260))
    app.click(S(380, 300).x, S(380, 300).y);
    const rectLines = app.state.shapes.filter((s) => s.type === 'line' && s.groupId && s.groupId.startsWith('rect_'));
    const c1Id = rectLines[0].joints[0];
    const polCirc = app.state.constraints.slice(before).filter((c) => norm(c.type) === 'pointonline' && c.joint === c1Id && c.shape === circ.id);
    assert.strictEqual(polCirc.length, 1, '2pt rect on circle rim gets pointOnLine');
  }

  console.log('rect-snap-constraint-867-node: ok');
} catch (e) {
  failed = e;
} finally {
  if (app) await app.close();
}
if (failed) {
  console.error(failed);
  process.exit(1);
}
