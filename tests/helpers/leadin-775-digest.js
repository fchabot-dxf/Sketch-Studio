// tests/helpers/leadin-775-digest.js — TASK 775: the BYTE-IDENTICAL check of documents that do not use the new options (On line Lead-in / Tabs / Onion skin,
// a pocket's Lead-in). For every fixture drawing (the document fixtures, the report documents, the DXF files, the Fusion selections imported through the
// Shaper node kit), it hashes what Prepare, the operations list, Export 2D / 3D and the download read: the downloaded Shaper SVG and its PREVIEW copy
// (shaperPreviewOf: data-* attributes + the operations), the operations' words, and the 3D Review footprints, for every loop cut as Outside, Inside, On line,
// Pocket Freehand, Spiral (Loop off / on), Raster / Morphed spiral (Loop on), Outside with tabs / onion skin, and every open chain cut On line / Guide.
// Uses only APIs that exist on origin/main 5e79336 (before this task), so the SAME file runs there: `node tests/leadin-775-node.test.js --write-digest`
// in a copy of that commit wrote tests/fixtures/leadin-775-before.json (WORK-LOG TURN 775).
import fs from 'node:fs';
import crypto from 'node:crypto';
import { findLoops, findOpenChains } from '#core/loop-finder.js';
import { importDxf } from '#core/dxf-import.js';
import { shaperSvgOf, shaperPreviewOf } from '../../apps/shaper/src/export-payload.js';
import { CUT_PLAN, cutPlanEntries, planReliefItems } from '../../apps/shaper/src/cut-plan.js';
import { setOpOrder, planOperations } from '../../apps/shaper/src/operations.js';
import { importFusionSelection } from '../../apps/shaper/src/fusion-import.js';
import { open } from './node-app.js';

const fx = (p) => new URL('../fixtures/' + p, import.meta.url);
// the Fusion import names its shapes `fusion<Date.now()>_<n>_s<k>` and its joints `j<n>_<Date.now()>` (#core/shape-id): the clock part is replaced before hashing
const hash = (v) => crypto.createHash('sha256').update((typeof v === 'string' ? v : JSON.stringify(v)).replace(/fusion\d{10,}_/g, 'fusion#_').replace(/(j\d+_)\d{10,}/g, '$1#')).digest('hex').slice(0, 24);
const stateOf = (g) => ({
  joints: new Map((g.joints || []).map((e) => (Array.isArray(e) ? [e[0], { ...e[1] }] : [e.id, { ...e }]))),
  shapes: (g.shapes || []).map((s) => ({ ...s, joints: [...(s.joints || [])] })),
  constraints: (g.constraints || []).map((c) => ({ ...c })),
  profiles: (g.profiles || []).map((p) => ({ ...p })),
});
// the 3D Review's geometry of each footprint (what it draws: its kind, type, depth, swept rings and tool paths).
// TASK 778: programmed pockets add a guide start-mark footprint (kind 'guide', empty rings/toolPaths) which does not cut wood.
const isStartMarkFp = (fp) => fp.kind === 'guide' && fp.cutType === 'guide' && fp.rings.length === 0 && fp.toolPaths.length === 0 && fp.clearing?.role === 'start';
const reliefOf = (st, stripMarks = false) => planReliefItems(st).filter((i) => !(stripMarks && i.footprints.length === 1 && isStartMarkFp(i.footprints[0]))).map((i) => [i.key, i.cutType, i.cutDepth, i.footprints.map((fp) => [fp.kind, fp.cutType, fp.fillRule, fp.rings, fp.toolPaths, fp.center])]);
// TASK 778: for programmed pockets (HEAVY_RECS), remove ONLY the added pocket start-mark guide element(s) so the test proves everything else is byte-identical
const START_MARK_D = /d="M [^"]+ A [^"]+ A [^"]+ M [^"]+ L [^"]+ M [^"]+ L [^"]+"/;
function stripStartMarkSvg(svg) {
  const lines = svg.split('\n'), out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^  <path /.test(l) && START_MARK_D.test(l) && l.includes('shaper:cutType="guide"')) continue;
    if (/^  <g [^>]*shaper:cutType="guide"[^>]*>$/.test(l)) {
      let j = i + 1, allMarks = true;
      while (j < lines.length && lines[j] !== '  </g>') {
        if (!(/^    <path /.test(lines[j]) && START_MARK_D.test(lines[j]))) allMarks = false;
        j++;
      }
      if (allMarks && j < lines.length && lines[j] === '  </g>') { i = j; continue; }
    }
    out.push(l);
  }
  return out.join('\n');
}
// the operations' words; TASK 775 removed ", ends where it starts" / ", each ends where it starts" from a Loop's words (a closed loop has no start point on the
// Origin: owner ruling), so the words are compared without it (applied to both sides: a match means that phrase is the ONLY change)
const opsWords = (st, entries) => planOperations(st, entries).map((op) => [op.label, op.rowText, op.heading].map((t) => String(t).replace(/,? (each )?ends where it starts/g, '')));
const rec = (cutType, extra = {}) => ({ cutType, cutDepth: 6, cutOffset: 0, toolDia: 3.175, cutterShape: 'endmill', cutterAngle: 90, ...extra });
const LOOP_RECS = {
  outside: rec('exterior'), inside: rec('interior'), online: rec('online'), pocket: rec('pocket'),
  tabs: rec('exterior', { holdPart: 'tabs', holdThickness: 1, tabWidth: 6, tabCount: 'auto' }), skin: rec('exterior', { holdPart: 'skin', holdThickness: 1 }),
};
const HEAVY_RECS = {
  spiral: rec('pocket', { clearing: 'linked', toolDia: 25.4, stepover: 40, finishAllowance: 0.5 }),
  rasterLoop: rec('pocket', { clearing: 'raster', toolDia: 25.4, stepover: 40, finishAllowance: 0.5, loop: true, rasterAngle: 0 }),
  // TASK 804: no spiralLoop / morphedLoop: the Spiral's and the Morphed spiral's Loop are the gradual double spiral now (changed on purpose; checked in
  // tests/pocket-nocross-804-node.test.js), so their base facets no longer apply
};
function facets(st, entries, stripMarks = false) {
  const pv = shaperPreviewOf(st, entries);
  CUT_PLAN.clear();
  for (const e of entries) CUT_PLAN.set(`${e.target.kind}:${e.target.id}`, { ...e.rec });
  const relief = reliefOf(st, stripMarks);
  CUT_PLAN.clear();
  const dl = shaperSvgOf(st, entries);
  return {
    download: hash(stripMarks ? stripStartMarkSvg(dl) : dl),
    preview: hash(stripMarks ? stripStartMarkSvg(pv.svg) : pv.svg),
    ops: hash(opsWords(st, entries)),
    relief: hash(relief),
  };
}
function digestOf(st, { heavy = false } = {}) {
  const loops = findLoops(st), chains = findOpenChains(st, loops);
  const out = {};
  const recs = heavy ? { ...LOOP_RECS, ...HEAVY_RECS } : LOOP_RECS;
  for (const [name, r] of Object.entries(recs)) {
    const stripMarks = Object.hasOwn(HEAVY_RECS, name);
    out[name] = facets(st, [...loops.map((l) => ({ target: { kind: 'loop', id: l.id }, rec: r })), ...chains.map((c) => ({ target: { kind: 'chain', id: c.id }, rec: rec(name === 'pocket' ? 'guide' : 'online') }))], stripMarks);
  }
  return out;
}

/** The digest of every fixture drawing: { [name]: { [record set]: { download, preview, ops, relief } (hashes) } }. */
export async function leadinDigest() {
  const docs = [];
  for (const f of ['owner-trapezoid.document.json', 'pattern-params-694-old.document.json', 'pre-577-two-sketches.document.json', 'angle-dimension/owner-trapezoid-angle.json',
    'dimension/owner-drag-frozen-589.document.json', 'dimension/owner-rect-line-line-589.document.json', 'drag/owner-two-arcs-575.json']) {
    docs.push({ name: f, st: stateOf(JSON.parse(fs.readFileSync(fx(f), 'utf8')).geometry), heavy: true });
  }
  for (const f of ['report/drag-frozen.json', 'report/line-line-driven.json', 'report/midpoint-move.json']) {
    docs.push({ name: f, st: stateOf(JSON.parse(fs.readFileSync(fx(f), 'utf8')).document.geometry), heavy: true });
  }
  for (const f of ['bulge-loop-in.dxf', 'close-path-760-gap.dxf', 'fusion-sketch4.dxf', 'part-mm.dxf']) {
    let n = 0;
    const res = importDxf(fs.readFileSync(fx('dxf/' + f), 'utf8'), { genJ: () => 'j' + (n++), idPrefix: 'd' });
    docs.push({ name: 'dxf/' + f, st: { joints: new Map((res.joints || []).map((j) => [j.id, { x: j.x, y: j.y }])), shapes: res.shapes || [], constraints: res.constraints || [], profiles: [] }, heavy: true });
  }
  const digest = {};
  for (const d of docs) digest[d.name] = digestOf(d.st, { heavy: d.heavy });
  const app = await open({ host: 'shaper' });
  try {
    app.modes.showMode('prepare');
    for (const f of ['real-solid-plate-711.json', ...fs.readdirSync(fx('sa7-slope')).sort().map((x) => 'sa7-slope/' + x)]) {
      CUT_PLAN.clear(); setOpOrder([]);
      importFusionSelection(fs.readFileSync(fx(f), 'utf8'), { controller: app.controller, prepare: app.prepare });
      const st = app.state, entries = cutPlanEntries();
      const relief = reliefOf(st);
      const pv = shaperPreviewOf(st, entries);
      digest['fusion/' + f] = { plan: { download: hash(shaperSvgOf(st, entries)), preview: hash(pv.svg), ops: hash(opsWords(st, entries)), relief: hash(relief) }, ...digestOf(st) };
    }
  } finally { CUT_PLAN.clear(); setOpOrder([]); await app.close(); }
  return digest;
}
