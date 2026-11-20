// tests/helpers/node-paths-worker.js — TASK 817: the page's WORKER PORT (apps/shaper/src/op-paths.js workerPort, the function main.js calls) on a node worker thread running
// the page's paths worker (paths-worker-thread.mjs: apps/shaper/src/paths-worker.js with a `self`). nodeWorkerPort() -> the port; op-paths.js setPathsPort(port) uses
// it, and setting another port terminates the thread. Worker-like: postMessage / terminate / onmessage / onerror, as the page's Worker.
import { Worker } from 'node:worker_threads';
import { workerPort } from '../../apps/shaper/src/op-paths.js';

export function nodeWorkerPort() {
  const w = new Worker(new URL('./paths-worker-thread.mjs', import.meta.url));
  const like = {
    postMessage: (msg) => w.postMessage(msg),
    terminate: () => w.terminate(),
    set onmessage(fn) { w.on('message', (data) => fn({ data })); },
    set onerror(fn) { w.on('error', (e) => fn(e)); },
  };
  return workerPort(like);
}
