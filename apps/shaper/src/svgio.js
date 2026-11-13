// Load, serialize, and download SVG documents.

import { SHAPER_NS, hasAnyShaperAttr } from './shaper.js';

export { parseSvgText as parseSvg } from '#ui/sketch-import.js'; // TASK 566: one SVG parser (the shared importer's), not a copy

export function serializeSvg(svg) {
  // Only declare the shaper namespace if we actually emitted shaper:* attrs.
  if (hasAnyShaperAttr(svg) && !svg.getAttribute('xmlns:shaper')) {
    svg.setAttribute('xmlns:shaper', SHAPER_NS);
  }
  const body = new XMLSerializer().serializeToString(svg);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${body}\n`;
}

export function download(filename, text) {
  const blob = new Blob([text], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
