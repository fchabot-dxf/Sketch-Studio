// apps/shaper/src/download.js — save a text file to the user's downloads (the Shaper SVG export: the drawer's Download, Review's Generate Shaper SVG).
// TASK 706: moved unchanged out of svgio.js, which went with the Explore viewer (its SVG parse / serialize were Explore's).
// TASK 888: several files (a Roughing / Contour split into files) download as ONE zip (#core/plot/zip buildZip: the repo's zip writer, the Pen Plotter's export).

import { track } from '#ui/analytics.js'; // TASK 738
import { buildZip } from '#core/plot/zip/index.js'; // TASK 888

function save(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function download(filename, text) {
  track('export:shaper'); // TASK 738: the Shaper SVG is the one file this downloads
  save(filename, new Blob([text], { type: 'image/svg+xml;charset=utf-8' }));
}

/** TASK 888: the Shaper SVG files `files` ([{ name, svg }]) as one zip named `filename`. */
export function downloadZip(filename, files) {
  track('export:shaper');
  save(filename, buildZip(files.map((f) => ({ name: f.name, content: f.svg }))));
}
