// tests/cam-paths-787-review-live.test.js — TASK 787 (hunt 785 bug 5), desktop 1280 x 800, mm: the hunt's repro case (its live crash screenshot's drawing,
// .evidence/785/live-area2-prepare-ui.mjs; the 4 x 4 mm variant in live-area1 puts the label over 10 mm away and never crashed). A 10 x 10 mm programmed
// pocket (Spiral, 5 mm deep: its start mark near its middle) and a 2 x 2 mm Outside cut with its depth unset 0.5 mm beside it (its label within 10 mm of the
// start mark). Export 3D
// opened: no page error, the model builds ("triangles"), the pocket is cut at its 5 mm depth, the start mark and the depth-unset label are two marks.
import assert from 'node:assert';
import path from 'node:path';
import { openPocketPage } from './helpers/pocket-live.js';
import { sleep } from './helpers/cdp-browser.js';

const t = await openPocketPage({
  tag: '787-review',
  evidenceDir: path.resolve('.evidence/787'),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
try {
  const { evalJs, waitFor, clickEl, openMode, shot, setUnit } = t;
  await setUnit('mm');
  await openMode('design');
  await waitFor('!!(window.__designController && window.__designController.state)', 'design ready');
  // the page's uncaught errors from here on (what blanked Export 3D)
  // (kept on the page's root element as JSON: the test reads it back; nothing is added to the app)
  await evalJs(`(() => { const root = document.documentElement; root.dataset.t787errs = '[]';
    const add = (text) => { root.dataset.t787errs = JSON.stringify([...JSON.parse(root.dataset.t787errs), text]); };
    window.addEventListener('error', (e) => add(String((e.error && e.error.stack) || e.message)));
    window.addEventListener('unhandledrejection', (e) => add(String((e.reason && e.reason.stack) || e.reason))); })()`);
  const keys = await evalJs(`(async () => {
    const st = window.__designController.state;
    for (const k of [...st.joints.keys()]) st.joints.delete(k);
    st.shapes.length = 0; st.constraints.length = 0; st.profiles.length = 0;
    [[0, 0], [10, 0], [10, 10], [0, 10]].forEach(([x, y], i) => st.joints.set('pj' + i, { x, y }));
    for (let i = 0; i < 4; i++) st.shapes.push({ id: 'ps' + i, type: 'line', joints: ['pj' + i, 'pj' + ((i + 1) % 4)] });
    [[10.5, 4], [12.5, 4], [12.5, 6], [10.5, 6]].forEach(([x, y], i) => st.joints.set('oj' + i, { x, y }));
    for (let i = 0; i < 4; i++) st.shapes.push({ id: 'os' + i, type: 'line', joints: ['oj' + i, 'oj' + ((i + 1) % 4)] });
    st.saveState('draw');
    const lf = await import('/packages/core/loop-finder.js');
    const cp = await import('/tests/helpers/plan-v2.js');
    cp.V2_PLAN.clear();
    const loops = lf.findLoops(st);
    const pLoop = loops.find((l) => l.edges.some((e) => e.startsWith('ps')));
    const oLoop = loops.find((l) => l.edges.some((e) => e.startsWith('os')));
    cp.V2_PLAN.set('loop:' + pLoop.id, { cutType: 'pocket', cutDepth: 5, cutOffset: 0, toolDia: 3.175, clearing: 'linked', stepover: 40, finishAllowance: 0.5 });
    cp.V2_PLAN.set('loop:' + oLoop.id, { cutType: 'exterior', cutDepth: 'unset', cutOffset: 0, toolDia: 3.175 });
    return ['loop:' + pLoop.id, 'loop:' + oLoop.id];
  })()`);
  await openMode('review');
  await clickEl('#review-view-3d');
  await waitFor(`/triangles/.test(document.getElementById('review-info').textContent)`, 'Export 3D built');
  await sleep(500);
  const errs = JSON.parse(await evalJs(`document.documentElement.dataset.t787errs`));
  eq(errs, [], 'no page error opening Export 3D');
  const info = await evalJs(`document.getElementById('review-info').textContent`);
  console.log('review-info: ' + info);
  ok(/1 Outside\/Inside cut with depth unset shown cut through/.test(info), 'the info line names the depth-unset cut: ' + info);
  const rel = await evalJs(`Promise.all([import('/packages/core/relief-model.js'), import('/tests/helpers/plan-v2.js')]).then(([R, C]) => { const r = R.buildRelief({ items: C.planReliefItems(window.__designController.state) }); return { marks: r.marks.map((m) => ({ kind: m.kind, key: m.key, keys: m.keys || null })), levels: r.levels.map((l) => [l.depth, l.through]) }; })`);
  console.log('marks: ' + JSON.stringify(rel.marks) + ' levels: ' + JSON.stringify(rel.levels));
  ok(rel.levels.some(([d, through]) => d === 5 && !through), 'the pocket is cut at 5 mm');
  eq(rel.marks.map((m) => m.kind).sort(), ['depth-unset', 'pocket-start'], 'the start mark and the depth-unset label are two marks');
  eq(rel.marks.find((m) => m.kind === 'depth-unset').keys, [keys[1]], 'the label names the Outside cut only');
  const shown = await evalJs(`document.querySelectorAll('#review-stage canvas').length`);
  ok(shown >= 1, 'the 3D canvas is shown');
  await clickEl('#review-top');
  await sleep(600);
  await shot('bug5-review-3d-top.png', '#review-stage', 1.5);
} finally {
  await t.close();
}
console.log(`cam-paths-787-review-live: ok (${checks} checks)`);
