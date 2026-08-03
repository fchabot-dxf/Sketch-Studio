/**
 * upload.js
 * Handles file input (drag-drop + file picker) → ImageBitmap + raw pixel data.
 * Dispatches 'imageLoaded' on the eventBus with { bitmap, dataURL, width, height }.
 */

export function initUpload(eventBus) {
  const dropZone  = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');

  // Click on drop zone opens file picker
  dropZone.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) processFile(fileInput.files[0], eventBus);
  });

  // Drag events
  dropZone.addEventListener('dragenter', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragover',  e => { e.preventDefault(); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) processFile(file, eventBus);
  });
}

async function processFile(file, eventBus) {
  const dataURL = await readAsDataURL(file);
  const img     = await loadImage(dataURL);

  // Draw to offscreen canvas to get pixel data
  const canvas  = document.createElement('canvas');
  canvas.width  = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);

  // Update drop zone label
  const label = document.querySelector('#drop-zone .drop-label');
  if (label) label.innerHTML = `<strong>${file.name}</strong><br><span style="font-size:11px;color:var(--text-dim)">${img.naturalWidth}×${img.naturalHeight}px</span>`;

  eventBus.emit('imageLoaded', {
    dataURL,
    canvas,
    width:  img.naturalWidth,
    height: img.naturalHeight,
    name:   file.name.replace(/\.[^.]+$/, ''),
  });
}

function readAsDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload  = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}
