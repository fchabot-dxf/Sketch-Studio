import { dbg } from '#core/debug.js';
import { TOOL_MODES, RECT_MODES, SLOT_MODES, ARC_MODES } from '#core/constants.js';
import { runExport } from './export-manager.js';
import { showNotification } from '#ui/notification-manager.js';
import { switchToTool } from '#ui/input-manager.js';
import { createToolRibbon } from '#ui/tool-ribbon.js';

export function setupUI(state){
  // S7c-2d / TASK 1005: the shared tool ribbon routes tool clicks directly to switchToTool (the ONE activation path shared with Shaper, Pen Plotter, Trace and keyboard shortcuts).
  let toolRibbon = null;

  // Track rect and slot sub-modes
  state.rectMode = RECT_MODES.TWO_POINT; // default: 2-point corner rect
  state.slotMode = SLOT_MODES.CENTER_TO_CENTER; // default: center-to-center slot

  // Arc: single-mode (Center-Start-End) — no dropdown
  if(!state.arcMode) state.arcMode = ARC_MODES.CENTER_START_END;

  // Mount the shared tool ribbon into #toolsRibbon (no host onToolClick override — uses shared switchToTool).
  try {
    const trEl = document.getElementById('toolsRibbon');
    if (trEl) {
      trEl.innerHTML = '';
      toolRibbon = createToolRibbon({
        state,
        appId: 'sketchstudio', // TASK 647: the user's ribbon layout is kept per app
      });
      toolRibbon.render(trEl);
    }
  } catch (e) { try { dbg.warn('app', '[ui-manager] tool ribbon mount failed', e); } catch (_) {} }

  // Initially activate select tool through the shared path
  switchToTool(state, TOOL_MODES.SELECT);
  if (toolRibbon) toolRibbon.refresh();

  // Add touch / pointer-based drag-to-scroll for toolbar (mobile-friendly)
  try {
    const ribbon = document.getElementById('toolsRibbon');
    if (ribbon) {
      let isDown = false;
      let startX;
      let scrollLeft;
      let maxDragDist = 0;

      ribbon.addEventListener('pointerdown', (e) => {
        // Allow native touch scrolling (smoother and handles taps correctly)
        if (e.pointerType === 'touch') return;

        isDown = true;
        startX = e.clientX;
        scrollLeft = ribbon.scrollLeft;
        maxDragDist = 0;
        ribbon.style.scrollBehavior = 'auto'; // Disable smooth scroll for direct control
      });

      ribbon.addEventListener('pointerup', (e) => {
        if (!isDown) return;
        isDown = false;
        ribbon.classList.remove('dragging');
        ribbon.style.scrollBehavior = '';
        if (ribbon.hasPointerCapture(e.pointerId)) {
            try{ ribbon.releasePointerCapture(e.pointerId); }catch(_){}
        }
      });

      ribbon.addEventListener('pointermove', (e) => {
        if (!isDown) return;
        
        const x = e.clientX;
        const walk = (x - startX);
        maxDragDist = Math.max(maxDragDist, Math.abs(walk));

        // Only capture and scroll if moved beyond threshold (prevents blocking clicks)
        if (maxDragDist > 5) {
            if (!ribbon.hasPointerCapture(e.pointerId)) {
                ribbon.setPointerCapture(e.pointerId);
                ribbon.classList.add('dragging');
            }
            e.preventDefault();
            ribbon.scrollLeft = scrollLeft - walk;
        }
      });
    }
  } catch (_) { }

  // Ensure UI overlays that shouldn't block the canvas are non-interactive to pointer events
  try{
    document.querySelectorAll('.ui-overlay').forEach(el => el.style.pointerEvents = 'none');
  }catch(_){ }
  

  // TASK 618 / 619: Construction moved to .sk-canvas-corner (#ui/design-browser.js); Clear sketch and Recenter live in the shared app footer (#ui/app-footer.js)

  // S7c-2e: Export is a router-owned TAB now (no popup). The dead popup-open machinery (#btn-export, closeExport,
  // outside/Esc handlers) is removed; #btn-export-close is dropped; Cancel + a successful export return to Design
  // via the header tab (wired in main.js). Keep only the Export action.
  const exportDo = document.getElementById('btn-export-do');
  if (exportDo) exportDo.addEventListener('click', () => {
    const filename = document.getElementById('export-filename') ? document.getElementById('export-filename').value.trim() : 'sketch';
    const type = document.getElementById('export-type') ? document.getElementById('export-type').value : 'svg';
    const onlyLines = document.getElementById('export-only-lines') ? document.getElementById('export-only-lines').checked : true;
    const precision = document.getElementById('export-precision') ? parseInt(document.getElementById('export-precision').value, 10) : 6;
    const arcApprox = document.getElementById('export-approx-arcs') ? document.getElementById('export-approx-arcs').checked : false;
    const arcSeg = document.getElementById('export-arc-segments') ? parseInt(document.getElementById('export-arc-segments').value, 10) || 32 : 32;
    const scale = document.getElementById('export-scale') ? parseFloat(document.getElementById('export-scale').value) || 1 : 1;
    const invertY = document.getElementById('export-invert-y') ? !!document.getElementById('export-invert-y').checked : false;
    const dxfVersion = document.getElementById('export-dxf-version') ? document.getElementById('export-dxf-version').value : 'r12';

    const opts = { precision, arcApprox, arcSeg, scale, invertY, dxfVersion };

    runExport(state, filename, type, opts, showNotification);
    // S7c-2e: the router returns to Design (main.js's #btn-export-do handler) — no popup hide here.
  });
  
  // S7c-2d: expose the shared ribbon (main.js's render loop calls refresh() so KEYBOARD tool-switches sync) + setTool.
  return { ribbon: toolRibbon, setTool: (t) => switchToTool(state, t) };
}