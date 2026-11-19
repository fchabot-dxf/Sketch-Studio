// packages/ui/project-file.js — the PROJECT FILE format and the file seam (TASK 474).
//
// ONE file format for "Save to file / Open from file": the #core document JSON (serializeDocument + host sidecars) inside a
// small envelope, extension `.sketch.json`:
//   { "format": "sketch-studio-project", "version": 1, "app": "<app that saved it>", "name": "<project name>", "document": {...} }
// `version` is the ENVELOPE version; the document carries its own version (#core/document.js DOCUMENT_VERSION), validated by
// validateDocument before anything is loaded, so a file made by a newer build is refused with a clear message.
// Text out is deterministic (fixed key order, 2-space JSON, trailing newline): open -> save again gives the same bytes.
//
// The browser file picker is a SEAM: `{ save(text, suggestedName) -> {name, handle}|null, write(handle, text) -> {name, handle}|null,
// open() -> {name, text, handle}|null }` (TASK 759: the handle, when the browser gives one, lets Save write back to the same file).
// browserFileSeam is the real one (File System Access API when fileAccess() says so, download / <input type=file> otherwise); the store
// and everything above it only ever talk to a seam, so tests (and a later Drive adapter) plug in another one.

import { validateDocument } from '#core/document.js';

export const PROJECT_FILE_FORMAT = 'sketch-studio-project';
export const PROJECT_FILE_VERSION = 1;
export const PROJECT_FILE_EXT = '.sketch.json';

/** A user-facing failure to read a project file (the message is meant to be shown as is). */
export class ProjectFileError extends Error {
  constructor(message) { super(message); this.name = 'ProjectFileError'; }
}

export function serializeProjectFile({ app, name, document }) {
  return JSON.stringify({ format: PROJECT_FILE_FORMAT, version: PROJECT_FILE_VERSION, app: app || null, name: name || 'Untitled', document }, null, 2) + '\n';
}

/** Text -> { app, name, document }, or throws ProjectFileError with a readable message. Validates the document first. */
export function parseProjectFile(text) {
  let obj;
  try { obj = JSON.parse(text); } catch (_) { throw new ProjectFileError('This is not a Sketch Studio project file (it is not valid JSON).'); }
  if (!obj || obj.format !== PROJECT_FILE_FORMAT) throw new ProjectFileError('This is not a Sketch Studio project file.');
  if (typeof obj.version !== 'number' || obj.version > PROJECT_FILE_VERSION) {
    throw new ProjectFileError(`This file was made by a newer version of Sketch Studio (file format ${obj.version}; this app understands ${PROJECT_FILE_VERSION}).`);
  }
  const valid = validateDocument(obj.document);
  if (!valid.ok) {
    throw new ProjectFileError(valid.newer
      ? `This project was made by a newer version of Sketch Studio (${valid.reason}). Update the app to open it.`
      : `This project file is damaged (${valid.reason}).`);
  }
  return { app: obj.app || null, name: typeof obj.name === 'string' && obj.name ? obj.name : 'Untitled', document: obj.document };
}

/** A file name safe on every OS: the project name with path/reserved characters replaced, plus the extension. */
export function projectFileName(name) {
  const base = String(name || 'Untitled').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || 'Untitled';
  return base + PROJECT_FILE_EXT;
}

// ---- the real browser seam -------------------------------------------------------------------------------------------
// What a picker offers: { description, mime, exts, binary? }. The project file is the default; Import SVG / DXF (project-actions.js) passes its own.
// TASK 790: `binary: true` = the file is read as bytes (an ArrayBuffer, `bytes`) instead of text (Shaper's Open STL declares its own pick).
export const PROJECT_FILE_PICK = { description: 'Sketch Studio project', mime: 'application/json', exts: [PROJECT_FILE_EXT, '.json'] };
export const IMPORT_FILE_PICK = { description: 'SVG or DXF drawing', mime: 'image/svg+xml', exts: ['.svg', '.dxf'] };
const pickerTypes = (spec) => [{ description: spec.description, accept: { [spec.mime]: spec.exts } }];

/** TASK 759: THE capability, declared once and read at call time (never per environment): the File System Access API (Chrome, Edge). `picker` = a save
 *  picker (showSaveFilePicker): a saved file has a HANDLE, so Save can write back to that same file; without it (Firefox, Safari, phones) a save is a
 *  download. `openPicker` = an open picker (showOpenFilePicker): an opened file has a handle too; without it an open is an <input type=file> (a name only). */
export function fileAccess(win = typeof window !== 'undefined' ? window : null) {
  return { picker: !!win && typeof win.showSaveFilePicker === 'function', openPicker: !!win && typeof win.showOpenFilePicker === 'function' };
}

/** The design name a file name shows: the name without `.sketch.json` (or `.json`). */
export function designNameOfFile(fileName) {
  const n = String(fileName || '');
  const base = n.endsWith(PROJECT_FILE_EXT) ? n.slice(0, -PROJECT_FILE_EXT.length) : n.endsWith('.json') ? n.slice(0, -'.json'.length) : n;
  return base.trim() || 'Untitled';
}

const pickerCancelled = (e) => !!e && e.name === 'AbortError'; // the user closed the browser's picker: not an error

export const browserFileSeam = {
  /** Write `text` to a NEW file the user names. Resolves { name, handle } (handle: the picked file, or null for a download) or null when the user
   *  cancelled the picker. */
  async save(text, suggestedName) {
    if (fileAccess().picker) {
      let handle;
      try { handle = await window.showSaveFilePicker({ suggestedName, types: pickerTypes(PROJECT_FILE_PICK) }); }
      catch (e) { if (pickerCancelled(e)) return null; throw e; }
      await writeHandle(handle, text);
      return { name: handle.name, handle };
    }
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = suggestedName;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return { name: suggestedName, handle: null };
  },
  /** Write `text` back to the file `handle` (a file this page picked). Resolves { name, handle }, or null when the browser refused to let the
   *  page write it (the user said no to the permission): the caller then asks for a file again. */
  async write(handle, text) {
    if (typeof handle.queryPermission === 'function' && (await handle.queryPermission({ mode: 'readwrite' })) !== 'granted'
      && (await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') return null;
    await writeHandle(handle, text);
    return { name: handle.name, handle };
  },
  /** Pick and read a file. Resolves { name, text, handle } (handle: the picked file, or null from an <input type=file>) or null when the user cancelled.
   *  A `binary` spec (TASK 790) resolves { name, bytes, handle } instead (bytes: the file's ArrayBuffer). */
  async open(spec = PROJECT_FILE_PICK) {
    if (fileAccess().openPicker) {
      let handles;
      try { handles = await window.showOpenFilePicker({ types: pickerTypes(spec), multiple: false }); }
      catch (e) { if (pickerCancelled(e)) return null; throw e; }
      const file = await handles[0].getFile();
      return { name: file.name, ...(await readPicked(file, spec)), handle: handles[0] };
    }
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = spec.exts.join(',') + ',' + spec.mime;
      // Attached (hidden) while the picker is open: a detached input can be garbage-collected and its change event then never fires.
      input.hidden = true;
      document.body.appendChild(input);
      const settle = (done, value) => { input.remove(); done(value); };
      input.onchange = async () => {
        const f = input.files && input.files[0];
        try { settle(resolve, f ? { name: f.name, ...(await readPicked(f, spec)), handle: null } : null); } catch (e) { settle(reject, e); }
      };
      input.oncancel = () => settle(resolve, null);
      input.click();
    });
  },
};
const readPicked = async (file, spec) => (spec.binary ? { bytes: await file.arrayBuffer() } : { text: await file.text() });
async function writeHandle(handle, text) {
  const w = await handle.createWritable();
  await w.write(text);
  await w.close();
}
