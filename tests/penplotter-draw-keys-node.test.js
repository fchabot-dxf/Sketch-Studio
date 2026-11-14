// tests/penplotter-draw-keys-node.test.js - TASK 629 (G7): the Draw stage's window keydown (apps/penplotter/src/keyboard.js) acts only while its
// stages (Toolpath, Export) are showing, and never on a key aimed at a text field. In Design the Draw tool letters leave state.tool alone.
import assert from 'node:assert';
import { open } from './helpers/node-app.js';

const app = await open({ host: 'penplotter' });
try {
  const win = app.window || app.document.defaultView;
  const press = (target, key) => target.dispatchEvent(new win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

  assert.strictEqual(app.router.currentStageId(), 'design', 'starts on Design');
  const before = app.plotter.tool;
  for (const k of ['t', 's', 'r', 'e', 'p', 'f', 'x', 'n']) press(app.document.body, k);
  assert.strictEqual(app.plotter.tool, before, 'Design: the Draw tool letters leave state.tool alone');

  const field = app.document.createElement('textarea');
  app.document.body.appendChild(field);
  app.router.showStage('toolpath');
  press(field, 'l');
  assert.strictEqual(app.plotter.tool, before, 'a key typed in a text field leaves state.tool alone');
  press(app.document.body, 'l');
  assert.strictEqual(app.plotter.tool, 'line', 'Toolpath: the Draw hotkey still sets the tool');
  console.log('PASS penplotter draw keys');
} finally { await app.close(); }
process.exit(0);
