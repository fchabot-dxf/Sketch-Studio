// tests/penplotter-validation.test.js — TASK 453: every declared numeric field has ONE valid range, enforced by ONE helper
// (#core/plot/params.js coerceParam) at the inputs AND at the consumers. Here: the helper, the generators (they must END for
// spacing <= 0 even when a bad value arrives from an old document: run in a child process with a timeout), the G-code
// emitter (never F0 / NaN), the declared settings / doc / pens / toolpaths, and an OLD document loading clamped.
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { coerceParam, resolveParams, sanitizeParams, MACHINE_FIELDS, renderGcode } from '../packages/core/plot/index.js';
import { state, makeToolpath, makePlotColor } from '../apps/penplotter/src/state.js';
import { DOC_FIELD, keepNumber, keepSetting, sanitizeSettings, sanitizeDoc, sanitizePens, sanitizeToolpaths } from '../apps/penplotter/src/fields.js';
import { applyPlotterDoc } from '../apps/penplotter/src/plotter-doc.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 1. coerceParam: the one rule
{
  const d = { default: 2, min: 0.1, max: 100 };
  assert.strictEqual(coerceParam(d, 5), 5);
  assert.strictEqual(coerceParam(d, 0), 0.1, '0 clamps to min');
  assert.strictEqual(coerceParam(d, -3), 0.1, 'negative clamps to min');
  assert.strictEqual(coerceParam(d, 99999), 100, 'huge clamps to max');
  assert.strictEqual(coerceParam(d, ''), 2, 'empty -> default');
  assert.strictEqual(coerceParam(d, 'abc'), 2, 'text -> default');
  assert.strictEqual(coerceParam(d, NaN, 7), 7, 'NaN -> the fallback (a UI passes the previous value)');
  assert.strictEqual(coerceParam(d, undefined, 'x'), 2, 'a bad fallback falls to the default');
  assert.strictEqual(coerceParam({ default: 1, min: 1, max: 10, integer: true }, 2.5), 3, 'integer rounds');
  assert.deepStrictEqual(resolveParams([{ key: 'a', default: 1, min: 0 }], { a: -4 }), { a: 0 });
  assert.deepStrictEqual(sanitizeParams([{ key: 'a', default: 1, min: 0 }], { a: -4, b: 'keep' }), { a: 0, b: 'keep' });
}

// 2. the generators END for spacing <= 0 / NaN / '' (a hang here would hang this test: child process + timeout)
{
  const code = `
    import { scanlineHatch } from '${pathToFileURL(path.join(root, 'packages/core/plot/fills/hatch.js')).href}';
    import { FILL_PATTERNS } from '${pathToFileURL(path.join(root, 'packages/core/plot/fills/index.js')).href}';
    import { OUTLINE_STYLES } from '${pathToFileURL(path.join(root, 'packages/core/plot/outlines/index.js')).href}';
    const poly = [[0,0],[10,0],[10,10],[0,10]];
    const rect = { id: 'r', type: 'rect', x: 0, y: 0, w: 10, h: 10 };
    const out = {};
    for (const sp of [0, -1, NaN, '', 'abc', 0.0001]) {
      out['hatch ' + sp] = scanlineHatch(poly, 45, sp).length;
      for (const p of FILL_PATTERNS) out[p.id + ' ' + sp] = p.generate(rect, { spacing: sp, angle: 45, offset: 0 }).length;
    }
    const dashed = OUTLINE_STYLES.find(s => s.id === 'dashed');
    for (const [l, g] of [[0, 0], [-1, -1], ['', ''], [0, 1]]) out['dashed ' + l + '/' + g] = dashed.apply(rect, { dash_length: l, dash_gap: g }).length;
    console.log(JSON.stringify(out));
  `;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { timeout: 20000, encoding: 'utf8' });
  assert(!r.error, 'generators did not terminate within 20 s (infinite loop): ' + (r.error && r.error.message));
  assert.strictEqual(r.status, 0, 'child failed: ' + r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  for (const sp of [0, -1, 'NaN', '', 'abc']) assert(out['hatch ' + sp] > 0, 'hatch spacing ' + sp + ' terminates with the floored spacing: ' + out['hatch ' + sp]);
  assert(Object.keys(out).length >= 6 * 6 + 4, 'every pattern and style ran');
  console.log('generators terminate: hatch spacing 0 ->', out['hatch 0'], 'segments, -1 ->', out['hatch -1']);
}

// 3. the G-code emitter never writes F0 / NaN, and refuses a pen that never lifts
{
  const poly = [[[0, 0], [10, 0], [10, 10]]];
  for (const bad of [0, -5, '', 'abc', NaN, undefined]) {
    const g = renderGcode(poly, { penUpZ: 5, penDownZ: -1, drawFeed: bad, zFeed: bad, docH: 100 });
    assert(!/F0\b|F-|NaN|Infinity|undefined/.test(g), 'no F0/NaN for feed ' + JSON.stringify(bad) + ':\n' + g);
    assert(/ F\d+/.test(g), 'a positive feed is written');
  }
  const g2 = renderGcode(poly, { penUpZ: 'x', penDownZ: -1, drawFeed: 1000, zFeed: 500, docH: 100 });
  assert(!/NaN/.test(g2) && /Z5\.000/.test(g2), 'a bad pen-up Z falls to the declared default 5: ' + g2.split('\n')[6]);
  assert.throws(() => renderGcode(poly, { penUpZ: -1, penDownZ: -1, drawFeed: 1000, zFeed: 500 }), /must differ/, 'equal pen Z refused');
  assert.strictEqual(MACHINE_FIELDS.drawFeed.min, 1, 'the minimum feed is declared once in #core');
}

// 4. the UI commit helpers: reject (keep previous) or clamp, and return the kept value
{
  const s = { pen_up_z: 5, pen_down_z: -1, draw_feed: 2000, z_feed: 1000, tolerance_mm: 0.1 };
  assert.strictEqual(keepSetting(s, 'draw_feed', '').value, 2000, 'empty feed keeps the previous');
  assert.strictEqual(keepSetting(s, 'draw_feed', '-5').value, 1, 'negative feed clamps to the minimum');
  assert.strictEqual(keepSetting(s, 'draw_feed', '999999').value, 50000, 'huge feed clamps');
  assert.strictEqual(keepSetting(s, 'tolerance_mm', '0').value, 0.001, 'tolerance 0 clamps to the declared minimum');
  assert.strictEqual(keepSetting(s, 'tolerance_mm', '-1').value, 0.001, 'tolerance -1 clamps');
  const eq = keepSetting(s, 'pen_up_z', '-1');
  assert.strictEqual(eq.value, 5, 'pen up == pen down is refused: the previous value is kept');
  assert(/must differ/.test(eq.note), 'with a message');
  assert.strictEqual(keepSetting(s, 'pen_down_z', '5').value, -1, 'and the other way round');
  assert.strictEqual(keepNumber(DOC_FIELD, '-5', 200), 10, 'doc -5 -> 10');
  assert.strictEqual(keepNumber(DOC_FIELD, '', 200), 200, 'doc empty keeps the previous');
  assert.strictEqual(keepNumber(DOC_FIELD, '99999', 200), 2000, 'doc 99999 -> 2000');
  assert.strictEqual(keepNumber(DOC_FIELD, '0', 200), 10, 'doc 0 -> 10');
}

// 5. an OLD document holding bad values loads clamped
{
  const pen = makePlotColor('p', '#ff0000', 99);
  const fill = makeToolpath('F', 'fill'); fill.plotColorId = pen.id; fill.fill = { pattern: 'hatch', angle: 9999, spacing: -1, offset: 5000 };
  const out = makeToolpath('O', 'outline'); out.outline = { style: 'dashed', passes: 2.5, dash_length: 0, dash_gap: -3 };
  applyPlotterDoc({
    artLayers: [], activeArtLayerId: null, activeToolpathId: fill.id,
    doc: { w: 99999, h: -5 }, plotColors: [pen], toolpaths: [fill, out],
    settings: { pen_up_z: 3, pen_down_z: 3, draw_feed: '', z_feed: 0, tolerance_mm: -1 },
    shapeStyles: [], staticShapeIds: [],
  });
  assert.deepStrictEqual(state.doc, { w: 2000, h: 10 }, 'doc clamped: ' + JSON.stringify(state.doc));
  assert.strictEqual(state.plotColors[0].width, 5, 'pen width clamped');
  assert.deepStrictEqual(state.toolpaths[0].fill, { pattern: 'hatch', angle: 360, spacing: 0.1, offset: 100 }, 'fill params clamped');
  assert.strictEqual(state.toolpaths[1].outline.passes, 3, 'passes is an integer');
  assert.strictEqual(state.toolpaths[1].outline.dash_length, 0.1, 'dash length clamped');
  assert.strictEqual(state.toolpaths[1].outline.dash_gap, 0, 'dash gap clamped');
  assert.deepStrictEqual(state.settings, { pen_up_z: 5, pen_down_z: -1, draw_feed: 2000, z_feed: 1, tolerance_mm: 0.001 }, 'settings clamped, equal pen Z -> defaults: ' + JSON.stringify(state.settings));
  assert.deepStrictEqual(sanitizeDoc(null), { w: 200, h: 200 });
}
console.log('penplotter-validation: ok');
