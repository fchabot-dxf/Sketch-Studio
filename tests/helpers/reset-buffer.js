// tests/helpers/reset-buffer.js — ONE declared test helper to clear both CURRENT_DESIGN_KEY and the local open-tabs working buffer (TASK 624).
// Tests that reset to a clean Untitled state call resetBuffer(store) instead of bare store.setCurrent(null), so a saved working buffer
// does not reopen previous tabs or Untitled content on the next launch / restore. TASK 684: the buffer is ONE for all apps (project-store.js
// readBuffer / writeBuffer / updateBuffer); reading it first merges away any TASK 624 per-app buffer (openTabsBuffer:<app>), so none survives the reset.

/** Reset the current design pointer AND clear the shared open-tabs working buffer on `store`. */
export async function resetBuffer(store) {
  await store.setCurrent(null);
  await store.readBuffer({}); // migrates (and so removes) any legacy per-app buffer key
  await store.writeBuffer(null);
}

/** The same reset in a live browser (a cdp-browser.js instance): it LEAVES the app page first (an open app page writes its tabs back to its
 *  buffer when it is hidden, e.g. after a viewport change), and runs resetBuffer on the origin's store from reset-buffer.html. The caller
 *  navigates to the next app page afterwards. */
export async function resetBufferLive({ port, navigate, waitFor }) {
  await navigate(`http://127.0.0.1:${port}/tests/helpers/reset-buffer.html`, 8000);
  const title = await waitFor(`document.title !== 'resetting' && document.title`, 'the reset page to clear the working buffers');
  if (title !== 'buffers reset') throw new Error(title);
}
