// apps/shaper/src/group-status.js — Shaper's one-line status toast over the Design view (#group-status), DECLARED in one importable place (TASK 610). The page script
// (main.js: group / ungroup, import, Prepare notices) and the node test kit (tests/helpers/node-app.js: the import's result) both create it. Moved out of main.js unchanged.

/** createGroupStatus(getHost) -> status(msg): shows msg for 1.8 s in #group-status, appended to getHost() (the Design view) or the body on the first call. */
export function createGroupStatus(getHost) {
  let el = null, timer = null;
  return (msg) => {
    if (!el) {
      el = document.createElement('div'); el.id = 'group-status';
      el.style.cssText = 'position:absolute; bottom:18px; left:50%; transform:translateX(-50%); background:#1b2030; color:#cbd5e1; border:1px solid #2a2d31; border-radius:8px; padding:8px 14px; font:13px system-ui,sans-serif; z-index:50; box-shadow:0 6px 20px rgba(0,0,0,0.4); pointer-events:none; opacity:0; transition:opacity 0.15s;';
      (getHost() || document.body).appendChild(el);
    }
    el.textContent = msg; el.style.opacity = '1';
    clearTimeout(timer); timer = setTimeout(() => { if (el) el.style.opacity = '0'; }, 1800);
  };
}
