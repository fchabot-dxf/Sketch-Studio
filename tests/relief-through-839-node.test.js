// tests/relief-through-839-node.test.js — TASK 839 item 3: a THROUGH Inside cut frees the material it encloses, so the 3D Review shows an OPEN hole (TASK 459's
// declared rule, tests/relief-model.test.js (1)), not a kerf ring with its disc standing. The owner's case: a 0.25 in Pocket round a hole an Inside cut takes
// through the board (a counterbore) was drawn as a RAISED BOSS with a hole (the pocket keeps the hole as an island; the island's disc stood at full height).
// The pocket plan (its island) and the exported file are unchanged: only the 3D model. Held (tabs / onion skin) and partial-depth Inside cuts keep their
// disc; a part cut Outside inside the freed area stays standing (a nested part); a programmed pocket's wall is the pocket's, not a cut-out.
import assert from 'node:assert';
import { buildRelief } from '#core/relief-model.js';
import { polyArea } from '#core/loop-geometry.js';
import { regionsArea } from '#core/plot/clip.js';
import { loopsWithPolygons, planReliefItems } from '../apps/shaper/src/cut-plan.js';
import { defaultCutRecord } from '../apps/shaper/src/shaper.js';
import { withPlan } from './helpers/plan-v2.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b} (tol ${tol})`); checks++; };

// T = a 3/4 in depth as the card types it (0.75 x 25.4 = 19.049999999999997 mm); BOARD = the 3/4 in board as the Stock declares it (19.05 mm): a cut at
// the board's thickness is THROUGH (the owner's case: the plate typed in inches)
const IN = 25.4, T = 0.75 * IN, BOARD = 19.05, BIT = 0.125 * IN;
// drawn circles (exact in Node) on a board given by `bounds`
function circles(list) {
  const joints = new Map(), shapes = [];
  list.forEach(([cx, cy, r], k) => { joints.set(`c${k}o`, { x: cx, y: cy }); shapes.push({ id: `c${k}`, type: 'circle', joints: [`c${k}o`], radius: r }); });
  return { joints, shapes, constraints: [], groups: [], profiles: [] };
}
const loopIds = (st) => { // the loops largest first
  const { loops, loopPolys } = loopsWithPolygons(st);
  return loops.sort((a, b) => Math.abs(polyArea(loopPolys[b.id])) - Math.abs(polyArea(loopPolys[a.id]))).map((l) => `loop:${l.id}`);
};
const ptIn = (g, x, y) => { let c = false; for (let i = 0, j = g.length - 1; i < g.length; j = i++) { if ((g[i][1] > y) !== (g[j][1] > y) && x < (g[j][0] - g[i][0]) * (y - g[i][1]) / (g[j][1] - g[i][1]) + g[i][0]) c = !c; } return c; };
const inRegions = (rs, x, y) => rs.some((g) => ptIn(g.outer, x, y) && !g.holes.some((h) => ptIn(h, x, y)));
// the depth the model cuts at (x, y): 0 = the top face, BOARD = through
const depthAt = (rel, x, y) => { let d = 0; for (const l of rel.levels) if (inRegions(l.regions, x, y)) d = Math.max(d, l.depth); return d; };
const bounds = { minX: 0, maxX: 100, minY: 0, maxY: 100 };
const relief = (st, plan) => buildRelief({ stock: { thickness: BOARD, margin: 0 }, bounds, items: withPlan(st, plan, () => planReliefItems(st)) });
const rec = (over) => ({ ...defaultCutRecord(), toolDia: BIT, ...over });

// ── the owner's counterbore: a 1.5 in Pocket 0.25 in deep round a 0.5 in hole cut Inside through ──
{
  const st = circles([[50, 50, 0.75 * IN], [50, 50, 0.25 * IN]]);
  const [outer, hole] = loopIds(st);
  for (const clearing of ['freehand', 'linked', 'raster']) {
    const rel = relief(st, [[outer, rec({ cutType: 'pocket', cutDepth: 0.25 * IN, clearing })], [hole, rec({ cutType: 'interior', cutDepth: T })]]);
    eq(depthAt(rel, 50, 50), BOARD, `${clearing} pocket round a through hole: the hole's middle is cut THROUGH (an open hole: the disc drops out), not standing`);
    eq(depthAt(rel, 50 + 0.24 * IN, 50), BOARD, `${clearing}: just inside the hole's line: through`);
    eq(depthAt(rel, 50 + 0.5 * IN, 50), 0.25 * IN, `${clearing}: the pocket's floor at 0.25 in (the counterbore)`);
    eq(depthAt(rel, 50 + 0.8 * IN, 50), 0, `${clearing}: outside the pocket: the top face`);
    const thr = rel.levels.find((l) => l.through);
    near(regionsArea(thr.regions), Math.PI * (0.25 * IN) ** 2, 0.02 * Math.PI * (0.25 * IN) ** 2, `${clearing}: the through region is the whole hole`);
  }
}

// ── a plain through hole (no pocket): an open hole, top AND bottom lose its whole area ──
{
  const st = circles([[50, 50, 10]]);
  const [hole] = loopIds(st);
  const rel = relief(st, [[hole, rec({ cutType: 'interior', cutDepth: T })]]);
  eq(depthAt(rel, 50, 50), BOARD, 'a through Inside cut: its middle is open');
  near(rel.stats.areas.top, 100 * 100 - Math.PI * 100, 2, 'the top face loses the whole hole');
  near(rel.stats.areas.bottom, 100 * 100 - Math.PI * 100, 2, 'the bottom face loses the whole hole');
  // depth unset = through (TASK 459): also open, with its label
  const un = relief(st, [[hole, rec({ cutType: 'interior', cutDepth: 'unset' })]]);
  eq([depthAt(un, 50, 50), un.marks.filter((m) => m.kind === 'depth-unset').length], [BOARD, 1], 'a depth-unset Inside (through): open, its label kept');
}

// ── unchanged: a partial-depth Inside cut (a groove; nothing drops out), a held one (tabs / onion skin keep the disc) ──
{
  const st = circles([[50, 50, 20]]);
  const [hole] = loopIds(st);
  const partial = relief(st, [[hole, rec({ cutType: 'interior', cutDepth: 5 })]]);
  eq(depthAt(partial, 50, 50), 0, 'a 5 mm Inside groove: its disc stands at the top');
  for (const holdPart of ['tabs', 'skin']) {
    const held = relief(st, [[hole, rec({ cutType: 'interior', cutDepth: T, holdPart, tabCount: 4, tabWidth: 6, holdThickness: 2 })]]);
    eq(depthAt(held, 50, 50), 0, `a through Inside cut held by ${holdPart}: the disc is held, it stands`);
  }
}

// ── a part cut Outside INSIDE a through hole stays (a nested part); its own through hole opens ──
{
  const st = circles([[50, 50, 30], [50, 50, 15], [50, 50, 4]]);
  const [hole, part, partHole] = loopIds(st);
  const rel = relief(st, [[hole, rec({ cutType: 'interior', cutDepth: T })], [part, rec({ cutType: 'exterior', cutDepth: T })], [partHole, rec({ cutType: 'interior', cutDepth: T })]]);
  eq(depthAt(rel, 50 + 25, 50), BOARD, 'the ring between the hole and the nested part drops out');
  eq(depthAt(rel, 50 + 10, 50), 0, 'the nested part (cut Outside) stands at the top');
  eq(depthAt(rel, 50, 50), BOARD, 'the nested part\'s own through hole is open');
}

// ── an Outside cut's own holes (one profile operation) are cut Inside: they open too ──
{
  const st = circles([[50, 50, 30], [50, 50, 8]]);
  const [outer, hole] = loopIds(st);
  const rel = relief(st, [[outer, rec({ cutType: 'exterior', cutDepth: T })], [hole, rec({ cutType: 'interior', cutDepth: T })]]);
  eq([depthAt(rel, 50, 50), depthAt(rel, 50 + 20, 50)], [BOARD, 0], 'a plate with a through hole: the hole opens, the plate stands');
}

// ── a programmed pocket cut through: its islands are the pocket's (they stay), not a cut-out ──
{
  const st = circles([[50, 50, 25], [50, 50, 6]]);
  const [outer] = loopIds(st);
  const rel = relief(st, [[outer, rec({ cutType: 'pocket', cutDepth: T, clearing: 'linked' })]]);
  eq(depthAt(rel, 50, 50), 0, 'a through programmed pocket: its island stands');
  eq(depthAt(rel, 50 + 15, 50), BOARD, 'a through programmed pocket: its area is cut through');
}

console.log(`relief-through-839-node: ok (${checks} checks)`);
