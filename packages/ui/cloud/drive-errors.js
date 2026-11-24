// packages/ui/cloud/drive-errors.js — TASK 881: the one readable line for a Drive / sign-in failure, in a module of its own (no Drive client in it), so the
// project store's engine (#ui/project-store-core.js, the Fusion panel's store) words a failure without importing the Drive adapter. drive-adapter.js re-exports it.

/** One readable line for a Drive / sign-in failure (the reason shown in the sidebar). Drive's HTTP status stays in the text. */
export function driveErrorText(e) {
  const m = (e && e.message) || String(e);
  if (m === 'cloud-auth') return 'Google sign-in is needed again';
  if (m === 'cloud-unavailable') return 'Google could not be reached';
  if (e instanceof TypeError) return `Google Drive could not be reached (${m})`;
  const http = /^Drive (\d+)$/.exec(m);
  if (http) return `Google Drive answered HTTP ${http[1]}`;
  return m;
}
