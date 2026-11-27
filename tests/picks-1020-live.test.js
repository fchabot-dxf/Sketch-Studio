// tests/picks-1020-live.test.js -- TASK 1020 in a real headless browser (Shaper page: it exposes the design state), desktop 1280x800 (mouse) and
// phone 390x844 (touch), the real ribbon and real pointer input:
//   BUG-210 (R2-09)  Equal on a small circle's rim (r = 10 px): the rim is picked, never its centre, so Equal(C1, C2) is made
//   BUG-210 (R1-14)  Select on a small circle's rim beside its centre: the circle is selected, not the centre point
//   BUG-213 (R2-08)  Tangent on an arc's apex over the Y construction centreline (drawn first): the solid arc is picked
// Zoomed screenshots go to .evidence/1020/.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './helpers/cdp-browser.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';
import { docOf } from './fixtures/display-1010/doc-kit.js';
import { NO_NET, openSeeded, setView, w2s, mouseMove, mouseClick, touchTap, shot } from './fixtures/display-1010/live-kit.js';

const SHAPER = { host: 'shaper', canvas: 'design-canvas', url: '/apps/shaper/index.html' };
const ST = (cdp, js) => cdp.evalJs(`(() => { const st = window.__designController.state; return ${js}; })()`);
const EVID = path.resolve('.evidence/1020');

async function run(tag, width, height, touch) {
  const cdp = await launchBrowser({ tag, width, height, args: NO_NET });
  if (!cdp) { console.log(`skipped ${tag}: no headless browser`); return; }
  const tap = (p) => (touch ? touchTap(cdp, p.x, p.y) : mouseClick(cdp, p.x, p.y));
  const at = (x, y) => w2s(cdp, SHAPER.canvas, x, y);
  const evidence = async (name, clip) => { fs.mkdirSync(EVID, { recursive: true }); const f = await shot(cdp, `${tag}-${name}`, clip); fs.copyFileSync(f, path.join(EVID, path.basename(f))); };
  // a canvas `pxPerMm` px per mm, centred on (cx, cy)
  const view = async (cx, cy, pxPerMm) => { const w = await cdp.evalJs(`document.getElementById('${SHAPER.canvas}').getBoundingClientRect().width`); await setView(cdp, SHAPER.canvas, cx, cy, w / pxPerMm); };
  try {
    await installFakeDriveSession(cdp);
    const tool = (name) => pressRibbonTool(cdp.evalJs, (p) => (touch ? touchTap(cdp, p.x, p.y) : mouseClick(cdp, p.x, p.y)), `tool-${name}`);

    // ---- R2-09: Equal on two circles' rims, C1 r = 2.5 mm at 4 px/mm (10 px, inside the 15 px point priority)
    await openSeeded(cdp, docOf({ c1: [10, 10, true], c2: [30, 10, true] },
      [{ id: 'C1', type: 'circle', joints: ['c1'], radius: 2.5 }, { id: 'C2', type: 'circle', joints: ['c2'], radius: 5 }]), SHAPER);
    await view(20, 10, 4);
    await tool('equal');
    const r1 = await at(10, 7.5);
    if (!touch) {
      await mouseMove(cdp, r1.x, r1.y);
      const hov = await ST(cdp, '({ shape: st.hoveredShape, joint: st.hoveredJoint })');
      console.log(tag, 'R2-09 hover', JSON.stringify(hov));
      assert.ok(hov.shape === 'C1' && !hov.joint, `R2-09 the hover on C1's rim lights C1, not its centre: ${JSON.stringify(hov)}`);
      await evidence('r209-equal-rim-hover.png', { x: r1.x - 60, y: r1.y - 40, width: 120, height: 90 });
    }
    await tap(r1);
    await tap(await at(30, 5));
    const eq = await ST(cdp, 'st.constraints.filter((c) => c.type === "equal").map((c) => c.shapes)');
    console.log(tag, 'R2-09 equal', JSON.stringify(eq));
    assert.ok(eq.some((s) => s.includes('C1') && s.includes('C2')), `R2-09 Equal(C1 rim, C2 rim) is made: ${JSON.stringify(eq)}`);

    // ---- R1-14: Select on a Ø8 circle's rim at 2.5 px/mm (r = 10 px from its centre)
    await openSeeded(cdp, docOf({ bc: [20, 10, true] }, [{ id: 'BOLT', type: 'circle', joints: ['bc'], radius: 4 }]), SHAPER);
    await view(20, 10, 2.5);
    await tool('select');
    const rim = await at(24, 10);
    await tap(rim);
    const sel = await ST(cdp, '({ shapes: [...st.selectedShapes], joints: [...st.selectedJoints] })');
    console.log(tag, 'R1-14 select', JSON.stringify(sel));
    assert.deepStrictEqual(sel, { shapes: ['BOLT'], joints: [] }, `R1-14 a press on the rim selects the circle, not its centre: ${JSON.stringify(sel)}`);
    await evidence('r114-rim-selects-circle.png', { x: rim.x - 70, y: rim.y - 45, width: 120, height: 90 });

    // ---- R2-08: Tangent on the arc's apex over the Y construction centreline (drawn first), then the line
    await openSeeded(cdp, docOf({ y1: [0, -10, true], y2: [0, 40, true], ac: [0, 19, true], as: [-8, 6, true], ae: [8, 6, true], g1: [12, 6], g2: [36, 22] },
      [{ id: 'YCL', type: 'line', joints: ['y1', 'y2'], isConstruction: true },
        { id: 'ARC', type: 'arc', subType: 'CENTER', joints: ['ac', 'as', 'ae'] }, { id: 'G', type: 'line', joints: ['g1', 'g2'] }]), SHAPER);
    await view(12, 12, 8);
    await tool('tangent');
    const apex = await cdp.evalJs(`import('/packages/core/geometry.js').then((g) => { const st = window.__designController.state; const a = st.shapes.find((s) => s.id === 'ARC');
      return g.arcSweepMidpoint(st.joints.get('ac'), st.joints.get('as'), st.joints.get('ae'), { sweep: a.sweep }); })`);
    assert.ok(Math.abs(apex.x) < 1e-6, `setup: the apex lies on the centreline: ${JSON.stringify(apex)}`);
    const pa = await at(apex.x, apex.y);
    if (!touch) {
      await mouseMove(cdp, pa.x, pa.y);
      const hov = await ST(cdp, 'st.hoveredShape');
      console.log(tag, 'R2-08 hover', hov);
      assert.strictEqual(hov, 'ARC', 'R2-08 the hover on the apex lights the solid arc');
      await evidence('r208-tangent-apex-hover.png', { x: pa.x - 70, y: pa.y - 50, width: 140, height: 100 });
    }
    await tap(pa);
    await tap(await at(24, 14));
    const tan = await ST(cdp, 'st.constraints.filter((c) => c.type === "tangent").map((c) => c.shapes)');
    console.log(tag, 'R2-08 tangent', JSON.stringify(tan));
    assert.ok(tan.some((s) => s.includes('ARC') && s.includes('G')), `R2-08 Tangent(arc, line) is made: ${JSON.stringify(tan)}`);
    console.log(`PASS ${tag}`);
  } finally { await cdp.close(); }
}

await run('1020-desktop', 1280, 800, false);
await run('1020-phone', 390, 844, true);
process.exit(0);
