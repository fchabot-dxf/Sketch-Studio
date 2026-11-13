// tests/draw-undo-lines-node.test.js — TASK 569 (node port of tests/draw-undo-live-lines.test.js = draw-undo-runner.js, HOST sketchstudio,
// ONLY 'line empty-to-empty,line from existing point,chain of 3 lines,fillet'; TASK 549): one drawn line = ONE undo step (empty-to-empty,
// from an existing point); a chain of 3 lines = three steps with no orphan point; a fillet = one step. SketchStudio through
// tests/helpers/node-app.js: ribbon tool buttons, the canvas's pointer listeners, Ctrl+Z / Ctrl+Y / Esc / Enter on the keyboard; every
// document is the stored design after the page-hide autosave (as the browser test read it).

import { open, createProfile, createNamedDesign } from './helpers/node-app.js';

let failed = null;
const profile = await createProfile();
await createNamedDesign(profile, 'sketchstudio'); // TASK 558: only a NAMED design autosaves (this test reads the autosave); the page load restores it
const app = await open({ host: 'sketchstudio', profile });
try {
  const click = (x, y) => app.click(x, y);
  const { esc, enter } = app;
  const undoKey = () => app.undo();
  const redoKey = () => app.redo();
  const tool = (name) => app.tool(name);
  // presentation noise that Undo/Redo legitimately re-stamps (not geometry): __visible, glyphPos, key order, the origin's sketchId
  const sortKeys = (o) => Array.isArray(o) ? o.map(sortKeys) : (o && typeof o === 'object') ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeys(o[k])])) : o;
  const norm = (d) => ({ shapes: d.shapes, joints: (Array.isArray(d.joints) ? d.joints : Object.entries(d.joints).map(([k, v]) => [k, v])).map(([k, v]) => { if (k !== 'j_origin') return [k, v]; const { sketchId, ...r } = v; return [k, r]; }), constraints: d.constraints.map((c) => { const { __visible, glyphPos, ...r } = c; return sortKeys(r); }) });
  // JSON round trip: the browser test got the document back as JSON text from the page
  const readDoc = async () => { const d = await app.storedDoc(); return norm(JSON.parse(JSON.stringify({ shapes: d.geometry.shapes, constraints: d.geometry.constraints, joints: d.geometry.joints }))); };
  const o = app.toScreen(0, 0);
  const P = (dx, dy) => ({ x: o.x + dx, y: o.y + dy });
  const clicks = (...pts) => { for (const p of pts) click(p.x, p.y); };

  // ---- document helpers (verbatim from draw-undo-runner.js)
  const jmap = (d) => { const out = {}; const jo = d.joints; for (const e of (Array.isArray(jo) ? jo : Object.entries(jo))) { if (Array.isArray(e)) out[e[0]] = e[1]; else out[e.id] = e; } return out; };
  const canon = (d) => JSON.stringify({ j: Object.entries(jmap(d)).sort((a, b) => a[0] < b[0] ? -1 : 1), s: d.shapes, c: d.constraints.map((c) => JSON.stringify(c)).sort() });
  const orphans = (d, before) => { const was = before ? new Set(orphansRaw(before)) : new Set(); return orphansRaw(d).filter((j) => !was.has(j)); };
  const orphansRaw = (d) => { const used = new Set(); for (const s of d.shapes) for (const j of (s.joints || [])) used.add(j); return Object.keys(jmap(d)).filter((j) => j !== 'j_origin' && !used.has(j)); };
  const sum = (d) => `j${Object.keys(jmap(d)).length} s${d.shapes.length} c${d.constraints.length}`;
  const diff = (a, b) => {
    const ja = jmap(a), jb = jmap(b); const ca = new Set(a.constraints.map((c) => JSON.stringify(c))), cb = new Set(b.constraints.map((c) => JSON.stringify(c)));
    const sa = new Set(a.shapes.map((s) => s.id)), sb = new Set(b.shapes.map((s) => s.id));
    return { joints: Object.keys(jb).length - Object.keys(ja).length, shapes: sb.size - sa.size, constraints: cb.size - ca.size };
  };
  const why = (a, b) => { const ja = jmap(a), jb = jmap(b); const out = []; for (const k of new Set([...Object.keys(ja), ...Object.keys(jb)])) if (JSON.stringify(ja[k]) !== JSON.stringify(jb[k])) out.push('joint ' + k + ' ' + JSON.stringify(ja[k]) + ' -> ' + JSON.stringify(jb[k])); const sa = new Map(a.shapes.map((x) => [x.id, JSON.stringify(x)])), sb = new Map(b.shapes.map((x) => [x.id, JSON.stringify(x)])); for (const k of new Set([...sa.keys(), ...sb.keys()])) if (sa.get(k) !== sb.get(k)) out.push('shape ' + k + ' ' + sa.get(k) + ' -> ' + sb.get(k)); const ca = new Set(a.constraints.map((c) => JSON.stringify(c))), cb = new Set(b.constraints.map((c) => JSON.stringify(c))); for (const c of ca) if (!cb.has(c)) out.push('constraint only before: ' + c); for (const c of cb) if (!ca.has(c)) out.push('constraint only after: ' + c); return out.slice(0, 6); };

  const rows = [];
  const measure = async (name, draw) => {
    const d0 = await readDoc();
    await draw();
    const d1 = await readDoc();
    undoKey(); const d2 = await readDoc();
    redoKey(); const d3 = await readDoc();
    const row = {
      name, drawn: sum(d1), pre: sum(d0), afterUndo: sum(d2),
      undoLeft: diff(d0, d2), undoExact: canon(d2) === canon(d0), orphansAfterUndo: orphans(d2, d0),
      redoExact: canon(d3) === canon(d1), made: diff(d0, d1),
    };
    if (!row.undoExact) row.undoDiff = why(d0, d2);
    if (!row.redoExact) row.redoDiff = why(d1, d3);
    rows.push(row);
    console.log(`ROW ${name.padEnd(24)} drew ${JSON.stringify(row.made)} ${row.undoDiff ? 'UNDODIFF ' + JSON.stringify(row.undoDiff) : ''} ${row.redoDiff ? 'REDODIFF ' + JSON.stringify(row.redoDiff) : ''} | after ONE Ctrl+Z left ${JSON.stringify(row.undoLeft)} exact=${row.undoExact} orphans=${JSON.stringify(row.orphansAfterUndo)} | Ctrl+Y exact=${row.redoExact}`);
    return { d0, d1, d2, d3, row };
  };
  const results = {};
  const asserts = [];
  const want = (name, cond, msg) => { if (!results[name]) return; if (!cond(results[name])) asserts.push(`${name}: ${msg}; got ${JSON.stringify(results[name].row)}`); };
  const run = async (name, toolName, draw) => { tool(toolName); results[name] = await measure(name, draw); };

  await run('line empty-to-empty', 'line', async () => { clicks(P(-300, -300), P(-150, -300)); esc(); });
  await run('line from existing point', 'line', async () => { clicks(P(-150, -300), P(-150, -200)); esc(); });
  {
    tool('line');
    const d0 = await readDoc();
    clicks(P(40, -300), P(190, -300), P(190, -200), P(40, -200)); esc();
    const d3 = await readDoc();
    const steps = [d3];
    for (let i = 0; i < 3; i++) { undoKey(); steps.push(await readDoc()); }
    for (let i = 0; i < 3; i++) redoKey();
    const back = [null, null, await readDoc()];
    const nLines = (d) => d.shapes.filter((s) => s.type === 'line').length - d0.shapes.filter((s) => s.type === 'line').length;
    const row = { name: 'chain of 3 lines', drawn: sum(d3), pre: sum(d0), perUndo: steps.slice(1).map(sum), linesLeftAfterEachUndo: steps.slice(1).map(nLines), orphansAfterEachUndo: steps.slice(1).map((d) => orphans(d, d0)), finalExact: canon(steps[3]) === canon(d0), redoExact: canon(back[2]) === canon(d3) };
    rows.push(row); console.log('ROW chain of 3 lines       ', JSON.stringify(row));
    results['chain of 3 lines'] = { row };
    want('chain of 3 lines', (r) => JSON.stringify(r.row.linesLeftAfterEachUndo) === '[2,1,0]', 'each Ctrl+Z removes exactly one line');
    want('chain of 3 lines', (r) => r.row.orphansAfterEachUndo.every((a) => a.length === 0), 'no orphan joint after any undo');
    want('chain of 3 lines', (r) => r.row.finalExact, 'the third undo restores the pre-chain document exactly');
    want('chain of 3 lines', (r) => r.row.redoExact, 'three redos restore the chain exactly');
  }
  // fillet the chain's first corner (190,-300): the input opens, Enter applies the default radius
  await run('fillet', 'fillet', async () => {
    click(o.x + 190, o.y - 300);
    await app.waitFor(() => app.document.activeElement && app.document.activeElement.id === 'fillet-radius-input', 'the fillet radius input to take focus');
    enter();
    await app.waitFor(() => !app.document.getElementById('fillet-radius-input'), 'the fillet radius input to close');
    esc();
  });
  for (const n of ['line empty-to-empty', 'line from existing point', 'fillet']) {
    want(n, (r) => r.row.undoExact, 'one Ctrl+Z must restore the pre-draw document exactly');
    want(n, (r) => r.row.orphansAfterUndo.length === 0, 'no orphan joint after undo');
    want(n, (r) => r.row.redoExact, 'Ctrl+Y must restore the drawn element exactly');
  }
  console.log('TABLE', JSON.stringify(rows));
  if (asserts.length) failed = new Error('draw-undo-lines-node failures:\n  ' + asserts.join('\n  '));
  else console.log('draw-undo-lines-node: ok');
} catch (e) { failed = e; } finally {
  await app.close();
}
if (failed) { console.error(failed.message || failed); process.exitCode = 1; }
