// TASK 508 -- compare the rebuilt trapezoid with the owner's real sketch (tests/fixtures/owner-trapezoid.document.json).
import { readFileSync } from 'node:fs';
import * as L from './lib.js';
import { deserializeDocument } from '#core/document.js';

const tally = (cs) => { const m = {}; for (const c of cs) { const k = c.type + (c.isRadius ? '(R)' : '') + (L.isDriven(c) ? '[ref]' : ''); m[k] = (m[k] || 0) + 1; } return m; };

// Loads the fixture as saved (top-width dimension a REFERENCE) and with that dimension made driving.
export function compareWithFixture(R) {
  const doc = JSON.parse(readFileSync(new URL('../../fixtures/owner-trapezoid.document.json', import.meta.url), 'utf8'));
  const out = { mine: { constraints: R.C.constraints, joints: R.C.joints, types: tally(R.S.state.constraints) } };
  for (const driving of [false, true]) {
    const S = L.newSketch();
    const d = JSON.parse(JSON.stringify(doc));
    const last = d.geometry.constraints[d.geometry.constraints.length - 1];
    if (driving) { last.isDriven = false; last.driven = false; }
    if (!deserializeDocument(d, S.state).ok) throw new Error('fixture does not load');
    S.engine.solve(500);
    out[driving ? 'fixtureDriving' : 'fixtureAsSaved'] = { constraints: S.state.constraints.length, joints: S.state.joints.size, nullity: L.nullity(S), fdNullity: L.fdJacobian(S).nullity, types: tally(S.state.constraints) };
  }
  return out;
}
