/**
 * upload.js
 * Handles file input (drag-drop + file picker) → a decoded canvas.
 * Dispatches 'imageLoaded' on the eventBus with { blob, canvas, width, height, name }.
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

/**
 * decodeImageBlob(blob) -> { canvas, width, height }: the ONE decode of a photo file into a full-size canvas. The upload uses it, and so does a document tab that
 * is shown again (TASK 609: an inactive tab keeps only the compressed file, see trace-session.js).
 */
export async function decodeImageBlob(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    return { canvas, width: img.naturalWidth, height: img.naturalHeight };
  } finally { URL.revokeObjectURL(url); }
}

async function processFile(file, eventBus) {
  const { canvas, width, height } = await decodeImageBlob(file);

  // Update drop zone label
  const label = document.querySelector('#drop-zone .drop-label');
  if (label) label.innerHTML = `<strong>${file.name}</strong><br><span style="font-size:11px;color:var(--text-dim)">${width}×${height}px</span>`;

  eventBus.emit('imageLoaded', {
    blob: file, // the compressed original: what an inactive document tab keeps (TASK 609)
    canvas,
    width,
    height,
    name:   file.name.replace(/\.[^.]+$/, ''),
  });
}

function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload  = () => res(img);
    img.onerror = () => rej(new Error('the browser cannot read this image'));
    img.src = src;
  });
}
