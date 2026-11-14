// tests/snap-release-distance-node.test.js — TASK 637: with the defaults a snap grabs at 10 px (SNAP_MAGNETISM) and a held lock releases at 32 px
// (SNAP_MAGNETISM x SNAP_RELEASE_MULT, one source in solver-config), farther than the joint reach (30 px) so the release-slip band exists.
import assert from 'node:assert';
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.document = { head: { appendChild() {} }, getElementById: () => null, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) };

const { getMagnetThreshold } = await import('../packages/ui/snap-magnet.js');
const { SNAP } = await import('../packages/core/constants.js');

assert.strictEqual(getMagnetThreshold('snap'), 10, 'the lock (grab) distance is 10');
assert.strictEqual(getMagnetThreshold('snap', true), 32, 'the held-lock release distance is 32');
assert(SNAP.JOINT_PX < getMagnetThreshold('snap', true), 'the joint reach is inside the release distance');
console.log('snap-release-distance-node: ok');
