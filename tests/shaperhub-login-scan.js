// tests/shaperhub-login-scan.js — TASK 758 / 886: every place in the PAGE that could keep the ShaperHub login, scanned for the given (fake) secrets: each
// localStorage / sessionStorage key and value, the cookies, every IndexedDB record and the markup. Returns the places that hold one, as
// '<storage> key' / '<storage> value of <key>' / 'cookie' / 'markup' / 'IndexedDB <db>/<store>'. TASK 886: the ONE place allowed when "Remember login on this
// computer" is ticked is 'localStorage value of shaper-hub-remembered-login' (shaperhub-login.js REMEMBER_LOGIN_KEY): the caller says what it expects.
// (Not under tests/helpers: only the Sync tests use it.)
export const REMEMBERED_PLACE = 'localStorage value of shaper-hub-remembered-login';

export async function pageLoginPlaces(evalJs, secrets) {
  return evalJs(`(async () => { const secrets = ${JSON.stringify(secrets)}; const hits = [];
    const has = (where, s) => { if (secrets.some((x) => String(s).includes(x)) && !hits.includes(where)) hits.push(where); };
    for (const [n, st] of [['localStorage', localStorage], ['sessionStorage', sessionStorage]]) for (let i = 0; i < st.length; i++) { const k = st.key(i); has(n + ' key', k); has(n + ' value of ' + k, st.getItem(k)); }
    has('cookie', document.cookie);
    has('markup', document.documentElement.outerHTML);
    for (const d of await indexedDB.databases()) {
      const db = await new Promise((ok, no) => { const r = indexedDB.open(d.name); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
      for (const s of db.objectStoreNames) {
        const all = await new Promise((ok, no) => { const r = db.transaction(s).objectStore(s).getAll(); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
        has('IndexedDB ' + d.name + '/' + s, JSON.stringify(all));
      }
      db.close();
    }
    return hits; })()`);
}
