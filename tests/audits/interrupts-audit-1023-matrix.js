// tests/audits/interrupts-audit-1023-matrix.js: TASK 1023 (AUDIT ONLY): the tool x stage matrix and the generic cell runner.
import { row, fmtSnap, FIX } from './interrupts-audit-1023-kit.js';

export const TOOL_STAGES = [
  // Draw (14 modes)
  { tool: 'line',               ribbon: 'tool-line',               stages: ['before1st', 'after1st', 'boxTyped'] },
  { tool: 'rect-2pt',           ribbon: 'tool-rect',               stages: ['before1st', 'after1st', 'boxTyped'] },
  { tool: 'rect-center',        ribbon: 'tool-rect',               stages: ['before1st', 'after1st', 'boxTyped'] },
  { tool: 'rect-3pt',           ribbon: 'tool-rect',               stages: ['before1st', 'after1st', 'after2nd', 'boxTyped'] },
  { tool: 'circle',             ribbon: 'tool-circle',             stages: ['before1st', 'after1st', 'boxTyped'] },
  { tool: 'arc',                ribbon: 'tool-arc',                stages: ['before1st', 'after1st', 'after2nd', 'boxTyped'] },
  { tool: 'polygon',            ribbon: 'tool-polygon',            stages: ['before1st', 'after1st', 'boxTyped'] },
  { tool: 'slot-c2c',           ribbon: 'tool-slot',               stages: ['before1st', 'after1st', 'after2nd', 'boxTyped'] },
  { tool: 'slot-overall',       ribbon: 'tool-slot',               stages: ['before1st', 'after1st', 'boxTyped'] },
  { tool: 'slot-center',        ribbon: 'tool-slot',               stages: ['before1st', 'after1st', 'boxTyped'] },
  { tool: 'slot-arc3',          ribbon: 'tool-slot',               stages: ['before1st', 'after1st', 'boxTyped'] },
  { tool: 'slot-arccenter',     ribbon: 'tool-slot',               stages: ['before1st', 'after1st', 'boxTyped'] },
  { tool: 'bezier',             ribbon: 'tool-bezier',             stages: ['before1st', 'after1st', 'after2nd'] },
  { tool: 'text',               ribbon: 'tool-text',               stages: ['before1st', 'boxTyped'] },
  // Modify (8 tools + Select drag / Transform / Dim edit)
  { tool: 'trim',               ribbon: 'tool-trim',               stages: ['before1st'] },
  { tool: 'break',              ribbon: 'tool-break',              stages: ['before1st'] },
  { tool: 'closePath',          ribbon: 'tool-closePath',          stages: ['before1st'] },
  { tool: 'fillet',             ribbon: 'tool-fillet',             stages: ['before1st', 'after1st', 'boxTyped'] },
  { tool: 'offset',             ribbon: 'tool-offset',             stages: ['before1st', 'after1st', 'boxTyped'] },
  { tool: 'mirror',             ribbon: 'tool-mirror',             stages: ['before1st', 'after1st', 'mirrorStep2'] },
  { tool: 'circularPattern',    ribbon: 'tool-circularPattern',    stages: ['before1st', 'after1st', 'boxTyped'] },
  { tool: 'rectangularPattern', ribbon: 'tool-rectangularPattern', stages: ['before1st', 'after1st', 'boxTyped'] },
  { tool: 'select-drag',        ribbon: 'tool-select',             stages: ['midDrag'] },
  { tool: 'transform',          ribbon: 'tool-select',             stages: ['transformDrag', 'transformBoxTyped'] },
  { tool: 'dim-edit',           ribbon: 'tool-select',             stages: ['dimEditBoxTyped'] },
  // Dimension
  { tool: 'dim',                ribbon: 'tool-dim',                stages: ['before1st', 'after1st', 'dimPlacing', 'boxTyped'] },
  // Constrain (all 9)
  { tool: 'coincident',         ribbon: 'tool-coincident',         stages: ['before1st', 'after1st'] },
  { tool: 'hv',                 ribbon: 'tool-hv',                 stages: ['before1st', 'after1st'] },
  { tool: 'parallel',           ribbon: 'tool-parallel',           stages: ['before1st', 'after1st'] },
  { tool: 'perp', ribbon: 'tool-perp',      stages: ['before1st', 'after1st'] },
  { tool: 'collinear',          ribbon: 'tool-collinear',          stages: ['before1st', 'after1st'] },
  { tool: 'tangent',            ribbon: 'tool-tangent',            stages: ['before1st', 'after1st'] },
  { tool: 'equal',              ribbon: 'tool-equal',              stages: ['before1st', 'after1st'] },
  { tool: 'midpoint',           ribbon: 'tool-midpoint',           stages: ['before1st', 'after1st'] },
  { tool: 'symmetric',          ribbon: 'tool-symmetric',          stages: ['before1st', 'after1st', 'after2nd'] },
];

const KEYS = ['tool', 'nimActive', 'hasActive', 'hasDrag', 'hasPlacing', 'hasMirror', 'shapes', 'joints', 'cons', 'selShapes', 'selJoints', 'selCons', 'undoLen', 'redoLen', 'enteredGroup', 'ctxMenuOpen', 'doneOpen', 'pwinOpen'];
/** Differences between two inspect() snapshots, as "key:a->b" strings (boxes, overlays and view too). */
export function diffSnap(a, b, { view = false } = {}) {
  const out = [];
  for (const k of KEYS) if (a[k] !== b[k]) out.push(`${k}:${a[k]}->${b[k]}`);
  if (a.openBoxes.join('|') !== b.openBoxes.join('|')) out.push(`boxes:[${a.openBoxes.join(',')}]->[${b.openBoxes.join(',')}]`);
  if (JSON.stringify(a.overlays) !== JSON.stringify(b.overlays)) out.push(`overlays:${JSON.stringify(a.overlays)}->${JSON.stringify(b.overlays)}`);
  if (a.focus !== b.focus) out.push(`focus:${a.focus}->${b.focus}`);
  if (view && JSON.stringify(a.view) !== JSON.stringify(b.view)) out.push(`view:${JSON.stringify(a.view)}->${JSON.stringify(b.view)}`);
  if (b.pageErrors > a.pageErrors) out.push('PAGE_ERROR');
  return out;
}

const DRAW = new Set(['line', 'rect-2pt', 'rect-center', 'rect-3pt', 'circle', 'arc', 'polygon', 'slot-c2c', 'slot-overall', 'slot-center', 'slot-arc3', 'slot-arccenter', 'bezier']);
/** The "does the half-made tool still finish?" probe: the next real clicks / Enter that complete the tool; null when the cell has none. */
async function completion(h, spec, stage) {
  const t = spec.tool;
  if (DRAW.has(t)) {
    if (stage === 'before1st') return null;
    if (stage === 'boxTyped') { await h.pressKey('Enter', { settle: 110 }); return 'Enter'; }
    await h.clickW(FIX.DRAW_P2.x, FIX.DRAW_P2.y); await h.clickW(FIX.DRAW_P3.x, FIX.DRAW_P3.y); return 'click P2, P3';
  }
  const at = (p) => h.clickW(p.x, p.y);
  if (t === 'coincident') { if (stage !== 'after1st') return null; await at(FIX.L1_A); return 'click 2nd point'; }
  if (t === 'hv') { if (stage !== 'after1st') return null; await at(FIX.L5_B); return 'click 2nd point'; }
  if (['parallel', 'perp', 'collinear', 'equal'].includes(t)) { if (stage !== 'after1st') return null; await at(FIX.L1_MID); return 'click 2nd line'; }
  if (t === 'tangent') { if (stage !== 'after1st') return null; await at({ x: 2, y: -28 }); return 'click a line'; }
  if (t === 'midpoint') { if (stage !== 'after1st') return null; await at(FIX.L1_MID); return 'click a line'; }
  if (t === 'symmetric') { if (stage === 'after1st') { await at(FIX.L3_A); await at(FIX.L5_MID); return 'click 2nd point + axis'; } if (stage === 'after2nd') { await at(FIX.L5_MID); return 'click axis'; } return null; }
  if (t === 'dim') {
    if (stage === 'after1st') { await at(FIX.L1_B); return 'click 2nd point'; }
    if (stage === 'dimPlacing') { await at({ x: 54, y: 0 }); return 'click to place'; }
    if (stage === 'boxTyped') { await h.pressKey('Enter', { settle: 110 }); return 'Enter'; }
    return null;
  }
  if (t === 'fillet') { if (stage === 'after1st') { await at({ x: 40, y: 0 }); await h.pressKey('Enter', { settle: 110 }); return 'click 2nd line, Enter'; } if (stage === 'boxTyped') { await h.pressKey('Enter', { settle: 110 }); return 'Enter'; } return null; }
  if (t === 'offset') { if (stage === 'after1st' || stage === 'boxTyped') { await h.pressKey('Enter', { settle: 110 }); return 'Enter'; } return null; }
  if (t === 'trim') { await at(FIX.L3_LEFT); return 'click a segment'; }
  if (t === 'break') { await at(FIX.L3_RIGHT); return 'click a line'; }
  return null;
}

/** Run every tool x stage cell: reset, enter the stage with real events, snapshot, interrupt(h, ctx, pre), snapshot, one ROW line. */
export async function runMatrix(h, prefix, name, interrupt, { skip = () => false, view = false, complete = false, only = null } = {}) {
  let n = 0;
  for (const spec of TOOL_STAGES) {
    if (only && !only.includes(spec.tool)) continue;
    for (const stage of spec.stages) {
      if (skip(spec, stage)) continue;
      await h.resetFixture();
      const base = await h.inspect();
      let ctx = null, post = null, pre = null, note = '';
      try {
        ctx = await h.enterStage(spec.tool, stage);
        pre = await h.inspect();
        note = (await interrupt(h, ctx, pre, spec, stage)) || '';
        post = await h.inspect();
      } catch (e) { note = 'CELL_ERROR ' + String(e.message).slice(0, 120); post = post || await h.inspect(); pre = pre || post; }
      if (ctx && ctx.dragCur) await h.releaseUpScreen(ctx.dragCur.x, ctx.dragCur.y, { settle: 40 });
      const d = diffSnap(pre, post, { view });
      if (complete && !String(note).includes('CELL_ERROR')) {
        try {
          const b = post, how = await completion(h, spec, stage);
          if (how) {
            const c = await h.inspect();
            note += ` || COMPLETION(${how}): dShapes=${c.shapes - b.shapes} dCons=${c.cons - b.cons} tool=${c.tool} placing=${c.hasPlacing} boxes=[${c.openBoxes.join(',')}] active=${c.hasActive}`;
          }
        } catch (e) { note += ' || COMPLETION_ERROR ' + String(e.message).slice(0, 80); }
      }
      row(`${prefix}-${String(++n).padStart(3, '0')}`, spec.tool, stage, name,
        `${d.length ? 'DIFF[' + d.join('; ') + ']' : 'SAME'} | base(U:${base.undoLen},R:${base.redoLen}) pre=${fmtSnap(pre).slice(0, 150)} | post=${fmtSnap(post)} ${note}`);
    }
  }
}
