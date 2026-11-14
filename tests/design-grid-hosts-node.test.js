// tests/design-grid-hosts-node.test.js - TASK 629 (G2): the shared canvas grid (#ui/canvas-grid.js) is on in Pen Plotter's and Trace's Design canvas.
// Pen Plotter keeps its paper rectangle but draws no 10 mm grid of its own over/under it (one grid, the shared one). Trace's mount declares grid: true.
import assert from 'node:assert';
import fs from 'node:fs';
import { open } from './helpers/node-app.js';
import { paperGridMarkup } from '../apps/penplotter/src/paper-grid.js';

assert(/mountSketch\(svgEl,\s*\{[^}]*grid:\s*true/.test(fs.readFileSync(new URL('../apps/trace/src/edit-view.js', import.meta.url), 'utf8')), 'Trace mounts its Design canvas with the shared grid');

const doc = { w: 100, h: 60 };
assert(/<rect /.test(paperGridMarkup(doc, { grid: false })) && !/<line /.test(paperGridMarkup(doc, { grid: false })), 'paper without its own grid');
assert(/<line /.test(paperGridMarkup(doc)), 'the plotter canvas keeps its paper grid');

const app = await open({ host: 'penplotter' });
try {
  const grid = app.svg.querySelector('#infinite-grid');
  assert(grid, 'Pen Plotter Design: the shared grid is in the canvas');
  const paper = app.document.getElementById('design-paper');
  assert(paper.querySelector('rect') && !paper.querySelector('line'), 'the paper rectangle stays, with no grid of its own');
  console.log('PASS design grid hosts');
} finally { await app.close(); }
process.exit(0);
