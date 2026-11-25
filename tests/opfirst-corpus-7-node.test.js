// tests/opfirst-corpus-7-node.test.js — TASK S1: part 7 of 12 of the operation-first migration corpus (tests/helpers/opfirst-corpus.js: every 12th case of
// tests/fixtures/opfirst/, loaded through applyShaperDoc and measured against the baseline frozen on origin/main c5d4bb1). TASK 817: 6 parts (3 before); TASK 892: 12
// parts (each of the 6 cut in two: the same cases, the same checks), so each file stays well within the gate's per-file time on a loaded machine.
import { runCorpus } from './helpers/opfirst-corpus.js';

const { checks } = await runCorpus(6, 12);
console.log(`opfirst-corpus-7-node: ${checks} checks passed`);
