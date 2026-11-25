// tests/op-paths-817-corpus-7-node.test.js — TASK 817: part 3 of 9 of the paths corpus (tests/helpers/paths-817-corpus.js: every 9th case of tests/fixtures/opfirst/),
// slice 1 of 3 (TASK 892: each part in three files, its cases in order, the same checks as the part in one file, so each file stays well within the gate's per-file time):
// the paths and the files a REAL worker thread generates (the page's paths worker) = the main thread's derivation = the baseline frozen before S1.
import { runPathsCorpus } from './helpers/paths-817-corpus.js';

const { checks, items, files } = await runPathsCorpus(2, 9, 0, 3);
console.log(`op-paths-817-corpus-7-node: ${checks} checks passed (${items} memberships, ${files} files)`);
