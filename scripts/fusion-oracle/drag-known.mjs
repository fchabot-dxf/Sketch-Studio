// TASK 530 phase 2 -- regenerate tests/fixtures/fusion-oracle/drag-known.json: every cell where ours differs from Fusion (and Fusion's two runs agree), with its class and a one-line
// reason. Run after re-recording Fusion or after the app's drag changes: node scripts/fusion-oracle/drag-known.mjs. A class without an entry in REASONS is written as 'UNEXPLAINED'.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCells, compareCell } from '../../tests/harness/fusion-oracle/drag-cells.js';

const FX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/fixtures/fusion-oracle');
const BODY = 'grabbing a shape BODY: handleSelectionPointerMove passes the SHAPE id as the spring joint (state.drag.id), so no joint gets a spring and nothing moves; Fusion moves / resizes it';
const ARC = 'an arc joint drags the whole arc cluster (centre + both ends get the same dragTarget) but only the grabbed joint has a spring; ours leaves it unmoved or moves a different set (cause inside the solve not isolated), Fusion resizes / rotates / translates the arc';
const REASONS = {
  'line.mid': BODY, 'rect.edge': BODY, 'circle.rim': BODY, 'tangent.rim': BODY,
  'line.end': 'length-dimensioned free line grabbed by an end: Fusion drags the whole line (translate); ours rotates it about the other end or does not move',
  'twolines.end': 'both lengths dimensioned, corner fixed, diagonal drag: Fusion rotates the line about the corner; ours leaves it where it is',
  'tangent.lineend': 'line end of a tangent line + circle: ours moves / resizes the circle too (or nothing), Fusion keeps a different set',
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
