// tests/opfirst-corpus-3-node.test.js — TASK S1: part 3 of 6 of the operation-first migration corpus (tests/helpers/opfirst-corpus.js: every 6th case of
// tests/fixtures/opfirst/, loaded through applyShaperDoc and measured against the baseline frozen on origin/main c5d4bb1). TASK 817: 6 parts (3 before), so each
// file stays well within the gate's per-file time on a loaded machine.
import { runCorpus } from './helpers/opfirst-corpus.js';

const { checks } = await runCorpus(2, 6);
console.log(`opfirst-corpus-3-node: ${checks} checks passed`);
