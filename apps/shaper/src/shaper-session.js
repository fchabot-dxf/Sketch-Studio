// apps/shaper/src/shaper-session.js — TASK 605: what a Shaper DOCUMENT TAB keeps of its stages while another tab shows, DECLARED in one place (the page
// (main.js) and the node test kit (tests/helpers/node-app.js) both build it). The document, the cut plan and the stock ride in the document + the sidecar
// (shaper-doc.js); this is the in-memory rest, the document buffer's `session` hook (capture when a tab is put aside, restore when it comes back, restore(undefined)
// for a design that has none yet):
//   Prepare   the selected loops / edges / chains and the pan / zoom of the Prepare view (prepare-stage.js keeps them for the view's next mount)
//   Vcarve    the Vcarve view's pan / zoom (the region, V-bit and depths are in the document: state.vcarves)
// Not kept: the Review camera (it is placed from the tab's own stock and cuts on each entry, like a first visit), the Design canvas view (the buffer keeps it).
// TASK 706: the Explore viewer is gone, and with it the session's `explore` part (its open SVG); a session stored before (the shared open-tabs buffer,
// TASK 684) still carries one: restore reads only `prepare` and `vcarveView`, so it is ignored.

/** createShaperSession({ prepare, getVcarveView }) -> { capture, restore }. A part the host has not mounted (the kit has no Vcarve) is skipped. All of it is
 *  storable (plain data), so the open-tabs buffer keeps the whole session. */
export function createShaperSession({ prepare, getVcarveView = () => null }) {
  return {
    capture: () => {
      const v = getVcarveView();
      return { prepare: prepare.captureSession(), vcarveView: v ? v.getView() : null };
    },
    restore: (s) => {
      prepare.restoreSession(s ? s.prepare : null);
      const v = getVcarveView();
      if (v) v.setView(s ? s.vcarveView : null);
    },
  };
}
