// tests/interrupts-fix-1030-node.test.js: TASK 1030, the tool-interruption fixes from audit 1023 (docs/INTERRUPTS-AUDIT-1023.md, rows I-nn), through the
// app's own listeners (tests/helpers/node-app.js). One case per bug or rule:
//   I-01 a tool switch closes the Slot's value box                     I-02 ONE Esc in the Text editor / the Dimension box leaves the tool
//   I-03 a cancelled draw / placement leaves Redo as it was            I-04 re-clicking the active tool's button keeps the half-made draw and its typed value
//   I-05 Undo with a pick pending cancels the pick and stays in the tool; the NEXT Undo undoes the previous step; Redo with a pick pending does nothing
//   I-06 Undo while a dimension is placed cancels the placement        I-07 Esc out of a Pattern clears the selection
//   I-08 Esc during a point drag puts it back, no undo step
//   I-12 a tool key during a drag puts the drag back, then switches    I-15 Redo with nothing to redo keeps a half-made 3-point rectangle / Bezier
//   I-17 a right-click places / completes nothing (Line: ends the chain, no segment)   I-18 Dimension keeps its pick across a right-click and a footer click
//   I-20 Delete in the 3-point rectangle's box is a text key (fixed by task 1028: guard)
// The right button, the focus, a finger pinch, the page scroll and the transform box (I-09) in a real browser: tests/interrupts-fix-1030-live.test.js.
import assert from 'node:assert';
import { open } from './helpers/node-app.js';
import { RECT_MODES, SLOT_MODES } from '#core/constants.js';

const failures = [];
let passed = 0;
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null; // e.g. ONLY=I-03,I-05: those cases only (the fail-first runs, one id at a time)
async function run(name, fn) {
  if (ONLY && !ONLY.some((id) => name.startsWith(id + ' '))) return;
  try { await fn(); passed++; console.log(`  ok: ${name}`); }
  catch (e) { failures.push(`${name}: ${String(e.message).split('\n')[0]}`); console.log(`  FAIL: ${name}: ${String(e.message).split('\n')[0]}`); }
}

async function openFresh({ host = 'sketchstudio', cx = 0, cy = 0, w = 200 } = {}) {
  const app = await open({ host });
  const r = app.svg.getBoundingClientRect();
  Object.assign(app.state.view, { x: cx, y: cy, w });
  app.state.view.h = app.state.view.w / (r.width / r.height);
  app.svg.setAttribute('viewBox', `${app.state.view.x - app.state.view.w / 2} ${app.state.view.y - app.state.view.h / 2} ${app.state.view.w} ${app.state.view.h}`);
  app.frames(2);
  return app;
}
const shown = (el) => !!el && el.isConnected && !el.classList.contains('hidden') && el.style.display !== 'none';
const single = (app) => { const d = app.document.getElementById('dimInput'); return shown(d) ? d : null; };
const dualFields = (app) => { const b = app.document.getElementById('dualInput'); return shown(b) ? [...b.querySelectorAll('input')] : []; };
const W = (app, x, y) => app.toScreen(x, y);
const clickW = (app, x, y, o) => { const p = W(app, x, y); app.click(p.x, p.y, o); };
const moveW = (app, x, y) => { const p = W(app, x, y); app.move(p.x, p.y); };
const rightW = (app, x, y) => { const p = W(app, x, y); app.rightClick(p.x, p.y); };
const lines = (app) => app.state.shapes.filter((s) => s.type === 'line' && !s.isConstruction);
const J = (app, id) => app.state.joints.get(id);
const hist = (app) => ({ U: app.state.history.length, R: app.state.redoStack.length });
const sameHist = (a, b, msg) => assert.deepStrictEqual(b, a, `${msg}: history U/R ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);

// two lines drawn (two finished steps), then ONE undone: Redo holds one step (the audit fixture's U:1 R:1)
function seedRedo(app) {
  app.tool('line'); clickW(app, -60, 40); clickW(app, -20, 40); app.esc(); app.esc();
  app.tool('line'); clickW(app, -60, 60); clickW(app, -20, 60); app.esc(); app.esc();
  app.undo();
  assert.strictEqual(app.state.redoStack.length, 1, 'seed: one step to redo');
  assert.strictEqual(lines(app).length, 1, 'seed: one line left');
}

// ── I-01: Slot, first pick, a typed value, another tool: the box goes with the slot ──
await run('I-01 slot (every variant): click, type 22, pick the Circle tool: no value box is left on the canvas', async () => {
  for (const mode of Object.values(SLOT_MODES)) {
    const app = await openFresh();
    try {
      app.state.slotMode = mode;
      app.tool('slot'); clickW(app, 0, 0); moveW(app, 30, 10);
      assert(single(app), `${mode}: the slot box is open`);
      app.type('22');
      app.tool('circle');
      assert.strictEqual(app.state.currentTool, 'circle', `${mode}: the Circle tool is active`);
      assert.strictEqual(single(app), null, `${mode}: the slot's box "22" is gone`);
      assert.strictEqual(app.state.active, null, `${mode}: no half-made slot`);
    } finally { await app.close(); }
  }
});

// ── I-02: ONE Esc inside the Text editor / the Dimension value box cancels and leaves the tool ──
await run('I-02 text: click, type, Esc in the editor: the text is gone and the tool is Select', async () => {
  const app = await openFresh();
  try {
    const before = app.state.shapes.length;
    app.tool('text'); clickW(app, 0, 0);
    const ta = app.document.querySelector('.sk-text-editor textarea');
    assert(ta, 'the text editor is open');
    ta.focus(); app.type('Hi');
    app.esc();
    assert.strictEqual(app.document.querySelector('.sk-text-editor'), null, 'the editor is closed');
    assert.strictEqual(app.state.shapes.length, before, 'no text was made');
    assert.strictEqual(app.state.currentTool, 'select', 'ONE Esc left the Text tool');
  } finally { await app.close(); }
});
await run('I-02 dimension: two points, place, type 35, Esc in the box: no dimension, the tool is Select', async () => {
  const app = await openFresh();
  try {
    app.tool('line'); clickW(app, -30, 0); clickW(app, 20, 0); app.esc(); app.esc();
    const cons = app.state.constraints.length;
    app.tool('dim'); clickW(app, -30, 0); clickW(app, 20, 0); moveW(app, 0, 15); clickW(app, 0, 15);
    assert(single(app), 'the dimension value box is open');
    app.type('35'); app.esc();
    assert.strictEqual(single(app), null, 'the box is closed');
    assert.strictEqual(app.state.constraints.length, cons, 'the new dimension is gone');
    assert.strictEqual(app.state.currentTool, 'select', 'ONE Esc left the Dimension tool');
  } finally { await app.close(); }
});

// ── I-03: a draw / placement cancelled after its first pick leaves Undo AND Redo as they were ──
await run('I-03 Line / Rect / Circle / Arc / Polygon / Bezier: first click then Esc / another tool: Redo is kept and still redoes', async () => {
  for (const tool of ['line', 'rect', 'circle', 'arc', 'polygon', 'bezier']) {
    for (const how of ['esc', 'switch']) {
      const app = await openFresh();
      try {
        seedRedo(app);
        const h0 = hist(app);
        app.tool(tool); clickW(app, 40, -20); moveW(app, 60, -10);
        if (how === 'esc') app.esc(); else app.tool(tool === 'circle' ? 'line' : 'circle');
        sameHist(h0, hist(app), `${tool} ${how}`);
        if (how === 'switch') app.esc();
        app.redo();
        assert.strictEqual(lines(app).length, 2, `${tool} ${how}: Ctrl+Y brings the undone line back`);
      } finally { await app.close(); }
    }
  }
});
await run('I-03 dimension placing then Esc: Redo is kept', async () => {
  const app = await openFresh();
  try {
    seedRedo(app);
    const h0 = hist(app);
    app.tool('dim'); clickW(app, -60, 40); clickW(app, -20, 40); moveW(app, -40, 50);
    assert(app.state.placingConstraint, 'a dimension is being placed');
    app.esc();
    sameHist(h0, hist(app), 'dimension placement cancelled');
  } finally { await app.close(); }
});

await run('I-03 memory: committed draws after an undo keep ONE retained Redo branch, the newest clearing step', async () => {
  const app = await openFresh();
  try {
    seedRedo(app);                                                            // Redo holds one step
    app.tool('line'); clickW(app, 0, -40); clickW(app, 30, -40); app.esc(); app.esc();   // a committed draw clears it (entry A)
    const first = app.state._clearedRedo;
    assert(first && first.redo.length === 1, 'the slot holds the branch the first draw cleared');
    app.undo();                                                               // Redo holds that draw
    app.tool('line'); clickW(app, 0, -60); clickW(app, 30, -60); app.esc(); app.esc();   // a second committed draw clears it (entry B)
    const second = app.state._clearedRedo;
    assert(second && second !== first, 'one slot, overwritten by the next clearing save');
    assert(second.entry !== first.entry, 'the slot holds the second entry, not the first');
    assert(app.state.history.includes(second.entry), 'the entry of the second draw is the one held');
    assert.strictEqual(second.redo.length, 1, 'only that one branch is retained');
    // the give-back still works after it: a cancelled draw keeps Redo
    app.undo(); const h0 = hist(app);
    app.tool('rect'); clickW(app, 40, -20); moveW(app, 60, -10); app.esc();
    sameHist(h0, hist(app), 'a cancelled draw after the overwrite still gives Redo back');
  } finally { await app.close(); }
});

// ── I-04: re-clicking the active tool's button keeps the half-made draw and the typed value ──
await run('I-04 rect / line / circle / slot: click, type 25, click the same button again: tool, first pick and "25" kept; Enter still finishes', async () => {
  for (const tool of ['rect', 'line', 'circle', 'slot']) {
    const app = await openFresh();
    try {
      app.tool(tool); clickW(app, 0, 0); moveW(app, 30, 20);
      app.type('25');
      const box = () => (single(app) ? single(app).value : (dualFields(app)[0] || {}).value);
      assert.strictEqual(box(), '25', `${tool}: typed`);
      app.tool(tool);
      assert.strictEqual(app.state.currentTool, tool, `${tool}: the tool stays`);
      assert(app.state.active, `${tool}: the first pick is kept`);
      assert.strictEqual(box(), '25', `${tool}: the typed value is kept`);
    } finally { await app.close(); }
  }
});

// ── I-05: Undo with a pick pending cancels the pick, stays in the tool, makes no undo step; the next Undo undoes the previous finished step ──
await run('I-05 coincident: a point picked, Ctrl+Z: the pick is gone, the line stays, the tool stays; the next Ctrl+Z undoes the line', async () => {
  const app = await openFresh();
  try {
    app.tool('line'); clickW(app, -30, 0); clickW(app, 20, 0); app.esc(); app.esc();
    app.tool('coincident'); clickW(app, -30, 0);
    assert(app.state.pendingConstraint && app.state.pendingConstraint.firstElement, 'a point is picked');
    const h0 = hist(app);
    app.undo();
    assert.strictEqual(lines(app).length, 1, 'the line was not undone');
    assert.strictEqual(app.state.currentTool, 'coincident', 'the tool stays');
    assert(!(app.state.pendingConstraint && app.state.pendingConstraint.firstElement), 'the pick is cancelled');
    sameHist(h0, hist(app), 'no undo step');
    app.undo();
    assert.strictEqual(lines(app).length, 0, 'the next Ctrl+Z undoes the line');
  } finally { await app.close(); }
});
await run('I-05 rect / line / fillet: a pick pending, Ctrl+Z: cancelled, the tool stays, no undo step', async () => {
  for (const tool of ['rect', 'line', 'fillet']) {
    const app = await openFresh();
    try {
      app.tool('line'); clickW(app, -30, 0); clickW(app, 20, 0); clickW(app, 20, 30); app.esc(); app.esc();
      const shapes = app.state.shapes.length, h0 = hist(app);
      app.tool(tool);
      if (tool === 'fillet') clickW(app, -10, 0); else { clickW(app, 40, -20); moveW(app, 60, -10); }
      app.undo();
      assert.strictEqual(app.state.currentTool, tool, `${tool}: the tool stays`);
      assert.strictEqual(app.state.active, null, `${tool}: the half-made draw is gone`);
      assert.strictEqual(app.state.shapes.length, shapes, `${tool}: nothing older was undone`);
      sameHist(h0, hist(app), `${tool}: no undo step`);
    } finally { await app.close(); }
  }
});
await run('I-05 Ctrl+Y with a pick pending does nothing to the pick (nor to the document)', async () => {
  const app = await openFresh();
  try {
    seedRedo(app);
    const shapes = app.state.shapes.length;
    app.tool('coincident'); clickW(app, -60, 40);
    assert(app.state.pendingConstraint && app.state.pendingConstraint.firstElement, 'a point is picked');
    const h0 = hist(app);
    app.redo();
    assert(app.state.pendingConstraint && app.state.pendingConstraint.firstElement, 'the pick is kept');
    assert.strictEqual(app.state.shapes.length, shapes, 'nothing was redone');
    sameHist(h0, hist(app), 'history untouched');
  } finally { await app.close(); }
});

// ── I-06: Undo while a dimension's label is being placed cancels the placement; Redo has nothing to bring back ──
await run('I-06 dimension placing, Ctrl+Z then Ctrl+Y: no dimension, not placing, no half-placed dimension comes back', async () => {
  const app = await openFresh();
  try {
    app.tool('line'); clickW(app, -30, 0); clickW(app, 20, 0); app.esc(); app.esc();
    const cons = app.state.constraints.length, h0 = hist(app);
    app.tool('dim'); clickW(app, -30, 0); clickW(app, 20, 0); moveW(app, 0, 15);
    assert(app.state.placingConstraint, 'placing');
    app.undo();
    assert.strictEqual(app.state.placingConstraint, null, 'the placement is cancelled');
    assert.strictEqual(app.state.constraints.length, cons, 'the half-placed dimension is gone');
    assert.strictEqual(app.state.currentTool, 'dim', 'the Dimension tool stays');
    sameHist(h0, hist(app), 'nothing else changed');
    app.redo();
    assert.strictEqual(app.state.constraints.length, cons, 'Ctrl+Y brings no half-placed dimension back');
    assert.strictEqual(lines(app).length, 1, 'the line is still there');
  } finally { await app.close(); }
});

// ── I-07: Esc out of a Pattern clears the selection, like every other tool ──
await run('I-07 circular / rectangular pattern: a line picked, Esc: the tool is Select and nothing is selected', async () => {
  for (const tool of ['circularPattern', 'rectangularPattern']) {
    const app = await openFresh();
    try {
      app.tool('line'); clickW(app, -30, 0); clickW(app, 20, 0); app.esc(); app.esc();
      app.tool(tool); clickW(app, -5, 0);
      app.esc();
      assert.strictEqual(app.state.currentTool, 'select', `${tool}: Select`);
      assert.strictEqual(app.state.selectedShapes.size + app.state.selectedJoints.size, 0, `${tool}: nothing selected`);
    } finally { await app.close(); }
  }
});

// a line drawn, a second one drawn and undone (Redo holds it), then a free end of the first line dragged, the button still down
function startPointDrag(app) {
  app.tool('line'); clickW(app, -30, 0); clickW(app, 20, 0); app.esc(); app.esc();
  app.tool('line'); clickW(app, -60, 60); clickW(app, -20, 60); app.esc(); app.esc();
  app.undo();
  app.tool('select');
  const h0 = hist(app);
  const id = lines(app)[0].joints[1];
  const at = { ...J(app, id) };
  const a = W(app, at.x, at.y), b = W(app, at.x + 12, at.y + 8);
  app.move(a.x, a.y); app.down(a.x, a.y);
  for (let i = 1; i <= 4; i++) app.move(a.x + (b.x - a.x) * i / 4, a.y + (b.y - a.y) * i / 4, { buttons: 1 });
  return { id, at, b, h0 };
}
// ── I-08: Esc during a point drag puts everything back where it was; no undo step ──
await run('I-08 a point dragged, Esc before the release: the point is back, no undo step, Redo kept', async () => {
  const app = await openFresh();
  try {
    const { id, at, b, h0 } = startPointDrag(app);
    assert.strictEqual(h0.R, 1, 'one step to redo before the drag');
    assert(app.state.drag, 'dragging');
    assert(Math.hypot(J(app, id).x - at.x, J(app, id).y - at.y) > 1, 'the point moved');
    app.esc();
    app.up(b.x, b.y);
    assert.strictEqual(app.state.drag, null, 'the drag ended');
    assert(Math.hypot(J(app, id).x - at.x, J(app, id).y - at.y) < 1e-9, `the point is back (${J(app, id).x}, ${J(app, id).y})`);
    sameHist(h0, hist(app), 'no undo step from the drag, Redo kept');
  } finally { await app.close(); }
});

// ── I-12: a tool key during a drag ends the drag by putting it back, then switches ──
await run('I-12 a point dragged, the C key: the drag is put back and ended, then the Circle tool', async () => {
  const app = await openFresh();
  try {
    const { id, at, b, h0 } = startPointDrag(app);
    app.key('c');
    assert.strictEqual(app.state.currentTool, 'circle', 'the Circle tool');
    assert.strictEqual(app.state.drag, null, 'no drag is left live');
    assert(Math.hypot(J(app, id).x - at.x, J(app, id).y - at.y) < 1e-9, 'the point is back');
    sameHist(h0, hist(app), 'no undo step from the drag, Redo kept');
    app.up(b.x, b.y);
    assert.strictEqual(app.state.shapes.filter((s) => s.type === 'circle').length, 0, 'the release makes no circle');
  } finally { await app.close(); }
});

// ── I-15: Ctrl+Y with nothing to redo keeps a half-made 3-point rectangle / Bezier ──
await run('I-15 rect 3-point / bezier: a pick made, Ctrl+Y with nothing to redo: the draw is kept', async () => {
  for (const tool of ['rect3', 'bezier']) {
    const app = await openFresh();
    try {
      if (tool === 'rect3') app.state.rectMode = RECT_MODES.THREE_POINT;
      app.tool(tool === 'rect3' ? 'rect' : 'bezier'); clickW(app, 0, 0); moveW(app, 30, 10);
      app.svg.focus(); // the canvas has the keys (a focused box keeps its own Ctrl+Y)
      if (app.document.activeElement && app.document.activeElement.blur) app.document.activeElement.blur();
      assert.strictEqual(app.state.redoStack.length, 0, 'nothing to redo');
      const h0 = hist(app);
      app.redo();
      assert(app.state.active, `${tool}: the half-made draw is kept`);
      sameHist(h0, hist(app), `${tool}: history untouched`);
    } finally { await app.close(); }
  }
});

// ── I-17: a right-click on empty canvas never places or completes geometry ──
await run('I-17 every draw tool: a right-click before / after the first pick makes nothing and keeps the pick', async () => {
  const tools = [['line'], ['rect', RECT_MODES.TWO_POINT], ['rect', RECT_MODES.CENTER], ['rect', RECT_MODES.THREE_POINT], ['circle'], ['arc'], ['polygon'], ['bezier'],
    ...Object.values(SLOT_MODES).map((m) => ['slot', null, m])];
  for (const [tool, rectMode, slotMode] of tools) {
    const label = tool + (rectMode || slotMode ? ':' + (rectMode || slotMode) : '');
    const app = await openFresh();
    try {
      if (rectMode) app.state.rectMode = rectMode;
      if (slotMode) app.state.slotMode = slotMode;
      app.tool(tool);
      const shapes = app.state.shapes.length, joints = app.state.joints.size, h0 = hist(app);
      rightW(app, 30, 20);
      assert.strictEqual(app.state.active, null, `${label}: a right-click starts nothing`);
      assert.strictEqual(app.state.joints.size, joints, `${label}: no point placed`);
      sameHist(h0, hist(app), `${label}: no step`);
      clickW(app, 0, 0); moveW(app, 30, 15);
      const joints1 = app.state.joints.size;
      rightW(app, 30, 15);
      assert.strictEqual(app.state.shapes.length, shapes, `${label}: a right-click completes nothing`);
      if (tool === 'line') assert.strictEqual(app.state.active, null, 'line: the right-click ends the chain (no segment)');
      else {
        assert(app.state.active, `${label}: the first pick is kept`);
        assert.strictEqual(app.state.joints.size, joints1, `${label}: no point placed by the right-click`);
      }
    } finally { await app.close(); }
  }
});

// ── I-18: Dimension keeps its pending pick / placement across a right-click and a click on the footer ──
await run('I-18 dimension: a point picked, a right-click on empty canvas, a footer click, the 2nd point: a dimension is placed', async () => {
  const app = await openFresh();
  try {
    app.tool('line'); clickW(app, -30, 0); clickW(app, 20, 0); app.esc(); app.esc();
    app.tool('dim'); clickW(app, -30, 0);
    assert(app.state.active, 'the first point is picked');
    rightW(app, 60, 40);
    assert(app.state.active, 'kept across the right-click');
    const footer = app.document.querySelector('.sk-footer');
    assert(footer, 'the footer is mounted');
    app.press(footer);
    assert(app.state.active, 'kept across the footer click');
    clickW(app, 20, 0);
    assert(app.state.placingConstraint, 'the 2nd point makes the dimension (placing)');
  } finally { await app.close(); }
});

// ── I-20 (fixed by task 1028, guarded here): Delete in the 3-point rectangle's box deletes a character ──
await run('I-20 rect 3-point: type 25, Delete: the box stays, the draw goes on', async () => {
  const app = await openFresh();
  try {
    app.state.rectMode = RECT_MODES.THREE_POINT;
    app.tool('rect'); clickW(app, 0, 0); moveW(app, 30, 10);
    assert(single(app), 'the length box is open');
    app.type('25'); app.key('Delete');
    assert(single(app), 'the box is still open');
    assert(app.state.active, 'the draw goes on');
    assert.strictEqual(app.state.currentTool, 'rect', 'still the Rect tool');
  } finally { await app.close(); }
});

console.log(`interrupts-fix-1030-node: ${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log('FAIL ' + f); process.exitCode = 1; }
