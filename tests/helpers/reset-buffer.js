// tests/helpers/reset-buffer.js — ONE declared test helper to clear both CURRENT_DESIGN_KEY and the local open-tabs working buffer (TASK 624).
// Tests that reset to a clean Untitled state call resetBuffer(store) instead of bare store.setCurrent(null), so a saved working buffer
// does not reopen previous tabs or Untitled content on the next launch / restore.

/** Reset the current design pointer AND clear the open-tabs working buffer on `store`. */
export async function resetBuffer(store) {
  if (!store) return;
  if (store.setCurrent) await store.setCurrent(null);
  if (store.writeBuffer) await store.writeBuffer(null);
}
