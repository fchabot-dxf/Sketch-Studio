// tests/fusion-multibody-891-node.test.js — TASK 891 (add-in SA-36, advisor live check, owner turns 3666-3669): ONE Fusion selection of TWO bodies (a sculpted
// one -> its Relief region, a box -> its Outline outside region). Each body is read in its OWN frame (its own top = depth 0), so the add-in gives each body
// region the frame it was read in (`regions[i].frame`, shaper-addin docs/SELECTION-BRIDGE.md 6.1). The panel's `toolpaths` message must send every path in
// its REGION's frame (a path's `frame` when it is not the message's): before, every path went in the payload's one frame (the box's top), so in Fusion the
// relief's contours stood 7 mm (live: 36 mm) below / beside the freeform body. The payload is the add-in's own output (tests/fixtures/fusion-multibody-891.json).
//   1. import -> the selection entry keeps each region's frame by plan key;
//   2. the toolpaths message: the Relief's paths carry the relief's frame, the Outline's the box's (= the payload frame, so none);
//   3. every path's points, put in Fusion by the add-in's one mapping (P = origin + x u + y v - z n), lie inside their own body's box (within the bit radius);
//   4. a ONE-body payload has no region frames: its paths carry none (as before).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { open } from './helpers/node-app.js';
import SettingsManager from '#core/settings-manager.js';
import { createFusionBridge, FUSION_ACTIONS } from '../apps/shaper/src/fusion-bridge.js';
import { createFusionToolpathsSync } from '../apps/shaper/src/fusion-toolpaths.js';
import { importFusionSelection } from '../apps/shaper/src/fusion-import.js';
import { getSelections } from '../apps/shaper/src/selection-list.js';
import { clearSelections } from '../apps/shaper/src/selection-edit.js';
import { storeOps } from '../apps/shaper/src/operations-store.js';
import { planEntries, reliefDrop } from '../apps/shaper/src/cut-plan.js';
import { roughingWorkGrow } from '#core/stepped-cut.js';
import { setPathsPort, localPort } from '../apps/shaper/src/op-paths.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
SettingsManager.set('DOC_UNIT', 'mm', { persist: false });

const FIXTURE = JSON.parse(fs.readFileSync(new URL('./fixtures/fusion-multibody-891.json', import.meta.url), 'utf8'));
const PAYLOAD = FIXTURE.payload;
const [RELIEF, OUTLINE] = PAYLOAD.regions;
eq([RELIEF.label, RELIEF.cutType, Array.isArray(RELIEF.levels), OUTLINE.cutType], ['Relief', 'roughing', true, 'outside'], 'the fixture: a relief region and a box outline');
ok(RELIEF.frame.originMm[2] > PAYLOAD.frame.originMm[2] + 6, 'the relief was read in its own frame (its top 12 mm), not the payload\'s (the box top 5 mm)');

const toFusion = (frame, [x, y], z) => [0, 1, 2].map((i) => frame.originMm[i] + x * frame.uAxis[i] + y * frame.vAxis[i] - z * frame.normal[i]);

async function run(payload) {
  setPathsPort(localPort({ async: false }));
  const app = await open({ host: 'shaper' });
  try {
    const sent = [];
    const fakeWindow = {
      adsk: { fusionSendData(action, data) { sent.push({ action, payload: JSON.parse(data) }); } },
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    };
    const bridge = createFusionBridge({ globalTarget: fakeWindow, onError: () => {} });
    const sync = createFusionToolpathsSync({ bridge, getState: () => app.state, getOpenOpId: () => app.prepare.openId(), getSelections, debounceMs: 20, globalTarget: fakeWindow });
    app.modes.showMode('prepare');
    const res = importFusionSelection(JSON.parse(JSON.stringify(payload)), { controller: app.controller, prepare: app.prepare });
    ok(res.ok, `imported (${res.message})`);
    for (let i = 0; i < 100 && !(sent.length && !sync.isPending()); i++) { sync.notify(); await wait(60); }
    const msg = sent.filter((s) => s.action === FUSION_ACTIONS.TOOLPATHS).at(-1);
    ok(msg && msg.payload.paths.length > 0, 'a toolpaths message with paths was sent');
    const roughRec = (planEntries().find((e) => e.rec.cutType === 'roughing') || {}).rec || null;
    const roughKey = (planEntries().find((e) => e.rec.cutType === 'roughing') || {}).planKey || null;
    const out = { msg: msg.payload, entry: getSelections().find((e) => e.id === payload.selectionId), ops: storeOps().map((o) => ({ id: o.id, type: o.type })), roughRec, drop: roughKey ? reliefDrop('roughing', roughKey) : 0 };
    clearSelections(app.controller, { prepare: app.prepare }); // the list is module state: the next run starts empty
    return out;
  } finally { await app.close(); }
}

// ── 1-3. the two-body payload ──
{
  const { msg, entry, ops, roughRec, drop } = await run(PAYLOAD);
  // TASK 898: the payload says no stock thickness (several bodies), so the board is the declared 19.05 mm: the relief (12 mm) sits on its Floor (the default), its
  // top 7.05 mm below the stock's top; its first Roughing level clears the stock above it (a path above the body, by at most that)
  ok(Math.abs(drop - (19.05 - 11.999998)) < 1e-9, `898: the relief's top ${drop} mm below the stock's top`);
  eq(Object.values(entry.frames || {}).map((f) => f.originMm), [RELIEF.frame.originMm, OUTLINE.frame.originMm], '1. the entry keeps each region\'s frame by plan key');
  eq(msg.frame, PAYLOAD.frame, '2. the message frame is the selection\'s');
  const rough = ops.find((o) => o.type === 'roughing'), outside = ops.find((o) => o.type === 'exterior');
  ok(rough && outside, 'a Roughing and an Outline outside operation');
  const roughPaths = msg.paths.filter((p) => p.op === rough.id), outPaths = msg.paths.filter((p) => p.op === outside.id);
  ok(roughPaths.length > 20 && outPaths.length >= 1, `the Relief's paths (${roughPaths.length}) and the Outline's (${outPaths.length})`);
  eq(roughPaths.filter((p) => !isDeepStrictEqual(p.frame, RELIEF.frame)).length, 0, '2. every Relief path carries the relief\'s frame');
  ok(outPaths.every((p) => p.frame === undefined), '2. the Outline\'s paths carry none: their frame is the message\'s (the box\'s)');
  // across the cut direction: an Outline's bit centre runs one bit radius out; a Roughing's at most to its work area (the silhouette grown by
  // roughingWorkGrow: the bit centre never leaves it); along it: inside the body, exactly (each path at its depth from its OWN body's top)
  const across = { Freeform: roughingWorkGrow(roughRec), Box: 3.175 / 2 };
  const off = [];
  for (const [paths, name] of [[roughPaths, 'Freeform'], [outPaths, 'Box']]) {
    const box = FIXTURE.bodiesMm[name], tol = [across[name] + 5e-4, across[name] + 5e-4, 1e-4]; // + the message's 3-decimal rounding
    const above = name === 'Freeform' ? drop : 0; // TASK 898: the stock above the relief (its Floor), cleared by its first level
    for (const p of paths) {
      const frame = p.frame || msg.frame;
      for (const pt of p.points) {
        const w = toFusion(frame, pt, p.z);
        if (w.some((v, i) => v < box[i][0] - tol[i] || v > box[i][1] + tol[i] + (i === 2 ? above : 0))) { off.push({ name, op: p.op, z: p.z, w }); break; }
      }
    }
  }
  eq(off.slice(0, 3), [], `3. every path lies on its own body (${off.length} off)`);
}

// ── 4. one body: no region frames, no path frames ──
{
  const { frame: _f, ...relief } = RELIEF;
  const one = { ...PAYLOAD, selectionId: 'sel-891-one', frame: RELIEF.frame, regions: [relief], summary: { ...PAYLOAD.summary, text: 'Freeform · relief' } };
  const { msg, entry } = await run(one);
  ok(!entry.frames, '4. a one-body entry has no region frames');
  ok(msg.paths.every((p) => p.frame === undefined), '4. and its paths carry none (the message frame is the body\'s)');
  eq(msg.frame, RELIEF.frame, '4. the message frame = the body\'s');
}

console.log(`fusion-multibody-891-node: ok (${checks} checks)`);
