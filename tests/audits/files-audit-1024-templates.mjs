// tests/audits/files-audit-1024-templates.mjs — TASK 1024 (AUDIT ONLY): every template inserted through the real UI ("+" tab button > template card > Open).
// Records: opens as a new tab, shapes, fully constrained or not (joint DOF through window.ug.debug.dof), dimensions, Undo right after opening, Ctrl+S.
// Run: node tests/audits/files-audit-1024-templates.mjs      Rows F-70.n
import { startKit, row, sleep } from './files-audit-1024-kit.js';
import { TEMPLATES } from '../../packages/core/templates.js';

const k = await startKit({ tag: '1024-tpl' });
const state = () => k.evalJs(`(() => {
  const svg = document.getElementById('svgCanvas');
  const joints = (window.ug && window.ug.debug && window.ug.debug.dof) ? window.ug.debug.dof.logAll() : null;
  const non = joints ? joints.filter((j) => j.id !== 'j_origin') : [];
  const free = non.filter((j) => j.dof > 0);
  const shapes = [...svg.querySelectorAll('.shape-elem[data-shape-id]')];
  const blue = shapes.filter((el) => /#2b9bd6|43,\\s*155,\\s*214/i.test(getComputedStyle(el).stroke || '')).length;
  const labels = [...svg.querySelectorAll('.dim-label[data-constraint-idx]')].map((g) => (g.querySelector('text') || g).textContent.trim());
  const u = document.querySelector('#btn-undo, button[aria-label="Undo"]');
  return { joints: non.length, freeJoints: free.length, totalDof: non.reduce((a, j) => a + (j.dof || 0), 0), shapes: shapes.length, blue, labels, canUndo: u ? !u.disabled : null };
})()`);
const ids = process.env.ONLY_TAIL ? [] : TEMPLATES.map((t) => t.id);
let n = 0;
const summary = [];
try {
  for (const id of ids) {
    n++;
    await k.open('sketchstudio');
    await k.clearToasts();
    await k.press('.sk-doctab-new');
    const shown = await k.waitFor(`!!document.querySelector('.sk-tp-card[data-template="${id}"]')`, 'card ' + id, 6000).catch(() => null);
    if (!shown) { row(`F-70.${n}`, `${id}: its card is not in the picker`); continue; }
    await k.waitFor(`document.querySelector('.sk-tp-grid') && document.querySelector('.sk-tp-grid').dataset.previews === 'ready'`, 'previews', 15000).catch(() => {});
    await k.press(`.sk-tp-card[data-template="${id}"]`);
    await sleep(400);
    const opened = await k.press('.sk-tp-open');
    await sleep(1400);
    const err = await k.evalJs(`(document.querySelector('.sk-tp-err') || {}).textContent || ''`);
    const tabs = await k.tabs();
    const st = await state();
    const toasts = await k.toasts();
    const picked = await k.modal();
    // Undo right after opening
    await k.ctrlZ(); await sleep(400);
    const afterUndo = await state();
    const tabsAfter = await k.tabs();
    await k.ctrlShiftZ(); await sleep(400);
    const afterRedo = await state();
    const full = st.joints > 0 && st.freeJoints === 0 && st.blue === 0;
    summary.push({ id, full });
    row(`F-70.${n}`, `${id}: open pressed=${opened} picker still open=${!!picked && /New design|${id}/i.test(picked.label || '')} err="${err}" tabs=${JSON.stringify(tabs.map((t) => [t.name, t.active ? 'A' : '', t.dot ? 'dot' : '']))} shapes=${st.shapes} joints=${st.joints} freeJoints=${st.freeJoints} totalDOF=${st.totalDof} blueShapes=${st.blue} fullyConstrained=${full} dims=${st.labels.length} ${JSON.stringify(st.labels.slice(0, 5))} canUndo=${st.canUndo} | Ctrl+Z: shapes ${st.shapes}->${afterUndo.shapes} tabs ${tabs.length}->${tabsAfter.length} | redo: shapes=${afterRedo.shapes} toasts=${JSON.stringify(toasts)}`);
    if (n === 1 || id === 'spur-gear' || id === 'box-frame') await k.shotFull(`F70-${id}.png`).then((e) => row(`F-70.${n}e`, 'evidence ' + e));
  }
  row('F-71', `templates fully constrained after opening: ${summary.filter((s) => s.full).length}/${summary.length}; not fully constrained: ${JSON.stringify(summary.filter((s) => !s.full).map((s) => s.id))}`);

  // ---- editability: change a user parameter of one template through the Parameters window? (read: does the doc carry user parameters and driving dims)
  await k.open('sketchstudio');
  await k.press('.sk-doctab-new'); await k.waitFor(`!!document.querySelector('.sk-tp-card[data-template="l-bracket"]')`, 'card', 6000);
  await k.press('.sk-tp-card[data-template="l-bracket"]'); await sleep(400); await k.press('.sk-tp-open'); await sleep(1400);
  await k.flush();
  const buf = await k.buffer();
  const tb = buf && buf.tabs.find((t) => t.name === 'L-bracket' || (t.doc && t.doc.geometry && t.doc.geometry.parameters && t.doc.geometry.parameters.length));
  row('F-72a', 'buffer tabs: ' + JSON.stringify(buf && buf.tabs.map((t) => [t.name, !!t.doc])));
  const g = tb && tb.doc.geometry;
  row('F-72', `L-bracket as opened, stored: params=${JSON.stringify(g && g.parameters && g.parameters.map((p) => [p.name, p.expression]))} driving dims=${g ? g.constraints.filter((c) => c.type === 'distance' && !c.isDriven).length : '-'} formula dims=${g ? g.constraints.filter((c) => c.expression).length : '-'}`);
  // template then Save as Local then re-open: constrained state kept?
  await k.menu('save-as'); await k.waitFor(`!!document.querySelector('.sk-fd')`, 'dlg'); await k.enter();
  const f = await k.waitDownload(1, 'tpl save', 5000);
  await sleep(500);
  row('F-73', `template tab, Save as Local with the default name: download=${f ? f.name : 'none'} tab=${JSON.stringify(await k.active())}`);
} finally {
  console.log(`BLOCKED non-local requests: ${k.net.blocked().length}`);
  await k.close();
}
