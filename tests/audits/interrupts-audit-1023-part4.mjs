// tests/audits/interrupts-audit-1023-part4.mjs: TASK 1023 (AUDIT ONLY). Targeted follow-ups on the desktop host (right-click on geometry, Undo then Redo
// of a cancelled draw / placement, the dimension edit box) and the PHONE (390x844) touch sequences.
// usage: node interrupts-audit-1023-part4.mjs [desk|phone|all]
import { startHost, row, fmtSnap, FIX } from './interrupts-audit-1023-kit.js';
import { TOOL_STAGES } from './interrupts-audit-1023-matrix.js';
import { sleep } from '../helpers/cdp-browser.js';

const which = process.argv[2] || 'all';
if (which === 'all' || which === 'desk') {
  const h = await startHost({ host: 'shaper', tag: '1023-p4d' });
  try {
    await h.setBrowserCollapsed(true);
    const snap = async () => fmtSnap(await h.inspect()).slice(0, 330);
    // F1: right-click ON geometry in the modify / constraint tools
    for (const [tool, pt, label] of [['tool-trim', FIX.L3_LEFT, 'trim on L3'], ['tool-break', FIX.L3_RIGHT, 'break on L3'], ['tool-fillet', FIX.CORNER, 'fillet at corner'], ['tool-offset', FIX.L1_MID, 'offset on L1'], ['tool-parallel', FIX.L5_MID, 'parallel on L5'], ['tool-coincident', FIX.L3_A, 'coincident on joint'], ['tool-select', FIX.L1_MID, 'select on L1 (control)']]) {
      await h.resetFixture(); const b = await h.inspect();
      await h.clickTool(tool); await h.clickW(pt.x, pt.y, { button: 'right', settle: 160 });
      const p = await h.inspect();
      row('F1-' + tool.slice(5), tool.slice(5), 'before1st', 'right-click ON geometry', `shapes ${b.shapes}->${p.shapes} cons ${b.cons}->${p.cons} undo ${b.undoLen}->${p.undoLen} ctxMenu=${p.ctxMenuOpen} boxes=[${p.openBoxes.join(',')}] sel(S:${p.selShapes},J:${p.selJoints},C:${p.selCons}) | ${label}`);
    }
    // F2: Ctrl+Z in a half-made draw, then Ctrl+Y: does Redo bring anything back?
    for (const [tool, label] of [['tool-line', 'line'], ['tool-circle', 'circle'], ['tool-rect', 'rect']]) {
      await h.resetFixture(); const b = await h.inspect();
      await h.clickTool(tool); await h.clickW(FIX.DRAW_P1.x, FIX.DRAW_P1.y); await h.moveW(FIX.DRAW_P2.x, FIX.DRAW_P2.y);
      await h.pressKey('z', { ctrl: true }); const a = await h.inspect();
      await h.pressKey('y', { ctrl: true }); const c = await h.inspect();
      row('F2-' + label, label, 'after1st', 'Ctrl+Z then Ctrl+Y', `base(U:${b.undoLen},R:${b.redoLen}) afterZ tool=${a.tool} U:${a.undoLen} R:${a.redoLen} shapes=${a.shapes} | afterY tool=${c.tool} U:${c.undoLen} R:${c.redoLen} shapes=${c.shapes}`);
    }
    {
      await h.resetFixture(); const b = await h.inspect();
      await h.enterStage('dim', 'dimPlacing'); const pre = await h.inspect();
      await h.pressKey('z', { ctrl: true }); const a = await h.inspect();
      await h.pressKey('y', { ctrl: true }); const c = await h.inspect();
      row('F2-dim', 'dim', 'dimPlacing', 'Ctrl+Z then Ctrl+Y', `base(U:${b.undoLen},R:${b.redoLen},cons:${b.cons}) pre(U:${pre.undoLen},R:${pre.redoLen},cons:${pre.cons}) afterZ tool=${a.tool} U:${a.undoLen} R:${a.redoLen} cons=${a.cons} placing=${a.hasPlacing} | afterY tool=${c.tool} U:${c.undoLen} R:${c.redoLen} cons=${c.cons} placing=${c.hasPlacing} (dimension back? ${c.cons - a.cons})`);
    }
    // F3: the dimension edit box (double-click the existing d1 label): where is its input
    {
      await h.resetFixture();
      await h.clickTool('tool-select'); await h.clickW(FIX.D1_LBL.x, FIX.D1_LBL.y, { clicks: 2, settle: 200 });
      const info = await h.cdp.evalJs(`[...document.querySelectorAll('input, textarea')].filter(e => e.offsetParent !== null).map(e => (e.id || e.className) + '=' + JSON.stringify(e.value)).join(' ; ')`);
      row('F3-dimedit', 'dim-edit', 'dimEditBox', 'dblclick d1 label', `visible inputs: ${info} | ${await snap()}`);
    }
    // F4: Esc, Esc
    {
      await h.resetFixture(); const b = await h.inspect();
      await h.clickTool('tool-line'); await h.clickW(FIX.DRAW_P1.x, FIX.DRAW_P1.y); await h.pressKey('Escape'); await h.pressKey('Escape'); const a = await h.inspect();
      row('F4-esc2', 'line', 'after1st', 'Esc, Esc', `base(U:${b.undoLen},R:${b.redoLen}) -> tool=${a.tool} U:${a.undoLen} R:${a.redoLen} sel=(S:${a.selShapes}) boxes=[${a.openBoxes.join(',')}]`);
    }
    // F5: the sidebar (burger) opened for real (checked), then closed by a click outside, at six stages
    for (const [tool, stage] of [['line', 'after1st'], ['rect-2pt', 'after1st'], ['circle', 'boxTyped'], ['fillet', 'after1st'], ['coincident', 'after1st'], ['dim', 'dimPlacing'], ['offset', 'boxTyped']]) {
      await h.resetFixture(); const b = await h.inspect();
      await h.enterStage(tool, stage); const pre = await h.inspect();
      const burger = await h.cdp.evalJs(`(() => { const e = document.querySelector('.sk-sidebar-btn'); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      await h.clickScreen(burger.x, burger.y, { settle: 300 });
      const left = await h.cdp.evalJs(`document.querySelector('.sk-sidebar').getBoundingClientRect().left`);
      const mid = await h.inspect();
      const bd = await h.cdp.evalJs(`(() => { const e = document.elementFromPoint(900, 400); return e && e.className && e.className.baseVal === undefined ? e.className : String(e && e.tagName); })()`);
      await h.clickScreen(900, 400, { settle: 220 });
      const post = await h.inspect();
      const left2 = await h.cdp.evalJs(`document.querySelector('.sk-sidebar').getBoundingClientRect().left`);
      row('F5-' + tool + '-' + stage, tool, stage, 'sidebar open + click outside', `sidebarLeft ${left} (0=open) @open: tool=${mid.tool} active=${mid.hasActive} boxes=[${mid.openBoxes.join(',')}] | outside target ${bd} | after: sidebarLeft ${left2} tool=${post.tool} active=${post.hasActive} boxes=[${post.openBoxes.join(',')}] shapes ${pre.shapes}->${post.shapes} cons ${pre.cons}->${post.cons} U ${pre.undoLen}->${post.undoLen}`);
    }
  } finally { await h.close(); }
}

if (which === 'all' || which === 'phone') {
  const h = await startHost({ host: 'shaper', phone: true, tag: '1023-p4p' });
  try {
    // the kit's clickScreen is a real finger tap on the phone
    await h.setBrowserCollapsed(true);
    const vp = await h.cdp.evalJs(`({ w: innerWidth, h: innerHeight })`);
    console.log('phone viewport', JSON.stringify(vp));
    const cx = vp.w / 2, cy = vp.h / 2;
    const PH = [
      { tool: 'line', stages: ['before1st', 'after1st'] }, { tool: 'rect-2pt', stages: ['after1st'] }, { tool: 'circle', stages: ['after1st'] },
      { tool: 'arc', stages: ['after1st'] }, { tool: 'polygon', stages: ['after1st'] }, { tool: 'slot-c2c', stages: ['after1st'] }, { tool: 'bezier', stages: ['after1st'] },
      { tool: 'trim', stages: ['before1st'] }, { tool: 'fillet', stages: ['after1st'] }, { tool: 'offset', stages: ['after1st'] }, { tool: 'mirror', stages: ['after1st'] },
      { tool: 'dim', stages: ['after1st'] }, { tool: 'coincident', stages: ['after1st'] }, { tool: 'parallel', stages: ['after1st'] },
    ];
    const btnPt = (sel) => `(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) return null; const r = b.getBoundingClientRect(); if (!r.width) return null; return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`;
    const interrupts = {
      'tap other tool (ribbon)': async () => { await h.clickTool('tool-circle'); },
      'tap same tool (ribbon)': async (spec) => { await h.clickTool(spec.ribbon); },
      'pinch zoom (2 fingers)': async () => {
        await h.touch('touchStart', [{ x: cx - 30, y: cy, id: 1 }, { x: cx + 30, y: cy, id: 2 }]); await sleep(40);
        for (const d of [50, 70, 90]) { await h.touch('touchMove', [{ x: cx - d, y: cy, id: 1 }, { x: cx + d, y: cy, id: 2 }]); await sleep(30); }
        await h.touch('touchEnd', []); await sleep(120);
      },
      'two-finger pan': async () => {
        await h.touch('touchStart', [{ x: cx - 30, y: cy, id: 1 }, { x: cx + 30, y: cy, id: 2 }]); await sleep(40);
        for (const d of [20, 40, 60]) { await h.touch('touchMove', [{ x: cx - 30 + d, y: cy + d / 2, id: 1 }, { x: cx + 30 + d, y: cy + d / 2, id: 2 }]); await sleep(30); }
        await h.touch('touchEnd', []); await sleep(120);
      },
      'long-press on canvas (750 ms)': async () => {
        const p = await h.w2s(FIX.EMPTY.x, FIX.EMPTY.y);
        await h.touch('touchStart', [{ x: p.x, y: p.y, id: 1 }]); await sleep(750); await h.touch('touchEnd', []); await sleep(150);
      },
      'tap footer blank': async () => { await h.tapTouchScreen(cx, vp.h - 20, { settle: 150 }); },
      'tap Done button': async () => { const d = await h.cdp.evalJs(btnPt('.sk-done')); if (d) await h.tapTouchScreen(d.x, d.y, { settle: 150 }); return d ? '' : 'NO_DONE_BUTTON'; },
      'tap Undo button': async () => { const d = await h.cdp.evalJs(btnPt('#btn-undo')); if (d) await h.tapTouchScreen(d.x, d.y, { settle: 150 }); return d ? '' : 'NO_UNDO_BUTTON'; },
      'window blur/focus (synthetic)': async () => { await h.cdp.evalJs(`window.dispatchEvent(new Event('blur')); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus'));`); await sleep(120); return 'synthetic'; },
    };
    let n = 0;
    for (const [iname, fn] of Object.entries(interrupts)) {
      for (const spec of PH) {
        for (const stage of spec.stages) {
          await h.resetFixture({ cx: 20, cy: 0, vw: 150 });
          const base = await h.inspect();
          let note = '', pre, post;
          try {
            await h.enterStage(spec.tool, stage); pre = await h.inspect();
            const full = TOOL_STAGES.find((t) => t.tool === spec.tool);
            note = (await fn({ ribbon: full.ribbon })) || '';
            post = await h.inspect();
          } catch (e) { note = 'CELL_ERROR ' + String(e.message).slice(0, 100); post = post || await h.inspect(); pre = pre || post; }
          row(`PH-${String(++n).padStart(3, '0')}`, spec.tool, stage, iname, `base(U:${base.undoLen},R:${base.redoLen}) pre=${fmtSnap(pre).slice(0, 170)} | post=${fmtSnap(post)} ${note} view ${JSON.stringify(pre.view)}->${JSON.stringify(post.view)}`);
        }
      }
    }
    await h.capture('phone-final.png');
  } finally { await h.close(); }
}
