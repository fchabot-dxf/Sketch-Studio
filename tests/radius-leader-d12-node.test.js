// tests/radius-leader-d12-node.test.js -- D-12 (TASK 1010, BUG-131): a radius dimension's leader line stops at the edge of the
// "R 18" text instead of running into it.
import assert from 'node:assert';
import { docOf, openDoc } from './helpers/display-1010.js';
import { dimTextWidth } from '#ui/dim-placement.js';

const app = await openDoc(docOf(
  { cc: [-50, 20, true] }, [{ id: 'C1', type: 'circle', joints: ['cc'], radius: 18 }],
  [{ type: 'distance', shape: 'C1', value: 18, isRadius: true, offset: 35, labelAngle: 0.4, name: 'd1' }],
));
try {
  app.frames();
  const idx = app.state.constraints.findIndex((c) => c.name === 'd1');
  const leader = app.svg.querySelector(`line[data-constraint-idx="${idx}"]`);
  const text = app.svg.querySelector(`.dim-label[data-constraint-idx="${idx}"] text`);
  assert.ok(leader && text, 'the radius dimension draws a leader and a label');
  const m = /rotate\(([-\d.e]+)/.exec(text.getAttribute('transform') || '');
  const rot = (m ? +m[1] : 0) * Math.PI / 180, fontPx = +text.getAttribute('font-size');
  const hw = dimTextWidth(text.textContent, fontPx) / 2, hh = fontPx / 2;
  const [tx, ty] = [+text.getAttribute('x'), +text.getAttribute('y')];
  const ex = +leader.getAttribute('x2') - tx, ey = +leader.getAttribute('y2') - ty;
  const along = ex * Math.cos(rot) + ey * Math.sin(rot), across = -ex * Math.sin(rot) + ey * Math.cos(rot);
  console.log(`leader end vs text: along=${along.toFixed(2)} across=${across.toFixed(2)} (half text ${hw.toFixed(2)} x ${hh.toFixed(2)})`);
  assert.ok(Math.abs(along) >= hw * 0.95 || Math.abs(across) >= hh * 0.95, 'the leader ends at or outside the text box, not inside the text');
  console.log('PASS radius-leader-d12-node');
} finally { await app.close(); }
