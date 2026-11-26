// tests/refusal-units-ux18-1013-node.test.js — TASK 1013 guarding test for UX-18
// In an inch document (DOC_UNIT='in', decimal and fractional), a refused dimension edit's toast
// must format the refused value in DOCUMENT units (e.g. "100 in" or 100"), NEVER raw internal mm ("2540").
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { showEditInput } from '#ui/numeric-input-manager.js';
import SettingsManager from '#core/settings-manager.js';

let passed = 0;
async function run(name, fn) {
  await fn();
  passed++;
  console.log(`  ok: ${name}`);
}

const triDoc = () => ({
  version: 3, hosts: {},
  geometry: {
    joints: [
      ['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }],
      ['a', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }],
      ['b', { x: 30, y: 0, fixed: false, sketchId: 'sketch-1' }],
      ['c', { x: 30, y: 40, fixed: false, sketchId: 'sketch-1' }],
    ],
    shapes: [
      { id: 'L1', type: 'line', joints: ['a', 'b'], sketchId: 'sketch-1' },
      { id: 'L2', type: 'line', joints: ['b', 'c'], sketchId: 'sketch-1' },
      { id: 'L3', type: 'line', joints: ['c', 'a'], sketchId: 'sketch-1' },
    ],
    constraints: [
      { type: 'horizontal', joints: ['a', 'b'] },
      { type: 'distance', joints: ['a', 'b'], value: 30, name: 'd1' },
      { type: 'distance', joints: ['b', 'c'], value: 40, name: 'd2' },
      { type: 'distance', joints: ['c', 'a'], value: 50, name: 'd3' },
    ],
    parameters: [],
    sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }],
    activeSketchId: 'sketch-1', groups: [], profiles: [],
  },
});

const readToasts = (app) => [...app.document.querySelectorAll('#notification-container [data-level]')].map((e) => e.textContent.trim().replace(/\s+/g, ' ')).filter(Boolean);
const clearToasts = (app) => { for (const e of app.document.querySelectorAll('#notification-container [data-level]')) e.remove(); };

async function editAndReadToast(app, name, text) {
  clearToasts(app);
  const c = app.state.constraints.find((x) => x.name === name);
  showEditInput(app.svg, app.state, c);
  const inp = app.document.getElementById('dimInput');
  inp.focus();
  inp.value = text;
  inp.dispatchEvent(new app.window.Event('input', { bubbles: true }));
  inp.dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  return readToasts(app);
}

const prevUnit = SettingsManager.get('DOC_UNIT');
const prevInch = SettingsManager.get('INCH_DISPLAY');

try {
  await run('UX-18: decimal inch document formats impossible triangle edit refusal as "100 in", not "2540"', async () => {
    SettingsManager.set('DOC_UNIT', 'in', { persist: 'none' });
    SettingsManager.set('INCH_DISPLAY', 'decimal', { persist: 'none' });
    const profile = await createProfile();
    await createNamedDesign(profile, 'sketchstudio', 'UX18-dec', triDoc());
    const app = await open({ host: 'sketchstudio', profile });
    try {
      const toasts = await editAndReadToast(app, 'd3', '100');
      assert.strictEqual(toasts.length, 1, `expected 1 warning toast, got ${JSON.stringify(toasts)}`);
      assert.match(toasts[0], /Can't set to 100 in\b.*Reverted\.$/, `expected "100 in" in toast: "${toasts[0]}"`);
      assert.ok(!toasts[0].includes('2540'), `must not leak internal mm "2540": "${toasts[0]}"`);
    } finally {
      await app.close();
    }
  });

  await run('UX-18: fractional inch document formats refusal in fractional inches, not mm', async () => {
    SettingsManager.set('DOC_UNIT', 'in', { persist: 'none' });
    SettingsManager.set('INCH_DISPLAY', 'fractional', { persist: 'none' });
    const profile = await createProfile();
    await createNamedDesign(profile, 'sketchstudio', 'UX18-frac', triDoc());
    const app = await open({ host: 'sketchstudio', profile });
    try {
      const toasts = await editAndReadToast(app, 'd3', '100');
      assert.strictEqual(toasts.length, 1, `expected 1 warning toast, got ${JSON.stringify(toasts)}`);
      assert.match(toasts[0], /Can't set to 100".*Reverted\.$/, `expected fractional 100" in toast: "${toasts[0]}"`);
      assert.ok(!toasts[0].includes('2540'), `must not leak internal mm "2540": "${toasts[0]}"`);
    } finally {
      await app.close();
    }
  });

  await run('UX-18: mm document formats refusal as "100 mm" (keeps existing regex compatibility)', async () => {
    SettingsManager.set('DOC_UNIT', 'mm', { persist: 'none' });
    const profile = await createProfile();
    await createNamedDesign(profile, 'sketchstudio', 'UX18-mm', triDoc());
    const app = await open({ host: 'sketchstudio', profile });
    try {
      const toasts = await editAndReadToast(app, 'd3', '100');
      assert.strictEqual(toasts.length, 1, `expected 1 warning toast, got ${JSON.stringify(toasts)}`);
      assert.match(toasts[0], /Can't set to 100 mm\b.*Reverted\.$/, `expected "100 mm" in toast: "${toasts[0]}"`);
    } finally {
      await app.close();
    }
  });
} finally {
  SettingsManager.set('DOC_UNIT', prevUnit || 'mm', { persist: 'none' });
  SettingsManager.set('INCH_DISPLAY', prevInch || 'decimal', { persist: 'none' });
}

console.log(`PASS refusal-units-ux18-1013-node (${passed} tests)`);
