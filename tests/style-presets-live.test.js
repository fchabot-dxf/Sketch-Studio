// tests/style-presets-live.test.js — TASK 604: user style presets in the shared Style panel, with real clicks / keys in SketchStudio and the Shaper:
// save after changing two knobs, switch to Default, pick the preset (both knobs back, nothing else moved), rename, delete (confirm), overwrite
// (confirm), persistence across a real reload, an invalid stored entry dropped without breaking the panel, and Reset keeping the presets.
import assert from 'node:assert';
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const FACTORY = (await import('../packages/core/settings-manager.js')).default.getDefaults(); // the factory look (task 614: read, not hard-coded)
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sendRealKey, sleep } from './helpers/cdp-browser.js';

const EVID = process.env.EVIDENCE_DIR ? path.resolve(process.env.EVIDENCE_DIR) : null;
if (EVID) fs.mkdirSync(EVID, { recursive: true });
const cdp = await launchBrowser({ tag: '604', width: 1000, height: 900 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, navigate } = cdp;
const P = '.sk-style-panel';
const SS = `http://127.0.0.1:${port}/apps/sketchstudio/index.html`;
const center = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return r.width && r.height ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; })()`);
const click = async (sel, clickCount = 1) => {
  await waitFor(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })()`, sel + ' visible');
  const c = await center(sel);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y, button: 'none', clickCount: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', buttons: 1, clickCount });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', buttons: 0, clickCount });
  await sleep(120);
};
const type = async (text) => { await send('Input.insertText', { text }); await sleep(60); };
const enter = () => sendRealKey(send, 'Enter', 'Enter', 13, 0, '\r');
const setKnob = async (key, value) => { await click(`${P} [data-key="${key}"]`, 3); await type(String(value)); };
const pickByName = (name) => evalJs(`(() => { const s = document.querySelector('${P} [data-key="STYLE_TEMPLATE"]'); const o = [...s.options].find((x) => x.textContent === ${JSON.stringify(name)}); if (!o) return null; s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); return o.value; })()`);
const state = () => evalJs(`(async () => { const S = (await import('/packages/core/settings-manager.js')).default; return S.getAll(); })()`);
const picker = () => evalJs(`(() => { const s = document.querySelector('${P} [data-key="STYLE_TEMPLATE"]'); return { value: s.options[s.selectedIndex].textContent, groups: [...s.querySelectorAll('optgroup')].map((g) => g.label + ':' + [...g.children].map((o) => o.textContent).join('/')) }; })()`);
const vis = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && !e.hidden && e.getBoundingClientRect().width > 0; })()`);
const asks = () => evalJs(`document.querySelectorAll('${P} .sk-style-ask').length`);
const askText = (sel) => evalJs(`document.querySelector('${P} .sk-style-ask ${sel}').textContent`);
const ask = (sel) => `${P} .sk-style-ask ${sel}`;
const loaded = async (what) => { await waitFor(`!!document.querySelector('.sk-header-style') && !!document.querySelector('${P}')`, what); };
const openPanel = async () => { await click('.sk-header-style'); await waitFor(`!document.querySelector('${P}').classList.contains('sk-hidden')`, 'the Style panel open'); };
const shot = async (name) => {
  if (!EVID) return;
  const r = await evalJs(`(() => { const r = document.querySelector('${P}').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, scale: 1 }; })()`);
  const s = await send('Page.captureScreenshot', { format: 'png', clip: r });
  fs.writeFileSync(path.join(EVID, name + '.png'), Buffer.from(s.data, 'base64'));
};
const BUILTIN = 'Built-in:Default/Fusion/Compact/Presentation';

try {
  await navigate(SS, 15000); await loaded('SketchStudio');
  await evalJs(`localStorage.clear()`);
  await navigate(SS, 15000); await loaded('SketchStudio reloaded clean');
  await openPanel();

  assert.ok(await vis(`${P} [data-action="save-preset"]`), 'Save as preset… is in the panel');
  assert.ok(!(await vis(`${P} [data-action="rename-preset"]`)) && !(await vis(`${P} [data-action="delete-preset"]`)), 'no Rename / Delete while a built-in is chosen');
  assert.deepStrictEqual((await picker()).groups, [BUILTIN], 'no My presets group before the first save');

  // 1. change two knobs, save as "Chunky"
  await setKnob('LINE_STROKE', 0.7); await setKnob('DASH_GAP_PX', 3);
  let s = await state();
  assert.strictEqual(s.LINE_STROKE, 0.7); assert.strictEqual(s.DASH_GAP_PX, 3);
  assert.strictEqual((await picker()).value, 'Custom', 'an edited knob shows Custom');
  await click(`${P} [data-action="save-preset"]`);
  assert.ok(await vis(ask('.sk-style-ask-input')), 'the name field appears inline');
  await click(ask('.ok'));
  assert.match(await askText('.sk-style-ask-err'), /Enter a name/, 'an empty name is refused in place');
  await type('fusion'); await enter();
  assert.match(await askText('.sk-style-ask-err'), /built-in/, 'a built-in name is refused');
  await click(ask('.sk-style-ask-input'), 3); await type('Chunky'); await enter();
  await waitFor(`!document.querySelector('${P} .sk-style-ask')`, 'the name field closed');
  assert.ok(await vis(P), 'saving does not close the panel');
  let pk = await picker();
  assert.deepStrictEqual(pk.groups, [BUILTIN, 'My presets:Chunky'], 'the preset is in its own group after the built-ins');
  assert.strictEqual(pk.value, 'Chunky', 'and chosen');
  assert.ok(await vis(`${P} [data-action="rename-preset"]`) && await vis(`${P} [data-action="delete-preset"]`), 'Rename / Delete show for a user preset');
  await shot('panel-with-user-preset');

  // 2. Default, then the preset again: both knobs back, nothing else changed
  await pickByName('Default');
  s = await state(); assert.strictEqual(s.LINE_STROKE, FACTORY.LINE_STROKE); assert.strictEqual(s.DASH_GAP_PX, FACTORY.DASH_GAP_PX);
  const beforePick = await state();
  await pickByName('Chunky');
  const afterPick = await state();
  assert.strictEqual(afterPick.LINE_STROKE, 0.7); assert.strictEqual(afterPick.DASH_GAP_PX, 3);
  const changed = Object.keys(afterPick).filter((k) => JSON.stringify(afterPick[k]) !== JSON.stringify(beforePick[k])).sort();
  assert.deepStrictEqual(changed, ['DASH_GAP_PX', 'LINE_STROKE', 'STYLE_TEMPLATE'], 'only the two knobs and the chosen id changed');

  // 3. persistence across a real reload (a new page, the same profile)
  await navigate(SS, 15000); await loaded('reloaded');
  await openPanel();
  pk = await picker();
  assert.strictEqual(pk.groups[1], 'My presets:Chunky', 'the preset survives a reload'); assert.strictEqual(pk.value, 'Chunky');
  await pickByName('Compact'); await pickByName('Chunky');
  assert.strictEqual((await state()).LINE_STROKE, 0.7, 'and applies after the reload');

  // 4. overwrite asks; Cancel keeps the old values, Overwrite replaces them
  await setKnob('LINE_STROKE', 1.9);
  await click(`${P} [data-action="save-preset"]`); await type('chunky'); await enter();
  assert.match(await askText('span'), /already exists\. Overwrite/, 'the overwrite question');
  await click(ask('.cancel'));
  assert.strictEqual(await asks(), 0);
  await pickByName('Default'); await pickByName('Chunky');
  assert.strictEqual((await state()).LINE_STROKE, 0.7, 'Cancel left the stored preset alone');
  await setKnob('LINE_STROKE', 1.9);
  await click(`${P} [data-action="save-preset"]`); await type('chunky'); await enter();
  await click(ask('.ok'));
  await pickByName('Default'); await pickByName('Chunky');
  assert.strictEqual((await state()).LINE_STROKE, 1.9, 'Overwrite replaced the values');
  assert.strictEqual((await picker()).groups[1], 'My presets:Chunky', 'still one preset, name as first saved');

  // 5. rename; Escape cancels the question only, the panel stays
  await click(`${P} [data-action="rename-preset"]`);
  await sendRealKey(send, 'Escape', 'Escape', 27);
  assert.strictEqual(await asks(), 0, 'Escape closes the question');
  assert.ok(await vis(P), 'and not the panel');
  await click(`${P} [data-action="rename-preset"]`); await click(ask('.sk-style-ask-input'), 3); await type('Heavy'); await click(ask('.ok'));
  assert.strictEqual((await picker()).groups[1], 'My presets:Heavy'); assert.strictEqual((await picker()).value, 'Heavy');
  assert.strictEqual((await state()).LINE_STROKE, 1.9, 'renaming changes no setting');

  // 6. Reset keeps the user's presets; a built-in has no Rename / Delete
  await click(`${P} .sk-style-foot .sk-style-btn`);
  assert.strictEqual((await state()).LINE_STROKE, FACTORY.LINE_STROKE, 'Reset restored the factory look');
  assert.strictEqual((await picker()).groups[1], 'My presets:Heavy', 'Reset kept the preset');
  assert.ok(!(await vis(`${P} [data-action="delete-preset"]`)), 'Default has no Delete');

  // 7. delete asks first
  await pickByName('Heavy');
  await click(`${P} [data-action="delete-preset"]`);
  assert.match(await askText('span'), /Delete the preset "Heavy"/);
  await click(ask('.cancel'));
  assert.strictEqual((await picker()).groups.length, 2, 'Cancel kept it');
  await click(`${P} [data-action="delete-preset"]`); await click(ask('.ok'));
  assert.deepStrictEqual((await picker()).groups, [BUILTIN], 'Delete removed it and its group');
  assert.ok(await vis(P), 'the panel is still open');

  // 8. an invalid stored entry is dropped; the good one and the panel survive (checked after a real reload)
  const goodSettings = await evalJs(`(async () => { const S = (await import('/packages/core/settings-manager.js')).default; return S.getAll(); })()`);
  const KEYS = ['LINE_STROKE', 'JOINT_RADIUS', 'JOINT_STROKE_MULT', 'SELECTION_FEEDBACK_MULT', 'HOVER_FEEDBACK_MULT', 'GLYPH_SYMBOL_SIZE_PX', 'GLYPH_INFERENCE_SIZE_PX', 'GLYPH_OFFSET_PX', 'GLYPH_OUTLINE_PX', 'GLOW_WIDTH_PX', 'DASH_LENGTH_PX', 'DASH_GAP_PX', 'DIM_LABEL_BOX', 'HOVER_COLOR', 'FIXED_JOINT_FILL', 'LABEL_FONT_FAMILY', 'PROFILE_FILL', 'LOCKED_LINE_COLOR'];
  const good = Object.fromEntries(KEYS.map((k) => [k, goodSettings[k]]));
  const stored = { v: 1, presets: [{ id: 'user-bad', name: 'Broken', settings: { LINE_STROKE: 'x' } }, { id: 'user-ok', name: 'Survivor', settings: good }] };
  await evalJs(`(() => { const raw = JSON.parse(localStorage.getItem('sketch-studio-settings') || '{}'); raw.STYLE_PRESETS = ${JSON.stringify(stored)}; localStorage.setItem('sketch-studio-settings', JSON.stringify(raw)); })()`);
  await navigate(SS, 15000); await loaded('reloaded with a bad entry');
  await openPanel();
  assert.strictEqual((await picker()).groups[1], 'My presets:Survivor', 'the bad entry is dropped, the good one is kept');
  assert.ok(await vis(`${P} [data-action="save-preset"]`), 'the panel still works');

  // 9. the Shaper gets it from the same shared panel
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 15000);
  await waitFor(`!!document.querySelector('${P}')`, 'the Shaper Style panel');
  assert.ok(await evalJs(`!!document.querySelector('${P} [data-action="save-preset"]')`), 'Shaper: Save as preset… comes from the shared panel');
  assert.ok(await evalJs(`[...document.querySelector('${P} [data-key="STYLE_TEMPLATE"]').options].some((o) => o.textContent === 'Survivor')`), 'Shaper: the same presets, same storage');
  console.log('style-presets-live.test.js passed');
} finally {
  await cdp.close();
}
