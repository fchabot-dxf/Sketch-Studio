// tests/reference-lines-clipboard.test.js - TASK 539: the clipboard never copies an axis: a constraint / dimension naming ref_axis_x / ref_axis_y
// (shape form) or the reserved end joint j_ref_x / j_ref_y is a link to OUTSIDE geometry, so it is not copied; the copy carries no reserved id.
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { selectionToEnvelope } from '#ui/clipboard.js';

const S = L.newSketch();
const a = L.point(S, 10, 10), b = L.point(S, 60, 30);
const ln = L.line(S, a, b);
const lid = typeof ln === 'string' ? ln : ln.id;
const mk = (type, p) => assert(ConstraintManager.createConstraint(S.state, type, p, { source: 'test' }), type + ' created');
mk('parallel', { shapes: [lid, 'ref_axis_x'] });
mk('distance', { joints: [a, 'j_origin', 'j_ref_x'], value: 12 });
mk('pointOnLine', { joint: b, shape: 'ref_axis_y' });
mk('distance', { joints: [a, b], value: 60 });                       // an ordinary dimension of the line: travels
S.state.selectedShapes.clear(); S.state.selectedJoints.clear(); S.state.selectedShapes.add(lid);
const env = selectionToEnvelope(S.state);
assert(env, 'the line is copyable');
const text = JSON.stringify(env);
assert(!/ref_axis|j_ref_/.test(text), 'no reserved axis id in the copy: ' + text.match(/.{20}(ref_axis|j_ref_).{20}/));
const cs = env.document.geometry.constraints;
assert(cs.length === 1 && cs[0].type === 'distance' && cs[0].joints.length === 2, 'only the ordinary dimension travels; got ' + JSON.stringify(cs));
console.log('reference-lines-clipboard OK');
