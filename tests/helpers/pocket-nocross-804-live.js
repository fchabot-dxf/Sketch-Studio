// tests/helpers/pocket-nocross-804-live.js — TASK 804: the owner's triangle BOW-TIE in the real Shaper page (desktop: mm; phone: inches), bit and depth
// 0.125 in: Spiral Loop off (2 lines: the pocket narrows, one per area), Spiral Loop on (2 closed loops), Morphed spiral (3 paths: one per area, no longer
// refused), Morphed + Loop (refused with its reason: its way back would cross), the card's note for each, the Paths drawn on the Prepare canvas read back
// and checked with THE crossing check (#core/path-crossings.js: 0), and the download (each element with its own cut attributes, its paths 0 crossings).
// Screenshots to .evidence/804/. Used by tests/pocket-nocross-804-live.test.js and tests/pocket-nocross-804-phone-live.test.js.
import assert from 'node:assert';
import { pathCrossings } from '#core/path-crossings.js';

const IN = 25.4;
export const BOWTIE = [[0, 0], [3.2, 1.55], [6.4, 0], [6.4, 4.2], [3.2, 2.65], [0, 4.2]].map(([x, y]) => [x * IN, y * IN]);
// the paths of an SVG `d` list (M / L / Z only: the clearing is written as lines) in mm
const pathsOf = (ds) => ds.map((d) => {
  const nums = d.replace(/[MLZ]/g, ' ').trim().split(/\s+/).map(Number), points = [];
  for (let i = 0; i + 1 < nums.length; i += 2) points.push({ x: nums[i], y: nums[i + 1] });
  return { points, closed: /Z\s*$/.test(d) };
});

export async function bowtiePhase(t, label) {
  const { phone, evalJs, waitFor, openMode, clickEl, clickWorld, pickType, typeField, card, pickClearing, setLoop, download, shotWorld } = t;
  const inch = await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.docUnit() === 'in')`);
  const D = phone ? 'phone' : 'desktop';
  await openMode('design');
  await waitFor('!!(window.__designController && window.__designController.state)', 'design controller ready');
  await evalJs(`import('/tests/helpers/plan-v2.js').then((m) => m.V2_PLAN.clear())`);
  const n = await evalJs(`(() => {
    const st = window.__designController.state;
    for (const k of [...st.joints.keys()]) st.joints.delete(k);
    st.shapes.length = 0; st.constraints.length = 0;
    const pts = ${JSON.stringify(BOWTIE)};
    pts.forEach(([x, y], i) => st.joints.set('Bj' + i, { x, y }));
    pts.forEach((_, i) => st.shapes.push({ id: 'Bs' + i, type: 'line', joints: ['Bj' + i, 'Bj' + ((i + 1) % pts.length)] }));
    st.saveState('draw');
    return st.shapes.length; })()`);
  assert.strictEqual(n, 6, label + ': the bow-tie drawn');
  await openMode('prepare');
  if (phone && !await evalJs(`document.querySelector('#prepare-ops .ops-body').hidden`)) await clickEl('#prepare-ops .ops-head'); // the folded bar keeps the card free
  await clickWorld(30, 53);
  await waitFor(`!document.querySelector('#prepare-panel .cut-card').hidden`, label + ': the card');
  await pickType('pocket');
  await typeField('.cut-depth', inch ? '0.125' : '3.175');
  await typeField('.cut-bit', inch ? '0.125' : '3.175');
  // the clearing drawn on the Prepare canvas (the Paths): its d's, checked with THE crossing check
  const drawn = async () => pathsOf(await evalJs(`[...document.querySelectorAll('#prepare-toolpath-group .sk-clear-path')].map((p) => p.getAttribute('d'))`));
  const box = [-4, -4, 6.4 * IN + 4, 4.2 * IN + 4];
  const step = async (name, clearing, loop, noteRe, paths) => {
    await pickClearing(clearing);
    await setLoop(loop);
    await waitFor(`document.querySelectorAll('#prepare-toolpath-group .sk-clear-path').length > 0`, label + ': ' + name + ' drawn');
    const c = await card(), ps = await drawn(), x = pathCrossings(ps);
    assert.ok(noteRe.test(c.note[0]), `${label} ${name}: the note: ${c.note[0]}`);
    assert.strictEqual(ps.length, paths, `${label} ${name}: ${paths} path(s) drawn`);
    assert.strictEqual(x.count, 0, `${label} ${name}: the drawn paths cross nowhere ${JSON.stringify(x.crossings.slice(0, 3))}`);
    await shotWorld(`804-${D}-bowtie-${name}.png`, box, phone ? 2 : 1.5);
    console.log(`${label} ${name}: ${ps.length} path(s), 0 crossings; note: ${c.note.join(' | ')}`);
    return c;
  };
  const n2 = inch ? '0.05 in' : '1.27 mm';
  await step('spiral-loop-off', 'linked', false, new RegExp(`^Pocket: spiral, \\d+ turns in 2 lines \\(the pocket narrows: one per area\\) \\+ wall, stepover ${n2.replace('.', '\\.')}`), 2);
  await step('spiral-loop-on', 'linked', true, /^Pocket: spiral, \d+ turns \+ wall: 2 closed loops \(the pocket narrows: one per area\), stepover/, 2);
  // the download of the Spiral Loop: each element its own cut attributes (TASK 802), the written paths cross nowhere
  const svg = await download();
  const els = [...svg.matchAll(/<(path|circle|polygon)\s([^>]*)\/>/g)].map((m) => m[2]);
  const online = els.filter((a) => /shaper:cutType="online"/.test(a));
  assert.strictEqual(online.length, 2, label + ': the download: 2 closed on-line paths');
  assert.ok(online.every((a) => /shaper:cutDepth="0\.125 in"|shaper:cutDepth="3\.175 mm"/.test(a) && /shaper:toolDia="0\.125 in"|shaper:toolDia="3\.175 mm"/.test(a)), label + ': each with its own depth and bit: ' + online.map((a) => a.replace(/(?:^|\s)d="[^"]*"/, '')).join(' / '));
  const written = pathsOf(online.map((a) => /(?:^|\s)d="([^"]+)"/.exec(a)[1]));
  assert.ok(written.every((p) => p.closed), label + ': both closed (Z)');
  assert.strictEqual(pathCrossings(written).count, 0, label + ': the written paths cross nowhere');
  console.log(`${label}: download: ${online.map((a) => a.replace(/(?:^|\s)d="[^"]*"/, '').trim()).join(' / ')}`);
  await openMode('prepare');
  await clickWorld(30, 53); // the pocket again: its card
  await waitFor(`!document.querySelector('#prepare-panel .cut-card').hidden`, label + ': the card again');
  await step('morphed', 'morphed', false, /^Pocket: morphed spiral: \d+ turns in 3 paths \(the pocket narrows: one per area\) \+ wall/, 3);
  // Morphed + Loop: one closed loop per area where its way back half way between the turns crosses nothing, else refused with its reason (the
  // allowance decides on this shape: 0.5 mm closes, 0.02 in is refused; both are checked by tests/pocket-nocross-804-node.test.js's rule)
  const c = await step('morphed-loop-on', 'morphed', true, /^Pocket: morphed spiral: \d+ turns( \+ wall: 3 closed loops \(the pocket narrows: one per area\),| in 3 paths \(the pocket narrows: one per area\) \+ wall,)/, 3);
  const refused = c.note.includes('Loop refused: its way back would cross the turns on this shape; cut as open paths + the wall');
  assert.ok(refused === / in 3 paths/.test(c.note[0]), label + ': Morphed + Loop: 3 closed loops, or refused with its reason: ' + c.note.join(' | '));
}
