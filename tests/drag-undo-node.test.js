// tests/drag-undo-node.test.js — TASK 580 (node port of tests/drag-undo-live.test.js, TASK 545), SketchStudio and the Shaper Design tab through
// tests/helpers/node-app.js: draw two lines and a circle, then in the select tool drag a joint, a line body, a circle rim; after EACH drag the undo
// history grew by ONE step labelled by the drag kind (read from the Diagnostic Log's report journal, app.report()), Ctrl+Z restores exactly the
// pre-drag joints and shapes and Ctrl+Y re-applies the drag. A click without movement adds no step.
import assert from 'node:assert';
import { open } from './helpers/node-app.js';

const measured = {};
for (const host of [{ name: 'SketchStudio', id: 'sketchstudio' }, { name: 'Shaper Design', id: 'shaper' }]) {
  const app = await open({ host: host.id });
  try {
    const r = app.svg.getBoundingClientRect();
    const cv = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    const click = (x, y) => app.click(x, y);
    const takeReport = () => JSON.parse(JSON.stringify(app.report())); // the browser test got the report back as the clipboard's JSON text
    const joints = (rep) => JSON.stringify(rep.document.geometry.joints);
    // a circle-rim drag changes the RADIUS (a solver unknown, task 515), not a joint: the drag result is the joints AND the shapes
    const geom = (rep) => joints(rep) + JSON.stringify(rep.document.geometry.shapes);
    const labelsOf = (rep) => rep.journal.steps.map((s) => s.label);
    const pre = new Set(takeReport().document.geometry.shapes.map((x) => x.id));
    // seed with the real tools: two lines (click, click, Escape), a circle (centre click, rim click)
    app.tool('line'); click(cv.x - 250, cv.y - 150); click(cv.x - 100, cv.y - 150); app.esc();
    app.tool('line'); click(cv.x - 250, cv.y + 50); click(cv.x - 100, cv.y + 50); app.esc();
    app.tool('circle'); click(cv.x + 150, cv.y); click(cv.x + 220, cv.y); app.esc();
    app.tool('select');
    const r0 = takeReport();
    const g0 = r0.document.geometry;
    const lines = g0.shapes.filter((s) => s.type === 'line' && !pre.has(s.id)), circ = g0.shapes.find((s) => s.type === 'circle' && !pre.has(s.id));
    assert.strictEqual(lines.length, 2, host.name + ': two lines drawn'); assert(circ, host.name + ': a circle drawn');
    const J = (id) => g0.joints.find((e) => e[0] === id)[1];
    const kinds = [
      ['joint', 'drag point', () => { const p = app.toScreen(J(lines[0].joints[1]).x, J(lines[0].joints[1]).y); return [p, { x: p.x + 60, y: p.y - 50 }]; }],
      ['line body', 'drag line', () => { const a = J(lines[1].joints[0]), b = J(lines[1].joints[1]); const p = app.toScreen((a.x + b.x) / 2, (a.y + b.y) / 2); return [p, { x: p.x + 40, y: p.y + 60 }]; }],
      ['circle rim', 'drag circle', () => { const c = J(circ.joints[0]); const p = app.toScreen(c.x + circ.radius, c.y); return [p, { x: p.x + 50, y: p.y }]; }],
    ];
    let prev = r0;
    measured[host.name] = {};
    for (const [kind, label, plan] of kinds) {
      const [from, to] = plan();
      app.drag(from, to, 10);
      const after = takeReport();
      assert.notStrictEqual(geom(after), geom(prev), `${host.name} ${kind}: the drag moved something`);
      const result = { stepsBefore: labelsOf(prev).length, stepsAfterDrag: labelsOf(after).length, newLabels: labelsOf(after).slice(labelsOf(prev).length) };
      measured[host.name][kind] = result;
      assert.deepStrictEqual(result.newLabels, [label], `${host.name} ${kind}: ONE new undo step labelled "${label}": ${JSON.stringify(result)}`);
      app.undo();
      const undone = takeReport();
      result.stepsAfterUndo = labelsOf(undone).length;
      assert.strictEqual(geom(undone), geom(prev), `${host.name} ${kind}: Ctrl+Z restores exactly the pre-drag joints and shapes`);
      assert.strictEqual(labelsOf(undone).length, labelsOf(prev).length, `${host.name} ${kind}: the step is gone from the history`);
      app.redo();
      const redone = takeReport();
      assert.strictEqual(geom(redone), geom(after), `${host.name} ${kind}: Ctrl+Y re-applies the drag`);
      prev = redone;
    }
    // a click on a joint without movement: no step
    const p = app.toScreen(J(lines[0].joints[0]).x, J(lines[0].joints[0]).y);
    click(p.x, p.y);
    assert.strictEqual(labelsOf(takeReport()).length, labelsOf(prev).length, host.name + ': a click without movement adds no step');
  } finally { await app.close(); }
}
console.log('drag-undo-node.test.js: ok', JSON.stringify(measured));
