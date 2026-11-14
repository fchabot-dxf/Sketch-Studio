// apps/trace/src/trace-session.js — TASK 605 / 609: what a Trace DOCUMENT TAB keeps of its Trace stage while another tab shows, DECLARED in one place. The traced drawing is in
// the document (the Edit canvas's sketch) and the trace parameters + image name are in the sidecar (doc.hosts.trace); the PHOTO is not stored (TASK 567: a re-trace source, never
// in the document, IndexedDB or localStorage), so it is the tab's in-memory session, the document buffer's `session` hook (capture when a tab is put aside, restore when it comes
// back, restore(undefined) for a design that has none yet):
//   the photo as its COMPRESSED original file (a Blob), its size and name, the mask painted on it (as a PNG Blob), the traced SVG (Download / Send to Editor), the scale.
// TASK 609, the memory bound: only the SHOWN tab holds the photo decoded (a 12 MP phone photo is 48 MB as a canvas, and its mask another 48 MB). A tab put aside keeps the
// original file (a few MB) and the encoded mask (a few KB when little is painted), and the photo is decoded again when the tab is shown (async: the restore starts the decode and
// the tab's photo appears when it is done). Nothing is evicted: the original bytes stay with the tab until it closes, so no photo the user has open is ever lost.
// createTraceSession({ state, preview, scale, ui, codec }) -> { capture, restore, cancelPending }
//   state: the app's state object (imageCanvas, imageBlob, imageW, imageH, imageName, svgString)  preview / scale: preview.js / scale.js controls
//   ui: { cancelTrace(), showPhotoUi(has, traced), fallbackName(), onNoPhoto(), onDecodeError(err) } — the page's bits: drop a pending / running trace of the photo that was
//   shown, the empty-state label + Send to Editor button, the name a photo-less design shows, the answer to a tab that has a drawing but no photo while the Trace tab shows
//   (the Trace tab cannot show it: the app opens its Edit tab and says so), and the message when a stored photo cannot be decoded.
//   codec: { encode(canvas) -> Promise<Blob|null>, decode(blob) -> Promise<{ canvas, width, height }> } — the page's canvas <-> file bridge.
// heldBytes(record) -> the bytes a captured record holds (what the memory bound is measured by).

export function heldBytes(rec) {
  if (!rec || !rec.blob) return 0;
  const mask = rec.maskBlob ? rec.maskBlob.size : (rec.mask ? rec.mask.width * rec.mask.height * 4 : 0);
  return rec.blob.size + mask + (rec.svg ? rec.svg.length * 2 : 0);
}

export function createTraceSession({ state, preview, scale, ui, codec }) {
  let pending = null; // the record whose photo is being decoded for the shown tab: it is still the tab's record if the tab is put aside meanwhile
  return {
    cancelPending: () => { pending = null; }, // a photo the user has just loaded replaces the one still decoding
    capture: () => {
      if (pending) return { ...pending, scale: scale.getState() }; // the decode has not finished: the tab still owns its file
      if (!state.imageBlob) return { blob: null, w: 0, h: 0, name: state.imageName, svg: state.svgString, mask: null, maskBlob: null, scale: scale.getState() };
      const rec = { blob: state.imageBlob, w: state.imageW, h: state.imageH, name: state.imageName, svg: state.svgString, mask: preview.getMask(), maskBlob: null, scale: scale.getState() };
      // the mask canvas (a full-size copy) is replaced by its PNG as soon as it is encoded; if the encode fails the canvas stays (nothing is lost)
      if (rec.mask) {
        const canvas = rec.mask;
        codec.encode(canvas).then((b) => { if (b) { rec.maskBlob = b; rec.mask = null; } });
      }
      return rec;
    },
    restore: (s) => {
      ui.cancelTrace(); // a trace of the photo that was shown is not this tab's
      pending = null;
      if (!s || !s.blob) {
        state.imageCanvas = null; state.imageBlob = null; state.imageW = 0; state.imageH = 0; state.svgString = null;
        state.imageName = ui.fallbackName(); // the design's own name from its sidecar, else the default
        preview.clear();
        scale.setImageSize(0, 0);
        scale.setState(s ? s.scale : undefined);
        ui.showPhotoUi(false);
        ui.onNoPhoto();
        return;
      }
      state.imageCanvas = null; state.imageBlob = s.blob; state.imageW = s.w; state.imageH = s.h; state.imageName = s.name; state.svgString = s.svg;
      preview.clear();
      scale.setImageSize(s.w, s.h);
      scale.setState(s.scale);
      ui.showPhotoUi(false, !!s.svg); // the photo is on its way: the drawing it traced to is already shown / exportable
      pending = s;
      Promise.all([codec.decode(s.blob), s.maskBlob ? codec.decode(s.maskBlob) : Promise.resolve(null)]).then(([photo, maskPng]) => {
        if (pending !== s) return; // another tab was shown while this one decoded
        pending = null;
        state.imageCanvas = photo.canvas;
        preview.setImage(photo.canvas);
        preview.setMask(maskPng ? maskPng.canvas : s.mask);
        const now = scale.getState(); // the scale as the user left it while the photo decoded; setImageSize clears the reference line, setState draws it again on the photo
        scale.setImageSize(s.w, s.h);
        scale.setState(now);
        preview.updateThresholdOverlay(state.params);
        if (s.svg) preview.setSVG(s.svg);
        ui.showPhotoUi(true, !!s.svg);
      }, (err) => { if (pending === s) ui.onDecodeError(err); });
    },
  };
}
