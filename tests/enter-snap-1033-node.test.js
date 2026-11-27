// tests/enter-snap-1033-node.test.js — TASK 1033: the three bugs of the input plan (docs/INPUT-UNIFY-PLAN-1031.md, Appendix), one section per bug id.
// Real SketchStudio page in the node kit (tests/helpers/node-app.js): real pointer + key events through the app's own listeners.
//   X-01 Enter in a value box applies the snap the cursor shows, exactly as a click on the same point: every draw tool's step gives the identical
//        constraint list (types + the existing geometry they bind), and a typed value that positions the point drops the snap on both paths.
//   A-1  Arc: after the first step is set by a DRAG, the next click places the next point (it was swallowed and the box swapped).
//   S-1  Slot: a typed span drops the span-end snap (the solver moved the slot's first centre onto the typed length from the snapped end).
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { RECT_MODES, SLOT_MODES, ARC_MODES, CONSTRAINT_TYPES } from '#core/constants.js';

const failures = [];
let passed = 0;
async function run(name, fn) {
  try { await fn(); passed++; console.log(`  ok: ${name}`); }
  catch (e) { failures.push(`${name}: ${String(e.message).split('\n')[0]}`); console.log(`  FAIL: ${name}: ${String(e.message).split('\n')[0]}`); }
}

// The sketch every case draws against: line L2 (x = 40, y -30..30) between fixed points jc / jd, and a lone fixed point jp (-30, 25).
const EXISTING = new Set(['j_origin', 'jc', 'jd', 'jp', 'L2']);
const doc = () => ({ version: 3, hosts: {}, geometry: {
  joints: [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }], ['jc', { x: 40, y: -30, fixed: true, sketchId: 'sketch-1' }], ['jd', { x: 40, y: 30, fixed: true, sketchId: 'sketch-1' }], ['jp', { x: -30, y: 25, fixed: true, sketchId: 'sketch-1' }]],
  shapes: [{ id: 'L2', type: 'line', joints: ['jc', 'jd'], sketchId: 'sketch-1' }], constraints: [], parameters: [],
  sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }], activeSketchId: 'sketch-1', groups: [], profiles: [] } });

async function openDoc() {
  const profile = await createProfile();
  await createNamedDesign(profile, 'sketchstudio', 'T1033', doc());
  const app = await open({ host: 'sketchstudio', profile });
  const r = app.svg.getBoundingClientRect();
  Object.assign(app.state.view, { x: 0, y: 0, w: 200 });
  app.state.view.h = app.state.view.w / (r.width / r.height);
  app.svg.setAttribute('viewBox', `${app.state.view.x - app.state.view.w / 2} ${app.state.view.y - app.state.view.h / 2} ${app.state.view.w} ${app.state.view.h}`);
  app.frames(2);
  return app;
}
const W = (app, x, y) => app.toScreen(x, y);
const moveW = (app, x, y) => { const p = W(app, x, y); app.move(p.x, p.y); };
const clickW = (app, x, y) => { const p = W(app, x, y); app.click(p.x, p.y); };
/** the existing geometry ids a constraint binds (any string value, nested) */
function boundExisting(c) {
  const out = [];
  const walk = (v) => { if (typeof v === 'string') { if (EXISTING.has(v)) out.push(v); } else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  for (const [k, v] of Object.entries(c)) if (k !== 'id' && k !== 'type') walk(v);
  return out.sort().join('+');
}
const newConstraints = (app, n0) => app.state.constraints.slice(n0).map((c) => c.type + (boundExisting(c) ? '@' + boundExisting(c) : '')).sort();

/**
 * One draw: `steps` in order; each is [x, y] (move there, click), { via: [x, y] } (a move only: an arc's winding), { type: 'text' } (typed into the
 * open box) or { test: [x, y] } = the step under test: the cursor goes to the point (from 3 px off, so the snap is found by a real move), then a CLICK
 * there or ENTER in the box (`how`). Returns the new shapes count and the new constraints.
 */
async function draw({ tool, mode, steps }, how) {
  const app = await openDoc();
  try {
    app.tool(tool);
    if (mode) mode(app.state);
    const n0 = app.state.constraints.length, s0 = app.state.shapes.length;
    let shownAtTest = null;
    for (const s of steps) {
      if (Array.isArray(s)) { moveW(app, ...s); clickW(app, ...s); }
      else if (s.via) moveW(app, ...s.via);
      else if (s.type) app.type(s.type);
      else if (s.test) {
        const b = W(app, ...s.test); app.move(b.x + 3, b.y + 3); app.move(b.x, b.y);
        shownAtTest = app.state.snapTarget ? app.state.snapTarget.type : 'none';
        if (how === 'click') app.click(b.x, b.y); else app.enter();
      }
    }
    return { shapes: app.state.shapes.length - s0, constraints: newConstraints(app, n0), shown: shownAtTest };
  } finally { app.esc(); app.esc(); await app.close(); }
}

// ── X-01: Enter at the last hover point = a click there (nothing typed: the shown snap applies on both; a typed value: dropped on both) ──
const ON_L2 = [40, 10];
const X01_CASES = [
  { name: 'Line end on L2', tool: 'line', steps: [[10, -10], { test: ON_L2 }], snap: 'pointOnLine@L2' },
  { name: 'Rect 2-point corner on L2', tool: 'rect', mode: (s) => { s.rectMode = RECT_MODES.TWO_POINT; }, steps: [[10, -10], { test: ON_L2 }], snap: 'pointOnLine@L2' },
  { name: 'Rect centre corner on L2', tool: 'rect', mode: (s) => { s.rectMode = RECT_MODES.CENTER; }, steps: [[20, -5], { test: ON_L2 }], snap: 'pointOnLine@L2' },
  { name: 'Rect 3-point base end on L2 (length box)', tool: 'rect', mode: (s) => { s.rectMode = RECT_MODES.THREE_POINT; }, steps: [[10, -10], { test: ON_L2 }, [20, 25]], snap: 'pointOnLine@L2' },
  { name: 'Rect 3-point third point on L2 (height box)', tool: 'rect', mode: (s) => { s.rectMode = RECT_MODES.THREE_POINT; }, steps: [[10, -10], [25, -10], { test: ON_L2 }], snap: 'pointOnLine@L2' },
  { name: 'Circle rim on point jp', tool: 'circle', steps: [[-30, 5], { test: [-30, 25] }], snap: 'pointOnLine@jp' },
  { name: 'Polygon corner on L2', tool: 'polygon', steps: [[10, 3], { test: ON_L2 }], snap: 'pointOnLine@L2' },
  { name: 'Arc (centre) start on L2 (radius box)', tool: 'arc', mode: (s) => { s.arcMode = ARC_MODES.CENTER_START_END; }, steps: [[10, 5], { test: [40, 5] }, { via: [35, 20] }, { via: [25, 30] }, [10, 35]], snap: 'pointOnLine@L2' },
  { name: 'Arc (centre) end on L2 (sweep box)', tool: 'arc', mode: (s) => { s.arcMode = ARC_MODES.CENTER_START_END; }, steps: [[10, 5], [10, -25], { via: [25, -20] }, { via: [35, -10] }, { test: [40, 5] }], snap: 'pointOnLine@L2' },
  { name: 'Arc (3-point) end on L2 (chord box)', tool: 'arc', mode: (s) => { s.arcMode = ARC_MODES.THREE_POINT; }, steps: [[10, -10], { test: ON_L2 }, [20, 15]], snap: 'pointOnLine@L2' },
  { name: 'Arc (3-point) third point on jp (radius box)', tool: 'arc', mode: (s) => { s.arcMode = ARC_MODES.THREE_POINT; }, steps: [[-10, -10], [-10, 20], { test: [-30, 25] }], snap: 'pointOnLine@jp' },
  { name: 'Slot (centre to centre) span end on L2 (span box)', tool: 'slot', mode: (s) => { s.slotMode = SLOT_MODES.CENTER_TO_CENTER; }, steps: [[10, 7], { test: [40, 7] }, [25, 12]], snap: 'pointOnLine@L2' },
  { name: 'Slot (3-point arc) arc point on jp (arc box)', tool: 'slot', mode: (s) => { s.slotMode = SLOT_MODES.THREE_POINT_ARC; }, steps: [[-10, -10], [-10, 20], { test: [-30, 25] }, [-25, 25]], snap: 'jp' },
];
for (const c of X01_CASES) {
  await run(`X-01 ${c.name}: Enter gives the click's constraints, the shown snap included`, async () => {
    const byClick = await draw(c, 'click');
    const byEnter = await draw(c, 'enter');
    assert(byClick.shown !== 'none' && byClick.shown === byEnter.shown, `a snap shows at the tested point (click ${byClick.shown}, enter ${byEnter.shown})`);
    assert(byClick.shapes > 0, `the click run placed the shape (${byClick.shapes} shapes)`);
    assert.strictEqual(byEnter.shapes, byClick.shapes, 'the same shapes count');
    assert(byClick.constraints.some((t) => t.includes(c.snap)), `the click binds the snapped geometry (${c.snap}): [${byClick.constraints}]`);
    assert.deepStrictEqual(byEnter.constraints, byClick.constraints, 'Enter = click');
  });
}

// a typed value that positions the point: the shown snap is dropped by the click AND by Enter (the same list again, without the snap)
const TYPED_CASES = [
  { name: 'Line, typed length 20', tool: 'line', steps: [[10, -10], { type: '20' }, { test: ON_L2 }] },
  { name: 'Rect 2-point, typed W 25', tool: 'rect', mode: (s) => { s.rectMode = RECT_MODES.TWO_POINT; }, steps: [[10, -10], { type: '25' }, { test: ON_L2 }] },
  { name: 'Circle, typed diameter 30', tool: 'circle', steps: [[-30, 5], { type: '30' }, { test: [-30, 25] }] },
  { name: 'Polygon, typed radius 20', tool: 'polygon', steps: [[10, 3], { type: '20' }, { test: ON_L2 }] },
  { name: 'Arc (centre), typed radius 20', tool: 'arc', mode: (s) => { s.arcMode = ARC_MODES.CENTER_START_END; }, steps: [[10, 5], { type: '20' }, { test: [40, 5] }, { via: [35, 20] }, { via: [25, 30] }, [10, 35]] },
  { name: 'Slot (centre to centre), typed span 20', tool: 'slot', mode: (s) => { s.slotMode = SLOT_MODES.CENTER_TO_CENTER; }, steps: [[10, 7], { type: '20' }, { test: [40, 7] }, [25, 12]] },
];
for (const c of TYPED_CASES) {
  await run(`X-01 ${c.name}: the click and Enter both drop the snap`, async () => {
    const byClick = await draw(c, 'click');
    const byEnter = await draw(c, 'enter');
    assert(byClick.shapes > 0, `the click run placed the shape (${byClick.shapes})`);
    assert(!byClick.constraints.some((t) => t.startsWith(CONSTRAINT_TYPES.POINT_ON_LINE + '@L2') || t.startsWith(CONSTRAINT_TYPES.POINT_ON_LINE + '@jp')), `the click took no snap: [${byClick.constraints}]`);
    assert.strictEqual(byEnter.shapes, byClick.shapes, 'the same shapes count');
    assert.deepStrictEqual(byEnter.constraints, byClick.constraints, 'Enter = click');
  });
}

// ── A-1: Arc: the first step set by a DRAG (press, drag, release), then ONE click places the next point ──
await run('A-1 Arc (centre): radius set by a drag from the centre, then one end click places the arc', async () => {
  const app = await openDoc();
  try {
    app.tool('arc'); app.state.arcMode = ARC_MODES.CENTER_START_END;
    app.drag(W(app, -20, -10), W(app, 5, -10));
    assert.strictEqual(app.state.active && app.state.active.phase, 'start', 'the drag placed the start point');
    const s0 = app.state.shapes.length;
    moveW(app, -5, 5); moveW(app, -20, 15); clickW(app, -20, 15);
    assert.strictEqual(app.state.shapes.length - s0, 1, 'the first end click placed the arc');
    assert.strictEqual(app.state.active, null, 'the draw is done');
    assert(!app.document.getElementById('dimInput') || app.document.getElementById('dimInput').classList.contains('hidden') || app.document.getElementById('dimInput').style.display === 'none', 'no radius box opened in place of the sweep box');
  } finally { app.esc(); app.esc(); await app.close(); }
});
await run('A-1 Arc (3-point): the end set by a drag from the start, then one click places the arc', async () => {
  const app = await openDoc();
  try {
    app.tool('arc'); app.state.arcMode = ARC_MODES.THREE_POINT;
    app.drag(W(app, -20, -10), W(app, 10, -10));
    assert.strictEqual(app.state.active && app.state.active.phase, 'bulge', 'the drag placed the end point');
    const s0 = app.state.shapes.length;
    moveW(app, -5, 5); clickW(app, -5, 5);
    assert.strictEqual(app.state.shapes.filter((s) => s.type === 'arc').length, 1, 'the first click placed the arc');
    assert(app.state.shapes.length > s0 && app.state.active === null, 'the draw is done');
  } finally { app.esc(); app.esc(); await app.close(); }
});

// a drag that comes back onto the centre places nothing: the tool waits as after a centre CLICK, with the radius box (advisor ruling, task 1033)
const singleBox = (app) => { const d = app.document.getElementById('dimInput'); return !!d && !d.classList.contains('hidden') && d.style.display !== 'none'; };
const dragBack = (app, at, away) => {
  const a = W(app, ...at), b = W(app, ...away);
  app.move(a.x, a.y); app.down(a.x, a.y);
  for (let i = 1; i <= 4; i++) app.move(a.x + (b.x - a.x) * i / 4, a.y + (b.y - a.y) * i / 4, { buttons: 1 });
  for (let i = 3; i >= 0; i--) app.move(a.x + (b.x - a.x) * i / 4, a.y + (b.y - a.y) * i / 4, { buttons: 1 });
  app.up(a.x, a.y);
};
await run('A-1 Arc (centre): a drag back onto the centre = a centre click: the radius box waits; a typed 15 + Enter places the start at 15', async () => {
  const app = await openDoc();
  try {
    app.tool('arc'); app.state.arcMode = ARC_MODES.CENTER_START_END;
    dragBack(app, [-20, -10], [0, -10]);
    assert.strictEqual(app.state.active && app.state.active.phase, 'center', 'the centre is placed, the start still to come');
    assert(singleBox(app), 'the box is open');
    app.type('15'); moveW(app, 5, -10); app.enter();
    assert.strictEqual(app.state.active && app.state.active.phase, 'start', 'Enter in that box placed the start');
    const c = app.state.joints.get(app.state.active.center), st = app.state.joints.get(app.state.active.start);
    assert(Math.abs(Math.hypot(st.x - c.x, st.y - c.y) - 15) < 1e-6, `it is the RADIUS box: the start is at the typed 15 (${Math.hypot(st.x - c.x, st.y - c.y)})`);
  } finally { app.esc(); app.esc(); await app.close(); }
});
await run('A-1 Arc (centre): a drag back onto the centre, then a click places the start (sweep box), then a click places the arc', async () => {
  const app = await openDoc();
  try {
    app.tool('arc'); app.state.arcMode = ARC_MODES.CENTER_START_END;
    dragBack(app, [-20, -10], [0, -10]);
    moveW(app, 5, -10); clickW(app, 5, -10);
    assert.strictEqual(app.state.active && app.state.active.phase, 'start', 'the click placed the start');
    assert(singleBox(app), 'the sweep box is open');
    moveW(app, -5, 5); moveW(app, -20, 15); clickW(app, -20, 15);
    assert.strictEqual(app.state.shapes.filter((x) => x.type === 'arc').length, 1, 'the next click placed the arc');
    assert.strictEqual(app.state.active, null, 'the draw is done');
  } finally { app.esc(); app.esc(); await app.close(); }
});
await run('A-1 Arc (3-point): a drag back onto the start = a start click: the chord box waits; the next clicks place the end and the arc', async () => {
  const app = await openDoc();
  try {
    app.tool('arc'); app.state.arcMode = ARC_MODES.THREE_POINT;
    dragBack(app, [-20, -10], [0, -10]);
    assert.strictEqual(app.state.active && app.state.active.phase, 'chord', 'the start is placed, the end still to come');
    assert(singleBox(app), 'the chord box is open');
    moveW(app, 10, -10); clickW(app, 10, -10);
    assert.strictEqual(app.state.active && app.state.active.phase, 'bulge', 'the click placed the end');
    moveW(app, -5, 5); clickW(app, -5, 5);
    assert.strictEqual(app.state.shapes.filter((x) => x.type === 'arc').length, 1, 'the next click placed the arc');
  } finally { app.esc(); app.esc(); await app.close(); }
});

// ── S-1: Slot: a typed span holds the end; the snap the span click was on is dropped, so the slot stays where it was clicked ──
await run('S-1 Slot (centre to centre): typed span 20, span click on L2: no point-on-line, the first centre stays at x 10', async () => {
  const app = await openDoc();
  try {
    app.tool('slot'); app.state.slotMode = SLOT_MODES.CENTER_TO_CENTER;
    const n0 = app.state.constraints.length;
    clickW(app, 10, 7); app.type('20');
    const b = W(app, 40, 7); app.move(b.x + 3, b.y); app.move(b.x, b.y);
    assert.strictEqual(app.state.snapTarget && app.state.snapTarget.type, 'shape', 'the L2 snap shows at the span click');
    app.click(b.x, b.y);
    clickW(app, 40, 12);
    const pol = app.state.constraints.slice(n0).filter((c) => c.type === CONSTRAINT_TYPES.POINT_ON_LINE);
    assert.strictEqual(pol.length, 0, `no point-on-line (${JSON.stringify(pol)})`);
    const centres = app.state.shapes.filter((s) => s.type === 'arc').map((s) => app.state.joints.get(s.joints[0]));
    assert.strictEqual(centres.length, 2, 'the slot has its two end arcs');
    const xs = centres.map((p) => p.x).sort((a, b2) => a - b2);
    assert(Math.abs(xs[0] - 10) < 0.1, `the first centre stays where it was clicked (x ${xs[0].toFixed(3)})`);
    assert(Math.abs(xs[1] - xs[0] - 20) < 1e-6, `the span is the typed 20 (${(xs[1] - xs[0]).toFixed(6)})`);
  } finally { app.esc(); app.esc(); await app.close(); }
});

console.log(`enter-snap-1033-node: ${passed} passed, ${failures.length} failed`);
assert.deepStrictEqual(failures, [], `${failures.length} check(s) failed`);
console.log('enter-snap-1033-node: PASS');
process.exit(0);
