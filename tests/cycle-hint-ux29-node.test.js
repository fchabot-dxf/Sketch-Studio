// tests/cycle-hint-ux29-node.test.js -- UX-29 (TASK 1010, BUG-135): a name that reads itself ("d1 * 2" typed into d1) is refused with
// a plain sentence, never the bare one-item cycle "d1 -> d1"; a real loop through several names still shows its path.
import assert from 'node:assert';
import { planChange } from '#core/parameters.js';

const D = (name, value) => ({ type: 'distance', joints: ['a', 'b'], value, name, isDriven: false, driven: false });
const state = { parameters: [], constraints: [D('d1', 40), D('d2', 20)] };

const self = planChange(state, { type: 'setDimension', name: 'd1', text: 'd1 * 2' });
console.log('self ->', JSON.stringify(self.message));
assert.strictEqual(self.code, 'CYCLE');
assert.strictEqual(self.message, 'd1 refers to itself', 'one item: no "d1 -> d1"');

const withD2 = planChange({ parameters: [], constraints: [D('d1', 40), { ...D('d2', 20), expression: 'd1 / 2' }] }, { type: 'setDimension', name: 'd1', text: 'd2 * 2' });
console.log('loop ->', JSON.stringify(withD2.message));
assert.strictEqual(withD2.code, 'CYCLE');
assert.ok(/d1 -> d2 -> d1/.test(withD2.message), 'a loop through two names still names the path');
console.log('PASS cycle-hint-ux29-node');
