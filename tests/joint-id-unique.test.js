// tests/joint-id-unique.test.js (task 564): joint ids never repeat within a session, even across engine.init().
(async () => {
  const { createEngine } = await import('#core/constraint-solver.js');
  const seen = new Set();
  const engines = [createEngine(), createEngine()];
  for (let k = 0; k < 50; k++) {
    const e = engines[k % 2];
    e.init();
    for (let i = 0; i < 200; i++) seen.add(e.genJ());
  }
  if (seen.size !== 10000) throw new Error('joint ids repeated: ' + seen.size + ' unique of 10000');
  console.log('10000 joint ids across 50 init() calls, all unique');
})();
