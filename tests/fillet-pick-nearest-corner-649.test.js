// TASK 649 (fillet audit, finding F3): two curves that meet at BOTH ends (a "D": a line and an arc; a lens: two arcs) have two corners.
// The two-curve pick fillets the corner NEAREST the two picks. Before: the corner was the first one in the first curve's joint order, so
// picking the line and the arc near the top filleted (and previewed) the BOTTOM corner.
//  1. core: findCornerBetweenLines(state, A, B, near) picks the corner nearest the `near` points (without `near`: the first, as before);
//  2. the tool (SketchStudio through tests/helpers/node-app.js: the app's own input-manager / fillet tool): pick the line near the top,
//     then the arc near the top -> the radius box opens on the TOP corner and Enter fillets the top corner; the same near the bottom.
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import { findCornerBetweenLines } from '#core/fillet.js';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';

// ---- 1. core
{
  const S = L.newSketch();
  const top = L.point(S, 0, 20), bot = L.point(S, 0, -20), c = L.point(S, 0, 0);
  const ln = L.shape(S, L.line(S, bot, top)); // the line's first joint is the BOTTOM corner
  const arc = L.shape(S, L.arc(S, c, top, bot));
  const y = (k) => k && k.cornerPt.y;
  assert.strictEqual(y(findCornerBetweenLines(S.state, ln, arc)), -20, 'no pick points: the first corner (unchanged)');
  assert.strictEqual(y(findCornerBetweenLines(S.state, ln, arc, [{ x: 0, y: 14 }, { x: 17, y: 10 }])), 20, 'picks near the top: the top corner');
  assert.strictEqual(y(findCornerBetweenLines(S.state, arc, ln, [{ x: 17, y: -10 }, { x: 0, y: -14 }])), -20, 'picks near the bottom (arc first): the bottom corner');
  assert.strictEqual(y(findCornerBetweenLines(S.state, ln, arc, [{ x: 0, y: -14 }, { x: 17, y: 10 }])), -20, 'one pick near each: the corner nearest both (here the bottom)');
}

// ---- 2. the tool, SketchStudio
const profile = await createProfile();
await createNamedDesign(profile, 'sketchstudio', 'Fillet 649 D shape');
const app = await open({ host: 'sketchstudio', profile });
try {
  const st = app.state;
  const r = app.svg.getBoundingClientRect();
  const C = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  // zoom out until 100 px is more than 15 mm (a 20 mm half-height D fits on the canvas)
  for (let i = 0; i < 20 && Math.abs(app.toScreen(15, 0).x - app.toScreen(0, 0).x) > 100; i++) app.wheel(C.x, C.y, 300);
  for (const where of ['top', 'bottom']) {
    // the D, built as the Arc and Line tools store it: an arc centre (0,0) from the top (0,-20) round the right to the bottom (0,20) (screen y down),
    // and a line from the bottom to the top sharing both end joints
    st.clearDocument();
    const J = (x, y) => { const id = st.genJ(); st.joints.set(id, { x, y, fixed: false }); return id; };
    const jc = J(0, 0), jt = J(0, -20), jb = J(0, 20);
    st.shapes.push({ id: 's_arc_d', type: 'arc', subType: 'CENTER', joints: [jc, jt, jb], sweep: true });
    st.constraints.push({ type: 'equal', joints: [jc, jt, jc, jb] });
    st.shapes.push({ id: 's_line_d', type: 'line', joints: [jb, jt] });
    app.frames();
    const s = where === 'top' ? -1 : 1;
    const onLine = app.toScreen(0, s * 14), onArc = app.toScreen(20 * Math.cos(s * Math.PI / 3), 20 * Math.sin(s * Math.PI / 3));
    const cornerY = s * 20;
    app.tool('fillet');
    app.click(onLine.x, onLine.y);
    app.click(onArc.x, onArc.y);
    const box = app.document.getElementById('fillet-radius-input');
    assert.ok(box, `${where}: the radius box opens after the two picks`);
    const cs = app.toScreen(0, cornerY);
    const bx = parseFloat(box.style.left), by = parseFloat(box.style.top);
    assert.ok(Math.abs(bx - (cs.x + 14)) < 2 && Math.abs(by - (cs.y + 14)) < 2, `${where}: the box sits at the ${where} corner (box ${bx},${by}; corner ${cs.x},${cs.y})`);
    app.enter();
    const fil = st.shapes.find((x) => x.type === 'arc' && x.id !== 's_arc_d');
    assert.ok(fil, `${where}: Enter fillets`);
    const O = st.joints.get(fil.joints[0]);
    assert.ok(Math.sign(O.y) === s && Math.abs(O.y) > 10, `${where}: the fillet is at the ${where} corner (its centre y ${O.y.toFixed(2)})`);
    app.esc(); app.esc();
  }
} finally { await app.close(); }
console.log('fillet-pick-nearest-corner-649.test.js: ok');
