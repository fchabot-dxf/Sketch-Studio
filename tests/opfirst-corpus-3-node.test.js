// tests/opfirst-corpus-3-node.test.js — TASK S1: part 3 of 3 of the operation-first migration corpus (tests/helpers/opfirst-corpus.js: every 3rd case of
// tests/fixtures/opfirst/, loaded through applyShaperDoc and measured against the baseline frozen on origin/main c5d4bb1).
import { runCorpus } from './helpers/opfirst-corpus.js';

const { checks } = await runCorpus(2, 3);
console.log(`opfirst-corpus-3-node: ${checks} checks passed`);
