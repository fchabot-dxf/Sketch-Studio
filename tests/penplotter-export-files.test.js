// tests/penplotter-export-files.test.js — TASK 482: the Export tab's "Files: One per pen | One per toolpath".
// The per-toolpath output is byte-identical to the pre-482 export (golden captured from main, WRITE_GOLDEN=1 regenerates
// it from the per-toolpath entries); the per-pen output joins each pen's toolpath bodies under ONE preamble/postamble.
import assert from 'node:assert';
import fs from 'node:fs';
import { state, initLayers, makeToolpath, makePlotColor } from '../apps/penplotter/src/state.js';
import { buildGcodeEntries, exportSummary } from '../apps/penplotter/src/export.js';
import { renderGcode } from '#core/plot/index.js';
import { capturePlotterDoc, applyPlotterDoc } from '../apps/penplotter/src/plotter-doc.js';

const GOLDEN = new URL('./fixtures/penplotter-export-per-toolpath.json', import.meta.url);

initLayers();
state.doc = { w: 200, h: 200 };
state.coreSketch = null;
const pens = ['Red', 'Blue Fine', 'Green', 'Black'].map((n, i) => makePlotColor(n, ['#ff0000', '#0000ff', '#00ff00', '#000000'][i]));
state.plotColors = pens;
const box = (x, y) => [[x, y], [x + 20, y], [x + 20, y + 20], [x, y + 20], [x, y]];
state.artLayers = [{
  id: 'al', name: 'L', visible: true,
  shapes: pens.map((p, i) => ({ id: 's' + i, type: 'polyline', points: box(10 + i * 40, 20) })),
}];
const mk = (name, type, i, pen) => {
  const tp = makeToolpath(name, type, 'al'); tp.targetShapeIds = ['s' + i]; tp.plotColorId = pen.id;
  if (type === 'fill') tp.fill = { pattern: 'zigzag', angle: 0, spacing: 4, offset: 0 };
  return tp;
};
state.toolpaths = [
  mk('Red outline', 'outline', 0, pens[0]),
  mk('Blue outline', 'outline', 1, pens[1]),
  mk('Green outline', 'outline', 2, pens[2]),
  mk('Black outline', 'outline', 3, pens[3]),
  mk('Black fill', 'fill', 3, pens[3]),
];

// per-toolpath = today's output, byte for byte
state.settings.export_files = 'toolpath';
const perTp = buildGcodeEntries();
if (process.env.WRITE_GOLDEN) fs.writeFileSync(GOLDEN, JSON.stringify(perTp, null, 1));
assert.deepStrictEqual(perTp, JSON.parse(fs.readFileSync(GOLDEN, 'utf8')), 'per-toolpath output equals the main golden');
assert.strictEqual(perTp.length, 5);

// per pen (the default)
state.settings.export_files = 'pen';
const perPen = buildGcodeEntries();
assert.deepStrictEqual(perPen.map(e => e.name), ['1_Red.gcode', '2_Blue_Fine.gcode', '3_Green.gcode', '4_Black.gcode']);
const black = perPen[3].content;
const count = (s, sub) => s.split(sub).length - 1;
assert.strictEqual(count(black, '(--- DDCS pen plotter program ---)'), 1, 'ONE preamble');
assert.strictEqual(count(black, 'M30'), 1, 'ONE postamble');
const iOut = black.indexOf('(--- Black outline ---)'), iFill = black.indexOf('(--- Black fill ---)');
assert(iOut > 0 && iFill > iOut, 'both bodies, in panel order');
// the per-pen file is the per-toolpath bodies joined under one header / footer
const a = perTp[3].content, b = perTp[4].content;
const head = a.slice(0, a.indexOf('(--- Black outline'));
const foot = renderGcode([], { docH: 200, penUpZ: 5, penDownZ: -1, drawFeed: 2000, zFeed: 1000 }).slice(head.length);
assert(a.endsWith(foot) && b.endsWith(foot) && b.startsWith(head), 'header/footer located');
assert.strictEqual(black, a.slice(0, a.length - foot.length) + b.slice(head.length), 'per-pen file = bodies joined');
// a pen-less toolpath goes to no-pen
state.toolpaths.push((() => { const tp = mk('Loose', 'outline', 0, pens[0]); delete tp.plotColorId; return tp; })());
assert.strictEqual(buildGcodeEntries().at(-1).name, '5_no-pen.gcode');
state.toolpaths.pop();

// persistence + default + garbage
{
  const doc = JSON.parse(JSON.stringify(capturePlotterDoc()));
  assert.strictEqual(doc.settings.export_files, 'pen');
  doc.settings.export_files = 'toolpath';
  applyPlotterDoc(doc);
  assert.strictEqual(state.settings.export_files, 'toolpath', 'the choice persists in the sidecar');
  doc.settings.export_files = 'nonsense';
  applyPlotterDoc(doc);
  assert.strictEqual(state.settings.export_files, 'pen', 'an unknown value falls back to the default');
  delete doc.settings.export_files;
  applyPlotterDoc(doc);
  assert.strictEqual(state.settings.export_files, 'pen', 'an old document defaults to one per pen');
}

// the toast
state.settings.export_files = 'pen';
assert.strictEqual(exportSummary(4), 'Exported 4 G-code files (one per pen) → plotter_gcode.zip');
state.settings.export_files = 'toolpath';
assert.strictEqual(exportSummary(1), 'Exported 1 G-code file (one per toolpath) → plotter_gcode.zip');

console.log('penplotter-export-files.test.js: all assertions passed');
