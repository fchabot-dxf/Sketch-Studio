// tests/finish-allowance-766-node.test.js — TASK 766 (owner turn 2320): the pocket's "wall allowance" is the FINISH allowance (the record field finishAllowance).
// A document stored before 766 holds it as `wallAllowance`: shaper-doc.js applyShaperDoc (the one read of a stored Shaper document) renames it, so an old
// design keeps its value (and the download stays byte-identical: pocket-clearing-749 / 750-node compare the md5 of every download with their fixtures).
import assert from 'node:assert';
import { applyShaperDoc, captureShaperDoc } from '../apps/shaper/src/shaper-doc.js';
import { CUT_PLAN } from '../apps/shaper/src/cut-plan.js';

applyShaperDoc({ version: 1, cutPlan: [['loop:a', { cutType: 'pocket', clearing: 'linked', stepover: 40, wallAllowance: 0.3 }], ['loop:b', { cutType: 'pocket', clearing: 'raster', wallAllowance: 0 }], ['loop:c', { cutType: 'pocket' }]] });
assert.deepStrictEqual(CUT_PLAN.get('loop:a'), { cutType: 'pocket', clearing: 'linked', stepover: 40, finishAllowance: 0.3 }, 'an old wallAllowance is the finishAllowance');
assert.strictEqual(CUT_PLAN.get('loop:b').finishAllowance, 0, 'a 0 allowance stays 0');
assert.ok(!('finishAllowance' in CUT_PLAN.get('loop:c')) && !('wallAllowance' in CUT_PLAN.get('loop:c')), 'a record without one gets none');
assert.ok(!JSON.stringify(captureShaperDoc()).includes('wallAllowance'), 'the next save writes finishAllowance only');
applyShaperDoc({ version: 1, cutPlan: [['loop:a', { cutType: 'pocket', clearing: 'linked', finishAllowance: 0.2 }]] });
assert.strictEqual(CUT_PLAN.get('loop:a').finishAllowance, 0.2, 'a document saved after 766 reads as it is');
console.log('finish-allowance-766-node: ok');
