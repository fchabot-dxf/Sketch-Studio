// tests/symmetric-node.test.js — TASK 580 (node port of tests/symmetric-live-shaper.test.js + symmetric-live-sketchstudio.test.js = symmetric-live-runner.js,
// TASK 563), both hosts through tests/helpers/node-app.js. Draw a vertical sketch line S, two lines, two circles and two short lines; with the ribbon's
// Symmetric tool pick
//   line 1, line 2, then S            -> line 2 lies on the mirror of line 1's line; both keep their (different) lengths (task 572, like Fusion)
//   circle 1, circle 2, then S        -> centres mirror, radii equal
//   a point, a point, then the Y axis -> mirror across the axis; the axis lights up ONLY at the third pick
// then: 6 glyphs (two per constraint) on the canvas; Ctrl+Z removes the last one in ONE step and Ctrl+Y brings it back; SketchStudio: a right-click on a
// symmetric glyph offers "Delete constraint", which deletes it (the glyph is the right-click's target element, kit override 5). The cropped screenshot of
// the glyphs (evidence, no assert) is not taken. The axis assert reads the stored design (page-hide autosave of a named design).
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { glyphPoint } from './helpers/node-dom-read.js';

for (const HOST of ['shaper', 'sketchstudio']) {
  const profile = await createProfile();
  await createNamedDesign(profile, HOST); // TASK 558: only a NAMED design autosaves (the axis check reads the autosave)
  const app = await open({ host: HOST, profile });
  try {
    const click = (p) => app.click(p.x, p.y);
    const move = (p) => app.move(p.x, p.y);
    const litAxis = (axis) => app.svg.ownerDocument.querySelectorAll(`[data-ref-axis="${axis}"]`).length;
    const glyphs = () => [...app.svg.querySelectorAll('.constraint-glyph[data-ctype="symmetric"]')];
    const readDoc = () => { const s = app.state; return JSON.parse(JSON.stringify({ shapes: s.shapes, constraints: s.constraints.map(({ glyphPos, __pos, __visible, ...r }) => r), joints: [...s.joints.entries()] })); };
    const o = app.toScreen(0, 0);
    const at = (dx, dy) => ({ x: o.x + dx, y: o.y + dy });
    const along = (a, b, t) => ({ x: Math.round(a.x + (b.x - a.x) * t), y: Math.round(a.y + (b.y - a.y) * t) });
    const line = (a, b) => { app.tool('line'); click(a); click(b); app.esc(); };
    const circle = (c, r) => { app.tool('circle'); click(c); click({ x: c.x + r, y: c.y }); app.esc(); };

    // ---- the drawing (screen offsets from the origin, all >= 60 px from the axes so no axis snap)
    const S1 = at(330, -300), S2 = at(330, -40);                 // the symmetry line (vertical)
    const A1 = at(390, -270), A2 = at(500, -190);                 // line 1 (right of S)
    const B1 = at(180, -230), B2 = at(250, -150);                 // line 2 (left of S, not yet mirrored; shorter than line 1)
    const C1 = at(440, -95), C2 = at(190, -110);                  // circle centres
    const P1 = at(120, 120), P2 = at(200, 150), Q1 = at(-210, 190), Q2 = at(-130, 230);   // two short lines either side of the Y axis
    line(S1, S2); line(A1, A2); line(B1, B2);
    circle(C1, 30); circle(C2, 45);
    line(P1, P2); line(Q1, Q2);
    const d0 = readDoc();
    assert.strictEqual(d0.shapes.length, 7, 'drawn: 5 lines and 2 circles: ' + d0.shapes.map((s) => s.type).join(','));
    const nCons0 = d0.constraints.length;
    assert.ok(!!app.document.getElementById('tool-symmetric'), 'the ribbon has the Symmetric tool (#tool-symmetric)');

    // ---- 1. two lines about the sketch line S
    app.tool('symmetric');
    click(along(A1, A2, 0.5)); click(along(B1, B2, 0.5)); click(along(S1, S2, 0.4));
    let d = readDoc();
    const J = (doc) => Object.fromEntries(doc.joints.map((e) => Array.isArray(e) ? e : [e.id, e]));
    const symAll = (doc) => doc.constraints.filter((c) => c.type === 'symmetric');
    const mirror = (X, a, b) => { const ux = b.x - a.x, uy = b.y - a.y, k = ((X.x - a.x) * ux + (X.y - a.y) * uy) / (ux * ux + uy * uy); return { x: 2 * (a.x + k * ux) - X.x, y: 2 * (a.y + k * uy) - X.y }; };
    const near = (p, q, tol = 1e-3) => Math.hypot(p.x - q.x, p.y - q.y) <= tol;
    let sym = symAll(d);
    assert.strictEqual(sym.length, 1, 'lines: one symmetric stored: ' + JSON.stringify(d.constraints.slice(nCons0)));
    const lineSym = sym[0];
    const Sline = d.shapes.find((s) => s.id === lineSym.line);
    assert.ok(lineSym.shapes && lineSym.shapes.length === 2 && !lineSym.joints && Sline && Sline.type === 'line', 'lines form { shapes, line: the sketch line } (no end pairs)');
    let jm = J(d), sa = jm[Sline.joints[0]], sb = jm[Sline.joints[1]];
    const lenOf = (doc, id) => { const s = doc.shapes.find((x) => x.id === id), m = J(doc); return Math.hypot(m[s.joints[1]].x - m[s.joints[0]].x, m[s.joints[1]].y - m[s.joints[0]].y); };
    const [l1, l2] = lineSym.shapes.map((id) => d.shapes.find((s) => s.id === id));
    // direction AND position: both ends of line 2 lie on the mirror of line 1's infinite line
    const M1 = mirror(jm[l1.joints[0]], sa, sb), M2 = mirror(jm[l1.joints[1]], sa, sb);
    const offMirror = (q) => Math.abs(((q.x - M1.x) * (M2.y - M1.y) - (q.y - M1.y) * (M2.x - M1.x)) / Math.hypot(M2.x - M1.x, M2.y - M1.y));
    assert.ok(l2.joints.every((q) => offMirror(jm[q]) < 1e-3), `lines: line 2 on the mirror of line 1 (${l2.joints.map((q) => offMirror(jm[q]).toExponential(1))})`);
    const [len1a, len2a] = [lenOf(d0, l1.id), lenOf(d0, l2.id)], [len1b, len2b] = [lenOf(d, l1.id), lenOf(d, l2.id)];
    assert.ok(Math.abs(len1a - len1b) < 1e-6 && Math.abs(len2a - len2b) < 1e-6 && Math.abs(len1b - len2b) > 0.05 * len1b,
      `lines: each keeps its own length, and they differ (${len1a.toFixed(3)} -> ${len1b.toFixed(3)}, ${len2a.toFixed(3)} -> ${len2b.toFixed(3)})`);

    // ---- 2. two circles about S
    click({ x: C1.x + 30, y: C1.y }); click({ x: C2.x - 45, y: C2.y }); click(along(S1, S2, 0.6));
    d = readDoc(); sym = symAll(d);
    const circSym = sym.find((c) => c.shapes && c.shapes.every((id) => (d.shapes.find((x) => x.id === id) || {}).type === 'circle'));
    assert.ok(circSym, 'circles: a symmetric of two circles stored: ' + JSON.stringify(sym));
    jm = J(d); sa = jm[Sline.joints[0]]; sb = jm[Sline.joints[1]];
    const [k1, k2] = circSym.shapes.map((id) => d.shapes.find((s) => s.id === id));
    assert.ok(near(jm[k2.joints[0]], mirror(jm[k1.joints[0]], sa, sb)) && Math.abs(k1.radius - k2.radius) < 1e-3, `circles: centres mirrored, radii equal (${k1.radius}, ${k2.radius})`);

    // ---- 3. two points about the Y axis: the axis is pickable only at the third pick
    move(at(0, 60));
    assert.strictEqual(litAxis('ref_axis_y'), 0, 'pick 1: the Y axis is not lit under the pointer');
    click(P1);
    move(at(0, 60));
    assert.strictEqual(litAxis('ref_axis_y'), 0, 'pick 2: the Y axis is still not lit');
    click(Q1);
    move({ x: at(0, 60).x + 3, y: at(0, 60).y });
    assert.strictEqual(litAxis('ref_axis_y'), 1, 'pick 3: the Y axis lights up under the pointer');
    click(at(3, 60));
    d = readDoc(); sym = symAll(d);
    const ptSym = sym.find((c) => c.line === 'ref_axis_y');
    assert.ok(ptSym && ptSym.joints.length === 2 && !ptSym.shapes, 'points about the Y axis stored: ' + JSON.stringify(sym));
    jm = J(d);
    const [pa, pb] = ptSym.joints.map((id) => jm[id]);
    assert.ok(Math.abs(pa.x + pb.x) < 1e-3 && Math.abs(pa.y - pb.y) < 1e-3, `points: mirrored across the Y axis (${JSON.stringify(pa)} ${JSON.stringify(pb)})`);
    const stored = await app.storedDoc();
    assert.ok(!stored.geometry.shapes.some((s) => s.reference) && !JSON.stringify(stored.geometry.joints).includes('j_ref'), 'no axis in the saved shapes / joints');

    // ---- glyphs: two per constraint
    app.esc(); app.tool('select'); move(at(620, -330));
    assert.strictEqual(glyphs().length, 6, 'six symmetric glyphs (two per constraint) on the canvas');

    // ---- undo / redo: the last symmetric goes in ONE step and comes back
    click(at(620, -330));   // focus on an empty spot of the canvas
    app.undo();
    d = readDoc();
    assert.strictEqual(symAll(d).length, 2, 'Ctrl+Z: the last symmetric is gone (one undo step), the two others stay');
    assert.ok(!symAll(d).some((c) => c.line === 'ref_axis_y'), 'Ctrl+Z removed the points-about-the-axis one');
    app.redo();
    d = readDoc();
    assert.strictEqual(symAll(d).length, 3, 'Ctrl+Y: it is back');

    // ---- SketchStudio: right-click a symmetric glyph -> "Delete constraint"
    if (HOST === 'sketchstudio') {
      // the glyph of the LEFT point (Q1): it sits left of Q1, clear of any geometry (since task 571 the glyph wins a right-click over any geometry under it)
      const gs = glyphs().filter((e) => e.getAttribute('data-cline') === 'ref_axis_y').map((e) => ({ e, p: glyphPoint(app, e) })).sort((a, b) => a.p.x - b.p.x);
      assert.strictEqual(gs.length, 2, 'the two glyphs of the points-about-the-axis constraint');
      const g = gs[0];
      app.rightClick(g.p.x, g.p.y, { target: () => glyphs().filter((e) => e.getAttribute('data-cline') === 'ref_axis_y').sort((a, b) => glyphPoint(app, a).x - glyphPoint(app, b).x)[0] });
      const items = [...app.document.querySelectorAll('.sk-context-menu .sk-context-item')].map((e) => e.dataset.id);
      assert.deepStrictEqual(items, ['con-delete'], 'the symmetric glyph menu: Delete constraint');
      app.document.querySelector('.sk-context-menu [data-id="con-delete"]').click(); app.frames();
      d = readDoc();
      assert.ok(symAll(d).length === 2 && !symAll(d).some((c) => c.line === 'ref_axis_y') && d.shapes.length === 7, 'Delete constraint removed that symmetric only');
    }
    console.log(`symmetric-node ${HOST}: ok`);
  } finally { await app.close(); }
}
