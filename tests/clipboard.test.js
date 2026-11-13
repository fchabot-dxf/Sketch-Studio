// tests/clipboard.test.js -- TASK 559: Ctrl+C / Ctrl+X / Ctrl+V of sketch geometry (packages/ui/clipboard.js). Unit level on the real engine + the real undo:
// what is copied (shapes + their own joints, every constraint / dimension whose operands are ALL inside), what is not (a link to outside geometry or
// to the origin), new ids and new dN names, formulas (same document / another document with and without the parameter), where the copy lands (offset,
// each repeated paste one more step), ONE undo step, cut, the in-memory fallback, text that is not ours, and the key mapping.
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { makeBezier } from '#core/shapes.js';
import { serializeDocument } from '#core/document.js';
import { createClipboard, clipboardKeyAction, isTextEditingTarget, parseClipboardText, selectionToEnvelope, CLIPBOARD_FORMAT, CLIPBOARD_VERSION, PASTE_STEP_MM } from '#ui/clipboard.js';

const muted = async (f) => { const l = console.log, e = console.error, w = console.warn; console.log = () => {}; console.error = () => {}; console.warn = () => {}; try { return await f(); } finally { console.log = l; console.error = e; console.warn = w; } };
// an in-memory "system clipboard": what io.writeText stores io.readText returns
const fakeIo = () => { const io = { text: '', writes: 0, writeText: async (t) => { io.text = t; io.writes++; }, readText: async () => io.text }; return io; };
// the document as JSON; undo / redo legitimately re-stamp presentation noise (glyphPos, key order, the origin's sketchId): normalised away
const sortKeys = (o) => (Array.isArray(o) ? o.map(sortKeys) : o && typeof o === 'object' ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeys(o[k])])) : o);
const doc = (S) => JSON.stringify(sortKeys(JSON.parse(JSON.stringify(serializeDocument(S.state), (k, v) => (k === 'glyphPos' || k === '__pos' ? undefined : v)), (k, v) => (k === 'sketchId' ? undefined : v))));
const select = (S, shapes, joints = []) => { const st = S.state; st.selectedShapes.clear(); st.selectedJoints.clear(); st.selectedConstraints.clear(); shapes.forEach((s) => st.selectedShapes.add(s)); joints.forEach((j) => st.selectedJoints.add(j)); };
const dims = (S) => S.state.constraints.filter((c) => c.type === 'distance' || c.type === 'angle');
const shapeJoints = (S, id) => S.state.shapes.find((s) => s.id === id).joints;
const clip = (S, io, notes = []) => createClipboard({ state: S.state, io, notify: (m, t) => notes.push([t, m]) });
function rectWithDims(S, x1 = 0, y1 = 0, x2 = 100, y2 = 50) {
  const r = L.rect(S, x1, y1, x2, y2);
  const [a, b] = shapeJoints(S, r.top), [, d] = shapeJoints(S, r.right);
  ConstraintManager.createConstraint(S.state, 'distance', { joints: [a, b], value: Math.abs(x2 - x1), dimMode: 'horizontal' }, { source: 'test' });
  ConstraintManager.createConstraint(S.state, 'distance', { joints: [b, d], value: Math.abs(y2 - y1), dimMode: 'vertical' }, { source: 'test' });
  S.engine.solve(500);
  return r;
}
const pos = (S, id) => { const j = S.state.joints.get(id); return [j.x, j.y]; };

// ---- the keys + the focus rule
assert.deepStrictEqual(['c', 'C', 'x', 'v', 'V', 'z'].map((k) => clipboardKeyAction({ key: k, ctrlKey: true })), ['copy', 'copy', 'cut', 'paste', 'paste', null]);
assert.strictEqual(clipboardKeyAction({ key: 'v', metaKey: true }), 'paste', 'Cmd+V');
assert.strictEqual(clipboardKeyAction({ key: 'v' }), null, 'a bare V is the Pan tool, not a paste');
assert.strictEqual(clipboardKeyAction({ key: 'c', ctrlKey: true, shiftKey: true }), null, 'Ctrl+Shift+C stays Combine');
for (const t of [{ tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'SELECT' }, { tagName: 'DIV', isContentEditable: true }, { tagName: 'DIV', id: 'dimInput' }]) assert.ok(isTextEditingTarget(t), 'a text control keeps its own copy / paste: ' + JSON.stringify(t));
assert.ok(!isTextEditingTarget({ tagName: 'svg' }) && !isTextEditingTarget(null), 'the canvas is not a text control');

// ---- 1. a rectangle with H/V + two dimensions: everything copied, new ids, new dN, solved, offset, ONE undo step, selected
await muted(async () => {
  const S = L.newSketch();
  const r = rectWithDims(S);
  const before = { shapes: S.state.shapes.length, joints: S.state.joints.size, constraints: S.state.constraints.length, names: dims(S).map((c) => c.name) };
  assert.deepStrictEqual(before.names, ['d1', 'd2'], 'the originals are d1, d2');
  const io = fakeIo();
  const cb = clip(S, io);
  select(S, r.lines);
  const env = await cb.copy();
  assert.ok(env, 'something was copied');
  const payload = JSON.parse(io.text);
  assert.strictEqual(payload.format, CLIPBOARD_FORMAT); assert.strictEqual(payload.version, CLIPBOARD_VERSION);
  assert.strictEqual(payload.document.geometry.shapes.length, 4);
  assert.strictEqual(payload.document.geometry.constraints.length, before.constraints, 'every constraint of the rectangle is inside the copy');
  const h0 = S.state.history.length, origDoc = doc(S);
  const oldShapeIds = new Set(S.state.shapes.map((s) => s.id)), oldJointIds = new Set(S.state.joints.keys());
  const res = await cb.paste();
  assert.ok(res && res.ok);
  assert.strictEqual(S.state.shapes.length, before.shapes * 2, '4 more shapes');
  assert.strictEqual(S.state.constraints.length, before.constraints * 2, 'every internal constraint and both dimensions were pasted');
  assert.strictEqual(S.state.joints.size, before.joints + (before.joints - 1), 'every joint but the origin was copied');
  for (const id of res.shapes) assert.ok(!oldShapeIds.has(id), 'new shape id ' + id);
  const newJoints = [...S.state.joints.keys()].filter((j) => !oldJointIds.has(j));
  assert.strictEqual(newJoints.length, before.joints - 1, 'new joint ids');
  assert.deepStrictEqual(dims(S).map((c) => c.name), ['d1', 'd2', 'd3', 'd4'], 'the pasted dimensions are d3, d4');
  assert.deepStrictEqual(dims(S).slice(2).map((c) => c.value), [100, 50], 'dimensions keep their values');
  // the same shape, offset by PASTE_STEP_MM right and down on screen (+x, +y in world: user Y points up)
  r.lines.forEach((id, i) => { const o = shapeJoints(S, id), c = shapeJoints(S, res.shapes[i]); o.forEach((j, k) => { const [ox, oy] = pos(S, j), [cx, cy] = pos(S, c[k]); assert.ok(Math.abs(cx - ox - PASTE_STEP_MM) < 1e-4 && Math.abs(cy - oy - PASTE_STEP_MM) < 1e-4, `offset of ${id}`); }); });
  assert.ok(S.engine.solve(500).converged, 'the pasted sketch is solved');
  assert.strictEqual(L.residuals(S).max < 1e-6, true, 'every pasted constraint holds');
  assert.deepStrictEqual([...S.state.selectedShapes].sort(), [...res.shapes].sort(), 'the pasted shapes are selected');
  assert.strictEqual(S.state.history.length, h0 + 1, 'ONE undo step');
  assert.strictEqual(S.state.history[h0].label, 'paste');
  const pasted = doc(S);
  S.state.undo();
  assert.strictEqual(doc(S), origDoc, 'one Ctrl+Z restores the document exactly');
  S.state.redo();
  assert.strictEqual(doc(S), pasted, 'Ctrl+Y brings the paste back exactly');
});

// ---- 2. a link to outside geometry is not copied: one line of a chain keeps its own joints, not the coincident to the next line
await muted(async () => {
  const S = L.newSketch();
  const segs = L.polyline(S, [[0, 0], [100, 0], [100, 80]], false); // 2 lines joined by a coincident
  const coincident = () => S.state.constraints.filter((c) => c.type === 'coincident').length;
  assert.strictEqual(coincident(), 1);
  const cb = clip(S, fakeIo());
  select(S, [segs[0].id]);
  const env = await cb.copy();
  assert.strictEqual(env.document.geometry.constraints.length, 0, 'the coincident to the OTHER line is outside the copy');
  await cb.paste();
  assert.strictEqual(coincident(), 1, 'no coincident was copied');
  assert.strictEqual(S.state.shapes.length, 3, 'one line pasted');
  // both lines selected: the coincident is internal and travels
  select(S, segs.map((s) => s.id));
  const cb2 = clip(S, fakeIo());
  await cb2.copy(); await cb2.paste();
  assert.strictEqual(coincident(), 2, 'a coincident between two copied lines is copied');
});

// ---- 3. the origin: a point coincident with the origin comes out free; a shape that uses the origin joint gets an ordinary free copy
await muted(async () => {
  const S = L.newSketch();
  // (a) the line's start is its OWN joint made coincident with the origin
  const a = L.point(S, 0, 0), b = L.point(S, 60, 0);
  const ln = L.line(S, a, b);
  ConstraintManager.createConstraint(S.state, 'coincident', { joints: [a, L.origin] }, { source: 'test' });
  S.engine.solve(500);
  const cb = clip(S, fakeIo());
  select(S, [ln]);
  const env = await cb.copy();
  assert.strictEqual(env.document.geometry.constraints.length, 0, 'the link to the origin is not copied');
  const res = await cb.paste();
  const copy = shapeJoints(S, res.shapes[0]);
  assert.deepStrictEqual(pos(S, copy[0]), [PASTE_STEP_MM, PASTE_STEP_MM], 'the copy keeps its position relative to the rest, offset, and is unattached');
  assert.ok(!S.state.constraints.some((c) => (c.joints || []).includes(copy[0])), 'nothing attaches the copied point to the origin');
  assert.strictEqual(S.state.joints.get('j_origin').fixed, true, 'the origin itself is untouched');
  // (b) a line that uses the origin joint directly: its copy of the origin joint is an ordinary FREE point, not a second fixed origin
  const S2 = L.newSketch();
  const p = L.point(S2, 40, 0);
  const ln2 = L.line(S2, L.origin, p);
  ConstraintManager.createConstraint(S2.state, 'distance', { joints: [L.origin, p], value: 40 }, { source: 'test' });
  const cb2 = clip(S2, fakeIo());
  select(S2, [ln2]);
  const r2 = await cb2.paste(); // nothing copied yet in this clipboard: nothing happens
  assert.strictEqual(r2, null, 'paste with an empty clipboard does nothing');
  await cb2.copy();
  const res2 = await cb2.paste();
  const j0 = shapeJoints(S2, res2.shapes[0])[0];
  assert.notStrictEqual(j0, 'j_origin');
  assert.strictEqual(S2.state.joints.get(j0).fixed, false, 'the copy of the origin point is NOT fixed');
  assert.strictEqual(dims(S2).length, 2, 'the length dimension of the copied line travels with it');
});

// ---- 4. formulas: a user parameter in the same document / another document with it (other value) / another document without it; a copied dimension renamed
const withParam = async (S, value) => { S.state.parameters.push({ name: 'width', unit: 'mm', expression: value }); };
await muted(async () => {
  const S = L.newSketch();
  const r = rectWithDims(S);
  await withParam(S, '100 mm');
  const d1 = dims(S)[0], d2 = dims(S)[1];
  d1.expression = 'width';
  d2.expression = 'd1 / 2'; // reads the OTHER copied dimension
  const io = fakeIo(), cb = clip(S, io);
  select(S, r.lines);
  await cb.copy(); const same = await cb.paste();
  const [n1, n2] = dims(S).slice(2);
  assert.strictEqual(n1.expression, 'width', 'same document: the pasted dimension still reads the user parameter');
  assert.strictEqual(n2.expression, `${n1.name} / 2`, 'a formula reading a copied dimension reads its COPY: ' + n2.expression);
  assert.deepStrictEqual(same.frozen, [], 'nothing frozen in the same document');
  // another document that LACKS the parameter: frozen to the number
  const T = L.newSketch();
  const cbT = clip(T, io);
  const resT = await cbT.paste();
  assert.ok(resT && resT.ok);
  assert.strictEqual(dims(T)[0].expression, undefined, 'another document without the parameter: the formula is frozen to its number');
  assert.strictEqual(dims(T)[1].expression, `${dims(T)[0].name} / 2`, 'a formula between two copied dimensions survives (it reads the copy)');
  assert.deepStrictEqual(dims(T).map((c) => c.value), [100, 50]);
  assert.deepStrictEqual(resT.frozen, [dims(T)[0].name], 'only the one that read the missing parameter was frozen');
  // another document that HAS a parameter of that name (other value): the formula stays and the pasted rectangle takes ITS value
  const U = L.newSketch();
  await withParam(U, '80 mm');
  const resU = await clip(U, io).paste();
  assert.ok(resU.ok);
  assert.strictEqual(dims(U)[0].expression, 'width', 'the target has the parameter: the formula is kept');
  assert.strictEqual(Math.round(dims(U)[0].value * 1e6) / 1e6, 80, 'and evaluates in the target document');
  assert.ok(U.engine.solve(500).converged && L.residuals(U).max < 1e-6, 'the resized pasted sketch is solved');
});

// ---- 5. cut = copy + the Delete key's single step; undo brings everything back; the clipboard still pastes
await muted(async () => {
  const S = L.newSketch();
  const r = rectWithDims(S);
  const io = fakeIo(), cb = clip(S, io);
  const orig = doc(S);
  const h0 = S.state.history.length;
  select(S, r.lines);
  assert.ok(await cb.cut());
  assert.strictEqual(S.state.shapes.length, 0, 'cut removed the shapes');
  assert.strictEqual(dims(S).length, 0, 'and their dimensions');
  assert.strictEqual(S.state.history.length, h0 + 1, 'cut is ONE undo step');
  S.state.undo();
  assert.strictEqual(doc(S), orig, 'undo of the cut restores the document exactly');
  S.state.redo();
  assert.strictEqual(S.state.shapes.length, 0);
  const res = await cb.paste();
  assert.strictEqual(res.shapes.length, 4, 'the cut geometry pastes back');
  assert.deepStrictEqual(dims(S).map((c) => c.value), [100, 50]);
  // a selection that includes an OUTSIDE selected dimension / a joint of an unselected line: cut deletes only what it copied
  const S2 = L.newSketch();
  const segs = L.polyline(S2, [[0, 0], [100, 0], [100, 80]], false);
  S2.state.selectedShapes.clear(); S2.state.selectedJoints.clear();
  S2.state.selectedShapes.add(segs[0].id); S2.state.selectedJoints.add(segs[1].a);
  const cb2 = clip(S2, fakeIo());
  await cb2.cut();
  assert.deepStrictEqual(S2.state.shapes.map((s) => s.id), [segs[1].id], 'the unselected line (only one of its points was selected) survives the cut');
});

// ---- 6. repeated paste: each paste of the same clipboard is one more step; a new copy starts again at one step
await muted(async () => {
  const S = L.newSketch();
  const r = rectWithDims(S);
  const cb = clip(S, fakeIo());
  select(S, r.lines);
  const o = pos(S, shapeJoints(S, r.top)[0]);
  await cb.copy();
  const p1 = await cb.paste(), p2 = await cb.paste(), p3 = await cb.paste();
  const at = (res) => { const q = pos(S, shapeJoints(S, res.shapes[0])[0]); return [q[0] - o[0], q[1] - o[1]]; };
  assert.deepStrictEqual([at(p1), at(p2), at(p3)].map((v) => v.map((x) => Math.round(x * 1e4) / 1e4)), [[10, 10], [20, 20], [30, 30]], 'paste n is n steps from the original');
  assert.strictEqual(dims(S).length, 8, 'three pastes, each with its two dimensions');
  assert.strictEqual(new Set(dims(S).map((c) => c.name)).size, 8, 'every dimension name is unique');
  assert.deepStrictEqual([...S.state.selectedShapes].sort(), [...p3.shapes].sort(), 'the last paste is the selection');
  select(S, r.lines); await cb.copy();
  assert.deepStrictEqual(at(await cb.paste()).map((x) => Math.round(x)), [10, 10], 'a fresh copy starts at one step again');
});

// ---- 7. circle + bezier: radius dimension, absolute control points follow, a closed-shape key is not shared with the original
await muted(async () => {
  const S = L.newSketch();
  const c = L.circle(S, 30, 30, 12);
  ConstraintManager.createConstraint(S.state, 'distance', { shape: c.id, isRadius: true, value: 12 }, { source: 'test' });
  const p0 = L.point(S, 0, 0), p3 = L.point(S, 50, 0);
  const bez = makeBezier(S.state.joints, p0, p3, [10, 20], [40, 20]);
  S.state.shapes.push(...bez.shapes);
  S.engine.solve(500);
  const cb = clip(S, fakeIo());
  select(S, [c.id, bez.shapes[0].id]);
  await cb.copy();
  const res = await cb.paste();
  const nb = S.state.shapes.find((s) => s.id === res.shapes[1]);
  assert.deepStrictEqual([nb.c1, nb.c2], [[20, 30], [50, 30]], 'a bezier control point moves with the copy');
  assert.notStrictEqual(nb.groupId, bez.shapes[0].groupId, 'the copy is its own closed shape');
  const nc = S.state.shapes.find((s) => s.id === res.shapes[0]);
  assert.strictEqual(nc.radius, 12);
  assert.strictEqual(dims(S).length, 2, 'the radius dimension was copied');
  assert.ok(dims(S)[1].isRadius && dims(S)[1].shape === nc.id);
});

// ---- 8. the clipboard: text that is not ours does nothing; a refused clipboard falls back to memory and says so once; a newer payload says so
await muted(async () => {
  const S = L.newSketch();
  const r = rectWithDims(S);
  const notes = [];
  for (const text of ['hello world', '', '{"a":1}', `{"format":"${CLIPBOARD_FORMAT}"`, JSON.stringify({ format: 'other', version: 1 }), 'a ' + CLIPBOARD_FORMAT + ' mention']) {
    const io = fakeIo(); io.text = text;
    const before = doc(S), h = S.state.history.length;
    assert.strictEqual(await clip(S, io, notes).paste(), null, 'foreign text: ' + JSON.stringify(text));
    assert.strictEqual(doc(S), before); assert.strictEqual(S.state.history.length, h);
  }
  assert.deepStrictEqual(notes, [], 'foreign text is ignored without a message');
  const newer = fakeIo(); newer.text = JSON.stringify({ format: CLIPBOARD_FORMAT, version: CLIPBOARD_VERSION + 1, document: {} });
  assert.strictEqual(await clip(S, newer, notes).paste(), null);
  assert.strictEqual(notes.length, 1, 'a payload from a newer version is reported');
  assert.strictEqual(parseClipboardText(JSON.stringify({ format: CLIPBOARD_FORMAT, version: 1, document: { version: 99, geometry: {} } })).reason, 'newer', 'and so is a newer document inside it');
  // write denied: memory fallback, told once
  const denied = { writeText: async () => { throw new Error('denied'); }, readText: async () => 'something else' };
  const n2 = [];
  const cb = clip(S, denied, n2);
  select(S, r.lines);
  await cb.copy(); await cb.copy();
  assert.strictEqual(n2.length, 1, 'the refusal is shown once');
  assert.match(n2[0][1], /refused clipboard access/);
  assert.ok((await cb.paste()).ok, 'paste works from the in-memory copy');
  // no clipboard API at all
  const n3 = [];
  const cb3 = createClipboard({ state: S.state, io: null, notify: (m, t) => n3.push([t, m]) });
  select(S, r.lines); await cb3.copy();
  assert.ok((await cb3.paste()).ok && n3.length === 1, 'no clipboard API: memory fallback with a note');
  // read denied, write fine: pastes the in-memory copy
  const ro = { text: '', writeText: async (t) => { ro.text = t; }, readText: async () => { throw new Error('read denied'); } };
  const cb4 = clip(S, ro, []); select(S, r.lines); await cb4.copy();
  assert.ok((await cb4.paste()).ok, 'read refused: the last copy of this page is used');
});

// ---- 9. nothing selected: nothing copied (and the clipboard text is left alone); only a selected origin: nothing
await muted(async () => {
  const S = L.newSketch();
  const io = fakeIo(); io.text = 'keep me';
  const cb = clip(S, io);
  assert.strictEqual(await cb.copy(), null); assert.strictEqual(io.text, 'keep me'); assert.strictEqual(io.writes, 0);
  select(S, [], ['j_origin']);
  assert.strictEqual(selectionToEnvelope(S.state), null, 'the origin point alone is not copyable');
  assert.strictEqual(await cb.cut(), false);
  // a selected free point (no shape uses it) is copied
  const free = L.point(S, 5, 5);
  select(S, [], [free]);
  const cb5 = clip(S, io);
  await cb5.copy();
  const res = await cb5.paste();
  assert.strictEqual(res.joints.length, 1, 'a free point can be copied');
  assert.strictEqual(res.shapes.length, 0);
});

console.log('clipboard: copy / cut / paste of geometry, formulas, undo, fallback, keys OK');
