// tests/helpers/vbit-tipwidth-live.js — TASK 852d live browser verification (desktop & phone):
// 1. Add V-bit in My bits: Tip width field defaults to 0.02 in / 0.508 mm.
// 2. Pick V-bit in a Pocket: V-bit pocket note shows under Bit row with tip pass count & tip width.
// 3. Pick Ball nose & Bowl bits in a Pocket: flat width + scallop height note shows under Bit row.
// 4. Open 3D Review for programmed Ball nose & Bowl pockets and capture zoomed screenshots to .evidence/852d/.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, sleep } from './cdp-browser.js';
import { resetBufferLive } from './reset-buffer.js';
import { installFakeDriveSession } from './fake-drive-session.js';
import { TOOL_TABLE_KEY } from '../../apps/shaper/src/tool-table.js';
import { REVIEW_BUILT } from './review-built.js'; // TASK 880: the 3D build is waited for through lastBuild (no build line on screen)

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOT_DIR = process.env.EVIDENCE_DIR || path.join(REPO_ROOT, '.evidence', '852d');

export async function runVbitTipwidthLive({ phone = false } = {}) {
  const tag = phone ? 'phone' : 'desktop';
  const width = phone ? 390 : 1280;
  const height = phone ? 844 : 800;
  fs.mkdirSync(SHOT_DIR, { recursive: true });

  const cdp = await launchBrowser({
    tag: `852d-${tag}`,
    width,
    height,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }

  const { port, send, evalJs, waitFor, navigate, ws } = cdp;
  const problems = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') problems.push('exception: ' + JSON.stringify(m.params.exceptionDetails).slice(0, 400));
  });

  if (phone) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  }
  await installFakeDriveSession(cdp);

  const touch = async (x, y) => {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 0, radiusX: 1, radiusY: 1, force: 1 }] });
    await sleep(40);
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(250);
  };
  const mouse = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
    await sleep(30);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(30);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(250);
  };
  const tapAt = (x, y) => (phone ? touch(x, y) : mouse(x, y));

  const press = async (sel, what) => {
    const p = await evalJs(`(() => {
      const e = document.querySelector(${JSON.stringify(sel)});
      if (!e) return null;
      e.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const r = e.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    assert.ok(p, `${tag} (${what}): ${sel} missing or zero-sized`);
    await tapAt(p.x, p.y);
  };

  const setInput = async (sel, val, what) => {
    await evalJs(`(() => {
      const i = document.querySelector(${JSON.stringify(sel)});
      if (!i) throw new Error('missing ' + ${JSON.stringify(sel)});
      i.focus();
      i.value = ${JSON.stringify(val)};
      i.dispatchEvent(new Event('input', { bubbles: true }));
      i.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await sleep(120);
  };

  const shot = async (name, sel, pad = 10) => {
    const box = sel ? await evalJs(`(() => {
      const e = document.querySelector(${JSON.stringify(sel)});
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    })()`) : null;
    const clip = box ? {
      x: Math.max(0, box.x - pad),
      y: Math.max(0, box.y - pad),
      width: Math.min(width, box.width + 2 * pad),
      height: Math.min(height, box.height + 2 * pad),
      scale: phone ? 1 : 2,
    } : undefined;
    const res = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
    const out = path.join(SHOT_DIR, name);
    fs.writeFileSync(out, Buffer.from(res.data, 'base64'));
    return out;
  };

  const openStage = async (id, what) => {
    if (phone) {
      await press('.sk-sidebar-chevron', `${what}: menu`);
      await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'sidebar open');
      await sleep(200);
      await press(`.sk-sidebar-stage[data-tab="${id}"]`, `${what}: ${id}`);
      await evalJs(`(() => { const b = document.querySelector('.sk-sidebar-backdrop'); if (b) b.click(); })()`);
    } else {
      await press(`.sk-header-tab[data-tab="${id}"]`, `${what}: ${id}`);
    }
    await waitFor(`(document.querySelector('.sk-sidebar-stage.active') || document.querySelector('.sk-header-tab.active'))?.dataset.tab === '${id}'`, `${id} active`);
    await sleep(350);
  };

  try {
    await resetBufferLive(cdp);
    await evalJs(`(() => { localStorage.removeItem(${JSON.stringify(TOOL_TABLE_KEY)}); localStorage.removeItem('shaper-mode'); localStorage.removeItem('shaper-review-view'); })()`);
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 20000);
    await waitFor(`!!document.querySelector('#design-canvas') && document.querySelector('#design-canvas').dataset.docReady === '1'`, 'shaper doc ready');

    // Seed a 40 x 30 mm rectangle centered at (0, 0) via projectStore and reload cleanly
    const joints = [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }]];
    [[-20, -15], [20, -15], [20, 15], [-20, 15]].forEach(([x, y], i) => joints.push([`pj${i}`, { x, y, sketchId: 'sketch-1' }]));
    const shapes = [0, 1, 2, 3].map((i) => ({ id: `ps${i}`, type: 'line', joints: [`pj${i}`, `pj${(i + 1) % 4}`], sketchId: 'sketch-1' }));
    const seedDoc = { version: 3, geometry: { joints, shapes, constraints: [], sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }], activeSketchId: 'sketch-1', groups: [], profiles: [], parameters: [] }, hosts: {} };
    await evalJs(`import('/packages/ui/project-store.js').then(async (m) => { const store = m.getProjectStore(); const d = await store.newDesign('Pocket 852d', { app: 'shaper' }); await store.save(${JSON.stringify(seedDoc)}, { app: 'shaper', id: d.id }); })`);
    await evalJs(`localStorage.removeItem('shaper-mode'); localStorage.removeItem('shaper-review-view');`);
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 20000);
    await waitFor(`!!document.querySelector('#design-canvas') && document.querySelector('#design-canvas').dataset.docReady === '1' && window.__designController?.state?.shapes?.length === 4`, 'seeded design restored');
    await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('DOC_UNIT', 'mm', { persist: false }))`);
    await sleep(250);

    await openStage('prepare', 'enter prepare');
    await waitFor(`!!document.getElementById('op-type-pocket')`, 'prepare pocket button ready');

    // Create Pocket operation, pick the 40x30 rect
    await press('#op-type-pocket', 'create pocket op');
    await waitFor(`!!document.querySelector('.cut-card') && !document.querySelector('.cut-card').hidden`, 'cut card visible');
    const pt = await evalJs(`(() => {
      const svg = document.getElementById('prepare-canvas');
      const ctm = svg.getScreenCTM();
      const p = svg.createSVGPoint();
      p.x = -20; p.y = 0;
      const sp = p.matrixTransform(ctm);
      return { x: Math.round(sp.x), y: Math.round(sp.y) };
    })()`);
    await tapAt(pt.x, pt.y);
    await waitFor(`!!document.querySelector('.cut-depth') && !document.querySelector('.cut-depth').disabled`, 'pocket shape added');
    await setInput('.cut-depth', '4', 'pocket depth');

    // Set clearing pattern to Spiral (linked)
    await press('.cut-clear-trigger', 'open clearing dropdown');
    await press('.cut-clear-opt[data-clearing="linked"]', 'select Spiral clearing');

    // Open My bits from Cut card -> add V-bit (verify 0.02 in / 0.508 mm default), 1/4" ball-nose, and 1/2" bowl bit
    await press('.cut-bit-trigger', 'open bit dropdown');
    await press('.cut-bit-edit', 'open My bits');
    await waitFor(`!!document.querySelector('#tool-table-modal[open]')`, 'tool table dialog open');

    // Switch doc unit? Verify V-bit template in inch vs mm: let's click Add bit -> V-bit template
    await press('.tt-add', 'add bit');
    await press('.tt-template[data-type="vbit"]', 'pick V-bit template');
    await waitFor(`!!document.querySelector('#tt-tipWidth')`, 'tipWidth input shown');

    // Check V-bit template default Tip width in both mm and in
    const tipInit = await evalJs(`({
      unit: document.querySelector('.tt-unit-btn.is-active')?.dataset.unit,
      val: document.querySelector('#tt-tipWidth')?.value
    })`);
    if (tipInit.unit === 'mm') {
      assert.strictEqual(tipInit.val, '0.508', `${tag}: V-bit template defaults Tip width to 0.508 mm`);
      await press('.tt-unit-btn[data-unit="in"]', 'switch unit to in');
    }
    assert.strictEqual(await evalJs(`document.querySelector('#tt-tipWidth').value`), '0.02', `${tag}: Tip width shows 0.02 in`);
    await press('.tt-unit-btn[data-unit="mm"]', 'switch unit to mm');
    assert.strictEqual(await evalJs(`document.querySelector('#tt-tipWidth').value`), '0.508', `${tag}: Tip width shows 0.508 mm`);
    await press('.tt-unit-btn[data-unit="in"]', 'switch to in for 1/4 in V-bit');
    await setInput('#tt-diameter', '1/4', 'V-bit 1/4 in diameter');
    await setInput('#tt-angle', '90', 'V-bit 90 deg angle');
    await setInput('#tt-name', '1/4 90 V-bit', 'V-bit name');
    await shot(`tt-vbit-tipwidth-${tag}.png`, '.tt-form', 12);
    await press('.tt-save', 'save V-bit');
    await waitFor(`!!document.querySelector('.tt-form')?.hidden`, 'V-bit saved');

    // Also add 1/2" ball nose and 1/2" bowl bit (3/16" corner) so scallops are visually bold in 3D too
    await press('.tt-add', 'add ball nose');
    await press('.tt-template[data-type="ballnose"]', 'pick ball nose template');
    await press('.tt-unit-btn[data-unit="in"]', 'ball nose in inches');
    await setInput('#tt-diameter', '1/2', 'ball nose 1/2 in');
    await setInput('#tt-name', '1/2 ball nose', 'ball nose name');
    await press('.tt-save', 'save ball nose');
    await waitFor(`!!document.querySelector('.tt-form')?.hidden`, 'ball nose saved');

    await press('.tt-add', 'add bowl bit');
    await press('.tt-template[data-type="bowl"]', 'pick bowl template');
    await press('.tt-unit-btn[data-unit="in"]', 'bowl bit in inches');
    await setInput('#tt-diameter', '1/2', 'bowl 1/2 in');
    await setInput('#tt-cornerRadius', '3/16', 'bowl 3/16 corner');
    await setInput('#tt-name', '1/2 bowl bit', 'bowl name');
    await press('.tt-save', 'save bowl bit');
    await waitFor(`!!document.querySelector('.tt-form')?.hidden`, 'bowl saved');

    await press('.tt-close', 'close My bits');

    // Pick 1/4 90 V-bit in Pocket -> click Preview (worker generates clearing summary) -> verify note under Bit row
    await press('.cut-bit-trigger', 'open bit pop for V-bit');
    const vbSel = `.cut-bit-opt[data-bit="${await evalJs(`[...document.querySelectorAll('.cut-bit-opt')].find(e => e.textContent.includes('1/4 90 V-bit'))?.dataset.bit`)}"]`;
    await press(vbSel, 'pick V-bit');
    await press('.cut-preview', 'preview V-bit pocket clearing');
    await waitFor(`!document.querySelector('.cut-row[data-row="bit"] .cut-bit-note').hidden && /V-bit pocket:/.test(document.querySelector('.cut-row[data-row="bit"] .cut-bit-note').textContent)`, 'V-bit pocket note visible', 20000);
    const vbNote = await evalJs(`document.querySelector('.cut-row[data-row="bit"] .cut-bit-note').textContent`);
    assert.match(vbNote, /^V-bit pocket: \d+ passes per depth with a 0\.508 mm tip$/, `${tag}: V-bit note format`);
    console.log(`${tag} V-bit pocket note:`, vbNote);
    await evalJs(`document.querySelector('.cut-row[data-row="bit"] .cut-bit-note').scrollIntoView({ block: 'nearest' })`);
    await sleep(100);
    await shot(`card-vbit-note-${tag}.png`, '.cut-card', 8);

    // Pick 1/2 ball nose in Pocket -> verify scallop note + inspect 3D Review
    await press('.cut-bit-trigger', 'open bit pop for ball nose');
    const bnSel = `.cut-bit-opt[data-bit="${await evalJs(`[...document.querySelectorAll('.cut-bit-opt')].find(e => e.textContent.includes('1/2 ball nose'))?.dataset.bit`)}"]`;
    await press(bnSel, 'pick ball nose');
    await waitFor(`/Flat width/.test(document.querySelector('.cut-row[data-row="bit"] .cut-bit-note').textContent)`, 'ball nose scallop note visible');
    const bnNote = await evalJs(`document.querySelector('.cut-row[data-row="bit"] .cut-bit-note').textContent`);
    assert.match(bnNote, /^Flat width 0 mm per pass; scallop [0-9.]+ mm between passes$/, `${tag}: ball nose scallop note`);
    console.log(`${tag} ball nose pocket note:`, bnNote);
    await evalJs(`document.querySelector('.cut-row[data-row="bit"] .cut-bit-note').scrollIntoView({ block: 'nearest' })`);
    await sleep(100);
    await shot(`card-ballnose-note-${tag}.png`, '.cut-card', 8);

    // Check 3D Review for programmed ball-nose pocket (desktop captures zoomed 3D close-up)
    await press('.cut-ok', 'commit ball nose pocket');
    await openStage('review', 'open Export 3D for ball nose pocket');
    await waitFor(REVIEW_BUILT, '3D built for ball nose pocket', 25000);
    await press('#review-reset', 'reset 3D view');
    await sleep(400);
    if (!phone) {
      // Zoom in closer with wheel events onto pocket floor to inspect pass profile clearly
      const rc = await evalJs(`(() => { const r = document.querySelector('#review-canvas-host').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
      for (let i = 0; i < 6; i++) {
        await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: rc.x, y: rc.y, deltaX: 0, deltaY: -180 });
        await sleep(60);
      }
      await sleep(300);
      await shot(`review-3d-ballnose-pocket-${tag}.png`, '#review-canvas-host', 0);
    }

    // Back to Prepare, switch bit to 1/2 bowl bit -> verify scallop note & 3D Review
    await openStage('prepare', 'back to prepare for bowl bit');
    if (phone) {
      await press('.ops-head', 'open operations sheet on phone');
      await waitFor(`!!document.querySelector('.ops-row')?.getBoundingClientRect().height`, 'ops row visible on phone');
    }
    await press('.ops-row', 'select op row');
    await waitFor(`!!document.querySelector('.ops-edit')`, 'edit button visible');
    await press('.ops-edit', 'open pocket op');
    await press('.cut-bit-trigger', 'open bit pop for bowl bit');
    const bwSel = `.cut-bit-opt[data-bit="${await evalJs(`[...document.querySelectorAll('.cut-bit-opt')].find(e => e.textContent.includes('1/2 bowl bit'))?.dataset.bit`)}"]`;
    await press(bwSel, 'pick bowl bit');
    await waitFor(`/Flat width 3\\.175 mm/.test(document.querySelector('.cut-row[data-row="bit"] .cut-bit-note').textContent)`, 'bowl scallop note visible');
    const bwNote = await evalJs(`document.querySelector('.cut-row[data-row="bit"] .cut-bit-note').textContent`);
    assert.match(bwNote, /^Flat width 3\.175 mm per pass; scallop [0-9.]+ mm between passes$/, `${tag}: bowl scallop note`);
    console.log(`${tag} bowl pocket note:`, bwNote);
    await press('.cut-ok', 'commit bowl pocket');
    if (!phone) {
      await openStage('review', 'open Export 3D for bowl pocket');
      await waitFor(REVIEW_BUILT, '3D built for bowl pocket', 25000);
      await press('#review-reset', 'reset 3D view');
      await sleep(400);
      const rc = await evalJs(`(() => { const r = document.querySelector('#review-canvas-host').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
      for (let i = 0; i < 6; i++) {
        await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: rc.x, y: rc.y, deltaX: 0, deltaY: -180 });
        await sleep(60);
      }
      await sleep(300);
      await shot(`review-3d-bowl-pocket-${tag}.png`, '#review-canvas-host', 0);
    }

    assert.deepStrictEqual(problems, [], `${tag}: no page exceptions`);
    console.log(`vbit-tipwidth-852d-${tag}-live: ok`);
  } finally {
    await cdp.close();
  }
}
