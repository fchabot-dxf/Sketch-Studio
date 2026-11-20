// tests/op-paths-817-corpus-1-node.test.js — TASK 817: part 1 of 6 of the paths corpus (tests/helpers/paths-817-corpus.js: every 6th case of tests/fixtures/opfirst/):
// the paths and the files a REAL worker thread generates (the page's paths worker) = the main thread's derivation = the baseline frozen before S1.
import { runPathsCorpus } from './helpers/paths-817-corpus.js';

const { checks, items, files } = await runPathsCorpus(0, 6);
console.log(`op-paths-817-corpus-1-node: ${checks} checks passed (${items} memberships, ${files} files)`);
