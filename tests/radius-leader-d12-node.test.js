// tests/radius-leader-d12-node.test.js -- D-12 (TASK 1010, BUG-131, NOT REPRODUCED): a radius dimension's leader line does not run into
// its "R 18" text. The audit's check (the leader's bounding box overlaps the rotated text's bounding box) is a false positive for a
// diagonal leader; against the text's real rotated box the leader ends DIM_TEXT_GAP_PX clear of it. This test pins that.
import assert from 'node:assert';
import { docOf, openDoc } from './helpers/display-1010.js';
import { dimTextWidth, DIM_TEXT_ASCENT } from '#ui/dim-placement.js';

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
  // the text's own box: it sits ABOVE its baseline point (x, y) by the font ascent, turned by its rotate()
  const m = /rotate\(([-\d.e]+)/.exec(text.getAttribute('transform') || '');
  const rot = (m ? +m[1] : 0) * Math.PI / 180, fontPx = +text.getAttribute('font-size');
  const hw = dimTextWidth(text.textContent, fontPx) / 2, hh = fontPx * DIM_TEXT_ASCENT / 2;
  const nx = Math.sin(rot), ny = -Math.cos(rot);
  const cx = +text.getAttribute('x') + nx * hh, cy = +text.getAttribute('y') + ny * hh;
  const ex = +leader.getAttribute('x2') - cx, ey = +leader.getAttribute('y2') - cy;
  const along = ex * Math.cos(rot) + ey * Math.sin(rot), across = ex * nx + ey * ny;
  const clear = Math.max(Math.abs(along) - hw, Math.abs(across) - hh);
  console.log(`leader end vs the text box: along=${along.toFixed(3)} across=${across.toFixed(3)} half box ${hw.toFixed(3)} x ${hh.toFixed(3)}; clear by ${clear.toFixed(3)} world units`);
  assert.ok(clear > 0, `the leader ends outside the text box (clear by ${clear})`);
  console.log('PASS radius-leader-d12-node');
} finally { await app.close(); }
