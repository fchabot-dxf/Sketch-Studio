// tests/polish-757-tray.js — TASK 757: what the two live tests (polish-757-live / polish-757-phone-live) share: the tray they draw and the Settings select
// measure. Both are PAGE functions (the tests send their source text to the page: evalJs(`(${fn})()`)), so they use only what the page has.
export const PHONE = { width: 390, height: 844 };

// Draws a 16 x 8 in tray (mm, y down) in the open Design state and plans it, as Prepare keys it: the Stock board (-20,-20)-(420,220), the part (0,0)-(400,200)
// Outside with Tabs (Auto), a slot (20,60)-(42,140) Inside with a CONSTRUCTION centre line "CL", a raster pocket (80,40)-(200,160) with a 0.02 in wall
// allowance, and a dish (circle r 44.45 at (300,100)) as a Stepped pocket over a cove slope (adaptive: many close outlines). Returns the planned types.
export async function drawTray() {
  const { findLoops } = await import('/packages/core/loop-finder.js');
  const { CUT_PLAN, keyOf } = await import('/apps/shaper/src/cut-plan.js');
  const { POCKET_CLEARING } = await import('/packages/core/pocket-clearing.js');
  const st = window.__designController.state;
  for (const k of [...st.joints.keys()]) if (k !== 'j_origin') st.joints.delete(k);
  st.shapes.length = 0; st.constraints.length = 0; CUT_PLAN.clear();
  let n = 0;
  const J = (x, y) => { const id = 'tj' + (++n); st.joints.set(id, { x, y }); return id; };
  const line = (a, b, more = {}) => { const id = more.id || 'ts' + (++n); st.shapes.push({ id, type: 'line', joints: [a, b], ...more }); return id; };
  const rect = (x0, y0, x1, y1) => { const p = [J(x0, y0), J(x1, y0), J(x1, y1), J(x0, y1)]; return [0, 1, 2, 3].map((i) => line(p[i], p[(i + 1) % 4])); };
  const board = rect(-20, -20, 420, 220), part = rect(0, 0, 400, 200), slot = rect(20, 60, 42, 140), pocket = rect(80, 40, 200, 160);
  line(J(31, 70), J(31, 130), { id: 'CL', isConstruction: true });
  const c = J(300, 100); st.shapes.push({ id: 'dish', type: 'circle', joints: [c], radius: 44.45 });
  st.saveState('draw');
  const loops = findLoops(st);
  const loopOf = (edge) => keyOf('loop', loops.find((l) => l.edges.includes(edge)).id);
  const base = { cutOffset: 0, toolDia: 6.35, cutterShape: 'endmill', cutterAngle: 90 };
  const depth = 12.7, cove = depth, R = 44.45, rings = [];
  for (let z = 0; z <= depth + 1e-9; z += 0.25) rings.push({ z: +z.toFixed(3), segments: [{ type: 'circle', cx: 300, cy: 100, r: R - cove + Math.sqrt(Math.max(0, cove * cove - z * z)) }] });
  CUT_PLAN.set(loopOf(board[0]), { ...base, toolDia: 3.175, cutType: 'stock', cutDepth: 19.05 });
  CUT_PLAN.set(loopOf(part[0]), { ...base, cutType: 'exterior', cutDepth: 19.05, holdPart: 'tabs', tabCount: 'auto', tabWidth: 9.525, holdThickness: 1.5875 });
  CUT_PLAN.set(loopOf(slot[0]), { ...base, cutType: 'interior', cutDepth: 19.05 });
  CUT_PLAN.set(loopOf(pocket[0]), { ...base, cutType: 'pocket', cutDepth: 9.525, clearing: 'raster', stepover: POCKET_CLEARING.stepoverPct.default, finishAllowance: 0.508, rasterAngle: 0 });
  CUT_PLAN.set(keyOf('loop', loops.find((l) => l.edges.includes('dish')).id), { ...base, cutType: 'roughing', cutDepth: depth, stepDepth: 1, adaptiveSteps: true, stepDeviation: 0.25, slope: { kind: 'pocket', label: 'Dish', rings } });
  return [...CUT_PLAN.values()].map((r) => r.cutType);
}

// Every select of the open Settings panel, on every tab: its width, the width it needs to show its longest option (a hidden copy at its intrinsic width:
// width auto, no max-width, the same font) and the panel's content right edge on that tab. The tab shown at the start is shown again at the end.
export function selectWidths() {
  const panel = document.querySelector('.sk-style-panel');
  const tabs = [...panel.querySelectorAll('.sk-style-tab')];
  const start = tabs.find((t) => t.classList.contains('sk-active'));
  const out = [];
  for (const t of tabs) {
    t.click();
    const pr = panel.getBoundingClientRect(), pcs = getComputedStyle(panel); // per tab: a long tab's scrollbar narrows the panel's content
    const panelRight = pr.left + panel.clientLeft + panel.clientWidth - parseFloat(pcs.paddingRight);
    for (const s of panel.querySelectorAll('select')) {
      if (!s.offsetParent) continue;
      const copy = s.cloneNode(true);
      Object.assign(copy.style, { width: 'auto', maxWidth: 'none', position: 'absolute', visibility: 'hidden', left: '0', top: '0' });
      s.parentNode.appendChild(copy);
      const needed = copy.getBoundingClientRect().width;
      copy.remove();
      const r = s.getBoundingClientRect();
      out.push({ key: s.dataset.key, width: Math.round(r.width * 10) / 10, needed: Math.round(needed * 10) / 10, right: Math.round(r.right * 10) / 10, panelRight: Math.round(panelRight * 10) / 10 });
    }
  }
  if (start) start.click();
  return out;
}
