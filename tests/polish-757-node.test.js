// tests/polish-757-node.test.js — TASK 757: the promo-screenshot polish of the Shaper app, the parts a node test can assert (the layout parts are in
// tests/polish-757-live.test.js and tests/polish-757-phone-live.test.js).
//  1. Export 2D preview: a GUIDE (the Stock loop) is drawn as its outline (no fill) BEHIND every cut; the file string is untouched (display only).
//  2. Prepare: construction geometry (a slot's centre line) is never drawn as an edge.
//  3. lengths: Fractional inches show a small non-zero length as a decimal (never "0"); the Operations list's words use lengthText at the card's precision
//     (0.099–0.5 in, 0.063 in), the hold note agrees with the card fields.
//  6. Export 3D: an empty design builds NO board (buildRelief board 'none', no triangles), not a margin-sized cube.
//  7. Prepare: a stepped cut's travel rings are thinned (#core thinTravel): kept rings at least minGap apart, every dropped ring within minGap of a kept one.
import assert from 'node:assert';
import { open } from './helpers/node-app.js';
import SettingsManager, { lengthText } from '#core/settings-manager.js';
import { buildRelief } from '#core/relief-model.js';
import { thinTravel } from '#core/profile-model.js';
import { CUT_PLAN, keyOf, holdNoteItems } from '../apps/shaper/src/cut-plan.js';
import { lengthLabel } from '../apps/shaper/src/operations.js';
import { mountExportPreview } from '../apps/shaper/src/export-preview.js';
import { findLoops } from '#core/loop-finder.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const set = (k, v) => SettingsManager.set(k, v, { persist: false });
const IN = 25.4;

// ── 3. lengths ──
set('DOC_UNIT', 'in'); set('INCH_DISPLAY', 'fractional'); set('LENGTH_FRACTION', 16); set('LENGTH_PRECISION', 3); set('TRAILING_ZEROS', false);
eq(lengthText(0.02 * IN, { show: 'field' }), '0.02', 'Fractional 1/16: a 0.02 in finish allowance in the card field is a decimal, not "0"');
eq(lengthText(0.02 * IN), '0.02', 'bare: 0.02');
eq(lengthText(0.02 * IN, { show: 'unit' }), '0.02 in', 'a sentence: the decimal with its unit');
eq(lengthText(0.004 * IN, { show: 'field' }), '0.004', '0.004 in: 3 decimals');
eq([lengthText(0), lengthText(1e-12), lengthText(-1e-12)], ['0"', '0"', '0"'], 'zero (and float noise) stays the fraction 0');
eq([lengthText(0.04 * IN), lengthText(0.0625 * IN), lengthText(0.5 * IN)], ['1/16"', '1/16"', '1/2"'], 'a length that rounds to a fraction stays a fraction');
set('LENGTH_FRACTION', 64);
eq(lengthText(0.02 * IN), '1/64"', 'at 1/64 the same 0.02 in is a fraction (1.28 ticks)');
set('LENGTH_FRACTION', 16);
eq([lengthLabel(0.0987 * IN), lengthLabel(0.0625 * IN), lengthLabel(0.02 * IN)], ['1/8 in', '1/16 in', '0.02 in'], 'the Operations list in Fractional: the same decider');
set('INCH_DISPLAY', 'decimal');
eq([lengthLabel(0.0987 * IN), lengthLabel(0.0625 * IN), lengthLabel(0.6875 * IN), lengthLabel(0.5 * IN)], ['0.099 in', '0.063 in', '0.688 in', '0.5 in'],
  'the Operations list in Decimal: precision 3, trailing zeros dropped');
eq(lengthText(0.02 * IN, { show: 'field' }), '0.02', 'Decimal: trailing zeros dropped');
set('DOC_UNIT', 'mm');
eq([lengthLabel(6), lengthLabel(1.5875)], ['6 mm', '1.587 mm'], 'mm: 3 decimals, trailing zeros dropped');
set('DOC_UNIT', 'in');
{
  const rec = { cutType: 'exterior', cutDepth: 0.75 * IN };
  const hold = { role: 'pass', mode: 'tabs', count: 11, requested: 11, width: 0.375 * IN, thickness: 0.0625 * IN, depth: 0.6875 * IN, fullDepth: 0.75 * IN };
  eq(holdNoteItems(rec, hold)[0].text, 'Outside: 11 tabs, 0.375 in wide, 0.063 in thick: 1 pass at 0.688 in + 11 gaps at 0.75 in', 'the hold note at the card fields\' precision');
  set('INCH_DISPLAY', 'fractional');
  eq(holdNoteItems(rec, hold)[0].text, 'Outside: 11 tabs, 3/8 in wide, 1/16 in thick: 1 pass at 11/16 in + 11 gaps at 3/4 in', 'the hold note in Fractional');
  set('INCH_DISPLAY', 'decimal');
}

// ── 6. an empty design builds no board ──
{
  const r = buildRelief({ stock: { thickness: 19.05 }, items: [], bounds: null });
  eq([r.stats.board, r.stockBox, r.stats.triangles, Object.values(r.meshes).every((m) => m.indices.length === 0)], ['none', null, 0, true], 'an empty design: no board, no mesh');
  eq(buildRelief({ stock: { thickness: 19.05, width: 100, height: 50 }, items: [] }).stats.board, 'rectangle', 'an explicit width x height is still a board');
  eq(buildRelief({ stock: { thickness: 19.05 }, items: [], bounds: { minX: 0, maxX: 100, minY: 0, maxY: 50 } }).stats.board, 'rectangle', 'a design with shapes is still a board');
}

// ── 7. thinning a stepped cut's travel rings ──
{
  const circle = (r) => Array.from({ length: 200 }, (_, i) => ({ x: r * Math.cos((i / 200) * 2 * Math.PI), y: r * Math.sin((i / 200) * 2 * Math.PI) }));
  const radii = Array.from({ length: 25 }, (_, i) => 10 + i * 0.4); // 25 outlines 0.4 apart (a dished floor)
  const rings = radii.map(circle);
  const gaps = new Map();
  const kept = thinTravel(rings, 2, gaps);
  ok(kept.includes(24), 'the outermost outline keeps its marks');
  ok(kept.length < rings.length && kept.length >= 4, `the 25 outlines thin out at a 2 mm minimum: ${kept.length} kept`);
  for (const i of kept) for (const j of kept) if (i < j) ok(Math.abs(radii[i] - radii[j]) >= 2 - 0.01, `kept outlines ${i}, ${j} are at least 2 apart`);
  for (let i = 0; i < rings.length; i++) if (!kept.includes(i)) ok(kept.some((j) => Math.abs(radii[i] - radii[j]) < 2), `dropped outline ${i} lies within 2 of a kept one`);
  eq(thinTravel(rings, 0.1, gaps).length, 25, 'zoomed in (a 0.1 mm minimum): every outline keeps its marks');
  eq(thinTravel([circle(10), circle(30)], 5).length, 2, 'two far outlines both keep their marks');
}

// ── 1 + 2: in the app (the Shaper page in happy-dom) ──
const app = await open({ host: 'shaper' });
try {
  const st = app.state;
  for (const k of [...st.joints.keys()]) st.joints.delete(k);
  st.shapes.length = 0; st.constraints.length = 0; CUT_PLAN.clear();
  let n = 0; const J = (x, y) => { const id = 'j' + (++n); st.joints.set(id, { x, y }); return id; };
  const line = (a, b, more = {}) => { const id = 's' + (++n); st.shapes.push({ id, type: 'line', joints: [a, b], ...more }); return id; };
  const rect = (x, y, w, h) => { const p = [J(x, y), J(x + w, y), J(x + w, y + h), J(x, y + h)]; const ids = []; for (let i = 0; i < 4; i++) ids.push(line(p[i], p[(i + 1) % 4])); return ids; };
  const board = rect(0, 0, 200, 100), part = rect(20, 20, 160, 60);
  const cl = line(J(40, 50), J(160, 50), { isConstruction: true }); // a construction centre line inside the part (a slot's)
  st.saveState('draw');
  const loops = findLoops(st);
  const loopOf = (edge) => loops.find((l) => l.edges.includes(edge));
  CUT_PLAN.set(keyOf('loop', loopOf(board[0]).id), { cutType: 'stock', cutDepth: 19.05 });
  CUT_PLAN.set(keyOf('loop', loopOf(part[0]).id), { cutType: 'exterior', cutDepth: 19.05, cutOffset: 0, toolDia: 6.35 });
  app.press(app.document.querySelector('.sk-header-tab[data-tab="prepare"]'));
  const prep = app.document.getElementById('prepare-canvas');
  ok(prep.querySelectorAll('[data-shape-id]').length === 8, `Prepare draws the 8 cut edges: ${prep.querySelectorAll('[data-shape-id]').length}`);
  eq(prep.querySelectorAll(`[data-shape-id="${cl}"]`).length, 0, 'Prepare does not draw the construction line as an edge');

  // 1. the Export 2D preview of a file whose Stock guide (filled, written AFTER the outside cut) covers the part
  const FILE = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:shaper="http://www.shapertools.com/namespaces/shaper" width="200mm" height="100mm" viewBox="0 0 200 100">\n'
    + '  <path d="M 20 20 L 180 20 L 180 80 L 20 80 Z" fill="#000000" shaper:cutType="outside" shaper:cutDepth="19.050 mm" shaper:cutOffset="0mm" shaper:toolDia="6.350 mm"/>\n'
    + '  <path d="M 0 0 L 200 0 L 200 100 L 0 100 Z" fill="#0068FF" stroke="#0068FF" shaper:cutType="guide" shaper:cutDepth="19.050 mm" shaper:cutOffset="0mm" shaper:toolDia="3.175 mm"/>\n</svg>';
  const doc = app.document, canvas = doc.getElementById('review-2d-canvas');
  const pv = mountExportPreview({ canvas, list: doc.getElementById('review-cuts-list'), info: doc.getElementById('review-2d-info'), emptyText: 'none', getPreview: () => ({ svg: FILE, ops: [] }) });
  pv.refresh('a');
  const shown = [...canvas.querySelectorAll('.rv2d-doc path')];
  const guide = shown.find((e) => e.getAttribute('shaper:cutType') === 'guide'), outside = shown.find((e) => e.getAttribute('shaper:cutType') === 'outside');
  eq([guide.getAttribute('fill'), guide.getAttribute('stroke')], ['none', '#0068FF'], 'the Stock guide is its blue outline, no fill');
  ok(shown.indexOf(guide) < shown.indexOf(outside), 'the guide is painted BEHIND the outside cut');
  ok(FILE.includes('fill="#0068FF" stroke="#0068FF" shaper:cutType="guide"'), 'the file string keeps its filled guide (display only)');
} finally { CUT_PLAN.clear(); await app.close(); }

console.log(`polish-757-node: ${checks} checks passed`);
