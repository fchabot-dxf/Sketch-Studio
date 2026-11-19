// tests/no-min-736-node.test.js — TASK 736: NO app-imposed minimum on Shaper's sizes (owner turn 2071: "let users decide").
// ONE rule for a size (bit diameter, stock thickness, step depth, adaptive resolution): any value > 0, typed or stepped, is kept exactly; 0 / negative / non-numbers are
// refused (the box reverts); the − button stops at the smallest positive multiple of its step (never 0). Depth may be 0, the offset any sign (unchanged).
// Tiny values do not freeze: step depth 0.01 mm and resolution 0.001 mm on the R3 fillet and the drafted 10 deg pocket (count + time of steppedTerraces and of the export).
import assert from 'node:assert';
import fs from 'node:fs';
import { open } from './helpers/node-app.js';
import { worldToScreen } from '#ui/coords.js';
import SettingsManager from '#core/settings-manager.js';
import * as stepped from '#core/stepped-cut.js';
import { exportShaperSVG } from '#core/shaper-export.js';
import { CUT_PLAN, cutPlanEntries } from '../apps/shaper/src/cut-plan.js';
import { getStock } from '../apps/shaper/src/stock.js';
import { importFusionSelection, slopeFromRegion } from '../apps/shaper/src/fusion-import.js';
import { exportEncoding } from '../apps/shaper/src/shaper.js';
import { nextValue } from '../apps/shaper/src/number-stepper.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const FIX = new URL('./fixtures/sa7-slope/', import.meta.url);
const payload = (n) => JSON.parse(fs.readFileSync(new URL(n + '.json', FIX), 'utf8'));
const slopeOf = (n) => { for (const r of payload(n).regions) { const s = slopeFromRegion(r, { scale: 1, yUp: true }, []); if (s && s.kind === 'pocket') return s; } return null; };
const exportOf = (app) => exportShaperSVG({ state: app.state, entries: cutPlanEntries(), encoding: exportEncoding(), docUnit: 'mm', options: {} });

// ── 1. core + the step rule ──
eq(['minMm' in stepped.STEP_DEPTH, 'minMm' in stepped.STEP_RESOLUTION], [false, false], 'no minMm constant remains in the core');
eq(nextValue(0.5, -1, 0.5, 0.5), 0.5, '- at one step stops (no 0)');
eq(nextValue(0.7, -1, 0.5, 0.5), 0.5, '- from 0.7 lands on the smallest positive multiple');
eq(nextValue(0.05, 1, 0.5, 0.5), 0.5, '+ still steps up');
eq(nextValue(0.5, -1, 0.5, 0), 0, 'a non-size (depth, min 0) still reaches 0');
for (const [name, fixture] of [['R3 fillet', '03-pocket-floor-fillet'], ['10 deg drafted pocket', '02-drafted-pocket']]) {
  const s = slopeOf(fixture), out = [];
  for (const o of [{ step: 0.01 }, { deviation: 0.001 }]) {
    const t = performance.now(); const r = stepped.steppedTerraces(s, { kind: 'pocket', depth: 8, ...o }); const ms = performance.now() - t;
    out.push(`${JSON.stringify(o)} -> ${r.steps.length} steps, ${Math.round(ms)} ms`);
    ok(ms < 2000, `${name} ${JSON.stringify(o)} under 2 s`);
    if (o.deviation) eq(r.deviation, 0.001, 'the deviation is kept exactly');
  }
  console.log(name + ': ' + out.join(' | '));
}
eq(stepped.steppedTerraces(slopeOf('03-pocket-floor-fillet'), { kind: 'pocket', depth: 8, step: 0.01 }).steps.length, 184, 'R3 fillet at 0.01 mm: 184 steps');
// a smaller step / finer resolution never gives FEWER steps (the merge compares with the run's first outline, not the step it just merged)
for (const [fixture, kind] of [['03-pocket-floor-fillet', 'pocket'], ['02-drafted-pocket', 'pocket'], ['01-chamfer-outline', 'outside']]) {
  let s = null; for (const r of payload(fixture).regions) { const x = slopeFromRegion(r, { scale: 1, yUp: true }, []); if (x && x.kind === kind) s = x; }
  const steps = [2, 1, 0.5, 0.1, 0.05, 0.01].map((st) => stepped.steppedTerraces(s, { kind, step: st }).steps.length);
  const devs = [0.5, 0.25, 0.1, 0.01, 0.001].map((d) => stepped.steppedTerraces(s, { kind, deviation: d }).steps.length);
  console.log(fixture + ' steps 2..0.01: ' + steps.join(' ') + ' | deviations 0.5..0.001: ' + devs.join(' '));
  for (const row of [steps, devs]) for (let i = 1; i < row.length; i++) ok(row[i] >= row[i - 1], `${fixture}: a smaller step / finer resolution gives at least as many steps (${row.join(' ')})`);
}
// drafted 10 deg wall at 0.01 mm: every merged step's left edge is within the tolerance of the run's FIRST outline (run i+1 starts one step below step i)
{
  const T = stepped.steppedTerraces(slopeOf('02-drafted-pocket'), { kind: 'pocket', depth: 8, step: 0.01 });
  const TAN10 = Math.tan(10 * Math.PI / 180), left = (st) => Math.min(...st.outlines[0].polygon.map((q) => q.x));
  for (let i = 1; i < T.steps.length; i++) ok(left(T.steps[i]) - (30 + (T.steps[i - 1].depth + 0.01) * TAN10) <= stepped.SAME_OUTLINE_TOL_MM + 1e-6, `step ${i}: drift from its run's first outline within ${stepped.SAME_OUTLINE_TOL_MM} mm`);
  eq(T.steps.length, 160, 'drafted pocket at 0.01 mm: 160 steps (8 mm x tan 10 deg = 1.41 mm of wall / 0.01 mm tolerance ~ 141, plus run-boundary rounding)');
}

// ── 2. the real card and the stock field ──
SettingsManager.set('DOC_UNIT', 'mm');
CUT_PLAN.clear();
const app = await open({ host: 'shaper' });
try {
  app.modes.showMode('prepare');
  const doc = app.document, q = (s) => doc.querySelector(s);
  const pc = doc.getElementById('prepare-canvas');
  const pressEl = (s) => { const e = q(s); assert(e, s + ' not found'); app.press(e); };
  importFusionSelection(payload('03-pocket-floor-fillet'), { controller: app.controller, prepare: app.prepare });
  const p = worldToScreen(pc, { x: 60, y: -40 }); app.click(Math.round(p.x), Math.round(p.y), { target: pc });
  pressEl('.cut-type-trigger'); pressEl('.cut-type-opt[data-id="roughing"]');
  const rec = () => [...CUT_PLAN.values()].find((r) => r.cutType === 'roughing');
  const typed = (cls, v) => { const i = q(cls); i.value = v; i.dispatchEvent(new app.window.Event('change')); };
  const cb = q('.cut-adaptive'); cb.checked = true; cb.dispatchEvent(new app.window.Event('change'));
  for (const [cls, field, label, v] of [['.cut-bit', 'toolDia', 'bit', 0.05], ['.cut-step-depth', 'stepDepth', 'step depth', 0.01], ['.cut-step-deviation', 'stepDeviation', 'resolution', 0.001]]) {
    typed(cls, String(v)); eq(rec()[field], v, `${label}: typed ${v} mm is kept exactly`);
    for (const bad of ['0', '-1', 'abc']) { typed(cls, bad); eq(rec()[field], v, `${label}: "${bad}" is refused`); }
    ok(Number(q(cls).value) > 0, `${label}: the box reverts to the stored value (${q(cls).value})`);
  }
  // the − button at one step stops (no 0)
  typed('.cut-bit', '0.5'); app.press(q('.cut-row[data-param="toolDia"] .cut-step[data-d="-1"]'));
  eq(rec().toolDia, 0.5, 'bit: - at one step stays 0.5 (never 0)');
  // the export build at 0.01 mm step / 0.001 mm resolution stays quick, the note names the steps
  typed('.cut-step-depth', '0.01'); cb.checked = false; cb.dispatchEvent(new app.window.Event('change'));
  ok(/steps/.test(q('.cut-note').textContent), 'the note shows: ' + q('.cut-note').textContent.slice(0, 80));
  for (const [label, set] of [['step 0.01', () => {}], ['resolution 0.001', () => { cb.checked = true; cb.dispatchEvent(new app.window.Event('change')); typed('.cut-step-deviation', '0.001'); }]]) {
    set();
    const t = performance.now(); const svg = exportOf(app); const ms = performance.now() - t;
    console.log(`export at ${label}: ${Math.round(ms)} ms, ${svg.length} bytes`);
    ok(ms < 2000, `export at ${label} under 2 s`);
  }
} finally { await app.close(); }

// stock thickness: typed 0.05 kept, 0 / -1 refused (the stock field in Review)
{
  const a2 = await open({ host: 'shaper' });
  try {
    a2.modes.showMode('review');
    const thick = a2.document.getElementById('review-stock-thickness');
    const type = (v) => { a2.press(thick); a2.key('a', { ctrl: true }); a2.type(v); a2.key('Enter'); };
    type('0.05'); eq(getStock().thickness, 0.05, 'stock thickness: typed 0.05 mm is kept exactly');
    type('0'); eq(getStock().thickness, 0.05, 'stock thickness: 0 refused'); type('-1'); eq(getStock().thickness, 0.05, 'stock thickness: -1 refused');
    a2.press(thick.parentNode.querySelector('.cut-step[data-d="-1"]'));
    eq(getStock().thickness, 0.05, 'stock thickness: - below one step stays (never 0)');
  } finally { await a2.close(); }
}
console.log(`no-min-736-node: ok (${checks} checks)`);
