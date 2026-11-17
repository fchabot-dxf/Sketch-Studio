// apps/shaper/src/shaperhub-login.js — TASK 758: the "Sync to ShaperHub" sign-in keeps NO login of its own: the browser's password manager saves and
// fills it (the sign-in is a password form, apps/shaper/index.html #sync-modal-form). Versions before TASK 758 kept the email and password in plain
// text under this localStorage key ("Remember login in this browser"); the app deletes that copy at start, without reading it.
export const OLD_LOGIN_KEY = 'shaper_hub_creds';

/** Deletes the login an earlier version stored in `storage` (a Web Storage: the page's localStorage). Called ONCE, at app start (main.js). */
export function forgetOldLogin(storage) {
  storage.removeItem(OLD_LOGIN_KEY);
}
