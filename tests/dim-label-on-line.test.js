// tests/dim-label-on-line.test.js — TASK 621: a dimension's label ALWAYS lives ON its dimension line / arc / leader,
// and dragging it freely in X & Y moves the dimension line / arrows / arc / leader with it ("do it like Fusion").
import assert from 'node:assert';
import { open } from './helpers/node-app.js';
import { px, labelEl, labelPoint } from './helpers/node-dom-read.js';
import { serializeDocument, deserializeDocument } from '#core/document.js';
import { createEngine } from '#core/constraint-solver.js';
import { addConstraintObject } from '#core/constraints.js';
import { createSketchState } from '#ui/sketch-state.js';
import { TOOL_MODES } from '#core/constants.js';
import SettingsManager from '#core/settings-manager.js';
import { draw } from '#ui/svg-renderer.js';

const NO_SNAP = { grid: false, joints: false, lines: false, midpoint: false, perpendicular: false, axes: false };
const leadsOf = (html) => [...html.matchAll(/<line class="dim-lead" x1="([-\d.e]+)" y1="([-\d.e]+)" x2="([-\d.e]+)" y2="([-\d.e]+)"/g)].map((m) => m.slice(1).map(Number));
const dimLinesOf = (html) => [...html.matchAll(/<line x1="([-\d.e]+)" y1="([-\d.e]+)" x2="([-\d.e]+)" y2="([-\d.e]+)"[^>]*stroke-width="1\.5"/g)].map((m) => m.slice(1).map(Number));
const arcsOf = (html) => [...html.matchAll(/<path d="M ([-\d.e]+) ([-\d.e]+) A ([-\d.e]+) ([-\d.e]+) 0 ([01]) ([01]) ([-\d.e]+) ([-\d.e]+)"/g)].map((m) => m.slice(1).map(Number));
const arrowsOf = (html) => [...html.matchAll(/<polygon points="([-\d.e]+),([-\d.e]+) /g)].map((m) => ({ x: +m[1], y: +m[2] }));

const near = (a, b, msg, eps = 1e-4) => assert(Math.abs(a - b) <= eps, `${msg}: got ${a}, want ${b}`);
const onSegmentLine = (p, a, b, eps = 1e-4) => {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  assert(len > 1e-6, 'degenerate segment');
  const cross = Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
  assert(cross <= eps, `point (${p.x},${p.y}) not on line (${a.x},${a.y})-(${b.x},${b.y}), perp=${cross}`);
};

const renderState = (joints, shapes, constraints, box = false) => {
  const prev = SettingsManager.get('DIM_LABEL_BOX');
  SettingsManager.set('DIM_LABEL_BOX', box);
  let html = '';
  const fakeSvg = {
    viewBox: { baseVal: { x: -400, y: -400, width: 1000, height: 1000 } },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }),
    get innerHTML() { return html; },
    set innerHTML(v) { html = v; },
    style: {},
    querySelectorAll: () => [],
    closest: () => null,
  };
  try {
    draw(joints, shapes, fakeSvg, null, null, constraints, new Set(), new Set(), TOOL_MODES.SELECT);
    return html;
  } finally {
    SettingsManager.set('DIM_LABEL_BOX', prev);
  }
};

// ── 1. Default placement: label sits ON its line / arc / leader for EVERY kind, both DIM_LABEL_BOX off and on ──
for (const boxed of [false, true]) {
  // 1a. Horizontal distance
  {
    const joints = new Map([['a', { id: 'a', x: 0, y: 0 }], ['b', { id: 'b', x: 100, y: 0 }]]);
    const shapes = [{ id: 'l', type: 'line', joints: ['a', 'b'] }];
    const c = { id: 'dh', type: 'distance', joints: ['a', 'b'], dimMode: 'horizontal', value: 100, offset: 40 };
    const html = renderState(joints, shapes, [c], boxed);
    near(c.glyphPos.x, 50, `H centered x (boxed=${boxed})`);
    near(c.glyphPos.y, 40, `H offset y (boxed=${boxed})`);
    const arrows = arrowsOf(html);
    assert.strictEqual(arrows.length, 2, 'H 2 arrows');
    onSegmentLine(c.glyphPos, arrows[0], arrows[1]);
    assert.strictEqual(leadsOf(html).length, 0, `H centered has no lead line (boxed=${boxed})`);
  }

  // 1b. Vertical distance
  {
    const joints = new Map([['a', { id: 'a', x: 0, y: 0 }], ['b', { id: 'b', x: 0, y: -50 }]]);
    const shapes = [{ id: 'l', type: 'line', joints: ['a', 'b'] }];
    const c = { id: 'dv', type: 'distance', joints: ['a', 'b'], dimMode: 'vertical', value: 50, offset: 29 };
    const html = renderState(joints, shapes, [c], boxed);
    near(c.glyphPos.x, 29, `V offset x (boxed=${boxed})`);
    near(c.glyphPos.y, -25, `V centered y (boxed=${boxed})`);
    const arrows = arrowsOf(html);
    onSegmentLine(c.glyphPos, arrows[0], arrows[1]);
  }

  // 1c. Aligned distance
  {
    const joints = new Map([['a', { id: 'a', x: 0, y: 0 }], ['b', { id: 'b', x: 60, y: 80 }]]);
    const shapes = [{ id: 'l', type: 'line', joints: ['a', 'b'] }];
    const c = { id: 'da', type: 'distance', joints: ['a', 'b'], dimMode: 'aligned', value: 100, offset: 30 };
    const html = renderState(joints, shapes, [c], boxed);
    const arrows = arrowsOf(html);
    onSegmentLine(c.glyphPos, arrows[0], arrows[1]);
  }

  // 1d. Point-to-line distance
  {
    const joints = new Map([['p', { id: 'p', x: 30, y: 50 }], ['la', { id: 'la', x: 0, y: 0 }], ['lb', { id: 'lb', x: 100, y: 0 }]]);
    const shapes = [{ id: 'l', type: 'line', joints: ['la', 'lb'] }];
    const c = { id: 'dp2l', type: 'distance', joints: ['p', 'la', 'lb'], value: 50, offset: 40 };
    const html = renderState(joints, shapes, [c], boxed);
    const arrows = arrowsOf(html);
    assert.strictEqual(arrows.length, 2, 'p2l 2 arrows');
    onSegmentLine(c.glyphPos, arrows[0], arrows[1]);
  }

  // 1e. Line-to-line distance
  {
    const joints = new Map([
      ['a1', { id: 'a1', x: 0, y: 0 }], ['a2', { id: 'a2', x: 100, y: 0 }],
      ['b1', { id: 'b1', x: 0, y: 50 }], ['b2', { id: 'b2', x: 100, y: 50 }],
    ]);
    const shapes = [{ id: 'l1', type: 'line', joints: ['a1', 'a2'] }, { id: 'l2', type: 'line', joints: ['b1', 'b2'] }];
    const c = { id: 'dl2l', type: 'distance', shapes: ['l1', 'l2'], value: 50, offset: 35 };
    const html = renderState(joints, shapes, [c], boxed);
    const arrows = arrowsOf(html);
    assert.strictEqual(arrows.length, 2, 'l2l 2 arrows');
    onSegmentLine(c.glyphPos, arrows[0], arrows[1]);
  }

  // 1f. Angle dimension
  {
    const joints = new Map([['o', { id: 'o', x: 0, y: 0 }], ['a', { id: 'a', x: 100, y: 0 }], ['b', { id: 'b', x: 60, y: 80 }]]);
    const shapes = [{ id: 'l1', type: 'line', joints: ['o', 'a'] }, { id: 'l2', type: 'line', joints: ['o', 'b'] }];
    const c = { id: 'dang', type: 'angle', shapes: ['l1', 'l2'], value: 53.130102, sector: { s1: 1, s2: 1 }, offset: 45 };
    const html = renderState(joints, shapes, [c], boxed);
    const arcs = arcsOf(html);
    assert(arcs.length >= 1, 'angle draws arc');
    near(arcs[0][2], 45, `angle arc radius matches offset (boxed=${boxed})`);
    near(Math.hypot(c.glyphPos.x, c.glyphPos.y), 45, `angle label lies on arc radius (boxed=${boxed})`);
  }

  // 1g. Radius & Diameter
  for (const isDiameter of [false, true]) {
    const joints = new Map([['c', { id: 'c', x: 10, y: 20 }]]);
    const shapes = [{ id: 'circ', type: 'circle', joints: ['c'], radius: 25 }];
    const c = { id: 'dr', type: 'distance', isRadius: true, isDiameter, shape: 'circ', value: isDiameter ? 50 : 25, offset: 45, labelAngle: Math.PI / 4 };
    const html = renderState(joints, shapes, [c], boxed);
    near(c.glyphPos.x, 10 + 45 * Math.cos(Math.PI / 4), `rad/dia x (boxed=${boxed}, dia=${isDiameter})`);
    near(c.glyphPos.y, 20 + 45 * Math.sin(Math.PI / 4), `rad/dia y (boxed=${boxed}, dia=${isDiameter})`);
    const ls = dimLinesOf(html);
    assert(ls.length >= 1, 'rad/dia leader drawn');
  }
}

// ── 2. Dragging via real app pointer (node-app): sideways, along, diagonal, past-arrow extension, 1-step undo ──
{
  const app = await open('sketchstudio');
  if (app.state.snapSettings) Object.assign(app.state.snapSettings, NO_SNAP);
  // Create vertical 50 mm line (0,0) -> (0,-50) and vertical dimension at offset=29
  app.state.joints.set('j0', { id: 'j0', x: 0, y: 0 });
  app.state.joints.set('j1', { id: 'j1', x: 0, y: -50 });
  app.state.shapes.push({ id: 'l0', type: 'line', joints: ['j0', 'j1'] });
  assert(addConstraintObject(app.state, { type: 'distance', joints: ['j0', 'j1'], value: 50, dimMode: 'vertical', offset: 29 }));
  app.document.getElementById('tool-select').click();
  app.frames();

  const c = () => app.state.constraints[0];
  const dragLabelTo = (wx, wy) => {
    app.click(px(app, -200, -200).x, px(app, -200, -200).y);
    const p0 = labelPoint(app, 0);
    const p1 = px(app, wx, wy);
    app.drag(p0, p1, 4, { target: () => labelEl(app, 0) });
  };

  // Initial check: label centered at (29, -25)
  near(c().glyphPos.x, 29, 'initial x');
  near(c().glyphPos.y, -25, 'initial y');

  // 2a. Sideways drag (29,-25) -> (70,-25): offset becomes 70, labelSlide stays ~0, arrows move to x=70
  dragLabelTo(70, -25);
  near(c().offset, 70, 'sideways drag updates offset', 1.5);
  assert(Math.abs(c().labelSlide || 0) < 1.5, `sideways drag keeps label centered (slide=${c().labelSlide})`);
  near(c().glyphPos.x, 70, 'sideways label x on line', 1.5);
  const arrowsSide = arrowsOf(app.svg.innerHTML);
  near(arrowsSide[0].x, 70, 'sideways arrows moved to x=70', 1.5);

  // 2b. Along drag (70,-25) -> (70,-10): offset stays ~70, labelSlide shifts, label sits at (70,-10)
  dragLabelTo(70, -10);
  near(c().offset, 70, 'along drag preserves offset', 1.5);
  near(c().glyphPos.y, -10, 'along drag slides label y', 1.5);
  assert(Math.abs(c().labelSlide) > 10, `along drag sets labelSlide (got ${c().labelSlide})`);

  // 2c. Diagonal drag across & PAST top arrow: (70,-10) -> (90, 25) (above y=0!)
  // Wait: line runs y=0 to y=-50, so y=25 is past y=0!
  dragLabelTo(90, 25);
  near(c().offset, 90, 'diagonal drag updates offset to ~90', 1.5);
  near(c().glyphPos.y, 25, 'diagonal drag updates y past arrow to ~25', 1.5);
  const arrowsDiag = arrowsOf(app.svg.innerHTML);
  near(arrowsDiag[0].x, 90, 'diagonal arrows follow offset to ~90', 1.5);
  // Past arrow: dim-lead extension MUST extend from arrow (y=0) past y=0 toward/under y=25!
  const leadsDiag = leadsOf(app.svg.innerHTML);
  assert(leadsDiag.length === 1, `past-arrow drag draws 1 extension line, no off-line leader (got ${JSON.stringify(leadsDiag)})`);
  near(leadsDiag[0][0], arrowsDiag[0].x, 'extension stays at x=offset', 1.5);
  near(leadsDiag[0][2], arrowsDiag[0].x, 'extension stays strictly vertical along line', 1.5);
  assert(leadsDiag[0][3] > 20, `extension reaches past arrow toward y=25 (got y2=${leadsDiag[0][3]})`);

  // 2d. One Undo restores the whole diagonal drag in ONE step
  app.key('z', { ctrl: true });
  near(c().offset, 70, 'one undo restores offset to ~70', 1.5);
  near(c().glyphPos.y, -10, 'one undo restores y to ~-10', 1.5);

  // 2e. Sideways drag to offset = 0 does NOT jump back to default 30
  dragLabelTo(0, -25);
  assert(Math.abs(c().offset) < 2, `dragging label onto geometry keeps offset ~0 (got ${c().offset}), no || 30 jump`);

  await app.close();
}

// ── 3. Past-arrow extension in BOTH ends & BOTH styles (DIM_LABEL_BOX false and true) ──
for (const boxed of [false, true]) {
  const joints = new Map([['a', { id: 'a', x: 0, y: 0 }], ['b', { id: 'b', x: 100, y: 0 }]]);
  const shapes = [{ id: 'l', type: 'line', joints: ['a', 'b'] }];
  for (const [label, slide] of [['past-end', 80], ['past-start', -80]]) {
    const c = { id: 'd', type: 'distance', joints: ['a', 'b'], dimMode: 'horizontal', value: 100, offset: 40, labelSlide: slide };
    const html = renderState(joints, shapes, [c], boxed);
    const ls = leadsOf(html);
    assert.strictEqual(ls.length, 1, `H ${label} (boxed=${boxed}) draws 1 extension, got ${JSON.stringify(ls)}`);
    near(ls[0][1], 40, 'extension y1 at offset');
    near(ls[0][3], 40, 'extension y2 at offset (no off-line leader)');
    if (slide > 0) assert(ls[0][2] > 100, `past-end extends beyond x=100 (x2=${ls[0][2]})`);
    else assert(ls[0][2] < 0, `past-start extends beyond x=0 (x2=${ls[0][2]})`);
  }
}

// ── 4. Angle & Radius drags via node-app ──
{
  const app = await open('sketchstudio');
  if (app.state.snapSettings) Object.assign(app.state.snapSettings, NO_SNAP);
  app.state.joints.set('o', { id: 'o', x: 0, y: 0, fixed: true });
  app.state.joints.set('a', { id: 'a', x: 100, y: 0, fixed: true });
  app.state.joints.set('b', { id: 'b', x: 0, y: 100 });
  app.state.shapes.push({ id: 'l1', type: 'line', joints: ['o', 'a'] });
  app.state.shapes.push({ id: 'l2', type: 'line', joints: ['o', 'b'] });
  assert(addConstraintObject(app.state, { type: 'angle', shapes: ['l1', 'l2'], value: 90, sector: { ray1: 1, ray2: 1, turn: 1 }, offset: 40 }));
  app.document.getElementById('tool-select').click();
  app.frames();

  // Drag angle label diagonally in X & Y -> both arc radius (offset) AND angle along arc (labelAngle) move;
  // dragging outside the 90 deg sector (0 .. pi/2) to -45 deg draws an arc extension along the new radius!
  const targetAngle = -Math.PI / 4, targetR = 75;
  const p0 = labelPoint(app, 0);
  const p1 = px(app, Math.cos(targetAngle) * targetR, Math.sin(targetAngle) * targetR);
  app.drag(p0, p1, 4, { target: () => labelEl(app, 0) });
  const ca = app.state.constraints[0];
  near(ca.offset, targetR, 'angle drag moves arc radius', 2);
  near(ca.labelAngle, targetAngle, 'angle drag sets labelAngle', 0.05);
  const arcs = arcsOf(app.svg.innerHTML);
  assert(arcs.length >= 2, `angle label outside sector draws sector arc + extension arc (got ${arcs.length})`);
  near(arcs[0][2], targetR, 'sector arc follows dragged radius', 2);
  near(arcs[1][2], targetR, 'extension arc shares dragged radius', 2);

  // One undo restores angle label
  app.key('z', { ctrl: true });
  const caUndone = app.state.constraints[0];
  near(caUndone.offset, 40, 'one undo restores angle offset', 1.5);
  assert(!Number.isFinite(caUndone.labelAngle), 'one undo clears labelAngle back to default bisect');

  await app.close();
}

// ── 5. Old-file projection: stored free labelPos loads ONTO the line / arc / leader ──
{
  const mk = () => { const e = createEngine(); e.init(); return createSketchState(e, { x: -400, y: -400, w: 1000, h: 1000 }); };

  // 5a. Owner's exact case: vertical 50 mm (0,0)-(0,-50), old offset=29, labelPos=(55,-7)
  const docOwner = {
    version: 1,
    geometry: {
      joints: [{ id: 'j0', x: 0, y: 0 }, { id: 'j1', x: 0, y: -50 }],
      shapes: [{ id: 'l0', type: 'line', joints: ['j0', 'j1'] }],
      constraints: [{ id: 'c0', type: 'distance', joints: ['j0', 'j1'], value: 50, dimMode: 'vertical', offset: 29, labelPos: { x: 55, y: -7 } }],
    },
  };
  const s = mk();
  assert(deserializeDocument(docOwner, s).ok, 'docOwner loads');
  const c = s.constraints[0];
  assert(!('labelPos' in c), 'old labelPos converted on load and removed');
  near(c.offset, 55, 'owner case: perpendicular X=55 becomes offset');
  const html = renderState(s.joints, s.shapes, s.constraints, false);
  near(c.glyphPos.x, 55, 'owner case: label ends up at x=55 ON the dim line');
  near(c.glyphPos.y, -7, 'owner case: label preserves y=-7 along the dim line');
  const arrows = arrowsOf(html);
  near(arrows[0].x, 55, 'owner case: dim line & arrows move to x=55');
  const leadsOwner = leadsOf(html);
  // y=-7 is 7 world units from j0=(0,0), so the outer edge of "50.0" extends ~5 units past the y=0 arrow vertically along x=55 (no horizontal leader!)
  for (const [lx1, , lx2] of leadsOwner) { near(lx1, 55, 'owner case: any lead stays strictly on x=55'); near(lx2, 55, 'owner case: no horizontal leader'); }

  // 5b. Old angle & radius docs with stored labelPos
  const docMix = {
    version: 1,
    geometry: {
      joints: [
        { id: 'o', x: 0, y: 0 }, { id: 'a', x: 100, y: 0 }, { id: 'b', x: 0, y: -100 },
        { id: 'cc', x: 200, y: 0 },
      ],
      shapes: [
        { id: 'l1', type: 'line', joints: ['o', 'a'] },
        { id: 'l2', type: 'line', joints: ['o', 'b'] },
        { id: 'circ', type: 'circle', joints: ['cc'], radius: 30 },
      ],
      constraints: [
        { id: 'ca', type: 'angle', shapes: ['l1', 'l2'], value: 90, sector: { ray1: 1, ray2: 1, turn: -1 }, offset: 40, labelPos: { x: 60, y: -80 } },
        { id: 'cr', type: 'distance', isRadius: true, shape: 'circ', value: 30, offset: 40, labelPos: { x: 200, y: -70 } },
      ],
    },
  };
  const s2 = mk();
  assert(deserializeDocument(docMix, s2).ok, 'docMix loads');
  const ca = s2.constraints.find((k) => k.type === 'angle');
  const cr = s2.constraints.find((k) => k.isRadius);
  assert(!('labelPos' in ca) && !('labelPos' in cr), 'old angle & radius labelPos removed on load');
  near(ca.offset, 100, 'old angle labelPos projects radius to offset=100');
  near(ca.labelAngle, Math.atan2(-80, 60), 'old angle labelPos projects labelAngle');
  near(cr.offset, 70, 'old radius labelPos projects distance to offset=70');
  near(cr.labelAngle, -Math.PI / 2, 'old radius labelPos projects labelAngle=-pi/2');
}

console.log('dim-label-on-line: all unit/node invariants passed.');
