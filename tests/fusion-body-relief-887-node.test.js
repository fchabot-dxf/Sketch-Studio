// tests/fusion-body-relief-887-node.test.js — TASK 887 (add-in SA-35, owner turns 3616-3622): a Fusion BODY with sculpted faces comes from the add-in as ONE
// RELIEF region in sliceStl's form (#core/stl-slice.js), its source.kind 'body'. The panel treats it EXACTLY like an STL relief: the relief behaviour (Roughing,
// Contour, the 3D Review's carved relief, the export) keys on the region's `levels`, never on source.kind; the four `kind === 'stl'` sites mean "the STL card /
// file" (no card, no STL source, Select in Fusion kept for a body). The payload is the add-in's own output (tests/fixtures/fusion-body-relief-887.json: written by
// shaper-addin's fusion_selection.extract_selection, branch sa-35-relief-orientation, for a faceted dome R 12 mm).
//   1. import -> ONE Roughing operation with the levels (as an STL), the stock = the body's height, no STL source / card;
//   2. a Contour added on the part (the operations toolbar) -> its paths; the Shaper SVG has the Roughing pockets and the Contour cuts;
//   3. the SAME region in sliceStl's envelope (source.kind 'stl', no selection id) -> the same plan and the same SVG, byte for byte (the kind changes nothing
//      but the STL card's sites);
//   4. Select in Fusion stays offered for a body relief (it is an STL's that has none: fusion-bridge.js isStlOperation).
import assert from 'node:assert';
import fs from 'node:fs';
import SettingsManager from '#core/settings-manager.js';
import { open } from './helpers/node-app.js';
import { importFusionSelection } from '../apps/shaper/src/fusion-import.js';
import { planEntries, planReliefItems } from '../apps/shaper/src/cut-plan.js';
import { describeOperations } from '../apps/shaper/src/operations.js';
import { shaperSvgOf } from '../apps/shaper/src/export-payload.js';
import { getStlSource } from '../apps/shaper/src/stl-source.js';
import { resolveStock } from '../apps/shaper/src/stock.js';
import { isStlOperation } from '../apps/shaper/src/fusion-bridge.js';
import { getSelections } from '../apps/shaper/src/selection-list.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
SettingsManager.set('DOC_UNIT', 'mm');

const FIXTURE = JSON.parse(fs.readFileSync(new URL('./fixtures/fusion-body-relief-887.json', import.meta.url), 'utf8'));
const BODY = FIXTURE.payload;
eq([BODY.source.kind, BODY.regions.length, BODY.regions[0].cutType, Array.isArray(BODY.regions[0].levels)], ['body', 1, 'roughing', true], 'the fixture: the add-in\'s ONE relief region of a body');

async function run(payload, label) {
  const app = await open({ host: 'shaper' });
  try {
    app.modes.showMode('prepare');
    const res = importFusionSelection(JSON.parse(JSON.stringify(payload)), { controller: app.controller, prepare: app.prepare });
    ok(res.ok, `${label}: imported (${res.message})`);
    const entries = planEntries();
    eq(entries.map((e) => e.rec.cutType), ['roughing'], `${label}: ONE Roughing operation`);
    const rough = entries[0];
    ok(Array.isArray(rough.rec.levels) && rough.rec.levels.length === payload.regions[0].levels.length, `${label}: it carries the relief's ${payload.regions[0].levels.length} levels`);
    eq(resolveStock(app.state).board.thickness, payload.stock.thicknessMm, `${label}: the stock = the part's height (TASK 898: the Stock row, from the part)`);
    // 2. a Contour on the part: the operations toolbar with the part's shape picked (a NEW operation, OK)
    const key = rough.planKey, i = key.indexOf(':');
    app.prepare.view().setSelection([{ kind: key.slice(0, i), id: key.slice(i + 1) }]);
    app.press(app.document.getElementById('op-type-contour'));
    app.prepare.ok();
    const ops = describeOperations(app.state, planEntries());
    eq(ops.map((o) => o.cutType), ['stock', 'roughing', 'contour'], `${label}: the Stock row (TASK 898: a Fusion selection's, from the part), the Roughing, then its Contour`);
    const svg = shaperSvgOf(app.state, planEntries());
    const pockets = (svg.match(/shaper:cutType="pocket"/g) || []).length, contours = (svg.match(/shaper:cutType="(outside|inside)"/g) || []).length;
    ok(pockets >= 2 && contours >= 2, `${label}: the Shaper SVG has the Roughing's pockets (${pockets}) and the Contour's cuts (${contours})`);
    const relief = planReliefItems(app.state);
    ok(relief.length >= 1 && relief.every((r) => Array.isArray(r.footprints) && r.footprints.length), `${label}: the 3D Review's relief items (${relief.length}) carve the levels`);
    return { svg, ops: ops.map((o) => o.label), stl: getStlSource(), kinds: getSelections().map((e) => e.kind), selectable: describeOperations(app.state, planEntries()).filter((o) => o.cutType !== 'stock').map((o) => !isStlOperation(o)) }; // TASK 898: the cut operations (the Stock row's Select in Fusion is T4's)
  } finally { await app.close(); }
}

const body = await run(BODY, 'body');
eq(body.stl, null, 'a body relief has no STL source (no STL card)');
eq(body.kinds, ['body'], 'its selection row is the body\'s');
eq(body.selectable, [true, true], 'Select in Fusion stays offered for its operations (a body is in Fusion)');
const { selectionId, summary, frame, ...plain } = BODY; // sliceStl's own envelope: no selection id (a payload without one REPLACES the design), no summary, no frame
const asStl = await run({ ...plain, source: { ...BODY.source, kind: 'stl' } }, 'stl');
eq(asStl.ops, body.ops, 'the same payload as an STL: the same operations');
eq(asStl.svg, body.svg, 'and the same Shaper SVG, byte for byte: the relief behaviour never reads source.kind');
eq(asStl.selectable, [false, false], 'an STL relief has nothing to select in Fusion (the one place the kind matters, with the STL card)');
fs.mkdirSync('.evidence/887', { recursive: true });
fs.writeFileSync('.evidence/887/body-relief-node.svg', body.svg);
console.log(`fusion-body-relief-887-node: ok (${checks} checks)`);
