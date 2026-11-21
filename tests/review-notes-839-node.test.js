// tests/review-notes-839-node.test.js — TASK 839 item 2: the 3D Review's info lines are assembled in ONE place (cut-plan.js planNotes). Each operation's own lines
// stay its own; a line that says the same for every operation ("Drawn for a 0.125 in bit: a smaller bit leaves ridges", "Depth passes: set Pass Depth or AutoPass
// on the Origin", "AutoPass runs back along it on the next pass", "Gaps: cut the side against the part; the return leg is optional") is written once. The card's
// note (clearingNoteItems / holdNoteItems for one operation) keeps every line.
import assert from 'node:assert';
import { polyArea } from '#core/loop-geometry.js';
import SettingsManager from '#core/settings-manager.js';
import { loopsWithPolygons, planNotes, clearingNoteItems, clearingSummary, holdNoteItems, holdSummary, planOwnedLoops, OPEN_PATH_AUTOPASS_NOTE } from '../apps/shaper/src/cut-plan.js';
import { defaultCutRecord } from '../apps/shaper/src/shaper.js';
import { withPlan } from './helpers/plan-v2.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

SettingsManager.set('DOC_UNIT', 'in');
const IN = 25.4, BIT = 0.125 * IN;
// the owner's plate, in short: a 12 x 8 in outline (Outside, tabs), a 1.5 x 1.2 in pocket (spiral) and a 1.4 x 1 in pocket (raster)
function rects(list) {
  const joints = new Map(), shapes = [];
  list.forEach(([x, y, w, h], k) => {
    const pts = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([a, b]) => [a * IN, b * IN]);
    pts.forEach(([px, py], i) => joints.set(`r${k}j${i}`, { x: px, y: py }));
    for (let i = 0; i < 4; i++) shapes.push({ id: `r${k}s${i}`, type: 'line', joints: [`r${k}j${i}`, `r${k}j${(i + 1) % 4}`] });
  });
  return { joints, shapes, constraints: [], groups: [], profiles: [] };
}
const st = rects([[0, 0, 12, 8], [2.1, 3.4, 1.5, 1.2], [8.4, 3.5, 1.4, 1.0], [5, 1, 1.5, 1.2]]);
const { loops, loopPolys } = loopsWithPolygons(st);
const [plate, p1, p3, p2] = loops.sort((a, b) => Math.abs(polyArea(loopPolys[b.id])) - Math.abs(polyArea(loopPolys[a.id]))).map((l) => `loop:${l.id}`);
const rec = (over) => ({ ...defaultCutRecord(), toolDia: BIT, ...over });
const OUTSIDE = rec({ cutType: 'exterior', cutDepth: 0.75 * IN, holdPart: 'tabs', tabCount: 6, tabWidth: 0.375 * IN, holdThickness: 0.0625 * IN });
const SPIRAL = rec({ cutType: 'pocket', cutDepth: 0.25 * IN, clearing: 'linked', stepover: 40 });
const RASTER = rec({ cutType: 'pocket', cutDepth: 0.1 * IN, clearing: 'raster', stepover: 40 });
const GENERIC = ['Drawn for a 0.125 in bit: a smaller bit leaves ridges', 'Depth passes: set Pass Depth or AutoPass on the Origin', OPEN_PATH_AUTOPASS_NOTE];
const count = (lines, t) => lines.filter((l) => l === t).length;

// the owner's case: two pockets (spiral, raster) + the Outside with tabs
{
  const lines = withPlan(st, [[plate, OUTSIDE], [p1, SPIRAL], [p3, RASTER]], () => planNotes(st));
  for (const t of GENERIC) eq(count(lines, t), 1, `"${t}" is written once (two pockets)`);
  ok(lines.some((l) => /^Pocket: spiral, /.test(l)) && lines.some((l) => /^Pocket: raster 0°: /.test(l)), 'each pocket keeps its own first line');
  eq(count(lines, 'Gaps: cut the side against the part; the return leg is optional'), 1, 'the Outside\'s gaps line: once');
  ok(/^Outside: 6 tabs, /.test(lines[0]), 'the Outside\'s own line first (hold, then clearing: the order of before)');
  // the order of before: each pocket's own line, then (the first time) the lines every pocket shares
  const i1 = lines.findIndex((l) => /^Pocket: spiral/.test(l)), i2 = lines.findIndex((l) => /^Pocket: raster/.test(l));
  ok(i1 < i2 && lines.slice(i1 + 1, i2).includes(GENERIC[0]), 'the shared lines follow the first pocket\'s line');
  // the card (one operation) keeps every line
  const owned = withPlan(st, [[plate, OUTSIDE], [p1, SPIRAL], [p3, RASTER]], () => planOwnedLoops(st, loops, loopPolys));
  const card = withPlan(st, [[plate, OUTSIDE], [p1, SPIRAL], [p3, RASTER]], () => clearingNoteItems(SPIRAL, clearingSummary(p1, SPIRAL, st, loops, loopPolys, owned)).map((i) => i.text));
  for (const t of GENERIC) eq(count(card, t), 1, `the spiral pocket's card still says "${t}"`);
  const hold = withPlan(st, [[plate, OUTSIDE]], () => holdNoteItems(OUTSIDE, holdSummary(plate, OUTSIDE, st, loops, loopPolys, new Set())).map((i) => i.text));
  eq(count(hold, 'Gaps: cut the side against the part; the return leg is optional'), 1, 'the Outside\'s card still says the gaps line');
}

// two EQUAL pockets: their own lines stay two (an operation's own line is never merged), the shared ones once
{
  const lines = withPlan(st, [[p1, SPIRAL], [p2, SPIRAL]], () => planNotes(st));
  eq(lines.filter((l) => /^Pocket: spiral, /.test(l)).length, 2, 'two equal pockets: two own lines');
  for (const t of GENERIC) eq(count(lines, t), 1, `two equal pockets: "${t}" once`);
}

// a different bit is a different line: both written
{
  const lines = withPlan(st, [[p1, SPIRAL], [p3, { ...RASTER, toolDia: 0.25 * IN }]], () => planNotes(st));
  ok(lines.includes('Drawn for a 0.125 in bit: a smaller bit leaves ridges') && lines.includes('Drawn for a 0.25 in bit: a smaller bit leaves ridges'), 'two bits: each bit\'s line');
  eq(count(lines, 'Depth passes: set Pass Depth or AutoPass on the Origin'), 1, 'two bits: the depth passes line once');
}

// one pocket: unchanged
{
  const lines = withPlan(st, [[p1, SPIRAL]], () => planNotes(st));
  eq(lines.slice(1, 4), GENERIC, 'one pocket: its lines as before (then its leftover: the sharp corners of the rectangle)');
  ok(lines.slice(4).every((l) => /^Leftover: |^Sharp inside corners/.test(l)), 'one pocket: the leftover lines follow');
}

console.log(`review-notes-839-node: ok (${checks} checks)`);
