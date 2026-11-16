// apps/shaper/src/download.js — save a text file to the user's downloads (the Shaper SVG export: the drawer's Download, Review's Generate Shaper SVG).
// TASK 706: moved unchanged out of svgio.js, which went with the Explore viewer (its SVG parse / serialize were Explore's).

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
