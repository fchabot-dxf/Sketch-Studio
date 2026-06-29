// packages/ui/style-panel.js — the shared sketcher STYLE panel (S7c-2b).
// DOM-ownership INVERSION vs apps/sketchstudio/ui/settings-panel.js: that file ADOPTS pre-existing #s-* HTML via
// getElementById; this shared panel BUILDS its own DOM from a control SPEC (a bare host has no #s-* markup) and
// owns its open/close. The 16 controls ARE the shared renderer knobs — they read/write the already-shared
// SettingsManager (#core/settings-manager.js), so the shared renderer reacts live. App-agnostic chrome; themed via
// --sk-* (light defaults → SketchStudio); self-contained <style>. Imports ONLY the settings store.

import SettingsManager from '#core/settings-manager.js';

// The shared sketcher-rendering controls. Labels are the EXACT text from #settings-panel (index.html) — faithful
// for the S7c-2c swap. min/max/step carried from settings-panel.js sliderSpecs. SHOW_GRID = checkbox; the rest =
// number + paired range slider.
const CONTROLS = [
  { key: 'SHOW_GRID',               label: 'Show Grid',            type: 'checkbox' },
  { key: 'SNAP_MAGNETISM',          label: 'Snap Magnetism',       min: 2,   max: 40,  step: 1 },
  { key: 'GRID_MAGNETISM',          label: 'Grid Magnetism',       min: 2,   max: 40,  step: 1 },
  { key: 'GRID_SIZE',               label: 'Grid Size',            min: 0.5, max: 20,  step: 0.5 },
  { key: 'GRID_MAJOR_STEP',         label: 'Grid Major Step',      min: 1,   max: 50,  step: 1 },
  { key: 'LINE_STROKE',             label: 'Line Stroke',          min: 0.1, max: 5,   step: 0.1 },
  { key: 'JOINT_RADIUS',            label: 'Joint Radius',         min: 0.1, max: 12,  step: 0.1 },
  { key: 'JOINT_STROKE_MULT',       label: 'Joint Stroke Mult',    min: 0.1, max: 5,   step: 0.1 },
  { key: 'SELECTION_FEEDBACK_MULT', label: 'Selection Stroke Mult', min: 0.1, max: 6,  step: 0.1 },
  { key: 'HOVER_FEEDBACK_MULT',     label: 'Hover Stroke Mult',    min: 0.1, max: 6,   step: 0.1 },
  { key: 'GLYPH_SYMBOL_SIZE_PX',    label: 'Glyph Icon Size',      min: 8,   max: 48,  step: 1 },
  { key: 'GLYPH_INFERENCE_SIZE_PX', label: 'Glyph Inference Size', min: 8,   max: 64,  step: 1 },
  { key: 'GLYPH_OFFSET_PX',         label: 'Glyph Offset',         min: 0,   max: 200, step: 1 },
  { key: 'GLOW_WIDTH_PX',           label: 'Glow Width',           min: 0,   max: 80,  step: 1 },
  { key: 'DASH_LENGTH_PX',          label: 'Dash Length',          min: 1,   max: 40,  step: 1 },
  { key: 'DASH_GAP_PX',             label: 'Dash Gap',             min: 1,   max: 40,  step: 1 },
];

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined' || !document.head) return;
  if (document.getElementById('sk-style-panel-styles')) { stylesInjected = true; return; }
  const s = document.createElement('style');
  s.id = 'sk-style-panel-styles';
  s.textContent = `
.sk-style-panel { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 10000;
  width: 320px; max-height: 82vh; overflow: auto; box-sizing: border-box; padding: 14px;
  background: var(--sk-style-bg, #fff); color: var(--sk-style-fg, #334155);
  border: 1px solid var(--sk-style-sep, #cbd5e1); border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,0.25);
  font: 12px system-ui, sans-serif; }
.sk-style-panel.sk-hidden { display: none; }
.sk-style-panel * { box-sizing: border-box; }
.sk-style-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.sk-style-title { color: var(--sk-selection, #3B82F6); font-size: 13px; font-weight: 600; text-transform: uppercase; }
.sk-style-close { background: none; border: 0; cursor: pointer; font-size: 18px; line-height: 1;
  color: var(--sk-style-muted, #64748b); }
.sk-style-body { display: flex; flex-direction: column; gap: 8px; }
.sk-style-row { display: flex; flex-direction: column; gap: 4px; }
.sk-style-rowtop { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.sk-style-input { width: 80px; text-align: right; padding: 2px 4px; border-radius: 4px; background: transparent;
  color: inherit; border: 1px solid var(--sk-style-sep, #cbd5e1); }
.sk-style-input[type="checkbox"] { width: auto; }
.sk-style-slider { width: 100%; accent-color: var(--sk-selection, #3B82F6); cursor: pointer; }
.sk-style-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.sk-style-btn { padding: 4px 10px; border-radius: 6px; cursor: pointer; background: transparent; color: inherit;
  border: 1px solid var(--sk-style-sep, #cbd5e1); }
.sk-style-btn-primary { background: var(--sk-selection, #3B82F6); color: #fff; border-color: transparent; }
`;
  document.head.appendChild(s);
  stylesInjected = true;
}

/**
 * createStylePanel({ settings, onSaveProject, onNotify, title }) → { el, open, close, toggle, render, destroy }
 *   settings: the SettingsManager-like store (get/set/getAll/subscribe→unsub/resetToDefaults). Defaults to the
 *     shared #core singleton; injectable so a smoke can pass a fresh manager.
 *   onSaveProject(): if given, a "Save (Project)" button is rendered (app-specific; e.g. saveProjectFile). Omitted
 *     → no Save button (Shaper).
 *   onNotify(msg): optional toast hook (no Tailwind dependency here).
 *   title: header text (default 'Style').
 */
export function createStylePanel({ settings = SettingsManager, onSaveProject = null, onNotify = null, title = 'Style' } = {}) {
  injectStyles();
  const controlEls = {}; // key -> { input, slider? }
  let isOpen = false, escHandler = null, outsideHandler = null;
  const notify = (m) => { if (typeof onNotify === 'function') { try { onNotify(m); } catch (_) {} } };

  const el = document.createElement('div'); el.className = 'sk-style-panel sk-hidden';

  // Header
  const head = document.createElement('div'); head.className = 'sk-style-head';
  const titleEl = document.createElement('div'); titleEl.className = 'sk-style-title'; titleEl.textContent = title;
  const closeX = document.createElement('button'); closeX.type = 'button'; closeX.className = 'sk-style-close'; closeX.textContent = '✕';
  closeX.addEventListener('click', () => close());
  head.append(titleEl, closeX);

  // Body (16 controls from the spec)
  const body = document.createElement('div'); body.className = 'sk-style-body';
  for (const spec of CONTROLS) body.appendChild(buildControl(spec));

  // Footer (Reset + Close, + optional Save)
  const foot = document.createElement('div'); foot.className = 'sk-style-foot';
  if (typeof onSaveProject === 'function') {
    const save = document.createElement('button'); save.type = 'button'; save.className = 'sk-style-btn sk-style-btn-primary'; save.textContent = 'Save (Project)';
    save.addEventListener('click', () => { try { onSaveProject(settings.getAll()); } catch (_) {} });
    foot.appendChild(save);
  }
  const resetBtn = document.createElement('button'); resetBtn.type = 'button'; resetBtn.className = 'sk-style-btn'; resetBtn.textContent = 'Reset';
  resetBtn.addEventListener('click', () => { settings.resetToDefaults(); populate(); notify('Reset to factory defaults.'); });
  const closeBtn = document.createElement('button'); closeBtn.type = 'button'; closeBtn.className = 'sk-style-btn'; closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', () => close());
  foot.append(resetBtn, closeBtn);

  el.append(head, body, foot);

  function buildControl(spec) {
    const row = document.createElement('div'); row.className = 'sk-style-row';
    const top = document.createElement('div'); top.className = 'sk-style-rowtop';
    const lab = document.createElement('span'); lab.className = 'sk-style-label'; lab.textContent = spec.label;
    top.appendChild(lab);
    if (spec.type === 'checkbox') {
      const input = document.createElement('input'); input.type = 'checkbox'; input.className = 'sk-style-input'; input.dataset.key = spec.key;
      input.addEventListener('change', () => settings.set(spec.key, !!input.checked, { persist: 'local' }));
      top.appendChild(input); row.appendChild(top);
      controlEls[spec.key] = { input };
    } else {
      const input = document.createElement('input'); input.type = 'number'; input.className = 'sk-style-input'; input.dataset.key = spec.key;
      input.min = String(spec.min); input.max = String(spec.max); input.step = String(spec.step);
      const slider = document.createElement('input'); slider.type = 'range'; slider.className = 'sk-style-slider';
      slider.min = String(spec.min); slider.max = String(spec.max); slider.step = String(spec.step);
      const write = (v) => settings.set(spec.key, Number(v), { persist: 'local' });
      input.addEventListener('input', () => { slider.value = input.value; write(input.value); });
      input.addEventListener('change', () => { slider.value = input.value; write(input.value); });
      slider.addEventListener('input', () => { input.value = slider.value; write(slider.value); });
      top.appendChild(input); row.append(top, slider);
      controlEls[spec.key] = { input, slider };
    }
    return row;
  }

  function populate() {
    const all = settings.getAll();
    for (const spec of CONTROLS) {
      const c = controlEls[spec.key]; if (!c) continue;
      const v = all[spec.key];
      if (spec.type === 'checkbox') { c.input.checked = !!v; }
      else { c.input.value = v; if (c.slider) c.slider.value = v; }
    }
  }

  // Live re-populate on any external change. subscribe RETURNS its unsubscribe — keep it; call it in destroy().
  const unsub = settings.subscribe(() => { try { populate(); } catch (_) {} });

  function open() {
    if (isOpen) return;
    isOpen = true; el.classList.remove('sk-hidden'); populate();
    escHandler = (e) => { if (e.key === 'Escape') close(); };
    outsideHandler = (e) => { if (!el.contains(e.target)) close(); };
    document.addEventListener('keydown', escHandler);
    setTimeout(() => { if (isOpen) document.addEventListener('click', outsideHandler); }, 0); // defer so the opening click doesn't close it
  }
  function close() {
    if (!isOpen) return;
    isOpen = false; el.classList.add('sk-hidden');
    if (escHandler) { document.removeEventListener('keydown', escHandler); escHandler = null; }
    if (outsideHandler) { document.removeEventListener('click', outsideHandler); outsideHandler = null; }
  }
  function toggle() { isOpen ? close() : open(); }

  populate();
  return {
    el, open, close, toggle,
    render: (container) => { if (container) container.appendChild(el); return el; },
    destroy: () => { close(); try { unsub && unsub(); } catch (_) {} try { el.remove(); } catch (_) {} },
  };
}
