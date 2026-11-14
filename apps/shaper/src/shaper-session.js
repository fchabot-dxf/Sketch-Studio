// apps/shaper/src/shaper-session.js — TASK 605: what a Shaper DOCUMENT TAB keeps of its stages while another tab shows, DECLARED in one place (the page
// (main.js) and the node test kit (tests/helpers/node-app.js) both build it). The document, the cut plan and the stock ride in the document + the sidecar
// (shaper-doc.js); this is the in-memory rest, the document buffer's `session` hook (capture when a tab is put aside, restore when it comes back, restore(undefined)
// for a design that has none yet):
//   Explore   the SVG opened in the explorer and its selected element (the explorer is a view of one file, so it goes with the tab)
//   Prepare   the selected loops / edges / chains and the pan / zoom of the Prepare view (prepare-stage.js keeps them for the view's next mount)
//   Vcarve    the Vcarve view's pan / zoom (the region, V-bit and depths are in the document: state.vcarves)
// Not kept: the Review camera (it is placed from the tab's own stock and cuts on each entry, like a first visit), the Design canvas view (the buffer keeps it).
import { store, setDoc, select } from './store.js';

/** createShaperSession({ prepare, getVcarveView }) -> { capture, restore }. A part the host has not mounted (the kit has no Vcarve) is skipped. */
export function createShaperSession({ prepare, getVcarveView = () => null }) {
  return {
    capture: () => {
      const v = getVcarveView();
      return { explore: { doc: store.doc, selected: store.selected }, prepare: prepare.captureSession(), vcarveView: v ? v.getView() : null };
    },
    restore: (s) => {
      setDoc(s ? s.explore.doc : null);
      if (s && s.explore.selected) select(s.explore.selected);
      prepare.restoreSession(s ? s.prepare : null);
      const v = getVcarveView();
      if (v) v.setView(s ? s.vcarveView : null);
    },
  };
}
