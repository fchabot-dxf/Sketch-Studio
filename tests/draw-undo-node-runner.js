// tests/draw-undo-node-runner.js - TASK 576 (node port of tests/draw-undo-runner.js, TASK 549): NOT a test file itself; draw-undo-*-node.test.js
// each set HOST and ONLY and import it. One drawn element = ONE undo step: Ctrl+Z restores EXACTLY the pre-draw document, Ctrl+Y restores
// EXACTLY the drawn one. Through tests/helpers/node-app.js: ribbon tool buttons, the canvas's pointer listeners, Ctrl+Z / Ctrl+Y / Esc /
// Enter on the keyboard. SketchStudio documents are the stored design after the page-hide autosave (as the browser test read them);
// Shaper's are read from the live state (as the browser test did through window.__designController). Same scenarios, same offsets
// from the origin, same asserts as the browser runner; the only dropped line is its "the click is on the canvas" guard (events here are
// dispatched ON the canvas, so they cannot land on a panel).

import { open, createProfile, createNamedDesign } from './helpers/node-app.js';

const HOST = process.env.HOST || 'sketchstudio';
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;

let failed = null;
const profile = await createProfile();
if (HOST !== 'shaper') await createNamedDesign(profile, 'sketchstudio'); // TASK 558: only a NAMED design autosaves (this test reads the autosave)
const app = await open({ host: HOST, profile });
try {
  const click = (x, y) => app.click(x, y);
  const move = (x, y) => app.move(x, y);
  const esc = () => app.esc();
  const enter = () => app.enter();
  const undoKey = () => app.undo();
  const redoKey = () => app.redo();
  const tool = (name) => app.tool(name);
  // presentation noise that Undo/Redo legitimately re-stamps (not geometry): __visible, glyphPos, key order, the origin's sketchId
  const sortKeys = (o) => Array.isArray(o) ? o.map(sortKeys) : (o && typeof o === 'object') ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeys(o[k])])) : o;
  const norm = (d) => ({ shapes: d.shapes, joints: (Array.isArray(d.joints) ? d.joints : Object.entries(d.joints).map(([k, v]) => [k, v])).map(([k, v]) => { if (k !== 'j_origin') return [k, v]; const { sketchId, ...r } = v; return [k, r]; }), constraints: d.constraints.map((c) => { const { __visible, glyphPos, ...r } = c; return sortKeys(r); }) });
  const readDocRaw = async () => {
    if (HOST === 'shaper') { const s = app.state; return JSON.parse(JSON.stringify({ shapes: s.shapes, constraints: s.constraints, joints: [...s.joints.entries()] })); }
    const d = await app.storedDoc();
    return JSON.parse(JSON.stringify({ shapes: d.geometry.shapes, constraints: d.geometry.constraints, joints: d.geometry.joints })); // the browser test got JSON text
  };
  const readDoc = async () => norm(await readDocRaw());
  // the undo stack itself, so "no undo step" and the journal labels are asserted directly (Shaper only, as in the browser runner)
  const histLabels = () => HOST === 'shaper' ? app.state.history.map((h) => h.label) : null;
  const o = app.toScreen(0, 0);
  const P = (dx, dy) => ({ x: o.x + dx, y: o.y + dy });
  const clicks = (...pts) => { for (const p of pts) click(p.x, p.y); };

  // ---- document helpers (verbatim from draw-undo-runner.js)
  const jmap = (d) => { const out = {}; const jo = d.joints; for (const e of (Array.isArray(jo) ? jo : Object.entries(jo))) { if (Array.isArray(e)) out[e[0]] = e[1]; else out[e.id] = e; } return out; };
  const canon = (d) => JSON.stringify({ j: Object.entries(jmap(d)).sort((a, b) => a[0] < b[0] ? -1 : 1), s: d.shapes, c: d.constraints.map((c) => JSON.stringify(c)).sort() });
  const orphansRaw = (d) => { const used = new Set(); for (const s of d.shapes) for (const j of (s.joints || [])) used.add(j); return Object.keys(jmap(d)).filter((j) => j !== 'j_origin' && !used.has(j)); };
  const orphans = (d, before) => { const was = before ? new Set(orphansRaw(before)) : new Set(); return orphansRaw(d).filter((j) => !was.has(j)); };
  const sum = (d) => `j${Object.keys(jmap(d)).length} s${d.shapes.length} c${d.constraints.length}`;
  const diff = (a, b) => {
    const ja = jmap(a), jb = jmap(b); const ca = new Set(a.constraints.map((c) => JSON.stringify(c))), cb = new Set(b.constraints.map((c) => JSON.stringify(c)));
    const sa = new Set(a.shapes.map((s) => s.id)), sb = new Set(b.shapes.map((s) => s.id));
    return { joints: Object.keys(jb).length - Object.keys(ja).length, shapes: sb.size - sa.size, constraints: cb.size - ca.size };
  };
  const why = (a, b) => { const ja = jmap(a), jb = jmap(b); const out = []; for (const k of new Set([...Object.keys(ja), ...Object.keys(jb)])) if (JSON.stringify(ja[k]) !== JSON.stringify(jb[k])) out.push('joint ' + k + ' ' + JSON.stringify(ja[k]) + ' -> ' + JSON.stringify(jb[k])); const sa = new Map(a.shapes.map((x) => [x.id, JSON.stringify(x)])), sb = new Map(b.shapes.map((x) => [x.id, JSON.stringify(x)])); for (const k of new Set([...sa.keys(), ...sb.keys()])) if (sa.get(k) !== sb.get(k)) out.push('shape ' + k + ' ' + sa.get(k) + ' -> ' + sb.get(k)); const ca = new Set(a.constraints.map((c) => JSON.stringify(c))), cb = new Set(b.constraints.map((c) => JSON.stringify(c))); for (const c of ca) if (!cb.has(c)) out.push('constraint only before: ' + c); for (const c of cb) if (!ca.has(c)) out.push('constraint only after: ' + c); return out.slice(0, 6); };

  const rows = [];
  // ONE scenario: draw (+ finish), then Ctrl+Z once, then Ctrl+Y once; record what each leaves.
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
  const run = async (name, toolName, draw) => { if (only && !only.includes(name)) return; tool(toolName); results[name] = await measure(name, draw); }; // Esc ends the draw AND switches to Select, so each scenario picks its tool

  await run('line empty-to-empty', 'line', async () => { clicks(P(-300, -300), P(-150, -300)); esc(); });
  await run('line from existing point', 'line', async () => { clicks(P(-150, -300), P(-150, -200)); esc(); });
  // chain of 3 lines (4 clicks) then finish; each undo must remove exactly one segment and leave no orphan
  if (!only || only.includes('chain of 3 lines')) {
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
  await run('rect', 'rect', async () => { clicks(P(250, -300), P(350, -200)); esc(); });
  await run('circle', 'circle', async () => { clicks(P(-300, 100), P(-240, 100)); esc(); });
  await run('arc', 'arc', async () => { clicks(P(-100, 150), P(-40, 150), P(-100, 90)); esc(); });
  await run('polygon', 'polygon', async () => { clicks(P(150, 150), P(210, 170)); esc(); });
  await run('bezier', 'bezier', async () => { clicks(P(260, 100), P(320, 180), P(380, 100)); enter(); esc(); });
  // fillet the chain's first corner (190,-300): the input opens, Enter applies the default radius
  await run('fillet', 'fillet', async () => {
    click(o.x + 190, o.y - 300);
    await app.waitFor(() => app.document.activeElement && app.document.activeElement.id === 'fillet-radius-input', 'the fillet radius input to take focus');
    enter();
    await app.waitFor(() => !app.document.getElementById('fillet-radius-input'), 'the fillet radius input to close');
    esc();
  });
  if (HOST === 'shaper' && !only) { // the journal (packages/core/journal.js) names each step by the tool that made it
    const labels = histLabels();
    for (const t of ['line', 'rect', 'circle', 'arc', 'polygon', 'bezier', 'fillet']) if (!labels.includes(t)) asserts.push('journal label ' + t + ' missing; history labels: ' + JSON.stringify(labels));
    console.log('LABELS', JSON.stringify(labels));
  }
  // Cancelled draws (Esc, or picking another tool) mid-draw: nothing is left, NO undo step was taken (the Ctrl+Z after it undoes the
  // PREVIOUS element, not the cancelled one) and Ctrl+Y brings that previous element back.
  const MID = {
    line: () => { click(o.x - 380, o.y + 200); move(o.x - 300, o.y + 200); },
    rect: () => { click(o.x - 380, o.y + 200); move(o.x - 300, o.y + 250); },
    circle: () => { click(o.x - 380, o.y + 200); move(o.x - 330, o.y + 200); },
    arc: () => { click(o.x - 380, o.y + 200); click(o.x - 320, o.y + 200); move(o.x - 380, o.y + 140); },
    polygon: () => { click(o.x - 380, o.y + 200); move(o.x - 330, o.y + 220); },
    bezier: () => { click(o.x - 380, o.y + 200); move(o.x - 330, o.y + 230); },
  };
  if (only && [...only].some((n) => /^(esc|switch tool) mid-/.test(n))) { // a baseline element, so "the previous step" exists when this file runs on its own
    tool('circle'); clicks(P(300, 150), P(340, 150)); esc();
  }
  for (const how of ['esc', 'switch tool']) {
    for (const t of Object.keys(MID)) {
      const name = how + ' mid-' + t;
      if (only && !only.includes(name)) continue;
      tool(t);
      const d0 = await readDoc();
      const h0 = histLabels();
      MID[t]();
      if (how === 'esc') esc(); else tool('select');
      const d1 = await readDoc();
      const h1 = histLabels();
      tool('select');
      undoKey(); const d2 = await readDoc();
      redoKey(); const d3 = await readDoc();
      const row = { name, leftBy: diff(d0, d1), exact: canon(d1) === canon(d0), orphans: orphans(d1, d0), undoIsPreviousStep: canon(d2) !== canon(d0), redoBack: canon(d3) === canon(d0) };
      if (h0) { row.historyBefore = h0.length; row.historyAfterCancel = h1.length; }
      rows.push(row); console.log('ROW ' + name.padEnd(26), JSON.stringify(row));
      results[name] = { row };
      want(name, (r) => r.row.exact, 'the cancelled draw leaves the document unchanged (no orphan start point)');
      want(name, (r) => r.row.undoIsPreviousStep, 'Ctrl+Z after a cancelled draw undoes the PREVIOUS element (no step for the cancelled one)');
      want(name, (r) => r.row.historyBefore === undefined || r.row.historyBefore === r.row.historyAfterCancel, 'a cancelled draw leaves the undo stack exactly as it was');
      want(name, (r) => r.row.redoBack, 'Ctrl+Y after that brings the previous element back');
    }
  }
  // LINE_CHAIN_UNDO = 'per-tool-session' (the declared switch, packages/core/settings-manager.js): the WHOLE chain is ONE step
  if (!only || only.includes('chain per-tool-session')) {
    const settings = (await import('#core/settings-manager.js')).default;
    settings.set('LINE_CHAIN_UNDO', 'per-tool-session');
    tool('line');
    const d0 = await readDoc();
    // starts ON an existing point (the end of the first line scenario, world (-150,-300) -> screen offset (-150,-300)), then 3 lines
    clicks(P(-150, -300), P(-100, 50), P(-20, 20), P(-60, -60)); esc();
    const d3 = await readDoc();
    undoKey(); const d1 = await readDoc();
    redoKey(); const dr = await readDoc();
    const keptPts = Object.keys(jmap(d0)).every((k) => k in jmap(d1));
    const row = { name: 'chain per-tool-session', drawn: diff(d0, d3), afterOneUndo: diff(d0, d1), exact: canon(d1) === canon(d0), orphans: orphans(d1, d0), existingPointsKept: keptPts, redoExact: canon(dr) === canon(d3), linesDrawn: d3.shapes.filter((x) => x.type === 'line').length - d0.shapes.filter((x) => x.type === 'line').length };
    rows.push(row); console.log('ROW chain per-tool-session  ', JSON.stringify(row));
    results['chain per-tool-session'] = { row };
    settings.set('LINE_CHAIN_UNDO', 'per-segment');
    want('chain per-tool-session', (r) => r.row.linesDrawn === 3, 'a 3-line chain was drawn');
    want('chain per-tool-session', (r) => r.row.exact && r.row.orphans.length === 0, 'ONE Ctrl+Z removes all three lines and their new points (the pre-chain document exactly)');
    want('chain per-tool-session', (r) => r.row.existingPointsKept, 'none of the pre-existing points is removed');
    want('chain per-tool-session', (r) => r.row.redoExact, 'ONE Ctrl+Y restores the whole chain exactly');
  }
  // Fusion, measured (task 551): Ctrl+Z while the Line tool is still active (2 segments drawn) removes NOTHING, it ENDS the tool;
  // then each Ctrl+Z removes one segment (and its new end point), one per press.
  if (!only || only.includes('ctrl+z while line active')) {
    tool('line');
    const d0 = await readDoc();
    const nl = (d) => d.shapes.filter((x) => x.type === 'line').length - d0.shapes.filter((x) => x.type === 'line').length;
    clicks(P(-380, -100), P(-300, -100), P(-300, -30)); // two committed segments, the third start floating
    undoKey(); const a = await readDoc();
    const toolAfter = app.state.currentTool; // the browser read the ribbon's .active button (tool-line); that highlight is the host's panelTick (page hook), so the state it mirrors is read
    undoKey(); const b = await readDoc();
    undoKey(); const c = await readDoc();
    const row = { name: 'ctrl+z while line active', linesAfterFirstUndo: nl(a), orphansAfterFirstUndo: orphans(a, d0), toolAfterFirstUndo: toolAfter, linesAfterSecond: nl(b), orphansAfterSecond: orphans(b, d0), linesAfterThird: nl(c), exactAfterThird: canon(c) === canon(d0) };
    rows.push(row); console.log('ROW ctrl+z while line active', JSON.stringify(row));
    results['ctrl+z while line active'] = { row };
    want('ctrl+z while line active', (r) => r.row.linesAfterFirstUndo === 2, 'the first Ctrl+Z while drawing removes no committed segment');
    want('ctrl+z while line active', (r) => r.row.orphansAfterFirstUndo.length === 0 && r.row.toolAfterFirstUndo !== 'line', 'the first Ctrl+Z ends the tool and leaves no floating start point');
    want('ctrl+z while line active', (r) => r.row.linesAfterSecond === 1 && r.row.orphansAfterSecond.length === 0, 'the second Ctrl+Z removes one segment and its new end point only');
    want('ctrl+z while line active', (r) => r.row.linesAfterThird === 0 && r.row.exactAfterThird, 'the third Ctrl+Z restores the pre-chain document exactly');
  }
  for (const n of ['line empty-to-empty', 'line from existing point', 'rect', 'circle', 'arc', 'polygon', 'bezier', 'fillet']) {
    want(n, (r) => r.row.undoExact, 'one Ctrl+Z must restore the pre-draw document exactly');
    want(n, (r) => r.row.orphansAfterUndo.length === 0, 'no orphan joint after undo');
    want(n, (r) => r.row.redoExact, 'Ctrl+Y must restore the drawn element exactly');
  }
  console.log('TABLE', JSON.stringify(rows));
  if (!rows.length) asserts.push('no scenario ran (ONLY=' + process.env.ONLY + ')');
  if (asserts.length) failed = new Error('draw-undo (' + HOST + ') failures:\n  ' + asserts.join('\n  '));
  else console.log('draw-undo-node ' + HOST + ': ok');
} catch (e) { failed = e; } finally {
  await app.close();
}
if (failed) { console.error(failed.message || failed); process.exitCode = 1; }
