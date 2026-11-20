// tests/leadin-removed-836-node.test.js — TASK 836 (owner ruling 2026-11-20: "remove lead in"): the lead-in is gone from the app. No browser.
//  1. Documents that hold lead-in fields still open (apps/shaper/src/shaper-doc.js dropLeadIn, the one place they are dropped): a version 2 record with 775's
//     leg, a version 2 record with 778's arc (Radius / Sweep / Length / Side / a dragged position) and its stored operation key, a version 4 operation whose
//     settings and membership carry them: after the load no `leadIn*` field and no membership `at` is left in the store or the saved document, and the
//     export is the On line outline as the plain CLOSED loop (byte-identical to the same document without a lead-in).
//  2. The stored operation order keyed with a lead-in still orders the operations (the key's lead-in part dropped).
//  3. A Pocket record of before 778 with `leadIn: true` exports exactly as without (its guide start mark kept: task 778, pocket-clearing.js).
//  4. No `leadIn` left in apps/ or packages/ (code or text) but the one drop (shaper-doc.js) and the Origin rules' history text; packages/core/lead-in.js gone;
//     the card has no Lead-in row; the hints table has no lead-in entry; the cut types declare no lead-in setting.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import './helpers/node-app.js';
import { findLoops } from '#core/loop-finder.js';
import { loopsWithPolygons, keyOf, planEntries } from '../apps/shaper/src/cut-plan.js';
import { CUT_TYPES } from '../apps/shaper/src/shaper.js';
import { shaperSvgOf } from '../apps/shaper/src/export-payload.js';
import { captureShaperDoc, applyShaperDoc } from '../apps/shaper/src/shaper-doc.js';
import { describeOperations, opKeyOf } from '../apps/shaper/src/operations.js';
import { storeOps } from '../apps/shaper/src/operations-store.js';
import { PARAM_HINTS } from '../apps/shaper/src/param-hints.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

function partState(polys) {
  const joints = new Map(), shapes = [];
  polys.forEach((pts, k) => {
    pts.forEach(([x, y], i) => joints.set(`p${k}j${i}`, { x, y }));
    pts.forEach((_, i) => shapes.push({ id: `p${k}s${i}`, type: 'line', joints: [`p${k}j${i}`, `p${k}j${(i + 1) % pts.length}`] }));
  });
  return { joints, shapes, constraints: [], groups: [], profiles: [] };
}
const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const ONLINE = { cutType: 'online', cutDepth: 3.175, cutOffset: 0, toolDia: 3.175, cutterShape: 'endmill', cutterAngle: 90 };
const POCKET = { cutType: 'pocket', cutDepth: 6, cutOffset: 0, toolDia: 6, cutterShape: 'endmill', cutterAngle: 90, clearing: 'linked', loop: true, stepover: 40, finishAllowance: 0.5 };
const LEAD_FIELDS = /"leadIn/;
const v2 = (cutPlan, opOrder = []) => ({ version: 2, cutPlan, opOrder, stock: { thickness: 19.05, width: null, height: null, margin: 12.7 } });
const elementsOf = (svg) => [...svg.matchAll(/<path d="([^"]*)"[^>]*shaper:cutType="(\w+)"/g)].map((m) => ({ d: m[1], cutType: m[2] }));
const noLeadInLeft = (label) => {
  const doc = JSON.stringify(captureShaperDoc());
  ok(!LEAD_FIELDS.test(doc), `${label}: no leadIn field in the saved document`);
  ok(storeOps().every((op) => op.geometry.every((r) => !Object.hasOwn(r, 'at')) && !Object.keys(op.settings).some((k) => /^leadIn/.test(k))), `${label}: no leadIn setting, no membership 'at' in the store`);
};

const st = partState([rect(0, 0, 25.4, 25.4), rect(40, 0, 25.4, 25.4)]);
const { loops } = loopsWithPolygons(st);
const byX = (x) => loops.find((l) => l.joints.some((j) => st.joints.get(j).x === x));
const kA = keyOf('loop', byX(0).id), kB = keyOf('loop', byX(40).id);
eq(findLoops(st).length, 2, 'two 1 in squares');

// the reference: the same document with no lead-in at all
applyShaperDoc(v2([[kA, { ...ONLINE }], [kB, { ...POCKET }]]), st);
const plain = shaperSvgOf(st, planEntries());
const onlineSquare = elementsOf(plain).filter((e) => e.cutType === 'online' && /^M 0 0 /.test(e.d));
eq(onlineSquare.map((e) => e.d), ['M 0 0 L 25.4 0 L 25.4 25.4 L 0 25.4 Z'], 'reference: the On line square is the plain closed loop');
ok(elementsOf(plain).some((e) => e.cutType === 'guide'), 'reference: the pocket has its guide start mark');

// ── 1 + 3. version 2 documents with lead-in fields ──
{
  // 775's leg (Length only) on the On line square, and a pocket of before 778 with `leadIn: true`
  applyShaperDoc(v2([[kA, { ...ONLINE, leadIn: true, leadInLength: 6.35, leadInSide: 'outside' }], [kB, { ...POCKET, leadIn: true, leadInLength: 6 }]]), st);
  noLeadInLeft('v2, 775 leg + pocket leadIn');
  eq(shaperSvgOf(st, planEntries()), plain, 'v2, 775 leg + pocket leadIn: the file is the plain one (On line closed loop, pocket loop + start mark)');
  // 778's arc: every field, a dragged position
  applyShaperDoc(v2([[kA, { ...ONLINE, leadIn: true, leadInRadius: 6.35, leadInSweep: 90, leadInLength: 2, leadInSide: 'inside', leadInAt: 0.3 }], [kB, { ...POCKET }]]), st);
  noLeadInLeft('v2, 778 arc');
  eq(shaperSvgOf(st, planEntries()), plain, 'v2, 778 arc: the file is the plain one');
}

// ── 2. a stored operation order keyed with the lead-in ──
{
  // the order the app wrote before 836: the On line operation's key carried "leadIn":{...}; put it AFTER the pocket (not the default order)
  applyShaperDoc(v2([[kA, { ...ONLINE }], [kB, { ...POCKET }]]), st);
  const keyOnline = opKeyOf({ ...ONLINE }), keyPocket = opKeyOf({ ...POCKET });
  const oldOnlineKey = keyOnline.replace(/\}\]$/, ',"leadIn":{"radius":"calc","sweep":"calc","length":"calc","side":"outside","at":0.3}}]');
  ok(oldOnlineKey !== keyOnline && oldOnlineKey.includes('"leadIn":{'), 'an old key with its lead-in part: ' + oldOnlineKey);
  applyShaperDoc(v2([[kA, { ...ONLINE, leadIn: true, leadInSide: 'outside', leadInAt: 0.3 }], [kB, { ...POCKET }]], [keyPocket, oldOnlineKey]), st);
  eq(storeOps().map((op) => op.type), ['pocket', 'online'], 'the stored order is kept: the pocket first, then the On line operation whose stored key had a lead-in');
  noLeadInLeft('v2 with an old keyed order');
  ok(describeOperations(st, planEntries()).every((r) => !/lead/i.test(r.rowText)), 'the Operations rows say nothing of a lead-in');
}

// ── 1. a version 4 document whose operation settings and membership carry them ──
{
  applyShaperDoc(v2([[kA, { ...ONLINE }], [kB, { ...POCKET }]]), st);
  const doc = JSON.parse(JSON.stringify(captureShaperDoc()));
  eq(doc.version, 4, 'the current document version (4): no new version for a dropped field');
  const v4 = JSON.parse(JSON.stringify(doc));
  const on = v4.operations.find((op) => op.type === 'online');
  on.settings = { ...on.settings, leadIn: true, leadInRadius: null, leadInSweep: 45, leadInLength: 0, leadInSide: 'inside' };
  on.geometry = on.geometry.map((r) => ({ ...r, at: 0.25 }));
  applyShaperDoc(v4, st);
  noLeadInLeft('v4 with leadIn settings and a membership at');
  eq(JSON.parse(JSON.stringify(captureShaperDoc())), doc, 'v4: reads back as the same document without them');
  eq(shaperSvgOf(st, planEntries()), plain, 'v4: the file is the plain one');
  ok(v4.operations.find((op) => op.type === 'online').settings.leadIn === true, 'the caller\'s document object is not changed in place');
}

// ── 4. nothing of the lead-in left ──
{
  const root = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  ok(!fs.existsSync(path.join(root, 'packages/core/lead-in.js')), 'packages/core/lead-in.js is gone');
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'vendor' && e.name !== 'node_modules') walk(p); } else if (/\.(js|mjs|cjs|html|css|json)$/.test(e.name)) {
        fs.readFileSync(p, 'utf8').split('\n').forEach((l, i) => { if (/leadIn/.test(l)) hits.push(`${path.relative(root, p).replace(/\\/g, '/')}:${i + 1}`); });
      }
    }
  };
  walk(path.join(root, 'apps'));
  walk(path.join(root, 'packages'));
  const files = [...new Set(hits.map((h) => h.replace(/:\d+$/, '')))];
  eq(files, ['apps/shaper/src/shaper-doc.js'], 'the only `leadIn` left in apps/ and packages/ is the one drop on load (shaper-doc.js dropLeadIn): ' + hits.join(', '));
  ok(CUT_TYPES.every((t) => !t.fields.includes('leadIn') && !t.params.some((p) => /^leadIn/.test(p))), 'no cut type declares a lead-in setting or row');
  ok(!Object.keys(PARAM_HINTS).some((k) => /^leadIn/.test(k)), 'the hints table has no lead-in entry');
}

console.log(`leadin-removed-836-node: ok (${checks} checks)`);
