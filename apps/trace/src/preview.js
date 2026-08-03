/**
 * preview.js
 * Manages the two preview panes:
 *   Left  — original image on <canvas> (with reference overlay SVG)
 *   Right — traced SVG output
 *
 * Exposes:
 *   setImage(canvas, w, h)   → draws the original into the preview canvas
 *   setSVG(svgString)        → injects traced SVG into right pane
 *   showTracing(bool)        → shows/hides the loading overlay on SVG pane
 *   getMaskedImageData()     → returns composited image data for tracing
 *   onMaskChanged(cb)        → registers a callback for when masking updates
 *   updateThresholdOverlay(params) → recalculates threshold preview and wand data
 */

export function initPreview(eventBus) {
  const originalCanvas = document.getElementById('original-canvas');
  const thresholdOverlay = document.getElementById('threshold-overlay');
  const svgPane        = document.getElementById('svg-pane');
  const svgOutput      = document.getElementById('svg-output');
  const traceOverlay   = document.getElementById('trace-overlay');
  const emptyState     = document.getElementById('svg-empty-state');

  // Hidden canvas strictly for storing the mask data (black/white)
  const maskDataCanvas = document.createElement('canvas');

  let currentTool = null; // 'include', 'exclude', 'wand-include', 'wand-exclude', or null
  let isDrawing = false;
  let lastPos = null;
  let onMaskCb = null;
  
  let lastParams = null; // Cache params for redrawing the overlay on stroke

  // Toolbar
  const maskBtns = document.querySelectorAll('.tr-mask-btn');
  maskBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tool = btn.dataset.tool;
      if (tool === 'clear') {
        clearMask();
        if (lastParams) updateThresholdOverlay(lastParams);
        if (onMaskCb) onMaskCb();
        return;
      }
      
      if (currentTool === tool) {
        currentTool = null; // toggle off
        btn.classList.remove('active');
      } else {
        maskBtns.forEach(b => b.classList.remove('active'));
        currentTool = tool;
        btn.classList.add('active');
      }
    });
  });

  function clearMask() {
    maskDataCanvas.width = originalCanvas.width;
    maskDataCanvas.height = originalCanvas.height;
  }

  function setImage(srcCanvas) {
    const ctx = originalCanvas.getContext('2d');
    originalCanvas.width  = srcCanvas.width;
    originalCanvas.height = srcCanvas.height;
    ctx.drawImage(srcCanvas, 0, 0);

    thresholdOverlay.width = srcCanvas.width;
    thresholdOverlay.height = srcCanvas.height;
    
    clearMask();

    // Also size the ref overlay SVG
    const refSvg = document.getElementById('ref-svg');
    if (refSvg) {
      refSvg.setAttribute('viewBox', `0 0 ${srcCanvas.width} ${srcCanvas.height}`);
    }
  }

  function setSVG(svgString) {
    if (!svgString) return;

    // Inject SVG
    svgOutput.innerHTML = svgString;

    // Make sure the SVG element fills the pane nicely while preserving aspect ratio
    const svgEl = svgOutput.querySelector('svg');
    if (svgEl) {
      svgEl.style.maxWidth  = '100%';
      svgEl.style.maxHeight = '100%';
      svgEl.style.width     = '100%';
      svgEl.style.height    = '100%';
    }

    if (emptyState) emptyState.style.display = 'none';
    showTracing(false);
  }

  function showTracing(visible) {
    traceOverlay.classList.toggle('visible', visible);
  }

  // ── Painting Logic ──
  
  function getEventCoord(e) {
    const rect = thresholdOverlay.getBoundingClientRect();
    const imgRatio = thresholdOverlay.width / thresholdOverlay.height;
    const rectRatio = rect.width / rect.height;
    
    let drawW = rect.width;
    let drawH = rect.height;
    let offsetX = 0;
    let offsetY = 0;
    
    if (imgRatio > rectRatio) {
      drawH = rect.width / imgRatio;
      offsetY = (rect.height - drawH) / 2;
    } else {
      drawW = rect.height * imgRatio;
      offsetX = (rect.width - drawW) / 2;
    }
    
    const x = ((e.clientX - rect.left - offsetX) / drawW) * thresholdOverlay.width;
    const y = ((e.clientY - rect.top - offsetY) / drawH) * thresholdOverlay.height;
    return { x, y };
  }

  function drawStroke(p1, p2) {
    const brushInput = document.getElementById('brush-size');
    const brushSize = brushInput ? parseInt(brushInput.value, 10) : 30;
    
    // Draw to hidden mask data canvas (solid white for exclude, solid black for include)
    const mCtx = maskDataCanvas.getContext('2d');
    mCtx.lineWidth = brushSize;
    mCtx.lineCap = 'round';
    mCtx.strokeStyle = (currentTool === 'exclude' || currentTool === 'wand-exclude') ? '#FFFFFF' : '#000000';
    mCtx.beginPath();
    mCtx.moveTo(p1.x, p1.y);
    mCtx.lineTo(p2.x, p2.y);
    mCtx.stroke();
    
    // Update the visual threshold overlay immediately
    if (lastParams) {
      updateThresholdOverlay(lastParams);
    }
  }

  function floodFillMask(startX, startY, isInclude) {
    startX = Math.floor(startX);
    startY = Math.floor(startY);
    const w = originalCanvas.width;
    const h = originalCanvas.height;
    if (startX < 0 || startX >= w || startY < 0 || startY >= h) return;
    
    const oCtx = originalCanvas.getContext('2d');
    const oData = oCtx.getImageData(0, 0, w, h).data;
    
    const startIdx = (startY * w + startX) * 4;
    const targetR = oData[startIdx];
    const targetG = oData[startIdx+1];
    const targetB = oData[startIdx+2];
    
    const tolInput = document.getElementById('wand-tolerance');
    const tolerance = tolInput ? parseInt(tolInput.value, 10) : 30;
    
    const visited = new Uint8Array(w * h);
    const stack = [startX, startY];
    visited[startY * w + startX] = 1;
    
    const mCtx = maskDataCanvas.getContext('2d');
    const mData = mCtx.getImageData(0, 0, w, h);
    
    const mR = isInclude ? 0 : 255;
    const mG = isInclude ? 0 : 255;
    const mB = isInclude ? 0 : 255;
    
    let filledCount = 0;
    
    while (stack.length > 0) {
      const y = stack.pop();
      const x = stack.pop();
      
      const pxIdx = (y * w + x) * 4;
      mData.data[pxIdx] = mR;
      mData.data[pxIdx+1] = mG;
      mData.data[pxIdx+2] = mB;
      mData.data[pxIdx+3] = 255;
      
      filledCount++;
      
      for (const [dx, dy] of [[1,0], [-1,0], [0,1], [0,-1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
          const idx = ny * w + nx;
          if (!visited[idx]) {
            const pIdx = idx * 4;
            const dr = oData[pIdx] - targetR;
            const dg = oData[pIdx+1] - targetG;
            const db = oData[pIdx+2] - targetB;
            // Euclidean distance
            const dist = Math.sqrt(dr*dr + dg*dg + db*db);
            if (dist <= tolerance) {
              visited[idx] = 1;
              stack.push(nx, ny);
            }
          }
        }
      }
    }
    
    if (filledCount > 0) {
      mCtx.putImageData(mData, 0, 0);
      if (lastParams) updateThresholdOverlay(lastParams);
    }
  }

  thresholdOverlay.addEventListener('pointerdown', e => {
    if (!currentTool) return;
    thresholdOverlay.setPointerCapture(e.pointerId);
    lastPos = getEventCoord(e);
    
    if (currentTool.startsWith('wand-')) {
      const isInclude = currentTool === 'wand-include';
      floodFillMask(lastPos.x, lastPos.y, isInclude);
      if (onMaskCb) onMaskCb();
    } else {
      isDrawing = true;
      drawStroke(lastPos, lastPos); // Draw a dot
    }
  });

  thresholdOverlay.addEventListener('pointermove', e => {
    if (!isDrawing) return;
    const pos = getEventCoord(e);
    drawStroke(lastPos, pos);
    lastPos = pos;
  });

  function stopDrawing() {
    if (!isDrawing) return;
    isDrawing = false;
    if (onMaskCb) onMaskCb(); // Trigger retrace when stroke ends
  }

  thresholdOverlay.addEventListener('pointerup', stopDrawing);
  thresholdOverlay.addEventListener('pointercancel', stopDrawing);

  // ── Compositing ──
  
  function getMaskedImageData() {
    // Return composited ImageData: original image + maskDataCanvas
    const w = originalCanvas.width;
    const h = originalCanvas.height;
    if (w === 0 || h === 0) return null;

    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = w;
    tmpCanvas.height = h;
    const tmpCtx = tmpCanvas.getContext('2d');

    // Draw original
    tmpCtx.drawImage(originalCanvas, 0, 0);
    // Draw mask over it
    tmpCtx.drawImage(maskDataCanvas, 0, 0);

    return tmpCtx.getImageData(0, 0, w, h);
  }

  function updateThresholdOverlay(params) {
    lastParams = params;
    const w = originalCanvas.width;
    const h = originalCanvas.height;
    if (w === 0 || h === 0) return;
    
    thresholdOverlay.width = w;
    thresholdOverlay.height = h;
    const tCtx = thresholdOverlay.getContext('2d');
    
    // Crucial: We get the masked image data so drawn strokes are treated as pure black/white!
    const imgData = getMaskedImageData();
    if (!imgData) return;
    const data = imgData.data;
    
    const tOut = tCtx.createImageData(w, h);
    
    for (let i = 0; i < data.length; i += 4) {
      const lum = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
      const isBlack = lum < params.threshold;
      
      if (isBlack && params.colorMode === 'bw') {
        tOut.data[i] = 0;
        tOut.data[i+1] = 120;
        tOut.data[i+2] = 255;
        tOut.data[i+3] = 150;
      } else {
        tOut.data[i+3] = 0;
      }
    }
    
    tCtx.putImageData(tOut, 0, 0);
  }

  return { 
    setImage, 
    setSVG, 
    showTracing, 
    getMaskedImageData,
    updateThresholdOverlay,
    onMaskChanged: cb => { onMaskCb = cb; }
  };
}
