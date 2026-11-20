// tests/close-path-760-shaper-live.test.js — TASK 760: Close path in Shaper, in depth (desktop 1280 x 800, real mouse and keys; tests/helpers/close-path-live.js).
// The fixture (a 30 x 20 mm plate 0.08 mm short of closed + an open engraving zigzag) is dropped on the Design canvas:
//  1. PREPARE BEFORE: the plate is an open chain: a click on its edge picks it; TASK S2 (owner turn 2716): the cut-type menu offers every type (never greyed),
//     a pick of Inside, Outside or Pocket makes NO operation and the card's note says why in one plain line, On line makes one (Cancel removes it); a click
//     inside it picks nothing (no region);
//  2. DESIGN: Shift+C, a click on the plate's edge closes it: ONE line, in the plate's own group (the import's "plate" group, not entered: one rigid
//     block with the whole file: nothing is entered), only two coincidents added; findLoops (the page's own #core module on the page's state) returns the plate as a loop;
//  3. PREPARE AFTER: a click inside the plate picks the region; the type menu's Inside is enabled; picking it makes the card's type Inside (screenshot).
import assert from 'node:assert';
import { openClosePathPage, HOSTS, IMPORTED } from './helpers/close-path-live.js';
import { sleep } from './helpers/cdp-browser.js';

const t = await openClosePathPage(HOSTS.shaper);
if (!t) console.log('skipped: no headless Edge/Chrome binary installed');
else {
  const out = {};
  const { evalJs, waitFor } = t;
  const state = (js) => evalJs(`(() => { const st = window.__designController.state; ${js} })()`);
  const stage = async (id) => { await t.click(await evalJs(`(() => { const r = document.querySelector('.sk-header-tab[data-tab="${id}"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`)); await sleep(500); };
  const prepAt = (x, y) => evalJs(`(() => { const svg = document.getElementById('prepare-canvas'); const p = svg.createSVGPoint(); p.x = ${x}; p.y = ${y}; const s = p.matrixTransform(svg.getScreenCTM()); return { x: s.x, y: s.y }; })()`);
  const cardShown = () => evalJs(`(() => { const c = document.querySelector('#prepare-panel .cut-card'); return !!c && !c.hidden && c.getBoundingClientRect().height > 0; })()`);
  const typeMenu = async () => {
    await t.click(await evalJs(`(() => { const r = document.querySelector('#prepare-panel .cut-type-trigger').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`));
    await waitFor(`!document.querySelector('.cut-type-menu').hidden`, 'the type menu');
    return evalJs(`Object.fromEntries([...document.querySelectorAll('.cut-type-menu .cut-type-opt')].map((o) => [o.dataset.id, !o.disabled]))`);
  };
  try {
    const base = await t.open();
    // 1. Prepare before
    await stage('prepare');
    await t.click(await prepAt(25, 20));
    out.insideBefore = await cardShown();
    assert.strictEqual(out.insideBefore, false, '1: a click inside the open plate picks nothing (no region)');
    await t.click(await prepAt(25, 10));
    assert.ok(await cardShown(), '1: a click on the plate\'s edge picks the open chain');
    out.menuBefore = await typeMenu();
    assert.deepStrictEqual([out.menuBefore.interior, out.menuBefore.exterior, out.menuBefore.pocket, out.menuBefore.online], [true, true, true, true], '1: on the open chain: every type offered, none greyed (TASK S2, owner turn 2716): ' + JSON.stringify(out.menuBefore));
    await t.shot('shaper-prepare-before-open-chain.png', await evalJs(`(() => { const r = document.querySelector('.cut-type-menu').getBoundingClientRect(); return { x: r.left - 10, y: r.top - 10, width: r.width + 20, height: r.height + 20 }; })()`));
    // TASK S2: a closed-only type picked for the open chain: no operation, the plain refusal line in the card's note; On line: a new operation, open
    const nOps = () => evalJs(`import('/apps/shaper/src/operations-store.js').then((m) => m.storeOps().length)`);
    const pickOpt = async (id) => {
      if (await evalJs(`document.querySelector('.cut-type-menu').hidden`)) await typeMenu();
      await t.click(await evalJs(`(() => { const r = document.querySelector('.cut-type-menu .cut-type-opt[data-id="${id}"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`));
      await sleep(200);
    };
    const n0 = await nOps();
    out.refused = {};
    for (const [id, name] of [['pocket', 'Pocket'], ['interior', 'Inside'], ['exterior', 'Outside']]) {
      await pickOpt(id);
      const note = await evalJs(`[...document.querySelectorAll('#prepare-panel .cut-note div')].map((d) => d.textContent).join(' | ')`);
      out.refused[id] = note;
      assert.strictEqual(await nOps(), n0, `1: ${name} on the open chain: no operation made`);
      assert.strictEqual(note, `This open line can\u2019t be ${name === 'Inside' || name === 'Outside' ? 'an' : 'a'} ${name}: ${name === 'Inside' || name === 'Outside' ? 'an' : 'a'} ${name.toLowerCase()} needs a closed shape`, `1: ${name}: the plain refusal line: ${note}`);
    }
    await pickOpt('online');
    assert.deepStrictEqual([await nOps(), await evalJs(`document.querySelector('#prepare-panel .cut-type-cur').textContent`), await evalJs(`!document.querySelector('#prepare-panel .cut-actions').hidden`)], [n0 + 1, 'On line', true], '1: On line on the open chain: a new operation, open');
    await t.click(await evalJs(`(() => { const r = document.querySelector('#prepare-panel .cut-cancel').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`));
    await sleep(200);
    assert.strictEqual(await nOps(), n0, '1: its Cancel removes it');
    await t.keys.esc();
    // 2. Design: Close path on the plate
    await stage('design');
    await waitFor(`document.getElementById('design-canvas').getBoundingClientRect().width > 0`, 'Design shown');
    const groupBefore = await state(`return st.shapes.find((s) => s.joints.some((j) => { const p = st.joints.get(j); return p && p.x === 40 && p.y === 10; })).userGroupId;`);
    const nCons = await state(`return st.constraints.length;`);
    await t.keys.closePath();
    assert.strictEqual(await t.markers(), 4, '2: the 4 open ends marked');
    await t.click(await t.toScreen(25, 10));
    out.after = await state(`const line = st.shapes[st.shapes.length - 1]; return { shapes: st.shapes.length, line: { type: line.type, construction: !!line.isConstruction, group: line.userGroupId },
      added: st.constraints.slice(${nCons}).map((c) => c.type), blocks: st.groups.length };`);
    assert.strictEqual(out.after.shapes, base + IMPORTED + 1, '2: one closing line');
    assert.deepStrictEqual(out.after.line, { type: 'line', construction: false, group: groupBefore }, '2: a normal line in the plate\'s own group (' + groupBefore + ')');
    assert.deepStrictEqual(out.after.added, ['coincident', 'coincident'], '2: only two coincidents added');
    out.loops = await evalJs(`import('/packages/core/loop-finder.js').then((m) => m.findLoops(window.__designController.state).map((l) => l.edges.length))`);
    assert.deepStrictEqual(out.loops, [5], '2: findLoops returns the plate (its 4 lines + the closing line)');
    out.blockRigid = await evalJs(`import('/packages/core/group-model.js').then((m) => { const st = window.__designController.state; const b = m.rigidBlocks(st).find((x) => x.shapes.some((s) => s.id === st.shapes[st.shapes.length - 1].id)); return b ? b.shapes.length : 0; })`);
    assert.ok(out.blockRigid >= 5, '2: the closing line is in the plate\'s rigid block (' + out.blockRigid + ' curves)');
    await t.keys.select();
    // 3. Prepare after: Inside
    await stage('prepare');
    await t.click(await prepAt(25, 20));
    assert.ok(await cardShown(), '3: a click inside the closed plate picks its region');
    out.menuAfter = await typeMenu();
    assert.strictEqual(out.menuAfter.interior, true, '3: Inside is enabled: ' + JSON.stringify(out.menuAfter));
    await t.click(await evalJs(`(() => { const r = document.querySelector('.cut-type-menu .cut-type-opt[data-id="interior"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`));
    out.type = await evalJs(`document.querySelector('#prepare-panel .cut-type-cur').textContent`);
    assert.strictEqual(out.type, 'Inside', '3: the plate takes an Inside cut');
    await t.shot('shaper-prepare-after-inside-cut.png', await evalJs(`(() => { const svg = document.getElementById('prepare-canvas').getBoundingClientRect(), c = document.querySelector('#prepare-panel').getBoundingClientRect(); const x = Math.max(0, Math.min(svg.left, c.left)); return { x, y: svg.top, width: Math.min(innerWidth, Math.max(svg.right, c.right)) - x, height: Math.min(svg.height, 700), scale: 1 }; })()`));
    console.log(`close-path-760-shaper-live: ALL CHECKS PASSED ${JSON.stringify(out)}`);
  } finally { await t.close(); }
}
