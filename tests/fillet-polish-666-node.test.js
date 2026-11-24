// tests/fillet-polish-666-node.test.js -- TASK 666: six fillet rough edges (F7, F8, F9, F10, F18, F23).
// Node + happy-dom tests through the real SketchStudio / PenPlotter Design-tab modules.
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import { COLLAPSE_TOL, calculateFilletGeometry, cornerFilletGeometry, applyFillet, findCornerBetweenLines, findCornerAtJoint } from '#core/fillet.js';
import { previewDimensionInput } from '#core/parameters.js';
import { applyParameterChange } from '#core/dimension-seams.js';
import SettingsManager, { docUnit } from '#core/settings-manager.js';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';

const origUnit = docUnit();
const J = (st, x, y) => { const id = st.genJ(); st.joints.set(id, { x, y, fixed: false }); return id; };
const clearToasts = (doc) => doc.querySelectorAll('#notification-container [data-level]').forEach((e) => e.remove());
const toastTexts = (doc) => [...doc.querySelectorAll('#notification-container [data-level]')].map((e) => e.textContent.trim().replace(/^[^A-Za-z]+/, ''));

try {
  // ---- F7: radii < 0.1 mm are NOT floored to 0.1; <= 0 / non-finite explicitly refused
  {
    const S = L.newSketch();
    const c = L.point(S, 0, 0), a = L.point(S, 10, 0), b = L.point(S, 0, 10);
    const la = L.shape(S, L.line(S, c, a)), lb = L.shape(S, L.line(S, c, b));
    const corner = findCornerBetweenLines(S.state, la, lb);

    const gSmall = calculateFilletGeometry({ x: 10, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 10 }, 0.05);
    assert.strictEqual(gSmall.valid, true, '0.05mm corner geometry is valid: ' + gSmall.reason);
    assert.ok(Math.abs(gSmall.radius - 0.05) < 1e-9, `F7: expected geometry radius 0.05, got ${gSmall.radius}`);

    const gCorner = cornerFilletGeometry(corner, 0.05);
    assert.strictEqual(gCorner.valid, true, '0.05mm cornerFilletGeometry is valid: ' + gCorner.reason);
    assert.ok(Math.abs(gCorner.radius - 0.05) < 1e-9, `F7: expected corner radius 0.05, got ${gCorner.radius}`);

    for (const bad of [0, -0.5, NaN]) {
      const r1 = calculateFilletGeometry({ x: 10, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 10 }, bad);
      assert.strictEqual(r1.valid, false, `F7: radius ${bad} must be refused in calculateFilletGeometry`);
      const r2 = cornerFilletGeometry(corner, bad);
      assert.strictEqual(r2.valid, false, `F7: radius ${bad} must be refused in cornerFilletGeometry`);
    }

    const res = applyFillet(S.state, corner, 0.05);
    assert.strictEqual(res.success, true, 'F7: applyFillet(0.05) succeeds: ' + res.error);
    assert.ok(Math.abs(res.radius - 0.05) < 1e-9, `F7: applied radius expected 0.05, got ${res.radius}`);
    const rc = S.state.constraints.find((con) => con.isRadius);
    assert.ok(rc && Math.abs(rc.value - 0.05) < 1e-9, `F7: radius constraint expected 0.05, got ${rc && rc.value}`);
  }

  // ---- F8: refusal / collapse messages print in active docUnit() via #core/units.js (never raw mm)
  {
    SettingsManager.set('DOC_UNIT', 'in');
    const S = L.newSketch();
    const lenMm = 1.3 * 25.4; // 33.02 mm = 1.3 in
    const c = L.point(S, 0, 0), a = L.point(S, lenMm, 0), b = L.point(S, 0, lenMm);
    const la = L.shape(S, L.line(S, c, a)), lb = L.shape(S, L.line(S, c, b));
    const corner = findCornerBetweenLines(S.state, la, lb);
    const gCollapse = cornerFilletGeometry(corner, lenMm);
    assert.strictEqual(gCollapse.valid, false, 'exact leg collapse refuses');
    assert.ok(gCollapse.reason.includes('1.3in'), `F8: collapse reason should include 1.3in, got: ${gCollapse.reason}`);
    assert.ok(!gCollapse.reason.includes('33.02'), `F8: collapse reason must not leak raw mm 33.02, got: ${gCollapse.reason}`);

    // Near-180 corner: COLLAPSE_TOL message prints in active docUnit() too
    const flatCorner = { pA: { x: 50, y: 0 }, cornerPt: { x: 0, y: 0 }, pB: { x: -50, y: 0.0001 } };
    const gFlat = calculateFilletGeometry(flatCorner.pA, flatCorner.cornerPt, flatCorner.pB, 2.54);
    assert.strictEqual(gFlat.valid, false, 'near-180 corner refuses');
    assert.ok(gFlat.reason.includes('0.1in'), `F8: small corner msg should show 0.1in, got: ${gFlat.reason}`);
    assert.ok(!gFlat.reason.includes(`${COLLAPSE_TOL} mm`), `F8: small corner msg must not print raw mm, got: ${gFlat.reason}`);

    // Arc too small for requested fillet radius (line + arc corner): leg radius formatted in in
    const SA = L.newSketch();
    const ac = L.point(SA, 0, 0), aa = L.point(SA, 0, 50.8); // 2in line on same side as arcCenter -> internal tangency
    const arcCenter = L.point(SA, 0, 12.7); // 0.5in radius arc meeting at (0,0)
    const arcEnd = L.point(SA, 12.7, 12.7);
    L.line(SA, ac, aa);
    SA.state.shapes.push({ id: 'arc1', type: 'arc', joints: [arcCenter, ac, arcEnd], radius: 12.7 });
    const arcCorner = findCornerAtJoint(SA.state, ac);
    assert.ok(arcCorner, 'arc corner found');
    const legFail = cornerFilletGeometry(arcCorner, 25.4);
    assert.strictEqual(legFail.valid, false, 'arc fillet R=1in on R=0.5in arc refuses');
    assert.ok(legFail.reason.includes('1in') && legFail.reason.includes('0.5in'), `F8: arc refusal must print 1in / 0.5in, got: ${legFail.reason}`);

    // dimension-seams fillet radius edit collapse (line 127) formats in in
    const SD = L.newSketch();
    const dc = L.point(SD, 0, 0), da = L.point(SD, lenMm, 0), db = L.point(SD, 0, lenMm);
    const dl1 = L.shape(SD, L.line(SD, dc, da)), dl2 = L.shape(SD, L.line(SD, dc, db));
    const applied = applyFillet(SD.state, findCornerBetweenLines(SD.state, dl1, dl2), 6.35);
    assert.strictEqual(applied.success, true);
    const rc = SD.state.constraints.find((con) => con.isRadius);
    const pv = previewDimensionInput(SD.state, rc, '1.3in', { unit: 'in' });
    assert.strictEqual(pv.ok, true);
    const seamRes = applyParameterChange(SD.state, pv.plan, 'edit radius', { snapshot: false });
    assert.strictEqual(seamRes.reverted, true, 'collapse reverts');
    assert.ok(seamRes.reason.includes('1.3in'), `F8: dimension-seams fillet reason should say 1.3in, got: ${seamRes.reason}`);
    assert.ok(!seamRes.reason.includes('33.02'), `F8: dimension-seams fillet reason must not leak 33.02, got: ${seamRes.reason}`);
  }

  // ---- F9, F10, F18, F23 through full UI in node-app (penplotter mounts .sk-done & tools)
  SettingsManager.set('DOC_UNIT', 'mm');
  const profile = await createProfile();
  await createNamedDesign(profile, 'penplotter', 'Fillet 666');
  const app = await open({ host: 'penplotter', profile });
  try {
    const st = app.state, doc = app.document, win = app.window;
    // Inject a leading hidden sprite <svg aria-hidden="true"> like ensureIconSymbols() creates in the real app
    const spriteSvg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    spriteSvg.setAttribute('aria-hidden', 'true');
    spriteSvg.style.position = 'absolute';
    doc.body.prepend(spriteSvg);

    const r = app.svg.getBoundingClientRect();
    const C = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    for (let i = 0; i < 20 && Math.abs(app.toScreen(15, 0).x - app.toScreen(0, 0).x) > 120; i++) app.wheel(C.x, C.y, 300);

    const drawCorner = () => {
      st.clearDocument();
      const jc = J(st, 0, 0);
      st.shapes.push({ id: 'l_1', type: 'line', joints: [jc, J(st, 30, 0)] });
      st.shapes.push({ id: 'l_2', type: 'line', joints: [jc, J(st, 0, 30)] });
      app.frames();
      return app.toScreen(0, 0);
    };

    // F10: Fillet / Trim / Break set cursor on app.svg (NOT spriteSvg) and reset on tool switch
    app.tool('fillet');
    assert.strictEqual(spriteSvg.style.cursor, '', 'F10: hidden sprite svg must NOT receive cursor');
    assert.strictEqual(app.svg.style.cursor, 'crosshair', 'F10: fillet sets crosshair on canvas svg');
    app.tool('trim');
    assert.strictEqual(app.svg.style.cursor, 'crosshair', 'F10: trim sets crosshair on canvas svg');
    app.tool('select');
    assert.strictEqual(app.svg.style.cursor, '', 'F10: select resets canvas svg cursor');
    app.tool('break');
    assert.strictEqual(app.svg.style.cursor, 'crosshair', 'F10: break sets crosshair on canvas svg');
    app.tool('select');
    assert.strictEqual(app.svg.style.cursor, '', 'F10: select resets break cursor');

    // F18 + F9 + F7 in UI
    const cornerPt = drawCorner();
    app.tool('fillet');
    clearToasts(doc);
    app.click(cornerPt.x, cornerPt.y);

    const boxEl = () => doc.getElementById('fillet-radius-input');
    const previewArc = () => doc.querySelector('#fillet-tool-overlay path[d*=" A "]');
    const handleEl = () => doc.querySelector('#fillet-tool-overlay .fillet-handle');
    const previewLabel = () => doc.querySelector('#fillet-tool-overlay text');
    const doneBtn = () => doc.querySelector('.sk-done');

    assert.ok(boxEl(), 'radius box opens');
    assert.strictEqual(boxEl().value, '5', `F18: radius box expected "5", got "${boxEl().value}"`);
    assert.ok(previewLabel(), 'preview label present');
    assert.strictEqual(previewLabel().textContent, 'R 5', `F18: preview text expected "R 5", got "${previewLabel().textContent}"`);
    assert.strictEqual(boxEl().getAttribute('aria-invalid'), 'false', 'F9: valid start sets aria-invalid=false');
    assert.ok(doneBtn() && !doneBtn().hidden && !doneBtn().disabled, 'F9: .sk-done enabled while valid');

    // Hover over arrow handle sets pointer cursor on app.svg (F10)
    const pts = handleEl().getAttribute('points').trim().split(/\s+/).map((p) => p.split(',').map(Number));
    const hCenterWorld = { x: pts.reduce((s, p) => s + p[0], 0) / pts.length, y: pts.reduce((s, p) => s + p[1], 0) / pts.length };
    const hScreen = app.toScreen(hCenterWorld.x, hCenterWorld.y);
    app.move(hScreen.x, hScreen.y, { target: () => handleEl() });
    assert.strictEqual(app.svg.style.cursor, 'pointer', 'F10: hover over .fillet-handle sets pointer on canvas svg');
    assert.strictEqual(spriteSvg.style.cursor, '', 'F10: sprite svg stays untouched');

    // F9: invalid values ('abc', '0', '-1') -> aria-invalid="true", preview hidden, .sk-done disabled, Enter warns
    const replaceText = (txt) => {
      const el = boxEl();
      el.focus();
      el.value = txt;
      el.dispatchEvent(new win.InputEvent('input', { bubbles: true }));
      app.frames();
    };
    for (const bad of ['abc', '0', '-1', '']) {
      replaceText(bad);
      assert.strictEqual(boxEl().getAttribute('aria-invalid'), 'true', `F9: "${bad}" sets aria-invalid="true"`);
      assert.strictEqual(previewArc(), null, `F9: "${bad}" hides preview arc`);
      assert.strictEqual(handleEl(), null, `F9: "${bad}" hides drag handle`);
      assert.strictEqual(doneBtn().disabled, true, `F9: "${bad}" disables .sk-done`);
      const arcsBefore = st.shapes.filter((s) => s.type === 'arc').length;
      doneBtn().click(); app.frames();
      assert.strictEqual(st.shapes.filter((s) => s.type === 'arc').length, arcsBefore, `F9: clicking disabled .sk-done does not apply`);
      assert.ok(boxEl(), `F9: "${bad}" leaves box open on disabled .sk-done click`);
    }
    clearToasts(doc);
    app.enter();
    assert.ok(toastTexts(doc).some((t) => t.includes('Enter a radius greater than zero')), 'F9: Enter on invalid warns');
    assert.ok(boxEl(), 'F9: Enter on invalid keeps box open');

    // Recover by typing valid 0.05 (also checks F7 in UI!)
    replaceText('0.05');
    assert.strictEqual(boxEl().getAttribute('aria-invalid'), 'false', 'F9: typing 0.05 clears aria-invalid');
    assert.ok(previewArc(), 'F9: valid 0.05 restores preview arc');
    assert.ok(handleEl(), 'F9: valid 0.05 restores handle');
    assert.strictEqual(doneBtn().disabled, false, 'F9: valid 0.05 re-enables .sk-done');

    // Apply R = 5 via valid typing + Enter -> F18 the rendered dim label says "R 5" (TASK 878: no "Fillet applied" toast: the fillet and its label show)
    replaceText('5');
    clearToasts(doc);
    let legacyDrawCalls = 0;
    win.__requestDraw = () => { legacyDrawCalls++; };
    app.enter();
    assert.strictEqual(legacyDrawCalls, 0, 'F23: hidden window.__requestDraw fallback must not be called');
    assert.deepStrictEqual(toastTexts(doc), [], `F18: TASK 878: no toast after a fillet that applied, got ${JSON.stringify(toastTexts(doc))}`);
    const dimLabel = doc.querySelector('.dim-label');
    assert.ok(dimLabel && dimLabel.textContent.trim() === 'R 5', `F18: dim label expected "R 5", got "${dimLabel && dimLabel.textContent.trim()}"`);

    // Verify F7 end-to-end through UI with 0.05mm
    const corner2 = drawCorner();
    app.tool('fillet');
    app.click(corner2.x, corner2.y);
    replaceText('0.05');
    app.enter();
    const tinyArc = st.shapes.find((s) => s.type === 'arc');
    assert.ok(tinyArc, 'F7 UI: arc created for 0.05');
    const tinyC = st.constraints.find((c) => c.isRadius);
    assert.ok(tinyC && Math.abs(tinyC.value - 0.05) < 1e-9, `F7 UI: expected 0.05 radius constraint, got ${tinyC && tinyC.value}`);

    // F23: applyFillet solve error surfaces instead of being swallowed
    {
      const S = L.newSketch();
      const c = L.point(S, 0, 0), a = L.point(S, 30, 0), b = L.point(S, 0, 30);
      const la = L.shape(S, L.line(S, c, a)), lb = L.shape(S, L.line(S, c, b));
      S.state.engine.solve = () => { throw new Error('solve-boom-666'); };
      assert.throws(() => applyFillet(S.state, findCornerBetweenLines(S.state, la, lb), 5), /solve-boom-666/, 'F23: applyFillet solve error must surface');
    }

    // F23: saveState error in commitFilletInput surfaces instead of being silently swallowed
    {
      const corner3 = drawCorner();
      app.tool('fillet');
      app.click(corner3.x, corner3.y);
      const origSave = st.saveState;
      st.saveState = () => { throw new Error('save-boom-666'); };
      let caught = null;
      const onErr = (ev) => { caught = ev.error; ev.preventDefault(); };
      win.addEventListener('error', onErr);
      try {
        // Trigger Enter keydown directly on the box to see if commitFilletInput propagates without silent catch
        try {
          boxEl().dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        } catch (err) {
          caught = err;
        }
      } finally {
        win.removeEventListener('error', onErr);
        st.saveState = origSave;
      }
      assert.ok(caught && /save-boom-666/.test(String(caught)), `F23: saveState failure must surface, got: ${caught}`);
    }
  } finally {
    await app.close();
  }
} finally {
  SettingsManager.set('DOC_UNIT', origUnit);
}

console.log('fillet-polish-666-node.test.js: ALL PASS');
