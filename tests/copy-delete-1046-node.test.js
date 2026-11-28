// tests/copy-delete-1046-node.test.js — TASK 1046: deleting part of a PATTERN or an OFFSET copy behaves like Fusion (owner-approved 2026-11-27,
// Fusion measured in the delete audit 1042, docs/DELETE-AUDIT-1042.md), and the offset RELATION has its own glyph (owner "offset should be visible";
// Fusion's Offset constraint glyph, measured in task 1048). On the REAL Design tab in Node (tests/helpers/node-app.js: the page's own pointer / key
// listeners, the ribbon tools, the right-click menu, the footer, the undo history, autosave to the project store):
//   D-38 an offset COPY curve + Delete: that curve only; the offset relation STAYS and the other copies keep following its distance.
//   D-39 an offset SOURCE curve + Delete: that curve only (+ its own H / coincidents); the offset relation STAYS (the copy of that side stays plain).
//   D-43 a pattern COPY curve + Delete: that curve only; the pattern STAYS (its instance keeps the other copies); a later quantity edit keeps it deleted.
//   D-44 a pattern SOURCE curve + Delete: that curve + the pattern; the copies stay (unchanged: SAME before).
//   D-63 the pattern label + Delete: the pattern goes, the copies stay (unchanged).
//   D-65 the offset dimension LABEL + Delete: task 667's free distance (kept, owner ruling); the offset RELATION glyph + Delete (key, right-click menu,
//        footer red X, phone touch-and-hold): the relation goes, the copies stay as plain geometry. Both glyphs (source + copy) are one entity.
// Each delete: one undo step that restores the exact document, redo, the stored design reopened equals it, the solver converges.
import assert from 'node:assert';
import { open, createProfile, createNamedDesign, loadGlyphSheetFromDisk } from './helpers/node-app.js';
import SettingsManager from '#core/settings-manager.js';
import { measureResidual } from '#core/constraint-verifier.js';
import { editPattern, isPatternConstraint } from '#core/pattern.js';
import { OFFSET_RELATION, offsetRelations } from '#core/offset.js';
import { glyphAt } from '#ui/hover-manager.js';
import { commitDimensionEdit } from '#core/dimension-seams.js';
import { LONG_PRESS_MS } from '#ui/long-press.js';

SettingsManager.set('GRID_MAGNETISM', 0.001, { persist: 'none' }); // no grid magnet: the clicks land where they are aimed
await loadGlyphSheetFromDisk(); // the glyph pick (hover-manager glyphAt) reads the drawn icon's outlines

let app = null, profile = null;
const W = (x, y) => app.toScreen(x, y);
const click = (x, y, o) => { const p = W(x, y); app.click(p.x, p.y, o); };
const esc2 = () => { app.esc(); app.esc(); };
const rect2 = (a, b) => { app.tool('rect'); app.state.rectMode = 'rect-2pt'; click(...a); click(...b); esc2(); app.tool('select'); };
function offset(curvePt, sidePt, d) {
  app.tool('offset'); click(...curvePt); click(...sidePt);
  const box = app.document.getElementById('offset-distance-input');
  box.focus(); box.select(); app.type(String(d)); app.enter(); esc2(); app.tool('select');
}
function rectPattern(objPts, qty, extent) {
  app.tool('select'); esc2();
  objPts.forEach((p, i) => click(p[0], p[1], { shift: i > 0 }));
  app.tool('rectangularPattern');
  const up = app.document.querySelector('.sk-pattern-dialog [data-spin-for="Quantity 1"][data-spin="up"]');
  for (let i = 2; i < qty; i++) { up.click(); app.frames(); }
  const d = app.document.querySelector('.sk-pattern-dialog [data-field="Distance 1"]');
  d.focus(); d.select(); app.type(String(extent)); d.blur(); app.frames();
  app.enter(); esc2(); app.tool('select');
}
async function openBlank() {
  if (app) await app.close();
  profile = await createProfile();
  await createNamedDesign(profile, 'sketchstudio', 'Copy delete 1046'); // a named design autosaves: the reopen reads it back
  app = await open({ host: 'sketchstudio', profile });
  setView(200);
  app.tool('select');
}
function setView(w) {
  const st = app.state, r = app.svg.getBoundingClientRect();
  Object.assign(st.view, { x: 0, y: 0, w }); st.view.h = w / (r.width / r.height);
  app.svg.setAttribute('viewBox', `${-w / 2} ${-st.view.h / 2} ${w} ${st.view.h}`); app.frames(2);
}
async function reopen() { // the stored design in a new page (a reload)
  const w = app.state.view.w;
  await app.storedDoc(); await app.close();
  app = await open({ host: 'sketchstudio', profile });
  setView(w); app.tool('select');
}

// the document, by content (render caches and __ fields dropped; numbers to 1e-6)
const DROP = new Set(['glyphPos', 'labelPos']);
const docOf = () => JSON.parse(JSON.stringify({
  shapes: app.state.shapes.filter((s) => !String(s.id).startsWith('ref_')),
  joints: [...app.state.joints].map(([id, j]) => [id, { x: j.x, y: j.y, fixed: !!j.fixed }]).sort((a, b) => (a[0] < b[0] ? -1 : 1)),
  constraints: app.state.constraints.filter((c) => c && c.type !== 'mouse_spring'),
  parameters: app.state.parameters || [],
}, (k, v) => (DROP.has(k) || k.startsWith('__') || k === 'isDriven' ? undefined : typeof v === 'number' ? +v.toFixed(6) : v)));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const lines = () => app.state.shapes.filter((s) => s.type === 'line' && !String(s.id).startsWith('ref_') && !s.isConstruction);
const offsetRec = () => app.state.constraints.find((c) => c.type === 'offset') || null;
const patternRec = () => app.state.constraints.find(isPatternConstraint) || null;
const P = (id) => { const j = app.state.joints.get(id); return { x: j.x, y: j.y }; };
const lineAt = (x, y) => lines().find((s) => { const a = P(s.joints[0]), b = P(s.joints[1]); return Math.abs(a.x + b.x - 2 * x) < 0.2 && Math.abs(a.y + b.y - 2 * y) < 0.2; });
// every stored constraint and dimension satisfied (the verifier's own formula), and no constraint naming a missing shape / point
function solverOk(label) {
  const st = app.state, ids = new Set(st.shapes.map((s) => s.id));
  for (const c of st.constraints) {
    if (!c || c.type === 'mouse_spring' || c.isDriven || c.driven) continue;
    const r = measureResidual(c, st.joints, st.shapes);
    assert(!(r > 1e-6), `${label}: ${c.type} is satisfied (residual ${r})`);
    for (const id of (c.type === 'offset' ? c.shapes : [])) assert(id == null || ids.has(id), `${label}: the offset names no missing shape (${id})`);
    if (isPatternConstraint(c)) for (const i of c.instances) for (const id of i.shapes) assert(id == null || ids.has(id), `${label}: the pattern names no missing copy (${id})`);
  }
}
// the delete, then: one undo step back to the exact document, redo, and the stored design reopened equals the deleted state
async function undoRedoReload(label, before) {
  const after = docOf();
  app.key('z', { ctrl: true });
  assert(same(docOf(), before), `${label}: one Ctrl+Z restores the exact document`);
  app.key('y', { ctrl: true });
  assert(same(docOf(), after), `${label}: Ctrl+Y redoes it`);
  await reopen();
  assert(same(docOf(), after), `${label}: the stored design reopened equals the deleted state`);
}

// THE scenes, drawn with the real tools (the audit's): a 40 x 30 rectangle offset 5 OUTSIDE; a 20 x 20 square in a rectangular pattern of 3
const offsetScene = () => { rect2([-20, -10], [20, 20]); offset([0, -10], [0, -20], 5); };
const patScene = () => { rect2([-90, -10], [-70, 10]); rectPattern([[-80, -10], [-90, 0], [-80, 10], [-70, 0]], 3, 60); };

// the first screen pixel, round each place the renderer drew a glyph of entity g, that the app's own glyphAt gives g for
function glyphInk(g, which = 0) {
  const spots = (Array.isArray(g.glyphPos) ? g.glyphPos : [g.glyphPos]).map((p) => W(p.x, p.y));
  const p = spots[which];
  for (let r = 0; r <= 14; r++) for (let a = 0; a < 16; a++) {
    const x = Math.round(p.x + r * Math.cos(a * Math.PI / 8)), y = Math.round(p.y + r * Math.sin(a * Math.PI / 8));
    if (glyphAt(app.svg, app.state, x, y) === g) return { x, y };
    if (r === 0) break;
  }
  return null;
}
// a click on a constraint's canvas label (a DOM pick: the label element is the target, at its drawn place)
function clickLabel(c) {
  const label = () => app.svg.querySelector(`.dim-label[data-constraint-idx="${app.state.constraints.indexOf(c)}"]`);
  assert(label(), `the ${c.type} label is drawn`);
  const g = Array.isArray(c.glyphPos) ? c.glyphPos[0] : c.glyphPos, p = W(g.x, g.y);
  app.click(p.x, p.y, { target: label });
  assert(app.state.selectedConstraints.has(c), `a click on the ${c.type} label selects it`);
}
const relation = () => offsetRelations(app.state.constraints)[0] || null;

let selDbg = "";
const failures = [];
async function section(name, fn) {
  try { await fn(); console.log('ok   ' + name); } catch (e) { failures.push(name); console.log('FAIL ' + name + ': ' + e.message); }
}

await section('D-38 an offset COPY curve: that curve only, the offset stays and the other copies keep following', async () => {
  await openBlank(); offsetScene();
  const o = offsetRec(); assert(o && o.shapes.length === 8, 'the scene: one offset of 4 pieces');
  const copy = lineAt(0, -15); assert(copy && o.shapes.includes(copy.id), 'the copy bottom line');
  const corners = [...new Set(lines().filter((s) => o.shapes.indexOf(s.id) % 2 === 1).flatMap((s) => s.joints))].map((id) => [id, P(id)]);
  const before = docOf();
  click(0, -15); app.key('Delete');
  assert(!app.state.shapes.some((s) => s.id === copy.id) && lines().length === 7, `the copy line only goes (${lines().length} lines)`);
  const o2 = offsetRec();
  assert(o2 && o2.shapes.filter((id) => id == null).length === 1 && o2.shapes[o2.shapes.indexOf(null) - 1] != null, `the offset STAYS, that copy null in it (${JSON.stringify(o2 && o2.shapes.map((id) => id && 's'))})`);
  assert(o2.name && o2.dimensioned !== false, 'its dimension stays');
  for (const [id, p] of corners) assert(Math.hypot(P(id).x - p.x, P(id).y - p.y) < 1e-6, `the copy corner ${id} stays where it was`);
  solverOk('D-38');
  await undoRedoReload('D-38', before);
  // the remaining copies keep following (on the reopened design): the distance 5 -> 8 moves them, the deleted side's corners too (its source holds them)
  const o3 = offsetRec();
  const er = commitDimensionEdit(app.state, o3, 8); app.frames();
  assert(!er.reverted, `the distance edit 5 -> 8 is accepted (${er.reason})`);
  // the copies' box is the sources' box grown by 8 on every side (the edit may move the free source too: compare with it)
  const box = (ls) => { const xs = ls.flatMap((s) => s.joints.map((j) => P(j).x)), ys = ls.flatMap((s) => s.joints.map((j) => P(j).y)); return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]; };
  const copies = lines().filter((s) => o3.shapes.indexOf(s.id) % 2 === 1), sources = lines().filter((s) => o3.shapes.indexOf(s.id) % 2 === 0);
  const bc = box(copies), bs = box(sources);
  assert(copies.length === 3 && sources.length === 4 && [-8, 8, -8, 8].every((d, k) => Math.abs(bc[k] - bs[k] - d) < 1e-6),
    `the 3 copies follow the new distance 8 (copies ${bc.map((v) => v.toFixed(4))}, sources ${bs.map((v) => v.toFixed(4))})`);
  solverOk('D-38 after the distance edit');
});

await section('D-39 an offset SOURCE curve: that curve only, the offset stays', async () => {
  await openBlank(); offsetScene();
  const src = lineAt(0, -10), o = offsetRec(); assert(src && o.shapes.indexOf(src.id) % 2 === 0, 'the source bottom line');
  const copyOfIt = o.shapes[o.shapes.indexOf(src.id) + 1];
  const before = docOf();
  click(0, -10); app.key('Delete');
  assert(!app.state.shapes.some((s) => s.id === src.id) && lines().length === 7, 'the source line only goes');
  const o2 = offsetRec();
  assert(o2 && o2.shapes.filter((id) => id == null).length === 2, 'the offset STAYS without that piece');
  assert(app.state.shapes.some((s) => s.id === copyOfIt), 'the copy of that side stays (plain geometry)');
  solverOk('D-39');
  await undoRedoReload('D-39', before);
});

await section('D-43 a pattern COPY curve: that curve only, the pattern stays; a quantity edit keeps it deleted', async () => {
  await openBlank(); patScene();
  const c = patternRec(); assert(c && c.instances.length === 2 && lines().length === 12, 'the scene: a pattern of 3 squares');
  const inst = c.instances[1], victim = inst.shapes[0];
  const before = docOf();
  const v = app.state.shapes.find((s) => s.id === victim), a = P(v.joints[0]), b = P(v.joints[1]);
  click((a.x + b.x) / 2, (a.y + b.y) / 2); app.key('Delete');
  assert(lines().length === 11 && !app.state.shapes.some((s) => s.id === victim), `that copy line only goes (${lines().length} lines)`);
  const c2 = patternRec(), i2 = c2.instances.find((i) => i.at.join() === inst.at.join());
  assert(c2.suppressed.length === 0 && i2 && i2.shapes[0] === null && i2.shapes.slice(1).every((id) => app.state.shapes.some((s) => s.id === id)), 'the pattern STAYS; its instance keeps its other 3 copies');
  solverOk('D-43');
  await undoRedoReload('D-43', before);
  // a later quantity edit (3 -> 4) keeps the deleted copy deleted and makes the new instance whole
  const c3 = patternRec();
  assert(editPattern(app.state, c3, { quantity: [4, 1] }).ok, 'quantity 3 -> 4');
  assert(c3.instances.length === 3 && c3.instances.find((i) => i.at.join() === inst.at.join()).shapes[0] === null, 'the quantity edit keeps that copy deleted');
  assert(lines().length === 15, `the new instance is whole (${lines().length} lines)`);
  solverOk('D-43 after a quantity edit');
});

await section('D-44 a pattern SOURCE curve: that curve + the pattern; the copies stay', async () => {
  await openBlank(); patScene();
  const before = docOf();
  click(-80, -10); app.key('Delete');
  assert(!patternRec() && lines().length === 11, 'the pattern goes, the 8 copies stay');
  solverOk('D-44');
  await undoRedoReload('D-44', before);
});

await section('D-63 the pattern label: the pattern goes, the copies stay', async () => {
  await openBlank(); patScene();
  const before = docOf();
  clickLabel(patternRec());
  app.key('Delete');
  assert(!patternRec() && lines().length === 12, 'the pattern goes, every copy stays');
  solverOk('D-63');
  await undoRedoReload('D-63', before);
});

await section('D-65 the offset LABEL keeps 667\'s free distance; the relation GLYPH removes the relation (every path)', async () => {
  // the label: unchanged (task 667, owner ruling)
  await openBlank(); offsetScene();
  clickLabel(offsetRec());
  app.key('Delete');
  assert(offsetRec() && offsetRec().dimensioned === false, 'Delete on the label keeps the relation with a free distance (667)');
  // the relation glyph: drawn TWICE (a source curve, its copy), always, one entity
  for (const path of ['key', 'menu', 'footer', 'hold']) {
    await openBlank(); offsetScene();
    const g = relation(), o = offsetRec();
    assert(g && g.type === OFFSET_RELATION && g.offset === o && Array.isArray(g.glyphPos) && g.glyphPos.length === 2 && g.__visible === true, `${path}: the relation shows two glyphs with nothing selected`);
    assert(app.svg.querySelectorAll('g.constraint-glyph[data-ctype="offsetRelation"]').length === 2, `${path}: two offsetRelation glyph elements drawn`);
    const copies = o.shapes.filter((_, i) => i % 2 === 1);
    const before = docOf();
    const ink = glyphInk(g, path === 'hold' ? 1 : 0); assert(ink, `${path}: the glyph's ink is pickable`);
    if (path === 'key' || path === 'footer') {
      app.move(ink.x, ink.y); assert(app.state.hoveredConstraint === g, `${path}: hovering the glyph hovers the relation`);
      if (path === 'key') { // Fusion (task 1048): hovering EITHER glyph lights BOTH glyphs and every source + copy curve, not the dimension label
        app.frames();
        const lit = [...app.svg.querySelectorAll('g.constraint-glyph[data-ctype="offsetRelation"] .fusion-glyph')].filter((e) => /glyph-hover/.test(e.getAttribute('style')));
        assert(lit.length === 2, `${path}: both relation glyphs are drawn in the hover colour (${lit.length})`);
        const curves = o.shapes.map((id) => app.svg.querySelector(`.shape-elem[data-shape-id="${id}"]`));
        assert(curves.every((e) => e && /glyph-hover/.test(e.getAttribute('style'))), `${path}: every source and copy curve is lit`);
        const lbl = app.svg.querySelector(`.dim-label[data-constraint-idx="${app.state.constraints.indexOf(o)}"]`);
        assert(lbl && /2563eb/i.test(lbl.outerHTML) && !/017AFD|sk-selection|glyph-hover/i.test(lbl.outerHTML), `${path}: the dimension label is not lit (its idle colour)`);
      }
      app.click(ink.x, ink.y);
      assert(app.state.selectedConstraints.has(g) && app.state.selectedConstraints.size === 1, `${path}: a click selects the relation`);
      if (path === 'key') app.key('Delete');
      else { const b = app.document.getElementById('btn-delete-selection'); assert(!b.disabled, 'the footer red X is enabled'); app.press(b); }
    } else {
      if (path === 'menu') app.rightClick(ink.x, ink.y);
      else { const o2 = { pointerType: 'touch' }; app.down(ink.x, ink.y, o2); await app.pause(LONG_PRESS_MS + 150); app.up(ink.x, ink.y, o2); }
      const rows = [...app.document.querySelectorAll('.sk-context-menu .sk-context-item')];
      const del = rows.find((x) => /-delete$/.test(x.dataset.id || ''));
      assert(del, `${path}: the glyph's menu has a Delete row (${rows.map((x) => x.dataset.id)})`);
      selDbg = JSON.stringify([...app.state.selectedConstraints].map((c) => c.type)) + " shapes " + app.state.selectedShapes.size + " rows " + rows.map((x) => x.dataset.id); app.press(del);
    }
    assert(!offsetRec(), `${path}: the offset relation goes (lines ${lines().length}, selected before ${selDbg})`);
    assert(copies.every((id) => app.state.shapes.some((s) => s.id === id)) && lines().length === 8, `${path}: the copies stay as plain geometry`);
    assert(!app.svg.querySelector('g.constraint-glyph[data-ctype="offsetRelation"]'), `${path}: no relation glyph left`);
    solverOk('D-65 ' + path);
    await undoRedoReload('D-65 ' + path, before);
  }
  // an old design (the record only, no glyph stored): the reopened page draws the glyph from the record
  await openBlank(); offsetScene(); await reopen();
  assert(relation() && relation().__visible === true && app.svg.querySelectorAll('g.constraint-glyph[data-ctype="offsetRelation"]').length === 2, 'a reopened design shows the relation glyphs (derived, not stored)');
  assert(!JSON.stringify(await app.storedDoc()).includes(OFFSET_RELATION), 'the glyph is never stored');
});

if (app) await app.close();
if (failures.length) { console.log(`copy-delete-1046-node: FAILED ${failures.length}: ${failures.join(' | ')}`); process.exit(1); }
console.log('copy-delete-1046-node: ok');
