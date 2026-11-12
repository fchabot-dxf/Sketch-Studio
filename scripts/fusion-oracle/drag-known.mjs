// TASK 530 phase 2 -- regenerate tests/fixtures/fusion-oracle/drag-known.json: every cell where ours differs from Fusion (and Fusion's two runs agree), with its class and a one-line
// reason. Run after re-recording Fusion or after the app's drag changes: node scripts/fusion-oracle/drag-known.mjs. A class without an entry in REASONS is written as 'UNEXPLAINED'.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCells, compareCell } from '../../tests/harness/fusion-oracle/drag-cells.js';

const FX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/fixtures/fusion-oracle');
const BODY = 'grabbing a shape BODY: the move handler own solver spring is on the SHAPE id, so only the render-loop solve moves it, and that picks the FIRST free joint carrying dragTarget: ours stretches the shape / moves one end (circle: translates), nothing in some hold states; Fusion translates or resizes the whole body (checked in the real app: tests/fusion-drag-live.test.js)';
const ARC = 'arc joint drag: ours stretches / rotates the arc or moves a different set of its three joints (cause inside the solve not isolated); Fusion resizes, rotates or translates it';
const REASONS = {
  'line.mid': BODY, 'rect.edge': BODY, 'circle.rim': BODY, 'tangent.rim': BODY,
  'line.end': 'length-dimensioned free line grabbed by an end: Fusion drags the whole line (translate); ours rotates it (both ends move, length kept)',
  'twolines.end': 'both lengths dimensioned, corner fixed, diagonal drag: Fusion rotates the line about the corner; ours leaves it where it is',
  'tangent.lineend': 'line end of a tangent line + circle: ours moves / resizes the circle in a different set of cells than Fusion',
  'arc.end': ARC, 'arc.centre': ARC,
};
const known = {};
for (const cell of buildCells()) {
  const c = compareCell(cell, JSON.parse(fs.readFileSync(path.join(FX, 'drag-fusion.json'), 'utf8')));
  if (c.state !== 'diff') continue;
  const key = `${cell.kind}.${cell.target}`;
  known[cell.id] = { class: c.cls, reason: REASONS[key] || 'UNEXPLAINED' };
}
fs.writeFileSync(path.join(FX, 'drag-known.json'), JSON.stringify(known, null, 1));
console.log(Object.keys(known).length + ' KNOWN differences; unexplained: ' + Object.values(known).filter(k => k.reason === 'UNEXPLAINED').length);
