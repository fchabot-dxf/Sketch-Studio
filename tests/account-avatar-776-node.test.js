// tests/account-avatar-776-node.test.js — TASK 776: what the ONE account control shows for each account state (account-avatar.js accountModel, pure):
// signed out, signed in with a picture, signed in without one (initials), signed in without a name (the email), lapsed (reconnect), and the status lines
// (the Drive connection + the settings sync status of settings-sync.js SYNC_STATUS_TEXT).
import assert from 'node:assert';
import { accountModel, ACCOUNT_TEXT } from '../packages/ui/account-avatar.js';
import { SYNC_STATUS_TEXT } from '../packages/ui/cloud/settings-sync.js';

const ada = { name: 'Ada Lovelace', email: 'ada@example.com', picture: 'https://example.invalid/p.jpg', initials: 'AL' };

// signed out: a neutral icon, tooltip "Sign in", one line, the sign-in action, no email, no status
let m = accountModel({ state: { signedIn: false, lapsed: false }, info: null });
assert.deepStrictEqual([m.mode, m.tip, m.actions, m.status, m.email, m.picture], ['signed-out', 'Sign in', ['sign-in'], [], '', '']);
assert.strictEqual(m.purpose, 'Sign in to save designs and settings to your Google Drive. Everything also works without an account.');

// signed in with a picture: name as the tooltip, the email for the menu, the picture URL, Sign out
m = accountModel({ state: { signedIn: true, lapsed: false }, info: ada, canCheck: true });
assert.deepStrictEqual([m.mode, m.tip, m.name, m.email, m.picture, m.initials], ['signed-in', 'Ada Lovelace', 'Ada Lovelace', 'ada@example.com', 'https://example.invalid/p.jpg', 'AL']);
assert.deepStrictEqual(m.actions, ['check-drive', 'sign-out']);
assert.strictEqual(m.purpose, 'Saves your designs and settings to your Google Drive.');
assert.deepStrictEqual(m.status, [ACCOUNT_TEXT.driveConnected]);

// no picture: initials (the model has no picture, the UI draws the initials); no check function: no check action
m = accountModel({ state: { signedIn: true }, info: { ...ada, picture: '' } });
assert.deepStrictEqual([m.picture, m.initials, m.actions], ['', 'AL', ['sign-out']]);

// no name: the email is the label and nothing is repeated under it; no info yet (still loading): initials from nothing, a generic label
m = accountModel({ state: { signedIn: true }, info: { name: '', email: 'ada@example.com', picture: '', initials: 'AD' } });
assert.deepStrictEqual([m.tip, m.name, m.email], ['ada@example.com', 'ada@example.com', '']);
m = accountModel({ state: { signedIn: true }, info: null });
assert.deepStrictEqual([m.tip, m.initials], [ACCOUNT_TEXT.fallbackName, '?']);

// lapsed: the Reconnect action only (never "signed out"), a reconnect-needed Drive line, no name / email
m = accountModel({ state: { signedIn: false, lapsed: true }, info: ada });
assert.deepStrictEqual([m.mode, m.tip, m.actions, m.status, m.name, m.email], ['lapsed', 'Reconnect Google account', ['reconnect'], [ACCOUNT_TEXT.driveLapsed], '', '']);

// the settings sync status (773): shown for a signed-in / lapsed account with the very words of SYNC_STATUS_TEXT; 'off' shows nothing; signed out never shows it
for (const state of ['saved', 'saving', 'retry', 'newer', 'device']) {
  assert.deepStrictEqual(accountModel({ state: { signedIn: true }, info: ada, sync: { state } }).status, [ACCOUNT_TEXT.driveConnected, SYNC_STATUS_TEXT[state]], state);
}
assert.deepStrictEqual(accountModel({ state: { signedIn: true }, info: ada, sync: { state: 'off' } }).status, [ACCOUNT_TEXT.driveConnected]);
assert.deepStrictEqual(accountModel({ state: { signedIn: false, lapsed: true }, sync: { state: 'device' } }).status, [ACCOUNT_TEXT.driveLapsed, SYNC_STATUS_TEXT.device]);
assert.deepStrictEqual(accountModel({ state: { signedIn: false }, sync: { state: 'device' } }).status, []);
console.log('account-avatar-776-node: ok');
