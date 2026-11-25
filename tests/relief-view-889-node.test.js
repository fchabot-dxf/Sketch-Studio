// tests/relief-view-889-node.test.js — TASK 889: the display of an inserted STL relief's Roughing + 3D Contour (the advisor's screenshot run), on the Shaper node
// page (tests/helpers/node-app.js). The part: tests/fixtures/relief-terrain-889.js (synthetic: 120 x 80 x 23.5 mm, a ridge that starts with a 5 mm cliff).
//  1. PREPARE DRAWS EVERY CONTOUR PASS: the open Contour (its Preview) draws ONE line per pass of the operation (its bit-centre paths, the thin continuous guide .sk-clear-path: the note's "N passes
//     along the walls"), not only the few whose marching travel marks survive the on-screen thinning (#core thinTravel, TASK 757). Before 889 a Contour pass
//     had no line of its own: only its travel marks, thinned away where the levels crowd (4 of 218 drawn).
//  3. THE PATHS VIEW'S DARK STREAK is the Contour's real passes on the part's cliff (x 16.7 - 18.3 mm, the ridge's abrupt start): one pass per level, every
//     0.25 mm of depth, each a distinct level and position (about 0.1 mm apart), none written twice; the SVG has no identical element.
import assert from 'node:assert/strict';
import { open } from './helpers/node-app.js';
import SettingsManager from '#core/settings-manager.js';
import { binaryStl } from './helpers/stl-mesh.js';
import { reliefTerrain, RELIEF_TERRAIN } from './fixtures/relief-terrain-889.js';
import { storeOps } from '../apps/shaper/src/operations-store.js';
import { getSelections } from '../apps/shaper/src/selection-list.js';
import { exportFileOf } from '../apps/shaper/src/export-payload.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
SettingsManager.set('DOC_UNIT', 'mm', { persist: false });
const STL = binaryStl(reliefTerrain());

// the written elements: { d, type, depth }
const elements = (svg) => [...svg.matchAll(/<path d="([^"]+)"([^>]*)\/>/g)].map((m) => ({ d: m[1], type: (/shaper:cutType="([^"]+)"/.exec(m[2]) || [])[1], depth: parseFloat((/shaper:cutDepth="([^"]+)"/.exec(m[2]) || [])[1]) }));
// where an element's outline crosses the horizontal line y = Y (its commands' end points joined: a C's end point; enough to find a crossing)
const crossings = (d, Y) => {
  const out = [], subs = []; let sub = [], cur = [], cmd = null;
  for (const t of d.match(/[MLCZ]|-?[\d.]+/g)) {
    if (/[MLCZ]/.test(t)) { cmd = t; if (t === 'M' && sub.length) { subs.push(sub); sub = []; } if (t === 'Z' && sub.length) sub.push(sub[0]); cur = []; continue; }
    cur.push(+t); const need = cmd === 'C' ? 6 : 2;
    if (cur.length === need) { sub.push([cur[need - 2], cur[need - 1]]); cur = []; }
  }
  if (sub.length) subs.push(sub);
  for (const s of subs) for (let i = 1; i < s.length; i++) { const [x0, y0] = s[i - 1], [x1, y1] = s[i]; if (y0 !== y1 && (y0 - Y) * (y1 - Y) <= 0) out.push(x0 + ((Y - y0) / (y1 - y0)) * (x1 - x0)); }
  return out;
};

const app = await open({ host: 'shaper' });
try {
  const doc = app.document;
  app.modes.showMode('prepare');
  const res = app.stl.insertFile(STL, 'relief.stl');
  ok(res.ok, 'the relief is inserted: ' + res.message);
  const part = getSelections().find((x) => x.kind === 'stl'), key = part.cutKeys[0];
  eq(storeOps().map((o) => o.type), ['roughing'], 'the insert made its Roughing');

  // ── 1. the open Contour draws every pass
  app.prepare.ok();
  app.prepare.view().setSelection([{ kind: key.slice(0, key.indexOf(':')), id: key.slice(key.indexOf(':') + 1) }]);
  app.prepare.addOperation('contour');
  app.prepare.preview();
  eq(app.prepare.previewState(), 'fresh', '1: the Contour\'s Preview is drawn');
  const note = [...doc.querySelectorAll('#prepare-panel .cut-note div')].map((d) => d.textContent).join(' ');
  const passes = Number((/(\d+) passes along the walls/.exec(note) || [])[1]);
  ok(passes > 100, `1: the note counts the Contour's passes: ${JSON.stringify(note)}`);
  const lines = doc.querySelectorAll('#prepare-toolpath-group .sk-clear-path').length;
  const marks = doc.querySelectorAll('#prepare-toolpath-group .sk-travel-steps .sk-travel').length;
  console.log(`ROW 1 contour open | note ${passes} passes | pass lines drawn ${lines} | travel marks kept ${marks}`);
  ok(lines >= passes, `1: Prepare draws a line for every pass (${lines} lines for ${passes} passes)`);
  ok(marks >= 1 && marks < passes, `1: the marching travel marks stay thinned (${marks} of ${passes})`);
  app.prepare.ok();

  // ── 3. the streak: the Contour's passes on the cliff, each its own level
  const file = exportFileOf(app.state);
  const els = elements(file.svg);
  const ids = new Set(els.map((e) => e.d));
  eq(ids.size, els.length, `3: no element of the SVG is written twice (${els.length} elements)`);
  // the part is centred on the file's origin (y down): the cliff at x = cliffX - w/2, the ridge's crest at model y ~ 61 mm -> svg y ~ -21
  const cell = RELIEF_TERRAIN.w / RELIEF_TERRAIN.nx, x0 = Math.floor(RELIEF_TERRAIN.cliffX / cell) * cell - RELIEF_TERRAIN.w / 2, Y = -22; // the grid cell the step falls in
  const onCliff = els.filter((e) => e.type === 'outside').flatMap((e) => crossings(e.d, Y).filter((x) => x > x0 - 0.05 && x < x0 + cell + 0.05).map((x) => ({ x, depth: e.depth })));
  onCliff.sort((a, b) => a.x - b.x);
  console.log(`ROW 3 contour passes on the cliff at y ${Y}: ${onCliff.length} | ${onCliff.map((p) => `${p.depth}@${p.x.toFixed(3)}`).join(' ')}`);
  ok(onCliff.length >= 15, `3: the streak is the Contour's passes on the cliff: ${onCliff.length}`);
  const depths = onCliff.map((p) => p.depth);
  eq(new Set(depths).size, depths.length, '3: one pass per level on the cliff (no level twice)');
  ok(depths.every((d, i) => i === 0 || Math.abs(Math.abs(d - depths[i - 1]) - 0.25) < 1e-6), '3: consecutive levels, 0.25 mm apart, deeper further out on the wall');
  ok(onCliff.every((p, i) => i === 0 || p.x - onCliff[i - 1].x > 0.01), '3: each at its own place on the wall (none coincident)');
  ok(onCliff[onCliff.length - 1].x - onCliff[0].x <= cell + 0.05, `3: all inside the one grid cell the 5 mm step crosses (${cell.toFixed(2)} mm)`);
} finally {
  app.close();
}
console.log(`relief-view-889-node: ${checks} checks passed`);
process.exit(0);
