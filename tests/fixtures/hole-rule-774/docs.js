// tests/fixtures/hole-rule-774/docs.js — TASK 774 item 7: the saved Shaper documents of the hole-rule test (tests/hole-rule-774-node.test.js), declared
// ONCE as plain data (no import): the test builds them on today's code, and the one-off baseline generator built them on the code BEFORE commit 27c00a4
// (a temporary worktree at 27c00a4^) to write tests/fixtures/hole-rule-774/<case>.svg, the exports those documents had when they were saved.
//   islands      a Pocket on a face drawn in Sketch 1 with two islands drawn in Sketch 2 (the review finding's case)
//   same-sketch  the same, the islands in Sketch 1 (the rule never changed it)
//   plate        an Outside plate (Sketch 1) with a hole drawn in Sketch 2 that has no record of its own
//   plate-owned  an Outside plate (Sketch 1) with two holes in Sketch 2: one with its own Inside record (TASK 711: cut by that record only), one without
//   own-island   a Pocket (Sketch 1) whose island (Sketch 2) has its own Pocket record (cannot keep its hole: a combined profile would take the island's record)
// A plan target is named by one of its loop's edges ({ edge }); the caller turns it into the loop id (findLoops).

const rect = (st, name, [x0, y0], [x1, y1], sketchId) => {
  const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  pts.forEach(([x, y], i) => st.joints.set(`${name}j${i}`, { x, y, sketchId }));
  pts.forEach((_, i) => st.shapes.push({ id: `${name}s${i}`, type: 'line', joints: [`${name}j${i}`, `${name}j${(i + 1) % 4}`], sketchId }));
};

const POCKET = { cutType: 'pocket', cutDepth: 6, cutOffset: 0, toolDia: 6.35 };
const OUTSIDE = { cutType: 'exterior', cutDepth: 19, cutOffset: 0, toolDia: 6.35 };
const INSIDE = { cutType: 'interior', cutDepth: 19, cutOffset: 0, toolDia: 3.175 };
const SHALLOW = { cutType: 'pocket', cutDepth: 2, cutOffset: 0, toolDia: 3.175 };

export const HOLE_RULE_CASES = ['islands', 'same-sketch', 'plate', 'plate-owned', 'own-island'];

/** { state, plan: [[{ edge }, rec], ...] } of a case (a fresh copy each call). */
export function holeRuleDoc(name) {
  const st = { joints: new Map(), shapes: [], constraints: [], profiles: [] };
  const islandSketch = name === 'same-sketch' ? 'sketch-1' : 'sketch-2';
  rect(st, 'O', [0, 0], [100, 80], 'sketch-1');
  rect(st, 'I', [10, 10], [30, 30], islandSketch);
  rect(st, 'K', [60, 40], [80, 60], islandSketch);
  const plan = {
    islands: [[{ edge: 'Os0' }, POCKET]],
    'same-sketch': [[{ edge: 'Os0' }, POCKET]],
    plate: [[{ edge: 'Os0' }, OUTSIDE]],
    'plate-owned': [[{ edge: 'Os0' }, OUTSIDE], [{ edge: 'Is0' }, INSIDE]],
    'own-island': [[{ edge: 'Os0' }, POCKET], [{ edge: 'Is0' }, SHALLOW]],
  }[name];
  if (!plan) throw new Error('unknown hole-rule case ' + name);
  if (name === 'plate') { st.shapes = st.shapes.filter((s) => !s.id.startsWith('K')); for (const k of [...st.joints.keys()]) if (k.startsWith('K')) st.joints.delete(k); }
  return { state: st, plan: plan.map(([t, rec]) => [t, { ...rec }]) };
}
