// tests/text-845-node.test.js — TASK 845 (node): the Design tab's TEXT object, its fonts and its letters, through the SAME core / UI modules the apps run
// (#core/text.js, #core/font-faces.js, #ui/text-fonts.js with a file reader in place of fetch: the files are the vendored ones).
//  1. every bundled font: its file and its licence file are there (OFL / Apache / the Hershey notice), opentype.js's MIT licence; bytes added (printed)
//  2. the letters of a known string are the font's glyph data (opentype.js): every derived joint / control point within 0.001 mm of opentype's own
//     getPath at the same pen positions (kerning, letter spacing, alignment, rotation), and the bezier bodies on opentype's curves
//  3. the loop finder sees letters as loops and their counters as HOLES (o, e, B), Shaper's pocket on a letter writes the outline AND its counter
//  4. a single-line font (Hershey Simplex, Relief SingleLine) gives OPEN paths (chains), never a closing line
//  5. the text round-trips through save / load (the letters are never stored; rebuilt with the same ids) and undo / redo (one step per edit)
//  6. Convert to shapes: ordinary curves, one undo step, no longer text
//  7. a missing font draws in the stored fallback, with the plain note; the document keeps the font's name
//  8. the anchor takes a coincident / a dimension (the whole text follows); a letter takes none (refused); the transform rotates / scales the
//     text (record and letters agree); the SketchStudio SVG / DXF exports write the letters, never the text shape; the plotter reads the letters
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine } from '#core/constraint-solver.js';
import { createSketchState } from '#core/sketch-state.js';
import { addText, editText, textOutlineOf, convertTextToShapes, layoutText, textToWorld, isTextOutline, TEXT_CONSTRAINT_REFUSAL } from '#core/text.js';
import { findLoops, findOpenChains } from '#core/loop-finder.js';
import { loopPolygon, polygonContains } from '#core/loop-geometry.js';
import { derivedProfileForLoop } from '#core/profile-model.js';
import { serializeDocument, deserializeDocument } from '#core/document.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { CONSTRAINT_TYPES } from '#core/constants.js';
import { runGroupTransform } from '#core/transform.js';
import { coreShapeToPolyline } from '#core/core-shape-to-polyline.js';
import { createFontLibrary, BUNDLED_FONTS, syncTextOutlines, fallbackNote } from '#ui/text-fonts.js';
import { buildSVG, buildDXF } from '../apps/sketchstudio/ui/export-manager.js';
import { shaperSvgOf } from '../apps/shaper/src/export-payload.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const TOL = 0.001; // mm
const readBytes = async (u) => { const b = fs.readFileSync(fileURLToPath(u)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const lib = createFontLibrary({ readBytes });
const opentype = (await import('../packages/ui/vendor/opentype/opentype.module.js')).default;
const newState = () => { const e = createEngine(null); e.init(); return createSketchState(e, { x: 0, y: 0, w: 200, h: 200 }); };
const quiet = (fn) => { const w = console.warn, l = console.log; console.warn = () => {}; console.log = () => {}; try { return fn(); } finally { console.warn = w; console.log = l; } };

// ── 1. the bundled fonts and their licences ──
{
  let bytes = 0;
  for (const f of BUNDLED_FONTS) {
    const file = fileURLToPath(f.url), lic = fileURLToPath(f.licence);
    ok(fs.existsSync(file), `${f.name}: its font file ${file}`);
    ok(fs.existsSync(lic), `${f.name}: its licence file ${lic}`);
    const text = fs.readFileSync(lic, 'utf8');
    ok(/SIL Open Font License, Version 1\.1|Apache License\s+Version 2\.0|The Hershey Fonts/.test(text), `${f.name}: the licence is OFL 1.1, Apache 2.0 or the Hershey notice`);
    bytes += fs.statSync(file).size;
  }
  const licDirs = new Set(BUNDLED_FONTS.map((f) => path.dirname(fileURLToPath(f.url))));
  for (const d of licDirs) bytes += fs.readdirSync(d).filter((n) => !BUNDLED_FONTS.some((f) => fileURLToPath(f.url) === path.join(d, n))).reduce((a, n) => a + fs.statSync(path.join(d, n)).size, 0);
  const ot = path.join(ROOT, 'packages/ui/vendor/opentype');
  ok(/MIT License/.test(fs.readFileSync(path.join(ot, 'LICENSE'), 'utf8')), 'opentype.js: its MIT licence beside it');
  ok(/opentype\.js\.org v1\.3\.4 /.test(fs.readFileSync(path.join(ot, 'opentype.module.js'), 'utf8').slice(0, 300)), 'opentype.js: the pinned 1.3.4');
  const otBytes = fs.readdirSync(ot).reduce((a, n) => a + fs.statSync(path.join(ot, n)).size, 0);
  eq(BUNDLED_FONTS.map((f) => f.name), ['Inter', 'Roboto', 'Roboto Slab', 'Merriweather', 'Oswald', 'Anton', 'Bebas Neue', 'Pacifico',
    'Hershey Simplex', 'Hershey Duplex', 'Hershey Complex', 'Hershey Script', 'Hershey Italic', 'Relief SingleLine'], 'the bundled fonts');
  for (const f of BUNDLED_FONTS) {
    const face = await lib.load(f.name);
    ok(face && face.kind === f.kind && face.capHeight > 0 && face.glyphFor('H').contours.length > 0, `${f.name}: read, an 'H', a cap height`);
  }
  console.log(`bytes added: fonts + their licence files ${bytes}, opentype.js + licence + readme ${otBytes}`);
}

// ── 2. the letters ARE the font's glyph data (opentype.js), 0.001 mm ──
{
  const buf = fs.readFileSync(path.join(ROOT, 'packages/ui/vendor/fonts/roboto/roboto-latin-400-normal.woff'));
  const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const face = await lib.load('Roboto');
  for (const [label, opts] of [['plain', {}], ['kerned + spaced + centred + turned 30 deg', { text: 'AVo T', letterSpacing: 0.7, align: 'center', rotation: Math.PI / 6 }], ['two lines, right', { text: 'Hob\nTo', align: 'right', lineSpacing: 1.2 }]]) {
    const st = newState();
    const rec = { text: 'Hob', size: 12.5, letterSpacing: 0, lineSpacing: 1, align: 'left', rotation: 0, ...opts };
    const t = addText(st, { x: 12, y: 34 }, { ...rec, font: 'Roboto', fontKind: 'outline' }, face);
    // the oracle: opentype's own getPath of each glyph at the pen (its advance + its kerning, the spacing), turned about the anchor
    const capH = font.charToGlyph('H').getBoundingBox().y2, k = rec.size / capH, fontSize = rec.size * font.unitsPerEm / capH;
    const W = textToWorld(t, { x: 12, y: 34 });
    const expected = []; // { on: [{x,y}], ctrl: [{x,y}] } per command, world
    const lines = rec.text.split('\n'), pitch = rec.lineSpacing * (font.ascender - font.descender) * k;
    lines.forEach((line, li) => {
      const gs = [...line].map((ch) => font.charToGlyph(ch));
      const xs = []; let pen = 0;
      gs.forEach((g, i) => { if (i) pen += font.getKerningValue(gs[i - 1], g) * k; xs.push(pen); pen += g.advanceWidth * k + rec.letterSpacing; });
      const width = pen - rec.letterSpacing, ox = rec.align === 'center' ? -width / 2 : rec.align === 'right' ? -width : 0;
      gs.forEach((g, i) => {
        // getPath(x, y, size): x right, y DOWN from the baseline -> text-local (x, -y) -> world
        const P = (x, y) => W({ x: ox + xs[i] + x, y: -li * pitch - y });
        let cur = null;
        for (const c of g.getPath(0, 0, fontSize).commands) {
          if (c.type === 'M') { cur = P(c.x, c.y); continue; }
          if (c.type === 'Z') continue;
          const to = P(c.x, c.y);
          const ctrl = c.type === 'Q' ? [P(c.x1, c.y1)] : c.type === 'C' ? [P(c.x1, c.y1), P(c.x2, c.y2)] : [];
          expected.push({ from: cur, to, type: c.type, ctrl });
          cur = to;
        }
      });
    });
    const shapes = textOutlineOf(st, t);
    ok(shapes.length > 0, label + ': letters built');
    const J = (id) => st.joints.get(id);
    const near = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) <= TOL;
    let worst = 0;
    for (const s of shapes) {
      const a = J(s.joints[0]), b = J(s.joints[1]);
      const e = expected.find((x) => near(x.from, a) && near(x.to, b));
      ok(!!e, `${label}: ${s.id} (${s.type}) is a segment of the glyph data: ${JSON.stringify([a, b])}`);
      if (s.type === 'bezier') {
        // the curve's body: a raised quadratic IS that quadratic (same parameter); a cubic is the cubic
        const bez = (t) => { const u = 1 - t; return { x: u * u * u * a.x + 3 * u * u * t * s.c1[0] + 3 * u * t * t * s.c2[0] + t * t * t * b.x, y: u * u * u * a.y + 3 * u * u * t * s.c1[1] + 3 * u * t * t * s.c2[1] + t * t * t * b.y }; };
        const ref = (t) => { const u = 1 - t; if (e.type === 'Q') { const q = e.ctrl[0]; return { x: u * u * e.from.x + 2 * u * t * q.x + t * t * e.to.x, y: u * u * e.from.y + 2 * u * t * q.y + t * t * e.to.y }; }
          const [c1, c2] = e.ctrl; return { x: u * u * u * e.from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * e.to.x, y: u * u * u * e.from.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * e.to.y }; };
        for (const tt of [0.1, 0.25, 0.5, 0.75, 0.9]) { const d = Math.hypot(bez(tt).x - ref(tt).x, bez(tt).y - ref(tt).y); worst = Math.max(worst, d); }
      }
    }
    // and every on-curve point of the glyph data is a joint of the letters (nothing dropped but zero-length moves)
    const pts = [...new Set(shapes.flatMap((s) => s.joints))].map(J);
    for (const e of expected) ok(pts.some((p) => near(p, e.to)), `${label}: the glyph point ${JSON.stringify(e.to)} is a letter joint`);
    ok(worst <= TOL, `${label}: every bezier body on opentype's curve (worst ${worst.toExponential(2)} mm)`);
    console.log(`2. ${label}: ${shapes.length} curves = the glyph data, worst body distance ${worst.toExponential(2)} mm`);
  }
}

// ── 3. letters are loops, counters are holes ──
{
  const st = newState();
  const face = await lib.load('Inter');
  const t = addText(st, { x: 0, y: 0 }, { text: 'oeB', size: 10, font: 'Inter', fontKind: 'outline' }, face);
  const loops = findLoops(st), by = new Map(st.shapes.map((s) => [s.id, s]));
  eq(loops.length, 7, 'o: 2 loops, e: 2, B: 3');
  ok(loops.every((l) => l.edges.every((id) => by.get(id).textOutline)), 'every loop is made of the letters');
  const polys = Object.fromEntries(loops.map((l) => [l.id, loopPolygon(l, st, by)]));
  const outers = loops.filter((l) => !loops.some((m) => m !== l && polygonContains(polys[m.id], polys[l.id])));
  eq(outers.length, 3, 'three outlines (o, e, B)');
  const holes = outers.map((l) => derivedProfileForLoop(l.id, loops, polys, st).inners.length).sort();
  eq(holes, [1, 1, 2], "the counters are the outlines' holes (o 1, e 1, B 2)");
  eq(findOpenChains(st, loops), [], 'no open chain: the text shape itself is no chain');
  // Shaper: a pocket on the o writes its outline and its counter (a hole)
  const oLoop = outers.sort((a, b) => Math.min(...polys[a.id].map((p) => p.x)) - Math.min(...polys[b.id].map((p) => p.x)))[0];
  const svg = quiet(() => shaperSvgOf(st, [{ target: { kind: 'loop', id: oLoop.id }, rec: { cutType: 'pocket', cutDepth: 3, cutOffset: 0, toolDia: 3.175, cutterShape: 'endmill', cutterAngle: 90 } }]));
  const pocket = [...svg.matchAll(/<path [^>]*d="([^"]+)"[^>]*>/g)].map((m) => m[0]).find((p) => /pocket/.test(p) || /shaper:cutType="pocket"/.test(p)) || '';
  const pocketD = (pocket.match(/d="([^"]+)"/) || [])[1] || '';
  eq((pocketD.match(/M/g) || []).length, 2, `the pocket path is the o's outline + its counter: ${pocketD.slice(0, 80)}`);
  console.log('3. oeB: 7 loops, 3 outlines with 1 / 1 / 2 holes; the o pocket writes 2 sub-paths');
}

// ── 4. single-line fonts: open paths ──
{
  for (const name of ['Hershey Simplex', 'Relief SingleLine']) {
    const st = newState();
    const face = await lib.load(name);
    const t = addText(st, { x: 0, y: 0 }, { text: 'HIL', size: 10, font: name, fontKind: 'single' }, face);
    const loops = findLoops(st), chains = findOpenChains(st, loops);
    eq(loops.length, 0, `${name}: H I L make no loop (strokes)`);
    ok(chains.length >= 3, `${name}: open chains (${chains.length})`);
    ok(textOutlineOf(st, t).every((s) => s.type === 'line' || s.type === 'bezier'), `${name}: lines / beziers`);
  }
  // a stroke that comes back to its start (the Hershey i's dot) is one closed stroke
  const st = newState();
  addText(st, { x: 0, y: 0 }, { text: 'i', size: 10, font: 'Hershey Simplex', fontKind: 'single' }, await lib.load('Hershey Simplex'));
  eq([findLoops(st).length, findOpenChains(st).length], [1, 1], 'Hershey i: its dot one closed stroke, its stem one open stroke');
  console.log('4. single-line: open strokes, a closed stroke closed');
}

// ── 5. save / load / undo ──
{
  const st = newState();
  const face = await lib.load('Oswald');
  const snap = st.captureUndoSnapshot();
  const t = addText(st, { x: 5, y: 6 }, { text: 'Ab\nc', size: 8, letterSpacing: 0.5, lineSpacing: 1.3, align: 'center', font: 'Oswald', fontKind: 'outline' }, face);
  st.saveStateForce('text', snap);
  const letters = () => textOutlineOf(st, st.shapes.find((s) => s.type === 'text')).map((s) => [s.id, s.type, ...s.joints.map((j) => [st.joints.get(j).x, st.joints.get(j).y])]);
  const before = letters();
  const doc = JSON.parse(JSON.stringify(serializeDocument(st)));
  ok(!doc.geometry.shapes.some((s) => s.textOutline) && !doc.geometry.joints.some(([, j]) => j.textOutline), 'the document stores no letter (shape or joint)');
  const stored = doc.geometry.shapes.find((s) => s.type === 'text');
  eq([stored.text, stored.font, stored.fallback, stored.size, stored.letterSpacing, stored.lineSpacing, stored.align, stored.rotation], ['Ab\nc', 'Oswald', 'Inter', 8, 0.5, 1.3, 'center', 0], 'the document stores the text: string, font + fallback, style');
  eq(doc.geometry.groups.map((g) => g.name), ['Text "Ab"'], "the text's group, named after its first line");
  const st2 = newState();
  deserializeDocument(doc, st2);
  eq(textOutlineOf(st2, st2.shapes.find((s) => s.type === 'text')).length, 0, 'read: no letters yet');
  await syncTextOutlines(st2, { library: lib });
  const after = textOutlineOf(st2, st2.shapes.find((s) => s.type === 'text')).map((s) => [s.id, s.type, ...s.joints.map((j) => [st2.joints.get(j).x, st2.joints.get(j).y])]);
  eq(after, before, 'read back: the SAME letters (ids, kinds, points) rebuilt from the text');
  // undo / redo: the add is one step; an edit is one step
  const snap2 = st.captureUndoSnapshot();
  editText(st, t, { text: 'Xy', size: 4 }, face);
  st.saveStateForce('edit text', snap2);
  const h = st.history.length;
  st.undo();
  eq(letters(), before, 'undo the edit: the text and its letters as before');
  st.redo();
  eq([st.shapes.find((s) => s.type === 'text').text, st.history.length], ['Xy', h], 'redo: the edit back');
  st.undo(); st.undo();
  eq(st.shapes.filter((s) => s.type === 'text' || s.textOutline).length, 0, 'undo the add: nothing of the text left');
  console.log('5. save / load / undo: letters never stored, rebuilt identical; one step per add / edit');
}

// ── 6. Convert to shapes ──
{
  const st = newState();
  const t = addText(st, { x: 0, y: 0 }, { text: 'oB', size: 10, font: 'Inter', fontKind: 'outline' }, await lib.load('Inter'));
  const n = textOutlineOf(st, t).length, loopsBefore = findLoops(st).map((l) => l.id);
  st.saveState('convert text to shapes');
  const ids = convertTextToShapes(st, t);
  eq(ids.length, n, 'every letter curve is kept');
  ok(!st.shapes.some((s) => s.type === 'text' || s.textOutline) && ![...st.joints.values()].some((j) => j.textOutline), 'no text, no letter mark left: ordinary curves');
  eq(findLoops(st).map((l) => l.id), loopsBefore, 'the same loops (ids)');
  eq(st.groups.map((g) => g.name), ['oB'], 'its group stays, named after the string');
  const doc = serializeDocument(st);
  eq(doc.geometry.shapes.length, n, 'now stored as curves');
  st.undo();
  ok(st.shapes.some((s) => s.type === 'text') && textOutlineOf(st, st.shapes.find((s) => s.type === 'text')).length === n, 'one undo: the text is back');
  console.log('6. Convert to shapes: ' + n + ' curves, one undo step');
}

// ── 7. a missing font: the fallback, the note; the document keeps the name ──
{
  const st = newState();
  const t = addText(st, { x: 0, y: 0 }, { text: 'Hi', size: 10, font: 'My Shop Font', fontKind: 'outline' }, null);
  eq(t.fallback, 'Inter', 'an outline font falls back to Inter');
  const notes = [];
  await syncTextOutlines(st, { library: lib, notify: (m, l) => notes.push([l, m]) });
  const ref = newState();
  addText(ref, { x: 0, y: 0 }, { text: 'Hi', size: 10, font: 'Inter', fontKind: 'outline' }, await lib.load('Inter'));
  const pts = (s) => s.shapes.filter((x) => x.textOutline).map((x) => x.joints.map((j) => [s.joints.get(j).x, s.joints.get(j).y]));
  eq(pts(st), pts(ref), 'drawn in Inter');
  eq(notes, [['warning', fallbackNote(t)]], 'the plain note: ' + fallbackNote(t));
  eq(serializeDocument(st).geometry.shapes.find((s) => s.type === 'text').font, 'My Shop Font', 'the design keeps its font name');
  const s2 = newState();
  addText(s2, { x: 0, y: 0 }, { text: 'Hi', size: 10, font: 'Gone Engraver', fontKind: 'single' }, null);
  eq(s2.shapes.find((s) => s.type === 'text').fallback, 'Hershey Simplex', 'a single-line font falls back to Hershey Simplex');
  console.log('7. missing font: ' + notes[0][1]);
}

// ── 8. the anchor takes constraints; a letter does not; transform; exports; plotter ──
{
  const st = newState();
  const face = await lib.load('Inter');
  const t = addText(st, { x: 10, y: 10 }, { text: 'Lo', size: 10, font: 'Inter', fontKind: 'outline' }, face);
  const anchor = t.joints[0];
  const p = st.genJ(); st.joints.set(p, { x: 30, y: 20, fixed: true });
  const rel0 = textOutlineOf(st, t).map((s) => s.joints.map((j) => ({ x: st.joints.get(j).x - st.joints.get(anchor).x, y: st.joints.get(j).y - st.joints.get(anchor).y })));
  ok(quiet(() => ConstraintManager.createConstraint(st, CONSTRAINT_TYPES.COINCIDENT, { joints: [anchor, p] })), 'the anchor takes a coincident');
  st.engine.solve(200);
  const A = st.joints.get(anchor);
  ok(Math.hypot(A.x - 30, A.y - 20) < 1e-6, 'the anchor is on the point');
  const rel1 = textOutlineOf(st, t).map((s) => s.joints.map((j) => ({ x: st.joints.get(j).x - A.x, y: st.joints.get(j).y - A.y })));
  const drift = Math.max(...rel1.flat().map((q, i) => Math.hypot(q.x - rel0.flat()[i].x, q.y - rel0.flat()[i].y)));
  ok(drift < 1e-6, `the whole text followed it (letters rigid: ${drift.toExponential(2)})`);
  const letter = textOutlineOf(st, t)[0];
  const q = st.genJ(); st.joints.set(q, { x: 50, y: 50 });
  const notes = [];
  const refused = quiet(() => ConstraintManager.createConstraint(st, CONSTRAINT_TYPES.COINCIDENT, { joints: [letter.joints[0], q] }));
  eq(refused, null, 'a letter point takes no coincident');
  eq(quiet(() => ConstraintManager.createConstraint(st, CONSTRAINT_TYPES.POINT_ON_LINE, { joint: q, shape: letter.id })), null, 'a letter curve holds no point');
  ok(TEXT_CONSTRAINT_REFUSAL.includes('anchor'), 'the refusal names the anchor');
  // a dimension from the anchor to a free point
  const r = st.genJ(); st.joints.set(r, { x: 0, y: 0, fixed: true });
  ok(quiet(() => ConstraintManager.createConstraint(st, CONSTRAINT_TYPES.DISTANCE, { joints: [r, anchor], value: 40 })), 'a dimension to the anchor');
  // rotate + scale the text's group (TASK 753's transform): record and letters agree
  const st3 = newState();
  const t3 = addText(st3, { x: 0, y: 0 }, { text: 'Ab', size: 10, font: 'Inter', fontKind: 'outline' }, face);
  const res = quiet(() => runGroupTransform(st3, t3.userGroupId, { pivot: { x: 0, y: 0 }, angle: Math.PI / 4, scale: 2 }));
  ok(res.ok, 'the transform box rotates and scales a text: ' + JSON.stringify(res.reason || ''));
  eq([+t3.rotation.toFixed(12), t3.size], [+(Math.PI / 4).toFixed(12), 20], 'the text turned 45 deg and is 20 mm tall');
  const moved = textOutlineOf(st3, t3).map((s) => s.joints.map((j) => st3.joints.get(j)));
  const fresh = newState();
  const tf = addText(fresh, { x: st3.joints.get(t3.joints[0]).x, y: st3.joints.get(t3.joints[0]).y }, { text: 'Ab', size: 20, rotation: Math.PI / 4, font: 'Inter', fontKind: 'outline' }, face);
  const want = textOutlineOf(fresh, tf).map((s) => s.joints.map((j) => fresh.joints.get(j)));
  const dev = Math.max(...moved.flat().map((m, i) => Math.hypot(m.x - want.flat()[i].x, m.y - want.flat()[i].y)));
  ok(dev < 1e-6, `the transformed letters ARE the text rebuilt at its new rotation / size (${dev.toExponential(2)} mm)`);
  // exports and the plotter read the letters, never the text shape
  const svg = quiet(() => buildSVG(st3, {})), dxf = quiet(() => buildDXF(st3, {}));
  const nLetters = textOutlineOf(st3, t3).length;
  ok(svg && / C /.test(svg) && (svg.match(/<(path|line|polygon)\b/g) || []).length > 0 && !/<text\b/.test(svg), `SketchStudio SVG writes the letters (${nLetters} curves: cubic paths, lines), no <text>`);
  ok(/SPLINE/.test(dxf) && /LINE/.test(dxf), 'SketchStudio DXF writes them (SPLINE / LINE)');
  eq(coreShapeToPolyline(t3, st3.joints), [], 'the plotter draws nothing for the text shape itself');
  ok(textOutlineOf(st3, t3).every((s) => (coreShapeToPolyline(s, st3.joints) || []).length >= 2), 'the plotter strokes every letter');
  ok(!isTextOutline(t3), 'the text shape is not a letter');
  console.log('8. anchor constraints, letters refused, transform agrees, exports / plotter read the letters');
}

console.log(`text-845-node: ok (${checks} checks)`);
