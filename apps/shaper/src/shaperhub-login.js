// apps/shaper/src/shaperhub-login.js — the "Sync to ShaperHub" sign-in's login, as this app keeps it on this computer.
//   TASK 886 (owner turns 3612-3614, superseding TASK 758's "the app keeps no login", owner turn 2260): "Remember login on this computer" (the sign-in's
//     checkbox, off by default). Ticked, each successful answer of the upload function (any Sync action that signed in with the form's email + password) keeps
//     that login under REMEMBER_LOGIN_KEY, in plain text, in the page's localStorage (the dialog's hint says so); unticked, a sign-in with the box unticked, or
//     Switch account deletes it. At start the page fills the sign-in form from it, and that counts as signed in (hasSignIn), so "Keep ShaperHub up to date"
//     (TASK 884, the switch labelled "Autosend") replaces on Generate right after a reload. The login goes nowhere else: the one upload body (shaper-app.js callShaperHub) is its only request.
//   TASK 758: versions before it kept the email and password under OLD_LOGIN_KEY ("Remember login in this browser"); the website deletes that copy at start
//     (main.js), without reading it. The two keys are unrelated: the old copy is never moved to the new key (it was stored under a promise 758 ended: deleted),
//     and forgetOldLogin never touches REMEMBER_LOGIN_KEY.
export const OLD_LOGIN_KEY = 'shaper_hub_creds';
export const REMEMBER_LOGIN_KEY = 'shaper-hub-remembered-login';

/** Deletes the login an earlier version stored in `storage` (a Web Storage: the page's localStorage). Called ONCE, at app start (main.js). */
export function forgetOldLogin(storage) {
  storage.removeItem(OLD_LOGIN_KEY);
}

/** The login kept in `storage` ({ email, password }) or null (none kept). A copy that is not a login throws ONE fixed message (never its content). */
export function readRememberedLogin(storage) {
  const raw = storage.getItem(REMEMBER_LOGIN_KEY);
  if (raw === null) return null;
  const unreadable = () => new Error('the remembered ShaperHub login is not readable');
  let kept;
  try { kept = JSON.parse(raw); } catch { throw unreadable(); } // JSON.parse's own message quotes the text: replaced by the fixed one
  if (!kept || typeof kept.email !== 'string' || typeof kept.password !== 'string' || !kept.email || !kept.password) throw unreadable();
  return { email: kept.email, password: kept.password };
}

/** The box's answer to a sign-in: `remember` ticked + `login` (the form's email + password, which just signed in) -> kept; ticked, no login -> nothing
 *  changes; unticked -> deleted. A storage error reaches the caller (the page logs it). */
export function rememberLogin(storage, remember, login = null) {
  if (!remember) { storage.removeItem(REMEMBER_LOGIN_KEY); return; }
  if (!login) return;
  storage.setItem(REMEMBER_LOGIN_KEY, JSON.stringify({ email: login.email, password: login.password }));
}

/** Signed in = the form holds an email and a password that a session token came from (`session`) or that were filled from the kept login (`remembered`);
 *  a typed login never sent is not (TASK 884: shaper-app.js signedIn(), read by Generate's replace, the switch and the dialog). */
export const hasSignIn = ({ session, remembered, email, password }) => (!!session || !!remembered) && !!String(email || '').trim() && !!password;
