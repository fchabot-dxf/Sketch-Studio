// tests/helpers/block-remote.js — TASK 759: a live test lets NO request leave this machine. Every request of the page goes through CDP's Fetch domain:
// one to the test's own server (127.0.0.1 / localhost) goes on, every other one is FAILED (BlockedByClient) and counted, so the test can report how many
// were blocked (the fake Google Drive of tests/helpers/fake-drive-session.js never reaches the network: it answers inside the page).
// blockRemote(cdp) -> { blocked: () => [url, ...] }   (call it before navigate())
export async function blockRemote(cdp) {
  const blocked = [];
  const local = (url) => /^(https?|wss?):\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\//.test(url) || /^(data|blob|about|chrome|edge|devtools):/.test(url);
  cdp.ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = m.params;
    if (local(request.url)) { cdp.send('Fetch.continueRequest', { requestId }); return; }
    blocked.push(request.url);
    cdp.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
  });
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  return { blocked: () => [...blocked] };
}
