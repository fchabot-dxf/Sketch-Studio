// tests/helpers/reset-buffer.js — ONE declared test helper to clear both CURRENT_DESIGN_KEY and the local open-tabs working buffer (TASK 624).
// Tests that reset to a clean Untitled state call resetBuffer(store) instead of bare store.setCurrent(null), so a saved working buffer
// does not reopen previous tabs or Untitled content on the next launch / restore. TASK 684: the buffer is ONE for all apps (project-store.js
// readBuffer / updateBuffer); reading it first merges away any TASK 624 per-app buffer (openTabsBuffer:<app>), so none survives the reset.

/** Reset the current design pointer AND clear the shared open-tabs working buffer on `store`. */
export async function resetBuffer(store) {
  await store.setCurrent(null);
  await store.readBuffer({}); // migrates (and so removes) any legacy per-app buffer key
  await store.updateBuffer(() => null);
}

/** The same reset in a live browser (a cdp-browser.js instance): it LEAVES the app page first (an open app page writes its tabs back to its
 *  buffer when it is hidden, e.g. after a viewport change), and runs resetBuffer on the origin's store from reset-buffer.html. The caller
 *  navigates to the next app page afterwards.
 *  TASK 713: the page is left only once it has finished starting up (no Design canvas still at data-doc-ready="0", document-buffer.js). An app
 *  page left during its start-up can be in the middle of CREATING the store's IndexedDB database (a fresh profile: the upgrade); the browser
 *  parks it frozen in the back/forward cache with that upgrade half done and does not evict it (Edge 157: a parked page inside a transaction
 *  is evicted, one inside an upgrade is not), so every later page of the origin, this reset page included, waits for the database forever. */
export async function resetBufferLive({ port, navigate, waitFor }) {
  await waitFor(`document.readyState === 'complete' && !document.querySelector('[data-doc-ready="0"]')`, 'the page being left to finish starting up (an app page left mid-start-up parks its half-created database in the back/forward cache)');
  await navigate(`http://127.0.0.1:${port}/tests/helpers/reset-buffer.html`, 8000);
  const title = await waitFor(`document.title !== 'resetting' && document.title`, 'the reset page to clear the working buffers');
  if (title !== 'buffers reset') throw new Error(title);
}
