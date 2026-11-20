// tests/export-own-attrs-802-node.test.js — TASK 802: every exported element carries its OWN cut attributes; no <g> carries a shaper:* attribute.
// MEASURED at the Origin: a Spiral pocket (Loop on / off) written with its on-line paths under a <g fill stroke shaper:cutType shaper:cutDepth ...> came up
// "unset" on the machine (the Origin reads the cut from each element, as Shaper Studio writes it). The page's own call (export-payload.js shaperSvgOf,
// the download AND the preview copy) on one design: a Spiral pocket Loop ON, a Spiral pocket Loop OFF, two pockets of the same depth and bit, and a part
// held by tabs: no <g>, and every <path> / <circle> has shaper:cutType, shaper:toolDia, shaper:cutOffset (and shaper:cutDepth when the cut has a depth).
import assert from 'node:assert';
import { findLoops } from '#core/loop-finder.js';
import { loopPolygon } from '#core/loop-geometry.js';
import { planEntries, keyOf } from '../apps/shaper/src/cut-plan.js';
import { shaperSvgOf } from '../apps/shaper/src/export-payload.js';
import { exportShaperSVG } from '#core/shaper-export.js';
import { exportEncoding } from '../apps/shaper/src/shaper.js';
import { V2_PLAN } from './helpers/plan-v2.js'; // TASK S1: the test's v2 document of the plan, loaded through applyShaperDoc

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const BIT = 6;
function rectLoops(origins) { // one closed rectangle per origin, 80 x 50 mm
  const joints = new Map(), shapes = [];
  origins.forEach(([x, y], r) => {
    const pts = [[x, y], [x + 80, y], [x + 80, y + 50], [x, y + 50]];
    pts.forEach((p, i) => { joints.set(`j${r}_${i}`, { x: p[0], y: p[1] }); shapes.push({ id: `s${r}_${i}`, type: 'line', joints: [`j${r}_${i}`, `j${r}_${(i + 1) % 4}`] }); });
  });
  return { joints, shapes, constraints: [], groups: [], profiles: [] };
}
const st = rectLoops([[0, 0], [120, 0], [240, 0], [360, 0], [0, 80]]);
const loops = findLoops(st);
const by = new Map(st.shapes.map((s) => [s.id, s]));
const loopAt = (x, y) => loops.find((l) => { const p = loopPolygon(l, st, by); return Math.min(...p.map((q) => q.x)) === x && Math.min(...p.map((q) => q.y)) === y; });
const POCKET = { cutType: 'pocket', cutDepth: 6, cutOffset: 0, toolDia: BIT, cutterShape: 'endmill', stepover: 40, finishAllowance: 0.5, rasterAngle: 0 };
V2_PLAN.clear();
V2_PLAN.set(keyOf('loop', loopAt(0, 0).id), { ...POCKET, clearing: 'linked', loop: true });   // Spiral, Loop on
V2_PLAN.set(keyOf('loop', loopAt(120, 0).id), { ...POCKET, clearing: 'linked', loop: false }); // Spiral, Loop off
V2_PLAN.set(keyOf('loop', loopAt(240, 0).id), { ...POCKET });                                  // two pockets of the same depth and bit
V2_PLAN.set(keyOf('loop', loopAt(360, 0).id), { ...POCKET });
V2_PLAN.set(keyOf('loop', loopAt(0, 80).id), { cutType: 'exterior', cutDepth: 18, cutOffset: 0, toolDia: BIT, holdPart: 'tabs', tabCount: 'auto', tabWidth: 10, holdThickness: 2 }); // tabs

const files = { download: shaperSvgOf(st, planEntries()), preview: shaperSvgOf(st, planEntries(), { preview: true }) };
for (const [name, svg] of Object.entries(files)) {
  eq(/<g[\s>]/.test(svg), false, `${name}: no <g> at all`);
  eq(/<g[^>]*shaper:/.test(svg), false, `${name}: no <g> carries a shaper:* attribute`);
  const els = [...svg.matchAll(/<(path|circle|polygon)\b[^>]*>/g)].map((m) => m[0]);
  ok(els.length >= 8, `${name}: the design writes many elements (${els.length})`);
  for (const el of els) {
    ok(/ shaper:cutType="[^"]+"/.test(el), `${name}: element carries its own shaper:cutType: ${el.slice(0, 160)}`);
    ok(/ shaper:toolDia="[^"]+"/.test(el), `${name}: element carries its own shaper:toolDia: ${el.slice(0, 160)}`);
    ok(/ shaper:cutOffset="[^"]+"/.test(el), `${name}: element carries its own shaper:cutOffset: ${el.slice(0, 160)}`);
    ok(/ fill="[^"]+"/.test(el), `${name}: element carries its own fill: ${el.slice(0, 160)}`);
    if (!/shaper:cutType="guide"/.test(el)) ok(/ shaper:cutDepth="[^"]+"/.test(el), `${name}: element carries its own shaper:cutDepth: ${el.slice(0, 160)}`);
  }
}
// the Spiral's on-line paths in particular (the ones the Origin showed "unset"): each with its own online type, depth and bit
const online = [...files.download.matchAll(/<path\b[^>]*shaper:cutType="online"[^>]*>/g)].map((m) => m[0]);
ok(online.length >= 2, `the Spiral pockets' on-line paths are written (${online.length})`);
ok(online.every((el) => / shaper:cutDepth="6\.000 mm"/.test(el) && / stroke="#7F7F7F"/.test(el)), 'each on-line path: its own depth and stroke');
// the one exporter with no option: the same flat file
eq(exportShaperSVG({ state: st, entries: planEntries(), encoding: exportEncoding(), docUnit: 'mm', options: {}, loopPolys: Object.fromEntries(loops.map((l) => [l.id, loopPolygon(l, st, by)])) }).includes('<g'), false, 'exportShaperSVG with no options: flat');
V2_PLAN.clear();
console.log(`export-own-attrs-802-node: ok (${checks} checks)`);
