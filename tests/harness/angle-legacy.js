// tests/harness/angle-legacy.js -- TASK 553: what an angle dimension of a document LOOKS like and DOES, measured the same way on any build.
// outcomesOf(doc, mods) loads `doc` into a fresh state with the given build's modules (mods = { createEngine, createSketchState,
// deserializeDocument, draw, commitDimensionEdit }) and records, for every angle dimension:
//   arc    the drawn arc read back from the page SVG (start / end points, radius, large-arc flag), the label text, the label spot (glyphPos)
//   load   every joint after a solve of the loaded document (an old file must not move)
//   edits  every joint and the arc after a value edit (+7 and -7 degrees, each from a fresh load, drawn once first like the page does),
//          and whether it was refused
//   jitter every joint after the free joints are jittered (seeded) and the document re-solved
// The old-file test (tests/angle-sector-old-files.test.js) compares these between the build that wrote the documents (main before task 553,
// recorded in tests/fixtures/angle-dimension/legacy-angles.json) and this one.

const ITER = 500;
const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const clone = (x) => JSON.parse(JSON.stringify(x));

function freshState(mods) {
  const engine = mods.createEngine(null);
  engine.init();
  return mods.createSketchState(engine, { x: 0, y: 0, w: 800, h: 800 });
}
const jointsOf = (state) => [...state.joints.entries()].map(([id, j]) => [id, j.x, j.y]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
const anglesOf = (state) => state.constraints.filter((c) => c && c.type === 'angle');

function arcOf(state, c, mods) {
  const svg = { viewBox: { baseVal: { x: -5000, y: -5000, width: 10000, height: 10000 } }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 800 }), innerHTML: '' };
  mods.draw(state.joints, state.shapes, svg, null, null, [c], new Set(), new Set(), 'select', null, new Set(), null, null, null, null, null, false, null);
  const m = svg.innerHTML.match(/<path d="M ([-\d.e]+) ([-\d.e]+) A ([-\d.e]+) [-\d.e]+ 0 ([01]) 1 ([-\d.e]+) ([-\d.e]+)"/);
  const t = svg.innerHTML.match(/class="dim-label"[\s\S]*?<text[^>]*>([^<]*)<\/text>/);
  return {
    arc: m ? { sx: +m[1], sy: +m[2], r: +m[3], large: +m[4], ex: +m[5], ey: +m[6] } : null,
    text: t ? t[1] : null,
    glyph: c.glyphPos ? { x: c.glyphPos.x, y: c.glyphPos.y } : null,
  };
}

function load(doc, mods) {
  const state = freshState(mods);
  const res = mods.deserializeDocument(clone(doc), state);
  if (!res.ok) throw new Error('load failed: ' + res.reason);
  return state;
}

export function outcomesOf(doc, mods) {
  const out = { angles: [] };
  {
    const state = load(doc, mods);
    out.angles = anglesOf(state).map((c) => ({ value: c.value, driven: !!(c.isDriven || c.driven), ...arcOf(state, c, mods) }));
    state.engine.solve(ITER);
    out.load = jointsOf(state);
  }
  out.edits = [];
  anglesOf(load(doc, mods)).forEach((c0, i) => {
    if (c0.isDriven || c0.driven) return;
    for (const d of [7, -7]) {
      const state = load(doc, mods);
      const c = anglesOf(state)[i];
      arcOf(state, c, mods);   // the page draws a loaded document at once (the renderer places the label: glyphPos)
      const r = mods.commitDimensionEdit(state, c, c.value + d);
      out.edits.push({ angle: i, to: c0.value + d, refused: !!r.reverted, joints: jointsOf(state), arc: arcOf(state, c, mods).arc });
    }
  });
  {
    const state = load(doc, mods);
    const xs = [...state.joints.values()].flatMap((j) => [j.x, j.y]);
    const size = Math.max(1, Math.max(...xs) - Math.min(...xs));
    const rnd = mulberry32(553);
    for (const [, j] of [...state.joints.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      if (j.fixed) continue;
      j.x += (rnd() * 2 - 1) * size * 0.01; j.y += (rnd() * 2 - 1) * size * 0.01;
    }
    state.engine.solve(ITER);
    out.jitter = jointsOf(state);
  }
  return out;
}
