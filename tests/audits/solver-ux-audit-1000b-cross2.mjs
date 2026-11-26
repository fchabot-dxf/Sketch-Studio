// TASK 1000B Round 2, part 2: UX-20 render colour, UX-08 lock undo, owner yardstick (tool stays active) re-check.
// Run: node tests/audits/solver-ux-audit-1000b-cross2.mjs   (AUDIT ONLY, exits 0)
import { open, createProfile, loadGlyphSheetFromDisk } from '../helpers/node-app.js';
import { CONSTRAINT_TYPES } from '#core/constants.js';
import { setConstraintNotifier } from '#core/constraint-manager.js';
import { showNotification } from '#ui/notification-manager.js';
await loadGlyphSheetFromDisk();
async function openApp(host = 'sketchstudio') {
  const app = await open({ host, profile: await createProfile() });
  setConstraintNotifier(showNotification);
  return app;
}
const toasts = (app) => { const b = app.document.getElementById('notification-container'); return b ? [...b.children].map(e => (e.querySelector('pre')?.textContent || e.textContent).trim()) : []; };

// UX-20: conflicted triangle render colours
{
  const app = await openApp();
  const sk = app.state.activeSketchId || 'sketch-1';
  app.state.joints.set('a', { x: 0, y: 0, fixed: true, sketchId: sk });
  app.state.joints.set('b', { x: 50, y: 0, sketchId: sk });
  app.state.joints.set('c', { x: 25, y: 30, sketchId: sk });
  app.state.shapes.push({ id: 'L1', type: 'line', joints: ['a', 'b'], sketchId: sk }, { id: 'L2', type: 'line', joints: ['b', 'c'], sketchId: sk }, { id: 'L3', type: 'line', joints: ['c', 'a'], sketchId: sk });
  app.state.constraints.push(
    { type: CONSTRAINT_TYPES.HORIZONTAL, joints: ['a', 'b'] },
    { type: CONSTRAINT_TYPES.DISTANCE, joints: ['a', 'b'], value: 50, name: 'd1' },
    { type: CONSTRAINT_TYPES.DISTANCE, joints: ['b', 'c'], value: 40, name: 'd2' },
    { type: CONSTRAINT_TYPES.DISTANCE, joints: ['c', 'a'], value: 120, name: 'd3' });
  app.state.engine.solve(500); app.frames(3);
  const cols = {};
  for (const id of ['L1', 'L2', 'L3']) {
    const el = app.svg.querySelector(`[data-shape-id="${id}"]`);
    cols[id] = el ? (app.window.getComputedStyle(el).stroke || el.getAttribute('stroke')) : 'no-element';
  }
  console.log('CROSS2 UX-20 colours:', JSON.stringify({ cols, hasConflictClass: !!app.svg.querySelector('.conflict,.overconstrained,[data-conflict]') }));
  await app.close();
}

// UX-08: lock a line via F, Ctrl+Z
{
  const app = await openApp();
  const sk = app.state.activeSketchId || 'sketch-1';
  const mk = (id, x1, y1, x2, y2) => { app.state.joints.set(id + 'a', { x: x1, y: y1, sketchId: sk }); app.state.joints.set(id + 'b', { x: x2, y: y2, sketchId: sk }); app.state.shapes.push({ id, type: 'line', joints: [id + 'a', id + 'b'], sketchId: sk }); };
  mk('L1', 0, 0, 40, 0); mk('L2', 0, 30, 40, 30); app.frames(2);
  const h0 = app.state.history.length;
  app.state.selectedShapes = new Set(['L1']); app.key('f'); app.frames(2);
  const fixedAfterF = app.state.joints.get('L1a').fixed;
  const h1 = app.state.history.length;
  app.key('z', { ctrlKey: true }); app.frames(2);
  console.log('CROSS2 UX-08 lock undo:', JSON.stringify({ h0, h1, fixedAfterF, shapesAfterCtrlZ: app.state.shapes.map(s => s.id), L1aFixedAfterUndo: app.state.joints.get('L1a')?.fixed }));
  await app.close();
}

// Yardstick: does each constraint tool stay active after (a) a valid use (b) a refusal (c) second ribbon click?
for (const host of ['sketchstudio', 'shaper']) {
  const tools = ['coincident', 'parallel', 'perpendicular', 'horizontal', 'equal', 'midpoint', 'tangent', 'collinear', 'symmetric'];
  const out = {};
  for (const t of tools) {
    const app = await openApp(host);
    const btn = () => app.document.querySelector(`[data-tool="${t}"], [data-tool="${t === 'horizontal' ? 'hv' : t}"]`);
    const b = btn();
    if (!b) { out[t] = 'no-button'; await app.close(); continue; }
    b.click(); app.frames(2);
    const t1 = app.state.currentTool;
    b.click(); app.frames(2);
    out[t] = { afterFirstClick: t1, afterSecondClick: app.state.currentTool };
    await app.close();
  }
  console.log(`CROSS2 YARDSTICK second-click [${host}]:`, JSON.stringify(out));
}
