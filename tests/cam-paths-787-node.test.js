// tests/cam-paths-787-node.test.js — TASK 787: Shaper CAM path fixes from bug hunt 785 (no browser).
//  1. (hunt bug 2: the inside lead-in and the part's holes) TASK 836: removed with the lead-in.
//  2. (hunt bug 3) Outside / Inside TABS with a cut offset: the tab the Origin leaves (each gap strip is an Inside cut it offsets by the bit radius + the
//     record's offset ALL ROUND, its end caps too) is the typed width for offsets 0, -0.5 r, -r, -1.5 r, or the hold is refused with its note (+r).
//  3. (hunt bug 5) the 3D model with a programmed pocket's start mark beside a depth-unset cut: no crash, the depth-unset label is its own mark.
//  4. (hunt bug 7a) a tight Raster / Morphed spiral pocket (nothing to clear inside the finish allowance) with Loop on keeps its Loop (the finish turn alone,
//     as the Spiral) and its start mark. (7b) a depth-UNSET programmed pocket with Loop off is not cut through in 3D: like any depth-unset pocket, not shown.
//  5. (hunt bug 13) a `positive` stepped field with no min (the bit diameter) keeps its rule: − stops at the smallest positive multiple of the step (TASK 836: its
//     Lead-in Radius part, the one field with a min AND `positive`, removed with the lead-in).
import assert from 'node:assert';
import { deriveCuts } from '#core/stepped-cut.js';
import { HOLD_PART } from '#core/hold-part.js';
import { polyArea } from '#core/loop-geometry.js';
import { exportShaperSVG } from '#core/shaper-export.js';
import { offsetPolygonRound } from '#core/plot/clip.js';
import { buildRelief } from '#core/relief-model.js';
import { loopsWithPolygons, planReliefItems, holdNoteItems } from '../apps/shaper/src/cut-plan.js';
import { effectiveCutRecord, defaultCutRecord, exportEncoding } from '../apps/shaper/src/shaper.js';


import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { worldToScreen } from '#ui/coords.js';
import SettingsManager from '#core/settings-manager.js';
import { V2_PLAN, withPlan } from './helpers/plan-v2.js'; // TASK S1: the test's v2 document of the plan, loaded through applyShaperDoc

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b} (tol ${tol})`); checks++; };

// drawn parts (lines / circles: exact in Node)
function partState(rects, circles = []) {
  const joints = new Map(), shapes = [];
  rects.forEach(([x, y, w, h], k) => {
    const pts = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    pts.forEach(([px, py], i) => joints.set(`r${k}j${i}`, { x: px, y: py }));
    for (let i = 0; i < 4; i++) shapes.push({ id: `r${k}s${i}`, type: 'line', joints: [`r${k}j${i}`, `r${k}j${(i + 1) % 4}`] });
  });
  circles.forEach(([cx, cy, r], k) => { joints.set(`c${k}o`, { x: cx, y: cy }); shapes.push({ id: `c${k}`, type: 'circle', joints: [`c${k}o`], radius: r }); });
  return { joints, shapes, constraints: [], groups: [], profiles: [] };
}
const sortedLoops = (st) => {
  const { loops, loopPolys } = loopsWithPolygons(st);
  loops.sort((a, b) => Math.abs(polyArea(loopPolys[b.id])) - Math.abs(polyArea(loopPolys[a.id])));
  return { loops, loopPolys };
};
const rec = (over) => effectiveCutRecord({ ...defaultCutRecord(), ...over });

// ── 2. (bug 3) tabs keep their typed width whatever the cut offset ──
// The measure is the Origin's: each gap strip is written as an INSIDE cut, which the Origin offsets inward by the bit radius + the record's offset all
// round (its end caps too). Per tab, along the outline at the tab's centre: the full-depth cut ends where the bit-centre path of the strip on either side
// reaches (its cap, +- the bit radius); the tab is the wood between.
{
  const BIT = 6.35, r = BIT / 2, WIDTH = 10, SW = BIT + HOLD_PART.stripExtraMm;
  const st = partState([[0, 0, 200, 100]]);
  const { loops, loopPolys } = sortedLoops(st);
  const target = { kind: 'loop', id: loops[0].id };
  const tabGaps = (cutType, off) => {
    const cuts = deriveCuts(target, rec({ cutType, cutDepth: 10, cutOffset: off, toolDia: BIT, holdPart: 'tabs', tabCount: 4, tabWidth: WIDTH, holdThickness: 2 }), st, loops, loopPolys, new Set());
    const pass = cuts.find((c) => c.hold && c.hold.role !== 'strip');
    if (pass.hold.role === 'refused') return { refused: pass.hold.error, hold: pass.hold };
    const centres = cuts.filter((c) => c.hold && c.hold.role === 'strip')
      .map((c) => offsetPolygonRound([...c.hold.outline.map((q) => [q.x, q.y]), [c.hold.outline[0].x, c.hold.outline[0].y]], -(r + off), 0.005))
      .flat().map((ring) => ring.map(([x, y]) => ({ x, y })));
    const gaps = pass.hold.marks.map((m) => {
      const [ax, ay, bx, by] = /^M (\S+) (\S+) L (\S+) (\S+)$/.exec(m).slice(1).map(Number); // a tab on a straight side
      const c = { x: (ax + bx) / 2, y: (ay + by) / 2 }, len = Math.hypot(bx - ax, by - ay), t = { x: (bx - ax) / len, y: (by - ay) / len };
      const out = { x: Math.sign(c.x - 100) * (Math.abs(c.x - 100) > 99 ? 1 : 0), y: Math.sign(c.y - 50) * (Math.abs(c.y - 50) > 49 ? 1 : 0) }; // away from the rectangle's middle
      const waste = cutType === 'exterior' ? out : { x: -out.x, y: -out.y };
      let lo = -Infinity, hi = Infinity;
      for (const ring of centres) for (const q of ring) {
        const u = (q.x - c.x) * t.x + (q.y - c.y) * t.y, v = (q.x - c.x) * waste.x + (q.y - c.y) * waste.y;
        if (v < -(r + Math.abs(off) + 1) || v > SW + r + Math.abs(off) + 1 || Math.abs(u) > WIDTH + 2 * SW + 20) continue; // only the strips at this tab
        if (u > 0) hi = Math.min(hi, u); else lo = Math.max(lo, u);
      }
      return (hi - r) - (lo + r);
    });
    return { gaps, hold: pass.hold };
  };
  for (const cutType of ['exterior', 'interior']) {
    for (const k of [0, -0.5, -1, -1.5]) {
      const res = tabGaps(cutType, k * r);
      ok(!res.refused, `${cutType} offset ${k} r: tabs not refused (${res.refused})`);
      eq(res.gaps.length, 4, `${cutType} offset ${k} r: 4 tabs`);
      for (const g of res.gaps) near(g, WIDTH, 0.01, `${cutType} offset ${k} r: the tab the Origin leaves is the typed width`);
      eq(res.hold.width, WIDTH, `${cutType} offset ${k} r: the card's tab width is the typed width`);
    }
    // +r: the bit + offset does not fit in a strip: refused, the card says why
    const pr = tabGaps(cutType, r);
    eq(pr.refused, 'strip', `${cutType} offset +r: refused (the offset is wider than the strip allows)`);
    ok(/refused: .*offset/.test(holdNoteItems({ cutType, holdPart: 'tabs' }, pr.hold)[0].text), `${cutType} offset +r: the card's note names the offset`);
  }
  // an offset so negative the tabs no longer fit (each written tab is width - 2 x offset): refused with its note (not cut with narrower tabs)
  {
    const small = partState([[0, 0, 25, 20]]); // sides 25 and 20: a 10 mm tab fits (needs 10 + 2 r = 16.35), at -6 mm each written tab is 22 mm (needs 28.35)
    const sl = sortedLoops(small);
    const cuts = deriveCuts({ kind: 'loop', id: sl.loops[0].id }, rec({ cutType: 'exterior', cutDepth: 10, cutOffset: -6, toolDia: BIT, holdPart: 'tabs', tabCount: 4, tabWidth: WIDTH, holdThickness: 2 }), small, sl.loops, sl.loopPolys, new Set());
    const hold = cuts.find((c) => c.hold && c.hold.role !== 'strip').hold;
    eq([hold.role, hold.error], ['refused', 'offset'], 'offset -6 on a 25 x 20 part: refused (no room for the tabs with this offset)');
    ok(/offset/.test(holdNoteItems({ cutType: 'exterior', holdPart: 'tabs' }, hold)[0].text), 'the note names the offset');
    eq(cuts.filter((c) => c.hold && c.hold.role === 'strip').length, 0, 'refused: no gap strips written');
    // the same part at offset 0 takes its tabs
    const z = deriveCuts({ kind: 'loop', id: sl.loops[0].id }, rec({ cutType: 'exterior', cutDepth: 10, cutOffset: 0, toolDia: BIT, holdPart: 'tabs', tabCount: 4, tabWidth: WIDTH, holdThickness: 2 }), small, sl.loops, sl.loopPolys, new Set());
    eq(z.find((c) => c.hold && c.hold.role !== 'strip').hold.role, 'pass', 'the same part at offset 0 takes its tabs');
  }
  // an offset of half the tab width or more leaves no tab at all: refused, the note says so
  {
    const cuts = deriveCuts(target, rec({ cutType: 'exterior', cutDepth: 10, cutOffset: 0.5, toolDia: BIT, holdPart: 'tabs', tabCount: 4, tabWidth: 1, holdThickness: 2 }), st, loops, loopPolys, new Set());
    const hold = cuts.find((c) => c.hold && c.hold.role !== 'strip').hold;
    eq([hold.role, hold.error, hold.written], ['refused', 'offset', 0], 'offset 0.5 on a 1 mm tab: refused (no tab would stay)');
    ok(/offset is half the 1 mm tab width or more/.test(holdNoteItems({ cutType: 'exterior', holdPart: 'tabs' }, hold)[0].text), 'the note says the offset leaves no tab');
  }
}

// ── 3. (bug 5) the 3D model: a pocket's start mark beside a depth-unset cut ──
{
  const POCKET = { cutType: 'pocket', cutDepth: 5, toolDia: 3.175, clearing: 'linked', stepover: 40, finishAllowance: 0.5 };
  const planOf = (st, recs) => { const { loops, loopPolys } = sortedLoops(st); return new Map(recs.map((r, i) => [`loop:${loops[i].id}`, { ...defaultCutRecord(), ...r }])); };
  // the hunt's case: a 10 x 10 programmed pocket (start mark near its middle) and a 2 x 2 Outside cut, depth unset, 7.6 mm away
  for (const [name, st, other] of [
    ['pocket + an Outside cut beside it', partState([[0, 0, 10, 10], [10.5, 4, 2, 2]]), { cutType: 'exterior', cutDepth: 'unset', toolDia: 3.175 }],
    ['pocket + an Inside cut on a hole near its start', partState([[0, 0, 30, 30]], [[15, 15, 3]]), { cutType: 'interior', cutDepth: 'unset', toolDia: 3.175 }],
  ]) {
    const plan = planOf(st, [POCKET, other]);
    const keys = [...plan.keys()];
    let rel = null, err = null;
    try { rel = buildRelief({ items: withPlan(st, plan, () => planReliefItems(st)) }); } catch (e) { err = e; }
    eq(err && String(err.stack || err), null, `${name}: the 3D model builds (no error)`);
    eq(rel.marks.map((m) => m.kind).sort(), ['depth-unset', 'pocket-start'], `${name}: the start mark and the depth-unset label are two marks`);
    eq(rel.marks.find((m) => m.kind === 'depth-unset').keys, [keys[1]], `${name}: the depth-unset label names its own cut only`);
    eq(rel.marks.find((m) => m.kind === 'pocket-start').key, keys[0], `${name}: the start mark is the pocket's`);
    ok(rel.levels.some((l) => !l.through && l.depth === 5), `${name}: the pocket is cut at its 5 mm depth`);
  }
  // two depth-unset cuts on one spot still share ONE label (the merge is unchanged)
  {
    const st = partState([[0, 0, 2, 2], [3, 0, 2, 2]]);
    const plan = planOf(st, [{ cutType: 'exterior', cutDepth: 'unset', toolDia: 3.175 }, { cutType: 'exterior', cutDepth: 'unset', toolDia: 3.175 }]);
    const rel = buildRelief({ items: withPlan(st, plan, () => planReliefItems(st)) });
    eq(rel.marks.length, 1, 'two Outside cuts 1 mm apart, both unset: one label');
    eq(rel.marks[0].keys.length, 2, 'the label names both cuts');
  }
}

// ── 4. (bug 7) a tight programmed pocket keeps its Loop and start mark; a depth-unset programmed pocket is not cut through in 3D ──
{
  // 7a: an 8 x 8 pocket, 6.35 mm bit, 1.5 mm allowance: r + a = 4.675 > 4 (nothing to clear inside the allowance), the finish turn fits (r = 3.175 < 4)
  const st = partState([[0, 0, 8, 8]]);
  const { loops, loopPolys } = sortedLoops(st);
  const target = { kind: 'loop', id: loops[0].id };
  const TIGHT = { cutType: 'pocket', cutDepth: 5, toolDia: 6.35, stepover: 40, finishAllowance: 1.5 };
  const cutsFor = (over) => deriveCuts(target, rec({ ...TIGHT, ...over }), st, loops, loopPolys, new Set());
  for (const clearing of ['linked', 'raster', 'morphed']) {
    // TASK 835e: Raster's finish is the Origin's native inside cut, Loop on or off: with nothing to clear its Loop on IS its Loop off (the wall alone)
    if (clearing === 'raster') { eq([cutsFor({ clearing, loop: true }), cutsFor({ clearing, loop: false })].map((cs) => cs.map((c) => c.clearing && c.clearing.role)), [['wall'], ['wall']], 'raster: nothing to clear: the wall as an Inside cut, Loop on or off (TASK 835e)'); continue; }
    const on = cutsFor({ clearing, loop: true });
    const loopsCut = on.filter((c) => c.kind === 'clearing');
    ok(loopsCut.length >= 1 && loopsCut.every((c) => c.clearing.role === 'loop' && c.centers[0].closed), `${clearing}, Loop on: the finish turn is cut as a closed loop`);
    eq(on.filter((c) => c.clearing && c.clearing.role === 'wall').length, 0, `${clearing}, Loop on: no separate wall cut`);
    const summary = loopsCut[loopsCut.length - 1].clearing.summary;
    eq([summary.loop, summary.loopRefused], [true, null], `${clearing}, Loop on: the plan says Loop (not dropped)`);
    const mark = on.find((c) => c.kind === 'mark');
    ok(mark, `${clearing}, Loop on: the start mark is written`);
    const p = mark.clearing.point, ring = loopsCut[0].centers[0].points;
    ok(ring.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 1e-9), `${clearing}, Loop on: the start mark is on the loop`);
    const svg = exportShaperSVG({ state: st, entries: [{ target, rec: { ...defaultCutRecord(), ...TIGHT, clearing, loop: true } }], encoding: exportEncoding(), docUnit: 'mm', options: {}, loopPolys });
    ok(/shaper:cutType="guide"/.test(svg) && /shaper:cutType="online"/.test(svg) && !/shaper:cutType="inside"/.test(svg), `${clearing}, Loop on: the file has the loop (on line) and the start mark (guide), no Inside wall`);
    // Loop off: unchanged (the wall as an Inside cut; nothing to clear, so no route and no start mark)
    const off = cutsFor({ clearing, loop: false });
    eq(off.map((c) => c.clearing && c.clearing.role), ['wall'], `${clearing}, Loop off: the wall alone, as before`);
  }

  // 7b: a depth-UNSET programmed pocket with Loop off: the 3D model treats it like any depth-unset pocket (not shown, never cut through)
  const big = partState([[0, 0, 60, 40]], [[30, 20, 5]]);
  const bl = sortedLoops(big);
  const keyOf = `loop:${bl.loops[0].id}`;
  const reliefOf = (r) => buildRelief({ items: withPlan(big, [[keyOf, { ...defaultCutRecord(), ...r }]], () => planReliefItems(big)), bounds: { minX: 0, maxX: 60, minY: 0, maxY: 40 } }); // the design's bounds (the app passes them): a board even when nothing is cut
  const freehand = reliefOf({ cutType: 'pocket', cutDepth: 'unset', toolDia: 6.35 });
  eq([freehand.levels.length, freehand.stats.unsetThrough.length], [0, 0], 'a depth-unset Freehand pocket: nothing cut, no through label (the reference)');
  ok(freehand.stats.skipped.every((s) => s.reason === 'no-depth'), 'a depth-unset Freehand pocket: not shown (no depth)');
  for (const clearing of ['linked', 'raster', 'morphed']) {
    for (const loop of [false, true]) {
      if (clearing === 'morphed') continue; // the Morphed spiral is refused on a pocket with an island (cut Freehand)
      const rel = reliefOf({ cutType: 'pocket', cutDepth: 'unset', toolDia: 6.35, clearing, loop, stepover: 40, finishAllowance: 0.5 });
      eq(rel.levels.length, 0, `${clearing}, Loop ${loop ? 'on' : 'off'}, depth unset: nothing cut in 3D (no through wall)`);
      eq(rel.stats.unsetThrough, [], `${clearing}, Loop ${loop ? 'on' : 'off'}, depth unset: no "shown cut through" label`);
      ok(rel.stats.skipped.length > 0 && rel.stats.skipped.every((s) => s.reason === 'no-depth'), `${clearing}, Loop ${loop ? 'on' : 'off'}, depth unset: every piece "not shown (no depth)", like a Freehand pocket`);
      eq(rel.marks.map((m) => m.kind), ['pocket-start'], `${clearing}, Loop ${loop ? 'on' : 'off'}, depth unset: the start mark is still drawn`);
    }
  }
  // with a depth the programmed pocket's wall and island are still cut at it (unchanged)
  const deep = reliefOf({ cutType: 'pocket', cutDepth: 6, toolDia: 6.35, clearing: 'linked', loop: false, stepover: 40, finishAllowance: 0.5 });
  eq(deep.levels.map((l) => [l.depth, l.through]), [[6, false]], 'a 6 mm programmed pocket, Loop off: one level at 6 mm, not through');
}

// ── 5. (bug 13) a positive field with no min (the bit diameter): − stops at the smallest positive multiple of the step ──
SettingsManager.set('DOC_UNIT', 'mm');
SettingsManager.set('LENGTH_PRECISION', null);
{
  const profile = await createProfile();
  await createNamedDesign(profile, 'shaper', 'Stepper 787');
  V2_PLAN.clear(); V2_PLAN.setOrder([]);
  const app = await open({ host: 'shaper', profile });
  try {
    const doc = app.document, q = (sel) => doc.querySelector(sel), st = app.state;
    const pressEl = (sel) => { const e = q(sel); assert(e, sel + ' not found'); app.press(e); };
    const typed = (cls, v) => { const i = q(cls); i.value = v; i.dispatchEvent(new app.window.Event('change')); };
    pressEl('.sk-header-tab[data-tab="design"]');
    for (const k of [...st.joints.keys()]) st.joints.delete(k);
    st.shapes.length = 0; st.constraints.length = 0;
    const src = partState([[0, 0, 200, 100]]);
    for (const [k, v] of src.joints) st.joints.set(k, v);
    st.shapes.push(...src.shapes);
    st.saveState('draw');
    pressEl('.sk-header-tab[data-tab="prepare"]');
    const pc = doc.getElementById('prepare-canvas'), p = worldToScreen(pc, { x: 10, y: 10 });
    app.click(Math.round(p.x), Math.round(p.y), { target: pc });
    pressEl('#op-type-online'); // TASK S3: the operations toolbar's button (the quick flow: a NEW operation, open)
    typed('.cut-depth', '3');
    const key = [...V2_PLAN.keys()][0];
    // a positive field with NO min (the bit diameter) keeps its rule: − stops at the smallest positive multiple of the step
    typed('.cut-bit', '0.5');
    const h3 = st.history.length;
    pressEl('.cut-row[data-param="toolDia"] .cut-step[data-d="-1"]');
    eq([V2_PLAN.get(key).toolDia, st.history.length], [0.5, h3], 'bit diameter 0.5 mm: − stays (positive, no min: unchanged)');
  } finally { await app.close(); }
}

console.log(`cam-paths-787-node: ${checks} checks passed`);
