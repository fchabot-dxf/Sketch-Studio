// tests/pocket-auto-angle-853-live.test.js — TASK 853: AUTO raster angle in the real Shaper app, desktop 1280 x 800 (mm) + phone 390 x 844 (touch, in):
//   1. Draw a 30°-rotated 120 x 40 mm rectangle; open Pocket, set depth + bit, pick Clearing -> Raster.
//   2. Angle row offers Auto + 0°/45°/90° (Auto active, placeholder "Auto (30°)", unit ° hidden); Preview -> note "raster auto (30°)" & paths run at 30°.
//   3. Pick 45° + Preview -> value "45", unit ° shown, note "raster 45°" & paths run at 45°.
//   4. Pick Auto + Preview -> returns to Auto (30°), paths return to 30°; OK -> Operations row shows "raster auto (30°)".
// Screenshots saved to .evidence/853/.
import assert from 'node:assert';
import path from 'node:path';
import { openPocketPage } from './helpers/pocket-live.js';
import { previewLive, stepLive } from './helpers/prepare-open-live.js';
import { sleep } from './helpers/cdp-browser.js';

const EVIDENCE_DIR = path.resolve('.evidence/853');

const rot = (pts, deg) => {
  const th = (deg * Math.PI) / 180, c = Math.cos(th), s = -Math.sin(th);
  return pts.map(([x, y]) => [x * c - y * s, x * s + y * c]);
};
const RECT30 = rot([[-60, -20], [60, -20], [60, 20], [-60, 20]], 30).map(([x, y]) => [x + 60, y + 40]);

async function checkPhase(phone) {
  const D = phone ? 'phone' : 'desktop';
  const t = await openPocketPage({ tag: `853-auto-${D}`, phone, evidenceDir: EVIDENCE_DIR });
  if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); return false; }
  try {
    const { evalJs, waitFor, openMode, clickEl, clickWorld, pickType, typeField, pickClearing, card, shot, shotWorld } = t;
    const raw = { phone, evalJs, waitFor, clickEl };
    const preview = () => previewLive(raw, `${D}: Preview`);

    await openMode('design');
    await waitFor('!!(window.__designController && window.__designController.state)', 'design ready');
    await evalJs(`(() => {
      const st = window.__designController.state;
      for (const k of [...st.joints.keys()]) st.joints.delete(k);
      st.shapes.length = 0; st.constraints.length = 0;
      const pts = ${JSON.stringify(RECT30)};
      pts.forEach(([x, y], i) => st.joints.set('rj' + i, { x, y }));
      pts.forEach((_, i) => st.shapes.push({ id: 'rs' + i, type: 'line', joints: ['rj' + i, 'rj' + ((i + 1) % pts.length)] }));
      st.saveState('draw');
    })()`);

    await openMode('prepare');
    if (phone && !await evalJs(`document.querySelector('#prepare-ops .ops-body').hidden`)) await clickEl('#prepare-ops .ops-head');
    await clickWorld(60, 40);
    await pickType('pocket');
    await typeField('.cut-depth', phone ? '0.25' : '6');
    await typeField('.cut-bit', phone ? '0.25' : '6');
    await pickClearing('raster');

    const readAngleRow = () => evalJs(`(() => {
      const row = document.querySelector('.cut-row[data-row="rasterAngle"]');
      const inp = row.querySelector('.cut-raster-angle');
      const unit = row.querySelector('.cut-unit-fixed');
      const presets = [...row.querySelectorAll('.cut-preset')].map((b) => ({ label: b.textContent, val: b.dataset.value, active: b.classList.contains('is-active') }));
      return { value: inp.value, placeholder: inp.placeholder, unitHidden: unit.hidden, presets };
    })()`);

    const rAuto = await readAngleRow();
    assert.deepStrictEqual(rAuto.presets.map((p) => p.label + (p.active ? '*' : '')), ['Auto*', '0°', '45°', '90°'], `${D}: Angle presets offer Auto (active) + 0°/45°/90°`);
    assert.strictEqual(rAuto.value, '', `${D}: Auto input value is empty`);
    assert.strictEqual(rAuto.placeholder, 'Auto (30°)', `${D}: Auto placeholder shows resolved 30°`);
    assert.strictEqual(rAuto.unitHidden, true, `${D}: unit ° hidden while Auto`);

    await preview();
    const cAuto = await card();
    assert.ok(/^Pocket: raster auto \(30°\): \d+ passes \+ 1 ring \+ wall/.test(cAuto.note[0]), `${D}: note shows raster auto (30°): ${cAuto.note[0]}`);

    const dominantPathAngle = () => evalJs(`(() => {
      const ds = [...document.querySelectorAll('#prepare-toolpath-group .sk-clear-path')].map((p) => p.getAttribute('d')).join(' ');
      const toks = ds.match(/[ML][^MLZ]*/g) || [];
      const pts = [];
      for (const tok of toks) { const nums = tok.slice(1).trim().split(/[ ,]+/).map(Number); if (nums.length >= 2) pts.push({ cmd: tok[0], x: nums[0], y: nums[1] }); }
      let best = { len: 0, ang: null };
      for (let i = 1; i < pts.length; i++) {
        if (pts[i].cmd === 'M') continue;
        const dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y, L = Math.hypot(dx, dy);
        if (L > best.len) {
          let ang = ((Math.atan2(-dy, dx) * 180) / Math.PI % 180 + 180) % 180;
          if (ang > 179.99) ang = 0;
          best = { len: L, ang };
        }
      }
      return best;
    })()`);

    const pAuto = await dominantPathAngle();
    assert.ok(pAuto.len > 40 && Math.abs(pAuto.ang - 30) < 0.2, `${D}: paths run along 30° (${JSON.stringify(pAuto)})`);
    await evalJs(`document.querySelector('.cut-row[data-row="rasterAngle"]').scrollIntoView({ block: 'center' })`);
    await sleep(100);
    await shot(`${D}-card-auto.png`, '#prepare-panel .cut-card', 2);
    await shotWorld(`${D}-paths-auto30.png`, [-10, -25, 130, 105]);

    // Switch to 45° preset and verify paths follow
    await clickEl('.cut-row[data-row="rasterAngle"] .cut-preset[data-value="45"]');
    await sleep(200);
    const r45 = await readAngleRow();
    assert.deepStrictEqual(r45.presets.map((p) => p.label + (p.active ? '*' : '')), ['Auto', '0°', '45°*', '90°'], `${D}: 45° active`);
    assert.strictEqual(r45.value, '45', `${D}: 45° input value`);
    assert.strictEqual(r45.unitHidden, false, `${D}: unit ° shown for numeric angle`);
    await preview();
    const c45 = await card();
    assert.ok(/^Pocket: raster 45°:/.test(c45.note[0]), `${D}: note updates to raster 45°: ${c45.note[0]}`);
    const p45 = await dominantPathAngle();
    assert.ok(p45.len > 15 && Math.abs(p45.ang - 45) < 0.2, `${D}: paths follow 45° (${JSON.stringify(p45)})`);
    await shotWorld(`${D}-paths-45.png`, [-10, -25, 130, 105]);

    // Switch back to Auto preset and confirm paths follow back to 30°
    await clickEl('.cut-row[data-row="rasterAngle"] .cut-preset[data-value="auto"]');
    await sleep(200);
    await preview();
    const pBack = await dominantPathAngle();
    assert.ok(pBack.len > 40 && Math.abs(pBack.ang - 30) < 0.2, `${D}: paths return to 30° on Auto (${JSON.stringify(pBack)})`);

    // OK and check Operations row shows raster auto (30°)
    await stepLive(raw, () => clickEl('#prepare-panel .cut-ok'));
    await sleep(300);
    if (phone && await evalJs(`document.querySelector('#prepare-ops .ops-body').hidden`)) await clickEl('#prepare-ops .ops-head');
    const opsText = await evalJs(`[...document.querySelectorAll('#prepare-ops .ops-row')].map((r) => r.querySelector('.ops-name').textContent + ' | ' + r.querySelector('.ops-sub').textContent)`);
    assert.ok(opsText.some((s) => /raster auto \(30°\)/.test(s)), `${D}: Operations row shows raster auto (30°): ${JSON.stringify(opsText)}`);
    await shot(`${D}-ops-auto.png`, '#prepare-ops', 2);

    return true;
  } finally {
    await t.close();
  }
}

if (!await checkPhase(false)) process.exit(0);
await checkPhase(true);
console.log('pocket-auto-angle-853-live.test.js: ok');
