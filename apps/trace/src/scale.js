/**
 * scale.js
 * Two scale modes:
 *   - Global:    user enters real-world width → scale (mm/px) computed
 *   - Reference: user draws a line on the canvas, enters known length → scale computed
 *
 * Unit toggle: mm / in — inputs accept whichever unit is active.
 * Internally everything is stored and emitted in mm.
 * Emits 'scaleChanged' with { scale: mm/px, unit: 'mm'|'in' } on the eventBus.
 */

const MM_PER_INCH = 25.4;

export function initScale(eventBus) {
  const globalTab    = document.getElementById('tab-global');
  const referenceTab = document.getElementById('tab-reference');
  const globalUI     = document.getElementById('global-scale-ui');
  const referenceUI  = document.getElementById('reference-scale-ui');

  const globalWidthInput = document.getElementById('global-width-val');
  const refLengthInput   = document.getElementById('ref-length-val');
  const refLineStatus    = document.getElementById('ref-line-status');
  const scaleReadout     = document.getElementById('scale-readout');
  const unitBtns         = document.querySelectorAll('.unit-toggle-btn');

  const canvas     = document.getElementById('original-canvas');
  const refOverlay = document.getElementById('ref-overlay');
  const refSvg     = document.getElementById('ref-svg');

  let mode      = 'global';
  let unit      = 'mm';        // 'mm' | 'in'
  let imageW    = 0;
  let imageH    = 0;
  let linePxLen = 0;
  let drawing   = false;
  let p1        = null;
  let p2        = null;

  // ── Unit toggle ───────────────────────────────────
  unitBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const prev = unit;
      unit = btn.dataset.unit;
      unitBtns.forEach(b => b.classList.toggle('active', b.dataset.unit === unit));
      convertInputs(prev, unit);
      updateUnitLabels();
      recalcAndEmit();
    });
  });

  function convertInputs(from, to) {
    // Convert whatever is in the input fields when switching units
    [globalWidthInput, refLengthInput].forEach(inp => {
      const v = parseFloat(inp.value);
      if (!isNaN(v) && v > 0) {
        inp.value = from === 'mm' && to === 'in'
          ? (v / MM_PER_INCH).toFixed(4)
          : (v * MM_PER_INCH).toFixed(2);
      }
    });
  }

  function updateUnitLabels() {
    document.querySelectorAll('.active-unit-label').forEach(el => {
      el.textContent = unit;
    });
    document.querySelectorAll('.unit-placeholder').forEach(el => {
      el.setAttribute('placeholder', unit === 'mm' ? 'e.g. 200' : 'e.g. 7.874');
    });
  }

  // ── Tab switching ─────────────────────────────────
  function setMode(m) {
    mode = m;
    [globalTab, referenceTab].forEach(t => t.classList.remove('active'));
    globalUI.classList.remove('visible');
    referenceUI.classList.remove('visible');
    if (m === 'global') {
      globalTab.classList.add('active');
      globalUI.classList.add('visible');
      refOverlay.classList.remove('interactive');
    } else {
      referenceTab.classList.add('active');
      referenceUI.classList.add('visible');
      refOverlay.classList.add('interactive');
    }
    recalcAndEmit();
  }

  globalTab.addEventListener('click',    () => setMode('global'));
  referenceTab.addEventListener('click', () => setMode('reference'));

  globalWidthInput.addEventListener('input', recalcAndEmit);
  refLengthInput.addEventListener('input',   recalcAndEmit);

  // ── Reference line drawing ─────────────────────────
  function canvasPoint(e) {
    const rect   = canvas.getBoundingClientRect();
    const scaleX = imageW / rect.width;
    const scaleY = imageH / rect.height;
    const src    = e.touches ? e.touches[0] : e;
    return {
      x: (src.clientX - rect.left) * scaleX,
      y: (src.clientY - rect.top)  * scaleY,
    };
  }

  function startDraw(e) {
    if (mode !== 'reference') return;
    e.preventDefault();
    drawing = true;
    p1 = canvasPoint(e);
    p2 = null;
    clearRefLine();
  }

  function moveDraw(e) {
    if (!drawing) return;
    e.preventDefault();
    p2 = canvasPoint(e);
    if (p1 && p2) renderRefLine(p1, p2);
  }

  function endDraw(e) {
    if (!drawing) return;
    e.preventDefault();
    drawing = false;
    if (!p2) return;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    linePxLen = Math.sqrt(dx*dx + dy*dy);
    refLineStatus.textContent = `Line drawn: ${Math.round(linePxLen)} image-px`;
    refLineStatus.classList.add('has-line');
    recalcAndEmit();
  }

  refOverlay.addEventListener('mousedown',  startDraw);
  refOverlay.addEventListener('mousemove',  moveDraw);
  refOverlay.addEventListener('mouseup',    endDraw);
  refOverlay.addEventListener('touchstart', startDraw, { passive: false });
  refOverlay.addEventListener('touchmove',  moveDraw,  { passive: false });
  refOverlay.addEventListener('touchend',   endDraw,   { passive: false });

  // ── SVG overlay ────────────────────────────────────
  function renderRefLine(a, b) {
    const rect   = canvas.getBoundingClientRect();
    const dispSX = rect.width  / imageW;
    const dispSY = rect.height / imageH;
    const ax = a.x * dispSX, ay = a.y * dispSY;
    const bx = b.x * dispSX, by = b.y * dispSY;
    const midX = (ax + bx) / 2;
    const midY = (ay + by) / 2 - 10;
    const pxLen = Math.round(Math.sqrt((b.x-a.x)**2 + (b.y-a.y)**2));
    refSvg.innerHTML = `
      <line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}"
            stroke="#4f9cf9" stroke-width="2" stroke-dasharray="6 3"/>
      <circle cx="${ax}" cy="${ay}" r="5" fill="#4f9cf9"/>
      <circle cx="${bx}" cy="${by}" r="5" fill="#4f9cf9"/>
      <text x="${midX}" y="${midY}" fill="#4f9cf9"
            font-size="11" text-anchor="middle"
            font-family="monospace">${pxLen}px</text>
    `;
  }

  function clearRefLine() {
    if (refSvg) refSvg.innerHTML = '';
  }

  // ── Scale calculation ──────────────────────────────
  function toMM(val) {
    return unit === 'in' ? val * MM_PER_INCH : val;
  }

  function recalcAndEmit() {
    let scale = null;

    if (mode === 'global') {
      const inputVal = parseFloat(globalWidthInput.value);
      if (imageW > 0 && inputVal > 0) scale = toMM(inputVal) / imageW;
    } else {
      const inputVal = parseFloat(refLengthInput.value);
      if (linePxLen > 0 && inputVal > 0) scale = toMM(inputVal) / linePxLen;
    }

    if (scale !== null) {
      const inchesPerPx = scale / MM_PER_INCH;
      scaleReadout.innerHTML =
        `Scale: <span>${scale.toFixed(5)} mm/px</span>` +
        ` &nbsp;·&nbsp; <span>${inchesPerPx.toFixed(6)} in/px</span>`;
    } else {
      scaleReadout.innerHTML = `Scale: <span>—</span>`;
    }

    eventBus.emit('scaleChanged', { scale, unit });
  }

  function setImageSize(w, h) {
    imageW = w;
    imageH = h;
    p1 = p2 = null;
    linePxLen = 0;
    clearRefLine();
    refLineStatus.textContent = 'No line drawn yet';
    refLineStatus.classList.remove('has-line');
    if (refSvg) refSvg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    recalcAndEmit();
  }

  // Init
  setMode('global');

  return { setImageSize };
}
