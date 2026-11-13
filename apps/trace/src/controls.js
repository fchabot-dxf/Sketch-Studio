/**
 * controls.js
 * Manages threshold, blur, and color-mode controls.
 * Reads from DOM, emits 'paramsChanged' whenever any control changes.
 */

// The control defaults (they match the initial values in index.html): a design without a trace sidecar resets the controls to these.
export const DEFAULT_PARAMS = { threshold: 128, blur: 0, colorMode: 'bw', simplify: 0, smooth: 0, outlineOnly: true };

export function initControls(eventBus) {
  const thresholdSlider = document.getElementById('threshold-slider');
  const thresholdVal    = document.getElementById('threshold-val');
  const blurSlider      = document.getElementById('blur-slider');
  const blurVal         = document.getElementById('blur-val');
  const colorModeBtns   = document.querySelectorAll('.color-mode-btn');
  const simplifySlider  = document.getElementById('simplify-slider');
  const simplifyVal     = document.getElementById('simplify-val');
  const smoothSlider    = document.getElementById('smooth-slider');
  const smoothVal       = document.getElementById('smooth-val');
  const outlineOnlyCb   = document.getElementById('outline-only-cb');
  const wandTolSlider   = document.getElementById('wand-tolerance');
  const wandTolVal      = document.getElementById('wand-tol-val');
  const brushSizeSlider = document.getElementById('brush-size');
  const brushSizeVal    = document.getElementById('brush-size-val');

  function getParams() {
    return {
      threshold:   parseInt(thresholdSlider.value, 10),
      blur:        parseInt(blurSlider.value, 10),
      colorMode:   document.querySelector('.color-mode-btn.active')?.dataset.mode ?? 'bw',
      simplify:    parseInt(simplifySlider.value, 10),
      smooth:      parseInt(smoothSlider.value, 10),
      outlineOnly: outlineOnlyCb.checked,
    };
  }

  function emit() { eventBus.emit('paramsChanged', getParams()); }

  /** Put saved parameters into the controls (a restored design), and tell the app once. */
  function setParams(p) {
    thresholdSlider.value = p.threshold; thresholdVal.textContent = thresholdSlider.value;
    blurSlider.value      = p.blur;      blurVal.textContent      = blurSlider.value;
    simplifySlider.value  = p.simplify;  simplifyVal.textContent  = simplifySlider.value;
    smoothSlider.value    = p.smooth;    smoothVal.textContent    = smoothSlider.value;
    outlineOnlyCb.checked = !!p.outlineOnly;
    colorModeBtns.forEach(b => b.classList.toggle('active', b.dataset.mode === p.colorMode));
    emit();
  }

  thresholdSlider.addEventListener('input', () => {
    thresholdVal.textContent = thresholdSlider.value;
    emit();
  });

  blurSlider.addEventListener('input', () => {
    blurVal.textContent = blurSlider.value;
    emit();
  });

  colorModeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      colorModeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      emit();
    });
  });

  simplifySlider.addEventListener('input', () => {
    simplifyVal.textContent = simplifySlider.value;
    emit();
  });

  smoothSlider.addEventListener('input', () => {
    smoothVal.textContent = smoothSlider.value;
    emit();
  });

  outlineOnlyCb.addEventListener('change', () => {
    emit();
  });

  if (wandTolSlider) {
    wandTolSlider.addEventListener('input', () => {
      if (wandTolVal) wandTolVal.textContent = wandTolSlider.value;
    });
  }

  if (brushSizeSlider) {
    brushSizeSlider.addEventListener('input', () => {
      if (brushSizeVal) brushSizeVal.textContent = brushSizeSlider.value;
    });
  }

  return { getParams, setParams };
}
