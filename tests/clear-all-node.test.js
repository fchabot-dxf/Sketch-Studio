// tests/clear-all-node.test.js - TASK 576 (node port of tests/clear-all-live.test.js, TASK 498), SketchStudio through tests/helpers/node-app.js:
// Clear All ALWAYS empties the whole board, even with a selection (it used to delete only the selection), and a repeated click on an empty
// board is harmless. Counts and the selected look are read from the drawn canvas, as the browser test read them.
import assert from 'node:assert';
import { open } from './helpers/node-app.js';

const app = await open({ host: 'sketchstudio' });
let failed = null;
try {
  const r = app.svg.getBoundingClientRect();
  const cv = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  const clickBtn = (id) => { app.document.getElementById(id).click(); app.frames(); };
  const counts = () => ({ shapes: app.svg.querySelectorAll('.shape-elem').length, joints: new Set([...app.svg.querySelectorAll('.joint-handle')].map((e) => e.dataset.jointId)).size });
  const drag = (pts) => app.drag({ x: pts[0][0], y: pts[0][1] }, { x: pts[2][0], y: pts[2][1] }, 8);
  const draw3 = () => {
    clickBtn('tool-circle');
    drag([[cv.x - 200, cv.y - 100], [cv.x - 170, cv.y - 100], [cv.x - 150, cv.y - 100]]);
    drag([[cv.x, cv.y - 100], [cv.x + 30, cv.y - 100], [cv.x + 50, cv.y - 100]]);
    drag([[cv.x + 200, cv.y - 100], [cv.x + 230, cv.y - 100], [cv.x + 250, cv.y - 100]]);
  };
  draw3();
  const drawn = counts();
  assert.strictEqual(drawn.shapes, 3, 'three shapes drawn: ' + JSON.stringify(drawn));

  // select one (Select tool, click its rim), then Clear All: the WHOLE board goes, not just the selection
  clickBtn('tool-select');
  app.click(cv.x + 50, cv.y - 100);
  const styles = [...app.svg.querySelectorAll('.shape-elem')].map((e) => e.getAttribute('style') + '|' + e.getAttribute('stroke-width'));
  assert(new Set(styles).size > 1, 'one shape renders as selected (differs from the other two): ' + JSON.stringify(styles));
  clickBtn('btn-clear');
  const after = counts();
  assert.strictEqual(after.shapes, 0, 'Clear All with a selection empties the board: ' + JSON.stringify(after));
  assert(after.joints <= 1, 'only the origin joint remains: ' + JSON.stringify(after));

  // repeated click on an empty board is harmless
  clickBtn('btn-clear'); clickBtn('btn-clear');
  assert.deepStrictEqual(counts(), after, 'repeated Clear All on an empty board changes nothing');

  // and the board is usable afterwards
  draw3();
  assert.strictEqual(counts().shapes, 3, 'drawing works after Clear All');
  clickBtn('btn-clear');
  assert.strictEqual(counts().shapes, 0, 'Clear All with no selection also empties the board');
  console.log('clear-all-node: ok', JSON.stringify(after));
} catch (e) { failed = e; } finally { await app.close(); }
if (failed) { console.error(failed.stack || failed.message || failed); process.exitCode = 1; }
