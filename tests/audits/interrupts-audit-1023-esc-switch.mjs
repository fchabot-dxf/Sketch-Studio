// tests/audits/interrupts-audit-1023-esc-switch.mjs — TASK 1023 (AUDIT ONLY, outside the gate)
// Part 1 of Tool Interruptions Matrix: Esc, Switch tool (ribbon click + shortcut key), Re-click same tool button.
// Every ribbon tool x every stage (before1st, after1st, after2nd/dimPlacing/mirrorStep2, boxTyped, midDrag, transformDrag, transformBoxTyped, dimEditBoxTyped).
import { startHost, row, fmtSnap, FIX } from './interrupts-audit-1023-kit.js';
import { sleep } from '../helpers/cdp-browser.js';
import { TOOL_STAGES } from './interrupts-audit-1023-matrix.js';



const altFor = (tool) => (tool === 'circle' ? { id: 'tool-line', key: 'l', expect: 'line' } : { id: 'tool-circle', key: 'c', expect: 'circle' });
const baseToolName = (t) => {
  if (t.startsWith('rect-')) return 'rect';
  if (t.startsWith('slot-')) return 'slot';
  if (t === 'select-drag' || t === 'transform' || t === 'dim-edit') return 'select';
  return t;
};

const h = await startHost({ host: 'shaper', phone: false, tag: '1023-p1' });
try {
  await h.setBrowserCollapsed(true);
  let seq = 0;
  const nextId = (p) => `${p}-${String(++seq).padStart(3, '0')}`;

  // ── A. ESC (1 press) ──
  console.log('\n=== SECTION A: ESC (ONE PRESS) ===');
  for (const spec of TOOL_STAGES) {
    for (const stage of spec.stages) {
      await h.resetFixture();
      const base = await h.inspect();
      const ctx = await h.enterStage(spec.tool, stage);
      const pre = await h.inspect();
      await h.pressKey('Escape', { settle: 90 });
      const post = await h.inspect();
      // Clean up mouse button if midDrag / transformDrag
      if (ctx && ctx.dragCur) await h.releaseUpScreen(ctx.dragCur.x, ctx.dragCur.y, { settle: 40 });

      const issues = [];
      // Expected: ONE Esc cancels & leaves tool -> select (except transformDrag which stays in select & keeps group selected per TASK 753)
      if (post.tool !== 'select') issues.push(`TOOL_STUCK(${post.tool})`);
      if (post.openBoxes.length || post.nimActive) issues.push(`BOX_OPEN(${post.openBoxes.join(',')},nim=${post.nimActive})`);
      if (post.hasActive) issues.push(`ACTIVE_LEAK(${post.activeMode})`);
      if (post.hasDrag) issues.push(`DRAG_LEAK(${post.dragType})`);
      if (post.hasPlacing || post.placingCons > 0) issues.push(`PLACING_LEAK`);
      if (post.editingCons > 0 || post.newlyCons > 0) issues.push(`CONS_FLAG_LEAK(ed=${post.editingCons},nw=${post.newlyCons})`);
      if (post.overlays.preview || post.overlays.fillet || post.overlays.offset || post.overlays.pattern || post.overlays.trim || post.overlays.break) {
        issues.push(`OVERLAY_LEAK(${JSON.stringify(post.overlays)})`);
      }
      if (post.doneOpen) issues.push(`DONE_OPEN`);
      if (post.shapes !== base.shapes) issues.push(`SHAPES_DELTA(${base.shapes}->${post.shapes})`);
      if (post.cons !== base.cons) issues.push(`CONS_DELTA(${base.cons}->${post.cons})`);
      if (post.undoLen !== base.undoLen || post.redoLen !== base.redoLen) issues.push(`HIST_DELTA(U:${base.undoLen}->${post.undoLen},R:${base.redoLen}->${post.redoLen})`);
      if (stage !== 'transformDrag' && stage !== 'transformBoxTyped' && stage !== 'dimEditBoxTyped' && (post.selShapes || post.selJoints || post.selCons)) {
        issues.push(`SEL_LEAK(S:${post.selShapes},J:${post.selJoints},C:${post.selCons})`);
      }
      if (post.pageErrors > pre.pageErrors) issues.push(`PAGE_ERROR`);
      const tag = issues.length ? `FAIL[${issues.join('; ')}]` : 'OK';
      row(nextId('ESC'), spec.tool, stage, 'Esc', `${tag} | preBoxes=[${pre.openBoxes.join(',')}] preFocus=${pre.focus} -> ${fmtSnap(post)}`);
    }
  }

  // ── B. SWITCH TOOL VIA RIBBON CLICK ──
  console.log('\n=== SECTION B: SWITCH TOOL (RIBBON CLICK) ===');
  seq = 0;
  for (const spec of TOOL_STAGES) {
    // Skip select-drag / transformDrag (can't click ribbon while holding left button down)
    for (const stage of spec.stages) {
      if (stage === 'midDrag' || stage === 'transformDrag') continue;
      await h.resetFixture();
      const base = await h.inspect();
      await h.enterStage(spec.tool, stage);
      const pre = await h.inspect();
      const alt = altFor(spec.tool);
      await h.clickTool(alt.id);
      await sleep(70);
      const post = await h.inspect();

      const issues = [];
      if (post.tool !== alt.expect) issues.push(`WRONG_TOOL(${post.tool}!=${alt.expect})`);
      if (post.openBoxes.length || post.nimActive) issues.push(`BOX_OPEN(${post.openBoxes.join(',')},nim=${post.nimActive})`);
      if (post.hasActive) issues.push(`ACTIVE_LEAK(${post.activeMode})`);
      if (post.hasPlacing || post.placingCons > 0) issues.push(`PLACING_LEAK`);
      if (post.editingCons > 0 || post.newlyCons > 0) issues.push(`CONS_FLAG_LEAK(ed=${post.editingCons},nw=${post.newlyCons})`);
      if (post.overlays.preview || post.overlays.fillet || post.overlays.offset || post.overlays.pattern || post.overlays.trim || post.overlays.break) {
        issues.push(`OVERLAY_LEAK(${JSON.stringify(post.overlays)})`);
      }
      if (post.doneOpen) issues.push(`DONE_OPEN`);
      // Note: Text tool commits on outside press/tool switch (TASK 845); Dim edit commits valid typed text on outside press (TASK 723)
      if (spec.tool !== 'text' && spec.tool !== 'dim-edit') {
        if (post.shapes !== base.shapes) issues.push(`SHAPES_DELTA(${base.shapes}->${post.shapes})`);
        if (post.cons !== base.cons) issues.push(`CONS_DELTA(${base.cons}->${post.cons})`);
        if (post.undoLen !== base.undoLen || post.redoLen !== base.redoLen) issues.push(`HIST_DELTA(U:${base.undoLen}->${post.undoLen},R:${base.redoLen}->${post.redoLen})`);
      }
      if (post.pageErrors > pre.pageErrors) issues.push(`PAGE_ERROR`);
      const tag = issues.length ? `FAIL[${issues.join('; ')}]` : 'OK';
      row(nextId('SWR'), spec.tool, stage, `ribbon->${alt.expect}`, `${tag} | preBoxes=[${pre.openBoxes.join(',')}] -> ${fmtSnap(post)}`);
    }
  }

  // ── C. SWITCH TOOL VIA SHORTCUT KEY ──
  console.log('\n=== SECTION C: SWITCH TOOL (SHORTCUT KEY) ===');
  seq = 0;
  for (const spec of TOOL_STAGES) {
    for (const stage of spec.stages) {
      await h.resetFixture();
      const base = await h.inspect();
      const ctx = await h.enterStage(spec.tool, stage);
      const pre = await h.inspect();
      const alt = altFor(spec.tool);
      await h.pressKey(alt.key, { settle: 90 });
      const post = await h.inspect();
      if (ctx && ctx.dragCur) await h.releaseUpScreen(ctx.dragCur.x, ctx.dragCur.y, { settle: 40 });

      const issues = [];
      const boxWasFocused = pre.openBoxes.length > 0 && /input|textarea/i.test(pre.focus);
      if (!boxWasFocused) {
        if (post.tool !== alt.expect) issues.push(`WRONG_TOOL(${post.tool}!=${alt.expect})`);
        if (post.openBoxes.length || post.nimActive) issues.push(`BOX_OPEN(${post.openBoxes.join(',')},nim=${post.nimActive})`);
        if (post.hasActive) issues.push(`ACTIVE_LEAK(${post.activeMode})`);
        if (post.hasDrag) issues.push(`DRAG_LEAK(${post.dragType})`);
        if (post.hasPlacing || post.placingCons > 0) issues.push(`PLACING_LEAK`);
        if (post.overlays.preview || post.overlays.fillet || post.overlays.offset || post.overlays.pattern || post.overlays.trim || post.overlays.break) {
          issues.push(`OVERLAY_LEAK(${JSON.stringify(post.overlays)})`);
        }
        if (post.doneOpen) issues.push(`DONE_OPEN`);
        if (post.shapes !== base.shapes) issues.push(`SHAPES_DELTA(${base.shapes}->${post.shapes})`);
        if (post.cons !== base.cons) issues.push(`CONS_DELTA(${base.cons}->${post.cons})`);
        if (post.undoLen !== base.undoLen || post.redoLen !== base.redoLen) issues.push(`HIST_DELTA(U:${base.undoLen}->${post.undoLen},R:${base.redoLen}->${post.redoLen})`);
      } else {
        // When an input box is focused, typing a letter ('c' or 'l') belongs to the input box, NOT tool switch!
        if (post.tool !== baseToolName(spec.tool)) issues.push(`STOLE_KEY_FROM_BOX(${post.tool})`);
      }
      if (post.pageErrors > pre.pageErrors) issues.push(`PAGE_ERROR`);
      const tag = issues.length ? `FAIL[${issues.join('; ')}]` : 'OK';
      row(nextId('SWK'), spec.tool, stage, `key(${alt.key})`, `${tag} | boxFocused=${boxWasFocused} preFocus=${pre.focus} -> ${fmtSnap(post)}`);
    }
  }

  // ── D. RE-CLICK SAME TOOL'S RIBBON BUTTON (owner rule turn 3741: does NOT exit) ──
  console.log('\n=== SECTION D: RE-CLICK SAME TOOL BUTTON ===');
  seq = 0;
  for (const spec of TOOL_STAGES) {
    if (spec.tool === 'select-drag' || spec.tool === 'transform' || spec.tool === 'dim-edit') continue;
    for (const stage of spec.stages) {
      await h.resetFixture();
      const base = await h.inspect();
      await h.enterStage(spec.tool, stage);
      const pre = await h.inspect();
      await h.clickTool(spec.ribbon);
      await sleep(80);
      const post = await h.inspect();

      const expectTool = baseToolName(spec.tool);
      const issues = [];
      if (post.tool !== expectTool) issues.push(`EXITED_TOOL(${post.tool}!=${expectTool})`);
      // Check if re-click wiped an in-progress draw / box / pick or left a zombie box!
      const preHadWork = pre.hasActive || pre.openBoxes.length > 0 || pre.hasPlacing;
      if (pre.openBoxes.length > 0 && post.openBoxes.length > 0 && !post.hasActive && !post.filletOpen && !post.offsetOpen && !post.patOpen && !post.hasPlacing) {
        issues.push(`ZOMBIE_BOX(${post.openBoxes.join(',')})`);
      }
      if (pre.hasActive && !post.hasActive) issues.push(`WIPED_ACTIVE(boxes=${post.openBoxes.join(',')})`);
      if (pre.openBoxes.length > 0 && post.openBoxes.length === 0) issues.push(`CLOSED_BOX`);
      if (pre.hasPlacing && !post.hasPlacing) issues.push(`WIPED_PLACING`);
      if (spec.tool !== 'text' && (post.shapes !== base.shapes || post.cons !== base.cons)) {
        issues.push(`GEOM_DELTA(sh:${base.shapes}->${post.shapes},c:${base.cons}->${post.cons})`);
      }
      if (spec.tool !== 'text' && (post.undoLen !== base.undoLen || post.redoLen !== base.redoLen)) {
        issues.push(`HIST_DELTA(U:${base.undoLen}->${post.undoLen},R:${base.redoLen}->${post.redoLen})`);
      }
      if (post.pageErrors > pre.pageErrors) issues.push(`PAGE_ERROR`);
      const tag = issues.length ? `NOTE[${issues.join('; ')}]` : 'OK';
      row(nextId('REK'), spec.tool, stage, `reclick(${spec.ribbon})`, `${tag} | preWork=${preHadWork} -> ${fmtSnap(post)}`);
    }
  }
} finally {
  await h.close();
}
