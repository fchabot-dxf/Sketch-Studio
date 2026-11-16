// tests/pattern-neg-angle-691-node.test.js — TASK 691: negative total angle [-360, 0) clockwise for Circular Pattern.
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import {
  applyPattern,
  editPattern,
  patternDefaults,
  patternAngleStep,
  patternValuesRefusal,
  isPatternConstraint,
} from '#core/pattern.js';
import { measureResidual } from '#core/constraint-verifier.js';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { labelEl, labelBoxCenter } from './helpers/node-dom-read.js';

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const near = (a, b, msg, tol = 1e-9) => ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const CIRC = 'circularPattern';
const WANT_MSG = 'the total angle must be between -360 and 360 degrees, not 0';

// 1. patternValuesRefusal & patternAngleStep (the ONE rule in pattern.js)
for (const bad of [0, -0, 400, -400, 360.01, -360.01, NaN]) {
  const why = patternValuesRefusal({ type: CIRC, quantity: 3, angle: bad });
  assert.strictEqual(why, WANT_MSG, `angle=${bad} refused with expected message (got: ${why})`);
  checks++;
}
for (const good of [-360, -120, -90, -0.5, 90, 360]) {
  const why = patternValuesRefusal({ type: CIRC, quantity: 3, angle: good });
  assert.strictEqual(why, null, `angle=${good} accepted (got: ${why})`);
  checks++;
}
near(patternAngleStep({ type: CIRC, quantity: 3, angle: -90 }), -45, 'step -90 / q3');
near(patternAngleStep({ type: CIRC, quantity: 3, angle: -120 }), -60, 'step -120 / q3');
near(patternAngleStep({ type: CIRC, quantity: 3, angle: -360 }), -120, 'step -360 / q3 full circle');

// 2. Fusion-measured centres (circle at user (5,0) around origin, quantity 3) + solver FD Jacobian
{
  const S = L.newSketch();
  const C = L.circle(S, 5, 0, 1);
  const res = applyPattern(S.state, CIRC, { shapes: [C.id], joints: [] }, { ...patternDefaults(CIRC), centre: L.origin, quantity: 3, angle: -90 });
  ok(res.ok, `applyPattern -90 ok (${res.reason})`);
  const c = res.constraint;
  const shape = (id) => S.state.shapes.find((s) => s.id === id);
  const centreAt = (idx) => {
    const j = S.state.joints.get(shape(c.instances[idx].shapes[0]).joints[0]);
    return { x: j.x, y: j.y };
  };
  // User coordinates: y_user = -y_world. So -45 deg = (5*cos(-45), 5*sin(+45) world), -90 deg = (0, +5 world).
  const checkCentres = (degList, tag) => {
    assert.strictEqual(c.instances.length, degList.length, `${tag}: instance count`);
    degList.forEach((deg, idx) => {
      const p = centreAt(idx);
      const rad = deg * Math.PI / 180;
      near(p.x, 5 * Math.cos(rad), `${tag} copy ${idx + 1} x`);
      near(-p.y, 5 * Math.sin(rad), `${tag} copy ${idx + 1} user y`);
    });
    near(measureResidual(c, S.state.joints, S.state.shapes), 0, `${tag} residual === 0`);
  };

  checkCentres([-45, -90], 'Fusion -90 q3');

  // Lock source + centre + radius and verify 0 free DOF & FD Jacobian match
  const Jc = S.state.joints.get(C.c);
  const Jo = S.state.joints.get(L.origin);
  Jc.fixed = true; Jo.fixed = true;
  S.state.constraints.push({ type: 'distance', shape: C.id, isRadius: true, value: 1, __tmp: true });
  const f = S.engine.jointFreedom();
  ok(f.nullity === 0, `-90 q3: copies fully constrained (nullity=${f.nullity})`);
  const fd = L.fdJacobian(S);
  ok(fd.worst.length === 0 && fd.nullity === 0, `-90 q3: analytic Jacobian = FD (${JSON.stringify(fd.worst)})`);
  S.state.constraints.pop();
  Jc.fixed = false; Jo.fixed = false;

  ok(editPattern(S.state, c, { angle: -120 }).ok, 'editPattern -120 ok');
  checkCentres([-60, -120], 'Fusion -120 q3');

  ok(editPattern(S.state, c, { angle: -360 }).ok, 'editPattern -360 ok');
  checkCentres([-120, -240], 'Fusion -360 q3 full circle');

  // 0 and 400 remain refused and mutate nothing
  const snap = JSON.stringify(c);
  for (const bad of [0, 400]) {
    const e = editPattern(S.state, c, { angle: bad });
    ok(!e.ok && e.reason === WANT_MSG, `editPattern(${bad}) refused with exact message (got: ${e.reason})`);
  }
  assert.strictEqual(JSON.stringify(c), snap, 'refused edits leave pattern unchanged');
  checks++;
}

// 3. Real node-app tool dialog while placing + label edit + Ctrl+Z
{
  const profile = await createProfile();
  await createNamedDesign(profile, 'penplotter', 'Pattern 691 Neg Angle');
  const app = await open({ host: 'penplotter', profile });
  try {
    const st = app.state, doc = app.document;
    const r = app.svg.getBoundingClientRect();
    const C = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    const at = (dx, dy) => ({ x: C.x + dx, y: C.y + dy });
    const click = (p) => app.click(p.x, p.y);
    const field = (name) => doc.querySelector(`.sk-pattern-dialog [data-field="${name}"]`);
    const typeIn = (name, text) => { const f = field(name); f.focus(); f.select(); app.type(text); };
    const setDist = (val) => { const sel = field('Distribution'); sel.value = val; sel.dispatchEvent(new app.window.Event('change', { bubbles: true })); app.frames(); };
    const pats = () => st.constraints.filter(isPatternConstraint);
    const toasts = () => (doc.getElementById('notification-container') || { textContent: '' }).textContent;

    // Draw line rightward from centre (at(0,0) -> at(100,0))
    app.tool('line'); click(at(0, 0)); click(at(100, 0)); app.esc();
    app.tool('select');

    app.tool('circularPattern');
    click(at(50, 0));
    app.enter();
    click(at(0, 0));
    ok(pats().length === 1, 'live pattern created');

    setDist('angle');
    typeIn('Angle', '-90');
    const c = pats()[0];
    ok(c.angle === -90 && field('Angle').getAttribute('aria-invalid') === 'false', `Angle=-90 accepted (${c.angle})`);
    const cIdx = st.constraints.indexOf(c);
    const lblText = () => doc.querySelector(`.dim-label[data-constraint-idx="${cIdx}"] text`).textContent;
    ok(lblText().includes('-90'), `canvas label shows signed angle (${lblText()})`);

    // 0 and 400 refused with new message in dialog
    typeIn('Angle', '0');
    ok(field('Angle').getAttribute('aria-invalid') === 'true' && c.angle === -90, '0 marked invalid in Angle box');
    app.enter();
    ok(toasts().includes(WANT_MSG), `Enter on 0 shows exact message (${toasts()})`);
    const angEl = field('Angle');
    angEl.value = '400';
    angEl.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    app.frames();
    ok(angEl.getAttribute('aria-invalid') === 'true' && c.angle === -90, '400 marked invalid in Angle box');
    app.enter();
    ok(toasts().includes(WANT_MSG), `Enter on 400 shows exact message (${toasts()})`);

    // Finish placement at -90
    typeIn('Angle', '-90');
    doc.querySelector('.sk-pattern-dialog .sk-pat-ok').click();
    app.frames();
    ok(!doc.querySelector('.sk-pattern-dialog:not([hidden])') && c.angle === -90, 'OK closes with -90');

    // Double-click pattern label -> edit Angle to -120 -> follows
    await app.pause(550);
    const lab = labelEl(app, cIdx);
    const lPos = labelBoxCenter(app, lab);
    app.dblclick(lPos.x, lPos.y, { target: () => labelEl(app, cIdx) });
    ok(!!doc.querySelector('.sk-pattern-dialog:not([hidden])'), 'label double-click reopens dialog');
    typeIn('Angle', '-120');
    ok(pats()[0].angle === -120 && lblText().includes('-120'), `label edit to -120 updates label (${lblText()})`);
    app.enter();
    ok(!doc.querySelector('.sk-pattern-dialog:not([hidden])') && pats()[0].angle === -120, 'Enter applies -120');

    app.undo();
    ok(pats()[0].angle === -90, `Undo restores -90 (got ${pats()[0].angle})`);
  } finally {
    await app.close();
  }
}

console.log(`pattern-neg-angle-691-node: ${checks} checks passed`);
