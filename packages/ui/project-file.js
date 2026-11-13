// packages/ui/project-file.js — the PROJECT FILE format and the file seam (TASK 474).
//
// ONE file format for "Save to file / Open from file": the #core document JSON (serializeDocument + host sidecars) inside a
// small envelope, extension `.sketch.json`:
//   { "format": "sketch-studio-project", "version": 1, "app": "<app that saved it>", "name": "<project name>", "document": {...} }
// `version` is the ENVELOPE version; the document carries its own version (#core/document.js DOCUMENT_VERSION), validated by
// validateDocument before anything is loaded, so a file made by a newer build is refused with a clear message.
// Text out is deterministic (fixed key order, 2-space JSON, trailing newline): open -> save again gives the same bytes.
//
// The browser file picker is a SEAM: `{ save(text, suggestedName) -> {name}|null, open() -> {name, text}|null }`.
// browserFileSeam is the real one (File System Access API when present, download / <input type=file> otherwise); the store
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
const PICKER_TYPES = [{ description: 'Sketch Studio project', accept: { 'application/json': [PROJECT_FILE_EXT, '.json'] } }];

export const browserFileSeam = {
  /** Write `text`. Resolves { name } or null when the user cancelled the picker. */
  async save(text, suggestedName) {
    if (typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function') {
      let handle;
      try { handle = await window.showSaveFilePicker({ suggestedName, types: PICKER_TYPES }); }
      catch (e) { if (e && e.name === 'AbortError') return null; throw e; }
      const w = await handle.createWritable();
      await w.write(text);
      await w.close();
      return { name: handle.name };
    }
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = suggestedName;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return { name: suggestedName };
  },
  /** Pick and read a file. Resolves { name, text } or null when the user cancelled. */
  async open() {
    if (typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function') {
      let handles;
      try { handles = await window.showOpenFilePicker({ types: PICKER_TYPES, multiple: false }); }
      catch (e) { if (e && e.name === 'AbortError') return null; throw e; }
      const file = await handles[0].getFile();
      return { name: file.name, text: await file.text() };
    }
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = PROJECT_FILE_EXT + ',.json,application/json';
      // Attached (hidden) while the picker is open: a detached input can be garbage-collected and its change event then never fires.
      input.hidden = true;
      document.body.appendChild(input);
      const settle = (done, value) => { input.remove(); done(value); };
      input.onchange = async () => {
        const f = input.files && input.files[0];
        try { settle(resolve, f ? { name: f.name, text: await f.text() } : null); } catch (e) { settle(reject, e); }
      };
      input.oncancel = () => settle(resolve, null);
      input.click();
    });
  },
};
