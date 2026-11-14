// apps/trace/src/trace-session.js — TASK 605: what a Trace DOCUMENT TAB keeps of its Trace stage while another tab shows, DECLARED in one place. The traced drawing is in
// the document (the Edit canvas's sketch) and the trace parameters + image name are in the sidecar (doc.hosts.trace); the PHOTO is not stored (TASK 567: a 3-25 MB re-trace
// source), so it is the tab's in-memory session, the document buffer's `session` hook (capture when a tab is put aside, restore when it comes back, restore(undefined) for a
// design that has none yet):
//   the photo and its name, the mask painted on it, the traced SVG (Download / Send to Editor), the scale (mode, unit, inputs, reference line).
// A photo is kept by reference (its decoded canvas): ten tabs with big photos are ten decoded images in memory, which is why it is a session and never stored.
// createTraceSession({ state, preview, scale, ui }) -> { capture, restore }
//   state: the app's state object (imageCanvas, imageW, imageH, imageName, svgString)  preview / scale: preview.js / scale.js controls
//   ui: { cancelTrace(), showPhotoUi(has, traced), fallbackName(), onNoPhoto() } — the page's bits: drop a pending / running trace of the photo that was shown, the
//   empty-state label + Send to Editor button, the name a photo-less design shows, and the answer to a tab that has a drawing but no photo while the Trace tab shows
//   (the Trace tab cannot show it: the app opens its Edit tab and says so).
export function createTraceSession({ state, preview, scale, ui }) {
  return {
    capture: () => ({
      canvas: state.imageCanvas, w: state.imageW, h: state.imageH, name: state.imageName, svg: state.svgString,
      mask: preview.getMask(), scale: scale.getState(),
    }),
    restore: (s) => {
      ui.cancelTrace(); // a trace of the photo that was shown is not this tab's
      if (!s || !s.canvas) {
        state.imageCanvas = null; state.imageW = 0; state.imageH = 0; state.svgString = null;
        state.imageName = ui.fallbackName(); // the design's own name from its sidecar, else the default
        preview.clear();
        scale.setImageSize(0, 0);
        scale.setState(s ? s.scale : undefined);
        ui.showPhotoUi(false);
        ui.onNoPhoto();
        return;
      }
      state.imageCanvas = s.canvas; state.imageW = s.w; state.imageH = s.h; state.imageName = s.name; state.svgString = s.svg;
      preview.setImage(s.canvas);
      preview.setMask(s.mask);
      scale.setImageSize(s.w, s.h);
      scale.setState(s.scale);
      preview.updateThresholdOverlay(state.params);
      if (s.svg) preview.setSVG(s.svg);
      ui.showPhotoUi(true, !!s.svg);
    },
  };
}
