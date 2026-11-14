// tests/helpers/reset-buffer.js — ONE declared test helper to clear both CURRENT_DESIGN_KEY and the local open-tabs working buffers (TASK 624).
// Tests that reset to a clean Untitled state call resetBuffer(store) instead of bare store.setCurrent(null), so a saved working buffer
// does not reopen previous tabs or Untitled content on the next launch / restore. The buffer is kept PER APP (project-store.js
// readBuffer / writeBuffer({ app })), so the reset clears each host's own one.

/** The hosts that keep an open-tabs working buffer (each createDocumentBuffer's `app`). */
export const BUFFER_APPS = ['sketchstudio', 'shaper', 'penplotter', 'trace'];

/** Reset the current design pointer AND clear every app's open-tabs working buffer on `store`. */
export async function resetBuffer(store) {
  await store.setCurrent(null);
  for (const app of BUFFER_APPS) await store.writeBuffer(null, { app });
}

/** The same reset in a live browser (a cdp-browser.js instance): it LEAVES the app page first (an open app page writes its tabs back to its
 *  buffer when it is hidden, e.g. after a viewport change), and runs resetBuffer on the origin's store from reset-buffer.html. The caller
 *  navigates to the next app page afterwards. */
export async function resetBufferLive({ port, navigate, waitFor }) {
  await navigate(`http://127.0.0.1:${port}/tests/helpers/reset-buffer.html`, 8000);
  const title = await waitFor(`document.title !== 'resetting' && document.title`, 'the reset page to clear the working buffers');
  if (title !== 'buffers reset') throw new Error(title);
}
