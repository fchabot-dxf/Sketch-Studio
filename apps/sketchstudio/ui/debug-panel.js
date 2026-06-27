// src/ui/debug-panel.js
// Dedicated Debug panel (separate from Tuning Wizard)
import SettingsManager from '#core/settings-manager.js';
import { dbg } from '#core/debug.js';
import { applyPanelStyle, createWizardPanel } from './wizard-base.js';

let panel = null;
let panelVisible = false;

export function setupDebugPanel(state) {
  // create floating panel similar to tuning wizard but minimal
  if (typeof document === 'undefined') return;
  if (panel) return; // idempotent

  // Create panel via shared factory (keeps header/close wiring consistent)
  const created = createWizardPanel({ id: 'debug-panel', title: '🖥 AI / Debug', closeId: 'debug-close-btn', width: 320, padding: 12, display: 'none', center: true });
  panel = created.panel;
  const header = created.header;

  // Helper to create checkbox rows (backed by SettingsManager)
  const createCheck = (label, key, hint) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:8px;';
    const checked = !!SettingsManager.get(key);
    row.innerHTML = `<div style="display:flex; flex-direction:column;"><span style="color:#cbd5e1; font-weight:600">${label}</span>${hint?`<span style="color:#475569; font-size:11px; opacity:0.8;">${hint}</span>`:''}</div><input id="dbg-${key}" type="checkbox" ${checked? 'checked':''} />`;
    const input = row.querySelector('input');
    input.addEventListener('change', (e) => { SettingsManager.set(key, !!e.target.checked); });
    panel.appendChild(row);
  };

  // Top-level Show Debug Overlay toggle — placed at the top of the panel for discoverability
  const topShowRow = document.createElement('div');
  topShowRow.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;';
  const topShowChecked = !!SettingsManager.get('SHOW_DEBUG_OVERLAY');
  topShowRow.innerHTML = `<div style="display:flex;flex-direction:column;"><span style="color:#cbd5e1; font-weight:600">Show Debug Overlay</span><span style="color:#475569; font-size:11px; opacity:0.8;">Global debug overlay (labels, whiskers, health)</span></div><input id="dbg-SHOW_DEBUG_OVERLAY" type="checkbox" ${topShowChecked ? 'checked' : ''} />`;
  topShowRow.querySelector('input').addEventListener('change', (e) => { SettingsManager.set('SHOW_DEBUG_OVERLAY', !!e.target.checked); });
  // Insert the toggle immediately after the header (prepend to panel so it appears first)
  panel.insertBefore(topShowRow, panel.children[1] || null);

  // Core debug toggles moved here
  createCheck('Show Tension', 'SHOW_TENSION', 'Line dashes + glyph scaling');
  createCheck('Show Freedom', 'SHOW_FREEDOM', 'Vertex labels + movement whiskers');
  createCheck('Show Health', 'SHOW_HEALTH', 'Cluster glow + damping pulse');

  // AI Vision master toggle
  const aiRow = document.createElement('div');
  aiRow.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;';
  const aiChecked = !!SettingsManager.get('AI_VISION');
  aiRow.innerHTML = `<div style="display:flex;flex-direction:column;"><span style="color:#cbd5e1; font-weight:600">Enable AI Vision</span><span style="color:#475569; font-size:11px; opacity:0.8;">High-density debug for AI/OCR</span></div><input id="dbg-AI_VISION" type="checkbox" ${aiChecked? 'checked':''} />`;
  aiRow.querySelector('input').addEventListener('change', (e) => { SettingsManager.set('AI_VISION', !!e.target.checked); });
  panel.appendChild(aiRow);

  // ===== Debug Overlay Settings (moved from Tuning Wizard) =====
  const overlayHeader = document.createElement('div');
  overlayHeader.style.cssText = 'margin-top:8px; margin-bottom:8px; color:#64748b; font-weight:600; font-size:10px; text-transform:uppercase; letter-spacing:0.5px;';
  overlayHeader.innerText = 'Debug Overlay';
  panel.appendChild(overlayHeader);

  // Helper: create Settings slider for Debug panel (mirrors tuning-wizard behavior)
  const createSettingsSlider = (label, key, min, max, step, format = (v) => v) => {
    const row = document.createElement('div');
    row.style.cssText = 'margin-bottom: 10px;';
    const val = SettingsManager.get(key) ?? min;
    row.innerHTML = `
      <div style="display:flex; justify-content:space-between; margin-bottom:3px;">
        <span style="color:#cbd5e1;">${label}</span>
        <span id="dbg-${key}" style="color:#fbbf24; font-weight:500;">${format(val)}</span>
      </div>
      <input type="range" min="${min}" max="${max}" step="${step}" value="${val}"
             style="width:100%; accent-color:#3b82f6; cursor:pointer;">
    `;
    const input = row.querySelector('input');
    input.addEventListener('input', (e) => {
      const newVal = (step >= 1) ? parseInt(e.target.value, 10) : parseFloat(e.target.value);
      SettingsManager.set(key, newVal);
      document.getElementById(`dbg-${key}`).innerText = format(newVal);
      try {
        if (dbg && dbg.overlay) {
          if (key === 'DEBUG_OFFSET_X') dbg.overlay.setOffsetX(newVal);
          if (key === 'DEBUG_FOCUS_OPACITY') dbg.overlay.setFocusOpacity(newVal);
          if (key === 'DEBUG_SPRING_W') dbg.overlay.setSpringW(newVal);
        }
      } catch (_) {}
    });
    panel.appendChild(row);
  };

  /* Show Debug Overlay toggle moved to the top of the panel — placeholder removed here */

  // Overlay sliders
  createSettingsSlider('Debug Offset X', 'DEBUG_OFFSET_X', 0, 120, 1);
  createSettingsSlider('Focus Opacity', 'DEBUG_FOCUS_OPACITY', 0.0, 1.0, 0.05, (v) => v.toFixed(2));
  createSettingsSlider('Focus Spring (w)', 'DEBUG_SPRING_W', 1, 60, 1);
  createSettingsSlider('Label Line Spacing', 'DEBUG_LABEL_LINE_SPACING', 1.0, 5.0, 0.05, (v) => v.toFixed(2));
  createSettingsSlider('Label Inner Line Spacing', 'DEBUG_LABEL_INTRA_LINE_SPACING', 1.00, 1.50, 0.01, (v) => v.toFixed(2));
  createSettingsSlider('Label per-src gap', 'DEBUG_LABEL_PER_SRC_GAP', 0.5, 2.0, 0.05, (v) => v.toFixed(2));
  createSettingsSlider('Debug label font (px)', 'DEBUG_LABEL_FONT_SIZE', 6, 16, 1);
  createSettingsSlider('Whisker stroke (px)', 'DEBUG_WHISKER_STROKE_PX', 0.01, 3.0, 0.01, (v) => v.toFixed(2));

  // Close button handler
  panel.querySelector('#debug-close-btn').addEventListener('click', () => togglePanel(false));

  // Wire header button (exists in index.html)
  const debugBtn = document.getElementById('btn-debug-toggle');
  if (debugBtn) debugBtn.addEventListener('click', () => togglePanel());

  // Close on outside click
  document.addEventListener('mousedown', (e) => {
    if (panelVisible && panel && !panel.contains(e.target) && e.target.id !== 'btn-debug-toggle') togglePanel(false);
  });

  dbg.log('debug-panel', '[debug-panel] initialized');
}

function togglePanel(forceState) {
  panelVisible = typeof forceState === 'boolean' ? forceState : !panelVisible;
  if (!panel) return;
  panel.style.display = panelVisible ? 'block' : 'none';
  const btn = document.getElementById('btn-debug-toggle');
  if (btn) btn.classList.toggle('text-blue-400', panelVisible);
}
