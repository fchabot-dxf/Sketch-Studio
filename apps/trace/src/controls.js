/**
 * controls.js
 * Manages threshold, blur, and color-mode controls.
 * Reads from DOM, emits 'paramsChanged' whenever any control changes.
 */

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

  return { getParams };
}
