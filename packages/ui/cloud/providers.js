// packages/ui/cloud/providers.js — the cloud provider CONFIG (TASK 480). Google Drive only today.
// The OAuth client id is PUBLIC (it ships in the page exactly like DDCS Studio's does; no secret in this design): the SECRET
// lives only in the Cloudflare Pages secrets of the server session (server/googleAuth.js) and is never in the repo.
// Scope is drive.file: the app only ever sees files it created (non-sensitive, no Google verification review).
// Authorized origins: https://sketch-studio.pages.dev and http://localhost:8000 (the latter has no Functions: it uses the GIS popup).
export const GOOGLE = {
  label: 'Google Drive',
  clientId: '983232817866-b4pl67uuhfmqdrtah42vaf22ivimfh3j.apps.googleusercontent.com',
  scope: 'https://www.googleapis.com/auth/drive.file',
  rootFolderName: 'Sketch Studio',   // the one app folder in the user's Drive; every project is a folder inside it
  serverBase: '/auth/google/',       // the Pages Functions route (404 where unconfigured: the client then uses the GIS popup)
};

// localStorage keys of the signed-in account (all prefixed, so they never collide with the app's own settings).
export const KEYS = {
  token: 'sk_cloud_token',
  expiry: 'sk_cloud_token_expiry',
  lapsed: 'sk_cloud_lapsed',
  sessionKind: 'sk_cloud_session', // 'server' = the refresh token lives server-side (renewable, no popup)
};
